import fs from "fs";
import crypto from "crypto";
import path from "path";
import { appendLine, ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from "./fs-utils.mjs";
import { writeLeaderboardEntries } from "./leaderboard-store.mjs";
import { sanitizeRetrievalArtifactPaths } from "./retrieval-artifacts.mjs";
import {
  HYPOTHESIS_PACKET_SCHEMA_VERSION,
  RESEARCH_DIGEST_SCHEMA_VERSION,
  RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
  RESEARCH_SOURCE_RECORD_SCHEMA_VERSION,
  validateResearchBrainArtifact
} from "./researchbrain-artifacts.mjs";

const LESSON_SCHEMA_VERSION = "lesson_v1";
const EVIDENCE_SCHEMA_VERSION = "evidence_v1";
const RETRIEVAL_SCHEMA_VERSION = "retrieval_v1";
const LEADERBOARD_SCHEMA_VERSION = "leaderboard_v1";
const POSITIVE_VERDICTS = new Set(["promising", "promising_with_caveats", "passed", "success"]);
const NEGATIVE_VERDICTS = new Set(["blocked", "failed", "inconclusive", "partial", "rejected"]);
const STRICT_PROMOTION_MIN_EVIDENCE_SCORE = 50;
const STRICT_PROMOTION_MIN_TRADES = 50;
const STRICT_PROMOTION_MIN_WINDOWS = 5;
const STRICT_PROMOTION_MIN_RETURN_PCT = 5;

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : (typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function sanitizeArtifactPaths(values) {
  return sanitizeRetrievalArtifactPaths(uniqueStrings(values));
}

function normalizeVerdict(value) {
  const text = asString(value);
  return text ? text.toLowerCase() : null;
}

function normalizeMode(value) {
  if (value === "live") return "live";
  if (value === "simulate") return "simulate";
  return null;
}

function normalizeExtraMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue === null || entryValue === undefined) continue;
    if (key === "extra_metrics") {
      Object.assign(normalized, normalizeExtraMetrics(entryValue));
      continue;
    }
    normalized[key] = entryValue;
  }

  return normalized;
}

function normalizeMetrics(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {};
  const base = {
    sharpe_is: asNumber(source.sharpe_is),
    sharpe_oos: asNumber(source.sharpe_oos ?? source.sharpe),
    wfr: asNumber(source.wfr),
    is_oos_ratio: asNumber(source.is_oos_ratio),
    max_drawdown: asNumber(source.max_drawdown),
    win_rate: asNumber(source.win_rate),
    total_trades: asNumber(source.total_trades ?? source.trades),
    annualized_return_pct: asNumber(source.annualized_return_pct ?? source.annual_return_pct ?? source.cagr_pct),
    aggregate_return_pct: asNumber(source.aggregate_return_pct ?? source.total_return_pct ?? source.return_pct),
    windows_completed: asNumber(source.windows_completed ?? source.successful_windows ?? source.completed_windows ?? source.total_windows ?? source.oos_windows),
    fold_variance: asNumber(source.fold_variance),
    markets_tested: uniqueStrings(asArray(source.markets_tested))
  };

  const extraMetrics = Object.fromEntries(
    Object.entries({
      ...normalizeExtraMetrics(source.extra_metrics),
      ...Object.fromEntries(
        Object.entries(source)
          .filter(([key]) => !(key in base) && key !== "extra_metrics")
      )
    })
      .filter(([key]) => !(key in base))
      .filter(([, value]) => value !== null && value !== undefined)
  );

  return {
    ...base,
    extra_metrics: extraMetrics
  };
}

function normalizeNextActions(actions) {
  return uniqueStrings(asArray(actions).map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") return item.action || item.title || item.rationale || JSON.stringify(item);
    return null;
  }));
}

function compactText(text, maxLength = 220) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function fileSha256(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function parseJsonFragments(text) {
  const fragments = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      fragments.push(text.slice(start, index + 1));
      start = -1;
    }
  }

  return fragments;
}

function researchJsonPaths(rootDir) {
  const researchRoot = path.join(rootDir, "factory", "research");
  if (!fs.existsSync(researchRoot)) return [];
  const paths = [];
  const stack = [researchRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        paths.push(fullPath);
      }
    }
  }
  return paths.sort();
}

function summaryMarkdownPaths(rootDir) {
  const summaryRoot = path.join(rootDir, "factory", "summaries");
  if (!fs.existsSync(summaryRoot)) return [];
  return fs.readdirSync(summaryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(summaryRoot, entry.name))
    .sort();
}

function artifactRefPaths(refs) {
  return sanitizeArtifactPaths(asArray(refs).map((ref) => asString(ref?.path)).filter(Boolean));
}

function phase8AConstraintPaths(constraints) {
  if (!constraints || typeof constraints !== "object") return [];
  return artifactRefPaths([constraints.universe_snapshot, constraints.terminal_inventory].filter(Boolean));
}

function researchSourceRecordEntry(artifact, sourcePath, artifactHash) {
  return {
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    retrieval_id: `research_source_record:${artifact.source_id}`,
    source_type: "research_source_record",
    source_path: sourcePath,
    artifact_sha256: artifactHash,
    recorded_at: artifact.accessed_at,
    stage_targets: ["ideator", "planner"],
    related_artifact_paths: sanitizeArtifactPaths([sourcePath, artifact.artifact?.path].filter(Boolean)),
    retrieval_text: compactText([
      artifact.source_id,
      artifact.source_type,
      artifact.trust_tier,
      asArray(artifact.claims_extracted).join(" "),
      asArray(artifact.limitations).join(" "),
      asArray(artifact.disconfirming_relevance).join(" ")
    ].filter(Boolean).join(" | "), 400),
    snippet: {
      source_id: artifact.source_id,
      source_type: artifact.source_type,
      trust_tier: artifact.trust_tier,
      claims_extracted: asArray(artifact.claims_extracted).slice(0, 3),
      limitations: asArray(artifact.limitations).slice(0, 3),
      disconfirming_relevance: asArray(artifact.disconfirming_relevance).slice(0, 3),
      artifact_path: sourcePath,
      artifact_sha256: artifactHash
    }
  };
}

function researchHypothesisPacketEntry(artifact, sourcePath, artifactHash) {
  const relatedPaths = sanitizeArtifactPaths([
    sourcePath,
    ...artifactRefPaths(artifact.source_records),
    ...phase8AConstraintPaths(artifact.phase8a_universe_constraints)
  ]);
  return {
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    retrieval_id: `research_hypothesis_packet:${artifact.hypothesis_id}`,
    source_type: "research_hypothesis_packet",
    source_path: sourcePath,
    artifact_sha256: artifactHash,
    mode: "stage_0_discovery",
    strategy_family: artifact.strategy_family ?? null,
    asset_scope: artifact.instrument_scope ?? null,
    timeframe: artifact.timeframe_candidate ?? null,
    stage_targets: ["ideator", "planner"],
    related_artifact_paths: relatedPaths,
    retrieval_text: compactText([
      artifact.hypothesis_id,
      artifact.strategy_family,
      artifact.instrument_scope,
      artifact.timeframe_candidate,
      artifact.mechanism,
      artifact.falsifiable_prediction,
      artifact.novelty_reason,
      asArray(artifact.expected_failure_modes).join(" "),
      asArray(artifact.disconfirming_evidence).join(" ")
    ].filter(Boolean).join(" | "), 500),
    snippet: {
      hypothesis_id: artifact.hypothesis_id,
      mechanism: compactText(artifact.mechanism, 240),
      falsifiable_prediction: compactText(artifact.falsifiable_prediction, 240),
      strategy_family: artifact.strategy_family ?? null,
      instrument_scope: artifact.instrument_scope ?? null,
      timeframe_candidate: artifact.timeframe_candidate ?? null,
      source_records: asArray(artifact.source_records).map((record) => ({ source_id: record?.source_id ?? null, path: record?.path ?? null, sha256: record?.sha256 ?? null })),
      phase8a_universe_constraints: artifact.phase8a_universe_constraints ?? null,
      artifact_path: sourcePath,
      artifact_sha256: artifactHash
    }
  };
}

function researchDigestEntry(artifact, sourcePath, artifactHash) {
  return {
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    retrieval_id: `research_digest:${artifact.digest_id}`,
    source_type: "research_digest",
    source_path: sourcePath,
    artifact_sha256: artifactHash,
    recorded_at: artifact.generated_at,
    mode: "stage_0_discovery",
    stage_targets: ["ideator", "planner"],
    related_artifact_paths: sanitizeArtifactPaths([
      sourcePath,
      ...artifactRefPaths(artifact.source_records),
      ...artifactRefPaths(artifact.hypothesis_packets),
      ...phase8AConstraintPaths(artifact.phase8a_universe_constraints)
    ]),
    retrieval_text: compactText([
      artifact.digest_id,
      artifact.research_run_id,
      asArray(artifact.key_findings).join(" "),
      asArray(artifact.limitations).join(" ")
    ].filter(Boolean).join(" | "), 500),
    snippet: {
      digest_id: artifact.digest_id,
      research_run_id: artifact.research_run_id,
      key_findings: asArray(artifact.key_findings).slice(0, 4),
      limitations: asArray(artifact.limitations).slice(0, 4),
      artifact_path: sourcePath,
      artifact_sha256: artifactHash
    }
  };
}

function researchIdeationManifestEntry(artifact, sourcePath, artifactHash) {
  const rejectedText = asArray(artifact.hypotheses_rejected).map((item) => compactText([
    item?.rejection_id,
    item?.hypothesis_id,
    item?.idea,
    item?.reason,
    JSON.stringify(item?.memory_basis ?? item?.matches ?? null)
  ].filter(Boolean).join(" | "), 220));
  const duplicateText = asArray(artifact.duplicates_detected).map((item) => compactText([
    item?.reason,
    item?.hypothesis_id,
    item?.duplicate_of,
    JSON.stringify(item?.matches ?? null)
  ].filter(Boolean).join(" | "), 220));
  return {
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    retrieval_id: `research_ideation_manifest:${artifact.research_run_id}`,
    source_type: "research_ideation_manifest",
    source_path: sourcePath,
    artifact_sha256: artifactHash,
    mode: "stage_0_discovery",
    stage_targets: ["ideator", "planner"],
    related_artifact_paths: sanitizeArtifactPaths([
      sourcePath,
      ...artifactRefPaths(artifact.artifact_paths),
      ...phase8AConstraintPaths(artifact.phase8a_universe_constraints)
    ]),
    retrieval_text: compactText([
      artifact.research_run_id,
      asArray(artifact.hypotheses_accepted).map((item) => item?.hypothesis_id).join(" "),
      rejectedText.join(" "),
      duplicateText.join(" "),
      JSON.stringify(artifact.budget_used ?? {})
    ].filter(Boolean).join(" | "), 700),
    snippet: {
      research_run_id: artifact.research_run_id,
      hypotheses_accepted: asArray(artifact.hypotheses_accepted).slice(0, 5),
      hypotheses_rejected_count: asArray(artifact.hypotheses_rejected).length,
      hypotheses_rejected: asArray(artifact.hypotheses_rejected).slice(0, 5).map((item) => ({
        rejection_id: item?.rejection_id ?? null,
        hypothesis_id: item?.hypothesis_id ?? null,
        idea: compactText(item?.idea, 160),
        reason: compactText(item?.reason, 220)
      })),
      duplicates_detected_count: asArray(artifact.duplicates_detected).length,
      duplicates_detected: asArray(artifact.duplicates_detected).slice(0, 5),
      budget_used: artifact.budget_used ?? null,
      artifact_path: sourcePath,
      artifact_sha256: artifactHash
    }
  };
}

function researchBrainRetrievalEntry(artifact, sourcePath, artifactHash) {
  if (artifact.schema_version === RESEARCH_SOURCE_RECORD_SCHEMA_VERSION) return researchSourceRecordEntry(artifact, sourcePath, artifactHash);
  if (artifact.schema_version === HYPOTHESIS_PACKET_SCHEMA_VERSION) return researchHypothesisPacketEntry(artifact, sourcePath, artifactHash);
  if (artifact.schema_version === RESEARCH_DIGEST_SCHEMA_VERSION) return researchDigestEntry(artifact, sourcePath, artifactHash);
  if (artifact.schema_version === RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION) return researchIdeationManifestEntry(artifact, sourcePath, artifactHash);
  return null;
}

function phase8DFailedSummaryEntry(fullPath, rootDir) {
  const text = fs.readFileSync(fullPath, "utf8");
  const lower = text.toLowerCase();
  const fileName = path.basename(fullPath);
  if (!fileName.startsWith("RUN-PHASE8D-") && !lower.includes("phase 8d") && !lower.includes("phase8d")) return null;
  if (!/(non-survivor|gate denied|denied|failed|blocked|negative|zero survivors|phase8e false|phase 8e remains blocked)/i.test(text)) return null;
  const sourcePath = repoRelative(rootDir, fullPath);
  const artifactHash = fileSha256(fullPath);
  const stat = fs.statSync(fullPath);
  const runId = fileName.replace(/\.md$/i, "");
  const compact = compactText(text.replace(/^#+\s*/gm, ""), 900);
  return {
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    retrieval_id: `phase8d_failed_summary:${runId}`,
    source_type: "phase8d_failed_summary",
    source_path: sourcePath,
    artifact_sha256: artifactHash,
    recorded_at: stat.mtime.toISOString(),
    mode: "live",
    verdict: "failed",
    stage_targets: ["ideator", "planner"],
    related_artifact_paths: sanitizeArtifactPaths([sourcePath]),
    retrieval_text: compact,
    snippet: {
      run_id: runId,
      summary_path: sourcePath,
      failure_memory: compactText(text, 400),
      phase8e_blocked: /phase\s*8e.*blocked|phase8e false/i.test(text),
      artifact_sha256: artifactHash
    }
  };
}

export function buildResearchBrainRetrievalEntries(rootDir) {
  const entries = [];
  for (const fullPath of researchJsonPaths(rootDir)) {
    const artifact = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    try {
      validateResearchBrainArtifact(artifact, { rootDir, requireExisting: true });
    } catch (error) {
      if ([
        RESEARCH_SOURCE_RECORD_SCHEMA_VERSION,
        HYPOTHESIS_PACKET_SCHEMA_VERSION,
        RESEARCH_DIGEST_SCHEMA_VERSION,
        RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION
      ].includes(artifact?.schema_version)) {
        throw error;
      }
      continue;
    }
    const sourcePath = repoRelative(rootDir, fullPath);
    const entry = researchBrainRetrievalEntry(artifact, sourcePath, fileSha256(fullPath));
    if (entry) entries.push(entry);
  }
  for (const fullPath of summaryMarkdownPaths(rootDir)) {
    const entry = phase8DFailedSummaryEntry(fullPath, rootDir);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => String(a.retrieval_id).localeCompare(String(b.retrieval_id)));
}

function normalizeEvidenceEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const verdict = normalizeVerdict(entry.verdict);
  const mode = normalizeMode(entry.mode);
  const evidenceKind = asString(entry.evidence_kind) || (mode === "live" ? "research" : mode === "simulate" ? "simulation" : "unknown");
  const normalized = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    run_id: asString(entry.run_id),
    mode,
    evidence_kind: evidenceKind,
    authority_layer: asString(entry.authority_layer),
    candidate_id: asString(entry.candidate_id),
    candidate_stage: asString(entry.candidate_stage),
    deployment_mode: asString(entry.deployment_mode),
    promotable: false,
    backlog_item_id: asString(entry.backlog_item_id),
    experiment_id: asString(entry.experiment_id),
    strategy_family: asString(entry.strategy_family),
    market_family: asString(entry.market_family),
    asset_scope: asString(entry.asset_scope),
    timeframe: asString(entry.timeframe),
    verdict,
    evidence_score: asNumber(entry.evidence_score),
    overall_score: asNumber(entry.overall_score),
    metrics: normalizeMetrics(entry.metrics),
    observations: entry.observations && typeof entry.observations === "object" ? entry.observations : null,
    artifact_manifest_path: asString(entry.artifact_manifest_path),
    blocked_reason: asString(entry.blocked_reason),
    source_hashes: Array.isArray(entry.source_hashes) ? entry.source_hashes : [],
    summary_path: asString(entry.summary_path),
    recorded_at: asString(entry.recorded_at ?? entry.ts ?? entry.timestamp),
    legacy_scores: {
      objective_score: asNumber(entry.objective_score),
      reproducibility_score: asNumber(entry.reproducibility_score)
    }
  };
  normalized.promotable = isStrictlyPromotableEvidence(normalized);
  return normalized;
}

function hasMeaningfulOosMetrics(entry) {
  const metrics = entry?.metrics || {};
  return metrics.sharpe_oos !== null && metrics.sharpe_oos !== undefined;
}

function hasSufficientTradeCount(entry) {
  const trades = entry?.metrics?.total_trades;
  return typeof trades === "number" && Number.isFinite(trades) && trades >= STRICT_PROMOTION_MIN_TRADES;
}

function metricFromBaseOrExtra(metrics, key) {
  const value = metrics?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const extra = metrics?.extra_metrics?.[key];
  return typeof extra === "number" && Number.isFinite(extra) ? extra : null;
}

function hasSufficientWindowCount(entry) {
  const windows = metricFromBaseOrExtra(entry?.metrics, "windows_completed");
  return typeof windows === "number" && Number.isFinite(windows) && windows >= STRICT_PROMOTION_MIN_WINDOWS;
}

function hasSufficientReturn(entry) {
  const annualized = metricFromBaseOrExtra(entry?.metrics, "annualized_return_pct");
  if (annualized !== null) return annualized >= STRICT_PROMOTION_MIN_RETURN_PCT;
  const aggregate = metricFromBaseOrExtra(entry?.metrics, "aggregate_return_pct");
  return aggregate !== null && aggregate >= STRICT_PROMOTION_MIN_RETURN_PCT;
}

export function isStrictlyPromotableEvidence(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.mode !== "live") return false;
  if (!["research", "research_wfa"].includes(entry.evidence_kind)) return false;
  if (!POSITIVE_VERDICTS.has(entry.verdict)) return false;
  if ((entry.evidence_score ?? 0) < STRICT_PROMOTION_MIN_EVIDENCE_SCORE) return false;
  if (!hasMeaningfulOosMetrics(entry)) return false;
  if (!hasSufficientTradeCount(entry)) return false;
  if (!hasSufficientWindowCount(entry)) return false;
  if (!hasSufficientReturn(entry)) return false;
  return true;
}

function buildRetrievalText(payload) {
  return compactText([
    payload.experiment_id,
    payload.verdict,
    payload.mode,
    payload.strategy_family,
    payload.market_family,
    payload.asset_scope,
    payload.timeframe,
    payload.lesson_text,
    payload.specific_finding,
    payload.next_actions?.join(" "),
    JSON.stringify(payload.metrics || {})
  ].filter(Boolean).join(" | "), 400);
}

function normalizeLessonPieces(record) {
  if (record?.schema_version === LESSON_SCHEMA_VERSION && record.lesson_text) {
    return [{
      lesson_text: record.lesson_text,
      specific_finding: record.specific_finding ?? null,
      strategy_family: record.strategy_family ?? null,
      market_family: record.market_family ?? null,
      asset_scope: record.asset_scope ?? null,
      timeframe: record.timeframe ?? null,
      related_artifact_paths: sanitizeArtifactPaths(asArray(record.related_artifact_paths)),
      metrics: normalizeMetrics(record.metrics),
      next_actions: normalizeNextActions(record.next_actions)
    }];
  }

  const lessons = asArray(record?.lessons);
  if (lessons.length === 0 && record?.lesson_text) {
    lessons.push({
      lesson: record.lesson_text,
      specific_finding: record.specific_finding ?? null,
      strategy_type: record.strategy_family ?? null,
      asset: record.asset_scope ?? null,
      timeframe: record.timeframe ?? null,
      result: record.metrics ?? null
    });
  }

  return lessons.map((item) => {
    if (typeof item === "string") {
      return {
        lesson_text: item,
        specific_finding: null,
        strategy_family: asString(record.strategy_type),
        market_family: asString(record.market_family),
        asset_scope: asString(record.asset),
        timeframe: asString(record.timeframe),
        related_artifact_paths: [],
        metrics: normalizeMetrics(record.metrics),
        next_actions: normalizeNextActions(record.next_actions)
      };
    }

    const object = item && typeof item === "object" ? item : {};
    return {
      lesson_text: asString(object.lesson || object.summary || JSON.stringify(object)),
      specific_finding: asString(object.specific_finding),
      strategy_family: asString(object.strategy_type ?? record.strategy_type),
      market_family: asString(object.market_family ?? record.market_family),
      asset_scope: asString(object.asset ?? record.asset),
      timeframe: asString(object.timeframe ?? record.timeframe),
      related_artifact_paths: sanitizeArtifactPaths(asArray(object.related_artifact_paths)),
      metrics: normalizeMetrics(object.result ?? record.metrics),
      next_actions: normalizeNextActions(record.next_actions)
    };
  }).filter((item) => item.lesson_text);
}

function normalizeLessonRecord(record, index, evidenceByRunId) {
  if (!record || typeof record !== "object") return [];
  const evidence = evidenceByRunId.get(asString(record.run_id)) || null;
  const pieces = normalizeLessonPieces(record);
  const mode = normalizeMode(record.mode ?? evidence?.mode) ?? evidence?.mode ?? null;
  const verdict = normalizeVerdict(record.verdict ?? evidence?.verdict);
  const experimentId = asString(record.experiment_id ?? evidence?.experiment_id);
  const runId = asString(record.run_id ?? evidence?.run_id);
  const backlogItemId = asString(record.backlog_item_id ?? evidence?.backlog_item_id);
  const iteration = asNumber(record.iteration);
  const ts = asString(record.ts ?? record.timestamp ?? evidence?.recorded_at);
  const evidenceScore = asNumber(record.evidence_score ?? evidence?.evidence_score);
  const summaryPath = asString(record.summary_path ?? evidence?.summary_path);

  return pieces.map((piece, lessonIndex) => {
    const lessonId = asString(record.lesson_id) || [runId || experimentId || `line-${index + 1}`, lessonIndex + 1].join(":");
    const relatedArtifactPaths = sanitizeArtifactPaths([
      ...piece.related_artifact_paths,
      ...(summaryPath ? [summaryPath] : [])
    ]);
    const payload = {
      schema_version: LESSON_SCHEMA_VERSION,
      lesson_id: lessonId,
      ts,
      run_id: runId,
      experiment_id: experimentId,
      backlog_item_id: backlogItemId,
      iteration,
      mode,
      verdict,
      evidence_score: evidenceScore,
      strategy_family: piece.strategy_family,
      market_family: piece.market_family,
      asset_scope: piece.asset_scope,
      timeframe: piece.timeframe,
      metrics: piece.metrics,
      lesson_text: piece.lesson_text,
      specific_finding: piece.specific_finding,
      next_actions: piece.next_actions,
      related_artifact_paths: relatedArtifactPaths
    };

    return {
      ...payload,
      retrieval_text: buildRetrievalText(payload)
    };
  });
}

function buildRetrievalIndex(lessons, evidence, researchBrainEntries = []) {
  const lessonEntries = lessons.map((entry) => ({
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    retrieval_id: `lesson:${entry.lesson_id}`,
    source_type: "lesson",
    source_path: "factory/memory/lessons.jsonl",
    run_id: entry.run_id,
    experiment_id: entry.experiment_id,
    backlog_item_id: entry.backlog_item_id,
    mode: entry.mode,
    verdict: entry.verdict,
    evidence_score: entry.evidence_score,
    strategy_family: entry.strategy_family,
    market_family: entry.market_family,
    asset_scope: entry.asset_scope,
    timeframe: entry.timeframe,
    recorded_at: entry.ts,
    stage_targets: ["ideator", "planner", "executor", "summarizer"],
    related_artifact_paths: entry.related_artifact_paths,
    retrieval_text: entry.retrieval_text,
    snippet: {
      lesson: entry.lesson_text,
      specific_finding: entry.specific_finding,
      metrics: entry.metrics,
      next_actions: entry.next_actions
    }
  }));

  const evidenceEntries = evidence.map((entry) => ({
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    retrieval_id: `evidence:${entry.run_id || entry.experiment_id}`,
    source_type: "evidence",
    source_path: "factory/evidence/index.json",
    run_id: entry.run_id,
    experiment_id: entry.experiment_id,
    backlog_item_id: entry.backlog_item_id,
    mode: entry.mode,
    verdict: entry.verdict,
    evidence_score: entry.evidence_score,
    strategy_family: entry.strategy_family,
    market_family: entry.market_family,
    asset_scope: entry.asset_scope,
    timeframe: entry.timeframe,
    recorded_at: entry.recorded_at,
    stage_targets: ["ideator", "planner", "evaluator"],
    related_artifact_paths: sanitizeArtifactPaths([entry.summary_path].filter(Boolean)),
    retrieval_text: compactText([
      entry.experiment_id,
      entry.backlog_item_id,
      entry.verdict,
      entry.mode,
      entry.strategy_family,
      entry.market_family,
      entry.asset_scope,
      entry.timeframe,
      JSON.stringify(entry.metrics || {})
    ].filter(Boolean).join(" | "), 400),
    snippet: {
      evidence_score: entry.evidence_score,
      overall_score: entry.overall_score,
      metrics: entry.metrics,
      summary_path: entry.summary_path,
      evidence_kind: entry.evidence_kind,
      promotable: entry.promotable,
      strategy_family: entry.strategy_family,
      market_family: entry.market_family,
      asset_scope: entry.asset_scope,
      timeframe: entry.timeframe
    }
  }));

  return [...lessonEntries, ...evidenceEntries, ...researchBrainEntries]
    .sort((a, b) => Date.parse(b.recorded_at || 0) - Date.parse(a.recorded_at || 0));
}

export function rebuildLeaderboard(paths, evidenceEntries = null) {
  const evidence = Array.isArray(evidenceEntries) ? evidenceEntries : readJson(paths.evidenceIndex, []);
  const leaderboard = evidence
    .filter((entry) => isStrictlyPromotableEvidence(entry))
    .map((entry, index) => ({
      schema_version: LEADERBOARD_SCHEMA_VERSION,
      rank: index + 1,
      run_id: entry.run_id,
      experiment_id: entry.experiment_id,
      backlog_item_id: entry.backlog_item_id,
      mode: entry.mode,
      verdict: entry.verdict,
      evidence_score: entry.evidence_score,
      overall_score: entry.overall_score,
      metrics: entry.metrics,
      summary_path: entry.summary_path,
      recorded_at: entry.recorded_at,
      evidence_kind: entry.evidence_kind,
      promotable: true
    }))
    .sort((a, b) => (b.evidence_score ?? 0) - (a.evidence_score ?? 0) || (b.overall_score ?? 0) - (a.overall_score ?? 0) || Date.parse(b.recorded_at || 0) - Date.parse(a.recorded_at || 0))
    .slice(0, 100)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  writeLeaderboardEntries(paths, leaderboard);
  return leaderboard;
}

function writeRepairArtifacts(paths, report, badFragments) {
  if (badFragments.length === 0 && report.legacy_records_normalized === 0) return null;
  ensureDir(paths.memoryQuarantine, paths);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(paths.memoryQuarantine, `repair-report-${stamp}.json`);
  writeJsonAtomic(reportPath, report, paths);
  if (badFragments.length > 0) {
    const fragmentsPath = path.join(paths.memoryQuarantine, `bad-fragments-${stamp}.jsonl`);
    for (const fragment of badFragments) {
      appendLine(fragmentsPath, JSON.stringify(fragment), paths);
    }
  }
  return reportPath;
}

export function rebuildNormalizedMemory(paths) {
  ensureDir(paths.memoryQuarantine, paths);

  const rawEvidence = readJson(paths.evidenceIndex, []);
  const normalizedEvidence = asArray(rawEvidence)
    .map((entry) => normalizeEvidenceEntry(entry))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.recorded_at || 0) - Date.parse(b.recorded_at || 0));
  writeJsonAtomic(paths.evidenceIndex, normalizedEvidence, paths);
  const leaderboard = rebuildLeaderboard(paths, normalizedEvidence);

  const evidenceByRunId = new Map(normalizedEvidence.filter((entry) => entry.run_id).map((entry) => [entry.run_id, entry]));
  const rawLessonText = fs.existsSync(paths.lessons) ? fs.readFileSync(paths.lessons, "utf8") : "";
  const lines = rawLessonText.split("\n");
  const normalizedLessons = [];
  const badFragments = [];
  let legacyRecordsNormalized = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;

    const fragments = parseJsonFragments(line);
    if (fragments.length === 0) {
      badFragments.push({ line_number: index + 1, reason: "no_json_object_found", raw_fragment: line });
      continue;
    }

    for (const fragment of fragments) {
      try {
        const parsed = JSON.parse(fragment);
        const entries = normalizeLessonRecord(parsed, index, evidenceByRunId);
        if (entries.length === 0) {
          badFragments.push({ line_number: index + 1, reason: "no_lesson_entries_produced", raw_fragment: fragment });
          continue;
        }
        if (parsed.schema_version !== LESSON_SCHEMA_VERSION) {
          legacyRecordsNormalized += 1;
        }
        normalizedLessons.push(...entries);
      } catch (error) {
        badFragments.push({
          line_number: index + 1,
          reason: error instanceof Error ? error.message : String(error),
          raw_fragment: fragment
        });
      }
    }
  }

  const canonicalLessonText = normalizedLessons.map((entry) => JSON.stringify(entry)).join("\n");
  writeTextAtomic(paths.lessons, canonicalLessonText ? `${canonicalLessonText}\n` : "", paths);

  const researchBrainEntries = buildResearchBrainRetrievalEntries(paths.root);
  const retrievalIndex = buildRetrievalIndex(normalizedLessons, normalizedEvidence, researchBrainEntries);
  writeJsonAtomic(paths.retrievalIndex, retrievalIndex, paths);

  const repairReport = {
    repaired_at: new Date().toISOString(),
    lessons_written: normalizedLessons.length,
    evidence_entries_written: normalizedEvidence.length,
    researchbrain_entries_written: researchBrainEntries.length,
    retrieval_entries_written: retrievalIndex.length,
    bad_fragments: badFragments.length,
    legacy_records_normalized: legacyRecordsNormalized
  };
  writeRepairArtifacts(paths, repairReport, badFragments);

  return {
    lessons: normalizedLessons,
    evidence: normalizedEvidence,
    leaderboard,
    retrievalIndex,
    repairReport
  };
}

export function appendCanonicalLessons(paths, entries) {
  const lessonEntries = asArray(entries)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => normalizeLessonRecord(entry, 0, new Map())[0])
    .filter(Boolean);

  for (const entry of lessonEntries) {
    appendLine(paths.lessons, JSON.stringify(entry), paths);
  }

  return lessonEntries;
}

export function buildCanonicalLessonEntries({
  runId,
  experimentId,
  backlogItemId = null,
  iteration = null,
  mode,
  verdict,
  evidenceScore = null,
  metrics = null,
  summaryPath = null,
  artifactPaths = [],
  strategyFamily = null,
  marketFamily = null,
  assetScope = null,
  timeframe = null,
  keyLessons = [],
  nextActions = []
}) {
  const ts = new Date().toISOString();
  const normalizedMetrics = normalizeMetrics(metrics);
  const normalizedNextActions = normalizeNextActions(nextActions);

  return asArray(keyLessons).map((lesson, index) => {
    const lessonText = typeof lesson === "string"
      ? lesson
      : asString(lesson?.lesson || lesson?.summary || lesson?.specific_finding || JSON.stringify(lesson));
    if (!lessonText) return null;

    const payload = {
      schema_version: LESSON_SCHEMA_VERSION,
      lesson_id: `${runId}:${index + 1}`,
      ts,
      run_id: runId,
      experiment_id: experimentId,
      backlog_item_id: backlogItemId,
      iteration,
      mode: normalizeMode(mode),
      verdict: normalizeVerdict(verdict),
      evidence_score: asNumber(evidenceScore),
      strategy_family: asString(lesson?.strategy_type ?? strategyFamily),
      market_family: asString(lesson?.market_family ?? marketFamily),
      asset_scope: asString(lesson?.asset ?? assetScope),
      timeframe: asString(lesson?.timeframe ?? timeframe),
      metrics: normalizeMetrics(lesson?.result ?? normalizedMetrics),
      lesson_text: lessonText,
      specific_finding: asString(lesson?.specific_finding),
      next_actions: normalizedNextActions,
      related_artifact_paths: sanitizeArtifactPaths([...(summaryPath ? [summaryPath] : []), ...asArray(artifactPaths)])
    };

    return {
      ...payload,
      retrieval_text: buildRetrievalText(payload)
    };
  }).filter(Boolean);
}

import fs from "fs";
import path from "path";
import { appendLine, ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from "./fs-utils.mjs";
import { writeLeaderboardEntries } from "./leaderboard-store.mjs";
import { sanitizeRetrievalArtifactPaths } from "./retrieval-artifacts.mjs";

const LESSON_SCHEMA_VERSION = "lesson_v1";
const EVIDENCE_SCHEMA_VERSION = "evidence_v1";
const RETRIEVAL_SCHEMA_VERSION = "retrieval_v1";
const LEADERBOARD_SCHEMA_VERSION = "leaderboard_v1";
const POSITIVE_VERDICTS = new Set(["promising", "promising_with_caveats", "passed", "success"]);
const NEGATIVE_VERDICTS = new Set(["blocked", "failed", "inconclusive", "partial", "rejected"]);
const STRICT_PROMOTION_MIN_EVIDENCE_SCORE = 50;
const STRICT_PROMOTION_MIN_TRADES = 20;

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

export function isStrictlyPromotableEvidence(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.mode !== "live") return false;
  if (!["research", "research_wfa"].includes(entry.evidence_kind)) return false;
  if (!POSITIVE_VERDICTS.has(entry.verdict)) return false;
  if ((entry.evidence_score ?? 0) < STRICT_PROMOTION_MIN_EVIDENCE_SCORE) return false;
  if (!hasMeaningfulOosMetrics(entry)) return false;
  if (!hasSufficientTradeCount(entry)) return false;
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

function buildRetrievalIndex(lessons, evidence) {
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

  return [...lessonEntries, ...evidenceEntries]
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

  const retrievalIndex = buildRetrievalIndex(normalizedLessons, normalizedEvidence);
  writeJsonAtomic(paths.retrievalIndex, retrievalIndex, paths);

  const repairReport = {
    repaired_at: new Date().toISOString(),
    lessons_written: normalizedLessons.length,
    evidence_entries_written: normalizedEvidence.length,
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

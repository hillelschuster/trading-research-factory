import fs from "fs";
import crypto from "crypto";
import path from "path";
import { readAndValidateDataReadinessManifest } from "./data-readiness.mjs";
import { validateResearchWfaPreregistrationArtifact } from "./research-wfa-preregistration.mjs";
import { classifyResearchBrainBacklogSourceQuality, isResearchBrainBacklogCandidate, validateHypothesisPacket, validateResearchBrainBacklogCandidate } from "./researchbrain-artifacts.mjs";
import { validateCanonicalWfaConfig } from "./wfa-config-contract.mjs";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function repoPath(value) {
  const text = cleanText(value).replace(/\\/g, "/");
  if (!text || path.isAbsolute(text)) return null;
  return text;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function repoPathList(value) {
  const values = Array.isArray(value) ? value : [value];
  return unique(values.map((entry) => repoPath(entry)));
}

function isDataReadinessManifestPath(value) {
  return /(?:^|\/)workspace\/data\/.+manifest\.json$/i.test(String(value || ""));
}

function firstRepoPathFromText(value) {
  const text = cleanText(value).replace(/\\/g, "/");
  const match = text.match(/(?:walk forward engine|workspace|factory)\/[\w .\-/]+?(?:\.[A-Za-z0-9]+)(?=$|[\s,;])/);
  return match?.[0]?.trim() ?? null;
}

function existingRepoPath(rootDir, value) {
  const relative = repoPath(value);
  if (!relative) return null;
  const full = path.resolve(rootDir, relative);
  const root = path.resolve(rootDir);
  const rooted = path.relative(root, full);
  if (rooted.startsWith("..") || path.isAbsolute(rooted)) return null;
  return fs.existsSync(full) ? relative : null;
}

function strategyNameFromWfaConfig(wfaConfigPath) {
  return path.basename(path.dirname(wfaConfigPath.replace(/\\/g, "/")));
}

function safeId(value) {
  const cleaned = cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "WFA-READY";
}

function canonicalConfigRef(wfaConfigPath) {
  const normalized = wfaConfigPath.replace(/\\/g, "/");
  const prefix = "walk forward engine/";
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

function dataManifestPathsFromBacklog(backlogItem) {
  const paths = [
    ...repoPathList(backlogItem.data_manifest_path),
    ...repoPathList(backlogItem.data_manifest_paths),
    ...repoPathList(backlogItem.expected_data_manifest_path),
    ...repoPathList(backlogItem.expected_data_manifest_paths),
    ...repoPathList(backlogItem.data_readiness_manifest_path),
    ...repoPathList(backlogItem.data_readiness_manifest_paths),
    ...repoPathList(backlogItem.expected_data_readiness_manifest_path),
    ...repoPathList(backlogItem.expected_data_readiness_manifest_paths)
  ];
  const dataRequirement = repoPath(backlogItem.data_requirement) ?? firstRepoPathFromText(backlogItem.data_requirement);
  if (isDataReadinessManifestPath(dataRequirement)) paths.push(dataRequirement);
  return unique(paths);
}

function researchBrainSourceHashes(backlogItem) {
  if (!isResearchBrainBacklogCandidate(backlogItem)) return [];
  return unique([
    backlogItem.hypothesis_packet_path && backlogItem.hypothesis_packet_sha256
      ? { artifact_type: "hypothesis_packet", path: repoPath(backlogItem.hypothesis_packet_path), sha256: backlogItem.hypothesis_packet_sha256 }
      : null,
    ...(Array.isArray(backlogItem.source_record_refs) ? backlogItem.source_record_refs : [])
      .map((ref) => ({ artifact_type: ref.artifact_type ?? "research_source_record", path: repoPath(ref.path), sha256: ref.sha256 }))
  ].filter((ref) => ref?.path && ref?.sha256).map((ref) => JSON.stringify(ref))).map((item) => JSON.parse(item));
}

function phase8dBlocked(reason, blockedReason, extra = {}) {
  return {
    compiled: false,
    reason,
    blocked_reason: blockedReason,
    phase8d_blocked_at_start: true,
    source_hashes: extra.source_hashes ?? [],
    ...extra
  };
}

function hashFile(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function validatedPhase8DHypothesisPacketRef(backlogItem, { rootDir }) {
  const ref = {
    path: repoPath(backlogItem.hypothesis_packet_path ?? backlogItem.manual_hypothesis_packet_path),
    sha256: backlogItem.hypothesis_packet_sha256 ?? backlogItem.manual_hypothesis_packet_sha256 ?? null
  };
  if (!ref.path || !ref.sha256) return { ok: false, missing: true };
  const fullPath = path.resolve(rootDir, ref.path);
  const root = path.resolve(rootDir);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return { ok: false, reason: "hypothesis packet path escapes repository root" };
  if (!fs.existsSync(fullPath)) return { ok: false, reason: `hypothesis packet missing on disk: ${ref.path}` };
  const actualSha = hashFile(fullPath);
  if (actualSha !== ref.sha256) return { ok: false, reason: `hypothesis packet sha256 mismatch for ${ref.path}` };
  try {
    validateHypothesisPacket(JSON.parse(fs.readFileSync(fullPath, "utf8")), { rootDir, requireExisting: true });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, ref: { artifact_type: "hypothesis_packet", path: ref.path, sha256: ref.sha256 } };
}

function preregistrationRefFromBacklog(backlogItem) {
  return backlogItem?.research_wfa_preregistration
    ?? backlogItem?.research_wfa_preregistration_artifact
    ?? backlogItem?.research_wfa_preregistration_ref
    ?? null;
}

function hasPhase8DScreeningIntent(backlogItem) {
  const text = [
    backlogItem?.candidate_stage,
    backlogItem?.launch_stage,
    backlogItem?.readiness,
    backlogItem?.phase,
    backlogItem?.execution_stage
  ].map(cleanText).join(" ");
  return /phase\s*8d|screening/i.test(text);
}

function maxManifestAgeHours(backlogItem) {
  const value = Number(backlogItem.data_readiness_max_age_hours ?? backlogItem.max_data_readiness_manifest_age_hours);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function assertManifestFresh(manifest, maxAgeHours, nowMs) {
  if (!maxAgeHours) return;
  const retrievedMs = Date.parse(manifest.source?.retrieved_at);
  if (!Number.isFinite(retrievedMs)) throw new Error("data_readiness manifest source.retrieved_at is not parseable for freshness check");
  const ageHours = (nowMs - retrievedMs) / (60 * 60 * 1000);
  if (ageHours > maxAgeHours) {
    throw new Error(`data_readiness manifest is stale: source.retrieved_at age ${ageHours.toFixed(2)}h exceeds ${maxAgeHours}h`);
  }
}

function dataReadinessRecords(rootDir, manifestPaths, { maxAgeHours = null, nowMs = Date.now() } = {}) {
  return manifestPaths.map((manifestPath) => {
    try {
      const manifest = readAndValidateDataReadinessManifest(manifestPath, { rootDir });
      assertManifestFresh(manifest, maxAgeHours, nowMs);
      return {
        path: manifestPath,
        status: "consumed",
        dataset_id: manifest.dataset_id,
        source_family: manifest.source_family,
        instrument: manifest.instrument,
        timeframe: manifest.timeframe,
        coverage: manifest.coverage,
        gap_report: manifest.gap_report,
        data_paths: repoPathList(manifest.wfa_integration?.data_paths),
        data_manifest_paths: unique([manifestPath, ...repoPathList(manifest.wfa_integration?.data_manifest_paths)])
      };
    } catch (error) {
      return {
        path: manifestPath,
        status: "not_consumable",
        blocked_reason: error instanceof Error ? error.message : String(error),
        data_paths: [],
        data_manifest_paths: [manifestPath]
      };
    }
  });
}

export function compileWfaReadyPlan({ backlogItem, rootDir, runId }) {
  if (!backlogItem || typeof backlogItem !== "object") {
    return { compiled: false, reason: "missing_backlog_item" };
  }
  if ((backlogItem.evidence_kind ?? "research_wfa") !== "research_wfa") {
    return { compiled: false, reason: "non_research_wfa_item" };
  }

  const phase8dIntent = hasPhase8DScreeningIntent(backlogItem);
  const researchBrainSourceHashesForPlan = researchBrainSourceHashes(backlogItem);
  if (isResearchBrainBacklogCandidate(backlogItem)) {
    try {
      validateResearchBrainBacklogCandidate(backlogItem, { rootDir, requireExisting: true });
    } catch (error) {
      const blockedReason = error instanceof Error ? error.message : String(error);
      const sourceQuality = classifyResearchBrainBacklogSourceQuality(backlogItem, { rootDir, requireExisting: true });
      if (phase8dIntent && sourceQuality.applies && sourceQuality.direct_wfa_ready_allowed === false && /source-quality gate blocks direct WFA-ready backlog/i.test(blockedReason)) {
        return phase8dBlocked(
          "researchbrain_source_quality_gate_not_wfa_ready",
          `ResearchBrain source-quality gate blocked direct Phase 8D WFA route: ${sourceQuality.reasons.join("; ")}`,
          { source_quality_gate: sourceQuality, source_hashes: researchBrainSourceHashesForPlan }
        );
      }
      return phase8dIntent
        ? phase8dBlocked("invalid_researchbrain_backlog_provenance", blockedReason)
        : { compiled: false, reason: "invalid_researchbrain_backlog_provenance", blocked_reason: blockedReason };
    }
    const sourceQuality = classifyResearchBrainBacklogSourceQuality(backlogItem, { rootDir, requireExisting: true });
    if (sourceQuality.direct_wfa_ready_allowed === false) {
      return phase8dBlocked("researchbrain_source_quality_gate_not_wfa_ready", `ResearchBrain source-quality gate blocked direct Phase 8D WFA route: ${sourceQuality.reasons.join("; ")}`, { source_quality_gate: sourceQuality, source_hashes: researchBrainSourceHashesForPlan });
    }
  }

  let phase8dHypothesisSourceHash = null;
  if (phase8dIntent) {
    const hypothesis = validatedPhase8DHypothesisPacketRef(backlogItem, { rootDir });
    if (!hypothesis.ok) {
      return phase8dBlocked(
        hypothesis.missing ? "legacy_ready_wfa_phase8d_requires_hypothesis_packet" : "invalid_phase8d_hypothesis_packet",
        hypothesis.missing
          ? "Phase 8D screening WFA attempts must originate from a hash-backed hypothesis_packet_v1; legacy ready WFA routes are not Phase 8D inputs."
          : `Phase 8D hypothesis packet is not consumable: ${hypothesis.reason}`
      );
    }
    phase8dHypothesisSourceHash = hypothesis.ref;
  }

  const preregistrationRef = preregistrationRefFromBacklog(backlogItem);
  let preregistrationSourceHash = null;
  if (preregistrationRef) {
    try {
      validateResearchWfaPreregistrationArtifact(preregistrationRef, {
        rootDir,
        expectedCandidateId: backlogItem.candidate_id ?? null,
        expectedRunId: runId
      });
      preregistrationSourceHash = {
        artifact_type: "research_wfa_preregistration",
        path: repoPath(preregistrationRef.path),
        sha256: preregistrationRef.sha256
      };
    } catch (error) {
      const blockedReason = error instanceof Error ? error.message : String(error);
      return phase8dIntent
        ? phase8dBlocked("invalid_research_wfa_preregistration", blockedReason, { source_hashes: [phase8dHypothesisSourceHash].filter(Boolean), phase8d_hypothesis_packet: phase8dHypothesisSourceHash })
        : { compiled: false, reason: "invalid_research_wfa_preregistration", blocked_reason: blockedReason };
    }
  } else if (phase8dIntent) {
    return phase8dBlocked("missing_research_wfa_preregistration", "Phase 8D/screening WFA attempts require a hash-backed pre-run research_wfa_preregistration_v1 artifact before launch.", { source_hashes: [phase8dHypothesisSourceHash].filter(Boolean), phase8d_hypothesis_packet: phase8dHypothesisSourceHash });
  }

  const wfaConfigPath = repoPath(backlogItem.expected_wfa_config_path ?? backlogItem.wfa_config_path);
  if (!wfaConfigPath || !/^walk forward engine\/strategies\/[^/]+\/wfa_config\.ya?ml$/i.test(wfaConfigPath)) {
    return { compiled: false, reason: "missing_canonical_wfa_config_path" };
  }
  const configRef = canonicalConfigRef(wfaConfigPath);
  if (!configRef) {
    return { compiled: false, reason: "invalid_wfa_config_scope" };
  }
  if (!existingRepoPath(rootDir, wfaConfigPath)) {
    return { compiled: false, reason: "wfa_config_missing_on_disk", wfa_config_path: wfaConfigPath };
  }
  const wfaConfigValidation = validateCanonicalWfaConfig({ rootDir, wfaConfigPath });
  if (!wfaConfigValidation.valid) {
    return { compiled: false, reason: "invalid_wfa_config_contract", wfa_config_path: wfaConfigPath, blocked_reason: wfaConfigValidation.errors.join("; ") };
  }

  const optionalPathChecks = [
    ["strategy_config_path", backlogItem.expected_strategy_config_path ?? backlogItem.strategy_config_path],
    ["strategy_source_path", backlogItem.expected_strategy_source_path ?? backlogItem.strategy_source_path]
  ];
  for (const [field, value] of optionalPathChecks) {
    const relative = repoPath(value);
    if (relative && !existingRepoPath(rootDir, relative)) {
      return { compiled: false, reason: `${field}_missing_on_disk`, [field]: relative };
    }
  }

  const strategyName = strategyNameFromWfaConfig(wfaConfigPath);
  const dataManifestPaths = dataManifestPathsFromBacklog(backlogItem);
  const dataReadinessManifests = dataReadinessRecords(rootDir, dataManifestPaths, {
    maxAgeHours: maxManifestAgeHours(backlogItem),
    nowMs: backlogItem.data_readiness_now_ms ?? Date.now()
  });
  const manifestDataPaths = unique(dataReadinessManifests.flatMap((record) => record.data_paths));
  const dataPathCandidate = repoPath(backlogItem.data_requirement) ?? firstRepoPathFromText(backlogItem.data_requirement);
  const dataPath = dataPathCandidate && !dataManifestPaths.includes(dataPathCandidate) ? dataPathCandidate : null;
  const strategyConfigPath = repoPath(backlogItem.expected_strategy_config_path ?? backlogItem.strategy_config_path);
  const strategySourcePath = repoPath(backlogItem.expected_strategy_source_path ?? backlogItem.strategy_source_path);
  const dataRequirements = unique([dataPath, ...manifestDataPaths, ...dataManifestPaths]);
  const inputs = unique([wfaConfigPath, strategyConfigPath, strategySourcePath, dataPath, ...manifestDataPaths, ...dataManifestPaths]);
  const experimentId = backlogItem.experiment_id ?? `EXP-${safeId(backlogItem.id)}`;
  const command = `.venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config ${configRef}`;

  const plan = {
    experiment_id: experimentId,
    title: cleanText(backlogItem.title) || `Deterministic WFA route for ${strategyName}`,
    backlog_item_id: backlogItem.id,
    objective: cleanText(backlogItem.objective) || `Run the explicit ${strategyName} WFA route through the canonical walk-forward engine.`,
    hypothesis: `The explicit ${strategyName} WFA route can be evaluated as research_wfa evidence only if the canonical engine produces verified artifacts and out-of-sample metrics.`,
    strategy_rationale: cleanText(backlogItem.launch_readiness_note) || `This plan was compiled deterministically from a WFA-ready backlog item with an existing canonical config path.`,
    strategy_type: strategyName,
    market_family: cleanText(backlogItem.market_family) || "strategy_defined_market",
    instrument_scope: cleanText(backlogItem.instrument_scope) || cleanText(backlogItem.instrument_selection_rule) || "Instrument scope supplied by the WFA config route",
    timeframe: cleanText(backlogItem.timeframe) || "strategy-defined timeframe",
    priority: backlogItem.priority ?? 75,
    evidence_kind: "research_wfa",
    authority_layer: backlogItem.authority_layer ?? "python_research",
    candidate_id: backlogItem.candidate_id ?? null,
    lineage_id: backlogItem.lineage_id ?? `LINEAGE-${safeId(backlogItem.id ?? strategyName)}`,
    family_id: backlogItem.family_id ?? `FAMILY-${safeId(strategyName)}`,
    deployment_mode: backlogItem.deployment_mode ?? "research_only",
    dataset_requirements: dataRequirements.length > 0 ? dataRequirements : [wfaConfigPath],
    data_manifest_paths: dataManifestPaths,
    data_readiness_manifests: dataReadinessManifests,
    historical_depth_requirement: {
      target: cleanText(backlogItem.history_requirement) || cleanText(backlogItem.data_requirement) || "History depth defined by the canonical WFA config and available dataset route.",
      justification: "The backlog item already defines a concrete WFA route; deterministic planning should not block on an LLM when execution gates will verify data and artifacts."
    },
    source_plan: {
      allowed_source_families: [cleanText(backlogItem.data_source) || "existing_wfa_route"],
      primary_source_family: cleanText(backlogItem.data_source) || "existing_wfa_route",
      selection_reason: "Backlog item supplied an explicit canonical WFA config route and research-only evidence boundary."
    },
    scope_selection_rationale: cleanText(backlogItem.objective) || "Explicit WFA-ready backlog item selected this market, instrument, timeframe, and strategy route before planning.",
    data_acquisition: {
      status: "present",
      reason: "The deterministic compiler only records the explicit route; executor and validators must verify data availability before evidence can be accepted.",
      acquisition_method: cleanText(backlogItem.data_source) || "existing_wfa_route",
      sources: dataRequirements.length > 0 ? dataRequirements : [wfaConfigPath],
      commands: [],
      expected_outputs: dataRequirements.length > 0 ? dataRequirements : [wfaConfigPath]
    },
    inputs,
    implementation_steps: [
      `Inspect ${wfaConfigPath} and referenced strategy/data inputs before execution.`,
      `Run the canonical WFA command from the walk forward engine directory: ${command}`,
      "Collect WFA output artifacts, metrics, completed-window count, stdout/stderr, and an artifact manifest.",
      "Mark the run blocked or inconclusive if any required artifact or metric is missing."
    ],
    commands: [command],
    expected_artifacts: [
      `factory/runs/${runId}/execution-result.json`,
      `factory/runs/${runId}/artifact_manifest.json`,
      `factory/runs/${runId}/gate-results.json`,
      `factory/summaries/${runId}.md`
    ],
    advanced_wfa_config: {
      config_path: wfaConfigPath,
      expected_output_root: wfaConfigValidation.expected_output_root,
      planner_bypass: "deterministic_wfa_ready_compiler",
      research_wfa_preregistration: preregistrationSourceHash
    },
    evaluation_criteria: {
      status_gate: "Only accept executed research_wfa evidence when canonical WFA artifacts, observed metrics, and at least one completed walk-forward window are verified.",
      metrics: {
        min_wfa_windows: 1,
        min_trades: 1,
        min_evidence_score: 50
      },
      strategy_quality_gate: "Do not label a strategy promising merely because the worker canary executed. Promising research evidence generally requires at least 5 completed OOS windows, 50 trades, 5%+ annualized return or a strong aggregate-return proxy, and mostly consistent positive OOS windows.",
      min_evidence_score: 50
    },
    source_hashes: unique([...researchBrainSourceHashesForPlan, phase8dHypothesisSourceHash, preregistrationSourceHash].filter(Boolean).map((record) => JSON.stringify(record))).map((record) => JSON.parse(record)),
    research_wfa_preregistration: preregistrationSourceHash,
    fallback_if_blocked: [
      "If config or data is missing, mark blocked with exact missing path.",
      "If WFA exits nonzero or produces no trades/windows, mark inconclusive or blocked with captured logs.",
      "If artifacts cannot be verified from disk, do not claim executed evidence."
    ],
    notes: [
      "Compiled deterministically from a WFA-ready backlog item; no LLM planner authority was used.",
      "This plan is a proposal route only; execution, metrics, evidence, gates, and state remain deterministic/artifact-bound."
    ],
    planner_bypass: {
      compiler: "deterministic_wfa_ready_compiler_v1",
      reason: "explicit_research_wfa_route",
      wfa_config_path: wfaConfigPath,
      compiled_at: new Date().toISOString()
    }
  };

  return { compiled: true, plan };
}

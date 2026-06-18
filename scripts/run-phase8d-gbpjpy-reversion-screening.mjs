#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildPaths } from "../src/core/paths.mjs";
import { writeJsonAtomic } from "../src/core/fs-utils.mjs";
import { buildResearchWfaPreregistration, writeResearchWfaPreregistration } from "../src/core/research-wfa-preregistration.mjs";
import { validateHypothesisPacket, validateResearchSourceRecord } from "../src/core/researchbrain-artifacts.mjs";
import { compileWfaReadyPlan } from "../src/core/wfa-plan-compiler.mjs";
import { buildResearchWfaRunRequestFromPlan } from "../src/core/orchestrator.mjs";
import { buildPhase8DConsistencyLadderAdvisory } from "../src/core/verification.mjs";
import { validateExecutionArtifacts, validateExecutionResult } from "../src/core/validators.mjs";
import { runResearchWfaRunWorker } from "../src/workers/research-wfa-run-worker.mjs";
import { PHASE8D_SURVIVOR_FLOORS } from "../src/core/wfa-survivor-floors.mjs";

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key]) ]));
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function artifactRef(rootDir, repoPath, artifactType = null) {
  const ref = { path: repoPath, sha256: sha256File(path.join(rootDir, repoPath)) };
  if (artifactType) ref.artifact_type = artifactType;
  return ref;
}

function uniqueRefs(values) {
  const seen = new Set();
  return values.filter((value) => value && value.path && value.sha256).filter((value) => {
    const key = `${value.artifact_type ?? "artifact"}:${value.path}:${value.sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

const rootDir = process.cwd();
const paths = buildPaths(rootDir);
const observedAt = new Date().toISOString();
const stamp = observedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
const runId = `RUN-PHASE8D-GBPJPY-REVERSION-${stamp}`;
const candidateId = `CAND-PHASE8D-GBPJPY-REVERSION-${stamp}`;
const experimentId = `EXP-PHASE8D-GBPJPY-REVERSION-${stamp}`;
const lineageId = "LINEAGE-PHASE8D-GBPJPY-REVERSION";
const familyId = "gbpjpy_reversion";
const sourceDir = `factory/research/manual/PHASE8D-GBPJPY-REVERSION-${stamp}`;

const strategySourcePath = "walk forward engine/src/strategies/gbpjpy_reversion.py";
const strategyConfigPath = "walk forward engine/config/strategy_gbpjpy_reversion.json";
const wfaConfigPath = "walk forward engine/strategies/gbpjpy_reversion/wfa_config.yaml";
const dataPath = "walk forward engine/data/GBPJPY_M15_2015-2025/GBPJPY_M15_2015_2025.csv";
const universeSnapshotPath = "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json";
const terminalInventoryPath = "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json";
const repairRationale = "Pre-run mechanical feasibility repair: data.min_required_bars was reduced from 5000 to 2000 because the first 6-month GBPJPY M15 training split has 2500 bars and the first 3-month validation split has 3724 bars; no performance result was used.";
const runtimeCaptureRationale = "Pre-run mechanical runtime-capture repair: this WFA route emits large per-window logs, so the worker request max_buffer_bytes is raised to 134217728 without changing strategy logic, data, costs, WFA windows, or parameters.";

for (const requiredPath of [strategySourcePath, strategyConfigPath, wfaConfigPath, dataPath, universeSnapshotPath, terminalInventoryPath]) {
  if (!fs.existsSync(path.join(rootDir, requiredPath))) throw new Error(`Required Phase 8D screening input missing: ${requiredPath}`);
}

const sourceRecordPath = `${sourceDir}/source-record.json`;
const strategySourceRef = artifactRef(rootDir, strategySourcePath);
const strategyConfigRef = artifactRef(rootDir, strategyConfigPath);
const wfaConfigRef = artifactRef(rootDir, wfaConfigPath);
const dataRef = artifactRef(rootDir, dataPath);
const sourceRecord = {
  schema_version: "research_source_record_v1",
  evidence_kind: "stage0_research_discovery",
  authority_layer: "stage_0_discovery",
  source_id: `SRC-PHASE8D-GBPJPY-REVERSION-${stamp}`,
  source_type: "repo_strategy_source_config_data_and_mt5_universe_evidence",
  trust_tier: "medium_implementation_trust",
  url_or_path_or_doi: strategySourcePath,
  accessed_at: observedAt,
  content_hash_or_unavailable_reason: strategySourceRef.sha256,
  claims_extracted: [
    "The strategy implements GBPJPY London-session mean reversion after a 2.5 sigma Bollinger pierce with V-shaped wick rejection.",
    "The implementation maps H1 RSI from completed hourly candles and shifts entries to the next M15 bar to reduce look-ahead risk.",
    "GBPJPY is present in the FTMO terminal universe snapshot as a Forex symbol, making the hypothesis MT5/FTMO-relevant but not terminal-equivalent yet.",
    repairRationale,
    runtimeCaptureRationale
  ],
  limitations: [
    "Source support is repo-local implementation/config/data plus terminal-universe evidence, not independent external alpha research.",
    "The GBPJPY research CSV is not proven equivalent to MT5 terminal history; classify as mt5_relevant_unverified.",
    "The WFA route uses fixed structural parameters, so this screens mechanism validity rather than a broad optimizer search."
  ],
  disconfirming_relevance: [
    "Extreme Bollinger pierces can become trend continuation instead of mean reversion during strong JPY-cross moves.",
    "Session-time conversion, spread spikes, and JPY pip scaling can materially change future MT5 parity.",
    "A structurally plausible setup still fails if WFA return, trade count, or OOS consistency floors are not met."
  ],
  artifact: strategySourceRef,
  provider_provenance: {
    mode: "repo_local_strategy_source_plus_terminal_universe_snapshot",
    live_research: false,
    deterministic_capture: true
  },
  official_state_mutated: false,
  official_evidence_index_mutated: false,
  official_backlog_mutated: false,
  official_leaderboard_mutated: false
};
validateResearchSourceRecord(sourceRecord, { rootDir, requireExisting: true });
writeJsonAtomic(path.join(rootDir, sourceRecordPath), sourceRecord, paths);
const sourceRecordRef = { source_id: sourceRecord.source_id, ...artifactRef(rootDir, sourceRecordPath) };

const hypothesisPacketPath = `${sourceDir}/hypothesis-packet.json`;
const hypothesisPacket = {
  hypothesis_id: `HYP-PHASE8D-GBPJPY-REVERSION-${stamp}`,
  mechanism: "GBPJPY may overextend during the London session into a liquidity vacuum, piercing 2.5 sigma Bollinger extremes before reverting toward the mid-band when V-shaped rejection geometry and completed-H1 RSI context confirm exhaustion. This test screens the fixed existing WFA route without selecting it from historical performance.",
  falsifiable_prediction: "A valid GBPJPY liquidity-vacuum reversion candidate should clear all Phase 8D survivor floors on long M15 OOS WFA evidence after configured costs; otherwise it must be recorded as a non-survivor.",
  market_structure_assumption: "GBPJPY is an FTMO/MT5-listed FX cross with episodic London-session volatility and stop-run behavior. The current data route remains mt5_relevant_unverified until terminal-derived equivalence is proven.",
  instrument_scope: "GBPJPY M15, FTMO/MT5-listed Forex cross by terminal universe evidence, research-only until MT5 data equivalence is proven.",
  timeframe_candidate: "M15 intraday with completed-H1 RSI context",
  strategy_family: familyId,
  mt5_relevance_classification: "mt5_relevant_unverified",
  required_data: "GBPJPY M15 research OHLCV history from 2015-2025, the GBPJPYReversion source/config, and later terminal-derived equivalence before any MT5-bound claim.",
  expected_holding_period: "Intraday London-session mean reversion, exiting at mid-band, stop, or London session close.",
  expected_trade_frequency: "Medium frequency; no low-frequency exception is registered and the default 200-trade floor applies.",
  expected_failure_modes: [
    "Extreme pierces may continue directionally instead of reverting.",
    "Wick-geometry and H1 RSI filters may be too restrictive or unstable across regimes.",
    "Configured GBPJPY costs and slippage may erase any apparent reversion edge."
  ],
  invalidation_criteria: [
    "Reject as non-survivor if real WFA fails any Phase 8D survivor floor on completed OOS windows, total trades, return proxy, or positive OOS window ratio.",
    "Reject any deployment or Phase 8E implication unless a separate survivor exists with MT5 instrument equivalence and explicit operator authorization.",
    "Treat any post-result change to symbol, timeframe, cost, parameter space, or WFA config as a new denominator-tracked attempt."
  ],
  implementation_shape: "Use the existing gbpjpy_reversion WFA config with GBPJPYReversionStrategy and the fixed strategy_gbpjpy_reversion config; only the pre-run min_required_bars feasibility repair is allowed for this repaired denominator attempt.",
  execution_sensitivity: "Sensitive to London timezone/DST conversion, completed-H1 RSI mapping, Bollinger/ATR warmup, JPY pip scaling, spread and slippage assumptions, and session-close exit behavior.",
  mt5_ftmo_concerns: "The FTMO terminal universe contains GBPJPY, but the research CSV is not terminal-derived equivalence evidence; Phase 8E remains blocked regardless of Phase 8D metrics.",
  prior_related_lessons: [
    "Phase 8D screens pre-registered hypotheses and counts weak or failed attempts in the denominator.",
    "MT5 relevance is not the same as MT5 Strategy Tester parity or deployment readiness."
  ],
  prior_failed_patterns_checked: [
    "This attempt is not selected from a historical leaderboard winner list and does not change route settings after results.",
    repairRationale,
    runtimeCaptureRationale,
    "The attempt is not a low-frequency exception and must meet the default 200-trade floor."
  ],
  novelty_reason: "This is a materially distinct GBPJPY liquidity-vacuum reversion family, not another London breakout/sweep variant, using fixed structural parameters and audit-noted anti-lookahead implementation details.",
  disconfirming_evidence: [
    "The supporting source record is implementation-derived rather than independent external research.",
    "Prior GBPJPY London sweep/fade screening produced zero trades, so this related intraday FX-cross attempt must be treated as denominator evidence, not confirmation."
  ],
  proposed_experiment_shape: "Compile a deterministic Phase 8D research_wfa plan, run the canonical worker on gbpjpy_reversion, emit a candidate evidence packet and summary, then evaluate survivor floors with no positive labels unless all floors clear.",
  schema_version: "hypothesis_packet_v1",
  evidence_kind: "stage0_research_discovery",
  authority_layer: "stage_0_discovery",
  source_records: [sourceRecordRef],
  phase8a_universe_constraints: {
    universe_snapshot: artifactRef(rootDir, universeSnapshotPath),
    terminal_inventory: artifactRef(rootDir, terminalInventoryPath),
    terminal_symbol_evidence: "GBPJPY appears in the FTMO terminal universe snapshot/inventory, but data equivalence is not verified."
  },
  official_state_mutated: false,
  official_evidence_index_mutated: false,
  official_backlog_mutated: false,
  official_leaderboard_mutated: false,
  profitability_labels_created: false,
  deterministic_workers_bypassed: false
};
hypothesisPacket.content_hash = sha256Text(JSON.stringify(sortJson({ ...hypothesisPacket })));
validateHypothesisPacket(hypothesisPacket, { rootDir, requireExisting: true });
writeJsonAtomic(path.join(rootDir, hypothesisPacketPath), hypothesisPacket, paths);
const hypothesisPacketRef = artifactRef(rootDir, hypothesisPacketPath, "hypothesis_packet");

const preregistration = buildResearchWfaPreregistration({
  candidate_id: candidateId,
  registered_at: observedAt,
  registered_before_run_id: runId,
  hypothesis_packet_ref: hypothesisPacketRef,
  source_record_refs: [artifactRef(rootDir, sourceRecordPath, "research_source_record")],
  mechanism_summary: "Pre-register GBPJPY liquidity-vacuum reversion screening before WFA execution.",
  instrument_scope: hypothesisPacket.instrument_scope,
  timeframe_candidate: hypothesisPacket.timeframe_candidate,
  strategy_family: hypothesisPacket.strategy_family,
  expected_trade_frequency: hypothesisPacket.expected_trade_frequency,
  data_sources: [
    dataPath,
    "FTMO terminal universe snapshot lists GBPJPY, but MT5 data equivalence is not assumed."
  ],
  cost_assumptions: "Use only gbpjpy_reversion WFA config costs: fees 0.0003 and slippage 0.0001, no hidden overrides.",
  wfa_design: {
    config_path: wfaConfigPath,
    window_policy: "Use the canonical 6m training / 3m testing / 1m step WFA scheme encoded in the config with data.min_required_bars mechanically repaired to 2000 before this run.",
    repair_rationale: repairRationale,
    runtime_capture_rationale: runtimeCaptureRationale,
    performance_result_used_for_repair: false,
    optimizer_policy: "Use the existing fixed structural parameter route with 20 trial budget and count this attempt in the denominator."
  },
  denominator_tracking: {
    attempt_is_denominator_member: true,
    failed_blocked_repaired_rerun_counted: true,
    parameter_or_scope_change_creates_new_attempt: true,
    optimizer_trials_recorded: true
  },
  frozen_fields: [
    "mechanism_summary",
    "instrument_scope",
    "timeframe_candidate",
    "strategy_family",
    "expected_trade_frequency",
    "data_sources",
    "cost_assumptions",
    "wfa_design",
    "invalidation_criteria"
  ],
  invalidation_criteria: hypothesisPacket.invalidation_criteria
});
const preregistrationArtifact = writeResearchWfaPreregistration(paths, preregistration);

const backlogItem = {
  id: `IDEA-PHASE8D-GBPJPY-REVERSION-${stamp}`,
  title: "Phase 8D GBPJPY liquidity-vacuum reversion screening",
  objective: "Screen a pre-registered GBPJPY London-session liquidity-vacuum reversion hypothesis through deterministic WFA.",
  status: "ready",
  priority: 94,
  category: "screening",
  evidence_kind: "research_wfa",
  authority_layer: "python_research",
  candidate_stage: "Phase 8D screening",
  candidate_id: candidateId,
  lineage_id: lineageId,
  family_id: familyId,
  market_family: "forex",
  instrument_scope: hypothesisPacket.instrument_scope,
  timeframe: hypothesisPacket.timeframe_candidate,
  experiment_id: experimentId,
  data_requirement: dataPath,
  expected_wfa_config_path: wfaConfigPath,
  expected_strategy_source_path: strategySourcePath,
  expected_strategy_config_path: strategyConfigPath,
  manual_hypothesis_packet_path: hypothesisPacketRef.path,
  manual_hypothesis_packet_sha256: hypothesisPacketRef.sha256,
  research_wfa_preregistration: preregistrationArtifact,
  launch_readiness_note: "Production Phase 8D screening only; no Phase 8E implication without survivor plus MT5 equivalence and operator authorization."
};

const compiled = compileWfaReadyPlan({ backlogItem, rootDir, runId });
if (compiled.compiled !== true) throw new Error(`Phase 8D GBPJPY reversion candidate failed to compile: ${compiled.reason} | ${compiled.blocked_reason ?? "no blocked reason"}`);

const experimentPlanPath = path.join(rootDir, "factory", "experiments", `${experimentId}.plan.json`);
writeJsonAtomic(experimentPlanPath, compiled.plan, paths);

const request = buildResearchWfaRunRequestFromPlan({ plan: compiled.plan, runId, rootDir });
request.max_buffer_bytes = 128 * 1024 * 1024;
const executionResult = runResearchWfaRunWorker({ rootDir, request });
executionResult.source_hashes = uniqueRefs([...(executionResult.source_hashes ?? []), ...(compiled.plan.source_hashes ?? [])]);
executionResult.observations = {
  ...(executionResult.observations ?? {}),
  phase8d_screening_attempt: true,
  hypothesis_packet_path: hypothesisPacketRef.path,
  research_wfa_preregistration_path: preregistrationArtifact.path
};
validateExecutionResult(executionResult);
validateExecutionArtifacts(rootDir, executionResult);

const runDir = path.join(rootDir, "factory", "runs", runId);
const executionResultPath = path.join(runDir, "execution-result.json");
writeJsonAtomic(executionResultPath, executionResult, paths);

const parsedMetricsArtifact = executionResult.artifacts_created.find((artifact) => artifact.artifact_type === "parsed_wfa_metrics");
const parsedMetrics = parsedMetricsArtifact ? JSON.parse(fs.readFileSync(path.join(rootDir, parsedMetricsArtifact.path), "utf8")) : null;
const perWindowMetrics = Array.isArray(parsedMetrics?.per_window_metrics) ? parsedMetrics.per_window_metrics : [];
const successfulWindows = numeric(parsedMetrics?.metrics?.successful_windows) ?? perWindowMetrics.filter((item) => item?.success === true).length;
const totalWindows = numeric(parsedMetrics?.metrics?.total_windows) ?? successfulWindows;
const positiveWindows = perWindowMetrics.filter((item) => item?.success === true && numeric(item?.total_return_pct) !== null && numeric(item.total_return_pct) > 0).length;
const positiveWindowRatio = totalWindows > 0 ? Number((positiveWindows / totalWindows).toFixed(6)) : null;
const wfr = totalWindows > 0 ? Number((successfulWindows / totalWindows).toFixed(6)) : null;
const trades = numeric(parsedMetrics?.metrics?.total_trades);
const returnPct = numeric(parsedMetrics?.metrics?.aggregate_return_pct);
const floorFailures = [];
if ((successfulWindows ?? 0) < PHASE8D_SURVIVOR_FLOORS.minOosWindows) floorFailures.push("completed_oos_windows");
if ((trades ?? 0) < PHASE8D_SURVIVOR_FLOORS.minTrades) floorFailures.push("total_trades");
if ((returnPct ?? Number.NEGATIVE_INFINITY) < PHASE8D_SURVIVOR_FLOORS.minReturnPct) floorFailures.push("return_proxy_pct");
if ((positiveWindowRatio ?? Number.NEGATIVE_INFINITY) < PHASE8D_SURVIVOR_FLOORS.minPositiveWindowRatio) floorFailures.push("positive_oos_window_ratio");

const candidateEvidencePacket = {
  schema_version: "phase8d_candidate_evidence_packet_v1",
  run_id: runId,
  backlog_item_id: backlogItem.id,
  candidate_id: candidateId,
  lineage_id: lineageId,
  family_id: familyId,
  attempt_id: request.attempt_id,
  terminal_state: executionResult.status,
  evidence_kind: executionResult.evidence_kind,
  wfa_launched: Boolean(parsedMetricsArtifact),
  deterministic_worker_evidence_required: true,
  source_hashes: executionResult.source_hashes,
  preregistration_gate: { status: "satisfied_pre_run", artifact: preregistrationArtifact },
  source_quality_gate: { status: "manual_packet_medium_implementation_trust", source_record: artifactRef(rootDir, sourceRecordPath, "research_source_record") },
  denominator_context: {
    ...preregistration.denominator_tracking,
    denominator_artifact_status: executionResult.status === "executed" ? "preregistered_and_executed" : "preregistered_worker_terminal_nonexecuted",
    attempt_source: "phase8d_manual_packet_worker_execution",
    repair_rationale: repairRationale,
    runtime_capture_rationale: runtimeCaptureRationale,
    performance_result_used_for_repair: false
  },
  mt5_relevance: {
    classification: "mt5_relevant_unverified",
    terminal_symbol_seen: true,
    terminal_symbol: "GBPJPY",
    mt5_instrument_equivalence_verified: false,
    deployment_proximate_evidence: false
  },
  data_identity: {
    status: "known_research_input_mt5_relevant_unverified",
    known: true,
    artifact: artifactRef(rootDir, dataPath, "data_input")
  },
  wfa_metrics: {
    status: parsedMetricsArtifact ? "worker_terminal_artifact_backed" : "worker_terminal_without_parsed_metrics",
    windows: successfulWindows,
    trades,
    return_proxy_pct: returnPct,
    positive_oos_window_ratio: positiveWindowRatio,
    wfr
  },
  consistency_ladder_advisory: buildPhase8DConsistencyLadderAdvisory({ metrics: parsedMetrics?.metrics ?? {}, parsedMetrics }),
  survivor_floor_enforcement: {
    status: floorFailures.length > 0 ? "below_phase8d_survivor_floor" : "clears_phase8d_survivor_floor",
    failed_requirements: floorFailures,
    positive_or_survivor_label_allowed: floorFailures.length === 0
  },
  advisory_statistics: {
    status: "blocked_missing_inputs",
    dsr: { status: "blocked_missing_inputs" },
    pbo: { status: "blocked_missing_inputs" },
    cpcv: { status: "blocked_missing_inputs" },
    white_reality_check: { status: "blocked_missing_inputs" },
    promotion_authority: false,
    rejection_authority: false
  },
  phase8e_boundary: {
    phase8e_authorized: false,
    mt5_mql5_parity_deployment_work_started: false,
    tester_parity_claimed: false
  },
  blocked_reasons: executionResult.blocked_reason ? [executionResult.blocked_reason] : [],
  cited_artifacts: uniqueRefs([
    { artifact_type: "execution_result", path: repoRelative(rootDir, executionResultPath), sha256: sha256File(executionResultPath) },
    parsedMetricsArtifact ? { artifact_type: "parsed_wfa_metrics", path: parsedMetricsArtifact.path, sha256: parsedMetricsArtifact.sha256 } : null,
    { artifact_type: preregistrationArtifact.artifact_type, path: preregistrationArtifact.path, sha256: preregistrationArtifact.sha256 },
    hypothesisPacketRef,
    { artifact_type: "research_source_record", path: sourceRecordPath, sha256: sha256File(path.join(rootDir, sourceRecordPath)) },
    parsedMetrics?.metrics_artifact ? { artifact_type: parsedMetrics.metrics_artifact.artifact_type ?? "wfa_metrics_artifact", path: parsedMetrics.metrics_artifact.path, sha256: parsedMetrics.metrics_artifact.sha256 } : null
  ]),
  recorded_at: observedAt
};

const candidateEvidencePath = path.join(runDir, "phase8d-candidate-evidence-packet.json");
writeJsonAtomic(candidateEvidencePath, candidateEvidencePacket, paths);

const summaryPath = path.join(rootDir, "factory", "summaries", `${runId}.md`);
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, [
  `# ${runId}`,
  "",
  "Phase 8D GBPJPY liquidity-vacuum reversion screening.",
  "",
  `- Candidate: ${candidateId}`,
  `- Status: ${executionResult.status}`,
  `- Blocked reason: ${executionResult.blocked_reason ?? "none"}`,
  `- MT5 relevance: mt5_relevant_unverified; GBPJPY appears in terminal universe, but data equivalence is not verified`,
  `- Repair rationale: ${repairRationale}`,
  `- Runtime capture rationale: ${runtimeCaptureRationale}`,
  `- Windows: ${successfulWindows}`,
  `- Trades: ${trades}`,
  `- Return proxy pct: ${returnPct}`,
  `- Positive OOS window ratio: ${positiveWindowRatio}`,
  `- WFR: ${wfr}`,
  `- Survivor floor failures: ${floorFailures.join(", ") || "none"}`,
  "",
  "This is Phase 8D screening evidence only. It is not a Phase 8E authorization or MT5/MQL5 deployment claim."
].join("\n") + "\n", "utf8");

console.log(JSON.stringify({
  run_id: runId,
  candidate_id: candidateId,
  experiment_plan: repoRelative(rootDir, experimentPlanPath),
  preregistration: preregistrationArtifact.path,
  source_record: sourceRecordPath,
  hypothesis_packet: hypothesisPacketRef.path,
  execution_result: repoRelative(rootDir, executionResultPath),
  candidate_evidence_packet: repoRelative(rootDir, candidateEvidencePath),
  summary: repoRelative(rootDir, summaryPath),
  mt5_relevance_classification: "mt5_relevant_unverified",
  survivor_floor_failures: floorFailures,
  metrics: candidateEvidencePacket.wfa_metrics,
  phase8e_authorized: false
}, null, 2));

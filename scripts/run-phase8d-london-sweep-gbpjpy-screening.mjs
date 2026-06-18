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
const runId = `RUN-PHASE8D-LONDON-SWEEP-GBPJPY-${stamp}`;
const candidateId = `CAND-PHASE8D-LONDON-SWEEP-GBPJPY-${stamp}`;
const experimentId = `EXP-PHASE8D-LONDON-SWEEP-GBPJPY-${stamp}`;
const lineageId = "LINEAGE-PHASE8D-LONDON-SWEEP-GBPJPY";
const familyId = "london_sweep_gbpjpy";
const sourceDir = `factory/research/manual/PHASE8D-LONDON-SWEEP-GBPJPY-${stamp}`;

const strategySourcePath = "walk forward engine/src/strategies/london_sweep.py";
const strategyConfigPath = "walk forward engine/config/strategy_london_sweep_fade.json";
const wfaConfigPath = "walk forward engine/strategies/london_sweep_gbpjpy/wfa_config.yaml";
const dataPath = "walk forward engine/data/GBPJPY_M15_2015-2025/GBPJPY_M15_2015_2025.csv";
const universeSnapshotPath = "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json";
const terminalInventoryPath = "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json";

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
  source_id: `SRC-PHASE8D-LONDON-SWEEP-GBPJPY-${stamp}`,
  source_type: "repo_strategy_source_config_data_and_mt5_universe_evidence",
  trust_tier: "medium_implementation_trust",
  url_or_path_or_doi: strategySourcePath,
  accessed_at: observedAt,
  content_hash_or_unavailable_reason: strategySourceRef.sha256,
  claims_extracted: [
    "The strategy implementation defines a London-session liquidity sweep and fade mechanism after the Asia range is established.",
    "GBPJPY is present in the FTMO terminal universe snapshot as a Forex symbol, making the hypothesis MT5/FTMO-relevant but not terminal-equivalent yet.",
    "The configured route uses GBPJPY M15 research data from 2015-2025 and must be judged only by pre-registered WFA evidence."
  ],
  limitations: [
    "Source support is repo-local implementation/config/data plus terminal-universe evidence, not independent external alpha research.",
    "The GBPJPY research CSV is not proven equivalent to MT5 terminal history; classify as mt5_relevant_unverified.",
    "Session timezone, broker DST, spread spikes, and JPY pip scaling can materially change future MT5 parity."
  ],
  disconfirming_relevance: [
    "Liquidity sweeps can become continuation rather than fade signals after costs.",
    "JPY-cross volatility can produce large adverse excursions and unstable window-level results.",
    "A structural intraday mechanism still fails if WFA return, trade count, or OOS consistency floors are not met."
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
  hypothesis_id: `HYP-PHASE8D-LONDON-SWEEP-GBPJPY-${stamp}`,
  mechanism: "GBPJPY may overextend through the Asia-session high or low during the London liquidity handoff and then mean-revert after stop-liquidity is swept. This pre-registered test evaluates the existing London sweep/fade WFA route without selecting it because of historical performance.",
  falsifiable_prediction: "A valid GBPJPY London sweep/fade candidate should clear all Phase 8D survivor floors on long M15 OOS WFA evidence after configured costs; otherwise it must be recorded as a non-survivor.",
  market_structure_assumption: "GBPJPY is a liquid FTMO/MT5-listed FX cross, and London-session liquidity can interact with the prior Asian range. The current data route remains mt5_relevant_unverified until terminal-derived equivalence is proven.",
  instrument_scope: "GBPJPY M15, FTMO/MT5-listed Forex cross by terminal universe evidence, research-only until MT5 data equivalence is proven.",
  timeframe_candidate: "M15 intraday",
  strategy_family: familyId,
  mt5_relevance_classification: "mt5_relevant_unverified",
  required_data: "GBPJPY M15 research OHLCV history from 2015-2025, the LondonSweepStrategy source/config, and later terminal-derived equivalence before any MT5-bound claim.",
  expected_holding_period: "Intraday London-session fade with hard same-day exit.",
  expected_trade_frequency: "Medium frequency, structurally capped near one trade per active trading day; no low-frequency exception is registered.",
  expected_failure_modes: [
    "London sweep events may continue instead of reverting, especially on high-volatility JPY-cross days.",
    "JPY pip scaling, timestamp alignment, DST, and broker session definitions may weaken or invalidate the route.",
    "Configured costs and spread/slippage assumptions may erase any apparent edge."
  ],
  invalidation_criteria: [
    "Reject as non-survivor if real WFA fails any Phase 8D survivor floor on completed OOS windows, total trades, return proxy, or positive OOS window ratio.",
    "Reject any deployment or Phase 8E implication unless a separate survivor exists with MT5 instrument equivalence and explicit operator authorization.",
    "Treat any post-result change to symbol, timeframe, cost, parameter space, or WFA config as a new denominator-tracked attempt."
  ],
  implementation_shape: "Use the existing london_sweep_gbpjpy WFA config with LondonSweepStrategy and the existing strategy_london_sweep_fade config; do not alter parameters after preregistration.",
  execution_sensitivity: "Sensitive to Asia/London session boundaries, JPY pip-size scaling, spread and slippage assumptions, one-trade-per-day behavior, and hard-exit timing.",
  mt5_ftmo_concerns: "The FTMO terminal universe contains GBPJPY, but the research CSV is not terminal-derived equivalence evidence; Phase 8E remains blocked regardless of Phase 8D metrics.",
  prior_related_lessons: [
    "Phase 8D screens pre-registered hypotheses and counts weak or failed attempts in the denominator.",
    "MT5 relevance is not the same as MT5 Strategy Tester parity or deployment readiness."
  ],
  prior_failed_patterns_checked: [
    "This attempt is not selected from a historical leaderboard winner list and does not change route settings after results.",
    "The attempt is not a low-frequency exception and must meet the default 200-trade floor."
  ],
  novelty_reason: "This is the next operational Phase 8D production screen after EURUSD London breakout, using a materially distinct liquidity-sweep fade family on an FTMO-listed FX cross.",
  disconfirming_evidence: [
    "The supporting source record is implementation-derived rather than independent external research.",
    "Related London-session ideas have already failed Phase 8D floors, so this run is expected to produce objective denominator evidence, not confirmation."
  ],
  proposed_experiment_shape: "Compile a deterministic Phase 8D research_wfa plan, run the canonical worker on london_sweep_gbpjpy, emit a candidate evidence packet and summary, then evaluate survivor floors with no positive labels unless all floors clear.",
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
  mechanism_summary: "Pre-register GBPJPY London sweep/fade screening before WFA execution.",
  instrument_scope: hypothesisPacket.instrument_scope,
  timeframe_candidate: hypothesisPacket.timeframe_candidate,
  strategy_family: hypothesisPacket.strategy_family,
  expected_trade_frequency: hypothesisPacket.expected_trade_frequency,
  data_sources: [
    dataPath,
    "FTMO terminal universe snapshot lists GBPJPY, but MT5 data equivalence is not assumed."
  ],
  cost_assumptions: "Use only london_sweep_gbpjpy WFA config costs: fees 0.0001 and slippage 0.0001, no hidden overrides.",
  wfa_design: {
    config_path: wfaConfigPath,
    window_policy: "Use the canonical 6m training / 1m testing / 1m step WFA scheme encoded in the config.",
    optimizer_policy: "Use the existing 30-trial route and count this attempt in the denominator."
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
  id: `IDEA-PHASE8D-LONDON-SWEEP-GBPJPY-${stamp}`,
  title: "Phase 8D GBPJPY London sweep/fade screening",
  objective: "Screen a pre-registered GBPJPY London liquidity-sweep fade hypothesis through deterministic WFA.",
  status: "ready",
  priority: 96,
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
if (compiled.compiled !== true) throw new Error(`Phase 8D London sweep GBPJPY candidate failed to compile: ${compiled.reason} | ${compiled.blocked_reason ?? "no blocked reason"}`);

const experimentPlanPath = path.join(rootDir, "factory", "experiments", `${experimentId}.plan.json`);
writeJsonAtomic(experimentPlanPath, compiled.plan, paths);

const request = buildResearchWfaRunRequestFromPlan({ plan: compiled.plan, runId, rootDir });
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
if (!parsedMetricsArtifact) throw new Error("Executed London sweep GBPJPY screening is missing parsed_wfa_metrics artifact.");
const parsedMetrics = JSON.parse(fs.readFileSync(path.join(rootDir, parsedMetricsArtifact.path), "utf8"));
const perWindowMetrics = Array.isArray(parsedMetrics.per_window_metrics) ? parsedMetrics.per_window_metrics : [];
const successfulWindows = numeric(parsedMetrics.metrics?.successful_windows) ?? perWindowMetrics.filter((item) => item?.success === true).length;
const totalWindows = numeric(parsedMetrics.metrics?.total_windows) ?? successfulWindows;
const positiveWindows = perWindowMetrics.filter((item) => item?.success === true && numeric(item?.total_return_pct) !== null && numeric(item.total_return_pct) > 0).length;
const positiveWindowRatio = totalWindows > 0 ? Number((positiveWindows / totalWindows).toFixed(6)) : null;
const wfr = totalWindows > 0 ? Number((successfulWindows / totalWindows).toFixed(6)) : null;
const trades = numeric(parsedMetrics.metrics?.total_trades);
const returnPct = numeric(parsedMetrics.metrics?.aggregate_return_pct);
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
  wfa_launched: executionResult.status === "executed",
  deterministic_worker_evidence_required: true,
  source_hashes: executionResult.source_hashes,
  preregistration_gate: { status: "satisfied_pre_run", artifact: preregistrationArtifact },
  source_quality_gate: { status: "manual_packet_medium_implementation_trust", source_record: artifactRef(rootDir, sourceRecordPath, "research_source_record") },
  denominator_context: {
    ...preregistration.denominator_tracking,
    denominator_artifact_status: "preregistered_and_executed",
    attempt_source: "phase8d_manual_packet_worker_execution"
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
    status: "worker_executed_artifact_backed",
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
  blocked_reasons: [],
  cited_artifacts: uniqueRefs([
    { artifact_type: "execution_result", path: repoRelative(rootDir, executionResultPath), sha256: sha256File(executionResultPath) },
    { artifact_type: "parsed_wfa_metrics", path: parsedMetricsArtifact.path, sha256: parsedMetricsArtifact.sha256 },
    { artifact_type: preregistrationArtifact.artifact_type, path: preregistrationArtifact.path, sha256: preregistrationArtifact.sha256 },
    hypothesisPacketRef,
    { artifact_type: "research_source_record", path: sourceRecordPath, sha256: sha256File(path.join(rootDir, sourceRecordPath)) },
    parsedMetrics.metrics_artifact ? { artifact_type: parsedMetrics.metrics_artifact.artifact_type ?? "wfa_metrics_artifact", path: parsedMetrics.metrics_artifact.path, sha256: parsedMetrics.metrics_artifact.sha256 } : null
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
  "Phase 8D GBPJPY London sweep/fade screening.",
  "",
  `- Candidate: ${candidateId}`,
  `- Status: ${executionResult.status}`,
  `- Blocked reason: ${executionResult.blocked_reason ?? "none"}`,
  `- MT5 relevance: mt5_relevant_unverified; GBPJPY appears in terminal universe, but data equivalence is not verified`,
  `- Windows: ${successfulWindows}`,
  `- Trades: ${trades}`,
  `- Return proxy pct: ${returnPct}`,
  `- Positive OOS window ratio: ${positiveWindowRatio}`,
  `- WFR: ${wfr}`,
  `- Survivor floor failures: ${floorFailures.join(", ") || "none"}`,
  "",
  "This is Phase 8D screening evidence only. It is not a Phase 8E authorization or MT5/MQL5 deployment claim."
].join("\n") + "\n", "utf8");

if (executionResult.status !== "executed") throw new Error(`Phase 8D London sweep GBPJPY screening did not execute real WFA: ${executionResult.status} | ${executionResult.blocked_reason ?? "no blocked reason"}`);

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

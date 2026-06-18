#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildPaths } from "../src/core/paths.mjs";
import { writeJsonAtomic } from "../src/core/fs-utils.mjs";
import { buildResearchWfaPreregistration, writeResearchWfaPreregistration } from "../src/core/research-wfa-preregistration.mjs";
import { validateHypothesisPacket } from "../src/core/researchbrain-artifacts.mjs";
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

function sourceArtifactRef(rootDir, repoPath) {
  return {
    path: repoPath,
    sha256: sha256File(path.join(rootDir, repoPath))
  };
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
const runId = `RUN-PHASE8D-SURVIVOR-FLOOR-${stamp}`;
const candidateId = `CAND-PHASE8D-SURVIVOR-FLOOR-${stamp}`;
const experimentId = `EXP-PHASE8D-SURVIVOR-FLOOR-${stamp}`;
const lineageId = "LINEAGE-PHASE8D-SURVIVOR-FLOOR-CANARY";
const familyId = "volatility_regime";

const fixturePacketPath = "factory/research/runs/RESEARCHBRAIN-STAGE0-DRYRUN-20260520T0927Z/hypotheses/HYP-STAGE0-FIXTURE-001.json";
const fixturePacket = JSON.parse(fs.readFileSync(path.join(rootDir, fixturePacketPath), "utf8"));
const fixtureSourceRef = fixturePacket.source_records[0];

const manualPacketPath = `factory/research/manual/PHASE8D-SURVIVOR-FLOOR-CANARY-${stamp}/hypothesis-packet.json`;
const manualPacket = {
  hypothesis_id: `HYP-PHASE8D-SURVIVOR-FLOOR-${stamp}`,
  mechanism: "Volatility compression followed by directional regime expansion can be tested as a falsifiable continuation mechanism on BTCUSD H1. This canary intentionally routes an existing volatility-regime strategy through real WFA screening so Phase 8D can prove that weak executed candidates remain below survivor labels.",
  falsifiable_prediction: "If this proxy route has insufficient edge, the real deterministic WFA run will remain below the Phase 8D survivor floors on completed OOS windows, trade count, return proxy, or positive-window ratio, and the candidate must stay below promising/passed/success labels.",
  market_structure_assumption: "BTCUSD crypto-CFD style instruments can exhibit volatility compression and post-compression expansion regimes, but this canary remains research-only and does not assume deployment equivalence from proxy data.",
  instrument_scope: "BTCUSD FTMO/MT5 crypto CFD proxy route only; research-only unless later MT5 equivalence is independently verified.",
  timeframe_candidate: "H1 candidate",
  strategy_family: "volatility_regime",
  mt5_relevance_classification: "mt5_relevant_unverified",
  required_data: "H1 BTCUSD proxy history suitable for the existing volatility_regime WFA config, with any later MT5-bound claim requiring separate terminal-backed equivalence.",
  expected_holding_period: "Intraday to multi-day depending on regime persistence.",
  expected_trade_frequency: "Low-to-medium frequency; no low-frequency exception is pre-registered for this canary.",
  expected_failure_modes: [
    "Compression signals may not produce enough OOS trades to approach the survivor floor.",
    "Proxy BTC spot/perpetual history may not map tightly enough to FTMO BTCUSD CFD behavior.",
    "Spread, slippage, and post-compression whipsaw can erase any apparent breakout edge."
  ],
  invalidation_criteria: [
    "The real WFA run finishes below the Phase 8D survivor floors on windows, trades, return proxy, or positive OOS window ratio.",
    "The executed route cannot produce artifact-backed metrics and denominator diagnostics through the deterministic worker path."
  ],
  implementation_shape: "Use the existing volatility_regime strategy/config/WFA route with no custom code changes; treat this as a bounded survivor-floor enforcement canary rather than alpha research.",
  execution_sensitivity: "Sensitive to compression threshold, EMA trend filter, cost assumptions, and the use of proxy crypto data instead of terminal-backed MT5 history.",
  mt5_ftmo_concerns: "Current route uses proxy BTCUSDT history rather than terminal-derived BTCUSD CFD history; any survivor would still remain research-only until separate MT5 equivalence evidence exists.",
  prior_related_lessons: [
    "Phase 8D survivor floors are validation gates, not optimization targets.",
    "Blocked or weak attempts must remain in the denominator even when no candidate survives."
  ],
  prior_failed_patterns_checked: [
    "This canary is pre-registered specifically to verify below-floor enforcement, not to revive historical leaderboard winners or parameter roulette."
  ],
  novelty_reason: "Creates an explicit executed Phase 8D screening canary for survivor-floor enforcement using the real deterministic WFA worker.",
  disconfirming_evidence: [
    "The supporting source artifact is a fixture test-double rather than live external research.",
    "Proxy data and strategy-route reuse make this unsuitable for any promotion or deployment conclusion."
  ],
  proposed_experiment_shape: "Compile a deterministic Phase 8D research_wfa plan with a hash-backed manual packet and pre-registration artifact, run the canonical WFA worker on volatility_regime, and accept only the gate-enforcement conclusion that a below-floor result stays below survivor labels.",
  schema_version: "hypothesis_packet_v1",
  evidence_kind: "stage0_research_discovery",
  authority_layer: "stage_0_discovery",
  source_records: [fixtureSourceRef],
  phase8a_universe_constraints: fixturePacket.phase8a_universe_constraints,
  official_state_mutated: false,
  official_evidence_index_mutated: false,
  official_backlog_mutated: false,
  official_leaderboard_mutated: false,
  profitability_labels_created: false,
  deterministic_workers_bypassed: false
};
manualPacket.content_hash = sha256Text(JSON.stringify(sortJson({ ...manualPacket })));
validateHypothesisPacket(manualPacket, { rootDir, requireExisting: true });
writeJsonAtomic(path.join(rootDir, manualPacketPath), manualPacket, paths);
const manualPacketRef = sourceArtifactRef(rootDir, manualPacketPath);

const preregistration = buildResearchWfaPreregistration({
  candidate_id: candidateId,
  registered_at: observedAt,
  registered_before_run_id: runId,
  hypothesis_packet_ref: manualPacketRef,
  source_record_refs: [fixtureSourceRef],
  mechanism_summary: "Pre-register the volatility_regime BTCUSD H1 proxy route as a bounded survivor-floor enforcement canary before the executed WFA run.",
  instrument_scope: manualPacket.instrument_scope,
  timeframe_candidate: manualPacket.timeframe_candidate,
  strategy_family: manualPacket.strategy_family,
  expected_trade_frequency: manualPacket.expected_trade_frequency,
  data_sources: [
    "walk forward engine/data/binance_btcusdt_1h_deep.csv proxy research dataset",
    "No MT5-bound claim without later terminal-backed equivalence"
  ],
  cost_assumptions: "Use the existing volatility_regime WFA config costs only: fees 0.0006 and slippage 0.0002 with no uplift or hidden overrides.",
  wfa_design: {
    config_path: "walk forward engine/strategies/volatility_regime/wfa_config.yaml",
    window_policy: "Use the canonical 3m/1m/1m walk-forward scheme already encoded in the config.",
    optimizer_policy: "Keep the existing 100-trial config and count all outcomes in the denominator."
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
  invalidation_criteria: manualPacket.invalidation_criteria
});
const preregistrationArtifact = writeResearchWfaPreregistration(paths, preregistration);

const backlogItem = {
  id: `IDEA-PHASE8D-SURVIVOR-FLOOR-${stamp}`,
  title: "Phase 8D survivor-floor enforcement canary",
  objective: "Run one real preregistered Phase 8D WFA screening attempt and verify that a weak executed result stays below survivor labels.",
  status: "ready",
  priority: 97,
  category: "validation",
  evidence_kind: "research_wfa",
  authority_layer: "python_research",
  candidate_stage: "Phase 8D screening",
  candidate_id: candidateId,
  lineage_id: lineageId,
  family_id: familyId,
  market_family: "mt5_proxy",
  instrument_scope: manualPacket.instrument_scope,
  timeframe: manualPacket.timeframe_candidate,
  experiment_id: experimentId,
  data_requirement: "walk forward engine/data/binance_btcusdt_1h_deep.csv",
  expected_wfa_config_path: "walk forward engine/strategies/volatility_regime/wfa_config.yaml",
  expected_strategy_source_path: "walk forward engine/src/strategies/volatility_regime.py",
  expected_strategy_config_path: "walk forward engine/config/strategy_volatility_regime.json",
  manual_hypothesis_packet_path: manualPacketRef.path,
  manual_hypothesis_packet_sha256: manualPacketRef.sha256,
  research_wfa_preregistration: preregistrationArtifact,
  launch_readiness_note: "Bounded survivor-floor enforcement canary only; no promotion or MT5 parity claim allowed."
};

const compiled = compileWfaReadyPlan({ backlogItem, rootDir, runId });
if (compiled.compiled !== true) {
  throw new Error(`Phase 8D survivor-floor canary failed to compile: ${compiled.reason} | ${compiled.blocked_reason ?? "no blocked reason"}`);
}

const experimentPlanPath = path.join(rootDir, "factory", "experiments", `${experimentId}.plan.json`);
writeJsonAtomic(experimentPlanPath, compiled.plan, paths);

const request = buildResearchWfaRunRequestFromPlan({ plan: compiled.plan, runId, rootDir });
const executionResult = runResearchWfaRunWorker({ rootDir, request });
executionResult.source_hashes = uniqueRefs([...(executionResult.source_hashes ?? []), ...(compiled.plan.source_hashes ?? [])]);
executionResult.observations = {
  ...(executionResult.observations ?? {}),
  phase8d_screening_attempt: true,
  hypothesis_packet_path: manualPacketRef.path,
  research_wfa_preregistration_path: preregistrationArtifact.path
};
validateExecutionResult(executionResult);
validateExecutionArtifacts(rootDir, executionResult);

const runDir = path.join(rootDir, "factory", "runs", runId);
const executionResultPath = path.join(runDir, "execution-result.json");
writeJsonAtomic(executionResultPath, executionResult, paths);

const parsedMetricsArtifact = executionResult.artifacts_created.find((artifact) => artifact.artifact_type === "parsed_wfa_metrics");
if (!parsedMetricsArtifact) throw new Error("Executed Phase 8D canary is missing parsed_wfa_metrics artifact.");
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
  preregistration_gate: {
    status: "satisfied_pre_run",
    artifact: preregistrationArtifact
  },
  source_quality_gate: {
    status: "not_applicable_manual_packet"
  },
  denominator_context: {
    ...preregistration.denominator_tracking,
    denominator_artifact_status: "preregistered_and_executed",
    attempt_source: "phase8d_manual_packet_worker_execution"
  },
  data_identity: {
    status: executionResult.source_hashes.some((artifact) => artifact.artifact_type === "data_input") ? "known_proxy_input" : "unknown",
    known: executionResult.source_hashes.some((artifact) => artifact.artifact_type === "data_input"),
    artifact: executionResult.source_hashes.find((artifact) => artifact.artifact_type === "data_input") ?? null
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
    { artifact_type: "hypothesis_packet", path: manualPacketRef.path, sha256: manualPacketRef.sha256 },
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
  "Phase 8D survivor-floor enforcement canary.",
  "",
  `- Candidate: ${candidateId}`,
  `- Status: ${executionResult.status}`,
  `- Blocked reason: ${executionResult.blocked_reason ?? "none"}`,
  `- Windows: ${successfulWindows}`,
  `- Trades: ${trades}`,
  `- Return proxy pct: ${returnPct}`,
  `- Positive OOS window ratio: ${positiveWindowRatio}`,
  `- WFR: ${wfr}`,
  `- Survivor floor failures: ${floorFailures.join(", ") || "none"}`,
  "",
  "This is a bounded validation canary only. It is not a profitability claim and does not authorize Phase 8E."
].join("\n") + "\n", "utf8");

if (executionResult.status !== "executed") {
  throw new Error(`Phase 8D survivor-floor canary did not execute real WFA: ${executionResult.status} | ${executionResult.blocked_reason ?? "no blocked reason"}`);
}

console.log(JSON.stringify({
  run_id: runId,
  candidate_id: candidateId,
  experiment_plan: repoRelative(rootDir, experimentPlanPath),
  preregistration: preregistrationArtifact.path,
  execution_result: repoRelative(rootDir, executionResultPath),
  candidate_evidence_packet: repoRelative(rootDir, candidateEvidencePath),
  summary: repoRelative(rootDir, summaryPath),
  survivor_floor_failures: floorFailures,
  metrics: candidateEvidencePacket.wfa_metrics
}, null, 2));

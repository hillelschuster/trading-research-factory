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
import { buildPhase8DConsistencyLadderAdvisory, buildResearchWfaPromotionGate } from "../src/core/verification.mjs";
import { validateExecutionArtifacts, validateExecutionResult } from "../src/core/validators.mjs";
import { validateCanonicalWfaConfig } from "../src/core/wfa-config-contract.mjs";
import { runResearchWfaRunWorker } from "../src/workers/research-wfa-run-worker.mjs";
import { PHASE8D_SURVIVOR_FLOORS } from "../src/core/wfa-survivor-floors.mjs";

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]))
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
const runId = `RUN-PHASE8D-FX-FIX-REVERSAL-EURUSD-${stamp}`;
const candidateId = `CAND-PHASE8D-FX-FIX-REVERSAL-EURUSD-${stamp}`;
const experimentId = `EXP-PHASE8D-FX-FIX-REVERSAL-EURUSD-${stamp}`;
const lineageId = "LINEAGE-PHASE8D-FX-FIX-REVERSAL-EURUSD";
const familyId = "fx_fix_reversal_eurusd";
const sourceDir = `factory/research/manual/PHASE8D-FX-FIX-REVERSAL-EURUSD-${stamp}`;

const strategySourcePath = "walk forward engine/src/strategies/fx_fix_reversal_eurusd.py";
const strategyConfigPath = "walk forward engine/config/strategy_fx_fix_reversal_eurusd.json";
const wfaConfigPath = "walk forward engine/strategies/fx_fix_reversal_eurusd/wfa_config.yaml";
const dataPath = "walk forward engine/data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv";
const universeSnapshotPath = "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json";
const terminalInventoryPath = "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json";
const sourceUrl = "https://www.fsb.org/2014/09/r_140930/";

for (const requiredPath of [strategySourcePath, strategyConfigPath, wfaConfigPath, dataPath, universeSnapshotPath, terminalInventoryPath]) {
  if (!fs.existsSync(path.join(rootDir, requiredPath))) throw new Error(`Required Phase 8D screening input missing: ${requiredPath}`);
}

const canonicalValidation = validateCanonicalWfaConfig({ rootDir, wfaConfigPath });
if (!canonicalValidation.valid) {
  const runDir = path.join(rootDir, "factory", "runs", runId);
  const blocked = {
    schema_version: "phase8d_blocked_screening_attempt_v1",
    run_id: runId,
    candidate_id: candidateId,
    lineage_id: lineageId,
    family_id: familyId,
    status: "blocked",
    blocked_stage: "pre_worker_wfa_config_contract",
    blocked_reasons: canonicalValidation.errors,
    wfa_config_path: wfaConfigPath,
    validation: canonicalValidation,
    denominator_member: true,
    phase8e_authorized: false,
    recorded_at: observedAt
  };
  writeJsonAtomic(path.join(runDir, "phase8d-blocked-config-validation.json"), blocked, paths);
  console.log(JSON.stringify(blocked, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.join(rootDir, sourceDir), { recursive: true });
const sourceExcerptPath = `${sourceDir}/source-excerpt.md`;
const sourceExcerpt = [
  "# Source Excerpt",
  "",
  `URL: ${sourceUrl}`,
  "",
  "Captured claims from the Financial Stability Board Final Report on Foreign Exchange Benchmarks, 30 September 2014:",
  "",
  "- The report identifies the WM/Reuters 4pm London fix as a pre-eminent FX benchmark used by market participants.",
  "- The report says reform work was initiated after concerns about FX benchmark integrity, particularly incentives linked to the structure of trading around benchmark fixings.",
  "- The report's recommendation areas include execution of fix trades and behaviour of market participants around major FX benchmarks, primarily the WMR 4pm London fix.",
  "- These claims support a market-structure mechanism: benchmark-fixing windows can concentrate FX execution flow and may create testable short-horizon footprints.",
  "",
  "This excerpt is a source-backed mechanism record only. It does not claim EURUSD profitability, MT5 data equivalence, or Phase 8E readiness."
].join("\n") + "\n";
fs.writeFileSync(path.join(rootDir, sourceExcerptPath), sourceExcerpt, "utf8");

const sourceRecordPath = `${sourceDir}/source-record.json`;
const strategySourceRef = artifactRef(rootDir, strategySourcePath);
const strategyConfigRef = artifactRef(rootDir, strategyConfigPath);
const wfaConfigRef = artifactRef(rootDir, wfaConfigPath);
const dataRef = artifactRef(rootDir, dataPath);
const sourceExcerptRef = artifactRef(rootDir, sourceExcerptPath, "research_source_excerpt");

const sourceRecord = {
  schema_version: "research_source_record_v1",
  evidence_kind: "stage0_research_discovery",
  authority_layer: "stage_0_discovery",
  source_id: `SRC-PHASE8D-FX-FIX-REVERSAL-EURUSD-${stamp}`,
  source_type: "web_captured_source_plus_repo_implementation",
  trust_tier: "high_research_trust",
  url_or_path_or_doi: sourceUrl,
  accessed_at: observedAt,
  content_hash_or_unavailable_reason: sourceExcerptRef.sha256,
  claims_extracted: [
    "The FSB report identifies the WMR 4pm London fix as a pre-eminent FX benchmark.",
    "The report states that concerns about benchmark integrity were linked to incentives around the structure of trading near benchmark fixings.",
    "The report covers execution of fix trades and behaviour around major FX benchmarks, primarily the WMR 4pm London fix.",
    "The repo implementation maps this mechanism to an EURUSD M15 benchmark-fixing-window screen without claiming MT5 data equivalence or profitability."
  ],
  limitations: [
    "The source supports benchmark-fixing flow concentration, not a specific profitable EURUSD trading rule.",
    "The WMR fix is London-time based; this screen approximates DST with UTC hour choices rather than official calendar-aware fix timestamps.",
    "The screen uses OHLCV and tick-volume proxies only; it does not observe actual fix orders or dealer inventory.",
    "The current CSV is research data and does not prove FTMO terminal history equivalence."
  ],
  disconfirming_relevance: [
    "Post-reform benchmark execution practices may have reduced predictable fix-window price pressure.",
    "Execution flow can be anticipatory, hedged, or absorbed before M15 bars show a stable signal.",
    "Benchmark effects can be unstable, crowd-sensitive, and vulnerable to transaction costs."
  ],
  artifact: sourceExcerptRef,
  provider_provenance: {
    mode: "manual_phase8d_packet_from_live_webfetch_and_repo_strategy",
    live_research: true,
    deterministic_capture: true,
    source_url: sourceUrl,
    strategy_source: strategySourceRef,
    strategy_config: strategyConfigRef,
    wfa_config: wfaConfigRef
  },
  official_state_mutated: false,
  official_evidence_index_mutated: false,
  official_backlog_mutated: false,
  official_leaderboard_mutated: false,
  profitability_labels_created: false,
  deterministic_workers_bypassed: false
};
validateResearchSourceRecord(sourceRecord, { rootDir, requireExisting: true });
writeJsonAtomic(path.join(rootDir, sourceRecordPath), sourceRecord, paths);
const sourceRecordRef = { source_id: sourceRecord.source_id, ...artifactRef(rootDir, sourceRecordPath) };

const hypothesisPacketPath = `${sourceDir}/hypothesis-packet.json`;
const hypothesisPacket = {
  hypothesis_id: `HYP-PHASE8D-FX-FIX-REVERSAL-EURUSD-${stamp}`,
  mechanism: "Benchmark fix-related execution can concentrate FX flow around the WMR London 4pm fixing window. EURUSD M15 may show a short-horizon post-fix continuation or reversal footprint conditioned on pre-fix momentum, tick-volume regime, and ATR regime.",
  falsifiable_prediction: "A pre-registered EURUSD M15 FX-fix candidate should clear the active Phase 8D research WFA promotion gate after configured costs; otherwise it remains denominator-counted non-survivor evidence.",
  market_structure_assumption: "EURUSD is a liquid FTMO/MT5 symbol, and benchmark-related FX execution can cluster near WMR fix windows, but this Phase 8D screen does not assume terminal-history equivalence or executable edge.",
  instrument_scope: "EURUSD M15 FTMO/MT5-relevant research screen using historical EURUSD M15 OHLCV CSV; MT5 instrument equivalence remains unverified.",
  timeframe_candidate: "M15 WMR London 4pm FX benchmark-fixing window continuation/fade screen",
  strategy_family: familyId,
  mt5_relevance_classification: "mt5_relevant_unverified",
  required_data: "EURUSD M15 OHLCV bars with timestamps, source-backed benchmark-fixing mechanism, strategy/config hashes, and later MT5 terminal equivalence before any Phase 8E path.",
  expected_holding_period: "Intraday, typically 1-3 hours via bounded M15 exits and ATR-derived stops/targets.",
  expected_trade_frequency: "Medium; roughly one possible fix-window attempt per trading day, no low-frequency exception is registered and the default 200-trade floor applies.",
  expected_failure_modes: [
    "Benchmark-fixing flow concentration does not create stable directional alpha after reforms and costs.",
    "UTC fix-hour approximation misses DST-sensitive WMR fixing windows.",
    "OHLCV/tick-volume proxies fail to capture true fixing order flow or dealer inventory pressure.",
    "The signal becomes a session-timing artifact with poor OOS consistency."
  ],
  invalidation_criteria: [
    "Reject as non-survivor if the real WFA fails any active Phase 8D gate on completed OOS windows, trade count, return proxy, OOS Sharpe/profit factor where applicable, concentration, drawdown-to-return, or consistency route.",
    "Reject any Phase 8E, MT5/MQL5, tester parity, or deployment implication unless a separate survivor exists with MT5 equivalence and explicit operator authorization.",
    "Treat any post-result change to symbol, timeframe, costs, parameter ranges, data source, DST handling, or WFA config as a new denominator-tracked attempt."
  ],
  implementation_shape: "Use walk forward engine/src/strategies/fx_fix_reversal_eurusd.py with the canonical fx_fix_reversal_eurusd WFA config and deterministic WFA worker.",
  execution_sensitivity: "Sensitive to London/UTC/DST alignment, fix window definition, post-fix entry timing, volume proxy quality, ATR stop/target sizing, spread/slippage assumptions, and terminal-history equivalence.",
  mt5_ftmo_concerns: "EURUSD is present in FTMO terminal evidence, but this screening does not prove MT5 Strategy Tester parity or data equivalence.",
  prior_related_lessons: [
    "Phase 8D screens pre-registered hypotheses and counts weak or failed attempts in the denominator.",
    "The active survivor gate is flexible but compensation requires strong return, Sharpe, profit factor, concentration, drawdown-to-return, and window diagnostics.",
    "Prior failed screens include London breakout/sweep, GBPJPY reversion, XAUUSD trend, BTC BB-width squeeze, BTC volatility-adaptive trend, EURUSD signed tick-volume OFI, and EURUSD month-end rebalancing-flow."
  ],
  prior_failed_patterns_checked: [
    "Not a London breakout, London sweep, or GBPJPY reversion mutation.",
    "Not XAUUSD trend-following, BTC BB-width squeeze, BTC volatility-adaptive Supertrend, EURUSD signed tick-volume OFI, or EURUSD month-end rebalancing-flow.",
    "Not a simple RSI strategy and no low-frequency exception is registered.",
    "Uses a new independent FSB FX benchmark-fixing source rather than selecting a historical WFA winner."
  ],
  novelty_reason: "First Phase 8D screen of a source-backed WMR London 4pm FX benchmark-fixing mechanism on EURUSD M15 using pre-fix momentum, volume regime, ATR regime, and bounded post-fix risk controls.",
  disconfirming_evidence: [
    "The FSB report is benchmark market-structure evidence, not a direct EURUSD alpha study.",
    "Benchmark reform and execution changes may eliminate or invert historical fix-window patterns.",
    "Current data is not separately proven equivalent to FTMO terminal EURUSD history."
  ],
  proposed_experiment_shape: "Compile a deterministic Phase 8D research_wfa plan, run the canonical worker on fx_fix_reversal_eurusd, emit candidate evidence and summary, then evaluate the shared flexible consistency route without positive labels unless all gates pass.",
  cited_source_ids: [sourceRecord.source_id],
  source_claims: [
    { claim_class: "source_backed_mechanism", citation_source_id: sourceRecord.source_id },
    { claim_class: "implementation_mapping", citation_source_id: sourceRecord.source_id }
  ],
  schema_version: "hypothesis_packet_v1",
  evidence_kind: "stage0_research_discovery",
  authority_layer: "stage_0_discovery",
  source_records: [sourceRecordRef],
  phase8a_universe_constraints: {
    universe_snapshot: artifactRef(rootDir, universeSnapshotPath),
    terminal_inventory: artifactRef(rootDir, terminalInventoryPath),
    terminal_symbol_evidence: "EURUSD appears in FTMO terminal universe evidence; data equivalence is not verified in this Phase 8D screen."
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
  mechanism_summary: "Pre-register EURUSD M15 WMR London 4pm FX benchmark-fixing flow screening before WFA execution.",
  instrument_scope: hypothesisPacket.instrument_scope,
  timeframe_candidate: hypothesisPacket.timeframe_candidate,
  strategy_family: hypothesisPacket.strategy_family,
  expected_trade_frequency: hypothesisPacket.expected_trade_frequency,
  data_sources: [dataPath, "FTMO terminal universe snapshot lists EURUSD, but MT5 data equivalence is not assumed."],
  cost_assumptions: "Use only fx_fix_reversal_eurusd WFA config costs: fees 0.0001 and slippage 0.0001, no hidden overrides.",
  wfa_design: {
    config_path: wfaConfigPath,
    window_policy: "Use the pre-registered 6m training / 3m testing / 3m step M15 WFA scheme encoded in the canonical Phase 8D config.",
    optimizer_policy: "Use the pre-registered 12-trial route and count this attempt in the denominator.",
    config_validation: {
      valid: canonicalValidation.valid,
      feasibility: canonicalValidation.feasibility,
      expected_output_root: canonicalValidation.expected_output_root
    }
  },
  denominator_tracking: {
    attempt_is_denominator_member: true,
    failed_blocked_repaired_rerun_counted: true,
    parameter_or_scope_change_creates_new_attempt: true,
    optimizer_trials_recorded: true
  },
  frozen_fields: ["mechanism_summary", "instrument_scope", "timeframe_candidate", "strategy_family", "expected_trade_frequency", "data_sources", "cost_assumptions", "wfa_design", "invalidation_criteria"],
  invalidation_criteria: hypothesisPacket.invalidation_criteria
});
const preregistrationArtifact = writeResearchWfaPreregistration(paths, preregistration);

const backlogItem = {
  id: `IDEA-PHASE8D-FX-FIX-REVERSAL-EURUSD-${stamp}`,
  title: "Phase 8D EURUSD FX benchmark-fixing flow screening",
  objective: "Screen a pre-registered EURUSD WMR London fix flow hypothesis through deterministic WFA.",
  status: "ready",
  priority: 91,
  category: "screening",
  evidence_kind: "research_wfa",
  authority_layer: "python_research",
  candidate_stage: "Phase 8D screening",
  candidate_id: candidateId,
  lineage_id: lineageId,
  family_id: familyId,
  market_family: "fx_major",
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
if (compiled.compiled !== true) throw new Error(`Phase 8D FX fix candidate failed to compile: ${compiled.reason} | ${compiled.blocked_reason ?? "no blocked reason"}`);

const experimentPlanPath = path.join(rootDir, "factory", "experiments", `${experimentId}.plan.json`);
writeJsonAtomic(experimentPlanPath, compiled.plan, paths);

const request = buildResearchWfaRunRequestFromPlan({ plan: compiled.plan, runId, rootDir });
request.max_buffer_bytes = 96 * 1024 * 1024;
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
const sharpeOos = numeric(parsedMetrics?.metrics?.sharpe_oos);
const profitFactor = numeric(parsedMetrics?.metrics?.profit_factor);
const consistencyLadderAdvisory = buildPhase8DConsistencyLadderAdvisory({ metrics: parsedMetrics?.metrics ?? {}, parsedMetrics });
const promotionGate = buildResearchWfaPromotionGate({
  runId,
  candidateId,
  attempt: 1,
  executionResult,
  evidencePaths: [parsedMetricsArtifact?.path, preregistrationArtifact.path, hypothesisPacketRef.path].filter(Boolean),
  rootDir,
  parsedMetrics
});
const consistencyPolicy = promotionGate.consistency_promotion_policy ?? null;
const floorFailures = [];
if ((successfulWindows ?? 0) < PHASE8D_SURVIVOR_FLOORS.minOosWindows) floorFailures.push("completed_oos_windows");
if ((trades ?? 0) < PHASE8D_SURVIVOR_FLOORS.minTrades) floorFailures.push("total_trades");
if ((returnPct ?? Number.NEGATIVE_INFINITY) < PHASE8D_SURVIVOR_FLOORS.minReturnPct) floorFailures.push("return_proxy_pct");
if (!consistencyPolicy?.passed) floorFailures.push("consistency_promotion_route");

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
  source_quality_gate: {
    status: "manual_packet_high_external_policy_research_plus_implementation_trust",
    source_record: artifactRef(rootDir, sourceRecordPath, "research_source_record")
  },
  denominator_context: {
    ...preregistration.denominator_tracking,
    denominator_artifact_status: executionResult.status === "executed" ? "preregistered_and_executed" : "preregistered_worker_terminal_nonexecuted",
    attempt_source: "phase8d_manual_packet_worker_execution",
    performance_result_used_for_repair: false,
    low_frequency_exception_registered: false
  },
  mt5_relevance: {
    classification: "mt5_relevant_unverified",
    terminal_symbol_seen: true,
    terminal_symbol: "EURUSD",
    mt5_instrument_equivalence_verified: false,
    deployment_proximate_evidence: false
  },
  data_identity: {
    status: "research_input_mt5_relevant_unverified",
    known: true,
    artifact: { ...dataRef, artifact_type: "data_input" }
  },
  wfa_metrics: {
    status: parsedMetricsArtifact ? "worker_terminal_artifact_backed" : "worker_terminal_without_parsed_metrics",
    windows: successfulWindows,
    trades,
    return_proxy_pct: returnPct,
    sharpe_oos: sharpeOos,
    profit_factor: profitFactor,
    positive_oos_window_ratio: positiveWindowRatio,
    wfr
  },
  consistency_ladder_advisory: consistencyLadderAdvisory,
  promotion_gate: promotionGate,
  survivor_floor_enforcement: {
    floors: PHASE8D_SURVIVOR_FLOORS,
    status: floorFailures.length > 0 ? "below_phase8d_survivor_floor" : "clears_phase8d_survivor_floor",
    failed_requirements: floorFailures,
    positive_or_survivor_label_allowed: floorFailures.length === 0 && promotionGate.decision === "allowed"
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
    sourceExcerptRef,
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
  "Phase 8D EURUSD M15 WMR London 4pm FX benchmark-fixing flow screening.",
  "",
  `- Candidate: ${candidateId}`,
  `- Status: ${executionResult.status}`,
  `- Blocked reason: ${executionResult.blocked_reason ?? "none"}`,
  "- MT5 relevance: mt5_relevant_unverified; EURUSD appears in terminal universe, but MT5 data equivalence is not verified",
  "- Low-frequency exception: none; default 200-trade floor applies",
  `- Windows: ${successfulWindows}`,
  `- Trades: ${trades}`,
  `- Return proxy pct: ${returnPct}`,
  `- Sharpe OOS: ${sharpeOos}`,
  `- Profit factor: ${profitFactor}`,
  `- Positive OOS window ratio: ${positiveWindowRatio}`,
  `- Consistency route: ${consistencyPolicy?.route ?? "none"} / tier ${consistencyPolicy?.tier ?? "unknown"}`,
  `- Promotion gate decision: ${promotionGate.decision}`,
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
  consistency_policy: consistencyPolicy,
  promotion_gate_decision: promotionGate.decision,
  metrics: candidateEvidencePacket.wfa_metrics,
  phase8e_authorized: false
}, null, 2));

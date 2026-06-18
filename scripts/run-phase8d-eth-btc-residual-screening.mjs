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
  const fullPath = path.join(rootDir, repoPath);
  const ref = { path: repoPath, sha256: sha256File(fullPath) };
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
const runId = `RUN-PHASE8D-ETH-BTC-RESIDUAL-${stamp}`;
const candidateId = `CAND-PHASE8D-ETH-BTC-RESIDUAL-${stamp}`;
const experimentId = `EXP-PHASE8D-ETH-BTC-RESIDUAL-${stamp}`;
const lineageId = "LINEAGE-PHASE8D-ETH-BTC-RESIDUAL";
const familyId = "eth_btc_residual_phase8d";
const sourceDir = `factory/research/manual/PHASE8D-ETH-BTC-RESIDUAL-${stamp}`;

const strategySourcePath = "walk forward engine/src/strategies/eth_btc_residual_phase8d.py";
const baseStrategySourcePath = "walk forward engine/src/strategies/btc_residual_reversion.py";
const strategyConfigPath = "walk forward engine/config/strategy_eth_btc_residual_phase8d.json";
const wfaConfigPath = "walk forward engine/strategies/eth_btc_residual_phase8d/wfa_config.yaml";
const dataPath = "walk forward engine/data/phase8d_eth_btc_residual_1h.csv";
const rawMergedDataPath = "walk forward engine/data/binance_eth_btc_merged_1h.csv";
const universeSnapshotPath = "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json";
const terminalInventoryPath = "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json";
const priorBlockedPlanPath = "factory/runs/RUN-20260323205900-x9v92n/experiment-plan.json";
const nberSourceUrl = "https://www.nber.org/papers/w24877";
const arxivSourceUrl = "https://arxiv.org/abs/1807.05715";

for (const requiredPath of [strategySourcePath, baseStrategySourcePath, strategyConfigPath, wfaConfigPath, dataPath, rawMergedDataPath, universeSnapshotPath, terminalInventoryPath]) {
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
  `NBER URL: ${nberSourceUrl}`,
  `arXiv URL: ${arxivSourceUrl}`,
  "",
  "Captured mechanism claims:",
  "",
  "- Liu and Tsyvinski's NBER page states that cryptocurrency risk-return behavior is distinct from stocks, currencies, and precious metals, and that cryptocurrency-specific factors predict cryptocurrency returns.",
  "- The same NBER page states there is a strong time-series momentum effect in cryptocurrency returns; this supports crypto-specific structure but does not validate this residual rule.",
  "- The arXiv cryptocurrency market-network paper explicitly discusses Bitcoin and Ethereum, crypto exchange-rate pairs, volatility, market maturity differences, and observable mispricings across cryptocurrency market networks.",
  "- These sources support a bounded test of ETH/BTC relationship structure and possible relative-value dislocations, not a profitability claim.",
  "",
  "Implementation mapping:",
  "",
  "- The candidate trades ETH executable OHLCV while using BTC close returns as a rolling-beta context series.",
  "- The data is Binance ETH/BTC research data transformed into ETH generic OHLCV plus BTC context columns; it is not MT5-equivalence evidence.",
  "- A related March 2026 residual idea had a planner artifact but no terminal WFA evidence; this run is a new Phase 8D preregistered denominator attempt with corrected data shape.",
  "",
  "This excerpt is source-backed mechanism evidence only. It does not claim an edge, exchange arbitrage executability, MT5 data equivalence, or Phase 8E readiness."
].join("\n") + "\n";
fs.writeFileSync(path.join(rootDir, sourceExcerptPath), sourceExcerpt, "utf8");

const sourceRecordPath = `${sourceDir}/source-record.json`;
const strategySourceRef = artifactRef(rootDir, strategySourcePath);
const baseStrategySourceRef = artifactRef(rootDir, baseStrategySourcePath);
const strategyConfigRef = artifactRef(rootDir, strategyConfigPath);
const wfaConfigRef = artifactRef(rootDir, wfaConfigPath);
const dataRef = artifactRef(rootDir, dataPath);
const rawDataRef = artifactRef(rootDir, rawMergedDataPath);
const sourceExcerptRef = artifactRef(rootDir, sourceExcerptPath, "research_source_excerpt");
const priorBlockedPlanRef = fs.existsSync(path.join(rootDir, priorBlockedPlanPath)) ? artifactRef(rootDir, priorBlockedPlanPath, "prior_related_blocked_plan") : null;

const sourceRecord = {
  schema_version: "research_source_record_v1",
  evidence_kind: "stage0_research_discovery",
  authority_layer: "stage_0_discovery",
  source_id: `SRC-PHASE8D-ETH-BTC-RESIDUAL-${stamp}`,
  source_type: "web_captured_sources_plus_repo_implementation",
  trust_tier: "medium_implementation_trust",
  url_or_path_or_doi: `${nberSourceUrl} ; ${arxivSourceUrl}`,
  accessed_at: observedAt,
  content_hash_or_unavailable_reason: sourceExcerptRef.sha256,
  claims_extracted: [
    "NBER source supports cryptocurrency-specific return structure and predictability, including time-series momentum, but not this exact ETH/BTC residual rule.",
    "arXiv source supports cryptocurrency market-network mispricing concepts involving Bitcoin and Ethereum, but not this exact single-venue rolling-beta residual rule.",
    "The repo implementation maps the mechanism to ETH H1 residual mean reversion against BTC context with ETH as the executable leg.",
    "ETHUSD and BTCUSD appear in FTMO terminal inventory evidence, while Binance-to-MT5 data equivalence is explicitly unverified."
  ],
  limitations: [
    "The external sources do not prove a profitable ETH/BTC residual WFA rule.",
    "The arXiv paper is about market-network/cross-market mispricings, not this OHLCV residual strategy.",
    "The candidate uses Binance proxy data and does not verify FTMO ETHUSD/BTCUSD historical equivalence.",
    "The strategy trades only an ETH leg in research backtest form, not a hedged two-leg MT5 portfolio."
  ],
  disconfirming_relevance: [
    "Crypto relative-value dislocations can be arbitraged away quickly or require execution venues unavailable in MT5 CFDs.",
    "BTC beta residuals may be unstable across regimes, especially during ETH-specific protocol or risk events.",
    "A single ETH executable leg may retain directional crypto beta despite the BTC residual signal.",
    "Transaction costs, weekend liquidity, and Binance-to-FTMO basis can erase any apparent edge."
  ],
  artifact: sourceExcerptRef,
  provider_provenance: {
    mode: "manual_phase8d_packet_from_live_webfetch_and_repo_strategy",
    live_research: true,
    deterministic_capture: true,
    source_urls: [nberSourceUrl, arxivSourceUrl],
    strategy_source: strategySourceRef,
    base_strategy_source: baseStrategySourceRef,
    strategy_config: strategyConfigRef,
    wfa_config: wfaConfigRef,
    data_input: dataRef,
    raw_merged_data_input: rawDataRef,
    prior_related_blocked_plan: priorBlockedPlanRef
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
  hypothesis_id: `HYP-PHASE8D-ETH-BTC-RESIDUAL-${stamp}`,
  mechanism: "ETH can temporarily deviate from its rolling BTC beta relationship during crypto-specific flows. A bounded H1 residual z-score mean-reversion rule may capture ETH-specific dislocations after BTC market beta is removed.",
  falsifiable_prediction: "A pre-registered ETH H1 BTC-residual candidate should clear the active Phase 8D research WFA promotion gate after configured costs; otherwise it remains denominator-counted non-survivor evidence.",
  market_structure_assumption: "ETHUSD and BTCUSD are FTMO/MT5 crypto CFD symbols, but this research screen uses Binance proxy ETH/BTC data and does not assume MT5 history equivalence or hedged two-leg executable parity.",
  instrument_scope: "ETHUSD-equivalent H1 research screen using ETH executable OHLCV with BTC context from Binance merged data; MT5 instrument equivalence remains unverified.",
  timeframe_candidate: "H1 ETH/BTC rolling-beta residual mean-reversion screen",
  strategy_family: familyId,
  mt5_relevance_classification: "mt5_relevant_unverified",
  required_data: "ETH H1 OHLCV executable bars, BTC H1 context closes, source-backed crypto relationship/mispricing rationale, strategy/config hashes, and later MT5 terminal equivalence before any Phase 8E path.",
  expected_holding_period: "Intraday to one day through 6-24 H1 bar exits plus ATR-derived stops/targets.",
  expected_trade_frequency: "Medium; residual z-score events should be frequent enough for the default Phase 8D trade floor over the 2021-2026 overlap, with no low-frequency exception registered.",
  expected_failure_modes: [
    "The ETH residual is not mean-reverting after costs.",
    "Rolling BTC beta is unstable or leaves directional crypto exposure.",
    "Binance spot proxy behavior does not transfer to FTMO ETHUSD/BTCUSD CFDs.",
    "The signal is a generic crypto mean-reversion artifact already crowded or regime-decayed."
  ],
  invalidation_criteria: [
    "Reject as non-survivor if the real WFA fails any active Phase 8D gate on completed OOS windows, trade count, return proxy, OOS Sharpe/profit factor where applicable, concentration, drawdown-to-return, or consistency route.",
    "Reject any Phase 8E, MT5/MQL5, tester parity, or deployment implication unless a separate survivor exists with MT5 equivalence and explicit operator authorization.",
    "Treat any post-result change to symbol, timeframe, costs, parameter ranges, data source, merged-data mapping, or WFA config as a new denominator-tracked attempt."
  ],
  implementation_shape: "Use walk forward engine/src/strategies/eth_btc_residual_phase8d.py with the canonical eth_btc_residual_phase8d WFA config and deterministic WFA worker.",
  execution_sensitivity: "Sensitive to ETH/BTC timestamp alignment, rolling-beta lookback, residual z-score threshold, weekend liquidity, crypto CFD basis, fees/slippage, and whether the WFA engine execution price uses ETH generic OHLCV as intended.",
  mt5_ftmo_concerns: "ETHUSD and BTCUSD are present in FTMO terminal inventory evidence, but this screening does not prove MT5 Strategy Tester parity, two-leg hedging, CFD basis, or data equivalence.",
  prior_related_lessons: [
    "A March 2026 BTC-normalized ETH residual plan exists but has executor errors and no terminal WFA metrics; this attempt records that prior as related blocked work, not positive evidence.",
    "Phase 8D screens pre-registered hypotheses and counts weak or failed attempts in the denominator.",
    "The active survivor gate is flexible but compensation requires strong return, Sharpe, profit factor, concentration, drawdown-to-return, and window diagnostics."
  ],
  prior_failed_patterns_checked: [
    "Not London breakout, London sweep, GBPJPY reversion, XAUUSD trend, BTC BB-width squeeze, BTC volatility-adaptive trend, EURUSD signed tick-volume OFI, EURUSD month-end rebalancing-flow, EURUSD WMR FX benchmark-fixing flow, or EURUSD NFP macro-announcement flow.",
    "Not selected because ETH/BTC had an old promising label; the only identified prior residual artifact was blocked before WFA execution.",
    "Not a simple RSI strategy and no low-frequency exception is registered."
  ],
  novelty_reason: "First Phase 8D deterministic worker screen of a corrected ETH-executable/BTC-context residual relationship mechanism, with explicit external-source limitations and denominator tracking.",
  disconfirming_evidence: [
    "The sources support broad crypto-specific predictability/mispricing structure, not this exact H1 rule.",
    "Current data is not separately proven equivalent to FTMO terminal ETHUSD/BTCUSD history.",
    "The research backtest trades a single ETH leg, so it can fail to isolate BTC-neutral exposure."
  ],
  proposed_experiment_shape: "Compile a deterministic Phase 8D research_wfa plan, run the canonical worker on eth_btc_residual_phase8d once, emit candidate evidence and summary, then evaluate the shared flexible consistency route without positive labels unless all gates pass.",
  cited_source_ids: [sourceRecord.source_id],
  source_claims: [
    { claim_class: "source_backed_crypto_specific_return_structure", citation_source_id: sourceRecord.source_id },
    { claim_class: "source_backed_crypto_market_network_mispricing_context", citation_source_id: sourceRecord.source_id },
    { claim_class: "implementation_mapping", citation_source_id: sourceRecord.source_id }
  ],
  schema_version: "hypothesis_packet_v1",
  evidence_kind: "stage0_research_discovery",
  authority_layer: "stage_0_discovery",
  source_records: [sourceRecordRef],
  phase8a_universe_constraints: {
    universe_snapshot: artifactRef(rootDir, universeSnapshotPath),
    terminal_inventory: artifactRef(rootDir, terminalInventoryPath),
    terminal_symbol_evidence: "ETHUSD and BTCUSD appear in FTMO terminal inventory evidence; Binance data equivalence is not verified in this Phase 8D screen."
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
  mechanism_summary: "Pre-register ETH H1 BTC-residual mean-reversion screening before WFA execution.",
  instrument_scope: hypothesisPacket.instrument_scope,
  timeframe_candidate: hypothesisPacket.timeframe_candidate,
  strategy_family: hypothesisPacket.strategy_family,
  expected_trade_frequency: hypothesisPacket.expected_trade_frequency,
  data_sources: [dataPath, rawMergedDataPath, "FTMO terminal inventory lists ETHUSD/BTCUSD, but MT5 data equivalence is not assumed."],
  cost_assumptions: "Use only eth_btc_residual_phase8d WFA config costs: fees 0.0006 and slippage 0.0002, no hidden overrides.",
  wfa_design: {
    config_path: wfaConfigPath,
    window_policy: "Use the pre-registered 3m training / 1m testing / 1m step H1 WFA scheme encoded in the canonical Phase 8D config.",
    optimizer_policy: "Use the pre-registered 25-trial route and count this attempt in the denominator.",
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
  id: `IDEA-PHASE8D-ETH-BTC-RESIDUAL-${stamp}`,
  title: "Phase 8D ETH/BTC residual mean-reversion screening",
  objective: "Screen a pre-registered ETH/BTC rolling-beta residual mean-reversion hypothesis through deterministic WFA.",
  status: "ready",
  priority: 90,
  category: "screening",
  evidence_kind: "research_wfa",
  authority_layer: "python_research",
  candidate_stage: "Phase 8D screening",
  candidate_id: candidateId,
  lineage_id: lineageId,
  family_id: familyId,
  market_family: "crypto_cfd",
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
if (compiled.compiled !== true) throw new Error(`Phase 8D ETH/BTC residual candidate failed to compile: ${compiled.reason} | ${compiled.blocked_reason ?? "no blocked reason"}`);

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
    status: "manual_packet_medium_external_crypto_research_plus_implementation_trust",
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
    terminal_symbol: "ETHUSD",
    mt5_instrument_equivalence_verified: false,
    deployment_proximate_evidence: false
  },
  data_identity: {
    status: "research_input_mt5_relevant_unverified",
    known: true,
    artifact: { ...dataRef, artifact_type: "data_input" },
    raw_merged_input: { ...rawDataRef, artifact_type: "raw_merged_data_input" }
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
    strategySourceRef,
    baseStrategySourceRef,
    strategyConfigRef,
    wfaConfigRef,
    dataRef,
    rawDataRef,
    priorBlockedPlanRef,
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
  "Phase 8D ETHUSD-equivalent H1 ETH/BTC rolling-beta residual mean-reversion screening.",
  "",
  `- Candidate: ${candidateId}`,
  `- Status: ${executionResult.status}`,
  `- Blocked reason: ${executionResult.blocked_reason ?? "none"}`,
  "- MT5 relevance: mt5_relevant_unverified; ETHUSD/BTCUSD appear in terminal inventory, but Binance data equivalence is not verified",
  "- Low-frequency exception: none; default trade floor applies",
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

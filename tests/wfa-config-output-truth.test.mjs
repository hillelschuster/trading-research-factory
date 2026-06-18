import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { buildResearchWfaPreregistration, writeResearchWfaPreregistration } from "../src/core/research-wfa-preregistration.mjs";
import { compileWfaReadyPlan } from "../src/core/wfa-plan-compiler.mjs";
import { validateExecutionResult } from "../src/core/validators.mjs";
import { runResearchWfaRunWorker, validateResearchWfaRunRequest } from "../src/workers/research-wfa-run-worker.mjs";

function tempRoot() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wfa-output-truth-")), "trading-research-factory");
}

function canonicalYaml(strategyName) {
  return `walk_forward:
  training_months: 3
  testing_months: 1
  step_months: 1
  n_parameter_trials: 5
  output_directory: strategies/${strategyName}/results
data:
  source_file: data/${strategyName}.csv
strategy:
  profile_key: ${strategyName.toUpperCase()}
performance:
  max_execution_time_seconds: 60
`;
}

function writeRoute(rootDir, { strategyName = "demo", scriptBody = null, configBody = null } = {}) {
  const wfaRoot = path.join(rootDir, "walk forward engine");
  fs.mkdirSync(path.join(wfaRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "strategies", strategyName, "results"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "src", "strategies"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(wfaRoot, "strategies", strategyName, "wfa_config.yaml"), configBody ?? canonicalYaml(strategyName), "utf8");
  fs.writeFileSync(path.join(wfaRoot, "src", "strategies", `${strategyName}.py`), "class DemoStrategy:\n    pass\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "config", `strategy_${strategyName}.json`), `{"profile_key":"${strategyName.toUpperCase()}"}\n`, "utf8");
  fs.writeFileSync(path.join(wfaRoot, "data", `${strategyName}.csv`), "timestamp,open,high,low,close,volume\n2026-01-01,1,1,1,1,1\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "scripts", "walk_forward_smoke_test.py"), scriptBody ?? `const fs = require('fs');
const path = require('path');
const out = path.join(process.cwd(), 'strategies', '${strategyName}', 'results');
fs.mkdirSync(out, { recursive: true });
const result = {
  successful_windows: 2,
  total_windows: 2,
  aggregate_sharpe_ratio: 0.4,
  aggregate_total_trades: 12,
  aggregate_max_drawdown_pct: -0.02,
  aggregate_return_pct: 1.2,
  window_results: [
    { window_id: 0, success: true, total_return_pct: 0.5, total_trades: 6, sharpe_ratio: 0.3, max_drawdown_pct: -0.01 },
    { window_id: 1, success: true, total_return_pct: 0.7, total_trades: 6, sharpe_ratio: 0.5, max_drawdown_pct: -0.02 }
  ]
};
fs.writeFileSync(path.join(out, 'walk_forward_results_20260523_000000.json'), JSON.stringify(result, null, 2) + '\\n');
`, "utf8");
}

function request(overrides = {}) {
  const strategyName = overrides.strategyName ?? "demo";
  return {
    schema_version: "research_wfa_run_request_v1",
    run_id: "RUN-WFA-OUTPUT-TRUTH-001",
    job_id: "JOB-WFA-OUTPUT-TRUTH-001",
    candidate_id: "CAND-WFA-OUTPUT-TRUTH-001",
    lineage_id: "LINEAGE-WFA-OUTPUT-TRUTH",
    family_id: "FAMILY-WFA-OUTPUT-TRUTH",
    attempt_id: "ATTEMPT-1",
    attempt_type: "worker_launched_wfa",
    evidence_kind: "research_wfa",
    authority_layer: "python_research",
    wfa_config_path: `walk forward engine/strategies/${strategyName}/wfa_config.yaml`,
    strategy_source_paths: [`walk forward engine/src/strategies/${strategyName}.py`],
    strategy_config_paths: [`walk forward engine/config/strategy_${strategyName}.json`],
    data_paths: [`walk forward engine/data/${strategyName}.csv`],
    expected_output_root: `walk forward engine/strategies/${strategyName}/results`,
    timeout_ms: 5000,
    working_directory: "walk forward engine",
    python_executable: process.execPath,
    environment_allowlist: ["PATH"],
    ...overrides
  };
}

function writeJsonArtifact(rootDir, repoPath, payload) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return {
    path: repoPath,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex")
  };
}

function writeResearchWfaPreregistrationArtifact(rootDir, { candidateId, runId, strategyName = "demo" }) {
  const universe = writeJsonArtifact(rootDir, "factory/mt5/environment/UNIVERSE-SNAPSHOT-TEST/universe-snapshot.json", {
    schema_version: "mt5_universe_snapshot_v1",
    symbols: ["EURUSD"]
  });
  const source = writeJsonArtifact(rootDir, "factory/research/runs/RB-RUN-WFA-PREREG/source-records/SRC-001.json", {
    schema_version: "research_source_record_v1",
    source_id: "SRC-001"
  });
  const packet = writeJsonArtifact(rootDir, "factory/research/runs/RB-RUN-WFA-PREREG/hypotheses/HYP-001.json", {
    schema_version: "hypothesis_packet_v1",
    evidence_kind: "stage0_research_discovery",
    authority_layer: "stage_0_discovery",
    hypothesis_id: "HYP-001",
    mechanism: "A pre-registered volatility and liquidity mechanism can be falsified by WFA before any result is known.",
    falsifiable_prediction: "If the mechanism is real, OOS windows should show consistent positive behavior after realistic costs.",
    market_structure_assumption: "Liquid FTMO MT5 symbols can exhibit recurring volatility compression and expansion regimes.",
    instrument_scope: "Any Phase 8A FTMO MT5 verified liquid instrument class, not a deployment claim.",
    timeframe_candidate: "H1 liquid-session candidate",
    strategy_family: `${strategyName} volatility route`,
    mt5_relevance_classification: "mt5_proxy",
    required_data: "Broker-mapped OHLCV history with spread or cost assumptions recorded before WFA.",
    expected_holding_period: "Intraday to multi-session, bounded by the WFA config.",
    expected_trade_frequency: "Medium frequency",
    expected_failure_modes: ["No OOS consistency", "Too few trades", "Cost sensitivity dominates"],
    invalidation_criteria: ["Block if source hashes cannot be verified", "Reject if WFA floors are not met"],
    implementation_shape: "Use the existing canonical WFA strategy/config route without post-result parameter changes.",
    execution_sensitivity: "Sensitive to spread, slippage, and MT5 symbol session differences.",
    mt5_ftmo_concerns: "Requires later MT5 instrument equivalence and Phase 8E authorization before parity work.",
    prior_related_lessons: ["Phase 8D screening must avoid historical WFA roulette."],
    prior_failed_patterns_checked: ["No direct reuse of historical leaderboard winners without preregistration."],
    novelty_reason: "This packet exists to prove source-backed Phase 8D routing, not profitability.",
    disconfirming_evidence: ["No WFA result has been observed at packet creation time."],
    proposed_experiment_shape: "Run one deterministic WFA route after preregistration and record all blocked or failed attempts.",
    source_records: [{ source_id: "SRC-001", path: source.path, sha256: source.sha256 }],
    cited_source_ids: ["SRC-001"],
    source_claims: [{ source_id: "SRC-001", claim: "The route is preregistered before WFA execution." }],
    phase8a_universe_constraints: { universe_snapshot: universe },
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false,
    content_hash: "1".repeat(64)
  });
  const registration = buildResearchWfaPreregistration({
    candidate_id: candidateId,
    registered_at: "2026-05-24T10:00:00.000Z",
    registered_before_run_id: runId,
    hypothesis_packet_ref: packet,
    source_record_refs: [source],
    mechanism_summary: "Pre-registered source-backed WFA route before any candidate screening result exists.",
    instrument_scope: "FTMO MT5 liquid instruments constrained by the candidate route",
    timeframe_candidate: "H1",
    strategy_family: strategyName,
    expected_trade_frequency: "medium frequency",
    data_sources: ["pre-declared WFA config data route"],
    cost_assumptions: "Use WFA config fees/slippage diagnostics only; no external profitability estimate.",
    wfa_design: {
      config_path: `walk forward engine/strategies/${strategyName}/wfa_config.yaml`,
      window_policy: "pre-declared before launch"
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
    invalidation_criteria: [
      "Block if Stage-0 source hashes cannot be verified before launch.",
      "Block if WFA result artifacts do not preserve denominator diagnostics."
    ]
  });
  const preregistration = writeResearchWfaPreregistration(buildPaths(rootDir), registration);
  return { ...preregistration, hypothesisPacket: packet };
}

test("WFA-ready compiler rejects non-canonical YAML with missing engine-required fields", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { strategyName: "bad_route", configBody: "walk_forward:\n  output_directory: strategies/bad_route/results\n" });

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-BAD-CONFIG",
    backlogItem: {
      id: "IDEA-WFA-BAD-CONFIG",
      title: "Bad config route",
      status: "ready",
      evidence_kind: "research_wfa",
      expected_wfa_config_path: "walk forward engine/strategies/bad_route/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_bad_route.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/bad_route.py",
      data_requirement: "walk forward engine/data/bad_route.csv"
    }
  });

  assert.equal(compiled.compiled, false);
  assert.equal(compiled.reason, "invalid_wfa_config_contract");
  assert.match(compiled.blocked_reason, /walk_forward\.training_months/i);
  assert.match(compiled.blocked_reason, /data\.source_file/i);
});

test("WFA worker blocks expected output-root mismatch before launching", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { strategyName: "demo", scriptBody: "require('fs').writeFileSync('SHOULD_NOT_RUN', 'ran');\n" });
  const badRequest = request({ expected_output_root: "walk forward engine/strategies/demo/other-results" });

  assert.throws(() => validateResearchWfaRunRequest(badRequest, { rootDir }), /expected_output_root mismatch/i);
  const result = runResearchWfaRunWorker({ rootDir, request: badRequest });

  assert.equal(result.status, "blocked");
  assert.equal(result.worker_result.observations.execution_was_run_by_this_worker, false);
  assert.match(result.blocked_reason, /expected_output_root mismatch/i);
  assert.equal(fs.existsSync(path.join(rootDir, "walk forward engine", "SHOULD_NOT_RUN")), false);
});

test("WFA-ready compiler requires pre-registration for explicit Phase 8D screening intent", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { strategyName: "screening_route" });
  const preregistration = writeResearchWfaPreregistrationArtifact(rootDir, {
    candidateId: "CAND-WFA-SCREENING-MISSING-PREREG",
    runId: "RUN-WFA-SCREENING-MISSING-PREREG",
    strategyName: "screening_route"
  });

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-SCREENING-MISSING-PREREG",
    backlogItem: {
      id: "IDEA-WFA-SCREENING-MISSING-PREREG",
      title: "Screening route without preregistration",
      status: "ready",
      evidence_kind: "research_wfa",
      candidate_stage: "Phase 8D screening",
      candidate_id: "CAND-WFA-SCREENING-MISSING-PREREG",
      expected_wfa_config_path: "walk forward engine/strategies/screening_route/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_screening_route.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/screening_route.py",
      manual_hypothesis_packet_path: preregistration.hypothesisPacket.path,
      manual_hypothesis_packet_sha256: preregistration.hypothesisPacket.sha256,
      data_requirement: "walk forward engine/data/screening_route.csv"
    }
  });

  assert.equal(compiled.compiled, false);
  assert.equal(compiled.reason, "missing_research_wfa_preregistration");
  assert.match(compiled.blocked_reason, /pre-run research_wfa_preregistration_v1/i);
  assert.deepEqual(compiled.source_hashes, [{
    artifact_type: "hypothesis_packet",
    path: preregistration.hypothesisPacket.path,
    sha256: preregistration.hypothesisPacket.sha256
  }]);
});

test("WFA-ready compiler blocks legacy ready WFA routes from Phase 8D screening without a hypothesis packet", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { strategyName: "legacy_screening_route" });

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-SCREENING-LEGACY-READY",
    backlogItem: {
      id: "IDEA-WFA-SCREENING-LEGACY-READY",
      title: "Legacy ready route without packet",
      status: "ready",
      evidence_kind: "research_wfa",
      candidate_stage: "Phase 8D screening",
      candidate_id: "CAND-WFA-SCREENING-LEGACY-READY",
      expected_wfa_config_path: "walk forward engine/strategies/legacy_screening_route/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_legacy_screening_route.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/legacy_screening_route.py",
      data_requirement: "walk forward engine/data/legacy_screening_route.csv"
    }
  });

  assert.equal(compiled.compiled, false);
  assert.equal(compiled.reason, "legacy_ready_wfa_phase8d_requires_hypothesis_packet");
  assert.equal(compiled.phase8d_blocked_at_start, true);
  assert.match(compiled.blocked_reason, /legacy ready WFA routes are not Phase 8D inputs/i);
});

test("WFA-ready compiler and worker consume hash-backed research WFA pre-registration", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { strategyName: "demo" });
  const preregistration = writeResearchWfaPreregistrationArtifact(rootDir, {
    candidateId: "CAND-WFA-PREREG-GOOD",
    runId: "RUN-WFA-PREREG-GOOD",
    strategyName: "demo"
  });

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-PREREG-GOOD",
    backlogItem: {
      id: "IDEA-WFA-PREREG-GOOD",
      title: "Pre-registered WFA route",
      status: "ready",
      evidence_kind: "research_wfa",
      candidate_stage: "Phase 8D screening",
      candidate_id: "CAND-WFA-PREREG-GOOD",
      expected_wfa_config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_demo.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/demo.py",
      data_requirement: "walk forward engine/data/demo.csv",
      manual_hypothesis_packet_path: preregistration.hypothesisPacket.path,
      manual_hypothesis_packet_sha256: preregistration.hypothesisPacket.sha256,
      research_wfa_preregistration: preregistration
    }
  });

  assert.equal(compiled.compiled, true);
  assert.deepEqual(compiled.plan.research_wfa_preregistration, {
    artifact_type: "research_wfa_preregistration",
    path: preregistration.path,
    sha256: preregistration.sha256
  });
  assert.equal(compiled.plan.source_hashes.some((record) => record.path === preregistration.path && record.sha256 === preregistration.sha256), true);

  const goodRequest = request({
    run_id: "RUN-WFA-PREREG-GOOD",
    job_id: "JOB-WFA-PREREG-GOOD",
    candidate_id: "CAND-WFA-PREREG-GOOD",
    research_wfa_preregistration: preregistration
  });
  assert.doesNotThrow(() => validateResearchWfaRunRequest(goodRequest, { rootDir }));

  const badRequest = { ...goodRequest, research_wfa_preregistration: { ...preregistration, sha256: "0".repeat(64) } };
  assert.throws(() => validateResearchWfaRunRequest(badRequest, { rootDir }), /research_wfa_preregistration not consumable/i);
});

test("WFA-ready compiler rejects invalid purge_gap_bars", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, {
    strategyName: "purge_bad",
    configBody: canonicalYaml("purge_bad").replace("  n_parameter_trials: 5\n", "  n_parameter_trials: 5\n  purge_gap_bars: -1\n")
  });

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-BAD-PURGE",
    backlogItem: {
      id: "IDEA-WFA-BAD-PURGE",
      title: "Bad purge config route",
      status: "ready",
      evidence_kind: "research_wfa",
      expected_wfa_config_path: "walk forward engine/strategies/purge_bad/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_purge_bad.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/purge_bad.py",
      data_requirement: "walk forward engine/data/purge_bad.csv"
    }
  });

  assert.equal(compiled.compiled, false);
  assert.equal(compiled.reason, "invalid_wfa_config_contract");
  assert.match(compiled.blocked_reason, /purge_gap_bars/i);
});

test("WFA-ready compiler rejects invalid diagnostic-only indicator_warmup_bars", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, {
    strategyName: "warmup_bad",
    configBody: canonicalYaml("warmup_bad").replace("  n_parameter_trials: 5\n", "  n_parameter_trials: 5\n  indicator_warmup_bars: -1\n")
  });

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-BAD-WARMUP",
    backlogItem: {
      id: "IDEA-WFA-BAD-WARMUP",
      title: "Bad warmup config route",
      status: "ready",
      evidence_kind: "research_wfa",
      expected_wfa_config_path: "walk forward engine/strategies/warmup_bad/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_warmup_bad.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/warmup_bad.py",
      data_requirement: "walk forward engine/data/warmup_bad.csv"
    }
  });

  assert.equal(compiled.compiled, false);
  assert.equal(compiled.reason, "invalid_wfa_config_contract");
  assert.match(compiled.blocked_reason, /indicator_warmup_bars/i);
});

test("WFA-ready compiler blocks mechanically impossible first-window geometry", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const strategyName = "geometry_bad";
  writeRoute(rootDir, {
    strategyName,
    configBody: canonicalYaml(strategyName).replace("data:\n  source_file: data/geometry_bad.csv\n", "data:\n  source_file: data/geometry_bad.csv\n  min_required_bars: 200\n")
  });

  const rows = ["timestamp,open,high,low,close,volume"];
  const start = new Date("2026-01-01T00:00:00Z");
  for (let day = 0; day < 270; day += 1) {
    const timestamp = new Date(start.getTime() + day * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").replace(".000Z", "");
    rows.push(`${timestamp},1,1,1,1,1`);
  }
  fs.writeFileSync(path.join(rootDir, "walk forward engine", "data", `${strategyName}.csv`), `${rows.join("\n")}\n`, "utf8");

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-BAD-GEOMETRY",
    backlogItem: {
      id: "IDEA-WFA-BAD-GEOMETRY",
      title: "Bad WFA geometry route",
      status: "ready",
      evidence_kind: "research_wfa",
      expected_wfa_config_path: "walk forward engine/strategies/geometry_bad/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_geometry_bad.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/geometry_bad.py",
      data_requirement: "walk forward engine/data/geometry_bad.csv"
    }
  });

  assert.equal(compiled.compiled, false);
  assert.equal(compiled.reason, "invalid_wfa_config_contract");
  assert.match(compiled.blocked_reason, /first-window geometry is impossible/i);
  assert.match(compiled.blocked_reason, /training_months=3 yields/);
  assert.match(compiled.blocked_reason, /data\.min_required_bars=200/);
});

test("WFA worker records blocked WFE and WFR diagnostics instead of fake metrics", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, {
    strategyName: "demo",
    scriptBody: `const fs = require('fs');
const path = require('path');
const out = path.join(process.cwd(), 'strategies', 'demo', 'results');
fs.mkdirSync(out, { recursive: true });
const result = {
  successful_windows: 2,
  aggregate_sharpe_ratio: 0.4,
  aggregate_total_trades: 12,
  aggregate_max_drawdown_pct: -0.02,
  aggregate_return_pct: 1.2,
  window_results: [
    { window_id: 0, success: true, total_return_pct: 0.5, total_trades: 6, sharpe_ratio: 0.3, max_drawdown_pct: -0.01 },
    { window_id: 1, success: true, total_return_pct: 0.7, total_trades: 6, sharpe_ratio: 0.5, max_drawdown_pct: -0.02 }
  ]
};
fs.writeFileSync(path.join(out, 'walk_forward_results_20260523_000000.json'), JSON.stringify(result, null, 2) + '\\n');
`
  });

  const result = runResearchWfaRunWorker({ rootDir, request: request() });
  const readiness = result.observations.metric_readiness;

  assert.equal(result.status, "executed");
  assert.equal(readiness.sharpe_oos.status, "available");
  assert.equal(readiness.sharpe_is.status, "blocked_missing_input");
  assert.equal(readiness.wfe.status, "blocked_missing_inputs");
  assert.match(readiness.wfe.missing_because, /in-sample return/i);
  assert.equal(readiness.wfr.status, "blocked_missing_inputs");
  assert.deepEqual(readiness.wfr.missing_inputs, ["artifact-backed total_windows"]);
  assert.equal(Object.hasOwn(result.metrics_observed, "wfe"), false);
  assert.equal(Object.hasOwn(result.metrics_observed, "wfr"), false);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("WFA-ready compiler still compiles canonical routes and carries expected output root", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { strategyName: "demo" });

  const compiled = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-GOOD-CONFIG",
    backlogItem: {
      id: "IDEA-WFA-GOOD-CONFIG",
      title: "Good config route",
      status: "ready",
      evidence_kind: "research_wfa",
      expected_wfa_config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_demo.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/demo.py",
      data_requirement: "walk forward engine/data/demo.csv"
    }
  });

  assert.equal(compiled.compiled, true);
  assert.equal(compiled.plan.advanced_wfa_config.expected_output_root, "walk forward engine/strategies/demo/results");
  assert.match(compiled.plan.commands[0], /walk_forward_smoke_test\.py --config strategies\/demo\/wfa_config\.yaml/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { validateExecutionArtifacts, validateExecutionResult, validateEvaluationResult, validateParityReport, validatePlannerResult, validatePromotionGate, validateSummaryResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";
import { appendFailedParityPattern, buildCandidatePromotionGate, buildFailedParityPatternRecord, buildParityReport, buildResearchWfaGateReport, buildResearchWfaPromotionGate, buildRolloutGate, buildStageGateResult, buildVerificationManifest, finalizeRolloutGateExecution, recordCandidateExecutionPromotionGate, runFaultDrills, writeCandidatePromotionGate, writeParityReport, writeResearchWfaGateReport, writeRolloutGate, writeVerificationManifest } from "../src/core/verification.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { runResearchWfaEnvelopeWorker } from "../src/workers/research-wfa-envelope-worker.mjs";
import { runResearchWfaRunWorker, validateResearchWfaRunRequest } from "../src/workers/research-wfa-run-worker.mjs";
import { RuntimeLedger } from "../src/core/runtime-ledger.mjs";
import { normalizeGateArg } from "../scripts/run-rollout-gate.mjs";
import { refreshVerificationArtifacts, validateStructure } from "../scripts/validate-structure.mjs";

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verification-"));
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function artifactBackedCostAssumptions(values = { fees: 0.0004, slippage: 0.0002 }, { sourcePath = "walk forward engine/strategies/demo/results/analysis.json", sha256 = "c".repeat(64) } = {}) {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, {
    value,
    source_path: sourcePath,
    source_sha256: sha256,
    source_field: `config.${field}`
  }]));
}

function attachNonWorkerDenominatorArtifact(rootDir, executionResult, rows, { fileName = "non-worker-denominator.jsonl", sha256 = null } = {}) {
  const repoPath = path.join("factory", "runs", executionResult.worker_result?.run_id ?? executionResult.experiment_id ?? "RUN-NON-WORKER", "denominator", fileName).replace(/\\/g, "/");
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = fileName.endsWith(".json")
    ? JSON.stringify(rows, null, 2) + "\n"
    : rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  fs.writeFileSync(fullPath, content, "utf8");
  const artifact = {
    artifact_type: "non_worker_denominator_attempts",
    path: repoPath,
    sha256: sha256 ?? sha256Text(content)
  };
  executionResult.artifacts_created = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  executionResult.artifacts_created.push(artifact);
  return artifact;
}

function attachOptimizerSearchContextArtifact(rootDir, executionResult, payload, { fileName = "optimizer-search-context.json", sha256 = null } = {}) {
  const repoPath = path.join("factory", "runs", executionResult.worker_result?.run_id ?? executionResult.experiment_id ?? "RUN-OPTIMIZER-CONTEXT", "denominator", fileName).replace(/\\/g, "/");
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(fullPath, content, "utf8");
  const artifact = {
    artifact_type: "optimizer_search_context",
    path: repoPath,
    sha256: sha256 ?? sha256Text(content)
  };
  executionResult.artifacts_created = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  executionResult.artifacts_created.push(artifact);
  return artifact;
}

function optimizerSearchContext(overrides = {}) {
  return {
    schema_version: "optimizer_search_context_v1",
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    optimizer_name: "optuna_tpe",
    search_space_hash: "a".repeat(64),
    planned_trial_count: 20,
    completed_trial_count: 18,
    failed_trial_count: 2,
    window_count: 5,
    created_at: "2026-05-15T00:00:00.000Z",
    source_artifacts: ["walk forward engine/strategies/demo/wfa_config.yaml"],
    notes: "Advisory optimizer context fixture.",
    ...overrides
  };
}

function nonWorkerAttempt(overrides = {}) {
  return {
    schema_version: "non_worker_denominator_attempts_v1",
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    attempt_id: "ATTEMPT-NON-WORKER-1",
    attempt_type: "llm_generated",
    generated_by: "operator_note",
    status: "rejected_pre_wfa",
    created_at: "2026-05-15T00:00:00.000Z",
    source_artifacts: ["factory/backlog.json"],
    notes: "Advisory denominator fixture.",
    ...overrides
  };
}

function attachMultipleComparisonContextArtifact(rootDir, executionResult, payload, { fileName = "multiple-comparison-context.json", sha256 = null } = {}) {
  const repoPath = path.join("factory", "runs", executionResult.worker_result?.run_id ?? executionResult.experiment_id ?? "RUN-MULTIPLE-COMPARISON", "denominator", fileName).replace(/\\/g, "/");
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(fullPath, content, "utf8");
  const artifact = {
    artifact_type: "multiple_comparison_context",
    path: repoPath,
    sha256: sha256 ?? sha256Text(content)
  };
  executionResult.artifacts_created = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  executionResult.artifacts_created.push(artifact);
  return artifact;
}

function attachPboInputArtifact(rootDir, executionResult, payload, { fileName = "pbo-input-matrix.json", sha256 = null } = {}) {
  const repoPath = path.join("factory", "runs", executionResult.worker_result?.run_id ?? executionResult.experiment_id ?? "RUN-PBO-INPUT", "stat-inputs", fileName).replace(/\\/g, "/");
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(fullPath, content, "utf8");
  const artifact = {
    artifact_type: "pbo_input_matrix",
    path: repoPath,
    sha256: sha256 ?? sha256Text(content)
  };
  executionResult.artifacts_created = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  executionResult.artifacts_created.push(artifact);
  return artifact;
}

function attachCpcvInputArtifact(rootDir, executionResult, payload, { fileName = "cpcv-input-matrix.json", sha256 = null } = {}) {
  const repoPath = path.join("factory", "runs", executionResult.worker_result?.run_id ?? executionResult.experiment_id ?? "RUN-CPCV-INPUT", "stat-inputs", fileName).replace(/\\/g, "/");
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(fullPath, content, "utf8");
  const artifact = {
    artifact_type: "cpcv_input_matrix",
    path: repoPath,
    sha256: sha256 ?? sha256Text(content)
  };
  executionResult.artifacts_created = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  executionResult.artifacts_created.push(artifact);
  return artifact;
}

function attachWhiteRealityCheckInputArtifact(rootDir, executionResult, payload, { fileName = "white-reality-check-input.json", sha256 = null } = {}) {
  const repoPath = path.join("factory", "runs", executionResult.worker_result?.run_id ?? executionResult.experiment_id ?? "RUN-WHITE-INPUT", "stat-inputs", fileName).replace(/\\/g, "/");
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(fullPath, content, "utf8");
  const artifact = {
    artifact_type: "white_reality_check_input",
    path: repoPath,
    sha256: sha256 ?? sha256Text(content)
  };
  executionResult.artifacts_created = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  executionResult.artifacts_created.push(artifact);
  return artifact;
}

function attachRawPboInputArtifact(rootDir, executionResult, content, { fileName = "pbo-input-matrix.json", sha256 = null } = {}) {
  const repoPath = path.join("factory", "runs", executionResult.worker_result?.run_id ?? executionResult.experiment_id ?? "RUN-PBO-INPUT", "stat-inputs", fileName).replace(/\\/g, "/");
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  const artifact = {
    artifact_type: "pbo_input_matrix",
    path: repoPath,
    sha256: sha256 ?? sha256Text(content)
  };
  executionResult.artifacts_created = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  executionResult.artifacts_created.push(artifact);
  return artifact;
}

function multipleComparisonContext(overrides = {}) {
  return {
    schema_version: "multiple_comparison_context_v1",
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    total_strategies_tested: 15,
    correction_method: "bh_fdr",
    adjusted_alpha: 0.025,
    nominal_alpha: 0.05,
    family_wise_error_rate: 0.05,
    correction_applied: true,
    correction_parameters_hash: "b".repeat(64),
    created_at: "2026-05-15T00:00:00.000Z",
    source_artifacts: ["factory/backlog.json", "factory/memory/lessons.jsonl"],
    notes: "Advisory multiple-comparison context fixture.",
    ...overrides
  };
}

function completeSearchDenominatorInputs() {
  const hash = "c".repeat(64);
  return {
    trialDenominator: {
      artifacts: [{ path: "factory/runs/RUN-DSR/denominator/trial-attempts.jsonl", sha256: hash, hash_verified: true }],
      attempts: [{ status: "completed", attempt_type: "worker_wfa", generated_by: "deterministic_worker", lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" }]
    },
    optimizerTrials: {
      artifacts: [{ path: "factory/runs/RUN-DSR/denominator/optimizer-trials.jsonl", sha256: hash, hash_verified: true, rows_read: 1 }]
    },
    optimizerSearchContext: {
      artifacts: [{ path: "factory/runs/RUN-DSR/denominator/optimizer-search-context.json", sha256: hash, hash_verified: true, records_read: 1, records_accepted: 1, records_rejected: 0 }],
      contexts: [optimizerSearchContext()]
    },
    nonWorkerDenominator: {
      artifacts: [{ path: "factory/runs/RUN-DSR/denominator/non-worker-denominator.jsonl", sha256: hash, hash_verified: true, records_read: 5, records_accepted: 5, records_rejected: 0 }],
      attempts: ["llm_generated", "manual", "mutation", "repair", "rerun"].map((attemptType) => nonWorkerAttempt({ attempt_id: `ATTEMPT-${attemptType.toUpperCase()}`, attempt_type: attemptType }))
    },
    multipleComparisonContext: {
      artifacts: [{ path: "factory/runs/RUN-DSR/denominator/multiple-comparison-context.json", sha256: hash, hash_verified: true, records_read: 1, records_accepted: 1, records_rejected: 0 }],
      contexts: [multipleComparisonContext({ total_strategies_tested: 15 })]
    }
  };
}

function dsrInputs(overrides = {}) {
  return {
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    observed_sharpe: 1.2,
    return_count: 300,
    return_skewness: 0,
    return_kurtosis: 3,
    trial_count: 15,
    benchmark_sharpe: 0,
    source_artifacts: [{ artifact_type: "dsr_input", path: "factory/runs/RUN-DSR/stat-inputs/oos-returns.json", sha256: "d".repeat(64), hash_verified: true }],
    ...overrides
  };
}

function pboInputs(overrides = {}) {
  return {
    schema_version: "pbo_input_matrix_v1",
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    split_ids: ["split_1", "split_2", "split_3", "split_4"],
    objective: { metric: "sharpe", direction: "maximize" },
    trial_count: 4,
    performance_matrix: [
      { trial_id: "TRIAL-A", is: [0.9, 0.7, 0.2, 0.1], oos: [0.1, 0.2, 0.3, 0.4] },
      { trial_id: "TRIAL-B", is: [0.2, 0.1, 0.9, 0.8], oos: [0.8, 0.7, 0.2, 0.1] },
      { trial_id: "TRIAL-C", is: [0.3, 0.4, 0.4, 0.3], oos: [0.5, 0.4, 0.5, 0.6] },
      { trial_id: "TRIAL-D", is: [0.1, 0.2, 0.1, 0.2], oos: [0.2, 0.3, 0.1, 0.2] }
    ],
    source_artifacts: [{ artifact_type: "pbo_input_matrix", path: "factory/runs/RUN-PBO/stat-inputs/is-oos-matrix.json", sha256: "e".repeat(64), hash_verified: true }],
    ...overrides
  };
}

function cpcvInputs(overrides = {}) {
  return {
    schema_version: "cpcv_input_matrix_v1",
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    objective: { metric: "sharpe", direction: "maximize" },
    fold_count: 4,
    combination_count: 4,
    benchmark_performance: 0,
    combinations: [
      { combination_id: "CPCV-1", train_group_ids: ["fold_1", "fold_2"], test_group_ids: ["fold_3"], oos_performance: 0.42, trade_count: 18 },
      { combination_id: "CPCV-2", train_group_ids: ["fold_1", "fold_3"], test_group_ids: ["fold_4"], oos_performance: 0.18, trade_count: 16 },
      { combination_id: "CPCV-3", train_group_ids: ["fold_2", "fold_4"], test_group_ids: ["fold_1"], oos_performance: -0.08, trade_count: 14 },
      { combination_id: "CPCV-4", train_group_ids: ["fold_3", "fold_4"], test_group_ids: ["fold_2"], oos_performance: 0.31, trade_count: 20 }
    ],
    source_artifacts: [{ artifact_type: "cpcv_input_matrix", path: "factory/runs/RUN-CPCV/stat-inputs/cpcv-matrix.json", sha256: "c".repeat(64), hash_verified: true }],
    ...overrides
  };
}

function whiteRealityCheckInputs(overrides = {}) {
  return {
    schema_version: "white_reality_check_input_v1",
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    objective: { metric: "sharpe", direction: "maximize" },
    benchmark_performance: 0,
    observed_best_performance: 0.42,
    trial_count: 6,
    null_distribution: [-0.1, 0.05, 0.12, 0.2, 0.5, 0.31],
    null_assumption: { method: "supplied_stationary_bootstrap", benchmark: "zero_edge" },
    source_metadata: { generated_by: "fixture", notes: "Advisory supplied-null fixture." },
    source_artifacts: [{ artifact_type: "white_reality_check_input", path: "factory/runs/RUN-WHITE/stat-inputs/white-input.json", sha256: "f".repeat(64), hash_verified: true }],
    ...overrides
  };
}

function attachCompleteResearchGateDenominator(rootDir, executionResult) {
  attachOptimizerSearchContextArtifact(rootDir, executionResult, optimizerSearchContext());
  attachMultipleComparisonContextArtifact(rootDir, executionResult, multipleComparisonContext());
  attachNonWorkerDenominatorArtifact(rootDir, executionResult, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MUTATION-1", attempt_type: "mutation" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-REPAIR-1", attempt_type: "repair" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-RERUN-1", attempt_type: "rerun" })
  ]);
}

function mutateWfaResultArtifacts(result, mutator) {
  for (const container of [result.artifacts_created, result.worker_result?.artifacts]) {
    for (const artifact of Array.isArray(container) ? container : []) {
      if (artifact.artifact_type === "wfa_result_artifact") mutator(artifact);
    }
  }
}

function createFakeWfaRoute(rootDir, { totalTrades = 12, successfulWindows = 2, scriptMode = "success", includeCoreMetrics = true, includePerWindowMetrics = true, includeAssumptions = true, includeOptionalArtifacts = false } = {}) {
  const wfaRoot = path.join(rootDir, "walk forward engine");
  fs.mkdirSync(path.join(wfaRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "strategies", "demo", "results"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "src", "strategies"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(wfaRoot, "strategies", "demo", "wfa_config.yaml"), includeAssumptions
    ? "walk_forward:\n  training_months: 3\n  testing_months: 1\n  step_months: 1\n  n_parameter_trials: 20\n  use_vectorized_backtest: true\n  performance_mode: true\n  output_directory: strategies/demo/results\ndata:\n  source_file: data/demo.csv\nstrategy:\n  profile_key: DEMO\nbacktest:\n  fees: 0.001\n  slippage: 0.0003\nperformance:\n  max_execution_time_seconds: 1800\n"
    : "walk_forward:\n  training_months: 3\n  testing_months: 1\n  step_months: 1\n  n_parameter_trials: 20\n  output_directory: strategies/demo/results\ndata:\n  source_file: data/demo.csv\nstrategy:\n  profile_key: DEMO\nperformance:\n  max_execution_time_seconds: 1800\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "src", "strategies", "demo.py"), "class DemoStrategy:\n    pass\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "config", "strategy_demo.json"), "{\"profile_key\":\"DEMO\"}\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "data", "demo.csv"), "timestamp,open,high,low,close,volume\n2026-01-01,1,1,1,1,1\n", "utf8");
  const scriptBody = scriptMode === "nonzero_exit"
    ? "process.stderr.write('fake WFA failed\\n');\nprocess.exit(7);\n"
    : scriptMode === "timeout"
      ? "console.log('fake WFA hanging');\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);\n"
      : `const fs = require('fs');
const path = require('path');
const out = path.join(process.cwd(), 'strategies', 'demo', 'results');
fs.mkdirSync(out, { recursive: true });
const result = {
  successful_windows: ${successfulWindows},
  total_windows: ${successfulWindows},
  ${includeAssumptions ? `config: {
    fees: 0.001,
    slippage: 0.0003,
    training_months: 3,
    testing_months: 1,
    step_months: 1,
    n_parameter_trials: 20,
    use_vectorized_backtest: true,
    performance_mode: true
  },
  execution_start_time: '2026-01-01T00:00:00+00:00',
  execution_end_time: '2026-01-01T00:00:03+00:00',
  total_execution_time_seconds: 3,` : ""}
  ${includeCoreMetrics ? `aggregate_sharpe_ratio: 0.82,
  aggregate_total_trades: ${totalTrades},
  aggregate_max_drawdown_pct: -0.04,
  aggregate_profit_factor: 1.25,
  aggregate_return_pct: 3.2,` : "notes: 'missing core metrics fixture',"}
  window_results: ${includePerWindowMetrics ? `[
    { window_id: 0, success: true, total_return_pct: 1.1, total_trades: Math.floor(${totalTrades} / 2), sharpe_ratio: 0.7, max_drawdown_pct: -0.02, best_parameters: { lookback: 10 } },
    { window_id: 1, success: true, total_return_pct: 2.1, total_trades: ${totalTrades} - Math.floor(${totalTrades} / 2), sharpe_ratio: 0.9, max_drawdown_pct: -0.04, best_parameters: { lookback: 10 } }
  ]` : "[]"}
};
fs.writeFileSync(path.join(out, 'walk_forward_results_20260513_000000.json'), JSON.stringify(result, null, 2) + '\\n');
fs.writeFileSync(path.join(out, 'analysis.json'), JSON.stringify({ metrics: { ${includeCoreMetrics ? `aggregate_sharpe: 0.82, total_trades: ${totalTrades}, max_drawdown_pct: -0.04,` : ""} successful_windows: ${successfulWindows}, failed_windows: 0 } }, null, 2) + '\\n');
${includeOptionalArtifacts ? `fs.writeFileSync(path.join(out, 'trades_ledger_20260513_000000.csv'), 'window_id,trade_id,pnl\\n0,T1,12.5\\n');
fs.writeFileSync(path.join(out, 'equity_curve_20260513_000000.csv'), 'timestamp,equity\\n2026-01-01,100000\\n');
fs.writeFileSync(path.join(out, 'optimizer_trials_20260513_000000.json'), JSON.stringify([{ window_id: 0, trial: 1, score: 0.82 }], null, 2) + '\\n');` : ""}
console.log('fake WFA finished');
`;
  fs.writeFileSync(path.join(wfaRoot, "scripts", "walk_forward_smoke_test.py"), scriptBody, "utf8");
}

function fakeWfaRequest(overrides = {}) {
  return {
    schema_version: "research_wfa_run_request_v1",
    run_id: "RUN-RESEARCH-WFA-RUN-1",
    job_id: "JOB-RESEARCH-WFA-RUN-1",
    candidate_id: "CAND-DEMO-WFA-001",
    lineage_id: "LINEAGE-DEMO-WFA",
    family_id: "FAMILY-DEMO-WFA",
    attempt_id: "ATTEMPT-1",
    attempt_type: "worker_launched_wfa",
    evidence_kind: "research_wfa",
    authority_layer: "python_research",
    wfa_config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
    strategy_source_paths: ["walk forward engine/src/strategies/demo.py"],
    strategy_config_paths: ["walk forward engine/config/strategy_demo.json"],
    data_paths: ["walk forward engine/data/demo.csv"],
    expected_output_root: "walk forward engine/strategies/demo/results",
    timeout_ms: 5000,
    working_directory: "walk forward engine",
    python_executable: process.execPath,
    environment_allowlist: ["PATH"],
    ...overrides
  };
}

test("planner validation rejects incomplete source selection and success criteria", () => {
  assert.throws(
    () => validatePlannerResult({
      experiment_id: "EXP-1",
      title: "Incomplete plan",
      objective: "Missing source selection and numeric gates should fail.",
      hypothesis: "This should be rejected.",
      strategy_rationale: "Too incomplete for execution.",
      strategy_type: "momentum",
      market_family: "crypto",
      instrument_scope: "BTCUSDT",
      timeframe: "1h",
      historical_depth_requirement: { target: "Demo", justification: "demo justification" },
      source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher" },
      scope_selection_rationale: "Scope rationale exists.",
      data_acquisition: {
        status: "present",
        reason: "Data exists.",
        acquisition_method: "existing_fetcher",
        expected_outputs: ["workspace/data/demo.csv"]
      },
      expected_artifacts: ["workspace/results/report.json"],
      evaluation_criteria: { status_gate: "artifact exists", metrics: {}, min_evidence_score: "bad" }
    }),
    /selection reason|numeric min_evidence_score|meaningful numeric metrics/i
  );
});

test("planner validation rejects placeholder ids and missing canonical WFA config paths", () => {
  const rootDir = createTempRoot();
  fs.mkdirSync(path.join(rootDir, "walk forward engine", "strategies", "existing_demo"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "walk forward engine", "strategies", "existing_demo", "wfa_config.yaml"), "demo: true\n", "utf8");

  assert.throws(
    () => validatePlannerResult({
      experiment_id: "EXP-20260404000000-NN",
      title: "Planner invented placeholder ids",
      objective: "Reject placeholder experiment ids and missing config paths in live planning.",
      hypothesis: "This plan should fail validation.",
      strategy_rationale: "Missing config path should not pass planner validation.",
      strategy_type: "multi_timeframe",
      market_family: "crypto",
      instrument_scope: "ETHUSDT",
      timeframe: "1h",
      historical_depth_requirement: { target: "3y", justification: "Need multi-year history for WFA." },
      source_plan: { allowed_source_families: ["binance"], primary_source_family: "binance", selection_reason: "Existing Binance data." },
      data_acquisition: {
        status: "present",
        reason: "Data exists.",
        acquisition_method: "existing_fetcher",
        expected_outputs: ["workspace/data/result_TIMESTAMP.csv"],
        sources: ["workspace/data/binance_ethusdt_1h_deep.csv"],
        commands: []
      },
      scope_selection_rationale: "ETH follow-up to prior run.",
      commands: ["cd \"walk forward engine\" && .venv/Scripts/python.exe scripts/walk_forward_smoke_test.py --config strategies/missing_demo/wfa_config.yaml"],
      expected_artifacts: ["factory/experiments/EXP-20260404000000-NN.plan.json", "walk forward engine/results/result_TIMESTAMP.json"],
      evaluation_criteria: { status_gate: "Need a real WFA run.", metrics: { min_sharpe_oos: 0.5 }, min_evidence_score: 70 }
    }, { rootDir }),
    /placeholder tokens|missing WFA config path/i
  );
});

test("execution validation rejects executed research WFA without worker-launched provenance", () => {
  assert.throws(
    () => validateExecutionResult({
      experiment_id: "EXP-1",
      status: "executed",
      artifacts_created: ["workspace/results/report.json"],
      metrics_observed: { sharpe_oos: 1.2, total_trades: 50 }
    }),
    /worker-launched worker_result/i
  );
});

test("execution validation rejects workerless research WFA even with provenance", () => {
  assert.throws(
    () => validateExecutionResult({
      experiment_id: "EXP-1",
      status: "executed",
      artifacts_created: ["workspace/results/report.json"],
      metrics_observed: { sharpe_oos: 1.2, total_trades: 50 },
      provenance: {
        engine: "other_engine",
        command: "python something_else.py",
        working_directory: "workspace",
        config_path: "workspace/config.yaml",
        result_artifacts: ["workspace/results/report.json"],
        windows_completed: 0
      }
    }),
    /worker-launched worker_result/i
  );
});

test("execution artifact validation rejects missing provenance result artifacts", () => {
  const rootDir = createTempRoot();
  fs.mkdirSync(path.join(rootDir, "workspace", "results"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "workspace", "results", "report.json"), "{}\n", "utf8");

  assert.throws(
    () => validateExecutionArtifacts(rootDir, {
      experiment_id: "EXP-1",
      status: "executed",
      artifacts_created: ["workspace/results/report.json"],
      metrics_observed: { sharpe_oos: 1.2, total_trades: 50 },
      provenance: {
        engine: "walk_forward_engine",
        command: "python scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
        working_directory: "walk forward engine",
        config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
        result_artifacts: ["walk forward engine/results/demo/summary.json"],
        windows_completed: 5
      }
    }),
    /missing result artifacts/i
  );
});

test("blocked execution validation requires structured blockers or errors and valid dataset evidence", () => {
  assert.throws(
    () => validateExecutionResult({
      experiment_id: "EXP-1",
      status: "blocked",
      blockers: [],
      errors: [],
      datasets_acquired: [{ source: "api", output: "workspace/data/demo.csv", rows: "bad" }]
    }),
    /structured errors or blockers|rows must be numeric/i
  );
});

test("evaluator validation rejects non-existent checked artifacts and missing metric verification sources", () => {
  const rootDir = createTempRoot();
  fs.mkdirSync(path.join(rootDir, "workspace", "results"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "workspace", "results", "report.json"), "{}\n", "utf8");

  assert.throws(
    () => validateEvaluationResult({
      verdict: "inconclusive",
      evidence_score: 50,
      overall_score: 40,
      metrics: { sharpe_oos: 0.3 },
      red_flags: [],
      verification: {
        artifacts_checked: ["workspace/results/missing.json"],
        metrics_verified_from: []
      },
      missing_evidence: [],
      promote_to_leaderboard: false,
      confidence_level: "medium",
      confidence_rationale: "Test rationale"
    }, { mode: "live", rootDir }),
    /missing artifacts|metric verification sources/i
  );
});

test("evaluator validation rejects positive WFA verdicts without artifact-backed promotion metrics", () => {
  const rootDir = createTempRoot();
  const metricsPath = path.join(rootDir, "walk forward engine", "strategies", "demo", "results", "walk_forward_results.json");
  fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.writeFileSync(metricsPath, JSON.stringify({
    aggregate_sharpe_ratio: 1.2,
    aggregate_total_trades: 220,
    aggregate_return_pct: 8.5,
    positive_sharpe_windows_pct: 0.75
  }, null, 2) + "\n", "utf8");

  assert.throws(
    () => validateEvaluationResult({
      verdict: "promising",
      evidence_score: 80,
      overall_score: 70,
      metrics: {
        sharpe_oos: 1.2,
        aggregate_return_pct: 8.5,
        total_trades: 220,
        windows_completed: 8,
        positive_sharpe_windows_pct: 0.75
      },
      red_flags: [],
      verification: {
        artifacts_checked: ["walk forward engine/strategies/demo/results/walk_forward_results.json"],
        metrics_verified_from: ["walk forward engine/strategies/demo/results/walk_forward_results.json"]
      },
      missing_evidence: [],
      promote_to_leaderboard: false,
      confidence_level: "medium",
      confidence_rationale: "Positive WFA labels require artifact-backed windows, trades, and return."
    }, { mode: "live", rootDir, evidenceKind: "research_wfa" }),
    /artifact-backed promotion metrics|windows_completed/i
  );
});

test("evaluator validation accepts positive WFA verdicts when required metrics are artifact-backed", () => {
  const rootDir = createTempRoot();
  const metricsPath = path.join(rootDir, "walk forward engine", "strategies", "demo", "results", "walk_forward_results.json");
  fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.writeFileSync(metricsPath, JSON.stringify({
    successful_windows: 8,
    aggregate_total_trades: 220,
    aggregate_return_pct: 8.5,
    aggregate_sharpe_ratio: 1.2,
    positive_sharpe_windows_pct: 0.75
  }, null, 2) + "\n", "utf8");

  assert.doesNotThrow(
    () => validateEvaluationResult({
      verdict: "promising",
      evidence_score: 80,
      overall_score: 70,
      metrics: {
        sharpe_oos: 1.2,
        aggregate_return_pct: 8.5,
        total_trades: 220,
        windows_completed: 8,
        positive_sharpe_windows_pct: 0.75
      },
      red_flags: [],
      verification: {
        artifacts_checked: ["walk forward engine/strategies/demo/results/walk_forward_results.json"],
        metrics_verified_from: ["walk forward engine/strategies/demo/results/walk_forward_results.json"]
      },
      missing_evidence: [],
      promote_to_leaderboard: false,
      confidence_level: "medium",
      confidence_rationale: "Cited WFA artifacts back the required positive-label metrics."
    }, { mode: "live", rootDir, evidenceKind: "research_wfa" })
  );
});

test("summarizer validation rejects generic lessons and generic next actions", () => {
  assert.throws(
    () => validateSummaryResult({
      experiment_id: "EXP-1",
      backlog_item_id: "IDEA-1",
      summary: "This run completed with mixed evidence and a clear next step.",
      key_lessons: [{ lesson: "Further research is needed." }],
      next_actions: [{ action: "Continue iterating." }]
    }),
    /generic boilerplate/i
  );
});

test("workerless canonical research WFA no longer satisfies executed validation", () => {
  const rootDir = createTempRoot();
  fs.mkdirSync(path.join(rootDir, "workspace", "results"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "walk forward engine", "results", "demo"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "workspace", "results", "report.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(rootDir, "walk forward engine", "results", "demo", "summary.json"), JSON.stringify({ sharpe_oos: 1.2, total_trades: 50 }, null, 2) + "\n", "utf8");

  const result = {
    experiment_id: "EXP-1",
    status: "executed",
    artifacts_created: ["workspace/results/report.json"],
    metrics_observed: { sharpe_oos: 1.2, total_trades: 50 },
    provenance: {
      engine: "walk_forward_engine",
      command: "python scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
      working_directory: "walk forward engine",
      config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
      result_artifacts: ["walk forward engine/results/demo/summary.json"],
      windows_completed: 5
    }
  };

  assert.throws(() => validateExecutionResult(result), /worker-launched worker_result/i);
});

test("research WFA run worker launches WFA and passes Phase 7A validation", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const request = fakeWfaRequest();

  assert.doesNotThrow(() => validateResearchWfaRunRequest(request, { rootDir }));
  const result = runResearchWfaRunWorker({ rootDir, request });

  assert.equal(result.status, "executed");
  assert.equal(result.worker_result.worker, "research_wfa_run");
  assert.equal(result.worker_result.schema_version, "research_wfa_run_worker_v1");
  assert.equal(result.observations.execution_was_run_by_this_worker, true);
  assert.equal(result.metrics_observed.total_trades, 12);
  assert.equal(result.provenance.windows_completed, 2);
  assert.equal(result.worker_result.artifacts.some((artifact) => artifact.artifact_type === "stdout"), true);
  assert.equal(result.worker_result.artifacts.some((artifact) => artifact.artifact_type === "stderr"), true);
  assert.equal(result.observations.stale_output_guard.passed, true);
  assert.equal(result.worker_result.artifacts.filter((artifact) => artifact.artifact_type === "wfa_result_artifact").every((artifact) => artifact.request_identity?.run_id === request.run_id), true);
  assert.equal(result.source_hashes.some((artifact) => artifact.artifact_type === "wfa_config"), true);
  assert.equal(result.source_hashes.some((artifact) => artifact.artifact_type === "strategy_source"), true);
  assert.equal(result.source_hashes.some((artifact) => artifact.artifact_type === "strategy_config"), true);
  assert.equal(result.source_hashes.some((artifact) => artifact.artifact_type === "data_input"), true);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "research_wfa" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
});

test("research WFA run worker mirrors completed attempt evidence into SQLite", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const request = fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-LEDGER", job_id: "JOB-RESEARCH-WFA-LEDGER", attempt_id: "ATTEMPT-LEDGER-1" });
  const result = runResearchWfaRunWorker({ rootDir, request });
  const ledger = new RuntimeLedger({ rootDir });

  try {
    const run = ledger.getRun(request.run_id);
    const job = ledger.getJob(request.job_id);
    const attempt = ledger.getJobAttempt(request.attempt_id);
    const artifacts = ledger.db.prepare("SELECT * FROM artifacts WHERE run_id = ? AND job_id = ? AND attempt_id = ? ORDER BY artifact_type").all(request.run_id, request.job_id, request.attempt_id);
    const trial = ledger.getTrialAttempt(`${request.run_id}:${request.attempt_id}`);

    assert.equal(result.status, "executed");
    assert.equal(run.status, "executed");
    assert.equal(run.evidence_kind, "research_wfa");
    assert.equal(job.status, "executed");
    assert.equal(job.job_type, "research_wfa_run");
    assert.equal(attempt.status, "succeeded");
    assert.equal(attempt.worker, "research_wfa_run");
    assert.equal(artifacts.some((artifact) => artifact.artifact_type === "worker_result_json"), true);
    assert.equal(artifacts.some((artifact) => artifact.artifact_type === "execution_result_json"), true);
    assert.equal(artifacts.some((artifact) => artifact.artifact_type === "wfa_result_artifact"), true);
    assert.equal(trial.status, "succeeded");
    assert.equal(JSON.parse(trial.payload_json).attempt_type, "worker_launched_wfa");
  } finally {
    ledger.close();
  }
});

test("research WFA run worker mirrors blocked attempt evidence into SQLite", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { successfulWindows: 0 });
  const request = fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-LEDGER-BLOCKED", job_id: "JOB-RESEARCH-WFA-LEDGER-BLOCKED", attempt_id: "ATTEMPT-LEDGER-BLOCKED-1" });
  const result = runResearchWfaRunWorker({ rootDir, request });
  const ledger = new RuntimeLedger({ rootDir });

  try {
    const artifacts = ledger.db.prepare("SELECT artifact_type FROM artifacts WHERE run_id = ? AND job_id = ? AND attempt_id = ?").all(request.run_id, request.job_id, request.attempt_id);

    assert.equal(result.status, "blocked");
    assert.equal(ledger.getRun(request.run_id).status, "blocked");
    assert.equal(ledger.getJob(request.job_id).status, "blocked");
    assert.equal(ledger.getJobAttempt(request.attempt_id).status, "blocked");
    assert.equal(ledger.getTrialAttempt(`${request.run_id}:${request.attempt_id}`).status, "blocked");
    assert.equal(artifacts.some((artifact) => artifact.artifact_type === "stdout"), true);
    assert.equal(artifacts.some((artifact) => artifact.artifact_type === "worker_result_json"), true);
  } finally {
    ledger.close();
  }
});

test("research WFA run worker keeps JSON artifacts as projections when ledger mirror succeeds", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const request = fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-JSON-PROJECTION", job_id: "JOB-RESEARCH-WFA-JSON-PROJECTION" });
  const result = runResearchWfaRunWorker({ rootDir, request });
  const workerResultPath = path.join(rootDir, "factory", "runs", request.run_id, "worker-results", "research-wfa-run-worker-result.json");
  const executionResultPath = path.join(rootDir, "factory", "runs", request.run_id, "execution-result.json");

  assert.equal(result.status, "executed");
  assert.equal(fs.existsSync(workerResultPath), true);
  assert.equal(fs.existsSync(executionResultPath), true);
  assert.equal(JSON.parse(fs.readFileSync(workerResultPath, "utf8")).schema_version, "research_wfa_run_worker_v1");
  assert.equal(JSON.parse(fs.readFileSync(executionResultPath, "utf8")).status, "executed");
});

test("research WFA run worker fails loud when SQLite mirror fails after JSON artifacts", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  fs.mkdirSync(path.join(rootDir, "factory"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "factory", "runtime"), "not a directory\n", "utf8");
  const request = fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-LEDGER-FAIL", job_id: "JOB-RESEARCH-WFA-LEDGER-FAIL" });
  const workerResultPath = path.join(rootDir, "factory", "runs", request.run_id, "worker-results", "research-wfa-run-worker-result.json");
  const executionResultPath = path.join(rootDir, "factory", "runs", request.run_id, "execution-result.json");

  assert.throws(() => runResearchWfaRunWorker({ rootDir, request }), /EEXIST|ENOTDIR|not a directory/i);
  assert.equal(fs.existsSync(workerResultPath), true);
  assert.equal(fs.existsSync(executionResultPath), true);
});

test("research WFA run worker records artifact-backed cost and timing assumptions", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-ASSUMPTIONS", job_id: "JOB-RESEARCH-WFA-ASSUMPTIONS" }) });

  const cost = result.observations.cost_assumptions;
  const timing = result.observations.timing_assumptions;
  assert.equal(cost.available, true);
  assert.equal(cost.values.fees.value, 0.001);
  assert.equal(cost.values.fees.source_path, result.observations.metrics_artifact_path);
  assert.equal(cost.values.fees.source_field, "config.fees");
  assert.equal(cost.values.slippage.value, 0.0003);
  assert.equal(timing.available, true);
  assert.equal(timing.values.training_months.value, 3);
  assert.equal(timing.values.training_months.source_path, result.observations.metrics_artifact_path);
  assert.equal(timing.values.training_months.source_field, "config.training_months");
  assert.equal(timing.values.max_execution_time_seconds.value, 1800);
  assert.equal(timing.values.max_execution_time_seconds.source_path, "walk forward engine/strategies/demo/wfa_config.yaml");
  assert.equal(timing.values.total_execution_time_seconds.value, 3);
  assert.equal(timing.values.total_execution_time_seconds.source_path, result.observations.metrics_artifact_path);
  assert.match(cost.values.fees.source_sha256, /^[a-f0-9]{64}$/);
  assert.match(timing.values.max_execution_time_seconds.source_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker records missing diagnostics when cost and timing assumptions are absent", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2, includeAssumptions: false });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-MISSING-ASSUMPTIONS", job_id: "JOB-RESEARCH-WFA-MISSING-ASSUMPTIONS" }) });

  assert.equal(result.status, "executed");
  assert.equal(result.observations.cost_assumptions.available, false);
  assert.match(result.observations.cost_assumptions.missing_because, /No fees or slippage fields/i);
  assert.equal(result.observations.timing_assumptions.available, true);
  assert.equal(result.observations.timing_assumptions.values.training_months.value, 3);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker records missing diagnostics for absent optional separate artifacts", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-MISSING-OPTIONAL", job_id: "JOB-RESEARCH-WFA-MISSING-OPTIONAL" }) });
  const optional = result.observations.optional_wfa_artifacts;

  assert.equal(optional.trade_ledger.available, false);
  assert.match(optional.trade_ledger.missing_because, /No separate trade ledger artifact/i);
  assert.equal(optional.equity_curve.available, false);
  assert.match(optional.equity_curve.missing_because, /No separate equity curve artifact/i);
  assert.equal(optional.optimizer_trials.available, false);
  assert.match(optional.optimizer_trials.missing_because, /parameter-stability summaries are not counted/i);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker hashes and classifies optional separate artifacts when emitted", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-OPTIONAL-ARTIFACTS", job_id: "JOB-RESEARCH-WFA-OPTIONAL-ARTIFACTS" }) });
  const optional = result.observations.optional_wfa_artifacts;

  assert.equal(optional.trade_ledger.available, true);
  assert.equal(optional.trade_ledger.artifacts[0].artifact_type, "wfa_trade_ledger");
  assert.match(optional.trade_ledger.artifacts[0].path, /trades_ledger_20260513_000000\.csv$/);
  assert.match(optional.trade_ledger.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(optional.equity_curve.available, true);
  assert.equal(optional.equity_curve.artifacts[0].artifact_type, "wfa_equity_curve");
  assert.equal(optional.optimizer_trials.available, true);
  assert.equal(optional.optimizer_trials.artifacts[0].artifact_type, "wfa_optimizer_trials");
  assert.equal(result.worker_result.artifacts.some((artifact) => artifact.artifact_type === "wfa_trade_ledger"), true);
  assert.equal(result.worker_result.artifacts.some((artifact) => artifact.artifact_type === "wfa_equity_curve"), true);
  assert.equal(result.worker_result.artifacts.some((artifact) => artifact.artifact_type === "wfa_optimizer_trials"), true);
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
});

test("research WFA run request validation is strict about trial lineage and environment scope", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir);

  assert.throws(() => validateResearchWfaRunRequest(fakeWfaRequest({ lineage_id: null }), { rootDir }), /lineage_id is required/i);
  assert.throws(() => validateResearchWfaRunRequest(fakeWfaRequest({ family_id: "" }), { rootDir }), /family_id is required/i);
  assert.throws(() => validateResearchWfaRunRequest(fakeWfaRequest({ environment_allowlist: [] }), { rootDir }), /environment_allowlist must be a non-empty array/i);
  assert.throws(() => validateResearchWfaRunRequest(fakeWfaRequest({ environment_allowlist: ["PATH=/tmp"] }), { rootDir }), /environment variable name/i);
  assert.throws(() => validateResearchWfaRunRequest(fakeWfaRequest({ candidate_id: null, candidate_scoped: true }), { rootDir }), /candidate-scoped WFA requests require candidate_id/i);
  assert.doesNotThrow(() => validateResearchWfaRunRequest(fakeWfaRequest({ candidate_id: null }), { rootDir }));
});

test("research WFA validation rejects false worker-run provenance", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-FALSE-PROVENANCE", job_id: "JOB-RESEARCH-WFA-FALSE-PROVENANCE" }) });
  const forged = cloneJson(result);
  forged.observations.execution_was_run_by_this_worker = false;
  forged.worker_result.observations.execution_was_run_by_this_worker = false;

  assert.throws(() => validateExecutionResult(forged), /execution_was_run_by_this_worker: true/i);
});

test("research WFA validation rejects missing stdout/stderr evidence and hash mismatch", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-ARTIFACT-GUARD", job_id: "JOB-RESEARCH-WFA-ARTIFACT-GUARD" }) });

  for (const artifactType of ["stdout", "stderr"]) {
    const missing = cloneJson(result);
    missing.artifacts_created = missing.artifacts_created.filter((artifact) => artifact.artifact_type !== artifactType);
    missing.worker_result.artifacts = missing.worker_result.artifacts.filter((artifact) => artifact.artifact_type !== artifactType);
    assert.throws(() => validateExecutionResult(missing), new RegExp(`${artifactType} artifact evidence`, "i"));
  }

  const stdoutArtifact = result.worker_result.artifacts.find((artifact) => artifact.artifact_type === "stdout");
  fs.writeFileSync(path.join(rootDir, stdoutArtifact.path), "tampered stdout\n", "utf8");
  assert.throws(() => validateExecutionArtifacts(rootDir, result), /Artifact hash mismatch/i);
});

test("research WFA validation rejects missing input hash evidence", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-MISSING-HASHES", job_id: "JOB-RESEARCH-WFA-MISSING-HASHES" }) });

  for (const artifactType of ["wfa_config", "strategy_source", "strategy_config", "data_input"]) {
    const missing = cloneJson(result);
    missing.source_hashes = missing.source_hashes.filter((artifact) => artifact.artifact_type !== artifactType);
    missing.worker_result.source_hashes = missing.worker_result.source_hashes.filter((artifact) => artifact.artifact_type !== artifactType);
    const pattern = artifactType === "data_input" ? /data input or data manifest hash evidence/i : new RegExp(`${artifactType} input hash evidence`, "i");
    assert.throws(() => validateExecutionResult(missing), pattern);
  }
});

test("research WFA validation rejects stale accepted output artifacts", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-STALE-OUTPUT", job_id: "JOB-RESEARCH-WFA-STALE-OUTPUT" }) });
  const forged = cloneJson(result);
  const staleDate = new Date(Date.parse(forged.observations.worker_start_time) - 10_000);
  mutateWfaResultArtifacts(forged, (artifact) => {
    artifact.modified_at = staleDate.toISOString();
  });

  assert.throws(() => validateExecutionResult(forged), /stale output artifacts/i);

  const diskStale = cloneJson(result);
  mutateWfaResultArtifacts(diskStale, (artifact) => {
    fs.utimesSync(path.join(rootDir, artifact.path), staleDate, staleDate);
  });
  assert.throws(() => validateExecutionArtifacts(rootDir, diskStale), /predate worker start/i);
});

test("research WFA validation rejects copied output artifacts with mismatched request identity", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-IDENTITY", job_id: "JOB-RESEARCH-WFA-IDENTITY" }) });

  for (const [field, value] of [["run_id", "RUN-OTHER"], ["job_id", "JOB-OTHER"], ["candidate_id", "CAND-OTHER-001"], ["attempt_id", "ATTEMPT-OTHER"]]) {
    const copied = cloneJson(result);
    mutateWfaResultArtifacts(copied, (artifact) => {
      artifact.request_identity[field] = value;
    });
    assert.throws(() => validateExecutionResult(copied), /mismatched request identity/i);
  }
});

test("research WFA run worker preserves zero-trade attempts without executed evidence", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 0, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-ZERO-TRADES", job_id: "JOB-RESEARCH-WFA-ZERO-TRADES" }) });

  assert.equal(result.status, "inconclusive");
  assert.equal(result.worker_result.status, "inconclusive");
  assert.match(result.blocked_reason, /zero trades/i);
  assert.equal(result.observations.zero_trade_policy, "preserved_as_inconclusive_not_executed");
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker blocks zero completed windows without executed evidence", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 12, successfulWindows: 0 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-ZERO-WINDOWS", job_id: "JOB-RESEARCH-WFA-ZERO-WINDOWS" }) });

  assert.equal(result.status, "blocked");
  assert.equal(result.worker_result.status, "blocked");
  assert.equal(result.worker_result.diagnostics.error_code, "wfa_zero_completed_windows");
  assert.match(result.blocked_reason, /zero successful walk-forward windows/i);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker blocks missing aggregate WFA metrics", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { includeCoreMetrics: false });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-MISSING-AGGREGATE", job_id: "JOB-RESEARCH-WFA-MISSING-AGGREGATE" }) });

  assert.equal(result.status, "blocked");
  assert.equal(result.worker_result.diagnostics.error_code, "wfa_missing_metrics_artifact");
  assert.match(result.blocked_reason, /no parseable artifact-backed metrics JSON/i);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker blocks missing per-window metrics", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { includePerWindowMetrics: false });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-MISSING-WINDOW-METRICS", job_id: "JOB-RESEARCH-WFA-MISSING-WINDOW-METRICS" }) });

  assert.equal(result.status, "blocked");
  assert.equal(result.worker_result.diagnostics.error_code, "wfa_missing_per_window_metrics");
  assert.match(result.blocked_reason, /per-window metrics/i);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker preserves non-zero exit diagnostics and trial record", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { scriptMode: "nonzero_exit" });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-NONZERO", job_id: "JOB-RESEARCH-WFA-NONZERO" }) });
  const trialRecord = result.worker_result.artifacts.find((artifact) => artifact.artifact_type === "trial_attempt_record");

  assert.equal(result.status, "failed");
  assert.equal(result.worker_result.diagnostics.error_code, "wfa_nonzero_exit");
  assert.equal(result.observations.exit_code, 7);
  assert.match(result.blocked_reason, /non-zero: 7/i);
  assert.equal(fs.existsSync(path.join(rootDir, trialRecord.path)), true);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA run worker preserves timeout diagnostics and trial record", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { scriptMode: "timeout" });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-TIMEOUT", job_id: "JOB-RESEARCH-WFA-TIMEOUT", timeout_ms: 10 }) });
  const trialRecord = result.worker_result.artifacts.find((artifact) => artifact.artifact_type === "trial_attempt_record");

  assert.equal(result.status, "failed");
  assert.equal(result.worker_result.diagnostics.error_code, "wfa_timeout");
  assert.equal(result.observations.timed_out, true);
  assert.match(result.blocked_reason, /timed out/i);
  assert.equal(fs.existsSync(path.join(rootDir, trialRecord.path)), true);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA artifact validation rejects unbacked claimed metrics without worker envelope", () => {
  const rootDir = createTempRoot();
  fs.mkdirSync(path.join(rootDir, "walk forward engine", "results", "demo"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "walk forward engine", "results", "demo", "summary.json"), "{}\n", "utf8");

  assert.throws(
    () => validateExecutionArtifacts(rootDir, {
      experiment_id: "EXP-UNBACKED-WFA-METRICS",
      status: "executed",
      evidence_kind: "research_wfa",
      artifacts_created: ["walk forward engine/results/demo/summary.json"],
      metrics_observed: { sharpe_oos: 1.2, total_trades: 50, max_drawdown: -0.05 },
      provenance: {
        engine: "walk_forward_engine",
        command: "python scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
        working_directory: "walk forward engine",
        config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
        result_artifacts: ["walk forward engine/results/demo/summary.json"],
        windows_completed: 5
      }
    }),
    /deterministic WFA metric artifact/i
  );
});

test("research WFA envelope worker represents existing WFA artifacts with worker result", () => {
  const rootDir = createTempRoot();
  const configPath = path.join(rootDir, "walk forward engine", "strategies", "demo", "wfa_config.yaml");
  const resultPath = path.join(rootDir, "walk forward engine", "results", "demo", "summary.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(configPath, "strategy: demo\n", "utf8");
  fs.writeFileSync(resultPath, JSON.stringify({ windows_completed: 4, sharpe_oos: 0.7 }, null, 2) + "\n", "utf8");

  const result = runResearchWfaEnvelopeWorker({
    rootDir,
    runId: "RUN-RESEARCH-WFA-ENVELOPE-1",
    jobId: "JOB-RESEARCH-WFA-ENVELOPE-1",
    candidateId: "CAND-DEMO-WFA-001",
    experimentId: "EXP-RESEARCH-WFA-ENVELOPE-1",
    observedAt: "2026-05-02T00:00:00.000Z",
    configPath: "walk forward engine/strategies/demo/wfa_config.yaml",
    resultArtifacts: ["walk forward engine/results/demo/summary.json"],
    metricsObserved: { sharpe_is: 0.9, sharpe_oos: 0.7, wfr: 0.6, total_trades: 44, max_drawdown: -0.08 },
    windowsCompleted: 4
  });

  assert.equal(result.status, "executed");
  assert.equal(result.evidence_kind, "research_wfa");
  assert.equal(result.candidate_id, "CAND-DEMO-WFA-001");
  assert.equal(result.authority_layer, "python_research");
  assert.equal(result.worker_result.status, "succeeded");
  assert.equal(result.worker_result.candidate_id, "CAND-DEMO-WFA-001");
  assert.equal(result.observations.candidate_id, "CAND-DEMO-WFA-001");
  assert.equal(result.worker_result.authority_layer, "python_research");
  assert.equal(result.provenance.engine, "walk_forward_engine");
  assert.equal(result.provenance.result_artifacts[0], "walk forward engine/results/demo/summary.json");
  assert.equal(result.observations.envelope_scope, "officialized_existing_output");
  assert.equal(result.observations.execution_was_run_by_this_worker, false);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "research_wfa" }));
  assert.throws(() => validateExecutionResult(result), /Phase 7A research_wfa_run worker schema/i);
});

test("research WFA envelope worker blocks without canonical WFA artifacts", () => {
  const rootDir = createTempRoot();
  const result = runResearchWfaEnvelopeWorker({
    rootDir,
    runId: "RUN-RESEARCH-WFA-ENVELOPE-BLOCKED",
    jobId: "JOB-RESEARCH-WFA-ENVELOPE-BLOCKED",
    experimentId: "EXP-RESEARCH-WFA-ENVELOPE-BLOCKED",
    observedAt: "2026-05-02T00:00:00.000Z"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.worker_result.status, "blocked");
  assert.match(result.blocked_reason, /canonical config path missing/i);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { evidenceKind: "research_wfa" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("research WFA envelope worker can ingest existing execution-result provenance", () => {
  const rootDir = createTempRoot();
  const configPath = path.join(rootDir, "walk forward engine", "strategies", "demo", "wfa_config.yaml");
  const resultPath = path.join(rootDir, "walk forward engine", "strategies", "demo", "results", "walk_forward_results.json");
  const sourceExecutionPath = path.join(rootDir, "factory", "runs", "RUN-SOURCE-WFA", "execution-result.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.mkdirSync(path.dirname(sourceExecutionPath), { recursive: true });
  fs.writeFileSync(configPath, "strategy: demo\n", "utf8");
  fs.writeFileSync(resultPath, JSON.stringify({ aggregate_sharpe_ratio: 1.1 }, null, 2) + "\n", "utf8");
  fs.writeFileSync(sourceExecutionPath, JSON.stringify({
    experiment_id: "EXP-SOURCE-WFA",
    candidate_id: "CAND-SOURCE-WFA-001",
    status: "executed",
    metrics_observed: { sharpe_oos: 1.1, total_trades: 77, max_drawdown: -0.05 },
    provenance: {
      engine: "walk_forward_engine",
      command: "cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
      working_directory: "walk forward engine",
      config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
      result_artifacts: ["walk forward engine/strategies/demo/results/walk_forward_results.json"],
      windows_completed: 6
    }
  }, null, 2) + "\n", "utf8");

  const result = runResearchWfaEnvelopeWorker({
    rootDir,
    runId: "RUN-RESEARCH-WFA-INGEST-1",
    jobId: "JOB-RESEARCH-WFA-INGEST-1",
    observedAt: "2026-05-02T00:00:00.000Z",
    executionResultPath: "factory/runs/RUN-SOURCE-WFA/execution-result.json"
  });

  assert.equal(result.status, "executed");
  assert.equal(result.experiment_id, "EXP-SOURCE-WFA");
  assert.equal(result.candidate_id, "CAND-SOURCE-WFA-001");
  assert.equal(result.worker_result.candidate_id, "CAND-SOURCE-WFA-001");
  assert.equal(result.worker_result.metrics.sharpe_oos, 1.1);
  assert.equal(result.provenance.windows_completed, 6);
  assert.equal(result.worker_result.artifacts.some((artifact) => artifact.artifact_type === "source_execution_result"), true);
  assert.equal(result.observations.envelope_scope, "officialized_existing_output");
  assert.throws(() => validateExecutionResult(result), /Phase 7A research_wfa_run worker schema/i);
});

test("research WFA validation rejects mismatched candidate ids", () => {
  const rootDir = createTempRoot();
  createFakeWfaRoute(rootDir, { totalTrades: 18, successfulWindows: 2 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-WFA-CANDIDATE-MISMATCH", job_id: "JOB-RESEARCH-WFA-CANDIDATE-MISMATCH" }) });
  result.candidate_id = "CAND-DIFFERENT-WFA-001";

  assert.throws(() => validateExecutionResult(result), /candidate_id must match/i);
});

test("mt5_snapshot executed result passes without WFA metrics when worker artifact hash matches", () => {
  const rootDir = createTempRoot();
  const snapshotPath = path.join(rootDir, "factory", "mt5", "environment", "snapshot.json");
  const snapshotBody = JSON.stringify({ terminal: { build: 4150 }, account: { server: "FTMO-Demo" } }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, snapshotBody, "utf8");
  const snapshotHash = sha256Text(snapshotBody);

  const observations = {
    terminal: { build: 4150, path_label: "fixture" },
    account: { server: "FTMO-Demo", currency: "USD", mode: "demo" },
    symbol: { name: "EURUSD", digits: 5, contract_size: 100000 },
    data_identity: { timeframe: "M15", source_type: "mt5_terminal", coverage: "fixture" },
    snapshot_sha256: snapshotHash
  };
  const workerResult = {
    job_id: "JOB-MT5-SNAPSHOT-1",
    run_id: "RUN-MT5-SNAPSHOT-1",
    candidate_id: null,
    worker: "mt5_snapshot",
    evidence_kind: "mt5_snapshot",
    authority_layer: "mt5_terminal",
    schema_version: "1.0",
    status: "succeeded",
    artifacts: [{ artifact_type: "environment_identity", path: "factory/mt5/environment/snapshot.json", sha256: snapshotHash }],
    metrics: {},
    observations,
    blocked_reason: null,
    source_hashes: [],
    diagnostics: { error_code: null, message: null, stdout_path: null, stderr_path: null },
    environment: {}
  };
  const result = {
    experiment_id: "EXP-MT5-SNAPSHOT-1",
    status: "executed",
    evidence_kind: "mt5_snapshot",
    authority_layer: "mt5_terminal",
    observed_at: "2026-04-28T00:00:00.000Z",
    artifacts_created: ["factory/mt5/environment/snapshot.json"],
    observations,
    worker_result: workerResult
  };

  assert.doesNotThrow(() => validateWorkerResultEnvelope(workerResult, { requireSucceeded: true, evidenceKind: "mt5_snapshot" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
});

test("mt5_snapshot validation rejects missing worker envelope and mismatched hashes", () => {
  const rootDir = createTempRoot();
  const snapshotPath = path.join(rootDir, "factory", "mt5", "environment", "snapshot.json");
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, "{}\n", "utf8");
  const goodHash = sha256Text("{}\n");
  const badHash = "0".repeat(64);
  const observations = {
    terminal: { build: 4150 },
    account: { server: "FTMO-Demo" },
    symbol: { name: "EURUSD" },
    data_identity: { timeframe: "M15" },
    snapshot_sha256: goodHash
  };
  const baseResult = {
    experiment_id: "EXP-MT5-SNAPSHOT-2",
    status: "executed",
    evidence_kind: "mt5_snapshot",
    authority_layer: "mt5_terminal",
    observed_at: "2026-04-28T00:00:00.000Z",
    artifacts_created: ["factory/mt5/environment/snapshot.json"],
    observations
  };

  assert.throws(() => validateExecutionResult(baseResult), /worker_result envelope/i);

  const workerResult = {
    job_id: "JOB-MT5-SNAPSHOT-2",
    run_id: "RUN-MT5-SNAPSHOT-2",
    worker: "mt5_snapshot",
    evidence_kind: "mt5_snapshot",
    authority_layer: "mt5_terminal",
    schema_version: "1.0",
    status: "succeeded",
    artifacts: [{ artifact_type: "environment_identity", path: "factory/mt5/environment/snapshot.json", sha256: badHash }],
    metrics: {},
    observations,
    blocked_reason: null,
    source_hashes: [],
    diagnostics: {},
    environment: {}
  };
  const hashedResult = { ...baseResult, worker_result: workerResult };

  assert.doesNotThrow(() => validateExecutionResult(hashedResult));
  assert.throws(() => validateExecutionArtifacts(rootDir, hashedResult), /hash mismatch/i);
});











test("buildStageGateResult records a machine-readable gate decision", () => {
  const gate = buildStageGateResult({
    runId: "RUN-1",
    stage: "executor",
    attempt: 2,
    decision: "allowed",
    validator: "stage_gate",
    evidencePaths: ["factory/runs/RUN-1/executor-attempt-2/stage-validated.json"],
    reason: null
  });

  assert.equal(gate.schema_version, "stage_gate_v1");
  assert.equal(gate.stage, "executor");
  assert.equal(gate.decision, "allowed");
  assert.deepEqual(gate.evidence_paths, ["factory/runs/RUN-1/executor-attempt-2/stage-validated.json"]);
});

test("research WFA promotion gate denies negative WFA candidates", () => {
  const gate = buildResearchWfaPromotionGate({
    runId: "RUN-NEGATIVE-WFA-GATE",
    candidateId: "CAND-NEGATIVE-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-NEGATIVE-WFA-001",
      metrics_observed: {
        sharpe_oos: -0.4048,
        aggregate_return_pct: -0.077,
        profit_factor: 0.8753,
        total_trades: 912
      },
      provenance: {
        result_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"]
      }
    }
  });

  assert.equal(gate.schema_version, "stage_gate_v1");
  assert.equal(gate.stage, "research_promotion");
  assert.equal(gate.candidate_id, "CAND-NEGATIVE-WFA-001");
  assert.equal(gate.decision, "denied");
  assert.match(gate.reason, /non-positive OOS Sharpe/i);
  assert.match(gate.reason, /profit factor below 1/i);
  assert.equal(gate.evidence_paths[0], "walk forward engine/strategies/demo/results/analysis.json");
});

test("research WFA gate report records underpowered flags without hard statistical claims", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-001",
    candidateId: "CAND-RESEARCH-GATE-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-001",
      artifacts_created: ["factory/runs/RUN-RESEARCH-GATE-001/execution-result.json"],
      metrics_observed: {
        sharpe_oos: 1.1,
        aggregate_return_pct: 1.2,
        profit_factor: 1.15,
        total_trades: 20,
        successful_windows: 3,
        total_windows: 3
      }
    },
    parsedMetrics: {
      metrics_artifact: { path: "walk forward engine/strategies/demo/results/walk_forward_results.json" },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.6, total_trades: 8, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: -0.2, total_trades: 6, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.8, total_trades: 6, best_parameters: { lookback: 10 } }
      ],
      assumptions: {
        cost_assumptions: {
          available: true,
          values: { fees: { value: 0.001 }, slippage: { value: 0.0003 } }
        }
      }
    }
  });

  assert.equal(report.schema_version, "research_wfa_gate_report_v1");
  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(report.sample_size.status, "underpowered");
  assert.deepEqual(report.flags.filter((flag) => flag.startsWith("underpowered_")), ["underpowered_oos_windows", "underpowered_trade_count"]);
  assert.equal(report.oos_window_consistency.profitable_oos_window_ratio, 0.6667);
  assert.equal(report.oos_window_consistency.status, "mixed_oos_windows");
  assert.equal(report.wfe.status, "missing_in_sample_return");
  assert.equal(report.wfr.value, 1);
  assert.equal(report.statistical_tests.dsr.status, "disabled_advisory");
  assert.equal(report.statistical_tests.pbo.status, "disabled_advisory");
});

test("research WFA gate report consumes worker artifact-backed WFE and WFR readiness", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WFE-001",
    candidateId: "CAND-RESEARCH-GATE-WFE-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-WFE-001",
      metrics_observed: {
        total_trades: 80,
        successful_windows: 3,
        total_windows: 4,
        aggregate_return_pct: 2.5
      }
    },
    parsedMetrics: {
      metrics_artifact: { path: "walk forward engine/strategies/demo/results/walk_forward_results.json" },
      metric_readiness: {
        wfe: {
          status: "computed_artifact_backed",
          value: 0.25,
          inputs: {
            in_sample_return_pct: { available: true, value: 10, source: { source_path: "walk forward engine/strategies/demo/results/walk_forward_results.json", source_sha256: "a".repeat(64), source_field: "aggregate_in_sample_return_pct" } },
            aggregate_return_pct: { available: true, value: 2.5, source: { source_path: "walk forward engine/strategies/demo/results/walk_forward_results.json", source_sha256: "a".repeat(64), source_field: "aggregate_return_pct" } }
          }
        },
        wfr: {
          status: "computed_artifact_backed",
          value: 0.75,
          inputs: {
            successful_windows: { available: true, value: 3, source: { source_path: "walk forward engine/strategies/demo/results/walk_forward_results.json", source_sha256: "a".repeat(64), source_field: "successful_windows" } },
            total_windows: { available: true, value: 4, source: { source_path: "walk forward engine/strategies/demo/results/walk_forward_results.json", source_sha256: "a".repeat(64), source_field: "total_windows" } }
          }
        }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.6, total_trades: 20, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: -0.2, total_trades: 20, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.8, total_trades: 20, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.wfe.status, "computed_artifact_backed");
  assert.equal(report.wfe.value, 0.25);
  assert.equal(report.wfe.inputs.in_sample_return_pct.source.source_field, "aggregate_in_sample_return_pct");
  assert.equal(report.wfr.status, "computed_artifact_backed");
  assert.equal(report.wfr.value, 0.75);
  assert.equal(report.wfr.inputs.total_windows.source.source_field, "total_windows");
});

test("research WFA gate report preserves worker diagnostics as reporting-only anti-overfit signals", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DIAG-001",
    candidateId: "CAND-RESEARCH-GATE-DIAG-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-DIAG-001",
      metrics_observed: {
        total_trades: 40,
        successful_windows: 3,
        total_windows: 4,
        aggregate_return_pct: 1.4
      }
    },
    parsedMetrics: {
      metrics_artifact: { path: "factory/runs/RUN-RESEARCH-GATE-DIAG-001/worker-results/parsed-wfa-metrics.json", sha256: "b".repeat(64) },
      metric_readiness: {
        wfe: {
          status: "blocked_missing_inputs",
          value: null,
          missing_inputs: ["artifact-backed aggregate in-sample return"],
          missing_because: "WFE not computed because accepted WFA metrics are missing artifact-backed aggregate in-sample return."
        },
        wfr: {
          status: "blocked_missing_inputs",
          value: null,
          missing_inputs: ["artifact-backed total_windows"],
          missing_because: "WFR not computed because accepted WFA metrics are missing artifact-backed total_windows."
        }
      },
      parameter_stability: {
        status: "partial_parameter_artifacts",
        source: { source_path: "factory/runs/RUN-RESEARCH-GATE-DIAG-001/worker-results/parsed-wfa-metrics.json", source_sha256: "b".repeat(64), source_field: "window_results[].best_parameters" },
        windows_with_parameters: 2,
        total_reported_windows: 3,
        unique_parameter_sets: 2
      },
      optimization_truth: {
        status: "valid_artifact_backed",
        source: { source_path: "factory/runs/RUN-RESEARCH-GATE-DIAG-001/worker-results/parsed-wfa-metrics.json", source_sha256: "b".repeat(64), source_field: "optimization_truth" },
        truth: {
          active_parameter_optimizer: "direct_optuna_tpe_study",
          active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
          active_cost_inputs: { fees: 0.0004, slippage: 0.0002 },
          multi_objective_optimizer_active: false,
          transaction_cost_modeler_active: false,
          cost_stress_tester_active: false,
          disconnected_modules: ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]
        }
      },
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions()
        }
      },
      warmup_diagnostics: {
        status: "diagnostic_only_not_applied",
        diagnostics: { indicator_warmup_bars: 30, applied_to_window_boundaries: false }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, total_trades: 14 },
        { window_id: 1, total_return_pct: -0.1, total_trades: 12 },
        { window_id: 2, total_return_pct: 1.2, total_trades: 14 }
      ]
    }
  });

  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(report.wfe.status, "blocked_missing_inputs");
  assert.equal(report.wfr.status, "blocked_missing_inputs");
  assert.equal(report.parameter_stability.status, "partial_parameter_artifacts");
  assert.equal(report.parameter_stability.reporting_only, true);
  assert.equal(report.parameter_stability.evidence_strength, "weak_or_incomplete");
  assert.equal(report.optimization_truth.status, "valid_artifact_backed");
  assert.equal(report.optimization_truth.reporting_only, true);
  assert.equal(report.optimization_truth.disconnected_module_review.status, "reported_inactive");
  assert.equal(report.optimization_truth.source_review.status, "hash_backed_source_reported");
  assert.equal(report.optimization_truth.source_review.identity_compared, true);
  assert.equal(report.optimization_truth.source_review.identity_matches, true);
  assert.deepEqual(report.optimization_truth.disconnected_module_review.inactive_modules, ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]);
  assert.equal(report.optimization_truth.disconnected_module_review.contract_review.status, "contract_consistent");
  assert.equal(report.optimization_truth.disconnected_module_review.cost_input_provenance_review.status, "consistent_with_cost_assumptions");
  assert.equal(report.warmup_diagnostics.status, "diagnostic_only_not_applied");
  assert.equal(report.warmup_diagnostics.boundary_application.status, "generic_indicator_warmup_not_applied");
  assert.match(report.warmup_diagnostics.note, /diagnostic metadata only/i);
  assert.equal(report.flags.includes("wfe_blocked_or_missing_inputs"), true);
  assert.equal(report.flags.includes("wfr_blocked_or_missing_inputs"), true);
  assert.equal(report.flags.includes("partial_parameter_artifacts"), true);
  assert.equal(report.flags.includes("weak_parameter_stability_evidence"), true);
  assert.equal(report.flags.includes("optimization_truth_source_reported"), true);
  assert.equal(report.flags.includes("disconnected_optimizer_cost_modules_reported"), true);
  assert.equal(report.flags.includes("active_cost_inputs_match_cost_assumptions"), true);
  assert.equal(report.flags.includes("generic_indicator_warmup_not_applied"), true);
  assert.equal(report.evidence_paths.includes("factory/runs/RUN-RESEARCH-GATE-DIAG-001/worker-results/parsed-wfa-metrics.json"), true);
});

test("research WFA gate report flags missing cost-stress evidence without inventing stressed metrics", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-STRESS-001",
    candidateId: "CAND-RESEARCH-GATE-COST-STRESS-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-STRESS-001",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions(),
          source: { source_path: "walk forward engine/strategies/demo/results/analysis.json", source_sha256: "c".repeat(64), source_field: "config" }
        }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(report.cost_stress.status, "cost_assumptions_recorded_stress_missing");
  assert.equal(report.cost_stress.stress_tested, false);
  assert.equal(report.cost_stress.assumptions_available, true);
  assert.equal(report.cost_stress.cost_assumption_provenance.status, "artifact_backed_cost_assumptions");
  assert.equal(report.cost_stress.cost_assumption_provenance.source_artifacts.length, 1);
  assert.match(report.cost_stress.missing_because, /no separate artifact-backed cost-stress/i);
  assert.equal(report.flags.includes("missing_cost_stress_evidence"), true);
  assert.equal(report.flags.includes("cost_assumption_provenance_reported"), true);
});

test("research WFA gate report rejects cost-stress claims without hash-backed source artifacts", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-STRESS-INVALID",
    candidateId: "CAND-RESEARCH-GATE-COST-STRESS-INVALID",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-STRESS-INVALID",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions()
        }
      },
      cost_stress: {
        status: "stress_tested_reported",
        stress_tested: true,
        max_fee_multiplier_tested: 2
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.cost_stress.status, "invalid_artifact_backed");
  assert.equal(report.cost_stress.stress_tested, true);
  assert.equal(report.cost_stress.errors.includes("cost_stress_tested_requires_hash_verified_source_artifacts"), true);
  assert.equal(report.flags.includes("invalid_cost_stress_evidence"), true);
  assert.equal(report.flags.includes("cost_stress_evidence_reported"), false);
});

test("research WFA gate report rejects cost-stress claims backed by the wrong artifact type", () => {
  const wrongTypeArtifact = {
    artifact_type: "optimizer_trials",
    path: "factory/runs/RUN-RESEARCH-GATE-COST-STRESS-WRONG-TYPE/worker-results/cost-stress.json",
    sha256: "d".repeat(64),
    hash_verified: true
  };
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-STRESS-WRONG-TYPE",
    candidateId: "CAND-RESEARCH-GATE-COST-STRESS-WRONG-TYPE",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-STRESS-WRONG-TYPE",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions()
        }
      },
      cost_stress: {
        status: "stress_tested_reported",
        stress_tested: true,
        source_artifacts: [wrongTypeArtifact]
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.cost_stress.status, "invalid_artifact_backed");
  assert.equal(report.cost_stress.errors.includes("cost_stress_source_artifacts_must_be_cost_stress_result"), true);
  assert.equal(report.cost_stress.errors.includes("cost_stress_tested_requires_hash_verified_source_artifacts"), true);
  assert.equal(report.flags.includes("invalid_cost_stress_evidence"), true);
  assert.equal(report.flags.includes("cost_stress_evidence_reported"), false);
});

test("research WFA gate report preserves hash-backed cost-stress source artifacts", () => {
  const sourceArtifact = {
    artifact_type: "cost_stress_result",
    path: "factory/runs/RUN-RESEARCH-GATE-COST-STRESS-SOURCE/worker-results/cost-stress.json",
    sha256: "d".repeat(64),
    hash_verified: true
  };
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-STRESS-SOURCE",
    candidateId: "CAND-RESEARCH-GATE-COST-STRESS-SOURCE",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-STRESS-SOURCE",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions()
        }
      },
      cost_stress: {
        status: "stress_tested_reported",
        stress_tested: true,
        source_artifacts: [sourceArtifact],
        max_fee_multiplier_tested: 2
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.cost_stress.status, "stress_tested_reported");
  assert.equal(report.cost_stress.reporting_only, true);
  assert.equal(report.cost_stress.artifact_backed_source_count, 1);
  assert.equal(report.cost_stress.cost_assumption_provenance.status, "artifact_backed_cost_assumptions");
  assert.deepEqual(report.cost_stress.source_artifacts, [sourceArtifact]);
  assert.equal(report.flags.includes("cost_stress_evidence_reported"), true);
  assert.equal(report.flags.includes("cost_assumption_provenance_reported"), true);
  assert.equal(report.evidence_paths.includes(sourceArtifact.path), true);
  assert.equal(report.evidence_paths.includes("walk forward engine/strategies/demo/results/analysis.json"), true);
});

test("research WFA gate report rejects cost-stress claims with unverified cost-assumption provenance", () => {
  const sourceArtifact = {
    artifact_type: "cost_stress_result",
    path: "factory/runs/RUN-RESEARCH-GATE-COST-STRESS-UNVERIFIED/worker-results/cost-stress.json",
    sha256: "e".repeat(64),
    hash_verified: true
  };
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-STRESS-UNVERIFIED",
    candidateId: "CAND-RESEARCH-GATE-COST-STRESS-UNVERIFIED",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-STRESS-UNVERIFIED",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: { fees: 0.0004, slippage: 0.0002 }
        }
      },
      cost_stress: {
        status: "stress_tested_reported",
        stress_tested: true,
        source_artifacts: [sourceArtifact]
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.cost_stress.status, "invalid_artifact_backed");
  assert.equal(report.cost_stress.errors.includes("cost_stress_tested_requires_hash_verified_cost_assumptions"), true);
  assert.equal(report.cost_stress.cost_assumption_provenance.status, "missing_or_unverified_cost_assumption_sources");
  assert.equal(report.flags.includes("invalid_cost_stress_evidence"), true);
  assert.equal(report.flags.includes("unverified_cost_assumption_provenance"), true);
});

test("research WFA gate report rejects stress-tested claims with incomplete fee/slippage provenance", () => {
  const sourceArtifact = {
    artifact_type: "cost_stress_result",
    path: "factory/runs/RUN-RESEARCH-GATE-COST-STRESS-INCOMPLETE/worker-results/cost-stress.json",
    sha256: "e".repeat(64),
    hash_verified: true
  };
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-STRESS-INCOMPLETE",
    candidateId: "CAND-RESEARCH-GATE-COST-STRESS-INCOMPLETE",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-STRESS-INCOMPLETE",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions({ fees: 0.0004 })
        }
      },
      cost_stress: {
        status: "stress_tested_reported",
        stress_tested: true,
        source_artifacts: [sourceArtifact]
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.cost_stress.status, "invalid_artifact_backed");
  assert.equal(report.cost_stress.errors.includes("cost_stress_tested_requires_hash_verified_cost_assumptions"), true);
  assert.deepEqual(report.cost_stress.cost_assumption_provenance.missing_required_fields, ["slippage"]);
  assert.equal(report.flags.includes("unverified_cost_assumption_provenance"), true);
});

test("research WFA gate report flags active cost inputs that mismatch cost-assumption provenance", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-INPUT-MISMATCH",
    candidateId: "CAND-RESEARCH-GATE-COST-INPUT-MISMATCH",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-INPUT-MISMATCH",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions({ fees: 0.0004, slippage: 0.0002 })
        }
      },
      optimization_truth: {
        status: "valid_artifact_backed",
        truth: {
          active_parameter_optimizer: "direct_optuna_tpe_study",
          active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
          active_cost_inputs: { fees: 0.001, slippage: 0.0002 },
          disconnected_modules: ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]
        }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  const review = report.optimization_truth.disconnected_module_review.cost_input_provenance_review;
  assert.equal(review.status, "active_cost_inputs_mismatch_cost_assumptions");
  assert.deepEqual(review.mismatched_fields, ["fees"]);
  assert.equal(report.flags.includes("active_cost_inputs_mismatch_cost_assumptions"), true);
  assert.equal(report.flags.includes("active_cost_inputs_match_cost_assumptions"), false);
});

test("research WFA gate report flags unexpected active cost input fields", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-COST-INPUT-UNEXPECTED",
    candidateId: "CAND-RESEARCH-GATE-COST-INPUT-UNEXPECTED",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-COST-INPUT-UNEXPECTED",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions({ fees: 0.0004, slippage: 0.0002 })
        }
      },
      optimization_truth: {
        status: "valid_artifact_backed",
        truth: {
          active_parameter_optimizer: "direct_optuna_tpe_study",
          active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
          active_cost_inputs: { fees: 0.0004, slippage: 0.0002, spread_model: "synthetic" },
          multi_objective_optimizer_active: false,
          transaction_cost_modeler_active: false,
          cost_stress_tester_active: false,
          disconnected_modules: ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]
        }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  const review = report.optimization_truth.disconnected_module_review.cost_input_provenance_review;
  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(review.status, "unexpected_active_cost_inputs");
  assert.deepEqual(review.unexpected_active_fields, ["spread_model"]);
  assert.equal(report.flags.includes("unexpected_active_cost_inputs"), true);
  assert.equal(report.flags.includes("active_cost_inputs_match_cost_assumptions"), false);
});

test("research WFA gate report flags incomplete optimization-truth disconnected-module contract", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-OPT-TRUTH-INCOMPLETE",
    candidateId: "CAND-RESEARCH-GATE-OPT-TRUTH-INCOMPLETE",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-OPT-TRUTH-INCOMPLETE",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions({ fees: 0.0004, slippage: 0.0002 })
        }
      },
      optimization_truth: {
        status: "valid_artifact_backed",
        truth: {
          active_parameter_optimizer: "multi_objective_optimizer",
          active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
          active_cost_inputs: { fees: 0.0004, slippage: 0.0002 },
          multi_objective_optimizer_active: true,
          transaction_cost_modeler_active: false,
          cost_stress_tester_active: false,
          disconnected_modules: ["transaction_cost_modeler.py", "cost_stress_tester.py"]
        }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  const review = report.optimization_truth.disconnected_module_review.contract_review;
  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(review.status, "contract_incomplete_or_inconsistent");
  assert.deepEqual(review.missing_inactive_modules, ["multi_objective_optimizer.py"]);
  assert.deepEqual(review.invalid_inactive_flags, ["multi_objective_optimizer_active"]);
  assert.deepEqual(review.active_path_mismatches, ["active_parameter_optimizer"]);
  assert.equal(report.flags.includes("optimization_truth_contract_incomplete"), true);
  assert.equal(report.flags.includes("missing_disconnected_optimizer_cost_modules"), true);
  assert.equal(report.flags.includes("unexpected_active_disconnected_optimizer_cost_modules"), true);
  assert.equal(report.flags.includes("unexpected_optimization_truth_active_path"), true);
});

test("research WFA gate report flags unverified optimization-truth source provenance", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-OPT-TRUTH-SOURCE",
    candidateId: "CAND-RESEARCH-GATE-OPT-TRUTH-SOURCE",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-OPT-TRUTH-SOURCE",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions({ fees: 0.0004, slippage: 0.0002 })
        }
      },
      optimization_truth: {
        status: "valid_artifact_backed",
        source: { source_path: "factory/runs/RUN-RESEARCH-GATE-OPT-TRUTH-SOURCE/worker-results/parsed-wfa-metrics.json", source_sha256: "f".repeat(64), source_field: "diagnostics.optimization" },
        truth: {
          active_parameter_optimizer: "direct_optuna_tpe_study",
          active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
          active_cost_inputs: { fees: 0.0004, slippage: 0.0002 },
          multi_objective_optimizer_active: false,
          transaction_cost_modeler_active: false,
          cost_stress_tester_active: false,
          disconnected_modules: ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]
        }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(report.optimization_truth.source_review.status, "missing_or_unverified_source");
  assert.equal(report.optimization_truth.source_review.errors.includes("optimization_truth_source_field_must_reference_optimization_truth"), true);
  assert.equal(report.flags.includes("unverified_optimization_truth_source"), true);
  assert.equal(report.flags.includes("optimization_truth_source_field_mismatch"), true);
  assert.equal(report.flags.includes("optimization_truth_source_reported"), false);
});

test("research WFA gate report flags optimization-truth source identity mismatch", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-OPT-TRUTH-SOURCE-MISMATCH",
    candidateId: "CAND-RESEARCH-GATE-OPT-TRUTH-SOURCE-MISMATCH",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-OPT-TRUTH-SOURCE-MISMATCH",
      metrics_observed: { total_trades: 120, successful_windows: 6, total_windows: 6, aggregate_return_pct: 3.2 }
    },
    parsedMetrics: {
      metrics_artifact: { path: "walk forward engine/strategies/demo/results/walk_forward_results.json", sha256: "a".repeat(64) },
      assumptions: {
        cost_assumptions: {
          available: true,
          values: artifactBackedCostAssumptions({ fees: 0.0004, slippage: 0.0002 })
        }
      },
      optimization_truth: {
        status: "valid_artifact_backed",
        source: { source_path: "factory/runs/RUN-RESEARCH-GATE-OPT-TRUTH-SOURCE-MISMATCH/worker-results/parsed-wfa-metrics.json", source_sha256: "f".repeat(64), source_field: "optimization_truth" },
        truth: {
          active_parameter_optimizer: "direct_optuna_tpe_study",
          active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
          active_cost_inputs: { fees: 0.0004, slippage: 0.0002 },
          multi_objective_optimizer_active: false,
          transaction_cost_modeler_active: false,
          cost_stress_tester_active: false,
          disconnected_modules: ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]
        }
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.6, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.7, best_parameters: { lookback: 10 } },
        { window_id: 5, total_return_pct: 0.7, best_parameters: { lookback: 10 } }
      ]
    }
  });

  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(report.optimization_truth.source_review.status, "missing_or_unverified_source");
  assert.equal(report.optimization_truth.source_review.identity_compared, true);
  assert.equal(report.optimization_truth.source_review.identity_matches, false);
  assert.equal(report.optimization_truth.source_review.errors.includes("optimization_truth_source_must_match_metrics_artifact_identity"), true);
  assert.equal(report.flags.includes("optimization_truth_source_identity_mismatch"), true);
  assert.equal(report.flags.includes("unverified_optimization_truth_source"), true);
  assert.equal(report.flags.includes("optimization_truth_source_reported"), false);
});

test("research WFA gate report flags invalid worker diagnostics without turning them into hard gates", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DIAG-INVALID",
    candidateId: "CAND-RESEARCH-GATE-DIAG-INVALID",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-DIAG-INVALID",
      metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6, aggregate_return_pct: 2.1 }
    },
    parsedMetrics: {
      metric_readiness: {
        wfe: { status: "computed_artifact_backed", value: 0.21 },
        wfr: { status: "computed_artifact_backed", value: 1 }
      },
      parameter_stability: {
        status: "invalid_artifact_backed",
        malformed_parameter_windows: 1,
        missing_because: "Accepted WFA metrics emitted malformed per-window best_parameters; expected JSON objects only."
      },
      optimization_truth: {
        status: "invalid_artifact_backed",
        errors: ["multi_objective_optimizer_active must be false"]
      },
      warmup_diagnostics: {
        status: "invalid_artifact_backed",
        errors: ["indicator_warmup_bars must not claim application to WFA window boundaries"]
      },
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.3, total_trades: 30 },
        { window_id: 1, total_return_pct: 0.4, total_trades: 30 },
        { window_id: 2, total_return_pct: 1.4, total_trades: 30 }
      ]
    }
  });

  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(report.parameter_stability.status, "invalid_artifact_backed");
  assert.equal(report.optimization_truth.status, "invalid_artifact_backed");
  assert.equal(report.warmup_diagnostics.status, "invalid_artifact_backed");
  assert.equal(report.flags.includes("invalid_parameter_stability_artifact"), true);
  assert.equal(report.flags.includes("invalid_optimization_truth_diagnostics"), true);
  assert.equal(report.flags.includes("invalid_warmup_diagnostics"), true);
});

test("research WFA gate report records parameter stability, data identity gaps, and duplicate failed patterns", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-002",
    candidateId: "CAND-RESEARCH-GATE-002",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-002",
      metrics_observed: {
        total_trades: 80,
        successful_windows: 6,
        total_windows: 6,
        aggregate_return_pct: 2.4
      }
    },
    parsedMetrics: {
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.2, best_parameters: { lookback: 10, threshold: 1.1 } },
        { window_id: 1, total_return_pct: 0.4, best_parameters: { lookback: 20, threshold: 1.1 } },
        { window_id: 2, total_return_pct: 0.5, best_parameters: { lookback: 10, threshold: 1.1 } }
      ]
    },
    dataReadinessManifests: [{
      source_family: "binance_usdm_funding",
      instrument: "BTCUSDT",
      artifacts: { manifest: { path: "workspace/data/binance/usdm_funding/btcusdt/btcusdt_funding_manifest.json" } },
      gap_report: { checked: true, gap_count: 1, gaps: [{ previous_timestamp_utc: "2026-01-01T00:00:00Z", next_timestamp_utc: "2026-01-01T16:00:00Z" }] },
      wfa_integration: { data_manifest_paths: ["workspace/data/binance/usdm_funding/btcusdt/btcusdt_funding_manifest.json"] }
    }],
    duplicateFailedPatterns: [{
      failure_family: "low_trade_count_breakout",
      lesson: "Similar low trade-count breakout variants failed OOS.",
      evidence_paths: ["factory/memory/failed-patterns.jsonl"]
    }]
  });

  assert.equal(report.sample_size.status, "sufficient_for_basic_reporting");
  assert.equal(report.parameter_stability.status, "parameter_instability_flagged");
  assert.equal(report.parameter_stability.unique_parameter_sets, 2);
  assert.equal(report.data_identity.status, "data_gaps_flagged");
  assert.equal(report.data_identity.total_gap_count, 1);
  assert.equal(report.duplicate_failed_patterns.status, "duplicate_failed_patterns_flagged");
  assert.match(report.duplicate_failed_patterns.warnings[0], /low trade-count/i);
  assert.equal(report.flags.includes("data_gaps_flagged"), true);
  assert.equal(report.flags.includes("duplicate_failed_patterns_flagged"), true);
});

test("research WFA gate report writer records advisory artifact under factory research gates", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WRITE-001",
    candidateId: "CAND-RESEARCH-GATE-WRITE-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-RESEARCH-GATE-WRITE-001",
      artifacts_created: ["factory/runs/RUN-RESEARCH-GATE-WRITE-001/execution-result.json"],
      metrics_observed: { total_trades: 51, successful_windows: 5, total_windows: 5, aggregate_return_pct: 1.2 }
    },
    parsedMetrics: {
      per_window_metrics: [
        { window_id: 0, total_return_pct: 0.1, best_parameters: { lookback: 10 } },
        { window_id: 1, total_return_pct: 0.2, best_parameters: { lookback: 10 } },
        { window_id: 2, total_return_pct: 0.3, best_parameters: { lookback: 10 } },
        { window_id: 3, total_return_pct: 0.4, best_parameters: { lookback: 10 } },
        { window_id: 4, total_return_pct: 0.5, best_parameters: { lookback: 10 } }
      ]
    }
  });
  const written = writeResearchWfaGateReport(paths, report);

  assert.equal(path.relative(rootDir, written.path).replace(/\\/g, "/"), "factory/research-gates/CAND-RESEARCH-GATE-WRITE-001/RUN-RESEARCH-GATE-WRITE-001.json");
  assert.equal(fs.existsSync(written.path), true);
  assert.equal(JSON.parse(fs.readFileSync(written.path, "utf8")).reporting_only, true);
});

test("candidate research gate report consumes worker trial-attempt artifacts as partial denominator", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-TRIAL-DENOM", job_id: "JOB-RESEARCH-GATE-TRIAL-DENOM" }) });

  assert.equal(result.status, "executed");
  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-TRIAL-DENOM", executionResult: result });
  const report = recorded.research_gate_report.report;
  const trialRecord = result.worker_result.artifacts.find((artifact) => artifact.artifact_type === "trial_attempt_record");

  assert.equal(fs.existsSync(path.join(rootDir, recorded.research_gate_report.path)), true);
  assert.equal(report.trial_denominator.status, "trial_denominator_partial_worker_records");
  assert.equal(report.trial_denominator.denominator_scope, "worker_trial_attempt_records_only");
  assert.equal(report.trial_denominator.attempt_count, 1);
  assert.equal(report.trial_denominator.artifacts[0].hash_verified, true);
  assert.equal(report.trial_denominator.artifacts[0].records_read, 1);
  assert.equal(report.trial_denominator.artifacts[0].records_accepted, 1);
  assert.equal(report.trial_denominator.artifacts[0].records_rejected, 0);
  assert.deepEqual(report.trial_denominator.status_counts, { succeeded: 1 });
  assert.deepEqual(report.trial_denominator.attempt_type_counts, { worker_launched_wfa: 1 });
  assert.deepEqual(report.trial_denominator.generated_by_counts, { research_wfa_run: 1 });
  assert.deepEqual(report.trial_denominator.lineage_ids, ["LINEAGE-DEMO-WFA"]);
  assert.deepEqual(report.trial_denominator.family_ids, ["FAMILY-DEMO-WFA"]);
  assert.deepEqual(report.trial_denominator.attempts.map((attempt) => ({
    run_id: attempt.run_id,
    job_id: attempt.job_id,
    candidate_id: attempt.candidate_id,
    attempt_id: attempt.attempt_id,
    status: attempt.status,
    input_hash_count: attempt.input_hash_count > 0,
    output_ref_count: attempt.output_ref_count > 0
  })), [{
    run_id: "RUN-RESEARCH-GATE-TRIAL-DENOM",
    job_id: "JOB-RESEARCH-GATE-TRIAL-DENOM",
    candidate_id: "CAND-DEMO-WFA-001",
    attempt_id: "ATTEMPT-1",
    status: "succeeded",
    input_hash_count: true,
    output_ref_count: true
  }]);
  assert.equal(report.trial_denominator.rejected_attempt_count, 0);
  assert.equal(report.optimizer_trials.status, "missing_optimizer_trial_artifact");
  assert.equal(report.optimizer_trials.denominator_available, false);
  assert.equal(report.search_denominator.status, "partial_search_denominator");
  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.deepEqual(report.search_denominator.covered_sources, ["worker_trial_attempt_records"]);
  assert.equal(report.search_denominator.missing_source_count, 8);
  assert.deepEqual(report.search_denominator.missing_non_worker_attempt_sources, ["llm_generated_attempts", "manual_attempts", "mutation_attempts", "repair_attempts", "rerun_attempts"]);
  assert.equal(report.search_denominator.missing_sources.includes("optimizer_trial_artifact_rows"), true);
  assert.equal(report.search_denominator.missing_sources.includes("llm_generated_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("manual_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("mutation_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("repair_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("rerun_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("complete_optimizer_search_context"), true);
  assert.equal(report.search_denominator.worker_attempt_count, 1);
  assert.equal(report.search_denominator.optimizer_trial_row_count, 0);
  assert.equal(report.optimizer_search_context.status, "missing_optimizer_search_context_artifact");
  assert.equal(report.optimizer_search_context.context_available, false);
  assert.equal(report.search_denominator.optimizer_search_context_count, 0);
  assert.equal(report.non_worker_denominator.status, "missing_non_worker_denominator_artifact");
  assert.equal(report.non_worker_denominator.denominator_available, false);
  assert.equal(report.search_denominator.non_worker_attempt_count, 0);
  assert.equal(report.flags.includes("missing_optimizer_trial_artifact"), true);
  assert.equal(report.flags.includes("missing_optimizer_search_context_artifact"), true);
  assert.equal(report.flags.includes("missing_non_worker_denominator_artifact"), true);
  assert.equal(report.flags.includes("trial_denominator_partial_worker_records"), true);
  assert.equal(report.flags.includes("search_denominator_incomplete"), true);
  assert.equal(report.flags.includes("missing_non_worker_attempt_denominator_context"), true);
  assert.equal(report.evidence_paths.includes(trialRecord.path), true);
  assert.match(report.statistical_tests.dsr.reason, /worker trial_attempt_record artifacts were consumed/i);
});

test("candidate research gate report consumes hash-backed non-worker denominator artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-NON-WORKER-DENOM", job_id: "JOB-RESEARCH-GATE-NON-WORKER-DENOM" }) });
  const denominatorArtifact = attachNonWorkerDenominatorArtifact(rootDir, result, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated", generated_by: "opencode_supervised" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual", generated_by: "operator" })
  ]);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-NON-WORKER-DENOM", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.non_worker_denominator.status, "non_worker_denominator_attempts_consumed");
  assert.equal(report.non_worker_denominator.schema_version, "non_worker_denominator_attempts_v1");
  assert.equal(report.non_worker_denominator.denominator_scope, "non_worker_attempt_records_advisory_only");
  assert.equal(report.non_worker_denominator.attempt_count, 2);
  assert.equal(report.non_worker_denominator.artifacts[0].hash_verified, true);
  assert.equal(report.non_worker_denominator.artifacts[0].records_read, 2);
  assert.equal(report.non_worker_denominator.artifacts[0].records_accepted, 2);
  assert.equal(report.non_worker_denominator.artifacts[0].records_rejected, 0);
  assert.deepEqual(report.non_worker_denominator.attempt_type_counts, { llm_generated: 1, manual: 1 });
  assert.deepEqual(report.non_worker_denominator.generated_by_counts, { opencode_supervised: 1, operator: 1 });
  assert.deepEqual(report.non_worker_denominator.attempts.map((attempt) => ({
    candidate_id: attempt.candidate_id,
    attempt_id: attempt.attempt_id,
    attempt_type: attempt.attempt_type,
    source_artifact_count: attempt.source_artifact_count
  })), [
    { candidate_id: "CAND-DEMO-WFA-001", attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated", source_artifact_count: 1 },
    { candidate_id: "CAND-DEMO-WFA-001", attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual", source_artifact_count: 1 }
  ]);
  assert.equal(report.non_worker_denominator.rejected_attempt_count, 0);
  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.search_denominator.non_worker_attempt_count, 2);
  assert.deepEqual(report.search_denominator.non_worker_attempt_counts, { llm_generated: 1, manual: 1, mutation: 0, repair: 0, rerun: 0 });
  assert.equal(report.search_denominator.covered_sources.includes("llm_generated_attempts"), true);
  assert.equal(report.search_denominator.covered_sources.includes("manual_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("llm_generated_attempts"), false);
  assert.equal(report.search_denominator.missing_sources.includes("manual_attempts"), false);
  assert.equal(report.search_denominator.missing_sources.includes("mutation_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("repair_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("rerun_attempts"), true);
  assert.equal(report.search_denominator.missing_sources.includes("multiple_comparison_context"), true);
  assert.equal(report.flags.includes("non_worker_denominator_attempts_consumed"), true);
  assert.equal(report.flags.includes("search_denominator_incomplete"), true);
  assert.equal(report.evidence_paths.includes(denominatorArtifact.path), true);
});

test("candidate research gate report consumes hash-backed optimizer-search context artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT", job_id: "JOB-RESEARCH-GATE-OPTIMIZER-CONTEXT" }) });
  const contextArtifact = attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext());

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.optimizer_search_context.status, "optimizer_search_context_consumed");
  assert.equal(report.optimizer_search_context.schema_version, "optimizer_search_context_v1");
  assert.equal(report.optimizer_search_context.context_scope, "optimizer_search_context_advisory_only");
  assert.equal(report.optimizer_search_context.context_count, 1);
  assert.equal(report.optimizer_search_context.artifacts[0].hash_verified, true);
  assert.equal(report.optimizer_search_context.artifacts[0].records_read, 1);
  assert.equal(report.optimizer_search_context.artifacts[0].records_accepted, 1);
  assert.equal(report.optimizer_search_context.artifacts[0].records_rejected, 0);
  assert.deepEqual(report.optimizer_search_context.optimizer_names, ["optuna_tpe"]);
  assert.deepEqual(report.optimizer_search_context.search_space_hashes, ["a".repeat(64)]);
  assert.equal(report.optimizer_search_context.planned_trial_count, 20);
  assert.equal(report.optimizer_search_context.completed_trial_count, 18);
  assert.equal(report.optimizer_search_context.failed_trial_count, 2);
  assert.deepEqual(report.optimizer_search_context.contexts.map((context) => ({
    candidate_id: context.candidate_id,
    optimizer_name: context.optimizer_name,
    planned_trial_count: context.planned_trial_count,
    source_artifact_count: context.source_artifact_count
  })), [{
    candidate_id: "CAND-DEMO-WFA-001",
    optimizer_name: "optuna_tpe",
    planned_trial_count: 20,
    source_artifact_count: 1
  }]);
  assert.equal(report.search_denominator.covered_sources.includes("complete_optimizer_search_context"), true);
  assert.equal(report.search_denominator.missing_sources.includes("complete_optimizer_search_context"), false);
  assert.equal(report.search_denominator.missing_sources.includes("multiple_comparison_context"), true);
  assert.equal(report.search_denominator.optimizer_search_context_count, 1);
  assert.equal(report.search_denominator.optimizer_search_planned_trial_count, 20);
  assert.equal(report.search_denominator.optimizer_search_completed_trial_count, 18);
  assert.equal(report.search_denominator.optimizer_search_failed_trial_count, 2);
  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.flags.includes("optimizer_search_context_consumed"), true);
  assert.equal(report.flags.includes("search_denominator_incomplete"), true);
  assert.equal(report.evidence_paths.includes(contextArtifact.path), true);
});

test("candidate research gate report refuses hash-mismatched optimizer-search context artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT-BAD-HASH", job_id: "JOB-RESEARCH-GATE-OPTIMIZER-CONTEXT-BAD-HASH" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext(), { sha256: "0".repeat(64) });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT-BAD-HASH", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.optimizer_search_context.status, "optimizer_search_context_artifacts_unreadable");
  assert.equal(report.optimizer_search_context.context_available, false);
  assert.equal(report.optimizer_search_context.context_count, 0);
  assert.equal(report.optimizer_search_context.artifacts[0].hash_verified, false);
  assert.match(report.optimizer_search_context.artifacts[0].read_error, /sha256 mismatch/i);
  assert.equal(report.search_denominator.optimizer_search_context_count, 0);
  assert.equal(report.search_denominator.missing_sources.includes("complete_optimizer_search_context"), true);
  assert.equal(report.search_denominator.covered_sources.includes("complete_optimizer_search_context"), false);
  assert.equal(report.flags.includes("optimizer_search_context_artifacts_unreadable"), true);
});

test("candidate research gate report rejects malformed optimizer-search context rows", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT-BAD-ROW", job_id: "JOB-RESEARCH-GATE-OPTIMIZER-CONTEXT-BAD-ROW" }) });
  const malformed = optimizerSearchContext({ completed_trial_count: 19, failed_trial_count: 3 });
  attachOptimizerSearchContextArtifact(rootDir, result, malformed);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT-BAD-ROW", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.optimizer_search_context.status, "optimizer_search_context_records_rejected");
  assert.equal(report.optimizer_search_context.context_available, false);
  assert.equal(report.optimizer_search_context.context_count, 0);
  assert.equal(report.optimizer_search_context.artifacts[0].hash_verified, true);
  assert.equal(report.optimizer_search_context.artifacts[0].records_read, 1);
  assert.equal(report.optimizer_search_context.artifacts[0].records_accepted, 0);
  assert.equal(report.optimizer_search_context.artifacts[0].records_rejected, 1);
  assert.equal(report.optimizer_search_context.rejected_context_count, 1);
  assert.match(report.optimizer_search_context.rejected_contexts[0].rejection_reason, /completed plus failed trials exceeds planned/i);
  assert.equal(report.search_denominator.missing_sources.includes("complete_optimizer_search_context"), true);
  assert.equal(report.flags.includes("optimizer_search_context_records_rejected"), true);
});

test("candidate research gate report rejects identity-mismatched optimizer-search context rows", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT-IDENTITY", job_id: "JOB-RESEARCH-GATE-OPTIMIZER-CONTEXT-IDENTITY" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext({ lineage_id: "LINEAGE-OTHER-WFA" }));

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-OPTIMIZER-CONTEXT-IDENTITY", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.optimizer_search_context.status, "optimizer_search_context_records_rejected");
  assert.equal(report.optimizer_search_context.context_available, false);
  assert.equal(report.optimizer_search_context.context_count, 0);
  assert.equal(report.optimizer_search_context.artifacts[0].hash_verified, true);
  assert.equal(report.optimizer_search_context.artifacts[0].records_rejected, 1);
  assert.equal(report.optimizer_search_context.rejected_contexts[0].lineage_id, "LINEAGE-OTHER-WFA");
  assert.match(report.optimizer_search_context.rejected_contexts[0].rejection_reason, /lineage_id mismatch/i);
  assert.equal(report.search_denominator.missing_sources.includes("complete_optimizer_search_context"), true);
  assert.equal(report.flags.includes("optimizer_search_context_records_rejected"), true);
});

test("candidate research gate report refuses hash-mismatched non-worker denominator artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-NON-WORKER-BAD-HASH", job_id: "JOB-RESEARCH-GATE-NON-WORKER-BAD-HASH" }) });
  attachNonWorkerDenominatorArtifact(rootDir, result, [nonWorkerAttempt()], { sha256: "0".repeat(64) });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-NON-WORKER-BAD-HASH", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.non_worker_denominator.status, "non_worker_denominator_artifacts_unreadable");
  assert.equal(report.non_worker_denominator.denominator_available, false);
  assert.equal(report.non_worker_denominator.attempt_count, 0);
  assert.equal(report.non_worker_denominator.artifacts[0].hash_verified, false);
  assert.match(report.non_worker_denominator.artifacts[0].read_error, /sha256 mismatch/i);
  assert.equal(report.search_denominator.non_worker_attempt_count, 0);
  assert.equal(report.search_denominator.missing_sources.includes("llm_generated_attempts"), true);
  assert.equal(report.search_denominator.covered_sources.includes("llm_generated_attempts"), false);
  assert.equal(report.flags.includes("non_worker_denominator_artifacts_unreadable"), true);
});

test("candidate research gate report rejects malformed non-worker denominator rows", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-NON-WORKER-BAD-ROW", job_id: "JOB-RESEARCH-GATE-NON-WORKER-BAD-ROW" }) });
  const malformed = nonWorkerAttempt({ attempt_id: "ATTEMPT-BAD-ROW-1" });
  delete malformed.status;
  attachNonWorkerDenominatorArtifact(rootDir, result, [malformed]);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-NON-WORKER-BAD-ROW", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.non_worker_denominator.status, "non_worker_denominator_records_rejected");
  assert.equal(report.non_worker_denominator.denominator_available, false);
  assert.equal(report.non_worker_denominator.attempt_count, 0);
  assert.equal(report.non_worker_denominator.artifacts[0].hash_verified, true);
  assert.equal(report.non_worker_denominator.artifacts[0].records_read, 1);
  assert.equal(report.non_worker_denominator.artifacts[0].records_accepted, 0);
  assert.equal(report.non_worker_denominator.artifacts[0].records_rejected, 1);
  assert.equal(report.non_worker_denominator.rejected_attempt_count, 1);
  assert.match(report.non_worker_denominator.rejected_attempts[0].rejection_reason, /status missing/i);
  assert.equal(report.search_denominator.missing_sources.includes("llm_generated_attempts"), true);
  assert.equal(report.flags.includes("non_worker_denominator_records_rejected"), true);
});

test("candidate research gate report rejects identity-mismatched non-worker denominator rows", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-NON-WORKER-IDENTITY", job_id: "JOB-RESEARCH-GATE-NON-WORKER-IDENTITY" }) });
  attachNonWorkerDenominatorArtifact(rootDir, result, [nonWorkerAttempt({ candidate_id: "CAND-OTHER-WFA-001" })]);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-NON-WORKER-IDENTITY", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.non_worker_denominator.status, "non_worker_denominator_records_rejected");
  assert.equal(report.non_worker_denominator.denominator_available, false);
  assert.equal(report.non_worker_denominator.attempt_count, 0);
  assert.equal(report.non_worker_denominator.artifacts[0].hash_verified, true);
  assert.equal(report.non_worker_denominator.artifacts[0].records_rejected, 1);
  assert.equal(report.non_worker_denominator.rejected_attempts[0].candidate_id, "CAND-OTHER-WFA-001");
  assert.match(report.non_worker_denominator.rejected_attempts[0].rejection_reason, /candidate_id mismatch/i);
  assert.equal(report.search_denominator.missing_sources.includes("llm_generated_attempts"), true);
  assert.equal(report.flags.includes("non_worker_denominator_records_rejected"), true);
});

test("candidate research gate report consumes hash-backed multiple-comparison context artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-MULTI-COMPARISON", job_id: "JOB-RESEARCH-GATE-MULTI-COMPARISON" }) });
  const contextArtifact = attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext());

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-MULTI-COMPARISON", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.multiple_comparison_context.status, "multiple_comparison_context_consumed");
  assert.equal(report.multiple_comparison_context.schema_version, "multiple_comparison_context_v1");
  assert.equal(report.multiple_comparison_context.context_scope, "multiple_comparison_context_advisory_only");
  assert.equal(report.multiple_comparison_context.context_count, 1);
  assert.equal(report.multiple_comparison_context.artifacts[0].hash_verified, true);
  assert.equal(report.multiple_comparison_context.artifacts[0].records_read, 1);
  assert.equal(report.multiple_comparison_context.artifacts[0].records_accepted, 1);
  assert.equal(report.multiple_comparison_context.artifacts[0].records_rejected, 0);
  assert.deepEqual(report.multiple_comparison_context.correction_methods, ["bh_fdr"]);
  assert.equal(report.multiple_comparison_context.total_strategies_tested, 15);
  assert.deepEqual(report.multiple_comparison_context.contexts.map((context) => ({
    candidate_id: context.candidate_id,
    correction_method: context.correction_method,
    total_strategies_tested: context.total_strategies_tested,
    adjusted_alpha: context.adjusted_alpha,
    source_artifact_count: context.source_artifact_count
  })), [{
    candidate_id: "CAND-DEMO-WFA-001",
    correction_method: "bh_fdr",
    total_strategies_tested: 15,
    adjusted_alpha: 0.025,
    source_artifact_count: 2
  }]);
  assert.equal(report.search_denominator.covered_sources.includes("multiple_comparison_context"), true);
  assert.equal(report.search_denominator.missing_sources.includes("multiple_comparison_context"), false);
  assert.equal(report.search_denominator.multiple_comparison_context_count, 1);
  assert.equal(report.search_denominator.multiple_comparison_total_strategies_tested, 15);
  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.flags.includes("multiple_comparison_context_consumed"), true);
  assert.equal(report.flags.includes("search_denominator_incomplete"), true);
  assert.equal(report.evidence_paths.includes(contextArtifact.path), true);
});

test("candidate research gate report marks search denominator structurally complete when every source is hash-backed", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-COMPLETE-DENOM", job_id: "JOB-RESEARCH-GATE-COMPLETE-DENOM" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext());
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext());
  attachNonWorkerDenominatorArtifact(rootDir, result, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MUTATION-1", attempt_type: "mutation" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-REPAIR-1", attempt_type: "repair" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-RERUN-1", attempt_type: "rerun" })
  ]);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-COMPLETE-DENOM", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.status, "complete_search_denominator");
  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.deepEqual(report.search_denominator.missing_sources, []);
  assert.equal(report.search_denominator.worker_attempt_count, 1);
  assert.equal(report.search_denominator.optimizer_trial_row_count, 1);
  assert.equal(report.search_denominator.optimizer_search_context_count, 1);
  assert.equal(report.search_denominator.optimizer_trial_accounting.status, "optimizer_trial_rows_below_completed_context");
  assert.equal(report.search_denominator.optimizer_trial_accounting.optimizer_trial_rows_read, 1);
  assert.equal(report.search_denominator.optimizer_trial_accounting.optimizer_search_completed_trial_count, 18);
  assert.equal(report.search_denominator.optimizer_trial_accounting.missing_completed_optimizer_trial_rows, 17);
  assert.deepEqual(report.search_denominator.non_worker_attempt_counts, { llm_generated: 1, manual: 1, mutation: 1, repair: 1, rerun: 1 });
  assert.equal(report.search_denominator.multiple_comparison_context_count, 1);
  assert.equal(report.search_denominator.multiple_comparison_accounting.status, "multiple_comparison_context_covers_known_attempts");
  assert.equal(report.flags.includes("optimizer_trial_accounting_incomplete"), true);
  assert.equal(report.flags.includes("search_denominator_incomplete"), false);
  assert.match(report.search_denominator.disabled_because, /structurally complete/i);
  assert.equal(report.statistical_tests.dsr.status, "disabled_advisory");
  assert.match(report.statistical_tests.dsr.reason, /structurally complete/i);
});

test("candidate research gate report flags multiple-comparison context that underreports known attempts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-MULTI-UNDERCOUNT", job_id: "JOB-RESEARCH-GATE-MULTI-UNDERCOUNT" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext());
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext({ total_strategies_tested: 3 }));
  attachNonWorkerDenominatorArtifact(rootDir, result, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MUTATION-1", attempt_type: "mutation" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-REPAIR-1", attempt_type: "repair" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-RERUN-1", attempt_type: "rerun" })
  ]);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-MULTI-UNDERCOUNT", executionResult: result });
  const accounting = recorded.research_gate_report.report.search_denominator.multiple_comparison_accounting;

  assert.equal(accounting.status, "multiple_comparison_context_underreports_known_attempts");
  assert.equal(accounting.known_worker_attempt_count, 1);
  assert.equal(accounting.known_non_worker_attempt_count, 5);
  assert.equal(accounting.known_attempt_count, 6);
  assert.equal(accounting.multiple_comparison_total_strategies_tested, 3);
  assert.equal(accounting.underreported_known_attempt_count, 3);
  assert.equal(recorded.research_gate_report.report.flags.includes("multiple_comparison_context_underreports_known_attempts"), true);
  assert.equal(recorded.research_gate_report.report.search_denominator.complete, true);
  assert.equal(recorded.research_gate_report.report.search_denominator.statistical_tests_enabled, false);
});

test("candidate research gate report flags inconsistent optimizer search trial counts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-OPTIMIZER-COUNT-MISMATCH", job_id: "JOB-RESEARCH-GATE-OPTIMIZER-COUNT-MISMATCH" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext({ planned_trial_count: 20, completed_trial_count: 12, failed_trial_count: 3 }));
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext());
  attachNonWorkerDenominatorArtifact(rootDir, result, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MUTATION-1", attempt_type: "mutation" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-REPAIR-1", attempt_type: "repair" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-RERUN-1", attempt_type: "rerun" })
  ]);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-OPTIMIZER-COUNT-MISMATCH", executionResult: result });
  const accounting = recorded.research_gate_report.report.search_denominator.optimizer_trial_accounting;

  assert.equal(accounting.status, "optimizer_search_context_trial_counts_inconsistent");
  assert.equal(accounting.optimizer_search_planned_trial_count, 20);
  assert.equal(accounting.optimizer_search_accounted_trial_count, 15);
  assert.equal(accounting.optimizer_search_planned_accounting_delta, 5);
  assert.equal(recorded.research_gate_report.report.flags.includes("optimizer_search_context_trial_counts_inconsistent"), true);
  assert.equal(recorded.research_gate_report.report.search_denominator.complete, true);
  assert.equal(recorded.research_gate_report.report.search_denominator.statistical_tests_enabled, false);
});

test("candidate research gate report consumes hash-backed PBO input artifact", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext());
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext());
  attachNonWorkerDenominatorArtifact(rootDir, result, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MUTATION-1", attempt_type: "mutation" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-REPAIR-1", attempt_type: "repair" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-RERUN-1", attempt_type: "rerun" })
  ]);
  const pboArtifact = attachPboInputArtifact(rootDir, result, pboInputs());

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "computed_advisory");
  assert.equal(report.statistical_tests.pbo.enabled_as_promotion_gate, false);
  assert.equal(report.statistical_tests.pbo.source_artifacts[0].path, pboArtifact.path);
  assert.equal(report.statistical_tests.pbo.source_artifacts[0].hash_verified, true);
  assert.equal(report.evidence_paths.includes(pboArtifact.path), true);
  assert.equal(report.flags.includes("pbo_computed_advisory"), true);
});

test("candidate research gate report consumes documented PBO input matrix fixture deterministically", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-FIXTURE", job_id: "JOB-RESEARCH-GATE-PBO-FIXTURE" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "statistics", "pbo-input-matrix-v1.example.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const pboArtifact = attachPboInputArtifact(rootDir, result, fixture);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-FIXTURE", executionResult: result });
  const pbo = recorded.research_gate_report.report.statistical_tests.pbo;

  assert.equal(pbo.status, "computed_advisory");
  assert.equal(pbo.enabled_as_promotion_gate, false);
  assert.equal(pbo.probability, 1);
  assert.equal(pbo.split_count, 4);
  assert.equal(pbo.trial_count, 4);
  assert.equal(pbo.matrix_row_count, 4);
  assert.deepEqual(pbo.objective, { metric: "sharpe", direction: "maximize" });
  assert.equal(pbo.source_artifacts[0].path, pboArtifact.path);
  assert.equal(pbo.source_artifacts[0].hash_verified, true);
  assert.deepEqual(
    pbo.split_results.map((split) => [split.split_id, split.selected_trial_id, split.oos_rank_worst_to_best, split.oos_rank_best_to_worst, split.overfit_flag]),
    [
      ["split_1", "TRIAL-A", 1, 4, true],
      ["split_2", "TRIAL-A", 1, 4, true],
      ["split_3", "TRIAL-B", 2, 3, true],
      ["split_4", "TRIAL-B", 1, 4, true]
    ]
  );
});

test("candidate research gate report consumes documented CPCV input matrix fixture deterministically", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-CPCV-FIXTURE", job_id: "JOB-RESEARCH-GATE-CPCV-FIXTURE" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "statistics", "cpcv-input-matrix-v1.example.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const cpcvArtifact = attachCpcvInputArtifact(rootDir, result, fixture);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-CPCV-FIXTURE", executionResult: result });
  const report = recorded.research_gate_report.report;
  const cpcv = report.statistical_tests.cpcv;

  assert.equal(cpcv.status, "computed_advisory");
  assert.equal(cpcv.enabled_as_promotion_gate, false);
  assert.equal(cpcv.statistic, "combinatorial_purged_cross_validation_summary");
  assert.deepEqual(cpcv.objective, { metric: "sharpe", direction: "maximize" });
  assert.equal(cpcv.fold_count, 4);
  assert.equal(cpcv.combination_count, 4);
  assert.equal(cpcv.matrix_row_count, 4);
  assert.equal(cpcv.mean_oos_performance, 0.2075);
  assert.equal(cpcv.median_oos_performance, 0.245);
  assert.equal(cpcv.benchmark_pass_rate, 0.75);
  assert.equal(cpcv.total_trade_count, 68);
  assert.equal(cpcv.source_artifacts[0].path, cpcvArtifact.path);
  assert.equal(report.evidence_paths.includes(cpcvArtifact.path), true);
  assert.equal(report.flags.includes("cpcv_computed_advisory"), true);
  assert.equal(cpcv.interpretation, "advisory_only_not_a_promotion_gate");
});

test("candidate research gate report blocks ambiguous multiple CPCV input artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-CPCV-MULTIPLE", job_id: "JOB-RESEARCH-GATE-CPCV-MULTIPLE" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachCpcvInputArtifact(rootDir, result, cpcvInputs(), { fileName: "cpcv-input-matrix-a.json" });
  attachCpcvInputArtifact(rootDir, result, cpcvInputs({ combination_count: 5 }), { fileName: "cpcv-input-matrix-b.json" });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-CPCV-MULTIPLE", executionResult: result });
  const cpcv = recorded.research_gate_report.report.statistical_tests.cpcv;

  assert.equal(cpcv.status, "blocked_insufficient_inputs");
  assert.equal(cpcv.missing_inputs.includes("single_cpcv_input_matrix_source_artifact"), true);
  assert.match(cpcv.diagnostics.join("; "), /multiple cpcv_input_matrix artifacts are ambiguous/i);
  assert.equal(cpcv.benchmark_pass_rate, undefined);
});

test("candidate research gate report consumes documented White Reality Check input fixture deterministically", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-WHITE-FIXTURE", job_id: "JOB-RESEARCH-GATE-WHITE-FIXTURE" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "statistics", "white-reality-check-input-v1.example.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const whiteArtifact = attachWhiteRealityCheckInputArtifact(rootDir, result, fixture);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-WHITE-FIXTURE", executionResult: result });
  const report = recorded.research_gate_report.report;
  const white = report.statistical_tests.white_reality_check;

  assert.equal(white.status, "computed_advisory");
  assert.equal(white.enabled_as_promotion_gate, false);
  assert.equal(white.statistic, "white_reality_check_supplied_null_p_value");
  assert.deepEqual(white.objective, { metric: "sharpe", direction: "maximize" });
  assert.equal(white.p_value, 0.166667);
  assert.equal(white.null_sample_count, 6);
  assert.equal(white.extreme_null_sample_count, 1);
  assert.equal(white.source_artifacts[0].path, whiteArtifact.path);
  assert.equal(report.evidence_paths.includes(whiteArtifact.path), true);
  assert.equal(report.flags.includes("white_reality_check_computed_advisory"), true);
  assert.equal(white.interpretation, "advisory_only_not_a_promotion_gate");
});

test("candidate research gate report blocks ambiguous multiple White Reality Check input artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-WHITE-MULTIPLE", job_id: "JOB-RESEARCH-GATE-WHITE-MULTIPLE" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachWhiteRealityCheckInputArtifact(rootDir, result, whiteRealityCheckInputs(), { fileName: "white-input-a.json" });
  attachWhiteRealityCheckInputArtifact(rootDir, result, whiteRealityCheckInputs({ trial_count: 7 }), { fileName: "white-input-b.json" });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-WHITE-MULTIPLE", executionResult: result });
  const white = recorded.research_gate_report.report.statistical_tests.white_reality_check;

  assert.equal(white.status, "blocked_insufficient_inputs");
  assert.equal(white.missing_inputs.includes("single_white_reality_check_input_source_artifact"), true);
  assert.match(white.diagnostics.join("; "), /multiple white_reality_check_input artifacts are ambiguous/i);
  assert.equal(white.p_value, undefined);
});

test("candidate research gate report blocks White Reality Check on hash-mismatched input artifact", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-WHITE-BAD-HASH", job_id: "JOB-RESEARCH-GATE-WHITE-BAD-HASH" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachWhiteRealityCheckInputArtifact(rootDir, result, whiteRealityCheckInputs(), { sha256: "0".repeat(64) });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-WHITE-BAD-HASH", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.white_reality_check.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.match(report.statistical_tests.white_reality_check.diagnostics.join("; "), /sha256 mismatch/i);
  assert.equal(report.statistical_tests.white_reality_check.p_value, undefined);
  assert.equal(report.flags.includes("white_reality_check_blocked_insufficient_inputs"), true);
});

test("candidate research gate report blocks PBO on hash-mismatched input artifact", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-BAD-HASH", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-BAD-HASH" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext());
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext());
  attachNonWorkerDenominatorArtifact(rootDir, result, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MUTATION-1", attempt_type: "mutation" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-REPAIR-1", attempt_type: "repair" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-RERUN-1", attempt_type: "rerun" })
  ]);
  attachPboInputArtifact(rootDir, result, pboInputs(), { sha256: "0".repeat(64) });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-BAD-HASH", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
  assert.equal(report.flags.includes("pbo_blocked_insufficient_inputs"), true);
});

test("candidate research gate report surfaces malformed PBO input artifact diagnostics", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MALFORMED", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-MALFORMED" }) });
  attachOptimizerSearchContextArtifact(rootDir, result, optimizerSearchContext());
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext());
  attachNonWorkerDenominatorArtifact(rootDir, result, [
    nonWorkerAttempt({ attempt_id: "ATTEMPT-LLM-1", attempt_type: "llm_generated" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MANUAL-1", attempt_type: "manual" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-MUTATION-1", attempt_type: "mutation" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-REPAIR-1", attempt_type: "repair" }),
    nonWorkerAttempt({ attempt_id: "ATTEMPT-RERUN-1", attempt_type: "rerun" })
  ]);
  attachRawPboInputArtifact(rootDir, result, "{not valid json\n");

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MALFORMED", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /JSON|Unexpected|valid/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks ambiguous multiple PBO input artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MULTIPLE", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-MULTIPLE" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachPboInputArtifact(rootDir, result, pboInputs(), { fileName: "pbo-input-matrix-a.json" });
  attachPboInputArtifact(rootDir, result, pboInputs({ trial_count: 5 }), { fileName: "pbo-input-matrix-b.json" });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MULTIPLE", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("single_pbo_input_matrix_source_artifact"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /multiple pbo_input_matrix artifacts are ambiguous/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact identity mismatch", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-IDENTITY", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-IDENTITY" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachPboInputArtifact(rootDir, result, pboInputs({ lineage_id: "LINEAGE-OTHER-WFA" }));

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-IDENTITY", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("lineage_id_match"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact missing split IDs", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MISSING-SPLITS", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-MISSING-SPLITS" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachPboInputArtifact(rootDir, result, pboInputs({ split_ids: [] }));

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MISSING-SPLITS", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("split_ids>=2"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact with missing matrix rows", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MISSING-ROWS", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-MISSING-ROWS" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachPboInputArtifact(rootDir, result, pboInputs({ trial_count: 5 }));

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MISSING-ROWS", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count_matches_performance_matrix_rows"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact with missing schema version", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MISSING-SCHEMA", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-MISSING-SCHEMA" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const { schema_version: _schemaVersion, ...unversionedPbo } = pboInputs();
  attachPboInputArtifact(rootDir, result, unversionedPbo);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-MISSING-SCHEMA", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("schema_version:pbo_input_matrix_v1"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact with malformed split IDs", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-BAD-SPLITS", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-BAD-SPLITS" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachPboInputArtifact(rootDir, result, pboInputs({ split_ids: ["split_1", "", "split_2", "split_3"] }));

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-BAD-SPLITS", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_split_ids"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /split_id_1_invalid/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact without split_ids array", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-SPLIT-IDS", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-NO-SPLIT-IDS" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const { split_ids: _splitIds, ...withoutSplitIds } = pboInputs({ splits: ["split_1", "split_2", "split_3", "split_4"] });
  attachPboInputArtifact(rootDir, result, withoutSplitIds);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-SPLIT-IDS", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("split_ids_array"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("split_ids>=2"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact missing performance matrix array", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-MATRIX", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-NO-MATRIX" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const { performance_matrix: _performanceMatrix, ...withoutMatrix } = pboInputs();
  attachPboInputArtifact(rootDir, result, withoutMatrix);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-MATRIX", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("performance_matrix_array"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("performance_matrix>=2_valid_rows"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact with train/test row aliases", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-ALIASES", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-ALIASES" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  attachPboInputArtifact(rootDir, result, pboInputs({
    performance_matrix: [
      { trial_id: "TRIAL-A", train: [0.9, 0.7, 0.2, 0.1], test: [0.1, 0.2, 0.3, 0.4] },
      { trial_id: "TRIAL-B", train: [0.2, 0.1, 0.9, 0.8], test: [0.8, 0.7, 0.2, 0.1] },
      { trial_id: "TRIAL-C", train: [0.3, 0.4, 0.4, 0.3], test: [0.5, 0.4, 0.5, 0.6] },
      { trial_id: "TRIAL-D", train: [0.1, 0.2, 0.1, 0.2], test: [0.2, 0.3, 0.1, 0.2] }
    ]
  }));

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-ALIASES", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("performance_matrix>=2_valid_rows"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /TRIAL-A_missing_is_array/i);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /TRIAL-A_missing_oos_array/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact without canonical trial_count", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-TRIAL-COUNT", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-NO-TRIAL-COUNT" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const { trial_count: _trialCount, ...withoutTrialCount } = pboInputs({ strategy_count: 4 });
  attachPboInputArtifact(rootDir, result, withoutTrialCount);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-TRIAL-COUNT", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count>=2"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("candidate research gate report blocks PBO artifact without objective", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-OBJECTIVE", job_id: "JOB-RESEARCH-GATE-PBO-ARTIFACT-NO-OBJECTIVE" }) });
  attachCompleteResearchGateDenominator(rootDir, result);
  const { objective: _objective, ...withoutObjective } = pboInputs();
  attachPboInputArtifact(rootDir, result, withoutObjective);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-PBO-ARTIFACT-NO-OBJECTIVE", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.metric"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.direction:maximize_or_minimize"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate DSR computes only as advisory when complete hash-backed inputs exist", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      worker_result: { lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" },
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs() }
  });

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.statistical_tests.dsr.status, "computed_advisory");
  assert.equal(report.statistical_tests.dsr.enabled_as_promotion_gate, false);
  assert.equal(report.statistical_tests.dsr.statistic, "deflated_sharpe_ratio");
  assert.equal(report.statistical_tests.dsr.trial_count, 15);
  assert.equal(report.statistical_tests.dsr.denominator_review.status, "declared_trial_count_covers_multiple_comparison_context");
  assert.equal(report.statistical_tests.dsr.source_artifacts[0].hash_verified, true);
  assert.equal(report.evidence_paths.includes("factory/runs/RUN-DSR/stat-inputs/oos-returns.json"), true);
  assert.equal(report.flags.includes("dsr_computed_advisory"), true);
  assert.equal(report.statistical_tests.dsr.probability > 0.99, true);
  assert.equal(report.statistical_tests.pbo.status, "disabled_advisory");
  assert.equal(report.statistical_tests.cpcv.status, "disabled_advisory");
  assert.equal(report.statistical_tests.white_reality_check.status, "disabled_advisory");
});

test("research gate DSR blocks when requested inputs are not hash-backed", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-BLOCKED",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      worker_result: { lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" },
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs({ source_artifacts: [{ artifact_type: "dsr_input", path: "factory/runs/RUN-DSR/stat-inputs/oos-returns.json", sha256: "d".repeat(64), hash_verified: false }] }) }
  });

  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
  assert.equal(report.flags.includes("dsr_blocked_insufficient_inputs"), true);
});

test("research gate advisory stats block unreadable source artifacts", () => {
  const denominator = completeSearchDenominatorInputs();
  const unreadable = { read_error: "statistical input artifact could not be read" };
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-STAT-UNREADABLE-SOURCE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      worker_result: { lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" },
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: {
      dsr: dsrInputs({ source_artifacts: [{ ...dsrInputs().source_artifacts[0], ...unreadable }] }),
      pbo: pboInputs({ source_artifacts: [{ ...pboInputs().source_artifacts[0], ...unreadable }] }),
      cpcv: cpcvInputs({ source_artifacts: [{ ...cpcvInputs().source_artifacts[0], ...unreadable }] }),
      white_reality_check: whiteRealityCheckInputs({ source_artifacts: [{ ...whiteRealityCheckInputs().source_artifacts[0], ...unreadable }] })
    }
  });

  for (const statistic of [report.statistical_tests.dsr, report.statistical_tests.pbo, report.statistical_tests.cpcv, report.statistical_tests.white_reality_check]) {
    assert.equal(statistic.status, "blocked_insufficient_inputs");
    assert.equal(statistic.missing_inputs.includes("readable_source_artifacts"), true);
    assert.match(statistic.diagnostics.join("; "), /could not be read/);
  }
  assert.equal(report.flags.includes("dsr_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("pbo_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("cpcv_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("white_reality_check_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("dsr_input_source_unreadable"), true);
  assert.equal(report.flags.includes("pbo_input_source_unreadable"), true);
  assert.equal(report.flags.includes("cpcv_input_source_unreadable"), true);
  assert.equal(report.flags.includes("white_reality_check_input_source_unreadable"), true);
  assert.equal(report.flags.includes("dsr_computed_advisory"), false);
  assert.equal(report.flags.includes("pbo_computed_advisory"), false);
  assert.equal(report.flags.includes("cpcv_computed_advisory"), false);
  assert.equal(report.flags.includes("white_reality_check_computed_advisory"), false);
});

test("research gate DSR requires explicit trial count instead of falling back to multiple-comparison context", () => {
  const denominator = completeSearchDenominatorInputs();
  const { trial_count: _trialCount, ...withoutTrialCount } = dsrInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-NO-TRIAL-COUNT",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: withoutTrialCount }
  });

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.search_denominator.multiple_comparison_total_strategies_tested, 15);
  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("trial_count"), true);
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("trial_count>=1"), true);
  assert.equal(report.statistical_tests.dsr.denominator_review.status, "declared_trial_count_missing");
  assert.equal(report.statistical_tests.dsr.denominator_review.explicit_trial_count_required, true);
  assert.equal(report.statistical_tests.dsr.denominator_review.declared_trial_count_present, false);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
  assert.equal(report.flags.includes("dsr_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("dsr_input_trial_count_not_declared"), true);
  assert.equal(report.flags.includes("dsr_computed_advisory"), false);
});

test("research gate DSR requires integer trial count", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-NONINTEGER-TRIAL-COUNT",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs({ trial_count: 15.5 }) }
  });

  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("integer_trial_count"), true);
  assert.equal(report.statistical_tests.dsr.denominator_review.status, "declared_trial_count_not_integer");
  assert.equal(report.statistical_tests.dsr.denominator_review.declared_trial_count_present, true);
  assert.equal(report.statistical_tests.dsr.denominator_review.declared_trial_count_is_integer, false);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
  assert.equal(report.flags.includes("dsr_input_trial_count_not_integer"), true);
  assert.equal(report.flags.includes("dsr_computed_advisory"), false);
});

test("research gate DSR distinguishes non-numeric trial count from non-integer trial count", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-NONNUMERIC-TRIAL-COUNT",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs({ trial_count: "15" }) }
  });

  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.denominator_review.status, "declared_trial_count_not_numeric");
  assert.equal(report.statistical_tests.dsr.denominator_review.declared_trial_count_present, true);
  assert.equal(report.statistical_tests.dsr.denominator_review.declared_trial_count, null);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
  assert.equal(report.flags.includes("dsr_input_trial_count_not_numeric"), true);
  assert.equal(report.flags.includes("dsr_input_trial_count_not_integer"), false);
  assert.equal(report.flags.includes("dsr_computed_advisory"), false);
});

test("research gate DSR flags non-positive trial counts without computing advisory probability", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-ZERO-TRIAL-COUNT",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs({ trial_count: 0 }) }
  });

  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("trial_count>=1"), true);
  assert.equal(report.statistical_tests.dsr.denominator_review.status, "declared_trial_count_not_positive");
  assert.equal(report.statistical_tests.dsr.denominator_review.declared_trial_count_is_positive_integer, false);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
  assert.equal(report.flags.includes("dsr_input_trial_count_not_positive"), true);
  assert.equal(report.flags.includes("dsr_computed_advisory"), false);
});

test("research gate DSR blocks wrong statistical source artifact type", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-WRONG-TYPE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs({ source_artifacts: [{ artifact_type: "pbo_input_matrix", path: "factory/runs/RUN-DSR/stat-inputs/oos-returns.json", sha256: "d".repeat(64), hash_verified: true }] }) }
  });

  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("dsr_input_source_artifacts"), true);
  assert.match(report.statistical_tests.dsr.diagnostics.join("; "), /artifact_type_must_be_dsr_input/);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
  assert.equal(report.flags.includes("dsr_blocked_insufficient_inputs"), true);
});

test("research gate DSR blocks candidate identity mismatch", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-IDENTITY-MISMATCH",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs({ candidate_id: "CAND-OTHER-WFA-001" }) }
  });

  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("candidate_id_match"), true);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
  assert.equal(report.flags.includes("dsr_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("dsr_input_identity_mismatch"), true);
  assert.equal(report.flags.includes("dsr_computed_advisory"), false);
});

test("research gate DSR flags malformed identity fields", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-MALFORMED-IDENTITY",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      worker_result: { lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" },
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { dsr: dsrInputs({ lineage_id: "bad lineage id" }) }
  });

  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("lineage_id_match"), true);
  assert.match(report.statistical_tests.dsr.diagnostics.join("; "), /lineage_id_must_be_canonical_identifier/);
  assert.equal(report.flags.includes("dsr_input_identity_mismatch"), true);
  assert.equal(report.flags.includes("dsr_input_identity_missing_or_malformed"), true);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
});

test("research gate DSR blocks when search denominator is incomplete", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-DSR-INCOMPLETE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      metrics_observed: { sharpe_oos: 1.2, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    statisticalTestInputs: { dsr: dsrInputs() }
  });

  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.statistical_tests.dsr.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.dsr.missing_inputs.includes("complete_search_denominator"), true);
  assert.equal(report.statistical_tests.dsr.denominator_review.status, "multiple_comparison_context_missing");
  assert.equal(report.statistical_tests.dsr.denominator_review.multiple_comparison_context_available, false);
  assert.equal(report.statistical_tests.dsr.denominator_review.multiple_comparison_total_strategies_tested, null);
  assert.equal(report.statistical_tests.dsr.probability, undefined);
});

test("research gate PBO computes only as advisory when complete hash-backed inputs exist", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      worker_result: { lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" },
      metrics_observed: { sharpe_oos: 0.6, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs() }
  });

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.statistical_tests.pbo.status, "computed_advisory");
  assert.equal(report.statistical_tests.pbo.enabled_as_promotion_gate, false);
  assert.equal(report.statistical_tests.pbo.statistic, "probability_of_backtest_overfit");
  assert.equal(report.statistical_tests.pbo.probability, 1);
  assert.deepEqual(report.statistical_tests.pbo.objective, { metric: "sharpe", direction: "maximize" });
  assert.equal(report.statistical_tests.pbo.split_results[0].oos_rank_worst_to_best, 1);
  assert.equal(report.statistical_tests.pbo.split_results[0].oos_rank_best_to_worst, 4);
  assert.equal(report.statistical_tests.pbo.split_results[0].oos_rank_order, "ascending_worst_to_best");
  assert.equal(report.statistical_tests.pbo.split_count, 4);
  assert.equal(report.statistical_tests.pbo.matrix_row_count, 4);
  assert.equal(report.statistical_tests.pbo.denominator_review.status, "declared_trial_count_underreports_multiple_comparison_context");
  assert.equal(report.statistical_tests.pbo.denominator_review.underreported_by, 11);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.provided_source_artifact_count, 1);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.valid_expected_type_source_artifact_count, 1);
  assert.equal(report.statistical_tests.pbo.source_artifacts[0].hash_verified, true);
  assert.equal(report.evidence_paths.includes("factory/runs/RUN-PBO/stat-inputs/is-oos-matrix.json"), true);
  assert.equal(report.flags.includes("pbo_computed_advisory"), true);
  assert.equal(report.flags.includes("pbo_input_denominator_underreports_context"), true);
  assert.equal(report.statistical_tests.pbo.interpretation, "advisory_only_not_a_promotion_gate");
});

test("research gate PBO computes minimize objective direction", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MINIMIZE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      worker_result: { lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" },
      metrics_observed: { sharpe_oos: 0.6, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: {
      pbo: pboInputs({
        objective: { metric: "drawdown", direction: "minimize" },
        performance_matrix: [
          { trial_id: "TRIAL-A", is: [0.1, 0.2, 0.8, 0.7], oos: [0.9, 0.8, 0.3, 0.4] },
          { trial_id: "TRIAL-B", is: [0.8, 0.7, 0.1, 0.2], oos: [0.2, 0.3, 0.9, 0.8] },
          { trial_id: "TRIAL-C", is: [0.4, 0.5, 0.5, 0.4], oos: [0.4, 0.5, 0.4, 0.5] },
          { trial_id: "TRIAL-D", is: [0.6, 0.6, 0.6, 0.6], oos: [0.6, 0.6, 0.6, 0.6] }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.pbo.status, "computed_advisory");
  assert.deepEqual(report.statistical_tests.pbo.objective, { metric: "drawdown", direction: "minimize" });
  assert.equal(report.statistical_tests.pbo.probability, 1);
  assert.equal(report.statistical_tests.pbo.split_results[0].selected_trial_id, "TRIAL-A");
  assert.equal(report.statistical_tests.pbo.split_results[0].oos_rank_worst_to_best, 1);
  assert.equal(report.statistical_tests.pbo.split_results[0].oos_rank_best_to_worst, 4);
  assert.equal(report.statistical_tests.pbo.split_results[0].oos_rank_ascending, 1);
  assert.equal(report.statistical_tests.pbo.split_results[0].oos_rank_order, "descending_worst_to_best");
});

test("research gate PBO blocks when source artifact inputs are missing", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MISSING-SOURCE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ source_artifacts: [] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("source_artifacts"), true);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.provided_source_artifact_count, 0);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.expected_artifact_type, "pbo_input_matrix");
  assert.equal(report.statistical_tests.pbo.probability, undefined);
  assert.equal(report.flags.includes("pbo_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("pbo_input_source_missing"), true);
});

test("research gate PBO blocks when source artifacts is not an array", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-SOURCE-NONARRAY",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ source_artifacts: { artifact_type: "pbo_input_matrix", path: "factory/runs/RUN-PBO/stat-inputs/is-oos-matrix.json", sha256: "e".repeat(64), hash_verified: true } }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("source_artifacts_array"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("source_artifacts"), true);
  assert.equal(report.flags.includes("pbo_input_source_artifacts_not_array"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when source artifact hashes are not verified", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-BAD-HASH",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ source_artifacts: [{ path: "factory/runs/RUN-PBO/stat-inputs/is-oos-matrix.json", sha256: "e".repeat(64), hash_verified: false }] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO reports malformed source artifact fields", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-BAD-SOURCE-FIELDS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ source_artifacts: [{ artifact_type: "pbo_input_matrix", path: " factory/runs/RUN-PBO/stat-inputs/is-oos-matrix.json ", sha256: "not-a-sha", hash_verified: false }] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_source_artifacts"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /source_artifact_0_path_must_be_nonempty_canonical_string/i);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /source_artifact_0_sha256_must_be_hex64/i);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /source_artifact_0_hash_verified_must_be_true/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks non-repo-relative source artifact paths", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-ABSOLUTE-SOURCE-PATH",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ source_artifacts: [{ artifact_type: "pbo_input_matrix", path: "/tmp/is-oos-matrix.json", sha256: "e".repeat(64), hash_verified: true }] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_source_artifacts"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /source_artifact_0_path_must_be_repo_relative_canonical/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
  assert.equal(report.evidence_paths.includes("/tmp/is-oos-matrix.json"), false);
});

test("research gate PBO blocks when source artifact type is missing", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MISSING-SOURCE-TYPE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ source_artifacts: [{ path: "factory/runs/RUN-PBO/stat-inputs/is-oos-matrix.json", sha256: "e".repeat(64), hash_verified: true }] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("pbo_input_matrix_source_artifacts"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.valid_hash_backed_source_artifact_count, 1);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.valid_expected_type_source_artifact_count, 0);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /source_artifact_0_artifact_type_must_be_pbo_input_matrix/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
  assert.equal(report.flags.includes("pbo_input_source_wrong_type"), true);
});

test("research gate PBO blocks when source artifact type is wrong", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-WRONG-SOURCE-TYPE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ source_artifacts: [{ artifact_type: "optimizer_trials", path: "factory/runs/RUN-PBO/stat-inputs/is-oos-matrix.json", sha256: "e".repeat(64), hash_verified: true }] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("pbo_input_matrix_source_artifacts"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /source_artifact_0_artifact_type_must_be_pbo_input_matrix/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when multiple direct source artifacts are supplied", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MULTIPLE-SOURCES",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      pbo: pboInputs({
        source_artifacts: [
          { artifact_type: "pbo_input_matrix", path: "factory/runs/RUN-PBO/stat-inputs/is-oos-matrix-a.json", sha256: "e".repeat(64), hash_verified: true },
          { artifact_type: "pbo_input_matrix", path: "factory/runs/RUN-PBO/stat-inputs/is-oos-matrix-b.json", sha256: "f".repeat(64), hash_verified: true }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("single_pbo_input_matrix_source_artifact"), true);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.provided_source_artifact_count, 2);
  assert.equal(report.statistical_tests.pbo.source_artifact_review.valid_expected_type_source_artifact_count, 2);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
  assert.equal(report.flags.includes("pbo_input_source_artifact_ambiguous"), true);
});

test("research gate PBO blocks when objective is missing", () => {
  const denominator = completeSearchDenominatorInputs();
  const { objective: _objective, ...withoutObjective } = pboInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-NO-OBJECTIVE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: withoutObjective }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.metric"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.direction:maximize_or_minimize"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when objective direction is invalid", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-BAD-OBJECTIVE-DIRECTION",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ objective: { metric: "sharpe", direction: "higher_is_better" } }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.direction:maximize_or_minimize"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /objective_direction_must_be_maximize_or_minimize/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks malformed objective metric and padded direction", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MALFORMED-OBJECTIVE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ objective: { metric: "sharpe ratio", direction: " maximize " } }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.metric"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.direction:maximize_or_minimize"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /objective_metric_must_be_identifier/i);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /objective_direction_must_be_maximize_or_minimize/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO reports non-object objective diagnostics", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-OBJECTIVE-SHAPE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ objective: "sharpe" }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.metric"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("objective.direction:maximize_or_minimize"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /objective_must_be_object/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks on malformed IS/OOS matrix", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-BAD-MATRIX",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ performance_matrix: [{ trial_id: "TRIAL-BAD", is: [1, 2], oos: [1] }] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("performance_matrix>=2_valid_rows"), true);
  assert.match(report.statistical_tests.pbo.diagnostics[0], /split_length_mismatch/i);
});

test("research gate PBO blocks when performance matrix is not an array", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-NO-MATRIX",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ performance_matrix: null }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("performance_matrix_array"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("performance_matrix>=2_valid_rows"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks on missing explicit trial IDs", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MISSING-TRIAL-ID",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      pbo: pboInputs({
        performance_matrix: [
          { is: [0.9, 0.7, 0.2, 0.1], oos: [0.1, 0.2, 0.3, 0.4] },
          { trial_id: "TRIAL-B", is: [0.2, 0.1, 0.9, 0.8], oos: [0.8, 0.7, 0.2, 0.1] },
          { trial_id: "TRIAL-C", is: [0.3, 0.4, 0.4, 0.3], oos: [0.5, 0.4, 0.5, 0.6] },
          { trial_id: "TRIAL-D", is: [0.1, 0.2, 0.1, 0.2], oos: [0.2, 0.3, 0.1, 0.2] }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count_matches_performance_matrix_rows"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /row_0_trial_id_must_be_canonical_identifier/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks whitespace-padded trial IDs", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-PADDED-TRIAL-ID",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      pbo: pboInputs({
        performance_matrix: [
          { trial_id: " TRIAL-A ", is: [0.9, 0.7, 0.2, 0.1], oos: [0.1, 0.2, 0.3, 0.4] },
          { trial_id: "TRIAL-B", is: [0.2, 0.1, 0.9, 0.8], oos: [0.8, 0.7, 0.2, 0.1] },
          { trial_id: "TRIAL-C", is: [0.3, 0.4, 0.4, 0.3], oos: [0.5, 0.4, 0.5, 0.6] },
          { trial_id: "TRIAL-D", is: [0.1, 0.2, 0.1, 0.2], oos: [0.2, 0.3, 0.1, 0.2] }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /row_0_trial_id_must_be_canonical_identifier/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when rows use train/test aliases instead of is/oos", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-ROW-ALIASES",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      pbo: pboInputs({
        performance_matrix: [
          { trial_id: "TRIAL-A", train: [0.9, 0.7, 0.2, 0.1], test: [0.1, 0.2, 0.3, 0.4] },
          { trial_id: "TRIAL-B", train: [0.2, 0.1, 0.9, 0.8], test: [0.8, 0.7, 0.2, 0.1] },
          { trial_id: "TRIAL-C", train: [0.3, 0.4, 0.4, 0.3], test: [0.5, 0.4, 0.5, 0.6] },
          { trial_id: "TRIAL-D", train: [0.1, 0.2, 0.1, 0.2], test: [0.2, 0.3, 0.1, 0.2] }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("performance_matrix>=2_valid_rows"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /TRIAL-A_train_test_aliases_not_allowed/i);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /TRIAL-A_missing_is_array/i);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /TRIAL-A_missing_oos_array/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks train/test aliases even beside canonical is/oos", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-ROW-ALIASES-WITH-CANONICAL",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      pbo: pboInputs({
        performance_matrix: [
          { trial_id: "TRIAL-A", is: [0.9, 0.7, 0.2, 0.1], oos: [0.1, 0.2, 0.3, 0.4], train: [0.9, 0.7, 0.2, 0.1] },
          { trial_id: "TRIAL-B", is: [0.2, 0.1, 0.9, 0.8], oos: [0.8, 0.7, 0.2, 0.1] },
          { trial_id: "TRIAL-C", is: [0.3, 0.4, 0.4, 0.3], oos: [0.5, 0.4, 0.5, 0.6] },
          { trial_id: "TRIAL-D", is: [0.1, 0.2, 0.1, 0.2], oos: [0.2, 0.3, 0.1, 0.2] }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /TRIAL-A_train_test_aliases_not_allowed/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks on duplicate split IDs", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-DUPLICATE-SPLITS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ split_ids: ["split_1", "split_1", "split_2", "split_3"] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("unique_split_ids"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /duplicate_split_ids/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks on duplicate trial IDs", () => {
  const denominator = completeSearchDenominatorInputs();
  const duplicateTrialInputs = pboInputs({
    performance_matrix: [
      { trial_id: "TRIAL-A", is: [0.9, 0.7, 0.2, 0.1], oos: [0.1, 0.2, 0.3, 0.4] },
      { trial_id: "TRIAL-A", is: [0.2, 0.1, 0.9, 0.8], oos: [0.8, 0.7, 0.2, 0.1] },
      { trial_id: "TRIAL-C", is: [0.3, 0.4, 0.4, 0.3], oos: [0.5, 0.4, 0.5, 0.6] },
      { trial_id: "TRIAL-D", is: [0.1, 0.2, 0.1, 0.2], oos: [0.2, 0.3, 0.1, 0.2] }
    ]
  });
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-DUPLICATE-TRIALS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: duplicateTrialInputs }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count_matches_performance_matrix_rows"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /duplicate_trial_id/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when matrix row count does not match declared trial count", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MISSING-ROWS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ trial_count: 5 }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count_matches_performance_matrix_rows"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks on wrong input schema version", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-BAD-SCHEMA",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ schema_version: "pbo_input_matrix_v0" }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("schema_version:pbo_input_matrix_v1"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
  assert.equal(report.flags.includes("pbo_input_schema_version_invalid"), true);
});

test("research gate PBO blocks on malformed split ID entries", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-BAD-SPLIT-IDS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ split_ids: ["split_1", null, "split_2", "split_3"] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_split_ids"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /split_id_1_invalid/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks whitespace-padded split IDs", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-PADDED-SPLIT-ID",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ split_ids: ["split_1", " split_2 ", "split_3", "split_4"] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_split_ids"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /split_id_1_invalid/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks split IDs with non-canonical characters", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MALFORMED-SPLIT-ID",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ split_ids: ["split_1", "split 2", "split_3", "split_4"] }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_split_ids"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /split_id_1_invalid/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when split_ids is missing even if splits alias exists", () => {
  const denominator = completeSearchDenominatorInputs();
  const { split_ids: _splitIds, ...aliasOnlyPbo } = pboInputs({ splits: ["split_1", "split_2", "split_3", "split_4"] });
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-SPLITS-ALIAS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: aliasOnlyPbo }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("split_ids_array"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("split_ids>=2"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks top-level aliases even beside canonical fields", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-ALIASES-WITH-CANONICAL",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ splits: ["split_1", "split_2", "split_3", "split_4"], strategy_count: 4 }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("canonical_pbo_fields_only"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /splits_alias_not_allowed/i);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /strategy_count_alias_not_allowed/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks on non-integer trial count", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-NONINTEGER-TRIALS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ trial_count: 4.5 }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("integer_trial_count"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count_matches_performance_matrix_rows"), true);
  assert.equal(report.statistical_tests.pbo.denominator_review.status, "declared_trial_count_not_integer");
  assert.equal(report.flags.includes("pbo_input_trial_count_not_integer"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks numeric strings in canonical numeric fields", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-NUMERIC-STRINGS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      pbo: pboInputs({
        trial_count: "4",
        performance_matrix: [
          { trial_id: "TRIAL-A", is: ["0.9", 0.7, 0.2, 0.1], oos: [0.1, 0.2, 0.3, 0.4] },
          { trial_id: "TRIAL-B", is: [0.2, 0.1, 0.9, 0.8], oos: [0.8, 0.7, 0.2, 0.1] },
          { trial_id: "TRIAL-C", is: [0.3, 0.4, 0.4, 0.3], oos: [0.5, 0.4, 0.5, 0.6] },
          { trial_id: "TRIAL-D", is: [0.1, 0.2, 0.1, 0.2], oos: [0.2, 0.3, 0.1, 0.2] }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("integer_trial_count"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("well_formed_performance_matrix"), true);
  assert.equal(report.statistical_tests.pbo.denominator_review.status, "declared_trial_count_not_numeric");
  assert.equal(report.flags.includes("pbo_input_trial_count_not_numeric"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /TRIAL-A_non_numeric_performance/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when trial_count is missing even if strategy_count exists", () => {
  const denominator = completeSearchDenominatorInputs();
  const { trial_count: _trialCount, ...aliasOnlyPbo } = pboInputs({ strategy_count: 4 });
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-STRATEGY-COUNT-ALIAS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: aliasOnlyPbo }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("trial_count>=2"), true);
  assert.equal(report.statistical_tests.pbo.denominator_review.status, "declared_trial_count_missing");
  assert.equal(report.flags.includes("pbo_input_trial_count_not_declared"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks on identity mismatch", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-IDENTITY",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ candidate_id: "CAND-OTHER-WFA-001" }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("candidate_id_match"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
  assert.equal(report.flags.includes("pbo_input_identity_mismatch"), true);
});

test("research gate flags CPCV and White identity mismatches", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-STAT-IDENTITY-FLAGS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-DEMO-WFA-001",
      worker_result: { lineage_id: "LINEAGE-DEMO-WFA", family_id: "FAMILY-DEMO-WFA" },
      metrics_observed: { sharpe_oos: 0.6, total_trades: 90, successful_windows: 6, total_windows: 6 }
    },
    ...denominator,
    statisticalTestInputs: {
      cpcv: cpcvInputs({ family_id: "FAMILY-OTHER-WFA" }),
      white_reality_check: whiteRealityCheckInputs({ lineage_id: "LINEAGE-OTHER-WFA" })
    }
  });

  assert.equal(report.statistical_tests.cpcv.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.cpcv.missing_inputs.includes("family_id_match"), true);
  assert.equal(report.flags.includes("cpcv_input_identity_mismatch"), true);
  assert.equal(report.statistical_tests.white_reality_check.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("lineage_id_match"), true);
  assert.equal(report.flags.includes("white_reality_check_input_identity_mismatch"), true);
});

test("research gate PBO reports malformed identity diagnostics even when expected identity mismatches", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-MALFORMED-IDENTITY-MISMATCH",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ candidate_id: " CAND-DEMO-WFA-001 " }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("candidate_id_match"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /candidate_id_must_be_canonical_identifier/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO requires canonical identities when expected identity is absent", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-ABSENT-EXPECTED-IDENTITY",
    executionResult: { status: "executed", evidence_kind: "research_wfa", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ lineage_id: null }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("lineage_id"), true);
  assert.match(report.statistical_tests.pbo.diagnostics.join("; "), /lineage_id_must_be_canonical_identifier/i);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks malformed lineage and family identifiers", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-BAD-IDENTIFIERS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { pbo: pboInputs({ lineage_id: " LINEAGE-DEMO-WFA ", family_id: "FAMILY DEMO WFA" }) }
  });

  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("lineage_id"), true);
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("family_id"), true);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate PBO blocks when search denominator is incomplete", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-PBO-INCOMPLETE-DENOM",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    statisticalTestInputs: { pbo: pboInputs() }
  });

  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.statistical_tests.pbo.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.pbo.missing_inputs.includes("complete_search_denominator"), true);
  assert.equal(report.statistical_tests.pbo.denominator_review.status, "multiple_comparison_context_missing");
  assert.equal(report.statistical_tests.pbo.denominator_review.multiple_comparison_context_available, false);
  assert.equal(report.statistical_tests.pbo.denominator_review.multiple_comparison_total_strategies_tested, null);
  assert.equal(report.statistical_tests.pbo.probability, undefined);
});

test("research gate CPCV computes only as advisory when complete hash-backed inputs exist", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-CPCV",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { cpcv: cpcvInputs() }
  });

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.statistical_tests.cpcv.status, "computed_advisory");
  assert.equal(report.statistical_tests.cpcv.enabled_as_promotion_gate, false);
  assert.equal(report.statistical_tests.cpcv.statistic, "combinatorial_purged_cross_validation_summary");
  assert.equal(report.statistical_tests.cpcv.mean_oos_performance, 0.2075);
  assert.equal(report.statistical_tests.cpcv.median_oos_performance, 0.245);
  assert.equal(report.statistical_tests.cpcv.min_oos_performance, -0.08);
  assert.equal(report.statistical_tests.cpcv.max_oos_performance, 0.42);
  assert.equal(report.statistical_tests.cpcv.benchmark_pass_count, 3);
  assert.equal(report.statistical_tests.cpcv.benchmark_pass_rate, 0.75);
  assert.equal(report.statistical_tests.cpcv.total_trade_count, 68);
  assert.equal(report.statistical_tests.cpcv.denominator_review.status, "declared_trial_count_missing");
  assert.equal(report.statistical_tests.cpcv.source_artifact_review.expected_artifact_type, "cpcv_input_matrix");
  assert.equal(report.statistical_tests.cpcv.source_artifact_review.valid_expected_type_source_artifact_count, 1);
  assert.equal(report.evidence_paths.includes("factory/runs/RUN-CPCV/stat-inputs/cpcv-matrix.json"), true);
  assert.equal(report.flags.includes("cpcv_computed_advisory"), true);
  assert.equal(report.flags.includes("cpcv_input_trial_count_not_declared"), true);
  assert.equal(report.statistical_tests.cpcv.interpretation, "advisory_only_not_a_promotion_gate");
});

test("research gate CPCV computes minimize objective direction", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-CPCV-MINIMIZE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      cpcv: cpcvInputs({
        objective: { metric: "drawdown", direction: "minimize" },
        benchmark_performance: 0.2,
        combinations: [
          { combination_id: "CPCV-1", train_group_ids: ["fold_1", "fold_2"], test_group_ids: ["fold_3"], oos_performance: 0.12, trade_count: 18 },
          { combination_id: "CPCV-2", train_group_ids: ["fold_1", "fold_3"], test_group_ids: ["fold_4"], oos_performance: 0.24, trade_count: 16 },
          { combination_id: "CPCV-3", train_group_ids: ["fold_2", "fold_4"], test_group_ids: ["fold_1"], oos_performance: 0.18, trade_count: 14 },
          { combination_id: "CPCV-4", train_group_ids: ["fold_3", "fold_4"], test_group_ids: ["fold_2"], oos_performance: 0.33, trade_count: 20 }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.cpcv.status, "computed_advisory");
  assert.deepEqual(report.statistical_tests.cpcv.objective, { metric: "drawdown", direction: "minimize" });
  assert.equal(report.statistical_tests.cpcv.benchmark_pass_count, 2);
  assert.equal(report.statistical_tests.cpcv.benchmark_pass_rate, 0.5);
  assert.deepEqual(report.statistical_tests.cpcv.combination_results.map((row) => row.benchmark_pass), [true, false, true, false]);
});

test("research gate CPCV blocks when source artifact inputs are missing", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-CPCV-MISSING-SOURCE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { cpcv: cpcvInputs({ source_artifacts: [] }) }
  });

  assert.equal(report.statistical_tests.cpcv.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.cpcv.missing_inputs.includes("source_artifacts"), true);
  assert.equal(report.statistical_tests.cpcv.benchmark_pass_rate, undefined);
  assert.equal(report.flags.includes("cpcv_blocked_insufficient_inputs"), true);
});

test("research gate CPCV blocks malformed combination rows", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-CPCV-BAD-COMBINATIONS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      cpcv: cpcvInputs({
        combinations: [
          { combination_id: "CPCV-1", train_group_ids: ["fold_1", "fold_2"], test_group_ids: ["fold_2"], oos_performance: "0.1", trade_count: 18 },
          { combination_id: " CPCV-2 ", train_group_ids: ["fold_1"], test_group_ids: ["fold_3"], oos_performance: 0.2, trade_count: 16 }
        ]
      })
    }
  });

  assert.equal(report.statistical_tests.cpcv.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.cpcv.missing_inputs.includes("well_formed_combinations"), true);
  assert.equal(report.statistical_tests.cpcv.missing_inputs.includes("combination_count_matches_rows"), true);
  assert.match(report.statistical_tests.cpcv.diagnostics.join("; "), /CPCV-1_train_test_groups_overlap/i);
  assert.match(report.statistical_tests.cpcv.diagnostics.join("; "), /CPCV-1_oos_performance_must_be_numeric/i);
  assert.match(report.statistical_tests.cpcv.diagnostics.join("; "), /combination_1_id_must_be_canonical_identifier/i);
  assert.equal(report.statistical_tests.cpcv.benchmark_pass_rate, undefined);
});

test("research gate CPCV blocks identity mismatch and incomplete denominator", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-CPCV-INCOMPLETE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    statisticalTestInputs: { cpcv: cpcvInputs({ candidate_id: "CAND-OTHER-WFA-001" }) }
  });

  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.statistical_tests.cpcv.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.cpcv.missing_inputs.includes("complete_search_denominator"), true);
  assert.equal(report.statistical_tests.cpcv.missing_inputs.includes("candidate_id_match"), true);
  assert.equal(report.statistical_tests.cpcv.benchmark_pass_rate, undefined);
});

test("research gate White Reality Check computes only as advisory when complete hash-backed inputs exist", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WHITE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { white_reality_check: whiteRealityCheckInputs() }
  });

  assert.equal(report.search_denominator.complete, true);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.statistical_tests.white_reality_check.status, "computed_advisory");
  assert.equal(report.statistical_tests.white_reality_check.enabled_as_promotion_gate, false);
  assert.equal(report.statistical_tests.white_reality_check.statistic, "white_reality_check_supplied_null_p_value");
  assert.equal(report.statistical_tests.white_reality_check.p_value, 0.166667);
  assert.equal(report.statistical_tests.white_reality_check.null_sample_count, 6);
  assert.equal(report.statistical_tests.white_reality_check.extreme_null_sample_count, 1);
  assert.equal(report.statistical_tests.white_reality_check.source_artifact_review.expected_artifact_type, "white_reality_check_input");
  assert.equal(report.statistical_tests.white_reality_check.source_artifact_review.valid_expected_type_source_artifact_count, 1);
  assert.equal(report.evidence_paths.includes("factory/runs/RUN-WHITE/stat-inputs/white-input.json"), true);
  assert.equal(report.flags.includes("white_reality_check_computed_advisory"), true);
  assert.equal(report.statistical_tests.white_reality_check.interpretation, "advisory_only_not_a_promotion_gate");
});

test("research gate White Reality Check computes minimize objective direction", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WHITE-MINIMIZE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      white_reality_check: whiteRealityCheckInputs({
        objective: { metric: "drawdown", direction: "minimize" },
        benchmark_performance: 0.2,
        observed_best_performance: 0.12,
        null_distribution: [0.1, 0.15, 0.2, 0.4]
      })
    }
  });

  assert.equal(report.statistical_tests.white_reality_check.status, "computed_advisory");
  assert.deepEqual(report.statistical_tests.white_reality_check.objective, { metric: "drawdown", direction: "minimize" });
  assert.equal(report.statistical_tests.white_reality_check.p_value, 0.25);
  assert.equal(report.statistical_tests.white_reality_check.extreme_null_sample_count, 1);
});

test("research gate White Reality Check blocks malformed supplied null inputs", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WHITE-BAD-INPUTS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      white_reality_check: whiteRealityCheckInputs({
        observed_best_performance: "0.42",
        benchmark_performance: "0",
        trial_count: "6",
        null_distribution: [0.1, "0.2", 0.3],
        bootstrap_distribution: [0.1, 0.2],
        null_assumption: { method: "" },
        source_metadata: { generated_by: "" },
        source_artifacts: []
      })
    }
  });

  assert.equal(report.statistical_tests.white_reality_check.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("observed_best_performance"), true);
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("benchmark_performance"), true);
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("integer_trial_count"), true);
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("well_formed_null_distribution"), true);
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("canonical_white_reality_check_fields_only"), true);
  assert.equal(report.statistical_tests.white_reality_check.denominator_review.status, "declared_trial_count_not_numeric");
  assert.match(report.statistical_tests.white_reality_check.diagnostics.join("; "), /null_distribution_1_must_be_numeric/i);
  assert.equal(report.statistical_tests.white_reality_check.p_value, undefined);
  assert.equal(report.flags.includes("white_reality_check_blocked_insufficient_inputs"), true);
  assert.equal(report.flags.includes("white_reality_check_input_trial_count_not_numeric"), true);
});

test("research gate White Reality Check flags non-positive trial counts", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WHITE-ZERO-TRIALS",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { white_reality_check: whiteRealityCheckInputs({ trial_count: 0 }) }
  });

  assert.equal(report.statistical_tests.white_reality_check.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("trial_count>=1"), true);
  assert.equal(report.statistical_tests.white_reality_check.denominator_review.status, "declared_trial_count_not_positive");
  assert.equal(report.statistical_tests.white_reality_check.p_value, undefined);
  assert.equal(report.flags.includes("white_reality_check_input_trial_count_not_positive"), true);
  assert.equal(report.flags.includes("white_reality_check_computed_advisory"), false);
});

test("research gate White Reality Check reports malformed source artifact fields", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WHITE-BAD-SOURCE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: {
      white_reality_check: whiteRealityCheckInputs({
        source_artifacts: [{ artifact_type: "not_white", path: " factory/runs/RUN-WHITE/stat-inputs/white-input.json ", sha256: "bad", hash_verified: false }]
      })
    }
  });

  assert.equal(report.statistical_tests.white_reality_check.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("hash_verified_source_artifacts"), true);
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("white_reality_check_input_source_artifacts"), true);
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("well_formed_source_artifacts"), true);
  assert.match(report.statistical_tests.white_reality_check.diagnostics.join("; "), /artifact_type_must_be_white_reality_check_input/i);
  assert.match(report.statistical_tests.white_reality_check.diagnostics.join("; "), /path_must_be_nonempty_canonical_string/i);
  assert.match(report.statistical_tests.white_reality_check.diagnostics.join("; "), /sha256_must_be_hex64/i);
  assert.equal(report.statistical_tests.white_reality_check.p_value, undefined);
});

test("research gate White Reality Check blocks when trial count cannot cover supplied null samples", () => {
  const denominator = completeSearchDenominatorInputs();
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WHITE-TRIAL-SAMPLES",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    ...denominator,
    statisticalTestInputs: { white_reality_check: whiteRealityCheckInputs({ trial_count: 2, null_distribution: [0.1, 0.2, 0.3] }) }
  });

  assert.equal(report.statistical_tests.white_reality_check.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("trial_count_covers_null_distribution_samples"), true);
  assert.equal(report.statistical_tests.white_reality_check.p_value, undefined);
});

test("research gate White Reality Check blocks identity mismatch and incomplete denominator", () => {
  const report = buildResearchWfaGateReport({
    runId: "RUN-RESEARCH-GATE-WHITE-INCOMPLETE",
    candidateId: "CAND-DEMO-WFA-001",
    executionResult: { status: "executed", evidence_kind: "research_wfa", candidate_id: "CAND-DEMO-WFA-001", metrics_observed: { total_trades: 90, successful_windows: 6, total_windows: 6 } },
    statisticalTestInputs: { white_reality_check: whiteRealityCheckInputs({ candidate_id: "CAND-OTHER-WFA-001" }) }
  });

  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.statistical_tests.white_reality_check.status, "blocked_insufficient_inputs");
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("complete_search_denominator"), true);
  assert.equal(report.statistical_tests.white_reality_check.missing_inputs.includes("candidate_id_match"), true);
  assert.equal(report.statistical_tests.white_reality_check.denominator_review.status, "multiple_comparison_context_missing");
  assert.equal(report.statistical_tests.white_reality_check.p_value, undefined);
});

test("candidate research gate report refuses hash-mismatched multiple-comparison context artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-MULTI-COMPARISON-BAD-HASH", job_id: "JOB-RESEARCH-GATE-MULTI-COMPARISON-BAD-HASH" }) });
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext(), { sha256: "0".repeat(64) });

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-MULTI-COMPARISON-BAD-HASH", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.multiple_comparison_context.status, "multiple_comparison_context_artifacts_unreadable");
  assert.equal(report.multiple_comparison_context.context_available, false);
  assert.equal(report.multiple_comparison_context.context_count, 0);
  assert.equal(report.multiple_comparison_context.artifacts[0].hash_verified, false);
  assert.match(report.multiple_comparison_context.artifacts[0].read_error, /sha256 mismatch/i);
  assert.equal(report.search_denominator.multiple_comparison_context_count, 0);
  assert.equal(report.search_denominator.missing_sources.includes("multiple_comparison_context"), true);
  assert.equal(report.search_denominator.covered_sources.includes("multiple_comparison_context"), false);
  assert.equal(report.flags.includes("multiple_comparison_context_artifacts_unreadable"), true);
});

test("candidate research gate report rejects malformed multiple-comparison context rows", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-MULTI-COMPARISON-BAD-ROW", job_id: "JOB-RESEARCH-GATE-MULTI-COMPARISON-BAD-ROW" }) });
  const malformed = multipleComparisonContext({ total_strategies_tested: 0 });
  attachMultipleComparisonContextArtifact(rootDir, result, malformed);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-MULTI-COMPARISON-BAD-ROW", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.multiple_comparison_context.status, "multiple_comparison_context_records_rejected");
  assert.equal(report.multiple_comparison_context.context_available, false);
  assert.equal(report.multiple_comparison_context.context_count, 0);
  assert.equal(report.multiple_comparison_context.artifacts[0].hash_verified, true);
  assert.equal(report.multiple_comparison_context.artifacts[0].records_read, 1);
  assert.equal(report.multiple_comparison_context.artifacts[0].records_accepted, 0);
  assert.equal(report.multiple_comparison_context.artifacts[0].records_rejected, 1);
  assert.equal(report.multiple_comparison_context.rejected_context_count, 1);
  assert.match(report.multiple_comparison_context.rejected_contexts[0].rejection_reason, /total_strategies_tested must be a positive number/i);
  assert.equal(report.search_denominator.missing_sources.includes("multiple_comparison_context"), true);
  assert.equal(report.flags.includes("multiple_comparison_context_records_rejected"), true);
});

test("candidate research gate report rejects identity-mismatched multiple-comparison context rows", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-MULTI-COMPARISON-IDENTITY", job_id: "JOB-RESEARCH-GATE-MULTI-COMPARISON-IDENTITY" }) });
  attachMultipleComparisonContextArtifact(rootDir, result, multipleComparisonContext({ lineage_id: "LINEAGE-OTHER-WFA" }));

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-MULTI-COMPARISON-IDENTITY", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.multiple_comparison_context.status, "multiple_comparison_context_records_rejected");
  assert.equal(report.multiple_comparison_context.context_available, false);
  assert.equal(report.multiple_comparison_context.context_count, 0);
  assert.equal(report.multiple_comparison_context.artifacts[0].hash_verified, true);
  assert.equal(report.multiple_comparison_context.artifacts[0].records_rejected, 1);
  assert.equal(report.multiple_comparison_context.rejected_contexts[0].lineage_id, "LINEAGE-OTHER-WFA");
  assert.match(report.multiple_comparison_context.rejected_contexts[0].rejection_reason, /lineage_id mismatch/i);
  assert.equal(report.search_denominator.missing_sources.includes("multiple_comparison_context"), true);
  assert.equal(report.flags.includes("multiple_comparison_context_records_rejected"), true);
});

test("candidate research gate report refuses unhash-backed trial-attempt artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-TRIAL-DENOM-UNHASHED", job_id: "JOB-RESEARCH-GATE-TRIAL-DENOM-UNHASHED" }) });
  const unhashBackedResult = cloneJson(result);

  for (const container of [unhashBackedResult.artifacts_created, unhashBackedResult.worker_result.artifacts]) {
    for (const artifact of container) {
      if (artifact.artifact_type === "trial_attempt_record") artifact.sha256 = null;
    }
  }

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-TRIAL-DENOM-UNHASHED", executionResult: unhashBackedResult });
  const report = recorded.research_gate_report.report;

  assert.equal(report.trial_denominator.status, "trial_denominator_artifact_unreadable");
  assert.equal(report.trial_denominator.denominator_available, false);
  assert.equal(report.trial_denominator.attempt_count, 0);
  assert.equal(report.trial_denominator.artifacts[0].hash_verified, false);
  assert.match(report.trial_denominator.artifacts[0].read_error, /missing valid sha256/i);
  assert.equal(report.flags.includes("trial_denominator_artifact_unreadable"), true);
  assert.match(report.statistical_tests.dsr.reason, /Disabled until complete trial denominator/i);
});

test("candidate research gate report refuses hash-mismatched trial-attempt artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-TRIAL-DENOM-BAD-HASH", job_id: "JOB-RESEARCH-GATE-TRIAL-DENOM-BAD-HASH" }) });
  const hashMismatchedResult = cloneJson(result);

  for (const container of [hashMismatchedResult.artifacts_created, hashMismatchedResult.worker_result.artifacts]) {
    for (const artifact of container) {
      if (artifact.artifact_type === "trial_attempt_record") artifact.sha256 = "0".repeat(64);
    }
  }

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-TRIAL-DENOM-BAD-HASH", executionResult: hashMismatchedResult });
  const report = recorded.research_gate_report.report;

  assert.equal(report.trial_denominator.status, "trial_denominator_artifact_unreadable");
  assert.equal(report.trial_denominator.denominator_available, false);
  assert.equal(report.trial_denominator.attempt_count, 0);
  assert.equal(report.trial_denominator.artifacts[0].hash_verified, false);
  assert.equal(report.trial_denominator.artifacts[0].records_read, 0);
  assert.match(report.trial_denominator.artifacts[0].read_error, /sha256 mismatch/i);
  assert.equal(report.flags.includes("trial_denominator_artifact_unreadable"), true);
});

test("candidate research gate report rejects trial-attempt rows with mismatched request identity", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5 });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-TRIAL-DENOM-BAD-ROW", job_id: "JOB-RESEARCH-GATE-TRIAL-DENOM-BAD-ROW" }) });
  const identityMismatchedResult = cloneJson(result);
  const trialRecord = result.worker_result.artifacts.find((artifact) => artifact.artifact_type === "trial_attempt_record");
  const trialPath = path.join(rootDir, trialRecord.path);
  const tamperedAttempt = JSON.parse(fs.readFileSync(trialPath, "utf8").trim());
  tamperedAttempt.candidate_id = "CAND-OTHER-WFA-001";
  const tamperedContent = JSON.stringify(tamperedAttempt) + "\n";
  fs.writeFileSync(trialPath, tamperedContent, "utf8");
  const tamperedSha = crypto.createHash("sha256").update(tamperedContent).digest("hex");

  for (const container of [identityMismatchedResult.artifacts_created, identityMismatchedResult.worker_result.artifacts]) {
    for (const artifact of container) {
      if (artifact.artifact_type === "trial_attempt_record") artifact.sha256 = tamperedSha;
    }
  }

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-TRIAL-DENOM-BAD-ROW", executionResult: identityMismatchedResult });
  const report = recorded.research_gate_report.report;

  assert.equal(report.trial_denominator.status, "trial_denominator_records_rejected");
  assert.equal(report.trial_denominator.denominator_available, false);
  assert.equal(report.trial_denominator.attempt_count, 0);
  assert.equal(report.trial_denominator.artifacts[0].hash_verified, true);
  assert.equal(report.trial_denominator.artifacts[0].records_read, 1);
  assert.equal(report.trial_denominator.artifacts[0].records_accepted, 0);
  assert.equal(report.trial_denominator.artifacts[0].records_rejected, 1);
  assert.equal(report.trial_denominator.rejected_attempt_count, 1);
  assert.equal(report.trial_denominator.rejected_attempts[0].candidate_id, "CAND-OTHER-WFA-001");
  assert.match(report.trial_denominator.rejected_attempts[0].rejection_reason, /candidate_id mismatch/i);
  assert.equal(report.flags.includes("trial_denominator_records_rejected"), true);
});

test("candidate research gate report consumes hash-backed optimizer-trial artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-OPTIMIZER-TRIALS", job_id: "JOB-RESEARCH-GATE-OPTIMIZER-TRIALS" }) });
  const optimizerRecord = result.worker_result.artifacts.find((artifact) => artifact.artifact_type === "wfa_optimizer_trials");

  assert.equal(result.status, "executed");
  assert.equal(Boolean(optimizerRecord), true);

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-OPTIMIZER-TRIALS", executionResult: result });
  const report = recorded.research_gate_report.report;

  assert.equal(report.optimizer_trials.status, "optimizer_trial_artifacts_consumed");
  assert.equal(report.optimizer_trials.denominator_available, true);
  assert.equal(report.optimizer_trials.artifact_count, 1);
  assert.equal(report.optimizer_trials.rows_read, 1);
  assert.equal(report.optimizer_trials.artifacts[0].hash_verified, true);
  assert.equal(report.optimizer_trials.artifacts[0].rows_read, 1);
  assert.equal(report.optimizer_trials.artifacts[0].read_error, null);
  assert.equal(report.optimizer_trials.artifact_paths.includes(optimizerRecord.path), true);
  assert.deepEqual(report.search_denominator.covered_sources, ["worker_trial_attempt_records", "optimizer_trial_artifact_rows"]);
  assert.equal(report.search_denominator.missing_sources.includes("complete_optimizer_search_context"), true);
  assert.equal(report.search_denominator.missing_sources.includes("llm_generated_attempts"), true);
  assert.equal(report.search_denominator.worker_attempt_count, 1);
  assert.equal(report.search_denominator.optimizer_trial_row_count, 1);
  assert.equal(report.search_denominator.complete, false);
  assert.equal(report.search_denominator.statistical_tests_enabled, false);
  assert.equal(report.evidence_paths.includes(optimizerRecord.path), true);
  assert.equal(report.flags.includes("optimizer_trial_artifacts_consumed"), true);
  assert.equal(report.flags.includes("search_denominator_incomplete"), true);
});

test("candidate research gate report refuses hash-mismatched optimizer-trial artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  createFakeWfaRoute(rootDir, { totalTrades: 64, successfulWindows: 5, includeOptionalArtifacts: true });
  const result = runResearchWfaRunWorker({ rootDir, request: fakeWfaRequest({ run_id: "RUN-RESEARCH-GATE-OPTIMIZER-BAD-HASH", job_id: "JOB-RESEARCH-GATE-OPTIMIZER-BAD-HASH" }) });
  const hashMismatchedResult = cloneJson(result);

  for (const container of [hashMismatchedResult.artifacts_created, hashMismatchedResult.worker_result.artifacts]) {
    for (const artifact of container) {
      if (artifact.artifact_type === "wfa_optimizer_trials") artifact.sha256 = "0".repeat(64);
    }
  }

  const recorded = recordCandidateExecutionPromotionGate(paths, { runId: "RUN-RESEARCH-GATE-OPTIMIZER-BAD-HASH", executionResult: hashMismatchedResult });
  const report = recorded.research_gate_report.report;

  assert.equal(report.optimizer_trials.status, "optimizer_trial_artifacts_unreadable");
  assert.equal(report.optimizer_trials.denominator_available, false);
  assert.equal(report.optimizer_trials.rows_read, 0);
  assert.equal(report.optimizer_trials.artifacts[0].hash_verified, false);
  assert.match(report.optimizer_trials.artifacts[0].read_error, /sha256 mismatch/i);
  assert.equal(report.flags.includes("optimizer_trial_artifacts_unreadable"), true);
});

function fixtureDriftThresholds() {
  return Object.fromEntries(["lifecycle", "timing", "fill", "cost", "trade_count", "drawdown", "rule_accounting"].map((dimension) => [dimension, {
    value: dimension === "lifecycle" ? 0 : 0.01,
    metric: `${dimension}_drift`,
    units: "normalized",
    empirical_source: "factory/mt5/tester/JOB-FIXTURE/empirical-thresholds.json"
  }]));
}

test("parity reports require empirical drift thresholds and write to factory parity", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const report = buildParityReport({
    candidateId: "CAND-PARITY-001",
    runId: "RUN-PARITY-001",
    comparedArtifacts: [
      "factory/runs/JOB-RESEARCH-WFA-PARITY/execution-result.json",
      "factory/mt5/tester/JOB-MT5-PARITY/execution-result.json"
    ],
    driftThresholds: fixtureDriftThresholds(),
    driftObservations: {
      lifecycle: { observed: 0 },
      timing: { observed: 0.001 },
      fill: { observed: 0.002 },
      cost: { observed: 0.001 },
      trade_count: { observed: 0 },
      drawdown: { observed: 0.003 },
      rule_accounting: { observed: 0 }
    }
  });
  const written = writeParityReport(paths, report);

  assert.equal(report.decision, "pass");
  assert.equal(report.drift_classifications.length, 7);
  assert.doesNotThrow(() => validateParityReport(report));
  assert.equal(path.relative(rootDir, written.path).replace(/\\/g, "/"), "factory/parity/reports/CAND-PARITY-001/RUN-PARITY-001.json");
  assert.equal(fs.existsSync(written.path), true);
});

test("parity reports block when empirical threshold sources are missing", () => {
  const report = buildParityReport({
    candidateId: "CAND-PARITY-BLOCKED-001",
    runId: "RUN-PARITY-BLOCKED-001",
    comparedArtifacts: ["factory/runs/JOB-1/execution-result.json"],
    driftThresholds: {},
    driftObservations: {}
  });

  assert.equal(report.decision, "blocked");
  assert.throws(() => validateParityReport(report), /empirical threshold source/i);
});

test("candidate promotion gate rejects PaperTradingAdapter and WFA-only MT5 promotion", () => {
  const gate = buildCandidatePromotionGate({
    runId: "RUN-PROMOTION-GATE-001",
    candidateId: "CAND-PROMOTION-001",
    targetContext: "mt5_tester",
    adapterName: "PaperTradingAdapter",
    evidenceResults: [{
      status: "executed",
      evidence_kind: "research_wfa",
      artifacts_created: ["factory/runs/JOB-RESEARCH/execution-result.json"]
    }],
    evidencePaths: ["factory/candidates/CAND-PROMOTION-001/manifest.json"]
  });

  assert.equal(gate.decision, "denied");
  assert.equal(gate.stage, "mt5_tester_promotion");
  assert.match(gate.reason, /PaperTradingAdapter/i);
  assert.match(gate.reason, /WFA-only evidence/i);
  assert.doesNotThrow(() => validatePromotionGate(gate));
});

test("candidate promotion gate rejects parity reports without empirical thresholds", () => {
  const parityReport = buildParityReport({
    candidateId: "CAND-PROMOTION-PARITY-001",
    runId: "RUN-PROMOTION-PARITY-001",
    comparedArtifacts: ["factory/runs/JOB-RESEARCH/execution-result.json"],
    driftThresholds: {},
    driftObservations: {}
  });
  const gate = buildCandidatePromotionGate({
    runId: "RUN-PROMOTION-PARITY-GATE-001",
    candidateId: "CAND-PROMOTION-PARITY-001",
    targetContext: "parity",
    evidenceResults: [{ evidence_kind: "mt5_tester", artifacts_created: ["factory/mt5/tester/JOB-1/execution-result.json"] }],
    parityReport
  });

  assert.equal(gate.decision, "denied");
  assert.match(gate.reason, /empirical sources/i);
  assert.doesNotThrow(() => validatePromotionGate(gate));
});

test("candidate promotion gates and failed parity memory use designated folders", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const parityReport = buildParityReport({
    candidateId: "CAND-PARITY-MEMORY-001",
    runId: "RUN-PARITY-MEMORY-001",
    comparedArtifacts: ["factory/runs/JOB-RESEARCH/execution-result.json", "factory/mt5/tester/JOB-MT5/execution-result.json"],
    driftThresholds: fixtureDriftThresholds(),
    driftObservations: {
      lifecycle: { observed: 1 },
      timing: { observed: 0.001 },
      fill: { observed: 0.002 },
      cost: { observed: 0.001 },
      trade_count: { observed: 0 },
      drawdown: { observed: 0.003 },
      rule_accounting: { observed: 0 }
    }
  });
  const gate = buildCandidatePromotionGate({
    runId: "RUN-PARITY-MEMORY-GATE-001",
    candidateId: "CAND-PARITY-MEMORY-001",
    targetContext: "parity",
    evidenceResults: [{ evidence_kind: "mt5_tester", artifacts_created: ["factory/mt5/tester/JOB-MT5/execution-result.json"] }],
    parityReport
  });
  const gateWrite = writeCandidatePromotionGate(paths, gate);
  const record = buildFailedParityPatternRecord({ parityReport, gate });
  const memoryWrite = appendFailedParityPattern(paths, record);

  assert.equal(parityReport.decision, "fail");
  assert.equal(gate.decision, "denied");
  assert.equal(record.failure_family, "parity_drift");
  assert.deepEqual(record.failed_dimensions, ["lifecycle"]);
  assert.equal(path.relative(rootDir, gateWrite.path).replace(/\\/g, "/"), "factory/candidates/CAND-PARITY-MEMORY-001/gates/parity_promotion-RUN-PARITY-MEMORY-GATE-001.json");
  assert.equal(path.relative(rootDir, memoryWrite.path).replace(/\\/g, "/"), "factory/memory/failed-patterns.jsonl");
  assert.match(fs.readFileSync(memoryWrite.path, "utf8"), /parity_drift/);
});



test("candidate execution promotion gate helper writes research gate and manifest update", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const candidateId = "CAND-EXECUTION-GATE-001";
  const candidateDir = path.join(paths.factory, "candidates", candidateId);
  fs.mkdirSync(candidateDir, { recursive: true });
  fs.writeFileSync(path.join(candidateDir, "manifest.json"), JSON.stringify({
    schema_version: "candidate_manifest_v1",
    candidate_id: candidateId,
    status: "candidate_under_review",
    promotion_status: "not_requested"
  }, null, 2) + "\n", "utf8");
  const resultArtifact = path.join(rootDir, "walk forward engine", "strategies", "demo", "results", "analysis.json");
  fs.mkdirSync(path.dirname(resultArtifact), { recursive: true });
  fs.writeFileSync(resultArtifact, "{}\n", "utf8");
  const parsedMetricsPath = path.join(rootDir, "factory", "runs", "RUN-EXECUTION-GATE-001", "worker-results", "parsed-wfa-metrics.json");
  fs.mkdirSync(path.dirname(parsedMetricsPath), { recursive: true });
  fs.writeFileSync(parsedMetricsPath, JSON.stringify({
    metrics: { total_trades: 12, successful_windows: 3, total_windows: 3, aggregate_return_pct: -0.1 },
    per_window_metrics: [
      { window_id: 0, total_return_pct: 0.2, total_trades: 4, best_parameters: { lookback: 10 } },
      { window_id: 1, total_return_pct: -0.3, total_trades: 4, best_parameters: { lookback: 20 } },
      { window_id: 2, total_return_pct: 0.0, total_trades: 4, best_parameters: { lookback: 10 } }
    ]
  }, null, 2) + "\n", "utf8");

  const gateResult = recordCandidateExecutionPromotionGate(paths, {
    runId: "RUN-EXECUTION-GATE-001",
    executionResultPath: "factory/runs/RUN-EXECUTION-GATE-001/execution-result.json",
    executionResult: {
      experiment_id: "EXP-EXECUTION-GATE-001",
      status: "executed",
      evidence_kind: "research_wfa",
      authority_layer: "python_research",
      candidate_id: candidateId,
      artifacts_created: ["walk forward engine/strategies/demo/results/analysis.json"],
      metrics_observed: { sharpe_oos: -0.2, aggregate_return_pct: -0.1, profit_factor: 0.9, total_trades: 12, max_drawdown: -0.05 },
      provenance: {
        engine: "walk_forward_engine",
        command: "cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
        working_directory: "walk forward engine",
        config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
        result_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"],
        parsed_metrics_path: "factory/runs/RUN-EXECUTION-GATE-001/worker-results/parsed-wfa-metrics.json",
        windows_completed: 3
      }
    }
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(candidateDir, "manifest.json"), "utf8"));

  assert.equal(gateResult.gate.decision, "denied");
  assert.equal(gateResult.gate.target_context, "research");
  assert.equal(fs.existsSync(path.join(rootDir, gateResult.gate_path)), true);
  assert.equal(fs.existsSync(path.join(rootDir, gateResult.research_gate_report.path)), true);
  assert.equal(gateResult.research_gate_report.report.reporting_only, true);
  assert.equal(gateResult.research_gate_report.report.parameter_stability.status, "parameter_instability_flagged");
  assert.equal(manifest.status, "promotion_denied");
  assert.equal(manifest.promotion_status, "research_denied");
  assert.equal(manifest.latest_gate_decision.gate_path, gateResult.gate_path);
});

test("verification manifest and rollout gate writers emit machine-readable artifacts", () => {
  const rootDir = createTempRoot();
  const paths = {
    root: rootDir,
    runs: path.join(rootDir, "factory", "runs"),
    health: path.join(rootDir, "factory", "health.json"),
    verification: path.join(rootDir, "factory", "verification")
  };
  fs.mkdirSync(path.join(paths.runs, "RUN-1"), { recursive: true });
  fs.mkdirSync(paths.verification, { recursive: true });
  fs.writeFileSync(path.join(paths.runs, "RUN-1", "gate-results.json"), JSON.stringify({
    stages: [{ stage: "executor", decision: "allowed" }]
  }, null, 2));
  fs.writeFileSync(paths.health, JSON.stringify({
    false_pass_prevention: { denied_stage_gates: 0 },
    prompt_budget_breaches: { planner: 0, executor: 0, evaluator: 0, summarizer: 0, ideator: 0 },
    quarantined_run_count: 0,
    executor_completion_rate: { completion_rate: 1 },
    evidence_yield: { live_research_entries_total: 1 }
  }, null, 2));

  const manifest = buildVerificationManifest(paths);
  const rollout = buildRolloutGate(paths);
  const writtenManifest = writeVerificationManifest(paths, "20260403000000000");
  const writtenRollout = writeRolloutGate(paths, "20260403000000000");

  assert.equal(manifest.schema_version, "verification_manifest_v1");
  assert.equal(rollout.schema_version, "rollout_gate_v1");
  assert.equal(fs.existsSync(writtenManifest.path), true);
  assert.equal(fs.existsSync(writtenRollout.path), true);
});

test("rollout gate writer preserves explicit gate execution details", () => {
  const rootDir = createTempRoot();
  const paths = {
    root: rootDir,
    runs: path.join(rootDir, "factory", "runs"),
    health: path.join(rootDir, "factory", "health.json"),
    verification: path.join(rootDir, "factory", "verification")
  };
  fs.mkdirSync(paths.runs, { recursive: true });
  fs.mkdirSync(paths.verification, { recursive: true });
  fs.writeFileSync(paths.health, JSON.stringify({
    false_pass_prevention: { denied_stage_gates: 0 },
    prompt_budget_breaches: { planner: 0, executor: 0, evaluator: 0, summarizer: 0, ideator: 0 },
    quarantined_run_count: 0,
    executor_completion_rate: { completion_rate: 1 }
  }, null, 2));

  const rollout = buildRolloutGate(paths, {
    gate_id: "gate-0",
    gate_name: "source gate",
    gate_status: "passed",
    command_results: [{ label: "validate", command: "npm run validate", success: true, exit_code: 0, duration_ms: 100 }],
    acceptance_checks: { validate_green: true },
    evidence_paths: ["factory/health.json"],
    notes: ["Machine-written gate execution artifact."]
  });

  assert.equal(rollout.gate_id, "gate-0");
  assert.equal(rollout.gate_status, "passed");
  assert.deepEqual(rollout.acceptance_checks, { validate_green: true });
  assert.equal(rollout.command_results.length, 1);
});

test("finalizeRolloutGateExecution writes linked manifest and rollout artifacts", () => {
  const rootDir = createTempRoot();
  const paths = {
    root: rootDir,
    runs: path.join(rootDir, "factory", "runs"),
    health: path.join(rootDir, "factory", "health.json"),
    verification: path.join(rootDir, "factory", "verification"),
    backlog: path.join(rootDir, "factory", "backlog.json"),
    evidenceIndex: path.join(rootDir, "factory", "evidence", "index.json"),
    leaderboard: path.join(rootDir, "factory", "leaderboard.json"),
    lessons: path.join(rootDir, "factory", "memory", "lessons.jsonl"),
    retrievalIndex: path.join(rootDir, "factory", "memory", "retrieval_index.json"),
    memoryQuarantine: path.join(rootDir, "factory", "memory", "quarantine"),
    recoveryLog: path.join(rootDir, "factory", "runtime", "recovery-log.jsonl"),
    marketPolicy: path.join(rootDir, "factory", "market-policy.json"),
    experiments: path.join(rootDir, "factory", "experiments")
  };
  fs.mkdirSync(paths.runs, { recursive: true });
  fs.mkdirSync(paths.verification, { recursive: true });
  fs.mkdirSync(path.dirname(paths.evidenceIndex), { recursive: true });
  fs.mkdirSync(path.dirname(paths.lessons), { recursive: true });
  fs.mkdirSync(path.dirname(paths.recoveryLog), { recursive: true });
  fs.mkdirSync(paths.memoryQuarantine, { recursive: true });
  fs.writeFileSync(paths.evidenceIndex, "[]\n", "utf8");
  fs.writeFileSync(paths.backlog, "[]\n", "utf8");
  fs.writeFileSync(paths.leaderboard, "[]\n", "utf8");
  fs.writeFileSync(paths.lessons, "", "utf8");
  fs.writeFileSync(paths.retrievalIndex, "[]\n", "utf8");
  fs.writeFileSync(paths.marketPolicy, JSON.stringify({ market_family_priorities: [] }, null, 2));
  fs.writeFileSync(paths.health, JSON.stringify({
    prompt_budget_breaches: { planner: 0, executor: 0, evaluator: 0, summarizer: 0, ideator: 0 },
    quarantined_run_count: 0,
    false_pass_prevention: { denied_stage_gates: 0 },
    executor_completion_rate: { completion_rate: 1 }
  }, null, 2));

  const finalized = finalizeRolloutGateExecution(paths, {
    gate_id: "gate-2",
    gate_name: "failure-injection gate",
    gate_status: "passed",
    evidence_paths: ["factory/health.json"]
  }, "20260403000000002");

  assert.equal(fs.existsSync(finalized.manifestPath), true);
  assert.equal(fs.existsSync(finalized.rolloutPath), true);
  assert.equal(finalized.rolloutPayload.verification_manifest_path, "factory/verification/verification-manifest-20260403000000002.json");
});

test("validateStructure can refresh verification artifacts on a healthy repo root", () => {
  const rootDir = createTempRoot();
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "tmp" }, null, 2));
  fs.writeFileSync(path.join(rootDir, "opencode.json"), JSON.stringify({ provider: {} }, null, 2));
  fs.writeFileSync(path.join(rootDir, "AGENTS.md"), "# temp\n", "utf8");
  fs.writeFileSync(path.join(rootDir, "src", "cli.mjs"), "", "utf8");
  fs.mkdirSync(path.join(rootDir, "factory", "evidence"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "factory", "verification"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "factory", "memory"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "workspace", "harness"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "workspace", "strategies"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "workspace", "data", "fetchers"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "factory", "state.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(rootDir, "factory", "backlog.json"), "[]\n", "utf8");
  fs.writeFileSync(path.join(rootDir, "factory", "leaderboard.json"), "[]\n", "utf8");
  fs.writeFileSync(path.join(rootDir, "factory", "evidence", "index.json"), "[]\n", { encoding: "utf8", flag: "w" });
  fs.writeFileSync(path.join(rootDir, "factory", "memory", "lessons.jsonl"), "", "utf8");

  const structure = validateStructure(rootDir);
  const refreshed = refreshVerificationArtifacts(rootDir);

  assert.equal(structure.ok, true);
  assert.match(refreshed.verification_manifest, /^factory\/verification\/verification-manifest-/);
  assert.match(refreshed.rollout_gate, /^factory\/verification\/rollout-gate-/);
});

test("fault drills write a machine-readable artifact with only safe outcomes", async () => {
  const rootDir = createTempRoot();
  const paths = {
    root: rootDir,
    runs: path.join(rootDir, "factory", "runs"),
    health: path.join(rootDir, "factory", "health.json"),
    verification: path.join(rootDir, "factory", "verification")
  };
  fs.mkdirSync(paths.runs, { recursive: true });
  fs.mkdirSync(paths.verification, { recursive: true });
  fs.writeFileSync(paths.health, JSON.stringify({}, null, 2));

  const drillRun = await runFaultDrills(paths, "20260403000000001");
  assert.equal(fs.existsSync(drillRun.path), true);
  assert.equal(drillRun.payload.schema_version, "fault_drills_v1");
  assert.equal(drillRun.payload.drills.length >= 8, true);
  assert.equal(drillRun.payload.drills.every((item) => ["safe_recovery", "explicit_rejection"].includes(item.outcome)), true);
});

test("normalizeGateArg accepts rollout gate aliases", () => {
  assert.equal(normalizeGateArg("0"), "gate-0");
  assert.equal(normalizeGateArg("simulate"), "gate-1");
  assert.equal(normalizeGateArg("failure-injection"), "gate-2");
  assert.equal(normalizeGateArg("controlled-live"), "gate-3");
  assert.equal(normalizeGateArg("bounded-live"), "gate-4");
  assert.equal(normalizeGateArg("unknown"), null);
});

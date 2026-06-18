import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeProject } from "../src/core/init.mjs";
import { validateExecutionResult } from "../src/core/validators.mjs";
import { runResearchWfaRunWorker } from "../src/workers/research-wfa-run-worker.mjs";

function tempRoot() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wfa-metric-readiness-")), "trading-research-factory");
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

function writeRoute(rootDir, { strategyName = "metric_ready", result }) {
  const wfaRoot = path.join(rootDir, "walk forward engine");
  fs.mkdirSync(path.join(wfaRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "strategies", strategyName, "results"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "src", "strategies"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(wfaRoot, "strategies", strategyName, "wfa_config.yaml"), canonicalYaml(strategyName), "utf8");
  fs.writeFileSync(path.join(wfaRoot, "src", "strategies", `${strategyName}.py`), "class MetricReadyStrategy:\n    pass\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "config", `strategy_${strategyName}.json`), `{"profile_key":"${strategyName.toUpperCase()}"}\n`, "utf8");
  fs.writeFileSync(path.join(wfaRoot, "data", `${strategyName}.csv`), "timestamp,open,high,low,close,volume\n2026-01-01,1,1,1,1,1\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "scripts", "walk_forward_smoke_test.py"), `const fs = require('fs');
const path = require('path');
const out = path.join(process.cwd(), 'strategies', '${strategyName}', 'results');
fs.mkdirSync(out, { recursive: true });
const result = ${JSON.stringify(result, null, 2)};
fs.writeFileSync(path.join(out, 'walk_forward_results_20260524_000000.json'), JSON.stringify(result, null, 2) + '\\n');
`, "utf8");
}

function request(strategyName = "metric_ready") {
  return {
    schema_version: "research_wfa_run_request_v1",
    run_id: `RUN-WFA-METRIC-READINESS-${strategyName.toUpperCase()}`,
    job_id: `JOB-WFA-METRIC-READINESS-${strategyName.toUpperCase()}`,
    candidate_id: `CAND-WFA-METRIC-READINESS-${strategyName.toUpperCase()}`,
    lineage_id: "LINEAGE-WFA-METRIC-READINESS",
    family_id: "FAMILY-WFA-METRIC-READINESS",
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
    environment_allowlist: ["PATH"]
  };
}

function baseResult(overrides = {}) {
  return {
    successful_windows: 3,
    total_windows: 4,
    aggregate_sharpe_ratio: 0.4,
    aggregate_in_sample_sharpe: 0.8,
    aggregate_total_trades: 12,
    aggregate_max_drawdown_pct: -0.02,
    aggregate_return_pct: 2.5,
    aggregate_in_sample_return_pct: 10,
    window_results: [
      { window_id: 0, success: true, total_return_pct: 0.5, in_sample_return_pct: 3, total_trades: 4, sharpe_ratio: 0.3, max_drawdown_pct: -0.01 },
      { window_id: 1, success: true, total_return_pct: 0.8, in_sample_return_pct: 4, total_trades: 4, sharpe_ratio: 0.5, max_drawdown_pct: -0.02 },
      { window_id: 2, success: true, total_return_pct: 1.2, in_sample_return_pct: 3, total_trades: 4, sharpe_ratio: 0.4, max_drawdown_pct: -0.01 }
    ],
    ...overrides
  };
}

test("worker computes WFE and WFR only from artifact-backed accepted WFA metrics", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { result: baseResult() });

  const result = runResearchWfaRunWorker({ rootDir, request: request() });
  const readiness = result.observations.metric_readiness;

  assert.equal(result.status, "executed");
  assert.equal(readiness.wfe.status, "computed_artifact_backed");
  assert.equal(readiness.wfe.value, 0.25);
  assert.equal(readiness.wfr.status, "computed_artifact_backed");
  assert.equal(readiness.wfr.value, 0.75);
  for (const input of Object.values(readiness.wfe.inputs)) {
    assert.equal(input.available, true);
    assert.match(input.source.source_path, /walk_forward_results_20260524_000000\.json$/);
    assert.match(input.source.source_sha256, /^[a-f0-9]{64}$/);
  }
  for (const input of Object.values(readiness.wfr.inputs)) {
    assert.equal(input.available, true);
    assert.match(input.source.source_path, /walk_forward_results_20260524_000000\.json$/);
    assert.match(input.source.source_sha256, /^[a-f0-9]{64}$/);
  }
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("worker blocks WFE when artifact-backed in-sample return is zero", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, { strategyName: "zero_is", result: baseResult({ aggregate_in_sample_return_pct: 0 }) });

  const result = runResearchWfaRunWorker({ rootDir, request: request("zero_is") });
  const readiness = result.observations.metric_readiness;

  assert.equal(result.status, "executed");
  assert.equal(readiness.wfe.status, "blocked_missing_inputs");
  assert.equal(readiness.wfe.value, null);
  assert.deepEqual(readiness.wfe.missing_inputs, ["nonzero aggregate in-sample return"]);
  assert.match(readiness.wfe.missing_because, /nonzero aggregate in-sample return/i);
  assert.equal(readiness.wfr.status, "computed_artifact_backed");
  assert.equal(readiness.wfr.value, 0.75);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("worker blocks accepted metrics when optimization truth contradicts disconnected module status", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, {
    strategyName: "bad_truth",
    result: baseResult({
      optimization_truth: {
        active_parameter_optimizer: "direct_optuna_tpe_study",
        active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
        multi_objective_optimizer_active: true,
        transaction_cost_modeler_active: false,
        cost_stress_tester_active: false,
        active_cost_inputs: { fees: 0.0001, slippage: 0.0001 },
        disconnected_modules: [
          "src/walk_forward/multi_objective_optimizer.py",
          "src/walk_forward/transaction_cost_modeler.py",
          "src/walk_forward/cost_stress_tester.py"
        ]
      }
    })
  });

  const result = runResearchWfaRunWorker({ rootDir, request: request("bad_truth") });

  assert.equal(result.status, "blocked");
  assert.match(result.blocked_reason, /optimization_truth diagnostics contradict/i);
  assert.equal(result.observations.optimization_truth.status, "invalid_artifact_backed");
  assert.match(result.observations.optimization_truth.errors.join("; "), /multi_objective_optimizer_active must be false/i);
});

test("worker reports parameter stability and warmup as diagnostics only", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, {
    strategyName: "stability_diag",
    result: baseResult({
      warmup_diagnostics: {
        status: "diagnostic_only",
        indicator_warmup_bars: 25,
        applied_to_window_boundaries: false
      },
      window_results: [
        { window_id: 0, success: true, total_return_pct: 0.5, in_sample_return_pct: 3, total_trades: 4, sharpe_ratio: 0.3, max_drawdown_pct: -0.01, best_parameters: { lookback: 20, threshold: 1.2 } },
        { window_id: 1, success: true, total_return_pct: 0.8, in_sample_return_pct: 4, total_trades: 4, sharpe_ratio: 0.5, max_drawdown_pct: -0.02, best_parameters: { lookback: 30, threshold: 1.2 } },
        { window_id: 2, success: true, total_return_pct: 1.2, in_sample_return_pct: 3, total_trades: 4, sharpe_ratio: 0.4, max_drawdown_pct: -0.01, best_parameters: { lookback: 30, threshold: 1.4 } }
      ]
    })
  });

  const result = runResearchWfaRunWorker({ rootDir, request: request("stability_diag") });

  assert.equal(result.status, "executed");
  assert.equal(result.observations.parameter_stability.status, "parameter_instability_flagged");
  assert.equal(result.observations.parameter_stability.unique_parameter_sets, 3);
  assert.match(result.observations.parameter_stability.source.source_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.observations.warmup_diagnostics.status, "diagnostic_only_not_applied");
  assert.equal(result.observations.warmup_diagnostics.diagnostics.indicator_warmup_bars, 25);
  assert.equal(result.observations.warmup_diagnostics.diagnostics.applied_to_window_boundaries, false);
  assert.match(result.observations.warmup_diagnostics.note, /does not apply generic indicator warmup/i);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("worker blocks warmup diagnostics that claim boundary application", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, {
    strategyName: "bad_warmup",
    result: baseResult({
      warmup_diagnostics: {
        status: "applied",
        indicator_warmup_bars: 25,
        applied_to_window_boundaries: true
      }
    })
  });

  const result = runResearchWfaRunWorker({ rootDir, request: request("bad_warmup") });

  assert.equal(result.status, "blocked");
  assert.match(result.blocked_reason, /warmup_diagnostics contradict Phase 8C diagnostic-only/i);
  assert.equal(result.observations.warmup_diagnostics.status, "invalid_artifact_backed");
  assert.match(result.observations.warmup_diagnostics.errors.join("; "), /must not claim application/i);
});

test("worker blocks malformed per-window best parameter artifacts", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRoute(rootDir, {
    strategyName: "bad_params",
    result: baseResult({
      window_results: [
        { window_id: 0, success: true, total_return_pct: 0.5, in_sample_return_pct: 3, total_trades: 4, sharpe_ratio: 0.3, max_drawdown_pct: -0.01, best_parameters: { lookback: 20 } },
        { window_id: 1, success: true, total_return_pct: 0.8, in_sample_return_pct: 4, total_trades: 4, sharpe_ratio: 0.5, max_drawdown_pct: -0.02, best_parameters: ["lookback", 30] },
        { window_id: 2, success: true, total_return_pct: 1.2, in_sample_return_pct: 3, total_trades: 4, sharpe_ratio: 0.4, max_drawdown_pct: -0.01, best_parameters: { lookback: 30 } }
      ]
    })
  });

  const result = runResearchWfaRunWorker({ rootDir, request: request("bad_params") });

  assert.equal(result.status, "blocked");
  assert.match(result.blocked_reason, /malformed accepted parameter artifacts/i);
  assert.equal(result.observations.parameter_stability.status, "invalid_artifact_backed");
  assert.equal(result.observations.parameter_stability.malformed_parameter_windows, 1);
  assert.match(result.observations.parameter_stability.missing_because, /expected JSON objects only/i);
});

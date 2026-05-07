import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { validateExecutionArtifacts, validateExecutionResult, validateEvaluationResult, validateParityReport, validatePlannerResult, validatePromotionGate, validateSummaryResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";
import { appendFailedParityPattern, buildCandidatePromotionGate, buildFailedParityPatternRecord, buildParityReport, buildResearchWfaPromotionGate, buildRolloutGate, buildStageGateResult, buildVerificationManifest, finalizeRolloutGateExecution, recordCandidateExecutionPromotionGate, runFaultDrills, writeCandidatePromotionGate, writeParityReport, writeRolloutGate, writeVerificationManifest } from "../src/core/verification.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { runMt5FileCommonSmokeWorker, validateFileCommonMessage } from "../src/workers/mt5-file-common-smoke-worker.mjs";
import { runMt5SnapshotWorker } from "../src/workers/mt5-snapshot-worker.mjs";
import { runMt5TesterLifecycleWorker } from "../src/workers/mt5-tester-lifecycle-worker.mjs";
import { runFtmoLedgerWorker } from "../src/workers/ftmo-ledger-worker.mjs";
import { runResearchWfaEnvelopeWorker } from "../src/workers/research-wfa-envelope-worker.mjs";
import { runCandidatePromotionGate } from "../scripts/run-candidate-promotion-gate.mjs";
import { extractMt5ReportLedger } from "../scripts/extract-mt5-report-ledger.mjs";
import { normalizeGateArg } from "../scripts/run-rollout-gate.mjs";
import { refreshVerificationArtifacts, validateStructure } from "../scripts/validate-structure.mjs";

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verification-"));
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
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

test("execution validation rejects executed results without canonical provenance", () => {
  assert.throws(
    () => validateExecutionResult({
      experiment_id: "EXP-1",
      status: "executed",
      artifacts_created: ["workspace/results/report.json"],
      metrics_observed: { sharpe_oos: 1.2, total_trades: 50 }
    }),
    /canonical execution provenance/i
  );
});

test("execution validation rejects non-canonical WFA provenance", () => {
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
    /walk_forward_engine|canonical WFA command|canonical WFA working directory|canonical WFA config path|walk-forward window/i
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

test("canonical executed result passes validation with real-looking provenance fields", () => {
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

  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
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
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "research_wfa" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
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
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
});

test("research WFA validation rejects mismatched candidate ids", () => {
  const rootDir = createTempRoot();
  const configPath = path.join(rootDir, "walk forward engine", "strategies", "demo", "wfa_config.yaml");
  const resultPath = path.join(rootDir, "walk forward engine", "strategies", "demo", "results", "walk_forward_results.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(configPath, "strategy: demo\n", "utf8");
  fs.writeFileSync(resultPath, JSON.stringify({ aggregate_sharpe_ratio: 1.1 }, null, 2) + "\n", "utf8");

  const result = runResearchWfaEnvelopeWorker({
    rootDir,
    runId: "RUN-RESEARCH-WFA-CANDIDATE-MISMATCH",
    jobId: "JOB-RESEARCH-WFA-CANDIDATE-MISMATCH",
    candidateId: "CAND-DEMO-WFA-001",
    observedAt: "2026-05-02T00:00:00.000Z",
    configPath: "walk forward engine/strategies/demo/wfa_config.yaml",
    resultArtifacts: ["walk forward engine/strategies/demo/results/walk_forward_results.json"],
    metricsObserved: { sharpe_oos: 1.1, total_trades: 77, max_drawdown: -0.05 },
    windowsCompleted: 6
  });
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

test("mt5 snapshot worker writes blocked disk-backed evidence for missing explicit inputs", () => {
  const rootDir = createTempRoot();
  const result = runMt5SnapshotWorker({
    rootDir,
    runId: "RUN-MT5-SNAPSHOT-BLOCKED",
    jobId: "JOB-MT5-SNAPSHOT-BLOCKED",
    experimentId: "EXP-MT5-SNAPSHOT-BLOCKED",
    observedAt: "2026-04-30T00:00:00.000Z"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.evidence_kind, "mt5_snapshot");
  assert.equal(result.worker_result.status, "blocked");
  assert.match(result.blocked_reason, /explicit input fields: symbol, timeframe/i);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { evidenceKind: "mt5_snapshot" }));
  assert.doesNotThrow(() => validateExecutionResult(result));

  for (const artifact of result.worker_result.artifacts) {
    assert.equal(artifact.path.startsWith("factory/mt5/environment/JOB-MT5-SNAPSHOT-BLOCKED/"), true);
    assert.equal(fs.existsSync(path.join(rootDir, artifact.path)), true);
    assert.equal(sha256Text(fs.readFileSync(path.join(rootDir, artifact.path), "utf8")), artifact.sha256);
  }
});

test("mt5 snapshot worker accepts deterministic probe observations and validates artifacts", () => {
  const rootDir = createTempRoot();
  const result = runMt5SnapshotWorker({
    rootDir,
    runId: "RUN-MT5-SNAPSHOT-SUCCEEDED",
    jobId: "JOB-MT5-SNAPSHOT-SUCCEEDED",
    experimentId: "EXP-MT5-SNAPSHOT-SUCCEEDED",
    symbol: "EURUSD",
    timeframe: "M15",
    bars: 32,
    observedAt: "2026-04-30T00:00:00.000Z",
    probeResultOverride: {
      schema_version: "mt5_snapshot_probe_v1",
      status: "succeeded",
      blocked_reason: null,
      diagnostics: { error_code: null, message: null },
      observations: {
        terminal: { name: "MetaTrader 5", build: 4150, connected: true },
        account: { login: 123456, server: "FTMO-Demo", currency: "USD", leverage: 100, trade_mode: 0, margin_mode: 2 },
        symbol: { name: "EURUSD", digits: 5, trade_contract_size: 100000, volume_min: 0.01, volume_step: 0.01 },
        data_identity: {
          provider: "MetaTrader5 terminal",
          source_type: "mt5_terminal_rates",
          symbol: "EURUSD",
          timeframe: "M15",
          returned_bars: 32,
          coverage_start_utc: "2026-04-29T16:00:00+00:00",
          coverage_end_utc: "2026-04-30T00:00:00+00:00",
          bars_sha256: "1".repeat(64)
        }
      }
    }
  });

  assert.equal(result.status, "executed");
  assert.equal(result.worker_result.status, "succeeded");
  assert.equal(result.worker_result.authority_layer, "mt5_terminal");
  assert.match(result.observations.snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "mt5_snapshot" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));

  const snapshotArtifact = result.worker_result.artifacts.find((artifact) => artifact.artifact_type === "environment_identity");
  assert.equal(snapshotArtifact.path, "factory/mt5/environment/JOB-MT5-SNAPSHOT-SUCCEEDED/snapshot.json");
  assert.equal(result.observations.snapshot_sha256, snapshotArtifact.sha256);
});

test("mt5 snapshot worker records only redacted password env metadata", () => {
  const previousPassword = process.env.TRF_MT5_PASSWORD;
  process.env.TRF_MT5_PASSWORD = "dummy-secret-that-must-not-persist";
  try {
    const rootDir = createTempRoot();
    const result = runMt5SnapshotWorker({
      rootDir,
      runId: "RUN-MT5-SNAPSHOT-REDACTED",
      jobId: "JOB-MT5-SNAPSHOT-REDACTED",
      experimentId: "EXP-MT5-SNAPSHOT-REDACTED",
      symbol: "EURUSD",
      timeframe: "M15",
      bars: 32,
      observedAt: "2026-04-30T00:00:00.000Z",
      probeResultOverride: {
        schema_version: "mt5_snapshot_probe_v1",
        status: "blocked",
        blocked_reason: "fixture blocked",
        diagnostics: { error_code: "fixture_blocked", message: "fixture blocked" },
        observations: {}
      }
    });

    const environmentDir = path.join(rootDir, "factory/mt5/environment/JOB-MT5-SNAPSHOT-REDACTED");
    const persisted = ["request.json", "blocked-snapshot.json", "worker-result.json", "execution-result.json", "probe.stdout.txt", "probe.stderr.txt"]
      .map((fileName) => fs.readFileSync(path.join(environmentDir, fileName), "utf8"))
      .join("\n");
    assert.equal(result.status, "blocked");
    assert.match(persisted, /"password_env_provided": true/);
    assert.doesNotMatch(persisted, /dummy-secret-that-must-not-persist/);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.TRF_MT5_PASSWORD;
    } else {
      process.env.TRF_MT5_PASSWORD = previousPassword;
    }
  }
});

test("mt5 FILE_COMMON smoke worker validates protocol and deterministic rejections", () => {
  const rootDir = createTempRoot();
  const result = runMt5FileCommonSmokeWorker({
    rootDir,
    runId: "RUN-MT5-BRIDGE-SMOKE-1",
    jobId: "JOB-MT5-BRIDGE-SMOKE-1",
    experimentId: "EXP-MT5-BRIDGE-SMOKE-1",
    observedAt: "2026-04-30T00:00:00.000Z"
  });

  assert.equal(result.status, "executed");
  assert.equal(result.evidence_kind, "mt5_bridge_smoke");
  assert.equal(result.authority_layer, "control_plane");
  assert.equal(result.worker_result.status, "succeeded");
  assert.equal(result.observations.protocol.file_common_required, true);
  assert.equal(result.observations.protocol.network_calls_required, false);
  assert.equal(result.observations.protocol.manual_copy_required, false);
  assert.equal(result.observations.accepted_message.accepted, true);
  assert.equal(result.observations.rejection_tests.wrong_run.rejected, true);
  assert.equal(result.observations.rejection_tests.stale_message.rejected, true);
  assert.equal(result.observations.rejection_tests.corrupted_payload.rejected, true);
  assert.equal(result.observations.rejection_tests.partial_write.rejected, true);
  assert.equal(result.observations.tester_lifecycle_executed, false);

  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "mt5_bridge_smoke" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));

  const accepted = validateFileCommonMessage({
    rootDir,
    messagePath: result.observations.accepted_message.path,
    expectedRunId: "RUN-MT5-BRIDGE-SMOKE-1",
    now: new Date("2026-04-30T00:00:00.000Z")
  });
  assert.equal(accepted.accepted, true);

  for (const artifact of result.worker_result.artifacts) {
    assert.equal(fs.existsSync(path.join(rootDir, artifact.path)), true);
    assert.equal(sha256Text(fs.readFileSync(path.join(rootDir, artifact.path), "utf8")), artifact.sha256);
  }
});

test("mt5 tester lifecycle worker blocks without repo-contained tester output", () => {
  const rootDir = createTempRoot();
  const result = runMt5TesterLifecycleWorker({
    rootDir,
    runId: "RUN-MT5-TESTER-BLOCKED",
    jobId: "JOB-MT5-TESTER-BLOCKED",
    experimentId: "EXP-MT5-TESTER-BLOCKED",
    observedAt: "2026-04-30T00:00:00.000Z",
    symbol: "EURUSD",
    timeframe: "M15"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.evidence_kind, "mt5_tester");
  assert.equal(result.worker_result.status, "blocked");
  assert.match(result.blocked_reason, /tester lifecycle output is missing/i);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { evidenceKind: "mt5_tester" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  for (const artifact of result.worker_result.artifacts) {
    assert.equal(fs.existsSync(path.join(rootDir, artifact.path)), true);
  }
});

test("mt5 tester lifecycle worker accepts complete repo-contained lifecycle output", () => {
  const rootDir = createTempRoot();
  const fixtureDir = path.join(rootDir, "factory", "mt5", "tester", "fixture-input");
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, "tester-output.json");
  const fixture = {
    schema_version: "mt5_tester_lifecycle_output_v1",
    tester_settings: {
      terminal_build: 4150,
      symbol: "EURUSD",
      timeframe: "M15",
      tick_model: "Every tick based on real ticks",
      spread_source: "tester fixture",
      commission_model: "fixture commission",
      swap_model: "fixture swap",
      execution_delay: "0ms fixture",
      deposit_currency: "USD",
      settings_sha256: "2".repeat(64)
    },
    lifecycle_summary: {
      market_order: { observed: true, opened: true, closed: true, deals: 2 },
      pending_order: { observed: true, placed: true, triggered: true, closed: true, deals: 2 },
      exit_order: { observed: true, sl_or_tp_seen: true, hard_exit_seen: false, deals: 1 }
    },
    limitations: {
      tester_conditioned: true,
      not_forward_evidence: true,
      fixture_output: true
    },
    logs: ["market order lifecycle observed", "pending order lifecycle observed", "exit order lifecycle observed"]
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n", "utf8");

  const result = runMt5TesterLifecycleWorker({
    rootDir,
    runId: "RUN-MT5-TESTER-SUCCEEDED",
    jobId: "JOB-MT5-TESTER-SUCCEEDED",
    experimentId: "EXP-MT5-TESTER-SUCCEEDED",
    observedAt: "2026-04-30T00:00:00.000Z",
    testerOutputPath: "factory/mt5/tester/fixture-input/tester-output.json"
  });

  assert.equal(result.status, "executed");
  assert.equal(result.worker_result.status, "succeeded");
  assert.equal(result.authority_layer, "mt5_tester");
  assert.equal(result.observations.lifecycle_summary.market_order.observed, true);
  assert.equal(result.observations.lifecycle_summary.pending_order.observed, true);
  assert.equal(result.observations.lifecycle_summary.exit_order.observed, true);
  assert.equal(result.observations.limitations.not_forward_evidence, true);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "mt5_tester" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
});

test("FTMO ledger worker blocks without explicit repo-contained inputs", () => {
  const rootDir = createTempRoot();
  const result = runFtmoLedgerWorker({
    rootDir,
    runId: "RUN-FTMO-LEDGER-BLOCKED",
    jobId: "JOB-FTMO-LEDGER-BLOCKED",
    experimentId: "EXP-FTMO-LEDGER-BLOCKED",
    observedAt: "2026-04-30T00:00:00.000Z"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.evidence_kind, "ftmo_ledger");
  assert.equal(result.worker_result.status, "blocked");
  assert.match(result.blocked_reason, /rule set missing/i);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { evidenceKind: "ftmo_ledger" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("FTMO ledger worker computes fixture ledger mechanics without forward survival claim", () => {
  const rootDir = createTempRoot();
  const ruleSet = {
    schema_version: "ftmo_rule_set_v1",
    ftmo_target: "1-step",
    rule_set_version: "fixture-mechanics-v1",
    source_date: "2026-04-30",
    source_url: "repo-fixture-not-official-ftmo-rules",
    reset_timezone: "Europe/Prague",
    daily_loss_limit: { type: "amount", value: 5000 },
    max_loss_limit: { type: "amount", value: 10000 },
    include_floating_pnl: true,
    include_commission_swap: true
  };
  const ledger = {
    schema_version: "ftmo_ledger_input_v1",
    fixture_ledger: true,
    account: { currency: "USD", starting_balance: 100000 },
    events: [
      { timestamp: "2026-04-30T08:00:00.000Z", realized_pnl: -1000, floating_pnl: -500, commission: -20, swap: 0 },
      { timestamp: "2026-04-30T10:00:00.000Z", realized_pnl: 200, floating_pnl: 0, commission: -10, swap: -2 },
      { timestamp: "2026-05-01T08:00:00.000Z", realized_pnl: -2000, floating_pnl: -100, commission: -20, swap: 0 }
    ]
  };
  const result = runFtmoLedgerWorker({
    rootDir,
    runId: "RUN-FTMO-LEDGER-SUCCEEDED",
    jobId: "JOB-FTMO-LEDGER-SUCCEEDED",
    experimentId: "EXP-FTMO-LEDGER-SUCCEEDED",
    observedAt: "2026-04-30T00:00:00.000Z",
    ruleSetOverride: ruleSet,
    ledgerOverride: ledger
  });

  assert.equal(result.status, "executed");
  assert.equal(result.worker_result.status, "succeeded");
  assert.equal(result.authority_layer, "control_plane");
  assert.equal(result.observations.rule_set.ftmo_target, "1-step");
  assert.equal(result.observations.proof_scope, "ledger_mechanics_only");
  assert.equal(result.observations.forward_demo_survival_claim, false);
  assert.equal(result.observations.floating_equity_evidence.available, false);
  assert.equal(result.observations.floating_equity_evidence.closed_deal_only, true);
  assert.equal(result.observations.fixture_ledger, true);
  assert.equal(result.observations.ledger_summary.breached, false);
  assert.equal(result.observations.ledger_summary.daily_loss_limit, 5000);
  assert.equal(result.observations.ledger_summary.max_loss_limit, 10000);
  assert.match(result.observations.ledger_summary.timeline_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "ftmo_ledger" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
});

test("FTMO ledger worker blocks forward survival claims without equity time series", () => {
  const rootDir = createTempRoot();
  const ruleSet = {
    schema_version: "ftmo_rule_set_v1",
    ftmo_target: "2-step",
    rule_set_version: "fixture-forward-guard-v1",
    source_date: "2026-05-04",
    source_url: "repo-fixture-forward-guard",
    reset_timezone: "Europe/Prague",
    daily_loss_limit: { type: "amount", value: 5000 },
    max_loss_limit: { type: "amount", value: 10000 },
    include_floating_pnl: true,
    include_commission_swap: true
  };
  const ledger = {
    schema_version: "ftmo_ledger_input_v1",
    forward_demo_survival_claim: true,
    account: { currency: "USD", starting_balance: 100000 },
    events: [
      { timestamp: "2026-04-30T08:00:00.000Z", realized_pnl: 100, floating_pnl: 0, commission: 0, swap: 0 }
    ]
  };

  const result = runFtmoLedgerWorker({
    rootDir,
    runId: "RUN-FTMO-LEDGER-FORWARD-GUARD",
    jobId: "JOB-FTMO-LEDGER-FORWARD-GUARD",
    experimentId: "EXP-FTMO-LEDGER-FORWARD-GUARD",
    observedAt: "2026-05-04T00:00:00.000Z",
    ruleSetOverride: ruleSet,
    ledgerOverride: ledger
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blocked_reason, /equity_time_series/i);
  assert.doesNotThrow(() => validateExecutionResult(result));
});

test("FTMO ledger worker models 1-Step end-of-day trailing max loss", () => {
  const rootDir = createTempRoot();
  const ruleSet = {
    schema_version: "ftmo_rule_set_v1",
    ftmo_target: "1-step",
    rule_set_version: "fixture-1-step-trailing-v1",
    source_date: "2026-05-03",
    source_url: "repo-fixture-official-logic-extract",
    reset_timezone: "Europe/Prague",
    daily_loss_limit: { type: "percent_of_starting_balance", value: 0.03 },
    max_loss_limit: { type: "percent_of_starting_balance", value: 0.10, model: "end_of_day_trailing" },
    include_floating_pnl: true,
    include_commission_swap: true
  };
  const ledger = {
    schema_version: "ftmo_ledger_input_v1",
    fixture_ledger: true,
    account: { currency: "USD", starting_balance: 100000 },
    events: [
      { timestamp: "2026-04-30T08:00:00.000Z", realized_pnl: 4000, floating_pnl: 0, commission: 0, swap: 0 },
      { timestamp: "2026-05-01T08:00:00.000Z", realized_pnl: -500, floating_pnl: 0, commission: 0, swap: 0 },
      { timestamp: "2026-05-02T08:00:00.000Z", realized_pnl: -200, floating_pnl: 0, commission: 0, swap: 0 }
    ]
  };

  const result = runFtmoLedgerWorker({
    rootDir,
    runId: "RUN-FTMO-LEDGER-1STEP-TRAILING",
    jobId: "JOB-FTMO-LEDGER-1STEP-TRAILING",
    experimentId: "EXP-FTMO-LEDGER-1STEP-TRAILING",
    observedAt: "2026-05-03T00:00:00.000Z",
    ruleSetOverride: ruleSet,
    ledgerOverride: ledger
  });

  assert.equal(result.status, "executed");
  assert.equal(result.observations.ledger_summary.max_loss_model, "end_of_day_trailing");
  assert.equal(result.observations.ledger_summary.days[0].max_loss_limit_level, 90000);
  assert.equal(result.observations.ledger_summary.days[1].max_loss_limit_level, 94000);
  assert.equal(result.observations.ledger_summary.days[2].max_loss_limit_level, 94000);
  assert.equal(result.observations.ledger_summary.trailing_high_watermark_balance, 104000);
  assert.equal(result.observations.ledger_summary.breached, false);
  assert.doesNotThrow(() => validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "ftmo_ledger" }));
  assert.doesNotThrow(() => validateExecutionResult(result));
  assert.doesNotThrow(() => validateExecutionArtifacts(rootDir, result));
});

test("MT5 tester report extractor emits non-fixture FTMO ledger input", () => {
  const rootDir = createTempRoot();
  const reportPath = path.join(rootDir, "factory", "mt5", "tester", "JOB-R", "report.htm");
  const lifecyclePath = path.join(rootDir, "factory", "mt5", "tester", "JOB-R", "lifecycle.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const html = `
    <table>
      <tr><th><b>Deals</b></th></tr>
      <tr><td>Time</td><td>Deal</td><td>Symbol</td><td>Type</td><td>Direction</td><td>Volume</td><td>Price</td><td>Order</td><td>Commission</td><td>Swap</td><td>Profit</td><td>Balance</td><td>Comment</td></tr>
      <tr><td>2026.04.29 00:00:00</td><td>1</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td>0.00</td><td>0.00</td><td>10 000.00</td><td>10 000.00</td><td></td></tr>
      <tr><td>2026.04.29 00:05:00</td><td>2</td><td>EURUSD</td><td>buy</td><td>in</td><td>0.01</td><td>1.17153</td><td>2</td><td>-0.03</td><td>0.00</td><td>0.00</td><td>9 999.97</td><td>trf_market_open</td></tr>
      <tr><td>2026.04.29 00:05:59</td><td>3</td><td>EURUSD</td><td>sell</td><td>out</td><td>0.01</td><td>1.17110</td><td>3</td><td>-0.03</td><td>0.00</td><td>-0.43</td><td>9 999.51</td><td></td></tr>
    </table>`;
  fs.writeFileSync(reportPath, Buffer.from(html, "utf16le"));
  fs.writeFileSync(lifecyclePath, JSON.stringify({ run_id: "RUN-R", lifecycle_summary: { market_order: { observed: true } } }, null, 2));

  const result = extractMt5ReportLedger({
    rootDir,
    reportPath: "factory/mt5/tester/JOB-R/report.htm",
    lifecyclePath: "factory/mt5/tester/JOB-R/lifecycle.json",
    outputPath: "factory/mt5/ftmo/inputs/report-ledger.json",
    currency: "USD",
    sourceJobId: "JOB-R",
    createdAt: "2026-05-04T00:00:00.000Z"
  });

  const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, "factory/mt5/ftmo/inputs/report-ledger.json"), "utf8"));
  assert.equal(result.event_count, 2);
  assert.equal(ledger.fixture_ledger, false);
  assert.equal(ledger.source_kind, "mt5_strategy_tester_report");
  assert.equal(ledger.account.starting_balance, 10000);
  assert.equal(ledger.events[1].realized_pnl, -0.43);
  assert.equal(ledger.events[1].source.balance_after, 9999.51);
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

test("candidate promotion gate runner writes gate, updates manifest, and records failed parity memory", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const candidateId = "CAND-RUNNER-PROMOTION-001";
  const candidateDir = path.join(paths.factory, "candidates", candidateId);
  fs.mkdirSync(candidateDir, { recursive: true });
  fs.writeFileSync(path.join(candidateDir, "manifest.json"), JSON.stringify({
    schema_version: "candidate_manifest_v1",
    candidate_id: candidateId,
    status: "candidate_under_review",
    promotion_status: "not_requested"
  }, null, 2) + "\n", "utf8");
  fs.mkdirSync(path.join(paths.factory, "mt5", "tester", "JOB-RUNNER-MT5"), { recursive: true });
  fs.writeFileSync(path.join(paths.factory, "mt5", "tester", "JOB-RUNNER-MT5", "execution-result.json"), JSON.stringify({
    status: "executed",
    evidence_kind: "mt5_tester",
    artifacts_created: ["factory/mt5/tester/JOB-RUNNER-MT5/execution-result.json"]
  }, null, 2) + "\n", "utf8");
  const parityReport = buildParityReport({
    candidateId,
    runId: "RUN-RUNNER-PARITY-001",
    comparedArtifacts: ["factory/mt5/tester/JOB-RUNNER-MT5/execution-result.json"],
    driftThresholds: fixtureDriftThresholds(),
    driftObservations: {
      lifecycle: { observed: 1 },
      timing: { observed: 0 },
      fill: { observed: 0 },
      cost: { observed: 0 },
      trade_count: { observed: 0 },
      drawdown: { observed: 0 },
      rule_accounting: { observed: 0 }
    }
  });
  const parityWrite = writeParityReport(paths, parityReport);

  const result = runCandidatePromotionGate({
    rootDir,
    candidateId,
    runId: "RUN-RUNNER-PROMOTION-GATE-001",
    targetContext: "parity",
    evidenceResultPaths: ["factory/mt5/tester/JOB-RUNNER-MT5/execution-result.json"],
    parityReportPath: path.relative(rootDir, parityWrite.path).replace(/\\/g, "/")
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(candidateDir, "manifest.json"), "utf8"));

  assert.equal(result.status, "denied");
  assert.equal(result.gate.decision, "denied");
  assert.equal(fs.existsSync(path.join(rootDir, result.gate_path)), true);
  assert.equal(result.manifest_update.updated, true);
  assert.equal(manifest.status, "promotion_denied");
  assert.equal(manifest.promotion_status, "parity_denied");
  assert.equal(manifest.latest_gate_decision.decision, "denied");
  assert.match(fs.readFileSync(path.join(rootDir, result.failed_parity_memory.path), "utf8"), /CAND-RUNNER-PROMOTION-001/);
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
        windows_completed: 3
      }
    }
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(candidateDir, "manifest.json"), "utf8"));

  assert.equal(gateResult.gate.decision, "denied");
  assert.equal(gateResult.gate.target_context, "research");
  assert.equal(fs.existsSync(path.join(rootDir, gateResult.gate_path)), true);
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

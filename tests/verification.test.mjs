import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { validateExecutionArtifacts, validateExecutionResult, validateEvaluationResult, validatePlannerResult, validateSummaryResult } from "../src/core/validators.mjs";
import { buildRolloutGate, buildStageGateResult, buildVerificationManifest, finalizeRolloutGateExecution, runFaultDrills, writeRolloutGate, writeVerificationManifest } from "../src/core/verification.mjs";
import { normalizeGateArg } from "../scripts/run-rollout-gate.mjs";
import { refreshVerificationArtifacts, validateStructure } from "../scripts/validate-structure.mjs";

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verification-"));
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
  fs.writeFileSync(path.join(rootDir, "walk forward engine", "results", "demo", "summary.json"), "{}\n", "utf8");

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

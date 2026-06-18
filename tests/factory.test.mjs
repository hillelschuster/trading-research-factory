import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { SimulateRunner } from "../src/core/runner-simulate.mjs";
import { OpenCodeRunner, buildServerConfigForTests } from "../src/core/runner-opencode.mjs";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { BacklogStore } from "../src/core/backlog-store.mjs";
import { buildRepeatedFailureRemediationActions, runFactory } from "../src/core/orchestrator.mjs";
import { readLeaderboardEntries } from "../src/core/leaderboard-store.mjs";
import { rebuildNormalizedMemory } from "../src/core/memory-index.mjs";
import { rebuildHealthMetrics } from "../src/core/health.mjs";
import { rebuildDerivedArtifacts } from "../src/core/verification.mjs";
import { normalizeMarketPolicy, readMarketPolicy } from "../src/core/market-policy.mjs";
import { acquireOwnerLock, readOwnerLock } from "../src/core/runtime-lock.mjs";
import { buildExecutorRetrieval, buildPlannerRetrieval } from "../src/core/retrieval.mjs";
import { evaluatorPrompt, executorPrompt, ideatorPrompt, plannerPrompt } from "../src/core/prompt-builders.mjs";
import { validatePlannerResult, validateEvaluationResult, validateSummaryResult } from "../src/core/validators.mjs";
import { loadRuntimeConfig } from "../src/core/config.mjs";

function run(cwd, ...args) {
  const result = spawnSync("node", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, RESEARCH_FACTORY_OBSERVER_PORT: "0" }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function createTempRepoRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-"));
  const projectRoot = path.join(tempRoot, "trading-research-factory");
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "trading-research-factory" }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "opencode.json"), JSON.stringify({ plugin: [], provider: {} }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Temp Test Repo\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "cli.mjs"), "", "utf8");
  return projectRoot;
}

test("simulate mode writes state and evidence", () => {
  const cwd = path.resolve(process.cwd());
  const projectRoot = createTempRepoRoot();
  run(cwd, "src/cli.mjs", "run", "--mode", "simulate", "--cycles", "1", "--interval-ms", "1", "--root", projectRoot);
  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, "factory/state.json"), "utf8"));
  const evidence = JSON.parse(fs.readFileSync(path.join(projectRoot, "factory/evidence/index.json"), "utf8"));
  assert.equal(state.iteration >= 1, true);
  assert.equal(evidence.length >= 1, true);
});

test("simulate mode creates fresh stage sessions", () => {
  const cwd = path.resolve(process.cwd());
  const projectRoot = createTempRepoRoot();

  run(cwd, "src/cli.mjs", "run", "--mode", "simulate", "--cycles", "1", "--interval-ms", "1", "--root", projectRoot);

  const state = JSON.parse(fs.readFileSync(path.join(projectRoot, "factory/state.json"), "utf8"));
  const runDirs = fs.readdirSync(path.join(projectRoot, "factory/runs")).filter((entry) => entry.startsWith("RUN-"));
  assert.equal(runDirs.length >= 1, true);

  const runDir = path.join(
    projectRoot,
    "factory/runs",
    runDirs.sort((a, b) => {
      const aTime = fs.statSync(path.join(projectRoot, "factory/runs", a)).mtimeMs;
      const bTime = fs.statSync(path.join(projectRoot, "factory/runs", b)).mtimeMs;
      return bTime - aTime;
    })[0]
  );
  const sessionFiles = [
    "planner-attempt-1-session.json",
    "executor-attempt-1-session.json",
    "evaluator-attempt-1-session.json",
    "summarizer-attempt-1-session.json"
  ];
  const sessionIds = sessionFiles.map((filename) => {
    const payload = JSON.parse(fs.readFileSync(path.join(runDir, filename), "utf8"));
    return payload.session_id;
  });

  assert.equal(new Set(sessionIds).size, sessionIds.length);
  assert.equal(state.active_session_id, null);
  assert.equal(state.active_session_url, null);
});

test("simulate mode leaves a durable active-session record with the latest URL", () => {
  const cwd = path.resolve(process.cwd());
  const projectRoot = createTempRepoRoot();

  run(cwd, "src/cli.mjs", "run", "--mode", "simulate", "--cycles", "1", "--interval-ms", "1", "--root", projectRoot);

  const activeSession = JSON.parse(fs.readFileSync(path.join(projectRoot, "factory/active-session.json"), "utf8"));
  const activeRun = JSON.parse(fs.readFileSync(path.join(projectRoot, "factory/runtime/active-run.json"), "utf8"));
  assert.equal(activeSession.status, "idle");
  assert.equal(activeSession.run_id?.startsWith("RUN-"), true);
  assert.equal(activeSession.agent, "summarizer");
  assert.match(activeSession.session_url, /^simulate:\/\/session\//);
  assert.equal(typeof activeSession.ended_at, "string");
  assert.equal(activeRun.status, "idle");
  assert.equal(activeRun.run_id, null);
});

test("simulate runner issues a fresh session per agent call", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const runner = new SimulateRunner({ rootDir });

  await runner.init();
  const ideator = await runner.callAgent("ideator", "test ideator prompt");
  const planner = await runner.callAgent("planner", "test planner prompt");

  assert.notEqual(ideator.sessionId, planner.sessionId);
  assert.match(ideator.sessionId, /^SIMULATED-SESSION-/);
  assert.match(planner.sessionId, /^SIMULATED-SESSION-/);
});

test("simulate runner session ids stay unique across runner instances", async () => {
  const rootDirA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const rootDirB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const runnerA = new SimulateRunner({ rootDir: rootDirA });
  const runnerB = new SimulateRunner({ rootDir: rootDirB });

  await runnerA.init();
  await runnerB.init();
  const first = await runnerA.callAgent("ideator", "test ideator prompt");
  const second = await runnerB.callAgent("ideator", "test ideator prompt");

  assert.notEqual(first.sessionId, second.sessionId);
});

test("health metrics detect duplicate session reuse contamination explicitly", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const runDir = path.join(paths.runs, "RUN-SESSION-REUSE-001");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "planner-attempt-1-session.json"), JSON.stringify({ session_id: "ses-dup" }, null, 2));
  fs.writeFileSync(path.join(runDir, "executor-attempt-1-session.json"), JSON.stringify({ session_id: "ses-dup" }, null, 2));

  const health = rebuildHealthMetrics(paths);
  assert.equal(health.session_reuse_count.reused_session_records, 1);
});

test("opencode runner builds session URL from returned project id", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const runner = new OpenCodeRunner({ rootDir, model: "opencode/minimax-m2.5-free", openBrowser: false });

  runner.client = {
    session: {
      create: async () => ({
        data: {
          id: "ses_test_123",
          projectID: "global"
        }
      })
    }
  };
  runner.baseUrl = "http://127.0.0.1:4096";

  const created = await runner.createSession({ agent: "executor", attempt: 1 });
  assert.equal(created.sessionUrl, "http://127.0.0.1:4096/global/session/ses_test_123");
});

test("opencode runner falls back to project.current when session project id is missing", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const runner = new OpenCodeRunner({ rootDir, model: "opencode/minimax-m2.5-free", openBrowser: false });

  runner.client = {
    session: {
      create: async () => ({
        data: {
          id: "ses_test_456"
        }
      })
    },
    project: {
      current: async () => ({
        data: {
          id: "global"
        }
      })
    }
  };
  runner.baseUrl = "http://127.0.0.1:4096";

  const created = await runner.createSession({ agent: "executor", attempt: 1 });
  assert.equal(created.sessionUrl, "http://127.0.0.1:4096/global/session/ses_test_456");
});

test("live server config disables all plugins by default", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, "opencode.json"), JSON.stringify({
    plugin: ["opencode-agent-memory@0.2.0", "something-else"],
    provider: {}
  }, null, 2));

  const config = buildServerConfigForTests(rootDir, "opencode");
  assert.deepEqual(config.plugin, []);
  assert.equal(config.provider.opencode.options.timeout, false);
});

test("runtime config uses longer default session creation timeout", () => {
  const config = loadRuntimeConfig([], process.cwd());
  assert.equal(config.liveTransportTimeouts.sessionCreateMs, 30000);
});

test("runtime config supports targetable Phase 8D screening backlog selection", () => {
  const config = loadRuntimeConfig(["run", "--screening-backlog-id", "IDEA-PHASE8D-TARGET"], process.cwd());
  assert.equal(config.screeningBacklogItemId, "IDEA-PHASE8D-TARGET");
});

test("Phase 8D blocked-at-start compiler gates write terminal artifacts without LLM fallback", async () => {
  const rootDir = createTempRepoRoot();
  const paths = initializeProject(rootDir);
  const backlogStore = new BacklogStore(paths);
  backlogStore.append([{
    id: "IDEA-PHASE8D-LEGACY-WFA",
    title: "Legacy WFA route must not become Phase 8D screening",
    objective: "Prove Phase 8D blocks legacy ready WFA routes before planner fallback.",
    status: "ready",
    priority: 100,
    evidence_kind: "research_wfa",
    candidate_stage: "Phase 8D screening",
    candidate_id: "CAND-PHASE8D-LEGACY-WFA",
    expected_wfa_config_path: "walk forward engine/strategies/legacy/wfa_config.yaml"
  }]);

  const result = await runFactory({
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    rootDir,
    observerBaseUrl: "http://127.0.0.1:0",
    screeningBacklogItemId: "IDEA-PHASE8D-LEGACY-WFA"
  });

  const item = new BacklogStore(paths).read().find((entry) => entry.id === "IDEA-PHASE8D-LEGACY-WFA");
  const runId = result.state.last_run_id;
  const blockedPath = path.join(paths.runs, runId, "phase8d-blocked-at-start.json");
  const executionPath = path.join(paths.runs, runId, "execution-result.json");
  const candidateEvidencePath = path.join(paths.runs, runId, "phase8d-candidate-evidence-packet.json");
  const runState = JSON.parse(fs.readFileSync(path.join(paths.runs, runId, "run-state.json"), "utf8"));
  const execution = JSON.parse(fs.readFileSync(executionPath, "utf8"));
  const candidateEvidence = JSON.parse(fs.readFileSync(candidateEvidencePath, "utf8"));

  assert.equal(result.cycles_executed, 1);
  assert.equal(item.status, "research_blocked");
  assert.equal(fs.existsSync(blockedPath), true);
  assert.equal(fs.existsSync(candidateEvidencePath), true);
  assert.equal(execution.status, "blocked");
  assert.equal(execution.observations.phase8d_blocked_at_start, true);
  assert.equal(execution.observations.llm_planner_fallback_allowed, false);
  assert.equal(candidateEvidence.schema_version, "phase8d_candidate_evidence_packet_v1");
  assert.equal(candidateEvidence.denominator_context.attempt_is_denominator_member, true);
  assert.equal(candidateEvidence.advisory_statistics.promotion_authority, false);
  assert.equal(candidateEvidence.phase8e_boundary.phase8e_authorized, false);
  assert.equal(runState.stage_status.planner.status, "blocked");
  assert.equal(runState.stage_status.executor.status, "skipped");
});

test("simulate ideator avoids fixed asset and timeframe narrowing", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const runner = new SimulateRunner({ rootDir });

  await runner.init();
  const ideator = await runner.callAgent("ideator", "test ideator prompt");
  const payload = JSON.parse(ideator.text.match(/<RF_JSON>\n([\s\S]*)\n<\/RF_JSON>/)[1]);

  assert.equal(/BTC|ETH|SOL/i.test(payload.instrument_scope), false);
  assert.equal(payload.timeframe, "Strategy-chosen liquid-market timeframe");
});

test("backlog store recovers expired leases to ready", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const paths = initializeProject(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-EXPIRED",
    title: "Expired lease item",
    objective: "Recover stale work",
    status: "leased",
    priority: 50,
    lease_owner: "factory-123",
    lease_expires_at: "2000-01-01T00:00:00.000Z",
    current_run_id: "RUN-OLD",
    resume_from_stage: "executor"
  }]);

  const recovered = backlogStore.recoverExpiredLeases(new Date("2001-01-01T00:00:00.000Z"));
  const item = backlogStore.read().find((entry) => entry.id === "IDEA-EXPIRED");

  assert.equal(recovered.length, 1);
  assert.equal(item.status, "ready");
  assert.equal(item.lease_owner, null);
  assert.equal(item.lease_expires_at, null);
  assert.equal(item.resume_from_stage, "executor");
});

test("expired quarantine does not auto-resume poisoned run", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const paths = initializeProject(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-POISONED",
    title: "Poisoned executor item",
    objective: "Should require explicit operator requeue after quarantine",
    status: "infra_quarantined",
    priority: 50,
    lease_owner: "factory-123",
    lease_expires_at: "2000-01-01T00:00:00.000Z",
    current_run_id: "RUN-POISONED",
    resume_from_stage: "executor",
    quarantine_until: "2000-01-01T00:00:00.000Z",
    last_failure_class: "transport_failure"
  }]);

  const recovered = backlogStore.recoverCooldowns(new Date("2001-01-01T00:00:00.000Z"));
  const item = backlogStore.read().find((entry) => entry.id === "IDEA-POISONED");

  assert.equal(recovered.length, 1);
  assert.equal(item.status, "infra_blocked");
  assert.equal(item.quarantine_until, null);
  assert.equal(item.lease_owner, null);
  assert.equal(item.lease_expires_at, null);
  assert.equal(item.current_run_id, null);
  assert.equal(item.blocked_resume_run_id, "RUN-POISONED");
  assert.equal(item.resume_from_stage, null);
});

test("backlog migration rewrites legacy statuses to canonical disk state", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const paths = initializeProject(rootDir);
  const backlogStore = new BacklogStore(paths);

  fs.writeFileSync(paths.backlog, JSON.stringify([
    {
      id: "IDEA-LEGACY-1",
      title: "Legacy completed item",
      objective: "Should migrate to canonical research status",
      status: "completed",
      verdict: "partial",
      run_id: "RUN-LEGACY-1"
    },
    {
      id: "IDEA-LEGACY-2",
      title: "Legacy pending item",
      objective: "Should migrate to ready",
      status: "pending"
    }
  ], null, 2));

  const migration = backlogStore.migrate();
  const migrated = JSON.parse(fs.readFileSync(paths.backlog, "utf8"));

  assert.equal(migration.changed, true);
  assert.equal(migrated[0].status, "research_inconclusive");
  assert.equal(migrated[0].research_status, "research_inconclusive");
  assert.equal(migrated[0].current_run_id, "RUN-LEGACY-1");
  assert.equal("run_id" in migrated[0], false);
  assert.equal(migrated[1].status, "ready");
  assert.equal(migrated[1].research_status, null);
});

test("legacy run-state and handoff schemas are upgraded in place before resume", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-LEGACY-MIGRATE-001";

  backlogStore.append([{
    id: "IDEA-LEGACY-MIGRATE",
    title: "Resume legacy run-state schema",
    objective: "Legacy run artifacts should be upgraded automatically",
    priority: 90,
    status: "infra_blocked",
    current_run_id: runId,
    resume_from_stage: "executor"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-LEGACY-MIGRATE",
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 1, failure_class: "transport_failure" }
    },
    resume_from_stage: "executor",
    handoff_pending: true,
    attempt_counts: { planner: 1, executor: 1 }
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    resume_from_stage: "executor",
    failure_class: "transport_failure",
    last_error: "legacy handoff",
    safe_inputs: { run_id: runId }
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-LEGACY-MIGRATE-001",
    title: "Legacy migrate plan",
    backlog_item_id: "IDEA-LEGACY-MIGRATE",
    objective: "Resume execution",
    hypothesis: "Legacy schemas should be upgraded before resume.",
    strategy_rationale: "Synthetic migration test.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT spot",
    timeframe: "1h",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Synthetic fixture." },
    source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic migration test" },
    scope_selection_rationale: "Synthetic migration scope.",
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: ["factory/runs/RUN-LEGACY-MIGRATE-001/execution-result.json"],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Synthetic migration gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const migratedRunState = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));
  const migratedHandoff = JSON.parse(fs.readFileSync(path.join(runDir, "handoff.json"), "utf8"));
  const verificationFiles = fs.readdirSync(paths.verification).filter((name) => name.startsWith("state-migration-report-"));

  assert.equal(typeof migratedRunState.resume_generation, "number");
  assert.equal(migratedRunState.run_instance_id, runId);
  assert.equal(migratedHandoff.schema_version, "handoff_v2");
  assert.equal(typeof migratedHandoff.resume_generation, "number");
  assert.equal(verificationFiles.length >= 1, true);
});

test("infra transition preserves research disposition separately from queue status", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-RESEARCH-STATUS-1",
    title: "Preserve research status across infra block",
    objective: "Queue state should not erase research disposition",
    status: "research_inconclusive",
    research_status: "research_inconclusive"
  }]);

  backlogStore.markInfraBlocked("IDEA-RESEARCH-STATUS-1", {
    runId: "RUN-INFRA-1",
    failureClass: "transport_failure",
    resumeFromStage: "executor"
  });

  const updated = backlogStore.read().find((item) => item.id === "IDEA-RESEARCH-STATUS-1");
  assert.equal(updated.status, "infra_blocked");
  assert.equal(updated.research_status, "research_inconclusive");
  assert.equal(updated.current_run_id, "RUN-INFRA-1");
});

test("leaderboard reader normalizes legacy object payloads", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const paths = initializeProject(rootDir);

  fs.writeFileSync(paths.leaderboard, JSON.stringify({
    strategies: [
      { experiment_id: "EXP-1", strategy_name: "legacy" }
    ]
  }, null, 2));

  const leaderboard = readLeaderboardEntries(paths);
  assert.equal(Array.isArray(leaderboard), true);
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].experiment_id, "EXP-1");
});

test("runFactory reuses a persisted plan instead of rerunning planner on planner resume", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-RESUME-PLAN-001";

  backlogStore.append([{
    id: "IDEA-RESUME-PLAN",
    title: "Resume planner with persisted plan",
    objective: "Skip planner if experiment-plan.json already exists",
    priority: 95,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "planner"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-RESUME-PLAN",
    resume_generation: 1,
    stage_status: {
      planner: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 1, failure_class: "transport_failure" },
      executor: { status: "pending", updated_at: null },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "planner",
    attempt_counts: { planner: 1, executor: 0, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "planner",
    resume_generation: 1,
    failure_class: "transport_failure",
    last_error: "planner timed out",
    attempts_used: 3,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-RESUME-PLAN" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-RESUME-PLAN-001",
    title: "Persisted simulated plan",
    backlog_item_id: "IDEA-RESUME-PLAN",
    objective: "Resume execution",
    hypothesis: "A persisted valid plan should allow planner skip",
    strategy_rationale: "Synthetic planner-resume test.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT spot",
    timeframe: "1h",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo window", justification: "Synthetic test fixture with a valid persisted planning context." },
    source_plan: {
      allowed_source_families: ["existing_fetcher"],
      primary_source_family: "existing_fetcher",
      selection_reason: "Synthetic test"
    },
    scope_selection_rationale: "Synthetic resume test with an already persisted valid plan.",
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: ["factory/runs/RUN-RESUME-PLAN-001/execution-result.json"],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Simulated gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  const result = await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const updatedHandoff = JSON.parse(fs.readFileSync(path.join(runDir, "handoff.json"), "utf8"));
  const updatedRunState = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));

  assert.equal(result.cycles_executed, 1);
  assert.equal(updatedHandoff.consumed, true);
  assert.equal(updatedRunState.handoff_pending, false);
  assert.equal(fs.existsSync(path.join(runDir, "planner-attempt-1")), false);
  assert.equal(fs.existsSync(path.join(runDir, "executor-attempt-1", "stage-input.json")), true);
});

test("runFactory compiles explicit WFA-ready backlog items without calling planner", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  const wfaConfigPath = path.join(rootDir, "walk forward engine", "strategies", "deterministic_route", "wfa_config.yaml");
  const strategyConfigPath = path.join(rootDir, "walk forward engine", "config", "strategy_deterministic_route.json");
  const strategySourcePath = path.join(rootDir, "walk forward engine", "src", "strategies", "deterministic_route.py");
  const dataPath = path.join(rootDir, "walk forward engine", "data", "deterministic_route.csv");
  fs.mkdirSync(path.dirname(wfaConfigPath), { recursive: true });
  fs.mkdirSync(path.dirname(strategyConfigPath), { recursive: true });
  fs.mkdirSync(path.dirname(strategySourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(wfaConfigPath, "walk_forward:\n  training_months: 3\n  testing_months: 1\n  step_months: 1\n  n_parameter_trials: 5\n  output_directory: strategies/deterministic_route/results\ndata:\n  source_file: data/deterministic_route.csv\nstrategy:\n  profile_key: DETERMINISTIC_ROUTE\nperformance:\n  max_execution_time_seconds: 60\n", "utf8");
  fs.writeFileSync(strategyConfigPath, "{}\n", "utf8");
  fs.writeFileSync(strategySourcePath, "class DeterministicRoute:\n    pass\n", "utf8");
  fs.writeFileSync(dataPath, "timestamp,open,high,low,close,volume\n", "utf8");

  backlogStore.append([{
    id: "IDEA-WFA-READY-BYPASS",
    title: "Deterministic WFA-ready planner bypass fixture",
    objective: "Run an explicit WFA-ready route without spending an agent planner call.",
    priority: 99,
    category: "strategy",
    status: "ready",
    source: "test",
    market_family: "crypto",
    instrument_scope: "BTCUSDT spot",
    timeframe: "1h",
    data_source: "existing_fixture",
    data_requirement: "walk forward engine/data/deterministic_route.csv",
    expected_wfa_config_path: "walk forward engine/strategies/deterministic_route/wfa_config.yaml",
    expected_strategy_config_path: "walk forward engine/config/strategy_deterministic_route.json",
    expected_strategy_source_path: "walk forward engine/src/strategies/deterministic_route.py",
    evidence_kind: "research_wfa",
    authority_layer: "python_research",
    deployment_mode: "research_only"
  }]);

  const result = await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const state = JSON.parse(fs.readFileSync(paths.state, "utf8"));
  const runDir = path.join(paths.runs, state.last_run_id);
  const plan = JSON.parse(fs.readFileSync(path.join(runDir, "experiment-plan.json"), "utf8"));
  const bypass = JSON.parse(fs.readFileSync(path.join(runDir, "planner-bypass.json"), "utf8"));
  const gates = JSON.parse(fs.readFileSync(path.join(runDir, "gate-results.json"), "utf8"));
  const plannerGate = gates.stages.find((stage) => stage.stage === "planner");

  assert.equal(result.cycles_executed, 1);
  assert.equal(fs.existsSync(path.join(runDir, "planner-attempt-1")), false);
  assert.equal(fs.existsSync(path.join(runDir, "planner-attempt-0", "stage-gate.json")), true);
  assert.equal(plan.planner_bypass.compiler, "deterministic_wfa_ready_compiler_v1");
  assert.equal(plan.lineage_id, "LINEAGE-IDEA-WFA-READY-BYPASS");
  assert.equal(plan.family_id, "FAMILY-DETERMINISTIC-ROUTE");
  assert.equal(plan.commands[0].includes("walk_forward_smoke_test.py --config strategies/deterministic_route/wfa_config.yaml"), true);
  assert.equal(bypass.compiler, "deterministic_wfa_ready_compiler_v1");
  assert.equal(plannerGate.validator, "deterministic_wfa_ready_compiler");
});

test("runFactory resumes pending handoff from executor stage", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-RESUME-001";

  backlogStore.append([{
    id: "IDEA-RESUME",
    title: "Resume executor handoff",
    objective: "Continue a stalled run from executor",
    priority: 90,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "executor"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-RESUME",
    resume_generation: 1,
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "pending", updated_at: null },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 0, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "executor",
    resume_generation: 1,
    failure_class: "transport_failure",
    last_error: "executor timed out",
    attempts_used: 3,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-RESUME" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-RESUME-001",
    title: "Resumed simulated plan",
    backlog_item_id: "IDEA-RESUME",
    objective: "Resume execution",
    hypothesis: "Resume should skip planner and continue from executor",
    strategy_rationale: "Synthetic resume test.",
    strategy_type: "momentum",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Test only" },
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: [],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "test", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  const result = await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const updatedHandoff = JSON.parse(fs.readFileSync(path.join(runDir, "handoff.json"), "utf8"));
  const updatedRunState = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));
  const updatedBacklog = backlogStore.read().find((entry) => entry.id === "IDEA-RESUME");

  assert.equal(result.cycles_executed, 1);
  assert.equal(updatedHandoff.consumed, true);
  assert.equal(updatedRunState.handoff_pending, false);
  assert.equal(updatedRunState.resume_from_stage, null);
  assert.equal(updatedBacklog.status, "research_inconclusive");
  assert.equal(fs.existsSync(path.join(runDir, "planner-attempt-1")), false);
  assert.equal(fs.existsSync(path.join(runDir, "executor-attempt-1", "stage-input.json")), true);
});

test("resumed executor attempts keep monotonic ordinals and do not overwrite prior attempt artifacts", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-RESUME-ORDINAL-001";

  backlogStore.append([{
    id: "IDEA-RESUME-ORDINAL",
    title: "Resume executor with prior attempts",
    objective: "Ensure new attempts remain monotonic across resume",
    priority: 90,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "executor"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(path.join(runDir, "executor-attempt-1"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "executor-attempt-1", "sentinel.txt"), "keep\n", "utf8");
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-RESUME-ORDINAL",
    owner_id: null,
    run_instance_id: runId,
    resume_generation: 1,
    current_stage: "executor",
    current_stage_attempt: 3,
    current_stage_session: null,
    last_completed_stage: "planner",
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 3, failure_class: "transport_failure" },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 3, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    last_error: "executor timed out",
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "executor",
    resume_generation: 1,
    failure_class: "transport_failure",
    last_error: "executor timed out",
    attempts_used: 3,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-RESUME-ORDINAL" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-RESUME-ORDINAL-001",
    title: "Resumed ordinal plan",
    backlog_item_id: "IDEA-RESUME-ORDINAL",
    objective: "Resume execution",
    hypothesis: "Resumed attempts must keep increasing monotonically.",
    strategy_rationale: "Synthetic ordinal-resume test.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT spot",
    timeframe: "1h",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Synthetic test fixture with resumed context." },
    source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic test" },
    scope_selection_rationale: "Synthetic resumed executor ordinal test.",
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: ["factory/runs/RUN-RESUME-ORDINAL-001/execution-result.json"],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Synthetic resume gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  const result = await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const updatedRunState = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));
  assert.equal(result.cycles_executed, 1);
  assert.equal(updatedRunState.attempt_counts.executor, 4);
  assert.equal(fs.existsSync(path.join(runDir, "executor-attempt-1", "sentinel.txt")), true);
  assert.equal(fs.existsSync(path.join(runDir, "executor-attempt-4", "stage-input.json")), true);
});

test("stale handoff generation is ignored during resume selection", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-STALE-HANDOFF-001";

  backlogStore.append([{
    id: "IDEA-STALE-HANDOFF",
    title: "Ignore stale handoff generation",
    objective: "Only matching resume generation should be consumed",
    priority: 90,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "executor"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-STALE-HANDOFF",
    owner_id: null,
    run_instance_id: runId,
    resume_generation: 2,
    current_stage: "executor",
    current_stage_attempt: 1,
    current_stage_session: null,
    last_completed_stage: "planner",
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 1, failure_class: "transport_failure" },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 1, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    last_error: "executor timed out",
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "executor",
    resume_generation: 1,
    failure_class: "transport_failure",
    last_error: "stale handoff",
    attempts_used: 1,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-STALE-HANDOFF" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-STALE-HANDOFF-001",
    title: "Stale handoff plan",
    backlog_item_id: "IDEA-STALE-HANDOFF",
    objective: "Resume execution",
    hypothesis: "Mismatched handoff generations must be ignored.",
    strategy_rationale: "Synthetic stale-handoff test.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT spot",
    timeframe: "1h",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Synthetic fixture." },
    source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic test" },
    scope_selection_rationale: "Synthetic stale handoff test.",
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: ["factory/runs/RUN-STALE-HANDOFF-001/execution-result.json"],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Synthetic stale handoff gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const updatedHandoff = JSON.parse(fs.readFileSync(path.join(runDir, "handoff.json"), "utf8"));
  assert.equal(updatedHandoff.consumed, false);
  assert.equal(updatedHandoff.resume_generation, 1);
});

test("retry and handoff notes are consumed only by the resumed stage", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-HANDOFF-SCOPE-001";
  const prompts = { executor: [], evaluator: [], summarizer: [] };

  backlogStore.append([{
    id: "IDEA-HANDOFF-SCOPE",
    title: "Resume executor handoff without leakage",
    objective: "Handoff note should only appear in resumed executor prompt",
    priority: 90,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "executor",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-HANDOFF-SCOPE",
    owner_id: null,
    run_instance_id: runId,
    resume_generation: 1,
    current_stage: "executor",
    current_stage_attempt: 1,
    current_stage_session: null,
    last_completed_stage: "planner",
    observer_opened_at: null,
    poison_streak_count: 0,
    poison_stage: null,
    poison_failure_class: null,
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 1, failure_class: "transport_failure" },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 1, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    last_error: "executor timed out",
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "executor",
    resume_generation: 1,
    failure_class: "transport_failure",
    last_error: "executor timed out",
    attempts_used: 1,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-HANDOFF-SCOPE" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-HANDOFF-SCOPE-001",
    title: "Scoped handoff plan",
    backlog_item_id: "IDEA-HANDOFF-SCOPE",
    objective: "Resume execution",
    hypothesis: "Retry note should not leak beyond resumed executor stage.",
    strategy_rationale: "Synthetic handoff scoping test.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT spot",
    timeframe: "1h",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Synthetic fixture." },
    source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic test" },
    scope_selection_rationale: "Synthetic handoff scope test.",
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: ["workspace/results/handoff-scope/report.json"],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Synthetic handoff gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  const capturingTransport = {
    init: async () => ({}),
    createSession: async ({ agent, attempt } = {}) => ({
      sessionId: `${agent}-session-${attempt || 1}`,
      sessionUrl: `http://localhost/session/${agent}-session-${attempt || 1}`
    }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-handoff-scope" }),
    callAgent: async (agent, promptText, options = {}) => {
      prompts[agent].push(promptText);
      const sessionId = `${agent}-session-${options.attempt || 1}`;
      const sessionUrl = `http://localhost/session/${sessionId}`;
      await options.onSessionCreated?.({ sessionId, sessionUrl });

      if (agent === "executor") {
        const resultPath = path.join(rootDir, "workspace", "results", "handoff-scope", "report.json");
        fs.mkdirSync(path.dirname(resultPath), { recursive: true });
        fs.writeFileSync(resultPath, JSON.stringify({ sharpe_oos: 0.5, total_trades: 40, max_drawdown: -10 }, null, 2) + "\n", "utf8");
        const body = {
          experiment_id: "EXP-HANDOFF-SCOPE-001",
          status: "partial",
          commands_attempted: ["run wfa"],
          commands_completed: ["run wfa"],
          artifacts_created: ["workspace/results/handoff-scope/report.json"],
          datasets_acquired: [],
          artifacts_updated: [],
          workspace_changes: ["Created final report"],
          metrics_observed: { sharpe_oos: 0.5, total_trades: 40, max_drawdown: -10 },
          provenance: {
            engine: "walk_forward_engine",
            command: "python scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
            working_directory: "walk forward engine",
            config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
            result_artifacts: ["workspace/results/handoff-scope/report.json"],
            windows_completed: 5
          },
          variants_tested: [],
          blockers: ["Synthetic transport fixture does not produce Phase 7A worker-launched WFA evidence."],
          errors: [{ command: "synthetic_executor_fixture", message: "No research_wfa_run worker was launched in this prompt-scoping test." }],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
      }

      if (agent === "evaluator") {
        const body = {
          experiment_id: "EXP-HANDOFF-SCOPE-001",
          verdict: "inconclusive",
          evidence_score: 55,
          performance_score: 50,
          robustness_score: 50,
          novelty_score: 45,
          overall_score: 50,
          metrics: { sharpe_oos: 0.5, total_trades: 40 },
          red_flags: [],
          verification: { artifacts_checked: ["workspace/results/handoff-scope/report.json"], metrics_verified_from: ["workspace/results/handoff-scope/report.json"], missing_or_unverified: [] },
          strengths: [],
          weaknesses: [],
          missing_evidence: [],
          promote_to_leaderboard: false,
          leaderboard_tier: "experimental",
          next_backlog_actions: [],
          confidence_level: "medium",
          confidence_rationale: "Synthetic test."
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
      }

      if (agent === "summarizer") {
        const body = {
          experiment_id: "EXP-HANDOFF-SCOPE-001",
          backlog_item_id: "IDEA-HANDOFF-SCOPE",
          summary: "Synthetic run completed.",
          key_lessons: [{ lesson: "Scoped handoff note used correctly.", specific_finding: "Only executor saw the retry note.", result: { sharpe_oos: 0.5, trades: 40 } }],
          next_actions: [{ action: "Inspect retrieval compactness", rationale: "Next bounded step.", priority: "low" }]
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
      }

      throw new Error(`Unexpected agent ${agent}`);
    },
    close: async () => {}
  };

  await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    observerBaseUrl: "http://127.0.0.1:4310",
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    liveTransport: capturingTransport
  });

  assert.match(prompts.executor[0], /## Retry Or Handoff Note/);
  assert.equal(prompts.evaluator[0].includes("## Retry Or Handoff Note"), false);
  assert.equal(prompts.summarizer[0].includes("## Retry Or Handoff Note"), false);
});

test("startup reconciliation prefers the most advanced safe resumable run deterministically", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([
    {
      id: "IDEA-RESUME-A",
      title: "Lower-priority resumable run",
      objective: "Resume from executor",
      priority: 80,
      status: "infra_blocked",
      current_run_id: "RUN-RESUME-A",
      last_failure_class: "transport_failure",
      resume_from_stage: "executor"
    },
    {
      id: "IDEA-RESUME-B",
      title: "More advanced resumable run",
      objective: "Resume from summarizer",
      priority: 85,
      status: "infra_blocked",
      current_run_id: "RUN-RESUME-B",
      last_failure_class: "transport_failure",
      resume_from_stage: "summarizer"
    }
  ]);

  for (const [runId, backlogId, resumeStage] of [["RUN-RESUME-A", "IDEA-RESUME-A", "executor"], ["RUN-RESUME-B", "IDEA-RESUME-B", "summarizer"]]) {
    const runDir = path.join(paths.runs, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
      run_id: runId,
      backlog_item_id: backlogId,
      owner_id: null,
      run_instance_id: runId,
      resume_generation: 1,
      current_stage: resumeStage,
      current_stage_attempt: 1,
      current_stage_session: null,
      last_completed_stage: resumeStage === "summarizer" ? "evaluator" : "planner",
      stage_status: {
        planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
        executor: { status: resumeStage === "executor" ? "failed" : "completed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 1, failure_class: "transport_failure" },
        evaluator: { status: resumeStage === "summarizer" ? "completed" : "pending", updated_at: "2026-03-24T00:00:00.000Z" },
        summarizer: { status: "pending", updated_at: null }
      },
      failure_class: "transport_failure",
      resume_from_stage: resumeStage,
      attempt_counts: { planner: 1, executor: 1, evaluator: resumeStage === "summarizer" ? 1 : 0, summarizer: 0 },
      artifact_paths: {},
      handoff_pending: true,
      last_error: `${resumeStage} timed out`,
      updated_at: resumeStage === "summarizer" ? "2026-03-24T00:10:00.000Z" : "2026-03-24T00:05:00.000Z"
    }, null, 2));
    fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
      schema_version: "handoff_v2",
      resume_from_stage: resumeStage,
      resume_generation: 1,
      failure_class: "transport_failure",
      last_error: `${resumeStage} timed out`,
      attempts_used: 1,
      safe_inputs: { run_id: runId, backlog_item_id: backlogId },
      produced_artifacts: [],
      consumed: false
    }, null, 2));
    fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
      experiment_id: `EXP-${runId}`,
      title: `Plan ${runId}`,
      backlog_item_id: backlogId,
      objective: "Resume execution",
      hypothesis: "Most advanced valid resume target should be selected first.",
      strategy_rationale: "Synthetic startup reconciliation test.",
      strategy_type: "momentum",
      market_family: "crypto",
      instrument_scope: "BTC/USDT spot",
      timeframe: "1h",
      priority: 100,
      dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
      historical_depth_requirement: { target: "Demo", justification: "Synthetic fixture." },
      source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic test" },
      scope_selection_rationale: "Synthetic reconciliation test.",
      data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
      inputs: [],
      implementation_steps: [],
      commands: [],
      expected_artifacts: [`factory/runs/${runId}/execution-result.json`],
      advanced_wfa_config: {},
      evaluation_criteria: { status_gate: "Synthetic reconciliation gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
      fallback_if_blocked: [],
      notes: []
    }, null, 2));
    if (resumeStage === "summarizer") {
      fs.writeFileSync(path.join(runDir, "execution-result.json"), JSON.stringify({ status: "executed", artifacts_created: ["workspace/results/demo/report.json"], metrics_observed: { sharpe_oos: 0.1, total_trades: 10 }, provenance: { engine: "walk_forward_engine", command: "python scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml", working_directory: "walk forward engine", config_path: "walk forward engine/strategies/demo/wfa_config.yaml", result_artifacts: ["workspace/results/demo/report.json"], windows_completed: 3 } }, null, 2));
      fs.writeFileSync(path.join(runDir, "evaluation.json"), JSON.stringify({ verdict: "inconclusive", evidence_score: 0.2, overall_score: 0.2, red_flags: [], missing_evidence: [], confidence_level: "low", confidence_rationale: "test", verification: { artifacts_checked: ["workspace/results/demo/report.json"] }, promote_to_leaderboard: false }, null, 2));
    }
  }

  const result = await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const updatedBacklog = backlogStore.read();
  const resumedB = updatedBacklog.find((item) => item.id === "IDEA-RESUME-B");
  const resumedA = updatedBacklog.find((item) => item.id === "IDEA-RESUME-A");

  assert.equal(result.cycles_executed, 1);
  assert.notEqual(resumedB.status, "infra_blocked");
  assert.equal(resumedA.status, "infra_blocked");
});

test("higher-priority ready work preempts an infra-blocked resume", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-STALE-RESUME-001";

  backlogStore.append([
    {
      id: "IDEA-STALE-RESUME-001",
      title: "Stale infra-blocked resume",
      objective: "Should not starve higher-priority ready work",
      priority: 70,
      status: "infra_blocked",
      current_run_id: runId,
      last_failure_class: "transport_failure",
      resume_from_stage: "executor"
    },
    {
      id: "IDEA-HIGH-PRIORITY-READY-001",
      title: "High-priority ready canary",
      objective: "Ready work should run before stale lower-priority infra-blocked resume",
      priority: 95,
      status: "ready",
      category: "strategy",
      market_family: "crypto",
      instrument_scope: "BNBUSDT spot",
      timeframe: "1h"
    }
  ]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-STALE-RESUME-001",
    resume_generation: 1,
    current_stage: "executor",
    last_completed_stage: "planner",
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 1, failure_class: "transport_failure" },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 1, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "executor",
    resume_generation: 1,
    failure_class: "transport_failure",
    last_error: "executor timed out",
    attempts_used: 1,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-STALE-RESUME-001" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-STALE-RESUME-001",
    title: "Stale resume plan",
    backlog_item_id: "IDEA-STALE-RESUME-001",
    objective: "Synthetic stale resume fixture.",
    hypothesis: "Ready work can preempt stale resumes.",
    strategy_rationale: "Synthetic fixture.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT spot",
    timeframe: "1h",
    priority: 70,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Synthetic fixture." },
    source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic fixture." },
    scope_selection_rationale: "Synthetic fixture.",
    data_acquisition: { status: "present", reason: "Synthetic fixture.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: [`factory/runs/${runId}/execution-result.json`],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Synthetic gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  const result = await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const updatedBacklog = backlogStore.read();
  const staleResume = updatedBacklog.find((item) => item.id === "IDEA-STALE-RESUME-001");
  const readyCanary = updatedBacklog.find((item) => item.id === "IDEA-HIGH-PRIORITY-READY-001");

  assert.equal(result.cycles_executed, 1);
  assert.equal(staleResume.status, "infra_blocked");
  assert.notEqual(readyCanary.status, "ready");
});

test("runFactory fails live stage attempts that reuse a prior session id", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-LIVE-SESSION-001",
    title: "Detect duplicate live session ids",
    objective: "Fail when two stage attempts share the same live session",
    priority: 90,
    status: "ready",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const duplicateSessionTransport = {
    init: async () => ({}),
    createSession: async () => ({ sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-dup" }),
    callAgent: async (agent, _promptText, options = {}) => {
      await options.onSessionCreated?.({ sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" });
      if (agent === "planner") {
        const body = {
          experiment_id: "EXP-DUP-SESSION-001",
          title: "Duplicate session test",
          backlog_item_id: "IDEA-LIVE-SESSION-001",
          objective: "Test duplicate session detection",
          hypothesis: "Fresh sessions are mandatory per stage attempt",
          strategy_rationale: "Synthetic live transport invariant test.",
          strategy_type: "momentum",
          market_family: "crypto",
          instrument_scope: "BTC/USDT",
          timeframe: "1h",
          priority: 100,
          dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
          historical_depth_requirement: { target: "Demo", justification: "Invariant test" },
          source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Invariant test" },
          scope_selection_rationale: "Synthetic invariant fixture.",
          data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
          inputs: [],
          implementation_steps: [],
          commands: [],
          expected_artifacts: ["workspace/results/duplicate-session/report.json"],
          advanced_wfa_config: {},
          evaluation_criteria: { status_gate: "Duplicate session invariant must hold", metrics: { min_trades: 1 }, min_evidence_score: 0 },
          fallback_if_blocked: [],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" };
      }

      return { text: "", raw: {}, sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" };
    },
    close: async () => {}
  };

  const result = await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportTimeouts: { totalRequestMs: 0 },
    liveTransport: duplicateSessionTransport
  });

  const runDirs = fs.readdirSync(paths.runs).filter((entry) => entry.startsWith("RUN-"));
  const runDir = path.join(paths.runs, runDirs[0]);
  const errorPayload = JSON.parse(fs.readFileSync(path.join(runDir, "executor-attempt-1", "stage-error.json"), "utf8"));
  const gatePayload = JSON.parse(fs.readFileSync(path.join(runDir, "executor-attempt-1", "stage-gate.json"), "utf8"));

  assert.equal(result.cycles_executed, 1);
  assert.match(errorPayload.message, /Fresh-session invariant violated/);
  assert.equal(errorPayload.failure_class, "transport_failure");
  assert.equal(errorPayload.transport_phase, "session_create");
  assert.equal(errorPayload.retryable, false);
  assert.equal(gatePayload.decision, "denied");
  assert.equal(gatePayload.stage, "executor");
});

test("live run enters observer-only mode while a healthy owner lock exists", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-LOCK-001",
    title: "Existing owner should block second live start",
    objective: "Protect backlog from concurrent live mutation",
    priority: 80,
    status: "ready",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  acquireOwnerLock(paths, { ownerId: "owner-a", intervalMs: 1000, nowMs: Date.now() });

  const result = await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1000,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 }
  });

  const backlogItem = backlogStore.read().find((item) => item.id === "IDEA-LOCK-001");
  const recoveryLog = fs.readFileSync(paths.recoveryLog, "utf8");
  assert.equal(result.observer_only, true);
  assert.equal(result.active_owner_id, "owner-a");
  assert.equal(backlogItem.status, "ready");
  assert.equal(readOwnerLock(paths).owner_id, "owner-a");
  assert.match(recoveryLog, /observer_only_start/);
});

test("repeated same-stage infra failures cool down a poisoned run and surface in health", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-POISON-001",
    title: "Poisoned executor run",
    objective: "Repeated executor transport failures should trigger cooldown",
    priority: 90,
    status: "ready",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const duplicateSessionTransport = {
    init: async () => ({}),
    createSession: async () => ({ sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-poison" }),
    callAgent: async (agent, _promptText, options = {}) => {
      await options.onSessionCreated?.({ sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" });
      if (agent === "planner") {
        const body = {
          experiment_id: "EXP-POISON-001",
          title: "Poison cooldown test",
          backlog_item_id: "IDEA-POISON-001",
          objective: "Repeated executor failures should cool down the run",
          hypothesis: "Poisoned runs should not be hammered indefinitely.",
          strategy_rationale: "Synthetic poisoned-run cooldown test.",
          strategy_type: "momentum",
          market_family: "crypto",
          instrument_scope: "BTC/USDT",
          timeframe: "1h",
          priority: 100,
          dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
          historical_depth_requirement: { target: "Demo", justification: "Cooldown test" },
          source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Cooldown test" },
          scope_selection_rationale: "Synthetic cooldown fixture.",
          data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
          inputs: [],
          implementation_steps: [],
          commands: [],
          expected_artifacts: ["workspace/results/poison/report.json"],
          advanced_wfa_config: {},
          evaluation_criteria: { status_gate: "Poison cooldown gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
          fallback_if_blocked: [],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" };
      }

      return { text: "", raw: {}, sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" };
    },
    close: async () => {}
  };

  const result = await runFactory({
    rootDir,
    mode: "live",
    cycles: 3,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    poisonedRunPolicy: { cooldownStreak: 3, quarantineStreak: 5, cooldownMs: 60000, quarantineMs: 120000 },
    liveTransport: duplicateSessionTransport
  });

  const backlogItem = backlogStore.read().find((item) => item.id === "IDEA-POISON-001");
  const runDir = path.join(paths.runs, backlogItem.current_run_id);
  const runState = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));
  const health = rebuildHealthMetrics(paths);

  assert.equal(result.cycles_executed, 3);
  assert.equal(backlogItem.status, "infra_cooldown");
  assert.equal(typeof backlogItem.cooldown_until, "string");
  assert.equal(runState.poison_streak_count, 3);
  assert.equal(runState.poison_stage, "executor");
  assert.equal(runState.poison_failure_class, "transport_failure");
  assert.equal(health.cooldown_run_count, 1);
});

test("poisoned run escalates from streak history into quarantine", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-POISON-QUAR-001";

  backlogStore.append([{
    id: "IDEA-POISON-QUAR-001",
    title: "Poisoned executor run reaches quarantine",
    objective: "Existing streak history should quarantine after another same failure",
    priority: 90,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "executor",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-POISON-QUAR-001",
    owner_id: null,
    run_instance_id: runId,
    resume_generation: 1,
    current_stage: "executor",
    current_stage_attempt: 4,
    current_stage_session: null,
    last_completed_stage: "planner",
    poison_streak_count: 4,
    poison_stage: "executor",
    poison_failure_class: "transport_failure",
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 4, failure_class: "transport_failure" },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 4, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    last_error: "executor timed out",
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "executor",
    resume_generation: 1,
    failure_class: "transport_failure",
    last_error: "executor timed out",
    attempts_used: 4,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-POISON-QUAR-001" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-POISON-QUAR-001",
    title: "Poison quarantine test",
    backlog_item_id: "IDEA-POISON-QUAR-001",
    objective: "Repeated executor failures should quarantine the run",
    hypothesis: "Poisoned runs should escalate from cooldown to quarantine.",
    strategy_rationale: "Synthetic poisoned-run quarantine test.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Quarantine test" },
    source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Quarantine test" },
    scope_selection_rationale: "Synthetic quarantine fixture.",
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: ["factory/runs/RUN-POISON-QUAR-001/execution-result.json"],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Poison quarantine gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  const duplicateSessionTransport = {
    init: async () => ({}),
    createSession: async () => ({ sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-poison" }),
    callAgent: async (_agent, _promptText, options = {}) => {
      await options.onSessionCreated?.({ sessionId: "dup-session", sessionUrl: "http://localhost/session/dup-session" });
      const error = new Error("executor transport request failed before response was received.");
      error.rf_failure_class = "transport_failure";
      error.rf_transport_phase = "request";
      throw error;
    },
    close: async () => {}
  };

  await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    poisonedRunPolicy: { cooldownStreak: 3, quarantineStreak: 5, cooldownMs: 60000, quarantineMs: 120000 },
    liveTransport: duplicateSessionTransport
  });

  const backlogItem = backlogStore.read().find((item) => item.id === "IDEA-POISON-QUAR-001");
  const health = rebuildHealthMetrics(paths);
  assert.equal(backlogItem.status, "infra_quarantined");
  assert.equal(typeof backlogItem.quarantine_until, "string");
  assert.equal(health.quarantined_run_count, 1);
});

test("poisoned run escalates to quarantine from cumulative same-stage attempts", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-POISON-ATTEMPTS-001";

  backlogStore.append([{
    id: "IDEA-POISON-ATTEMPTS-001",
    title: "Executor attempts should quarantine run",
    objective: "Cumulative executor attempts should stop infinite same-item resumes",
    priority: 90,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "executor",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-POISON-ATTEMPTS-001",
    owner_id: null,
    run_instance_id: runId,
    resume_generation: 3,
    current_stage: "executor",
    current_stage_attempt: 9,
    current_stage_session: null,
    last_completed_stage: "planner",
    poison_streak_count: 2,
    poison_stage: "executor",
    poison_failure_class: "transport_failure",
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "failed", updated_at: "2026-03-24T00:00:00.000Z", attempt: 9, failure_class: "transport_failure" },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 9, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    last_error: "executor timed out repeatedly",
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    schema_version: "handoff_v2",
    resume_from_stage: "executor",
    resume_generation: 3,
    failure_class: "transport_failure",
    last_error: "executor timed out repeatedly",
    attempts_used: 9,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-POISON-ATTEMPTS-001" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), JSON.stringify({
    experiment_id: "EXP-POISON-ATTEMPTS-001",
    title: "Poison attempt cap test",
    backlog_item_id: "IDEA-POISON-ATTEMPTS-001",
    objective: "Repeated executor attempts should quarantine the run.",
    hypothesis: "Attempt caps should stop same-item infinite retry loops.",
    strategy_rationale: "Synthetic attempt-threshold quarantine test.",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h",
    priority: 100,
    dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
    historical_depth_requirement: { target: "Demo", justification: "Attempt cap test" },
    source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Attempt cap test" },
    scope_selection_rationale: "Synthetic attempt cap fixture.",
    data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
    inputs: [],
    implementation_steps: [],
    commands: [],
    expected_artifacts: ["factory/runs/RUN-POISON-ATTEMPTS-001/execution-result.json"],
    advanced_wfa_config: {},
    evaluation_criteria: { status_gate: "Poison attempt cap gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
    fallback_if_blocked: [],
    notes: []
  }, null, 2));

  const failingTransport = {
    init: async () => ({}),
    createSession: async ({ agent, attempt } = {}) => ({ sessionId: `${agent}-${attempt}`, sessionUrl: `http://localhost/session/${agent}-${attempt}` }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-attempts" }),
    callAgent: async (_agent, _promptText, options = {}) => {
      await options.onSessionCreated?.({ sessionId: `executor-${options.attempt || 1}`, sessionUrl: `http://localhost/session/executor-${options.attempt || 1}` });
      const error = new Error("executor transport request timed out waiting for response headers.");
      error.rf_failure_class = "transport_failure";
      error.rf_transport_phase = "first_headers";
      error.rf_retryable = true;
      throw error;
    },
    close: async () => {}
  };

  await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    poisonedRunPolicy: { cooldownStreak: 99, quarantineStreak: 99, cooldownAttempts: 6, quarantineAttempts: 9, cooldownMs: 60000, quarantineMs: 120000 },
    liveTransport: failingTransport
  });

  const backlogItem = backlogStore.read().find((item) => item.id === "IDEA-POISON-ATTEMPTS-001");
  assert.equal(backlogItem.status, "infra_quarantined");
  assert.equal(typeof backlogItem.quarantine_until, "string");
});

test("live run opens the stable follow URL only once per run", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const opened = [];

  backlogStore.append([{
    id: "IDEA-BROWSER-001",
    title: "Open follow URL once",
    objective: "Browser should open the stable observer URL once per run",
    priority: 90,
    status: "ready",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const duplicateSessionTransport = {
    init: async () => ({}),
    createSession: async ({ agent, attempt } = {}) => ({
      sessionId: `${agent || 'unknown'}-session-${attempt || 1}`,
      sessionUrl: `http://localhost/session/${agent || 'unknown'}-session-${attempt || 1}`
    }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-browser" }),
    callAgent: async (agent, _promptText, options = {}) => {
      const sessionId = `${agent || 'unknown'}-session-${options.attempt || 1}`;
      const sessionUrl = `http://localhost/session/${sessionId}`;
      await options.onSessionCreated?.({ sessionId, sessionUrl });
      if (agent === "planner") {
        const body = {
          experiment_id: "EXP-BROWSER-001",
          title: "Open follow URL once",
          backlog_item_id: "IDEA-BROWSER-001",
          objective: "Browser should open once",
          hypothesis: "Observer URL should open once per run.",
          strategy_rationale: "Synthetic browser-open test.",
          strategy_type: "momentum",
          market_family: "crypto",
          instrument_scope: "BTC/USDT",
          timeframe: "1h",
          priority: 100,
          dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
          historical_depth_requirement: { target: "Demo", justification: "Browser test" },
          source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Browser test" },
          scope_selection_rationale: "Synthetic browser-open fixture.",
          data_acquisition: { status: "present", reason: "Synthetic fixture confirms the dataset is already present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
          inputs: [],
          implementation_steps: [],
          commands: [],
          expected_artifacts: ["workspace/results/browser/report.json"],
          advanced_wfa_config: {},
          evaluation_criteria: { status_gate: "Browser gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
          fallback_if_blocked: [],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
      }
      if (agent === "executor") {
        const error = new Error("executor transport request failed before response was received.");
        error.rf_failure_class = "transport_failure";
        error.rf_transport_phase = "request";
        throw error;
      }
      return { text: "", raw: {}, sessionId, sessionUrl };
    },
    close: async () => {}
  };

  await runFactory({
    rootDir,
    mode: "live",
    cycles: 2,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: true,
    browserOpener: (url) => {
      opened.push(url);
      return { ok: true, command: "test" };
    },
    observerBaseUrl: "http://127.0.0.1:4310",
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    liveTransport: duplicateSessionTransport
  });

  assert.deepEqual(opened, ["http://127.0.0.1:4310/follow"]);
});

test("infra failure leaves backlog item infra_blocked instead of retiring it", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  const runId = "RUN-BROKEN-001";

  backlogStore.append([{
    id: "IDEA-BROKEN",
    title: "Broken resume context",
    objective: "Verify infra failure does not retire idea",
    priority: 80,
    status: "infra_blocked",
    current_run_id: runId,
    last_failure_class: "transport_failure",
    resume_from_stage: "executor"
  }]);

  const runDir = path.join(paths.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify({
    run_id: runId,
    backlog_item_id: "IDEA-BROKEN",
    stage_status: {
      planner: { status: "completed", updated_at: "2026-03-24T00:00:00.000Z" },
      executor: { status: "pending", updated_at: null },
      evaluator: { status: "pending", updated_at: null },
      summarizer: { status: "pending", updated_at: null }
    },
    failure_class: "transport_failure",
    resume_from_stage: "executor",
    attempt_counts: { planner: 1, executor: 0, evaluator: 0, summarizer: 0 },
    artifact_paths: {},
    handoff_pending: true,
    updated_at: "2026-03-24T00:00:00.000Z"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "handoff.json"), JSON.stringify({
    resume_from_stage: "executor",
    failure_class: "transport_failure",
    last_error: "executor timed out",
    attempts_used: 3,
    safe_inputs: { run_id: runId, backlog_item_id: "IDEA-BROKEN" },
    produced_artifacts: [],
    consumed: false
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "experiment-plan.json"), "{ not valid json\n", "utf8");

  await assert.rejects(
    runFactory({
      rootDir,
      mode: "simulate",
      cycles: 1,
      intervalMs: 1,
      maxRetries: 3,
      agentTimeoutMs: 0,
      openBrowser: false
    })
  );

  const updatedBacklog = backlogStore.read().find((entry) => entry.id === "IDEA-BROKEN");
  const updatedRunState = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));

  assert.equal(updatedBacklog.status, "infra_blocked");
  assert.equal(updatedBacklog.resume_from_stage, "executor");
  assert.equal(updatedRunState.handoff_pending, true);
  assert.equal(updatedRunState.resume_from_stage, "executor");
});

test("memory rebuild normalizes malformed lessons and evidence into retrieval index", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);

  fs.writeFileSync(paths.evidenceIndex, JSON.stringify([
    {
      run_id: "RUN-LIVE-1",
      mode: "live",
      evidence_kind: "research_wfa",
      authority_layer: "python_research",
      candidate_id: "CAND-MEMORY-001",
      candidate_stage: "research",
      artifact_manifest_path: "factory/runs/RUN-LIVE-1/artifact_manifest.json",
      backlog_item_id: "IDEA-LIVE-1",
      experiment_id: "EXP-LIVE-1",
      verdict: "passed",
      evidence_score: 60,
      metrics: { sharpe: 0.8, trades: 42 },
      summary_path: "factory/summaries/RUN-LIVE-1.md",
      recorded_at: "2026-03-24T10:00:00.000Z"
    },
    {
      run_id: "RUN-SIM-1",
      mode: "simulate",
      backlog_item_id: "IDEA-SIM-1",
      experiment_id: "EXP-SIM-1",
      verdict: "inconclusive",
      evidence_score: 25,
      metrics: { sharpe: null, trades: null },
      summary_path: "factory/summaries/RUN-SIM-1.md",
      recorded_at: "2026-03-24T11:00:00.000Z"
    }
  ], null, 2));

  const malformedLessons = [
    JSON.stringify({
      ts: "2026-03-24T10:00:00.000Z",
      run_id: "RUN-LIVE-1",
      experiment_id: "EXP-LIVE-1",
      verdict: "passed",
      lessons: [
        "Planner lesson about BTC momentum scope.",
        "Executor blocker: pandas missing in WSL environment."
      ],
      next_actions: ["Try ETHUSDT", "Pin Python environment"],
      mode: "live",
      timeframe: "1h",
      asset: "BTCUSDT",
      strategy_type: "momentum"
    }),
    `${JSON.stringify({
      ts: "2026-03-24T11:00:00.000Z",
      run_id: "RUN-SIM-1",
      experiment_id: "EXP-SIM-1",
      verdict: "inconclusive",
      lessons: ["Simulation remains non-evidentiary."],
      next_actions: ["Use live mode"],
      mode: "simulate"
    })}${JSON.stringify({
      schema_version: "lesson_v1",
      lesson_id: "RUN-LIVE-2:1",
      ts: "2026-03-24T12:00:00.000Z",
      run_id: "RUN-LIVE-2",
      experiment_id: "EXP-LIVE-2",
      backlog_item_id: "IDEA-LIVE-2",
      iteration: 1,
      mode: "live",
      verdict: "blocked",
      evidence_score: 30,
      strategy_family: "mean_reversion",
      market_family: "crypto",
      asset_scope: "ETHUSDT",
      timeframe: "4h",
      metrics: { sharpe_oos: -0.2, total_trades: 8, markets_tested: ["ETHUSDT"], extra_metrics: {} },
      lesson_text: "Config loader rejected min_required_bars override.",
      specific_finding: "The smoke test loader still used data.min_required_bars.",
      next_actions: ["Fix loader precedence"],
      related_artifact_paths: ["walk forward engine/strategies/test/wfa_config.yaml"],
      retrieval_text: "ETHUSDT 4h blocked config loader min_required_bars override"
    })}`
  ].join("\n") + "\n";
  fs.writeFileSync(paths.lessons, malformedLessons, "utf8");

  const result = rebuildNormalizedMemory(paths);
  const normalizedLessons = fs.readFileSync(paths.lessons, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const normalizedEvidence = JSON.parse(fs.readFileSync(paths.evidenceIndex, "utf8"));
  const retrievalIndex = JSON.parse(fs.readFileSync(paths.retrievalIndex, "utf8"));
  const quarantineFiles = fs.readdirSync(paths.memoryQuarantine);

  assert.equal(result.lessons.length, 4);
  assert.equal(normalizedLessons.every((entry) => entry.schema_version === "lesson_v1"), true);
  assert.equal(normalizedEvidence[0].schema_version, "evidence_v1");
  assert.equal(normalizedEvidence[0].evidence_kind, "research_wfa");
  assert.equal(normalizedEvidence[0].candidate_id, "CAND-MEMORY-001");
  assert.equal(normalizedEvidence[0].authority_layer, "python_research");
  assert.equal(normalizedEvidence[0].artifact_manifest_path, "factory/runs/RUN-LIVE-1/artifact_manifest.json");
  assert.equal(normalizedEvidence[0].promotable, false);
  assert.equal(normalizedEvidence[1].evidence_kind, "simulation");
  assert.equal(retrievalIndex.length >= 6, true);
  assert.equal(quarantineFiles.some((name) => name.startsWith("repair-report-")), true);
});

test("memory rebuild is idempotent for nested extra_metrics", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);

  fs.writeFileSync(paths.evidenceIndex, JSON.stringify([
    {
      run_id: "RUN-IDEMP-1",
      mode: "live",
      backlog_item_id: "IDEA-IDEMP-1",
      experiment_id: "EXP-IDEMP-1",
      verdict: "passed",
      evidence_score: 65,
      overall_score: 60,
      metrics: {
        sharpe_oos: 0.8,
        total_trades: 32,
        extra_metrics: {
          foo: 1,
          extra_metrics: {
            bar: 2,
            extra_metrics: {
              baz: 3
            }
          }
        }
      },
      summary_path: "factory/summaries/RUN-IDEMP-1.md",
      recorded_at: "2026-03-24T10:00:00.000Z"
    }
  ], null, 2));
  fs.writeFileSync(paths.lessons, `${JSON.stringify({
    ts: "2026-03-24T10:00:00.000Z",
    run_id: "RUN-IDEMP-1",
    experiment_id: "EXP-IDEMP-1",
    verdict: "passed",
    lessons: ["Idempotence lesson."],
    next_actions: ["Keep rebuild stable"],
    mode: "live"
  })}\n`, "utf8");

  rebuildNormalizedMemory(paths);
  const firstEvidence = JSON.parse(fs.readFileSync(paths.evidenceIndex, "utf8"));
  const firstRetrieval = JSON.parse(fs.readFileSync(paths.retrievalIndex, "utf8"));

  rebuildNormalizedMemory(paths);
  const secondEvidence = JSON.parse(fs.readFileSync(paths.evidenceIndex, "utf8"));
  const secondRetrieval = JSON.parse(fs.readFileSync(paths.retrievalIndex, "utf8"));

  assert.deepEqual(secondEvidence, firstEvidence);
  assert.deepEqual(secondRetrieval, firstRetrieval);
  assert.deepEqual(secondEvidence[0].metrics.extra_metrics, { foo: 1, bar: 2, baz: 3 });
});

test("memory rebuild preserves evidence scope metadata for retrieval ranking", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);

  fs.writeFileSync(paths.evidenceIndex, JSON.stringify([
    {
      run_id: "RUN-META-1",
      mode: "live",
      backlog_item_id: "IDEA-META-1",
      experiment_id: "EXP-META-1",
      strategy_family: "momentum",
      market_family: "crypto",
      asset_scope: "BTCUSDT",
      timeframe: "1h",
      verdict: "passed",
      evidence_score: 70,
      overall_score: 65,
      metrics: { sharpe_oos: 0.9, total_trades: 44 },
      summary_path: "factory/summaries/RUN-META-1.md",
      recorded_at: "2026-03-24T10:00:00.000Z"
    }
  ], null, 2));

  const rebuilt = rebuildNormalizedMemory(paths);
  const evidenceEntry = rebuilt.evidence[0];
  const retrievalEntry = rebuilt.retrievalIndex.find((entry) => entry.source_type === "evidence");

  assert.equal(evidenceEntry.market_family, "crypto");
  assert.equal(evidenceEntry.asset_scope, "BTCUSDT");
  assert.equal(evidenceEntry.timeframe, "1h");
  assert.equal(retrievalEntry.market_family, "crypto");
  assert.equal(retrievalEntry.asset_scope, "BTCUSDT");
  assert.equal(retrievalEntry.strategy_family, "momentum");
});

test("retrieval builders use derived stage-specific retrieval index", () => {
  const factoryStats = {
    retrievalIndex: [
      {
        source_type: "lesson",
        source_path: "factory/memory/lessons.jsonl",
        experiment_id: "EXP-PLAN-1",
        run_id: "RUN-PLAN-1",
        mode: "live",
        verdict: "passed",
        evidence_score: 70,
        strategy_family: "momentum",
        market_family: "crypto",
        asset_scope: "BTCUSDT",
        timeframe: "1h",
        stage_targets: ["planner"],
        related_artifact_paths: ["factory/summaries/RUN-PLAN-1.md"],
        retrieval_text: "BTCUSDT 1h momentum lesson with strong evidence",
        snippet: {
          lesson: "BTC momentum held up across 1h windows.",
          specific_finding: "Use explicit history scope.",
          metrics: { sharpe_oos: 0.7 }
        }
      },
      {
        source_type: "lesson",
        source_path: "factory/memory/lessons.jsonl",
        experiment_id: "EXP-EXEC-1",
        run_id: "RUN-EXEC-1",
        mode: "live",
        verdict: "blocked",
        evidence_score: 30,
        strategy_family: "momentum",
        market_family: "crypto",
        asset_scope: "BTCUSDT",
        timeframe: "1h",
        stage_targets: ["executor"],
        related_artifact_paths: ["walk forward engine/config/strategy_test.json"],
        retrieval_text: "BTCUSDT 1h executor blocker pandas timeout config issue",
        snippet: {
          lesson: "Pandas environment broke executor retries.",
          specific_finding: "Config path must be inspected first.",
          metrics: { sharpe_oos: null }
        }
      },
      {
        source_type: "evidence",
        source_path: "factory/evidence/index.json",
        experiment_id: "EXP-EVID-1",
        run_id: "RUN-EVID-1",
        mode: "live",
        verdict: "passed",
        evidence_score: 80,
        strategy_family: "momentum",
        market_family: "crypto",
        asset_scope: "BTCUSDT",
        timeframe: "1h",
        stage_targets: ["planner", "evaluator"],
        retrieval_text: "BTCUSDT 1h evidence prior experiment",
        snippet: {
          metrics: { sharpe_oos: 0.9 },
          summary_path: "factory/summaries/RUN-EVID-1.md",
          evidence_kind: "research",
          promotable: true,
          strategy_family: "momentum",
          market_family: "crypto",
          asset_scope: "BTCUSDT",
          timeframe: "1h"
        }
      },
      {
        source_type: "lesson",
        source_path: "factory/memory/lessons.jsonl",
        experiment_id: "EXP-PLAN-2",
        run_id: "RUN-PLAN-2",
        mode: "live",
        verdict: "passed",
        evidence_score: 68,
        strategy_family: "mean_reversion",
        market_family: "forex",
        asset_scope: "EURUSD",
        timeframe: "4h",
        stage_targets: ["planner"],
        related_artifact_paths: ["factory/summaries/RUN-PLAN-2.md"],
        retrieval_text: "BTC momentum lexical overlap but wrong market family and scope",
        snippet: {
          lesson: "Lexically similar but wrong scope.",
          specific_finding: "This should rank below the exact scope match.",
          metrics: { sharpe_oos: 0.8 }
        }
      }
    ]
  };

  const plannerRetrieval = buildPlannerRetrieval(factoryStats, {
    title: "BTC momentum retest",
    objective: "Plan BTCUSDT 1h momentum retest",
    market_family: "crypto",
    instrument_scope: "BTCUSDT",
    timeframe: "1h"
  });
  const executorRetrieval = buildExecutorRetrieval(factoryStats, {
    title: "BTC executor test",
    objective: "Run BTCUSDT momentum execution",
    hypothesis: "Executor should use blocker context",
    strategy_type: "momentum",
    dataset_requirements: ["workspace/data/btc.csv"],
    inputs: [],
    commands: [],
    expected_artifacts: []
  });

  assert.equal(plannerRetrieval.relevant_lessons.length >= 1, true);
  assert.equal(plannerRetrieval.comparable_promoted_runs.length, 1);
  assert.equal(plannerRetrieval.relevant_lessons[0].market_family, "crypto");
  assert.equal(executorRetrieval.relevant_execution_lessons.length >= 1, true);
  assert.equal(executorRetrieval.known_blocker_patterns[0].blocker_type, "python_environment");
  assert.equal(executorRetrieval.relevant_paths.includes("walk forward engine/config/strategy_test.json"), false);
  assert.equal(executorRetrieval.relevant_paths.includes("factory/summaries/RUN-PLAN-1.md"), true);
});

test("simulate run rebuilds canonical memory artifacts after append", () => {
  const cwd = path.resolve(process.cwd());
  const projectRoot = createTempRepoRoot();

  run(cwd, "src/cli.mjs", "run", "--mode", "simulate", "--cycles", "1", "--interval-ms", "1", "--root", projectRoot);

  const retrievalIndex = JSON.parse(fs.readFileSync(path.join(projectRoot, "factory/memory/retrieval_index.json"), "utf8"));
  const lessons = fs.readFileSync(path.join(projectRoot, "factory/memory/lessons.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const evidence = JSON.parse(fs.readFileSync(path.join(projectRoot, "factory/evidence/index.json"), "utf8"));

  assert.equal(retrievalIndex.length > 0, true);
  assert.equal(lessons.every((entry) => entry.schema_version === "lesson_v1"), true);
  assert.equal(evidence.every((entry) => entry.schema_version === "evidence_v1"), true);
});

test("memory rebuild purges simulate and inconclusive leaderboard pollution", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);

  fs.writeFileSync(paths.evidenceIndex, JSON.stringify([
    {
      run_id: "RUN-LIVE-PROMO",
      mode: "live",
      backlog_item_id: "IDEA-LIVE-PROMO",
      experiment_id: "EXP-LIVE-PROMO",
      verdict: "passed",
      evidence_score: 70,
      overall_score: 65,
      metrics: { sharpe_oos: 0.9, annualized_return_pct: 7.2, total_trades: 64, windows_completed: 6, max_drawdown: -10 },
      summary_path: "factory/summaries/RUN-LIVE-PROMO.md",
      recorded_at: "2026-03-24T10:00:00.000Z"
    },
    {
      run_id: "RUN-SIM-BAD",
      mode: "simulate",
      backlog_item_id: "IDEA-SIM-BAD",
      experiment_id: "EXP-SIM-BAD",
      verdict: "inconclusive",
      evidence_score: 99,
      overall_score: 99,
      metrics: { sharpe_oos: 9.9, total_trades: 999 },
      summary_path: "factory/summaries/RUN-SIM-BAD.md",
      recorded_at: "2026-03-24T11:00:00.000Z"
    },
    {
      run_id: "RUN-LIVE-WEAK",
      mode: "live",
      backlog_item_id: "IDEA-LIVE-WEAK",
      experiment_id: "EXP-LIVE-WEAK",
      verdict: "passed",
      evidence_score: 45,
      overall_score: 70,
      metrics: { sharpe_oos: 0.4, total_trades: 8 },
      summary_path: "factory/summaries/RUN-LIVE-WEAK.md",
      recorded_at: "2026-03-24T12:00:00.000Z"
    }
  ], null, 2));
  fs.writeFileSync(paths.leaderboard, JSON.stringify([
    { run_id: "RUN-SIM-BAD", mode: "simulate", verdict: "inconclusive", evidence_score: 99 },
    { run_id: "RUN-LIVE-WEAK", mode: "live", verdict: "inconclusive", evidence_score: 80 }
  ], null, 2));

  const result = rebuildNormalizedMemory(paths);
  const normalizedEvidence = JSON.parse(fs.readFileSync(paths.evidenceIndex, "utf8"));
  const leaderboard = JSON.parse(fs.readFileSync(paths.leaderboard, "utf8"));

  assert.equal(result.leaderboard.length, 1);
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].run_id, "RUN-LIVE-PROMO");
  assert.equal(leaderboard[0].schema_version, "leaderboard_v1");
  assert.equal(leaderboard[0].promotable, true);
  assert.equal(normalizedEvidence.find((entry) => entry.run_id === "RUN-LIVE-WEAK").promotable, false);
});

test("runFactory startup and append keep leaderboard free of simulate pollution", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);

  fs.writeFileSync(paths.evidenceIndex, JSON.stringify([
    {
      run_id: "RUN-LIVE-KEEP",
      mode: "live",
      backlog_item_id: "IDEA-LIVE-KEEP",
      experiment_id: "EXP-LIVE-KEEP",
      verdict: "passed",
      evidence_score: 75,
      overall_score: 70,
      metrics: { sharpe_oos: 1.1, annualized_return_pct: 8.4, total_trades: 88, windows_completed: 7, max_drawdown: -12 },
      summary_path: "factory/summaries/RUN-LIVE-KEEP.md",
      recorded_at: "2026-03-24T09:00:00.000Z"
    }
  ], null, 2));
  fs.writeFileSync(paths.leaderboard, JSON.stringify([
    { run_id: "RUN-SIM-POLLUTED", mode: "simulate", verdict: "inconclusive", evidence_score: 100 }
  ], null, 2));

  await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const leaderboard = JSON.parse(fs.readFileSync(paths.leaderboard, "utf8"));

  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].run_id, "RUN-LIVE-KEEP");
  assert.equal(leaderboard.every((entry) => entry.mode === "live"), true);
});

test("initializeProject seeds operator-visible market policy", () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  const paths = initializeProject(rootDir);
  const marketPolicy = readMarketPolicy(paths);

  assert.equal(fs.existsSync(paths.marketPolicy), true);
  assert.equal(fs.existsSync(paths.artifacts), true);
  assert.equal(fs.existsSync(paths.artifactIndex), true);
  assert.equal(fs.existsSync(paths.mt5Environment), true);
  assert.equal(fs.existsSync(paths.mt5Bridge), true);
  assert.equal(marketPolicy.schema_version, "market_policy_v1");
  assert.deepEqual(
    marketPolicy.market_family_priorities.map((entry) => entry.market_family),
    ["mt5_verified", "forex", "indices", "metals", "commodities", "equities", "crypto"]
  );
});

test("ideator and planner prompts include compact market policy context", () => {
  const marketPolicy = {
    schema_version: "market_policy_v1",
    updated_at: "2026-03-25T08:20:00.000Z",
    market_family_priorities: [{ market_family: "crypto", priority: 1 }],
    allowed_source_families: { crypto: ["binance"] },
    default_history_rules_by_market_family: {
      crypto: { expectation: "multi-year when realistically available", short_window_requires_explicit_justification: true }
    },
    exclusions: []
  };

  const ideator = ideatorPrompt({
    state: { iteration: 3 },
    factoryStats: { lessons: [], evidence: [], leaderboard: [], marketPolicy, totalRuns: 0 },
    retrieval: null
  });
  const planner = plannerPrompt({
    goal: "Test explicit scope planning",
    backlogItem: { id: "IDEA-1", title: "BTC momentum", objective: "Plan BTC momentum", market_family: "crypto" },
    state: { iteration: 4, market_policy: marketPolicy },
    retrieval: null
  });

  assert.match(ideator, /## Market Policy/);
  assert.match(ideator, /factory\/market-policy\.json/);
  assert.match(planner, /## Required Plan Fields/);
  assert.match(planner, /market_family/);
  assert.match(planner, /## Market Policy/);
  assert.match(planner, /factory\/market-policy\.json/);
  assert.match(planner, /walk forward engine\/strategies\/\*\/wfa_config\.yaml/);
  assert.match(planner, /walk forward engine\/config\/strategy_\*\.json/);
});

test("evaluator prompt requires artifact-path-only verification sources", () => {
  const prompt = evaluatorPrompt({
    goal: "Evaluate evidence strictly",
    plan: {
      experiment_id: "EXP-1",
      objective: "Check evaluator output contract",
      expected_artifacts: ["factory/runs/RUN-1/execution-result.json"],
      evaluation_criteria: { min_evidence_score: 70 }
    },
    executionResult: {
      experiment_id: "EXP-1",
      status: "executed",
      artifacts_created: ["walk forward engine/results/demo.json"],
      metrics_observed: { sharpe_oos: 0.5 }
    },
    changedFiles: [],
    state: { iteration: 1 },
    retrieval: null
  });

  assert.match(prompt, /metrics_verified_from/);
  assert.match(prompt, /Do not append metric names, JSON keys, line numbers, or values/i);
  assert.match(prompt, /repo-relative artifact paths that currently exist on disk/i);
  assert.match(prompt, /operational canary accepted/i);
  assert.match(prompt, /low-return, low-window, low-trade/i);
  assert.match(prompt, /validation gates, not optimization targets/i);
  assert.match(prompt, /low_frequency_registration_v1/i);
  assert.match(prompt, />= 200 minimum/i);
});

test("executor prompt emphasizes action-first execution discipline", () => {
  const prompt = executorPrompt({
    goal: "Execute a canonical WFA run",
    plan: {
      experiment_id: "EXP-1",
      title: "Existing config execution",
      objective: "Run the existing WFA config directly.",
      commands: ["cd \"walk forward engine\" && .venv/Scripts/python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml"],
      inputs: ["walk forward engine/strategies/demo/wfa_config.yaml"],
      data_acquisition: { expected_outputs: [], sources: ["workspace/data/demo.csv"] }
    },
    state: { iteration: 1 },
    retrieval: null
  });

  assert.match(prompt, /Execution Discipline/);
  assert.match(prompt, /use the provided command path immediately/i);
  assert.match(prompt, /Inspect only the exact files listed below/i);
});

test("executor prompt includes compact spec policy capsule for mt5_snapshot", () => {
  const prompt = executorPrompt({
    goal: "Represent MT5 snapshot evidence",
    plan: {
      experiment_id: "EXP-MT5-SNAPSHOT-1",
      title: "MT5 snapshot schema proof",
      objective: "Represent MT5 snapshot evidence without fake WFA metrics.",
      evidence_kind: "mt5_snapshot",
      authority_layer: "mt5_terminal",
      expected_artifacts: ["factory/mt5/environment/snapshot.json"],
      inputs: []
    },
    state: { iteration: 1 },
    retrieval: null
  });

  assert.match(prompt, /## Spec Policy Capsule/);
  assert.match(prompt, /factory\/mt5-ftmo-strategy-factory-spec\.md/);
  assert.match(prompt, /"spec_sha256":\s*"[a-f0-9]{64}"/);
  assert.match(prompt, /"evidence_kind":\s*"mt5_snapshot"/);
  assert.match(prompt, /factory\/mt5\//);
  assert.match(prompt, /factory\/artifacts\//);
  assert.match(prompt, /Do not invent WFA metrics/i);
  assert.match(prompt, /coding_work_invariant/);
  assert.match(prompt, /Context7 current docs/i);
  assert.match(prompt, /resolve-library-id/);
  assert.match(prompt, /query-docs/);
  assert.doesNotMatch(prompt, /## 1\. Document Status/);
});

test("executor prompt includes compact spec policy capsule for mt5_tradable_universe_snapshot", () => {
  const prompt = executorPrompt({
    goal: "Enumerate MT5 tradable universe evidence",
    plan: {
      experiment_id: "EXP-MT5-UNIVERSE-1",
      title: "MT5 tradable universe schema proof",
      objective: "Represent MT5 universe evidence without fake WFA metrics.",
      evidence_kind: "mt5_tradable_universe_snapshot",
      authority_layer: "mt5_terminal",
      expected_artifacts: ["factory/mt5/environment/universe-snapshot.json"],
      inputs: []
    },
    state: { iteration: 1 },
    retrieval: null
  });

  assert.match(prompt, /## Spec Policy Capsule/);
  assert.match(prompt, /"evidence_kind":\s*"mt5_tradable_universe_snapshot"/);
  assert.match(prompt, /exact symbol names\/specs/i);
  assert.match(prompt, /explicit filter or no-filter/i);
  assert.match(prompt, /do not persist passwords/i);
  assert.doesNotMatch(prompt, /## 1\. Document Status/);
});

test("evaluator follow-up actions append only live-eligible backlog items", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  fs.mkdirSync(path.join(rootDir, "walk forward engine", "strategies", "demo"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "walk forward engine", "strategies", "demo", "wfa_config.yaml"), "demo: true\n", "utf8");

  backlogStore.append([{
    id: "IDEA-ACTION-FILTER-001",
    title: "Seed executed run",
    objective: "Complete one run and emit follow-up backlog actions",
    priority: 90,
    status: "ready",
    category: "strategy",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const selected = { backlogId: null };
  const transport = {
    init: async () => ({}),
    createSession: async ({ agent, attempt } = {}) => ({ sessionId: `${agent}-${attempt}`, sessionUrl: `http://localhost/session/${agent}-${attempt}` }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-followup-filter" }),
    callAgent: async (agent, promptText, options = {}) => {
      await options.onSessionCreated?.({ sessionId: `${agent}-${options.attempt || 1}`, sessionUrl: `http://localhost/session/${agent}-${options.attempt || 1}` });
      const backlogId = promptText.match(/"id":\s*"([^"]+)"/)?.[1] || "IDEA-ACTION-FILTER-001";
      selected.backlogId = backlogId;
      if (agent === "planner") {
        const body = {
          experiment_id: "EXP-ACTION-FILTER-001",
          title: "Valid follow-up append test",
          backlog_item_id: backlogId,
          objective: "Run one valid WFA-backed cycle.",
          hypothesis: "Valid experiments should still append bounded follow-up backlog items.",
          strategy_rationale: "Synthetic append filter test.",
          strategy_type: "momentum",
          market_family: "crypto",
          instrument_scope: "BTC/USDT",
          timeframe: "1h",
          priority: 90,
          dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
          historical_depth_requirement: { target: "Demo", justification: "Synthetic append filter fixture." },
          source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic fixture." },
          scope_selection_rationale: "Synthetic append filter scope.",
          data_acquisition: { status: "present", reason: "Synthetic fixture confirms data is present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
          inputs: ["walk forward engine/strategies/demo/wfa_config.yaml"],
          implementation_steps: ["Run the demo WFA config"],
          commands: ["cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml"],
          expected_artifacts: ["factory/runs/RUN-ACTION-FILTER/execution-result.json"],
          advanced_wfa_config: {},
          evaluation_criteria: { status_gate: "Synthetic append filter gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
          fallback_if_blocked: [],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      if (agent === "executor") {
        const artifact = path.join(rootDir, "workspace", "results", "append-filter", "report.json");
        fs.mkdirSync(path.dirname(artifact), { recursive: true });
        fs.writeFileSync(artifact, JSON.stringify({ sharpe_oos: 0.7, total_trades: 40, max_drawdown: -10 }, null, 2) + "\n", "utf8");
        const body = {
          experiment_id: "EXP-ACTION-FILTER-001",
          status: "partial",
          commands_attempted: ["run wfa"],
          commands_completed: ["run wfa"],
          artifacts_created: ["workspace/results/append-filter/report.json"],
          datasets_acquired: [],
          artifacts_updated: [],
          workspace_changes: ["Created append filter artifact"],
          metrics_observed: { sharpe_oos: 0.7, total_trades: 40, max_drawdown: -10 },
          provenance: {
            engine: "walk_forward_engine",
            command: "cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
            working_directory: "walk forward engine",
            config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
            result_artifacts: ["workspace/results/append-filter/report.json"],
            windows_completed: 5
          },
          variants_tested: [],
          blockers: ["Synthetic transport fixture does not produce Phase 7A worker-launched WFA evidence."],
          errors: [{ command: "synthetic_executor_fixture", message: "No research_wfa_run worker was launched in this follow-up filtering test." }],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      if (agent === "evaluator") {
        const body = {
          experiment_id: "EXP-ACTION-FILTER-001",
          verdict: "inconclusive",
          evidence_score: 75,
          performance_score: 70,
          robustness_score: 70,
          novelty_score: 60,
          overall_score: 69,
          metrics: { sharpe_oos: 0.7, total_trades: 40 },
          red_flags: [],
          verification: { artifacts_checked: ["workspace/results/append-filter/report.json"], metrics_verified_from: ["workspace/results/append-filter/report.json"], missing_or_unverified: [] },
          strengths: [],
          weaknesses: [],
          missing_evidence: [],
          promote_to_leaderboard: false,
          leaderboard_tier: "experimental",
          next_backlog_actions: [
            "Test discovered parameters on additional BNB data to verify robustness",
            "Verify WFR calculation is possible from window results if needed for future evaluations"
          ],
          confidence_level: "medium",
          confidence_rationale: "Synthetic append filter test remains below strategy-quality floors."
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      const body = {
        experiment_id: "EXP-ACTION-FILTER-001",
        backlog_item_id: backlogId,
        summary: "Synthetic append filter summary.",
        key_lessons: [{ lesson: "Valid follow-up retained.", specific_finding: "Meta-analysis follow-up suppressed.", result: { sharpe_oos: 0.7, trades: 40 } }],
        next_actions: [{ action: "Test discovered parameters on additional BNB data to verify robustness", rationale: "Valid experimental follow-up remains actionable.", priority: "low" }]
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
    },
    close: async () => {}
  };

  await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    liveTransport: transport
  });

  const titles = backlogStore.read().map((item) => item.title);
  assert.equal(titles.includes("Test discovered parameters on additional BNB data to verify robustness"), true);
  assert.equal(titles.includes("Verify WFR calculation is possible from window results if needed for future evaluations"), false);
});

test("repeated artifact-backed failures produce one bounded remediation action", () => {
  const backlogItem = {
    id: "IDEA-REPEATED-FAILURE-001",
    title: "Repeated WFA failure seed",
    objective: "Repeated artifact-backed WFA failures should create bounded remediation only.",
    priority: 80,
    category: "strategy",
    market_family: "crypto",
    instrument_scope: "BTCUSD",
    timeframe: "H1"
  };
  const factoryStats = {
    lessons: [
      { mode: "live", verdict: "inconclusive", market_family: "crypto", asset_scope: "BTCUSD", timeframe: "H1", summary_path: "factory/summaries/RUN-OLD-1.md", artifact_paths: ["factory/runs/RUN-OLD-1/execution-result.json"] },
      { mode: "live", verdict: "blocked", market_family: "crypto", asset_scope: "BTCUSD", timeframe: "H1", summary_path: "factory/summaries/RUN-OLD-2.md", artifact_paths: ["factory/runs/RUN-OLD-2/execution-result.json"] }
    ]
  };
  const actions = buildRepeatedFailureRemediationActions({
    factoryStats,
    backlogItem,
    currentRunId: "RUN-REMEDIATION-CURRENT",
    executionResult: { artifacts_created: ["factory/runs/RUN-REMEDIATION-CURRENT/execution-result.json"] },
    evaluation: { verdict: "inconclusive", verification: { artifacts_checked: ["factory/runs/RUN-REMEDIATION-CURRENT/execution-result.json"] } }
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].category, "remediation");
  assert.equal(actions[0].status, "ready");
  assert.equal(actions[0].repeated_failure_count, 3);
  assert.equal(actions[0].remediation_key, "remediate:crypto:BTCUSD:H1:strategy");

  assert.deepEqual(buildRepeatedFailureRemediationActions({
    factoryStats,
    backlogItem,
    currentRunId: "RUN-NO-ARTIFACTS",
    executionResult: {},
    evaluation: { verdict: "inconclusive", verification: { artifacts_checked: [] } }
  }), []);
});

test("repeated failure remediation avoids cascades and generic unknown-scope spam", () => {
  const factoryStats = {
    lessons: [
      { mode: "live", verdict: "failed", market_family: "unknown", asset_scope: "unknown", timeframe: "H1", summary_path: "factory/summaries/RUN-OLD-1.md" },
      { mode: "live", verdict: "blocked", market_family: "unknown", asset_scope: "unknown", timeframe: "M15", artifact_paths: ["factory/runs/RUN-OLD-2/execution-result.json"] },
      { mode: "live", verdict: "inconclusive", market_family: "crypto", asset_scope: "ETHUSD", timeframe: "H1", summary_path: "factory/summaries/RUN-OLD-3.md" }
    ]
  };
  const evidence = {
    executionResult: { artifacts_created: ["factory/runs/RUN-CURRENT/execution-result.json"] },
    evaluation: { verdict: "failed", verification: { artifacts_checked: ["factory/runs/RUN-CURRENT/execution-result.json"] } }
  };

  assert.deepEqual(buildRepeatedFailureRemediationActions({
    factoryStats,
    currentRunId: "RUN-CURRENT",
    backlogItem: {
      id: "IDEA-UNKNOWN-SCOPE",
      title: "Generic unknown-scope failure",
      category: "strategy",
      market_family: "unknown",
      instrument_scope: "unknown",
      timeframe: "H1"
    },
    ...evidence
  }), []);

  assert.deepEqual(buildRepeatedFailureRemediationActions({
    factoryStats,
    currentRunId: "RUN-CURRENT",
    backlogItem: {
      id: "IDEA-REMEDIATION-CASCADE",
      title: "Existing remediation item",
      category: "remediation",
      remediation_key: "remediate:crypto:ETHUSD:H1:strategy",
      market_family: "crypto",
      instrument_scope: "ETHUSD",
      timeframe: "H1"
    },
    ...evidence
  }), []);
});

test("live backlog selection skips meta-analysis follow-up items", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);
  fs.mkdirSync(path.join(rootDir, "walk forward engine", "strategies", "demo"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "walk forward engine", "strategies", "demo", "wfa_config.yaml"), "demo: true\n", "utf8");

  backlogStore.append([
    {
      id: "IDEA-META-001",
      title: "Verify WFR calculation is possible from window results if needed for future evaluations",
      objective: "Verify WFR calculation is possible from window results if needed for future evaluations",
      priority: 90,
      status: "ready",
      category: "followup"
    },
    {
      id: "IDEA-VALID-001",
      title: "Test discovered parameters on additional BNB data to verify robustness",
      objective: "Test discovered parameters on additional BNB data to verify robustness",
      priority: 65,
      status: "ready",
      category: "followup",
      market_family: "crypto",
      instrument_scope: "BNB/USDT",
      timeframe: "1h"
    }
  ]);

  const selected = { backlogId: null };
  const transport = {
    init: async () => ({}),
    createSession: async ({ agent, attempt } = {}) => ({ sessionId: `${agent}-${attempt}`, sessionUrl: `http://localhost/session/${agent}-${attempt}` }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-selection-filter" }),
    callAgent: async (agent, promptText, options = {}) => {
      await options.onSessionCreated?.({ sessionId: `${agent}-${options.attempt || 1}`, sessionUrl: `http://localhost/session/${agent}-${options.attempt || 1}` });
      const backlogId = promptText.match(/"id":\s*"([^"]+)"/)?.[1] || "IDEA-VALID-001";
      selected.backlogId = backlogId;
      if (agent === "planner") {
        const body = {
          experiment_id: "EXP-SELECTION-FILTER-001",
          title: "Valid selected follow-up",
          backlog_item_id: backlogId,
          objective: "Run the valid selected follow-up.",
          hypothesis: "Live selection should skip meta-analysis items.",
          strategy_rationale: "Synthetic selection filter test.",
          strategy_type: "momentum",
          market_family: "crypto",
          instrument_scope: "BNB/USDT",
          timeframe: "1h",
          priority: 65,
          dataset_requirements: ["workspace/data/demo_ohlcv.csv"],
          historical_depth_requirement: { target: "Demo", justification: "Synthetic selection filter fixture." },
          source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic fixture." },
          scope_selection_rationale: "Synthetic selection filter scope.",
          data_acquisition: { status: "present", reason: "Synthetic fixture confirms data is present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo_ohlcv.csv"] },
          inputs: ["walk forward engine/strategies/demo/wfa_config.yaml"],
          implementation_steps: ["Run the demo WFA config"],
          commands: ["cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml"],
          expected_artifacts: ["factory/runs/RUN-SELECTION-FILTER/execution-result.json"],
          advanced_wfa_config: {},
          evaluation_criteria: { status_gate: "Synthetic selection filter gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
          fallback_if_blocked: [],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      if (agent === "executor") {
        const artifact = path.join(rootDir, "workspace", "results", "selection-filter", "report.json");
        fs.mkdirSync(path.dirname(artifact), { recursive: true });
        fs.writeFileSync(artifact, JSON.stringify({ sharpe_oos: 0.6, total_trades: 30, max_drawdown: -9 }, null, 2) + "\n", "utf8");
        const body = {
          experiment_id: "EXP-SELECTION-FILTER-001",
          status: "partial",
          commands_attempted: ["run wfa"],
          commands_completed: ["run wfa"],
          artifacts_created: ["workspace/results/selection-filter/report.json"],
          datasets_acquired: [],
          artifacts_updated: [],
          workspace_changes: ["Created selection filter artifact"],
          metrics_observed: { sharpe_oos: 0.6, total_trades: 30, max_drawdown: -9 },
          provenance: {
            engine: "walk_forward_engine",
            command: "cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
            working_directory: "walk forward engine",
            config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
            result_artifacts: ["workspace/results/selection-filter/report.json"],
            windows_completed: 3
          },
          variants_tested: [],
          blockers: ["Synthetic transport fixture does not produce Phase 7A worker-launched WFA evidence."],
          errors: [{ command: "synthetic_executor_fixture", message: "No research_wfa_run worker was launched in this backlog selection test." }],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      if (agent === "evaluator") {
        const body = {
          experiment_id: "EXP-SELECTION-FILTER-001",
          verdict: "inconclusive",
          evidence_score: 50,
          performance_score: 50,
          robustness_score: 50,
          novelty_score: 50,
          overall_score: 50,
          metrics: { sharpe_oos: 0.6, total_trades: 30 },
          red_flags: [],
          verification: { artifacts_checked: ["workspace/results/selection-filter/report.json"], metrics_verified_from: ["workspace/results/selection-filter/report.json"], missing_or_unverified: [] },
          strengths: [],
          weaknesses: [],
          missing_evidence: [],
          promote_to_leaderboard: false,
          leaderboard_tier: "experimental",
          next_backlog_actions: [],
          confidence_level: "medium",
          confidence_rationale: "Synthetic selection filter test."
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      const body = {
        experiment_id: "EXP-SELECTION-FILTER-001",
        backlog_item_id: backlogId,
        summary: "Synthetic selection filter summary.",
        key_lessons: [{ lesson: "Valid follow-up selected.", specific_finding: "Meta-analysis follow-up skipped.", result: { sharpe_oos: 0.6, trades: 30 } }],
        next_actions: [{ action: "Test discovered parameters on additional BNB data to verify robustness", rationale: "Valid experimental follow-up remains selected.", priority: "low" }]
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
    },
    close: async () => {}
  };

  await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    liveTransport: transport
  });

  assert.equal(selected.backlogId, "IDEA-VALID-001");
});

test("market policy normalization is the single source of selection defaults", () => {
  const normalized = normalizeMarketPolicy({
    schema_version: "market_policy_v1",
    selection_policy: {
      ranking_weights: {
        novelty_bonus: 9
      }
    }
  });

  assert.deepEqual(normalized.selection_policy.ready_statuses, ["ready"]);
  assert.equal(normalized.selection_policy.min_ready_backlog_depth, 3);
  assert.equal(normalized.selection_policy.minimum_trade_count_for_promotion, 20);
  assert.equal(normalized.selection_policy.ranking_weights.novelty_bonus, 9);
  assert.equal(normalized.selection_policy.ranking_weights.base_priority, 1);
});

test("runFactory replenishes backlog when ready depth falls below policy floor", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-LOW-DEPTH-1",
    title: "Existing ready strategy idea",
    objective: "Run one ready strategy while backlog is thin",
    priority: 80,
    status: "ready",
    category: "strategy",
    source: "manual",
    market_family: "crypto",
    instrument_scope: "BTCUSDT",
    timeframe: "1h"
  }]);

  await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const backlog = backlogStore.read();
  assert.equal(backlog.some((item) => item.source === "ideator"), true);
});

test("planner validator requires explicit scope fields", () => {
  assert.throws(
    () => validatePlannerResult({
      experiment_id: "EXP-1",
      title: "Incomplete plan",
      objective: "Missing explicit scope fields should fail.",
      hypothesis: "This should be rejected.",
      strategy_rationale: "Too incomplete for execution.",
      strategy_type: "momentum",
      timeframe: "1h",
      expected_artifacts: ["workspace/results/report.json"],
      evaluation_criteria: { status_gate: "report exists" }
    }),
    /market_family|instrument scope|historical depth|source plan/i
  );
});

test("evaluator validator blocks weak promotion attempts", () => {
  assert.throws(
    () => validateEvaluationResult({
      verdict: "passed",
      evidence_score: 40,
      overall_score: 35,
      metrics: { sharpe_oos: null, total_trades: 5 },
      red_flags: ["weak_evidence"],
      verification: { artifacts_checked: ["workspace/results/report.json"], metrics_verified_from: ["workspace/results/report.json"] },
      missing_evidence: ["Out-of-sample metrics"],
      promote_to_leaderboard: true,
      confidence_level: "medium",
      confidence_rationale: "The evaluator should not promote weak evidence."
    }, { mode: "live" }),
    /promotion|weak research evidence/i
  );
});

test("evaluator validator blocks promising labels for weak WFA samples", () => {
  assert.throws(
    () => validateEvaluationResult({
      verdict: "promising",
      evidence_score: 75,
      overall_score: 55,
      metrics: {
        sharpe_oos: 1.52,
        aggregate_return_pct: 1.4112,
        total_trades: 20,
        windows_completed: 3,
        positive_sharpe_windows_pct: 0.667
      },
      red_flags: ["low_return", "small_oos_sample"],
      verification: {
        artifacts_checked: ["walk forward engine/strategies/demo/results/walk_forward_results.json"],
        metrics_verified_from: ["walk forward engine/strategies/demo/results/walk_forward_results.json"]
      },
      missing_evidence: [],
      promote_to_leaderboard: false,
      confidence_level: "medium",
      confidence_rationale: "High Sharpe is not enough on a tiny low-return WFA sample."
    }, { mode: "live", evidenceKind: "research_wfa" }),
    /weak research evidence|Operational canary acceptance is separate/i
  );
});

test("evaluator validator allows promising labels with sufficient WFA quality", () => {
  assert.doesNotThrow(
    () => validateEvaluationResult({
      verdict: "promising",
      evidence_score: 80,
      overall_score: 70,
      metrics: {
        sharpe_oos: 1.1,
        annualized_return_pct: 8.5,
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
      confidence_rationale: "Return, trades, windows, and window consistency clear minimum floors."
    }, { mode: "live", evidenceKind: "research_wfa" })
  );
});

test("summarizer validator rejects unsupported archival fields", () => {
  assert.throws(
    () => validateSummaryResult({
      experiment_id: "EXP-1",
      backlog_item_id: "IDEA-1",
      summary: "A sufficiently detailed summary of the run.",
      key_lessons: [{ lesson: "Specific lesson text that is clearly useful." }],
      next_actions: [{ action: "Run the next verified experiment." }],
      archive_bundle: { extra: true }
    }),
    /unsupported fields/i
  );
});

test("summarizer validator requires run linkage fields", () => {
  assert.throws(
    () => validateSummaryResult({
      summary: "A sufficiently detailed summary of the run.",
      key_lessons: [{ lesson: "Specific lesson text that is clearly useful." }],
      next_actions: [{ action: "Run the next verified experiment." }]
    }),
    /linkage/i
  );
});

test("simulate run writes bounded health metrics artifact", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const paths = buildPaths(rootDir);
  const health = JSON.parse(fs.readFileSync(paths.health, "utf8"));

  assert.equal(health.schema_version, "health_v1");
  assert.equal(typeof health.prompt_bytes_per_stage.planner.count, "number");
  assert.equal(typeof health.prompt_budget_breaches.planner, "number");
  assert.equal(typeof health.session_reuse_count.reused_session_records, "number");
  assert.equal(typeof health.stranded_lease_count, "number");
  assert.equal(typeof health.simulate_entries_in_leaderboard, "number");
  assert.equal(typeof health.percent_of_plans_with_explicit_scope_justification.total_plans, "number");
});

test("simulate run writes aggregate stage gate results", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const gateResults = JSON.parse(fs.readFileSync(path.join(rootDir, "factory", "runs", fs.readdirSync(path.join(rootDir, "factory", "runs")).find((entry) => entry.startsWith("RUN-")), "gate-results.json"), "utf8"));
  assert.equal(gateResults.schema_version, "stage_gates_v1");
  assert.equal(gateResults.stages.some((item) => item.stage === "planner" && item.decision === "allowed"), true);
  assert.equal(gateResults.stages.some((item) => item.stage === "executor" && item.decision === "allowed"), true);
});

test("live run writes candidate promotion gate after candidate execution", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const candidateId = "CAND-LIVE-GATE-001";
  const candidateDir = path.join(paths.factory, "candidates", candidateId);
  const wfaRoot = path.join(rootDir, "walk forward engine");
  fs.mkdirSync(path.join(wfaRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "strategies", "demo", "results"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "src", "strategies"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(wfaRoot, "strategies", "demo", "wfa_config.yaml"), "walk_forward:\n  training_months: 3\n  testing_months: 1\n  step_months: 1\n  n_parameter_trials: 5\n  output_directory: strategies/demo/results\ndata:\n  source_file: data/demo.csv\nstrategy:\n  profile_key: DEMO\nperformance:\n  max_execution_time_seconds: 5\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "src", "strategies", "demo.py"), "class DemoStrategy:\n    pass\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "config", "strategy_demo.json"), "{\"profile_key\":\"DEMO\"}\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "data", "demo.csv"), "timestamp,open,high,low,close,volume\n2026-01-01,1,1,1,1,1\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "scripts", "walk_forward_smoke_test.py"), `const fs = require('fs');
const path = require('path');
const out = path.join(process.cwd(), 'strategies', 'demo', 'results');
fs.mkdirSync(out, { recursive: true });
const result = {
  successful_windows: 2,
  total_windows: 2,
  aggregate_sharpe_ratio: -0.2,
  aggregate_total_trades: 20,
  aggregate_max_drawdown_pct: -0.05,
  aggregate_profit_factor: 0.9,
  aggregate_return_pct: -0.1,
  window_results: [
    { window_id: 0, success: true, total_return_pct: -0.05, total_trades: 10, sharpe_ratio: -0.1, max_drawdown_pct: -0.03, best_parameters: { lookback: 10 } },
    { window_id: 1, success: true, total_return_pct: -0.05, total_trades: 10, sharpe_ratio: -0.3, max_drawdown_pct: -0.05, best_parameters: { lookback: 10 } }
  ]
};
fs.writeFileSync(path.join(out, 'walk_forward_results_20260513_000000.json'), JSON.stringify(result, null, 2) + '\\n');
fs.writeFileSync(path.join(out, 'analysis.json'), JSON.stringify({ metrics: { aggregate_sharpe: -0.2, total_trades: 20, max_drawdown_pct: -0.05, successful_windows: 2, failed_windows: 0 } }, null, 2) + '\\n');
`, "utf8");
  fs.mkdirSync(candidateDir, { recursive: true });
  fs.writeFileSync(path.join(candidateDir, "manifest.json"), JSON.stringify({
    schema_version: "candidate_manifest_v1",
    candidate_id: candidateId,
    status: "candidate_under_review",
    promotion_status: "not_requested"
  }, null, 2) + "\n", "utf8");
  const backlogStore = new BacklogStore(paths);
  backlogStore.append([{
    id: "IDEA-LIVE-GATE-001",
    title: "Candidate gate integration fixture",
    objective: "Run one candidate-scoped WFA result and ensure the loop writes a promotion gate.",
    priority: 80,
    status: "ready",
    category: "strategy",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h",
    candidate_id: candidateId,
    evidence_kind: "research_wfa",
    authority_layer: "python_research",
    data_requirement: "walk forward engine/data/demo.csv",
    expected_wfa_config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
    expected_strategy_config_path: "walk forward engine/config/strategy_demo.json",
    expected_strategy_source_path: "walk forward engine/src/strategies/demo.py"
  }]);

  const agentCalls = [];
  const transport = {
    init: async () => ({}),
    createSession: async ({ agent, attempt } = {}) => ({ sessionId: `${agent}-${attempt}`, sessionUrl: `http://localhost/session/${agent}-${attempt}` }),
    getStatus: () => ({ transport_adapter: "test_transport", serverFingerprint: "fp-candidate-gate" }),
    callAgent: async (agent, promptText, options = {}) => {
      agentCalls.push(agent);
      await options.onSessionCreated?.({ sessionId: `${agent}-${options.attempt || 1}`, sessionUrl: `http://localhost/session/${agent}-${options.attempt || 1}` });
      if (agent === "planner") {
        const body = {
          experiment_id: "EXP-LIVE-GATE-001",
          title: "Candidate gate integration fixture",
          backlog_item_id: "IDEA-LIVE-GATE-001",
          objective: "Run one candidate-scoped WFA result and ensure the loop writes a promotion gate.",
          hypothesis: "Negative candidate evidence should produce a denied candidate promotion gate.",
          strategy_rationale: "Synthetic candidate gate test.",
          strategy_type: "momentum",
          market_family: "crypto",
          instrument_scope: "BTC/USDT",
          timeframe: "1h",
          priority: 80,
          dataset_requirements: ["workspace/data/demo.csv"],
          historical_depth_requirement: { target: "Demo", justification: "Synthetic candidate gate fixture." },
          source_plan: { allowed_source_families: ["existing_fetcher"], primary_source_family: "existing_fetcher", selection_reason: "Synthetic fixture." },
          scope_selection_rationale: "Synthetic candidate gate scope.",
          data_acquisition: { status: "present", reason: "Synthetic fixture confirms data is present.", acquisition_method: "existing_fetcher", sources: [], commands: [], expected_outputs: ["workspace/data/demo.csv"] },
          inputs: ["walk forward engine/strategies/demo/wfa_config.yaml"],
          implementation_steps: ["Run the demo WFA config"],
          commands: ["cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml"],
          expected_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"],
          advanced_wfa_config: {},
          evaluation_criteria: { status_gate: "Synthetic candidate gate", metrics: { min_trades: 1 }, min_evidence_score: 0 },
          fallback_if_blocked: [],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      if (agent === "executor") {
        const artifact = path.join(rootDir, "walk forward engine", "strategies", "demo", "results", "analysis.json");
        fs.writeFileSync(artifact, JSON.stringify({ sharpe_oos: -0.2, aggregate_return_pct: -0.1, profit_factor: 0.9, total_trades: 20, max_drawdown: -0.05 }, null, 2) + "\n", "utf8");
        const body = {
          experiment_id: "EXP-LIVE-GATE-001",
          candidate_id: candidateId,
          status: "executed",
          evidence_kind: "research_wfa",
          authority_layer: "python_research",
          commands_attempted: ["run wfa"],
          commands_completed: ["run wfa"],
          artifacts_created: ["walk forward engine/strategies/demo/results/analysis.json"],
          datasets_acquired: [],
          artifacts_updated: [],
          workspace_changes: ["Created synthetic candidate WFA artifact"],
          metrics_observed: { sharpe_oos: -0.2, aggregate_return_pct: -0.1, profit_factor: 0.9, total_trades: 20, max_drawdown: -0.05 },
          provenance: {
            engine: "walk_forward_engine",
            command: "cd \"walk forward engine\" && .venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config strategies/demo/wfa_config.yaml",
            working_directory: "walk forward engine",
            config_path: "walk forward engine/strategies/demo/wfa_config.yaml",
            result_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"],
            windows_completed: 4
          },
          variants_tested: [],
          blockers: [],
          errors: [],
          notes: []
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      if (agent === "evaluator") {
        const body = {
          experiment_id: "EXP-LIVE-GATE-001",
          verdict: "reject",
          evidence_score: 55,
          performance_score: 20,
          robustness_score: 50,
          novelty_score: 50,
          overall_score: 35,
          metrics: { sharpe_oos: -0.2, total_trades: 20 },
          red_flags: ["Negative WFA evidence"],
          verification: { artifacts_checked: ["walk forward engine/strategies/demo/results/analysis.json"], metrics_verified_from: ["walk forward engine/strategies/demo/results/analysis.json"], missing_or_unverified: [] },
          strengths: [],
          weaknesses: ["Negative research metrics"],
          missing_evidence: [],
          promote_to_leaderboard: false,
          leaderboard_tier: "rejected",
          next_backlog_actions: [],
          confidence_level: "high",
          confidence_rationale: "Synthetic candidate gate test."
        };
        return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
      }
      const body = {
        experiment_id: "EXP-LIVE-GATE-001",
        backlog_item_id: "IDEA-LIVE-GATE-001",
        summary: "Candidate gate integration summary.",
        key_lessons: [{ lesson: "Candidate promotion gate was produced for negative WFA evidence.", specific_finding: "Denied gate exists in candidate folder.", result: { sharpe_oos: -0.2, trades: 20 } }],
        next_actions: [{ action: "Keep CAND-LIVE-GATE-001 rejected unless a new pre-registered rationale exists", rationale: "The candidate promotion gate denied negative research evidence.", priority: "low" }]
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body };
    },
    close: async () => {}
  };

  const previousWfaPython = process.env.RESEARCH_FACTORY_WFA_PYTHON;
  process.env.RESEARCH_FACTORY_WFA_PYTHON = process.execPath;
  await runFactory({
    rootDir,
    mode: "live",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    model: "opencode/minimax-m2.5-free",
    livePluginPolicy: { allowedPlugins: [] },
    liveTransportAdapter: "sdk",
    liveTransportTimeouts: { totalRequestMs: 0 },
    liveTransport: transport
  });
  if (previousWfaPython === undefined) delete process.env.RESEARCH_FACTORY_WFA_PYTHON;
  else process.env.RESEARCH_FACTORY_WFA_PYTHON = previousWfaPython;

  const manifest = JSON.parse(fs.readFileSync(path.join(candidateDir, "manifest.json"), "utf8"));
  const runId = fs.readdirSync(paths.runs).find((entry) => entry.startsWith("RUN-"));
  const runDir = path.join(paths.runs, runId);
  const gateResults = JSON.parse(fs.readFileSync(path.join(runDir, "gate-results.json"), "utf8"));
  const executorInput = JSON.parse(fs.readFileSync(path.join(runDir, "executor-attempt-1", "stage-input.json"), "utf8"));
  const executorValidated = JSON.parse(fs.readFileSync(path.join(runDir, "executor-attempt-1", "stage-validated.json"), "utf8"));

  assert.equal(manifest.status, "promotion_denied");
  assert.equal(manifest.promotion_status, "research_denied");
  assert.equal(fs.existsSync(path.join(rootDir, manifest.latest_gate_decision.gate_path)), true);
  assert.equal(agentCalls.includes("planner"), false);
  assert.equal(agentCalls.includes("executor"), false);
  assert.equal(agentCalls.includes("evaluator"), true);
  assert.equal(agentCalls.includes("summarizer"), true);
  assert.equal(fs.existsSync(path.join(runDir, "planner-attempt-1")), false);
  assert.equal(executorInput.execution_authority, "deterministic_research_wfa_run_worker");
  assert.equal(executorValidated.worker_result.worker, "research_wfa_run");
  assert.equal(executorValidated.worker_result.observations.execution_was_run_by_this_worker, true);
  assert.equal(gateResults.stages.some((item) => item.stage === "research_promotion" && item.decision === "denied" && item.candidate_id === candidateId), true);
  assert.equal(gateResults.stages.some((item) => item.stage === "executor" && item.validator === "deterministic_research_wfa_run_worker"), true);
});

test("derived artifact rebuild is idempotent except for timestamps", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 3,
    agentTimeoutMs: 0,
    openBrowser: false
  });

  const paths = buildPaths(rootDir);
  const first = rebuildDerivedArtifacts(paths);
  const second = rebuildDerivedArtifacts(paths);

  const normalize = (payload) => JSON.parse(JSON.stringify(payload, (key, value) => {
    if (["updated_at", "repaired_at"].includes(key)) return "<ts>";
    return value;
  }));

  assert.deepEqual(normalize(first), normalize(second));
});

test("strict prompt budgets fail oversized stage prompts", async () => {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-")), "trading-research-factory");
  initializeProject(rootDir);
  const paths = buildPaths(rootDir);
  const backlogStore = new BacklogStore(paths);

  backlogStore.append([{
    id: "IDEA-PROMPT-BUDGET-001",
    title: "Oversized planner prompt",
    objective: "X".repeat(50000),
    priority: 90,
    status: "ready",
    market_family: "crypto",
    instrument_scope: "BTC/USDT",
    timeframe: "1h"
  }]);

  const result = await runFactory({
    rootDir,
    mode: "simulate",
    cycles: 1,
    intervalMs: 1,
    maxRetries: 1,
    agentTimeoutMs: 0,
    openBrowser: false,
    promptBudgetPolicy: {
      strict: true,
      stageBudgets: {
        ideator: 10000,
        planner: 1000,
        executor: 24000,
        evaluator: 10000,
        summarizer: 16000
      }
    }
  });

  assert.equal(result.cycles_executed, 1);
  assert.match(result.state.last_error, /planner prompt budget exceeded/);
  assert.equal(result.state.last_status, "error");
});

test("inactive prompt doctrine files are absent from active and archived prompt surfaces", () => {
  const repoRoot = path.resolve(process.cwd());
  assert.equal(fs.existsSync(path.join(repoRoot, "src/prompts/shared-context.md")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "src/prompts/shared-guidance.md")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs/archive/prompts/shared-context.md")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "docs/archive/prompts/shared-guidance.md")), false);
});

test("runtime prompt stack is frozen to one shared invariants file plus role prompts", () => {
  const repoRoot = path.resolve(process.cwd());
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "opencode.json"), "utf8"));
  const invariants = fs.readFileSync(path.join(repoRoot, "src/prompts/runtime-invariants.md"), "utf8");

  assert.deepEqual(config.instructions, ["src/prompts/runtime-invariants.md"]);
  assert.equal(typeof config.agent.ideator.prompt, "string");
  assert.equal(typeof config.agent.planner.prompt, "string");
  assert.equal(typeof config.agent.executor.prompt, "string");
  assert.equal(typeof config.agent.evaluator.prompt, "string");
  assert.equal(typeof config.agent.summarizer.prompt, "string");
  assert.match(invariants, /evidence-kind-appropriate output/i);
  assert.match(invariants, /For `research_wfa`/);
  assert.match(invariants, /compact spec-policy capsules/i);
  assert.match(invariants, /Context7/i);
  assert.match(invariants, /Before coding work/i);
  assert.doesNotMatch(invariants, /`executed` means a real WFA run produced real output artifacts/i);
});

test("prompt builders remain serializer-like and free of hidden shared prompt layers", () => {
  const planner = plannerPrompt({
    goal: "Goal",
    backlogItem: {
      id: "IDEA-1",
      title: "Test",
      objective: "Test objective",
      priority: 10,
      market_family: "crypto",
      instrument_scope: "BTC/USDT",
      timeframe: "1h"
    },
    state: { iteration: 1, market_policy: { focus: ["crypto"] } },
    retrieval: { notes: ["Use exact file paths only."] }
  });
  const summarizer = fs.readFileSync(path.join(process.cwd(), "src/prompts/summarizer.md"), "utf8");

  assert.equal(planner.includes("shared-context.md"), false);
  assert.equal(planner.includes("shared-guidance.md"), false);
  assert.equal(planner.includes("Hidden"), false);
  assert.equal(planner.includes("## Planning Task"), true);
  assert.equal(planner.includes("## Exact Files To Inspect"), true);
  assert.match(summarizer, /generic lessons/i);
  assert.match(summarizer, /generic next actions/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { rebuildHealthMetrics } from "../src/core/health.mjs";
import { pruneOperationalArtifacts } from "../src/core/verification.mjs";

function createTempRoot() {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "health-test-")), "trading-research-factory");
  initializeProject(rootDir);
  return rootDir;
}

test("health metrics include transport phase breakdown, owner-lock events, and false-pass counters", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const runDir = path.join(paths.runs, "RUN-HEALTH-001");
  const stageDir = path.join(runDir, "executor-attempt-1");

  fs.mkdirSync(stageDir, { recursive: true });
  fs.writeFileSync(path.join(stageDir, "stage-error.json"), JSON.stringify({
    failure_class: "transport_failure",
    transport_phase: "request",
    transport_adapter: "opencode_sdk"
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "gate-results.json"), JSON.stringify({
    schema_version: "stage_gates_v1",
    run_id: "RUN-HEALTH-001",
    stages: [{
      stage: "executor",
      attempt: 1,
      decision: "denied",
      reason: "Executor reported 'executed' without canonical execution provenance."
    }]
  }, null, 2));
  fs.writeFileSync(paths.recoveryLog, [
    JSON.stringify({ kind: "owner_lock_takeover" }),
    JSON.stringify({ kind: "observer_only_start" })
  ].join("\n") + "\n", "utf8");
  fs.writeFileSync(paths.backlog, JSON.stringify([
    { id: "A", status: "infra_quarantined" },
    { id: "B", status: "infra_cooldown" }
  ], null, 2));

  const health = rebuildHealthMetrics(paths);
  assert.equal(health.transport_failures.by_phase.request, 1);
  assert.equal(health.transport_failures.by_adapter.opencode_sdk.request, 1);
  assert.equal(health.owner_lock_events.owner_lock_takeovers, 1);
  assert.equal(health.owner_lock_events.observer_only_starts, 1);
  assert.equal(health.false_pass_prevention.denied_stage_gates, 1);
  assert.equal(health.false_pass_prevention.denied_false_executed_claims, 1);
  assert.equal(health.cooldown_run_count, 1);
  assert.equal(health.quarantined_run_count, 1);
});

test("pruneOperationalArtifacts bounds recovery logs and verification artifact counts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  fs.writeFileSync(paths.recoveryLog, Array.from({ length: 8 }, (_, index) => JSON.stringify({ line: index + 1 })).join("\n") + "\n", "utf8");
  for (const name of [
    "transport-bakeoff-20260101000000000.json",
    "transport-bakeoff-20260101000000001.json",
    "transport-bakeoff-20260101000000002.json"
  ]) {
    fs.writeFileSync(path.join(paths.verification, name), "{}\n", "utf8");
  }

  const summary = pruneOperationalArtifacts(paths, {
    recoveryLogMaxLines: 3,
    verificationFilesPerPrefix: 2
  });
  const health = rebuildHealthMetrics(paths);

  assert.equal(summary.recovery_log_lines_before, 8);
  assert.equal(summary.recovery_log_lines_after, 3);
  assert.equal(summary.verification_files_deleted, 1);
  assert.equal(health.operational_artifacts.recovery_log_lines, 3);
  assert.equal(health.operational_artifacts.verification_files, 2);
});

test("health metrics distinguish service health from actual research throughput", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const runDir = path.join(paths.runs, "RUN-THROUGHPUT-001");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(paths.marketPolicy), JSON.stringify({
    market_family_priorities: [
      { market_family: "crypto", priority: 1 },
      { market_family: "prediction_markets", priority: 2 }
    ]
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "gate-results.json"), JSON.stringify({
    schema_version: "stage_gates_v1",
    run_id: "RUN-THROUGHPUT-001",
    stages: [
      { stage: "executor", decision: "allowed" },
      { stage: "executor", decision: "denied" }
    ]
  }, null, 2));
  fs.writeFileSync(paths.backlog, JSON.stringify([
    { id: "A", status: "infra_blocked" },
    { id: "B", status: "infra_cooldown" }
  ], null, 2));
  fs.writeFileSync(paths.evidenceIndex, JSON.stringify([
    { mode: "live", evidence_kind: "research", market_family: "crypto", recorded_at: new Date().toISOString() },
    { mode: "live", evidence_kind: "research", market_family: "prediction_markets", recorded_at: new Date().toISOString() },
    { mode: "simulate", evidence_kind: "simulation", market_family: "crypto", recorded_at: new Date().toISOString() }
  ], null, 2));

  const health = rebuildHealthMetrics(paths);
  assert.equal(health.executor_completion_rate.total_executor_stage_gates, 2);
  assert.equal(health.executor_completion_rate.allowed_executor_stage_gates, 1);
  assert.equal(health.evidence_yield.live_research_entries_total, 2);
  assert.equal(health.evidence_yield.live_research_entries_last_24h, 2);
  assert.equal(health.market_family_distribution_vs_policy[0].market_family, "crypto");
  assert.equal(health.market_family_distribution_vs_policy[0].live_research_entries, 1);
  assert.equal(health.research_vs_infra_balance.infra_blocked_like_items, 2);
  assert.equal(health.research_vs_infra_balance.research_bearing_live_runs, 2);
});

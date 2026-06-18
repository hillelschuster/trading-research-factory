import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initializeProject } from "../src/core/init.mjs";
import { RuntimeLedger } from "../src/core/runtime-ledger.mjs";
import { buildResearchBrainStage0Diagnostics } from "../src/core/researchbrain-stage0-diagnostics.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-diagnostics-test-"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function officialFileHashes(paths) {
  return Object.fromEntries([
    ["state", paths.state],
    ["backlog", paths.backlog],
    ["evidenceIndex", paths.evidenceIndex],
    ["leaderboard", paths.leaderboard],
    ["lessons", paths.lessons]
  ].map(([label, filePath]) => [label, fs.existsSync(filePath) ? sha256File(filePath) : null]));
}

function writeProjection(rootDir, eventId, payload = {}) {
  const repoPath = `factory/runtime/projections/researchbrain-stage0/${eventId}.json`;
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify({
    schema_version: "researchbrain_stage0_outbox_projection_v1",
    event: {
      event_id: eventId,
      aggregate_id: payload.run_id ?? "RUN-RB-DIAG-READY",
      payload: {
        job_id: payload.job_id ?? "JOB-RB-DIAG-READY",
        attempt_id: payload.attempt_id ?? "ATT-RB-DIAG-READY-1",
        status: payload.status ?? "stage0_ready"
      }
    },
    run: { run_id: payload.run_id ?? "RUN-RB-DIAG-READY", status: payload.status ?? "stage0_ready" },
    job: { job_id: payload.job_id ?? "JOB-RB-DIAG-READY", status: payload.status ?? "stage0_ready" },
    attempt: { attempt_id: payload.attempt_id ?? "ATT-RB-DIAG-READY-1", status: payload.status ?? "stage0_ready" }
  }, null, 2)}\n`, "utf8");
  return repoPath;
}

function seedDiagnosticsLedger(rootDir) {
  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    const jobs = [
      ["RUN-RB-DIAG-QUEUED", "JOB-RB-DIAG-QUEUED", "queued", 5],
      ["RUN-RB-DIAG-BLOCKED", "JOB-RB-DIAG-BLOCKED", "blocked", 1],
      ["RUN-RB-DIAG-POISONED", "JOB-RB-DIAG-POISONED", "poisoned", 1],
      ["RUN-RB-DIAG-READY", "JOB-RB-DIAG-READY", "stage0_ready", 1],
      ["RUN-RB-DIAG-CLAIMED", "JOB-RB-DIAG-CLAIMED", "queued", 10]
    ];
    for (const [runId, jobId, status, priority] of jobs) {
      ledger.insertRun({ run_id: runId, status, evidence_kind: "stage0_research_discovery" });
      ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status, priority });
    }
    const claim = ledger.claimNextJob({
      owner_id: "diagnostics-stale-owner",
      job_type: "researchbrain_stage0",
      lease_ms: 1000,
      now: "2000-01-01T00:00:00.000Z"
    });
    assert.equal(claim.job.job_id, "JOB-RB-DIAG-CLAIMED");
    ledger.insertJobAttempt({
      attempt_id: "ATT-RB-DIAG-READY-1",
      job_id: "JOB-RB-DIAG-READY",
      attempt_number: 1,
      status: "stage0_ready",
      worker: "researchbrain_stage0_loop_runner"
    });
    ledger.insertJobAttempt({
      attempt_id: "ATT-RB-DIAG-BLOCKED-1",
      job_id: "JOB-RB-DIAG-BLOCKED",
      attempt_number: 1,
      status: "blocked",
      worker: "researchbrain_stage0_loop_runner",
      payload: {
        failure_summary: {
          failure_class: "schema_or_validation_failure",
          retryable: false,
          error_message: "request_sha256 does not match factory/research/requests/blocked.json",
          request_artifact: { path: "factory/research/requests/blocked.json", sha256: "b".repeat(64) },
          runtime_result_artifact: null,
          quarantine_paths: [],
          blockers: ["request_sha256 does not match factory/research/requests/blocked.json"]
        }
      }
    });
    ledger.insertJobAttempt({
      attempt_id: "ATT-RB-DIAG-POISONED-1",
      job_id: "JOB-RB-DIAG-POISONED",
      attempt_number: 1,
      status: "poisoned",
      worker: "researchbrain_stage0_loop_runner",
      payload: {
        failure_summary: {
          failure_class: "poison_candidate_or_run",
          retryable: false,
          error_message: "provider output contains forbidden profitability or promotion fields: sharpe",
          final_terminal_state: "poison_candidate_or_run",
          request_artifact: { path: "factory/research/requests/poisoned.json", sha256: "c".repeat(64) },
          runtime_result_artifact: { path: "factory/research/runs/poisoned/runtime-result.json", sha256: "d".repeat(64) },
          quarantine_paths: [{ path: "factory/research/runs/poisoned/quarantine/provider-output.json", sha256: "e".repeat(64) }],
          blockers: ["forbidden profitability or promotion fields"]
        }
      }
    });
    ledger.recordRunStatusWithOutbox({
      run_id: "RUN-RB-DIAG-READY",
      status: "stage0_ready",
      event_id: "EVT-RB-DIAG-PENDING",
      event_type: "researchbrain.stage0_job_finished",
      payload: { job_id: "JOB-RB-DIAG-READY", attempt_id: "ATT-RB-DIAG-READY-1", status: "stage0_ready" }
    });
    ledger.recordRunStatusWithOutbox({
      run_id: "RUN-RB-DIAG-BLOCKED",
      status: "blocked",
      event_id: "EVT-RB-DIAG-PROCESSED",
      event_type: "researchbrain.stage0_job_finished",
      payload: { job_id: "JOB-RB-DIAG-BLOCKED", attempt_id: "ATT-RB-DIAG-BLOCKED-1", status: "blocked" }
    });
    ledger.markOutboxEventProcessed({
      event_id: "EVT-RB-DIAG-PROCESSED",
      consumer_id: "diagnostics-seed-consumer",
      result: { projection_artifact: { path: "factory/runtime/projections/researchbrain-stage0/EVT-RB-DIAG-PROCESSED.json" } }
    });
  } finally {
    ledger.close();
  }
}

test("ResearchBrain Stage-0 diagnostics summarizes jobs, stale claims, outbox, and projections without official mutation", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  seedDiagnosticsLedger(rootDir);
  const projectionPath = writeProjection(rootDir, "EVT-RB-DIAG-PROCESSED", { status: "blocked", run_id: "RUN-RB-DIAG-BLOCKED", job_id: "JOB-RB-DIAG-BLOCKED", attempt_id: "ATT-RB-DIAG-BLOCKED-1" });

  const result = buildResearchBrainStage0Diagnostics({ rootDir, projectionLimit: 3, staleLimit: 3 });

  assert.equal(result.schema_version, "researchbrain_stage0_diagnostics_v1");
  assert.equal(result.status, "attention");
  assert.deepEqual(result.attention_reasons, ["stale_claimed_jobs", "claimable_stage0_jobs", "blocked_jobs", "poisoned_jobs", "pending_outbox_events"]);
  assert.equal(result.jobs.queued, 1);
  assert.equal(result.jobs.claimed, 1);
  assert.equal(result.jobs.stale_claimed, 1);
  assert.equal(result.jobs.blocked, 1);
  assert.equal(result.jobs.poisoned, 1);
  assert.equal(result.jobs.stage0_ready, 1);
  assert.equal(result.stale_claims[0].job_id, "JOB-RB-DIAG-CLAIMED");
  assert.equal(result.outbox.by_status.pending, 1);
  assert.equal(result.outbox.by_status.processed, 1);
  assert.equal(result.outbox.oldest_pending[0].event_id, "EVT-RB-DIAG-PENDING");
  assert.equal(result.attempts.by_status.stage0_ready, 1);
  assert.equal(result.attempts.by_status.blocked, 1);
  assert.equal(result.attempts.by_status.poisoned, 1);
  assert.equal(result.attempts.latest_failures.length, 2);
  assert.equal(result.attempts.latest_failures.some((attempt) => attempt.failure_summary.failure_class === "schema_or_validation_failure" && attempt.failure_summary.request_artifact.path === "factory/research/requests/blocked.json"), true);
  assert.equal(result.attempts.latest_failures.some((attempt) => attempt.failure_summary.failure_class === "poison_candidate_or_run" && attempt.failure_summary.request_artifact.path === "factory/research/requests/poisoned.json"), true);
  assert.equal(result.projections.latest.some((artifact) => artifact.path === projectionPath && artifact.sha256 === sha256File(path.join(rootDir, projectionPath))), true);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.official_evidence_index_mutated, false);
  assert.equal(result.official_backlog_mutated, false);
  assert.equal(result.official_leaderboard_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 diagnostics CLI emits JSON result", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  seedDiagnosticsLedger(rootDir);
  writeProjection(rootDir, "EVT-RB-DIAG-PROCESSED", { status: "blocked" });

  const result = spawnSync("node", ["scripts/run-researchbrain-stage0-diagnostics.mjs", "--root", rootDir, "--projection-limit", "2", "--stale-limit", "2"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, "researchbrain_stage0_diagnostics_v1");
  assert.equal(output.jobs.stale_claimed, 1);
  assert.equal(output.outbox.by_status.pending, 1);
  assert.equal(output.attempts.latest_failures.length, 2);
  assert.equal(output.projections.latest.length, 1);
});

test("ResearchBrain Stage-0 diagnostics rejects escaping projection paths", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);

  assert.throws(
    () => buildResearchBrainStage0Diagnostics({ rootDir, projectionDir: "../outside" }),
    /escapes repository root/
  );
});

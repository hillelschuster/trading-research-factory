import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initializeProject } from "../src/core/init.mjs";
import { RuntimeLedger } from "../src/core/runtime-ledger.mjs";
import { consumeResearchBrainStage0Outbox } from "../src/core/researchbrain-stage0-outbox-consumer.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-outbox-test-"));
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

function seedFinishedEvent(rootDir) {
  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: "RUN-RB-STAGE0-OUTBOX", status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: "JOB-RB-STAGE0-OUTBOX", run_id: "RUN-RB-STAGE0-OUTBOX", job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
    ledger.insertJobAttempt({
      attempt_id: "JOB-RB-STAGE0-OUTBOX-ATTEMPT-1",
      job_id: "JOB-RB-STAGE0-OUTBOX",
      attempt_number: 1,
      status: "stage0_ready",
      worker: "researchbrain_stage0_loop_runner",
      payload: { runtime_status: "ready", final_terminal_state: "ready" }
    });
    ledger.insertArtifact({
      artifact_id: "ART-RB-STAGE0-OUTBOX-RESULT",
      run_id: "RUN-RB-STAGE0-OUTBOX",
      job_id: "JOB-RB-STAGE0-OUTBOX",
      attempt_id: "JOB-RB-STAGE0-OUTBOX-ATTEMPT-1",
      artifact_type: "researchbrain_stage0_runtime_result",
      path: "factory/research/runs/RESEARCHBRAIN-STAGE0-OUTBOX/runtime-result.json",
      sha256: "a".repeat(64),
      size_bytes: 123
    });
    ledger.recordRunStatusWithOutbox({
      run_id: "RUN-RB-STAGE0-OUTBOX",
      status: "stage0_ready",
      event_id: "EVT-RB-STAGE0-OUTBOX-FINISHED",
      event_type: "researchbrain.stage0_job_finished",
      payload: {
        job_id: "JOB-RB-STAGE0-OUTBOX",
        attempt_id: "JOB-RB-STAGE0-OUTBOX-ATTEMPT-1",
        runtime_run_id: "RESEARCHBRAIN-STAGE0-OUTBOX",
        status: "stage0_ready"
      }
    });
  } finally {
    ledger.close();
  }
}

function seedBlockedEvent(rootDir) {
  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: "RUN-RB-STAGE0-OUTBOX-BLOCKED", status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: "JOB-RB-STAGE0-OUTBOX-BLOCKED", run_id: "RUN-RB-STAGE0-OUTBOX-BLOCKED", job_type: "researchbrain_stage0", status: "blocked", priority: 1 });
    ledger.insertJobAttempt({
      attempt_id: "JOB-RB-STAGE0-OUTBOX-BLOCKED-ATTEMPT-1",
      job_id: "JOB-RB-STAGE0-OUTBOX-BLOCKED",
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
    ledger.recordRunStatusWithOutbox({
      run_id: "RUN-RB-STAGE0-OUTBOX-BLOCKED",
      status: "blocked",
      event_id: "EVT-RB-STAGE0-OUTBOX-BLOCKED-FINISHED",
      event_type: "researchbrain.stage0_job_finished",
      payload: {
        job_id: "JOB-RB-STAGE0-OUTBOX-BLOCKED",
        attempt_id: "JOB-RB-STAGE0-OUTBOX-BLOCKED-ATTEMPT-1",
        status: "blocked",
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
  } finally {
    ledger.close();
  }
}

function readLedger(rootDir, fn) {
  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    return fn(ledger);
  } finally {
    ledger.close();
  }
}

test("ResearchBrain Stage-0 outbox consumer writes bounded projection and marks event processed", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  seedFinishedEvent(rootDir);

  const result = consumeResearchBrainStage0Outbox({ rootDir, consumerId: "outbox-test-consumer", limit: 5 });

  assert.equal(result.schema_version, "researchbrain_stage0_outbox_consumer_result_v1");
  assert.equal(result.status, "processed");
  assert.equal(result.events_processed, 1);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  const projectionPath = path.join(rootDir, result.processed[0].projection_artifact.path);
  assert.equal(fs.existsSync(projectionPath), true);
  const projection = JSON.parse(fs.readFileSync(projectionPath, "utf8"));
  assert.equal(projection.schema_version, "researchbrain_stage0_outbox_projection_v1");
  assert.equal(projection.event.event_id, "EVT-RB-STAGE0-OUTBOX-FINISHED");
  assert.equal(projection.run.status, "stage0_ready");
  assert.equal(projection.job.status, "stage0_ready");
  assert.equal(projection.attempt.status, "stage0_ready");
  assert.equal(projection.artifacts.some((artifact) => artifact.artifact_type === "researchbrain_stage0_runtime_result"), true);

  readLedger(rootDir, (ledger) => {
    const event = ledger.getOutboxEvent("EVT-RB-STAGE0-OUTBOX-FINISHED");
    assert.equal(event.status, "processed");
    const payload = JSON.parse(event.payload_json);
    assert.equal(payload.outbox_consumer.consumer_id, "outbox-test-consumer");
    assert.equal(payload.outbox_consumer.result.projection_artifact.path, result.processed[0].projection_artifact.path);
  });

  const second = consumeResearchBrainStage0Outbox({ rootDir, consumerId: "outbox-test-consumer", limit: 5 });
  assert.equal(second.status, "empty");
  assert.equal(second.events_processed, 0);
});

test("ResearchBrain Stage-0 outbox consumer CLI emits JSON result", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  seedFinishedEvent(rootDir);

  const result = spawnSync("node", ["scripts/run-researchbrain-stage0-outbox-consumer.mjs", "--root", rootDir, "--consumer-id", "cli-outbox-test", "--limit", "1"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, "researchbrain_stage0_outbox_consumer_result_v1");
  assert.equal(output.events_processed, 1);
  assert.equal(output.processed[0].event_id, "EVT-RB-STAGE0-OUTBOX-FINISHED");
});

test("ResearchBrain Stage-0 outbox projection includes blocked failure summary", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  seedBlockedEvent(rootDir);

  const result = consumeResearchBrainStage0Outbox({ rootDir, consumerId: "outbox-failure-test-consumer", limit: 5 });

  assert.equal(result.events_processed, 1);
  assert.equal(result.processed[0].projected_status, "blocked");
  const projection = JSON.parse(fs.readFileSync(path.join(rootDir, result.processed[0].projection_artifact.path), "utf8"));
  assert.equal(projection.failure_summary.failure_class, "schema_or_validation_failure");
  assert.equal(projection.failure_summary.request_artifact.path, "factory/research/requests/blocked.json");
  assert.match(projection.failure_summary.error_message, /request_sha256 does not match/);
  assert.equal(projection.official_state_mutated, false);
  assert.equal(projection.wfa_executed, false);
  assert.equal(projection.mt5_executed, false);
});

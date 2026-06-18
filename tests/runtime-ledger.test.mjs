import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { RuntimeLedger, RUNTIME_LEDGER_SCHEMA_VERSION, RUNTIME_LEDGER_TABLES, migrateRuntimeLedger, runtimeLedgerPath } from "../src/core/runtime-ledger.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "runtime-ledger-test-"));
}

function withLedger(rootDir, fn) {
  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    return fn(ledger);
  } finally {
    ledger.close();
  }
}

test("runtime ledger migration creates the repo-contained DB and exact minimum tables", () => {
  const rootDir = tempRoot();
  const result = migrateRuntimeLedger({ rootDir });

  assert.equal(result.schema_version, RUNTIME_LEDGER_SCHEMA_VERSION);
  assert.equal(result.db_path, runtimeLedgerPath(rootDir));
  assert.equal(fs.existsSync(result.db_path), true);
  assert.deepEqual(result.tables, [...RUNTIME_LEDGER_TABLES].sort());
  assert.match(result.sqlite_version, /^\d+\.\d+\.\d+/);
  assert.equal(result.journal_mode, "delete");
  assert.equal(result.wal_enabled, false);
  assert.equal(result.busy_timeout_ms, 5000);
});

test("runtime ledger inserts and reads run, job, attempt, artifact, and trial rows", () => {
  const rootDir = tempRoot();

  withLedger(rootDir, (ledger) => {
    ledger.insertRun({ run_id: "RUN-LEDGER-001", status: "queued", evidence_kind: "research_wfa", payload: { candidate_id: "CAND-1" } });
    ledger.insertJob({ job_id: "JOB-LEDGER-001", run_id: "RUN-LEDGER-001", job_type: "research_wfa", status: "queued", priority: 7 });
    ledger.insertJobAttempt({ attempt_id: "ATTEMPT-LEDGER-001", job_id: "JOB-LEDGER-001", attempt_number: 1, status: "started", worker: "research_wfa_run" });
    ledger.insertArtifact({
      artifact_id: "ART-LEDGER-001",
      run_id: "RUN-LEDGER-001",
      job_id: "JOB-LEDGER-001",
      attempt_id: "ATTEMPT-LEDGER-001",
      artifact_type: "worker_result",
      path: "factory/runs/RUN-LEDGER-001/worker-result.json",
      sha256: "a".repeat(64),
      size_bytes: 123,
      payload: { schema: "research_wfa_run_worker_v1" }
    });
    ledger.insertTrialAttempt({
      trial_attempt_id: "TRIAL-LEDGER-001",
      run_id: "RUN-LEDGER-001",
      job_id: "JOB-LEDGER-001",
      attempt_id: "ATTEMPT-LEDGER-001",
      trial_kind: "manual_cli_canary_worker_launched_wfa",
      status: "completed",
      payload: { total_trades: 12 }
    });

    assert.equal(ledger.getRun("RUN-LEDGER-001").status, "queued");
    assert.equal(JSON.parse(ledger.getRun("RUN-LEDGER-001").payload_json).candidate_id, "CAND-1");
    assert.equal(ledger.getJob("JOB-LEDGER-001").priority, 7);
    assert.equal(ledger.getJobAttempt("ATTEMPT-LEDGER-001").worker, "research_wfa_run");
    assert.equal(ledger.getArtifact("ART-LEDGER-001").artifact_type, "worker_result");
    assert.equal(JSON.parse(ledger.getTrialAttempt("TRIAL-LEDGER-001").payload_json).total_trades, 12);
  });
});

test("runtime ledger records run transition and outbox event atomically", () => {
  const rootDir = tempRoot();

  withLedger(rootDir, (ledger) => {
    ledger.insertRun({ run_id: "RUN-LEDGER-OUTBOX", status: "queued", evidence_kind: "research_wfa" });
    ledger.recordRunStatusWithOutbox({
      run_id: "RUN-LEDGER-OUTBOX",
      status: "executing",
      event_id: "EVT-LEDGER-001",
      event_type: "run.status_changed",
      payload: { status: "executing" }
    });

    assert.equal(ledger.getRun("RUN-LEDGER-OUTBOX").status, "executing");
    assert.equal(ledger.getOutboxEvent("EVT-LEDGER-001").status, "pending");

    assert.throws(() => ledger.recordRunStatusWithOutbox({
      run_id: "RUN-LEDGER-OUTBOX",
      status: "should_rollback",
      event_id: "EVT-LEDGER-001",
      event_type: "run.status_changed"
    }), /UNIQUE constraint failed/i);
    assert.equal(ledger.getRun("RUN-LEDGER-OUTBOX").status, "executing");
  });
});

test("runtime ledger outbox consumer processing is idempotent by event_id", () => {
  const rootDir = tempRoot();

  withLedger(rootDir, (ledger) => {
    ledger.insertRun({ run_id: "RUN-LEDGER-OUTBOX-IDEMPOTENT", status: "queued", evidence_kind: "research_wfa" });
    ledger.recordRunStatusWithOutbox({
      run_id: "RUN-LEDGER-OUTBOX-IDEMPOTENT",
      status: "executing",
      event_id: "EVT-LEDGER-IDEMPOTENT-001",
      event_type: "run.status_changed",
      payload: { status: "executing" }
    });

    assert.equal(ledger.listPendingOutboxEvents({ event_type: "run.status_changed" }).length, 1);

    const first = ledger.markOutboxEventProcessed({
      event_id: "EVT-LEDGER-IDEMPOTENT-001",
      consumer_id: "test-consumer",
      now: "2026-01-01T00:00:00.000Z",
      result: { projection: "written" }
    });
    assert.equal(first.processed, true);
    assert.equal(first.already_processed, false);
    assert.equal(first.event.status, "processed");
    assert.equal(first.event.processed_at, "2026-01-01T00:00:00.000Z");
    assert.equal(JSON.parse(first.event.payload_json).outbox_consumer.consumer_id, "test-consumer");
    assert.equal(ledger.listPendingOutboxEvents({ event_type: "run.status_changed" }).length, 0);

    const second = ledger.markOutboxEventProcessed({
      event_id: "EVT-LEDGER-IDEMPOTENT-001",
      consumer_id: "test-consumer",
      now: "2026-01-01T00:00:09.000Z",
      result: { projection: "duplicate" }
    });
    assert.equal(second.processed, false);
    assert.equal(second.already_processed, true);
    assert.equal(second.event.processed_at, "2026-01-01T00:00:00.000Z");
    assert.equal(JSON.parse(second.event.payload_json).outbox_consumer.result.projection, "written");
  });
});

test("runtime ledger outbox processing rejects missing event ids", () => {
  const rootDir = tempRoot();

  withLedger(rootDir, (ledger) => {
    assert.throws(() => ledger.markOutboxEventProcessed({
      event_id: "EVT-MISSING",
      consumer_id: "test-consumer"
    }), /outbox event not found/i);
  });
});

test("runtime ledger claims jobs with fencing tokens and rejects stale heartbeats/finalize", () => {
  const rootDir = tempRoot();

  withLedger(rootDir, (ledger) => {
    ledger.insertRun({ run_id: "RUN-LEDGER-CLAIM", status: "queued", evidence_kind: "research_wfa" });
    ledger.insertJob({ job_id: "JOB-LEDGER-CLAIM", run_id: "RUN-LEDGER-CLAIM", job_type: "research_wfa", status: "queued", priority: 1, created_at: "2026-01-01T00:00:00.000Z" });

    const claimed = ledger.claimNextJob({ owner_id: "worker-a", lease_ms: 1000, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(claimed.job.job_id, "JOB-LEDGER-CLAIM");
    assert.equal(claimed.job.status, "claimed");
    assert.equal(claimed.lease.owner_id, "worker-a");
    assert.equal(claimed.lease.fencing_token, 1);

    assert.equal(ledger.claimNextJob({ owner_id: "worker-b", now: "2026-01-01T00:00:00.500Z" }), null);
    assert.throws(() => ledger.recordHeartbeat({ job_id: "JOB-LEDGER-CLAIM", owner_id: "worker-a", fencing_token: 99 }), /heartbeat rejected by fencing token/i);
    assert.throws(() => ledger.finalizeJob({ job_id: "JOB-LEDGER-CLAIM", owner_id: "worker-b", fencing_token: 1, status: "executed" }), /finalize rejected by fencing token/i);

    const heartbeat = ledger.recordHeartbeat({ job_id: "JOB-LEDGER-CLAIM", owner_id: "worker-a", fencing_token: 1, lease_ms: 2000, now: "2026-01-01T00:00:01.000Z" });
    assert.equal(heartbeat.expires_at, "2026-01-01T00:00:03.000Z");
    const finalized = ledger.finalizeJob({ job_id: "JOB-LEDGER-CLAIM", owner_id: "worker-a", fencing_token: 1, status: "executed", now: "2026-01-01T00:00:02.000Z" });
    assert.equal(finalized.status, "executed");
    assert.equal(ledger.getLease("JOB-LEDGER-CLAIM").status, "released");
  });
});

test("runtime ledger reclaims expired leases and increments fencing tokens", () => {
  const rootDir = tempRoot();

  withLedger(rootDir, (ledger) => {
    ledger.insertRun({ run_id: "RUN-LEDGER-RECLAIM", status: "queued", evidence_kind: "research_wfa" });
    ledger.insertJob({ job_id: "JOB-LEDGER-RECLAIM", run_id: "RUN-LEDGER-RECLAIM", job_type: "research_wfa", status: "queued", priority: 1 });

    const first = ledger.claimNextJob({ owner_id: "worker-a", lease_ms: 1000, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(first.lease.fencing_token, 1);

    const second = ledger.claimNextJob({ owner_id: "worker-b", lease_ms: 1000, now: "2026-01-01T00:00:02.000Z" });
    assert.equal(second.job.job_id, "JOB-LEDGER-RECLAIM");
    assert.equal(second.lease.owner_id, "worker-b");
    assert.equal(second.lease.fencing_token, 2);

    assert.throws(() => ledger.recordHeartbeat({ job_id: "JOB-LEDGER-RECLAIM", owner_id: "worker-a", fencing_token: 1 }), /heartbeat rejected by fencing token/i);
    assert.throws(() => ledger.finalizeJob({ job_id: "JOB-LEDGER-RECLAIM", owner_id: "worker-a", fencing_token: 1, status: "stale_completed" }), /finalize rejected by fencing token/i);
    assert.equal(ledger.finalizeJob({ job_id: "JOB-LEDGER-RECLAIM", owner_id: "worker-b", fencing_token: 2, status: "blocked" }).status, "blocked");
  });
});

test("runtime ledger retries BEGIN IMMEDIATE after a busy lock", () => {
  const rootDir = tempRoot();
  const locker = new RuntimeLedger({ rootDir, timeoutMs: 1 });
  const contender = new RuntimeLedger({ rootDir, timeoutMs: 1 });
  let retries = 0;

  try {
    locker.migrate();
    locker.insertRun({ run_id: "RUN-LEDGER-BUSY", status: "queued", evidence_kind: "research_wfa" });
    locker.insertJob({ job_id: "JOB-LEDGER-BUSY", run_id: "RUN-LEDGER-BUSY", job_type: "research_wfa", status: "queued", priority: 1 });
    locker.db.exec("BEGIN IMMEDIATE");

    const claimed = contender.claimNextJob({
      owner_id: "worker-after-busy",
      maxRetries: 1,
      retryDelayMs: 0,
      onRetry: () => {
        retries += 1;
        locker.db.exec("ROLLBACK");
      }
    });

    assert.equal(retries, 1);
    assert.equal(claimed.job.job_id, "JOB-LEDGER-BUSY");
    assert.equal(claimed.lease.fencing_token, 1);
  } finally {
    if (locker.db.isTransaction) locker.db.exec("ROLLBACK");
    contender.close();
    locker.close();
  }
});

test("runtime ledger migration script writes diagnostics", () => {
  const rootDir = tempRoot();
  const result = spawnSync("node", ["scripts/migrate-runtime-ledger.mjs", "--root", rootDir], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, RUNTIME_LEDGER_SCHEMA_VERSION);
  assert.equal(output.db_exists, true);
  assert.deepEqual(output.tables, [...RUNTIME_LEDGER_TABLES].sort());
});

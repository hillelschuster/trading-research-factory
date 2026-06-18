import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeProject } from "../src/core/init.mjs";
import { RuntimeLedger } from "../src/core/runtime-ledger.mjs";
import { buildResearchBrainRequestArtifact } from "../src/core/researchbrain-artifacts.mjs";
import { runResearchBrainStage0Loop } from "../src/core/researchbrain-loop-runner.mjs";
import { RESEARCHBRAIN_STAGE0_PROVIDER_OUTPUT_SCHEMA_VERSION } from "../src/core/researchbrain-runtime.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-loop-test-"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJsonFixture(rootDir, repoPath, value) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: repoPath, sha256: sha256File(fullPath) };
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

function phase8ARefs(rootDir) {
  const universe = writeJsonFixture(rootDir, "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-TEST/universe-snapshot.json", {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    server: "FTMO-Demo",
    symbol_count_total: 3,
    symbols: [{ name: "EURUSD" }, { name: "XAUUSD" }, { name: "BTCUSD" }]
  });
  const inventory = writeJsonFixture(rootDir, "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-TEST/inventory.json", {
    schema_version: "mt5_terminal_inventory_v1",
    inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-TEST",
    counts: { total_symbols: 3 }
  });
  return { universe_snapshot: universe, terminal_inventory: inventory };
}

function writeRequest(rootDir, requestId = "RESEARCHBRAIN-REQUEST-LOOP-TEST") {
  const refs = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId,
    observedAt: "2026-06-03T10:00:00Z",
    universeSnapshotPath: refs.universe_snapshot.path,
    terminalInventoryPath: refs.terminal_inventory.path,
    priorFailedPatterns: ["Simple RSI and post-hoc Sharpe-chasing variants failed prior screens."],
    priorLessons: ["ResearchBrain Stage-0 output must remain source-backed and non-authoritative."],
    maxSources: 4,
    maxHypotheses: 2
  });
  return writeJsonFixture(rootDir, `factory/research/requests/${requestId}.json`, request);
}

function seedJob(rootDir, { runId, jobId, payload }) {
  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "queued", priority: 1, payload });
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

test("ResearchBrain Stage-0 loop claims one job, runs runtime, and mirrors artifacts without official mutation", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const requestRef = writeRequest(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  seedJob(rootDir, {
    runId: "RUN-RB-STAGE0-LOOP-READY",
    jobId: "JOB-RB-STAGE0-LOOP-READY",
    payload: {
      request_path: requestRef.path,
      request_sha256: requestRef.sha256,
      run_id: "RESEARCHBRAIN-STAGE0-LOOP-READY",
      output_dir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LOOP-READY",
      provider_mode: "valid",
      max_attempts: 1,
      max_provider_calls: 1,
      timeout_ms: 1000
    }
  });

  const result = await runResearchBrainStage0Loop({ rootDir, ownerId: "loop-test-owner", maxJobs: 1 });

  assert.equal(result.schema_version, "researchbrain_stage0_loop_result_v1");
  assert.equal(result.status, "processed");
  assert.equal(result.jobs_processed, 1);
  assert.equal(result.jobs[0].status, "stage0_ready");
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.official_evidence_index_mutated, false);
  assert.equal(result.official_backlog_mutated, false);
  assert.equal(result.official_leaderboard_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.getRun("RUN-RB-STAGE0-LOOP-READY").status, "stage0_ready");
    assert.equal(ledger.getJob("JOB-RB-STAGE0-LOOP-READY").status, "stage0_ready");
    const attempt = ledger.getJobAttempt("JOB-RB-STAGE0-LOOP-READY-ATTEMPT-1");
    assert.equal(attempt.status, "stage0_ready");
    const attemptPayload = JSON.parse(attempt.payload_json);
    assert.equal(attemptPayload.official_state_mutated, false);
    assert.deepEqual(attemptPayload.verified_request_artifact, { path: requestRef.path, sha256: requestRef.sha256 });
    const artifacts = ledger.db.prepare("SELECT artifact_type FROM artifacts WHERE job_id = ? ORDER BY artifact_type").all("JOB-RB-STAGE0-LOOP-READY");
    assert.equal(artifacts.some((row) => row.artifact_type === "researchbrain_stage0_runtime_result"), true);
    assert.equal(artifacts.some((row) => row.artifact_type === "hypothesis_packet"), true);
  });
});

test("ResearchBrain Stage-0 loop blocks request artifacts changed after queue seeding", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const requestRef = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-HASH-TAMPER-TEST");
  const beforeOfficial = officialFileHashes(paths);
  seedJob(rootDir, {
    runId: "RUN-RB-STAGE0-LOOP-HASH-TAMPER",
    jobId: "JOB-RB-STAGE0-LOOP-HASH-TAMPER",
    payload: {
      request_path: requestRef.path,
      request_sha256: requestRef.sha256,
      run_id: "RESEARCHBRAIN-STAGE0-LOOP-HASH-TAMPER",
      output_dir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LOOP-HASH-TAMPER",
      provider_mode: "valid",
      max_attempts: 1,
      max_provider_calls: 1,
      timeout_ms: 1000
    }
  });
  const fullRequestPath = path.join(rootDir, requestRef.path);
  const request = JSON.parse(fs.readFileSync(fullRequestPath, "utf8"));
  request.prior_lessons.push("tampered after queue seed");
  fs.writeFileSync(fullRequestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");

  const result = await runResearchBrainStage0Loop({ rootDir, ownerId: "hash-tamper-owner", maxJobs: 1 });

  assert.equal(result.status, "blocked_or_empty");
  assert.equal(result.jobs_processed, 1);
  assert.equal(result.jobs[0].status, "blocked");
  assert.equal(result.jobs[0].failure_class, "schema_or_validation_failure");
  assert.match(result.jobs[0].blockers[0], /request_sha256 does not match/);
  assert.equal(result.jobs[0].failure_summary.failure_class, "schema_or_validation_failure");
  assert.deepEqual(result.jobs[0].failure_summary.request_artifact, { path: requestRef.path, sha256: requestRef.sha256 });
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.getRun("RUN-RB-STAGE0-LOOP-HASH-TAMPER").status, "blocked");
    assert.equal(ledger.getJob("JOB-RB-STAGE0-LOOP-HASH-TAMPER").status, "blocked");
    assert.equal(ledger.getLease("JOB-RB-STAGE0-LOOP-HASH-TAMPER").status, "released");
    const artifacts = ledger.db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE job_id = ?").get("JOB-RB-STAGE0-LOOP-HASH-TAMPER");
    assert.equal(artifacts.count, 0);
    const attemptPayload = JSON.parse(ledger.getJobAttempt("JOB-RB-STAGE0-LOOP-HASH-TAMPER-ATTEMPT-1").payload_json);
    assert.equal(attemptPayload.failure_summary.failure_class, "schema_or_validation_failure");
    assert.equal(attemptPayload.failure_summary.request_artifact.path, requestRef.path);
    const event = ledger.listPendingOutboxEvents({ event_type: "researchbrain.stage0_job_finished" })[0];
    const eventPayload = JSON.parse(event.payload_json);
    assert.equal(eventPayload.failure_summary.failure_class, "schema_or_validation_failure");
  });
});

test("ResearchBrain Stage-0 loop blocks malformed request hashes before runtime", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const requestRef = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-HASH-MALFORMED-TEST");
  seedJob(rootDir, {
    runId: "RUN-RB-STAGE0-LOOP-HASH-MALFORMED",
    jobId: "JOB-RB-STAGE0-LOOP-HASH-MALFORMED",
    payload: {
      request_path: requestRef.path,
      request_sha256: "not-a-sha",
      run_id: "RESEARCHBRAIN-STAGE0-LOOP-HASH-MALFORMED",
      output_dir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LOOP-HASH-MALFORMED",
      provider_mode: "valid"
    }
  });

  const result = await runResearchBrainStage0Loop({ rootDir, ownerId: "hash-malformed-owner", maxJobs: 1 });

  assert.equal(result.status, "blocked_or_empty");
  assert.equal(result.jobs[0].status, "blocked");
  assert.equal(result.jobs[0].failure_class, "schema_or_validation_failure");
  assert.match(result.jobs[0].blockers[0], /request_sha256 must be a valid SHA-256/);
});

test("ResearchBrain Stage-0 loop blocks malformed jobs and releases the lease", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  seedJob(rootDir, {
    runId: "RUN-RB-STAGE0-LOOP-BLOCKED",
    jobId: "JOB-RB-STAGE0-LOOP-BLOCKED",
    payload: { provider_mode: "valid" }
  });

  const result = await runResearchBrainStage0Loop({ rootDir, ownerId: "loop-test-owner", maxJobs: 1 });

  assert.equal(result.status, "blocked_or_empty");
  assert.equal(result.jobs_processed, 1);
  assert.equal(result.jobs[0].status, "blocked");
  assert.equal(result.jobs[0].failure_class, "schema_or_validation_failure");
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.getRun("RUN-RB-STAGE0-LOOP-BLOCKED").status, "blocked");
    assert.equal(ledger.getJob("JOB-RB-STAGE0-LOOP-BLOCKED").status, "blocked");
    assert.equal(ledger.getLease("JOB-RB-STAGE0-LOOP-BLOCKED").status, "released");
    assert.equal(ledger.getJobAttempt("JOB-RB-STAGE0-LOOP-BLOCKED-ATTEMPT-1").status, "blocked");
  });
});

test("ResearchBrain Stage-0 loop exits cleanly when no claimable jobs exist", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);

  const result = await runResearchBrainStage0Loop({ rootDir, ownerId: "loop-empty-owner", maxJobs: 3 });

  assert.equal(result.status, "empty");
  assert.equal(result.stop_reason, "no_claimable_job");
  assert.equal(result.jobs_processed, 0);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
});

test("ResearchBrain Stage-0 loop reclaims a stale claimed job", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const requestRef = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-STALE-CLAIM-TEST");
  seedJob(rootDir, {
    runId: "RUN-RB-STAGE0-LOOP-STALE-CLAIM",
    jobId: "JOB-RB-STAGE0-LOOP-STALE-CLAIM",
    payload: {
      request_path: requestRef.path,
      run_id: "RESEARCHBRAIN-STAGE0-LOOP-STALE-CLAIM",
      output_dir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LOOP-STALE-CLAIM",
      provider_mode: "valid",
      max_attempts: 1,
      max_provider_calls: 1,
      timeout_ms: 1000
    }
  });

  readLedger(rootDir, (ledger) => {
    const claim = ledger.claimNextJob({
      owner_id: "stale-owner",
      job_type: "researchbrain_stage0",
      lease_ms: 1000,
      now: "2000-01-01T00:00:00.000Z"
    });
    assert.equal(claim.job.job_id, "JOB-RB-STAGE0-LOOP-STALE-CLAIM");
    assert.equal(ledger.getJob("JOB-RB-STAGE0-LOOP-STALE-CLAIM").status, "claimed");
  });

  const result = await runResearchBrainStage0Loop({ rootDir, ownerId: "fresh-owner", maxJobs: 1 });

  assert.equal(result.status, "processed");
  assert.equal(result.jobs_processed, 1);
  assert.equal(result.jobs[0].status, "stage0_ready");
  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.getJob("JOB-RB-STAGE0-LOOP-STALE-CLAIM").status, "stage0_ready");
    assert.equal(ledger.getLease("JOB-RB-STAGE0-LOOP-STALE-CLAIM").owner_id, "fresh-owner");
    assert.equal(ledger.getLease("JOB-RB-STAGE0-LOOP-STALE-CLAIM").status, "released");
  });
});

test("ResearchBrain Stage-0 loop marks poison jobs terminal and does not reclaim them", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const requestRef = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-POISON-TEST");
  seedJob(rootDir, {
    runId: "RUN-RB-STAGE0-LOOP-POISON",
    jobId: "JOB-RB-STAGE0-LOOP-POISON",
    payload: {
      request_path: requestRef.path,
      run_id: "RESEARCHBRAIN-STAGE0-LOOP-POISON",
      output_dir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LOOP-POISON",
      max_attempts: 2,
      max_provider_calls: 2,
      timeout_ms: 1000
    }
  });

  const result = await runResearchBrainStage0Loop({
    rootDir,
    ownerId: "poison-owner",
    maxJobs: 1,
    providerFactory: () => ({
      name: "poison_test_provider",
      mode: "fixture_test_double",
      live_research: false,
      async generate({ run_id: runId }) {
        return {
          schema_version: RESEARCHBRAIN_STAGE0_PROVIDER_OUTPUT_SCHEMA_VERSION,
          research_run_id: runId,
          sharpe: 2.5,
          source_captures: [],
          hypothesis_packets: []
        };
      }
    })
  });

  assert.equal(result.status, "blocked_or_empty");
  assert.equal(result.jobs_processed, 1);
  assert.equal(result.jobs[0].status, "poisoned");
  assert.equal(result.jobs[0].runtime_status, "blocked");
  assert.equal(result.jobs[0].failure_summary.failure_class, "poison_candidate_or_run");
  assert.equal(result.jobs[0].failure_summary.final_terminal_state, "poison_candidate_or_run");
  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.getRun("RUN-RB-STAGE0-LOOP-POISON").status, "poisoned");
    assert.equal(ledger.getJob("JOB-RB-STAGE0-LOOP-POISON").status, "poisoned");
    assert.equal(ledger.getLease("JOB-RB-STAGE0-LOOP-POISON").status, "released");
    const attempt = ledger.getJobAttempt("JOB-RB-STAGE0-LOOP-POISON-ATTEMPT-1");
    assert.equal(attempt.status, "poisoned");
    const attemptPayload = JSON.parse(attempt.payload_json);
    assert.equal(attemptPayload.final_terminal_state, "poison_candidate_or_run");
    assert.equal(attemptPayload.failure_summary.failure_class, "poison_candidate_or_run");
    assert.equal(attemptPayload.failure_summary.request_artifact.path, requestRef.path);
  });

  const secondResult = await runResearchBrainStage0Loop({ rootDir, ownerId: "second-owner", maxJobs: 1 });

  assert.equal(secondResult.status, "empty");
  assert.equal(secondResult.jobs_processed, 0);
  readLedger(rootDir, (ledger) => {
    const attempts = ledger.db.prepare("SELECT COUNT(*) AS count FROM job_attempts WHERE job_id = ?").get("JOB-RB-STAGE0-LOOP-POISON");
    assert.equal(attempts.count, 1);
  });
});

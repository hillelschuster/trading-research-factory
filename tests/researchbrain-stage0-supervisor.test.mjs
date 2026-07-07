import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initializeProject } from "../src/core/init.mjs";
import { RuntimeLedger } from "../src/core/runtime-ledger.mjs";
import { writeResearchBrainRequestArtifact } from "../src/core/researchbrain-artifacts.mjs";
import { seedResearchBrainStage0Job } from "../src/core/researchbrain-stage0-job-seeder.mjs";
import { buildResearchBrainStage0SupervisorPreflight, runResearchBrainStage0Supervisor, runResearchBrainStage0SupervisorCycles } from "../src/core/researchbrain-stage0-supervisor.mjs";
import { buildResearchBrainStage0ReadinessReport, writeResearchBrainStage0ReadinessReport } from "../src/core/researchbrain-stage0-readiness.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-supervisor-test-"));
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

function assertReportConsistency(consistency, { path: artifactPath, sha256, reportType, schemaVersion }) {
  assert.equal(consistency.verified, true);
  assert.equal(consistency.artifact_path, artifactPath);
  assert.equal(consistency.path_scope, "repo_relative");
  assert.equal(consistency.path_exists, true);
  assert.equal(consistency.schema_version, schemaVersion);
  assert.equal(consistency.report_type, reportType);
  assert.equal(consistency.sha256, sha256);
  assert.equal(consistency.sha256_matches_expected, true);
  assert.equal(consistency.metadata_path_matches, true);
  assert.equal(consistency.authority_flags_false, true);
  assert.equal(consistency.diagnostic_only, true);
}

function phase8ARefs(rootDir) {
  const universe = writeJsonFixture(rootDir, "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-SUPERVISOR-TEST/universe-snapshot.json", {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    server: "FTMO-Demo",
    symbol_count_total: 3,
    symbols: [{ name: "EURUSD" }, { name: "XAUUSD" }, { name: "BTCUSD" }]
  });
  const inventory = writeJsonFixture(rootDir, "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-SUPERVISOR-TEST/inventory.json", {
    schema_version: "mt5_terminal_inventory_v1",
    inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-SUPERVISOR-TEST",
    counts: { total_symbols: 3 }
  });
  return { universe_snapshot: universe, terminal_inventory: inventory };
}

function writeRequest(rootDir, requestId = "RESEARCHBRAIN-REQUEST-SUPERVISOR-TEST") {
  const refs = phase8ARefs(rootDir);
  return writeResearchBrainRequestArtifact({
    rootDir,
    requestId,
    observedAt: "2026-06-04T12:00:00Z",
    universeSnapshotPath: refs.universe_snapshot.path,
    terminalInventoryPath: refs.terminal_inventory.path,
    priorFailedPatterns: ["Manual Phase 8D strategy roulette stopped after zero survivors."],
    priorLessons: ["ResearchBrain Stage-0 output must remain source-backed and non-authoritative."],
    maxSources: 4,
    maxHypotheses: 2
  });
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

test("ResearchBrain Stage-0 supervisor runs seed-loop-outbox-diagnostics without official mutation", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir);
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0Supervisor({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    ownerId: "supervisor-loop-test",
    consumerId: "supervisor-outbox-test",
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });

  assert.equal(result.schema_version, "researchbrain_stage0_supervisor_result_v1");
  assert.equal(result.status, "completed");
  assert.equal(result.next_action, "none");
  assert.equal(result.recommendation.status, "ok");
  assert.equal(result.recommendation.reason, "stage0_supervisor_ready");
  assert.equal(result.recommendation.diagnostic_only, true);
  assert.equal(result.supervisor_health.status, "healthy");
  assert.equal(result.supervisor_health.alert_level, "none");
  assert.equal(result.supervisor_health.safe_to_run_another_bounded_cycle, true);
  assert.equal(result.supervisor_health.operator_inspection_required, false);
  assert.equal(result.supervisor_health.diagnostic_only, true);
  assert.equal(result.operational_summary.status, "completed");
  assert.equal(result.operational_summary.next_action, "none");
  assert.equal(result.operational_summary.progress_made, true);
  assert.equal(result.operational_summary.jobs_processed, 1);
  assert.equal(result.operational_summary.stage0_ready_jobs, 1);
  assert.equal(result.operational_summary.outbox_events_processed, 1);
  assert.equal(result.operational_summary.remaining_claimable_jobs, 0);
  assert.equal(result.operational_summary.pending_outbox_events, 0);
  assert.equal(result.operational_summary.attention_status, "none");
  assert.equal(result.operational_summary.runtime_consistency_status, "ok");
  assert.equal(result.operational_summary.diagnostic_only, true);
  assert.equal(result.seed.status, "seeded");
  assert.equal(result.loop.jobs_processed, 1);
  assert.equal(result.loop.jobs[0].status, "stage0_ready");
  assert.equal(result.outbox.events_processed, 1);
  assert.equal(result.diagnostics.jobs.stage0_ready, 1);
  assert.equal(result.diagnostics.outbox.by_status.processed, 1);
  assert.equal(result.diagnostics.projections.latest.length, 1);
  assert.equal(result.readiness_summary.status, "ready");
  assert.deepEqual(result.readiness_summary.attention_reasons, []);
  assert.equal(result.readiness_summary.projection_recovery.orphan_projection_files, 0);
  assert.equal(result.readiness_summary.runtime_consistency.status, "ok");
  assert.equal(result.readiness_summary.runtime_consistency.inconsistent_final_jobs, 0);
  assert.equal(result.readiness_summary.authority.wfa_executed, false);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.getJob(result.seed.job_id).status, "stage0_ready");
    assert.equal(ledger.listPendingOutboxEvents({ event_type: "researchbrain.stage0_job_finished" }).length, 0);
  });
  assert.equal(fs.existsSync(path.join(rootDir, result.outbox.processed[0].projection_artifact.path)), true);
});

test("ResearchBrain Stage-0 supervisor canary leaves readiness clean without official mutation", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-READINESS-CANARY");
  const beforeOfficial = officialFileHashes(paths);

  const supervisor = await runResearchBrainStage0Supervisor({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    ownerId: "supervisor-readiness-loop-test",
    consumerId: "supervisor-readiness-outbox-test",
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    projectionLimit: 10
  });
  const readiness = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });
  const write = writeResearchBrainStage0ReadinessReport(rootDir, readiness);

  assert.equal(supervisor.status, "completed");
  assert.equal(supervisor.readiness_summary.status, "ready");
  assert.equal(supervisor.readiness_summary.terminal_failures_unreconciled, 0);
  assert.equal(readiness.status, "ready");
  assert.deepEqual(readiness.attention_reasons, []);
  assert.equal(readiness.requests.seeded, 1);
  assert.equal(readiness.requests.seeded_output_collisions, 0);
  assert.equal(readiness.projection_health.latest_stale_or_mismatched, 0);
  assert.equal(readiness.projection_health.integrity.checked_latest, 1);
  assert.equal(readiness.projection_health.integrity.entries[0].ok, true);
  assert.equal(readiness.authority.official_state_mutated, false);
  assert.equal(readiness.authority.official_backlog_mutated, false);
  assert.equal(readiness.authority.wfa_executed, false);
  assert.equal(readiness.authority.mt5_executed, false);
  assert.equal(readiness.authority.phase8e_started, false);
  assert.equal(fs.existsSync(write.path), true);
  assert.equal(write.sha256, sha256File(write.path));
  assert.equal(write.payload.status, "ready");
  assert.equal(write.payload.authority.official_state_mutated, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor reclaims an expired Stage-0 lease deterministically", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-STALE-LEASE");
  const beforeOfficial = officialFileHashes(paths);
  const seeded = seedResearchBrainStage0Job({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    priority: 4,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });

  readLedger(rootDir, (ledger) => {
    const staleClaim = ledger.claimNextJob({
      owner_id: "stale-supervisor-owner",
      job_type: "researchbrain_stage0",
      lease_ms: 1000,
      now: "2000-01-01T00:00:00.000Z"
    });
    assert.equal(staleClaim.job.job_id, seeded.job_id);
    assert.equal(staleClaim.claim.reclaimed_stale_lease, false);
    assert.equal(staleClaim.lease.fencing_token, 1);
  });

  const supervisor = await runResearchBrainStage0Supervisor({
    rootDir,
    ownerId: "fresh-supervisor-owner",
    consumerId: "fresh-supervisor-outbox",
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    projectionLimit: 10
  });
  const readiness = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });

  assert.equal(supervisor.status, "completed");
  assert.equal(supervisor.seed, null);
  assert.equal(supervisor.loop.jobs_processed, 1);
  assert.equal(supervisor.loop.lease_reclaims, 1);
  assert.equal(supervisor.loop.jobs[0].job_id, seeded.job_id);
  assert.equal(supervisor.loop.jobs[0].status, "stage0_ready");
  assert.equal(supervisor.loop.jobs[0].claim.reclaimed_stale_lease, true);
  assert.equal(supervisor.loop.jobs[0].claim.prior_owner_id, "stale-supervisor-owner");
  assert.equal(supervisor.loop.jobs[0].claim.prior_fencing_token, 1);
  assert.equal(supervisor.loop.jobs[0].claim.new_fencing_token, 2);
  assert.equal(supervisor.outbox.events_processed, 1);
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.diagnostics.jobs.stale_claimed, 0);
  assert.equal(readiness.projection_health.latest_stale_or_mismatched, 0);
  assert.equal(supervisor.official_state_mutated, false);
  assert.equal(supervisor.wfa_executed, false);
  assert.equal(supervisor.mt5_executed, false);
  assert.equal(supervisor.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    const lease = ledger.getLease(seeded.job_id);
    const attempt = ledger.db.prepare("SELECT * FROM job_attempts WHERE job_id = ?").get(seeded.job_id);
    const payload = JSON.parse(attempt.payload_json);
    assert.equal(ledger.getJob(seeded.job_id).status, "stage0_ready");
    assert.equal(lease.status, "released");
    assert.equal(lease.owner_id, "fresh-supervisor-owner");
    assert.equal(lease.fencing_token, 2);
    assert.equal(payload.claim.reclaimed_stale_lease, true);
    assert.equal(payload.claim.prior_owner_id, "stale-supervisor-owner");
  });
});

test("ResearchBrain Stage-0 supervisor projects request-SHA preflight blocks and readiness treats them as expected terminal failures", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-SHA-DRIFT");
  const beforeOfficial = officialFileHashes(paths);
  const seeded = seedResearchBrainStage0Job({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });
  const requestFullPath = path.join(rootDir, request.artifact.path);
  const changedRequest = JSON.parse(fs.readFileSync(requestFullPath, "utf8"));
  changedRequest.prior_lessons = [...changedRequest.prior_lessons, "changed after seed to exercise request_sha256 preflight"];
  fs.writeFileSync(requestFullPath, `${JSON.stringify(changedRequest, null, 2)}\n`, "utf8");
  assert.notEqual(sha256File(requestFullPath), request.artifact.sha256);

  const supervisor = await runResearchBrainStage0Supervisor({
    rootDir,
    ownerId: "supervisor-sha-drift-loop-test",
    consumerId: "supervisor-sha-drift-outbox-test",
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    projectionLimit: 10
  });
  const readiness = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10, processedOutboxLimit: 10 });

  assert.equal(supervisor.status, "completed");
  assert.equal(supervisor.seed, null);
  assert.equal(supervisor.loop.jobs_processed, 1);
  assert.equal(supervisor.loop.jobs[0].job_id, seeded.job_id);
  assert.equal(supervisor.loop.jobs[0].status, "blocked");
  assert.equal(supervisor.loop.jobs[0].failure_summary.failure_class, "schema_or_validation_failure");
  assert.equal(supervisor.loop.jobs[0].failure_summary.retryable, false);
  assert.match(supervisor.loop.jobs[0].failure_summary.error_message, /request_sha256 does not match/);
  assert.equal(supervisor.cycle_summary.terminal_jobs, 1);
  assert.equal(supervisor.cycle_summary.projected_terminal_events, 1);
  assert.equal(supervisor.cycle_summary.actionable_diagnostics_reasons.length, 0);
  assert.equal(supervisor.readiness_summary.status, "ready");
  assert.equal(supervisor.readiness_summary.terminal_failure_reconciliation_status, "expected_terminal_failures_only");
  assert.equal(supervisor.readiness_summary.requests.changed_seeded_sha, 1);
  assert.equal(supervisor.readiness_summary.projection_recovery.checked_processed_without_matching_projection_files, 0);
  assert.equal(supervisor.outbox.events_processed, 1);
  assert.equal(fs.existsSync(path.join(rootDir, supervisor.outbox.processed[0].projection_artifact.path)), true);

  assert.equal(readiness.status, "ready");
  assert.deepEqual(readiness.attention_reasons, []);
  assert.deepEqual(readiness.actionable_diagnostics_reasons, []);
  assert.equal(readiness.diagnostics.attention_reasons.includes("blocked_jobs"), true);
  assert.equal(readiness.requests.seeded, 1);
  assert.equal(readiness.requests.changed_seeded_sha, 1);
  assert.equal(readiness.requests.unseeded_valid, 0);
  assert.equal(readiness.projection_health.integrity.actionable_stale_or_mismatched_latest, 0);
  assert.equal(readiness.projection_health.integrity.expected_terminal_issue_counts_by_reason.artifact_sha_mismatch >= 1, true);
  assert.equal(readiness.terminal_failure_reconciliation.status, "expected_terminal_failures_only");
  assert.equal(readiness.terminal_failure_reconciliation.total_terminal_failures, 1);
  assert.equal(readiness.terminal_failure_reconciliation.reconciled_terminal_failures, 1);
  assert.equal(readiness.terminal_failure_reconciliation.entries[0].projection_artifact.path, supervisor.outbox.processed[0].projection_artifact.path);
  assert.equal(readiness.authority.official_state_mutated, false);
  assert.equal(readiness.authority.wfa_executed, false);
  assert.equal(readiness.authority.mt5_executed, false);
  assert.equal(readiness.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor rejects seeded output directories owned by another run before loop execution", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-OUTPUT-COLLISION");
  const outputDir = "factory/research/runs/RUN-RB-STAGE0-SUPERVISOR-COLLISION";
  writeJsonFixture(rootDir, `${outputDir}/runtime-result.json`, {
    schema_version: "researchbrain_stage0_runtime_result_v1",
    run_id: "RUN-RB-STAGE0-OTHER-RUN",
    status: "ready"
  });

  await assert.rejects(
    () => runResearchBrainStage0Supervisor({
      rootDir,
      requestPath: request.artifact.path,
      requestSha256: request.artifact.sha256,
      outputDir,
      maxAttempts: 1,
      maxProviderCalls: 1,
      timeoutMs: 1000
    }),
    /output_dir collision: .*belongs to RUN-RB-STAGE0-OTHER-RUN/
  );
  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get();
    const attempts = ledger.db.prepare("SELECT COUNT(*) AS count FROM job_attempts").get();
    assert.equal(jobs.count, 0);
    assert.equal(attempts.count, 0);
  });
});

test("ResearchBrain Stage-0 supervisor second cycle is idempotent for an already processed request", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-IDEMPOTENT");

  const first = await runResearchBrainStage0Supervisor({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256, maxAttempts: 1, maxProviderCalls: 1, timeoutMs: 1000 });
  const second = await runResearchBrainStage0Supervisor({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256, maxAttempts: 1, maxProviderCalls: 1, timeoutMs: 1000 });

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(second.seed.status, "already_seeded");
  assert.equal(second.loop.jobs_processed, 0);
  assert.equal(second.loop.stop_reason, "no_claimable_job");
  assert.equal(second.outbox.events_processed, 0);
  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get();
    const attempts = ledger.db.prepare("SELECT COUNT(*) AS count FROM job_attempts").get();
    assert.equal(jobs.count, 1);
    assert.equal(attempts.count, 1);
  });
});

test("ResearchBrain Stage-0 supervisor cycles drain bounded queued jobs and stop on idle", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const firstRequest = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CYCLES-A");
  const secondRequest = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CYCLES-B");
  const beforeOfficial = officialFileHashes(paths);

  seedResearchBrainStage0Job({
    rootDir,
    requestPath: firstRequest.artifact.path,
    requestSha256: firstRequest.artifact.sha256,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });
  seedResearchBrainStage0Job({
    rootDir,
    requestPath: secondRequest.artifact.path,
    requestSha256: secondRequest.artifact.sha256,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 3,
    ownerId: "supervisor-cycles-loop-test",
    consumerId: "supervisor-cycles-outbox-test",
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    projectionLimit: 10,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10
  });

  assert.equal(result.schema_version, "researchbrain_stage0_supervisor_run_result_v1");
  assert.equal(result.status, "completed");
  assert.equal(result.stop_reason, "idle");
  assert.equal(result.next_action, "none");
  assert.equal(result.recommendation.status, "ok");
  assert.equal(result.recommendation.reason, "stage0_supervisor_ready");
  assert.equal(result.recommendation.diagnostic_only, true);
  assert.equal(result.supervisor_health.status, "healthy");
  assert.equal(result.supervisor_health.safe_to_run_another_bounded_cycle, true);
  assert.equal(result.supervisor_health.operator_inspection_required, false);
  assert.equal(result.operational_summary.status, "completed");
  assert.equal(result.operational_summary.stop_reason, "idle");
  assert.equal(result.operational_summary.cycles_run, 3);
  assert.equal(result.operational_summary.cycles_with_progress, 2);
  assert.equal(result.operational_summary.jobs_processed, 2);
  assert.equal(result.operational_summary.stage0_ready_jobs, 2);
  assert.equal(result.operational_summary.remaining_claimable_jobs, 0);
  assert.equal(result.operational_summary.pending_outbox_events, 0);
  assert.equal(result.operational_summary.final_readiness_status, "ready");
  assert.equal(result.operational_summary.attention_status, "none");
  assert.equal(result.operational_summary.report_artifacts_all_verified, true);
  assert.equal(result.operational_summary.diagnostic_only, true);
  assert.equal(result.report_artifact_summary.requested.run_report, false);
  assert.equal(result.report_artifact_summary.all_requested_reports_written, true);
  assert.equal(result.max_cycles, 3);
  assert.equal(result.aggregate.cycles_run, 3);
  assert.equal(result.aggregate.totals.jobs_processed, 2);
  assert.equal(result.aggregate.totals.outbox_events_processed, 2);
  assert.equal(result.aggregate.totals.stage0_ready_jobs, 2);
  assert.equal(result.aggregate.totals.terminal_jobs, 0);
  assert.equal(result.aggregate.totals.cycles_with_progress, 2);
  assert.equal(result.aggregate.status_counts.attention, 1);
  assert.equal(result.aggregate.status_counts.completed, 1);
  assert.equal(result.aggregate.status_counts.idle, 1);
  assert.equal(result.aggregate.attention_class_counts.drainable, 1);
  assert.equal(result.aggregate.attention_class_counts.actionable, 0);
  assert.equal(result.aggregate.attention_class_counts.none, 2);
  assert.equal(result.aggregate.readiness_attention_reasons.claimable_stage0_jobs, 1);
  assert.equal(result.aggregate.loop_stop_reasons.no_claimable_job, 1);
  assert.equal(result.aggregate.final_operational_snapshot.status, "ready");
  assert.equal(result.aggregate.final_operational_snapshot.attention_classification.status, "none");
  assert.equal(result.aggregate.final_operational_snapshot.jobs.stage0_ready, 2);
  assert.equal(result.aggregate.final_operational_snapshot.jobs.claimable_stale_or_ready, 0);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.pending, 0);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.processed, 2);
  assert.equal(result.aggregate.final_operational_snapshot.requests.seeded, 2);
  assert.equal(result.aggregate.final_operational_snapshot.terminal_failures.unreconciled, 0);
  assert.equal(result.aggregate.final_operational_snapshot.runtime_consistency.status, "ok");
  assert.equal(result.aggregate.final_readiness_summary.status, "ready");
  assert.equal(result.aggregate.final_readiness_summary.diagnostics.jobs.stage0_ready, 2);
  assert.equal(result.aggregate.final_readiness_summary.diagnostics.outbox.processed, 2);
  assert.equal(result.aggregate.final_readiness_summary.requests.seeded, 2);
  assert.equal(result.aggregate.final_readiness_summary.runtime_consistency.status, "ok");
  assert.equal(result.aggregate.final_readiness_summary.runtime_consistency.inconsistent_final_jobs, 0);
  assert.equal(result.failure, null);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT status, COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0' GROUP BY status").all();
    const byStatus = Object.fromEntries(jobs.map((row) => [row.status, row.count]));
    const attempts = ledger.db.prepare("SELECT COUNT(*) AS count FROM job_attempts").get();
    const processed = ledger.db.prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_type = 'researchbrain.stage0_job_finished' AND status = 'processed'").get();
    assert.equal(byStatus.stage0_ready, 2);
    assert.equal(attempts.count, 2);
    assert.equal(processed.count, 2);
  });
});

test("ResearchBrain Stage-0 supervisor safely auto-seeds bounded valid unseeded requests across cycles", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-AUTO-SEED-A");
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-AUTO-SEED-B");
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 3,
    seedUnseededValid: true,
    autoSeedLimit: 1,
    ownerId: "supervisor-auto-seed-loop-test",
    consumerId: "supervisor-auto-seed-outbox-test",
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    projectionLimit: 10,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10,
    runtimeConsistencyLimit: 10
  });

  assert.equal(result.status, "completed");
  assert.equal(result.stop_reason, "idle");
  assert.equal(result.next_action, "none");
  assert.equal(result.operational_summary.auto_seeded_requests, 2);
  assert.equal(result.operational_summary.auto_seed_failures, 0);
  assert.equal(result.operational_summary.jobs_processed, 2);
  assert.equal(result.operational_summary.stage0_ready_jobs, 2);
  assert.equal(result.aggregate.cycles_run, 3);
  assert.equal(result.aggregate.totals.auto_seeded, 2);
  assert.equal(result.aggregate.totals.auto_seed_failures, 0);
  assert.equal(result.aggregate.totals.jobs_processed, 2);
  assert.equal(result.aggregate.auto_seeded_request_artifacts.length, 2);
  assert.match(result.aggregate.auto_seeded_request_artifacts[0].request_artifact.path, /RESEARCHBRAIN-REQUEST-SUPERVISOR-AUTO-SEED-A/);
  assert.match(result.aggregate.auto_seeded_request_artifacts[1].request_artifact.path, /RESEARCHBRAIN-REQUEST-SUPERVISOR-AUTO-SEED-B/);
  assert.equal(result.cycles[0].auto_seed.status, "seeded");
  assert.equal(result.cycles[0].auto_seed.seeded_count, 1);
  assert.match(result.cycles[0].cycle_summary.auto_seeded_request_artifacts[0].request_artifact.path, /RESEARCHBRAIN-REQUEST-SUPERVISOR-AUTO-SEED-A/);
  assert.equal(result.cycles[0].auto_seed.remaining_unseeded_valid_count, 1);
  assert.equal(result.cycles[1].auto_seed.status, "seeded");
  assert.equal(result.cycles[1].auto_seed.seeded_count, 1);
  assert.equal(result.cycles[2].auto_seed.status, "idle");
  assert.equal(result.aggregate.final_operational_snapshot.status, "ready");
  assert.equal(result.aggregate.final_operational_snapshot.requests.seeded, 2);
  assert.equal(result.aggregate.final_operational_snapshot.requests.unseeded_valid, 0);
  assert.equal(result.aggregate.final_operational_snapshot.jobs.stage0_ready, 2);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.pending, 0);
  assert.equal(result.aggregate.final_operational_snapshot.runtime_consistency.status, "ok");
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT status, COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0' GROUP BY status").all();
    const byStatus = Object.fromEntries(jobs.map((row) => [row.status, row.count]));
    assert.equal(byStatus.stage0_ready, 2);
    assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM job_attempts").get().count, 2);
  });
});

test("ResearchBrain Stage-0 supervisor preflight previews auto-seed without enqueuing jobs", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-PREFLIGHT-A");
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-PREFLIGHT-B");
  const beforeOfficial = officialFileHashes(paths);

  const preflight = buildResearchBrainStage0SupervisorPreflight({
    rootDir,
    cycles: 2,
    maxJobs: 1,
    seedUnseededValid: true,
    autoSeedLimit: 1,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10,
    runtimeConsistencyLimit: 10
  });

  assert.equal(preflight.schema_version, "researchbrain_stage0_supervisor_preflight_v1");
  assert.equal(preflight.status, "ready");
  assert.equal(preflight.next_action, "run_bounded_supervisor_cycle");
  assert.equal(preflight.would_execute_jobs, false);
  assert.equal(preflight.planned_max_jobs, 2);
  assert.deepEqual(preflight.blockers, []);
  assert.equal(preflight.auto_seed_preview.status, "would_seed");
  assert.equal(preflight.auto_seed_preview.eligible_count, 2);
  assert.equal(preflight.auto_seed_preview.selected_count, 1);
  assert.equal(preflight.auto_seed_preview.remaining_unseeded_valid_count, 1);
  assert.match(preflight.auto_seed_preview.selected[0].path, /RESEARCHBRAIN-REQUEST-SUPERVISOR-PREFLIGHT-A/);
  assert.equal(preflight.queue_drain_plan.schema_version, "researchbrain_stage0_queue_drain_plan_v1");
  assert.equal(preflight.queue_drain_plan.status, "ready_to_seed_and_drain");
  assert.equal(preflight.queue_drain_plan.next_action, "run_bounded_supervisor_cycle");
  assert.equal(preflight.queue_drain_plan.auto_seed_selection.selected_count, 1);
  assert.match(preflight.queue_drain_plan.auto_seed_selection.selected_requests[0].path, /RESEARCHBRAIN-REQUEST-SUPERVISOR-PREFLIGHT-A/);
  assert.equal(preflight.queue_drain_plan.current_ledger.unseeded_valid_requests, 2);
  assert.equal(preflight.queue_drain_plan.current_ledger.claimable_stage0_jobs, 0);
  assert.equal(preflight.queue_drain_plan.planned_capacity.planned_job_capacity, 2);
  assert.equal(preflight.queue_drain_plan.planned_capacity.estimated_runnable_jobs, 1);
  assert.equal(preflight.queue_drain_plan.live_canary_discipline.status, "not_live");
  assert.equal(preflight.queue_drain_plan.would_execute_jobs, false);
  assert.equal(preflight.live_provider_policy.live_llm_requested, false);
  assert.equal(preflight.live_provider_policy.safe_for_unattended_queue_drain, true);
  assert.equal(preflight.official_state_mutated, false);
  assert.equal(preflight.wfa_executed, false);
  assert.equal(preflight.mt5_executed, false);
  assert.equal(preflight.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get().count, 0);
    assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM outbox").get().count, 0);
  });
});

test("ResearchBrain Stage-0 supervisor live auto-seed fails closed when provider env opts are incomplete", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-LIVE-POLICY-BLOCK");
  const beforeOfficial = officialFileHashes(paths);
  const priorDeepSeek = process.env.DEEPSEEK_API_KEY;
  const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  try {
    const result = await runResearchBrainStage0SupervisorCycles({
      rootDir,
      cycles: 1,
      seedUnseededValid: true,
      autoSeedLimit: 1,
      providerMode: "live_llm_agent",
      allowLiveLlm: true,
      llmProvider: "deepseek",
      llmModel: "deepseek-v4-flash",
      llmMaxTokens: 8192,
      maxLlmCalls: 12,
      timeoutMs: 180000,
      toolMode: "live",
      sourceProvider: "brave",
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      readinessRequestLimit: 10,
      processedOutboxLimit: 10,
      runtimeConsistencyLimit: 10
    });

    assert.equal(result.status, "failed");
    assert.equal(result.stop_reason, "cycle_failed");
    assert.equal(result.failure.failed_stage, "preflight_or_unknown");
    assert.match(result.failure.error_message, /live queue-drain preflight failed/);
    assert.equal(result.live_provider_policy.status, "blocked");
    assert.equal(result.live_provider_policy.safe_to_attempt_live_cycle, false);
    assert.equal(result.live_provider_policy.provider_settings.llm_api_key_env, "DEEPSEEK_API_KEY");
    assert.equal(result.live_provider_policy.provider_settings.llm_api_key_env_configured, false);
    assert.equal(result.live_provider_policy.provider_settings.source_api_key_env, "BRAVE_SEARCH_API_KEY");
    assert.equal(result.live_provider_policy.provider_settings.source_api_key_env_configured, false);
    assert.equal(result.live_provider_policy.hard_blockers.includes("live_llm_api_key_env_not_configured"), true);
    assert.equal(result.live_provider_policy.hard_blockers.includes("live_source_api_key_env_not_configured"), true);
    assert.equal(result.official_state_mutated, false);
    assert.equal(result.wfa_executed, false);
    assert.equal(result.mt5_executed, false);
    assert.equal(result.phase8e_started, false);
    assert.deepEqual(officialFileHashes(paths), beforeOfficial);

    readLedger(rootDir, (ledger) => {
      assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get().count, 0);
    });
  } finally {
    if (priorDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = priorDeepSeek;
    if (priorBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = priorBrave;
  }
});

test("ResearchBrain Stage-0 supervisor strict live-unattended discipline blocks warning-budget queue drain before execution", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-LIVE-STRICT-WARNINGS");
  const beforeOfficial = officialFileHashes(paths);
  const priorDeepSeek = process.env.DEEPSEEK_API_KEY;
  const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only-dummy-key";
  process.env.BRAVE_SEARCH_API_KEY = "test-only-dummy-key";
  try {
    const preflight = buildResearchBrainStage0SupervisorPreflight({
      rootDir,
      cycles: 1,
      maxJobs: 1,
      seedUnseededValid: true,
      autoSeedLimit: 1,
      providerMode: "live_llm_agent",
      allowLiveLlm: true,
      llmProvider: "deepseek",
      llmModel: "deepseek-v4-flash",
      llmMaxTokens: 2048,
      maxLlmCalls: 4,
      maxToolCalls: 20,
      timeoutMs: 30_000,
      toolMode: "live",
      sourceProvider: "brave",
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      requireLiveUnattendedSafe: true,
      readinessRequestLimit: 10,
      processedOutboxLimit: 10,
      runtimeConsistencyLimit: 10
    });

    assert.equal(preflight.status, "blocked");
    assert.equal(preflight.blockers.includes("live_provider:live_unattended_safety_warnings_present"), true);
    assert.equal(preflight.live_provider_policy.safe_to_attempt_live_cycle, true);
    assert.equal(preflight.live_provider_policy.safe_for_unattended_queue_drain, false);
    assert.equal(preflight.live_provider_policy.warnings.includes("max_llm_calls_below_live_canary_floor_8"), true);
    assert.equal(preflight.live_provider_policy.warnings.includes("llm_max_tokens_below_live_canary_floor_4096"), true);
    assert.equal(preflight.live_provider_policy.warnings.includes("max_tool_calls_below_live_canary_floor_30"), true);
    assert.equal(preflight.live_provider_policy.warnings.includes("timeout_ms_below_unattended_floor_120000"), true);
    assert.equal(preflight.queue_drain_plan.status, "blocked");
    assert.equal(preflight.queue_drain_plan.live_canary_discipline.status, "blocked_by_policy_warnings");
    assert.equal(preflight.queue_drain_plan.live_canary_discipline.require_live_unattended_safe, true);
    assert.equal(preflight.queue_drain_plan.live_canary_discipline.safe_to_attempt_live_cycle, true);
    assert.equal(preflight.queue_drain_plan.live_canary_discipline.safe_for_unattended_queue_drain, false);
    assert.equal(preflight.queue_drain_plan.auto_seed_selection.selected_count, 1);
    assert.equal(preflight.would_execute_jobs, false);

    const result = await runResearchBrainStage0SupervisorCycles({
      rootDir,
      cycles: 1,
      maxJobs: 1,
      seedUnseededValid: true,
      autoSeedLimit: 1,
      providerMode: "live_llm_agent",
      allowLiveLlm: true,
      llmProvider: "deepseek",
      llmModel: "deepseek-v4-flash",
      llmMaxTokens: 2048,
      maxLlmCalls: 4,
      timeoutMs: 30_000,
      toolMode: "live",
      sourceProvider: "brave",
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      requireLiveUnattendedSafe: true,
      readinessRequestLimit: 10,
      processedOutboxLimit: 10,
      runtimeConsistencyLimit: 10
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failure.failed_stage, "preflight_or_unknown");
    assert.match(result.failure.error_message, /live_unattended_safety_warnings_present/);
    assert.equal(result.aggregate.cycles_run, 0);
    assert.equal(result.live_provider_policy.safe_for_unattended_queue_drain, false);
    assert.deepEqual(officialFileHashes(paths), beforeOfficial);
    readLedger(rootDir, (ledger) => {
      assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get().count, 0);
    });
  } finally {
    if (priorDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = priorDeepSeek;
    if (priorBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = priorBrave;
  }
});

test("ResearchBrain Stage-0 supervisor preflight emits operator-safe live queue-drain command profile", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-LIVE-PROFILE-A");
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-LIVE-PROFILE-B");
  const beforeOfficial = officialFileHashes(paths);
  const priorDeepSeek = process.env.DEEPSEEK_API_KEY;
  const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only-dummy-key";
  process.env.BRAVE_SEARCH_API_KEY = "test-only-dummy-key";
  try {
    const preflight = buildResearchBrainStage0SupervisorPreflight({
      rootDir,
      cycles: 1,
      maxJobs: 1,
      maxTotalJobs: 1,
      maxTerminalFailures: 0,
      maxEstimatedLiveCostUsd: 0.25,
      seedUnseededValid: true,
      autoSeedLimit: 1,
      providerMode: "live_llm_agent",
      allowLiveLlm: true,
      llmPreset: "deepseek_v4_flash_xhigh",
      llmProvider: "deepseek",
      llmModel: "deepseek-v4-flash",
      llmMaxTokens: 8192,
      maxLlmCalls: 12,
      maxToolCalls: 30,
      maxCostUsd: 0.25,
      timeoutMs: 180000,
      toolMode: "live",
      sourceProvider: "brave",
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      readinessRequestLimit: 10,
      processedOutboxLimit: 10,
      runtimeConsistencyLimit: 10,
      requireLiveUnattendedSafe: true
    });

    assert.equal(preflight.status, "ready");
    assert.deepEqual(preflight.blockers, []);
    assert.equal(preflight.queue_drain_plan.status, "ready_to_seed_and_drain");
    assert.equal(preflight.queue_drain_plan.auto_seed_selection.selected_count, 1);
    assert.match(preflight.queue_drain_plan.auto_seed_selection.selected_requests[0].path, /RESEARCHBRAIN-REQUEST-SUPERVISOR-LIVE-PROFILE-A/);
    assert.equal(preflight.queue_drain_plan.planned_capacity.estimated_max_live_cost_usd, 0.25);
    assert.equal(preflight.queue_drain_plan.live_canary_discipline.status, "guardrail_safe");
    assert.equal(preflight.live_provider_policy.safe_for_unattended_queue_drain, true);
    assert.deepEqual(preflight.live_provider_policy.warnings, []);

    const profile = preflight.operator_command_profile;
    assert.equal(profile.schema_version, "researchbrain_stage0_operator_command_profile_v1");
    assert.equal(profile.status, "ready_for_operator_preflight");
    assert.equal(profile.selected_requests.length, 1);
    assert.match(profile.selected_requests[0].path, /RESEARCHBRAIN-REQUEST-SUPERVISOR-LIVE-PROFILE-A/);
    assert.equal(profile.estimated_cost.estimated_max_live_cost_usd, 0.25);
    assert.equal(profile.estimated_cost.max_estimated_live_cost_usd, 0.25);
    assert.equal(profile.env_presence.llm_api_key_env, "DEEPSEEK_API_KEY");
    assert.equal(profile.env_presence.llm_api_key_env_configured, true);
    assert.equal(profile.env_presence.source_api_key_env, "BRAVE_SEARCH_API_KEY");
    assert.equal(profile.env_presence.source_api_key_env_configured, true);
    assert.equal(profile.known_good_live_settings.llm_preset, "deepseek_v4_flash_xhigh");
    assert.equal(profile.known_good_live_settings.max_tool_calls, 30);
    assert.equal(profile.secrets_redacted, true);
    assert.equal(profile.preflight_command.executes_jobs, false);
    assert.equal(profile.preflight_command.mutates_runtime_queue, false);
    assert.equal(profile.preflight_command.secrets_included, false);
    assert.equal(profile.preflight_command.argv.includes("--preflight-only"), true);
    assert.equal(profile.preflight_command.argv.includes("--seed-unseeded-valid"), true);
    assert.equal(profile.preflight_command.argv.includes("--require-live-unattended-safe"), true);
    assert.equal(profile.preflight_command.argv.includes("--max-estimated-live-cost-usd"), true);
    assert.match(profile.preflight_command.shell, /--llm-preset deepseek_v4_flash_xhigh/);
    assert.match(profile.preflight_command.shell, /--timeout-ms 180000/);
    assert.match(profile.preflight_command.shell, /--max-llm-calls 12/);
    assert.match(profile.preflight_command.shell, /--max-tool-calls 30/);
    assert.doesNotMatch(profile.preflight_command.shell, /test-only-dummy-key/);
    assert.equal(profile.bounded_live_command.executes_jobs, true);
    assert.equal(profile.bounded_live_command.mutates_runtime_queue, true);
    assert.equal(profile.bounded_live_command.argv.includes("--preflight-only"), false);
    assert.equal(profile.bounded_live_command.argv.includes("--run-report-dir"), true);
    assert.doesNotMatch(profile.bounded_live_command.shell, /test-only-dummy-key/);
    assert.equal(profile.official_state_mutated, false);
    assert.equal(profile.wfa_executed, false);
    assert.equal(profile.mt5_executed, false);
    assert.equal(profile.phase8e_started, false);
    assert.equal(preflight.would_execute_jobs, false);
    assert.deepEqual(officialFileHashes(paths), beforeOfficial);

    readLedger(rootDir, (ledger) => {
      assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get().count, 0);
      assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM outbox").get().count, 0);
    });
  } finally {
    if (priorDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = priorDeepSeek;
    if (priorBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = priorBrave;
  }
});

test("ResearchBrain Stage-0 live preflight supports composite source providers with per-adapter env checks", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-COMPOSITE-SOURCE-A");
  const priorDeepSeek = process.env.DEEPSEEK_API_KEY;
  const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
  const priorSemantic = process.env.SEMANTIC_SCHOLAR_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only-dummy-key";
  process.env.BRAVE_SEARCH_API_KEY = "test-only-dummy-key";
  process.env.SEMANTIC_SCHOLAR_API_KEY = "test-only-dummy-key";
  try {
    const preflight = buildResearchBrainStage0SupervisorPreflight({
      rootDir,
      cycles: 1,
      maxJobs: 1,
      maxTotalJobs: 1,
      maxTerminalFailures: 0,
      maxEstimatedLiveCostUsd: 0.25,
      seedUnseededValid: true,
      autoSeedLimit: 1,
      providerMode: "live_llm_agent",
      allowLiveLlm: true,
      llmPreset: "deepseek_v4_flash_xhigh",
      llmProvider: "deepseek",
      llmModel: "deepseek-v4-flash",
      llmMaxTokens: 8192,
      maxLlmCalls: 12,
      maxToolCalls: 30,
      maxCostUsd: 0.25,
      timeoutMs: 180000,
      toolMode: "live",
      sourceProvider: "brave,semantic_scholar",
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      readinessRequestLimit: 10,
      processedOutboxLimit: 10,
      runtimeConsistencyLimit: 10,
      requireLiveUnattendedSafe: true
    });

    assert.equal(preflight.status, "ready");
    assert.deepEqual(preflight.blockers, []);
    assert.equal(preflight.live_provider_policy.safe_for_unattended_queue_drain, true);
    assert.deepEqual(preflight.live_provider_policy.hard_blockers, []);
    assert.deepEqual(preflight.live_provider_policy.provider_settings.source_providers, ["brave", "semantic_scholar"]);
    assert.deepEqual(preflight.live_provider_policy.provider_settings.source_api_key_envs, [
      { provider: "brave", env: "BRAVE_SEARCH_API_KEY", configured: true },
      { provider: "semantic_scholar", env: "SEMANTIC_SCHOLAR_API_KEY", configured: true }
    ]);
    assert.deepEqual(preflight.operator_command_profile.env_presence.source_api_key_envs, [
      { provider: "brave", env: "BRAVE_SEARCH_API_KEY", configured: true },
      { provider: "semantic_scholar", env: "SEMANTIC_SCHOLAR_API_KEY", configured: true }
    ]);
    assert.match(preflight.operator_command_profile.preflight_command.shell, /--source-provider brave,semantic_scholar/);
  } finally {
    if (priorDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = priorDeepSeek;
    if (priorBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = priorBrave;
    if (priorSemantic === undefined) delete process.env.SEMANTIC_SCHOLAR_API_KEY;
    else process.env.SEMANTIC_SCHOLAR_API_KEY = priorSemantic;
  }
});

test("ResearchBrain Stage-0 supervisor max-total-jobs caps bounded auto-seed drain", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-MAX-JOBS-A");
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-MAX-JOBS-B");
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 5,
    maxJobs: 1,
    maxTotalJobs: 1,
    seedUnseededValid: true,
    autoSeedLimit: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10,
    runtimeConsistencyLimit: 10
  });

  assert.equal(result.stop_reason, "max_total_jobs");
  assert.equal(result.aggregate.cycles_run, 1);
  assert.equal(result.aggregate.totals.jobs_processed, 1);
  assert.equal(result.aggregate.totals.auto_seeded, 1);
  assert.equal(result.unattended_guardrails.status, "stopped_or_blocked");
  assert.equal(result.unattended_guardrails.hard_blockers.includes("max_total_jobs_reached"), true);
  assert.equal(result.operational_summary.guardrail_stop_reason, "max_total_jobs");
  assert.equal(result.unattended_guardrails.configured.max_total_jobs, 1);
  assert.equal(result.unattended_guardrails.observed.jobs_processed, 1);
  assert.equal(result.aggregate.final_operational_snapshot.requests.unseeded_valid, 1);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor live preflight blocks estimated cost over cap without seeding", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-LIVE-COST-CAP");
  const beforeOfficial = officialFileHashes(paths);
  const priorDeepSeek = process.env.DEEPSEEK_API_KEY;
  const priorBrave = process.env.BRAVE_SEARCH_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-only-dummy-key";
  process.env.BRAVE_SEARCH_API_KEY = "test-only-dummy-key";
  try {
    const preflight = buildResearchBrainStage0SupervisorPreflight({
      rootDir,
      cycles: 2,
      maxJobs: 2,
      maxEstimatedLiveCostUsd: 0.5,
      seedUnseededValid: true,
      autoSeedLimit: 1,
      providerMode: "live_llm_agent",
      allowLiveLlm: true,
      llmProvider: "deepseek",
      llmModel: "deepseek-v4-flash",
      llmMaxTokens: 8192,
      maxLlmCalls: 12,
      maxCostUsd: 0.25,
      timeoutMs: 180000,
      toolMode: "live",
      sourceProvider: "brave",
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      readinessRequestLimit: 10,
      processedOutboxLimit: 10,
      runtimeConsistencyLimit: 10
    });

    assert.equal(preflight.status, "blocked");
    assert.equal(preflight.blockers.includes("live_provider:live_estimated_cost_exceeds_cap"), true);
    assert.equal(preflight.live_provider_policy.budgets.estimated_max_live_cost_usd, 1);
    assert.equal(preflight.live_provider_policy.budgets.max_estimated_live_cost_usd, 0.5);
    assert.equal(preflight.live_provider_policy.provider_settings.llm_api_key_env_configured, true);
    assert.equal(preflight.live_provider_policy.provider_settings.source_api_key_env_configured, true);
    assert.equal(preflight.would_execute_jobs, false);

    const result = await runResearchBrainStage0SupervisorCycles({
      rootDir,
      cycles: 2,
      maxJobs: 2,
      maxEstimatedLiveCostUsd: 0.5,
      seedUnseededValid: true,
      autoSeedLimit: 1,
      providerMode: "live_llm_agent",
      allowLiveLlm: true,
      llmProvider: "deepseek",
      llmModel: "deepseek-v4-flash",
      llmMaxTokens: 8192,
      maxLlmCalls: 12,
      maxCostUsd: 0.25,
      timeoutMs: 180000,
      toolMode: "live",
      sourceProvider: "brave",
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      readinessRequestLimit: 10,
      processedOutboxLimit: 10,
      runtimeConsistencyLimit: 10
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failure.failed_stage, "preflight_or_unknown");
    assert.match(result.failure.error_message, /live_estimated_cost_exceeds_cap/);
    assert.equal(result.aggregate.cycles_run, 0);
    assert.equal(result.unattended_guardrails.hard_blockers.includes("max_estimated_live_cost_usd_exceeded"), true);
    assert.deepEqual(officialFileHashes(paths), beforeOfficial);
    readLedger(rootDir, (ledger) => {
      assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get().count, 0);
    });
  } finally {
    if (priorDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = priorDeepSeek;
    if (priorBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = priorBrave;
  }
});

test("ResearchBrain Stage-0 supervisor terminal-failure cap stops after blocked job", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-TERMINAL-CAP");
  seedResearchBrainStage0Job({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    providerMode: "invalid_json",
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 3,
    maxJobs: 1,
    maxTerminalFailures: 0,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10,
    runtimeConsistencyLimit: 10
  });

  assert.equal(result.stop_reason, "max_terminal_failures");
  assert.equal(result.aggregate.cycles_run, 1);
  assert.equal(result.aggregate.totals.terminal_jobs, 1);
  assert.equal(result.unattended_guardrails.status, "stopped_or_blocked");
  assert.equal(result.unattended_guardrails.hard_blockers.includes("max_terminal_failures_exceeded"), true);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor auto-seed blocks on invalid request attention without enqueuing", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-AUTO-SEED-VALID");
  writeJsonFixture(rootDir, "factory/research/requests/invalid-stage0-auto-seed-request.json", {
    schema_version: "not_researchbrain_request_v1",
    request_id: "INVALID-STAGE0-AUTO-SEED-REQUEST"
  });
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 1,
    seedUnseededValid: true,
    autoSeedLimit: 5,
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10,
    runtimeConsistencyLimit: 10
  });

  assert.equal(result.status, "attention");
  assert.equal(result.stop_reason, "attention");
  assert.equal(result.cycles[0].auto_seed.status, "blocked");
  assert.deepEqual(result.cycles[0].auto_seed.blockers, ["invalid_request_artifacts"]);
  assert.equal(result.cycles[0].auto_seed.seeded_count, 0);
  assert.equal(result.operational_summary.auto_seeded_requests, 0);
  assert.equal(result.operational_summary.jobs_processed, 0);
  assert.equal(result.aggregate.final_operational_snapshot.requests.unseeded_valid, 1);
  assert.equal(result.aggregate.final_operational_snapshot.requests.invalid, 1);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get().count, 0);
  });
});

test("ResearchBrain Stage-0 supervisor classifies remaining queued work as drainable attention", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const firstRequest = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-ATTENTION-A");
  const secondRequest = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-ATTENTION-B");
  const beforeOfficial = officialFileHashes(paths);

  seedResearchBrainStage0Job({ rootDir, requestPath: firstRequest.artifact.path, requestSha256: firstRequest.artifact.sha256, maxAttempts: 1, maxProviderCalls: 1, timeoutMs: 1000, retryDelayMs: 0 });
  seedResearchBrainStage0Job({ rootDir, requestPath: secondRequest.artifact.path, requestSha256: secondRequest.artifact.sha256, maxAttempts: 1, maxProviderCalls: 1, timeoutMs: 1000, retryDelayMs: 0 });

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 1,
    maxJobs: 1,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10
  });

  assert.equal(result.status, "attention");
  assert.equal(result.stop_reason, "cycles_exhausted");
  assert.equal(result.next_action, "continue_bounded_cycles");
  assert.equal(result.recommendation.status, "continue");
  assert.equal(result.recommendation.reason, "drainable_stage0_work_remaining");
  assert.equal(result.recommendation.diagnostic_only, true);
  assert.equal(result.supervisor_health.status, "drainable");
  assert.equal(result.supervisor_health.alert_level, "info");
  assert.equal(result.supervisor_health.safe_to_run_another_bounded_cycle, true);
  assert.equal(result.supervisor_health.operator_inspection_required, false);
  assert.equal(result.operational_summary.status, "attention");
  assert.equal(result.operational_summary.next_action, "continue_bounded_cycles");
  assert.equal(result.operational_summary.cycles_run, 1);
  assert.equal(result.operational_summary.jobs_processed, 1);
  assert.equal(result.operational_summary.remaining_claimable_jobs, 1);
  assert.equal(result.operational_summary.pending_outbox_events, 0);
  assert.equal(result.operational_summary.attention_status, "drainable");
  assert.equal(result.aggregate.cycles_run, 1);
  assert.equal(result.aggregate.status_counts.attention, 1);
  assert.equal(result.aggregate.attention_class_counts.drainable, 1);
  assert.equal(result.aggregate.attention_class_counts.actionable, 0);
  assert.equal(result.aggregate.attention_class_counts.none, 0);
  assert.equal(result.aggregate.readiness_attention_reasons.claimable_stage0_jobs, 1);
  assert.equal(result.aggregate.final_operational_snapshot.status, "attention");
  assert.equal(result.aggregate.final_operational_snapshot.attention_classification.status, "drainable");
  assert.equal(result.aggregate.final_operational_snapshot.attention_classification.next_action, "continue_bounded_cycles");
  assert.deepEqual(result.aggregate.final_operational_snapshot.attention_classification.actionable_reasons, []);
  assert.deepEqual(result.aggregate.final_operational_snapshot.attention_classification.drainable_reasons, ["diagnostics_attention", "claimable_stage0_jobs"]);
  assert.equal(result.aggregate.final_operational_snapshot.jobs.claimable_stale_or_ready, 1);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.pending, 0);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.processed, 1);
  assert.equal(result.failure, null);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor classifies invalid request artifacts as actionable attention", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  writeJsonFixture(rootDir, "factory/research/requests/invalid-stage0-request.json", {
    schema_version: "not_researchbrain_request_v1",
    request_id: "INVALID-STAGE0-REQUEST"
  });
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 1,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10
  });

  assert.equal(result.status, "attention");
  assert.equal(result.stop_reason, "attention");
  assert.equal(result.next_action, "inspect_operational_blocker");
  assert.equal(result.recommendation.status, "action_required");
  assert.equal(result.recommendation.reason, "actionable_stage0_attention");
  assert.equal(result.recommendation.diagnostic_only, true);
  assert.equal(result.supervisor_health.status, "blocked");
  assert.equal(result.supervisor_health.alert_level, "warning");
  assert.equal(result.supervisor_health.safe_to_run_another_bounded_cycle, false);
  assert.equal(result.supervisor_health.operator_inspection_required, true);
  assert.equal(result.operational_summary.status, "attention");
  assert.equal(result.operational_summary.next_action, "inspect_operational_blocker");
  assert.equal(result.operational_summary.cycles_run, 1);
  assert.equal(result.operational_summary.jobs_processed, 0);
  assert.equal(result.operational_summary.remaining_claimable_jobs, 0);
  assert.equal(result.operational_summary.attention_status, "actionable");
  assert.equal(result.aggregate.cycles_run, 1);
  assert.equal(result.aggregate.attention_class_counts.actionable, 1);
  assert.equal(result.aggregate.attention_class_counts.drainable, 0);
  assert.equal(result.aggregate.final_operational_snapshot.status, "attention");
  assert.equal(result.aggregate.final_operational_snapshot.attention_classification.status, "actionable");
  assert.equal(result.aggregate.final_operational_snapshot.attention_classification.next_action, "inspect_operational_blocker");
  assert.deepEqual(result.aggregate.final_operational_snapshot.attention_classification.actionable_reasons, ["invalid_request_artifacts"]);
  assert.deepEqual(result.aggregate.final_operational_snapshot.attention_classification.drainable_reasons, []);
  assert.equal(result.aggregate.final_operational_snapshot.requests.invalid, 1);
  assert.equal(result.aggregate.final_operational_snapshot.jobs.claimable_stale_or_ready, 0);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.pending, 0);
  assert.equal(result.failure, null);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor run report preserves completed aggregate snapshot without official mutation", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-RUN-REPORT");
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 2,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    runReportDir: "factory/verification/researchbrain-stage0-supervisor-runs",
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0,
    readinessRequestLimit: 10,
    processedOutboxLimit: 10
  });

  assert.equal(result.status, "completed");
  assert.equal(result.stop_reason, "idle");
  assert.equal(result.next_action, "none");
  assert.equal(result.run_report_artifact.path.startsWith("factory/verification/researchbrain-stage0-supervisor-runs/"), true);
  assert.equal(fs.existsSync(path.join(rootDir, result.run_report_artifact.path)), true);
  assert.equal(result.run_report_artifact.sha256, sha256File(path.join(rootDir, result.run_report_artifact.path)));
  assert.equal(path.isAbsolute(result.run_report_artifact.path), false);
  assert.equal(result.run_report_artifact.path.includes(".."), false);
  assertReportConsistency(result.run_report_artifact.consistency, {
    path: result.run_report_artifact.path,
    sha256: result.run_report_artifact.sha256,
    reportType: "supervisor_run",
    schemaVersion: "researchbrain_stage0_supervisor_run_report_v1"
  });
  assert.equal(result.report_artifact_summary.requested.run_report, true);
  assert.equal(result.report_artifact_summary.requested.failure_report, false);
  assert.equal(result.report_artifact_summary.written.run_report, true);
  assert.equal(result.report_artifact_summary.all_requested_reports_written, true);
  assert.equal(result.report_artifact_summary.all_written_reports_verified, true);
  assert.equal(result.report_artifact_summary.artifacts.run_report.verified, true);
  assert.equal(result.operational_summary.report_artifacts_all_verified, true);
  assert.equal(result.aggregate.final_operational_snapshot.status, "ready");
  assert.equal(result.aggregate.final_operational_snapshot.jobs.stage0_ready, 1);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.pending, 0);
  assert.equal(result.aggregate.final_operational_snapshot.outbox.processed, 1);
  assert.equal(result.aggregate.final_operational_snapshot.runtime_consistency.inconsistent_final_jobs, 0);

  const artifact = JSON.parse(fs.readFileSync(path.join(rootDir, result.run_report_artifact.path), "utf8"));
  assert.equal(artifact.schema_version, "researchbrain_stage0_supervisor_run_report_v1");
  assert.equal(artifact.report_metadata.report_type, "supervisor_run");
  assert.equal(artifact.report_metadata.artifact_path, result.run_report_artifact.path);
  assert.equal(artifact.report_metadata.path_scope, "repo_relative");
  assert.equal(artifact.report_metadata.schema_stable, true);
  assert.equal(artifact.report_metadata.sha256_recorded_by_writer, true);
  assert.equal(artifact.report_metadata.diagnostic_only, true);
  assert.equal(artifact.authority.non_authoritative_operational_report, true);
  assert.equal(artifact.authority.official_state_mutated, false);
  assert.equal(artifact.authority.wfa_executed, false);
  assert.equal(artifact.authority.mt5_executed, false);
  assert.equal(artifact.authority.phase8e_started, false);
  assert.equal(artifact.supervisor_result.status, "completed");
  assert.equal(artifact.supervisor_result.aggregate.final_operational_snapshot.jobs.stage0_ready, 1);
  assert.equal(artifact.supervisor_result.run_report_artifact, null);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor cycles return a bounded failure envelope", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CYCLES-FAILURE");
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 2,
    requestPath: request.artifact.path,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "failed");
  assert.equal(result.stop_reason, "cycle_failed");
  assert.equal(result.next_action, "inspect_operational_blocker");
  assert.equal(result.recommendation.status, "action_required");
  assert.equal(result.recommendation.reason, "supervisor_seed_failure");
  assert.equal(result.recommendation.failed_stage, "seed");
  assert.equal(result.recommendation.diagnostic_only, true);
  assert.equal(result.supervisor_health.status, "failed");
  assert.equal(result.supervisor_health.alert_level, "critical");
  assert.equal(result.supervisor_health.failed_stage, "seed");
  assert.equal(result.supervisor_health.safe_to_run_another_bounded_cycle, false);
  assert.equal(result.supervisor_health.operator_inspection_required, true);
  assert.equal(result.operational_summary.status, "failed");
  assert.equal(result.operational_summary.failed_stage, "seed");
  assert.equal(result.operational_summary.next_action, "inspect_operational_blocker");
  assert.equal(result.operational_summary.cycles_run, 0);
  assert.equal(result.aggregate.cycles_run, 0);
  assert.equal(result.failure.cycle_number, 1);
  assert.equal(result.failure.failed_stage, "seed");
  assert.equal(result.failure.cycles_completed_before_failure, 0);
  assert.equal(result.failure.partial_cycle_summary.seed_status, null);
  assert.equal(result.failure.partial_cycle_summary.jobs_processed, 0);
  assert.match(result.failure.error_message, /requires both requestPath and requestSha256/);
  assert.equal(result.failure_artifact, null);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 supervisor failure report preserves partial progress for outbox-stage exceptions", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-OUTBOX-FAILURE");
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0SupervisorCycles({
    rootDir,
    cycles: 2,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    projectionDir: path.join(os.tmpdir(), "outside-stage0-projections"),
    failureReportDir: "factory/verification/researchbrain-stage0-supervisor-failures",
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });

  assert.equal(result.status, "failed");
  assert.equal(result.stop_reason, "cycle_failed");
  assert.equal(result.next_action, "inspect_operational_blocker");
  assert.equal(result.recommendation.status, "action_required");
  assert.equal(result.recommendation.reason, "supervisor_outbox_failure");
  assert.equal(result.recommendation.failed_stage, "outbox");
  assert.equal(result.supervisor_health.status, "failed");
  assert.equal(result.supervisor_health.failed_stage, "outbox");
  assert.equal(result.supervisor_health.operator_inspection_required, true);
  assert.equal(result.operational_summary.status, "failed");
  assert.equal(result.operational_summary.failed_stage, "outbox");
  assert.equal(result.operational_summary.report_artifacts_all_verified, true);
  assert.equal(result.aggregate.cycles_run, 0);
  assert.equal(result.failure.cycle_number, 1);
  assert.equal(result.failure.failed_stage, "outbox");
  assert.equal(result.failure.cycles_completed_before_failure, 0);
  assert.equal(result.failure.partial_cycle_summary.seed_status, "seeded");
  assert.equal(result.failure.partial_cycle_summary.loop_status, "processed");
  assert.equal(result.failure.partial_cycle_summary.jobs_processed, 1);
  assert.equal(result.failure.partial_cycle_summary.ready_jobs, 1);
  assert.equal(result.failure.partial_cycle_summary.outbox_status, null);
  assert.match(result.failure.error_message, /outbox output_dir must be a repo-relative path/);
  assert.equal(result.failure_artifact.path.startsWith("factory/verification/researchbrain-stage0-supervisor-failures/"), true);
  assert.equal(fs.existsSync(path.join(rootDir, result.failure_artifact.path)), true);
  assert.equal(result.failure_artifact.sha256, sha256File(path.join(rootDir, result.failure_artifact.path)));
  assert.equal(path.isAbsolute(result.failure_artifact.path), false);
  assert.equal(result.failure_artifact.path.includes(".."), false);
  assertReportConsistency(result.failure_artifact.consistency, {
    path: result.failure_artifact.path,
    sha256: result.failure_artifact.sha256,
    reportType: "supervisor_failure",
    schemaVersion: "researchbrain_stage0_supervisor_failure_report_v1"
  });
  assert.equal(result.report_artifact_summary.requested.failure_report, true);
  assert.equal(result.report_artifact_summary.written.failure_report, true);
  assert.equal(result.report_artifact_summary.all_requested_reports_written, true);
  assert.equal(result.report_artifact_summary.all_written_reports_verified, true);
  assert.equal(result.report_artifact_summary.artifacts.failure_report.verified, true);

  const artifact = JSON.parse(fs.readFileSync(path.join(rootDir, result.failure_artifact.path), "utf8"));
  assert.equal(artifact.schema_version, "researchbrain_stage0_supervisor_failure_report_v1");
  assert.equal(artifact.report_metadata.report_type, "supervisor_failure");
  assert.equal(artifact.report_metadata.artifact_path, result.failure_artifact.path);
  assert.equal(artifact.report_metadata.path_scope, "repo_relative");
  assert.equal(artifact.report_metadata.schema_stable, true);
  assert.equal(artifact.report_metadata.sha256_recorded_by_writer, true);
  assert.equal(artifact.report_metadata.diagnostic_only, true);
  assert.equal(artifact.authority.non_authoritative_operational_report, true);
  assert.equal(artifact.authority.official_state_mutated, false);
  assert.equal(artifact.authority.wfa_executed, false);
  assert.equal(artifact.authority.mt5_executed, false);
  assert.equal(artifact.authority.phase8e_started, false);
  assert.equal(artifact.supervisor_result.failure.failed_stage, "outbox");
  assert.equal(artifact.supervisor_result.failure.partial_cycle_summary.jobs_processed, 1);
  assert.equal(artifact.supervisor_result.failure_artifact, null);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT status, COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0' GROUP BY status").all();
    const byStatus = Object.fromEntries(jobs.map((row) => [row.status, row.count]));
    const pending = ledger.db.prepare("SELECT COUNT(*) AS count FROM outbox WHERE event_type = 'researchbrain.stage0_job_finished' AND status = 'pending'").get();
    assert.equal(byStatus.stage0_ready, 1);
    assert.equal(pending.count, 1);
  });
});

test("ResearchBrain Stage-0 supervisor CLI can emit JSON failure envelope and failure artifact", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CLI-FAILURE");

  const result = spawnSync("node", [
    "scripts/run-researchbrain-stage0-supervisor.mjs",
    "--root", rootDir,
    "--request-path", request.artifact.path,
    "--failure-report-dir", "factory/verification/researchbrain-stage0-supervisor-failures",
    "--max-attempts", "1",
    "--max-provider-calls", "1",
    "--timeout-ms", "1000"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /ResearchBrain Stage-0 supervisor failure_report_dir/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, "researchbrain_stage0_supervisor_run_result_v1");
  assert.equal(output.status, "failed");
  assert.equal(output.next_action, "inspect_operational_blocker");
  assert.equal(output.recommendation.reason, "supervisor_seed_failure");
  assert.equal(output.supervisor_health.status, "failed");
  assert.equal(output.supervisor_health.operator_inspection_required, true);
  assert.equal(output.operational_summary.status, "failed");
  assert.equal(output.operational_summary.failed_stage, "seed");
  assert.equal(output.report_artifact_summary.written.failure_report, true);
  assert.equal(output.report_artifact_summary.all_written_reports_verified, true);
  assert.equal(output.failure.failed_stage, "seed");
  assert.match(output.failure.error_message, /requires both requestPath and requestSha256/);
  assert.equal(output.failure_artifact.path.startsWith("factory/verification/researchbrain-stage0-supervisor-failures/"), true);
  assert.equal(fs.existsSync(path.join(rootDir, output.failure_artifact.path)), true);
  assertReportConsistency(output.failure_artifact.consistency, {
    path: output.failure_artifact.path,
    sha256: output.failure_artifact.sha256,
    reportType: "supervisor_failure",
    schemaVersion: "researchbrain_stage0_supervisor_failure_report_v1"
  });
  assert.equal(output.wfa_executed, false);
  assert.equal(output.mt5_executed, false);
  assert.equal(output.phase8e_started, false);
});

test("ResearchBrain Stage-0 supervisor CLI emits JSON cycle result", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CLI");

  const result = spawnSync("node", [
    "scripts/run-researchbrain-stage0-supervisor.mjs",
    "--root", rootDir,
    "--request-path", request.artifact.path,
    "--request-sha256", request.artifact.sha256,
    "--max-attempts", "1",
    "--max-provider-calls", "1",
    "--timeout-ms", "1000"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, "researchbrain_stage0_supervisor_result_v1");
  assert.equal(output.next_action, "none");
  assert.equal(output.recommendation.status, "ok");
  assert.equal(output.supervisor_health.status, "healthy");
  assert.equal(output.supervisor_health.safe_to_run_another_bounded_cycle, true);
  assert.equal(output.operational_summary.status, "completed");
  assert.equal(output.operational_summary.progress_made, true);
  assert.equal(output.operational_summary.remaining_claimable_jobs, 0);
  assert.equal(output.seed.status, "seeded");
  assert.equal(output.loop.jobs_processed, 1);
  assert.equal(output.outbox.events_processed, 1);
  assert.equal(output.diagnostics.outbox.by_status.processed, 1);
  assert.equal(output.readiness_summary.status, "ready");
  assert.equal(output.readiness_summary.authority.phase8e_started, false);
});

test("ResearchBrain Stage-0 supervisor CLI emits JSON multi-cycle result", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CLI-CYCLES");

  const result = spawnSync("node", [
    "scripts/run-researchbrain-stage0-supervisor.mjs",
    "--root", rootDir,
    "--request-path", request.artifact.path,
    "--request-sha256", request.artifact.sha256,
    "--cycles", "2",
    "--max-attempts", "1",
    "--max-provider-calls", "1",
    "--timeout-ms", "1000",
    "--readiness-request-limit", "10",
    "--processed-outbox-limit", "10",
    "--run-report-dir", "factory/verification/researchbrain-stage0-supervisor-runs"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, "researchbrain_stage0_supervisor_run_result_v1");
  assert.equal(output.status, "completed");
  assert.equal(output.stop_reason, "idle");
  assert.equal(output.next_action, "none");
  assert.equal(output.recommendation.status, "ok");
  assert.equal(output.operational_summary.status, "completed");
  assert.equal(output.operational_summary.report_artifacts_all_verified, true);
  assert.equal(output.report_artifact_summary.all_written_reports_verified, true);
  assert.equal(output.aggregate.cycles_run, 2);
  assert.equal(output.aggregate.totals.seeded, 1);
  assert.equal(output.aggregate.totals.jobs_processed, 1);
  assert.equal(output.aggregate.totals.outbox_events_processed, 1);
  assert.equal(output.aggregate.final_operational_snapshot.status, "ready");
  assert.equal(output.aggregate.final_operational_snapshot.outbox.processed, 1);
  assert.equal(output.aggregate.final_readiness_summary.status, "ready");
  assert.equal(output.run_report_artifact.path.startsWith("factory/verification/researchbrain-stage0-supervisor-runs/"), true);
  assert.equal(fs.existsSync(path.join(rootDir, output.run_report_artifact.path)), true);
  assertReportConsistency(output.run_report_artifact.consistency, {
    path: output.run_report_artifact.path,
    sha256: output.run_report_artifact.sha256,
    reportType: "supervisor_run",
    schemaVersion: "researchbrain_stage0_supervisor_run_report_v1"
  });
  assert.equal(output.official_state_mutated, false);
  assert.equal(output.wfa_executed, false);
  assert.equal(output.mt5_executed, false);
  assert.equal(output.phase8e_started, false);
});

test("ResearchBrain Stage-0 supervisor CLI can fail on attention while preserving JSON and run report", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const firstRequest = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CLI-ATTENTION-A");
  const secondRequest = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-CLI-ATTENTION-B");
  seedResearchBrainStage0Job({ rootDir, requestPath: firstRequest.artifact.path, requestSha256: firstRequest.artifact.sha256, maxAttempts: 1, maxProviderCalls: 1, timeoutMs: 1000, retryDelayMs: 0 });
  seedResearchBrainStage0Job({ rootDir, requestPath: secondRequest.artifact.path, requestSha256: secondRequest.artifact.sha256, maxAttempts: 1, maxProviderCalls: 1, timeoutMs: 1000, retryDelayMs: 0 });

  const result = spawnSync("node", [
    "scripts/run-researchbrain-stage0-supervisor.mjs",
    "--root", rootDir,
    "--cycles", "1",
    "--max-jobs", "1",
    "--max-attempts", "1",
    "--max-provider-calls", "1",
    "--timeout-ms", "1000",
    "--readiness-request-limit", "10",
    "--processed-outbox-limit", "10",
    "--run-report-dir", "factory/verification/researchbrain-stage0-supervisor-runs",
    "--fail-on-attention"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "attention");
  assert.equal(output.next_action, "continue_bounded_cycles");
  assert.equal(output.recommendation.status, "continue");
  assert.equal(output.recommendation.reason, "drainable_stage0_work_remaining");
  assert.equal(output.supervisor_health.status, "drainable");
  assert.equal(output.supervisor_health.operator_inspection_required, false);
  assert.equal(output.operational_summary.status, "attention");
  assert.equal(output.operational_summary.next_action, "continue_bounded_cycles");
  assert.equal(output.operational_summary.remaining_claimable_jobs, 1);
  assert.equal(output.report_artifact_summary.all_written_reports_verified, true);
  assert.equal(output.aggregate.attention_class_counts.drainable, 1);
  assert.equal(output.aggregate.final_operational_snapshot.attention_classification.status, "drainable");
  assert.deepEqual(output.aggregate.final_operational_snapshot.attention_classification.actionable_reasons, []);
  assert.equal(output.aggregate.final_operational_snapshot.jobs.claimable_stale_or_ready, 1);
  assert.equal(output.run_report_artifact.path.startsWith("factory/verification/researchbrain-stage0-supervisor-runs/"), true);
  assert.equal(fs.existsSync(path.join(rootDir, output.run_report_artifact.path)), true);
  assertReportConsistency(output.run_report_artifact.consistency, {
    path: output.run_report_artifact.path,
    sha256: output.run_report_artifact.sha256,
    reportType: "supervisor_run",
    schemaVersion: "researchbrain_stage0_supervisor_run_report_v1"
  });
  assert.equal(output.official_state_mutated, false);
  assert.equal(output.wfa_executed, false);
  assert.equal(output.mt5_executed, false);
  assert.equal(output.phase8e_started, false);
});

test("ResearchBrain Stage-0 supervisor and readiness npm scripts point to existing CLIs", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

  assert.equal(packageJson.scripts["researchbrain:stage0-supervisor"], "node scripts/run-researchbrain-stage0-supervisor.mjs");
  assert.equal(packageJson.scripts["researchbrain:stage0-readiness"], "node scripts/run-researchbrain-stage0-readiness.mjs");
  assert.equal(fs.existsSync(path.join(process.cwd(), "scripts/run-researchbrain-stage0-supervisor.mjs")), true);
  assert.equal(fs.existsSync(path.join(process.cwd(), "scripts/run-researchbrain-stage0-readiness.mjs")), true);
});

test("ResearchBrain Stage-0 supervisor rejects partial seed args and overly broad loop bounds", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SUPERVISOR-REJECT");

  await assert.rejects(
    () => runResearchBrainStage0Supervisor({ rootDir, requestPath: request.artifact.path }),
    /requires both requestPath and requestSha256/
  );
  await assert.rejects(
    () => runResearchBrainStage0Supervisor({ rootDir, maxJobs: 26 }),
    /maxJobs must be an integer from 1 to 25/
  );
});

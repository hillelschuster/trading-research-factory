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
import { buildResearchBrainStage0ReadinessReport, writeResearchBrainStage0ReadinessReport } from "../src/core/researchbrain-stage0-readiness.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-readiness-test-"));
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

function setFixtureMtime(rootDir, repoPath, isoTime) {
  const fullPath = path.join(rootDir, repoPath);
  const date = new Date(isoTime);
  fs.utimesSync(fullPath, date, date);
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
  const universe = writeJsonFixture(rootDir, "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-READINESS-TEST/universe-snapshot.json", {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    server: "FTMO-Demo",
    symbol_count_total: 3,
    symbols: [{ name: "EURUSD" }, { name: "XAUUSD" }, { name: "BTCUSD" }]
  });
  const inventory = writeJsonFixture(rootDir, "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-READINESS-TEST/inventory.json", {
    schema_version: "mt5_terminal_inventory_v1",
    inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-READINESS-TEST",
    counts: { total_symbols: 3 }
  });
  return { universe_snapshot: universe, terminal_inventory: inventory };
}

function writeRequest(rootDir, requestId = "RESEARCHBRAIN-REQUEST-READINESS-TEST") {
  const refs = phase8ARefs(rootDir);
  return writeResearchBrainRequestArtifact({
    rootDir,
    requestId,
    observedAt: "2026-06-04T14:00:00Z",
    universeSnapshotPath: refs.universe_snapshot.path,
    terminalInventoryPath: refs.terminal_inventory.path,
    priorFailedPatterns: ["Manual Phase 8D strategy roulette stopped after zero survivors."],
    priorLessons: ["ResearchBrain Stage-0 output must remain source-backed and non-authoritative."],
    maxSources: 4,
    maxHypotheses: 2
  });
}

test("ResearchBrain Stage-0 readiness reports unseeded valid requests without official mutation", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const request = writeRequest(rootDir);

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10 });

  assert.equal(report.schema_version, "researchbrain_stage0_ops_readiness_report_v1");
  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("unseeded_valid_request_artifacts"), true);
  assert.equal(report.requests.scanned, 1);
  assert.equal(report.requests.valid, 1);
  assert.equal(report.requests.unseeded_valid, 1);
  assert.equal(report.requests.entries[0].path, request.artifact.path);
  assert.equal(report.requests.entries[0].seeded, false);
  assert.equal(report.seeded_jobs.total, 0);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness links seeded request artifacts and can write non-authoritative verification report", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-READINESS-SEEDED");
  const seeded = seedResearchBrainStage0Job({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256, maxAttempts: 1 });

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10 });
  const write = writeResearchBrainStage0ReadinessReport(rootDir, report);

  assert.equal(report.requests.seeded, 1);
  assert.equal(report.requests.unseeded_valid, 0);
  assert.equal(report.requests.entries[0].seeded_job.job_id, seeded.job_id);
  assert.equal(report.seeded_jobs.total, 1);
  assert.equal(fs.existsSync(write.path), true);
  assert.equal(write.path.startsWith(path.join(rootDir, "factory/verification/")), true);
  assert.equal(write.sha256, sha256File(write.path));
  const written = JSON.parse(fs.readFileSync(write.path, "utf8"));
  assert.equal(written.schema_version, "researchbrain_stage0_ops_readiness_report_v1");
  assert.equal(written.authority.official_backlog_mutated, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness CLI emits JSON and optionally writes verification artifact", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-READINESS-CLI");
  seedResearchBrainStage0Job({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256 });

  const readOnly = spawnSync("node", ["scripts/run-researchbrain-stage0-readiness.mjs", "--root", rootDir, "--request-limit", "10"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(readOnly.status, 0, readOnly.stderr || readOnly.stdout);
  const report = JSON.parse(readOnly.stdout);
  assert.equal(report.schema_version, "researchbrain_stage0_ops_readiness_report_v1");
  assert.equal(report.requests.seeded, 1);

  const write = spawnSync("node", ["scripts/run-researchbrain-stage0-readiness.mjs", "--root", rootDir, "--request-limit", "10", "--write"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(write.status, 0, write.stderr || write.stdout);
  const output = JSON.parse(write.stdout);
  assert.equal(fs.existsSync(output.path), true);
  assert.equal(output.sha256, sha256File(output.path));
  assert.equal(output.report.schema_version, "researchbrain_stage0_ops_readiness_report_v1");
});

test("ResearchBrain Stage-0 readiness CLI supports processed outbox scan limit", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);

  const result = spawnSync("node", ["scripts/run-researchbrain-stage0-readiness.mjs", "--root", rootDir, "--processed-outbox-limit", "1"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.projection_health.processed_outbox.limit, 1);
  assert.equal(report.projection_health.processed_outbox.checked_processed_events, 0);
});

test("ResearchBrain Stage-0 readiness flags final-job runtime ledger consistency drift", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const runId = "RUN-RB-STAGE0-RUNTIME-CONSISTENCY-DRIFT";
  const jobId = "JOB-RB-STAGE0-RUNTIME-CONSISTENCY-DRIFT";
  const attemptId = "ATTEMPT-RB-STAGE0-RUNTIME-CONSISTENCY-DRIFT";

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
    ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "blocked", worker: "researchbrain_stage0_loop_runner" });
  } finally {
    ledger.close();
  }

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 0, runtimeConsistencyLimit: 10 });
  const entry = report.runtime_consistency.entries[0];

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("runtime_ledger_consistency_attention"), true);
  assert.equal(report.runtime_consistency.status, "attention");
  assert.equal(report.runtime_consistency.checked_final_jobs, 1);
  assert.equal(report.runtime_consistency.inconsistent_final_jobs, 1);
  assert.equal(report.runtime_consistency.issue_counts_by_reason.final_job_run_status_mismatch, 1);
  assert.equal(report.runtime_consistency.issue_counts_by_reason.final_job_latest_attempt_status_mismatch, 1);
  assert.equal(report.runtime_consistency.issue_counts_by_reason.final_job_missing_finished_outbox_event, 1);
  assert.equal(entry.job_id, jobId);
  assert.equal(entry.ok, false);
  assert.equal(entry.issues.some((issue) => issue.reason === "final_job_run_status_mismatch"), true);
  assert.equal(entry.issues.some((issue) => issue.reason === "final_job_latest_attempt_status_mismatch"), true);
  assert.equal(entry.issues.some((issue) => issue.reason === "final_job_missing_finished_outbox_event"), true);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness flags stale projection references without official mutation", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const projection = writeJsonFixture(rootDir, "factory/runtime/projections/researchbrain-stage0/EVT-RB-STAGE0-STALE.json", {
    schema_version: "researchbrain_stage0_outbox_projection_v1",
    projected_at: "2026-06-04T15:00:00Z",
    consumer_id: "readiness-test",
    event: {
      event_id: "EVT-RB-STAGE0-STALE",
      event_type: "researchbrain.stage0_job_finished",
      aggregate_type: "run",
      aggregate_id: "RUN-RESEARCHBRAIN-STAGE0-STALE",
      created_at: "2026-06-04T15:00:00Z",
      payload: {
        job_id: "JOB-RESEARCHBRAIN-STAGE0-STALE",
        attempt_id: "ATTEMPT-RESEARCHBRAIN-STAGE0-STALE",
        status: "blocked",
        failure_summary: {
          request_artifact: {
            path: "factory/research/requests/missing-request.json",
            sha256: "0".repeat(64)
          }
        }
      }
    },
    run: { run_id: "RUN-RESEARCHBRAIN-STAGE0-STALE", status: "blocked" },
    job: { job_id: "JOB-RESEARCHBRAIN-STAGE0-STALE", run_id: "RUN-RESEARCHBRAIN-STAGE0-STALE", status: "blocked" },
    attempt: { attempt_id: "ATTEMPT-RESEARCHBRAIN-STAGE0-STALE", job_id: "JOB-RESEARCHBRAIN-STAGE0-STALE", status: "blocked" },
    failure_summary: {
      request_artifact: {
        path: "factory/research/requests/missing-request.json",
        sha256: "0".repeat(64)
      }
    },
    artifacts: [{
      artifact_type: "researchbrain_stage0_runtime_result",
      path: "factory/research/runs/RUN-RESEARCHBRAIN-STAGE0-STALE/runtime-result.json",
      sha256: "1".repeat(64)
    }],
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    wfa_executed: false,
    mt5_executed: false
  });

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("stale_projection_refs"), true);
  assert.equal(report.projection_health.latest_stale_or_mismatched, 1);
  assert.equal(report.projection_health.integrity.checked_latest, 1);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.missing_outbox_event, 1);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.missing_job, 1);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.artifact_missing, 3);
  const entry = report.projection_health.integrity.entries[0];
  assert.equal(entry.path, projection.path);
  assert.equal(entry.ok, false);
  assert.equal(entry.issues.some((issue) => issue.reason === "missing_outbox_event"), true);
  assert.equal(entry.issues.some((issue) => issue.reason === "missing_job"), true);
  assert.equal(entry.issues.some((issue) => issue.reason === "artifact_missing" && issue.path === "factory/research/requests/missing-request.json"), true);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness flags seeded output directory run-id collisions", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-READINESS-OUTPUT-COLLISION");
  const outputDir = "factory/research/runs/RUN-RB-STAGE0-COLLISION-DIR";
  const seeded = seedResearchBrainStage0Job({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    outputDir,
    maxAttempts: 1,
    maxProviderCalls: 1
  });
  writeJsonFixture(rootDir, `${outputDir}/runtime-result.json`, {
    schema_version: "researchbrain_stage0_runtime_result_v1",
    run_id: "RUN-RB-STAGE0-OTHER-RUN",
    status: "ready"
  });
  writeJsonFixture(rootDir, `${outputDir}/manifest/manifest.json`, {
    schema_version: "researchbrain_stage0_manifest_v1",
    manifest_id: "RUN-RB-STAGE0-OTHER-RUN",
    research_run_id: "RUN-RB-STAGE0-OTHER-RUN",
    status: "ready"
  });

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10 });
  const entry = report.requests.entries.find((item) => item.path === request.artifact.path);

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("seeded_output_collision"), true);
  assert.equal(report.requests.seeded, 1);
  assert.equal(report.requests.seeded_output_collisions, 1);
  assert.equal(entry.seeded_job.job_id, seeded.job_id);
  assert.equal(entry.seeded_job.output_collision.status, "attention");
  assert.equal(entry.seeded_job.output_collision.issues.some((issue) => issue.reason === "output_run_id_collision" && issue.expected_run_id === seeded.run_id), true);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness flags runtime-result request refs that disagree with projection request artifacts", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const runId = "RUN-RB-STAGE0-REQUEST-REF-MISMATCH";
  const jobId = "JOB-RB-STAGE0-REQUEST-REF-MISMATCH";
  const attemptId = "ATTEMPT-RB-STAGE0-REQUEST-REF-MISMATCH";
  const eventId = "EVT-RB-STAGE0-REQUEST-REF-MISMATCH";
  const projectionRequest = writeJsonFixture(rootDir, "factory/research/requests/projection-request.json", { request_id: "projection-request" });
  const runtimeRequest = writeJsonFixture(rootDir, "factory/research/requests/runtime-request.json", { request_id: "runtime-request" });
  const runtimeResult = writeJsonFixture(rootDir, "factory/research/runs/RUN-RB-STAGE0-REQUEST-REF-MISMATCH/runtime-result.json", {
    schema_version: "researchbrain_stage0_runtime_result_v1",
    run_id: "RUN-RB-STAGE0-REQUEST-REF-MISMATCH",
    status: "blocked",
    request_ref: {
      path: runtimeRequest.path,
      sha256: runtimeRequest.sha256
    }
  });

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "blocked", priority: 1 });
    ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "blocked", worker: "researchbrain_stage0_loop_runner" });
    ledger.insertArtifact({
      artifact_id: "ART-RB-STAGE0-REQUEST-REF-MISMATCH-RESULT",
      run_id: runId,
      job_id: jobId,
      attempt_id: attemptId,
      artifact_type: "researchbrain_stage0_runtime_result",
      path: runtimeResult.path,
      sha256: runtimeResult.sha256,
      size_bytes: fs.statSync(path.join(rootDir, runtimeResult.path)).size
    });
    ledger.recordRunStatusWithOutbox({
      run_id: runId,
      status: "blocked",
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      payload: {
        job_id: jobId,
        attempt_id: attemptId,
        status: "blocked",
        failure_summary: {
          request_artifact: projectionRequest,
          runtime_result_artifact: { artifact_type: "researchbrain_stage0_runtime_result", ...runtimeResult }
        }
      }
    });
  } finally {
    ledger.close();
  }

  const projection = writeJsonFixture(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/${eventId}.json`, {
    schema_version: "researchbrain_stage0_outbox_projection_v1",
    projected_at: "2026-06-05T14:00:00Z",
    consumer_id: "readiness-request-ref-test",
    event: {
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      aggregate_type: "run",
      aggregate_id: runId,
      created_at: "2026-06-05T14:00:00Z",
      payload: {
        job_id: jobId,
        attempt_id: attemptId,
        status: "blocked",
        failure_summary: {
          request_artifact: projectionRequest,
          runtime_result_artifact: { artifact_type: "researchbrain_stage0_runtime_result", ...runtimeResult }
        }
      }
    },
    run: { run_id: runId, status: "blocked" },
    job: { job_id: jobId, run_id: runId, status: "blocked" },
    attempt: { attempt_id: attemptId, job_id: jobId, status: "blocked" },
    failure_summary: {
      request_artifact: projectionRequest,
      runtime_result_artifact: { artifact_type: "researchbrain_stage0_runtime_result", ...runtimeResult }
    },
    artifacts: [{ artifact_type: "researchbrain_stage0_runtime_result", ...runtimeResult }],
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    wfa_executed: false,
    mt5_executed: false
  });

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });
  const entry = report.projection_health.integrity.entries.find((item) => item.path === projection.path);

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("stale_projection_refs"), true);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.runtime_result_request_ref_mismatch, 3);
  assert.equal(entry.ok, false);
  assert.equal(entry.issues.some((issue) => issue.reason === "missing_run"), false);
  assert.equal(entry.issues.some((issue) => issue.reason === "artifact_sha_mismatch"), false);
  const mismatch = entry.issues.find((issue) => issue.reason === "runtime_result_request_ref_mismatch");
  assert.equal(Boolean(mismatch), true);
  assert.equal(mismatch.runtime_request_ref.path, runtimeRequest.path);
  assert.equal(mismatch.runtime_request_ref.sha256, runtimeRequest.sha256);
  assert.equal(mismatch.expected_request_refs.some((ref) => ref.path === projectionRequest.path && ref.sha256 === projectionRequest.sha256), true);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness flags projection status drift and unmirrored runtime artifacts", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const runId = "RUN-RB-STAGE0-LEDGER-DRIFT";
  const jobId = "JOB-RB-STAGE0-LEDGER-DRIFT";
  const attemptId = "ATTEMPT-RB-STAGE0-LEDGER-DRIFT";
  const eventId = "EVT-RB-STAGE0-LEDGER-DRIFT";
  const runtimeResult = writeJsonFixture(rootDir, "factory/research/runs/RUN-RB-STAGE0-LEDGER-DRIFT/runtime-result.json", {
    schema_version: "researchbrain_stage0_runtime_result_v1",
    run_id: runId,
    status: "blocked"
  });

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "stage0_ready", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
    ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "stage0_ready", worker: "researchbrain_stage0_loop_runner" });
    ledger.recordRunStatusWithOutbox({
      run_id: runId,
      status: "stage0_ready",
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" }
    });
  } finally {
    ledger.close();
  }

  const projection = writeJsonFixture(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/${eventId}.json`, {
    schema_version: "researchbrain_stage0_outbox_projection_v1",
    projected_at: "2026-06-05T18:00:00Z",
    consumer_id: "readiness-ledger-drift-test",
    event: {
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      aggregate_type: "run",
      aggregate_id: runId,
      created_at: "2026-06-05T18:00:00Z",
      payload: { job_id: jobId, attempt_id: attemptId, status: "blocked" }
    },
    run: { run_id: runId, status: "blocked" },
    job: { job_id: jobId, run_id: runId, status: "blocked" },
    attempt: { attempt_id: attemptId, job_id: jobId, status: "blocked" },
    artifacts: [{ artifact_type: "researchbrain_stage0_runtime_result", ...runtimeResult }],
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    wfa_executed: false,
    mt5_executed: false
  });

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });
  const entry = report.projection_health.integrity.entries.find((item) => item.path === projection.path);

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("stale_projection_refs"), true);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.run_status_mismatch, 1);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.job_status_mismatch, 1);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.attempt_status_mismatch, 1);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.event_run_status_mismatch, 1);
  assert.equal(report.projection_health.integrity.issue_counts_by_reason.artifact_not_mirrored_in_runtime_ledger, 1);
  assert.equal(entry.ok, false);
  assert.equal(entry.issues.some((issue) => issue.reason === "missing_run"), false);
  assert.equal(entry.issues.some((issue) => issue.reason === "artifact_missing"), false);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness flags processed outbox rows without projection artifact results", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const runId = "RUN-RB-STAGE0-OUTBOX-NO-PROJECTION";
  const jobId = "JOB-RB-STAGE0-OUTBOX-NO-PROJECTION";
  const attemptId = "ATTEMPT-RB-STAGE0-OUTBOX-NO-PROJECTION";
  const eventId = "EVT-RB-STAGE0-OUTBOX-NO-PROJECTION";

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
    ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "stage0_ready", worker: "researchbrain_stage0_loop_runner" });
    ledger.recordRunStatusWithOutbox({
      run_id: runId,
      status: "stage0_ready",
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" }
    });
    ledger.markOutboxEventProcessed({ event_id: eventId, consumer_id: "readiness-no-projection-test", now: "2026-06-05T19:00:00.000Z", result: {} });
  } finally {
    ledger.close();
  }

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("processed_outbox_projection_mismatch"), true);
  assert.equal(report.projection_health.processed_outbox.checked_processed_events, 1);
  assert.equal(report.projection_health.processed_outbox.mismatched_processed_events, 1);
  assert.equal(report.projection_health.processed_outbox.issue_counts_by_reason.processed_outbox_missing_projection_artifact, 1);
  assert.equal(report.projection_health.processed_outbox.entries[0].event_id, eventId);
  assert.equal(report.projection_health.processed_outbox.entries[0].ok, false);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness flags duplicate projection files for one processed event", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const runId = "RUN-RB-STAGE0-DUPLICATE-PROJECTION";
  const jobId = "JOB-RB-STAGE0-DUPLICATE-PROJECTION";
  const attemptId = "ATTEMPT-RB-STAGE0-DUPLICATE-PROJECTION";
  const eventId = "EVT-RB-STAGE0-DUPLICATE-PROJECTION";
  const projectionPayload = {
    schema_version: "researchbrain_stage0_outbox_projection_v1",
    projected_at: "2026-06-05T19:10:00.000Z",
    consumer_id: "readiness-duplicate-projection-test",
    event: {
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      aggregate_type: "run",
      aggregate_id: runId,
      created_at: "2026-06-05T19:10:00.000Z",
      payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" }
    },
    run: { run_id: runId, status: "stage0_ready" },
    job: { job_id: jobId, run_id: runId, status: "stage0_ready" },
    attempt: { attempt_id: attemptId, job_id: jobId, status: "stage0_ready" },
    artifacts: [],
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    wfa_executed: false,
    mt5_executed: false
  };
  const projection = writeJsonFixture(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/${eventId}.json`, projectionPayload);
  writeJsonFixture(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/${eventId}-copy.json`, projectionPayload);
  setFixtureMtime(rootDir, projection.path, "2026-06-05T19:10:00.000Z");
  setFixtureMtime(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/${eventId}-copy.json`, "2026-06-05T19:10:00.000Z");

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
    ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "stage0_ready", worker: "researchbrain_stage0_loop_runner" });
    ledger.recordRunStatusWithOutbox({
      run_id: runId,
      status: "stage0_ready",
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" }
    });
    ledger.markOutboxEventProcessed({
      event_id: eventId,
      consumer_id: "readiness-duplicate-projection-test",
      now: "2026-06-05T19:10:00.000Z",
      result: { projection_artifact: projection }
    });
  } finally {
    ledger.close();
  }

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("processed_outbox_projection_mismatch"), true);
  assert.equal(report.projection_health.processed_outbox.checked_processed_events, 1);
  assert.equal(report.projection_health.processed_outbox.mismatched_processed_events, 0);
  assert.equal(report.projection_health.processed_outbox.duplicate_projection_events, 1);
  assert.equal(report.projection_health.processed_outbox.stale_duplicate_projection_files, 1);
  assert.equal(report.projection_health.processed_outbox.issue_counts_by_reason.duplicate_projection_event, 1);
  assert.equal(report.projection_health.processed_outbox.issue_counts_by_reason.stale_duplicate_projection_file, 1);
  assert.equal(report.projection_health.processed_outbox.duplicates[0].event_id, eventId);
  assert.equal(report.projection_health.processed_outbox.entries[0].ok, true);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness reports projection recovery gaps without rewriting files", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const runId = "RUN-RB-STAGE0-PROJECTION-RECOVERY";
  const jobId = "JOB-RB-STAGE0-PROJECTION-RECOVERY";
  const attemptId = "ATTEMPT-RB-STAGE0-PROJECTION-RECOVERY";
  const eventId = "EVT-RB-STAGE0-PROJECTION-RECOVERY";
  const orphanProjection = writeJsonFixture(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/EVT-RB-STAGE0-ORPHAN-PROJECTION.json`, {
    schema_version: "researchbrain_stage0_outbox_projection_v1",
    projected_at: "2026-06-06T08:00:00.000Z",
    consumer_id: "readiness-projection-recovery-test",
    event: {
      event_id: "EVT-RB-STAGE0-ORPHAN-PROJECTION",
      event_type: "researchbrain.stage0_job_finished",
      aggregate_type: "run",
      aggregate_id: "RUN-RB-STAGE0-ORPHAN-PROJECTION",
      created_at: "2026-06-06T08:00:00.000Z",
      payload: { job_id: "JOB-RB-STAGE0-ORPHAN-PROJECTION", attempt_id: "ATTEMPT-RB-STAGE0-ORPHAN-PROJECTION", status: "stage0_ready" }
    },
    run: { run_id: "RUN-RB-STAGE0-ORPHAN-PROJECTION", status: "stage0_ready" },
    job: { job_id: "JOB-RB-STAGE0-ORPHAN-PROJECTION", status: "stage0_ready" },
    attempt: { attempt_id: "ATTEMPT-RB-STAGE0-ORPHAN-PROJECTION", status: "stage0_ready" },
    artifacts: [],
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    wfa_executed: false,
    mt5_executed: false
  });

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
    ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "stage0_ready", worker: "researchbrain_stage0_loop_runner" });
    ledger.recordRunStatusWithOutbox({
      run_id: runId,
      status: "stage0_ready",
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" }
    });
    ledger.markOutboxEventProcessed({
      event_id: eventId,
      consumer_id: "readiness-projection-recovery-test",
      now: "2026-06-06T08:01:00.000Z",
      result: { projection_artifact: { path: "factory/runtime/projections/researchbrain-stage0/missing-projection.json", sha256: "f".repeat(64) } }
    });
  } finally {
    ledger.close();
  }

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10, processedOutboxLimit: 10 });
  const recovery = report.projection_health.processed_outbox.recovery;

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("projection_recovery_attention"), true);
  assert.equal(recovery.checked_processed_without_matching_projection_files, 1);
  assert.equal(recovery.checked_processed_without_matching_projection_file_entries[0].event_id, eventId);
  assert.equal(recovery.orphan_projection_files, 1);
  assert.equal(recovery.orphan_projection_file_entries[0].path, orphanProjection.path);
  assert.equal(report.projection_health.processed_outbox.issue_counts_by_reason.processed_event_without_matching_projection_file, 1);
  assert.equal(report.projection_health.processed_outbox.issue_counts_by_reason.projection_file_without_outbox_event, 1);
  assert.equal(fs.existsSync(path.join(rootDir, orphanProjection.path)), true);
  assert.equal(orphanProjection.sha256, sha256File(path.join(rootDir, orphanProjection.path)));
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness flags projection schema, authority, and freshness drift", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const runId = "RUN-RB-STAGE0-PROJECTION-DRIFT";
  const jobId = "JOB-RB-STAGE0-PROJECTION-DRIFT";
  const attemptId = "ATTEMPT-RB-STAGE0-PROJECTION-DRIFT";
  const eventId = "EVT-RB-STAGE0-PROJECTION-DRIFT";
  const projection = writeJsonFixture(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/${eventId}.json`, {
    schema_version: "wrong_projection_schema",
    projected_at: "2026-06-05T19:20:00.000Z",
    consumer_id: "readiness-drift-projection-consumer",
    event: {
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      aggregate_type: "run",
      aggregate_id: runId,
      created_at: "2026-06-05T19:20:00.000Z",
      payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" }
    },
    run: { run_id: runId, status: "stage0_ready" },
    job: { job_id: jobId, run_id: runId, status: "stage0_ready" },
    attempt: { attempt_id: attemptId, job_id: jobId, status: "stage0_ready" },
    artifacts: [],
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    wfa_executed: true,
    mt5_executed: false
  });
  setFixtureMtime(rootDir, projection.path, "2026-06-05T19:20:10.000Z");

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
    ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
    ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "stage0_ready", worker: "researchbrain_stage0_loop_runner" });
    ledger.recordRunStatusWithOutbox({
      run_id: runId,
      status: "stage0_ready",
      event_id: eventId,
      event_type: "researchbrain.stage0_job_finished",
      payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" }
    });
    ledger.markOutboxEventProcessed({
      event_id: eventId,
      consumer_id: "readiness-drift-test",
      now: "2026-06-05T19:20:00.000Z",
      result: { projection_artifact: { ...projection, size_bytes: 1 }, projected_status: "blocked" }
    });
  } finally {
    ledger.close();
  }

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10 });
  const reasons = report.projection_health.processed_outbox.issue_counts_by_reason;
  const entry = report.projection_health.processed_outbox.entries[0];

  assert.equal(report.status, "attention");
  assert.equal(report.attention_reasons.includes("processed_outbox_projection_mismatch"), true);
  assert.equal(reasons.processed_outbox_projection_schema_mismatch, 1);
  assert.equal(reasons.processed_outbox_projection_authority_flag_invalid, 1);
  assert.equal(reasons.processed_outbox_projection_modified_after_processed, 1);
  assert.equal(reasons.processed_outbox_projection_size_mismatch, 1);
  assert.equal(reasons.processed_outbox_projection_consumer_id_mismatch, 1);
  assert.equal(reasons.processed_outbox_projection_status_mismatch, 1);
  assert.equal(entry.ok, false);
  assert.equal(entry.issues.some((issue) => issue.reason === "processed_outbox_projection_authority_flag_invalid" && issue.field === "wfa_executed"), true);
  assert.equal(report.authority.official_state_mutated, false);
  assert.equal(report.authority.wfa_executed, false);
  assert.equal(report.authority.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("ResearchBrain Stage-0 readiness bounds processed outbox projection checks", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);

  const ledger = new RuntimeLedger({ rootDir });
  try {
    ledger.migrate();
    for (const suffix of ["A", "B"]) {
      const runId = `RUN-RB-STAGE0-LIMIT-${suffix}`;
      const jobId = `JOB-RB-STAGE0-LIMIT-${suffix}`;
      const attemptId = `ATTEMPT-RB-STAGE0-LIMIT-${suffix}`;
      const eventId = `EVT-RB-STAGE0-LIMIT-${suffix}`;
      const processedAt = suffix === "A" ? "2026-06-05T19:30:00.000Z" : "2026-06-05T19:31:00.000Z";
      const projection = writeJsonFixture(rootDir, `${"factory/runtime/projections/researchbrain-stage0"}/${eventId}.json`, {
        schema_version: "researchbrain_stage0_outbox_projection_v1",
        projected_at: processedAt,
        consumer_id: "readiness-limit-test",
        event: { event_id: eventId, event_type: "researchbrain.stage0_job_finished", aggregate_type: "run", aggregate_id: runId, created_at: processedAt, payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" } },
        run: { run_id: runId, status: "stage0_ready" },
        job: { job_id: jobId, run_id: runId, status: "stage0_ready" },
        attempt: { attempt_id: attemptId, job_id: jobId, status: "stage0_ready" },
        artifacts: [],
        official_state_mutated: false,
        official_evidence_index_mutated: false,
        official_backlog_mutated: false,
        official_leaderboard_mutated: false,
        profitability_labels_created: false,
        wfa_executed: false,
        mt5_executed: false
      });
      setFixtureMtime(rootDir, projection.path, processedAt);
      ledger.insertRun({ run_id: runId, status: "queued", evidence_kind: "stage0_research_discovery" });
      ledger.insertJob({ job_id: jobId, run_id: runId, job_type: "researchbrain_stage0", status: "stage0_ready", priority: 1 });
      ledger.insertJobAttempt({ attempt_id: attemptId, job_id: jobId, attempt_number: 1, status: "stage0_ready", worker: "researchbrain_stage0_loop_runner" });
      ledger.recordRunStatusWithOutbox({ run_id: runId, status: "stage0_ready", event_id: eventId, event_type: "researchbrain.stage0_job_finished", payload: { job_id: jobId, attempt_id: attemptId, status: "stage0_ready" } });
      ledger.markOutboxEventProcessed({ event_id: eventId, consumer_id: "readiness-limit-test", now: processedAt, result: { projection_artifact: projection } });
    }
  } finally {
    ledger.close();
  }

  const report = buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 10, projectionLimit: 10, processedOutboxLimit: 1 });

  assert.equal(report.projection_health.processed_outbox.total_processed_events, 2);
  assert.equal(report.projection_health.processed_outbox.checked_processed_events, 1);
  assert.equal(report.projection_health.processed_outbox.limit, 1);
  assert.equal(report.projection_health.processed_outbox.truncated, true);
  assert.equal(report.projection_health.processed_outbox.entries[0].event_id, "EVT-RB-STAGE0-LIMIT-B");
  assert.equal(report.runtime_consistency.status, "ok");
  assert.equal(report.runtime_consistency.checked_final_jobs, 2);
});

test("ResearchBrain Stage-0 readiness rejects escaping request paths and invalid limits", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);

  assert.throws(
    () => buildResearchBrainStage0ReadinessReport({ rootDir, requestDir: "../outside" }),
    /escapes repository root/
  );
  assert.throws(
    () => buildResearchBrainStage0ReadinessReport({ rootDir, requestLimit: 501 }),
    /requestLimit must be an integer from 0 to 500/
  );
  assert.throws(
    () => buildResearchBrainStage0ReadinessReport({ rootDir, processedOutboxLimit: 1001 }),
    /processedOutboxLimit must be an integer from 1 to 1000/
  );
  assert.throws(
    () => buildResearchBrainStage0ReadinessReport({ rootDir, runtimeConsistencyLimit: 1001 }),
    /runtimeConsistencyLimit must be an integer from 1 to 1000/
  );
});

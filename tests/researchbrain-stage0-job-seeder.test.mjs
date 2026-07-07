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
import { runResearchBrainStage0Loop } from "../src/core/researchbrain-loop-runner.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-seed-test-"));
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
  const universe = writeJsonFixture(rootDir, "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-SEED-TEST/universe-snapshot.json", {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    server: "FTMO-Demo",
    symbol_count_total: 3,
    symbols: [{ name: "EURUSD" }, { name: "XAUUSD" }, { name: "BTCUSD" }]
  });
  const inventory = writeJsonFixture(rootDir, "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-SEED-TEST/inventory.json", {
    schema_version: "mt5_terminal_inventory_v1",
    inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-SEED-TEST",
    counts: { total_symbols: 3 }
  });
  return { universe_snapshot: universe, terminal_inventory: inventory };
}

function writeRequest(rootDir, requestId = "RESEARCHBRAIN-REQUEST-SEED-TEST") {
  const refs = phase8ARefs(rootDir);
  return writeResearchBrainRequestArtifact({
    rootDir,
    requestId,
    observedAt: "2026-06-04T00:00:00Z",
    universeSnapshotPath: refs.universe_snapshot.path,
    terminalInventoryPath: refs.terminal_inventory.path,
    priorFailedPatterns: ["Manual Phase 8D strategy roulette stopped after zero survivors."],
    priorLessons: ["Stage-0 jobs must remain source-backed and non-authoritative."],
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

test("ResearchBrain Stage-0 job seeder validates request hash and creates one runtime-ledger job without official mutation", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir);
  const beforeOfficial = officialFileHashes(paths);

  const result = seedResearchBrainStage0Job({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    priority: 7,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    maxOutputBytes: 128000,
    retryDelayMs: 0
  });

  assert.equal(result.schema_version, "researchbrain_stage0_job_seed_result_v1");
  assert.equal(result.status, "seeded");
  assert.equal(result.job_type, "researchbrain_stage0");
  assert.equal(result.job_status, "queued");
  assert.equal(result.priority, 7);
  assert.equal(result.request_artifact.path, request.artifact.path);
  assert.equal(result.request_artifact.sha256, request.artifact.sha256);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.phase8e_started, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  readLedger(rootDir, (ledger) => {
    const run = ledger.getRun(result.run_id);
    const job = ledger.getJob(result.job_id);
    assert.equal(run.status, "queued");
    assert.equal(run.evidence_kind, "stage0_research_discovery");
    assert.equal(job.status, "queued");
    assert.equal(job.priority, 7);
    const payload = JSON.parse(job.payload_json);
    assert.equal(payload.request_path, request.artifact.path);
    assert.equal(payload.request_sha256, request.artifact.sha256);
    assert.equal(payload.max_attempts, 1);
    assert.equal(payload.max_provider_calls, 1);
    assert.equal(payload.timeout_ms, 1000);
    assert.equal(payload.max_output_bytes, 128000);
    assert.equal(payload.retry_delay_ms, 0);
    assert.equal(payload.official_backlog_mutated, false);
    assert.equal(payload.wfa_executed, false);
  });
});

test("ResearchBrain Stage-0 job seeder is idempotent for the same request artifact", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SEED-IDEMPOTENT");

  const first = seedResearchBrainStage0Job({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256, priority: 3 });
  const second = seedResearchBrainStage0Job({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256, priority: 9 });

  assert.equal(first.status, "seeded");
  assert.equal(second.status, "already_seeded");
  assert.equal(second.run_id, first.run_id);
  assert.equal(second.job_id, first.job_id);
  assert.equal(second.priority, 3);
  readLedger(rootDir, (ledger) => {
    const attempts = ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get();
    assert.equal(attempts.count, 1);
  });
});

test("ResearchBrain Stage-0 job seeder de-duplicates request path variants by request SHA", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SEED-SHA-DUPE");
  const duplicatePath = "factory/research/requests/path-variant/request.json";
  const duplicateFullPath = path.join(rootDir, duplicatePath);
  fs.mkdirSync(path.dirname(duplicateFullPath), { recursive: true });
  fs.copyFileSync(path.join(rootDir, request.artifact.path), duplicateFullPath);

  const first = seedResearchBrainStage0Job({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256, priority: 3 });
  const second = seedResearchBrainStage0Job({ rootDir, requestPath: duplicatePath, requestSha256: request.artifact.sha256, priority: 9 });

  assert.equal(first.status, "seeded");
  assert.equal(second.status, "already_seeded");
  assert.equal(second.duplicate_resolution, "same_request_sha256");
  assert.equal(second.duplicate_of.job_id, first.job_id);
  assert.equal(second.run_id, first.run_id);
  assert.equal(second.priority, 3);
  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get();
    assert.equal(jobs.count, 1);
    const payload = JSON.parse(ledger.getJob(first.job_id).payload_json);
    assert.equal(payload.request_path, request.artifact.path);
    assert.equal(payload.request_sha256, request.artifact.sha256);
  });
});

test("ResearchBrain Stage-0 job seeder rejects hash mismatch and non-request paths", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SEED-REJECT");
  const badPath = writeJsonFixture(rootDir, "factory/research/not-requests/request.json", JSON.parse(fs.readFileSync(path.join(rootDir, request.artifact.path), "utf8")));

  assert.throws(
    () => seedResearchBrainStage0Job({ rootDir, requestPath: request.artifact.path, requestSha256: "0".repeat(64) }),
    /request_sha256 does not match/
  );
  assert.throws(
    () => seedResearchBrainStage0Job({ rootDir, requestPath: badPath.path, requestSha256: badPath.sha256 }),
    /under factory\/research\/requests\//
  );
});

test("ResearchBrain Stage-0 job seeder rejects invalid request schema before ledger insert", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const invalid = writeJsonFixture(rootDir, "factory/research/requests/INVALID/request.json", {
    schema_version: "researchbrain_request_v1",
    research_question: "too short",
    market_scope: "multi_asset_ftmo_mt5",
    prior_failed_patterns: [],
    prior_lessons: [],
    max_sources: 4,
    max_hypotheses: 2,
    novelty_required: true,
    sharpe: 3
  });

  assert.throws(
    () => seedResearchBrainStage0Job({ rootDir, requestPath: invalid.path, requestSha256: invalid.sha256 }),
    /ResearchBrain request validation failed/
  );
  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get();
    assert.equal(jobs.count, 0);
  });
});

test("ResearchBrain Stage-0 job seeder rejects output directories owned by a different run", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SEED-OUTPUT-COLLISION");
  const outputDir = "factory/research/runs/RUN-RB-STAGE0-SEED-COLLISION";
  writeJsonFixture(rootDir, `${outputDir}/runtime-result.json`, {
    schema_version: "researchbrain_stage0_runtime_result_v1",
    run_id: "RUN-RB-STAGE0-OTHER-RUN",
    status: "ready"
  });

  assert.throws(
    () => seedResearchBrainStage0Job({ rootDir, requestPath: request.artifact.path, requestSha256: request.artifact.sha256, outputDir }),
    /output_dir collision: .*belongs to RUN-RB-STAGE0-OTHER-RUN/
  );
  readLedger(rootDir, (ledger) => {
    const jobs = ledger.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE job_type = 'researchbrain_stage0'").get();
    assert.equal(jobs.count, 0);
  });
});

test("ResearchBrain Stage-0 job seeder propagates job_settings from request into payload without secrets", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const refs = phase8ARefs(rootDir);
  const request = writeResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-SETTINGS-TEST",
    observedAt: "2026-06-04T00:00:00Z",
    universeSnapshotPath: refs.universe_snapshot.path,
    terminalInventoryPath: refs.terminal_inventory.path,
    priorFailedPatterns: ["No viable survivors"],
    priorLessons: ["Settings should propagate"],
    maxSources: 3,
    maxHypotheses: 1,
    jobSettings: {
      llm_provider: "deepseek",
      llm_model: "deepseek-v4-flash",
      source_provider: "brave",
      max_tool_calls: 50,
      max_llm_calls: 15,
      llm_api_key_env: "DEEPSEEK_API_KEY",
      allow_live_source_search: true
    }
  });

  const result = seedResearchBrainStage0Job({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    priority: 5,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });

  assert.equal(result.status, "seeded");

  readLedger(rootDir, (ledger) => {
    const job = ledger.getJob(result.job_id);
    const payload = JSON.parse(job.payload_json);
    assert.equal(payload.llm_provider, "deepseek");
    assert.equal(payload.llm_model, "deepseek-v4-flash");
    assert.equal(payload.source_provider, "brave");
    assert.equal(payload.max_tool_calls, 50);
    assert.equal(payload.max_llm_calls, 15);
    assert.equal(payload.llm_api_key_env, "DEEPSEEK_API_KEY");
    assert.equal(payload.allow_live_source_search, true);

    // Verify explicit function-level params still win over request settings
    assert.equal(payload.max_attempts, 1);

    // Verify no actual secret values are stored in the payload
    assert.doesNotMatch(JSON.stringify(payload), /sk-[a-zA-Z0-9]+|actual-secret|api_key_value/i);
  });
});

test("ResearchBrain Stage-0 job seeder CLI emits JSON result", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SEED-CLI");

  const result = spawnSync("node", [
    "scripts/run-researchbrain-stage0-job-seeder.mjs",
    "--root", rootDir,
    "--request-path", request.artifact.path,
    "--request-sha256", request.artifact.sha256,
    "--priority", "4",
    "--max-attempts", "1"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schema_version, "researchbrain_stage0_job_seed_result_v1");
  assert.equal(output.status, "seeded");
  assert.equal(output.priority, 4);
  assert.equal(output.request_artifact.sha256, request.artifact.sha256);
});

test("ResearchBrain Stage-0 job seeder creates jobs claimable by the Stage-0 loop", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const request = writeRequest(rootDir, "RESEARCHBRAIN-REQUEST-SEED-LOOP");
  const beforeOfficial = officialFileHashes(paths);

  const seeded = seedResearchBrainStage0Job({
    rootDir,
    requestPath: request.artifact.path,
    requestSha256: request.artifact.sha256,
    priority: 11,
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000,
    retryDelayMs: 0
  });

  const loopResult = await runResearchBrainStage0Loop({ rootDir, ownerId: "seed-loop-owner", maxJobs: 1 });

  assert.equal(loopResult.status, "processed");
  assert.equal(loopResult.jobs_processed, 1);
  assert.equal(loopResult.jobs[0].job_id, seeded.job_id);
  assert.equal(loopResult.jobs[0].status, "stage0_ready");
  assert.equal(loopResult.wfa_executed, false);
  assert.equal(loopResult.mt5_executed, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
  readLedger(rootDir, (ledger) => {
    assert.equal(ledger.getRun(seeded.run_id).status, "stage0_ready");
    assert.equal(ledger.getJob(seeded.job_id).status, "stage0_ready");
    const artifacts = ledger.db.prepare("SELECT artifact_type FROM artifacts WHERE job_id = ? ORDER BY artifact_type").all(seeded.job_id);
    assert.equal(artifacts.some((artifact) => artifact.artifact_type === "researchbrain_stage0_runtime_result"), true);
    assert.equal(ledger.listPendingOutboxEvents({ event_type: "researchbrain.stage0_job_finished" }).length, 1);
  });
});

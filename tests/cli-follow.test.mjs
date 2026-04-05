import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "node:child_process";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";

function createTempRepoRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-follow-"));
  const projectRoot = path.join(tempRoot, "trading-research-factory");
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "trading-research-factory" }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "opencode.json"), JSON.stringify({ plugin: [], provider: {} }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Temp Test Repo\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "cli.mjs"), "", "utf8");
  initializeProject(projectRoot);
  return projectRoot;
}

function runCli(rootDir, ...args) {
  const result = spawnSync("node", ["src/cli.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, RESEARCH_FACTORY_ROOT: rootDir, RESEARCH_FACTORY_OBSERVER_PORT: "4319" }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("cli status reports owner freshness and active run follow URL", () => {
  const rootDir = createTempRepoRoot();
  const paths = buildPaths(rootDir);
  fs.writeFileSync(paths.ownerLock, JSON.stringify({
    schema_version: "runtime_owner_lock_v1",
    status: "owned",
    owner_id: "owner-a",
    heartbeat_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString()
  }, null, 2));
  fs.writeFileSync(paths.activeRun, JSON.stringify({
    schema_version: "active_run_v1",
    status: "active",
    owner_id: "owner-a",
    run_id: "RUN-1",
    stage: "executor",
    attempt: 2,
    session_url: "http://127.0.0.1:4096/global/session/ses-1",
    follow_url: "http://127.0.0.1:4319/follow"
  }, null, 2));

  const output = runCli(rootDir, "status");
  assert.equal(output.owner.healthy, true);
  assert.equal(output.active_run.follow_url, "http://127.0.0.1:4319/follow");
});

test("cli follow reports stable observer follow URL", () => {
  const rootDir = createTempRepoRoot();
  const paths = buildPaths(rootDir);
  fs.writeFileSync(paths.activeRun, JSON.stringify({
    schema_version: "active_run_v1",
    status: "idle",
    follow_url: "http://127.0.0.1:4319/follow"
  }, null, 2));

  const output = runCli(rootDir, "follow");
  assert.equal(output.follow_url, "http://127.0.0.1:4319/follow");
});

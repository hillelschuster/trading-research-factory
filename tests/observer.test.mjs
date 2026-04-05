import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { RuntimeStateStore } from "../src/core/runtime-state.mjs";
import { startObserverServer } from "../src/observer/server.mjs";

function createTempRoot() {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "observer-test-")), "trading-research-factory");
  initializeProject(rootDir);
  return rootDir;
}

test("observer server exposes file-backed snapshot and stable follow page", async () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const runtimeState = new RuntimeStateStore(paths);
  runtimeState.markActive({
    status: "active",
    owner_id: "owner-a",
    run_id: "RUN-1",
    run_instance_id: "RUN-1",
    backlog_item_id: "IDEA-1",
    stage: "executor",
    attempt: 2,
    session_id: "ses-1",
    session_url: "http://127.0.0.1:4096/global/session/ses-1",
    follow_url: "http://127.0.0.1:4310/follow",
    heartbeat_at: new Date().toISOString(),
    last_error: "timeout"
  });
  fs.mkdirSync(path.join(paths.runs, "RUN-1"), { recursive: true });
  fs.writeFileSync(path.join(paths.runs, "RUN-1", "run.log"), '{"msg":"line1"}\n{"msg":"line2"}\n', "utf8");
  fs.writeFileSync(paths.recoveryLog, '{"kind":"observer_only_start"}\n', "utf8");

  const observer = await startObserverServer(paths, { port: 0 });
  const address = observer.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const snapshotRes = await fetch(`${baseUrl}/api/observer`);
  const snapshot = await snapshotRes.json();
  const followRes = await fetch(`${baseUrl}/follow`);
  const followHtml = await followRes.text();

  assert.equal(snapshot.active_run.run_id, "RUN-1");
  assert.equal(snapshot.active_run.stage, "executor");
  assert.equal(Array.isArray(snapshot.run_log_tail), true);
  assert.match(followHtml, /RUN-1/);
  assert.match(followHtml, /executor/);

  await observer.close();
});

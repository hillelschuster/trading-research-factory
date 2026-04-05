import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { RuntimeStateStore, reconcileStartupState } from "../src/core/runtime-state.mjs";
import { BacklogStore } from "../src/core/backlog-store.mjs";
import { ArtifactStore } from "../src/core/artifact-store.mjs";

function createTempRoot() {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-state-")), "trading-research-factory");
  initializeProject(rootDir);
  return rootDir;
}

test("initializeProject seeds active-run runtime file", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  assert.equal(fs.existsSync(paths.activeRun), true);
});

test("RuntimeStateStore can mark an active run and return to idle", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const runtimeStateStore = new RuntimeStateStore(paths);

  runtimeStateStore.markActive({
    owner_id: "owner-a",
    run_id: "RUN-1",
    run_instance_id: "RUN-1",
    backlog_item_id: "IDEA-1",
    stage: "executor",
    attempt: 2,
    session_id: "ses-1",
    session_url: "http://127.0.0.1:4096/global/session/ses-1",
    follow_url: "http://127.0.0.1:4096/global/session/ses-1",
    heartbeat_at: "2026-04-02T00:00:00.000Z"
  });

  const active = runtimeStateStore.readActiveRun();
  assert.equal(active.status, "active");
  assert.equal(active.stage, "executor");
  assert.equal(active.follow_url, "http://127.0.0.1:4096/global/session/ses-1");

  runtimeStateStore.markIdle({ status: "interrupted", last_error: "signal" });
  const idle = runtimeStateStore.readActiveRun();
  assert.equal(idle.status, "interrupted");
  assert.equal(idle.run_id, null);
  assert.equal(idle.last_error, "signal");
});

test("reconcileStartupState clears stale active-run and recovers expired orphaned leases", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const runtimeStateStore = new RuntimeStateStore(paths);
  const backlogStore = new BacklogStore(paths);
  const artifactStore = new ArtifactStore(paths);

  runtimeStateStore.markActive({
    owner_id: "owner-a",
    run_id: "RUN-STALE-1",
    stage: "executor",
    heartbeat_at: "2026-04-02T00:00:00.000Z"
  });
  backlogStore.append([{
    id: "IDEA-LEASE-1",
    title: "Expired lease",
    objective: "Recover lease on startup",
    status: "leased",
    lease_owner: "owner-a",
    lease_expires_at: "2026-04-02T00:00:00.000Z",
    current_run_id: null
  }]);

  const repaired = reconcileStartupState(paths, backlogStore, artifactStore, {
    nowMs: Date.parse("2026-04-02T01:00:00.000Z")
  });

  assert.equal(repaired.active_run_repaired, true);
  assert.deepEqual(repaired.recovered_leases, ["IDEA-LEASE-1"]);
  assert.equal(runtimeStateStore.readActiveRun().status, "interrupted");
  assert.equal(backlogStore.read().find((item) => item.id === "IDEA-LEASE-1").status, "ready");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { acquireOwnerLock, deriveOwnerLockPolicy, heartbeatOwnerLock, readOwnerLock, releaseOwnerLock } from "../src/core/runtime-lock.mjs";

function createTempRoot() {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-lock-")), "trading-research-factory");
  initializeProject(rootDir);
  return rootDir;
}

test("initializeProject seeds runtime control-plane files", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  assert.equal(fs.existsSync(paths.runtime), true);
  assert.equal(fs.existsSync(paths.ownerLock), true);
  assert.equal(fs.existsSync(paths.activeRun), true);
  assert.equal(fs.existsSync(paths.recoveryLog), true);
});

test("owner lock denies a second healthy owner", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  const first = acquireOwnerLock(paths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
  const second = acquireOwnerLock(paths, { ownerId: "owner-b", intervalMs: 1000, nowMs: 1500 });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "healthy_owner_exists");
});

test("owner lock heartbeat extends expiry for the active owner", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  const acquired = acquireOwnerLock(paths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
  const before = readOwnerLock(paths);
  const beat = heartbeatOwnerLock(paths, { ownerId: "owner-a", token: acquired.token, nowMs: 4000 });
  const after = readOwnerLock(paths);

  assert.equal(beat.ok, true);
  assert.equal(new Date(after.expires_at).getTime() > new Date(before.expires_at).getTime(), true);
});

test("owner lock allows takeover after TTL expiry", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const policy = deriveOwnerLockPolicy(1000);

  acquireOwnerLock(paths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
  const takeover = acquireOwnerLock(paths, { ownerId: "owner-b", intervalMs: 1000, nowMs: 1000 + policy.ttlMs + 1 });
  const current = readOwnerLock(paths);

  assert.equal(takeover.acquired, true);
  assert.equal(current.owner_id, "owner-b");
  assert.equal(current.takeover_of, "owner-a");
});

test("owner lock clean release allows immediate reacquire", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  const acquired = acquireOwnerLock(paths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
  const released = releaseOwnerLock(paths, { ownerId: "owner-a", token: acquired.token, nowMs: 1500, reason: "test_release" });
  const reacquired = acquireOwnerLock(paths, { ownerId: "owner-b", intervalMs: 1000, nowMs: 1600 });

  assert.equal(released.released, true);
  assert.equal(reacquired.acquired, true);
  assert.equal(readOwnerLock(paths).owner_id, "owner-b");
});

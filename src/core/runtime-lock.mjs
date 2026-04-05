import fs from "fs";
import { randomUUID } from "node:crypto";
import { appendLine, readJson, writeJsonAtomic } from "./fs-utils.mjs";

const LOCK_SCHEMA_VERSION = "runtime_owner_lock_v1";
const MUTEX_WAIT_MS = 1000;
const MUTEX_RETRY_MS = 25;

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait is acceptable here because lock acquisition is rare and short-lived
  }
}

function baseLockState() {
  return {
    schema_version: LOCK_SCHEMA_VERSION,
    status: "idle",
    owner_id: null,
    owner_token: null,
    pid: null,
    mode: null,
    heartbeat_at: null,
    acquired_at: null,
    expires_at: null,
    ttl_ms: null,
    heartbeat_interval_ms: null,
    released_at: null,
    takeover_of: null,
    basis: null
  };
}

export function deriveOwnerLockPolicy(intervalMs = 5000) {
  const basisIntervalMs = Math.max(1000, Number(intervalMs) || 5000);
  const heartbeatMs = Math.max(5000, Math.min(15000, basisIntervalMs * 2));
  const ttlMs = Math.max(30000, heartbeatMs * 3);
  return {
    heartbeatMs,
    ttlMs,
    basis: {
      derived_from_interval_ms: basisIntervalMs,
      heartbeat_multiplier: 2,
      ttl_multiplier_vs_heartbeat: 3
    }
  };
}

export function readOwnerLock(paths) {
  return readJson(paths.ownerLock, baseLockState());
}

export function isOwnerLockExpired(lockState, nowMs = Date.now()) {
  if (!lockState || lockState.status !== "owned") return true;
  if (!lockState.expires_at) return true;
  return new Date(lockState.expires_at).getTime() <= nowMs;
}

export function appendRecoveryEvent(paths, event) {
  appendLine(paths.recoveryLog, JSON.stringify({
    ...event,
    recorded_at: new Date().toISOString()
  }), paths);
}

function acquireMutex(paths) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MUTEX_WAIT_MS) {
    try {
      const fd = fs.openSync(paths.ownerLockMutex, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }));
      return fd;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      sleepSync(MUTEX_RETRY_MS);
    }
  }
  throw new Error("Timed out acquiring owner-lock mutex.");
}

function releaseMutex(paths, fd) {
  fs.closeSync(fd);
  if (fs.existsSync(paths.ownerLockMutex)) {
    fs.unlinkSync(paths.ownerLockMutex);
  }
}

function writeLock(paths, next) {
  writeJsonAtomic(paths.ownerLock, next, paths);
  return readOwnerLock(paths);
}

export function acquireOwnerLock(paths, { ownerId, mode = "live", pid = process.pid, intervalMs = 5000, nowMs = Date.now() } = {}) {
  const mutexFd = acquireMutex(paths);
  try {
    const current = readOwnerLock(paths);
    const policy = deriveOwnerLockPolicy(intervalMs);
    const currentExpired = isOwnerLockExpired(current, nowMs);

    if (current.status === "owned" && !currentExpired && current.owner_id !== ownerId) {
      appendRecoveryEvent(paths, {
        kind: "owner_lock_denied",
        requested_owner_id: ownerId,
        active_owner_id: current.owner_id,
        expires_at: current.expires_at
      });
      return { acquired: false, reason: "healthy_owner_exists", current };
    }

    const token = randomUUID();
    const next = {
      schema_version: LOCK_SCHEMA_VERSION,
      status: "owned",
      owner_id: ownerId,
      owner_token: token,
      pid,
      mode,
      heartbeat_at: nowIso(nowMs),
      acquired_at: current.status === "owned" && current.owner_id === ownerId ? current.acquired_at : nowIso(nowMs),
      expires_at: nowIso(nowMs + policy.ttlMs),
      ttl_ms: policy.ttlMs,
      heartbeat_interval_ms: policy.heartbeatMs,
      released_at: null,
      takeover_of: current.status === "owned" && currentExpired ? current.owner_id : null,
      basis: policy.basis
    };

    const written = writeLock(paths, next);
    if (written.owner_token !== token) {
      throw new Error("Owner-lock verification failed after write.");
    }

    appendRecoveryEvent(paths, {
      kind: next.takeover_of ? "owner_lock_takeover" : "owner_lock_acquired",
      owner_id: ownerId,
      owner_token: token,
      previous_owner_id: next.takeover_of,
      expires_at: next.expires_at
    });

    return { acquired: true, token, lock: written, policy };
  } finally {
    releaseMutex(paths, mutexFd);
  }
}

export function heartbeatOwnerLock(paths, { ownerId, token, nowMs = Date.now() } = {}) {
  const mutexFd = acquireMutex(paths);
  try {
    const current = readOwnerLock(paths);
    if (current.owner_id !== ownerId || current.owner_token !== token || current.status !== "owned") {
      return { ok: false, reason: "not_owner", current };
    }

    const next = {
      ...current,
      heartbeat_at: nowIso(nowMs),
      expires_at: nowIso(nowMs + (current.ttl_ms ?? deriveOwnerLockPolicy().ttlMs))
    };
    const written = writeLock(paths, next);
    return { ok: true, lock: written };
  } finally {
    releaseMutex(paths, mutexFd);
  }
}

export function releaseOwnerLock(paths, { ownerId, token, nowMs = Date.now(), reason = "released" } = {}) {
  const mutexFd = acquireMutex(paths);
  try {
    const current = readOwnerLock(paths);
    if (current.owner_id !== ownerId || current.owner_token !== token || current.status !== "owned") {
      return { released: false, reason: "not_owner", current };
    }

    const next = {
      ...baseLockState(),
      released_at: nowIso(nowMs),
      basis: current.basis
    };
    const written = writeLock(paths, next);
    appendRecoveryEvent(paths, {
      kind: "owner_lock_released",
      owner_id: ownerId,
      owner_token: token,
      reason
    });
    return { released: true, lock: written };
  } finally {
    releaseMutex(paths, mutexFd);
  }
}

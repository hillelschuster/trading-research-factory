import { appendLine, readJson, writeJsonAtomic } from "./fs-utils.mjs";
import { isOwnerLockExpired, readOwnerLock } from "./runtime-lock.mjs";

export function defaultActiveRunState() {
  return {
    schema_version: "active_run_v1",
    status: "idle",
    owner_id: null,
    run_id: null,
    run_instance_id: null,
    backlog_item_id: null,
    stage: null,
    attempt: null,
    session_id: null,
    session_url: null,
    follow_url: null,
    heartbeat_at: null,
    updated_at: null,
    last_error: null,
    last_retry_note: null
  };
}

export class RuntimeStateStore {
  constructor(paths) {
    this.paths = paths;
  }

  readActiveRun() {
    return readJson(this.paths.activeRun, defaultActiveRunState());
  }

  writeActiveRun(next) {
    writeJsonAtomic(this.paths.activeRun, next, this.paths);
  }

  update(mutator) {
    const current = this.readActiveRun();
    const next = mutator(structuredClone(current));
    this.writeActiveRun(next);
    return next;
  }

  markActive(patch = {}) {
    return this.update((state) => ({
      ...state,
      ...patch,
      status: patch.status ?? "active",
      updated_at: new Date().toISOString()
    }));
  }

  markIdle(patch = {}) {
    return this.update((state) => ({
      ...state,
      status: patch.status ?? "idle",
      owner_id: patch.owner_id ?? null,
      run_id: patch.run_id ?? null,
      run_instance_id: patch.run_instance_id ?? null,
      backlog_item_id: patch.backlog_item_id ?? null,
      stage: patch.stage ?? null,
      attempt: patch.attempt ?? null,
      session_id: patch.session_id ?? null,
      session_url: patch.session_url ?? null,
      follow_url: patch.follow_url ?? null,
      heartbeat_at: patch.heartbeat_at ?? null,
      updated_at: new Date().toISOString(),
      last_error: patch.last_error ?? null,
      last_retry_note: patch.last_retry_note ?? null
    }));
  }
}

function appendRecoveryEvent(paths, event) {
  appendLine(paths.recoveryLog, JSON.stringify({
    ...event,
    recorded_at: new Date().toISOString()
  }), paths);
}

export function reconcileStartupState(paths, backlogStore, artifactStore, { nowMs = Date.now() } = {}) {
  const ownerLock = readOwnerLock(paths);
  const ownerHealthy = ownerLock.status === "owned" && !isOwnerLockExpired(ownerLock, nowMs);
  const runtimeStateStore = new RuntimeStateStore(paths);
  const activeRun = runtimeStateStore.readActiveRun();
  const repaired = {
    active_run_repaired: false,
    recovered_leases: [],
    owner_healthy: ownerHealthy,
    owner_id: ownerLock.owner_id ?? null
  };

  if (!ownerHealthy && activeRun.status !== "idle") {
    runtimeStateStore.markIdle({
      status: "interrupted",
      last_error: activeRun.last_error || `Recovered stale active run for ${activeRun.run_id || "unknown run"}.`
    });
    appendRecoveryEvent(paths, {
      kind: "startup_reconciled_active_run",
      previous_run_id: activeRun.run_id,
      previous_stage: activeRun.stage,
      previous_owner_id: activeRun.owner_id
    });
    repaired.active_run_repaired = true;
  }

  if (!ownerHealthy) {
    const items = backlogStore.read();
    for (const item of items) {
      if (item.status !== "leased") continue;
      const runState = item.current_run_id ? artifactStore.readRunState(item.current_run_id, null) : null;
      const resumable = Boolean(runState?.resume_from_stage);
      const leaseExpiry = item.lease_expires_at ? Date.parse(item.lease_expires_at) : NaN;
      const leaseExpired = !Number.isFinite(leaseExpiry) || leaseExpiry <= nowMs;

      if (!resumable && leaseExpired) {
        backlogStore.mark(item.id, {
          status: "ready",
          lease_owner: null,
          lease_expires_at: null
        });
        repaired.recovered_leases.push(item.id);
      }
    }

    if (repaired.recovered_leases.length > 0) {
      appendRecoveryEvent(paths, {
        kind: "startup_recovered_leases",
        recovered_item_ids: repaired.recovered_leases
      });
    }
  }

  return repaired;
}

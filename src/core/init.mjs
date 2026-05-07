import fs from "fs";
import path from "path";
import { ensureDir, writeJsonAtomic, writeTextAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";
import { FACTORY_GOAL } from "./constants.mjs";
import { DEFAULT_MARKET_POLICY } from "./market-policy.mjs";

export function initializeProject(rootDir) {
  const paths = buildPaths(rootDir);
  [
    paths.factory,
    path.join(paths.factory, "evidence"),
    path.join(paths.factory, "memory"),
    paths.runtime,
    paths.memoryQuarantine,
    paths.artifacts,
    paths.artifactManifests,
    paths.mt5,
    paths.mt5Environment,
    paths.mt5Tester,
    paths.mt5Native,
    paths.mt5Bridge,
    path.join(paths.mt5Bridge, "ingested"),
    path.join(paths.mt5Bridge, "quarantine"),
    path.join(paths.mt5Bridge, "scratch"),
    paths.runs,
    paths.experiments,
    paths.verification,
    paths.summaries,
    paths.workspace,
    path.join(paths.workspace, "harness"),
    path.join(paths.workspace, "strategies"),
    path.join(paths.workspace, "data"),
    paths.workspaceResults,
    path.join(paths.root, "wfa"),
    path.join(paths.root, "wfa", "tests"),
    path.join(paths.root, "workspace", "data", "fetchers"),
    paths.toolingSandbox
  ].forEach((dirPath) => ensureDir(dirPath, paths));

  if (!fs.existsSync(paths.state)) {
    writeJsonAtomic(paths.state, {
      goal: FACTORY_GOAL,
      iteration: 0,
      last_run_id: null,
      active_session_id: null,
      active_session_url: null,
      last_status: "idle",
      last_error: null,
      mode_history: []
    }, paths);
  }

  if (!fs.existsSync(paths.activeSession)) {
    writeJsonAtomic(paths.activeSession, {
      status: "idle",
      run_id: null,
      agent: null,
      attempt: null,
      session_id: null,
      session_url: null,
      updated_at: null,
      ended_at: null
    }, paths);
  }

  if (!fs.existsSync(paths.backlog)) writeJsonAtomic(paths.backlog, [], paths);
  if (!fs.existsSync(paths.health)) writeJsonAtomic(paths.health, {}, paths);
  if (!fs.existsSync(paths.leaderboard)) writeJsonAtomic(paths.leaderboard, [], paths);
  if (!fs.existsSync(paths.ownerLock)) writeJsonAtomic(paths.ownerLock, {
    schema_version: "runtime_owner_lock_v1",
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
  }, paths);
  if (!fs.existsSync(paths.activeRun)) writeJsonAtomic(paths.activeRun, {
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
  }, paths);
  if (!fs.existsSync(paths.recoveryLog)) writeTextAtomic(paths.recoveryLog, "", paths);
  if (!fs.existsSync(paths.marketPolicy)) writeJsonAtomic(paths.marketPolicy, DEFAULT_MARKET_POLICY, paths);
  if (!fs.existsSync(paths.artifactIndex)) writeJsonAtomic(paths.artifactIndex, [], paths);
  if (!fs.existsSync(paths.evidenceIndex)) writeJsonAtomic(paths.evidenceIndex, [], paths);
  if (!fs.existsSync(paths.retrievalIndex)) writeJsonAtomic(paths.retrievalIndex, [], paths);
  if (!fs.existsSync(paths.lessons)) writeTextAtomic(paths.lessons, "", paths);

  return paths;
}

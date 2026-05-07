import path from "path";
import { normalizeRootIdentity, ROOT_FILE_WRITE_ALLOWLIST, TOOLING_SANDBOX, TOP_LEVEL_WRITE_ALLOWLIST } from "./root-identity.mjs";

export function buildPaths(rootRef) {
  const rootIdentity = normalizeRootIdentity(rootRef);
  const root = rootIdentity.realPath;
  const factory = path.join(root, "factory");
  const workspace = path.join(root, "workspace");
  return {
    root,
    rootIdentity,
    factory,
    workspace,
    toolingSandbox: rootIdentity.toolingSandbox || path.join(root, TOOLING_SANDBOX),
    writeScope: {
      rootDir: root,
      allowedTopLevelDirs: new Set(TOP_LEVEL_WRITE_ALLOWLIST),
      allowedRootFiles: new Set(ROOT_FILE_WRITE_ALLOWLIST),
      toolingSandbox: rootIdentity.toolingSandbox || path.join(root, TOOLING_SANDBOX)
    },
    state: path.join(factory, "state.json"),
    activeSession: path.join(factory, "active-session.json"),
    health: path.join(factory, "health.json"),
    backlog: path.join(factory, "backlog.json"),
    leaderboard: path.join(factory, "leaderboard.json"),
    runtime: path.join(factory, "runtime"),
    ownerLock: path.join(factory, "runtime", "owner-lock.json"),
    activeRun: path.join(factory, "runtime", "active-run.json"),
    recoveryLog: path.join(factory, "runtime", "recovery-log.jsonl"),
    ownerLockMutex: path.join(factory, "runtime", "owner-lock.mutex"),
    verification: path.join(factory, "verification"),
    marketPolicy: path.join(factory, "market-policy.json"),
    artifacts: path.join(factory, "artifacts"),
    artifactIndex: path.join(factory, "artifacts", "index.json"),
    artifactManifests: path.join(factory, "artifacts", "manifests"),
    evidenceIndex: path.join(factory, "evidence", "index.json"),
    mt5: path.join(factory, "mt5"),
    mt5Environment: path.join(factory, "mt5", "environment"),
    mt5Tester: path.join(factory, "mt5", "tester"),
    mt5Native: path.join(factory, "mt5", "native"),
    mt5Bridge: path.join(factory, "mt5", "bridge"),
    lessons: path.join(factory, "memory", "lessons.jsonl"),
    retrievalIndex: path.join(factory, "memory", "retrieval_index.json"),
    memoryQuarantine: path.join(factory, "memory", "quarantine"),
    runs: path.join(factory, "runs"),
    experiments: path.join(factory, "experiments"),
    summaries: path.join(factory, "summaries"),
    workspaceResults: path.join(workspace, "results"),
    strategyDigest: path.join(factory, "strategy_digest.md"),
    iterationDigest: path.join(factory, "iteration_digest.txt")
  };
}

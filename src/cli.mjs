#!/usr/bin/env node
import process from "node:process";
import { loadRuntimeConfig } from "./core/config.mjs";
import { initializeProject } from "./core/init.mjs";
import { buildPaths } from "./core/paths.mjs";
import { readJson } from "./core/fs-utils.mjs";
import { readLeaderboardEntries } from "./core/leaderboard-store.mjs";
import { runFactory } from "./core/orchestrator.mjs";
import { readOwnerLock, isOwnerLockExpired } from "./core/runtime-lock.mjs";
import { startObserverServer } from "./observer/server.mjs";

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

function createShutdownController() {
  let handler = null;
  let shuttingDown = false;

  return {
    setHandler(nextHandler) {
      handler = nextHandler;
    },
    async handle(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      if (typeof handler === "function") {
        await handler(signal);
      }
    }
  };
}

const runtime = loadRuntimeConfig(process.argv.slice(2));
initializeProject(runtime.rootIdentity);
const command = runtime.command;

if (command === "status") {
  const paths = buildPaths(runtime.rootIdentity);
  const state = readJson(paths.state, {});
  const activeRun = readJson(paths.activeRun, {});
  const ownerLock = readOwnerLock(paths);
  const backlog = readJson(paths.backlog, []);
  const leaderboard = readLeaderboardEntries(paths);
  console.log(JSON.stringify({ state, owner: {
    owner_id: ownerLock.owner_id ?? null,
    heartbeat_at: ownerLock.heartbeat_at ?? null,
    expires_at: ownerLock.expires_at ?? null,
    healthy: ownerLock.status === "owned" && !isOwnerLockExpired(ownerLock)
  }, active_run: activeRun, backlog_counts: backlog.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {}), top_leaderboard: leaderboard.slice(0, 5) }, null, 2));
  process.exit(0);
}

if (command === "follow") {
  const paths = buildPaths(runtime.rootIdentity);
  const activeRun = readJson(paths.activeRun, {});
  const followUrl = activeRun.follow_url || `${runtime.observerBaseUrl}/follow`;
  console.log(JSON.stringify({
    follow_url: followUrl,
    active_run: activeRun,
    observer_base_url: runtime.observerBaseUrl
  }, null, 2));
  process.exit(0);
}

if (command === "run") {
  const shutdownController = createShutdownController();
  const paths = buildPaths(runtime.rootIdentity);
  let observer = null;
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      shutdownController.handle(signal)
        .catch((error) => {
          console.error(error instanceof Error ? error.stack : String(error));
        })
        .finally(() => {
          process.exit(signalExitCode(signal));
        });
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  let exitCode = 0;
  try {
    observer = await startObserverServer(paths, { host: runtime.observerHost, port: runtime.observerPort });
    const result = await runFactory({ ...runtime, observerBaseUrl: observer.baseUrl, shutdownController });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    exitCode = 1;
  } finally {
    if (observer) {
      await observer.close().catch(() => {});
    }
    for (const [signal, handler] of signalHandlers.entries()) {
      process.off(signal, handler);
    }
  }
  process.exit(exitCode);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

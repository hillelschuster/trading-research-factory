import http from "node:http";
import fs from "fs";
import path from "path";
import { readJson } from "../core/fs-utils.mjs";
import { readOwnerLock, isOwnerLockExpired } from "../core/runtime-lock.mjs";

function readTextTail(filePath, maxLines = 40) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  return lines.slice(-maxLines);
}

function latestRunLogPath(paths, activeRun) {
  const runId = activeRun?.run_id;
  if (!runId) return null;
  return path.join(paths.runs, runId, "run.log");
}

export function readObserverSnapshot(paths, { nowMs = Date.now() } = {}) {
  const ownerLock = readOwnerLock(paths);
  const activeRun = readJson(paths.activeRun, {});
  const health = readJson(paths.health, {});
  const ownerHealthy = ownerLock.status === "owned" && !isOwnerLockExpired(ownerLock, nowMs);
  const heartbeatAgeMs = activeRun?.heartbeat_at ? Math.max(0, nowMs - Date.parse(activeRun.heartbeat_at)) : null;
  const runLogTail = readTextTail(latestRunLogPath(paths, activeRun), 30);
  const recoveryLogTail = readTextTail(paths.recoveryLog, 30).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });

  return {
    schema_version: "observer_snapshot_v1",
    observed_at: new Date(nowMs).toISOString(),
    owner: {
      healthy: ownerHealthy,
      owner_id: ownerLock.owner_id ?? null,
      heartbeat_at: ownerLock.heartbeat_at ?? null,
      expires_at: ownerLock.expires_at ?? null,
      mode: ownerLock.mode ?? null
    },
    active_run: {
      status: activeRun.status ?? "idle",
      run_id: activeRun.run_id ?? null,
      run_instance_id: activeRun.run_instance_id ?? null,
      backlog_item_id: activeRun.backlog_item_id ?? null,
      stage: activeRun.stage ?? null,
      attempt: activeRun.attempt ?? null,
      session_id: activeRun.session_id ?? null,
      session_url: activeRun.session_url ?? null,
      follow_url: activeRun.follow_url ?? null,
      last_error: activeRun.last_error ?? null,
      heartbeat_at: activeRun.heartbeat_at ?? null,
      heartbeat_age_ms: heartbeatAgeMs
    },
    health: {
      cooldown_run_count: health.cooldown_run_count ?? 0,
      quarantined_run_count: health.quarantined_run_count ?? 0,
      transport_retry_recovery_rate: health.transport_retry_recovery_rate ?? null
    },
    recovery_log_tail: recoveryLogTail,
    run_log_tail: runLogTail
  };
}

function htmlPage(snapshot) {
  const active = snapshot.active_run || {};
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Factory Observer</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; background: #0b1020; color: #e7ecf5; }
    .muted { color: #9fb0c7; }
    .panel { background: #141b2d; border: 1px solid #2a3551; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    a { color: #8cc7ff; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div class="panel">
    <div>status: <strong>${active.status ?? "idle"}</strong></div>
    <div>run: ${active.run_id ?? "idle"}</div>
    <div>stage: ${active.stage ?? "n/a"}</div>
    <div>attempt: ${active.attempt ?? "n/a"}</div>
    <div>owner healthy: ${String(snapshot.owner?.healthy ?? false)}</div>
    <div>heartbeat age ms: ${active.heartbeat_age_ms ?? "n/a"}</div>
    <div>session: ${active.session_url ? `<a href="${active.session_url}">${active.session_url}</a>` : "n/a"}</div>
    <div>follow: ${active.follow_url ? `<a href="${active.follow_url}">${active.follow_url}</a>` : "n/a"}</div>
    <div>last error: <span class="muted">${active.last_error ?? "none"}</span></div>
  </div>
  <div class="panel">
    <div>run log tail</div>
    <pre>${snapshot.run_log_tail.join("\n")}</pre>
  </div>
  <div class="panel">
    <div>recovery log tail</div>
    <pre>${snapshot.recovery_log_tail.map((item) => JSON.stringify(item)).join("\n")}</pre>
  </div>
</body>
</html>`;
}

export async function startObserverServer(paths, { host = "127.0.0.1", port = 4310 } = {}) {
  const server = http.createServer((req, res) => {
    const snapshot = readObserverSnapshot(paths);
    if (req.url === "/api/observer" || req.url === "/api/observer/") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(snapshot, null, 2));
      return;
    }

    if (req.url === "/follow" || req.url === "/" || req.url === "/follow/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlPage(snapshot));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    server,
    baseUrl: `http://${host}:${port}`,
    followUrl: `http://${host}:${port}/follow`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

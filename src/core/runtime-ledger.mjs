import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { assertContainedPath, ensureDir } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const RUNTIME_LEDGER_SCHEMA_VERSION = "phase7b_runtime_ledger_v1";

export const RUNTIME_LEDGER_TABLES = [
  "runs",
  "jobs",
  "job_attempts",
  "leases",
  "heartbeats",
  "artifacts",
  "trial_attempts",
  "outbox",
  "schema_metadata"
];

function nowIso() {
  return new Date().toISOString();
}

function jsonText(value) {
  return JSON.stringify(value ?? {});
}

function sha256Text(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableLedgerId(prefix, parts) {
  return `${prefix}-${sha256Text(JSON.stringify(parts)).slice(0, 32)}`;
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Runtime ledger ${field} is required.`);
  }
  return value.trim();
}

function plusMs(isoTime, ms) {
  return new Date(Date.parse(isoTime) + ms).toISOString();
}

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusyError(error) {
  return error?.code === "ERR_SQLITE_ERROR" && /SQLITE_BUSY|database is locked|database is busy/i.test(String(error.message));
}

function normalizePaths(rootOrPaths) {
  return rootOrPaths?.root && rootOrPaths?.runtime ? rootOrPaths : buildPaths(rootOrPaths ?? process.cwd());
}

function safePayload(value) {
  return value && typeof value === "object" ? value : {};
}

function jsonObjectFromText(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueArtifacts(artifacts) {
  const seen = new Set();
  const out = [];
  for (const artifact of artifacts.filter((entry) => entry && typeof entry === "object" && entry.path)) {
    const key = `${artifact.artifact_type ?? "artifact"}:${artifact.path}:${artifact.sha256 ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(artifact);
  }
  return out;
}

export function runtimeLedgerPath(rootOrPaths) {
  const paths = normalizePaths(rootOrPaths);
  return path.join(paths.runtime, "factory.sqlite");
}

function isLikelyDrvFs(dbPath) {
  return path.resolve(dbPath).startsWith(`${path.sep}mnt${path.sep}`);
}

export class RuntimeLedger {
  constructor({ rootDir = process.cwd(), dbPath = null, timeoutMs = 5000 } = {}) {
    this.paths = normalizePaths(rootDir);
    this.dbPath = assertContainedPath(dbPath ?? runtimeLedgerPath(this.paths), this.paths);
    ensureDir(path.dirname(this.dbPath), this.paths);
    this.timeoutMs = timeoutMs;
    this.db = new DatabaseSync(this.dbPath, {
      timeout: timeoutMs,
      enableForeignKeyConstraints: true
    });
    this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${Number(timeoutMs) || 5000};`);
  }

  close() {
    if (this.db?.isOpen) this.db.close();
  }

  migrate() {
    const journalMode = this.db.prepare("PRAGMA journal_mode = DELETE").get().journal_mode;
    this.withImmediateTransaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          run_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          evidence_kind TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}'
        ) STRICT;

        CREATE TABLE IF NOT EXISTS jobs (
          job_id TEXT PRIMARY KEY,
          run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
          job_type TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}'
        ) STRICT;

        CREATE TABLE IF NOT EXISTS job_attempts (
          attempt_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL,
          status TEXT NOT NULL,
          worker TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}',
          UNIQUE(job_id, attempt_number)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS leases (
          job_id TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
          owner_id TEXT NOT NULL,
          fencing_token INTEGER NOT NULL,
          claimed_at TEXT NOT NULL,
          heartbeat_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          status TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS heartbeats (
          heartbeat_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
          owner_id TEXT NOT NULL,
          fencing_token INTEGER NOT NULL,
          heartbeat_at TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}'
        ) STRICT;

        CREATE TABLE IF NOT EXISTS artifacts (
          artifact_id TEXT PRIMARY KEY,
          run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
          job_id TEXT REFERENCES jobs(job_id) ON DELETE CASCADE,
          attempt_id TEXT REFERENCES job_attempts(attempt_id) ON DELETE CASCADE,
          artifact_type TEXT NOT NULL,
          path TEXT NOT NULL,
          sha256 TEXT,
          size_bytes INTEGER,
          created_at TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}'
        ) STRICT;

        CREATE TABLE IF NOT EXISTS trial_attempts (
          trial_attempt_id TEXT PRIMARY KEY,
          run_id TEXT REFERENCES runs(run_id) ON DELETE CASCADE,
          job_id TEXT REFERENCES jobs(job_id) ON DELETE CASCADE,
          attempt_id TEXT REFERENCES job_attempts(attempt_id) ON DELETE CASCADE,
          trial_kind TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}'
        ) STRICT;

        CREATE TABLE IF NOT EXISTS outbox (
          event_id TEXT PRIMARY KEY,
          aggregate_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          processed_at TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}'
        ) STRICT;

        CREATE TABLE IF NOT EXISTS schema_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `);

      const sqliteVersion = this.db.prepare("SELECT sqlite_version() AS sqlite_version").get().sqlite_version;
      const updatedAt = nowIso();
      const setMetadata = this.db.prepare(`
        INSERT INTO schema_metadata(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      setMetadata.run("schema_version", RUNTIME_LEDGER_SCHEMA_VERSION, updatedAt);
      setMetadata.run("sqlite_version", sqliteVersion, updatedAt);
      setMetadata.run("journal_mode", String(journalMode), updatedAt);
      setMetadata.run("wal_enabled", "false", updatedAt);
      setMetadata.run("wal_reason", isLikelyDrvFs(this.dbPath) ? "disabled_on_drvfs_or_mounted_path" : "disabled_for_minimal_phase7b_slice", updatedAt);
      setMetadata.run("busy_timeout_ms", String(this.timeoutMs), updatedAt);
      setMetadata.run("db_path", this.dbPath, updatedAt);
      setMetadata.run("db_filesystem_location", isLikelyDrvFs(this.dbPath) ? "mounted_path" : "local_or_unknown", updatedAt);
    });
    return this.diagnostics();
  }

  withImmediateTransaction(fn, { maxRetries = 0, retryDelayMs = 25, onRetry = null } = {}) {
    let attempt = 0;
    while (true) {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const result = fn();
          this.db.exec("COMMIT");
          return result;
        } catch (error) {
          if (this.db.isTransaction) this.db.exec("ROLLBACK");
          throw error;
        }
      } catch (error) {
        if (!isBusyError(error) || attempt >= maxRetries) throw error;
        attempt += 1;
        onRetry?.({ attempt, error });
        sleepSync(retryDelayMs);
      }
    }
  }

  diagnostics() {
    return {
      schema_version: this.getMetadata("schema_version"),
      sqlite_version: this.getMetadata("sqlite_version"),
      journal_mode: this.getMetadata("journal_mode"),
      wal_enabled: this.getMetadata("wal_enabled") === "true",
      wal_reason: this.getMetadata("wal_reason"),
      busy_timeout_ms: Number(this.getMetadata("busy_timeout_ms")),
      db_path: this.dbPath,
      db_exists: fs.existsSync(this.dbPath),
      db_filesystem_location: this.getMetadata("db_filesystem_location")
    };
  }

  tableNames() {
    return this.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  }

  getMetadata(key) {
    return this.db.prepare("SELECT value FROM schema_metadata WHERE key = ?").get(key)?.value ?? null;
  }

  insertRun(run) {
    const createdAt = run.created_at ?? nowIso();
    this.db.prepare(`
      INSERT INTO runs(run_id, status, evidence_kind, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(requireText(run.run_id, "run_id"), requireText(run.status, "status"), run.evidence_kind ?? null, createdAt, run.updated_at ?? createdAt, jsonText(run.payload));
  }

  getRun(runId) {
    return this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) ?? null;
  }

  insertJob(job) {
    const createdAt = job.created_at ?? nowIso();
    this.db.prepare(`
      INSERT INTO jobs(job_id, run_id, job_type, status, priority, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requireText(job.job_id, "job_id"), job.run_id ?? null, requireText(job.job_type, "job_type"), requireText(job.status, "status"), job.priority ?? 0, createdAt, job.updated_at ?? createdAt, jsonText(job.payload));
  }

  getJob(jobId) {
    return this.db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId) ?? null;
  }

  getLease(jobId) {
    return this.db.prepare("SELECT * FROM leases WHERE job_id = ?").get(jobId) ?? null;
  }

  claimNextJob({ owner_id, job_type = null, lease_ms = 60000, now = nowIso(), maxRetries = 0, retryDelayMs = 25, onRetry = null } = {}) {
    const ownerId = requireText(owner_id, "owner_id");
    return this.withImmediateTransaction(() => {
      const job = this.db.prepare(`
        SELECT jobs.*, leases.owner_id AS prior_owner_id, leases.fencing_token AS prior_fencing_token,
               leases.claimed_at AS prior_claimed_at, leases.heartbeat_at AS prior_heartbeat_at,
               leases.expires_at AS prior_expires_at, leases.status AS prior_lease_status
        FROM jobs
        LEFT JOIN leases ON leases.job_id = jobs.job_id
        WHERE jobs.status IN ('queued', 'ready', 'claimed')
          AND (? IS NULL OR jobs.job_type = ?)
          AND (
            (jobs.status IN ('queued', 'ready') AND (leases.job_id IS NULL OR leases.expires_at <= ?))
            OR (jobs.status = 'claimed' AND leases.expires_at <= ?)
          )
        ORDER BY jobs.priority DESC, jobs.created_at ASC, jobs.job_id ASC
        LIMIT 1
      `).get(job_type, job_type, now, now);
      if (!job) return null;

      const reclaimedStaleLease = job.status === "claimed" && job.prior_lease_status === "active" && job.prior_expires_at <= now;
      const fencingToken = Number(job.prior_fencing_token ?? 0) + 1;
      const expiresAt = plusMs(now, lease_ms);
      this.db.prepare("UPDATE jobs SET status = 'claimed', updated_at = ? WHERE job_id = ?").run(now, job.job_id);
      this.db.prepare(`
        INSERT INTO leases(job_id, owner_id, fencing_token, claimed_at, heartbeat_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(job_id) DO UPDATE SET
          owner_id = excluded.owner_id,
          fencing_token = excluded.fencing_token,
          claimed_at = excluded.claimed_at,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at,
          status = excluded.status
      `).run(job.job_id, ownerId, fencingToken, now, now, expiresAt);

      return {
        job: this.getJob(job.job_id),
        lease: this.getLease(job.job_id),
        claim: {
          reclaimed_stale_lease: reclaimedStaleLease,
          prior_owner_id: reclaimedStaleLease ? job.prior_owner_id : null,
          prior_fencing_token: reclaimedStaleLease ? job.prior_fencing_token : null,
          prior_claimed_at: reclaimedStaleLease ? job.prior_claimed_at : null,
          prior_heartbeat_at: reclaimedStaleLease ? job.prior_heartbeat_at : null,
          prior_expires_at: reclaimedStaleLease ? job.prior_expires_at : null,
          new_fencing_token: fencingToken
        }
      };
    }, { maxRetries, retryDelayMs, onRetry });
  }

  insertJobAttempt(attempt) {
    this.db.prepare(`
      INSERT INTO job_attempts(attempt_id, job_id, attempt_number, status, worker, started_at, finished_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requireText(attempt.attempt_id, "attempt_id"),
      requireText(attempt.job_id, "job_id"),
      attempt.attempt_number ?? 1,
      requireText(attempt.status, "status"),
      attempt.worker ?? null,
      attempt.started_at ?? nowIso(),
      attempt.finished_at ?? null,
      jsonText(attempt.payload)
    );
  }

  getJobAttempt(attemptId) {
    return this.db.prepare("SELECT * FROM job_attempts WHERE attempt_id = ?").get(attemptId) ?? null;
  }

  recordHeartbeat({ job_id, owner_id, fencing_token, lease_ms = 60000, heartbeat_id = null, now = nowIso() }) {
    const jobId = requireText(job_id, "job_id");
    const ownerId = requireText(owner_id, "owner_id");
    return this.withImmediateTransaction(() => {
      const update = this.db.prepare(`
        UPDATE leases
        SET heartbeat_at = ?, expires_at = ?, status = 'active'
        WHERE job_id = ? AND owner_id = ? AND fencing_token = ? AND status = 'active'
      `).run(now, plusMs(now, lease_ms), jobId, ownerId, fencing_token);
      if (update.changes !== 1) {
        throw new Error(`Runtime ledger heartbeat rejected by fencing token for job: ${jobId}`);
      }
      const id = heartbeat_id ?? `HB-${randomUUID()}`;
      this.db.prepare(`
        INSERT INTO heartbeats(heartbeat_id, job_id, owner_id, fencing_token, heartbeat_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, jobId, ownerId, fencing_token, now, jsonText({ lease_ms }));
      return this.getLease(jobId);
    });
  }

  finalizeJob({ job_id, owner_id, fencing_token, status, now = nowIso() }) {
    const jobId = requireText(job_id, "job_id");
    const ownerId = requireText(owner_id, "owner_id");
    return this.withImmediateTransaction(() => {
      const lease = this.db.prepare("SELECT * FROM leases WHERE job_id = ? AND owner_id = ? AND fencing_token = ? AND status = 'active'").get(jobId, ownerId, fencing_token);
      if (!lease) {
        throw new Error(`Runtime ledger finalize rejected by fencing token for job: ${jobId}`);
      }
      this.db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE job_id = ?").run(requireText(status, "status"), now, jobId);
      this.db.prepare("UPDATE leases SET status = 'released', heartbeat_at = ?, expires_at = ? WHERE job_id = ?").run(now, now, jobId);
      return this.getJob(jobId);
    });
  }

  insertArtifact(artifact) {
    this.db.prepare(`
      INSERT INTO artifacts(artifact_id, run_id, job_id, attempt_id, artifact_type, path, sha256, size_bytes, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requireText(artifact.artifact_id, "artifact_id"),
      artifact.run_id ?? null,
      artifact.job_id ?? null,
      artifact.attempt_id ?? null,
      requireText(artifact.artifact_type, "artifact_type"),
      requireText(artifact.path, "path"),
      artifact.sha256 ?? null,
      artifact.size_bytes ?? null,
      artifact.created_at ?? nowIso(),
      jsonText(artifact.payload)
    );
  }

  getArtifact(artifactId) {
    return this.db.prepare("SELECT * FROM artifacts WHERE artifact_id = ?").get(artifactId) ?? null;
  }

  insertTrialAttempt(trial) {
    this.db.prepare(`
      INSERT INTO trial_attempts(trial_attempt_id, run_id, job_id, attempt_id, trial_kind, status, started_at, finished_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requireText(trial.trial_attempt_id, "trial_attempt_id"),
      trial.run_id ?? null,
      trial.job_id ?? null,
      trial.attempt_id ?? null,
      requireText(trial.trial_kind, "trial_kind"),
      requireText(trial.status, "status"),
      trial.started_at ?? nowIso(),
      trial.finished_at ?? null,
      jsonText(trial.payload)
    );
  }

  getTrialAttempt(trialAttemptId) {
    return this.db.prepare("SELECT * FROM trial_attempts WHERE trial_attempt_id = ?").get(trialAttemptId) ?? null;
  }

  recordRunStatusWithOutbox({ run_id, status, event_id, event_type, payload = {} }) {
    return this.withImmediateTransaction(() => {
      const updatedAt = nowIso();
      const update = this.db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ?").run(requireText(status, "status"), updatedAt, requireText(run_id, "run_id"));
      if (update.changes !== 1) throw new Error(`Runtime ledger run not found for transition: ${run_id}`);
      this.db.prepare(`
        INSERT INTO outbox(event_id, aggregate_type, aggregate_id, event_type, status, created_at, payload_json)
        VALUES (?, 'run', ?, ?, 'pending', ?, ?)
      `).run(requireText(event_id, "event_id"), run_id, requireText(event_type, "event_type"), updatedAt, jsonText(payload));
      return this.getRun(run_id);
    });
  }

  getOutboxEvent(eventId) {
    return this.db.prepare("SELECT * FROM outbox WHERE event_id = ?").get(eventId) ?? null;
  }

  listPendingOutboxEvents({ event_type = null, limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(1000, Number.isInteger(limit) ? limit : 100));
    return this.db.prepare(`
      SELECT * FROM outbox
      WHERE status = 'pending' AND (? IS NULL OR event_type = ?)
      ORDER BY created_at ASC, event_id ASC
      LIMIT ?
    `).all(event_type, event_type, safeLimit);
  }

  markOutboxEventProcessed({ event_id, consumer_id, now = nowIso(), result = {} }) {
    const eventId = requireText(event_id, "event_id");
    const consumerId = requireText(consumer_id, "consumer_id");
    return this.withImmediateTransaction(() => {
      const event = this.getOutboxEvent(eventId);
      if (!event) throw new Error(`Runtime ledger outbox event not found: ${eventId}`);
      if (event.status === "processed") {
        return { processed: false, already_processed: true, event };
      }

      const payload = jsonObjectFromText(event.payload_json);
      this.db.prepare(`
        UPDATE outbox
        SET status = 'processed', processed_at = ?, payload_json = ?
        WHERE event_id = ? AND status != 'processed'
      `).run(now, jsonText({
        ...payload,
        outbox_consumer: {
          consumer_id: consumerId,
          processed_at: now,
          result: safePayload(result)
        }
      }), eventId);

      return { processed: true, already_processed: false, event: this.getOutboxEvent(eventId) };
    });
  }

  recordResearchWfaWorkerResult({ request, workerResult, executionResult, trialAttempt, projectionArtifacts = [] }) {
    const runId = requireText(workerResult?.run_id ?? request?.run_id, "research_wfa run_id");
    const jobId = requireText(workerResult?.job_id ?? request?.job_id, "research_wfa job_id");
    const attemptId = requireText(workerResult?.attempt_id ?? request?.attempt_id, "research_wfa attempt_id");
    const status = requireText(executionResult?.status ?? workerResult?.status, "research_wfa status");
    const startedAt = trialAttempt?.started_at ?? workerResult?.observations?.worker_start_time ?? nowIso();
    const finishedAt = trialAttempt?.ended_at ?? workerResult?.observed_at ?? executionResult?.observed_at ?? nowIso();
    const artifacts = uniqueArtifacts([...(workerResult?.artifacts ?? []), ...projectionArtifacts]);
    const trialAttemptId = requireText(trialAttempt?.trial_id ?? `${runId}:${attemptId}`, "research_wfa trial_attempt_id");
    const outboxEventId = stableLedgerId("EVT-WFA-MIRROR", [runId, jobId, attemptId, status]);

    return this.withImmediateTransaction(() => {
      this.db.prepare(`
        INSERT INTO runs(run_id, status, evidence_kind, created_at, updated_at, payload_json)
        VALUES (?, ?, 'research_wfa', ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          status = excluded.status,
          evidence_kind = excluded.evidence_kind,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `).run(runId, status, startedAt, finishedAt, jsonText({
        mirror_source: "research_wfa_run_worker_json_artifacts",
        json_artifacts_remain_projection_source: true,
        request_identity: workerResult?.observations?.request_identity ?? null,
        candidate_id: workerResult?.candidate_id ?? request?.candidate_id ?? null,
        lineage_id: workerResult?.lineage_id ?? request?.lineage_id ?? null,
        family_id: workerResult?.family_id ?? request?.family_id ?? null,
        metrics: safePayload(workerResult?.metrics ?? executionResult?.metrics_observed),
        diagnostics: safePayload(workerResult?.diagnostics)
      }));

      this.db.prepare(`
        INSERT INTO jobs(job_id, run_id, job_type, status, priority, created_at, updated_at, payload_json)
        VALUES (?, ?, 'research_wfa_run', ?, 0, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          run_id = excluded.run_id,
          job_type = excluded.job_type,
          status = excluded.status,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `).run(jobId, runId, status, startedAt, finishedAt, jsonText({
        mirror_source: "research_wfa_run_worker_json_artifacts",
        authority_layer: workerResult?.authority_layer ?? request?.authority_layer ?? null,
        evidence_kind: workerResult?.evidence_kind ?? request?.evidence_kind ?? null,
        wfa_config_path: request?.wfa_config_path ?? null
      }));

      this.db.prepare(`
        INSERT INTO job_attempts(attempt_id, job_id, attempt_number, status, worker, started_at, finished_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id) DO UPDATE SET
          job_id = excluded.job_id,
          attempt_number = excluded.attempt_number,
          status = excluded.status,
          worker = excluded.worker,
          finished_at = excluded.finished_at,
          payload_json = excluded.payload_json
      `).run(
        attemptId,
        jobId,
        request?.attempt_number ?? 1,
        requireText(workerResult?.status ?? status, "research_wfa attempt status"),
        workerResult?.worker ?? "research_wfa_run",
        startedAt,
        finishedAt,
        jsonText({
          mirror_source: "research_wfa_run_worker_json_artifacts",
          attempt_type: workerResult?.attempt_type ?? request?.attempt_type ?? null,
          blocked_reason: workerResult?.blocked_reason ?? executionResult?.blocked_reason ?? null,
          observations: safePayload(workerResult?.observations)
        })
      );

      for (const artifact of artifacts) {
        const artifactId = stableLedgerId("ART", [runId, jobId, attemptId, artifact.artifact_type ?? "artifact", artifact.path, artifact.sha256 ?? null]);
        this.db.prepare(`
          INSERT INTO artifacts(artifact_id, run_id, job_id, attempt_id, artifact_type, path, sha256, size_bytes, created_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(artifact_id) DO UPDATE SET
            artifact_type = excluded.artifact_type,
            path = excluded.path,
            sha256 = excluded.sha256,
            size_bytes = excluded.size_bytes,
            payload_json = excluded.payload_json
        `).run(
          artifactId,
          runId,
          jobId,
          attemptId,
          requireText(artifact.artifact_type ?? "artifact", "research_wfa artifact_type"),
          requireText(artifact.path, "research_wfa artifact path"),
          artifact.sha256 ?? null,
          artifact.size_bytes ?? null,
          artifact.modified_at ?? finishedAt,
          jsonText({ ...artifact, mirror_source: "research_wfa_run_worker_json_artifacts" })
        );
      }

      this.db.prepare(`
        INSERT INTO trial_attempts(trial_attempt_id, run_id, job_id, attempt_id, trial_kind, status, started_at, finished_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(trial_attempt_id) DO UPDATE SET
          run_id = excluded.run_id,
          job_id = excluded.job_id,
          attempt_id = excluded.attempt_id,
          trial_kind = excluded.trial_kind,
          status = excluded.status,
          finished_at = excluded.finished_at,
          payload_json = excluded.payload_json
      `).run(
        trialAttemptId,
        runId,
        jobId,
        attemptId,
        requireText(trialAttempt?.attempt_type ?? request?.attempt_type ?? "worker_launched_wfa", "research_wfa trial_kind"),
        requireText(trialAttempt?.status ?? workerResult?.status ?? status, "research_wfa trial status"),
        startedAt,
        finishedAt,
        jsonText({ ...safePayload(trialAttempt), mirror_source: "research_wfa_run_worker_json_artifacts" })
      );

      this.db.prepare(`
        INSERT INTO outbox(event_id, aggregate_type, aggregate_id, event_type, status, created_at, payload_json)
        VALUES (?, 'run', ?, 'research_wfa.worker_result_mirrored', 'pending', ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          status = excluded.status,
          payload_json = excluded.payload_json
      `).run(outboxEventId, runId, finishedAt, jsonText({ run_id: runId, job_id: jobId, attempt_id: attemptId, status }));

      return {
        run_id: runId,
        job_id: jobId,
        attempt_id: attemptId,
        trial_attempt_id: trialAttemptId,
        artifacts_recorded: artifacts.length,
        outbox_event_id: outboxEventId
      };
    });
  }
}

export function migrateRuntimeLedger({ rootDir = process.cwd(), dbPath = null, timeoutMs = 5000 } = {}) {
  const ledger = new RuntimeLedger({ rootDir, dbPath, timeoutMs });
  try {
    const diagnostics = ledger.migrate();
    return {
      ...diagnostics,
      tables: ledger.tableNames()
    };
  } finally {
    ledger.close();
  }
}

export function recordResearchWfaWorkerResultInRuntimeLedger({ rootDir = process.cwd(), dbPath = null, timeoutMs = 5000, request, workerResult, executionResult, trialAttempt, projectionArtifacts = [] } = {}) {
  const ledger = new RuntimeLedger({ rootDir, dbPath, timeoutMs });
  try {
    ledger.migrate();
    return ledger.recordResearchWfaWorkerResult({ request, workerResult, executionResult, trialAttempt, projectionArtifacts });
  } finally {
    ledger.close();
  }
}

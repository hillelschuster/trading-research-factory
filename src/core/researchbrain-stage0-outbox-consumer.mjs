import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RuntimeLedger } from "./runtime-ledger.mjs";

export const RESEARCHBRAIN_STAGE0_OUTBOX_PROJECTION_SCHEMA_VERSION = "researchbrain_stage0_outbox_projection_v1";
export const RESEARCHBRAIN_STAGE0_OUTBOX_CONSUMER_RESULT_SCHEMA_VERSION = "researchbrain_stage0_outbox_consumer_result_v1";
export const RESEARCHBRAIN_STAGE0_JOB_FINISHED_EVENT = "researchbrain.stage0_job_finished";

function nowIso() {
  return new Date().toISOString();
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function safePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "event";
}

function resolveRepoRelativePath(rootDir, repoPath, label = "path") {
  if (typeof repoPath !== "string" || repoPath.trim().length === 0 || path.isAbsolute(repoPath)) {
    throw new Error(`ResearchBrain outbox ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain outbox ${label} escapes repository root: ${repoPath}`);
  }
  return fullPath;
}

function writeJson(rootDir, repoPath, value) {
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "projection_path");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return {
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: fs.statSync(fullPath).size
  };
}

function jsonObjectFromText(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compactRow(row, fields) {
  if (!row) return null;
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

function compactFailureSummary({ eventPayload, attemptPayload }) {
  const summary = eventPayload?.failure_summary ?? attemptPayload?.failure_summary ?? null;
  if (summary && typeof summary === "object" && !Array.isArray(summary)) return summary;
  const failure = eventPayload?.failure ?? attemptPayload?.failure ?? null;
  if (failure && typeof failure === "object" && !Array.isArray(failure)) {
    return {
      failure_class: failure.failure_class ?? null,
      retryable: failure.retryable ?? null,
      error_message: failure.error_message ?? null,
      final_terminal_state: attemptPayload?.final_terminal_state ?? null,
      request_artifact: null,
      runtime_result_artifact: attemptPayload?.result_artifact ?? null,
      quarantine_paths: attemptPayload?.quarantine_paths ?? [],
      blockers: attemptPayload?.blockers ?? []
    };
  }
  if (eventPayload?.status === "blocked" || eventPayload?.status === "poisoned") {
    return {
      failure_class: eventPayload.status === "poisoned" ? "poison_candidate_or_run" : null,
      retryable: false,
      error_message: null,
      final_terminal_state: attemptPayload?.final_terminal_state ?? null,
      request_artifact: attemptPayload?.verified_request_artifact ?? null,
      runtime_result_artifact: attemptPayload?.result_artifact ?? null,
      quarantine_paths: attemptPayload?.quarantine_paths ?? [],
      blockers: attemptPayload?.blockers ?? []
    };
  }
  return null;
}

function listArtifactsForJob(ledger, jobId) {
  if (typeof jobId !== "string" || jobId.length === 0) return [];
  return ledger.db.prepare(`
    SELECT artifact_type, path, sha256, size_bytes, created_at
    FROM artifacts
    WHERE job_id = ?
    ORDER BY artifact_type ASC, path ASC
  `).all(jobId);
}

function buildProjection({ ledger, event, consumerId, projectedAt }) {
  const payload = jsonObjectFromText(event.payload_json);
  const run = ledger.getRun(event.aggregate_id);
  const job = payload.job_id ? ledger.getJob(payload.job_id) : null;
  const attempt = payload.attempt_id ? ledger.getJobAttempt(payload.attempt_id) : null;
  const attemptPayload = jsonObjectFromText(attempt?.payload_json);
  const artifacts = listArtifactsForJob(ledger, payload.job_id);
  return {
    schema_version: RESEARCHBRAIN_STAGE0_OUTBOX_PROJECTION_SCHEMA_VERSION,
    projected_at: projectedAt,
    consumer_id: consumerId,
    event: {
      event_id: event.event_id,
      event_type: event.event_type,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      created_at: event.created_at,
      payload
    },
    run: compactRow(run, ["run_id", "status", "evidence_kind", "created_at", "updated_at"]),
    job: compactRow(job, ["job_id", "run_id", "job_type", "status", "priority", "created_at", "updated_at"]),
    attempt: compactRow(attempt, ["attempt_id", "job_id", "attempt_number", "status", "worker", "started_at", "finished_at"]),
    failure_summary: compactFailureSummary({ eventPayload: payload, attemptPayload }),
    artifacts,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    wfa_executed: false,
    mt5_executed: false
  };
}

export function consumeResearchBrainStage0Outbox({
  rootDir = process.cwd(),
  dbPath = null,
  consumerId = `researchbrain-stage0-outbox-consumer-${process.pid}`,
  limit = 25,
  outputDir = "factory/runtime/projections/researchbrain-stage0"
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("ResearchBrain outbox consumer limit must be an integer from 1 to 100.");
  const root = path.resolve(rootDir);
  resolveRepoRelativePath(root, outputDir, "output_dir");
  const ledger = new RuntimeLedger({ rootDir: root, dbPath });
  const processed = [];
  try {
    ledger.migrate();
    const events = ledger.listPendingOutboxEvents({ event_type: RESEARCHBRAIN_STAGE0_JOB_FINISHED_EVENT, limit });
    for (const event of events) {
      const projectedAt = nowIso();
      const projection = buildProjection({ ledger, event, consumerId, projectedAt });
      const projectionArtifact = writeJson(root, `${outputDir}/${safePathPart(event.event_id)}.json`, projection);
      const marked = ledger.markOutboxEventProcessed({
        event_id: event.event_id,
        consumer_id: consumerId,
        now: projectedAt,
        result: {
          projection_artifact: projectionArtifact,
          projected_status: projection.event.payload.status ?? projection.run?.status ?? null
        }
      });
      processed.push({
        event_id: event.event_id,
        processed: marked.processed,
        already_processed: marked.already_processed,
        projection_artifact: projectionArtifact,
        projected_status: projection.event.payload.status ?? projection.run?.status ?? null
      });
    }
    return {
      schema_version: RESEARCHBRAIN_STAGE0_OUTBOX_CONSUMER_RESULT_SCHEMA_VERSION,
      generated_at: nowIso(),
      consumer_id: consumerId,
      event_type: RESEARCHBRAIN_STAGE0_JOB_FINISHED_EVENT,
      status: processed.length > 0 ? "processed" : "empty",
      events_processed: processed.length,
      processed,
      official_state_mutated: false,
      official_evidence_index_mutated: false,
      official_backlog_mutated: false,
      official_leaderboard_mutated: false,
      profitability_labels_created: false,
      wfa_executed: false,
      mt5_executed: false
    };
  } finally {
    ledger.close();
  }
}

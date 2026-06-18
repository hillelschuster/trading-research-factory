import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RuntimeLedger } from "./runtime-ledger.mjs";
import { RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE } from "./researchbrain-loop-runner.mjs";
import { RESEARCHBRAIN_STAGE0_JOB_FINISHED_EVENT } from "./researchbrain-stage0-outbox-consumer.mjs";

export const RESEARCHBRAIN_STAGE0_DIAGNOSTICS_SCHEMA_VERSION = "researchbrain_stage0_diagnostics_v1";

function nowIso() {
  return new Date().toISOString();
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function jsonObjectFromText(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolveRepoRelativePath(rootDir, repoPath, label = "path") {
  if (typeof repoPath !== "string" || repoPath.trim().length === 0 || path.isAbsolute(repoPath)) {
    throw new Error(`ResearchBrain diagnostics ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain diagnostics ${label} escapes repository root: ${repoPath}`);
  }
  return fullPath;
}

function emptyJobSummary() {
  return {
    total: 0,
    queued: 0,
    ready: 0,
    claimed: 0,
    stale_claimed: 0,
    claimed_without_lease: 0,
    claimable_stale_or_ready: 0,
    blocked: 0,
    poisoned: 0,
    stage0_ready: 0,
    other: 0
  };
}

function summarizeJobs(ledger, { jobType, generatedAt, staleLimit }) {
  const rows = ledger.db.prepare(`
    SELECT jobs.job_id, jobs.run_id, jobs.job_type, jobs.status, jobs.priority, jobs.created_at, jobs.updated_at,
           leases.owner_id, leases.fencing_token, leases.claimed_at, leases.heartbeat_at, leases.expires_at, leases.status AS lease_status
    FROM jobs
    LEFT JOIN leases ON leases.job_id = jobs.job_id
    WHERE jobs.job_type = ?
    ORDER BY jobs.priority DESC, jobs.created_at ASC, jobs.job_id ASC
  `).all(jobType);
  const summary = emptyJobSummary();
  const stale = [];
  for (const row of rows) {
    summary.total += 1;
    if (Object.hasOwn(summary, row.status)) summary[row.status] += 1;
    else summary.other += 1;
    const staleClaim = row.status === "claimed" && row.lease_status === "active" && row.expires_at <= generatedAt;
    const claimableReady = (row.status === "queued" || row.status === "ready") && (!row.lease_status || row.expires_at <= generatedAt);
    if (row.status === "claimed" && !row.lease_status) summary.claimed_without_lease += 1;
    if (staleClaim) {
      summary.stale_claimed += 1;
      if (stale.length < staleLimit) {
        stale.push({
          job_id: row.job_id,
          run_id: row.run_id,
          status: row.status,
          owner_id: row.owner_id,
          fencing_token: row.fencing_token,
          heartbeat_at: row.heartbeat_at,
          expires_at: row.expires_at
        });
      }
    }
    if (staleClaim || claimableReady) summary.claimable_stale_or_ready += 1;
  }
  return { summary, stale_claims: stale };
}

function summarizeOutbox(ledger, { eventType }) {
  const rows = ledger.db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM outbox
    WHERE event_type = ?
    GROUP BY status
  `).all(eventType);
  const byStatus = { pending: 0, processed: 0, other: 0, total: 0 };
  for (const row of rows) {
    const count = Number(row.count ?? 0);
    byStatus.total += count;
    if (Object.hasOwn(byStatus, row.status)) byStatus[row.status] += count;
    else byStatus.other += count;
  }
  const latestPending = ledger.db.prepare(`
    SELECT event_id, aggregate_id, event_type, created_at, payload_json
    FROM outbox
    WHERE event_type = ? AND status = 'pending'
    ORDER BY created_at ASC, event_id ASC
    LIMIT 10
  `).all(eventType).map((event) => ({
    event_id: event.event_id,
    aggregate_id: event.aggregate_id,
    created_at: event.created_at,
    payload: jsonObjectFromText(event.payload_json)
  }));
  return { by_status: byStatus, oldest_pending: latestPending };
}

function compactFailureSummary(attemptPayload) {
  const summary = attemptPayload?.failure_summary ?? null;
  if (summary && typeof summary === "object" && !Array.isArray(summary)) return summary;
  const failure = attemptPayload?.failure ?? null;
  if (failure && typeof failure === "object" && !Array.isArray(failure)) {
    return {
      failure_class: failure.failure_class ?? null,
      retryable: failure.retryable ?? null,
      error_message: failure.error_message ?? null,
      final_terminal_state: attemptPayload?.final_terminal_state ?? null,
      request_artifact: attemptPayload?.verified_request_artifact ?? null,
      runtime_result_artifact: attemptPayload?.result_artifact ?? null,
      quarantine_paths: attemptPayload?.quarantine_paths ?? [],
      blockers: attemptPayload?.blockers ?? []
    };
  }
  if (attemptPayload?.final_terminal_state === "poison_candidate_or_run") {
    return {
      failure_class: "poison_candidate_or_run",
      retryable: false,
      error_message: null,
      final_terminal_state: attemptPayload.final_terminal_state,
      request_artifact: attemptPayload?.verified_request_artifact ?? null,
      runtime_result_artifact: attemptPayload?.result_artifact ?? null,
      quarantine_paths: attemptPayload?.quarantine_paths ?? [],
      blockers: attemptPayload?.blockers ?? []
    };
  }
  return null;
}

function summarizeAttempts(ledger, { jobType, failureLimit }) {
  const rows = ledger.db.prepare(`
    SELECT job_attempts.status, COUNT(*) AS count
    FROM job_attempts
    JOIN jobs ON jobs.job_id = job_attempts.job_id
    WHERE jobs.job_type = ?
    GROUP BY job_attempts.status
  `).all(jobType);
  const byStatus = { total: 0 };
  for (const row of rows) {
    const count = Number(row.count ?? 0);
    byStatus.total += count;
    byStatus[row.status] = count;
  }
  const latest = ledger.db.prepare(`
    SELECT job_attempts.attempt_id, job_attempts.job_id, jobs.run_id, job_attempts.attempt_number,
           job_attempts.status, job_attempts.worker, job_attempts.started_at, job_attempts.finished_at
    FROM job_attempts
    JOIN jobs ON jobs.job_id = job_attempts.job_id
    WHERE jobs.job_type = ?
    ORDER BY COALESCE(job_attempts.finished_at, job_attempts.started_at) DESC, job_attempts.attempt_id DESC
    LIMIT 10
  `).all(jobType);
  const failures = ledger.db.prepare(`
    SELECT job_attempts.attempt_id, job_attempts.job_id, jobs.run_id, job_attempts.attempt_number,
           job_attempts.status, job_attempts.worker, job_attempts.started_at, job_attempts.finished_at,
           job_attempts.payload_json
    FROM job_attempts
    JOIN jobs ON jobs.job_id = job_attempts.job_id
    WHERE jobs.job_type = ? AND job_attempts.status IN ('blocked', 'poisoned')
    ORDER BY COALESCE(job_attempts.finished_at, job_attempts.started_at) DESC, job_attempts.attempt_id DESC
    LIMIT ?
  `).all(jobType, failureLimit).map((attempt) => {
    const payload = jsonObjectFromText(attempt.payload_json);
    return {
      attempt_id: attempt.attempt_id,
      job_id: attempt.job_id,
      run_id: attempt.run_id,
      attempt_number: attempt.attempt_number,
      status: attempt.status,
      worker: attempt.worker,
      started_at: attempt.started_at,
      finished_at: attempt.finished_at,
      failure_summary: compactFailureSummary(payload)
    };
  });
  return { by_status: byStatus, latest, latest_failures: failures };
}

function summarizeProjections(rootDir, { outputDir, limit }) {
  const fullDir = resolveRepoRelativePath(rootDir, outputDir, "projection_output_dir");
  if (!fs.existsSync(fullDir)) return { output_dir: outputDir, total_files: 0, latest: [] };
  const entries = fs.readdirSync(fullDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const fullPath = path.join(fullDir, entry.name);
      const stat = fs.statSync(fullPath);
      let parsed = {};
      try {
        parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      } catch {
        parsed = { parse_error: true };
      }
      return {
        path: repoRelative(rootDir, fullPath),
        sha256: sha256File(fullPath),
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        event_id: parsed?.event?.event_id ?? null,
        projected_status: parsed?.event?.payload?.status ?? parsed?.run?.status ?? null,
        run_id: parsed?.run?.run_id ?? parsed?.event?.aggregate_id ?? null,
        job_id: parsed?.job?.job_id ?? parsed?.event?.payload?.job_id ?? null,
        attempt_id: parsed?.attempt?.attempt_id ?? parsed?.event?.payload?.attempt_id ?? null,
        parse_error: parsed?.parse_error === true
      };
    })
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at) || b.path.localeCompare(a.path));
  return { output_dir: outputDir, total_files: entries.length, latest: entries.slice(0, limit) };
}

function diagnosticsAttentionReasons({ jobs, outbox }) {
  const reasons = [];
  if (jobs.stale_claimed > 0) reasons.push("stale_claimed_jobs");
  if (jobs.claimable_stale_or_ready > 0) reasons.push("claimable_stage0_jobs");
  if (jobs.blocked > 0) reasons.push("blocked_jobs");
  if (jobs.poisoned > 0) reasons.push("poisoned_jobs");
  if (outbox.by_status.pending > 0) reasons.push("pending_outbox_events");
  return reasons;
}

export function buildResearchBrainStage0Diagnostics({
  rootDir = process.cwd(),
  dbPath = null,
  jobType = RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE,
  eventType = RESEARCHBRAIN_STAGE0_JOB_FINISHED_EVENT,
  projectionDir = "factory/runtime/projections/researchbrain-stage0",
  projectionLimit = 5,
  staleLimit = 10,
  failureLimit = 10
} = {}) {
  if (!Number.isInteger(projectionLimit) || projectionLimit < 0 || projectionLimit > 50) throw new Error("ResearchBrain diagnostics projectionLimit must be an integer from 0 to 50.");
  if (!Number.isInteger(staleLimit) || staleLimit < 0 || staleLimit > 100) throw new Error("ResearchBrain diagnostics staleLimit must be an integer from 0 to 100.");
  if (!Number.isInteger(failureLimit) || failureLimit < 0 || failureLimit > 100) throw new Error("ResearchBrain diagnostics failureLimit must be an integer from 0 to 100.");
  const root = path.resolve(rootDir);
  resolveRepoRelativePath(root, projectionDir, "projection_dir");
  const ledger = new RuntimeLedger({ rootDir: root, dbPath });
  const generatedAt = nowIso();
  try {
    const ledgerDiagnostics = ledger.migrate();
    const jobs = summarizeJobs(ledger, { jobType, generatedAt, staleLimit });
    const outbox = summarizeOutbox(ledger, { eventType });
    const attentionReasons = diagnosticsAttentionReasons({ jobs: jobs.summary, outbox });
    return {
      schema_version: RESEARCHBRAIN_STAGE0_DIAGNOSTICS_SCHEMA_VERSION,
      generated_at: generatedAt,
      job_type: jobType,
      event_type: eventType,
      status: attentionReasons.length > 0 ? "attention" : "ok",
      attention_reasons: attentionReasons,
      ledger: ledgerDiagnostics,
      jobs: jobs.summary,
      stale_claims: jobs.stale_claims,
      attempts: summarizeAttempts(ledger, { jobType, failureLimit }),
      outbox,
      projections: summarizeProjections(root, { outputDir: projectionDir, limit: projectionLimit }),
      official_state_mutated: false,
      official_evidence_index_mutated: false,
      official_backlog_mutated: false,
      official_leaderboard_mutated: false,
      profitability_labels_created: false,
      deterministic_workers_bypassed: false,
      wfa_executed: false,
      mt5_executed: false,
      phase8e_started: false
    };
  } finally {
    ledger.close();
  }
}

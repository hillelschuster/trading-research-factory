import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RuntimeLedger } from "./runtime-ledger.mjs";
import { createFixtureResearchBrainProvider, runResearchBrainStage0Runtime } from "./researchbrain-runtime.mjs";
import { classifyRetryFailure } from "./retry-policy.mjs";

export const RESEARCHBRAIN_STAGE0_LOOP_RESULT_SCHEMA_VERSION = "researchbrain_stage0_loop_result_v1";
export const RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE = "researchbrain_stage0";

function nowIso() {
  return new Date().toISOString();
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function schemaError(message) {
  const error = new Error(message);
  error.rf_retryable = false;
  error.rf_failure_class = "schema_or_validation_failure";
  return error;
}

function jsonObjectFromText(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function statusFromRuntimeResult(result) {
  if (result?.status === "ready") return "stage0_ready";
  if (result?.final_terminal_state === "poison_candidate_or_run") return "poisoned";
  if (result?.status === "blocked") return "blocked";
  return "blocked";
}

function statusFromFailureClassification(classification) {
  return classification?.failure_class === "poison_candidate_or_run" ? "poisoned" : "blocked";
}

function requestArtifactFromPayload(payload) {
  const requestPath = payload.request_path ?? payload.requestPath ?? null;
  const requestSha256 = payload.request_sha256 ?? payload.requestSha256 ?? null;
  if (!requestPath && !requestSha256) return null;
  return { path: requestPath, sha256: requestSha256 };
}

function compactFailureSummary({ payload, classification = null, result = null, verifiedRequestArtifact = null }) {
  const blockers = asArray(result?.blockers).filter((blocker) => typeof blocker === "string" && blocker.trim().length > 0).slice(0, 10);
  const failureClass = classification?.failure_class
    ?? (result?.final_terminal_state === "poison_candidate_or_run" ? "poison_candidate_or_run" : null)
    ?? (result?.status === "blocked" ? "schema_or_validation_failure" : null);
  if (!failureClass && blockers.length === 0 && result?.status !== "blocked") return null;
  return {
    failure_class: failureClass,
    retryable: classification?.retryable ?? false,
    error_message: classification?.error_message ?? blockers[0] ?? null,
    final_terminal_state: result?.final_terminal_state ?? null,
    request_artifact: verifiedRequestArtifact ?? requestArtifactFromPayload(payload),
    runtime_result_artifact: result?.result_artifact ?? null,
    quarantine_paths: asArray(result?.quarantine_paths).slice(0, 10),
    blockers
  };
}

function stableArtifactId({ runId, jobId, attemptId, artifact }) {
  return `ART-RB-${sha256Text(JSON.stringify([
    runId,
    jobId,
    attemptId,
    artifact?.artifact_type ?? "artifact",
    artifact?.path ?? "missing-path",
    artifact?.sha256 ?? null
  ])).slice(0, 32)}`;
}

function uniqueArtifacts(result) {
  const seen = new Set();
  const artifacts = [
    ...asArray(result?.artifacts_created),
    ...(result?.result_artifact ? [{ artifact_type: "researchbrain_stage0_runtime_result", ...result.result_artifact }] : []),
    ...asArray(result?.quarantine_paths).map((artifact) => ({ artifact_type: "researchbrain_stage0_quarantine", ...artifact }))
  ];
  return artifacts.filter((artifact) => {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string") return false;
    const key = `${artifact.artifact_type ?? "artifact"}:${artifact.path}:${artifact.sha256 ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveProvider({ payload, providerFactory, context }) {
  if (typeof providerFactory === "function") return providerFactory({ payload, ...context });
  return createFixtureResearchBrainProvider({ mode: payload.provider_mode ?? "valid" });
}

function requireRequestPath(payload, jobId) {
  const requestPath = payload.request_path ?? payload.requestPath;
  if (typeof requestPath !== "string" || requestPath.trim().length === 0) {
    throw schemaError(`ResearchBrain loop job ${jobId} requires payload.request_path`);
  }
  if (path.isAbsolute(requestPath)) {
    throw schemaError(`ResearchBrain loop job ${jobId} request_path must be repo-relative`);
  }
  return requestPath;
}

function verifyRequestHashIfPresent({ rootDir, requestPath, payload, jobId }) {
  if (payload.request_sha256 === undefined && payload.requestSha256 === undefined) return null;
  const expectedSha = String(payload.request_sha256 ?? payload.requestSha256 ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    throw schemaError(`ResearchBrain loop job ${jobId} payload.request_sha256 must be a valid SHA-256`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, requestPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw schemaError(`ResearchBrain loop job ${jobId} request_path escapes repository root: ${requestPath}`);
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw schemaError(`ResearchBrain loop job ${jobId} request_path is missing on disk: ${requestPath}`);
  }
  const actualSha = sha256File(fullPath);
  if (actualSha !== expectedSha) {
    throw schemaError(`ResearchBrain loop job ${jobId} payload.request_sha256 does not match ${requestPath}`);
  }
  return { path: requestPath, sha256: actualSha };
}

function nextAttemptNumber(ledger, jobId) {
  const row = ledger.db.prepare("SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number FROM job_attempts WHERE job_id = ?").get(jobId);
  return row?.next_attempt_number ?? 1;
}

function recordArtifacts(ledger, { runId, jobId, attemptId, artifacts }) {
  for (const artifact of artifacts) {
    ledger.insertArtifact({
      artifact_id: stableArtifactId({ runId, jobId, attemptId, artifact }),
      run_id: runId,
      job_id: jobId,
      attempt_id: attemptId,
      artifact_type: artifact.artifact_type ?? "researchbrain_stage0_artifact",
      path: artifact.path,
      sha256: artifact.sha256 ?? null,
      size_bytes: artifact.size_bytes ?? null,
      payload: { ...artifact, mirror_source: "researchbrain_stage0_loop_runner" }
    });
  }
}

async function runClaimedJob({ ledger, rootDir, claim, ownerId, leaseMs, runtimeDefaults, providerFactory }) {
  const job = claim.job;
  const lease = claim.lease;
  const claimMetadata = claim.claim ?? { reclaimed_stale_lease: false, new_fencing_token: lease?.fencing_token ?? null };
  const payload = jsonObjectFromText(job.payload_json);
  const runId = payload.run_id ?? job.run_id ?? `RUN-RESEARCHBRAIN-STAGE0-${sha256Text(job.job_id).slice(0, 12)}`;
  const ledgerRunId = job.run_id ?? runId;
  const attemptNumber = nextAttemptNumber(ledger, job.job_id);
  const attemptId = payload.attempt_id ?? `${job.job_id}-ATTEMPT-${attemptNumber}`;
  const startedAt = nowIso();
  const runtimeContext = { job, lease, runId, attemptId, attemptNumber };

  try {
    const requestPath = requireRequestPath(payload, job.job_id);
    const verifiedRequestArtifact = verifyRequestHashIfPresent({ rootDir, requestPath, payload, jobId: job.job_id });
    const outputDir = payload.output_dir ?? `factory/research/runs/${runId}`;
    const provider = resolveProvider({ payload, providerFactory, context: runtimeContext });
    ledger.recordHeartbeat({ job_id: job.job_id, owner_id: ownerId, fencing_token: lease.fencing_token, lease_ms: leaseMs });
    const result = await runResearchBrainStage0Runtime({
      rootDir,
      requestPath,
      outputDir,
      runId,
      observedAt: payload.observed_at,
      provider,
      maxAttempts: payload.max_attempts ?? runtimeDefaults.maxAttempts,
      maxProviderCalls: payload.max_provider_calls ?? runtimeDefaults.maxProviderCalls,
      timeoutMs: payload.timeout_ms ?? runtimeDefaults.timeoutMs,
      maxOutputBytes: payload.max_output_bytes ?? runtimeDefaults.maxOutputBytes,
      retryDelayMs: payload.retry_delay_ms ?? runtimeDefaults.retryDelayMs,
      allowOutputOverwrite: payload.allow_output_overwrite === true
    });
    const finishedAt = nowIso();
    const finalStatus = statusFromRuntimeResult(result);
    const failureSummary = compactFailureSummary({ payload, result, verifiedRequestArtifact });
    ledger.insertJobAttempt({
      attempt_id: attemptId,
      job_id: job.job_id,
      attempt_number: attemptNumber,
      status: finalStatus,
      worker: "researchbrain_stage0_loop_runner",
      started_at: startedAt,
      finished_at: finishedAt,
      payload: {
        runtime_status: result.status,
        runtime_run_id: result.run_id,
        claim: claimMetadata,
        verified_request_artifact: verifiedRequestArtifact,
        final_terminal_state: result.final_terminal_state ?? null,
        failure_summary: failureSummary,
        result_artifact: result.result_artifact ?? null,
        quarantine_paths: result.quarantine_paths ?? [],
        blockers: result.blockers ?? [],
        official_state_mutated: result.official_state_mutated,
        official_evidence_index_mutated: result.official_evidence_index_mutated,
        official_backlog_mutated: result.official_backlog_mutated,
        official_leaderboard_mutated: result.official_leaderboard_mutated,
        wfa_executed: result.wfa_executed,
        mt5_executed: result.mt5_executed
      }
    });
    const artifacts = uniqueArtifacts(result);
    recordArtifacts(ledger, { runId: ledgerRunId, jobId: job.job_id, attemptId, artifacts });
    ledger.finalizeJob({ job_id: job.job_id, owner_id: ownerId, fencing_token: lease.fencing_token, status: finalStatus, now: finishedAt });
    if (job.run_id) {
      ledger.recordRunStatusWithOutbox({
        run_id: job.run_id,
        status: finalStatus,
        event_id: `EVT-RB-STAGE0-${sha256Text(`${job.run_id}:${job.job_id}:${attemptId}:${finalStatus}`).slice(0, 32)}`,
        event_type: "researchbrain.stage0_job_finished",
        payload: { job_id: job.job_id, attempt_id: attemptId, runtime_run_id: result.run_id, status: finalStatus, failure_summary: failureSummary }
      });
    }
    return {
      job_id: job.job_id,
      run_id: runId,
      ledger_run_id: ledgerRunId,
      attempt_id: attemptId,
      status: finalStatus,
      runtime_status: result.status,
      result_artifact: result.result_artifact ?? null,
      quarantine_paths: result.quarantine_paths ?? [],
      artifacts_recorded: artifacts.length,
      claim: claimMetadata,
      blockers: result.blockers ?? [],
      failure_summary: failureSummary
    };
  } catch (error) {
    const finishedAt = nowIso();
    const classification = classifyRetryFailure(error, { phase: "researchbrain_stage0_loop_job" });
    const finalStatus = statusFromFailureClassification(classification);
    const failureSummary = compactFailureSummary({ payload, classification });
    ledger.insertJobAttempt({
      attempt_id: attemptId,
      job_id: job.job_id,
      attempt_number: attemptNumber,
      status: finalStatus,
      worker: "researchbrain_stage0_loop_runner",
      started_at: startedAt,
      finished_at: finishedAt,
      payload: { failure: classification, claim: claimMetadata, failure_summary: failureSummary }
    });
    ledger.finalizeJob({ job_id: job.job_id, owner_id: ownerId, fencing_token: lease.fencing_token, status: finalStatus, now: finishedAt });
    if (job.run_id) {
      ledger.recordRunStatusWithOutbox({
        run_id: job.run_id,
        status: finalStatus,
        event_id: `EVT-RB-STAGE0-${sha256Text(`${job.run_id}:${job.job_id}:${attemptId}:${finalStatus}`).slice(0, 32)}`,
        event_type: "researchbrain.stage0_job_finished",
        payload: { job_id: job.job_id, attempt_id: attemptId, status: finalStatus, failure: classification, failure_summary: failureSummary }
      });
    }
    return {
      job_id: job.job_id,
      run_id: runId,
      ledger_run_id: ledgerRunId,
      attempt_id: attemptId,
      status: finalStatus,
      runtime_status: "blocked",
      result_artifact: null,
      quarantine_paths: [],
      artifacts_recorded: 0,
      claim: claimMetadata,
      blockers: [classification.error_message],
      failure_class: classification.failure_class,
      retryable: classification.retryable,
      failure_summary: failureSummary
    };
  }
}

export async function runResearchBrainStage0Loop({
  rootDir = process.cwd(),
  dbPath = null,
  ownerId = `researchbrain-stage0-loop-${process.pid}`,
  jobType = RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE,
  maxJobs = 1,
  leaseMs = 60_000,
  providerFactory = null,
  runtimeDefaults = {}
} = {}) {
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100) throw new Error("ResearchBrain loop maxJobs must be an integer from 1 to 100.");
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) throw new Error("ResearchBrain loop leaseMs must be an integer from 1000 to 3600000.");
  const root = path.resolve(rootDir);
  const ledger = new RuntimeLedger({ rootDir: root, dbPath });
  const jobs = [];
  let stopReason = "max_jobs_reached";
  try {
    ledger.migrate();
    for (let index = 0; index < maxJobs; index += 1) {
      const claim = ledger.claimNextJob({ owner_id: ownerId, job_type: jobType, lease_ms: leaseMs });
      if (!claim) {
        stopReason = index === 0 ? "no_claimable_job" : "queue_drained";
        break;
      }
      jobs.push(await runClaimedJob({
        ledger,
        rootDir: root,
        claim,
        ownerId,
        leaseMs,
        providerFactory,
        runtimeDefaults: {
          maxAttempts: 2,
          maxProviderCalls: 2,
          timeoutMs: 30_000,
          maxOutputBytes: 256_000,
          retryDelayMs: 0,
          ...runtimeDefaults
        }
      }));
    }
    return {
      schema_version: RESEARCHBRAIN_STAGE0_LOOP_RESULT_SCHEMA_VERSION,
      generated_at: nowIso(),
      owner_id: ownerId,
      job_type: jobType,
      status: jobs.some((job) => job.status === "stage0_ready") ? "processed" : (jobs.length > 0 ? "blocked_or_empty" : "empty"),
      stop_reason: stopReason,
      max_jobs: maxJobs,
      jobs_processed: jobs.length,
      lease_reclaims: jobs.filter((job) => job.claim?.reclaimed_stale_lease === true).length,
      jobs,
      official_state_mutated: false,
      official_evidence_index_mutated: false,
      official_backlog_mutated: false,
      official_leaderboard_mutated: false,
      profitability_labels_created: false,
      deterministic_workers_bypassed: false,
      wfa_executed: false,
      mt5_executed: false
    };
  } finally {
    ledger.close();
  }
}

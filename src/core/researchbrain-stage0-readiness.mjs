import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";
import { RuntimeLedger } from "./runtime-ledger.mjs";
import { validateResearchBrainRequest } from "./researchbrain-artifacts.mjs";
import { RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE } from "./researchbrain-loop-runner.mjs";
import { buildResearchBrainStage0Diagnostics } from "./researchbrain-stage0-diagnostics.mjs";

export const RESEARCHBRAIN_STAGE0_READINESS_SCHEMA_VERSION = "researchbrain_stage0_ops_readiness_report_v1";
const EXPECTED_STAGE0_OUTBOX_PROJECTION_SCHEMA_VERSION = "researchbrain_stage0_outbox_projection_v1";
const PROJECTION_MTIME_GRACE_MS = 2000;

function nowIso() {
  return new Date().toISOString();
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoPath, label = "path") {
  if (typeof repoPath !== "string" || repoPath.trim().length === 0 || path.isAbsolute(repoPath)) {
    throw new Error(`ResearchBrain Stage-0 readiness ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain Stage-0 readiness ${label} escapes repository root: ${repoPath}`);
  }
  return fullPath;
}

function jsonObjectFromText(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isoMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function listJsonFiles(rootDir, repoDir, limit) {
  const fullDir = resolveRepoRelativePath(rootDir, repoDir, "request_dir");
  if (!fs.existsSync(fullDir)) return [];
  const files = [];
  const stack = [fullDir];
  while (stack.length > 0 && files.length < limit) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
      if (files.length >= limit) break;
    }
  }
  return files.sort((a, b) => repoRelative(rootDir, a).localeCompare(repoRelative(rootDir, b)));
}

function listProjectionFiles(rootDir, projectionDir) {
  const fullDir = resolveRepoRelativePath(rootDir, projectionDir, "projection_dir");
  if (!fs.existsSync(fullDir)) return [];
  return fs.readdirSync(fullDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const fullPath = path.join(fullDir, entry.name);
      const stat = fs.statSync(fullPath);
      let eventId = null;
      let parseError = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        eventId = parsed?.event?.event_id ?? null;
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
      return {
        path: repoRelative(rootDir, fullPath),
        sha256: sha256File(fullPath),
        modified_at: stat.mtime.toISOString(),
        event_id: eventId,
        parse_error: parseError
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function summarizeSeededJobs({ rootDir, dbPath }) {
  const ledger = new RuntimeLedger({ rootDir, dbPath });
  try {
    ledger.migrate();
    const rows = ledger.db.prepare(`
      SELECT job_id, run_id, status, priority, created_at, updated_at, payload_json
      FROM jobs
      WHERE job_type = ?
      ORDER BY created_at ASC, job_id ASC
    `).all(RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE);
    const bySha = new Map();
    const byPath = new Map();
    const jobs = rows.map((row) => {
      const payload = jsonObjectFromText(row.payload_json);
      const requestSha256 = payload.request_sha256 ?? null;
      const requestPath = payload.request_path ?? null;
      const outputDir = payload.output_dir ?? null;
      const job = {
        job_id: row.job_id,
        run_id: row.run_id,
        status: row.status,
        priority: row.priority,
        created_at: row.created_at,
        updated_at: row.updated_at,
        request_artifact: {
          path: requestPath,
          sha256: requestSha256
        },
        output_dir: outputDir,
        output_collision: inspectSeededJobOutputDir({ rootDir, outputDir, expectedRunId: row.run_id })
      };
      if (requestSha256) bySha.set(requestSha256, job);
      if (requestPath) byPath.set(requestPath, job);
      return job;
    });
    return { total: jobs.length, jobs, bySha, byPath };
  } finally {
    ledger.close();
  }
}

function summarizeRequests({ rootDir, requestDir, requestLimit, seededBySha, seededByPath }) {
  const files = listJsonFiles(rootDir, requestDir, requestLimit);
  const entries = files.map((fullPath) => {
    const relative = repoRelative(rootDir, fullPath);
    const sha256 = sha256File(fullPath);
    let requestId = null;
    let valid = false;
    let validationError = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      requestId = parsed?.request_id ?? null;
      validateResearchBrainRequest(parsed, { rootDir, requireExisting: true });
      valid = true;
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
    const seededByArtifactSha = seededBySha.get(sha256) ?? null;
    const seededByArtifactPath = seededByPath.get(relative) ?? null;
    const seededJob = seededByArtifactSha ?? seededByArtifactPath ?? null;
    const seededPathShaMismatch = Boolean(seededByArtifactPath && !seededByArtifactSha && seededByArtifactPath.request_artifact?.sha256 !== sha256);
    return {
      path: relative,
      sha256,
      request_id: requestId,
      valid,
      seeded: Boolean(seededJob),
      seeded_by_sha256: Boolean(seededByArtifactSha),
      seeded_by_path: Boolean(seededByArtifactPath),
      seeded_path_sha_mismatch: seededPathShaMismatch,
      seeded_job: seededJob ? { job_id: seededJob.job_id, run_id: seededJob.run_id, status: seededJob.status, output_dir: seededJob.output_dir, output_collision: seededJob.output_collision } : null,
      validation_error: validationError
    };
  });
  const seededInvalid = entries.filter((entry) => !entry.valid && entry.seeded).length;
  const unseededInvalid = entries.filter((entry) => !entry.valid && !entry.seeded).length;
  const changedSeededSha = entries.filter((entry) => entry.seeded_path_sha_mismatch).length;
  return {
    request_dir: requestDir,
    scanned: entries.length,
    limit: requestLimit,
    truncated: files.length >= requestLimit,
    valid: entries.filter((entry) => entry.valid).length,
    invalid: entries.filter((entry) => !entry.valid).length,
    seeded_invalid: seededInvalid,
    unseeded_invalid: unseededInvalid,
    seeded: entries.filter((entry) => entry.seeded).length,
    changed_seeded_sha: changedSeededSha,
    seeded_output_collisions: entries.filter((entry) => entry.seeded_job?.output_collision?.status === "attention").length,
    unseeded_valid: entries.filter((entry) => entry.valid && !entry.seeded).length,
    entries
  };
}

function readJsonFileIfPresent(fullPath) {
  if (!fs.existsSync(fullPath)) return null;
  if (!fs.statSync(fullPath).isFile()) return { parse_error: "not_a_file" };
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return { parse_error: error instanceof Error ? error.message : String(error) };
  }
}

function inspectRunIdentityFile({ rootDir, outputDir, relativePath, expectedRunId }) {
  const fullPath = path.join(outputDir, relativePath);
  const parsed = readJsonFileIfPresent(fullPath);
  if (!parsed) return null;
  const file = repoRelative(rootDir, fullPath);
  if (parsed.parse_error) return { file, reason: "output_identity_parse_error", message: parsed.parse_error };
  const actualRunId = parsed.run_id ?? parsed.research_run_id ?? null;
  if (actualRunId && actualRunId !== expectedRunId) return { file, reason: "output_run_id_collision", expected_run_id: expectedRunId, actual_run_id: actualRunId };
  return null;
}

function inspectSeededJobOutputDir({ rootDir, outputDir, expectedRunId }) {
  if (typeof outputDir !== "string" || outputDir.trim().length === 0) return null;
  let fullDir;
  try {
    fullDir = resolveRepoRelativePath(rootDir, outputDir, "seeded_job_output_dir");
  } catch (error) {
    return { status: "attention", reason: "output_dir_invalid", output_dir: outputDir, message: error instanceof Error ? error.message : String(error) };
  }
  if (!fs.existsSync(fullDir)) return { status: "ok", output_dir: outputDir, existing: false, issues: [] };
  if (!fs.statSync(fullDir).isDirectory()) return { status: "attention", reason: "output_dir_not_directory", output_dir: outputDir, issues: [] };
  const issues = [
    inspectRunIdentityFile({ rootDir, outputDir: fullDir, relativePath: "runtime-result.json", expectedRunId }),
    inspectRunIdentityFile({ rootDir, outputDir: fullDir, relativePath: "manifest/manifest.json", expectedRunId })
  ].filter(Boolean);
  return { status: issues.length > 0 ? "attention" : "ok", output_dir: outputDir, existing: true, issues };
}

function addArtifactRef(refs, ref, label) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref) || typeof ref.path !== "string") return;
  refs.push({ label, ref });
}

function collectProjectionArtifactRefs(projection) {
  const refs = [];
  addArtifactRef(refs, projection?.failure_summary?.request_artifact, "failure_summary.request_artifact");
  addArtifactRef(refs, projection?.failure_summary?.runtime_result_artifact, "failure_summary.runtime_result_artifact");
  addArtifactRef(refs, projection?.event?.payload?.failure_summary?.request_artifact, "event.payload.failure_summary.request_artifact");
  addArtifactRef(refs, projection?.event?.payload?.failure_summary?.runtime_result_artifact, "event.payload.failure_summary.runtime_result_artifact");
  for (const [index, artifact] of (Array.isArray(projection?.artifacts) ? projection.artifacts : []).entries()) {
    addArtifactRef(refs, artifact, `artifacts[${index}]`);
  }
  const seen = new Set();
  return refs.filter(({ label, ref }) => {
    const key = `${label}:${ref.path}:${ref.sha256 ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectProjectionRequestRefs(projection) {
  return collectProjectionArtifactRefs(projection)
    .filter(({ label, ref }) => label.endsWith("request_artifact") || ref.artifact_type === "researchbrain_stage0_request")
    .map(({ label, ref }) => ({ label, ref }));
}

function artifactIssue({ rootDir, label, ref }) {
  let fullPath;
  try {
    fullPath = resolveRepoRelativePath(rootDir, ref.path, label);
  } catch (error) {
    return { label, reason: "artifact_path_invalid", path: ref.path, message: error instanceof Error ? error.message : String(error) };
  }
  if (!fs.existsSync(fullPath)) return { label, reason: "artifact_missing", path: ref.path, expected_sha256: ref.sha256 ?? null };
  if (!fs.statSync(fullPath).isFile()) return { label, reason: "artifact_not_file", path: ref.path, expected_sha256: ref.sha256 ?? null };
  if (typeof ref.sha256 === "string" && ref.sha256.length > 0) {
    const actualSha256 = sha256File(fullPath);
    if (actualSha256 !== ref.sha256) return { label, reason: "artifact_sha_mismatch", path: ref.path, expected_sha256: ref.sha256, actual_sha256: actualSha256 };
  }
  return null;
}

function artifactRefsMatch(left, right) {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftPath = typeof left.path === "string" ? left.path : null;
  const rightPath = typeof right.path === "string" ? right.path : null;
  const leftSha = typeof left.sha256 === "string" && left.sha256.length > 0 ? left.sha256 : null;
  const rightSha = typeof right.sha256 === "string" && right.sha256.length > 0 ? right.sha256 : null;
  if (leftPath && rightPath && leftPath !== rightPath) return false;
  if (leftSha && rightSha && leftSha !== rightSha) return false;
  return Boolean((leftPath && rightPath) || (leftSha && rightSha));
}

function validateRuntimeResultRequestRef({ rootDir, label, ref, expectedRequestRefs = [] }) {
  if (ref?.artifact_type !== "researchbrain_stage0_runtime_result") return [];
  let fullPath;
  try {
    fullPath = resolveRepoRelativePath(rootDir, ref.path, label);
  } catch {
    return [];
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const requestRef = parsed?.request_ref;
    if (!requestRef || typeof requestRef !== "object" || Array.isArray(requestRef)) return [];
    const issue = artifactIssue({ rootDir, label: `${label}.request_ref`, ref: requestRef });
    const issues = issue ? [issue] : [];
    if (expectedRequestRefs.length > 0 && !expectedRequestRefs.some((expected) => artifactRefsMatch(requestRef, expected.ref))) {
      issues.push({
        label,
        reason: "runtime_result_request_ref_mismatch",
        path: ref.path,
        runtime_request_ref: { path: requestRef.path ?? null, sha256: requestRef.sha256 ?? null },
        expected_request_refs: expectedRequestRefs.map((expected) => ({ label: expected.label, path: expected.ref.path ?? null, sha256: expected.ref.sha256 ?? null }))
      });
    }
    return issues;
  } catch (error) {
    return [{ label, reason: "runtime_result_parse_error", path: ref.path, message: error instanceof Error ? error.message : String(error) }];
  }
}

function ledgerStatusIssues({ projection, runRow, jobRow, attemptRow }) {
  const issues = [];
  const projectedRun = projection?.run ?? null;
  const projectedJob = projection?.job ?? null;
  const projectedAttempt = projection?.attempt ?? null;
  const eventStatus = projection?.event?.payload?.status ?? null;
  if (runRow && projectedRun?.status && projectedRun.status !== runRow.status) {
    issues.push({ reason: "run_status_mismatch", run_id: runRow.run_id, projected_status: projectedRun.status, ledger_status: runRow.status });
  }
  if (jobRow && projectedJob?.status && projectedJob.status !== jobRow.status) {
    issues.push({ reason: "job_status_mismatch", job_id: jobRow.job_id, projected_status: projectedJob.status, ledger_status: jobRow.status });
  }
  if (attemptRow && projectedAttempt?.status && projectedAttempt.status !== attemptRow.status) {
    issues.push({ reason: "attempt_status_mismatch", attempt_id: attemptRow.attempt_id, projected_status: projectedAttempt.status, ledger_status: attemptRow.status });
  }
  if (eventStatus && runRow && eventStatus !== runRow.status) {
    issues.push({ reason: "event_run_status_mismatch", run_id: runRow.run_id, event_status: eventStatus, ledger_status: runRow.status });
  }
  if (runRow && jobRow && jobRow.run_id !== runRow.run_id) {
    issues.push({ reason: "job_run_id_mismatch", job_id: jobRow.job_id, job_run_id: jobRow.run_id, run_id: runRow.run_id });
  }
  if (jobRow && attemptRow && attemptRow.job_id !== jobRow.job_id) {
    issues.push({ reason: "attempt_job_id_mismatch", attempt_id: attemptRow.attempt_id, attempt_job_id: attemptRow.job_id, job_id: jobRow.job_id });
  }
  return issues;
}

function ledgerArtifactIssue({ ledger, label, ref, runId, jobId, attemptId }) {
  if (!ref?.artifact_type || ref.artifact_type === "researchbrain_stage0_request") return null;
  if (typeof ref.path !== "string" || ref.path.length === 0) return null;
  const rows = typeof ref.sha256 === "string" && ref.sha256.length > 0
    ? ledger.db.prepare("SELECT * FROM artifacts WHERE path = ? AND sha256 = ?").all(ref.path, ref.sha256)
    : ledger.db.prepare("SELECT * FROM artifacts WHERE path = ?").all(ref.path);
  if (rows.length === 0) {
    return { label, reason: "artifact_not_mirrored_in_runtime_ledger", path: ref.path, sha256: ref.sha256 ?? null, artifact_type: ref.artifact_type };
  }
  const typeMatch = rows.find((row) => row.artifact_type === ref.artifact_type);
  if (!typeMatch) {
    return { label, reason: "artifact_type_mismatch_in_runtime_ledger", path: ref.path, sha256: ref.sha256 ?? null, projected_artifact_type: ref.artifact_type, ledger_artifact_types: rows.map((row) => row.artifact_type) };
  }
  const identityIssues = [];
  if (runId && typeMatch.run_id && typeMatch.run_id !== runId) identityIssues.push({ field: "run_id", projected: runId, ledger: typeMatch.run_id });
  if (jobId && typeMatch.job_id && typeMatch.job_id !== jobId) identityIssues.push({ field: "job_id", projected: jobId, ledger: typeMatch.job_id });
  if (attemptId && typeMatch.attempt_id && typeMatch.attempt_id !== attemptId) identityIssues.push({ field: "attempt_id", projected: attemptId, ledger: typeMatch.attempt_id });
  if (identityIssues.length > 0) {
    return { label, reason: "artifact_identity_mismatch_in_runtime_ledger", path: ref.path, sha256: ref.sha256 ?? null, artifact_type: ref.artifact_type, identity_issues: identityIssues };
  }
  return null;
}

function inspectProjectionIntegrity({ rootDir, ledger, entry }) {
  const issues = [];
  const fullPath = resolveRepoRelativePath(rootDir, entry.path, "projection_path");
  let projection;
  try {
    projection = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return {
      path: entry.path,
      sha256: entry.sha256,
      ok: false,
      issues: [{ reason: "projection_parse_error", message: error instanceof Error ? error.message : String(error) }]
    };
  }
  const eventId = projection?.event?.event_id ?? null;
  const runId = projection?.run?.run_id ?? projection?.event?.aggregate_id ?? null;
  const jobId = projection?.job?.job_id ?? projection?.event?.payload?.job_id ?? null;
  const attemptId = projection?.attempt?.attempt_id ?? projection?.event?.payload?.attempt_id ?? null;
  const expectedRequestRefs = collectProjectionRequestRefs(projection);
  const runRow = runId ? ledger.getRun(runId) : null;
  const jobRow = jobId ? ledger.getJob(jobId) : null;
  const attemptRow = attemptId ? ledger.getJobAttempt(attemptId) : null;
  if (eventId && !ledger.getOutboxEvent(eventId)) issues.push({ reason: "missing_outbox_event", event_id: eventId });
  if (runId && !runRow) issues.push({ reason: "missing_run", run_id: runId });
  if (jobId && !jobRow) issues.push({ reason: "missing_job", job_id: jobId });
  if (attemptId && !attemptRow) issues.push({ reason: "missing_attempt", attempt_id: attemptId });
  issues.push(...ledgerStatusIssues({ projection, runRow, jobRow, attemptRow }));
  for (const { label, ref } of collectProjectionArtifactRefs(projection)) {
    const issue = artifactIssue({ rootDir, label, ref });
    if (issue) issues.push(issue);
    const ledgerIssue = ledgerArtifactIssue({ ledger, label, ref, runId, jobId, attemptId });
    if (ledgerIssue) issues.push(ledgerIssue);
    issues.push(...validateRuntimeResultRequestRef({ rootDir, label, ref, expectedRequestRefs }));
  }
  return {
    path: entry.path,
    sha256: entry.sha256,
    projection,
    event_id: eventId,
    run_id: runId,
    job_id: jobId,
    attempt_id: attemptId,
    ok: issues.length === 0,
    issues
  };
}

function projectionTerminalFailureSummary(projection) {
  const summary = projection?.failure_summary ?? projection?.event?.payload?.failure_summary ?? null;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const status = projection?.event?.payload?.status ?? projection?.run?.status ?? projection?.job?.status ?? null;
  if (!new Set(["blocked", "poisoned"]).has(status)) return null;
  return { status, summary };
}

function isExpectedTerminalRequestArtifactIssue({ issue, projection }) {
  if (!new Set(["artifact_sha_mismatch", "artifact_missing", "artifact_not_file"]).has(issue?.reason)) return false;
  const label = String(issue.label ?? "");
  if (!label.endsWith("request_artifact") && !label.endsWith("request_ref")) return false;
  const terminal = projectionTerminalFailureSummary(projection);
  if (!terminal) return false;
  if (terminal.status !== "blocked") return false;
  if (terminal.summary.retryable !== false) return false;
  if (terminal.summary.failure_class !== "schema_or_validation_failure") return false;
  const message = String(terminal.summary.error_message ?? terminal.summary.blockers?.[0] ?? "");
  return /request_sha256 does not match|request_path is missing on disk|request_path is missing|request_path escapes repository root/i.test(message);
}

function summarizeProjectionIntegrity({ rootDir, dbPath, latestProjections }) {
  const ledger = new RuntimeLedger({ rootDir, dbPath });
  try {
    ledger.migrate();
    const entries = latestProjections.map((entry) => {
      const inspected = inspectProjectionIntegrity({ rootDir, ledger, entry });
      const actionableIssues = [];
      const expectedTerminalIssues = [];
      for (const issue of inspected.issues ?? []) {
        if (isExpectedTerminalRequestArtifactIssue({ issue, projection: inspected.projection })) expectedTerminalIssues.push(issue);
        else actionableIssues.push(issue);
      }
      const { projection, ...publicEntry } = inspected;
      return {
        ...publicEntry,
        action_ok: actionableIssues.length === 0,
        actionable_issues: actionableIssues,
        expected_terminal_issues: expectedTerminalIssues
      };
    });
    const issueCountsByReason = {};
    const actionableIssueCountsByReason = {};
    const expectedTerminalIssueCountsByReason = {};
    for (const entry of entries) {
      for (const issue of entry.issues ?? []) {
        const reason = issue.reason ?? "unknown";
        issueCountsByReason[reason] = (issueCountsByReason[reason] ?? 0) + 1;
      }
      for (const issue of entry.actionable_issues ?? []) {
        const reason = issue.reason ?? "unknown";
        actionableIssueCountsByReason[reason] = (actionableIssueCountsByReason[reason] ?? 0) + 1;
      }
      for (const issue of entry.expected_terminal_issues ?? []) {
        const reason = issue.reason ?? "unknown";
        expectedTerminalIssueCountsByReason[reason] = (expectedTerminalIssueCountsByReason[reason] ?? 0) + 1;
      }
    }
    return {
      checked_latest: entries.length,
      stale_or_mismatched_latest: entries.filter((entry) => !entry.ok).length,
      actionable_stale_or_mismatched_latest: entries.filter((entry) => !entry.action_ok).length,
      issue_counts_by_reason: issueCountsByReason,
      actionable_issue_counts_by_reason: actionableIssueCountsByReason,
      expected_terminal_issue_counts_by_reason: expectedTerminalIssueCountsByReason,
      entries
    };
  } finally {
    ledger.close();
  }
}

function latestAttemptForJob(ledger, jobId) {
  return ledger.db.prepare(`
    SELECT *
    FROM job_attempts
    WHERE job_id = ?
    ORDER BY attempt_number DESC, started_at DESC, attempt_id DESC
    LIMIT 1
  `).get(jobId) ?? null;
}

function findStage0FinishedEventForAttempt(ledger, { runId, jobId, attemptId }) {
  const rows = ledger.db.prepare(`
    SELECT *
    FROM outbox
    WHERE event_type = 'researchbrain.stage0_job_finished' AND aggregate_id = ?
    ORDER BY created_at DESC, event_id DESC
  `).all(runId);
  return rows.find((row) => {
    const payload = jsonObjectFromText(row.payload_json);
    return payload.job_id === jobId && payload.attempt_id === attemptId;
  }) ?? rows.find((row) => jsonObjectFromText(row.payload_json).job_id === jobId) ?? null;
}

function terminalFailureSummaryFromAttempt(attempt) {
  const payload = jsonObjectFromText(attempt?.payload_json);
  const summary = payload.failure_summary ?? null;
  if (summary && typeof summary === "object" && !Array.isArray(summary)) return summary;
  const failure = payload.failure ?? null;
  if (failure && typeof failure === "object" && !Array.isArray(failure)) {
    return {
      failure_class: failure.failure_class ?? null,
      retryable: failure.retryable ?? null,
      error_message: failure.error_message ?? null
    };
  }
  return null;
}

function inspectTerminalFailureReconciliation({ rootDir, ledger, job }) {
  const issues = [];
  const run = job.run_id ? ledger.getRun(job.run_id) : null;
  const attempt = latestAttemptForJob(ledger, job.job_id);
  const attemptPayload = jsonObjectFromText(attempt?.payload_json);
  const failureSummary = terminalFailureSummaryFromAttempt(attempt);
  if (!run) issues.push({ reason: "terminal_failure_missing_run", run_id: job.run_id ?? null });
  else if (run.status !== job.status) issues.push({ reason: "terminal_failure_run_status_mismatch", run_id: run.run_id, run_status: run.status, job_status: job.status });
  if (!attempt) issues.push({ reason: "terminal_failure_missing_attempt", job_id: job.job_id });
  else if (attempt.status !== job.status) issues.push({ reason: "terminal_failure_attempt_status_mismatch", attempt_id: attempt.attempt_id, attempt_status: attempt.status, job_status: job.status });
  if (!failureSummary) issues.push({ reason: "terminal_failure_missing_failure_summary", job_id: job.job_id, attempt_id: attempt?.attempt_id ?? null });
  else if (failureSummary.retryable !== false) issues.push({ reason: "terminal_failure_retryable_or_unknown", job_id: job.job_id, attempt_id: attempt?.attempt_id ?? null, retryable: failureSummary.retryable ?? null });
  if (job.status === "poisoned" && failureSummary?.failure_class !== "poison_candidate_or_run") {
    issues.push({ reason: "terminal_failure_poison_class_mismatch", job_id: job.job_id, failure_class: failureSummary?.failure_class ?? null });
  }
  const event = run && attempt ? findStage0FinishedEventForAttempt(ledger, { runId: run.run_id, jobId: job.job_id, attemptId: attempt.attempt_id }) : null;
  if (!event) issues.push({ reason: "terminal_failure_missing_outbox_event", job_id: job.job_id, attempt_id: attempt?.attempt_id ?? null });
  else if (event.status !== "processed") issues.push({ reason: "terminal_failure_outbox_unprocessed", event_id: event.event_id, outbox_status: event.status });
  let projectionArtifact = null;
  let projectionIntegrity = null;
  if (event?.status === "processed") {
    projectionArtifact = jsonObjectFromText(event.payload_json)?.outbox_consumer?.result?.projection_artifact ?? null;
    const projectionIssues = processedOutboxProjectionIssue({ rootDir, event, projectionArtifact });
    issues.push(...projectionIssues.map((issue) => ({ ...issue, reason: `terminal_failure_${issue.reason}` })));
    if (projectionArtifact?.path) {
      try {
        const fullPath = resolveRepoRelativePath(rootDir, projectionArtifact.path, "terminal_failure_projection_artifact");
        projectionIntegrity = inspectProjectionIntegrity({
          rootDir,
          ledger,
          entry: {
            path: projectionArtifact.path,
            sha256: projectionArtifact.sha256 ?? (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() ? sha256File(fullPath) : null)
          }
        });
        const actionable = (projectionIntegrity.issues ?? []).filter((issue) => !isExpectedTerminalRequestArtifactIssue({ issue, projection: projectionIntegrity.projection }));
        issues.push(...actionable.map((issue) => ({ ...issue, reason: `terminal_failure_projection_${issue.reason}` })));
      } catch (error) {
        issues.push({ reason: "terminal_failure_projection_integrity_error", event_id: event.event_id, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return {
    job_id: job.job_id,
    run_id: job.run_id,
    status: job.status,
    attempt_id: attempt?.attempt_id ?? null,
    failure_summary: failureSummary ? {
      failure_class: failureSummary.failure_class ?? null,
      retryable: failureSummary.retryable ?? null,
      error_message: failureSummary.error_message ?? null,
      final_terminal_state: failureSummary.final_terminal_state ?? attemptPayload.final_terminal_state ?? null,
      request_artifact: failureSummary.request_artifact ?? null,
      runtime_result_artifact: failureSummary.runtime_result_artifact ?? null
    } : null,
    outbox_event_id: event?.event_id ?? null,
    outbox_status: event?.status ?? null,
    projection_artifact: projectionArtifact ? { path: projectionArtifact.path ?? null, sha256: projectionArtifact.sha256 ?? null } : null,
    reconciled: issues.length === 0,
    issues
  };
}

function summarizeTerminalFailureReconciliation({ rootDir, dbPath }) {
  const ledger = new RuntimeLedger({ rootDir, dbPath });
  try {
    ledger.migrate();
    const terminalJobs = ledger.db.prepare(`
      SELECT job_id, run_id, status, priority, created_at, updated_at, payload_json
      FROM jobs
      WHERE job_type = ? AND status IN ('blocked', 'poisoned')
      ORDER BY updated_at DESC, job_id ASC
    `).all(RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE);
    const entries = terminalJobs.map((job) => inspectTerminalFailureReconciliation({ rootDir, ledger, job }));
    const issueCountsByReason = {};
    for (const entry of entries) {
      for (const issue of entry.issues) {
        const reason = issue.reason ?? "unknown";
        issueCountsByReason[reason] = (issueCountsByReason[reason] ?? 0) + 1;
      }
    }
    const reconciledJobIds = entries.filter((entry) => entry.reconciled).map((entry) => entry.job_id);
    return {
      status: entries.length === 0 ? "none" : (entries.every((entry) => entry.reconciled) ? "expected_terminal_failures_only" : "attention"),
      total_terminal_failures: entries.length,
      reconciled_terminal_failures: reconciledJobIds.length,
      unreconciled_terminal_failures: entries.length - reconciledJobIds.length,
      reconciled_job_ids: reconciledJobIds,
      issue_counts_by_reason: issueCountsByReason,
      entries
    };
  } finally {
    ledger.close();
  }
}

function processedOutboxProjectionIssue({ rootDir, event, projectionArtifact }) {
  if (!projectionArtifact || typeof projectionArtifact !== "object" || Array.isArray(projectionArtifact)) {
    return [{ reason: "processed_outbox_missing_projection_artifact", event_id: event.event_id }];
  }
  const issues = [];
  const artifactRef = { ...projectionArtifact, artifact_type: "researchbrain_stage0_outbox_projection" };
  const artifactRefIssue = artifactIssue({ rootDir, label: "outbox_consumer.result.projection_artifact", ref: artifactRef });
  if (artifactRefIssue) issues.push({ event_id: event.event_id, ...artifactRefIssue });
  if (artifactRefIssue?.reason === "artifact_missing" || artifactRefIssue?.reason === "artifact_not_file" || artifactRefIssue?.reason === "artifact_path_invalid") return issues;

  try {
    const fullPath = resolveRepoRelativePath(rootDir, projectionArtifact.path, "outbox_projection_artifact");
    const stat = fs.statSync(fullPath);
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const outboxConsumer = jsonObjectFromText(event.payload_json)?.outbox_consumer ?? {};
    const projectedStatus = parsed?.event?.payload?.status ?? parsed?.run?.status ?? null;
    const consumerResult = outboxConsumer?.result ?? {};
    if (Number.isInteger(projectionArtifact.size_bytes) && projectionArtifact.size_bytes !== stat.size) {
      issues.push({ reason: "processed_outbox_projection_size_mismatch", event_id: event.event_id, path: projectionArtifact.path, expected_size_bytes: projectionArtifact.size_bytes, actual_size_bytes: stat.size });
    }
    if (typeof outboxConsumer?.consumer_id === "string" && typeof parsed?.consumer_id === "string" && parsed.consumer_id !== outboxConsumer.consumer_id) {
      issues.push({ reason: "processed_outbox_projection_consumer_id_mismatch", event_id: event.event_id, path: projectionArtifact.path, outbox_consumer_id: outboxConsumer.consumer_id, projection_consumer_id: parsed.consumer_id });
    }
    if (consumerResult?.projected_status !== undefined && projectedStatus !== consumerResult.projected_status) {
      issues.push({ reason: "processed_outbox_projection_status_mismatch", event_id: event.event_id, path: projectionArtifact.path, outbox_projected_status: consumerResult.projected_status, projection_status: projectedStatus });
    }
    if (parsed?.schema_version !== EXPECTED_STAGE0_OUTBOX_PROJECTION_SCHEMA_VERSION) {
      issues.push({ reason: "processed_outbox_projection_schema_mismatch", event_id: event.event_id, path: projectionArtifact.path, schema_version: parsed?.schema_version ?? null });
    }
    const projectedEventId = parsed?.event?.event_id ?? null;
    if (projectedEventId !== event.event_id) {
      issues.push({ reason: "processed_outbox_projection_event_id_mismatch", event_id: event.event_id, projected_event_id: projectedEventId, path: projectionArtifact.path });
    }
    const consumerProcessedAt = outboxConsumer?.processed_at ?? null;
    const projectedAt = parsed?.projected_at ?? null;
    if (consumerProcessedAt && projectedAt && consumerProcessedAt !== projectedAt) {
      issues.push({ reason: "processed_outbox_projection_processed_at_mismatch", event_id: event.event_id, processed_at: consumerProcessedAt, projected_at: projectedAt, path: projectionArtifact.path });
    }
    const processedAtMs = isoMs(event.processed_at ?? consumerProcessedAt);
    if (processedAtMs !== null && stat.mtimeMs > processedAtMs + PROJECTION_MTIME_GRACE_MS) {
      issues.push({ reason: "processed_outbox_projection_modified_after_processed", event_id: event.event_id, processed_at: event.processed_at ?? consumerProcessedAt, modified_at: stat.mtime.toISOString(), path: projectionArtifact.path });
    }
    for (const field of ["official_state_mutated", "official_evidence_index_mutated", "official_backlog_mutated", "official_leaderboard_mutated", "profitability_labels_created", "wfa_executed", "mt5_executed"]) {
      if (parsed?.[field] !== false) issues.push({ reason: "processed_outbox_projection_authority_flag_invalid", event_id: event.event_id, path: projectionArtifact.path, field, value: parsed?.[field] ?? null });
    }
  } catch (error) {
    issues.push({ reason: "processed_outbox_projection_parse_error", event_id: event.event_id, path: projectionArtifact.path ?? null, message: error instanceof Error ? error.message : String(error) });
  }
  return issues;
}

function summarizeProcessedOutboxProjections({ rootDir, dbPath, projectionDir, processedOutboxLimit }) {
  const ledger = new RuntimeLedger({ rootDir, dbPath });
  try {
    ledger.migrate();
    const events = ledger.db.prepare(`
      SELECT event_id, aggregate_id, status, processed_at, payload_json
      FROM outbox
      WHERE event_type = 'researchbrain.stage0_job_finished' AND status = 'processed'
      ORDER BY processed_at DESC, event_id ASC
      LIMIT ?
    `).all(processedOutboxLimit);
    const totalProcessed = ledger.db.prepare(`
      SELECT COUNT(*) AS count
      FROM outbox
      WHERE event_type = 'researchbrain.stage0_job_finished' AND status = 'processed'
    `).get().count;
    const entries = events.map((event) => {
      const payload = jsonObjectFromText(event.payload_json);
      const projectionArtifact = payload?.outbox_consumer?.result?.projection_artifact ?? null;
      const issues = processedOutboxProjectionIssue({ rootDir, event, projectionArtifact });
      return {
        event_id: event.event_id,
        aggregate_id: event.aggregate_id,
        processed_at: event.processed_at,
        projection_artifact: projectionArtifact ? { path: projectionArtifact.path ?? null, sha256: projectionArtifact.sha256 ?? null } : null,
        ok: issues.length === 0,
        issues
      };
    });

    const projectionFiles = listProjectionFiles(rootDir, projectionDir);
    const byEventId = new Map();
    for (const file of projectionFiles) {
      if (!file.event_id) continue;
      const group = byEventId.get(file.event_id) ?? [];
      group.push(file);
      byEventId.set(file.event_id, group);
    }
    const stage0OutboxEvents = ledger.db.prepare(`
      SELECT event_id, status, processed_at
      FROM outbox
      WHERE event_type = 'researchbrain.stage0_job_finished'
    `).all();
    const stage0OutboxByEventId = new Map(stage0OutboxEvents.map((event) => [event.event_id, event]));
    const checkedProcessedWithoutMatchingProjection = entries
      .filter((entry) => !byEventId.has(entry.event_id))
      .map((entry) => ({
        event_id: entry.event_id,
        aggregate_id: entry.aggregate_id,
        processed_at: entry.processed_at,
        projection_artifact: entry.projection_artifact,
        reason: "processed_event_without_matching_projection_file"
      }));
    const orphanProjectionFiles = projectionFiles
      .filter((file) => file.event_id && !stage0OutboxByEventId.has(file.event_id))
      .map((file) => ({
        ...file,
        reason: "projection_file_without_outbox_event"
      }));
    const unidentifiedProjectionFiles = projectionFiles
      .filter((file) => !file.event_id)
      .map((file) => ({
        ...file,
        reason: file.parse_error ? "projection_file_parse_error_no_event_id" : "projection_file_missing_event_id"
      }));
    const duplicates = [];
    for (const [eventId, files] of byEventId.entries()) {
      if (files.length <= 1) continue;
      const sorted = [...files].sort((a, b) => b.modified_at.localeCompare(a.modified_at) || b.path.localeCompare(a.path));
      duplicates.push({
        event_id: eventId,
        reason: "duplicate_projection_event",
        file_count: sorted.length,
        newest: sorted[0],
        stale_files: sorted.slice(1)
      });
    }

    const issueCountsByReason = {};
    for (const entry of entries) {
      for (const issue of entry.issues) {
        const reason = issue.reason ?? "unknown";
        issueCountsByReason[reason] = (issueCountsByReason[reason] ?? 0) + 1;
      }
    }
    for (const duplicate of duplicates) {
      issueCountsByReason[duplicate.reason] = (issueCountsByReason[duplicate.reason] ?? 0) + 1;
      issueCountsByReason.stale_duplicate_projection_file = (issueCountsByReason.stale_duplicate_projection_file ?? 0) + duplicate.stale_files.length;
    }
    if (checkedProcessedWithoutMatchingProjection.length > 0) issueCountsByReason.processed_event_without_matching_projection_file = checkedProcessedWithoutMatchingProjection.length;
    if (orphanProjectionFiles.length > 0) issueCountsByReason.projection_file_without_outbox_event = orphanProjectionFiles.length;
    for (const file of unidentifiedProjectionFiles) {
      issueCountsByReason[file.reason] = (issueCountsByReason[file.reason] ?? 0) + 1;
    }

    return {
      total_processed_events: totalProcessed,
      checked_processed_events: entries.length,
      limit: processedOutboxLimit,
      truncated: totalProcessed > entries.length,
      mismatched_processed_events: entries.filter((entry) => !entry.ok).length,
      duplicate_projection_events: duplicates.length,
      stale_duplicate_projection_files: duplicates.reduce((count, duplicate) => count + duplicate.stale_files.length, 0),
      recovery: {
        projection_files_scanned: projectionFiles.length,
        checked_processed_without_matching_projection_files: checkedProcessedWithoutMatchingProjection.length,
        orphan_projection_files: orphanProjectionFiles.length,
        unidentified_projection_files: unidentifiedProjectionFiles.length,
        checked_processed_without_matching_projection_file_entries: checkedProcessedWithoutMatchingProjection,
        orphan_projection_file_entries: orphanProjectionFiles,
        unidentified_projection_file_entries: unidentifiedProjectionFiles
      },
      issue_counts_by_reason: issueCountsByReason,
      entries,
      duplicates
    };
  } finally {
    ledger.close();
  }
}

function findFinishedEventForFinalJob(ledger, { runId, jobId, attemptId }) {
  if (!runId || !jobId) return null;
  const rows = ledger.db.prepare(`
    SELECT *
    FROM outbox
    WHERE event_type = 'researchbrain.stage0_job_finished' AND aggregate_id = ?
    ORDER BY created_at DESC, event_id DESC
  `).all(runId);
  return rows.find((row) => {
    const payload = jsonObjectFromText(row.payload_json);
    return payload.job_id === jobId && (!attemptId || payload.attempt_id === attemptId);
  }) ?? null;
}

function summarizeRuntimeConsistency({ rootDir, dbPath, runtimeConsistencyLimit }) {
  const ledger = new RuntimeLedger({ rootDir, dbPath });
  try {
    ledger.migrate();
    const totalFinalJobs = ledger.db.prepare(`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE job_type = ? AND status IN ('stage0_ready', 'blocked', 'poisoned')
    `).get(RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE).count;
    const jobs = ledger.db.prepare(`
      SELECT jobs.job_id, jobs.run_id, jobs.status AS job_status, jobs.updated_at AS job_updated_at,
             runs.status AS run_status,
             latest_attempt.attempt_id, latest_attempt.status AS attempt_status, latest_attempt.attempt_number
      FROM jobs
      LEFT JOIN runs ON runs.run_id = jobs.run_id
      LEFT JOIN job_attempts AS latest_attempt ON latest_attempt.attempt_id = (
        SELECT attempt_id
        FROM job_attempts
        WHERE job_attempts.job_id = jobs.job_id
        ORDER BY attempt_number DESC, started_at DESC, attempt_id DESC
        LIMIT 1
      )
      WHERE jobs.job_type = ? AND jobs.status IN ('stage0_ready', 'blocked', 'poisoned')
      ORDER BY jobs.updated_at DESC, jobs.job_id ASC
      LIMIT ?
    `).all(RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE, runtimeConsistencyLimit);
    const entries = jobs.map((job) => {
      const issues = [];
      if (!job.run_id) issues.push({ reason: "final_job_missing_run_id", job_id: job.job_id });
      else if (!job.run_status) issues.push({ reason: "final_job_missing_run", job_id: job.job_id, run_id: job.run_id });
      else if (job.run_status !== job.job_status) issues.push({ reason: "final_job_run_status_mismatch", job_id: job.job_id, run_id: job.run_id, job_status: job.job_status, run_status: job.run_status });
      if (!job.attempt_id) issues.push({ reason: "final_job_missing_attempt", job_id: job.job_id });
      else if (job.attempt_status !== job.job_status) issues.push({ reason: "final_job_latest_attempt_status_mismatch", job_id: job.job_id, attempt_id: job.attempt_id, job_status: job.job_status, attempt_status: job.attempt_status });
      const event = findFinishedEventForFinalJob(ledger, { runId: job.run_id, jobId: job.job_id, attemptId: job.attempt_id });
      if (!event) issues.push({ reason: "final_job_missing_finished_outbox_event", job_id: job.job_id, run_id: job.run_id, attempt_id: job.attempt_id ?? null });
      else {
        const payload = jsonObjectFromText(event.payload_json);
        if (event.status !== "processed") issues.push({ reason: "final_job_outbox_not_processed", job_id: job.job_id, event_id: event.event_id, outbox_status: event.status });
        if (payload.status !== job.job_status) issues.push({ reason: "final_job_outbox_status_mismatch", job_id: job.job_id, event_id: event.event_id, job_status: job.job_status, outbox_status: payload.status ?? null });
      }
      return {
        job_id: job.job_id,
        run_id: job.run_id,
        job_status: job.job_status,
        run_status: job.run_status ?? null,
        latest_attempt_id: job.attempt_id ?? null,
        latest_attempt_status: job.attempt_status ?? null,
        outbox_event_id: event?.event_id ?? null,
        outbox_status: event?.status ?? null,
        ok: issues.length === 0,
        issues
      };
    });
    const issueCountsByReason = {};
    for (const entry of entries) {
      for (const issue of entry.issues) {
        const reason = issue.reason ?? "unknown";
        issueCountsByReason[reason] = (issueCountsByReason[reason] ?? 0) + 1;
      }
    }
    return {
      status: entries.every((entry) => entry.ok) ? "ok" : "attention",
      total_final_jobs: totalFinalJobs,
      checked_final_jobs: entries.length,
      limit: runtimeConsistencyLimit,
      truncated: totalFinalJobs > entries.length,
      inconsistent_final_jobs: entries.filter((entry) => !entry.ok).length,
      issue_counts_by_reason: issueCountsByReason,
      entries
    };
  } finally {
    ledger.close();
  }
}

function terminalJobIds(reconciliation) {
  return new Set(reconciliation.entries.filter((entry) => entry.reconciled).map((entry) => entry.job_id));
}

function seededRequestDriftNeedsAttention({ requests, terminalFailures }) {
  const reconciled = terminalJobIds(terminalFailures);
  return requests.entries.some((entry) => {
    const drifted = entry.seeded && (!entry.valid || entry.seeded_path_sha_mismatch);
    if (!drifted) return false;
    const jobId = entry.seeded_job?.job_id ?? null;
    return !jobId || !reconciled.has(jobId);
  });
}

function actionableDiagnosticsReasons({ diagnostics, terminalFailures }) {
  const terminalOnlyReasons = new Set(["blocked_jobs", "poisoned_jobs"]);
  const reasons = diagnostics.attention_reasons.filter((reason) => !terminalOnlyReasons.has(reason));
  const hadTerminalDiagnostics = diagnostics.attention_reasons.some((reason) => terminalOnlyReasons.has(reason));
  if (hadTerminalDiagnostics && terminalFailures.unreconciled_terminal_failures > 0) reasons.push("unreconciled_terminal_stage0_failures");
  return reasons;
}

function readinessStatus({ diagnostics, requests, projectionIntegrity, processedOutboxProjections, terminalFailures, runtimeConsistency }) {
  const reasons = [];
  const actionableDiagnostics = actionableDiagnosticsReasons({ diagnostics, terminalFailures });
  if (actionableDiagnostics.length > 0) reasons.push("diagnostics_attention");
  if (diagnostics.outbox.by_status.pending > 0) reasons.push("pending_outbox_events");
  if (diagnostics.jobs.claimable_stale_or_ready > 0) reasons.push("claimable_stage0_jobs");
  if (diagnostics.projections.latest.some((entry) => entry.parse_error)) reasons.push("projection_parse_error");
  if (projectionIntegrity.actionable_stale_or_mismatched_latest > 0) reasons.push("stale_projection_refs");
  if (processedOutboxProjections.mismatched_processed_events > 0 || processedOutboxProjections.duplicate_projection_events > 0) reasons.push("processed_outbox_projection_mismatch");
  if ((processedOutboxProjections.recovery?.checked_processed_without_matching_projection_files ?? 0) > 0 || (processedOutboxProjections.recovery?.orphan_projection_files ?? 0) > 0 || (processedOutboxProjections.recovery?.unidentified_projection_files ?? 0) > 0) reasons.push("projection_recovery_attention");
  if (runtimeConsistency.inconsistent_final_jobs > 0) reasons.push("runtime_ledger_consistency_attention");
  if (terminalFailures.unreconciled_terminal_failures > 0) reasons.push("unreconciled_terminal_stage0_failures");
  if (requests.seeded_output_collisions > 0) reasons.push("seeded_output_collision");
  if (requests.unseeded_invalid > 0) reasons.push("invalid_request_artifacts");
  if (seededRequestDriftNeedsAttention({ requests, terminalFailures })) reasons.push("seeded_request_artifact_drift");
  if (requests.unseeded_valid > 0) reasons.push("unseeded_valid_request_artifacts");
  return { status: reasons.length > 0 ? "attention" : "ready", reasons: [...new Set(reasons)], actionableDiagnostics };
}

export function buildResearchBrainStage0ReadinessReport({
  rootDir = process.cwd(),
  dbPath = null,
  requestDir = "factory/research/requests",
  requestLimit = 100,
  projectionDir = "factory/runtime/projections/researchbrain-stage0",
  projectionLimit = 5,
  staleLimit = 10,
  failureLimit = 10,
  processedOutboxLimit = 100,
  runtimeConsistencyLimit = 100,
  generatedAt = nowIso()
} = {}) {
  if (!Number.isInteger(requestLimit) || requestLimit < 0 || requestLimit > 500) throw new Error("ResearchBrain Stage-0 readiness requestLimit must be an integer from 0 to 500.");
  if (!Number.isInteger(processedOutboxLimit) || processedOutboxLimit < 1 || processedOutboxLimit > 1000) throw new Error("ResearchBrain Stage-0 readiness processedOutboxLimit must be an integer from 1 to 1000.");
  if (!Number.isInteger(runtimeConsistencyLimit) || runtimeConsistencyLimit < 1 || runtimeConsistencyLimit > 1000) throw new Error("ResearchBrain Stage-0 readiness runtimeConsistencyLimit must be an integer from 1 to 1000.");
  const root = path.resolve(rootDir);
  resolveRepoRelativePath(root, requestDir, "request_dir");
  const diagnostics = buildResearchBrainStage0Diagnostics({ rootDir: root, dbPath, projectionDir, projectionLimit, staleLimit, failureLimit });
  const seeded = summarizeSeededJobs({ rootDir: root, dbPath });
  const requests = summarizeRequests({ rootDir: root, requestDir, requestLimit, seededBySha: seeded.bySha, seededByPath: seeded.byPath });
  const projectionIntegrity = summarizeProjectionIntegrity({ rootDir: root, dbPath, latestProjections: diagnostics.projections.latest });
  const processedOutboxProjections = summarizeProcessedOutboxProjections({ rootDir: root, dbPath, projectionDir, processedOutboxLimit });
  const terminalFailures = summarizeTerminalFailureReconciliation({ rootDir: root, dbPath });
  const runtimeConsistency = summarizeRuntimeConsistency({ rootDir: root, dbPath, runtimeConsistencyLimit });
  const status = readinessStatus({ diagnostics, requests, projectionIntegrity, processedOutboxProjections, terminalFailures, runtimeConsistency });
  return {
    schema_version: RESEARCHBRAIN_STAGE0_READINESS_SCHEMA_VERSION,
    generated_at: generatedAt,
    status: status.status,
    attention_reasons: status.reasons,
    actionable_diagnostics_reasons: status.actionableDiagnostics,
    diagnostics,
    requests,
    seeded_jobs: { total: seeded.total, jobs: seeded.jobs.slice(0, requestLimit) },
    projection_health: {
      output_dir: diagnostics.projections.output_dir,
      total_files: diagnostics.projections.total_files,
      latest_parse_errors: diagnostics.projections.latest.filter((entry) => entry.parse_error).length,
      latest_stale_or_mismatched: projectionIntegrity.stale_or_mismatched_latest,
      integrity: projectionIntegrity,
      processed_outbox: processedOutboxProjections,
      latest: diagnostics.projections.latest
    },
    runtime_consistency: runtimeConsistency,
    terminal_failure_reconciliation: terminalFailures,
    authority: {
      non_authoritative_operational_report: true,
      official_state_mutated: false,
      official_evidence_index_mutated: false,
      official_backlog_mutated: false,
      official_leaderboard_mutated: false,
      profitability_labels_created: false,
      deterministic_workers_bypassed: false,
      wfa_executed: false,
      mt5_executed: false,
      phase8e_started: false
    }
  };
}

export function writeResearchBrainStage0ReadinessReport(pathsOrRoot, report = buildResearchBrainStage0ReadinessReport({ rootDir: pathsOrRoot.root ?? pathsOrRoot })) {
  const paths = buildPaths(pathsOrRoot.root ?? pathsOrRoot);
  const stamp = report.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fullPath = path.join(paths.verification, `researchbrain-stage0-readiness-${stamp}.json`);
  writeJsonAtomic(fullPath, report, paths);
  return { path: fullPath, payload: report, sha256: sha256File(fullPath) };
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildPaths } from "../core/paths.mjs";
import { ensureDir, writeJsonAtomic } from "../core/fs-utils.mjs";

const WORKER_NAME = "research_wfa_envelope";
const EVIDENCE_KIND = "research_wfa";
const AUTHORITY_LAYER = "python_research";
const WORKER_SCHEMA_VERSION = "research_wfa_worker_result_v1";
const WORKER_RELATIVE_PATH = "src/workers/research-wfa-envelope-worker.mjs";
const CORE_METRICS = ["sharpe_is", "sharpe_oos", "wfr", "total_trades", "max_drawdown"];

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function relativeToRoot(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) {
    throw new Error(`WFA artifact path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`WFA artifact path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

function artifactRecord(paths, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return { artifact_type: artifactType, path: relativeToRoot(paths, fullPath), sha256: sha256File(fullPath), size_bytes: stat.size, modified_at: stat.mtime.toISOString() };
}

function sourceHash(paths, repoRelativePath, artifactType = "worker_source") {
  const fullPath = path.join(paths.root, repoRelativePath);
  if (!fs.existsSync(fullPath)) return null;
  return artifactRecord(paths, fullPath, artifactType);
}

function sanitizeIdPart(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unspecified";
}

function defaultRunId(observedAt) {
  return `RUN-RESEARCH-WFA-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function defaultJobId(observedAt) {
  return `JOB-RESEARCH-WFA-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function canonicalCommand(configPath) {
  const configRef = configPath.replace(/^walk forward engine\//, "");
  return `.venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config ${configRef}`;
}

function validateInputs({ configPath, resultArtifacts, metricsObserved, windowsCompleted }) {
  const errors = [];
  if (!/^walk forward engine\/strategies\/[^/]+\/wfa_config\.ya?ml$/i.test(String(configPath || ""))) errors.push("canonical config path missing or invalid");
  if (!Array.isArray(resultArtifacts) || resultArtifacts.length === 0) errors.push("result_artifacts missing");
  if (!metricsObserved || typeof metricsObserved !== "object" || !CORE_METRICS.some((key) => metricsObserved[key] !== null && metricsObserved[key] !== undefined)) errors.push("observed WFA metrics missing");
  if (typeof windowsCompleted !== "number" || !Number.isFinite(windowsCompleted) || windowsCompleted < 1) errors.push("windows_completed must be >= 1");
  return errors;
}

function readJson(paths, repoRelativePath) {
  return JSON.parse(fs.readFileSync(resolveRepoRelativePath(paths.root, repoRelativePath), "utf8"));
}

function inputsFromExistingExecution(paths, executionResultPath) {
  if (!executionResultPath) return null;
  const existing = readJson(paths, executionResultPath);
  const provenance = existing?.provenance ?? {};
  return {
    experimentId: existing?.experiment_id ?? null,
    configPath: provenance.config_path ?? null,
    resultArtifacts: Array.isArray(provenance.result_artifacts) ? provenance.result_artifacts : [],
    metricsObserved: existing?.metrics_observed ?? null,
    windowsCompleted: provenance.windows_completed ?? null,
    candidateId: existing?.candidate_id ?? existing?.worker_result?.candidate_id ?? null,
    sourceExecutionResult: existing
  };
}

function buildExecutionResult({ workerResult, experimentId, observedAt, artifacts, metricsObserved, provenance, blockedReason }) {
  const common = { experiment_id: experimentId, candidate_id: workerResult.candidate_id ?? null, evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, observed_at: observedAt, artifacts_created: artifacts, metrics_observed: metricsObserved ?? {}, observations: workerResult.observations, blocked_reason: blockedReason, source_hashes: workerResult.source_hashes, worker_result: workerResult };
  if (workerResult.status === "succeeded") return { ...common, status: "executed", blocked_reason: null, provenance };
  return { ...common, status: "blocked", blockers: [blockedReason], errors: [{ command: "research_wfa_envelope_worker", message: blockedReason }] };
}

export function runResearchWfaEnvelopeWorker({
  rootDir,
  experimentId = null,
  runId = null,
  jobId = null,
  observedAt = new Date().toISOString(),
  configPath = null,
  resultArtifacts = [],
  metricsObserved = null,
  windowsCompleted = null,
  candidateId = null,
  executionResultPath = null
} = {}) {
  const paths = buildPaths(rootDir ?? process.cwd());
  const existingExecutionInputs = inputsFromExistingExecution(paths, executionResultPath);
  const effectiveConfigPath = configPath ?? existingExecutionInputs?.configPath ?? null;
  const effectiveResultArtifacts = resultArtifacts.length > 0 ? resultArtifacts : (existingExecutionInputs?.resultArtifacts ?? []);
  const effectiveMetricsObserved = metricsObserved ?? existingExecutionInputs?.metricsObserved ?? null;
  const effectiveWindowsCompleted = windowsCompleted ?? existingExecutionInputs?.windowsCompleted ?? null;
  const effectiveCandidateId = candidateId ?? existingExecutionInputs?.candidateId ?? null;
  const effectiveRunId = runId ?? defaultRunId(observedAt);
  const effectiveJobId = sanitizeIdPart(jobId ?? defaultJobId(observedAt));
  const runDir = path.join(paths.runs, effectiveJobId);
  ensureDir(runDir, paths);

  const request = { schema_version: "research_wfa_envelope_request_v1", evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, run_id: effectiveRunId, job_id: effectiveJobId, candidate_id: effectiveCandidateId, config_path: effectiveConfigPath, result_artifacts: effectiveResultArtifacts, windows_completed: effectiveWindowsCompleted, source_execution_result_path: executionResultPath };
  const requestPath = path.join(runDir, "research-wfa-envelope-request.json");
  writeJsonAtomic(requestPath, request, paths);

  let blockedReason = null;
  const validationErrors = validateInputs({ configPath: effectiveConfigPath, resultArtifacts: effectiveResultArtifacts, metricsObserved: effectiveMetricsObserved, windowsCompleted: effectiveWindowsCompleted });
  if (validationErrors.length > 0) blockedReason = `Research WFA envelope inputs failed validation: ${validationErrors.join("; ")}.`;
  const resolvedResultArtifacts = [];
  if (!blockedReason) {
    try {
      for (const artifactPath of effectiveResultArtifacts) resolvedResultArtifacts.push(resolveRepoRelativePath(paths.root, artifactPath));
      resolveRepoRelativePath(paths.root, effectiveConfigPath);
      if (executionResultPath) resolveRepoRelativePath(paths.root, executionResultPath);
    } catch (error) {
      blockedReason = `Research WFA envelope artifact validation failed: ${error.message}`;
    }
  }
  if (!blockedReason) {
    const missing = [effectiveConfigPath, ...effectiveResultArtifacts, executionResultPath].filter(Boolean).filter((artifactPath) => !fs.existsSync(resolveRepoRelativePath(paths.root, artifactPath)));
    if (missing.length > 0) blockedReason = `Research WFA envelope references missing artifacts: ${missing.join(", ")}.`;
  }

  const status = blockedReason ? "blocked" : "succeeded";
  const provenance = status === "succeeded" ? { engine: "walk_forward_engine", command: canonicalCommand(effectiveConfigPath), working_directory: "walk forward engine", config_path: effectiveConfigPath, result_artifacts: effectiveResultArtifacts, windows_completed: effectiveWindowsCompleted } : null;
  const observations = status === "succeeded" ? { candidate_id: effectiveCandidateId, canonical_wfa_config_path: effectiveConfigPath, result_artifacts: effectiveResultArtifacts, windows_completed: effectiveWindowsCompleted, envelope_scope: "existing_wfa_artifact_officialization", execution_was_run_by_this_worker: false, source_execution_result_path: executionResultPath } : { candidate_id: effectiveCandidateId, envelope_scope: "blocked", reason: blockedReason };
  const sourceHashes = [sourceHash(paths, WORKER_RELATIVE_PATH), status === "succeeded" ? sourceHash(paths, effectiveConfigPath, "wfa_config") : null, executionResultPath ? sourceHash(paths, executionResultPath, "source_execution_result") : null].filter(Boolean);
  const summary = { schema_version: "research_wfa_envelope_summary_v1", evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, status, observed_at: observedAt, candidate_id: effectiveCandidateId, provenance, metrics_observed: effectiveMetricsObserved ?? {}, observations, blocked_reason: blockedReason, source_hashes: sourceHashes };
  const summaryPath = path.join(runDir, status === "succeeded" ? "research-wfa-envelope-summary.json" : "blocked-research-wfa-envelope-summary.json");
  writeJsonAtomic(summaryPath, summary, paths);

  const artifacts = [artifactRecord(paths, summaryPath, status === "succeeded" ? "research_wfa_envelope_summary" : "blocked_research_wfa_envelope_summary"), artifactRecord(paths, requestPath, "worker_request")];
  if (status === "succeeded") artifacts.push(...resolvedResultArtifacts.map((fullPath) => artifactRecord(paths, fullPath, "wfa_result_artifact")));
  if (status === "succeeded" && executionResultPath) artifacts.push(artifactRecord(paths, resolveRepoRelativePath(paths.root, executionResultPath), "source_execution_result"));

  const workerResult = { job_id: effectiveJobId, run_id: effectiveRunId, candidate_id: effectiveCandidateId, worker: WORKER_NAME, evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, schema_version: WORKER_SCHEMA_VERSION, status, artifacts, metrics: effectiveMetricsObserved ?? {}, observations, observed_at: observedAt, blocked_reason: blockedReason, source_hashes: sourceHashes, diagnostics: { error_code: blockedReason ? "research_wfa_envelope_blocked" : null, message: blockedReason, stdout_path: null, stderr_path: null }, environment: { node_version: process.version, platform: process.platform, arch: process.arch } };
  const workerResultPath = path.join(runDir, "worker-result.json");
  writeJsonAtomic(workerResultPath, workerResult, paths);
  const executionResult = buildExecutionResult({ workerResult, experimentId: experimentId ?? existingExecutionInputs?.experimentId ?? "EXP-RESEARCH-WFA-ENVELOPE", observedAt, artifacts, metricsObserved: effectiveMetricsObserved, provenance, blockedReason });
  const outputExecutionResultPath = path.join(runDir, "execution-result.json");
  writeJsonAtomic(outputExecutionResultPath, executionResult, paths);
  return executionResult;
}

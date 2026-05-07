import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildPaths } from "../core/paths.mjs";
import { ensureDir, writeJsonAtomic, writeTextAtomic } from "../core/fs-utils.mjs";

const WORKER_NAME = "mt5_tester_lifecycle";
const EVIDENCE_KIND = "mt5_tester";
const AUTHORITY_LAYER = "mt5_tester";
const WORKER_SCHEMA_VERSION = "mt5_tester_lifecycle_worker_result_v1";
const REQUIRED_SCENARIOS = ["market_order", "pending_order", "exit_order"];
const WORKER_RELATIVE_PATH = "src/workers/mt5-tester-lifecycle-worker.mjs";
const MQL_EXPERT_RELATIVE_PATH = "walk forward engine/mt5/experts/TrfTesterLifecycleBench.mq5";
const MQL_COMPILED_EXPERT_RELATIVE_PATH = "walk forward engine/mt5/experts/TrfTesterLifecycleBench.ex5";
const MQL_COMPILE_LOG_RELATIVE_PATH = "walk forward engine/mt5/experts/TrfTesterLifecycleBench.log";
const MQL_INCLUDE_RELATIVE_PATH = "walk forward engine/mt5/include/TrfFileCommonBridge.mqh";

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function relativeToRoot(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) {
    throw new Error(`Tester artifact path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Tester artifact path escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function artifactRecord(paths, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return {
    artifact_type: artifactType,
    path: relativeToRoot(paths, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

function sourceHash(paths, repoRelativePath) {
  const fullPath = path.join(paths.root, repoRelativePath);
  if (!fs.existsSync(fullPath)) return null;
  return artifactRecord(paths, fullPath, "worker_source");
}

function sanitizeIdPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unspecified";
}

function defaultRunId(observedAt) {
  return `RUN-MT5-TESTER-LIFECYCLE-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function defaultJobId(observedAt) {
  return `JOB-MT5-TESTER-LIFECYCLE-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function readTesterOutput(paths, testerOutputPath, testerOutputOverride) {
  if (testerOutputOverride) return testerOutputOverride;
  if (!testerOutputPath) return null;
  const fullPath = resolveRepoRelativePath(paths.root, testerOutputPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function validateTesterOutput(output) {
  const errors = [];
  if (!output || typeof output !== "object") return ["tester output is missing or invalid"];
  if (!output.tester_settings || typeof output.tester_settings !== "object") errors.push("tester_settings missing");
  if (!output.lifecycle_summary || typeof output.lifecycle_summary !== "object") errors.push("lifecycle_summary missing");
  for (const scenario of REQUIRED_SCENARIOS) {
    if (output.lifecycle_summary?.[scenario]?.observed !== true) errors.push(`${scenario} not observed`);
  }
  if (!output.limitations || typeof output.limitations !== "object") errors.push("limitations missing");
  return errors;
}

function buildExecutionResult({ workerResult, observedAt, experimentId, artifacts, blockedReason }) {
  if (workerResult.status === "succeeded") {
    return {
      experiment_id: experimentId,
      status: "executed",
      evidence_kind: EVIDENCE_KIND,
      authority_layer: AUTHORITY_LAYER,
      observed_at: observedAt,
      artifacts_created: artifacts,
      metrics_observed: {},
      observations: workerResult.observations,
      blocked_reason: null,
      source_hashes: workerResult.source_hashes,
      worker_result: workerResult
    };
  }
  return {
    experiment_id: experimentId,
    status: "blocked",
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    observed_at: observedAt,
    artifacts_created: artifacts,
    metrics_observed: {},
    observations: workerResult.observations,
    blocked_reason: blockedReason,
    blockers: [blockedReason],
    errors: [{ command: "mt5_tester_lifecycle_worker", message: blockedReason }],
    source_hashes: workerResult.source_hashes,
    worker_result: workerResult
  };
}

export function runMt5TesterLifecycleWorker({
  rootDir,
  experimentId = "EXP-MT5-TESTER-LIFECYCLE",
  runId = null,
  jobId = null,
  observedAt = new Date().toISOString(),
  symbol = null,
  timeframe = null,
  testerOutputPath = null,
  testerOutputOverride = null
} = {}) {
  const paths = buildPaths(rootDir ?? process.cwd());
  const effectiveRunId = runId ?? defaultRunId(observedAt);
  const effectiveJobId = sanitizeIdPart(jobId ?? defaultJobId(observedAt));
  const runDir = path.join(paths.mt5Tester, effectiveJobId);
  ensureDir(runDir, paths);

  const sourceHashes = [
    sourceHash(paths, WORKER_RELATIVE_PATH),
    sourceHash(paths, MQL_EXPERT_RELATIVE_PATH),
    sourceHash(paths, MQL_INCLUDE_RELATIVE_PATH)
  ].filter(Boolean);
  const request = {
    schema_version: "mt5_tester_lifecycle_request_v1",
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    run_id: effectiveRunId,
    job_id: effectiveJobId,
    symbol: symbol ?? null,
    timeframe: timeframe ?? null,
    tester_output_path: testerOutputPath ?? null,
    required_scenarios: REQUIRED_SCENARIOS,
    boundary: "Only repo-contained tester output artifacts are read. External terminal paths are not inspected."
  };
  const requestPath = path.join(runDir, "request.json");
  writeJsonAtomic(requestPath, request, paths);

  let testerOutput = null;
  let blockedReason = null;
  let diagnostics = { error_code: null, message: null, stdout_path: null, stderr_path: null };
  try {
    testerOutput = readTesterOutput(paths, testerOutputPath, testerOutputOverride);
  } catch (error) {
    blockedReason = `Unable to read repo-contained tester output: ${error.message}`;
    diagnostics = { ...diagnostics, error_code: "tester_output_read_failed", message: blockedReason };
  }

  if (!blockedReason && !testerOutput) {
    blockedReason = "MT5 tester lifecycle output is missing. Provide a repo-contained tester output artifact; external terminal paths are not inspected by this worker.";
    diagnostics = { ...diagnostics, error_code: "tester_output_missing", message: blockedReason };
  }

  const outputErrors = blockedReason ? [] : validateTesterOutput(testerOutput);
  if (!blockedReason && outputErrors.length > 0) {
    blockedReason = `MT5 tester lifecycle output failed validation: ${outputErrors.join("; ")}.`;
    diagnostics = { ...diagnostics, error_code: "tester_output_invalid", message: blockedReason };
  }

  const status = blockedReason ? "blocked" : "succeeded";
  const observations = status === "succeeded"
    ? {
        tester_settings: testerOutput.tester_settings,
        lifecycle_summary: testerOutput.lifecycle_summary,
        limitations: testerOutput.limitations,
        output_identity: {
          tester_output_sha256: sha256Text(stableJson(testerOutput)),
          tester_output_path: testerOutputPath ?? null,
          fixture_override_used: Boolean(testerOutputOverride)
        }
      }
    : {
        limitations: {
          mt5_tester_executed: false,
          reason: blockedReason
        }
      };

  const summary = {
    schema_version: "mt5_tester_lifecycle_summary_v1",
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    status,
    observed_at: observedAt,
    request,
    observations,
    blocked_reason: blockedReason,
    diagnostics,
    source_hashes: sourceHashes
  };
  const summaryPath = path.join(runDir, status === "succeeded" ? "mt5-tester-summary.json" : "blocked-mt5-tester-summary.json");
  writeJsonAtomic(summaryPath, summary, paths);
  const logDigestPath = path.join(runDir, "log-digest.json");
  writeJsonAtomic(logDigestPath, {
    schema_version: "mt5_tester_log_digest_v1",
    status,
    observed_at: observedAt,
    lines_examined: Array.isArray(testerOutput?.logs) ? testerOutput.logs.length : 0,
    errors: Array.isArray(testerOutput?.logs) ? testerOutput.logs.filter((line) => /error|fail|invalid/i.test(String(line))) : [],
    blocked_reason: blockedReason
  }, paths);

  const artifacts = [
    artifactRecord(paths, summaryPath, status === "succeeded" ? "mt5_tester_summary" : "blocked_mt5_tester_summary"),
    artifactRecord(paths, requestPath, "worker_request"),
    artifactRecord(paths, logDigestPath, "log_digest")
  ];
  for (const [repoRelativePath, artifactType] of [
    [MQL_COMPILED_EXPERT_RELATIVE_PATH, "mql_compiled_expert"],
    [MQL_COMPILE_LOG_RELATIVE_PATH, "mql_compile_log"]
  ]) {
    const fullPath = path.join(paths.root, repoRelativePath);
    if (fs.existsSync(fullPath)) artifacts.push(artifactRecord(paths, fullPath, artifactType));
  }
  for (const [fileName, artifactType] of [
    ["tester.ini", "tester_cli_config"],
    ["TrfTesterLifecycleBench.set", "tester_input_set"],
    ["tester-macd-diagnostic.ini", "tester_diagnostic_config"]
  ]) {
    const fullPath = path.join(runDir, fileName);
    if (fs.existsSync(fullPath)) artifacts.push(artifactRecord(paths, fullPath, artifactType));
  }
  if (testerOutputPath) {
    artifacts.push(artifactRecord(paths, resolveRepoRelativePath(paths.root, testerOutputPath), "mt5_tester_raw_output"));
  }

  const workerResult = {
    job_id: effectiveJobId,
    run_id: effectiveRunId,
    candidate_id: null,
    worker: WORKER_NAME,
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    schema_version: WORKER_SCHEMA_VERSION,
    status,
    artifacts,
    metrics: {},
    observations,
    observed_at: observedAt,
    blocked_reason: blockedReason,
    source_hashes: sourceHashes,
    diagnostics,
    environment: { node_version: process.version, platform: process.platform, arch: process.arch }
  };
  const workerResultPath = path.join(runDir, "worker-result.json");
  writeJsonAtomic(workerResultPath, workerResult, paths);
  const executionResult = buildExecutionResult({ workerResult, observedAt, experimentId, artifacts, blockedReason });
  const executionResultPath = path.join(runDir, "execution-result.json");
  writeJsonAtomic(executionResultPath, executionResult, paths);
  return executionResult;
}

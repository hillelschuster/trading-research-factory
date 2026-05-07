import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPaths } from "../core/paths.mjs";
import { ensureDir, writeJsonAtomic, writeTextAtomic } from "../core/fs-utils.mjs";

const WORKER_NAME = "mt5_snapshot";
const EVIDENCE_KIND = "mt5_snapshot";
const AUTHORITY_LAYER = "mt5_terminal";
const WORKER_SCHEMA_VERSION = "mt5_snapshot_worker_result_v1";
const SNAPSHOT_SCHEMA_VERSION = "mt5_environment_snapshot_v1";
const PROBE_RELATIVE_PATH = "walk forward engine/src/mt5_snapshot_probe.py";
const WORKER_RELATIVE_PATH = "src/workers/mt5-snapshot-worker.mjs";

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function relativeToRoot(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
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
  return `RUN-MT5-SNAPSHOT-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function defaultJobId({ observedAt, symbol, timeframe }) {
  const stamp = observedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `JOB-MT5-SNAPSHOT-${stamp}-${sanitizeIdPart(symbol)}-${sanitizeIdPart(timeframe)}`;
}

function parseProbeOutput(stdout) {
  if (!stdout || !stdout.trim()) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function commandLabel(command) {
  if (!command) return null;
  return path.basename(command);
}

function shouldUseWindowsPathForProbe(pythonCommand) {
  return process.platform !== "win32" && /\.(exe|bat|cmd)$/i.test(commandLabel(pythonCommand) ?? "");
}

function convertWslPathToWindows(fullPath) {
  const result = spawnSync("wslpath", ["-w", fullPath], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024
  });
  const converted = result.status === 0 ? String(result.stdout ?? "").trim() : "";
  return {
    convertedPath: converted || fullPath,
    error: result.status === 0 ? null : (result.stderr || result.error?.message || `wslpath exited with status ${result.status}`)
  };
}

function buildRequest({ symbol, timeframe, bars, terminalPath, login, server, passwordEnvProvided }) {
  return {
    schema_version: "mt5_snapshot_request_v1",
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    symbol: symbol ?? null,
    timeframe: timeframe ?? null,
    bars: bars ?? null,
    login: Number.isInteger(login) ? login : null,
    server: server ?? null,
    password_env_var: passwordEnvProvided ? "TRF_MT5_PASSWORD" : null,
    password_env_provided: Boolean(passwordEnvProvided),
    terminal_path_provided: Boolean(terminalPath),
    terminal_path: terminalPath ? "provided_not_persisted" : null
  };
}

function terminalPathForProbe(terminalPath) {
  const value = String(terminalPath ?? "").trim();
  if (!value) return null;
  if (/\.exe$/i.test(value)) return value;
  if (/^[A-Za-z]:[\\/]/.test(value) || value.includes("\\")) {
    return path.win32.join(value, "terminal64.exe");
  }
  return value;
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
    observations: workerResult.observations ?? {},
    blocked_reason: blockedReason,
    blockers: [blockedReason],
    errors: [{ command: "mt5_snapshot_worker", message: blockedReason }],
    source_hashes: workerResult.source_hashes,
    worker_result: workerResult
  };
}

export function runMt5SnapshotWorker({
  rootDir,
  experimentId = "EXP-MT5-SNAPSHOT",
  runId = null,
  jobId = null,
  symbol = null,
  timeframe = null,
  bars = null,
  login = null,
  server = null,
  terminalPath = null,
  pythonCommand = process.platform === "win32" ? "python" : "python3",
  observedAt = new Date().toISOString(),
  probeResultOverride = null
} = {}) {
  const paths = buildPaths(rootDir ?? process.cwd());
  const effectiveRunId = runId ?? defaultRunId(observedAt);
  const effectiveJobId = jobId ?? defaultJobId({ observedAt, symbol, timeframe });
  const environmentDir = path.join(paths.mt5Environment, effectiveJobId);
  ensureDir(environmentDir, paths);

  const sourceHashes = [
    sourceHash(paths, WORKER_RELATIVE_PATH),
    sourceHash(paths, PROBE_RELATIVE_PATH)
  ].filter(Boolean);
  const passwordEnvProvided = Boolean(process.env.TRF_MT5_PASSWORD);
  const request = buildRequest({ symbol, timeframe, bars, terminalPath, login, server, passwordEnvProvided });
  const probeRequest = { ...request, terminal_path: terminalPathForProbe(terminalPath) };
  const requestPath = path.join(environmentDir, "request.json");
  writeJsonAtomic(requestPath, request, paths);

  const stdoutPath = path.join(environmentDir, "probe.stdout.txt");
  const stderrPath = path.join(environmentDir, "probe.stderr.txt");

  let probeResult = probeResultOverride;
  let spawnResult = null;
  let blockedReason = null;
  let diagnostics = {
    error_code: null,
    message: null,
    command: "mt5_snapshot_probe.py",
    python_command: commandLabel(pythonCommand),
    python_command_was_absolute: path.isAbsolute(pythonCommand),
    terminal_path_provided_to_probe: Boolean(probeRequest.terminal_path),
    terminal_path_inferred_executable: Boolean(terminalPath && probeRequest.terminal_path !== String(terminalPath).trim()),
    probe_path_style: "native",
    probe_path_conversion_error: null,
    exit_status: null,
    signal: null,
    stdout_path: relativeToRoot(paths, stdoutPath),
    stderr_path: relativeToRoot(paths, stderrPath)
  };

  const missingInputs = [];
  if (!symbol || typeof symbol !== "string" || !symbol.trim()) missingInputs.push("symbol");
  if (!timeframe || typeof timeframe !== "string" || !timeframe.trim()) missingInputs.push("timeframe");
  if (bars !== null && bars !== undefined && (!Number.isInteger(bars) || bars < 1)) missingInputs.push("bars_positive_integer");

  if (missingInputs.length > 0) {
    blockedReason = `MT5 snapshot requires explicit input fields: ${missingInputs.join(", ")}.`;
    diagnostics = {
      ...diagnostics,
      error_code: "missing_required_input",
      message: blockedReason
    };
    writeTextAtomic(stdoutPath, "", paths);
    writeTextAtomic(stderrPath, blockedReason + "\n", paths);
  } else if (!probeResult) {
    const probeScriptPath = path.join(paths.root, PROBE_RELATIVE_PATH);
    const probeScriptArgument = shouldUseWindowsPathForProbe(pythonCommand)
      ? convertWslPathToWindows(probeScriptPath)
      : { convertedPath: probeScriptPath, error: null };
    diagnostics = {
      ...diagnostics,
      probe_path_style: shouldUseWindowsPathForProbe(pythonCommand) ? "windows" : "native",
      probe_path_conversion_error: probeScriptArgument.error
    };
    spawnResult = spawnSync(pythonCommand, [probeScriptArgument.convertedPath], {
      cwd: paths.root,
      input: JSON.stringify(probeRequest),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1" }
    });
    writeTextAtomic(stdoutPath, spawnResult.stdout ?? "", paths);
    writeTextAtomic(stderrPath, spawnResult.stderr ?? "", paths);
    diagnostics = {
      ...diagnostics,
      exit_status: spawnResult.status,
      signal: spawnResult.signal ?? null
    };

    if (spawnResult.error) {
      blockedReason = `MT5 snapshot probe failed to start ${commandLabel(pythonCommand)}: ${spawnResult.error.code || spawnResult.error.message}.`;
      diagnostics = {
        ...diagnostics,
        error_code: spawnResult.error.code ?? "probe_spawn_error",
        message: blockedReason
      };
    } else {
      probeResult = parseProbeOutput(spawnResult.stdout);
      if (!probeResult) {
        blockedReason = `MT5 snapshot probe returned non-JSON output with exit status ${spawnResult.status}.`;
        diagnostics = {
          ...diagnostics,
          error_code: "probe_non_json_output",
          message: blockedReason
        };
      }
    }
  } else {
    writeTextAtomic(stdoutPath, JSON.stringify(probeResult, null, 2) + "\n", paths);
    writeTextAtomic(stderrPath, "", paths);
    diagnostics = {
      ...diagnostics,
      exit_status: 0,
      signal: null
    };
  }

  if (!blockedReason && probeResult?.status !== "succeeded") {
    blockedReason = probeResult?.blocked_reason || probeResult?.diagnostics?.message || "MT5 snapshot probe did not return succeeded status.";
    diagnostics = {
      ...diagnostics,
      ...(probeResult?.diagnostics && typeof probeResult.diagnostics === "object" ? probeResult.diagnostics : {}),
      message: blockedReason,
      error_code: probeResult?.diagnostics?.error_code ?? "probe_blocked"
    };
  }

  const status = blockedReason ? "blocked" : "succeeded";
  const baseObservations = status === "succeeded" && probeResult?.observations && typeof probeResult.observations === "object"
    ? probeResult.observations
    : {};
  const snapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    status,
    observed_at: observedAt,
    request,
    observations: baseObservations,
    blocked_reason: blockedReason,
    diagnostics,
    source_hashes: sourceHashes
  };
  const snapshotPath = path.join(environmentDir, status === "succeeded" ? "snapshot.json" : "blocked-snapshot.json");
  writeJsonAtomic(snapshotPath, snapshot, paths);
  const snapshotRecord = artifactRecord(paths, snapshotPath, status === "succeeded" ? "environment_identity" : "blocked_environment_snapshot");

  const observations = status === "succeeded"
    ? { ...baseObservations, snapshot_sha256: snapshotRecord.sha256 }
    : {};
  const artifactRecords = [
    snapshotRecord,
    artifactRecord(paths, requestPath, "worker_request"),
    artifactRecord(paths, stdoutPath, "probe_stdout"),
    artifactRecord(paths, stderrPath, "probe_stderr")
  ];

  const workerResult = {
    job_id: effectiveJobId,
    run_id: effectiveRunId,
    candidate_id: null,
    worker: WORKER_NAME,
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    schema_version: WORKER_SCHEMA_VERSION,
    status,
    artifacts: artifactRecords,
    metrics: {},
    observations,
    observed_at: observedAt,
    blocked_reason: blockedReason,
    source_hashes: sourceHashes,
    diagnostics,
    environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      python_command: commandLabel(pythonCommand),
      python_command_was_absolute: path.isAbsolute(pythonCommand)
    }
  };

  const workerResultPath = path.join(environmentDir, "worker-result.json");
  writeJsonAtomic(workerResultPath, workerResult, paths);

  const executionResult = buildExecutionResult({
    workerResult,
    observedAt,
    experimentId,
    artifacts: workerResult.artifacts,
    blockedReason
  });
  const executionResultPath = path.join(environmentDir, "execution-result.json");
  writeJsonAtomic(executionResultPath, executionResult, paths);

  return executionResult;
}

export function mt5SnapshotOutputDirectory(rootDir, jobId) {
  const paths = buildPaths(rootDir ?? process.cwd());
  return path.join(paths.mt5Environment, sanitizeIdPart(jobId));
}

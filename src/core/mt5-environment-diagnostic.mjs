import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, writeJsonAtomic, writeTextAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION = "mt5_python_environment_diagnostic_request_v1";
export const MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_SCHEMA_VERSION = "mt5_python_environment_diagnostic_v1";

const SOURCE_RELATIVE_PATH = "src/core/mt5-environment-diagnostic.mjs";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const PROBE_CODE = `import json, platform
try:
    import MetaTrader5 as mt5
    print(json.dumps({"ok": True, "python_version": platform.python_version(), "platform": platform.platform(), "mt5_package_version": getattr(mt5, "__version__", None)}, sort_keys=True))
except Exception as exc:
    print(json.dumps({"ok": False, "python_version": platform.python_version(), "platform": platform.platform(), "error_type": type(exc).__name__, "message": str(exc)}, sort_keys=True))
    raise SystemExit(2)
`;

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function artifactRecord(rootDir, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return {
    artifact_type: artifactType,
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

function sourceHash(paths) {
  const fullPath = path.join(paths.root, SOURCE_RELATIVE_PATH);
  if (!fs.existsSync(fullPath)) return null;
  return artifactRecord(paths.root, fullPath, "worker_source");
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "mt5-python-environment-diagnostic";
}

function defaultDiagnosticId(observedAt) {
  return `MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`MT5 Python environment diagnostic ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`MT5 Python environment diagnostic ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function defaultPythonCommands() {
  if (process.platform === "win32") {
    return [
      { label: "python", command: "python", args: [] },
      { label: "py-3", command: "py", args: ["-3"] }
    ];
  }
  return [
    { label: "python3", command: "python3", args: [] },
    { label: "python.exe", command: "python.exe", args: [] },
    { label: "py.exe-3", command: "py.exe", args: ["-3"] }
  ];
}

function normalizeCommandSpec(value, index) {
  if (typeof value === "string") return { label: path.basename(value), command: value, args: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`MT5 Python environment diagnostic python_commands[${index}] must be a string or object.`);
  if (!hasText(value.command, 1)) throw new Error(`MT5 Python environment diagnostic python_commands[${index}].command is required.`);
  const args = value.args === undefined ? [] : value.args;
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) throw new Error(`MT5 Python environment diagnostic python_commands[${index}].args must be strings.`);
  return {
    label: hasText(value.label, 1) ? value.label.trim() : path.basename(value.command),
    command: value.command,
    args
  };
}

function commandSpecsFromRequest(request) {
  const raw = request?.python_commands === undefined ? defaultPythonCommands() : request.python_commands;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("MT5 Python environment diagnostic request requires non-empty python_commands[] when provided.");
  return raw.map((value, index) => normalizeCommandSpec(value, index));
}

function parseProbePayload(stdout) {
  const lines = String(stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function safeEnv() {
  const env = { ...process.env, PYTHONUTF8: "1" };
  delete env.TRF_MT5_PASSWORD;
  return env;
}

function statusSummaryFrom(commands) {
  const available = commands.filter((command) => command.package_import_status === "available").length;
  return {
    total: commands.length,
    available,
    missing_or_failed: commands.length - available,
    by_status: commands.reduce((acc, command) => {
      acc[command.package_import_status] = (acc[command.package_import_status] ?? 0) + 1;
      return acc;
    }, {})
  };
}

function commandRecord({ rootDir, commandDir, spec, index, timeoutMs }) {
  const stdoutPath = path.join(commandDir, `${String(index + 1).padStart(2, "0")}-${sanitizePathPart(spec.label)}.stdout.txt`);
  const stderrPath = path.join(commandDir, `${String(index + 1).padStart(2, "0")}-${sanitizePathPart(spec.label)}.stderr.txt`);
  const result = spawnSync(spec.command, [...spec.args, "-c", PROBE_CODE], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    env: safeEnv()
  });
  writeTextAtomic(stdoutPath, result.stdout ?? "", { rootDir, allowedTopLevelDirs: new Set(["factory"]) });
  writeTextAtomic(stderrPath, result.stderr ?? "", { rootDir, allowedTopLevelDirs: new Set(["factory"]) });

  const parsed = result.error ? null : parseProbePayload(result.stdout);
  let packageImportStatus = "non_json_output";
  let message = "Python command did not return parseable probe JSON.";
  if (result.error) {
    packageImportStatus = "spawn_failed";
    message = result.error.code || result.error.message || "spawn failed";
  } else if (parsed?.ok === true) {
    packageImportStatus = "available";
    message = "MetaTrader5 import succeeded.";
  } else if (parsed?.ok === false) {
    packageImportStatus = parsed.error_type === "ModuleNotFoundError" || /No module named ['\"]MetaTrader5['\"]/.test(String(parsed.message ?? ""))
      ? "missing"
      : "import_failed";
    message = `${parsed.error_type ?? "ImportError"}: ${parsed.message ?? "MetaTrader5 import failed"}`;
  }

  return {
    label: spec.label,
    command_basename: path.basename(spec.command),
    command_was_absolute: path.isAbsolute(spec.command),
    args: spec.args,
    exit_status: result.status,
    signal: result.signal ?? null,
    error_code: result.error?.code ?? null,
    package_import_status: packageImportStatus,
    message,
    python_version: parsed?.python_version ?? null,
    platform: parsed?.platform ?? null,
    mt5_package_version: parsed?.mt5_package_version ?? null,
    stdout: artifactRecord(rootDir, stdoutPath, "mt5_python_environment_probe_stdout"),
    stderr: artifactRecord(rootDir, stderrPath, "mt5_python_environment_probe_stderr"),
    stdout_sha256: sha256Text(result.stdout ?? ""),
    stderr_sha256: sha256Text(result.stderr ?? "")
  };
}

export function validateMt5PythonEnvironmentDiagnosticRequest(request, { rootDir = process.cwd() } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("MT5 Python environment diagnostic request must be an object.");
  if (request.schema_version !== MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION) {
    throw new Error(`MT5 Python environment diagnostic request schema_version must be ${MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION}.`);
  }
  commandSpecsFromRequest(request);
  if (request.output_dir !== undefined && request.output_dir !== null) resolveRepoRelativePath(rootDir, request.output_dir, "output_dir");
  if (request.timeout_ms !== undefined && (!Number.isInteger(request.timeout_ms) || request.timeout_ms < 1000 || request.timeout_ms > 60000)) {
    throw new Error("MT5 Python environment diagnostic timeout_ms must be an integer from 1000 to 60000.");
  }
  return true;
}

export function validateMt5PythonEnvironmentDiagnostic(diagnostic) {
  const errors = [];
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) throw new Error("MT5 Python environment diagnostic is missing or invalid.");
  if (diagnostic.schema_version !== MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_SCHEMA_VERSION) errors.push(`schema_version must be ${MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_SCHEMA_VERSION}`);
  if (diagnostic.evidence_kind !== "mt5_python_environment_diagnostic") errors.push("evidence_kind must be mt5_python_environment_diagnostic");
  if (!hasText(diagnostic.diagnostic_id, 3)) errors.push("diagnostic_id is required");
  if (diagnostic.package_name !== "MetaTrader5") errors.push("package_name must be MetaTrader5");
  if (diagnostic.package_required_for !== "mt5_tradable_universe_snapshot") errors.push("package_required_for must be mt5_tradable_universe_snapshot");
  if (diagnostic.installation_attempted !== false) errors.push("installation_attempted must be false");
  if (!["ready", "blocked"].includes(diagnostic.status)) errors.push("status must be ready or blocked");
  if (diagnostic.official_evidence_index_mutated !== false) errors.push("official_evidence_index_mutated must be false");
  if (!Array.isArray(diagnostic.commands) || diagnostic.commands.length === 0) errors.push("commands must be non-empty");
  for (const [index, command] of (Array.isArray(diagnostic.commands) ? diagnostic.commands : []).entries()) {
    if (!hasText(command.label, 1)) errors.push(`commands[${index}].label is required`);
    if (!["available", "missing", "import_failed", "spawn_failed", "non_json_output"].includes(command.package_import_status)) errors.push(`commands[${index}].package_import_status is unsupported`);
    if (!hasText(command.stdout?.path, 3) || !SHA256_PATTERN.test(String(command.stdout?.sha256 || ""))) errors.push(`commands[${index}].stdout path and sha256 are required`);
    if (!hasText(command.stderr?.path, 3) || !SHA256_PATTERN.test(String(command.stderr?.sha256 || ""))) errors.push(`commands[${index}].stderr path and sha256 are required`);
    if (hasText(command.stdout_sha256, 1) && command.stdout_sha256 !== command.stdout?.sha256) errors.push(`commands[${index}].stdout_sha256 must match stdout.sha256`);
    if (hasText(command.stderr_sha256, 1) && command.stderr_sha256 !== command.stderr?.sha256) errors.push(`commands[${index}].stderr_sha256 must match stderr.sha256`);
  }
  const expectedSummary = Array.isArray(diagnostic.commands) ? statusSummaryFrom(diagnostic.commands) : null;
  const available = expectedSummary?.available ?? 0;
  if (diagnostic.status === "ready" && available < 1) errors.push("ready status requires at least one available MetaTrader5 import");
  if (diagnostic.status === "blocked" && !hasText(diagnostic.blocked_reason, 3)) errors.push("blocked status requires blocked_reason");
  if (!diagnostic.status_summary || typeof diagnostic.status_summary !== "object" || Array.isArray(diagnostic.status_summary)) {
    errors.push("status_summary is required");
  } else if (expectedSummary) {
    if (diagnostic.status_summary.total !== expectedSummary.total) errors.push(`status_summary.total must equal ${expectedSummary.total}`);
    if (diagnostic.status_summary.available !== expectedSummary.available) errors.push(`status_summary.available must equal ${expectedSummary.available}`);
    if (diagnostic.status_summary.missing_or_failed !== expectedSummary.missing_or_failed) errors.push(`status_summary.missing_or_failed must equal ${expectedSummary.missing_or_failed}`);
    if (JSON.stringify(diagnostic.status_summary.by_status ?? {}) !== JSON.stringify(expectedSummary.by_status)) errors.push("status_summary.by_status must match commands");
  }
  if (errors.length > 0) throw new Error(`MT5 Python environment diagnostic validation failed: ${errors.join("; ")}`);
  return true;
}

export function writeMt5PythonEnvironmentDiagnosticFromRequest({
  rootDir = process.cwd(),
  request = { schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION },
  observedAt = new Date().toISOString()
} = {}) {
  const paths = buildPaths(rootDir);
  validateMt5PythonEnvironmentDiagnosticRequest(request, { rootDir: paths.root });
  const diagnosticId = hasText(request.diagnostic_id, 3) ? request.diagnostic_id.trim() : defaultDiagnosticId(observedAt);
  const outputDir = request.output_dir
    ? resolveRepoRelativePath(paths.root, request.output_dir, "output_dir")
    : path.join(paths.mt5Environment, sanitizePathPart(diagnosticId));
  ensureDir(outputDir, paths);

  const commandDir = path.join(outputDir, "python-probes");
  ensureDir(commandDir, paths);
  const timeoutMs = request.timeout_ms ?? 15000;
  const commands = commandSpecsFromRequest(request).map((spec, index) => commandRecord({
    rootDir: paths.root,
    commandDir,
    spec,
    index,
    timeoutMs
  }));
  const available = commands.filter((command) => command.package_import_status === "available").length;
  const status = available > 0 ? "ready" : "blocked";
  const blockedReason = status === "blocked"
    ? "No configured Python command can import the MetaTrader5 package; live FTMO MT5 universe snapshots remain blocked until this is resolved outside the factory."
    : null;
  const sourceHashes = [sourceHash(paths)].filter(Boolean);
  const diagnostic = {
    schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_SCHEMA_VERSION,
    evidence_kind: "mt5_python_environment_diagnostic",
    diagnostic_id: diagnosticId,
    status,
    observed_at: observedAt,
    authority_layer: "local_environment",
    package_name: "MetaTrader5",
    package_required_for: "mt5_tradable_universe_snapshot",
    official_evidence_index_mutated: false,
    installation_attempted: false,
    blocked_reason: blockedReason,
    status_summary: statusSummaryFrom(commands),
    commands,
    source_hashes: sourceHashes
  };
  validateMt5PythonEnvironmentDiagnostic(diagnostic);

  const diagnosticPath = path.join(outputDir, status === "ready" ? "python-environment-diagnostic.json" : "blocked-python-environment-diagnostic.json");
  writeJsonAtomic(diagnosticPath, diagnostic, paths);
  return {
    status,
    evidence_kind: "mt5_python_environment_diagnostic",
    diagnostic_id: diagnosticId,
    observed_at: observedAt,
    official_evidence_index_mutated: false,
    installation_attempted: false,
    blocked_reason: blockedReason,
    artifacts: {
      diagnostic: artifactRecord(paths.root, diagnosticPath, "mt5_python_environment_diagnostic"),
      command_outputs: commands.flatMap((command) => [command.stdout, command.stderr])
    },
    diagnostic
  };
}

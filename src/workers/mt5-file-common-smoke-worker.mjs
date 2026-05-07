import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildPaths } from "../core/paths.mjs";
import { ensureDir, writeJsonAtomic, writeTextAtomic } from "../core/fs-utils.mjs";

const WORKER_NAME = "mt5_file_common_smoke";
const EVIDENCE_KIND = "mt5_bridge_smoke";
const AUTHORITY_LAYER = "control_plane";
const WORKER_SCHEMA_VERSION = "mt5_file_common_smoke_worker_result_v1";
export const FILE_COMMON_MESSAGE_SCHEMA_VERSION = "mt5_file_common_message_v1";
const WORKER_RELATIVE_PATH = "src/workers/mt5-file-common-smoke-worker.mjs";
const MQL_INCLUDE_RELATIVE_PATH = "walk forward engine/mt5/include/TrfFileCommonBridge.mqh";
const MQL_EXPERT_RELATIVE_PATH = "walk forward engine/mt5/experts/TrfFileCommonSmoke.mq5";

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function relativeToRoot(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) {
    throw new Error(`Bridge artifact path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Bridge artifact path escapes repository root: ${repoRelativePath}`);
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
  return `RUN-MT5-BRIDGE-SMOKE-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function defaultJobId(observedAt) {
  return `JOB-MT5-BRIDGE-SMOKE-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

export function fileCommonMessageChecksum(message) {
  const withoutChecksum = { ...message };
  delete withoutChecksum.checksum_sha256;
  return sha256Text(stableJson(withoutChecksum));
}

export function buildFileCommonMessage({
  runId,
  sequence,
  producedAt,
  expiresAt,
  producer,
  artifactPath,
  payload
}) {
  const base = {
    schema_version: FILE_COMMON_MESSAGE_SCHEMA_VERSION,
    run_id: runId,
    sequence,
    produced_at: producedAt,
    expires_at: expiresAt,
    producer,
    artifact_path: artifactPath,
    payload_sha256: sha256Text(stableJson(payload)),
    payload
  };
  return {
    ...base,
    checksum_sha256: fileCommonMessageChecksum(base)
  };
}

export function validateFileCommonMessage({ rootDir, messagePath, expectedRunId, now = new Date(), maxAgeMs = 15 * 60 * 1000 }) {
  let raw;
  try {
    raw = fs.readFileSync(resolveRepoRelativePath(rootDir, messagePath), "utf8");
  } catch (error) {
    return { accepted: false, rejected: true, rejection: "missing_message", reason: error.message, path: messagePath };
  }

  let message;
  try {
    message = JSON.parse(raw);
  } catch (error) {
    return { accepted: false, rejected: true, rejection: "partial_write", reason: `Message is not complete JSON: ${error.message}`, path: messagePath };
  }

  const requiredFields = ["schema_version", "run_id", "sequence", "produced_at", "expires_at", "producer", "artifact_path", "payload_sha256", "payload", "checksum_sha256"];
  const missing = requiredFields.filter((field) => message[field] === undefined || message[field] === null || message[field] === "");
  if (missing.length > 0 || message.schema_version !== FILE_COMMON_MESSAGE_SCHEMA_VERSION || !Number.isInteger(message.sequence)) {
    return { accepted: false, rejected: true, rejection: "schema_mismatch", reason: `Message schema mismatch: ${missing.join(", ") || "invalid schema or sequence"}`, path: messagePath };
  }

  if (message.run_id !== expectedRunId) {
    return { accepted: false, rejected: true, rejection: "wrong_run", reason: `Expected run_id ${expectedRunId} but found ${message.run_id}.`, path: messagePath };
  }

  const producedAtMs = Date.parse(message.produced_at);
  const expiresAtMs = Date.parse(message.expires_at);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(producedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs < nowMs || nowMs - producedAtMs > maxAgeMs) {
    return { accepted: false, rejected: true, rejection: "stale_message", reason: "Message is expired or outside max age.", path: messagePath };
  }

  const expectedChecksum = fileCommonMessageChecksum(message);
  if (message.checksum_sha256 !== expectedChecksum) {
    return { accepted: false, rejected: true, rejection: "corrupted_payload", reason: "Message checksum does not match canonical payload.", path: messagePath };
  }

  const expectedPayloadHash = sha256Text(stableJson(message.payload));
  if (message.payload_sha256 !== expectedPayloadHash) {
    return { accepted: false, rejected: true, rejection: "corrupted_payload", reason: "Payload hash does not match payload content.", path: messagePath };
  }

  let artifactFullPath;
  try {
    artifactFullPath = resolveRepoRelativePath(rootDir, message.artifact_path);
  } catch (error) {
    return { accepted: false, rejected: true, rejection: "artifact_path_invalid", reason: error.message, path: messagePath };
  }
  if (!fs.existsSync(artifactFullPath)) {
    return { accepted: false, rejected: true, rejection: "artifact_missing", reason: `Message artifact does not exist: ${message.artifact_path}`, path: messagePath };
  }

  return {
    accepted: true,
    rejected: false,
    rejection: null,
    reason: null,
    path: messagePath,
    run_id: message.run_id,
    sequence: message.sequence,
    checksum_sha256: message.checksum_sha256,
    artifact_path: message.artifact_path
  };
}

function writeMessage(paths, fullPath, message) {
  writeTextAtomic(fullPath, stableJson(message) + "\n", paths);
  return artifactRecord(paths, fullPath, "file_common_message");
}

function buildExecutionResult({ workerResult, observedAt, experimentId, artifacts }) {
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

export function runMt5FileCommonSmokeWorker({
  rootDir,
  experimentId = "EXP-MT5-BRIDGE-SMOKE",
  runId = null,
  jobId = null,
  observedAt = new Date().toISOString(),
  sequence = 1,
  maxAgeMs = 15 * 60 * 1000
} = {}) {
  const paths = buildPaths(rootDir ?? process.cwd());
  const effectiveRunId = runId ?? defaultRunId(observedAt);
  const effectiveJobId = sanitizeIdPart(jobId ?? defaultJobId(observedAt));
  const now = new Date(observedAt);
  const expiresAt = new Date(now.getTime() + maxAgeMs).toISOString();
  const staleProducedAt = new Date(now.getTime() - maxAgeMs * 2).toISOString();
  const staleExpiresAt = new Date(now.getTime() - 1000).toISOString();

  const scratchDir = path.join(paths.mt5Bridge, "scratch", effectiveJobId);
  const ingestedDir = path.join(paths.mt5Bridge, "ingested", effectiveJobId);
  const quarantineDir = path.join(paths.mt5Bridge, "quarantine", effectiveJobId);
  [scratchDir, ingestedDir, quarantineDir].forEach((dir) => ensureDir(dir, paths));

  const sourceHashes = [
    sourceHash(paths, WORKER_RELATIVE_PATH),
    sourceHash(paths, MQL_INCLUDE_RELATIVE_PATH),
    sourceHash(paths, MQL_EXPERT_RELATIVE_PATH)
  ].filter(Boolean);

  const request = {
    schema_version: "mt5_file_common_smoke_request_v1",
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    run_id: effectiveRunId,
    job_id: effectiveJobId,
    sequence,
    constraints: {
      allow_network: false,
      manual_copy_allowed: false,
      require_atomic_rename: true
    }
  };
  const requestPath = path.join(scratchDir, "request.json");
  writeJsonAtomic(requestPath, request, paths);

  const payload = {
    smoke_type: "file_common_protocol",
    run_id: effectiveRunId,
    job_id: effectiveJobId,
    sequence,
    network_calls_required: false,
    manual_copy_required: false,
    note: "Control-plane fixture for tester-compatible FILE_COMMON message validation."
  };
  const payloadPath = path.join(scratchDir, "payload.json");
  writeTextAtomic(payloadPath, stableJson(payload) + "\n", paths);
  const payloadArtifactPath = relativeToRoot(paths, payloadPath);
  const producer = {
    id: WORKER_NAME,
    kind: "control_plane_fixture",
    file_common_flag: true
  };

  const validMessage = buildFileCommonMessage({
    runId: effectiveRunId,
    sequence,
    producedAt: observedAt,
    expiresAt,
    producer,
    artifactPath: payloadArtifactPath,
    payload
  });
  const validMessagePath = path.join(scratchDir, "message-valid.json");
  const validMessageArtifact = writeMessage(paths, validMessagePath, validMessage);
  const validMessageRelativePath = validMessageArtifact.path;

  const wrongRunMessage = buildFileCommonMessage({
    runId: `${effectiveRunId}-WRONG`,
    sequence,
    producedAt: observedAt,
    expiresAt,
    producer,
    artifactPath: payloadArtifactPath,
    payload
  });
  const wrongRunPath = path.join(quarantineDir, "message-wrong-run.json");
  const wrongRunArtifact = writeMessage(paths, wrongRunPath, wrongRunMessage);

  const staleMessage = buildFileCommonMessage({
    runId: effectiveRunId,
    sequence,
    producedAt: staleProducedAt,
    expiresAt: staleExpiresAt,
    producer,
    artifactPath: payloadArtifactPath,
    payload
  });
  const stalePath = path.join(quarantineDir, "message-stale.json");
  const staleArtifact = writeMessage(paths, stalePath, staleMessage);

  const corruptedMessage = {
    ...validMessage,
    payload: { ...validMessage.payload, tampered: true }
  };
  const corruptedPath = path.join(quarantineDir, "message-corrupted.json");
  const corruptedArtifact = writeMessage(paths, corruptedPath, corruptedMessage);

  const partialPath = path.join(quarantineDir, "message-partial.json");
  writeTextAtomic(partialPath, stableJson(validMessage).slice(0, 80), paths);
  const partialArtifact = artifactRecord(paths, partialPath, "file_common_rejection_case");

  const accepted = validateFileCommonMessage({
    rootDir: paths.root,
    messagePath: validMessageRelativePath,
    expectedRunId: effectiveRunId,
    now,
    maxAgeMs
  });
  const rejectionTests = {
    wrong_run: validateFileCommonMessage({ rootDir: paths.root, messagePath: wrongRunArtifact.path, expectedRunId: effectiveRunId, now, maxAgeMs }),
    stale_message: validateFileCommonMessage({ rootDir: paths.root, messagePath: staleArtifact.path, expectedRunId: effectiveRunId, now, maxAgeMs }),
    corrupted_payload: validateFileCommonMessage({ rootDir: paths.root, messagePath: corruptedArtifact.path, expectedRunId: effectiveRunId, now, maxAgeMs }),
    partial_write: validateFileCommonMessage({ rootDir: paths.root, messagePath: partialArtifact.path, expectedRunId: effectiveRunId, now, maxAgeMs })
  };

  const protocol = {
    schema_version: FILE_COMMON_MESSAGE_SCHEMA_VERSION,
    file_common_required: true,
    file_common_folder: "TERMINAL_COMMONDATA_PATH/MQL5/Files via MQL5 FILE_COMMON flag",
    network_calls_required: false,
    manual_copy_required: false,
    atomic_write_rename_required: true,
    checksum: "sha256 over canonical JSON message without checksum_sha256",
    payload_hash: "sha256 over canonical JSON payload"
  };
  const observations = {
    protocol,
    accepted_message: accepted,
    rejection_tests: rejectionTests,
    mql5_sources: {
      include: MQL_INCLUDE_RELATIVE_PATH,
      expert: MQL_EXPERT_RELATIVE_PATH
    },
    tester_lifecycle_executed: false
  };

  const report = {
    schema_version: "mt5_file_common_smoke_report_v1",
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    status: "succeeded",
    observed_at: observedAt,
    request,
    observations,
    source_hashes: sourceHashes
  };
  const reportPath = path.join(ingestedDir, "bridge-smoke-report.json");
  writeJsonAtomic(reportPath, report, paths);

  const artifacts = [
    artifactRecord(paths, reportPath, "bridge_smoke_report"),
    artifactRecord(paths, requestPath, "worker_request"),
    artifactRecord(paths, payloadPath, "file_common_payload"),
    validMessageArtifact,
    { ...wrongRunArtifact, artifact_type: "file_common_rejection_case" },
    { ...staleArtifact, artifact_type: "file_common_rejection_case" },
    { ...corruptedArtifact, artifact_type: "file_common_rejection_case" },
    partialArtifact
  ];

  const workerResult = {
    job_id: effectiveJobId,
    run_id: effectiveRunId,
    candidate_id: null,
    worker: WORKER_NAME,
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    schema_version: WORKER_SCHEMA_VERSION,
    status: "succeeded",
    artifacts,
    metrics: {},
    observations,
    observed_at: observedAt,
    blocked_reason: null,
    source_hashes: sourceHashes,
    diagnostics: {
      error_code: null,
      message: null,
      stdout_path: null,
      stderr_path: null
    },
    environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch
    }
  };

  const workerResultPath = path.join(ingestedDir, "worker-result.json");
  writeJsonAtomic(workerResultPath, workerResult, paths);
  const executionResult = buildExecutionResult({ workerResult, observedAt, experimentId, artifacts });
  const executionResultPath = path.join(ingestedDir, "execution-result.json");
  writeJsonAtomic(executionResultPath, executionResult, paths);
  return executionResult;
}

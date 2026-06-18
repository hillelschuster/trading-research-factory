import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";
import { validateDataRelevanceClassification } from "./mt5-data-relevance.mjs";
import { validateBrokerHistoryExportManifest } from "./mt5-history-availability.mjs";
import { validateMt5InstrumentEquivalence } from "./mt5-instrument-equivalence.mjs";
import { validateMt5PythonEnvironmentDiagnostic } from "./mt5-environment-diagnostic.mjs";
import { validateMt5TerminalInventory } from "./mt5-terminal-inventory.mjs";

export const PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION = "phase8a_mt5_artifact_registration_request_v1";
export const PHASE8A_MT5_ARTIFACT_REGISTRATION_SCHEMA_VERSION = "phase8a_mt5_artifact_registration_v1";

const ALLOWED_EVIDENCE_KINDS = new Set([
  "mt5_snapshot",
  "mt5_tradable_universe_snapshot",
  "data_relevance_classification",
  "broker_history_export_manifest",
  "mt5_instrument_equivalence",
  "mt5_python_environment_diagnostic",
  "phase8a_mt5_terminal_inventory"
]);
const FORBIDDEN_PHASE8B_RESEARCH_KINDS = new Set([
  "hypothesis_packet",
  "hypothesis_packet_v1",
  "research_source_record",
  "research_source_record_v1",
  "research_digest",
  "research_digest_v1",
  "research_ideation_manifest",
  "research_ideation_manifest_v1"
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function isSafeRepoRelativeArtifactPath(value) {
  if (!hasText(value, 3) || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.includes("\0")) return false;
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  return normalized !== "." && !normalized.startsWith("../") && normalized !== "..";
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`Phase 8A MT5 artifact registration ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Phase 8A MT5 artifact registration ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function readJsonRepoRelative(rootDir, repoRelativePath, label) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, label);
  if (!fs.existsSync(fullPath)) throw new Error(`Phase 8A MT5 artifact registration ${label} is missing on disk: ${repoRelativePath}`);
  return { fullPath, value: JSON.parse(fs.readFileSync(fullPath, "utf8")) };
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

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "phase8a-mt5-artifact-registration";
}

function defaultRegistrationId(observedAt) {
  return `PHASE8A-MT5-ARTIFACT-REGISTRATION-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function validateMt5SnapshotArtifact(value, repoRelativePath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`MT5 snapshot artifact is invalid: ${repoRelativePath}`);
  if (value.schema_version !== "mt5_environment_snapshot_v1") throw new Error(`MT5 snapshot artifact must use mt5_environment_snapshot_v1: ${repoRelativePath}`);
  if (value.evidence_kind !== "mt5_snapshot") throw new Error(`MT5 snapshot artifact evidence_kind must be mt5_snapshot: ${repoRelativePath}`);
  if (!["succeeded", "blocked"].includes(value.status)) throw new Error(`MT5 snapshot artifact status must be succeeded or blocked: ${repoRelativePath}`);
}

function validateUniverseSnapshotArtifact(value, repoRelativePath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`MT5 universe artifact is invalid: ${repoRelativePath}`);
  if (value.schema_version !== "mt5_tradable_universe_snapshot_v1") throw new Error(`MT5 universe artifact must use mt5_tradable_universe_snapshot_v1: ${repoRelativePath}`);
  if (value.evidence_kind !== "mt5_tradable_universe_snapshot") throw new Error(`MT5 universe artifact evidence_kind must be mt5_tradable_universe_snapshot: ${repoRelativePath}`);
  if (!["succeeded", "blocked"].includes(value.status)) throw new Error(`MT5 universe artifact status must be succeeded or blocked: ${repoRelativePath}`);
  if (value.status === "succeeded" && (!Array.isArray(value.symbols) || value.symbols.length === 0)) {
    throw new Error(`MT5 universe artifact succeeded status requires symbols[]: ${repoRelativePath}`);
  }
  if (value.status === "blocked" && !hasText(value.blocked_reason, 3)) {
    throw new Error(`MT5 universe artifact blocked status requires blocked_reason: ${repoRelativePath}`);
  }
}

function validateArtifactPayload(value, repoRelativePath) {
  const evidenceKind = value?.evidence_kind;
  if (FORBIDDEN_PHASE8B_RESEARCH_KINDS.has(evidenceKind) || FORBIDDEN_PHASE8B_RESEARCH_KINDS.has(value?.schema_version)) {
    throw new Error(`Phase 8A MT5 artifact registration cannot register Phase 8B/ResearchBrain artifact kind '${String(evidenceKind ?? value?.schema_version)}': ${repoRelativePath}`);
  }
  if (!ALLOWED_EVIDENCE_KINDS.has(evidenceKind)) {
    throw new Error(`Phase 8A MT5 artifact registration unsupported evidence_kind '${String(evidenceKind)}': ${repoRelativePath}`);
  }
  if (evidenceKind === "mt5_snapshot") validateMt5SnapshotArtifact(value, repoRelativePath);
  if (evidenceKind === "mt5_tradable_universe_snapshot") validateUniverseSnapshotArtifact(value, repoRelativePath);
  if (evidenceKind === "data_relevance_classification") validateDataRelevanceClassification(value);
  if (evidenceKind === "broker_history_export_manifest") validateBrokerHistoryExportManifest(value);
  if (evidenceKind === "mt5_instrument_equivalence") validateMt5InstrumentEquivalence(value);
  if (evidenceKind === "mt5_python_environment_diagnostic") validateMt5PythonEnvironmentDiagnostic(value);
  if (evidenceKind === "phase8a_mt5_terminal_inventory") validateMt5TerminalInventory(value);
  return evidenceKind;
}

function artifactStatus(value) {
  if (hasText(value?.status, 3)) return value.status;
  if (hasText(value?.blocked_reason, 3)) return "blocked";
  return "ready";
}

function summaryFor(value) {
  return {
    status: artifactStatus(value),
    job_id: value?.job_id ?? null,
    classification_id: value?.classification_id ?? null,
    manifest_id: value?.manifest_id ?? null,
    equivalence_id: value?.equivalence_id ?? null,
    inventory_id: value?.inventory_id ?? null,
    diagnostic_id: value?.diagnostic_id ?? null,
    counts: value?.counts ?? null,
    status_summary: value?.status_summary ?? null,
    blocked_reason: value?.blocked_reason ?? null
  };
}

function buildStatusSummary(artifacts) {
  const byStatus = {};
  const byEvidenceKind = {};
  for (const artifact of artifacts) {
    byStatus[artifact.status] = (byStatus[artifact.status] ?? 0) + 1;
    byEvidenceKind[artifact.evidence_kind] = (byEvidenceKind[artifact.evidence_kind] ?? 0) + 1;
  }
  return {
    total: artifacts.length,
    ready: artifacts.filter((artifact) => artifact.status !== "blocked").length,
    blocked: artifacts.filter((artifact) => artifact.status === "blocked").length,
    by_status: byStatus,
    by_evidence_kind: byEvidenceKind
  };
}

export function validatePhase8AMt5ArtifactRegistrationRequest(request, { rootDir = process.cwd() } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Phase 8A MT5 artifact registration request must be an object.");
  if (request.schema_version !== PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION) {
    throw new Error(`Phase 8A MT5 artifact registration request schema_version must be ${PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(request.artifact_paths) || request.artifact_paths.length === 0) {
    throw new Error("Phase 8A MT5 artifact registration request requires non-empty artifact_paths[].");
  }
  for (const artifactPath of request.artifact_paths) resolveRepoRelativePath(rootDir, artifactPath, "artifact_paths[]");
  if (request.output_dir !== undefined && request.output_dir !== null) resolveRepoRelativePath(rootDir, request.output_dir, "output_dir");
  return true;
}

export function validatePhase8AMt5ArtifactRegistration(registration) {
  const errors = [];
  if (!registration || typeof registration !== "object" || Array.isArray(registration)) throw new Error("Phase 8A MT5 artifact registration is missing or invalid.");
  if (registration.schema_version !== PHASE8A_MT5_ARTIFACT_REGISTRATION_SCHEMA_VERSION) errors.push(`schema_version must be ${PHASE8A_MT5_ARTIFACT_REGISTRATION_SCHEMA_VERSION}`);
  if (registration.evidence_kind !== "phase8a_mt5_artifact_registration") errors.push("evidence_kind must be phase8a_mt5_artifact_registration");
  if (!hasText(registration.registration_id, 3)) errors.push("registration_id is required");
  if (registration.official_evidence_index_mutated !== false) errors.push("official_evidence_index_mutated must be false");
  if (!Array.isArray(registration.artifacts) || registration.artifacts.length === 0) errors.push("artifacts must be non-empty");
  for (const [index, artifact] of (Array.isArray(registration.artifacts) ? registration.artifacts : []).entries()) {
    if (FORBIDDEN_PHASE8B_RESEARCH_KINDS.has(artifact?.evidence_kind) || FORBIDDEN_PHASE8B_RESEARCH_KINDS.has(artifact?.schema_version)) errors.push(`artifacts[${index}].evidence_kind cannot be Phase 8B/ResearchBrain`);
    if (!ALLOWED_EVIDENCE_KINDS.has(artifact?.evidence_kind)) errors.push(`artifacts[${index}].evidence_kind is unsupported`);
    if (!isSafeRepoRelativeArtifactPath(String(artifact?.path || ""))) errors.push(`artifacts[${index}].path must be a safe repo-relative path`);
    if (!SHA256_PATTERN.test(String(artifact?.sha256 || ""))) errors.push(`artifacts[${index}].sha256 must be a valid sha256`);
    if (!hasText(artifact?.status, 3)) errors.push(`artifacts[${index}].status is required`);
  }
  const artifacts = Array.isArray(registration.artifacts) ? registration.artifacts : [];
  const expectedSummary = artifacts.length > 0 ? buildStatusSummary(artifacts) : null;
  if (!registration.status_summary || typeof registration.status_summary !== "object" || Array.isArray(registration.status_summary)) {
    errors.push("status_summary is required");
  } else if (expectedSummary) {
    if (registration.status_summary.total !== expectedSummary.total) errors.push(`status_summary.total must equal ${expectedSummary.total}`);
    if (registration.status_summary.ready !== expectedSummary.ready) errors.push(`status_summary.ready must equal ${expectedSummary.ready}`);
    if (registration.status_summary.blocked !== expectedSummary.blocked) errors.push(`status_summary.blocked must equal ${expectedSummary.blocked}`);
    if (JSON.stringify(registration.status_summary.by_status ?? {}) !== JSON.stringify(expectedSummary.by_status)) errors.push("status_summary.by_status must match artifacts");
    if (JSON.stringify(registration.status_summary.by_evidence_kind ?? {}) !== JSON.stringify(expectedSummary.by_evidence_kind)) errors.push("status_summary.by_evidence_kind must match artifacts");
  }
  if (errors.length > 0) throw new Error(`Phase 8A MT5 artifact registration validation failed: ${errors.join("; ")}`);
  return true;
}

export function writePhase8AMt5ArtifactRegistrationFromRequest({
  rootDir = process.cwd(),
  request,
  observedAt = new Date().toISOString()
} = {}) {
  const paths = buildPaths(rootDir);
  validatePhase8AMt5ArtifactRegistrationRequest(request, { rootDir: paths.root });
  const registrationId = hasText(request.registration_id, 3) ? request.registration_id.trim() : defaultRegistrationId(observedAt);

  const artifacts = request.artifact_paths.map((artifactPath) => {
    const { fullPath, value } = readJsonRepoRelative(paths.root, artifactPath, "artifact_paths[]");
    const evidenceKind = validateArtifactPayload(value, artifactPath);
    return {
      ...artifactRecord(paths.root, fullPath, evidenceKind),
      evidence_kind: evidenceKind,
      summary: summaryFor(value),
      status: artifactStatus(value)
    };
  });

  const registration = {
    schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_SCHEMA_VERSION,
    evidence_kind: "phase8a_mt5_artifact_registration",
    registration_id: registrationId,
    observed_at: observedAt,
    authority_layer: "control_plane",
    official_evidence_index_mutated: false,
    registration_scope: "phase8a_mt5_readiness_artifacts_only",
    status_summary: buildStatusSummary(artifacts),
    artifacts
  };
  validatePhase8AMt5ArtifactRegistration(registration);

  const outputDir = request.output_dir
    ? resolveRepoRelativePath(paths.root, request.output_dir, "output_dir")
    : path.join(paths.mt5, "artifact-registration", sanitizePathPart(registrationId));
  const registrationPath = path.join(outputDir, "registration.json");
  writeJsonAtomic(registrationPath, registration, paths);

  return {
    status: "ready",
    evidence_kind: "phase8a_mt5_artifact_registration",
    registration_id: registrationId,
    observed_at: observedAt,
    official_evidence_index_mutated: false,
    artifacts: {
      registration: artifactRecord(paths.root, registrationPath, "phase8a_mt5_artifact_registration"),
      registered_artifacts: artifacts
    },
    registration
  };
}

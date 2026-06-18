import crypto from "crypto";
import fs from "fs";
import path from "path";
import { writeJsonAtomic } from "./fs-utils.mjs";

export const RESEARCH_WFA_PREREGISTRATION_SCHEMA_VERSION = "research_wfa_preregistration_v1";
export const RESEARCH_WFA_PREREGISTRATION_ARTIFACT_TYPE = "research_wfa_preregistration";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REQUIRED_DENOMINATOR_FLAGS = [
  "attempt_is_denominator_member",
  "failed_blocked_repaired_rerun_counted",
  "parameter_or_scope_change_creates_new_attempt",
  "optimizer_trials_recorded"
];
const REQUIRED_FROZEN_FIELDS = [
  "mechanism_summary",
  "instrument_scope",
  "timeframe_candidate",
  "strategy_family",
  "expected_trade_frequency",
  "data_sources",
  "cost_assumptions",
  "wfa_design",
  "invalidation_criteria"
];
const ALLOWED_FIELDS = new Set([
  "schema_version",
  "candidate_id",
  "registered_at",
  "registered_before_run_id",
  "content_hash",
  "hypothesis_packet_ref",
  "source_record_refs",
  "mechanism_summary",
  "instrument_scope",
  "timeframe_candidate",
  "strategy_family",
  "expected_trade_frequency",
  "data_sources",
  "cost_assumptions",
  "wfa_design",
  "denominator_tracking",
  "frozen_fields",
  "invalidation_criteria",
  "invalid_if_added_after_results",
  "official_state_mutated",
  "official_evidence_index_mutated",
  "official_backlog_mutated",
  "official_leaderboard_mutated",
  "wfa_executed",
  "strategy_edge_claimed"
]);

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function hasObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalCandidateId(value) {
  return typeof value === "string" && /^CAND-[A-Z0-9][A-Z0-9._-]*$/.test(value);
}

function isCanonicalRunId(value) {
  return typeof value === "string" && /^RUN-[A-Z0-9][A-Z0-9._-]*$/i.test(value);
}

function isIsoTimestamp(value) {
  if (!hasText(value, 20)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function looksLikeCanonicalWfaConfigPath(value) {
  return typeof value === "string" && /^walk forward engine\/strategies\/[^/]+\/wfa_config\.ya?ml$/i.test(value.trim());
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

export function researchWfaPreregistrationContentHash(registration) {
  const copy = { ...(registration ?? {}) };
  delete copy.content_hash;
  return crypto.createHash("sha256").update(JSON.stringify(sortJson(copy))).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoPath) {
  if (!hasText(repoPath, 3) || path.isAbsolute(repoPath)) throw new Error("research_wfa_preregistration artifact path must be repo-relative.");
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`research_wfa_preregistration artifact path escapes repository root: ${repoPath}`);
  return fullPath;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function validateArtifactRef(ref, label, errors, { rootDir = null, expectedSchemaVersion = null } = {}) {
  if (!hasObject(ref)) {
    errors.push(`${label} artifact reference is required`);
    return;
  }
  if (!hasText(ref.path, 3)) errors.push(`${label}.path is required`);
  if (!SHA256_PATTERN.test(String(ref.sha256 || ""))) errors.push(`${label}.sha256 must be sha256`);
  if (!rootDir || !hasText(ref.path, 3)) return;

  let fullPath;
  try {
    fullPath = resolveRepoRelativePath(rootDir, ref.path);
  } catch (error) {
    errors.push(error.message);
    return;
  }
  if (!fs.existsSync(fullPath)) {
    errors.push(`${label}.path is missing on disk: ${ref.path}`);
    return;
  }
  if (sha256File(fullPath) !== ref.sha256) errors.push(`${label}.sha256 mismatch`);
  if (expectedSchemaVersion) {
    try {
      const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (payload.schema_version !== expectedSchemaVersion) errors.push(`${label}.schema_version must be ${expectedSchemaVersion}`);
    } catch {
      errors.push(`${label}.path must contain valid JSON`);
    }
  }
}

export function validateResearchWfaPreregistration(registration, { expectedCandidateId = null, expectedRunId = null, resultsKnownAt = null, rootDir = null } = {}) {
  const errors = [];
  if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
    throw new Error("research_wfa_preregistration must be an object.");
  }

  const unexpected = Object.keys(registration).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected.length > 0) errors.push(`unexpected fields: ${unexpected.join(", ")}`);
  if (registration.schema_version !== RESEARCH_WFA_PREREGISTRATION_SCHEMA_VERSION) errors.push(`schema_version must be ${RESEARCH_WFA_PREREGISTRATION_SCHEMA_VERSION}`);
  if (!isCanonicalCandidateId(registration.candidate_id)) errors.push("candidate_id must be canonical CAND-* id");
  if (expectedCandidateId && registration.candidate_id !== expectedCandidateId) errors.push(`candidate_id must match expected candidate ${expectedCandidateId}`);
  if (!isIsoTimestamp(registration.registered_at)) errors.push("registered_at must be an exact ISO timestamp");
  if (!isCanonicalRunId(registration.registered_before_run_id)) errors.push("registered_before_run_id must be canonical RUN-* id");
  if (expectedRunId && registration.registered_before_run_id !== expectedRunId) errors.push(`registered_before_run_id must match expected run ${expectedRunId}`);
  if (!SHA256_PATTERN.test(String(registration.content_hash || ""))) errors.push("content_hash must be sha256");
  else if (registration.content_hash !== researchWfaPreregistrationContentHash(registration)) errors.push("content_hash does not match registration content");

  validateArtifactRef(registration.hypothesis_packet_ref, "hypothesis_packet_ref", errors, { rootDir, expectedSchemaVersion: "hypothesis_packet_v1" });
  if (!String(registration.hypothesis_packet_ref?.path || "").startsWith("factory/research/")) errors.push("hypothesis_packet_ref.path must be under factory/research/");
  const sourceRefs = Array.isArray(registration.source_record_refs) ? registration.source_record_refs : [];
  if (sourceRefs.length === 0) errors.push("source_record_refs must include at least one source record artifact");
  for (const [index, ref] of sourceRefs.entries()) {
    validateArtifactRef(ref, `source_record_refs[${index}]`, errors, { rootDir, expectedSchemaVersion: "research_source_record_v1" });
    if (!String(ref?.path || "").startsWith("factory/research/")) errors.push(`source_record_refs[${index}].path must be under factory/research/`);
  }

  if (!hasText(registration.mechanism_summary, 20)) errors.push("mechanism_summary must describe the pre-registered mechanism");
  if (!hasText(registration.instrument_scope, 3)) errors.push("instrument_scope is required");
  if (!hasText(registration.timeframe_candidate, 2)) errors.push("timeframe_candidate is required");
  if (!hasText(registration.strategy_family, 3)) errors.push("strategy_family is required");
  if (!hasText(registration.expected_trade_frequency, 3)) errors.push("expected_trade_frequency is required");
  if (!Array.isArray(registration.data_sources) || registration.data_sources.length === 0) errors.push("data_sources must be a non-empty array");
  if (!hasText(registration.cost_assumptions, 8)) errors.push("cost_assumptions is required");
  const invalidation = Array.isArray(registration.invalidation_criteria) ? registration.invalidation_criteria : [];
  if (invalidation.length < 2 || invalidation.some((item) => !hasText(item, 8))) errors.push("invalidation_criteria must include at least two concrete criteria");

  const wfaDesign = hasObject(registration.wfa_design) ? registration.wfa_design : null;
  if (!wfaDesign) errors.push("wfa_design is required");
  else if (!looksLikeCanonicalWfaConfigPath(wfaDesign.config_path)) errors.push("wfa_design.config_path must be canonical walk forward engine/strategies/<name>/wfa_config.yaml");

  const denominator = hasObject(registration.denominator_tracking) ? registration.denominator_tracking : {};
  const missingDenominatorFlags = REQUIRED_DENOMINATOR_FLAGS.filter((flag) => denominator[flag] !== true);
  if (missingDenominatorFlags.length > 0) errors.push(`denominator_tracking missing true flags: ${missingDenominatorFlags.join(", ")}`);

  const frozen = Array.isArray(registration.frozen_fields) ? registration.frozen_fields : [];
  const missingFrozen = REQUIRED_FROZEN_FIELDS.filter((field) => !frozen.includes(field));
  if (missingFrozen.length > 0) errors.push(`frozen_fields missing: ${missingFrozen.join(", ")}`);

  if (registration.invalid_if_added_after_results !== true) errors.push("invalid_if_added_after_results must be true");
  for (const flag of ["official_state_mutated", "official_evidence_index_mutated", "official_backlog_mutated", "official_leaderboard_mutated", "wfa_executed", "strategy_edge_claimed"]) {
    if (registration[flag] !== false) errors.push(`${flag} must be false`);
  }

  if (resultsKnownAt && isIsoTimestamp(registration.registered_at)) {
    const registeredAt = Date.parse(registration.registered_at);
    const resultsAt = Date.parse(resultsKnownAt);
    if (Number.isFinite(resultsAt) && registeredAt >= resultsAt) errors.push("registration is invalid because it was added after WFA results were known");
  }

  if (errors.length > 0) throw new Error(`Invalid research_wfa_preregistration_v1: ${errors.join("; ")}.`);
  return true;
}

export function buildResearchWfaPreregistration(input = {}) {
  const registration = {
    schema_version: RESEARCH_WFA_PREREGISTRATION_SCHEMA_VERSION,
    candidate_id: input.candidate_id,
    registered_at: input.registered_at ?? new Date().toISOString(),
    registered_before_run_id: input.registered_before_run_id,
    hypothesis_packet_ref: input.hypothesis_packet_ref,
    source_record_refs: input.source_record_refs,
    mechanism_summary: input.mechanism_summary,
    instrument_scope: input.instrument_scope,
    timeframe_candidate: input.timeframe_candidate,
    strategy_family: input.strategy_family,
    expected_trade_frequency: input.expected_trade_frequency,
    data_sources: input.data_sources,
    cost_assumptions: input.cost_assumptions,
    wfa_design: input.wfa_design,
    denominator_tracking: input.denominator_tracking,
    frozen_fields: input.frozen_fields,
    invalidation_criteria: input.invalidation_criteria,
    invalid_if_added_after_results: true,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    wfa_executed: false,
    strategy_edge_claimed: false
  };
  registration.content_hash = researchWfaPreregistrationContentHash(registration);
  validateResearchWfaPreregistration(registration);
  return registration;
}

export function writeResearchWfaPreregistration(paths, registration) {
  validateResearchWfaPreregistration(registration);
  const fullPath = path.join(paths.factory, "candidates", registration.candidate_id, "registrations", `research-wfa-${registration.registered_before_run_id}.json`);
  writeJsonAtomic(fullPath, registration, paths);
  return {
    artifact_type: RESEARCH_WFA_PREREGISTRATION_ARTIFACT_TYPE,
    path: repoRelative(paths.root, fullPath),
    sha256: sha256File(fullPath),
    content_hash: registration.content_hash
  };
}

export function validateResearchWfaPreregistrationArtifact(ref, { rootDir, expectedCandidateId = null, expectedRunId = null, resultsKnownAt = null } = {}) {
  if (!rootDir) throw new Error("rootDir is required to validate research_wfa_preregistration artifacts.");
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error("research_wfa_preregistration artifact ref must be an object.");
  if (ref.artifact_type !== RESEARCH_WFA_PREREGISTRATION_ARTIFACT_TYPE) throw new Error(`research_wfa_preregistration artifact_type must be ${RESEARCH_WFA_PREREGISTRATION_ARTIFACT_TYPE}.`);
  if (!SHA256_PATTERN.test(String(ref.sha256 || ""))) throw new Error("research_wfa_preregistration artifact ref must include valid sha256.");
  if (expectedCandidateId && !String(ref.path || "").startsWith(`factory/candidates/${expectedCandidateId}/registrations/`)) {
    throw new Error("research_wfa_preregistration artifact must be stored under the expected candidate registrations folder.");
  }
  const fullPath = resolveRepoRelativePath(rootDir, ref.path);
  if (!fs.existsSync(fullPath)) throw new Error(`research_wfa_preregistration artifact is missing: ${ref.path}`);
  const actualSha = sha256File(fullPath);
  if (actualSha !== ref.sha256) throw new Error("research_wfa_preregistration artifact sha256 mismatch.");
  const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  validateResearchWfaPreregistration(payload, { expectedCandidateId, expectedRunId, resultsKnownAt, rootDir });
  return payload;
}

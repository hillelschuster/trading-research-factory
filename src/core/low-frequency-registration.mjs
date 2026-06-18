import crypto from "crypto";
import fs from "fs";
import path from "path";
import { writeJsonAtomic } from "./fs-utils.mjs";

export const LOW_FREQUENCY_REGISTRATION_SCHEMA_VERSION = "low_frequency_registration_v1";
export const LOW_FREQUENCY_REGISTRATION_ARTIFACT_TYPE = "low_frequency_registration";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REQUIRED_EXTRA_CONTROLS = [
  "longer_history",
  "regime_diversity",
  "concentration_risk_checks",
  "drawdown_scrutiny",
  "hard_minimum_trade_floor",
  "no_after_the_fact_excuses"
];
const ALLOWED_FIELDS = new Set([
  "schema_version",
  "candidate_id",
  "registered_at",
  "registered_before_run_id",
  "content_hash",
  "expected_trade_count_class",
  "expected_trades_per_year",
  "expected_holding_period",
  "why_low_frequency_is_structural",
  "minimum_acceptable_trades",
  "required_extra_controls",
  "invalid_if_added_after_results"
]);

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
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

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

export function lowFrequencyRegistrationContentHash(registration) {
  const copy = { ...(registration ?? {}) };
  delete copy.content_hash;
  return crypto.createHash("sha256").update(JSON.stringify(sortJson(copy))).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoPath) {
  if (!hasText(repoPath, 3) || path.isAbsolute(repoPath)) throw new Error("low_frequency_registration artifact path must be repo-relative.");
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`low_frequency_registration artifact path escapes repository root: ${repoPath}`);
  return fullPath;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

export function validateLowFrequencyRegistration(registration, { expectedCandidateId = null, expectedRunId = null, resultsKnownAt = null } = {}) {
  const errors = [];
  if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
    throw new Error("low_frequency_registration must be an object.");
  }

  const unexpected = Object.keys(registration).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected.length > 0) errors.push(`unexpected fields: ${unexpected.join(", ")}`);
  if (registration.schema_version !== LOW_FREQUENCY_REGISTRATION_SCHEMA_VERSION) errors.push(`schema_version must be ${LOW_FREQUENCY_REGISTRATION_SCHEMA_VERSION}`);
  if (!isCanonicalCandidateId(registration.candidate_id)) errors.push("candidate_id must be canonical CAND-* id");
  if (expectedCandidateId && registration.candidate_id !== expectedCandidateId) errors.push(`candidate_id must match expected candidate ${expectedCandidateId}`);
  if (!isIsoTimestamp(registration.registered_at)) errors.push("registered_at must be an exact ISO timestamp");
  if (!isCanonicalRunId(registration.registered_before_run_id)) errors.push("registered_before_run_id must be canonical RUN-* id");
  if (expectedRunId && registration.registered_before_run_id !== expectedRunId) errors.push(`registered_before_run_id must match expected run ${expectedRunId}`);
  if (!SHA256_PATTERN.test(String(registration.content_hash || ""))) errors.push("content_hash must be sha256");
  else if (registration.content_hash !== lowFrequencyRegistrationContentHash(registration)) errors.push("content_hash does not match registration content");
  if (!hasText(registration.expected_trade_count_class, 3)) errors.push("expected_trade_count_class is required");
  if (typeof registration.expected_trades_per_year !== "number" || !Number.isFinite(registration.expected_trades_per_year) || registration.expected_trades_per_year <= 0) errors.push("expected_trades_per_year must be a positive number");
  if (!hasText(registration.expected_holding_period, 3)) errors.push("expected_holding_period is required");
  if (!hasText(registration.why_low_frequency_is_structural, 20)) errors.push("why_low_frequency_is_structural must explain the structural reason");
  if (!Number.isInteger(registration.minimum_acceptable_trades) || registration.minimum_acceptable_trades < 30 || registration.minimum_acceptable_trades >= 200) errors.push("minimum_acceptable_trades must be an integer from 30 to 199");
  const controls = Array.isArray(registration.required_extra_controls) ? registration.required_extra_controls : [];
  const missingControls = REQUIRED_EXTRA_CONTROLS.filter((control) => !controls.includes(control));
  if (missingControls.length > 0) errors.push(`required_extra_controls missing: ${missingControls.join(", ")}`);
  if (registration.invalid_if_added_after_results !== true) errors.push("invalid_if_added_after_results must be true");

  if (resultsKnownAt && isIsoTimestamp(registration.registered_at)) {
    const registeredAt = Date.parse(registration.registered_at);
    const resultsAt = Date.parse(resultsKnownAt);
    if (Number.isFinite(resultsAt) && registeredAt >= resultsAt) errors.push("registration is invalid because it was added after WFA results were known");
  }

  if (errors.length > 0) throw new Error(`Invalid low_frequency_registration_v1: ${errors.join("; ")}.`);
  return true;
}

export function buildLowFrequencyRegistration(input = {}) {
  const registration = {
    schema_version: LOW_FREQUENCY_REGISTRATION_SCHEMA_VERSION,
    candidate_id: input.candidate_id,
    registered_at: input.registered_at ?? new Date().toISOString(),
    registered_before_run_id: input.registered_before_run_id,
    expected_trade_count_class: input.expected_trade_count_class,
    expected_trades_per_year: input.expected_trades_per_year,
    expected_holding_period: input.expected_holding_period,
    why_low_frequency_is_structural: input.why_low_frequency_is_structural,
    minimum_acceptable_trades: input.minimum_acceptable_trades,
    required_extra_controls: input.required_extra_controls,
    invalid_if_added_after_results: true
  };
  registration.content_hash = lowFrequencyRegistrationContentHash(registration);
  validateLowFrequencyRegistration(registration);
  return registration;
}

export function writeLowFrequencyRegistration(paths, registration) {
  validateLowFrequencyRegistration(registration);
  const fullPath = path.join(paths.factory, "candidates", registration.candidate_id, "registrations", `low-frequency-${registration.registered_before_run_id}.json`);
  writeJsonAtomic(fullPath, registration, paths);
  return {
    artifact_type: LOW_FREQUENCY_REGISTRATION_ARTIFACT_TYPE,
    path: repoRelative(paths.root, fullPath),
    sha256: sha256File(fullPath),
    content_hash: registration.content_hash
  };
}

export function validateLowFrequencyRegistrationArtifact(ref, { rootDir, expectedCandidateId = null, expectedRunId = null, resultsKnownAt = null } = {}) {
  if (!rootDir) throw new Error("rootDir is required to validate low_frequency_registration artifacts.");
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error("low_frequency_registration artifact ref must be an object.");
  if (ref.artifact_type !== LOW_FREQUENCY_REGISTRATION_ARTIFACT_TYPE) throw new Error(`low_frequency_registration artifact_type must be ${LOW_FREQUENCY_REGISTRATION_ARTIFACT_TYPE}.`);
  if (!SHA256_PATTERN.test(String(ref.sha256 || ""))) throw new Error("low_frequency_registration artifact ref must include valid sha256.");
  if (expectedCandidateId && !String(ref.path || "").startsWith(`factory/candidates/${expectedCandidateId}/registrations/`)) {
    throw new Error("low_frequency_registration artifact must be stored under the expected candidate registrations folder.");
  }
  const fullPath = resolveRepoRelativePath(rootDir, ref.path);
  if (!fs.existsSync(fullPath)) throw new Error(`low_frequency_registration artifact is missing: ${ref.path}`);
  const actualSha = sha256File(fullPath);
  if (actualSha !== ref.sha256) throw new Error("low_frequency_registration artifact sha256 mismatch.");
  const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  validateLowFrequencyRegistration(payload, { expectedCandidateId, expectedRunId, resultsKnownAt });
  return payload;
}

export function validateLowFrequencyTradeFloorException(ref, { rootDir, expectedCandidateId, expectedRunId, resultsKnownAt, observedTrades = null } = {}) {
  const missing = [];
  if (!rootDir) missing.push("rootDir");
  if (!expectedCandidateId) missing.push("expectedCandidateId");
  if (!expectedRunId) missing.push("expectedRunId");
  if (!resultsKnownAt) missing.push("resultsKnownAt");
  if (missing.length > 0) {
    throw new Error(`low_frequency_registration exception requires ${missing.join(", ")}.`);
  }

  const registration = validateLowFrequencyRegistrationArtifact(ref, {
    rootDir,
    expectedCandidateId,
    expectedRunId,
    resultsKnownAt
  });
  if (observedTrades !== null && observedTrades !== undefined) {
    if (typeof observedTrades !== "number" || !Number.isFinite(observedTrades)) {
      throw new Error("observedTrades must be finite when validating low_frequency_registration exception.");
    }
    if (observedTrades < registration.minimum_acceptable_trades) {
      throw new Error(`observed trade count ${observedTrades} is below registered low-frequency minimum ${registration.minimum_acceptable_trades}.`);
    }
  }
  return {
    registration,
    minimum_trade_floor: registration.minimum_acceptable_trades,
    artifact: {
      artifact_type: ref.artifact_type,
      path: ref.path,
      sha256: ref.sha256,
      hash_verified: true
    }
  };
}

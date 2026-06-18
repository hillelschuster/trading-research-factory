import crypto from "crypto";
import fs from "fs";
import path from "path";

export const DATA_READINESS_MANIFEST_SCHEMA_VERSION = "data_readiness_manifest_v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function hasObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isValidUtc(value) {
  const ms = Date.parse(value);
  return hasText(value, 10) && Number.isFinite(ms) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) throw new Error(`data readiness artifact path must be repo-relative: ${String(repoRelativePath)}`);
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`data readiness artifact path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function validateArtifactRecord(record, label, { rootDir = null } = {}) {
  const errors = [];
  if (!hasObject(record)) return [`${label} artifact record is required`];
  if (!hasText(record.path)) errors.push(`${label} artifact path is required`);
  if (!SHA256_PATTERN.test(String(record.sha256 || ""))) errors.push(`${label} artifact sha256 is required and must be valid`);

  if (rootDir && hasText(record.path)) {
    try {
      const fullPath = resolveRepoRelativePath(rootDir, record.path);
      if (!fs.existsSync(fullPath)) {
        errors.push(`${label} artifact path is missing on disk: ${record.path}`);
      } else if (SHA256_PATTERN.test(String(record.sha256 || ""))) {
        const actual = sha256File(fullPath);
        if (actual !== record.sha256) errors.push(`${label} artifact sha256 mismatch: ${record.path}`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  return errors;
}

function validateCoverage(coverage) {
  const errors = [];
  if (!hasObject(coverage)) return ["coverage window is required"];
  if (!isValidUtc(coverage.start_utc)) errors.push("coverage.start_utc is required and must include UTC/offset time");
  if (!isValidUtc(coverage.end_utc)) errors.push("coverage.end_utc is required and must include UTC/offset time");
  if (isValidUtc(coverage.start_utc) && isValidUtc(coverage.end_utc) && Date.parse(coverage.end_utc) <= Date.parse(coverage.start_utc)) {
    errors.push("coverage.end_utc must be after coverage.start_utc");
  }
  if (typeof coverage.row_count !== "number" || !Number.isInteger(coverage.row_count) || coverage.row_count <= 0) errors.push("coverage.row_count must be a positive integer");
  if (!hasText(coverage.timezone, 1)) errors.push("coverage.timezone is required");
  return errors;
}

function validateGapReport(gapReport) {
  const errors = [];
  if (!hasObject(gapReport)) return ["gap_report is required"];
  if (gapReport.checked !== true) errors.push("gap_report.checked must be true");
  if (typeof gapReport.gap_count !== "number" || !Number.isInteger(gapReport.gap_count) || gapReport.gap_count < 0) errors.push("gap_report.gap_count must be a non-negative integer");
  if (!Array.isArray(gapReport.gaps)) errors.push("gap_report.gaps must be an array");
  return errors;
}

function validateFeatureLagRules(rules) {
  const errors = [];
  if (!Array.isArray(rules) || rules.length === 0) return ["feature_lag_rules must be a non-empty array"];
  for (const [index, rule] of rules.entries()) {
    if (!hasObject(rule)) {
      errors.push(`feature_lag_rules[${index}] must be an object`);
      continue;
    }
    if (!hasText(rule.field, 1)) errors.push(`feature_lag_rules[${index}].field is required`);
    if (!hasText(rule.lag, 1)) errors.push(`feature_lag_rules[${index}].lag is required`);
    if (!hasText(rule.rationale, 8)) errors.push(`feature_lag_rules[${index}].rationale is required`);
  }
  return errors;
}

function validateSurvivorship(survivorship) {
  const errors = [];
  if (!hasObject(survivorship)) return ["survivorship is required"];
  if (typeof survivorship.survivorship_bias_checked !== "boolean") errors.push("survivorship.survivorship_bias_checked must be boolean");
  if (!hasText(survivorship.universe_policy, 8)) errors.push("survivorship.universe_policy is required");
  return errors;
}

function validateWfaIntegration(wfaIntegration) {
  const errors = [];
  if (!hasObject(wfaIntegration)) return ["wfa_integration is required"];
  const paths = [...asArray(wfaIntegration.data_paths), ...asArray(wfaIntegration.data_manifest_paths)];
  if (paths.length === 0 || !paths.every((entry) => hasText(entry))) errors.push("wfa_integration requires data_paths or data_manifest_paths");
  return errors;
}

export function validateDataReadinessManifest(manifest, { rootDir = null } = {}) {
  const errors = [];
  if (!hasObject(manifest)) throw new Error("data_readiness manifest is missing or invalid.");

  if (manifest.schema_version !== DATA_READINESS_MANIFEST_SCHEMA_VERSION) errors.push(`schema_version must be ${DATA_READINESS_MANIFEST_SCHEMA_VERSION}`);
  if (manifest.evidence_kind !== "data_identity") errors.push("evidence_kind must be data_identity");
  if (!hasText(manifest.dataset_id, 3)) errors.push("dataset_id is required");
  if (!hasText(manifest.source_family, 3)) errors.push("source_family is required");
  if (!hasText(manifest.market, 3)) errors.push("market is required");
  if (!hasText(manifest.instrument, 3)) errors.push("instrument is required");
  if (!hasText(manifest.timeframe, 1)) errors.push("timeframe is required");

  if (!hasObject(manifest.source)) errors.push("source is required");
  else {
    if (!isHttpUrl(manifest.source.source_url)) errors.push("source.source_url is required and must be http(s)");
    if (!hasText(manifest.source.retrieved_at, 10)) errors.push("source.retrieved_at is required");
  }

  errors.push(...validateArtifactRecord(manifest.artifacts?.raw, "raw", { rootDir }));
  errors.push(...validateArtifactRecord(manifest.artifacts?.normalized, "normalized", { rootDir }));
  errors.push(...validateCoverage(manifest.coverage));
  errors.push(...validateGapReport(manifest.gap_report));
  errors.push(...validateFeatureLagRules(manifest.feature_lag_rules));
  errors.push(...validateSurvivorship(manifest.survivorship));
  errors.push(...validateWfaIntegration(manifest.wfa_integration));

  if (errors.length > 0) throw new Error(`data_readiness manifest validation failed: ${errors.join("; ")}`);
  return true;
}

export function readAndValidateDataReadinessManifest(manifestPath, { rootDir = process.cwd() } = {}) {
  const fullPath = resolveRepoRelativePath(rootDir, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  validateDataReadinessManifest(manifest, { rootDir });
  return manifest;
}

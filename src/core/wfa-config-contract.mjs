import fs from "fs";
import path from "path";

const CANONICAL_WFA_CONFIG_RE = /^walk forward engine\/strategies\/[^/]+\/wfa_config\.ya?ml$/i;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseYamlScalar(value) {
  const clean = cleanText(value);
  if (!clean) return null;
  if (/^null$/i.test(clean)) return null;
  if (/^(true|false)$/i.test(clean)) return /^true$/i.test(clean);
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(clean)) return Number(clean);
  const quoted = clean.match(/^(?:"([^"]*)"|'([^']*)')$/);
  return quoted ? quoted[1] ?? quoted[2] : clean;
}

export function parseSimpleYamlObject(text) {
  const root = {};
  const stack = [{ indent: -1, object: root }];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;
    const match = withoutComment.match(/^(\s*)([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2];
    const rawValue = match[3] ?? "";
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).object;
    if (rawValue.trim() === "") {
      parent[key] = {};
      stack.push({ indent, object: parent[key] });
    } else {
      parent[key] = parseYamlScalar(rawValue);
    }
  }
  return root;
}

export function isCanonicalWfaConfigPath(value) {
  return CANONICAL_WFA_CONFIG_RE.test(cleanText(value).replace(/\\/g, "/"));
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (!cleanText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`WFA path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`WFA path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

function nestedValue(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function requiredPositiveNumber(errors, config, fieldPath) {
  const value = nestedValue(config, fieldPath.split("."));
  if (!positiveNumber(value)) errors.push(`${fieldPath} must be a positive number`);
}

function requiredText(errors, config, fieldPath) {
  const value = nestedValue(config, fieldPath.split("."));
  if (!cleanText(value)) errors.push(`${fieldPath} is required`);
}

function optionalNonNegativeInteger(errors, config, fieldPath) {
  const value = nestedValue(config, fieldPath.split("."));
  if (value !== undefined && !nonNegativeInteger(value)) errors.push(`${fieldPath} must be a non-negative integer when provided`);
}

function addUtcMonths(date, months) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function parseCsvTimestamp(value) {
  const clean = cleanText(value);
  if (!clean) return null;
  if (/^\d+(?:\.\d+)?$/.test(clean)) {
    const numeric = Number(clean);
    const millis = numeric > 1e12 ? numeric : numeric * 1000;
    const parsedNumeric = new Date(millis);
    return Number.isFinite(parsedNumeric.getTime()) ? parsedNumeric : null;
  }
  const normalized = clean.includes("T") ? clean : clean.replace(" ", "T");
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withTimezone);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function resolveWfaDataSourcePath(rootDir, sourceFile) {
  const normalized = cleanText(sourceFile).replace(/\\/g, "/");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) return null;
  const repoRelative = normalized.startsWith("walk forward engine/") ? normalized : `walk forward engine/${normalized}`;
  try {
    return resolveRepoRelativePath(rootDir, repoRelative);
  } catch {
    return null;
  }
}

function firstWindowGeometryDiagnostics({ rootDir, config }) {
  const minBars = nestedValue(config, ["data", "min_required_bars"]);
  if (minBars === undefined || minBars === null) return null;
  if (!positiveInteger(minBars)) return { errors: ["data.min_required_bars must be a positive integer when provided"] };

  const trainingMonths = nestedValue(config, ["walk_forward", "training_months"]);
  const testingMonths = nestedValue(config, ["walk_forward", "testing_months"]);
  const sourceFile = nestedValue(config, ["data", "source_file"]);
  const dataPath = resolveWfaDataSourcePath(rootDir, sourceFile);
  if (!dataPath || !fs.existsSync(dataPath)) return null;

  const text = fs.readFileSync(dataPath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { errors: [`data.min_required_bars cannot be verified because data.source_file has no data rows: ${sourceFile}`] };

  const header = splitCsvLine(lines[0]).map((field) => cleanText(field).toLowerCase());
  const timestampIndex = header.findIndex((field) => ["timestamp", "date", "datetime", "time"].includes(field));
  if (timestampIndex < 0) return { errors: [`data.min_required_bars cannot be verified because data.source_file lacks a timestamp/date column: ${sourceFile}`] };

  const timestamps = [];
  for (const line of lines.slice(1)) {
    const parsed = parseCsvTimestamp(splitCsvLine(line)[timestampIndex]);
    if (parsed) timestamps.push(parsed);
  }
  if (timestamps.length < 2) return { errors: [`data.min_required_bars cannot be verified because data.source_file has fewer than two parseable timestamps: ${sourceFile}`] };
  timestamps.sort((a, b) => a.getTime() - b.getTime());

  const start = timestamps[0];
  const dataEnd = timestamps.at(-1);
  const trainingEnd = addUtcMonths(start, trainingMonths);
  const validationEnd = addUtcMonths(trainingEnd, testingMonths) > dataEnd ? dataEnd : addUtcMonths(trainingEnd, testingMonths);
  const purgeGapBars = nestedValue(config, ["walk_forward", "purge_gap_bars"]) ?? 0;

  const trainingBars = timestamps.filter((timestamp) => timestamp >= start && timestamp < trainingEnd).length;
  const rawValidationBars = validationEnd > trainingEnd
    ? timestamps.filter((timestamp) => timestamp >= trainingEnd && timestamp < validationEnd).length
    : 0;
  const validationBarsAfterPurge = Math.max(0, rawValidationBars - purgeGapBars);
  const errors = [];

  if (validationEnd <= trainingEnd) {
    errors.push(`WFA first-window geometry is impossible: no validation span remains after ${trainingMonths} training months and ${testingMonths} testing months in ${sourceFile}`);
  }
  if (trainingBars < minBars) {
    errors.push(`WFA first-window geometry is impossible: training_months=${trainingMonths} yields ${trainingBars} training bars, below data.min_required_bars=${minBars}`);
  }
  if (validationBarsAfterPurge < minBars) {
    errors.push(`WFA first-window geometry is impossible: testing_months=${testingMonths} yields ${validationBarsAfterPurge} validation bars after purge_gap_bars=${purgeGapBars}, below data.min_required_bars=${minBars}`);
  }

  return {
    errors,
    diagnostics: {
      data_source_file: sourceFile,
      first_timestamp: start.toISOString(),
      last_timestamp: dataEnd.toISOString(),
      training_months: trainingMonths,
      testing_months: testingMonths,
      purge_gap_bars: purgeGapBars,
      min_required_bars: minBars,
      first_training_bars: trainingBars,
      first_validation_bars_after_purge: validationBarsAfterPurge
    }
  };
}

export function readCanonicalWfaConfig(rootDir, wfaConfigPath) {
  const fullPath = resolveRepoRelativePath(rootDir, wfaConfigPath);
  return parseSimpleYamlObject(fs.readFileSync(fullPath, "utf8"));
}

export function normalizeWfaOutputRoot(outputDirectory) {
  const normalized = cleanText(outputDirectory).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized.startsWith("walk forward engine/") ? normalized : `walk forward engine/${normalized}`;
}

export function expectedWfaOutputRootFromConfig(rootDir, wfaConfigPath) {
  const config = readCanonicalWfaConfig(rootDir, wfaConfigPath);
  return normalizeWfaOutputRoot(nestedValue(config, ["walk_forward", "output_directory"]));
}

export function wfaTimeoutMsFromConfig(rootDir, wfaConfigPath) {
  try {
    const config = readCanonicalWfaConfig(rootDir, wfaConfigPath);
    const seconds = nestedValue(config, ["performance", "max_execution_time_seconds"]);
    return positiveNumber(seconds) ? seconds * 1000 : 60 * 60 * 1000;
  } catch {
    return 60 * 60 * 1000;
  }
}

export function validateCanonicalWfaConfig({ rootDir = process.cwd(), wfaConfigPath, expectedOutputRoot = null } = {}) {
  const normalizedPath = cleanText(wfaConfigPath).replace(/\\/g, "/");
  const errors = [];
  let config = {};

  if (!isCanonicalWfaConfigPath(normalizedPath)) {
    errors.push("wfa_config_path must be walk forward engine/strategies/<name>/wfa_config.yaml");
    return { valid: false, errors, config, expected_output_root: null };
  }

  try {
    const fullPath = resolveRepoRelativePath(rootDir, normalizedPath);
    if (!fs.existsSync(fullPath)) errors.push(`wfa_config_path missing on disk: ${normalizedPath}`);
    else config = parseSimpleYamlObject(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const fieldPath of ["walk_forward.training_months", "walk_forward.testing_months", "walk_forward.step_months", "walk_forward.n_parameter_trials", "performance.max_execution_time_seconds"]) {
    requiredPositiveNumber(errors, config, fieldPath);
  }
  for (const fieldPath of ["walk_forward.output_directory", "data.source_file", "strategy.profile_key"]) {
    requiredText(errors, config, fieldPath);
  }
  optionalNonNegativeInteger(errors, config, "walk_forward.purge_gap_bars");
  optionalNonNegativeInteger(errors, config, "walk_forward.indicator_warmup_bars");

  const geometry = errors.length === 0 ? firstWindowGeometryDiagnostics({ rootDir, config }) : null;
  if (geometry?.errors?.length) errors.push(...geometry.errors);

  const outputRoot = normalizeWfaOutputRoot(nestedValue(config, ["walk_forward", "output_directory"]));
  const strategyName = path.posix.basename(path.posix.dirname(normalizedPath));
  const canonicalOutputRoot = `walk forward engine/strategies/${strategyName}/results`;
  if (!outputRoot) {
    errors.push("walk_forward.output_directory must be a repo-relative output path");
  } else if (outputRoot !== canonicalOutputRoot) {
    errors.push(`walk_forward.output_directory must resolve to ${canonicalOutputRoot}; got ${outputRoot}`);
  }

  const normalizedExpected = expectedOutputRoot ? cleanText(expectedOutputRoot).replace(/\\/g, "/").replace(/\/+$/, "") : null;
  if (normalizedExpected && outputRoot && normalizedExpected !== outputRoot) {
    errors.push(`expected_output_root mismatch: request ${normalizedExpected} does not match config ${outputRoot}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    config,
    feasibility: geometry?.diagnostics ?? null,
    expected_output_root: outputRoot,
    canonical_output_root: canonicalOutputRoot
  };
}

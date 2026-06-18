import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPaths } from "../core/paths.mjs";
import { appendLine, ensureDir, writeJsonAtomic, writeTextAtomic } from "../core/fs-utils.mjs";
import { recordResearchWfaWorkerResultInRuntimeLedger } from "../core/runtime-ledger.mjs";
import { readAndValidateDataReadinessManifest } from "../core/data-readiness.mjs";
import { validateResearchWfaPreregistrationArtifact } from "../core/research-wfa-preregistration.mjs";
import { parseSimpleYamlObject, validateCanonicalWfaConfig } from "../core/wfa-config-contract.mjs";

const WORKER_NAME = "research_wfa_run";
const EVIDENCE_KIND = "research_wfa";
const AUTHORITY_LAYER = "python_research";
const REQUEST_SCHEMA_VERSION = "research_wfa_run_request_v1";
const WORKER_SCHEMA_VERSION = "research_wfa_run_worker_v1";
const WORKER_RELATIVE_PATH = "src/workers/research-wfa-run-worker.mjs";
const DEFAULT_ENV_ALLOWLIST = ["PATH", "Path", "PYTHONPATH", "VIRTUAL_ENV", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA"];

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function relativeToRoot(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) {
    throw new Error(`WFA path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`WFA path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

function artifactRecord(paths, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return { artifact_type: artifactType, path: relativeToRoot(paths, fullPath), sha256: sha256File(fullPath), size_bytes: stat.size, modified_at: stat.mtime.toISOString() };
}

function optionalArtifactRecord(paths, repoRelativePath, artifactType) {
  const fullPath = path.join(paths.root, repoRelativePath);
  if (!fs.existsSync(fullPath)) return null;
  return artifactRecord(paths, fullPath, artifactType);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isMeaningfulText(value) {
  return cleanText(value).length >= 3;
}

function isCandidateScoped(request) {
  return request?.candidate_scoped === true || cleanText(request?.candidate_scope).toLowerCase() === "candidate" || cleanText(request?.scope).toLowerCase() === "candidate";
}

function validateEnvironmentAllowlist(value) {
  if (!Array.isArray(value) || value.length === 0) return ["environment_allowlist must be a non-empty array"];
  const errors = [];
  for (const entry of value) {
    const name = cleanText(entry);
    if (!name) errors.push("environment_allowlist entries must be non-empty strings");
    else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) errors.push(`environment_allowlist entry is not an environment variable name: ${name}`);
  }
  return errors;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isCanonicalWfaConfig(value) {
  return /^walk forward engine\/strategies\/[^/]+\/wfa_config\.ya?ml$/i.test(cleanText(value));
}

function canonicalConfigRef(wfaConfigPath) {
  const prefix = "walk forward engine/";
  return wfaConfigPath.startsWith(prefix) ? wfaConfigPath.slice(prefix.length) : null;
}

function listFilesRecursive(fullPath) {
  if (!fs.existsSync(fullPath)) return [];
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) return [fullPath];
  if (!stat.isDirectory()) return [];
  const out = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child);
    }
  }
  walk(fullPath);
  return out.sort();
}

function snapshotPath(paths, repoRelativePath) {
  const fullPath = resolveRepoRelativePath(paths.root, repoRelativePath);
  return listFilesRecursive(fullPath).map((filePath) => artifactRecord(paths, filePath, "output_snapshot_file"));
}

function snapshotByPath(snapshot) {
  return new Map(snapshot.map((record) => [record.path, record]));
}

function changedOutputRecords(before, after) {
  const beforeMap = snapshotByPath(before);
  return after.filter((record) => {
    const prior = beforeMap.get(record.path);
    return !prior || prior.sha256 !== record.sha256 || prior.size_bytes !== record.size_bytes;
  });
}

const OPTIONAL_WFA_ARTIFACT_TYPES = [
  {
    key: "trade_ledger",
    artifactType: "wfa_trade_ledger",
    pattern: /(?:^|[_-])(?:trade|trades)(?:[_-]?(?:ledger|log|detail|details|execution|executions|orders?|fills?))?(?:[_-]|\.|$)/i,
    missingBecause: "No separate trade ledger artifact was emitted in accepted WFA outputs; summary or embedded aggregate trade fields are not counted as a separate ledger."
  },
  {
    key: "equity_curve",
    artifactType: "wfa_equity_curve",
    pattern: /(?:^|[_-])(?:equity|balance)(?:[_-]?(?:curve|series|path))?(?:[_-]|\.|$)/i,
    missingBecause: "No separate equity curve artifact was emitted in accepted WFA outputs; summary or embedded balance fields are not counted as a separate curve."
  },
  {
    key: "optimizer_trials",
    artifactType: "wfa_optimizer_trials",
    pattern: /(?:optimizer|optimization|optuna|trial|trials)[_-]?(?:trials?|results?|study|studies)|(?:^|[_-])trials?(?:[_-]|\.|$)/i,
    missingBecause: "No separate optimizer-trial artifact was emitted in accepted WFA outputs; selected parameters or parameter-stability summaries are not counted as trial ledgers."
  }
];

function optionalWfaArtifactDiagnostics(records) {
  const groups = Object.fromEntries(OPTIONAL_WFA_ARTIFACT_TYPES.map((type) => [type.key, []]));
  for (const record of records) {
    const fileName = path.basename(record.path || "");
    const type = OPTIONAL_WFA_ARTIFACT_TYPES.find((candidate) => candidate.pattern.test(fileName));
    if (type) groups[type.key].push({ ...record, artifact_type: type.artifactType });
  }

  return Object.fromEntries(OPTIONAL_WFA_ARTIFACT_TYPES.map((type) => {
    const artifacts = groups[type.key];
    return [type.key, {
      available: artifacts.length > 0,
      artifact_type: type.artifactType,
      artifacts,
      missing_because: artifacts.length > 0 ? null : type.missingBecause
    }];
  }));
}

function optionalWfaArtifactRecords(diagnostics) {
  return Object.values(diagnostics).flatMap((group) => group.available ? group.artifacts : []);
}

function requestIdentity(request) {
  return {
    run_id: request.run_id ?? null,
    job_id: request.job_id ?? null,
    candidate_id: request.candidate_id ?? null,
    lineage_id: request.lineage_id ?? null,
    family_id: request.family_id ?? null,
    attempt_id: request.attempt_id ?? null
  };
}

function withRequestIdentity(records, identity) {
  return records.map((record) => ({ ...record, request_identity: identity }));
}

function staleOutputGuard(records, startedAt) {
  const startedMs = Date.parse(startedAt);
  const stale = records.filter((record) => Date.parse(record.modified_at) + 1000 < startedMs);
  return {
    passed: stale.length === 0,
    checked_count: records.length,
    stale_paths: stale.map((record) => record.path)
  };
}

function readJsonSafe(fullPath) {
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return null;
  }
}

function nestedValue(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function hasArtifactBackedValue(value) {
  return value !== undefined && value !== null && (typeof value !== "number" || Number.isFinite(value));
}

function assumptionValue(value, artifact, sourceField) {
  return {
    value,
    source_path: artifact.path,
    source_sha256: artifact.sha256,
    source_field: sourceField
  };
}

function addFirstAssumption(out, key, sources) {
  if (Object.hasOwn(out, key)) return;
  for (const source of sources) {
    const value = nestedValue(source.object, source.path);
    if (hasArtifactBackedValue(value)) {
      out[key] = assumptionValue(value, source.artifact, source.source_field ?? source.path.join("."));
      return;
    }
  }
}

function configArtifactForRequest(paths, request) {
  if (!request?.wfa_config_path) return null;
  try {
    return artifactRecord(paths, resolveRepoRelativePath(paths.root, request.wfa_config_path), "wfa_config");
  } catch {
    return null;
  }
}

function readWfaConfigObject(paths, request) {
  if (!request?.wfa_config_path) return {};
  try {
    return parseSimpleYamlObject(fs.readFileSync(resolveRepoRelativePath(paths.root, request.wfa_config_path), "utf8"));
  } catch {
    return {};
  }
}

function assumptionGroup(values, missingBecause) {
  const keys = Object.keys(values);
  return {
    available: keys.length > 0,
    values,
    missing_because: keys.length > 0 ? null : missingBecause
  };
}

function assumptionsFromArtifacts(paths, request, metricsArtifact, metricsJson) {
  const wfaConfigArtifact = configArtifactForRequest(paths, request);
  const wfaConfig = readWfaConfigObject(paths, request);
  const resultConfig = metricsJson?.config && typeof metricsJson.config === "object" ? metricsJson.config : {};
  const resultSource = metricsArtifact ? { object: metricsJson ?? {}, artifact: metricsArtifact } : null;
  const resultConfigSource = metricsArtifact ? { object: resultConfig, artifact: metricsArtifact } : null;
  const configSource = wfaConfigArtifact ? { object: wfaConfig, artifact: wfaConfigArtifact } : null;
  const configSources = [resultConfigSource, configSource].filter(Boolean);
  const resultSources = [resultSource].filter(Boolean);

  const costValues = {};
  addFirstAssumption(costValues, "fees", [
    ...configSources.map((source) => source === resultConfigSource
      ? { ...source, path: ["fees"], source_field: "config.fees" }
      : { ...source, path: ["backtest", "fees"], source_field: "backtest.fees" })
  ]);
  addFirstAssumption(costValues, "slippage", [
    ...configSources.map((source) => source === resultConfigSource
      ? { ...source, path: ["slippage"], source_field: "config.slippage" }
      : { ...source, path: ["backtest", "slippage"], source_field: "backtest.slippage" })
  ]);

  const timingValues = {};
  for (const key of ["training_months", "testing_months", "step_months", "n_parameter_trials", "use_vectorized_backtest", "performance_mode"]) {
    addFirstAssumption(timingValues, key, [
      ...configSources.map((source) => source === resultConfigSource
        ? { ...source, path: [key], source_field: `config.${key}` }
        : { ...source, path: ["walk_forward", key], source_field: `walk_forward.${key}` })
    ]);
  }
  addFirstAssumption(timingValues, "max_execution_time_seconds", configSource ? [{ ...configSource, path: ["performance", "max_execution_time_seconds"], source_field: "performance.max_execution_time_seconds" }] : []);
  for (const key of ["execution_start_time", "execution_end_time", "total_execution_time_seconds"]) {
    addFirstAssumption(timingValues, key, resultSources.map((source) => ({ ...source, path: [key] })));
  }

  return {
    cost_assumptions: assumptionGroup(costValues, "No fees or slippage fields were found in the accepted WFA result config or WFA config artifact."),
    timing_assumptions: assumptionGroup(timingValues, "No walk-forward windowing, timeout, or execution timing fields were found in the accepted WFA result or WFA config artifacts.")
  };
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function metricsFromJson(value) {
  if (!value || typeof value !== "object") return null;
  const metrics = value.metrics && typeof value.metrics === "object" ? value.metrics : value;
  const totalWindows = firstNumber(metrics.total_windows, value.total_windows);
  const successfulWindows = firstNumber(metrics.successful_windows, value.successful_windows);
  const failedWindows = firstNumber(metrics.failed_windows, value.failed_windows, totalWindows !== null && successfulWindows !== null ? totalWindows - successfulWindows : null);
  return {
    sharpe_is: firstNumber(metrics.sharpe_is, metrics.aggregate_sharpe_is, metrics.in_sample_sharpe, metrics.aggregate_in_sample_sharpe, value.sharpe_is, value.aggregate_sharpe_is, value.in_sample_sharpe),
    sharpe_oos: firstNumber(metrics.sharpe_oos, metrics.aggregate_sharpe, value.aggregate_sharpe, metrics.aggregate_sharpe_ratio, value.aggregate_sharpe_ratio),
    in_sample_return_pct: firstNumber(metrics.in_sample_return_pct, metrics.aggregate_in_sample_return_pct, metrics.is_return_pct, value.in_sample_return_pct, value.aggregate_in_sample_return_pct),
    total_trades: firstNumber(metrics.total_trades, value.total_trades, metrics.aggregate_total_trades, value.aggregate_total_trades),
    max_drawdown: firstNumber(metrics.max_drawdown, metrics.max_drawdown_pct, value.max_drawdown_pct, metrics.aggregate_max_drawdown_pct, value.aggregate_max_drawdown_pct),
    profit_factor: firstNumber(metrics.profit_factor, value.profit_factor, metrics.aggregate_profit_factor, value.aggregate_profit_factor),
    win_rate: firstNumber(metrics.win_rate, value.win_rate, metrics.aggregate_win_rate, value.aggregate_win_rate),
    aggregate_return_pct: firstNumber(metrics.aggregate_return_pct, value.aggregate_return_pct, metrics.total_return_pct, value.total_return_pct),
    total_windows: totalWindows,
    successful_windows: successfulWindows,
    failed_windows: failedWindows
  };
}

function metricSource(metricsArtifact, sourceField) {
  if (!metricsArtifact) return null;
  return { source_path: metricsArtifact.path, source_sha256: metricsArtifact.sha256, source_field: sourceField };
}

function availableMetric(value, metricsArtifact, sourceField) {
  if (typeof value !== "number" || !Number.isFinite(value) || !metricsArtifact) {
    return { available: false, value: null, source: null };
  }
  return { available: true, value, source: metricSource(metricsArtifact, sourceField) };
}

function wfaMetricReadiness(parsed) {
  const metrics = parsed?.metrics ?? {};
  const metricsArtifact = parsed?.metrics_artifact ?? null;
  const sharpeIs = availableMetric(metrics.sharpe_is, metricsArtifact, "sharpe_is|aggregate_sharpe_is|in_sample_sharpe");
  const sharpeOos = availableMetric(metrics.sharpe_oos, metricsArtifact, "sharpe_oos|aggregate_sharpe|aggregate_sharpe_ratio");
  const oosReturn = availableMetric(metrics.aggregate_return_pct, metricsArtifact, "aggregate_return_pct|total_return_pct");
  const isReturn = availableMetric(metrics.in_sample_return_pct, metricsArtifact, "in_sample_return_pct|aggregate_in_sample_return_pct|is_return_pct");
  const missingWfe = [];
  if (!isReturn.available) missingWfe.push("artifact-backed aggregate in-sample return");
  if (!oosReturn.available) missingWfe.push("artifact-backed aggregate OOS return");
  if (isReturn.available && isReturn.value === 0) missingWfe.push("nonzero aggregate in-sample return");
  const wfeValue = missingWfe.length === 0 && isReturn.value !== 0 ? Number((oosReturn.value / Math.abs(isReturn.value)).toFixed(6)) : null;

  const successfulWindows = availableMetric(metrics.successful_windows, metricsArtifact, "successful_windows");
  const totalWindows = availableMetric(metrics.total_windows, metricsArtifact, "total_windows");
  const missingWfr = [];
  if (!successfulWindows.available) missingWfr.push("artifact-backed successful_windows");
  if (!totalWindows.available) missingWfr.push("artifact-backed total_windows");
  if (totalWindows.available && totalWindows.value <= 0) missingWfr.push("positive total_windows");
  const wfrValue = missingWfr.length === 0 ? Number((successfulWindows.value / totalWindows.value).toFixed(6)) : null;

  return {
    sharpe_is: sharpeIs.available ? { status: "available", value: sharpeIs.value, source: sharpeIs.source } : { status: "blocked_missing_input", value: null, missing_because: "No artifact-backed in-sample Sharpe field was found in accepted WFA metrics." },
    sharpe_oos: sharpeOos.available ? { status: "available", value: sharpeOos.value, source: sharpeOos.source } : { status: "blocked_missing_input", value: null, missing_because: "No artifact-backed OOS Sharpe field was found in accepted WFA metrics." },
    wfe: wfeValue !== null
      ? { status: "computed_artifact_backed", value: wfeValue, inputs: { in_sample_return_pct: isReturn, aggregate_return_pct: oosReturn } }
      : { status: "blocked_missing_inputs", value: null, missing_inputs: missingWfe, missing_because: `WFE not computed because accepted WFA metrics are missing ${missingWfe.join(" and ")}.` },
    wfr: wfrValue !== null
      ? { status: "computed_artifact_backed", value: wfrValue, inputs: { successful_windows: successfulWindows, total_windows: totalWindows } }
      : { status: "blocked_missing_inputs", value: null, missing_inputs: missingWfr, missing_because: `WFR not computed because accepted WFA metrics are missing ${missingWfr.join(" and ")}.` }
  };
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function perWindowMetricsFromJson(value) {
  const windowResults = Array.isArray(value?.window_results) ? value.window_results : [];
  return windowResults.map((windowResult) => {
    const hasBestParameters = Object.hasOwn(windowResult, "best_parameters") && windowResult.best_parameters !== null && windowResult.best_parameters !== undefined;
    const bestParametersValid = hasBestParameters && isPlainObject(windowResult.best_parameters);
    return {
      window_id: windowResult.window_id ?? null,
      success: windowResult.success ?? null,
      total_return_pct: firstNumber(windowResult.total_return_pct),
      in_sample_return_pct: firstNumber(windowResult.in_sample_return_pct),
      total_trades: firstNumber(windowResult.total_trades),
      sharpe_ratio: firstNumber(windowResult.sharpe_ratio),
      max_drawdown_pct: firstNumber(windowResult.max_drawdown_pct),
      purge_gap_bars: firstNumber(windowResult.purge_gap_bars),
      purged_validation_bars: firstNumber(windowResult.purged_validation_bars),
      best_parameters: bestParametersValid ? windowResult.best_parameters : null,
      best_parameters_malformed: hasBestParameters && !bestParametersValid
    };
  });
}

function optimizationTruthDiagnostics(value, metricsArtifact) {
  const truth = value?.optimization_truth;
  if (!truth || typeof truth !== "object") {
    return {
      status: "not_emitted",
      source: metricsArtifact ? metricSource(metricsArtifact, "optimization_truth") : null,
      missing_because: "Accepted WFA metrics artifact did not emit optimization_truth diagnostics."
    };
  }
  const errors = [];
  if (truth.active_parameter_optimizer !== "direct_optuna_tpe_study") errors.push("active_parameter_optimizer must be direct_optuna_tpe_study");
  if (truth.active_selection_objective !== "training_slice_sharpe_from__evaluate_parameter_combination") errors.push("active_selection_objective must identify the direct training-slice Sharpe objective");
  for (const field of ["multi_objective_optimizer_active", "transaction_cost_modeler_active", "cost_stress_tester_active"]) {
    if (truth[field] !== false) errors.push(`${field} must be false for accepted normal WFA metrics until that module is actually wired`);
  }
  if (!truth.active_cost_inputs || typeof truth.active_cost_inputs !== "object") errors.push("active_cost_inputs must be present");
  const modules = Array.isArray(truth.disconnected_modules) ? truth.disconnected_modules.join(" ") : "";
  for (const moduleName of ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]) {
    if (!modules.includes(moduleName)) errors.push(`disconnected_modules must mention ${moduleName}`);
  }
  return {
    status: errors.length === 0 ? "valid_artifact_backed" : "invalid_artifact_backed",
    source: metricsArtifact ? metricSource(metricsArtifact, "optimization_truth") : null,
    errors,
    truth
  };
}

function stableParamKey(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function parameterStabilityDiagnostics(perWindowMetrics, metricsArtifact) {
  const windows = Array.isArray(perWindowMetrics) ? perWindowMetrics : [];
  const malformedCount = windows.filter((windowMetric) => windowMetric?.best_parameters_malformed === true).length;
  const params = windows
    .map((windowMetric) => windowMetric?.best_parameters)
    .filter((value) => isPlainObject(value));
  const source = metricsArtifact ? metricSource(metricsArtifact, "window_results[].best_parameters") : null;

  if (malformedCount > 0) {
    return {
      status: "invalid_artifact_backed",
      source,
      windows_with_parameters: params.length,
      malformed_parameter_windows: malformedCount,
      unique_parameter_sets: 0,
      missing_because: "Accepted WFA metrics emitted malformed per-window best_parameters; expected JSON objects only."
    };
  }

  if (windows.length === 0) {
    return {
      status: "blocked_missing_inputs",
      source,
      windows_with_parameters: 0,
      unique_parameter_sets: 0,
      missing_because: "No artifact-backed per-window metrics were available for parameter-stability diagnostics."
    };
  }
  if (params.length === 0) {
    return {
      status: "missing_parameter_artifacts",
      source,
      windows_with_parameters: 0,
      unique_parameter_sets: 0,
      missing_because: "Accepted WFA metrics did not emit per-window best_parameters; parameter stability remains unproven."
    };
  }

  const keys = params.map(stableParamKey);
  const uniqueParameterSets = new Set(keys);
  const baseline = keys[0];
  const changedWindowCount = keys.filter((key) => key !== baseline).length;
  const status = params.length < windows.length
    ? "partial_parameter_artifacts"
    : uniqueParameterSets.size === 1
      ? "stable_reported_parameters"
      : "parameter_instability_flagged";

  return {
    status,
    source,
    windows_with_parameters: params.length,
    total_reported_windows: windows.length,
    unique_parameter_sets: uniqueParameterSets.size,
    changed_window_count: changedWindowCount,
    note: "Parameter stability is diagnostic only; it is not a promotion, rejection, or statistical-confidence gate."
  };
}

function warmupDiagnostics(value, metricsArtifact) {
  const diagnostics = value?.warmup_diagnostics;
  const source = metricsArtifact ? metricSource(metricsArtifact, "warmup_diagnostics") : null;
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    return {
      status: "not_emitted",
      source,
      missing_because: "Accepted WFA metrics artifact did not emit warmup_diagnostics; no indicator warmup application is assumed."
    };
  }

  const errors = [];
  if (diagnostics.status !== "diagnostic_only") errors.push("warmup_diagnostics.status must be diagnostic_only");
  if (diagnostics.applied_to_window_boundaries !== false) errors.push("indicator_warmup_bars must not claim application to WFA window boundaries");
  if (typeof diagnostics.indicator_warmup_bars !== "number" || !Number.isInteger(diagnostics.indicator_warmup_bars) || diagnostics.indicator_warmup_bars < 0) {
    errors.push("indicator_warmup_bars must be a non-negative integer diagnostic");
  }

  return {
    status: errors.length === 0 ? "diagnostic_only_not_applied" : "invalid_artifact_backed",
    source,
    errors,
    diagnostics,
    note: "indicator_warmup_bars is recorded as metadata only; current Phase 8C WFA does not apply generic indicator warmup to window boundaries."
  };
}

function parseAcceptedWfaOutputs(paths, outputRecords, request) {
  const jsonRecords = outputRecords.filter((record) => /\.json$/i.test(record.path));
  const preferred = [...jsonRecords].sort((left, right) => {
    const score = (record) => /analysis\.json$/i.test(record.path) ? 0 : /walk_forward_results_/i.test(record.path) ? 1 : 2;
    return score(left) - score(right);
  });

  const candidates = [];
  for (const record of preferred) {
    const parsed = readJsonSafe(resolveRepoRelativePath(paths.root, record.path));
    const metrics = metricsFromJson(parsed);
    if (!metrics) continue;
    const hasCoreMetric = [metrics.sharpe_oos, metrics.total_trades, metrics.max_drawdown].some((value) => typeof value === "number" && Number.isFinite(value));
    if (!hasCoreMetric) continue;
    candidates.push({
      metrics,
      per_window_metrics: perWindowMetricsFromJson(parsed),
      metrics_artifact: record,
      assumptions: assumptionsFromArtifacts(paths, request, record, parsed),
      optimization_truth: optimizationTruthDiagnostics(parsed, record),
      warmup_diagnostics: warmupDiagnostics(parsed, record)
    });
  }

  return candidates.sort((left, right) => right.per_window_metrics.length - left.per_window_metrics.length)[0]
    ?? { metrics: {}, per_window_metrics: [], metrics_artifact: null, assumptions: assumptionsFromArtifacts(paths, request, null, null), optimization_truth: optimizationTruthDiagnostics(null, null), warmup_diagnostics: warmupDiagnostics(null, null) };
}

function buildEnv(allowlist) {
  const names = unique([...DEFAULT_ENV_ALLOWLIST, ...asArray(allowlist).map(cleanText)]);
  const env = {};
  for (const name of names) {
    if (Object.hasOwn(process.env, name)) env[name] = process.env[name];
  }
  return env;
}

function validateRepoPathList(paths, values, label) {
  const errors = [];
  for (const value of asArray(values)) {
    try {
      const fullPath = resolveRepoRelativePath(paths.root, value);
      if (!fs.existsSync(fullPath)) errors.push(`${label} missing on disk: ${value}`);
    } catch (error) {
      errors.push(`${label} invalid: ${error.message}`);
    }
  }
  return errors;
}

function preregistrationRefFromRequest(request) {
  return request?.research_wfa_preregistration
    ?? request?.research_wfa_preregistration_artifact
    ?? request?.research_wfa_preregistration_ref
    ?? null;
}

export function validateResearchWfaRunRequest(request, { rootDir = process.cwd() } = {}) {
  const paths = buildPaths(rootDir);
  const errors = [];
  if (!request || typeof request !== "object") errors.push("request must be an object");
  if (request?.schema_version !== REQUEST_SCHEMA_VERSION) errors.push(`schema_version must be ${REQUEST_SCHEMA_VERSION}`);
  if (request?.evidence_kind !== EVIDENCE_KIND) errors.push("evidence_kind must be research_wfa");
  if (request?.authority_layer !== AUTHORITY_LAYER) errors.push("authority_layer must be python_research");
  for (const field of ["run_id", "job_id", "lineage_id", "family_id", "attempt_id", "attempt_type", "wfa_config_path", "expected_output_root", "working_directory", "python_executable"]) {
    if (!cleanText(request?.[field])) errors.push(`${field} is required`);
  }
  if (request?.candidate_id !== null && request?.candidate_id !== undefined && !isMeaningfulText(request.candidate_id)) errors.push("candidate_id must be null or a meaningful identifier");
  if (isCandidateScoped(request) && !isMeaningfulText(request?.candidate_id)) errors.push("candidate-scoped WFA requests require candidate_id");
  if (cleanText(request?.working_directory) !== "walk forward engine") errors.push("working_directory must be walk forward engine");
  if (!isCanonicalWfaConfig(request?.wfa_config_path)) errors.push("wfa_config_path must be canonical walk forward engine/strategies/<name>/wfa_config.yaml");
  if (!cleanText(request?.expected_output_root).startsWith("walk forward engine/")) errors.push("expected_output_root must be under walk forward engine/");
  if (!Array.isArray(request?.strategy_source_paths) || request.strategy_source_paths.length === 0) errors.push("strategy_source_paths must be non-empty");
  if (!Array.isArray(request?.strategy_config_paths) || request.strategy_config_paths.length === 0) errors.push("strategy_config_paths must be non-empty");
  const dataInputs = [...asArray(request?.data_paths), ...asArray(request?.data_manifest_paths)];
  if (dataInputs.length === 0) errors.push("data_paths or data_manifest_paths must be non-empty");
  if (typeof request?.timeout_ms !== "number" || !Number.isFinite(request.timeout_ms) || request.timeout_ms <= 0) errors.push("timeout_ms must be a positive number");
  errors.push(...validateEnvironmentAllowlist(request?.environment_allowlist));

  if (request && typeof request === "object") {
    errors.push(...validateRepoPathList(paths, [request.wfa_config_path], "wfa_config_path"));
    errors.push(...validateRepoPathList(paths, request.strategy_source_paths, "strategy_source_path"));
    errors.push(...validateRepoPathList(paths, request.strategy_config_paths, "strategy_config_path"));
    errors.push(...validateRepoPathList(paths, request.data_paths, "data_path"));
    errors.push(...validateRepoPathList(paths, request.data_manifest_paths, "data_manifest_path"));
    for (const manifestPath of asArray(request.data_manifest_paths)) {
      try {
        readAndValidateDataReadinessManifest(manifestPath, { rootDir: paths.root });
      } catch (error) {
        errors.push(`data_manifest_path not consumable: ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      resolveRepoRelativePath(paths.root, request.expected_output_root);
    } catch (error) {
      errors.push(`expected_output_root invalid: ${error.message}`);
    }
    const configValidation = validateCanonicalWfaConfig({ rootDir: paths.root, wfaConfigPath: request.wfa_config_path, expectedOutputRoot: request.expected_output_root });
    if (!configValidation.valid) {
      errors.push(...configValidation.errors.map((message) => `wfa_config_contract: ${message}`));
    }
    const preregistrationRef = preregistrationRefFromRequest(request);
    if (preregistrationRef) {
      try {
        validateResearchWfaPreregistrationArtifact(preregistrationRef, {
          rootDir: paths.root,
          expectedCandidateId: isMeaningfulText(request.candidate_id) ? request.candidate_id : null,
          expectedRunId: request.run_id
        });
      } catch (error) {
        errors.push(`research_wfa_preregistration not consumable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (errors.length > 0) throw new Error(`research_wfa_run request validation failed: ${errors.join("; ")}`);
  return true;
}

function buildOutputRootTruth(paths, request) {
  const validation = validateCanonicalWfaConfig({ rootDir: paths.root, wfaConfigPath: request?.wfa_config_path, expectedOutputRoot: request?.expected_output_root });
  return {
    matched: validation.valid,
    expected_output_root: cleanText(request?.expected_output_root).replace(/\\/g, "/").replace(/\/+$/, "") || null,
    config_output_root: validation.expected_output_root,
    canonical_output_root: validation.canonical_output_root,
    errors: validation.errors
  };
}

function sourceHashRecords(paths, request) {
  const sourceRecords = [optionalArtifactRecord(paths, WORKER_RELATIVE_PATH, "worker_source")].filter(Boolean);
  sourceRecords.push(...[request.wfa_config_path].map((artifactPath) => artifactRecord(paths, resolveRepoRelativePath(paths.root, artifactPath), "wfa_config")));
  sourceRecords.push(...asArray(request.strategy_source_paths).map((artifactPath) => artifactRecord(paths, resolveRepoRelativePath(paths.root, artifactPath), "strategy_source")));
  sourceRecords.push(...asArray(request.strategy_config_paths).map((artifactPath) => artifactRecord(paths, resolveRepoRelativePath(paths.root, artifactPath), "strategy_config")));
  sourceRecords.push(...asArray(request.data_paths).map((artifactPath) => artifactRecord(paths, resolveRepoRelativePath(paths.root, artifactPath), "data_input")));
  sourceRecords.push(...asArray(request.data_manifest_paths).map((artifactPath) => artifactRecord(paths, resolveRepoRelativePath(paths.root, artifactPath), "data_manifest")));
  const preregistrationRef = preregistrationRefFromRequest(request);
  if (preregistrationRef?.path) sourceRecords.push(artifactRecord(paths, resolveRepoRelativePath(paths.root, preregistrationRef.path), "research_wfa_preregistration"));
  return sourceRecords;
}

function buildTrialAttempt({ request, status, startedAt, endedAt, failureCode, reason, inputHashes, outputRefs }) {
  return {
    trial_id: request.trial_id ?? `${request.run_id}:${request.attempt_id}`,
    run_id: request.run_id,
    job_id: request.job_id,
    candidate_id: request.candidate_id ?? null,
    lineage_id: request.lineage_id ?? null,
    family_id: request.family_id ?? null,
    attempt_id: request.attempt_id,
    parent_attempt_id: request.parent_attempt_id ?? null,
    attempt_type: request.attempt_type,
    generated_by: request.generated_by ?? WORKER_NAME,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    failure_code: failureCode,
    reason,
    input_hashes: inputHashes,
    output_refs: outputRefs
  };
}

function buildExecutionResult({ request, workerResult, artifacts, metrics, observations, provenance, blockedReason, errors }) {
  const common = {
    experiment_id: request.experiment_id ?? `EXP-${request.run_id}`,
    candidate_id: request.candidate_id ?? null,
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    observed_at: workerResult.observed_at,
    artifacts_created: artifacts,
    metrics_observed: metrics ?? {},
    observations,
    blocked_reason: blockedReason,
    source_hashes: workerResult.source_hashes,
    worker_result: workerResult
  };
  if (workerResult.status === "succeeded") return { ...common, status: "executed", blocked_reason: null, provenance };
  return { ...common, status: workerResult.status, blockers: blockedReason ? [blockedReason] : [], errors };
}

export function runResearchWfaRunWorker({ rootDir = process.cwd(), request } = {}) {
  const paths = buildPaths(rootDir);
  const startedAt = new Date().toISOString();
  const effectiveRequest = { ...request };
  const runDir = path.join(paths.runs, cleanText(effectiveRequest.run_id) || `RUN-RESEARCH-WFA-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`);
  const workerDir = path.join(runDir, "worker-results");
  ensureDir(workerDir, paths);

  const requestPath = path.join(workerDir, "research-wfa-run-request.json");
  writeJsonAtomic(requestPath, effectiveRequest, paths);

  let blockedReason = null;
  let validationError = null;
  try {
    validateResearchWfaRunRequest(effectiveRequest, { rootDir: paths.root });
  } catch (error) {
    validationError = error;
    blockedReason = error.message;
  }

  const stdoutPath = path.join(workerDir, "research-wfa-run-stdout.txt");
  const stderrPath = path.join(workerDir, "research-wfa-run-stderr.txt");
  let stdout = "";
  let stderr = "";
  let spawnResult = null;
  let timedOut = false;
  let preRunSnapshot = [];
  let postRunSnapshot = [];
  let acceptedOutputs = [];
  let parsed = { metrics: {}, per_window_metrics: [], metrics_artifact: null, assumptions: assumptionsFromArtifacts(paths, effectiveRequest, null, null), optimization_truth: optimizationTruthDiagnostics(null, null), warmup_diagnostics: warmupDiagnostics(null, null) };
  let metricReadiness = wfaMetricReadiness(parsed);
  let parameterStability = parameterStabilityDiagnostics([], null);
  let optionalWfaArtifacts = optionalWfaArtifactDiagnostics([]);
  let inputHashes = [];
  let failureCode = null;
  const identity = requestIdentity(effectiveRequest);
  let freshnessGuard = staleOutputGuard([], startedAt);
  const outputRootTruth = buildOutputRootTruth(paths, effectiveRequest);

  if (!blockedReason) {
    inputHashes = sourceHashRecords(paths, effectiveRequest);
    preRunSnapshot = snapshotPath(paths, effectiveRequest.expected_output_root);
    const configRef = canonicalConfigRef(effectiveRequest.wfa_config_path);
    const commandArgs = ["scripts/walk_forward_smoke_test.py", "--config", configRef];
    const cwd = path.join(paths.root, "walk forward engine");
    spawnResult = spawnSync(effectiveRequest.python_executable, commandArgs, {
      cwd,
      env: buildEnv(effectiveRequest.environment_allowlist),
      encoding: "utf8",
      timeout: effectiveRequest.timeout_ms,
      maxBuffer: effectiveRequest.max_buffer_bytes ?? 20 * 1024 * 1024,
      windowsHide: true
    });
    stdout = spawnResult.stdout ?? "";
    stderr = spawnResult.stderr ?? "";
    timedOut = spawnResult.error?.code === "ETIMEDOUT" || spawnResult.signal === "SIGTERM";
    postRunSnapshot = snapshotPath(paths, effectiveRequest.expected_output_root);
    acceptedOutputs = withRequestIdentity(changedOutputRecords(preRunSnapshot, postRunSnapshot), identity);
    optionalWfaArtifacts = optionalWfaArtifactDiagnostics(acceptedOutputs);
    freshnessGuard = staleOutputGuard(acceptedOutputs, startedAt);
    parsed = parseAcceptedWfaOutputs(paths, acceptedOutputs, effectiveRequest);
    metricReadiness = wfaMetricReadiness(parsed);
    parameterStability = parameterStabilityDiagnostics(parsed.per_window_metrics, parsed.metrics_artifact);

    if (timedOut) {
      failureCode = "wfa_timeout";
      blockedReason = `WFA worker timed out after ${effectiveRequest.timeout_ms}ms.`;
    } else if (spawnResult.error) {
      failureCode = "wfa_spawn_error";
      blockedReason = `WFA worker spawn failed: ${spawnResult.error.message}`;
    } else if (spawnResult.status !== 0) {
      failureCode = "wfa_nonzero_exit";
      blockedReason = `WFA subprocess exited non-zero: ${spawnResult.status}.`;
    } else if (acceptedOutputs.length === 0) {
      failureCode = "wfa_missing_fresh_outputs";
      blockedReason = "WFA subprocess produced no fresh accepted output artifacts.";
    } else if (!freshnessGuard.passed) {
      failureCode = "wfa_stale_output_artifact";
      blockedReason = `WFA subprocess accepted stale output artifacts: ${freshnessGuard.stale_paths.join(", ")}.`;
    } else if (!parsed.metrics_artifact) {
      failureCode = "wfa_missing_metrics_artifact";
      blockedReason = "WFA subprocess produced no parseable artifact-backed metrics JSON.";
    } else if (!parsed.metrics.successful_windows || parsed.metrics.successful_windows < 1) {
      failureCode = "wfa_zero_completed_windows";
      blockedReason = "WFA produced zero successful walk-forward windows.";
    } else if (!parsed.metrics.total_trades || parsed.metrics.total_trades < 1) {
      failureCode = "wfa_zero_trades";
      blockedReason = "WFA produced zero trades; preserving attempt as inconclusive evidence, not accepted executed evidence.";
    } else if (parsed.per_window_metrics.length < 1) {
      failureCode = "wfa_missing_per_window_metrics";
      blockedReason = "WFA subprocess produced no artifact-backed per-window metrics.";
    } else if (parsed.optimization_truth?.status === "invalid_artifact_backed") {
      failureCode = "wfa_invalid_optimization_truth";
      blockedReason = `WFA optimization_truth diagnostics contradict accepted normal WFA metrics: ${parsed.optimization_truth.errors.join("; ")}.`;
    } else if (parsed.warmup_diagnostics?.status === "invalid_artifact_backed") {
      failureCode = "wfa_invalid_warmup_diagnostics";
      blockedReason = `WFA warmup_diagnostics contradict Phase 8C diagnostic-only warmup handling: ${parsed.warmup_diagnostics.errors.join("; ")}.`;
    } else if (parameterStability?.status === "invalid_artifact_backed") {
      failureCode = "wfa_invalid_parameter_stability";
      blockedReason = `WFA parameter_stability diagnostics found malformed accepted parameter artifacts: ${parameterStability.missing_because}`;
    }
  }

  writeTextAtomic(stdoutPath, stdout, paths);
  writeTextAtomic(stderrPath, stderr, paths);
  const endedAt = new Date().toISOString();
  const durationMs = Date.parse(endedAt) - Date.parse(startedAt);

  const preSnapshotPath = path.join(workerDir, "pre-run-output-snapshot.json");
  const postSnapshotPath = path.join(workerDir, "post-run-output-snapshot.json");
  const acceptedOutputsPath = path.join(workerDir, "accepted-output-artifacts.json");
  const parsedMetricsPath = path.join(workerDir, "parsed-wfa-metrics.json");
  writeJsonAtomic(preSnapshotPath, preRunSnapshot, paths);
  writeJsonAtomic(postSnapshotPath, postRunSnapshot, paths);
  writeJsonAtomic(acceptedOutputsPath, acceptedOutputs, paths);
  writeJsonAtomic(parsedMetricsPath, { metrics: parsed.metrics, per_window_metrics: parsed.per_window_metrics, metrics_artifact: parsed.metrics_artifact, assumptions: parsed.assumptions, optional_wfa_artifacts: optionalWfaArtifacts, metric_readiness: metricReadiness, parameter_stability: parameterStability, optimization_truth: parsed.optimization_truth, warmup_diagnostics: parsed.warmup_diagnostics }, paths);

  const stdoutRecord = artifactRecord(paths, stdoutPath, "stdout");
  const stderrRecord = artifactRecord(paths, stderrPath, "stderr");
  const controlArtifacts = [
    artifactRecord(paths, requestPath, "worker_request"),
    stdoutRecord,
    stderrRecord,
    artifactRecord(paths, preSnapshotPath, "pre_run_output_snapshot"),
    artifactRecord(paths, postSnapshotPath, "post_run_output_snapshot"),
    artifactRecord(paths, acceptedOutputsPath, "accepted_output_manifest"),
    artifactRecord(paths, parsedMetricsPath, "parsed_wfa_metrics")
  ];
  const outputArtifacts = acceptedOutputs.map((record) => ({ ...record, artifact_type: "wfa_result_artifact" }));
  const allArtifacts = [...controlArtifacts, ...outputArtifacts, ...optionalWfaArtifactRecords(optionalWfaArtifacts)];

  const status = !blockedReason ? "succeeded" : failureCode === "wfa_zero_trades" ? "inconclusive" : validationError || failureCode?.startsWith("wfa_missing") || failureCode === "wfa_zero_completed_windows" || failureCode === "wfa_invalid_optimization_truth" || failureCode === "wfa_invalid_warmup_diagnostics" || failureCode === "wfa_invalid_parameter_stability" ? "blocked" : "failed";
  const observations = {
    candidate_id: effectiveRequest.candidate_id ?? null,
    canonical_wfa_config_path: effectiveRequest.wfa_config_path ?? null,
    execution_was_run_by_this_worker: Boolean(spawnResult),
    worker_start_time: startedAt,
    worker_end_time: endedAt,
    duration_ms: durationMs,
    timed_out: timedOut,
    exit_code: spawnResult?.status ?? null,
    signal: spawnResult?.signal ?? null,
    stdout_path: stdoutRecord.path,
    stderr_path: stderrRecord.path,
    accepted_output_count: acceptedOutputs.length,
    metrics_artifact_path: parsed.metrics_artifact?.path ?? null,
    per_window_metrics_count: parsed.per_window_metrics.length,
    expected_output_root: effectiveRequest.expected_output_root ?? null,
    output_root_truth: outputRootTruth,
    metric_readiness: metricReadiness,
    parameter_stability: parameterStability,
    cost_assumptions: parsed.assumptions.cost_assumptions,
    optimization_truth: parsed.optimization_truth,
    warmup_diagnostics: parsed.warmup_diagnostics,
    timing_assumptions: parsed.assumptions.timing_assumptions,
    optional_wfa_artifacts: optionalWfaArtifacts,
    research_wfa_preregistration: preregistrationRefFromRequest(effectiveRequest),
    request_identity: identity,
    stale_output_guard: freshnessGuard,
    zero_trade_policy: failureCode === "wfa_zero_trades" ? "preserved_as_inconclusive_not_executed" : null
  };
  const provenance = status === "succeeded" ? {
    engine: "walk_forward_engine",
    command: `${effectiveRequest.python_executable} scripts/walk_forward_smoke_test.py --config ${canonicalConfigRef(effectiveRequest.wfa_config_path)}`,
    working_directory: "walk forward engine",
    python_executable: effectiveRequest.python_executable,
    config_path: effectiveRequest.wfa_config_path,
    result_artifacts: unique([parsed.metrics_artifact?.path, ...outputArtifacts.map((record) => record.path), relativeToRoot(paths, parsedMetricsPath)]),
    parsed_metrics_path: relativeToRoot(paths, parsedMetricsPath),
    per_window_metrics_path: relativeToRoot(paths, parsedMetricsPath),
    windows_completed: parsed.metrics.successful_windows,
    windows_failed: parsed.metrics.failed_windows ?? null,
    total_trades: parsed.metrics.total_trades,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    timeout_ms: effectiveRequest.timeout_ms,
    timed_out: timedOut,
    exit_code: spawnResult?.status ?? null,
    stdout_path: stdoutRecord.path,
    stderr_path: stderrRecord.path,
    pre_run_snapshot_path: relativeToRoot(paths, preSnapshotPath),
    accepted_outputs_path: relativeToRoot(paths, acceptedOutputsPath),
    stale_output_guard: freshnessGuard,
    request_identity: identity
  } : null;

  const trialAttempt = buildTrialAttempt({
    request: effectiveRequest,
    status,
    startedAt,
    endedAt,
    failureCode,
    reason: blockedReason,
    inputHashes,
    outputRefs: allArtifacts.map((record) => ({ path: record.path, artifact_type: record.artifact_type, sha256: record.sha256 }))
  });
  const trialAttemptPath = path.join(runDir, "trial-attempts.jsonl");
  appendLine(trialAttemptPath, JSON.stringify(trialAttempt), paths);
  const trialAttemptArtifact = artifactRecord(paths, trialAttemptPath, "trial_attempt_record");

  const workerResult = {
    job_id: effectiveRequest.job_id ?? null,
    run_id: effectiveRequest.run_id ?? null,
    candidate_id: effectiveRequest.candidate_id ?? null,
    worker: WORKER_NAME,
    evidence_kind: EVIDENCE_KIND,
    authority_layer: AUTHORITY_LAYER,
    schema_version: WORKER_SCHEMA_VERSION,
    status,
    lineage_id: effectiveRequest.lineage_id ?? null,
    family_id: effectiveRequest.family_id ?? null,
    attempt_id: effectiveRequest.attempt_id ?? null,
    attempt_type: effectiveRequest.attempt_type ?? null,
    artifacts: [...allArtifacts, trialAttemptArtifact],
    metrics: parsed.metrics ?? {},
    observations,
    observed_at: endedAt,
    blocked_reason: blockedReason,
    source_hashes: inputHashes,
    diagnostics: { error_code: failureCode, message: blockedReason, stdout_path: stdoutRecord.path, stderr_path: stderrRecord.path },
    environment: { node_version: process.version, platform: process.platform, arch: process.arch }
  };
  const workerResultPath = path.join(workerDir, "research-wfa-run-worker-result.json");
  writeJsonAtomic(workerResultPath, workerResult, paths);

  const executionResult = buildExecutionResult({
    request: effectiveRequest,
    workerResult,
    artifacts: workerResult.artifacts,
    metrics: parsed.metrics,
    observations,
    provenance,
    blockedReason,
    errors: blockedReason ? [{ command: "research_wfa_run_worker", message: blockedReason }] : []
  });
  const executionResultPath = path.join(runDir, "execution-result.json");
  writeJsonAtomic(executionResultPath, executionResult, paths);

  recordResearchWfaWorkerResultInRuntimeLedger({
    rootDir: paths.root,
    request: effectiveRequest,
    workerResult,
    executionResult,
    trialAttempt,
    projectionArtifacts: [
      artifactRecord(paths, workerResultPath, "worker_result_json"),
      artifactRecord(paths, executionResultPath, "execution_result_json")
    ]
  });

  return executionResult;
}

import fs from "fs";
import crypto from "crypto";
import path from "path";
import { validateLowFrequencyTradeFloorException } from "./low-frequency-registration.mjs";
import { isStrictlyPromotableEvidence } from "./memory-index.mjs";
import { STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND, validateResearchBrainPlannerProvenance } from "./researchbrain-artifacts.mjs";
import { evaluatePhase8DConsistencyPromotionRoute, PHASE8D_SURVIVOR_FLOORS } from "./wfa-survivor-floors.mjs";

const EVIDENCE_KINDS = new Set([
  "research_wfa",
  "mt5_snapshot",
  "mt5_tradable_universe_snapshot",
  "mt5_bridge_smoke",
  "data_identity",
  "data_relevance_classification",
  "mql_build",
  "mt5_tester",
  "parity_report",
  "ftmo_ledger",
  "forward_report",
  "promotion_gate",
  STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND
]);

const WORKER_RESULT_STATUSES = new Set(["succeeded", "failed", "blocked", "inconclusive"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MT5_SNAPSHOT_REQUIRED_OBSERVATIONS = ["terminal", "account", "symbol", "data_identity"];
const MT5_UNIVERSE_REQUIRED_OBSERVATIONS = ["terminal", "account", "universe"];
const MT5_BRIDGE_REJECTION_TESTS = ["wrong_run", "stale_message", "corrupted_payload", "partial_write"];
const MT5_TESTER_LIFECYCLE_SCENARIOS = ["market_order", "pending_order", "exit_order"];
const PARITY_DRIFT_DIMENSIONS = ["lifecycle", "timing", "fill", "cost", "trade_count", "drawdown", "rule_accounting"];
const STRATEGY_POSITIVE_VERDICTS = new Set(["promising", "promising_with_caveats", "passed", "success"]);
const PROMISING_MIN_WINDOWS = PHASE8D_SURVIVOR_FLOORS.minOosWindows;
const PROMISING_MIN_TRADES = PHASE8D_SURVIVOR_FLOORS.minTrades;
const PROMISING_MIN_RETURN_PCT = PHASE8D_SURVIVOR_FLOORS.minReturnPct;

function hasMeaningfulText(value, minLength = 8) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function hasPathLikeValue(value) {
  return typeof value === "string" && /[\/]|\.[A-Za-z0-9]+$/.test(value.trim());
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasNonEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function hasMeaningfulNumericMetric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function looksLikeCanonicalWfaCommand(command) {
  return typeof command === "string"
    && /walk_forward_smoke_test\.py/.test(command)
    && /--config/.test(command);
}

function looksLikeCanonicalWfaConfigPath(value) {
  return typeof value === "string"
    && /^walk forward engine\/strategies\/[^/]+\/wfa_config\.ya?ml$/i.test(value.trim());
}

function looksLikeCanonicalWfaWorkingDirectory(value) {
  return typeof value === "string"
    && value.trim() === "walk forward engine";
}

function hasMeaningfulEvaluationMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return false;
  return Object.values(metrics).some((value) => typeof value === "number" && Number.isFinite(value));
}

function numericMetric(metrics, keys) {
  const sources = [metrics, metrics?.extra_metrics].filter((value) => value && typeof value === "object");
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return null;
}

function normalizeRatio(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

function consistencyDiagnosticsFromEvaluation(evaluation, metrics) {
  const diagnostic = metrics?.consistency_ladder_advisory
    ?? evaluation?.consistency_ladder_advisory
    ?? evaluation?.verification?.consistency_ladder_advisory
    ?? evaluation?.verification?.consistency_promotion_policy
    ?? null;
  if (diagnostic && typeof diagnostic === "object") return diagnostic;
  return {
    single_window_share: numericMetric(metrics, ["single_window_concentration", "return_concentration_single_window_share"]),
    top_two_window_share: numericMetric(metrics, ["top_two_window_concentration", "return_concentration_top_two_window_share"]),
    drawdown_to_return_ratio: numericMetric(metrics, ["drawdown_to_return_ratio", "max_drawdown_to_return_ratio"])
  };
}

function lowFrequencyRegistrationRefFromEvaluation(evaluation) {
  const verification = evaluation?.verification && typeof evaluation.verification === "object" ? evaluation.verification : {};
  return verification.low_frequency_registration ?? verification.low_frequency_registration_artifact ?? verification.low_frequency_registration_ref ?? null;
}

function lowFrequencyExceptionContext(evaluation, context = {}) {
  return {
    rootDir: context.rootDir ?? null,
    expectedCandidateId: context.candidateId ?? evaluation?.candidate_id ?? evaluation?.verification?.candidate_id ?? null,
    expectedRunId: context.runId ?? evaluation?.run_id ?? evaluation?.verification?.run_id ?? null,
    resultsKnownAt: context.resultsKnownAt ?? evaluation?.results_known_at ?? evaluation?.verification?.results_known_at ?? null
  };
}

function validateLowFrequencyTradeFloorForEvaluation(evaluation, totalTrades, context = {}) {
  const ref = lowFrequencyRegistrationRefFromEvaluation(evaluation);
  if (!ref) return { applied: false, reason: "missing low_frequency_registration_v1 artifact reference" };
  try {
    const result = validateLowFrequencyTradeFloorException(ref, {
      ...lowFrequencyExceptionContext(evaluation, context),
      observedTrades: totalTrades
    });
    return { applied: true, minimumTradeFloor: result.minimum_trade_floor, artifactPath: result.artifact.path };
  } catch (error) {
    return { applied: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function strategyQualityFailures(evaluation, context = {}) {
  const metrics = evaluation?.metrics && typeof evaluation.metrics === "object" ? evaluation.metrics : {};
  const totalTrades = numericMetric(metrics, ["total_trades", "trades", "aggregate_total_trades"]);
  const windows = numericMetric(metrics, ["windows_completed", "successful_windows", "completed_windows", "total_windows", "oos_windows", "per_window_metrics_count"]);
  const annualizedReturnPct = numericMetric(metrics, ["annualized_return_pct", "annual_return_pct", "cagr_pct"]);
  const aggregateReturnPct = numericMetric(metrics, ["aggregate_return_pct", "total_return_pct", "return_pct"]);
  const positiveWindowRatio = normalizeRatio(numericMetric(metrics, ["positive_oos_windows_pct", "positive_return_windows_pct", "positive_sharpe_windows_pct", "positive_windows_pct", "wfr"]));
  const failures = [];

  if (windows === null) failures.push("missing completed OOS window count");
  else if (windows < PROMISING_MIN_WINDOWS) failures.push(`only ${windows} completed OOS windows; need at least ${PROMISING_MIN_WINDOWS}`);

  if (totalTrades === null) failures.push("missing total trade count");
  else if (totalTrades < PROMISING_MIN_TRADES) {
    const exception = validateLowFrequencyTradeFloorForEvaluation(evaluation, totalTrades, context);
    if (!exception.applied) {
      failures.push(`only ${totalTrades} trades; need at least ${PROMISING_MIN_TRADES} unless a valid pre-run low_frequency_registration_v1 artifact adjusts only the trade-count floor (${exception.reason})`);
    }
  }

  if (annualizedReturnPct !== null) {
    if (annualizedReturnPct < PROMISING_MIN_RETURN_PCT) failures.push(`annualized return ${annualizedReturnPct}% is below ${PROMISING_MIN_RETURN_PCT}%`);
  } else if (aggregateReturnPct !== null) {
    if (aggregateReturnPct < PROMISING_MIN_RETURN_PCT) failures.push(`aggregate return ${aggregateReturnPct}% is below ${PROMISING_MIN_RETURN_PCT}% non-annualized proxy`);
  } else {
    failures.push("missing annualized_return_pct or aggregate_return_pct");
  }

  if (positiveWindowRatio === null) {
    failures.push("missing positive OOS window ratio");
  }

  const consistencyRoute = evaluatePhase8DConsistencyPromotionRoute({
    positiveWindowRatio,
    sharpeOos: numericMetric(metrics, ["sharpe_oos", "aggregate_sharpe"]),
    returnPct: annualizedReturnPct ?? aggregateReturnPct,
    profitFactor: numericMetric(metrics, ["profit_factor"]),
    completedWindows: windows,
    diagnostics: consistencyDiagnosticsFromEvaluation(evaluation, metrics)
  });
  if (!consistencyRoute.passed) failures.push(`Phase 8D consistency route denied: ${consistencyRoute.failures.join("; ")}`);

  return failures;
}

function isResearchStrategyEvaluation(evaluation, evidenceKind) {
  if (["research", "research_wfa"].includes(evidenceKind)) return true;
  const metrics = evaluation?.metrics && typeof evaluation.metrics === "object" ? evaluation.metrics : {};
  return ["sharpe_oos", "aggregate_sharpe", "total_trades", "trades", "wfr"].some((key) => key in metrics);
}

function hasPlaceholderToken(value) {
  return typeof value === "string" && /(?:^|[-_/])(NN|YYYY|MM|DD|HH|TODO|TBD|TIMESTAMP|DATE|TIME)(?:$|[-_/])|<[^>]+>/i.test(value.trim());
}

function extractCanonicalConfigPath(command) {
  if (typeof command !== "string" || !/walk_forward_smoke_test\.py/.test(command)) return null;
  const match = command.match(/--config\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return (match?.[1] || match?.[2] || match?.[3] || null)?.trim() || null;
}

function plannedConfigPathAllowed(plan, configRef) {
  const repoPath = `walk forward engine/${configRef}`;
  return [
    ...asArray(plan.expected_artifacts),
    ...asArray(plan.inputs),
    ...asArray(plan.implementation_steps)
  ].some((value) => typeof value === "string" && value.includes(repoPath));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEvidenceKind(value) {
  const evidenceKind = typeof value === "string" && value.trim() ? value.trim() : "research_wfa";
  if (!EVIDENCE_KINDS.has(evidenceKind)) {
    throw new Error(`Unsupported evidence_kind '${evidenceKind}'.`);
  }
  return evidenceKind;
}

const WFA_METRIC_ALIASES = {
  sharpe_oos: ["sharpe_oos", "aggregate_sharpe", "aggregate_sharpe_ratio"],
  total_trades: ["total_trades", "trades", "aggregate_total_trades"],
  windows_completed: ["windows_completed", "successful_windows", "completed_windows", "total_windows", "oos_windows", "per_window_metrics_count"],
  max_drawdown: ["max_drawdown", "max_drawdown_pct", "aggregate_max_drawdown", "aggregate_max_drawdown_pct"],
  annualized_return_pct: ["annualized_return_pct", "annual_return_pct", "cagr_pct"],
  aggregate_return_pct: ["aggregate_return_pct", "total_return_pct", "return_pct"],
  positive_oos_windows_pct: ["positive_oos_windows_pct", "positive_return_windows_pct", "positive_sharpe_windows_pct", "positive_windows_pct", "wfr"],
  profit_factor: ["profit_factor", "aggregate_profit_factor"]
};

function collectNumericJsonFields(value, out = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectNumericJsonFields(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) out.set(key, item);
    else collectNumericJsonFields(item, out);
  }
  return out;
}

function readJsonMetricFields(rootDir, artifactPath) {
  const fullPath = resolveRepoRelativePath(rootDir, artifactPath);
  if (!fs.existsSync(fullPath) || !/\.json$/i.test(fullPath)) return new Map();
  try {
    return collectNumericJsonFields(JSON.parse(fs.readFileSync(fullPath, "utf8")));
  } catch {
    return new Map();
  }
}

function nearlyEqual(left, right) {
  return Math.abs(Number(left) - Number(right)) <= 1e-6;
}

function metricVerifiedByArtifacts(rootDir, metrics, artifactPaths) {
  const merged = artifactMetricFields(rootDir, artifactPaths);
  for (const [metricKey, metricValue] of Object.entries(metrics ?? {})) {
    if (typeof metricValue !== "number" || !Number.isFinite(metricValue)) continue;
    const aliases = WFA_METRIC_ALIASES[metricKey] ?? [metricKey];
    if (aliases.some((alias) => merged.has(alias) && nearlyEqual(merged.get(alias), metricValue))) return true;
  }
  return false;
}

function artifactMetricFields(rootDir, artifactPaths) {
  const merged = new Map();
  for (const artifactPath of artifactPaths) {
    for (const [key, value] of readJsonMetricFields(rootDir, artifactPath).entries()) merged.set(key, value);
  }
  return merged;
}

function metricValueVerifiedByFields(fields, metrics, metricKey) {
  const aliases = WFA_METRIC_ALIASES[metricKey] ?? [metricKey];
  const metricValue = numericMetric(metrics, aliases);
  if (metricValue === null) return false;
  return aliases.some((alias) => fields.has(alias) && nearlyEqual(fields.get(alias), metricValue));
}

function positiveWfaArtifactBackingFailures(evaluation, rootDir, metricsVerifiedFrom) {
  if (!rootDir) return [];
  const metrics = evaluation?.metrics && typeof evaluation.metrics === "object" ? evaluation.metrics : {};
  const fields = artifactMetricFields(rootDir, metricsVerifiedFrom);
  const failures = [];

  if (!metricValueVerifiedByFields(fields, metrics, "windows_completed")) {
    failures.push("windows_completed not backed by cited metric artifacts");
  }
  if (!metricValueVerifiedByFields(fields, metrics, "total_trades")) {
    failures.push("total_trades not backed by cited metric artifacts");
  }
  if (!metricValueVerifiedByFields(fields, metrics, "annualized_return_pct") && !metricValueVerifiedByFields(fields, metrics, "aggregate_return_pct")) {
    failures.push("return metric not backed by cited metric artifacts");
  }
  if (!metricValueVerifiedByFields(fields, metrics, "positive_oos_windows_pct")) {
    failures.push("positive OOS window ratio not backed by cited metric artifacts");
  }

  return failures;
}

function workerResultFrom(executionResult) {
  return executionResult?.worker_result ?? executionResult?.worker_result_envelope ?? null;
}

function artifactPathFromRef(ref) {
  if (typeof ref === "string") return ref.trim();
  if (!ref || typeof ref !== "object") return null;
  if (typeof ref.path === "string") return ref.path.trim();
  if (typeof ref.output_path === "string") return ref.output_path.trim();
  return null;
}

function normalizeArtifactRefs(refs) {
  return asArray(refs)
    .map((ref) => {
      const artifactPath = artifactPathFromRef(ref);
      if (!artifactPath) return null;
      return {
        artifact_type: ref && typeof ref === "object" && typeof ref.artifact_type === "string" ? ref.artifact_type.trim() : null,
        path: artifactPath,
        sha256: ref && typeof ref === "object" && typeof ref.sha256 === "string" ? ref.sha256.trim() : null,
        modified_at: ref && typeof ref === "object" && typeof ref.modified_at === "string" ? ref.modified_at.trim() : null,
        request_identity: ref && typeof ref === "object" && ref.request_identity && typeof ref.request_identity === "object" ? ref.request_identity : null
      };
    })
    .filter(Boolean);
}

function identitiesMatch(expected, actual, fields) {
  return fields.every((field) => (expected?.[field] ?? null) === (actual?.[field] ?? null));
}

function validateResearchWfaOutputIdentity(workerResult, observations, artifactRecords) {
  const expectedIdentity = observations.request_identity ?? workerResult.observations?.request_identity ?? null;
  const requiredFields = ["run_id", "job_id", "candidate_id", "lineage_id", "family_id", "attempt_id"];
  if (!expectedIdentity || typeof expectedIdentity !== "object") {
    throw new Error("research_wfa executed result requires request identity binding for accepted output artifacts.");
  }
  const workerIdentity = {
    run_id: workerResult.run_id ?? null,
    job_id: workerResult.job_id ?? null,
    candidate_id: workerResult.candidate_id ?? null,
    lineage_id: workerResult.lineage_id ?? null,
    family_id: workerResult.family_id ?? null,
    attempt_id: workerResult.attempt_id ?? null
  };
  if (!identitiesMatch(expectedIdentity, workerIdentity, requiredFields)) {
    throw new Error("research_wfa request identity must match worker result run/job/candidate/lineage/family/attempt identity.");
  }
  const outputArtifacts = artifactRecords.filter((record) => record.artifact_type === "wfa_result_artifact");
  if (outputArtifacts.length === 0) {
    throw new Error("research_wfa executed result requires accepted WFA output artifacts.");
  }
  for (const artifact of outputArtifacts) {
    if (!identitiesMatch(expectedIdentity, artifact.request_identity, requiredFields)) {
      throw new Error(`research_wfa accepted output artifact has mismatched request identity: ${artifact.path}.`);
    }
  }
}

function validateResearchWfaOutputFreshness(observations, artifactRecords) {
  const startedMs = Date.parse(observations.worker_start_time ?? "");
  if (!Number.isFinite(startedMs)) {
    throw new Error("research_wfa executed result requires worker_start_time for stale-output validation.");
  }
  const guard = observations.stale_output_guard;
  if (!guard || guard.passed !== true) {
    throw new Error("research_wfa executed result requires a passing stale-output guard.");
  }
  const stale = artifactRecords
    .filter((record) => record.artifact_type === "wfa_result_artifact")
    .filter((record) => Date.parse(record.modified_at ?? "") + 1000 < startedMs)
    .map((record) => record.path);
  if (stale.length > 0) {
    throw new Error(`research_wfa accepted stale output artifacts: ${stale.join(", ")}`);
  }
}

function validateAssumptionGroup(observations, groupKey) {
  const group = observations?.[groupKey];
  if (!group || typeof group !== "object" || typeof group.available !== "boolean") {
    throw new Error(`research_wfa executed result requires ${groupKey} with artifact-backed availability diagnostics.`);
  }
  if (group.available !== true) {
    if (!hasMeaningfulText(group.missing_because, 8)) {
      throw new Error(`research_wfa ${groupKey} must explain missing_because when unavailable.`);
    }
    return;
  }
  if (!hasNonEmptyObject(group.values)) {
    throw new Error(`research_wfa ${groupKey} marked available without values.`);
  }
  for (const [key, record] of Object.entries(group.values)) {
    if (!record || typeof record !== "object") {
      throw new Error(`research_wfa ${groupKey}.${key} must be an artifact-backed record.`);
    }
    if (!hasPathLikeValue(record.source_path) || !SHA256_PATTERN.test(String(record.source_sha256 || "")) || !hasMeaningfulText(record.source_field, 1)) {
      throw new Error(`research_wfa ${groupKey}.${key} must include source_path, source_sha256, and source_field.`);
    }
  }
}

function validateOptionalWfaArtifactDiagnostics(observations) {
  const groups = observations?.optional_wfa_artifacts;
  const expected = {
    trade_ledger: "wfa_trade_ledger",
    equity_curve: "wfa_equity_curve",
    optimizer_trials: "wfa_optimizer_trials"
  };
  if (!groups || typeof groups !== "object") {
    throw new Error("research_wfa executed result requires optional_wfa_artifacts availability diagnostics.");
  }
  for (const [key, artifactType] of Object.entries(expected)) {
    const group = groups[key];
    if (!group || typeof group !== "object" || typeof group.available !== "boolean") {
      throw new Error(`research_wfa optional_wfa_artifacts.${key} requires artifact-backed availability diagnostics.`);
    }
    if (group.available !== true) {
      if (!hasMeaningfulText(group.missing_because, 8)) {
        throw new Error(`research_wfa optional_wfa_artifacts.${key} must explain missing_because when unavailable.`);
      }
      continue;
    }
    if (!Array.isArray(group.artifacts) || group.artifacts.length === 0) {
      throw new Error(`research_wfa optional_wfa_artifacts.${key} marked available without artifacts.`);
    }
    for (const artifact of group.artifacts) {
      if (artifact?.artifact_type !== artifactType || !hasPathLikeValue(artifact.path) || !SHA256_PATTERN.test(String(artifact.sha256 || ""))) {
        throw new Error(`research_wfa optional_wfa_artifacts.${key} artifacts must include ${artifactType}, path, and sha256.`);
      }
    }
  }
}

function executionArtifactRecords(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  return [
    ...normalizeArtifactRefs(executionResult?.artifacts_created),
    ...normalizeArtifactRefs(executionResult?.artifacts),
    ...normalizeArtifactRefs(workerResult?.artifacts)
  ];
}

function sourceHashRecords(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  return [
    ...normalizeArtifactRefs(executionResult?.source_hashes),
    ...normalizeArtifactRefs(workerResult?.source_hashes)
  ];
}

function uniqueArtifactPaths(records) {
  return [...new Set(records.map((record) => record.path).filter(Boolean))];
}

function observationsFrom(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  return executionResult?.observations
    ?? executionResult?.observations_observed
    ?? workerResult?.observations
    ?? null;
}

function hasArtifactType(records, artifactType) {
  return records.some((record) => record?.artifact_type === artifactType && hasPathLikeValue(record.path));
}

function resolveRepoRelativePath(rootDir, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error(`Artifact path must be repo-relative: ${String(relativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, relativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Artifact path escapes repository root: ${relativePath}`);
  }
  return fullPath;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function validateArtifactHashRecord(rootDir, record) {
  if (!record?.sha256) return;
  if (!SHA256_PATTERN.test(record.sha256)) {
    throw new Error(`Artifact sha256 is invalid for ${record.path}.`);
  }
  const fullPath = resolveRepoRelativePath(rootDir, record.path);
  if (!fs.existsSync(fullPath)) return;
  const actual = sha256File(fullPath);
  if (actual !== record.sha256.toLowerCase()) {
    throw new Error(`Artifact hash mismatch for ${record.path}.`);
  }
}

function lessonText(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    return item.lesson || item.specific_finding || item.summary || "";
  }
  return "";
}

function actionText(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    return item.action || item.rationale || item.title || "";
  }
  return "";
}

const GENERIC_SUMMARY_PATTERNS = [
  /further research (?:is )?needed/i,
  /more testing is required/i,
  /optimi[sz]e the strategy/i,
  /improve the strategy/i,
  /try another variation/i,
  /continue iterating/i,
  /investigate further/i,
  /analyze the results/i
];

function isGenericSummaryText(value) {
  if (!hasMeaningfulText(value, 8)) return true;
  return GENERIC_SUMMARY_PATTERNS.some((pattern) => pattern.test(value));
}

export function validatePlannerResult(plan, { rootDir, backlogItem = null } = {}) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Planner returned an empty or invalid result object.");
  }

  const requiredTextFields = [
    ["experiment_id", 4],
    ["title", 8],
    ["objective", 12],
    ["hypothesis", 12],
    ["strategy_rationale", 12],
    ["strategy_type", 3],
    ["market_family", 3],
    ["timeframe", 2],
    ["scope_selection_rationale", 12]
  ];

  for (const [field, minLength] of requiredTextFields) {
    if (!hasMeaningfulText(plan[field], minLength)) {
      throw new Error(`Planner result missing required field '${field}'.`);
    }
  }

  if (hasPlaceholderToken(plan.experiment_id)) {
    throw new Error("Planner result experiment_id must not contain placeholder tokens.");
  }

  const hasInstrumentScope = hasMeaningfulText(plan.instrument_scope, 3) || hasMeaningfulText(plan.instrument_selection_rule, 3);
  if (!hasInstrumentScope) {
    throw new Error("Planner result missing explicit instrument scope or selection rule.");
  }

  if (!plan.historical_depth_requirement || typeof plan.historical_depth_requirement !== "object") {
    throw new Error("Planner result missing historical depth requirement.");
  }
  if (!hasMeaningfulText(plan.historical_depth_requirement.target, 3) || !hasMeaningfulText(plan.historical_depth_requirement.justification, 12)) {
    throw new Error("Planner result has incomplete historical depth requirement.");
  }

  if (!plan.source_plan || typeof plan.source_plan !== "object") {
    throw new Error("Planner result missing source plan.");
  }
  if (!Array.isArray(plan.source_plan.allowed_source_families) || plan.source_plan.allowed_source_families.length === 0) {
    throw new Error("Planner result source plan missing allowed source families.");
  }
  if (!hasMeaningfulText(plan.source_plan.primary_source_family, 3)) {
    throw new Error("Planner result source plan missing primary source family.");
  }
  if (!hasMeaningfulText(plan.source_plan.selection_reason, 8)) {
    throw new Error("Planner result source plan missing selection reason.");
  }

  if (!plan.data_acquisition || typeof plan.data_acquisition !== "object") {
    throw new Error("Planner result missing data acquisition plan.");
  }
  if (!hasMeaningfulText(plan.data_acquisition.status, 3) || !["present", "must_download"].includes(plan.data_acquisition.status)) {
    throw new Error("Planner result data acquisition status must be 'present' or 'must_download'.");
  }
  if (!hasMeaningfulText(plan.data_acquisition.reason, 8)) {
    throw new Error("Planner result data acquisition reason is missing.");
  }
  if (!hasMeaningfulText(plan.data_acquisition.acquisition_method, 3)) {
    throw new Error("Planner result data acquisition method is missing.");
  }
  if (!Array.isArray(plan.data_acquisition.expected_outputs) || !plan.data_acquisition.expected_outputs.every(hasPathLikeValue)) {
    throw new Error("Planner result data acquisition expected outputs must be exact file paths.");
  }
  if (plan.data_acquisition.status === "must_download") {
    if (!hasNonEmptyArray(plan.data_acquisition.commands)) {
      throw new Error("Planner result must include explicit acquisition commands when data must be downloaded.");
    }
    if (!hasNonEmptyArray(plan.data_acquisition.sources)) {
      throw new Error("Planner result must identify sources when data must be downloaded.");
    }
  }

  if (!Array.isArray(plan.expected_artifacts) || plan.expected_artifacts.length === 0) {
    throw new Error("Planner result missing expected artifacts.");
  }
  if (!plan.expected_artifacts.every(hasPathLikeValue)) {
    throw new Error("Planner result expected artifacts must be exact file paths.");
  }
  if (plan.expected_artifacts.some((artifactPath) => hasPlaceholderToken(artifactPath))) {
    throw new Error("Planner result expected artifacts must not contain placeholder tokens.");
  }

  const expectedOutputs = asArray(plan?.data_acquisition?.expected_outputs);
  if (expectedOutputs.some((outputPath) => !hasPathLikeValue(outputPath))) {
    throw new Error("Planner data acquisition expected outputs must be exact file paths.");
  }
  if (expectedOutputs.some((outputPath) => hasPlaceholderToken(outputPath))) {
    throw new Error("Planner data acquisition expected outputs must not contain placeholder tokens.");
  }

  if (rootDir && Array.isArray(plan.commands)) {
    for (const command of plan.commands) {
      const configRef = extractCanonicalConfigPath(command);
      if (!configRef) continue;
      const fullConfigPath = path.join(rootDir, "walk forward engine", configRef);
      if (!fs.existsSync(fullConfigPath) && !plannedConfigPathAllowed(plan, configRef)) {
        throw new Error(`Planner canonical command references missing WFA config path: walk forward engine/${configRef}`);
      }
    }
  }

  if (!plan.evaluation_criteria || typeof plan.evaluation_criteria !== "object") {
    throw new Error("Planner result missing evaluation criteria.");
  }
  if (!hasMeaningfulText(plan.evaluation_criteria.status_gate, 8)) {
    throw new Error("Planner result missing meaningful status gate.");
  }
  if (typeof plan.evaluation_criteria.min_evidence_score !== "number" || !Number.isFinite(plan.evaluation_criteria.min_evidence_score)) {
    throw new Error("Planner result missing numeric min_evidence_score.");
  }
  if (!hasMeaningfulEvaluationMetrics(plan.evaluation_criteria.metrics)) {
    throw new Error("Planner result evaluation criteria must include meaningful numeric metrics.");
  }

  validateResearchBrainPlannerProvenance(plan, { rootDir, backlogItem, requireExisting: Boolean(rootDir) });
}

export function validateExecutionResult(executionResult) {
  if (!executionResult || typeof executionResult !== "object") {
    throw new Error("Executor returned an empty or invalid result object.");
  }

  if (!hasMeaningfulText(executionResult.experiment_id, 4)) {
    throw new Error("Executor result missing experiment_id.");
  }
  if (!hasMeaningfulText(executionResult.status, 3)) {
    throw new Error("Executor result missing status.");
  }

  const evidenceKind = normalizeEvidenceKind(executionResult.evidence_kind);
  if (evidenceKind === STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND) {
    throw new Error("Stage-0 ResearchBrain discovery artifacts are not executable evidence and cannot bypass deterministic WFA/MT5 workers.");
  }

  const terminalStatuses = new Set(["blocked", "failed", "partial", "inconclusive"]);
  if (terminalStatuses.has(executionResult.status)) {
    const errors = Array.isArray(executionResult.errors) ? executionResult.errors : [];
    const blockers = Array.isArray(executionResult.blockers) ? executionResult.blockers : [];
    const hasStructuredError = errors.some((error) =>
      error && typeof error === "object" && typeof error.command === "string" && error.command.trim() && typeof error.message === "string" && error.message.trim()
    );
    const hasBlocker = blockers.some((blocker) => typeof blocker === "string" ? blocker.trim() : Boolean(blocker));

    if (!hasStructuredError && !hasBlocker) {
      throw new Error(`Executor returned status '${executionResult.status}' without structured errors or blockers.`);
    }

    const datasets = Array.isArray(executionResult.datasets_acquired) ? executionResult.datasets_acquired : [];
    for (const dataset of datasets) {
      if (!hasMeaningfulText(dataset?.source, 3) || !hasPathLikeValue(dataset?.output)) {
        throw new Error("Executor datasets_acquired entries must include source and output path.");
      }
      if (typeof dataset.rows !== "number" || dataset.rows < 0) {
        throw new Error("Executor datasets_acquired rows must be numeric when provided.");
      }
    }
    return;
  }

  if (executionResult.status !== "executed") {
    throw new Error(`Executor returned unsupported status '${executionResult.status}'.`);
  }

  const artifacts = executionArtifactRecords(executionResult);
  if (artifacts.length === 0) {
    throw new Error("Executor reported 'executed' without any artifacts_created.");
  }

  if (evidenceKind === "mt5_snapshot") {
    validateMt5SnapshotExecutionResult(executionResult);
    return;
  }

  if (evidenceKind === "mt5_tradable_universe_snapshot") {
    validateMt5TradableUniverseExecutionResult(executionResult);
    return;
  }

  if (evidenceKind === "mt5_bridge_smoke") {
    validateMt5BridgeSmokeExecutionResult(executionResult);
    return;
  }

  if (evidenceKind === "mt5_tester") {
    validateMt5TesterExecutionResult(executionResult);
    return;
  }

  if (evidenceKind === "ftmo_ledger") {
    validateFtmoLedgerExecutionResult(executionResult);
    return;
  }

  if (evidenceKind !== "research_wfa") {
    throw new Error(`Execution validation for evidence_kind '${evidenceKind}' is not implemented yet.`);
  }

  const workerResult = workerResultFrom(executionResult);
  if (!workerResult) {
    throw new Error("research_wfa executed result requires a worker-launched worker_result envelope.");
  }
  validateWorkerResultEnvelope(workerResult, { requireSucceeded: true, evidenceKind: "research_wfa" });
  if (workerResult.worker !== "research_wfa_run" || workerResult.schema_version !== "research_wfa_run_worker_v1") {
    throw new Error("research_wfa executed result requires the Phase 7A research_wfa_run worker schema.");
  }
  if (executionResult.candidate_id !== null && executionResult.candidate_id !== undefined && executionResult.candidate_id !== workerResult.candidate_id) {
    throw new Error("research_wfa execution candidate_id must match worker_result candidate_id.");
  }
  const authorityLayer = executionResult.authority_layer ?? workerResult.authority_layer;
  if (authorityLayer !== "python_research") {
    throw new Error("research_wfa worker evidence must declare authority_layer 'python_research'.");
  }
  const observations = observationsFrom(executionResult) ?? {};
  if (observations.execution_was_run_by_this_worker !== true || workerResult.observations?.execution_was_run_by_this_worker !== true) {
    throw new Error("research_wfa executed result requires execution_was_run_by_this_worker: true.");
  }

  const metrics = executionResult.metrics_observed || {};
  const coreMetricKeys = ["sharpe_is", "sharpe_oos", "wfr", "total_trades", "max_drawdown"];
  const hasObservedMetric = coreMetricKeys.some((key) => metrics[key] !== null && metrics[key] !== undefined);
  if (!hasObservedMetric) {
    throw new Error("Executor reported 'executed' without any observed WFA metrics.");
  }
  if (!hasMeaningfulNumericMetric(metrics.total_trades) || metrics.total_trades < 1) {
    throw new Error("research_wfa executed result requires nonzero artifact-backed trades.");
  }

  const artifactRecords = executionArtifactRecords(executionResult);
  for (const artifactType of ["stdout", "stderr", "parsed_wfa_metrics"]) {
    if (!hasArtifactType(artifactRecords, artifactType)) {
      throw new Error(`research_wfa executed result requires ${artifactType} artifact evidence.`);
    }
  }
  const sourceRecords = sourceHashRecords(executionResult);
  for (const artifactType of ["wfa_config", "strategy_source", "strategy_config"]) {
    if (!hasArtifactType(sourceRecords, artifactType)) {
      throw new Error(`research_wfa executed result requires ${artifactType} input hash evidence.`);
    }
  }
  if (!hasArtifactType(sourceRecords, "data_input") && !hasArtifactType(sourceRecords, "data_manifest")) {
    throw new Error("research_wfa executed result requires data input or data manifest hash evidence.");
  }
  if (!hasMeaningfulNumericMetric(observations.per_window_metrics_count) || observations.per_window_metrics_count < 1) {
    throw new Error("research_wfa executed result requires artifact-backed per-window metrics.");
  }
  validateAssumptionGroup(observations, "cost_assumptions");
  validateAssumptionGroup(observations, "timing_assumptions");
  validateOptionalWfaArtifactDiagnostics(observations);
  validateWfaMetricReadiness(observations);
  validateWfaOutputRootTruth(observations, artifactRecords);
  validateResearchWfaOutputIdentity(workerResult, observations, artifactRecords);
  validateResearchWfaOutputFreshness(observations, artifactRecords);

  const provenance = executionResult.provenance;
  if (!provenance || typeof provenance !== "object") {
    throw new Error("Executor reported 'executed' without canonical execution provenance.");
  }
  if (!hasMeaningfulText(provenance.engine, 3) || provenance.engine !== "walk_forward_engine") {
    throw new Error("Executor provenance must declare the canonical walk_forward_engine.");
  }
  if (!looksLikeCanonicalWfaCommand(provenance.command)) {
    throw new Error("Executor provenance must include the canonical WFA command.");
  }
  if (!looksLikeCanonicalWfaWorkingDirectory(provenance.working_directory)) {
    throw new Error("Executor provenance must include the canonical WFA working directory.");
  }
  if (!looksLikeCanonicalWfaConfigPath(provenance.config_path)) {
    throw new Error("Executor provenance must include the canonical WFA config path.");
  }
  if (!Array.isArray(provenance.result_artifacts) || provenance.result_artifacts.length === 0 || !provenance.result_artifacts.every(hasPathLikeValue)) {
    throw new Error("Executor provenance must include exact result artifact paths.");
  }
  if (!hasMeaningfulNumericMetric(provenance.windows_completed) || provenance.windows_completed < 1) {
    throw new Error("Executor provenance must prove at least one walk-forward window completed.");
  }
}

export function validateWorkerResultEnvelope(workerResult, { requireSucceeded = false, evidenceKind = null } = {}) {
  if (!workerResult || typeof workerResult !== "object") {
    throw new Error("Worker result envelope is missing or invalid.");
  }

  const requiredTextFields = ["job_id", "run_id", "worker", "evidence_kind", "authority_layer", "schema_version", "status"];
  for (const field of requiredTextFields) {
    if (!hasMeaningfulText(workerResult[field], 1)) {
      throw new Error(`Worker result envelope missing required field '${field}'.`);
    }
  }

  const workerEvidenceKind = normalizeEvidenceKind(workerResult.evidence_kind);
  if (evidenceKind && workerEvidenceKind !== evidenceKind) {
    throw new Error(`Worker result evidence_kind '${workerEvidenceKind}' does not match '${evidenceKind}'.`);
  }
  if (workerResult.candidate_id !== null && workerResult.candidate_id !== undefined && !hasMeaningfulText(workerResult.candidate_id, 3)) {
    throw new Error("Worker result candidate_id must be null or a meaningful candidate identifier.");
  }

  if (!WORKER_RESULT_STATUSES.has(workerResult.status)) {
    throw new Error(`Worker result status '${workerResult.status}' is unsupported.`);
  }
  if (requireSucceeded && workerResult.status !== "succeeded") {
    throw new Error("Executed evidence requires a succeeded worker result envelope.");
  }
  if (workerResult.status === "blocked" && !hasMeaningfulText(workerResult.blocked_reason, 3)) {
    throw new Error("Blocked worker result must include blocked_reason.");
  }

  const artifacts = asArray(workerResult.artifacts);
  if (requireSucceeded && artifacts.length === 0) {
    throw new Error("Succeeded worker result must include artifact records.");
  }
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") {
      throw new Error("Worker result artifacts must be objects.");
    }
    if (!hasMeaningfulText(artifact.artifact_type, 3) || !hasPathLikeValue(artifact.path)) {
      throw new Error("Worker result artifact records must include artifact_type and repo-relative path.");
    }
    if (!SHA256_PATTERN.test(String(artifact.sha256 || ""))) {
      throw new Error(`Worker result artifact '${artifact.path}' must include a valid sha256.`);
    }
  }

  if (workerResult.status === "succeeded" && !hasNonEmptyObject(workerResult.metrics) && !hasNonEmptyObject(workerResult.observations)) {
    throw new Error("Succeeded worker result must include metrics or observations.");
  }
}

export function validateParityReport(report) {
  if (!report || typeof report !== "object") throw new Error("parity_report is missing or invalid.");
  if (report.schema_version !== "parity_report_v1" || report.evidence_kind !== "parity_report") {
    throw new Error("parity_report must declare schema_version parity_report_v1 and evidence_kind parity_report.");
  }
  if (!hasMeaningfulText(report.candidate_id, 3) || !hasMeaningfulText(report.run_id, 3)) {
    throw new Error("parity_report must include candidate_id and run_id.");
  }
  if (!["pass", "fail", "blocked"].includes(report.decision)) throw new Error("parity_report decision must be pass, fail, or blocked.");
  if (!hasNonEmptyArray(report.compared_artifacts) || !report.compared_artifacts.every(hasPathLikeValue)) {
    throw new Error("parity_report must include compared artifact paths.");
  }
  if (!Array.isArray(report.drift_classifications)) throw new Error("parity_report must include drift_classifications.");
  const dimensions = new Set(report.drift_classifications.map((item) => item?.dimension));
  const missing = PARITY_DRIFT_DIMENSIONS.filter((dimension) => !dimensions.has(dimension));
  if (missing.length > 0) throw new Error(`parity_report missing drift dimensions: ${missing.join(", ")}`);
  for (const item of report.drift_classifications) {
    if (!["pass", "fail", "blocked"].includes(item?.status)) throw new Error(`parity_report drift '${item?.dimension}' has invalid status.`);
    if (!item.threshold || typeof item.threshold !== "object" || !hasMeaningfulText(item.threshold.empirical_source, 3)) {
      throw new Error(`parity_report drift '${item?.dimension}' missing empirical threshold source.`);
    }
  }
}

export function validatePromotionGate(gate) {
  if (!gate || typeof gate !== "object") throw new Error("promotion gate is missing or invalid.");
  if (gate.schema_version !== "stage_gate_v1") throw new Error("promotion gate must use stage_gate_v1 schema.");
  if (!hasMeaningfulText(gate.candidate_id, 3)) throw new Error("promotion gate must include candidate_id.");
  if (!hasMeaningfulText(gate.stage, 3) || !String(gate.stage).includes("promotion")) throw new Error("promotion gate stage must be promotion-scoped.");
  if (!["allowed", "denied", "blocked"].includes(gate.decision)) throw new Error("promotion gate decision must be allowed, denied, or blocked.");
  if (!hasMeaningfulText(gate.validator, 3) || !hasMeaningfulText(gate.reason, 8)) throw new Error("promotion gate must include validator and reason.");
  if (!Array.isArray(gate.evidence_paths) || gate.evidence_paths.length === 0 || !gate.evidence_paths.every(hasPathLikeValue)) {
    throw new Error("promotion gate must cite artifact-backed evidence paths.");
  }
}

function validateMt5SnapshotExecutionResult(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  if (!workerResult) {
    throw new Error("mt5_snapshot executed result requires a worker_result envelope.");
  }

  validateWorkerResultEnvelope(workerResult, { requireSucceeded: true, evidenceKind: "mt5_snapshot" });

  const authorityLayer = executionResult.authority_layer ?? workerResult.authority_layer;
  if (authorityLayer !== "mt5_terminal") {
    throw new Error("mt5_snapshot evidence must declare authority_layer 'mt5_terminal'.");
  }

  if (!hasMeaningfulText(executionResult.observed_at ?? workerResult.observed_at, 10)) {
    throw new Error("mt5_snapshot evidence must include observed_at timestamp.");
  }

  const observations = observationsFrom(executionResult);
  if (!hasNonEmptyObject(observations)) {
    throw new Error("mt5_snapshot evidence must include observed terminal/account/symbol/data identity observations.");
  }
  const missing = MT5_SNAPSHOT_REQUIRED_OBSERVATIONS.filter((field) => !hasNonEmptyObject(observations[field]));
  if (missing.length > 0) {
    throw new Error(`mt5_snapshot observations missing required fields: ${missing.join(", ")}`);
  }

  const snapshotHash = observations.snapshot_sha256 ?? observations.snapshot_hash ?? workerResult.artifacts?.[0]?.sha256;
  if (!SHA256_PATTERN.test(String(snapshotHash || ""))) {
    throw new Error("mt5_snapshot evidence must include a snapshot sha256.");
  }
}

function validateMt5TradableUniverseExecutionResult(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  if (!workerResult) {
    throw new Error("mt5_tradable_universe_snapshot executed result requires a worker_result envelope.");
  }

  validateWorkerResultEnvelope(workerResult, { requireSucceeded: true, evidenceKind: "mt5_tradable_universe_snapshot" });

  const authorityLayer = executionResult.authority_layer ?? workerResult.authority_layer;
  if (authorityLayer !== "mt5_terminal") {
    throw new Error("mt5_tradable_universe_snapshot evidence must declare authority_layer 'mt5_terminal'.");
  }

  if (!hasMeaningfulText(executionResult.observed_at ?? workerResult.observed_at, 10)) {
    throw new Error("mt5_tradable_universe_snapshot evidence must include observed_at timestamp.");
  }

  const observations = observationsFrom(executionResult);
  if (!hasNonEmptyObject(observations)) {
    throw new Error("mt5_tradable_universe_snapshot evidence must include terminal/account/universe observations.");
  }
  const missing = MT5_UNIVERSE_REQUIRED_OBSERVATIONS.filter((field) => !hasNonEmptyObject(observations[field]));
  if (missing.length > 0) {
    throw new Error(`mt5_tradable_universe_snapshot observations missing required fields: ${missing.join(", ")}`);
  }

  const universe = observations.universe;
  if (universe.symbol_count_total !== universe.symbols?.length || !Number.isInteger(universe.symbol_count_total) || universe.symbol_count_total < 1) {
    throw new Error("mt5_tradable_universe_snapshot universe must include nonzero symbol_count_total matching symbols[].");
  }
  if (!Number.isInteger(universe.symbol_count_crypto_like) || universe.symbol_count_crypto_like < 0 || universe.symbol_count_crypto_like > universe.symbol_count_total) {
    throw new Error("mt5_tradable_universe_snapshot universe must include valid symbol_count_crypto_like.");
  }
  if (!hasNonEmptyObject(universe.symbol_count_by_asset_class_guess)) {
    throw new Error("mt5_tradable_universe_snapshot universe must include symbol_count_by_asset_class_guess.");
  }
  if (!hasNonEmptyArray(universe.symbols)) {
    throw new Error("mt5_tradable_universe_snapshot universe must include symbols[].");
  }
  for (const symbol of universe.symbols) {
    if (!hasMeaningfulText(symbol?.name, 1)) {
      throw new Error("mt5_tradable_universe_snapshot symbols[] entries require exact terminal name.");
    }
    if (!hasNonEmptyObject(symbol.asset_class_hints) || !hasMeaningfulText(symbol.asset_class_hints.asset_class_guess, 2)) {
      throw new Error("mt5_tradable_universe_snapshot symbols[] entries require heuristic asset_class_hints.");
    }
  }

  const scope = universe.universe_scope;
  if (!hasNonEmptyObject(scope) || typeof scope.filter_used !== "boolean") {
    throw new Error("mt5_tradable_universe_snapshot must record explicit universe scope/filter usage.");
  }
  if (scope.filter_used === false && !/no filter used/i.test(String(scope.filter_description || ""))) {
    throw new Error("mt5_tradable_universe_snapshot must explicitly record 'no filter used' when unfiltered.");
  }
  if (scope.filter_used === true && !hasMeaningfulText(scope.filter_pattern, 1)) {
    throw new Error("mt5_tradable_universe_snapshot filtered snapshots require filter_pattern.");
  }

  const snapshotHash = observations.snapshot_sha256 ?? observations.snapshot_hash ?? workerResult.artifacts?.[0]?.sha256;
  if (!SHA256_PATTERN.test(String(snapshotHash || ""))) {
    throw new Error("mt5_tradable_universe_snapshot evidence must include a snapshot sha256.");
  }
}

function validateWfaMetricReadiness(observations) {
  const diagnostics = observations?.metric_readiness;
  if (!diagnostics || typeof diagnostics !== "object") {
    throw new Error("research_wfa executed result requires WFA metric_readiness diagnostics for WFE/WFR inputs.");
  }
  for (const key of ["wfe", "wfr"]) {
    const item = diagnostics[key];
    if (!item || typeof item !== "object") {
      throw new Error(`research_wfa metric_readiness.${key} is required.`);
    }
    if (item.status === "blocked_missing_inputs") {
      if (!Array.isArray(item.missing_inputs) || item.missing_inputs.length === 0 || !hasMeaningfulText(item.missing_because, 8)) {
        throw new Error(`research_wfa metric_readiness.${key} must report exact missing inputs when blocked.`);
      }
      if (item.value !== null && item.value !== undefined) {
        throw new Error(`research_wfa metric_readiness.${key} must not invent a value when inputs are missing.`);
      }
      continue;
    }
    if (item.status !== "computed_artifact_backed" || !hasMeaningfulNumericMetric(item.value)) {
      throw new Error(`research_wfa metric_readiness.${key} must be computed_artifact_backed or blocked_missing_inputs.`);
    }
    const inputs = item.inputs && typeof item.inputs === "object" ? Object.values(item.inputs) : [];
    if (inputs.length === 0 || inputs.some((input) => !input?.available || !input?.source || !hasPathLikeValue(input.source.source_path) || !SHA256_PATTERN.test(String(input.source.source_sha256 || "")))) {
      throw new Error(`research_wfa metric_readiness.${key} computed values must preserve artifact path/hash inputs.`);
    }
  }
}

function validateWfaOutputRootTruth(observations, artifactRecords) {
  const truth = observations?.output_root_truth;
  if (!truth || typeof truth !== "object" || truth.matched !== true || !hasPathLikeValue(truth.expected_output_root) || truth.expected_output_root !== truth.config_output_root) {
    throw new Error("research_wfa executed result requires output_root_truth proving expected_output_root matches the WFA config output_directory.");
  }
  const root = String(truth.expected_output_root).replace(/\\/g, "/").replace(/\/+$/, "");
  const outside = artifactRecords
    .filter((record) => record.artifact_type === "wfa_result_artifact")
    .map((record) => record.path)
    .filter((artifactPath) => !(artifactPath === root || String(artifactPath).startsWith(`${root}/`)));
  if (outside.length > 0) {
    throw new Error(`research_wfa accepted output artifacts outside expected_output_root: ${outside.join(", ")}`);
  }
}

function validateMt5BridgeSmokeExecutionResult(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  if (!workerResult) {
    throw new Error("mt5_bridge_smoke executed result requires a worker_result envelope.");
  }

  validateWorkerResultEnvelope(workerResult, { requireSucceeded: true, evidenceKind: "mt5_bridge_smoke" });

  const authorityLayer = executionResult.authority_layer ?? workerResult.authority_layer;
  if (authorityLayer !== "control_plane") {
    throw new Error("mt5_bridge_smoke evidence must declare authority_layer 'control_plane'.");
  }

  if (!hasMeaningfulText(executionResult.observed_at ?? workerResult.observed_at, 10)) {
    throw new Error("mt5_bridge_smoke evidence must include observed_at timestamp.");
  }

  const observations = observationsFrom(executionResult);
  if (!hasNonEmptyObject(observations)) {
    throw new Error("mt5_bridge_smoke evidence must include bridge protocol observations.");
  }
  if (!hasNonEmptyObject(observations.protocol) || observations.protocol.file_common_required !== true) {
    throw new Error("mt5_bridge_smoke observations must describe the FILE_COMMON protocol.");
  }
  if (observations.protocol.network_calls_required !== false || observations.protocol.manual_copy_required !== false) {
    throw new Error("mt5_bridge_smoke protocol must not require network calls or manual copy/paste.");
  }
  if (!hasNonEmptyObject(observations.accepted_message) || !hasPathLikeValue(observations.accepted_message.path)) {
    throw new Error("mt5_bridge_smoke observations must include an accepted message artifact path.");
  }
  if (!hasNonEmptyObject(observations.rejection_tests)) {
    throw new Error("mt5_bridge_smoke observations must include deterministic rejection tests.");
  }
  const missingRejections = MT5_BRIDGE_REJECTION_TESTS.filter((field) => observations.rejection_tests[field]?.rejected !== true);
  if (missingRejections.length > 0) {
    throw new Error(`mt5_bridge_smoke rejection tests missing or not rejected: ${missingRejections.join(", ")}`);
  }
}

function validateMt5TesterExecutionResult(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  if (!workerResult) {
    throw new Error("mt5_tester executed result requires a worker_result envelope.");
  }

  validateWorkerResultEnvelope(workerResult, { requireSucceeded: true, evidenceKind: "mt5_tester" });

  const authorityLayer = executionResult.authority_layer ?? workerResult.authority_layer;
  if (authorityLayer !== "mt5_tester") {
    throw new Error("mt5_tester evidence must declare authority_layer 'mt5_tester'.");
  }
  if (!hasMeaningfulText(executionResult.observed_at ?? workerResult.observed_at, 10)) {
    throw new Error("mt5_tester evidence must include observed_at timestamp.");
  }

  const observations = observationsFrom(executionResult);
  if (!hasNonEmptyObject(observations)) {
    throw new Error("mt5_tester evidence must include tester lifecycle observations.");
  }
  if (!hasNonEmptyObject(observations.tester_settings) || !hasNonEmptyObject(observations.lifecycle_summary)) {
    throw new Error("mt5_tester observations must include tester_settings and lifecycle_summary.");
  }
  const missingScenarios = MT5_TESTER_LIFECYCLE_SCENARIOS.filter((scenario) => observations.lifecycle_summary[scenario]?.observed !== true);
  if (missingScenarios.length > 0) {
    throw new Error(`mt5_tester lifecycle summary missing required observed scenarios: ${missingScenarios.join(", ")}`);
  }
  if (!hasNonEmptyObject(observations.limitations)) {
    throw new Error("mt5_tester observations must record tester limitations.");
  }
}

function validateFtmoLedgerExecutionResult(executionResult) {
  const workerResult = workerResultFrom(executionResult);
  if (!workerResult) throw new Error("ftmo_ledger executed result requires a worker_result envelope.");
  validateWorkerResultEnvelope(workerResult, { requireSucceeded: true, evidenceKind: "ftmo_ledger" });

  const authorityLayer = executionResult.authority_layer ?? workerResult.authority_layer;
  if (authorityLayer !== "control_plane") {
    throw new Error("ftmo_ledger evidence must declare authority_layer 'control_plane'.");
  }

  const observations = observationsFrom(executionResult);
  if (!hasNonEmptyObject(observations)) throw new Error("ftmo_ledger evidence must include observations.");
  if (!hasNonEmptyObject(observations.rule_set) || !["1-step", "2-step", "both"].includes(observations.rule_set.ftmo_target)) {
    throw new Error("ftmo_ledger observations must include explicit FTMO target and rule set.");
  }
  if (!hasMeaningfulText(observations.rule_set.rule_set_version, 2) || !hasMeaningfulText(observations.rule_set.source_date, 8)) {
    throw new Error("ftmo_ledger rule_set must include version and source_date.");
  }
  if (!hasNonEmptyObject(observations.account) || typeof observations.account.starting_balance !== "number" || !hasMeaningfulText(observations.account.currency, 3)) {
    throw new Error("ftmo_ledger observations must include account currency and starting_balance.");
  }
  if (!hasNonEmptyObject(observations.ledger_summary) || typeof observations.ledger_summary.breached !== "boolean") {
    throw new Error("ftmo_ledger observations must include ledger_summary with breached boolean.");
  }
  if (observations.proof_scope !== "ledger_mechanics_only" || observations.forward_demo_survival_claim !== false) {
    throw new Error("ftmo_ledger evidence must be labeled ledger_mechanics_only and must not claim forward/demo survival.");
  }
  if (observations.floating_equity_evidence?.available === false && observations.forward_demo_survival_claim === true) {
    throw new Error("ftmo_ledger forward/demo survival claims require explicit floating equity time-series evidence.");
  }
}

export function validateExecutionArtifacts(rootDir, executionResult) {
  if (executionResult.status !== "executed") return;

  const evidenceKind = normalizeEvidenceKind(executionResult.evidence_kind);
  const artifactRecords = executionArtifactRecords(executionResult);
  const allRecords = [...artifactRecords, ...sourceHashRecords(executionResult)];
  const artifactPaths = uniqueArtifactPaths(artifactRecords);
  const missing = artifactPaths.filter((artifactPath) => {
    const fullPath = resolveRepoRelativePath(rootDir, artifactPath);
    return !fs.existsSync(fullPath);
  });

  if (missing.length > 0) {
    throw new Error(`Executor reported missing created artifacts: ${missing.join(", ")}`);
  }

  for (const record of allRecords) {
    validateArtifactHashRecord(rootDir, record);
  }

  const provenanceArtifacts = Array.isArray(executionResult?.provenance?.result_artifacts)
    ? executionResult.provenance.result_artifacts
    : [];
  const missingProvenanceArtifacts = provenanceArtifacts.filter((artifactPath) => !fs.existsSync(resolveRepoRelativePath(rootDir, artifactPath)));
  if (missingProvenanceArtifacts.length > 0) {
    throw new Error(`Executor provenance references missing result artifacts: ${missingProvenanceArtifacts.join(", ")}`);
  }

  if (evidenceKind !== "research_wfa") {
    const hashedRecords = allRecords.filter((record) => record.sha256);
    if (hashedRecords.length === 0) {
      throw new Error(`Executor reported '${evidenceKind}' executed evidence without hashed artifacts.`);
    }
    return;
  }

  const observations = observationsFrom(executionResult) ?? {};
  if (workerResultFrom(executionResult)) validateWfaOutputRootTruth(observations, artifactRecords);
  const workerStartMs = Date.parse(observations.worker_start_time ?? "");
  if (Number.isFinite(workerStartMs)) {
    const staleDiskArtifacts = artifactRecords
      .filter((record) => record.artifact_type === "wfa_result_artifact")
      .filter((record) => {
        const fullPath = resolveRepoRelativePath(rootDir, record.path);
        return fs.existsSync(fullPath) && fs.statSync(fullPath).mtimeMs + 1000 < workerStartMs;
      })
      .map((record) => record.path);
    if (staleDiskArtifacts.length > 0) {
      throw new Error(`research_wfa accepted output artifacts predate worker start on disk: ${staleDiskArtifacts.join(", ")}`);
    }
  }

  const resultArtifacts = artifactPaths.filter((artifactPath) => /(?:^|[\/])results(?:[\/]|$)|walk_forward_results|walk-forward-results|wfa-results/i.test(artifactPath));
  if (resultArtifacts.length === 0 && provenanceArtifacts.length === 0) {
    throw new Error("Executor reported 'executed' without any WFA result artifacts.");
  }
  if (!workerResultFrom(executionResult) && !metricVerifiedByArtifacts(rootDir, executionResult.metrics_observed, [...resultArtifacts, ...provenanceArtifacts])) {
    throw new Error("research_wfa metrics must be backed by a worker_result envelope or deterministic WFA metric artifact.");
  }
}

export function validateEvaluationResult(evaluation, { mode, rootDir, evidenceKind = null, candidateId = null, runId = null, resultsKnownAt = null } = {}) {
  if (!evaluation || typeof evaluation !== "object") {
    throw new Error("Evaluator returned an empty or invalid result object.");
  }

  if (!hasMeaningfulText(evaluation.verdict, 3)) {
    throw new Error("Evaluator result missing verdict.");
  }
  if (typeof evaluation.evidence_score !== "number" || typeof evaluation.overall_score !== "number") {
    throw new Error("Evaluator result missing numeric scores.");
  }
  if (!Array.isArray(evaluation.red_flags) || !Array.isArray(evaluation.missing_evidence)) {
    throw new Error("Evaluator result missing required evidence-quality fields.");
  }
  if (!hasMeaningfulText(evaluation.confidence_level, 3) || !hasMeaningfulText(evaluation.confidence_rationale, 8)) {
    throw new Error("Evaluator result missing confidence fields.");
  }

  const artifactsChecked = Array.isArray(evaluation?.verification?.artifacts_checked)
    ? evaluation.verification.artifacts_checked
    : [];
  if (artifactsChecked.length === 0 || !artifactsChecked.every(hasPathLikeValue)) {
    throw new Error("Evaluator verification must reference exact artifact paths.");
  }

  const metricsClaimed = hasMeaningfulEvaluationMetrics(evaluation.metrics);
  const metricsVerifiedFrom = Array.isArray(evaluation?.verification?.metrics_verified_from)
    ? evaluation.verification.metrics_verified_from
    : [];
  if (metricsClaimed && (metricsVerifiedFrom.length === 0 || !metricsVerifiedFrom.every(hasPathLikeValue))) {
    throw new Error("Evaluator must cite exact metric verification sources when metrics are claimed.");
  }

  if (STRATEGY_POSITIVE_VERDICTS.has(String(evaluation.verdict).toLowerCase()) && isResearchStrategyEvaluation(evaluation, evidenceKind)) {
    const failures = strategyQualityFailures(evaluation, { rootDir, candidateId, runId, resultsKnownAt });
    if (failures.length > 0) {
      throw new Error(`Evaluator cannot label weak research evidence '${evaluation.verdict}': ${failures.join("; ")}. Operational canary acceptance is separate from strategy-quality evidence.`);
    }
  }

  if (rootDir) {
    const missingArtifacts = artifactsChecked.filter((artifactPath) => !fs.existsSync(path.join(rootDir, artifactPath)));
    if (missingArtifacts.length > 0) {
      throw new Error(`Evaluator verification references missing artifacts: ${missingArtifacts.join(", ")}`);
    }
    const missingMetricSources = metricsVerifiedFrom.filter((artifactPath) => !fs.existsSync(path.join(rootDir, artifactPath)));
    if (missingMetricSources.length > 0) {
      throw new Error(`Evaluator metrics verification references missing artifacts: ${missingMetricSources.join(", ")}`);
    }

    if (STRATEGY_POSITIVE_VERDICTS.has(String(evaluation.verdict).toLowerCase()) && evidenceKind === "research_wfa") {
      const artifactFailures = positiveWfaArtifactBackingFailures(evaluation, rootDir, metricsVerifiedFrom);
      if (artifactFailures.length > 0) {
        throw new Error(`Evaluator cannot label research_wfa evidence '${evaluation.verdict}' without artifact-backed promotion metrics: ${artifactFailures.join("; ")}.`);
      }
    }
  }

  if (evaluation.promote_to_leaderboard) {
    const promotable = isStrictlyPromotableEvidence({
      mode,
      evidence_kind: mode === "live" ? "research" : "simulation",
      verdict: evaluation.verdict,
      evidence_score: evaluation.evidence_score,
      metrics: evaluation.metrics || {}
    });
    if (!promotable) {
      throw new Error("Evaluator attempted leaderboard promotion for synthetic or weak evidence.");
    }
  }
}

export function validateSummaryResult(summary) {
  if (!summary || typeof summary !== "object") {
    throw new Error("Summarizer returned an empty or invalid result object.");
  }

  const allowedKeys = new Set(["experiment_id", "backlog_item_id", "summary", "key_lessons", "next_actions"]);
  const extraKeys = Object.keys(summary).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) {
    throw new Error(`Summarizer returned unsupported fields: ${extraKeys.join(", ")}`);
  }

  if (!hasMeaningfulText(summary.experiment_id, 4) || !hasMeaningfulText(summary.backlog_item_id, 4)) {
    throw new Error("Summarizer result missing experiment or backlog linkage.");
  }

  if (!hasMeaningfulText(summary.summary, 12)) {
    throw new Error("Summarizer result missing meaningful summary text.");
  }

  if (!Array.isArray(summary.key_lessons) || summary.key_lessons.length === 0) {
    throw new Error("Summarizer result missing key lessons.");
  }
  if (!summary.key_lessons.every((item) => hasMeaningfulText(lessonText(item), 10))) {
    throw new Error("Summarizer key lessons must be specific and non-empty.");
  }
  if (summary.key_lessons.some((item) => isGenericSummaryText(lessonText(item)))) {
    throw new Error("Summarizer key lessons must not be generic boilerplate.");
  }

  if (!Array.isArray(summary.next_actions) || summary.next_actions.length === 0) {
    throw new Error("Summarizer result missing next actions.");
  }
  if (!summary.next_actions.every((item) => hasMeaningfulText(actionText(item), 8))) {
    throw new Error("Summarizer next actions must be specific and non-empty.");
  }
  if (summary.next_actions.some((item) => isGenericSummaryText(actionText(item)))) {
    throw new Error("Summarizer next actions must not be generic boilerplate.");
  }
}

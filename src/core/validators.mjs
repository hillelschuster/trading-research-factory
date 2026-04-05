import fs from "fs";
import path from "path";
import { isStrictlyPromotableEvidence } from "./memory-index.mjs";

function hasMeaningfulText(value, minLength = 8) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function hasPathLikeValue(value) {
  return typeof value === "string" && /[\/]|\.[A-Za-z0-9]+$/.test(value.trim());
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
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

function hasPlaceholderToken(value) {
  return typeof value === "string" && /(?:^|[-_/])(NN|YYYY|MM|DD|HH|TODO|TBD|TIMESTAMP|DATE|TIME)(?:$|[-_/])|<[^>]+>/i.test(value.trim());
}

function extractCanonicalConfigPath(command) {
  if (typeof command !== "string" || !/walk_forward_smoke_test\.py/.test(command)) return null;
  const match = command.match(/--config\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return (match?.[1] || match?.[2] || match?.[3] || null)?.trim() || null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

export function validatePlannerResult(plan, { rootDir } = {}) {
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
      if (!fs.existsSync(fullConfigPath)) {
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

  const terminalStatuses = new Set(["blocked", "failed", "partial"]);
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

  const artifacts = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  if (artifacts.length === 0) {
    throw new Error("Executor reported 'executed' without any artifacts_created.");
  }

  const metrics = executionResult.metrics_observed || {};
  const coreMetricKeys = ["sharpe_is", "sharpe_oos", "wfr", "total_trades", "max_drawdown"];
  const hasObservedMetric = coreMetricKeys.some((key) => metrics[key] !== null && metrics[key] !== undefined);
  if (!hasObservedMetric) {
    throw new Error("Executor reported 'executed' without any observed WFA metrics.");
  }

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

export function validateExecutionArtifacts(rootDir, executionResult) {
  if (executionResult.status !== "executed") return;

  const artifacts = Array.isArray(executionResult.artifacts_created) ? executionResult.artifacts_created : [];
  const missing = artifacts.filter((artifactPath) => {
    if (typeof artifactPath !== "string" || !artifactPath.trim()) return true;
    return !fs.existsSync(path.join(rootDir, artifactPath));
  });

  if (missing.length > 0) {
    throw new Error(`Executor reported missing created artifacts: ${missing.join(", ")}`);
  }

  const provenanceArtifacts = Array.isArray(executionResult?.provenance?.result_artifacts)
    ? executionResult.provenance.result_artifacts
    : [];
  const missingProvenanceArtifacts = provenanceArtifacts.filter((artifactPath) => !fs.existsSync(path.join(rootDir, artifactPath)));
  if (missingProvenanceArtifacts.length > 0) {
    throw new Error(`Executor provenance references missing result artifacts: ${missingProvenanceArtifacts.join(", ")}`);
  }

  const resultArtifacts = artifacts.filter((artifactPath) => /(?:^|[\/])results(?:[\/]|$)|walk_forward_results|walk-forward-results|wfa-results/i.test(artifactPath));
  if (resultArtifacts.length === 0 && provenanceArtifacts.length === 0) {
    throw new Error("Executor reported 'executed' without any WFA result artifacts.");
  }
}

export function validateEvaluationResult(evaluation, { mode, rootDir } = {}) {
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

  if (rootDir) {
    const missingArtifacts = artifactsChecked.filter((artifactPath) => !fs.existsSync(path.join(rootDir, artifactPath)));
    if (missingArtifacts.length > 0) {
      throw new Error(`Evaluator verification references missing artifacts: ${missingArtifacts.join(", ")}`);
    }
    const missingMetricSources = metricsVerifiedFrom.filter((artifactPath) => !fs.existsSync(path.join(rootDir, artifactPath)));
    if (missingMetricSources.length > 0) {
      throw new Error(`Evaluator metrics verification references missing artifacts: ${missingMetricSources.join(", ")}`);
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

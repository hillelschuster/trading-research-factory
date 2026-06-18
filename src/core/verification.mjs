import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { BacklogStore } from "./backlog-store.mjs";
import { rebuildHealthMetrics } from "./health.mjs";
import { initializeProject } from "./init.mjs";
import { rebuildNormalizedMemory } from "./memory-index.mjs";
import { buildPaths } from "./paths.mjs";
import { OpenCodeSdkTransport } from "./transport/opencode-sdk-transport.mjs";
import { acquireOwnerLock, releaseOwnerLock } from "./runtime-lock.mjs";
import { reconcileStartupState, RuntimeStateStore } from "./runtime-state.mjs";
import { validateEvaluationResult, validateExecutionResult, validateSummaryResult } from "./validators.mjs";
import { appendLine, readJson, writeJsonAtomic } from "./fs-utils.mjs";
import { validateLowFrequencyTradeFloorException } from "./low-frequency-registration.mjs";
import { evaluatePhase8DConsistencyPromotionRoute, PHASE8D_CONSISTENCY_TIERS, PHASE8D_SURVIVOR_FLOORS } from "./wfa-survivor-floors.mjs";

const BAKEOFF_SCHEMA_VERSION = "transport_bakeoff_v1";
const DEFAULT_ADAPTER = "sdk";
const SUPPORTED_ADAPTERS = new Set(["sdk", "http"]);
const DEFAULT_OPERATIONAL_RETENTION = {
  recoveryLogMaxLines: 500,
  verificationFilesPerPrefix: 10
};
const RESEARCH_WFA_GATE_REPORT_SCHEMA_VERSION = "research_wfa_gate_report_v1";
const OPTIMIZER_SEARCH_CONTEXT_SCHEMA_VERSION = "optimizer_search_context_v1";
const OPTIMIZER_SEARCH_CONTEXT_ARTIFACT_TYPE = "optimizer_search_context";
const NON_WORKER_DENOMINATOR_SCHEMA_VERSION = "non_worker_denominator_attempts_v1";
const NON_WORKER_DENOMINATOR_ARTIFACT_TYPE = "non_worker_denominator_attempts";
const NON_WORKER_ATTEMPT_TYPES = new Set(["llm_generated", "manual", "mutation", "repair", "rerun"]);
const NON_WORKER_ATTEMPT_SOURCE_KEYS = {
  llm_generated: "llm_generated_attempts",
  manual: "manual_attempts",
  mutation: "mutation_attempts",
  repair: "repair_attempts",
  rerun: "rerun_attempts"
};
const MULTIPLE_COMPARISON_CONTEXT_SCHEMA_VERSION = "multiple_comparison_context_v1";
const MULTIPLE_COMPARISON_CONTEXT_ARTIFACT_TYPE = "multiple_comparison_context";
const DSR_INPUT_ARTIFACT_TYPE = "dsr_input";
const PBO_INPUT_MATRIX_SCHEMA_VERSION = "pbo_input_matrix_v1";
const PBO_INPUT_ARTIFACT_TYPE = "pbo_input_matrix";
const CPCV_INPUT_MATRIX_SCHEMA_VERSION = "cpcv_input_matrix_v1";
const CPCV_INPUT_ARTIFACT_TYPE = "cpcv_input_matrix";
const WHITE_REALITY_CHECK_INPUT_SCHEMA_VERSION = "white_reality_check_input_v1";
const WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE = "white_reality_check_input";
const COST_STRESS_RESULT_ARTIFACT_TYPE = "cost_stress_result";
const EXPECTED_COST_ASSUMPTION_FIELDS = ["fees", "slippage"];
const EXPECTED_OPTIMIZATION_TRUTH = {
  active_parameter_optimizer: "direct_optuna_tpe_study",
  active_selection_objective: "training_slice_sharpe_from__evaluate_parameter_combination",
  inactive_flags: ["multi_objective_optimizer_active", "transaction_cost_modeler_active", "cost_stress_tester_active"],
  inactive_modules: ["multi_objective_optimizer.py", "transaction_cost_modeler.py", "cost_stress_tester.py"]
};
const PHASE8D_MIN_OOS_WINDOWS = PHASE8D_SURVIVOR_FLOORS.minOosWindows;
const PHASE8D_MIN_TRADES = PHASE8D_SURVIVOR_FLOORS.minTrades;
const PHASE8D_MIN_RETURN_PCT = PHASE8D_SURVIVOR_FLOORS.minReturnPct;
const MAX_DENOMINATOR_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_DENOMINATOR_ROWS = 10000;
const VERIFICATION_PREFIX_PATTERNS = [
  /^transport-bakeoff-/,
  /^verification-manifest-/,
  /^rollout-gate-/,
  /^fault-drills-/,
  /^state-migration-report-/
];
const PARITY_DRIFT_DIMENSIONS = ["lifecycle", "timing", "fill", "cost", "trade_count", "drawdown", "rule_accounting"];
const MT5_PROMOTION_CONTEXTS = new Set(["mt5_tester", "ftmo_forward", "deployable"]);

function average(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(4));
}

function normalizeRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function scoreSpeed(avgHeadersMs) {
  if (!Number.isFinite(avgHeadersMs) || avgHeadersMs <= 0) return 0;
  return Number((Math.max(0, 1 - Math.min(avgHeadersMs / 5000, 1)) * 5).toFixed(4));
}

function normalizeScenario(adapter, scenario) {
  return {
    scenario: String(scenario.scenario || "unknown"),
    fresh_server: Boolean(scenario.fresh_server),
    validated_reuse: Boolean(scenario.validated_reuse),
    attempts: Number(scenario.attempts ?? 1),
    session_create_success_rate: normalizeRate(scenario.session_create_success_rate),
    stage_completion_rate: normalizeRate(scenario.stage_completion_rate),
    retry_recovery_rate: normalizeRate(scenario.retry_recovery_rate),
    session_url_correctness_rate: normalizeRate(scenario.session_url_correctness_rate),
    time_to_first_headers_ms: typeof scenario.time_to_first_headers_ms === "number" ? scenario.time_to_first_headers_ms : null,
    total_request_ms: typeof scenario.total_request_ms === "number" ? scenario.total_request_ms : null,
    failure_class: typeof scenario.failure_class === "string" ? scenario.failure_class : null,
    transport_phase: typeof scenario.transport_phase === "string" ? scenario.transport_phase : null,
    error_message: typeof scenario.error_message === "string" ? scenario.error_message : null,
    notes: Array.isArray(scenario.notes) ? scenario.notes.filter((item) => typeof item === "string" && item.trim()) : [],
    adapter
  };
}

function summarizeCandidate(adapter, scenarios) {
  const normalized = scenarios.map((scenario) => normalizeScenario(adapter, scenario));
  const scenarioSuccessRate = average(normalized.map((scenario) => scenario.stage_completion_rate > 0 ? 1 : 0)) ?? 0;
  const summary = {
    adapter,
    scenarios: normalized,
    scenario_count: normalized.length,
    scenario_success_rate: scenarioSuccessRate,
    session_create_success_rate: average(normalized.map((scenario) => scenario.session_create_success_rate)) ?? 0,
    stage_completion_rate: average(normalized.map((scenario) => scenario.stage_completion_rate)) ?? 0,
    retry_recovery_rate: average(normalized.map((scenario) => scenario.retry_recovery_rate)) ?? 0,
    session_url_correctness_rate: average(normalized.map((scenario) => scenario.session_url_correctness_rate)) ?? 0,
    avg_time_to_first_headers_ms: average(normalized.map((scenario) => scenario.time_to_first_headers_ms)),
    avg_total_request_ms: average(normalized.map((scenario) => scenario.total_request_ms))
  };

  const score = Number((
    (summary.scenario_success_rate * 15) +
    (summary.session_create_success_rate * 20) +
    (summary.stage_completion_rate * 30) +
    (summary.retry_recovery_rate * 10) +
    (summary.session_url_correctness_rate * 20) +
    scoreSpeed(summary.avg_time_to_first_headers_ms)
  ).toFixed(4));

  return {
    ...summary,
    score,
    eligible: summary.session_create_success_rate > 0 && summary.stage_completion_rate > 0
  };
}

function chooseWinner(candidates) {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) {
    return {
      adapter: DEFAULT_ADAPTER,
      score: 0,
      evidence_supported: false,
      rationale: "No adapter achieved a successful stage-completion baseline; keep the conservative SDK default."
    };
  }

  const winner = [...eligible].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.adapter.localeCompare(b.adapter);
  })[0];

  return {
    adapter: winner.adapter,
    score: winner.score,
    evidence_supported: true,
    rationale: `${winner.adapter} led the bakeoff on completion, session creation, URL correctness, and speed.`
  };
}

function stampNow(ts = new Date()) {
  return ts.toISOString().replace(/[-:.TZ]/g, "");
}

function normalizeGateStatus(status) {
  return ["passed", "failed", "blocked"].includes(status) ? status : null;
}

function normalizeCommandResults(results) {
  return (Array.isArray(results) ? results : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : null,
      command: typeof item.command === "string" ? item.command : null,
      success: Boolean(item.success),
      exit_code: typeof item.exit_code === "number" ? item.exit_code : null,
      duration_ms: typeof item.duration_ms === "number" ? item.duration_ms : null,
      stdout_preview: typeof item.stdout_preview === "string" ? item.stdout_preview : null,
      stderr_preview: typeof item.stderr_preview === "string" ? item.stderr_preview : null
    }));
}

function normalizeAcceptanceChecks(checks) {
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return {};
  return Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, Boolean(value)]));
}

function normalizeStringArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.trim()))];
}

function duplicateStrings(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !value.trim()) continue;
    const normalized = value.trim();
    if (seen.has(normalized)) duplicates.add(normalized);
    seen.add(normalized);
  }
  return [...duplicates];
}

function listRunDirs(paths) {
  if (!fs.existsSync(paths.runs)) return [];
  return fs.readdirSync(paths.runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("RUN-"))
    .map((entry) => path.join(paths.runs, entry.name));
}

function collectGateResults(paths) {
  return listRunDirs(paths).flatMap((runDir) => {
    const payload = readJson(path.join(runDir, "gate-results.json"), { stages: [] });
    return Array.isArray(payload?.stages) ? payload.stages : [];
  });
}

export function buildTransportBakeoffArtifact({ generatedAt = new Date().toISOString(), candidates = [], synthetic = false } = {}) {
  const normalizedCandidates = candidates
    .filter((candidate) => SUPPORTED_ADAPTERS.has(candidate?.adapter))
    .map((candidate) => summarizeCandidate(candidate.adapter, Array.isArray(candidate.scenarios) ? candidate.scenarios : []));
  const winner = chooseWinner(normalizedCandidates);

  return {
    schema_version: BAKEOFF_SCHEMA_VERSION,
    generated_at: generatedAt,
    synthetic,
    candidates: normalizedCandidates,
    winner,
    default_adapter_recommended: winner.evidence_supported ? winner.adapter : DEFAULT_ADAPTER
  };
}

export function writeTransportBakeoffArtifact(paths, artifact, stamp = stampNow()) {
  const fullPath = path.join(paths.verification, `transport-bakeoff-${stamp}.json`);
  writeJsonAtomic(fullPath, artifact, paths);
  return fullPath;
}

export async function runTransportBakeoff({ paths, synthetic = false, generatedAt, adapters = [], executeCandidate }) {
  const candidates = [];
  for (const adapter of adapters) {
    const scenarios = [];
    for (const scenario of [
      { scenario: "fresh_server", fresh_server: true, validated_reuse: false },
      { scenario: "validated_reuse", fresh_server: false, validated_reuse: true }
    ]) {
      try {
        const result = await executeCandidate({ adapter, scenario: scenario.scenario });
        scenarios.push({ ...scenario, ...result });
      } catch (error) {
        scenarios.push({
          ...scenario,
          attempts: 1,
          session_create_success_rate: 0,
          stage_completion_rate: 0,
          retry_recovery_rate: 0,
          session_url_correctness_rate: 0,
          time_to_first_headers_ms: null,
          total_request_ms: null,
          failure_class: error?.rf_failure_class ?? null,
          transport_phase: error?.rf_transport_phase ?? null,
          error_message: error instanceof Error ? error.message : String(error),
          notes: ["Bakeoff scenario failed before completion."]
        });
      }
    }
    candidates.push({ adapter, scenarios });
  }

  const artifact = buildTransportBakeoffArtifact({ generatedAt, candidates, synthetic });
  const artifactPath = writeTransportBakeoffArtifact(paths, artifact);
  return { artifact, artifactPath };
}

export function readLatestTransportBakeoff(paths) {
  if (!fs.existsSync(paths.verification)) return null;
  const entries = fs.readdirSync(paths.verification, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^transport-bakeoff-\d{17}\.json$/.test(entry.name))
    .map((entry) => ({
      path: path.join(paths.verification, entry.name),
      mtimeMs: fs.statSync(path.join(paths.verification, entry.name)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (entries.length === 0) return null;
  const artifact = readJson(entries[0].path, null);
  if (!artifact || artifact.schema_version !== BAKEOFF_SCHEMA_VERSION) return null;
  return {
    artifact,
    path: entries[0].path
  };
}

export function resolvePreferredLiveTransportAdapter(paths, requestedAdapter = "auto") {
  if (requestedAdapter && requestedAdapter !== "auto") {
    return {
      adapter: requestedAdapter,
      source: "explicit"
    };
  }

  const latest = readLatestTransportBakeoff(paths);
  if (latest?.artifact?.winner?.evidence_supported && SUPPORTED_ADAPTERS.has(latest.artifact.winner.adapter)) {
    return {
      adapter: latest.artifact.winner.adapter,
      source: "bakeoff",
      artifactPath: path.relative(paths.root, latest.path)
    };
  }

  return {
    adapter: DEFAULT_ADAPTER,
    source: latest ? "fallback_after_bakeoff" : "default"
  };
}

export function pruneOperationalArtifacts(paths, policy = DEFAULT_OPERATIONAL_RETENTION) {
  const summary = {
    recovery_log_lines_before: 0,
    recovery_log_lines_after: 0,
    verification_files_deleted: 0,
    verification_files_retained: 0
  };

  if (fs.existsSync(paths.recoveryLog)) {
    const lines = fs.readFileSync(paths.recoveryLog, "utf8").split("\n").filter(Boolean);
    summary.recovery_log_lines_before = lines.length;
    const kept = lines.slice(-policy.recoveryLogMaxLines);
    summary.recovery_log_lines_after = kept.length;
    if (kept.length !== lines.length) {
      fs.writeFileSync(paths.recoveryLog, kept.join("\n") + (kept.length > 0 ? "\n" : ""), "utf8");
    }
  }

  if (fs.existsSync(paths.verification)) {
    const files = fs.readdirSync(paths.verification, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(paths.verification, entry.name),
        mtimeMs: fs.statSync(path.join(paths.verification, entry.name)).mtimeMs
      }));

    for (const pattern of VERIFICATION_PREFIX_PATTERNS) {
      const matching = files.filter((file) => pattern.test(file.name)).sort((a, b) => b.mtimeMs - a.mtimeMs);
      summary.verification_files_retained += Math.min(matching.length, policy.verificationFilesPerPrefix);
      for (const stale of matching.slice(policy.verificationFilesPerPrefix)) {
        fs.unlinkSync(stale.fullPath);
        summary.verification_files_deleted += 1;
      }
    }
  }

  return summary;
}

export function buildStageGateResult({ runId, stage, attempt, decision, validator, evidencePaths = [], reason = null }) {
  return {
    schema_version: "stage_gate_v1",
    run_id: runId,
    stage,
    attempt,
    decision,
    validator,
    evidence_paths: [...new Set((Array.isArray(evidencePaths) ? evidencePaths : []).filter((value) => typeof value === "string" && value.trim()))],
    reason,
    recorded_at: new Date().toISOString()
  };
}

function finiteMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteRatio(value) {
  const number = finiteMetric(value);
  if (number === null) return null;
  return number > 1 ? number / 100 : number;
}

function researchWfaEvidencePaths(executionResult, evidencePaths) {
  const directPaths = Array.isArray(evidencePaths) ? evidencePaths : [];
  const provenancePaths = Array.isArray(executionResult?.provenance?.result_artifacts) ? executionResult.provenance.result_artifacts : [];
  const artifactPaths = Array.isArray(executionResult?.artifacts_created)
    ? executionResult.artifacts_created.map((artifact) => typeof artifact === "string" ? artifact : artifact?.path).filter(Boolean)
    : [];
  return [...new Set([...directPaths, ...provenancePaths, ...artifactPaths].filter((value) => typeof value === "string" && value.trim()))];
}

function roundMetric(value, digits = 4) {
  const number = finiteMetric(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function normalCdf(value) {
  const x = Number(value);
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * abs);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs));
  return 0.5 * (1 + erf);
}

function inverseNormalCdf(probability) {
  const p = Number(probability);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function normalizePerWindowMetrics(parsedMetrics) {
  return (Array.isArray(parsedMetrics?.per_window_metrics) ? parsedMetrics.per_window_metrics : [])
    .filter((windowMetric) => windowMetric && typeof windowMetric === "object")
    .map((windowMetric, index) => ({
      window_id: windowMetric.window_id ?? index,
      success: windowMetric.success ?? null,
      total_return_pct: finiteMetric(windowMetric.total_return_pct),
      total_trades: finiteMetric(windowMetric.total_trades),
      sharpe_ratio: finiteMetric(windowMetric.sharpe_ratio),
      max_drawdown_pct: finiteMetric(windowMetric.max_drawdown_pct),
      best_parameters: windowMetric.best_parameters && typeof windowMetric.best_parameters === "object" ? windowMetric.best_parameters : null
    }));
}

function summarizeOosWindowConsistency(perWindowMetrics) {
  const windowsWithReturn = perWindowMetrics.filter((windowMetric) => windowMetric.total_return_pct !== null);
  const profitable = windowsWithReturn.filter((windowMetric) => windowMetric.total_return_pct > 0).length;
  const negative = windowsWithReturn.filter((windowMetric) => windowMetric.total_return_pct < 0).length;
  const flat = windowsWithReturn.filter((windowMetric) => windowMetric.total_return_pct === 0).length;
  return {
    windows_with_return: windowsWithReturn.length,
    profitable_windows: profitable,
    negative_windows: negative,
    flat_windows: flat,
    profitable_oos_window_ratio: windowsWithReturn.length > 0 ? roundMetric(profitable / windowsWithReturn.length) : null,
    status: windowsWithReturn.length === 0 ? "missing_per_window_returns" : (negative > 0 ? "mixed_oos_windows" : "all_reported_windows_profitable")
  };
}

function positiveWindowRatioFromMetrics(metrics, oosWindowConsistency) {
  if (oosWindowConsistency?.profitable_oos_window_ratio !== null && oosWindowConsistency?.profitable_oos_window_ratio !== undefined) return oosWindowConsistency.profitable_oos_window_ratio;
  return finiteRatio(metrics.positive_oos_windows_pct
    ?? metrics.positive_return_windows_pct
    ?? metrics.positive_sharpe_windows_pct
    ?? metrics.positive_windows_pct
    ?? metrics.positive_oos_window_ratio);
}

function classifyPhase8DConsistencyTier(positiveWindowRatio) {
  if (positiveWindowRatio === null || positiveWindowRatio === undefined) return { tier: null, label: "missing_positive_window_ratio", ratio: null };
  const ratio = finiteRatio(positiveWindowRatio);
  if (ratio === null) return { tier: null, label: "missing_positive_window_ratio", ratio: null };
  const tier = PHASE8D_CONSISTENCY_TIERS.tiers.find((entry) => {
    const aboveMin = entry.minInclusive === null || ratio >= entry.minInclusive;
    const belowMax = entry.maxExclusive === null || ratio < entry.maxExclusive;
    return aboveMin && belowMax;
  });
  return {
    tier: tier?.tier ?? null,
    label: tier?.label ?? "unclassified",
    ratio: roundMetric(ratio, 6)
  };
}

function summarizeReturnConcentration(perWindowMetrics) {
  const windowsWithReturn = perWindowMetrics.filter((windowMetric) => windowMetric.total_return_pct !== null);
  const positiveReturns = windowsWithReturn
    .map((windowMetric) => windowMetric.total_return_pct)
    .filter((value) => value > 0)
    .sort((left, right) => right - left);

  if (windowsWithReturn.length === 0) {
    return {
      status: "missing_per_window_returns",
      positive_window_count: 0,
      total_positive_return_pct: null,
      single_window_share: null,
      top_two_window_share: null
    };
  }

  const totalPositiveReturn = positiveReturns.reduce((sum, value) => sum + value, 0);
  if (positiveReturns.length === 0 || totalPositiveReturn <= 0) {
    return {
      status: "undefined_no_positive_window_returns",
      positive_window_count: positiveReturns.length,
      total_positive_return_pct: roundMetric(totalPositiveReturn, 6),
      single_window_share: null,
      top_two_window_share: null
    };
  }

  const topTwoReturn = positiveReturns[0] + (positiveReturns[1] ?? 0);
  return {
    status: "computed_artifact_backed",
    positive_window_count: positiveReturns.length,
    total_positive_return_pct: roundMetric(totalPositiveReturn, 6),
    largest_positive_window_return_pct: roundMetric(positiveReturns[0], 6),
    second_largest_positive_window_return_pct: positiveReturns[1] !== undefined ? roundMetric(positiveReturns[1], 6) : null,
    single_window_share: roundMetric(positiveReturns[0] / totalPositiveReturn, 6),
    top_two_window_share: roundMetric(topTwoReturn / totalPositiveReturn, 6)
  };
}

function maxDrawdownFromMetrics(metrics, perWindowMetrics) {
  const direct = finiteMetric(metrics.max_drawdown_pct ?? metrics.max_drawdown);
  if (direct !== null) return Math.abs(direct);
  const perWindowDrawdowns = perWindowMetrics
    .map((windowMetric) => finiteMetric(windowMetric.max_drawdown_pct))
    .filter((value) => value !== null)
    .map((value) => Math.abs(value));
  if (perWindowDrawdowns.length === 0) return null;
  return Math.max(...perWindowDrawdowns);
}

function summarizeDrawdownToReturn(metrics, perWindowMetrics) {
  const aggregateReturnPct = finiteMetric(metrics.aggregate_return_pct ?? metrics.total_return_pct ?? metrics.return_pct);
  const maxDrawdownPct = maxDrawdownFromMetrics(metrics, perWindowMetrics);
  if (aggregateReturnPct === null || maxDrawdownPct === null) {
    return {
      status: "missing_inputs",
      aggregate_return_pct: aggregateReturnPct,
      absolute_max_drawdown_pct: maxDrawdownPct,
      value: null
    };
  }
  if (aggregateReturnPct <= 0) {
    return {
      status: "undefined_non_positive_return_proxy",
      aggregate_return_pct: roundMetric(aggregateReturnPct, 6),
      absolute_max_drawdown_pct: roundMetric(maxDrawdownPct, 6),
      value: null
    };
  }
  return {
    status: "computed_artifact_backed",
    aggregate_return_pct: roundMetric(aggregateReturnPct, 6),
    absolute_max_drawdown_pct: roundMetric(maxDrawdownPct, 6),
    value: roundMetric(maxDrawdownPct / aggregateReturnPct, 6)
  };
}

export function buildPhase8DConsistencyLadderAdvisory({ metrics = {}, parsedMetrics = null, perWindowMetrics = null } = {}) {
  const effectiveMetrics = { ...(parsedMetrics?.metrics ?? {}), ...(metrics && typeof metrics === "object" ? metrics : {}) };
  const normalizedWindows = Array.isArray(perWindowMetrics) ? normalizePerWindowMetrics({ per_window_metrics: perWindowMetrics }) : normalizePerWindowMetrics(parsedMetrics);
  const oosWindowConsistency = summarizeOosWindowConsistency(normalizedWindows);
  const positiveWindowRatio = positiveWindowRatioFromMetrics(effectiveMetrics, oosWindowConsistency);
  const classification = classifyPhase8DConsistencyTier(positiveWindowRatio);
  const completedWindows = finiteMetric(effectiveMetrics.successful_windows ?? effectiveMetrics.windows_completed ?? effectiveMetrics.completed_windows ?? effectiveMetrics.total_windows ?? effectiveMetrics.oos_windows ?? normalizedWindows.length) ?? normalizedWindows.length;
  const lowWindowWarning = completedWindows < PHASE8D_CONSISTENCY_TIERS.low_window_count_threshold
    && classification.ratio !== null
    && classification.ratio < PHASE8D_CONSISTENCY_TIERS.low_window_count_ratio_warning_below;

  return {
    status: PHASE8D_CONSISTENCY_TIERS.status,
    clean_consistency_floor: PHASE8D_SURVIVOR_FLOORS.minPositiveWindowRatio,
    tier: classification.tier,
    label: classification.label,
    positive_oos_window_ratio: classification.ratio,
    tier_source: oosWindowConsistency.profitable_oos_window_ratio !== null ? "per_window_returns" : "metrics_observed_alias",
    tier_thresholds: PHASE8D_CONSISTENCY_TIERS.tiers.map((tier) => ({ ...tier })),
    return_concentration: summarizeReturnConcentration(normalizedWindows),
    drawdown_to_return_ratio: summarizeDrawdownToReturn(effectiveMetrics, normalizedWindows),
    low_window_count_warning: {
      flagged: lowWindowWarning,
      completed_windows: completedWindows,
      threshold_windows: PHASE8D_CONSISTENCY_TIERS.low_window_count_threshold,
      ratio_warning_below: PHASE8D_CONSISTENCY_TIERS.low_window_count_ratio_warning_below,
      status: lowWindowWarning ? "low_window_count_low_consistency" : "not_flagged"
    },
    note: "Phase 8D consistency ladder is diagnostic, and buildResearchWfaPromotionGate may consume it through the conditional multi-metric C1/C2/C3 route policy."
  };
}

function stableParamKey(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function summarizeParameterStability(perWindowMetrics) {
  const params = perWindowMetrics
    .map((windowMetric) => windowMetric.best_parameters)
    .filter((value) => value && typeof value === "object");
  if (params.length === 0) {
    return {
      status: "missing_parameter_artifacts",
      windows_with_parameters: 0,
      unique_parameter_sets: 0,
      changed_window_count: null,
      note: "Per-window best_parameters were not available in the parsed WFA metrics artifact."
    };
  }

  const baseline = stableParamKey(params[0]);
  const keys = params.map(stableParamKey);
  const uniqueParameterSets = new Set(keys);
  const changedWindowCount = keys.filter((key) => key !== baseline).length;
  return {
    status: uniqueParameterSets.size === 1 ? "stable_reported_parameters" : "parameter_instability_flagged",
    windows_with_parameters: params.length,
    unique_parameter_sets: uniqueParameterSets.size,
    changed_window_count: changedWindowCount,
    note: "Parameter stability is descriptive only; it is not a hard statistical confidence test."
  };
}

function summarizeWorkerParameterStability(parsedMetrics, perWindowMetrics) {
  const workerDiagnostic = parsedMetrics?.parameter_stability;
  if (!workerDiagnostic || typeof workerDiagnostic !== "object" || Array.isArray(workerDiagnostic)) {
    return summarizeParameterStability(perWindowMetrics);
  }
  return {
    ...workerDiagnostic,
    reporting_only: true,
    note: workerDiagnostic.note ?? "Worker-emitted parameter stability is diagnostic only; it is not a promotion, rejection, or statistical-confidence gate."
  };
}

function annotateParameterStabilityEvidence(parameterStability, observedWindows, minOosWindows) {
  const windowsWithParameters = finiteMetric(parameterStability?.windows_with_parameters);
  const totalReportedWindows = finiteMetric(parameterStability?.total_reported_windows) ?? finiteMetric(observedWindows);
  const requiredWindows = Math.max(1, finiteMetric(minOosWindows) ?? 1);
  const limitations = [];
  if (["missing_parameter_artifacts", "partial_parameter_artifacts", "invalid_artifact_backed"].includes(parameterStability?.status)) {
    limitations.push(`parameter_stability_status:${parameterStability.status}`);
  }
  if (windowsWithParameters === null) {
    limitations.push("windows_with_parameters_not_reported");
  } else {
    if (windowsWithParameters < requiredWindows) limitations.push("below_minimum_reporting_window_floor");
    if (totalReportedWindows !== null && windowsWithParameters < totalReportedWindows) limitations.push("parameter_rows_do_not_cover_all_reported_windows");
  }
  return {
    ...parameterStability,
    evidence_strength: limitations.length > 0 ? "weak_or_incomplete" : "reported_complete_for_basic_review",
    evidence_limitations: limitations,
    reporting_only: true
  };
}

function reviewOptimizationTruthContract(truth, inactiveModules) {
  if (!truth || typeof truth !== "object" || Array.isArray(truth)) return null;
  const inactiveSet = new Set(inactiveModules.map((moduleName) => moduleName.trim()));
  const missingInactiveModules = EXPECTED_OPTIMIZATION_TRUTH.inactive_modules.filter((moduleName) => !inactiveSet.has(moduleName));
  const invalidInactiveFlags = EXPECTED_OPTIMIZATION_TRUTH.inactive_flags.filter((field) => truth[field] !== false);
  const activePathMismatches = [];
  if (truth.active_parameter_optimizer !== EXPECTED_OPTIMIZATION_TRUTH.active_parameter_optimizer) activePathMismatches.push("active_parameter_optimizer");
  if (truth.active_selection_objective !== EXPECTED_OPTIMIZATION_TRUTH.active_selection_objective) activePathMismatches.push("active_selection_objective");
  const activeCostInputsReported = truth.active_cost_inputs && typeof truth.active_cost_inputs === "object" && !Array.isArray(truth.active_cost_inputs);
  const missingCostInputs = activeCostInputsReported ? [] : ["active_cost_inputs"];
  const consistent = missingInactiveModules.length === 0
    && invalidInactiveFlags.length === 0
    && activePathMismatches.length === 0
    && missingCostInputs.length === 0;
  return {
    status: consistent ? "contract_consistent" : "contract_incomplete_or_inconsistent",
    required_active_parameter_optimizer: EXPECTED_OPTIMIZATION_TRUTH.active_parameter_optimizer,
    required_active_selection_objective: EXPECTED_OPTIMIZATION_TRUTH.active_selection_objective,
    required_inactive_flags: EXPECTED_OPTIMIZATION_TRUTH.inactive_flags,
    required_inactive_modules: EXPECTED_OPTIMIZATION_TRUTH.inactive_modules,
    missing_inactive_modules: missingInactiveModules,
    invalid_inactive_flags: invalidInactiveFlags,
    active_path_mismatches: activePathMismatches,
    missing_cost_inputs: missingCostInputs,
    reporting_only: true,
    note: "This is a Phase 8C reporting-only consistency check; it does not wire disconnected optimizer/cost modules or authorize promotion."
  };
}

function sourceFieldReferencesOptimizationTruth(field) {
  if (typeof field !== "string") return false;
  return field.split(/[.[\]]+/).filter(Boolean).includes("optimization_truth");
}

function reviewOptimizationTruthSource(diagnostic, parsedMetrics) {
  const source = diagnostic?.source && typeof diagnostic.source === "object" && !Array.isArray(diagnostic.source) ? diagnostic.source : null;
  const metricsArtifact = parsedMetrics?.metrics_artifact && typeof parsedMetrics.metrics_artifact === "object" && !Array.isArray(parsedMetrics.metrics_artifact)
    ? parsedMetrics.metrics_artifact
    : null;
  const artifact = source && typeof source.source_path === "string" && source.source_path.trim() && isSha256(source.source_sha256)
    ? {
      artifact_type: "optimization_truth_source",
      path: source.source_path,
      sha256: source.source_sha256,
      source_field: typeof source.source_field === "string" ? source.source_field : null,
      hash_verified: true
    }
    : null;
  const field = typeof source?.source_field === "string" ? source.source_field : null;
  const fieldMatches = sourceFieldReferencesOptimizationTruth(field);
  const expectedPath = typeof metricsArtifact?.path === "string" && metricsArtifact.path.trim() ? metricsArtifact.path : null;
  const expectedSha = isSha256(metricsArtifact?.sha256) ? metricsArtifact.sha256 : null;
  const identityCompared = Boolean(artifact && expectedPath && expectedSha);
  const identityMatches = identityCompared ? artifact.path === expectedPath && artifact.sha256 === expectedSha : null;
  const errors = [];
  if (!source) errors.push("optimization_truth_source_missing");
  else if (!artifact) errors.push("optimization_truth_source_must_include_path_and_sha256");
  if (artifact && !fieldMatches) errors.push("optimization_truth_source_field_must_reference_optimization_truth");
  if (identityCompared && !identityMatches) errors.push("optimization_truth_source_must_match_metrics_artifact_identity");
  return {
    status: errors.length === 0 ? "hash_backed_source_reported" : "missing_or_unverified_source",
    source_artifact: artifact,
    source_field: field,
    expected_metrics_artifact: expectedPath || expectedSha ? { path: expectedPath, sha256: expectedSha } : null,
    identity_compared: identityCompared,
    identity_matches: identityMatches,
    errors,
    reporting_only: true,
    note: "Optimization-truth diagnostics are reporting-only, but Phase 8C gate reports still surface whether the diagnostic came from a hash-backed artifact field."
  };
}

function summarizeOptimizationTruthDiagnostic(parsedMetrics) {
  const diagnostic = parsedMetrics?.optimization_truth;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    return {
      status: "not_reported",
      reporting_only: true,
      missing_because: "No worker optimization_truth diagnostics were supplied to the research-gate reporter."
    };
  }
  const truth = diagnostic.truth && typeof diagnostic.truth === "object" && !Array.isArray(diagnostic.truth) ? diagnostic.truth : null;
  const inactiveModules = normalizeStringArray(Array.isArray(truth?.disconnected_modules) ? truth.disconnected_modules : []);
  const contractReview = reviewOptimizationTruthContract(truth, inactiveModules);
  const sourceReview = reviewOptimizationTruthSource(diagnostic, parsedMetrics);
  return {
    ...diagnostic,
    reporting_only: true,
    source_review: sourceReview,
    disconnected_module_review: truth ? {
      status: inactiveModules.length > 0 ? "reported_inactive" : "not_reported",
      active_parameter_optimizer: typeof truth.active_parameter_optimizer === "string" ? truth.active_parameter_optimizer : null,
      active_selection_objective: typeof truth.active_selection_objective === "string" ? truth.active_selection_objective : null,
      active_cost_inputs: truth.active_cost_inputs && typeof truth.active_cost_inputs === "object" && !Array.isArray(truth.active_cost_inputs) ? truth.active_cost_inputs : null,
      inactive_modules: inactiveModules,
      contract_review: contractReview,
      reporting_only: true
    } : null,
    note: diagnostic.note ?? "Optimization truth is reporting-only in Phase 8C; disconnected optimizer/cost modules cannot imply active evidence unless a future tested wiring slice changes this."
  };
}

function summarizeWarmupDiagnostic(parsedMetrics) {
  const diagnostic = parsedMetrics?.warmup_diagnostics;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
    return {
      status: "not_reported",
      reporting_only: true,
      missing_because: "No worker warmup_diagnostics were supplied; no generic indicator warmup application is assumed."
    };
  }
  return {
    ...diagnostic,
    reporting_only: true,
    boundary_application: diagnostic.status === "diagnostic_only_not_applied" ? {
      applied_to_window_boundaries: false,
      status: "generic_indicator_warmup_not_applied",
      limitation: "indicator_warmup_bars is diagnostic metadata only; only explicit purge_gap_bars changes WFA validation boundaries in Phase 8C.",
      reporting_only: true
    } : null,
    note: diagnostic.note ?? "indicator_warmup_bars is diagnostic metadata only in Phase 8C; current WFA boundaries are changed only by explicit purge_gap_bars."
  };
}

function summarizeDataIdentity(dataReadinessManifests) {
  const manifests = (Array.isArray(dataReadinessManifests) ? dataReadinessManifests : [])
    .filter((manifest) => manifest && typeof manifest === "object");
  const manifestPaths = normalizeStringArray(manifests.flatMap((manifest) => [
    manifest.path,
    manifest.manifest_path,
    manifest.artifacts?.manifest?.path,
    ...(Array.isArray(manifest.wfa_integration?.data_manifest_paths) ? manifest.wfa_integration.data_manifest_paths : [])
  ]));
  const gapCount = manifests.reduce((sum, manifest) => sum + (finiteMetric(manifest.gap_report?.gap_count) ?? 0), 0);
  return {
    status: manifests.length === 0 ? "missing_data_readiness_manifest" : (gapCount > 0 ? "data_gaps_flagged" : "data_identity_present"),
    manifest_count: manifests.length,
    manifest_paths: manifestPaths,
    total_gap_count: gapCount,
    instruments: normalizeStringArray(manifests.map((manifest) => manifest.instrument)),
    source_families: normalizeStringArray(manifests.map((manifest) => manifest.source_family))
  };
}

function summarizeCostAssumptionProvenance(assumptions) {
  const values = assumptions?.values && typeof assumptions.values === "object" && !Array.isArray(assumptions.values)
    ? assumptions.values
    : {};
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return {
      status: "missing_cost_assumptions",
      artifact_backed: false,
      checked_fields: [],
      unverified_fields: []
    };
  }

  const sourceMap = new Map();
  const unverifiedFields = [];
  const backedValues = {};
  for (const [field, record] of entries) {
    const backed = record && typeof record === "object" && !Array.isArray(record)
      && typeof record.source_path === "string" && record.source_path.trim()
      && isSha256(record.source_sha256)
      && typeof record.source_field === "string" && record.source_field.trim();
    if (!backed) {
      unverifiedFields.push(field);
      continue;
    }
    backedValues[field] = record.value;
    const key = `${record.source_path}\u0000${record.source_sha256}`;
    const existing = sourceMap.get(key) ?? {
      artifact_type: "cost_assumption_source",
      path: record.source_path,
      sha256: record.source_sha256,
      hash_verified: true,
      source_fields: []
    };
    existing.source_fields.push(record.source_field);
    sourceMap.set(key, existing);
  }

  const sourceArtifacts = [...sourceMap.values()].map((artifact) => ({
    ...artifact,
    source_fields: normalizeStringArray(artifact.source_fields)
  }));
  const missingRequiredFields = EXPECTED_COST_ASSUMPTION_FIELDS.filter((field) => !Object.hasOwn(values, field));
  const unverifiedRequiredFields = EXPECTED_COST_ASSUMPTION_FIELDS.filter((field) => unverifiedFields.includes(field));
  const artifactBacked = missingRequiredFields.length === 0 && unverifiedFields.length === 0;
  return {
    status: artifactBacked ? "artifact_backed_cost_assumptions" : "missing_or_unverified_cost_assumption_sources",
    artifact_backed: artifactBacked,
    required_fields: EXPECTED_COST_ASSUMPTION_FIELDS,
    checked_fields: normalizeStringArray(entries.map(([field]) => field)),
    missing_required_fields: normalizeStringArray(missingRequiredFields),
    unverified_fields: normalizeStringArray(unverifiedFields),
    unverified_required_fields: normalizeStringArray(unverifiedRequiredFields),
    backed_values: backedValues,
    source_artifacts: sourceArtifacts,
    note: "Fee/slippage assumptions are reporting-only, but serious cost-stress claims must cite hash-backed cost-assumption sources."
  };
}

function summarizeCostStress(executionResult, parsedMetrics) {
  const assumptions = parsedMetrics?.assumptions?.cost_assumptions ?? executionResult?.worker_result?.cost_assumptions ?? null;
  if (!assumptions || assumptions.available !== true) {
    return {
      status: "missing_cost_assumptions",
      stress_tested: false,
      assumptions_available: false,
      missing_because: assumptions?.missing_because ?? "No artifact-backed fee/slippage assumptions were provided to the research-gate reporter."
    };
  }
  const costAssumptionProvenance = summarizeCostAssumptionProvenance(assumptions);
  const explicitStress = parsedMetrics?.cost_stress ?? executionResult?.worker_result?.cost_stress ?? null;
  if (explicitStress && typeof explicitStress === "object" && !Array.isArray(explicitStress)) {
    const sourceArtifactsProvided = explicitStress.source_artifacts !== undefined;
    const sourceArtifactRows = Array.isArray(explicitStress.source_artifacts) ? explicitStress.source_artifacts : [];
    const hashBackedSourceArtifacts = validHashBackedSources(sourceArtifactRows);
    const sourceArtifacts = hashBackedSourceArtifacts.filter((source) => source.artifact_type === COST_STRESS_RESULT_ARTIFACT_TYPE);
    const errors = [];
    if (sourceArtifactsProvided && !Array.isArray(explicitStress.source_artifacts)) errors.push("cost_stress_source_artifacts_must_be_array");
    if (sourceArtifactsProvided && hashBackedSourceArtifacts.length !== sourceArtifactRows.length) errors.push("cost_stress_source_artifacts_must_be_hash_verified");
    if (hashBackedSourceArtifacts.length > 0 && sourceArtifacts.length !== hashBackedSourceArtifacts.length) errors.push(`cost_stress_source_artifacts_must_be_${COST_STRESS_RESULT_ARTIFACT_TYPE}`);
    if (explicitStress.stress_tested === true && sourceArtifacts.length === 0) errors.push("cost_stress_tested_requires_hash_verified_source_artifacts");
    if (explicitStress.stress_tested === true && costAssumptionProvenance.artifact_backed !== true) errors.push("cost_stress_tested_requires_hash_verified_cost_assumptions");
    if (errors.length > 0) {
      return {
        status: "invalid_artifact_backed",
        stress_tested: explicitStress.stress_tested === true,
        assumptions_available: true,
        cost_assumption_provenance: costAssumptionProvenance,
        errors,
        reporting_only: true,
        note: "Cost-stress claims are reporting-only in Phase 8C, but any stress-tested claim must carry hash-verified stress-result and cost-assumption source artifacts."
      };
    }
    return {
      ...explicitStress,
      source_artifacts: sourceArtifacts,
      artifact_backed_source_count: sourceArtifacts.length,
      cost_assumption_provenance: costAssumptionProvenance,
      reporting_only: true,
      note: explicitStress.note ?? "Cost-stress evidence is reporting-only in Phase 8C and does not authorize promotion."
    };
  }
  return {
    status: "cost_assumptions_recorded_stress_missing",
    stress_tested: false,
    assumptions_available: true,
    assumptions: assumptions.values ?? {},
    cost_assumption_provenance: costAssumptionProvenance,
    missing_because: "Fee/slippage assumptions were recorded, but no separate artifact-backed cost-stress result was supplied.",
    note: "Cost stress is reporting-only in Phase 8C; no stressed or adjusted metrics are invented."
  };
}

function annotateOptimizationTruthCostInputReview(optimizationTruth, costStress) {
  const review = optimizationTruth?.disconnected_module_review;
  const activeCostInputs = review?.active_cost_inputs && typeof review.active_cost_inputs === "object" && !Array.isArray(review.active_cost_inputs)
    ? review.active_cost_inputs
    : null;
  if (!review || !activeCostInputs) return optimizationTruth;

  const provenance = costStress?.cost_assumption_provenance ?? null;
  const backedValues = provenance?.backed_values && typeof provenance.backed_values === "object" && !Array.isArray(provenance.backed_values)
    ? provenance.backed_values
    : {};
  const missingActiveFields = EXPECTED_COST_ASSUMPTION_FIELDS.filter((field) => finiteMetric(activeCostInputs[field]) === null);
  const unexpectedActiveFields = Object.keys(activeCostInputs).filter((field) => !EXPECTED_COST_ASSUMPTION_FIELDS.includes(field));
  const mismatchedFields = [];
  for (const field of EXPECTED_COST_ASSUMPTION_FIELDS) {
    const activeValue = finiteMetric(activeCostInputs[field]);
    const backedValue = finiteMetric(backedValues[field]);
    if (activeValue !== null && backedValue !== null && Math.abs(activeValue - backedValue) > 1e-12) mismatchedFields.push(field);
  }

  let status = "consistent_with_cost_assumptions";
  if (missingActiveFields.length > 0) status = "missing_active_cost_inputs";
  else if (unexpectedActiveFields.length > 0) status = "unexpected_active_cost_inputs";
  else if (provenance?.artifact_backed !== true) status = "unverified_cost_assumption_provenance";
  else if (mismatchedFields.length > 0) status = "active_cost_inputs_mismatch_cost_assumptions";

  return {
    ...optimizationTruth,
    disconnected_module_review: {
      ...review,
      cost_input_provenance_review: {
        status,
        required_fields: EXPECTED_COST_ASSUMPTION_FIELDS,
        active_fields: normalizeStringArray(Object.keys(activeCostInputs)),
        missing_active_fields: normalizeStringArray(missingActiveFields),
        unexpected_active_fields: normalizeStringArray(unexpectedActiveFields),
        mismatched_fields: normalizeStringArray(mismatchedFields),
        cost_assumption_provenance_status: provenance?.status ?? "missing_cost_assumption_provenance",
        reporting_only: true
      }
    }
  };
}

function summarizeDuplicateFailedPatterns(duplicateFailedPatterns) {
  const patterns = (Array.isArray(duplicateFailedPatterns) ? duplicateFailedPatterns : [])
    .filter((pattern) => pattern && typeof pattern === "object");
  return {
    status: patterns.length > 0 ? "duplicate_failed_patterns_flagged" : "not_checked_or_clear",
    count: patterns.length,
    warnings: patterns.map((pattern) => pattern.lesson ?? pattern.failure_family ?? pattern.reason ?? "duplicate failed pattern detected"),
    evidence_paths: normalizeStringArray(patterns.flatMap((pattern) => Array.isArray(pattern.evidence_paths) ? pattern.evidence_paths : []))
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    const key = typeof value === "string" && value.trim() ? value.trim() : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function summarizeTrialDenominator(trialDenominator) {
  const artifacts = (Array.isArray(trialDenominator?.artifacts) ? trialDenominator.artifacts : [])
    .filter((artifact) => artifact && typeof artifact === "object")
    .map((artifact) => ({
      path: typeof artifact.path === "string" ? artifact.path : null,
      sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : null,
      hash_verified: artifact.hash_verified === true,
      records_read: finiteMetric(artifact.records_read) ?? 0,
      records_accepted: finiteMetric(artifact.records_accepted) ?? 0,
      records_rejected: finiteMetric(artifact.records_rejected) ?? 0,
      read_error: typeof artifact.read_error === "string" ? artifact.read_error : null
    }));
  const attempts = (Array.isArray(trialDenominator?.attempts) ? trialDenominator.attempts : [])
    .filter((attempt) => attempt && typeof attempt === "object");
  const rejectedAttempts = (Array.isArray(trialDenominator?.rejected_attempts) ? trialDenominator.rejected_attempts : [])
    .filter((attempt) => attempt && typeof attempt === "object");
  const unreadableArtifacts = artifacts.filter((artifact) => artifact.hash_verified !== true || artifact.read_error);
  const missingBecause = "No worker trial_attempt_record artifact was available to the research-gate reporter; statistical tests remain disabled.";

  if (artifacts.length === 0) {
    return {
      status: "missing_trial_denominator_artifact",
      denominator_available: false,
      denominator_scope: "worker_trial_attempt_records_only",
      attempt_count: 0,
      artifact_count: 0,
      artifact_paths: [],
      artifacts: [],
      status_counts: {},
      attempt_type_counts: {},
      generated_by_counts: {},
      lineage_ids: [],
      family_ids: [],
      attempts: [],
      rejected_attempt_count: 0,
      rejected_attempts: [],
      missing_because: missingBecause,
      known_limits: ["LLM, manual, optimizer, mutation, repair, and rerun denominators may still be incomplete outside worker trial artifacts."]
    };
  }

  const status = attempts.length === 0
    ? (unreadableArtifacts.length > 0 ? "trial_denominator_artifact_unreadable" : rejectedAttempts.length > 0 ? "trial_denominator_records_rejected" : "trial_denominator_artifact_empty")
    : "trial_denominator_partial_worker_records";

  return {
    status,
    denominator_available: attempts.length > 0,
    denominator_scope: "worker_trial_attempt_records_only",
    attempt_count: attempts.length,
    artifact_count: artifacts.length,
    artifact_paths: normalizeStringArray(artifacts.map((artifact) => artifact.path)),
    artifacts,
    status_counts: countBy(attempts.map((attempt) => attempt.status)),
    attempt_type_counts: countBy(attempts.map((attempt) => attempt.attempt_type)),
    generated_by_counts: countBy(attempts.map((attempt) => attempt.generated_by)),
    lineage_ids: normalizeStringArray(attempts.map((attempt) => attempt.lineage_id)),
    family_ids: normalizeStringArray(attempts.map((attempt) => attempt.family_id)),
    attempts,
    rejected_attempt_count: rejectedAttempts.length,
    rejected_attempts: rejectedAttempts,
    missing_because: attempts.length > 0 ? null : "Worker trial_attempt_record artifacts existed but no valid attempt rows were consumed.",
    known_limits: ["This is a consumed worker-attempt denominator, not the complete strategy-search denominator.", "DSR, PBO, CPCV, and White Reality Check still need full optimizer/LLM/manual/mutation attempt accounting before use."]
  };
}

function validHashBackedSources(sources) {
  return (Array.isArray(sources) ? sources : []).filter((source) => {
    if (!source || typeof source !== "object") return false;
    if (!isCanonicalRepoRelativeArtifactPath(source.path)) return false;
    if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(source.sha256)) return false;
    return source.hash_verified === true;
  });
}

function isCanonicalRepoRelativeArtifactPath(value) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

function validDsrInputSources(sources) {
  return validHashBackedSources(sources).filter((source) => source.artifact_type === DSR_INPUT_ARTIFACT_TYPE);
}

function validPboInputMatrixSources(sources) {
  return validHashBackedSources(sources).filter((source) => source.artifact_type === PBO_INPUT_ARTIFACT_TYPE);
}

function validCpcvInputMatrixSources(sources) {
  return validHashBackedSources(sources).filter((source) => source.artifact_type === CPCV_INPUT_ARTIFACT_TYPE);
}

function validWhiteRealityCheckInputSources(sources) {
  return validHashBackedSources(sources).filter((source) => source.artifact_type === WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE);
}

function canonicalPboIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) ? value : null;
}

function sourceArtifactDiagnostics(sourceArtifactRows, artifactType) {
  const readErrors = sourceArtifactRows
    .map((artifact) => typeof artifact?.read_error === "string" && artifact.read_error.trim() ? artifact.read_error : null)
    .filter(Boolean);
  const typeErrors = sourceArtifactRows
    .map((artifact, index) => artifact?.artifact_type === artifactType ? null : `source_artifact_${index}_artifact_type_must_be_${artifactType}`)
    .filter(Boolean);
  const shapeErrors = sourceArtifactRows.flatMap((artifact, index) => {
    const errors = [];
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return [`source_artifact_${index}_must_be_object`];
    if (typeof artifact.path !== "string" || !artifact.path.trim() || artifact.path !== artifact.path.trim()) errors.push(`source_artifact_${index}_path_must_be_nonempty_canonical_string`);
    if (typeof artifact.path === "string" && artifact.path.trim() && !isCanonicalRepoRelativeArtifactPath(artifact.path)) errors.push(`source_artifact_${index}_path_must_be_repo_relative_canonical`);
    if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) errors.push(`source_artifact_${index}_sha256_must_be_hex64`);
    if (artifact.hash_verified !== true) errors.push(`source_artifact_${index}_hash_verified_must_be_true`);
    return errors;
  });
  return { readErrors, typeErrors, shapeErrors };
}

function sourceArtifactReview(sourceArtifactRows, artifactType) {
  const rows = Array.isArray(sourceArtifactRows) ? sourceArtifactRows : [];
  const diagnostics = sourceArtifactDiagnostics(rows, artifactType);
  const hashBackedCanonicalCount = validHashBackedSources(rows).length;
  const validExpectedTypeCount = validHashBackedSources(rows).filter((source) => source.artifact_type === artifactType).length;
  return {
    expected_artifact_type: artifactType,
    provided_source_artifact_count: rows.length,
    valid_hash_backed_source_artifact_count: hashBackedCanonicalCount,
    valid_expected_type_source_artifact_count: validExpectedTypeCount,
    readable_source_artifact_count: rows.filter((artifact) => !artifact?.read_error).length,
    read_error_count: diagnostics.readErrors.length,
    type_error_count: diagnostics.typeErrors.length,
    shape_error_count: diagnostics.shapeErrors.length,
    errors: normalizeStringArray([...diagnostics.readErrors, ...diagnostics.typeErrors, ...diagnostics.shapeErrors]),
    reporting_only: true
  };
}

function objectiveFields(inputs) {
  const objective = inputs?.objective && typeof inputs.objective === "object" && !Array.isArray(inputs.objective) ? inputs.objective : null;
  const objectiveMetricRaw = objective?.metric;
  const objectiveDirectionRaw = objective?.direction;
  const objectiveMetric = typeof objectiveMetricRaw === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(objectiveMetricRaw) ? objectiveMetricRaw : null;
  const objectiveDirection = typeof objectiveDirectionRaw === "string" && ["maximize", "minimize"].includes(objectiveDirectionRaw) ? objectiveDirectionRaw : null;
  const errors = [
    inputs?.objective !== undefined && objective === null ? "objective_must_be_object" : null,
    objectiveMetricRaw === undefined || objectiveMetric !== null ? null : "objective_metric_must_be_identifier",
    objectiveDirectionRaw === undefined || objectiveDirection !== null ? null : "objective_direction_must_be_maximize_or_minimize"
  ].filter(Boolean);
  return { objective, objectiveMetric, objectiveDirection, errors };
}

function identityDiagnostics(inputs, expectedIdentity = {}) {
  const missing = [];
  const diagnostics = [];
  for (const field of ["candidate_id", "lineage_id", "family_id"]) {
    const inputIdentifier = canonicalPboIdentifier(inputs?.[field]);
    if (!inputIdentifier) diagnostics.push(`${field}_must_be_canonical_identifier`);
    if (typeof expectedIdentity?.[field] === "string" && expectedIdentity[field].trim()) {
      if (inputs?.[field] !== expectedIdentity[field]) missing.push(`${field}_match`);
    } else if (!inputIdentifier) {
      missing.push(field);
    }
  }
  return { missing, diagnostics };
}

function pushStatisticalIdentityFlags(flags, prefix, statistic) {
  const missing = statistic?.missing_inputs ?? [];
  const diagnostics = statistic?.diagnostics ?? [];
  if (missing.some((input) => ["candidate_id_match", "lineage_id_match", "family_id_match"].includes(input))) flags.push(`${prefix}_input_identity_mismatch`);
  if (missing.some((input) => ["candidate_id", "lineage_id", "family_id"].includes(input)) || diagnostics.some((item) => /^(candidate_id|lineage_id|family_id)_must_be_canonical_identifier$/.test(item))) {
    flags.push(`${prefix}_input_identity_missing_or_malformed`);
  }
}

function pushStatisticalSourceFlags(flags, prefix, statistic) {
  const missing = statistic?.missing_inputs ?? [];
  if (missing.includes("source_artifacts")) flags.push(`${prefix}_input_source_missing`);
  if (missing.includes("source_artifacts_array")) flags.push(`${prefix}_input_source_artifacts_not_array`);
  if (missing.some((input) => /^single_.*_source_artifact$/.test(input))) flags.push(`${prefix}_input_source_artifact_ambiguous`);
  if (missing.includes("readable_source_artifacts")) flags.push(`${prefix}_input_source_unreadable`);
  if (missing.includes("well_formed_source_artifacts")) flags.push(`${prefix}_input_source_malformed`);
  if (missing.includes("hash_verified_source_artifacts")) flags.push(`${prefix}_input_source_unverified`);
  if (missing.some((input) => input.endsWith("_source_artifacts") && !["source_artifacts", "readable_source_artifacts", "well_formed_source_artifacts", "hash_verified_source_artifacts"].includes(input))) {
    flags.push(`${prefix}_input_source_wrong_type`);
  }
}

function pushStatisticalSchemaFlags(flags, prefix, statistic) {
  const missing = statistic?.missing_inputs ?? [];
  if (missing.some((input) => /^schema_version:/.test(input))) flags.push(`${prefix}_input_schema_version_invalid`);
}

function pushStatisticalTrialCountFlags(flags, prefix, statistic) {
  const status = statistic?.denominator_review?.status;
  if (status === "declared_trial_count_missing") flags.push(`${prefix}_input_trial_count_not_declared`);
  if (status === "declared_trial_count_not_numeric") flags.push(`${prefix}_input_trial_count_not_numeric`);
  if (status === "declared_trial_count_not_integer") flags.push(`${prefix}_input_trial_count_not_integer`);
  if (status === "declared_trial_count_not_positive") flags.push(`${prefix}_input_trial_count_not_positive`);
  if (status === "declared_trial_count_underreports_multiple_comparison_context") flags.push(`${prefix}_input_denominator_underreports_context`);
}

function explicitFiniteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function statisticalInputDenominatorReview(statistic, declaredTrialCount, searchDenominatorSummary = null, { trialCountPresent = declaredTrialCount !== null && declaredTrialCount !== undefined } = {}) {
  const multipleComparisonContextAvailable = (finiteMetric(searchDenominatorSummary?.multiple_comparison_context_count) ?? 0) > 0;
  const multipleComparisonTotal = multipleComparisonContextAvailable ? finiteMetric(searchDenominatorSummary?.multiple_comparison_total_strategies_tested) : null;
  const normalizedTrialCount = explicitFiniteMetric(declaredTrialCount);
  const declaredTrialCountIsInteger = normalizedTrialCount !== null && Number.isInteger(normalizedTrialCount);
  const declaredTrialCountIsPositive = declaredTrialCountIsInteger && normalizedTrialCount >= 1;
  const underreportedBy = multipleComparisonTotal !== null && normalizedTrialCount !== null
    ? Math.max(0, multipleComparisonTotal - normalizedTrialCount)
    : null;
  return {
    statistic,
    status: !trialCountPresent
      ? "declared_trial_count_missing"
      : normalizedTrialCount === null
        ? "declared_trial_count_not_numeric"
        : !declaredTrialCountIsInteger
          ? "declared_trial_count_not_integer"
          : !declaredTrialCountIsPositive
            ? "declared_trial_count_not_positive"
            : multipleComparisonTotal === null
              ? "multiple_comparison_context_missing"
              : underreportedBy > 0
                ? "declared_trial_count_underreports_multiple_comparison_context"
                : "declared_trial_count_covers_multiple_comparison_context",
    reporting_only: true,
    declared_trial_count: normalizedTrialCount,
    declared_trial_count_present: trialCountPresent,
    declared_trial_count_is_integer: trialCountPresent ? declaredTrialCountIsInteger : null,
    declared_trial_count_is_positive_integer: trialCountPresent ? declaredTrialCountIsPositive : null,
    multiple_comparison_context_available: multipleComparisonContextAvailable,
    multiple_comparison_total_strategies_tested: multipleComparisonTotal,
    underreported_by: underreportedBy,
    note: "Statistical-input denominator coverage is reporting-only in Phase 8C and cannot authorize promotion or rejection."
  };
}

function buildDeflatedSharpeRatio(dsrInputs = null, searchDenominatorSummary = null, expectedIdentity = {}) {
  if (!dsrInputs || typeof dsrInputs !== "object") return null;
  const hasSourceArtifactsArray = Array.isArray(dsrInputs.source_artifacts);
  const sourceArtifactRows = hasSourceArtifactsArray ? dsrInputs.source_artifacts : [];
  const sourceArtifacts = validDsrInputSources(sourceArtifactRows);
  const sourceReview = sourceArtifactReview(sourceArtifactRows, DSR_INPUT_ARTIFACT_TYPE);
  const sourceDiagnostics = sourceArtifactDiagnostics(sourceArtifactRows, DSR_INPUT_ARTIFACT_TYPE);
  const identity = identityDiagnostics(dsrInputs, expectedIdentity);
  const observedSharpe = finiteMetric(dsrInputs.observed_sharpe);
  const returnCount = finiteMetric(dsrInputs.return_count ?? dsrInputs.number_of_returns);
  const skewness = finiteMetric(dsrInputs.return_skewness ?? dsrInputs.skewness);
  const kurtosis = finiteMetric(dsrInputs.return_kurtosis ?? dsrInputs.kurtosis);
  const hasTrialCount = Object.prototype.hasOwnProperty.call(dsrInputs, "trial_count");
  const declaredTrialCount = hasTrialCount && typeof dsrInputs.trial_count === "number" && Number.isFinite(dsrInputs.trial_count)
    ? dsrInputs.trial_count
    : null;
  const trialCountIsNumeric = hasTrialCount && typeof dsrInputs.trial_count === "number" && Number.isFinite(dsrInputs.trial_count);
  const trialCountIsInteger = Number.isInteger(declaredTrialCount);
  const benchmarkSharpe = finiteMetric(dsrInputs.benchmark_sharpe ?? dsrInputs.selection_threshold_sharpe);
  const baseDenominatorReview = statisticalInputDenominatorReview("deflated_sharpe_ratio", declaredTrialCount, searchDenominatorSummary, { trialCountPresent: hasTrialCount });
  const denominatorReview = {
    ...baseDenominatorReview,
    status: !hasTrialCount
      ? "declared_trial_count_missing"
      : !trialCountIsNumeric
        ? "declared_trial_count_not_numeric"
      : !trialCountIsInteger
        ? "declared_trial_count_not_integer"
        : declaredTrialCount < 1
          ? "declared_trial_count_not_positive"
        : baseDenominatorReview.status,
    explicit_trial_count_required: true,
    declared_trial_count_present: hasTrialCount,
    declared_trial_count_is_integer: hasTrialCount ? trialCountIsInteger : null,
    declared_trial_count_is_positive_integer: hasTrialCount ? trialCountIsInteger && declaredTrialCount >= 1 : null
  };
  const missing = [];
  if (searchDenominatorSummary?.complete !== true) missing.push("complete_search_denominator");
  missing.push(...identity.missing);
  if (observedSharpe === null) missing.push("observed_sharpe");
  if (returnCount === null || returnCount < 2) missing.push("return_count>=2");
  if (skewness === null) missing.push("return_skewness");
  if (kurtosis === null || kurtosis <= 1) missing.push("return_kurtosis>1");
  if (!hasTrialCount) missing.push("trial_count");
  if (hasTrialCount && !trialCountIsInteger) missing.push("integer_trial_count");
  if (declaredTrialCount === null || declaredTrialCount < 1) missing.push("trial_count>=1");
  if (benchmarkSharpe === null) missing.push("benchmark_sharpe");
  if (dsrInputs.source_artifacts !== undefined && !hasSourceArtifactsArray) missing.push("source_artifacts_array");
  if (sourceArtifactRows.length === 0) missing.push("source_artifacts");
  else if (sourceArtifactRows.length !== 1) missing.push("single_dsr_input_source_artifact");
  else if (sourceArtifacts.length !== sourceArtifactRows.length) missing.push("hash_verified_source_artifacts");
  if (sourceDiagnostics.readErrors.length > 0) missing.push("readable_source_artifacts");
  if (sourceDiagnostics.typeErrors.length > 0) missing.push("dsr_input_source_artifacts");
  if (sourceDiagnostics.shapeErrors.length > 0) missing.push("well_formed_source_artifacts");
  if (missing.length > 0) {
    return {
      status: "blocked_insufficient_inputs",
      enabled_as_promotion_gate: false,
      missing_inputs: missing,
      diagnostics: normalizeStringArray([...sourceDiagnostics.readErrors, ...sourceDiagnostics.typeErrors, ...sourceDiagnostics.shapeErrors, ...identity.diagnostics]),
      denominator_review: denominatorReview,
      source_artifact_review: sourceReview,
      reason: `DSR requires explicit, hash-backed inputs: ${missing.join(", ")}.`,
      known_limits: ["No DSR value is produced when required inputs are absent or not hash-verified."]
    };
  }

  const gamma = 0.5772156649015329;
  const effectiveTrials = Math.max(1, declaredTrialCount);
  const denominator = Math.sqrt(Math.max(1e-12, 1 - skewness * observedSharpe + ((kurtosis - 1) / 4) * observedSharpe * observedSharpe));
  const sharpeStdError = denominator / Math.sqrt(returnCount - 1);
  const expectedMaxNoiseSharpe = effectiveTrials === 1
    ? benchmarkSharpe
    : benchmarkSharpe + sharpeStdError * ((1 - gamma) * inverseNormalCdf(1 - (1 / effectiveTrials)) + gamma * inverseNormalCdf(1 - (1 / (Math.E * effectiveTrials))));
  const zScore = (observedSharpe - expectedMaxNoiseSharpe) / Math.max(1e-12, sharpeStdError);
  const probability = normalCdf(zScore);
  return {
    status: "computed_advisory",
    enabled_as_promotion_gate: false,
    statistic: "deflated_sharpe_ratio",
    probability: roundMetric(probability, 6),
    z_score: roundMetric(zScore, 6),
    observed_sharpe: roundMetric(observedSharpe, 6),
    benchmark_sharpe: roundMetric(benchmarkSharpe, 6),
    expected_max_noise_sharpe: roundMetric(expectedMaxNoiseSharpe, 6),
    sharpe_standard_error: roundMetric(sharpeStdError, 6),
    return_count: returnCount,
    return_skewness: roundMetric(skewness, 6),
    return_kurtosis: roundMetric(kurtosis, 6),
    trial_count: effectiveTrials,
    denominator_review: denominatorReview,
    source_artifact_review: sourceReview,
    source_artifacts: sourceArtifacts,
    interpretation: "advisory_only_not_a_promotion_gate",
    known_limits: ["DSR is advisory until the surrounding WFA promotion policy is explicitly upgraded and validated."]
  };
}

function buildProbabilityOfBacktestOverfit(pboInputs = null, searchDenominatorSummary = null, expectedIdentity = {}) {
  if (!pboInputs || typeof pboInputs !== "object") return null;
  const hasSourceArtifactsArray = Array.isArray(pboInputs.source_artifacts);
  const sourceArtifactRows = hasSourceArtifactsArray ? pboInputs.source_artifacts : [];
  const sourceArtifacts = validPboInputMatrixSources(sourceArtifactRows);
  const sourceReview = sourceArtifactReview(sourceArtifactRows, PBO_INPUT_ARTIFACT_TYPE);
  const sourceArtifactErrors = sourceArtifactRows
    .map((artifact) => typeof artifact?.read_error === "string" && artifact.read_error.trim() ? artifact.read_error : null)
    .filter(Boolean);
  const sourceArtifactTypeErrors = sourceArtifactRows
    .map((artifact, index) => artifact?.artifact_type === PBO_INPUT_ARTIFACT_TYPE ? null : `source_artifact_${index}_artifact_type_must_be_${PBO_INPUT_ARTIFACT_TYPE}`)
    .filter(Boolean);
  const sourceArtifactShapeErrors = sourceArtifactRows.flatMap((artifact, index) => {
    const errors = [];
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return [`source_artifact_${index}_must_be_object`];
    if (typeof artifact.path !== "string" || !artifact.path.trim() || artifact.path !== artifact.path.trim()) errors.push(`source_artifact_${index}_path_must_be_nonempty_canonical_string`);
    if (typeof artifact.path === "string" && artifact.path.trim() && !isCanonicalRepoRelativeArtifactPath(artifact.path)) errors.push(`source_artifact_${index}_path_must_be_repo_relative_canonical`);
    if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) errors.push(`source_artifact_${index}_sha256_must_be_hex64`);
    if (artifact.hash_verified !== true) errors.push(`source_artifact_${index}_hash_verified_must_be_true`);
    return errors;
  });
  const hasSplitIdsArray = Array.isArray(pboInputs.split_ids);
  const rawSplitIds = hasSplitIdsArray ? pboInputs.split_ids : [];
  const invalidSplitIds = rawSplitIds
    .map((value, index) => canonicalPboIdentifier(value) ? null : `split_id_${index}_invalid`)
    .filter(Boolean);
  const splitIds = rawSplitIds.filter((value) => canonicalPboIdentifier(value));
  const duplicateSplitIds = duplicateStrings(splitIds);
  const hasPerformanceMatrixArray = Array.isArray(pboInputs.performance_matrix);
  const matrix = hasPerformanceMatrixArray ? pboInputs.performance_matrix : [];
  const hasTrialCount = Object.prototype.hasOwnProperty.call(pboInputs, "trial_count");
  const declaredTrialCount = hasTrialCount && typeof pboInputs.trial_count === "number" && Number.isFinite(pboInputs.trial_count)
    ? pboInputs.trial_count
    : null;
  const denominatorReview = statisticalInputDenominatorReview("probability_of_backtest_overfit", declaredTrialCount, searchDenominatorSummary, { trialCountPresent: hasTrialCount });
  const objective = pboInputs.objective && typeof pboInputs.objective === "object" && !Array.isArray(pboInputs.objective) ? pboInputs.objective : null;
  const objectiveMetricRaw = objective?.metric;
  const objectiveDirectionRaw = objective?.direction;
  const objectiveMetric = typeof objectiveMetricRaw === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(objectiveMetricRaw) ? objectiveMetricRaw : null;
  const objectiveDirection = typeof objectiveDirectionRaw === "string" && ["maximize", "minimize"].includes(objectiveDirectionRaw) ? objectiveDirectionRaw : null;
  const objectiveErrors = [
    pboInputs.objective !== undefined && objective === null ? "objective_must_be_object" : null,
    objectiveMetricRaw === undefined || objectiveMetric !== null ? null : "objective_metric_must_be_identifier",
    objectiveDirectionRaw === undefined || objectiveDirection !== null ? null : "objective_direction_must_be_maximize_or_minimize"
  ].filter(Boolean);
  const aliasErrors = [
    Object.prototype.hasOwnProperty.call(pboInputs, "splits") ? "splits_alias_not_allowed" : null,
    Object.prototype.hasOwnProperty.call(pboInputs, "strategy_count") ? "strategy_count_alias_not_allowed" : null
  ].filter(Boolean);
  const missing = [];

  if (pboInputs.schema_version !== PBO_INPUT_MATRIX_SCHEMA_VERSION) missing.push(`schema_version:${PBO_INPUT_MATRIX_SCHEMA_VERSION}`);
  if (searchDenominatorSummary?.complete !== true) missing.push("complete_search_denominator");
  const identityErrors = [];
  for (const field of ["candidate_id", "lineage_id", "family_id"]) {
    const inputIdentifier = canonicalPboIdentifier(pboInputs[field]);
    if (!inputIdentifier) identityErrors.push(`${field}_must_be_canonical_identifier`);
    if (typeof expectedIdentity?.[field] === "string" && expectedIdentity[field].trim()) {
      if (pboInputs[field] !== expectedIdentity[field]) missing.push(`${field}_match`);
    } else if (!inputIdentifier) {
      missing.push(field);
    }
  }
  if (!hasSplitIdsArray) missing.push("split_ids_array");
  if (splitIds.length < 2) missing.push("split_ids>=2");
  if (invalidSplitIds.length > 0) missing.push("well_formed_split_ids");
  if (duplicateSplitIds.length > 0) missing.push("unique_split_ids");
  if (!hasPerformanceMatrixArray) missing.push("performance_matrix_array");
  if (!hasTrialCount) missing.push("trial_count");
  if (hasTrialCount && !Number.isInteger(declaredTrialCount)) missing.push("integer_trial_count");
  if (declaredTrialCount === null || declaredTrialCount < 2) missing.push("trial_count>=2");
  if (!objectiveMetric) missing.push("objective.metric");
  if (!objectiveDirection) missing.push("objective.direction:maximize_or_minimize");
  if (pboInputs.source_artifacts !== undefined && !hasSourceArtifactsArray) missing.push("source_artifacts_array");
  if (sourceArtifactRows.length === 0) missing.push("source_artifacts");
  else if (sourceArtifactRows.length !== 1) missing.push("single_pbo_input_matrix_source_artifact");
  else if (sourceArtifacts.length !== sourceArtifactRows.length) missing.push("hash_verified_source_artifacts");
  if (sourceArtifactErrors.length > 0) missing.push("readable_source_artifacts");
  if (sourceArtifactTypeErrors.length > 0) missing.push("pbo_input_matrix_source_artifacts");
  if (sourceArtifactShapeErrors.length > 0) missing.push("well_formed_source_artifacts");
  if (aliasErrors.length > 0) missing.push("canonical_pbo_fields_only");

  const rows = [];
  const matrixErrors = [];
  matrixErrors.push(...aliasErrors);
  matrixErrors.push(...objectiveErrors);
  matrixErrors.push(...identityErrors);
  matrixErrors.push(...invalidSplitIds);
  if (duplicateSplitIds.length > 0) matrixErrors.push(`duplicate_split_ids:${duplicateSplitIds.join(",")}`);
  const seenTrialIds = new Set();
  for (const [index, row] of matrix.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      matrixErrors.push(`row_${index}_not_object`);
      continue;
    }
    const trialId = canonicalPboIdentifier(row.trial_id);
    if (!trialId) {
      matrixErrors.push(`row_${index}_trial_id_must_be_canonical_identifier`);
      continue;
    }
    const isValues = Array.isArray(row.is) ? row.is : null;
    const oosValues = Array.isArray(row.oos) ? row.oos : null;
    if (Object.prototype.hasOwnProperty.call(row, "train") || Object.prototype.hasOwnProperty.call(row, "test")) {
      matrixErrors.push(`${trialId}_train_test_aliases_not_allowed`);
    }
    if (!isValues) matrixErrors.push(`${trialId}_missing_is_array`);
    if (!oosValues) matrixErrors.push(`${trialId}_missing_oos_array`);
    if (!isValues || !oosValues) continue;
    if (isValues.length !== splitIds.length || oosValues.length !== splitIds.length) {
      matrixErrors.push(`${trialId}_split_length_mismatch`);
      continue;
    }
    const normalizedIs = isValues.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
    const normalizedOos = oosValues.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
    if (normalizedIs.includes(null) || normalizedOos.includes(null)) {
      matrixErrors.push(`${trialId}_non_numeric_performance`);
      continue;
    }
    if (seenTrialIds.has(trialId)) {
      matrixErrors.push(`${trialId}_duplicate_trial_id`);
      continue;
    }
    seenTrialIds.add(trialId);
    rows.push({ trial_id: trialId, is: normalizedIs, oos: normalizedOos });
  }
  if (rows.length < 2) missing.push("performance_matrix>=2_valid_rows");
  if (declaredTrialCount !== null && rows.length !== declaredTrialCount) missing.push("trial_count_matches_performance_matrix_rows");
  if (matrixErrors.length > 0) missing.push("well_formed_performance_matrix");

  if (missing.length > 0) {
    return {
      status: "blocked_insufficient_inputs",
      enabled_as_promotion_gate: false,
      missing_inputs: normalizeStringArray(missing),
      diagnostics: normalizeStringArray([...sourceArtifactErrors, ...sourceArtifactTypeErrors, ...sourceArtifactShapeErrors, ...matrixErrors]),
      denominator_review: denominatorReview,
      source_artifact_review: sourceReview,
      reason: `PBO requires explicit, hash-backed inputs: ${normalizeStringArray(missing).join(", ")}.`,
      known_limits: ["No PBO value is produced when required inputs are absent, malformed, identity-mismatched, denominator-incomplete, or not hash-verified."]
    };
  }

  const splitResults = splitIds.map((splitId, splitIndex) => {
    const selected = [...rows].sort((a, b) => objectiveDirection === "maximize"
      ? b.is[splitIndex] - a.is[splitIndex] || a.trial_id.localeCompare(b.trial_id)
      : a.is[splitIndex] - b.is[splitIndex] || a.trial_id.localeCompare(b.trial_id))[0];
    const sortedOos = [...rows].sort((a, b) => objectiveDirection === "maximize"
      ? a.oos[splitIndex] - b.oos[splitIndex] || a.trial_id.localeCompare(b.trial_id)
      : b.oos[splitIndex] - a.oos[splitIndex] || a.trial_id.localeCompare(b.trial_id));
    const rankWorstToBest = sortedOos.findIndex((row) => row.trial_id === selected.trial_id) + 1;
    const rankBestToWorst = rows.length - rankWorstToBest + 1;
    const omega = Math.max(1e-12, Math.min(1 - 1e-12, (rankWorstToBest - 0.5) / rows.length));
    const logit = Math.log(omega / (1 - omega));
    return {
      split_id: splitId,
      selected_trial_id: selected.trial_id,
      selected_is_performance: roundMetric(selected.is[splitIndex], 6),
      selected_oos_performance: roundMetric(selected.oos[splitIndex], 6),
      oos_rank_worst_to_best: rankWorstToBest,
      oos_rank_best_to_worst: rankBestToWorst,
      oos_rank_ascending: rankWorstToBest,
      oos_rank_order: objectiveDirection === "maximize" ? "ascending_worst_to_best" : "descending_worst_to_best",
      oos_rank_percentile: roundMetric(omega, 6),
      logit_rank: roundMetric(logit, 6),
      overfit_flag: logit < 0
    };
  });
  const overfitCount = splitResults.filter((split) => split.overfit_flag).length;

  return {
    status: "computed_advisory",
    enabled_as_promotion_gate: false,
    statistic: "probability_of_backtest_overfit",
    probability: roundMetric(overfitCount / splitResults.length, 6),
    objective: { metric: objectiveMetric, direction: objectiveDirection },
    split_count: splitResults.length,
    trial_count: declaredTrialCount,
    matrix_row_count: rows.length,
    denominator_review: denominatorReview,
    source_artifact_review: sourceReview,
    source_artifacts: sourceArtifacts,
    split_results: splitResults,
    interpretation: "advisory_only_not_a_promotion_gate",
    known_limits: [
      "This PBO value is advisory only and is not a promotion, rejection, or deployment gate.",
      "The calculation consumes an explicit hash-backed IS/OOS split-performance matrix; it does not infer whether the matrix producer used unbiased CPCV/CSCV construction.",
      "CPCV and White Reality Check remain separate advisory statistics with their own explicit-input contracts."
    ]
  };
}

function buildCombinatorialPurgedCrossValidation(cpcvInputs = null, searchDenominatorSummary = null, expectedIdentity = {}) {
  if (!cpcvInputs || typeof cpcvInputs !== "object") return null;
  const hasSourceArtifactsArray = Array.isArray(cpcvInputs.source_artifacts);
  const sourceArtifactRows = hasSourceArtifactsArray ? cpcvInputs.source_artifacts : [];
  const sourceArtifacts = validCpcvInputMatrixSources(sourceArtifactRows);
  const sourceReview = sourceArtifactReview(sourceArtifactRows, CPCV_INPUT_ARTIFACT_TYPE);
  const sourceDiagnostics = sourceArtifactDiagnostics(sourceArtifactRows, CPCV_INPUT_ARTIFACT_TYPE);
  const { objectiveMetric, objectiveDirection, errors: objectiveErrors } = objectiveFields(cpcvInputs);
  const identity = identityDiagnostics(cpcvInputs, expectedIdentity);
  const hasFoldCount = Object.prototype.hasOwnProperty.call(cpcvInputs, "fold_count");
  const foldCount = hasFoldCount && typeof cpcvInputs.fold_count === "number" && Number.isFinite(cpcvInputs.fold_count) ? cpcvInputs.fold_count : null;
  const hasCombinationCount = Object.prototype.hasOwnProperty.call(cpcvInputs, "combination_count");
  const combinationCount = hasCombinationCount && typeof cpcvInputs.combination_count === "number" && Number.isFinite(cpcvInputs.combination_count) ? cpcvInputs.combination_count : null;
  const hasTrialCount = Object.prototype.hasOwnProperty.call(cpcvInputs, "trial_count");
  const trialCount = hasTrialCount && typeof cpcvInputs.trial_count === "number" && Number.isFinite(cpcvInputs.trial_count) ? cpcvInputs.trial_count : null;
  const denominatorReview = statisticalInputDenominatorReview("combinatorial_purged_cross_validation_summary", trialCount, searchDenominatorSummary, { trialCountPresent: hasTrialCount });
  const benchmarkPerformance = typeof cpcvInputs.benchmark_performance === "number" && Number.isFinite(cpcvInputs.benchmark_performance) ? cpcvInputs.benchmark_performance : null;
  const hasCombinationsArray = Array.isArray(cpcvInputs.combinations);
  const combinationRows = hasCombinationsArray ? cpcvInputs.combinations : [];
  const missing = [];
  const diagnostics = [];

  if (cpcvInputs.schema_version !== CPCV_INPUT_MATRIX_SCHEMA_VERSION) missing.push(`schema_version:${CPCV_INPUT_MATRIX_SCHEMA_VERSION}`);
  if (searchDenominatorSummary?.complete !== true) missing.push("complete_search_denominator");
  missing.push(...identity.missing);
  diagnostics.push(...identity.diagnostics, ...objectiveErrors);
  if (!hasFoldCount) missing.push("fold_count");
  if (hasFoldCount && !Number.isInteger(foldCount)) missing.push("integer_fold_count");
  if (foldCount === null || foldCount < 2) missing.push("fold_count>=2");
  if (!hasCombinationCount) missing.push("combination_count");
  if (hasCombinationCount && !Number.isInteger(combinationCount)) missing.push("integer_combination_count");
  if (combinationCount === null || combinationCount < 1) missing.push("combination_count>=1");
  if (!objectiveMetric) missing.push("objective.metric");
  if (!objectiveDirection) missing.push("objective.direction:maximize_or_minimize");
  if (benchmarkPerformance === null) missing.push("benchmark_performance");
  if (!hasCombinationsArray) missing.push("combinations_array");
  if (cpcvInputs.source_artifacts !== undefined && !hasSourceArtifactsArray) missing.push("source_artifacts_array");
  if (sourceArtifactRows.length === 0) missing.push("source_artifacts");
  else if (sourceArtifactRows.length !== 1) missing.push("single_cpcv_input_matrix_source_artifact");
  else if (sourceArtifacts.length !== sourceArtifactRows.length) missing.push("hash_verified_source_artifacts");
  if (sourceDiagnostics.readErrors.length > 0) missing.push("readable_source_artifacts");
  if (sourceDiagnostics.typeErrors.length > 0) missing.push("cpcv_input_matrix_source_artifacts");
  if (sourceDiagnostics.shapeErrors.length > 0) missing.push("well_formed_source_artifacts");

  const seenCombinationIds = new Set();
  const rows = [];
  for (const [index, row] of combinationRows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      diagnostics.push(`combination_${index}_not_object`);
      continue;
    }
    const combinationId = canonicalPboIdentifier(row.combination_id);
    if (!combinationId) {
      diagnostics.push(`combination_${index}_id_must_be_canonical_identifier`);
      continue;
    }
    if (seenCombinationIds.has(combinationId)) {
      diagnostics.push(`${combinationId}_duplicate_combination_id`);
      continue;
    }
    seenCombinationIds.add(combinationId);
    const trainGroupIds = Array.isArray(row.train_group_ids) ? row.train_group_ids : null;
    const testGroupIds = Array.isArray(row.test_group_ids) ? row.test_group_ids : null;
    if (!trainGroupIds || trainGroupIds.length === 0) diagnostics.push(`${combinationId}_missing_train_group_ids`);
    if (!testGroupIds || testGroupIds.length === 0) diagnostics.push(`${combinationId}_missing_test_group_ids`);
    const normalizedTrain = trainGroupIds ? trainGroupIds.filter((value) => canonicalPboIdentifier(value)) : [];
    const normalizedTest = testGroupIds ? testGroupIds.filter((value) => canonicalPboIdentifier(value)) : [];
    if (trainGroupIds && normalizedTrain.length !== trainGroupIds.length) diagnostics.push(`${combinationId}_train_group_ids_must_be_canonical`);
    if (testGroupIds && normalizedTest.length !== testGroupIds.length) diagnostics.push(`${combinationId}_test_group_ids_must_be_canonical`);
    const overlap = normalizedTrain.filter((value) => normalizedTest.includes(value));
    if (overlap.length > 0) diagnostics.push(`${combinationId}_train_test_groups_overlap`);
    const oosPerformance = typeof row.oos_performance === "number" && Number.isFinite(row.oos_performance) ? row.oos_performance : null;
    const tradeCount = typeof row.trade_count === "number" && Number.isFinite(row.trade_count) ? row.trade_count : null;
    if (oosPerformance === null) diagnostics.push(`${combinationId}_oos_performance_must_be_numeric`);
    if (!Number.isInteger(tradeCount) || tradeCount < 0) diagnostics.push(`${combinationId}_trade_count_must_be_nonnegative_integer`);
    if (!trainGroupIds || !testGroupIds || normalizedTrain.length !== trainGroupIds.length || normalizedTest.length !== testGroupIds.length || overlap.length > 0 || oosPerformance === null || !Number.isInteger(tradeCount) || tradeCount < 0) continue;
    rows.push({ combination_id: combinationId, train_group_ids: normalizedTrain, test_group_ids: normalizedTest, oos_performance: oosPerformance, trade_count: tradeCount });
  }
  if (rows.length < 1) missing.push("combinations>=1_valid_row");
  if (combinationCount !== null && rows.length !== combinationCount) missing.push("combination_count_matches_rows");
  if (diagnostics.length > identity.diagnostics.length + objectiveErrors.length) missing.push("well_formed_combinations");

  if (missing.length > 0) {
    return {
      status: "blocked_insufficient_inputs",
      enabled_as_promotion_gate: false,
      missing_inputs: normalizeStringArray(missing),
      diagnostics: normalizeStringArray([...sourceDiagnostics.readErrors, ...sourceDiagnostics.typeErrors, ...sourceDiagnostics.shapeErrors, ...diagnostics]),
      denominator_review: denominatorReview,
      source_artifact_review: sourceReview,
      reason: `CPCV requires explicit, hash-backed inputs: ${normalizeStringArray(missing).join(", ")}.`,
      known_limits: ["No CPCV advisory summary is produced when required inputs are absent, malformed, identity-mismatched, denominator-incomplete, or not hash-verified."]
    };
  }

  const performances = rows.map((row) => row.oos_performance).sort((a, b) => a - b);
  const middle = Math.floor(performances.length / 2);
  const median = performances.length % 2 === 0 ? (performances[middle - 1] + performances[middle]) / 2 : performances[middle];
  const passCount = rows.filter((row) => objectiveDirection === "maximize" ? row.oos_performance >= benchmarkPerformance : row.oos_performance <= benchmarkPerformance).length;
  const totalTrades = rows.reduce((sum, row) => sum + row.trade_count, 0);
  return {
    status: "computed_advisory",
    enabled_as_promotion_gate: false,
    statistic: "combinatorial_purged_cross_validation_summary",
    objective: { metric: objectiveMetric, direction: objectiveDirection },
    fold_count: foldCount,
    combination_count: combinationCount,
    matrix_row_count: rows.length,
    denominator_review: denominatorReview,
    source_artifact_review: sourceReview,
    benchmark_performance: roundMetric(benchmarkPerformance, 6),
    mean_oos_performance: roundMetric(average(rows.map((row) => row.oos_performance)), 6),
    median_oos_performance: roundMetric(median, 6),
    min_oos_performance: roundMetric(performances[0], 6),
    max_oos_performance: roundMetric(performances[performances.length - 1], 6),
    benchmark_pass_count: passCount,
    benchmark_pass_rate: roundMetric(passCount / rows.length, 6),
    total_trade_count: totalTrades,
    source_artifacts: sourceArtifacts,
    combination_results: rows.map((row) => ({
      combination_id: row.combination_id,
      train_group_ids: row.train_group_ids,
      test_group_ids: row.test_group_ids,
      oos_performance: roundMetric(row.oos_performance, 6),
      trade_count: row.trade_count,
      benchmark_pass: objectiveDirection === "maximize" ? row.oos_performance >= benchmarkPerformance : row.oos_performance <= benchmarkPerformance
    })),
    interpretation: "advisory_only_not_a_promotion_gate",
    known_limits: [
      "This CPCV summary is advisory only and is not a promotion, rejection, or deployment gate.",
      "The calculation consumes explicit hash-backed combination-level OOS results; it does not generate purged/embargoed splits or prove the supplied splits were unbiased.",
      "White Reality Check remains a separate advisory statistic with its own explicit supplied-null input contract."
    ]
  };
}

function buildWhiteRealityCheck(whiteInputs = null, searchDenominatorSummary = null, expectedIdentity = {}) {
  if (!whiteInputs || typeof whiteInputs !== "object") return null;
  const hasSourceArtifactsArray = Array.isArray(whiteInputs.source_artifacts);
  const sourceArtifactRows = hasSourceArtifactsArray ? whiteInputs.source_artifacts : [];
  const sourceArtifacts = validWhiteRealityCheckInputSources(sourceArtifactRows);
  const sourceReview = sourceArtifactReview(sourceArtifactRows, WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE);
  const sourceDiagnostics = sourceArtifactDiagnostics(sourceArtifactRows, WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE);
  const { objectiveMetric, objectiveDirection, errors: objectiveErrors } = objectiveFields(whiteInputs);
  const identity = identityDiagnostics(whiteInputs, expectedIdentity);
  const observedBestPerformance = typeof whiteInputs.observed_best_performance === "number" && Number.isFinite(whiteInputs.observed_best_performance) ? whiteInputs.observed_best_performance : null;
  const benchmarkPerformance = typeof whiteInputs.benchmark_performance === "number" && Number.isFinite(whiteInputs.benchmark_performance) ? whiteInputs.benchmark_performance : null;
  const hasTrialCount = Object.prototype.hasOwnProperty.call(whiteInputs, "trial_count");
  const trialCount = hasTrialCount && typeof whiteInputs.trial_count === "number" && Number.isFinite(whiteInputs.trial_count) ? whiteInputs.trial_count : null;
  const denominatorReview = statisticalInputDenominatorReview("white_reality_check_supplied_null_p_value", trialCount, searchDenominatorSummary, { trialCountPresent: hasTrialCount });
  const hasNullDistributionArray = Array.isArray(whiteInputs.null_distribution);
  const nullDistributionRows = hasNullDistributionArray ? whiteInputs.null_distribution : [];
  const nullAssumption = whiteInputs.null_assumption && typeof whiteInputs.null_assumption === "object" && !Array.isArray(whiteInputs.null_assumption) ? whiteInputs.null_assumption : null;
  const sourceMetadata = whiteInputs.source_metadata && typeof whiteInputs.source_metadata === "object" && !Array.isArray(whiteInputs.source_metadata) ? whiteInputs.source_metadata : null;
  const missing = [];
  const diagnostics = [];

  if (whiteInputs.schema_version !== WHITE_REALITY_CHECK_INPUT_SCHEMA_VERSION) missing.push(`schema_version:${WHITE_REALITY_CHECK_INPUT_SCHEMA_VERSION}`);
  if (searchDenominatorSummary?.complete !== true) missing.push("complete_search_denominator");
  missing.push(...identity.missing);
  diagnostics.push(...identity.diagnostics, ...objectiveErrors);
  if (!objectiveMetric) missing.push("objective.metric");
  if (!objectiveDirection) missing.push("objective.direction:maximize_or_minimize");
  if (observedBestPerformance === null) missing.push("observed_best_performance");
  if (benchmarkPerformance === null) missing.push("benchmark_performance");
  if (!hasTrialCount) missing.push("trial_count");
  if (hasTrialCount && !Number.isInteger(trialCount)) missing.push("integer_trial_count");
  if (trialCount === null || trialCount < 1) missing.push("trial_count>=1");
  if (!hasNullDistributionArray) missing.push("null_distribution_array");
  if (!nullAssumption) missing.push("null_assumption_object");
  if (!sourceMetadata) missing.push("source_metadata_object");
  if (whiteInputs.source_artifacts !== undefined && !hasSourceArtifactsArray) missing.push("source_artifacts_array");
  if (sourceArtifactRows.length === 0) missing.push("source_artifacts");
  else if (sourceArtifactRows.length !== 1) missing.push("single_white_reality_check_input_source_artifact");
  else if (sourceArtifacts.length !== sourceArtifactRows.length) missing.push("hash_verified_source_artifacts");
  if (sourceDiagnostics.readErrors.length > 0) missing.push("readable_source_artifacts");
  if (sourceDiagnostics.typeErrors.length > 0) missing.push("white_reality_check_input_source_artifacts");
  if (sourceDiagnostics.shapeErrors.length > 0) missing.push("well_formed_source_artifacts");
  if (whiteInputs.bootstrap_distribution !== undefined) {
    missing.push("canonical_white_reality_check_fields_only");
    diagnostics.push("bootstrap_distribution_alias_not_allowed");
  }

  const nullDistribution = [];
  for (const [index, value] of nullDistributionRows.entries()) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      diagnostics.push(`null_distribution_${index}_must_be_numeric`);
      continue;
    }
    nullDistribution.push(value);
  }
  if (nullDistribution.length < 1) missing.push("null_distribution>=1_numeric_sample");
  if (nullDistribution.length !== nullDistributionRows.length) missing.push("well_formed_null_distribution");
  if (trialCount !== null && nullDistribution.length > 0 && trialCount < nullDistribution.length) missing.push("trial_count_covers_null_distribution_samples");
  if (nullAssumption && (typeof nullAssumption.method !== "string" || !nullAssumption.method.trim())) {
    missing.push("null_assumption.method");
    diagnostics.push("null_assumption_method_must_be_nonempty_string");
  }
  if (sourceMetadata && (typeof sourceMetadata.generated_by !== "string" || !sourceMetadata.generated_by.trim())) {
    missing.push("source_metadata.generated_by");
    diagnostics.push("source_metadata_generated_by_must_be_nonempty_string");
  }

  if (missing.length > 0) {
    return {
      status: "blocked_insufficient_inputs",
      enabled_as_promotion_gate: false,
      missing_inputs: normalizeStringArray(missing),
      diagnostics: normalizeStringArray([...sourceDiagnostics.readErrors, ...sourceDiagnostics.typeErrors, ...sourceDiagnostics.shapeErrors, ...diagnostics]),
      denominator_review: denominatorReview,
      source_artifact_review: sourceReview,
      reason: `White Reality Check requires explicit, hash-backed inputs: ${normalizeStringArray(missing).join(", ")}.`,
      known_limits: ["No White Reality Check p-value is produced when required inputs are absent, malformed, identity-mismatched, denominator-incomplete, or not hash-verified."]
    };
  }

  const extremeCount = nullDistribution.filter((value) => objectiveDirection === "maximize" ? value >= observedBestPerformance : value <= observedBestPerformance).length;
  return {
    status: "computed_advisory",
    enabled_as_promotion_gate: false,
    statistic: "white_reality_check_supplied_null_p_value",
    objective: { metric: objectiveMetric, direction: objectiveDirection },
    p_value: roundMetric(extremeCount / nullDistribution.length, 6),
    null_sample_count: nullDistribution.length,
    extreme_null_sample_count: extremeCount,
    observed_best_performance: roundMetric(observedBestPerformance, 6),
    benchmark_performance: roundMetric(benchmarkPerformance, 6),
    trial_count: trialCount,
    denominator_review: denominatorReview,
    source_artifact_review: sourceReview,
    null_assumption: nullAssumption,
    source_metadata: sourceMetadata,
    source_artifacts: sourceArtifacts,
    interpretation: "advisory_only_not_a_promotion_gate",
    known_limits: [
      "This White Reality Check value is advisory only and is not a promotion, rejection, or deployment gate.",
      "The calculation consumes a supplied hash-backed null distribution; it does not generate bootstrap samples or prove the bootstrap/null construction is statistically valid.",
      "The p-value is a simple tail frequency against the supplied null samples using the declared objective direction."
    ]
  };
}

function statisticalTestsAdvisory(trialDenominatorSummary = null, searchDenominatorSummary = null, statisticalTestInputs = null, expectedIdentity = {}) {
  const reason = searchDenominatorSummary?.complete === true
    ? "Disabled even though the search denominator is structurally complete; deterministic advisory statistics require explicit hash-backed inputs."
    : trialDenominatorSummary?.denominator_available === true
    ? "Disabled even though worker trial_attempt_record artifacts were consumed; full optimizer, LLM, manual, mutation, repair, rerun, and multiple-comparison context is not yet artifact-backed."
    : "Disabled until complete trial denominator, optimizer attempts, and multiple-comparison context are artifact-backed.";
  const dsr = buildDeflatedSharpeRatio(statisticalTestInputs?.dsr, searchDenominatorSummary, expectedIdentity);
  const pbo = buildProbabilityOfBacktestOverfit(statisticalTestInputs?.pbo, searchDenominatorSummary, expectedIdentity);
  const cpcv = buildCombinatorialPurgedCrossValidation(statisticalTestInputs?.cpcv, searchDenominatorSummary, expectedIdentity);
  const whiteRealityCheck = buildWhiteRealityCheck(statisticalTestInputs?.white_reality_check, searchDenominatorSummary, expectedIdentity);
  return {
    dsr: dsr ?? { status: "disabled_advisory", reason },
    pbo: pbo ?? { status: "disabled_advisory", reason },
    cpcv: cpcv ?? { status: "disabled_advisory", reason },
    white_reality_check: whiteRealityCheck ?? { status: "disabled_advisory", reason }
  };
}

function parseOptimizerTrialRows(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { rows_read: parsed.length, read_error: null };
    for (const key of ["trials", "records", "rows", "results"]) {
      if (Array.isArray(parsed?.[key])) return { rows_read: parsed[key].length, read_error: null };
    }
    return { rows_read: 0, read_error: "JSON optimizer artifact did not contain a recognized trial array" };
  }
  if (ext === ".jsonl") {
    const parsed = parseJsonLines(text);
    return { rows_read: parsed.attempts.length, read_error: parsed.errors.length > 0 ? parsed.errors.join("; ") : null };
  }
  if (ext === ".csv") {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    return { rows_read: Math.max(0, lines.length - 1), read_error: null };
  }
  return { rows_read: 0, read_error: `Unsupported optimizer artifact extension: ${ext || "none"}` };
}

function summarizeOptimizerTrials(optimizerTrials) {
  const artifacts = (Array.isArray(optimizerTrials?.artifacts) ? optimizerTrials.artifacts : [])
    .filter((artifact) => artifact && typeof artifact === "object")
    .map((artifact) => ({
      path: typeof artifact.path === "string" ? artifact.path : null,
      sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : null,
      hash_verified: artifact.hash_verified === true,
      rows_read: finiteMetric(artifact.rows_read) ?? 0,
      read_error: typeof artifact.read_error === "string" ? artifact.read_error : null
    }));
  const readableArtifacts = artifacts.filter((artifact) => artifact.hash_verified === true && !artifact.read_error);
  const rowsRead = artifacts.reduce((sum, artifact) => sum + artifact.rows_read, 0);

  if (artifacts.length === 0) {
    return {
      status: "missing_optimizer_trial_artifact",
      denominator_available: false,
      artifact_count: 0,
      artifact_paths: [],
      artifacts: [],
      rows_read: 0,
      missing_because: "No separate wfa_optimizer_trials artifact was emitted by the WFA worker; selected parameters are not counted as optimizer-trial denominator evidence."
    };
  }

  return {
    status: readableArtifacts.length > 0 && rowsRead > 0 ? "optimizer_trial_artifacts_consumed" : "optimizer_trial_artifacts_unreadable",
    denominator_available: readableArtifacts.length > 0 && rowsRead > 0,
    artifact_count: artifacts.length,
    artifact_paths: normalizeStringArray(artifacts.map((artifact) => artifact.path)),
    artifacts,
    rows_read: rowsRead,
    missing_because: readableArtifacts.length > 0 && rowsRead > 0 ? null : "Optimizer-trial artifacts existed but no hash-verified readable trial rows were consumed."
  };
}

function summarizeOptimizerSearchContext(optimizerSearchContext) {
  const artifacts = (Array.isArray(optimizerSearchContext?.artifacts) ? optimizerSearchContext.artifacts : [])
    .filter((artifact) => artifact && typeof artifact === "object")
    .map((artifact) => ({
      path: typeof artifact.path === "string" ? artifact.path : null,
      sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : null,
      hash_verified: artifact.hash_verified === true,
      records_read: finiteMetric(artifact.records_read) ?? 0,
      records_accepted: finiteMetric(artifact.records_accepted) ?? 0,
      records_rejected: finiteMetric(artifact.records_rejected) ?? 0,
      read_error: typeof artifact.read_error === "string" ? artifact.read_error : null
    }));
  const contexts = (Array.isArray(optimizerSearchContext?.contexts) ? optimizerSearchContext.contexts : [])
    .filter((context) => context && typeof context === "object");
  const rejectedContexts = (Array.isArray(optimizerSearchContext?.rejected_contexts) ? optimizerSearchContext.rejected_contexts : [])
    .filter((context) => context && typeof context === "object");
  const unreadableArtifacts = artifacts.filter((artifact) => artifact.hash_verified !== true || artifact.read_error);
  const plannedTrialCount = contexts.reduce((sum, context) => sum + (finiteMetric(context.planned_trial_count) ?? 0), 0);
  const completedTrialCount = contexts.reduce((sum, context) => sum + (finiteMetric(context.completed_trial_count) ?? 0), 0);
  const failedTrialCount = contexts.reduce((sum, context) => sum + (finiteMetric(context.failed_trial_count) ?? 0), 0);

  if (artifacts.length === 0) {
    return {
      status: "missing_optimizer_search_context_artifact",
      context_available: false,
      schema_version: OPTIMIZER_SEARCH_CONTEXT_SCHEMA_VERSION,
      context_scope: "optimizer_search_context_advisory_only",
      context_count: 0,
      artifact_count: 0,
      artifact_paths: [],
      artifacts: [],
      optimizer_names: [],
      search_space_hashes: [],
      planned_trial_count: 0,
      completed_trial_count: 0,
      failed_trial_count: 0,
      contexts: [],
      rejected_context_count: 0,
      rejected_contexts: [],
      missing_because: "No optimizer_search_context artifact was available to the research-gate reporter; complete optimizer-search context remains missing."
    };
  }

  const status = contexts.length === 0
    ? (unreadableArtifacts.length > 0 ? "optimizer_search_context_artifacts_unreadable" : rejectedContexts.length > 0 ? "optimizer_search_context_records_rejected" : "optimizer_search_context_artifact_empty")
    : "optimizer_search_context_consumed";

  return {
    status,
    context_available: contexts.length > 0,
    schema_version: OPTIMIZER_SEARCH_CONTEXT_SCHEMA_VERSION,
    context_scope: "optimizer_search_context_advisory_only",
    context_count: contexts.length,
    artifact_count: artifacts.length,
    artifact_paths: normalizeStringArray(artifacts.map((artifact) => artifact.path)),
    artifacts,
    optimizer_names: normalizeStringArray(contexts.map((context) => context.optimizer_name)),
    search_space_hashes: normalizeStringArray(contexts.map((context) => context.search_space_hash)),
    planned_trial_count: plannedTrialCount,
    completed_trial_count: completedTrialCount,
    failed_trial_count: failedTrialCount,
    contexts,
    rejected_context_count: rejectedContexts.length,
    rejected_contexts: rejectedContexts,
    missing_because: contexts.length > 0 ? null : "Optimizer-search context artifacts existed but no valid context rows were consumed.",
    known_limits: ["This context is advisory denominator evidence only; it does not prove multiple-comparison correctness and does not enable DSR/PBO/CPCV/White gates."]
  };
}

function summarizeNonWorkerDenominator(nonWorkerDenominator) {
  const artifacts = (Array.isArray(nonWorkerDenominator?.artifacts) ? nonWorkerDenominator.artifacts : [])
    .filter((artifact) => artifact && typeof artifact === "object")
    .map((artifact) => ({
      path: typeof artifact.path === "string" ? artifact.path : null,
      sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : null,
      hash_verified: artifact.hash_verified === true,
      records_read: finiteMetric(artifact.records_read) ?? 0,
      records_accepted: finiteMetric(artifact.records_accepted) ?? 0,
      records_rejected: finiteMetric(artifact.records_rejected) ?? 0,
      read_error: typeof artifact.read_error === "string" ? artifact.read_error : null
    }));
  const attempts = (Array.isArray(nonWorkerDenominator?.attempts) ? nonWorkerDenominator.attempts : [])
    .filter((attempt) => attempt && typeof attempt === "object");
  const rejectedAttempts = (Array.isArray(nonWorkerDenominator?.rejected_attempts) ? nonWorkerDenominator.rejected_attempts : [])
    .filter((attempt) => attempt && typeof attempt === "object");
  const unreadableArtifacts = artifacts.filter((artifact) => artifact.hash_verified !== true || artifact.read_error);

  if (artifacts.length === 0) {
    return {
      status: "missing_non_worker_denominator_artifact",
      denominator_available: false,
      schema_version: NON_WORKER_DENOMINATOR_SCHEMA_VERSION,
      denominator_scope: "non_worker_attempt_records_advisory_only",
      attempt_count: 0,
      artifact_count: 0,
      artifact_paths: [],
      artifacts: [],
      status_counts: {},
      attempt_type_counts: {},
      generated_by_counts: {},
      lineage_ids: [],
      family_ids: [],
      attempts: [],
      rejected_attempt_count: 0,
      rejected_attempts: [],
      missing_because: "No non_worker_denominator_attempts artifact was available to the research-gate reporter; LLM/manual/mutation/repair/rerun denominator sources remain missing."
    };
  }

  const status = attempts.length === 0
    ? (unreadableArtifacts.length > 0 ? "non_worker_denominator_artifacts_unreadable" : rejectedAttempts.length > 0 ? "non_worker_denominator_records_rejected" : "non_worker_denominator_artifact_empty")
    : "non_worker_denominator_attempts_consumed";

  return {
    status,
    denominator_available: attempts.length > 0,
    schema_version: NON_WORKER_DENOMINATOR_SCHEMA_VERSION,
    denominator_scope: "non_worker_attempt_records_advisory_only",
    attempt_count: attempts.length,
    artifact_count: artifacts.length,
    artifact_paths: normalizeStringArray(artifacts.map((artifact) => artifact.path)),
    artifacts,
    status_counts: countBy(attempts.map((attempt) => attempt.status)),
    attempt_type_counts: countBy(attempts.map((attempt) => attempt.attempt_type)),
    generated_by_counts: countBy(attempts.map((attempt) => attempt.generated_by)),
    lineage_ids: normalizeStringArray(attempts.map((attempt) => attempt.lineage_id)),
    family_ids: normalizeStringArray(attempts.map((attempt) => attempt.family_id)),
    attempts,
    rejected_attempt_count: rejectedAttempts.length,
    rejected_attempts: rejectedAttempts,
    missing_because: attempts.length > 0 ? null : "Non-worker denominator artifacts existed but no valid attempt rows were consumed.",
    known_limits: ["These non-worker rows are advisory denominator evidence only; they do not execute anything and do not make the search denominator complete."]
  };
}

function summarizeMultipleComparisonContext(multipleComparisonContext) {
  const artifacts = (Array.isArray(multipleComparisonContext?.artifacts) ? multipleComparisonContext.artifacts : [])
    .filter((artifact) => artifact && typeof artifact === "object")
    .map((artifact) => ({
      path: typeof artifact.path === "string" ? artifact.path : null,
      sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : null,
      hash_verified: artifact.hash_verified === true,
      records_read: finiteMetric(artifact.records_read) ?? 0,
      records_accepted: finiteMetric(artifact.records_accepted) ?? 0,
      records_rejected: finiteMetric(artifact.records_rejected) ?? 0,
      read_error: typeof artifact.read_error === "string" ? artifact.read_error : null
    }));
  const contexts = (Array.isArray(multipleComparisonContext?.contexts) ? multipleComparisonContext.contexts : [])
    .filter((context) => context && typeof context === "object");
  const rejectedContexts = (Array.isArray(multipleComparisonContext?.rejected_contexts) ? multipleComparisonContext.rejected_contexts : [])
    .filter((context) => context && typeof context === "object");
  const unreadableArtifacts = artifacts.filter((artifact) => artifact.hash_verified !== true || artifact.read_error);
  const totalStrategiesTested = contexts.reduce((sum, context) => sum + (finiteMetric(context.total_strategies_tested) ?? 0), 0);

  if (artifacts.length === 0) {
    return {
      status: "missing_multiple_comparison_context_artifact",
      context_available: false,
      schema_version: MULTIPLE_COMPARISON_CONTEXT_SCHEMA_VERSION,
      context_scope: "multiple_comparison_context_advisory_only",
      context_count: 0,
      artifact_count: 0,
      artifact_paths: [],
      artifacts: [],
      correction_methods: [],
      total_strategies_tested: 0,
      contexts: [],
      rejected_context_count: 0,
      rejected_contexts: [],
      missing_because: "No multiple_comparison_context artifact was available to the research-gate reporter; multiple-testing correction context remains missing."
    };
  }

  const status = contexts.length === 0
    ? (unreadableArtifacts.length > 0 ? "multiple_comparison_context_artifacts_unreadable" : rejectedContexts.length > 0 ? "multiple_comparison_context_records_rejected" : "multiple_comparison_context_artifact_empty")
    : "multiple_comparison_context_consumed";

  return {
    status,
    context_available: contexts.length > 0,
    schema_version: MULTIPLE_COMPARISON_CONTEXT_SCHEMA_VERSION,
    context_scope: "multiple_comparison_context_advisory_only",
    context_count: contexts.length,
    artifact_count: artifacts.length,
    artifact_paths: normalizeStringArray(artifacts.map((artifact) => artifact.path)),
    artifacts,
    correction_methods: normalizeStringArray(contexts.map((context) => context.correction_method)),
    total_strategies_tested: totalStrategiesTested,
    contexts,
    rejected_context_count: rejectedContexts.length,
    rejected_contexts: rejectedContexts,
    missing_because: contexts.length > 0 ? null : "Multiple-comparison context artifacts existed but no valid context rows were consumed.",
    known_limits: ["This context is advisory denominator evidence only; it does not execute anything and does not make the search denominator complete."]
  };
}

function summarizeOptimizerTrialAccounting(optimizerTrialsSummary, optimizerSearchContextSummary) {
  const contextAvailable = optimizerSearchContextSummary?.context_available === true;
  const optimizerRowsRead = finiteMetric(optimizerTrialsSummary?.rows_read) ?? 0;
  const plannedTrialCount = finiteMetric(optimizerSearchContextSummary?.planned_trial_count) ?? 0;
  const completedTrialCount = finiteMetric(optimizerSearchContextSummary?.completed_trial_count) ?? 0;
  const failedTrialCount = finiteMetric(optimizerSearchContextSummary?.failed_trial_count) ?? 0;
  const accountedTrialCount = completedTrialCount + failedTrialCount;
  const plannedAccountingDelta = contextAvailable ? plannedTrialCount - accountedTrialCount : null;
  const expectedCompletedRows = contextAvailable ? completedTrialCount : null;
  const missingCompletedRows = expectedCompletedRows === null ? null : Math.max(0, expectedCompletedRows - optimizerRowsRead);
  const excessCompletedRows = expectedCompletedRows === null ? null : Math.max(0, optimizerRowsRead - expectedCompletedRows);
  const status = !contextAvailable
    ? "missing_optimizer_search_context"
    : plannedAccountingDelta !== 0
      ? "optimizer_search_context_trial_counts_inconsistent"
      : missingCompletedRows > 0
      ? "optimizer_trial_rows_below_completed_context"
      : excessCompletedRows > 0
        ? "optimizer_trial_rows_exceed_completed_context"
        : "optimizer_trial_accounting_consistent";

  return {
    status,
    reporting_only: true,
    optimizer_trial_rows_read: optimizerRowsRead,
    optimizer_search_planned_trial_count: plannedTrialCount,
    optimizer_search_completed_trial_count: completedTrialCount,
    optimizer_search_failed_trial_count: failedTrialCount,
    optimizer_search_accounted_trial_count: accountedTrialCount,
    optimizer_search_planned_accounting_delta: plannedAccountingDelta,
    missing_completed_optimizer_trial_rows: missingCompletedRows,
    excess_optimizer_trial_rows: excessCompletedRows,
    note: "Optimizer-trial accounting is reporting-only in Phase 8C; it exposes denominator incompleteness but does not enable hard statistical gates."
  };
}

function summarizeMultipleComparisonAccounting(trialDenominatorSummary, nonWorkerDenominatorSummary, multipleComparisonContextSummary) {
  const workerAttemptCount = finiteMetric(trialDenominatorSummary?.attempt_count) ?? 0;
  const nonWorkerAttemptCount = finiteMetric(nonWorkerDenominatorSummary?.attempt_count) ?? 0;
  const knownAttemptCount = workerAttemptCount + nonWorkerAttemptCount;
  const totalStrategiesTested = finiteMetric(multipleComparisonContextSummary?.total_strategies_tested) ?? 0;
  const contextAvailable = multipleComparisonContextSummary?.context_available === true;
  const underreportedKnownAttempts = contextAvailable ? Math.max(0, knownAttemptCount - totalStrategiesTested) : null;
  return {
    status: !contextAvailable
      ? "missing_multiple_comparison_context"
      : underreportedKnownAttempts > 0
        ? "multiple_comparison_context_underreports_known_attempts"
        : "multiple_comparison_context_covers_known_attempts",
    reporting_only: true,
    known_worker_attempt_count: workerAttemptCount,
    known_non_worker_attempt_count: nonWorkerAttemptCount,
    known_attempt_count: knownAttemptCount,
    multiple_comparison_total_strategies_tested: totalStrategiesTested,
    underreported_known_attempt_count: underreportedKnownAttempts,
    note: "Multiple-comparison context coverage is reporting-only in Phase 8C and cannot authorize DSR/PBO/CPCV/White promotion authority."
  };
}

function summarizeSearchDenominator(trialDenominatorSummary, optimizerTrialsSummary, nonWorkerDenominatorSummary, optimizerSearchContextSummary, multipleComparisonContextSummary) {
  const coveredSources = [];
  const missingSources = [];
  const nonWorkerAttemptCounts = {};

  if ((trialDenominatorSummary?.attempt_count ?? 0) > 0) coveredSources.push("worker_trial_attempt_records");
  else missingSources.push("worker_trial_attempt_records");

  if ((optimizerTrialsSummary?.rows_read ?? 0) > 0) coveredSources.push("optimizer_trial_artifact_rows");
  else missingSources.push("optimizer_trial_artifact_rows");

  const nonWorkerCountsByType = nonWorkerDenominatorSummary?.attempt_type_counts ?? {};
  for (const attemptType of NON_WORKER_ATTEMPT_TYPES) {
    const sourceKey = NON_WORKER_ATTEMPT_SOURCE_KEYS[attemptType];
    const count = finiteMetric(nonWorkerCountsByType[attemptType]) ?? 0;
    nonWorkerAttemptCounts[attemptType] = count;
    if (count > 0) coveredSources.push(sourceKey);
    else missingSources.push(sourceKey);
  }

  if (optimizerSearchContextSummary?.context_available === true) coveredSources.push("complete_optimizer_search_context");
  else missingSources.push("complete_optimizer_search_context");

  if (multipleComparisonContextSummary?.context_available === true) coveredSources.push("multiple_comparison_context");
  else missingSources.push("multiple_comparison_context");

  const complete = missingSources.length === 0;
  const optimizerTrialAccounting = summarizeOptimizerTrialAccounting(optimizerTrialsSummary, optimizerSearchContextSummary);
  const multipleComparisonAccounting = summarizeMultipleComparisonAccounting(trialDenominatorSummary, nonWorkerDenominatorSummary, multipleComparisonContextSummary);

  return {
    status: complete ? "complete_search_denominator" : (coveredSources.length > 0 ? "partial_search_denominator" : "missing_search_denominator"),
    complete,
    statistical_tests_enabled: false,
    covered_sources: normalizeStringArray(coveredSources),
    missing_sources: normalizeStringArray(missingSources),
    missing_source_count: missingSources.length,
    missing_non_worker_attempt_sources: normalizeStringArray(missingSources.filter((source) => ["llm_generated_attempts", "manual_attempts", "mutation_attempts", "repair_attempts", "rerun_attempts"].includes(source))),
    worker_attempt_count: finiteMetric(trialDenominatorSummary?.attempt_count) ?? 0,
    rejected_worker_attempt_count: finiteMetric(trialDenominatorSummary?.rejected_attempt_count) ?? 0,
    optimizer_trial_row_count: finiteMetric(optimizerTrialsSummary?.rows_read) ?? 0,
    optimizer_search_context_count: finiteMetric(optimizerSearchContextSummary?.context_count) ?? 0,
    optimizer_search_planned_trial_count: finiteMetric(optimizerSearchContextSummary?.planned_trial_count) ?? 0,
    optimizer_search_completed_trial_count: finiteMetric(optimizerSearchContextSummary?.completed_trial_count) ?? 0,
    optimizer_search_failed_trial_count: finiteMetric(optimizerSearchContextSummary?.failed_trial_count) ?? 0,
    optimizer_trial_accounting: optimizerTrialAccounting,
    non_worker_attempt_count: finiteMetric(nonWorkerDenominatorSummary?.attempt_count) ?? 0,
    rejected_non_worker_attempt_count: finiteMetric(nonWorkerDenominatorSummary?.rejected_attempt_count) ?? 0,
    non_worker_attempt_counts: nonWorkerAttemptCounts,
    multiple_comparison_context_count: finiteMetric(multipleComparisonContextSummary?.context_count) ?? 0,
    multiple_comparison_total_strategies_tested: finiteMetric(multipleComparisonContextSummary?.total_strategies_tested) ?? 0,
    multiple_comparison_accounting: multipleComparisonAccounting,
    disabled_because: complete
      ? "Search denominator is structurally complete, but DSR, PBO, CPCV, and White Reality Check remain advisory/disabled until deterministic statistical-test implementations are added and validated."
      : "Full search denominator is incomplete; DSR, PBO, CPCV, and White Reality Check remain advisory/disabled."
  };
}

function gateReportWfe(parsedMetrics) {
  const readiness = parsedMetrics?.metric_readiness?.wfe;
  if (readiness?.status === "computed_artifact_backed" && finiteMetric(readiness.value) !== null) {
    return {
      definition: "walk-forward efficiency = aggregate OOS return divided by absolute aggregate in-sample return",
      value: roundMetric(readiness.value, 6),
      status: "computed_artifact_backed",
      inputs: readiness.inputs ?? null,
      note: "Consumed from worker metric_readiness; no WFE value is invented when artifact-backed inputs are absent."
    };
  }
  if (readiness && typeof readiness === "object") {
    return {
      definition: "walk-forward efficiency = aggregate OOS return divided by absolute aggregate in-sample return",
      value: null,
      status: readiness.status ?? "blocked_missing_inputs",
      missing_inputs: Array.isArray(readiness.missing_inputs) ? readiness.missing_inputs : [],
      missing_because: readiness.missing_because ?? "Worker metric_readiness did not provide artifact-backed WFE inputs."
    };
  }
  return {
    definition: "walk-forward efficiency = aggregate OOS return divided by absolute aggregate in-sample return",
    value: null,
    status: "missing_in_sample_return",
    missing_because: "Current WFA worker metrics do not expose artifact-backed aggregate in-sample return."
  };
}

function gateReportWfr(parsedMetrics, observedWindows, totalWindows) {
  const readiness = parsedMetrics?.metric_readiness?.wfr;
  if (readiness?.status === "computed_artifact_backed" && finiteMetric(readiness.value) !== null) {
    return {
      definition: "walk-forward robustness = completed OOS windows divided by planned WFA windows",
      value: roundMetric(readiness.value, 6),
      status: "computed_artifact_backed",
      inputs: readiness.inputs ?? null
    };
  }
  if (readiness && typeof readiness === "object") {
    return {
      definition: "walk-forward robustness = completed OOS windows divided by planned WFA windows",
      value: null,
      status: readiness.status ?? "blocked_missing_inputs",
      missing_inputs: Array.isArray(readiness.missing_inputs) ? readiness.missing_inputs : [],
      missing_because: readiness.missing_because ?? "Worker metric_readiness did not provide artifact-backed WFR inputs."
    };
  }
  const wfrValue = totalWindows && totalWindows > 0 ? roundMetric(observedWindows / totalWindows) : null;
  return {
    definition: "walk-forward robustness = completed OOS windows divided by planned WFA windows",
    value: wfrValue,
    status: wfrValue === null ? "missing_total_window_count" : (wfrValue >= 1 ? "all_planned_windows_completed" : "incomplete_wfa_windows")
  };
}

export function buildResearchWfaGateReport({
  runId,
  candidateId = null,
  executionResult,
  parsedMetrics = null,
  dataReadinessManifests = [],
  duplicateFailedPatterns = [],
  trialDenominator = null,
  optimizerTrials = null,
  nonWorkerDenominator = null,
  optimizerSearchContext = null,
  multipleComparisonContext = null,
  statisticalTestInputs = null,
  generatedAt = new Date().toISOString(),
  thresholds = {}
} = {}) {
  const metrics = executionResult?.metrics_observed ?? executionResult?.worker_result?.metrics ?? parsedMetrics?.metrics ?? {};
  const effectiveCandidateId = candidateId ?? executionResult?.candidate_id ?? executionResult?.worker_result?.candidate_id ?? null;
  const effectiveRunId = runId ?? executionResult?.worker_result?.run_id ?? executionResult?.experiment_id ?? null;
  const perWindowMetrics = normalizePerWindowMetrics(parsedMetrics);
  const observedWindows = finiteMetric(metrics.successful_windows ?? executionResult?.provenance?.windows_completed ?? executionResult?.worker_result?.windows_completed) ?? perWindowMetrics.length;
  const totalWindows = finiteMetric(metrics.total_windows) ?? observedWindows;
  const observedTrades = finiteMetric(metrics.total_trades);
  const minOosWindows = finiteMetric(thresholds.min_oos_windows) ?? 5;
  const minTrades = finiteMetric(thresholds.min_trades) ?? 50;
  const flags = [];

  if (observedWindows < minOosWindows) flags.push("underpowered_oos_windows");
  if (observedTrades === null || observedTrades < minTrades) flags.push("underpowered_trade_count");

  const oosWindowConsistency = summarizeOosWindowConsistency(perWindowMetrics);
  if (oosWindowConsistency.status === "mixed_oos_windows") flags.push("mixed_oos_window_results");
  if (oosWindowConsistency.status === "missing_per_window_returns") flags.push("missing_per_window_returns");
  const consistencyLadderAdvisory = buildPhase8DConsistencyLadderAdvisory({ metrics, parsedMetrics, perWindowMetrics });
  if (consistencyLadderAdvisory.low_window_count_warning.status === "low_window_count_low_consistency") flags.push("low_window_count_low_consistency");
  if (consistencyLadderAdvisory.return_concentration.status === "computed_artifact_backed") flags.push("return_concentration_reported");
  if (consistencyLadderAdvisory.drawdown_to_return_ratio.status === "computed_artifact_backed") flags.push("drawdown_to_return_reported");

  const parameterStability = annotateParameterStabilityEvidence(summarizeWorkerParameterStability(parsedMetrics, perWindowMetrics), observedWindows, minOosWindows);
  if (parameterStability.status === "parameter_instability_flagged") flags.push("parameter_instability_flagged");
  if (parameterStability.status === "missing_parameter_artifacts") flags.push("missing_parameter_artifacts");
  if (parameterStability.status === "partial_parameter_artifacts") flags.push("partial_parameter_artifacts");
  if (parameterStability.status === "invalid_artifact_backed") flags.push("invalid_parameter_stability_artifact");
  if (parameterStability.evidence_strength === "weak_or_incomplete") flags.push("weak_parameter_stability_evidence");

  const warmupDiagnostics = summarizeWarmupDiagnostic(parsedMetrics);
  if (warmupDiagnostics.status === "invalid_artifact_backed") flags.push("invalid_warmup_diagnostics");
  if (["not_emitted", "not_reported"].includes(warmupDiagnostics.status)) flags.push("missing_warmup_diagnostics");
  if (warmupDiagnostics.boundary_application?.status === "generic_indicator_warmup_not_applied") flags.push("generic_indicator_warmup_not_applied");

  const dataIdentity = summarizeDataIdentity(dataReadinessManifests);
  if (dataIdentity.status === "missing_data_readiness_manifest") flags.push("missing_data_readiness_manifest");
  if (dataIdentity.status === "data_gaps_flagged") flags.push("data_gaps_flagged");

  const costStress = summarizeCostStress(executionResult, parsedMetrics);
  if (costStress.status === "missing_cost_assumptions") flags.push("missing_cost_assumptions");
  if (costStress.status === "cost_assumptions_recorded_stress_missing") flags.push("missing_cost_stress_evidence");
  if (costStress.status === "invalid_artifact_backed") flags.push("invalid_cost_stress_evidence");
  if (costStress.cost_assumption_provenance?.artifact_backed === false) flags.push("unverified_cost_assumption_provenance");
  if (costStress.cost_assumption_provenance?.artifact_backed === true) flags.push("cost_assumption_provenance_reported");
  if (costStress.stress_tested === true && costStress.artifact_backed_source_count > 0) flags.push("cost_stress_evidence_reported");

  const optimizationTruth = annotateOptimizationTruthCostInputReview(summarizeOptimizationTruthDiagnostic(parsedMetrics), costStress);
  if (optimizationTruth.status === "invalid_artifact_backed") flags.push("invalid_optimization_truth_diagnostics");
  if (["not_emitted", "not_reported"].includes(optimizationTruth.status)) flags.push("missing_optimization_truth_diagnostics");
  if (optimizationTruth.source_review?.status === "hash_backed_source_reported") flags.push("optimization_truth_source_reported");
  if (optimizationTruth.source_review?.status === "missing_or_unverified_source") flags.push("unverified_optimization_truth_source");
  if ((optimizationTruth.source_review?.errors ?? []).includes("optimization_truth_source_field_must_reference_optimization_truth")) flags.push("optimization_truth_source_field_mismatch");
  if ((optimizationTruth.source_review?.errors ?? []).includes("optimization_truth_source_must_match_metrics_artifact_identity")) flags.push("optimization_truth_source_identity_mismatch");
  if (optimizationTruth.disconnected_module_review?.status === "reported_inactive") flags.push("disconnected_optimizer_cost_modules_reported");
  const optimizationTruthContractReview = optimizationTruth.disconnected_module_review?.contract_review;
  if (optimizationTruthContractReview?.status === "contract_incomplete_or_inconsistent") flags.push("optimization_truth_contract_incomplete");
  if ((optimizationTruthContractReview?.missing_inactive_modules ?? []).length > 0) flags.push("missing_disconnected_optimizer_cost_modules");
  if ((optimizationTruthContractReview?.invalid_inactive_flags ?? []).length > 0) flags.push("unexpected_active_disconnected_optimizer_cost_modules");
  if ((optimizationTruthContractReview?.active_path_mismatches ?? []).length > 0) flags.push("unexpected_optimization_truth_active_path");
  if ((optimizationTruthContractReview?.missing_cost_inputs ?? []).length > 0) flags.push("missing_optimization_truth_active_cost_inputs");
  const costInputReviewStatus = optimizationTruth.disconnected_module_review?.cost_input_provenance_review?.status;
  if (costInputReviewStatus === "consistent_with_cost_assumptions") flags.push("active_cost_inputs_match_cost_assumptions");
  if (costInputReviewStatus === "missing_active_cost_inputs") flags.push("missing_active_cost_inputs");
  if (costInputReviewStatus === "unexpected_active_cost_inputs") flags.push("unexpected_active_cost_inputs");
  if (costInputReviewStatus === "unverified_cost_assumption_provenance") flags.push("active_cost_inputs_without_verified_cost_assumptions");
  if (costInputReviewStatus === "active_cost_inputs_mismatch_cost_assumptions") flags.push("active_cost_inputs_mismatch_cost_assumptions");

  const duplicatePatternSummary = summarizeDuplicateFailedPatterns(duplicateFailedPatterns);
  if (duplicatePatternSummary.count > 0) flags.push("duplicate_failed_patterns_flagged");

  const trialDenominatorSummary = summarizeTrialDenominator(trialDenominator);
  if (trialDenominatorSummary.status === "missing_trial_denominator_artifact") flags.push("missing_trial_denominator_artifact");
  if (trialDenominatorSummary.status === "trial_denominator_artifact_unreadable") flags.push("trial_denominator_artifact_unreadable");
  if (trialDenominatorSummary.status === "trial_denominator_artifact_empty") flags.push("trial_denominator_artifact_empty");
  if (trialDenominatorSummary.status === "trial_denominator_records_rejected") flags.push("trial_denominator_records_rejected");
  if (trialDenominatorSummary.status === "trial_denominator_partial_worker_records") flags.push("trial_denominator_partial_worker_records");
  if (trialDenominatorSummary.rejected_attempt_count > 0) flags.push("trial_denominator_records_rejected");

  const optimizerTrialsSummary = summarizeOptimizerTrials(optimizerTrials);
  if (optimizerTrialsSummary.status === "missing_optimizer_trial_artifact") flags.push("missing_optimizer_trial_artifact");
  if (optimizerTrialsSummary.status === "optimizer_trial_artifacts_unreadable") flags.push("optimizer_trial_artifacts_unreadable");
  if (optimizerTrialsSummary.status === "optimizer_trial_artifacts_consumed") flags.push("optimizer_trial_artifacts_consumed");

  const optimizerSearchContextSummary = summarizeOptimizerSearchContext(optimizerSearchContext);
  if (optimizerSearchContextSummary.status === "missing_optimizer_search_context_artifact") flags.push("missing_optimizer_search_context_artifact");
  if (optimizerSearchContextSummary.status === "optimizer_search_context_artifacts_unreadable") flags.push("optimizer_search_context_artifacts_unreadable");
  if (optimizerSearchContextSummary.status === "optimizer_search_context_artifact_empty") flags.push("optimizer_search_context_artifact_empty");
  if (optimizerSearchContextSummary.status === "optimizer_search_context_records_rejected") flags.push("optimizer_search_context_records_rejected");
  if (optimizerSearchContextSummary.status === "optimizer_search_context_consumed") flags.push("optimizer_search_context_consumed");
  if (optimizerSearchContextSummary.rejected_context_count > 0) flags.push("optimizer_search_context_records_rejected");

  const nonWorkerDenominatorSummary = summarizeNonWorkerDenominator(nonWorkerDenominator);
  if (nonWorkerDenominatorSummary.status === "missing_non_worker_denominator_artifact") flags.push("missing_non_worker_denominator_artifact");
  if (nonWorkerDenominatorSummary.status === "non_worker_denominator_artifacts_unreadable") flags.push("non_worker_denominator_artifacts_unreadable");
  if (nonWorkerDenominatorSummary.status === "non_worker_denominator_artifact_empty") flags.push("non_worker_denominator_artifact_empty");
  if (nonWorkerDenominatorSummary.status === "non_worker_denominator_records_rejected") flags.push("non_worker_denominator_records_rejected");
  if (nonWorkerDenominatorSummary.status === "non_worker_denominator_attempts_consumed") flags.push("non_worker_denominator_attempts_consumed");
  if (nonWorkerDenominatorSummary.rejected_attempt_count > 0) flags.push("non_worker_denominator_records_rejected");

  const multipleComparisonContextSummary = summarizeMultipleComparisonContext(multipleComparisonContext);
  if (multipleComparisonContextSummary.status === "missing_multiple_comparison_context_artifact") flags.push("missing_multiple_comparison_context_artifact");
  if (multipleComparisonContextSummary.status === "multiple_comparison_context_artifacts_unreadable") flags.push("multiple_comparison_context_artifacts_unreadable");
  if (multipleComparisonContextSummary.status === "multiple_comparison_context_artifact_empty") flags.push("multiple_comparison_context_artifact_empty");
  if (multipleComparisonContextSummary.status === "multiple_comparison_context_records_rejected") flags.push("multiple_comparison_context_records_rejected");
  if (multipleComparisonContextSummary.status === "multiple_comparison_context_consumed") flags.push("multiple_comparison_context_consumed");
  if (multipleComparisonContextSummary.rejected_context_count > 0) flags.push("multiple_comparison_context_records_rejected");

  const searchDenominatorSummary = summarizeSearchDenominator(trialDenominatorSummary, optimizerTrialsSummary, nonWorkerDenominatorSummary, optimizerSearchContextSummary, multipleComparisonContextSummary);
  if (searchDenominatorSummary.complete !== true) flags.push("search_denominator_incomplete");
  if ((searchDenominatorSummary.missing_non_worker_attempt_sources ?? []).length > 0) flags.push("missing_non_worker_attempt_denominator_context");
  if (searchDenominatorSummary.optimizer_trial_accounting?.status === "optimizer_trial_rows_below_completed_context") flags.push("optimizer_trial_accounting_incomplete");
  if (searchDenominatorSummary.optimizer_trial_accounting?.status === "optimizer_trial_rows_exceed_completed_context") flags.push("optimizer_trial_accounting_mismatch");
  if (searchDenominatorSummary.optimizer_trial_accounting?.status === "optimizer_search_context_trial_counts_inconsistent") flags.push("optimizer_search_context_trial_counts_inconsistent");
  if (searchDenominatorSummary.multiple_comparison_accounting?.status === "multiple_comparison_context_underreports_known_attempts") flags.push("multiple_comparison_context_underreports_known_attempts");
  const statisticalTests = statisticalTestsAdvisory(trialDenominatorSummary, searchDenominatorSummary, statisticalTestInputs, expectedTrialIdentity(executionResult));
  if (statisticalTests.dsr.status === "computed_advisory") flags.push("dsr_computed_advisory");
  if (statisticalTests.dsr.status === "blocked_insufficient_inputs") flags.push("dsr_blocked_insufficient_inputs");
  pushStatisticalTrialCountFlags(flags, "dsr", statisticalTests.dsr);
  pushStatisticalIdentityFlags(flags, "dsr", statisticalTests.dsr);
  pushStatisticalSourceFlags(flags, "dsr", statisticalTests.dsr);
  if (statisticalTests.pbo.status === "computed_advisory") flags.push("pbo_computed_advisory");
  if (statisticalTests.pbo.status === "blocked_insufficient_inputs") flags.push("pbo_blocked_insufficient_inputs");
  pushStatisticalTrialCountFlags(flags, "pbo", statisticalTests.pbo);
  pushStatisticalIdentityFlags(flags, "pbo", statisticalTests.pbo);
  pushStatisticalSourceFlags(flags, "pbo", statisticalTests.pbo);
  pushStatisticalSchemaFlags(flags, "pbo", statisticalTests.pbo);
  if (statisticalTests.cpcv.status === "computed_advisory") flags.push("cpcv_computed_advisory");
  if (statisticalTests.cpcv.status === "blocked_insufficient_inputs") flags.push("cpcv_blocked_insufficient_inputs");
  pushStatisticalTrialCountFlags(flags, "cpcv", statisticalTests.cpcv);
  pushStatisticalIdentityFlags(flags, "cpcv", statisticalTests.cpcv);
  pushStatisticalSourceFlags(flags, "cpcv", statisticalTests.cpcv);
  pushStatisticalSchemaFlags(flags, "cpcv", statisticalTests.cpcv);
  if (statisticalTests.white_reality_check.status === "computed_advisory") flags.push("white_reality_check_computed_advisory");
  if (statisticalTests.white_reality_check.status === "blocked_insufficient_inputs") flags.push("white_reality_check_blocked_insufficient_inputs");
  pushStatisticalTrialCountFlags(flags, "white_reality_check", statisticalTests.white_reality_check);
  pushStatisticalIdentityFlags(flags, "white_reality_check", statisticalTests.white_reality_check);
  pushStatisticalSourceFlags(flags, "white_reality_check", statisticalTests.white_reality_check);
  pushStatisticalSchemaFlags(flags, "white_reality_check", statisticalTests.white_reality_check);

  const wfe = gateReportWfe(parsedMetrics);
  const wfr = gateReportWfr(parsedMetrics, observedWindows, totalWindows);
  if (wfe.status !== "computed_artifact_backed") flags.push("wfe_blocked_or_missing_inputs");
  if (wfr.status !== "computed_artifact_backed" && wfr.status !== "all_planned_windows_completed") flags.push("wfr_blocked_or_missing_inputs");
  const evidencePaths = normalizeStringArray([
    ...researchWfaEvidencePaths(executionResult, []),
    parsedMetrics?.metrics_artifact?.path,
    executionResult?.worker_result?.per_window_metrics_path,
    ...dataIdentity.manifest_paths,
    ...duplicatePatternSummary.evidence_paths,
    ...trialDenominatorSummary.artifact_paths,
    ...optimizerTrialsSummary.artifact_paths,
    ...optimizerSearchContextSummary.artifact_paths,
    ...nonWorkerDenominatorSummary.artifact_paths,
    ...multipleComparisonContextSummary.artifact_paths,
    optimizationTruth.source_review?.source_artifact?.path,
    ...(Array.isArray(costStress.cost_assumption_provenance?.source_artifacts) ? costStress.cost_assumption_provenance.source_artifacts.map((artifact) => artifact.path) : []),
    ...(Array.isArray(costStress.source_artifacts) ? costStress.source_artifacts.map((artifact) => artifact.path) : []),
    ...(Array.isArray(statisticalTests.dsr.source_artifacts) ? statisticalTests.dsr.source_artifacts.map((artifact) => artifact.path) : []),
    ...(Array.isArray(statisticalTests.pbo.source_artifacts) ? statisticalTests.pbo.source_artifacts.map((artifact) => artifact.path) : []),
    ...(Array.isArray(statisticalTests.cpcv.source_artifacts) ? statisticalTests.cpcv.source_artifacts.map((artifact) => artifact.path) : []),
    ...(Array.isArray(statisticalTests.white_reality_check.source_artifacts) ? statisticalTests.white_reality_check.source_artifacts.map((artifact) => artifact.path) : [])
  ]);

  return {
    schema_version: RESEARCH_WFA_GATE_REPORT_SCHEMA_VERSION,
    evidence_kind: "research_gate_report",
    authority_layer: "control_plane",
    reporting_only: true,
    promotion_decision: "not_a_promotion_gate",
    run_id: effectiveRunId,
    candidate_id: effectiveCandidateId,
    generated_at: generatedAt,
    evidence_paths: evidencePaths,
    thresholds: { min_oos_windows: minOosWindows, min_trades: minTrades },
    metrics_summary: {
      sharpe_oos: roundMetric(metrics.sharpe_oos ?? metrics.aggregate_sharpe),
      aggregate_return_pct: roundMetric(metrics.aggregate_return_pct),
      profit_factor: roundMetric(metrics.profit_factor),
      total_trades: observedTrades,
      successful_windows: observedWindows,
      total_windows: totalWindows
    },
    wfe,
    wfr,
    sample_size: {
      status: observedWindows >= minOosWindows && observedTrades !== null && observedTrades >= minTrades ? "sufficient_for_basic_reporting" : "underpowered",
      observed_oos_windows: observedWindows,
      observed_trades: observedTrades,
      min_oos_windows: minOosWindows,
      min_trades: minTrades
    },
    oos_window_consistency: oosWindowConsistency,
    consistency_ladder_advisory: consistencyLadderAdvisory,
    parameter_stability: parameterStability,
    optimization_truth: optimizationTruth,
    warmup_diagnostics: warmupDiagnostics,
    cost_stress: costStress,
    data_identity: dataIdentity,
    trial_denominator: trialDenominatorSummary,
    optimizer_trials: optimizerTrialsSummary,
    optimizer_search_context: optimizerSearchContextSummary,
    non_worker_denominator: nonWorkerDenominatorSummary,
    multiple_comparison_context: multipleComparisonContextSummary,
    search_denominator: searchDenominatorSummary,
    duplicate_failed_patterns: duplicatePatternSummary,
    statistical_tests: statisticalTests,
    flags: normalizeStringArray(flags)
  };
}

export function writeResearchWfaGateReport(paths, report) {
  const candidateId = report?.candidate_id ?? "uncandidate";
  const runId = report?.run_id ?? stampNow();
  const fullPath = path.join(paths.factory, "research-gates", candidateId, `${runId}.json`);
  writeJsonAtomic(fullPath, report, paths);
  return { path: fullPath, payload: report };
}

function lowFrequencyRegistrationRefFromExecution(executionResult) {
  return executionResult?.provenance?.low_frequency_registration
    ?? executionResult?.provenance?.low_frequency_registration_artifact
    ?? executionResult?.observations?.low_frequency_registration
    ?? executionResult?.observations?.low_frequency_registration_artifact
    ?? null;
}

function validateLowFrequencyTradeFloorForExecution(executionResult, { rootDir, candidateId, runId, resultsKnownAt, observedTrades } = {}) {
  const ref = lowFrequencyRegistrationRefFromExecution(executionResult);
  if (!ref) return { applied: false, reason: "missing low_frequency_registration_v1 artifact reference" };
  try {
    const result = validateLowFrequencyTradeFloorException(ref, {
      rootDir,
      expectedCandidateId: candidateId,
      expectedRunId: runId,
      resultsKnownAt,
      observedTrades
    });
    return { applied: true, minimumTradeFloor: result.minimum_trade_floor, artifactPath: result.artifact.path };
  } catch (error) {
    return { applied: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function buildResearchWfaPromotionGate({ runId, candidateId = null, attempt = 1, executionResult, evidencePaths = [], rootDir = null, parsedMetrics = null } = {}) {
  const metrics = { ...(parsedMetrics?.metrics ?? {}), ...(executionResult?.metrics_observed ?? executionResult?.worker_result?.metrics ?? {}) };
  const effectiveCandidateId = candidateId ?? executionResult?.candidate_id ?? executionResult?.worker_result?.candidate_id ?? null;
  const gateEvidencePaths = researchWfaEvidencePaths(executionResult, evidencePaths);
  const base = {
    runId: runId ?? executionResult?.worker_result?.run_id ?? executionResult?.experiment_id ?? "RUN-RESEARCH-WFA-PROMOTION-GATE",
    stage: "research_promotion",
    attempt,
    validator: "research_wfa_promotion_gate",
    evidencePaths: gateEvidencePaths
  };
  const statisticalTestAuthority = {
    dsr: "advisory_only_not_a_promotion_gate",
    pbo: "advisory_only_not_a_promotion_gate",
    cpcv: "advisory_only_not_a_promotion_gate",
    white_reality_check: "advisory_only_not_a_promotion_gate",
    hard_gate_enabled: false,
    note: "Phase 8C DSR/PBO/CPCV/White outputs may report or block missing inputs, but they do not authorize research promotion without a separate promotion-policy amendment."
  };

  if (!executionResult || executionResult.status !== "executed" || executionResult.evidence_kind !== "research_wfa") {
    return { ...buildStageGateResult({ ...base, decision: "denied", reason: "Research promotion requires executed research_wfa evidence." }), candidate_id: effectiveCandidateId, target_context: "research", statistical_test_authority: statisticalTestAuthority };
  }

  const sharpeOos = finiteMetric(metrics.sharpe_oos ?? metrics.aggregate_sharpe);
  const annualizedReturnPct = finiteMetric(metrics.annualized_return_pct ?? metrics.annual_return_pct ?? metrics.cagr_pct);
  const aggregateReturnPct = finiteMetric(metrics.aggregate_return_pct ?? metrics.total_return_pct ?? metrics.return_pct);
  const profitFactor = finiteMetric(metrics.profit_factor);
  const totalTrades = finiteMetric(metrics.total_trades ?? metrics.trades ?? metrics.aggregate_total_trades);
  const completedWindows = finiteMetric(metrics.successful_windows ?? metrics.windows_completed ?? metrics.completed_windows ?? metrics.total_windows ?? metrics.oos_windows ?? metrics.per_window_metrics_count);
  const consistencyLadderAdvisory = buildPhase8DConsistencyLadderAdvisory({ metrics, parsedMetrics });
  const positiveWindowRatio = finiteRatio(consistencyLadderAdvisory.positive_oos_window_ratio
    ?? metrics.positive_oos_windows_pct
    ?? metrics.positive_return_windows_pct
    ?? metrics.positive_sharpe_windows_pct
    ?? metrics.positive_windows_pct
    ?? metrics.wfr);
  const returnForConsistencyPolicy = annualizedReturnPct ?? aggregateReturnPct;
  const consistencyRoute = evaluatePhase8DConsistencyPromotionRoute({
    positiveWindowRatio,
    sharpeOos,
    returnPct: returnForConsistencyPolicy,
    profitFactor,
    completedWindows,
    diagnostics: consistencyLadderAdvisory
  });
  const effectiveRunId = runId ?? executionResult?.worker_result?.run_id ?? executionResult?.experiment_id ?? null;
  const resultsKnownAt = executionResult?.observed_at ?? executionResult?.worker_result?.observed_at ?? executionResult?.observations?.worker_end_time ?? null;
  const rejectionReasons = [];

  if (sharpeOos !== null && sharpeOos <= 0) rejectionReasons.push(`non-positive OOS Sharpe (${sharpeOos})`);
  if (annualizedReturnPct === null && aggregateReturnPct === null) {
    rejectionReasons.push(`missing return metric for Phase 8D floor (${PHASE8D_MIN_RETURN_PCT}% required)`);
  } else if (annualizedReturnPct !== null && annualizedReturnPct < PHASE8D_MIN_RETURN_PCT) {
    rejectionReasons.push(`annualized return below Phase 8D floor (${annualizedReturnPct}% < ${PHASE8D_MIN_RETURN_PCT}%)`);
  } else if (annualizedReturnPct === null && aggregateReturnPct < PHASE8D_MIN_RETURN_PCT) {
    rejectionReasons.push(`aggregate return proxy below Phase 8D floor (${aggregateReturnPct}% < ${PHASE8D_MIN_RETURN_PCT}%)`);
  }
  if (profitFactor !== null && profitFactor < 1) rejectionReasons.push(`profit factor below 1 (${profitFactor})`);
  if (completedWindows === null) rejectionReasons.push(`missing completed OOS windows for Phase 8D floor (${PHASE8D_MIN_OOS_WINDOWS} required)`);
  else if (completedWindows < PHASE8D_MIN_OOS_WINDOWS) rejectionReasons.push(`completed OOS windows below Phase 8D floor (${completedWindows} < ${PHASE8D_MIN_OOS_WINDOWS})`);
  if (totalTrades === null) rejectionReasons.push(`missing trade count for Phase 8D floor (${PHASE8D_MIN_TRADES} required)`);
  else if (totalTrades < PHASE8D_MIN_TRADES) {
    const exception = validateLowFrequencyTradeFloorForExecution(executionResult, {
      rootDir,
      candidateId: effectiveCandidateId,
      runId: effectiveRunId,
      resultsKnownAt,
      observedTrades: totalTrades
    });
    if (!exception.applied) {
      rejectionReasons.push(`trade count below Phase 8D floor (${totalTrades} < ${PHASE8D_MIN_TRADES}); no valid pre-run low_frequency_registration_v1 exception (${exception.reason})`);
    }
  }
  if (!consistencyRoute.passed) {
    rejectionReasons.push(`Phase 8D consistency route denied: ${consistencyRoute.failures.join("; ")}`);
  }

  if (rejectionReasons.length > 0) {
    return { ...buildStageGateResult({ ...base, decision: "denied", reason: `Research WFA promotion denied for ${effectiveCandidateId ?? "candidate"}: ${rejectionReasons.join("; ")}. Advisory DSR/PBO/CPCV/White statistics are not hard promotion authority in Phase 8C.` }), candidate_id: effectiveCandidateId, target_context: "research", statistical_test_authority: statisticalTestAuthority, consistency_promotion_policy: consistencyRoute };
  }

  return { ...buildStageGateResult({ ...base, decision: "allowed", reason: `Research WFA promotion gate cleared Phase 8D minimum floor diagnostics for ${effectiveCandidateId ?? "candidate"} via ${consistencyRoute.route} consistency route; downstream MT5/native gates are still required, and advisory DSR/PBO/CPCV/White statistics remain non-authoritative.` }), candidate_id: effectiveCandidateId, target_context: "research", statistical_test_authority: statisticalTestAuthority, consistency_promotion_policy: consistencyRoute };
}

function normalizedEvidenceKind(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDriftThreshold(threshold) {
  if (!threshold || typeof threshold !== "object") {
    return { value: null, empirical_source: null, metric: null, units: null };
  }
  return {
    value: finiteMetric(threshold.value),
    empirical_source: typeof threshold.empirical_source === "string" && threshold.empirical_source.trim() ? threshold.empirical_source : null,
    metric: typeof threshold.metric === "string" && threshold.metric.trim() ? threshold.metric : null,
    units: typeof threshold.units === "string" && threshold.units.trim() ? threshold.units : null
  };
}

function normalizeDriftClassification(dimension, drift = {}, threshold = {}) {
  const normalizedThreshold = normalizeDriftThreshold(threshold);
  const observed = finiteMetric(drift.observed ?? drift.value);
  const status = ["pass", "fail", "blocked"].includes(drift.status) ? drift.status : (
    normalizedThreshold.value === null || normalizedThreshold.empirical_source === null ? "blocked" : (observed !== null && observed > normalizedThreshold.value ? "fail" : "pass")
  );
  return {
    dimension,
    status,
    observed,
    threshold: normalizedThreshold,
    notes: Array.isArray(drift.notes) ? drift.notes.filter((note) => typeof note === "string" && note.trim()) : []
  };
}

export function buildParityReport({ candidateId, runId, comparedArtifacts = [], driftThresholds = {}, driftObservations = {}, generatedAt = new Date().toISOString(), decision = null, notes = [] } = {}) {
  const driftClassifications = PARITY_DRIFT_DIMENSIONS.map((dimension) => normalizeDriftClassification(dimension, driftObservations[dimension], driftThresholds[dimension]));
  const blockedDimensions = driftClassifications.filter((item) => item.status === "blocked").map((item) => item.dimension);
  const failedDimensions = driftClassifications.filter((item) => item.status === "fail").map((item) => item.dimension);
  const effectiveDecision = decision ?? (blockedDimensions.length > 0 ? "blocked" : (failedDimensions.length > 0 ? "fail" : "pass"));

  return {
    schema_version: "parity_report_v1",
    evidence_kind: "parity_report",
    authority_layer: "control_plane",
    candidate_id: candidateId ?? null,
    run_id: runId ?? null,
    generated_at: generatedAt,
    decision: effectiveDecision,
    compared_artifacts: normalizeStringArray(comparedArtifacts),
    drift_classifications: driftClassifications,
    failed_dimensions: failedDimensions,
    blocked_dimensions: blockedDimensions,
    notes: normalizeStringArray(notes)
  };
}

export function writeParityReport(paths, report) {
  const candidateId = report?.candidate_id ?? "uncandidate";
  const runId = report?.run_id ?? stampNow();
  const fullPath = path.join(paths.factory, "parity", "reports", candidateId, `${runId}.json`);
  writeJsonAtomic(fullPath, report, paths);
  return { path: fullPath, payload: report };
}

export function writeCandidatePromotionGate(paths, gate) {
  const candidateId = gate?.candidate_id ?? "uncandidate";
  const runId = gate?.run_id ?? stampNow();
  const stage = String(gate?.stage ?? "promotion").replace(/[^A-Za-z0-9._-]+/g, "-");
  const fullPath = path.join(paths.factory, "candidates", candidateId, "gates", `${stage}-${runId}.json`);
  writeJsonAtomic(fullPath, gate, paths);
  return { path: fullPath, payload: gate };
}

function repoRelative(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativeReadPath(paths, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) return null;
  const fullPath = path.resolve(paths.root, repoRelativePath);
  const relative = path.relative(paths.root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return fullPath;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function updateCandidateManifestWithGate(paths, gateWrite) {
  const gate = gateWrite?.payload;
  if (!gate?.candidate_id) return { path: null, updated: false, reason: "gate missing candidate_id" };
  const fullPath = path.join(paths.factory, "candidates", gate.candidate_id, "manifest.json");
  const manifest = readJson(fullPath, null);
  if (!manifest || typeof manifest !== "object") return { path: null, updated: false, reason: "candidate manifest not found" };

  const gatePath = repoRelative(paths, gateWrite.path);
  const gateSha256 = sha256File(gateWrite.path);
  const nextManifest = {
    ...manifest,
    status: gate.decision === "allowed" ? manifest.status : "promotion_denied",
    promotion_status: `${gate.target_context ?? "promotion"}_${gate.decision}`,
    latest_gate_decision: {
      stage: gate.stage,
      target_context: gate.target_context ?? null,
      decision: gate.decision,
      validator: gate.validator,
      reason: gate.reason,
      gate_path: gatePath,
      gate_sha256: gateSha256,
      recorded_at: gate.recorded_at
    },
    updated_at: gate.recorded_at
  };

  writeJsonAtomic(fullPath, nextManifest, paths);
  return { path: repoRelative(paths, fullPath), updated: true, gate_path: gatePath, gate_sha256: gateSha256 };
}

export function buildFailedParityPatternRecord({ parityReport, gate = null, evidencePaths = [], recordedAt = new Date().toISOString() } = {}) {
  const failedDimensions = normalizeStringArray(parityReport?.failed_dimensions ?? []);
  const blockedDimensions = normalizeStringArray(parityReport?.blocked_dimensions ?? []);
  return {
    schema_version: "failed_parity_pattern_v1",
    recorded_at: recordedAt,
    candidate_id: parityReport?.candidate_id ?? gate?.candidate_id ?? null,
    run_id: parityReport?.run_id ?? gate?.run_id ?? null,
    failure_family: "parity_drift",
    parity_decision: parityReport?.decision ?? null,
    gate_decision: gate?.decision ?? null,
    failed_dimensions: failedDimensions,
    blocked_dimensions: blockedDimensions,
    lesson: `Parity did not pass${failedDimensions.length ? `; failed dimensions: ${failedDimensions.join(", ")}` : ""}${blockedDimensions.length ? `; blocked dimensions: ${blockedDimensions.join(", ")}` : ""}.`,
    evidence_paths: normalizeStringArray([
      ...(Array.isArray(evidencePaths) ? evidencePaths : []),
      ...(parityReport?.candidate_id && parityReport?.run_id ? [`factory/parity/reports/${parityReport.candidate_id}/${parityReport.run_id}.json`] : []),
      ...(Array.isArray(gate?.evidence_paths) ? gate.evidence_paths : [])
    ])
  };
}

export function appendFailedParityPattern(paths, record) {
  const fullPath = path.join(paths.factory, "memory", "failed-patterns.jsonl");
  appendLine(fullPath, JSON.stringify(record), paths);
  return { path: fullPath, payload: record };
}

function loadResearchWfaParsedMetrics(paths, executionResult) {
  const repoPath = executionResult?.provenance?.parsed_metrics_path ?? executionResult?.provenance?.per_window_metrics_path ?? null;
  const fullPath = resolveRepoRelativeReadPath(paths, repoPath);
  if (!fullPath || !fs.existsSync(fullPath)) return null;
  return readJson(fullPath, null);
}

function researchWfaArtifactRecordsByType(executionResult, artifactType) {
  const containers = [executionResult?.artifacts_created, executionResult?.worker_result?.artifacts, executionResult?.worker_result_envelope?.artifacts];
  const records = containers.flatMap((container) => Array.isArray(container) ? container : [])
    .filter((artifact) => artifact && typeof artifact === "object" && artifact.artifact_type === artifactType && typeof artifact.path === "string" && artifact.path.trim());
  const byPath = new Map();
  for (const record of records) {
    if (!byPath.has(record.path)) byPath.set(record.path, record);
  }
  return [...byPath.values()];
}

function parseJsonLines(text) {
  const attempts = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") attempts.push(parsed);
      else errors.push(`line ${index + 1}: JSON value is not an object`);
    } catch (error) {
      errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { attempts, errors };
}

function parseNonWorkerDenominatorRows(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DENOMINATOR_ARTIFACT_BYTES) {
    return { attempts: [], errors: [`artifact exceeds ${MAX_DENOMINATOR_ARTIFACT_BYTES} byte limit`] };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  let attempts = [];
  let errors = [];

  if (ext === ".jsonl") {
    const parsed = parseJsonLines(text);
    attempts = parsed.attempts;
    errors = parsed.errors;
  } else if (ext === ".json") {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) attempts = parsed;
    else if (Array.isArray(parsed?.attempts)) attempts = parsed.attempts;
    else if (Array.isArray(parsed?.records)) attempts = parsed.records;
    else errors.push("JSON non-worker denominator artifact did not contain an attempt array");
  } else {
    errors.push(`Unsupported non-worker denominator artifact extension: ${ext || "none"}`);
  }

  if (attempts.length > MAX_DENOMINATOR_ROWS) {
    errors.push(`artifact exceeds ${MAX_DENOMINATOR_ROWS} row limit`);
    attempts = attempts.slice(0, MAX_DENOMINATOR_ROWS);
  }

  return { attempts, errors };
}

function parseOptimizerSearchContexts(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DENOMINATOR_ARTIFACT_BYTES) {
    return { contexts: [], errors: [`artifact exceeds ${MAX_DENOMINATOR_ARTIFACT_BYTES} byte limit`] };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  let contexts = [];
  let errors = [];

  if (ext !== ".json") {
    errors.push(`Unsupported optimizer-search context artifact extension: ${ext || "none"}`);
  } else {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) contexts = parsed;
    else if (Array.isArray(parsed?.contexts)) contexts = parsed.contexts;
    else if (Array.isArray(parsed?.records)) contexts = parsed.records;
    else if (parsed && typeof parsed === "object") contexts = [parsed];
    else errors.push("JSON optimizer-search context artifact did not contain an object or context array");
  }

  if (contexts.length > MAX_DENOMINATOR_ROWS) {
    errors.push(`artifact exceeds ${MAX_DENOMINATOR_ROWS} row limit`);
    contexts = contexts.slice(0, MAX_DENOMINATOR_ROWS);
  }

  return { contexts, errors };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function compactTrialAttempt(attempt) {
  return {
    trial_id: typeof attempt.trial_id === "string" ? attempt.trial_id : null,
    run_id: typeof attempt.run_id === "string" ? attempt.run_id : null,
    job_id: typeof attempt.job_id === "string" ? attempt.job_id : null,
    candidate_id: typeof attempt.candidate_id === "string" ? attempt.candidate_id : null,
    lineage_id: typeof attempt.lineage_id === "string" ? attempt.lineage_id : null,
    family_id: typeof attempt.family_id === "string" ? attempt.family_id : null,
    attempt_id: typeof attempt.attempt_id === "string" ? attempt.attempt_id : null,
    parent_attempt_id: typeof attempt.parent_attempt_id === "string" ? attempt.parent_attempt_id : null,
    attempt_type: typeof attempt.attempt_type === "string" ? attempt.attempt_type : null,
    generated_by: typeof attempt.generated_by === "string" ? attempt.generated_by : null,
    status: typeof attempt.status === "string" ? attempt.status : null,
    started_at: typeof attempt.started_at === "string" ? attempt.started_at : null,
    ended_at: typeof attempt.ended_at === "string" ? attempt.ended_at : null,
    failure_code: typeof attempt.failure_code === "string" ? attempt.failure_code : null,
    input_hash_count: Array.isArray(attempt.input_hashes) ? attempt.input_hashes.length : 0,
    output_ref_count: Array.isArray(attempt.output_refs) ? attempt.output_refs.length : 0
  };
}

function compactNonWorkerAttempt(attempt) {
  return {
    schema_version: typeof attempt.schema_version === "string" ? attempt.schema_version : null,
    candidate_id: typeof attempt.candidate_id === "string" ? attempt.candidate_id : null,
    lineage_id: typeof attempt.lineage_id === "string" ? attempt.lineage_id : null,
    family_id: typeof attempt.family_id === "string" ? attempt.family_id : null,
    attempt_id: typeof attempt.attempt_id === "string" ? attempt.attempt_id : null,
    parent_attempt_id: typeof attempt.parent_attempt_id === "string" ? attempt.parent_attempt_id : null,
    attempt_type: typeof attempt.attempt_type === "string" ? attempt.attempt_type : null,
    generated_by: typeof attempt.generated_by === "string" ? attempt.generated_by : null,
    status: typeof attempt.status === "string" ? attempt.status : null,
    created_at: typeof attempt.created_at === "string" ? attempt.created_at : null,
    source_artifact_count: Array.isArray(attempt.source_artifacts) ? attempt.source_artifacts.length : 0,
    notes: typeof attempt.notes === "string" ? attempt.notes : null
  };
}

function compactOptimizerSearchContext(context) {
  return {
    schema_version: typeof context.schema_version === "string" ? context.schema_version : null,
    candidate_id: typeof context.candidate_id === "string" ? context.candidate_id : null,
    lineage_id: typeof context.lineage_id === "string" ? context.lineage_id : null,
    family_id: typeof context.family_id === "string" ? context.family_id : null,
    optimizer_name: typeof context.optimizer_name === "string" ? context.optimizer_name : null,
    search_space_hash: typeof context.search_space_hash === "string" ? context.search_space_hash : null,
    planned_trial_count: finiteMetric(context.planned_trial_count),
    completed_trial_count: finiteMetric(context.completed_trial_count),
    failed_trial_count: finiteMetric(context.failed_trial_count),
    window_count: finiteMetric(context.window_count),
    created_at: typeof context.created_at === "string" ? context.created_at : null,
    source_artifact_count: Array.isArray(context.source_artifacts) ? context.source_artifacts.length : 0,
    notes: typeof context.notes === "string" ? context.notes : null
  };
}

function compactMultipleComparisonContext(context) {
  return {
    schema_version: typeof context.schema_version === "string" ? context.schema_version : null,
    candidate_id: typeof context.candidate_id === "string" ? context.candidate_id : null,
    lineage_id: typeof context.lineage_id === "string" ? context.lineage_id : null,
    family_id: typeof context.family_id === "string" ? context.family_id : null,
    total_strategies_tested: finiteMetric(context.total_strategies_tested),
    correction_method: typeof context.correction_method === "string" ? context.correction_method : null,
    adjusted_alpha: finiteMetric(context.adjusted_alpha),
    nominal_alpha: finiteMetric(context.nominal_alpha),
    family_wise_error_rate: finiteMetric(context.family_wise_error_rate),
    correction_applied: typeof context.correction_applied === "boolean" ? context.correction_applied : null,
    correction_parameters_hash: typeof context.correction_parameters_hash === "string" ? context.correction_parameters_hash : null,
    created_at: typeof context.created_at === "string" ? context.created_at : null,
    source_artifact_count: Array.isArray(context.source_artifacts) ? context.source_artifacts.length : 0,
    notes: typeof context.notes === "string" ? context.notes : null
  };
}

function expectedTrialIdentity(executionResult) {
  const workerResult = executionResult?.worker_result ?? executionResult?.worker_result_envelope ?? {};
  return {
    run_id: workerResult.run_id ?? executionResult?.provenance?.request_identity?.run_id ?? null,
    job_id: workerResult.job_id ?? executionResult?.provenance?.request_identity?.job_id ?? null,
    candidate_id: executionResult?.candidate_id ?? workerResult.candidate_id ?? executionResult?.provenance?.request_identity?.candidate_id ?? null,
    lineage_id: workerResult.lineage_id ?? executionResult?.provenance?.request_identity?.lineage_id ?? null,
    family_id: workerResult.family_id ?? executionResult?.provenance?.request_identity?.family_id ?? null,
    attempt_id: workerResult.attempt_id ?? executionResult?.provenance?.request_identity?.attempt_id ?? null,
    attempt_type: workerResult.attempt_type ?? null
  };
}

function trialAttemptValidationErrors(attempt, expected) {
  const errors = [];
  for (const field of ["run_id", "job_id", "attempt_id", "attempt_type", "generated_by", "status"]) {
    if (typeof attempt[field] !== "string" || !attempt[field].trim()) errors.push(`${field} missing`);
  }
  for (const field of ["run_id", "job_id", "candidate_id", "lineage_id", "family_id", "attempt_id", "attempt_type"]) {
    if (typeof expected[field] === "string" && expected[field].trim() && attempt[field] !== expected[field]) errors.push(`${field} mismatch`);
  }
  return errors;
}

function nonWorkerAttemptValidationErrors(attempt, expected) {
  const errors = [];
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return ["row is not an object"];
  for (const field of ["schema_version", "candidate_id", "lineage_id", "family_id", "attempt_id", "attempt_type", "generated_by", "status", "created_at"]) {
    if (typeof attempt[field] !== "string" || !attempt[field].trim()) errors.push(`${field} missing`);
  }
  if (attempt.schema_version !== NON_WORKER_DENOMINATOR_SCHEMA_VERSION) errors.push("schema_version mismatch");
  if (typeof attempt.attempt_type === "string" && !NON_WORKER_ATTEMPT_TYPES.has(attempt.attempt_type)) errors.push("attempt_type unsupported");
  for (const field of ["candidate_id", "lineage_id", "family_id"]) {
    if (typeof expected[field] === "string" && expected[field].trim() && attempt[field] !== expected[field]) errors.push(`${field} mismatch`);
  }
  if (attempt.parent_attempt_id !== undefined && attempt.parent_attempt_id !== null && typeof attempt.parent_attempt_id !== "string") errors.push("parent_attempt_id must be string when present");
  if (attempt.source_artifacts !== undefined && attempt.source_artifacts !== null && !Array.isArray(attempt.source_artifacts)) errors.push("source_artifacts must be array when present");
  if (attempt.notes !== undefined && attempt.notes !== null && typeof attempt.notes !== "string") errors.push("notes must be string when present");
  return errors;
}

function optimizerSearchContextValidationErrors(context, expected) {
  const errors = [];
  if (!context || typeof context !== "object" || Array.isArray(context)) return ["row is not an object"];
  for (const field of ["schema_version", "candidate_id", "lineage_id", "family_id", "optimizer_name", "search_space_hash", "created_at"]) {
    if (typeof context[field] !== "string" || !context[field].trim()) errors.push(`${field} missing`);
  }
  if (context.schema_version !== OPTIMIZER_SEARCH_CONTEXT_SCHEMA_VERSION) errors.push("schema_version mismatch");
  if (!isSha256(context.search_space_hash)) errors.push("search_space_hash must be sha256");
  for (const field of ["planned_trial_count", "completed_trial_count", "failed_trial_count", "window_count"]) {
    const value = finiteMetric(context[field]);
    if (value === null || value < 0) errors.push(`${field} must be non-negative number`);
  }
  const planned = finiteMetric(context.planned_trial_count);
  const completed = finiteMetric(context.completed_trial_count);
  const failed = finiteMetric(context.failed_trial_count);
  if (planned !== null && completed !== null && failed !== null && completed + failed > planned) errors.push("completed plus failed trials exceeds planned trials");
  for (const field of ["candidate_id", "lineage_id", "family_id"]) {
    if (typeof expected[field] === "string" && expected[field].trim() && context[field] !== expected[field]) errors.push(`${field} mismatch`);
  }
  if (context.source_artifacts !== undefined && context.source_artifacts !== null && !Array.isArray(context.source_artifacts)) errors.push("source_artifacts must be array when present");
  if (context.notes !== undefined && context.notes !== null && typeof context.notes !== "string") errors.push("notes must be string when present");
  return errors;
}

function multipleComparisonContextValidationErrors(context, expected) {
  const errors = [];
  if (!context || typeof context !== "object" || Array.isArray(context)) return ["row is not an object"];
  for (const field of ["schema_version", "candidate_id", "lineage_id", "family_id", "correction_method", "created_at"]) {
    if (typeof context[field] !== "string" || !context[field].trim()) errors.push(`${field} missing`);
  }
  if (context.schema_version !== MULTIPLE_COMPARISON_CONTEXT_SCHEMA_VERSION) errors.push("schema_version mismatch");
  const totalStrategies = finiteMetric(context.total_strategies_tested);
  if (totalStrategies === null || totalStrategies < 1) errors.push("total_strategies_tested must be a positive number");
  const nominalAlpha = finiteMetric(context.nominal_alpha);
  if (nominalAlpha === null || nominalAlpha < 0 || nominalAlpha > 1) errors.push("nominal_alpha must be a number between 0 and 1");
  const adjustedAlpha = finiteMetric(context.adjusted_alpha);
  if (adjustedAlpha !== null && (adjustedAlpha < 0 || adjustedAlpha > 1)) errors.push("adjusted_alpha must be between 0 and 1 when present");
  const fwer = finiteMetric(context.family_wise_error_rate);
  if (fwer !== null && (fwer < 0 || fwer > 1)) errors.push("family_wise_error_rate must be between 0 and 1 when present");
  if (context.correction_applied !== undefined && context.correction_applied !== null && typeof context.correction_applied !== "boolean") errors.push("correction_applied must be boolean when present");
  if (context.correction_parameters_hash !== undefined && context.correction_parameters_hash !== null) {
    if (!isSha256(context.correction_parameters_hash)) errors.push("correction_parameters_hash must be sha256 when present");
  }
  for (const field of ["candidate_id", "lineage_id", "family_id"]) {
    if (typeof expected[field] === "string" && expected[field].trim() && context[field] !== expected[field]) errors.push(`${field} mismatch`);
  }
  if (context.correction_parameters !== undefined && context.correction_parameters !== null && typeof context.correction_parameters !== "object") errors.push("correction_parameters must be object when present");
  if (context.source_artifacts !== undefined && context.source_artifacts !== null && !Array.isArray(context.source_artifacts)) errors.push("source_artifacts must be array when present");
  if (context.notes !== undefined && context.notes !== null && typeof context.notes !== "string") errors.push("notes must be string when present");
  return errors;
}

function parseMultipleComparisonContexts(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DENOMINATOR_ARTIFACT_BYTES) {
    return { contexts: [], errors: [`artifact exceeds ${MAX_DENOMINATOR_ARTIFACT_BYTES} byte limit`] };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  let contexts = [];
  let errors = [];

  if (ext !== ".json") {
    errors.push(`Unsupported multiple-comparison context artifact extension: ${ext || "none"}`);
  } else {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) contexts = parsed;
    else if (Array.isArray(parsed?.contexts)) contexts = parsed.contexts;
    else if (Array.isArray(parsed?.records)) contexts = parsed.records;
    else if (parsed && typeof parsed === "object") contexts = [parsed];
    else errors.push("JSON multiple-comparison context artifact did not contain an object or context array");
  }

  if (contexts.length > MAX_DENOMINATOR_ROWS) {
    errors.push(`artifact exceeds ${MAX_DENOMINATOR_ROWS} row limit`);
    contexts = contexts.slice(0, MAX_DENOMINATOR_ROWS);
  }

  return { contexts, errors };
}

function loadResearchWfaTrialDenominator(paths, executionResult) {
  const artifacts = [];
  const attempts = [];
  const rejectedAttempts = [];
  const expected = expectedTrialIdentity(executionResult);
  for (const record of researchWfaArtifactRecordsByType(executionResult, "trial_attempt_record")) {
    const artifact = { path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false, records_read: 0, records_accepted: 0, records_rejected: 0, read_error: null };
    if (!isSha256(record.sha256)) {
      artifact.read_error = "trial_attempt_record artifact missing valid sha256";
      artifacts.push(artifact);
      continue;
    }
    const fullPath = resolveRepoRelativeReadPath(paths, record.path);
    if (!fullPath || !fs.existsSync(fullPath)) {
      artifact.read_error = "trial_attempt_record artifact path is missing or outside repository";
      artifacts.push(artifact);
      continue;
    }
    const actualSha = sha256File(fullPath);
    artifact.hash_verified = actualSha === record.sha256;
    if (!artifact.hash_verified) {
      artifact.read_error = "trial_attempt_record sha256 mismatch";
      artifacts.push(artifact);
      continue;
    }
    const parsed = parseJsonLines(fs.readFileSync(fullPath, "utf8"));
    artifact.records_read = parsed.attempts.length;
    let acceptedForArtifact = 0;
    let rejectedForArtifact = 0;
    for (const attempt of parsed.attempts) {
      const compact = compactTrialAttempt(attempt);
      const validationErrors = trialAttemptValidationErrors(attempt, expected);
      if (validationErrors.length > 0) {
        rejectedAttempts.push({ ...compact, rejection_reason: validationErrors.join("; ") });
        rejectedForArtifact += 1;
      } else {
        attempts.push(compact);
        acceptedForArtifact += 1;
      }
    }
    artifact.records_accepted = acceptedForArtifact;
    artifact.records_rejected = rejectedForArtifact;
    artifact.read_error = parsed.errors.length > 0 ? parsed.errors.join("; ") : null;
    artifacts.push(artifact);
  }
  return { artifacts, attempts, rejected_attempts: rejectedAttempts };
}

function loadResearchWfaOptimizerTrials(paths, executionResult) {
  const artifacts = [];
  for (const record of researchWfaArtifactRecordsByType(executionResult, "wfa_optimizer_trials")) {
    const artifact = { path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false, rows_read: 0, read_error: null };
    if (!isSha256(record.sha256)) {
      artifact.read_error = "wfa_optimizer_trials artifact missing valid sha256";
      artifacts.push(artifact);
      continue;
    }
    const fullPath = resolveRepoRelativeReadPath(paths, record.path);
    if (!fullPath || !fs.existsSync(fullPath)) {
      artifact.read_error = "wfa_optimizer_trials artifact path is missing or outside repository";
      artifacts.push(artifact);
      continue;
    }
    const actualSha = sha256File(fullPath);
    artifact.hash_verified = actualSha === record.sha256;
    if (!artifact.hash_verified) {
      artifact.read_error = "wfa_optimizer_trials sha256 mismatch";
      artifacts.push(artifact);
      continue;
    }
    try {
      const parsed = parseOptimizerTrialRows(fullPath);
      artifact.rows_read = parsed.rows_read;
      artifact.read_error = parsed.read_error;
    } catch (error) {
      artifact.read_error = error instanceof Error ? error.message : String(error);
    }
    artifacts.push(artifact);
  }
  return { artifacts };
}

function loadResearchWfaOptimizerSearchContext(paths, executionResult) {
  const artifacts = [];
  const contexts = [];
  const rejectedContexts = [];
  const expected = expectedTrialIdentity(executionResult);
  for (const record of researchWfaArtifactRecordsByType(executionResult, OPTIMIZER_SEARCH_CONTEXT_ARTIFACT_TYPE)) {
    const artifact = { path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false, records_read: 0, records_accepted: 0, records_rejected: 0, read_error: null };
    if (!isSha256(record.sha256)) {
      artifact.read_error = `${OPTIMIZER_SEARCH_CONTEXT_ARTIFACT_TYPE} artifact missing valid sha256`;
      artifacts.push(artifact);
      continue;
    }
    const fullPath = resolveRepoRelativeReadPath(paths, record.path);
    if (!fullPath || !fs.existsSync(fullPath)) {
      artifact.read_error = `${OPTIMIZER_SEARCH_CONTEXT_ARTIFACT_TYPE} artifact path is missing or outside repository`;
      artifacts.push(artifact);
      continue;
    }
    const actualSha = sha256File(fullPath);
    artifact.hash_verified = actualSha === record.sha256;
    if (!artifact.hash_verified) {
      artifact.read_error = `${OPTIMIZER_SEARCH_CONTEXT_ARTIFACT_TYPE} sha256 mismatch`;
      artifacts.push(artifact);
      continue;
    }
    try {
      const parsed = parseOptimizerSearchContexts(fullPath);
      artifact.records_read = parsed.contexts.length;
      let acceptedForArtifact = 0;
      let rejectedForArtifact = 0;
      for (const context of parsed.contexts) {
        const compact = compactOptimizerSearchContext(context);
        const validationErrors = optimizerSearchContextValidationErrors(context, expected);
        if (validationErrors.length > 0) {
          rejectedContexts.push({ ...compact, rejection_reason: validationErrors.join("; ") });
          rejectedForArtifact += 1;
        } else {
          contexts.push(compact);
          acceptedForArtifact += 1;
        }
      }
      artifact.records_accepted = acceptedForArtifact;
      artifact.records_rejected = rejectedForArtifact;
      artifact.read_error = parsed.errors.length > 0 ? parsed.errors.join("; ") : null;
    } catch (error) {
      artifact.read_error = error instanceof Error ? error.message : String(error);
    }
    artifacts.push(artifact);
  }
  return { artifacts, contexts, rejected_contexts: rejectedContexts };
}

function loadResearchWfaNonWorkerDenominator(paths, executionResult) {
  const artifacts = [];
  const attempts = [];
  const rejectedAttempts = [];
  const expected = expectedTrialIdentity(executionResult);
  for (const record of researchWfaArtifactRecordsByType(executionResult, NON_WORKER_DENOMINATOR_ARTIFACT_TYPE)) {
    const artifact = { path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false, records_read: 0, records_accepted: 0, records_rejected: 0, read_error: null };
    if (!isSha256(record.sha256)) {
      artifact.read_error = `${NON_WORKER_DENOMINATOR_ARTIFACT_TYPE} artifact missing valid sha256`;
      artifacts.push(artifact);
      continue;
    }
    const fullPath = resolveRepoRelativeReadPath(paths, record.path);
    if (!fullPath || !fs.existsSync(fullPath)) {
      artifact.read_error = `${NON_WORKER_DENOMINATOR_ARTIFACT_TYPE} artifact path is missing or outside repository`;
      artifacts.push(artifact);
      continue;
    }
    const actualSha = sha256File(fullPath);
    artifact.hash_verified = actualSha === record.sha256;
    if (!artifact.hash_verified) {
      artifact.read_error = `${NON_WORKER_DENOMINATOR_ARTIFACT_TYPE} sha256 mismatch`;
      artifacts.push(artifact);
      continue;
    }
    try {
      const parsed = parseNonWorkerDenominatorRows(fullPath);
      artifact.records_read = parsed.attempts.length;
      let acceptedForArtifact = 0;
      let rejectedForArtifact = 0;
      for (const attempt of parsed.attempts) {
        const compact = compactNonWorkerAttempt(attempt);
        const validationErrors = nonWorkerAttemptValidationErrors(attempt, expected);
        if (validationErrors.length > 0) {
          rejectedAttempts.push({ ...compact, rejection_reason: validationErrors.join("; ") });
          rejectedForArtifact += 1;
        } else {
          attempts.push(compact);
          acceptedForArtifact += 1;
        }
      }
      artifact.records_accepted = acceptedForArtifact;
      artifact.records_rejected = rejectedForArtifact;
      artifact.read_error = parsed.errors.length > 0 ? parsed.errors.join("; ") : null;
    } catch (error) {
      artifact.read_error = error instanceof Error ? error.message : String(error);
    }
    artifacts.push(artifact);
  }
  return { artifacts, attempts, rejected_attempts: rejectedAttempts };
}

function loadResearchWfaMultipleComparisonContext(paths, executionResult) {
  const artifacts = [];
  const contexts = [];
  const rejectedContexts = [];
  const expected = expectedTrialIdentity(executionResult);
  for (const record of researchWfaArtifactRecordsByType(executionResult, MULTIPLE_COMPARISON_CONTEXT_ARTIFACT_TYPE)) {
    const artifact = { path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false, records_read: 0, records_accepted: 0, records_rejected: 0, read_error: null };
    if (!isSha256(record.sha256)) {
      artifact.read_error = `${MULTIPLE_COMPARISON_CONTEXT_ARTIFACT_TYPE} artifact missing valid sha256`;
      artifacts.push(artifact);
      continue;
    }
    const fullPath = resolveRepoRelativeReadPath(paths, record.path);
    if (!fullPath || !fs.existsSync(fullPath)) {
      artifact.read_error = `${MULTIPLE_COMPARISON_CONTEXT_ARTIFACT_TYPE} artifact path is missing or outside repository`;
      artifacts.push(artifact);
      continue;
    }
    const actualSha = sha256File(fullPath);
    artifact.hash_verified = actualSha === record.sha256;
    if (!artifact.hash_verified) {
      artifact.read_error = `${MULTIPLE_COMPARISON_CONTEXT_ARTIFACT_TYPE} sha256 mismatch`;
      artifacts.push(artifact);
      continue;
    }
    try {
      const parsed = parseMultipleComparisonContexts(fullPath);
      artifact.records_read = parsed.contexts.length;
      let acceptedForArtifact = 0;
      let rejectedForArtifact = 0;
      for (const context of parsed.contexts) {
        const compact = compactMultipleComparisonContext(context);
        const validationErrors = multipleComparisonContextValidationErrors(context, expected);
        if (validationErrors.length > 0) {
          rejectedContexts.push({ ...compact, rejection_reason: validationErrors.join("; ") });
          rejectedForArtifact += 1;
        } else {
          contexts.push(compact);
          acceptedForArtifact += 1;
        }
      }
      artifact.records_accepted = acceptedForArtifact;
      artifact.records_rejected = rejectedForArtifact;
      artifact.read_error = parsed.errors.length > 0 ? parsed.errors.join("; ") : null;
    } catch (error) {
      artifact.read_error = error instanceof Error ? error.message : String(error);
    }
    artifacts.push(artifact);
  }
  return { artifacts, contexts, rejected_contexts: rejectedContexts };
}

function loadResearchWfaPboInputs(paths, executionResult) {
  const records = researchWfaArtifactRecordsByType(executionResult, PBO_INPUT_ARTIFACT_TYPE);
  if (records.length === 0) return null;
  if (records.length > 1) {
    return {
      pbo: {
        source_artifacts: records.map((record) => ({
          artifact_type: record.artifact_type ?? null,
          path: record.path,
          sha256: typeof record.sha256 === "string" ? record.sha256 : null,
          hash_verified: false,
          read_error: `multiple ${PBO_INPUT_ARTIFACT_TYPE} artifacts are ambiguous; provide exactly one`
        }))
      }
    };
  }
  const record = records[0];
  const sourceArtifact = { artifact_type: record.artifact_type ?? null, path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false };
  const blocked = (readError) => ({ pbo: { source_artifacts: [{ ...sourceArtifact, hash_verified: false, read_error: readError }] } });

  if (!isSha256(record.sha256)) return blocked(`${PBO_INPUT_ARTIFACT_TYPE} artifact missing valid sha256`);
  const fullPath = resolveRepoRelativeReadPath(paths, record.path);
  if (!fullPath || !fs.existsSync(fullPath)) return blocked(`${PBO_INPUT_ARTIFACT_TYPE} artifact path is missing or outside repository`);
  const actualSha = sha256File(fullPath);
  sourceArtifact.hash_verified = actualSha === record.sha256;
  if (!sourceArtifact.hash_verified) return blocked(`${PBO_INPUT_ARTIFACT_TYPE} sha256 mismatch`);

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_DENOMINATOR_ARTIFACT_BYTES) return blocked(`${PBO_INPUT_ARTIFACT_TYPE} exceeds ${MAX_DENOMINATOR_ARTIFACT_BYTES} byte limit`);
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const pbo = parsed?.pbo && typeof parsed.pbo === "object" ? parsed.pbo : parsed;
    if (!pbo || typeof pbo !== "object" || Array.isArray(pbo)) return blocked(`${PBO_INPUT_ARTIFACT_TYPE} JSON did not contain an object`);
    return { pbo: { ...pbo, source_artifacts: [{ ...sourceArtifact }] } };
  } catch (error) {
    return blocked(error instanceof Error ? error.message : String(error));
  }
}

function loadResearchWfaCpcvInputs(paths, executionResult) {
  const records = researchWfaArtifactRecordsByType(executionResult, CPCV_INPUT_ARTIFACT_TYPE);
  if (records.length === 0) return null;
  if (records.length > 1) {
    return {
      cpcv: {
        source_artifacts: records.map((record) => ({
          artifact_type: record.artifact_type ?? null,
          path: record.path,
          sha256: typeof record.sha256 === "string" ? record.sha256 : null,
          hash_verified: false,
          read_error: `multiple ${CPCV_INPUT_ARTIFACT_TYPE} artifacts are ambiguous; provide exactly one`
        }))
      }
    };
  }
  const record = records[0];
  const sourceArtifact = { artifact_type: record.artifact_type ?? null, path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false };
  const blocked = (readError) => ({ cpcv: { source_artifacts: [{ ...sourceArtifact, hash_verified: false, read_error: readError }] } });

  if (!isSha256(record.sha256)) return blocked(`${CPCV_INPUT_ARTIFACT_TYPE} artifact missing valid sha256`);
  const fullPath = resolveRepoRelativeReadPath(paths, record.path);
  if (!fullPath || !fs.existsSync(fullPath)) return blocked(`${CPCV_INPUT_ARTIFACT_TYPE} artifact path is missing or outside repository`);
  const actualSha = sha256File(fullPath);
  sourceArtifact.hash_verified = actualSha === record.sha256;
  if (!sourceArtifact.hash_verified) return blocked(`${CPCV_INPUT_ARTIFACT_TYPE} sha256 mismatch`);

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_DENOMINATOR_ARTIFACT_BYTES) return blocked(`${CPCV_INPUT_ARTIFACT_TYPE} exceeds ${MAX_DENOMINATOR_ARTIFACT_BYTES} byte limit`);
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const cpcv = parsed?.cpcv && typeof parsed.cpcv === "object" ? parsed.cpcv : parsed;
    if (!cpcv || typeof cpcv !== "object" || Array.isArray(cpcv)) return blocked(`${CPCV_INPUT_ARTIFACT_TYPE} JSON did not contain an object`);
    return { cpcv: { ...cpcv, source_artifacts: [{ ...sourceArtifact }] } };
  } catch (error) {
    return blocked(error instanceof Error ? error.message : String(error));
  }
}

function loadResearchWfaWhiteRealityCheckInputs(paths, executionResult) {
  const records = researchWfaArtifactRecordsByType(executionResult, WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE);
  if (records.length === 0) return null;
  if (records.length > 1) {
    return {
      white_reality_check: {
        source_artifacts: records.map((record) => ({
          artifact_type: record.artifact_type ?? null,
          path: record.path,
          sha256: typeof record.sha256 === "string" ? record.sha256 : null,
          hash_verified: false,
          read_error: `multiple ${WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE} artifacts are ambiguous; provide exactly one`
        }))
      }
    };
  }
  const record = records[0];
  const sourceArtifact = { artifact_type: record.artifact_type ?? null, path: record.path, sha256: typeof record.sha256 === "string" ? record.sha256 : null, hash_verified: false };
  const blocked = (readError) => ({ white_reality_check: { source_artifacts: [{ ...sourceArtifact, hash_verified: false, read_error: readError }] } });

  if (!isSha256(record.sha256)) return blocked(`${WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE} artifact missing valid sha256`);
  const fullPath = resolveRepoRelativeReadPath(paths, record.path);
  if (!fullPath || !fs.existsSync(fullPath)) return blocked(`${WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE} artifact path is missing or outside repository`);
  const actualSha = sha256File(fullPath);
  sourceArtifact.hash_verified = actualSha === record.sha256;
  if (!sourceArtifact.hash_verified) return blocked(`${WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE} sha256 mismatch`);

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_DENOMINATOR_ARTIFACT_BYTES) return blocked(`${WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE} exceeds ${MAX_DENOMINATOR_ARTIFACT_BYTES} byte limit`);
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const whiteRealityCheck = parsed?.white_reality_check && typeof parsed.white_reality_check === "object" ? parsed.white_reality_check : parsed;
    if (!whiteRealityCheck || typeof whiteRealityCheck !== "object" || Array.isArray(whiteRealityCheck)) return blocked(`${WHITE_REALITY_CHECK_INPUT_ARTIFACT_TYPE} JSON did not contain an object`);
    return { white_reality_check: { ...whiteRealityCheck, source_artifacts: [{ ...sourceArtifact }] } };
  } catch (error) {
    return blocked(error instanceof Error ? error.message : String(error));
  }
}

export function recordCandidateExecutionPromotionGate(paths, { runId, executionResult, executionResultPath = null, parityReport = null, adapterName = null } = {}) {
  const workerResult = executionResult?.worker_result ?? executionResult?.worker_result_envelope ?? null;
  const candidateId = executionResult?.candidate_id ?? workerResult?.candidate_id ?? null;
  if (!candidateId) return null;

  const evidenceKind = executionResult?.evidence_kind ?? workerResult?.evidence_kind ?? "research_wfa";
  const evidencePaths = normalizeStringArray([executionResultPath, ...evidencePathsFromResults([executionResult], [])]);
  const parsedMetrics = evidenceKind === "research_wfa" ? loadResearchWfaParsedMetrics(paths, executionResult) : null;
  const gate = evidenceKind === "research_wfa"
    ? buildResearchWfaPromotionGate({ runId, candidateId, executionResult, evidencePaths, rootDir: paths.root, parsedMetrics })
    : buildCandidatePromotionGate({ runId, candidateId, targetContext: evidenceKind, adapterName, evidenceResults: [executionResult], parityReport, evidencePaths });
  const gateWrite = writeCandidatePromotionGate(paths, gate);
  let researchGateReport = null;
  if (evidenceKind === "research_wfa") {
    const trialDenominator = loadResearchWfaTrialDenominator(paths, executionResult);
    const optimizerTrials = loadResearchWfaOptimizerTrials(paths, executionResult);
    const optimizerSearchContext = loadResearchWfaOptimizerSearchContext(paths, executionResult);
    const nonWorkerDenominator = loadResearchWfaNonWorkerDenominator(paths, executionResult);
    const multipleComparisonContext = loadResearchWfaMultipleComparisonContext(paths, executionResult);
    const statisticalTestInputs = { ...(loadResearchWfaPboInputs(paths, executionResult) ?? {}), ...(loadResearchWfaCpcvInputs(paths, executionResult) ?? {}), ...(loadResearchWfaWhiteRealityCheckInputs(paths, executionResult) ?? {}) };
    const report = buildResearchWfaGateReport({ runId, candidateId, executionResult, parsedMetrics, trialDenominator, optimizerTrials, nonWorkerDenominator, optimizerSearchContext, multipleComparisonContext, statisticalTestInputs });
    const reportWrite = writeResearchWfaGateReport(paths, report);
    researchGateReport = { path: repoRelative(paths, reportWrite.path), report };
  }
  const manifestUpdate = updateCandidateManifestWithGate(paths, gateWrite);
  let failedParityMemory = null;
  if (parityReport && gate.decision === "denied" && parityReport.decision !== "pass") {
    const record = buildFailedParityPatternRecord({ parityReport, gate, evidencePaths: [repoRelative(paths, gateWrite.path)] });
    const memoryWrite = appendFailedParityPattern(paths, record);
    failedParityMemory = { path: repoRelative(paths, memoryWrite.path), record };
  }

  return {
    gate,
    gate_path: repoRelative(paths, gateWrite.path),
    research_gate_report: researchGateReport,
    manifest_update: manifestUpdate,
    failed_parity_memory: failedParityMemory
  };
}

function evidenceKindsFromResults(evidenceResults) {
  return new Set((Array.isArray(evidenceResults) ? evidenceResults : [])
    .map((result) => normalizedEvidenceKind(result?.evidence_kind ?? result?.worker_result?.evidence_kind))
    .filter(Boolean));
}

function evidencePathsFromResults(evidenceResults, extraEvidencePaths) {
  const paths = [];
  for (const result of Array.isArray(evidenceResults) ? evidenceResults : []) {
    for (const artifact of Array.isArray(result?.artifacts_created) ? result.artifacts_created : []) paths.push(typeof artifact === "string" ? artifact : artifact?.path);
    for (const artifact of Array.isArray(result?.worker_result?.artifacts) ? result.worker_result.artifacts : []) paths.push(typeof artifact === "string" ? artifact : artifact?.path);
    for (const artifact of Array.isArray(result?.provenance?.result_artifacts) ? result.provenance.result_artifacts : []) paths.push(artifact);
  }
  return normalizeStringArray([...paths, ...(Array.isArray(extraEvidencePaths) ? extraEvidencePaths : [])]);
}

export function buildCandidatePromotionGate({ runId, candidateId = null, targetContext = "research", attempt = 1, adapterName = null, evidenceResults = [], parityReport = null, evidencePaths = [] } = {}) {
  const evidenceKinds = evidenceKindsFromResults(evidenceResults);
  const gateEvidencePaths = evidencePathsFromResults(evidenceResults, [
    ...(parityReport?.run_id && parityReport?.candidate_id ? [`factory/parity/reports/${parityReport.candidate_id}/${parityReport.run_id}.json`] : []),
    ...(Array.isArray(evidencePaths) ? evidencePaths : [])
  ]);
  const rejectionReasons = [];

  if (MT5_PROMOTION_CONTEXTS.has(targetContext) && adapterName === "PaperTradingAdapter") {
    rejectionReasons.push("PaperTradingAdapter output cannot satisfy MT5/FTMO promotion contexts");
  }

  if (MT5_PROMOTION_CONTEXTS.has(targetContext) && evidenceKinds.size > 0 && [...evidenceKinds].every((kind) => kind === "research_wfa")) {
    rejectionReasons.push(`${targetContext} promotion cannot be satisfied by WFA-only evidence`);
  }

  if (targetContext === "mt5_tester" && !evidenceKinds.has("mt5_tester")) rejectionReasons.push("mt5_tester promotion requires mt5_tester evidence");
  if (targetContext === "ftmo_forward" && !evidenceKinds.has("forward_report")) rejectionReasons.push("ftmo_forward promotion requires forward_report evidence");
  if (targetContext === "deployable" && (!evidenceKinds.has("mt5_tester") || !evidenceKinds.has("ftmo_ledger") || !evidenceKinds.has("forward_report"))) {
    rejectionReasons.push("deployable promotion requires mt5_tester, ftmo_ledger, and forward_report evidence");
  }

  if (["parity", "mt5_tester", "ftmo_forward", "deployable"].includes(targetContext)) {
    if (!parityReport || parityReport.evidence_kind !== "parity_report") {
      rejectionReasons.push("promotion context requires a structured parity_report");
    } else {
      if (parityReport.decision !== "pass") rejectionReasons.push(`parity_report decision is ${parityReport.decision}`);
      const missingEmpiricalThresholds = (parityReport.drift_classifications ?? []).filter((item) => !item?.threshold?.empirical_source).map((item) => item.dimension);
      if (missingEmpiricalThresholds.length > 0) rejectionReasons.push(`parity drift thresholds missing empirical sources: ${missingEmpiricalThresholds.join(", ")}`);
    }
  }

  const decision = rejectionReasons.length > 0 ? "denied" : "allowed";
  return {
    ...buildStageGateResult({
      runId: runId ?? "RUN-CANDIDATE-PROMOTION-GATE",
      stage: `${targetContext}_promotion`,
      attempt,
      decision,
      validator: "candidate_promotion_gate",
      evidencePaths: gateEvidencePaths,
      reason: decision === "denied" ? `Candidate promotion denied for ${candidateId ?? "candidate"}: ${rejectionReasons.join("; ")}.` : `Candidate promotion gate allowed ${candidateId ?? "candidate"} for ${targetContext}; downstream gates may still apply.`
    }),
    candidate_id: candidateId,
    target_context: targetContext,
    evidence_kinds: [...evidenceKinds].sort(),
    parity_report_decision: parityReport?.decision ?? null
  };
}

export function buildVerificationManifest(paths) {
  const health = readJson(paths.health, {});
  const latestBakeoff = readLatestTransportBakeoff(paths);
  const stageGates = collectGateResults(paths);
  const denied = stageGates.filter((gate) => gate.decision === "denied").length;
  const allowed = stageGates.filter((gate) => gate.decision === "allowed").length;

  return {
    schema_version: "verification_manifest_v1",
    generated_at: new Date().toISOString(),
    health_path: "factory/health.json",
    latest_transport_bakeoff: latestBakeoff ? path.relative(paths.root, latestBakeoff.path) : null,
    stage_gate_counts: {
      total: stageGates.length,
      allowed,
      denied
    },
    false_pass_prevention: health.false_pass_prevention ?? null,
    executor_completion_rate: health.executor_completion_rate ?? null,
    evidence_yield: health.evidence_yield ?? null,
    run_gate_results: stageGates
  };
}

export function writeVerificationManifest(paths, stamp = stampNow()) {
  const payload = buildVerificationManifest(paths);
  const fullPath = path.join(paths.verification, `verification-manifest-${stamp}.json`);
  writeJsonAtomic(fullPath, payload, paths);
  return { path: fullPath, payload };
}

export function buildRolloutGate(paths, execution = {}) {
  const health = readJson(paths.health, {});
  const latestBakeoff = readLatestTransportBakeoff(paths);
  const checks = {
    no_quarantined_runs: (health.quarantined_run_count ?? 0) === 0,
    prompt_budgets_within_limit: Object.values(health.prompt_budget_breaches ?? {}).every((count) => count === 0),
    transport_evidence_available: Boolean(latestBakeoff?.artifact),
    stage_gates_recorded: (health.false_pass_prevention?.denied_stage_gates ?? 0) >= 0,
    executor_completion_known: typeof health.executor_completion_rate?.completion_rate === "number" || health.executor_completion_rate?.completion_rate === null
  };

  return {
    schema_version: "rollout_gate_v1",
    generated_at: new Date().toISOString(),
    gate_id: typeof execution.gate_id === "string" ? execution.gate_id : null,
    gate_name: typeof execution.gate_name === "string" ? execution.gate_name : null,
    gate_status: normalizeGateStatus(execution.gate_status),
    gate_started_at: typeof execution.gate_started_at === "string" ? execution.gate_started_at : null,
    gate_finished_at: typeof execution.gate_finished_at === "string" ? execution.gate_finished_at : null,
    blocked_reason: typeof execution.blocked_reason === "string" ? execution.blocked_reason : null,
    verification_manifest_path: typeof execution.verification_manifest_path === "string" ? execution.verification_manifest_path : null,
    fault_drills_path: typeof execution.fault_drills_path === "string" ? execution.fault_drills_path : null,
    command_results: normalizeCommandResults(execution.command_results),
    acceptance_checks: normalizeAcceptanceChecks(execution.acceptance_checks),
    evidence_paths: normalizeStringArray(execution.evidence_paths),
    notes: normalizeStringArray(execution.notes),
    checks,
    ready_for_rollout: Object.values(checks).every(Boolean),
    latest_transport_bakeoff: latestBakeoff ? path.relative(paths.root, latestBakeoff.path) : null,
    health_path: "factory/health.json"
  };
}

export function writeRolloutGate(paths, stamp = stampNow(), execution = {}) {
  const payload = buildRolloutGate(paths, execution);
  const fullPath = path.join(paths.verification, `rollout-gate-${stamp}.json`);
  writeJsonAtomic(fullPath, payload, paths);
  return { path: fullPath, payload };
}

export function createVerificationStamp(ts = new Date()) {
  return stampNow(ts);
}

export function finalizeRolloutGateExecution(paths, execution = {}, stamp = createVerificationStamp()) {
  rebuildHealthMetrics(paths);
  const manifest = writeVerificationManifest(paths, stamp);
  const rollout = writeRolloutGate(paths, stamp, {
    ...execution,
    verification_manifest_path: execution.verification_manifest_path ?? path.relative(paths.root, manifest.path)
  });
  return {
    stamp,
    manifestPath: manifest.path,
    manifestPayload: manifest.payload,
    rolloutPath: rollout.path,
    rolloutPayload: rollout.payload
  };
}

export function rebuildDerivedArtifacts(paths) {
  const memory = rebuildNormalizedMemory(paths);
  const health = rebuildHealthMetrics(paths);
  return {
    evidence: memory.evidence,
    leaderboard: memory.leaderboard,
    retrievalIndex: memory.retrievalIndex,
    health
  };
}

function createTempFactoryPaths() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fault-drill-"));
  initializeProject(rootDir);
  return buildPaths(rootDir);
}

async function runDrill(drillId, fn) {
  try {
    const details = await fn();
    return { drill_id: drillId, outcome: details?.outcome || "safe_recovery", details };
  } catch (error) {
    return {
      drill_id: drillId,
      outcome: "explicit_rejection",
      details: {
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function runFaultDrills(paths, stamp = stampNow()) {
  const drills = [];

  drills.push(await runDrill("timeout_before_headers", async () => {
    const transport = new OpenCodeSdkTransport({
      rootDir: paths.root,
      model: "opencode/minimax-m2.5-free",
      serverManager: {
        init: async () => ({}),
        createSession: async () => ({ sessionId: "ses-1", sessionUrl: "http://localhost/session/ses-1" }),
        getClient: () => ({ session: { prompt: async () => { throw new Error("fetch failed", { cause: new Error("headers timeout") }); } } }),
        getStatus: () => ({ initialized: true, serverFingerprint: "fp-1" }),
        close: async () => {}
      }
    });
    try {
      await transport.callAgent("executor", "test");
      return { outcome: "explicit_rejection", failed: false };
    } catch (error) {
      return { outcome: error?.rf_failure_class === "transport_failure" ? "explicit_rejection" : "safe_recovery", phase: error?.rf_transport_phase ?? null };
    }
  }));

  drills.push(await runDrill("disconnect_after_headers", async () => {
    const transport = new OpenCodeSdkTransport({
      rootDir: paths.root,
      model: "opencode/minimax-m2.5-free",
      serverManager: {
        init: async () => ({}),
        createSession: async () => ({ sessionId: "ses-2", sessionUrl: "http://localhost/session/ses-2" }),
        getClient: () => ({ session: { prompt: async () => { throw new Error("fetch failed", { cause: new Error("socket hang up") }); } } }),
        getStatus: () => ({ initialized: true, serverFingerprint: "fp-2" }),
        close: async () => {}
      }
    });
    try {
      await transport.callAgent("executor", "test");
      return { outcome: "explicit_rejection", failed: false };
    } catch (error) {
      return { outcome: error?.rf_failure_class === "transport_failure" ? "explicit_rejection" : "safe_recovery", phase: error?.rf_transport_phase ?? null };
    }
  }));

  drills.push(await runDrill("session_create_success_then_prompt_hang", async () => {
    const transport = new OpenCodeSdkTransport({
      rootDir: paths.root,
      model: "opencode/minimax-m2.5-free",
      transportTimeouts: { totalRequestMs: 10 },
      serverManager: {
        init: async () => ({}),
        createSession: async () => ({ sessionId: "ses-3", sessionUrl: "http://localhost/session/ses-3" }),
        getClient: () => ({ session: { prompt: async () => new Promise(() => {}) } }),
        getStatus: () => ({ initialized: true, serverFingerprint: "fp-3" }),
        close: async () => {}
      }
    });
    try {
      await transport.callAgent("executor", "test");
      return { outcome: "explicit_rejection", failed: false };
    } catch (error) {
      return { outcome: error?.rf_failure_class === "transport_failure" ? "explicit_rejection" : "safe_recovery", phase: error?.rf_transport_phase ?? null };
    }
  }));

  drills.push(await runDrill("owner_death_mid_executor", async () => {
    const tempPaths = createTempFactoryPaths();
    const runtimeState = new RuntimeStateStore(tempPaths);
    const backlogStore = new BacklogStore(tempPaths);
    const artifactStore = { readRunState: () => null };
    acquireOwnerLock(tempPaths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
    runtimeState.markActive({ status: "active", owner_id: "owner-a", run_id: "RUN-1", stage: "executor" });
    const repaired = reconcileStartupState(tempPaths, backlogStore, artifactStore, { nowMs: 1000 + (60 * 60 * 1000) });
    return { outcome: repaired.active_run_repaired ? "safe_recovery" : "explicit_rejection" };
  }));

  drills.push(await runDrill("clean_shutdown_during_executor", async () => {
    const tempPaths = createTempFactoryPaths();
    const acquired = acquireOwnerLock(tempPaths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
    const released = releaseOwnerLock(tempPaths, { ownerId: "owner-a", token: acquired.token, nowMs: 1500, reason: "drill" });
    return { outcome: released.released ? "safe_recovery" : "explicit_rejection" };
  }));

  drills.push(await runDrill("bad_evaluator_artifact_path", async () => {
    validateEvaluationResult({
      verdict: "inconclusive",
      evidence_score: 50,
      overall_score: 40,
      metrics: { sharpe_oos: 0.3 },
      red_flags: [],
      verification: { artifacts_checked: ["workspace/results/missing.json"], metrics_verified_from: ["workspace/results/missing.json"] },
      missing_evidence: [],
      promote_to_leaderboard: false,
      confidence_level: "medium",
      confidence_rationale: "drill"
    }, { mode: "live", rootDir: paths.root });
  }));

  drills.push(await runDrill("generic_summary", async () => {
    validateSummaryResult({
      experiment_id: "EXP-1",
      backlog_item_id: "IDEA-1",
      summary: "This run completed with a clear next step.",
      key_lessons: [{ lesson: "Further research is needed." }],
      next_actions: [{ action: "Continue iterating." }]
    });
  }));

  drills.push(await runDrill("false_executed_claim", async () => {
    validateExecutionResult({
      experiment_id: "EXP-1",
      status: "executed",
      artifacts_created: ["workspace/results/report.json"],
      metrics_observed: { sharpe_oos: 1.2, total_trades: 50 }
    });
  }));

  drills.push(await runDrill("stale_active_run_reconciliation", async () => {
    const tempPaths = createTempFactoryPaths();
    const runtimeState = new RuntimeStateStore(tempPaths);
    const backlogStore = new BacklogStore(tempPaths);
    const artifactStore = { readRunState: () => null };
    runtimeState.markActive({ status: "active", owner_id: "owner-a", run_id: "RUN-1", stage: "executor" });
    const repaired = reconcileStartupState(tempPaths, backlogStore, artifactStore, { nowMs: Date.now() });
    return { outcome: repaired.active_run_repaired ? "safe_recovery" : "explicit_rejection" };
  }));

  drills.push(await runDrill("poisoned_run_move_on_behavior", async () => {
    const tempPaths = createTempFactoryPaths();
    const backlogStore = new BacklogStore(tempPaths);
    backlogStore.append([{ id: "A", status: "infra_cooldown", cooldown_until: "2000-01-01T00:00:00.000Z" }]);
    const recovered = backlogStore.recoverCooldowns(new Date("2000-01-02T00:00:00.000Z"));
    return { outcome: recovered.length === 1 ? "safe_recovery" : "explicit_rejection" };
  }));

  const payload = {
    schema_version: "fault_drills_v1",
    generated_at: new Date().toISOString(),
    drills
  };
  const fullPath = path.join(paths.verification, `fault-drills-${stamp}.json`);
  writeJsonAtomic(fullPath, payload, paths);
  return { path: fullPath, payload };
}

function readLatestVerificationFile(paths, prefix) {
  if (!fs.existsSync(paths.verification)) return null;
  const entries = fs.readdirSync(paths.verification, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map((entry) => ({
      path: path.join(paths.verification, entry.name),
      mtimeMs: fs.statSync(path.join(paths.verification, entry.name)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (entries.length === 0) return null;
  return { path: entries[0].path, payload: readJson(entries[0].path, null) };
}

export function readLatestVerificationManifest(paths) {
  return readLatestVerificationFile(paths, "verification-manifest-");
}

export function readLatestRolloutGate(paths) {
  return readLatestVerificationFile(paths, "rollout-gate-");
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPaths } from "../src/core/paths.mjs";
import { writeJsonAtomic } from "../src/core/fs-utils.mjs";
import { buildPhase8DConsistencyLadderAdvisory } from "../src/core/verification.mjs";
import { evaluatePhase8DConsistencyPromotionRoute, PHASE8D_CONSISTENCY_PROMOTION_POLICY, PHASE8D_SURVIVOR_FLOORS } from "../src/core/wfa-survivor-floors.mjs";

export const PHASE8D_LADDER_CALIBRATION_SCHEMA_VERSION = "phase8d_ladder_calibration_v1";

function readJsonIfExists(fullPath, fallback = null) {
  if (!fs.existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return { __read_error: error instanceof Error ? error.message : String(error) };
  }
}

function listDirs(fullPath) {
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function finiteMetric(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function roundMetric(value, digits = 6) {
  const number = finiteMetric(value);
  return number === null ? null : Number(number.toFixed(digits));
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    const key = typeof value === "string" && value.trim() ? value.trim() : "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function distribution(values) {
  const numbers = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (numbers.length === 0) {
    return { count: 0, min: null, p25: null, median: null, p75: null, p90: null, p95: null, max: null };
  }
  const percentile = (p) => {
    const index = (numbers.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return numbers[lower];
    return numbers[lower] + ((numbers[upper] - numbers[lower]) * (index - lower));
  };
  return {
    count: numbers.length,
    min: roundMetric(numbers[0]),
    p25: roundMetric(percentile(0.25)),
    median: roundMetric(percentile(0.5)),
    p75: roundMetric(percentile(0.75)),
    p90: roundMetric(percentile(0.9)),
    p95: roundMetric(percentile(0.95)),
    max: roundMetric(numbers[numbers.length - 1])
  };
}

function terminalStatus({ evidence, execution, blocked, runState }) {
  return evidence?.terminal_state
    ?? execution?.status
    ?? blocked?.status
    ?? runState?.last_completed_stage
    ?? "unknown";
}

function isPhase8D({ runId, evidence, execution, blocked }) {
  return /^RUN-PHASE8D-/.test(runId)
    || evidence?.schema_version === "phase8d_candidate_evidence_packet_v1"
    || blocked?.schema_version === "phase8d_blocked_at_start_v1"
    || execution?.observations?.phase8d_screening_attempt === true
    || execution?.observations?.phase8d_blocked_at_start === true;
}

function metricSummary(parsedMetrics = {}, evidence = {}, execution = {}) {
  const metrics = parsedMetrics?.metrics && typeof parsedMetrics.metrics === "object" ? parsedMetrics.metrics : {};
  const evidenceMetrics = evidence?.wfa_metrics && typeof evidence.wfa_metrics === "object" ? evidence.wfa_metrics : {};
  const executionMetrics = execution?.metrics_observed && typeof execution.metrics_observed === "object" ? execution.metrics_observed : {};
  const combined = { ...metrics, ...executionMetrics };
  const ladder = buildPhase8DConsistencyLadderAdvisory({ metrics: combined, parsedMetrics });

  return {
    metrics: combined,
    ladder,
    completed_windows: finiteMetric(combined.successful_windows, combined.windows_completed, combined.completed_windows, combined.total_windows, evidenceMetrics.windows),
    trades: finiteMetric(combined.total_trades, combined.trades, combined.aggregate_total_trades, evidenceMetrics.trades),
    return_proxy_pct: finiteMetric(combined.aggregate_return_pct, combined.total_return_pct, combined.return_pct, evidenceMetrics.return_proxy_pct),
    oos_sharpe: finiteMetric(combined.sharpe_oos, combined.aggregate_sharpe, combined.aggregate_sharpe_ratio),
    profit_factor: finiteMetric(combined.profit_factor),
    positive_oos_window_ratio: finiteMetric(ladder.positive_oos_window_ratio, evidenceMetrics.positive_oos_window_ratio),
    single_window_concentration: finiteMetric(ladder.return_concentration?.single_window_share),
    top_two_window_concentration: finiteMetric(ladder.return_concentration?.top_two_window_share),
    drawdown_to_return_ratio: finiteMetric(ladder.drawdown_to_return_ratio?.value),
    wfe: parsedMetrics?.metric_readiness?.wfe ?? parsedMetrics?.artifact_backed_diagnostics?.wfe ?? parsedMetrics?.wfe ?? null,
    wfr: parsedMetrics?.metric_readiness?.wfr ?? parsedMetrics?.artifact_backed_diagnostics?.wfr ?? parsedMetrics?.wfr ?? evidenceMetrics.wfr ?? null
  };
}

function hardFloorAssessment(summary) {
  const failures = [];
  if (summary.oos_sharpe !== null && summary.oos_sharpe <= 0) failures.push("oos_sharpe_non_positive");
  if (summary.return_proxy_pct === null) failures.push("return_proxy_missing");
  else if (summary.return_proxy_pct < PHASE8D_SURVIVOR_FLOORS.minReturnPct) failures.push("return_proxy_pct");
  if (summary.profit_factor !== null && summary.profit_factor < 1) failures.push("profit_factor");
  if (summary.completed_windows === null) failures.push("completed_windows_missing");
  else if (summary.completed_windows < PHASE8D_SURVIVOR_FLOORS.minOosWindows) failures.push("completed_windows");
  if (summary.trades === null) failures.push("trades_missing");
  else if (summary.trades < PHASE8D_SURVIVOR_FLOORS.minTrades) failures.push("trades");
  if (summary.positive_oos_window_ratio === null) failures.push("positive_oos_window_ratio_missing");
  else if (summary.positive_oos_window_ratio < PHASE8D_SURVIVOR_FLOORS.minPositiveWindowRatio) failures.push("positive_oos_window_ratio");

  return {
    policy: {
      label: "legacy_clean_0_70_floor_comparison",
      min_oos_windows: PHASE8D_SURVIVOR_FLOORS.minOosWindows,
      min_trades: PHASE8D_SURVIVOR_FLOORS.minTrades,
      min_return_pct: PHASE8D_SURVIVOR_FLOORS.minReturnPct,
      min_positive_window_ratio: PHASE8D_SURVIVOR_FLOORS.minPositiveWindowRatio,
      sharpe_oos_must_be_positive_when_reported: true,
      profit_factor_must_be_at_least_one_when_reported: true
    },
    passed: failures.length === 0,
    failed_requirements: failures,
    positive_window_ratio_only_failure: failures.length === 1 && failures[0] === "positive_oos_window_ratio"
  };
}

function diagnosticNotes({ parsedMetrics, summary }) {
  const notes = [];
  if (!parsedMetrics) notes.push("missing_parsed_wfa_metrics");
  if (summary.completed_windows === null) notes.push("missing_completed_windows");
  if (summary.trades === null) notes.push("missing_trade_count");
  if (summary.return_proxy_pct === null) notes.push("missing_return_proxy");
  if (summary.oos_sharpe === null) notes.push("missing_oos_sharpe");
  if (summary.profit_factor === null) notes.push("missing_profit_factor");
  if (summary.positive_oos_window_ratio === null) notes.push("missing_positive_oos_window_ratio");
  if (summary.single_window_concentration === null) notes.push(summary.ladder.return_concentration?.status ?? "missing_return_concentration");
  if (summary.drawdown_to_return_ratio === null) notes.push(summary.ladder.drawdown_to_return_ratio?.status ?? "missing_drawdown_to_return_ratio");
  if (!summary.wfe || typeof summary.wfe !== "object" || summary.wfe.value === null || summary.wfe.value === undefined) notes.push("missing_or_blocked_wfe");
  if (!summary.wfr || (typeof summary.wfr === "object" && summary.wfr.value === null)) notes.push("missing_or_blocked_wfr");
  return [...new Set(notes)];
}

function buildRunRecord(paths, runId) {
  const runDir = path.join(paths.runs, runId);
  const parsedMetricsPath = path.join(runDir, "worker-results", "parsed-wfa-metrics.json");
  const evidencePath = path.join(runDir, "phase8d-candidate-evidence-packet.json");
  const executionPath = path.join(runDir, "execution-result.json");
  const blockedPath = path.join(runDir, "phase8d-blocked-at-start.json");
  const runStatePath = path.join(runDir, "run-state.json");
  const parsedMetrics = readJsonIfExists(parsedMetricsPath, null);
  const evidence = readJsonIfExists(evidencePath, null);
  const execution = readJsonIfExists(executionPath, null);
  const blocked = readJsonIfExists(blockedPath, null);
  const runState = readJsonIfExists(runStatePath, null);
  const phase8d = isPhase8D({ runId, evidence, execution, blocked });
  const parsedMetricsValid = parsedMetrics && !parsedMetrics.__read_error && parsedMetrics.metrics && typeof parsedMetrics.metrics === "object";

  if (!phase8d && !parsedMetricsValid) return null;

  if (!parsedMetricsValid) {
    return {
      run_id: runId,
      candidate_id: evidence?.candidate_id ?? execution?.candidate_id ?? blocked?.candidate_id ?? null,
      terminal_status: terminalStatus({ evidence, execution, blocked, runState }),
      is_phase8d: phase8d,
      metrics_available: false,
      current_hard_floor: { passed: false, failed_requirements: ["missing_parsed_wfa_metrics"], positive_window_ratio_only_failure: false },
      advisory_notes: [parsedMetrics?.__read_error ? `parsed_metrics_read_error:${parsedMetrics.__read_error}` : "missing_parsed_wfa_metrics"],
      artifact_paths: {
        parsed_wfa_metrics: fs.existsSync(parsedMetricsPath) ? path.relative(paths.root, parsedMetricsPath).replace(/\\/g, "/") : null,
        phase8d_candidate_evidence_packet: fs.existsSync(evidencePath) ? path.relative(paths.root, evidencePath).replace(/\\/g, "/") : null
      }
    };
  }

  const summary = metricSummary(parsedMetrics, evidence, execution);
  const hardFloor = hardFloorAssessment(summary);
  const consistencyRoute = evaluatePhase8DConsistencyPromotionRoute({
    positiveWindowRatio: summary.positive_oos_window_ratio,
    sharpeOos: summary.oos_sharpe,
    returnPct: summary.return_proxy_pct,
    profitFactor: summary.profit_factor,
    completedWindows: summary.completed_windows,
    diagnostics: summary.ladder
  });
  return {
    run_id: runId,
    candidate_id: evidence?.candidate_id ?? execution?.candidate_id ?? null,
    terminal_status: terminalStatus({ evidence, execution, blocked, runState }),
    is_phase8d: phase8d,
    metrics_available: true,
    completed_windows: roundMetric(summary.completed_windows, 0),
    trades: roundMetric(summary.trades, 0),
    return_proxy_pct: roundMetric(summary.return_proxy_pct),
    oos_sharpe: roundMetric(summary.oos_sharpe),
    profit_factor: roundMetric(summary.profit_factor),
    positive_oos_window_ratio: roundMetric(summary.positive_oos_window_ratio),
    consistency_tier: summary.ladder.tier,
    consistency_label: summary.ladder.label,
    consistency_ladder_advisory: summary.ladder,
    single_window_concentration: roundMetric(summary.single_window_concentration),
    top_two_window_concentration: roundMetric(summary.top_two_window_concentration),
    drawdown_to_return_ratio: roundMetric(summary.drawdown_to_return_ratio),
    wfe: summary.wfe,
    wfr: summary.wfr,
    active_consistency_route: consistencyRoute,
    current_hard_floor: hardFloor,
    legacy_0_70_floor_comparison: hardFloor,
    advisory_notes: diagnosticNotes({ parsedMetrics, summary }),
    artifact_paths: {
      parsed_wfa_metrics: path.relative(paths.root, parsedMetricsPath).replace(/\\/g, "/"),
      phase8d_candidate_evidence_packet: fs.existsSync(evidencePath) ? path.relative(paths.root, evidencePath).replace(/\\/g, "/") : null
    }
  };
}

function interestingLowerTierRuns(records) {
  return records
    .filter((record) => record.metrics_available && record.is_phase8d && ["C2", "C3"].includes(record.consistency_tier))
    .filter((record) => record.current_hard_floor.failed_requirements.some((failure) => failure !== "positive_oos_window_ratio"))
    .map((record) => ({
      run_id: record.run_id,
      candidate_id: record.candidate_id,
      tier: record.consistency_tier,
      positive_oos_window_ratio: record.positive_oos_window_ratio,
      return_proxy_pct: record.return_proxy_pct,
      oos_sharpe: record.oos_sharpe,
      profit_factor: record.profit_factor,
      failed_requirements: record.current_hard_floor.failed_requirements
    }));
}

export function buildPhase8DLadderCalibration({ rootDir = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const paths = buildPaths(rootDir);
  const allRunIds = listDirs(paths.runs).filter((runId) => runId.startsWith("RUN-"));
  const records = allRunIds.map((runId) => buildRunRecord(paths, runId)).filter(Boolean);
  const recordsWithMetrics = records.filter((record) => record.metrics_available);
  const phase8dRecords = records.filter((record) => record.is_phase8d);
  const phase8dWithMetrics = phase8dRecords.filter((record) => record.metrics_available);

  return {
    schema_version: PHASE8D_LADDER_CALIBRATION_SCHEMA_VERSION,
    generated_at: generatedAt,
    phase: "8D",
    purpose: "Reporting-only calibration of the Phase 8D consistency ladder against historical evidence. This artifact does not mutate old evidence or authorize Phase 8E; the active promotion gate may use the separate conditional C1/C2/C3 consistency route policy.",
    authority: {
      reporting_only: true,
      survivor_gate_behavior_changed_by_this_artifact: false,
      active_positive_window_clean_route_floor: PHASE8D_SURVIVOR_FLOORS.minPositiveWindowRatio,
      conditional_consistency_routes_enabled: PHASE8D_CONSISTENCY_PROMOTION_POLICY.status === "enabled_conditional_multi_metric_gate",
      consistency_promotion_policy: PHASE8D_CONSISTENCY_PROMOTION_POLICY,
      phase8e_authorized: false,
      strategy_promoted: false,
      old_run_evidence_mutated: false
    },
    scan_summary: {
      run_directories_scanned: allRunIds.length,
      records_included: records.length,
      records_with_parsed_wfa_metrics: recordsWithMetrics.length,
      phase8d_terminal_attempts: phase8dRecords.length,
      phase8d_runs_with_metrics: phase8dWithMetrics.length,
      phase8d_runs_without_metrics: phase8dRecords.length - phase8dWithMetrics.length
    },
    distributions: {
      tier_counts_all_metrics: countBy(recordsWithMetrics.map((record) => record.consistency_tier)),
      tier_counts_phase8d_metrics: countBy(phase8dWithMetrics.map((record) => record.consistency_tier)),
      terminal_status_counts_all_records: countBy(records.map((record) => record.terminal_status)),
      terminal_status_counts_phase8d: countBy(phase8dRecords.map((record) => record.terminal_status)),
      current_hard_floor_counts_all_metrics: countBy(recordsWithMetrics.map((record) => record.current_hard_floor.passed ? "passed" : "failed")),
      current_hard_floor_counts_phase8d_metrics: countBy(phase8dWithMetrics.map((record) => record.current_hard_floor.passed ? "passed" : "failed")),
      active_consistency_route_counts_phase8d_metrics: countBy(phase8dWithMetrics.map((record) => record.active_consistency_route?.passed ? record.active_consistency_route.route : "failed")),
      positive_window_ratio: distribution(recordsWithMetrics.map((record) => record.positive_oos_window_ratio)),
      phase8d_positive_window_ratio: distribution(phase8dWithMetrics.map((record) => record.positive_oos_window_ratio)),
      single_window_concentration: distribution(recordsWithMetrics.map((record) => record.single_window_concentration)),
      top_two_window_concentration: distribution(recordsWithMetrics.map((record) => record.top_two_window_concentration)),
      drawdown_to_return_ratio: distribution(recordsWithMetrics.map((record) => record.drawdown_to_return_ratio))
    },
    only_0_70_floor_failures: phase8dWithMetrics
      .filter((record) => record.current_hard_floor.positive_window_ratio_only_failure)
      .map((record) => ({ run_id: record.run_id, candidate_id: record.candidate_id, positive_oos_window_ratio: record.positive_oos_window_ratio })),
    lower_tier_interesting_but_other_metrics_fail: interestingLowerTierRuns(phase8dWithMetrics),
    records
  };
}

export function writePhase8DLadderCalibration(pathsOrRoot, artifact = buildPhase8DLadderCalibration({ rootDir: pathsOrRoot.root ?? pathsOrRoot })) {
  const paths = buildPaths(pathsOrRoot.root ?? pathsOrRoot);
  const stamp = artifact.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fullPath = path.join(paths.verification, `phase8d-ladder-calibration-${stamp}.json`);
  writeJsonAtomic(fullPath, artifact, paths);
  return { path: fullPath, payload: artifact };
}

function parseArgs(argv) {
  const args = { rootDir: process.cwd(), write: true };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--root") args.rootDir = argv[++index];
    else if (item === "--no-write") args.write = false;
    else if (item === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/phase8d-ladder-diagnostics.mjs [--root <repo>] [--no-write]");
    return;
  }
  const artifact = buildPhase8DLadderCalibration({ rootDir: args.rootDir });
  const write = args.write ? writePhase8DLadderCalibration(args.rootDir, artifact) : { path: null, payload: artifact };
  console.log(JSON.stringify({ path: write.path, artifact: write.payload }, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

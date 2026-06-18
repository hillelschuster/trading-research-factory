import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";
import { evaluatePhase8DConsistencyPromotionRoute, PHASE8D_SURVIVOR_FLOORS } from "./wfa-survivor-floors.mjs";

export const PHASE8D_EXIT_READINESS_SCHEMA_VERSION = "phase8d_exit_readiness_report_v1";

const STALE_SCOPE_PATTERNS = [/prediction[ _-]?markets?/i, /polymarket/i];

function readIfExists(fullPath) {
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function readJsonIfExists(fullPath, fallback = null) {
  if (!fs.existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return fallback;
  }
}

function criterion(id, status, evidence = [], pending = [], rationale = "") {
  return { id, status, met: status === "met", evidence, pending, rationale };
}

function hasAll(text, fragments) {
  return fragments.every((fragment) => text.includes(fragment));
}

function hasStaleScopeText(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return STALE_SCOPE_PATTERNS.some((pattern) => pattern.test(text));
}

function listDirs(fullPath) {
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function hashFileIfExists(rootDir, repoPath) {
  if (!repoPath || path.isAbsolute(repoPath)) return { ok: false, reason: "missing_or_absolute_path" };
  const fullPath = path.resolve(rootDir, repoPath);
  const root = path.resolve(rootDir);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return { ok: false, reason: "path_escapes_repository" };
  if (!fs.existsSync(fullPath)) return { ok: false, reason: "path_missing_on_disk" };
  return { ok: true, sha256: crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex") };
}

function verifiedSourceRef(rootDir, ref) {
  if (!ref || typeof ref !== "object") return { ok: false, reason: "missing_source_ref" };
  const hashed = hashFileIfExists(rootDir, ref.path);
  if (!hashed.ok) return hashed;
  if (hashed.sha256 !== ref.sha256) return { ok: false, reason: "sha256_mismatch" };
  return { ok: true, sha256: hashed.sha256 };
}

function sourceRefs(...values) {
  const refs = [];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const ref of value) {
      if (ref?.path && ref?.sha256) refs.push(ref);
    }
  }
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.artifact_type ?? "artifact"}:${ref.path}:${ref.sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function positiveLabel(value) {
  return ["promising", "promising_with_caveats", "passed", "success"].includes(String(value ?? "").toLowerCase());
}

function metricNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function screeningMetrics(execution = {}, evidence = {}) {
  const metrics = execution.metrics_observed ?? execution.metrics ?? evidence.wfa_metrics ?? {};
  return {
    windows: metricNumber(metrics.completed_oos_windows, metrics.completed_windows, metrics.oos_windows, metrics.windows, evidence.wfa_metrics?.windows),
    trades: metricNumber(metrics.total_trades, metrics.aggregate_total_trades, metrics.trades, evidence.wfa_metrics?.trades),
    returnPct: metricNumber(metrics.aggregate_return_pct, metrics.return_proxy_pct, metrics.total_return_pct, evidence.wfa_metrics?.return_proxy_pct),
    sharpeOos: metricNumber(metrics.sharpe_oos, metrics.aggregate_sharpe, evidence.wfa_metrics?.sharpe_oos),
    profitFactor: metricNumber(metrics.profit_factor, evidence.wfa_metrics?.profit_factor),
    positiveWindowRatio: metricNumber(metrics.positive_oos_window_ratio, metrics.oos_positive_window_ratio, evidence.wfa_metrics?.positive_oos_window_ratio),
    consistencyDiagnostics: evidence.consistency_ladder_advisory ?? metrics.consistency_ladder_advisory ?? null
  };
}

function clearsSurvivorFloors(metrics) {
  const consistencyRoute = evaluatePhase8DConsistencyPromotionRoute({
    positiveWindowRatio: metrics.positiveWindowRatio,
    sharpeOos: metrics.sharpeOos,
    returnPct: metrics.returnPct,
    profitFactor: metrics.profitFactor,
    completedWindows: metrics.windows,
    diagnostics: metrics.consistencyDiagnostics
  });
  return metrics.windows >= PHASE8D_SURVIVOR_FLOORS.minOosWindows
    && metrics.trades >= PHASE8D_SURVIVOR_FLOORS.minTrades
    && metrics.returnPct >= PHASE8D_SURVIVOR_FLOORS.minReturnPct
    && consistencyRoute.passed;
}

function scanPhase8DScreeningAttempts(paths) {
  const attempts = [];
  for (const runId of listDirs(paths.runs)) {
    const runDir = path.join(paths.runs, runId);
    const blocked = readJsonIfExists(path.join(runDir, "phase8d-blocked-at-start.json"), null);
    const execution = readJsonIfExists(path.join(runDir, "execution-result.json"), null);
    const evidence = readJsonIfExists(path.join(runDir, "phase8d-candidate-evidence-packet.json"), null);
    const evaluation = readJsonIfExists(path.join(runDir, "evaluation.json"), null);
    const runState = readJsonIfExists(path.join(runDir, "run-state.json"), null);
    const sourceHashes = sourceRefs(blocked?.source_hashes, execution?.source_hashes, evidence?.source_hashes);
    const hasPhase8DMarker = blocked?.schema_version === "phase8d_blocked_at_start_v1"
      || evidence?.schema_version === "phase8d_candidate_evidence_packet_v1"
      || execution?.observations?.phase8d_blocked_at_start === true
      || execution?.observations?.phase8d_screening_attempt === true;
    if (!hasPhase8DMarker) continue;

    const terminal = ["blocked", "failed", "inconclusive", "executed"].includes(execution?.status)
      || ["blocked", "failed", "inconclusive", "executed"].includes(blocked?.status)
      || ["phase8d_blocked_at_start", "completed"].includes(runState?.last_completed_stage);
    const hypothesisRefs = sourceHashes.filter((ref) => ref.artifact_type === "hypothesis_packet");
    const preregRefs = sourceHashes.filter((ref) => ref.artifact_type === "research_wfa_preregistration");
    const verifiedHypothesisRefs = hypothesisRefs.filter((ref) => verifiedSourceRef(paths.root, ref).ok);
    const verifiedPreregRefs = preregRefs.filter((ref) => verifiedSourceRef(paths.root, ref).ok);
    const candidateEvidenceRef = evidence ? {
      artifact_type: "phase8d_candidate_evidence_packet",
      path: repoRelative(paths.root, path.join(runDir, "phase8d-candidate-evidence-packet.json")),
      sha256: hashFileIfExists(paths.root, repoRelative(paths.root, path.join(runDir, "phase8d-candidate-evidence-packet.json"))).sha256
    } : null;
    const metrics = screeningMetrics(execution ?? {}, evidence ?? {});
    const verdict = evaluation?.verdict ?? execution?.verdict ?? evidence?.verdict ?? null;

    attempts.push({
      run_id: runId,
      status: execution?.status ?? blocked?.status ?? evidence?.terminal_state ?? "unknown",
      reason: blocked?.reason ?? evidence?.preregistration_gate?.reason ?? null,
      blocked_reason: blocked?.blocked_reason ?? evidence?.blocked_reasons?.[0] ?? null,
      terminal,
      wfa_launched: blocked?.wfa_launched === true || execution?.observations?.wfa_launched === true || evidence?.wfa_launched === true,
      llm_planner_fallback_allowed: blocked?.llm_planner_fallback_allowed === true || execution?.observations?.llm_planner_fallback_allowed === true,
      candidate_id: blocked?.candidate_id ?? execution?.candidate_id ?? evidence?.candidate_id ?? null,
      lineage_id: blocked?.lineage_id ?? evidence?.lineage_id ?? null,
      family_id: blocked?.family_id ?? evidence?.family_id ?? null,
      attempt_id: blocked?.attempt_id ?? evidence?.attempt_id ?? null,
      source_hashes: sourceHashes,
      verified_hypothesis_packet: verifiedHypothesisRefs.length > 0,
      verified_preregistration: verifiedPreregRefs.length > 0,
      has_all_attempt_ids: Boolean((blocked?.candidate_id ?? execution?.candidate_id ?? evidence?.candidate_id) && (blocked?.lineage_id ?? evidence?.lineage_id) && (blocked?.family_id ?? evidence?.family_id) && (blocked?.attempt_id ?? evidence?.attempt_id)),
      candidate_evidence_packet: candidateEvidenceRef,
      candidate_evidence_valid: evidence?.schema_version === "phase8d_candidate_evidence_packet_v1"
        && evidence?.advisory_statistics?.promotion_authority === false
        && Array.isArray(evidence?.cited_artifacts)
        && evidence.cited_artifacts.every((ref) => verifiedSourceRef(paths.root, ref).ok),
      denominator_tracked: evidence?.denominator_context?.attempt_is_denominator_member === true || Boolean(blocked?.attempt_id),
      advisory_stats_reporting_only: evidence?.advisory_statistics?.promotion_authority === false && evidence?.advisory_statistics?.rejection_authority === false,
      phase8e_leak: evidence?.phase8e_boundary?.phase8e_authorized === true || evidence?.phase8e_boundary?.mt5_mql5_parity_deployment_work_started === true,
      metrics,
      verdict,
      below_floor_non_positive: [metrics.windows, metrics.trades, metrics.returnPct, metrics.positiveWindowRatio].some((value) => value !== null)
        && !clearsSurvivorFloors(metrics)
        && !positiveLabel(verdict)
    });
  }
  return attempts;
}

export function buildPhase8DExitReadinessReport({ rootDir = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const paths = buildPaths(rootDir);
  const files = {
    spec: path.join(paths.root, "factory/mt5-ftmo-strategy-factory-spec.md"),
    constants: path.join(paths.root, "src/core/constants.mjs"),
    marketPolicySource: path.join(paths.root, "src/core/market-policy.mjs"),
    promptBuilders: path.join(paths.root, "src/core/prompt-builders.mjs"),
    survivorFloors: path.join(paths.root, "src/core/wfa-survivor-floors.mjs"),
    validators: path.join(paths.root, "src/core/validators.mjs"),
    verification: path.join(paths.root, "src/core/verification.mjs"),
    wfaPlanCompiler: path.join(paths.root, "src/core/wfa-plan-compiler.mjs"),
    researchBrainArtifacts: path.join(paths.root, "src/core/researchbrain-artifacts.mjs"),
    orchestrator: path.join(paths.root, "src/core/orchestrator.mjs"),
    config: path.join(paths.root, "src/core/config.mjs"),
    phase8dReporter: path.join(paths.root, "src/core/phase8d-exit-readiness.mjs"),
    phase8dCli: path.join(paths.root, "scripts/run-phase8d-exit-readiness.mjs"),
    phase8dTests: path.join(paths.root, "tests/phase8d-exit-readiness.test.mjs"),
    packageJson: path.join(paths.root, "package.json")
  };

  const source = Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, readIfExists(filePath)]));
  const state = readJsonIfExists(paths.state, {});
  const marketPolicy = readJsonIfExists(paths.marketPolicy, {});

  const staleScopeSurfaces = {
    factory_goal_constant: !hasStaleScopeText(source.constants),
    state_goal: !hasStaleScopeText(state?.goal),
    market_policy: !hasStaleScopeText(marketPolicy),
    market_policy_default: !hasStaleScopeText(source.marketPolicySource),
    prompt_goal_capsule: !hasStaleScopeText(source.promptBuilders.match(/Goal: \$\{goal\}/)?.[0] ?? "")
  };
  const staleScopeClean = Object.values(staleScopeSurfaces).every(Boolean);

  const sharedSurvivorFloors = hasAll(source.survivorFloors, [
    "minOosWindows: 8",
    "minTrades: 200",
    "minReturnPct: 5",
    "minPositiveWindowRatio: 0.7"
  ]) && hasAll(source.validators, ["PHASE8D_SURVIVOR_FLOORS", "PROMISING_MIN_WINDOWS"])
    && hasAll(source.verification, ["PHASE8D_SURVIVOR_FLOORS", "PHASE8D_MIN_OOS_WINDOWS"]);

  const reporterImplemented = hasAll(source.phase8dReporter, [PHASE8D_EXIT_READINESS_SCHEMA_VERSION, "buildPhase8DExitReadinessReport", "writePhase8DExitReadinessReport"])
    && hasAll(source.phase8dCli, ["buildPhase8DExitReadinessReport", "writePhase8DExitReadinessReport"])
    && source.packageJson.includes("phase8d:exit-readiness");

  const legacyReadyProtection = hasAll(source.wfaPlanCompiler, [
    "legacy_ready_wfa_phase8d_requires_hypothesis_packet",
    "Phase 8D screening WFA attempts must originate from a hash-backed hypothesis_packet_v1"
  ]);
  const deterministicBlockedAtStartArtifacts = hasAll(source.orchestrator, [
    "phase8d_blocked_at_start_v1",
    "llm_planner_fallback_allowed: false",
    "Phase 8D screening attempt blocked before WFA launch"
  ]);
  const targetableScreeningExecution = hasAll(source.orchestrator, ["selectTargetBacklogItem", "screeningBacklogItemId"])
    && hasAll(source.config, ["screening-backlog-id", "screeningBacklogItemId"]);
  const screeningAttempts = scanPhase8DScreeningAttempts(paths);
  const terminalScreeningAttempts = screeningAttempts.filter((attempt) => attempt.terminal);
  const screeningCycleCompleted = terminalScreeningAttempts.some((attempt) => attempt.verified_hypothesis_packet && (!attempt.wfa_launched || attempt.status === "executed" || attempt.status === "inconclusive"));
  const preregistrationGateVerified = terminalScreeningAttempts.some((attempt) => ["missing_research_wfa_preregistration", "invalid_research_wfa_preregistration"].includes(attempt.reason) && attempt.wfa_launched === false && attempt.llm_planner_fallback_allowed === false);
  const sourceQualityGateVerified = terminalScreeningAttempts.some((attempt) => (
    attempt.reason === "researchbrain_source_quality_gate_not_wfa_ready"
      || /source-quality gate blocked direct Phase 8D WFA route/i.test(String(attempt.blocked_reason ?? ""))
  ) && attempt.wfa_launched === false && attempt.llm_planner_fallback_allowed === false);
  const survivorFloorEnforcementVerified = terminalScreeningAttempts.some((attempt) => attempt.below_floor_non_positive);
  const denominatorTrackedAttempts = terminalScreeningAttempts.filter((attempt) => attempt.has_all_attempt_ids && attempt.denominator_tracked);
  const denominatorTrackingExists = denominatorTrackedAttempts.length >= 2;
  const candidateEvidencePacketsComplete = terminalScreeningAttempts.length > 0 && terminalScreeningAttempts.every((attempt) => attempt.candidate_evidence_valid);
  const advisoryStatsBoundaryPreserved = terminalScreeningAttempts.length > 0 && terminalScreeningAttempts.every((attempt) => attempt.advisory_stats_reporting_only);
  const phase8eSpecNotStarted = /#### Phase 8E - MT5 Strategy Tester Parity `\[ \]`/.test(source.spec);
  const noPhase8ELeak = phase8eSpecNotStarted && terminalScreeningAttempts.every((attempt) => !attempt.phase8e_leak);
  const noPostHocWinnerSelection = terminalScreeningAttempts.length > 0 && terminalScreeningAttempts.every((attempt) => attempt.verified_hypothesis_packet && attempt.source_hashes.length > 0);
  const closeoutArtifacts = fs.existsSync(paths.verification)
    ? fs.readdirSync(paths.verification).filter((entry) => /^phase8d-exit-readiness-.*\.json$/.test(entry))
    : [];
  const closeoutArtifactExists = closeoutArtifacts.length > 0;

  const criteria = [
    criterion(
      "stale_prediction_market_scope_removed",
      staleScopeClean ? "met" : "pending",
      ["src/core/constants.mjs", "factory/state.json", "factory/market-policy.json", "src/core/market-policy.mjs", "src/core/prompt-builders.mjs"],
      ["Remove stale prediction-market/Polymarket scope from active Phase 8D control-plane goal and policy surfaces."],
      "Prevents normal agents from reintroducing non-MT5 ideas as Phase 8D screening inputs."
    ),
    criterion(
      "legacy_ready_wfa_routes_blocked_for_phase8d",
      legacyReadyProtection ? "met" : "pending",
      ["src/core/wfa-plan-compiler.mjs", "src/core/orchestrator.mjs"],
      ["Legacy ready WFA backlog items must be rejected for Phase 8D unless converted through a hash-backed hypothesis packet and research_wfa_preregistration_v1."],
      "Prevents historical queue state from becoming Phase 8D WFA roulette."
    ),
    criterion(
      "survivor_floor_constants_shared",
      sharedSurvivorFloors ? "met" : "pending",
      ["src/core/wfa-survivor-floors.mjs", "src/core/validators.mjs", "src/core/verification.mjs"],
      ["Evaluator validation and research-promotion gate diagnostics must use one shared Phase 8D survivor-floor source."],
      "Prevents silent drift between positive-label validation and gate reporting."
    ),
    criterion(
      "deterministic_blocked_at_start_artifacts",
      deterministicBlockedAtStartArtifacts ? "met" : "pending",
      ["src/core/orchestrator.mjs", "src/core/wfa-plan-compiler.mjs", "src/core/researchbrain-artifacts.mjs"],
      ["Compiler/source-quality/pre-registration rejections must write terminal blocked run artifacts instead of falling through to LLM planner/executor paths."],
      "Required for deterministic Phase 8D gate-validation evidence."
    ),
    criterion(
      "targetable_screening_execution",
      targetableScreeningExecution ? "met" : "pending",
      ["src/core/orchestrator.mjs"],
      ["Add a specific backlog/candidate selector so Phase 8D can run one intended screening item without queue roulette."],
      "Required before running bounded 1-3 item screening."
    ),
    criterion(
      "phase8d_exit_readiness_reporter_exists",
      reporterImplemented ? "met" : "pending",
      ["src/core/phase8d-exit-readiness.mjs", "scripts/run-phase8d-exit-readiness.mjs", "tests/phase8d-exit-readiness.test.mjs", "package.json"],
      ["Reporter, CLI, npm script, and focused tests must exist and initially report not_ready_to_close until screening-gate criteria are met."],
      "Provides deterministic closeout accounting for Phase 8D."
    ),
    criterion(
      "screening_cycle_completed",
      screeningCycleCompleted ? "met" : "pending",
      ["factory/runs/"],
      ["At least one non-legacy Phase 8D screening cycle must reach terminal run state with disk-backed artifacts."],
      "Phase 8D is not closeable until the actual bounded pipeline has run or blocked deterministically."
    ),
    criterion(
      "preregistration_gate_verified",
      preregistrationGateVerified ? "met" : "pending",
      ["factory/runs/*/phase8d-blocked-at-start.json", "factory/runs/*/execution-result.json"],
      ["A Phase 8D/screening WFA intent without a valid research_wfa_preregistration_v1 must be blocked before WFA launch with exact diagnostics."],
      "Verifies that pre-registration is a hard launch gate, not an advisory prompt instruction."
    ),
    criterion(
      "source_quality_gate_verified",
      sourceQualityGateVerified ? "met" : "pending",
      ["factory/runs/*/phase8d-blocked-at-start.json"],
      ["A source-quality-blocked ResearchBrain packet or direct-WFA laundering attempt must be blocked before becoming executable WFA evidence."],
      "Verifies Stage-0 packets cannot bypass source-quality constraints."
    ),
    criterion(
      "survivor_floor_enforcement_verified",
      survivorFloorEnforcementVerified ? "met" : "pending",
      ["factory/runs/*/phase8d-candidate-evidence-packet.json", "factory/runs/*/evaluation.json"],
      ["At least one below-floor screening result must remain below promising/passed/success labels."],
      "Verifies the Phase 8D survivor floors are enforced on actual screening evidence, not only encoded as constants."
    ),
    criterion(
      "denominator_tracking_exists",
      denominatorTrackingExists ? "met" : "pending",
      ["factory/runs/*/phase8d-candidate-evidence-packet.json", "factory/runs/*/phase8d-blocked-at-start.json"],
      ["At least two Phase 8D attempts with candidate, lineage, family, run, and attempt IDs must be represented in denominator artifacts or gate diagnostics."],
      "Preserves the denominator for blocked, failed, inconclusive, repaired, mutated, rerun, manual, LLM-generated, and optimizer attempts."
    ),
    criterion(
      "candidate_evidence_packets_exist",
      candidateEvidencePacketsComplete ? "met" : "pending",
      ["factory/runs/*/phase8d-candidate-evidence-packet.json"],
      ["Every completed Phase 8D screening attempt must cite denominator context, source/preregistration hashes where applicable, advisory diagnostics, or exact blocked reasons by artifact path/hash."],
      "Keeps completed screening attempts auditable even when zero candidates survive."
    ),
    criterion(
      "advisory_stats_boundary_preserved",
      advisoryStatsBoundaryPreserved ? "met" : "pending",
      ["factory/runs/*/phase8d-candidate-evidence-packet.json", "src/core/verification.mjs"],
      ["DSR/PBO/CPCV/White must be reported or explicitly blocked with missing inputs and must not be promotion/rejection authority."],
      "Preserves the Phase 7C/8C reporting-only statistical boundary during screening."
    ),
    criterion(
      "no_phase8e_leak",
      noPhase8ELeak ? "met" : "pending",
      ["factory/mt5-ftmo-strategy-factory-spec.md", "factory/runs/"],
      ["No Phase 8D artifact may claim MT5 Strategy Tester parity, MQL5 readiness, deployment readiness, or Phase 8E authorization."],
      "Phase 8E remains blocked without a survivor, verified MT5 equivalence, and explicit operator authorization."
    ),
    criterion(
      "no_post_hoc_winner_selection",
      noPostHocWinnerSelection ? "met" : "pending",
      ["factory/runs/*/phase8d-candidate-evidence-packet.json"],
      ["Every completed screening attempt must have a pre-run hypothesis packet and denominator membership rather than post-hoc historical leaderboard selection."],
      "Prevents WFA roulette and historical-best family laundering."
    ),
    criterion(
      "phase8d_closeout_artifact_exists",
      closeoutArtifactExists ? "met" : "pending",
      closeoutArtifacts.map((entry) => `factory/verification/${entry}`),
      ["Write a timestamped phase8d-exit-readiness artifact with met, pending, deferred, and not-applicable criteria."],
      "Records Phase 8D closeout accounting as a disk-backed verification artifact."
    )
  ];

  const met = criteria.filter((item) => item.met).length;
  const pending = criteria.filter((item) => item.status === "pending").length;
  const deferred = criteria.filter((item) => item.status === "deferred").length;

  return {
    schema_version: PHASE8D_EXIT_READINESS_SCHEMA_VERSION,
    phase: "8D",
    generated_at: generatedAt,
    status: pending === 0 ? "ready_to_close" : "not_ready_to_close",
    summary: { criteria_total: criteria.length, criteria_met: met, criteria_pending: pending, criteria_deferred: deferred },
    criteria,
    diagnostics: {
      stale_scope_surfaces: staleScopeSurfaces,
      phase8d_screening_attempts: terminalScreeningAttempts.map((attempt) => ({
        run_id: attempt.run_id,
        status: attempt.status,
        reason: attempt.reason,
        terminal: attempt.terminal,
        wfa_launched: attempt.wfa_launched,
        verified_hypothesis_packet: attempt.verified_hypothesis_packet,
        verified_preregistration: attempt.verified_preregistration,
        has_all_attempt_ids: attempt.has_all_attempt_ids,
        denominator_tracked: attempt.denominator_tracked,
        candidate_evidence_valid: attempt.candidate_evidence_valid,
        advisory_stats_reporting_only: attempt.advisory_stats_reporting_only,
        below_floor_non_positive: attempt.below_floor_non_positive,
        phase8e_leak: attempt.phase8e_leak
      })),
      phase8d_closeout_artifacts: closeoutArtifacts.map((entry) => `factory/verification/${entry}`)
    },
    closure_assessment: pending === 0
      ? "Phase 8D can close as bounded screening-pipeline validation. Zero survivors remain acceptable if gate-integrity criteria are met."
      : "Phase 8D remains open; pending criteria are required before the bounded screening pipeline can be closed.",
    authority: {
      phase8d_screening_started: screeningCycleCompleted,
      phase8d_survivor_exists: terminalScreeningAttempts.some((attempt) => positiveLabel(attempt.verdict) && clearsSurvivorFloors(attempt.metrics)),
      zero_survivor_closeout_allowed: true,
      phase8e_tester_parity_started: false,
      phase8e_authorized: false,
      mt5_mql5_parity_deployment_work_started: false,
      strategy_edge_claimed: false
    }
  };
}

export function writePhase8DExitReadinessReport(pathsOrRoot, report = buildPhase8DExitReadinessReport({ rootDir: pathsOrRoot.root ?? pathsOrRoot })) {
  const paths = buildPaths(pathsOrRoot.root ?? pathsOrRoot);
  const stamp = report.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fullPath = path.join(paths.verification, `phase8d-exit-readiness-${stamp}.json`);
  const payload = JSON.parse(JSON.stringify(report));
  const closeoutCriterion = payload.criteria?.find((item) => item.id === "phase8d_closeout_artifact_exists");
  if (closeoutCriterion) {
    closeoutCriterion.status = "met";
    closeoutCriterion.met = true;
    closeoutCriterion.evidence = [repoRelative(paths.root, fullPath)];
    closeoutCriterion.pending = [];
  }
  const met = payload.criteria.filter((item) => item.met).length;
  const pending = payload.criteria.filter((item) => item.status === "pending").length;
  const deferred = payload.criteria.filter((item) => item.status === "deferred").length;
  payload.status = pending === 0 ? "ready_to_close" : "not_ready_to_close";
  payload.summary = { criteria_total: payload.criteria.length, criteria_met: met, criteria_pending: pending, criteria_deferred: deferred };
  payload.closure_assessment = pending === 0
    ? "Phase 8D can close as bounded screening-pipeline validation. Zero survivors remain acceptable if gate-integrity criteria are met."
    : "Phase 8D remains open; pending criteria are required before the bounded screening pipeline can be closed.";
  writeJsonAtomic(fullPath, payload, paths);
  return { path: fullPath, payload };
}

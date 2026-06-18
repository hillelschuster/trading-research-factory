import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const PHASE8C_EXIT_READINESS_SCHEMA_VERSION = "phase8c_exit_readiness_report_v1";

function readIfExists(fullPath) {
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function criterion(id, status, evidence = [], pending = [], rationale = "") {
  return { id, status, met: status === "met", evidence, pending, rationale };
}

function hasAll(text, fragments) {
  return fragments.every((fragment) => text.includes(fragment));
}

function hasAny(text, fragments) {
  return fragments.some((fragment) => text.includes(fragment));
}

export function buildPhase8CExitReadinessReport({ rootDir = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const paths = buildPaths(rootDir);
  const files = {
    spec: path.join(paths.root, "factory/mt5-ftmo-strategy-factory-spec.md"),
    verification: path.join(paths.root, "src/core/verification.mjs"),
    validators: path.join(paths.root, "src/core/validators.mjs"),
    wfaWorker: path.join(paths.root, "src/workers/research-wfa-run-worker.mjs"),
    wfaConfigContract: path.join(paths.root, "src/core/wfa-config-contract.mjs"),
    wfaPlanCompiler: path.join(paths.root, "src/core/wfa-plan-compiler.mjs"),
    researchWfaPreregistration: path.join(paths.root, "src/core/research-wfa-preregistration.mjs"),
    lowFrequencyRegistration: path.join(paths.root, "src/core/low-frequency-registration.mjs"),
    orchestrator: path.join(paths.root, "src/core/orchestrator.mjs"),
    researchBrainArtifacts: path.join(paths.root, "src/core/researchbrain-artifacts.mjs"),
    promptBuilders: path.join(paths.root, "src/core/prompt-builders.mjs"),
    verificationTests: path.join(paths.root, "tests/verification.test.mjs"),
    survivorFloors: path.join(paths.root, "src/core/wfa-survivor-floors.mjs"),
    survivorFloorTests: path.join(paths.root, "tests/phase8c-survivor-floors.test.mjs"),
    wfaConfigTests: path.join(paths.root, "tests/wfa-config-output-truth.test.mjs"),
    metricReadinessTests: path.join(paths.root, "tests/wfa-metric-readiness.test.mjs"),
    lowFrequencyTests: path.join(paths.root, "tests/low-frequency-registration.test.mjs"),
    preregistrationTests: path.join(paths.root, "tests/research-wfa-preregistration.test.mjs"),
    factoryTests: path.join(paths.root, "tests/factory.test.mjs"),
    researchBrainTests: path.join(paths.root, "tests/researchbrain-artifacts.test.mjs")
  };

  const source = Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, readIfExists(filePath)]));

  const canonicalWfa = hasAll(source.wfaConfigContract, [
    "walk_forward.training_months",
    "walk_forward.testing_months",
    "walk_forward.step_months",
    "walk_forward.n_parameter_trials",
    "expected_output_root mismatch"
  ]) && hasAll(source.wfaWorker, ["validateCanonicalWfaConfig", "output_root_truth", "expected_output_root"]);

  const wfeWfr = hasAll(source.wfaWorker, [
    "in_sample_return_pct",
    "aggregate_in_sample_return_pct",
    "metric_readiness",
    "computed_artifact_backed"
  ]) && hasAll(source.verification, ["metric_readiness?.wfe", "metric_readiness?.wfr", "missing_in_sample_return"]);

  const leakageBoundary = hasAll(source.wfaConfigContract, ["purge_gap_bars", "indicator_warmup_bars"])
    && hasAll(source.wfaWorker, ["warmup_diagnostics", "applied_to_window_boundaries"])
    && source.verification.includes("generic_indicator_warmup_not_applied");

  const optimizerCostTruth = hasAll(source.verification, [
    "direct_optuna_tpe_study",
    "training_slice_sharpe_from__evaluate_parameter_combination",
    "multi_objective_optimizer_active",
    "transaction_cost_modeler_active",
    "cost_stress_tester_active",
    "contract_incomplete_or_inconsistent",
    "source_review"
  ]) && hasAll(source.wfaWorker, ["optimization_truth", "direct_optuna_tpe_study"]);

  const survivorFloors = hasAll(source.survivorFloors, [
    "minOosWindows: 8",
    "minTrades: 200",
    "minReturnPct: 5",
    "minPositiveWindowRatio: 0.7"
  ]) && hasAll(source.verification, ["PHASE8D_SURVIVOR_FLOORS", "validateLowFrequencyTradeFloorException"])
    && hasAll(source.validators, ["PHASE8D_SURVIVOR_FLOORS", "low_frequency_registration_v1"]);

  const preregistrationLaunchGate = hasAll(source.researchWfaPreregistration, ["research_wfa_preregistration_v1", "invalid_if_added_after_results", "denominator_tracking"])
    && hasAll(source.wfaPlanCompiler, ["missing_research_wfa_preregistration", "Phase 8D/screening WFA attempts require"])
    && hasAll(source.wfaWorker, ["research_wfa_preregistration not consumable", "validateResearchWfaPreregistrationArtifact"]);

  const advisoryStatsBoundary = hasAll(source.verification, [
    "advisory_only_not_a_promotion_gate",
    "hard_gate_enabled: false",
    "source_artifact_review",
    "declared_trial_count_not_numeric",
    "multiple_comparison_context_missing"
  ]);

  const researchBrainDirectRouteGate = hasAll(source.researchBrainArtifacts, [
    "validateResearchBrainBacklogCandidate",
    "validateResearchBrainPlannerProvenance",
    "hypotheses_accepted",
    "ResearchBrain source-quality gate blocks direct WFA-ready backlog"
  ]) && hasAny(source.researchBrainArtifacts, ["planHasDirectResearchWfaRoute", "candidateHasExplicitDirectWfaRoute"]);

  const remediationBoundary = hasAll(source.orchestrator, [
    "buildRepeatedFailureRemediationActions",
    "remediation_key",
    "market_family",
    "instrument_scope",
    "timeframe"
  ]);

  const promptGuardrails = source.promptBuilders.includes("validation gates, not optimization targets")
    || source.promptBuilders.includes("not optimization targets")
    || source.spec.includes("survivor floors from optimization targets");

  const criteria = [
    criterion(
      "canonical_wfa_config_and_output_root_truth",
      canonicalWfa ? "met" : "pending",
      ["src/core/wfa-config-contract.mjs", "src/workers/research-wfa-run-worker.mjs", "tests/wfa-config-output-truth.test.mjs"],
      ["Canonical WFA config fields and expected output root must fail before worker launch/evidence acceptance."],
      "Prevents stale or wrong-root WFA outputs from becoming evidence."
    ),
    criterion(
      "artifact_backed_wfe_wfr_inputs",
      wfeWfr ? "met" : "pending",
      ["src/workers/research-wfa-run-worker.mjs", "src/core/verification.mjs", "tests/wfa-metric-readiness.test.mjs"],
      ["WFE/WFR must compute only from accepted metrics artifacts and otherwise report blocked inputs."],
      "Needed for Phase 8D evidence quality; no invented robustness metrics."
    ),
    criterion(
      "purge_gap_and_warmup_boundary_truth",
      leakageBoundary ? "met" : "pending",
      ["src/core/wfa-config-contract.mjs", "src/workers/research-wfa-run-worker.mjs", "src/core/verification.mjs", "tests/wfa-config-output-truth.test.mjs"],
      ["Purge-gap support and diagnostic-only warmup handling must be explicit."],
      "Reduces leakage risk while avoiding fake generic indicator-warmup protection."
    ),
    criterion(
      "optimizer_cost_truth_and_provenance_reporting",
      optimizerCostTruth ? "met" : "pending",
      ["src/workers/research-wfa-run-worker.mjs", "src/core/verification.mjs", "tests/verification.test.mjs"],
      ["Disconnected optimizer/cost modules must not imply active evidence."],
      "Current Phase 8D safety need is truthful fail-loud reporting, not wiring unused modules."
    ),
    criterion(
      "positive_label_survivor_floor_enforcement",
      survivorFloors ? "met" : "pending",
      ["src/core/verification.mjs", "src/core/validators.mjs", "tests/phase8c-survivor-floors.test.mjs"],
      ["Positive WFA labels must fail below 8 windows, 200 trades unless valid low-frequency registration, 5% return proxy, and 70% positive windows."],
      "This is the core gate that prevents weak Phase 8D screening results from being labeled survivors."
    ),
    criterion(
      "pre_registered_phase8d_wfa_launch_gate",
      preregistrationLaunchGate ? "met" : "pending",
      ["src/core/research-wfa-preregistration.mjs", "src/core/wfa-plan-compiler.mjs", "src/workers/research-wfa-run-worker.mjs", "tests/research-wfa-preregistration.test.mjs"],
      ["Explicit Phase 8D/screening WFA intent must require hash-backed pre-run research-WFA pre-registration before launch."],
      "Required to prevent WFA roulette before candidate screening."
    ),
    criterion(
      "advisory_statistics_reporting_only_boundary",
      advisoryStatsBoundary ? "met" : "pending",
      ["src/core/verification.mjs", "tests/verification.test.mjs"],
      ["DSR/PBO/CPCV/White must report or block exact inputs but remain non-authoritative."],
      "Avoids false confidence from advisory stats while preserving diagnostics for serious candidates."
    ),
    criterion(
      "researchbrain_direct_wfa_source_quality_gate",
      researchBrainDirectRouteGate ? "met" : "pending",
      ["src/core/researchbrain-artifacts.mjs", "tests/researchbrain-artifacts.test.mjs", "tests/factory.test.mjs"],
      ["Source-quality-blocked Stage-0 packets must not reach direct WFA routes through hidden config/command metadata."],
      "Prevents ResearchBrain packet/source laundering into executable WFA evidence."
    ),
    criterion(
      "bounded_remediation_not_spam",
      remediationBoundary ? "met" : "pending",
      ["src/core/orchestrator.mjs", "tests/factory.test.mjs"],
      ["Repeated artifact-backed failures may create bounded remediation items without recursive/generic spam."],
      "Supports learning from failures without turning Phase 8C into endless backlog generation."
    ),
    criterion(
      "survivor_floors_prompt_guardrails",
      promptGuardrails ? "met" : "pending",
      ["src/core/prompt-builders.mjs", "factory/mt5-ftmo-strategy-factory-spec.md", "tests/factory.test.mjs"],
      ["Role prompts/spec must state survivor floors are validation gates, not optimization targets."],
      "Prevents agents from tuning toward floor thresholds after seeing results."
    ),
    criterion(
      "physical_optimizer_cost_module_removal_or_wiring",
      "deferred",
      ["factory/mt5-ftmo-strategy-factory-spec.md", "src/core/verification.mjs"],
      ["Physical deletion/quarantine or full wiring of disconnected optimizer/cost modules is deferred unless evidence shows current fail-loud truth diagnostics can be bypassed."],
      "Not required for Phase 8D safety now because current accepted WFA evidence records the active direct-Optuna path and flags disconnected modules as inactive."
    ),
    criterion(
      "generic_indicator_warmup_inference",
      "deferred",
      ["factory/mt5-ftmo-strategy-factory-spec.md", "src/workers/research-wfa-run-worker.mjs"],
      ["Strategy-specific indicator warmup inference is deferred; Phase 8C only requires explicit purge-gap behavior and fail-loud diagnostic-only warmup truth."],
      "Generic inference would be speculative and could create false leakage confidence."
    ),
    criterion(
      "hard_statistical_promotion_or_input_producers",
      "deferred",
      ["factory/mt5-ftmo-strategy-factory-spec.md", "src/core/verification.mjs"],
      ["Hard DSR/PBO/CPCV/White promotion gates and deterministic statistical input producers remain separate future work."],
      "Phase 8D can screen with advisory/reporting stats; making them hard gates now would overstate their authority."
    ),
    criterion(
      "cost_stress_or_multi_objective_wiring",
      "deferred",
      ["factory/mt5-ftmo-strategy-factory-spec.md", "src/core/verification.mjs"],
      ["Wiring cost-stress, transaction-cost modeler, or multi-objective optimizer into accepted WFA metrics is deferred until a concrete candidate/evidence need exists."],
      "Reporting-only provenance is enough to prevent false claims before Phase 8D screening."
    )
  ];

  const met = criteria.filter((item) => item.met).length;
  const pending = criteria.filter((item) => item.status === "pending").length;
  const deferred = criteria.filter((item) => item.status === "deferred").length;

  return {
    schema_version: PHASE8C_EXIT_READINESS_SCHEMA_VERSION,
    phase: "8C",
    generated_at: generatedAt,
    status: pending === 0 ? "ready_to_close" : "not_ready_to_close",
    summary: { criteria_total: criteria.length, criteria_met: met, criteria_pending: pending, criteria_deferred: deferred },
    criteria,
    closure_assessment: pending === 0
      ? "Phase 8C can close as WFA/evidence-safety hardening. Remaining deferred items are optional or later-phase work, not Phase 8D safety blockers."
      : "Phase 8C should remain open; pending criteria are required to prevent concrete Phase 8D evidence or source-laundering bypasses.",
    authority: {
      phase8b_closed: true,
      phase8c_closes_with_this_report: pending === 0,
      phase8d_screening_started: false,
      phase8e_tester_parity_started: false,
      researchbrain_packets_executable_evidence: false,
      hard_statistical_promotion_enabled: false,
      mt5_mql5_parity_deployment_work_started: false,
      strategy_edge_claimed: false
    }
  };
}

export function writePhase8CExitReadinessReport(pathsOrRoot, report = buildPhase8CExitReadinessReport({ rootDir: pathsOrRoot.root ?? pathsOrRoot })) {
  const paths = buildPaths(pathsOrRoot.root ?? pathsOrRoot);
  const stamp = report.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fullPath = path.join(paths.verification, `phase8c-exit-readiness-${stamp}.json`);
  writeJsonAtomic(fullPath, report, paths);
  return { path: fullPath, payload: report };
}

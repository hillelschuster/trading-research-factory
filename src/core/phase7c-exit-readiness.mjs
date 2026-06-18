import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const PHASE7C_EXIT_READINESS_SCHEMA_VERSION = "phase7c_exit_readiness_report_v1";

function readIfExists(fullPath) {
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function criterion(id, status, evidence = [], pending = []) {
  return { id, status, met: status === "met", evidence, pending };
}

function hasAll(text, fragments) {
  return fragments.every((fragment) => text.includes(fragment));
}

function hasAny(text, fragments) {
  return fragments.some((fragment) => text.includes(fragment));
}

export function buildPhase7CExitReadinessReport({ rootDir = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const paths = buildPaths(rootDir);
  const specPath = path.join(paths.root, "factory/mt5-ftmo-strategy-factory-spec.md");
  const verificationPath = path.join(paths.root, "src/core/verification.mjs");
  const verificationTestPath = path.join(paths.root, "tests/verification.test.mjs");
  const pboFixturePath = path.join(paths.root, "tests/fixtures/statistics/pbo-input-matrix-v1.example.json");
  const cpcvFixturePath = path.join(paths.root, "tests/fixtures/statistics/cpcv-input-matrix-v1.example.json");
  const whiteFixturePath = path.join(paths.root, "tests/fixtures/statistics/white-reality-check-input-v1.example.json");
  const spec = readIfExists(specPath);
  const verification = readIfExists(verificationPath);
  const tests = readIfExists(verificationTestPath);

  const pboImplemented = hasAll(verification, ["pbo_input_matrix_v1", "pbo_input_matrix", "probability_of_backtest_overfit", "pbo_computed_advisory", "pbo_blocked_insufficient_inputs"]);
  const cpcvImplemented = hasAll(verification, ["cpcv_input_matrix_v1", "cpcv_input_matrix", "combinatorial_purged_cross_validation_summary", "cpcv_computed_advisory", "cpcv_blocked_insufficient_inputs"]);
  const whiteImplemented = hasAll(verification, ["white_reality_check_input_v1", "white_reality_check_input", "white_reality_check_supplied_null_p_value", "white_reality_check_computed_advisory", "white_reality_check_blocked_insufficient_inputs"]);
  const hardPromotionDisabled = hasAll(verification, ["enabled_as_promotion_gate: false", "advisory_only_not_a_promotion_gate"])
    && !verification.includes("enabled_as_promotion_gate: true")
    && spec.includes("Hard statistical promotion authority remains explicitly disabled");

  const criteria = [
    criterion(
      "phase7c_spec_scope",
      hasAny(spec, ["Phase 7C - Advisory Anti-Overfit Statistical Consumers", "Phase 7C - Anti-Overfit Statistical Validation"])
        && hasAll(spec, ["PBO design slice", "CPCV design slice", "White Reality Check design slice"]) ? "met" : "pending",
      ["factory/mt5-ftmo-strategy-factory-spec.md"],
      ["Phase 7C spec must document PBO, CPCV, and White advisory scope"]
    ),
    criterion(
      "pbo_advisory_contract",
      pboImplemented && fs.existsSync(pboFixturePath) && tests.includes("research gate PBO computes only as advisory") ? "met" : "pending",
      ["src/core/verification.mjs", "tests/verification.test.mjs", "tests/fixtures/statistics/pbo-input-matrix-v1.example.json"],
      ["PBO needs schema, artifact reader, advisory computation, fixture, and focused tests"]
    ),
    criterion(
      "cpcv_advisory_contract",
      cpcvImplemented && fs.existsSync(cpcvFixturePath) && tests.includes("research gate CPCV computes only as advisory") ? "met" : "pending",
      ["src/core/verification.mjs", "tests/verification.test.mjs", "tests/fixtures/statistics/cpcv-input-matrix-v1.example.json"],
      ["CPCV needs schema, artifact reader, advisory computation, fixture, and focused tests"]
    ),
    criterion(
      "white_reality_check_advisory_contract",
      whiteImplemented && fs.existsSync(whiteFixturePath) && tests.includes("research gate White Reality Check computes only as advisory") ? "met" : "pending",
      ["src/core/verification.mjs", "tests/verification.test.mjs", "tests/fixtures/statistics/white-reality-check-input-v1.example.json"],
      ["White Reality Check needs schema, artifact reader, advisory computation, fixture, and focused tests"]
    ),
    criterion(
      "fail_loud_adversarial_coverage",
      hasAll(tests, ["hash-mismatched", "identity mismatch", "ambiguous multiple", "malformed", "incomplete denominator"]) ? "met" : "pending",
      ["tests/verification.test.mjs"],
      ["PBO/CPCV/White must block missing or bad hash-backed inputs with exact diagnostics"]
    ),
    criterion(
      "hard_statistical_promotion_disabled",
      hardPromotionDisabled ? "met" : "pending",
      ["factory/mt5-ftmo-strategy-factory-spec.md", "src/core/verification.mjs"],
      ["Statistical outputs must remain reporting-only until a later explicit spec amendment"]
    ),
    criterion(
      "statistical_input_producers",
      "deferred",
      ["factory/mt5-ftmo-strategy-factory-spec.md"],
      ["Phase 7C closeout covers advisory consumers only; deterministic PBO/CPCV/White input producers are not enabled here"]
    )
  ];

  const met = criteria.filter((item) => item.met).length;
  const deferred = criteria.filter((item) => item.status === "deferred").length;
  const pending = criteria.filter((item) => item.status === "pending").length;
  return {
    schema_version: PHASE7C_EXIT_READINESS_SCHEMA_VERSION,
    phase: "7C",
    generated_at: generatedAt,
    status: pending === 0 ? "ready_to_close" : "not_ready_to_close",
    summary: { criteria_total: criteria.length, criteria_met: met, criteria_pending: pending, criteria_deferred: deferred },
    criteria,
    statistical_tests: {
      dsr: verification.includes("deflated_sharpe_ratio") ? "advisory_available_explicit_inputs_only" : "disabled",
      pbo: pboImplemented ? "advisory_available_explicit_inputs_only" : "pending",
      cpcv: cpcvImplemented ? "advisory_available_explicit_inputs_only" : "pending",
      white_reality_check: whiteImplemented ? "advisory_available_explicit_inputs_only" : "pending"
    },
    authority: {
      hard_statistical_promotion_enabled: false,
      sqlite_authority_expanded: false,
      mt5_ftmo_live_deployment_started: false
    }
  };
}

export function writePhase7CExitReadinessReport(pathsOrRoot, report = buildPhase7CExitReadinessReport({ rootDir: pathsOrRoot.root ?? pathsOrRoot })) {
  const paths = buildPaths(pathsOrRoot.root ?? pathsOrRoot);
  const stamp = report.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fullPath = path.join(paths.verification, `phase7c-exit-readiness-${stamp}.json`);
  writeJsonAtomic(fullPath, report, paths);
  return { path: fullPath, payload: report };
}

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";
import { runtimeLedgerPath } from "./runtime-ledger.mjs";

export const PHASE7B_EXIT_READINESS_SCHEMA_VERSION = "phase7b_exit_readiness_report_v1";

function readIfExists(fullPath) {
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function criterion(id, status, evidence = [], pending = []) {
  return { id, status, met: status === "met", evidence, pending };
}

function repoPath(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

export function buildPhase7BExitReadinessReport({ rootDir = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const paths = buildPaths(rootDir);
  const planCompilerPath = path.join(paths.root, "src/core/wfa-plan-compiler.mjs");
  const verificationPath = path.join(paths.root, "src/core/verification.mjs");
  const planCompiler = readIfExists(planCompilerPath);
  const verification = readIfExists(verificationPath);
  const ledgerDbPath = runtimeLedgerPath(paths);

  const criteria = [
    criterion(
      "runtime_sqlite_mirror",
      fs.existsSync(path.join(paths.root, "src/core/runtime-ledger.mjs")) ? "met" : "pending",
      ["src/core/runtime-ledger.mjs", repoPath(paths, ledgerDbPath)].filter((entry) => entry && (entry.endsWith(".mjs") || fs.existsSync(path.join(paths.root, entry)))),
      fs.existsSync(ledgerDbPath) ? [] : ["runtime ledger DB has not been materialized in this repo snapshot"]
    ),
    criterion(
      "wfa_data_readiness_manifest_consumption",
      planCompiler.includes("readAndValidateDataReadinessManifest") && planCompiler.includes("data_readiness_max_age_hours") ? "met" : "pending",
      ["src/core/wfa-plan-compiler.mjs", "tests/wfa-data-manifest-consumption.test.mjs"],
      []
    ),
    criterion(
      "advisory_research_wfa_gate_report",
      verification.includes("research_wfa_gate_report_v1") && verification.includes("statistical_tests_enabled: false") ? "met" : "pending",
      ["src/core/verification.mjs", "tests/verification.test.mjs"],
      []
    ),
    criterion(
      "search_denominator_source_slices",
      verification.includes("optimizer_search_context_v1") && verification.includes("non_worker_denominator_attempts_v1") && verification.includes("multiple_comparison_context_v1") ? "met" : "pending",
      ["src/core/verification.mjs", "tests/verification.test.mjs"],
      []
    ),
    criterion(
      "advisory_dsr_statistical_test",
      verification.includes("deflated_sharpe_ratio") && verification.includes("dsr_computed_advisory") && verification.includes("blocked_insufficient_inputs") ? "met" : "pending",
      ["src/core/verification.mjs"],
      ["Phase 7B requires explicit-input advisory DSR only; PBO/CPCV/White are Phase 7C"]
    ),
    criterion(
      "phase7c_statistical_validation",
      "deferred",
      ["factory/mt5-ftmo-strategy-factory-spec.md", "src/core/verification.mjs"],
      ["PBO/CPCV/White and hard statistical promotion authority are explicitly deferred to Phase 7C"]
    ),
    criterion(
      "broad_sqlite_authority_migration",
      "deferred",
      ["src/core/runtime-ledger.mjs"],
      ["Explicitly deferred beyond Phase 7B; SQLite remains a mirror/projection support layer, not orchestration authority"]
    )
  ];

  const met = criteria.filter((item) => item.met).length;
  const deferred = criteria.filter((item) => item.status === "deferred").length;
  const pending = criteria.filter((item) => item.status === "pending").length;
  return {
    schema_version: PHASE7B_EXIT_READINESS_SCHEMA_VERSION,
    phase: "7B",
    generated_at: generatedAt,
    status: pending === 0 ? "ready_to_close" : "not_ready_to_close",
    summary: { criteria_total: criteria.length, criteria_met: met, criteria_pending: pending, criteria_deferred: deferred },
    criteria,
    statistical_tests: {
      dsr: verification.includes("deflated_sharpe_ratio") ? "advisory_available_explicit_inputs_only" : "disabled",
      pbo: "disabled",
      cpcv: "disabled",
      white_reality_check: "disabled"
    }
  };
}

export function writePhase7BExitReadinessReport(pathsOrRoot, report = buildPhase7BExitReadinessReport({ rootDir: pathsOrRoot.root ?? pathsOrRoot })) {
  const paths = buildPaths(pathsOrRoot.root ?? pathsOrRoot);
  const stamp = report.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fullPath = path.join(paths.verification, `phase7b-exit-readiness-${stamp}.json`);
  writeJsonAtomic(fullPath, report, paths);
  return { path: fullPath, payload: report };
}

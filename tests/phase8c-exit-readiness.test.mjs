import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPhase8CExitReadinessReport, PHASE8C_EXIT_READINESS_SCHEMA_VERSION, writePhase8CExitReadinessReport } from "../src/core/phase8c-exit-readiness.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase8c-exit-readiness-"));
}

function copyFixtureRepoSubset(rootDir) {
  for (const repoPath of [
    "factory/mt5-ftmo-strategy-factory-spec.md",
    "src/core/verification.mjs",
    "src/core/validators.mjs",
    "src/workers/research-wfa-run-worker.mjs",
    "src/core/wfa-config-contract.mjs",
    "src/core/wfa-plan-compiler.mjs",
    "src/core/research-wfa-preregistration.mjs",
    "src/core/low-frequency-registration.mjs",
    "src/core/orchestrator.mjs",
    "src/core/researchbrain-artifacts.mjs",
    "src/core/prompt-builders.mjs",
    "src/core/phase8c-exit-readiness.mjs",
    "src/core/wfa-survivor-floors.mjs",
    "tests/verification.test.mjs",
    "tests/phase8c-survivor-floors.test.mjs",
    "tests/wfa-config-output-truth.test.mjs",
    "tests/wfa-metric-readiness.test.mjs",
    "tests/low-frequency-registration.test.mjs",
    "tests/research-wfa-preregistration.test.mjs",
    "tests/factory.test.mjs",
    "tests/researchbrain-artifacts.test.mjs",
    "package.json"
  ]) {
    const source = path.resolve(repoPath);
    const target = path.join(rootDir, repoPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

test("Phase 8C exit-readiness reporter closes only required WFA safety criteria", () => {
  const report = buildPhase8CExitReadinessReport({ rootDir: process.cwd(), generatedAt: "2026-05-27T00:00:00Z" });

  assert.equal(report.schema_version, PHASE8C_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(report.phase, "8C");
  assert.equal(report.status, "ready_to_close");
  assert.equal(report.summary.criteria_pending, 0);
  assert.equal(report.criteria.find((item) => item.id === "canonical_wfa_config_and_output_root_truth").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "artifact_backed_wfe_wfr_inputs").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "positive_label_survivor_floor_enforcement").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "pre_registered_phase8d_wfa_launch_gate").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "physical_optimizer_cost_module_removal_or_wiring").status, "deferred");
  assert.equal(report.criteria.find((item) => item.id === "hard_statistical_promotion_or_input_producers").status, "deferred");
  assert.equal(report.authority.phase8b_closed, true);
  assert.equal(report.authority.phase8c_closes_with_this_report, true);
  assert.equal(report.authority.phase8d_screening_started, false);
  assert.equal(report.authority.strategy_edge_claimed, false);
});

test("Phase 8C exit-readiness reports pending when a required safety gate is absent", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const floorsPath = path.join(rootDir, "src/core/wfa-survivor-floors.mjs");
  const modified = fs.readFileSync(floorsPath, "utf8").replace("minOosWindows: 8", "minOosWindows: 6");
  fs.writeFileSync(floorsPath, modified, "utf8");

  const report = buildPhase8CExitReadinessReport({ rootDir, generatedAt: "2026-05-27T00:00:00Z" });
  const floorCriterion = report.criteria.find((item) => item.id === "positive_label_survivor_floor_enforcement");

  assert.equal(report.status, "not_ready_to_close");
  assert.equal(floorCriterion.status, "pending");
  assert.equal(report.authority.phase8c_closes_with_this_report, false);
});

test("Phase 8C exit-readiness writer emits a verification artifact", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const report = buildPhase8CExitReadinessReport({ rootDir, generatedAt: "2026-05-27T00:00:00Z" });
  const write = writePhase8CExitReadinessReport(rootDir, report);

  assert.equal(fs.existsSync(write.path), true);
  const payload = JSON.parse(fs.readFileSync(write.path, "utf8"));
  assert.equal(payload.schema_version, PHASE8C_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(write.path.includes(path.join("factory", "verification", "phase8c-exit-readiness-")), true);
});

test("Phase 8C exit-readiness CLI writes report and exits zero when only deferred items remain", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const scriptPath = path.resolve("scripts/run-phase8c-exit-readiness.mjs");
  const child = spawnSync(process.execPath, [scriptPath, "--root", rootDir], { encoding: "utf8" });

  assert.equal(child.status, 0, child.stderr);
  const output = JSON.parse(child.stdout);
  assert.equal(output.report.status, "ready_to_close");
  assert.equal(output.report.criteria.find((item) => item.id === "cost_stress_or_multi_objective_wiring").status, "deferred");
  assert.equal(fs.existsSync(output.path), true);
});

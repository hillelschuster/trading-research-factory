import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPhase7CExitReadinessReport, PHASE7C_EXIT_READINESS_SCHEMA_VERSION, writePhase7CExitReadinessReport } from "../src/core/phase7c-exit-readiness.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase7c-exit-readiness-"));
}

function copyFixtureRepoSubset(rootDir) {
  for (const repoPath of [
    "factory/mt5-ftmo-strategy-factory-spec.md",
    "src/core/verification.mjs",
    "src/core/phase7c-exit-readiness.mjs",
    "tests/verification.test.mjs",
    "tests/fixtures/statistics/pbo-input-matrix-v1.example.json",
    "tests/fixtures/statistics/cpcv-input-matrix-v1.example.json",
    "tests/fixtures/statistics/white-reality-check-input-v1.example.json",
    "package.json"
  ]) {
    const source = path.resolve(repoPath);
    const target = path.join(rootDir, repoPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

test("Phase 7C exit-readiness reporter summarizes advisory statistical consumers without hard gates", () => {
  const report = buildPhase7CExitReadinessReport({ rootDir: process.cwd(), generatedAt: "2026-05-16T00:00:00Z" });

  assert.equal(report.schema_version, PHASE7C_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(report.phase, "7C");
  assert.equal(report.status, "ready_to_close");
  assert.equal(report.criteria.find((item) => item.id === "phase7c_spec_scope").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "pbo_advisory_contract").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "cpcv_advisory_contract").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "white_reality_check_advisory_contract").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "hard_statistical_promotion_disabled").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "statistical_input_producers").status, "deferred");
  assert.equal(report.summary.criteria_pending, 0);
  assert.equal(report.summary.criteria_deferred, 1);
  assert.deepEqual(report.statistical_tests, {
    dsr: "advisory_available_explicit_inputs_only",
    pbo: "advisory_available_explicit_inputs_only",
    cpcv: "advisory_available_explicit_inputs_only",
    white_reality_check: "advisory_available_explicit_inputs_only"
  });
  assert.deepEqual(report.authority, {
    hard_statistical_promotion_enabled: false,
    sqlite_authority_expanded: false,
    mt5_ftmo_live_deployment_started: false
  });
});

test("Phase 7C exit-readiness writer emits a verification artifact", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const report = buildPhase7CExitReadinessReport({ rootDir, generatedAt: "2026-05-16T00:00:00Z" });
  const write = writePhase7CExitReadinessReport(rootDir, report);

  assert.equal(fs.existsSync(write.path), true);
  const payload = JSON.parse(fs.readFileSync(write.path, "utf8"));
  assert.equal(payload.schema_version, PHASE7C_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(write.path.includes(path.join("factory", "verification", "phase7c-exit-readiness-")), true);
});

test("Phase 7C exit-readiness CLI writes report and exits zero when only deferred producers remain", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const scriptPath = path.resolve("scripts/run-phase7c-exit-readiness.mjs");
  const child = spawnSync(process.execPath, [scriptPath, "--root", rootDir], { encoding: "utf8" });

  assert.equal(child.status, 0);
  const output = JSON.parse(child.stdout);
  assert.equal(output.report.status, "ready_to_close");
  assert.equal(output.report.criteria.find((item) => item.id === "statistical_input_producers").status, "deferred");
  assert.equal(fs.existsSync(output.path), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPhase7BExitReadinessReport, PHASE7B_EXIT_READINESS_SCHEMA_VERSION, writePhase7BExitReadinessReport } from "../src/core/phase7b-exit-readiness.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase7b-exit-readiness-"));
}

function copyFixtureRepoSubset(rootDir) {
  for (const repoPath of [
    "src/core/runtime-ledger.mjs",
    "src/core/wfa-plan-compiler.mjs",
    "src/core/verification.mjs",
    "src/core/phase7b-exit-readiness.mjs",
    "src/workers/binance-usdm-funding-data-readiness-worker.mjs",
    "scripts/run-binance-usdm-funding-refresh-request.mjs",
    "tests/wfa-data-manifest-consumption.test.mjs",
    "tests/verification.test.mjs",
    "package.json"
  ]) {
    const source = path.resolve(repoPath);
    const target = path.join(rootDir, repoPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

test("Phase 7B exit-readiness reporter summarizes met and deferred criteria without enabling hard statistical gates", () => {
  const report = buildPhase7BExitReadinessReport({ rootDir: process.cwd(), generatedAt: "2026-05-15T00:00:00Z" });

  assert.equal(report.schema_version, PHASE7B_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(report.phase, "7B");
  assert.equal(report.status, "ready_to_close");
  assert.equal(report.criteria.find((item) => item.id === "binance_usdm_funding_refresh_request").met, true);
  assert.equal(report.criteria.find((item) => item.id === "wfa_data_readiness_manifest_consumption").met, true);
  assert.equal(report.criteria.find((item) => item.id === "advisory_dsr_statistical_test").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "phase7c_statistical_validation").status, "deferred");
  assert.equal(report.criteria.find((item) => item.id === "broad_sqlite_authority_migration").status, "deferred");
  assert.equal(report.summary.criteria_pending, 0);
  assert.equal(report.summary.criteria_deferred, 2);
  assert.deepEqual(report.statistical_tests, {
    dsr: "advisory_available_explicit_inputs_only",
    pbo: "disabled",
    cpcv: "disabled",
    white_reality_check: "disabled"
  });
});

test("Phase 7B exit-readiness writer emits a verification artifact", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const report = buildPhase7BExitReadinessReport({ rootDir, generatedAt: "2026-05-15T00:00:00Z" });
  const write = writePhase7BExitReadinessReport(rootDir, report);

  assert.equal(fs.existsSync(write.path), true);
  const payload = JSON.parse(fs.readFileSync(write.path, "utf8"));
  assert.equal(payload.schema_version, PHASE7B_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(write.path.includes(path.join("factory", "verification", "phase7b-exit-readiness-")), true);
});

test("Phase 7B exit-readiness CLI writes report and exits zero when only deferred criteria remain", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const scriptPath = path.resolve("scripts/run-phase7b-exit-readiness.mjs");
  const child = spawnSync(process.execPath, [scriptPath, "--root", rootDir], { encoding: "utf8" });

  assert.equal(child.status, 0);
  const output = JSON.parse(child.stdout);
  assert.equal(output.report.status, "ready_to_close");
  assert.equal(fs.existsSync(output.path), true);
});

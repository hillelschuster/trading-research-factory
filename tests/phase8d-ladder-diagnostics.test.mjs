import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPhase8DLadderCalibration, PHASE8D_LADDER_CALIBRATION_SCHEMA_VERSION, writePhase8DLadderCalibration } from "../scripts/phase8d-ladder-diagnostics.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase8d-ladder-diagnostics-"));
}

function writeJson(rootDir, repoPath, payload) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parsedMetrics(returns, metrics = {}) {
  return {
    metrics: {
      sharpe_oos: 1.2,
      aggregate_return_pct: 6,
      total_trades: 250,
      profit_factor: 1.3,
      successful_windows: returns.length,
      total_windows: returns.length,
      max_drawdown: -3,
      ...metrics
    },
    per_window_metrics: returns.map((total_return_pct, index) => ({
      window_id: index,
      success: true,
      total_return_pct,
      max_drawdown_pct: total_return_pct > 0 ? -0.2 : -1,
      total_trades: 10
    })),
    artifact_backed_diagnostics: {
      wfe: { status: "computed_artifact_backed", value: 0.5 },
      wfr: { status: "computed_artifact_backed", value: 1 }
    }
  };
}

function writeRun(rootDir, { runId, phase8d = true, terminalState = "executed", parsed = null, candidateId = null }) {
  if (phase8d) {
    writeJson(rootDir, `factory/runs/${runId}/phase8d-candidate-evidence-packet.json`, {
      schema_version: "phase8d_candidate_evidence_packet_v1",
      run_id: runId,
      candidate_id: candidateId ?? `CAND-${runId}`,
      terminal_state: terminalState,
      evidence_kind: "research_wfa",
      wfa_metrics: parsed ? {
        windows: parsed.metrics.successful_windows,
        trades: parsed.metrics.total_trades,
        return_proxy_pct: parsed.metrics.aggregate_return_pct,
        positive_oos_window_ratio: null,
        wfr: 1
      } : { status: "not_available" },
      advisory_statistics: { promotion_authority: false, rejection_authority: false },
      phase8e_boundary: { phase8e_authorized: false, mt5_mql5_parity_deployment_work_started: false }
    });
  }
  writeJson(rootDir, `factory/runs/${runId}/execution-result.json`, {
    status: terminalState,
    evidence_kind: "research_wfa",
    candidate_id: candidateId ?? `CAND-${runId}`,
    metrics_observed: parsed?.metrics ?? {},
    observations: { phase8d_screening_attempt: phase8d }
  });
  if (parsed) writeJson(rootDir, `factory/runs/${runId}/worker-results/parsed-wfa-metrics.json`, parsed);
}

test("Phase 8D ladder calibration scans metrics, tiers, hard-floor failures, and denominator attempts", () => {
  const rootDir = tempRoot();
  writeRun(rootDir, {
    runId: "RUN-PHASE8D-C2-ONLY-RATIO",
    parsed: parsedMetrics([1, 1, 1, 1, 1, -1, -1, -1, -1, -1])
  });
  writeRun(rootDir, {
    runId: "RUN-PHASE8D-C3-LOW-RETURN",
    parsed: parsedMetrics([4, 2, 1, -1, -1, -1, -1, -1, -1, -1], { aggregate_return_pct: 1.5 })
  });
  writeRun(rootDir, {
    runId: "RUN-PHASE8D-TIMEOUT-NO-METRICS",
    terminalState: "failed",
    parsed: null
  });
  writeRun(rootDir, {
    runId: "RUN-LEGACY-WFA-C1",
    phase8d: false,
    parsed: parsedMetrics([1, 1, 1, 1, 1, 1, 1, -1, -1, -1])
  });

  const report = buildPhase8DLadderCalibration({ rootDir, generatedAt: "2026-06-01T00:00:00Z" });

  assert.equal(report.schema_version, PHASE8D_LADDER_CALIBRATION_SCHEMA_VERSION);
  assert.equal(report.authority.survivor_gate_behavior_changed_by_this_artifact, false);
  assert.equal(report.authority.active_positive_window_clean_route_floor, 0.7);
  assert.equal(report.authority.conditional_consistency_routes_enabled, true);
  assert.equal(report.scan_summary.run_directories_scanned, 4);
  assert.equal(report.scan_summary.records_with_parsed_wfa_metrics, 3);
  assert.equal(report.scan_summary.phase8d_terminal_attempts, 3);
  assert.equal(report.scan_summary.phase8d_runs_with_metrics, 2);
  assert.deepEqual(report.distributions.tier_counts_phase8d_metrics, { C2: 1, C3: 1 });
  assert.deepEqual(report.distributions.current_hard_floor_counts_phase8d_metrics, { failed: 2 });
  assert.deepEqual(report.only_0_70_floor_failures.map((item) => item.run_id), ["RUN-PHASE8D-C2-ONLY-RATIO"]);
  assert.deepEqual(report.lower_tier_interesting_but_other_metrics_fail.map((item) => item.run_id), ["RUN-PHASE8D-C3-LOW-RETURN"]);
  assert.equal(report.records.find((record) => record.run_id === "RUN-PHASE8D-TIMEOUT-NO-METRICS").metrics_available, false);
});

test("Phase 8D ladder calibration writer emits a new verification artifact", () => {
  const rootDir = tempRoot();
  writeRun(rootDir, {
    runId: "RUN-PHASE8D-WRITER",
    parsed: parsedMetrics([1, 1, 1, 1, 1, 1, 1, -1, -1, -1])
  });

  const report = buildPhase8DLadderCalibration({ rootDir, generatedAt: "2026-06-01T00:00:00Z" });
  const write = writePhase8DLadderCalibration(rootDir, report);
  const payload = JSON.parse(fs.readFileSync(write.path, "utf8"));

  assert.equal(fs.existsSync(write.path), true);
  assert.equal(write.path.includes(path.join("factory", "verification", "phase8d-ladder-calibration-")), true);
  assert.equal(payload.schema_version, PHASE8D_LADDER_CALIBRATION_SCHEMA_VERSION);
  assert.equal(payload.authority.strategy_promoted, false);
});

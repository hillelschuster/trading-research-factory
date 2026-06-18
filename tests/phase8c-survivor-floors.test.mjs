import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildPaths } from "../src/core/paths.mjs";
import { buildLowFrequencyRegistration, writeLowFrequencyRegistration } from "../src/core/low-frequency-registration.mjs";
import { validateEvaluationResult } from "../src/core/validators.mjs";
import { buildResearchWfaPromotionGate } from "../src/core/verification.mjs";

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase8c-survivor-floors-"));
}

const LOW_FREQ_CANDIDATE_ID = "CAND-PHASE8C-FLOOR-001";
const LOW_FREQ_RUN_ID = "RUN-PHASE8C-FLOOR-001";

function positiveEvaluation(metrics = {}, overrides = {}) {
  return {
    candidate_id: LOW_FREQ_CANDIDATE_ID,
    run_id: LOW_FREQ_RUN_ID,
    verdict: "promising",
    evidence_score: 82,
    overall_score: 78,
    metrics: {
      sharpe_oos: 1.1,
      aggregate_return_pct: 5.2,
      total_trades: 220,
      windows_completed: 8,
      positive_sharpe_windows_pct: 0.75,
      ...metrics
    },
    red_flags: [],
    verification: {
      artifacts_checked: ["walk forward engine/strategies/demo/results/walk_forward_results.json"],
      metrics_verified_from: ["walk forward engine/strategies/demo/results/walk_forward_results.json"],
      ...(overrides.verification ?? {})
    },
    missing_evidence: [],
    promote_to_leaderboard: false,
    confidence_level: "medium",
    confidence_rationale: "Focused Phase 8C survivor-floor validation fixture.",
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "verification"))
  };
}

function writeMetricsArtifact(rootDir, payload = {}) {
  const repoPath = "walk forward engine/strategies/demo/results/walk_forward_results.json";
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify({
    aggregate_sharpe_ratio: 1.1,
    aggregate_return_pct: 5.2,
    aggregate_total_trades: 220,
    successful_windows: 8,
    positive_sharpe_windows_pct: 0.75,
    ...payload
  }, null, 2) + "\n", "utf8");
}

function writeLowFrequencyArtifact(rootDir, overrides = {}) {
  const paths = buildPaths(rootDir);
  const registration = buildLowFrequencyRegistration({
    candidate_id: LOW_FREQ_CANDIDATE_ID,
    registered_at: "2026-05-24T08:00:00.000Z",
    registered_before_run_id: LOW_FREQ_RUN_ID,
    expected_trade_count_class: "structural_low_frequency",
    expected_trades_per_year: 18,
    expected_holding_period: "multi-day event-driven holds",
    why_low_frequency_is_structural: "The setup depends on rare macro event transitions, so trade frequency is structurally limited before any WFA result is known.",
    minimum_acceptable_trades: 80,
    required_extra_controls: [
      "longer_history",
      "regime_diversity",
      "concentration_risk_checks",
      "drawdown_scrutiny",
      "hard_minimum_trade_floor",
      "no_after_the_fact_excuses"
    ],
    ...overrides
  });
  return writeLowFrequencyRegistration(paths, registration);
}

test("Phase 8C positive research WFA labels require Phase 8D minimum floors", () => {
  assert.throws(
    () => validateEvaluationResult(positiveEvaluation({ windows_completed: 7 }), { mode: "live", evidenceKind: "research_wfa" }),
    /need at least 8/i
  );

  assert.throws(
    () => validateEvaluationResult(positiveEvaluation({ total_trades: 199 }), { mode: "live", evidenceKind: "research_wfa" }),
    /need at least 200/i
  );

  assert.throws(
    () => validateEvaluationResult(positiveEvaluation({ aggregate_return_pct: 4.9 }), { mode: "live", evidenceKind: "research_wfa" }),
    /below 5%/i
  );

  const missingRatio = positiveEvaluation();
  delete missingRatio.metrics.positive_sharpe_windows_pct;
  assert.throws(
    () => validateEvaluationResult(missingRatio, { mode: "live", evidenceKind: "research_wfa" }),
    /missing positive OOS window ratio/i
  );
});

test("Phase 8C positive research WFA labels pass only when floors and cited artifacts agree", () => {
  const rootDir = createTempRoot();
  writeMetricsArtifact(rootDir);

  assert.doesNotThrow(
    () => validateEvaluationResult(positiveEvaluation(), { mode: "live", rootDir, evidenceKind: "research_wfa" })
  );
});

test("research WFA promotion gate denies survivor claims below Phase 8D floors", () => {
  const gate = buildResearchWfaPromotionGate({
    runId: "RUN-PHASE8C-FLOOR-GATE-001",
    candidateId: "CAND-PHASE8C-FLOOR-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-PHASE8C-FLOOR-001",
      metrics_observed: {
        sharpe_oos: 1.2,
        aggregate_return_pct: 4.9,
        profit_factor: 1.2,
        total_trades: 199,
        successful_windows: 7,
        positive_sharpe_windows_pct: 0.69
      },
      provenance: {
        result_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"]
      }
    }
  });

  assert.equal(gate.decision, "denied");
  assert.match(gate.reason, /completed OOS windows below Phase 8D floor/i);
  assert.match(gate.reason, /trade count below Phase 8D floor/i);
  assert.match(gate.reason, /aggregate return proxy below Phase 8D floor/i);
  assert.match(gate.reason, /Phase 8D consistency route denied/i);
});

test("research WFA promotion gate can clear only the minimum research floor diagnostics", () => {
  const gate = buildResearchWfaPromotionGate({
    runId: "RUN-PHASE8C-FLOOR-GATE-002",
    candidateId: "CAND-PHASE8C-FLOOR-002",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-PHASE8C-FLOOR-002",
      metrics_observed: {
        sharpe_oos: 1.2,
        aggregate_return_pct: 5,
        profit_factor: 1.2,
        total_trades: 200,
        successful_windows: 8,
        positive_sharpe_windows_pct: 0.7
      },
      provenance: {
        result_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"]
      }
    }
  });

  assert.equal(gate.decision, "allowed");
  assert.match(gate.reason, /cleared Phase 8D minimum floor diagnostics/i);
  assert.match(gate.reason, /downstream MT5\/native gates are still required/i);
});

test("low-frequency registration can relax only the research-WFA trade-count floor", () => {
  const rootDir = createTempRoot();
  const registrationArtifact = writeLowFrequencyArtifact(rootDir);
  writeMetricsArtifact(rootDir, { aggregate_total_trades: 120 });

  assert.doesNotThrow(() => validateEvaluationResult(
    positiveEvaluation({ total_trades: 120 }, { verification: { low_frequency_registration: registrationArtifact } }),
    {
      mode: "live",
      rootDir,
      evidenceKind: "research_wfa",
      candidateId: LOW_FREQ_CANDIDATE_ID,
      runId: LOW_FREQ_RUN_ID,
      resultsKnownAt: "2026-05-24T09:00:00.000Z"
    }
  ));

  assert.throws(
    () => validateEvaluationResult(
      positiveEvaluation({ total_trades: 120, windows_completed: 7 }, { verification: { low_frequency_registration: registrationArtifact } }),
      {
        mode: "live",
        rootDir,
        evidenceKind: "research_wfa",
        candidateId: LOW_FREQ_CANDIDATE_ID,
        runId: LOW_FREQ_RUN_ID,
        resultsKnownAt: "2026-05-24T09:00:00.000Z"
      }
    ),
    /need at least 8/i
  );
});

test("invalid low-frequency registrations do not relax the trade-count floor", () => {
  const rootDir = createTempRoot();
  const registrationArtifact = writeLowFrequencyArtifact(rootDir);
  writeMetricsArtifact(rootDir, { aggregate_total_trades: 120 });
  const evaluation = positiveEvaluation({ total_trades: 120 }, { verification: { low_frequency_registration: registrationArtifact } });

  assert.throws(
    () => validateEvaluationResult(evaluation, {
      mode: "live",
      rootDir,
      evidenceKind: "research_wfa",
      candidateId: LOW_FREQ_CANDIDATE_ID,
      runId: LOW_FREQ_RUN_ID,
      resultsKnownAt: "2026-05-24T07:59:00.000Z"
    }),
    /after WFA results were known/i
  );

  assert.throws(
    () => validateEvaluationResult(
      positiveEvaluation({ total_trades: 120 }, { verification: { low_frequency_registration: { ...registrationArtifact, sha256: "0".repeat(64) } } }),
      {
        mode: "live",
        rootDir,
        evidenceKind: "research_wfa",
        candidateId: LOW_FREQ_CANDIDATE_ID,
        runId: LOW_FREQ_RUN_ID,
        resultsKnownAt: "2026-05-24T09:00:00.000Z"
      }
    ),
    /sha256 mismatch/i
  );
});

test("research WFA promotion gate consumes hash-backed low-frequency registration only for trade floor", () => {
  const rootDir = createTempRoot();
  const registrationArtifact = writeLowFrequencyArtifact(rootDir);
  const baseExecutionResult = {
    status: "executed",
    evidence_kind: "research_wfa",
    candidate_id: LOW_FREQ_CANDIDATE_ID,
    observed_at: "2026-05-24T09:00:00.000Z",
    metrics_observed: {
      sharpe_oos: 1.2,
      aggregate_return_pct: 5,
      profit_factor: 1.2,
      total_trades: 120,
      successful_windows: 8,
      positive_sharpe_windows_pct: 0.7
    },
    provenance: {
      result_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"],
      low_frequency_registration: registrationArtifact
    },
    worker_result: { run_id: LOW_FREQ_RUN_ID }
  };

  const allowed = buildResearchWfaPromotionGate({
    runId: LOW_FREQ_RUN_ID,
    candidateId: LOW_FREQ_CANDIDATE_ID,
    rootDir,
    executionResult: baseExecutionResult
  });
  assert.equal(allowed.decision, "allowed");

  const denied = buildResearchWfaPromotionGate({
    runId: LOW_FREQ_RUN_ID,
    candidateId: LOW_FREQ_CANDIDATE_ID,
    rootDir,
    executionResult: {
      ...baseExecutionResult,
      provenance: { ...baseExecutionResult.provenance, low_frequency_registration: { ...registrationArtifact, sha256: "0".repeat(64) } }
    }
  });
  assert.equal(denied.decision, "denied");
  assert.match(denied.reason, /no valid pre-run low_frequency_registration_v1 exception/i);
});

test("research WFA promotion gate keeps advisory statistics non-authoritative", () => {
  const gate = buildResearchWfaPromotionGate({
    runId: "RUN-PHASE8C-ADVISORY-STATS-001",
    candidateId: "CAND-PHASE8C-ADVISORY-STATS-001",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-PHASE8C-ADVISORY-STATS-001",
      metrics_observed: {
        sharpe_oos: 1.2,
        aggregate_return_pct: 5.5,
        profit_factor: 1.2,
        total_trades: 220,
        successful_windows: 8,
        positive_sharpe_windows_pct: 0.75
      },
      provenance: {
        result_artifacts: ["walk forward engine/strategies/demo/results/analysis.json"]
      }
    }
  });

  assert.equal(gate.decision, "allowed");
  assert.equal(gate.statistical_test_authority.hard_gate_enabled, false);
  assert.equal(gate.statistical_test_authority.dsr, "advisory_only_not_a_promotion_gate");
  assert.equal(gate.statistical_test_authority.pbo, "advisory_only_not_a_promotion_gate");
  assert.equal(gate.statistical_test_authority.cpcv, "advisory_only_not_a_promotion_gate");
  assert.equal(gate.statistical_test_authority.white_reality_check, "advisory_only_not_a_promotion_gate");
  assert.match(gate.reason, /advisory DSR\/PBO\/CPCV\/White statistics remain non-authoritative/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildPhase8DConsistencyLadderAdvisory, buildResearchWfaGateReport, buildResearchWfaPromotionGate } from "../src/core/verification.mjs";
import { PHASE8D_CONSISTENCY_TIERS, PHASE8D_SURVIVOR_FLOORS } from "../src/core/wfa-survivor-floors.mjs";

function parsedMetricsWithReturns(returns, overrides = {}) {
  return {
    metrics: {
      aggregate_return_pct: 4,
      max_drawdown: -2,
      successful_windows: returns.length,
      total_windows: returns.length,
      total_trades: 250,
      ...overrides.metrics
    },
    per_window_metrics: returns.map((total_return_pct, index) => ({
      window_id: index,
      total_return_pct,
      max_drawdown_pct: total_return_pct >= 0 ? -0.2 : -0.8,
      total_trades: 10,
      best_parameters: { lookback: 10 }
    }))
  };
}

test("Phase 8D consistency tiers keep C1 floor and expose flexible routes", () => {
  assert.equal(PHASE8D_SURVIVOR_FLOORS.minPositiveWindowRatio, 0.7);
  assert.equal(PHASE8D_CONSISTENCY_TIERS.status, "tiered_consistency_policy_enabled");
  assert.equal(PHASE8D_CONSISTENCY_TIERS.clean_consistency_floor, 0.7);
  assert.deepEqual(PHASE8D_CONSISTENCY_TIERS.tiers.map((tier) => tier.tier), ["C1", "C2", "C3", "C4"]);
});

test("Phase 8D consistency ladder classifies C1-C4 from positive OOS window ratios", () => {
  const c1 = buildPhase8DConsistencyLadderAdvisory({ parsedMetrics: parsedMetricsWithReturns([1, 2, 3, -1]) });
  const c2 = buildPhase8DConsistencyLadderAdvisory({ parsedMetrics: parsedMetricsWithReturns([1, 2, -1, -2]) });
  const c3 = buildPhase8DConsistencyLadderAdvisory({ parsedMetrics: parsedMetricsWithReturns([1, -1, -2]) });
  const c4 = buildPhase8DConsistencyLadderAdvisory({ parsedMetrics: parsedMetricsWithReturns([1, -1, -2, -3, -4]) });

  assert.equal(c1.tier, "C1");
  assert.equal(c1.label, "clean_consistency");
  assert.equal(c2.tier, "C2");
  assert.equal(c2.label, "moderate_consistency");
  assert.equal(c3.tier, "C3");
  assert.equal(c3.label, "lumpy_payoff");
  assert.equal(c4.tier, "C4");
  assert.equal(c4.label, "pathologically_concentrated");
});

test("Phase 8D consistency ladder reports concentration and drawdown-to-return diagnostics", () => {
  const advisory = buildPhase8DConsistencyLadderAdvisory({
    parsedMetrics: parsedMetricsWithReturns([3, 1, -0.5, -0.25], {
      metrics: { aggregate_return_pct: 4, max_drawdown: -2 }
    })
  });

  assert.equal(advisory.status, "tiered_consistency_policy_enabled");
  assert.equal(advisory.return_concentration.status, "computed_artifact_backed");
  assert.equal(advisory.return_concentration.single_window_share, 0.75);
  assert.equal(advisory.return_concentration.top_two_window_share, 1);
  assert.equal(advisory.drawdown_to_return_ratio.status, "computed_artifact_backed");
  assert.equal(advisory.drawdown_to_return_ratio.value, 0.5);
});

test("research WFA advisory gate report includes consistency ladder without promotion authority", () => {
  const parsedMetrics = parsedMetricsWithReturns([0.5, -0.2, 0.7, -0.1], {
    metrics: { aggregate_return_pct: 1.2, max_drawdown: -0.6, successful_windows: 4, total_trades: 40 }
  });
  const report = buildResearchWfaGateReport({
    runId: "RUN-PHASE8D-LADDER-REPORT",
    candidateId: "CAND-PHASE8D-LADDER-REPORT",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-PHASE8D-LADDER-REPORT",
      metrics_observed: parsedMetrics.metrics
    },
    parsedMetrics
  });

  assert.equal(report.reporting_only, true);
  assert.equal(report.promotion_decision, "not_a_promotion_gate");
  assert.equal(report.consistency_ladder_advisory.status, "tiered_consistency_policy_enabled");
  assert.equal(report.consistency_ladder_advisory.tier, "C2");
  assert.equal(report.consistency_ladder_advisory.return_concentration.single_window_share, 0.583333);
  assert.equal(report.consistency_ladder_advisory.drawdown_to_return_ratio.value, 0.5);
  assert.equal(report.consistency_ladder_advisory.low_window_count_warning.status, "low_window_count_low_consistency");
  assert.ok(report.flags.includes("low_window_count_low_consistency"));
  assert.ok(report.flags.includes("return_concentration_reported"));
  assert.ok(report.flags.includes("drawdown_to_return_reported"));
});

test("promotion gate denies C2/C3 without compensating diagnostics", () => {
  const gate = buildResearchWfaPromotionGate({
    runId: "RUN-PHASE8D-LADDER-PROMOTION",
    candidateId: "CAND-PHASE8D-LADDER-PROMOTION",
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-PHASE8D-LADDER-PROMOTION",
      metrics_observed: {
        sharpe_oos: 1.1,
        aggregate_return_pct: 6,
        profit_factor: 1.4,
        total_trades: 250,
        successful_windows: 20,
        positive_sharpe_windows_pct: 0.69
      }
    }
  });

  assert.equal(gate.decision, "denied");
  assert.match(gate.reason, /C2 route requires artifact-backed single-window concentration/i);
});

test("promotion gate allows compensated C2 moderate-consistency candidates", () => {
  const parsedMetrics = parsedMetricsWithReturns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -0.5, -0.4, -0.3, -0.2, -0.1, -0.1, -0.1, -0.1], {
    metrics: {
      sharpe_oos: 0.6,
      aggregate_return_pct: 6,
      max_drawdown: -2,
      profit_factor: 1.25,
      successful_windows: 20,
      total_trades: 250
    }
  });
  const gate = buildResearchWfaPromotionGate({
    runId: "RUN-PHASE8D-LADDER-C2-PASS",
    candidateId: "CAND-PHASE8D-LADDER-C2-PASS",
    parsedMetrics,
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-PHASE8D-LADDER-C2-PASS",
      metrics_observed: parsedMetrics.metrics
    }
  });

  assert.equal(gate.decision, "allowed");
  assert.equal(gate.consistency_promotion_policy.route, "C2");
  assert.match(gate.reason, /via C2 consistency route/i);
});

test("promotion gate allows strongly compensated C3 lumpy-payoff candidates", () => {
  const parsedMetrics = parsedMetricsWithReturns([2, 2, 2, 2, 2, 2, 2, 2, -0.4, -0.4, -0.4, -0.4, -0.4, -0.4, -0.4, -0.4, -0.4, -0.4, -0.4, -0.4], {
    metrics: {
      sharpe_oos: 0.9,
      aggregate_return_pct: 12,
      max_drawdown: -3,
      profit_factor: 1.45,
      successful_windows: 20,
      total_trades: 300
    }
  });
  const gate = buildResearchWfaPromotionGate({
    runId: "RUN-PHASE8D-LADDER-C3-PASS",
    candidateId: "CAND-PHASE8D-LADDER-C3-PASS",
    parsedMetrics,
    executionResult: {
      status: "executed",
      evidence_kind: "research_wfa",
      candidate_id: "CAND-PHASE8D-LADDER-C3-PASS",
      metrics_observed: parsedMetrics.metrics
    }
  });

  assert.equal(gate.decision, "allowed");
  assert.equal(gate.consistency_promotion_policy.route, "C3");
  assert.match(gate.reason, /via C3 consistency route/i);
});

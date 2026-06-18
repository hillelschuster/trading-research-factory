export const PHASE8D_SURVIVOR_FLOORS = Object.freeze({
  minOosWindows: 8,
  minTrades: 200,
  minReturnPct: 5,
  minPositiveWindowRatio: 0.7
});

export const PHASE8D_CONSISTENCY_TIERS = Object.freeze({
  status: "tiered_consistency_policy_enabled",
  clean_consistency_floor: PHASE8D_SURVIVOR_FLOORS.minPositiveWindowRatio,
  tiers: Object.freeze([
    Object.freeze({ tier: "C1", label: "clean_consistency", minInclusive: 0.7, maxExclusive: null }),
    Object.freeze({ tier: "C2", label: "moderate_consistency", minInclusive: 0.5, maxExclusive: 0.7 }),
    Object.freeze({ tier: "C3", label: "lumpy_payoff", minInclusive: 0.3, maxExclusive: 0.5 }),
    Object.freeze({ tier: "C4", label: "pathologically_concentrated", minInclusive: null, maxExclusive: 0.3 })
  ]),
  low_window_count_threshold: 15,
  low_window_count_ratio_warning_below: 0.65
});

export const PHASE8D_CONSISTENCY_PROMOTION_POLICY = Object.freeze({
  status: "enabled_conditional_multi_metric_gate",
  note: "C1 keeps the historical 0.70 clean-consistency route. C2/C3 may pass only when stronger return, Sharpe/profit-factor, sample-size, concentration, and drawdown diagnostics compensate for lower positive-window consistency.",
  routes: Object.freeze({
    C1: Object.freeze({
      label: "clean_consistency_route",
      minPositiveWindowRatio: 0.7,
      requiresAdditionalDiagnostics: false
    }),
    C2: Object.freeze({
      label: "moderate_consistency_compensated_route",
      minPositiveWindowRatio: 0.5,
      minReturnPct: 5,
      minSharpeOos: 0.35,
      minProfitFactor: 1.15,
      minOosWindows: 15,
      maxSingleWindowConcentration: 0.6,
      maxTopTwoWindowConcentration: 0.85,
      maxDrawdownToReturnRatio: 3
    }),
    C3: Object.freeze({
      label: "lumpy_payoff_compensated_route",
      minPositiveWindowRatio: 0.3,
      minReturnPct: 10,
      minSharpeOos: 0.75,
      minProfitFactor: 1.35,
      minOosWindows: 20,
      maxSingleWindowConcentration: 0.45,
      maxTopTwoWindowConcentration: 0.7,
      maxDrawdownToReturnRatio: 2
    })
  })
});

function finiteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function finiteRatio(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return number > 1 ? number / 100 : number;
}

function consistencyValue(diagnostics, key, nestedKey) {
  const direct = finiteNumber(diagnostics?.[key]);
  if (direct !== null) return direct;
  return finiteNumber(diagnostics?.[nestedKey]?.value);
}

function concentrationValue(diagnostics, key) {
  return finiteNumber(diagnostics?.return_concentration?.[key] ?? diagnostics?.[key]);
}

function classifyTier(ratio) {
  const normalized = finiteRatio(ratio);
  if (normalized === null) return null;
  const tier = PHASE8D_CONSISTENCY_TIERS.tiers.find((entry) => {
    const aboveMin = entry.minInclusive === null || normalized >= entry.minInclusive;
    const belowMax = entry.maxExclusive === null || normalized < entry.maxExclusive;
    return aboveMin && belowMax;
  });
  return tier?.tier ?? null;
}

export function evaluatePhase8DConsistencyPromotionRoute({
  positiveWindowRatio,
  sharpeOos = null,
  returnPct = null,
  profitFactor = null,
  completedWindows = null,
  diagnostics = null
} = {}) {
  const ratio = finiteRatio(positiveWindowRatio ?? diagnostics?.positive_oos_window_ratio);
  if (ratio === null) {
    return { passed: false, route: null, tier: null, failures: ["missing positive OOS window ratio for Phase 8D consistency policy"], policy: PHASE8D_CONSISTENCY_PROMOTION_POLICY };
  }

  const tier = diagnostics?.tier ?? classifyTier(ratio);
  if (tier === "C1") {
    return { passed: true, route: "C1", tier, failures: [], policy: PHASE8D_CONSISTENCY_PROMOTION_POLICY };
  }
  if (!tier || tier === "C4") {
    return { passed: false, route: null, tier, failures: [`positive OOS window ratio is ${tier ?? "unclassified"}; no Phase 8D compensated route exists for ratio ${ratio}`], policy: PHASE8D_CONSISTENCY_PROMOTION_POLICY };
  }

  const route = PHASE8D_CONSISTENCY_PROMOTION_POLICY.routes[tier];
  if (!route) {
    return { passed: false, route: null, tier, failures: [`missing Phase 8D compensated route policy for ${tier}`], policy: PHASE8D_CONSISTENCY_PROMOTION_POLICY };
  }

  const effectiveReturnPct = finiteNumber(returnPct);
  const effectiveSharpe = finiteNumber(sharpeOos);
  const effectiveProfitFactor = finiteNumber(profitFactor);
  const effectiveWindows = finiteNumber(completedWindows);
  const singleWindowConcentration = concentrationValue(diagnostics, "single_window_share");
  const topTwoWindowConcentration = concentrationValue(diagnostics, "top_two_window_share");
  const drawdownToReturnRatio = consistencyValue(diagnostics, "drawdown_to_return_ratio", "drawdown_to_return_ratio");
  const failures = [];

  if (effectiveReturnPct === null) failures.push(`${tier} route requires return >= ${route.minReturnPct}% but return metric is missing`);
  else if (effectiveReturnPct < route.minReturnPct) failures.push(`${tier} route requires return >= ${route.minReturnPct}% (${effectiveReturnPct}% observed)`);
  if (effectiveSharpe === null) failures.push(`${tier} route requires OOS Sharpe >= ${route.minSharpeOos} but OOS Sharpe is missing`);
  else if (effectiveSharpe < route.minSharpeOos) failures.push(`${tier} route requires OOS Sharpe >= ${route.minSharpeOos} (${effectiveSharpe} observed)`);
  if (effectiveProfitFactor === null) failures.push(`${tier} route requires profit factor >= ${route.minProfitFactor} but profit factor is missing`);
  else if (effectiveProfitFactor < route.minProfitFactor) failures.push(`${tier} route requires profit factor >= ${route.minProfitFactor} (${effectiveProfitFactor} observed)`);
  if (effectiveWindows === null) failures.push(`${tier} route requires at least ${route.minOosWindows} completed OOS windows but window count is missing`);
  else if (effectiveWindows < route.minOosWindows) failures.push(`${tier} route requires at least ${route.minOosWindows} completed OOS windows (${effectiveWindows} observed)`);
  if (singleWindowConcentration === null) failures.push(`${tier} route requires artifact-backed single-window concentration`);
  else if (singleWindowConcentration > route.maxSingleWindowConcentration) failures.push(`${tier} route single-window concentration too high (${singleWindowConcentration} > ${route.maxSingleWindowConcentration})`);
  if (topTwoWindowConcentration === null) failures.push(`${tier} route requires artifact-backed top-two-window concentration`);
  else if (topTwoWindowConcentration > route.maxTopTwoWindowConcentration) failures.push(`${tier} route top-two-window concentration too high (${topTwoWindowConcentration} > ${route.maxTopTwoWindowConcentration})`);
  if (drawdownToReturnRatio === null) failures.push(`${tier} route requires artifact-backed drawdown-to-return ratio`);
  else if (drawdownToReturnRatio > route.maxDrawdownToReturnRatio) failures.push(`${tier} route drawdown-to-return ratio too high (${drawdownToReturnRatio} > ${route.maxDrawdownToReturnRatio})`);

  return {
    passed: failures.length === 0,
    route: failures.length === 0 ? tier : null,
    tier,
    failures,
    observed: {
      positive_window_ratio: ratio,
      return_pct: effectiveReturnPct,
      sharpe_oos: effectiveSharpe,
      profit_factor: effectiveProfitFactor,
      completed_windows: effectiveWindows,
      single_window_concentration: singleWindowConcentration,
      top_two_window_concentration: topTwoWindowConcentration,
      drawdown_to_return_ratio: drawdownToReturnRatio
    },
    policy: PHASE8D_CONSISTENCY_PROMOTION_POLICY
  };
}

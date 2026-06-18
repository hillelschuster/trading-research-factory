import { readJson } from "./fs-utils.mjs";

export const DEFAULT_MARKET_POLICY = {
  schema_version: "market_policy_v1",
  updated_at: "2026-05-28T00:00:00.000Z",
  market_family_priorities: [
    { market_family: "mt5_verified", priority: 1 },
    { market_family: "forex", priority: 2 },
    { market_family: "indices", priority: 3 },
    { market_family: "metals", priority: 4 },
    { market_family: "commodities", priority: 5 },
    { market_family: "equities", priority: 6 },
    { market_family: "crypto", priority: 7 }
  ],
  allowed_source_families: {
    mt5_verified: ["ftmo_mt5_terminal", "mt5_history_snapshot"],
    forex: ["ftmo_mt5_terminal", "dukascopy"],
    indices: ["ftmo_mt5_terminal", "public_ohlcv_archive"],
    metals: ["ftmo_mt5_terminal", "public_ohlcv_archive"],
    commodities: ["ftmo_mt5_terminal", "public_ohlcv_archive"],
    equities: ["ftmo_mt5_terminal", "public_ohlcv_archive"],
    crypto: ["ftmo_mt5_terminal", "binance", "public_archive"]
  },
  default_history_rules_by_market_family: {
    mt5_verified: {
      expectation: "longest clean broker-mapped MT5 history realistically available",
      short_window_requires_explicit_justification: true
    },
    crypto: {
      expectation: "multi-year when realistically available",
      short_window_requires_explicit_justification: true
    },
    forex: {
      expectation: "longest clean liquid-history realistically available",
      short_window_requires_explicit_justification: true
    },
    indices: {
      expectation: "longest clean liquid-history realistically available",
      short_window_requires_explicit_justification: true
    },
    metals: {
      expectation: "longest clean liquid-history realistically available",
      short_window_requires_explicit_justification: true
    },
    commodities: {
      expectation: "longest clean liquid-history realistically available",
      short_window_requires_explicit_justification: true
    },
    equities: {
      expectation: "longest clean liquid-history realistically available",
      short_window_requires_explicit_justification: true
    }
  },
  selection_policy: {
    min_ready_backlog_depth: 3,
    ready_statuses: ["ready"],
    minimum_trade_count_for_promotion: 20,
    ranking_weights: {
      base_priority: 1,
      comparable_evidence: 0.2,
      robustness_bonus: 8,
      revisit_bonus: 6,
      novelty_bonus: 5,
      repeated_blocker_penalty: 8,
      low_trade_penalty: 10,
      underexplored_market_bonus: 4
    }
  },
  exclusions: [],
  notes: []
};

export function readMarketPolicy(paths) {
  return normalizeMarketPolicy(readJson(paths.marketPolicy, DEFAULT_MARKET_POLICY));
}

export function normalizeMarketPolicy(policy) {
  const source = policy && typeof policy === "object" ? policy : DEFAULT_MARKET_POLICY;
  const selection = source.selection_policy && typeof source.selection_policy === "object"
    ? source.selection_policy
    : {};

  return {
    ...DEFAULT_MARKET_POLICY,
    ...source,
    selection_policy: {
      ...DEFAULT_MARKET_POLICY.selection_policy,
      ...selection,
      ready_statuses: Array.isArray(selection.ready_statuses) && selection.ready_statuses.length > 0
        ? selection.ready_statuses
        : DEFAULT_MARKET_POLICY.selection_policy.ready_statuses,
      min_ready_backlog_depth: Math.max(1, Number(selection.min_ready_backlog_depth) || DEFAULT_MARKET_POLICY.selection_policy.min_ready_backlog_depth),
      minimum_trade_count_for_promotion: Number(selection.minimum_trade_count_for_promotion) || DEFAULT_MARKET_POLICY.selection_policy.minimum_trade_count_for_promotion,
      ranking_weights: {
        ...DEFAULT_MARKET_POLICY.selection_policy.ranking_weights,
        ...(selection.ranking_weights && typeof selection.ranking_weights === "object" ? selection.ranking_weights : {})
      }
    }
  };
}

export function marketPolicyCapsule(policy) {
  const source = normalizeMarketPolicy(policy);
  return {
    schema_version: source.schema_version,
    updated_at: source.updated_at,
    market_family_priorities: source.market_family_priorities,
    allowed_source_families: source.allowed_source_families,
    default_history_rules_by_market_family: source.default_history_rules_by_market_family,
    selection_policy: source.selection_policy,
    exclusions: source.exclusions
  };
}

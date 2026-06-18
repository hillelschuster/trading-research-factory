# RUN-PHASE8D-VOL-ADAPTIVE-TREND-20260531133727

Phase 8D BTCUSD-equivalent volatility-adaptive Supertrend screening.

- Candidate: CAND-PHASE8D-VOL-ADAPTIVE-TREND-20260531133727
- Status: executed
- Blocked reason: none
- MT5 relevance: mt5_relevant_unverified; BTCUSD appears in terminal universe, but Binance BTCUSDT data equivalence is not verified
- Runtime feasibility rationale: Pre-result mechanical runtime-feasibility repair: the canonical VOL_ADAPTIVE_TREND route uses 150 trials on BTC H1, and the immediately prior BTC H1 Phase 8D 150-trial screening route timed out after 1800000ms before accepted WFA outputs. This attempt preserves the hypothesis, strategy source, parameter space, data source, and costs but uses a Phase 8D-specific 25-trial config before any performance result is known.
- Low-frequency exception: none; default 200-trade floor applies
- Windows: 57
- Trades: 220
- Return proxy pct: 1.3086664056586577
- Positive OOS window ratio: 0.403509
- WFR: 1
- Survivor floor failures: return_proxy_pct, positive_oos_window_ratio

This is Phase 8D screening evidence only. It is not a Phase 8E authorization or MT5/MQL5 deployment claim.

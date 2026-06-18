# RUN-PHASE8D-BTC-BB-SQUEEZE-RUNTIME-20260530223043

Phase 8D BTCUSD-equivalent BB-width squeeze volatility breakout screening.

- Candidate: CAND-PHASE8D-BTC-BB-SQUEEZE-RUNTIME-20260530223043
- Status: executed
- Blocked reason: none
- MT5 relevance: mt5_relevant_unverified; BTCUSD appears in terminal universe, but Binance BTCUSDT data equivalence is not verified
- Runtime repair rationale: Pre-result mechanical runtime repair: original Phase 8D BTC BB squeeze attempt RUN-PHASE8D-BTC-BB-SQUEEZE-20260530215722 timed out after 1800000ms with accepted_output_count=0 and no artifact-backed WFA metrics, so this new denominator attempt keeps the same hypothesis/source/data/costs but uses a Phase 8D-specific 25-trial WFA config to complete within the worker budget.
- Low-frequency exception: none; default 200-trade floor applies
- Windows: 57
- Trades: 1101
- Return proxy pct: 0.09117433540026997
- Positive OOS window ratio: 0.45614
- WFR: 1
- Survivor floor failures: return_proxy_pct, positive_oos_window_ratio

This is Phase 8D screening evidence only. It is not a Phase 8E authorization or MT5/MQL5 deployment claim.

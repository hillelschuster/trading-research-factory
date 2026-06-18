# RUN-PHASE8D-GBPJPY-REVERSION-20260529132537

Phase 8D GBPJPY liquidity-vacuum reversion screening.

- Candidate: CAND-PHASE8D-GBPJPY-REVERSION-20260529132537
- Status: executed
- Blocked reason: none
- MT5 relevance: mt5_relevant_unverified; GBPJPY appears in terminal universe, but data equivalence is not verified
- Repair rationale: Pre-run mechanical feasibility repair: data.min_required_bars was reduced from 5000 to 2000 because the first 6-month GBPJPY M15 training split has 2500 bars and the first 3-month validation split has 3724 bars; no performance result was used.
- Runtime capture rationale: Pre-run mechanical runtime-capture repair: this WFA route emits large per-window logs, so the worker request max_buffer_bytes is raised to 134217728 without changing strategy logic, data, costs, WFA windows, or parameters.
- Windows: 125
- Trades: 586
- Return proxy pct: -0.17134851868752796
- Positive OOS window ratio: 0.216
- WFR: 1
- Survivor floor failures: return_proxy_pct, positive_oos_window_ratio

This is Phase 8D screening evidence only. It is not a Phase 8E authorization or MT5/MQL5 deployment claim.

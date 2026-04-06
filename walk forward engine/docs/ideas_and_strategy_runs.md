# Strategy Ideas and WFA Run History

This file consolidates the useful content from the former `docs/ideas.md` and `docs/strategyideasandruns.md` into one working reference.

## Current Strategy Status

| Strategy | Asset | Code File | Current Read |
|---|---|---|---|
| London Breakout | EURUSD | `london_breakout.py` | ⚠️ Tainted historical runs due to config issues |
| Mean Reversion RSI | XAUUSD | `mean_reversion_rsi.py` | ⚠️ Tainted historical runs due to config issues |
| GBPJPY Reversion | GBPJPY | `gbpjpy_reversion.py` | ⚠️ Weak smoke result; may be too restrictive |
| NY PM Reversion | EURUSD | `ny_pm_reversion.py` | ⚠️ Weak result with too many zero-trade windows |
| Trend Following SMA | TBD asset | `trend_following_sma.py` | Not meaningfully run yet |

## Historical Run Notes

### Mean Reversion (XAUUSD)
- **History:** 5 tainted runs
- **Issue:** Config errors caused invalid/default-driven runs
- **Observed result:** about `-4.5%` aggregate, not trustworthy
- **Action:** fix config, then rerun cleanly before making any judgment

### GBPJPY Reversion
- **History:** 1 smoke run
- **Observed result:** 42 windows, about `-2.2%`, with 7 zero-trade windows
- **Read:** parameters likely too restrictive, especially `bb_std=2.5`
- **Action:** lower priority; revisit only after higher-value reruns

### NY PM Reversion (EURUSD)
- **History:** 1 run
- **Observed result:** 56 windows, about `-1.0%`, with roughly 70% zero-trade windows
- **Read:** parameters likely too restrictive, especially `min_daily_atr`
- **Action:** lower priority; requires larger parameter rethink

### London Breakout (EURUSD)
- **History:** 6 tainted runs
- **Issue:** config problems make the historical results unreliable
- **Action:** defer until higher-priority mean-reversion cleanup is done

### London Sweep & Fade (EURUSD)
- **Status:** abandoned
- **Reason:** 22-year WFA was effectively flat-to-bad and the core idea appears to require tick-level order-flow / CVD-style information that the available M15 FX data cannot provide
- **What was tried:** range-based delta and RSI(7) divergence proxies; both worsened PF
- **Conclusion:** do not keep investing in this line; prefer ORB-style concepts that do not depend on unavailable order-flow information

## Recommended Near-Term Priorities

### Immediate focus: mean reversion research

| Priority | Asset | Strategy | Why |
|---|---|---|---|
| 1 | XAUUSD | `mean_reversion_rsi` | Already built; highest-value rerun once config is corrected |
| 2 | AUDNZD | `mean_reversion_rsi` | Strong mean-reversion candidate: correlated economies, relatively rangy behavior |
| 3 | EURGBP | `mean_reversion_rsi` | Another solid mean-reversion candidate with lower trendiness than majors |

### Mean-reversion asset shortlist

| Pair | Suitability | Notes |
|---|---|---|
| AUDNZD | High | Correlated economies, historically rangy, lower volatility |
| EURGBP | High | Mature economies, often range-bound relative to majors |
| USDCHF | Medium | Can mean-revert, but intervention risk matters |
| NZDCAD | Low | Less liquid, wider spreads |
| EURCHF | Avoid | 2015 SNB crash tail risk makes it unattractive |

### Future trend-following exploration

| Asset | Strategy | Why it may fit |
|---|---|---|
| BTC | `trend_following_sma` | Structurally trended market |
| Gold | momentum / persistence style | H4 trend-following is a natural fit |
| US indices | `trend_following_sma` | Index markets often trend more cleanly than FX |

## Draft Strategy Ideas (Condensed)

These came from the former raw prototype file and are preserved here as concise research notes rather than full code dumps.

### 1) Turnaround Tuesday
- **Market / TF:** daily
- **Setup:** if Monday closes red, buy on Tuesday
- **Exit:** close after `N` bars (default idea: next bar)
- **Use case:** simple day-of-week reversal prototype worth testing on equity-index or broad-risk markets more than on random FX pairs

### 2) SP500 Mean Reversion
- **Market / TF:** S&P 500 / US500, daily
- **Setup:** buy when `Close > SMA(200)` and `RSI(2)` is oversold
- **Exit:** close when `RSI(2)` reverts above a sell threshold
- **Use case:** classic trend-filtered mean-reversion idea for equity index markets

### 3) Gold Rush Pro
- **Market / TF:** Gold, daily prototype
- **Setup:** Thursday entry with RSI filter
- **Risk / exit:** ATR-based stop and time-based exit after `N` bars
- **Use case:** day-of-week + momentum/mean-reversion hybrid concept for gold

### Gold H4 momentum parameter grid (if pursued later)

| Parameter | Suggested values |
|---|---|
| ADX threshold | 15, 20, 25, 30 |
| Chandelier multiplier | 2.0, 2.5, 3.0, 3.5 |
| Chandelier period | 14, 22, 30 |
| ROC period | 12, 16, 20, 24 |
| SMA period | 50, 100 |

**Note:** ADX in the original note used EMA smoothing rather than Wilder RMA, so thresholds may need interpretation rather than blind reuse.

## Action Checklist

### Phase 1 — Mean reversion
- [ ] Fix XAUUSD config issues and rerun clean WFA
- [ ] Add AUDNZD data source and WFA config
- [ ] Run AUDNZD mean reversion
- [ ] If promising, run EURGBP mean reversion

### Phase 2 — Trend following
- [ ] Prepare BTC data
- [ ] Configure `trend_following_sma` for BTC
- [ ] Run WFA on BTC trend

## Practical takeaways

- Historical results for XAUUSD mean reversion and London Breakout are not decision-grade until config issues are fixed.
- GBPJPY Reversion and NY PM Reversion look more like parameter-restriction problems than immediate dead strategies.
- London Sweep & Fade should stay abandoned unless data quality / market microstructure assumptions change materially.
- The best next research path is still: **clean XAUUSD rerun -> AUDNZD MR -> EURGBP MR -> then expand into trend-following markets**.
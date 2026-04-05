# Strategy Digest

## Summary
Total strategies tested: 12 | Passed: 6 | Failed: 1 | Inconclusive: 4 | Blocked: 1

## Top Performers
| Strategy | Asset | Sharpe OOS | WFR | Verdict | Key Finding |
|----------|-------|------------|-----|---------|-------------|
| RSI | BTC/USDT | 0.94 | 75 | passed | Extended RSI params (period 21, OB 35/75) = best factory result |
| RSI | BTC/USDT | 0.79 | 80 | passed | First RSI BTC run; BTC oscillates better than ETH/SOL |
| SOL-BTC Spread | SOL/BTC | 0.57 | 75 | passed | Highest spread Sharpe; BTC-SOL vol differential creates best arb |
| Bollinger Bands | ETH/USDT | 0.39 | 75 | passed | BB outperformed SMA on ETH only |
| SMA Crossover | SOL/USDT | 0.53 | 75 | passed | Higher vol assets benefit most from trend-following |
| Cross-Asset Spread | BTC/ETH | 0.12 | 70 | passed | Mean-reversion works but underperforms best single-asset |

## All Strategies
| Strategy | Type | Asset | Timeframe | Sharpe OOS | WFR | Trades | Verdict | Notes |
|----------|------|-------|----------|------------|-----|--------|---------|-------|
| RSI | momentum | BTC/USDT | 1h | 0.94 | 75 | N/A | passed | Best factory result; extended params (21, 35/75) |
| RSI | momentum | BTC/USDT | 1h | 0.79 | 80 | N/A | passed | First RSI BTC; BTC oscillates better than ETH/SOL |
| SOL-BTC Spread | spread | SOL/BTC | 1h | 0.57 | 75 | N/A | passed | Best spread; vol differential creates arb opportunity |
| SMA Crossover | trend | SOL/USDT | 1h | 0.53 | 75 | N/A | passed | Higher vol SOL benefits from trend-following |
| Bollinger Bands | mean-rev | ETH/USDT | 1h | 0.39 | 75 | N/A | passed | BB outperformed SMA on ETH only |
| Cross-Asset Spread | spread | BTC/ETH | 1h | 0.12 | 70 | N/A | passed | Mean-reversion works but underperforms single-asset |
| ATR Breakout | breakout | BTC/USDT | 1h | -5.0 | 60 | 2 | inconclusive | Params too conservative; 0% win rate; need 6-12mo data |
| London Sweep | session-range | BTC/USDT | 1h | -4.997 | 40 | 2 | inconclusive | Massive 1677 pip Asian ranges; strategy needs rethinking |
| Polymarket Hybrid | sentiment-filter | BTC/USDT | N/A | N/A | 45 | N/A | partial | Fetched 19 active markets; crypto pairs identified |
| RSI+Polymarket | hybrid | BTC/USDT | N/A | N/A | 15 | N/A | blocked | Execution blocked: pandas missing |
| Volume Profile | order-flow | BTC/USDT | 1h | N/A | 60 | N/A | blocked | Code valid; execution blocked: pandas missing |
| ATR Breakout | breakout | BTC/USDT | 1h | -0.10 | 50 | N/A | inconclusive | Partial OOS window; params too conservative |

## Asset Performance Summary
| Asset | Best Strategy | Best Sharpe | Notes |
|-------|--------------|-------------|-------|
| BTC/USDT | RSI (extended) | 0.94 | Best overall; oscillates well for mean-reversion |
| ETH/USDT | Bollinger Bands | 0.39 | ETH trending > oscillating; BB suited better |
| SOL/USDT | SMA Crossover | 0.53 | High vol + trend = good for momentum |
| BTC/SOL | Cross-Asset Spread | 0.57 | Best spread pair; vol differential key |

## Infrastructure Notes
- Agent environment lacks pandas/numpy; WFA uses pure Python `wfa_minimal.py`
- WFA .venv is Windows-based; agent runs in WSL - environment gap persists
- Data: 500-1000 candles (42 days) insufficient for robust multi-window WFA; need 6-12 months
- Best results came from 500-candle period, not 1000 - market regime timing matters

| MACD Divergence + RSI | momentum | BTC/USDT | 1h | N/A | N/A | N/A | inconclusive | Novel signal class; WFA not executed; WSL/pandas blocker; divergence may be too rare on 1h (10 params, 43k bars) |

## Full WFA Engine Results (2026-03-21)

### EXP-20260321200000-01 | EMA Trend Gate | ETH/USDT | 1h | 85 windows | REAL WFA EXECUTED ✓
| Metric | Value |
|--------|-------|
| Aggregate OOS Sharpe | 0.528 |
| Per-window OOS Sharpe (mean) | 0.172 |
| Per-window OOS Sharpe (median) | -0.024 |
| Total Trades | 1,216 |
| Avg Trades/Window | 14.3 |
| Win Rate | 46.13% |
| Profit Factor | 1.103 |
| Max Drawdown | -16.37% |
| Aggregate Return | +0.70% per month |
| Best Window Return | +16.35% |
| Worst Window Return | -7.38% |
| Positive Sharpe Windows | 42/85 (49%) |
| Execution Time | 1,636s (~27 min) |
| Best Params | ema4h=50, ema1h=20, rsi=14, RSI_OS=35, RSI_OB=65, hold=24, SL=2x, TP=2x |
| Dataset | 64,733 bars, 2018-10-29 to 2026-03-21 (7.5 years ETH) |
| Status | partial | Aggregate Sharpe below 0.8 gate; WFR unavailable (engine doesn't output IS Sharpe) |
| Key Insight | RSI thresholds stable (CV 0.10-0.14); hold_bars unstable (CV 0.54); regime filter may be too restrictive vs unfiltered RSI |
| Infrastructure Fix | data.min_required_bars=2000 was overriding min_bars_per_window=600 — caused first run to skip all windows |
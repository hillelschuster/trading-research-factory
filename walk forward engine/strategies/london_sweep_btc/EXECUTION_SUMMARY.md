# EXPERIMENT: London Sweep Crypto WFA - Execution Summary

## Objective
Execute London Sweep strategy WFA on BTCUSD data to verify the strategy works with crypto price scales.

## Status: BLOCKED

### Why Blocked
The agent environment lacks pandas/numpy/vectorbt which are required to execute WFA experiments. The WFA engine requires the Windows Python .venv to run.

### What Was Completed
1. ✅ Verified London Sweep strategy exists: `walk forward engine/src/strategies/london_sweep.py`
2. ✅ Verified strategy config exists: `walk forward engine/config/strategy_london_sweep_fade.json`
3. ✅ Created crypto-adapted strategy config: `walk forward engine/config/strategy_london_sweep_btc.json`
4. ✅ Copied BTC data to WFA data folder: `walk forward engine/data/btcusdt_1h_1000.csv`
5. ✅ Created BTC WFA config: `walk forward engine/strategies/london_sweep_btc/wfa_config.yaml`

### What Human Must Do
Run WFA locally on Windows:

```bash
cd "walk forward engine"
.\.venv\Scripts\python.exe scripts\walk_forward_smoke_test.py --config strategies\london_sweep_btc\wfa_config.yaml
```

### Verification Steps
1. Check WFA config exists: `walk forward engine/strategies/london_sweep_btc/wfa_config.yaml`
2. Check data file exists: `walk forward engine/data/btcusdt_1h_1000.csv` (1001 rows)
3. Check strategy code is vectorized: `walk forward engine/src/strategies/london_sweep.py` has `generate_vectorized_signals()`

### Expected Artifacts After Human Run
- `walk forward engine/strategies/london_sweep_btc/results/` folder with:
  - `window_results.json` - optimization results per window
  - `final_oos_metrics.json` - out-of-sample performance metrics
  - `parameter_stability.json` - parameter stability across windows

### Metrics to Evaluate
- Sharpe ratio (annualized)
- Profit factor
- Max drawdown
- Win rate
- Number of trades
- Parameter stability across walk-forward windows

### Fallback Strategy
If WFA fails due to data format or strategy issues:
1. Try `demo_ohlcv.csv` as minimal smoke test data
2. Fall back to EURUSD data if BTC data causes issues
3. Create simpler strategy variant if London Sweep fails on crypto

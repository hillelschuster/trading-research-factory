#!/usr/bin/env python3
"""
Smoke Test for London Sweep V5 - RSI(7) Divergence Strategy.
Tests on 2020-2021 data.

CRITICAL: This script EXPLICITLY imports and uses LondonSweepV5Strategy.
The runner fix now preserves externally set strategy_class.
"""

import pandas as pd
import traceback
from pathlib import Path

# EXPLICIT V5 IMPORT - NOT V3 or V4!
from src.strategies.london_sweep_v5 import LondonSweepV5Strategy
from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
from src.config_manager import load_and_validate_config


def main():
    try:
        print("="*60)
        print("V5 RSI DIVERGENCE SMOKE TEST")
        print("="*60)
        
        # VERIFICATION: Print which strategy class we're using
        print(f"\n>>> STRATEGY CLASS: {LondonSweepV5Strategy.__name__}")
        print(f">>> MODULE: {LondonSweepV5Strategy.__module__}")
        
        print("\nLoading data...")
        data = pd.read_csv("data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv")
        print(f"Data loaded: {len(data)} rows")
        
        data["timestamp"] = pd.to_datetime(data["timestamp"])
        data = data[(data['timestamp'] >= '2020-01-01') & (data['timestamp'] < '2022-01-01')]
        print(f"Filtered to 2020-2021: {len(data)} rows")
        
        if len(data) == 0:
            print("ERROR: No data!")
            return
        
        output_dir = Path("results/london_sweep_v5_smoke")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        print("Loading app config...")
        app_config = load_and_validate_config()
        
        # V5 Parameter ranges with RSI
        parameter_ranges = {
            # Sweep thresholds (Research-aligned)
            "sweep_min_pips": {
                "type": "categorical",
                "values": [5, 8, 10]
            },
            "sweep_max_pips": {
                "type": "categorical",
                "values": [15, 20, 25]
            },
            # Range filter
            "min_range_pips": {
                "type": "categorical",
                "values": [10, 15, 20]
            },
            "max_range_pips": {
                "type": "categorical",
                "values": [30, 40, 50]
            },
            # SL buffer
            "sl_buffer_pips": {
                "type": "categorical", 
                "values": [3, 5, 8]
            },
            # TP mode
            "tp_mode": {
                "type": "categorical",
                "values": ["range_mid", "opposite_side"]
            },
            # RSI parameters (NEW in V5)
            "rsi_period": {
                "type": "categorical",
                "values": [5, 7, 9]
            },
            "rsi_lookback": {
                "type": "categorical",
                "values": [4, 8, 12]
            }
        }
        
        config = WalkForwardConfig(
            training_months=6,
            testing_months=1,
            step_months=1,
            n_parameter_trials=25,
            optimization_seed=42,
            strategy_profile_key="EURUSD_LONDON_SWEEP_FADE",
            output_directory=str(output_dir),
            use_vectorized_backtest=True,
            performance_mode=True,
            save_detailed_results=True,
            fees=0.0001,
            slippage=0.0001,
            parameter_ranges_override=parameter_ranges
        )
        
        print("\n=== V5 RSI DIVERGENCE CONFIG ===")
        print(f"  RSI Period options: [5, 7, 9]")
        print(f"  RSI Lookback options: [4, 8, 12]")
        print(f"  Trials: {config.n_parameter_trials}")
        print(f"  Output: {output_dir}")
        
        print("\nCreating WFA runner...")
        runner = WalkForwardRunner(config, app_config=app_config)
        
        # CRITICAL: Set strategy class BEFORE run_walk_forward_analysis
        # The runner now preserves externally set strategy_class (we fixed this bug)
        runner.strategy_class = LondonSweepV5Strategy
        print(f"\n>>> RUNNER.STRATEGY_CLASS SET TO: {runner.strategy_class.__name__}")
        
        print("\nRunning WFA...")
        results = runner.run_walk_forward_analysis(data, save_results=True)
        
        # VERIFICATION: Check that V5 was actually used
        print(f"\n>>> POST-RUN STRATEGY_CLASS: {runner.strategy_class.__name__ if runner.strategy_class else 'NONE'}")
        
        print(f"\n{'='*60}")
        print("V5 RSI DIVERGENCE RESULTS")
        print("="*60)
        print(f"Total windows: {results.total_windows}")
        print(f"Aggregate return: {results.aggregate_return_pct:.2f}%")
        print(f"Sharpe ratio: {results.aggregate_sharpe_ratio:.3f}")
        print(f"Total trades: {results.aggregate_total_trades}")
        print(f"Win rate: {results.aggregate_win_rate:.1f}%")
        print(f"Profit factor: {results.aggregate_profit_factor:.2f}")
        
        if results.aggregate_total_trades > 0:
            avg_trades = results.aggregate_total_trades / results.total_windows
            print(f"\nTrades per window: {avg_trades:.1f}")
        
        # Compare to previous versions
        print("\n--- Comparison ---")
        print("V3: 29 trades, PF 5.99, Sharpe -0.67")
        print("V4: 33 trades, PF 0.40, Sharpe -1.30")
        print(f"V5: {results.aggregate_total_trades} trades, PF {results.aggregate_profit_factor:.2f}, Sharpe {results.aggregate_sharpe_ratio:.2f}")
        
    except Exception as e:
        print(f"\n=== ERROR ===")
        print(f"Error: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()

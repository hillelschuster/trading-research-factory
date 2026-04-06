#!/usr/bin/env python3
"""
Smoke Test for London Sweep Fade Strategy.
Tests on 2020-2022 data to verify logic and basic mechanical edge.

STRATEGY: London Sweep Fade (Mean Reversion)
- Fades liquidity sweeps of Asia High/Low
- Target: Return to range or opposite side
"""

import pandas as pd
import traceback
from pathlib import Path

# Import the new strategy
from src.strategies.london_sweep import LondonSweepStrategy
from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
from src.config_manager import load_and_validate_config


def main():
    try:
        print("="*60)
        print("LONDON SWEEP FADE - SMOKE TEST (2020-2022)")
        print("="*60)
        
        print(f"\n>>> STRATEGY: {LondonSweepStrategy.__name__}")
        
        print("\nLoading data...")
        data = pd.read_csv("data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv")
        print(f"Data loaded: {len(data)} rows")
        
        data["timestamp"] = pd.to_datetime(data["timestamp"])
        
        # Filter 2020-2022 (Volatile/Mixed years)
        data = data[(data['timestamp'] >= '2020-01-01') & (data['timestamp'] < '2023-01-01')]
        print(f"Filtered to 2020-2022: {len(data)} rows")
        
        if len(data) == 0:
            print("ERROR: No data!")
            return
        
        output_dir = Path("results/london_sweep_smoke")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        print("Loading app config...")
        app_config = load_and_validate_config()
        
        # Sweep Strategy Parameter Grid (Small subset for smoke test)
        parameter_ranges = {
            # Standard Fixed
            "asia_start_hour": {"type": "categorical", "values": [0]},
            "asia_end_hour": {"type": "categorical", "values": [7]},
            "trade_end_hour": {"type": "categorical", "values": [10]},
            "hard_exit_hour": {"type": "categorical", "values": [16]},
            
            # Sweep Specific
            "sweep_pips": {"type": "categorical", "values": [2, 4, 6]},
            "reentry_pips": {"type": "categorical", "values": [0, 1]},
            
            "stop_buffer_pips": {"type": "categorical", "values": [3, 5]},
            "tp_mode": {"type": "categorical", "values": ["mid", "opposite"]},
            
            # Filters
            "min_range_pips": {"type": "categorical", "values": [10]},
            "max_range_pips": {"type": "categorical", "values": [35]},
            "min_daily_atr": {"type": "categorical", "values": [0.0]}, # Disable for baseline
            "one_trade_per_day": {"type": "categorical", "values": [True]}
        }
        
        config = WalkForwardConfig(
            training_months=6,
            testing_months=1,
            step_months=1,
            n_parameter_trials=20, # Quick check
            optimization_seed=42,
            strategy_profile_key="EURUSD_LONDON_SWEEP_FADE", # Correct key
            output_directory=str(output_dir),
            use_vectorized_backtest=True,
            performance_mode=True,
            save_detailed_results=True,
            fees=0.0001,
            slippage=0.0001,
            parameter_ranges_override=parameter_ranges
        )
        
        print("\n=== SWEEP CONFIG ===")
        print(f"  Trials: {config.n_parameter_trials}")
        print(f"  Params: Sweep=[2,4,6], Reentry=[0,1], TP=[mid, opp]")
        
        print("\nCreating WFA runner...")
        runner = WalkForwardRunner(config, app_config=app_config)
        
        # Set strategy class explicitly
        runner.strategy_class = LondonSweepStrategy
        print(f">>> RUNNER.STRATEGY_CLASS: {runner.strategy_class.__name__}")
        
        print("\nRunning WFA...")
        results = runner.run_walk_forward_analysis(data, save_results=True)
        
        print(f"\n{'='*60}")
        print("LONDON SWEEP SMOKE RESULTS")
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
            
            # Simple success criteria for "Logic Passing"
            if results.aggregate_profit_factor > 0.9:
                 print("\n✅ Logic appears sound (PF > 0.9 in smoke)")
            else:
                 print("\n⚠️ Logic check: PF < 0.9 (verify signal logic)")
                 
            print("\nCheck results/london_sweep_smoke/ for details")

    except Exception as e:
        print(f"\n=== ERROR ===")
        print(f"Error: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()

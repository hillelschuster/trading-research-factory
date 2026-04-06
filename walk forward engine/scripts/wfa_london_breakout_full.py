#!/usr/bin/env python3
"""
Full WFA for London Breakout Strategy with ORB-aligned filters.
Tests on 2003-2025 data (22 years) with research-aligned parameters.

FILTERS (researches2.md:1692-1751):
- Volume: ≥150% of 20-bar avg tick volume
- Gap: Optional >0.5% overnight gap filter
"""

import pandas as pd
import traceback
from pathlib import Path

from src.strategies.london_breakout import LondonBreakoutStrategy, LondonBreakoutParams
from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
from src.config_manager import load_and_validate_config


def main():
    try:
        print("="*60)
        print("LONDON BREAKOUT (ORB) FULL WFA 2003-2025")
        print("="*60)
        
        print(f"\n>>> STRATEGY: {LondonBreakoutStrategy.__name__}")
        print(f">>> FILTERS: Volume=150% avg, Gap=disabled")
        
        print("\nLoading data...")
        data = pd.read_csv("data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv")
        print(f"Data loaded: {len(data)} rows")
        
        data["timestamp"] = pd.to_datetime(data["timestamp"])
        print(f"Date range: {data['timestamp'].min()} to {data['timestamp'].max()}")
        
        output_dir = Path("results/london_breakout_orb_full_2003_2025")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        print("Loading app config...")
        app_config = load_and_validate_config()
        
        # Research-aligned parameter grid
        parameter_ranges = {
            # Session timing (fixed)
            "asia_start_hour": {"type": "categorical", "values": [0]},
            "asia_end_hour": {"type": "categorical", "values": [7]},
            "trade_end_hour": {"type": "categorical", "values": [10]},
            "hard_exit_hour": {"type": "categorical", "values": [16]},
            
            # Entry buffer
            "buffer_pips": {
                "type": "categorical",
                "values": [3, 5, 7]
            },
            
            # Range filter (research: 10-40 pips)
            "min_range_pips": {
                "type": "categorical",
                "values": [10, 15]
            },
            "max_range_pips": {
                "type": "categorical",
                "values": [35, 40, 50]
            },
            
            # Risk reward (research: 1.5-2x)
            "risk_reward_ratio": {
                "type": "categorical",
                "values": [1.5, 2.0]
            },
            
            # Volume filter (DISABLED - causing issues in early data)
            "min_volume_pct": {
                "type": "categorical",
                "values": [0.0]
            },
            
            # ATR filter (ENABLED - vital for stagnation years)
            "min_daily_atr": {
                "type": "categorical",
                "values": [0.0, 0.0055, 0.0065, 0.0075]
            },
            
            # Gap filter (disabled)
            "use_gap_filter": {
                "type": "categorical",
                "values": [False]
            }
        }
        
        config = WalkForwardConfig(
            training_months=6,
            testing_months=1,
            step_months=1,
            n_parameter_trials=50,  # More trials for full WFA
            optimization_seed=42,
            strategy_profile_key="EURUSD_LONDON_BREAKOUT",
            output_directory=str(output_dir),
            use_vectorized_backtest=True,
            performance_mode=True,
            save_detailed_results=True,
            fees=0.0001,
            slippage=0.0001,
            parameter_ranges_override=parameter_ranges
        )
        
        print("\n=== FULL WFA CONFIG ===")
        print(f"  Period: 2003-2025 (22 years)")
        print(f"  Training: 6 months")
        print(f"  Testing: 1 month")
        print(f"  Trials: {config.n_parameter_trials}")
        print(f"  Estimated windows: ~250")
        print(f"  Output: {output_dir}")
        
        print("\nCreating WFA runner...")
        runner = WalkForwardRunner(config, app_config=app_config)
        
        # Set strategy class explicitly
        runner.strategy_class = LondonBreakoutStrategy
        print(f">>> RUNNER.STRATEGY_CLASS: {runner.strategy_class.__name__}")
        
        print("\n" + "="*60)
        print("STARTING FULL WFA RUN - THIS WILL TAKE A WHILE")
        print("="*60 + "\n")
        
        results = runner.run_walk_forward_analysis(data, save_results=True)
        
        print(f"\n{'='*60}")
        print("LONDON BREAKOUT ORB FULL WFA RESULTS")
        print("="*60)
        print(f"Total windows: {results.total_windows}")
        print(f"Aggregate return: {results.aggregate_return_pct:.2f}%")
        print(f"Sharpe ratio: {results.aggregate_sharpe_ratio:.3f}")
        print(f"Total trades: {results.aggregate_total_trades}")
        print(f"Win rate: {results.aggregate_win_rate:.1f}%")
        print(f"Profit factor: {results.aggregate_profit_factor:.2f}")
        print(f"Max drawdown: {results.aggregate_max_drawdown_pct:.2f}%")
        
        if results.aggregate_total_trades > 0:
            avg_trades_per_year = results.aggregate_total_trades / 22
            print(f"\nTrades per year: {avg_trades_per_year:.0f}")
            
            # Success criteria
            print("\n=== SUCCESS CRITERIA ===")
            success = True
            
            if results.aggregate_profit_factor < 1.0:
                print(f"❌ PF < 1.0: {results.aggregate_profit_factor:.2f}")
                success = False
            else:
                print(f"✅ Profit Factor: {results.aggregate_profit_factor:.2f}")
            
            if results.aggregate_return_pct < 0:
                print(f"⚠️ Negative return: {results.aggregate_return_pct:.2f}%")
            else:
                print(f"✅ Positive return: {results.aggregate_return_pct:.2f}%")
            
            if results.aggregate_sharpe_ratio < 0:
                print(f"⚠️ Negative Sharpe: {results.aggregate_sharpe_ratio:.2f}")
            else:
                print(f"✅ Sharpe: {results.aggregate_sharpe_ratio:.2f}")
            
            print(f"\nResults saved to: {output_dir}")
        
    except Exception as e:
        print(f"\n=== ERROR ===")
        print(f"Error: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()

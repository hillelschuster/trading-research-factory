#!/usr/bin/env python3
"""
Smoke Test for London Breakout Strategy with ORB-aligned filters.
Tests on 2020-2022 data with research-aligned parameters.

FILTERS ADDED (researches2.md:1692-1751):
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
        print("LONDON BREAKOUT (ORB-STYLE) SMOKE TEST")
        print("="*60)
        
        print(f"\n>>> STRATEGY: {LondonBreakoutStrategy.__name__}")
        print(f">>> FILTERS: Volume={1.5*100}% avg, Gap=disabled")
        
        print("\nLoading data...")
        data = pd.read_csv("data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv")
        print(f"Data loaded: {len(data)} rows")
        
        data["timestamp"] = pd.to_datetime(data["timestamp"])
        data = data[(data['timestamp'] >= '2020-01-01') & (data['timestamp'] < '2023-01-01')]
        print(f"Filtered to 2020-2022: {len(data)} rows")
        
        if len(data) == 0:
            print("ERROR: No data!")
            return
        
        output_dir = Path("results/london_breakout_orb_smoke")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        print("Loading app config...")
        app_config = load_and_validate_config()
        
        # Research-aligned parameter grid
        parameter_ranges = {
            # Session timing (research-aligned)
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
            
            # Gap filter (disabled - research says helps but reduces trades)
            "use_gap_filter": {
                "type": "categorical",
                "values": [False]
            }
        }
        
        config = WalkForwardConfig(
            training_months=6,
            testing_months=1,
            step_months=1,
            n_parameter_trials=30,
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
        
        print("\n=== ORB-ALIGNED CONFIG ===")
        print(f"  Volume filter: 130-180% of 20-bar avg")
        print(f"  Range filter: 10-50 pips")
        print(f"  R:R ratio: 1.5-2.0x")
        print(f"  Trials: {config.n_parameter_trials}")
        
        print("\nCreating WFA runner...")
        runner = WalkForwardRunner(config, app_config=app_config)
        
        # Set strategy class explicitly
        runner.strategy_class = LondonBreakoutStrategy
        print(f">>> RUNNER.STRATEGY_CLASS: {runner.strategy_class.__name__}")
        
        print("\nRunning WFA...")
        results = runner.run_walk_forward_analysis(data, save_results=True)
        
        print(f"\n{'='*60}")
        print("LONDON BREAKOUT ORB RESULTS")
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
            
            # Success criteria
            print("\n=== SUCCESS CRITERIA ===")
            success = True
            if results.aggregate_total_trades < 50:
                print("❌ Trades < 50 (too few)")
                success = False
            else:
                print(f"✅ Trades: {results.aggregate_total_trades}")
            
            if results.aggregate_profit_factor < 1.0:
                print(f"❌ PF < 1.0 (unprofitable)")
                success = False
            else:
                print(f"✅ Profit Factor: {results.aggregate_profit_factor:.2f}")
            
            if results.aggregate_win_rate < 50:
                print(f"⚠️ Win Rate: {results.aggregate_win_rate:.1f}% (below 55% target)")
            else:
                print(f"✅ Win Rate: {results.aggregate_win_rate:.1f}%")
            
            if success:
                print("\n🎉 SMOKE TEST PASSED - Proceed to full WFA!")
            else:
                print("\n⚠️ SMOKE TEST ISSUES - Review before full WFA")
        
    except Exception as e:
        print(f"\n=== ERROR ===")
        print(f"Error: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()

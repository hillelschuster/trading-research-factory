#!/usr/bin/env python3
"""
Full Walk-Forward Analysis for London Sweep Fade Strategy.
22-year analysis: 2003-2025

STRATEGY: London Sweep Fade (Mean Reversion)
- Fades liquidity sweeps of Asia High/Low during London Open
- Target: Return to Asia Midpoint or Opposite Boundary
"""

import pandas as pd
import traceback
from pathlib import Path
from datetime import datetime

from src.strategies.london_sweep import LondonSweepStrategy
from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
from src.config_manager import load_and_validate_config


def main():
    try:
        print("=" * 70)
        print("LONDON SWEEP FADE - FULL WFA (2003-2025)")
        print("=" * 70)
        
        run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        print(f"\nRun ID: {run_id}")
        print(f"Strategy: {LondonSweepStrategy.__name__}")
        
        # Load data
        print("\nLoading data...")
        data_path = "data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv"
        data = pd.read_csv(data_path)
        print(f"Data loaded: {len(data):,} rows")
        
        data["timestamp"] = pd.to_datetime(data["timestamp"])
        
        # Full 22-year range
        data = data[(data['timestamp'] >= '2003-01-01') & (data['timestamp'] < '2026-01-01')]
        print(f"Filtered to 2003-2025: {len(data):,} rows")
        
        if len(data) == 0:
            print("ERROR: No data!")
            return
            
        # Output directory
        output_dir = Path(f"results/london_sweep_full_{run_id}")
        output_dir.mkdir(parents=True, exist_ok=True)
        print(f"Output: {output_dir}")
        
        # Load config
        print("\nLoading app config...")
        app_config = load_and_validate_config()
        
        # Full parameter grid (uses JSON parameter_ranges or override)
        # Core LSF parameters for 22-year optimization
        parameter_ranges = {
            # Fixed session times
            "asia_start_hour": {"type": "categorical", "values": [0]},
            "asia_end_hour": {"type": "categorical", "values": [7]},
            "trade_start_minute": {"type": "categorical", "values": [5]},
            "trade_end_hour": {"type": "categorical", "values": [10]},
            "hard_exit_hour": {"type": "categorical", "values": [16]},
            
            # Core sweep parameters (optimize)
            "sweep_pips": {"type": "categorical", "values": [2, 3, 4, 5, 6]},
            "reentry_pips": {"type": "categorical", "values": [0, 1, 2]},
            "stop_buffer_pips": {"type": "categorical", "values": [2, 3, 4, 5]},
            "tp_mode": {"type": "categorical", "values": ["mid", "opposite"]},
            
            # Range filters (optimize)
            "min_range_pips": {"type": "categorical", "values": [8, 10, 12]},
            "max_range_pips": {"type": "categorical", "values": [25, 30, 35, 40]},
            
            # ATR filter (optimize)
            "min_daily_atr": {"type": "categorical", "values": [0, 30, 40, 50]},
            
            # Fixed
            "one_trade_per_day": {"type": "categorical", "values": [True]}
        }
        
        # WFA Configuration
        # 12 months IS, 3 months OOS, step 3 months = ~88 windows over 22 years
        config = WalkForwardConfig(
            training_months=12,      # 1 year In-Sample
            testing_months=3,        # 1 quarter Out-of-Sample
            step_months=3,           # Roll forward quarterly
            n_parameter_trials=100,  # Grid exploration per window
            optimization_seed=42,    # Reproducibility
            strategy_profile_key="EURUSD_LONDON_SWEEP_FADE",
            output_directory=str(output_dir),
            use_vectorized_backtest=True,
            performance_mode=True,
            save_detailed_results=True,
            save_window_data=False,  # Save disk space
            fees=0.0001,
            slippage=0.0001,
            parameter_ranges_override=parameter_ranges
        )
        
        print("\n" + "=" * 50)
        print("WFA CONFIGURATION")
        print("=" * 50)
        print(f"  Training: {config.training_months} months (IS)")
        print(f"  Testing:  {config.testing_months} months (OOS)")
        print(f"  Step:     {config.step_months} months")
        print(f"  Trials:   {config.n_parameter_trials} per window")
        print(f"  Seed:     {config.optimization_seed}")
        print(f"  Mode:     Vectorized + Performance")
        
        # Calculate expected windows
        data_years = 22
        step_per_year = 12 / config.step_months
        est_windows = int((data_years - config.training_months / 12) * step_per_year)
        print(f"\nEstimated windows: ~{est_windows}")
        
        # Create runner
        print("\nCreating WFA runner...")
        runner = WalkForwardRunner(config, app_config=app_config)
        runner.strategy_class = LondonSweepStrategy
        print(f">>> Strategy class: {runner.strategy_class.__name__}")
        
        # Run WFA
        print("\n" + "=" * 50)
        print("STARTING WALK-FORWARD ANALYSIS")
        print("=" * 50)
        print("This will take 1-3 hours depending on hardware...\n")
        
        results = runner.run_walk_forward_analysis(data, save_results=True)
        
        # Results summary
        print("\n" + "=" * 70)
        print("LONDON SWEEP FADE - FULL WFA RESULTS (2003-2025)")
        print("=" * 70)
        print(f"Total windows:      {results.total_windows}")
        print(f"Aggregate return:   {results.aggregate_return_pct:.2f}%")
        print(f"Sharpe ratio:       {results.aggregate_sharpe_ratio:.3f}")
        print(f"Total trades:       {results.aggregate_total_trades}")
        print(f"Win rate:           {results.aggregate_win_rate:.1f}%")
        print(f"Profit factor:      {results.aggregate_profit_factor:.2f}")
        
        if results.aggregate_total_trades > 0:
            avg_trades = results.aggregate_total_trades / results.total_windows
            print(f"\nTrades per window:  {avg_trades:.1f}")
            
            # Success criteria
            print("\n" + "-" * 50)
            print("ASSESSMENT")
            print("-" * 50)
            
            if results.aggregate_profit_factor >= 1.2 and results.aggregate_sharpe_ratio > 0.3:
                print("✅ STRONG: PF >= 1.2, Sharpe > 0.3")
            elif results.aggregate_profit_factor >= 1.0:
                print("⚠️ MARGINAL: PF >= 1.0 but needs optimization")
            else:
                print("❌ WEAK: PF < 1.0, strategy needs revision")
                
        print(f"\nResults saved to: {output_dir}/")
        
    except Exception as e:
        print(f"\n=== ERROR ===")
        print(f"Error: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()

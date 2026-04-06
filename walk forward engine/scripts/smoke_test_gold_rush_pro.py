#!/usr/bin/env python3
"""
Smoke Test for Gold Rush Pro Strategy.
Tests on XAUUSD M15 2020-2023 data.

STRATEGY: Gold Rush Pro (Day-of-Week RSI Mean-Reversion)
- Entry: On Thursday (configurable), if previous-day RSI < threshold, go long
- Stop-loss: ATR-based
- Exit: After N calendar days (time-based)
- Long-only

Source: ideas.md (Gold_Rush_Pro.mq5)
"""

import sys
import pandas as pd
import numpy as np
import traceback
from pathlib import Path

# Add project root to path (same pattern as walk_forward_smoke_test.py)
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.strategies.gold_rush_pro import LightweightGoldRushPro
from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
from src.config_manager import load_and_validate_config


def main():
    try:
        print("=" * 60)
        print("GOLD RUSH PRO - WFA SMOKE TEST (XAUUSD 2020-2023)")
        print("=" * 60)

        print(f"\n>>> STRATEGY: {LightweightGoldRushPro.__name__}")

        # ── Load data ────────────────────────────────────────────
        data_path = "data/XAUUSD_M15_2018-2025/XAUUSD_M15_2018_2025.csv"
        print(f"\nLoading data from {data_path}...")
        data = pd.read_csv(data_path)
        print(f"Data loaded: {len(data)} rows")

        # Parse timestamp (epoch ms)
        data["timestamp"] = pd.to_datetime(data["timestamp"], unit="ms", utc=True)

        # Filter 2020-2023 for manageable runtime
        data = data[
            (data["timestamp"] >= "2020-01-01") & (data["timestamp"] < "2024-01-01")
        ]
        print(f"Filtered to 2020-2023: {len(data)} rows")

        if len(data) == 0:
            print("ERROR: No data after filtering!")
            return

        # ── Output directory ─────────────────────────────────────
        output_dir = Path("strategies/gold_rush_pro/results")
        output_dir.mkdir(parents=True, exist_ok=True)

        # ── App config ───────────────────────────────────────────
        print("Loading app config...")
        app_config = load_and_validate_config()

        # ── Parameter ranges ─────────────────────────────────────
        parameter_ranges = {
            "rsi_period": {"type": "categorical", "values": [10, 14, 20]},
            "rsi_threshold": {"type": "categorical", "values": [30.0, 35.0, 40.0, 45.0, 50.0]},
            "atr_period": {"type": "categorical", "values": [10, 14, 20]},
            "atr_sl_multiplier": {"type": "categorical", "values": [1.0, 1.5, 2.0, 2.5]},
            "hold_days": {"type": "categorical", "values": [1, 2, 3, 5]},
            "entry_day": {"type": "categorical", "values": [3, 4, 5]},
        }

        # ── WFA config ───────────────────────────────────────────
        config = WalkForwardConfig(
            training_months=6,
            testing_months=1,
            step_months=1,
            n_parameter_trials=30,
            optimization_seed=42,
            strategy_profile_key="XAUUSD_GOLD_RUSH_PRO",
            output_directory=str(output_dir),
            use_vectorized_backtest=True,
            performance_mode=True,
            save_detailed_results=True,
            initial_balance=100000.0,
            fees=0.0001,
            slippage=0.0001,
            parameter_ranges_override=parameter_ranges,
        )

        print("\n=== WFA CONFIG ===")
        print(f"  Training: {config.training_months}M | Testing: {config.testing_months}M")
        print(f"  Step: {config.step_months}M | Trials: {config.n_parameter_trials}")
        print(f"  Params: RSI periods/thresholds, ATR SL, hold days, entry day")

        # ── Create runner ─────────────────────────────────────────
        print("\nCreating WFA runner...")
        runner = WalkForwardRunner(config, app_config=app_config)

        # Set strategy class explicitly (follows codebase pattern)
        runner.strategy_class = LightweightGoldRushPro
        print(f">>> RUNNER.STRATEGY_CLASS: {runner.strategy_class.__name__}")

        # ── Run WFA ───────────────────────────────────────────────
        print("\nRunning Walk-Forward Analysis...")
        results = runner.run_walk_forward_analysis(data, save_results=True)

        # ── Print results ─────────────────────────────────────────
        print(f"\n{'=' * 60}")
        print("GOLD RUSH PRO - WFA RESULTS")
        print("=" * 60)
        print(f"Total windows: {results.total_windows}")
        print(f"Successful windows: {results.successful_windows}")
        print(f"Aggregate return: {results.aggregate_return_pct:.2f}%")
        print(f"Sharpe ratio: {results.aggregate_sharpe_ratio:.3f}")
        print(f"Total trades: {results.aggregate_total_trades}")
        print(f"Win rate: {results.aggregate_win_rate:.1f}%")
        print(f"Profit factor: {results.aggregate_profit_factor:.2f}")

        if results.aggregate_total_trades > 0:
            avg_trades = results.aggregate_total_trades / max(results.total_windows, 1)
            print(f"\nTrades per window: {avg_trades:.1f}")

            if results.aggregate_profit_factor > 0.9:
                print("\n✅ Logic appears sound (PF > 0.9 in smoke)")
            else:
                print("\n⚠️  Logic check: PF < 0.9 (verify signal logic)")

            print(f"\nCheck {output_dir}/ for detailed results")
        else:
            print("\n⚠️  No trades generated — check signal logic / parameter ranges")

    except Exception as e:
        print(f"\n=== ERROR ===")
        print(f"Error: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()

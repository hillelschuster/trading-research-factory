import unittest
from types import SimpleNamespace

import numpy as np
import pandas as pd

from src.backtesting.vectorized_backtest_engine import VectorizedBacktestEngine
from src.core.annualization import (
    calculate_annualized_sharpe_from_returns,
    calculate_annualized_sortino_from_returns,
    calculate_calmar_ratio_from_equity,
    periods_per_year_for_timeframe,
)


class CapturingVectorizedEngine:
    def __init__(self):
        self.received_timeframe = None

    def run_strategy_backtest(self, **kwargs):
        self.received_timeframe = kwargs.get("timeframe")
        return SimpleNamespace(
            final_balance=100_000.0,
            total_return_pct=1.0,
            total_trades=0,
            win_rate=0.0,
            profit_factor=0.0,
            max_drawdown_pct=0.0,
            sharpe_ratio=0.0,
            sortino_ratio=0.0,
            calmar_ratio=0.0,
            gross_profit=0.0,
            gross_loss=0.0,
            win_count=0,
            loss_count=0,
            avg_trade_win_pct=0.0,
            avg_trade_loss_pct=0.0,
        )


class StubStrategy:
    def _initialize_strategy_parameters(self):
        return None

    def generate_vectorized_signals(self, data, params):
        length = len(data)
        return {
            "long_entries": np.zeros(length, dtype=bool),
            "long_exits": np.zeros(length, dtype=bool),
            "short_entries": np.zeros(length, dtype=bool),
            "short_exits": np.zeros(length, dtype=bool),
        }


class TestRiskMetricAnnualization(unittest.TestCase):
    def test_timeframe_aware_risk_metrics_cover_m15_h4_and_d1(self):
        equity = pd.Series([100_000.0, 100_800.0, 100_100.0, 101_300.0, 100_900.0, 101_700.0])
        returns = equity.pct_change().dropna().to_numpy(dtype=float)

        for timeframe in ("M15", "H4", "D1"):
            with self.subTest(timeframe=timeframe):
                periods_per_year = periods_per_year_for_timeframe(timeframe)
                metrics = VectorizedBacktestEngine._calculate_timeframe_aware_risk_metrics(equity, timeframe)

                self.assertAlmostEqual(
                    metrics["sharpe_ratio"],
                    calculate_annualized_sharpe_from_returns(returns, periods_per_year),
                )
                self.assertAlmostEqual(
                    metrics["sortino_ratio"],
                    calculate_annualized_sortino_from_returns(returns, periods_per_year),
                )
                self.assertAlmostEqual(
                    metrics["calmar_ratio"],
                    calculate_calmar_ratio_from_equity(equity.to_numpy(dtype=float), periods_per_year),
                )

    def test_timeframe_validation_rejects_incompatible_data_cadence(self):
        data = pd.DataFrame(
            {
                "timestamp": pd.date_range("2024-01-01", periods=8, freq="7min"),
                "open": np.linspace(1.0, 1.1, 8),
                "high": np.linspace(1.01, 1.11, 8),
                "low": np.linspace(0.99, 1.09, 8),
                "close": np.linspace(1.0, 1.1, 8),
            }
        )

        with self.assertRaises(ValueError):
            VectorizedBacktestEngine._validate_timeframe_compatibility(data, "H4")

    def test_runner_passes_profile_timeframe_into_vectorized_backtest(self):
        from src.walk_forward.walk_forward_runner import WalkForwardConfig, WalkForwardRunner

        runner = WalkForwardRunner(
            WalkForwardConfig(strategy_profile_key="PROFILE_H4", use_vectorized_backtest=True),
            app_config=SimpleNamespace(
                asset_strategy_profiles={
                    "PROFILE_H4": SimpleNamespace(symbol="EURUSD", timeframe="H4")
                }
            ),
        )
        runner.vectorized_engine = CapturingVectorizedEngine()
        runner.strategy_class = StubStrategy

        data = pd.DataFrame(
            {
                "timestamp": pd.date_range("2024-01-01", periods=6, freq="15min"),
                "open": np.linspace(1.0, 1.1, 6),
                "high": np.linspace(1.01, 1.11, 6),
                "low": np.linspace(0.99, 1.09, 6),
                "close": np.linspace(1.0, 1.1, 6),
                "volume": np.arange(6, dtype=float) + 1,
            }
        )

        result = runner._test_parameters_on_testing_data(data, parameters={})

        self.assertEqual(runner.vectorized_engine.received_timeframe.value, "H4")
        self.assertEqual(result["total_return_pct"], 1.0)


if __name__ == "__main__":
    unittest.main()
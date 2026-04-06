import unittest
from datetime import datetime, timedelta, timezone

from src.core.annualization import calculate_annualized_sharpe_from_returns
from src.backtesting.vectorized_backtest_engine import VectorizedBacktestEngine
from src.walk_forward.validation.result_schema import WfaResultSchema
from src.walk_forward.walk_forward_runner import WalkForwardConfig, WalkForwardRunner, WindowResult


class AggregateOnlyRunner(WalkForwardRunner):
    def _log_transaction_costs(self):
        pass

    def _initialize_components(self):
        pass

    def _validate_strategy_profile(self):
        return None


class TestTradeMetricNormalization(unittest.TestCase):
    def test_vectorized_win_rate_normalizes_to_fraction(self):
        self.assertEqual(VectorizedBacktestEngine._normalize_win_rate(55.0), 0.55)
        self.assertEqual(VectorizedBacktestEngine._normalize_win_rate(0.55), 0.55)

    def test_trade_summary_emits_explicit_counts(self):
        metrics = VectorizedBacktestEngine._summarize_trade_pnls([100.0, -50.0, 0.0, -25.0], capital_base=50_000.0)

        self.assertEqual(metrics["total_trades"], 4)
        self.assertEqual(metrics["win_count"], 1)
        self.assertEqual(metrics["loss_count"], 3)
        self.assertAlmostEqual(metrics["win_rate"], 0.25)
        self.assertAlmostEqual(metrics["gross_profit"], 100.0)
        self.assertAlmostEqual(metrics["gross_loss"], 75.0)
        self.assertAlmostEqual(metrics["profit_factor"], 100.0 / 75.0)

    def test_aggregate_results_use_explicit_counts_and_fractional_win_rate(self):
        runner = AggregateOnlyRunner(WalkForwardConfig(), app_config={})
        runner.execution_start_time = datetime(2026, 3, 8, tzinfo=timezone.utc)

        runner.window_results = [
            WindowResult(
                window_id=0,
                training_period_start="2023-01-01T00:00:00",
                training_period_end="2023-07-01T00:00:00",
                testing_period_start="2023-07-01T00:00:00",
                testing_period_end="2023-08-01T00:00:00",
                best_parameters={"stub": 1},
                optimization_trials=2,
                optimization_time_seconds=1.0,
                final_balance=100_100.0,
                total_return_pct=1.0,
                total_trades=5,
                win_rate=0.4,
                profit_factor=2.0,
                max_drawdown_pct=-1.0,
                sharpe_ratio=1.2,
                testing_time_seconds=1.0,
                success=True,
                gross_profit=200.0,
                gross_loss=100.0,
                win_count=2,
                loss_count=3,
                avg_trade_win_pct=1.0,
                avg_trade_loss_pct=-0.5,
            ),
            WindowResult(
                window_id=1,
                training_period_start="2023-02-01T00:00:00",
                training_period_end="2023-08-01T00:00:00",
                testing_period_start="2023-08-01T00:00:00",
                testing_period_end="2023-09-01T00:00:00",
                best_parameters={"stub": 2},
                optimization_trials=2,
                optimization_time_seconds=1.0,
                final_balance=100_200.0,
                total_return_pct=-0.5,
                total_trades=5,
                win_rate=0.6,
                profit_factor=1.5,
                max_drawdown_pct=-2.0,
                sharpe_ratio=0.8,
                testing_time_seconds=1.0,
                success=True,
                gross_profit=300.0,
                gross_loss=200.0,
                win_count=3,
                loss_count=2,
                avg_trade_win_pct=2.0,
                avg_trade_loss_pct=-1.0,
            ),
        ]

        results = runner._calculate_aggregate_results(runner.execution_start_time + timedelta(minutes=5))
        WfaResultSchema().validate(results)
        expected_aggregate_sharpe = calculate_annualized_sharpe_from_returns([0.01, -0.005], 12.0)

        self.assertEqual(results.aggregate_total_trades, 10)
        self.assertEqual(results.aggregate_total_wins, 5)
        self.assertEqual(results.aggregate_total_losses, 5)
        self.assertAlmostEqual(results.aggregate_win_rate, 0.5)
        self.assertAlmostEqual(results.aggregate_profit_factor, 500.0 / 300.0)
        self.assertAlmostEqual(results.aggregate_avg_trade_win_pct, 1.6)
        self.assertAlmostEqual(results.aggregate_avg_trade_loss_pct, -0.7)
        self.assertAlmostEqual(results.aggregate_sharpe_ratio, expected_aggregate_sharpe)
        self.assertNotAlmostEqual(results.aggregate_sharpe_ratio, 1.0)

        analysis = runner._generate_analysis_artifact(results, "20260308_000000")
        self.assertAlmostEqual(analysis["metrics"]["win_rate"], 0.5)
        self.assertAlmostEqual(analysis["metrics"]["expectancy"], 0.45)


if __name__ == "__main__":
    unittest.main()
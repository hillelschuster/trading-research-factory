import unittest
import os
import shutil
import pandas as pd
import numpy as np
from pathlib import Path
from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
from src.walk_forward.data_integrity import DataIntegrityManager
from src.walk_forward.wfa_window_manager import WFAWindowManager, WFAWindowConfig, WindowStrategy
from src.config_manager import load_and_validate_config


class StubWalkForwardRunner(WalkForwardRunner):
    def _log_transaction_costs(self):
        pass

    def _initialize_components(self):
        self.data_integrity_manager = DataIntegrityManager(base_seed=42, enable_strict_validation=True)
        self.window_manager = WFAWindowManager(
            config=WFAWindowConfig(
                strategy=WindowStrategy.ROLLING,
                optimization_months=self.config.training_months,
                validation_months=self.config.testing_months,
                step_months=self.config.step_months,
                min_bars_per_window=self.config.min_bars_per_window,
            ),
            data_integrity_manager=self.data_integrity_manager,
            logger=self.logger,
        )

    def _validate_strategy_profile(self):
        return None

    def _optimize_parameters_on_training_data(self, training_data, window_id=None, runtime_guards=None):
        if not hasattr(self, "observed_training_slices"):
            self.observed_training_slices = []
        self.observed_training_slices.append((training_data["timestamp"].min(), training_data["timestamp"].max()))
        return {"stub_parameter": 1}

    def _test_parameters_on_testing_data(self, testing_data, parameters, runtime_guards=None):
        if not hasattr(self, "observed_testing_slices"):
            self.observed_testing_slices = []
        self.observed_testing_slices.append((testing_data["timestamp"].min(), testing_data["timestamp"].max()))
        return {
            "final_balance": self.config.initial_balance,
            "total_return_pct": 0.0,
            "total_trades": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe_ratio": 0.0,
            "gross_profit": 0.0,
            "gross_loss": 0.0,
            "win_count": 0,
            "loss_count": 0,
            "avg_trade_win_pct": 0.0,
            "avg_trade_loss_pct": 0.0,
        }

class TestWFAE2ESmoke(unittest.TestCase):
    def setUp(self):
        # Setup temporary output directory
        self.output_dir = Path("results/test_e2e_smoke")
        if self.output_dir.exists():
            shutil.rmtree(self.output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Create minimal valid config
        self.config = WalkForwardConfig(
            training_months=6,
            testing_months=1,
            step_months=1,
            n_parameter_trials=2,  # Minimal for speed
            optimization_seed=42,
            strategy_profile_key="EURUSD_LONDON_BREAKOUT",
            output_directory=str(self.output_dir),
            use_vectorized_backtest=True,
            performance_mode=True,
            save_detailed_results=True
        )

        # Create synthetic data (similar to determinism test but cleaner)
        # 15-minute data for ~1 year to allow at least one window (6m train + 1m test)
        dates = pd.date_range(start="2023-01-01", end="2024-01-01", freq="15min")
        n = len(dates)
        
        # Random walk for prices
        np.random.seed(42)
        returns = np.random.normal(0, 0.0001, n)
        price_path = 1.1000 * np.exp(np.cumsum(returns))
        
        self.data = pd.DataFrame({
            "timestamp": dates,
            "open": price_path,
            "high": price_path + 0.0005,
            "low": price_path - 0.0005,
            "close": price_path + np.random.normal(0, 0.0001, n),
            "volume": np.random.randint(100, 1000, n).astype(float)
        })

        # Load minimal app config (mock or real)
        try:
            self.app_config = load_and_validate_config()
        except:
            # Fallback if config files aren't perfect in isolation
            self.app_config = {} 

    def tearDown(self):
        # Cleanup artifacts if needed, or leave them for inspection
        # shutil.rmtree(self.output_dir)
        pass

    def test_e2e_execution_and_artifacts(self):
        """
        Runs WFA end-to-end and asserts that:
        1. Execution completes successfully and returns results.
        2. Key artifact files (JSON, CSV) are actually created on disk.
        """
        runner = WalkForwardRunner(self.config, app_config=self.app_config)
        
        # Run WFA
        # Note: We pass save_results=True to trigger artifact generation
        results = runner.run_walk_forward_analysis(self.data, save_results=True)
        
        # 1. Check in-memory results
        self.assertIsNotNone(results, "WFA returned None")
        self.assertGreater(results.total_windows, 0, "No windows were generated")
        self.assertTrue(hasattr(results, 'aggregate_return_pct'), "Results missing aggregate return")

        # 2. Check content of output directory
        files = list(self.output_dir.glob("*"))
        filenames = [f.name for f in files]
        print(f"\nGenerated files: {filenames}")

        # Expect at least:
        # - walk_forward_results_*.json
        # - walk_forward_summary_*.csv
        json_files = list(self.output_dir.glob("walk_forward_results_*.json"))
        csv_files = list(self.output_dir.glob("walk_forward_summary_*.csv"))
        
        self.assertTrue(len(json_files) > 0, "Missing results JSON file")
        self.assertTrue(len(csv_files) > 0, "Missing summary CSV file")
        
        # Optional: Check if window_hashes were generated (Strict mode feature)
        # hash_files = list(self.output_dir.glob("window_hashes_*.json"))
        # self.assertTrue(len(hash_files) > 0, "Missing window hashes file")

    def test_testing_months_is_the_final_outer_oos_segment(self):
        """The configured testing window should be the exact slice used for final OOS evaluation."""
        runner = StubWalkForwardRunner(self.config, app_config={})

        results = runner.run_walk_forward_analysis(self.data, save_results=False)

        self.assertGreater(results.total_windows, 0, "No windows were generated")

        first_window = results.window_results[0]
        observed_test_start, observed_test_end = runner.observed_testing_slices[0]
        observed_train_start, observed_train_end = runner.observed_training_slices[0]

        expected_test_start = pd.Timestamp("2023-07-01 00:00:00")
        expected_test_end = pd.Timestamp("2023-08-01 00:00:00")

        self.assertEqual(pd.Timestamp(first_window.testing_period_start), expected_test_start)
        self.assertEqual(pd.Timestamp(first_window.testing_period_end), expected_test_end)
        self.assertEqual(observed_test_start, expected_test_start)
        self.assertLess(observed_test_end, expected_test_end)
        self.assertEqual(observed_train_start, pd.Timestamp(first_window.training_period_start))
        self.assertLess(observed_train_end, expected_test_start)

if __name__ == '__main__':
    unittest.main()

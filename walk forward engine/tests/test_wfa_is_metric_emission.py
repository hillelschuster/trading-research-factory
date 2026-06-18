import json

import numpy as np
import pandas as pd

from src.config_manager import load_and_validate_config
from src.walk_forward.data_integrity import DataIntegrityManager
from src.walk_forward.walk_forward_runner import WalkForwardConfig, WalkForwardRunner
from src.walk_forward.wfa_window_manager import WFAWindowConfig, WFAWindowManager, WindowStrategy


class IsMetricRunner(WalkForwardRunner):
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
        self._optimization_metrics_by_window[window_id] = {"in_sample_sharpe": 1.234567}
        return {"stub_parameter": 1}

    def _test_parameters_on_testing_data(self, testing_data, parameters, runtime_guards=None):
        return {
            "final_balance": self.config.initial_balance + 100.0,
            "total_return_pct": 0.1,
            "total_trades": 2,
            "win_rate": 0.5,
            "profit_factor": 1.2,
            "max_drawdown_pct": -0.1,
            "sharpe_ratio": 0.3,
            "gross_profit": 120.0,
            "gross_loss": 100.0,
            "win_count": 1,
            "loss_count": 1,
            "avg_trade_win_pct": 0.12,
            "avg_trade_loss_pct": -0.1,
        }


def test_wfa_results_emit_artifact_backed_in_sample_sharpe(tmp_path):
    config = WalkForwardConfig(
        training_months=2,
        testing_months=1,
        step_months=1,
        min_bars_per_window=20,
        n_parameter_trials=2,
        strategy_profile_key="TEST_IS_METRIC",
        output_directory=str(tmp_path),
        save_detailed_results=True,
    )

    dates = pd.date_range(start="2023-01-01", end="2023-08-02", freq="1D")
    n = len(dates)
    prices = 100.0 + np.arange(n) * 0.01
    data = pd.DataFrame({
        "timestamp": dates,
        "open": prices,
        "high": prices + 0.5,
        "low": prices - 0.5,
        "close": prices + 0.1,
        "volume": 1000.0,
    })

    try:
        app_config = load_and_validate_config()
    except Exception:
        app_config = {}

    runner = IsMetricRunner(config, app_config=app_config)
    results = runner.run_walk_forward_analysis(data, save_results=True)

    assert results.successful_windows > 0
    assert all(window.in_sample_sharpe == 1.234567 for window in results.window_results if window.success)
    assert results.aggregate_in_sample_sharpe == 1.234567

    result_file = next(tmp_path.glob("walk_forward_results_*.json"))
    result_json = json.loads(result_file.read_text(encoding="utf-8"))
    assert result_json["aggregate_in_sample_sharpe"] == 1.234567
    assert result_json["window_results"][0]["in_sample_sharpe"] == 1.234567

    analysis_json = json.loads((tmp_path / "analysis.json").read_text(encoding="utf-8"))
    assert analysis_json["metrics"]["aggregate_in_sample_sharpe"] == 1.2346

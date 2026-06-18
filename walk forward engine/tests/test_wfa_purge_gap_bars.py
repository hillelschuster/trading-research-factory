import json

import numpy as np
import pandas as pd

from src.config_manager import load_and_validate_config
from src.walk_forward.data_integrity import DataIntegrityManager
from src.walk_forward.walk_forward_runner import WalkForwardConfig, WalkForwardRunner
from src.walk_forward.wfa_window_manager import WFAWindowConfig, WFAWindowManager, WindowStrategy


def sample_ohlcv(start="2023-01-01", periods=180):
    dates = pd.date_range(start=start, periods=periods, freq="1D")
    prices = 100.0 + np.arange(periods) * 0.1
    return pd.DataFrame({
        "timestamp": dates,
        "open": prices,
        "high": prices + 0.5,
        "low": prices - 0.5,
        "close": prices + 0.1,
        "volume": 1000.0,
    })


class PurgeGapRunner(WalkForwardRunner):
    def _log_transaction_costs(self):
        pass

    def _initialize_components(self):
        self.data_integrity_manager = DataIntegrityManager(
            base_seed=42,
            enable_strict_validation=True,
            artifacts_dir=self.config.output_directory,
        )
        self.window_manager = WFAWindowManager(
            config=WFAWindowConfig(
                strategy=WindowStrategy.ROLLING,
                optimization_months=self.config.training_months,
                validation_months=self.config.testing_months,
                step_months=self.config.step_months,
                min_bars_per_window=self.config.min_bars_per_window,
                purge_gap_bars=self.config.purge_gap_bars,
            ),
            data_integrity_manager=self.data_integrity_manager,
            logger=self.logger,
        )

    def _validate_strategy_profile(self):
        return None

    def _optimize_parameters_on_training_data(self, training_data, window_id=None, runtime_guards=None):
        self._optimization_metrics_by_window[window_id] = {"in_sample_sharpe": 0.75}
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


def test_window_manager_drops_configured_post_training_purge_bars(tmp_path):
    data = sample_ohlcv(periods=120)
    manager = WFAWindowManager(
        config=WFAWindowConfig(
            strategy=WindowStrategy.ROLLING,
            optimization_months=1,
            validation_months=1,
            step_months=1,
            min_bars_per_window=5,
            purge_gap_bars=3,
        ),
        data_integrity_manager=DataIntegrityManager(
            base_seed=42,
            enable_strict_validation=True,
            artifacts_dir=str(tmp_path / "artifacts"),
        ),
    )

    window = manager.generate_wfa_windows(data)[0]
    candidates = data[
        (data["timestamp"] >= window.split_metadata.training_end) &
        (data["timestamp"] < window.split_metadata.validation_end)
    ]
    expected_start = candidates.iloc[3]["timestamp"].to_pydatetime()

    assert window.purge_gap_bars == 3
    assert window.purged_validation_bars == 3
    assert window.split_metadata.validation_start == expected_start
    assert window.validation_data.iloc[0]["timestamp"].to_pydatetime() == expected_start
    assert window.optimization_data["timestamp"].max() < window.validation_data["timestamp"].min()


def test_wfa_results_emit_purge_gap_diagnostics(tmp_path):
    config = WalkForwardConfig(
        training_months=1,
        testing_months=1,
        step_months=1,
        min_bars_per_window=5,
        n_parameter_trials=2,
        strategy_profile_key="TEST_PURGE_GAP",
        output_directory=str(tmp_path),
        save_detailed_results=True,
        purge_gap_bars=2,
    )

    try:
        app_config = load_and_validate_config()
    except Exception:
        app_config = {}

    runner = PurgeGapRunner(config, app_config=app_config)
    results = runner.run_walk_forward_analysis(sample_ohlcv(periods=180), save_results=True)

    assert results.successful_windows > 0
    assert results.config.purge_gap_bars == 2
    assert results.window_results[0].purge_gap_bars == 2
    assert results.window_results[0].purged_validation_bars == 2

    result_json = json.loads(next(tmp_path.glob("walk_forward_results_*.json")).read_text(encoding="utf-8"))
    assert result_json["config"]["purge_gap_bars"] == 2
    assert result_json["window_results"][0]["purge_gap_bars"] == 2
    assert result_json["window_results"][0]["purged_validation_bars"] == 2

    analysis_json = json.loads((tmp_path / "analysis.json").read_text(encoding="utf-8"))
    assert analysis_json["wfa_config"]["purge_gap_bars"] == 2


def test_wfa_analysis_records_indicator_warmup_as_diagnostic_only(tmp_path):
    config = WalkForwardConfig(
        training_months=1,
        testing_months=1,
        step_months=1,
        min_bars_per_window=5,
        n_parameter_trials=2,
        strategy_profile_key="TEST_WARMUP_DIAGNOSTIC",
        output_directory=str(tmp_path),
        save_detailed_results=True,
        indicator_warmup_bars=50,
    )

    try:
        app_config = load_and_validate_config()
    except Exception:
        app_config = {}

    runner = PurgeGapRunner(config, app_config=app_config)
    runner.run_walk_forward_analysis(sample_ohlcv(periods=180), save_results=True)

    result_json = json.loads(next(tmp_path.glob("walk_forward_results_*.json")).read_text(encoding="utf-8"))
    assert result_json["config"]["indicator_warmup_bars"] == 50

    analysis_json = json.loads((tmp_path / "analysis.json").read_text(encoding="utf-8"))
    assert analysis_json["warmup_diagnostics"] == {
        "indicator_warmup_bars": 50,
        "status": "diagnostic_only",
        "applied_to_window_boundaries": False,
        "missing_because": "indicator_warmup_bars is recorded for explicit leakage review only; normal WFA does not infer or apply generic strategy indicator warmup beyond configured purge_gap_bars."
    }

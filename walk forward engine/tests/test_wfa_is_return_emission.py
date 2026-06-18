import json
from types import SimpleNamespace

import numpy as np
import pandas as pd

from src.config_manager import load_and_validate_config
from src.walk_forward.data_integrity import DataIntegrityManager
from src.walk_forward.walk_forward_runner import WalkForwardConfig, WalkForwardRunner
from src.walk_forward.wfa_window_manager import WFAWindowConfig, WFAWindowManager, WindowStrategy


class FixedParameterGenerator:
    def suggest_trial_parameters(self, trial):
        return {"stub_parameter": trial.suggest_int("stub_parameter", 1, 2)}

    def _get_default_parameters(self):
        return {"stub_parameter": 1}


class FakeStrategy:
    def _initialize_strategy_parameters(self):
        pass

    def generate_vectorized_signals(self, data, params=None):
        return pd.DataFrame(index=data.index)


class FakeVectorizedEngine:
    def run_strategy_backtest(self, data, signals, initial_balance, fees, slippage, timeframe):
        is_training_slice = len(data) >= 45
        total_return_pct = 4.2 if is_training_slice else 0.5
        sharpe_ratio = 1.7 if is_training_slice else 0.3
        return SimpleNamespace(
            final_balance=initial_balance * (1.0 + total_return_pct / 100.0),
            total_return_pct=total_return_pct,
            total_trades=6,
            win_rate=0.5,
            profit_factor=1.2,
            max_drawdown_pct=-0.1,
            sharpe_ratio=sharpe_ratio,
            gross_profit=120.0,
            gross_loss=100.0,
            win_count=3,
            loss_count=3,
            avg_trade_win_pct=0.12,
            avg_trade_loss_pct=-0.1,
        )


class IsReturnRunner(WalkForwardRunner):
    def _log_transaction_costs(self):
        pass

    def _initialize_components(self):
        self.parameter_generator = FixedParameterGenerator()
        self.vectorized_engine = FakeVectorizedEngine()
        self.strategy_class = FakeStrategy
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


class FailedSelectedTrainingRunner(IsReturnRunner):
    def _test_parameters_on_testing_data(self, testing_data, parameters, runtime_guards=None):
        return {"backtest_success": False, "total_return_pct": 99.0}


def _sample_ohlcv():
    dates = pd.date_range(start="2023-01-01", end="2023-08-02", freq="1D")
    prices = 100.0 + np.arange(len(dates)) * 0.01
    return pd.DataFrame({
        "timestamp": dates,
        "open": prices,
        "high": prices + 0.5,
        "low": prices - 0.5,
        "close": prices + 0.1,
        "volume": 1000.0,
    })


def _app_config():
    try:
        return load_and_validate_config()
    except Exception:
        return SimpleNamespace(asset_strategy_profiles={}, loaded_strategy_parameters={})


def test_wfa_results_emit_artifact_backed_in_sample_return(tmp_path):
    config = WalkForwardConfig(
        training_months=2,
        testing_months=1,
        step_months=1,
        min_bars_per_window=20,
        n_parameter_trials=2,
        strategy_profile_key="TEST_IS_RETURN",
        output_directory=str(tmp_path),
        save_detailed_results=True,
        use_vectorized_backtest=True,
        fees=0.0,
        slippage=0.0,
    )

    runner = IsReturnRunner(config, app_config=_app_config())
    results = runner.run_walk_forward_analysis(_sample_ohlcv(), save_results=True)

    assert results.successful_windows > 0
    assert all(window.in_sample_return_pct == 4.2 for window in results.window_results if window.success)
    assert results.aggregate_in_sample_return_pct == 4.2

    result_file = next(tmp_path.glob("walk_forward_results_*.json"))
    result_json = json.loads(result_file.read_text(encoding="utf-8"))
    assert result_json["aggregate_in_sample_return_pct"] == 4.2
    assert result_json["window_results"][0]["in_sample_return_pct"] == 4.2

    analysis_json = json.loads((tmp_path / "analysis.json").read_text(encoding="utf-8"))
    assert analysis_json["metrics"]["aggregate_in_sample_return_pct"] == 4.2


def test_selected_training_return_is_not_emitted_when_backtest_does_not_report_success(tmp_path):
    config = WalkForwardConfig(output_directory=str(tmp_path), use_vectorized_backtest=True)
    runner = FailedSelectedTrainingRunner(config, app_config=_app_config())

    metrics = runner._calculate_selected_training_metrics(_sample_ohlcv(), {"stub_parameter": 1})

    assert metrics == {}

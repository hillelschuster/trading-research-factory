from datetime import datetime
from types import SimpleNamespace

from src.walk_forward.transaction_cost_modeler import TransactionCostModeler
from src.walk_forward.walk_forward_runner import (
    WalkForwardConfig,
    WalkForwardResults,
    WalkForwardRunner,
    WindowResult,
)


class QuietRunner(WalkForwardRunner):
    def _log_transaction_costs(self):
        pass


def _sample_results(config):
    window = WindowResult(
        window_id=0,
        training_period_start="2026-01-01T00:00:00",
        training_period_end="2026-02-01T00:00:00",
        testing_period_start="2026-02-02T00:00:00",
        testing_period_end="2026-03-01T00:00:00",
        best_parameters={"lookback": 10},
        optimization_trials=2,
        optimization_time_seconds=1.0,
        final_balance=100100.0,
        total_return_pct=0.1,
        total_trades=3,
        win_rate=0.67,
        profit_factor=1.2,
        max_drawdown_pct=-0.05,
        sharpe_ratio=0.4,
        testing_time_seconds=0.5,
        gross_profit=120.0,
        gross_loss=100.0,
        win_count=2,
        loss_count=1,
        avg_trade_win_pct=0.08,
        avg_trade_loss_pct=-0.04,
        in_sample_sharpe=0.7,
        in_sample_return_pct=0.3,
        success=True,
    )
    now = datetime.utcnow().isoformat()
    return WalkForwardResults(
        config=config,
        execution_start_time=now,
        execution_end_time=now,
        total_execution_time_seconds=2.0,
        window_results=[window],
        total_windows=1,
        successful_windows=1,
        aggregate_return_pct=0.1,
        aggregate_sharpe_ratio=0.4,
        aggregate_max_drawdown_pct=-0.05,
        aggregate_win_rate=0.67,
        aggregate_profit_factor=1.2,
        aggregate_total_trades=3,
        aggregate_gross_profit=120.0,
        aggregate_gross_loss=100.0,
        aggregate_total_wins=2,
        aggregate_total_losses=1,
        aggregate_avg_trade_win_pct=0.08,
        aggregate_avg_trade_loss_pct=-0.04,
        parameter_stability={},
        best_window_return=0.1,
        worst_window_return=0.1,
        return_volatility=0.0,
        consistency_score=1.0,
        aggregate_in_sample_sharpe=0.7,
        aggregate_in_sample_return_pct=0.3,
    )


def test_analysis_artifact_marks_disconnected_optimizer_and_cost_modules_inactive(tmp_path):
    config = WalkForwardConfig(
        output_directory=str(tmp_path),
        strategy_profile_key="TEST_OPTIMIZER_COST_TRUTH",
        fees=0.0002,
        slippage=0.0003,
    )
    runner = QuietRunner(config)

    analysis = runner._generate_analysis_artifact(_sample_results(config), "20260524_000000")
    truth = analysis["optimization_truth"]

    assert truth["active_parameter_optimizer"] == "direct_optuna_tpe_study"
    assert truth["active_selection_objective"] == "training_slice_sharpe_from__evaluate_parameter_combination"
    assert truth["multi_objective_optimizer_active"] is False
    assert truth["transaction_cost_modeler_active"] is False
    assert truth["cost_stress_tester_active"] is False
    assert truth["active_cost_inputs"] == {
        "fees": 0.0002,
        "slippage": 0.0003,
        "source": "WalkForwardConfig fields loaded from WFA YAML/backtest config or runner defaults",
    }
    assert "multi_objective_optimizer.py" in " ".join(truth["disconnected_modules"])
    assert "not wired" in truth["missing_because"]


def test_transaction_cost_modeler_accepts_instrument_details_without_missing_guard_name():
    details = {
        "EURUSD": SimpleNamespace(
            platform_symbol="EURUSD",
            pip_value_in_account_currency_per_lot=10.0,
            contract_size=100000.0,
            min_volume_lots=0.01,
            max_volume_lots=100.0,
        )
    }

    modeler = TransactionCostModeler(instrument_details=details)

    assert "EURUSD" in modeler.symbol_overrides
    override = modeler.symbol_overrides["EURUSD"]
    assert override.pip_value_per_lot == 10.0
    assert override.contract_size == 100000.0

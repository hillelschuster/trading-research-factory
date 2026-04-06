"""
Tests for strategy parameter validation using Pydantic.

Verifies that:
1. Valid configs are accepted
2. Invalid field values are rejected
3. Unknown parameters (typos) are rejected
4. Cross-field validation works (max > min)
"""

import pytest
import json
from types import SimpleNamespace

from pydantic import ValidationError
import yaml


class TestLondonBreakoutParamsValidation:
    """Tests for LondonBreakoutParams Pydantic validation."""
    
    def test_valid_config_with_defaults(self):
        """Default params should be valid."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        params = LondonBreakoutParams()
        assert params.buffer_pips == 5.0
        assert params.asia_start_hour == 0
        assert params.asia_end_hour == 7
    
    def test_valid_config_with_overrides(self):
        """Custom valid params should be accepted."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        params = LondonBreakoutParams(
            buffer_pips=10.0,
            risk_reward_ratio=2.0,
            min_range_pips=15.0,
            max_range_pips=50.0
        )
        assert params.buffer_pips == 10.0
        assert params.risk_reward_ratio == 2.0
    
    def test_typo_rejected_extra_forbid(self):
        """Typos in param names should be rejected."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        with pytest.raises(ValidationError) as exc_info:
            LondonBreakoutParams(bufer_pips=5.0)  # typo: bufer instead of buffer
        
        assert "extra_forbidden" in str(exc_info.value) or "Extra inputs are not permitted" in str(exc_info.value)
    
    def test_negative_buffer_rejected(self):
        """Negative buffer_pips should be rejected."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        with pytest.raises(ValidationError) as exc_info:
            LondonBreakoutParams(buffer_pips=-5.0)
        
        assert "buffer_pips" in str(exc_info.value)
        assert ">= 0" in str(exc_info.value)
    
    def test_negative_risk_reward_rejected(self):
        """Negative risk_reward_ratio should be rejected."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        with pytest.raises(ValidationError) as exc_info:
            LondonBreakoutParams(risk_reward_ratio=-1.0)
        
        assert "risk_reward_ratio" in str(exc_info.value)
    
    def test_invalid_hour_rejected(self):
        """Hour values outside 0-23 should be rejected."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        with pytest.raises(ValidationError) as exc_info:
            LondonBreakoutParams(asia_start_hour=25)
        
        assert "0-23" in str(exc_info.value)
    
    def test_invalid_minute_rejected(self):
        """Minute values outside 0-59 should be rejected."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        with pytest.raises(ValidationError) as exc_info:
            LondonBreakoutParams(trade_start_minute=75)
        
        assert "0-59" in str(exc_info.value)
    
    def test_max_less_than_min_range_rejected(self):
        """max_range_pips <= min_range_pips should be rejected."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        with pytest.raises(ValidationError) as exc_info:
            LondonBreakoutParams(min_range_pips=50.0, max_range_pips=20.0)
        
        assert "max_range_pips must be > min_range_pips" in str(exc_info.value)
    
    def test_asia_end_before_start_rejected(self):
        """asia_end_hour <= asia_start_hour should be rejected."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        with pytest.raises(ValidationError) as exc_info:
            LondonBreakoutParams(asia_start_hour=10, asia_end_hour=5)
        
        assert "asia_end_hour must be > asia_start_hour" in str(exc_info.value)
    
    def test_zero_buffer_allowed(self):
        """Zero buffer_pips should be allowed (non-negative, not positive)."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        params = LondonBreakoutParams(buffer_pips=0.0)
        assert params.buffer_pips == 0.0
    
    def test_zero_min_daily_atr_allowed(self):
        """Zero min_daily_atr means disabled, should be allowed."""
        from src.strategies.london_breakout import LondonBreakoutParams
        
        params = LondonBreakoutParams(min_daily_atr=0.0)
        assert params.min_daily_atr == 0.0


class TestParamsRegistry:
    """Tests for the strategy params registry."""
    
    def test_registry_contains_london_breakout(self):
        """Registry should contain London Breakout."""
        from src.strategies.params_registry import get_registry
        
        registry = get_registry()
        assert "LondonBreakout_PriceAction" in registry
    
    def test_validate_known_strategy(self):
        """Validation should work for registered strategies."""
        from src.strategies.params_registry import validate_strategy_params
        
        result = validate_strategy_params(
            "LondonBreakout_PriceAction",
            {"buffer_pips": 7.0}
        )
        assert result is not None
        assert result.buffer_pips == 7.0

    def test_validate_orb_strategy_alias(self):
        """ORB alias should validate against the same London Breakout model."""
        from src.strategies.params_registry import validate_strategy_params

        result = validate_strategy_params(
            "LondonBreakout_ORB",
            {"buffer_pips": 6.0}
        )
        assert result is not None
        assert result.buffer_pips == 6.0
    
    def test_validate_unknown_strategy_returns_none(self):
        """Unknown strategies should return None (backward compatible)."""
        from src.strategies.params_registry import validate_strategy_params
        
        result = validate_strategy_params(
            "UnknownStrategy_NotRegistered",
            {"some_param": 123}
        )
        assert result is None
    
    def test_validate_invalid_params_raises(self):
        """Invalid params should raise ValidationError."""
        from src.strategies.params_registry import validate_strategy_params
        
        with pytest.raises(ValidationError):
            validate_strategy_params(
                "LondonBreakout_PriceAction",
                {"buffer_pips": -5.0}  # Invalid
            )


@pytest.fixture(autouse=True)
def reset_config_manager_cache():
    import src.config_manager as config_manager

    config_manager._config_instance = None
    yield
    config_manager._config_instance = None


def _write_config_bundle(
    tmp_path,
    *,
    strategy_definition_key="LondonBreakout_ORB",
    strategy_definitions=None,
    instrument_details_key="EURUSD_FTMO",
    instrument_details=None,
):
    main_config = {
        "bot_settings": {"trading_mode": "paper", "main_loop_delay_seconds": 10},
        "logging": {},
        "platform": {"name": "Paper", "mt5": None, "ctrader": None},
        "assets_to_trade": ["TEST_PROFILE"],
        "asset_strategy_profiles": {
            "TEST_PROFILE": {
                "symbol": "EURUSD",
                "enabled": True,
                "instrument_details_key": instrument_details_key,
                "strategy_params_key": "strategy_test.json",
                "timeframe": "M15",
            }
        },
        "strategy_definitions": strategy_definitions
        if strategy_definitions is not None
        else {
            "LondonBreakout_ORB": {
                "strategy_module": "src.strategies.london_breakout",
                "strategy_class": "LondonBreakoutStrategy",
            }
        },
        "risk_management": {
            "global_max_account_drawdown_pct": 0.1,
            "global_daily_drawdown_limit_pct": 0.05,
            "default_risk_per_trade_idea_pct": 0.01,
        },
        "operational_compliance": {},
        "leverage_constraints": {},
        "state_management": {},
    }
    (tmp_path / "main_config.yaml").write_text(
        yaml.safe_dump(main_config, sort_keys=False),
        encoding="utf-8",
    )

    strategy_params = {
        "strategy_params_key": "strategy_test.json",
        "description": "Test strategy params",
        "strategy_definition_key": strategy_definition_key,
        "parameters": {"buffer_pips": 5.0},
    }
    (tmp_path / "strategy_test.json").write_text(
        json.dumps(strategy_params, indent=2),
        encoding="utf-8",
    )

    (tmp_path / "instruments.json").write_text(
        json.dumps(instrument_details if instrument_details is not None else {"EURUSD_FTMO": {"platform_symbol": "EURUSD"}}, indent=2),
        encoding="utf-8",
    )


def test_load_and_validate_config_fails_for_missing_strategy_definition(tmp_path):
    from src.config_manager import load_and_validate_config

    _write_config_bundle(
        tmp_path,
        strategy_definition_key="MissingDefinition",
        strategy_definitions={},
    )

    with pytest.raises(KeyError, match="Strategy definition 'MissingDefinition' not found"):
        load_and_validate_config(config_dir=str(tmp_path))


def test_load_and_validate_config_fails_for_missing_instrument_details_key(tmp_path):
    from src.config_manager import load_and_validate_config

    _write_config_bundle(
        tmp_path,
        instrument_details_key="GBPJPY_FTMO",
        instrument_details={"EURUSD_FTMO": {"platform_symbol": "EURUSD"}},
    )

    with pytest.raises(KeyError, match="Instrument details 'GBPJPY_FTMO' not found"):
        load_and_validate_config(config_dir=str(tmp_path))


def test_runner_initialize_components_raises_instead_of_disabling_vectorized_backtest(monkeypatch):
    import src.backtesting.vectorized_backtest_engine as vectorized_module
    from src.exceptions import ConfigurationError
    from src.walk_forward.walk_forward_runner import WalkForwardConfig, WalkForwardRunner

    class DummyVectorizedBacktestEngine:
        def __init__(self, logger=None):
            self.logger = logger

    monkeypatch.setattr(vectorized_module, "VectorizedBacktestEngine", DummyVectorizedBacktestEngine)

    runner = WalkForwardRunner(
        WalkForwardConfig(
            strategy_profile_key="BROKEN_PROFILE",
            use_vectorized_backtest=True,
            fees=0.0001,
            slippage=0.0001,
        ),
        app_config=SimpleNamespace(
            asset_strategy_profiles={
                "BROKEN_PROFILE": SimpleNamespace(
                    strategy_params_key="broken_strategy.json",
                    instrument_details_key="EURUSD_FTMO",
                )
            },
            loaded_strategy_parameters={
                "broken_strategy.json": SimpleNamespace(
                    strategy_definition_key="MissingDefinition",
                    optimization_ranges=None,
                    parameter_ranges=None,
                )
            },
            strategy_definitions={},
            loaded_instrument_details={"EURUSD_FTMO": {"platform_symbol": "EURUSD"}},
        ),
    )

    with pytest.raises(KeyError, match="Strategy definition 'MissingDefinition' not found"):
        runner._initialize_components()

    assert runner.config.use_vectorized_backtest is True

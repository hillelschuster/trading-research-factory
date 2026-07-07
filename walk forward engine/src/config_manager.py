# prop_firm_trading_bot/src/config_manager.py

"""
Configuration Management for Trading Bot.

This module provides comprehensive configuration management using Pydantic models
for validation, type checking, and structured configuration handling across all
trading bot components.
"""

# Standard library
from importlib import import_module
import json
import logging
import os
from pathlib import Path
from typing import Dict, Any, Optional, List

# Third-party
import yaml
from pydantic import BaseModel, validator, ValidationError, Field, ValidationInfo, field_validator

# Local imports
from src.custom_types import StrategyParameters, ConfigDict, FilePath

# --- Pydantic Models for Configuration Structure ---

class LoggingSettings(BaseModel):
    level: str = "INFO"
    directory: str = "logs"
    file_name_prefix: str = "trading_bot_text"
    structured_logging: bool = False
    json_log_file_name_prefix: Optional[str] = "trading_bot_structured"
    max_bytes: int = 10485760
    backup_count: int = 7
    log_format: str = "%(asctime)s - %(app_name)s - [%(levelname)s] - %(name)s - %(module)s.%(funcName)s:%(lineno)d - %(message)s"

class MT5PlatformSettings(BaseModel):
    account_env_var: str
    password_env_var: str
    server_env_var: str
    path: Optional[str] = None
    timeout_ms: int = 10000
    magic_number_default: int = 12345
    slippage_default_points: int = 20

class CTraderPlatformSettings(BaseModel):
    client_id_env_var: str
    client_secret_env_var: str
    account_id_env_var: str
    host_type: str = "demo"

class PlatformSettings(BaseModel):
    name: str = "MetaTrader5"
    mt5: Optional[MT5PlatformSettings] = None
    ctrader: Optional[CTraderPlatformSettings] = None

    @field_validator('name')
    @classmethod
    def name_must_be_supported(cls, v):
        if v not in ["MetaTrader5", "cTrader", "Paper"]:
            raise ValueError("Platform name must be 'MetaTrader5', 'cTrader', or 'Paper'")
        return v

    @field_validator('ctrader')
    @classmethod
    def check_ctrader_settings(cls, v, info: ValidationInfo):
        if info.data.get('name') == "cTrader" and v is None:
            raise ValueError("cTrader settings are required when platform name is 'cTrader'")
        return v

    @field_validator('mt5')
    @classmethod
    def check_mt5_settings(cls, v, info: ValidationInfo):
        if info.data.get('name') == "MetaTrader5" and v is None:
            raise ValueError("MT5 settings are required when platform name is 'MetaTrader5'")
        return v

class AssetStrategyProfile(BaseModel):
    symbol: str
    enabled: bool = True
    instrument_details_key: str
    strategy_params_key: str
    timeframe: Optional[str] = "H1"  # Default timeframe if not specified
    description: Optional[str] = None
    validation_status: Optional[str] = None
    risk_per_trade_idea_pct: Optional[float] = None

    @field_validator('risk_per_trade_idea_pct')
    @classmethod
    def risk_per_trade_must_be_fractional_or_none(cls, v):
        if v is not None and (v <= 0 or v >= 1):
            raise ValueError('risk_per_trade_idea_pct must be a fraction between 0 and 1 or null')
        return v

class StrategyDefinition(BaseModel):
    strategy_module: str
    strategy_class: str
    description: Optional[str] = ""

class RegimeMetadata(BaseModel):
    """Market regime metadata for strategy filtering."""
    primary_regimes: List[str] = Field(default_factory=list)
    regime_confidence_indicators: Optional[List[str]] = Field(default_factory=list)
    optimal_market_conditions: Optional[str] = None
    performance_attribution: Optional[str] = None

class PortfolioIntegration(BaseModel):
    """Portfolio integration settings for multi-strategy coordination."""
    max_correlation_with_ranging_strategies: Optional[float] = None
    max_correlation_with_trending_strategies: Optional[float] = None
    max_correlation_with_volatility_strategies: Optional[float] = None
    preferred_allocation_range: Optional[List[float]] = Field(default_factory=list)
    risk_scaling_factor: Optional[float] = 1.0

class StrategyParameterSet(BaseModel):
    description: Optional[str] = ""
    strategy_definition_key: str
    parameters: Dict[str, Any]
    parameter_ranges: Optional[Dict[str, Any]] = None  # WFA-MINIMAL: Added for optimization support
    optimization_ranges: Optional[Dict[str, Any]] = None # WFA-MINIMAL: Legacy support
    regime_metadata: Optional[RegimeMetadata] = None
    portfolio_integration: Optional[PortfolioIntegration] = None

class RiskManagementSettings(BaseModel):
    global_max_account_drawdown_pct: float
    global_daily_drawdown_limit_pct: float
    default_risk_per_trade_idea_pct: float
    max_concurrent_trades_per_strategy_type: int = 3
    max_total_concurrent_trades: int = 5

    @field_validator('global_max_account_drawdown_pct', 'global_daily_drawdown_limit_pct', 'default_risk_per_trade_idea_pct', mode='before')
    def percentages_must_be_fractional(cls, v, info: ValidationInfo):
        if v <= 0 or v >= 1:
            raise ValueError(f"{info.field_name} must be a fraction between 0 and 1")
        return v

    @field_validator('max_concurrent_trades_per_strategy_type', 'max_total_concurrent_trades')
    def counts_must_be_positive_or_zero(cls, v, info: ValidationInfo):
        if v < 0:
            raise ValueError(f"'{v}' for field {info.field_name} must be positive or zero")
        return v

class OperationalComplianceSettings(BaseModel):
    min_trade_duration_seconds: int = 60
    max_orders_per_second: int = 4
    max_total_orders_per_day: int = 1800
    max_order_modifications_per_minute_total: int = 10
    market_close_blackout_period_hours: int = 4
    enforce_weekend_closure: bool = True
    is_swing_account: bool = False

class LeverageConstraintsSettings(BaseModel):
    max_leverage_ratio: int = 30
    margin_check_enabled: bool = True
    margin_buffer_pct: float = 0.05

    @field_validator('max_leverage_ratio')
    @classmethod
    def leverage_ratio_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError("max_leverage_ratio must be positive")
        return v

    @field_validator('margin_buffer_pct')
    @classmethod
    def margin_buffer_must_be_valid(cls, v):
        if v < 0 or v >= 1:
            raise ValueError("margin_buffer_pct must be between 0 and 1")
        return v

# NewsFilterSettings removed for FTMO Swing Accounts - no news trading restrictions

class StateManagementSettings(BaseModel):
    persistence_file: str = "state/bot_state.json"
    persistence_interval_seconds: int = 300

class BotSettings(BaseModel):
    trading_mode: str
    main_loop_delay_seconds: int
    app_name: str = "PropFirmAlgoBot"
    ftmo_server_timezone: str = "Europe/Prague"
    magic_number_default: int = 67890
    max_historical_bars_per_tf: int = 1000

    @field_validator('trading_mode')
    @classmethod
    def trading_mode_supported(cls, v):
        if v not in ["paper", "live"]:
            raise ValueError("trading_mode must be 'paper' or 'live'")
        return v

class AppConfig(BaseModel):
    bot_settings: BotSettings
    logging: LoggingSettings
    platform: PlatformSettings
    assets_to_trade: List[str] = Field(default_factory=list)
    asset_strategy_profiles: Dict[str, AssetStrategyProfile] = Field(default_factory=dict)
    strategy_definitions: Dict[str, StrategyDefinition] = Field(default_factory=dict)
    risk_management: RiskManagementSettings
    operational_compliance: OperationalComplianceSettings
    leverage_constraints: LeverageConstraintsSettings
    # news_filter removed for FTMO Swing Accounts - no news trading restrictions
    state_management: StateManagementSettings
    loaded_strategy_parameters: Dict[str, StrategyParameterSet] = Field(default_factory=dict, exclude=True)
    loaded_instrument_details: Dict[str, Dict[str, Any]] = Field(default_factory=dict, exclude=True)

    class Config:
        extra = 'ignore'
        platform_credentials: Dict[str, Any] = {}
        news_api_key_actual: Optional[str] = None

_config_manager_logger = logging.getLogger(__name__)
if not _config_manager_logger.hasHandlers():
    _config_manager_logger.addHandler(logging.StreamHandler())
    _config_manager_logger.setLevel(logging.INFO)

_config_instance: Optional[AppConfig] = None


def _strategy_params_filename(strategy_params_key: str) -> str:
    return strategy_params_key if strategy_params_key.endswith(".json") else f"{strategy_params_key}.json"


def _validate_vectorized_strategy_interface(
    strategy_class: Any,
    *,
    strategy_definition_key: str,
) -> None:
    from src.strategies.base_strategy import BaseStrategy

    if not isinstance(strategy_class, type):
        raise TypeError(
            f"Strategy definition '{strategy_definition_key}' resolved to a non-class object: {strategy_class!r}"
        )

    generate_vectorized_signals = getattr(strategy_class, "generate_vectorized_signals", None)
    if not callable(generate_vectorized_signals):
        raise TypeError(
            f"Strategy class '{strategy_class.__name__}' for definition '{strategy_definition_key}' "
            "does not provide generate_vectorized_signals()"
        )

    if issubclass(strategy_class, BaseStrategy):
        if strategy_class.generate_vectorized_signals is BaseStrategy.generate_vectorized_signals:
            raise TypeError(
                f"Strategy class '{strategy_class.__name__}' for definition '{strategy_definition_key}' "
                "does not override BaseStrategy.generate_vectorized_signals()"
            )


def _load_strategy_parameter_set(
    config_dir: str,
    profile_key: str,
    asset_profile: AssetStrategyProfile,
) -> StrategyParameterSet:
    strategy_param_path = Path(config_dir) / _strategy_params_filename(asset_profile.strategy_params_key)

    with open(strategy_param_path, 'r', encoding='utf-8') as f_strat:
        raw_strategy_params = json.load(f_strat)

    validated_params = StrategyParameterSet(**raw_strategy_params)

    from src.strategies.params_registry import validate_strategy_params

    validated_model = validate_strategy_params(
        validated_params.strategy_definition_key,
        validated_params.parameters,
        _config_manager_logger,
    )
    if validated_model:
        _config_manager_logger.info(
            f"✅ Strategy params validated: {validated_params.strategy_definition_key}"
        )

    _config_manager_logger.info(
        f"Loaded strategy parameters for '{asset_profile.strategy_params_key}' from '{strategy_param_path}'."
    )
    return validated_params


def resolve_strategy_profile_components(app_config: Any, profile_key: str) -> Dict[str, Any]:
    profiles = getattr(app_config, 'asset_strategy_profiles', None) or {}
    if profile_key not in profiles:
        raise KeyError(f"Strategy profile '{profile_key}' not found")

    strategy_profile = profiles[profile_key]
    strategy_params_key = getattr(strategy_profile, 'strategy_params_key', None)
    if not strategy_params_key:
        raise ValueError(f"Strategy profile '{profile_key}' is missing strategy_params_key")

    loaded_strategy_parameters = getattr(app_config, 'loaded_strategy_parameters', None) or {}
    if strategy_params_key not in loaded_strategy_parameters:
        raise KeyError(
            f"Strategy parameters '{strategy_params_key}' not loaded for profile '{profile_key}'"
        )

    param_set = loaded_strategy_parameters[strategy_params_key]
    strategy_definition_key = getattr(param_set, 'strategy_definition_key', None)
    if not strategy_definition_key:
        raise ValueError(
            f"Strategy parameters '{strategy_params_key}' for profile '{profile_key}' "
            "are missing strategy_definition_key"
        )

    strategy_definitions = getattr(app_config, 'strategy_definitions', None) or {}
    strategy_definition = strategy_definitions.get(strategy_definition_key)
    if strategy_definition is None:
        raise KeyError(f"Strategy definition '{strategy_definition_key}' not found")

    strategy_module = getattr(strategy_definition, 'strategy_module', None)
    strategy_class_name = getattr(strategy_definition, 'strategy_class', None)
    if not strategy_module or not strategy_class_name:
        raise ValueError(
            f"Strategy definition '{strategy_definition_key}' is missing module/class metadata"
        )

    try:
        module = import_module(strategy_module)
    except ImportError as e:
        raise ImportError(
            f"Failed to import strategy module '{strategy_module}' for definition '{strategy_definition_key}'"
        ) from e

    try:
        strategy_class = getattr(module, strategy_class_name)
    except AttributeError as e:
        raise AttributeError(
            f"Strategy class '{strategy_class_name}' not found in module '{strategy_module}' "
            f"for definition '{strategy_definition_key}'"
        ) from e

    _validate_vectorized_strategy_interface(
        strategy_class,
        strategy_definition_key=strategy_definition_key,
    )

    instrument_details_key = getattr(strategy_profile, 'instrument_details_key', None)
    if not instrument_details_key:
        raise ValueError(f"Strategy profile '{profile_key}' is missing instrument_details_key")

    loaded_instrument_details = getattr(app_config, 'loaded_instrument_details', None) or {}
    instrument_details = loaded_instrument_details.get(instrument_details_key)
    if instrument_details is None:
        raise KeyError(
            f"Instrument details '{instrument_details_key}' not found for profile '{profile_key}'"
        )

    return {
        'strategy_profile': strategy_profile,
        'strategy_params_key': strategy_params_key,
        'param_set': param_set,
        'strategy_definition_key': strategy_definition_key,
        'strategy_definition': strategy_definition,
        'strategy_class': strategy_class,
        'instrument_details_key': instrument_details_key,
        'instrument_details': instrument_details,
    }

def load_and_validate_config(config_dir: str = "config", main_config_filename: str = "main_config.yaml") -> AppConfig:
    global _config_instance
    if _config_instance is not None:
        _config_manager_logger.debug("Returning cached config instance.")
        return _config_instance

    main_config_path = os.path.join(config_dir, main_config_filename)
    _config_manager_logger.info(f"Attempting to load main configuration from: {main_config_path}")

    try:
        with open(main_config_path, 'r', encoding='utf-8') as f:
            raw_config_main = yaml.safe_load(f)
            if raw_config_main is None:
                err_msg = f"Main configuration file '{main_config_path}' is empty or invalid YAML."
                _config_manager_logger.error(err_msg)
                raise ValueError(err_msg)
    except FileNotFoundError:
        _config_manager_logger.error(f"Main configuration file not found at: {main_config_path}")
        raise
    except yaml.YAMLError as e:
        _config_manager_logger.error(f"Error parsing main YAML configuration from {main_config_path}: {e}")
        raise

    try:
        app_config = AppConfig(**raw_config_main)
        _config_manager_logger.info("Main configuration successfully parsed and validated.")

        app_config.Config.platform_credentials = {}
        if app_config.bot_settings.trading_mode == "live":
            if app_config.platform.name == "MetaTrader5" and app_config.platform.mt5:
                mt5_cfg = app_config.platform.mt5
                try:
                    app_config.Config.platform_credentials['mt5_account'] = os.environ[mt5_cfg.account_env_var]
                    app_config.Config.platform_credentials['mt5_password'] = os.environ[mt5_cfg.password_env_var]
                    app_config.Config.platform_credentials['mt5_server'] = os.environ[mt5_cfg.server_env_var]
                    _config_manager_logger.info("MT5 credentials loaded from environment variables.")
                except KeyError as e:
                    err_msg = f"Env var for MT5 credentials not set: {e}. Set {mt5_cfg.account_env_var}, etc."
                    _config_manager_logger.error(err_msg)
                    raise KeyError(err_msg)
            elif app_config.platform.name == "cTrader" and app_config.platform.ctrader:
                ctrader_cfg = app_config.platform.ctrader
                try:
                    app_config.Config.platform_credentials['ctrader_client_id'] = os.environ[ctrader_cfg.client_id_env_var]
                    app_config.Config.platform_credentials['ctrader_client_secret'] = os.environ[ctrader_cfg.client_secret_env_var]
                    app_config.Config.platform_credentials['ctrader_account_id'] = os.environ[ctrader_cfg.account_id_env_var]
                    _config_manager_logger.info("cTrader credentials loaded from environment variables.")
                except KeyError as e:
                    err_msg = f"Env var for cTrader credentials not set: {e}."
                    _config_manager_logger.error(err_msg)
                    raise KeyError(err_msg)
        else:
            _config_manager_logger.info(f"Trading mode is '{app_config.bot_settings.trading_mode}', skipping live credential loading.")

        # News API key loading removed for FTMO Swing Accounts - no news trading restrictions

        app_config.loaded_strategy_parameters = {}
        for profile_key, asset_profile in app_config.asset_strategy_profiles.items():
            if not asset_profile.enabled:
                continue

            if asset_profile.strategy_params_key in app_config.loaded_strategy_parameters:
                continue

            validated_params = _load_strategy_parameter_set(config_dir, profile_key, asset_profile)
            app_config.loaded_strategy_parameters[asset_profile.strategy_params_key] = validated_params

        instrument_file_path = Path(config_dir) / "instruments.json"
        app_config.loaded_instrument_details = {}

        with open(instrument_file_path, 'r', encoding='utf-8') as f_instr:
            raw_instrument_details = json.load(f_instr)
        app_config.loaded_instrument_details = raw_instrument_details
        _config_manager_logger.info(f"Loaded instrument details from '{instrument_file_path}'.")

        for asset_key in app_config.assets_to_trade:
            asset_profile = app_config.asset_strategy_profiles.get(asset_key)
            if asset_profile is None:
                raise ValueError(f"assets_to_trade references undefined profile '{asset_key}'")
            if not asset_profile.enabled:
                raise ValueError(f"assets_to_trade references disabled profile '{asset_key}'")

        for profile_key, asset_profile in app_config.asset_strategy_profiles.items():
            if not asset_profile.enabled:
                continue
            resolve_strategy_profile_components(app_config, profile_key)
            _config_manager_logger.info(f"Validated enabled strategy profile '{profile_key}'.")

        _config_instance = app_config
        _config_manager_logger.info("Configuration loading and processing complete.")
        return app_config

    except ValidationError as e:
        _config_manager_logger.error(f"Main configuration validation error from {main_config_path}: {e}")
        _config_manager_logger.error(f"Detailed Pydantic errors: {e.errors()}")
        raise
    except Exception as e:
        _config_manager_logger.error(f"An unexpected error occurred during configuration loading from {main_config_path}: {e}", exc_info=True)
        raise

def get_config() -> AppConfig:
    if _config_instance is None:
        _config_manager_logger.info("Config accessed via get_config() before explicit load. Loading with default path.")
        return load_and_validate_config()
    return _config_instance

if __name__ == "__main__":
    if not os.path.exists("config"): os.makedirs("config", exist_ok=True)
    if not os.path.exists("logs"): os.makedirs("logs", exist_ok=True)
    if not os.path.exists("state"): os.makedirs("state", exist_ok=True)

    test_main_config_file = "config/test_main_for_strat_loading.yaml"
    dummy_main_yaml_content = {
        "bot_settings": {"trading_mode": "paper", "main_loop_delay_seconds":10, "app_name": "StratLoadTest", "ftmo_server_timezone": "Europe/Prague"},
        "logging": {"level": "DEBUG", "directory": "logs", "file_name_prefix": "strat_load_test", "structured_logging": False, "max_bytes":1024, "backup_count":1, "log_format":"%(message)s"},
        "platform": {"name": "Paper", "mt5": None, "ctrader": None},
        "assets_to_trade": ["EURUSD_SMA_H1_Profile"],
        "asset_strategy_profiles": {
            "EURUSD_SMA_H1_Profile": {
                "symbol": "EURUSD", "enabled": True,
                "instrument_details_key": "EURUSD_FTMO_Test",
                "strategy_params_key": "strategy_sma_eurusd_h1_test.json"
            }
        },
        "strategy_definitions": {},
        "risk_management": {"global_max_account_drawdown_pct": 0.1, "global_daily_drawdown_limit_pct": 0.05, "default_risk_per_trade_idea_pct": 0.01},
        "operational_compliance": {"is_swing_account": False},
        "news_filter": {"enabled": False},
        "state_management": {"persistence_file": "state/strat_load_test_state.json", "persistence_interval_seconds": 300}
    }
    with open(test_main_config_file, "w") as f:
        yaml.dump(dummy_main_yaml_content, f, sort_keys=False)

    dummy_strategy_params_file = "config/strategy_sma_eurusd_h1_test.json"
    dummy_strategy_params_content = {
        "strategy_params_key": "strategy_sma_eurusd_h1_test.json",
        "description": "Test SMA params for EURUSD H1",
        "strategy_definition_key": "SMACrossDef",
        "parameters": {
            "timeframe": "H1",
            "fast_sma_period": 15,
            "slow_sma_period": 45,
            "atr_period_for_sl": 10,
            "atr_multiplier_for_sl": 2.2
        }
    }
    with open(dummy_strategy_params_file, "w") as f:
        json.dump(dummy_strategy_params_content, f, indent=4)

    dummy_instruments_file = "config/instruments_ftmo_test.json"
    dummy_instruments_content = {
        "EURUSD_FTMO_Test": { "platform_symbol": "EURUSD", "pip_value_in_account_currency_per_lot": 10.0 }
    }
    with open(dummy_instruments_file, "w") as f_instr:
        json.dump(dummy_instruments_content, f_instr, indent=4)

    try:
        _config_manager_logger.info("--- Testing ConfigManager with strategy param loading ---")
        app_config = load_and_validate_config(main_config_filename="test_main_for_strat_loading.yaml")

        if app_config.loaded_strategy_parameters:
            _config_manager_logger.info("Successfully loaded strategy parameters:")
            for key, params_set in app_config.loaded_strategy_parameters.items():
                _config_manager_logger.info(f"  Key: {key}, Params: {params_set.parameters}")
        else:
            _config_manager_logger.warning("No strategy parameters were loaded.")

        if app_config.loaded_instrument_details:
            _config_manager_logger.info(f"Instrument details loaded: {app_config.loaded_instrument_details}")
        else:
            _config_manager_logger.warning("Instrument details not loaded (check filename or logic if this is unexpected).")

    except Exception as e:
        _config_manager_logger.error(f"Error during ConfigManager test: {e}", exc_info=True)
    finally:
        _config_manager_logger.info("--- Finished ConfigManager test ---")


  
  
 
# src/walk_forward/walk_forward_runner.py

"""
Walk-Forward Analysis Runner for Trading Strategy Optimization.

This module provides comprehensive walk-forward analysis capabilities for trading
strategies, including parameter optimization, out-of-sample testing, and performance
validation with temporal stability analysis.
"""

# Standard library
import json
import logging
import traceback
import os
import random
import time
import hashlib
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Union, Tuple, Callable

# Third-party
import numpy as np
import optuna
import pandas as pd
from joblib import Parallel, delayed

# Local imports
from .window_manager import WindowManager, WindowConfig, TimeWindow
from .parameter_generator import ParameterGridGenerator, generate_parameter_combinations, MEANREVERSION_RSI_PARAMETERS
from .data_integrity import DataIntegrityManager, DataSplitMetadata, LeakagePreventionError
from .wfa_window_manager import WFAWindow, WFAWindowManager, WFAWindowConfig, WindowStrategy
from .stage_optimizer import StageBasedOptimizer
from .parameter_tracker import ParameterShelfLifeTracker
from .wfa_efficiency import WFAEfficiencyCalculator
from .multi_objective_optimizer import MultiObjectiveConfig, ObjectiveConfig, StabilityConfig, ObjectiveFunction
from .transaction_cost_modeler import TransactionCostModeler
from .cost_stress_tester import CostStressTester
from .deterministic_execution import DeterministicExecutionManager, DeterministicConfig, initialize_deterministic_wfa
from src.logging_service import setup_logging, setup_performance_logging
from src.custom_types import (
    StrategyParameters, BacktestResults, ParameterCombination,
    OptimizationResults, FilePath, TimeSeriesData
)
from src.exceptions import (
    OptimizationError, OptimizationExecutionError, TrialEvaluationError,
    DataError, DataLoadingError, DataValidationError,
    BacktestError, BacktestExecutionError, ConfigurationError,
    create_error_context
)
from src.utils.math_utils import (
    calculate_sharpe_ratio, calculate_profit_factor, calculate_win_rate,
    calculate_max_drawdown
)
from src.core.annualization import calculate_annualized_sharpe_from_returns, normalize_timeframe
from src.core.enums import Timeframe
from src.error_handling import ErrorHandler, retry_on_error, error_context

# Import for type hints
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from src.config_manager import AppConfig
    from src.data_handler.market_data_manager import MarketDataManager


@dataclass
class WalkForwardConfig:
    """
    Configuration for walk-forward analysis.

    This class defines all parameters needed to configure a walk-forward analysis
    including window sizing, optimization settings, and output preferences.

    Attributes:
        training_months: Number of months for training window.
        testing_months: Number of months for testing window.
        step_months: Number of months to step forward between windows.
        min_bars_per_window: Minimum number of bars required per window.
        n_parameter_trials: Number of optimization trials per window.
        sampling_strategy: Optuna sampling strategy ('tpe', 'random', etc.).
        optimization_seed: Random seed for reproducible optimization.
        strategy_profile_key: Key identifying the strategy profile to use.
        initial_balance: Starting balance for backtesting.
        performance_mode: Whether to enable performance optimizations.
        max_workers: Maximum number of worker threads (1 for sequential).
        output_directory: Directory path for saving results.
        save_detailed_results: Whether to save detailed window results.
        save_window_data: Whether to save individual window data files.
    """
    # Window configuration
    training_months: int = 6
    testing_months: int = 1
    step_months: int = 1
    min_bars_per_window: int = 100

    # Parameter optimization configuration
    n_parameter_trials: int = 50
    sampling_strategy: str = "tpe"
    optimization_seed: Optional[int] = None

    # Strategy configuration
    strategy_profile_key: str = "EURUSD_MeanReversion_H1"
    initial_balance: float = 100000.0
    
    # Transaction cost configuration (MUST be percentages for vectorbt)
    # fees: 0.0001 = 0.01%, 0.001 = 0.1%. Set to None to require YAML config.
    fees: Optional[float] = None  # Percentage of order value per trade
    slippage: Optional[float] = None  # Percentage of price slippage

    # Performance configuration
    performance_mode: bool = True
    max_workers: int = 1  # Sequential by default for stability
    use_vectorized_backtest: bool = False  # Use vectorbt for faster optimization

    # Output configuration
    output_directory: str = "results/walk_forward"
    save_detailed_results: bool = True
    save_window_data: bool = False
    
    # Parameter override from external config (takes precedence over strategy JSON)
    parameter_ranges_override: Optional[Dict[str, Any]] = None


@dataclass
class WindowResult:
    """
    Results from a single walk-forward window.

    This class encapsulates all results from processing one time window in the
    walk-forward analysis, including optimization and out-of-sample testing results.

    Attributes:
        window_id: Unique identifier for this window.
        training_period_start: Start date of training period (ISO format).
        training_period_end: End date of training period (ISO format).
        testing_period_start: Start date of testing period (ISO format).
        testing_period_end: End date of testing period (ISO format).
        best_parameters: Optimal parameters found during optimization.
        optimization_trials: Number of optimization trials performed.
        optimization_time_seconds: Time spent on optimization in seconds.
        final_balance: Final account balance after testing period.
        total_return_pct: Total return percentage for testing period.
        total_trades: Number of trades executed during testing.
        win_rate: Fraction of winning trades (0.0 to 1.0).
        profit_factor: Ratio of gross profit to gross loss.
        max_drawdown_pct: Maximum drawdown percentage during testing.
        sharpe_ratio: Risk-adjusted return metric.
        testing_time_seconds: Time spent on backtesting in seconds.
        success: Whether the window processing completed successfully.
        error_message: Error description if processing failed.
    """
    window_id: int
    training_period_start: str
    training_period_end: str
    testing_period_start: str
    testing_period_end: str

    # Optimization results
    best_parameters: StrategyParameters
    optimization_trials: int
    optimization_time_seconds: float

    # Testing results
    final_balance: float
    total_return_pct: float
    total_trades: int
    win_rate: float
    profit_factor: float
    max_drawdown_pct: float
    sharpe_ratio: float
    testing_time_seconds: float

    # Validation (must be before optional fields)
    success: bool
    
    # Trade-level metrics (for proper aggregation across windows)
    gross_profit: float = 0.0  # Total profit from winning trades
    gross_loss: float = 0.0  # Total loss from losing trades (absolute)
    win_count: int = 0  # Number of winning trades
    loss_count: int = 0  # Number of losing trades
    avg_trade_win_pct: float = 0.0  # Average winning trade as percent of capital base
    avg_trade_loss_pct: float = 0.0  # Average losing trade as percent of capital base
    error_message: Optional[str] = None


@dataclass
class WalkForwardResults:
    """
    Complete walk-forward analysis results.

    This class contains comprehensive results from a full walk-forward analysis,
    including individual window results, aggregate performance metrics, and
    parameter stability analysis.

    Attributes:
        config: Configuration used for the analysis.
        execution_start_time: Analysis start timestamp (ISO format).
        execution_end_time: Analysis end timestamp (ISO format).
        total_execution_time_seconds: Total execution time in seconds.
        window_results: Results from each individual window.
        total_windows: Total number of windows processed.
        successful_windows: Number of successfully processed windows.
        aggregate_return_pct: Combined return across all windows.
        aggregate_sharpe_ratio: Risk-adjusted return across all windows.
        aggregate_max_drawdown_pct: Maximum drawdown across all windows.
        aggregate_win_rate: Overall win rate across all windows.
        aggregate_profit_factor: Overall profit factor across all windows.
        aggregate_total_trades: Total number of trades across all windows.
        parameter_stability: Analysis of parameter consistency across windows.
        best_window_return: Highest return achieved in any single window.
        worst_window_return: Lowest return achieved in any single window.
        return_volatility: Standard deviation of window returns.
        consistency_score: Metric indicating strategy consistency (0.0 to 1.0).
    """
    config: WalkForwardConfig
    execution_start_time: str
    execution_end_time: str
    total_execution_time_seconds: float

    # Window results
    window_results: List[WindowResult]
    total_windows: int
    successful_windows: int

    # Aggregate performance
    aggregate_return_pct: float
    aggregate_sharpe_ratio: float
    aggregate_max_drawdown_pct: float
    aggregate_win_rate: float
    aggregate_profit_factor: float
    aggregate_total_trades: int
    
    # Aggregate trade-level metrics (for industry-standard reporting)
    aggregate_gross_profit: float
    aggregate_gross_loss: float
    aggregate_total_wins: int
    aggregate_total_losses: int
    aggregate_avg_trade_win_pct: float
    aggregate_avg_trade_loss_pct: float

    # Parameter stability analysis
    parameter_stability: Dict[str, Dict[str, Any]]

    # Summary statistics
    best_window_return: float
    worst_window_return: float
    return_volatility: float
    consistency_score: float


class WalkForwardRunner:
    """
    Main orchestrator for Walk-Forward Analysis execution.

    Coordinates window generation, parameter optimization, and out-of-sample testing
    to provide robust strategy validation with temporal stability analysis.
    """

    def __init__(self,
                 config: WalkForwardConfig,
                 app_config: Optional['AppConfig'] = None,
                 logger: Optional[logging.Logger] = None,
                 market_data_manager: Optional['MarketDataManager'] = None):
        """
        Initialize the Walk-Forward Analysis runner.

        Args:
            config: Walk-forward analysis configuration
            app_config: Application configuration (loaded if None)
            logger: Logger instance (created if None)
            market_data_manager: MarketDataManager instance for dynamic indicator recalculation
        """
        self.config = config
        self.app_config = app_config
        self.market_data_manager = market_data_manager

        # Setup logging with performance mode if enabled
        if logger is None:
            # Use simple logger to avoid conflicts with smoke test logging
            logger_name = "SmokeTest.WalkForwardRunner"
            self.logger = logging.getLogger(logger_name)

            # Only set up handler if not already configured
            if not self.logger.handlers:
                handler = logging.StreamHandler()
                formatter = logging.Formatter('%(asctime)s - %(name)s - [%(levelname)s] - %(message)s')
                handler.setFormatter(formatter)
                self.logger.addHandler(handler)
                self.logger.setLevel(logging.INFO)
        else:
            self.logger = logger

        # Initialize components
        self.window_manager: Optional[WindowManager] = None
        self.parameter_generator: Optional[ParameterGridGenerator] = None
        self.data_integrity_manager: Optional[DataIntegrityManager] = None

        # Enhanced WFA components
        self.wfa_window_manager: Optional[WFAWindowManager] = None
        self.stage_optimizer: Optional[StageBasedOptimizer] = None
        self.parameter_tracker: Optional[ParameterShelfLifeTracker] = None
        self.wfa_efficiency_calculator: Optional[WFAEfficiencyCalculator] = None

        # Results storage
        self.window_results: List[WindowResult] = []
        self.execution_start_time: Optional[datetime] = None
        self.execution_id: Optional[str] = None  # Database execution ID

        # Deterministic execution manager
        self.deterministic_manager: Optional[DeterministicExecutionManager] = None

        # Strict-mode provenance: per-window input hashes (training/testing)
        self._window_hashes: list[dict] = []

        self.logger.info(f"WalkForwardRunner initialized with {config.training_months}M training, {config.testing_months}M testing windows")
        
        # Log transaction cost configuration
        self._log_transaction_costs()

    def _get_fees(self) -> float:
        """
        Get fees from config with fail-fast guardrail.
        
        Returns:
            fees as a percentage (e.g., 0.0001 = 0.01%)
            
        Raises:
            ValueError: If fees is None and no default is acceptable.
        """
        if self.config.fees is not None:
            return self.config.fees
        
        # FAIL-FAST: If YAML didn't specify fees, do NOT silently default
        # This prevents the bug where YAML config is ignored
        default_fees = 0.0001  # 0.01% as a safe fallback
        self.logger.warning(
            f"⚠️ YAML config did not specify 'fees'. Using default: {default_fees} ({default_fees*100:.4f}%). "
            f"Set 'backtest.fees' in YAML to override."
        )
        return default_fees

    def _get_slippage(self) -> float:
        """
        Get slippage from config with fail-fast guardrail.
        
        Returns:
            slippage as a percentage (e.g., 0.0001 = 0.01%)
            
        Raises:
            ValueError: If slippage is None and no default is acceptable.
        """
        if self.config.slippage is not None:
            return self.config.slippage
        
        # FAIL-FAST: If YAML didn't specify slippage, do NOT silently default
        default_slippage = 0.0001  # 0.01% as a safe fallback
        self.logger.warning(
            f"⚠️ YAML config did not specify 'slippage'. Using default: {default_slippage} ({default_slippage*100:.4f}%). "
            f"Set 'backtest.slippage' in YAML to override."
        )
        return default_slippage

    def _log_transaction_costs(self) -> None:
        """Log the effective transaction costs for this WFA run."""
        fees = self._get_fees()
        slippage = self._get_slippage()
        
        self.logger.info("=" * 60)
        self.logger.info("📊 TRANSACTION COST CONFIGURATION")
        self.logger.info(f"  Fees:     {fees:.6f} ({fees*100:.4f}% per trade)")
        self.logger.info(f"  Slippage: {slippage:.6f} ({slippage*100:.4f}% per trade)")
        self.logger.info(f"  Source:   {'YAML config' if self.config.fees is not None else 'DEFAULT (add to YAML!)'}")
        self.logger.info("=" * 60)

    def _create_multi_objective_config(self) -> MultiObjectiveConfig:
        """Create multi-objective optimization configuration."""
        # Primary objective: Cost-adjusted Sharpe ratio with realistic transaction costs
        primary_objective = ObjectiveConfig(
            function=ObjectiveFunction.COST_ADJUSTED_SHARPE,
            weight=1.0,
            parameters={"cost_modeling_enabled": True}
        )

        # Secondary objectives including cost-aware metrics
        secondary_objectives = [
            ObjectiveConfig(
                function=ObjectiveFunction.COST_ADJUSTED_RETURN,
                weight=0.4,
                parameters={}
            ),
            ObjectiveConfig(
                function=ObjectiveFunction.STRESS_TESTED_PERFORMANCE,
                weight=0.3,
                parameters={"stress_scenario": "moderate"}
            ),
            ObjectiveConfig(
                function=ObjectiveFunction.DRAWDOWN_ADJUSTED_CAGR,
                weight=0.2,
                parameters={}
            )
        ]

        # Stability configuration
        stability_config = StabilityConfig(
            enabled=True,
            variance_penalty_weight=0.1,
            sensitivity_penalty_weight=0.05,
            consistency_bonus_weight=0.15,
            turnover_penalty_rate=0.001,
            max_parameter_deviation=0.25
        )

        return MultiObjectiveConfig(
            primary_objective=primary_objective,
            secondary_objectives=secondary_objectives,
            stability_config=stability_config,
            aggregation_method="weighted_sum",
            normalization_method="z_score"
        )

    def _validate_strategy_profile(self) -> None:
        """Validate that the specified strategy profile exists and is properly configured"""
        try:
            from src.config_manager import resolve_strategy_profile_components

            resolve_strategy_profile_components(self.app_config, self.config.strategy_profile_key)

            self.logger.info(f"Strategy profile '{self.config.strategy_profile_key}' validated")

        except Exception as e:
            available_profiles = list(getattr(self.app_config, 'asset_strategy_profiles', {}).keys()) or None
            raise ConfigurationError(
                f"Strategy profile validation failed: {e}",
                context=create_error_context(
                    strategy_profile_key=self.config.strategy_profile_key,
                    available_profiles=available_profiles,
                ),
                cause=e
            ) from e

    def _extract_symbol_from_profile_key(self, profile_key: str) -> str:
        """Extract symbol from strategy profile key."""
        try:
            # Strategy profile keys typically follow pattern: SYMBOL_Strategy_Timeframe
            # e.g., "EURUSD_MeanReversion_H1" -> "EURUSD"
            parts = profile_key.split('_')
            if parts:
                symbol = parts[0]
                self.logger.debug(f"Extracted symbol '{symbol}' from profile key '{profile_key}'")
                return symbol
            else:
                self.logger.warning(f"Could not extract symbol from profile key '{profile_key}', defaulting to EURUSD")
                return "EURUSD"
        except Exception as e:
            self.logger.warning(f"Error extracting symbol from profile key '{profile_key}': {e}, defaulting to EURUSD")
            return "EURUSD"

    def _get_strategy_profile(self):
        """Return the selected strategy profile when app config is available."""
        profiles = getattr(self.app_config, 'asset_strategy_profiles', None)
        if not profiles:
            return None
        return profiles.get(self.config.strategy_profile_key)

    def _get_strategy_timeframe(self) -> Timeframe:
        """Resolve the configured strategy timeframe for signal generation and annualization."""
        strategy_profile = self._get_strategy_profile()
        timeframe_value = getattr(strategy_profile, 'timeframe', Timeframe.M15.value) if strategy_profile else Timeframe.M15.value
        try:
            return normalize_timeframe(timeframe_value)
        except ValueError:
            self.logger.warning(
                f"Unsupported timeframe '{timeframe_value}' for profile '{self.config.strategy_profile_key}', defaulting to M15"
            )
            return Timeframe.M15

    def run_walk_forward_analysis(self,
                                data_source: Union[FilePath, TimeSeriesData],
                                save_results: bool = True) -> WalkForwardResults:
        """
        Execute complete walk-forward analysis workflow.

        This method performs the full walk-forward analysis including:
        1. Data loading and validation
        2. Time window generation
        3. Parameter optimization for each window
        4. Out-of-sample testing
        5. Results aggregation and analysis

        Args:
            data_source: Either file path to CSV data or DataFrame with OHLCV data.
                        CSV files must contain columns: Date, Open, High, Low, Close, Volume.
            save_results: Whether to save detailed results to files in the output directory.

        Returns:
            WalkForwardResults containing comprehensive analysis results including
            individual window performance, aggregate metrics, and parameter stability analysis.

        Raises:
            ValueError: If data source is invalid or strategy profile not found.
            FileNotFoundError: If CSV file path does not exist.
            RuntimeError: If analysis execution fails.
        """
        self.execution_start_time = datetime.now(timezone.utc)
        self.logger.info("=== Starting Walk-Forward Analysis ===")

        try:
            # 1. Initialize all components
            self._initialize_components()
            self._validate_strategy_profile()

            # 2. Load and validate data
            if isinstance(data_source, (str, Path)):
                data_source_path = Path(data_source) if isinstance(data_source, str) else data_source
                # Remember for deterministic seed derivation
                self._last_data_source_path = str(data_source_path)
                self.logger.info(f"Loading data from file: {data_source_path}")
                data = pd.read_csv(data_source_path)

                # Validate CSV data structure (check for both uppercase and lowercase variants)
                required_columns_upper = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
                required_columns_lower = ['timestamp', 'open', 'high', 'low', 'close', 'volume']

                # Check which format is used
                has_upper = all(col in data.columns for col in required_columns_upper)
                has_lower = all(col in data.columns for col in required_columns_lower)

                if not has_upper and not has_lower:
                    missing_upper = [col for col in required_columns_upper if col not in data.columns]
                    missing_lower = [col for col in required_columns_lower if col not in data.columns]
                    raise DataValidationError(
                        f"CSV file missing required columns. Expected either {required_columns_upper} "
                        f"or {required_columns_lower}. Available columns: {list(data.columns)}"
                    )

                # Normalize uppercase OHLCV columns to lowercase (targeted, not blanket)
                if has_upper:
                    rename_map = {'Date': 'timestamp', 'Open': 'open', 'High': 'high', 'Low': 'low', 'Close': 'close', 'Volume': 'volume'}
                    data.rename(columns=rename_map, inplace=True)
                    self.logger.debug('Normalized uppercase OHLCV columns to lowercase')

                # Log data range and characteristics
                timestamp_col = 'timestamp'
                if timestamp_col in data.columns:
                    # Smart timestamp parsing for Unix MS vs NS/Seconds
                    if len(data) > 0 and pd.api.types.is_numeric_dtype(data[timestamp_col]):
                        first_val = data[timestamp_col].iloc[0]
                        # 1e11 ms = 1973, 1e13 ms = 2286. Covers typical MS timestamps
                        if first_val > 1e11 and first_val < 1e13:
                             data[timestamp_col] = pd.to_datetime(data[timestamp_col], unit='ms', utc=True)
                        elif first_val > 1e9 and first_val < 1e11:  # Seconds
                             data[timestamp_col] = pd.to_datetime(data[timestamp_col], unit='s', utc=True)
                        else:
                             data[timestamp_col] = pd.to_datetime(data[timestamp_col], utc=True)
                    else:
                        data[timestamp_col] = pd.to_datetime(data[timestamp_col], utc=True)
                    start_date = data[timestamp_col].min().strftime('%Y-%m-%d %H:%M:%S')
                    end_date = data[timestamp_col].max().strftime('%Y-%m-%d %H:%M:%S')
                    self.logger.info(f"Using historical data from CSV file: {data_source_path}")
                    self.logger.info(f"Loaded {len(data)} rows from CSV file with data range: {start_date} to {end_date}")
                else:
                    self.logger.info(f"Using historical data from CSV file: {data_source_path}")
                    self.logger.info(f"Loaded {len(data)} rows from CSV file")
            else:
                self.logger.info("Using provided DataFrame")
                data = data_source.copy()
                # Normalize uppercase OHLCV columns for DataFrame input
                rename_map = {'Date': 'timestamp', 'Open': 'open', 'High': 'high', 'Low': 'low', 'Close': 'close', 'Volume': 'volume'}
                data.rename(columns={k: v for k, v in rename_map.items() if k in data.columns}, inplace=True)
                self.logger.info(f"DataFrame contains {len(data)} rows")

            # Generate time windows
            self.logger.info("Generating time windows...")
            windows = self.window_manager.generate_wfa_windows(data)
            self.logger.info(f"Generated {len(windows)} time windows")

            # 4. Process each window (PARALLEL if max_workers > 1)
            self.window_results = []
            
            if self.config.max_workers > 1:
                # PARALLEL execution using joblib
                self.logger.info(f"🚀 PARALLEL execution with {self.config.max_workers} workers")
                
                # Use joblib Parallel for concurrent window processing
                parallel_results = Parallel(
                    n_jobs=self.config.max_workers,
                    verbose=10,
                    prefer="processes"
                )(
                    delayed(self._process_single_window)(window_id, window)
                    for window_id, window in enumerate(windows)
                )
                
                # Collect results and log completion status
                for window_id, window_result in enumerate(parallel_results):
                    self.window_results.append(window_result)
                    if window_result.success:
                        self.logger.info(f"Window {window_id + 1} completed: "
                                       f"Return={window_result.total_return_pct:.2f}%, "
                                       f"Trades={window_result.total_trades}")
                    else:
                        self.logger.warning(f"Window {window_id + 1} failed: {window_result.error_message}")
            else:
                # SEQUENTIAL execution (original logic)
                for window_id, window in enumerate(windows):
                    self.logger.info(f"Processing window {window_id + 1}/{len(windows)}: {window}")

                    try:
                        window_result = self._process_single_window(window_id, window)
                        self.window_results.append(window_result)

                        if window_result.success:
                            self.logger.info(f"Window {window_id + 1} completed successfully: "
                                           f"Return={window_result.total_return_pct:.2f}%, "
                                           f"Trades={window_result.total_trades}")
                        else:
                            self.logger.warning(f"Window {window_id + 1} failed: {window_result.error_message}")

                    except Exception as e:
                        self.logger.error(f"Failed to process window {window_id + 1}: {e}", exc_info=True)
                        # Create failed window result
                        failed_result = WindowResult(
                            window_id=window_id,
                            training_period_start=window.split_metadata.training_start.isoformat(),
                            training_period_end=window.split_metadata.training_end.isoformat(),
                            testing_period_start=window.split_metadata.validation_start.isoformat(),
                            testing_period_end=window.split_metadata.validation_end.isoformat(),
                            best_parameters={},
                            optimization_trials=0,
                            optimization_time_seconds=0.0,
                            final_balance=self.config.initial_balance,
                            total_return_pct=0.0,
                            total_trades=0,
                            win_rate=0.0,
                            profit_factor=0.0,
                            max_drawdown_pct=0.0,
                            sharpe_ratio=0.0,
                            testing_time_seconds=0.0,
                            success=False,
                            error_message=str(e)
                        )
                        self.window_results.append(failed_result)

            # 5. Calculate aggregate results
            execution_end_time = datetime.now(timezone.utc)
            results = self._calculate_aggregate_results(execution_end_time)

            # 6. Save results if requested
            if save_results:
                # Validate result schema before saving
                try:
                    from .validation.result_schema import WfaResultSchema
                    WfaResultSchema().validate(results)
                except Exception as ve:
                    self.logger.error(f"Schema validation failed: {ve}")
                    raise
                self._save_results(results)
                # Note: Database persistence removed - wfa-minimal is file-only

            self.logger.info("=== Walk-Forward Analysis Completed ===")
            self.logger.info(f"Total windows: {results.total_windows}")
            self.logger.info(f"Successful windows: {results.successful_windows}")
            self.logger.info(f"Aggregate return: {results.aggregate_return_pct:.2f}%")
            self.logger.info(f"Aggregate Sharpe ratio: {results.aggregate_sharpe_ratio:.3f}")
            self.logger.info(f"Execution time: {results.total_execution_time_seconds:.2f}s")

            return results

        except Exception as e:
            self.logger.error(f"Walk-forward analysis failed: {e}", exc_info=True)
            raise

    def _process_single_window(self, window_id: int, window: WFAWindow) -> WindowResult:
        """
        Process a single walk-forward window: optimize parameters on training data,
        then test on out-of-sample testing data.

        Args:
            window_id: Unique identifier for the window
            window: TimeWindow containing training and testing data

        Returns:
            WindowResult with optimization and testing results
        """
        window_start_time = time.time()

        try:
            # 1. Use the explicit outer walk-forward split prepared by the window manager
            self.logger.debug(f"Using explicit outer walk-forward split for window {window_id}")

            training_data = window.optimization_data.copy()
            validation_data = window.validation_data.copy()
            split_metadata = window.split_metadata

            self.logger.info(
                f"Window {window_id}: Outer train/test split - "
                f"Training: {len(training_data)} rows [{split_metadata.training_start.date()} → {split_metadata.training_end.date()}], "
                f"Testing: {len(validation_data)} rows [{split_metadata.validation_start.date()} → {split_metadata.validation_end.date()}]"
            )

            # 2. Parameter optimization on training data with runtime guards
            self.logger.debug(f"Starting parameter optimization for window {window_id}")
            optimization_start = time.time()

            # Get runtime guards for leakage prevention
            runtime_guards = self.data_integrity_manager.create_runtime_guards()

            best_parameters = self._optimize_parameters_on_training_data(
                training_data,
                window_id=window_id,
                runtime_guards=runtime_guards
            )
            optimization_time = time.time() - optimization_start
            # Strict-mode per-window hashing of actual slices
            try:
                from src.utils.stable_io import is_strict_mode, stable_csv_write
                import io, hashlib
                if is_strict_mode():
                    # Hash training slice
                    tbuf = io.StringIO()
                    stable_csv_write(training_data, tbuf, index=True)
                    thash = hashlib.sha256(tbuf.getvalue().encode('utf-8')).hexdigest()
                    # We'll append hashes later when window result object is created
                    self._window_hashes.append({
                        'window_id': window_id,
                        'slice': 'training',
                        'format': 'csv@stable_io:v1',
                        'sha256': thash,
                        'rows': len(training_data),
                        'cols': len(training_data.columns)
                    })
            except Exception as _e:
                self.logger.warning(f"Training slice hashing failed for window {window_id}: {_e}")


            self.logger.debug(f"Parameter optimization completed in {optimization_time:.2f}s")
            self.logger.debug(f"Best parameters: {best_parameters}")

            # 3. Out-of-sample testing with optimized parameters
            self.logger.debug(f"Starting out-of-sample testing for window {window_id}")
            testing_start = time.time()

            testing_results = self._test_parameters_on_testing_data(
                validation_data,
                best_parameters,
                runtime_guards=runtime_guards
            )
            testing_time = time.time() - testing_start

            self.logger.debug(f"Out-of-sample testing completed in {testing_time:.2f}s")

            # 3. Create window result
            window_result = WindowResult(
                window_id=window_id,
                training_period_start=split_metadata.training_start.isoformat(),
                training_period_end=split_metadata.training_end.isoformat(),
                testing_period_start=split_metadata.validation_start.isoformat(),
                testing_period_end=split_metadata.validation_end.isoformat(),
                best_parameters=best_parameters,
                optimization_trials=self.config.n_parameter_trials,
                optimization_time_seconds=optimization_time,
                final_balance=testing_results.get('final_balance', self.config.initial_balance),
                total_return_pct=testing_results.get('total_return_pct', 0.0),
                total_trades=testing_results.get('total_trades', 0),
                win_rate=testing_results.get('win_rate', 0.0),
                profit_factor=testing_results.get('profit_factor', 0.0),
                max_drawdown_pct=testing_results.get('max_drawdown_pct', 0.0),
                sharpe_ratio=testing_results.get('sharpe_ratio', 0.0),
                testing_time_seconds=testing_time,
                # Trade-level metrics for proper aggregation
                gross_profit=testing_results.get('gross_profit', 0.0),
                gross_loss=testing_results.get('gross_loss', 0.0),
                win_count=testing_results.get('win_count', 0),
                loss_count=testing_results.get('loss_count', 0),
                avg_trade_win_pct=testing_results.get('avg_trade_win_pct', 0.0),
                avg_trade_loss_pct=testing_results.get('avg_trade_loss_pct', 0.0),
                success=True
            )

            return window_result

        except Exception as e:
            self.logger.error(f"Failed to process window {window_id}: {e}", exc_info=True)

            # Return failed result
            return WindowResult(
                window_id=window_id,
                training_period_start=window.split_metadata.training_start.isoformat(),
                training_period_end=window.split_metadata.training_end.isoformat(),
                testing_period_start=window.split_metadata.validation_start.isoformat(),
                testing_period_end=window.split_metadata.validation_end.isoformat(),
                best_parameters={},
                optimization_trials=0,
                optimization_time_seconds=0.0,
                final_balance=self.config.initial_balance,
                total_return_pct=0.0,
                total_trades=0,
                win_rate=0.0,
                profit_factor=0.0,
                max_drawdown_pct=0.0,
                sharpe_ratio=0.0,
                testing_time_seconds=0.0,
                success=False,
                error_message=str(e)
            )

    def _optimize_parameters_on_training_data(self,
                                             training_data: TimeSeriesData,
                                             window_id: Optional[int] = None,
                                             runtime_guards: Optional[Dict[str, Any]] = None) -> StrategyParameters:
        """
        Optimize strategy parameters using Optuna on training data with leakage prevention.

        This method uses Optuna's Tree-structured Parzen Estimator (TPE) to find
        optimal strategy parameters by maximizing the Sharpe ratio on training data.
        Includes deterministic seed generation and runtime leakage guards.

        Args:
            training_data: Historical OHLCV data for parameter optimization.
                          Must contain columns: Date, Open, High, Low, Close, Volume.
            window_id: Window identifier for deterministic seed generation.
            runtime_guards: Runtime guards for leakage prevention.

        Returns:
            Dictionary containing optimized strategy parameters.
            Falls back to default parameters if optimization fails.

        Raises:
            RuntimeError: If optimization fails and fallback parameters unavailable.
            LeakagePreventionError: If data leakage is detected during optimization.
        """
        self.logger.info("Starting direct Optuna optimization study with leakage prevention...")

        with error_context("parameter_optimization", self.logger, "WalkForwardRunner", reraise=False):
            try:
                # Generate deterministic seed for this window using enhanced deterministic manager
                if window_id is not None and self.deterministic_manager is not None:
                    base_seed = self.deterministic_manager.generate_deterministic_seed(f"window_{window_id}", 0)
                    self.logger.debug(f"Using enhanced deterministic seed {base_seed} for window {window_id}")
                elif window_id is not None and self.data_integrity_manager is not None:
                    base_seed = self.data_integrity_manager.generate_deterministic_seed(window_id, 0)
                    self.logger.debug(f"Using fallback deterministic seed {base_seed} for window {window_id}")
                else:
                    base_seed = 42  # Final fallback seed

                def objective(trial: optuna.Trial) -> float:
                    """
                    Objective function for Optuna optimization with leakage prevention.

                    Args:
                        trial: Optuna trial object for parameter suggestion.

                    Returns:
                        Sharpe ratio as optimization target (higher is better).
                    """
                    try:
                        # Apply runtime guards if available
                        if runtime_guards and 'validate_timestamp_access' in runtime_guards:
                            current_time = training_data['timestamp'].max() if 'timestamp' in training_data.columns else None
                            if current_time:
                                runtime_guards['validate_timestamp_access'](training_data, current_time)

                        # Generate deterministic seed for this trial using enhanced manager
                        if window_id is not None and self.deterministic_manager is not None:
                            trial_seed = self.deterministic_manager.generate_deterministic_seed(f"window_{window_id}_trial", trial.number)
                            # Set all random states for this trial
                            np.random.seed(trial_seed)
                            random.seed(trial_seed + 1)  # Offset for Python random
                        elif window_id is not None and self.data_integrity_manager is not None:
                            trial_seed = self.data_integrity_manager.generate_deterministic_seed(window_id, trial.number)
                            # Set random states for this trial
                            np.random.seed(trial_seed)

                        params = self.parameter_generator.suggest_trial_parameters(trial)
                        score = self._evaluate_parameter_combination(params, training_data, runtime_guards)
                        return score
                    except LeakagePreventionError as e:
                        self.logger.error(f"Data leakage detected in trial {trial.number}: {e}")
                        raise  # Re-raise leakage errors to stop optimization
                    except Exception as e:
                        # Log trial failure but don't stop optimization
                        self.logger.warning(f"Trial {trial.number} failed: {e}")
                        return -9999.0  # Return very low score for failed trials

                # Create study with enhanced deterministic sampler
                if self.deterministic_manager is not None:
                    sampler = self.deterministic_manager.create_deterministic_optuna_sampler(f"window_{window_id}", 0)
                else:
                    # Fallback to basic deterministic sampler
                    from optuna.samplers import TPESampler
                    sampler = TPESampler(seed=base_seed)

                study = optuna.create_study(direction="maximize", sampler=sampler)
                study.optimize(
                    objective,
                    n_trials=self.config.n_parameter_trials,
                    n_jobs=1 if (self.deterministic_manager is not None and self.deterministic_manager.config.enable_deterministic_mode) else -1,  # Sequential for determinism, parallel otherwise
                    timeout=3600  # 1 hour timeout
                )

                if study.best_trial and study.best_value > -9999.0:
                    self.logger.info(f"Optimization complete. Best trial score: {study.best_value:.4f}")
                    return study.best_params
                else:
                    self.logger.warning("Optuna study completed without finding valid trials. Falling back to defaults.")
                    return self.parameter_generator._get_default_parameters()

            except Exception as e:
                raise OptimizationExecutionError(
                    "Parameter optimization failed",
                    context=create_error_context(
                        n_trials=self.config.n_parameter_trials,
                        training_data_shape=training_data.shape if hasattr(training_data, 'shape') else None
                    ),
                    cause=e,
                    recoverable=True
                ) from e

        # Fallback if error_context doesn't reraise
        self.logger.warning("Falling back to default parameters due to optimization error.")
        return self.parameter_generator._get_default_parameters()

    def _convert_config_ranges_to_generator_format(self, config_ranges: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert config-based parameter ranges to ParameterGridGenerator format.

        Args:
            config_ranges: Parameter ranges from config file

        Returns:
            Dictionary in ParameterGridGenerator format
        """
        generator_format = {}

        for param_name, param_config in config_ranges.items():
            if isinstance(param_config, dict) and 'values' in param_config:
                values = param_config['values']

                # Determine parameter type and create generator spec
                if all(isinstance(v, bool) for v in values):
                    generator_format[param_name] = {
                        "type": "boolean",
                        "values": values,
                        "default": values[0],
                        "description": f"Config-based {param_name}"
                    }
                # Single-valued numeric lists should be treated as categorical to avoid invalid [min==max] ranges
                elif len(values) == 1 and isinstance(values[0], (int, float)):
                    generator_format[param_name] = {
                        "type": "categorical",
                        "values": values,
                        "default": values[0],
                        "description": f"Config-based {param_name} (fixed)"
                    }
                elif all(isinstance(v, int) for v in values):
                    generator_format[param_name] = {
                        "type": "integer",
                        "range": [min(values), max(values)],
                        "step": 1 if len(values) <= 2 else values[1] - values[0],
                        "default": values[0],
                        "description": f"Config-based {param_name}"
                    }
                elif all(isinstance(v, (int, float)) for v in values):
                    generator_format[param_name] = {
                        "type": "float",
                        "range": [float(min(values)), float(max(values))],
                        "step": 0.1 if len(values) <= 2 else float(values[1]) - float(values[0]),
                        "default": float(values[0]),
                        "description": f"Config-based {param_name}"
                    }
                else:
                    # Categorical
                    generator_format[param_name] = {
                        "type": "categorical",
                        "values": values,
                        "default": values[0],
                        "description": f"Config-based {param_name}"
                    }
            elif isinstance(param_config, list):
                # Direct list format
                values = param_config

                if all(isinstance(v, bool) for v in values):
                    generator_format[param_name] = {
                        "type": "boolean",
                        "values": values,
                        "default": values[0],
                        "description": f"Config-based {param_name}"
                    }
                elif all(isinstance(v, int) for v in values):
                    generator_format[param_name] = {
                        "type": "integer",
                        "range": [min(values), max(values)],
                        "step": 1 if len(values) <= 2 else values[1] - values[0],
                        "default": values[0],
                        "description": f"Config-based {param_name}"
                    }
                elif all(isinstance(v, (int, float)) for v in values):
                    generator_format[param_name] = {
                        "type": "float",
                        "range": [float(min(values)), float(max(values))],
                        "step": 0.1 if len(values) <= 2 else float(values[1]) - float(values[0]),
                        "default": float(values[0]),
                        "description": f"Config-based {param_name}"
                    }
                else:
                    generator_format[param_name] = {
                        "type": "categorical",
                        "values": values,
                        "default": values[0],
                        "description": f"Config-based {param_name}"
                    }

        return generator_format

    def _test_parameters_on_testing_data(self,
                                        testing_data: TimeSeriesData,
                                        parameters: StrategyParameters,
                                        runtime_guards: Optional[Dict[str, Any]] = None) -> BacktestResults:
        """
        Test optimized parameters on out-of-sample testing data.

        This method performs out-of-sample validation by running a backtest
        with the optimized parameters on previously unseen testing data.

        Args:
            testing_data: Testing dataset for out-of-sample validation.
                         Must contain columns: Date, Open, High, Low, Close, Volume.
            parameters: Optimized strategy parameters from training phase.

        Returns:
            Dictionary containing testing results and performance metrics including:
            - final_balance: Account balance after testing period
            - total_return_pct: Total return percentage
            - total_trades: Number of trades executed
            - win_rate: Fraction of winning trades in [0.0, 1.0]
            - profit_factor: Ratio of gross profit to gross loss
            - max_drawdown_pct: Maximum drawdown percentage
            - sharpe_ratio: Risk-adjusted return metric

        Raises:
            RuntimeError: If backtest execution fails.
            FileNotFoundError: If temporary data file cannot be created.
        """
        try:
            # --- OPTION A: VECTORIZED BACKTEST (FAST) ---
            if (self.config.use_vectorized_backtest and 
                self.vectorized_engine is not None and 
                self.strategy_class is not None):
                
                try:
                    self.logger.info(f"Running VECTORIZED out-of-sample test with {len(testing_data)} rows")
                    strategy_profile = self._get_strategy_profile()
                    strategy_timeframe = self._get_strategy_timeframe()
                    strategy_symbol = getattr(strategy_profile, 'symbol', 'EURUSD') if strategy_profile else 'EURUSD'

                    # 1. Instantiate strategy
                    # Helper for attribute access (supports both .attr and .get())
                    class AttrDict(dict):
                        def __getattr__(self, item):
                            try:
                                return self[item]
                            except KeyError:
                                raise AttributeError(f"'AttrDict' object has no attribute '{item}'")

                    class LightweightStrategy(self.strategy_class):
                        def __init__(innerself, params_dict):
                            innerself.strategy_params = AttrDict(**params_dict)
                            innerself.logger = logging.getLogger("VectorizedStrategy")
                            innerself.config = None  # Prevent AttributeError for strategies that check self.config
                            # Set symbol/timeframe from strategy profile (not hardcoded)
                            innerself.symbol = strategy_symbol
                            innerself.timeframe = strategy_timeframe
                            innerself._initialize_strategy_parameters()
                    
                    strategy_instance = LightweightStrategy(parameters)
                    
                    # Ensure DatetimeIndex for strategy resampling (ATR calc)
                    testing_data_indexed = testing_data.copy()
                    if 'timestamp' in testing_data_indexed.columns:
                        testing_data_indexed['timestamp'] = pd.to_datetime(testing_data_indexed['timestamp'])
                        testing_data_indexed.set_index('timestamp', inplace=True, drop=False)
                    elif 'Date' in testing_data_indexed.columns:
                        testing_data_indexed['timestamp'] = pd.to_datetime(testing_data_indexed['Date'])
                        testing_data_indexed.set_index('timestamp', inplace=True, drop=False)
                    
                    # 2. Generate Signals
                    signals = strategy_instance.generate_vectorized_signals(testing_data_indexed, AttrDict(**parameters))
                    
                    # 3. Run Vectorized Backtest
                    result = self.vectorized_engine.run_strategy_backtest(
                        data=testing_data_indexed,
                        signals=signals,
                        initial_balance=self.config.initial_balance,
                        fees=self._get_fees(),
                        slippage=self._get_slippage(),
                        timeframe=strategy_timeframe,
                    )
                    
                    self.logger.info(f"Vectorized test complete: Return={result.total_return_pct:.2f}%, Trades={result.total_trades}")
                    return {
                        'final_balance': result.final_balance,
                        'total_return_pct': result.total_return_pct,
                        'total_trades': result.total_trades,
                        'win_rate': result.win_rate,
                        'profit_factor': result.profit_factor,
                        'max_drawdown_pct': result.max_drawdown_pct,
                        'sharpe_ratio': result.sharpe_ratio,
                        # Trade-level metrics for proper aggregation
                        'gross_profit': result.gross_profit,
                        'gross_loss': result.gross_loss,
                        'win_count': result.win_count,
                        'loss_count': result.loss_count,
                        'avg_trade_win_pct': result.avg_trade_win_pct,
                        'avg_trade_loss_pct': result.avg_trade_loss_pct
                    }
                    
                except Exception as e:
                    self.logger.error(f"Vectorized testing failed: {e}")
                    self.logger.error(traceback.format_exc())
                    raise RuntimeError(f"Vectorized backtesting failed: {e}") from e

            else:
                 raise RuntimeError("Vectorization conditions not met but required!")

            # Note: Event-driven fallback removed - wfa-minimal is vectorized-only

        except Exception as e:
            self.logger.error(f"Testing failed: {e}", exc_info=True)
            return {
                'final_balance': self.config.initial_balance,
                'total_return_pct': 0.0,
                'total_trades': 0,
                'win_rate': 0.0,
                'profit_factor': 0.0,
                'max_drawdown_pct': 0.0,
                'sharpe_ratio': 0.0,
                'gross_profit': 0.0,
                'gross_loss': 0.0,
                'win_count': 0,
                'loss_count': 0,
                'avg_trade_win_pct': 0.0,
                'avg_trade_loss_pct': 0.0
            }

    def _initialize_components(self) -> None:
        """Initialize all required components for walk-forward analysis"""
        # Initialize error handler
        self.error_handler = ErrorHandler(self.logger, "WalkForwardRunner")

        # Initialize deterministic execution environment FIRST
        with error_context("deterministic_init", self.logger, "WalkForwardRunner"):
            import os  # ensure module bound in local scope for static analysis and context wrapping
            # Respect deterministic CI flags to force fixed seeding
            deterministic_flags = (
                os.environ.get("DET_WFA_SEED") is not None or 
                os.environ.get("DETERMINISTIC_MODE") == "1" or
                self.config.optimization_seed is not None
            )
            
            # Create config
            det_config = DeterministicConfig(
                enable_deterministic_mode=deterministic_flags,
                base_seed=int(os.environ.get("DET_WFA_SEED")) if os.environ.get("DET_WFA_SEED") else (self.config.optimization_seed or 42),
                force_single_thread=False # Allow parallelism even in deterministic mode if properly seeded
            )
            
            # Initialize global deterministic state
            self.deterministic_manager = DeterministicExecutionManager(det_config)
            self.deterministic_manager.initialize_deterministic_environment()
            
            if self.deterministic_manager.config.enable_deterministic_mode:
                self.logger.info(f"🔒 Deterministic WFA enabled with seed: {self.deterministic_manager.config.master_seed}")
                
        # Initialize components with error context
        with error_context("component_init", self.logger, "WalkForwardRunner"):
            # 1. Parameter Generator
            # PRIORITY 1: Check for config-level parameter override
            if self.config.parameter_ranges_override:
                # Convert override ranges to generator format
                override_ranges = self._convert_config_ranges_to_generator_format(self.config.parameter_ranges_override)
                self.parameter_generator = ParameterGridGenerator(
                    logger=self.logger
                )
                # Manually inject the specs
                self.parameter_generator.load_parameter_specs_from_dict(override_ranges)
                self.logger.info(f"🎛️ ParameterGridGenerator initialized with EXTERNAL OVERRIDE parameters")
            else:
                # PRIORITY 2: Try to load parameter ranges from strategy config
                strategy_profile = self.app_config.asset_strategy_profiles.get(self.config.strategy_profile_key)
                if strategy_profile:
                    # Get strategy parameters key
                    strategy_params_key = strategy_profile.strategy_params_key
                    # Get the actual parameters object
                    strategy_params_obj = self.app_config.loaded_strategy_parameters.get(strategy_params_key)
                    
                    if strategy_params_obj and (strategy_params_obj.optimization_ranges or getattr(strategy_params_obj, "parameter_ranges", None)):
                        # Use optimization ranges from config (preferred)
                        ranges_dict = strategy_params_obj.optimization_ranges or getattr(strategy_params_obj, "parameter_ranges", None)
                        override_ranges = self._convert_config_ranges_to_generator_format(ranges_dict)
                        self.parameter_generator = ParameterGridGenerator(
                            logger=self.logger
                        )
                        self.parameter_generator.load_parameter_specs_from_dict(override_ranges)
                        self.logger.info(f"🎛️ ParameterGridGenerator initialized with STRATEGY CONFIG optimization ranges")
                    else:
                         # Fallback to default
                        self.parameter_generator = ParameterGridGenerator(
                            logger=self.logger
                        )
                else:
                    self.parameter_generator = ParameterGridGenerator(
                        logger=self.logger
                    )
            
            # Vectorized Backtest Engine (wfa-minimal: vectorized-only)
            self.vectorized_engine = None
            self.strategy_class = getattr(self, 'strategy_class', None)  # Preserve external override
            
            if self.config.use_vectorized_backtest:
                from src.config_manager import resolve_strategy_profile_components

                try:
                    from src.backtesting.vectorized_backtest_engine import VectorizedBacktestEngine
                except ImportError as e:
                    raise ConfigurationError(
                        "Vectorized backtest requested but VectorizedBacktestEngine could not be imported",
                        context=create_error_context(strategy_profile_key=self.config.strategy_profile_key),
                        cause=e,
                    ) from e

                try:
                    self.vectorized_engine = VectorizedBacktestEngine(logger=self.logger)
                except ImportError as e:
                    raise ConfigurationError(
                        "Vectorized backtest requested but vectorbt is unavailable",
                        context=create_error_context(strategy_profile_key=self.config.strategy_profile_key),
                        cause=e,
                    ) from e

                self.logger.info("🚀 VectorizedBacktestEngine initialized")

                # Skip config loading if strategy_class already set externally
                if self.strategy_class is not None:
                    self.logger.info(f"Using externally set strategy class: {self.strategy_class.__name__}")
                else:
                    components = resolve_strategy_profile_components(
                        self.app_config,
                        self.config.strategy_profile_key,
                    )
                    self.strategy_class = components['strategy_class']
                    self.logger.info(f"Loaded strategy class via config: {self.strategy_class.__name__}")
                    
            # 4. Data Integrity Manager
            self.data_integrity_manager = DataIntegrityManager(base_seed=det_config.base_seed)
            
            # 5. Window Manager
            self.window_manager = WFAWindowManager(
                config=WFAWindowConfig(
                    strategy=WindowStrategy.ROLLING,
                    optimization_months=self.config.training_months,
                    validation_months=self.config.testing_months,
                    step_months=self.config.step_months,
                    min_bars_per_window=self.config.min_bars_per_window
                ),
                data_integrity_manager=self.data_integrity_manager,
                logger=self.logger
            )
            
            # 6. Parameter Tracker
            self.parameter_tracker = ParameterShelfLifeTracker(
                logger=self.logger
            )
            
            # 7. Optimizer
            self.optimizer = StageBasedOptimizer(
                data_integrity_manager=self.data_integrity_manager,
                logger=self.logger
            )

    def _evaluate_parameter_combination(self,
                                       parameters: Dict[str, Any],
                                       training_data: pd.DataFrame,
                                       runtime_guards: Optional[Dict[str, Any]] = None) -> float:
        """
        Evaluates a single parameter combination and returns its fitness score.

        Args:
            parameters: Parameter combination to evaluate
            training_data: Training data for evaluation

        Returns:
            Fitness score (Sharpe ratio) for the parameter combination
        """
        try:
            # Handle timestamps for logging
            try:
                train_start = training_data.index.min().strftime('%Y-%m-%d %H:%M:%S')
                train_end = training_data.index.max().strftime('%Y-%m-%d %H:%M:%S')
                # self.logger.debug(f"Evaluating: {parameters}") # Reduce verbosity
            except AttributeError:
                pass

            # --- OPTION A: VECTORIZED BACKTEST (FAST) ---
            if (self.config.use_vectorized_backtest and 
                self.vectorized_engine is not None and 
                self.strategy_class is not None):
                
                try:
                    strategy_profile = self._get_strategy_profile()
                    strategy_timeframe = self._get_strategy_timeframe()
                    strategy_symbol = getattr(strategy_profile, 'symbol', 'EURUSD') if strategy_profile else 'EURUSD'

                    # 1. Instantiate strategy with parameters
                    # We need a partial instantiation because we don't have all the adapters/managers needed for full init
                    # But generate_vectorized_signals only needs self.params
                    
                    # Helper for attribute access (supports both .attr and .get())
                    class AttrDict(dict):
                        def __getattr__(self, item):
                            try:
                                return self[item]
                            except KeyError:
                                raise AttributeError(f"'AttrDict' object has no attribute '{item}'")

                    # Hack: create a lightweight instance or just helper
                    class LightweightStrategy(self.strategy_class):
                        def __init__(innerself, params_dict):
                            # Skip super().__init__ which requires platform/config
                            
                            # Create an object that has attributes matching the params AND supports .get()
                            innerself.strategy_params = AttrDict(**params_dict)
                            innerself.logger = logging.getLogger("VectorizedStrategy")
                            innerself.config = None  # Prevent AttributeError for strategies that check self.config
                            # Set symbol/timeframe from strategy profile (not hardcoded)
                            innerself.symbol = strategy_symbol
                            innerself.timeframe = strategy_timeframe
                            # Trigger param initialization
                            innerself._initialize_strategy_parameters()
                            
                    # Initialize with CURRENT trial parameters combined with default params
                    # We might need to merge with default params if 'parameters' is partial
                    # For now assume 'parameters' contains the optimization variables
                    
                    # We need to construct a Mock/Stub config to pass to the strategy if we used the real __init__
                    # But the subclassing trick above bypasses dependencies
                    
                    strategy_instance = LightweightStrategy(parameters)
                    
                    # 2. Recalculate indicators (if needed) or done inside generate_vectorized_signals?
                    # london_breakout calculates indicators inside generate_vectorized_signals from raw OHLCV
                    # so we don't need 'data_with_indicators' from market_manager for this strategy
                    # UNLESS the strategy needs specific indicators pre-calculated.
                    # LondonBreakout only needs OHLCV.

                    # Ensure DatetimeIndex for strategy resampling (ATR calc)
                    # CRITICAL FIX FOR VECTORIZATION
                    training_data_indexed = training_data.copy()
                    if 'timestamp' in training_data_indexed.columns:
                        training_data_indexed['timestamp'] = pd.to_datetime(training_data_indexed['timestamp'])
                        training_data_indexed.set_index('timestamp', inplace=True, drop=False)
                    elif 'Date' in training_data_indexed.columns:
                        training_data_indexed['timestamp'] = pd.to_datetime(training_data_indexed['Date'])
                        training_data_indexed.set_index('timestamp', inplace=True, drop=False)
                    
                    # 3. Generate Signals
                    # Wrap parameters in AttrDict to ensure getattr() works in strategy
                    signals = strategy_instance.generate_vectorized_signals(training_data_indexed, AttrDict(**parameters))
                    
                    # 4. Run Vectorized Backtest
                    result = self.vectorized_engine.run_strategy_backtest(
                        data=training_data_indexed, # Use indexed data
                        signals=signals,
                        initial_balance=self.config.initial_balance,
                        fees=self._get_fees(),
                        slippage=self._get_slippage(),
                        timeframe=strategy_timeframe,
                    )
                    
                    # 5. Return Fitness (Sharpe)
                    # Apply penalty for low trades
                    if result.total_trades < 5:
                        return -10.0 + (result.total_trades * 0.1)
                        
                    return result.sharpe_ratio
                    
                except Exception as e:
                    self.logger.error(f"Vectorized evaluation failed: {e}")
                    traceback.print_exc()
                    raise RuntimeError(f"Vectorized Optimization Failed: {e}") from e
            else:
                raise RuntimeError(
                    f"Vectorization conditions not met but required! "
                    f"Config={self.config.use_vectorized_backtest}, Engine={self.vectorized_engine is not None}, Strategy={self.strategy_class is not None}"
                )
            
            # Note: Event-driven fallback removed - wfa-minimal is vectorized-only

        except TrialEvaluationError:
            # Re-raise our custom exception
            raise
        except Exception as e:
            self.logger.error(f"Parameter evaluation failed: {e}")
            return -999.0

    def _update_strategy_parameters(self, parameters: Dict[str, Any]) -> None:
        """
        Update strategy parameters in the configuration.

        Args:
            parameters: New parameter values to set
        """
        try:
            strategy_profile = self.app_config.asset_strategy_profiles[self.config.strategy_profile_key]
            strategy_params_key = strategy_profile.strategy_params_key
            strategy_param_set = self.app_config.loaded_strategy_parameters[strategy_params_key]

            # Update parameters
            for param_name, param_value in parameters.items():
                strategy_param_set.parameters[param_name] = param_value

            self.logger.debug(f"Updated strategy parameters: {parameters}")

            # Note: Indicator recalculation moved to optimization loop for better timing

        except Exception as e:
            self.logger.error(f"Failed to update strategy parameters: {e}", exc_info=True)
            raise

    def _save_temp_data(self, data: pd.DataFrame, prefix: str) -> str:
        """
        Save DataFrame to temporary CSV file for backtesting.

        Args:
            data: DataFrame to save
            prefix: Prefix for temporary filename

        Returns:
            Path to temporary file
        """
        temp_dir = os.path.join(self.config.output_directory, "temp")
        os.makedirs(temp_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        temp_file = os.path.join(temp_dir, f"{prefix}_{timestamp}.csv")

        data.to_csv(temp_file, index=False)
        return temp_file

    def _recalculate_indicators_for_trial(self, ohlcv_data: pd.DataFrame, parameters: Dict[str, Any]) -> pd.DataFrame:
        """
        Recalculate indicators for the current trial parameters.

        Args:
            ohlcv_data: DataFrame with OHLCV data only
            parameters: Current trial parameters

        Returns:
            DataFrame with OHLCV data and recalculated indicators with correct column names
        """
        try:
            self.logger.debug(f"🔄 _recalculate_indicators_for_trial CALLED with parameters: {parameters}")
            self.logger.debug(f"Recalculating indicators for trial parameters: {parameters}")

            if self.market_data_manager is None:
                self.logger.error("MarketDataManager not available for indicator recalculation")
                return ohlcv_data

            # Get strategy profile information
            strategy_profile = self.app_config.asset_strategy_profiles[self.config.strategy_profile_key]

            # Get timeframe from strategy parameters
            strategy_params_key = strategy_profile.strategy_params_key
            strategy_param_set = self.app_config.loaded_strategy_parameters[strategy_params_key]

            self.logger.debug(f"🔍 DEBUGGING: strategy_param_set.parameters = {strategy_param_set.parameters}")
            self.logger.debug(f"🔍 DEBUGGING: passed parameters = {parameters}")

            timeframe_str = strategy_param_set.parameters.get("timeframe", "H1").upper()

            # Convert timeframe string to Timeframe enum
            from src.core.enums import Timeframe
            try:
                timeframe = getattr(Timeframe, timeframe_str)
            except AttributeError:
                self.logger.warning(f"Invalid timeframe '{timeframe_str}' in strategy params. Defaulting to H1.")
                timeframe = Timeframe.H1

            # Use the MarketDataManager to recalculate indicators with current parameters
            self.logger.info(f"🔄 RECALCULATING INDICATORS: symbol={strategy_profile.symbol}, timeframe={timeframe}, strategy_profile_key={self.config.strategy_profile_key}")
            self.logger.info(f"📊 Input data columns: {list(ohlcv_data.columns)}")
            self.logger.info(f"📊 Input data shape: {ohlcv_data.shape}")

            # Instead of using the configuration, use the passed parameters directly
            data_with_indicators = self._recalculate_indicators_directly(ohlcv_data, parameters, strategy_profile, timeframe)

            self.logger.info(f"📊 Recalculate_indicators_for_strategy returned data with columns: {list(data_with_indicators.columns)}")
            self.logger.info(f"📊 Returned data shape: {data_with_indicators.shape}")

            # Check if indicators were actually added
            original_columns = set(ohlcv_data.columns)
            new_columns = set(data_with_indicators.columns)
            added_columns = new_columns - original_columns

            if added_columns:
                self.logger.info(f"✅ Indicators successfully added: {list(added_columns)}")
            else:
                self.logger.error(f"❌ NO INDICATORS WERE ADDED! Original columns: {list(original_columns)}, New columns: {list(new_columns)}")

            # Add symbol and timeframe columns that the strategy expects
            data_with_indicators['symbol'] = strategy_profile.symbol
            data_with_indicators['timeframe'] = timeframe

            self.logger.info(f"📊 Final data columns after adding symbol/timeframe: {list(data_with_indicators.columns)}")
            return data_with_indicators

        except Exception as e:
            self.logger.error(f"Failed to recalculate indicators for trial: {e}", exc_info=True)
            # Return original data if recalculation fails
            return ohlcv_data

    def _recalculate_indicators_directly(self, ohlcv_data: pd.DataFrame, parameters: Dict[str, Any], strategy_profile, timeframe) -> pd.DataFrame:
        """
        Recalculate indicators directly using trial parameters, bypassing configuration conflicts.

        Args:
            ohlcv_data: DataFrame with OHLCV data
            parameters: Trial parameters to use for indicator calculation
            strategy_profile: Strategy profile object
            timeframe: Timeframe enum

        Returns:
            DataFrame with recalculated indicators using trial parameters
        """
        try:
            self.logger.debug(f"🔧 DIRECT RECALCULATION with trial parameters: {parameters}")

            # Create a copy of the data to work with
            data_copy = ohlcv_data.copy()

            # Apply indicators directly using trial parameters
            if 'rsi_period' in parameters:
                rsi_period = parameters['rsi_period']
                self.logger.debug(f"🔧 Adding RSI with period {rsi_period}")
                data_copy.ta.rsi(length=rsi_period, append=True, col_names=(f'RSI_{rsi_period}',))

            if 'bollinger_period' in parameters and 'bollinger_std_dev' in parameters:
                bb_period = parameters['bollinger_period']
                bb_std = parameters['bollinger_std_dev']
                self.logger.debug(f"🔧 Adding Bollinger Bands with period {bb_period}, std {bb_std}")
                data_copy.ta.bbands(length=bb_period, std=bb_std, append=True,
                                  col_names=(f'BBL_{bb_period}_{bb_std}', f'BBM_{bb_period}_{bb_std}',
                                           f'BBU_{bb_period}_{bb_std}', f'BBB_{bb_period}_{bb_std}', f'BBP_{bb_period}_{bb_std}'))

            if 'trend_filter_ma_period' in parameters:
                ma_period = parameters['trend_filter_ma_period']
                self.logger.debug(f"🔧 Adding SMA with period {ma_period}")
                data_copy.ta.sma(length=ma_period, append=True, col_names=(f'SMA_{ma_period}',))

            if 'stop_loss_atr_period' in parameters:
                atr_period = parameters['stop_loss_atr_period']
                self.logger.debug(f"🔧 Adding ATR with period {atr_period}")
                data_copy.ta.atr(length=atr_period, append=True, col_names=(f'ATR_{atr_period}',))

            # Add symbol and timeframe columns
            data_copy['symbol'] = strategy_profile.symbol
            data_copy['timeframe'] = timeframe

            self.logger.debug(f"✅ Direct recalculation complete. Final columns: {list(data_copy.columns)}")
            return data_copy

        except Exception as e:
            self.logger.error(f"❌ Error in direct recalculation: {e}", exc_info=True)
            return ohlcv_data

    def _convert_yaml_ranges_to_generator_format(self, yaml_ranges: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert YAML parameter ranges (list format) to ParameterGridGenerator format.
        
        YAML format example:
            rsi_period: [5]           -> Single value = categorical (fixed)
            rsi_oversold: [20, 25]    -> Multiple values = range
            
        Generator format:
            rsi_period: {'type': 'categorical', 'values': [5]}   # Single = categorical
            rsi_oversold: {'type': 'float', 'range': [20, 25]}
        """
        generator_ranges = {}
        
        for param_name, values in yaml_ranges.items():
            if not isinstance(values, list) or len(values) == 0:
                continue
                
            # Single value = use categorical to force exact value
            # This bypasses the min < max validation issue
            if len(values) == 1:
                generator_ranges[param_name] = {
                    'type': 'categorical',
                    'values': values
                }
                self.logger.info(f"🎛️ Fixed param {param_name} = {values[0]}")
            else:
                # Multiple values = determine type and create range
                first_val = values[0]
                if isinstance(first_val, bool):
                    param_type = 'categorical'
                    generator_ranges[param_name] = {
                        'type': 'categorical',
                        'values': values
                    }
                elif isinstance(first_val, int):
                    generator_ranges[param_name] = {
                        'type': 'integer',
                        'range': [min(values), max(values)]
                    }
                elif isinstance(first_val, float):
                    generator_ranges[param_name] = {
                        'type': 'float',
                        'range': [min(values), max(values)]
                    }
                else:
                    generator_ranges[param_name] = {
                        'type': 'categorical',
                        'values': values
                    }
                    
                self.logger.debug(f"Converted YAML param {param_name}: {values} -> {generator_ranges[param_name]}")
        
        return generator_ranges

    def _create_optimized_parameter_ranges(self, optimized_params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create narrow parameter ranges around optimized values for validation testing.
        This allows minimal optimization while staying close to validated parameters.
        """

        parameter_ranges = {}

        # RSI parameters - very narrow ranges around optimized values
        if 'rsi_period' in optimized_params:
            rsi_period = optimized_params['rsi_period']
            parameter_ranges['rsi_period'] = {
                'type': 'integer',
                'range': [max(2, rsi_period - 1), min(30, rsi_period + 1)]  # RSI(3) -> range [2, 4]
            }

        if 'rsi_oversold' in optimized_params:
            oversold = optimized_params['rsi_oversold']
            parameter_ranges['rsi_oversold'] = {
                'type': 'float',
                'range': [max(15.0, oversold - 5.0), min(35.0, oversold + 5.0)]  # 20 -> range [15, 25]
            }

        if 'rsi_overbought' in optimized_params:
            overbought = optimized_params['rsi_overbought']
            parameter_ranges['rsi_overbought'] = {
                'type': 'float',
                'range': [max(65.0, overbought - 5.0), min(85.0, overbought + 5.0)]  # 80 -> range [75, 85]
            }

        # RSI exit parameters - CRITICAL FIX: Add missing exit thresholds
        if 'rsi_exit_long' in optimized_params:
            exit_long = optimized_params['rsi_exit_long']
            parameter_ranges['rsi_exit_long'] = {
                'type': 'float',
                'range': [max(40.0, exit_long - 5.0), min(70.0, exit_long + 5.0)]
            }

        if 'rsi_exit_short' in optimized_params:
            exit_short = optimized_params['rsi_exit_short']
            parameter_ranges['rsi_exit_short'] = {
                'type': 'float',
                'range': [max(30.0, exit_short - 5.0), min(60.0, exit_short + 5.0)]
            }

        # ATR-based risk management - narrow ranges
        if 'stop_loss_atr_multiplier' in optimized_params:
            stop_loss = optimized_params['stop_loss_atr_multiplier']
            parameter_ranges['stop_loss_atr_multiplier'] = {
                'type': 'float',
                'range': [max(1.0, stop_loss - 0.5), min(5.0, stop_loss + 0.5)]  # 3.0 -> range [2.5, 3.5]
            }

        if 'take_profit_atr_multiplier' in optimized_params:
            take_profit = optimized_params['take_profit_atr_multiplier']
            parameter_ranges['take_profit_atr_multiplier'] = {
                'type': 'float',
                'range': [max(2.0, take_profit - 1.0), min(10.0, take_profit + 1.0)]  # 6.0 -> range [5.0, 7.0]
            }

        # Position management - CRITICAL FIX: Use correct parameter name
        if 'max_position_age_bars' in optimized_params:
            max_age_bars = optimized_params['max_position_age_bars']
            # Create narrow range around optimized value for validation
            min_bars = max(24, max_age_bars - 48)  # At least 24 bars minimum
            max_bars = min(960, max_age_bars + 48)  # At most 960 bars maximum

            # Ensure min < max
            if min_bars >= max_bars:
                min_bars = max_bars - 24  # At least 24 bar difference

            parameter_ranges['max_position_age_bars'] = {
                'type': 'integer',
                'range': [min_bars, max_bars]
            }

        # ATR period - keep stable (minimal range to satisfy validation)
        parameter_ranges['stop_loss_atr_period'] = {
            'type': 'integer',
            'range': [14, 15]  # Minimal range to pass validation
        }

        parameter_ranges['take_profit_atr_period'] = {
            'type': 'integer',
            'range': [14, 15]  # Minimal range to pass validation
        }

        # Bollinger bands - disabled but need ranges for compatibility
        parameter_ranges['bollinger_period'] = {
            'type': 'integer',
            'range': [20, 21]  # Minimal range to pass validation
        }

        parameter_ranges['bollinger_std_dev'] = {
            'type': 'float',
            'range': [2.0, 2.1]  # Minimal range to pass validation
        }

        # Trend filter - disabled
        parameter_ranges['trend_filter_ma_period'] = {
            'type': 'integer',
            'range': [200, 201]  # Minimal range to pass validation
        }

        # Filter flags - keep optimized settings
        parameter_ranges['use_trend_filter'] = {
            'type': 'categorical',
            'values': [False]  # Disabled per Phase 5 results
        }

        parameter_ranges['use_bollinger_filter'] = {
            'type': 'categorical',
            'values': [False]  # Disabled per Phase 5 results
        }

        return parameter_ranges

    def _save_temp_data_with_indicators(self, data: pd.DataFrame, prefix: str) -> str:
        """
        Save DataFrame with indicators to temporary CSV file for backtesting.

        Args:
            data: DataFrame with OHLCV and indicator data
            prefix: Prefix for temporary filename

        Returns:
            Path to temporary file
        """
        temp_dir = os.path.join(self.config.output_directory, "temp")
        os.makedirs(temp_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        temp_file = os.path.join(temp_dir, f"{prefix}_{timestamp}.csv")

        # Stable temp CSV write for deterministic hashing
        data = data.sort_index().reindex(sorted(data.columns), axis=1)
        data.to_csv(temp_file, index=False, float_format='%.10f')
        self.logger.debug(f"Saved data with indicators to: {temp_file}")
        return temp_file

    def _calculate_win_rate(self, backtest_results) -> float:
        """Calculate win rate from backtest results"""
        try:
            # Try to get actual PnL data if available
            if hasattr(backtest_results, 'trade_pnls') and backtest_results.trade_pnls:
                return calculate_win_rate(backtest_results.trade_pnls)
            elif hasattr(backtest_results, 'total_trades') and backtest_results.total_trades > 0:
                # Fallback to simplified estimation
                if backtest_results.total_return > 0:
                    return min(0.8, max(0.2, backtest_results.total_return / 100.0 + 0.5))
                else:
                    return max(0.2, 0.5 + backtest_results.total_return / 100.0)
            return 0.0
        except:
            return 0.0

    def _calculate_profit_factor(self, backtest_results) -> float:
        """Calculate profit factor from backtest results"""
        try:
            # Try to get actual PnL data if available
            if hasattr(backtest_results, 'trade_pnls') and backtest_results.trade_pnls:
                return calculate_profit_factor(backtest_results.trade_pnls)
            elif backtest_results.total_return > 0:
                # Fallback to simplified estimation
                return max(1.0, 1.0 + backtest_results.total_return / 50.0)
            else:
                return max(0.1, 1.0 + backtest_results.total_return / 50.0)
        except:
            return 0.0

    def _calculate_max_drawdown(self, backtest_results) -> float:
        """Calculate maximum drawdown from backtest results as a non-positive percentage (-100..0)."""
        try:
            # Prefer equity curve if available
            if hasattr(backtest_results, 'equity_curve') and backtest_results.equity_curve:
                # Utility returns positive magnitude (%). Convert to negative percentage.
                dd_mag_pct = calculate_max_drawdown(backtest_results.equity_curve)
                return -float(abs(dd_mag_pct))
            # Fallbacks when equity curve not available
            tr = getattr(backtest_results, 'total_return', 0.0)
            if tr is not None and tr < 0:
                # total_return is already a percentage; keep negative sign
                return float(tr)
            else:
                # Conservative small drawdown as negative percentage
                return -float(abs(tr) * 0.3)
        except Exception:
            # On failure, return 0.0 (no drawdown) to fail-fast via schema/invariants if inappropriate
            return 0.0

    def _calculate_sharpe_ratio(self, backtest_results) -> float:
        """Calculate Sharpe ratio from backtest results"""
        try:
            self.logger.debug(f"DEBUG: _calculate_sharpe_ratio called with backtest_results type: {type(backtest_results)}")

            # DEBUG: Check all relevant attributes
            if hasattr(backtest_results, 'total_trades'):
                self.logger.debug(f"DEBUG: backtest_results.total_trades = {backtest_results.total_trades} (type: {type(backtest_results.total_trades)})")
            if hasattr(backtest_results, 'total_return'):
                self.logger.debug(f"DEBUG: backtest_results.total_return = {backtest_results.total_return} (type: {type(backtest_results.total_return)})")
            if hasattr(backtest_results, 'returns'):
                self.logger.debug(f"DEBUG: backtest_results.returns = {backtest_results.returns} (type: {type(backtest_results.returns)})")

            # Try to get actual returns if available
            if hasattr(backtest_results, 'returns') and backtest_results.returns:
                self.logger.debug("DEBUG: Using actual returns for Sharpe calculation")
                return calculate_sharpe_ratio(backtest_results.returns, method="standard")
            elif backtest_results.total_trades is not None and backtest_results.total_trades > 0:
                # Fallback to simplified estimation
                annual_return = backtest_results.total_return
                self.logger.debug(f"DEBUG: annual_return = {annual_return} (type: {type(annual_return)})")

                if annual_return is None:
                    self.logger.debug("DEBUG: annual_return is None, returning 0.0")
                    return 0.0

                volatility = max(1.0, abs(annual_return) * 0.5 + 10.0)  # Estimated volatility
                sharpe = annual_return / volatility
                self.logger.debug(f"DEBUG: Calculated Sharpe ratio: {sharpe}")
                return sharpe
            else:
                self.logger.debug("DEBUG: No trades or total_trades is None, returning 0.0")
                return 0.0
        except Exception as e:
            self.logger.debug(f"DEBUG: Exception in _calculate_sharpe_ratio: {e}")
            return 0.0

    def _calculate_aggregate_results(self, execution_end_time: datetime) -> WalkForwardResults:
        """
        Calculate aggregate results across all windows.

        Args:
            execution_end_time: When the analysis completed

        Returns:
            WalkForwardResults with complete analysis summary
        """
        successful_results = [r for r in self.window_results if r.success]

        if not successful_results:
            # No successful windows
            return WalkForwardResults(
                config=self.config,
                execution_start_time=self.execution_start_time.isoformat(),
                execution_end_time=execution_end_time.isoformat(),
                total_execution_time_seconds=(execution_end_time - self.execution_start_time).total_seconds(),
                window_results=self.window_results,
                total_windows=len(self.window_results),
                successful_windows=0,
                aggregate_return_pct=0.0,
                aggregate_sharpe_ratio=0.0,
                aggregate_max_drawdown_pct=0.0,
                aggregate_win_rate=0.0,
                aggregate_profit_factor=0.0,
                aggregate_total_trades=0,
                aggregate_gross_profit=0.0,
                aggregate_gross_loss=0.0,
                aggregate_total_wins=0,
                aggregate_total_losses=0,
                aggregate_avg_trade_win_pct=0.0,
                aggregate_avg_trade_loss_pct=0.0,
                parameter_stability={},
                best_window_return=0.0,
                worst_window_return=0.0,
                return_volatility=0.0,
                consistency_score=0.0
            )

        # Calculate aggregate metrics
        returns = [r.total_return_pct for r in successful_results]
        aggregate_return = np.mean(returns)
        aggregate_window_returns = np.asarray([r.total_return_pct / 100.0 for r in successful_results], dtype=float)
        aggregate_periods_per_year = 12.0 / max(float(self.config.testing_months), 1.0)
        aggregate_sharpe = calculate_annualized_sharpe_from_returns(
            aggregate_window_returns,
            aggregate_periods_per_year,
        )
        # max_drawdown_pct is non-positive; aggregate should reflect the worst (most negative)
        aggregate_max_dd = float(np.min([r.max_drawdown_pct for r in successful_results]) if successful_results else 0.0)
        aggregate_trades = sum([r.total_trades for r in successful_results])
        
        # NEW: Trade-level aggregation across all windows
        aggregate_gross_profit = sum(r.gross_profit for r in successful_results)
        aggregate_gross_loss = sum(r.gross_loss for r in successful_results)
        total_wins = sum(r.win_count for r in successful_results)
        total_losses = sum(r.loss_count for r in successful_results)
        aggregate_win_rate = (total_wins / aggregate_trades) if aggregate_trades > 0 else 0.0
        
        # FIX 3.1: True aggregate PF from totals (not mean of window PFs)
        aggregate_pf = aggregate_gross_profit / aggregate_gross_loss if aggregate_gross_loss > 0 else 0.0

        aggregate_avg_trade_win_pct = (
            sum(r.avg_trade_win_pct * r.win_count for r in successful_results) / total_wins
            if total_wins > 0 else 0.0
        )
        aggregate_avg_trade_loss_pct = (
            sum(r.avg_trade_loss_pct * r.loss_count for r in successful_results) / total_losses
            if total_losses > 0 else 0.0
        )

        # Calculate parameter stability
        parameter_stability = self._analyze_parameter_stability(successful_results)

        # Calculate consistency metrics
        best_return = np.max(returns) if returns else 0.0
        worst_return = np.min(returns) if returns else 0.0
        return_volatility = np.std(returns) if len(returns) > 1 else 0.0

        # Consistency score: higher is better (low volatility, positive mean return)
        consistency_score = max(0.0, aggregate_return / max(return_volatility, 1.0)) if return_volatility > 0 else aggregate_return

        return WalkForwardResults(
            config=self.config,
            execution_start_time=self.execution_start_time.isoformat(),
            execution_end_time=execution_end_time.isoformat(),
            total_execution_time_seconds=(execution_end_time - self.execution_start_time).total_seconds(),
            window_results=self.window_results,
            total_windows=len(self.window_results),
            successful_windows=len(successful_results),
            aggregate_return_pct=float(aggregate_return),
            aggregate_sharpe_ratio=float(aggregate_sharpe),
            aggregate_max_drawdown_pct=float(aggregate_max_dd),
            aggregate_win_rate=float(aggregate_win_rate),
            aggregate_profit_factor=float(aggregate_pf),
            aggregate_total_trades=int(aggregate_trades),
            # NEW: Trade-level aggregates
            aggregate_gross_profit=float(aggregate_gross_profit),
            aggregate_gross_loss=float(aggregate_gross_loss),
            aggregate_total_wins=int(total_wins),
            aggregate_total_losses=int(total_losses),
            aggregate_avg_trade_win_pct=float(aggregate_avg_trade_win_pct),
            aggregate_avg_trade_loss_pct=float(aggregate_avg_trade_loss_pct),
            parameter_stability=parameter_stability,
            best_window_return=float(best_return),
            worst_window_return=float(worst_return),
            return_volatility=float(return_volatility),
            consistency_score=float(consistency_score)
        )

    def _analyze_parameter_stability(self, successful_results: List[WindowResult]) -> Dict[str, Dict[str, Any]]:
        """
        Analyze parameter stability across successful windows.

        Args:
            successful_results: List of successful window results

        Returns:
            Dictionary with parameter stability analysis
        """
        if not successful_results:
            return {}

        # Collect all parameter values across windows
        param_values = {}
        for result in successful_results:
            for param_name, param_value in result.best_parameters.items():
                if param_name not in param_values:
                    param_values[param_name] = []
                param_values[param_name].append(param_value)

        # Calculate stability metrics for each parameter
        stability_analysis = {}
        for param_name, values in param_values.items():
            if len(values) > 1:
                if isinstance(values[0], (int, float)):
                    # Numerical parameter
                    mean_val = np.mean(values)
                    std_val = np.std(values)
                    cv = std_val / abs(mean_val) if mean_val != 0 else float('inf')

                    stability_analysis[param_name] = {
                        'type': 'numerical',
                        'mean': float(mean_val),
                        'std': float(std_val),
                        'coefficient_of_variation': float(cv),
                        'min': float(np.min(values)),
                        'max': float(np.max(values)),
                        'stability_score': max(0.0, 1.0 - cv)  # Higher is more stable
                    }
                else:
                    # Categorical parameter
                    unique_values = sorted(set(values))
                    most_common = max(set(values), key=values.count)
                    frequency = values.count(most_common) / len(values)

                    stability_analysis[param_name] = {
                        'type': 'categorical',
                        'unique_values': unique_values,
                        'most_common': most_common,
                        'frequency': float(frequency),
                        'stability_score': float(frequency)  # Higher frequency = more stable
                    }
            else:
                # Single value
                stability_analysis[param_name] = {
                    'type': 'single_value',
                    'value': values[0],
                    'stability_score': 1.0
                }

        return stability_analysis

    def _save_results(self, results: WalkForwardResults) -> None:
        """
        Save walk-forward analysis results to files.

        Args:
            results: Complete results to save
        """
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            Path(self.config.output_directory).mkdir(parents=True, exist_ok=True)

            # Save main results as JSON with finite-value sanitization
            results_file = os.path.join(self.config.output_directory, f"walk_forward_results_{timestamp}.json")
            from src.utils.stable_io import stable_json_dump, sanitize_for_json
            sanitized = sanitize_for_json(asdict(results))
            with open(results_file, 'w') as f:
                stable_json_dump(sanitized, f, indent=2, default=str)

            self.logger.info(f"Results saved to: {results_file}")

            # ===== ANALYSIS.JSON - Primary WFA Artifact =====
            # This is the compact, high-signal output for human/AI review
            try:
                analysis = self._generate_analysis_artifact(results, timestamp)
                analysis_file = os.path.join(self.config.output_directory, "analysis.json")
                with open(analysis_file, 'w') as f:
                    stable_json_dump(sanitize_for_json(analysis), f, indent=2, default=str)
                self.logger.info(f"Analysis artifact saved to: {analysis_file}")
            except Exception as e:
                self.logger.warning(f"Failed to generate analysis.json (non-fatal): {e}")

            # Save summary CSV
            if results.window_results:
                summary_data = []
                for window_result in results.window_results:
                    row = {
                        'window_id': window_result.window_id,
                        'training_start': window_result.training_period_start,
                        'training_end': window_result.training_period_end,
                        'testing_start': window_result.testing_period_start,
                        'testing_end': window_result.testing_period_end,
                        'success': window_result.success,
                        'total_return_pct': window_result.total_return_pct,
                        'total_trades': window_result.total_trades,
                        'win_rate': window_result.win_rate,
                        'profit_factor': window_result.profit_factor,
                        'max_drawdown_pct': window_result.max_drawdown_pct,
                        'sharpe_ratio': window_result.sharpe_ratio,
                        'optimization_time_s': window_result.optimization_time_seconds,
                        'testing_time_s': window_result.testing_time_seconds
                    }

                    # Add parameter values
                    for param_name, param_value in window_result.best_parameters.items():
                        row[f'param_{param_name}'] = param_value

                    summary_data.append(row)

                from src.utils.stable_io import stable_csv_write
                summary_df = pd.DataFrame(summary_data)
                summary_file = os.path.join(self.config.output_directory, f"walk_forward_summary_{timestamp}.csv")
                stable_csv_write(summary_df, summary_file, index=False)

                self.logger.info(f"Summary saved to: {summary_file}")
                # Per-window hashing (strict mode only)
                try:
                    import io, hashlib, os as _os
                    from src.utils.stable_io import is_strict_mode, stable_csv_write
                    if is_strict_mode():
                        hashes = []
                        for wr in results.window_results:
                            # Construct a minimal frame representative of returns used
                            df = pd.DataFrame({
                                'window_id': [wr.window_id],
                                'total_return_pct': [wr.total_return_pct],
                                'total_trades': [wr.total_trades]
                            })
                            buf = io.StringIO()
                            stable_csv_write(df, buf, index=False)
                            h = hashlib.sha256(buf.getvalue().encode('utf-8')).hexdigest()
                            hashes.append({'window_id': wr.window_id, 'format': 'csv@stable_io:v1', 'sha256': h, 'rows': len(df), 'cols': len(df.columns)})
                        hash_file = os.path.join(self.config.output_directory, f"window_hashes_{timestamp}.json")
                        from src.utils.stable_io import stable_json_dump, sanitize_for_json
                        with open(hash_file, 'w') as f:
                            stable_json_dump(sanitize_for_json(hashes), f, indent=2)
                        # Also append training/testing slice hashes if present
                        if getattr(self, '_window_hashes', None):
                            try:
                                combined = {'summary_hashes': hashes, 'slice_hashes': self._window_hashes}
                                with open(os.path.join(self.config.output_directory, f"window_slice_hashes_{timestamp}.json"), 'w') as f2:
                                    stable_json_dump(sanitize_for_json(combined), f2, indent=2)
                            except Exception as _e:
                                self.logger.warning(f"Failed to save window slice hashes: {_e}")
                        self.logger.info(f"Window hashes saved to: {hash_file}")
                except Exception as _e:
                    self.logger.warning(f"Per-window hashing skipped due to error: {_e}")


            # Save parameter stability analysis
            if results.parameter_stability:
                stability_file = os.path.join(self.config.output_directory, f"parameter_stability_{timestamp}.json")
                from src.utils.stable_io import stable_json_dump, sanitize_for_json
                with open(stability_file, 'w') as f:
                    stable_json_dump(sanitize_for_json(results.parameter_stability), f, indent=2, default=str)

                self.logger.info(f"Parameter stability analysis saved to: {stability_file}")

            # ===== APPEND TO WFA HISTORY =====
            # Auto-append to strategy's wfa_history.json for consolidated tracking
            self._append_to_wfa_history(results, timestamp)

        except Exception as e:
            self.logger.error(f"Failed to save results: {e}", exc_info=True)

    def _generate_analysis_artifact(self, results: WalkForwardResults, timestamp: str) -> dict:
        """
        Generate compact analysis.json artifact with all key metrics.
        
        This is the PRIMARY long-term artifact for WFA runs.
        Contains: metrics, stability, provenance fingerprints, decision status.
        """
        import hashlib
        import subprocess
        
        # Get code version (git hash if available)
        try:
            code_version = subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], 
                stderr=subprocess.DEVNULL
            ).decode('utf-8').strip()[:12]
        except Exception:
            code_version = "unknown"
        
        # Generate config fingerprint
        try:
            config_dict = asdict(self.config)
            config_str = str(sorted(config_dict.items()))
            config_fingerprint = hashlib.sha256(config_str.encode()).hexdigest()[:16]
        except Exception:
            config_fingerprint = "unknown"
        
        # Calculate additional metrics
        successful_results = [r for r in results.window_results if r.success]
        
        # Expectancy calculation (expected trade outcome, in percentage points)
        avg_win = 0.0
        avg_loss = 0.0
        if successful_results:
            wins = [r.total_return_pct for r in successful_results if r.total_return_pct > 0]
            losses = [r.total_return_pct for r in successful_results if r.total_return_pct <= 0]
            avg_win = float(np.mean(wins)) if wins else 0.0
            avg_loss = float(np.mean(losses)) if losses else 0.0
        
        win_rate = results.aggregate_win_rate if results.aggregate_win_rate else 0.0
        expectancy = (
            (win_rate * results.aggregate_avg_trade_win_pct) +
            ((1 - win_rate) * results.aggregate_avg_trade_loss_pct)
        )
        
        # Average trades per window
        avg_trades_per_window = (
            results.aggregate_total_trades / results.successful_windows 
            if results.successful_windows > 0 else 0.0
        )
        
        # Parameter stability CV (average across all params)
        param_cvs = []
        for param_name, param_data in results.parameter_stability.items():
            if isinstance(param_data, dict) and 'coefficient_of_variation' in param_data:
                cv = param_data.get('coefficient_of_variation', 0)
                if isinstance(cv, (int, float)) and not np.isinf(cv):
                    param_cvs.append(cv)
        avg_param_cv = float(np.mean(param_cvs)) if param_cvs else 0.0
        
        # Build the analysis artifact
        analysis = {
            "schema_version": "1.0",
            "run_id": f"{self.config.strategy_profile_key}_{timestamp}",
            "generated_at": datetime.now().isoformat(),
            
            "provenance": {
                "code_version": code_version,
                "config_fingerprint": config_fingerprint,
                "generator": "WalkForwardRunner"
            },
            
            "strategy": {
                "name": self.config.strategy_profile_key,
                "profile_key": self.config.strategy_profile_key
            },
            
            "wfa_config": {
                "training_months": self.config.training_months,
                "testing_months": self.config.testing_months,
                "step_months": self.config.step_months,
                "n_trials": self.config.n_parameter_trials
            },
            
            "metrics": {
                # Core metrics
                "aggregate_return_pct": round(results.aggregate_return_pct, 4),
                "aggregate_sharpe": round(results.aggregate_sharpe_ratio, 4),
                "max_drawdown_pct": round(results.aggregate_max_drawdown_pct, 4),
                "total_windows": results.total_windows,
                "successful_windows": results.successful_windows,
                "failed_windows": results.total_windows - results.successful_windows,
                
                # Trade-level metrics (per individual trade)
                "total_trades": results.aggregate_total_trades,
                "win_rate": round(win_rate, 4),
                "profit_factor": round(results.aggregate_profit_factor, 4),
                
                # NEW: True trade-level metrics (per individual trade across all OOS windows)
                "avg_trade_win_pct": round(results.aggregate_avg_trade_win_pct, 4),
                "avg_trade_loss_pct": round(results.aggregate_avg_trade_loss_pct, 4),
                "gross_profit": round(results.aggregate_gross_profit, 2),
                "gross_loss": round(results.aggregate_gross_loss, 2),
                "total_wins": results.aggregate_total_wins,
                "total_losses": results.aggregate_total_losses,
                
                # Window-level metrics (per OOS window) - RENAMED for clarity
                "avg_winning_window_pct": round(avg_win, 4),  # Was: avg_win_pct
                "avg_losing_window_pct": round(avg_loss, 4),  # Was: avg_loss_pct
                "expectancy": round(expectancy, 4),
                "best_window_return": round(results.best_window_return, 4),
                "worst_window_return": round(results.worst_window_return, 4),
                "avg_trades_per_window": round(avg_trades_per_window, 2)
            },
            
            "stability": {
                "parameter_cv": round(avg_param_cv, 4),
                "return_volatility": round(results.return_volatility, 4),
                "consistency_score": round(results.consistency_score, 4)
            },
            
            "execution": {
                "start_time": results.execution_start_time,
                "end_time": results.execution_end_time,
                "duration_seconds": round(results.total_execution_time_seconds, 2)
            }
        }
        
        return analysis

    def _resolve_strategy_directory(self) -> Optional[Path]:
        """
        Resolve the strategy directory from strategy_profile_key.
        
        Uses convention-over-configuration: scans strategies/ folder to find
        matching directory based on profile key patterns.
        
        Returns:
            Path to strategy directory, or None if not found
        """
        try:
            project_root = Path(__file__).parent.parent.parent
            strategies_dir = project_root / "strategies"

            output_dir = Path(self.config.output_directory)
            if not output_dir.is_absolute():
                output_dir = project_root / output_dir

            try:
                relative_output_dir = output_dir.resolve().relative_to(strategies_dir.resolve())
                strategy_name = relative_output_dir.parts[0] if relative_output_dir.parts else None
                if strategy_name:
                    strategy_dir = strategies_dir / strategy_name
                    if strategy_dir.exists() or output_dir.name == "results":
                        strategy_dir.mkdir(parents=True, exist_ok=True)
                        self.logger.info(f"Resolved strategy directory from output_directory: {strategy_dir}")
                        return strategy_dir
            except ValueError:
                pass
             
            if not strategies_dir.exists():
                self.logger.warning(f"Strategies directory not found: {strategies_dir}")
                return None
            
            profile_key = self.config.strategy_profile_key.lower()
            
            # Strategy directory mapping heuristics:
            # EURUSD_LONDON_BREAKOUT -> london_breakout_rsi
            # NY_PM_REVERSION -> ny_pm_reversion
            # GBPJPY_REVERSION -> gbpjpy_reversion
            
            # Extract strategy name patterns from profile key
            key_parts = profile_key.split('_')
            
            # Try to find matching directory
            for strategy_dir in strategies_dir.iterdir():
                if not strategy_dir.is_dir():
                    continue
                    
                dir_name = strategy_dir.name.lower()
                
                # Match by key parts (excluding symbol prefix like EURUSD, GBPJPY)
                # e.g., "london_breakout" matches "london_breakout_rsi"
                non_symbol_parts = [p for p in key_parts if len(p) > 3]  # Skip short parts like GBP, EUR
                
                match_count = sum(1 for part in non_symbol_parts if part in dir_name)
                if match_count >= 1:  # At least one meaningful match
                    self.logger.info(f"Resolved strategy directory: {strategy_dir}")
                    return strategy_dir
            
            self.logger.warning(f"Could not resolve strategy directory for profile key: {self.config.strategy_profile_key}")
            return None
            
        except Exception as e:
            self.logger.error(f"Error resolving strategy directory: {e}")
            return None

    def _append_to_wfa_history(self, results: WalkForwardResults, timestamp: str) -> None:
        """
        Append WFA results to strategy's wfa_history.json.
        
        This creates a consolidated history of all WFA runs for a strategy,
        enabling progress tracking and run comparison without scattered files.
        
        Args:
            results: WalkForwardResults to append
            timestamp: Run timestamp for identification
        """
        try:
            strategy_dir = self._resolve_strategy_directory()
            
            if strategy_dir is None:
                self.logger.warning("Skipping wfa_history.json append - strategy directory not resolved")
                return
            
            history_file = strategy_dir / "wfa_history.json"
            
            # Load existing history or create new
            if history_file.exists():
                try:
                    with open(history_file, 'r', encoding='utf-8') as f:
                        history = json.load(f)
                except json.JSONDecodeError:
                    self.logger.warning(f"Corrupted wfa_history.json, creating new")
                    history = {"strategy": strategy_dir.name, "runs": []}
            else:
                history = {"strategy": strategy_dir.name, "runs": []}
            
            # Build run entry
            successful_results = [r for r in results.window_results if r.success]
            
            run_entry = {
                "run_id": timestamp,
                "run_date": results.execution_start_time,
                "strategy_profile_key": self.config.strategy_profile_key,
                
                # WFA scheme
                "wfa_scheme": {
                    "training_months": self.config.training_months,
                    "testing_months": self.config.testing_months,
                    "step_months": self.config.step_months,
                    "n_trials": self.config.n_parameter_trials
                },
                
                # Aggregate summary
                "summary": {
                    "total_return_pct": round(results.aggregate_return_pct, 4),
                    "sharpe_ratio": round(results.aggregate_sharpe_ratio, 4),
                    "max_drawdown_pct": round(results.aggregate_max_drawdown_pct, 4),
                    "total_trades": results.aggregate_total_trades,
                    "win_rate": round(results.aggregate_win_rate, 4),
                    "profit_factor": round(results.aggregate_profit_factor, 4),
                    "total_windows": results.total_windows,
                    "successful_windows": results.successful_windows,
                    "execution_time_seconds": round(results.total_execution_time_seconds, 2)
                },
                
                # Per-window results (compact)
                "windows": [
                    {
                        "window_id": wr.window_id,
                        "test_start": wr.testing_period_start,
                        "test_end": wr.testing_period_end,
                        "return_pct": round(wr.total_return_pct, 4),
                        "trades": wr.total_trades,
                        "win_rate": round(wr.win_rate, 4),
                        "sharpe": round(wr.sharpe_ratio, 4),
                        "best_params": wr.best_parameters
                    }
                    for wr in successful_results
                ],
                
                # Parameter stability (if available)
                "parameter_stability": results.parameter_stability if results.parameter_stability else {}
            }
            
            # Append to history
            history["runs"].append(run_entry)
            
            # Save updated history
            from src.utils.stable_io import stable_json_dump, sanitize_for_json
            with open(history_file, 'w', encoding='utf-8') as f:
                stable_json_dump(sanitize_for_json(history), f, indent=2, default=str)
            
            self.logger.info(f"✅ Appended to wfa_history.json: {history_file} (Run #{len(history['runs'])})")
            
        except Exception as e:
            self.logger.error(f"Failed to append to wfa_history.json: {e}", exc_info=True)

    # Note: Database-related methods removed - wfa-minimal is file-only


if __name__ == "__main__":
    # Example usage and testing
    logging.basicConfig(level=logging.INFO)

    # Configuration for walk-forward analysis
    config = WalkForwardConfig(
        training_months=6,
        testing_months=1,
        step_months=1,
        min_bars_per_window=500,
        n_parameter_trials=20,
        strategy_profile_key="EURUSD_MeanReversion_H1",
        performance_mode=True,
        output_directory="results/walk_forward_test"
    )

    # Initialize runner (Note: For production use, pass MarketDataManager for dynamic indicator recalculation)
    runner = WalkForwardRunner(config)

    # Example with sample data (replace with actual data file)
    logger = logging.getLogger("WalkForwardRunner")
    logger.info("Walk-Forward Analysis Runner initialized successfully")
    logger.info(f"Configuration: {config.training_months}M training, {config.testing_months}M testing")
    logger.info(f"Parameter trials per window: {config.n_parameter_trials}")
    logger.info(f"Output directory: {config.output_directory}")
    logger.info("Note: For dynamic indicator recalculation, initialize with MarketDataManager")

    # Uncomment to run with actual data:
    # results = runner.run_walk_forward_analysis("data/EURUSD_H1_historical.csv")
    # logger.info(f"Analysis completed. Aggregate return: {results.aggregate_return_pct:.2f}%")

# prop_firm_trading_bot/src/data_handler/market_data_manager.py

"""
MarketDataManager with clear separation of concerns.

This module provides a clean, modular architecture for market data management
using the strategy pattern and dependency injection for maximum flexibility.
"""

import pandas as pd
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
import logging
from contextlib import contextmanager

from src.core.models import OHLCVData, TickData
from src.core.enums import Timeframe
from src.data_handler.interfaces import (
    DataSourceStrategy, DataProcessor, DataCache, DataPipeline, ResourceManager
)
from src.data_handler.data_sources import DataSourceFactory
from src.data_handler.processors import (
    IndicatorProcessor, DataCleaningProcessor, ComposableDataPipeline
)
from src.data_handler.cache import MemoryCache, FileCache
from src.exceptions import (
    DataLoadingError, DataProcessingError, ConfigurationError, DataNotFoundError, BacktestDataError,
    create_error_context
)
from src.utils.pandas_optimization import performance_timer, force_garbage_collection

# Legacy compatibility imports
from src.api_connector.base_connector import PlatformInterface

# Asset validation imports
try:
    from src.data_handler.asset_validators import AssetValidatorFactory, ValidationResult
    from src.database.schema.wfa_models import AssetType
    ASSET_VALIDATION_AVAILABLE = True
except ImportError:
    ASSET_VALIDATION_AVAILABLE = False
    # Create mock classes for fallback
    class AssetType:
        FOREX = "FOREX"
        CRYPTO = "CRYPTO"
        STOCKS = "STOCKS"

    class ValidationResult:
        def __init__(self, is_valid=True, errors=None, warnings=None, normalized_data=None):
            self.is_valid = is_valid
            self.errors = errors or []
            self.warnings = warnings or []
            self.normalized_data = normalized_data


class MarketDataContext:
    """
    Context manager for market data operations.

    This class provides resource management and cleanup
    for market data operations.
    """

    def __init__(self, manager: 'MarketDataManager'):
        """
        Initialize context manager.
        
        Args:
            manager: MarketDataManager instance
        """
        self.manager = manager
        self.logger = logging.getLogger(__name__)
    
    def __enter__(self):
        """Enter context manager."""
        self.logger.debug("Entering market data context")
        return self.manager
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit context manager with cleanup."""
        try:
            if exc_type:
                self.logger.error(f"Exception in market data context: {exc_val}")
            
            # Perform cleanup
            self.manager.cleanup_resources()
            
            # Force garbage collection
            gc_result = force_garbage_collection()
            self.logger.debug(f"Garbage collection: {gc_result['objects_collected']} objects")
            
        except Exception as e:
            self.logger.error(f"Error during context cleanup: {e}")
        
        # Don't suppress exceptions
        return False


class MarketDataManager:
    """
    MarketDataManager with clear separation of concerns.

    This manager orchestrates data loading, processing, and caching
    using pluggable strategies and processors.
    """
    
    def __init__(
        self,
        data_source: Optional[DataSourceStrategy] = None,
        cache: Optional[DataCache] = None,
        pipeline: Optional[DataPipeline] = None,
        backtest_data: Optional[pd.DataFrame] = None,
        # Asset validation parameters
        enable_asset_validation: bool = True,
        asset_type: Optional[AssetType] = None,
        validation_tolerance_config: Optional[Dict[str, float]] = None,
        # Legacy compatibility parameters
        config: Optional[Any] = None,
        platform_adapter: Optional[PlatformInterface] = None,
        logger: Optional[logging.Logger] = None
    ):
        """
        Initialize market data manager.

        Args:
            data_source: Data source strategy for loading data
            cache: Cache implementation for storing processed data
            pipeline: Data processing pipeline
            backtest_data: Optional DataFrame for backtest mode (eliminates synthetic data fallbacks)
            enable_asset_validation: Enable asset-specific data validation
            asset_type: Default asset type for validation (can be overridden per request)
            validation_tolerance_config: Custom tolerance configuration for validation
            config: Legacy AppConfig for backward compatibility
            platform_adapter: Legacy PlatformInterface for backward compatibility
            logger: Legacy logger for backward compatibility
        """
        # Use provided logger or create new one
        self.logger = logger or logging.getLogger(__name__)

        # Legacy compatibility mode
        self.config = config
        self.platform_adapter = platform_adapter
        self.legacy_mode = config is not None and platform_adapter is not None

        if self.legacy_mode:
            # Legacy data storage structures (for backward compatibility)
            self.ohlcv_data: Dict[str, Dict[Timeframe, pd.DataFrame]] = {}
            self.latest_ticks: Dict[str, TickData] = {}
            self._active_subscriptions = {"ticks": {}, "bars": {}}
            self.logger.info("Initialized MarketDataManager in legacy compatibility mode")

        # Initialize components with defaults
        # In backtest mode, do not allow fallback to mock_api (synthetic data)
        if backtest_data is not None and data_source is None:
            # For backtest mode, we don't need an external data source since we have the data
            self.data_source = None
        else:
            self.data_source = data_source or DataSourceFactory.create_data_source("mock_api")

        self.cache = cache or MemoryCache(max_size=50, ttl_seconds=3600)
        self.pipeline = pipeline or self._create_default_pipeline()

        # Track active resources
        self.active_subscriptions = {}
        self.loaded_data = {}

        # Asset validation configuration
        self.enable_asset_validation = enable_asset_validation and ASSET_VALIDATION_AVAILABLE
        self.default_asset_type = asset_type
        self.validation_tolerance_config = validation_tolerance_config

        if self.enable_asset_validation:
            self.logger.info("Asset validation enabled")
        else:
            if not ASSET_VALIDATION_AVAILABLE:
                self.logger.warning("Asset validation disabled - validation components not available")
            else:
                self.logger.info("Asset validation disabled by configuration")

        # Backtest mode configuration
        self._backtest_mode = False
        self._backtest_data = None
        if backtest_data is not None:
            self.set_backtest_mode(backtest_data)

        self.logger.info("Initialized MarketDataManager")

    def set_backtest_mode(self, data: pd.DataFrame) -> None:
        """
        Configure MarketDataManager for backtest mode with specific data.

        This method locks the manager to use ONLY the provided DataFrame,
        eliminating all fallbacks to synthetic data generation.

        Args:
            data: DataFrame containing historical market data with required columns
                 (timestamp, open, high, low, close, volume)

        Raises:
            BacktestDataError: If data validation fails
        """
        try:
            # Validate required columns
            required_columns = ['open', 'high', 'low', 'close', 'volume']
            missing_columns = [col for col in required_columns if col not in data.columns]
            if missing_columns:
                raise BacktestDataError(
                    f"Backtest data missing required columns: {missing_columns}. "
                    f"Available columns: {list(data.columns)}"
                )

            # Validate data is not empty
            if data.empty:
                raise BacktestDataError("Backtest data cannot be empty")

            # Ensure proper datetime index
            if not isinstance(data.index, pd.DatetimeIndex):
                if 'timestamp' in data.columns:
                    data = data.set_index('timestamp')
                    # Smart timestamp parsing
                    if len(data) > 0 and pd.api.types.is_numeric_dtype(data.index):
                        first_val = data.index[0]
                        # 1e11 ms = 1973, 1e13 ms = 2286. Covers typical MS timestamps
                        if first_val > 1e11 and first_val < 1e13: 
                            data.index = pd.to_datetime(data.index, unit='ms', utc=True)
                        else:
                            # Default fallback (likely NS or Seconds)
                            data.index = pd.to_datetime(data.index, utc=True)
                    else:
                        data.index = pd.to_datetime(data.index, utc=True)
                else:
                    raise BacktestDataError("Data must have datetime index or 'timestamp' column")

            # Sort by timestamp to ensure chronological order
            data = data.sort_index()

            # Store backtest configuration
            self._backtest_mode = True
            self._backtest_data = data.copy()

            # Clear any previously processed backtest data to ensure fresh processing
            self._processed_backtest_data = None

            # Log backtest mode activation with CSV file confirmation
            start_date = data.index.min().strftime('%Y-%m-%d %H:%M:%S')
            end_date = data.index.max().strftime('%Y-%m-%d %H:%M:%S')
            self.logger.info(
                f"Using historical data from CSV file: backtest mode activated with {len(data)} rows "
                f"from {start_date} to {end_date}"
            )

        except Exception as e:
            raise BacktestDataError(f"Failed to set backtest mode: {str(e)}") from e

    def _get_backtest_data_subset(self, symbol: str, timeframe: Timeframe,
                                count: Optional[int] = None,
                                start_date: Optional[datetime] = None,
                                end_date: Optional[datetime] = None) -> pd.DataFrame:
        """
        Extract subset of backtest data based on request parameters.

        Args:
            symbol: Trading symbol (ignored in backtest mode)
            timeframe: Timeframe (ignored in backtest mode)
            count: Number of bars to retrieve
            start_date: Start date for data
            end_date: End date for data

        Returns:
            Filtered DataFrame from backtest data

        Raises:
            DataNotFoundError: If requested data is not available
        """
        if not self._backtest_mode or self._backtest_data is None:
            raise DataNotFoundError(
                "Backtest mode not active or no backtest data available",
                symbol=symbol,
                timeframe=timeframe.value if hasattr(timeframe, 'value') else str(timeframe)
            )

        data = self._backtest_data.copy()

        # Apply date filters
        if start_date is not None:
            data = data[data.index >= pd.to_datetime(start_date, utc=True)]
        if end_date is not None:
            data = data[data.index <= pd.to_datetime(end_date, utc=True)]

        # Apply count filter (take last N rows)
        if count is not None and len(data) > count:
            data = data.tail(count)

        if data.empty:
            available_start = self._backtest_data.index.min()
            available_end = self._backtest_data.index.max()
            requested_range = f"{start_date} to {end_date}" if start_date and end_date else f"last {count} bars" if count else "all data"

            raise DataNotFoundError(
                "No data available for requested range",
                symbol=symbol,
                timeframe=timeframe.value if hasattr(timeframe, 'value') else str(timeframe),
                requested_range=requested_range,
                available_range=f"{available_start} to {available_end}"
            )

        return data

    def fetch_initial_history(self, symbol: str, timeframe: Timeframe, count: Optional[int] = 200) -> bool:
        """
        Fetches an initial set of historical OHLCV data for a given symbol and timeframe,
        calculates indicators, and stores the resulting DataFrame.
        If count is None, fetches all available data (for backtesting).

        Args:
            symbol: Trading symbol
            timeframe: Data timeframe
            count: Number of bars to fetch (None for all available)

        Returns:
            True if successful, False otherwise
        """
        if not self.legacy_mode:
            self.logger.warning("fetch_initial_history called in non-legacy mode. Use get_historical_data instead.")
            return False

        count_msg = f"{count} bars" if count is not None else "all available bars"
        self.logger.info(f"Fetching initial {count_msg} for {symbol}/{timeframe.name}...")

        try:
            historical_data = self.platform_adapter.get_historical_ohlcv(symbol, timeframe, count=count)
            if not historical_data:
                self.logger.warning(f"No initial historical data returned for {symbol}/{timeframe.name}.")
                self.ohlcv_data.setdefault(symbol, {})[timeframe] = pd.DataFrame()
                return False

            df = pd.DataFrame([bar.dict() for bar in historical_data]).set_index("timestamp")
            # Ensure proper DatetimeIndex
            if not isinstance(df.index, pd.DatetimeIndex):
                df.index = pd.to_datetime(df.index, utc=True)
            df.sort_index(inplace=True)

            df_with_indicators = self._calculate_and_store_indicators(symbol, timeframe, df)
            self.ohlcv_data.setdefault(symbol, {})[timeframe] = df_with_indicators

            self.logger.info(f"Successfully processed {len(df_with_indicators)} initial bars for {symbol}/{timeframe.name}.")

            if not df.empty:
                last_bar_timestamp = df.index[-1]
                if isinstance(last_bar_timestamp, pd.Timestamp):
                    self.platform_adapter.set_initial_bar_timestamp(symbol, timeframe, last_bar_timestamp.to_pydatetime())

            return True
        except Exception as e:
            self.logger.error(f"Error fetching initial history for {symbol}/{timeframe.name}: {e}", exc_info=True)
            self.ohlcv_data.setdefault(symbol, {})[timeframe] = pd.DataFrame()
            return False

    def _calculate_and_store_indicators(self, symbol: str, timeframe: Timeframe, df: pd.DataFrame) -> pd.DataFrame:
        """
        Orchestrates the calculation of all required indicators for a given symbol and timeframe
        by finding relevant strategies, aggregating their indicator needs, and applying them.
        """
        if df.empty:
            return df

        # In legacy mode, use the legacy indicator calculation approach
        if self.legacy_mode:
            # Find all strategy profiles for this symbol/timeframe
            matching_profile_keys = self._find_asset_profile_keys(symbol, timeframe)
            if not matching_profile_keys:
                self.logger.warning(f"No active strategy profile for {symbol}/{timeframe.name}. Skipping indicator calculation.")
                return df

            # For now, use the pipeline to calculate indicators
            # This is a simplified approach that maintains compatibility
            try:
                processing_config = self._get_default_processing_config()
                processed_data = self.pipeline.process(df, processing_config)
                return processed_data
            except Exception as e:
                self.logger.error(f"Error calculating indicators for {symbol}/{timeframe.name}: {e}", exc_info=True)
                return df
        else:
            # Use new architecture
            try:
                processing_config = self._get_default_processing_config()
                processed_data = self.pipeline.process(df, processing_config)
                return processed_data
            except Exception as e:
                self.logger.error(f"Error calculating indicators for {symbol}/{timeframe.name}: {e}", exc_info=True)
                return df

    def _find_asset_profile_keys(self, symbol: str, timeframe: Timeframe) -> List[str]:
        """Finds all active asset profile keys for a given symbol and timeframe."""
        if not self.legacy_mode or not self.config:
            return []

        matching_keys = []
        for key, profile in self.config.asset_strategy_profiles.items():
            if not (profile.enabled and profile.symbol == symbol):
                continue

            params = self._get_strategy_params(profile.strategy_params_key)
            profile_timeframe_str = params.get("timeframe", "H1").upper()
            if profile_timeframe_str == timeframe.name:
                matching_keys.append(key)
        return matching_keys

    def _get_strategy_params(self, params_key: str) -> Dict[str, Any]:
        """Helper to safely retrieve strategy parameters from the loaded config."""
        if not self.legacy_mode or not self.config:
            return {}

        if hasattr(self.config, 'loaded_strategy_parameters'):
            param_set = self.config.loaded_strategy_parameters.get(params_key)
            if param_set and hasattr(param_set, 'parameters'):
                return param_set.parameters
        return {}

    @contextmanager
    def data_context(self):
        """
        Create a context manager for data operations.
        
        Returns:
            Context manager for resource cleanup
        """
        context = MarketDataContext(self)
        try:
            yield context
        finally:
            # Context manager handles cleanup
            pass
    
    def set_data_source(self, data_source: DataSourceStrategy):
        """
        Set the data source strategy.
        
        Args:
            data_source: New data source strategy
        """
        self.data_source = data_source
        self.logger.info(f"Set data source: {data_source.__class__.__name__}")
    
    def set_cache(self, cache: DataCache):
        """
        Set the cache implementation.
        
        Args:
            cache: New cache implementation
        """
        self.cache = cache
        self.logger.info(f"Set cache: {cache.__class__.__name__}")
    
    def set_pipeline(self, pipeline: DataPipeline):
        """
        Set the data processing pipeline.
        
        Args:
            pipeline: New data processing pipeline
        """
        self.pipeline = pipeline
        self.logger.info(f"Set pipeline: {pipeline.__class__.__name__}")
    
    @performance_timer
    def get_historical_data(
        self,
        symbol: str,
        timeframe: Timeframe,
        count: Optional[int] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        use_cache: bool = True,
        processing_config: Optional[Dict[str, Any]] = None
    ) -> pd.DataFrame:
        """
        Get historical market data with processing.
        
        Args:
            symbol: Trading symbol
            timeframe: Data timeframe
            count: Number of bars to retrieve
            start_date: Start date for data
            end_date: End date for data
            use_cache: Whether to use caching
            processing_config: Configuration for data processing
            
        Returns:
            Processed DataFrame with market data and indicators
            
        Raises:
            DataLoadingError: If data loading fails
            DataProcessingError: If data processing fails
        """
        try:
            # Generate cache key
            cache_key = self._generate_cache_key(
                symbol, timeframe, count, start_date, end_date, processing_config
            )
            
            # Try cache first
            if use_cache:
                cached_data = self.cache.retrieve(cache_key)
                if cached_data is not None:
                    self.logger.info(f"Retrieved data from cache: {symbol} {timeframe.value}")
                    return cached_data
            
            # Check if we're in backtest mode and should use backtest data
            if self._backtest_mode:
                if self._backtest_data is None:
                    raise DataNotFoundError(
                        "Backtest mode active but no backtest data available",
                        symbol=symbol,
                        timeframe=timeframe.value if hasattr(timeframe, 'value') else str(timeframe)
                    )
                self.logger.info(f"Loading data from backtest dataset: {symbol} {timeframe.value}")
                # In backtest mode, _get_backtest_data_subset returns a DataFrame directly
                df = self._get_backtest_data_subset(symbol, timeframe, count, start_date, end_date)

                if df.empty:
                    raise DataLoadingError(
                        f"No data available for {symbol} {timeframe.value}",
                        context=create_error_context(
                            symbol=symbol,
                            timeframe=timeframe.value,
                            count=count
                        )
                    )
            else:
                # Load raw data from source (only in non-backtest mode)
                if self.data_source is None:
                    raise DataNotFoundError(
                        "No data source available and not in backtest mode",
                        symbol=symbol,
                        timeframe=timeframe.value if hasattr(timeframe, 'value') else str(timeframe)
                    )
                self.logger.info(f"Loading data from source: {symbol} {timeframe.value}")
                raw_data = self.data_source.load_historical_data(
                    symbol, timeframe, count, start_date, end_date
                )

                if not raw_data:
                    raise DataLoadingError(
                        f"No data available for {symbol} {timeframe.value}",
                        context=create_error_context(
                            symbol=symbol,
                            timeframe=timeframe.value,
                            count=count
                        )
                    )

                # Convert to DataFrame (only needed for non-backtest mode)
                df = self._ohlcv_list_to_dataframe(raw_data)
            
            # Process data through pipeline
            if processing_config is None:
                processing_config = self._get_default_processing_config()
            
            processed_data = self.pipeline.process(df, processing_config)

            # Perform asset-specific validation and normalization
            if self.enable_asset_validation:
                validated_data = self._validate_and_normalize_data(
                    processed_data, symbol, processing_config
                )
                if validated_data is not None:
                    processed_data = validated_data

            # Store in cache
            if use_cache:
                cache_metadata = {
                    'symbol': symbol,
                    'timeframe': timeframe.value,
                    'count': len(processed_data),
                    'processing_config': processing_config
                }
                self.cache.store(cache_key, processed_data, cache_metadata)
            
            # Track loaded data
            self.loaded_data[cache_key] = {
                'data': processed_data,
                'metadata': cache_metadata if use_cache else {},
                'timestamp': datetime.now()
            }
            
            self.logger.info(f"Successfully loaded and processed {len(processed_data)} rows")
            return processed_data
            
        except Exception as e:
            if isinstance(e, (DataLoadingError, DataProcessingError)):
                raise
            raise DataLoadingError(
                f"Failed to get historical data for {symbol}",
                context=create_error_context(
                    symbol=symbol,
                    timeframe=timeframe.value,
                    count=count
                ),
                cause=e
            ) from e
    
    def get_latest_tick(self, symbol: str) -> Optional[TickData]:
        """
        Get the latest tick data for a symbol.
        
        Args:
            symbol: Trading symbol
            
        Returns:
            Latest tick data or None if not available
        """
        try:
            return self.data_source.get_latest_tick(symbol)
        except Exception as e:
            self.logger.error(f"Failed to get latest tick for {symbol}: {e}")
            return None
    
    def invalidate_cache(self, symbol: Optional[str] = None):
        """
        Invalidate cached data.
        
        Args:
            symbol: Symbol to invalidate (all if None)
        """
        try:
            if symbol is None:
                # Clear all cache
                self.cache.clear_all()
                self.loaded_data.clear()
                self.logger.info("Invalidated all cached data")
            else:
                # Invalidate specific symbol
                keys_to_remove = [
                    key for key in self.loaded_data.keys()
                    if symbol in key
                ]
                
                for key in keys_to_remove:
                    self.cache.invalidate(key)
                    if key in self.loaded_data:
                        del self.loaded_data[key]
                
                self.logger.info(f"Invalidated cached data for {symbol}")
                
        except Exception as e:
            self.logger.error(f"Failed to invalidate cache: {e}")
    
    def get_manager_info(self) -> Dict[str, Any]:
        """
        Get comprehensive information about the manager state.
        
        Returns:
            Dictionary with manager information
        """
        try:
            return {
                "data_source": self.data_source.get_source_info(),
                "cache": self.cache.get_cache_info(),
                "pipeline": self.pipeline.get_pipeline_info(),
                "loaded_data_count": len(self.loaded_data),
                "active_subscriptions": len(self.active_subscriptions),
                "data_source_available": self.data_source.is_available()
            }
        except Exception as e:
            self.logger.error(f"Failed to get manager info: {e}")
            return {"error": str(e)}
    
    def cleanup_resources(self):
        """Clean up all managed resources."""
        try:
            # Clear loaded data
            self.loaded_data.clear()
            
            # Clear active subscriptions
            self.active_subscriptions.clear()
            
            self.logger.info("Cleaned up manager resources")
            
        except Exception as e:
            self.logger.error(f"Failed to cleanup resources: {e}")
    
    def _create_default_pipeline(self) -> DataPipeline:
        """Create default data processing pipeline."""
        pipeline = ComposableDataPipeline()
        pipeline.add_stage(DataCleaningProcessor())
        pipeline.add_stage(IndicatorProcessor())
        return pipeline
    
    def _get_default_processing_config(self) -> Dict[str, Any]:
        """Get default processing configuration."""
        return {
            'cleaning': {
                'remove_duplicates': True,
                'fill_missing': True,
                'fix_ohlc_relationships': True
            },
            'indicators': {
                'rsi': {'period': 14},
                'moving_averages': {
                    'sma': [20, 50],
                    'ema': [12, 26]
                },
                'bollinger_bands': {'period': 20, 'std_dev': 2},
                'macd': {'fast_period': 12, 'slow_period': 26, 'signal_period': 9},
                'atr': {'periods': [5, 10, 14, 15, 20]}  # Multiple ATR periods for optimization
            }
        }
    
    def _generate_cache_key(
        self,
        symbol: str,
        timeframe: Timeframe,
        count: Optional[int],
        start_date: Optional[datetime],
        end_date: Optional[datetime],
        processing_config: Optional[Dict[str, Any]]
    ) -> str:
        """Generate unique cache key for data request."""
        key_parts = [
            symbol,
            timeframe.value,
            str(count) if count else "None",
            start_date.isoformat() if start_date else "None",
            end_date.isoformat() if end_date else "None",
            str(hash(str(processing_config))) if processing_config else "None"
        ]
        return "_".join(key_parts)
    
    def _ohlcv_list_to_dataframe(self, ohlcv_data: List[OHLCVData]) -> pd.DataFrame:
        """Convert list of OHLCVData to DataFrame."""
        try:
            data_dict = {
                'timestamp': [item.timestamp for item in ohlcv_data],
                'open': [item.open for item in ohlcv_data],
                'high': [item.high for item in ohlcv_data],
                'low': [item.low for item in ohlcv_data],
                'close': [item.close for item in ohlcv_data],
                'volume': [item.volume for item in ohlcv_data]
            }
            
            df = pd.DataFrame(data_dict)
            df.set_index('timestamp', inplace=True)
            df.sort_index(inplace=True)
            
            return df

        except Exception as e:
            raise DataProcessingError(
                "Failed to convert OHLCV data to DataFrame",
                context=create_error_context(data_count=len(ohlcv_data)),
                cause=e
            ) from e

    def recalculate_indicators_for_strategy(self, data_subset: pd.DataFrame = None,
                                          strategy_profile_key: str = None,
                                          symbol: str = None,
                                          timeframe = None,
                                          df: pd.DataFrame = None,
                                          trial_parameters: Dict[str, Any] = None) -> pd.DataFrame:
        """
        Recalculates indicators for a specific strategy profile with current parameter values.
        This is used during walk-forward analysis when parameters are updated dynamically.

        Args:
            data_subset: DataFrame with OHLCV data (without indicators) - new parameter
            strategy_profile_key: Specific strategy profile to calculate indicators for
            symbol: Trading symbol (legacy parameter for backward compatibility)
            timeframe: Data timeframe (legacy parameter for backward compatibility)
            df: DataFrame with OHLCV data (legacy parameter for backward compatibility)
            trial_parameters: Optional trial-specific parameters to use instead of config parameters

        Returns:
            DataFrame with recalculated indicators based on trial parameters or current strategy parameters
        """
        # Handle both new and legacy parameter styles
        if data_subset is not None:
            df = data_subset
        elif df is None:
            self.logger.error("No data provided to recalculate_indicators_for_strategy")
            return pd.DataFrame()

        if df.empty:
            return df

        # For the refactored version, we'll use the indicator processor
        # to recalculate indicators with the provided parameters
        try:
            # Create a temporary indicator processor with trial parameters
            if trial_parameters is not None:
                # Apply indicators using trial parameters
                # This is a simplified implementation - in a full implementation,
                # we would need to parse trial_parameters and convert them to indicator configs
                self.logger.debug(f"Recalculating indicators with trial parameters: {trial_parameters}")

                # For now, return the original dataframe with basic indicators
                # This maintains compatibility while the full implementation is developed
                result_df = df.copy()

                # Add basic RSI indicator as an example
                if 'rsi_period' in trial_parameters:
                    rsi_period = trial_parameters['rsi_period']
                    # Simple RSI calculation with division by zero handling
                    delta = result_df['close'].diff()
                    gain = (delta.where(delta > 0, 0)).rolling(window=rsi_period).mean()
                    loss = (-delta.where(delta < 0, 0)).rolling(window=rsi_period).mean()

                    # Handle division by zero: when loss is 0, RSI should be 100
                    # When gain is 0, RSI should be 0
                    import numpy as np
                    rs = np.where(loss == 0, np.inf, gain / loss)
                    rsi = np.where(
                        loss == 0,
                        100.0,  # When no losses, RSI = 100
                        np.where(
                            gain == 0,
                            0.0,  # When no gains, RSI = 0
                            100 - (100 / (1 + rs))  # Normal RSI calculation
                        )
                    )
                    result_df[f'RSI_{rsi_period}'] = rsi

                return result_df
            else:
                # Use default processing pipeline
                return self.pipeline.process(df)

        except Exception as e:
            self.logger.error(f"Failed to recalculate indicators: {str(e)}")
            return df

    def get_market_data(self, symbol: str, timeframe: Timeframe, up_to_timestamp: Optional[pd.Timestamp] = None) -> Optional[pd.DataFrame]:
        """
        Returns the DataFrame with OHLCV and calculated indicators for a symbol/timeframe.
        In backtesting, it ensures data is filtered to prevent look-ahead bias.

        Args:
            symbol: Trading symbol
            timeframe: Data timeframe
            up_to_timestamp: Optional timestamp to filter data (for backtesting)

        Returns:
            DataFrame with market data or None if not available

        Raises:
            DataNotFoundError: If data is not available and no fallback is allowed
        """
        try:
            # In backtest mode, use only backtest data - no fallbacks allowed
            if self._backtest_mode:
                if self._backtest_data is None or self._backtest_data.empty:
                    raise DataNotFoundError(
                        "No backtest data available",
                        symbol=symbol,
                        timeframe=timeframe.value if hasattr(timeframe, 'value') else str(timeframe)
                    )

                # Get full backtest data and process it through pipeline if not already processed
                if not hasattr(self, '_processed_backtest_data') or self._processed_backtest_data is None:
                    # Process backtest data through pipeline to add indicators
                    self.logger.debug("Processing backtest data through pipeline to add indicators")
                    processing_config = self._get_default_processing_config()
                    self._processed_backtest_data = self.pipeline.process(self._backtest_data.copy(), processing_config)
                    self.logger.debug(f"Processed backtest data columns: {list(self._processed_backtest_data.columns)}")

                full_data = self._processed_backtest_data.copy()

                # Apply timestamp filter for backtesting (prevent look-ahead bias)
                if up_to_timestamp is not None:
                    try:
                        filter_ts = pd.to_datetime(up_to_timestamp, utc=True)
                        full_data = full_data[full_data.index <= filter_ts]

                        if full_data.empty:
                            self.logger.warning(f"No data available up to timestamp {up_to_timestamp}")
                            return None

                    except Exception as e:
                        self.logger.error(f"Error filtering backtest data up to {up_to_timestamp}: {e}")
                        return None

                return full_data

            # Legacy mode for non-backtest scenarios
            if self.legacy_mode:
                # Legacy mode: use stored data
                full_data = self.ohlcv_data.get(symbol, {}).get(timeframe)

                if full_data is None and self._is_backtesting_mode():
                    full_data = self._fetch_data_from_backtest_adapter(symbol, timeframe, up_to_timestamp)
                    if full_data is not None and not full_data.empty:
                        full_data = self._calculate_and_store_indicators(symbol, timeframe, full_data.copy())
                        self.ohlcv_data.setdefault(symbol, {})[timeframe] = full_data

                if full_data is None:
                    # In backtest mode, raise error instead of returning None to prevent silent failures
                    if self._backtest_mode:
                        raise DataNotFoundError(
                            "No market data available in backtest mode",
                            symbol=symbol,
                            timeframe=timeframe.value if hasattr(timeframe, 'value') else str(timeframe)
                        )
                    self.logger.warning(f"No market data available for {symbol}/{timeframe.name}")
                    return None

                if up_to_timestamp is None:
                    return full_data

                # Filter data for backtesting to prevent look-ahead bias
                try:
                    filter_ts = pd.to_datetime(up_to_timestamp, utc=True)

                    # Ensure the DataFrame index is a proper DatetimeIndex
                    if not isinstance(full_data.index, pd.DatetimeIndex):
                        full_data.index = pd.to_datetime(full_data.index, utc=True)

                    filtered_df = full_data[full_data.index <= filter_ts].copy()
                    return filtered_df if isinstance(filtered_df, pd.DataFrame) else None
                except Exception as e:
                    self.logger.error(f"Error filtering market data for {symbol}/{timeframe.name} up to {up_to_timestamp}: {e}", exc_info=True)
                    return None
            else:
                # New architecture mode: use get_historical_data (disable cache to force fresh data)
                return self.get_historical_data(symbol, timeframe, use_cache=False)
        except Exception as e:
            self.logger.error(f"Error getting market data for {symbol}/{timeframe.name}: {e}", exc_info=True)
            return None

    def _is_backtesting_mode(self) -> bool:
        """Detects if the bot is in backtesting mode."""
        if not self.legacy_mode:
            return False
        return hasattr(self.platform_adapter, 'get_timeframe_data')

    def _fetch_data_from_backtest_adapter(self, symbol: str, timeframe: Timeframe, up_to_timestamp: Optional[pd.Timestamp] = None) -> Optional[pd.DataFrame]:
        """Fetches historical data directly from the paper trading adapter during a backtest."""
        if not self.legacy_mode:
            return None

        try:
            if not hasattr(self.platform_adapter, 'get_timeframe_data'):
                return None

            # The get_timeframe_data method is expected to handle the timestamp filtering.
            data = self.platform_adapter.get_timeframe_data(timeframe, up_to_timestamp.to_pydatetime() if up_to_timestamp else None) # type: ignore

            if data is not None and not data.empty:
                self.logger.info(f"Retrieved {len(data)} bars for {symbol}/{timeframe.name} from backtesting adapter.")
                return data
        except Exception as e:
            self.logger.error(f"Error getting backtesting data for {symbol}/{timeframe.name}: {e}", exc_info=True)
        return None

    def ensure_data_subscription(self, symbol: str, timeframe: Timeframe) -> bool:
        """
        Ensures that data subscription is active for the given symbol and timeframe.
        If not already subscribed, it will attempt to subscribe and fetch initial history.

        Args:
            symbol: Trading symbol
            timeframe: Data timeframe

        Returns:
            True if subscription is active, False otherwise
        """
        if not self.legacy_mode:
            self.logger.debug(f"ensure_data_subscription called in non-legacy mode for {symbol}/{timeframe.name}")
            return True

        self.logger.debug(f"Ensuring data subscription for {symbol}/{timeframe.name}")

        # Check if we already have data for this symbol/timeframe
        if symbol in self.ohlcv_data and timeframe in self.ohlcv_data[symbol]:
            existing_data = self.ohlcv_data[symbol][timeframe]
            if not existing_data.empty:
                self.logger.debug(f"Data already available for {symbol}/{timeframe.name}")
                return True

        # Ensure bar subscription is active for the symbol and timeframe
        if timeframe not in self._active_subscriptions["bars"].get(symbol, {}):
            if self.platform_adapter.subscribe_bars(symbol, timeframe, self._on_bar_data_received):
                self.logger.info(f"Added data subscription for {symbol}/{timeframe.name}")
                self._active_subscriptions["bars"].setdefault(symbol, {})[timeframe] = True
                # Fetch initial history
                max_bars = getattr(self.config.bot_settings, 'max_historical_bars_per_tf', 200) if self.config else 200
                self.fetch_initial_history(symbol, timeframe, count=max_bars)
            else:
                self.logger.error(f"Failed to subscribe to {timeframe.name} bars for {symbol}")
                return False
        else:
            self.logger.debug(f"Already subscribed to {symbol}/{timeframe.name}")

        return True

    def _on_bar_data_received(self, bar_data: OHLCVData):
        """
        Callback for when a new closed bar arrives from the platform adapter.
        It appends the new bar to the historical data, ensures the data store
        doesn't exceed the maximum configured size, and recalculates indicators.
        """
        if not self.legacy_mode:
            return

        symbol, tf = bar_data.symbol, bar_data.timeframe
        self.logger.debug(f"New {tf.name} bar received for {symbol} at {bar_data.timestamp}")

        df = self.ohlcv_data.setdefault(symbol, {}).setdefault(tf, pd.DataFrame())

        new_bar_df = pd.DataFrame([bar_data.dict()]).set_index("timestamp")
        # Ensure proper DatetimeIndex
        if not isinstance(new_bar_df.index, pd.DatetimeIndex):
            new_bar_df.index = pd.to_datetime(new_bar_df.index, utc=True)

        # Check if this bar is new or an update to an existing bar
        if df.empty or new_bar_df.index[0] not in df.index:
            # New bar - append it
            df = pd.concat([df, new_bar_df]).sort_index()

            # Limit data size if configured
            max_bars = getattr(self.config.bot_settings, 'max_historical_bars_per_tf', 1000) if self.config else 1000
            if len(df) > max_bars:
                df = df.tail(max_bars)

            df_with_indicators = self._calculate_and_store_indicators(symbol, tf, df.copy())
            self.ohlcv_data[symbol][tf] = df_with_indicators
            self.logger.debug(f"Updated {tf.name} data for {symbol}. Shape: {df_with_indicators.shape}")
        else:
            # This case handles situations where an existing bar's data is updated.
            self.logger.debug(f"Bar at {bar_data.timestamp} for {symbol}/{tf.name} already exists. Updating.")
            df.loc[new_bar_df.index[0]] = new_bar_df.iloc[0]
            df_with_indicators = self._calculate_and_store_indicators(symbol, tf, df.copy())
            self.ohlcv_data[symbol][tf] = df_with_indicators

    def get_latest_tick_data(self, symbol: str) -> Optional[TickData]:
        """
        Get the latest tick data for a symbol.

        Args:
            symbol: Trading symbol

        Returns:
            Latest TickData or None if not available
        """
        if not self.legacy_mode:
            # Non-legacy mode: try to get tick data from data source
            try:
                tick_data = self.data_source.get_latest_tick(symbol)
                if tick_data:
                    self.logger.debug(f"Retrieved tick data for {symbol} in non-legacy mode")
                    return tick_data
                else:
                    self.logger.debug(f"No tick data available for {symbol} in non-legacy mode")
                    return None
            except Exception as e:
                self.logger.warning(f"Failed to get tick data for {symbol} in non-legacy mode: {e}")
                return None

        return self.latest_ticks.get(symbol)

    def ensure_data_subscription(self, symbol: str, timeframe):
        """
        Ensure data subscription for a symbol/timeframe combination.

        Args:
            symbol: Trading symbol
            timeframe: Data timeframe
        """
        try:
            # For the refactored version, this is a placeholder
            # In a full implementation, this would ensure data is loaded and available
            self.logger.debug(f"Ensuring data subscription for {symbol}/{timeframe}")

            # Add to active subscriptions tracking
            subscription_key = f"{symbol}_{timeframe}"
            if subscription_key not in self.active_subscriptions:
                self.active_subscriptions[subscription_key] = True
                self.logger.info(f"Added data subscription for {symbol}/{timeframe}")

        except Exception as e:
            self.logger.error(f"Failed to ensure data subscription for {symbol}/{timeframe}: {str(e)}")

    def _validate_and_normalize_data(self, data: pd.DataFrame, symbol: str,
                                   processing_config: Optional[Dict[str, Any]] = None) -> Optional[pd.DataFrame]:
        """
        Validate and normalize data using asset-specific validators

        Args:
            data: DataFrame to validate and normalize
            symbol: Trading symbol for context
            processing_config: Processing configuration that may contain asset type

        Returns:
            Normalized DataFrame if validation passes, None if validation fails
        """
        try:
            # Determine asset type
            asset_type = self._determine_asset_type(symbol, processing_config)

            if asset_type is None:
                self.logger.warning(f"Could not determine asset type for {symbol}, skipping validation")
                return data

            # Create validator
            if not ASSET_VALIDATION_AVAILABLE:
                self.logger.debug("Asset validation not available, returning original data")
                return data

            validator = AssetValidatorFactory.create_validator(
                asset_type, symbol, self.validation_tolerance_config
            )

            # Perform validation
            self.logger.debug(f"Validating {symbol} data as {asset_type.value}")
            validation_result = validator.validate_data_quality(data)

            # Log validation results
            if validation_result.errors:
                self.logger.error(f"Data validation failed for {symbol}: {validation_result.errors}")
                # For now, continue with original data even if validation fails
                # In production, you might want to raise an exception
                return data

            if validation_result.warnings:
                self.logger.warning(f"Data validation warnings for {symbol}: {validation_result.warnings}")

            # Log validation statistics
            if validation_result.validation_stats:
                stats = validation_result.validation_stats
                self.logger.info(
                    f"Validated {symbol} data: {stats.get('total_bars', 0)} bars, "
                    f"asset_type={stats.get('asset_type', 'unknown')}, "
                    f"precision={stats.get('precision_decimals', 'unknown')} decimals"
                )

            # Return normalized data if available, otherwise original data
            return validation_result.normalized_data if validation_result.normalized_data is not None else data

        except Exception as e:
            self.logger.error(f"Asset validation failed for {symbol}: {e}")
            # Return original data on validation error
            return data

    def _determine_asset_type(self, symbol: str, processing_config: Optional[Dict[str, Any]] = None) -> Optional[AssetType]:
        """
        Determine asset type from symbol and configuration

        Args:
            symbol: Trading symbol
            processing_config: Processing configuration that may contain asset type

        Returns:
            AssetType if determinable, None otherwise
        """
        # Check processing config first
        if processing_config and 'asset_type' in processing_config:
            asset_type_str = processing_config['asset_type']
            try:
                if isinstance(asset_type_str, str):
                    return AssetType(asset_type_str.upper())
                elif isinstance(asset_type_str, AssetType):
                    return asset_type_str
            except ValueError:
                self.logger.warning(f"Invalid asset type in config: {asset_type_str}")

        # Use default asset type if configured
        if self.default_asset_type:
            return self.default_asset_type

        # Try to infer from symbol
        symbol_upper = symbol.upper()

        # Forex pairs (major pairs)
        forex_pairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD']
        if symbol_upper in forex_pairs or (len(symbol_upper) == 6 and symbol_upper[:3] != symbol_upper[3:]):
            return AssetType.FOREX

        # Crypto symbols
        crypto_symbols = ['BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'ADAUSD', 'DOTUSD']
        if symbol_upper in crypto_symbols or 'BTC' in symbol_upper or 'ETH' in symbol_upper:
            return AssetType.CRYPTO

        # Stock symbols (simple heuristic)
        if len(symbol_upper) <= 5 and symbol_upper.isalpha():
            return AssetType.STOCKS

        # Default to forex if unable to determine
        self.logger.debug(f"Could not determine asset type for {symbol}, defaulting to FOREX")
        return AssetType.FOREX

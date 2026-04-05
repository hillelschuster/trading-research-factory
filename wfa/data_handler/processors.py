# prop_firm_trading_bot/src/data_handler/processors.py

"""
Data processing implementations for market data transformation.

This module provides concrete implementations for data processing operations
including indicator calculation and data transformation.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Any
import logging

from src.data_handler.interfaces import DataProcessor, DataPipeline
from src.exceptions import (
    DataProcessingError, DataValidationError, create_error_context
)
from src.utils.pandas_optimization import (
    optimize_rolling_operations, vectorized_where, performance_timer
)
from src.utils.data_utils import validate_ohlcv_data


class IndicatorProcessor(DataProcessor):
    """
    Processor for calculating technical indicators.
    
    This processor adds technical indicators to OHLCV data
    using optimized pandas operations.
    """
    
    def __init__(self):
        """Initialize indicator processor."""
        self.logger = logging.getLogger(__name__)
        self.required_columns = ['open', 'high', 'low', 'close', 'volume']
    
    @performance_timer
    def process_data(
        self,
        data: pd.DataFrame,
        processing_config: Dict[str, Any]
    ) -> pd.DataFrame:
        """
        Calculate technical indicators for the data.
        
        Args:
            data: OHLCV DataFrame
            processing_config: Configuration with indicator parameters
            
        Returns:
            DataFrame with added indicators
        """
        try:
            if not self.validate_input(data):
                raise DataValidationError(
                    "Invalid input data for indicator processing",
                    context=create_error_context(
                        data_shape=data.shape,
                        data_columns=list(data.columns)
                    )
                )
            
            result_df = data.copy()
            indicators_config = processing_config.get('indicators', {})
            
            # Calculate RSI
            if 'rsi' in indicators_config:
                rsi_config = indicators_config['rsi']
                period = rsi_config.get('period', 14)
                result_df = self._calculate_rsi(result_df, period)
            
            # Calculate Moving Averages
            if 'moving_averages' in indicators_config:
                ma_config = indicators_config['moving_averages']
                for ma_type, periods in ma_config.items():
                    if isinstance(periods, list):
                        for period in periods:
                            result_df = self._calculate_moving_average(
                                result_df, period, ma_type
                            )
            
            # Calculate Bollinger Bands
            if 'bollinger_bands' in indicators_config:
                bb_config = indicators_config['bollinger_bands']
                period = bb_config.get('period', 20)
                std_dev = bb_config.get('std_dev', 2)
                result_df = self._calculate_bollinger_bands(result_df, period, std_dev)
            
            # Calculate MACD
            if 'macd' in indicators_config:
                macd_config = indicators_config['macd']
                fast_period = macd_config.get('fast_period', 12)
                slow_period = macd_config.get('slow_period', 26)
                signal_period = macd_config.get('signal_period', 9)
                result_df = self._calculate_macd(
                    result_df, fast_period, slow_period, signal_period
                )

            # Calculate ATR (Average True Range)
            if 'atr' in indicators_config:
                atr_config = indicators_config['atr']
                # Support both single period and multiple periods
                if 'periods' in atr_config:
                    # Multiple ATR periods for optimization
                    periods = atr_config['periods']
                    for period in periods:
                        result_df = self._calculate_atr(result_df, period)
                else:
                    # Single ATR period (backward compatibility)
                    period = atr_config.get('period', 10)
                    result_df = self._calculate_atr(result_df, period)

            self.logger.info(f"Calculated indicators for {len(result_df)} rows")
            return result_df
            
        except Exception as e:
            if isinstance(e, (DataValidationError, DataProcessingError)):
                raise
            raise DataProcessingError(
                "Failed to process indicators",
                context=create_error_context(
                    data_shape=data.shape,
                    processing_config=processing_config
                ),
                cause=e
            ) from e
    
    def validate_input(self, data: pd.DataFrame) -> bool:
        """Validate input data for indicator processing."""
        try:
            # Check required columns
            missing_columns = [col for col in self.required_columns if col not in data.columns]
            if missing_columns:
                self.logger.error(f"Missing required columns: {missing_columns}")
                return False
            
            # Check for sufficient data
            if len(data) < 2:
                self.logger.error("Insufficient data for indicator calculation")
                return False
            
            # Validate OHLCV relationships
            validation_result = validate_ohlcv_data(data)
            if not validation_result['valid']:
                self.logger.warning(f"Data validation issues: {validation_result['errors']}")
                # Allow processing with warnings
            
            return True
            
        except Exception as e:
            self.logger.error(f"Input validation failed: {e}")
            return False
    
    def get_required_columns(self) -> List[str]:
        """Get required columns for indicator processing."""
        return self.required_columns.copy()
    
    def _calculate_rsi(self, data: pd.DataFrame, period: int) -> pd.DataFrame:
        """Calculate RSI indicator."""
        try:
            close_prices = data['close']
            delta = close_prices.diff()

            gain = vectorized_where(delta > 0, delta, 0)
            loss = vectorized_where(delta < 0, -delta, 0)

            # Use optimized rolling operations
            rolling_stats = optimize_rolling_operations(
                pd.Series(gain),
                window=period,
                operations=['mean']
            )
            avg_gain = rolling_stats[f'rolling_mean_{period}']

            rolling_stats = optimize_rolling_operations(
                pd.Series(loss),
                window=period,
                operations=['mean']
            )
            avg_loss = rolling_stats[f'rolling_mean_{period}']

            # Handle division by zero: when avg_loss is 0, RSI should be 100
            # When avg_gain is 0, RSI should be 0
            # Use numpy.where to handle these edge cases
            rs = np.where(avg_loss == 0, np.inf, avg_gain / avg_loss)
            rsi = np.where(
                avg_loss == 0,
                100.0,  # When no losses, RSI = 100
                np.where(
                    avg_gain == 0,
                    0.0,  # When no gains, RSI = 0
                    100 - (100 / (1 + rs))  # Normal RSI calculation
                )
            )

            data[f'RSI_{period}'] = rsi
            return data
            
        except Exception as e:
            raise DataProcessingError(
                f"Failed to calculate RSI with period {period}",
                context=create_error_context(period=period),
                cause=e
            ) from e
    
    def _calculate_moving_average(
        self, 
        data: pd.DataFrame, 
        period: int, 
        ma_type: str = 'sma'
    ) -> pd.DataFrame:
        """Calculate moving average."""
        try:
            close_prices = data['close']
            
            if ma_type.lower() == 'sma':
                # Simple Moving Average
                rolling_stats = optimize_rolling_operations(
                    close_prices, 
                    window=period, 
                    operations=['mean']
                )
                data[f'SMA_{period}'] = rolling_stats[f'rolling_mean_{period}']
            
            elif ma_type.lower() == 'ema':
                # Exponential Moving Average
                data[f'EMA_{period}'] = close_prices.ewm(span=period).mean()
            
            return data
            
        except Exception as e:
            raise DataProcessingError(
                f"Failed to calculate {ma_type} with period {period}",
                context=create_error_context(period=period, ma_type=ma_type),
                cause=e
            ) from e
    
    def _calculate_bollinger_bands(
        self, 
        data: pd.DataFrame, 
        period: int, 
        std_dev: float
    ) -> pd.DataFrame:
        """Calculate Bollinger Bands."""
        try:
            close_prices = data['close']
            
            # Use optimized rolling operations
            rolling_stats = optimize_rolling_operations(
                close_prices, 
                window=period, 
                operations=['mean', 'std']
            )
            
            sma = rolling_stats[f'rolling_mean_{period}']
            std = rolling_stats[f'rolling_std_{period}']
            
            data[f'BB_Upper_{period}'] = sma + (std * std_dev)
            data[f'BB_Middle_{period}'] = sma
            data[f'BB_Lower_{period}'] = sma - (std * std_dev)
            
            return data
            
        except Exception as e:
            raise DataProcessingError(
                f"Failed to calculate Bollinger Bands with period {period}",
                context=create_error_context(period=period, std_dev=std_dev),
                cause=e
            ) from e
    
    def _calculate_macd(
        self, 
        data: pd.DataFrame, 
        fast_period: int, 
        slow_period: int, 
        signal_period: int
    ) -> pd.DataFrame:
        """Calculate MACD indicator."""
        try:
            close_prices = data['close']
            
            # Calculate EMAs
            ema_fast = close_prices.ewm(span=fast_period).mean()
            ema_slow = close_prices.ewm(span=slow_period).mean()
            
            # MACD line
            macd_line = ema_fast - ema_slow
            
            # Signal line
            signal_line = macd_line.ewm(span=signal_period).mean()
            
            # Histogram
            histogram = macd_line - signal_line
            
            data[f'MACD_{fast_period}_{slow_period}'] = macd_line
            data[f'MACD_Signal_{signal_period}'] = signal_line
            data[f'MACD_Histogram'] = histogram
            
            return data
            
        except Exception as e:
            raise DataProcessingError(
                f"Failed to calculate MACD",
                context=create_error_context(
                    fast_period=fast_period,
                    slow_period=slow_period,
                    signal_period=signal_period
                ),
                cause=e
            ) from e

    def _calculate_atr(self, data: pd.DataFrame, period: int) -> pd.DataFrame:
        """
        Calculate ATR (Average True Range) indicator.

        ATR measures market volatility by calculating the average of true ranges
        over a specified period. True Range is the maximum of:
        1. High - Low
        2. abs(High - Previous Close)
        3. abs(Low - Previous Close)

        Args:
            data: DataFrame with OHLC data
            period: Period for ATR calculation (typically 10 or 14)

        Returns:
            DataFrame with added ATR column
        """
        try:
            high = data['high']
            low = data['low']
            close = data['close']

            # Calculate previous close (shifted by 1)
            prev_close = close.shift(1)

            # Calculate the three components of True Range
            tr1 = high - low  # High - Low
            tr2 = np.abs(high - prev_close)  # abs(High - Previous Close)
            tr3 = np.abs(low - prev_close)   # abs(Low - Previous Close)

            # True Range is the maximum of the three components
            true_range = np.maximum(tr1, np.maximum(tr2, tr3))

            # ATR is the Simple Moving Average of True Range
            # Use optimized rolling operations for performance
            rolling_stats = optimize_rolling_operations(
                pd.Series(true_range),
                window=period,
                operations=['mean']
            )
            atr = rolling_stats[f'rolling_mean_{period}']

            # Add ATR column to DataFrame
            data[f'ATR_{period}'] = atr

            self.logger.debug(f"Calculated ATR_{period} for {len(data)} rows")
            return data

        except Exception as e:
            raise DataProcessingError(
                f"Failed to calculate ATR with period {period}",
                context=create_error_context(period=period),
                cause=e
            ) from e


class DataCleaningProcessor(DataProcessor):
    """
    Processor for data cleaning and validation.
    
    This processor handles data quality issues, outliers,
    and missing values in market data.
    """
    
    def __init__(self):
        """Initialize data cleaning processor."""
        self.logger = logging.getLogger(__name__)
        self.required_columns = ['open', 'high', 'low', 'close']
    
    @performance_timer
    def process_data(
        self,
        data: pd.DataFrame,
        processing_config: Dict[str, Any]
    ) -> pd.DataFrame:
        """
        Clean and validate market data.
        
        Args:
            data: Raw OHLCV DataFrame
            processing_config: Configuration for cleaning operations
            
        Returns:
            Cleaned DataFrame
        """
        try:
            if not self.validate_input(data):
                raise DataValidationError(
                    "Invalid input data for cleaning",
                    context=create_error_context(
                        data_shape=data.shape,
                        data_columns=list(data.columns)
                    )
                )
            
            result_df = data.copy()
            cleaning_config = processing_config.get('cleaning', {})
            
            # Remove duplicates
            if cleaning_config.get('remove_duplicates', True):
                initial_count = len(result_df)
                result_df = result_df[~result_df.index.duplicated(keep='first')]
                removed_count = initial_count - len(result_df)
                if removed_count > 0:
                    self.logger.info(f"Removed {removed_count} duplicate rows")
            
            # Handle missing values
            if cleaning_config.get('fill_missing', True):
                result_df = self._handle_missing_values(result_df, cleaning_config)
            
            # Validate OHLC relationships
            if cleaning_config.get('fix_ohlc_relationships', True):
                result_df = self._fix_ohlc_relationships(result_df)
            
            # Handle outliers
            if cleaning_config.get('handle_outliers', False):
                result_df = self._handle_outliers(result_df, cleaning_config)
            
            self.logger.info(f"Cleaned data: {len(result_df)} rows")
            return result_df
            
        except Exception as e:
            if isinstance(e, (DataValidationError, DataProcessingError)):
                raise
            raise DataProcessingError(
                "Failed to clean data",
                context=create_error_context(
                    data_shape=data.shape,
                    processing_config=processing_config
                ),
                cause=e
            ) from e
    
    def validate_input(self, data: pd.DataFrame) -> bool:
        """Validate input data for cleaning."""
        try:
            # Check required columns
            missing_columns = [col for col in self.required_columns if col not in data.columns]
            if missing_columns:
                self.logger.error(f"Missing required columns: {missing_columns}")
                return False
            
            # Check for empty data
            if len(data) == 0:
                self.logger.error("Empty dataset provided")
                return False
            
            return True
            
        except Exception as e:
            self.logger.error(f"Input validation failed: {e}")
            return False
    
    def get_required_columns(self) -> List[str]:
        """Get required columns for data cleaning."""
        return self.required_columns.copy()
    
    def _handle_missing_values(
        self, 
        data: pd.DataFrame, 
        config: Dict[str, Any]
    ) -> pd.DataFrame:
        """Handle missing values in the data."""
        try:
            fill_method = config.get('fill_method', 'forward')
            
            if fill_method == 'forward':
                data = data.ffill()
            elif fill_method == 'backward':
                data = data.bfill()
            elif fill_method == 'interpolate':
                data = data.interpolate()
            
            # Fill remaining NaN values with 0 for volume
            if 'volume' in data.columns:
                data['volume'] = data['volume'].fillna(0)
            
            return data
            
        except Exception as e:
            raise DataProcessingError(
                "Failed to handle missing values",
                context=create_error_context(fill_method=fill_method),
                cause=e
            ) from e
    
    def _fix_ohlc_relationships(self, data: pd.DataFrame) -> pd.DataFrame:
        """Fix invalid OHLC relationships."""
        try:
            # Ensure high is at least as high as open and close
            data['high'] = data[['high', 'open', 'close']].max(axis=1)
            
            # Ensure low is at most as low as open and close
            data['low'] = data[['low', 'open', 'close']].min(axis=1)
            
            return data
            
        except Exception as e:
            raise DataProcessingError(
                "Failed to fix OHLC relationships",
                context=create_error_context(),
                cause=e
            ) from e
    
    def _handle_outliers(
        self, 
        data: pd.DataFrame, 
        config: Dict[str, Any]
    ) -> pd.DataFrame:
        """Handle outliers in the data."""
        try:
            outlier_method = config.get('outlier_method', 'zscore')
            threshold = config.get('outlier_threshold', 3.0)
            
            if outlier_method == 'zscore':
                # Use Z-score method for outlier detection
                for col in ['open', 'high', 'low', 'close']:
                    if col in data.columns:
                        z_scores = np.abs((data[col] - data[col].mean()) / data[col].std())
                        outliers = z_scores > threshold
                        
                        if outliers.any():
                            # Replace outliers with median
                            data.loc[outliers, col] = data[col].median()
                            self.logger.info(f"Replaced {outliers.sum()} outliers in {col}")
            
            return data
            
        except Exception as e:
            raise DataProcessingError(
                "Failed to handle outliers",
                context=create_error_context(
                    outlier_method=outlier_method,
                    threshold=threshold
                ),
                cause=e
            ) from e


class ComposableDataPipeline(DataPipeline):
    """
    Composable data processing pipeline.

    This pipeline allows chaining multiple data processors
    to create complex data transformation workflows.
    """

    def __init__(self):
        """Initialize empty pipeline."""
        self.stages = []
        self.logger = logging.getLogger(__name__)

    def add_stage(self, processor: DataProcessor) -> 'ComposableDataPipeline':
        """
        Add a processing stage to the pipeline.

        Args:
            processor: Data processor to add

        Returns:
            Self for method chaining
        """
        self.stages.append(processor)
        self.logger.info(f"Added {processor.__class__.__name__} to pipeline")
        return self

    @performance_timer
    def process(
        self,
        data: pd.DataFrame,
        config: Optional[Dict[str, Any]] = None
    ) -> pd.DataFrame:
        """
        Process data through the entire pipeline.

        Args:
            data: Input data to process
            config: Optional configuration for processing

        Returns:
            Processed data
        """
        try:
            if config is None:
                config = {}

            result_data = data.copy()

            for i, stage in enumerate(self.stages):
                stage_name = stage.__class__.__name__
                self.logger.debug(f"Processing stage {i+1}/{len(self.stages)}: {stage_name}")

                # Get stage-specific config
                stage_config = config.get(stage_name.lower(), config)

                # Process data through stage
                result_data = stage.process_data(result_data, stage_config)

                self.logger.debug(f"Stage {stage_name} completed: {len(result_data)} rows")

            self.logger.info(f"Pipeline processing completed: {len(self.stages)} stages")
            return result_data

        except Exception as e:
            raise DataProcessingError(
                f"Pipeline processing failed at stage {i+1 if 'i' in locals() else 0}",
                context=create_error_context(
                    data_shape=data.shape,
                    pipeline_stages=len(self.stages),
                    config=config
                ),
                cause=e
            ) from e

    def get_pipeline_info(self) -> Dict[str, Any]:
        """
        Get information about the pipeline configuration.

        Returns:
            Dictionary with pipeline stage information
        """
        return {
            "total_stages": len(self.stages),
            "stage_types": [stage.__class__.__name__ for stage in self.stages],
            "stage_details": [
                {
                    "index": i,
                    "type": stage.__class__.__name__,
                    "required_columns": stage.get_required_columns()
                }
                for i, stage in enumerate(self.stages)
            ]
        }

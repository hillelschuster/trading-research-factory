# prop_firm_trading_bot/src/utils/data_utils.py

"""
Data validation and transformation utilities for the trading bot.

This module consolidates common data validation patterns, DataFrame operations,
and data cleaning functions used across multiple components.
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional, Union, Tuple, Set
from datetime import datetime, timedelta
import warnings

from src.exceptions import (
    DataValidationError, DataProcessingError, create_error_context
)


def validate_ohlcv_data(
    data: pd.DataFrame,
    required_columns: Optional[List[str]] = None,
    check_relationships: bool = True,
    allow_missing_volume: bool = False
) -> Dict[str, Any]:
    """
    Validate OHLCV data format and relationships.
    
    Args:
        data: DataFrame with OHLCV data
        required_columns: List of required column names
        check_relationships: Whether to validate OHLC relationships
        allow_missing_volume: Whether volume column is optional
        
    Returns:
        Dictionary with validation results
        
    Raises:
        DataValidationError: If validation fails
    """
    if required_columns is None:
        required_columns = ['open', 'high', 'low', 'close']
        if not allow_missing_volume:
            required_columns.append('volume')
    
    try:
        validation_results = {
            "valid": True,
            "errors": [],
            "warnings": [],
            "row_count": len(data),
            "column_count": len(data.columns)
        }
        
        # Check if DataFrame is empty
        if data.empty:
            raise DataValidationError(
                "OHLCV data is empty",
                context=create_error_context(data_shape=data.shape)
            )
        
        # Check required columns
        missing_columns = [col for col in required_columns if col not in data.columns]
        if missing_columns:
            raise DataValidationError(
                f"Missing required columns: {missing_columns}",
                context=create_error_context(
                    missing_columns=missing_columns,
                    available_columns=list(data.columns),
                    required_columns=required_columns
                )
            )
        
        # Check for NaN values
        nan_counts = data[required_columns].isnull().sum()
        if nan_counts.any():
            validation_results["warnings"].append(f"NaN values found: {nan_counts.to_dict()}")
        
        # Validate OHLC relationships if requested
        if check_relationships and all(col in data.columns for col in ['open', 'high', 'low', 'close']):
            invalid_high = data['high'] < data[['open', 'close']].max(axis=1)
            invalid_low = data['low'] > data[['open', 'close']].min(axis=1)
            
            if invalid_high.any():
                validation_results["errors"].append(f"Invalid high prices: {invalid_high.sum()} rows")
            
            if invalid_low.any():
                validation_results["errors"].append(f"Invalid low prices: {invalid_low.sum()} rows")
        
        # Check for negative volume if present
        if 'volume' in data.columns:
            negative_volume = data['volume'] < 0
            if negative_volume.any():
                validation_results["errors"].append(f"Negative volume: {negative_volume.sum()} rows")
        
        # Check for duplicate timestamps if index is datetime
        if isinstance(data.index, pd.DatetimeIndex):
            duplicates = data.index.duplicated()
            if duplicates.any():
                validation_results["warnings"].append(f"Duplicate timestamps: {duplicates.sum()} rows")
        
        validation_results["valid"] = len(validation_results["errors"]) == 0
        
        return validation_results
        
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataValidationError(
            "Failed to validate OHLCV data",
            context=create_error_context(
                data_shape=data.shape,
                data_columns=list(data.columns),
                required_columns=required_columns
            ),
            cause=e
        ) from e


def clean_ohlcv_data(
    data: pd.DataFrame,
    remove_duplicates: bool = True,
    fill_missing: bool = True,
    validate_relationships: bool = True
) -> pd.DataFrame:
    """
    Clean OHLCV data by removing duplicates, filling missing values, etc.
    
    Args:
        data: DataFrame with OHLCV data
        remove_duplicates: Whether to remove duplicate timestamps
        fill_missing: Whether to forward-fill missing values
        validate_relationships: Whether to fix invalid OHLC relationships
        
    Returns:
        Cleaned DataFrame
    """
    try:
        cleaned_data = data.copy()
        
        # Remove duplicates if requested
        if remove_duplicates and isinstance(cleaned_data.index, pd.DatetimeIndex):
            cleaned_data = cleaned_data[~cleaned_data.index.duplicated(keep='first')]
        
        # Fill missing values if requested
        if fill_missing:
            # Forward fill for price columns
            price_columns = ['open', 'high', 'low', 'close']
            available_price_cols = [col for col in price_columns if col in cleaned_data.columns]
            if available_price_cols:
                cleaned_data[available_price_cols] = cleaned_data[available_price_cols].fillna(method='ffill')
            
            # Fill volume with 0 if present
            if 'volume' in cleaned_data.columns:
                cleaned_data['volume'] = cleaned_data['volume'].fillna(0)
        
        # Validate and fix OHLC relationships if requested
        if validate_relationships and all(col in cleaned_data.columns for col in ['open', 'high', 'low', 'close']):
            # Ensure high is at least as high as open and close
            cleaned_data['high'] = cleaned_data[['high', 'open', 'close']].max(axis=1)
            
            # Ensure low is at most as low as open and close
            cleaned_data['low'] = cleaned_data[['low', 'open', 'close']].min(axis=1)
        
        return cleaned_data
        
    except Exception as e:
        raise DataProcessingError(
            "Failed to clean OHLCV data",
            context=create_error_context(
                data_shape=data.shape,
                remove_duplicates=remove_duplicates,
                fill_missing=fill_missing,
                validate_relationships=validate_relationships
            ),
            cause=e
        ) from e


def resample_ohlcv_data(
    data: pd.DataFrame,
    target_frequency: str,
    price_columns: Optional[List[str]] = None,
    volume_column: str = 'volume'
) -> pd.DataFrame:
    """
    Resample OHLCV data to a different frequency.
    
    Args:
        data: DataFrame with OHLCV data and datetime index
        target_frequency: Target frequency (e.g., '1H', '1D', '1W')
        price_columns: List of price columns to resample
        volume_column: Name of volume column
        
    Returns:
        Resampled DataFrame
    """
    if price_columns is None:
        price_columns = ['open', 'high', 'low', 'close']
    
    try:
        if not isinstance(data.index, pd.DatetimeIndex):
            raise DataValidationError(
                "Data must have datetime index for resampling",
                context=create_error_context(index_type=type(data.index).__name__)
            )
        
        resampled_data = {}
        
        # Resample price columns
        for col in price_columns:
            if col in data.columns:
                if col == 'open':
                    resampled_data[col] = data[col].resample(target_frequency).first()
                elif col == 'high':
                    resampled_data[col] = data[col].resample(target_frequency).max()
                elif col == 'low':
                    resampled_data[col] = data[col].resample(target_frequency).min()
                elif col == 'close':
                    resampled_data[col] = data[col].resample(target_frequency).last()
                else:
                    # Default to last value for other price columns
                    resampled_data[col] = data[col].resample(target_frequency).last()
        
        # Resample volume column
        if volume_column in data.columns:
            resampled_data[volume_column] = data[volume_column].resample(target_frequency).sum()
        
        # Combine into DataFrame
        result = pd.DataFrame(resampled_data)
        
        # Remove rows with all NaN values
        result = result.dropna(how='all')
        
        return result
        
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataProcessingError(
            "Failed to resample OHLCV data",
            context=create_error_context(
                data_shape=data.shape,
                target_frequency=target_frequency,
                price_columns=price_columns,
                volume_column=volume_column
            ),
            cause=e
        ) from e


def validate_data_completeness(
    data: pd.DataFrame,
    expected_frequency: Optional[str] = None,
    tolerance_pct: float = 5.0
) -> Dict[str, Any]:
    """
    Validate data completeness and identify gaps.
    
    Args:
        data: DataFrame with datetime index
        expected_frequency: Expected data frequency (e.g., '1min', '1H', '1D')
        tolerance_pct: Tolerance percentage for missing data
        
    Returns:
        Dictionary with completeness analysis
    """
    try:
        if not isinstance(data.index, pd.DatetimeIndex):
            raise DataValidationError(
                "Data must have datetime index for completeness validation",
                context=create_error_context(index_type=type(data.index).__name__)
            )
        
        analysis = {
            "total_rows": len(data),
            "date_range": (data.index.min(), data.index.max()),
            "gaps": [],
            "completeness_pct": 100.0,
            "is_complete": True
        }
        
        if len(data) == 0:
            analysis["completeness_pct"] = 0.0
            analysis["is_complete"] = False
            return analysis
        
        # If expected frequency is provided, check for gaps
        if expected_frequency:
            # Create expected date range
            expected_range = pd.date_range(
                start=data.index.min(),
                end=data.index.max(),
                freq=expected_frequency
            )
            
            # Find missing dates
            missing_dates = expected_range.difference(data.index)
            
            if len(missing_dates) > 0:
                analysis["gaps"] = missing_dates.tolist()
                analysis["completeness_pct"] = (
                    (len(expected_range) - len(missing_dates)) / len(expected_range)
                ) * 100
                analysis["is_complete"] = analysis["completeness_pct"] >= (100 - tolerance_pct)
        
        return analysis
        
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataValidationError(
            "Failed to validate data completeness",
            context=create_error_context(
                data_shape=data.shape,
                expected_frequency=expected_frequency,
                tolerance_pct=tolerance_pct
            ),
            cause=e
        ) from e


def filter_data_by_time(
    data: pd.DataFrame,
    start_time: Optional[Union[str, datetime]] = None,
    end_time: Optional[Union[str, datetime]] = None,
    time_column: Optional[str] = None
) -> pd.DataFrame:
    """
    Filter DataFrame by time range.
    
    Args:
        data: DataFrame to filter
        start_time: Start time (inclusive)
        end_time: End time (inclusive)
        time_column: Column name for time filtering (uses index if None)
        
    Returns:
        Filtered DataFrame
    """
    try:
        filtered_data = data.copy()
        
        # Determine time series to use
        if time_column:
            if time_column not in data.columns:
                raise DataValidationError(
                    f"Time column '{time_column}' not found in data",
                    context=create_error_context(
                        time_column=time_column,
                        available_columns=list(data.columns)
                    )
                )
            time_series = data[time_column]
        else:
            if not isinstance(data.index, pd.DatetimeIndex):
                raise DataValidationError(
                    "Data must have datetime index when time_column is not specified",
                    context=create_error_context(index_type=type(data.index).__name__)
                )
            time_series = data.index
        
        # Apply time filters
        if start_time:
            start_time = pd.to_datetime(start_time)
            if time_column:
                filtered_data = filtered_data[time_series >= start_time]
            else:
                filtered_data = filtered_data[filtered_data.index >= start_time]
        
        if end_time:
            end_time = pd.to_datetime(end_time)
            if time_column:
                filtered_data = filtered_data[time_series <= end_time]
            else:
                filtered_data = filtered_data[filtered_data.index <= end_time]
        
        return filtered_data
        
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataProcessingError(
            "Failed to filter data by time",
            context=create_error_context(
                data_shape=data.shape,
                start_time=str(start_time) if start_time else None,
                end_time=str(end_time) if end_time else None,
                time_column=time_column
            ),
            cause=e
        ) from e


def check_data_types(
    data: pd.DataFrame,
    expected_types: Dict[str, str],
    convert_types: bool = False
) -> Union[pd.DataFrame, Dict[str, Any]]:
    """
    Check and optionally convert data types.
    
    Args:
        data: DataFrame to check
        expected_types: Dictionary mapping column names to expected types
        convert_types: Whether to convert types automatically
        
    Returns:
        DataFrame with converted types if convert_types=True, else validation results
    """
    try:
        if convert_types:
            converted_data = data.copy()
            conversion_results = {"converted": [], "failed": []}
            
            for column, expected_type in expected_types.items():
                if column in converted_data.columns:
                    try:
                        if expected_type == 'datetime':
                            converted_data[column] = pd.to_datetime(converted_data[column])
                        elif expected_type == 'numeric':
                            converted_data[column] = pd.to_numeric(converted_data[column])
                        else:
                            converted_data[column] = converted_data[column].astype(expected_type)
                        conversion_results["converted"].append(column)
                    except Exception as e:
                        conversion_results["failed"].append({"column": column, "error": str(e)})
            
            return converted_data
        else:
            # Just check types
            type_check_results = {"valid": True, "mismatches": []}
            
            for column, expected_type in expected_types.items():
                if column in data.columns:
                    actual_type = str(data[column].dtype)
                    
                    # Simple type matching
                    type_match = False
                    if expected_type == 'numeric' and data[column].dtype.kind in 'biufc':
                        type_match = True
                    elif expected_type == 'datetime' and 'datetime' in actual_type:
                        type_match = True
                    elif expected_type in actual_type:
                        type_match = True
                    
                    if not type_match:
                        type_check_results["mismatches"].append({
                            "column": column,
                            "expected": expected_type,
                            "actual": actual_type
                        })
                        type_check_results["valid"] = False
            
            return type_check_results
            
    except Exception as e:
        raise DataValidationError(
            "Failed to check data types",
            context=create_error_context(
                data_shape=data.shape,
                expected_types=expected_types,
                convert_types=convert_types
            ),
            cause=e
        ) from e


def remove_outliers(
    data: pd.DataFrame,
    columns: Optional[List[str]] = None,
    method: str = 'zscore',
    threshold: float = 3.0,
    replace_with: str = 'nan'
) -> pd.DataFrame:
    """
    Remove or replace outliers in specified columns.
    
    Args:
        data: DataFrame to process
        columns: Columns to check for outliers (all numeric if None)
        method: Outlier detection method ('zscore', 'iqr')
        threshold: Threshold for outlier detection
        replace_with: How to handle outliers ('nan', 'median', 'mean', 'remove')
        
    Returns:
        DataFrame with outliers handled
    """
    try:
        processed_data = data.copy()
        
        if columns is None:
            columns = data.select_dtypes(include=[np.number]).columns.tolist()
        
        for column in columns:
            if column not in data.columns:
                continue
            
            col_data = processed_data[column]
            
            if method == 'zscore':
                z_scores = np.abs((col_data - col_data.mean()) / col_data.std())
                outlier_mask = z_scores > threshold
            elif method == 'iqr':
                Q1 = col_data.quantile(0.25)
                Q3 = col_data.quantile(0.75)
                IQR = Q3 - Q1
                lower_bound = Q1 - threshold * IQR
                upper_bound = Q3 + threshold * IQR
                outlier_mask = (col_data < lower_bound) | (col_data > upper_bound)
            else:
                raise DataValidationError(
                    f"Unknown outlier detection method: {method}",
                    context=create_error_context(
                        method=method,
                        available_methods=['zscore', 'iqr']
                    )
                )
            
            # Handle outliers based on replace_with parameter
            if replace_with == 'nan':
                processed_data.loc[outlier_mask, column] = np.nan
            elif replace_with == 'median':
                processed_data.loc[outlier_mask, column] = col_data.median()
            elif replace_with == 'mean':
                processed_data.loc[outlier_mask, column] = col_data.mean()
            elif replace_with == 'remove':
                processed_data = processed_data[~outlier_mask]
        
        return processed_data
        
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataProcessingError(
            "Failed to remove outliers",
            context=create_error_context(
                data_shape=data.shape,
                columns=columns,
                method=method,
                threshold=threshold,
                replace_with=replace_with
            ),
            cause=e
        ) from e

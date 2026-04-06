# prop_firm_trading_bot/src/utils/pandas_optimization.py

"""
Pandas performance optimization utilities for the trading bot.

This module provides optimized pandas operations, memory-efficient data types,
and vectorized alternatives to common DataFrame operations.
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional, Union, Tuple, Callable
import warnings
from functools import wraps
import gc

from src.exceptions import DataProcessingError, create_error_context


def optimize_dataframe_memory(
    df: pd.DataFrame,
    categorical_threshold: float = 0.5,
    downcast_numeric: bool = True,
    convert_strings: bool = True
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Optimize DataFrame memory usage through data type optimization.
    
    Args:
        df: DataFrame to optimize
        categorical_threshold: Convert to categorical if unique ratio < threshold
        downcast_numeric: Whether to downcast numeric types
        convert_strings: Whether to convert strings to categorical
        
    Returns:
        Tuple of (optimized_dataframe, optimization_report)
    """
    try:
        original_memory = df.memory_usage(deep=True).sum()
        optimized_df = df.copy()
        optimization_report = {
            "original_memory_mb": original_memory / (1024 * 1024),
            "optimizations": [],
            "memory_reduction_pct": 0.0
        }
        
        for column in optimized_df.columns:
            col_data = optimized_df[column]
            original_dtype = str(col_data.dtype)
            
            # Handle object/string columns
            if col_data.dtype == 'object':
                if convert_strings:
                    # Check if it's actually strings
                    if col_data.dropna().apply(lambda x: isinstance(x, str)).all():
                        unique_ratio = col_data.nunique() / len(col_data)
                        
                        if unique_ratio < categorical_threshold:
                            # Convert to categorical
                            optimized_df[column] = col_data.astype('category')
                            optimization_report["optimizations"].append({
                                "column": column,
                                "from": original_dtype,
                                "to": "category",
                                "unique_ratio": unique_ratio
                            })
                        else:
                            # Convert to string dtype if available
                            try:
                                optimized_df[column] = col_data.astype('string')
                                optimization_report["optimizations"].append({
                                    "column": column,
                                    "from": original_dtype,
                                    "to": "string",
                                    "unique_ratio": unique_ratio
                                })
                            except:
                                pass  # Keep as object if string conversion fails
            
            # Handle numeric columns
            elif downcast_numeric and pd.api.types.is_numeric_dtype(col_data):
                if pd.api.types.is_integer_dtype(col_data):
                    # Downcast integers
                    optimized_col = pd.to_numeric(col_data, downcast='integer')
                    if optimized_col.dtype != col_data.dtype:
                        optimized_df[column] = optimized_col
                        optimization_report["optimizations"].append({
                            "column": column,
                            "from": original_dtype,
                            "to": str(optimized_col.dtype)
                        })
                
                elif pd.api.types.is_float_dtype(col_data):
                    # Downcast floats
                    optimized_col = pd.to_numeric(col_data, downcast='float')
                    if optimized_col.dtype != col_data.dtype:
                        optimized_df[column] = optimized_col
                        optimization_report["optimizations"].append({
                            "column": column,
                            "from": original_dtype,
                            "to": str(optimized_col.dtype)
                        })
        
        # Calculate memory reduction
        optimized_memory = optimized_df.memory_usage(deep=True).sum()
        optimization_report["optimized_memory_mb"] = optimized_memory / (1024 * 1024)
        optimization_report["memory_reduction_pct"] = (
            (original_memory - optimized_memory) / original_memory
        ) * 100
        
        return optimized_df, optimization_report
        
    except Exception as e:
        raise DataProcessingError(
            "Failed to optimize DataFrame memory",
            context=create_error_context(
                df_shape=df.shape,
                categorical_threshold=categorical_threshold,
                downcast_numeric=downcast_numeric,
                convert_strings=convert_strings
            ),
            cause=e
        ) from e


def vectorized_where(
    condition: Union[pd.Series, np.ndarray],
    true_value: Any,
    false_value: Any
) -> Union[pd.Series, np.ndarray]:
    """
    Optimized vectorized conditional selection using numpy.where.
    
    Args:
        condition: Boolean condition array/series
        true_value: Value when condition is True
        false_value: Value when condition is False
        
    Returns:
        Array/Series with conditional values
    """
    try:
        return np.where(condition, true_value, false_value)
    except Exception as e:
        raise DataProcessingError(
            "Failed to perform vectorized where operation",
            context=create_error_context(
                condition_type=type(condition).__name__,
                condition_length=len(condition) if hasattr(condition, '__len__') else None
            ),
            cause=e
        ) from e


def efficient_concat(
    dataframes: List[pd.DataFrame],
    ignore_index: bool = True,
    sort: bool = False
) -> pd.DataFrame:
    """
    Efficiently concatenate multiple DataFrames using optimized pandas.concat.
    
    Args:
        dataframes: List of DataFrames to concatenate
        ignore_index: Whether to ignore index
        sort: Whether to sort columns
        
    Returns:
        Concatenated DataFrame
    """
    try:
        if not dataframes:
            return pd.DataFrame()
        
        # Filter out empty DataFrames
        non_empty_dfs = [df for df in dataframes if not df.empty]
        
        if not non_empty_dfs:
            return pd.DataFrame()
        
        if len(non_empty_dfs) == 1:
            return non_empty_dfs[0].copy()
        
        # Use pandas.concat with optimized parameters
        return pd.concat(
            non_empty_dfs,
            ignore_index=ignore_index,
            sort=sort,
            copy=False  # Avoid unnecessary copying
        )
        
    except Exception as e:
        raise DataProcessingError(
            "Failed to concatenate DataFrames",
            context=create_error_context(
                num_dataframes=len(dataframes),
                ignore_index=ignore_index,
                sort=sort
            ),
            cause=e
        ) from e


def chunked_operation(
    df: pd.DataFrame,
    operation: Callable[[pd.DataFrame], pd.DataFrame],
    chunk_size: int = 10000,
    progress_callback: Optional[Callable[[int, int], None]] = None
) -> pd.DataFrame:
    """
    Apply operation to DataFrame in chunks for memory efficiency.
    
    Args:
        df: DataFrame to process
        operation: Function to apply to each chunk
        chunk_size: Size of each chunk
        progress_callback: Optional callback for progress reporting
        
    Returns:
        Processed DataFrame
    """
    try:
        if len(df) <= chunk_size:
            return operation(df)
        
        results = []
        total_chunks = (len(df) + chunk_size - 1) // chunk_size
        
        for i in range(0, len(df), chunk_size):
            chunk = df.iloc[i:i + chunk_size]
            processed_chunk = operation(chunk)
            results.append(processed_chunk)
            
            if progress_callback:
                chunk_num = (i // chunk_size) + 1
                progress_callback(chunk_num, total_chunks)
        
        return efficient_concat(results)
        
    except Exception as e:
        raise DataProcessingError(
            "Failed to perform chunked operation",
            context=create_error_context(
                df_shape=df.shape,
                chunk_size=chunk_size,
                total_chunks=(len(df) + chunk_size - 1) // chunk_size
            ),
            cause=e
        ) from e


def optimize_rolling_operations(
    series: pd.Series,
    window: int,
    operations: List[str] = None,
    min_periods: Optional[int] = None
) -> pd.DataFrame:
    """
    Efficiently compute multiple rolling statistics in a single pass.
    
    Args:
        series: Series to compute rolling statistics for
        window: Rolling window size
        operations: List of operations ('mean', 'std', 'min', 'max', 'sum')
        min_periods: Minimum periods required
        
    Returns:
        DataFrame with rolling statistics
    """
    if operations is None:
        operations = ['mean', 'std']
    
    try:
        rolling_obj = series.rolling(window=window, min_periods=min_periods)
        
        results = {}
        for op in operations:
            if hasattr(rolling_obj, op):
                results[f'rolling_{op}_{window}'] = getattr(rolling_obj, op)()
            else:
                raise DataProcessingError(
                    f"Unknown rolling operation: {op}",
                    context=create_error_context(
                        operation=op,
                        available_operations=['mean', 'std', 'min', 'max', 'sum', 'var']
                    )
                )
        
        return pd.DataFrame(results)
        
    except Exception as e:
        if isinstance(e, DataProcessingError):
            raise
        raise DataProcessingError(
            "Failed to compute rolling operations",
            context=create_error_context(
                series_length=len(series),
                window=window,
                operations=operations,
                min_periods=min_periods
            ),
            cause=e
        ) from e


def memory_efficient_groupby(
    df: pd.DataFrame,
    groupby_cols: Union[str, List[str]],
    agg_dict: Dict[str, Union[str, List[str]]],
    chunk_size: Optional[int] = None
) -> pd.DataFrame:
    """
    Memory-efficient groupby operation with optional chunking.
    
    Args:
        df: DataFrame to group
        groupby_cols: Columns to group by
        agg_dict: Aggregation dictionary
        chunk_size: Optional chunk size for large datasets
        
    Returns:
        Aggregated DataFrame
    """
    try:
        if chunk_size is None or len(df) <= chunk_size:
            # Standard groupby for smaller datasets
            return df.groupby(groupby_cols).agg(agg_dict).reset_index()
        
        # Chunked groupby for large datasets
        results = []
        
        for i in range(0, len(df), chunk_size):
            chunk = df.iloc[i:i + chunk_size]
            chunk_result = chunk.groupby(groupby_cols).agg(agg_dict).reset_index()
            results.append(chunk_result)
        
        # Combine and re-aggregate
        combined = efficient_concat(results)
        return combined.groupby(groupby_cols).agg(agg_dict).reset_index()
        
    except Exception as e:
        raise DataProcessingError(
            "Failed to perform memory-efficient groupby",
            context=create_error_context(
                df_shape=df.shape,
                groupby_cols=groupby_cols,
                agg_dict=agg_dict,
                chunk_size=chunk_size
            ),
            cause=e
        ) from e


def optimize_data_types_for_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """
    Optimize data types specifically for OHLCV data.
    
    Args:
        df: OHLCV DataFrame
        
    Returns:
        Optimized DataFrame
    """
    try:
        optimized_df = df.copy()
        
        # Optimize price columns to float32 (sufficient precision for most use cases)
        price_columns = ['open', 'high', 'low', 'close']
        for col in price_columns:
            if col in optimized_df.columns:
                optimized_df[col] = optimized_df[col].astype('float32')
        
        # Optimize volume to appropriate integer type
        if 'volume' in optimized_df.columns:
            max_volume = optimized_df['volume'].max()
            if max_volume <= np.iinfo(np.uint32).max:
                optimized_df['volume'] = optimized_df['volume'].astype('uint32')
            else:
                optimized_df['volume'] = optimized_df['volume'].astype('uint64')
        
        # Ensure timestamp is datetime64[ns] with timezone if needed
        if 'timestamp' in optimized_df.columns:
            if not pd.api.types.is_datetime64_any_dtype(optimized_df['timestamp']):
                optimized_df['timestamp'] = pd.to_datetime(optimized_df['timestamp'])
        
        return optimized_df
        
    except Exception as e:
        raise DataProcessingError(
            "Failed to optimize OHLCV data types",
            context=create_error_context(df_shape=df.shape, df_columns=list(df.columns)),
            cause=e
        ) from e


def memory_usage_report(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Generate comprehensive memory usage report for DataFrame.
    
    Args:
        df: DataFrame to analyze
        
    Returns:
        Memory usage report
    """
    try:
        memory_usage = df.memory_usage(deep=True)
        total_memory = memory_usage.sum()
        
        report = {
            "total_memory_mb": total_memory / (1024 * 1024),
            "total_memory_bytes": total_memory,
            "shape": df.shape,
            "column_memory": {},
            "largest_columns": [],
            "optimization_suggestions": []
        }
        
        # Analyze each column
        for col in df.columns:
            col_memory = memory_usage[col]
            col_data = df[col]
            
            report["column_memory"][col] = {
                "memory_mb": col_memory / (1024 * 1024),
                "memory_bytes": col_memory,
                "dtype": str(col_data.dtype),
                "null_count": col_data.isnull().sum(),
                "unique_count": col_data.nunique()
            }
            
            # Generate optimization suggestions
            if col_data.dtype == 'object':
                unique_ratio = col_data.nunique() / len(col_data)
                if unique_ratio < 0.5:
                    report["optimization_suggestions"].append(
                        f"Column '{col}' could be converted to categorical (unique ratio: {unique_ratio:.2f})"
                    )
            
            elif col_data.dtype == 'int64':
                max_val = col_data.max()
                if max_val <= np.iinfo(np.int32).max:
                    report["optimization_suggestions"].append(
                        f"Column '{col}' could be downcast to int32"
                    )
            
            elif col_data.dtype == 'float64':
                report["optimization_suggestions"].append(
                    f"Column '{col}' could be downcast to float32 if precision allows"
                )
        
        # Find largest columns
        column_sizes = [(col, info["memory_mb"]) for col, info in report["column_memory"].items()]
        report["largest_columns"] = sorted(column_sizes, key=lambda x: x[1], reverse=True)[:5]
        
        return report
        
    except Exception as e:
        raise DataProcessingError(
            "Failed to generate memory usage report",
            context=create_error_context(df_shape=df.shape),
            cause=e
        ) from e


def performance_timer(func):
    """
    Decorator to time function execution and log performance.
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        import time
        start_time = time.time()
        
        try:
            result = func(*args, **kwargs)
            execution_time = time.time() - start_time
            
            # Log performance if logger is available
            try:
                import logging
                logger = logging.getLogger(__name__)
                logger.debug(f"{func.__name__} executed in {execution_time:.4f} seconds")
            except:
                pass  # Ignore logging errors
            
            return result
            
        except Exception as e:
            execution_time = time.time() - start_time
            raise DataProcessingError(
                f"Function {func.__name__} failed after {execution_time:.4f} seconds",
                context=create_error_context(
                    function_name=func.__name__,
                    execution_time=execution_time
                ),
                cause=e
            ) from e
    
    return wrapper


def force_garbage_collection():
    """
    Force garbage collection to free memory.
    """
    try:
        collected = gc.collect()
        return {"objects_collected": collected}
    except Exception as e:
        raise DataProcessingError(
            "Failed to perform garbage collection",
            context=create_error_context(),
            cause=e
        ) from e


def load_historical_data_optimized(
    file_path: str,
    required_columns: Optional[List[str]] = None,
    optimize_dtypes: bool = True,
    chunk_size: Optional[int] = None
) -> pd.DataFrame:
    """
    Load historical data with memory optimization.

    Performance targets:
    - 1Y M15 data: <0.2s load time
    - Memory usage: <35MB per dataset

    Args:
        file_path: Path to the data file
        required_columns: List of columns to load (loads all if None)
        optimize_dtypes: Whether to optimize data types
        chunk_size: Optional chunk size for large files

    Returns:
        Optimized DataFrame
    """
    try:
        # Default columns for OHLCV data
        if required_columns is None:
            required_columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']

        # Optimize data types for common OHLCV columns
        dtype_map = {}
        if optimize_dtypes:
            dtype_map = {
                'open': 'float32',    # Sufficient precision for forex
                'high': 'float32',
                'low': 'float32',
                'close': 'float32',
                'volume': 'uint32'    # Assuming volume fits in uint32
            }
            # Only include dtypes for columns we're actually loading
            dtype_map = {k: v for k, v in dtype_map.items() if k in required_columns}

        # Load data with optimizations
        if chunk_size:
            # Load in chunks for very large files
            chunks = []
            for chunk in pd.read_csv(
                file_path,
                usecols=required_columns,
                dtype=dtype_map,
                parse_dates=['timestamp'] if 'timestamp' in required_columns else None,
                chunksize=chunk_size
            ):
                chunks.append(chunk)

            df = efficient_concat(chunks)
        else:
            # Load entire file
            df = pd.read_csv(
                file_path,
                usecols=required_columns,
                dtype=dtype_map,
                parse_dates=['timestamp'] if 'timestamp' in required_columns else None
            )

        # Set timestamp as index if present
        if 'timestamp' in df.columns:
            df.set_index('timestamp', inplace=True)

        # Further optimize data types if requested
        if optimize_dtypes:
            df = optimize_data_types_for_ohlcv(df)

        return df

    except Exception as e:
        raise DataProcessingError(
            f"Failed to load historical data from {file_path}",
            context=create_error_context(
                file_path=file_path,
                required_columns=required_columns,
                optimize_dtypes=optimize_dtypes,
                chunk_size=chunk_size
            ),
            cause=e
        ) from e


def vectorized_signal_generation(
    df: pd.DataFrame,
    conditions: Dict[str, Union[pd.Series, np.ndarray]],
    signal_values: Dict[str, Any]
) -> pd.Series:
    """
    Generate trading signals using vectorized operations.

    Args:
        df: DataFrame with market data
        conditions: Dictionary of condition name to boolean series
        signal_values: Dictionary of condition name to signal value

    Returns:
        Series with generated signals
    """
    try:
        # Initialize with default signal (e.g., 'HOLD')
        signals = pd.Series('HOLD', index=df.index)

        # Apply conditions in order (later conditions override earlier ones)
        for condition_name, condition in conditions.items():
            if condition_name in signal_values:
                signals = vectorized_where(
                    condition,
                    signal_values[condition_name],
                    signals
                )

        return signals

    except Exception as e:
        raise DataProcessingError(
            "Failed to generate vectorized signals",
            context=create_error_context(
                df_shape=df.shape,
                conditions=list(conditions.keys()),
                signal_values=list(signal_values.keys())
            ),
            cause=e
        ) from e

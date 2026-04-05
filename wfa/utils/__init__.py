# prop_firm_trading_bot/src/utils/__init__.py

"""
Utility modules for the trading bot.

This package provides common utility functions for mathematical operations,
data validation and transformation, file I/O, and pandas optimization.
"""

# Mathematical utilities
from .math_utils import (
    calculate_sharpe_ratio,
    calculate_profit_factor,
    calculate_win_rate,
    calculate_max_drawdown,
    detect_outliers_zscore,
    safe_divide,
    calculate_returns,
    rolling_statistics
)

# Data utilities
from .data_utils import (
    validate_ohlcv_data,
    clean_ohlcv_data,
    resample_ohlcv_data,
    validate_data_completeness,
    filter_data_by_time,
    check_data_types,
    remove_outliers
)

# File utilities
from .file_utils import (
    ensure_directory_exists,
    safe_file_write,
    safe_file_read,
    find_files,
    get_file_info,
    clean_filename,
    generate_timestamped_filename,
    copy_file_with_backup
)

# Pandas optimization utilities
from .pandas_optimization import (
    optimize_dataframe_memory,
    vectorized_where,
    efficient_concat,
    chunked_operation,
    optimize_rolling_operations,
    memory_efficient_groupby,
    optimize_data_types_for_ohlcv,
    memory_usage_report,
    performance_timer,
    force_garbage_collection,
    load_historical_data_optimized,
    vectorized_signal_generation
)

__all__ = [
    # Math utilities
    'calculate_sharpe_ratio',
    'calculate_profit_factor', 
    'calculate_win_rate',
    'calculate_max_drawdown',
    'detect_outliers_zscore',
    'safe_divide',
    'calculate_returns',
    'rolling_statistics',
    
    # Data utilities
    'validate_ohlcv_data',
    'clean_ohlcv_data',
    'resample_ohlcv_data',
    'validate_data_completeness',
    'filter_data_by_time',
    'check_data_types',
    'remove_outliers',
    
    # File utilities
    'ensure_directory_exists',
    'safe_file_write',
    'safe_file_read',
    'find_files',
    'get_file_info',
    'clean_filename',
    'generate_timestamped_filename',
    'copy_file_with_backup',

    # Pandas optimization utilities
    'optimize_dataframe_memory',
    'vectorized_where',
    'efficient_concat',
    'chunked_operation',
    'optimize_rolling_operations',
    'memory_efficient_groupby',
    'optimize_data_types_for_ohlcv',
    'memory_usage_report',
    'performance_timer',
    'force_garbage_collection',
    'load_historical_data_optimized',
    'vectorized_signal_generation'
]


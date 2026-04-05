# prop_firm_trading_bot/src/types.py

"""
Type aliases for complex types used throughout the trading bot application.

This module defines type aliases to improve code readability and maintainability
by providing meaningful names for complex type annotations.
"""

from typing import Dict, List, Any, Optional, Union, Tuple, Callable
from datetime import datetime
import pandas as pd

# Strategy and Configuration Types
StrategyParameters = Dict[str, Any]
"""Type alias for strategy parameter dictionaries."""

ConfigDict = Dict[str, Any]
"""Type alias for configuration dictionaries."""

# Data Types
OHLCVDict = Dict[str, Union[float, datetime]]
"""Type alias for OHLCV data dictionaries."""

IndicatorConfig = Dict[str, Dict[str, Any]]
"""Type alias for indicator configuration dictionaries."""

TimeSeriesData = pd.DataFrame
"""Type alias for time series data (pandas DataFrame)."""

# Backtest Result Types
BacktestResults = Dict[str, Any]
"""Type alias for backtest result dictionaries."""

PerformanceMetrics = Dict[str, Union[float, int]]
"""Type alias for performance metrics dictionaries."""

TradeResults = List[Dict[str, Any]]
"""Type alias for lists of trade result dictionaries."""

# Walk-Forward Analysis Types
WindowResults = List[Dict[str, Any]]
"""Type alias for walk-forward window results."""

ParameterCombination = Dict[str, Union[int, float, str, bool]]
"""Type alias for parameter combination dictionaries."""

OptimizationResults = Dict[str, Any]
"""Type alias for optimization result dictionaries."""

# Callback Types
DataCallback = Callable[[str, Any], None]
"""Type alias for data callback functions."""

ProgressCallback = Callable[[float], None]
"""Type alias for progress callback functions."""

# File Path Types
FilePath = str
"""Type alias for file path strings."""

DirectoryPath = str
"""Type alias for directory path strings."""

# Symbol and Market Data Types
Symbol = str
"""Type alias for trading symbol strings."""

Price = float
"""Type alias for price values."""

Volume = float
"""Type alias for volume values."""

# Time-related Types
Timestamp = datetime
"""Type alias for timestamp values."""

TimeWindow = Tuple[datetime, datetime]
"""Type alias for time window tuples (start, end)."""

# Error and Status Types
ErrorMessage = str
"""Type alias for error message strings."""

StatusCode = int
"""Type alias for status code integers."""

# Validation Types
ValidationResult = Tuple[bool, Optional[str]]
"""Type alias for validation results (success, error_message)."""

ValidationErrors = List[str]
"""Type alias for lists of validation error messages."""

# Network and API Types
APIResponse = Dict[str, Any]
"""Type alias for API response dictionaries."""

HTTPHeaders = Dict[str, str]
"""Type alias for HTTP headers dictionaries."""

# Logging Types
LogLevel = str
"""Type alias for log level strings."""

LogMessage = str
"""Type alias for log message strings."""

# Mathematical Types
Percentage = float
"""Type alias for percentage values (0.0 to 100.0)."""

Ratio = float
"""Type alias for ratio values (typically 0.0 to 1.0)."""

# Portfolio and Risk Types
PositionSize = float
"""Type alias for position size values."""

RiskAmount = float
"""Type alias for risk amount values."""

# State Management Types
StateData = Dict[str, Any]
"""Type alias for state data dictionaries."""

SerializedState = str
"""Type alias for serialized state strings."""

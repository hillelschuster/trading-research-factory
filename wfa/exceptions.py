# prop_firm_trading_bot/src/exceptions.py

"""
Custom exception hierarchy for the prop firm trading bot.

This module defines domain-specific exceptions that provide better error handling
and debugging capabilities throughout the application. The hierarchy follows
Python best practices with specific exceptions for different error categories.

Exception Hierarchy:
    TradingBotError (base)
    ├── ConfigurationError
    │   ├── InvalidConfigurationError
    │   ├── MissingConfigurationError
    │   └── ConfigurationValidationError
    ├── DataError
    │   ├── DataValidationError
    │   ├── DataLoadingError
    │   ├── DataProcessingError
    │   └── IndicatorCalculationError
    ├── BacktestError
    │   ├── BacktestExecutionError
    │   ├── BacktestDataError
    │   └── BacktestValidationError
    ├── OptimizationError
    │   ├── ParameterValidationError
    │   ├── OptimizationExecutionError
    │   └── TrialEvaluationError
    ├── StrategyError
    │   ├── StrategyInitializationError
    │   ├── StrategyExecutionError
    │   └── SignalGenerationError
    ├── PlatformError
    │   ├── ConnectionError
    │   ├── AuthenticationError
    │   ├── APIError
    │   └── OrderExecutionError
    └── RecoverableError (for transient failures)
        ├── TemporaryDataUnavailableError
        ├── NetworkTimeoutError
        └── ResourceBusyError
"""

from typing import Optional, Dict, Any, List
import traceback
from datetime import datetime


class TradingBotError(Exception):
    """
    Base exception class for all trading bot errors.
    
    Provides enhanced error context and logging capabilities.
    All custom exceptions in the trading bot should inherit from this class.
    """
    
    def __init__(
        self,
        message: str,
        error_code: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
        recoverable: bool = False
    ):
        """
        Initialize the trading bot error.
        
        Args:
            message: Human-readable error message
            error_code: Optional error code for programmatic handling
            context: Optional dictionary with additional error context
            cause: Optional underlying exception that caused this error
            recoverable: Whether this error might be recoverable with retry
        """
        super().__init__(message)
        self.message = message
        self.error_code = error_code or self.__class__.__name__
        self.context = context or {}
        self.cause = cause
        self.recoverable = recoverable
        self.timestamp = datetime.utcnow()
        
        # Add stack trace information
        self.stack_trace = traceback.format_stack()
        
    def get_context_info(self) -> Dict[str, Any]:
        """
        Get comprehensive error context information.
        
        Returns:
            Dictionary containing error details and context
        """
        return {
            'error_type': self.__class__.__name__,
            'error_code': self.error_code,
            'message': self.message,
            'timestamp': self.timestamp.isoformat(),
            'recoverable': self.recoverable,
            'context': self.context,
            'cause': str(self.cause) if self.cause else None,
            'cause_type': type(self.cause).__name__ if self.cause else None
        }
    
    def __str__(self) -> str:
        """Enhanced string representation with context."""
        base_msg = f"{self.error_code}: {self.message}"
        if self.context:
            context_str = ", ".join(f"{k}={v}" for k, v in self.context.items())
            base_msg += f" (Context: {context_str})"
        if self.cause:
            base_msg += f" (Caused by: {self.cause})"
        return base_msg


# Configuration Errors
class ConfigurationError(TradingBotError):
    """Base class for configuration-related errors."""
    pass


class InvalidConfigurationError(ConfigurationError):
    """Raised when configuration values are invalid."""
    pass


class MissingConfigurationError(ConfigurationError):
    """Raised when required configuration is missing."""
    pass


class ConfigurationValidationError(ConfigurationError):
    """Raised when configuration validation fails."""
    pass


# Data Errors
class DataError(TradingBotError):
    """Base class for data-related errors."""
    pass


class DataValidationError(DataError):
    """Raised when data validation fails."""
    pass


class DataNotFoundError(DataError):
    """
    Raised when requested data is not available and no fallback is allowed.

    This exception is used to implement fail-fast behavior in the data pipeline,
    preventing silent fallbacks to synthetic data generation during backtesting.
    """

    def __init__(self, message: str, symbol: str = None, timeframe: str = None,
                 requested_range: str = None, available_range: str = None):
        """
        Initialize DataNotFoundError with detailed context.

        Args:
            message: Error description
            symbol: Trading symbol that was requested
            timeframe: Timeframe that was requested
            requested_range: Date range that was requested
            available_range: Date range that is available (if any)
        """
        super().__init__(message)
        self.symbol = symbol
        self.timeframe = timeframe
        self.requested_range = requested_range
        self.available_range = available_range

    def __str__(self):
        base_msg = super().__str__()
        context_parts = []

        if self.symbol:
            context_parts.append(f"Symbol: {self.symbol}")
        if self.timeframe:
            context_parts.append(f"Timeframe: {self.timeframe}")
        if self.requested_range:
            context_parts.append(f"Requested: {self.requested_range}")
        if self.available_range:
            context_parts.append(f"Available: {self.available_range}")

        if context_parts:
            return f"{base_msg} [{', '.join(context_parts)}]"
        return base_msg


class BacktestDataError(DataError):
    """
    Raised when backtest data configuration or access fails.

    This exception indicates issues with backtest-specific data handling,
    such as missing backtest data configuration or invalid data ranges.
    """
    pass


class DataLoadingError(DataError):
    """Raised when data loading fails."""
    pass


class DataProcessingError(DataError):
    """Raised when data processing fails."""
    pass


class IndicatorCalculationError(DataError):
    """Raised when technical indicator calculation fails."""
    pass


# Backtest Errors
class BacktestError(TradingBotError):
    """Base class for backtesting-related errors."""
    pass


class BacktestExecutionError(BacktestError):
    """Raised when backtest execution fails."""
    pass


class BacktestDataError(BacktestError):
    """Raised when backtest data is invalid or insufficient."""
    pass


class BacktestValidationError(BacktestError):
    """Raised when backtest validation fails."""
    pass


# Optimization Errors
class OptimizationError(TradingBotError):
    """Base class for optimization-related errors."""
    pass


class ParameterValidationError(OptimizationError):
    """Raised when parameter validation fails."""
    pass


class OptimizationExecutionError(OptimizationError):
    """Raised when optimization execution fails."""
    pass


class TrialEvaluationError(OptimizationError):
    """Raised when individual trial evaluation fails."""
    pass


# Strategy Errors
class StrategyError(TradingBotError):
    """Base class for strategy-related errors."""
    pass


class StrategyInitializationError(StrategyError):
    """Raised when strategy initialization fails."""
    pass


class StrategyExecutionError(StrategyError):
    """Raised when strategy execution fails."""
    pass


class SignalGenerationError(StrategyError):
    """Raised when signal generation fails."""
    pass


# Platform Errors
class PlatformError(TradingBotError):
    """Base class for platform/broker-related errors."""
    pass


class ConnectionError(PlatformError):
    """Raised when platform connection fails."""
    pass


class AuthenticationError(PlatformError):
    """Raised when platform authentication fails."""
    pass


class APIError(PlatformError):
    """Raised when platform API calls fail."""
    pass


class OrderExecutionError(PlatformError):
    """Raised when order execution fails."""
    pass


# Recoverable Errors
class RecoverableError(TradingBotError):
    """
    Base class for errors that might be recoverable with retry.
    
    These errors typically represent transient conditions that may resolve
    themselves after a short delay or retry attempt.
    """
    
    def __init__(self, message: str, **kwargs):
        kwargs['recoverable'] = True
        super().__init__(message, **kwargs)


class TemporaryDataUnavailableError(RecoverableError):
    """Raised when data is temporarily unavailable."""
    pass


class NetworkTimeoutError(RecoverableError):
    """Raised when network operations timeout."""
    pass


class ResourceBusyError(RecoverableError):
    """Raised when a resource is temporarily busy."""
    pass


# Utility Functions
def create_error_context(**kwargs) -> Dict[str, Any]:
    """
    Create a standardized error context dictionary.
    
    Args:
        **kwargs: Key-value pairs to include in context
        
    Returns:
        Dictionary with error context information
    """
    return {k: v for k, v in kwargs.items() if v is not None}


def chain_exception(new_exception: Exception, cause: Exception) -> Exception:
    """
    Chain exceptions using the 'from' keyword pattern.
    
    Args:
        new_exception: The new exception to raise
        cause: The underlying exception that caused the new one
        
    Returns:
        The new exception with proper chaining
    """
    new_exception.__cause__ = cause
    return new_exception

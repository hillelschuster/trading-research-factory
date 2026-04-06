# prop_firm_trading_bot/src/error_handling.py

"""
Error handling utilities and patterns for the prop firm trading bot.

This module provides standardized error handling patterns, retry mechanisms,
and graceful degradation utilities that can be used throughout the application.
"""

import logging
import time
import functools
from typing import (
    Callable, TypeVar, Any, Optional, Dict, List, Type, Union, Tuple
)
from contextlib import contextmanager
from datetime import datetime, timedelta

from .exceptions import (
    TradingBotError, RecoverableError, NetworkTimeoutError,
    ResourceBusyError, create_error_context
)

# Type variables for generic functions
T = TypeVar('T')
F = TypeVar('F', bound=Callable[..., Any])


class ErrorHandler:
    """
    Centralized error handling and logging utility.
    
    Provides consistent error logging, context capture, and recovery mechanisms
    throughout the application.
    """
    
    def __init__(self, logger: logging.Logger, component_name: str):
        """
        Initialize the error handler.
        
        Args:
            logger: Logger instance for error reporting
            component_name: Name of the component using this handler
        """
        self.logger = logger
        self.component_name = component_name
        self.error_counts: Dict[str, int] = {}
        self.last_errors: Dict[str, datetime] = {}
    
    def handle_error(
        self,
        error: Exception,
        context: Optional[Dict[str, Any]] = None,
        operation: Optional[str] = None,
        reraise: bool = True
    ) -> None:
        """
        Handle an error with proper logging and context capture.
        
        Args:
            error: The exception that occurred
            context: Additional context information
            operation: Name of the operation that failed
            reraise: Whether to re-raise the exception after logging
        """
        error_type = type(error).__name__
        self.error_counts[error_type] = self.error_counts.get(error_type, 0) + 1
        self.last_errors[error_type] = datetime.utcnow()
        
        # Build comprehensive error context
        error_context = {
            'component': self.component_name,
            'operation': operation,
            'error_type': error_type,
            'error_count': self.error_counts[error_type],
            'timestamp': datetime.utcnow().isoformat()
        }
        
        if context:
            error_context.update(context)
        
        # Add context from TradingBotError if available
        if isinstance(error, TradingBotError):
            error_context.update(error.get_context_info())
        
        # Log the error with appropriate level
        if isinstance(error, RecoverableError):
            self.logger.warning(
                f"Recoverable error in {self.component_name}: {error}",
                extra=error_context,
                exc_info=True
            )
        else:
            self.logger.error(
                f"Error in {self.component_name}: {error}",
                extra=error_context,
                exc_info=True
            )
        
        if reraise:
            raise error
    
    def get_error_statistics(self) -> Dict[str, Any]:
        """
        Get error statistics for monitoring and debugging.
        
        Returns:
            Dictionary with error counts and timing information
        """
        return {
            'component': self.component_name,
            'error_counts': self.error_counts.copy(),
            'last_errors': {
                error_type: timestamp.isoformat()
                for error_type, timestamp in self.last_errors.items()
            },
            'total_errors': sum(self.error_counts.values())
        }


def retry_on_error(
    max_attempts: int = 3,
    delay: float = 1.0,
    backoff_factor: float = 2.0,
    exceptions: Tuple[Type[Exception], ...] = (RecoverableError,),
    logger: Optional[logging.Logger] = None
) -> Callable[[F], F]:
    """
    Decorator for retrying operations that may fail with recoverable errors.
    
    Args:
        max_attempts: Maximum number of retry attempts
        delay: Initial delay between retries in seconds
        backoff_factor: Factor to multiply delay by after each failure
        exceptions: Tuple of exception types to retry on
        logger: Optional logger for retry information
        
    Returns:
        Decorated function with retry logic
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            current_delay = delay
            
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    
                    if attempt == max_attempts - 1:
                        # Last attempt failed, re-raise
                        if logger:
                            logger.error(
                                f"Function {func.__name__} failed after {max_attempts} attempts: {e}",
                                exc_info=True
                            )
                        raise
                    
                    # Log retry attempt
                    if logger:
                        logger.warning(
                            f"Function {func.__name__} failed (attempt {attempt + 1}/{max_attempts}), "
                            f"retrying in {current_delay:.1f}s: {e}"
                        )
                    
                    time.sleep(current_delay)
                    current_delay *= backoff_factor
                except Exception as e:
                    # Non-recoverable error, don't retry
                    if logger:
                        logger.error(
                            f"Function {func.__name__} failed with non-recoverable error: {e}",
                            exc_info=True
                        )
                    raise
            
            # This should never be reached, but just in case
            if last_exception:
                raise last_exception
                
        return wrapper
    return decorator


@contextmanager
def error_context(
    operation: str,
    logger: logging.Logger,
    component: str = "Unknown",
    reraise: bool = True,
    default_return: Any = None
):
    """
    Context manager for standardized error handling.
    
    Args:
        operation: Name of the operation being performed
        logger: Logger for error reporting
        component: Component name for context
        reraise: Whether to re-raise exceptions
        default_return: Default value to return on error (if not reraising)
        
    Yields:
        None
        
    Example:
        with error_context("data_loading", logger, "DataManager"):
            # Risky operation here
            data = load_data()
    """
    start_time = time.time()
    
    try:
        yield
    except Exception as e:
        execution_time = time.time() - start_time
        
        error_info = create_error_context(
            operation=operation,
            component=component,
            execution_time_seconds=execution_time,
            timestamp=datetime.utcnow().isoformat()
        )
        
        if isinstance(e, TradingBotError):
            error_info.update(e.get_context_info())
        
        logger.error(
            f"Operation '{operation}' failed in {component}: {e}",
            extra=error_info,
            exc_info=True
        )
        
        if reraise:
            raise
        else:
            return default_return


def graceful_degradation(
    fallback_func: Callable[..., T],
    logger: logging.Logger,
    operation_name: str = "operation"
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """
    Decorator for graceful degradation when primary operation fails.
    
    Args:
        fallback_func: Function to call if primary function fails
        logger: Logger for degradation warnings
        operation_name: Name of the operation for logging
        
    Returns:
        Decorated function with fallback behavior
    """
    def decorator(primary_func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(primary_func)
        def wrapper(*args, **kwargs) -> T:
            try:
                return primary_func(*args, **kwargs)
            except Exception as e:
                logger.warning(
                    f"Primary {operation_name} failed, falling back to alternative: {e}",
                    exc_info=True
                )
                try:
                    return fallback_func(*args, **kwargs)
                except Exception as fallback_error:
                    logger.error(
                        f"Fallback {operation_name} also failed: {fallback_error}",
                        exc_info=True
                    )
                    # Chain the exceptions to show both failures
                    raise TradingBotError(
                        f"Both primary and fallback {operation_name} failed",
                        context=create_error_context(
                            primary_error=str(e),
                            fallback_error=str(fallback_error)
                        ),
                        cause=e
                    ) from fallback_error
        
        return wrapper
    return decorator


def validate_and_handle_errors(
    validation_func: Callable[[Any], bool],
    error_message: str,
    error_class: Type[TradingBotError] = TradingBotError,
    context: Optional[Dict[str, Any]] = None
) -> Callable[[F], F]:
    """
    Decorator for input validation with custom error handling.
    
    Args:
        validation_func: Function that returns True if input is valid
        error_message: Error message for validation failure
        error_class: Exception class to raise on validation failure
        context: Additional context for the error
        
    Returns:
        Decorated function with input validation
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Validate all arguments
            all_args = list(args) + list(kwargs.values())
            for arg in all_args:
                if not validation_func(arg):
                    raise error_class(
                        error_message,
                        context=create_error_context(
                            function=func.__name__,
                            invalid_argument=str(arg),
                            **(context or {})
                        )
                    )
            
            return func(*args, **kwargs)
        
        return wrapper
    return decorator


class CircuitBreaker:
    """
    Circuit breaker pattern implementation for preventing cascading failures.
    
    Monitors failure rates and temporarily disables operations when failure
    threshold is exceeded, allowing the system to recover.
    """
    
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        expected_exception: Type[Exception] = Exception
    ):
        """
        Initialize the circuit breaker.
        
        Args:
            failure_threshold: Number of failures before opening circuit
            recovery_timeout: Seconds to wait before attempting recovery
            expected_exception: Exception type that triggers the circuit breaker
        """
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception
        
        self.failure_count = 0
        self.last_failure_time: Optional[datetime] = None
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
    
    def __call__(self, func: F) -> F:
        """Make the circuit breaker work as a decorator."""
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if self.state == "OPEN":
                if self._should_attempt_reset():
                    self.state = "HALF_OPEN"
                else:
                    raise TradingBotError(
                        f"Circuit breaker is OPEN for {func.__name__}",
                        context=create_error_context(
                            failure_count=self.failure_count,
                            last_failure=self.last_failure_time.isoformat() if self.last_failure_time else None
                        )
                    )
            
            try:
                result = func(*args, **kwargs)
                self._on_success()
                return result
            except self.expected_exception as e:
                self._on_failure()
                raise
        
        return wrapper
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt reset."""
        if not self.last_failure_time:
            return True
        
        return (datetime.utcnow() - self.last_failure_time).total_seconds() > self.recovery_timeout
    
    def _on_success(self) -> None:
        """Handle successful operation."""
        self.failure_count = 0
        self.state = "CLOSED"
    
    def _on_failure(self) -> None:
        """Handle failed operation."""
        self.failure_count += 1
        self.last_failure_time = datetime.utcnow()
        
        if self.failure_count >= self.failure_threshold:
            self.state = "OPEN"

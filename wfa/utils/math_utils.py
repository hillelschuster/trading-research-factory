# prop_firm_trading_bot/src/utils/math_utils.py

"""
Mathematical and statistical utility functions for the trading bot.

This module consolidates common mathematical operations, statistical calculations,
and financial metrics that are used across multiple components of the trading bot.
"""

import numpy as np
import pandas as pd
from typing import List, Optional, Union, Tuple, Dict, Any
import warnings

from src.exceptions import DataValidationError, create_error_context


def calculate_sharpe_ratio(
    returns: Union[pd.Series, np.ndarray, List[float]],
    risk_free_rate: float = 0.0,
    periods_per_year: int = 252,
    method: str = "standard"
) -> float:
    """
    Calculate Sharpe ratio from returns series.
    
    Args:
        returns: Series of returns (can be daily, monthly, etc.)
        risk_free_rate: Risk-free rate (annualized)
        periods_per_year: Number of periods per year for annualization
        method: Calculation method ('standard', 'modified', 'simple')
        
    Returns:
        Sharpe ratio (annualized)
        
    Raises:
        DataValidationError: If returns data is invalid
    """
    try:
        # Convert to numpy array for consistent handling
        returns_array = np.asarray(returns, dtype=np.float64)
        
        # Validate input
        if len(returns_array) == 0:
            raise DataValidationError(
                "Returns array is empty",
                context=create_error_context(returns_length=0)
            )
        
        # Remove NaN values
        returns_clean = returns_array[~np.isnan(returns_array)]
        
        if len(returns_clean) < 2:
            return np.nan
        
        # Calculate periodic risk-free rate
        periodic_risk_free_rate = risk_free_rate / periods_per_year
        
        # Calculate excess returns
        excess_returns = returns_clean - periodic_risk_free_rate
        
        # Calculate mean and standard deviation
        mean_excess_return = np.mean(excess_returns)
        std_excess_return = np.std(excess_returns, ddof=1)
        
        if std_excess_return == 0:
            return np.inf if mean_excess_return > 0 else (
                -np.inf if mean_excess_return < 0 else np.nan
            )
        
        # Calculate Sharpe ratio based on method
        if method == "standard":
            sharpe = mean_excess_return / std_excess_return
            return sharpe * np.sqrt(periods_per_year)
        elif method == "modified":
            # Modified Sharpe ratio using downside deviation
            downside_returns = excess_returns[excess_returns < 0]
            if len(downside_returns) == 0:
                return np.inf
            downside_std = np.std(downside_returns, ddof=1)
            if downside_std == 0:
                return np.inf
            sharpe = mean_excess_return / downside_std
            return sharpe * np.sqrt(periods_per_year)
        elif method == "simple":
            # Simple ratio without annualization
            return mean_excess_return / std_excess_return
        else:
            raise DataValidationError(
                f"Unknown Sharpe ratio method: {method}",
                context=create_error_context(method=method, available_methods=["standard", "modified", "simple"])
            )
            
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataValidationError(
            "Failed to calculate Sharpe ratio",
            context=create_error_context(
                returns_type=type(returns).__name__,
                returns_length=len(returns) if hasattr(returns, '__len__') else None,
                risk_free_rate=risk_free_rate,
                method=method
            ),
            cause=e
        ) from e


def calculate_profit_factor(
    pnl_values: Union[pd.Series, np.ndarray, List[float]]
) -> float:
    """
    Calculate profit factor from PnL values.
    
    Args:
        pnl_values: Series of profit/loss values
        
    Returns:
        Profit factor (gross profit / gross loss)
    """
    try:
        pnl_array = np.asarray(pnl_values, dtype=np.float64)
        pnl_clean = pnl_array[~np.isnan(pnl_array)]
        
        if len(pnl_clean) == 0:
            return np.nan
        
        winning_trades = pnl_clean[pnl_clean > 0]
        losing_trades = pnl_clean[pnl_clean < 0]
        
        gross_profit = np.sum(winning_trades) if len(winning_trades) > 0 else 0.0
        gross_loss = abs(np.sum(losing_trades)) if len(losing_trades) > 0 else 0.0
        
        if gross_loss == 0:
            return np.inf if gross_profit > 0 else np.nan
        
        return gross_profit / gross_loss
        
    except Exception as e:
        raise DataValidationError(
            "Failed to calculate profit factor",
            context=create_error_context(
                pnl_length=len(pnl_values) if hasattr(pnl_values, '__len__') else None
            ),
            cause=e
        ) from e


def calculate_win_rate(
    pnl_values: Union[pd.Series, np.ndarray, List[float]]
) -> float:
    """
    Calculate win rate from PnL values.
    
    Args:
        pnl_values: Series of profit/loss values
        
    Returns:
        Win rate as percentage (0-100)
    """
    try:
        pnl_array = np.asarray(pnl_values, dtype=np.float64)
        pnl_clean = pnl_array[~np.isnan(pnl_array)]
        
        if len(pnl_clean) == 0:
            return np.nan
        
        winning_trades = np.sum(pnl_clean > 0)
        total_trades = len(pnl_clean)
        
        return (winning_trades / total_trades) * 100.0
        
    except Exception as e:
        raise DataValidationError(
            "Failed to calculate win rate",
            context=create_error_context(
                pnl_length=len(pnl_values) if hasattr(pnl_values, '__len__') else None
            ),
            cause=e
        ) from e


def calculate_max_drawdown(
    equity_curve: Union[pd.Series, np.ndarray, List[float]],
    return_both: bool = False
) -> Union[float, Tuple[float, float]]:
    """
    Calculate maximum drawdown from equity curve.
    
    Args:
        equity_curve: Series of equity values
        return_both: If True, return both absolute and percentage drawdown
        
    Returns:
        Maximum drawdown percentage, or tuple of (absolute, percentage) if return_both=True
    """
    try:
        equity_series = pd.Series(equity_curve)
        
        if equity_series.empty:
            return (np.nan, np.nan) if return_both else np.nan
        
        # Calculate running maximum (peak)
        peak_equity = equity_series.cummax()
        
        # Calculate drawdown values
        drawdown_values = peak_equity - equity_series
        max_drawdown_absolute = drawdown_values.max()
        
        # Calculate percentage drawdown
        valid_peaks = peak_equity > 0
        if not valid_peaks.any():
            max_drawdown_percentage = np.nan
        else:
            drawdown_percentages = pd.Series(np.zeros_like(peak_equity.values, dtype=float))
            drawdown_percentages[valid_peaks] = (
                drawdown_values[valid_peaks] / peak_equity[valid_peaks]
            )
            max_drawdown_percentage = drawdown_percentages.max() * 100
        
        if return_both:
            return max_drawdown_absolute, max_drawdown_percentage
        else:
            return max_drawdown_percentage
            
    except Exception as e:
        raise DataValidationError(
            "Failed to calculate maximum drawdown",
            context=create_error_context(
                equity_length=len(equity_curve) if hasattr(equity_curve, '__len__') else None
            ),
            cause=e
        ) from e


def detect_outliers_zscore(
    data: Union[pd.Series, np.ndarray, List[float]],
    threshold: float = 3.0
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Detect outliers using Z-score method.
    
    Args:
        data: Data series to analyze
        threshold: Z-score threshold for outlier detection
        
    Returns:
        Tuple of (outlier_mask, outlier_info)
    """
    try:
        data_array = np.asarray(data, dtype=np.float64)
        data_clean = data_array[~np.isnan(data_array)]
        
        if len(data_clean) == 0:
            return np.array([]), {"count": 0, "percentage": 0.0}
        
        # Calculate Z-scores
        mean_val = np.mean(data_clean)
        std_val = np.std(data_clean)
        
        if std_val == 0:
            outlier_mask = np.zeros(len(data_array), dtype=bool)
        else:
            z_scores = np.abs((data_array - mean_val) / std_val)
            outlier_mask = z_scores > threshold
        
        outlier_info = {
            "count": np.sum(outlier_mask),
            "percentage": (np.sum(outlier_mask) / len(data_array)) * 100,
            "threshold": threshold,
            "mean": mean_val,
            "std": std_val
        }
        
        return outlier_mask, outlier_info
        
    except Exception as e:
        raise DataValidationError(
            "Failed to detect outliers",
            context=create_error_context(
                data_length=len(data) if hasattr(data, '__len__') else None,
                threshold=threshold
            ),
            cause=e
        ) from e


def safe_divide(
    numerator: Union[float, np.ndarray],
    denominator: Union[float, np.ndarray],
    default: float = np.nan
) -> Union[float, np.ndarray]:
    """
    Perform safe division with handling for zero denominators.
    
    Args:
        numerator: Numerator value(s)
        denominator: Denominator value(s)
        default: Value to return when denominator is zero
        
    Returns:
        Division result or default value
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            
            if np.isscalar(denominator):
                if denominator == 0:
                    return default
                return numerator / denominator
            else:
                result = np.divide(
                    numerator, 
                    denominator, 
                    out=np.full_like(numerator, default, dtype=float),
                    where=(denominator != 0)
                )
                return result
                
    except Exception as e:
        raise DataValidationError(
            "Failed to perform safe division",
            context=create_error_context(
                numerator_type=type(numerator).__name__,
                denominator_type=type(denominator).__name__,
                default=default
            ),
            cause=e
        ) from e


def calculate_returns(
    prices: Union[pd.Series, np.ndarray, List[float]],
    method: str = "simple"
) -> np.ndarray:
    """
    Calculate returns from price series.
    
    Args:
        prices: Price series
        method: Return calculation method ('simple', 'log')
        
    Returns:
        Array of returns
    """
    try:
        price_array = np.asarray(prices, dtype=np.float64)
        
        if len(price_array) < 2:
            return np.array([])
        
        if method == "simple":
            returns = np.diff(price_array) / price_array[:-1]
        elif method == "log":
            returns = np.diff(np.log(price_array))
        else:
            raise DataValidationError(
                f"Unknown return calculation method: {method}",
                context=create_error_context(
                    method=method,
                    available_methods=["simple", "log"]
                )
            )
        
        return returns
        
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataValidationError(
            "Failed to calculate returns",
            context=create_error_context(
                prices_length=len(prices) if hasattr(prices, '__len__') else None,
                method=method
            ),
            cause=e
        ) from e


def rolling_statistics(
    data: Union[pd.Series, np.ndarray, List[float]],
    window: int,
    statistics: List[str] = None
) -> Dict[str, np.ndarray]:
    """
    Calculate rolling statistics for a data series.
    
    Args:
        data: Data series
        window: Rolling window size
        statistics: List of statistics to calculate ['mean', 'std', 'min', 'max']
        
    Returns:
        Dictionary of statistic name to array
    """
    if statistics is None:
        statistics = ['mean', 'std']
    
    try:
        data_series = pd.Series(data)
        results = {}
        
        for stat in statistics:
            if stat == 'mean':
                results[stat] = data_series.rolling(window).mean().values
            elif stat == 'std':
                results[stat] = data_series.rolling(window).std().values
            elif stat == 'min':
                results[stat] = data_series.rolling(window).min().values
            elif stat == 'max':
                results[stat] = data_series.rolling(window).max().values
            else:
                raise DataValidationError(
                    f"Unknown statistic: {stat}",
                    context=create_error_context(
                        statistic=stat,
                        available_statistics=['mean', 'std', 'min', 'max']
                    )
                )
        
        return results
        
    except Exception as e:
        if isinstance(e, DataValidationError):
            raise
        raise DataValidationError(
            "Failed to calculate rolling statistics",
            context=create_error_context(
                data_length=len(data) if hasattr(data, '__len__') else None,
                window=window,
                statistics=statistics
            ),
            cause=e
        ) from e

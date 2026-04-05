"""Bollinger Bands mean-reversion strategy for crypto assets.

Buy when price touches lower band (oversold), sell when price touches
upper band (overbought). Uses configurable period and standard deviation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

import pandas as pd

DEFAULT_PARAM_GRID = {
    "period": [14, 20, 30],
    "std_dev": [1.5, 2.0, 2.5]
}


@dataclass
class StrategyResult:
    signal: pd.Series


def generate_signal(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> pd.Series:
    """Generate trading signals based on Bollinger Bands.
    
    Args:
        df: DataFrame with 'close' column
        period: Period for moving average and standard deviation calculation
        std_dev: Number of standard deviations for upper/lower bands
    
    Returns:
        Signal series (1 = long, 0 = flat)
    """
    if period < 2:
        raise ValueError("period must be at least 2")
    if std_dev <= 0:
        raise ValueError("std_dev must be positive")
    
    # Calculate middle band (SMA)
    middle_band = df["close"].rolling(period).mean()
    
    # Calculate standard deviation
    std = df["close"].rolling(period).std()
    
    # Calculate upper and lower bands
    upper_band = middle_band + (std_dev * std)
    lower_band = middle_band - (std_dev * std)
    
    # Generate signals
    # Buy when price touches or crosses below lower band
    # Sell when price touches or crosses above upper band
    signal = pd.Series(0, index=df.index)
    
    price = df["close"]
    
    # Long entry: price was above lower band and now at or below it
    was_above_lower = price.shift(1) > lower_band.shift(1)
    is_at_lower = price <= lower_band
    long_entry = was_above_lower & is_at_lower
    
    # Long exit: price was below upper band and now at or above it
    was_below_upper = price.shift(1) < upper_band.shift(1)
    is_at_upper = price >= upper_band
    long_exit = was_below_upper & is_at_upper
    
    # Alternative exit: price crosses back above middle band (take profit)
    was_below_middle = price.shift(1) < middle_band.shift(1)
    is_above_middle = price >= middle_band
    middle_exit = was_below_middle & is_above_middle
    
    # Build signal series with state machine
    in_position = False
    for i in range(len(df)):
        if i < period:
            # Not enough data for signals
            continue
            
        if long_entry.iloc[i] and not in_position:
            in_position = True
        elif (long_exit.iloc[i] or middle_exit.iloc[i]) and in_position:
            in_position = False
        
        signal.iloc[i] = 1 if in_position else 0
    
    return signal.fillna(0)

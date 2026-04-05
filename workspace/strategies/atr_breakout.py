"""ATR-based volatility breakout strategy for crypto markets.

Buy when price breaks above N-period high + ATR multiplier, sell when price 
breaks below the breakout level - ATR multiplier. Uses dynamic stops based
on Average True Range to adapt to volatility regime changes.
"""
from __future__ import annotations

from dataclasses import dataclass
import pandas as pd

DEFAULT_PARAM_GRID = {
    "atr_period": [14, 21, 28],
    "atr_multiplier": [1.5, 2.0, 2.5],
    "lookback_period": [20, 30, 40]
}


@dataclass
class StrategyResult:
    signal: pd.Series


def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Calculate Average True Range."""
    high = df["high"]
    low = df["low"]
    close = df["close"]
    
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(period).mean()
    return atr


def generate_signal(
    df: pd.DataFrame,
    atr_period: int = 14,
    atr_multiplier: float = 2.0,
    lookback_period: int = 20
) -> pd.Series:
    """Generate trading signals based on ATR volatility breakout.
    
    Args:
        df: DataFrame with 'high', 'low', 'close' columns
        atr_period: Period for ATR calculation
        atr_multiplier: Multiplier for ATR-based stop levels
        lookback_period: Period for finding breakout level
    
    Returns:
        Signal series (1 = long, 0 = flat)
    """
    if atr_period < 1:
        raise ValueError("atr_period must be >= 1")
    if atr_multiplier <= 0:
        raise ValueError("atr_multiplier must be > 0")
    if lookback_period < 1:
        raise ValueError("lookback_period must be >= 1")
    
    # Calculate ATR
    atr = calculate_atr(df, atr_period)
    
    # Calculate rolling high (breakout level)
    rolling_high = df["high"].rolling(lookback_period).max()
    
    # Calculate upper band (breakout threshold)
    upper_band = rolling_high + (atr * atr_multiplier)
    
    # Calculate lower band (stop level - tracks the breakout level)
    lower_band = rolling_high - (atr * atr_multiplier)
    
    # Generate signals
    # Entry: price breaks above upper band
    # Exit: price falls below lower band
    signal = pd.Series(0, index=df.index)
    
    in_position = False
    entry_price = 0.0
    
    for i in range(lookback_period + atr_period, len(df)):
        current_price = df["close"].iloc[i]
        current_upper = upper_band.iloc[i]
        current_lower = lower_band.iloc[i]
        
        if pd.isna(current_upper) or pd.isna(current_lower):
            continue
        
        if not in_position:
            # Check for breakout entry
            if current_price > current_upper:
                in_position = True
                entry_price = current_price
                signal.iloc[i] = 1
        else:
            # Check for exit (stop loss or price falls below lower band)
            if current_price < current_lower:
                in_position = False
                entry_price = 0.0
            else:
                signal.iloc[i] = 1
    
    return signal.fillna(0)

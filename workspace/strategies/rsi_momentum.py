"""RSI-based momentum strategy for crypto assets.

Buy when RSI crosses above oversold threshold (30), sell when RSI crosses
below overbought threshold (70). Designed for crypto volatility.
"""
from __future__ import annotations

from dataclasses import dataclass
import pandas as pd

DEFAULT_PARAM_GRID = {
    "rsi_period": [7, 14, 21],
    "oversold": [25, 30, 35],
    "overbought": [65, 70, 75]
}


@dataclass
class StrategyResult:
    signal: pd.Series


def generate_signal(df: pd.DataFrame, rsi_period: int = 14, oversold: int = 30, overbought: int = 70) -> pd.Series:
    """Generate trading signals based on RSI momentum.
    
    Args:
        df: DataFrame with 'close' column
        rsi_period: Period for RSI calculation
        oversold: RSI level to generate buy signal
        overbought: RSI level to generate sell signal
    
    Returns:
        Signal series (1 = long, 0 = flat)
    """
    if oversold >= overbought:
        raise ValueError("oversold must be smaller than overbought")
    
    # Calculate RSI
    delta = df["close"].diff()
    gain = delta.where(delta > 0, 0).rolling(rsi_period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(rsi_period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    # Generate signals
    # Buy when RSI crosses above oversold threshold
    # Sell when RSI crosses below overbought threshold
    signal = pd.Series(0, index=df.index)
    
    # Long entry: RSI was below oversold and now above
    was_oversold = rsi.shift(1) < oversold
    is_oversold_exit = rsi >= oversold
    long_entry = was_oversold & is_oversold_exit
    
    # Long exit: RSI was above overbought and now below
    was_overbought = rsi.shift(1) > overbought
    is_overbought_exit = rsi <= overbought
    long_exit = was_overbought & is_overbought_exit
    
    # Build signal series
    in_position = False
    for i in range(len(df)):
        if long_entry.iloc[i]:
            in_position = True
        elif long_exit.iloc[i]:
            in_position = False
        signal.iloc[i] = 1 if in_position else 0
    
    return signal.fillna(0)

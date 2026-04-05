"""RSI Momentum strategy with Polymarket sentiment filter.

Hybrid strategy that combines RSI momentum signals with Polymarket
sentiment as an entry filter. Only allows long entries when market
sentiment is aligned (bullish or neutral), blocks entries during bearish
sentiment periods.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

DEFAULT_PARAM_GRID = {
    "rsi_period": [7, 14, 21],
    "oversold": [25, 30, 35],
    "overbought": [65, 70, 75],
    "bullish_threshold": [0.55, 0.6, 0.65],
    "bearish_threshold": [0.35, 0.4, 0.45]
}

# Default sentiment thresholds
DEFAULT_BULLISH_THRESHOLD = 0.6
DEFAULT_BEARISH_THRESHOLD = 0.4


@dataclass
class StrategyResult:
    signal: pd.Series
    sentiment_used: Optional[pd.Series] = None


def load_polymarket_sentiment() -> dict:
    """Load latest Polymarket signals from previous experiment."""
    signal_path = Path("workspace/data/polymarket_signals.json")
    
    if not signal_path.exists():
        # Return neutral sentiment if no data
        return {"default_sentiment": 0.5, "sentiment": 0.5}
    
    try:
        with open(signal_path) as f:
            signals = json.load(f)
        
        if not signals:
            return {"default_sentiment": 0.5, "sentiment": 0.5}
        
        # Use average sentiment from top markets by volume
        top_markets = sorted(signals, key=lambda x: x.get("volume", 0), reverse=True)[:5]
        avg_yes_price = sum(m.get("yes_price", 0.5) for m in top_markets) / len(top_markets)
        
        return {
            "default_sentiment": 0.5,
            "sentiment": avg_yes_price,
            "markets_used": len(top_markets),
            "top_volumes": [m.get("volume", 0) for m in top_markets]
        }
    except (json.JSONDecodeError, IOError):
        return {"default_sentiment": 0.5, "sentiment": 0.5}


def generate_signal(
    df: pd.DataFrame,
    rsi_period: int = 14,
    oversold: int = 30,
    overbought: int = 70,
    bullish_threshold: float = DEFAULT_BULLISH_THRESHOLD,
    bearish_threshold: float = DEFAULT_BEARISH_THRESHOLD
) -> StrategyResult:
    """Generate trading signals based on RSI momentum with Polymarket sentiment filter.
    
    Args:
        df: DataFrame with 'close' column
        rsi_period: Period for RSI calculation
        oversold: RSI level for buy signal
        overbought: RSI level for sell signal
        bullish_threshold: Polymarket yes_price above this allows long entries
        bearish_threshold: Polymarket yes_price below this blocks long entries
    
    Returns:
        StrategyResult with signal series and sentiment data
    """
    if oversold >= overbought:
        raise ValueError("oversold must be smaller than overbought")
    
    # Load Polymarket sentiment
    sentiment_data = load_polymarket_sentiment()
    market_sentiment = sentiment_data.get("sentiment", 0.5)
    
    # Create sentiment series (constant for now - could be time-varying with historical data)
    sentiment = pd.Series(market_sentiment, index=df.index)
    
    # Calculate RSI
    delta = df["close"].diff()
    gain = delta.where(delta > 0, 0).rolling(rsi_period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(rsi_period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    # Generate base RSI signals
    # Buy when RSI crosses above oversold threshold
    was_oversold = rsi.shift(1) < oversold
    is_oversold_exit = rsi >= oversold
    long_entry = was_oversold & is_oversold_exit
    
    # Sell when RSI crosses below overbought threshold
    was_overbought = rsi.shift(1) > overbought
    is_overbought_exit = rsi <= overbought
    long_exit = was_overbought & is_overbought_exit
    
    # Apply sentiment filter
    # Bullish sentiment (yes_price > bullish_threshold): allow all long entries
    # Bearish sentiment (yes_price < bearish_threshold): block all long entries
    # Neutral (between): allow with 50% position size
    
    is_bullish = sentiment >= bullish_threshold
    is_bearish = sentiment <= bearish_threshold
    is_neutral = ~(is_bullish | is_bearish)
    
    # Filtered signals
    filtered_long_entry = long_entry & (is_bullish | is_neutral)
    filtered_long_exit = long_exit
    
    # Build signal series
    in_position = False
    signal = pd.Series(0, index=df.index)
    
    for i in range(len(df)):
        if filtered_long_entry.iloc[i]:
            in_position = True
        elif filtered_long_exit.iloc[i]:
            in_position = False
        signal.iloc[i] = 1 if in_position else 0
    
    return StrategyResult(
        signal=signal.fillna(0),
        sentiment_used=sentiment
    )


# Convenience function for WFA engine compatibility
def get_signal(df: pd.DataFrame, **params) -> pd.Series:
    """WFA-compatible signal generation."""
    result = generate_signal(df, **params)
    return result.signal

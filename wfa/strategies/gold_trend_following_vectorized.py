# src/strategies/gold_trend_following_vectorized.py
"""
Enhanced Momentum Persistence Strategy for Gold H4.

Improvements based on secondary AI research:
1. ADX(14) filter ≥ 20/25 to confirm trend strength
2. Softer exit threshold (-3% instead of -5%)
3. Chandelier Exit (22, 3) for better trailing
4. Optional CHOP < 38.2 filter for trending regimes

Base: ROC(20) crosses 0 with SMA(50) filter
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def calculate_adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Calculate ADX indicator."""
    n = len(close)
    
    # True Range
    tr1 = high - low
    tr2 = np.abs(high - np.roll(close, 1))
    tr3 = np.abs(low - np.roll(close, 1))
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    tr[0] = tr1[0]
    
    # Directional Movement
    up_move = high - np.roll(high, 1)
    down_move = np.roll(low, 1) - low
    
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    
    # Smoothed averages
    atr = pd.Series(tr).ewm(span=period, adjust=False).mean().values
    plus_di = 100 * pd.Series(plus_dm).ewm(span=period, adjust=False).mean().values / atr
    minus_di = 100 * pd.Series(minus_dm).ewm(span=period, adjust=False).mean().values / atr
    
    # ADX
    dx = 100 * np.abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10)
    adx = pd.Series(dx).ewm(span=period, adjust=False).mean().values
    
    return np.nan_to_num(adx, nan=0)


def calculate_chandelier_exit_rolling(high: np.ndarray, low: np.ndarray, close: np.ndarray, 
                                       period: int = 22, multiplier: float = 3.0) -> tuple:
    """
    Calculate Chandelier Exit levels using rolling window.
    
    Note: For vectorized backtesting, we use rolling-window based stops.
    True per-position ratcheting requires stateful position tracking.
    
    The low/high trigger logic (in the main function) provides realistic
    intrabar stop execution.
    
    Returns (long_stop, short_stop) arrays.
    """
    # ATR
    tr1 = high - low
    tr2 = np.abs(high - np.roll(close, 1))
    tr3 = np.abs(low - np.roll(close, 1))
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    tr[0] = tr1[0]
    atr = pd.Series(tr).rolling(window=period).mean().values
    
    # Highest high and lowest low over period
    highest = pd.Series(high).rolling(window=period).max().values
    lowest = pd.Series(low).rolling(window=period).min().values
    
    # Chandelier levels
    long_stop = highest - (atr * multiplier)  # For long positions
    short_stop = lowest + (atr * multiplier)  # For short positions
    
    # Handle NaN
    long_stop = np.nan_to_num(long_stop, nan=0)
    short_stop = np.nan_to_num(short_stop, nan=np.inf)
    
    return long_stop, short_stop


def generate_enhanced_momentum_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None
) -> Dict[str, Any]:
    """
    Generate momentum signals with ADX filter and Chandelier exit.
    
    Improvements over base version:
    - ADX filter confirms trend strength
    - Softer ROC exit threshold
    - Chandelier exit for better trailing
    """
    logger = logger or logging.getLogger(__name__)
    
    # Parameters
    roc_period = int(params.get('roc_period', 20))
    sma_period = int(params.get('sma_period', 50))
    exit_roc_threshold = float(params.get('exit_roc_threshold', 3.0))  # Softer: 3% instead of 5%
    adx_period = int(params.get('adx_period', 14))
    adx_threshold = float(params.get('adx_threshold', 20.0))  # ADX ≥ 20 for trend confirmation
    chandelier_period = int(params.get('chandelier_period', 22))
    chandelier_mult = float(params.get('chandelier_mult', 3.0))
    
    df = data.copy()
    df.columns = [c.lower() for c in df.columns]
    
    n = len(df)
    warmup = max(roc_period, sma_period, adx_period, chandelier_period) + 5
    
    if n < warmup + 10:
        logger.warning(f"Insufficient data: {n} bars")
        return {
            'long_entries': np.zeros(n, dtype=bool),
            'long_exits': np.zeros(n, dtype=bool),
            'short_entries': np.zeros(n, dtype=bool),
            'short_exits': np.zeros(n, dtype=bool),
            'sl_stop': np.full(n, 0.03),
            'tp_stop': np.full(n, np.nan)
        }
    
    close = df['close'].values
    high = df['high'].values
    low = df['low'].values
    
    # Calculate indicators
    # ROC
    close_shifted = np.roll(close, roc_period)
    close_shifted[:roc_period] = close[:roc_period]
    roc = ((close - close_shifted) / close_shifted) * 100
    roc[:roc_period] = 0
    
    # SMA
    sma = pd.Series(close).rolling(window=sma_period).mean().values
    
    # ADX
    adx = calculate_adx(high, low, close, adx_period)
    
    # Chandelier Exit
    # Chandelier Exit - Rolling with low/high triggers for realistic intrabar behavior
    long_chandelier, short_chandelier = calculate_chandelier_exit_rolling(high, low, close, chandelier_period, chandelier_mult)
    
    # Previous values
    prev_roc = np.roll(roc, 1)
    prev_roc[0] = 0
    
    # LONG SIGNALS
    # Entry: ROC crosses above 0 AND price > SMA AND ADX confirms trend
    roc_cross_up = (roc > 0) & (prev_roc <= 0)
    price_above_sma = close > sma
    adx_confirms = adx >= adx_threshold
    long_entries = roc_cross_up & price_above_sma & adx_confirms
    
    # Exit: ROC drops below -threshold OR LOW pierces Chandelier stop OR price < SMA
    # Using LOW (not close) for realistic intrabar stop triggering
    roc_exit_down = roc < -exit_roc_threshold
    chandelier_exit_long = low < long_chandelier  # FIXED: Use low, not close
    trend_break_long = close < sma
    long_exits = roc_exit_down | chandelier_exit_long | trend_break_long
    
    # SHORT SIGNALS
    roc_cross_down = (roc < 0) & (prev_roc >= 0)
    price_below_sma = close < sma
    short_entries = roc_cross_down & price_below_sma & adx_confirms
    
    # Exit: ROC rises above +threshold OR HIGH pierces Chandelier stop OR price > SMA
    # Using HIGH (not close) for realistic intrabar stop triggering
    roc_exit_up = roc > exit_roc_threshold
    chandelier_exit_short = high > short_chandelier  # FIXED: Use high, not close
    trend_break_short = close > sma
    short_exits = roc_exit_up | chandelier_exit_short | trend_break_short
    
    # Set warmup to False
    long_entries[:warmup] = False
    long_exits[:warmup] = False
    short_entries[:warmup] = False
    short_exits[:warmup] = False
    
    # Calculate ATR-based stop as fallback
    tr1 = high - low
    tr2 = np.abs(high - np.roll(close, 1))
    tr3 = np.abs(low - np.roll(close, 1))
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    atr = pd.Series(tr).rolling(window=20).mean().values
    
    with np.errstate(divide='ignore', invalid='ignore'):
        sl_stop_pct = (atr * 3.0) / close
    sl_stop_pct = np.clip(sl_stop_pct, 0.01, 0.10)
    sl_stop_pct = np.nan_to_num(sl_stop_pct, nan=0.03)
    
    # Log stats
    total_long = int(np.sum(long_entries))
    total_short = int(np.sum(short_entries))
    avg_adx = float(np.nanmean(adx[warmup:]))
    logger.info(f"Enhanced Momentum: {n} bars, {total_long} long, {total_short} short, avg ADX={avg_adx:.1f}")
    
    return {
        'long_entries': long_entries.astype(bool),
        'long_exits': long_exits.astype(bool),
        'short_entries': short_entries.astype(bool),
        'short_exits': short_exits.astype(bool),
        'sl_stop': sl_stop_pct,
        'tp_stop': np.full(n, np.nan)
    }


class LightweightGoldTrendFollowing:
    """Enhanced Momentum wrapper for WFA."""
    
    def __init__(self, params: Dict[str, Any] = None, logger: Optional[logging.Logger] = None):
        self.params = params or {}
        self.strategy_params = params or {}
        self.logger = logger or logging.getLogger(__name__)
    
    def _initialize_strategy_parameters(self) -> None:
        pass
    
    def generate_vectorized_signals(
        self, 
        data: pd.DataFrame, 
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        if params is not None:
            effective_params = params
        elif hasattr(self, 'params') and self.params:
            effective_params = self.params
        elif hasattr(self, 'strategy_params') and self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {
                'roc_period': 20,
                'sma_period': 50,
                'exit_roc_threshold': 3.0,
                'adx_period': 14,
                'adx_threshold': 20.0,
                'chandelier_period': 22,
                'chandelier_mult': 3.0
            }
        
        if hasattr(effective_params, 'keys'):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, '__dict__'):
            effective_params = vars(effective_params)
        
        return generate_enhanced_momentum_signals(data, effective_params, self.logger)


__all__ = ['generate_enhanced_momentum_signals', 'LightweightGoldTrendFollowing']

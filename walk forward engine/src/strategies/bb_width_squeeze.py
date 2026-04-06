# src/strategies/bb_width_squeeze.py
"""
BB Width Squeeze Strategy — Volatility Expansion Breakout.

Idea: Bollinger Band Width (bandwidth %) contraction (squeeze) precedes
explosive directional moves. Enter on bandwidth expansion breakout
with momentum confirmation. Different from:
  - BB mean-reversion (ETH, uses price at band extremes)
  - ATR volatility regime (uses ATR%, not BB-derived width)
  - RSI/SMA (uses momentum indicators directly)

Logic:
  - Compute Bollinger Bands (BB) on 1h close
  - Compute BB Width = (Upper - Lower) / Middle * 100 (as %)
  - Squeeze: BB Width below Nth percentile of recent history
  - Expansion: BB Width crosses above squeeze threshold
  - Direction: Price above middle BB = long, below = short
  - Momentum filter: 20-bar momentum confirms direction
  - Exit: Time-based (hold_bars) or ATR-based stop
  - Stop-loss: ATR × multiplier

Parameters:
  - bb_period       : BB lookback (default 20)
  - bb_std          : BB standard deviations (default 2.0)
  - width_period    : Lookback for percentile (default 20)
  - squeeze_pct     : Percentile threshold for squeeze (default 20)
  - momentum_period : Momentum lookback bars (default 20)
  - hold_bars       : Hold for N bars (default 24)
  - sl_atr_mult     : SL = ATR × multiplier (default 2.0)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _compute_bb(
    close: np.ndarray, period: int, std_dev: float
) -> tuple:
    """
    Compute Bollinger Bands.
    
    Returns: (middle, upper, lower, width)
      middle  : SMA of close
      upper   : middle + std_dev * rolling_std
      lower   : middle - std_dev * rolling_std
      width   : (upper - lower) / middle * 100  (%)
    """
    middle = pd.Series(close).rolling(window=period, min_periods=period).mean().values
    std = pd.Series(close).rolling(window=period, min_periods=period).std().values
    upper = middle + std_dev * std
    lower = middle - std_dev * std
    
    with np.errstate(divide="ignore", invalid="ignore"):
        width = (upper - lower) / middle * 100.0
    width = np.nan_to_num(width, nan=0.0)
    
    return middle, upper, lower, width


def _compute_atr(
    high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int
) -> np.ndarray:
    """Compute ATR (Average True Range)."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    
    atr = pd.Series(tr).rolling(window=period, min_periods=period).mean().values
    return atr


def _compute_momentum(close: np.ndarray, period: int) -> np.ndarray:
    """Compute N-bar rate of change (momentum)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        mom = (close / np.roll(close, period)) - 1.0
    mom = np.nan_to_num(mom, nan=0.0)
    return mom


def generate_bb_width_squeeze_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate BB Width Squeeze signals (vectorized, 1h OHLCV input).
    
    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)
    
    # ── Extract parameters ────────────────────────────────────────────
    bb_period = int(params.get("bb_period", 20))
    bb_std = float(params.get("bb_std", 2.0))
    width_period = int(params.get("width_period", 20))
    squeeze_pct = float(params.get("squeeze_pct", 20.0))
    momentum_period = int(params.get("momentum_period", 20))
    hold_bars = int(params.get("hold_bars", 24))
    sl_atr_mult = float(params.get("sl_atr_mult", 2.0))
    atr_period = int(params.get("atr_period", 14))
    
    df = data.copy()
    df.columns = [c.lower() for c in df.columns]
    n = len(df)
    
    # Ensure DatetimeIndex
    if not isinstance(df.index, pd.DatetimeIndex):
        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
            df.set_index("timestamp", inplace=True, drop=False)
        else:
            logger.error("No DatetimeIndex or timestamp column found")
            return _empty_signals(n)
    
    # Warmup
    warmup = max(bb_period, width_period, momentum_period, atr_period) + 10
    if n < warmup + 50:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup + 50})")
        return _empty_signals(n)
    
    # ── Compute indicators ───────────────────────────────────────────
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values
    
    bb_mid, bb_upper, bb_lower, bb_width = _compute_bb(close, bb_period, bb_std)
    atr = _compute_atr(high, low, close, atr_period)
    momentum = _compute_momentum(close, momentum_period)
    
    # ── Compute squeeze threshold ─────────────────────────────────────
    # BB Width must be below the Nth percentile of the last width_period values
    squeeze_threshold = np.zeros(n)
    for i in range(width_period, n):
        window = bb_width[max(0, i - width_period):i]
        valid = window[~np.isnan(window)]
        if len(valid) > 5:
            squeeze_threshold[i] = np.percentile(valid, squeeze_pct)
    
    # Detect squeeze state
    in_squeeze = (bb_width < squeeze_threshold) & (squeeze_threshold > 0)
    
    # Expansion: was in squeeze, now bandwidth expanding (above threshold)
    was_in_squeeze = np.roll(in_squeeze, 1)
    was_in_squeeze[0] = False
    bandwidth_expanding = bb_width > squeeze_threshold
    
    squeeze_break = was_in_squeeze & bandwidth_expanding
    
    # ── Direction: price vs middle BB ─────────────────────────────────
    price_above_mid = close > bb_mid
    price_below_mid = close < bb_mid
    
    # ── Momentum filter ───────────────────────────────────────────────
    # Momentum > 0 = bullish, < 0 = bearish
    momentum_positive = momentum > 0
    momentum_negative = momentum < 0
    
    # ── Entry signals ─────────────────────────────────────────────────
    # Long: squeeze breaking AND price above middle BB AND bullish momentum
    long_entries = (
        squeeze_break
        & price_above_mid
        & momentum_positive
    ).astype(bool)
    
    # Short: squeeze breaking AND price below middle BB AND bearish momentum
    short_entries = (
        squeeze_break
        & price_below_mid
        & momentum_negative
    ).astype(bool)
    
    # ── Exit signals (time-based) ─────────────────────────────────────
    long_exits = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)
    
    for idx in np.where(long_entries)[0]:
        exit_idx = idx + hold_bars
        if exit_idx < n:
            long_exits[exit_idx] = True
    
    for idx in np.where(short_entries)[0]:
        exit_idx = idx + hold_bars
        if exit_idx < n:
            short_exits[exit_idx] = True
    
    # ── Stop-loss (ATR-based, as percentage) ─────────────────────────
    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr / close) * sl_atr_mult
    sl_pct = np.clip(sl_pct, 0.005, 0.15)   # 0.5% – 15%
    sl_pct = np.nan_to_num(sl_pct, nan=0.04)
    
    # ── Warmup: suppress signals ─────────────────────────────────────
    long_entries[:warmup] = False
    long_exits[:warmup] = False
    short_entries[:warmup] = False
    short_exits[:warmup] = False
    
    # ── Logging ───────────────────────────────────────────────────────
    total_long = int(np.sum(long_entries))
    total_short = int(np.sum(short_entries))
    logger.info(
        f"BB Width Squeeze: {n} bars, {total_long} long, {total_short} short | "
        f"bb={bb_period}/{bb_std} squeeze_pct={squeeze_pct}% mom={momentum_period}"
    )
    
    return {
        "long_entries": long_entries,
        "long_exits": long_exits,
        "short_entries": short_entries,
        "short_exits": short_exits,
        "sl_stop": sl_pct,
        "tp_stop": np.full(n, np.nan),   # no fixed TP, ride until time exit
    }


def _empty_signals(n: int) -> Dict[str, Any]:
    """Return a no-signal dict for edge cases."""
    return {
        "long_entries": np.zeros(n, dtype=bool),
        "long_exits": np.zeros(n, dtype=bool),
        "short_entries": np.zeros(n, dtype=bool),
        "short_exits": np.zeros(n, dtype=bool),
        "sl_stop": np.full(n, 0.04),
        "tp_stop": np.full(n, np.nan),
    }


class LightweightBBWidthSqueeze:
    """
    BB Width Squeeze wrapper for WFA.
    
    Follows the standard pattern: minimal __init__,
    generate_vectorized_signals delegates to the pure-function.
    """
    
    def __init__(
        self,
        params: Optional[Dict[str, Any]] = None,
        logger: Optional[logging.Logger] = None,
    ):
        self.params = params or {}
        self.strategy_params = params or {}
        self.logger = logger or logging.getLogger(__name__)
    
    def _initialize_strategy_parameters(self) -> None:
        """Hook called after params are injected."""
        pass
    
    def generate_vectorized_signals(
        self,
        data: pd.DataFrame,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        WFA entry point. Resolves effective params, then delegates.
        """
        if params is not None:
            effective_params = params
        elif hasattr(self, "params") and self.params:
            effective_params = self.params
        elif hasattr(self, "strategy_params") and self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {
                "bb_period": 20,
                "bb_std": 2.0,
                "width_period": 20,
                "squeeze_pct": 20.0,
                "momentum_period": 20,
                "hold_bars": 24,
                "sl_atr_mult": 2.0,
                "atr_period": 14,
            }
        
        # Normalise to plain dict
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)
        
        return generate_bb_width_squeeze_signals(data, effective_params, self.logger)


__all__ = ["generate_bb_width_squeeze_signals", "LightweightBBWidthSqueeze"]

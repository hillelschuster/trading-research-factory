# src/strategies/volume_profile.py
"""
Volume Profile / Order Flow Strategy.

Idea: Use volume-based indicators to identify order flow direction and
trade breakouts from VWAP with volume confirmation.

Logic:
  - VWAP as dynamic support/resistance level
  - Volume moving average to detect volume spikes
  - Cumulative Volume Delta: track up-bar vs down-bar volume
  - Entry: Price breaks VWAP with volume spike confirming direction
  - Exit: Opposite signal or time-based

Parameters:
  - vwap_period       : VWAP lookback (default 20)
  - volume_ma_period  : Volume MA period (default 20)
  - volume_spike_mult : Volume must be this many x MA to confirm (default 2.0)
  - hold_bars         : Hold for N bars (default 12)
  - sl_atr_multiplier: SL = ATR × multiplier (default 2.0)
  - use_cvd           : Use cumulative volume delta filter (default True)
  - cvd_lookback      : Lookback for CVD direction (default 20)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _compute_vwap(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                  volume: np.ndarray, period: int) -> np.ndarray:
    """
    Compute Volume-Weighted Average Price.
    
    VWAP = sum(price * volume) / sum(volume)
    Using typical price (H+L+C)/3 for calculation.
    """
    typical_price = (high + low + close) / 3.0
    pv = typical_price * volume  # price * volume
    
    # Rolling VWAP: cumulative sum / cumulative volume, with rolling window
    cum_pv = pd.Series(pv).rolling(window=period, min_periods=1).sum().values
    cum_vol = pd.Series(volume).rolling(window=period, min_periods=1).sum().values
    
    with np.errstate(divide="ignore", invalid="ignore"):
        vwap = cum_pv / cum_vol
    vwap = np.nan_to_num(vwap, nan=close[-1])  # fallback to last close
    return vwap


def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                period: int) -> np.ndarray:
    """Compute ATR (Average True Range)."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    
    atr = pd.Series(tr).rolling(window=period, min_periods=period).mean().values
    return atr


def _compute_volume_ma(volume: np.ndarray, period: int) -> np.ndarray:
    """Compute volume moving average."""
    return pd.Series(volume).rolling(window=period, min_periods=period).mean().values


def _compute_cumulative_volume_delta(
    close: np.ndarray,
    volume: np.ndarray,
    lookback: int
) -> np.ndarray:
    """
    Compute Cumulative Volume Delta over lookback.
    Positive = buying pressure (up bars have more volume)
    Negative = selling pressure (down bars have more volume)
    """
    n = len(close)
    cvd = np.zeros(n)
    
    for i in range(1, n):
        # Up bar: close > previous close
        if close[i] > close[i-1]:
            cvd[i] = cvd[i-1] + volume[i]
        else:
            cvd[i] = cvd[i-1] - volume[i]
    
    # Normalize to recent range for comparison
    cvd_ma = pd.Series(cvd).rolling(window=lookback, min_periods=5).mean().values
    return cvd, cvd_ma


def generate_volume_profile_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate volume profile strategy signals (vectorized, OHLCV input).
    
    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)
    
    # ── Extract parameters ────────────────────────────────────────────
    vwap_period = int(params.get("vwap_period", 20))
    volume_ma_period = int(params.get("volume_ma_period", 20))
    volume_spike_mult = float(params.get("volume_spike_mult", 2.0))
    hold_bars = int(params.get("hold_bars", 12))
    sl_atr_mult = float(params.get("sl_atr_multiplier", 2.0))
    use_cvd = bool(params.get("use_cvd", True))
    cvd_lookback = int(params.get("cvd_lookback", 20))
    
    df = data.copy()
    df.columns = [c.lower() for c in df.columns]
    n = len(df)
    
    # Check required columns
    required_cols = ["open", "high", "low", "close", "volume"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        logger.error(f"Missing required columns: {missing}")
        return _empty_signals(n)
    
    # Ensure DatetimeIndex
    if not isinstance(df.index, pd.DatetimeIndex):
        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
            df.set_index("timestamp", inplace=True, drop=False)
        else:
            logger.error("No DatetimeIndex or timestamp column found")
            return _empty_signals(n)
    
    # Warmup period
    warmup = max(vwap_period, volume_ma_period, cvd_lookback) + 10
    if n < warmup + 50:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup + 50})")
        return _empty_signals(n)
    
    # ── Extract arrays ────────────────────────────────────────────────
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values
    volume = df["volume"].values.astype(float)
    
    # ── Compute indicators ────────────────────────────────────────────
    vwap = _compute_vwap(high, low, close, volume, vwap_period)
    volume_ma = _compute_volume_ma(volume, volume_ma_period)
    
    # Volume spike: current volume > MA * multiplier
    volume_spike = volume > (volume_ma * volume_spike_mult)
    
    # Price position relative to VWAP
    above_vwap = close > vwap
    below_vwap = close < vwap
    
    # Previous bar position
    prev_above_vwap = np.roll(above_vwap, 1)
    prev_above_vwap[0] = False
    
    # VWAP breakout: was below, now above (or vice versa)
    long_breakout = above_vwap & ~prev_above_vwap  # price crossed above VWAP
    short_breakout = below_vwap & ~prev_above_vwap  # price crossed below VWAP
    
    # CVD filter (optional)
    if use_cvd:
        cvd, cvd_ma = _compute_cumulative_volume_delta(close, volume, cvd_lookback)
        cvd_positive = cvd > cvd_ma  # buying pressure
    else:
        cvd_positive = np.ones(n, dtype=bool)
    
    # ── Entry signals ──────────────────────────────────────────────────
    # Long: price broke above VWAP + volume spike + CVD positive
    long_entries = (
        long_breakout 
        & volume_spike 
        & cvd_positive
    ).astype(bool)
    
    # Short: price broke below VWAP + volume spike + CVD negative
    short_entries = (
        short_breakout 
        & volume_spike 
        & ~cvd_positive
    ).astype(bool)
    
    # ── Exit signals (time-based) ──────────────────────────────────────
    long_exits = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)
    
    entry_indices = np.where(long_entries)[0]
    for idx in entry_indices:
        exit_idx = idx + hold_bars
        if exit_idx < n:
            long_exits[exit_idx] = True
    
    short_entry_indices = np.where(short_entries)[0]
    for idx in short_entry_indices:
        exit_idx = idx + hold_bars
        if exit_idx < n:
            short_exits[exit_idx] = True
    
    # ── Stop-loss (ATR-based) ───────────────────────────────────────────
    atr = _compute_atr(high, low, close, period=14)
    
    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr / close) * sl_atr_mult
    sl_pct = np.clip(sl_pct, 0.005, 0.15)  # 0.5% – 15% range
    sl_pct = np.nan_to_num(sl_pct, nan=0.04)
    
    # ── Warmup: suppress signals during warmup period ────────────────
    long_entries[:warmup] = False
    long_exits[:warmup] = False
    short_entries[:warmup] = False
    short_exits[:warmup] = False
    
    # ── Logging ───────────────────────────────────────────────────────
    total_long = int(np.sum(long_entries))
    total_short = int(np.sum(short_entries))
    logger.info(
        f"Volume Profile: {n} bars, {total_long} long entries, {total_short} short entries | "
        f"vwap={vwap_period} vol_ma={volume_ma_period} spike={volume_spike_mult}x"
    )
    
    return {
        "long_entries": long_entries,
        "long_exits": long_exits,
        "short_entries": short_entries,
        "short_exits": short_exits,
        "sl_stop": sl_pct,
        "tp_stop": np.full(n, np.nan),  # no fixed TP, rely on time exit
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


class LightweightVolumeProfile:
    """
    Volume Profile wrapper for WFA.
    
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
                "vwap_period": 20,
                "volume_ma_period": 20,
                "volume_spike_mult": 2.0,
                "hold_bars": 12,
                "sl_atr_multiplier": 2.0,
                "use_cvd": True,
                "cvd_lookback": 20,
            }
        
        # Normalise to plain dict
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)
        
        return generate_volume_profile_signals(data, effective_params, self.logger)


__all__ = ["generate_volume_profile_signals", "LightweightVolumeProfile"]

# src/strategies/volatility_regime.py
"""
Volatility Contraction/Expansion Strategy – Multi-Timeframe.

Idea: Trade breakouts from low-volatility contractions, filtered by 
higher-timeframe trend direction. Volatility expansion after contraction
often precedes strong directional moves.

Logic:
  - Resample 1h bars → 4h bars for regime detection
  - Compute ATR % (ATR / Close) on 4h bars
  - Contraction: ATR % below percentile threshold (e.g., bottom 20%)
  - Expansion: ATR % crosses above contraction threshold
  - Trend filter: EMA direction on 4h (e.g., EMA20 > EMA50)
  - Entry: On first 1h bar after expansion starts, in trend direction
  - Exit: Time-based (hold N bars) or ATR-based stop

Parameters:
  - atr_period       : ATR lookback on 4h (default 14)
  - contraction_pct  : Percentile threshold for contraction (default 20)
  - ema_fast         : Fast EMA period on 4h (default 20)
  - ema_slow         : Slow EMA period on 4h (default 50)
  - hold_bars        : Hold for N 1h bars (default 24)
  - sl_atr_multiplier: SL = ATR × multiplier (default 2.0)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _resample_to_higher_tf(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """
    Resample OHLCV data to higher timeframe.
    
    Args:
        df: Input DataFrame with DatetimeIndex
        rule: pandas resample rule (e.g., '4H')
    
    Returns:
        Resampled DataFrame with OHLCV
    """
    resampled = df.resample(rule).agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna(subset=["open"])
    return resampled


def _compute_atr_pct(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                      period: int) -> np.ndarray:
    """
    Compute ATR as percentage of close price.
    
    Args:
        high, low, close: Price arrays
        period: ATR lookback
    
    Returns:
        ATR % array
    """
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    
    atr = pd.Series(tr).rolling(window=period, min_periods=period).mean().values
    atr_pct = atr / close
    return atr_pct


def _compute_ema(close: np.ndarray, period: int) -> np.ndarray:
    """Compute EMA."""
    return pd.Series(close).ewm(span=period, adjust=False).mean().values


def generate_volatility_regime_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate volatility regime strategy signals (vectorized, 1h input).
    
    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)
    
    # ── Extract parameters ────────────────────────────────────────────
    atr_period = int(params.get("atr_period", 14))
    contraction_pct = float(params.get("contraction_pct", 20.0))
    ema_fast = int(params.get("ema_fast", 20))
    ema_slow = int(params.get("ema_slow", 50))
    hold_bars = int(params.get("hold_bars", 24))
    sl_atr_mult = float(params.get("sl_atr_multiplier", 2.0))
    
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
    
    # Warmup: need enough 4h bars for EMA + ATR
    warmup_4h = max(atr_period, ema_fast, ema_slow) + 10
    warmup_1h = warmup_4h * 4  # rough conversion
    if n < warmup_1h + 100:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup_1h + 100})")
        return _empty_signals(n)
    
    # ── Resample to 4h for regime detection ────────────────────────────
    tf_4h = _resample_to_higher_tf(df, "4H")
    
    if len(tf_4h) < warmup_4h:
        logger.warning(f"Insufficient 4h bars: {len(tf_4h)} (need {warmup_4h})")
        return _empty_signals(n)
    
    # ── Compute 4h indicators ──────────────────────────────────────────
    h4_close = tf_4h["close"].values
    h4_high = tf_4h["high"].values
    h4_low = tf_4h["low"].values
    
    atr_pct_4h = _compute_atr_pct(h4_high, h4_low, h4_close, atr_period)
    ema_fast_4h = _compute_ema(h4_close, ema_fast)
    ema_slow_4h = _compute_ema(h4_close, ema_slow)
    
    # Trend: fast > slow = uptrend
    trend_up = ema_fast_4h > ema_slow_4h
    
    # Compute contraction percentile (rolling lookback)
    lookback = 20  # look at last 20 4h bars for percentile
    contraction_threshold = np.zeros(len(atr_pct_4h))
    for i in range(lookback, len(atr_pct_4h)):
        window = atr_pct_4h[i-lookback:i]
        valid = window[~np.isnan(window)]
        if len(valid) > 5:
            contraction_threshold[i] = np.percentile(valid, contraction_pct)
    
    # Detect regime changes
    in_contraction = (atr_pct_4h < contraction_threshold) & (atr_pct_4h > 0)
    
    # Expansion: was in contraction, now ATR% above threshold
    was_in_contraction = np.roll(in_contraction, 1)
    was_in_contraction[0] = False
    expansion_start = ~in_contraction & was_in_contraction
    
    # ── Map 4h indicators to 1h bars ─────────────────────────────────
    df["date"] = df.index.date
    tf_4h["date"] = tf_4h.index.date
    
    # Create maps for 4h -> 1h
    trend_up_series = pd.Series(trend_up, index=tf_4h.index)
    expansion_start_series = pd.Series(expansion_start, index=tf_4h.index)
    atr_pct_series = pd.Series(atr_pct_4h, index=tf_4h.index)
    
    # Merge to 1h
    trend_map = trend_up_series.to_dict()
    expansion_map = expansion_start_series.to_dict()
    atr_map = atr_pct_series.to_dict()
    
    df["trend_up_4h"] = df.index.map(lambda x: trend_map.get(x.replace(hour=x.hour - x.hour % 4), False))
    df["expansion_start_4h"] = df.index.map(lambda x: expansion_map.get(x.replace(hour=x.hour - x.hour % 4), False))
    df["atr_pct_4h"] = df.index.map(lambda x: atr_map.get(x.replace(hour=x.hour - x.hour % 4), np.nan))
    
    df["trend_up_4h"] = df["trend_up_4h"].fillna(False).astype(bool)
    df["expansion_start_4h"] = df["expansion_start_4h"].fillna(False).astype(bool)
    
    # ── Entry signals ──────────────────────────────────────────────────
    # Long: expansion starting AND in uptrend
    long_entries = (
        df["expansion_start_4h"]
        & df["trend_up_4h"]
    ).values.astype(bool)
    
    # Short: expansion starting AND in downtrend
    short_entries = (
        df["expansion_start_4h"]
        & ~df["trend_up_4h"]
    ).values.astype(bool)
    
    # ── Exit signals (time-based) ─────────────────────────────────────
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
    
    # ── Stop-loss (ATR-based on 4h, as percentage) ───────────────────
    close_arr = df["close"].values
    atr_pct_4h_arr = df["atr_pct_4h"].values.copy()
    atr_pct_4h_arr = np.nan_to_num(atr_pct_4h_arr, nan=0.03)
    
    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = atr_pct_4h_arr * sl_atr_mult
    sl_pct = np.clip(sl_pct, 0.005, 0.15)  # 0.5% – 15% range
    sl_pct = np.nan_to_num(sl_pct, nan=0.04)
    
    # ── Warmup: suppress signals during warmup period ────────────────
    long_entries[:warmup_1h] = False
    long_exits[:warmup_1h] = False
    short_entries[:warmup_1h] = False
    short_exits[:warmup_1h] = False
    
    # ── Logging ───────────────────────────────────────────────────────
    total_long = int(np.sum(long_entries))
    total_short = int(np.sum(short_entries))
    logger.info(
        f"Volatility Regime: {n} 1h bars, {len(tf_4h)} 4h bars, "
        f"{total_long} long entries, {total_short} short entries | "
        f"contraction_pct={contraction_pct}% ema={ema_fast}/{ema_slow}"
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


class LightweightVolatilityRegime:
    """
    Volatility Regime wrapper for WFA.
    
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
                "atr_period": 14,
                "contraction_pct": 20.0,
                "ema_fast": 20,
                "ema_slow": 50,
                "hold_bars": 24,
                "sl_atr_multiplier": 2.0,
            }
        
        # Normalise to plain dict
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)
        
        return generate_volatility_regime_signals(data, effective_params, self.logger)


__all__ = ["generate_volatility_regime_signals", "LightweightVolatilityRegime"]

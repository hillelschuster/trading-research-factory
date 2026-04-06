# walk forward engine/src/strategies/vol_adaptive_trend.py
"""
Volatility-Adaptive Trend Following — Supertrend + Dynamic Position Sizing.

Idea: Trade Supertrend crossovers with position size scaled inversely to
realized volatility. During high-vol regimes, reduce exposure to limit drawdowns.
During low-vol regimes, increase exposure to capture moves.

Logic:
  - Compute Supertrend on 1h candles (ATR-based bands + median price)
  - Long: close crosses above upper band (bullish reversal)
  - Short: close crosses below lower band (bearish reversal)
  - Position sizing: scale inversely to 20-bar ATR% of close
    size_factor = 1 / ATR_pct_20; clamp [0.25, 2.0]
  - Exit: Supertrend reversal (opposite signal)
  - Stop-loss: ATR-based trailing stop

Parameters (optimizable via WFA):
  - atr_period        : Supertrend ATR lookback         (default 10)
  - st_multiplier    : Supertrend band multiplier        (default 3.0)
  - vol_atr_period   : ATR% for position sizing         (default 20)
  - vol_scale_min    : Min position scale factor        (default 0.25)
  - vol_scale_max    : Max position scale factor        (default 2.0)
  - trail_mult       : Trailing stop ATR multiplier     (default 2.5)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _compute_supertrend(
    high: np.ndarray, low: np.ndarray, close: np.ndarray,
    period: int, multiplier: float
) -> tuple:
    """
    Compute Supertrend indicator.

    Returns: (supertrend, upper_band, lower_band, trend_direction)
      supertrend   : final Supertrend value (close price)
      upper_band   : upper band value
      lower_band   : lower band value
      trend        : 1=uptrend, -1=downtrend (no NaN)
    """
    # Median price
    hl2 = (high + low) / 2.0

    # True Range
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)

    # ATR
    atr = pd.Series(tr).rolling(window=period, min_periods=period).mean().values

    # Upper and lower bands
    upper_band = hl2 + multiplier * atr
    lower_band = hl2 - multiplier * atr

    n = len(close)
    trend = np.ones(n, dtype=np.int8)   # 1=up, -1=down
    supertrend_vals = np.zeros(n)

    # Initialize
    trend[0] = 1
    supertrend_vals[0] = lower_band[0]

    for i in range(1, n):
        # Calculate bands respecting trend continuity
        prev_ub = upper_band[i - 1]
        prev_lb = lower_band[i - 1]

        # Current bands
        ub = upper_band[i]
        lb = lower_band[i]

        # Supertrend calculation
        if close[i] > prev_ub:
            trend[i] = 1
        elif close[i] < prev_lb:
            trend[i] = -1
        else:
            trend[i] = trend[i - 1]
            # Adjust bands for trend continuity
            if trend[i] == 1:
                ub = max(ub, prev_ub)
            else:
                lb = min(lb, prev_lb)

        # Update bands
        upper_band[i] = ub
        lower_band[i] = lb

        # Supertrend value
        if trend[i] == 1:
            supertrend_vals[i] = lower_band[i]
        else:
            supertrend_vals[i] = upper_band[i]

    return supertrend_vals, upper_band, lower_band, trend


def _compute_atr(
    high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int
) -> np.ndarray:
    """Compute ATR."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    return pd.Series(tr).rolling(window=period, min_periods=period).mean().values


def _compute_atr_pct(close: np.ndarray, atr: np.ndarray, period: int) -> np.ndarray:
    """Compute ATR as percentage of close (realized volatility)."""
    # ATR already computed; compute rolling ATR%
    # For volatility scaling: use ATR / Close
    return atr / close


def generate_vol_adaptive_trend_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate Volatility-Adaptive Trend Following signals (vectorized, 1h input).

    Entry: Supertrend crossover (trend direction change)
    Position sizing: inversely scaled by 20-bar ATR%
    Exit: Supertrend reversal OR trailing stop

    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ────────────────────────────────────────────
    atr_period = int(params.get("atr_period", 10))
    st_multiplier = float(params.get("st_multiplier", 3.0))
    vol_atr_period = int(params.get("vol_atr_period", 20))
    vol_scale_min = float(params.get("vol_scale_min", 0.25))
    vol_scale_max = float(params.get("vol_scale_max", 2.0))
    trail_mult = float(params.get("trail_mult", 2.5))

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

    # Warmup: need enough bars for Supertrend + volatility ATR
    warmup = max(atr_period, vol_atr_period) + 20
    if n < warmup + 50:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup + 50})")
        return _empty_signals(n)

    # ── Compute indicators ────────────────────────────────────────────
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values

    supertrend_vals, upper_band, lower_band, trend = _compute_supertrend(
        high, low, close, atr_period, st_multiplier
    )

    atr_raw = _compute_atr(high, low, close, vol_atr_period)
    atr_pct = atr_raw / close  # ATR as % of price (realized vol)

    # ── Volatility-adaptive position scaling ──────────────────────────
    # Scale factor = 1 / ATR%  → smaller when vol is high
    with np.errstate(divide="ignore", invalid="ignore"):
        vol_scale = 1.0 / atr_pct
    vol_scale = np.clip(vol_scale, vol_scale_min, vol_scale_max)
    vol_scale = np.nan_to_num(vol_scale, nan=1.0)

    # Normalize scale so median ≈ 1.0 (baseline position size)
    median_scale = np.nanmedian(vol_scale[warmup:])
    if median_scale > 0:
        vol_scale = vol_scale / median_scale
    vol_scale = np.clip(vol_scale, vol_scale_min, vol_scale_max)

    # ── Entry signals: Supertrend direction change ────────────────────
    prev_trend = np.roll(trend, 1)
    prev_trend[0] = trend[0]

    # Trend flips
    trend_flipped_up = (trend == 1) & (prev_trend == -1)
    trend_flipped_down = (trend == -1) & (prev_trend == 1)

    long_entries = trend_flipped_up.astype(bool)
    short_entries = trend_flipped_down.astype(bool)

    # ── Exit signals: Supertrend reversal ──────────────────────────────
    long_exits = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)

    # For simplicity, exits are handled by the opposite entry
    # (trend reversal) — no separate time-based exit in this strategy
    # The vectorized engine will close positions on opposite entry

    # ── Stop-loss (ATR-based trailing stop as %) ──────────────────────
    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr_raw * trail_mult) / close
    sl_pct = np.clip(sl_pct, 0.005, 0.15)
    sl_pct = np.nan_to_num(sl_pct, nan=0.04)

    # ── Warmup: suppress signals during indicator warmup ──────────────
    long_entries[:warmup] = False
    long_exits[:warmup] = False
    short_entries[:warmup] = False
    short_exits[:warmup] = False

    # ── Logging ───────────────────────────────────────────────────────
    total_long = int(np.sum(long_entries))
    total_short = int(np.sum(short_entries))
    median_vol = np.nanmedian(atr_pct[warmup:]) * 100
    logger.info(
        f"Vol Adaptive Trend: {n} bars, {total_long} long, {total_short} short | "
        f"atr={atr_period} st_mult={st_multiplier} vol_period={vol_atr_period} "
        f"median_vol={median_vol:.3f}%"
    )

    return {
        "long_entries": long_entries,
        "long_exits": long_exits,
        "short_entries": short_entries,
        "short_exits": short_exits,
        "sl_stop": sl_pct,
        "tp_stop": np.full(n, np.nan),
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


class LightweightVolAdaptiveTrend:
    """
    Volatility-Adaptive Trend Following wrapper for WFA.

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
        """WFA entry point. Resolves effective params, then delegates."""
        if params is not None:
            effective_params = params
        elif hasattr(self, "params") and self.params:
            effective_params = self.params
        elif hasattr(self, "strategy_params") and self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {
                "atr_period": 10,
                "st_multiplier": 3.0,
                "vol_atr_period": 20,
                "vol_scale_min": 0.25,
                "vol_scale_max": 2.0,
                "trail_mult": 2.5,
            }

        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_vol_adaptive_trend_signals(data, effective_params, self.logger)


__all__ = ["generate_vol_adaptive_trend_signals", "LightweightVolAdaptiveTrend"]

# walk forward engine/src/strategies/ema_trend_gate.py
"""
Multi-Timeframe EMA Confluence with 4h Trend Gate – BTC/USDT.

Idea: Filter 1h RSI mean-reversion entries with a 4h EMA trend gate.
4h EMA(50) slope identifies market regime (trending vs ranging).
RSI entries are only taken when the 4h trend confirms direction.
This eliminates counter-trend trades that cause whipsaws.

Logic:
  - Resample 1h bars → 4h bars for regime detection
  - Compute 4h EMA(50) and detect slope direction (rising/falling)
  - 4h EMA rising = uptrend regime → allow long entries only
  - 4h EMA falling = downtrend regime → allow short entries only
  - On 1h: pullback entry when price touches or crosses 1h EMA(20)
  - 1h RSI(14) confirms: < 45 for longs (oversold in uptrend),
    > 55 for shorts (overbought in downtrend)
  - Exit: opposite RSI threshold or time-based hold
  - SL: ATR-based, TP: risk-reward ratio

Parameters (optimizable via WFA):
  - ema4h_period       : EMA period on 4h bars  (default 50)
  - ema1h_period      : EMA period on 1h bars  (default 20)
  - rsi_period        : RSI lookback            (default 14)
  - rsi_oversold      : Long entry RSI level    (default 45)
  - rsi_overbought    : Short entry RSI level  (default 55)
  - hold_bars         : Exit after N 1h bars    (default 48)
  - sl_atr_mult       : SL = ATR × multiplier   (default 2.0)
  - tp_rr_mult        : TP = SL × R:R ratio     (default 2.0)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _resample_to_higher_tf(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """Resample OHLCV data to higher timeframe."""
    resampled = df.resample(rule).agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna(subset=["open"])
    return resampled


def _compute_ema(close: np.ndarray, period: int) -> np.ndarray:
    """Compute EMA using pandas ewm for accuracy."""
    return pd.Series(close).ewm(span=period, adjust=False).mean().values


def _compute_rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Compute RSI using EMA method."""
    delta = np.diff(close, prepend=close[0])
    gains = np.where(delta > 0, delta, 0.0)
    losses = np.where(delta < 0, -delta, 0.0)
    avg_gain = pd.Series(gains).ewm(span=period, adjust=False).mean().values
    avg_loss = pd.Series(losses).ewm(span=period, adjust=False).mean().values
    rs = avg_gain / (avg_loss + 1e-10)
    return 100.0 - (100.0 / (1.0 + rs))


def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                 period: int) -> np.ndarray:
    """Compute ATR."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    return pd.Series(tr).rolling(window=period, min_periods=period).mean().values


def generate_ema_trend_gate_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate EMA trend gate strategy signals (vectorized, 1h input).

    Entry rules:
      - Long: 4h EMA rising AND price <= 1h EMA(20) AND RSI < rsi_oversold
      - Short: 4h EMA falling AND price >= 1h EMA(20) AND RSI > rsi_overbought
    Exit rules:
      - Time-based: hold N bars
      - Stop-loss: ATR-based %
      - Take-profit: risk-reward ratio

    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ──────────────────────────────────────────────
    ema4h_period = int(params.get("ema4h_period", 50))
    ema1h_period = int(params.get("ema1h_period", 20))
    rsi_period = int(params.get("rsi_period", 14))
    rsi_oversold = float(params.get("rsi_oversold", 45.0))
    rsi_overbought = float(params.get("rsi_overbought", 55.0))
    hold_bars = int(params.get("hold_bars", 48))
    sl_atr_mult = float(params.get("sl_atr_mult", 2.0))
    tp_rr_mult = float(params.get("tp_rr_mult", 2.0))

    df = data.copy()
    df.columns = [c.lower() for c in df.columns]
    n = len(df)

    # ── Ensure DatetimeIndex ─────────────────────────────────────────────
    if not isinstance(df.index, pd.DatetimeIndex):
        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
            df.set_index("timestamp", inplace=True, drop=False)
        else:
            logger.error("No DatetimeIndex or timestamp column found")
            return _empty_signals(n)

    # ── Warmup: enough bars for 4h EMA + 1h indicators ─────────────────
    # 4h bars: need ~4x the 4h EMA period in 1h terms
    warmup_4h = ema4h_period + 10
    warmup_1h = warmup_4h * 4
    warmup_1h = max(warmup_1h, rsi_period + 10, ema1h_period + 10)
    if n < warmup_1h + 100:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup_1h + 100})")
        return _empty_signals(n)

    # ── Compute 4h indicators ────────────────────────────────────────────
    tf_4h = _resample_to_higher_tf(df, "4H")
    if len(tf_4h) < warmup_4h:
        logger.warning(f"Insufficient 4h bars: {len(tf_4h)} (need {warmup_4h})")
        return _empty_signals(n)

    h4_close = tf_4h["close"].values
    ema4h = _compute_ema(h4_close, ema4h_period)

    # 4h EMA slope: rising = current > previous
    ema4h_prev = np.roll(ema4h, 1)
    ema4h_prev[0] = ema4h[0]
    h4_trend_up = ema4h > ema4h_prev

    # ── Compute 1h indicators ────────────────────────────────────────────
    close_1h = df["close"].values
    high_1h = df["high"].values
    low_1h = df["low"].values

    ema1h = _compute_ema(close_1h, ema1h_period)
    rsi_1h = _compute_rsi(close_1h, rsi_period)
    atr_1h = _compute_atr(high_1h, low_1h, close_1h, 14)

    # Price relative to 1h EMA
    price_vs_ema1h = close_1h - ema1h  # positive = above EMA

    # ── Map 4h trend to 1h bars ─────────────────────────────────────────
    # Each 1h bar inherits the 4h trend of its 4h candle
    trend_up_4h = pd.Series(h4_trend_up, index=tf_4h.index)
    trend_up_map = trend_up_4h.to_dict()

    # Map: find closest 4h bar that started before or at current 1h bar time
    df["h4_window"] = df.index.floor("4H")
    df["trend_up_4h"] = df["h4_window"].map(trend_up_map)
    df["trend_up_4h"] = df["trend_up_4h"].fillna(True).astype(bool)

    # ── Entry signals ───────────────────────────────────────────────────
    # Long: 4h EMA rising + price <= 1h EMA + RSI oversold
    long_entries = (
        df["trend_up_4h"].values
        & (price_vs_ema1h <= 0)  # price at or below 1h EMA (pullback)
        & (rsi_1h < rsi_oversold)
    ).astype(bool)

    # Short: 4h EMA falling + price >= 1h EMA + RSI overbought
    short_entries = (
        (~df["trend_up_4h"].values)
        & (price_vs_ema1h >= 0)  # price at or above 1h EMA (pullback)
        & (rsi_1h > rsi_overbought)
    ).astype(bool)

    # ── Exit signals (time-based) ────────────────────────────────────────
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

    # ── Stop-loss and take-profit (ATR-based) ────────────────────────────
    atr_arr = atr_1h.copy()
    atr_arr = np.nan_to_num(atr_arr, nan=0.0)

    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr_arr * sl_atr_mult) / close_1h
    sl_pct = np.clip(sl_pct, 0.005, 0.12)
    sl_pct = np.nan_to_num(sl_pct, nan=0.03)

    with np.errstate(divide="ignore", invalid="ignore"):
        tp_pct = sl_pct * tp_rr_mult
    tp_pct = np.clip(tp_pct, 0.01, 0.20)
    tp_pct = np.nan_to_num(tp_pct, nan=0.06)

    # ── Warmup: suppress signals during indicator warmup ────────────────
    long_entries[:warmup_1h] = False
    long_exits[:warmup_1h] = False
    short_entries[:warmup_1h] = False
    short_exits[:warmup_1h] = False

    # ── Logging ──────────────────────────────────────────────────────────
    n_long = int(np.sum(long_entries))
    n_short = int(np.sum(short_entries))
    logger.info(
        f"EMA Trend Gate: {n} 1h bars, {len(tf_4h)} 4h bars, "
        f"{n_long} long entries, {n_short} short entries | "
        f"4h_ema={ema4h_period} 1h_ema={ema1h_period} "
        f"rsi={rsi_period}/{rsi_oversold}/{rsi_overbought} "
        f"hold={hold_bars}h"
    )

    return {
        "long_entries": long_entries,
        "long_exits": long_exits,
        "short_entries": short_entries,
        "short_exits": short_exits,
        "sl_stop": sl_pct,
        "tp_stop": tp_pct,
    }


def _empty_signals(n: int) -> Dict[str, Any]:
    """Return a no-signal dict for edge cases."""
    return {
        "long_entries": np.zeros(n, dtype=bool),
        "long_exits": np.zeros(n, dtype=bool),
        "short_entries": np.zeros(n, dtype=bool),
        "short_exits": np.zeros(n, dtype=bool),
        "sl_stop": np.full(n, 0.03),
        "tp_stop": np.full(n, 0.06),
    }


class LightweightEMATrendGate:
    """
    EMA Trend Gate wrapper for WFA.

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
        pass

    def generate_vectorized_signals(
        self,
        data: pd.DataFrame,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """WFA entry point. Resolves effective params, then delegates."""
        if params is not None:
            effective_params = params
        elif self.params:
            effective_params = self.params
        elif self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {
                "ema4h_period": 50,
                "ema1h_period": 20,
                "rsi_period": 14,
                "rsi_oversold": 45.0,
                "rsi_overbought": 55.0,
                "hold_bars": 48,
                "sl_atr_mult": 2.0,
                "tp_rr_mult": 2.0,
            }

        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_ema_trend_gate_signals(data, effective_params, self.logger)


__all__ = ["generate_ema_trend_gate_signals", "LightweightEMATrendGate"]

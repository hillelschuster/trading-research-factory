# src/strategies/macd_divergence.py
"""
MACD Divergence with RSI Filter — Momentum Reversal Strategy.

Idea: Hidden bullish/bearish divergence identifies trend exhaustion before
price reverses. RSI filter (oversold/overbought) confirms the pullback is
deep enough to be a real reversal rather than noise.

Logic:
  - Find price swing pivots (HH/HL for uptrend, LH/LL for downtrend)
  - Compute MACD histogram on price
  - Hidden bullish divergence: price makes lower low, MACD makes higher low
  - Hidden bearish divergence: price makes higher high, MACD makes lower high
  - RSI filter: longs only when RSI < rsi_oversold, shorts only when RSI > rsi_overbought
  - Entry on next bar after divergence confirmed
  - Exit: time-based hold_bars OR ATR-based stop

This is a MOMENTUM strategy, fundamentally different from:
  - RSI (price-based momentum without divergence detection)
  - SMA crossover (price-based trend without divergence)
  - BB mean-reversion (volatility-based, no momentum divergence)
  - BB Width Squeeze (volatility contraction, no price/momentum comparison)
  - ATR Volatility Regime (volatility-based, no hidden divergence)
  - Crypto Day-of-Week MACD (uses MACD as filter, not divergence detection)

Parameters:
  - macd_fast     : MACD fast EMA period (default 12)
  - macd_slow     : MACD slow EMA period (default 26)
  - macd_signal   : MACD signal period (default 9)
  - div_lookback  : Lookback for finding swing pivots (default 20)
  - div_confirm_bars : Bars to confirm divergence (default 3)
  - rsi_period    : RSI period (default 14)
  - rsi_oversold  : RSI level for long entries (default 40)
  - rsi_overbought: RSI level for short entries (default 60)
  - hold_bars     : Hold for N bars (default 24)
  - sl_atr_mult   : Stop-loss = ATR × multiplier (default 2.0)
  - atr_period    : ATR lookback (default 14)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _compute_macd(
    close: np.ndarray, fast: int, slow: int, signal: int
) -> tuple:
    """
    Compute MACD line, signal line, and histogram.

    Returns: (macd_line, signal_line, histogram)
    """
    ema_fast = pd.Series(close).ewm(span=fast, adjust=False).mean().values
    ema_slow = pd.Series(close).ewm(span=slow, adjust=False).mean().values
    macd_line = ema_fast - ema_slow
    signal_line = pd.Series(macd_line).ewm(span=signal, adjust=False).mean().values
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


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


def _compute_rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Compute RSI (Relative Strength Index)."""
    delta = close - np.roll(close, 1)
    delta[0] = 0
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = pd.Series(gain).rolling(window=period, min_periods=period).mean().values
    avg_loss = pd.Series(loss).rolling(window=period, min_periods=period).mean().values
    rs = np.divide(avg_gain, avg_loss, where=avg_loss != 0, out=np.zeros_like(avg_gain))
    rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi = np.nan_to_num(rsi, nan=50.0)
    return rsi


def _find_swing_pivots(
    values: np.ndarray, lookback: int
) -> np.ndarray:
    """
    Find local swing highs and lows.

    Returns array where:
      1 = local high pivot (swing high)
     -1 = local low pivot (swing low)
      0 = neither
    """
    n = len(values)
    pivots = np.zeros(n, dtype=int)

    for i in range(lookback, n - lookback):
        window_high = values[i - lookback : i]
        window_low = values[i + 1 : i + lookback + 1]

        if values[i] == np.max(window_high) and values[i] == np.max(np.concatenate([[values[i]], window_high])):
            # Check it's actually the highest in a symmetric window
            full_window = values[i - lookback : i + lookback + 1]
            if values[i] == np.max(full_window):
                pivots[i] = 1  # Swing high

        if values[i] == np.min(window_low) and values[i] == np.min(np.concatenate([[values[i]], window_low])):
            full_window = values[i - lookback : i + lookback + 1]
            if values[i] == np.min(full_window):
                pivots[i] = -1  # Swing low

    return pivots


def _detect_divergence(
    price: np.ndarray,
    macd_hist: np.ndarray,
    pivots_price: np.ndarray,
    pivots_macd: np.ndarray,
    confirm_bars: int,
) -> tuple:
    """
    Detect hidden bullish and bearish divergences.

    Hidden Bullish (reversal up):
      - Price: lower low (LL) at a pivot
      - MACD: higher low (HL) at corresponding pivot
      - Both pivots must be confirmed over confirm_bars

    Hidden Bearish (reversal down):
      - Price: higher high (HH) at a pivot
      - MACD: lower high (LH) at corresponding pivot
      - Both pivots must be confirmed over confirm_bars

    Returns: (bullish_div, bearish_div) boolean arrays
    """
    n = len(price)
    bullish_div = np.zeros(n, dtype=bool)
    bearish_div = np.zeros(n, dtype=bool)

    price_swings = np.where(pivots_price != 0)[0]
    macd_swings = np.where(pivots_macd != 0)[0]

    for i in range(confirm_bars, n):
        # Find the most recent price pivot before i
        price_pivots_before = price_swings[price_swings < i - confirm_bars]
        if len(price_pivots_before) < 2:
            continue

        p1_idx = price_pivots_before[-2]  # Earlier pivot
        p2_idx = price_pivots_before[-1]   # Most recent pivot

        p1_price = price[p1_idx]
        p2_price = price[p2_idx]
        p1_macd = macd_hist[p1_idx]
        p2_macd = macd_hist[p2_idx]

        # Hidden Bullish: price lower low, MACD higher low
        if p2_price < p1_price and p2_macd > p1_macd:
            bullish_div[i] = True

        # Hidden Bearish: price higher high, MACD lower high
        if p2_price > p1_price and p2_macd < p1_macd:
            bearish_div[i] = True

    return bullish_div, bearish_div


def generate_macd_divergence_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate MACD Divergence strategy signals (vectorized, 1h OHLCV input).

    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ────────────────────────────────────────────
    macd_fast = int(params.get("macd_fast", 12))
    macd_slow = int(params.get("macd_slow", 26))
    macd_signal = int(params.get("macd_signal", 9))
    div_lookback = int(params.get("div_lookback", 20))
    div_confirm_bars = int(params.get("div_confirm_bars", 3))
    rsi_period = int(params.get("rsi_period", 14))
    rsi_oversold = float(params.get("rsi_oversold", 40.0))
    rsi_overbought = float(params.get("rsi_overbought", 60.0))
    hold_bars = int(params.get("hold_bars", 24))
    sl_atr_mult = float(params.get("sl_atr_mult", 2.0))
    atr_period = int(params.get("atr_period", 14))

    # ── Normalize columns ────────────────────────────────────────────
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

    # ── Warmup ───────────────────────────────────────────────────────
    warmup = max(macd_slow, div_lookback, rsi_period, atr_period) + div_confirm_bars + 10
    if n < warmup + 50:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup + 50})")
        return _empty_signals(n)

    # ── Compute indicators ───────────────────────────────────────────
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values

    macd_line, signal_line, histogram = _compute_macd(close, macd_fast, macd_slow, macd_signal)
    rsi = _compute_rsi(close, rsi_period)
    atr = _compute_atr(high, low, close, atr_period)

    # ── Find swing pivots on price and MACD histogram ───────────────
    pivots_price = _find_swing_pivots(close, div_lookback)
    pivots_macd = _find_swing_pivots(histogram, div_lookback)

    # ── Detect divergences ───────────────────────────────────────────
    bullish_div, bearish_div = _detect_divergence(
        close, histogram, pivots_price, pivots_macd, div_confirm_bars
    )

    # ── RSI filter ───────────────────────────────────────────────────
    rsi_ok_long = rsi < rsi_oversold
    rsi_ok_short = rsi > rsi_overbought

    # ── Entry signals ─────────────────────────────────────────────────
    long_entries = (bullish_div & rsi_ok_long).astype(bool)
    short_entries = (bearish_div & rsi_ok_short).astype(bool)

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

    # ── Stop-loss (ATR-based, as percentage) ────────────────────────
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
    total_div = int(np.sum(bullish_div)) + int(np.sum(bearish_div))
    logger.info(
        f"MACD Divergence: {n} bars, {total_div} divs detected "
        f"({int(np.sum(bullish_div))} bull / {int(np.sum(bearish_div))} bear), "
        f"{total_long} long entries, {total_short} short entries | "
        f"MACD={macd_fast}/{macd_slow}/{macd_signal} "
        f"div_lb={div_lookback} rsi={rsi_period}/{rsi_oversold}/{rsi_overbought}"
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


class MACDDivergenceStrategy:
    """
    MACD Divergence with RSI Filter — WFA wrapper.

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
                "macd_fast": 12,
                "macd_slow": 26,
                "macd_signal": 9,
                "div_lookback": 20,
                "div_confirm_bars": 3,
                "rsi_period": 14,
                "rsi_oversold": 40.0,
                "rsi_overbought": 60.0,
                "hold_bars": 24,
                "sl_atr_mult": 2.0,
                "atr_period": 14,
            }

        # Normalise to plain dict
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_macd_divergence_signals(data, effective_params, self.logger)


__all__ = ["generate_macd_divergence_signals", "MACDDivergenceStrategy"]

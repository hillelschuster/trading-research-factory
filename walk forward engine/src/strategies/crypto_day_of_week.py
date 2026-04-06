# src/strategies/crypto_day_of_week.py
"""
Crypto Day-of-Week MACD Momentum Strategy.

Idea source: Adapted from Gold Rush Pro for crypto markets
Logic (converted for hourly crypto data):
  - Use MACD histogram as momentum filter instead of RSI
  - Entry: On the first hour bar of the entry day,
           if previous-day MACD histogram < threshold, go long.
  - Stop-loss: ATR-based (previous-hour ATR × multiplier)
  - Exit: After hold_hours (time-based exit).
  - Long-only strategy.

Parameters (optimizable via WFA):
  - macd_fast    : MACD fast EMA period   (default 12)
  - macd_slow    : MACD slow EMA period   (default 26)
  - macd_signal  : MACD signal period    (default 9)
  - macd_threshold: Enter when MACD histogram < threshold (default 0.0)
  - atr_period   : ATR look-back period  (default 14)
  - atr_sl_multiplier: SL = ATR × multiplier (default 2.0)
  - hold_hours   : Close after N hours    (default 24)
  - entry_day    : ISO day-of-week for entry (1=Mon...7=Sun) (default 4=Thursday)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _resample_to_daily(df: pd.DataFrame) -> pd.DataFrame:
    """
    Resample hourly OHLCV data to daily OHLCV.

    Expects a DatetimeIndex (UTC) and lowercase columns.
    Returns a DataFrame indexed by date with open/high/low/close/volume.
    """
    daily = df.resample("D").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna(subset=["open"])
    return daily


def _compute_macd(close: np.ndarray, fast: int, slow: int, signal: int) -> np.ndarray:
    """Compute MACD histogram (MACD line - signal line)."""
    # Compute EMAs
    ema_fast = pd.Series(close).ewm(span=fast, adjust=False).mean().values
    ema_slow = pd.Series(close).ewm(span=slow, adjust=False).mean().values
    
    # MACD line
    macd_line = ema_fast - ema_slow
    
    # Signal line (EMA of MACD line)
    signal_line = pd.Series(macd_line).ewm(span=signal, adjust=False).mean().values
    
    # Histogram
    histogram = macd_line - signal_line
    return histogram


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


def generate_crypto_dow_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate Crypto Day-of-Week MACD signals (vectorized, 1h input).

    The function resamples hourly → daily, computes MACD on daily bars,
    shifts indicators by 1 day to avoid look-ahead, then maps signals
    back to the hourly timeframe.

    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ────────────────────────────────────────────
    macd_fast = int(params.get("macd_fast", 12))
    macd_slow = int(params.get("macd_slow", 26))
    macd_signal = int(params.get("macd_signal", 9))
    macd_threshold = float(params.get("macd_threshold", 0.0))
    atr_period = int(params.get("atr_period", 14))
    atr_sl_mult = float(params.get("atr_sl_multiplier", 2.0))
    hold_hours = int(params.get("hold_hours", 24))
    entry_day = int(params.get("entry_day", 4))  # ISO weekday: 4 = Thursday

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

    # ── Warmup check ──────────────────────────────────────────────────
    warmup_days = max(macd_slow, atr_period) + 5
    # Each day ~24 hourly bars
    warmup_bars = warmup_days * 24
    if n < warmup_bars + 50:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup_bars + 50})")
        return _empty_signals(n)

    # ── Resample to daily ─────────────────────────────────────────────
    daily = _resample_to_daily(df)

    if len(daily) < warmup_days + 5:
        logger.warning(f"Insufficient daily bars: {len(daily)}")
        return _empty_signals(n)

    # ── Daily indicators ─────────────────────────────────────────────
    daily_close = daily["close"].values
    daily_high = daily["high"].values
    daily_low = daily["low"].values

    macd_hist = _compute_macd(daily_close, macd_fast, macd_slow, macd_signal)
    atr = _compute_atr(daily_high, daily_low, daily_close, atr_period)

    # Shift by 1 day to remove look-ahead bias (use PREVIOUS day's values)
    macd_shifted = np.roll(macd_hist, 1)
    macd_shifted[0] = 0.0  # neutral default
    atr_shifted = np.roll(atr, 1)
    atr_shifted[0] = np.nan

    daily["macd_prev"] = macd_shifted
    daily["atr_prev"] = atr_shifted

    # ── Map daily indicators to hourly bars ─────────────────────────────
    df["date"] = df.index.date
    daily["date"] = daily.index.date

    daily_map = daily[["date", "macd_prev", "atr_prev"]].set_index("date")
    df = df.merge(daily_map, left_on="date", right_index=True, how="left")

    # ── Entry signals ─────────────────────────────────────────────────
    # ISO weekday: Monday=1 … Sunday=7
    df["iso_weekday"] = df.index.weekday + 1  # pandas weekday 0=Mon → ISO 1=Mon

    # First hourly bar of the entry_day
    df["is_entry_day"] = df["iso_weekday"] == entry_day
    # Mark only the first bar of each entry day
    df["prev_is_entry_day"] = df["is_entry_day"].shift(1).fillna(False)
    df["first_bar_of_day"] = df["is_entry_day"] & (~df["prev_is_entry_day"])

    # MACD condition: histogram below threshold (mean-reversion: oversold)
    macd_condition = df["macd_prev"] < macd_threshold

    # Valid ATR (not NaN)
    atr_valid = df["atr_prev"].notna() & (df["atr_prev"] > 0)

    long_entries = (
        df["first_bar_of_day"]
        & macd_condition
        & atr_valid
    ).values.astype(bool)

    # ── Exit signals (time-based: after hold_hours) ────────────────────
    long_exits = np.zeros(n, dtype=bool)

    # For each entry, set exit at +hold_hours
    entry_indices = np.where(long_entries)[0]
    for idx in entry_indices:
        entry_time = df.index[idx]
        exit_time = entry_time + pd.Timedelta(hours=hold_hours)
        # Find the first hourly bar at or after exit_time
        exit_mask = df.index >= exit_time
        exit_candidates = np.where(exit_mask)[0]
        if len(exit_candidates) > 0:
            exit_idx = exit_candidates[0]
            if exit_idx < n:
                long_exits[exit_idx] = True

    # ── Stop-loss (ATR-based, as percentage) ──────────────────────────
    close_arr = df["close"].values
    atr_prev_arr = df["atr_prev"].values.copy()
    atr_prev_arr = np.nan_to_num(atr_prev_arr, nan=0.0)

    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr_prev_arr * atr_sl_mult) / close_arr
    sl_pct = np.clip(sl_pct, 0.005, 0.15)  # 0.5% – 15% range
    sl_pct = np.nan_to_num(sl_pct, nan=0.05)

    # ── Warmup: suppress signals during indicator warmup ──────────────
    long_entries[:warmup_bars] = False
    long_exits[:warmup_bars] = False

    # ── Short side: not used (long-only strategy) ─────────────────────
    short_entries = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)

    # ── Logging ───────────────────────────────────────────────────────
    total_entries = int(np.sum(long_entries))
    total_exits = int(np.sum(long_exits))
    logger.info(
        f"Crypto DOW: {n} hourly bars, {len(daily)} daily bars, "
        f"{total_entries} entries, {total_exits} exits | "
        f"MACD<{macd_threshold} day={entry_day} hold={hold_hours}h"
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
        "sl_stop": np.full(n, 0.05),
        "tp_stop": np.full(n, np.nan),
    }


class CryptoDayOfWeek:
    """
    Crypto Day-of-Week MACD wrapper for WFA.
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
        """Hook called by LightweightStrategy after params are injected."""
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
                "macd_threshold": 0.0,
                "atr_period": 14,
                "atr_sl_multiplier": 2.0,
                "hold_hours": 24,
                "entry_day": 4,
            }

        # Normalise to plain dict (handles AttrDict / Pydantic / etc.)
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_crypto_dow_signals(data, effective_params, self.logger)


__all__ = ["generate_crypto_dow_signals", "CryptoDayOfWeek"]

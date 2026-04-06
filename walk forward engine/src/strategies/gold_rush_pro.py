# src/strategies/gold_rush_pro.py
"""
Gold Rush Pro – Day-of-Week RSI Mean-Reversion Strategy for XAUUSD.

Idea source: ideas.md (Gold_Rush_Pro.mq5)
Logic (converted from MQL5 D1 to vectorized M15):
  - Resample M15 bars → daily OHLC
  - Compute RSI and ATR on daily bars, shift by 1 (no look-ahead)
  - Entry: On the first M15 bar of the entry day (default Thursday),
           if previous-day RSI < threshold, go long.
  - Stop-loss: ATR-based (previous-day ATR × multiplier)
  - Exit:  After hold_days calendar days (time-based exit).
  - Long-only strategy (matching the original MQL5 logic).

Parameters (optimizable via WFA):
  - rsi_period       : RSI look-back in daily bars  (default 14)
  - rsi_threshold    : Buy when RSI < threshold      (default 40)
  - atr_period       : ATR look-back in daily bars   (default 14)
  - atr_sl_multiplier: SL = ATR × multiplier         (default 1.5)
  - hold_days        : Close after N calendar days    (default 3)
  - entry_day        : ISO day-of-week for entry (4=Thu) (default 4)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _resample_to_daily(df: pd.DataFrame) -> pd.DataFrame:
    """
    Resample M15 OHLCV data to daily OHLCV.

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


def _compute_rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Compute RSI using exponential moving average of gains/losses."""
    delta = np.diff(close, prepend=close[0])
    gains = np.where(delta > 0, delta, 0.0)
    losses = np.where(delta < 0, -delta, 0.0)

    avg_gain = pd.Series(gains).ewm(span=period, adjust=False).mean().values
    avg_loss = pd.Series(losses).ewm(span=period, adjust=False).mean().values

    rs = avg_gain / (avg_loss + 1e-10)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return rsi


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


def generate_gold_rush_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate Gold Rush Pro signals (vectorized, M15 input).

    The function resamples M15 → daily, computes RSI/ATR on daily bars,
    shifts indicators by 1 day to avoid look-ahead, then maps signals
    back to the M15 timeframe.

    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ────────────────────────────────────────────
    rsi_period = int(params.get("rsi_period", 14))
    rsi_threshold = float(params.get("rsi_threshold", 40.0))
    atr_period = int(params.get("atr_period", 14))
    atr_sl_mult = float(params.get("atr_sl_multiplier", 1.5))
    hold_days = int(params.get("hold_days", 3))
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
    warmup_days = max(rsi_period, atr_period) + 5
    # Rough: each day ~96 M15 bars
    warmup_bars = warmup_days * 96
    if n < warmup_bars + 50:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup_bars + 50})")
        return _empty_signals(n)

    # ── Resample to daily ─────────────────────────────────────────────
    daily = _resample_to_daily(df)

    if len(daily) < warmup_days + 5:
        logger.warning(f"Insufficient daily bars: {len(daily)}")
        return _empty_signals(n)

    # ── Daily indicators ──────────────────────────────────────────────
    daily_close = daily["close"].values
    daily_high = daily["high"].values
    daily_low = daily["low"].values

    rsi = _compute_rsi(daily_close, rsi_period)
    atr = _compute_atr(daily_high, daily_low, daily_close, atr_period)

    # Shift by 1 day to remove look-ahead bias (use PREVIOUS day's values)
    rsi_shifted = np.roll(rsi, 1)
    rsi_shifted[0] = 50.0  # neutral default
    atr_shifted = np.roll(atr, 1)
    atr_shifted[0] = np.nan

    daily["rsi_prev"] = rsi_shifted
    daily["atr_prev"] = atr_shifted

    # ── Map daily indicators to M15 bars ──────────────────────────────
    # Each M15 bar gets the indicators of *its* calendar date
    # (which are already the previous day's values due to the shift above)
    df["date"] = df.index.date
    daily["date"] = daily.index.date

    daily_map = daily[["date", "rsi_prev", "atr_prev"]].set_index("date")
    df = df.merge(daily_map, left_on="date", right_index=True, how="left")

    # ── Entry signals ─────────────────────────────────────────────────
    # ISO weekday: Monday=1 … Sunday=7
    df["iso_weekday"] = df.index.weekday + 1  # pandas weekday 0=Mon → ISO 1=Mon

    # First M15 bar of the entry_day
    df["is_entry_day"] = df["iso_weekday"] == entry_day
    # Mark only the first bar of each entry day
    df["prev_is_entry_day"] = df["is_entry_day"].shift(1).fillna(False)
    df["first_bar_of_day"] = df["is_entry_day"] & (~df["prev_is_entry_day"])

    # RSI condition (previous day's RSI < threshold)
    rsi_condition = df["rsi_prev"] < rsi_threshold

    # Valid ATR (not NaN)
    atr_valid = df["atr_prev"].notna() & (df["atr_prev"] > 0)

    long_entries = (
        df["first_bar_of_day"]
        & rsi_condition
        & atr_valid
    ).values.astype(bool)

    # ── Exit signals (time-based: after hold_days) ────────────────────
    long_exits = np.zeros(n, dtype=bool)

    # For each entry, set exit at +hold_days calendar days
    entry_indices = np.where(long_entries)[0]
    for idx in entry_indices:
        entry_date = df.index[idx]
        exit_date = entry_date + pd.Timedelta(days=hold_days)
        # Find the first M15 bar at or after exit_date
        exit_mask = df.index >= exit_date
        exit_candidates = np.where(exit_mask)[0]
        if len(exit_candidates) > 0:
            exit_idx = exit_candidates[0]
            if exit_idx < n:
                long_exits[exit_idx] = True

    # ── Stop-loss (ATR-based, as percentage) ──────────────────────────
    # SL distance = atr_prev × multiplier
    # Convert to percentage of close price for the vectorized engine
    close_arr = df["close"].values
    atr_prev_arr = df["atr_prev"].values.copy()
    atr_prev_arr = np.nan_to_num(atr_prev_arr, nan=0.0)

    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr_prev_arr * atr_sl_mult) / close_arr
    sl_pct = np.clip(sl_pct, 0.005, 0.10)  # 0.5% – 10% range
    sl_pct = np.nan_to_num(sl_pct, nan=0.03)

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
        f"Gold Rush Pro: {n} M15 bars, {len(daily)} daily bars, "
        f"{total_entries} entries, {total_exits} exits | "
        f"RSI<{rsi_threshold} day={entry_day} hold={hold_days}d"
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
        "sl_stop": np.full(n, 0.03),
        "tp_stop": np.full(n, np.nan),
    }


class LightweightGoldRushPro:
    """
    Gold Rush Pro wrapper for WFA.

    Follows the same pattern as LightweightGoldTrendFollowing:
    minimal __init__, generate_vectorized_signals delegates to the
    pure-function implementation above.
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
        WFA entry point.  Resolves effective params, then delegates.
        """
        if params is not None:
            effective_params = params
        elif hasattr(self, "params") and self.params:
            effective_params = self.params
        elif hasattr(self, "strategy_params") and self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {
                "rsi_period": 14,
                "rsi_threshold": 40.0,
                "atr_period": 14,
                "atr_sl_multiplier": 1.5,
                "hold_days": 3,
                "entry_day": 4,
            }

        # Normalise to plain dict (handles AttrDict / Pydantic / etc.)
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_gold_rush_signals(data, effective_params, self.logger)


__all__ = ["generate_gold_rush_signals", "LightweightGoldRushPro"]

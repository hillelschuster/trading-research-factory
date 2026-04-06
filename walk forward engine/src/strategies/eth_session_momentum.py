# walk forward engine/src/strategies/eth_session_momentum.py
"""
ETH Session Momentum: Europe-to-US Continuation Strategy.

Hypothesis: In 24/7 crypto markets, strong ETH returns during the European session
(08:00-16:00 UTC) predict continued momentum into the US session (14:00-22:00 UTC).
This is the OPPOSITE of equity markets, where MM overnight hedging causes reversal.

Mechanism: Institutional orders entered during EU hours carry forward without the
overnight close/open gap and MM rebalancing pressure that forces reversals in equities.

Logic:
  - At 14:00 UTC (US session start): compute EU session return (08:00-16:00)
  - If EU session return exceeds momentum threshold (percentile-based):
      -> Long entry at 14:00 UTC
  - Exit: at 22:00 UTC (US session close) OR SL/TP
  - Optional: short side when EU session is strongly negative

Sessions:
  - EU session: 08:00-16:00 UTC (8 hours)
  - US session: 14:00-22:00 UTC (8 hours, overlaps EU last 2 hours)
  - Entry: 14:00 UTC (when EU session candles are fully closed, no look-ahead)

Parameters (optimizable via WFA):
  - momentum_percentile : top percentile of EU session returns to trigger entry (default 80)
  - min_momentum_pct    : minimum EU return % to trigger entry (default 0.5%)
  - eu_start_hour       : EU session start hour UTC (default 8)
  - eu_end_hour         : EU session end hour UTC (default 16)
  - entry_hour          : US session entry hour UTC (default 14)
  - exit_hour           : US session exit hour UTC (default 22)
  - sl_atr_mult         : SL = ATR * multiplier (default 2.0)
  - tp_rr_mult          : TP = SL * R:R ratio (default 1.5)
  - use_short_side      : Enable short entries on negative EU sessions (default false)
  - min_short_momentum  : Minimum negative EU return for short entry (default -0.5%)
  - trailing_stop       : Enable trailing stop (default false)
  - ts_atr_mult         : Trailing stop ATR multiplier (default 1.5)
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, Optional
import logging


def _compute_atr(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    period: int
) -> np.ndarray:
    """Compute ATR using numpy."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    # Rolling mean with min_periods
    result = np.zeros_like(tr)
    result[period - 1 :] = np.array([
        np.mean(tr[i - period + 1 : i + 1])
        for i in range(period - 1, len(tr))
    ])
    return result


def _resample_session_returns(
    close: np.ndarray,
    timestamps: np.ndarray,
    session_start: int,
    session_end: int,
) -> np.ndarray:
    """
    Compute session-level returns using numpy.
    A session runs from session_start to session_end UTC hour.
    Returns array of same length as close, with NaN for non-session bars.
    Uses only past closed candles (no look-ahead).
    """
    n = len(close)
    session_returns = np.full(n, np.nan, dtype=np.float64)

    for i in range(1, n):
        # Get hour of current bar
        current_ts = timestamps[i] if isinstance(timestamps[i], int) else 0
        current_hour = (current_ts // 3600) % 24

        # Only compute at the entry hour (session close for our purposes)
        if current_hour != session_end:
            continue

        # Find session start for this bar's session
        # EU session: find bars from session_start to session_end today
        current_ts_sec = current_ts
        current_day_start = current_ts_sec - (current_hour * 3600)

        session_start_ts = current_day_start + (session_start * 3600)
        session_end_ts = current_day_start + (session_end * 3600)

        # Collect session bars (closed candles only, so use i-1 as boundary)
        session_bar_start = -1
        for j in range(i - 1, max(0, i - 24), -1):
            bar_ts = timestamps[j] if isinstance(timestamps[j], int) else 0
            if bar_ts < session_start_ts:
                session_bar_start = j + 1
                break

        if session_bar_start < 0:
            continue

        session_bars = close[session_bar_start:i]
        if len(session_bars) >= 2:
            session_return = (session_bars[-1] / session_bars[0]) - 1.0
            session_returns[i] = session_return

    return session_returns


def _resample_session_returns_vectorized(
    close: np.ndarray,
    timestamps: np.ndarray,
    session_start: int,
    session_end: int,
) -> np.ndarray:
    """
    Vectorized session return computation.
    For each bar at session_end hour, compute return from session_start to session_end today.
    Much faster than loop-based version for large datasets.
    """
    n = len(close)
    hours = np.zeros(n, dtype=np.int32)
    for i in range(n):
        ts = timestamps[i] if isinstance(timestamps[i], int) else int(timestamps[i])
        hours[i] = (ts // 3600) % 24

    # Days since epoch (floor division by 86400)
    days = np.zeros(n, dtype=np.int64)
    for i in range(n):
        ts = timestamps[i] if isinstance(timestamps[i], int) else int(timestamps[i])
        days[i] = ts // 86400

    session_returns = np.full(n, np.nan, dtype=np.float64)

    # Find entry points: bars at the exact session_end hour
    entry_mask = hours == session_end

    # Get unique (day, session_return) pairs
    for i in np.where(entry_mask)[0]:
        if i == 0:
            continue

        current_day = days[i]

        # Find first bar of this session (first bar at or after session_start today)
        session_start_ts = current_day * 86400 + session_start * 3600

        # Walk backward to find the session start bar
        session_bar_start = -1
        for j in range(i - 1, max(0, i - 24), -1):
            bar_ts = timestamps[j] if isinstance(timestamps[j], int) else int(timestamps[j])
            if bar_ts < session_start_ts:
                session_bar_start = j + 1
                break

        if session_bar_start < 0:
            continue

        session_bars = close[session_bar_start : i + 1]
        if len(session_bars) >= 2:
            session_returns[i] = (session_bars[-1] / session_bars[0]) - 1.0

    return session_returns


def _compute_session_returns_fast(
    close: np.ndarray,
    timestamps: np.ndarray,
    session_start: int,
    session_end: int,
) -> np.ndarray:
    """
    Fast session return computation using pre-computed hour/day arrays.
    Entry signal fires at the session_end hour.
    """
    n = len(close)

    # Pre-compute hour and day for each bar
    hours = np.zeros(n, dtype=np.int32)
    days = np.zeros(n, dtype=np.int64)
    for i in range(n):
        ts = int(timestamps[i]) if not isinstance(timestamps[i], int) else timestamps[i]
        hours[i] = (ts // 3600) % 24
        days[i] = ts // 86400

    session_returns = np.full(n, np.nan, dtype=np.float64)

    # Only compute at session_end hour
    entry_indices = np.where(hours == session_end)[0]

    for i in entry_indices:
        if i < 2:
            continue

        current_day = days[i]

        # session start today in absolute seconds
        session_start_abs = current_day * 86400 + session_start * 3600

        # Find the first bar of the session (within last 24 bars to be safe)
        session_bar_start = -1
        for j in range(i - 1, max(0, i - 24), -1):
            bar_ts = int(timestamps[j]) if not isinstance(timestamps[j], int) else timestamps[j]
            if bar_ts < session_start_abs:
                session_bar_start = j + 1
                break

        if session_bar_start < 0:
            continue

        bars = close[session_bar_start : i + 1]
        if len(bars) >= 2 and bars[0] > 0:
            session_returns[i] = (bars[-1] / bars[0]) - 1.0

    return session_returns


def generate_eth_session_momentum_signals(
    data,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate ETH session momentum signals (vectorized).

    Expects `data` to have columns: open, high, low, close, volume
    and a DatetimeIndex or timestamp array.

    Entry rules:
      - Long: At 14:00 UTC, if EU session return (08:00-16:00 UTC) exceeds
              momentum_percentile AND is above min_momentum_pct
      - Short: At 14:00 UTC, if EU session return is below min_short_momentum
               AND use_short_side is enabled

    Exit rules:
      - Time-based: exit at exit_hour (default 22:00 UTC)
      - Stop-loss: ATR-based %
      - Take-profit: risk-reward ratio
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ──────────────────────────────────────────────
    momentum_percentile = float(params.get("momentum_percentile", 80.0))
    min_momentum_pct = float(params.get("min_momentum_pct", 0.5)) / 100.0
    eu_start_hour = int(params.get("eu_start_hour", 8))
    eu_end_hour = int(params.get("eu_end_hour", 16))
    entry_hour = int(params.get("entry_hour", 14))
    exit_hour = int(params.get("exit_hour", 22))
    sl_atr_mult = float(params.get("sl_atr_mult", 2.0))
    tp_rr_mult = float(params.get("tp_rr_mult", 1.5))
    use_short_side = bool(params.get("use_short_side", False))
    min_short_momentum = float(params.get("min_short_momentum", -0.5)) / 100.0
    atr_period = int(params.get("atr_period", 14))
    trailing_stop = bool(params.get("trailing_stop", False))
    ts_atr_mult = float(params.get("ts_atr_mult", 1.5))

    # ── Extract OHLCV arrays (support both lowercase and uppercase columns) ──
    if not hasattr(data, "values"):
        raise ValueError("data must be a pandas DataFrame with OHLCV columns")

    def _get_col(df, *names):
        for name in names:
            if name in df.columns:
                return df[name].values.astype(np.float64)
        raise ValueError(f"None of {names} found in data columns: {list(df.columns)}")

    close = _get_col(data, "close", "Close")
    high = _get_col(data, "high", "High")
    low = _get_col(data, "low", "Low")
    volume = _get_col(data, "volume", "Volume") if any(c in data.columns for c in ("volume", "Volume")) else None

    n = len(close)
    logger.info(f"ETH Session Momentum: processing {n} bars")

    # ── Extract timestamps from DatetimeIndex ───────────────────────────
    try:
        # Correct: convert each DatetimeIndex entry to Unix seconds via pd.Timestamp
        ts_array = np.array([
            int(pd.Timestamp(dt).timestamp())
            for dt in data.index
        ], dtype=np.int64)
    except Exception:
        # Fallback: use ordinal day index
        ts_array = np.arange(n, dtype=np.int64)

    # ── Compute EU session returns ───────────────────────────────────────
    eu_session_returns = _compute_session_returns_fast(
        close, ts_array, eu_start_hour, eu_end_hour
    )

    # ── Compute ATR ──────────────────────────────────────────────────────
    atr = _compute_atr(high, low, close, atr_period)

    # ── Determine momentum thresholds ───────────────────────────────────
    valid_returns = eu_session_returns[~np.isnan(eu_session_returns)]
    if len(valid_returns) < 10:
        logger.warning(f"Too few EU session returns: {len(valid_returns)}")
        momentum_threshold = min_momentum_pct
    else:
        # Use percentile of observed returns as threshold
        pct_value = np.percentile(valid_returns, momentum_percentile)
        momentum_threshold = max(pct_value, min_momentum_pct)
        logger.info(
            f"EU session returns: n={len(valid_returns)}, "
            f"p{momentum_percentile}={pct_value:.4f}, threshold={momentum_threshold:.4f}"
        )

    # ── Extract hour of day for each bar ─────────────────────────────────
    hours = np.array([(ts // 3600) % 24 for ts in ts_array], dtype=np.int32)

    # ── Generate entry signals ───────────────────────────────────────────
    long_entries = np.zeros(n, dtype=np.bool_)
    long_exits = np.zeros(n, dtype=np.bool_)
    short_entries = np.zeros(n, dtype=np.bool_)
    short_exits = np.zeros(n, dtype=np.bool_)

    # Track open positions
    in_long = False
    in_short = False
    entry_price = 0.0
    entry_bar = -1
    stop_loss = 0.0
    take_profit = 0.0
    trailing_stop_price = 0.0

    for i in range(n):
        hour = hours[i]
        c = close[i]
        h = high[i]
        l = low[i]
        eu_ret = eu_session_returns[i]

        # ── Time-based exits ────────────────────────────────────────────
        if in_long or in_short:
            exit_bar = i - entry_bar
            max_hold_bars = (exit_hour - entry_hour) if exit_hour > entry_hour else (exit_hour + 24 - entry_hour)
            if exit_bar >= max_hold_bars:
                long_exits[i] = in_long
                short_exits[i] = in_short
                in_long = False
                in_short = False
                continue

            # SL/TP check
            if in_long:
                if trailing_stop and trailing_stop_price > 0 and c <= trailing_stop_price:
                    long_exits[i] = True
                    in_long = False
                    continue
                if c <= stop_loss:
                    long_exits[i] = True
                    in_long = False
                    continue
                if c >= take_profit:
                    long_exits[i] = True
                    in_long = False
                    continue
            elif in_short:
                if trailing_stop and trailing_stop_price > 0 and c >= trailing_stop_price:
                    short_exits[i] = True
                    in_short = False
                    continue
                if c >= stop_loss:
                    short_exits[i] = True
                    in_short = False
                    continue
                if c <= take_profit:
                    short_exits[i] = True
                    in_short = False
                    continue

        # ── Entry signals ───────────────────────────────────────────────
        # Entry fires at eu_end_hour (when EU session closes and return is computed)
        if not in_long and not in_short and hour == eu_end_hour:
            if not np.isnan(eu_ret) and eu_ret >= momentum_threshold:
                in_long = True
                entry_price = c
                entry_bar = i
                sl_dist = atr[i] * sl_atr_mult
                stop_loss = c - sl_dist
                take_profit = c + sl_dist * tp_rr_mult
                if trailing_stop:
                    trailing_stop_price = c - atr[i] * ts_atr_mult
                long_entries[i] = True
            elif use_short_side and not np.isnan(eu_ret) and eu_ret <= min_short_momentum:
                in_short = True
                entry_price = c
                entry_bar = i
                sl_dist = atr[i] * sl_atr_mult
                stop_loss = c + sl_dist
                take_profit = c - sl_dist * tp_rr_mult
                if trailing_stop:
                    trailing_stop_price = c + atr[i] * ts_atr_mult
                short_entries[i] = True

        # ── Update trailing stop ───────────────────────────────────────
        if trailing_stop and (in_long or in_short):
            if in_long:
                new_ts_price = c - atr[i] * ts_atr_mult
                if new_ts_price > trailing_stop_price:
                    trailing_stop_price = new_ts_price
            elif in_short:
                new_ts_price = c + atr[i] * ts_atr_mult
                if new_ts_price < trailing_stop_price:
                    trailing_stop_price = new_ts_price

    # Count trades for logging
    n_long = np.sum(long_entries)
    n_short = np.sum(short_entries)
    logger.info(f"Signals generated: {n_long} long entries, {n_short} short entries")

    return {
        "long_entries": long_entries,
        "long_exits": long_exits,
        "short_entries": short_entries,
        "short_exits": short_exits,
        "sl_stop": None,
        "tp_stop": None,
    }


class ETHSessionMomentum:
    """
    ETH Session Momentum wrapper for WFA.

    Follows the standard pattern: minimal __init__,
    generate_vectorized_signals delegates to the pure-function.
    """

    def __init__(
        self,
        params=None,
        logger=None,
    ):
        self.params = params or {}
        self.strategy_params = params or {}
        self.logger = logger or __import__("logging").getLogger(__name__)

    def _initialize_strategy_parameters(self) -> None:
        pass

    def generate_vectorized_signals(
        self,
        data,
        params=None,
    ):
        """WFA entry point. Resolves effective params, then delegates."""
        if params is not None:
            effective_params = params
        elif self.params:
            effective_params = self.params
        elif self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {
                "momentum_percentile": 70.0,
                "min_momentum_pct": 0.2,
                "eu_start_hour": 8,
                "eu_end_hour": 15,
                "entry_hour": 15,  # same as eu_end_hour (entry fires when EU session closes)
                "exit_hour": 21,
                "atr_period": 14,
                "sl_atr_mult": 2.0,
                "tp_rr_mult": 1.5,
                "use_short_side": False,
                "min_short_momentum": -0.5,
                "trailing_stop": False,
                "ts_atr_mult": 1.5,
            }

        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_eth_session_momentum_signals(data, effective_params, self.logger)


__all__ = ["generate_eth_session_momentum_signals", "ETHSessionMomentum"]

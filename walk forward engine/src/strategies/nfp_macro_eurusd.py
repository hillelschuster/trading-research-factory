"""
EURUSD M15 U.S. Employment Situation/NFP macro-announcement screen.

This Phase 8D candidate tests whether scheduled U.S. labor-market news leaves
a short-horizon continuation or fade footprint in EURUSD. It uses only bar
timestamps, OHLCV, ATR, pre-event range, and the first post-release reaction.
"""

import logging
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd


def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum.reduce([high - low, np.abs(high - prev_close), np.abs(low - prev_close)])
    return pd.Series(tr).rolling(window=period, min_periods=period).mean().values


def _empty_signals(n: int) -> Dict[str, Any]:
    return {
        "long_entries": np.zeros(n, dtype=bool),
        "long_exits": np.zeros(n, dtype=bool),
        "short_entries": np.zeros(n, dtype=bool),
        "short_exits": np.zeros(n, dtype=bool),
        "sl_stop": np.full(n, 0.004),
        "tp_stop": np.full(n, np.nan),
    }


def _coerce_utc_index(df: pd.DataFrame, logger: logging.Logger) -> Optional[pd.DataFrame]:
    if isinstance(df.index, pd.DatetimeIndex):
        if df.index.tz is None:
            df = df.copy()
            df.index = df.index.tz_localize("UTC")
        return df
    if "timestamp" not in df.columns:
        logger.error("No DatetimeIndex or timestamp column found")
        return None
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df.set_index("timestamp", inplace=True, drop=False)
    return df


def _release_hour_mask(index: pd.DatetimeIndex, mode: str) -> np.ndarray:
    hour = index.hour.to_numpy()
    if mode == "fixed_12_utc":
        return hour == 12
    if mode == "fixed_13_utc":
        return hour == 13

    month = index.month.to_numpy()
    # Approximate U.S. daylight-saving release conversion: 08:30 ET is usually
    # 12:30 UTC from spring through autumn and 13:30 UTC in winter.
    dst_like = (month >= 3) & (month <= 10)
    return ((dst_like) & (hour == 12)) | ((~dst_like) & (hour == 13))


def generate_nfp_macro_eurusd_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    logger = logger or logging.getLogger(__name__)
    df = data.copy()
    df.columns = [str(c).lower() for c in df.columns]
    n = len(df)
    if n == 0:
        return _empty_signals(n)

    df = _coerce_utc_index(df, logger)
    if df is None:
        return _empty_signals(n)

    if not {"open", "high", "low", "close", "volume"}.issubset(df.columns):
        logger.error("Missing required OHLCV columns for NFP macro screen")
        return _empty_signals(n)

    atr_period = int(params.get("atr_period", 14))
    pre_event_lookback = int(params.get("pre_event_lookback", 8))
    reaction_bars = int(params.get("reaction_bars", 1))
    min_reaction_return = float(params.get("min_reaction_return", 0.00015))
    pre_range_atr_mult_max = float(params.get("pre_range_atr_mult_max", 3.0))
    volume_lookback = int(params.get("volume_lookback", 96))
    volume_ratio_max = float(params.get("volume_ratio_max", 2.5))
    max_hold_bars = int(params.get("max_hold_bars", 8))
    sl_atr_mult = float(params.get("sl_atr_mult", 1.5))
    tp_atr_mult = float(params.get("tp_atr_mult", 2.5))
    direction_mode = str(params.get("direction_mode", "continuation"))
    release_hour_mode = str(params.get("release_hour_mode", "us_dst_approx"))

    warmup = max(atr_period, pre_event_lookback, volume_lookback) + reaction_bars + 10
    if n < warmup + max_hold_bars + 20:
        logger.warning("Insufficient data: %s bars", n)
        return _empty_signals(n)

    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    close = df["close"].to_numpy(dtype=float)
    volume = df["volume"].to_numpy(dtype=float)

    atr = _compute_atr(high, low, close, atr_period)
    with np.errstate(divide="ignore", invalid="ignore"):
        atr_pct = atr / close
    atr_pct = np.nan_to_num(atr_pct, nan=0.0)

    rolling_high = pd.Series(high).rolling(window=pre_event_lookback, min_periods=pre_event_lookback).max().shift(1).values
    rolling_low = pd.Series(low).rolling(window=pre_event_lookback, min_periods=pre_event_lookback).min().shift(1).values
    with np.errstate(divide="ignore", invalid="ignore"):
        pre_range_to_atr = ((rolling_high - rolling_low) / close) / atr_pct
    pre_range_to_atr = np.nan_to_num(pre_range_to_atr, nan=np.inf, posinf=np.inf, neginf=np.inf)

    volume_median = pd.Series(volume).rolling(window=volume_lookback, min_periods=volume_lookback).median().shift(1).values
    with np.errstate(divide="ignore", invalid="ignore"):
        volume_ratio = volume / volume_median
    volume_ratio = np.nan_to_num(volume_ratio, nan=0.0, posinf=np.inf, neginf=0.0)

    index = df.index
    day = index.day.to_numpy()
    weekday = index.weekday.to_numpy()
    minute = index.minute.to_numpy()
    first_friday = (weekday == 4) & (day <= 7)
    release_time = first_friday & (minute == 30) & _release_hour_mask(index, release_hour_mode)

    long_entries = np.zeros(n, dtype=bool)
    short_entries = np.zeros(n, dtype=bool)

    for release_idx in np.where(release_time)[0]:
        reaction_idx = release_idx + reaction_bars - 1
        entry_idx = release_idx + reaction_bars
        if release_idx <= warmup or reaction_idx >= n or entry_idx >= n:
            continue
        if pre_range_to_atr[release_idx] > pre_range_atr_mult_max:
            continue
        if volume_ratio[release_idx] > volume_ratio_max:
            continue
        if close[release_idx - 1] <= 0:
            continue
        reaction_return = (close[reaction_idx] / close[release_idx - 1]) - 1.0
        if abs(reaction_return) < min_reaction_return:
            continue

        if direction_mode == "fade":
            if reaction_return > 0:
                short_entries[entry_idx] = True
            else:
                long_entries[entry_idx] = True
        else:
            if reaction_return > 0:
                long_entries[entry_idx] = True
            else:
                short_entries[entry_idx] = True

    long_exits = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)
    for idx in np.where(long_entries)[0]:
        exit_idx = idx + max_hold_bars
        if exit_idx < n:
            long_exits[exit_idx] = True
    for idx in np.where(short_entries)[0]:
        exit_idx = idx + max_hold_bars
        if exit_idx < n:
            short_exits[exit_idx] = True

    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr / close) * sl_atr_mult
        tp_pct = (atr / close) * tp_atr_mult
    sl_pct = np.clip(np.nan_to_num(sl_pct, nan=0.004), 0.001, 0.03)
    tp_pct = np.clip(np.nan_to_num(tp_pct, nan=0.006), 0.0015, 0.06)

    long_entries[:warmup] = False
    short_entries[:warmup] = False
    long_exits[:warmup] = False
    short_exits[:warmup] = False

    logger.info(
        "NFP macro EURUSD: %s bars, %s long, %s short | mode=%s release_hour_mode=%s",
        n,
        int(np.sum(long_entries)),
        int(np.sum(short_entries)),
        direction_mode,
        release_hour_mode,
    )
    return {
        "long_entries": long_entries.astype(bool),
        "long_exits": long_exits.astype(bool),
        "short_entries": short_entries.astype(bool),
        "short_exits": short_exits.astype(bool),
        "sl_stop": sl_pct,
        "tp_stop": tp_pct,
    }


class LightweightNfpMacroEURUSD:
    def __init__(self, params: Optional[Dict[str, Any]] = None, logger: Optional[logging.Logger] = None):
        self.params = params or {}
        self.strategy_params = params or {}
        self.logger = logger or logging.getLogger(__name__)

    def _initialize_strategy_parameters(self) -> None:
        pass

    def generate_vectorized_signals(self, data: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if params is not None:
            effective_params = params
        elif hasattr(self, "params") and self.params:
            effective_params = self.params
        elif hasattr(self, "strategy_params") and self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {}
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)
        return generate_nfp_macro_eurusd_signals(data, effective_params, self.logger)


__all__ = ["generate_nfp_macro_eurusd_signals", "LightweightNfpMacroEURUSD"]

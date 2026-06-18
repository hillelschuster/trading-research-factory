"""
EURUSD M15 FX benchmark-fixing flow screen.

This Phase 8D candidate tests whether order concentration around the WMR
London 4pm FX benchmark leaves a short-horizon continuation or reversal
footprint in EURUSD bars. It uses only timestamp, OHLCV, ATR, and pre-fix
momentum/volume regime filters.
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


def generate_fx_fix_reversal_signals(
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
        logger.error("Missing required OHLCV columns for FX fix screen")
        return _empty_signals(n)

    pre_momentum_lookback = int(params.get("pre_momentum_lookback", 8))
    momentum_threshold = float(params.get("momentum_threshold", 0.0002))
    volume_lookback = int(params.get("volume_lookback", 96))
    volume_ratio_min = float(params.get("volume_ratio_min", 0.9))
    atr_period = int(params.get("atr_period", 14))
    vol_lookback = int(params.get("vol_lookback", 96))
    vol_ratio_min = float(params.get("vol_ratio_min", 0.6))
    fix_hour_utc = int(params.get("fix_hour_utc", 15))
    post_fix_window_bars = int(params.get("post_fix_window_bars", 2))
    max_hold_bars = int(params.get("max_hold_bars", 8))
    sl_atr_mult = float(params.get("sl_atr_mult", 1.4))
    tp_atr_mult = float(params.get("tp_atr_mult", 2.0))
    direction_mode = str(params.get("direction_mode", "fade"))
    min_abs_intraday_return = float(params.get("min_abs_intraday_return", 0.0))

    warmup = max(pre_momentum_lookback, volume_lookback, atr_period, vol_lookback) + 10
    if n < warmup + max_hold_bars + 20:
        logger.warning("Insufficient data: %s bars", n)
        return _empty_signals(n)

    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    close = df["close"].to_numpy(dtype=float)
    volume = df["volume"].to_numpy(dtype=float)

    with np.errstate(divide="ignore", invalid="ignore"):
        pre_momentum = (close / np.roll(close, pre_momentum_lookback)) - 1.0
    pre_momentum[:pre_momentum_lookback] = 0.0
    pre_momentum = np.nan_to_num(pre_momentum, nan=0.0)

    day_open = pd.Series(close, index=df.index).groupby(df.index.normalize()).transform("first").to_numpy(dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        intraday_return = (close / day_open) - 1.0
    intraday_return = np.nan_to_num(intraday_return, nan=0.0)

    volume_median = pd.Series(volume).rolling(window=volume_lookback, min_periods=volume_lookback).median().values
    with np.errstate(divide="ignore", invalid="ignore"):
        volume_ratio = volume / volume_median
    volume_ratio = np.nan_to_num(volume_ratio, nan=0.0, posinf=0.0, neginf=0.0)

    atr = _compute_atr(high, low, close, atr_period)
    with np.errstate(divide="ignore", invalid="ignore"):
        atr_pct = atr / close
    atr_pct = np.nan_to_num(atr_pct, nan=0.0)
    atr_median = pd.Series(atr_pct).rolling(window=vol_lookback, min_periods=vol_lookback).median().values
    with np.errstate(divide="ignore", invalid="ignore"):
        vol_ratio = atr_pct / atr_median
    vol_ratio = np.nan_to_num(vol_ratio, nan=0.0, posinf=0.0, neginf=0.0)

    hour = df.index.hour.to_numpy()
    minute = df.index.minute.to_numpy()
    bar_of_hour = np.maximum(0, minute // 15)
    fix_window = (hour == fix_hour_utc) & (bar_of_hour < post_fix_window_bars)
    regime_ok = (
        fix_window
        & (volume_ratio >= volume_ratio_min)
        & (vol_ratio >= vol_ratio_min)
        & (np.abs(intraday_return) >= min_abs_intraday_return)
    )

    raw_long = np.zeros(n, dtype=bool)
    raw_short = np.zeros(n, dtype=bool)
    if direction_mode == "continuation":
        raw_long = (pre_momentum >= momentum_threshold) & regime_ok
        raw_short = (pre_momentum <= -momentum_threshold) & regime_ok
    else:
        raw_long = (pre_momentum <= -momentum_threshold) & regime_ok
        raw_short = (pre_momentum >= momentum_threshold) & regime_ok

    long_entries = np.zeros(n, dtype=bool)
    short_entries = np.zeros(n, dtype=bool)
    used_dates = set()
    normalized_dates = df.index.normalize()
    for idx in np.where(raw_long | raw_short)[0]:
        day_key = normalized_dates[idx]
        if day_key in used_dates:
            continue
        used_dates.add(day_key)
        if raw_long[idx]:
            long_entries[idx] = True
        elif raw_short[idx]:
            short_entries[idx] = True

    long_exits = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)
    long_exits |= pre_momentum > 0
    short_exits |= pre_momentum < 0
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
        "FX fix reversal EURUSD: %s bars, %s long, %s short | mode=%s fix_hour_utc=%s",
        n,
        int(np.sum(long_entries)),
        int(np.sum(short_entries)),
        direction_mode,
        fix_hour_utc,
    )
    return {
        "long_entries": long_entries.astype(bool),
        "long_exits": long_exits.astype(bool),
        "short_entries": short_entries.astype(bool),
        "short_exits": short_exits.astype(bool),
        "sl_stop": sl_pct,
        "tp_stop": tp_pct,
    }


class LightweightFxFixReversalEURUSD:
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
        return generate_fx_fix_reversal_signals(data, effective_params, self.logger)


__all__ = ["generate_fx_fix_reversal_signals", "LightweightFxFixReversalEURUSD"]

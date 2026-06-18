"""
EURUSD M15 signed tick-volume imbalance continuation screen.

The signal is a practical MT5-bar proxy for the Stage-0 order-flow
imbalance amplification hypothesis. It uses only current and historical OHLCV
bars: signed tick volume, volatility regime, and a bounded time exit.
"""

import logging
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd


def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
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


def generate_order_flow_imbalance_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    logger = logger or logging.getLogger(__name__)

    imbalance_lookback = int(params.get("imbalance_lookback", 16))
    imbalance_threshold = float(params.get("imbalance_threshold", 0.25))
    volume_lookback = int(params.get("volume_lookback", 96))
    volume_ratio_min = float(params.get("volume_ratio_min", 1.0))
    atr_period = int(params.get("atr_period", 14))
    vol_lookback = int(params.get("vol_lookback", 96))
    vol_ratio_min = float(params.get("vol_ratio_min", 0.9))
    momentum_lookback = int(params.get("momentum_lookback", 4))
    max_hold_bars = int(params.get("max_hold_bars", 8))
    sl_atr_mult = float(params.get("sl_atr_mult", 1.5))
    tp_atr_mult = float(params.get("tp_atr_mult", 2.5))
    start_hour = int(params.get("start_hour", 6))
    end_hour = int(params.get("end_hour", 20))

    df = data.copy()
    df.columns = [str(c).lower() for c in df.columns]
    n = len(df)
    if n == 0:
        return _empty_signals(n)

    if not isinstance(df.index, pd.DatetimeIndex):
        if "timestamp" not in df.columns:
            logger.error("No DatetimeIndex or timestamp column found")
            return _empty_signals(n)
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df.set_index("timestamp", inplace=True, drop=False)

    required = {"open", "high", "low", "close", "volume"}
    if not required.issubset(set(df.columns)):
        logger.error("Missing required OHLCV columns for order-flow imbalance screen")
        return _empty_signals(n)

    warmup = max(imbalance_lookback, volume_lookback, atr_period, vol_lookback, momentum_lookback) + 10
    if n < warmup + max_hold_bars + 20:
        logger.warning("Insufficient data: %s bars (need ~%s)", n, warmup + max_hold_bars + 20)
        return _empty_signals(n)

    open_ = df["open"].to_numpy(dtype=float)
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    close = df["close"].to_numpy(dtype=float)
    volume = df["volume"].to_numpy(dtype=float)

    candle_direction = np.sign(close - open_)
    close_direction = np.sign(close - np.roll(close, 1))
    close_direction[0] = 0
    signed_direction = np.where(candle_direction != 0, candle_direction, close_direction)
    signed_volume = signed_direction * np.nan_to_num(volume, nan=0.0)

    signed_volume_sum = pd.Series(signed_volume).rolling(window=imbalance_lookback, min_periods=imbalance_lookback).sum().values
    abs_volume_sum = pd.Series(np.abs(volume)).rolling(window=imbalance_lookback, min_periods=imbalance_lookback).sum().values
    with np.errstate(divide="ignore", invalid="ignore"):
        imbalance = signed_volume_sum / abs_volume_sum
    imbalance = np.nan_to_num(imbalance, nan=0.0)

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

    with np.errstate(divide="ignore", invalid="ignore"):
        momentum = (close / np.roll(close, momentum_lookback)) - 1.0
    momentum[:momentum_lookback] = 0.0
    momentum = np.nan_to_num(momentum, nan=0.0)

    hours = df.index.hour.to_numpy()
    if start_hour <= end_hour:
        session_ok = (hours >= start_hour) & (hours <= end_hour)
    else:
        session_ok = (hours >= start_hour) | (hours <= end_hour)

    liquidity_ok = (volume_ratio >= volume_ratio_min) & (vol_ratio >= vol_ratio_min) & session_ok
    long_entries = (imbalance >= imbalance_threshold) & (momentum > 0) & liquidity_ok
    short_entries = (imbalance <= -imbalance_threshold) & (momentum < 0) & liquidity_ok

    long_exits = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)
    long_exits |= imbalance < 0
    short_exits |= imbalance > 0
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
        "Order-flow imbalance EURUSD: %s bars, %s long, %s short | lookback=%s threshold=%.3f vol_ratio=%.2f volume_ratio=%.2f",
        n,
        int(np.sum(long_entries)),
        int(np.sum(short_entries)),
        imbalance_lookback,
        imbalance_threshold,
        vol_ratio_min,
        volume_ratio_min,
    )

    return {
        "long_entries": long_entries.astype(bool),
        "long_exits": long_exits.astype(bool),
        "short_entries": short_entries.astype(bool),
        "short_exits": short_exits.astype(bool),
        "sl_stop": sl_pct,
        "tp_stop": tp_pct,
    }


class LightweightOrderFlowImbalanceEURUSD:
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
            effective_params = {
                "imbalance_lookback": 16,
                "imbalance_threshold": 0.25,
                "volume_lookback": 96,
                "volume_ratio_min": 1.0,
                "atr_period": 14,
                "vol_lookback": 96,
                "vol_ratio_min": 0.9,
                "momentum_lookback": 4,
                "max_hold_bars": 8,
                "sl_atr_mult": 1.5,
                "tp_atr_mult": 2.5,
                "start_hour": 6,
                "end_hour": 20,
            }

        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_order_flow_imbalance_signals(data, effective_params, self.logger)


__all__ = ["generate_order_flow_imbalance_signals", "LightweightOrderFlowImbalanceEURUSD"]

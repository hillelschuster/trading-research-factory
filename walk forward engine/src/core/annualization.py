from __future__ import annotations

from typing import Optional, Union

import numpy as np
import pandas as pd

from src.core.enums import Timeframe


def normalize_timeframe(value: Union[str, Timeframe]) -> Timeframe:
    if isinstance(value, Timeframe):
        return value
    key = str(value).upper()
    if key in Timeframe.__members__:
        return Timeframe[key]
    for timeframe in Timeframe:
        if timeframe.value == key:
            return timeframe
    raise ValueError(f"Unsupported timeframe: {value}")


def periods_per_year_for_timeframe(timeframe: Union[str, Timeframe]) -> int:
    tf = normalize_timeframe(timeframe)
    mapping = {
        Timeframe.M1: 252 * 24 * 60,
        Timeframe.M5: 252 * 24 * 12,
        Timeframe.M15: 252 * 24 * 4,
        Timeframe.M30: 252 * 24 * 2,
        Timeframe.H1: 252 * 24,
        Timeframe.H4: 252 * 6,
        Timeframe.D1: 252,
        Timeframe.W1: 52,
        Timeframe.MN1: 12,
    }
    if tf not in mapping:
        raise ValueError(f"No annualization mapping for timeframe: {tf}")
    return mapping[tf]


def infer_data_period_seconds(data: pd.DataFrame) -> Optional[int]:
    if 'timestamp' in data.columns:
        timestamps = pd.to_datetime(data['timestamp'])
    elif isinstance(data.index, pd.DatetimeIndex):
        timestamps = pd.Series(data.index)
    else:
        return None

    timestamps = timestamps.sort_values().drop_duplicates()
    if len(timestamps) < 2:
        return None

    deltas = timestamps.diff().dropna().dt.total_seconds()
    deltas = deltas[deltas > 0]
    if deltas.empty:
        return None
    return int(round(float(deltas.median())))


def is_timeframe_compatible_with_data(timeframe: Union[str, Timeframe], data: pd.DataFrame) -> Optional[bool]:
    expected_seconds = normalize_timeframe(timeframe).to_seconds()
    actual_seconds = infer_data_period_seconds(data)
    if actual_seconds is None or expected_seconds <= 0:
        return None
    if actual_seconds == expected_seconds:
        return True
    return actual_seconds < expected_seconds and expected_seconds % actual_seconds == 0


def calculate_annualized_sharpe_from_returns(returns, periods_per_year: int) -> float:
    values = np.asarray(returns, dtype=float)
    values = values[np.isfinite(values)]
    if len(values) < 2:
        return 0.0
    std = float(np.std(values, ddof=1))
    if not np.isfinite(std) or std <= 0:
        return 0.0
    sharpe = float(np.sqrt(periods_per_year) * np.mean(values) / std)
    return float(sharpe) if np.isfinite(sharpe) else 0.0


def calculate_annualized_sortino_from_returns(returns, periods_per_year: int) -> float:
    values = np.asarray(returns, dtype=float)
    values = values[np.isfinite(values)]
    if len(values) < 2:
        return 0.0
    downside = values[values < 0]
    if len(downside) < 2:
        return 0.0
    downside_std = float(np.std(downside, ddof=1))
    if not np.isfinite(downside_std) or downside_std <= 0:
        return 0.0
    sortino = float(np.sqrt(periods_per_year) * np.mean(values) / downside_std)
    return float(sortino) if np.isfinite(sortino) else 0.0


def calculate_calmar_ratio_from_equity(equity_curve, periods_per_year: int) -> float:
    equity = np.asarray(equity_curve, dtype=float)
    equity = equity[np.isfinite(equity)]
    if len(equity) < 2 or equity[0] <= 0 or equity[-1] <= 0:
        return 0.0

    total_periods = len(equity) - 1
    annual_return = float((equity[-1] / equity[0]) ** (periods_per_year / total_periods) - 1)
    if not np.isfinite(annual_return):
        return 0.0
    running_max = np.maximum.accumulate(equity)
    drawdowns = (equity - running_max) / running_max
    max_drawdown = abs(float(np.min(drawdowns)))
    if not np.isfinite(max_drawdown) or max_drawdown <= 0:
        return 0.0
    calmar = annual_return / max_drawdown
    return float(calmar) if np.isfinite(calmar) else 0.0
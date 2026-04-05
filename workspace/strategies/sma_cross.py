"""Baseline SMA crossover strategy for the WFA harness."""
from __future__ import annotations

from dataclasses import dataclass
import pandas as pd

DEFAULT_PARAM_GRID = {
    "fast": [5, 8, 10],
    "slow": [20, 30, 40]
}


@dataclass
class StrategyResult:
    signal: pd.Series


def generate_signal(df: pd.DataFrame, fast: int = 10, slow: int = 30) -> pd.Series:
    if fast >= slow:
        raise ValueError("fast must be smaller than slow")
    fast_ma = df["close"].rolling(fast).mean()
    slow_ma = df["close"].rolling(slow).mean()
    signal = (fast_ma > slow_ma).astype(int)
    return signal.fillna(0)

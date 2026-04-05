#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import importlib
import sys
import itertools
import json
import math
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, pstdev
from typing import Dict, Iterable, List, Tuple

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@dataclass
class Metrics:
    total_return: float
    sharpe: float
    max_drawdown: float
    win_rate: float
    trades: int


def load_csv(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    required = {"timestamp", "open", "high", "low", "close", "volume"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    df = df.sort_values("timestamp").reset_index(drop=True)
    return df


def iter_param_grid(grid: Dict[str, List[int]]) -> Iterable[Dict[str, int]]:
    keys = list(grid.keys())
    values = [grid[k] for k in keys]
    for combo in itertools.product(*values):
        yield dict(zip(keys, combo))


def compute_metrics(df: pd.DataFrame, signal: pd.Series) -> Tuple[Metrics, pd.DataFrame]:
    work = df.copy()
    work["signal"] = signal.astype(float).shift(1).fillna(0.0)
    work["return"] = work["close"].pct_change().fillna(0.0)
    work["strategy_return"] = work["signal"] * work["return"]
    work["equity"] = (1.0 + work["strategy_return"]).cumprod()
    running_max = work["equity"].cummax()
    drawdown = work["equity"] / running_max - 1.0

    returns = work["strategy_return"].tolist()
    avg = mean(returns) if returns else 0.0
    std = pstdev(returns) if len(returns) > 1 else 0.0
    sharpe = (avg / std * math.sqrt(252)) if std > 0 else 0.0

    trade_entries = ((work["signal"] == 1.0) & (work["signal"].shift(1).fillna(0.0) == 0.0)).sum()
    realized = work.loc[work["strategy_return"] != 0.0, "strategy_return"]
    win_rate = float((realized > 0).mean()) if len(realized) else 0.0

    metrics = Metrics(
        total_return=float(work["equity"].iloc[-1] - 1.0),
        sharpe=float(sharpe),
        max_drawdown=float(drawdown.min()),
        win_rate=float(win_rate),
        trades=int(trade_entries),
    )
    return metrics, work


def choose_best_params(train_df: pd.DataFrame, strategy_module) -> Dict[str, int]:
    grid = getattr(strategy_module, "DEFAULT_PARAM_GRID", {})
    if not grid:
        return {}
    best = None
    best_score = float("-inf")
    for params in iter_param_grid(grid):
        signal = strategy_module.generate_signal(train_df, **params)
        metrics, _ = compute_metrics(train_df, signal)
        score = metrics.sharpe - abs(metrics.max_drawdown)
        if score > best_score:
            best_score = score
            best = params
    return best or {}


def walk_forward(df: pd.DataFrame, strategy_module, train_size: int, test_size: int) -> Dict[str, object]:
    windows = []
    cursor = 0
    while cursor + train_size + test_size <= len(df):
        train_df = df.iloc[cursor: cursor + train_size].reset_index(drop=True)
        test_df = df.iloc[cursor + train_size: cursor + train_size + test_size].reset_index(drop=True)
        params = choose_best_params(train_df, strategy_module)
        train_signal = strategy_module.generate_signal(train_df, **params)
        test_signal = strategy_module.generate_signal(test_df, **params)
        train_metrics, _ = compute_metrics(train_df, train_signal)
        test_metrics, test_work = compute_metrics(test_df, test_signal)
        windows.append({
            "train_start": str(train_df.iloc[0]["timestamp"]),
            "train_end": str(train_df.iloc[-1]["timestamp"]),
            "test_start": str(test_df.iloc[0]["timestamp"]),
            "test_end": str(test_df.iloc[-1]["timestamp"]),
            "params": params,
            "train": train_metrics.__dict__,
            "test": test_metrics.__dict__,
            "trades": test_work[["timestamp", "close", "signal", "strategy_return", "equity"]].to_dict(orient="records"),
        })
        cursor += test_size
    if not windows:
        raise ValueError("Dataset too small for the selected train/test sizes")

    out_metrics = {
        "total_return": float(mean(window["test"]["total_return"] for window in windows)),
        "sharpe": float(mean(window["test"]["sharpe"] for window in windows)),
        "max_drawdown": float(mean(window["test"]["max_drawdown"] for window in windows)),
        "win_rate": float(mean(window["test"]["win_rate"] for window in windows)),
        "trades": int(sum(window["test"]["trades"] for window in windows)),
        "windows": len(windows),
    }
    return {"windows": windows, "out_of_sample": out_metrics}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a baseline walk-forward analysis")
    parser.add_argument("--csv", required=True)
    parser.add_argument("--strategy", required=True, help="Python import path, e.g. workspace.strategies.sma_cross")
    parser.add_argument("--output", required=True)
    parser.add_argument("--train-size", type=int, default=120)
    parser.add_argument("--test-size", type=int, default=60)
    args = parser.parse_args()

    csv_path = Path(args.csv)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    df = load_csv(csv_path)
    strategy_module = importlib.import_module(args.strategy)
    result = walk_forward(df, strategy_module, train_size=args.train_size, test_size=args.test_size)

    report_path = output_dir / "report.json"
    trades_path = output_dir / "trades.csv"
    with report_path.open("w", encoding="utf8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    with trades_path.open("w", newline="", encoding="utf8") as f:
        writer = csv.DictWriter(f, fieldnames=["window_index", "timestamp", "close", "signal", "strategy_return", "equity"])
        writer.writeheader()
        for idx, window in enumerate(result["windows"]):
            for row in window["trades"]:
                writer.writerow({"window_index": idx, **row})

    print(json.dumps({"ok": True, "report": str(report_path), "trades": str(trades_path), "out_of_sample": result["out_of_sample"]}, indent=2))


if __name__ == "__main__":
    main()

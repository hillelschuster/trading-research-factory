#!/usr/bin/env python3
"""Standalone WFA runner without pandas - for live BTCUSDT data."""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path
from statistics import mean, pstdev
from typing import Dict, List


def load_csv(csv_path: Path) -> List[Dict]:
    """Load CSV into list of dicts."""
    rows = []
    with open(csv_path, "r", encoding="utf8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "timestamp": row["timestamp"],
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"])
            })
    return rows


def compute_rsi(closes: List[float], period: int = 14) -> List[float]:
    """Compute RSI values."""
    if len(closes) < period + 1:
        return [50.0] * len(closes)
    
    rsi = [50.0] * period  # Neutral for warmup
    gains = []
    losses = []
    
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i-1]
        if delta > 0:
            gains.append(delta)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(delta))
        
        if i >= period:
            avg_gain = sum(gains[i-period:i]) / period
            avg_loss = sum(losses[i-period:i]) / period
            if avg_loss == 0:
                rsi.append(100)
            else:
                rs = avg_gain / avg_loss
                rsi.append(100 - (100 / (1 + rs)))
    
    return rsi


def generate_rsi_signal(closes: List[float], rsi_period: int = 14, 
                        oversold: int = 30, overbought: int = 70) -> List[int]:
    """Generate RSI-based signals (1=long, 0=flat)."""
    rsi = compute_rsi(closes, rsi_period)
    signal = [0] * len(closes)
    in_position = False
    
    for i in range(1, len(rsi)):
        # Buy when RSI crosses above oversold
        if rsi[i-1] < oversold and rsi[i] >= oversold:
            in_position = True
        # Sell when RSI crosses below overbought
        elif rsi[i-1] > overbought and rsi[i] <= overbought:
            in_position = False
        
        signal[i] = 1 if in_position else 0
    
    return signal


def compute_metrics(closes: List[float], signal: List[int]) -> Dict:
    """Compute performance metrics."""
    if len(closes) < 2:
        return {"total_return": 0.0, "sharpe": 0.0, "max_drawdown": 0.0, "win_rate": 0.0, "trades": 0}
    
    # Calculate strategy returns
    returns = []
    equity = [1.0]
    running_max = 1.0
    max_dd = 0.0
    
    for i in range(1, len(closes)):
        price_ret = (closes[i] - closes[i-1]) / closes[i-1]
        strat_ret = signal[i-1] * price_ret  # Signal is lagged by 1
        returns.append(strat_ret)
        
        new_equity = equity[-1] * (1 + strat_ret)
        equity.append(new_equity)
        running_max = max(running_max, new_equity)
        dd = (new_equity / running_max) - 1.0
        max_dd = min(max_dd, dd)
    
    # Total return
    total_ret = equity[-1] - 1.0
    
    # Sharpe ratio
    avg_ret = mean(returns) if returns else 0.0
    std_ret = pstdev(returns) if len(returns) > 1 else 0.0
    sharpe = (avg_ret / std_ret * math.sqrt(252 * 24)) if std_ret > 0 else 0.0  # 1h bars
    
    # Count trades
    trades = sum(1 for i in range(1, len(signal)) if signal[i-1] == 0 and signal[i] == 1)
    
    # Win rate
    trade_returns = [returns[i] for i in range(len(returns)) if signal[i] == 1]
    win_rate = (sum(1 for r in trade_returns if r > 0) / len(trade_returns)) if trade_returns else 0.0
    
    return {
        "total_return": total_ret,
        "sharpe": sharpe,
        "max_drawdown": max_dd,
        "win_rate": win_rate,
        "trades": trades
    }


def walk_forward(data: List[Dict], train_size: int, test_size: int) -> Dict:
    """Run walk-forward analysis."""
    closes = [d["close"] for d in data]
    timestamps = [d["timestamp"] for d in data]
    
    windows = []
    cursor = 0
    param_grid = [
        {"rsi_period": 7, "oversold": 25, "overbought": 75},
        {"rsi_period": 7, "oversold": 30, "overbought": 70},
        {"rsi_period": 14, "oversold": 25, "overbought": 75},
        {"rsi_period": 14, "oversold": 30, "overbought": 70},
        {"rsi_period": 14, "oversold": 35, "overbought": 65},
        {"rsi_period": 21, "oversold": 30, "overbought": 70},
    ]
    
    while cursor + train_size + test_size <= len(data):
        train_closes = closes[cursor:cursor + train_size]
        test_closes = closes[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on training data
        best_params = None
        best_score = float("-inf")
        
        for params in param_grid:
            signal = generate_rsi_signal(train_closes, **params)
            metrics = compute_metrics(train_closes, signal)
            score = metrics["sharpe"] - abs(metrics["max_drawdown"])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signal = generate_rsi_signal(test_closes, **best_params)
        test_metrics = compute_metrics(test_closes, test_signal)
        train_metrics = compute_metrics(train_closes, generate_rsi_signal(train_closes, **best_params))
        
        windows.append({
            "train_start": timestamps[cursor],
            "train_end": timestamps[cursor + train_size - 1],
            "test_start": timestamps[cursor + train_size],
            "test_end": timestamps[cursor + train_size + test_size - 1],
            "params": best_params,
            "train": train_metrics,
            "test": test_metrics,
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample metrics
    out_metrics = {
        "total_return": mean(w["test"]["total_return"] for w in windows),
        "sharpe": mean(w["test"]["sharpe"] for w in windows),
        "max_drawdown": mean(w["test"]["max_drawdown"] for w in windows),
        "win_rate": mean(w["test"]["win_rate"] for w in windows),
        "trades": sum(w["test"]["trades"] for w in windows),
        "windows": len(windows),
    }
    
    return {"windows": windows, "out_of_sample": out_metrics}


def main():
    csv_path = Path("workspace/data/binance_btcusdt_1h_live.csv")
    output_dir = Path("workspace/results/wfa_live_btc_rsi")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Loading data from {csv_path}...")
    data = load_csv(csv_path)
    print(f"Loaded {len(data)} rows")
    
    print("Running walk-forward analysis...")
    result = walk_forward(data, train_size=200, test_size=50)
    
    # Save report
    report_path = output_dir / "report.json"
    with report_path.open("w", encoding="utf8") as f:
        json.dump(result, f, indent=2)
    
    # Save simplified results
    results_path = output_dir / "results.json"
    with results_path.open("w", encoding="utf8") as f:
        json.dump(result["out_of_sample"], f, indent=2)
    
    print(json.dumps({"ok": True, "report": str(report_path), "results": str(results_path), "out_of_sample": result["out_of_sample"]}, indent=2))


if __name__ == "__main__":
    main()

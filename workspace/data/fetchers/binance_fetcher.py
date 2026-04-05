"""Fetch OHLCV data from Binance public API.

Usage:
    python3 workspace/data/fetchers/binance_fetcher.py --symbol BTCUSDT --interval 1h --limit 1000 --output workspace/data/binance_btcusdt_1h.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"

INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]


def fetch_klines(symbol: str, interval: str, limit: int = 1000, start_time: int | None = None) -> list[list]:
    """Fetch kline/candlestick data from Binance."""
    params = f"symbol={symbol}&interval={interval}&limit={limit}"
    if start_time:
        params += f"&startTime={start_time}"
    url = f"{BINANCE_KLINES_URL}?{params}"

    req = urllib.request.Request(url, headers={"User-Agent": "trading-research-factory/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP error {e.code}: {e.reason}", file=sys.stderr)
        raise
    return data


def klines_to_rows(klines: list[list]) -> list[dict]:
    """Convert Binance kline arrays to OHLCV dicts."""
    rows = []
    for k in klines:
        rows.append({
            "timestamp": datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5])
        })
    return rows


def fetch_and_save(symbol: str, interval: str, limit: int, output: Path) -> dict:
    """Fetch data and save to CSV. Returns summary dict."""
    if interval not in INTERVALS:
        raise ValueError(f"Invalid interval '{interval}'. Must be one of: {INTERVALS}")

    klines = fetch_klines(symbol, interval, limit)
    if not klines:
        raise ValueError(f"No data returned for {symbol} {interval}")

    rows = klines_to_rows(klines)
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("w", newline="", encoding="utf8") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(rows)

    return {
        "symbol": symbol,
        "interval": interval,
        "rows": len(rows),
        "first_timestamp": rows[0]["timestamp"],
        "last_timestamp": rows[-1]["timestamp"],
        "output": str(output)
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch OHLCV data from Binance")
    parser.add_argument("--symbol", default="BTCUSDT", help="Trading pair (e.g., BTCUSDT, ETHUSDT)")
    parser.add_argument("--interval", default="1h", help=f"Candle interval (default: 1h)")
    parser.add_argument("--limit", type=int, default=1000, help="Number of candles (max 1000)")
    parser.add_argument("--output", required=True, help="Output CSV path")
    args = parser.parse_args()

    output_path = Path(args.output)
    result = fetch_and_save(args.symbol, args.interval, args.limit, output_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

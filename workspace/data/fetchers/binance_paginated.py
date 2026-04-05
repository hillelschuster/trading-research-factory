#!/usr/bin/env python3
"""Paginated Binance OHLCV fetcher.

Fetches historical klines in batches of 1000 (Binance API limit) using
start_time pagination, then concatenates and deduplicates.

Usage:
    python3 binance_paginated.py --symbol BTCUSDT --interval 1h --months 9 \
        --output workspace/data/binance_btcusdt_1h_full.csv

    python3 binance_paginated.py --symbol ETHUSDT --interval 1h --months 6 \
        --output workspace/data/binance_ethusdt_1h_full.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
BATCH_SIZE = 1000
REQUEST_DELAY = 0.25  # seconds between requests to avoid rate limits


def fetch_klines(symbol: str, interval: str, limit: int = 1000,
                 start_time: int | None = None, end_time: int | None = None) -> list[list]:
    """Fetch a single batch of klines from Binance."""
    params = f"symbol={symbol}&interval={interval}&limit={limit}"
    if start_time:
        params += f"&startTime={start_time}"
    if end_time:
        params += f"&endTime={end_time}"
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


def fetch_paginated(symbol: str, interval: str, months: int, output: Path) -> dict:
    """Fetch up to `months` months of klines using pagination."""
    if interval not in INTERVALS:
        raise ValueError(f"Invalid interval '{interval}'. Must be one of: {INTERVALS}")

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=int(months * 30))
    start_ts = int(start_dt.timestamp() * 1000)
    end_ts = int(end_dt.timestamp() * 1000)

    print(f"Fetching {symbol} {interval} from {start_dt.date()} to {end_dt.date()}", file=sys.stderr)
    print(f"Expected ~{int(months * 30 * 24)} candles (at 1h)", file=sys.stderr)

    all_rows = []
    current_ts = start_ts
    batch_num = 0

    while current_ts < end_ts:
        batch_num += 1
        print(f"  Batch {batch_num}: fetching from ts={current_ts} ...", end="", file=sys.stderr, flush=True)

        try:
            klines = fetch_klines(symbol, interval, BATCH_SIZE,
                                  start_time=current_ts, end_time=end_ts)
        except Exception as e:
            print(f"\nError fetching batch {batch_num}: {e}", file=sys.stderr)
            break

        if not klines:
            print(" no data returned, stopping.", file=sys.stderr)
            break

        rows = klines_to_rows(klines)
        all_rows.extend(rows)
        print(f" got {len(rows)} rows (total: {len(all_rows)})", file=sys.stderr)

        # Use last kline's open time as next start_time (exclusive)
        last_open_ts = klines[-1][0]
        if last_open_ts <= current_ts:
            print("Stuck at same timestamp, stopping to avoid infinite loop.", file=sys.stderr)
            break
        current_ts = last_open_ts + 1  # +1ms to avoid re-fetching last candle

        time.sleep(REQUEST_DELAY)

    if not all_rows:
        raise ValueError(f"No data fetched for {symbol} {interval}")

    # Sort by timestamp and remove exact duplicates
    all_rows.sort(key=lambda r: r["timestamp"])
    seen = set()
    unique_rows = []
    for row in all_rows:
        if row["timestamp"] not in seen:
            seen.add(row["timestamp"])
            unique_rows.append(row)

    output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["timestamp", "open", "high", "low", "close", "volume"]
    with output.open("w", newline="", encoding="utf8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(unique_rows)

    result = {
        "symbol": symbol,
        "interval": interval,
        "rows": len(unique_rows),
        "batches": batch_num,
        "first_timestamp": unique_rows[0]["timestamp"],
        "last_timestamp": unique_rows[-1]["timestamp"],
        "start_date": start_dt.date().isoformat(),
        "end_date": end_dt.date().isoformat(),
        "months_fetched": months,
        "output": str(output)
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Paginated Binance OHLCV fetcher")
    parser.add_argument("--symbol", default="BTCUSDT", help="Trading pair (e.g., BTCUSDT, ETHUSDT)")
    parser.add_argument("--interval", default="1h", help="Candle interval (default: 1h)")
    parser.add_argument("--months", type=int, default=9, help="Number of months to fetch (default: 9)")
    parser.add_argument("--output", required=True, help="Output CSV path")
    args = parser.parse_args()

    output_path = Path(args.output)
    result = fetch_paginated(args.symbol, args.interval, args.months, output_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

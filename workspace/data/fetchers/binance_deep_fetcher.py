"""Batched deep-history fetcher for BTCUSDT 1h candles from Binance.

Usage:
    python3 binance_deep_fetcher.py --output workspace/data/binance_btcusdt_1h_deep.csv

This script fetches the maximum available history from Binance (up to ~5 years)
by paginating through 1000-candle batches. Binance klines are returned oldest-first,
so we start from a timestamp far in the past and work forward.
"""
import csv
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path


BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
INTERVAL = "1h"
SYMBOL = "BTCUSDT"
LIMIT = 1000  # Binance max per request


def fetch_klines(symbol: str, interval: str, limit: int, start_time: int | None = None, end_time: int | None = None) -> list:
    """Fetch klines from Binance with optional time range."""
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


def klines_to_rows(klines: list) -> list:
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


def fetch_deep_history(symbol: str, interval: str, output_path: Path, max_batches: int = 500) -> dict:
    """
    Fetch maximum available history by paginating backward from the present.
    Binance returns klines oldest-first, so we use startTime to paginate forward.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    all_rows = []
    start_time = None
    batch_num = 0
    total_rows = 0
    
    # Calculate approximate start time (5 years ago)
    five_years_ago = int((datetime.now(timezone.utc) - timedelta(days=365*5)).timestamp() * 1000)
    start_time = five_years_ago
    
    print(f"Starting deep fetch for {symbol} {interval} from {datetime.fromtimestamp(start_time/1000, tz=timezone.utc)}")
    
    while batch_num < max_batches:
        try:
            klines = fetch_klines(symbol, interval, LIMIT, start_time=start_time)
        except Exception as e:
            print(f"Error fetching batch {batch_num}: {e}", file=sys.stderr)
            break
        
        if not klines:
            print(f"No more data at batch {batch_num}")
            break
        
        rows = klines_to_rows(klines)
        all_rows.extend(rows)
        total_rows += len(rows)
        
        # Update start_time to last kline's open time + 1ms
        last_open_time = klines[-1][0]
        start_time = last_open_time + 1
        
        first_ts = rows[0]['timestamp']
        last_ts = rows[-1]['timestamp']
        print(f"Batch {batch_num}: {len(rows)} rows | {first_ts} → {last_ts} | Total: {total_rows}")
        
        batch_num += 1
        
        # Binance rate limit: 1200 requests/minute, be safe with 1 req/second
        time.sleep(0.1)
        
        # Stop if we've reached current time
        last_ts_ms = klines[-1][0]
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        if last_ts_ms >= now_ms - 3600_000:
            print(f"Reached current time at batch {batch_num}")
            break
    
    if not all_rows:
        print("No data fetched!", file=sys.stderr)
        return {"status": "error", "rows": 0}
    
    # Remove duplicates (in case of overlapping windows) based on timestamp
    seen = set()
    unique_rows = []
    for row in all_rows:
        if row["timestamp"] not in seen:
            seen.add(row["timestamp"])
            unique_rows.append(row)
    
    # Sort by timestamp ascending
    unique_rows.sort(key=lambda r: r["timestamp"])
    
    # Write output
    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(unique_rows)
    
    first_ts = unique_rows[0]["timestamp"]
    last_ts = unique_rows[-1]["timestamp"]
    
    print(f"\n✅ Deep fetch complete: {len(unique_rows)} candles")
    print(f"   Date range: {first_ts} → {last_ts}")
    print(f"   Output: {output_path}")
    
    return {
        "status": "success",
        "rows": len(unique_rows),
        "first_timestamp": first_ts,
        "last_timestamp": last_ts,
        "output": str(output_path),
        "batches": batch_num
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Batched deep-history BTCUSDT fetcher")
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--output", default="workspace/data/binance_btcusdt_1h_deep.csv")
    parser.add_argument("--max-batches", type=int, default=500)
    args = parser.parse_args()
    
    result = fetch_deep_history(
        args.symbol, args.interval,
        Path(args.output), max_batches=args.max_batches
    )
    print(json.dumps(result, indent=2))

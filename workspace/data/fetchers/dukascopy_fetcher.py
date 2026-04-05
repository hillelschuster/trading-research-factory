"""Fetch OHLCV data from Dukascopy for FX and commodities.

Uses Dukascopy's public data endpoint. Requires no authentication for historical data.

Usage:
    python3 workspace/data/fetchers/dukascopy_fetcher.py --symbol EURUSD --timeframe h1 --start 2024-01-01 --end 2024-06-01 --output workspace/data/dukascopy_eurusd_h1.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import struct
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Dukascopy instrument IDs (common ones)
INSTRUMENTS = {
    "EURUSD": "EURUSD",
    "GBPUSD": "GBPUSD",
    "USDJPY": "USDJPY",
    "XAUUSD": "XAUUSD",
    "AUDUSD": "AUDUSD",
    "USDCAD": "USDCAD",
    "USDCHF": "USDCHF",
    "BTCUSD": "BTCUSD",
}

TIMEFRAME_SECONDS = {
    "tick": 0,
    "s1": 1,
    "m1": 60,
    "m5": 300,
    "m15": 900,
    "m30": 1800,
    "h1": 3600,
    "h4": 14400,
    "d1": 86400,
}

DUKASCOPY_URL = "https://datafeed.dukascopy.com/datafeed/{instrument}/{year}/{month:02d}/{day:02d}/{hour:02d}h_ticks.bi5"


def fetch_hour_ticks(instrument: str, dt: datetime) -> bytes:
    """Fetch raw tick data for one hour from Dukascopy."""
    url = DUKASCOPY_URL.format(
        instrument=instrument,
        year=dt.year,
        month=dt.month - 1,  # Dukascopy uses 0-indexed months
        day=dt.day,
        hour=dt.hour
    )
    req = urllib.request.Request(url, headers={"User-Agent": "trading-research-factory/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except urllib.error.HTTPError:
        return b""


def parse_ticks(data: bytes) -> list[dict]:
    """Parse Dukascopy binary tick format."""
    if len(data) < 20:
        return []
    # Decompress LZMA if needed
    import lzma
    try:
        data = lzma.decompress(data)
    except Exception:
        pass

    ticks = []
    for i in range(0, len(data) - 19, 20):
        try:
            timestamp_delta, ask, bid, ask_vol, bid_vol = struct.unpack(">IIfff", data[i:i+20])
            ticks.append({
                "timestamp_delta_ms": timestamp_delta,
                "ask": ask,
                "bid": bid,
                "ask_volume": ask_vol,
                "bid_volume": bid_vol
            })
        except struct.error:
            break
    return ticks


def aggregate_ticks_to_ohlcv(ticks: list[dict], base_dt: datetime, timeframe_seconds: int) -> list[dict]:
    """Aggregate ticks into OHLCV candles."""
    if not ticks or timeframe_seconds == 0:
        return []

    candles = {}
    for tick in ticks:
        ts = base_dt + timedelta(milliseconds=tick["timestamp_delta_ms"])
        candle_start = ts.replace(second=0, microsecond=0)
        if timeframe_seconds > 60:
            minute_bucket = (candle_start.minute // (timeframe_seconds // 60)) * (timeframe_seconds // 60)
            candle_start = candle_start.replace(minute=minute_bucket)

        key = candle_start
        mid = (tick["ask"] + tick["bid"]) / 2
        vol = tick["ask_volume"] + tick["bid_volume"]

        if key not in candles:
            candles[key] = {"open": mid, "high": mid, "low": mid, "close": mid, "volume": vol}
        else:
            candles[key]["high"] = max(candles[key]["high"], mid)
            candles[key]["low"] = min(candles[key]["low"], mid)
            candles[key]["close"] = mid
            candles[key]["volume"] += vol

    rows = []
    for ts in sorted(candles.keys()):
        c = candles[ts]
        rows.append({
            "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
            "open": c["open"],
            "high": c["high"],
            "low": c["low"],
            "close": c["close"],
            "volume": c["volume"]
        })
    return rows


def fetch_ohlcv(symbol: str, timeframe: str, start: datetime, end: datetime) -> list[dict]:
    """Fetch OHLCV data for a date range."""
    instrument = INSTRUMENTS.get(symbol, symbol)
    tf_seconds = TIMEFRAME_SECONDS.get(timeframe, 3600)

    all_rows = []
    current = start.replace(minute=0, second=0, microsecond=0)
    while current <= end:
        raw = fetch_hour_ticks(instrument, current)
        if raw:
            ticks = parse_ticks(raw)
            if ticks:
                base = current.replace(tzinfo=timezone.utc)
                rows = aggregate_ticks_to_ohlcv(ticks, base, tf_seconds)
                all_rows.extend(rows)
        current += timedelta(hours=1)

    return all_rows


def fetch_and_save(symbol: str, timeframe: str, start: datetime, end: datetime, output: Path) -> dict:
    """Fetch Dukascopy data and save to CSV."""
    rows = fetch_ohlcv(symbol, timeframe, start, end)

    if not rows:
        return {"error": "No data fetched", "symbol": symbol, "timeframe": timeframe, "rows": 0}

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf8") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(rows)

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "rows": len(rows),
        "first_timestamp": rows[0]["timestamp"],
        "last_timestamp": rows[-1]["timestamp"],
        "output": str(output)
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch OHLCV data from Dukascopy")
    parser.add_argument("--symbol", default="EURUSD", help=f"Symbol (e.g., {', '.join(INSTRUMENTS.keys())})")
    parser.add_argument("--timeframe", default="h1", help="Timeframe (m1, m5, m15, m30, h1, h4, d1)")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", required=True, help="Output CSV path")
    args = parser.parse_args()

    start = datetime.strptime(args.start, "%Y-%m-%d")
    end = datetime.strptime(args.end, "%Y-%m-%d")
    output_path = Path(args.output)

    result = fetch_and_save(args.symbol, args.timeframe, start, end, output_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

"""Fetch market data from Polymarket public API.

Usage:
    python3 workspace/data/fetchers/polymarket_fetcher.py --output workspace/data/polymarket_markets.json --limit 50
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

GAMMA_API_URL = "https://gamma-api.polymarket.com"


def fetch_markets(limit: int = 50, active: bool = True) -> list[dict]:
    """Fetch markets from Polymarket Gamma API."""
    params = f"limit={limit}&active={str(active).lower()}"
    url = f"{GAMMA_API_URL}/markets?{params}"

    req = urllib.request.Request(url, headers={
        "User-Agent": "trading-research-factory/1.0",
        "Accept": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP error {e.code}: {e.reason}", file=sys.stderr)
        raise
    return data


def extract_signals(markets: list[dict]) -> list[dict]:
    """Extract useful signal data from markets for research."""
    signals = []
    for m in markets:
        outcomes = m.get("outcomes", "[]")
        try:
            parsed = json.loads(outcomes) if isinstance(outcomes, str) else outcomes
        except (json.JSONDecodeError, TypeError):
            parsed = []

        outcome_prices = m.get("outcomePrices", "[]")
        try:
            prices = json.loads(outcome_prices) if isinstance(outcome_prices, str) else outcome_prices
        except (json.JSONDecodeError, TypeError):
            prices = []

        signals.append({
            "id": m.get("id", ""),
            "slug": m.get("slug", ""),
            "title": m.get("question", ""),
            "description": m.get("description", "")[:200],
            "outcomes": parsed,
            "prices": [float(p) if p else 0.0 for p in prices],
            "volume": float(m.get("volume", 0)),
            "liquidity": float(m.get("liquidity", 0)),
            "end_date": m.get("endDate", ""),
            "created_at": m.get("createdAt", ""),
        })
    return signals


def fetch_and_save(output: Path, limit: int = 50) -> dict:
    """Fetch markets and save to JSON. Returns summary."""
    markets = fetch_markets(limit=limit)
    signals = extract_signals(markets)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf8") as f:
        json.dump(signals, f, indent=2)
        f.write("\n")

    total_volume = sum(s["volume"] for s in signals)
    return {
        "markets_fetched": len(signals),
        "total_volume": total_volume,
        "output": str(output),
        "sample_titles": [s["title"] for s in signals[:3]]
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Polymarket data for research")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--limit", type=int, default=50, help="Number of markets to fetch")
    args = parser.parse_args()

    output_path = Path(args.output)
    result = fetch_and_save(output_path, args.limit)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

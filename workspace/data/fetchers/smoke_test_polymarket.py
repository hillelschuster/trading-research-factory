#!/usr/bin/env python3
"""Smoke test for Polymarket data fetcher - validates connection and output format."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from workspace.data.fetchers.polymarket_fetcher import fetch_markets, extract_signals


def test_polymarket_connection():
    """Test that Polymarket API is reachable and returns valid data."""
    try:
        markets = fetch_markets(limit=5)
        assert len(markets) > 0, "No markets returned"
        signals = extract_signals(markets)
        assert len(signals) > 0, "No signals extracted"
        assert "title" in signals[0], "Missing title field"
        assert "prices" in signals[0], "Missing prices field"
        print(json.dumps({"ok": True, "markets": len(signals), "sample_title": signals[0]["title"][:80]}, indent=2))
        return True
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        return False


if __name__ == "__main__":
    success = test_polymarket_connection()
    sys.exit(0 if success else 1)

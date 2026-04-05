#!/usr/bin/env python3
"""Smoke test for Binance data fetcher - validates connection and output format."""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from workspace.data.fetchers.binance_fetcher import fetch_klines, klines_to_rows


def test_binance_connection():
    """Test that Binance API is reachable and returns valid data."""
    try:
        klines = fetch_klines("BTCUSDT", "1h", limit=5)
        assert len(klines) > 0, "No data returned"
        rows = klines_to_rows(klines)
        assert len(rows) > 0, "No rows parsed"
        assert "timestamp" in rows[0], "Missing timestamp column"
        assert "open" in rows[0], "Missing open column"
        assert "close" in rows[0], "Missing close column"
        print(json.dumps({"ok": True, "rows": len(rows), "sample": rows[0]}, indent=2))
        return True
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        return False


if __name__ == "__main__":
    success = test_binance_connection()
    sys.exit(0 if success else 1)

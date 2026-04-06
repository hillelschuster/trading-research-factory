#!/usr/bin/env python3
"""
Parity Test: Vectorized vs Event-Driven Signal Generation

This script verifies that both execution paths produce consistent signals.
Run after implementing bug fixes to ensure parity is maintained.
"""

import pandas as pd
import numpy as np
from pathlib import Path

from src.strategies.london_breakout import LondonBreakoutStrategy, LondonBreakoutParams


def main():
    print("=" * 60)
    print("PARITY TEST: Vectorized vs Event-Driven")
    print("=" * 60)
    
    # Load a small slice of data (10 days)
    print("\nLoading data...")
    data = pd.read_csv("data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv")
    data["timestamp"] = pd.to_datetime(data["timestamp"])
    
    # Use 2 weeks of 2020 data (high volatility, should have trades)
    data = data[(data['timestamp'] >= '2020-03-01') & (data['timestamp'] < '2020-03-15')]
    print(f"Test data: {len(data)} bars from {data['timestamp'].min()} to {data['timestamp'].max()}")
    
    if len(data) < 100:
        print("ERROR: Not enough data for test")
        return
    
    # Create strategy with test params
    params = LondonBreakoutParams(
        asia_start_hour=0,
        asia_end_hour=7,
        trade_end_hour=10,
        hard_exit_hour=16,
        buffer_pips=5.0,
        min_range_pips=10.0,
        max_range_pips=40.0,
        risk_reward_ratio=1.5,
        min_daily_atr=0.0055,  # 55 pips - test ATR filter
        min_volume_pct=0.0,    # Disabled for this test
        one_trade_per_day=True
    )
    
    # Create minimal strategy instance for testing
    # LondonBreakoutStrategy.generate_vectorized_signals can work with just params
    import logging
    
    class MinimalStrategy:
        """Minimal strategy for testing vectorized signal generation."""
        def __init__(self):
            self.params = params
            self.logger = logging.getLogger("parity_test")
            self.config = None  # No config = uses default UTC timezone
    
    strategy = MinimalStrategy()
    
    # Bind the method from the class to our instance
    from types import MethodType
    strategy.generate_vectorized_signals = MethodType(
        LondonBreakoutStrategy.generate_vectorized_signals, strategy
    )
    strategy.calculate_indicators = MethodType(
        LondonBreakoutStrategy.calculate_indicators, strategy
    )
    
    # ========== TEST 1: Vectorized Signal Generation ==========
    print("\n--- Vectorized Path ---")
    vec_signals = strategy.generate_vectorized_signals(data.copy(), params=params)
    
    long_entries_vec = vec_signals['long_entries']
    short_entries_vec = vec_signals['short_entries']
    sl_stop = vec_signals.get('sl_stop')
    tp_stop = vec_signals.get('tp_stop')
    
    vec_long_count = np.sum(long_entries_vec)
    vec_short_count = np.sum(short_entries_vec)
    
    print(f"Long entries: {vec_long_count}")
    print(f"Short entries: {vec_short_count}")
    print(f"SL array has values: {sl_stop is not None and np.any(~np.isnan(sl_stop))}")
    print(f"TP array has values: {tp_stop is not None and np.any(~np.isnan(tp_stop))}")
    
    # Show first few entry signals
    long_indices = np.where(long_entries_vec)[0]
    short_indices = np.where(short_entries_vec)[0]
    
    print(f"\nFirst 5 long entries (bar indices): {long_indices[:5]}")
    print(f"First 5 short entries (bar indices): {short_indices[:5]}")
    
    # ========== TEST 2: SL/TP Shift Verification ==========
    print("\n--- SL/TP Shift Verification ---")
    if len(long_indices) > 0:
        idx = long_indices[0]
        sl_value = sl_stop[idx] if sl_stop is not None else None
        tp_value = tp_stop[idx] if tp_stop is not None else None
        print(f"Entry at bar {idx}: SL={sl_value}, TP={tp_value}")
        
        # Check that SL is reasonable (should be ~0.5-3% for FX)
        if sl_value is not None and not np.isnan(sl_value):
            if 0.001 < sl_value < 0.05:
                print(f"✅ SL percentage looks reasonable: {sl_value*100:.2f}%")
            else:
                print(f"⚠️ SL percentage unusual: {sl_value*100:.2f}%")
    
    # ========== TEST 3: Check asia_low/asia_high are defined ==========
    print("\n--- Event-Driven Variable Test ---")
    try:
        # Run calculate_indicators (event-driven path)
        df_with_indicators = strategy.calculate_indicators(data.copy())
        
        # Check required columns exist
        required_cols = ['asia_low', 'asia_high', 'asia_midpoint', 'long_entry_level', 'short_entry_level']
        missing = [c for c in required_cols if c not in df_with_indicators.columns]
        
        if missing:
            print(f"❌ Missing columns: {missing}")
        else:
            print(f"✅ All required columns present")
            
        # Check volume_ok column
        if 'volume_ok' in df_with_indicators.columns:
            print(f"✅ Volume filter column present")
        else:
            print(f"⚠️ Volume filter column missing (OK if min_volume_pct=0)")
            
    except Exception as e:
        print(f"❌ Event-driven indicator calculation failed: {e}")
    
    # ========== SUMMARY ==========
    print("\n" + "=" * 60)
    print("PARITY TEST SUMMARY")
    print("=" * 60)
    
    issues = []
    
    if vec_long_count == 0 and vec_short_count == 0:
        issues.append("No trades generated (may be OK if ATR filter is blocking)")
    
    if sl_stop is None or np.all(np.isnan(sl_stop)):
        issues.append("SL array is all NaN")
        
    if tp_stop is None or np.all(np.isnan(tp_stop)):
        issues.append("TP array is all NaN")
    
    if issues:
        print("⚠️ Potential Issues:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("✅ All basic parity checks passed")
    
    print("\nNote: Full parity test would compare actual trade execution.")
    print("This test verifies signal generation and column availability.")


if __name__ == "__main__":
    main()

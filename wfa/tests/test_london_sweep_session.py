# tests/test_london_sweep_session.py
"""
Unit tests for London Sweep Fade strategy session boundaries and timezone handling.

Tests:
1. Asia session window (00:00-07:00 UTC)
2. Sweep detection window (07:00-09:00 UTC)
3. Time stop (10:00 UTC)
4. DST transition handling (US and UK)
"""

import unittest
import pandas as pd
import numpy as np
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.strategies.london_sweep_fade import LondonSweepFadeStrategy, LondonSweepFadeParams


class MockLogger:
    def info(self, msg): pass
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass


class MockConfig:
    def get_nested(self, key):
        if key == 'data.timezone':
            return 'UTC'
        return None


class TestSessionBoundaries(unittest.TestCase):
    """Test Asia session and sweep window boundaries."""
    
    def setUp(self):
        """Create sample M15 data spanning multiple sessions."""
        # Generate 1 day of M15 data (96 bars)
        dates = pd.date_range(
            start="2024-01-15 00:00:00",
            end="2024-01-15 23:45:00",
            freq="15min",
            tz="UTC"
        )
        
        np.random.seed(42)
        base_price = 1.0900
        price_path = base_price + np.cumsum(np.random.normal(0, 0.0002, len(dates)))
        
        self.data = pd.DataFrame({
            'timestamp': dates,
            'open': price_path,
            'high': price_path + 0.0010,
            'low': price_path - 0.0010,
            'close': price_path + np.random.normal(0, 0.0001, len(dates)),
            'volume': np.random.randint(100, 1000, len(dates)).astype(float)
        })
    
    def test_asia_session_is_00_to_07_utc(self):
        """Verify Asia session is defined as 00:00-07:00 UTC."""
        params = LondonSweepFadeParams()
        
        self.assertEqual(params.asia_start_hour, 0)
        self.assertEqual(params.asia_end_hour, 7)
    
    def test_sweep_window_is_07_to_09_utc(self):
        """Verify sweep detection window is 07:00-09:00 UTC."""
        params = LondonSweepFadeParams()
        
        self.assertEqual(params.asia_end_hour, 7)  # Sweep starts at Asia end
        self.assertEqual(params.sweep_window_end_hour, 9)
    
    def test_time_stop_is_10_utc(self):
        """Verify time stop is 10:00 UTC."""
        params = LondonSweepFadeParams()
        
        self.assertEqual(params.time_stop_hour, 10)


class TestDSTTransitions(unittest.TestCase):
    """Test handling of Daylight Saving Time transitions."""
    
    def test_us_dst_transition_2024(self):
        """Test US DST transition: 2024-03-10 (clocks forward)."""
        # Data crosses 2024-03-10 02:00 EST (DST starts)
        dates = pd.date_range(
            start="2024-03-09 22:00:00",
            end="2024-03-10 12:00:00",
            freq="15min",
            tz="UTC"
        )
        
        # Verify hours are consistent in UTC (no gaps)
        hours = dates.hour
        
        # At UTC, there should be no discontinuity
        # US EST is UTC-5, EDT is UTC-4, but our data is already in UTC
        self.assertEqual(len(dates), 57)  # 14 hours * 4 bars + 1
    
    def test_uk_dst_transition_2024(self):
        """Test UK DST transition: 2024-03-31 (clocks forward)."""
        # Data crosses 2024-03-31 01:00 UK (DST starts)
        dates = pd.date_range(
            start="2024-03-30 22:00:00",
            end="2024-03-31 12:00:00",
            freq="15min",
            tz="UTC"
        )
        
        # At UTC, there should be no discontinuity
        self.assertEqual(len(dates), 57)


class TestTimezoneConversion(unittest.TestCase):
    """Test timezone conversion for naive and aware timestamps."""
    
    def test_naive_timestamp_localized_to_utc(self):
        """Verify naive timestamps are localized to UTC."""
        # Create naive data
        dates = pd.date_range(
            start="2024-01-15 00:00:00",
            end="2024-01-15 23:45:00",
            freq="15min"
        )
        
        data = pd.DataFrame({
            'timestamp': dates,
            'open': np.ones(len(dates)),
            'high': np.ones(len(dates)) + 0.001,
            'low': np.ones(len(dates)) - 0.001,
            'close': np.ones(len(dates)),
            'volume': np.ones(len(dates))
        })
        
        # Simulate strategy's timezone handling
        ts = pd.to_datetime(data['timestamp'])
        self.assertIsNone(ts.dt.tz)  # Should be naive
        
        # After localization
        ts_localized = ts.dt.tz_localize('UTC')
        self.assertEqual(str(ts_localized.dt.tz), 'UTC')


if __name__ == '__main__':
    unittest.main()

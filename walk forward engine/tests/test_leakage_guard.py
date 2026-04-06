import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from src.walk_forward.data_integrity import DataIntegrityManager, LeakagePreventionError
from src.walk_forward.wfa_window_manager import WFAWindowManager, WFAWindowConfig, WindowStrategy
from src.exceptions import DataValidationError

class TestLeakageGuard:
    def setup_method(self):
        self.dim = DataIntegrityManager(enable_strict_validation=True)
        self.dates = pd.date_range("2023-01-01", periods=100, freq="D")
        self.data = pd.DataFrame({
            "timestamp": self.dates,
            "close": np.random.randn(100),
            "open": np.random.randn(100),
            "high": np.random.randn(100),
            "low": np.random.randn(100),
            "volume": 1000
        })

    def test_strict_temporal_separation(self):
        """Verify that training and validation sets are strictly temporally separated."""
        # 0.7 split of 100 days
        train_start = self.dates[0]
        train_end = self.dates[-1] + timedelta(days=1)
        
        train, val, meta = self.dim.create_leakage_proof_split(
            self.data, 
            window_id=1, 
            training_start=train_start, 
            training_end=train_end
        )
        
        # Assert max train < min val
        assert not train.empty
        assert not val.empty
        assert train["timestamp"].max() < val["timestamp"].min()
        
        # Assert checking passed
        assert meta.leakage_checks_passed

    def test_overlap_detection(self):
        """Verify that manually introduced overlap triggers LeakagePreventionError."""
        train_data = self.data.iloc[0:60].copy()
        val_data = self.data.iloc[50:100].copy() # Overlap 50-60
        
        with pytest.raises(LeakagePreventionError, match="Temporal leakage"):
            self.dim._perform_leakage_checks(
                train_data, 
                val_data, 
                train_data.index.tolist(), 
                val_data.index.tolist()
            )

    def test_future_access_guard(self):
        """Verify runtime guard against future timestamps."""
        guards = self.dim.create_runtime_guards()
        checker = guards["validate_timestamp_access"]
        
        cutoff = datetime(2023, 1, 5)
        # Data goes up to 2023-04-10
        
        with pytest.raises(LeakagePreventionError, match="Attempted to access"):
            checker(self.data, cutoff)

    def test_indicator_lookahead_guard(self):
        """Verify runtime guard against future data in indicator calculation."""
        guards = self.dim.create_runtime_guards()
        checker = guards["validate_indicator_calculation"]
        
        calc_time = datetime(2023, 1, 5)
        # Data goes way past Jan 5
        
        with pytest.raises(LeakagePreventionError, match="Indicator calculation attempted to use"):
            checker(self.data, calc_time, lookback_period=14)

    def test_disordered_data_rejection(self):
        """DataIntegrityManager should reject unsorted data."""
        bad_data = self.data.copy()
        # Swap two rows to break monotonicity
        bad_data.iloc[0], bad_data.iloc[1] = bad_data.iloc[1].copy(), bad_data.iloc[0].copy()
        
        # Check validation
        with pytest.raises(DataValidationError, match="monotonically increasing"):
            self.dim._validate_input_data(bad_data)

    def test_explicit_temporal_split_uses_requested_outer_boundaries(self):
        """Explicit temporal splits should preserve the configured outer train/test periods."""
        training_start = pd.Timestamp("2023-01-01")
        training_end = pd.Timestamp("2023-03-01")
        validation_start = pd.Timestamp("2023-03-01")
        validation_end = pd.Timestamp("2023-04-01")

        train, val, meta = self.dim.create_temporal_split(
            self.data,
            window_id=2,
            training_start=training_start,
            training_end=training_end,
            validation_start=validation_start,
            validation_end=validation_end,
        )

        assert meta.training_start == training_start
        assert meta.training_end == training_end
        assert meta.validation_start == validation_start
        assert meta.validation_end == validation_end
        assert train["timestamp"].min() == training_start
        assert train["timestamp"].max() < training_end
        assert val["timestamp"].min() == validation_start
        assert val["timestamp"].max() < validation_end

    def test_wfa_window_manager_uses_calendar_month_boundaries(self):
        """Rolling windows should use calendar months, not fixed 30-day approximations."""
        data = pd.DataFrame({
            "timestamp": pd.date_range("2023-01-01", "2023-06-30", freq="D"),
            "close": np.random.randn(181),
            "open": np.random.randn(181),
            "high": np.random.randn(181),
            "low": np.random.randn(181),
            "volume": 1000,
        })

        manager = WFAWindowManager(
            config=WFAWindowConfig(
                strategy=WindowStrategy.ROLLING,
                optimization_months=1,
                validation_months=1,
                step_months=1,
                min_bars_per_window=20,
            ),
            data_integrity_manager=self.dim,
        )

        windows = manager.generate_wfa_windows(data)
        first_window = windows[0]

        assert first_window.optimization_period.start == pd.Timestamp("2023-01-01")
        assert first_window.optimization_period.end == pd.Timestamp("2023-02-01")
        assert first_window.validation_period.start == pd.Timestamp("2023-02-01")
        assert first_window.validation_period.end == pd.Timestamp("2023-03-01")
        assert first_window.optimization_data["timestamp"].max() == pd.Timestamp("2023-01-31")
        assert first_window.validation_data["timestamp"].min() == pd.Timestamp("2023-02-01")

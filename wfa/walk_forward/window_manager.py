# src/walk_forward/window_manager.py

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from typing import List, Optional
from dataclasses import dataclass
import logging
import os


@dataclass
class DateRange:
    """Date range specification"""
    start: datetime
    end: datetime
    
    def __str__(self) -> str:
        return f"{self.start.strftime('%Y-%m-%d')} to {self.end.strftime('%Y-%m-%d')}"
    
    def __eq__(self, other) -> bool:
        if not isinstance(other, DateRange):
            return False
        return self.start == other.start and self.end == other.end


@dataclass
class WindowConfig:
    """Configuration for window generation"""
    training_months: int
    testing_months: int
    step_months: int
    min_bars_per_window: int

    # Enhanced configuration for async orchestrator compatibility
    training_window_months: Optional[int] = None
    testing_window_months: Optional[int] = None
    step_size_months: Optional[int] = None

    def __post_init__(self):
        """Validate configuration parameters"""
        if self.training_months <= 0:
            raise ValueError("Training months must be positive")
        if self.testing_months <= 0:
            raise ValueError("Testing months must be positive")
        if self.step_months <= 0:
            raise ValueError("Step months must be positive")
        if self.min_bars_per_window <= 0:
            raise ValueError("Minimum bars per window must be positive")

        # Set compatibility aliases
        if self.training_window_months is None:
            self.training_window_months = self.training_months
        if self.testing_window_months is None:
            self.testing_window_months = self.testing_months
        if self.step_size_months is None:
            self.step_size_months = self.step_months


@dataclass
class TimeWindow:
    """Time window containing training and testing data"""
    training_period: DateRange
    testing_period: DateRange
    training_data: pd.DataFrame
    testing_data: pd.DataFrame
    
    def __str__(self) -> str:
        return f"Training: {self.training_period}, Testing: {self.testing_period}"
    
    def __post_init__(self):
        """Validate window data"""
        if self.training_data.empty:
            raise ValueError("Training data cannot be empty")
        if self.testing_data.empty:
            raise ValueError("Testing data cannot be empty")
        if 'timestamp' not in self.training_data.columns:
            raise ValueError("Training data must contain 'timestamp' column")
        if 'timestamp' not in self.testing_data.columns:
            raise ValueError("Testing data must contain 'timestamp' column")


class WindowManager:
    """Manages time window generation and data splitting for walk-forward analysis"""
    
    def __init__(self, window_config: WindowConfig):
        self.training_months = window_config.training_months
        self.testing_months = window_config.testing_months  
        self.step_months = window_config.step_months
        self.min_bars_per_window = window_config.min_bars_per_window
        self.logger = logging.getLogger(self.__class__.__name__)
    
    def generate_windows_from_dataframe(self, data: pd.DataFrame) -> List[TimeWindow]:
        """
        Generate all time windows for walk-forward analysis from DataFrame.
        
        Args:
            data: DataFrame with 'timestamp' column
            
        Returns:
            List of TimeWindow objects
            
        Raises:
            ValueError: If data is invalid or insufficient
        """
        if data.empty:
            raise ValueError("Data cannot be empty")
        
        if 'timestamp' not in data.columns:
            raise ValueError("Data must contain 'timestamp' column")
        
        # Ensure timestamp is datetime
        data_copy = data.copy()
        if not pd.api.types.is_datetime64_any_dtype(data_copy['timestamp']):
            try:
                data_copy['timestamp'] = pd.to_datetime(data_copy['timestamp'])
            except Exception as e:
                raise ValueError(f"Cannot convert timestamp column to datetime: {e}")
        
        # Sort by timestamp and remove duplicates
        data_copy = data_copy.sort_values('timestamp').drop_duplicates(subset=['timestamp']).reset_index(drop=True)
        
        if len(data_copy) < self.min_bars_per_window * 2:
            raise ValueError(f"Insufficient data: need at least {self.min_bars_per_window * 2} bars")
        
        start_date = data_copy['timestamp'].min()
        end_date = data_copy['timestamp'].max()
        
        # Check if we have enough data for at least one complete window
        min_required_end = start_date + relativedelta(months=self.training_months + self.testing_months)
        if min_required_end > end_date:
            raise ValueError(f"Insufficient data range: need at least {self.training_months + self.testing_months} months")
        
        windows = []
        current_start = start_date
        window_id = 0
        
        while True:
            # Calculate window boundaries
            training_end = current_start + relativedelta(months=self.training_months)
            testing_start = training_end
            testing_end = testing_start + relativedelta(months=self.testing_months)
            
            # Check if we have enough data for this window
            if testing_end > end_date:
                self.logger.debug(f"Reached end of data at window {window_id}")
                break
                
            # Extract training data
            training_mask = (data_copy['timestamp'] >= current_start) & (data_copy['timestamp'] < training_end)
            training_data = data_copy[training_mask].copy().reset_index(drop=True)
            
            # Extract testing data
            testing_mask = (data_copy['timestamp'] >= testing_start) & (data_copy['timestamp'] < testing_end)
            testing_data = data_copy[testing_mask].copy().reset_index(drop=True)
            
            # Validate minimum bars requirement
            if (len(training_data) >= self.min_bars_per_window and 
                len(testing_data) >= self.min_bars_per_window):
                
                try:
                    window = TimeWindow(
                        training_period=DateRange(current_start, training_end),
                        testing_period=DateRange(testing_start, testing_end),
                        training_data=training_data,
                        testing_data=testing_data
                    )
                    windows.append(window)
                    window_id += 1
                    
                    self.logger.debug(f"Created window {window_id}: {window}")
                    
                except Exception as e:
                    self.logger.warning(f"Failed to create window {window_id}: {e}")
            else:
                self.logger.debug(f"Skipping window {window_id}: insufficient data "
                                f"(training: {len(training_data)}, testing: {len(testing_data)})")
            
            # Move to next window
            current_start += relativedelta(months=self.step_months)
        
        if not windows:
            raise ValueError("No valid windows could be generated with the given configuration")
        
        self.logger.info(f"Generated {len(windows)} valid windows")
        return windows
    
    def generate_windows_from_file(self, file_path: str) -> List[TimeWindow]:
        """
        Generate windows from CSV file.
        
        Args:
            file_path: Path to CSV file with timestamp column
            
        Returns:
            List of TimeWindow objects
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Data file not found: {file_path}")
        
        try:
            data = pd.read_csv(file_path)
            return self.generate_windows_from_dataframe(data)
        except Exception as e:
            raise ValueError(f"Failed to load data from {file_path}: {e}")


if __name__ == "__main__":
    # Example usage
    logging.basicConfig(level=logging.INFO)
    
    # Create sample data
    start_date = datetime(2020, 1, 1)
    end_date = datetime(2022, 12, 31)
    timestamps = pd.date_range(start=start_date, end=end_date, freq='H')
    
    sample_data = pd.DataFrame({
        'timestamp': timestamps,
        'close': np.random.uniform(1.0, 2.0, len(timestamps)),
        'volume': np.random.randint(100, 1000, len(timestamps))
    })
    
    # Test window generation
    config = WindowConfig(
        training_months=6,
        testing_months=1,
        step_months=1,
        min_bars_per_window=100
    )
    
    manager = WindowManager(config)
    windows = manager.generate_windows_from_dataframe(sample_data)
    
    print(f"Generated {len(windows)} windows:")
    for i, window in enumerate(windows[:3]):  # Show first 3
        print(f"Window {i+1}: {window}")
        print(f"  Training data: {len(window.training_data)} bars")
        print(f"  Testing data: {len(window.testing_data)} bars")

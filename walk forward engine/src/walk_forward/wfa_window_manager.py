"""
Enhanced Walk-Forward Analysis Window Manager.

This module provides walk-forward window management with support for
anchored and rolling window strategies, calendar-aware month arithmetic,
and explicit outer train/test segmentation.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Union

import pandas as pd
from dateutil.relativedelta import relativedelta

from .data_integrity import DataIntegrityManager, DataSplitMetadata
from .window_manager import TimeWindow, DateRange, WindowConfig


class WindowStrategy(Enum):
    """Window strategy types for WFA."""
    ROLLING = "rolling"
    ANCHORED = "anchored"


class OptimizationPhase(Enum):
    """Optimization phases within each window."""
    PARAMETER_OPTIMIZATION = "parameter_optimization"
    OUT_OF_SAMPLE_VALIDATION = "out_of_sample_validation"


@dataclass
class WFAWindowConfig:
    """Configuration for WFA window management."""
    strategy: WindowStrategy
    optimization_months: int
    validation_months: int
    step_months: int
    min_bars_per_window: int
    optimization_validation_split: float = 0.7  # 70/30 split
    enable_stage_based_optimization: bool = True
    max_parameter_age_months: int = 12  # Parameter shelf-life
    purge_gap_bars: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.purge_gap_bars, int) or self.purge_gap_bars < 0:
            raise ValueError("purge_gap_bars must be a non-negative integer")


@dataclass
class WFAWindow:
    """Enhanced window with optimization and validation phases."""
    window_id: int
    strategy: WindowStrategy
    
    # Time periods
    optimization_period: DateRange
    validation_period: DateRange
    
    # Data splits (leakage-proof)
    optimization_data: pd.DataFrame
    validation_data: pd.DataFrame
    
    # Metadata
    split_metadata: DataSplitMetadata
    created_at: datetime
    
    # Stage tracking
    current_phase: OptimizationPhase = OptimizationPhase.PARAMETER_OPTIMIZATION
    optimization_complete: bool = False
    validation_complete: bool = False
    purge_gap_bars: int = 0
    purged_validation_bars: int = 0


class WFAWindowManager:
    """
    Enhanced window manager for walk-forward analysis.

    Supports both anchored and rolling window strategies using explicit outer
    optimization/testing windows. Nested validation, if needed, must happen
    inside the optimization window and is not part of the default path.
    """
    
    def __init__(self, 
                 config: WFAWindowConfig,
                 data_integrity_manager: DataIntegrityManager,
                 logger: Optional[logging.Logger] = None):
        """
        Initialize WFA window manager.
        
        Args:
            config: WFA window configuration
            data_integrity_manager: Data integrity manager for leakage-proof splits
            logger: Logger instance
        """
        self.config = config
        self.data_integrity_manager = data_integrity_manager
        self.logger = logger or logging.getLogger(__name__)
        
        # Window tracking
        self.windows: List[WFAWindow] = []
        self.current_window_index: int = 0
        
        # Performance tracking
        self.window_performance: Dict[int, Dict[str, float]] = {}
        self.parameter_history: Dict[int, Dict[str, any]] = {}
        
        self.logger.info(f"WFAWindowManager initialized with {config.strategy.value} strategy")
    
    def generate_wfa_windows(self, data: pd.DataFrame) -> List[WFAWindow]:
        """
        Generate WFA windows with explicit outer optimization/testing periods.
        
        Args:
            data: Historical time series data
            
        Returns:
            List of WFA windows with leakage-proof data splits
        """
        self.logger.info("Generating WFA windows with explicit outer train/test splits")
        
        # Validate input data
        if 'timestamp' not in data.columns and 'Date' in data.columns:
            data['timestamp'] = pd.to_datetime(data['Date'])
        elif 'timestamp' in data.columns:
            data['timestamp'] = pd.to_datetime(data['timestamp'])
        else:
            raise ValueError("Data must contain 'timestamp' or 'Date' column")
        
        # Sort by timestamp
        data = data.sort_values('timestamp').reset_index(drop=True)
        
        # Calculate window parameters
        start_date = data['timestamp'].min()
        end_date = data['timestamp'].max()
        
        windows = []
        window_id = 0
        
        if self.config.strategy == WindowStrategy.ROLLING:
            windows = self._generate_rolling_windows(data, start_date, end_date)
        else:  # ANCHORED
            windows = self._generate_anchored_windows(data, start_date, end_date)
        
        self.windows = windows
        self.logger.info(f"Generated {len(windows)} WFA windows using {self.config.strategy.value} strategy")
        
        return windows

    def _validation_start_after_purge(
            self,
            data: pd.DataFrame,
            optimization_end: datetime,
            validation_end: datetime) -> Tuple[Optional[datetime], int]:
        """Return validation_start after dropping the configured post-training purge bars."""
        purge_gap_bars = self.config.purge_gap_bars
        if purge_gap_bars == 0:
            return optimization_end, 0

        validation_candidates = data[
            (data['timestamp'] >= optimization_end) &
            (data['timestamp'] < validation_end)
        ].copy()
        if len(validation_candidates) <= purge_gap_bars:
            return None, len(validation_candidates)

        return validation_candidates.iloc[purge_gap_bars]['timestamp'].to_pydatetime(), purge_gap_bars
    
    def _generate_rolling_windows(self, 
                                data: pd.DataFrame, 
                                start_date: datetime, 
                                end_date: datetime) -> List[WFAWindow]:
        """Generate rolling windows with fixed window size."""
        windows = []
        window_id = 0
        
        current_start = start_date
        
        while True:
            # Calculate window periods
            optimization_end = current_start + relativedelta(months=self.config.optimization_months)
            validation_end = optimization_end + relativedelta(months=self.config.validation_months)
            
            # Check if we have enough data - allow partial validation window
            # If validation_end > end_date, truncate validation to available data
            if validation_end > end_date:
                # Only create partial window if we have enough training AND at least some validation data
                min_validation_days = self.config.min_bars_per_window // 24  # Approximate hours
                if (end_date - optimization_end).total_seconds() < min_validation_days * 3600:
                    # Not enough validation data even after truncation - skip
                    break
                validation_end = end_date  # Truncate to available data
            
            validation_start, purged_validation_bars = self._validation_start_after_purge(
                data,
                optimization_end,
                validation_end,
            )
            if validation_start is None:
                self.logger.warning(
                    f"Insufficient validation data after purging {self.config.purge_gap_bars} bars for window {window_id}, skipping"
                )
                break

            # Create time periods
            optimization_period = DateRange(start=current_start, end=optimization_end)
            validation_period = DateRange(start=validation_start, end=validation_end)
            
            # Create explicit outer train/test split
            optimization_data, validation_data, split_metadata = \
                self.data_integrity_manager.create_temporal_split(
                    data,
                    window_id=window_id,
                    training_start=current_start,
                    training_end=optimization_end,
                    validation_start=validation_start,
                    validation_end=validation_end,
                )

            if (len(optimization_data) < self.config.min_bars_per_window or
                    len(validation_data) < self.config.min_bars_per_window):
                self.logger.warning(f"Insufficient data for window {window_id}, skipping")
                break
            
            # Create WFA window
            wfa_window = WFAWindow(
                window_id=window_id,
                strategy=self.config.strategy,
                optimization_period=optimization_period,
                validation_period=validation_period,
                optimization_data=optimization_data,
                validation_data=validation_data,
                split_metadata=split_metadata,
                created_at=datetime.now()
            )
            wfa_window.purge_gap_bars = self.config.purge_gap_bars
            wfa_window.purged_validation_bars = purged_validation_bars
            
            windows.append(wfa_window)
            
            # Move to next window
            current_start += relativedelta(months=self.config.step_months)
            window_id += 1
        
        return windows
    
    def _generate_anchored_windows(self, 
                                 data: pd.DataFrame, 
                                 start_date: datetime, 
                                 end_date: datetime) -> List[WFAWindow]:
        """Generate anchored windows with growing optimization period."""
        windows = []
        window_id = 0
        
        validation_start = start_date + relativedelta(months=self.config.optimization_months)
        
        while True:
            # Calculate window periods
            optimization_period = DateRange(start=start_date, end=validation_start)
            validation_end = validation_start + relativedelta(months=self.config.validation_months)
            
            # Check if we have enough data
            if validation_end > end_date:
                break

            purged_validation_start, purged_validation_bars = self._validation_start_after_purge(
                data,
                validation_start,
                validation_end,
            )
            if purged_validation_start is None:
                self.logger.warning(
                    f"Insufficient validation data after purging {self.config.purge_gap_bars} bars for window {window_id}, skipping"
                )
                break
            validation_period = DateRange(start=purged_validation_start, end=validation_end)
            
            optimization_data, validation_data, split_metadata = \
                self.data_integrity_manager.create_temporal_split(
                    data,
                    window_id=window_id,
                    training_start=start_date,
                    training_end=validation_start,
                    validation_start=purged_validation_start,
                    validation_end=validation_end,
                )

            if (len(optimization_data) < self.config.min_bars_per_window or
                    len(validation_data) < self.config.min_bars_per_window):
                self.logger.warning(f"Insufficient data for window {window_id}, skipping")
                break
            
            # Create WFA window
            wfa_window = WFAWindow(
                window_id=window_id,
                strategy=self.config.strategy,
                optimization_period=optimization_period,
                validation_period=validation_period,
                optimization_data=optimization_data,
                validation_data=validation_data,
                split_metadata=split_metadata,
                created_at=datetime.now()
            )
            wfa_window.purge_gap_bars = self.config.purge_gap_bars
            wfa_window.purged_validation_bars = purged_validation_bars
            
            windows.append(wfa_window)
            
            # Move to next window (anchored grows)
            validation_start += relativedelta(months=self.config.step_months)
            window_id += 1
        
        return windows
    
    def get_window_by_id(self, window_id: int) -> Optional[WFAWindow]:
        """Get window by ID."""
        for window in self.windows:
            if window.window_id == window_id:
                return window
        return None
    
    def get_current_window(self) -> Optional[WFAWindow]:
        """Get current window being processed."""
        if 0 <= self.current_window_index < len(self.windows):
            return self.windows[self.current_window_index]
        return None
    
    def advance_to_next_window(self) -> bool:
        """
        Advance to next window.
        
        Returns:
            True if advanced successfully, False if no more windows
        """
        if self.current_window_index < len(self.windows) - 1:
            self.current_window_index += 1
            return True
        return False
    
    def mark_window_phase_complete(self, window_id: int, phase: OptimizationPhase) -> None:
        """Mark a window phase as complete."""
        window = self.get_window_by_id(window_id)
        if window:
            if phase == OptimizationPhase.PARAMETER_OPTIMIZATION:
                window.optimization_complete = True
                window.current_phase = OptimizationPhase.OUT_OF_SAMPLE_VALIDATION
            elif phase == OptimizationPhase.OUT_OF_SAMPLE_VALIDATION:
                window.validation_complete = True
            
            self.logger.debug(f"Window {window_id} phase {phase.value} marked complete")
    
    def get_window_statistics(self) -> Dict[str, any]:
        """Get statistics about generated windows."""
        if not self.windows:
            return {}
        
        total_windows = len(self.windows)
        completed_optimizations = sum(1 for w in self.windows if w.optimization_complete)
        completed_validations = sum(1 for w in self.windows if w.validation_complete)
        
        # Calculate average window sizes
        avg_optimization_bars = sum(len(w.optimization_data) for w in self.windows) / total_windows
        avg_validation_bars = sum(len(w.validation_data) for w in self.windows) / total_windows
        
        return {
            'total_windows': total_windows,
            'completed_optimizations': completed_optimizations,
            'completed_validations': completed_validations,
            'completion_rate': completed_validations / total_windows if total_windows > 0 else 0,
            'strategy': self.config.strategy.value,
            'avg_optimization_bars': avg_optimization_bars,
            'avg_validation_bars': avg_validation_bars,
            'nested_optimization_validation_enabled': False,
        }

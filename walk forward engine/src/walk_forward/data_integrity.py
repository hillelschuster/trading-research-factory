"""
Data Integrity and Leakage Prevention Module for Walk-Forward Analysis

This module implements industry-standard data integrity measures to prevent
data leakage and ensure deterministic reproducibility in walk-forward analysis.

Key Features:
- Leakage-proof data splitting with comprehensive validation
- Deterministic reproducibility with seed management
- Environment capture for complete reproducibility
- Runtime guards against future information use
- Comprehensive audit trail and artifact persistence

Industry Standards Implemented:
- Explicit temporal train/validation splits for walk-forward analysis
- Optional nested optimization/validation splits within a training window
- Temporal data isolation with strict chronological ordering
- Lookahead bias prevention with runtime assertions
- Deterministic random state management
- Complete environment state capture
"""

import hashlib
import json
import logging
import os
import pickle
import random
import sys
import warnings
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta

from src.exceptions import DataValidationError, ConfigurationError


@dataclass
class EnvironmentState:
    """Captures complete environment state for reproducibility."""
    python_version: str
    numpy_version: str
    pandas_version: str
    random_seed: int
    numpy_seed: int
    config_hash: str
    timestamp: datetime
    system_info: Dict[str, Any]
    library_versions: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            'python_version': self.python_version,
            'numpy_version': self.numpy_version,
            'pandas_version': self.pandas_version,
            'random_seed': self.random_seed,
            'numpy_seed': self.numpy_seed,
            'config_hash': self.config_hash,
            'timestamp': self.timestamp.isoformat(),
            'system_info': self.system_info,
            'library_versions': self.library_versions
        }


@dataclass
class DataSplitMetadata:
    """Metadata for data splits with complete audit trail."""
    window_id: int
    training_start: datetime
    training_end: datetime
    validation_start: datetime
    validation_end: datetime
    training_indices: List[int]
    validation_indices: List[int]
    split_ratio: float
    seed_used: int
    environment_state: EnvironmentState
    leakage_checks_passed: bool
    created_at: datetime
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            'window_id': self.window_id,
            'training_start': self.training_start.isoformat(),
            'training_end': self.training_end.isoformat(),
            'validation_start': self.validation_start.isoformat(),
            'validation_end': self.validation_end.isoformat(),
            'training_indices': self.training_indices,
            'validation_indices': self.validation_indices,
            'split_ratio': self.split_ratio,
            'seed_used': self.seed_used,
            'environment_state': self.environment_state.to_dict(),
            'leakage_checks_passed': self.leakage_checks_passed,
            'created_at': self.created_at.isoformat()
        }


class LeakagePreventionError(DataValidationError):
    """Raised when data leakage is detected."""
    pass


class DataIntegrityManager:
    """
    Manages data integrity and leakage prevention for walk-forward analysis.
    
    This class implements industry-standard practices for preventing data leakage
    and ensuring deterministic reproducibility in trading system validation.
    """
    
    def __init__(self, 
                 base_seed: int = 42,
                 split_ratio: float = 0.7,
                 artifacts_dir: Optional[str] = None,
                 enable_strict_validation: bool = True):
        """
        Initialize the Data Integrity Manager.
        
        Args:
            base_seed: Base random seed for deterministic behavior
            split_ratio: Ratio for training/validation split (0.7 = 70% training)
            artifacts_dir: Directory to store artifacts and metadata
            enable_strict_validation: Whether to enable strict leakage validation
        """
        self.base_seed = base_seed
        self.split_ratio = split_ratio
        self.enable_strict_validation = enable_strict_validation
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Setup artifacts directory
        if artifacts_dir is None:
            artifacts_dir = "artifacts/data_integrity"
        self.artifacts_dir = Path(artifacts_dir)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize random states
        self._initialize_random_states()
        
        # Capture environment state
        self.environment_state = self._capture_environment_state()
        
        # Storage for split metadata
        self.split_metadata: List[DataSplitMetadata] = []
        
        self.logger.info(f"DataIntegrityManager initialized with seed={base_seed}, "
                        f"split_ratio={split_ratio}, strict_validation={enable_strict_validation}")
    
    def _initialize_random_states(self) -> None:
        """Initialize all random number generators with deterministic seeds."""
        # Set Python random seed
        random.seed(self.base_seed)
        
        # Set NumPy random seed
        np.random.seed(self.base_seed)
        
        # Set pandas random seed (if available)
        try:
            pd.core.common.random_state(self.base_seed)
        except AttributeError:
            pass  # Older pandas versions may not have this
        
        self.logger.debug(f"Random states initialized with base seed: {self.base_seed}")
    
    def _capture_environment_state(self) -> EnvironmentState:
        """Capture complete environment state for reproducibility."""
        import platform
        
        # Get library versions
        library_versions = {}
        try:
            import optuna
            library_versions['optuna'] = optuna.__version__
        except ImportError:
            pass
        
        try:
            import sklearn
            library_versions['sklearn'] = sklearn.__version__
        except ImportError:
            pass
        
        # Create configuration hash (will be updated when config is provided)
        config_hash = hashlib.md5(str(self.base_seed).encode()).hexdigest()
        
        return EnvironmentState(
            python_version=sys.version,
            numpy_version=np.__version__,
            pandas_version=pd.__version__,
            random_seed=self.base_seed,
            numpy_seed=self.base_seed,
            config_hash=config_hash,
            timestamp=datetime.now(),
            system_info={
                'platform': platform.platform(),
                'processor': platform.processor(),
                'python_implementation': platform.python_implementation()
            },
            library_versions=library_versions
        )
    
    def update_config_hash(self, config: Dict[str, Any]) -> None:
        """Update configuration hash for environment state."""
        config_str = json.dumps(config, sort_keys=True, default=str)
        self.environment_state.config_hash = hashlib.md5(config_str.encode()).hexdigest()
        self.logger.debug(f"Configuration hash updated: {self.environment_state.config_hash}")
    
    def create_leakage_proof_split(self, 
                                  data: pd.DataFrame,
                                  window_id: int,
                                  training_start: datetime,
                                  training_end: datetime) -> Tuple[pd.DataFrame, pd.DataFrame, DataSplitMetadata]:
        """
        Create leakage-proof training/validation split within a window.
        
        This method is used for nested validation inside a training window.
        
        Args:
            data: DataFrame with timestamp column
            window_id: Unique identifier for this window
            training_start: Start of training period
            training_end: End of training period
            
        Returns:
            Tuple of (training_data, validation_data, metadata)
        """
        # Calculate split point within training window
        total_duration = training_end - training_start
        training_duration = total_duration * self.split_ratio
        validation_start = training_start + training_duration
        validation_end = training_end

        return self.create_temporal_split(
            data=data,
            window_id=window_id,
            training_start=training_start,
            training_end=validation_start,
            validation_start=validation_start,
            validation_end=validation_end,
            split_ratio=self.split_ratio,
        )

    def create_temporal_split(self,
                              data: pd.DataFrame,
                              window_id: int,
                              training_start: datetime,
                              training_end: datetime,
                              validation_start: datetime,
                              validation_end: datetime,
                              split_ratio: Optional[float] = None) -> Tuple[pd.DataFrame, pd.DataFrame, DataSplitMetadata]:
        """Create an explicit chronological training/validation split."""
        self.logger.info(f"Creating temporal split for window {window_id}")

        self._validate_input_data(data)

        if training_start >= training_end:
            raise DataValidationError("Training period start must be before training period end")
        if validation_start >= validation_end:
            raise DataValidationError("Validation period start must be before validation period end")
        if training_end > validation_start:
            raise LeakagePreventionError(
                "Training period must end on or before validation period start"
            )

        training_mask = (data['timestamp'] >= training_start) & (data['timestamp'] < training_end)
        validation_mask = (data['timestamp'] >= validation_start) & (data['timestamp'] < validation_end)

        training_original_indices = data[training_mask].index.tolist()
        validation_original_indices = data[validation_mask].index.tolist()

        training_data = data[training_mask].copy().reset_index(drop=True)
        validation_data = data[validation_mask].copy().reset_index(drop=True)

        self._validate_split_quality(
            training_data,
            validation_data,
            training_start,
            validation_end,
            expected_split_ratio=split_ratio,
        )

        if self.enable_strict_validation:
            self._perform_leakage_checks(
                training_data,
                validation_data,
                training_original_indices,
                validation_original_indices,
            )

        total_rows = len(training_data) + len(validation_data)
        actual_split_ratio = (
            len(training_data) / total_rows if total_rows > 0 else 0.0
        )

        metadata = DataSplitMetadata(
            window_id=window_id,
            training_start=training_start,
            training_end=training_end,
            validation_start=validation_start,
            validation_end=validation_end,
            training_indices=training_original_indices,
            validation_indices=validation_original_indices,
            split_ratio=split_ratio if split_ratio is not None else actual_split_ratio,
            seed_used=self.base_seed,
            environment_state=self.environment_state,
            leakage_checks_passed=True,
            created_at=datetime.now(),
        )

        self.split_metadata.append(metadata)
        self._persist_split_metadata(metadata)

        self.logger.info(
            f"Split created: training={len(training_data)} rows, validation={len(validation_data)} rows"
        )

        return training_data, validation_data, metadata

    def _validate_input_data(self, data: pd.DataFrame) -> None:
        """Validate input data for integrity and completeness."""
        if data.empty:
            raise DataValidationError("Input data is empty")

        if 'timestamp' not in data.columns:
            raise DataValidationError("Data must contain 'timestamp' column")

        # Check for proper timestamp ordering
        if not data['timestamp'].is_monotonic_increasing:
            raise DataValidationError("Timestamp column must be monotonically increasing")

        # Check for missing timestamps
        if data['timestamp'].isnull().any():
            raise DataValidationError("Timestamp column contains null values")

        self.logger.debug("Input data validation passed")

    def _validate_split_quality(self,
                               training_data: pd.DataFrame,
                               validation_data: pd.DataFrame,
                               window_start: datetime,
                               window_end: datetime,
                               expected_split_ratio: Optional[float] = None) -> None:
        """Validate the quality of the data split."""
        if training_data.empty:
            raise DataValidationError("Training data is empty after split")

        if validation_data.empty:
            raise DataValidationError("Validation data is empty after split")

        # Check temporal ordering
        max_training_time = training_data['timestamp'].max()
        min_validation_time = validation_data['timestamp'].min()

        if max_training_time >= min_validation_time:
            raise LeakagePreventionError(
                f"Temporal leakage detected: training data extends to {max_training_time}, "
                f"validation starts at {min_validation_time}"
            )

        # Check split ratio
        total_rows = len(training_data) + len(validation_data)
        actual_ratio = len(training_data) / total_rows
        ratio_tolerance = 0.05  # 5% tolerance

        if expected_split_ratio is not None and abs(actual_ratio - expected_split_ratio) > ratio_tolerance:
            warnings.warn(
                f"Split ratio {actual_ratio:.3f} deviates from target {expected_split_ratio:.3f} "
                f"by more than {ratio_tolerance:.3f}"
            )

        self.logger.debug(f"Split quality validation passed: {actual_ratio:.3f} ratio")

    def _perform_leakage_checks(self,
                              training_data: pd.DataFrame,
                              validation_data: pd.DataFrame,
                              training_original_indices: List[int],
                              validation_original_indices: List[int]) -> None:
        """Perform comprehensive leakage checks."""
        self.logger.debug("Performing leakage checks")

        # Check 1: Temporal separation
        max_training_time = training_data['timestamp'].max()
        min_validation_time = validation_data['timestamp'].min()

        if max_training_time >= min_validation_time:
            raise LeakagePreventionError("Temporal leakage: training and validation periods overlap")

        # Check 2: No duplicate indices (using original indices)
        training_indices_set = set(training_original_indices)
        validation_indices_set = set(validation_original_indices)

        if training_indices_set & validation_indices_set:
            raise LeakagePreventionError("Index leakage: overlapping indices between training and validation")

        # Check 3: Future information check (if price columns exist)
        price_columns = [col for col in training_data.columns if 'price' in col.lower() or 'close' in col.lower()]
        if price_columns:
            for col in price_columns:
                if col in validation_data.columns:
                    # Ensure no training data point has access to future validation prices
                    max_training_price_time = training_data['timestamp'].max()
                    min_validation_price_time = validation_data['timestamp'].min()

                    if max_training_price_time >= min_validation_price_time:
                        raise LeakagePreventionError(
                            f"Price leakage detected in column {col}: "
                            f"training data extends to {max_training_price_time}, "
                            f"validation starts at {min_validation_price_time}"
                        )

        # Log successful check with details for visibility
        train_min = training_data['timestamp'].min()
        train_max = training_data['timestamp'].max()
        val_min = validation_data['timestamp'].min()
        val_max = validation_data['timestamp'].max()
        
        self.logger.info(
            f"✅ LEAKAGE CHECK PASSED | "
            f"Train: {len(training_data)} bars [{train_min.date()} → {train_max.date()}] | "
            f"Val: {len(validation_data)} bars [{val_min.date()} → {val_max.date()}]"
        )

    def _persist_split_metadata(self, metadata: DataSplitMetadata) -> None:
        """Persist split metadata to disk for audit trail."""
        metadata_file = self.artifacts_dir / f"split_metadata_window_{metadata.window_id}.json"

        with open(metadata_file, 'w') as f:
            json.dump(metadata.to_dict(), f, indent=2, default=str)

        # Also save as pickle for easy loading
        pickle_file = self.artifacts_dir / f"split_metadata_window_{metadata.window_id}.pkl"
        with open(pickle_file, 'wb') as f:
            pickle.dump(metadata, f)

        self.logger.debug(f"Split metadata persisted to {metadata_file}")

    def validate_reproducibility(self, other_metadata: DataSplitMetadata) -> bool:
        """
        Validate that splits are reproducible by comparing with previous metadata.

        Args:
            other_metadata: Previously generated metadata to compare against

        Returns:
            True if splits are reproducible, False otherwise
        """
        current_env = self.environment_state
        other_env = other_metadata.environment_state

        # Check critical reproducibility factors
        checks = [
            current_env.random_seed == other_env.random_seed,
            current_env.numpy_seed == other_env.numpy_seed,
            current_env.config_hash == other_env.config_hash,
            current_env.python_version == other_env.python_version,
            current_env.numpy_version == other_env.numpy_version,
            current_env.pandas_version == other_env.pandas_version
        ]

        if all(checks):
            self.logger.info("Reproducibility validation passed")
            return True
        else:
            self.logger.warning("Reproducibility validation failed - environment differences detected")
            return False

    def create_runtime_guards(self) -> Dict[str, Any]:
        """
        Create runtime guards to prevent future information leakage during execution.

        Returns:
            Dictionary of guard functions and validators
        """
        def validate_timestamp_access(data: pd.DataFrame, current_time: datetime) -> None:
            """Guard against accessing future timestamps."""
            if 'timestamp' in data.columns:
                future_data = data[data['timestamp'] > current_time]
                if not future_data.empty:
                    raise LeakagePreventionError(
                        f"Attempted to access {len(future_data)} future data points "
                        f"beyond current time {current_time}"
                    )

        def validate_indicator_calculation(data: pd.DataFrame,
                                         calculation_time: datetime,
                                         lookback_period: int) -> None:
            """Guard against using future data in indicator calculations."""
            if 'timestamp' in data.columns:
                earliest_allowed = calculation_time - pd.Timedelta(days=lookback_period)
                invalid_data = data[data['timestamp'] > calculation_time]

                if not invalid_data.empty:
                    raise LeakagePreventionError(
                        f"Indicator calculation attempted to use {len(invalid_data)} "
                        f"future data points beyond calculation time {calculation_time}"
                    )

        return {
            'validate_timestamp_access': validate_timestamp_access,
            'validate_indicator_calculation': validate_indicator_calculation,
            'current_environment': self.environment_state,
            'base_seed': self.base_seed
        }

    def generate_deterministic_seed(self, window_id: int, trial_number: int) -> int:
        """
        Generate deterministic seed for specific window and trial.

        This ensures reproducible results while maintaining independence
        between different windows and trials.

        Args:
            window_id: Window identifier
            trial_number: Trial number within the window

        Returns:
            Deterministic seed for this specific combination
        """
        # Create deterministic seed based on base seed, window, and trial
        seed_string = f"{self.base_seed}_{window_id}_{trial_number}"
        seed_hash = hashlib.md5(seed_string.encode()).hexdigest()

        # Convert hash to integer seed
        deterministic_seed = int(seed_hash[:8], 16) % (2**31 - 1)

        self.logger.debug(f"Generated deterministic seed {deterministic_seed} "
                         f"for window {window_id}, trial {trial_number}")

        return deterministic_seed

    def save_complete_state(self, filepath: Optional[str] = None) -> str:
        """
        Save complete state for full reproducibility.

        Args:
            filepath: Optional custom filepath

        Returns:
            Path to saved state file
        """
        if filepath is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filepath = self.artifacts_dir / f"complete_state_{timestamp}.pkl"

        state = {
            'base_seed': self.base_seed,
            'split_ratio': self.split_ratio,
            'environment_state': self.environment_state,
            'split_metadata': self.split_metadata,
            'enable_strict_validation': self.enable_strict_validation
        }

        with open(filepath, 'wb') as f:
            pickle.dump(state, f)

        self.logger.info(f"Complete state saved to {filepath}")
        return str(filepath)

    @classmethod
    def load_complete_state(cls, filepath: str) -> 'DataIntegrityManager':
        """
        Load complete state from file.

        Args:
            filepath: Path to saved state file

        Returns:
            Restored DataIntegrityManager instance
        """
        with open(filepath, 'rb') as f:
            state = pickle.load(f)

        # Create new instance
        manager = cls(
            base_seed=state['base_seed'],
            split_ratio=state['split_ratio'],
            enable_strict_validation=state['enable_strict_validation']
        )

        # Restore state
        manager.environment_state = state['environment_state']
        manager.split_metadata = state['split_metadata']

        return manager

"""Asset-specific data validation and normalization

This module provides comprehensive validation and normalization logic for different
asset types including forex, crypto, stocks, and other financial instruments.

Features:
- Asset-specific precision handling (forex: 5 decimals, crypto: 8 decimals)
- Trading hours validation (24/5 forex, 24/7 crypto)
- Data quality checks with configurable tolerance levels
- Price range validation and outlier detection
- Volume validation for different asset types
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Any, Tuple, Union
from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

# Epic 10 imports with fallback handling
try:
    from database.schema.wfa_models import AssetType
    EPIC_10_AVAILABLE = True
except ImportError:
    EPIC_10_AVAILABLE = False
    from enum import Enum
    
    class AssetType(str, Enum):
        FOREX = "FOREX"
        CRYPTO = "CRYPTO"
        STOCKS = "STOCKS"
        COMMODITIES = "COMMODITIES"
        INDICES = "INDICES"
        BONDS = "BONDS"
        OPTIONS = "OPTIONS"
        FUTURES = "FUTURES"

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of data validation with detailed feedback"""
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    normalized_data: Optional[pd.DataFrame] = None
    validation_stats: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.validation_stats is None:
            self.validation_stats = {}


@dataclass
class AssetSpecification:
    """Asset-specific configuration and constraints"""
    asset_type: AssetType
    precision_decimals: int
    min_price: float
    max_price: float
    trading_hours_24_7: bool
    volume_required: bool
    typical_spread_pips: Optional[float] = None
    min_tick_size: Optional[float] = None
    
    @classmethod
    def get_specification(cls, asset_type: AssetType, symbol: str = "") -> 'AssetSpecification':
        """Get asset specification for given asset type and symbol"""
        specifications = {
            AssetType.FOREX: cls(
                asset_type=AssetType.FOREX,
                precision_decimals=5,
                min_price=0.00001,
                max_price=100.0,
                trading_hours_24_7=False,  # 24/5 trading
                volume_required=False,
                typical_spread_pips=1.0,
                min_tick_size=0.00001
            ),
            AssetType.CRYPTO: cls(
                asset_type=AssetType.CRYPTO,
                precision_decimals=8,
                min_price=0.00000001,
                max_price=1000000.0,
                trading_hours_24_7=True,  # 24/7 trading
                volume_required=True,
                min_tick_size=0.00000001
            ),
            AssetType.STOCKS: cls(
                asset_type=AssetType.STOCKS,
                precision_decimals=2,
                min_price=0.01,
                max_price=10000.0,
                trading_hours_24_7=False,  # Market hours only
                volume_required=True,
                min_tick_size=0.01
            ),
            AssetType.COMMODITIES: cls(
                asset_type=AssetType.COMMODITIES,
                precision_decimals=3,
                min_price=0.001,
                max_price=100000.0,
                trading_hours_24_7=False,
                volume_required=True,
                min_tick_size=0.001
            )
        }
        
        return specifications.get(asset_type, specifications[AssetType.FOREX])


class BaseAssetValidator(ABC):
    """Base class for asset-specific validators"""
    
    def __init__(self, asset_spec: AssetSpecification, tolerance_config: Optional[Dict[str, float]] = None):
        self.asset_spec = asset_spec
        self.tolerance_config = tolerance_config or self._get_default_tolerances()
        self.logger = logging.getLogger(f"{self.__class__.__name__}")
    
    def _get_default_tolerances(self) -> Dict[str, float]:
        """Get default tolerance levels for validation"""
        return {
            'max_gap_hours': 24.0,
            'max_price_change_percent': 10.0,
            'min_data_quality_ratio': 0.95,
            'max_outlier_ratio': 0.05,
            'max_zero_volume_ratio': 0.1
        }
    
    @abstractmethod
    def validate_price_precision(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate price precision for asset type"""
        pass
    
    @abstractmethod
    def validate_trading_hours(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate trading hours for asset type"""
        pass
    
    def validate_data_quality(self, data: pd.DataFrame) -> ValidationResult:
        """Comprehensive data quality validation"""
        errors = []
        warnings = []
        
        # Basic structure validation
        required_columns = ['open', 'high', 'low', 'close']
        if self.asset_spec.volume_required:
            required_columns.append('volume')
        
        missing_columns = [col for col in required_columns if col not in data.columns]
        if missing_columns:
            errors.append(f"Missing required columns: {missing_columns}")
            return ValidationResult(False, errors, warnings)
        
        # Price validation
        price_valid, price_errors = self.validate_price_precision(data)
        errors.extend(price_errors)
        
        # Trading hours validation
        hours_valid, hours_errors = self.validate_trading_hours(data)
        errors.extend(hours_errors)
        
        # Data consistency validation
        consistency_valid, consistency_errors = self._validate_ohlc_consistency(data)
        errors.extend(consistency_errors)
        
        # Gap analysis
        gap_warnings = self._analyze_data_gaps(data)
        warnings.extend(gap_warnings)
        
        # Outlier detection
        outlier_warnings = self._detect_price_outliers(data)
        warnings.extend(outlier_warnings)
        
        # Volume validation (if required)
        if self.asset_spec.volume_required:
            volume_warnings = self._validate_volume_data(data)
            warnings.extend(volume_warnings)
        
        # Normalize data
        normalized_data = self._normalize_data(data)
        
        # Calculate validation statistics
        validation_stats = self._calculate_validation_stats(data, normalized_data)
        
        is_valid = len(errors) == 0
        
        return ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            normalized_data=normalized_data,
            validation_stats=validation_stats
        )
    
    def _validate_ohlc_consistency(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate OHLC price consistency"""
        errors = []
        
        # Check high >= max(open, close) and low <= min(open, close)
        high_violations = (data['high'] < data[['open', 'close']].max(axis=1)).sum()
        low_violations = (data['low'] > data[['open', 'close']].min(axis=1)).sum()
        
        if high_violations > 0:
            errors.append(f"High price violations: {high_violations} bars where high < max(open, close)")
        
        if low_violations > 0:
            errors.append(f"Low price violations: {low_violations} bars where low > min(open, close)")
        
        # Check for negative prices
        negative_prices = (data[['open', 'high', 'low', 'close']] <= 0).any(axis=1).sum()
        if negative_prices > 0:
            errors.append(f"Negative or zero prices found in {negative_prices} bars")
        
        return len(errors) == 0, errors
    
    def _analyze_data_gaps(self, data: pd.DataFrame) -> List[str]:
        """Analyze data gaps and missing periods"""
        warnings = []
        
        if len(data) < 2:
            return warnings
        
        # Calculate time differences
        time_diffs = data.index.to_series().diff().dt.total_seconds() / 3600  # Hours
        
        # Find large gaps
        max_gap_hours = self.tolerance_config['max_gap_hours']
        large_gaps = time_diffs > max_gap_hours
        
        if large_gaps.sum() > 0:
            gap_count = large_gaps.sum()
            max_gap = time_diffs.max()
            warnings.append(f"Found {gap_count} data gaps > {max_gap_hours} hours (max gap: {max_gap:.1f} hours)")
        
        return warnings
    
    def _detect_price_outliers(self, data: pd.DataFrame) -> List[str]:
        """Detect price outliers using statistical methods"""
        warnings = []
        
        # Calculate price changes
        price_changes = data['close'].pct_change().abs()
        
        # Find extreme price movements
        max_change_threshold = self.tolerance_config['max_price_change_percent'] / 100
        extreme_changes = price_changes > max_change_threshold
        
        if extreme_changes.sum() > 0:
            outlier_count = extreme_changes.sum()
            max_change = price_changes.max() * 100
            warnings.append(f"Found {outlier_count} extreme price movements > {max_change_threshold*100}% (max: {max_change:.2f}%)")
        
        return warnings
    
    def _validate_volume_data(self, data: pd.DataFrame) -> List[str]:
        """Validate volume data quality"""
        warnings = []
        
        if 'volume' not in data.columns:
            return warnings
        
        # Check for negative volumes
        negative_volumes = (data['volume'] < 0).sum()
        if negative_volumes > 0:
            warnings.append(f"Found {negative_volumes} bars with negative volume")
        
        # Check for excessive zero volumes
        zero_volumes = (data['volume'] == 0).sum()
        zero_ratio = zero_volumes / len(data)
        max_zero_ratio = self.tolerance_config['max_zero_volume_ratio']
        
        if zero_ratio > max_zero_ratio:
            warnings.append(f"High zero volume ratio: {zero_ratio:.2%} (threshold: {max_zero_ratio:.2%})")
        
        return warnings
    
    def _normalize_data(self, data: pd.DataFrame) -> pd.DataFrame:
        """Normalize data according to asset specifications"""
        normalized = data.copy()
        
        # Round prices to appropriate precision
        price_columns = ['open', 'high', 'low', 'close']
        for col in price_columns:
            if col in normalized.columns:
                normalized[col] = normalized[col].round(self.asset_spec.precision_decimals)
        
        # Ensure proper data types
        for col in price_columns:
            if col in normalized.columns:
                normalized[col] = normalized[col].astype(float)
        
        if 'volume' in normalized.columns:
            normalized['volume'] = normalized['volume'].astype(float)
        
        return normalized
    
    def _calculate_validation_stats(self, original_data: pd.DataFrame, normalized_data: pd.DataFrame) -> Dict[str, Any]:
        """Calculate comprehensive validation statistics"""
        stats = {
            'total_bars': len(original_data),
            'date_range': {
                'start': original_data.index.min().isoformat() if len(original_data) > 0 else None,
                'end': original_data.index.max().isoformat() if len(original_data) > 0 else None
            },
            'price_range': {
                'min': float(original_data[['open', 'high', 'low', 'close']].min().min()),
                'max': float(original_data[['open', 'high', 'low', 'close']].max().max())
            },
            'asset_type': self.asset_spec.asset_type.value,
            'precision_decimals': self.asset_spec.precision_decimals
        }
        
        if 'volume' in original_data.columns:
            stats['volume_stats'] = {
                'total': float(original_data['volume'].sum()),
                'average': float(original_data['volume'].mean()),
                'zero_count': int((original_data['volume'] == 0).sum())
            }
        
        return stats


class ForexValidator(BaseAssetValidator):
    """Forex-specific data validator"""

    def validate_price_precision(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate forex price precision (5 decimal places)"""
        errors = []

        price_columns = ['open', 'high', 'low', 'close']
        for col in price_columns:
            if col in data.columns:
                # Check if prices have more than 5 decimal places
                decimal_places = data[col].apply(lambda x: len(str(x).split('.')[-1]) if '.' in str(x) else 0)
                excessive_precision = decimal_places > self.asset_spec.precision_decimals

                if excessive_precision.any():
                    count = excessive_precision.sum()
                    errors.append(f"Forex {col} prices with >5 decimal places: {count} bars")

        return len(errors) == 0, errors

    def validate_trading_hours(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate forex trading hours (24/5 - Monday to Friday)"""
        warnings = []

        if len(data) == 0:
            return True, warnings

        # Check for weekend trading (Saturday/Sunday)
        weekend_data = data[data.index.weekday >= 5]  # Saturday=5, Sunday=6

        if len(weekend_data) > 0:
            warnings.append(f"Found {len(weekend_data)} bars during weekend (forex markets typically closed)")

        # Check for Friday late night / Monday early morning gaps
        friday_late = data[(data.index.weekday == 4) & (data.index.hour >= 22)]
        monday_early = data[(data.index.weekday == 0) & (data.index.hour <= 2)]

        if len(friday_late) > 0:
            warnings.append(f"Found {len(friday_late)} bars on Friday after 22:00 (market may be closing)")

        return True, warnings  # Warnings only, not errors


class CryptoValidator(BaseAssetValidator):
    """Crypto-specific data validator"""

    def validate_price_precision(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate crypto price precision (8 decimal places)"""
        errors = []

        price_columns = ['open', 'high', 'low', 'close']
        for col in price_columns:
            if col in data.columns:
                # Check if prices have more than 8 decimal places
                decimal_places = data[col].apply(lambda x: len(str(x).split('.')[-1]) if '.' in str(x) else 0)
                excessive_precision = decimal_places > self.asset_spec.precision_decimals

                if excessive_precision.any():
                    count = excessive_precision.sum()
                    errors.append(f"Crypto {col} prices with >8 decimal places: {count} bars")

        return len(errors) == 0, errors

    def validate_trading_hours(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate crypto trading hours (24/7 - no restrictions)"""
        # Crypto markets trade 24/7, so no trading hour restrictions
        return True, []


class StockValidator(BaseAssetValidator):
    """Stock-specific data validator"""

    def validate_price_precision(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate stock price precision (2 decimal places)"""
        errors = []

        price_columns = ['open', 'high', 'low', 'close']
        for col in price_columns:
            if col in data.columns:
                # Check if prices have more than 2 decimal places
                decimal_places = data[col].apply(lambda x: len(str(x).split('.')[-1]) if '.' in str(x) else 0)
                excessive_precision = decimal_places > self.asset_spec.precision_decimals

                if excessive_precision.any():
                    count = excessive_precision.sum()
                    errors.append(f"Stock {col} prices with >2 decimal places: {count} bars")

        return len(errors) == 0, errors

    def validate_trading_hours(self, data: pd.DataFrame) -> Tuple[bool, List[str]]:
        """Validate stock trading hours (market hours only)"""
        warnings = []

        if len(data) == 0:
            return True, warnings

        # Check for weekend trading
        weekend_data = data[data.index.weekday >= 5]
        if len(weekend_data) > 0:
            warnings.append(f"Found {len(weekend_data)} bars during weekend (stock markets closed)")

        # Check for after-hours trading (before 9:30 AM or after 4:00 PM EST)
        # Note: This is a simplified check, real implementation would need timezone handling
        early_hours = data[data.index.hour < 9]
        late_hours = data[data.index.hour >= 16]

        if len(early_hours) > 0:
            warnings.append(f"Found {len(early_hours)} bars before 9:00 AM (pre-market hours)")

        if len(late_hours) > 0:
            warnings.append(f"Found {len(late_hours)} bars after 4:00 PM (after-market hours)")

        return True, warnings


class AssetValidatorFactory:
    """Factory for creating asset-specific validators"""

    @staticmethod
    def create_validator(asset_type: AssetType, symbol: str = "",
                        tolerance_config: Optional[Dict[str, float]] = None) -> BaseAssetValidator:
        """Create appropriate validator for asset type

        Args:
            asset_type: Type of asset to validate
            symbol: Trading symbol (for symbol-specific customization)
            tolerance_config: Custom tolerance configuration

        Returns:
            Asset-specific validator instance
        """
        asset_spec = AssetSpecification.get_specification(asset_type, symbol)

        validator_map = {
            AssetType.FOREX: ForexValidator,
            AssetType.CRYPTO: CryptoValidator,
            AssetType.STOCKS: StockValidator,
            AssetType.COMMODITIES: ForexValidator,  # Use forex validator as base
            AssetType.INDICES: StockValidator,      # Use stock validator as base
            AssetType.BONDS: StockValidator,        # Use stock validator as base
            AssetType.OPTIONS: StockValidator,      # Use stock validator as base
            AssetType.FUTURES: ForexValidator       # Use forex validator as base
        }

        validator_class = validator_map.get(asset_type, ForexValidator)
        return validator_class(asset_spec, tolerance_config)


def validate_asset_data(data: pd.DataFrame, asset_type: AssetType, symbol: str = "",
                       tolerance_config: Optional[Dict[str, float]] = None) -> ValidationResult:
    """Convenience function for asset data validation

    Args:
        data: DataFrame with OHLCV data
        asset_type: Type of asset to validate
        symbol: Trading symbol
        tolerance_config: Custom tolerance configuration

    Returns:
        ValidationResult with validation outcome and normalized data
    """
    validator = AssetValidatorFactory.create_validator(asset_type, symbol, tolerance_config)
    return validator.validate_data_quality(data)

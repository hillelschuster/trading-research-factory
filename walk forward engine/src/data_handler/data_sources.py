# prop_firm_trading_bot/src/data_handler/data_sources.py

"""
Concrete implementations of data source strategies.

This module provides specific implementations for different data sources
following the strategy pattern for flexible data loading.
"""

import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime
import logging

from src.core.models import OHLCVData, TickData
from src.core.enums import Timeframe
from src.data_handler.interfaces import DataSourceStrategy
from src.exceptions import (
    DataLoadingError, DataValidationError, create_error_context
)
from src.utils.pandas_optimization import load_historical_data_optimized
from src.utils.data_utils import validate_ohlcv_data, clean_ohlcv_data


class CSVDataSource:
    """
    Data source strategy for loading data from CSV files.
    
    This implementation handles local CSV files with OHLCV data,
    providing optimized loading and validation.
    """
    
    def __init__(self, data_directory: str):
        """
        Initialize CSV data source.
        
        Args:
            data_directory: Path to directory containing CSV files
        """
        self.data_directory = Path(data_directory)
        self.logger = logging.getLogger(__name__)
        
        if not self.data_directory.exists():
            raise DataLoadingError(
                f"Data directory does not exist: {data_directory}",
                context=create_error_context(data_directory=str(data_directory))
            )
    
    def load_historical_data(
        self,
        symbol: str,
        timeframe: Timeframe,
        count: Optional[int] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[OHLCVData]:
        """Load historical OHLCV data from CSV file."""
        try:
            # Construct file path
            filename = f"{symbol}_{timeframe.value}.csv"
            file_path = self.data_directory / filename
            
            if not file_path.exists():
                raise DataLoadingError(
                    f"CSV file not found: {file_path}",
                    context=create_error_context(
                        symbol=symbol,
                        timeframe=timeframe.value,
                        file_path=str(file_path)
                    )
                )
            
            # Load data with optimization
            df = load_historical_data_optimized(
                str(file_path),
                required_columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'],
                optimize_dtypes=True
            )
            
            # Validate data
            validation_result = validate_ohlcv_data(df)
            if not validation_result['valid']:
                self.logger.warning(f"Data validation issues: {validation_result['errors']}")
                # Clean data if validation fails
                df = clean_ohlcv_data(df)
            
            # Apply date filters
            if start_date:
                df = df[df.index >= start_date]
            if end_date:
                df = df[df.index <= end_date]
            
            # Apply count limit
            if count:
                df = df.tail(count)
            
            # Convert to OHLCVData objects
            ohlcv_data = []
            for timestamp, row in df.iterrows():
                ohlcv_data.append(OHLCVData(
                    timestamp=timestamp,
                    symbol=symbol,
                    timeframe=timeframe,
                    open=float(row['open']),
                    high=float(row['high']),
                    low=float(row['low']),
                    close=float(row['close']),
                    volume=int(row['volume']) if not pd.isna(row['volume']) else 0
                ))
            
            self.logger.info(f"Loaded {len(ohlcv_data)} records for {symbol} {timeframe.value}")
            return ohlcv_data
            
        except Exception as e:
            if isinstance(e, DataLoadingError):
                raise
            raise DataLoadingError(
                f"Failed to load CSV data for {symbol}",
                context=create_error_context(
                    symbol=symbol,
                    timeframe=timeframe.value,
                    file_path=str(file_path) if 'file_path' in locals() else None
                ),
                cause=e
            ) from e
    
    def get_latest_tick(self, symbol: str) -> Optional[TickData]:
        """Get the latest tick data (not supported for CSV source)."""
        self.logger.warning("Tick data not supported for CSV data source")
        return None
    
    def is_available(self) -> bool:
        """Check if the CSV data source is available."""
        return self.data_directory.exists() and self.data_directory.is_dir()
    
    def get_source_info(self) -> Dict[str, Any]:
        """Get information about the CSV data source."""
        csv_files = list(self.data_directory.glob("*.csv"))
        return {
            "source_type": "CSV",
            "data_directory": str(self.data_directory),
            "available_files": len(csv_files),
            "file_list": [f.name for f in csv_files[:10]]  # First 10 files
        }


class MockAPIDataSource:
    """
    Mock API data source for testing and development.
    
    This implementation generates synthetic market data for testing
    purposes when real API access is not available.
    """
    
    def __init__(self, base_price: float = 1.0, volatility: float = 0.01):
        """
        Initialize mock API data source.
        
        Args:
            base_price: Base price for synthetic data generation
            volatility: Volatility factor for price movements
        """
        self.base_price = base_price
        self.volatility = volatility
        self.logger = logging.getLogger(__name__)
        self.last_prices = {}  # Track last prices for each symbol
    
    def load_historical_data(
        self,
        symbol: str,
        timeframe: Timeframe,
        count: Optional[int] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[OHLCVData]:
        """Generate synthetic historical OHLCV data."""
        try:
            # Default to 1000 bars if count not specified
            if count is None:
                count = 1000
            
            # Generate synthetic data
            np.random.seed(hash(symbol) % 2**32)  # Consistent data for same symbol
            
            # Generate price movements
            returns = np.random.normal(0, self.volatility, count)
            prices = [self.base_price]
            
            for ret in returns:
                new_price = prices[-1] * (1 + ret)
                prices.append(max(new_price, 0.0001))  # Prevent negative prices
            
            prices = prices[1:]  # Remove initial price
            
            # Generate OHLCV data
            ohlcv_data = []
            current_time = start_date or datetime.now()
            
            # Calculate time delta based on timeframe
            time_deltas = {
                Timeframe.M1: pd.Timedelta(minutes=1),
                Timeframe.M5: pd.Timedelta(minutes=5),
                Timeframe.M15: pd.Timedelta(minutes=15),
                Timeframe.H1: pd.Timedelta(hours=1),
                Timeframe.H4: pd.Timedelta(hours=4),
                Timeframe.D1: pd.Timedelta(days=1)
            }
            
            time_delta = time_deltas.get(timeframe, pd.Timedelta(minutes=1))
            
            for i, close_price in enumerate(prices):
                # Generate OHLC from close price
                high_factor = 1 + abs(np.random.normal(0, self.volatility * 0.5))
                low_factor = 1 - abs(np.random.normal(0, self.volatility * 0.5))
                open_factor = 1 + np.random.normal(0, self.volatility * 0.3)
                
                high = close_price * high_factor
                low = close_price * low_factor
                open_price = close_price * open_factor
                
                # Ensure OHLC relationships
                high = max(high, open_price, close_price)
                low = min(low, open_price, close_price)
                
                # Generate volume
                volume = int(np.random.uniform(1000, 10000))
                
                ohlcv_data.append(OHLCVData(
                    timestamp=current_time,
                    symbol=symbol,
                    timeframe=timeframe,
                    open=round(open_price, 5),
                    high=round(high, 5),
                    low=round(low, 5),
                    close=round(close_price, 5),
                    volume=volume
                ))
                
                current_time += time_delta
            
            # Store last price for tick generation
            self.last_prices[symbol] = prices[-1]
            
            self.logger.info(f"Generated {len(ohlcv_data)} synthetic records for {symbol}")
            return ohlcv_data
            
        except Exception as e:
            raise DataLoadingError(
                f"Failed to generate mock data for {symbol}",
                context=create_error_context(
                    symbol=symbol,
                    timeframe=timeframe.value,
                    count=count
                ),
                cause=e
            ) from e
    
    def get_latest_tick(self, symbol: str) -> Optional[TickData]:
        """Generate synthetic tick data."""
        try:
            if symbol not in self.last_prices:
                # Initialize with base price if no history
                self.last_prices[symbol] = self.base_price
            
            # Generate small price movement
            price_change = np.random.normal(0, self.volatility * 0.1)
            new_price = self.last_prices[symbol] * (1 + price_change)
            new_price = max(new_price, 0.0001)  # Prevent negative prices
            
            self.last_prices[symbol] = new_price
            
            return TickData(
                timestamp=datetime.now(),
                symbol=symbol,
                bid=round(new_price * 0.9999, 5),  # Slight bid-ask spread
                ask=round(new_price * 1.0001, 5),
                volume=int(np.random.uniform(1, 100))
            )
            
        except Exception as e:
            self.logger.error(f"Failed to generate tick data for {symbol}: {e}")
            return None
    
    def is_available(self) -> bool:
        """Mock API is always available."""
        return True
    
    def get_source_info(self) -> Dict[str, Any]:
        """Get information about the mock API source."""
        return {
            "source_type": "Mock API",
            "base_price": self.base_price,
            "volatility": self.volatility,
            "tracked_symbols": list(self.last_prices.keys())
        }


class DatabaseDataSource:
    """
    Data source strategy for loading data from database.
    
    This implementation handles database connections and queries
    for historical market data storage and retrieval.
    """
    
    def __init__(self, connection_string: str):
        """
        Initialize database data source.
        
        Args:
            connection_string: Database connection string
        """
        self.connection_string = connection_string
        self.logger = logging.getLogger(__name__)
        self._connection = None
    
    def load_historical_data(
        self,
        symbol: str,
        timeframe: Timeframe,
        count: Optional[int] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[OHLCVData]:
        """Load historical OHLCV data from database."""
        # Placeholder implementation - would require actual database setup
        self.logger.warning("Database data source not fully implemented")
        raise DataLoadingError(
            "Database data source not implemented",
            context=create_error_context(
                symbol=symbol,
                timeframe=timeframe.value
            )
        )
    
    def get_latest_tick(self, symbol: str) -> Optional[TickData]:
        """Get the latest tick data from database."""
        self.logger.warning("Database tick data not implemented")
        return None
    
    def is_available(self) -> bool:
        """Check if database connection is available."""
        # Would implement actual connection check
        return False
    
    def get_source_info(self) -> Dict[str, Any]:
        """Get information about the database source."""
        return {
            "source_type": "Database",
            "connection_string": self.connection_string,
            "status": "Not implemented"
        }


class DataSourceFactory:
    """
    Factory for creating data source instances.

    This factory provides a centralized way to create and configure
    different data source strategies.
    """

    @staticmethod
    def create_data_source(source_type: str, **kwargs) -> DataSourceStrategy:
        """
        Create a data source instance based on type.

        Args:
            source_type: Type of data source ("csv", "mock_api", "database")
            **kwargs: Configuration parameters for the data source

        Returns:
            Configured data source instance

        Raises:
            DataLoadingError: If source type is unknown
        """
        try:
            if source_type.lower() == "csv":
                data_directory = kwargs.get("data_directory", "data")
                return CSVDataSource(data_directory)

            elif source_type.lower() == "mock_api":
                base_price = kwargs.get("base_price", 1.0)
                volatility = kwargs.get("volatility", 0.01)
                return MockAPIDataSource(base_price, volatility)

            elif source_type.lower() == "database":
                connection_string = kwargs.get("connection_string", "")
                return DatabaseDataSource(connection_string)

            else:
                raise DataLoadingError(
                    f"Unknown data source type: {source_type}",
                    context=create_error_context(
                        source_type=source_type,
                        available_types=["csv", "mock_api", "database"]
                    )
                )

        except Exception as e:
            if isinstance(e, DataLoadingError):
                raise
            raise DataLoadingError(
                f"Failed to create data source: {source_type}",
                context=create_error_context(source_type=source_type, kwargs=kwargs),
                cause=e
            ) from e

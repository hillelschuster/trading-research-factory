# prop_firm_trading_bot/src/data_handler/__init__.py

# This file makes 'data_handler' a Python package.
# Export the refactored MarketDataManager class for easier imports
from .market_data_manager import MarketDataManager

# Export other key components
from .interfaces import (
    DataSourceStrategy, DataProcessor, DataCache, DataPipeline
)
from .data_sources import DataSourceFactory
from .processors import IndicatorProcessor, DataCleaningProcessor, ComposableDataPipeline
from .cache import MemoryCache, FileCache

__all__ = [
    'MarketDataManager',
    'DataSourceStrategy',
    'DataProcessor',
    'DataCache',
    'DataPipeline',
    'DataSourceFactory',
    'IndicatorProcessor',
    'DataCleaningProcessor',
    'ComposableDataPipeline',
    'MemoryCache',
    'FileCache'
]

  
  
 
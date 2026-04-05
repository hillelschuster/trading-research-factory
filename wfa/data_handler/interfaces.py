# prop_firm_trading_bot/src/data_handler/interfaces.py

"""
Interface contracts for data operations in the trading bot.

This module defines the abstract interfaces that establish contracts for
data loading, processing, caching, and subscription management components.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any, Protocol, runtime_checkable
import pandas as pd
from datetime import datetime

from src.core.models import OHLCVData, TickData
from src.core.enums import Timeframe
from src.custom_types import Symbol, TimeSeriesData


@runtime_checkable
class DataSourceStrategy(Protocol):
    """
    Strategy interface for different data sources.
    
    This protocol defines the contract that all data source implementations
    must follow, enabling the strategy pattern for data loading.
    """
    
    def load_historical_data(
        self,
        symbol: str,
        timeframe: Timeframe,
        count: Optional[int] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[OHLCVData]:
        """Load historical OHLCV data from the data source."""
        ...
    
    def get_latest_tick(self, symbol: str) -> Optional[TickData]:
        """Get the latest tick data for a symbol."""
        ...
    
    def is_available(self) -> bool:
        """Check if the data source is available and accessible."""
        ...
    
    def get_source_info(self) -> Dict[str, Any]:
        """Get information about the data source."""
        ...


class DataProcessor(ABC):
    """
    Abstract base class for data processing operations.
    
    This class defines the interface for data transformation and
    indicator calculation operations.
    """
    
    @abstractmethod
    def process_data(
        self,
        data: pd.DataFrame,
        processing_config: Dict[str, Any]
    ) -> pd.DataFrame:
        """
        Process raw data according to the provided configuration.
        
        Args:
            data: Raw OHLCV data
            processing_config: Configuration for processing operations
            
        Returns:
            Processed DataFrame with indicators and transformations
        """
        pass
    
    @abstractmethod
    def validate_input(self, data: pd.DataFrame) -> bool:
        """
        Validate input data format and quality.
        
        Args:
            data: DataFrame to validate
            
        Returns:
            True if data is valid, False otherwise
        """
        pass
    
    @abstractmethod
    def get_required_columns(self) -> List[str]:
        """
        Get the list of required columns for processing.
        
        Returns:
            List of required column names
        """
        pass


class DataCache(ABC):
    """
    Abstract base class for data caching operations.
    
    This class defines the interface for storing and retrieving
    processed market data.
    """
    
    @abstractmethod
    def store(
        self,
        key: str,
        data: pd.DataFrame,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Store data in the cache.
        
        Args:
            key: Unique identifier for the data
            data: DataFrame to store
            metadata: Optional metadata about the data
            
        Returns:
            True if storage was successful
        """
        pass
    
    @abstractmethod
    def retrieve(self, key: str) -> Optional[pd.DataFrame]:
        """
        Retrieve data from the cache.
        
        Args:
            key: Unique identifier for the data
            
        Returns:
            DataFrame if found, None otherwise
        """
        pass
    
    @abstractmethod
    def invalidate(self, key: str) -> bool:
        """
        Invalidate cached data.
        
        Args:
            key: Unique identifier for the data to invalidate
            
        Returns:
            True if invalidation was successful
        """
        pass
    
    @abstractmethod
    def clear_all(self) -> bool:
        """
        Clear all cached data.
        
        Returns:
            True if clearing was successful
        """
        pass
    
    @abstractmethod
    def get_cache_info(self) -> Dict[str, Any]:
        """
        Get information about the cache state.
        
        Returns:
            Dictionary with cache statistics and information
        """
        pass


class SubscriptionManager(ABC):
    """
    Abstract base class for managing data subscriptions.
    
    This class defines the interface for managing real-time
    data feed subscriptions.
    """
    
    @abstractmethod
    def subscribe_ticks(
        self,
        symbol: str,
        callback: callable
    ) -> bool:
        """
        Subscribe to tick data for a symbol.
        
        Args:
            symbol: Symbol to subscribe to
            callback: Function to call when new tick data arrives
            
        Returns:
            True if subscription was successful
        """
        pass
    
    @abstractmethod
    def subscribe_bars(
        self,
        symbol: str,
        timeframe: Timeframe,
        callback: callable
    ) -> bool:
        """
        Subscribe to bar data for a symbol and timeframe.
        
        Args:
            symbol: Symbol to subscribe to
            timeframe: Timeframe for bar data
            callback: Function to call when new bar data arrives
            
        Returns:
            True if subscription was successful
        """
        pass
    
    @abstractmethod
    def unsubscribe(self, symbol: str, data_type: str = "all") -> bool:
        """
        Unsubscribe from data feeds for a symbol.
        
        Args:
            symbol: Symbol to unsubscribe from
            data_type: Type of data to unsubscribe from ("ticks", "bars", "all")
            
        Returns:
            True if unsubscription was successful
        """
        pass
    
    @abstractmethod
    def get_active_subscriptions(self) -> Dict[str, List[str]]:
        """
        Get information about active subscriptions.
        
        Returns:
            Dictionary mapping symbols to list of subscription types
        """
        pass


class DataPipeline(ABC):
    """
    Abstract base class for data processing pipelines.
    
    This class defines the interface for composable data
    transformation operations.
    """
    
    @abstractmethod
    def add_stage(self, processor: DataProcessor) -> 'DataPipeline':
        """
        Add a processing stage to the pipeline.
        
        Args:
            processor: Data processor to add
            
        Returns:
            Self for method chaining
        """
        pass
    
    @abstractmethod
    def process(
        self,
        data: pd.DataFrame,
        config: Optional[Dict[str, Any]] = None
    ) -> pd.DataFrame:
        """
        Process data through the entire pipeline.
        
        Args:
            data: Input data to process
            config: Optional configuration for processing
            
        Returns:
            Processed data
        """
        pass
    
    @abstractmethod
    def get_pipeline_info(self) -> Dict[str, Any]:
        """
        Get information about the pipeline configuration.
        
        Returns:
            Dictionary with pipeline stage information
        """
        pass


class ResourceManager(ABC):
    """
    Abstract base class for resource management.
    
    This class defines the interface for managing resources
    like connections, file handles, and memory.
    """
    
    @abstractmethod
    def acquire_resource(self, resource_type: str, **kwargs) -> Any:
        """
        Acquire a resource of the specified type.
        
        Args:
            resource_type: Type of resource to acquire
            **kwargs: Additional parameters for resource acquisition
            
        Returns:
            The acquired resource
        """
        pass
    
    @abstractmethod
    def release_resource(self, resource: Any) -> bool:
        """
        Release a previously acquired resource.
        
        Args:
            resource: Resource to release
            
        Returns:
            True if release was successful
        """
        pass
    
    @abstractmethod
    def cleanup_all(self) -> bool:
        """
        Clean up all managed resources.
        
        Returns:
            True if cleanup was successful
        """
        pass

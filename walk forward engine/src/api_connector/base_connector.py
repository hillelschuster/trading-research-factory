# src/api_connector/base_connector.py
"""Stub base connector - minimal interface for WFA engine compatibility."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class PlatformInterface(ABC):
    """
    Abstract interface for trading platform adapters.
    Stub implementation for WFA engine compatibility.
    """
    
    @abstractmethod
    def connect(self) -> bool:
        """Connect to the trading platform."""
        return True
    
    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect from the trading platform."""
        pass
    
    @abstractmethod
    def get_account_info(self) -> Dict[str, Any]:
        """Get account information."""
        return {}
    
    @abstractmethod
    def get_positions(self) -> List[Any]:
        """Get current open positions."""
        return []
    
    @abstractmethod
    def place_order(self, order_params: Dict[str, Any]) -> Dict[str, Any]:
        """Place a trading order."""
        return {}
    
    @abstractmethod
    def close_position(self, ticket: int) -> bool:
        """Close a position by ticket."""
        return True
    
    @abstractmethod
    def modify_position(self, ticket: int, stop_loss: Optional[float] = None, 
                       take_profit: Optional[float] = None) -> bool:
        """Modify an existing position's SL/TP."""
        return True
    
    @abstractmethod
    def get_market_data(self, symbol: str, timeframe: str, 
                       count: int = 100) -> List[Dict[str, Any]]:
        """Get market data (OHLCV) for a symbol."""
        return []

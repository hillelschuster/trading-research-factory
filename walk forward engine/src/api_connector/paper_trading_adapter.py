# src/api_connector/paper_trading_adapter.py
"""Stub paper trading adapter for WFA backtesting compatibility."""

import logging
from typing import Any, Dict, List, Optional
import pandas as pd

from .base_connector import PlatformInterface


class PaperTradingAdapter(PlatformInterface):
    """
    Paper trading adapter stub for walk-forward analysis.
    Provides a no-op trading interface for backtest mode.
    """
    
    def __init__(
        self,
        config: Any = None,
        logger: Optional[logging.Logger] = None,
        historical_data: pd.DataFrame = None,
        initial_balance: float = 100000.0,
    ):
        self.config = config
        self.logger = logger or logging.getLogger(__name__)
        self.historical_data = historical_data if historical_data is not None and not historical_data.empty else pd.DataFrame()
        self.initial_balance = initial_balance
        self.current_balance = initial_balance
        self.positions: List[Any] = []
        self.orders: List[Dict[str, Any]] = []
        self._connected = True
    
    def connect(self) -> bool:
        self._connected = True
        self.logger.info("PaperTradingAdapter connected")
        return True
    
    def disconnect(self) -> None:
        self._connected = False
        self.logger.info("PaperTradingAdapter disconnected")
    
    def get_account_info(self) -> Dict[str, Any]:
        return {
            "balance": self.current_balance,
            "equity": self.current_balance,
            "margin": 0.0,
            "free_margin": self.current_balance,
            "currency": "USD",
        }
    
    def get_positions(self) -> List[Any]:
        return self.positions
    
    def place_order(self, order_params: Dict[str, Any]) -> Dict[str, Any]:
        order = {
            "ticket": len(self.orders) + 1,
            "symbol": order_params.get("symbol", "UNKNOWN"),
            "type": order_params.get("type", 0),
            "volume": order_params.get("volume", 0.01),
            "price": order_params.get("price", 0),
            "sl": order_params.get("sl", 0),
            "tp": order_params.get("tp", 0),
            "magic": order_params.get("magic", 0),
            "comment": order_params.get("comment", ""),
            "timestamp": order_params.get("timestamp"),
        }
        self.orders.append(order)
        self.logger.debug(f"Paper order placed: {order}")
        return order
    
    def close_position(self, ticket: int) -> bool:
        self.positions = [p for p in self.positions if getattr(p, 'ticket', None) != ticket]
        return True
    
    def modify_position(self, ticket: int, stop_loss: Optional[float] = None,
                       take_profit: Optional[float] = None) -> bool:
        return True
    
    def get_market_data(self, symbol: str, timeframe: str,
                       count: int = 100) -> List[Dict[str, Any]]:
        return []
    
    def reset(self) -> None:
        """Reset paper trading state for new backtest run."""
        self.current_balance = self.initial_balance
        self.positions = []
        self.orders = []

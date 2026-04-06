# prop_firm_trading_bot/src/strategies/base_strategy.py

"""
Refactored Base Strategy with Template Method Pattern and Common Functionality.

This module provides an enhanced base strategy that eliminates code duplication
through template methods, common validation patterns, and shared utilities.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, Tuple, TYPE_CHECKING
import pandas as pd
import numpy as np
import logging
from datetime import datetime

from src.core.enums import StrategySignal, Timeframe, OrderAction
from src.core.models import OHLCVData, TickData, Order, Position, TradeFill, MarketEvent
from src.custom_types import StrategyParameters, Symbol, TimeSeriesData
from src.exceptions import DataError, create_error_context

if TYPE_CHECKING:
    from src.data_handler.market_data_manager import MarketDataManager
    from src.api_connector.base_connector import PlatformInterface
    from src.config_manager import AppConfig


class StrategyValidationMixin:
    """
    Mixin providing common validation functionality for strategies.
    
    Eliminates duplicate validation code across strategy implementations.
    """
    
    def validate_market_data(self, market_data_df: pd.DataFrame, min_length: int) -> bool:
        """
        Validate market data meets minimum requirements.
        
        Args:
            market_data_df: Market data DataFrame
            min_length: Minimum required data length
            
        Returns:
            True if data is valid, False otherwise
        """
        if market_data_df is None or market_data_df.empty:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Market data is None or empty")
            return False
        
        if len(market_data_df) < min_length:
            self.logger.debug(
                f"[{self.symbol}/{self.timeframe.name}] Insufficient data: "
                f"need {min_length}, got {len(market_data_df)}"
            )
            return False
        
        return True
    
    def validate_required_columns(self, market_data_df: pd.DataFrame, required_columns: List[str]) -> bool:
        """
        Validate that all required columns are present in market data.
        
        Args:
            market_data_df: Market data DataFrame
            required_columns: List of required column names
            
        Returns:
            True if all columns present, False otherwise
        """
        missing_columns = [col for col in required_columns if col not in market_data_df.columns]
        
        if missing_columns:
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] Missing required columns: {missing_columns}. "
                f"Available: {market_data_df.columns.tolist()}"
            )
            return False
        
        return True
    
    def validate_indicator_values(self, market_data_df: pd.DataFrame, indicator_columns: List[str]) -> bool:
        """
        Validate that indicator values are not NaN for the last rows.
        
        Args:
            market_data_df: Market data DataFrame
            indicator_columns: List of indicator column names to check
            
        Returns:
            True if all indicators have valid values, False otherwise
        """
        if len(market_data_df) < 2:
            return False
        
        last_row = market_data_df.iloc[-1]
        prev_row = market_data_df.iloc[-2]
        
        for col in indicator_columns:
            if pd.isna(last_row[col]) or pd.isna(prev_row[col]):
                self.logger.debug(
                    f"[{self.symbol}/{self.timeframe.name}] Indicator {col} has NaN values "
                    f"in recent data"
                )
                return False
        
        return True
    
    def validate_tick_data(self, latest_tick: Optional[TickData]) -> bool:
        """
        Validate tick data is available and valid.
        
        Args:
            latest_tick: Latest tick data
            
        Returns:
            True if tick data is valid, False otherwise
        """
        if not latest_tick:
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] No tick data available for price reference"
            )
            return False
        
        if not hasattr(latest_tick, 'bid') or not hasattr(latest_tick, 'ask'):
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] Tick data missing bid/ask prices"
            )
            return False
        
        return True


class StrategyUtilityMixin:
    """
    Mixin providing common utility functions for strategies.
    
    Eliminates duplicate utility code across strategy implementations.
    """
    
    def get_symbol_info(self):
        """
        Get symbol information with error handling.
        
        Returns:
            SymbolInfo object or None if not available
        """
        try:
            symbol_info = self.platform_adapter.get_symbol_info(self.symbol)
            if not symbol_info:
                self.logger.error(
                    f"[{self.symbol}/{self.timeframe.name}] Could not get symbol info"
                )
                return None
            return symbol_info
        except Exception as e:
            self.logger.error(
                f"[{self.symbol}/{self.timeframe.name}] Error getting symbol info: {str(e)}"
            )
            return None
    
    def calculate_pips_from_atr(self, atr_value: float, multiplier: float) -> Optional[float]:
        """
        Calculate pips from ATR value with validation.
        
        Args:
            atr_value: ATR value
            multiplier: ATR multiplier
            
        Returns:
            Pips value or None if calculation fails
        """
        try:
            symbol_info = self.get_symbol_info()
            if not symbol_info:
                return None
            
            point_value = symbol_info.point
            if not isinstance(point_value, (int, float)) or point_value <= 0:
                self.logger.error(
                    f"[{self.symbol}/{self.timeframe.name}] Invalid point value: {point_value}"
                )
                return None
            
            pips = (atr_value * multiplier) / point_value
            return round(pips, 1)
            
        except Exception as e:
            self.logger.error(
                f"[{self.symbol}/{self.timeframe.name}] Error calculating pips from ATR: {str(e)}"
            )
            return None
    
    def round_price_to_digits(self, price: float) -> Optional[float]:
        """
        Round price to appropriate number of digits for the symbol.
        
        Args:
            price: Price to round
            
        Returns:
            Rounded price or None if symbol info not available
        """
        try:
            symbol_info = self.get_symbol_info()
            if not symbol_info:
                return None
            
            return round(price, symbol_info.digits)
            
        except Exception as e:
            self.logger.error(
                f"[{self.symbol}/{self.timeframe.name}] Error rounding price: {str(e)}"
            )
            return None
    
    def get_comparison_price(self, latest_tick: TickData, action: OrderAction) -> float:
        """
        Get appropriate comparison price based on order action.
        
        Args:
            latest_tick: Latest tick data
            action: Order action (BUY/SELL)
            
        Returns:
            Bid price for BUY orders, Ask price for SELL orders
        """
        return latest_tick.bid if action == OrderAction.BUY else latest_tick.ask
    
    def log_timestamp_debug(self, market_data_df: pd.DataFrame, target_timestamp: str = None) -> None:
        """
        Common timestamp debugging functionality.
        
        Args:
            market_data_df: Market data DataFrame
            target_timestamp: Optional target timestamp to watch for
        """
        if market_data_df is None or market_data_df.empty:
            return
        
        # Initialize debug counter
        if not hasattr(self, '_debug_call_count'):
            self._debug_call_count = 0
        self._debug_call_count += 1
        
        # Extract current timestamp
        last_row = market_data_df.iloc[-1]
        current_timestamp = None
        
        try:
            if hasattr(last_row, 'name') and last_row.name is not None:
                current_timestamp = pd.to_datetime(last_row.name)
            elif 'timestamp' in last_row:
                current_timestamp = pd.to_datetime(last_row['timestamp'])
            elif hasattr(market_data_df, 'index') and len(market_data_df.index) > 0:
                current_timestamp = pd.to_datetime(market_data_df.index[-1])
        except Exception as e:
            self.logger.debug(f"Error extracting timestamp: {str(e)}")
            return
        
        # Log periodically
        if self._debug_call_count % 1000 == 0:
            self.logger.info(
                f"[TIMESTAMP DEBUG] Processed {self._debug_call_count} candles. "
                f"Current: {current_timestamp}"
            )
        
        # Check for target timestamp if specified
        if target_timestamp and current_timestamp:
            try:
                target_dt = pd.to_datetime(target_timestamp)
                if current_timestamp == target_dt or target_timestamp in str(current_timestamp):
                    self.logger.critical(
                        f"[TARGET FOUND] === TARGET TIMESTAMP DETECTED: {current_timestamp} ==="
                    )
                    self.logger.critical(f"[TARGET FOUND] DataFrame shape: {market_data_df.shape}")
                    self.logger.critical(
                        f"[TARGET FOUND] Last row data: {market_data_df.iloc[-1].to_dict()}"
                    )
            except Exception as e:
                self.logger.debug(f"Error checking target timestamp: {str(e)}")


class BaseStrategy(ABC, StrategyValidationMixin, StrategyUtilityMixin):
    """
    Refactored base strategy implementing template method pattern.
    
    Eliminates code duplication by providing common functionality
    and standardized signal generation workflow.
    """
    
    def __init__(self,
                 strategy_params: StrategyParameters,
                 config: 'AppConfig',
                 platform_adapter: 'PlatformInterface',
                 market_data_manager: 'MarketDataManager',
                 logger: logging.Logger,
                 asset_profile_key: str) -> None:
        """Initialize refactored base strategy."""
        self.strategy_params = strategy_params
        self.config = config
        self.platform_adapter = platform_adapter
        self.market_data_manager = market_data_manager
        self.logger = logger
        self.asset_profile_key = asset_profile_key
        
        # Common strategy metrics
        self.signal_count = 0
        self.last_signal_time = None
        self.validation_failures = 0
        
        # Initialize strategy-specific parameters (sets symbol/timeframe)
        self._initialize_strategy_parameters()
        self._initialize_indicators()
    
    def _initialize_strategy_parameters(self) -> None:
        """
        Initialize strategy-specific parameters.
        
        Default implementation extracts symbol/timeframe from config.
        Subclasses can override to add custom parameter initialization.
        """
        # Get symbol from asset profile config
        try:
            asset_profile = self.config.asset_strategy_profiles.get(self.asset_profile_key)
            if asset_profile:
                self.symbol = asset_profile.symbol
                # Get timeframe from asset profile or default to M15
                timeframe_str = getattr(asset_profile, 'timeframe', 'M15').upper()
                try:
                    self.timeframe = Timeframe[timeframe_str]
                except KeyError:
                    self.logger.warning(f"Invalid timeframe '{timeframe_str}', defaulting to M15")
                    self.timeframe = Timeframe.M15
            else:
                # Fallback to strategy_params if no asset profile
                self.symbol = self.strategy_params.get('symbol', 'UNKNOWN')
                self.timeframe = self.strategy_params.get('timeframe', Timeframe.M15)
        except Exception as e:
            self.logger.warning(f"Error initializing from config: {e}, using defaults")
            self.symbol = self.strategy_params.get('symbol', 'UNKNOWN')
            self.timeframe = Timeframe.M15
    
    def _initialize_indicators(self) -> None:
        """
        Initialize strategy-specific indicators.
        
        Default implementation does nothing.
        Subclasses can override to set up indicator columns.
        """
        pass

    def generate_signal(self, market_data_df: pd.DataFrame, *args, **kwargs) -> Optional[Dict[str, Any]]:
        """
        Template method for signal generation with common validation.

        Accepts both legacy and new calling conventions for backward compatibility:
        - generate_signal(df, active_position, latest_tick)
        - generate_signal(df, latest_tick, active_position=None)
        - generate_signal(df, active_position=..., latest_tick=...)
        - generate_signal(df, latest_tick=..., active_position=...)
        """
        try:
            # Normalize arguments for backward compatibility
            active_position: Optional[Position] = kwargs.get('active_position')
            latest_tick: Optional[TickData] = kwargs.get('latest_tick')

            if len(args) == 1:
                # Single positional arg after df could be either active_position or latest_tick
                if latest_tick is None and hasattr(args[0], 'bid') and hasattr(args[0], 'ask'):
                    latest_tick = args[0]
                elif active_position is None:
                    active_position = args[0]
            elif len(args) >= 2:
                # Two positionals follow strict order: (active_position, latest_tick)
                active_position = args[0] if active_position is None else active_position
                latest_tick = args[1] if latest_tick is None else latest_tick

            # Step 1: Pre-validation
            if not self._pre_validate(market_data_df, active_position, latest_tick):
                self.validation_failures += 1
                return None

            # Step 2: Strategy-specific signal logic
            signal = self._generate_strategy_signal(market_data_df, active_position, latest_tick)

            if signal:
                # Step 3: Post-process signal
                processed_signal = self._post_process_signal(signal, market_data_df, latest_tick)

                # Step 4: Update metrics
                self._update_signal_metrics(processed_signal)

                return processed_signal

            return None

        except Exception as e:
            self.logger.error(
                f"[{self.symbol}/{self.timeframe.name}] Error in signal generation: {str(e)}",
                exc_info=True
            )
            return None

    def _pre_validate(self, market_data_df: pd.DataFrame, active_position: Optional[Position], latest_tick: Optional[TickData]) -> bool:
        """
        Pre-validation step - common validation logic.

        Args:
            market_data_df: Market data DataFrame
            active_position: Current position
            latest_tick: Latest tick data

        Returns:
            True if validation passes, False otherwise
        """
        # Basic data validation
        min_length = self._get_minimum_data_length()
        if not self.validate_market_data(market_data_df, min_length):
            return False

        # Required columns validation
        required_columns = self._get_required_columns()
        if not self.validate_required_columns(market_data_df, required_columns):
            return False

        # Indicator validation with dynamic column detection
        indicator_columns = self._get_indicator_columns(market_data_df)
        if not self.validate_indicator_values(market_data_df, indicator_columns):
            return False

        # Tick data validation
        if not self.validate_tick_data(latest_tick):
            return False

        return True

    def _post_process_signal(self, signal: Dict[str, Any], market_data_df: pd.DataFrame, latest_tick: TickData) -> Dict[str, Any]:
        """
        Post-process signal with common enhancements.

        Args:
            signal: Raw signal from strategy
            market_data_df: Market data DataFrame
            latest_tick: Latest tick data

        Returns:
            Enhanced signal dictionary
        """
        # Add timestamp
        signal['timestamp'] = datetime.now()
        signal['strategy_name'] = self.__class__.__name__
        signal['symbol'] = self.symbol
        signal['timeframe'] = self.timeframe.name

        # Round prices if specified
        if 'price' in signal and signal['price'] is not None:
            signal['price'] = self.round_price_to_digits(signal['price'])

        # Add confidence score if strategy provides it
        if hasattr(self, 'calculate_confidence'):
            signal['confidence'] = self.calculate_confidence(market_data_df)

        return signal

    def _update_signal_metrics(self, signal: Dict[str, Any]) -> None:
        """Update strategy metrics after signal generation."""
        self.signal_count += 1
        self.last_signal_time = datetime.now()

        self.logger.info(
            f"[{self.symbol}/{self.timeframe.name}] Generated signal #{self.signal_count}: "
            f"{signal.get('signal', 'UNKNOWN')} at {signal.get('timestamp')}"
        )

    @abstractmethod
    def _generate_strategy_signal(self, market_data_df: pd.DataFrame, active_position: Optional[Position], latest_tick: TickData) -> Optional[Dict[str, Any]]:
        """
        Strategy-specific signal generation logic.

        This method must be implemented by concrete strategies to provide
        their specific trading logic.

        Args:
            market_data_df: Validated market data DataFrame
            active_position: Current position (if any)
            latest_tick: Validated latest tick data

        Returns:
            Signal dictionary or None if no signal
        """
        pass

    def _get_minimum_data_length(self) -> int:
        """
        Get minimum required data length for this strategy.
        
        Default: 50 bars. Override in subclass for strategies needing more data.
        """
        return 50

    def _get_required_columns(self) -> List[str]:
        """
        Get list of required columns for this strategy.
        
        Default: standard OHLC columns. Override if strategy needs additional columns.
        """
        return ['open', 'high', 'low', 'close']

    def _get_indicator_columns(self, market_data_df: Optional[pd.DataFrame] = None) -> List[str]:
        """
        Get list of indicator columns to validate.
        
        Default: empty list (no indicator validation).
        Override in subclass if strategy uses specific indicators that must be present.
        """
        return []

    def generate_vectorized_signals(
        self, 
        data: pd.DataFrame, 
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate all entry/exit signals as arrays for vectorized backtesting.
        
        This method enables ultra-fast backtesting using vectorbt (20-100x speedup).
        Strategies that implement this method can use vectorized WFA execution.
        
        Args:
            data: Full OHLCV DataFrame with timestamp column
            params: Strategy parameters (uses self.strategy_params if None)
            
        Returns:
            Dictionary with:
            - 'long_entries': np.ndarray boolean array (True = enter long)
            - 'long_exits': np.ndarray boolean array (True = exit long)
            - 'short_entries': np.ndarray boolean array (True = enter short)
            - 'short_exits': np.ndarray boolean array (True = exit short)
            - 'sl_pct': float, stop-loss as fraction (e.g., 0.02 for 2%)
            - 'tp_pct': float, take-profit as fraction

        Notes:
            - The vectorized engine shifts signals by 1 bar (execute at next open).
            - Using current-bar close/indicator values is OK if you treat the signal as end-of-bar.
            - Indicators must not use future data; shift resampled/high-TF indicators by 1 period.
            
        Raises:
            NotImplementedError: If strategy doesn't support vectorized signals
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support vectorized signal generation. "
            "Implement generate_vectorized_signals() to use vectorized backtesting."
        )
    
    @property
    def supports_vectorized_backtest(self) -> bool:
        """Check if this strategy supports vectorized backtesting."""
        try:
            # Check if generate_vectorized_signals is overridden
            return type(self).generate_vectorized_signals is not BaseStrategy.generate_vectorized_signals
        except Exception:
            return False

    
    def on_order_update(self, order: Order) -> None:
        """
        Callback for order updates.
        
        Args:
            order: Updated order object
        """
        self.logger.info(f"[{self.symbol}/{self.timeframe.name}] Order update: {order.order_id} {order.status.name}")

    def manage_open_position(self, position: Position, latest_bar: Optional[OHLCVData] = None, latest_tick: Optional[TickData] = None) -> Optional[Dict[str, Any]]:

        """
        Optional method for strategies that require active management of open positions,
        such as trailing stops, partial closes, or time-based exits not covered by SL/TP.

        Args:
            position (Position): The current open position object.
            latest_bar (Optional[OHLCVData]): The latest closed bar data for the position's symbol/timeframe.
            latest_tick (Optional[TickData]): The latest tick data for the position's symbol.

        Returns:
            Optional[Dict[str, Any]]: An action dictionary if management is needed, e.g.,
            {
                "signal": StrategySignal.CLOSE_LONG, # or StrategySignal.CLOSE_SHORT
                "position_id": position.position_id,
                "volume_to_close_pct": Optional[float], # Percentage of position to close (e.g., 0.5 for 50%, 1.0 for full)
                "price": Optional[float], # Price for limit close if applicable
                "comment": Optional[str]
            }
            or for SL/TP modification:
            {
                "signal": StrategySignal.MODIFY_SLTP, # A new signal type might be needed if not closing
                "position_id": position.position_id,
                "new_stop_loss": Optional[float],
                "new_take_profit": Optional[float],
                "comment": Optional[str]
            }
            Returns None if no management action is required by the strategy at this moment.
        """
        # Default implementation: no active management beyond initial SL/TP set by RiskController.
        # Subclasses can override this for more complex exit/management logic.
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] BaseStrategy: manage_open_position called for {position.position_id} (default: no action).")
        return None

    def get_strategy_metrics(self) -> Dict[str, Any]:
        """
        Get strategy performance metrics.

        Returns:
            Dictionary with strategy metrics
        """
        return {
            'signal_count': self.signal_count,
            'last_signal_time': self.last_signal_time,
            'validation_failures': self.validation_failures,
            'success_rate': (self.signal_count / (self.signal_count + self.validation_failures)) if (self.signal_count + self.validation_failures) > 0 else 0.0
        }

    def on_trade_fill(self, fill: TradeFill):
        """
        Optional callback for the strategy to react to its own trade fills.

        Args:
            fill: Trade fill information
        """
        self.logger.info(f"[{self.symbol}/{self.timeframe.name}] Strategy received fill: {fill.action.name} {fill.volume} @ {fill.price} for order {fill.order_id}")
        pass

    def on_market_event(self, market_event: MarketEvent):
        """
        Optional callback for the strategy to react to broader market events (e.g., news filtered by NewsFilter).

        Args:
            market_event: Market event containing event type, description, and affected symbols
        """
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Strategy received market event: {market_event.event_type}")
        # Example: A strategy might choose to flatten its position if a certain critical market event occurs.
        # if market_event.event_type == "CRITICAL_NEWS_UNEXPECTED" and self.symbol in market_event.symbols_affected:
        #     self.logger.warning(f"Strategy for {self.symbol} reacting to critical market event: {market_event.description}")
        #     # Logic to signal a close might be triggered here.
        pass

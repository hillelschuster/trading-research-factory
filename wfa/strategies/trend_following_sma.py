# prop_firm_trading_bot/src/strategies/trend_following_sma.py

"""
Trend Following SMA Trading Strategy - Refactored.

This module implements a trend-following strategy based on Simple Moving Average (SMA) crossovers.
Refactored to eliminate code duplication using the template method pattern.
"""

import pandas as pd
import logging
from typing import Dict, Any, Optional, List, TYPE_CHECKING

from src.strategies.base_strategy import BaseStrategy
from src.core.enums import StrategySignal, OrderAction, Timeframe
from src.core.models import OHLCVData, TickData, Order, Position
from src.custom_types import StrategyParameters, Symbol, TimeSeriesData

if TYPE_CHECKING:
    from src.data_handler.market_data_manager import MarketDataManager
    from src.api_connector.base_connector import PlatformInterface
    from src.config_manager import AppConfig


class TrendFollowingSMA(BaseStrategy):
    """
    A trend-following strategy based on Simple Moving Average (SMA) crossovers.
    Trending Market Specialist - optimized for sustained directional movement.
    
    Refactored to use template method pattern and eliminate code duplication.
    """

    def _initialize_strategy_parameters(self) -> None:
        """Initialize strategy-specific parameters."""
        # Extract symbol and timeframe from config
        self.symbol = self.config.asset_strategy_profiles[self.asset_profile_key].symbol
        timeframe_str = self.strategy_params.get("timeframe", "H1").upper()
        try:
            self.timeframe = Timeframe[timeframe_str]
        except KeyError:
            self.logger.error(f"Invalid timeframe string '{timeframe_str}' in strategy_params for {self.asset_profile_key}. Defaulting to H1.")
            self.timeframe = Timeframe.H1
        
        # SMA parameters
        self.fast_sma_period = self.strategy_params.get('fast_sma_period', 10)
        self.slow_sma_period = self.strategy_params.get('slow_sma_period', 20)
        
        # Risk management parameters
        self.use_atr_stops = self.strategy_params.get('atr_period_for_sl') is not None
        self.atr_period = self.strategy_params.get('atr_period_for_sl', 14)
        self.atr_stop_multiplier = self.strategy_params.get('stop_loss_atr_multiplier', 2.0)
        self.atr_target_multiplier = self.strategy_params.get('take_profit_atr_multiplier', 3.0)
        
        # Trailing stop parameters
        self.use_trailing_stop = self.strategy_params.get('trailing_stop_atr_multiplier') is not None
        self.trailing_stop_multiplier = self.strategy_params.get('trailing_stop_atr_multiplier', 1.5)
        
        # Position management
        self.max_position_age_bars = self.strategy_params.get('max_position_age_bars', 96)
        self.position_size = self.strategy_params.get('position_size', 0.01)
        
        self.logger.info(
            f"[{self.symbol}/{self.timeframe.name}] TrendFollowingSMA initialized with "
            f"Fast SMA({self.fast_sma_period}), Slow SMA({self.slow_sma_period}), "
            f"ATR({self.atr_period}), Trailing: {self.use_trailing_stop}"
        )
    
    def _initialize_indicators(self) -> None:
        """Initialize strategy-specific indicators."""
        # Dynamic column names based on actual parameters
        self.fast_sma_column = f'SMA_{self.fast_sma_period}'
        self.slow_sma_column = f'SMA_{self.slow_sma_period}'
        
        if self.use_atr_stops:
            self.atr_column = f'ATR_{self.atr_period}'
        
        self.logger.debug(
            f"[{self.symbol}/{self.timeframe.name}] TrendFollowingSMA: Expecting indicators: "
            f"{self.fast_sma_column}, {self.slow_sma_column}"
        )
    
    def _get_minimum_data_length(self) -> int:
        """Get minimum required data length for this strategy."""
        min_length = max(self.fast_sma_period, self.slow_sma_period)
        if self.use_atr_stops:
            min_length = max(min_length, self.atr_period)
        return min_length + 10
    
    def _get_required_columns(self) -> List[str]:
        """Get list of required columns for this strategy."""
        return ['open', 'high', 'low', 'close']
    
    def _get_indicator_columns(self) -> List[str]:
        """Get list of indicator columns to validate."""
        columns = [
            self.fast_sma_column,
            self.slow_sma_column
        ]
        
        if self.use_atr_stops:
            columns.append(self.atr_column)
        
        return columns
    
    def _generate_strategy_signal(self, market_data_df: pd.DataFrame, active_position: Optional[Position], latest_tick: TickData) -> Optional[Dict[str, Any]]:
        """
        Generate strategy-specific signal using SMA crossover.
        
        Args:
            market_data_df: Validated market data DataFrame
            active_position: Current position (if any)
            latest_tick: Validated latest tick data
            
        Returns:
            Signal dictionary or None if no signal
        """
        try:
            # Get current and previous values
            current_row = market_data_df.iloc[-1]
            prev_row = market_data_df.iloc[-2]
            
            current_fast_sma = current_row[self.fast_sma_column]
            current_slow_sma = current_row[self.slow_sma_column]
            prev_fast_sma = prev_row[self.fast_sma_column]
            prev_slow_sma = prev_row[self.slow_sma_column]
            
            # Handle existing position
            if active_position:
                return self._check_position_management(active_position, market_data_df, latest_tick)
            
            # Check for new entry signals
            return self._check_crossover_signals(
                current_fast_sma, current_slow_sma, prev_fast_sma, prev_slow_sma,
                latest_tick, market_data_df
            )
            
        except Exception as e:
            self.logger.error(
                f"[{self.symbol}/{self.timeframe.name}] Error in strategy signal generation: {str(e)}"
            )
            return None
    
    def _check_position_management(self, active_position: Position, market_data_df: pd.DataFrame, latest_tick: TickData) -> Optional[Dict[str, Any]]:
        """Check position management including trailing stops and age limits."""
        try:
            # Check position age
            if hasattr(active_position, 'open_time') and self.max_position_age_bars:
                position_age = len(market_data_df) - active_position.open_time  # Simplified age calculation
                if position_age >= self.max_position_age_bars:
                    return {
                        'signal': StrategySignal.CLOSE_LONG if active_position.action == OrderAction.BUY else StrategySignal.CLOSE_SHORT,
                        'comment': f'Position age limit reached: {position_age} >= {self.max_position_age_bars} bars'
                    }
            
            # Check trailing stop if enabled
            if self.use_trailing_stop and self.use_atr_stops:
                return self._check_trailing_stop(active_position, market_data_df, latest_tick)
            
            # Check for trend reversal exit
            current_row = market_data_df.iloc[-1]
            prev_row = market_data_df.iloc[-2]
            
            current_fast_sma = current_row[self.fast_sma_column]
            current_slow_sma = current_row[self.slow_sma_column]
            prev_fast_sma = prev_row[self.fast_sma_column]
            prev_slow_sma = prev_row[self.slow_sma_column]
            
            # Exit long on bearish crossover
            if (active_position.action == OrderAction.BUY and
                prev_fast_sma >= prev_slow_sma and current_fast_sma < current_slow_sma):
                return {
                    'signal': StrategySignal.CLOSE_LONG,
                    'comment': 'Bearish SMA crossover - exit long'
                }
            
            # Exit short on bullish crossover
            elif (active_position.action == OrderAction.SELL and
                  prev_fast_sma <= prev_slow_sma and current_fast_sma > current_slow_sma):
                return {
                    'signal': StrategySignal.CLOSE_SHORT,
                    'comment': 'Bullish SMA crossover - exit short'
                }
            
            return None
            
        except Exception as e:
            self.logger.error(
                f"[{self.symbol}/{self.timeframe.name}] Error in position management: {str(e)}"
            )
            return None
    
    def _check_trailing_stop(self, active_position: Position, market_data_df: pd.DataFrame, latest_tick: TickData) -> Optional[Dict[str, Any]]:
        """Check and update trailing stop."""
        try:
            current_atr = market_data_df.iloc[-1][self.atr_column]
            comparison_price = self.get_comparison_price(latest_tick, active_position.action)
            current_sl = getattr(active_position, 'stop_loss', None)
            
            if active_position.action == OrderAction.BUY:
                # Long position: trail stop up
                potential_new_sl = comparison_price - (current_atr * self.trailing_stop_multiplier)
                if current_sl is None or potential_new_sl > current_sl:
                    new_stop_loss = self.round_price_to_digits(potential_new_sl)
                    return {
                        'signal': StrategySignal.MODIFY_SLTP,
                        'position_id': getattr(active_position, 'position_id', None),
                        'new_stop_loss': new_stop_loss,
                        'comment': f'Trailing stop updated to {new_stop_loss}'
                    }
            
            elif active_position.action == OrderAction.SELL:
                # Short position: trail stop down
                potential_new_sl = comparison_price + (current_atr * self.trailing_stop_multiplier)
                if current_sl is None or potential_new_sl < current_sl:
                    new_stop_loss = self.round_price_to_digits(potential_new_sl)
                    return {
                        'signal': StrategySignal.MODIFY_SLTP,
                        'position_id': getattr(active_position, 'position_id', None),
                        'new_stop_loss': new_stop_loss,
                        'comment': f'Trailing stop updated to {new_stop_loss}'
                    }
            
            return None
            
        except Exception as e:
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] Error in trailing stop calculation: {str(e)}"
            )
            return None
    
    def _check_crossover_signals(self, current_fast_sma: float, current_slow_sma: float,
                                prev_fast_sma: float, prev_slow_sma: float,
                                latest_tick: TickData, market_data_df: pd.DataFrame) -> Optional[Dict[str, Any]]:
        """Check for SMA crossover signals."""
        
        # Bullish crossover: Fast SMA crosses above Slow SMA
        if prev_fast_sma <= prev_slow_sma and current_fast_sma > current_slow_sma:
            entry_price = self.get_comparison_price(latest_tick, OrderAction.BUY)
            signal = {
                'signal': StrategySignal.BUY,
                'price': entry_price,
                'volume_pct_of_max': self.position_size,
                'comment': f'Bullish SMA crossover: Fast({current_fast_sma:.5f}) > Slow({current_slow_sma:.5f})'
            }
            
            # Add stop loss and take profit if using ATR
            if self.use_atr_stops:
                self._add_atr_levels(signal, market_data_df, OrderAction.BUY)
            
            return signal
        
        # Bearish crossover: Fast SMA crosses below Slow SMA
        elif prev_fast_sma >= prev_slow_sma and current_fast_sma < current_slow_sma:
            entry_price = self.get_comparison_price(latest_tick, OrderAction.SELL)
            signal = {
                'signal': StrategySignal.SELL,
                'price': entry_price,
                'volume_pct_of_max': self.position_size,
                'comment': f'Bearish SMA crossover: Fast({current_fast_sma:.5f}) < Slow({current_slow_sma:.5f})'
            }
            
            # Add stop loss and take profit if using ATR
            if self.use_atr_stops:
                self._add_atr_levels(signal, market_data_df, OrderAction.SELL)
            
            return signal
        
        return None
    
    def _add_atr_levels(self, signal: Dict[str, Any], market_data_df: pd.DataFrame, action: OrderAction) -> None:
        """Add ATR-based stop loss and take profit levels to signal."""
        try:
            current_atr = market_data_df.iloc[-1][self.atr_column]
            
            # Calculate pips using utility method
            sl_pips = self.calculate_pips_from_atr(current_atr, self.atr_stop_multiplier)
            tp_pips = self.calculate_pips_from_atr(current_atr, self.atr_target_multiplier)
            
            if sl_pips is not None and tp_pips is not None:
                signal['sl_pips'] = sl_pips
                signal['tp_pips'] = tp_pips
                signal['atr'] = current_atr
            
        except Exception as e:
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] Could not calculate ATR levels: {str(e)}"
            )
    
    def calculate_confidence(self, market_data_df: pd.DataFrame) -> float:
        """
        Calculate confidence score for the signal based on trend strength.
        
        Args:
            market_data_df: Market data DataFrame
            
        Returns:
            Confidence score between 0.0 and 1.0
        """
        try:
            # Get recent data for trend analysis
            recent_data = market_data_df.tail(20)  # Last 20 bars
            
            last_fast_sma = recent_data[self.fast_sma_column].iloc[-1]
            last_slow_sma = recent_data[self.slow_sma_column].iloc[-1]
            last_close = recent_data['close'].iloc[-1]
            
            if pd.isna(last_fast_sma) or pd.isna(last_slow_sma) or pd.isna(last_close):
                return 0.5
            
            # 1. SMA separation (trend strength)
            sma_separation = abs(last_fast_sma - last_slow_sma) / last_close
            trend_strength_score = min(sma_separation * 100, 1.0)  # Cap at 1.0
            
            # 2. Momentum persistence (consistent direction)
            sma_diff_series = recent_data[self.fast_sma_column] - recent_data[self.slow_sma_column]
            consistent_direction = (sma_diff_series > 0).sum() if sma_diff_series.iloc[-1] > 0 else (sma_diff_series < 0).sum()
            momentum_score = consistent_direction / len(sma_diff_series)
            
            # 3. Volatility appropriateness (moderate volatility preferred)
            if self.use_atr_stops:
                atr_value = recent_data[self.atr_column].iloc[-1]
                if pd.isna(atr_value):
                    volatility_score = 0.5
                else:
                    atr_percentage = atr_value / last_close
                    # Optimal range: 0.5% - 2.0% daily volatility
                    if 0.005 <= atr_percentage <= 0.02:
                        volatility_score = 1.0
                    elif atr_percentage < 0.005:
                        volatility_score = atr_percentage / 0.005
                    else:
                        volatility_score = max(0.2, 1.0 - (atr_percentage - 0.02) / 0.02)
            else:
                volatility_score = 0.5
            
            # Weighted combination
            confidence = (
                trend_strength_score * 0.4 +
                momentum_score * 0.4 +
                volatility_score * 0.2
            )
            
            return min(1.0, confidence)
            
        except Exception as e:
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] Error calculating confidence: {str(e)}"
            )
            return 0.5

# prop_firm_trading_bot/src/strategies/mean_reversion_rsi.py

"""
Mean Reversion RSI Trading Strategy - Refactored.

This module implements a mean-reversion trading strategy that uses the Relative
Strength Index (RSI) and Bollinger Bands to identify overbought/oversold conditions
with price extreme confirmation for high-probability trade entries.

Refactored to eliminate code duplication using the template method pattern.
"""

# Standard library
import logging
from typing import Dict, Any, Optional, List, TYPE_CHECKING

# Third-party
import pandas as pd

# Local imports
from src.strategies.base_strategy import BaseStrategy
from src.core.enums import StrategySignal, OrderAction, Timeframe
from src.core.models import OHLCVData, TickData, Order, Position
from src.custom_types import StrategyParameters, Symbol, TimeSeriesData

if TYPE_CHECKING:
    from src.data_handler.market_data_manager import MarketDataManager
    from src.api_connector.base_connector import PlatformInterface
    from src.config_manager import AppConfig


class MeanReversionRSI(BaseStrategy):
    """
    A mean-reversion strategy using the Relative Strength Index (RSI) and Bollinger Bands
    to identify overbought/oversold conditions with price extreme confirmation.

    Refactored to use template method pattern and eliminate code duplication.
    """

    def _initialize_strategy_parameters(self) -> None:
        """Initialize strategy-specific parameters."""
        # Extract symbol and timeframe from config
        self.symbol = self.config.asset_strategy_profiles[self.asset_profile_key].symbol

        # Get timeframe from asset profile configuration (not strategy_params)
        asset_profile = self.config.asset_strategy_profiles[self.asset_profile_key]
        timeframe_str = getattr(asset_profile, 'timeframe', 'H1').upper()

        try:
            self.timeframe = Timeframe[timeframe_str]
        except KeyError:
            self.logger.error(f"Invalid timeframe string '{timeframe_str}' in asset profile for {self.asset_profile_key}. Defaulting to H1.")
            self.timeframe = Timeframe.H1

        # RSI parameters
        self.rsi_period = self.strategy_params.get('rsi_period', 14)
        self.rsi_oversold = self.strategy_params.get('rsi_oversold', 30)
        self.rsi_overbought = self.strategy_params.get('rsi_overbought', 70)
        self.rsi_exit_long = self.strategy_params.get('rsi_exit_long', 60)
        self.rsi_exit_short = self.strategy_params.get('rsi_exit_short', 40)

        # Bollinger Bands parameters
        self.bb_period = self.strategy_params.get('bollinger_period', 20)
        self.bb_std_dev = self.strategy_params.get('bollinger_std_dev', 2.0)
        self.use_bollinger_filter = self.strategy_params.get('use_bollinger_filter', True)

        # Trend filter parameters
        self.use_trend_filter = self.strategy_params.get('use_trend_filter', True)
        self.trend_sma_period = self.strategy_params.get('trend_filter_ma_period', 50)

        # Risk management parameters
        self.use_atr_stops = self.strategy_params.get('stop_loss_atr_period') is not None
        self.atr_period = self.strategy_params.get('stop_loss_atr_period', 14)
        self.atr_stop_multiplier = self.strategy_params.get('stop_loss_atr_multiplier', 2.0)
        self.atr_target_multiplier = self.strategy_params.get('take_profit_atr_multiplier', 3.0)

        # Position sizing
        self.position_size = self.strategy_params.get('position_size', 0.01)

        # SMART RAPID-FIRE TRADING FIX: Track last exit bar and RSI value for intelligent prevention
        self.last_exit_bar_timestamp = None
        self.last_exit_rsi = None

        self.logger.info(
            f"[{self.symbol}/{self.timeframe.name}] MeanReversionRSI initialized with "
            f"RSI({self.rsi_period}), BB({self.bb_period}, {self.bb_std_dev}), "
            f"Trend Filter: {self.use_trend_filter}"
        )

    def _initialize_indicators(self) -> None:
        """Initialize strategy-specific indicators."""
        # Set default column names based on initial parameters
        # These will be dynamically resolved during signal generation
        self.rsi_column = f'RSI_{self.rsi_period}'
        self.bb_upper_column = f'BBU_{self.bb_period}_{self.bb_std_dev}'
        self.bb_lower_column = f'BBL_{self.bb_period}_{self.bb_std_dev}'
        self.bb_middle_column = f'BBM_{self.bb_period}_{self.bb_std_dev}'

        if self.use_atr_stops:
            self.atr_column = f'ATR_{self.atr_period}'

        if self.use_trend_filter:
            self.trend_sma_column = f'SMA_{self.trend_sma_period}'

        self.logger.debug(
            f"[{self.symbol}/{self.timeframe.name}] MeanReversionRSI: Default indicators: "
            f"{self.rsi_column}, {self.bb_upper_column}, {self.bb_lower_column}"
        )

    def _detect_dynamic_parameters_from_columns(self, market_data_df: pd.DataFrame) -> Dict[str, Any]:
        """
        Detect the actual parameters used for indicator calculation by analyzing available columns.
        This is critical for Walk-Forward optimization where trial parameters differ from initialization.

        Args:
            market_data_df: DataFrame containing market data with indicators

        Returns:
            Dictionary containing detected parameters
        """
        detected_params = {}
        available_columns = list(market_data_df.columns)

        # Detect RSI period
        rsi_columns = [col for col in available_columns if col.startswith('RSI_')]
        if rsi_columns:
            # Extract period from column name like 'RSI_12'
            rsi_period = int(rsi_columns[0].split('_')[1])
            detected_params['rsi_period'] = rsi_period
        else:
            detected_params['rsi_period'] = self.rsi_period

        # Detect Bollinger Bands parameters
        bb_upper_columns = [col for col in available_columns if col.startswith('BB_Upper_')]
        if bb_upper_columns:
            # Extract period from column name like 'BB_Upper_20'
            parts = bb_upper_columns[0].split('_')
            bb_period = int(parts[2])  # BB_Upper_20 -> parts[2] = '20'
            # For standard BB columns, assume std_dev = 2.0 (standard default)
            detected_params['bollinger_period'] = bb_period
            detected_params['bollinger_std_dev'] = 2.0  # Standard default
        else:
            # Fallback: check for BBU_ pattern (legacy naming)
            bb_upper_columns_legacy = [col for col in available_columns if col.startswith('BBU_')]
            if bb_upper_columns_legacy:
                parts = bb_upper_columns_legacy[0].split('_')
                bb_period = int(parts[1])
                bb_std_dev = float(parts[2])
                detected_params['bollinger_period'] = bb_period
                detected_params['bollinger_std_dev'] = bb_std_dev
            else:
                detected_params['bollinger_period'] = self.bb_period
                detected_params['bollinger_std_dev'] = self.bb_std_dev

        # Detect trend SMA period if trend filter is enabled
        if self.use_trend_filter:
            sma_columns = [col for col in available_columns if col.startswith('SMA_')]
            if sma_columns:
                sma_period = int(sma_columns[0].split('_')[1])
                detected_params['trend_sma_period'] = sma_period
            else:
                detected_params['trend_sma_period'] = self.trend_sma_period

        # Detect ATR period if ATR stops are enabled
        if self.use_atr_stops:
            atr_columns = [col for col in available_columns if col.startswith('ATR_')]
            if atr_columns:
                atr_period = int(atr_columns[0].split('_')[1])
                detected_params['atr_period'] = atr_period
            else:
                detected_params['atr_period'] = self.atr_period
        else:
            detected_params['atr_period'] = self.atr_period

        return detected_params

    def _get_dynamic_column_names(self, market_data_df: pd.DataFrame) -> Dict[str, str]:
        """
        Get dynamic column names based on actual parameters used for indicator calculation.
        This ensures column names match the indicators calculated during optimization trials.

        Args:
            market_data_df: DataFrame containing market data with indicators

        Returns:
            Dictionary mapping indicator types to actual column names
        """
        params = self._detect_dynamic_parameters_from_columns(market_data_df)

        # Check which Bollinger Band naming convention is used
        available_columns = list(market_data_df.columns)
        bb_upper_standard = [col for col in available_columns if col.startswith('BB_Upper_')]
        bb_upper_legacy = [col for col in available_columns if col.startswith('BBU_')]

        if bb_upper_standard:
            # Use standard naming: BB_Upper_20, BB_Lower_20, BB_Middle_20
            column_names = {
                'rsi': f"RSI_{params['rsi_period']}",
                'bb_upper': f"BB_Upper_{params['bollinger_period']}",
                'bb_lower': f"BB_Lower_{params['bollinger_period']}",
                'bb_middle': f"BB_Middle_{params['bollinger_period']}"
            }
        else:
            # Use legacy naming: BBU_20_2.0, BBL_20_2.0, BBM_20_2.0
            column_names = {
                'rsi': f"RSI_{params['rsi_period']}",
                'bb_upper': f"BBU_{params['bollinger_period']}_{params['bollinger_std_dev']}",
                'bb_lower': f"BBL_{params['bollinger_period']}_{params['bollinger_std_dev']}",
                'bb_middle': f"BBM_{params['bollinger_period']}_{params['bollinger_std_dev']}"
            }

        # Add optional indicators (only if they exist in the data)
        if self.use_trend_filter:
            trend_column = f"SMA_{params['trend_sma_period']}"
            if trend_column in available_columns:
                column_names['trend_sma'] = trend_column
            else:
                self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] Trend SMA column {trend_column} not found in data. Trend filter will be disabled for this backtest.")

        if self.use_atr_stops:
            atr_column = f"ATR_{params['atr_period']}"
            if atr_column in available_columns:
                column_names['atr'] = atr_column
            else:
                self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] ATR column {atr_column} not found in data. ATR stops will be disabled for this backtest.")

        return column_names

    def _get_minimum_data_length(self) -> int:
        """Get minimum required data length for this strategy."""
        min_length = max(self.rsi_period, self.bb_period)
        if self.use_trend_filter:
            min_length = max(min_length, self.trend_sma_period)
        if self.use_atr_stops:
            min_length = max(min_length, self.atr_period)
        return min_length + 10

    def _get_required_columns(self) -> List[str]:
        """Get list of required columns for this strategy."""
        return ['open', 'high', 'low', 'close']

    def _get_indicator_columns(self, market_data_df: Optional[pd.DataFrame] = None) -> List[str]:
        """
        Get list of indicator columns to validate.

        Args:
            market_data_df: Optional DataFrame to detect dynamic column names from.
                          If None, uses default column names.

        Returns:
            List of indicator column names to validate
        """
        if market_data_df is not None:
            # Use dynamic column names based on actual data
            dynamic_columns = self._get_dynamic_column_names(market_data_df)

            columns = [
                dynamic_columns['rsi'],
                dynamic_columns['bb_upper'],
                dynamic_columns['bb_lower']
            ]

            # Only add optional indicators if they exist in the dynamic columns
            if self.use_atr_stops and 'atr' in dynamic_columns:
                columns.append(dynamic_columns['atr'])

            if self.use_trend_filter and 'trend_sma' in dynamic_columns:
                columns.append(dynamic_columns['trend_sma'])
        else:
            # Fallback to default column names
            columns = [
                self.rsi_column,
                self.bb_upper_column,
                self.bb_lower_column
            ]

            if self.use_atr_stops:
                columns.append(self.atr_column)

            if self.use_trend_filter:
                columns.append(self.trend_sma_column)

        return columns

    def _generate_strategy_signal(self, market_data_df: pd.DataFrame, active_position: Optional[Position], latest_tick: TickData) -> Optional[Dict[str, Any]]:
        """
        Generate strategy-specific signal using RSI and Bollinger Bands.

        Args:
            market_data_df: Validated market data DataFrame
            active_position: Current position (if any)
            latest_tick: Validated latest tick data

        Returns:
            Signal dictionary or None if no signal
        """
        try:
            # Get dynamic column names based on actual data
            dynamic_columns = self._get_dynamic_column_names(market_data_df)

            # Get current and previous values
            current_row = market_data_df.iloc[-1]
            prev_row = market_data_df.iloc[-2]

            # === COMPREHENSIVE DEBUG LOGGING: DATA INSPECTION ===
            current_timestamp = current_row.name if hasattr(current_row, 'name') else 'Unknown'
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ================================================================================")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === SIGNAL GENERATION DIAGNOSTICS START ===")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Timestamp: {current_timestamp}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] DataFrame shape: {market_data_df.shape}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Available columns: {list(market_data_df.columns)}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Dynamic indicator columns: RSI={dynamic_columns['rsi']}, BBU={dynamic_columns['bb_upper']}, BBL={dynamic_columns['bb_lower']}")

            # Log current bar OHLCV data
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Current Bar OHLCV:")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Open:  {current_row.get('open', 'N/A'):.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   High:  {current_row.get('high', 'N/A'):.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Low:   {current_row.get('low', 'N/A'):.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Close: {current_row.get('close', 'N/A'):.5f}")

            # Log strategy parameters being used
            current_params = self._get_current_strategy_parameters()
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Strategy Parameters:")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Oversold:     {current_params.get('rsi_oversold', self.rsi_oversold)}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Overbought:   {current_params.get('rsi_overbought', self.rsi_overbought)}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Exit Long:    {current_params.get('rsi_exit_long', self.rsi_exit_long)}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Exit Short:   {current_params.get('rsi_exit_short', self.rsi_exit_short)}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Bollinger Filter: {current_params.get('use_bollinger_filter', self.use_bollinger_filter)}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Trend Filter:     {current_params.get('use_trend_filter', self.use_trend_filter)}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Position Size:    {current_params.get('position_size', self.position_size)}")

            # === COMPREHENSIVE INDICATOR VALUE EXTRACTION AND LOGGING ===
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === INDICATOR VALUES ===")

            # Extract and validate RSI values
            try:
                current_rsi = current_row[dynamic_columns['rsi']]
                prev_rsi = prev_row[dynamic_columns['rsi']]
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] RSI Values:")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Current RSI ({dynamic_columns['rsi']}): {current_rsi:.2f}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Previous RSI ({dynamic_columns['rsi']}): {prev_rsi:.2f}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Change: {current_rsi - prev_rsi:.2f}")
            except KeyError as e:
                self.logger.error(f"[{self.symbol}/{self.timeframe.name}] CRITICAL: RSI column not found: {e}")
                self.logger.error(f"[{self.symbol}/{self.timeframe.name}] Available columns: {list(market_data_df.columns)}")
                return None
            except Exception as e:
                self.logger.error(f"[{self.symbol}/{self.timeframe.name}] Error accessing RSI: {e}")
                return None

            current_close = current_row['close']

            # Extract and validate Bollinger Band values

            try:
                bb_upper = current_row[dynamic_columns['bb_upper']]
                bb_lower = current_row[dynamic_columns['bb_lower']]
                bb_middle = current_row.get(dynamic_columns.get('bb_middle', 'BB_Middle_20'), None)

                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Bollinger Bands:")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Upper ({dynamic_columns['bb_upper']}):  {bb_upper:.5f}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Lower ({dynamic_columns['bb_lower']}):  {bb_lower:.5f}")
                if bb_middle is not None:
                    self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Middle: {bb_middle:.5f}")

                # Calculate price position relative to Bollinger Bands
                bb_range = bb_upper - bb_lower
                price_vs_upper = current_close - bb_upper
                price_vs_lower = current_close - bb_lower

                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Price vs Bollinger Bands:")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Close Price: {current_close:.5f}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Distance to Upper: {price_vs_upper:.5f} ({'Above' if price_vs_upper > 0 else 'Below'})")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Distance to Lower: {price_vs_lower:.5f} ({'Above' if price_vs_lower > 0 else 'Below'})")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   BB Range: {bb_range:.5f}")

            except KeyError as e:
                self.logger.error(f"[{self.symbol}/{self.timeframe.name}] CRITICAL: Bollinger Band column not found: {e}")
                self.logger.error(f"[{self.symbol}/{self.timeframe.name}] Available columns: {list(market_data_df.columns)}")

                # Enhanced fallback mechanism - attempt alternative column patterns
                self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] Attempting fallback column detection...")
                bb_upper, bb_lower, bb_middle = self._attempt_bb_fallback_extraction(market_data_df, current_row)

                if bb_upper is None or bb_lower is None:
                    self.logger.error(f"[{self.symbol}/{self.timeframe.name}] Fallback extraction failed - cannot proceed")
                    return None
                else:
                    self.logger.info(f"[{self.symbol}/{self.timeframe.name}] Fallback extraction successful")
                    # Calculate price position relative to Bollinger Bands using fallback values
                    bb_range = bb_upper - bb_lower
                    price_vs_upper = current_close - bb_upper
                    price_vs_lower = current_close - bb_lower
            except Exception as e:
                self.logger.error(f"[{self.symbol}/{self.timeframe.name}] Error accessing Bollinger Bands: {e}")
                return None

            # === COMPREHENSIVE TREND FILTER ANALYSIS ===
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === TREND FILTER ANALYSIS ===")
            if self.use_trend_filter:
                try:
                    if 'trend_sma' in dynamic_columns:
                        trend_sma = current_row[dynamic_columns['trend_sma']]
                        bullish_trend = current_close > trend_sma
                        bearish_trend = current_close < trend_sma
                        trend_distance = current_close - trend_sma

                        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Trend Filter ENABLED:")
                        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   SMA ({dynamic_columns['trend_sma']}): {trend_sma:.5f}")
                        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Close Price: {current_close:.5f}")
                        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Distance from SMA: {trend_distance:.5f}")
                        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Bullish Trend: {bullish_trend}")
                        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Bearish Trend: {bearish_trend}")
                    else:
                        self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] Trend filter enabled but SMA column not found in dynamic columns!")
                        bullish_trend = bearish_trend = True
                        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Defaulting to: All trends allowed")
                except KeyError as e:
                    self.logger.error(f"[{self.symbol}/{self.timeframe.name}] CRITICAL: Trend SMA column not found: {e}")

                    # Attempt fallback trend SMA extraction
                    self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] Attempting trend SMA fallback...")
                    trend_sma = self._attempt_trend_sma_fallback(market_data_df, current_row)

                    if trend_sma is not None:
                        bullish_trend = current_close > trend_sma
                        bearish_trend = current_close < trend_sma
                        self.logger.info(f"[{self.symbol}/{self.timeframe.name}] Trend SMA fallback successful: {trend_sma:.5f}")
                    else:
                        self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] Trend SMA fallback failed - disabling trend filter")
                        bullish_trend = bearish_trend = True
                except Exception as e:
                    self.logger.error(f"[{self.symbol}/{self.timeframe.name}] Error accessing trend SMA: {e}")
                    return None
            else:
                bullish_trend = bearish_trend = True
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Trend Filter DISABLED - All trends allowed")

            # === COMPREHENSIVE DATA VALIDATION ===

            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === DATA VALIDATION ===")

            # RSI validation
            if pd.isna(current_rsi) or pd.isna(prev_rsi):
                self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] VALIDATION FAIL [RSI_NaN]: Current={current_rsi}, Previous={prev_rsi}")
                return None
            else:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] VALIDATION PASS [RSI]: Current={current_rsi:.2f}, Previous={prev_rsi:.2f}")

            # Bollinger Bands validation
            if pd.isna(bb_upper) or pd.isna(bb_lower):
                self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] VALIDATION FAIL [BB_NaN]: Upper={bb_upper}, Lower={bb_lower}")
                return None
            else:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] VALIDATION PASS [BB]: Upper={bb_upper:.5f}, Lower={bb_lower:.5f}")

            # Price validation
            if pd.isna(current_close):
                self.logger.warning(f"[{self.symbol}/{self.timeframe.name}] VALIDATION FAIL [Price_NaN]: Close={current_close}")
                return None
            else:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] VALIDATION PASS [Price]: Close={current_close:.5f}")

            # === POSITION MANAGEMENT ===
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === POSITION MANAGEMENT ===")
            if active_position:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ACTIVE POSITION DETECTED:")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Position ID: {active_position.position_id}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Action: {active_position.action}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Entry Price: {getattr(active_position, 'entry_price', 'N/A')}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Volume: {getattr(active_position, 'volume', 'N/A')}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Checking exit conditions...")

                exit_signal = self._check_exit_conditions(current_rsi, active_position, market_data_df)
                if exit_signal:
                    self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] EXIT SIGNAL GENERATED: {exit_signal}")
                else:
                    self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] No exit conditions met - holding position")

                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === SIGNAL GENERATION DIAGNOSTICS END ===")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ================================================================================")
                return exit_signal

            # === NEW ENTRY SIGNAL ANALYSIS ===
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] NO ACTIVE POSITION - Analyzing entry conditions...")

            # SMART RAPID-FIRE TRADING FIX: Prevent re-entry when market conditions haven't changed significantly
            current_bar_timestamp = market_data_df.index[-1]
            rsi_change_threshold = 5.0  # RSI must move 5+ points to allow re-entry

            if (self.last_exit_bar_timestamp is not None and
                current_bar_timestamp == self.last_exit_bar_timestamp and
                self.last_exit_rsi is not None and
                abs(current_rsi - self.last_exit_rsi) < rsi_change_threshold):

                rsi_change = abs(current_rsi - self.last_exit_rsi)
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ⏸️  SMART ENTRY BLOCKED: Same bar re-entry with insufficient RSI change")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Current RSI: {current_rsi:.2f}, Exit RSI: {self.last_exit_rsi:.2f}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Change: {rsi_change:.2f} < Threshold: {rsi_change_threshold}")
                return None

            signal = self._check_entry_conditions(
                current_rsi, prev_rsi, current_close, bb_upper, bb_lower,
                bullish_trend, bearish_trend, latest_tick, market_data_df
            )

            # === FINAL SIGNAL DECISION ===
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === FINAL SIGNAL DECISION ===")
            if signal:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ✅ SIGNAL GENERATED: {signal['signal']}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Signal Details:")
                for key, value in signal.items():
                    self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   {key}: {value}")
            else:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ❌ NO SIGNAL GENERATED - All entry conditions failed")

            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === SIGNAL GENERATION DIAGNOSTICS END ===")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ================================================================================")
            return signal

        except Exception as e:
            self.logger.error(
                f"[{self.symbol}/{self.timeframe.name}] Error in strategy signal generation: {str(e)}"
            )
            return None

    def _check_exit_conditions(self, current_rsi: float, active_position: Position, market_data_df: pd.DataFrame) -> Optional[Dict[str, Any]]:
        """Check exit conditions for existing position with comprehensive diagnostics."""
        # Get current dynamic parameters
        current_params = self._get_current_strategy_parameters()
        rsi_exit_long = current_params.get('rsi_exit_long', self.rsi_exit_long)
        rsi_exit_short = current_params.get('rsi_exit_short', self.rsi_exit_short)

        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === EXIT CONDITIONS ANALYSIS ===")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Position Details:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Action: {active_position.action}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Current RSI: {current_rsi:.2f}")

        if active_position.action == OrderAction.BUY:
            # Exit long position when RSI moves back above exit threshold
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] LONG POSITION EXIT CHECK:")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Exit Threshold: {rsi_exit_long}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Test: {current_rsi:.2f} >= {rsi_exit_long}")

            if current_rsi >= rsi_exit_long:
                # SMART RAPID-FIRE TRADING FIX: Record exit bar timestamp AND RSI value
                current_bar_timestamp = market_data_df.index[-1]
                self.last_exit_bar_timestamp = current_bar_timestamp
                self.last_exit_rsi = current_rsi

                exit_signal = {
                    'signal': StrategySignal.CLOSE_LONG,
                    'position_id': active_position.position_id,
                    'comment': f'RSI exit long: {current_rsi:.2f} >= {rsi_exit_long}',
                    'rsi': current_rsi
                }
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: ✅ EXIT CONDITION MET - Closing long position {active_position.position_id}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Exit bar recorded: {current_bar_timestamp}, RSI: {current_rsi:.2f}")
                return exit_signal
            else:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: ❌ EXIT CONDITION NOT MET - Holding long position")

        elif active_position.action == OrderAction.SELL:
            # Exit short position when RSI moves back below exit threshold
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] SHORT POSITION EXIT CHECK:")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Exit Threshold: {rsi_exit_short}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Test: {current_rsi:.2f} <= {rsi_exit_short}")

            if current_rsi <= rsi_exit_short:
                # SMART RAPID-FIRE TRADING FIX: Record exit bar timestamp AND RSI value
                current_bar_timestamp = market_data_df.index[-1]
                self.last_exit_bar_timestamp = current_bar_timestamp
                self.last_exit_rsi = current_rsi

                exit_signal = {
                    'signal': StrategySignal.CLOSE_SHORT,
                    'position_id': active_position.position_id,
                    'comment': f'RSI exit short: {current_rsi:.2f} <= {rsi_exit_short}',
                    'rsi': current_rsi
                }
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: ✅ EXIT CONDITION MET - Closing short position {active_position.position_id}")
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Exit bar recorded: {current_bar_timestamp}, RSI: {current_rsi:.2f}")
                return exit_signal
            else:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: ❌ EXIT CONDITION NOT MET - Holding short position")

        return None

    def _check_entry_conditions(self, current_rsi: float, prev_rsi: float, current_close: float,
                               bb_upper: float, bb_lower: float, bullish_trend: bool, bearish_trend: bool,
                               latest_tick: TickData, market_data_df: pd.DataFrame) -> Optional[Dict[str, Any]]:
        """Check entry conditions for new positions."""

        # Get current dynamic parameters from configuration
        current_params = self._get_current_strategy_parameters()

        # Extract dynamic parameter values
        rsi_oversold = current_params.get('rsi_oversold', self.rsi_oversold)
        rsi_overbought = current_params.get('rsi_overbought', self.rsi_overbought)
        use_bollinger_filter = current_params.get('use_bollinger_filter', self.use_bollinger_filter)
        use_trend_filter = current_params.get('use_trend_filter', self.use_trend_filter)
        position_size = current_params.get('position_size', self.position_size)

        # === COMPREHENSIVE ENTRY CONDITIONS ANALYSIS ===
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ================================================================================")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === DETAILED ENTRY CONDITIONS ANALYSIS ===")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Current Strategy Parameters:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Oversold Threshold:   {rsi_oversold}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Overbought Threshold: {rsi_overbought}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Bollinger Filter Enabled: {use_bollinger_filter}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Trend Filter Enabled:     {use_trend_filter}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Position Size:            {position_size}")

        # === LONG ENTRY CONDITIONS DETAILED ANALYSIS ===
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === LONG ENTRY CONDITIONS ===")

        # Condition 1: RSI Oversold
        rsi_oversold_condition = current_rsi <= rsi_oversold
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] CONDITION 1 [RSI Oversold]:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Current RSI: {current_rsi:.2f}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Threshold:   {rsi_oversold}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Test: {current_rsi:.2f} <= {rsi_oversold}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: {'✅ PASS' if rsi_oversold_condition else '❌ FAIL'}")

        # Condition 2: Bollinger Band Position
        price_at_bb_lower = current_close <= bb_lower if use_bollinger_filter else True
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] CONDITION 2 [Bollinger Band Position]:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter Enabled: {use_bollinger_filter}")
        if use_bollinger_filter:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Close Price:    {current_close:.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   BB Lower:       {bb_lower:.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Distance:       {current_close - bb_lower:.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Test: {current_close:.5f} <= {bb_lower:.5f}")
        else:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter disabled - automatically passes")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: {'✅ PASS' if price_at_bb_lower else '❌ FAIL'}")

        # Condition 3: Trend Filter
        trend_condition_long = bullish_trend if use_trend_filter else True
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] CONDITION 3 [Trend Filter - Long]:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter Enabled: {use_trend_filter}")
        if use_trend_filter:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Bullish Trend:  {bullish_trend}")
        else:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter disabled - automatically passes")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: {'✅ PASS' if trend_condition_long else '❌ FAIL'}")

        # Overall Long Entry Decision
        long_entry_valid = rsi_oversold_condition and price_at_bb_lower and trend_condition_long
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] LONG ENTRY OVERALL DECISION:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Oversold:     {'✅' if rsi_oversold_condition else '❌'}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   BB Position:      {'✅' if price_at_bb_lower else '❌'}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Trend:            {'✅' if trend_condition_long else '❌'}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   FINAL RESULT:     {'✅ LONG ENTRY VALID' if long_entry_valid else '❌ LONG ENTRY INVALID'}")

        # Long entry: RSI is oversold AND (optional: price at/below lower BB) AND (optional: bullish trend)
        if long_entry_valid:

            entry_price = self.get_comparison_price(latest_tick, OrderAction.BUY)
            signal = {
                'signal': StrategySignal.BUY,
                'price': entry_price,
                'volume_pct_of_max': position_size,
                'comment': f'RSI oversold entry: RSI={current_rsi:.2f} <= {rsi_oversold}',
                'rsi': current_rsi,
                'bb_position': 'lower'
            }

            # Add stop loss and take profit if using ATR
            if self.use_atr_stops:
                self._add_atr_levels(signal, market_data_df, OrderAction.BUY)

            return signal

        # === SHORT ENTRY CONDITIONS DETAILED ANALYSIS ===
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === SHORT ENTRY CONDITIONS ===")

        # Condition 1: RSI Overbought
        rsi_overbought_condition = current_rsi >= rsi_overbought
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] CONDITION 1 [RSI Overbought]:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Current RSI: {current_rsi:.2f}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Threshold:   {rsi_overbought}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Test: {current_rsi:.2f} >= {rsi_overbought}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: {'✅ PASS' if rsi_overbought_condition else '❌ FAIL'}")

        # Condition 2: Bollinger Band Position
        price_at_bb_upper = current_close >= bb_upper if use_bollinger_filter else True
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] CONDITION 2 [Bollinger Band Position]:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter Enabled: {use_bollinger_filter}")
        if use_bollinger_filter:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Close Price:    {current_close:.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   BB Upper:       {bb_upper:.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Distance:       {current_close - bb_upper:.5f}")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Test: {current_close:.5f} >= {bb_upper:.5f}")
        else:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter disabled - automatically passes")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: {'✅ PASS' if price_at_bb_upper else '❌ FAIL'}")

        # Condition 3: Trend Filter
        trend_condition_short = bearish_trend if use_trend_filter else True
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] CONDITION 3 [Trend Filter - Short]:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter Enabled: {use_trend_filter}")
        if use_trend_filter:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Bearish Trend:  {bearish_trend}")
        else:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Filter disabled - automatically passes")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Result: {'✅ PASS' if trend_condition_short else '❌ FAIL'}")

        # Overall Short Entry Decision
        short_entry_valid = rsi_overbought_condition and price_at_bb_upper and trend_condition_short
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] SHORT ENTRY OVERALL DECISION:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   RSI Overbought:   {'✅' if rsi_overbought_condition else '❌'}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   BB Position:      {'✅' if price_at_bb_upper else '❌'}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Trend:            {'✅' if trend_condition_short else '❌'}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   FINAL RESULT:     {'✅ SHORT ENTRY VALID' if short_entry_valid else '❌ SHORT ENTRY INVALID'}")

        # Short entry: RSI is overbought AND (optional: price at/above upper BB) AND (optional: bearish trend)
        if short_entry_valid:

            entry_price = self.get_comparison_price(latest_tick, OrderAction.SELL)
            signal = {
                'signal': StrategySignal.SELL,
                'price': entry_price,
                'volume_pct_of_max': position_size,
                'comment': f'RSI overbought entry: RSI={current_rsi:.2f} >= {rsi_overbought}',
                'rsi': current_rsi,
                'bb_position': 'upper'
            }

            # Add stop loss and take profit if using ATR
            if self.use_atr_stops:
                self._add_atr_levels(signal, market_data_df, OrderAction.SELL)

            return signal

        # === FINAL ENTRY DECISION ===
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] === FINAL ENTRY DECISION ===")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Entry Conditions Summary:")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Long Entry Valid:  {long_entry_valid}")
        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   Short Entry Valid: {short_entry_valid}")

        if not long_entry_valid and not short_entry_valid:
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ❌ NO ENTRY CONDITIONS MET - No signal generated")
            self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] Reasons for rejection:")
            if not rsi_oversold_condition and not rsi_overbought_condition:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   - RSI ({current_rsi:.2f}) is in neutral zone ({rsi_oversold} < RSI < {rsi_overbought})")
            if use_bollinger_filter and not price_at_bb_lower and not price_at_bb_upper:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   - Price ({current_close:.5f}) is between BB bands ({bb_lower:.5f} < Price < {bb_upper:.5f})")
            if use_trend_filter and not bullish_trend and not bearish_trend:
                self.logger.debug(f"[{self.symbol}/{self.timeframe.name}]   - No clear trend direction")

        self.logger.debug(f"[{self.symbol}/{self.timeframe.name}] ================================================================================")
        return None

    def _get_current_strategy_parameters(self) -> Dict[str, Any]:
        """
        Get current strategy parameters from configuration.

        This method retrieves the current parameter values from the configuration,
        which may have been updated during optimization trials.

        Returns:
            Dictionary of current strategy parameters
        """
        try:
            # Get strategy profile from config
            strategy_profile = self.config.asset_strategy_profiles.get(self.asset_profile_key)
            if not strategy_profile:
                self.logger.warning(f"Strategy profile '{self.asset_profile_key}' not found, using cached parameters")
                return self.strategy_params

            # Get strategy parameter set
            strategy_params_key = strategy_profile.strategy_params_key
            strategy_param_set = self.config.loaded_strategy_parameters.get(strategy_params_key)
            if not strategy_param_set:
                self.logger.warning(f"Strategy parameters '{strategy_params_key}' not found, using cached parameters")
                return self.strategy_params

            # Return current parameters from configuration
            return strategy_param_set.parameters

        except Exception as e:
            self.logger.warning(f"Error retrieving current strategy parameters: {e}, using cached parameters")
            return self.strategy_params

    def _add_atr_levels(self, signal: Dict[str, Any], market_data_df: pd.DataFrame, action: OrderAction) -> None:
        """Add ATR-based stop loss and take profit levels to signal."""
        try:
            # Use dynamic column resolution to find the correct ATR column
            dynamic_columns = self._get_dynamic_column_names(market_data_df)

            if 'atr' not in dynamic_columns:
                self.logger.warning(
                    f"[{self.symbol}/{self.timeframe.name}] ATR column not found in data. Available columns: {list(market_data_df.columns)}"
                )
                return

            atr_column = dynamic_columns['atr']
            current_atr = market_data_df.iloc[-1][atr_column]
            entry_price = signal['price']

            # Calculate pips using utility method
            sl_pips = self.calculate_pips_from_atr(current_atr, self.atr_stop_multiplier)
            tp_pips = self.calculate_pips_from_atr(current_atr, self.atr_target_multiplier)

            if sl_pips is not None and tp_pips is not None:
                signal['sl_pips'] = sl_pips
                signal['tp_pips'] = tp_pips
                signal['atr'] = current_atr
                self.logger.debug(
                    f"[{self.symbol}/{self.timeframe.name}] ATR levels added: sl_pips={sl_pips}, tp_pips={tp_pips}, atr={current_atr:.5f} (column: {atr_column})"
                )
            else:
                self.logger.warning(
                    f"[{self.symbol}/{self.timeframe.name}] Failed to calculate pips from ATR: sl_pips={sl_pips}, tp_pips={tp_pips}"
                )

        except Exception as e:
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] Could not calculate ATR levels: {str(e)}"
            )

    def calculate_confidence(self, market_data_df: pd.DataFrame) -> float:
        """
        Calculate confidence score for the signal.

        Args:
            market_data_df: Market data DataFrame

        Returns:
            Confidence score between 0.0 and 1.0
        """
        try:
            # Get dynamic column names
            dynamic_columns = self._get_dynamic_column_names(market_data_df)

            current_row = market_data_df.iloc[-1]
            current_rsi = current_row[dynamic_columns['rsi']]
            current_close = current_row['close']
            bb_upper = current_row[dynamic_columns['bb_upper']]
            bb_lower = current_row[dynamic_columns['bb_lower']]

            # Get current dynamic parameters
            current_params = self._get_current_strategy_parameters()
            rsi_oversold = current_params.get('rsi_oversold', self.rsi_oversold)
            rsi_overbought = current_params.get('rsi_overbought', self.rsi_overbought)

            # Base confidence on RSI extremity and BB position
            rsi_extremity = 0.0
            if current_rsi <= rsi_oversold:
                rsi_extremity = (rsi_oversold - current_rsi) / rsi_oversold
            elif current_rsi >= rsi_overbought:
                rsi_extremity = (current_rsi - rsi_overbought) / (100 - rsi_overbought)

            # BB position factor
            bb_range = bb_upper - bb_lower
            if bb_range > 0:
                if current_close <= bb_lower:
                    bb_factor = (bb_lower - current_close) / bb_range
                elif current_close >= bb_upper:
                    bb_factor = (current_close - bb_upper) / bb_range
                else:
                    bb_factor = 0.0
            else:
                bb_factor = 0.0

            # Combine factors
            confidence = min(1.0, (rsi_extremity * 0.6) + (bb_factor * 0.4))
            return confidence

        except Exception as e:
            self.logger.warning(
                f"[{self.symbol}/{self.timeframe.name}] Error calculating confidence: {str(e)}"
            )
            return 0.5

    def _attempt_bb_fallback_extraction(self, market_data_df, current_row):
        """
        Attempt to extract Bollinger Band values using fallback column patterns.

        Args:
            market_data_df: DataFrame containing market data
            current_row: Current row of data

        Returns:
            tuple: (bb_upper, bb_lower, bb_middle) or (None, None, None) if failed
        """
        available_columns = list(market_data_df.columns)

        # Common Bollinger Band column patterns to try
        fallback_patterns = [
            # Standard patterns
            {'upper': 'BB_Upper_20', 'lower': 'BB_Lower_20', 'middle': 'BB_Middle_20'},
            {'upper': 'BBU_20', 'lower': 'BBL_20', 'middle': 'BBM_20'},
            {'upper': 'BBAND_UPPER_20', 'lower': 'BBAND_LOWER_20', 'middle': 'BBAND_MIDDLE_20'},

            # Alternative period patterns
            {'upper': 'BB_Upper_14', 'lower': 'BB_Lower_14', 'middle': 'BB_Middle_14'},
            {'upper': 'BB_Upper_21', 'lower': 'BB_Lower_21', 'middle': 'BB_Middle_21'},

            # Generic patterns
            {'upper': 'bb_upper', 'lower': 'bb_lower', 'middle': 'bb_middle'},
            {'upper': 'upper_band', 'lower': 'lower_band', 'middle': 'middle_band'},
        ]

        timeframe_name = getattr(self.timeframe, 'name', str(self.timeframe))
        self.logger.debug(f"[{self.symbol}/{timeframe_name}] Trying fallback patterns...")

        for i, pattern in enumerate(fallback_patterns):
            try:
                upper_col = pattern['upper']
                lower_col = pattern['lower']
                middle_col = pattern['middle']

                if upper_col in available_columns and lower_col in available_columns:
                    bb_upper = current_row[upper_col]
                    bb_lower = current_row[lower_col]
                    bb_middle = current_row.get(middle_col, None) if middle_col in available_columns else None

                    # Validate the extracted values
                    if not pd.isna(bb_upper) and not pd.isna(bb_lower) and bb_upper > bb_lower:
                        self.logger.info(f"[{self.symbol}/{timeframe_name}] Fallback pattern {i+1} successful:")
                        self.logger.info(f"[{self.symbol}/{timeframe_name}]   Upper: {upper_col} = {bb_upper:.5f}")
                        self.logger.info(f"[{self.symbol}/{timeframe_name}]   Lower: {lower_col} = {bb_lower:.5f}")
                        if bb_middle is not None:
                            self.logger.info(f"[{self.symbol}/{timeframe_name}]   Middle: {middle_col} = {bb_middle:.5f}")

                        return bb_upper, bb_lower, bb_middle
                    else:
                        self.logger.debug(f"[{self.symbol}/{timeframe_name}] Pattern {i+1} invalid values: upper={bb_upper}, lower={bb_lower}")

            except (KeyError, IndexError) as e:
                self.logger.debug(f"[{self.symbol}/{timeframe_name}] Pattern {i+1} failed: {e}")
                continue

        # If all patterns fail, try to find any columns containing 'bb' or 'bollinger'
        self.logger.debug(f"[{self.symbol}/{timeframe_name}] Attempting fuzzy column matching...")
        bb_columns = [col for col in available_columns if 'bb' in col.lower() or 'bollinger' in col.lower()]

        if bb_columns:
            self.logger.warning(f"[{self.symbol}/{timeframe_name}] Found potential BB columns: {bb_columns}")
            # Try to identify upper/lower from column names using safer tokens
            def is_upper(col: str) -> bool:
                c = col.lower()
                return (
                    'upper' in c or c.endswith('_upper') or c.endswith('_u') or c.startswith('bbu')
                )
            def is_lower(col: str) -> bool:
                c = col.lower()
                return (
                    'lower' in c or c.endswith('_lower') or c.endswith('_l') or c.startswith('bbl')
                )

            upper_candidates = [col for col in bb_columns if is_upper(col)]
            lower_candidates = [col for col in bb_columns if is_lower(col)]

            if upper_candidates and lower_candidates:
                try:
                    bb_upper = current_row[upper_candidates[0]]
                    bb_lower = current_row[lower_candidates[0]]

                    if not pd.isna(bb_upper) and not pd.isna(bb_lower) and bb_upper > bb_lower:
                        self.logger.warning(f"[{self.symbol}/{timeframe_name}] Fuzzy match successful:")
                        self.logger.warning(f"[{self.symbol}/{timeframe_name}]   Upper: {upper_candidates[0]} = {bb_upper:.5f}")
                        self.logger.warning(f"[{self.symbol}/{timeframe_name}]   Lower: {lower_candidates[0]} = {bb_lower:.5f}")
                        return bb_upper, bb_lower, None
                except Exception as e:
                    self.logger.debug(f"[{self.symbol}/{timeframe_name}] Fuzzy match failed: {e}")

        self.logger.error(f"[{self.symbol}/{timeframe_name}] All fallback extraction attempts failed")
        return None, None, None

    def _attempt_trend_sma_fallback(self, market_data_df, current_row):
        """
        Attempt to extract trend SMA value using fallback column patterns.

        Args:
            market_data_df: DataFrame containing market data
            current_row: Current row of data

        Returns:
            float: trend SMA value or None if failed
        """
        available_columns = list(market_data_df.columns)

        # Common trend SMA column patterns to try
        fallback_patterns = [
            'SMA_50', 'SMA_200', 'SMA_20', 'SMA_100',
            'sma_50', 'sma_200', 'sma_20', 'sma_100',
            'trend_sma', 'trend_ma', 'long_sma',
            'MA_50', 'MA_200', 'MA_20', 'MA_100'
        ]

        timeframe_name = getattr(self.timeframe, 'name', str(self.timeframe))
        self.logger.debug(f"[{self.symbol}/{timeframe_name}] Trying trend SMA fallback patterns...")

        for pattern in fallback_patterns:
            if pattern in available_columns:
                try:
                    trend_sma = current_row[pattern]
                    if not pd.isna(trend_sma) and trend_sma > 0:
                        self.logger.info(f"[{self.symbol}/{timeframe_name}] Trend SMA fallback found: {pattern} = {trend_sma:.5f}")
                        return trend_sma
                except Exception as e:
                    self.logger.debug(f"[{self.symbol}/{timeframe_name}] Pattern {pattern} failed: {e}")
                    continue

        # Try to find any SMA/MA columns
        sma_columns = [col for col in available_columns if 'sma' in col.lower() or 'ma' in col.lower()]
        if sma_columns:
            self.logger.warning(f"[{self.symbol}/{timeframe_name}] Found potential SMA columns: {sma_columns}")
            # Use the first available SMA column
            try:
                trend_sma = current_row[sma_columns[0]]
                if not pd.isna(trend_sma) and trend_sma > 0:
                    self.logger.warning(f"[{self.symbol}/{timeframe_name}] Using fallback SMA: {sma_columns[0]} = {trend_sma:.5f}")
                    return trend_sma
            except Exception as e:
                self.logger.debug(f"[{self.symbol}/{timeframe_name}] Fallback SMA failed: {e}")

        return None

    def on_order_update(self, order) -> None:
        """
        Handle order update notifications from the orchestrator.

        This method is called when an order status changes (filled, cancelled, etc.).
        Currently implemented as a no-op but can be extended for order tracking.

        Args:
            order: Order object with updated status
        """
        # Log the order update for debugging
        self.logger.debug(
            f"[{self.symbol}/{self.timeframe.name}] Order update received: "
            f"ID={getattr(order, 'order_id', 'N/A')}, "
            f"Status={getattr(order, 'status', 'N/A')}"
        )

        # Currently no specific action needed for order updates
        # This method can be extended in the future for:
        # - Order tracking and management
        # - Position size adjustments
        # - Risk management updates
        # - Performance metrics collection
        pass
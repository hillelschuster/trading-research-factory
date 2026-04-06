# src/strategies/london_breakout.py
"""
London Breakout Strategy - Time-Based Volatility Trading.

This strategy exploits the liquidity injection at the London Open (07:00 UTC)
by trading breakouts of the Asian session range.

RATIONALE:
- The London Open is the single biggest injection of liquidity into Forex
- Asian session (00:00-07:00 UTC) establishes a "Value Area"  
- Breakout = European institutions disagreeing with Asian valuation
- This is structural price action, not lagging indicators

SENIOR QUANT REFINEMENTS:
- Midpoint stop loss (not opposite range boundary) for better R:R
- Range filter 10-40 pips (avoid exhaustion and coiling)
- 07:05 start (avoid spread spikes at exact open)
- 16:00 UTC hard exit (end of London session)
"""

import pandas as pd
import numpy as np
from datetime import datetime, time, timezone
from typing import Dict, Any, Optional, List, TYPE_CHECKING
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
import logging

from .base_strategy import BaseStrategy
from src.custom_types import StrategyParameters
from src.core.enums import StrategySignal, OrderAction

if TYPE_CHECKING:
    from src.data_handler.market_data_manager import MarketDataManager
    from src.api_connector.base_connector import PlatformInterface
    from src.config_manager import AppConfig


class LondonBreakoutParams(BaseModel):
    """
    Parameters for London Breakout strategy with Pydantic validation.
    
    Validates:
    - Hour fields are 0-23
    - Pip/ratio fields are non-negative
    - max_range_pips > min_range_pips
    - asia_end_hour > asia_start_hour
    """
    model_config = ConfigDict(extra='forbid')  # Reject unknown params (catches typos)
    
    # Asia Session Definition
    asia_start_hour: int = 0      # 00:00 UTC
    asia_end_hour: int = 7        # 07:00 UTC
    
    # Trading Window
    trade_start_minute: int = 5   # 07:05 UTC (avoid spread spike)
    trade_end_hour: int = 10      # No new trades after 10:00 UTC
    hard_exit_hour: int = 16      # Close all at 16:00 UTC
    
    # Entry Parameters
    buffer_pips: float = 5.0      # Buffer above/below range for entry
    
    # Risk Management
    risk_reward_ratio: float = 1.5  # Take profit = 1.5x risk
    max_range_pips: float = 40.0  # Avoid exhaustion
    min_range_pips: float = 10.0  # Avoid compression
    min_daily_atr: float = 0.0    # ATR(14) Volatility Floor (0=disabled)
    
    # Position Management
    one_trade_per_day: bool = True  # Prevent revenge trading
    
    # === RESEARCH-ALIGNED FILTERS (ORB specs from researches2.md:1692-1751) ===
    
    # Volume Filter: Research says ≥150% of 20-day TOD average volume
    # Using tick volume as proxy (best available in Forex)
    min_volume_pct: float = 1.5   # 150% of 20-bar avg volume (0=disabled)
    
    # Gap Filter: Research says gap >0.5% increases win rate to 67%
    # Overnight gap = |current day open - previous day close| / prev close
    min_gap_pct: float = 0.0      # Min overnight gap to trade (0=disabled)
    use_gap_filter: bool = False  # Enable gap filter (can actually REDUCE trades)

    @field_validator('buffer_pips', 'risk_reward_ratio', 'max_range_pips', 'min_range_pips', 'min_daily_atr', 'min_volume_pct', 'min_gap_pct')
    @classmethod
    def must_be_non_negative(cls, v: float, info) -> float:
        if v < 0:
            raise ValueError(f'{info.field_name} must be >= 0')
        return v


    @field_validator('asia_start_hour', 'asia_end_hour', 'trade_end_hour', 'hard_exit_hour')
    @classmethod
    def must_be_valid_hour(cls, v: int, info) -> int:
        if not 0 <= v <= 23:
            raise ValueError(f'{info.field_name} must be 0-23')
        return v

    @field_validator('trade_start_minute')
    @classmethod
    def must_be_valid_minute(cls, v: int) -> int:
        if not 0 <= v <= 59:
            raise ValueError('trade_start_minute must be 0-59')
        return v

    @model_validator(mode='after')
    def validate_ranges(self) -> 'LondonBreakoutParams':
        if self.max_range_pips <= self.min_range_pips:
            raise ValueError('max_range_pips must be > min_range_pips')
        if self.asia_end_hour <= self.asia_start_hour:
            raise ValueError('asia_end_hour must be > asia_start_hour')
        return self


class LondonBreakoutStrategy(BaseStrategy):
    """
    London Breakout Strategy implementation.
    
    Trades breakouts of the Asian session range during London Open.
    Uses structural price action instead of lagging indicators.
    """
    
    def __init__(
        self,
        strategy_params: StrategyParameters,
        config: 'AppConfig',
        platform_adapter: 'PlatformInterface',
        market_data_manager: 'MarketDataManager',
        logger: logging.Logger,
        asset_profile_key: str
    ):
        """Initialize London Breakout strategy."""
        super().__init__(
            strategy_params=strategy_params,
            config=config,
            platform_adapter=platform_adapter,
            market_data_manager=market_data_manager,
            logger=logger,
            asset_profile_key=asset_profile_key
        )
        
        # Strategy-specific state
        self.asia_high: Optional[float] = None
        self.asia_low: Optional[float] = None
        self.asia_midpoint: Optional[float] = None
        self.asia_range_pips: Optional[float] = None
        self.trade_taken_today: bool = False
        self.last_trade_date: Optional[datetime] = None
        
        self.logger.info("LondonBreakoutStrategy initialized")
    
    def _initialize_strategy_parameters(self) -> None:
        """Initialize strategy-specific parameters from config."""
        # First call base to get symbol/timeframe from config
        super()._initialize_strategy_parameters()
        
        params = self.strategy_params
        
        # Map from StrategyParameters to LondonBreakoutParams
        self.params = LondonBreakoutParams(
            asia_start_hour=getattr(params, 'asia_start_hour', 0),
            asia_end_hour=getattr(params, 'asia_end_hour', 7),
            trade_start_minute=getattr(params, 'trade_start_minute', 5),
            trade_end_hour=getattr(params, 'trade_end_hour', 10),
            hard_exit_hour=getattr(params, 'hard_exit_hour', 16),
            buffer_pips=getattr(params, 'buffer_pips', 5.0),
            risk_reward_ratio=getattr(params, 'risk_reward_ratio', 1.5),
            max_range_pips=getattr(params, 'max_range_pips', 40.0),
            min_range_pips=getattr(params, 'min_range_pips', 10.0),
            one_trade_per_day=getattr(params, 'one_trade_per_day', True),
            # FIX: Add missing filter params for parity
            min_daily_atr=getattr(params, 'min_daily_atr', 0.0),
            min_volume_pct=getattr(params, 'min_volume_pct', 0.0),
            min_gap_pct=getattr(params, 'min_gap_pct', 0.0),
            use_gap_filter=getattr(params, 'use_gap_filter', False),
        )
        
        self.logger.info(f"London Breakout params: buffer={self.params.buffer_pips} pips, "
                        f"R:R={self.params.risk_reward_ratio}, "
                        f"range_filter=[{self.params.min_range_pips}, {self.params.max_range_pips}] pips, "
                        f"min_daily_atr={self.params.min_daily_atr}")
    
    def _initialize_indicators(self) -> None:
        """No traditional indicators needed - price action based."""
        pass
    
    def _get_minimum_data_length(self) -> int:
        """Minimum bars needed for Asia range calculation (7 hours of M15 = 28 bars)."""
        return 30
    
    def _get_required_columns(self) -> List[str]:
        """Required OHLC columns."""
        return ['open', 'high', 'low', 'close']
    
    def _get_indicator_columns(self, market_data_df: Optional[pd.DataFrame] = None) -> List[str]:
        """No traditional indicators - return empty."""
        return []
    
    def generate_vectorized_signals(
        self, 
        data: pd.DataFrame, 
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate London Breakout signals as arrays for vectorbt.
        
        Logic:
        1. Calculate Asia session range (00:00-07:00 UTC) for each day
        2. Generate long entry when price breaks above asia_high + buffer
        3. Generate short entry when price breaks below asia_low - buffer
        4. Entry window: 07:05 - 10:00 UTC
        5. Hard exit at 16:00 UTC
        """
        params = params or self.strategy_params
        
        # Extract parameters
        asia_start_hour = getattr(params, 'asia_start_hour', 0)
        asia_end_hour = getattr(params, 'asia_end_hour', 7)
        trade_start_minute = getattr(params, 'trade_start_minute', 5)
        trade_end_hour = getattr(params, 'trade_end_hour', 10)
        hard_exit_hour = getattr(params, 'hard_exit_hour', 16)
        buffer_pips = getattr(params, 'buffer_pips', 5.0)
        risk_reward_ratio = getattr(params, 'risk_reward_ratio', 1.5)
        max_range_pips = getattr(params, 'max_range_pips', 40.0)
        min_range_pips = getattr(params, 'min_range_pips', 10.0)
        min_daily_atr = getattr(params, 'min_daily_atr', 0.0)
        one_trade_per_day = getattr(params, 'one_trade_per_day', True)
        
        # === RESEARCH-ALIGNED FILTERS ===
        min_volume_pct = getattr(params, 'min_volume_pct', 1.5)  # 150% vol filter
        min_gap_pct = getattr(params, 'min_gap_pct', 0.0)        # Gap filter
        use_gap_filter = getattr(params, 'use_gap_filter', False)

        
        # Ensure timestamp column
        if 'timestamp' not in data.columns:
            if 'Date' in data.columns:
                data = data.copy()
                data['timestamp'] = pd.to_datetime(data['Date'])
            elif isinstance(data.index, pd.DatetimeIndex):
                data = data.copy()
                data['timestamp'] = data.index.to_series()
            else:
                self.logger.error("Data missing 'timestamp' or 'Date' column")
                raise ValueError("Data must have 'timestamp' or 'Date' column")
        
        n = len(data)
        ts = pd.to_datetime(data['timestamp'])
        
        # --- TIMEZONE FIX (Strict Fail-Fast with Vectorized Path Support) ---
        data_timezone = None

        if hasattr(self, 'config') and self.config is not None:
            # Full strategy context - config exists
            data_timezone = self.config.get_nested('data.timezone')
            if not data_timezone:
                self.logger.error("CRITICAL: 'data.timezone' missing in config. Aborting.")
                raise ValueError("Configuration Error: 'data.timezone' is required.")
        else:
            # LightweightStrategy (vectorized optimization) - no config available
            # Default to UTC since YAML config always specifies UTC
            data_timezone = 'UTC'
            self.logger.info("Vectorized path: Using default timezone 'UTC'")
        
        if ts.dt.tz is None:
             self.logger.info(f"Timezone: Localizing naive data from {data_timezone} to UTC")
             ts = ts.dt.tz_localize(data_timezone).dt.tz_convert('UTC')
        else:
             self.logger.info(f"Timezone: Converting aware data to UTC")
             ts = ts.dt.tz_convert('UTC')

        # Log timestamp samples for verification
        self.logger.info(f"TIMESTAMP SAMPLE (UTC):\n{ts.head()}")
        self.logger.info(f"TIMESTAMP SAMPLE END (UTC):\n{ts.tail()}")
        
        hours = ts.dt.hour
        minutes = ts.dt.minute
        dates = ts.dt.date
        
        # DEBUG: Data check
        self.logger.info(f"Vectorized Signal Gen: {n} rows. Range: {ts.min()} to {ts.max()}")
        
        close = data['close'].values
        open_ = data['open'].values if 'open' in data.columns else data['close'].values 
        
        # PREPARE EXECUTION PRICE (Next Bar Open)
        # Vectorbt 'open=open_' means entry at next bar's open.
        # We need this exact price to calculate SL percent correctly.
        # Shift(-1) implies "Next Open". 
        next_open = pd.Series(open_).shift(-1).values
        
        high = data['high'].values
        low = data['low'].values
        
        # Step 1: Calculate Asia session range for each day
        is_asia = (hours >= asia_start_hour) & (hours < asia_end_hour)
        
        # Create a temp df for grouping
        temp_df = pd.DataFrame({
            'high': high,
            'low': low,
            'date': dates,
            'is_asia': is_asia
        })
        
        # --- STRICT ASIA BAR COUNT FILTER ---
        asia_groups = temp_df[is_asia].groupby('date')
        asia_agg = pd.DataFrame({
            'asia_high': asia_groups['high'].max(),
            'asia_low': asia_groups['low'].min(),
            'bar_count': asia_groups.size() # Strict count
        })
        
        min_bars_required = 14
        total_days = len(asia_agg)
        
        # Filter valid days
        valid_days_df = asia_agg[asia_agg['bar_count'] >= min_bars_required].copy()
        
        # Log stats
        valid_days_count = len(valid_days_df)
        filtered_count = total_days - valid_days_count
        self.logger.info(f"Asia Filter: Total={total_days}, Valid={valid_days_count}, Filtered={filtered_count} ({(filtered_count/total_days if total_days>0 else 0)*100:.1f}%)")
        
        # Map back to full data using dates
        asia_high_series = temp_df['date'].map(valid_days_df['asia_high'])
        asia_low_series = temp_df['date'].map(valid_days_df['asia_low'])
        
        asia_high = asia_high_series.values
        asia_low = asia_low_series.values
        asia_range_pips = (asia_high - asia_low) * 10000 
        
        # Convert buffer from pips to price
        buffer_price = buffer_pips / 10000 
        
        # Step 2: Trade window shift (07:05 - 10:00 UTC)
        hours_np = hours.values
        minutes_np = minutes.values
        
        is_trade_window = (
            ((hours_np == asia_end_hour) & (minutes_np >= trade_start_minute)) |
            ((hours_np > asia_end_hour) & (hours_np < trade_end_hour))
        )
        
        # Step 3: Range filter
        valid_range = (asia_range_pips >= min_range_pips) & (asia_range_pips <= max_range_pips)
        valid_range = np.nan_to_num(valid_range, nan=False).astype(bool)

        # Step 3.5: ATR Volatility Filter (Stagnation Patch)
        volatility_ok = np.ones(n, dtype=bool) 
        
        if min_daily_atr > 0:
            try:
                # Use groupby for robustness
                daily_metrics = pd.DataFrame({
                    'close': data.groupby(dates)['close'].last(),
                    'high': data.groupby(dates)['high'].max(),
                    'low': data.groupby(dates)['low'].min()
                })
                
                prev_close = daily_metrics['close'].shift(1)
                tr1 = daily_metrics['high'] - daily_metrics['low']
                tr2 = (daily_metrics['high'] - prev_close).abs()
                tr3 = (daily_metrics['low'] - prev_close).abs()
                tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
                
                daily_atr = tr.rolling(window=14).mean()
                daily_atr_delayed = daily_atr.shift(1) # Shift 1 day
                
                atr_m15 = temp_df['date'].map(daily_atr_delayed)
                
                min_atr_price = min_daily_atr  # Params already in price (e.g., 0.0055 = 55 pips)
                volatility_ok_series = (atr_m15 >= min_atr_price).fillna(False)
                volatility_ok = volatility_ok_series.values 
                
                self.logger.info(f"Vectorized Signal Gen: ATR Filter applied. Allowed: {(volatility_ok.sum()/n)*100:.1f}%")
            except Exception as e:
                self.logger.error(f"Vectorized ATR calculation failed: {e}")
                volatility_ok = np.zeros(n, dtype=bool)
        
        # Step 3.6: VOLUME FILTER (Research: ≥150% of 20-bar avg)
        volume_ok = np.ones(n, dtype=bool)  # Default: pass all
        
        if min_volume_pct > 0 and 'volume' in data.columns:
            try:
                volume = data['volume'].values
                # Calculate 20-bar rolling avg, SHIFTED by 1 for lookahead prevention
                avg_volume = pd.Series(volume).rolling(20).mean().shift(1).values
                
                # Volume must exceed threshold (e.g., 1.5 = 150%)
                volume_ok = volume >= (avg_volume * min_volume_pct)
                volume_ok = np.nan_to_num(volume_ok, nan=False).astype(bool)
                
                self.logger.info(f"Volume Filter: {min_volume_pct*100:.0f}% threshold. Allowed: {(volume_ok.sum()/n)*100:.1f}%")
            except Exception as e:
                self.logger.error(f"Volume filter failed: {e}")
                volume_ok = np.ones(n, dtype=bool)
        
        # Step 3.7: GAP FILTER (Research: gap >0.5% increases win rate to 67%)
        gap_ok = np.ones(n, dtype=bool)  # Default: pass all
        
        if use_gap_filter and min_gap_pct > 0:
            try:
                # Calculate daily opens and previous day closes
                day_open = data.groupby(dates)['open'].first()
                day_close = data.groupby(dates)['close'].last()
                prev_close = day_close.shift(1)
                
                # Gap = |day_open - prev_close| / prev_close
                gap_pct = ((day_open - prev_close) / prev_close).abs()
                
                # Map back to M15 bars
                gap_m15 = temp_df['date'].map(gap_pct)
                gap_ok = (gap_m15 >= min_gap_pct).fillna(False).values
                
                gap_days = (gap_pct >= min_gap_pct).sum()
                self.logger.info(f"Gap Filter: {min_gap_pct*100:.1f}% threshold. Gap days: {gap_days}/{len(gap_pct)}")
            except Exception as e:
                self.logger.error(f"Gap filter failed: {e}")
                gap_ok = np.ones(n, dtype=bool)
        
        # Step 4: Breakout signals
        valid_asia = ~np.isnan(asia_high) & ~np.isnan(asia_low)
        
        # Check for valid next open (not last bar)
        valid_execution = ~np.isnan(next_open)
        
        long_entries = (
            is_trade_window & 
            valid_range & 
            volatility_ok &
            volume_ok &      # NEW: Volume filter
            gap_ok &         # NEW: Gap filter
            valid_asia &
            valid_execution &
            (close > asia_high + buffer_price)
        )
        
        short_entries = (
            is_trade_window & 
            valid_range & 
            volatility_ok &
            volume_ok &      # NEW: Volume filter
            gap_ok &         # NEW: Gap filter
            valid_asia &
            valid_execution &
            (close < asia_low - buffer_price)

        )
        
        # Step 5: One trade per day filter
        if one_trade_per_day:
            any_entry = long_entries | short_entries
            first_entry_mask = np.zeros_like(any_entry, dtype=bool)
            seen_dates = set()
            
            for i in range(n):
                if any_entry[i]:
                    d = dates[i]
                    if d not in seen_dates:
                        first_entry_mask[i] = True
                        seen_dates.add(d)
            
            long_entries = long_entries & first_entry_mask
            short_entries = short_entries & first_entry_mask
        
        # Step 6: Exit signals (Edge Trigger for cleaner exits)
        hours_series = pd.Series(hours_np) 
        hard_exits_mask = (hours_series >= hard_exit_hour) & (hours_series.shift(1) < hard_exit_hour)
        hard_exits = hard_exits_mask.fillna(False).values
        
        # SL/TP calculation (CORRECTED: Opposite Boundary Stop)
        # Research says: SL at opposite side of range gives best win rate
        
        sl_stop_arr = np.full_like(close, np.nan)
        tp_stop_arr = np.full_like(close, np.nan)
        
        # Long SL/TP
        if np.any(long_entries):
             # Execution at Next Open
             # SL = Asia Low
             entry_prices = next_open[long_entries]
             stop_prices = asia_low[long_entries]
             
             long_sl_dist = (entry_prices - stop_prices).clip(min=0.0001)
             long_sl_pct = long_sl_dist / entry_prices
             
             sl_stop_arr[long_entries] = long_sl_pct
             tp_stop_arr[long_entries] = long_sl_pct * risk_reward_ratio

        # Short SL/TP
        if np.any(short_entries):
             entry_prices = next_open[short_entries]
             stop_prices = asia_high[short_entries]
             
             short_sl_dist = (stop_prices - entry_prices).clip(min=0.0001)
             short_sl_pct = short_sl_dist / entry_prices
             
             sl_stop_arr[short_entries] = short_sl_pct
             tp_stop_arr[short_entries] = short_sl_pct * risk_reward_ratio
        
        return {
            'long_entries': long_entries.astype(bool),
            'long_exits': hard_exits.astype(bool),
            'short_entries': short_entries.astype(bool),
            'short_exits': hard_exits.astype(bool),
            'sl_stop': sl_stop_arr,
            'tp_stop': tp_stop_arr
        }

    def _generate_strategy_signal(
        self,
        market_data_df: pd.DataFrame,
        active_position: Optional[Any],
        latest_tick: Any
    ) -> Optional[Dict[str, Any]]:
        """
        Generate strategy signal - delegates to entry/exit logic.
        
        This is the main method called by BaseStrategy.generate_signal().
        """
        # First calculate indicators if not already done
        if 'asia_high' not in market_data_df.columns:
            market_data_df = self.calculate_indicators(market_data_df)
        
        # Check for exit first if we have a position
        if active_position:
            exit_signal = self._generate_exit_signal(market_data_df, active_position)
            if exit_signal:
                return exit_signal
        
        # Then check for entry if no position
        if not active_position:
            current_positions = []  # No position = empty list
            entry_signal = self._generate_entry_signal(market_data_df, current_positions)
            if entry_signal:
                return entry_signal
        
        return None
    
    def calculate_indicators(self, market_data_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate Asia session range with Data Integrity Checks.
        
        SENIOR QUANT FIX: Added bar_count filter to prevent "Ghost Sessions"
        on holidays/low-liquidity days where single bars would create
        false 0-pip ranges triggering instant breakouts.
        """
        df = market_data_df.copy()
        
        # Ensure timestamp column
        if 'timestamp' not in df.columns and 'Date' in df.columns:
            df['timestamp'] = pd.to_datetime(df['Date'])
        elif 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'])
        elif isinstance(df.index, pd.DatetimeIndex):
            df['timestamp'] = df.index.to_series()
        else:
            self.logger.warning("No timestamp column found")
            return df
        
        # FIX: Timezone normalization for parity with vectorized path
        # If timestamps are timezone-naive, assume UTC (matching YAML config default)
        if df['timestamp'].dt.tz is None:
            # Data is naive - assume UTC
            self.logger.debug("Event-driven: Assuming naive timestamps are UTC")
        else:
            # Data is tz-aware - convert to UTC
            df['timestamp'] = df['timestamp'].dt.tz_convert('UTC')
            self.logger.debug("Event-driven: Converted timestamps to UTC")
        
        df['hour'] = df['timestamp'].dt.hour
        df['minute'] = df['timestamp'].dt.minute
        df['date'] = df['timestamp'].dt.date
        
        # 1. Define Sessions
        df['is_asia_session'] = (df['hour'] >= self.params.asia_start_hour) & \
                                (df['hour'] < self.params.asia_end_hour)
        
        # 2. Aggregation with DATA INTEGRITY CHECK
        # Count bars to ensure we have enough data to form a valid range
        asia_stats = df[df['is_asia_session']].groupby('date').agg({
            'high': 'max',
            'low': 'min',
            'close': 'count'  # Count the bars!
        }).rename(columns={'high': 'asia_high', 'low': 'asia_low', 'close': 'bar_count'})
        
        # 3. Filter Invalid Days (e.g., Holidays with < 50% expected data)
        # M15 bars: 7 hours * 4 bars = 28 bars expected
        # We require at least 50% data density (14 bars)
        min_bars_required = 14
        valid_days = asia_stats[asia_stats['bar_count'] >= min_bars_required].copy()
        
        if len(valid_days) < len(asia_stats):
            invalid_count = len(asia_stats) - len(valid_days)
            self.logger.debug(f"Filtered out {invalid_count} days with insufficient Asia session data")
        
        # 4. Merge only VALID days back (invalid days get NaN = no trade)
        df = df.merge(valid_days[['asia_high', 'asia_low']], left_on='date', right_index=True, how='left')
        
        # Mark London trading window (07:05 to 09:59 UTC)
        df['is_trade_window'] = (
            ((df['hour'] == self.params.asia_end_hour) & (df['minute'] >= self.params.trade_start_minute)) |
            ((df['hour'] > self.params.asia_end_hour) & (df['hour'] < self.params.trade_end_hour))
        )
        
        # Mark hard exit time (16:00 UTC) - EDGE TRIGGER for parity with vectorized
        # Only fires on the FIRST bar of the exit hour, not all bars
        df['is_exit_time'] = (df['hour'] >= self.params.hard_exit_hour) & \
                             (df['hour'].shift(1) < self.params.hard_exit_hour)
        df['is_exit_time'] = df['is_exit_time'].fillna(False)
        
        # Calculate range metrics
        df['asia_range'] = df['asia_high'] - df['asia_low']
        df['asia_midpoint'] = (df['asia_high'] + df['asia_low']) / 2
        
        # Convert range to pips (assuming 4/5 decimal pairs like EURUSD)
        pip_multiplier = 10000
        df['asia_range_pips'] = df['asia_range'] * pip_multiplier
        
        # Calculate breakout levels with buffer
        buffer_price = self.params.buffer_pips / pip_multiplier
        df['long_entry_level'] = df['asia_high'] + buffer_price
        df['short_entry_level'] = df['asia_low'] - buffer_price
        
        # --- FIX 2.3a: Volume Filter Calculation (Event-Driven Parity) ---
        min_volume_pct = getattr(self.params, 'min_volume_pct', 0.0)
        if min_volume_pct > 0 and 'volume' in df.columns:
            df['avg_volume_20'] = df['volume'].rolling(20).mean().shift(1)
            df['volume_ok'] = df['volume'] >= (df['avg_volume_20'] * min_volume_pct)
        else:
            df['volume_ok'] = True  # Volume filter disabled
        
        # --- FIX: Gap Filter Calculation (Event-Driven Parity) ---
        use_gap_filter = getattr(self.params, 'use_gap_filter', False)
        min_gap_pct = getattr(self.params, 'min_gap_pct', 0.0)
        
        if use_gap_filter and min_gap_pct > 0:
            try:
                # Calculate daily opens and previous day closes
                day_data = df.groupby('date').agg({'open': 'first', 'close': 'last'})
                day_data['prev_close'] = day_data['close'].shift(1)
                day_data['gap_pct'] = ((day_data['open'] - day_data['prev_close']) / day_data['prev_close']).abs()
                
                # Map back to M15 bars
                df['gap_pct'] = df['date'].map(day_data['gap_pct'])
                df['gap_ok'] = df['gap_pct'] >= min_gap_pct
                df['gap_ok'] = df['gap_ok'].fillna(False)
            except Exception as e:
                self.logger.warning(f"Gap filter calculation failed: {e}")
                df['gap_ok'] = True
        else:
            df['gap_ok'] = True  # Gap filter disabled
        
        # --- NEW: ATR Volatility Filter Logic (Event-Driven Patch) ---
        min_daily_atr = getattr(self.params, 'min_daily_atr', 0.0)
        
        if min_daily_atr > 0 and 'min_daily_atr' not in df.columns:
            try:
                # We need Daily data from the M15 feed to calculate Daily ATR
                # 1. Resample to Daily
                df_daily = df.resample('D', on='timestamp').agg({
                    'open': 'first',
                    'high': 'max',
                    'low': 'min',
                    'close': 'last'
                })
                
                # 2. Calculate ATR(14)
                # Calculate True Range manually (High-Low)
                # Note: For simple robustness in event-driven without external feeds, 
                # we just use High-Low of the daily bar as a proxy if PrevClose is missing,
                # but let's try to do it right with shift.
                prev_close = df_daily['close'].shift(1)
                tr1 = df_daily['high'] - df_daily['low']
                tr2 = (df_daily['high'] - prev_close).abs()
                tr3 = (df_daily['low'] - prev_close).abs()
                tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
                
                daily_atr = tr.rolling(window=14).mean()
                
                # 3. CRITICAL: Shift(1) to prevent look-ahead
                # We want Yesterday's ATR to apply to Today
                daily_atr_delayed = daily_atr.shift(1)
                
                # 4. Map back to M15 using Date
                # We can map using the 'date' column we already created
                df['daily_atr'] = df['date'].map(daily_atr_delayed)
                
                # VERIFICATION LOGGING
                last_date = df['date'].iloc[-1]
                last_atr = df['daily_atr'].iloc[-1]
                self.logger.info(f"ATR CALCULATION: Date={last_date}, ATR14={last_atr:.5f} (Shifted)")
                
            except Exception as e:
                self.logger.warning(f"ATR Calculation failed: {e}")
                df['daily_atr'] = 0.0 # Default to blocking trades if calculation fails
        
        return df
    
    def _generate_entry_signal(
        self,
        market_data_df: pd.DataFrame,
        current_positions: List[Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Generate entry signal based on Asia range breakout.
        
        ENTRY CONDITIONS:
        1. Current time is within trade window (07:05 - 10:00 UTC)
        2. Asia range is between 10-40 pips (not exhausted, not coiling)
        3. Price breaks above Asia High + buffer → LONG
        4. Price breaks below Asia Low - buffer → SHORT
        5. No existing position / no trade taken today
        """
        if market_data_df.empty:
            return None
        
        latest = market_data_df.iloc[-1]
        
        # Check if we're in trading window
        if not latest.get('is_trade_window', False):
            return None
        
        # Check if already traded today (if one_trade_per_day enabled)
        if self.params.one_trade_per_day and self.trade_taken_today:
            current_date = latest['timestamp'].date() if hasattr(latest['timestamp'], 'date') else None
            if current_date and current_date == self.last_trade_date:
                return None
        
        # Check range filters
        # Range must be > min (avoid coiling) and < max (avoid exhaustion)
        asia_range_pips = latest.get('asia_range_pips', 0)
        if not (self.params.min_range_pips <= asia_range_pips <= self.params.max_range_pips):
            return None

        # --- ATR Volatility Check ---
        min_daily_atr = getattr(self.params, 'min_daily_atr', 0.0)
        if min_daily_atr > 0:
            current_atr = latest.get('daily_atr', 0.0)
            # FIX 1.2b: Params already in price (e.g., 0.0055 = 55 pips)
            min_atr_price = min_daily_atr
            
            # If ATR is NaN (start of data) or less than threshold, NO TRADE
            if pd.isna(current_atr) or current_atr < min_atr_price:
                self.logger.info(f"⛔ ATR BLOCK: Date={latest['timestamp']}, ATR={current_atr:.5f} < Min={min_atr_price:.5f} ({min_daily_atr} pips)")
                return None
            else:
                self.logger.info(f"✅ ATR PASS: Date={latest['timestamp']}, ATR={current_atr:.5f} >= Min={min_atr_price:.5f}")
        
        # --- FIX 2.3b: Volume Filter Check (Event-Driven Parity) ---
        volume_ok = latest.get('volume_ok', True)
        if not volume_ok:
            self.logger.debug(f"NO TRADE: Volume filter failed")
            return None
        
        # --- FIX: Gap Filter Check (Event-Driven Parity) ---
        gap_ok = latest.get('gap_ok', True)
        if not gap_ok:
            self.logger.debug(f"NO TRADE: Gap filter failed")
            return None
        
        asia_range_pips = latest.get('asia_range_pips', 0)
        if asia_range_pips > self.params.max_range_pips:
            self.logger.debug(f"NO TRADE: Asia range {asia_range_pips:.1f} pips > max {self.params.max_range_pips}")
            return None
        if asia_range_pips < self.params.min_range_pips:
            self.logger.debug(f"NO TRADE: Asia range {asia_range_pips:.1f} pips < min {self.params.min_range_pips}")
            return None
        
        # Check for existing positions
        if current_positions:
            return None
        
        current_price = latest['close']
        long_entry = latest.get('long_entry_level')
        short_entry = latest.get('short_entry_level')
        midpoint = latest.get('asia_midpoint')
        asia_low = latest.get('asia_low')  # FIX 1.1: Define before usage
        asia_high = latest.get('asia_high')  # FIX 1.1: Define before usage
        
        if pd.isna(long_entry) or pd.isna(short_entry) or pd.isna(midpoint) or pd.isna(asia_low) or pd.isna(asia_high):
            return None
        
        pip_multiplier = 10000
        
        # LONG ENTRY: Price breaks above Asia High + buffer
        if current_price > long_entry:
            stop_loss = asia_low  # Opposite boundary stop

            risk_pips = (current_price - stop_loss) * pip_multiplier
            take_profit = current_price + (current_price - stop_loss) * self.params.risk_reward_ratio
            
            # Calculate SL/TP as percentages (matching vectorized for transparency)
            sl_pct = (current_price - stop_loss) / current_price
            tp_pct = sl_pct * self.params.risk_reward_ratio
            
            self.logger.info(f"LONG SIGNAL: Price {current_price:.5f} > Entry {long_entry:.5f}, "
                           f"SL={stop_loss:.5f}, TP={take_profit:.5f}, Risk={risk_pips:.1f} pips")
            
            self._mark_trade_taken(latest)
            
            return {
                'signal': StrategySignal.BUY,
                'entry_price': current_price,  # Signal price (actual fill at next bar open)
                'stop_loss': stop_loss,
                'take_profit': take_profit,
                'sl_pct': sl_pct,  # Parity with vectorized
                'tp_pct': tp_pct,  # Parity with vectorized
                'volume': self._calculate_position_size(risk_pips),
                'sl_pips': risk_pips,
                'reason': f'London Breakout LONG: Asia range {asia_range_pips:.1f} pips',
                'execution_note': 'Entry at next bar open; SL/TP are absolute levels'
            }
        
        # SHORT ENTRY: Price breaks below Asia Low - buffer
        elif current_price < short_entry:
            stop_loss = asia_high  # Opposite boundary stop

            risk_pips = (stop_loss - current_price) * pip_multiplier
            take_profit = current_price - (stop_loss - current_price) * self.params.risk_reward_ratio
            
            # Calculate SL/TP as percentages (matching vectorized for transparency)
            sl_pct = (stop_loss - current_price) / current_price
            tp_pct = sl_pct * self.params.risk_reward_ratio
            
            self.logger.info(f"SHORT SIGNAL: Price {current_price:.5f} < Entry {short_entry:.5f}, "
                           f"SL={stop_loss:.5f}, TP={take_profit:.5f}, Risk={risk_pips:.1f} pips")
            
            self._mark_trade_taken(latest)
            
            return {
                'signal': StrategySignal.SELL,
                'entry_price': current_price,  # Signal price (actual fill at next bar open)
                'stop_loss': stop_loss,
                'take_profit': take_profit,
                'sl_pct': sl_pct,  # Parity with vectorized
                'tp_pct': tp_pct,  # Parity with vectorized
                'volume': self._calculate_position_size(risk_pips),
                'sl_pips': risk_pips,
                'reason': f'London Breakout SHORT: Asia range {asia_range_pips:.1f} pips',
                'execution_note': 'Entry at next bar open; SL/TP are absolute levels'
            }
        
        return None
    
    def _generate_exit_signal(
        self,
        market_data_df: pd.DataFrame,
        position: Any
    ) -> Optional[Dict[str, Any]]:
        """
        Generate exit signal for open positions.
        
        EXIT CONDITIONS:
        1. Stop loss hit (at midpoint)
        2. Take profit hit
        3. Hard exit at 16:00 UTC (end of London session)
        """
        if market_data_df.empty:
            return None
        
        latest = market_data_df.iloc[-1]
        
        # Hard exit at 16:00 UTC
        if latest.get('is_exit_time', False):
            self.logger.info(f"HARD EXIT: End of London session (16:00 UTC)")
            
            # Determine correct close signal based on position direction
            close_signal = StrategySignal.CLOSE_LONG if position.action == OrderAction.BUY else StrategySignal.CLOSE_SHORT
            
            return {
                'signal': close_signal,
                'position_id': position.position_id if hasattr(position, 'position_id') else None,
                'reason': 'End of Day Exit (16:00 UTC)'
            }
        
        # Note: SL/TP are handled by the platform or backtest engine
        # This method mainly handles time-based exits
        
        return None
    
    def _mark_trade_taken(self, latest: pd.Series) -> None:
        """Mark that a trade was taken today."""
        self.trade_taken_today = True
        if hasattr(latest['timestamp'], 'date'):
            self.last_trade_date = latest['timestamp'].date()
    
    def _calculate_position_size(self, risk_pips: float) -> float:
        """
        Calculate position size based on risk.
        
        Default implementation - can be overridden for fixed fractional.
        """
        # Simple fixed lot for now - should be enhanced with proper risk management
        return 0.1
    
    def reset_daily_state(self) -> None:
        """Reset daily trading state (call at start of new day)."""
        self.trade_taken_today = False
        self.asia_high = None
        self.asia_low = None
        self.asia_midpoint = None
        self.asia_range_pips = None


# Export
__all__ = ['LondonBreakoutStrategy', 'LondonBreakoutParams']

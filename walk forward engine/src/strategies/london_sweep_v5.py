#!/usr/bin/env python3
"""
London Sweep V5 - RSI(7) Divergence Strategy

CHANGE FROM V4: Replace delta divergence with RSI(7) divergence.
- V4's bar-based delta proxy WORSENED performance (PF 5.99 → 0.40)
- RSI divergence detects momentum exhaustion without tick data

RSI DIVERGENCE LOGIC:
- Upside sweep + RSI < recent peak = bearish divergence → SHORT
- Downside sweep + RSI > recent trough = bullish divergence → LONG
"""

import logging
from datetime import datetime
from typing import Dict, List, Any, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel, field_validator, model_validator

from src.strategies.base_strategy import BaseStrategy


class LondonSweepV5Params(BaseModel):
    """V5 parameters with RSI divergence instead of delta divergence."""
    
    # ===== SESSION TIMES (Research-aligned from V4) =====
    asia_start_hour: int = 0
    asia_end_hour: int = 7            # Research: 00:00-07:00 (7 hours)
    sweep_start_hour: int = 7
    sweep_end_hour: int = 9           # Research: 07:00-09:00 (2 hours)
    time_stop_hour: int = 10          # Research: exit by 10:00
    
    # ===== SWEEP THRESHOLDS (Research-aligned from V4) =====
    sweep_min_pips: float = 5.0       # Research: >=5
    sweep_max_pips: float = 20.0      # Research: <=25
    
    # ===== RANGE FILTER (Research-aligned from V4) =====
    min_range_pips: float = 10.0
    max_range_pips: float = 40.0      # Research: <=40
    
    # ===== SL/TP (Same as V3/V4) =====
    sl_buffer_pips: float = 3.0
    tp_mode: str = "range_mid"
    
    # ===== RSI DIVERGENCE (NEW in V5 - replaces delta divergence) =====
    rsi_period: int = 7               # RSI calculation period
    rsi_lookback: int = 8             # Bars to check for divergence
    use_rsi_divergence: bool = True   # Enable RSI divergence filter
    
    class Config:
        extra = 'forbid'
    
    @field_validator('sweep_min_pips', 'sweep_max_pips', 'min_range_pips', 'max_range_pips', 'sl_buffer_pips')
    @classmethod
    def must_be_positive(cls, v: float, info) -> float:
        if v <= 0:
            raise ValueError(f'{info.field_name} must be > 0')
        return v
    
    @model_validator(mode='after')
    def validate_ranges(self) -> 'LondonSweepV5Params':
        if self.sweep_max_pips <= self.sweep_min_pips:
            raise ValueError('sweep_max_pips must be > sweep_min_pips')
        if self.max_range_pips <= self.min_range_pips:
            raise ValueError('max_range_pips must be > min_range_pips')
        return self


def calculate_rsi(close: np.ndarray, period: int = 7) -> np.ndarray:
    """
    Calculate RSI indicator.
    
    Returns RSI values with shift(1) built-in to prevent lookahead.
    """
    close_series = pd.Series(close)
    delta = close_series.diff()
    
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    
    rs = avg_gain / (avg_loss + 1e-10)
    rsi = 100 - (100 / (1 + rs))
    
    # CRITICAL: Shift by 1 to prevent lookahead bias
    return rsi.shift(1).values


class LondonSweepV5Strategy(BaseStrategy):
    """
    London Sweep V5 - RSI(7) Divergence Strategy.
    
    Uses RSI divergence instead of delta divergence as CVD proxy.
    """
    
    def __init__(
        self,
        strategy_params,
        config,
        platform_adapter,
        market_data_manager,
        logger: logging.Logger,
        asset_profile_key: str
    ):
        super().__init__(
            strategy_params=strategy_params,
            config=config,
            platform_adapter=platform_adapter,
            market_data_manager=market_data_manager,
            logger=logger,
            asset_profile_key=asset_profile_key
        )
        self.logger.info("LondonSweepV5Strategy (RSI DIVERGENCE) initialized")
    
    def _initialize_strategy_parameters(self) -> None:
        """Initialize V5 parameters."""
        if hasattr(self, 'config') and self.config is not None:
            try:
                super()._initialize_strategy_parameters()
            except AttributeError:
                pass
        
        params = self.strategy_params
        
        self.params = LondonSweepV5Params(
            asia_start_hour=getattr(params, 'asia_start_hour', 0),
            asia_end_hour=getattr(params, 'asia_end_hour', 7),
            sweep_start_hour=getattr(params, 'sweep_start_hour', 7),
            sweep_end_hour=getattr(params, 'sweep_end_hour', 9),
            time_stop_hour=getattr(params, 'time_stop_hour', 10),
            sweep_min_pips=getattr(params, 'sweep_min_pips', 5.0),
            sweep_max_pips=getattr(params, 'sweep_max_pips', 20.0),
            min_range_pips=getattr(params, 'min_range_pips', 10.0),
            max_range_pips=getattr(params, 'max_range_pips', 40.0),
            sl_buffer_pips=getattr(params, 'sl_buffer_pips', 3.0),
            tp_mode=getattr(params, 'tp_mode', 'range_mid'),
            rsi_period=getattr(params, 'rsi_period', 7),
            rsi_lookback=getattr(params, 'rsi_lookback', 8),
            use_rsi_divergence=getattr(params, 'use_rsi_divergence', True),
        )
        
        self.logger.info(
            f"V5 RSI DIVERGENCE: RSI({self.params.rsi_period}) lookback={self.params.rsi_lookback}, "
            f"Asian 00-07, Sweep 07-09, depth {self.params.sweep_min_pips}-{self.params.sweep_max_pips}pips"
        )
    
    def _initialize_indicators(self) -> None:
        pass
    
    def _get_minimum_data_length(self) -> int:
        return 100
    
    def _get_required_columns(self) -> List[str]:
        return ['open', 'high', 'low', 'close', 'volume']
    
    def _get_indicator_columns(self, market_data_df=None) -> List[str]:
        return []
    
    def generate_vectorized_signals(
        self, 
        data: pd.DataFrame, 
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate V5 signals with RSI divergence.
        
        RSI DIVERGENCE LOGIC:
        - Upside sweep + RSI_now < RSI_max_recent = bearish → SHORT
        - Downside sweep + RSI_now > RSI_min_recent = bullish → LONG
        """
        params = params or self.strategy_params
        
        # ===== EXTRACT PARAMETERS =====
        asia_start = getattr(params, 'asia_start_hour', 0)
        asia_end = getattr(params, 'asia_end_hour', 7)
        sweep_start = getattr(params, 'sweep_start_hour', 7)
        sweep_end = getattr(params, 'sweep_end_hour', 9)
        time_stop_hour = getattr(params, 'time_stop_hour', 10)
        
        sweep_min_pips = getattr(params, 'sweep_min_pips', 5.0)
        sweep_max_pips = getattr(params, 'sweep_max_pips', 20.0)
        
        min_range_pips = getattr(params, 'min_range_pips', 10.0)
        max_range_pips = getattr(params, 'max_range_pips', 40.0)
        
        sl_buffer_pips = getattr(params, 'sl_buffer_pips', 3.0)
        tp_mode = getattr(params, 'tp_mode', 'range_mid')
        
        rsi_period = getattr(params, 'rsi_period', 7)
        rsi_lookback = getattr(params, 'rsi_lookback', 8)
        use_rsi_div = getattr(params, 'use_rsi_divergence', True)
        
        # Convert pips to price (EURUSD)
        pip_value = 0.0001
        sweep_min = sweep_min_pips * pip_value
        sweep_max = sweep_max_pips * pip_value
        min_range = min_range_pips * pip_value
        max_range = max_range_pips * pip_value
        sl_buffer = sl_buffer_pips * pip_value
        
        # ===== PREPARE DATA =====
        if 'timestamp' not in data.columns:
            if isinstance(data.index, pd.DatetimeIndex):
                data = data.copy()
                data['timestamp'] = data.index
            else:
                raise ValueError("Data must have timestamp column or DatetimeIndex")
        
        n = len(data)
        ts = pd.to_datetime(data['timestamp'])
        
        if ts.dt.tz is None:
            ts = ts.dt.tz_localize('UTC')
        else:
            ts = ts.dt.tz_convert('UTC')
        
        hours = ts.dt.hour
        dates = ts.dt.date
        
        close = data['close'].values
        high = data['high'].values
        low = data['low'].values
        open_ = data['open'].values if 'open' in data.columns else close
        
        next_open = pd.Series(open_).shift(-1).values
        
        self.logger.info(f"V5 Signal Gen: {n} rows, RSI({rsi_period}) lookback={rsi_lookback}")
        
        # ===================================================================
        # STEP 1: Calculate RSI with shift(1) for lookahead prevention
        # ===================================================================
        rsi = calculate_rsi(close, rsi_period)
        
        # Calculate rolling max/min RSI for divergence detection
        rsi_series = pd.Series(rsi)
        rsi_rolling_max = rsi_series.rolling(rsi_lookback).max().shift(1).values
        rsi_rolling_min = rsi_series.rolling(rsi_lookback).min().shift(1).values
        
        # ===================================================================
        # STEP 2: Calculate Asian range (00:00-07:00)
        # ===================================================================
        is_asia = (hours >= asia_start) & (hours < asia_end)
        
        temp_df = pd.DataFrame({
            'high': high,
            'low': low,
            'date': dates,
            'is_asia': is_asia
        })
        
        asia_groups = temp_df[is_asia].groupby('date')
        asia_agg = pd.DataFrame({
            'asia_high': asia_groups['high'].max(),
            'asia_low': asia_groups['low'].min(),
            'bar_count': asia_groups.size()
        })
        
        valid_asia = asia_agg[asia_agg['bar_count'] >= 24].copy()
        
        # Map back and shift by 1 to prevent lookahead
        asia_high = temp_df['date'].map(valid_asia['asia_high']).shift(1).values
        asia_low = temp_df['date'].map(valid_asia['asia_low']).shift(1).values
        asia_range = asia_high - asia_low
        asia_mid = (asia_high + asia_low) / 2
        
        self.logger.info(f"Asian sessions: {len(valid_asia)} valid days")
        
        # ===================================================================
        # STEP 3: Range filter (10-40 pips)
        # ===================================================================
        valid_range = (
            ~np.isnan(asia_high) & 
            ~np.isnan(asia_low) & 
            (asia_range >= min_range) & 
            (asia_range <= max_range)
        )
        
        # ===================================================================
        # STEP 4: Detect sweeps (07:00-09:00, 5-20 pips)
        # ===================================================================
        hours_np = hours.values
        is_sweep_window = (hours_np >= sweep_start) & (hours_np < sweep_end)
        
        upside_sweep_depth = high - asia_high
        upside_sweep = (
            is_sweep_window & 
            valid_range &
            (upside_sweep_depth >= sweep_min) &
            (upside_sweep_depth <= sweep_max)
        )
        
        downside_sweep_depth = asia_low - low
        downside_sweep = (
            is_sweep_window & 
            valid_range &
            (downside_sweep_depth >= sweep_min) &
            (downside_sweep_depth <= sweep_max)
        )
        
        self.logger.info(f"Sweeps: upside={np.sum(upside_sweep)}, downside={np.sum(downside_sweep)}")
        
        # ===================================================================
        # STEP 5: Rejection confirmation (close inside range)
        # ===================================================================
        upside_rejected = close < asia_high
        downside_rejected = close > asia_low
        
        # ===================================================================
        # STEP 6: RSI DIVERGENCE (NEW - replaces delta divergence)
        # ===================================================================
        if use_rsi_div:
            # BEARISH DIVERGENCE for SHORT:
            # Price makes higher high (breaks Asian high) BUT
            # RSI fails to make higher high (below recent peak)
            bearish_rsi_divergence = (
                ~np.isnan(rsi) &
                ~np.isnan(rsi_rolling_max) &
                (rsi < rsi_rolling_max)  # RSI lower than recent peak
            )
            
            # BULLISH DIVERGENCE for LONG:
            # Price makes lower low (breaks Asian low) BUT
            # RSI fails to make lower low (above recent trough)
            bullish_rsi_divergence = (
                ~np.isnan(rsi) &
                ~np.isnan(rsi_rolling_min) &
                (rsi > rsi_rolling_min)  # RSI higher than recent trough
            )
            
            bearish_count = np.sum(upside_sweep & bearish_rsi_divergence)
            bullish_count = np.sum(downside_sweep & bullish_rsi_divergence)
            self.logger.info(f"RSI divergence matches: bearish={bearish_count}, bullish={bullish_count}")
        else:
            bearish_rsi_divergence = np.ones(n, dtype=bool)
            bullish_rsi_divergence = np.ones(n, dtype=bool)
        
        # ===================================================================
        # STEP 7: Entry signals
        # ===================================================================
        short_entries = (
            upside_sweep &
            upside_rejected &
            bearish_rsi_divergence &
            ~np.isnan(next_open)
        )
        
        long_entries = (
            downside_sweep &
            downside_rejected &
            bullish_rsi_divergence &
            ~np.isnan(next_open)
        )
        
        total_entries = np.sum(long_entries) + np.sum(short_entries)
        self.logger.info(f"V5 Entries: LONG={np.sum(long_entries)}, SHORT={np.sum(short_entries)}, TOTAL={total_entries}")
        
        # ===================================================================
        # STEP 8: Time stop (10:00)
        # ===================================================================
        hours_series = pd.Series(hours_np)
        time_stop_mask = (hours_series >= time_stop_hour) & (hours_series.shift(1) < time_stop_hour)
        time_stops = time_stop_mask.fillna(False).values
        
        # ===================================================================
        # STEP 9: Calculate SL/TP
        # ===================================================================
        sl_pct_arr = np.full_like(close, np.nan)
        tp_pct_arr = np.full_like(close, np.nan)
        
        # For SHORT entries
        if np.any(short_entries):
            entry_idx = np.where(short_entries)[0]
            entry_prices = next_open[entry_idx]
            sweep_highs = high[entry_idx]
            sl_prices = sweep_highs + sl_buffer
            sl_pct = (sl_prices - entry_prices) / entry_prices
            
            if tp_mode == 'range_mid':
                tp_prices = asia_mid[entry_idx]
            else:
                tp_prices = asia_low[entry_idx]
            tp_pct = (entry_prices - tp_prices) / entry_prices
            
            sl_pct_arr[entry_idx] = np.clip(sl_pct, 0.0001, 0.05)
            tp_pct_arr[entry_idx] = np.clip(tp_pct, 0.0001, 0.05)
        
        # For LONG entries
        if np.any(long_entries):
            entry_idx = np.where(long_entries)[0]
            entry_prices = next_open[entry_idx]
            sweep_lows = low[entry_idx]
            sl_prices = sweep_lows - sl_buffer
            sl_pct = (entry_prices - sl_prices) / entry_prices
            
            if tp_mode == 'range_mid':
                tp_prices = asia_mid[entry_idx]
            else:
                tp_prices = asia_high[entry_idx]
            tp_pct = (tp_prices - entry_prices) / entry_prices
            
            sl_pct_arr[entry_idx] = np.clip(sl_pct, 0.0001, 0.05)
            tp_pct_arr[entry_idx] = np.clip(tp_pct, 0.0001, 0.05)
        
        return {
            'long_entries': long_entries.astype(bool),
            'long_exits': time_stops.astype(bool),
            'short_entries': short_entries.astype(bool),
            'short_exits': time_stops.astype(bool),
            'sl_stop': sl_pct_arr,
            'tp_stop': tp_pct_arr
        }
    
    def _generate_strategy_signal(self, market_data_df, active_position, latest_tick):
        """Event-driven mode - delegates to vectorized."""
        signals = self.generate_vectorized_signals(market_data_df)
        if signals['long_entries'][-1]:
            return {'action': 'buy', 'size': 1.0}
        elif signals['short_entries'][-1]:
            return {'action': 'sell', 'size': 1.0}
        return None

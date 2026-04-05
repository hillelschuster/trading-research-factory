# src/strategies/ny_pm_reversion.py
"""
NY PM Reversion Strategy - Mean Reversion Shield.

This strategy trades the structural anomaly following the London Fix
during the NY PM session (17:00-21:00 UTC).

Phase 3 Update: Volatility Gating (ATR Filter)
"""

import pandas as pd
import numpy as np
from datetime import datetime, time, timezone
from typing import Dict, Any, Optional, List, TYPE_CHECKING
from dataclasses import dataclass
import logging

from .base_strategy import BaseStrategy
from src.custom_types import StrategyParameters
from src.core.enums import StrategySignal, OrderAction

if TYPE_CHECKING:
    from src.data_handler.market_data_manager import MarketDataManager
    from src.api_connector.base_connector import PlatformInterface
    from src.config_manager import AppConfig


@dataclass
class NYPMReversionParams:
    """Parameters for NY PM Reversion strategy."""
    # Session Timing (UTC)
    trade_start_hour: int = 17      # 17:00 UTC
    trade_end_hour: int = 21        # 21:00 UTC (exclusive)
    hard_exit_hour: int = 20        # 20:55 UTC
    hard_exit_minute: int = 55
    vwap_anchor_hour: int = 16      # 16:00 UTC reset
    
    # Bollinger Bands
    bb_period: int = 20
    bb_std: float = 2.0
    
    # RSI
    rsi_period: int = 7             # Phase 3: Reverted to 7
    
    # ADX Filter
    adx_period: int = 14
    max_adx: float = 25.0  # Phase 3.0: Lowered from 30 for stricter range filter
    
    # Entry Parameters
    entry_offset_pips: float = 0.5  # Phase 3: Outside Band (+0.5 pips)
    
    # RSI Filters
    min_rsi: float = 20  # Phase 3.0: Tightened from 25
    max_rsi: float = 80  # Phase 3.0: Tightened from 75
    
    # Position Management
    one_trade_per_day: bool = True
    
    # Volatility Filter (Phase 3)
    min_daily_atr_pips: float = 60.0  # Legacy: Fixed pips (for backwards compat)
    
    # Volatility Filter (Phase 5: Normalized)
    atr_gate_percent: float = 1.2  # Dynamic: ATR must be >= X% of price
    
    # Stop Loss (Phase 3.0: ATR-based)
    atr_stop_mult: float = 2.0  # Stop = Entry ± (atr_stop_mult × ATR(14))


class NYPMReversionStrategy(BaseStrategy):
    """
    NY PM Reversion Strategy implementation.
    
    Trades mean reversion at Upper Bollinger Band during NY PM session.
    Uses VWAP anchored at 16:00 UTC as take-profit target.
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
        """Initialize NY PM Reversion strategy."""
        super().__init__(
            strategy_params=strategy_params,
            config=config,
            platform_adapter=platform_adapter,
            market_data_manager=market_data_manager,
            logger=logger,
            asset_profile_key=asset_profile_key
        )
        
        # Strategy-specific state
        self.trade_taken_today: bool = False
        self.last_trade_date: Optional[datetime] = None
        
        self.logger.info("NYPMReversionStrategy initialized")
    
    def _initialize_strategy_parameters(self) -> None:
        """Initialize strategy-specific parameters from config."""
        super()._initialize_strategy_parameters()
        
        params = self.strategy_params
        
        self.params = NYPMReversionParams(
            trade_start_hour=getattr(params, 'trade_start_hour', 17),
            trade_end_hour=getattr(params, 'trade_end_hour', 21),
            hard_exit_hour=getattr(params, 'hard_exit_hour', 20),
            hard_exit_minute=getattr(params, 'hard_exit_minute', 55),
            vwap_anchor_hour=getattr(params, 'vwap_anchor_hour', 16),
            bb_period=getattr(params, 'bb_period', 20),
            bb_std=getattr(params, 'bb_std', 2.0),
            rsi_period=getattr(params, 'rsi_period', 7),
            adx_period=getattr(params, 'adx_period', 14),
            max_adx=getattr(params, 'max_adx', 30.0),
            entry_offset_pips=getattr(params, 'entry_offset_pips', 0.5),
            min_rsi=getattr(params, 'min_rsi', 25),
            max_rsi=getattr(params, 'max_rsi', 75),
            one_trade_per_day=getattr(params, 'one_trade_per_day', True),
            min_daily_atr_pips=getattr(params, 'min_daily_atr_pips', 60.0),
        )
        
        self.logger.info(
            f"NY PM Reversion params: BB({self.params.bb_period}, {self.params.bb_std}), "
            f"RSI({self.params.rsi_period}), ADX<{self.params.max_adx}, "
            f"Offset={self.params.entry_offset_pips}, MinATR={self.params.min_daily_atr_pips}"
        )
    
    def _initialize_indicators(self) -> None:
        """Initialize indicator placeholders."""
        pass
    
    def _get_minimum_data_length(self) -> int:
        """Minimum bars needed for indicator calculation."""
        # Need BB(20), ADX(14) - at least 30 bars
        return max(self.params.bb_period, self.params.adx_period) + 10
    
    def _get_required_columns(self) -> List[str]:
        """Required OHLCV columns."""
        return ['open', 'high', 'low', 'close', 'volume']
    
    def _get_indicator_columns(self, market_data_df: Optional[pd.DataFrame] = None) -> List[str]:
        """Indicator columns to check for NaN."""
        return ['upper_bb', 'middle_bb', 'lower_bb', 'rsi', 'adx']
    
    # =========================================================================
    # INDICATOR CALCULATIONS
    # =========================================================================
    
    def _calculate_bollinger_bands(self, close: pd.Series, period: int, std: float) -> Dict[str, pd.Series]:
        """Calculate Bollinger Bands."""
        sma = close.rolling(window=period).mean()
        std_dev = close.rolling(window=period).std()
        
        return {
            'middle_bb': sma,
            'upper_bb': sma + (std * std_dev),
            'lower_bb': sma - (std * std_dev)
        }
    
    def _calculate_rsi(self, close: pd.Series, period: int) -> pd.Series:
        """Calculate RSI."""
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0)
        loss = (-delta).where(delta < 0, 0.0)
        
        avg_gain = gain.rolling(window=period, min_periods=period).mean()
        avg_loss = loss.rolling(window=period, min_periods=period).mean()
        
        rs = avg_gain / avg_loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))
        
        return rsi.fillna(50)  # Neutral RSI if calculation fails
    
    def _calculate_adx(self, high: pd.Series, low: pd.Series, close: pd.Series, period: int) -> pd.Series:
        """Calculate ADX (Average Directional Index)."""
        # True Range
        prev_close = close.shift(1)
        tr1 = high - low
        tr2 = (high - prev_close).abs()
        tr3 = (low - prev_close).abs()
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        
        # Directional Movement
        up_move = high - high.shift(1)
        down_move = low.shift(1) - low
        
        # Keep as Series with original index
        plus_dm = pd.Series(
            np.where((up_move > down_move) & (up_move > 0), up_move, 0),
            index=high.index
        )
        minus_dm = pd.Series(
            np.where((down_move > up_move) & (down_move > 0), down_move, 0),
            index=low.index
        )
        
        # Smoothed averages - all keep original index
        atr = tr.rolling(window=period).mean()
        plus_di = 100 * plus_dm.rolling(window=period).mean() / atr
        minus_di = 100 * minus_dm.rolling(window=period).mean() / atr
        
        # ADX
        dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
        adx = dx.rolling(window=period).mean()
        
        return adx.fillna(0)
    
    def _calculate_anchored_vwap(
        self, 
        data: pd.DataFrame,
        anchor_hour: int = 16
    ) -> pd.Series:
        """Calculate Anchored VWAP."""
        if 'timestamp' not in data.columns:
            raise ValueError("Data must have 'timestamp' column for VWAP calculation")
        
        ts = pd.to_datetime(data['timestamp'])
        hours = ts.dt.hour
        dates = ts.dt.date
        
        typical_price = (data['high'] + data['low'] + data['close']) / 3
        volume = data['volume'].copy()
        middle_bb = data['middle_bb'] if 'middle_bb' in data.columns else typical_price.rolling(20).mean()
        vwap = pd.Series(index=data.index, dtype=float)
        unique_dates = dates.unique()
        
        for date in unique_dates:
            date_mask = dates == date
            date_indices = data.index[date_mask]
            
            if len(date_indices) == 0:
                continue
                
            date_hours = hours[date_mask]
            anchor_condition = date_hours >= anchor_hour
            
            if not anchor_condition.any():
                vwap.loc[date_indices] = middle_bb.loc[date_indices]
                continue
            
            pre_anchor_mask = date_mask & (hours < anchor_hour)
            vwap.loc[data.index[pre_anchor_mask]] = middle_bb.loc[data.index[pre_anchor_mask]]
            
            post_anchor_mask = date_mask & (hours >= anchor_hour)
            post_indices = data.index[post_anchor_mask]
            
            if len(post_indices) == 0:
                continue
            
            tp_vol = typical_price.loc[post_indices] * volume.loc[post_indices]
            cum_tp_vol = tp_vol.cumsum()
            cum_vol = volume.loc[post_indices].cumsum()
            safe_vol = cum_vol.replace(0, np.nan)
            raw_vwap = cum_tp_vol / safe_vol
            vwap.loc[post_indices] = raw_vwap.fillna(middle_bb.loc[post_indices])
            
        vwap = vwap.fillna(middle_bb)
        return vwap
    
    def _calculate_daily_atr(self, data: pd.DataFrame, period: int = 14) -> pd.Series:
        """Calculate Daily ATR from M15 data."""
        # Resample to Daily
        daily = data.resample('D', on='timestamp').agg({
            'high': 'max',
            'low': 'min',
            'close': 'last'
        }).dropna()
        
        # Calculate TR
        prev_close = daily['close'].shift(1)
        tr1 = daily['high'] - daily['low']
        tr2 = (daily['high'] - prev_close).abs()
        tr3 = (daily['low'] - prev_close).abs()
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        
        # Calculate ATR
        atr = tr.rolling(window=period).mean()
        
        # Shift strictly to avoid lookahead (uses previous day's ATR for today)
        atr_shifted = atr.shift(1)
        
        return atr_shifted

    def _simulate_limit_order_fill(
        self, 
        limit_price: pd.Series, 
        bar_high: pd.Series,
        bar_low: pd.Series,
        is_sell: bool
    ) -> pd.Series:
        """Simulate limit order fill."""
        if is_sell:
            return bar_high >= limit_price
        else:
            return bar_low <= limit_price
    
    # =========================================================================
    # VECTORIZED SIGNAL GENERATION
    # =========================================================================
    
    def generate_vectorized_signals(
        self, 
        data: pd.DataFrame, 
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Generate NY PM Reversion signals arrays for vectorbt."""
        params = params or self.params
        
        # Extract parameters
        trade_start_hour = getattr(params, 'trade_start_hour', 17)
        trade_start_minute = getattr(params, 'trade_start_minute', 0)
        trade_end_hour = getattr(params, 'trade_end_hour', 21)
        trade_end_minute = getattr(params, 'trade_end_minute', 0)
        hard_exit_hour = getattr(params, 'hard_exit_hour', 20)
        hard_exit_minute = getattr(params, 'hard_exit_minute', 55)
        vwap_anchor_hour = getattr(params, 'vwap_anchor_hour', 16)
        bb_period = getattr(params, 'bb_period', 20)
        bb_std = getattr(params, 'bb_std', 2.0)
        rsi_period = getattr(params, 'rsi_period', 7)
        adx_period = getattr(params, 'adx_period', 14)
        max_adx = getattr(params, 'max_adx', 30.0)
        entry_offset_pips = getattr(params, 'entry_offset_pips', 0.5)
        min_rsi = getattr(params, 'min_rsi', 25)
        max_rsi = getattr(params, 'max_rsi', 75)
        min_daily_atr_pips = getattr(params, 'min_daily_atr_pips', 60.0)
        pip_multiplier = getattr(params, 'pip_multiplier', 10000.0)
        atr_gate_percent = getattr(params, 'atr_gate_percent', 0.0)  # 0 = use legacy pips
        atr_stop_mult = getattr(params, 'atr_stop_mult', 2.0)  # Phase 3.0: ATR-based stop multiplier
        
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
        
        # Fix for Unix MS timestamps being read as NS (resulting in 1970 dates)
        if len(ts) > 0 and ts.iloc[0].year < 1990:
             ts = pd.to_datetime(data['timestamp'], unit='ms')

        hours = ts.dt.hour
        minutes = ts.dt.minute
        
        self.logger.info(f"Vectorized Signal Gen: {n} rows. Range: {ts.min()} to {ts.max()}")
        
        close = data['close']
        high = data['high']
        low = data['low']
        
        # Indicators
        bb = self._calculate_bollinger_bands(close, bb_period, bb_std)
        data['upper_bb'] = bb['upper_bb']
        data['middle_bb'] = bb['middle_bb']
        data['lower_bb'] = bb['lower_bb']
        
        rsi = self._calculate_rsi(close, rsi_period)
        adx = self._calculate_adx(high, low, close, adx_period)
        vwap = self._calculate_anchored_vwap(data, vwap_anchor_hour)
        
        # =====================================================================
        # PHASE 2: SMA(800) MEGA-TREND FILTER (Regime Awareness)
        # SMA(800) on M15 ≈ SMA(200) on 1H (both cover 200 hours of data)
        # =====================================================================
        sma_800 = close.rolling(800, min_periods=100).mean()  # Allow partial warmup
        strong_trend = adx > 30
        
        # Bull Regime: Price > SMA(800) AND ADX > 30 → Block Shorts
        trend_bull = (close > sma_800) & strong_trend
        # Bear Regime: Price < SMA(800) AND ADX > 30 → Block Longs
        trend_bear = (close < sma_800) & strong_trend
        
        # Trend Filter Masks (True = ALLOWED to trade this direction)
        allow_short = ~trend_bull  # Block shorts in strong bull
        allow_long = ~trend_bear   # Block longs in strong bear
        
        # Step 2: Calculate Daily ATR (Vol Regime)
        daily_atr = self._calculate_daily_atr(data, 14)
        
        # Map ATR to M15 bars
        data_dates = ts.dt.date
        daily_atr.index = daily_atr.index.date
        atr_series = pd.Series(data_dates).map(daily_atr)
        
        # Step 3: ATR Gate (Dynamic Percentage-Based)
        if atr_gate_percent > 0:
            # NEW: Dynamic gate based on price level
            # Calculate previous day's close for each bar
            daily_close = data.set_index(ts).resample('D')['close'].last().shift(1)
            daily_close.index = daily_close.index.date
            close_series = pd.Series(data_dates).map(daily_close)
            atr_threshold = close_series * (atr_gate_percent / 100)
            atr_gate = atr_series >= atr_threshold
            self.logger.info(
                f"Indicators calc: BB({bb_period},{bb_std}), RSI({rsi_period}), "
                f"ADX({adx_period}), ATR Gate: {atr_gate_percent}% of Price (Dynamic)"
            )
            # Log sample threshold for verification
            if len(close_series.dropna()) > 0:
                sample_price = close_series.dropna().iloc[0]
                sample_threshold = sample_price * (atr_gate_percent / 100)
                self.logger.info(f"  Sample: Price ${sample_price:.2f} -> Threshold ${sample_threshold:.2f}")
        else:
            # LEGACY: Fixed pips gate (backwards compatibility)
            atr_pips = atr_series * pip_multiplier
            atr_gate = atr_pips >= min_daily_atr_pips
            self.logger.info(
                f"Indicators calc: BB({bb_period},{bb_std}), RSI({rsi_period}), "
                f"ADX({adx_period}), ATR Gate: min {min_daily_atr_pips} pips (Legacy)"
            )
        
        # Step 4: Trade window check
        # Step 4: Trade window check
        # Convert to minutes from midnight for precision
        current_minute_of_day = hours * 60 + minutes
        start_minute_of_day = trade_start_hour * 60 + trade_start_minute
        end_minute_of_day = trade_end_hour * 60 + trade_end_minute
        
        is_trade_window = (current_minute_of_day >= start_minute_of_day) & (current_minute_of_day < end_minute_of_day)
        
        # Step 5: Filter checks
        adx_ok = adx < max_adx
        rsi_ok = (rsi >= min_rsi) & (rsi <= max_rsi)
        
        # =====================================================================
        # PHASE 2: FRICTION GATE (Microstructure Protection)
        # Only trade when potential profit > 3x transaction cost
        # For Gold: min_distance ~$0.90-$1.20 (depending on spread)
        # =====================================================================
        min_friction_dist = 0.9  # $0.90 minimum edge (configurable)
        distance_to_mean = (close - bb['middle_bb']).abs()
        friction_gate = distance_to_mean > min_friction_dist
        
        # =====================================================================
        # PHASE 2.1: VOLATILITY SPIKE PROTECTION (News Spike Filter)
        # Block entries when current candle range > 2 * ATR(14)
        # Prevents entering during erratic price action that causes slippage
        # =====================================================================
        import pandas_ta as ta
        intraday_atr = ta.atr(high, low, close, length=14)
        candle_range = high - low
        volatility_spike = candle_range > (2 * intraday_atr)
        spike_filter = ~volatility_spike  # True = OK to trade (no spike)
        
        # Combined filter (now includes friction gate AND spike filter)
        filters_ok = adx_ok & rsi_ok & atr_gate & friction_gate & spike_filter
        
        self.logger.info(
            f"Filter Rates: ATR>={min_daily_atr_pips}: {(atr_gate.sum()/n)*100:.1f}%"
        )
        
        # =====================================================================
        # PHASE 4: PINBAR CONFIRMATION LOGIC (Replaces Limit Orders)
        # =====================================================================
        
        open_ = data['open']
        
        # Setup Conditions (Price touches/exceeds BB)
        sell_setup = high > bb['upper_bb']  # Price pierced Upper BB
        buy_setup = low < bb['lower_bb']    # Price pierced Lower BB
        
        # Pinbar Detection
        body = (close - open_).abs()
        candle_max = pd.concat([close, open_], axis=1).max(axis=1)
        candle_min = pd.concat([close, open_], axis=1).min(axis=1)
        upper_wick = high - candle_max
        lower_wick = candle_min - low
        
        # Bearish Pinbar: Upper wick > 2x body (rejection at highs)
        bearish_pinbar = upper_wick > 2 * body
        
        # Bullish Pinbar: Lower wick > 2x body (rejection at lows)
        bullish_pinbar = lower_wick > 2 * body
        
        # ===== DIAGNOSTIC LOGGING =====
        self.logger.info(f"=== SIGNAL CHAIN DIAGNOSTICS (Phase 2) ===")
        self.logger.info(f"  Total bars: {n}")
        self.logger.info(f"  SMA(800) valid: {(~sma_800.isna()).sum()} ({(~sma_800.isna()).sum()/n*100:.1f}%)")
        self.logger.info(f"  Trend Bull (Block Shorts): {trend_bull.sum()} ({trend_bull.sum()/n*100:.1f}%)")
        self.logger.info(f"  Trend Bear (Block Longs): {trend_bear.sum()} ({trend_bear.sum()/n*100:.1f}%)")
        self.logger.info(f"  Friction Gate pass: {friction_gate.sum()} ({friction_gate.sum()/n*100:.1f}%)")
        self.logger.info(f"  Volatility Spike blocked: {volatility_spike.sum()} ({volatility_spike.sum()/n*100:.1f}%)")
        self.logger.info(f"  ATR Gate pass: {atr_gate.sum()} ({atr_gate.sum()/n*100:.1f}%)")
        self.logger.info(f"  Trade Window (13:30-16:00): {is_trade_window.sum()} ({is_trade_window.sum()/n*100:.1f}%)")
        self.logger.info(f"  ADX OK (<{max_adx}): {adx_ok.sum()} ({adx_ok.sum()/n*100:.1f}%)")
        self.logger.info(f"  RSI OK ({min_rsi}-{max_rsi}): {rsi_ok.sum()} ({rsi_ok.sum()/n*100:.1f}%)")
        self.logger.info(f"  All Filters Combined: {filters_ok.sum()} ({filters_ok.sum()/n*100:.1f}%)")
        self.logger.info(f"  Sell Setup (High > Upper BB): {sell_setup.sum()} ({sell_setup.sum()/n*100:.1f}%)")
        self.logger.info(f"  Buy Setup (Low < Lower BB): {buy_setup.sum()} ({buy_setup.sum()/n*100:.1f}%)")
        self.logger.info(f"  Bearish Pinbar: {bearish_pinbar.sum()} ({bearish_pinbar.sum()/n*100:.1f}%)")
        self.logger.info(f"  Bullish Pinbar: {bullish_pinbar.sum()} ({bullish_pinbar.sum()/n*100:.1f}%)")
        
        # Combine Setup + Trigger + Filters + TREND FILTER (Phase 2)
        short_signal_raw = (sell_setup & bearish_pinbar & filters_ok & is_trade_window 
                           & allow_short & ~bb['upper_bb'].isna())
        long_signal_raw = (buy_setup & bullish_pinbar & filters_ok & is_trade_window 
                          & allow_long & ~bb['lower_bb'].isna())
        
        self.logger.info(f"  SHORT signals (all combined): {short_signal_raw.sum()}")
        self.logger.info(f"  LONG signals (all combined): {long_signal_raw.sum()}")
        self.logger.info(f"=== END DIAGNOSTICS ===")
        
        # Shift to next bar for Market Order execution (enter at next bar's open)
        short_entries = short_signal_raw.shift(1).fillna(False).astype(bool)
        long_entries = long_signal_raw.shift(1).fillna(False).astype(bool)
        
        self.logger.info(
            f"Phase 4 Signals: {short_signal_raw.sum()} short setups, {long_signal_raw.sum()} long setups"
        )

        # Exits
        hard_exits = (hours == hard_exit_hour) & (minutes >= hard_exit_minute)
        short_exits = hard_exits | (close <= vwap)
        long_exits = hard_exits | (close >= vwap)
        
        # SL/TP - Phase 3.0: ATR-based dynamic stops
        sl_stop_arr = np.full(n, np.nan)
        tp_stop_arr = np.full(n, np.nan)
        
        # Shorts: SL = atr_stop_mult * ATR(14), TP = distance to VWAP
        if short_entries.sum() > 0:
            sl_dist = intraday_atr * atr_stop_mult  # Phase 3.0: ATR-based stop
            tp_dist = (bb['upper_bb'] - vwap).abs()
            sl_stop_arr[short_entries] = (sl_dist / close).clip(lower=0.001)[short_entries]
            tp_stop_arr[short_entries] = (tp_dist / close).clip(lower=0.001)[short_entries]
            
        # Longs: SL = atr_stop_mult * ATR(14), TP = distance to VWAP
        if long_entries.sum() > 0:
            sl_dist = intraday_atr * atr_stop_mult  # Phase 3.0: ATR-based stop
            tp_dist = (vwap - bb['lower_bb']).abs()
            sl_stop_arr[long_entries] = (sl_dist / close).clip(lower=0.001)[long_entries]
            tp_stop_arr[long_entries] = (tp_dist / close).clip(lower=0.001)[long_entries]
        
        return {
            'long_entries': long_entries.values.astype(bool),
            'long_exits': long_exits.values.astype(bool),
            'short_entries': short_entries.values.astype(bool),
            'short_exits': short_exits.values.astype(bool),
            'sl_stop': sl_stop_arr,
            'tp_stop': tp_stop_arr
        }

    # =========================================================================
    # EVENT-DRIVEN METHODS (for live trading)
    # =========================================================================
    
    def _generate_strategy_signal(
        self,
        market_data_df: pd.DataFrame,
        active_position: Optional[Any],
        latest_tick: Any
    ) -> Optional[Dict[str, Any]]:
        """Generate strategy signal for event-driven mode."""
        # Calculate indicators if not present
        if 'upper_bb' not in market_data_df.columns:
            market_data_df = self.calculate_indicators(market_data_df)
        
        # Check for exit first
        if active_position:
            exit_signal = self._generate_exit_signal(market_data_df, active_position)
            if exit_signal:
                return exit_signal
        
        # Check for entry
        if not active_position:
            entry_signal = self._generate_entry_signal(market_data_df, [])
            if entry_signal:
                return entry_signal
        
        return None
    
    def calculate_indicators(self, market_data_df: pd.DataFrame) -> pd.DataFrame:
        """Calculate all indicators for event-driven mode."""
        df = market_data_df.copy()
        
        # Ensure timestamp
        if 'timestamp' not in df.columns and 'Date' in df.columns:
            df['timestamp'] = pd.to_datetime(df['Date'])
        elif 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'])
        elif isinstance(df.index, pd.DatetimeIndex):
            df['timestamp'] = df.index.to_series()
        
        # Indicators
        bb = self._calculate_bollinger_bands(df['close'], self.params.bb_period, self.params.bb_std)
        df['upper_bb'] = bb['upper_bb']
        df['middle_bb'] = bb['middle_bb']
        df['lower_bb'] = bb['lower_bb']
        
        df['rsi'] = self._calculate_rsi(df['close'], self.params.rsi_period)
        df['adx'] = self._calculate_adx(df['high'], df['low'], df['close'], self.params.adx_period)
        df['vwap'] = self._calculate_anchored_vwap(df, self.params.vwap_anchor_hour)
        
        # Time columns
        df['hour'] = df['timestamp'].dt.hour
        df['minute'] = df['timestamp'].dt.minute
        
        # Trade window
        df['is_trade_window'] = (
            (df['hour'] >= self.params.trade_start_hour) & 
            (df['hour'] < self.params.trade_end_hour)
        )
        
        return df
    
    def _generate_entry_signal(
        self,
        market_data_df: pd.DataFrame,
        current_positions: List[Any]
    ) -> Optional[Dict[str, Any]]:
        """Generate entry signal for event-driven mode."""
        if market_data_df.empty:
            return None
        
        latest = market_data_df.iloc[-1]
        
        # Check trade window
        if not latest.get('is_trade_window', False):
            return None
            
        # Event driven ATR check would be here (omitted for now as Phase 3 focus is vectorized)
        
        return None
    
    def _generate_exit_signal(
        self,
        market_data_df: pd.DataFrame,
        position: Any
    ) -> Optional[Dict[str, Any]]:
        """Generate exit signal for event-driven mode."""
        if market_data_df.empty:
            return None
        
        latest = market_data_df.iloc[-1]
        
        # Hard exit at 20:55 UTC
        if (latest['hour'] == self.params.hard_exit_hour and 
            latest['minute'] >= self.params.hard_exit_minute):
            
            close_signal = StrategySignal.CLOSE_SHORT if position.action == OrderAction.SELL else StrategySignal.CLOSE_LONG
            return {
                'signal': close_signal,
                'position_id': position.position_id if hasattr(position, 'position_id') else None,
                'reason': 'End of Session Exit (20:55 UTC)'
            }
        
        return None
    
    def reset_daily_state(self) -> None:
        """Reset daily trading state."""
        self.trade_taken_today = False
        self.last_trade_date = None

# Export
__all__ = ['NYPMReversionStrategy', 'NYPMReversionParams']

# src/strategies/gbpjpy_reversion.py
"""
GBPJPY Liquidity Vacuum Reversion Strategy.

Edge: Captures snap-back reversions after 2.5σ Bollinger Band pierces
with V-shaped rejection geometry during London session.

Version 2.2 - All secondary agent audit fixes applied:
- H1 RSI: removed double-shift, uses previous hour bucket correctly
- RR gate: computed on entry bar (after setup shift)
- Session close: edge-trigger (first bar at/after 16:00 London)
- Includes smoke test table generation for verification
- Vectorized H1 RSI mapping (no O(N) loop)

Author: Primary Agent (Antigravity)
Based on: Secondary Agent research notes + audit fixes (v3)
"""

import pandas as pd
import numpy as np
from datetime import datetime, timezone
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
class GBPJPYReversionParams:
    """Parameters for GBPJPY Liquidity Vacuum Reversion strategy."""
    
    # Session (London LOCAL time, converted to UTC internally)
    session_start_london: int = 8      # 08:00 London
    session_end_london: int = 16       # 16:00 London (hard exit)
    
    # Bollinger Bands (extreme pierce detection)
    bb_period: int = 20
    bb_std_extreme: float = 2.5        # Extended bands for vacuum detection
    
    # Wick geometry (V-shaped rejection signature)
    wick_ratio_min: float = 1.75       # Wick must be >= 1.75x body
    min_body_atr_pct: float = 0.1      # Body must be >= 10% of ATR (anti-doji)
    
    # H1 RSI kill-zone (multi-timeframe filter)
    rsi_h1_period: int = 14
    rsi_kill_low: float = 35           # Below = oversold, OK for longs
    rsi_kill_high: float = 65          # Above = overbought, OK for shorts
    
    # ATR-based stop loss
    atr_period: int = 14
    atr_stop_mult: float = 2.0
    
    # RR Gate (prevent trades where potential reward < risk)
    min_rr_ratio: float = 1.0          # Target distance / Stop distance >= 1.0


class GBPJPYReversionStrategy(BaseStrategy):
    """
    GBPJPY Liquidity Vacuum Reversion Strategy.
    
    Trades mean reversion after extreme 2.5σ Bollinger Band pierces
    with V-shaped rejection confirmation during London session.
    
    Exit: Session close at 16:00 London (edge-trigger) OR mid-band target OR stop loss.
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
        """Initialize GBPJPY Reversion strategy."""
        super().__init__(
            strategy_params=strategy_params,
            config=config,
            platform_adapter=platform_adapter,
            market_data_manager=market_data_manager,
            logger=logger,
            asset_profile_key=asset_profile_key
        )
        
        self.logger.info("GBPJPYReversionStrategy initialized (Hardened v2.2)")
    
    def _initialize_strategy_parameters(self) -> None:
        """Initialize strategy-specific parameters from config."""
        super()._initialize_strategy_parameters()
        
        p = self.strategy_params
        
        self.params = GBPJPYReversionParams(
            session_start_london=getattr(p, 'session_start_london', 8),
            session_end_london=getattr(p, 'session_end_london', 16),
            bb_period=getattr(p, 'bb_period', 20),
            bb_std_extreme=getattr(p, 'bb_std_extreme', 2.5),
            wick_ratio_min=getattr(p, 'wick_ratio_min', 1.75),
            min_body_atr_pct=getattr(p, 'min_body_atr_pct', 0.1),
            rsi_h1_period=getattr(p, 'rsi_h1_period', 14),
            rsi_kill_low=getattr(p, 'rsi_kill_low', 35),
            rsi_kill_high=getattr(p, 'rsi_kill_high', 65),
            atr_period=getattr(p, 'atr_period', 14),
            atr_stop_mult=getattr(p, 'atr_stop_mult', 2.0),
            min_rr_ratio=getattr(p, 'min_rr_ratio', 1.0),
        )
        
        self.logger.info(
            f"GBPJPY params: BB({self.params.bb_period}, {self.params.bb_std_extreme}σ), "
            f"Wick>={self.params.wick_ratio_min}x, H1 RSI kill[{self.params.rsi_kill_low}-{self.params.rsi_kill_high}], "
            f"Session {self.params.session_start_london}-{self.params.session_end_london} London"
        )
    
    def _initialize_indicators(self) -> None:
        """Initialize indicator placeholders."""
        pass
    
    def _get_minimum_data_length(self) -> int:
        """Minimum bars needed for indicator calculation."""
        return max(self.params.bb_period, self.params.atr_period, 100) + 50
    
    def _get_required_columns(self) -> List[str]:
        """Required OHLCV columns."""
        return ['open', 'high', 'low', 'close', 'volume']
    
    def _get_indicator_columns(self, market_data_df: Optional[pd.DataFrame] = None) -> List[str]:
        """Indicator columns to check for NaN.
        
        Returns empty list because this strategy is vectorized-only.
        Indicators are calculated internally in generate_vectorized_signals().
        The event-driven methods (_generate_strategy_signal, etc.) return None.
        """
        return []
    
    # =========================================================================
    # INDICATOR CALCULATIONS
    # =========================================================================
    
    def _calculate_bollinger_bands(
        self, close: pd.Series, period: int, std_mult: float
    ) -> Dict[str, pd.Series]:
        """Calculate Bollinger Bands with extreme σ."""
        sma = close.rolling(window=period).mean()
        std = close.rolling(window=period).std()
        
        return {
            'middle': sma,
            'upper': sma + (std_mult * std),
            'lower': sma - (std_mult * std)
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
        
        return rsi.fillna(50)
    
    def _calculate_atr(
        self, high: pd.Series, low: pd.Series, close: pd.Series, period: int
    ) -> pd.Series:
        """Calculate ATR."""
        prev_close = close.shift(1)
        tr1 = high - low
        tr2 = (high - prev_close).abs()
        tr3 = (low - prev_close).abs()
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = tr.rolling(window=period).mean()
        return atr
    
    def _ensure_utc_aware(self, ts: pd.Series) -> pd.DatetimeIndex:
        """
        Ensure timestamps are UTC-aware.
        Handles both tz-naive and tz-aware inputs safely.
        Returns a proper DatetimeIndex for tz_convert compatibility.
        """
        ts_dt = pd.to_datetime(ts)
        
        # Convert Series to DatetimeIndex
        if isinstance(ts_dt, pd.Series):
            ts_dt = pd.DatetimeIndex(ts_dt)
        
        if ts_dt.tz is None:
            self.logger.debug("Timestamps are tz-naive, assuming UTC")
            return ts_dt.tz_localize('UTC')
        elif str(ts_dt.tz) != 'UTC':
            self.logger.debug(f"Converting from {ts_dt.tz} to UTC")
            return ts_dt.tz_convert('UTC')
        else:
            return ts_dt
    
    def _calculate_h1_rsi_vectorized(
        self, data: pd.DataFrame, ts_utc: pd.DatetimeIndex, period: int
    ) -> tuple:
        """
        Calculate H1 RSI with ANTI-LOOKAHEAD protection.
        
        FIX v2.2: Removed double-shift. 
        - Resample to H1
        - NO shift on H1 RSI
        - Map each M15 bar to (current_hour - 1h), which is the last completed H1
        
        Returns: (rsi_values, h1_map_times) for verification
        """
        # Create UTC-indexed copy
        data_indexed = data.copy()
        data_indexed.index = ts_utc
        
        # Resample to H1 using last close
        h1_close = data_indexed['close'].resample('1H').last()
        
        # Calculate RSI on H1 - NO SHIFT HERE
        h1_rsi = self._calculate_rsi(h1_close, period)
        
        # Vectorized mapping: each M15 bar maps to (floor_to_hour - 1h)
        # This is the last COMPLETED H1 candle
        h1_key = ts_utc.floor('1H') - pd.Timedelta(hours=1)
        
        # Create lookup series
        h1_rsi_lookup = h1_rsi.reindex(h1_key)
        rsi_values = h1_rsi_lookup.values
        
        # Fill NaN with neutral 50
        rsi_values = np.where(np.isnan(rsi_values), 50.0, rsi_values)
        
        # Log sample for verification
        if len(ts_utc) > 100:
            sample_idx = 100
            self.logger.debug(
                f"H1 RSI sample: M15 bar {ts_utc[sample_idx]} -> "
                f"H1 key {h1_key[sample_idx]} -> RSI = {rsi_values[sample_idx]:.1f}"
            )
        
        return rsi_values, h1_key
    
    def _get_london_session_mask(
        self, ts_utc: pd.DatetimeIndex, start_hour: int, end_hour: int
    ) -> pd.Series:
        """
        Get session mask using London LOCAL time (DST-aware).
        """
        ts_london = ts_utc.tz_convert('Europe/London')
        london_hours = ts_london.hour
        
        in_session = (london_hours >= start_hour) & (london_hours < end_hour)
        
        return pd.Series(in_session, index=range(len(ts_utc)))
    
    def _get_session_close_edge_trigger(
        self, ts_utc: pd.DatetimeIndex, end_hour: int
    ) -> pd.Series:
        """
        Get edge-trigger for session close (FIRST bar at/after 16:00 London).
        
        FIX v2.2: Returns True only on the FIRST bar where hour >= end_hour,
        not all bars after.
        
        Formula: (hour >= end) & (hour.shift(1) < end)
        """
        ts_london = ts_utc.tz_convert('Europe/London')
        london_hours = pd.Series(ts_london.hour, index=range(len(ts_utc)))
        
        # Edge trigger: current hour >= end AND previous hour < end
        session_close_trigger = (london_hours >= end_hour) & (london_hours.shift(1) < end_hour)
        
        # Handle first bar edge case
        session_close_trigger = session_close_trigger.fillna(False)
        
        return session_close_trigger
    
    # =========================================================================
    # VECTORIZED SIGNAL GENERATION
    # =========================================================================
    
    def generate_vectorized_signals(
        self, 
        data: pd.DataFrame, 
        params: Optional[Any] = None
    ) -> Dict[str, Any]:
        """
        Generate GBPJPY Liquidity Vacuum Reversion signals.
        
        Hardened implementation v2.2 with all audit fixes:
        - H1 RSI: no double-shift, vectorized mapping
        - RR gate: computed on entry bar (after shift)
        - Session close: edge-trigger only
        - Smoke test table output
        """
        params = params or self.params
        
        # Extract parameters
        session_start = getattr(params, 'session_start_london', 8)
        session_end = getattr(params, 'session_end_london', 16)
        bb_period = getattr(params, 'bb_period', 20)
        bb_std = getattr(params, 'bb_std_extreme', 2.5)
        wick_min = getattr(params, 'wick_ratio_min', 1.75)
        min_body_pct = getattr(params, 'min_body_atr_pct', 0.1)
        rsi_period = getattr(params, 'rsi_h1_period', 14)
        rsi_low = getattr(params, 'rsi_kill_low', 35)
        rsi_high = getattr(params, 'rsi_kill_high', 65)
        atr_period = getattr(params, 'atr_period', 14)
        atr_mult = getattr(params, 'atr_stop_mult', 2.0)
        min_rr = getattr(params, 'min_rr_ratio', 1.0)
        
        # Ensure timestamp column
        if 'timestamp' not in data.columns:
            if 'Date' in data.columns:
                data = data.copy()
                data['timestamp'] = pd.to_datetime(data['Date'])
            elif isinstance(data.index, pd.DatetimeIndex):
                data = data.copy()
                data['timestamp'] = data.index.to_series()
            else:
                raise ValueError("Data must have 'timestamp' or 'Date' column")
        
        n = len(data)
        ts = pd.to_datetime(data['timestamp'])
        
        # Handle Unix MS timestamps
        if len(ts) > 0 and ts.iloc[0].year < 1990:
            ts = pd.to_datetime(data['timestamp'], unit='ms')
        
        # Ensure UTC-aware timestamps
        ts_utc = self._ensure_utc_aware(ts)
        
        self.logger.info(f"GBPJPY Signal Gen v2.2: {n} rows. Range: {ts_utc.min()} to {ts_utc.max()}")
        
        close = data['close'].values
        high = data['high'].values
        low = data['low'].values
        open_ = data['open'].values
        
        close_s = pd.Series(close)
        high_s = pd.Series(high)
        low_s = pd.Series(low)
        open_s = pd.Series(open_)
        
        # =====================================================================
        # STEP 1: Session filter (DST-aware London time)
        # =====================================================================
        in_session = self._get_london_session_mask(ts_utc, session_start, session_end)
        session_close_trigger = self._get_session_close_edge_trigger(ts_utc, session_end)
        
        # =====================================================================
        # STEP 2: Bollinger Bands 2.5σ
        # =====================================================================
        bb = self._calculate_bollinger_bands(close_s, bb_period, bb_std)
        upper_bb = bb['upper'].values
        lower_bb = bb['lower'].values
        mid_bb = bb['middle'].values
        
        # =====================================================================
        # STEP 3: ATR calculation
        # =====================================================================
        atr = self._calculate_atr(high_s, low_s, close_s, atr_period).values
        
        # =====================================================================
        # STEP 4: Wick geometry with min-body safeguard
        # =====================================================================
        body = np.abs(close - open_)
        min_body = atr * min_body_pct
        valid_body = body >= min_body
        
        candle_top = np.maximum(close, open_)
        candle_bottom = np.minimum(close, open_)
        upper_wick = high - candle_top
        lower_wick = candle_bottom - low
        
        # Safe wick ratio
        body_safe = np.where(valid_body, body, 1e-10)
        wick_ratio_lower = np.where(valid_body, lower_wick / body_safe, 0)
        wick_ratio_upper = np.where(valid_body, upper_wick / body_safe, 0)
        
        # =====================================================================
        # STEP 5: H1 RSI - vectorized, no double-shift
        # =====================================================================
        rsi_h1, h1_map_times = self._calculate_h1_rsi_vectorized(data, ts_utc, rsi_period)
        
        rsi_ok_long = rsi_h1 < rsi_low
        rsi_ok_short = rsi_h1 > rsi_high
        
        # =====================================================================
        # STEP 6: Pierce + rejection detection
        # =====================================================================
        long_pierce = low < lower_bb
        long_rejection = close > lower_bb
        long_wick_ok = wick_ratio_lower >= wick_min
        
        short_pierce = high > upper_bb
        short_rejection = close < upper_bb
        short_wick_ok = wick_ratio_upper >= wick_min
        
        # =====================================================================
        # STEP 7: Entry setups (before RR gate, before shift)
        # =====================================================================
        bb_valid = ~np.isnan(lower_bb) & ~np.isnan(upper_bb)
        
        long_setup_raw = (
            long_pierce & 
            long_rejection & 
            long_wick_ok & 
            valid_body & 
            rsi_ok_long & 
            in_session.values &
            bb_valid
        )
        
        short_setup_raw = (
            short_pierce & 
            short_rejection & 
            short_wick_ok & 
            valid_body & 
            rsi_ok_short & 
            in_session.values &
            bb_valid
        )
        
        # =====================================================================
        # STEP 8: Shift entries to next bar (anti-lookahead)
        # =====================================================================
        long_setup = pd.Series(long_setup_raw).shift(1).fillna(False).values.astype(bool)
        short_setup = pd.Series(short_setup_raw).shift(1).fillna(False).values.astype(bool)
        
        # =====================================================================
        # STEP 9: RR Gate - FIXED: computed on ENTRY bar (after shift)
        # Entry happens on bar i, so RR uses bar i's values
        # =====================================================================
        distance_to_mid = np.abs(close - mid_bb)  # Current bar (entry bar)
        sl_distance = atr * atr_mult
        sl_distance_safe = np.where(sl_distance > 0, sl_distance, 1e-10)
        rr_ratio = distance_to_mid / sl_distance_safe
        rr_ok = rr_ratio >= min_rr
        
        # Apply RR gate to shifted setups
        long_entries = long_setup & rr_ok
        short_entries = short_setup & rr_ok
        
        # =====================================================================
        # DIAGNOSTIC LOGGING
        # =====================================================================
        self.logger.info(f"=== GBPJPY SIGNAL DIAGNOSTICS (v2.2) ===")
        self.logger.info(f"  Total bars: {n}")
        self.logger.info(f"  Session OK: {in_session.sum()}")
        self.logger.info(f"  Long pierce: {long_pierce.sum()}, Short pierce: {short_pierce.sum()}")
        self.logger.info(f"  Valid body: {valid_body.sum()}")
        self.logger.info(f"  RSI OK long: {rsi_ok_long.sum()}, short: {rsi_ok_short.sum()}")
        self.logger.info(f"  RR OK: {rr_ok.sum()}")
        self.logger.info(f"  LONG setups (pre-RR): {long_setup.sum()}, LONG entries (post-RR): {long_entries.sum()}")
        self.logger.info(f"  SHORT setups (pre-RR): {short_setup.sum()}, SHORT entries (post-RR): {short_entries.sum()}")
        self.logger.info(f"=== END DIAGNOSTICS ===")
        
        # =====================================================================
        # STEP 10: Exit signals
        # =====================================================================
        # Mid-band target
        long_tp_exit = close >= mid_bb
        short_tp_exit = close <= mid_bb
        
        # Session close edge-trigger
        session_exit = session_close_trigger.values
        
        # Combined exits (SL handled by vectorbt sl_stop)
        long_exits = (long_tp_exit | session_exit).astype(bool)
        short_exits = (short_tp_exit | session_exit).astype(bool)
        
        # =====================================================================
        # STEP 11: Stop loss arrays
        # =====================================================================
        sl_stop = np.full(n, np.nan)
        
        if long_entries.sum() > 0:
            sl_frac = np.clip(atr * atr_mult / close, 0.001, 0.1)
            sl_stop[long_entries] = sl_frac[long_entries]
        
        if short_entries.sum() > 0:
            sl_frac = np.clip(atr * atr_mult / close, 0.001, 0.1)
            sl_stop[short_entries] = sl_frac[short_entries]
        
        self.logger.info(
            f"GBPJPY Signals: {long_entries.sum()} long, {short_entries.sum()} short"
        )
        
        # =====================================================================
        # SMOKE TEST TABLE (for verification)
        # =====================================================================
        entry_indices = np.where(long_entries | short_entries)[0]
        if len(entry_indices) > 0:
            sample_size = min(20, len(entry_indices))
            sample_idx = entry_indices[:sample_size]
            
            self.logger.info("=== SMOKE TEST TABLE (first 20 trades) ===")
            for idx in sample_idx:
                direction = "LONG" if long_entries[idx] else "SHORT"
                entry_time = ts_utc[idx]
                entry_price = close[idx]
                mid_at_entry = mid_bb[idx]
                atr_at_entry = atr[idx]
                rr_at_entry = rr_ratio[idx]
                h1_time = h1_map_times[idx] if idx < len(h1_map_times) else "N/A"
                h1_rsi_val = rsi_h1[idx]
                
                self.logger.info(
                    f"  {direction} | entry={entry_time} | price={entry_price:.3f} | "
                    f"mid={mid_at_entry:.3f} | ATR={atr_at_entry:.3f} | RR={rr_at_entry:.2f} | "
                    f"H1_time={h1_time} | H1_RSI={h1_rsi_val:.1f}"
                )
            self.logger.info("=== END SMOKE TEST TABLE ===")
        
        return {
            'long_entries': long_entries.astype(bool),
            'long_exits': long_exits,
            'short_entries': short_entries.astype(bool),
            'short_exits': short_exits,
            'sl_stop': sl_stop,
            'tp_stop': np.full(n, np.nan)
        }
    
    # =========================================================================
    # EVENT-DRIVEN METHODS (for future live trading)
    # =========================================================================
    
    def _generate_strategy_signal(
        self,
        market_data_df: pd.DataFrame,
        active_position: Optional[Any],
        latest_tick: Any
    ) -> Optional[Dict[str, Any]]:
        """Generate strategy signal for event-driven mode."""
        return None
    
    def _generate_entry_signal(
        self,
        market_data_df: pd.DataFrame,
        current_positions: List[Any]
    ) -> Optional[Dict[str, Any]]:
        """Generate entry signal for event-driven mode."""
        return None
    
    def _generate_exit_signal(
        self,
        market_data_df: pd.DataFrame,
        position: Any
    ) -> Optional[Dict[str, Any]]:
        """Generate exit signal for event-driven mode."""
        return None


# Export
__all__ = ['GBPJPYReversionStrategy', 'GBPJPYReversionParams']

"""
Vectorized Backtest Engine using vectorbt.

This module provides ultra-fast vectorized backtesting as an alternative
to the event-driven BacktestEngine. Uses vectorbt for 100-1000x speedup.

REQUIREMENTS:
    pip install vectorbt

If vectorbt is not installed, this module will raise ImportError on use.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional, Tuple, Union
from dataclasses import dataclass
import importlib
import logging

from src.core.annualization import (
    calculate_annualized_sharpe_from_returns,
    calculate_annualized_sortino_from_returns,
    calculate_calmar_ratio_from_equity,
    infer_data_period_seconds,
    is_timeframe_compatible_with_data,
    normalize_timeframe,
    periods_per_year_for_timeframe,
)
from src.core.enums import Timeframe

# Lazily import vectorbt so module import remains safe in environments where
# vectorbt is missing or ABI-incompatible.
vbt = None
VECTORBT_AVAILABLE = None
_VECTORBT_IMPORT_ERROR: Optional[Exception] = None


def _load_vectorbt():
    """Load vectorbt on first actual vectorized use."""
    global vbt, VECTORBT_AVAILABLE, _VECTORBT_IMPORT_ERROR

    if vbt is not None:
        return vbt
    if VECTORBT_AVAILABLE is False:
        raise ImportError(
            "vectorbt is required for vectorized backtesting"
        ) from _VECTORBT_IMPORT_ERROR

    try:
        vbt = importlib.import_module('vectorbt')
        VECTORBT_AVAILABLE = True
        return vbt
    except Exception as exc:
        VECTORBT_AVAILABLE = False
        _VECTORBT_IMPORT_ERROR = exc
        raise ImportError(
            "vectorbt is required for vectorized backtesting. "
            "Install with: pip install vectorbt"
        ) from exc


@dataclass
class VectorizedBacktestResult:
    """Results from a vectorized backtest."""
    total_return_pct: float
    final_balance: float
    total_trades: int
    win_rate: float
    profit_factor: float
    max_drawdown_pct: float
    sharpe_ratio: float
    sortino_ratio: float
    calmar_ratio: float
    win_count: int = 0
    loss_count: int = 0
    # New per-trade metrics (secondary AI recommendation)
    avg_trade_win_pct: float = 0.0  # Average % gain on winning trades
    avg_trade_loss_pct: float = 0.0  # Average % loss on losing trades
    gross_profit: float = 0.0  # Total profit from winners
    gross_loss: float = 0.0  # Total loss from losers (absolute)
    trade_win_loss_ratio: float = 0.0  # avg_win / avg_loss
    

class VectorizedBacktestEngine:
    """
    Ultra-fast backtesting using vectorbt.
    
    This engine requires pre-generated entry/exit signals as boolean arrays.
    It's designed for high-speed parameter sweeps and walk-forward analysis.
    
    Usage:
        engine = VectorizedBacktestEngine()
        result = engine.run_backtest(
            data=ohlcv_df,
            entries=entry_signals,  # boolean array
            exits=exit_signals,      # boolean array
            initial_balance=10000,
            sl_pct=0.02,  # 2% stop loss
            tp_pct=0.03   # 3% take profit
        )
    """
    
    def __init__(self, logger: Optional[logging.Logger] = None):
        """Initialize the vectorized backtest engine."""
        _load_vectorbt()
        self.logger = logger or logging.getLogger(__name__)
        self.logger.info("VectorizedBacktestEngine initialized (vectorbt-powered)")

    @staticmethod
    def _normalize_win_rate(win_rate: float) -> float:
        """Normalize win rate to a decimal fraction in [0, 1]."""
        try:
            win_rate = float(win_rate)
        except Exception:
            return 0.0

        if not np.isfinite(win_rate):
            return 0.0
        if win_rate > 1.0:
            win_rate /= 100.0
        return float(min(max(win_rate, 0.0), 1.0))

    @staticmethod
    def _sanitize_metric(value: float) -> float:
        """Return a finite float metric or 0.0 when unavailable."""
        try:
            scalar = float(value)
        except Exception:
            return 0.0
        return scalar if np.isfinite(scalar) else 0.0

    @classmethod
    def _validate_timeframe_compatibility(
        cls,
        data: pd.DataFrame,
        timeframe: Union[str, Timeframe],
    ) -> Timeframe:
        """Validate the configured timeframe against the available data cadence when possible."""
        normalized_timeframe = normalize_timeframe(timeframe)
        compatibility = is_timeframe_compatible_with_data(normalized_timeframe, data)
        if compatibility is False:
            actual_seconds = infer_data_period_seconds(data)
            expected_seconds = normalized_timeframe.to_seconds()
            raise ValueError(
                f"Data cadence ({actual_seconds}s) is incompatible with timeframe "
                f"{normalized_timeframe.value} ({expected_seconds}s)"
            )
        return normalized_timeframe

    @classmethod
    def _calculate_timeframe_aware_risk_metrics(
        cls,
        equity_curve,
        timeframe: Union[str, Timeframe],
    ) -> Dict[str, float]:
        """Calculate annualized risk metrics from the combined equity curve."""
        normalized_timeframe = normalize_timeframe(timeframe)
        periods_per_year = periods_per_year_for_timeframe(normalized_timeframe)
        equity_series = pd.Series(equity_curve, dtype=float)
        equity_series = equity_series[np.isfinite(equity_series)]
        returns = equity_series.pct_change().dropna().to_numpy(dtype=float)

        return {
            'sharpe_ratio': cls._sanitize_metric(
                calculate_annualized_sharpe_from_returns(returns, periods_per_year)
            ),
            'sortino_ratio': cls._sanitize_metric(
                calculate_annualized_sortino_from_returns(returns, periods_per_year)
            ),
            'calmar_ratio': cls._sanitize_metric(
                calculate_calmar_ratio_from_equity(equity_series.to_numpy(dtype=float), periods_per_year)
            ),
        }

    @classmethod
    def _summarize_trade_pnls(cls, trade_pnls: np.ndarray, capital_base: float) -> Dict[str, Any]:
        """Build consistent trade metrics from raw PnL values."""
        pnl_values = np.asarray(trade_pnls, dtype=float)
        pnl_values = pnl_values[np.isfinite(pnl_values)]

        total_trades = int(len(pnl_values))
        if total_trades == 0:
            return {
                'total_trades': 0,
                'win_count': 0,
                'loss_count': 0,
                'win_rate': 0.0,
                'profit_factor': 0.0,
                'gross_profit': 0.0,
                'gross_loss': 0.0,
                'avg_trade_win_pct': 0.0,
                'avg_trade_loss_pct': 0.0,
                'trade_win_loss_ratio': 0.0,
            }

        win_mask = pnl_values > 0
        loss_mask = ~win_mask
        win_count = int(np.sum(win_mask))
        loss_count = int(np.sum(loss_mask))
        gross_profit = float(np.sum(pnl_values[win_mask]))
        gross_loss = float(np.abs(np.sum(pnl_values[loss_mask])))
        win_rate = cls._normalize_win_rate(win_count / total_trades)
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0
        avg_trade_win_pct = (gross_profit / win_count / capital_base) * 100 if win_count > 0 else 0.0
        avg_trade_loss_pct = -(gross_loss / loss_count / capital_base) * 100 if loss_count > 0 else 0.0
        trade_win_loss_ratio = abs(avg_trade_win_pct / avg_trade_loss_pct) if avg_trade_loss_pct != 0 else 0.0

        return {
            'total_trades': total_trades,
            'win_count': win_count,
            'loss_count': loss_count,
            'win_rate': win_rate,
            'profit_factor': profit_factor,
            'gross_profit': gross_profit,
            'gross_loss': gross_loss,
            'avg_trade_win_pct': avg_trade_win_pct,
            'avg_trade_loss_pct': avg_trade_loss_pct,
            'trade_win_loss_ratio': trade_win_loss_ratio,
        }
    
    def run_backtest(
        self,
        data: pd.DataFrame,
        entries: np.ndarray,
        exits: np.ndarray,
        initial_balance: float = 10000.0,
        sl_pct: Optional[float] = None,
        tp_pct: Optional[float] = None,
        sl_trail: bool = False,
        fees: float = 0.0001,
        slippage: float = 0.0001,
        direction: str = 'both'
    ) -> VectorizedBacktestResult:
        """
        Run a vectorized backtest on the provided data.
        
        Args:
            data: DataFrame with 'close' column (and optionally 'open', 'high', 'low')
            entries: Boolean array of entry signals (True = enter position)
            exits: Boolean array of exit signals (True = exit position)
            initial_balance: Starting capital
            sl_pct: Stop-loss as decimal (e.g., 0.02 for 2%), can be array for per-bar stops
            tp_pct: Take-profit as decimal (e.g., 0.03 for 3%), use np.nan to disable
            sl_trail: If True, use trailing stop loss (requires sl_pct)
            fees: Trading fees as decimal
            slippage: Slippage as decimal
            direction: 'long', 'short', or 'both'
            
        Returns:
            VectorizedBacktestResult with performance metrics
        """
        close = data['close'].values if 'close' in data.columns else data.values
        
        # Use OHLC for proper stop detection if available
        high = data['high'].values if 'high' in data.columns else close
        low = data['low'].values if 'low' in data.columns else close
        open_ = data['open'].values if 'open' in data.columns else close
        
        # Build portfolio using vectorbt with OHLC and trailing stop support
        pf = vbt.Portfolio.from_signals(
            close=close,
            open=open_,
            high=high,
            low=low,
            entries=entries,
            exits=exits,
            init_cash=initial_balance,
            fees=fees,
            slippage=slippage,
            sl_stop=sl_pct,
            sl_trail=sl_trail,
            tp_stop=tp_pct,
            direction=direction
        )
        
        # Extract metrics
        total_return = float(pf.total_return()) * 100
        final_value = float(pf.final_value())
        total_trades = int(pf.trades.count()) if hasattr(pf.trades, 'count') else 0
        
        trade_metrics = {
            'total_trades': total_trades,
            'win_count': 0,
            'loss_count': 0,
            'win_rate': 0.0,
            'profit_factor': 0.0,
            'gross_profit': 0.0,
            'gross_loss': 0.0,
            'avg_trade_win_pct': 0.0,
            'avg_trade_loss_pct': 0.0,
            'trade_win_loss_ratio': 0.0,
        }
        try:
            trade_records = pf.trades.records_readable if total_trades > 0 else None
            if trade_records is not None and len(trade_records) > 0:
                trade_metrics = self._summarize_trade_pnls(
                    trade_records['PnL'].values,
                    capital_base=initial_balance,
                )
            else:
                trade_metrics['win_rate'] = self._normalize_win_rate(
                    float(pf.trades.win_rate()) if total_trades > 0 else 0.0
                )
        except Exception:
            trade_metrics['win_rate'] = 0.0

        # Profit factor
        try:
            profit_factor = float(pf.trades.profit_factor()) if total_trades > 0 else 0.0
            if np.isinf(profit_factor) or np.isnan(profit_factor):
                profit_factor = 0.0
        except:
            profit_factor = 0.0

        if trade_metrics['total_trades'] > 0:
            profit_factor = trade_metrics['profit_factor']
            
        # Max drawdown
        try:
            max_dd = float(pf.max_drawdown()) * 100
        except:
            max_dd = 0.0
            
        # Sharpe ratio
        try:
            sharpe = float(pf.sharpe_ratio())
            if np.isinf(sharpe) or np.isnan(sharpe):
                sharpe = 0.0
        except:
            sharpe = 0.0
            
        # Sortino ratio
        try:
            sortino = float(pf.sortino_ratio())
            if np.isinf(sortino) or np.isnan(sortino):
                sortino = 0.0
        except:
            sortino = 0.0
            
        # Calmar ratio
        try:
            calmar = float(pf.calmar_ratio())
            if np.isinf(calmar) or np.isnan(calmar):
                calmar = 0.0
        except:
            calmar = 0.0
            
        return VectorizedBacktestResult(
            total_return_pct=total_return,
            final_balance=final_value,
            total_trades=total_trades,
            win_rate=trade_metrics['win_rate'],
            profit_factor=profit_factor,
            max_drawdown_pct=max_dd,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
            calmar_ratio=calmar,
            win_count=trade_metrics['win_count'],
            loss_count=trade_metrics['loss_count'],
            avg_trade_win_pct=trade_metrics['avg_trade_win_pct'],
            avg_trade_loss_pct=trade_metrics['avg_trade_loss_pct'],
            gross_profit=trade_metrics['gross_profit'],
            gross_loss=trade_metrics['gross_loss'],
            trade_win_loss_ratio=trade_metrics['trade_win_loss_ratio'],
        )

    def run_strategy_backtest(
        self,
        data: pd.DataFrame,
        signals: Dict[str, np.ndarray],
        initial_balance: float = 10000.0,
        fees: float = 0.0001,
        slippage: float = 0.0001,
        timeframe: Union[str, Timeframe] = Timeframe.M15,
    ) -> VectorizedBacktestResult:
        """
        Run backtest with separate long/short signals.
        
        Args:
            data: OHLCV DataFrame
            signals: Dict from strategy.generate_vectorized_signals()
            initial_balance: Starting capital
            fees: Trading fees
            slippage: Slippage

        Notes:
            - Entry/exit signals are shifted by 1 bar before execution.
            - Strategies must avoid lookahead in indicator calculations.
            
        Returns:
            Combined VectorizedBacktestResult
        """
        _load_vectorbt()
        normalized_timeframe = self._validate_timeframe_compatibility(data, timeframe)
            
        close = data['close'].values
        open_ = data['open'].values
        
        # CRITICAL FIX: Shift entry signals forward by 1 bar to prevent lookahead bias
        # Signal generated at bar N should execute at bar N+1's open price
        # This ensures we don't use information that wouldn't be available at entry time
        long_entries_shifted = np.roll(signals['long_entries'], 1)
        long_entries_shifted[0] = False  # First bar can't have signal from previous
        
        short_entries_shifted = np.roll(signals['short_entries'], 1)
        short_entries_shifted[0] = False
        
        # Exit signals also shifted to maintain consistency
        long_exits_shifted = np.roll(signals['long_exits'], 1)
        long_exits_shifted[0] = False
        
        short_exits_shifted = np.roll(signals['short_exits'], 1)
        short_exits_shifted[0] = False
        
        # FIX 2.1: Shift SL/TP arrays to align with shifted entries
        sl_stop_raw = signals.get('sl_stop')
        tp_stop_raw = signals.get('tp_stop')
        
        if sl_stop_raw is not None and isinstance(sl_stop_raw, np.ndarray):
            sl_stop_shifted = np.roll(sl_stop_raw, 1)
            sl_stop_shifted[0] = np.nan
        else:
            sl_stop_shifted = sl_stop_raw
            
        if tp_stop_raw is not None and isinstance(tp_stop_raw, np.ndarray):
            tp_stop_shifted = np.roll(tp_stop_raw, 1)
            tp_stop_shifted[0] = np.nan
        else:
            tp_stop_shifted = tp_stop_raw
        
        # Long Portfolio - now with shifted signals for realistic execution
        pf_long = vbt.Portfolio.from_signals(
            close=close,
            open=open_,  # Entry price = Open of the bar we enter
            entries=long_entries_shifted,
            exits=long_exits_shifted,
            direction='longonly',
            init_cash=initial_balance/2,
            fees=fees,
            slippage=slippage,
            sl_stop=sl_stop_shifted,
            tp_stop=tp_stop_shifted
        )
        
        # Short Portfolio - also with shifted signals for realistic execution
        pf_short = vbt.Portfolio.from_signals(
            close=close,
            open=open_,  # Entry price = Open of the bar we enter
            entries=short_entries_shifted,
            exits=short_exits_shifted,
            direction='shortonly',
            init_cash=initial_balance/2,
            fees=fees,
            slippage=slippage,
            sl_stop=sl_stop_shifted,
            tp_stop=tp_stop_shifted
        )
        
        # Merge portfolio stats (approximate for speed)
        # Ideally we'd merge the equity curves but for WFA optimization fitness (Sharpe),
        # averaging is acceptable or we can rely on total return.
        #
        # Better approach for Sharpe: Combine equity and calculate Sharpe on total equity.
        equity_long = pf_long.value()
        equity_short = pf_short.value()
        total_equity = equity_long + equity_short
        
        # Calculate returns on total equity
        total_return_pct = ((total_equity.iloc[-1] - initial_balance) / initial_balance) * 100
        
        # Parse trades
        trades_long = pf_long.trades.count()
        trades_short = pf_short.trades.count()
        total_trades = int(trades_long + trades_short)
        
        # Calculate max drawdown on total equity curve
        running_max = total_equity.cummax()
        drawdown = (total_equity - running_max) / running_max
        max_dd_pct = float(drawdown.min()) * 100

        risk_metrics = self._calculate_timeframe_aware_risk_metrics(
            total_equity,
            normalized_timeframe,
        )
        
        # Calculate win rate and profit factor from trades
        trade_metrics = {
            'total_trades': total_trades,
            'win_count': 0,
            'loss_count': 0,
            'win_rate': 0.0,
            'profit_factor': 0.0,
            'gross_profit': 0.0,
            'gross_loss': 0.0,
            'avg_trade_win_pct': 0.0,
            'avg_trade_loss_pct': 0.0,
            'trade_win_loss_ratio': 0.0,
        }
        try:
            long_trades_records = pf_long.trades.records_readable if trades_long > 0 else None
            short_trades_records = pf_short.trades.records_readable if trades_short > 0 else None
            pnl_arrays = []

            if long_trades_records is not None and len(long_trades_records) > 0:
                pnl_arrays.append(long_trades_records['PnL'].values)

            if short_trades_records is not None and len(short_trades_records) > 0:
                pnl_arrays.append(short_trades_records['PnL'].values)

            if pnl_arrays:
                combined_pnls = np.concatenate(pnl_arrays)
                trade_metrics = self._summarize_trade_pnls(
                    combined_pnls,
                    capital_base=initial_balance / 2,
                )

        except Exception as e:
            self.logger.debug(f"Could not calculate win_rate/profit_factor: {e}")
            trade_metrics = {
                'total_trades': total_trades,
                'win_count': 0,
                'loss_count': 0,
                'win_rate': 0.0,
                'profit_factor': 0.0,
                'gross_profit': 0.0,
                'gross_loss': 0.0,
                'avg_trade_win_pct': 0.0,
                'avg_trade_loss_pct': 0.0,
                'trade_win_loss_ratio': 0.0,
            }
            
        return VectorizedBacktestResult(
            total_return_pct=total_return_pct,
            final_balance=float(total_equity.iloc[-1]),
            total_trades=trade_metrics['total_trades'],
            win_rate=trade_metrics['win_rate'],
            profit_factor=trade_metrics['profit_factor'],
            max_drawdown_pct=max_dd_pct,
            sharpe_ratio=risk_metrics['sharpe_ratio'],
            sortino_ratio=risk_metrics['sortino_ratio'],
            calmar_ratio=risk_metrics['calmar_ratio'],
            win_count=trade_metrics['win_count'],
            loss_count=trade_metrics['loss_count'],
            # New per-trade metrics
            avg_trade_win_pct=trade_metrics['avg_trade_win_pct'],
            avg_trade_loss_pct=trade_metrics['avg_trade_loss_pct'],
            gross_profit=trade_metrics['gross_profit'],
            gross_loss=trade_metrics['gross_loss'],
            trade_win_loss_ratio=trade_metrics['trade_win_loss_ratio']
        )


    
    def run_parameter_sweep(
        self,
        data: pd.DataFrame,
        entry_generator: callable,
        exit_generator: callable,
        param_grid: Dict[str, list],
        initial_balance: float = 10000.0,
        sl_pct: float = 0.02,
        tp_pct: float = 0.03
    ) -> pd.DataFrame:
        """
        Run a parameter sweep using vectorbt's broadcasting.
        
        This is EXTREMELY fast - can test thousands of parameter combinations
        in seconds using vectorbt's array broadcasting.
        
        Args:
            data: OHLCV DataFrame
            entry_generator: Function(data, **params) -> entries array
            exit_generator: Function(data, **params) -> exits array
            param_grid: Dict of parameter names to lists of values
            initial_balance: Starting capital
            sl_pct: Stop-loss percentage
            tp_pct: Take-profit percentage
            
        Returns:
            DataFrame with results for each parameter combination
        """
        from itertools import product
        
        # Generate all parameter combinations
        param_names = list(param_grid.keys())
        param_values = list(param_grid.values())
        combinations = list(product(*param_values))
        
        results = []
        
        for combo in combinations:
            params = dict(zip(param_names, combo))
            
            # Generate signals for this parameter set
            entries = entry_generator(data, **params)
            exits = exit_generator(data, **params)
            
            # Run backtest
            result = self.run_backtest(
                data, entries, exits,
                initial_balance=initial_balance,
                sl_pct=sl_pct,
                tp_pct=tp_pct
            )
            
            # Store result with parameters
            row = {**params, **result.__dict__}
            results.append(row)
        
        return pd.DataFrame(results)


def generate_rsi_signals(
    data: pd.DataFrame,
    rsi_period: int = 14,
    rsi_oversold: int = 30,
    rsi_overbought: int = 70
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Generate entry/exit signals based on RSI.
    
    Args:
        data: DataFrame with 'close' column
        rsi_period: RSI calculation period
        rsi_oversold: RSI level for buy signal
        rsi_overbought: RSI level for sell signal
        
    Returns:
        (entries, exits) as boolean arrays
    """
    vectorbt = _load_vectorbt()
    
    close = data['close']
    
    # Calculate RSI using vectorbt
    rsi = vectorbt.RSI.run(close, window=rsi_period).rsi.values
    
    # Generate signals
    entries = rsi < rsi_oversold
    exits = rsi > rsi_overbought
    
    return entries, exits


# Export availability flag for checking
__all__ = [
    'VectorizedBacktestEngine',
    'VectorizedBacktestResult', 
    'generate_rsi_signals',
    'VECTORBT_AVAILABLE'
]

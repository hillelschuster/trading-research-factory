# walk forward engine/src/strategies/btc_residual_reversion.py
"""
BTC-Normalized Residual Mean Reversion on ETH/USDT.

Idea: Extract BTC-neutral returns from ETH by regressing ETH returns against BTC returns.
The residuals represent ETH-specific deviation from its BTC beta relationship.
Mean-reversion on these residuals provides BTC-independent trading signals.

Logic:
  - Compute 1h returns for both ETH and BTC
  - Compute rolling beta: beta = Cov(ret_eth, ret_btc) / Var(ret_btc) over lookback
  - Compute residuals: residual = ret_eth - beta * ret_btc
  - Compute z-score of residuals: z = (residual - rolling_mean) / rolling_std
  - Entry: long when z < -entry_threshold, short when z > +entry_threshold
  - Exit: when z crosses exit_threshold (e.g., 0) or time-based hold
  - SL: ATR-based %, TP: risk-reward ratio

Parameters (optimizable via WFA):
  - lookback          : Rolling window for beta/z-score (default 30)
  - entry_threshold  : Z-score entry threshold (default 2.0)
  - exit_threshold   : Z-score exit threshold (default 0.0)
  - hold_bars        : Exit after N 1h bars (default 12)
  - sl_atr_mult      : SL = ATR × multiplier (default 2.0)
  - tp_rr_mult       : TP = SL × R:R ratio (default 2.0)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                period: int) -> np.ndarray:
    """Compute ATR."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    return pd.Series(tr).rolling(window=period, min_periods=period).mean().values


def generate_btc_residual_reversion_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate BTC-normalized residual mean reversion signals.

    Entry rules:
      - Long: z-score < -entry_threshold (ETH underperforming BTC)
      - Short: z-score > +entry_threshold (ETH overperforming BTC)
    Exit rules:
      - Time-based: hold N bars
      - Stop-loss: ATR-based %
      - Take-profit: risk-reward ratio

    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ──────────────────────────────────────────────
    lookback = int(params.get("lookback", 30))
    entry_threshold = float(params.get("entry_threshold", 2.0))
    exit_threshold = float(params.get("exit_threshold", 0.0))
    hold_bars = int(params.get("hold_bars", 12))
    sl_atr_mult = float(params.get("sl_atr_mult", 2.0))
    tp_rr_mult = float(params.get("tp_rr_mult", 2.0))

    # Expected input: DataFrame with both ETH and BTC columns
    # For this strategy, we need: eth_close, btc_close (or similar)
    df = data.copy()
    df.columns = [c.lower() for c in df.columns]
    n = len(df)

    # ── Determine column names ───────────────────────────────────────────
    # Look for ETH and BTC close prices in the data
    # Standard format from merge: 'eth_close', 'btc_close' or similar
    eth_col = None
    btc_col = None
    for col in df.columns:
        if 'eth' in col.lower() and 'close' in col.lower():
            eth_col = col
        if 'btc' in col.lower() and 'close' in col.lower():
            btc_col = col
        if 'close' in col.lower() and eth_col is None and btc_col is None:
            # Fallback: assume first close is ETH, need another for BTC
            pass
    
    if eth_col is None or btc_col is None:
        # Try common naming patterns
        for col in df.columns:
            if 'close' in col.lower():
                if eth_col is None:
                    eth_col = col  # First close column
                elif btc_col is None:
                    btc_col = col  # Second close column
    
    if eth_col is None or btc_col is None:
        logger.error(f"Could not find ETH/BTC columns. Available: {list(df.columns)}")
        return _empty_signals(n)
    
    eth_close = df[eth_col].values
    btc_close = df[btc_col].values
    eth_high = df.get('high', df[eth_col]).values if 'high' in df.columns else eth_close
    eth_low = df.get('low', df[eth_col]).values if 'low' in df.columns else eth_close

    # ── Compute returns ──────────────────────────────────────────────────
    # Simple returns: (close - prev_close) / prev_close
    eth_ret = np.zeros(n)
    btc_ret = np.zeros(n)
    eth_ret[1:] = (eth_close[1:] - eth_close[:-1]) / (eth_close[:-1] + 1e-10)
    btc_ret[1:] = (btc_close[1:] - btc_close[:-1]) / (btc_close[:-1] + 1e-10)

    # ── Compute rolling beta ─────────────────────────────────────────────
    # beta = Cov(ret_eth, ret_btc) / Var(ret_btc)
    # Use rolling window for adaptive beta
    beta = np.ones(n)  # Default beta of 1.0 during warmup
    
    for i in range(lookback, n):
        ret_eth_window = eth_ret[i-lookback:i]
        ret_btc_window = btc_ret[i-lookback:i]
        
        # Covariance
        cov = np.cov(ret_eth_window, ret_btc_window)[0, 1]
        # Variance of BTC
        var_btc = np.var(ret_btc_window) + 1e-10
        
        if var_btc > 1e-10:
            beta[i] = cov / var_btc
    
    # Clip beta to reasonable range (0.5 to 2.0)
    beta = np.clip(beta, 0.5, 2.0)

    # ── Compute residuals ─────────────────────────────────────────────────
    # residual = ret_eth - beta * ret_btc
    residual = eth_ret - beta * btc_ret

    # ── Compute z-score of residuals ────────────────────────────────────────
    z_score = np.zeros(n)
    residual_mean = pd.Series(residual).rolling(window=lookback, min_periods=lookback//2).mean().values
    residual_std = pd.Series(residual).rolling(window=lookback, min_periods=lookback//2).std().values
    
    # Avoid division by zero
    residual_std = np.maximum(residual_std, 1e-8)
    z_score = (residual - residual_mean) / residual_std

    # ── Generate signals ──────────────────────────────────────────────────
    long_entries = np.zeros(n, dtype=bool)
    long_exits = np.zeros(n, dtype=bool)
    short_entries = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)

    position = 0  # 0 = flat, 1 = long, -1 = short
    entry_bar = 0

    for i in range(lookback + 10, n):
        z = z_score[i]
        
        if position == 0:
            # No position - check for entry
            if z < -entry_threshold:
                # Long: ETH underperforming BTC significantly -> expect reversion up
                long_entries[i] = True
                position = 1
                entry_bar = i
            elif z > entry_threshold:
                # Short: ETH overperforming BTC significantly -> expect reversion down
                short_entries[i] = True
                position = -1
                entry_bar = i
        elif position == 1:
            # Long position - check for exit
            # Exit on: z crosses exit_threshold (mean reversion complete) or time-based
            time_exit = (i - entry_bar) >= hold_bars
            z_exit = z >= exit_threshold
            
            if time_exit or z_exit:
                long_exits[i] = True
                position = 0
        elif position == -1:
            # Short position - check for exit
            time_exit = (i - entry_bar) >= hold_bars
            z_exit = z <= exit_threshold
            
            if time_exit or z_exit:
                short_exits[i] = True
                position = 0

    # ── Compute stops ──────────────────────────────────────────────────────
    atr = _compute_atr(eth_high, eth_low, eth_close, 14)
    close_arr = eth_close
    
    sl_pct = np.full(n, 0.03)
    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr * sl_atr_mult) / close_arr
    sl_pct = np.clip(sl_pct, 0.005, 0.12)
    sl_pct = np.nan_to_num(sl_pct, nan=0.03)

    with np.errstate(divide="ignore", invalid="ignore"):
        tp_pct = sl_pct * tp_rr_mult
    tp_pct = np.clip(tp_pct, 0.01, 0.20)
    tp_pct = np.nan_to_num(tp_pct, nan=0.06)

    # ── Warmup: suppress signals during indicator warmup ─────────────────
    warmup = lookback + 20
    long_entries[:warmup] = False
    long_exits[:warmup] = False
    short_entries[:warmup] = False
    short_exits[:warmup] = False

    # ── Logging ──────────────────────────────────────────────────────────
    n_long = int(np.sum(long_entries))
    n_short = int(np.sum(short_entries))
    logger.info(
        f"BTC Residual Reversion: {n} 1h bars, "
        f"{n_long} long entries, {n_short} short entries | "
        f"lookback={lookback} entry_th={entry_threshold} exit_th={exit_threshold} "
        f"hold={hold_bars}"
    )

    return {
        "long_entries": long_entries,
        "long_exits": long_exits,
        "short_entries": short_entries,
        "short_exits": short_exits,
        "sl_stop": sl_pct,
        "tp_stop": tp_pct,
    }


def _empty_signals(n: int) -> Dict[str, Any]:
    """Return a no-signal dict for edge cases."""
    return {
        "long_entries": np.zeros(n, dtype=bool),
        "long_exits": np.zeros(n, dtype=bool),
        "short_entries": np.zeros(n, dtype=bool),
        "short_exits": np.zeros(n, dtype=bool),
        "sl_stop": np.full(n, 0.03),
        "tp_stop": np.full(n, 0.06),
    }


class BTCResidualReversion:
    """
    BTC Residual Reversion wrapper for WFA.

    Follows the standard pattern: minimal __init__,
    generate_vectorized_signals delegates to the pure-function.
    """

    def __init__(
        self,
        params: Optional[Dict[str, Any]] = None,
        logger: Optional[logging.Logger] = None,
    ):
        self.params = params or {}
        self.strategy_params = params or {}
        self.logger = logger or logging.getLogger(__name__)

    def _initialize_strategy_parameters(self) -> None:
        pass

    def generate_vectorized_signals(
        self,
        data: pd.DataFrame,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """WFA entry point. Resolves effective params, then delegates."""
        if params is not None:
            effective_params = params
        elif self.params:
            effective_params = self.params
        elif self.strategy_params:
            effective_params = self.strategy_params
        else:
            effective_params = {
                "lookback": 30,
                "entry_threshold": 2.0,
                "exit_threshold": 0.0,
                "hold_bars": 12,
                "sl_atr_mult": 2.0,
                "tp_rr_mult": 2.0,
            }

        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_btc_residual_reversion_signals(data, effective_params, self.logger)

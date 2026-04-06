# walk forward engine/src/strategies/vol_adaptive_rsi_eth.py
"""
Volatility-Adaptive RSI Pullback — ETH/USDT 1h.

Idea: Pure RSI pullback entries (no multi-timeframe filter) with volatility-scaled
stop-loss. Long when RSI < oversold threshold (mean-reversion to the upside).
Short when RSI > overbought threshold (mean-reversion to the downside).
Stop-loss % = (ATR × multiplier) / close — naturally widens in high-vol
regimes and tightens in low-vol regimes, providing adaptive risk management.

Why no multi-timeframe filter:
  The EMA Trend Gate on ETH (Sharpe 0.528) used a 4h EMA regime filter that
  blocked 51% of potential windows (only 42/85 windows had positive Sharpe).
  Removing the filter should produce more consistent positive windows, trading
  frequency for frequency with pure RSI on BTC.

Parameters (optimizable via WFA):
  - rsi_period       : RSI lookback                       (default 14)
  - rsi_oversold     : Long entry RSI level               (default 35)
  - rsi_overbought   : Short entry RSI level              (default 65)
  - hold_bars        : Exit after N 1h bars               (default 48)
  - atr_period       : ATR period for stop calculation     (default 14)
  - sl_atr_mult      : SL = ATR × multiplier              (default 2.0)
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Optional
import logging


def _compute_rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Compute RSI using EMA method of Wilder."""
    delta = np.diff(close, prepend=close[0])
    gains = np.where(delta > 0, delta, 0.0)
    losses = np.where(delta < 0, -delta, 0.0)
    avg_gain = pd.Series(gains).ewm(span=period, adjust=False).mean().values
    avg_loss = pd.Series(losses).ewm(span=period, adjust=False).mean().values
    rs = avg_gain / (avg_loss + 1e-10)
    return 100.0 - (100.0 / (1.0 + rs))


def _compute_atr(
    high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int
) -> np.ndarray:
    """Compute ATR."""
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr1 = high - low
    tr2 = np.abs(high - prev_close)
    tr3 = np.abs(low - prev_close)
    tr = np.maximum(np.maximum(tr1, tr2), tr3)
    return pd.Series(tr).rolling(window=period, min_periods=period).mean().values


def generate_vol_adaptive_rsi_signals(
    data: pd.DataFrame,
    params: Dict[str, Any],
    logger: Optional[logging.Logger] = None,
) -> Dict[str, Any]:
    """
    Generate volatility-adaptive RSI pullback signals (vectorized, 1h input).

    Entry rules:
      - Long: RSI < rsi_oversold
      - Short: RSI > rsi_overbought
    Exit rules:
      - Time-based: hold N bars
      - Stop-loss: ATR-based % (volatility-adaptive — wider in high-vol regimes)
      - Take-profit: 1:1 RR from SL (tp_pct = sl_pct)

    Returns the standard signal dict expected by the WFA engine.
    """
    logger = logger or logging.getLogger(__name__)

    # ── Extract parameters ────────────────────────────────────────────────
    rsi_period = int(params.get("rsi_period", 14))
    rsi_oversold = float(params.get("rsi_oversold", 35.0))
    rsi_overbought = float(params.get("rsi_overbought", 65.0))
    hold_bars = int(params.get("hold_bars", 48))
    atr_period = int(params.get("atr_period", 14))
    sl_atr_mult = float(params.get("sl_atr_mult", 2.0))

    df = data.copy()
    df.columns = [c.lower() for c in df.columns]
    n = len(df)

    # ── Ensure DatetimeIndex ───────────────────────────────────────────────
    if not isinstance(df.index, pd.DatetimeIndex):
        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
            df.set_index("timestamp", inplace=True, drop=False)
        else:
            logger.error("No DatetimeIndex or timestamp column found")
            return _empty_signals(n)

    # ── Warmup ────────────────────────────────────────────────────────────
    warmup = max(rsi_period, atr_period) + 10
    if n < warmup + 100:
        logger.warning(f"Insufficient data: {n} bars (need ~{warmup + 100})")
        return _empty_signals(n)

    # ── Compute indicators ─────────────────────────────────────────────────
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values

    rsi = _compute_rsi(close, rsi_period)
    atr = _compute_atr(high, low, close, atr_period)

    # ── Entry signals: RSI extremes ────────────────────────────────────────
    long_entries = (rsi < rsi_oversold).astype(bool)
    short_entries = (rsi > rsi_overbought).astype(bool)

    # ── Exit signals: time-based hold ─────────────────────────────────────
    long_exits = np.zeros(n, dtype=bool)
    short_exits = np.zeros(n, dtype=bool)

    for idx in np.where(long_entries)[0]:
        exit_idx = idx + hold_bars
        if exit_idx < n:
            long_exits[exit_idx] = True

    for idx in np.where(short_entries)[0]:
        exit_idx = idx + hold_bars
        if exit_idx < n:
            short_exits[exit_idx] = True

    # ── Stop-loss and take-profit (ATR-based, volatility-adaptive) ────────
    # SL% = ATR × multiplier / close → widens in high-vol, tightens in low-vol
    atr_arr = np.nan_to_num(atr, nan=0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        sl_pct = (atr_arr * sl_atr_mult) / close
    sl_pct = np.clip(sl_pct, 0.005, 0.15)
    sl_pct = np.nan_to_num(sl_pct, nan=0.03)

    # TP at 1:1 risk-reward ratio
    tp_pct = sl_pct.copy()
    tp_pct = np.clip(tp_pct, 0.01, 0.20)

    # ── Warmup: suppress signals during indicator warmup ───────────────────
    long_entries[:warmup] = False
    long_exits[:warmup] = False
    short_entries[:warmup] = False
    short_exits[:warmup] = False

    # ── Logging ────────────────────────────────────────────────────────────
    n_long = int(np.sum(long_entries))
    n_short = int(np.sum(short_entries))
    logger.info(
        f"Vol Adaptive RSI: {n} bars, {n_long} long, {n_short} short | "
        f"rsi={rsi_period}/{rsi_oversold}/{rsi_overbought} "
        f"hold={hold_bars}h atr={atr_period} sl_mult={sl_atr_mult}"
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


class LightweightVolAdaptiveRSI:
    """
    Volatility-Adaptive RSI wrapper for WFA.

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
                "rsi_period": 14,
                "rsi_oversold": 35.0,
                "rsi_overbought": 65.0,
                "hold_bars": 48,
                "atr_period": 14,
                "sl_atr_mult": 2.0,
            }

        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)

        return generate_vol_adaptive_rsi_signals(
            data, effective_params, self.logger
        )


__all__ = ["generate_vol_adaptive_rsi_signals", "LightweightVolAdaptiveRSI"]

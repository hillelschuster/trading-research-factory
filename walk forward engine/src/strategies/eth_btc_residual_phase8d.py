"""Phase 8D ETH/BTC residual mean-reversion screen.

ETH is the executable leg. BTC is used only as a context series for a rolling
beta residual signal; the backtester still sees generic ETH OHLCV columns.
"""

import logging
from typing import Any, Dict, Optional

import pandas as pd

from .btc_residual_reversion import generate_btc_residual_reversion_signals


class LightweightEthBtcResidualPhase8D:
    def __init__(self, params: Optional[Dict[str, Any]] = None, logger: Optional[logging.Logger] = None):
        self.params = params or {}
        self.strategy_params = params or {}
        self.logger = logger or logging.getLogger(__name__)

    def _initialize_strategy_parameters(self) -> None:
        pass

    def generate_vectorized_signals(self, data: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        effective_params = params if params is not None else (self.params or self.strategy_params or {})
        if hasattr(effective_params, "keys"):
            effective_params = dict(effective_params)
        elif hasattr(effective_params, "__dict__"):
            effective_params = vars(effective_params)
        return generate_btc_residual_reversion_signals(data, effective_params, self.logger)


__all__ = ["LightweightEthBtcResidualPhase8D"]

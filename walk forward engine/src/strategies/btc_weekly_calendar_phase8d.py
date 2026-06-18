"""Phase 8D BTC weekly calendar anomaly screen.

BTC is the executable leg. The implementation delegates to the existing
crypto day-of-week MACD signal generator while keeping a distinct Phase 8D
strategy identity for provenance and denominator tracking.
"""

import logging
from typing import Any, Dict, Optional

import pandas as pd

from .crypto_day_of_week import generate_crypto_dow_signals


class LightweightBTCWeeklyCalendarPhase8D:
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
        return generate_crypto_dow_signals(data, effective_params, self.logger)


__all__ = ["LightweightBTCWeeklyCalendarPhase8D"]

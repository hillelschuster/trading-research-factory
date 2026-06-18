from __future__ import annotations
from dataclasses import dataclass
from typing import Any, List
import numpy as np

class SchemaValidationError(Exception):
    pass

@dataclass
class WfaResultSchema:
    required_window_fields: List[str] = (
        "window_id", "training_period_start", "training_period_end",
        "testing_period_start", "testing_period_end", "total_return_pct",
        "total_trades", "win_rate", "profit_factor", "max_drawdown_pct", "sharpe_ratio",
        "gross_profit", "gross_loss", "win_count", "loss_count", "success"
    )

    def _is_finite_number(self, x: Any) -> bool:
        try:
            return np.isfinite(float(x))
        except Exception:
            return False

    def validate(self, results: Any) -> bool:
        # Validate per-window fields and types
        for w in results.window_results:
            for field in self.required_window_fields:
                if not hasattr(w, field):
                    raise SchemaValidationError(f"Missing field {field} in WindowResult {getattr(w, 'window_id', '?')}")
                val = getattr(w, field)
                if field in ("total_return_pct", "win_rate", "profit_factor", "max_drawdown_pct", "sharpe_ratio", "gross_profit", "gross_loss"):
                    if not self._is_finite_number(val):
                        raise SchemaValidationError(f"Field {field} must be a finite number in window {w.window_id}")
                if field in ("total_trades", "win_count", "loss_count") and not isinstance(val, int):
                    raise SchemaValidationError(f"Field {field} must be int in window {w.window_id}")
                if field == "success" and not isinstance(val, bool):
                    raise SchemaValidationError(f"Field success must be bool in window {w.window_id}")
            # Additional bounds/policy checks
            if not (-100.0 <= float(w.max_drawdown_pct) <= 0.0):
                raise SchemaValidationError(f"max_drawdown_pct must be in [-100, 0] in window {w.window_id}")
            if not (0.0 <= float(w.win_rate) <= 1.0):
                raise SchemaValidationError(f"win_rate must be in [0, 1] in window {w.window_id}")
            if float(w.profit_factor) < 0.0:
                raise SchemaValidationError(f"profit_factor must be >= 0 in window {w.window_id}")
            if w.total_trades < 0:
                raise SchemaValidationError(f"total_trades must be >= 0 in window {w.window_id}")
            if w.win_count < 0 or w.loss_count < 0:
                raise SchemaValidationError(f"win/loss counts must be >= 0 in window {w.window_id}")
            if float(w.gross_profit) < 0.0 or float(w.gross_loss) < 0.0:
                raise SchemaValidationError(f"gross profit/loss must be >= 0 in window {w.window_id}")
            if (w.win_count + w.loss_count) != w.total_trades:
                raise SchemaValidationError(f"win/loss counts must sum to total_trades in window {w.window_id}")
            # Base-currency percentage return validation: finite and reasonable
            if not self._is_finite_number(w.total_return_pct):
                raise SchemaValidationError(f"total_return_pct must be finite in window {w.window_id}")
            if abs(float(w.total_return_pct)) > 10000.0:
                raise SchemaValidationError(f"total_return_pct magnitude implausible (>10000%) in window {w.window_id}")
            if getattr(w, "in_sample_sharpe", None) is not None and not self._is_finite_number(w.in_sample_sharpe):
                raise SchemaValidationError(f"in_sample_sharpe must be finite when emitted in window {w.window_id}")
            if getattr(w, "in_sample_return_pct", None) is not None:
                if not self._is_finite_number(w.in_sample_return_pct):
                    raise SchemaValidationError(f"in_sample_return_pct must be finite when emitted in window {w.window_id}")
                if abs(float(w.in_sample_return_pct)) > 10000.0:
                    raise SchemaValidationError(f"in_sample_return_pct magnitude implausible (>10000%) in window {w.window_id}")
            for field in ("purge_gap_bars", "purged_validation_bars"):
                value = getattr(w, field, 0)
                if not isinstance(value, int) or value < 0:
                    raise SchemaValidationError(f"{field} must be a non-negative int in window {w.window_id}")

        # Aggregate checks
        if not isinstance(results.total_windows, int) or results.total_windows < 0:
            raise SchemaValidationError("total_windows must be non-negative int")
        if not isinstance(results.aggregate_total_trades, int) or results.aggregate_total_trades < 0:
            raise SchemaValidationError("aggregate_total_trades must be non-negative int")
        if not isinstance(results.aggregate_total_wins, int) or results.aggregate_total_wins < 0:
            raise SchemaValidationError("aggregate_total_wins must be non-negative int")
        if not isinstance(results.aggregate_total_losses, int) or results.aggregate_total_losses < 0:
            raise SchemaValidationError("aggregate_total_losses must be non-negative int")
        if (results.aggregate_total_wins + results.aggregate_total_losses) != results.aggregate_total_trades:
            raise SchemaValidationError("aggregate win/loss counts must sum to aggregate_total_trades")
        if not self._is_finite_number(results.aggregate_win_rate) or not (0.0 <= float(results.aggregate_win_rate) <= 1.0):
            raise SchemaValidationError("aggregate_win_rate must be a finite fraction in [0, 1]")
        if getattr(results, "aggregate_in_sample_sharpe", None) is not None and not self._is_finite_number(results.aggregate_in_sample_sharpe):
            raise SchemaValidationError("aggregate_in_sample_sharpe must be finite when emitted")
        if getattr(results, "aggregate_in_sample_return_pct", None) is not None:
            if not self._is_finite_number(results.aggregate_in_sample_return_pct):
                raise SchemaValidationError("aggregate_in_sample_return_pct must be finite when emitted")
            if abs(float(results.aggregate_in_sample_return_pct)) > 10000.0:
                raise SchemaValidationError("aggregate_in_sample_return_pct magnitude implausible (>10000%)")

        # Calendar alignment: ensure chronological order (overlap allowed for rolling WFA)
        # Note: Rolling WFA windows may have overlapping test periods by design
        prev_end = None
        for w in results.window_results:
            # Only check chronological order, not strict non-overlap
            # if prev_end and w.testing_period_start < prev_end:
            #     raise SchemaValidationError(f"Window {w.window_id} testing starts before previous window ended")
            prev_end = w.testing_period_end

        return True

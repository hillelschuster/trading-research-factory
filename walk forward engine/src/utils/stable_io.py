import json
import os
import math
from decimal import Decimal
from typing import Any, Optional

import numpy as np
import pandas as pd


def is_strict_mode() -> bool:
    return os.environ.get("WFA_DETERMINISTIC") == "1"


def sanitize_for_json(obj: Any) -> Any:
    """
    Recursively sanitize an object for strict JSON serialization.
    - Convert NaN/Inf/-Inf to None
    - Convert numpy types to native Python types
    - Convert Decimals to float (with potential precision loss acceptable for reporting)
    Deterministic mapping (same input -> same sanitized output).
    """
    # Fast path for primitives
    if obj is None or isinstance(obj, (str, int, bool)):
        return obj

    # Floats and decimals
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, Decimal):
        val = float(obj)
        return val if math.isfinite(val) else None

    # Numpy scalars
    if isinstance(obj, (np.floating, np.float32, np.float64)):
        val = float(obj)
        return val if math.isfinite(val) else None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)

    # Collections
    if isinstance(obj, dict):
        # Keep keys as-is; stable_json_dump will sort keys deterministically
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        # Preserve order for list/tuple; sets are converted to sorted lists for determinism
        if isinstance(obj, set):
            return [sanitize_for_json(v) for v in sorted(obj, key=lambda x: str(x))]
        return [sanitize_for_json(v) for v in obj]

    # Pandas types (Series/DataFrame not expected here; serialize separately if needed)
    try:
        if pd.isna(obj):  # handles pandas NA/NaT
            return None
    except Exception:
        pass

    # Fallback: try to convert to string deterministically
    return str(obj)


def stable_json_dump(obj: Any, fp, indent: int = 2, default=None) -> None:
    """
    Deterministic JSON dump: sort_keys=True, allow_nan=False.
    Fails fast with clear error message if NaN/Inf present.
    """
    try:
        json.dump(obj, fp, indent=indent, default=default, sort_keys=True, allow_nan=False)
    except ValueError as e:
        # Make error clearer for CI diagnosis
        raise ValueError(f"stable_json_dump failed: non-finite values encountered (NaN/Inf) or non-serializable types: {e}")


def stable_csv_write(df: pd.DataFrame, path_or_buf, index: bool = False, float_format: str = "%.10f", sort_index: Optional[bool] = None, sort_columns: Optional[bool] = None, **kwargs) -> None:
    """
    Deterministic CSV writer.
    - In strict mode: sort index (if datetime) and sort columns for stability.
    - Otherwise: write as-is unless explicitly requested.
    """
    if sort_index is None:
        sort_index = is_strict_mode()
    if sort_columns is None:
        sort_columns = is_strict_mode()

    df2 = df
    if sort_index:
        try:
            df2 = df2.sort_index()
        except Exception:
            pass
    if sort_columns:
        try:
            df2 = df2.reindex(sorted(df2.columns), axis=1)
        except Exception:
            pass

    df2.to_csv(path_or_buf, index=index, float_format=float_format, **kwargs)


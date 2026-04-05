from __future__ import annotations
import os


def is_strict_mode() -> bool:
    """Return True if strict determinism mode is active via environment flags.

    Flags:
    - WFA_DETERMINISTIC=1
    - RUN_DETERMINISTIC_CI=1
    """
    return (os.getenv('WFA_DETERMINISTIC') == '1' or 
            os.getenv('RUN_DETERMINISTIC_CI') == '1')


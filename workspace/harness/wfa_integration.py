"""WFA integration module - bridges the 'wfa/' reference engine with the workspace harness.

This module provides a unified interface to run walk-forward analysis using either:
- workspace/harness/wfa_engine.py (the main harness)
- wfa/ reference implementation (when available)
"""
from __future__ import annotations

import importlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WFA_DIR = ROOT / "wfa"
WORKSPACE_HARNESS = ROOT / "workspace" / "harness" / "wfa_engine.py"


def get_available_engines() -> dict:
    """Discover available WFA engines."""
    engines = {}

    if WORKSPACE_HARNESS.exists():
        engines["workspace_harness"] = {
            "path": str(WORKSPACE_HARNESS),
            "type": "python_script",
            "description": "Main workspace WFA engine with param grid search"
        }

    # Check for wfa/ directory contents
    if WFA_DIR.exists():
        for py_file in WFA_DIR.glob("*.py"):
            engines[f"wfa_{py_file.stem}"] = {
                "path": str(py_file),
                "type": "python_module",
                "description": f"WFA reference: {py_file.stem}"
            }
        for test_dir in [WFA_DIR / "tests"]:
            if test_dir.exists():
                for test_file in test_dir.glob("test_*.py"):
                    engines[f"wfa_test_{test_file.stem}"] = {
                        "path": str(test_file),
                        "type": "test",
                        "description": f"WFA test: {test_file.stem}"
                    }

    return engines


def run_workspace_harness(csv_path: str, strategy: str, output_dir: str,
                          train_size: int = 120, test_size: int = 60) -> dict:
    """Run the workspace WFA harness via subprocess."""
    cmd = [
        sys.executable, str(WORKSPACE_HARNESS),
        "--csv", csv_path,
        "--strategy", strategy,
        "--output", output_dir,
        "--train-size", str(train_size),
        "--test-size", str(test_size)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT))
    if result.returncode != 0:
        return {"ok": False, "error": result.stderr, "command": " ".join(cmd)}

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"ok": True, "raw_output": result.stdout}


def run_wfa_tests() -> dict:
    """Run WFA-related tests if available."""
    test_results = {}

    # Check for pytest-based tests in wfa/tests/
    wfa_tests = WFA_DIR / "tests"
    if wfa_tests.exists():
        test_files = list(wfa_tests.glob("test_*.py"))
        if test_files:
            result = subprocess.run(
                [sys.executable, "-m", "pytest", str(wfa_tests), "-v"],
                capture_output=True, text=True, cwd=str(ROOT)
            )
            test_results["wfa_tests"] = {
                "returncode": result.returncode,
                "stdout": result.stdout[-2000:] if result.stdout else "",
                "stderr": result.stderr[-2000:] if result.stderr else ""
            }

    return test_results


def validate_strategy_module(strategy_path: str) -> dict:
    """Validate that a strategy module is compatible with the WFA harness."""
    errors = []
    warnings = []

    try:
        module = importlib.import_module(strategy_path)
    except ImportError as e:
        return {"valid": False, "errors": [f"Cannot import: {e}"]}

    if not hasattr(module, "generate_signal"):
        errors.append("Missing required function: generate_signal(df, **params)")
    if not hasattr(module, "DEFAULT_PARAM_GRID"):
        warnings.append("Missing DEFAULT_PARAM_GRID dict (will skip param optimization)")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "has_param_grid": hasattr(module, "DEFAULT_PARAM_GRID")
    }

# wfa-minimal/src/backtesting/__init__.py

"""
Backtesting module for WFA - Vectorized Only.

This module provides vectorized backtesting capabilities using vectorbt.
Event-driven backtesting is NOT supported in this minimal repo.
"""

from .vectorized_backtest_engine import VectorizedBacktestEngine, VectorizedBacktestResult

__all__ = [
    'VectorizedBacktestEngine',
    'VectorizedBacktestResult',
]
"""
Gold Enhanced Momentum WFA Test - H4 Timeframe
Tests momentum with ADX filter and Chandelier exit.
"""

import sys
from pathlib import Path
import pandas as pd
import numpy as np

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
from src.config_manager import load_and_validate_config


def resample_to_h4(df: pd.DataFrame) -> pd.DataFrame:
    """Resample M15 data to H4."""
    df = df.copy()
    df = df.set_index('timestamp')
    
    resampled = df.resample('4h').agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum' if 'volume' in df.columns else 'first'
    }).dropna()
    
    resampled = resampled.reset_index()
    return resampled


def run_gold_wfa():
    """Run Gold Enhanced Momentum WFA on H4 data."""
    
    data_path = project_root / "data" / "XAUUSD_M15_2018-2025" / "XAUUSD_M15_2018_2025.csv"
    print(f"Loading data from: {data_path}")
    
    df = pd.read_csv(data_path)
    df.columns = [c.lower() for c in df.columns]
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    
    df = df[(df['timestamp'] >= '2020-01-01') & (df['timestamp'] <= '2024-12-31')]
    print(f"M15 data: {len(df)} rows")
    
    # RESAMPLE TO H4
    df = resample_to_h4(df)
    print(f"H4 data: {len(df)} rows ({df['timestamp'].min()} to {df['timestamp'].max()})")
    
    output_dir = project_root / "strategies" / "gold_trend_following" / "results"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    config = WalkForwardConfig(
        training_months=12,
        testing_months=3,
        step_months=3,
        n_parameter_trials=10,
        optimization_seed=42,
        strategy_profile_key="XAUUSD_TrendFollowing_H4",
        output_directory=str(output_dir),
        use_vectorized_backtest=True,
        performance_mode=True,
        save_detailed_results=True,
        fees=0.0001,
        slippage=0.0001
    )
    
    try:
        app_config = load_and_validate_config()
    except Exception as e:
        print(f"Config load failed: {e}")
        return None
    
    print("Initializing WFA Runner...")
    runner = WalkForwardRunner(config, app_config=app_config)
    
    print("Starting WFA on H4 data (Enhanced Momentum + ADX + Chandelier)...")
    print("=" * 60)
    results = runner.run_walk_forward_analysis(df, save_results=True)
    print("=" * 60)
    
    if results:
        print(f"WFA Complete!")
        print(f"  Windows: {results.total_windows}")
        print(f"  Return: {results.aggregate_return_pct:.2f}%")
        print(f"  Sharpe: {results.aggregate_sharpe_ratio:.3f}")
        print(f"  Trades: {results.aggregate_total_trades}")
        print(f"  Win Rate: {results.aggregate_win_rate:.1f}%")
        print(f"  Profit Factor: {results.aggregate_profit_factor:.2f}")
        return results
    else:
        print("No results returned")
        return None


if __name__ == "__main__":
    results = run_gold_wfa()
    if results and results.total_windows > 0:
        print("SUCCESS")
    else:
        print("FAILED or 0 windows")

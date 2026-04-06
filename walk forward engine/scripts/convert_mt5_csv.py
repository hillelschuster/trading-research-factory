#!/usr/bin/env python3
"""
MT5 CSV Converter

Converts historical bar data CSV to MetaTrader 5 Strategy Tester compatible format.

Usage:
    python convert_mt5_csv.py --in input.csv --outdir out/ --tf M15
    python convert_mt5_csv.py --in input.csv --outdir out/ --tf ALL

MT5 Bar Format:
    Date,Time,Open,High,Low,Close,Volume
    2018.01.02,00:15,1302.922,1303.758,1302.231,1303.758,0.4072
"""

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description='Convert historical CSV to MT5-compatible bar format'
    )
    parser.add_argument(
        '--in', dest='input_file', required=True,
        help='Input CSV file path'
    )
    parser.add_argument(
        '--outdir', required=True,
        help='Output directory (created if not exists)'
    )
    parser.add_argument(
        '--tf', default='ALL', choices=['M15', 'H1', 'H4', 'ALL'],
        help='Target timeframe: M15, H1, H4, or ALL (default: ALL)'
    )
    parser.add_argument(
        '--symbol', default='XAUUSD',
        help='Symbol name for output files (default: XAUUSD)'
    )
    return parser.parse_args()


def load_and_parse_csv(input_path: Path) -> pd.DataFrame:
    """
    Load CSV and parse timestamps.
    
    Handles both millisecond and second epoch timestamps.
    """
    logger.info(f"Loading CSV from: {input_path}")
    df = pd.read_csv(input_path)
    
    rows_in = len(df)
    logger.info(f"Loaded {rows_in:,} rows")
    
    # Check for required columns
    required_cols = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    
    # Parse timestamp - auto-detect ms vs seconds
    # If first timestamp >= 1e12, treat as milliseconds
    sample_ts = df['timestamp'].iloc[0]
    
    # Handle scientific notation by converting to float first
    if isinstance(sample_ts, str):
        sample_ts = float(sample_ts)
    
    if sample_ts >= 1e12:
        logger.info("Detected timestamp in milliseconds")
        df['datetime'] = pd.to_datetime(df['timestamp'].astype(float), unit='ms', utc=True)
    else:
        logger.info("Detected timestamp in seconds")
        df['datetime'] = pd.to_datetime(df['timestamp'].astype(float), unit='s', utc=True)
    
    # Convert to naive datetime (remove timezone for MT5)
    df['datetime'] = df['datetime'].dt.tz_localize(None)
    
    logger.info(f"Date range: {df['datetime'].min()} to {df['datetime'].max()}")
    
    return df, rows_in


def validate_and_clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """
    Validate and clean the data.
    
    Returns cleaned DataFrame and stats dict.
    """
    stats = {
        'duplicates_removed': 0,
        'invalid_rows_removed': 0,
        'non_aligned_warnings': 0
    }
    
    # Sort by datetime ascending
    df = df.sort_values('datetime').reset_index(drop=True)
    
    # Remove duplicates (keep last)
    rows_before = len(df)
    df = df.drop_duplicates(subset=['datetime'], keep='last')
    stats['duplicates_removed'] = rows_before - len(df)
    if stats['duplicates_removed'] > 0:
        logger.info(f"Removed {stats['duplicates_removed']:,} duplicate timestamps (kept last)")
    
    # Drop rows with invalid OHLC (NaN or missing)
    rows_before = len(df)
    ohlc_cols = ['open', 'high', 'low', 'close']
    df = df.dropna(subset=ohlc_cols)
    stats['invalid_rows_removed'] = rows_before - len(df)
    if stats['invalid_rows_removed'] > 0:
        logger.info(f"Removed {stats['invalid_rows_removed']:,} rows with missing OHLC values")
    
    # Check M15 alignment (minute should be 0, 15, 30, or 45)
    minutes = df['datetime'].dt.minute
    non_aligned = ~minutes.isin([0, 15, 30, 45])
    stats['non_aligned_warnings'] = non_aligned.sum()
    if stats['non_aligned_warnings'] > 0:
        logger.warning(f"Found {stats['non_aligned_warnings']:,} bars not aligned to M15 boundaries")
    
    return df, stats


def format_for_mt5(df: pd.DataFrame) -> pd.DataFrame:
    """
    Format DataFrame for MT5 bar import.
    
    Output format:
    Date,Time,Open,High,Low,Close,Volume
    2018.01.02,00:15,1302.922,1303.758,1302.231,1303.758,0.4072
    """
    mt5_df = pd.DataFrame()
    
    # Format date as YYYY.MM.DD
    mt5_df['Date'] = df['datetime'].dt.strftime('%Y.%m.%d')
    
    # Format time as HH:MM
    mt5_df['Time'] = df['datetime'].dt.strftime('%H:%M')
    
    # OHLCV columns - ensure float with dot decimal
    mt5_df['Open'] = df['open'].astype(float)
    mt5_df['High'] = df['high'].astype(float)
    mt5_df['Low'] = df['low'].astype(float)
    mt5_df['Close'] = df['close'].astype(float)
    mt5_df['Volume'] = df['volume'].astype(float)
    
    return mt5_df


def resample_to_timeframe(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """
    Resample M15 data to a higher timeframe.
    
    Args:
        df: DataFrame with 'datetime' column and OHLCV data
        timeframe: 'H1' or 'H4'
    
    Returns:
        Resampled DataFrame
    """
    resample_map = {
        'H1': '1H',
        'H4': '4H'
    }
    
    if timeframe not in resample_map:
        raise ValueError(f"Unsupported timeframe for resampling: {timeframe}")
    
    rule = resample_map[timeframe]
    logger.info(f"Resampling to {timeframe} ({rule})")
    
    # Set datetime as index for resampling
    df_indexed = df.set_index('datetime')
    
    # Resample with OHLCV aggregation rules
    resampled = df_indexed.resample(rule).agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum'
    }).dropna()
    
    # Reset index to get datetime back as column
    resampled = resampled.reset_index()
    
    logger.info(f"Resampled to {len(resampled):,} {timeframe} bars")
    
    return resampled


def save_mt5_csv(df: pd.DataFrame, output_path: Path):
    """
    Save DataFrame to MT5-compatible CSV format.
    """
    # Save with no index, dot decimal separator
    df.to_csv(output_path, index=False, float_format='%.6g')
    logger.info(f"Saved {len(df):,} rows to: {output_path}")


def main():
    args = parse_args()
    
    input_path = Path(args.input_file)
    outdir = Path(args.outdir)
    symbol = args.symbol
    timeframe = args.tf
    
    # Validate input file exists
    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        sys.exit(1)
    
    # Create output directory
    outdir.mkdir(parents=True, exist_ok=True)
    
    # Load and parse
    df, rows_in = load_and_parse_csv(input_path)
    
    # Validate and clean
    df_clean, stats = validate_and_clean(df)
    
    # Determine which timeframes to generate
    if timeframe == 'ALL':
        timeframes = ['M15', 'H1', 'H4']
    else:
        timeframes = [timeframe]
    
    results = {}
    
    for tf in timeframes:
        if tf == 'M15':
            # Direct conversion for M15
            mt5_df = format_for_mt5(df_clean)
        else:
            # Resample for higher timeframes
            resampled = resample_to_timeframe(df_clean, tf)
            mt5_df = format_for_mt5(resampled)
        
        output_file = outdir / f"{symbol}_{tf}_MT5.csv"
        save_mt5_csv(mt5_df, output_file)
        results[tf] = len(mt5_df)
    
    # Print summary
    print("\n" + "=" * 60)
    print("CONVERSION SUMMARY")
    print("=" * 60)
    print(f"Input file:          {input_path}")
    print(f"Rows in:             {rows_in:,}")
    print(f"Date range:          {df_clean['datetime'].min()} to {df_clean['datetime'].max()}")
    print(f"Duplicates removed:  {stats['duplicates_removed']:,}")
    print(f"Invalid rows removed:{stats['invalid_rows_removed']:,}")
    if stats['non_aligned_warnings'] > 0:
        print(f"Non-M15 aligned:     {stats['non_aligned_warnings']:,} (warning)")
    print("-" * 60)
    print("Output files:")
    for tf, count in results.items():
        output_file = outdir / f"{symbol}_{tf}_MT5.csv"
        print(f"  {output_file}: {count:,} rows")
    print("=" * 60)


if __name__ == '__main__':
    main()

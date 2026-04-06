#!/usr/bin/env python3
"""
XAUUSD M1 Data Downloader

Downloads 1-minute XAUUSD historical data from Dukascopy using dukascopy-node.
Then converts to MT5-compatible format.

Prerequisites:
    - Node.js installed (for npx)

Usage:
    python download_xauusd_m1.py --year 2025
    python download_xauusd_m1.py --from 2024-01-01 --to 2025-01-01
"""

import argparse
import subprocess
import sys
import logging
import shutil
import os
from pathlib import Path
from datetime import datetime
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Get script directory to run npx from consistent location
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent


def parse_args():
    parser = argparse.ArgumentParser(
        description='Download XAUUSD M1 data from Dukascopy and convert to MT5 format'
    )
    parser.add_argument(
        '--year', type=int,
        help='Download full year of data (e.g., 2024 or 2025)'
    )
    parser.add_argument(
        '--from', dest='from_date',
        help='Start date in YYYY-MM-DD format'
    )
    parser.add_argument(
        '--to', dest='to_date',
        help='End date in YYYY-MM-DD format'
    )
    parser.add_argument(
        '--outdir', default='data/XAUUSD_M1',
        help='Output directory (default: data/XAUUSD_M1)'
    )
    return parser.parse_args()


def download_data(from_date: str, to_date: str, workdir: Path) -> Path:
    """
    Download M1 data using dukascopy-node CLI.
    Returns path to the downloaded file.
    """
    logger.info(f"Downloading XAUUSD M1 data: {from_date} to {to_date}")
    
    # dukascopy-node creates files in current directory/download folder
    # We'll run it from the workdir
    download_dir = workdir / "download"
    download_dir.mkdir(parents=True, exist_ok=True)
    
    # Expected output filename pattern from dukascopy-node
    # Format: xauusd-m1-bid-YYYY-MM-DD-YYYY-MM-DD.csv
    expected_file = download_dir / f"xauusd-m1-bid-{from_date}-{to_date}.csv"
    
    # Skip if already downloaded
    if expected_file.exists():
        logger.info(f"File already exists: {expected_file}")
        return expected_file
    
    # Use dukascopy-node CLI with -y to auto-approve install
    cmd = [
        'npx', '-y', 'dukascopy-node',
        '-i', 'xauusd',
        '-from', from_date,
        '-to', to_date,
        '-t', 'm1',
        '-f', 'csv'
    ]
    
    logger.info(f"Running: {' '.join(cmd)}")
    
    try:
        # Use shell=True to properly inherit PATH on Windows
        result = subprocess.run(
            ' '.join(cmd),
            cwd=str(workdir),
            capture_output=True,
            text=True,
            timeout=1800,  # 30 minute timeout
            shell=True
        )
        
        # Log output
        if result.stdout:
            for line in result.stdout.split('\n')[-10:]:
                if line.strip():
                    logger.info(f"  {line}")
        
        if result.returncode != 0:
            logger.error(f"dukascopy-node failed: {result.stderr}")
            return None
        
        # Check if file was created
        if expected_file.exists():
            size_mb = expected_file.stat().st_size / (1024 * 1024)
            logger.info(f"Downloaded: {expected_file} ({size_mb:.2f} MB)")
            return expected_file
        
        # Look for any matching files in download dir
        csv_files = list(download_dir.glob("xauusd*.csv"))
        if csv_files:
            latest = max(csv_files, key=lambda f: f.stat().st_mtime)
            logger.info(f"Found download: {latest}")
            return latest
        
        logger.error(f"No output file found in {download_dir}")
        return None
            
    except subprocess.TimeoutExpired:
        logger.error(f"Download timed out")
        return None
    except FileNotFoundError:
        logger.error("npx not found. Please install Node.js")
        return None


def convert_to_mt5(input_file: Path, output_file: Path) -> int:
    """
    Convert dukascopy CSV to MT5 format.
    
    Dukascopy format: timestamp,open,high,low,close (no volume)
    MT5 format: Date,Time,Open,High,Low,Close,Volume
    """
    logger.info(f"Converting to MT5 format: {input_file.name}")
    
    df = pd.read_csv(input_file)
    logger.info(f"Loaded {len(df):,} rows, columns: {df.columns.tolist()}")
    
    # Dukascopy outputs: timestamp (epoch ms), open, high, low, close
    if 'timestamp' not in df.columns:
        logger.error(f"Missing timestamp column. Columns: {df.columns.tolist()}")
        return 0
    
    # Convert timestamp (milliseconds to datetime)
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
    df['datetime'] = df['datetime'].dt.tz_localize(None)
    
    # Sort and dedupe
    df = df.sort_values('datetime').drop_duplicates(subset=['datetime'], keep='last')
    
    # Filter out weekend/flat data if all OHLC are identical
    # These are typically placeholder bars during market close
    has_movement = ~((df['open'] == df['high']) & 
                     (df['high'] == df['low']) & 
                     (df['low'] == df['close']))
    
    flat_count = (~has_movement).sum()
    if flat_count > 0:
        logger.info(f"Removing {flat_count:,} flat bars (market closed periods)")
        df = df[has_movement]
    
    # Format for MT5
    mt5_df = pd.DataFrame()
    mt5_df['Date'] = df['datetime'].dt.strftime('%Y.%m.%d')
    mt5_df['Time'] = df['datetime'].dt.strftime('%H:%M')
    mt5_df['Open'] = df['open'].astype(float)
    mt5_df['High'] = df['high'].astype(float)
    mt5_df['Low'] = df['low'].astype(float)
    mt5_df['Close'] = df['close'].astype(float)
    
    # Add volume column (dukascopy doesn't provide volume for forex/gold M1)
    # Use 1.0 as placeholder
    mt5_df['Volume'] = 1.0
    
    mt5_df.to_csv(output_file, index=False, float_format='%.6g')
    
    # Get date range
    first_date = df['datetime'].iloc[0].strftime('%Y.%m.%d')
    last_date = df['datetime'].iloc[-1].strftime('%Y.%m.%d')
    
    logger.info(f"Converted {len(mt5_df):,} rows: {first_date} to {last_date}")
    return len(mt5_df)


def main():
    args = parse_args()
    
    # Determine date range
    # Default: last year (2025-01-01 to 2026-01-01, capped at today)
    today = datetime.now()
    
    if args.year:
        year = args.year
        from_date = f"{year}-01-01"
        # Don't go past today
        if year >= today.year:
            to_date = today.strftime("%Y-%m-%d")
        else:
            to_date = f"{year + 1}-01-01"
        logger.info(f"Downloading year {year}: {from_date} to {to_date}")
    elif args.from_date and args.to_date:
        from_date = args.from_date
        to_date = args.to_date
        logger.info(f"Downloading custom range: {from_date} to {to_date}")
    else:
        # Default: 2025 up to today
        from_date = "2025-01-01"
        to_date = today.strftime("%Y-%m-%d")
        logger.info(f"Default: downloading 2025 to today: {from_date} to {to_date}")
    
    # Create output directory
    outdir = PROJECT_DIR / args.outdir
    outdir.mkdir(parents=True, exist_ok=True)
    
    # Download data
    raw_file = download_data(from_date, to_date, outdir)
    
    if not raw_file or not raw_file.exists():
        logger.error("Download failed!")
        sys.exit(1)
    
    # Convert to MT5 format
    year_str = from_date[:4]
    mt5_file = outdir / f"XAUUSD_M1_{year_str}_MT5.csv"
    
    rows = convert_to_mt5(raw_file, mt5_file)
    
    if rows == 0:
        logger.error("Conversion failed!")
        sys.exit(1)
    
    # Summary
    size_mb = mt5_file.stat().st_size / (1024 * 1024)
    
    print("\n" + "=" * 60)
    print("DOWNLOAD SUMMARY")
    print("=" * 60)
    print(f"Instrument:     XAUUSD")
    print(f"Timeframe:      M1 (1-minute)")
    print(f"Date range:     {from_date} to {to_date}")
    print(f"Total rows:     {rows:,}")
    print(f"File size:      {size_mb:.2f} MB")
    print(f"Output file:    {mt5_file}")
    print("=" * 60)
    print("\nReady for MT5 import!")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Configurable Walk-Forward Analysis Test Runner
==============================================

PURPOSE: Flexible test runner for Walk-Forward Analysis with external configuration support
USAGE:
  python scripts/walk_forward_smoke_test.py --config config/walk_forward_SMOKE.yaml
  python scripts/walk_forward_smoke_test.py --config config/walk_forward_FULL.yaml
  python scripts/walk_forward_smoke_test.py  # Uses default full dataset behavior

FEATURES:
- Command-line configuration file support
- Backward compatibility with hardcoded defaults
- Dynamic parameter override integration
- Comprehensive error handling and logging
- Flexible dataset and parameter configuration
"""

import os
import sys
import gc
import logging
import traceback
import yaml
import argparse
from datetime import datetime, timezone
from pathlib import Path


def configure_text_streams():
    """Prefer UTF-8 console output; fall back to escaped text instead of crashing."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            try:
                reconfigure(encoding="utf-8", errors="backslashreplace")
            except Exception:
                pass


configure_text_streams()

# Set up basic logging for smoke test
logging.basicConfig(
    level=logging.INFO,  # Changed to INFO for speed
    format="%(asctime)s - %(name)s - [%(levelname)s] - %(message)s"
)
logger = logging.getLogger("HighSpeedSmokeTest")

logger.info("🚀 HIGH-SPEED SMOKE TEST STARTING")

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def parse_command_line_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="Configurable Walk-Forward Analysis Test Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/walk_forward_smoke_test.py --config config/walk_forward_SMOKE.yaml
  python scripts/walk_forward_smoke_test.py --config config/walk_forward_FULL.yaml
  python scripts/walk_forward_smoke_test.py  # Uses default behavior
        """
    )

    parser.add_argument(
        '--config', '-c',
        type=str,
        help='Path to YAML configuration file (relative to project root)'
    )

    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose DEBUG logging'
    )

    return parser.parse_args()

def load_configuration(config_path=None):
    """Load configuration from YAML file or use defaults"""
    if config_path:
        # Load external configuration file
        full_config_path = project_root / config_path

        if not full_config_path.exists():
            raise FileNotFoundError(f"Configuration file not found: {full_config_path}")

        with open(full_config_path, 'r') as f:
            config = yaml.safe_load(f)

        logger.info(f"✅ Loaded configuration from {full_config_path}")
        return config, "external"
    else:
        # Use default hardcoded configuration for backward compatibility
        logger.info("📋 Using default hardcoded configuration (backward compatibility mode)")
        default_config = {
            'walk_forward': {
                'training_months': 6,
                'testing_months': 1,
                'step_months': 1,
                'n_parameter_trials': 25,
                'output_directory': "results/default_analysis",
                'performance_mode': True,
                'save_detailed_results': True,
                'save_window_data': False
            },
            'data': {
                'source_file': "data/EURUSD_M15_2011_FULL.csv"
            },
            'strategy': {
                'profile_key': "EURUSD_RSI_OPTIMIZED_PHASE6"
            },
            'performance': {
                'max_execution_time_seconds': 3600
            }
        }
        return default_config, "default"

def print_checkpoint(message, progress=None):
    """Print checkpoint with timestamp and optional progress"""
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    if progress:
        logger.info(f"[{timestamp}] === SMOKE TEST CHECKPOINT: {message} | Progress: {progress}% ===")
    else:
        logger.info(f"[{timestamp}] === SMOKE TEST CHECKPOINT: {message} ===")
    sys.stdout.flush()

def print_memory_usage():
    """Print current memory usage (simplified)"""
    logger.debug("[MEMORY] Garbage collection triggered")
    gc.collect()
    sys.stdout.flush()

def main():
    """Main configurable test runner function"""
    start_time = datetime.now()

    try:
        # Parse command line arguments
        args = parse_command_line_args()

        print_checkpoint("CONFIGURABLE TEST RUNNER INITIALIZATION")
        print_memory_usage()

        # Set up logging based on verbose flag
        log_level = logging.DEBUG if args.verbose else logging.INFO

        # Clear any existing handlers to avoid conflicts
        for handler in logging.root.handlers[:]:
            logging.root.removeHandler(handler)

        # Clear any existing filters to avoid LogRecord conflicts
        for logger_name in logging.Logger.manager.loggerDict:
            existing_logger = logging.getLogger(logger_name)
            existing_logger.handlers.clear()
            existing_logger.filters.clear()

        # Use simple logging configuration - file handler added after config load
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - [%(levelname)s] - %(message)s',
            handlers=[logging.StreamHandler(sys.stdout)],
            force=True  # Force reconfiguration
        )

        if args.verbose:
            logger.info("🔍 DEBUG logging enabled")
        
        print_checkpoint("IMPORTING MODULES")

        # from src.walk_forward.walk_forward_runner import WalkForwardRunner
        from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig
        from src.config_manager import load_and_validate_config
        from src.data_handler.market_data_manager import MarketDataManager
        from src.api_connector.paper_trading_adapter import PaperTradingAdapter
        from src.core.enums import Timeframe
        
        print_checkpoint("MODULES IMPORTED SUCCESSFULLY")
        print_memory_usage()
        
        # Initialize configuration
        print_checkpoint("LOADING APP CONFIG")
        app_config = load_and_validate_config()
        
        print_checkpoint("APP CONFIG LOADED")
        logger.debug(f"Config type: {type(app_config)}")
        logger.debug(f"Config keys: {list(app_config.keys()) if hasattr(app_config, 'keys') else 'N/A'}")
        
        # Load configuration (external or default)
        print_checkpoint("LOADING CONFIGURATION")
        config, config_type = load_configuration(args.config)

        print_checkpoint(f"CONFIGURATION LOADED ({config_type.upper()})")

        # Add file handler if logging config specifies log_file
        logging_config = config.get('logging', {})
        log_file_path = logging_config.get('log_file')
        if log_file_path:
            log_dir = Path(log_file_path).parent
            log_dir.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(log_file_path, mode='w', encoding='utf-8')
            file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - [%(levelname)s] - %(message)s'))
            logging.getLogger().addHandler(file_handler)
            logger.info(f"📝 Logging to file: {log_file_path}")

        # Extract configuration sections
        wf_settings = config['walk_forward']
        data_settings = config['data']
        strategy_settings = config['strategy']
        performance_settings = config['performance']

        # Create walk-forward configuration
        print_checkpoint("CREATING WALK-FORWARD CONFIG")
        
        # Extract parameter_ranges from strategy settings if present
        param_ranges_override = strategy_settings.get('parameter_ranges', None)
        if param_ranges_override:
            logger.info(f"🎛️ Using EXTERNAL parameter_ranges from YAML config: {list(param_ranges_override.keys())}")
        
        # Extract backtest settings (fees, slippage)
        backtest_settings = config.get('backtest', {})
        yaml_fees = backtest_settings.get('fees', None)
        yaml_slippage = backtest_settings.get('slippage', None)
        
        if yaml_fees is not None:
            logger.info(f"💰 Using YAML fees: {yaml_fees} ({yaml_fees*100:.4f}% per trade)")
        if yaml_slippage is not None:
            logger.info(f"📉 Using YAML slippage: {yaml_slippage} ({yaml_slippage*100:.4f}% per trade)")
        
        wf_config = WalkForwardConfig(
            strategy_profile_key=strategy_settings['profile_key'],
            training_months=wf_settings['training_months'],
            testing_months=wf_settings['testing_months'],
            step_months=wf_settings['step_months'],
            n_parameter_trials=wf_settings['n_parameter_trials'],
            output_directory=wf_settings['output_directory'],
            performance_mode=wf_settings.get('performance_mode', True),
            save_detailed_results=wf_settings.get('save_detailed_results', True),
            save_window_data=wf_settings.get('save_window_data', False),
            # CRITICAL FIX: Extract missing configuration values
            initial_balance=backtest_settings.get('initial_balance', 100000.0),
            optimization_seed=wf_settings.get('optimization_seed', None),
            min_bars_per_window=data_settings.get('min_required_bars', 100),
            use_vectorized_backtest=wf_settings.get('use_vectorized_backtest', False),
            # NEW: Pass YAML parameter_ranges as override
            parameter_ranges_override=param_ranges_override,
            # NEW: Pass transaction costs from YAML (None means use defaults with warning)
            fees=yaml_fees,
            slippage=yaml_slippage
        )
        # Optional: skip DB persistence in smoke runs
        skip_db = bool(config.get('performance', {}).get('skip_database_persistence', False) or os.environ.get('WFA_SKIP_DB', '0') == '1')
        os.environ['WFA_SKIP_DB'] = '1' if skip_db else '0'
        logger.info(f"DB persistence skip for this run: {skip_db}")

        print_checkpoint("WALK-FORWARD CONFIG CREATED")
        logger.info(f"Config: {wf_config.training_months}M training, {wf_config.testing_months}M testing, {wf_config.n_parameter_trials} trials")
        logger.info(f"Data source: {data_settings['source_file']}")
        logger.info(f"Target execution time: {performance_settings['max_execution_time_seconds']}s")
        logger.info(f"Configuration type: {config_type}")
        
        # Initialize platform adapter
        print_checkpoint("INITIALIZING PLATFORM ADAPTER")
        import pandas as pd
        paper_adapter = PaperTradingAdapter(
            config=app_config,
            logger=logging.getLogger("SmokeTest.PaperAdapter"),
            historical_data=pd.DataFrame(),  # Will be set during backtesting
            initial_balance=wf_config.initial_balance
        )
        
        print_checkpoint("PLATFORM ADAPTER INITIALIZED")
        
        # Initialize MarketDataManager (refactored version) with CSV data source
        print_checkpoint("INITIALIZING MARKET DATA MANAGER")
        from src.data_handler.data_sources import DataSourceFactory

        # Create CSV data source instead of default mock_api
        csv_data_source = DataSourceFactory.create_data_source("csv", data_directory="data")
        market_data_manager = MarketDataManager(data_source=csv_data_source)
        
        print_checkpoint("MARKET DATA MANAGER INITIALIZED")
        print_memory_usage()
        
        # Initialize WalkForwardRunner
        print_checkpoint("INITIALIZING WALK-FORWARD RUNNER")
        runner = WalkForwardRunner(
            config=wf_config,
            app_config=app_config,
            logger=logging.getLogger("SmokeTest.WalkForwardRunner"),
            market_data_manager=market_data_manager
        )
        
        print_checkpoint("WALK-FORWARD RUNNER INITIALIZED")
        print_memory_usage()
        
        # Load and validate data
        print_checkpoint("LOADING AND VALIDATING DATA")

        try:
            # Monkey patch the runner to add checkpoints
            original_run_walk_forward = runner.run_walk_forward_analysis

            def monitored_run_walk_forward(*args, **kwargs):
                print_checkpoint("RUNNER.RUN_WALK_FORWARD_ANALYSIS() CALLED")
                print_memory_usage()
                return original_run_walk_forward(*args, **kwargs)

            # Apply monkey patch
            runner.run_walk_forward_analysis = monitored_run_walk_forward

            print_checkpoint("STARTING WALK-FORWARD EXECUTION")

            # Execute walk-forward analysis with configured dataset
            data_file_path = data_settings['source_file']
            logger.info(f"🗂️  Using dataset: {data_file_path}")

            # Verify dataset exists
            if not os.path.exists(data_file_path):
                raise FileNotFoundError(f"Dataset not found: {data_file_path}")

            results = runner.run_walk_forward_analysis(
                data_source=data_file_path,
                save_results=True
            )

            print_checkpoint("WALK-FORWARD EXECUTION COMPLETED")
            print_memory_usage()

            # Calculate execution time and validate performance
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            target_time = performance_settings['max_execution_time_seconds']

            print_checkpoint("PROCESSING RESULTS")
            logger.info(f"⏱️  Execution time: {execution_time:.1f}s (target: {target_time}s)")

            # Validate execution time
            if execution_time <= target_time:
                logger.info(f"✅ PERFORMANCE TARGET MET: {execution_time:.1f}s <= {target_time}s")
            else:
                logger.warning(f"⚠️  PERFORMANCE TARGET MISSED: {execution_time:.1f}s > {target_time}s")

            # Print results summary
            if results:
                logger.info(f"📊 Results type: {type(results)}")
                if hasattr(results, 'summary'):
                    summary = results.summary
                    total_trades = summary.get('aggregate_total_trades', 0)
                    total_windows = len(summary.get('window_results', []))
                    logger.info(f"📈 Total windows: {total_windows}, Total trades: {total_trades}")
                    
                    # === ENHANCED METRICS CALCULATION ===
                    logger.info("=" * 70)
                    logger.info("📊 COMPREHENSIVE PERFORMANCE METRICS")
                    logger.info("=" * 70)
                    
                    try:
                        from src.utils.math_utils import (
                            calculate_sharpe_ratio,
                            calculate_max_drawdown,
                            calculate_win_rate,
                            calculate_profit_factor
                        )
                        import numpy as np
                        
                        # Extract trade PnL values from results
                        all_pnl = []
                        all_equity = [wf_config.initial_balance]
                        
                        for window in summary.get('window_results', []):
                            if 'trades' in window:
                                for trade in window['trades']:
                                    pnl = trade.get('pnl', 0)
                                    all_pnl.append(pnl)
                                    all_equity.append(all_equity[-1] + pnl)
                            elif 'validation_pnl' in window:
                                pnl = window['validation_pnl']
                                all_pnl.append(pnl)
                                all_equity.append(all_equity[-1] + pnl)
                        
                        if len(all_pnl) > 0:
                            equity_array = np.array(all_equity)
                            returns = np.diff(equity_array) / equity_array[:-1]
                            
                            sharpe = calculate_sharpe_ratio(returns, periods_per_year=252)
                            max_dd = calculate_max_drawdown(all_equity)
                            win_rate = calculate_win_rate(all_pnl)
                            profit_factor = calculate_profit_factor(all_pnl)
                            total_return = (all_equity[-1] - wf_config.initial_balance) / wf_config.initial_balance * 100
                            
                            logger.info(f"📈 Sharpe Ratio: {sharpe:.3f}")
                            logger.info(f"📉 Max Drawdown: {max_dd:.2f}%")
                            logger.info(f"🎯 Win Rate: {win_rate:.1f}%")
                            logger.info(f"💰 Profit Factor: {profit_factor:.2f}")
                            logger.info(f"📊 Total Return: {total_return:.2f}%")
                            logger.info(f"💵 Final Balance: {all_equity[-1]:,.2f}")
                            logger.info(f"🔢 Total Trades: {len(all_pnl)}")
                        else:
                            logger.warning("⚠️  No trade data available for detailed metrics")
                            
                    except Exception as metric_error:
                        logger.warning(f"⚠️  Could not calculate detailed metrics: {metric_error}")
                    
                    logger.info("=" * 70)

                print_checkpoint("CONFIGURABLE TEST RUNNER COMPLETED SUCCESSFULLY", 100)
                logger.info(f"All validation criteria met! ({config_type} configuration)")
                return results
            else:
                print_checkpoint("NO RESULTS RETURNED - POTENTIAL ISSUE")
                return None
                
        except Exception as execution_error:
            print_checkpoint("EXECUTION ERROR CAUGHT")
            logger.error(f"ERROR: {str(execution_error)}")
            logger.error("FULL STACK TRACE:")
            logger.error(traceback.format_exc())
            print_memory_usage()
            print_memory_usage()
            return None
            
    except Exception as setup_error:
        print_checkpoint("SETUP ERROR CAUGHT")
        logger.error(f"SETUP ERROR: {str(setup_error)}")
        logger.error("FULL STACK TRACE:")
        logger.error(traceback.format_exc())
        logger.error("FULL STACK TRACE:")
        logger.error(traceback.format_exc())
        return None
    
    finally:
        print_checkpoint("CLEANUP AND GARBAGE COLLECTION")
        gc.collect()
        print_memory_usage()
    
    return True

logger.debug("SMOKE TEST SCRIPT - ABOUT TO CHECK __name__ == '__main__'")
logger.debug(f"SMOKE TEST SCRIPT - __name__ = {__name__}")

if __name__ == "__main__":
    logger.info("=" * 80)
    logger.info("CONFIGURABLE WALK-FORWARD ANALYSIS TEST RUNNER")
    logger.info("=" * 80)
    logger.info(f"Start time: {datetime.now()}")
    logger.info("=" * 80)

    results = main()

    logger.info("=" * 80)
    logger.info(f"End time: {datetime.now()}")
    if results:
        logger.info("=== SMOKE TEST SUMMARY ===")
        logger.info(f"Windows: {results.total_windows}")
        logger.info(f"Success: {results.successful_windows}")
        logger.info(f"Returns: {results.aggregate_return_pct:.2f}%")
        logger.info(f"Sharpe:  {results.aggregate_sharpe_ratio:.3f}")
        
        if results.successful_windows > 0 and results.aggregate_total_trades > 0:
            logger.info("TEST RUNNER COMPLETED SUCCESSFULLY")
            print_checkpoint("SMOKE TEST PASSED")
            sys.exit(0)
        else:
            logger.error("TEST RUNNER FAILED")
            sys.exit(1)
    else:
        logger.error("TEST RUNNER FAILED (No Results)")
        sys.exit(1)
    logger.info("=" * 80)

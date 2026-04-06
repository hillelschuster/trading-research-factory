
import sys
import os
import unittest
import pandas as pd
import numpy as np
from pathlib import Path

# Add src to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.walk_forward.walk_forward_runner import WalkForwardRunner, WalkForwardConfig

class TestWFADeterminism(unittest.TestCase):
    def setUp(self):
        # Create minimal valid config
        self.config = WalkForwardConfig(
            training_months=6,
            testing_months=1,
            step_months=1,
            n_parameter_trials=2,  # Very small for speed
            optimization_seed=42,  # FIXED SEED
            strategy_profile_key="EURUSD_LONDON_BREAKOUT",
            output_directory="results/test_determinism",
            use_vectorized_backtest=True,
            max_workers=1
        )
        
        # Create synthetic data correctly
        dates = pd.date_range(start="2023-01-01", periods=1000, freq="15min")
        self.data = pd.DataFrame({
            "Date": dates,
            "Open": 1.1000 + np.random.normal(0, 0.001, 1000).cumsum(),
            "High": 0.0,
            "Low": 0.0,
            "Close": 0.0,
            "Volume": 1000
        })
        # Fix H/L/C based on Open
        self.data["Close"] = self.data["Open"] + np.random.normal(0, 0.0005, 1000)
        self.data["High"] = self.data[["Open", "Close"]].max(axis=1) + 0.0002
        self.data["Low"] = self.data[["Open", "Close"]].min(axis=1) - 0.0002
        
        # DEBUG: Check if main_config.yaml exists
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'main_config.yaml')
        print(f"\n[Debug] Checking config at: {config_path}")
        print(f"[Debug] Exists: {os.path.exists(config_path)}")

    def test_determinism(self):
        """Run WFA twice with same seed -> Expect identical results"""
        
        print("\n[Test] Running Run 1...")
        
        # EXPLICITLY LOAD CONFIG TO DEBUG
        from src.config_manager import load_and_validate_config
        try:
            app_config = load_and_validate_config()
            print(f"[Debug] AppConfig loaded: type={type(app_config)}")
            print(f"[Debug] Keys: {app_config.__dict__.keys() if hasattr(app_config, '__dict__') else 'no __dict__'}")
        except Exception as e:
            print(f"[Fatal] Config loading failed: {e}")
            raise
            
        runner1 = WalkForwardRunner(self.config, app_config=app_config)
        
        try:
             # Run 1
            result1 = runner1.run_walk_forward_analysis(self.data, save_results=False)
            
            print("\n[Test] Running Run 2...")
            runner2 = WalkForwardRunner(self.config, app_config=app_config)
            result2 = runner2.run_walk_forward_analysis(self.data, save_results=False)
            
            # Compare
            self.assertEqual(result1.aggregate_return_pct, result2.aggregate_return_pct)
            print(f"\n[Success] Determinism verified: {result1.aggregate_return_pct:.6f} == {result2.aggregate_return_pct:.6f}")
            
        except Exception as e:
            with open("smoke_error.log", "w") as f:
                f.write(f"Test failed: {e}\n")
                import traceback
                traceback.print_exc(file=f)
            print(f"\n[Error] Test failed: {e}")
            raise

if __name__ == '__main__':
    unittest.main()

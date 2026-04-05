# Walk-Forward Engine (WFA)

Research-only Walk-Forward Analysis. No live execution and no database persistence.

## Critical Rules (Non-Negotiable)
- NEVER put strategy logic in `src/walk_forward/walk_forward_runner.py` or any non-strategy module.
- Strategy logic goes ONLY in `src/strategies/<strategy>.py`.
- Strategy selection is config-driven (no hardcoded imports, no if/elif chains in the runner).

## Strategy Creation: Production Flow (Do This Every Time)
1) Create the strategy code
   - File: `src/strategies/<strategy_name>.py`
   - Implement `generate_vectorized_signals(data, params=None)` for WFA.
   - WFA uses a lightweight strategy instance during optimization; `self.config` may be `None`.
   - Assume `data` has `timestamp` (or `Date`) plus `open`, `high`, `low`, `close` (and `volume` if needed).

2) Create the strategy parameters JSON
   - File: `config/strategy_<name>.json`
   - Required fields:
     - `strategy_params_key` (usually the filename)
     - `strategy_definition_key` (matches main_config)
     - `parameters` (default params)
     - `parameter_ranges` or `optimization_ranges` (for WFA optimization)

3) Register in `config/main_config.yaml`
   - Add an `asset_strategy_profiles` entry with `enabled: true`
   - Add a `strategy_definitions` entry pointing to your module/class

4) (Optional but recommended) Add Pydantic validation
   - Define a params model in your strategy file
   - Register it in `src/strategies/params_registry.py`
   - This validates params at config load time

5) Create a strategy workspace folder
   - Folder: `strategies/<strategy_name>/`
   - Put a run config at `strategies/<strategy_name>/wfa_config.yaml`
   - WFA attempts to append run history to `strategies/<strategy_name>/wfa_history.json`

6) Run WFA
   - `python scripts/walk_forward_smoke_test.py --config strategies/<strategy_name>/wfa_config.yaml`
   - Validate the YAML first (optional): `python scripts/validate_wfa_config.py --config <path>`

## Config Chain (How WFA Loads a Strategy)
```
wfa_config.yaml (strategy.profile_key)
  -> config/main_config.yaml (asset_strategy_profiles)
     -> strategy_params_key -> config/strategy_<name>.json
        -> strategy_definition_key -> config/main_config.yaml (strategy_definitions)
           -> importlib -> src/strategies/<strategy_name>.py::<StrategyClass>
```

## Strategy Interface (Vectorized)
WFA is vectorized-only. Vectorbt is required (see `requirements.txt`).
Your strategy must implement:
```
def generate_vectorized_signals(self, data, params=None) -> dict:
    return {
        "long_entries":  <bool array>,
        "long_exits":    <bool array>,
        "short_entries": <bool array>,
        "short_exits":   <bool array>,
        "sl_stop":       <optional float/array>,
        "tp_stop":       <optional float/array>
    }
```
Rules:
- Arrays must be the same length as `data`.
- Signals must be boolean arrays.
- The vectorized engine shifts entry/exit signals by 1 bar before execution (signal at bar N executes at bar N+1 open).
- Do not rely on the signal shift to fix indicator lookahead. Indicators must be based only on data available at signal time.
- Using current-bar close/indicator values is OK as long as execution is next-bar open.
- For resampled or higher-timeframe indicators, shift by 1 period before mapping to lower timeframes.
- Keep warmup bars False to avoid accidental early entries.

## Strategy Parameters JSON (Config)
Example `config/strategy_my_strategy.json`:
```json
{
  "strategy_params_key": "strategy_my_strategy.json",
  "description": "My Strategy - brief description",
  "strategy_definition_key": "MyStrategy_Definition",
  "parameters": {
    "timeframe": "M15",
    "fast_period": 10,
    "slow_period": 20
  },
  "parameter_ranges": {
    "fast_period": { "values": [8, 10, 12, 14] },
    "slow_period": { "values": [18, 20, 22, 25] }
  }
}
```
Notes:
- `parameter_ranges` and `optimization_ranges` are both supported.
- Ranges are value lists; the engine infers type and steps.
- If you provide no ranges, WFA will run but optimization will not search.

## main_config.yaml Entries (Required)
Add both entries:
```yaml
asset_strategy_profiles:
  EURUSD_MY_STRATEGY:
    symbol: "EURUSD"
    enabled: true
    instrument_details_key: "EURUSD_FTMO"
    strategy_params_key: "strategy_my_strategy.json"
    timeframe: "M15"

strategy_definitions:
  MyStrategy_Definition:
    strategy_module: "src.strategies.my_strategy"
    strategy_class: "MyStrategy"
```
Important:
- `strategy_definition_key` in JSON must match the `strategy_definitions` key.
- `strategy_module` is a Python module path (dot notation).
- For WFA runs, the profile must be `enabled: true` or params will not load.

## WFA Run Config (YAML Used by scripts/walk_forward_smoke_test.py)
Required top-level sections: `walk_forward`, `data`, `strategy`, `performance`.

Minimal example:
```yaml
walk_forward:
  training_months: 6
  testing_months: 1
  step_months: 1
  n_parameter_trials: 50
  output_directory: "strategies/my_strategy/results/run_001"
  use_vectorized_backtest: true
  performance_mode: true
  save_detailed_results: true
  save_window_data: false

data:
  source_file: "data/EURUSD_M15_2003-2025/EURUSD_M15_2011_2025_COMBINED.csv"
  min_required_bars: 1000

strategy:
  profile_key: "EURUSD_MY_STRATEGY"
  parameter_ranges:  # optional override for this run
    fast_period: [8, 10, 12]
    slow_period: [18, 20, 22]

backtest:
  initial_balance: 10000
  fees: 0.0001
  slippage: 0.0001

performance:
  max_execution_time_seconds: 3600
  skip_database_persistence: true

logging:
  log_file: "logs/wfa_my_strategy.log"
```
Use `scripts/validate_wfa_config.py` to confirm the schema.

## Outputs
Results are saved under `walk_forward.output_directory`:
- `walk_forward_results_<timestamp>.json`
- `walk_forward_summary_<timestamp>.csv`
- `analysis.json` (compact artifact)
- `parameter_stability_<timestamp>.json`

Additionally, WFA attempts to append to:
- `strategies/<strategy_name>/wfa_history.json` (folder name should share tokens with the profile key)

## Scripts
- `scripts/walk_forward_smoke_test.py` - main WFA runner (YAML-driven)
- `scripts/validate_wfa_config.py` - validate WFA YAML schema
- `scripts/smoke_test_london_sweep.py` - programmatic WFA example
- `scripts/extract_log_metrics.py` - extract metrics from logs/artifacts

## Common Mistakes (Avoid These)
- Adding strategy code to `src/walk_forward/walk_forward_runner.py`
- Forgetting `enabled: true` for the strategy profile
- Mismatched `strategy_definition_key` or wrong module/class path
- Missing `generate_vectorized_signals` or returning wrong keys
- Editing `strategies/<name>/strategy.json` (loader only reads `config/strategy_*.json`)
- Data files without `timestamp` (or `Date`) and `open/high/low/close`

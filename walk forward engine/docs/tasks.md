# Verified Implementation Tasks

This document is the current implementation plan, re-verified against the live codebase on 2026-03-08.

Already present in the codebase and **not** active tasks:
- strategy-param Pydantic validation via `src/strategies/params_registry.py`
- config-time loading of strategy parameter JSON files
- basic leakage logging / hashing scaffolding

The tasks below cover only the remaining work needed to make the walk-forward engine trustworthy and ready for future research workflows.

## Priority 0 - Must Fix Before Trusting Results

### 1) [x] Make outer `testing_months` the real final OOS segment
- **Why it matters:** The live path does more than double-split: it effectively drops the configured outer testing segment. `WFAWindowManager` builds outer optimization/validation periods, but `create_leakage_proof_split(...)` only splits the outer optimization period into an inner 70/30 train/validation slice. `WalkForwardRunner._process_single_window(...)` then concatenates those inner slices and splits them again. Final `testing_period_*` metadata still points at the outer validation period, even though the actual evaluated slice came from inside the optimization window.
- **Required outcome:** Final OOS evaluation must use the configured outer testing window only. No implicit inner 70/30 split may override or relabel the outer test segment.
- **Files / modules:** `src/walk_forward/wfa_window_manager.py`, `src/walk_forward/data_integrity.py`, `src/walk_forward/walk_forward_runner.py`, `tests/test_leakage_guard.py`, `tests/test_wfa_e2e_smoke.py`
- **Definition of done:**
  - `window.testing_period_start/end` matches the exact data used for final OOS evaluation.
  - Remove the recombine-and-resplit path from `_process_single_window(...)`.
  - Either remove `optimization_validation_split` from the default WFA path or make nested validation explicit and limited to the outer training window.
  - Replace `timedelta(days=30 * months)` window math with calendar-aware month arithmetic so configured month windows map to actual calendar periods.
  - Add regression tests proving that configured `testing_months` is the final evaluated segment.
- **Completed 2026-03-08:** The default WFA path now uses explicit outer train/test splits prepared by `WFAWindowManager`, month windows are calendar-aware via `relativedelta`, `_process_single_window(...)` no longer recombines and re-splits data, and targeted regressions cover both the split boundaries and the final evaluated OOS slice.
- **Dependencies:** Do this first; every metric and artifact depends on it.

### 2) [x] Normalize win-rate semantics and stop reverse-engineering trade counts
- **Why it matters:** The live vectorized path returns `win_rate` as `0-100`, while `WindowResult` documents `0-1`, aggregates reconstruct wins with `r.total_trades * r.win_rate / 100`, and `analysis.json` expectancy treats aggregate win rate like a fraction. The result is internally inconsistent math.
- **Required outcome:** Use one internal convention everywhere: `win_rate` as a decimal fraction (`0.0-1.0`). Carry explicit win/loss counts through the pipeline instead of inferring them back from `win_rate`.
- **Files / modules:** `src/backtesting/vectorized_backtest_engine.py`, `src/walk_forward/walk_forward_runner.py`, `src/walk_forward/validation/result_schema.py`, result/history writers in `walk_forward_runner.py`, related tests
- **Definition of done:**
  - `VectorizedBacktestResult`, `WindowResult`, aggregates, `analysis.json`, and `wfa_history.json` use the same `win_rate` convention.
  - Add explicit `win_count` / `loss_count` fields and aggregate from them directly.
  - Expectancy, avg win/loss, and profit-factor-related reporting use the correct scale.
  - Presentation-only percent fields are named clearly (for example `_pct`) or formatted only at export time.
  - Add focused tests for win rate, win/loss counts, and expectancy math.
- **Completed 2026-03-08:** The vectorized backtest layer now normalizes `win_rate` to a fraction, explicit win/loss counts are carried through window and aggregate results, expectancy uses aggregate trade metrics instead of mixed window-return units, and schema/tests now catch impossible trade-metric combinations.
- **Dependencies:** Re-run after Task 1 because the evaluated segment changes.

### 3) Correct risk-adjusted metrics and make them timeframe-aware in the live vectorized path
- **Why it matters:** `VectorizedBacktestEngine.run_strategy_backtest(...)` still uses `sqrt(252 * 96)`, which assumes M15 bars. That path is also used by H4 and D1 strategies, so optimizer scores are mis-scaled across strategies/timeframes. In addition, `_calculate_aggregate_results()` uses the mean of per-window Sharpes as `aggregate_sharpe_ratio`, and `run_strategy_backtest(...)` currently emits `sortino_ratio=0.0` and `calmar_ratio=0.0` placeholders.
- **Required outcome:** Annualized and aggregate risk-adjusted metrics must be computed correctly for the active timeframe, or omitted until they are implemented correctly.
- **Files / modules:** `src/backtesting/vectorized_backtest_engine.py`, `src/core/enums.py`, `src/config_manager.py`, `src/walk_forward/walk_forward_runner.py`, relevant tests/configs
- **Definition of done:**
  - Create a shared annualization helper keyed by timeframe.
  - Pass timeframe into the live vectorized backtest path from the selected strategy/profile.
  - Validate configured timeframe against data cadence when practical.
  - `aggregate_sharpe_ratio` is not computed as a plain mean of per-window Sharpe values; compute it from an appropriate combined return stream or remove/rename the field until supported.
  - `sortino_ratio` and `calmar_ratio` in the live vectorized path are either computed correctly or removed from outputs until supported.
  - Add tests covering at least M15, H4, and D1.
- **Completed implementation 2026-03-08:** The live vectorized path now uses the shared annualization helper in `src/core/annualization.py`, passes the selected strategy/profile timeframe into both vectorized backtest call sites, validates incompatible data cadence when it can be inferred, computes live `sharpe_ratio` / `sortino_ratio` / `calmar_ratio` from the combined equity curve, and computes `aggregate_sharpe_ratio` from the combined window-return stream instead of averaging per-window Sharpe values. Added focused regression coverage in `tests/test_risk_metric_annualization.py` and extended `tests/test_trade_metrics_normalization.py`.
- **Validation note 2026-03-08:** Runtime test execution in this workspace is currently unreliable because the local Python environment intermittently hangs or is interrupted during standard-library import (`json`) before the targeted test modules complete. Static diagnostics on the touched files are clean, but the focused test rerun should be repeated once the environment issue is resolved.
- **Dependencies:** Best done after or alongside Task 2.

### 4) Make strategy config resolution fail fast end-to-end
- **Why it matters:** The known mismatch is still live: `config/strategy_london_breakout.json` uses `LondonBreakout_ORB`, but `config/main_config.yaml` only defines `LondonBreakout_PriceAction`. `config_manager.py` validates parameter shape but does not fail on unresolved strategy-definition chains; later, `walk_forward_runner.py` catches import/resolution errors, logs a warning, and flips `use_vectorized_backtest = False`. Separately, `config_manager.py` still tries to load `config/instruments_ftmo.json`, but only `config/instruments.json` exists in the repo, and enabled profiles such as `GBPJPY_REVERSION` reference instrument keys that are therefore never validated.
- **Required outcome:** Enabled profiles must fail at config/startup time if any link cannot be resolved: profile -> params file -> `strategy_definition_key` -> importable strategy class -> required execution interface -> instrument details.
- **Files / modules:** `src/config_manager.py`, `src/walk_forward/walk_forward_runner.py`, `config/main_config.yaml`, `config/strategy_london_breakout.json`, `src/strategies/params_registry.py`, `tests/test_strategy_params_validation.py`
- **Definition of done:**
  - Fix the known London Breakout definition mismatch.
  - Raise on missing params files, missing strategy definitions, bad import paths, or missing strategy classes for enabled profiles.
  - If the WFA path is vectorized-only, do not silently downgrade to a non-vectorized path.
  - Validate the instrument-details file path and each enabled profile’s `instrument_details_key` instead of warning and continuing.
  - Add targeted tests for each failure mode.
- **Dependencies:** Independent, but complete this before trusting large reruns.

### 5) Make transaction-cost assumptions explicit instead of silently defaulted
- **Why it matters:** `WalkForwardConfig.fees/slippage` default to `None`, but `_get_fees()` / `_get_slippage()` still warn and silently fall back to `0.0001` despite comments claiming fail-fast behavior. That means research runs can succeed with unintentional cost assumptions.
- **Required outcome:** Transaction costs used in WFA runs must be explicit, validated, and visible in artifacts.
- **Files / modules:** `src/walk_forward/walk_forward_runner.py`, config-loading path in `src/config_manager.py`, relevant configs/tests, artifact writers in `walk_forward_runner.py`
- **Definition of done:**
  - Decide and implement one clear policy: either require explicit fees/slippage for research runs, or centralize documented defaults in config validation rather than hidden runner fallbacks.
  - Remove misleading “fail-fast” comments that do not match behavior.
  - Persist the effective fee/slippage source in saved artifacts.
  - Add tests covering both explicit-cost and missing-cost behavior.
- **Dependencies:** Coordinate with Task 7 because artifacts must record the final assumptions.

## Priority 1 - Must Fix Before RL / Meta-Learning

### 6) Separate execution success from economic validity; classify zero-trade windows
- **Why it matters:** `WindowResult.success` still means “code path completed,” not “economically meaningful result.” Existing history files already contain `successful_windows > 0` with `total_trades = 0` and empty `best_params`, which will pollute any research summary or future learning dataset.
- **Required outcome:** Introduce explicit status semantics for execution, no-signal/no-trade outcomes, and economic validity.
- **Files / modules:** `src/walk_forward/walk_forward_runner.py`, `src/walk_forward/validation/result_schema.py`, artifact/history writers in `walk_forward_runner.py`, related tests
- **Definition of done:**
  - Add separate fields such as `execution_success`, `economic_validity`, `status`, and `invalid_reason`.
  - Zero-trade / no-signal windows are not counted as positive evidence or promotion-ready windows.
  - Aggregates track separate counts for failures, no-signal windows, and economically valid windows.
  - Existing artifact writers and schema validators understand the new fields.
- **Dependencies:** Best done after Tasks 1-5 so status attaches to correct slices and metrics.

### 7) Strengthen artifact and schema semantics for future research / episode storage
- **Why it matters:** `result_schema.py` currently validates only a minimal field set. The saved artifacts do not fully encode the actual evaluated slices, annualization assumptions, gate outcomes, cost provenance, or learning eligibility.
- **Required outcome:** Saved WFA artifacts must be reliable research records that can later serve as episode data without guessing what happened.
- **Files / modules:** `src/walk_forward/walk_forward_runner.py`, `src/walk_forward/validation/result_schema.py`, any artifact/history schema helpers, fixture-based tests
- **Definition of done:**
  - Persist actual outer train/test dates used, plus nested-validation dates only if nested validation is explicitly enabled.
  - Record annualization factor, effective transaction-cost assumptions, gate pass/fail outcomes, and eligibility flags such as `eligible_for_aggregation` / `eligible_for_learning`.
  - Version the artifact schema and decide whether old history files are migrated or regenerated.
  - Add schema/fixture tests for the new artifact shape.
- **Dependencies:** Depends on Tasks 1, 2, 3, 5, and 6.

### 8) Replace raw “best Sharpe” promotion with gated selection criteria
- **Why it matters:** The active optimization path still boils down to direct Optuna maximization of a Sharpe-based score, with only a small low-trade penalty. That is too weak for a strategy-generation engine even after basic metric fixes.
- **Required outcome:** Promotion must use hard validity gates first, then rank surviving candidates with at least one robustness/stability component.
- **Files / modules:** `src/walk_forward/walk_forward_runner.py`, active optimization path under `src/walk_forward`, related configs/tests
- **Definition of done:**
  - Implement minimum gates for activity, finite metrics, drawdown, and economically valid windows.
  - Add at least one robustness/stability component after gates pass, preferably an explicit IS-vs-OOS degradation metric such as WFE if the existing helper is retained.
  - Artifacts show which gates passed/failed and why a candidate was promoted or rejected.
  - Add tests proving low-trade / invalid candidates can be rejected even with superficially high Sharpe.
- **Dependencies:** Depends on Tasks 2, 3, 6, and 7.

## Priority 2 - Cleanup / Architecture Debt

### 9) Audit advanced optimization modules and either integrate them or demote them from the default path
- **Why it matters:** The codebase contains stage-based optimization, multi-objective scoring, stability analysis, transaction-cost stress tooling, and WFA efficiency helpers, but the default runner still uses direct Optuna + `_evaluate_parameter_combination(...)`. Some modules are instantiated (`StageBasedOptimizer`, `ParameterShelfLifeTracker`) or configured, but not actually driving final selection.
- **Required outcome:** Make the default execution path honest and maintainable: either wire selected modules into real selection/promotion flow, or remove/demote misleading scaffolding from the default path.
- **Files / modules:** `src/walk_forward/stage_optimizer.py`, `src/walk_forward/multi_objective_optimizer.py`, `src/walk_forward/stability_analyzer.py`, `src/walk_forward/transaction_cost_modeler.py`, `src/walk_forward/cost_stress_tester.py`, `src/walk_forward/walk_forward_runner.py`
- **Definition of done:**
  - Document which advanced modules are active in the default path.
  - Remove dead imports / misleading initialization, or wire chosen modules into the real selection flow behind explicit config.
  - If integrated, add tests showing they materially affect final selection rather than existing as unused scaffolding.
- **Dependencies:** Do this after P0/P1 semantics are stable.

### 10) Repair the stale London Sweep session test
- **Why it matters:** `tests/test_london_sweep_session.py` imports `src.strategies.london_sweep_fade`, but the live strategy module is `src.strategies.london_sweep`. This will break targeted test runs and wastes time during verification.
- **Required outcome:** Align the test with the current London Sweep strategy module and parameter class, or remove the test if it no longer matches the live strategy.
- **Files / modules:** `tests/test_london_sweep_session.py`, `src/strategies/london_sweep.py`
- **Definition of done:**
  - The test imports the live module successfully.
  - Assertions reflect the current strategy/params API rather than a deleted implementation.
  - The test passes in isolation.
- **Dependencies:** Independent cleanup task.

## Execution notes
- Re-run the smallest relevant test scope after each task.
- Prefer targeted regression tests over broad refactors.
- Do not start RL/meta-learning work until Priority 0 and Priority 1 tasks are complete.

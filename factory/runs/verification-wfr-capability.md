# WFR Calculation Capability Verification

**Experiment ID:** EXP-20260404180000-01  
**Date:** 2026-04-04  
**Status:** VERIFICATION COMPLETE

## Objective
Verify if WFR (Walk-Forward Ratio) calculation is possible from existing window results by inspecting engine code and available data structures.

## Hypothesis
The WFA engine currently does not persist in-sample Sharpe from optimization phase to window results, making WFR calculation impossible without engine modification.

## Findings

### 1. WindowResult Dataclass (walk_forward_runner.py:126-186)

**Fields Available:**
- `window_id`, `training_period_start/end`, `testing_period_start/end`
- `best_parameters`, `optimization_trials`, `optimization_time_seconds`
- `final_balance`, `total_return_pct`, `total_trades`, `win_rate`, `profit_factor`
- `max_drawdown_pct`, `sharpe_ratio` (VALIDATION/OOS ONLY)
- `testing_time_seconds`, `success`, `error_message`
- Trade-level metrics: `gross_profit`, `gross_loss`, `win_count`, `loss_count`, `avg_trade_win_pct`, `avg_trade_loss_pct`

**KEY FINDING:** NO `optimization_sharpe` or `in_sample_sharpe` field exists in WindowResult. The `sharpe_ratio` field contains ONLY the out-of-sample (testing period) Sharpe.

### 2. WFAEfficiencyCalculator (wfa_efficiency.py)

**Capabilities:**
- `WindowPerformance` dataclass (line 29-41) includes `optimization_sharpe` field
- `add_window_performance()` method accepts both `optimization_results` and `validation_results` dicts
- Calculates comprehensive efficiency metrics including WFE (Walk Forward Efficiency)

**LIMITATION:** These calculations are performed internally but NOT persisted to output files. The efficiency calculator is instantiated in `WalkForwardRunner` but its results are never saved.

### 3. Execution Result Artifacts

All inspected `execution-result.json` files show:
```json
"metrics_observed": {
  "sharpe_is": null,
  "wfr": null,
  "is_oos_ratio": null
}
```

Window-level JSON results contain only validation period metrics - no in-sample Sharpe.

### 4. Prior Lesson Confirmed

From `factory/memory/lessons.jsonl` (RUN-20260331154310-1aowi1):
> "WFA engine does not output IS Sharpe, preventing WFR calculation - this affects all factory experiments, not specific to this run"

This is confirmed as accurate.

## Conclusion

| Aspect | Status |
|--------|--------|
| In-sample Sharpe persisted | ❌ NO |
| WFR calculable from output | ❌ NO |
| WFAEfficiencyCalculator capable | ✅ YES (but unused) |
| Engine modification required | ✅ YES |

## Recommendation

To enable WFR calculation, the engine requires modification:

1. **Add field to WindowResult** (walk_forward_runner.py:126):
   ```python
   optimization_sharpe: float = 0.0  # Sharpe from optimization phase
   ```

2. **Populate during window processing** (walk_forward_runner.py:755):
   - Capture Sharpe from Optuna best trial
   - Store in WindowResult before validation

3. **Optionally**: Persist WFAEfficiencyCalculator results to output JSON

## Verification Artifacts Created

- `factory/experiments/EXP-20260404180000-01.plan.json` (this plan)
- `factory/runs/verification-wfr-capability.md` (this document)

**Status Gate:** ✅ VERIFICATION COMPLETE - Findings documented

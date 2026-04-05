# Verification report

## Verified locally

1. `node scripts/validate-structure.mjs`
   - Result: passed
   - Meaning: required factory files and directories exist.

2. `node scripts/smoke-test.mjs`
   - Result: passed
   - Meaning:
     - simulate-mode planner/executor/evaluator/summarizer loop executed end-to-end
     - persistent state updated
     - evidence files were written
     - baseline Python WFA engine ran on included demo OHLCV data
     - `workspace/results/smoke_wfa/report.json` and `trades.csv` were generated

3. `npm test --silent`
   - Result: passed
   - Meaning: a temporary copied repo completed one simulate-mode cycle and produced state/evidence.

4. Manual reinspection after rebuild
   - Opened and rechecked key rebuilt files:
     - `opencode.json`
     - `src/core/orchestrator.mjs`
     - `src/core/runner-opencode.mjs`
     - `scripts/smoke-test.mjs`
     - `workspace/harness/wfa_engine.py`
     - `workspace/strategies/sma_cross.py`

## Not verified locally

1. Live OpenCode agent execution with real model/provider credentials
   - Not verified because no credentials were provided in this environment.

2. Real trading edge or real alpha generation
   - Not verified because only the included demo dataset was used locally.

3. Long-duration endless autonomous operation
   - The architecture supports it, but this environment only verified bounded runs.

## Interpretation

The deliverable is verified as a **working research-factory scaffold and WFA-first wrapper** with real local orchestration and a real local baseline WFA harness. It is **not** verified here as a profitable live trading system.

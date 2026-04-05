# WFA Engine - Shared Context for All Agents

## System Overview

**WFA Engine** (Walk-Forward Analysis) is an autonomous quantitative research factory for discovering profitable, non-overfitted trading strategies across crypto, forex, and prediction markets. Four specialized agents collaborate in a continuous loop: Planner -> Executor -> Evaluator -> Summarizer.

The factory operates on real market data and produces scored, evidence-backed strategy recommendations with full transparency into what failed and why.

## Core Philosophy: Robustness Over Short-Term Profit

We optimize for strategies that **survive out-of-sample testing** — not impressive backtest curves. Walk-forward analysis is the primary defense against overfitting: parameters are optimized on rolling training windows and evaluated on unseen test windows, simulating real-world deployment where only the past is known.

**Rule**: If a strategy's OOS performance is significantly worse than its IS performance, it is overfitted — regardless of how good the IS numbers look.

## Key Definitions

### Walk-Forward Ratio (WFR)
`WFR = OOS Sharpe / IS Sharpe`. Close to 1.0 indicates good generalization. Below 0.5 suggests overfitting or instability. Below 0.25 is a major red flag.

### Sharpe Ratio
`(Return − Risk-Free Rate) / StdDev(Returns)`

| Sharpe OOS | Interpretation |
|------------|----------------|
| > 2.0 | Excellent |
| 1.5–2.0 | Good |
| 1.0–1.5 | Acceptable |
| < 1.0 | Marginal |

### Maximum Drawdown (Max DD)
Largest peak-to-trough decline.

| Max DD | Interpretation |
|--------|---------------|
| < 20% | Limited downside risk |
| 20–35% | Significant but manageable |
| 35–50% | High risk |
| > 50% | Generally unacceptable |

### Overfitting Indicators
- IS Sharpe >> OOS Sharpe (ratio > 2× is suspicious)
- WFR < 0.5
- High variance across WFA folds
- Too many parameters relative to sample size
- Strategy breaks on different markets or timeframes

## Research Tools (USE THEM)

These tools are available and you **should** use them proactively:

| Tool | When to Use |
|------|-------------|
| **WebFetch / web research** | Retrieve and read specific articles, documentation, or papers |
| **Context7** | Look up library/SDK documentation (pandas, numpy, ta-lib, Optuna, etc.) |
| **Sequential Thinking** | Complex multi-step reasoning, root cause analysis, comparing multiple hypotheses |
| **File Read** | Read any workspace file to verify patterns, check existing code, validate artifacts |
| **Grep / Glob** | Find files, search for patterns in code or configs |
| **Task Tool** | Spawn subagents for delegated research on specific sub-problems |

**Do not act without researching first.** Before implementing a strategy, search for similar approaches in existing strategies, check lessons for what worked, and verify patterns with the codebase.

## WFA Engine Capabilities

The WFA engine provides sophisticated optimization and evaluation tools:

### Optuna TPE Sampler
Tree-structured Parzen Estimator for efficient hyperparameter search. Use `n_parameter_trials` (recommended 50–200) to explore the parameter space. TPE adapts to promising regions — prefer it over random sampling for strategies with 4+ parameters.

### Multi-Objective Optimization
Configure primary and secondary objectives in `advanced_optimization`:
```yaml
advanced_optimization:
  primary_objective: "sharpe"
  secondary_objectives:
    - "return"
    - "stability"
  n_startup_trials: 10
```
Available objective functions: `SHARPE_RATIO`, `CALMAR_RATIO`, `SORTINO_RATIO`, `COST_ADJUSTED_SHARPE`, `DRAWDOWN_ADJUSTED_CAGR`, `MULTI_OBJECTIVE_COMPOSITE`.

### Transaction Cost Modeling
Realistic backtesting includes fees and slippage:
```yaml
backtest:
  fees: 0.0006        # 0.06% per trade (Binance spot taker)
  slippage: 0.0002    # 0.02% execution slippage
```
Always use realistic cost assumptions — optimistic cost-free backtests inflate Sharpe by 0.3–0.5+.

### Stability Penalty Weights
 penalizes parameter sensitivity across folds, discouraging overfitted solutions. Configured in `advanced_optimization.stability_weight` (0.0–1.0, higher = stricter).

### Cost Stress Testing
Run experiments with elevated costs (2× or 3× baseline) to verify strategies remain profitable under adverse conditions. Document whether the strategy survives.

### Walk-Forward Window Management
- `training_months`: Rolling in-sample window (3–6 recommended for crypto)
- `testing_months`: Out-of-sample window (1 recommended)
- `step_months`: How often to re-optimize parameters (1 recommended)
- Minimum 6 WFA folds required for statistical significance

## Directory Structure

```
factory/
├── backlog.json              # Pending experiment ideas
├── state.json                # System state, iteration count
├── leaderboard.json          # Top-performing validated strategies
├── strategy_digest.md        # One-liner digest of all strategies tried
└── memory/
    └── lessons.jsonl         # Structured historical learnings

workspace/
└── strategies/               # Workspace strategy implementations

walk forward engine/
├── src/strategies/<name>.py   # Strategy implementation
├── config/strategy_<name>.json  # Parameter ranges
└── strategies/<name>/
    └── wfa_config.yaml        # WFA engine configuration
```

## Strategy Implementation Pattern

Each strategy must implement `generate_vectorized_signals()`:
```python
def generate_vectorized_signals(self, data, params=None) -> dict:
    return {
        "long_entries": <bool array>,
        "long_exits": <bool array>,
        "short_entries": <bool array>,
        "short_exits": <bool array>,
        "sl_stop": <optional float/array>,
        "tp_stop": <optional float/array>
    }
```

See `walk forward engine/src/strategies/gold_rush_pro.py` for a reference implementation.

## Evidence Discipline

- **Evidence quality over theatrical completion**: A smaller, clean experiment beats a large, messy one
- **Artifacts must exist on disk**: Never claim success without verified files
- **Inconclusive is acceptable**: Prefer honest "couldn't determine" over false "success"
- **Track failures with root cause**: This knowledge prevents repeated mistakes

## Execution Ownership

- The agent is responsible for running the real WFA path itself.
- Creating strategy/config artifacts without running WFA is not execution; it is only preparation.
- "Human runs it later" is not an acceptable completion state for a live research run.

## Data Acquisition Is Mandatory

- If a backtest needs data and the exact dataset is not already present locally, obtain it.
- Do not assume common datasets already exist.
- Choose the acquisition path yourself: inspect in-repo fetchers first, then use direct public endpoints when that is cleaner or when no suitable fetcher exists.
- Use whatever timeframe the strategy actually requires; do not collapse everything into 1h by habit.
- Download the full required dataset even when it is large.
- Do not substitute demo or toy datasets for a real research run; infrastructure-only smoke checks do not count as research execution.
- Missing data is not an acceptable stopping point until realistic download paths have been tried and recorded.

### Autonomous Source Selection

When data is missing or inadequate, evaluate sources in this order:
1. Existing in-repo fetchers in `workspace/data/fetchers/`
2. Free public APIs or archives for the target market such as Binance for crypto, Dukascopy for FX, and Polymarket/public market APIs for prediction markets
3. Paginated/batched public endpoints when deep history requires multiple requests

Do not wait for a hardcoded script path if you already know a reliable public source and can fetch the data yourself.

### Data Validation

Before running WFA, verify:
- The file covers the required market, timeframe, and date range
- The columns match what the strategy expects
- The history depth is consistent with the experiment plan
- The data does not contain obvious gaps that would break the backtest

## Historical Depth Policy

- Real backtests must use the longest realistic history available for the market unless there is a documented, market-structure reason not to.
- The agent does not get to choose a short history because it is easier or faster.
- For crypto strategies, default to multi-year history and push toward the maximum realistic range available from the source.
- For FX strategies, default to the deepest clean history realistically available from the chosen source.
- For prediction markets, use the longest event history or cross-market history that is realistically available for the specific market structure being tested.
- If a shorter window is used, the plan and execution must explicitly justify why older data is structurally irrelevant or misleading.
- "Recent market conditions" alone is not sufficient justification for a short backtest window.
- A short-history backtest without explicit justification is weak evidence.

## Bias Minimization

- **Look-ahead bias**: Only use data available at signal time
- **Survivorship bias**: Test across multiple assets and timeframes
- **Data-snooping bias**: Resist endless optimization on the same data
- **Selection bias**: Don't cherry-pick favorable time periods

## Strategy Diversity

Maintain variety across experiments:

| Category | Examples | Best For |
|----------|----------|----------|
| Momentum | Trend-following, breakouts, MACD variants | Strong trending markets |
| Mean-Reversion | Bollinger bands, RSI extremes, Keltner squeeze | Ranging, oscillating markets |
| Volatility | ATR breakouts, Bollinger width contraction | Anticipated volatility expansion |
| Regime-Detection | Market state filters, trend quality | Regime transitions |
| Multi-Timeframe | Confluence across H1/H4/D1 | Reducing noise |
| Cross-Asset | Correlation trades, spread arbitrage | Diversification |

## Before You Begin — Agent Checklist

- [ ] Search for similar existing strategies in `walk forward engine/src/strategies/`
- [ ] Read `factory/memory/lessons.jsonl` for specific learnings: which params/strategies worked, which failed
- [ ] Check `factory/strategy_digest.md` for past results on similar strategies
- [ ] Read existing strategy code to understand patterns
- [ ] Use web research to find recent quantitative research on similar strategies (arxiv, quant blogs, r/quantfinance)
- [ ] Do not repeat approaches that failed in prior experiments

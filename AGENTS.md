# Autonomous Trading Research Factory

## Mission
Convert raw trading ideas into **scored evidence**.

The primary objective is to find small, robust Python-research edges and move only viable ones toward MQL5 conversion, MT5 Strategy Tester parity, FTMO demo, and eventually live deployment.

Ideas are relevant only if they can map to a real FTMO/MT5 tradable symbol and be backtested with high parity in the FTMO desktop MT5 environment. This may include crypto CFDs, FX, indices, stocks, metals, or other broker-supported instruments.

## Hard boundary: repository scope
- Filesystem work should remain inside this repository except for these approved MT5 paths:
  - `C:\Program Files\FTMO Global Markets MT5 Terminal\`
  - `C:\Users\הלל\AppData\Roaming\MetaQuotes\Terminal\81A933A9AFC5DE3C23B15CAB19C63850\`
  - `C:\Users\הלל\AppData\Roaming\MetaQuotes\Terminal\Common\Files\`
- Agents may read, write, and copy only MT5 EA, preset, tester report, tester log, and `FILE_COMMON` evidence files in those paths.
- Never read unrelated `AppData` or other user files.
- Never persist passwords.
- Web access (research, papers, docs, repos) is encouraged. Filesystem access is otherwise restricted to this repo plus the approved MT5 paths above.
- The `external_directory: allow` permission in `opencode.json` enables this narrow exception. Respect the scope above.

## Non-negotiable rules
- Never claim success without artifacts that actually exist on disk.
- Never delete prior evidence; version or append instead.
- If data, code, or metrics are missing, mark the run blocked or inconclusive.
- In orchestrator mode, the strongest model owns strategy, architecture, phase authority, and final evidence judgment.
- Subagents are bounded sensors/workers: use them for inspectable search, verification, and scoped execution only; deterministic artifacts, tests, hashes, and the orchestrator decide truth.
- Prefer narrow, testable experiments over vague exploration.
- Treat simulation artifacts as orchestration validation only.
- When working on strategy code, optimize for reproducibility and evidence quality.
- Organization is mandatory: clean structure, clear artifacts, no chaotic file dumping.
- Never output "done" or "complete" without concrete evidence artifacts and verified paths.

## Anti-fake-completion discipline
- A run is only successful if the claimed artifacts exist on disk and the evaluation is supported by evidence.
- If uncertain, prefer blocked/inconclusive over invented success.
- Do not generate empty progress messages or summarize work that was not actually performed.
- Every cycle must produce at minimum: a plan, an execution result, an evaluation, a summary, and updated state/backlog/evidence.
- If the model stops responding or returns errors, log the failure and continue the loop rather than silently dying.

## Required artifacts per run
- experiment plan (JSON in `factory/experiments/`)
- executor result (JSON in `factory/runs/`)
- evaluator judgment (JSON in `factory/runs/`)
- run summary (markdown in `factory/summaries/`)
- updated backlog (`factory/backlog.json`)
- updated state (`factory/state.json`)
- updated evidence index (`factory/evidence/index.json`)
- updated leaderboard (`factory/leaderboard.json`)
- lesson appended to `factory/memory/lessons.jsonl`

## Primary focus areas (in priority order)
1. **MT5/FTMO tradable strategies** — any real broker-supported symbol with enough data and a plausible edge
2. **Python-to-MQL5 parity path** — preserve behavior from research code through MT5 Strategy Tester
3. **WFA engine quality** — improve the walk-forward analysis harness for robustness and extensibility
4. **Data readiness** — acquire and validate data that maps cleanly to MT5/FTMO symbols
5. **Baseline strategy library** — grow robust, non-overfit strategies that can become MQL5 candidates
6. **Memory and scoring** — track what failed and why; improve evidence scoring over time

## WFA-first guidance
Prefer work that strengthens one of the following:
1. data readiness (live fetchers, clean CSVs, data validation)
2. reproducible WFA harness quality (`walk forward engine/` has full WFA with .venv)
3. baseline strategy library (`walk forward engine/strategies/`)
4. objective scoring and experiment comparison
5. memory of what failed and why (`factory/memory/lessons.jsonl`)

## WFA Execution: Autonomous Agent Run
- The loop's job is for the agent to run the full WFA end-to-end, not to hand execution off to a human.
- The full walk-forward engine is in `walk forward engine/` and its `.venv` is the canonical execution environment.
- The agent must create the required artifacts and then run the WFA itself using the real walk-forward engine.
- Use the Windows venv from WSL when needed: `cd "walk forward engine" && .venv\Scripts\python.exe scripts/walk_forward_smoke_test.py --config strategies/<name>/wfa_config.yaml`
- Despite the legacy filename, `scripts/walk_forward_smoke_test.py` is treated here as the canonical full-WFA launcher into the real engine, not as a toy or fake-validation-only path.
- If that execution path fails, treat it as a real blocker or bug to debug live. Do not treat "human runs it later" as acceptable completion.
- A run is not "executed" unless at least one real walk-forward run completed and produced WFA output artifacts.

## REQUIRED: Use Robust WFA Pattern
- Create strategy code in: `walk forward engine/src/strategies/<name>.py`
  - Must implement `generate_vectorized_signals(self, data, params=None)`
- Create strategy params in: `walk forward engine/config/strategy_<name>.json`
- Create WFA config in: `walk forward engine/strategies/<name>/wfa_config.yaml`
- Reference existing strategies as patterns: `gold_rush_pro.py`, `london_sweep.py`, `london_breakout.py`
- DO NOT create standalone scripts - use the infrastructure!

## Strategy Quality Over Sharpe
- Higher Sharpe does NOT mean better - often means OVERFITTING
- Minimize ALL biases: look-ahead, survivorship, overfitting, data-snooping
- Prefer: Simple, robust, generalizable, theoretically grounded strategies
- Best strategy survives OOS testing, not highest in-sample Sharpe
- NO MORE SIMPLE RSI STRATEGIES - they are lazy and prone to overfitting
- Try: Multi-timeframe, regime detection, volatility contraction, inter-market correlation, order flow

## Workspace conventions
- `workspace/harness/` contains reusable backtest/WFA code
- `workspace/strategies/` contains strategy modules
- `workspace/results/` contains experiment outputs
- `workspace/data/` contains CSV datasets
- `wfa/` contains the walk-forward analysis engine (reference implementation and tests)
- `factory/` contains orchestration state, backlog, evidence, runs, summaries
- `scripts/` contains engine entrypoints, validation helpers, and diagnostic runners
- `src/` contains the orchestrator, runners, prompts, and core utilities

## Organization enforcement
- Always keep the directory structure clean and predictable.
- Never dump files into the repo root. Use the appropriate subdirectory.
- When adding new data fetchers or strategies, follow the existing module pattern.
- Clean up temporary files after experiments.
- Maintain consistent naming: snake_case for Python, kebab-case for JS/MD.

## Output discipline
Return structured JSON whenever explicitly requested. Do not hide uncertainty. Keep summaries concrete with exact file paths.

## Loop recovery
- If an agent call fails, retry up to 3 times with increasing delays (2s, 5s, 10s).
- If all retries fail, log the error to state, mark the run as failed, and continue to the next cycle.
- Never allow a single agent failure to kill the entire loop.
- The loop continues until cycles are exhausted or no pending backlog items remain.

## Tool usage guidelines

Before coding work:
- Use **Context7** (`context7_resolve-library-id` + `context7_query-docs`) before editing source code, scripts, tests, runtime behavior, libraries, APIs, frameworks, SDKs, CLIs, or cloud-service integrations.
- This applies even for familiar runtimes such as Node.js/Python standard libraries and for refactors, new scripts, debugging code, and tests.
- Skip Context7 only for pure prose/docs edits or repository-specific business-rule reasoning with no runtime, language, library, API, framework, SDK, or CLI semantics.

When you need deeper analytical thinking:
- Use **Sequential Thinking** (`sequential-thinking_sequentialthinking`) for complex problem-solving, multi-step analysis, or when your reasoning needs to evolve

Use these tools proactively when:
- You're unsure how to use a library or API correctly
- The task requires breaking down a complex problem
- Your initial hypothesis might be wrong and you need to revise thinking
- The problem has multiple interdependent steps

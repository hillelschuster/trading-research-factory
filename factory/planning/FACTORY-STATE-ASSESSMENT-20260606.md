# Factory State Assessment — 2026-06-06

**Purpose**: Non-executive planning document. No code changes. Synthesizes findings from 4 parallel subagent probes of the codebase/spec/runs/state.

---

## 1. Where We Actually Stand

### 1.1 Phase Completion Status (from spec `factory/mt5-ftmo-strategy-factory-spec.md`, 4186 lines)

| Phase | Status | Closed | Summary |
|---|---|---|---|
| 0–6 | `[x]` | Early 2026 | Foundation: evidence schema, MT5 env snapshot, `FILE_COMMON` proof, tester lifecycle, fixtures |
| 7A | `[x]` | 2026-05-13 | Deterministic WFA run worker (launches subprocess, captures stdout/stderr, validates artifacts, adversarial tests) |
| 7B | `[x]` | 2026-05-15 | Runtime SQLite ledger, data readiness, WFA manifest consumption, denominator tracking, advisory gates, DSR consumers |
| 7C | `[x]` | 2026-05-16 | Advisory PBO/CPCV/White consumers. No hard statistical promotion authority. Input-producer deferred. |
| 8A | `[x]` | 2026-05-19 | MT5 tradable universe + data alignment: 167 FTMO symbols, 6/6 H1 history available (EURUSD, US100.cash, XAUUSD, USOIL.cash, AAPL, BTCUSD). Repo data 7/7 `non_mt5_research_only`. |
| 8B | `[x]` | 2026-05-23 | Bounded ResearchBrain Stage-0: contracts, retrieval, runtime, tools, live canary with Claude Opus, source-backed OFI hypothesis. 55/55 + 63/63 tests passed. |
| 8C | `[x]` | 2026-05-27 | WFA engine + anti-overfit hardening: WFE/WFR truth, purge-gap guards, cost/survivor truth, source-quality gate. 10/14 met, 4 deferred (non-blocking). |
| 8D | `[x]` | 2026-05-30 | Hypothesis-led screening pipeline validation. 16/16 criteria met. **Zero survivors.** Explicitly valid closeout. |
| **8E** | **`[ ]`** | — | **MT5 Strategy Tester Parity. NOT STARTED. BLOCKED.** |
| 9 | `[ ]` | — | Forward/Demo Safety. Not started. |
| 10 | `[ ]` | — | Scale-Out governance. Not started. |

### 1.2 Phase 8E — Three Mandatory Preconditions (ALL UNSATISFIED)

From spec lines 3820–3830:

1. **Phase 8D survivor** worth serious validation → **NONE**
2. **Verified MT5 instrument equivalence** for the candidate → **NONE** (repo data is `non_mt5_research_only`)
3. **Explicit operator authorization** as disk-backed artifact naming candidate/family/symbol/account/tester/scope → **NONE** (chat/prompt/ResearchBrain text is explicitly NOT authorization)

**Phase 8E remains blocked.** Do not start.

---

## 2. Phase 8D Screening: The Full Picture

### 2.1 What Actually Happened

**19 total Phase 8D runs**, across 5+ asset classes, 10+ hypothesis families, 2 timeframes (M15, H1):

**12 screens that executed WFA and produced real metrics** (all denied by promotion gates):

| Screen | Asset | Hypothesis | Windows | Trades | Return% | OOS Sharpe | PF | PosWin% | Tier | Primary Failure |
|---|---|---|---|---|---|---|---|---|---|---|
| LONDON-BREAKOUT | EURUSD | London breakout | 87 | 842 | -0.096% | -0.47 | 0.84 | 29.9% | C4 | Return, consistency |
| GOLD-TREND | XAUUSD | Trend-following | 28 | 4393 | -2.807% | -2.68 | 0.70 | 10.7% | C4 | Return, consistency |
| GBPJPY-REVERSION #4 | GBPJPY | Liquidity vacuum reversion | 125 | 586 | -0.171% | -1.32 | 0.40 | 21.6% | C4 | Return, consistency |
| SURVIVOR-FLOOR #2 | (canary) | Gate validation | 3 | 23 | -1.940% | -1.49 | 0.56 | 66.7% | C2 | Return, windows, trades |
| BTC-BB-SQUEEZE-RUNTIME | BTC | BB-width squeeze breakout | 57 | 1101 | +0.091% | 0.07 | 1.01 | 45.6% | C3 | Return, consistency |
| VOL-ADAPTIVE-TREND | BTC | Vol-adaptive Supertrend | 57 | 220 | +1.309% | 0.95 | 1.55 | 40.4% | C3 | Return, consistency |
| OFI-EURUSD | EURUSD | Order-flow imbalance M15 | 87 | 2881 | -0.498% | -1.77 | 0.62 | 13.8% | C4 | Return, consistency |
| MONTH-END-REBALANCE | EURUSD | Month-end rebalancing | 87 | 1576 | -0.295% | -1.67 | 0.51 | 14.9% | C4 | Return, consistency |
| FX-FIX-REVERSAL | EURUSD | WMR benchmark fix | 87 | 3451 | -0.683% | -3.81 | 0.46 | 5.8% | C4 | Return, consistency |
| NFP-MACRO-EURUSD | EURUSD | NFP continuation/fade | 87 | 180 | -0.025% | -0.39 | 0.72 | 37.9% | C3 | Trades, return, consistency |
| ETH-BTC-RESIDUAL | ETH/BTC | Residual mean-reversion | 57 | 919 | -0.962% | -1.32 | 0.72 | 33.3% | C3 | Return, consistency |
| **BTC-WEEKLY-CALENDAR** | BTC | **Weekly day-of-week anomaly** | **57** | **12** | **-0.047%** | **-0.24** | **0.65** | **8.8%** | **C4** | **Trades, return, consistency** |

**7 screens that failed at infrastructure level** (timeout, 0-trade subprocess, non-zero exit) — counted in denominator but no metrics:
- 2 London Sweep GBPJPY attempts (non-zero exit)
- 3 GBPJPY Reversion attempts (non-zero exit, timeout)
- 1 BTC BB-Squeeze attempt (timeout at 30min, 150 trials)
- 1 Survivor Floor canary (blocked)

**2 gate canaries that blocked at start** (expected positive results):
- Preregistration gate: Missing preregistration artifact → blocked before WFA launch ✓
- Source-quality gate: Single low-signal Stage-0 source → `requires_more_research` → blocked ✓

### 2.2 The Gate Ladder Logic (Why Every Screen Failed)

**Hard Survivor Floors** (from `src/core/wfa-survivor-floors.mjs`):
- `minOosWindows`: 8
- `minTrades`: 200
- `minReturnPct`: 5%
- `minPositiveWindowRatio`: 0.70

**Consistency Tiered Routes**:
- **C1** (clean): ≥70% positive windows. No further diagnostics needed.
- **C2** (compensated): ≥50% positive, needs return≥5%, Sharpe≥0.35, PF≥1.15, windows≥15, concentration/drawdown controls
- **C3** (lumpy): ≥30% positive, needs return≥10%, Sharpe≥0.75, PF≥1.35, windows≥20, tighter concentration/drawdown
- **C4** (pathological): <30% positive. No pass route. Always denied.

**What happened**: 
- Zero screens cleared the 5% return floor. Best: VOL_ADAPTIVE_TREND at 1.31%.
- Zero screens cleared the 70% positive window ratio. Best: SURVIVOR-FLOOR canary at 66.7% (only 3 windows though).
- Most screens (8/12 with metrics) fell into C4 (<30% positive windows).
- 4 screens reached C3 but failed compensated return/Sharpe/PF requirements.
- **Verdict: The pipeline is working correctly.** It produces honest negative evidence and correctly denies promotion. This is not a system failure — it's the expected outcome of rigorous non-overfitting testing.

### 2.3 Key Insight: "Passed WFA Pipeline" ≠ "Passed Gates"

The WFA execution pipeline (worker spawns Python subprocess, captures artifacts, parses metrics) **worked correctly** across all 12 metric-producing screens. But the promotion gate properly rejected all of them because the strategies lack statistical edges.

This distinction is critical:
- **WFA pipeline**: Execution verification (subprocess exit 0, fresh outputs, parseable metrics, ≥1 window, ≥1 trade) → all passed
- **Promotion gates**: Edge verification (return≥5%, positive windows≥70%, OOS Sharpe>0, etc.) → **all failed**

### 2.4 Manual Roulette: MUST STOP

Per spec line 3722–3724 and the last Phase 8D summary (2026-06-02):

> "This was the last manual Phase 8D trial for now; do not continue manual roulette from this denial. Phase 8E remains blocked; next work should move toward planned factory phases / continuous ResearchBrain loop activation rather than forcing a survivor."

17 real screening attempts across diverse asset classes and hypotheses — zero survivors. Manual agent screens are constrained by stale training-data priors. Continuing to force-screen more manual hypotheses risks WFA roulette (data snooping through repeated trials on the same data universe).

---

## 3. ResearchBrain Stage-0: The Awkward Truth

### 3.1 Implementation Status

The entire ResearchBrain Stage-0 machinery is **implemented, tested, and ready**:
- `src/core/researchbrain-runtime.mjs` — provider execution model
- `src/core/researchbrain-agent.mjs` — tool-using agent loop
- `src/core/researchbrain-tools.mjs` — search/capture/memory tools
- `src/core/researchbrain-artifacts.mjs` — contract validators
- `src/core/memory-index.mjs` — retrieval indexing
- `src/core/retrieval.mjs` — packets/sources for Ideator/Planner
- `src/core/researchbrain-loop-runner.mjs` — continuous loop (claim→execute→outbox)
- `src/core/researchbrain-stage0-supervisor.mjs` — multi-cycle seed→loop→outbox→diagnostics
- `src/core/researchbrain-stage0-diagnostics.mjs` — state inspection
- `src/core/researchbrain-stage0-readiness.mjs` — full readiness with attention classification
- Adaptors: Anthropic Messages REST, OpenAI-compatible (DeepSeek/OpenCode), Brave Search API

Tests: ResearchBrain 55/55, Stage-0 supervisor 18/18, Stage-0 focused 47/47, `rtk npm run validate` passed.

### 3.2 What Has NOT Happened

**The pipeline has never actually been run through the ledger.** The situation:

| Component | Disk Artifacts | Ledger Records |
|---|---|---|
| Valid request artifacts | 3 (`factory/research/requests/`) | 0 seeded |
| Runtime runs on disk | 12 (1 dry-run + 11 live attempts) | 0 ledger runs |
| Ledger jobs | — | 0 |
| Ledger attempts | — | 0 |
| Outbox events | — | 0 (19 stale Phase 8D WFA events exist) |
| Projections | — | `factory/runtime/projections/researchbrain-stage0/` directory **does not exist** |
| Supervisor run/failure reports | — | 0 in `factory/verification/` |

The 3 valid request artifacts are:
1. `factory/research/requests/RESEARCHBRAIN-REQUEST-20260520T0718Z/request.json` — fixture/default
2. `factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-CANARY-20260523T124500Z/request.json` — live canary
3. `factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-OFI-CANARY-20260523T135000Z/request.json` — live OFI canary

The last live OFI canary (`RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z`) **did** produce valid Stage-0 artifacts (OFI amplification hypothesis, source record, digest, ideation manifest), but:
- It was a **single low-signal-trust source** → will be classified as `requires_more_research`, not WFA-ready
- It was never processed through the ledger pipeline

### 3.3 Readiness Status

Latest readiness check would report:
- **Status**: `attention`
- **Attention reasons**: `unseeded_valid_request_artifacts` (3 unseeded)
- **No other attention reasons** — cleanliness comes from the fact that nothing has ever been run
- **Runtime consistency**: `ok`
- **Terminal failure reconciliation**: `none`
- **Official mutation flags**: `false`

---

## 4. WFA Engine Status

### 4.1 Strategy Inventory

**Active (Phase 8D)**: `btc_weekly_calendar_phase8d.py`, `eth_btc_residual_phase8d.py`, plus `_phase8d_runtime` configs wrapping `bb_width_squeeze.py` and `vol_adaptive_trend.py`

**Legacy (non-Phase8D)**: ~22 strategies with WFA configs: `gold_rush_pro.py`, `london_sweep.py`, `london_breakout.py`, `ema_trend_gate.py`, `bb_width_squeeze.py`, `vol_adaptive_trend.py`, `order_flow_imbalance_eurusd.py`, `fx_fix_reversal_eurusd.py`, `month_end_rebalance_eurusd.py`, `nfp_macro_eurusd.py`, `gbpjpy_reversion.py`, `btc_residual_reversion.py`, `crypto_day_of_week.py`, `gold_trend_following_vectorized.py`, `eth_session_momentum.py`, `vol_adaptive_rsi_eth.py`, `volatility_regime.py`, `ny_pm_reversion.py`, `macd_divergence.py`, `mean_reversion_rsi.py`, `volume_profile.py`

### 4.2 Data Availability

| Asset | Timeframe | Coverage | Size | MT5 Equivalent? |
|---|---|---|---|---|
| EURUSD | M15 | 2003–2025 | 32.1M rows | **Yes** (Phase 8A verified) |
| GBPJPY | M15 | 2015–2025 | 12.2M rows | **Yes** (Phase 8A verified) |
| XAUUSD | M15 | 2018–2025 | 9.4M rows | **Yes** (Phase 8A verified) |
| BTC | M15 | 2020–2025 | 11.5M rows | **Proxy** (BTCUSD in FTMO universe) |
| BTC | H1 | ~2021–2026 | 43K bars | **Proxy** |
| ETH | H1 | ~2018–2026 | 64K bars | **No** (ETH not in FTMO universe directly) |
| SOL | H1 | ~2022–2026 | ? | **No** |
| BNB | H1 | ~2021–2026 | ? | **No** |
| XAUUSD | M1 | 2025 only | 17.4M rows | **Yes** but too short |

**Gaps**:
- **No equity/stock/index data**: US30.cash, US100.cash, AAPL all have zero repo data despite being in the 167-symbol FTMO universe
- No COT/positioning/fundamental data
- No tick-level or order-book data (order-flow strategies use synthetic tick imbalance from OHLCV)
- All current repo data is `non_mt5_research_only` — none has `mt5_instrument_equivalence` established

### 4.3 Known WFA Gaps (Deferred, Not Blocking)

- Multi-objective optimizer disconnected (single-objective Sharpe only)
- Cost-stress module disconnected (fee/slippage reported but not stressed)
- Statistical tests advisory-only (DSR/PBO/CPCV/White cannot enforce hard promotion)
- Parameter stability diagnostic-only (no promotion impact)
- Indicator warmup not applied to window boundaries
- Optimizer trial ledger not emitted by WFA engine
- No physical deletion of inactive modules (deferred until bypass appears)

### 4.4 Deterministic Worker: Proven

The worker (`src/workers/research-wfa-run-worker.mjs`) is fully operational:
- Spawns `walk forward engine/.venv/Scripts/python.exe scripts/walk_forward_smoke_test.py`
- Captures stdout/stderr, validates exit code, verifies fresh outputs
- Parses metrics, records trials, writes execution-result.json
- Adversarial coverage: fake provenance, missing outputs, hash mismatch, stale artifacts, zero windows/trades
- Tests: passed (61/61 Phase 7A, 177/177 full)

---

## 5. Factory State & Backlog Health

### 5.1 `factory/state.json`
- **Iteration**: 166
- **Last run**: `RUN-20260528185420-4ec6n9` (Phase 8D source-quality gate canary, 2026-05-28)
- **Status**: `idle`
- **Exit reason**: `cycles_exhausted`
- **Mode**: `simulate` (set 2026-05-28)
- **No active session/agent**

### 5.2 `factory/backlog.json`
- **2772 lines**, 77+ items
- **Overwhelmingly stale**: ~90% are legacy auto-generated ideas from March-April 2026 (`AUTO-*` IDs, `IDEA-*` follow-ups)
- **Status distribution**: Mostly `research_inconclusive` (scored 25), `infra_blocked`, or `ready` with stale WFA-only launch routes
- **Last 2 items**: Phase 8D gate canaries (blocked, validation complete)
- **Zero Phase 8D screening items remain in ready state** — all were executed
- **Several items have high evidence scores** (85) from previous deep-research runs but are not WFA-promoted:
  - `IDEA-138841-8h5` — BNB EMA Trend Gate fixed-parameter robustness (score 85, status `ready`)
  - EMA Trend Gate on SOL (score 85, `research_inconclusive`)
  - EMA Trend Gate on BTC (score 85, `research_inconclusive`)

### 5.3 `factory/evidence/index.json`
- 26 entries, all from March 2026
- Zero Phase 8D entries (by design — screening candidates didn't pass promotion gate)

### 5.4 `factory/leaderboard.json`
- **Empty `[]`** — zero survivors

### 5.5 `factory/runtime/factory.sqlite`
- Exists (656 KB), has tables
- 19 stale outbox events (Phase 8D WFA mirrors, never consumed)
- Zero ResearchBrain Stage-0 jobs/attempts/events/projections

---

## 6. What The Spec Says Should Happen Next

From spec lines 4165–4171, the immediate next work after Phase 8D, in priority order:

1. **Continuous ResearchBrain/factory-loop activation** — Convert bounded Phase 8B runtime from canary/manual into long-duration source-backed discovery loop that searches, captures sources, compares/disconfirms hypotheses, checks duplicate/failed-pattern memory, and emits Stage-0 packets for Ideator/Planner without mutating official evidence or claiming profitability.

2. **Data-readiness expansion** — Broaden terminal-backed history probes across the 167-symbol FTMO universe. Focus on symbols/timeframes with real MT5 history availability, explicit data relevance classification, and `mt5_instrument_equivalence` paths. Priority: stock CFDs (AAPL), index CFDs (US30.cash, US100.cash), energy (USOIL.cash), metals extension (XAGUSD).

3. **Runtime reliability and queue durability** — Improve durable queue/state/ledger behavior, retry/recovery, poison quarantine, circuit breakers, unattended execution for days/weeks of discovery cycles.

4. **ResearchBrain quality gates and retrieval/failure memory** — Strengthen source-quality scoring (currently accepts single low-signal sources as `requires_more_research`), duplicate/failure-pattern retrieval, rejection-memory use, hypothesis comparison before deterministic WFA launch.

5. **Optional WFA/data hardening** — Only when directly motivated by a concrete candidate or bypass showing current evidence path is insufficient.

Also from spec line 3723:
> "next work should move to sequential non-8E tasks: continuous ResearchBrain/factory-loop activation, broader data-readiness/instrument-history expansion, and runtime reliability/queue durability so source-backed discovery can run for long periods without manual survivor hunting"

---

## 7. Current Bottleneck Analysis

### Immediate operational gap: The ResearchBrain pipeline has never been operated end-to-end through the ledger

The Stage-0 architecture is built and tested, but:
- 3 valid request artifacts exist unseeded
- Zero jobs have been seeded into the ledger
- The supervisor has never been run in a real cycle
- No projections exist
- No outbox events have been processed for Stage-0

**This means the entire autonomous discovery loop—the thing that should replace manual Phase 8D roulette—is in a "built but never flown" state.**

### Strategic gap: Data does not connect to MT5

All current repo data is `non_mt5_research_only`. Even if a strategy survived Phase 8D gates, it could not satisfy Phase 8E's MT5 equivalence precondition because the data doesn't have verified equivalence to MT5 terminal symbols.

### Structural gap: Backlog bloat

The backlog contains ~77 items, mostly from March-April 2026 auto-generation runs. Most are stale, low-priority, inconclusive, or blocked. The backlog needs curation/de-duplication against the current Post-Phase-8D architecture, but this is secondary to getting the ResearchBrain pipeline operational.

---

## 8. Recommendations (Non-Executive, For Planning)

### Priority 1: Operate the ResearchBrain pipeline end-to-end once (lowest-risk, highest-signal)

Run a bounded real Stage-0 operational canary from one existing valid request artifact using `researchbrain:stage0-supervisor`, with report artifacts enabled. This would:
- Seed 1 request into the ledger (proving the seed→ledger path)
- Run 1-2 supervisor cycles (proving the loop→outbox→diagnostics path)
- Generate disk-backed supervisor JSON, projections, diagnostics, readiness reports
- Reveal any real blockers in the pipeline
- Leave no room for handwaving — either artifacts exist on disk or they don't

**This is not running research — it's operating the machinery that runs research.**

### Priority 2: Curate the backlog

The 77+ items include many auto-generated noise items from a different era. The backlog should be pruned to match the current architecture:
- Keep: WFA-ready items with explicit config/data routes
- Remove/archive: Stale `AUTO-*` items scored 25 that never reached WFA execution
- Keep: Phase 8D gate canaries (validation artifacts)
- Decisions: High-score items (85) from EMA Trend Gate family — should these be re-screened under Phase 8D gates with proper preregistration?

### Priority 3: Data-readiness expansion toward MT5 symbol equivalence

The 6 MT5-verified symbols from Phase 8A (EURUSD, US100.cash, XAUUSD, USOIL.cash, AAPL, BTCUSD) with H1/5000-bar history availability are the highest-priority targets for new data acquisition. Currently only EURUSD, XAUUSD, and BTCUSD have any repo data — all 3 indices/commodities/stocks have zero.

### Priority 4: ResearchBrain quality improvement

The current source-quality gate classifies single-source packets as `requires_more_research`. If the autonomous loop is to produce WFA-ready hypotheses, it needs genuinely multi-source, higher-quality synthesis. This requires:
- Improved retrieval/failure-memory so ResearchBrain can compare against prior failed hypotheses
- Stronger source-quality scoring (independent sources, source risk, source type diversity)
- Hypothesis comparison (not just generation)

---

## 9. What NOT To Do (Explicitly)

- ❌ Do not start Phase 8E (MT5/MQL5/parity/deployment)
- ❌ Do not continue manual Phase 8D strategy roulette
- ❌ Do not loosen survivor gates or force a survivor
- ❌ Do not let ResearchBrain mutate official state, evidence, backlog, leaderboard, or memory
- ❌ Do not let ResearchBrain gain WFA/MT5 execution or promotion authority
- ❌ Do not claim profitability or edge without disk-backed verified artifacts
- ❌ Do not create fake/scripted WFA outputs or handwave artifacts
- ❌ Do not run git status/diff/log (explicitly prohibited)
- ❌ Do not revert unrelated changes (explicitly prohibited)

---

## 10. Verification Snapshot

| Check | Result |
|---|---|
| Supervisor tests | 18/18 passed |
| Stage-0 focused tests | 47/47 passed |
| `rtk npm run validate` | Passed |
| Full `npm test` | Not run (not in scope for this assessment) |
| Projections directory | Does not exist |
| Supervisor artifacts in verification/ | None (0 of 74 files) |
| ResearchBrain ledger jobs | 0 |
| Phase 8D survivors | 0 (valid/normal) |
| Phase 8E started | No (correctly blocked) |

---

## 11. Key Files Referenced

| File | Purpose |
|---|---|
| `factory/mt5-ftmo-strategy-factory-spec.md` | Active source of truth (4186 lines) |
| `factory/state.json` | Current factory state (iteration 166, idle) |
| `factory/backlog.json` | 77+ items, mostly stale |
| `factory/evidence/index.json` | 26 legacy entries, 0 Phase 8D |
| `factory/leaderboard.json` | Empty |
| `factory/runtime/factory.sqlite` | Runtime ledger (656 KB, zero Stage-0 activity) |
| `factory/runs/RUN-PHASE8D-*/` | 19 Phase 8D screening runs |
| `factory/verification/phase8d-exit-readiness-*.json` | Phase 8D closeout (15/16 met) |
| `factory/verification/phase8d-ladder-calibration-*.json` | Gate calibration (168 dirs scanned) |
| `factory/research/requests/` | 3 valid unseeded request artifacts |
| `factory/research/runs/` | 12 ResearchBrain runtime runs (0 ledger-backed) |
| `src/core/wfa-survivor-floors.mjs` | Gate ladder logic |
| `src/workers/research-wfa-run-worker.mjs` | Deterministic WFA worker |
| `src/core/researchbrain-stage0-supervisor.mjs` | Multi-cycle supervisor |
| `src/core/researchbrain-loop-runner.mjs` | Continuous loop runner |
| `walk forward engine/` | Canonical WFA execution environment |

---

*Generated 2026-06-06. Non-executive. No code changes made. Based on 4 parallel subagent probes of the codebase.*

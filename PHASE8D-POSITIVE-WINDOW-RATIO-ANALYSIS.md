# Phase 8D `positive_oos_window_ratio >= 0.70` — Comprehensive Analysis & Revised Plan

**Date:** 2026-06-01
**Scope:** Analysis & planning only. No implementation. No evidence mutation.

---

## 1. Verdict

**The prior "Consistency-Ladder Composite Gate" plan is directionally correct — the 0.70 threshold should not be a universal hard gate, and a multi-dimensional approach is needed. But the plan's specific numeric thresholds (0.35 absolute floor, 5/7/10% return tiers, 1/1.25/1.50 PF tiers, 40/35/25% concentration caps) are unvalidated policy guesses. No external source supports any of these exact values. No repo evidence calibrates them.** The recommendation must be more conservative: start with advisory diagnostics, validate against existing and new evidence, calibrate thresholds empirically, and only then promote to hard gates. The 0.70 hard floor should remain active during this process, not be lowered preemptively.

---

## 2. Full Repo Findings

### 2.1 The 0.70 floor is deeply embedded

**File: `src/core/wfa-survivor-floors.mjs`** (6 lines, entire file) — single source of truth:

```js
export const PHASE8D_SURVIVOR_FLOORS = Object.freeze({
  minOosWindows: 8,
  minTrades: 200,
  minReturnPct: 5,
  minPositiveWindowRatio: 0.7
});
```

Every other module imports from this:

| File | Import | How Consumed |
|------|--------|-------------|
| `src/core/verification.mjs:55-58` | `PHASE8D_MIN_OOS_WINDOWS`, `PHASE8D_MIN_TRADES`, `PHASE8D_MIN_RETURN_PCT`, `PHASE8D_MIN_POSITIVE_WINDOW_RATIO` | **Hard gate** in `buildResearchWfaPromotionGate()` (lines 2328-2394) |
| `src/core/validators.mjs:33-36` | `PROMISING_MIN_WINDOWS`, `PROMISING_MIN_TRADES`, `PROMISING_MIN_RETURN_PCT`, `PROMISING_MIN_POSITIVE_WINDOW_RATIO` | **Hard gate** in `strategyQualityFailures()` (lines 123-158) |
| `src/core/phase8d-exit-readiness.mjs:6` | `PHASE8D_SURVIVOR_FLOORS` directly | Exit-readiness verification of floor enforcement via `clearsSurvivorFloors()` (lines 105-110) |
| `src/core/phase8c-exit-readiness.mjs:39,84,117,152` | References shared floor constants | Exit-readiness criteria verification |
| `src/core/prompt-builders.mjs:351,356` | String refs to "70% positive windows" | Evaluator guardrail text |

**Tests directly asserting the 0.70 threshold:**

From `tests/phase8c-survivor-floors.test.mjs`:
- Test 1 (lines 103-106): missing `positive_sharpe_windows_pct` → denied with `/missing positive OOS window ratio/`
- Test 3 (lines 118-145): `positive_sharpe_windows_pct: 0.69` → denied with `/positive OOS window ratio below Phase 8D floor/`
- Test 4 (lines 147-172): `positive_sharpe_windows_pct: 0.7` → `decision === "allowed"` with `/cleared Phase 8D minimum floor diagnostics/`

From `tests/phase8d-exit-readiness.test.mjs`:
- Test 5 (lines 228-233): `positive_oos_window_ratio: 0.5` → `below_floor_non_positive: true`, `positive_or_survivor_label_allowed: false`

### 2.2 What is currently hard-gated vs advisory

**Hard gates** in `buildResearchWfaPromotionGate()` (`verification.mjs:2352-2394`) — all must pass:

| # | Gate | Threshold | Can be Relaxed? |
|---|------|-----------|-----------------|
| 1 | OOS Sharpe | > 0 | No |
| 2 | Return proxy | ≥ 5% | No |
| 3 | Profit factor | ≥ 1.00 | No |
| 4 | Completed OOS windows | ≥ 8 | No |
| 5 | Total trades | ≥ 200 | Yes, via `low_frequency_registration_v1` |
| 6 | Positive OOS window ratio | ≥ 0.70 | **No** |

**Advisory only** in `buildResearchWfaGateReport()` (`verification.mjs:2074-2293`) — reported as flags, never blocks:

| Metric | How Used |
|--------|---------|
| WFE/WFR | Reported if computable; flagged if blocked/missing |
| Parameter stability | Flagged if instability detected |
| Cost stress | Flagged if missing assumptions |
| Optimization truth | Flagged if disconnected modules |
| DSR/PBO/CPCV/White | Advisory-computed or blocked-insufficient-inputs |
| OOS window consistency | Flagged as `mixed_oos_window_results` |
| **Max drawdown** | **Not reported at all in either gate** |
| **Return concentration** | **Not reported at all** |

### 2.3 Concentration logic does not exist anywhere

Search of all `src/core/` files for `concentration`, `top_window`, `single_window`, `return_share`, `return_concentration`, `Gini`, `Herfindahl`:

- **One match**: `src/core/low-frequency-registration.mjs:13` — a string literal `"concentration_risk_checks"` in `REQUIRED_EXTRA_CONTROLS`. This is a required field name for low-frequency registration artifacts. **It is a placeholder declaration, not an implementation.**

### 2.4 Per-window data is available for concentration computation

`summarizeOosWindowConsistency()` in `verification.mjs:452-465` already processes per-window returns and counts profitable/negative/flat windows. Per-window `total_return_pct` is available in `parsed-wfa-metrics.json`. Concentration metrics can be computed from existing data without changes to the Python WFA engine.

### 2.5 Recent Phase 8D evidence summary

All 5 executed Phase 8D screening runs:

| Run | Symbol | TF | Windows | Trades | Return% | +Ratio | OOS Sharpe | PF | Top2 Share | WFE | Binding Floor |
|-----|--------|----|---------|--------|---------|--------|------------|-----|------------|-----|---------------|
| London Breakout | EURUSD | M15 | 87 | 842 | -0.096% | 0.299 | -0.468 | 0.84 | -21% | -0.68 | Return, Sharpe, PF |
| Gold Trend | XAUUSD | M15 | 28 | 4393 | -2.807% | 0.107 | — | — | -3% | 0.28 | Return |
| GBPJPY Reversion | GBPJPY | M15 | 125 | 586 | -0.171% | 0.216 | -1.324 | 0.40 | -7% | 0.51 | Sharpe, PF, Return |
| BTC BB Squeeze | BTCUSD | H1 | 57 | 1101 | 0.091% | 0.456 | 0.075 | 1.01 | 373% | 0.007 | Return |
| **Vol Adaptive Trend** | BTCUSD | H1 | 57 | 220 | 1.309% | **0.404** | **0.954** | **1.55** | **48%** | 0.122 | **Return** |

**Critical observation**: The 0.70 ratio was never the binding constraint. Every candidate also failed the 5% return floor. The Vol Adaptive Trend is the most interesting case — it has strong OOS Sharpe (0.954) and PF (1.55) but only 1.31% return and 40.4% positive windows. If return were 7%, it would STILL fail on ratio — potentially a false negative for a strategy with strong aggregate evidence.

**The ratio has never been the sole reason for rejection in the entire Phase 8D history.** This means we have zero counterfactuals to calibrate any change against.

---

## 3. Web/Research Findings

### 3.1 Walk-forward analysis

- **Wikipedia "Walk forward optimization"**: Confirms Pardo (1992, 2008) introduced WFA. The article states: "The trading strategy is considered to be robust if it produces a positive performance summary" — from the compilation of all OOS windows. **No specific positive-window ratio threshold is mentioned.** The evaluation framework centers on aggregate OOS performance.
- **Pardo's "The Evaluation and Optimization of Trading Strategies" (2nd ed., 2008)**: Discusses Walk-Forward Efficiency (WFE = annualized OOS return / annualized IS return) as a primary metric. Does not prescribe a specific positive-window ratio. WFE > 50% is discussed as "healthy" but not as a universal hard gate.
- **Tomasini & Jaekle "Trading Systems"**: Emphasize profit factor, drawdown, and parameter stability. No specific positive-window ratio mentioned.
- **Multiple search attempts** (Investopedia, QuantStart, SSRN, ResearchGate, practitioner blogs) were blocked by paywalls or login requirements. No freely accessible source was found that recommends a specific positive OOS window ratio threshold.

### 3.2 Deflated Sharpe Ratio (Bailey & López de Prado, 2014)

- **Wikipedia "Deflated Sharpe ratio"**: The DSR corrects Sharpe ratios for selection bias, backtest overfitting, and non-normality. The False Strategy Theorem proves that "the expected maximum Sharpe ratio from N unskilled strategies grows with N" — you need more statistical evidence as you test more strategies.
- **Key insight**: The DSR framework evaluates strategies by their aggregate Sharpe adjusted for the trial denominator, NOT by per-window binary sign consistency. This aligns with the repo's existing denominator tracking but suggests that Sharpe (already hard-gated at >0) is the primary anti-overfitting metric.
- **The trial count (denominator) matters**: With more trials, higher Sharpe is needed to overcome the multiple-testing problem. The positive window ratio is a consistency supplement, not a replacement for Sharpe-based testing.

### 3.3 What I definitively could NOT find

After thorough searching:
- No academic or practitioner source recommends ANY specific positive-window ratio threshold (0.70, 0.60, 0.50, 0.35, or any other value).
- No source uses positive-window ratio as a primary WFA gate.
- No source prescribes return concentration across OOS windows as a standard metric.
- No consensus exists on whether low-win-rate trend-following strategies should be filtered by window-level consistency.

**The 0.70 value appears to have no external precedent.** It is a reasonable heuristic created for this repo, not a literature-backed standard.

### 3.4 What IS supported by the literature

- WFA is the "gold standard" for strategy validation (Pardo, Wikipedia consensus).
- Aggregate OOS performance metrics (return, Sharpe, PF) are the primary evaluation tools.
- The trial denominator matters (DSR/FST framework).
- Overfitting is detected by IS/OOS divergence, not by per-window sign consistency alone.
- Drawdown, profit factor stability, and parameter stability are valued in practitioner frameworks.

---

## 4. Assessment of Prior Ladder Plan

### What should be KEPT

1. **Tiered consistency classification (C1/C2/C3/C4).** Lumping all strategies into a single binary pass/fail at 0.70 is the root problem.
2. **Return concentration as a new diagnostic (currently missing).** The BB Squeeze's 373% top-2 share is a genuine problem not caught by any existing gate.
3. **Incremental rollout (advisory first, hard gates later).** Essential — no threshold can be set without empirical calibration.
4. **0.70 retained as a meaningful high-consistency signal.**

### What should be MODIFIED

1. **Absolute floor of 0.35 is uncalibrated.** Below 1-in-3 positive OOS windows is a reasonable absolute minimum, but 0.35 specifically is a guess. Should be calibrated against historical evidence.
2. **5/7/10% return tiers are guesses.** C3 at 10% is triple the current return floor. A trend-following strategy winning 45% of windows with +8% net return and 1.5 PF is more robust than a mean-reversion strategy winning 72% of windows with +5.1% return and 1.02 PF. Tiers should reward strong aggregate evidence from low-consistency candidates, not doubly penalize them.
3. **PF tiers (1/1.25/1.50) are directionally reasonable but unvalidated.**
4. **Concentration formula (`max positive window / sum positive windows`) is fragile.** Works for some patterns (BB Squeeze) but is unstable when there are very few positive windows.

### What should be REJECTED or DEFERRED

1. **Hard concentration gates before validation.** The formula must be tested against ALL historical evidence before it can block promotion.
2. **Making drawdown a hard gate without position-sizing context.** Max drawdown is a function of position sizing, not just strategy quality.
3. **"Universal Hard Gates" framing.** At this stage, everything new should be "advisory diagnostics" or "calibration targets."

---

## 5. Revised Spec-Ready Proposal

### Proposed Section Title

```
### 11.16D — Phase 8D Composite Survivor Gate: Advisory Diagnostics → Calibration → Gate Policy
```

### Proposed Spec Wording

> **Status: Proposed — active current policy (0.70 hard floor) remains unchanged until calibration is complete.**
>
> **Active current policy (unchanged):**
> - `positive_oos_window_ratio >= 0.70` is a hard survivor floor.
> - Candidates below 0.70 may not receive `promising`/`passed`/`success` labels.
> - This gate remains the single source of truth until this proposed policy is validated and promoted.
>
> **Proposed future policy (calibration required before activation):**
>
> The uniform 0.70 threshold is a single-number proxy for a multi-dimensional problem: return consistency, return concentration, drawdown risk, IS/OOS divergence, and edge generalizability. The factory should move toward a composite gate that:
> 1. Classifies candidates by positive OOS window consistency into advisory tiers.
> 2. Reports concentration, drawdown, WFE, and parameter-stability diagnostics alongside tier classification.
> 3. Does not lower the hard floor until empirical calibration validates the new thresholds.
>
> **Advisory Consistency Tiers (reporting-only, NOT gates):**
>
> | Tier | Ratio Range | Advisory Label | Implication |
> |------|-------------|----------------|-------------|
> | C1 | ≥ 0.70 | `clean_consistency` | High per-window consistency. Strong standalone signal. |
> | C2 | 0.50 – 0.69 | `moderate_consistency` | Majority of windows positive. Acceptable for most strategy families. |
> | C3 | 0.30 – 0.49 | `lumpy_payoff` | Minority of windows positive. Strong aggregate evidence (return, PF, Sharpe, concentration, drawdown, WFE, parameter stability) is required before this tier could be considered survivable. May indicate convex/asymmetric payoff profiles (trend-following, breakout, volatility expansion). |
> | C4 | < 0.30 | `pathologically_concentrated` | Hard reject. Below 30% positive windows, no plausible edge can generalize. |
>
> **Advisory Diagnostic Additions (reporting-only, no gate behavior change):**
>
> - **Return concentration:** Compute `max_single_window_share` (largest positive window's return / sum of all positive window returns) and `top_two_window_share`. Report in the advisory gate report. Flag `high_return_concentration` when single-window share exceeds a calibration target (TBD after Stage 2 validation).
> - **Drawdown-to-return ratio:** Compute `max_drawdown_pct / aggregate_return_pct` and report. Flag `high_drawdown_relative_to_return` when ratio exceeds a calibration target (TBD).
> - **Consistency tier label:** Append to every candidate evidence packet and gate report.
> - **Low-window-count warning:** When `completed_windows < 15` and `ratio < 0.65`, flag `low_window_count_low_consistency` because the binomial confidence interval is wide.
>
> **Calibration Targets (NOT hard gates — thresholds TBD after validation):**
>
> - **Tier-specific return floors:** C1 ≥ 5% (unchanged), C2 ≥ stricter TBD, C3 ≥ meaningfully stricter TBD.
> - **Tier-specific PF floors:** C1 ≥ 1.00 (unchanged), C2 ≥ TBD, C3 ≥ TBD.
> - **Concentration thresholds:** Single-window share limits TBD.
> - All calibration targets must be validated against the full denominator of Phase 8D evidence before any can become hard gates.
>
> **C4 (absolute floor):** `positive_oos_window_ratio < 0.30` is proposed as the future universal hard reject. Below this threshold, a strategy wins fewer than 1 in 3 OOS windows — no conceivable edge survives this under walk-forward conditions. This is a POLICY recommendation, not an empirically calibrated value. The current 0.70 floor remains active until this is validated.
>
> **What the loop must understand:**
> - The 0.70 gate remains the active survivor floor.
> - New consistency tiers and concentration/drawdown diagnostics are advisory observations.
> - The existence of C3 (lumpy payoff) candidates is documented but not yet survivable.
> - Evaluators must cite tier labels and advisory diagnostics when judging candidates.
> - No gate behavior changes until Stage 3 (gate promotion) is authorized.
>
> **Interaction with existing gates (unchanged):**
> - OOS Sharpe ≤ 0 → hard block.
> - PF < 1.00 → hard block.
> - Windows < 8 → hard block.
> - Trades < 200 (or valid low-frequency exception) → hard block.
> - DSR/PBO/CPCV/White remain advisory-only.
> - Low-frequency registration relaxes trade-count floor only.

---

## 6. Safer Diagnostic Design

### 6.1 Concentration Formula

Rather than `max_positive_window / sum_positive_windows` alone (fragile with few positive windows), use TWO complementary metrics:

1. **Single-window dominance**: `max(window_return) / sum(all_positive_window_returns)`. If total positive return is ≤ 0, concentration is undefined (block on return/PF instead).
2. **Herfindahl-like index over positive returns**: `sum((w_i / total_positive)²)` where `w_i` is each positive window's return. Near 1.0 = one window dominates. Near 0 = returns evenly distributed.

Both advisory until validated.

### 6.2 Drawdown Diagnostics

- **Strategy-level max drawdown**: available in `parsed-wfa-metrics.json` as `max_drawdown`.
- **Per-window max drawdown**: available in `max_drawdown_pct` per window.
- **Drawdown-to-return ratio**: `max_drawdown / aggregate_return_pct`. Flag when ratio exceeds calibration target.
- **Intra-window risk**: flag when any per-window drawdown exceeds 3× that window's return.

All advisory until calibration.

### 6.3 Window-Count Sensitivity

The advisory tier label should include a suffix when window count is low:
- "C2 (8w)" = moderate consistency, 8 windows → low confidence
- "C2 (57w)" = moderate consistency, 57 windows → moderate confidence
- "C1 (125w)" = clean consistency, 125 windows → high confidence

This avoids hard thresholds while informing evaluator judgment.

---

## 7. Incremental Rollout Plan

### Stage 1: Advisory Diagnostics (No Gate Changes)

**Precondition**: Planning approval. Zero gate behavior changes.

1. Add `PHASE8D_CONSISTENCY_TIERS` constant to `src/core/wfa-survivor-floors.mjs` (reporting-only, not used by any gate).
2. In `buildResearchWfaGateReport()` (`verification.mjs` ~2074): compute and report consistency tier, concentration (both formulas), drawdown-to-return ratio, low-window-count warning.
3. In `phase8d-candidate-evidence-packet` schema: add optional `consistency_ladder_advisory` block with status `advisory_reporting_only_not_a_hard_gate`.
4. Update `src/core/prompt-builders.mjs`: evaluator receives tier labels and advisory diagnostics.
5. Run all existing tests — verify no regressions. Advisory-only fields should not change any gate behavior.
6. Write focused tests for new advisory computations.

### Stage 2: Calibration Against Historical Evidence

**Precondition**: Stage 1 complete, advisory diagnostics emitting in new screening runs.

1. Build `scripts/phase8d-ladder-diagnostics.mjs` that reads ALL existing `parsed-wfa-metrics.json` files (Phase 8D and pre-Phase 8D runs).
2. For every historical run, compute: tier classification, both concentration metrics, drawdown-to-return, WFE.
3. Produce a calibration report answering:
   - Distribution of positive window ratios across all historical runs.
   - Distribution of single-window concentration.
   - What would happen to every historical candidate under C4 (0.30) floor? Under 0.35? Under 0.40?
   - Which historical runs would pass all proposed tier floors and which would be blocked?
   - Is there any historical run that would become a false positive?
4. Publish calibration report as `factory/verification/phase8d-ladder-calibration-<timestamp>.json`.
5. Use calibration results to set tier-specific return, PF, and concentration thresholds — or conclude insufficient data exists.

### Stage 3: Gate Promotion

**Precondition**: Stage 2 calibration report exists, thresholds empirically grounded. Operator authorization.

1. Replace 0.70 hard floor with C4 (absolute floor, minimum 0.30) as universal hard gate.
2. Add tier-specific return and PF floors as hard gates at calibrated values.
3. Add concentration hard gate at calibrated threshold.
4. Update `buildResearchWfaPromotionGate()` to use tiered logic.
5. Update all tests.
6. Update spec to mark new policy as active.

---

## 8. Future Implementation Areas (File-Level)

| File | Stage | What Changes |
|------|-------|-------------|
| `src/core/wfa-survivor-floors.mjs` | 1–3 | New `PHASE8D_CONSISTENCY_TIERS` export; `minPositiveWindowRatio` lowered to absolute floor (≥0.30) at Stage 3 |
| `src/core/verification.mjs` (~2352) | 3 | `buildResearchWfaPromotionGate()` → tiered logic with tier-specific return/PF/Sharpe/concentration floors |
| `src/core/verification.mjs` (~2074) | 1 | `buildResearchWfaGateReport()` → new advisory fields: consistency_tier, single_window_concentration, top_two_concentration, drawdown_to_return, low_window_count_warning |
| `src/core/verification.mjs` (~452) | 1 | `summarizeOosWindowConsistency()` → extended with concentration computation |
| `src/core/validators.mjs` (~123) | 2–3 | `strategyQualityFailures()` → tier awareness and concentration diagnostics |
| `src/core/phase8d-exit-readiness.mjs` | 1–3 | `clearsSurvivorFloors()` → updated constant verification for tiered thresholds at Stage 3; new criterion `consistency_ladder_active` |
| `src/core/prompt-builders.mjs` (~351) | 1 | Evaluator guardrail text → tier-aware, 0.70 described as C1/C2 boundary not sole blocker |
| `factory/mt5-ftmo-strategy-factory-spec.md` | 1–3 | New section 11.16D; old 0.70 references marked as superseded at Stage 3 |
| `tests/phase8c-survivor-floors.test.mjs` | 3 | Updated tier threshold assertions |
| `tests/phase8d-exit-readiness.test.mjs` | 3 | Below-floor test fixture adapts to new floors |
| `tests/phase8d-consistency-ladder.test.mjs` | 1 | **New file** — focused tests for tier classification, concentration computation, advisory reporting |
| `scripts/phase8d-ladder-diagnostics.mjs` | 2 | **New file** — calibration diagnostic script |

---

## 9. Open Questions / Required Calibration Data

1. **C4 absolute floor (0.30):** What is the lowest positive window ratio observed in ANY historical WFA run? **Needed**: full census of positive window ratios across all `parsed-wfa-metrics.json`.
2. **Concentration distribution:** What is the median and 95th percentile of single-window concentration across all historical runs? **Needed**: concentration census.
3. **Tier-specific return floors:** The current 5% floor has never been met by any Phase 8D candidate. How can we calibrate C3 at 10% when C1 at 5% has never been reached? **Needed**: a Phase 8D survivor or wider evidence base.
4. **Drawdown-to-return ratio:** What relationships exist between drawdown and return in the repo's evidence? **Needed**: drawdown census.
5. **WFE interaction with ratio:** Are there cases where WFE > 0.50 AND ratio > 0.30 AND return > 5%? **Needed**: WFE census.
6. **FTMO tradability vs positive window ratio:** For FTMO 1-Step (10% profit target, 5% max daily loss, 10% max total loss), a strategy with 40% positive months and -8% drawdown per negative month could breach FTMO risk limits even if annually profitable. **Should the gate incorporate FTMO-rule-aware drawdown constraints?**
7. **Should `positive_oos_sharpe_window_ratio` replace `positive_oos_return_window_ratio`?** Per-window Sharpe is already emitted by the WFA engine. A window with +0.01% return is "positive" identically to +5%. Using Sharpe positivity would be a better risk-adjusted consistency signal.
8. **No counterfactual exists:** Zero Phase 8D candidates have passed all other floors while failing only the ratio. We cannot observe how any change would behave against a real edge until we find one.

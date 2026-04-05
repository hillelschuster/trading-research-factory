# Live Readiness Closeout Spec

Status: historical closed subordinate checklist; non-certifying; not an active architecture spec
Owner: orchestrator / operator implementation pass
Parent spec: `factory/long-term-loop-architecture-spec.md`

## Historical Notice

This document is retained as a historical planning artifact.

It does not certify the current loop as live-ready.
The active implementation target is `factory/bulletproof-endless-live-finalization-spec.md`, and any future readiness claim must be backed by fresh machine-written verification artifacts under `factory/verification/`.
Those artifacts now include machine-written verification manifests, rollout gates, transport bakeoff reports, state-migration reports, and fault-drill reports.

## 1. Purpose

This document captures the remaining required implementation work that was used to close the gap before the loop is treated as live-ready.

It does not replace `factory/long-term-loop-architecture-spec.md`.
It is not a second active architecture spec.
It narrows the remaining scope to explicit unresolved items already required by the parent spec.

This spec exists to finish the loop cleanly without adding bloat.

## 2. Strict Scope Rule

Only implement work that is explicitly required by the parent spec and still missing.

Do not add:
- new strategy research work
- new data fetchers
- WFA-engine feature expansion unrelated to closeout
- embeddings, vector DBs, RL, knowledge graphs, Obsidian runtime integration
- a second prompt system
- a second execution truth path
- hidden deterministic narrowing to BTC, ETH, SOL, or fixed timeframes

If a proposed task does not directly close a parent-spec gap, do not add it here.

## 3. Current Remaining Gaps

The following items are still missing or only partially realized relative to the parent spec:

1. `factory/market-policy.json` does not exist.
2. Planner, evaluator, and summarizer stage gates are not yet machine-enforced.
3. Selection policy is still too implicit; backlog prioritization/exploration behavior is not yet explicitly policy-driven.
4. Official persisted artifacts are stale relative to the new code paths:
   - `factory/leaderboard.json` still contains simulate and inconclusive pollution.
   - `factory/evidence/index.json` still contains stale legacy promotable semantics.
   - `factory/backlog.json` still contains legacy statuses on disk.
5. Memory normalization has a real schema bug: nested `extra_metrics` growth on repeated rebuilds.
6. Retrieval ranking does not yet fully use the required explicit scoring factors.
7. Required health metrics are not tracked yet.
8. Duplicate inactive doctrine files still remain in active prompt directories.

## 4. Design Constraints

All closeout work must preserve the parent architecture principles:

- keep prompts lean
- keep state continuity on disk, not in chat residue
- keep the loop non-deterministic at the idea/market selection level
- make steering explicit in policy/state/evidence, never hidden in prompt heuristics
- keep simulate clearly non-evidentiary
- keep the real WFA path as the only live evidence path
- prefer derivation/rebuild over incremental corruption

## 5. Required Workstreams

Complete the work in the order below.

---

## Workstream A - Explicit Market Policy File

Parent spec mapping:
- `factory/long-term-loop-architecture-spec.md:484`
- `factory/long-term-loop-architecture-spec.md:730`
- `factory/long-term-loop-architecture-spec.md:765`
- `factory/long-term-loop-architecture-spec.md:898`

### Objective

Create one visible, operator-controlled policy file that defines market/source/history defaults without hardcoding fixed assets.

### Required deliverable

Create:
- `factory/market-policy.json`

### Required contents

The file must include, at minimum:
- `schema_version`
- `updated_at`
- `market_family_priorities`
- `allowed_source_families`
- `default_history_rules_by_market_family`
- `exclusions`
- optional `notes`

### Hard rules

The file must not:
- encode hidden fixed-asset defaults
- hardcode BTC/ETH/SOL as default choices
- hardcode a universal default timeframe
- duplicate long prose doctrine already covered by the parent spec

### Exact implementation tasks

1. Add a path for `factory/market-policy.json` in `src/core/paths.mjs`.
2. Initialize the file in `src/core/init.mjs` if missing.
3. Seed the file with explicit market-family policy only, not fixed instrument defaults.
4. Make `getFactoryStats()` or equivalent orchestration context load the policy file.
5. Pass the policy into ideator/planner retrieval or prompt inputs in a compact serializer-only form.
6. Keep the policy visible and operator-editable; do not hide a second copy in prompts or constants.

### Minimum seeded policy shape

Use a structure similar to:

```json
{
  "schema_version": "market_policy_v1",
  "updated_at": "<ISO timestamp>",
  "market_family_priorities": [
    { "market_family": "crypto", "priority": 1 },
    { "market_family": "prediction_markets", "priority": 2 },
    { "market_family": "forex", "priority": 3 }
  ],
  "allowed_source_families": {
    "crypto": ["binance", "public_archive"],
    "prediction_markets": ["polymarket_public"],
    "forex": ["dukascopy"]
  },
  "default_history_rules_by_market_family": {
    "crypto": {
      "expectation": "multi-year when realistically available",
      "short_window_requires_explicit_justification": true
    },
    "prediction_markets": {
      "expectation": "as much event-history as realistically available",
      "short_window_requires_explicit_justification": true
    },
    "forex": {
      "expectation": "longest clean liquid-history realistically available",
      "short_window_requires_explicit_justification": true
    }
  },
  "exclusions": [],
  "notes": []
}
```

### Acceptance criteria

- `factory/market-policy.json` exists.
- It is loaded by runtime code.
- It is referenced by ideator/planner logic.
- No fixed-asset or fixed-timeframe hidden defaults are introduced.

### Verification

- import/runtime tests cover initialization and loading
- prompt rendering check confirms compact policy inclusion

---

## Workstream B - Explicit Selection Policy And Backlog Replenishment

Parent spec mapping:
- `factory/long-term-loop-architecture-spec.md:522`
- `factory/long-term-loop-architecture-spec.md:524`
- `factory/long-term-loop-architecture-spec.md:535`
- `factory/long-term-loop-architecture-spec.md:547`
- `factory/long-term-loop-architecture-spec.md:556`

### Objective

Replace the current mostly implicit selection behavior with explicit, inspectable rules for explore/revisit/deprioritize decisions.

### Current problem

Today the loop primarily:
- picks next backlog item by priority sort
- ideates only when backlog is empty

This is too implicit relative to the parent spec.

### Required implementation tasks

1. Add explicit selection-policy fields to the market-policy file or a compact adjacent section in the same file.
2. Define a backlog-replenishment threshold, e.g. `min_ready_backlog_depth`, instead of ideating only at zero.
3. Replace `BacklogStore.pickNext()` simple priority sort with policy-aware ranking inputs:
   - comparable evidence quality
   - OOS robustness/generalization
   - trade count adequacy
   - cost resilience when known
   - novelty vs recent failures
   - repeated blocker penalties
4. Make revisit decisions explicit for promising-but-not-yet-promoted families.
5. Make deprioritization explicit for structurally weak or repeatedly blocked families.
6. Ensure exploration is preserved: the loop must not collapse into only one family because it once scored well.

### Hard rules

Do not solve this with hidden prompt text.
The exploration/exploitation tradeoff must be visible in code, state, backlog policy, or evidence-derived scoring.

### Files likely to change

- `factory/market-policy.json`
- `src/core/backlog-store.mjs`
- `src/core/orchestrator.mjs`
- possibly `src/core/retrieval.mjs` if retrieval exposes comparison signals for selection

### Acceptance criteria

- ideation happens when backlog depth is below policy threshold, not only when empty
- selection behavior is traceable to explicit policy/scoring inputs
- revisit/deprioritize behavior is evidence-aware, not heuristic-only
- no hidden asset narrowing is introduced

### Verification

- unit tests for backlog-depth-triggered ideation
- unit tests for selection ranking inputs
- simulated runs showing backlog replenishment before total starvation

---

## Workstream C - Planner / Evaluator / Summarizer Stage Gates

Parent spec mapping:
- `factory/long-term-loop-architecture-spec.md:453`
- `factory/long-term-loop-architecture-spec.md:507`
- `factory/long-term-loop-architecture-spec.md:298`
- `factory/long-term-loop-architecture-spec.md:309`
- `factory/long-term-loop-architecture-spec.md:953`

### Objective

Bring all stages up to the same explicit gate discipline already applied to executor success.

### Current problem

Executor has machine-enforced validation.
Planner, evaluator, and summarizer do not yet have equivalent gate enforcement.

### Required implementation tasks

#### C1. Planner schema enforcement

The planner output must be machine-checked for these explicit fields:
- chosen market family
- chosen instrument or instrument-selection rule
- chosen timeframe
- required historical depth
- source plan
- why this scope is selected now
- exact expected artifacts
- exact success criteria

Tasks:
1. Define a planner validation function in `src/core/orchestrator.mjs` or a dedicated validator module.
2. Reject plans missing any required scope field.
3. Reject plans whose success criteria are generic or empty.
4. Reject plans without explicit expected artifacts.

#### C2. Evaluator gate

The evaluator output must be machine-checked for:
- exact artifact-path references in verification
- verdict aligned with evidence policy
- no promotion of simulate, blocked, or weak evidence

Tasks:
1. Add evaluator validation.
2. Require at least one exact artifact reference in verification output.
3. Reject evaluator outputs that attempt promotion while evidence is synthetic or weak.

#### C3. Summarizer gate

The summarizer output must be machine-checked for:
- lessons specific enough to persist
- next actions specific enough to be useful
- output shape matching only what orchestrator consumes

Tasks:
1. Add summarizer validation.
2. Reject empty or generic lessons.
3. Reject next actions that are vague or empty.
4. Reject extraneous archival structures the orchestrator does not consume.

### Files likely to change

- `src/core/orchestrator.mjs`
- possibly new validator helpers under `src/core/`
- tests in `tests/factory.test.mjs`

### Acceptance criteria

- planner cannot pass without explicit scope justification fields
- evaluator cannot pass without artifact-linked verification
- summarizer cannot pass with generic output
- all four stage gates are machine-enforced

### Verification

- targeted unit tests for invalid planner/evaluator/summarizer payloads
- simulate path still passes with explicit synthetic but valid structured outputs

---

## Workstream D - Canonical On-Disk State Migration

Parent spec mapping:
- `factory/long-term-loop-architecture-spec.md:335`
- `factory/long-term-loop-architecture-spec.md:744`
- `factory/long-term-loop-architecture-spec.md:955`

### Objective

Bring persisted official machine artifacts on disk into the same canonical shape that runtime code now expects.

### Required tasks

#### D1. Backlog migration

Current `factory/backlog.json` still contains legacy statuses like `completed` and legacy fields like `run_id`.

Tasks:
1. Define the canonical backlog status set on disk.
2. Add a one-time migration/rewrite path that rewrites `factory/backlog.json` into canonical statuses.
3. Ensure canonical fields persist on disk, not just in memory normalization.
4. Preserve useful provenance fields where still needed, but do not keep legacy duplicates if they create ambiguity.

Canonical statuses should cover at minimum:
- `ready`
- `leased`
- `research_complete`
- `research_inconclusive`
- `research_blocked`
- `infra_blocked`

#### D2. Official artifact rebuild

Tasks:
1. Run a canonical rebuild of:
   - `factory/evidence/index.json`
   - `factory/leaderboard.json`
   - `factory/memory/lessons.jsonl`
   - `factory/memory/retrieval_index.json`
2. Commit only canonical normalized outputs.
3. Preserve quarantine reports for malformed historical fragments.

### Files likely to change

- `src/core/backlog-store.mjs`
- `src/core/init.mjs`
- `src/core/orchestrator.mjs`
- `src/core/memory-index.mjs`
- official files under `factory/`

### Acceptance criteria

- `factory/backlog.json` contains only canonical statuses
- official memory/evidence/leaderboard artifacts reflect current canonical schemas
- no stale simulate pollution remains in `factory/leaderboard.json`

### Verification

- tests asserting canonical backlog rewrite
- grep checks over official `factory/` files confirming no legacy backlog statuses remain

---

## Workstream E - Memory Normalization Bug Fix And Retrieval Ranking Completion

Parent spec mapping:
- `factory/long-term-loop-architecture-spec.md:619`
- `factory/long-term-loop-architecture-spec.md:633`
- `factory/long-term-loop-architecture-spec.md:658`
- `factory/long-term-loop-architecture-spec.md:957`

### Objective

Finish the memory pipeline so it validates cleanly and ranks retrieval using the full explicit scoring surface required by the parent spec.

### Required tasks

#### E1. Fix nested `extra_metrics` growth

Current normalization re-wraps preexisting `extra_metrics`, causing recursive nesting after repeated rebuilds.

Tasks:
1. Fix `normalizeMetrics()` so rebuilds are idempotent.
2. Add tests that run normalization twice and confirm stable output.
3. Rebuild official evidence/retrieval artifacts after the fix.

#### E2. Preserve ranking metadata in evidence-derived retrieval entries

Current derived evidence retrieval entries do not carry enough scope metadata.

Tasks:
1. Extend normalized evidence and/or derived retrieval entries to preserve, where available:
   - market family
   - strategy family
   - asset or selection rule
   - timeframe
2. Use evidence-derived metadata when lessons are sparse.

#### E3. Complete required ranking factors

Ranking must explicitly use:
- stage relevance
- market-family match
- asset match when applicable
- strategy-family match
- evidence quality
- recency
- contradiction value

Tasks:
1. Refactor retrieval scoring to make each factor explicit and inspectable.
2. Avoid burying this inside opaque overlap-only logic.
3. Keep outputs small by stage, per the parent spec.

### Files likely to change

- `src/core/memory-index.mjs`
- `src/core/retrieval.mjs`
- tests in `tests/factory.test.mjs`

### Acceptance criteria

- normalization is idempotent
- no nested `extra_metrics` remains after rebuild
- retrieval scoring explicitly includes the required factors
- stage retrieval remains compact

### Verification

- normalization idempotence test
- retrieval scoring tests showing market/asset/strategy/contradiction effects

---

## Workstream F - Strict Evidence And Leaderboard Finalization

Parent spec mapping:
- `factory/long-term-loop-architecture-spec.md:549`
- `factory/long-term-loop-architecture-spec.md:703`
- `factory/long-term-loop-architecture-spec.md:889`
- `factory/long-term-loop-architecture-spec.md:958`

### Objective

Finish the last evidence-policy mile so both code and checked-in official artifacts obey the same strict promotion semantics.

### Required tasks

1. Confirm `promotable` semantics mean strict promotable evidence everywhere, not a weaker surrogate.
2. Rebuild `factory/evidence/index.json` so stale historical entries no longer carry legacy permissive promotion semantics.
3. Rebuild `factory/leaderboard.json` so it contains only real promotable evidence.
4. Add regression tests for:
   - live positive-verdict but weak-score exclusion
   - live positive-verdict but missing OOS metrics exclusion
   - live positive-verdict but too-few-trades exclusion
   - simulate exclusion

### Acceptance criteria

- leaderboard contains only live promotable evidence
- simulate entries in leaderboard = zero
- inconclusive entries in leaderboard = zero
- weak live entries remain out of leaderboard even if verdict text is positive

### Verification

- tests
- grep checks over official `factory/leaderboard.json`
- final simulated verification showing zero simulate promotable evidence

---

## Workstream G - Acceptance Telemetry And Prompt-Surface Cleanup

Parent spec mapping:
- `factory/long-term-loop-architecture-spec.md:683`
- `factory/long-term-loop-architecture-spec.md:769`
- `factory/long-term-loop-architecture-spec.md:795`
- `factory/long-term-loop-architecture-spec.md:800`
- `factory/long-term-loop-architecture-spec.md:961`

### Objective

Close the remaining acceptance and observability gaps without building a heavy control plane.

### Required tasks

#### G1. Track required health metrics

Track at minimum:
- prompt bytes per stage
- compaction frequency
- session reuse count
- transport retry recovery rate
- stranded lease count
- resumable-run recovery rate
- memory validation failure count
- simulate entries in leaderboard
- asset/timeframe distribution across live runs
- percent of plans with explicit scope justification

### Lean implementation guidance

Do not build a full observability stack.
Use one compact machine-readable artifact, for example:
- `factory/health.json`
or a small bounded section inside `factory/state.json`

The implementation must be:
- bounded
- durable
- explicit
- easy to inspect

#### G2. Retire inactive doctrine files

Tasks:
1. Archive or delete `src/prompts/shared-context.md`.
2. Archive or delete `src/prompts/shared-guidance.md`.
3. Ensure there is only one active runtime truth stack:
   - `factory/long-term-loop-architecture-spec.md`
   - `src/prompts/runtime-invariants.md`
   - role prompts
   - task capsules

### Acceptance criteria

- all required health metrics are persisted and bounded
- duplicate inactive doctrine files are retired or clearly archived outside the active prompt surface
- hard acceptance criteria are machine-checkable from repo state

### Verification

- tests for metric field updates
- final repo grep showing inactive doctrine files removed from active prompt surface

---

## 6. Final Acceptance Pass

After all workstreams are complete, run one final closeout pass against `factory/long-term-loop-architecture-spec.md:947`.

The closeout is not successful until all of the following are true:

1. one active architecture spec only
2. one tiny runtime invariant file only
3. no runtime overlap between doctrine, roles, and capsules
4. each stage gets a fresh session
5. planner and ideator are separate
6. executor success requires real WFA artifacts
7. infra failures do not retire research ideas
8. one-time handoff notes do not leak beyond the resumed stage
9. memory validates cleanly
10. leaderboard contains only real promotable evidence
11. no hidden asset narrowing in active helpers or constants

## 7. Required Verification Pack

Before declaring live-readiness, produce and verify all of the following:

- tests pass locally
- import checks pass for touched runtime modules
- official `factory/` artifacts are rebuilt into canonical state
- leaderboard grep confirms zero simulate entries
- backlog grep confirms canonical statuses only
- retrieval/memory rebuild is idempotent across two consecutive rebuilds
- health metrics artifact exists and is populated
- `factory/market-policy.json` exists and is loaded by runtime

## 8. Non-Goals For Closeout

The following are explicitly out of scope for this closeout spec:

- new trading strategies
- new datasets or fetchers
- WFA engine redesign beyond schema/contract fixes needed for closeout
- embeddings/vector retrieval
- RL loops
- knowledge graphs
- Obsidian integration
- alternate execution paths
- any new hidden prompt steering layer

## 9. Implementation Order

Implement in this order:

1. Workstream E1 first if normalization bugfix affects rebuild output.
2. Workstream A and Workstream B together.
3. Workstream C stage gates.
4. Workstream D canonical on-disk migrations.
5. Workstream F strict evidence/leaderboard finalization.
6. Workstream G telemetry and prompt-surface cleanup.
7. Final acceptance pass.

This order minimizes rework and keeps the loop lean while the remaining closeout tasks are finished.

# ResearchBrain Cleanup Candidates — 2026-06-24

> **EXECUTED 2026-06-24.** All safe-delete and ask-first items below were deleted with operator approval. Validate passed; 575/575 tests passed. Kept: `walk forward engine/docs/tasks.md` (unresolved items 4-10), `walk forward engine/docs/ideas_and_strategy_runs.md` (unchecked action items + working strategy status table), `scripts/extract-mt5-report-ledger.mjs` + `scripts/migrate-runtime-ledger.mjs` (referenced by active tests), `workspace/harness/` (active simulate path). Spec drift (8 locations) and prompt/policy conflict (3 locations) fixed in-place.

> Companion to `researchbrain-deep-audit-2026-06-24.md`. Non-cosmetic cleanup list for approval. No deletions performed — all items require explicit operator approval before execution. Evidence-first with file:line claims.

## Deletion/move/merge decision key

- **safe-delete** — zero inbound refs, superseded, stale, or untracked clutter. Low risk.
- **ask-first** — potentially useful, referenced by tests/code, or has unresolved items. Requires verification before deletion.
- **keep-protected** — authoritative, evidence, or active code. Do not touch.

---

## A. Safe-delete candidates

| Path | Evidence | Recommend | Justification |
|---|---|---|---|
| `scripts/trading-loop.mjs` | `:1-14` thin `spawn` wrapper around `src/cli.mjs run`; untracked; 0 refs found | **delete** | Untracked wrapper clutter, no inbound refs |
| `scripts/run-session.sh` | `:1-4` thin bash wrapper around `node src/cli.mjs run --mode ...`; untracked; 0 refs found | **delete** | Untracked wrapper clutter, no inbound refs |
| `factory/planning/journal-legacy.md` | `:1-5` 5-line legacy placeholder | **delete** | No current value, placeholder only |
| `docs/researchbrain-enhancement/researchbrain-provider-rotation-research-2026-06-18.md` | `:1-16` redundant pointer to `factory/research/researchbrain/legacy-provider-rotation/` and finalization docs | **delete** | `research/README.md:1-7` and `factory/research/researchbrain/README.md:3-16` already serve this redirect |
| `factory/runs/verification-wfr-capability.md` | 2026-04-05 stale verification artifact; 0 inbound refs; findings in memory/project block | **delete** | Stale, superseded by memory blocks |
| `factory/runs/RUN-20260317*.json` (flat legacy format, ~8 files) | Mar 2026; 0 refs; superseded flat-run .json format (no subdir) | **delete** | Legacy flat format, evidence indexed elsewhere |

**Estimated cleanup: ~15 files, ~50 lines of code + ~8 stale JSON artifacts.**

---

## B. Ask-first: delete or move (raw research dumps / stale plans)

| Path | Evidence | Recommend | Justification |
|---|---|---|---|
| `walk forward engine/docs/researches/researches.md` | 2532 lines, 290KB; raw research dump | **move out of repo or delete** | Raw external content, no code reference, bloats tracked size |
| `walk forward engine/docs/researches/researches2.md` | 2504 lines, 125KB; raw research dump | **move out of repo or delete** | Same — second raw dump |
| `walk forward engine/docs/tasks.md` | `:1-3` "current implementation plan" reverified 2026-03-08; stale | **merge retained live risks into spec or delete** | Contains completed tasks `:14-52` but also unchecked/ongoing tasks `:55+`; do not claim all complete — fold unresolved items first |
| `walk forward engine/docs/ideas_and_strategy_runs.md` | 126 lines; strategy notes | **merge into spec or delete** | Superseded by spec + evidence index |
| `factory/planning/FACTORY-ADVISORY-2026-05-27.md` | `:7-15` says Phase 8D not started (stale); `:19-23` says Phase8B no exit-readiness (historical) | **delete or archive** | Findings superseded by later closeout artifacts |
| `factory/planning/FACTORY-STATE-ASSESSMENT-20260606.md` | 376 lines; snapshot from 2026-06-06, 18 days stale | **delete or archive** | Stale snapshot |
| `factory/planning/NEXT-ORCHESTRATOR-HANDOFF-20260606.md` | 279 lines; proposed canary already executed | **delete or archive** | Superseded by follow-up slices |
| `factory/research/PHASE8D-POSITIVE-WINDOW-RATIO-ANALYSIS.md` | 328 lines; analysis-only, never resulted in gate changes; uppercase name breaks snake_case convention | **delete** | Decisions folded into spec; no gate changes resulted |
| `factory/research/phase8b-researchbrain-end-to-end-audit-2026-05-22.md` | 310 lines; Phase 8B audit | **delete if folded** | Decisions folded into spec per Phase 8B closeout |
| `factory/research/phase8b-researchbrain-live-agent-decision-2026-05-21.md` | 261 lines; Phase 8B live agent decision | **delete if folded** | Superseded by spec |
| `factory/research/phase8b-source-tools-research-2026-05-21.md` | 304 lines; Phase 8B source tools | **delete if folded** | Superseded by spec |
| `factory/research/phase8b-tool-scope-assessment-2026-05-22.md` | 114 lines; Phase 8B tool scope | **delete if folded** | Superseded by spec |
| `wfa/` (entire dir, 1.9MB) | Legacy WFA engine; `wfa/README.md:1-40` documents engine under `wfa/`; active `src/` grep found no root-`wfa/` imports; active code references `walk forward engine/` (`src/workers/research-wfa-run-worker.mjs:591-593,748`) | **ask: move or delete** | Legacy/reference; some code/data may be useful — verify before removing |
| `workspace/data/polymarket_signals.json`, `polymarket_markets_raw.json`, `polymarket_current.json` | Polymarket data files; spec `:3477` no-prediction-market boundary; `:3764` stale prediction-market scope removed | **delete** | Out of current scope |
| `workspace/data/fetchers/polymarket_fetcher.py`, `smoke_test_polymarket.py` | Polymarket fetchers; out of scope | **delete** | Out of current scope |

**Estimated cleanup: ~415KB raw dumps + ~1400 lines stale planning/research docs + 1.9MB legacy `wfa/` dir + Polymarket files.**

---

## C. Ask-first: keep until tests/code refactored

| Path | Evidence | Recommend | Justification |
|---|---|---|---|
| `scripts/extract-mt5-report-ledger.mjs` | `:62-120` exports `extractMt5ReportLedger`; `tests/verification.test.mjs:17-18` imports it | **keep until test refactored** | Referenced by active test; not safe-delete without test/code changes |
| `scripts/migrate-runtime-ledger.mjs` | `:1-19` migration diagnostics CLI; `tests/runtime-ledger.test.mjs:230-242` spawns it | **keep until test refactored** | Referenced by active test |
| `scripts/run-researchbrain-stage0-manifest.mjs` | `:1-65` standalone manifest builder; no package alias (`package.json:34-40`); `tests/researchbrain-stage0-cli-help.test.mjs:18-27` includes it in value-command argument-validation list | **ask-first: add alias or delete after removing test row** | Tested but unaliased; either wire intentionally or remove cleanly |
| `workspace/harness/wfa_engine.py` | Used by `src/core/runner-simulate.mjs:74,81` for simulate mode | **keep until simulate path refactored** | Active simulate path depends on it |
| `workspace/harness/wfa_minimal.py`, `wfa_standalone.py`, `wfa_integration.py`, `fetch_polymarket.py` | In `workspace/harness/`; `wfa_minimal.py` is weak fallback evidence per memory | **ask-first** | May have historical/local utility; not primary live evidence path |
| `factory/research/researchbrain/RESEARCHBRAIN-CLOAKBROWSER-ANALYSIS.md` | `:1-13` 2026-06-20 CloakBrowser memo; `:84-100` proposes `browse_web_page` capture tool; `:259-283` recommends integrating after reliability; not referenced outside itself; tensions with `researchbrain-architecture-finalization-2026-06-23.md:238-247` do-not-build list | **ask-first: fold "deferred" note or delete/archive** | Conflicts with current doctrine; either tombstone or remove |

---

## D. Spec drift fixes (spec edit, not deletion)

| Location | Current | Should be |
|---|---|---|
| `factory/mt5-ftmo-strategy-factory-spec.md:3380` | `### Phase 8 [...] [ ]` | `[x]` (8A–8D closed) |
| `:3382` | "Status, 2026-05-17: not started" | Update date; mark in progress (8E blocked) |
| `:3386-3394` | Preamble says 8B not live-ready, 8C/8D not enforced | Rewrite to reflect 8B/8C/8D closure |
| `:3398` | "Phase 8B/8C/8D/8E remain not started" | Remove or correct (8B/C/D closed) |
| `:2520`, `:3479`, `:3515`, `:3569` | "remain not started" sentences | Remove or correct |

---

## E. Prompt/policy conflict fix (code edit, small)

| Location | Current | Should be |
|---|---|---|
| `src/prompts/planner.md:28` | `"market_family": "crypto|prediction_markets|forex|other"` | Remove `prediction_markets` |
| `src/prompts/planner.md:42` | `"binance|public_archive|polymarket_public|dukascopy|other"` | Remove `polymarket_public` |
| `src/prompts/ideator.md:24` | `"market_family": "crypto|forex|prediction_markets"` | Remove `prediction_markets` |

Aligns with `factory/market-policy.json:4-33` (no prediction-market family) and spec no-prediction-market boundary.

---

## F. Keep-protected (do not touch)

| Path | Why |
|---|---|
| `factory/mt5-ftmo-strategy-factory-spec.md` | Active implementation authority |
| `AGENTS.md`, `README.md`, `src/prompts/runtime-invariants.md` | Operator doctrine / runtime truth |
| `src/prompts/{ideator,planner,executor,evaluator,summarizer}.md` | Active role prompts (edit only for conflict fix above) |
| `factory/state.json`, `factory/backlog.json`, `factory/leaderboard.json`, `factory/evidence/index.json` | Official orchestrator state |
| `factory/memory/lessons.jsonl` | Durable lessons archive |
| `factory/verification/phase*.json` (latest only) | Phase closeout artifacts |
| `factory/runtime/factory.sqlite`, `factory/runtime/projections/` | Active runtime ledger |
| `factory/mt5/environment/`, `factory/mt5/history-availability/` | MT5 terminal snapshots / history probes |
| `factory/research/runs/` (recent 2026-06-24 runs) | Live canary evidence |
| `factory/research/requests/` (recent) | Pending ResearchBrain requests |
| `factory/research/researchbrain/legacy-provider-rotation/` | Explicitly marked legacy/context-only |
| `walk forward engine/` (entire dir) | Canonical WFA execution engine |
| `src/core/researchbrain-*.mjs` | Active ResearchBrain code (refactor candidates, not delete) |

---

## G. Code refactor candidates (non-cosmetic, deferred)

These are not cleanup deletions but structural improvements identified by Lane B. Defer until after P0/P1 next steps land.

| Item | Evidence | Recommend |
|---|---|---|
| `researchbrain-stage0-supervisor.mjs` monolith | ~1855 lines; mixes policy/preflight/cycles/classification/health/reports | Extract report-writing (`:1080-1327+`), health/recommendation/operational-summary sections into separate modules |
| `researchbrain-artifacts.mjs` scope | 1127 lines, 25 exports; mixes schema/validate/build/write + heavyweight business logic | Move `classifyResearchBrainBacklogSourceQuality`, `validateResearchBrainPlannerProvenance`, `validateResearchBrainBacklogCandidate` to `researchbrain-backlog.mjs` or `researchbrain-orchestrator-gates.mjs` |
| Duplicate `resolveRepoRelativePath` / `sha256File` / `sha256Text` | Reimplemented in ~10 core files (~150 lines total) | Extract to shared `path-utils.mjs` |
| `researchbrain-youtube-ingest.mjs` | 251 lines, fixture-only, 0 direct tests | Either add live adapter + tests, or delete if YouTube is not an active source |
| YouTube CLI flags | `scripts/run-researchbrain-stage0-runtime.mjs:66-73` parsed but never wired (`:181-204` confirms no-op) | Remove reserved flags or wire them |
| Test-only exports | `createMapResearchBrainSourceToolAdapter`, `createMapResearchBrainSourceFetcher` | Move to test fixtures or mark internal |

---

## Summary

| Category | Items | Est. size |
|---|---|---|
| Safe-delete | ~15 files | ~50 lines code + ~8 stale JSON |
| Ask-first delete/move | ~15 files + `wfa/` dir + Polymarket files | ~415KB dumps + ~1400 lines docs + 1.9MB legacy |
| Ask-first keep until refactored | 6 items | — |
| Spec drift fixes | 7 locations in spec | Spec edit |
| Prompt/policy conflict fix | 3 locations in prompts | Small code edit |
| Keep-protected | ~15 paths/dirs | Do not touch |
| Code refactor (deferred) | 6 items | Non-cosmetic, after P0/P1 |

**Bottom line:** The highest-value cleanup is (1) spec drift fixes (7 locations), (2) prompt/policy conflict fix (3 locations), (3) removing 415KB of raw research dumps + stale planning docs, and (4) deciding the `wfa/` legacy dir. None of these are cosmetic — each removes ambiguity or bloat that could mislead future agents.

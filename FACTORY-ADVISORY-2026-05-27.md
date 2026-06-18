# Factory State Advisory Report — 2026-05-27

## 1. Current Phase Status

All closed phases are consistently marked closed across spec ticks, closeout artifacts, evidence index, leaderboard, backlog, and memory blocks.

| Phase | Status | Closeout Artifact | Met | Pending | Deferred |
|---|---|---|---|---|---|
| 7B | Closed | `factory/verification/phase7b-exit-readiness-20260515T164711Z.json` | 6 | 0 | 2 |
| 7C | Closed | `factory/verification/phase7c-exit-readiness-20260516T161614Z.json` | 6 | 0 | 1 |
| 8A | Closed | `factory/verification/phase8a-exit-readiness-20260519T203458Z.json` | 8 | 0 | 0 |
| 8B | Closed | No exit-readiness artifact — closeout asserted in spec line 3411 | — | — | — |
| 8C | Closed | `factory/verification/phase8c-exit-readiness-20260527T094947Z.json` | 10 | 0 | 4 |
| 8D | Not started | Confirmed | — | — | — |
| 8E | Not started | Confirmed | — | — | — |

### Discrepancies Found

**1.1 Phase 8B has no exit-readiness builder.**
Every other closed phase has `src/core/phase<N>-exit-readiness.mjs`, a CLI runner, an npm script, and a timestamped verification artifact. Phase 8B's closeout is asserted in spec narrative and indirect flags only (the Phase 8C artifact carries `phase8b_closed: true` and the Phase 8A artifact carries `researchbrain_started: false`). This is a methodological inconsistency.

**1.2 Phase 8A exit-readiness code is stale against current codebase.**
`src/core/phase8a-exit-readiness.mjs:238` checks that `package.json` does not contain `"researchbrain"`. Since Phase 8A closed, the npm script `researchbrain:stage0-runtime` was added (`package.json:34`). Re-running the reporter today would return `not_ready_to_close`. The existing artifact is correct for its timestamp, but the source code would now give a wrong answer.

**1.3 `factory/state.json` has no phase tracking and a stale goal.**
- Goal string still mentions "prediction markets" — explicitly out of scope since the `phase8_scope_correction_20260518` memory block.
- No `current_phase`, `phase_status`, or `phase_history` field. A new operator or agent reading only `state.json` would have no idea of project phase progress. Note: `factory/verification/` closeout artifacts are the phase authority.

---

## 2. Phase 8C Quality Assessment

### Closeout verdict: Rational and defensible.

**What was done well:**
- **Multi-layer evidence safety:** stale/copied-output detection (4 independent layers: pre/post snapshot diff, identity field match, freshness guard, disk mtime tests in `src/workers/research-wfa-run-worker.mjs` and `src/core/validators.mjs`), zero-trade block (`research-wfa-run-worker.mjs:789-791`), legacy envelope distinction (`execution_was_run_by_this_worker: false`), Stage-0 non-executable boundary (`validators.mjs:643-646`).
- **Survivor floor enforcement:** hard throw in `validateEvaluationResult` (`validators.mjs:1216-1221`) — the evaluator cannot assign positive labels below 8 windows / 200 trades / 5% return / 70% positive ratio. The evaluator prompt also warns against tuning toward floors as optimization targets (`prompt-builders.mjs:351`).
- **Pre-registration gate for Phase 8D WFA:** `compileWfaReadyPlan` (`wfa-plan-compiler.mjs:189-191`) blocks screening-intent WFA without a hash-backed preregistration artifact carrying `invalid_if_added_after_results: true`, `registered_before_run_id` binding, and `wfa_executed: false`.
- **Advisory stats boundary:** DSR/PBO/CPCV/White all carry `enabled_as_promotion_gate: false` and interpretation `"advisory_only_not_a_promotion_gate"` in `verification.mjs`. No downstream code reads them for promotion or rejection.
- **ResearchBrain source-quality gate:** `classifyResearchBrainBacklogSourceQuality` (`researchbrain-artifacts.mjs:990-1020`) blocks low-signal single-source packets from direct WFA routes. Enforced at compiler, backlog candidate validator, and planner provenance levels.
- **Bounded remediation without spam:** `buildRepeatedFailureRemediationActions` (`orchestrator.mjs:398`) creates at most one remediation key per `remediation_key`.

**Weaknesses and discrepancies:**
- **Duplicate survivor floor constants (moderate maintenance risk):** `src/core/validators.mjs:32-35` defines `PROMISING_MIN_WINDOWS=8`, `PROMISING_MIN_TRADES=200`, `PROMISING_MIN_RETURN_PCT=5`, `PROMISING_MIN_POSITIVE_WINDOW_RATIO=0.7`. `src/core/verification.mjs:54-57` defines identical `PHASE8D_MIN_*` constants. If one set changes independently, floors silently diverge. Should extract to a shared constants module.
- **Phase 8B has no exit-readiness builder** (covered in 1.1).
- **Phase 8A exit-readiness code stale** (covered in 1.2).
- **Worker-level `resultsKnownAt` preregistration check deferred to evaluation:** `research-wfa-run-worker.mjs:626-630` validates preregistration but does not pass `resultsKnownAt`, so the timestamp-based "registered before results" check only runs at evaluation stage (`orchestrator.mjs:1871`). Not exploitable in practice because `registered_before_run_id` binding requires knowing the RUN-* ID in advance, but a hardening opportunity exists.

### Deeper work classification:

| Possible task | Classification |
|---|---|
| Physical removal/wiring of inactive optimizer/cost modules | Deferred overengineering — current fail-loud diagnostics sufficient |
| Generic indicator warmup inference | Deferred overengineering — would be speculative and create false confidence |
| Hard statistical promotion/input producers | Deferred — Phase 8D can screen with advisory stats |
| Cost-stress or multi-objective optimizer wiring | Deferred — no concrete candidate need yet |
| Shared constants module for survivor floors | Optional but useful — low effort, prevents future drift |
| Phase 8B exit-readiness builder | Optional but useful — completes methodological pattern |
| Phase 8A exit-readiness fix (time-aware check) | Optional but useful — prevents stale re-run failures |
| Worker-level `resultsKnownAt` preregistration check | Optional hardening — closes timestamp-gap window |
| Broader ResearchBrain rejection/duplicate retrieval gates | Optional — Phase 8B is closed, this is Phase 8C-adjacent follow-up |

**None of these are Required Before Phase 8D.**

---

## 3. Evidence-Safety Assessment

All boundaries assessed via detailed code audit. Sources: `src/core/verification.mjs`, `src/core/validators.mjs`, `src/workers/research-wfa-run-worker.mjs`, `src/core/wfa-plan-compiler.mjs`, `src/core/research-wfa-preregistration.mjs`, `src/core/researchbrain-artifacts.mjs`, `src/core/prompt-builders.mjs`.

| Boundary | Verdict | Details |
|---|---|---|
| WFA config/output-root truth | Pass | Canonical output root enforced in `wfa-config-contract.mjs`, validated at worker launch and evidence acceptance |
| WFE/WFR artifact-backed reporting | Pass | WFE/WFR compute only from accepted artifact-backed metrics; absent inputs produce missing diagnostics — no invented metrics |
| Survivor floor enforcement | Pass | Hard throw vetoes evaluator verdict below 8/200/5%/0.7 thresholds. Low-frequency exception requires pre-run `low_frequency_registration_v1`. Evidence metric values must match cited artifact files |
| Pre-registration WFA launch gate | Pass | Phase 8D screening intent requires hash-backed preregistration with `invalid_if_added_after_results: true`, `registered_before_run_id` binding, and `wfa_executed: false` |
| Advisory stats authority boundary | Pass | DSR at `verification.mjs:1174-1193`, PBO at `:1365-1384`, CPCV at `:1487-1520`, White at `:1604-1626` — all carry `enabled_as_promotion_gate: false`. No promotion/rejection code path reads them |
| ResearchBrain direct-WFA laundering protection | Pass | Multi-gate: source-quality classification (`researchbrain-artifacts.mjs:990-1020`) blocks low-signal single-source; compiler rejects at `wfa-plan-compiler.mjs:166-168`; backlog candidate validator at `:1073-1079`; planner provenance at `:1107-1110`; manifest/memory gates also check duplicate/rejection/failed-pattern signals |
| Stale/copied WFA output detection | Pass | 4 layers: (1) pre/post-run snapshot diff at `research-wfa-run-worker.mjs:745-761`, (2) request-identity field match at `validators.mjs:313-339`, (3) freshness guard at `:341-357`, (4) disk mtime check at `:1161-1172` |
| Zero-trade block | Pass | Worker sets `status: "inconclusive"` for zero trades (`:789-835`); validator requires `total_trades >= 1` and worker `"succeeded"` (`:713-714, :737-739`) |
| Legacy envelope vs worker-launched WFA | Pass | Legacy envelope: `execution_was_run_by_this_worker: false`, `envelope_scope: "officialized_existing_output"` (`research-wfa-envelope-worker.mjs:144`). Worker-launched: `worker: "research_wfa_run"`, schema `research_wfa_run_worker_v1`. Validator requires worker-launched for new executed evidence |
| Stage-0 discovery as non-executable | Pass | Blocked at execution validation (`validators.mjs:643-646`), backlog candidate validation (`researchbrain-artifacts.mjs:1034-1036`), and schema-level boundary (`:225-235`) |
| Bounded remediation anti-spam | Pass | `buildRepeatedFailureRemediationActions` keyed by `remediation_key` prevents duplicate remediation items without recursive cascades |

### Remaining bypasses: None found.

One hardening opportunity (not a bypass): Worker-level `resultsKnownAt` preregistration timestamp check described in Section 2 above.

---

## 4. Cleanup / Organization Assessment

Total factory size: ~33 MB (~23 MB from `factory/runs/`, mostly legacy).

### Category A: Must Preserve As Evidence

| Path | Reason |
|---|---|
| `factory/evidence/index.json` | Canonical evidence index (110 entries). Irreplaceable. |
| `factory/leaderboard.json` | Strategy scoring (7 entries). |
| `factory/backlog.json` | Active work queue. |
| `factory/state.json` | Orchestrator persistence. |
| `factory/mt5-ftmo-strategy-factory-spec.md` | Sole active continuation spec (331 KB). Current source of truth for all phases. |
| `factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json` | Only MT5 FTMO universe snapshot (167 symbols, 629 KB, SHA-256 `545936404616ca3...`). Irreplaceable without re-running MT5 snapshot. |
| `factory/runs/RUN-20260513113253-gghape/` | Official orchestrator WFA canary (3 windows, 20 trades, OOS Sharpe 1.52, inconclusive verdict). |
| `factory/runs/RUN-20260514050018-cli-wfa-canary/` | CLI WFA canary — confirms deterministic bypass path works. |
| `factory/runs/JOB-RESEARCH-WFA-CAND-EURUSD-M15-LONDON-BREAKOUT-001-20260504/` | MT5 candidate with full WFA artifacts, metrics, promotion gate, data validation. Negative Sharpe -0.4048. |
| `factory/runs/JOB-RESEARCH-WFA-EMA-20260405-OFFICIALIZED/` | Early EMA strategy officialization run. |
| `factory/runs/JOB-RESEARCH-WFA-ENVELOPE-VALIDATION-20260502/` | Envelope strategy validation run. |
| `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/` | Final successful ResearchBrain live canary. 3 hypotheses, 3 source records, real provider calls, agent/tool/cost transcripts. Capstone of Phase 8B. |
| `factory/candidates/CAND-EURUSD-M15-LONDON-BREAKOUT-001/` | MT5 candidate artifacts (data validation, metrics, promotion gate, WFA results). |
| `factory/memory/lessons.jsonl` | Durable lessons archive (428 KB). |
| `factory/memory/retrieval_index.json` | Semantic retrieval index (756 KB). |
| `factory/runtime/factory.sqlite` | SQLite runtime ledger mirror (Phase 7B). |
| All 5 active phase closeout artifacts in `factory/verification/` | Phase authority artifacts. |

### Category B: Active Source of Truth

- `factory/backlog.json`, `factory/state.json`, `factory/active-session.json`
- `factory/leaderboard.json`, `factory/market-policy.json`
- `factory/health.json`, `factory/iteration_digest.txt`
- `factory/evidence/index.json`, `factory/artifacts/index.json`
- `factory/memory/lessons.jsonl`, `factory/memory/retrieval_index.json`
- `factory/runtime/factory.sqlite`, `factory/runtime/active-run.json`, `factory/runtime/owner-lock.json`, `factory/runtime/recovery-log.jsonl`

### Category D: Redundant Generated Artifacts Safe to Delete

**37 stale verification artifacts in `factory/verification/`:**
- 11 `rollout-gate-*` files (April-May 2026) — superseded by phase closeout artifacts
- 10 `state-migration-report-*` files (April-May 2026) — one-time migration artifacts, no ongoing value
- 11 `verification-manifest-*` files (April-May 2026) — superseded by phase closeout artifacts (~124-147 KB each)
- 2 `transport-bakeoff-*` files (April 2, 2026) — stale transport benchmarks
- 3 `fault-drills-*` files (April 3, 2026) — stale fault injection drills
- 1 duplicate `phase7c-exit-readiness-20260516T151330Z.json` — identical to T161614Z; keep the later one

Total: **~3.5 MB** freed. None are referenced by active code or the evidence index.

**Orphaned file in factory root:**
- `factory/phase8b-youtube-ingestion-advisor-response-youtube-2026-05-22.md` (15.5 KB) — belongs under `factory/research/` or should be archived. Content is NOT folded into the active spec.

### Category E: Stale/Debugging Artifacts

**ResearchBrain canary debugging noise (13 runs):**
- 12 blocked live canary runs (`RESEARCHBRAIN-STAGE0-LIVE-20260523T123900Z` through `T142000Z`) — all `blocked` status, pure debugging noise. Keep only the final successful `T143000Z`.
- 1 fixture-only dryrun (`RESEARCHBRAIN-STAGE0-DRYRUN-20260520T0927Z`) — no value if live canary suffices as Phase 8B proof.

**Legacy simulation-only run directories (80+):**
- `RUN-20260315*` through `RUN-20260403*` — evidence index records them as `simulation`, `inconclusive`, all null metrics, `mode: simulate`. No real WFA data. Occupy ~15 MB. Safe to delete only if no code references them by path (confirmed: no `grep` hits in active code or spec).

**Stray files:**
- `factory/runs/verification-wfr-capability.md` — misplaced markdown in runs directory
- Loose `RUN-*.json` files in `factory/runs/` root (5-10 files) — old experiment plans without corresponding run directories

### Proposed Directory Structure (spec-conformant gaps)

- `factory/hygiene/` — not yet created; spec says defer until real artifact volume exists; current 33 MB makes this borderline
- `factory/quarantine/` — not yet created; some ResearchBrain runs have local quarantine subdirs but no top-level root
- `factory/archive/` — not yet created; stale verification artifacts and legacy runs should go here, not be deleted

---

## 5. Documentation Hygiene Assessment

### Active source of truth (keep):
- `factory/mt5-ftmo-strategy-factory-spec.md` — **the only active spec**, 331 KB
- `src/prompts/runtime-invariants.md` — compact runtime doctrine
- `AGENTS.md` — operator constraints directory
- `README.md` — project overview

### Advisory docs fully folded into spec (archive or tombstone):

**5 Phase 8B research docs in `factory/research/`:**
- `phase8b-researchbrain-end-to-end-audit-2026-05-22.md`
- `phase8b-researchbrain-live-agent-decision-2026-05-21.md`
- `phase8b-source-tools-research-2026-05-21.md`
- `phase8b-tool-scope-assessment-2026-05-22.md`
- `README.md`

The spec's Section 11.16B already names these as supporting but non-authoritative. Per spec policy (Section 2A.3): "If a document does not guide future execution, explain evidence, define a gate, or preserve an important decision, it should be compressed, archived, or removed by policy." These explain decisions but the spec now owns those decisions. Recommend archiving to `factory/archive/research/` or adding tombstone notes.

**1 orphaned advisory doc in factory root:**
- `factory/phase8b-youtube-ingestion-advisor-response-youtube-2026-05-22.md` — same treatment as above.

---

## 6. Immediate Next Plan

### Cleanup-only work (safe, no risk to evidence):

1. **Prune stale verification artifacts** — archive or delete the 37 stale verification files (rollout gates, migration reports, manifests, bakeoffs, fault drills, duplicate phase7c).
2. **Remove canary debugging noise** — delete the 12 blocked ResearchBrain live canary runs (T123900Z through T142000Z). Keep only the successful T143000Z.
3. **Relocate orphaned files** — move `factory/phase8b-youtube-ingestion-advisor-response-youtube-2026-05-22.md` to `factory/research/` or archive. Move `factory/runs/verification-wfr-capability.md`.
4. **Archive Phase 8B advisory docs** — tombstone or move to `factory/archive/research/`.

### Optional Phase 8C advisory follow-up (not blocking):

5. **Consolidate survivor floor constants** — extract `PROMISING_MIN_*` / `PHASE8D_MIN_*` into a shared constants module (`src/core/wfa-survivor-floors.mjs`) referenced by both `validators.mjs` and `verification.mjs`.
6. **Add `resultsKnownAt` to worker preregistration validation** — pass it from `research-wfa-run-worker.mjs` to `validateResearchWfaPreregistrationArtifact` to close the timestamp-gap window at the worker level.
7. **Build Phase 8B exit-readiness reporter** — `src/core/phase8b-exit-readiness.mjs` + CLI + npm script + artifact to match the methodological pattern of all other phases.

### Phase 8D preparation (non-blocking organizational):

8. **Update `factory/state.json`** — remove "prediction markets" from goal, add `current_phase` / `phase_status` tracking.
9. **Fix Phase 8A exit-readiness code** — make the `phaseBoundaryCriterion` check time-aware or exempt the legitimate `researchbrain:stage0-runtime` script.
10. **Decide on legacy simulation run retention** — run `grep` for path references to old run IDs, then archive or delete the ~15 MB of simulation-only runs. The evidence index already holds their metadata.

### Phase 8D screening start conditions:

**Phase 8D can start now. No required blockers remain.** The evidence-safety gates, advisory stats, survivor floors, pre-registration requirements, ResearchBrain source-quality gate, and remediation boundaries are all in place. The cleanup items above are optional polish, not prerequisites.

---

## 7. Final Verdict

**Was Phase 8C correctly closed?**
Yes. The closeout is rational and evidence-backed. 10 of 14 criteria are met with disk-backed artifacts at `factory/verification/phase8c-exit-readiness-20260527T094947Z.json`. 4 criteria are explicitly deferred with documented rationales. The concrete bypasses that would create false Phase 8D evidence are closed or fail-loud.

**Is the factory ready to begin Phase 8D planning?**
Yes. The evidence pipeline is sealed against: fake WFA evidence, stale/copied outputs, zero-trade laundering, ResearchBrain source laundering, WFA roulette, evaluator narrative promotion, and advisory stat false authority. The 5-agent loop (ideator → planner → executor → evaluator → summarizer), deterministic WFA worker, runtime ledger mirror, data-readiness manifests, advisory statistical consumers, ResearchBrain contracts, and pre-registration gates all exist and are tested.

**Is the repo clean enough to begin Phase 8D, or should cleanup happen first?**
Clean enough. The 37 stale verification files, 12 blocked canary runs, and 80+ legacy simulation directories are clutter, not blockers. Cleanup can proceed in parallel or after Phase 8D begins.

**What are the exact blockers, if any?**
None. Zero blockers for Phase 8D start.

**What should be intentionally deferred?**
- Physical optimizer/cost module removal or wiring — deferred unless a concrete bypass appears
- Generic indicator warmup inference — deferred as speculative
- Hard statistical promotion gates and input producers — deferred since Phase 7C
- Cost-stress or multi-objective optimizer wiring — deferred until a concrete candidate needs it
- Broad SQLite orchestration authority — deferred since Phase 7B
- Live ResearchBrain improvements beyond the successful canary — Phase 8B is closed
- MT5 strategy tester parity for real strategies — that's Phase 8E, requires a Phase 8D survivor first
- Hygiene scanner, archive infrastructure, quarantine root — defer until real artifact volume justifies it (~33 MB is modest)

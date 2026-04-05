# Loop Tightening Spec

Date: 2026-03-31
Status: proposed subordinate implementation spec
Parent spec: `factory/long-term-loop-architecture-spec.md`

## 1. Purpose

This spec defines one focused tightening pass after the major loop upgrade work.

It is not a second architecture spec.
It exists to make the current loop leaner, more coherent, and more professional by removing split-brain state, stale runtime paths, and obvious repo clutter.

The desired end state is:
- one canonical live evidence path
- one canonical orchestrator-owned truth for run state
- one clean runtime path for resume/recovery
- no stale active subsystems or misleading docs
- no junk or redundant files left in the active repo structure

## 2. Strict Scope Rule

This pass is about tightening the loop, not expanding it.

In scope:
- control-plane correctness
- artifact and state coherence
- transport and resume hardening
- removal of stale active code paths
- cleanup of root structure and operator-facing docs

Out of scope:
- new strategy research
- new data fetchers
- new memory systems
- large prompt redesign beyond removing stale overlap
- WFA-engine feature work unrelated to the active loop boundary
- cosmetic refactors that do not reduce ambiguity or remove redundancy

## 3. Non-Negotiable Rules

- Do not create a second live execution truth path.
- Do not delete historical research evidence just because it is old or messy.
- If a historical artifact is no longer canonical, archive or clearly de-activate it rather than pretending it never existed.
- Keep the real live evidence path centered on `walk forward engine/`.
- Keep official state ownership in the orchestrator.
- Prefer fewer, clearer modules over more wrappers and compatibility shims.

## 4. Verified Current Problems

The current repo still has these specific tightening gaps:

1. Latest traced live failure is still executor transport timeout.
   - Evidence: `factory/runs/RUN-20260325104939-77da6y/executor-attempt-3/stage-error.json`
   - Evidence: `factory/runs/RUN-20260325104939-77da6y/run-state.json`

2. Official state is split across conflicting SOL result artifacts.
   - `factory/state.json` points at `RUN-20260325105657-01`
   - `factory/evidence/index.json` and `factory/leaderboard.json` still point at `RUN-20260325105500-54`
   - `factory/backlog.json` marks the SOL idea completed while still carrying transport-failure resume metadata

3. The latest SOL success artifacts disagree internally.
   - `factory/runs/RUN-20260325105657-01.json`
   - `factory/runs/RUN-20260325105657-01/run_result.json`
   - `factory/runs/RUN-20260325105657-01/eval.json`
   - `factory/summaries/RUN-20260325105657-01.md`

4. The active leaderboard file shape does not match current runtime code expectations.
   - File: `factory/leaderboard.json`
   - Code: `src/core/memory-index.mjs`
   - Code: `src/core/health.mjs`
   - Code: `src/core/prompt-builders.mjs`

5. A stale cleanup subsystem is still wired into the orchestrator.
   - `src/core/orchestrator.mjs`
   - `src/core/cleanup/orchestrator.mjs`
   - `src/core/cleanup/assessor.mjs`
   - `opencode.json` does not define the referenced `cleanup-assessor` agent

6. The repo still exposes multiple misleading execution surfaces and outdated docs.
   - duplicate/legacy WFA surfaces: `wfa/`, `workspace/harness/wfa_engine.py`
   - operator-facing docs still describe the old loop in `README.md`

7. The repo root still contains obvious junk or leftovers.
   - stray malformed directories
   - committed cache directories
   - `test.txt`
   - empty placeholder top-level directories

## 5. Required Workstreams

Complete the work in the order below.

---

## Workstream A - Canonical Run Truth And Artifact Coherence

### Objective

Remove split-brain state so the repo has one canonical answer for "what happened last" and "which run is promotable".

### Exact tasks

1. Resolve the current SOL conflict explicitly.
   Choose how `RUN-20260325105500-54` and `RUN-20260325105657-01` should be treated:
   - one becomes canonical and the other becomes historical/non-canonical, or
   - both remain historical but only one is allowed to feed official state

2. Make all official persisted files agree with that choice.
   Reconcile at minimum:
   - `factory/state.json`
   - `factory/backlog.json`
   - `factory/evidence/index.json`
   - `factory/leaderboard.json`
   - `factory/health.json`

3. Fix the SOL backlog item so it is internally coherent.
   The item must not simultaneously present as:
   - completed
   - resumable from executor
   - transport-failed

4. Standardize the canonical live run artifact shape going forward.
   The orchestrator-owned structure must be the only active source used by runtime code for:
   - latest run state
   - evidence promotion
   - leaderboard rebuilds
   - health rebuilds

5. Fix the leaderboard schema mismatch.
   The on-disk file shape and runtime code must agree on one format only.

6. Ensure official derived files are rebuildable from canonical sources without manual patching.
   If a rebuild step exists, it must produce the same truth that runtime code expects.

### Files likely to change

- `factory/state.json`
- `factory/backlog.json`
- `factory/evidence/index.json`
- `factory/leaderboard.json`
- `factory/health.json`
- `src/core/memory-index.mjs`
- `src/core/health.mjs`
- any orchestrator-owned artifact rebuild helpers

### Acceptance criteria

- one canonical latest live run is identifiable on disk
- `state`, `backlog`, `evidence`, `leaderboard`, and `health` no longer disagree about the latest promoted outcome
- leaderboard schema matches runtime expectations exactly
- no completed backlog item retains stale resume/failure metadata from an older conflicting run state

---

## Workstream B - Transport And Resume Hardening

### Objective

Make transport failure survivable without corrupting run identity, stage identity, or planner/executor history.

### Exact tasks

1. Audit `src/core/runner-opencode.mjs` and make timeout handling explicit.
   Tighten what is configurable and what is only normalized after failure.
   Any timeout behavior that matters operationally should be visible in code, not implied.

2. Prevent one run from minting multiple planner completions or multiple experiment IDs unless the design explicitly allows it.
   If retries/resume can recreate a planner result, define the rule and enforce it.

3. Tighten handoff and resume semantics.
   A handoff must be:
   - created once per failed stage boundary
   - consumed once on successful resume
   - cleared from official state when no longer pending

4. Make transport telemetry current and actionable.
   Health/recovery stats should reflect the latest real run corpus and distinguish:
   - total transport failures
   - recovered retries
   - recovered resumptions
   - still-pending handoffs

5. Prove the path with one orchestrator-controlled run after hardening.
   Preferred verification order:
   - resume an existing valid handoff if still appropriate
   - otherwise run one new low-cycle live pass

### Files likely to change

- `src/core/runner-opencode.mjs`
- `src/core/orchestrator.mjs`
- `src/core/state-store.mjs`
- `src/core/logger.mjs`
- `src/core/health.mjs`
- any handoff/retry helper modules involved in stage recovery

### Acceptance criteria

- a single run no longer logs duplicate planner success records for the same logical plan without an explicit rule
- resume state is one-shot and coherent on disk
- health telemetry is rebuilt and current
- one fresh orchestrator-controlled run leaves coherent artifacts even if transport remains imperfect

---

## Workstream C - Remove Stale Active Runtime Surfaces

### Objective

Shrink the active runtime to only the pieces that still matter.

### Exact tasks

1. Decide whether `src/core/cleanup/` is part of the real product.
   If no, remove it from the active runtime path and archive or delete it.
   If yes, fully repair it before it remains wired into `src/core/orchestrator.mjs`.

2. Eliminate references to undefined agents or broken cleanup behavior.
   The repo must not call agent names that do not exist in `opencode.json`.

3. Make the live WFA boundary unambiguous.
   The real live evidence path must clearly center on `walk forward engine/`.
   Any other WFA-like surface that remains must be clearly labeled as one of:
   - simulate-only
   - test-only
   - archived historical code

4. Review active init/smoke/simulate paths and remove legacy defaults that conflict with the real loop doctrine.

5. Keep historical evidence, but move inactive or superseded runtime doctrine/docs into obvious archival locations when needed.

### Files likely to change

- `src/core/orchestrator.mjs`
- `src/core/cleanup/`
- `opencode.json`
- `src/core/init.mjs`
- `src/core/runner-simulate.mjs`
- `scripts/`
- docs that still act like active runtime truth

### Acceptance criteria

- no stale or broken subsystem remains wired into the active orchestrator path
- no undefined subagent name is referenced by active runtime code
- the live WFA execution boundary is obvious and singular
- old helper paths that remain are clearly non-canonical

---

## Workstream D - Repo Structure And Docs Cleanup

### Objective

Make the repo root and operator-facing docs look intentional.

### Exact tasks

1. Remove junk and malformed root entries that are not legitimate project assets.

2. Remove committed cache artifacts such as `__pycache__` trees.
   If ignore rules are missing, add or tighten them.

3. Remove or repurpose empty top-level directories that no longer belong to the current structure.

4. Update `README.md` so it reflects the current loop and control plane.
   It must clearly describe:
   - `ideator -> planner -> executor -> evaluator -> summarizer`
   - orchestrator-owned official state
   - live evidence through the real `walk forward engine/`
   - simulate mode as non-evidentiary

5. Remove conflicting top-level guidance that still teaches the older planner-only loop or the wrong execution surface.
   Prefer archive over silent deletion when the file has historical value.

### Files likely to change

- `README.md`
- root-level junk files/directories
- ignore files if needed
- any outdated top-level helper scripts or docs

### Acceptance criteria

- repo root no longer contains obvious junk or malformed entries
- committed cache directories are gone
- top-level docs match the actual architecture and runtime boundary
- no conflicting operator guidance remains in active top-level docs

---

## Workstream E - Final Tight-Loop Verification

### Objective

Prove the loop is tighter in practice, not only cleaner in source.

### Exact tasks

1. Run targeted tests or validation commands for the touched control-plane modules.

2. Rebuild all official derived artifacts touched by this pass.
   At minimum, rebuild or re-derive as applicable:
   - leaderboard
   - health
   - any canonicalized state/evidence views changed by the implementation

3. Execute one controlled orchestrator run or resume pass.
   Use low blast radius:
   - low cycle count
   - no browser auto-open
   - observe resulting artifact writes directly

4. Verify the resulting on-disk truth for the latest run.
   Cross-check:
   - `factory/state.json`
   - `factory/backlog.json`
   - `factory/evidence/index.json`
   - `factory/leaderboard.json`
   - `factory/health.json`
   - latest `factory/runs/<run_id>/`
   - latest `factory/summaries/<run_id>.md`

5. Write one short closeout note under `factory/` summarizing what was tightened and any remaining non-blocking watch items.

### Acceptance criteria

- one controlled post-cleanup run exists on disk
- official state files agree with each other for the latest run
- no stale cleanup path, schema drift, or duplicate run truth remains active
- the repo is visibly cleaner and the active runtime boundary is easier to understand

## 6. Execution Order

Execute the workstreams in this exact order:

1. Workstream A
2. Workstream B
3. Workstream C
4. Workstream D
5. Workstream E

Do not start new strategy research work until this tightening pass is closed or explicitly paused.

## 7. Definition Of Done

This spec is only considered satisfied when all of the following are true:

- the repo has one clear canonical latest live run truth
- the orchestrator path is not calling stale or broken subsystems
- transport/recovery behavior is more explicit and leaves cleaner artifacts
- the root structure and active docs no longer advertise outdated architecture
- historical evidence remains preserved, but active runtime truth is no longer ambiguous

# Final Acceptance Sweep

Date: 2026-03-25
Scope: hard acceptance criteria from `factory/long-term-loop-architecture-spec.md:947-959`
Status: historical record only; non-certifying

## Historical Notice

This document is preserved as a historical snapshot of an earlier acceptance pass.

It does not certify current endless-live readiness.
Current certification requires fresh machine-written verification artifacts under `factory/verification/` produced by the active implementation tracked in `factory/tasks.md` and `factory/bulletproof-endless-live-finalization-spec.md`.
The current repo now writes machine-backed artifacts such as `verification-manifest-*.json`, `rollout-gate-*.json`, `transport-bakeoff-*.json`, and `fault-drills-*.json`; this markdown file is not one of them.

## Result

This historical pass reflected the repo state at the time it was written.

It must not be read as proof that the current loop is ready for controlled live operation or endless-live operation.

## Evidence By Criterion

1. One active architecture spec only — pass
- Active north-star remains `factory/long-term-loop-architecture-spec.md`
- `factory/live-readiness-closeout-spec.md` is explicitly marked as a closed subordinate checklist, not an active architecture spec

2. One tiny runtime invariant file only — pass
- `src/prompts/runtime-invariants.md`

3. No runtime overlap between shared doctrine, role contracts, and capsules — pass
- `src/prompts/runtime-invariants.md`
- `src/prompts/executor.md`
- `src/core/prompt-builders.mjs`

4. Each stage gets a fresh session — pass
- `src/core/runner-opencode.mjs`
- `src/core/runner-simulate.mjs`
- `factory/health.json`

5. Planner and ideator are separate — pass
- `src/prompts/ideator.md`
- `src/prompts/planner.md`
- `opencode.json`
- `src/core/orchestrator.mjs`

6. Executor success requires real WFA artifacts — pass
- `src/prompts/runtime-invariants.md`
- `src/core/orchestrator.mjs`

7. Infra failures do not retire research ideas — pass
- `src/core/backlog-store.mjs`
- `src/core/orchestrator.mjs`

8. One-time handoff notes do not leak beyond the resumed stage — pass
- `src/core/orchestrator.mjs`

9. Memory validates cleanly — pass
- `factory/health.json`
- `factory/memory/quarantine/`
- `src/core/memory-index.mjs`

10. Leaderboard contains only real promotable evidence — pass
- `factory/leaderboard.json`
- `src/core/memory-index.mjs`
- `src/core/validators.mjs`

11. No hidden asset narrowing in active helpers or constants — pass
- `src/core/constants.mjs`
- `src/core/runner-simulate.mjs`
- `src/core/market-policy.mjs`
- `factory/market-policy.json`

## Verification Performed

- Test suite passed with Windows Node/npm: 25/25
- Official artifact rebuilds executed for backlog, memory, leaderboard, and health
- Independent review subagent rechecked the hard acceptance criteria and found no remaining genuine blockers

## Official Artifact State

- `factory/backlog.json` is canonicalized
- `factory/evidence/index.json` is normalized
- `factory/leaderboard.json` is clean and contains no simulate pollution
- `factory/memory/lessons.jsonl` is canonicalized
- `factory/memory/retrieval_index.json` is derived and normalized
- `factory/health.json` exists and is populated
- inactive prompt doctrine has been archived under `docs/archive/prompts/`

## Non-Blocking Watch Items

These are not acceptance blockers, but should be watched during the first controlled live run:

- historical transport instability in live OpenCode execution remains an operational risk to monitor
- leaderboard is currently empty, which is acceptable because no current evidence qualifies for strict promotion
- `factory/health.json` currently shows some stranded leases from historical state; this is observable telemetry, not an acceptance failure

## Historical Recommendation

The guidance below is retained as historical operator context only.

Recommended first live run posture at the time:
- mode: `live`
- low cycle count
- watch `factory/health.json`, `factory/runs/`, and `factory/state.json`
- treat the first live pass as production-like validation of transport, control-plane recovery, and real WFA execution

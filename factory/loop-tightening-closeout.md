# Loop Tightening Closeout

Date: 2026-03-31
Parent spec: `factory/loop-tightening-spec.md`
Status: historical record only; non-certifying

## Historical Notice

This closeout captures what was tightened during that pass.

It does not certify current endless-live readiness or controlled live readiness.
Fresh certification must come from machine-written verification artifacts under `factory/verification/`, not from this markdown file.
Current repo truth is carried by machine-written artifacts such as `verification-manifest-*.json`, `rollout-gate-*.json`, `transport-bakeoff-*.json`, and `fault-drills-*.json`.

## What Was Tightened

- removed the stale active cleanup subsystem from the orchestrator runtime path
- normalized leaderboard handling to one canonical on-disk array format
- fixed the OpenCode runner to stop reusing a short-timeout probe client for agent calls
- added persisted-plan reuse on planner resume so valid plans do not get regenerated unnecessarily
- reconciled the canonical live SOL evidence around `RUN-20260325105657-01`
- rebuilt normalized memory and health artifacts from the cleaned official state
- cleaned root junk, removed empty placeholder directories, and added a root `.gitignore`
- updated `README.md` and `scripts/smoke-test.mjs` to point at the real `walk forward engine/` boundary

## Verification

- `npm run validate`
- `npm test`
- `npm run smoke`

All three passed during that tightening pass.

## Remaining Watch Items

- transport reliability is still the main operational risk in real live runs
- historical stranded lease count remains visible in `factory/health.json`
- `wfa/` still exists as older/reference engine code, but is no longer described as the canonical live path

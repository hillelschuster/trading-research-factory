# Autonomous Trading Research Factory

This repo is an OpenCode-driven research factory for discovering robust trading strategies through real walk-forward analysis.

The active loop is:

`ideator -> planner -> executor -> evaluator -> summarizer`

## What Is Canonical

- Official control-plane state lives under `factory/`.
- The orchestrator owns official state files such as `factory/state.json`, `factory/backlog.json`, `factory/evidence/index.json`, `factory/leaderboard.json`, and `factory/health.json`.
- Real live research evidence comes from the real engine in `walk forward engine/`.
- Simulate mode is only orchestration verification. It is not trading evidence.

## Modes

### Simulate mode

Use this to validate loop mechanics and artifact flow without provider credentials.

```bash
npm run simulate -- --cycles 1 --interval-ms 1
```

### Live mode

Use this when OpenCode is configured with working provider credentials.

Pass `--root` as the literal repo root. Equivalent Windows aliases are normalized to the canonical WSL-visible repo path only when they resolve to the same repo.

```bash
npm run run -- --mode live --cycles 1 --interval-ms 1 --no-open-browser
```

### Observer

The stable observer entrypoint is `http://127.0.0.1:<observer-port>/follow`.

Default observer port: `4310`

CLI surfaces:

```bash
node src/cli.mjs status
node src/cli.mjs follow
```

Second live process behavior:

- if a healthy live owner already exists, the second process enters observer-only mode instead of mutating backlog or runtime truth

## Quick Verification

```bash
npm run validate
npm test
npm run smoke
```

`npm run smoke` validates the repo structure, runs one simulate cycle, and validates a canonical WFA config in `walk forward engine/`.

Both `npm run validate` and `npm run smoke` now also require machine-written verification artifacts under `factory/verification/`.

Verification artifacts include:

- `verification-manifest-*.json`
- `rollout-gate-*.json`
- `transport-bakeoff-*.json`
- `fault-drills-*.json`
- `state-migration-report-*.json`

Rollout gate entrypoints:

```bash
npm run gate:0
npm run gate:1
npm run gate:2
npm run gate:3
npm run gate:4
```

These commands execute the gate and then write a fresh `rollout-gate-*.json` plus linked `verification-manifest-*.json` under `factory/verification/`.

## Real WFA Path

The live evidence boundary is the real walk-forward engine:

```bash
cd "walk forward engine"
.venv\Scripts\python.exe scripts/walk_forward_smoke_test.py --config strategies/<name>/wfa_config.yaml
```

From WSL, this Windows venv path is the canonical launcher when available.

## Layout

- `src/` - orchestrator, runners, validators, prompts, control-plane helpers
- `factory/` - official persistent state, evidence, runs, summaries, memory, specs
- `workspace/` - working data and reusable research workspace assets
- `walk forward engine/` - canonical live WFA engine
- `scripts/` - validation and smoke helpers
- `tests/` - automated control-plane tests
- `docs/` - archived or supporting documentation

## Notes On Legacy Surfaces

- `wfa/` is retained as older/reference engine code, not the canonical live evidence path.
- `workspace/harness/` may still exist for historical or local utility reasons, but it is not the primary live evidence path.
- `.opencode/` is the tooling sandbox. It is gitignored and does not count as research evidence, retrieval input, or changed-file evidence.
- `factory/active-session.json` is now a compatibility mirror for operator visibility only. Control decisions use `factory/runtime/active-run.json` and `factory/runtime/owner-lock.json`.
- Operational artifacts are bounded: `factory/runtime/recovery-log.jsonl` is trimmed to recent lines, and `factory/verification/` keeps only the newest files per operational prefix. Durable research evidence is not deleted by this retention policy.

## Operating Rules

- Missing artifacts never count as success.
- `executed` only means a real WFA run produced real output artifacts.
- Historical evidence should be preserved, but active runtime truth should stay singular and explicit.

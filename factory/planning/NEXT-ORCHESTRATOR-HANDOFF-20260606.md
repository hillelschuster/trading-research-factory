# Next Orchestrator Handoff — 2026-06-06

Purpose: compact clean-slate handoff for the next orchestrator. This is a planning/assessment artifact only. No deletion, WFA, MT5/MQL5, Phase 8E, or official state mutation was performed while creating it.

## Executive Verdict

The deep audit is accurate.

The factory is not failing because Phase 8D found zero survivors. It is behaving correctly: real WFA screens ran, evidence was captured, and strict gates rejected weak strategies. The true bottleneck is that the replacement for manual roulette — bounded ResearchBrain Stage-0 discovery through the runtime ledger — is implemented and tested but has not been operationally flown through seed -> loop -> outbox -> diagnostics -> readiness in this repo state.

Immediate priority: run one bounded ResearchBrain Stage-0 supervisor canary from an existing valid request artifact, with report artifacts enabled, then inspect real disk artifacts and readiness. This is not Phase 8E and not strategy screening; it is operating the research-discovery machinery.

## Confirmed Phase State

- Phases 0 through 8D: closed.
- Phase 8E: blocked and not started.
- Phase 9/10: not started.
- Phase 8E preconditions remain unsatisfied:
  1. no Phase 8D survivor,
  2. no verified MT5 instrument equivalence for a survivor candidate,
  3. no explicit disk-backed operator authorization.

Do not start MT5/MQL5/parity/deployment work.

## Phase 8D Screening Reality

- 19 total Phase 8D runs.
- 12 produced real WFA metrics.
- All 12 were denied by promotion gates.
- Best observed return was about +1.31%, below the 5% floor.
- Best positive-window ratio was about 45.6%, below the 70% clean route.
- The last manual BTC weekly-calendar screen had only 12 trades and negative/weak metrics.

Interpretation: the WFA execution pipeline worked; the strategies did not show robust edges. Manual Phase 8D roulette must remain stopped. Do not tune/rerun failed hypotheses unless there is genuinely new independent source-backed Stage-0 research.

## ResearchBrain Stage-0 State

Implemented/tested components include:

- `src/core/researchbrain-runtime.mjs`
- `src/core/researchbrain-agent.mjs`
- `src/core/researchbrain-tools.mjs`
- `src/core/researchbrain-artifacts.mjs`
- `src/core/researchbrain-loop-runner.mjs`
- `src/core/researchbrain-stage0-supervisor.mjs`
- `src/core/researchbrain-stage0-diagnostics.mjs`
- `src/core/researchbrain-stage0-readiness.mjs`
- Stage-0 CLIs under `scripts/run-researchbrain-stage0-*.mjs`

Recent reliability additions include:

- bounded supervisor cycles `1-25`,
- stale-lease reclaim metadata,
- outbox projections,
- terminal failure reconciliation,
- projection recovery diagnostics,
- runtime ledger consistency checks,
- stage-classified failure envelopes,
- non-authoritative run/failure reports,
- report metadata and post-write consistency checks,
- top-level diagnostic-only `next_action`, `recommendation`, `supervisor_health`, `operational_summary`, and `report_artifact_summary`.

Latest focused verification before this handoff:

- `rtk node --test tests/researchbrain-stage0-supervisor.test.mjs` passed `18/18`.
- `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed `47/47`.
- `rtk npm run validate` passed.
- Full `npm test` was not run.

## Current Runtime/Readiness Snapshot

Read-only diagnostics/readiness run during this handoff:

- `rtk npm run researchbrain:stage0-diagnostics`
  - status: `ok`
  - jobs: `0 total`, `0 queued`, `0 claimed`, `0 blocked`, `0 poisoned`, `0 stage0_ready`
  - outbox: `0 pending`, `0 processed`
  - projections: `0 files`
  - official mutation flags: false

- `rtk npm run researchbrain:stage0-readiness`
  - status: `attention`
  - only attention reason: `unseeded_valid_request_artifacts`
  - requests scanned: 3
  - valid requests: 3
  - seeded requests: 0
  - unseeded valid requests: 3
  - runtime consistency: `ok`
  - terminal failure reconciliation: `none`

Current valid unseeded request artifacts:

1. `factory/research/requests/RESEARCHBRAIN-REQUEST-20260520T0718Z/request.json`
   - SHA: `79533f9fc62a39af0a1ca0030fbf39ec6fc1311ad54319dc107eb6f678ecd8cd`
2. `factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-CANARY-20260523T124500Z/request.json`
   - SHA: `63df80daaf110c6a1da26ba30a207671f005536ec4fb479f1a5fa7e78b44b75b`
3. `factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-OFI-CANARY-20260523T135000Z/request.json`
   - SHA: `8a46e46b9cde56b47177669bdfb44a891015f8cbd1a7f635f912003beb38624b`

## Recommended Immediate Canary

Use the OFI live-canary request first because it is narrow and production-like: `max_sources: 2`, `max_hypotheses: 1`, explicit order-flow imbalance mechanism, Phase 8A references, prior lessons, and strict Stage-0 non-authority constraints.

Recommended fixture-mode pipeline proof:

```bash
rtk npm run researchbrain:stage0-supervisor -- \
  --request-path factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-OFI-CANARY-20260523T135000Z/request.json \
  --request-sha256 8a46e46b9cde56b47177669bdfb44a891015f8cbd1a7f635f912003beb38624b \
  --cycles 5 \
  --max-jobs 1 \
  --run-report-dir factory/verification/researchbrain-stage0-supervisor-runs \
  --failure-report-dir factory/verification/researchbrain-stage0-supervisor-failures
```

Important qualification: default `--provider-mode valid` uses the deterministic fixture provider and should not require live LLM/search credentials. This is appropriate for proving the ledger/supervisor pipeline. A later live-provider canary is separate and should be explicit.

Success criteria for this canary:

- process exit code 0,
- JSON `status` is `completed` or a clearly understood non-actionable/drainable state,
- `seed.status` is `seeded` or idempotently `already_seeded`,
- loop processes at least one Stage-0 job for a fresh seed,
- outbox processes the finished event,
- `readiness_summary.runtime_consistency.status` is `ok`,
- report artifact path exists and `consistency.verified === true`,
- all authority flags remain false:
  - `official_state_mutated: false`,
  - `official_evidence_index_mutated: false`,
  - `official_backlog_mutated: false`,
  - `official_leaderboard_mutated: false`,
  - `wfa_executed: false`,
  - `mt5_executed: false`,
  - `phase8e_started: false`.

After the canary, run:

```bash
rtk npm run researchbrain:stage0-readiness -- \
  --request-limit 10 \
  --projection-limit 10 \
  --processed-outbox-limit 10
```

Blocked/inconclusive criteria:

- exit code 1 or 2,
- `status: "failed"`,
- actionable attention not classified as drainable,
- report artifact missing or inconsistent,
- stale/request SHA/projection/runtime consistency drift.

Do not fake success. If blocked, record the exact stage/reason and fix the blocker with focused tests.

## Cleanup Planning Only

A read-only cleanup planner found real clutter, but no deletion was performed and none should be performed without a manifest-first pass.

Likely cleanup candidates after operator approval:

- old pre-Phase8D `factory/runs/`, `factory/summaries/`, `factory/experiments/`,
- duplicate Phase 8D retry attempts where the later repaired run is canonical,
- old verification artifacts where only latest per type is needed,
- Python `__pycache__/`,
- stale root-level markdown superseded by the active spec,
- `walk forward engine/results/` legacy outputs,
- parts of `workspace/` if confirmed deprecated,
- prediction-market/Polymarket leftovers, since they are outside current MT5/FTMO scope,
- possibly `walk forward engine/logs/` only after operator confirmation because it is large and may contain optimizer/debug traces.

Never delete without explicit policy:

- `factory/mt5-ftmo-strategy-factory-spec.md`,
- `factory/state.json`, `factory/backlog.json`, `factory/leaderboard.json`, `factory/evidence/index.json`,
- `factory/runtime/`,
- `factory/memory/`,
- latest Phase 8D denial evidence, summaries, candidate packets, and gate artifacts,
- `src/`, `scripts/`, active prompts, workers,
- canonical WFA engine code/config/data under `walk forward engine/`, especially `walk forward engine/data/` and `.venv/`.

Recommended cleanup sequence for a future agent:

1. Create a cleanup manifest only under `factory/cleanup/` with path, size, hash, mtime, category, and proposed action.
2. No deletion in the first pass.
3. Separate categories into `safe_low_risk`, `requires_operator_confirmation`, and `never_delete`.
4. Validate references before any future cleanup action.
5. If deletion/archive is later authorized, run focused tests and `rtk npm run validate` afterward.

## Does More Research Need To Be Done Before The Canary?

No further research is needed before the fixture-mode supervisor canary.

The uncertainty is operational, not conceptual:

- Can the real ledger/supervisor path seed and drain a valid request in this working tree?
- Do outbox projections and report artifacts appear exactly as expected?
- Does readiness become clean or produce a concrete blocker?

Those questions require running the bounded canary, not more analysis.

More research should happen after the machinery flies:

1. live-provider ResearchBrain canary with explicit env/credential assumptions,
2. source-quality hardening for Stage-0 packets,
3. duplicate/rejected-pattern memory improvements,
4. data-readiness toward MT5-equivalent symbols beyond current EURUSD/XAUUSD/BTC proxies,
5. backlog curation/cleanup manifest.

## Boundaries For Next Agent

- Do not inspect or use git status/diff/log.
- Do not revert unrelated changes.
- Do not delete, move, or archive files unless explicitly asked; cleanup is planning-only unless authorized.
- Do not start Phase 8E.
- Do not run MT5/MQL5/parity/deployment.
- Do not run manual Phase 8D strategy roulette.
- Do not loosen survivor gates.
- Do not give ResearchBrain WFA/MT5/promotion authority.
- Do not mutate official state/evidence/backlog/leaderboard/memory from ResearchBrain.
- Do not claim success without verified disk artifacts.

## Prompt For The Next Orchestrator

```text
Continue `trading-research-factory` from the post-Phase-8D ResearchBrain reliability state.

Critical rules:
- Do not inspect or use git status/diff/log.
- Do not revert unrelated changes.
- Stay inside this repository except approved MT5 paths from AGENTS.md.
- Phase 8A, 8B, 8C, and 8D are closed.
- Phase 8E remains blocked. Do not start MT5/MQL5/parity/deployment.
- Manual Phase 8D produced zero survivors; this is normal. Do not continue manual strategy roulette, loosen gates, or force survivors.
- ResearchBrain remains Stage-0 only and must not mutate official state/evidence/backlog/leaderboard/memory.
- WFA remains deterministic-worker-only.
- Never claim success without real artifacts/tests that exist on disk.

Professional standard:
- Use Context7 before coding work:
  1. `context7_resolve-library-id`
  2. `context7_query-docs`
- Read relevant files first.
- Make significant, coherent operational progress; avoid cosmetic micro-edits.
- Update `factory/mt5-ftmo-strategy-factory-spec.md` when behavior changes.
- Add focused tests proportional to any source change.
- Run relevant focused tests.
- Run `rtk npm run validate` if source/spec/CLI/package behavior changes.
- Record durable memory only after verification.

Current state:
- Stage-0 diagnostics are clean: 0 jobs, 0 outbox events, 0 projections, runtime consistency ok.
- Readiness is attention only because 3 valid request artifacts are unseeded.
- Best immediate canary request:
  `factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-OFI-CANARY-20260523T135000Z/request.json`
  SHA: `8a46e46b9cde56b47177669bdfb44a891015f8cbd1a7f635f912003beb38624b`
- Supervisor outputs now include diagnostic-only `next_action`, `recommendation`, `supervisor_health`, `operational_summary`, `report_artifact_summary`, failure envelopes, and verified run/failure report artifacts.

Immediate task:
Run a bounded fixture-mode Stage-0 supervisor canary through the real runtime ledger and report artifacts:

`rtk npm run researchbrain:stage0-supervisor -- --request-path factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-OFI-CANARY-20260523T135000Z/request.json --request-sha256 8a46e46b9cde56b47177669bdfb44a891015f8cbd1a7f635f912003beb38624b --cycles 5 --max-jobs 1 --run-report-dir factory/verification/researchbrain-stage0-supervisor-runs --failure-report-dir factory/verification/researchbrain-stage0-supervisor-failures`

Then run read-only cross-check:

`rtk npm run researchbrain:stage0-readiness -- --request-limit 10 --projection-limit 10 --processed-outbox-limit 10`

Judge success by actual JSON and disk artifacts:
- supervisor result status/health,
- seeded/already_seeded state,
- loop jobs processed,
- outbox events processed,
- report artifact path exists and `consistency.verified === true`,
- readiness runtime consistency ok,
- official mutation/WFA/MT5/Phase8E flags false.

If the canary blocks, fix the exact blocker with focused tests. If it succeeds, next substantial directions are: live-provider canary planning, source-quality/intake hardening, cleanup manifest planning under `factory/cleanup/`, and data-readiness toward MT5-equivalent symbols. Do not delete files unless explicitly authorized.

Return final answer with concrete commands run, pass/fail results, artifact paths created, and explicit statement that Phase 8E/WFA/MT5 were not started.
```

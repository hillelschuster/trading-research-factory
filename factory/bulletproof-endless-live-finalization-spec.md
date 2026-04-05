# Bulletproof Endless Live Finalization Spec

Date: 2026-04-01
Status: proposed active subordinate implementation spec
Parent spec: `factory/long-term-loop-architecture-spec.md`

Supersedes as the active implementation target:
- `factory/loop-tightening-spec.md`
- `factory/live-readiness-closeout-spec.md`

Historical only after this spec is accepted and implemented:
- `factory/final-acceptance-sweep.md`
- `factory/loop-tightening-closeout.md`

## 1. Purpose

This is not a new architecture spec.

It is the implementation-grade closure spec for making the current factory safe to run endlessly in live mode without known critical-path holes in:
- transport reliability
- session visibility
- process ownership and resume
- root/path/plugin isolation
- prompt budget and retrieval hygiene
- gate enforcement and false-pass prevention
- repo cleanliness and operator trust

The goal is not to promise literal zero bugs.

The goal is to remove all known structural holes large enough to make endless live operation unsafe, misleading, or non-durable.

If that requires replacing the current OpenCode SDK client path, this spec allows it.

## 2. Why This Spec Exists

The repo already went through a tightening pass, but the current live system still exhibits unresolved critical-path failures.

Fresh evidence:
1. Repeated executor header timeouts still break live runs.
   - `factory/runs/RUN-20260401061737-jfxpvk/run.log:3-21`
   - `factory/live-run-console.log:13-56`
2. Browser auto-open does not reliably show the human the actual running work.
   - `src/core/runner-opencode.mjs:202-215`
   - `factory/long-term-loop-architecture-spec.md:253-259`
3. Malformed symbol-named root directories can still reappear during live launches.
   - `src/core/runner-opencode.mjs:47-63`
   - `src/core/runner-opencode.mjs:135-146`
4. Existing-server reuse bypasses important runtime hardening.
   - `src/core/runner-opencode.mjs:135-146`
5. Prompt/retrieval hygiene is still weak enough to inflate executor prompts with internal diagnostic artifact paths.
   - `src/core/memory-index.mjs:532-580`
   - `src/core/retrieval.mjs:201-257`
   - `src/core/prompt-builders.mjs:222-236`
   - `factory/runs/RUN-20260401061737-jfxpvk/executor-attempt-1/stage-input.json:194-345`
6. The repo has produced pass/closeout docs that were directionally useful but not strong enough to certify endless live readiness.
   - `factory/final-acceptance-sweep.md:5-11`
   - `factory/loop-tightening-closeout.md:25-29`

This spec exists to close those holes fully enough that the loop can be treated as a real service rather than a promising prototype.

## 3. End State

When this spec is satisfied, the factory should behave like this:

1. A live run starts under one canonical project root identity.
2. One owner process holds an explicit runtime lock.
3. One canonical active-run record tells the truth about what is running.
4. The transport layer is owned by the repo, observable, and replaceable.
5. The user gets one stable localhost follow surface that points to the real active run.
6. Retries and resumes preserve run identity and monotonic stage attempt history.
7. Internal diagnostic artifacts do not get fed back into executor prompts.
8. Plugins and tooling cannot spray malformed directories into repo root.
9. False `executed`, false `verified`, and false `pass` claims are mechanically hard.
10. Endless mode can survive interruption, transport instability, and poisoned runs without manual surgery.

Current implementation progress now includes machine-written verification manifests, rollout gates, transport bakeoff artifacts, fault-drill artifacts, and bounded operational retention under `factory/verification/` and `factory/runtime/`.

## 4. Non-Negotiable Rules

1. No live path may silently rewrite `--root` or infer a project root by substring matching.
2. No live path may attach to an existing localhost server solely because a probe succeeded on port `4096`.
3. No plugin is allowed in live mode unless it is explicitly allowlisted and sandboxed.
4. No top-level repo writes are allowed outside:
   - tracked source/docs/config
   - official `factory/` artifacts
   - official workspace/WFA outputs
   - one declared tooling sandbox
5. No derived file may act as canonical machine truth if its source of truth exists elsewhere.
6. No stage attempt ordinal may be reused within the lifetime of a `run_id`.
7. No executor retrieval payload may include internal diagnostic artifact paths such as:
   - `stage-input.json`
   - `stage-prompt.txt`
   - `stage-response.raw.txt`
   - `stage-error.json`
   - `*-session.json`
   - `handoff.json`
8. No closeout or pass document may claim success without fresh machine-readable verification artifacts written by this implementation.
9. Endless mode must not hammer one poisoned run forever.
10. If the current OpenCode SDK boundary cannot meet the acceptance gates, it must be replaced rather than defended by prose.

## 5. Canonical Terms

1. `run_id`
   - Immutable research-run identity.
2. `run_instance_id`
   - One ownership instance of a `run_id` under one process lifecycle.
3. `stage_attempt_ordinal`
   - Monotonic per-stage attempt count across retries and resumes for one `run_id`.
4. `owner_id`
   - Canonical runtime process owner identity for the current live factory service.
5. `active run`
   - The one run currently owned by the live service.
6. `follow URL`
   - Stable observer URL the user should open to watch the actual run.
7. `transport adapter`
   - Repo-local implementation that talks to the agent runtime.
8. `server manager`
   - Repo-local implementation that starts, validates, fingerprints, reuses, or tears down the OpenCode server.
9. `tooling sandbox`
   - One explicit root-owned directory for OpenCode/plugin/temp state.
10. `verification manifest`
   - Machine-readable artifact proving which gates passed, with exact evidence paths.

## 6. Verified Current Defects

1. Executor still fails at the transport boundary before structured output is returned.
   - `src/core/runner-opencode.mjs:228-264`
   - `factory/runs/RUN-20260401061737-jfxpvk/run.log:3-21`
2. Timeout mitigation is incomplete and partly opaque.
   - `opencode.json:8-13`
   - `src/core/runner-opencode.mjs:58-62`
   - `node_modules/@opencode-ai/sdk/dist/client.js:5-16`
3. Existing-server reuse defeats both plugin and timeout hardening.
   - `src/core/runner-opencode.mjs:135-146`
4. Browser-open behavior does not match the parent spec.
   - `factory/long-term-loop-architecture-spec.md:253-259`
   - `src/core/runner-opencode.mjs:207-214`
5. `--root` is still not treated literally.
   - `src/core/config.mjs:47-51`
6. Executor prompts are inflated by retrieval of internal run diagnostics.
   - `src/core/retrieval.mjs:251-257`
   - `factory/runs/RUN-20260401061737-jfxpvk/executor-attempt-1/stage-input.json:194-345`
7. Live truth is split across global state, active-session state, and per-run state.
   - `src/core/state-store.mjs:8-25`
   - `src/core/orchestrator.mjs:130-154`
   - `src/core/orchestrator.mjs:960-985`
8. Attempt numbering and artifact naming are not durable enough across resumes.
   - `src/core/orchestrator.mjs:235-289`
   - `src/core/orchestrator.mjs:923-939`
   - `src/core/artifact-store.mjs:20-30`
9. Endless mode can keep resuming the same poisoned run with poor recovery odds.
   - `factory/health.json:39-49`
10. Prior pass/closeout docs are not strong enough to certify endless live readiness.

## 7. Scope

In scope:
1. live transport boundary
2. server ownership/reuse policy
3. project root identity and repo write protection
4. plugin/tooling isolation
5. state, lock, resume, handoff, and endless-loop recovery
6. session visibility and observer UX
7. prompt/retrieval budget control
8. gate enforcement and verification chain
9. test expansion, failure injection, and soak validation
10. archival rules for obsolete closeout/pass docs

Out of scope unless they directly close a critical-path hole:
1. new strategies
2. new data sources
3. WFA-engine feature expansion unrelated to loop correctness
4. cosmetic refactors without reliability impact
5. speculative memory systems or external databases

## 8. Required New Control Surfaces

New canonical directories/files to add during implementation:
1. `factory/runtime/owner-lock.json`
2. `factory/runtime/active-run.json`
3. `factory/runtime/recovery-log.jsonl`
4. `factory/verification/verification-manifest-<stamp>.json`
5. `factory/verification/fault-drills-<stamp>.json`
6. `factory/verification/transport-bakeoff-<stamp>.json`
7. `factory/verification/rollout-gate-<stamp>.json`

Potential new modules:
1. `src/core/root-identity.mjs`
2. `src/core/runtime-lock.mjs`
3. `src/core/runtime-state.mjs`
4. `src/core/verification.mjs`
5. `src/core/fault-injection.mjs`
6. `src/core/transport/live-transport.mjs`
7. `src/core/transport/opencode-server-manager.mjs`
8. `src/core/transport/opencode-http-transport.mjs`
9. `src/core/transport/opencode-sdk-transport.mjs`
10. `src/observer/server.mjs`

## 9. Workstream A: Truth Reset And Historical Pass Invalidation

### Objective

Stop treating older pass/closeout prose as active certification of the current loop.

### Required Tasks

1. Mark this spec as the only active implementation target beneath the parent architecture spec.
2. Reclassify `factory/final-acceptance-sweep.md` as historical and non-certifying.
3. Reclassify `factory/loop-tightening-closeout.md` as historical and non-certifying.
4. Keep historical docs on disk, but remove any wording that implies current endless-live readiness.
5. Add a rule that no markdown closeout may claim `pass` unless it cites a fresh verification manifest from this implementation.
6. Add verification-manifest writing to runtime code rather than manual prose.
7. Add health metrics for false-pass prevention.
8. Add tests that fail when a closeout is attempted without fresh verification artifacts.

### Likely Files

1. `factory/final-acceptance-sweep.md`
2. `factory/loop-tightening-closeout.md`
3. `factory/live-readiness-closeout-spec.md`
4. `src/core/verification.mjs`
5. `src/core/health.mjs`
6. `tests/factory.test.mjs`

### Acceptance Criteria

1. No active doc in `factory/` claims endless-live readiness without fresh machine-backed evidence.
2. A final closeout is impossible to write from prose-only state.

## 10. Workstream B: Canonical Project Root Identity And Repo Write Protection

### Objective

Make project root identity literal, canonical, Unicode-safe, and immune to substring/path-alias mistakes.

### Required Tasks

1. Add a root resolver that returns:
   - input path
   - absolute path
   - real path
   - display path
   - platform style
   - aliases
   - fingerprint
   - sentinel checks
2. Remove substring-based root rewriting from `src/core/config.mjs:47-51`.
3. Treat `--root` literally.
4. Reject literal filesystem roots such as `/`, `C:\`, and UNC share roots.
5. Reject nonexistent or invalid roots before any init or write occurs.
6. Require sentinel verification against real repo files such as:
   - `package.json`
   - `opencode.json`
   - `src/cli.mjs`
   - `AGENTS.md`
7. Support Unicode and Hebrew path segments without slugging or ASCII fallback.
8. Normalize identity by canonical filesystem resolution, not by display-string heuristics.
9. Add containment checks before any file write.
10. Add explicit top-level write allowlist and deny all other new root-level directories.
11. Exclude tooling sandboxes and dependency caches from workspace snapshot diffs.
12. Update validation/smoke scripts to use canonical root resolution.

### Likely Files

1. `src/core/config.mjs`
2. `src/core/paths.mjs`
3. `src/core/init.mjs`
4. `src/core/artifact-store.mjs`
5. `src/core/fs-utils.mjs`
6. `src/cli.mjs`
7. `scripts/validate-structure.mjs`
8. `tests/factory.test.mjs`
9. `tests/root-identity.test.mjs`

### Acceptance Criteria

1. Passing a parent dir no longer silently creates `trading-research-factory` beneath it.
2. Passing `/` or equivalent fails before any writes.
3. WSL and Windows aliases resolve to one root identity when they point to the same repo.
4. Hebrew/Unicode path segments are preserved and supported.
5. No write escapes the canonical repo root.

## 11. Workstream C: Plugin And Tooling Isolation

### Objective

Stop plugins and external tooling from creating malformed root junk or hidden state outside one declared sandbox.

### Required Tasks

1. Define one tooling sandbox under the repo, and document it explicitly.
2. Default live mode to no plugins unless allowlisted.
3. Replace one-off string filtering of `opencode-agent-memory@0.2.0` with explicit plugin policy.
4. Ensure the effective live server config is built from policy, not inherited ad hoc from whatever server already exists.
5. Decide whether `.opencode/` remains the sandbox or is replaced by a more explicit runtime sandbox path.
6. Ignore the sandbox in `.gitignore` if it is not meant to be tracked.
7. Exclude the sandbox from artifact diffs, evidence snapshots, and changed-file promotion logic.
8. Add tests for:
   - plugin allowlist
   - unknown plugin rejection
   - no root junk creation during controlled launches
9. Add reproduction matrix for:
   - fresh managed server
   - reused managed server
   - plugin-enabled legacy server
   - mixed path aliases
10. If OpenCode cannot guarantee plugin isolation under the chosen transport/server model, disable plugins entirely for live mode.

### Likely Files

1. `opencode.json`
2. `src/core/runner-opencode.mjs`
3. `src/core/transport/opencode-server-manager.mjs`
4. `.gitignore`
5. `tests/factory.test.mjs`

### Acceptance Criteria

1. Live launches do not create malformed symbol-named directories in repo root.
2. Plugin policy is explicit and test-covered.
3. Tooling sandbox contents never count as research evidence.

## 12. Workstream D: Transport Ownership And Adapter Abstraction

### Objective

Own the transport boundary instead of delegating reliability to opaque SDK behavior.

### Required Tasks

1. Introduce a repo-local `LiveTransport` interface.
2. Split the current runner into:
   - server manager
   - transport adapter
   - session URL helper
3. Add explicit timeout buckets for:
   - server boot
   - probe
   - session creation
   - first headers
   - total request
   - shutdown
4. Add config fingerprinting for the effective live server config.
5. Allow existing-server reuse only when fingerprint and mode are proven compatible.
6. Implement raw HTTP transport against local OpenCode server endpoints as a first-class option.
7. Keep SDK transport only behind the same abstraction for comparison/migration.
8. Evaluate CLI-wrapper transport only if raw HTTP cannot satisfy the gates.
9. Emit machine-readable transport failure artifacts with phase classification.
10. Make transport replacement a supported implementation path, not an architectural failure.

### Required Decision Rule

The implementation must run a transport bakeoff and choose the default live adapter based on evidence.

Recommended default target unless disproven by evidence:
1. managed local OpenCode server
2. repo-owned raw HTTP transport
3. SDK adapter as temporary fallback only

### Likely Files

1. `src/core/orchestrator.mjs`
2. `src/core/runner-opencode.mjs`
3. `src/core/config.mjs`
4. `src/core/logger.mjs`
5. `src/core/health.mjs`
6. `src/core/transport/*`
7. `tests/transport-*.test.mjs`

### Acceptance Criteria

1. No live path depends directly on SDK client behavior without passing through the repo-local transport interface.
2. Existing-server reuse is validated, not opportunistic.
3. Transport failures are phase-classified and reproducible.
4. At least one real live run completes through the chosen default adapter.

## 13. Workstream E: Session Policy, Follow Surface, And Browser UX

### Objective

Make localhost useful to the user by default.

### Required Tasks

1. Keep fresh session per stage attempt.
2. Add one stable observer follow URL owned by the repo.
3. Make the browser open the observer follow URL, not the raw stage session URL.
4. Open once per run by default, not once per retry.
5. Default trigger for auto-open:
   - when a live run first enters executor
6. Keep raw OpenCode session URLs as debug links on the observer page.
7. Make the observer show:
   - run id
   - backlog item
   - current stage
   - monotonic attempt ordinal
   - current session link
   - latest heartbeat age
   - latest error/retry note
   - latest artifact links
   - latest log tail
8. Update CLI/status output to print:
   - follow URL
   - raw session URL when available
   - current stage
   - ownership status
9. Remove the assumption that a raw session URL equals the thing the operator most wants to see.
10. Make `factory/active-session.json` deprecated as authoritative truth.

### Likely Files

1. `src/core/runner-opencode.mjs`
2. `src/core/orchestrator.mjs`
3. `src/core/state-store.mjs`
4. `src/cli.mjs`
5. `src/observer/*`
6. `tests/factory.test.mjs`

### Acceptance Criteria

1. One stable browser tab follows the real active run.
2. Retries do not spam new tabs.
3. The operator can always click from the follow surface to the raw current session.

## 14. Workstream F: Ownership, Locking, Resume, And Endless-Loop Recovery

### Objective

Make endless live operation deterministic, restartable, and non-split-brain.

### Required Tasks

1. Add `owner-lock.json` with heartbeat and takeover semantics.
2. Add `active-run.json` as the one canonical global live control-plane record.
3. Expand per-run `run-state.json` to own:
   - current owner id
   - current run instance id
   - monotonic stage attempt ordinals
   - current stage session pointer
   - last completed stage
   - failure class
   - resume generation
4. Separate process ownership from backlog disposition.
5. Make stale recovery depend on heartbeat TTL, not `state.last_status === "running"`.
6. Make handoff single-use and atomically consumed.
7. Make stage attempt ordinals monotonic across resumes.
8. Stop overwriting prior `*-attempt-*` session artifacts on resume.
9. Add endless-loop guardrails:
   - repeated same-stage same-failure-class counter
   - cooldown policy
   - poisoned-run quarantine
   - move-on policy for endless service
10. Make second live process startup fail cleanly or enter observer mode when owner lock is fresh.

### Likely Files

1. `src/core/orchestrator.mjs`
2. `src/core/backlog-store.mjs`
3. `src/core/state-store.mjs`
4. `src/core/runtime-lock.mjs`
5. `src/core/runtime-state.mjs`
6. `src/core/logger.mjs`
7. `tests/factory.test.mjs`

### Acceptance Criteria

1. Two orchestrators cannot both act as live owner.
2. Resume after interruption preserves `run_id` and increments attempt ordinals rather than resetting them.
3. Endless mode can stop hammering a poisoned run and continue service safely.

## 15. Workstream G: Prompt Budget, Retrieval Hygiene, And Memory Discipline

### Objective

Prevent the loop from poisoning itself with internal diagnostic context and oversized executor prompts.

### Required Tasks

1. Define allowed artifact-path categories for retrieval.
2. For executor retrieval, allow only evidence-bearing or decision-bearing artifacts such as:
   - plan files
   - summary files
   - final execution outputs
   - final evaluation outputs
   - final WFA artifacts
3. Explicitly ban internal diagnostic artifact paths from executor retrieval.
4. Trim `related_artifact_paths` at lesson creation time.
5. Trim `relevant_paths` at retrieval time even if legacy lessons still contain too much.
6. Add prompt byte budgets per stage, especially executor.
7. Make budget breaches visible in health and optionally fail in strict mode.
8. Keep retrieval compact and stage-specific.
9. Rebuild normalized memory/retrieval artifacts after hygiene changes.
10. Add tests proving internal diagnostic paths do not re-enter executor prompts.

### Likely Files

1. `src/core/memory-index.mjs`
2. `src/core/retrieval.mjs`
3. `src/core/prompt-builders.mjs`
4. `src/core/health.mjs`
5. `tests/factory.test.mjs`

### Acceptance Criteria

1. Executor prompts no longer include old `stage-*`, session, or handoff artifacts.
2. Prompt size budgets are explicit, observed, and test-covered.
3. Retrieval remains useful without becoming a diagnostic garbage chute.

## 16. Workstream H: Stage Gates And Anti-Fake Completion Enforcement

### Objective

Make false structured success harder than honest failure.

### Required Tasks

1. Tighten planner validation so plans cannot pass without:
   - explicit market/scope choice or rule
   - timeframe
   - history requirement
   - source plan
   - explicit success criteria
   - expected artifacts
2. Tighten evaluator validation so it cannot pass without exact artifact-linked verification.
3. Add actual file-existence checks for evaluator-cited artifacts.
4. Tighten summarizer validation so generic lessons/actions are rejected.
5. Keep executor executed-validation strict:
   - real artifacts on disk
   - non-null observed metrics
6. Add verification-manifest generation that records exactly which gates passed and why.
7. Add strict rejection of pass/closeout without fresh verification artifacts.

### Likely Files

1. `src/core/validators.mjs`
2. `src/core/orchestrator.mjs`
3. `src/core/verification.mjs`
4. `src/core/summary.mjs`
5. `tests/factory.test.mjs`

### Acceptance Criteria

1. Invalid planner/evaluator/summarizer payloads are machine-rejected.
2. `executed` without real evidence cannot survive validation.
3. Final closeout cannot be produced without a manifest and fresh evidence paths.

## 17. Workstream I: Health, Logging, And Observability Reform

### Objective

Make the operator and the code see the same truth.

### Required Tasks

1. Distinguish canonical live truth from derived health telemetry.
2. Keep `factory/state.json` as a summary pointer, not the only control truth.
3. Expand `factory/health.json` to report:
   - transport failures by adapter and phase
   - recovery rate by adapter and phase
   - poisoned-run quarantines
   - owner-lock takeovers
   - prompt budget breaches
   - false-pass prevention counters
4. Add structured recovery-log events.
5. Ensure every important transition is visible in both logs and machine state.
6. Add observer APIs backed only by on-disk truth.

### Likely Files

1. `src/core/health.mjs`
2. `src/core/logger.mjs`
3. `src/core/orchestrator.mjs`
4. `src/observer/*`
5. `tests/factory.test.mjs`

### Acceptance Criteria

1. Health is useful but no longer confused with canonical control-plane truth.
2. Recovery, takeover, retry, and quarantine events are all auditable.

## 18. Workstream J: Test Expansion, Fault Injection, And Reproduction Matrices

### Objective

Convert today’s anecdotes into a permanent regression net.

### Required Task Groups

1. Root/path tests
2. plugin/sandbox tests
3. transport adapter tests
4. existing-server reuse tests
5. session follow/browser UX tests
6. owner-lock and stale recovery tests
7. monotonic attempt-number tests
8. retrieval hygiene tests
9. evaluator artifact existence tests
10. summarizer specificity tests
11. false-executed tests
12. shutdown/resume tests
13. endless poisoned-run cooldown/quarantine tests

### Required Failure Drills

1. transport timeout before headers
2. transport disconnect after headers
3. session create succeeds, prompt hangs
4. browser opener fails
5. second orchestrator starts while first is healthy
6. owner process dies mid-executor
7. malformed evaluator verification path
8. generic summarizer output
9. executor claims executed without artifacts
10. sandbox/plugin attempts forbidden root write
11. mixed WSL/Windows alias root launch
12. literal root launch

### Acceptance Criteria

1. Every defect class named in this spec has at least one regression test or failure drill.
2. The test suite proves the new architecture, not just the old happy path.

## 19. Workstream K: Migration, Rollout Ladder, And Endless Soak Acceptance

### Objective

Roll out the new system in controlled gates rather than declaring success from source changes alone.

### Rollout Gates

1. Gate 0: source gate
   - `npm run validate`
   - `npm test`
   - `npm run smoke`
   - verification-manifest generation working in non-live path
2. Gate 1: simulated control-plane gate
   - one clean simulate run
   - no session reuse
   - no false promotion
3. Gate 2: failure-injection gate
   - all required failure drills produce the correct machine outcomes
4. Gate 3: controlled live gate
   - one low-cycle live run
   - real WFA output
   - stable follow URL
   - clean artifacts
5. Gate 4: bounded unattended live gate
   - at least 10 cycles or 4 continuous hours, whichever is longer
   - retries, resumes, and ownership all behave correctly
6. Gate 5: endless-live candidate soak gate
   - at least 25 cycles or 24 continuous hours, whichever is longer
   - at least 3 real runs reach executor completion with real WFA artifacts
   - the soak window proves the loop can stay alive without manual cleanup

### Endless-Live Acceptance Requirements

To declare endless live mode acceptable, all must be true within a fresh bounded soak window:
1. at least one real live WFA run completes successfully
2. no false `executed` claims occur
3. no false pass/closeout doc is written
4. no malformed root junk appears
5. no session-reuse contamination occurs
6. no split-brain owner condition occurs
7. no diagnostic artifact paths leak back into executor prompts
8. retries and resumes remain coherent on disk
9. the operator can reliably watch actual work from the follow surface
10. health metrics remain current and interpretable
11. no uncontrolled crash loop or same-item infinite retry loop occurs
12. at least 3 completed real live runs exist in the soak window with coherent end-to-end artifacts

### Closeout Rules

1. Final closeout is the last artifact written, not the artifact that proves success.
2. Final closeout must cite exact fresh artifact paths.
3. Final closeout must explicitly supersede older pass docs.
4. If any Gate 0-5 fails, the implementation remains open.

## 20. Execution Order

Execute in this order:

1. Workstream A
2. Workstream B
3. Workstream C
4. Workstream D
5. Workstream E
6. Workstream F
7. Workstream G
8. Workstream H
9. Workstream I
10. Workstream J
11. Workstream K

Do not return to open-ended strategy research until the live loop is structurally trustworthy again.

## 21. Required Reproduction Matrices

### Matrix A: Transport

Run and compare at minimum:
1. managed fresh server + SDK adapter
2. managed fresh server + raw HTTP adapter
3. validated reused server + SDK adapter
4. validated reused server + raw HTTP adapter
5. if needed, CLI wrapper transport under same scenarios

Measure:
1. session creation success rate
2. time to first headers
3. full stage completion rate
4. retry recovery rate
5. session URL correctness
6. effect on browser/follow UX

### Matrix B: Root Identity

Run and compare at minimum:
1. canonical WSL path
2. canonical Windows path alias
3. symlinked repo path
4. Hebrew/Unicode parent path
5. parent directory instead of repo root
6. literal root path

Measure:
1. root acceptance/rejection
2. sentinel verification
3. path alias unification
4. malformed directory creation

### Matrix C: Endless Recovery

Run and compare at minimum:
1. clean live run
2. SIGTERM during planner
3. SIGTERM during executor after session create
4. repeated transport failure on one run
5. second orchestrator start attempt during healthy ownership

Measure:
1. owner-lock behavior
2. handoff correctness
3. attempt ordinal continuity
4. follow URL continuity
5. poison-run cooldown/quarantine behavior

## 22. Files Likely To Change

Core runtime:
1. `src/core/orchestrator.mjs`
2. `src/core/runner-opencode.mjs`
3. `src/core/config.mjs`
4. `src/core/state-store.mjs`
5. `src/core/backlog-store.mjs`
6. `src/core/artifact-store.mjs`
7. `src/core/logger.mjs`
8. `src/core/health.mjs`
9. `src/core/validators.mjs`
10. `src/core/summary.mjs`
11. `src/core/memory-index.mjs`
12. `src/core/retrieval.mjs`
13. `src/core/prompt-builders.mjs`
14. `src/core/paths.mjs`
15. `src/core/init.mjs`
16. `src/cli.mjs`

New likely modules:
1. `src/core/root-identity.mjs`
2. `src/core/runtime-lock.mjs`
3. `src/core/runtime-state.mjs`
4. `src/core/verification.mjs`
5. `src/core/fault-injection.mjs`
6. `src/core/transport/*`
7. `src/observer/*`

Config/docs/tests:
1. `opencode.json`
2. `.gitignore`
3. `README.md`
4. `scripts/smoke-test.mjs`
5. `scripts/validate-structure.mjs`
6. `tests/factory.test.mjs`
7. new focused tests under `tests/`

## 23. Definition Of Done

This spec is satisfied only when all are true:

1. The live loop has one canonical root identity, one owner lock, one active-run truth, and one stable follow surface.
2. Live transport is repo-owned, test-covered, and can be replaced if the current adapter fails the gates.
3. Existing-server reuse is safe by proof, not assumption.
4. Malformed root junk no longer appears in controlled and soak-tested launches.
5. Executor prompt/retrieval hygiene is fixed enough that internal diagnostics do not bloat the stage prompt.
6. Stage validation and verification artifacts make false success materially harder.
7. Endless mode can survive interruption and poisoned runs without manual state surgery.
8. A fresh verification manifest, fresh rollout-gate artifacts, and a fresh final closeout exist on disk.
9. Older pass/closeout docs are clearly historical and no longer act as live certification.

## 24. Final Note

This implementation may involve dozens or hundreds of edits.

That is acceptable.

The count of tasks is not the success criterion.

The success criterion is that the repo can run live endlessly with honest evidence, coherent state, usable localhost visibility, and no known critical-path holes left open by design.

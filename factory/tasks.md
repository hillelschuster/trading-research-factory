# Factory Tasks

Status: active implementation plan  
Date: 2026-04-01  
Primary inputs:
- `factory/long-term-loop-architecture-spec.md`
- `factory/bulletproof-endless-live-finalization-spec.md`

## Purpose

This file converts the active specs into explicit implementation tasks.

It is intentionally practical:
- no guessing where the repo already gives the answer
- no extra layers unless they close a real defect
- no implementation step without a reason, touched files, and an acceptance check

## Locked Decisions

These decisions are fixed unless the user explicitly changes them.

1. Canonical live launch identity is the WSL repo path.
   Equivalent Windows alias inputs must be normalized to that canonical identity before runtime ownership starts.
   The implementation must preserve access from WSL to Windows-hosted dependencies such as `walk forward engine/.venv/Scripts/python.exe`.
2. Disable all OpenCode plugins in live mode by default.
3. If a second live process starts while a healthy owner already exists, default to observer-only mode.
4. Prompt budgets warn by default and hard-fail only in strict mode.

## Overengineering Bans

Do not build any of the following unless a later task proves they are required.

1. A second shared prompt layer or a replacement for `shared-context.md`
2. A transport plugin registry or generic runtime framework
3. A full dashboard product; the observer must stay minimal and file-backed
4. A distributed lock, server, or coordination system
5. Embeddings, vector DBs, graph memory, or new memory infrastructure
6. A second truth file for active run/session state
7. A CLI-wrapper transport unless the raw HTTP adapter fails the bakeoff
8. Strategy/data/WFA feature work unrelated to loop correctness

## Phase Order

Work in this order.

1. Phase 0: Truth Reset
2. Phase 1: Root Identity And Sandbox
3. Phase 2: Transport And Server Ownership
4. Phase 3: Runtime Truth And Endless Recovery
5. Phase 4: Observer UX And CLI Follow Surface
6. Phase 5: Prompt, Retrieval, And Validation Hardening
7. Phase 6: Health, Verification, And Test Net
8. Phase 7: Migration, Docs, And Derived Artifact Rebuild
9. Phase 8: Rollout Gates And Soak Acceptance

Do not start a later phase until the earlier phase acceptance checks are green.

## Phase 0: Truth Reset

### [x] T-000 Reclassify historical pass docs and block prose-only certification
Why: the repo cannot keep acting as if older closeout prose still certifies endless-live readiness while this implementation is open.
Files:
- `factory/final-acceptance-sweep.md`
- `factory/loop-tightening-closeout.md`
- `factory/live-readiness-closeout-spec.md`
- `scripts/validate-structure.mjs`
- `tests/closeout-docs.test.mjs` (new)
Depends on: none
Do:
1. Mark older pass/closeout docs as historical and non-certifying.
2. Add validation that fails when a prose-only pass claim exists without a fresh machine-written verification artifact.
Acceptance:
1. No active doc in `factory/` reads as current endless-live certification without fresh verification artifacts.
2. `validate` can fail on stale certifying prose before Gate 0 begins.

## Phase 1: Root Identity And Sandbox

### [x] T-001 Add canonical root resolver
Why: `src/core/config.mjs` currently rewrites `--root` by substring and can silently target the wrong folder.
Files:
- `src/core/config.mjs`
- `src/core/paths.mjs`
- `src/core/init.mjs`
- `src/core/fs-utils.mjs`
- `src/cli.mjs`
- `scripts/validate-structure.mjs`
- `tests/root-identity.test.mjs` (new)
- `tests/factory.test.mjs`
Depends on: none
Do:
1. Add one resolver that returns canonical root identity fields: input path, absolute path, real path, display path, aliases, fingerprint, sentinels.
2. Make all runtime path building consume canonical root identity rather than raw `rootDir` strings.
Acceptance:
1. Passing a valid repo root succeeds without mutation.
2. Passing a non-repo path fails before any directory creation.
3. The resolved root proves these sentinels exist: `package.json`, `opencode.json`, `src/cli.mjs`, `AGENTS.md`.
4. Resolver outputs preserve Unicode and Hebrew path segments without slugging or ASCII fallback.

### [x] T-002 Remove substring-based root rewriting
Why: `src/core/config.mjs:47-51` currently appends `trading-research-factory` when the substring is missing; this is explicitly forbidden.
Files:
- `src/core/config.mjs`
- `tests/root-identity.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-001`
Do:
1. Delete the auto-append behavior.
2. Treat `--root` literally in all commands.
Acceptance:
1. Passing a parent directory no longer creates `trading-research-factory` beneath it.
2. Existing simulate tests are updated to pass an explicit repo root instead of relying on auto-append.

### [x] T-003 Enforce canonical WSL live path while preserving Windows dependency access
Why: the least fragile live path is the WSL repo path, but the loop still needs access to Windows-hosted assets and the Windows Python venv.
Files:
- `src/core/config.mjs`
- `src/cli.mjs`
- `README.md`
- `scripts/smoke-test.mjs`
- `tests/root-identity.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-001`
- `T-002`
Do:
1. Accept equivalent Windows alias inputs only if they can be proven equivalent and normalized to the canonical WSL runtime root before ownership starts.
2. Keep the WSL-visible repo path as the canonical stored live identity.
3. Add an explicit compatibility check for the canonical WFA execution path using `walk forward engine/.venv/Scripts/python.exe` from WSL.
Acceptance:
1. Live launch from the canonical WSL repo path succeeds.
2. Live launch from a Windows alias path is either normalized to the same canonical root or rejected only if equivalence cannot be proven.
3. A smoke/validation step proves the WSL path can still invoke the Windows venv path used by the WFA engine.

### [x] T-004 Add literal root rejection and sentinel validation
Why: filesystem roots and malformed roots must fail before init or server startup.
Files:
- `src/core/config.mjs`
- `src/core/init.mjs`
- `tests/root-identity.test.mjs`
Depends on:
- `T-001`
Do:
1. Reject `/`, drive roots, UNC roots, and empty roots.
2. Reject roots that fail sentinel checks even if their names look plausible.
Acceptance:
1. Passing `/` fails before any writes.
2. Passing a fake folder that only contains the repo name in its path fails before any writes.

### [x] T-005 Add write containment and top-level write allowlist
Why: the loop currently lacks a hard containment barrier for runtime writes and undeclared root junk.
Files:
- `src/core/fs-utils.mjs`
- `src/core/artifact-store.mjs`
- `src/core/init.mjs`
- `src/core/paths.mjs`
- `tests/root-identity.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-001`
- `T-004`
Do:
1. Add one containment check used by all runtime writers.
2. Allow new top-level writes only under tracked source/docs/config, `factory/`, `workspace/`, `walk forward engine/`, `wfa/`, and the declared tooling sandbox.
Acceptance:
1. Writes outside canonical root throw before mutation.
2. Anonymous new top-level directories are rejected.

### [x] T-006 Declare one tooling sandbox and ignore it
Why: `.opencode/` already exists; it must become an explicit, isolated sandbox instead of accidental repo clutter.
Files:
- `.gitignore`
- `opencode.json`
- `src/core/paths.mjs`
- `src/core/init.mjs`
- `README.md`
Depends on:
- `T-001`
Do:
1. Keep `.opencode/` as the single declared tooling sandbox for now.
2. Ignore it in git.
3. Document that it is not part of research evidence.
Acceptance:
1. `.opencode/` is gitignored.
2. Runtime code refers to the sandbox explicitly rather than implicitly.

### [x] T-007 Exclude the tooling sandbox from artifacts, diffs, and retrieval
Why: tooling state must never pollute evidence, changed-file snapshots, or prompt retrieval.
Files:
- `src/core/artifact-store.mjs`
- `src/core/retrieval.mjs`
- `src/core/memory-index.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-006`
Do:
1. Exclude `.opencode/**` from workspace diff and snapshot logic.
2. Exclude `.opencode/**` from lesson indexing and retrieval surfaces.
Acceptance:
1. Sandbox files never appear in changed-file artifacts.
2. Sandbox files never appear in retrieval payloads or evidence inputs.

### [x] T-008 Add root and sandbox regression tests
Why: root identity and containment bugs are catastrophic and must stay pinned.
Files:
- `tests/root-identity.test.mjs`
- `tests/factory.test.mjs`
- `package.json`
Depends on:
- `T-003`
- `T-005`
- `T-007`
Do:
1. Add tests for literal root rejection, sentinel failure, WSL canonical path success, Windows-to-WSL alias normalization, Hebrew/Unicode path preservation, containment failure, and sandbox exclusion.
Acceptance:
1. The targeted root/sandbox suite passes; full `npm test` remains a Gate 0 requirement.

## Phase 2: Transport And Server Ownership

### [x] T-009 Create the smallest live transport seam around the current runner
Why: the orchestrator must depend on a repo-owned transport contract, but the fix should start by hardening the current concentrated runner rather than prematurely building a transport framework.
Files:
- `src/core/orchestrator.mjs`
- `src/core/runner-opencode.mjs`
- `src/core/config.mjs`
- `src/core/transport/live-transport.mjs` (new)
- `tests/transport-interface.test.mjs` (new)
Depends on:
- `T-008`
Do:
1. Define the minimal live transport contract: `init`, `createSession`, `callAgent`, `close`, `getStatus` if needed.
2. Move orchestrator coupling onto that contract while keeping the current runner as the default first implementation.
Acceptance:
1. No live orchestrator path imports `@opencode-ai/sdk` directly.
2. Interface tests prove the contract shape is sufficient for the loop without forcing a second adapter yet.

### [x] T-010 Extract a managed OpenCode server manager
Why: server boot, reuse, fingerprinting, and shutdown should not remain mixed with prompt call logic.
Files:
- `src/core/runner-opencode.mjs`
- `src/core/transport/opencode-server-manager.mjs` (new)
- `src/core/config.mjs`
- `tests/transport-server-manager.test.mjs` (new)
Depends on:
- `T-009`
Do:
1. Move server startup, reuse probe, config building, fingerprinting, and shutdown into one manager.
2. Keep only minimal session-URL helpers near the server/transport boundary.
Acceptance:
1. Server management is isolated from prompt execution logic.
2. Compatible reuse, incompatible reuse rejection, and clean shutdown behavior are all covered by tests.

### [x] T-011 Move all SDK imports behind the transport boundary
Why: the SDK must become one adapter implementation, not the orchestrator’s native execution path.
Files:
- `src/core/runner-opencode.mjs`
- `src/core/transport/opencode-sdk-transport.mjs` (new)
- `tests/transport-sdk.test.mjs` (new)
Depends on:
- `T-009`
- `T-010`
Do:
1. Restrict `@opencode-ai/sdk` imports to the SDK transport and server-manager area only.
2. Ensure all other runtime code uses the repo-local interface.
Acceptance:
1. Grepping the runtime shows SDK imports only in the transport/server-manager area.

### [x] T-012 Add explicit live plugin policy
Why: current code strips one plugin string ad hoc; live mode now requires a clear, default-deny plugin policy.
Files:
- `opencode.json`
- `src/core/runner-opencode.mjs`
- `src/core/config.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-006`
- `T-010`
Do:
1. Make live mode default to zero plugins.
2. Build the effective live server config from policy instead of inheriting the repo config blindly.
Acceptance:
1. Live mode starts with no plugins unless a future task explicitly reintroduces an allowlist.
2. Unknown plugins in live config fail tests.

### [x] T-013 Add config fingerprinting and validated server reuse
Why: opportunistic reuse of any server on port `4096` is one of the current root causes.
Files:
- `src/core/transport/opencode-server-manager.mjs`
- `src/core/config.mjs`
- `src/core/logger.mjs`
- `tests/transport-server-manager.test.mjs`
Depends on:
- `T-010`
- `T-012`
Do:
1. Fingerprint the effective live config, mode, and canonical root identity.
2. Reuse a server only when the probe proves the same policy and same mode are in effect.
Acceptance:
1. A healthy but incompatible server is rejected rather than reused.
2. Probe success alone is no longer enough to attach.

### [x] T-014 Add phase-specific timeouts and transport failure classification
Why: one generic `fetch failed` class is too weak for debugging and retry policy.
Files:
- `src/core/config.mjs`
- `src/core/transport/opencode-server-manager.mjs`
- `src/core/transport/opencode-sdk-transport.mjs`
- `src/core/logger.mjs`
- `tests/transport-interface.test.mjs`
Depends on:
- `T-013`
Do:
1. Split timeout control into boot, probe, session-create, first-headers, total-request, and shutdown budgets.
2. Classify failures by phase and retryability.
Acceptance:
1. Transport errors on disk include a phase and retryability class.
2. Logs differentiate boot/probe/request/header failures.

### [x] T-014A Make fresh-session-per-stage-attempt a hard invariant
Why: fresh sessions are a core anti-contamination rule and must survive the runner refactor rather than being assumed by later gates.
Files:
- `src/core/runner-opencode.mjs`
- `src/core/orchestrator.mjs`
- `src/core/health.mjs`
- `tests/transport-interface.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-014`
Do:
1. Treat `stage_attempt_ordinal -> session_id/session_url` uniqueness as a hard runtime invariant.
2. Fail tests when different stage attempts reuse the same session id.
Acceptance:
1. Retries and resumed attempts always mint a fresh session.
2. Health metrics and regression tests can detect session reuse contamination explicitly.

### [x] T-015 Implement a raw HTTP OpenCode transport adapter
Why: the bulletproof plan requires a first-class raw HTTP option so the default live adapter can be chosen by evidence rather than by SDK lock-in.
Files:
- `src/core/transport/opencode-http-transport.mjs` (new)
- `src/core/transport/live-transport.mjs`
- `src/core/logger.mjs`
- `tests/transport-http.test.mjs` (new)
Depends on:
- `T-009`
- `T-010`
- `T-014`
- `T-014A`
Do:
1. Implement session creation and prompt submission against the local OpenCode server using documented HTTP endpoints.
2. Validate payload and response shapes against the installed SDK types and current docs.
Acceptance:
1. The adapter can create a session and submit a prompt to a local server.
2. It emits the same normalized transport result shape as the default runner/SDK path.

### [x] T-016 Implement the SDK adapter as fallback under the same transport interface
Why: the bakeoff needs both the raw HTTP and SDK paths available under one contract so the default adapter can be chosen from evidence.
Files:
- `src/core/transport/opencode-sdk-transport.mjs`
- `tests/transport-sdk.test.mjs`
Depends on:
- `T-011`
- `T-014`
Do:
1. Wrap the current SDK request path behind the same live transport interface.
2. Keep SDK-specific quirks local to this adapter.
Acceptance:
1. The SDK adapter can be substituted without orchestrator changes.

### [x] T-017 Add machine-readable transport artifacts
Why: the loop needs durable transport evidence, not only console logs.
Files:
- `src/core/orchestrator.mjs`
- `src/core/logger.mjs`
- `src/core/artifact-store.mjs`
- `tests/transport-interface.test.mjs`
Depends on:
- `T-014`
- `T-014A`
Do:
1. Write transport-phase diagnostics into stage-error artifacts or transport-specific companion artifacts.
2. Include adapter name, phase, timeout bucket, server fingerprint, and root error.
Acceptance:
1. A transport failure can be diagnosed from disk without replaying the run.

### [x] T-018 Add transport bakeoff harness and choose the default live adapter
Why: the default adapter must be chosen by evidence rather than preference.
Files:
- `src/core/verification.mjs` (new or expanded)
- `src/core/health.mjs`
- `src/core/config.mjs`
- `tests/transport-bakeoff.test.mjs` (new)
- `factory/verification/transport-bakeoff-<stamp>.json` (generated)
Depends on:
- `T-017`
Do:
1. Compare fresh-server and validated-reuse behavior for the raw HTTP and SDK adapters.
2. Record session-create success rate, time to first headers, stage completion rate, retry recovery rate, and session URL correctness.
Acceptance:
1. A machine-readable bakeoff artifact exists.
2. The winning adapter becomes the default live adapter.
3. CLI-wrapper transport is not implemented unless both adapters fail the bakeoff.

### [x] T-019 Add transport regression tests
Why: the transport boundary is the main live blocker and must be independently pinned.
Files:
- `tests/transport-interface.test.mjs`
- `tests/transport-http.test.mjs`
- `tests/transport-sdk.test.mjs`
- `tests/transport-server-manager.test.mjs`
Depends on:
- `T-014A`
- `T-017`
Do:
1. Add tests for compatible reuse, incompatible reuse rejection, timeout classification, session creation, and adapter parity.
Acceptance:
1. The targeted transport suite passes; full `npm test` remains a Gate 0 requirement.

## Phase 3: Runtime Truth And Endless Recovery

### [x] T-020 Add `factory/runtime/` paths and seed files
Why: the control plane needs explicit runtime files separate from human summaries and derived health.
Files:
- `src/core/paths.mjs`
- `src/core/init.mjs`
- `src/core/state-store.mjs`
- `README.md`
Depends on:
- `T-019`
Do:
1. Add `factory/runtime/owner-lock.json`, `factory/runtime/active-run.json`, and `factory/runtime/recovery-log.jsonl` to project init.
Acceptance:
1. Fresh project init creates all runtime files with seeded schemas.

### [x] T-021 Implement owner lock with heartbeat and takeover TTL
Why: live ownership must not rely on `state.last_status === "running"`.
Files:
- `src/core/runtime-lock.mjs` (new)
- `src/core/orchestrator.mjs`
- `src/core/paths.mjs`
- `tests/runtime-lock.test.mjs` (new)
- `tests/factory.test.mjs`
Depends on:
- `T-020`
Do:
1. Add one file-backed owner lock with heartbeat, expiry, takeover, and clean-release behavior.
2. Make lock acquisition and takeover race-safe using a lock token and atomic ownership protocol rather than blind file replacement.
3. Derive heartbeat and takeover defaults from measured loop cadence and record the basis for those defaults in runtime docs or config.
Acceptance:
1. A second process cannot mutate live state while a healthy owner exists, even during concurrent starts.
2. A stale owner can be taken over cleanly after TTL expiry.
3. A clean shutdown releases ownership without requiring a stale-owner takeover on immediate restart.

### [ ] T-021A Harden graceful shutdown finalization
Why: lock ownership, active-run truth, handoff persistence, and interruption semantics must all converge correctly on SIGINT/SIGTERM.
Files:
- `src/cli.mjs`
- `src/core/orchestrator.mjs`
- `src/core/runtime-lock.mjs`
- `src/core/runtime-state.mjs`
- `tests/runtime-lock.test.mjs`
- `tests/runtime-state.test.mjs`
Depends on:
- `T-021`
Do:
1. Define clean shutdown behavior for success, operator stop, and interruption during an active stage.
2. Release or tombstone the owner lock correctly.
3. Finalize `active-run.json` to idle/interrupted with an auditable recovery-log entry.
4. Persist handoff state when interruption happens mid-run.
Acceptance:
1. SIGINT/SIGTERM during executor leaves coherent disk state.
2. Immediate restart after a clean stop does not require takeover logic.

### [x] T-022 Add canonical `active-run.json`
Why: current live truth is split across `state.json`, `active-session.json`, and per-run artifacts.
Files:
- `src/core/runtime-state.mjs` (new)
- `src/core/orchestrator.mjs`
- `src/core/state-store.mjs`
- `tests/runtime-state.test.mjs` (new)
Depends on:
- `T-020`
- `T-021`
Do:
1. Make `factory/runtime/active-run.json` the one canonical global live control-plane record.
2. Store owner id, run id, run instance id, backlog item id, stage, attempt ordinal, session link, follow URL, heartbeat, and last retry/error note there.
Acceptance:
1. The loop can be followed from `active-run.json` alone.
2. No control decision depends on `factory/active-session.json` anymore.

### [x] T-022A Demote `factory/state.json` to summary-only
Why: once owner-lock and active-run truth exist, `state.json` must stop acting as a control-plane decision source.
Files:
- `src/core/state-store.mjs`
- `src/core/orchestrator.mjs`
- `src/cli.mjs`
- `tests/runtime-state.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-022`
Do:
1. Remove startup, recovery, ownership, and resume decisions that read `factory/state.json` as authoritative truth.
2. Keep `factory/state.json` as a summary pointer for human/operator use only.
Acceptance:
1. Startup and recovery logic rely on owner-lock, active-run, run-state, backlog, and handoff truth only.
2. `state.json` can be stale without breaking control-plane decisions.

### [x] T-023 Expand per-run `run-state.json`
Why: resume safety requires more than the current stage status and handoff fields.
Files:
- `src/core/orchestrator.mjs`
- `src/core/artifact-store.mjs`
- `src/core/runtime-state.mjs`
- `tests/runtime-state.test.mjs`
Depends on:
- `T-022`
Do:
1. Add owner id, run instance id, resume generation, current stage session pointer, last completed stage, monotonic attempt ordinals, and failure class.
Acceptance:
1. `run-state.json` is sufficient to resume a run without reading old chat history.

### [x] T-024 Make stage attempt ordinals monotonic and artifact naming durable
Why: current retries reset attempt numbers on resume and can overwrite prior attempt artifacts.
Files:
- `src/core/orchestrator.mjs`
- `src/core/artifact-store.mjs`
- `src/core/runtime-state.mjs`
- `tests/runtime-state.test.mjs`
Depends on:
- `T-023`
Do:
1. Allocate attempt ordinals from durable per-run counters.
2. Stop naming new attempts from local retry-loop counters.
Acceptance:
1. After restart, the next executor attempt becomes `executor-attempt-4`, not `executor-attempt-1` again.
2. No prior attempt artifact is overwritten.

### [x] T-025 Make handoff single-use and resume generation explicit
Why: handoff notes must not be consumed twice or leak into unrelated future loops.
Files:
- `src/core/orchestrator.mjs`
- `src/core/artifact-store.mjs`
- `src/core/runtime-state.mjs`
- `tests/runtime-state.test.mjs`
Depends on:
- `T-023`
- `T-024`
Do:
1. Add resume generation and consumer identity to handoff files.
2. Mark handoffs consumed atomically at resume time.
Acceptance:
1. A handoff can be consumed exactly once.
2. A resumed stage receives only its one-time retry note.

### [x] T-025A Add startup reconciliation contract
Why: startup must deterministically reconcile owner-lock, active-run, backlog lease state, run-state, and handoff files before resuming or starting new work.
Files:
- `src/core/orchestrator.mjs`
- `src/core/runtime-lock.mjs`
- `src/core/runtime-state.mjs`
- `src/core/backlog-store.mjs`
- `tests/runtime-state.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-021`
- `T-022`
- `T-022A`
- `T-025`
Do:
1. Define precedence rules for conflicting/stale control-plane files.
2. Repair stale `active-run.json` and lease state when safe.
3. Choose the most advanced safe resumable run deterministically.
Acceptance:
1. Mixed stale-state scenarios reconcile deterministically.
2. Resume-source precedence is tested and documented.

### [x] T-026 Separate backlog lease from research disposition
Why: infra failures must not retire good research ideas, and ownership is not the same as research status.
Files:
- `src/core/backlog-store.mjs`
- `src/core/orchestrator.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-021`
- `T-023`
Do:
1. Keep lease/ownership fields separate from research outcome fields.
2. Preserve backlog item research status across infra failures and resumes.
Acceptance:
1. Infra failures do not mark items complete or inconclusive.
2. Expired leases recover safely without losing run history.

### [x] T-027 Add poisoned-run cooldown, quarantine, and move-on behavior
Why: endless mode must not hammer the same failing run indefinitely.
Files:
- `src/core/orchestrator.mjs`
- `src/core/backlog-store.mjs`
- `src/core/runtime-state.mjs`
- `src/core/health.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-026`
Do:
1. Track repeated same-stage same-failure-class streaks per run.
2. Add cooldown and quarantine state with explicit thresholds defined in config.
3. Make endless mode move on to the next eligible backlog item when the threshold is breached.
Acceptance:
1. One poisoned run cannot keep the service busy forever.
2. Cooldown/quarantine events are visible on disk and in health metrics.

### [x] T-028 Add recovery log and second-process observer-only mode
Why: second-process starts and stale-owner takeovers must be visible and safe.
Files:
- `src/core/runtime-lock.mjs`
- `src/core/orchestrator.mjs`
- `src/core/runtime-state.mjs`
- `src/cli.mjs`
- `tests/runtime-lock.test.mjs`
Depends on:
- `T-021`
- `T-022`
Do:
1. Write recovery/takeover/observer-only events into `factory/runtime/recovery-log.jsonl`.
2. Implement observer-only behavior for a second live start while the owner lock is fresh.
Acceptance:
1. A second live launch does not mutate the active run or backlog.
2. Recovery log entries make ownership changes auditable.

### [x] T-029 Add control-plane regression tests
Why: runtime truth, handoff, and endless recovery are stateful and easy to break.
Files:
- `tests/runtime-lock.test.mjs`
- `tests/runtime-state.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-028`
Do:
1. Add tests for owner collision, stale takeover, active-run truth, monotonic ordinals, handoff consumption, lease separation, cooldown, and quarantine.
Acceptance:
1. The targeted control-plane suite passes; full `npm test` remains a Gate 0 requirement.

### [x] T-029A Backfill existing backlog, run-state, and handoff schemas
Why: live rollout against existing disk state will fail if older resumable runs and leases are not migrated before the new control plane takes over.
Files:
- `src/core/orchestrator.mjs`
- `src/core/backlog-store.mjs`
- `src/core/artifact-store.mjs`
- `factory/backlog.json`
- `factory/runs/`
- `tests/runtime-state.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-025A`
Do:
1. Migrate existing backlog, run-state, and handoff files to the new schema in place.
2. Write a migration report artifact for upgraded legacy state.
3. Prove old resumable runs still resume correctly after migration.
Acceptance:
1. Existing repo state is upgraded without manual surgery.
2. Legacy resumable runs remain resumable under the new control plane.

## Phase 4: Observer UX And CLI Follow Surface

### [x] T-030 Add a minimal file-backed observer server
Why: localhost must show the actual running loop, not just an attempt-local session URL.
Files:
- `src/observer/server.mjs` (new)
- `src/core/runtime-state.mjs`
- `src/core/paths.mjs`
- `src/core/init.mjs`
- `tests/observer.test.mjs` (new)
Depends on:
- `T-022`
- `T-023`
- `T-025A`
- `T-029A`
Do:
1. Add one minimal observer surface backed only by on-disk runtime truth.
2. Keep it read-only and narrow.
Acceptance:
1. The observer can show active run id, stage, attempt ordinal, session link, latest error, heartbeat age, and log tail from files only.

### [x] T-031 Add a stable follow URL
Why: the operator needs one consistent URL to watch the real active run across retries and resumes.
Files:
- `src/observer/server.mjs`
- `src/core/runtime-state.mjs`
- `src/core/orchestrator.mjs`
- `tests/observer.test.mjs`
Depends on:
- `T-030`
- `T-025A`
Do:
1. Introduce a stable follow URL that points to the active run page or idle state.
2. Store the follow URL in the active-run truth.
Acceptance:
1. Retries and resumed attempts do not change the operator’s entrypoint.

### [x] T-032 Change browser auto-open to the observer once per run
Why: current browser behavior opens raw executor session URLs repeatedly and does not match the intended UX.
Files:
- `src/core/runner-opencode.mjs`
- `src/core/orchestrator.mjs`
- `src/observer/server.mjs`
- `tests/observer.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-031`
Do:
1. Open the follow URL when a run first reaches executor.
2. Stop opening a new tab for every retry.
Acceptance:
1. One live run opens one browser tab by default.
2. The observer still exposes the raw current session URL as a debug link.

### [x] T-033 Update CLI status and add follow behavior
Why: current `status` only prints `state.json` and backlog counts, which is not enough for live operations.
Files:
- `src/cli.mjs`
- `src/core/runtime-state.mjs`
- `src/core/state-store.mjs`
- `README.md`
- `tests/cli-follow.test.mjs` (new)
Depends on:
- `T-022`
- `T-031`
Do:
1. Make `status` report owner freshness, active run, run instance, stage, attempt ordinal, follow URL, and raw session URL.
2. Add a simple follow command or equivalent follow mode that points the user to the stable observer.
Acceptance:
1. The CLI can show the real active run without consulting `factory/active-session.json` as truth.

### [x] T-034 Deprecate `factory/active-session.json` safely
Why: it is currently part of the truth confusion and should not remain authoritative.
Files:
- `src/core/orchestrator.mjs`
- `src/core/state-store.mjs`
- `src/core/runtime-state.mjs`
- `README.md`
- `tests/factory.test.mjs`
Depends on:
- `T-022`
- `T-033`
Do:
1. Turn `factory/active-session.json` into a derived compatibility mirror if needed.
2. Remove it entirely after Gate 3 if no code path still depends on it.
Acceptance:
1. No control decision depends on `factory/active-session.json`.
2. Its removal or deprecation does not break operator visibility.

### [x] T-035 Add observer, browser, and CLI regression tests
Why: localhost visibility is one of the current pain points and must stay pinned.
Files:
- `tests/observer.test.mjs`
- `tests/cli-follow.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-034`
Do:
1. Add tests for follow URL continuity, browser-open-once behavior, raw session-link availability, and CLI status/follow output.
Acceptance:
1. The targeted observer/CLI suite passes; full `npm test` remains a Gate 0 requirement.

## Phase 5: Prompt, Retrieval, And Validation Hardening

### [x] T-036 Freeze the runtime prompt stack
Why: the runtime must stay at three repo-owned layers only: invariants, role prompt, and stage capsule.
Files:
- `opencode.json`
- `tests/factory.test.mjs`
Depends on:
- `T-035`
Do:
1. Pin runtime injection to `src/prompts/runtime-invariants.md` only.
2. Add tests that fail if another shared prompt layer is injected.
Acceptance:
1. Runtime prompt stack contains only invariants + role prompt + generated capsule.

### [x] T-037 Re-contract runtime invariants and role prompts
Why: prompts must stay lean, stage-specific, and free of hidden steering.
Files:
- `src/prompts/runtime-invariants.md`
- `src/prompts/ideator.md`
- `src/prompts/planner.md`
- `src/prompts/executor.md`
- `src/prompts/evaluator.md`
- `src/prompts/summarizer.md`
- `tests/factory.test.mjs`
Depends on:
- `T-036`
Do:
1. Lock `runtime-invariants.md` to universal truths only.
2. Ensure role prompts contain only job, boundary, forbidden behavior, and output schema.
Acceptance:
1. Tests fail if forbidden prompt content reappears.
2. Summarizer prompt explicitly forbids generic lessons and generic next actions.

### [x] T-038 Convert prompt builders to pure stage serializers
Why: `src/core/prompt-builders.mjs` must stop acting like a generic context dump.
Files:
- `src/core/prompt-builders.mjs`
- `src/core/constants.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-037`
Do:
1. Remove hidden steering, generic history dumps, and any prose that can be replaced with exact file paths.
2. Keep only stage-local facts, file paths, plan fields, and explicit retry notes.
Acceptance:
1. Stage prompts are shorter, narrower, and serializer-like.
2. No hidden asset/timeframe narrowing remains in active prompt builders or constants.

### [x] T-038A Enforce `factory/market-policy.json` as the single visible scope and selection policy
Why: research direction must stay explicit and operator-visible rather than drifting through hidden code defaults and ranking heuristics.
Files:
- `factory/market-policy.json`
- `src/core/market-policy.mjs`
- `src/core/orchestrator.mjs`
- `src/core/prompt-builders.mjs`
- `src/core/validators.mjs`
- `tests/factory.test.mjs`
- `tests/verification.test.mjs`
Depends on:
- `T-037`
- `T-038`
Do:
1. Audit and remove hidden market/source/history defaults from active code paths where policy file truth should be used.
2. Make planner scope, source, and history checks conform to `factory/market-policy.json`.
3. Make backlog selection policy visibly sourced from the policy file rather than hardcoded defaults alone.
Acceptance:
1. Changing `factory/market-policy.json` changes runtime behavior in tested ways.
2. No hidden asset or timeframe narrowing survives in code once policy is applied.

### [x] T-039 Restrict retry and handoff notes to one resumed stage
Why: failure context must not leak into unrelated future stages.
Files:
- `src/core/prompt-builders.mjs`
- `src/core/orchestrator.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-025`
- `T-038`
Do:
1. Inject only the smallest useful delta for a retry or resume.
2. Ensure it is consumed only by the resumed stage attempt.
Acceptance:
1. Retry notes never appear in later successful stages unless a new failure occurs there.

### [x] T-040 Measure prompt sizes and codify stage budgets
Why: prompt budgets must be based on actual repo behavior, not arbitrary guesses.
Files:
- `src/core/prompt-builders.mjs`
- `src/core/orchestrator.mjs`
- `src/core/health.mjs`
- `src/core/config.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-038`
Do:
1. Record current prompt sizes per stage.
2. Set explicit stage budgets from measured baselines.
3. Warn by default and support strict-mode hard failures.
Acceptance:
1. Budgets are explicit in config/code.
2. Health output records prompt bytes and budget breaches.

### [x] T-041 Add retrieval allowlist and diagnostic denylist
Why: executor retrieval currently leaks internal diagnostic artifacts back into prompts.
Files:
- `src/core/retrieval.mjs`
- `tests/retrieval-hygiene.test.mjs` (new)
- `tests/factory.test.mjs`
Depends on:
- `T-007`
- `T-038`
Do:
1. Allow only plan files, summaries, final execution outputs, final evaluation outputs, and final WFA artifacts into executor retrieval.
2. Ban `stage-input.json`, `stage-prompt.txt`, `stage-response.raw.txt`, `stage-error.json`, `*-session.json`, and `handoff.json`.
Acceptance:
1. Executor retrieval never surfaces diagnostic artifacts.

### [x] T-042 Trim lesson artifact paths at canonical lesson creation
Why: durable lesson memory should never keep retrieval-unsafe artifact paths.
Files:
- `src/core/memory-index.mjs`
- `tests/retrieval-hygiene.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-041`
Do:
1. Filter `related_artifact_paths` when canonical lessons are created.
2. Preserve only retrieval-safe paths.
Acceptance:
1. New lessons do not carry diagnostic artifact paths into durable memory.

### [x] T-043 Rebuild retrieval outputs as compact stage-specific capsules
Why: retrieval ranking exists, but returned payloads are still broader than the stages need.
Files:
- `src/core/retrieval.mjs`
- `src/core/prompt-builders.mjs`
- `src/core/memory-index.mjs`
- `tests/retrieval-hygiene.test.mjs`
Depends on:
- `T-041`
- `T-042`
Do:
1. Keep planner retrieval to a small lesson/comparable-run set.
2. Keep executor retrieval to 2-4 execution lessons, blocker patterns, and safe paths only.
3. Keep summarizer retrieval contradiction-only when needed.
Acceptance:
1. Retrieval payloads are stage-specific and compact.

### [x] T-044 Tighten planner validation
Why: plans must fail if they do not specify scope, history depth, source plan, and real evaluation criteria.
Files:
- `src/core/validators.mjs`
- `tests/verification.test.mjs` (new)
- `tests/factory.test.mjs`
Depends on:
- `T-037`
- `T-038`
Do:
1. Reject plans missing explicit scope, rationale, historical depth, primary source family, expected artifacts, or meaningful success criteria.
Acceptance:
1. Invalid plans are rejected before execution begins.

### [x] T-044A Enforce canonical WFA execution provenance
Why: `executed` must mean the canonical WFA engine path actually ran, not merely that some result-looking artifacts appeared on disk.
Files:
- `src/core/orchestrator.mjs`
- `src/core/validators.mjs`
- `src/prompts/executor.md`
- `src/core/prompt-builders.mjs`
- `tests/verification.test.mjs`
- `tests/factory.test.mjs`
- `scripts/smoke-test.mjs`
Depends on:
- `T-003`
- `T-044`
Do:
1. Require executor outputs to persist the executed WFA command, working directory, config path, and canonical result/provenance files.
2. Parse at least one WFA-specific artifact that proves windows actually ran.
3. Reject `executed` results that only provide generic result folders or fallback-looking artifacts.
Acceptance:
1. Fake or generic results cannot pass the execution gate.
2. Real live runs carry enough provenance to prove the canonical WFA path was used.

### [x] T-044B Add data-quality and blocked-status evidence checks
Why: a robust service is not enough if it can still produce weak or shallow trading evidence from bad or insufficient data.
Files:
- `src/core/validators.mjs`
- `src/core/orchestrator.mjs`
- `src/prompts/planner.md`
- `src/prompts/executor.md`
- `src/core/prompt-builders.mjs`
- `tests/verification.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-038A`
- `T-044`
Do:
1. Validate source family and historical-depth fields against market policy.
2. Require executor evidence of coverage/gap/freshness checks when data acquisition or dataset validation is part of the plan.
3. Require blocked status to show real data-attempt evidence rather than shallow claims.
Acceptance:
1. Plans with policy-incompatible source/history fields are rejected.
2. Data-related blocked runs show real attempted acquisition/validation evidence.

### [x] T-045 Tighten evaluator validation with on-disk existence checks
Why: evaluator verification must prove it actually checked real artifacts.
Files:
- `src/core/validators.mjs`
- `src/core/orchestrator.mjs`
- `tests/verification.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-044`
- `T-044A`
- `T-044B`
Do:
1. Require evaluator-cited artifact paths to exist on disk.
2. Require metrics verification sources when metrics are claimed.
Acceptance:
1. An evaluator cannot pass with only path-like strings.

### [x] T-046 Tighten summarizer validation against generic output
Why: summarizer output must be specific enough to persist usefully.
Files:
- `src/core/validators.mjs`
- `src/core/summary.mjs`
- `src/prompts/summarizer.md`
- `tests/verification.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-037`
Do:
1. Reject vague lessons and vague next actions.
2. Require run-specific evidence-linked content.
Acceptance:
1. Boilerplate summary content fails validation.

### [x] T-047 Make stage gates explicit and write per-run gate results
Why: anti-fake completion must be explicit and machine-auditable before any final verification bundle is produced.
Files:
- `src/core/orchestrator.mjs`
- `src/core/validators.mjs`
- `src/core/verification.mjs`
- `tests/verification.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-044`
- `T-045`
- `T-046`
Do:
1. Add explicit planner, executor, evaluator, and summarizer gates.
2. Write machine-readable per-run gate results listing the exact gate decision and evidence path that allowed advancement.
Acceptance:
1. A stage cannot advance unless its gate passes.
2. Every stage transition cites the exact gate result that allowed it.

### [x] T-048 Add prompt, retrieval, and validator regression tests
Why: this whole layer is fragile and currently one of the main prompt-quality risks.
Files:
- `tests/retrieval-hygiene.test.mjs`
- `tests/verification.test.mjs`
- `tests/factory.test.mjs`
Depends on:
- `T-047`
Do:
1. Add tests for prompt-stack shape, invariant size, prompt budgets, retrieval denylist, invalid plans, bad evaluator verification, and generic summaries.
Acceptance:
1. The targeted prompt/retrieval/gate suite passes; full `npm test` remains a Gate 0 requirement.

## Phase 6: Health, Verification, And Test Net

### [x] T-049 Expand health metrics
Why: health must distinguish transport phase failures, prompt-budget breaches, ownership problems, and poisoned-run behavior.
Files:
- `src/core/health.mjs`
- `tests/health.test.mjs` (new)
- `factory/health.json`
Depends on:
- `T-017`
- `T-027`
- `T-028`
- `T-040`
- `T-047`
Do:
1. Add adapter/phase transport metrics.
2. Add owner-lock takeover counts, quarantine counts, prompt-budget breaches, and false-pass prevention counters.
Acceptance:
1. Health metrics remain derived, useful, and clearly non-authoritative.

### [x] T-049A Bound runtime and verification artifact growth
Why: endless operation must not create unbounded runtime and verification artifact sprawl while being hardened.
Files:
- `src/core/verification.mjs`
- `src/core/health.mjs`
- `src/core/paths.mjs`
- `README.md`
- `tests/health.test.mjs`
Depends on:
- `T-049`
Do:
1. Add retention/rotation rules for recovery logs, heartbeat-like runtime artifacts, and verification artifacts.
2. Keep durable evidence while bounding purely operational growth.
Acceptance:
1. Endless operation does not create unbounded operational artifact growth.
2. Retention rules are explicit and documented.

### [x] T-049B Add research-throughput and evidence-yield metrics
Why: a stable service is not enough; soak acceptance must also prove the loop is producing useful research.
Files:
- `src/core/health.mjs`
- `src/core/orchestrator.mjs`
- `tests/health.test.mjs`
- `factory/health.json`
Depends on:
- `T-038A`
- `T-044A`
- `T-049`
Do:
1. Add executor completion rate, evidence-bearing runs per soak window, market-family distribution vs policy, and infra-blocked vs research-producing time metrics.
2. Make these metrics available for rollout-gate evaluation.
Acceptance:
1. Health output can distinguish service uptime from actual research throughput.

### [x] T-050 Add verification-manifest and rollout-gate writers
Why: closeout must be machine-backed, and rollout gates must be recorded explicitly.
Files:
- `src/core/verification.mjs`
- `src/core/init.mjs`
- `src/core/paths.mjs`
- `tests/verification.test.mjs`
- `factory/verification/verification-manifest-<stamp>.json` (generated)
- `factory/verification/rollout-gate-<stamp>.json` (generated)
Depends on:
- `T-047`
Do:
1. Add one verification-manifest writer that aggregates per-run gate results into a fresh machine-readable certification bundle.
2. Add one rollout-gate writer.
3. Keep them derived from canonical runtime truth and run artifacts.
Acceptance:
1. Verification and rollout artifacts are written by code, not by manual prose.

### [x] T-051 Add failure-injection drills
Why: the live loop needs regression coverage for the specific failures that already hurt it.
Files:
- `tests/transport-interface.test.mjs`
- `tests/verification.test.mjs`
- `tests/factory.test.mjs`
- `factory/verification/fault-drills-<stamp>.json` (generated)
Depends on:
- `T-019`
- `T-029`
- `T-048`
- `T-050`
Do:
1. Add drills for timeout before headers, disconnect after headers, session-create success then prompt hang, owner death mid-executor, clean shutdown during executor, bad evaluator artifact path, generic summary, false executed claim, stale active-run reconciliation, and poisoned-run move-on behavior.
Acceptance:
1. Every drill ends in either safe recovery or explicit machine rejection, never silent success.

### [x] T-052 Update `smoke` and `validate` scripts to gate on verification behavior
Why: repo-level validation must cover the new verification chain instead of only structure and one simulate path.
Files:
- `scripts/smoke-test.mjs`
- `scripts/validate-structure.mjs`
- `package.json`
- `src/core/verification.mjs`
Depends on:
- `T-000`
- `T-050`
- `T-051`
Do:
1. Make smoke/validate prove that verification artifacts can be written and that stale pass docs are not treated as active truth.
Acceptance:
1. `npm run validate` and `npm run smoke` fail when verification behavior is broken.

### [x] T-053 Add targeted phase test entrypoints and organize tests by defect class where useful
Why: early implementation should not be blocked by future unfinished surfaces, but the final suite still needs clean defect-class coverage.
Files:
- `tests/factory.test.mjs`
- `tests/root-identity.test.mjs`
- `tests/transport-interface.test.mjs`
- `tests/transport-http.test.mjs`
- `tests/transport-sdk.test.mjs`
- `tests/transport-server-manager.test.mjs`
- `tests/runtime-lock.test.mjs`
- `tests/runtime-state.test.mjs`
- `tests/observer.test.mjs`
- `tests/cli-follow.test.mjs`
- `tests/retrieval-hygiene.test.mjs`
- `tests/verification.test.mjs`
- `tests/health.test.mjs`
- `package.json`
Depends on:
- `T-052`
Do:
1. Add targeted phase-level test commands or conventions so early tasks can prove themselves without requiring the entire final suite.
2. Keep the final test suite organized by defect class where that materially improves maintenance.
Acceptance:
1. Phase-local targeted suites exist and pass at intermediate checkpoints.
2. Each critical defect family named in the spec has at least one focused test or focused group by Gate 0.

## Phase 7: Migration, Docs, And Derived Artifact Rebuild

### [x] T-054 Rebuild derived artifacts idempotently
Why: retrieval, health, and evidence changes must be reflected in official derived outputs.
Files:
- `src/core/memory-index.mjs`
- `src/core/health.mjs`
- `src/core/orchestrator.mjs`
- `factory/evidence/index.json`
- `factory/leaderboard.json`
- `factory/memory/retrieval_index.json`
- `factory/health.json`
- `tests/factory.test.mjs`
Depends on:
- `T-049`
- `T-053`
Do:
1. Rebuild derived artifacts from canonical sources.
2. Ensure a second rebuild is stable except for timestamps.
Acceptance:
1. Rebuild is idempotent and does not silently change meaning between runs.

### [x] T-055 Refresh historical doc banners and supersession references after the new verification chain lands
Why: truth reset happens in `T-000`, but the repo still needs a later pass to ensure historical docs and new closeout references stay aligned after the new verification chain is in place.
Files:
- `factory/final-acceptance-sweep.md`
- `factory/loop-tightening-closeout.md`
- `factory/live-readiness-closeout-spec.md`
- `tests/closeout-docs.test.mjs` (new)
- `scripts/validate-structure.mjs`
Depends on:
- `T-000`
- `T-050`
Do:
1. Refresh historical doc banners and supersession text after the verification-manifest chain exists.
2. Keep tests that fail if historical docs still read like active certification without fresh verification artifacts.
Acceptance:
1. The repo has no prose-only active pass document.

### [x] T-056 Update README and operator docs to the new launch/follow model
Why: the operator-facing workflow must match the new runtime truth, observer, and path policy.
Files:
- `README.md`
- `factory/tasks.md`
- `factory/bulletproof-endless-live-finalization-spec.md`
- `src/cli.mjs`
Depends on:
- `T-033`
- `T-055`
Do:
1. Document canonical WSL launch path, observer follow flow, second-process observer-only behavior, and verification/rollout artifacts.
Acceptance:
1. Operator docs match actual runtime behavior.

## Phase 8: Rollout Gates And Soak Acceptance

### [x] T-057 Execute Gate 0: source gate
Why: source changes alone must prove test and validation health before any live claim.
Files:
- `factory/verification/rollout-gate-<stamp>.json`
- `factory/verification/verification-manifest-<stamp>.json`
- `factory/health.json`
Depends on:
- `T-052`
- `T-055`
- `T-056`
Do:
1. Run `npm run validate`, `npm test`, and `npm run smoke`.
2. Record Gate 0 outcome in a rollout-gate artifact.
Acceptance:
1. Gate 0 artifact exists and all source checks are green.

Completed with:
`factory/verification/rollout-gate-20260403122815229.json`

### [x] T-058 Execute Gate 1: simulated control-plane gate
Why: the control plane must work cleanly before real live runs are used as proof.
Files:
- `factory/verification/rollout-gate-<stamp>.json`
- `factory/runs/`
- `factory/health.json`
Depends on:
- `T-057`
Do:
1. Run one clean simulate cycle with the new control plane and prompt gates.
Acceptance:
1. No session reuse contamination occurs.
2. No simulate run is promoted as real evidence.

Completed with:
`factory/verification/rollout-gate-20260403123053839.json`

### [x] T-059 Execute Gate 2: failure-injection gate
Why: the system must prove it handles its known failure classes before live certification begins.
Files:
- `factory/verification/fault-drills-<stamp>.json`
- `factory/verification/rollout-gate-<stamp>.json`
- `factory/health.json`
Depends on:
- `T-051`
- `T-058`
Do:
1. Run the required failure drills and record outcomes.
Acceptance:
1. Gate 2 passes only if every required drill ends in safe recovery or machine rejection.

Completed with:
`factory/verification/rollout-gate-20260403123126949.json`

### [x] T-060 Execute Gate 3: controlled live gate
Why: one real bounded live run must prove the full path works end to end.
Files:
- `factory/verification/rollout-gate-<stamp>.json`
- `factory/verification/verification-manifest-<stamp>.json`
- `factory/runs/`
- `factory/health.json`
Depends on:
- `T-017`
- `T-059`
- `T-044A`
- `T-044B`
Do:
1. Run one low-cycle live run through the selected default adapter.
Acceptance:
1. A real WFA run completes with real artifacts.
2. The observer follow surface works during the run.
3. The execution result carries canonical WFA provenance proving the real engine path was used.
4. No malformed root junk appears.

Completed with:
`factory/verification/rollout-gate-20260404085447753.json`

Latest successful Gate 3 evidence includes resumed live run `RUN-20260404080723-hm4238` with canonical WFA provenance at `factory/runs/RUN-20260404080723-hm4238/execution-result.json`.

### [ ] T-061 Execute Gate 4: bounded unattended live gate
Why: the loop must survive more than one controlled manual live run.
Files:
- `factory/verification/rollout-gate-<stamp>.json`
- `factory/verification/verification-manifest-<stamp>.json`
- `factory/runs/`
- `factory/health.json`
Depends on:
- `T-060`
- `T-049B`
Do:
1. Run at least 10 cycles or 4 continuous hours, whichever is longer.
Acceptance:
1. Retries, resumes, ownership, and observer visibility remain coherent.
2. No uncontrolled crash loop or same-item infinite retry loop occurs.
3. At least one real live run in the window is interrupted and resumed coherently.
4. No stale owner-lock or active-run residue remains after cycle completion.

Status note:
Latest full Gate 4 window is recorded as blocked in `factory/verification/rollout-gate-20260404212727146.json`. The second 4-hour unattended run still failed Gate 4: no live runs completed in the fresh window, planner/executor failures kept consuming cycles, and runtime ended with `factory/runtime/active-run.json` in `error` state.

Post-window reliability work since then:
- repeated same-stage failures now escalate using cumulative stage attempts, not only resume streaks
- meta-analysis follow-up items are filtered out of the live backlog queue
- planner validation now rejects `TIMESTAMP` placeholders and malformed `data_acquisition.expected_outputs`
- live transport session creation timeout default increased from 15s to 30s

Fresh proving evidence after these fixes:
- `factory/runs/RUN-20260404211002-hmi9jy/run.log` now shows a recovered live completion at `2026-04-05T13:46:23.809Z`
- `factory/runs/RUN-20260405144149-ffh3s0/run.log` shows another live completion at `2026-04-05T15:43:31.207Z`

These proving windows improved live recovery and throughput, but no fresh Gate 4 pass artifact exists yet.

### [ ] T-062 Execute Gate 5: bounded soak gate
Why: endless-live readiness must be proven by a bounded soak window, not by one good run.
Files:
- `factory/verification/rollout-gate-<stamp>.json`
- `factory/verification/verification-manifest-<stamp>.json`
- `factory/runs/`
- `factory/health.json`
- `factory/summaries/`
Depends on:
- `T-061`
- `T-049A`
- `T-049B`
Do:
1. Run at least 25 cycles or 24 continuous hours, whichever is longer.
2. Require at least 3 completed real live runs with coherent end-to-end artifacts in that window.
Acceptance:
1. All endless-live acceptance conditions from the finalization spec are satisfied in the recorded soak window.
2. Research-throughput metrics show meaningful evidence yield rather than mostly infra churn.
3. No attempt directories are overwritten and no resumable state is lost across the soak window.

### [ ] T-063 Write final closeout after Gate 5 only
Why: closeout is the last artifact, not the proof artifact.
Files:
- `factory/final-live-closeout.md` (new)
- `factory/verification/verification-manifest-<stamp>.json`
- `factory/verification/rollout-gate-<stamp>.json`
- `factory/final-acceptance-sweep.md`
- `factory/loop-tightening-closeout.md`
Depends on:
- `T-062`
Do:
1. Write one final closeout that cites exact fresh verification and rollout artifacts.
2. Explicitly supersede older pass docs.
Acceptance:
1. A final closeout cannot exist unless Gate 5 already passed.
2. The closeout is evidence-backed and clearly separate from the proof artifacts themselves.

## Definition Of Completion

This task list is complete only when:

1. Every task above is done or intentionally canceled with a written reason.
2. Gate 5 passed with fresh artifacts on disk.
3. The live loop can run from the canonical WSL repo path, use the Windows-hosted WFA dependencies correctly, and keep a clean repo root.
4. Transport, state, observer UX, prompt hygiene, validation, and verification all have regression coverage.
5. No active doc in `factory/` still implies endless-live readiness without fresh machine-backed proof.

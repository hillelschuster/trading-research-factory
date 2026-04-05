# Long-Term Loop Architecture Spec

Date: 2026-03-24
Status: proposed
Scope: live research loop, prompt architecture, endless operation, retries, memory, evidence hygiene
Role: single active north-star architecture spec

## 1. Intent

Build the healthiest possible long-term architecture for an autonomous research loop whose job is to discover profitable trading strategies through real walk-forward analysis.

The loop must be:
- lean
- layered
- explicit
- non-brittle
- non-theatrical
- non-deterministic except for declared market-family scope
- able to run endlessly without poisoning itself with prompt bloat or stale session history

The desired spirit is free roaming research:
- explore crypto, forex, and prediction markets, especially Polymarket, according to explicit policy and evidence
- improve over time through a durable memory layer
- remain simple enough that the model can stay focused

This is not ML.
This is not RL.
This is a memory-assisted research machine.

## 2. Core Rule

Every prompt line must fight for its life.

If a sentence is not essential at that exact layer, it does not belong there.

## 3. Architecture Truth Hierarchy

The repo must have one clear truth hierarchy.

### 3.1 Single-source hierarchy

1. This file defines the architecture.
2. `src/prompts/runtime-invariants.md` defines universal runtime doctrine.
3. role prompt files define stable role contracts.
4. policy/config files define explicit machine-readable policy.
5. orchestrator and validators enforce behavior.
6. runtime capsules carry only current-task facts.
7. run artifacts and memory files preserve continuity.

If two files try to be the same layer, one of them is wrong.

### 3.2 What each layer is allowed to own

- Architecture spec
  - owns design truth, boundaries, and implementation target
- Runtime invariants
  - owns universal non-negotiables for all agents
- Role prompts
  - own stage-specific job definition and output schema
- Policy/config files
  - own explicit priorities, schemas, and promotion rules
- Orchestrator/validators
  - own enforcement
- Runtime capsules
  - own current task state only
- Memory files
  - own durable evidence and lessons

### 3.3 What must never happen

- two shared prompt files carrying the same doctrine
- a role prompt teaching general repo philosophy
- a runtime capsule re-explaining static doctrine
- code silently steering assets/timeframes without explicit policy

## 4. Non-Negotiable Outcomes

- The loop stays focused on finding profitable, robust, evidence-backed strategies.
- Executor success means real WFA output artifacts only.
- There is no hidden narrowing to BTC, ETH, SOL, or any fixed assets unless the current task explicitly justifies them.
- Any market-family priority is explicit, versioned, and easy to inspect.
- Shared runtime doctrine is tiny.
- Role prompts are narrow.
- Runtime capsules are task-local.
- Session reuse does not contaminate later stages or later cycles.
- Infrastructure failure does not retire good research ideas.
- Memory stays simple, durable, and retrieval-friendly.
- The codebase stays tidy, with obvious places to look for truth.

## 5. Anti-Goals

The architecture must not become:
- a giant shared handbook injected into every call
- a one-session chat log for the whole factory
- a pile of overlapping prompt files saying the same thing differently
- a hidden BTC/ETH/SOL system pretending to be open-ended
- an overengineered memory stack with embeddings, vector DBs, RL, or graphs
- an Obsidian-native runtime dependency
- a polluted evidence layer where simulate and live research mix freely

## 6. Verified Current Problems

The current system still has these structural defects:

- prompt overlap
  - `opencode.json` injects both `AGENTS.md` and `src/prompts/shared-context.md`
  - `src/prompts/shared-context.md` is still a handbook rather than a tiny invariant layer
- session contamination
  - one session is created once and reused across stages and cycles
- role confusion
  - planner is reused for idea generation
- hidden steering
  - helper code still infers names, assets, commands, and fallback directions
- endless-loop brittleness
  - failures are over-coarsened and good ideas can be marked failed because of infra problems
- weak retry semantics
  - retries are mostly blind reruns
- memory corruption and retrieval weakness
  - invalid lesson lines exist and retrieval is shallow and generic
- simulate pollution
  - simulate output still looks too close to real evidence in some paths

## 7. Lean Layer Model

### Layer 0: platform/system

Owner: outside repo

Purpose:
- host-level instructions
- tool semantics
- safety rules

Repo policy:
- do not duplicate this unless absolutely necessary

### Layer 1: runtime invariants

Owner: repo
Proposed file: `src/prompts/runtime-invariants.md`
Target size: under about 1000 chars if possible

Allowed content:
- stay inside repo
- never fake evidence
- executor is not `executed` without real WFA outputs
- orchestrator owns official state files
- uncertainty must be reported honestly

Forbidden content:
- metric tables
- directory trees
- strategy examples
- market priority prose
- long explanations
- role-specific checklists

### Layer 2: role contracts

Owner: repo
Files:
- `src/prompts/ideator.md` (new)
- `src/prompts/planner.md`
- `src/prompts/executor.md`
- `src/prompts/evaluator.md`
- `src/prompts/summarizer.md`

Target size:
- each role prompt should be short and stable
- ideal target: under about 2k chars each

Allowed content:
- exact job
- exact stage boundary
- exact output schema
- role-specific forbidden behavior

Forbidden content:
- duplicated shared doctrine
- current run history
- market policy essays
- other roles' jobs

### Layer 3: runtime capsules

Owner: repo
Builder: `src/core/prompt-builders.mjs`

Allowed content:
- backlog item facts
- exact file paths to inspect
- exact plan fields
- exact prior-stage artifact paths
- exact retry error or handoff note

Forbidden content:
- generic philosophy
- generic top-5 or last-5 dumps by default
- hidden asset relabeling
- inferred policy
- long prose summaries when file paths suffice

### Layer 4: on-demand retrieval

Owner: repo

Purpose:
- retrieve small, relevant memory snippets from disk
- avoid pre-dumping large context blocks

## 8. Runtime Prompt Stack

Each agent call should receive, in this order:

1. platform/system layer
2. `src/prompts/runtime-invariants.md`
3. its role prompt
4. its stage-local runtime capsule

Nothing else should be acting as an invisible fifth prompt layer except the agent's own current session.

Which is why the session policy matters.

## 9. Session and Context Policy

### 9.1 Server vs session

The OpenCode server may persist.
The conversational session must not persist across the whole loop.

Required policy:
- reuse server when healthy
- create a fresh session per stage attempt

That means:
- ideator attempt gets its own session
- planner attempt gets its own session
- executor attempt gets its own session
- evaluator attempt gets its own session
- summarizer attempt gets its own session

No stage shares session history with another stage.
No cycle shares stage-session residue with a later cycle.

### 9.2 Reason

Fresh sessions prevent:
- role bleed
- stale prompt residue
- prior failure contamination
- compaction pressure from endless transcript growth

### 9.3 Browser visibility

Keep the current useful behavior:
- log the active session URL
- auto-open the first session of a run by default

Optional debug mode may auto-open every stage session, but the default should not spam tabs in endless mode.

## 10. Role Model

### 10.1 Ideator

Job:
- produce one backlog candidate when backlog depth is low
- make market family, timeframe, and history needs explicit
- avoid repeated failed combinations unless justified

Must not:
- produce full execution plans
- produce execution or evaluation logic

### 10.2 Planner

Job:
- turn one backlog item into one falsifiable experiment plan
- explicitly choose market family, instrument or selection rule, timeframe, history depth, and success criteria
- specify real WFA path and expected artifacts

Must not:
- ideate
- execute
- score results

### 10.3 Executor

Job:
- run the real WFA path
- acquire data when required
- debug local failures using exact evidence
- return only verified artifacts and metrics

Must not:
- mutate official factory state files
- claim execution from setup milestones or shallow checks

### 10.4 Evaluator

Job:
- verify evidence from disk
- judge performance, robustness, and overfitting risk
- decide whether the result deserves promotion or follow-up

Must not:
- re-execute or debug
- promote weak or synthetic evidence

### 10.5 Summarizer

Job:
- convert one evaluated run into durable lessons, concise summary, and exact next actions
- emit only fields the orchestrator truly consumes

Must not:
- mutate official factory state files directly
- invent archival structure the orchestrator does not use

## 11. Endless-Loop Control Plane

### 11.1 Required machine properties

Endless mode must be:
- resumable
- bounded in growth
- explicit in failure handling
- able to survive infrastructure noise without destroying research continuity

### 11.2 Backlog lease model

Current status-only backlog flow is too weak.

Backlog items need explicit lease and disposition fields.

Required fields:
- `status`: `ready|leased|research_complete|research_inconclusive|research_blocked|infra_blocked|abandoned`
- `lease_owner`
- `lease_expires_at`
- `current_run_id`
- `last_failure_class`
- `resume_from_stage`

Key rule:
- infrastructure failures must not retire research ideas

### 11.3 Per-run state

Each run must have:
- `factory/runs/<run_id>/run-state.json`

Required fields:
- `run_id`
- `backlog_item_id`
- `stage_status.ideator` if applicable
- `stage_status.planner`
- `stage_status.executor`
- `stage_status.evaluator`
- `stage_status.summarizer`
- `failure_class`
- `resume_from_stage`
- `attempt_counts`
- `artifact_paths`
- `handoff_pending`

This is the resumable machine truth.

### 11.4 Startup recovery

Before generating new work, the loop must:
- recover expired leases
- inspect pending handoffs
- resume the most advanced safe run first

New ideation should only happen when there is no resumable work and backlog depth is too low.

## 12. Failure Taxonomy

The loop must classify failures before deciding what to do.

Required classes:
- `transport_failure`
- `stage_output_failure`
- `execution_failure`
- `research_failure`
- `environment_failure`
- `orchestrator_bug`
- `interruption`

Meaning:
- `transport_failure`
  - SDK timeout, headers timeout, session disconnect, fetch failure
- `stage_output_failure`
  - malformed JSON, schema mismatch, missing required fields
- `execution_failure`
  - command actually ran but engine/config/data failed
- `research_failure`
  - the strategy idea was genuinely tested enough to judge it weak or structurally blocked
- `environment_failure`
  - broken venv, bad filesystem state, disk issues, corrupted repo state
- `orchestrator_bug`
  - prompt-builder bug, summary bug, control-plane bug
- `interruption`
  - signal, machine restart, process crash

Only `research_failure` should directly change the idea-level research disposition.

## 13. Retry and One-Time Handoff Policy

### 13.1 Retry model

Retries must stop being blind reruns.

Each retry should carry only the smallest useful delta:
- transport retry
  - exact failure class and fresh session
- schema retry
  - exact validator error only
- execution retry
  - exact command, exact error, exact inspected path

### 13.2 Handoff rule

If a stage exhausts retries or the process dies, write:
- `factory/runs/<run_id>/handoff.json`

Required fields:
- `resume_from_stage`
- `failure_class`
- `last_error`
- `attempts_used`
- `safe_inputs`
- `produced_artifacts`
- `consumed: false`

On next startup:
- resume this handoff first
- inject a one-time failure note only into the resumed stage capsule
- mark the handoff consumed after use

That failure note must not leak into future unrelated loops.

### 13.3 Stage attempt artifacts

Each stage attempt should write:
- `stage-input.json`
- `stage-prompt.txt`
- `stage-response.raw.txt`
- `stage-validated.json` when valid
- `stage-error.json` when invalid

This gives exact recovery context without depending on prior chat history.

## 13A. Stage Gates

No stage should advance unless the previous stage passed its gate.

Required gates:
- planning gate
  - valid plan schema
  - explicit market/timeframe/history scope
  - exact expected artifacts and success criteria
- execution gate
  - execution status matches evidence
  - claimed artifacts exist
  - claimed metrics come from real outputs
- evaluation gate
  - verification references exact artifact paths
  - promotion decision matches evidence policy
- summarization gate
  - lessons and next actions are specific enough to persist
  - summarizer output matches what orchestrator actually consumes

## 14. Market Scope and Exploration Policy

### 14.1 Allowed deterministic scope

The only stable deterministic scope the user currently wants is market family:
- crypto
- forex
- prediction markets, especially Polymarket

Anything more specific than that must be explicit in current policy or current task.

### 14.2 Market policy file

Add:
- `factory/market-policy.json`

This file should be the explicit operator-visible place for:
- market-family priorities
- allowed source families
- default history rules by market family
- any exclusions
- version and last-updated metadata

This file must not encode hidden fixed-asset defaults.

### 14.3 Exploration rule

The loop must balance:
- exploration of new ideas
- revisiting promising families
- deprioritizing repeatedly weak or structurally broken directions

But this balance must come from explicit policy plus evidence, not from hidden prompt heuristics.

### 14.4 Planner scope requirements

Every plan must explicitly state:
- chosen market family
- chosen instrument or instrument-selection rule
- chosen timeframe
- required historical depth
- source plan
- why this scope is selected now

## 14A. Research-Selection Policy

Architecture cleanliness is not the goal by itself.
The loop exists to improve profitable-strategy discovery.

That requires an explicit selection policy for what gets explored, revisited, promoted, or abandoned.

### 14A.1 Backlog priority inputs

Backlog prioritization should use explicit factors:
- evidence quality from comparable prior runs
- OOS robustness and generalization
- trade count adequacy
- transaction-cost resilience
- regime breadth or structural relevance
- novelty relative to recent failures
- repeated blocker patterns

### 14A.2 Revisit policy

Promising families should be revisited when:
- OOS performance is positive but below gate with strong evidence quality
- robustness is mixed but not clearly overfit
- execution revealed a fixable design flaw rather than a dead idea

Families should be deprioritized or abandoned when:
- repeated real WFA runs show poor OOS behavior
- trade count remains structurally too low across justified variants
- the same blocker repeats without new information

### 14A.3 Promotion policy

Promotion to leaderboard or high-priority revisit should depend on:
- verified real WFA artifacts
- meaningful OOS metrics
- acceptable robustness and overfitting profile
- sufficient trade count
- evidence that survives realistic costs

### 14A.4 Exploration policy

The loop should not collapse into one repeated family just because it once looked good.

Required behavior:
- preserve some exploration of new families and market combinations
- preserve some exploitation of promising families
- make the tradeoff explicit in backlog and evidence policy, not hidden in prompt text

## 15. WFA Execution Contract

Executor success means a real WFA run with real output artifacts.

The following do not count as execution:
- syntax checks
- import success
- config parse success
- checkpoint logs
- setup milestones
- smoke-only validation

The legacy launcher name `walk_forward_smoke_test.py` is acceptable only when it truly launches the full WFA engine path.

If used, the executor must still prove:
- real walk-forward windows ran
- real output files exist
- real metrics were extracted from real artifacts

### 15.1 Executor debug sequence

When execution fails before real WFA outputs exist, executor behavior must follow this sequence:
- reproduce the exact command
- inspect the exact file, config, or data path involved
- state one concrete root-cause hypothesis
- change one thing only when a local fix is justified
- rerun and compare

Blocked status is only valid after serious local debugging and realistic data-acquisition attempts were tried and recorded.

## 16. Minimal Memory Layer

### 16.1 Philosophy

The memory layer should improve judgment over time without bloating prompts.

This is not ML.
This is not RL.
This is retrieval plus durable lessons.

### 16.2 Canonical memory artifacts

Keep these as primary machine memory:
- `factory/memory/lessons.jsonl`
- `factory/evidence/index.json`
- `factory/leaderboard.json`
- `factory/memory/retrieval_index.json` (new, derived)

Keep these as human-facing only:
- `factory/strategy_digest.md`
- `factory/summaries/`

### 16.3 Lesson schema policy

Every appended lesson must follow one stable schema version.

Each lesson should include:
- identifiers
- strategy family
- asset or scope rule
- timeframe
- verdict
- metrics
- lesson text
- specific finding
- retrieval text
- related artifact paths

Old string-style or malformed lessons must be normalized or quarantined.

### 16.4 Retrieval policy

Retrieval must be stage-specific and small.

Planner receives:
- 3 to 6 relevant lessons
- 1 contradiction if relevant
- 1 to 2 comparable promoted runs

Executor receives:
- 2 to 4 execution-relevant lessons
- known blocker patterns
- relevant engine/config/data paths

Evaluator receives:
- exact plan
- exact execution result
- 1 to 2 comparable prior experiments if helpful

Summarizer receives:
- exact run artifacts
- prior comparable lessons only when contradiction detection is needed

### 16.5 Retrieval ranking

Ranking should use explicit scoring features, not generic recency only:
- stage relevance
- market-family match
- asset match when applicable
- strategy-family match
- evidence quality
- recency
- contradiction value

### 16.6 Memory validation

Memory must be validated:
- on startup
- after every append
- on rebuild of retrieval index

Invalid lines must not be silently dropped.

Instead:
- write a repair report
- move bad fragments to `factory/memory/quarantine/`
- rebuild `factory/memory/retrieval_index.json`

### 16.7 Bounded growth policy

Endless operation requires bounded memory growth.

Required policies:
- retrieval index is rebuilt, not endlessly appended without cleanup
- run artifacts have retention and archival rules
- health logs are bounded
- human summaries may accumulate, but machine retrieval must stay compact

### 16.8 Obsidian stance

Obsidian is optional and downstream.

Allowed:
- export or mirror summaries/digests into an Obsidian-friendly folder later

Forbidden:
- making runtime depend on vault structure, plugins, backlinks, or Obsidian APIs

## 17. Evidence and Simulation Policy

Simulation is orchestration validation only.

Required rules:
- simulate mode must never emit evidence that looks like real execution
- simulate mode must never enter leaderboard
- simulate mode must be clearly separated in evidence index
- evaluator must never promote simulate, blocked, or weak evidence runs

## 18. Repo Organization Map

The loop should make it obvious where to look.

### 18.1 Human/operator truth

- architecture: `factory/long-term-loop-architecture-spec.md`
- repo doctrine: `AGENTS.md`

### 18.2 Runtime prompt truth

- invariants: `src/prompts/runtime-invariants.md`
- roles: `src/prompts/*.md`
- task capsules: `src/core/prompt-builders.mjs`

### 18.3 Machine policy truth

- market policy: `factory/market-policy.json`
- validators and gates: orchestrator plus validator modules

### 18.4 Evidence and memory truth

- run state and handoff: `factory/runs/<run_id>/`
- evidence index: `factory/evidence/index.json`
- lessons: `factory/memory/lessons.jsonl`
- retrieval index: `factory/memory/retrieval_index.json`

## 19. Schema Inventory

The architecture requires explicit ownership of the main machine schemas.

- `factory/backlog.json`
  - owner: orchestrator
  - role: queue plus lease/disposition state
- `factory/runs/<run_id>/run-state.json`
  - owner: orchestrator
  - role: resumable stage truth
- `factory/runs/<run_id>/handoff.json`
  - owner: orchestrator
  - role: one-time restart handoff
- `factory/memory/lessons.jsonl`
  - owner: summarizer output via orchestrator persistence
  - role: canonical durable lessons
- `factory/evidence/index.json`
  - owner: orchestrator
  - role: normalized run index
- `factory/leaderboard.json`
  - owner: orchestrator
  - role: promoted real evidence only
- `factory/memory/retrieval_index.json`
  - owner: rebuild pipeline
  - role: stage retrieval surface
- `factory/market-policy.json`
  - owner: operator-controlled policy unless later explicitly changed by design
  - role: visible market/source/history policy

## 20. Required Pre-Implementation Cleanup

Before major implementation begins:
- there must be one active north-star architecture spec only
- dead or duplicate prompt doctrine files must be retired or archived
- the repo must stop carrying overlapping north-star docs
- project memory and references must point to the active spec

## 21. Implementation Tasks By File

### `opencode.json`

- stop runtime injection of `AGENTS.md`
- inject only `src/prompts/runtime-invariants.md`
- add dedicated `ideator` agent

### `AGENTS.md`

- keep as human/operator doctrine only
- stop treating it as optimized runtime prompt text

### `src/prompts/runtime-invariants.md` (new)

- create tiny shared runtime doctrine file
- keep only universal truths

### `src/prompts/shared-context.md`

- remove from runtime injection
- archive or split into human docs if still useful

### `src/prompts/shared-guidance.md`

- archive or delete if unused

### `src/prompts/ideator.md` (new)

- create separate ideation role

### `src/prompts/planner.md`

- reduce to planning contract and schema
- require explicit scope selection and rationale

### `src/prompts/executor.md`

- reduce to execution contract, debug loop, and schema
- keep real-WFA semantics strict

### `src/prompts/evaluator.md`

- reduce prose bloat
- keep strict evidence verification and verdict policy

### `src/prompts/summarizer.md`

- align output with actual orchestrator usage

### `src/core/prompt-builders.mjs`

- convert from strategist to serializer
- remove heuristic name/asset relabeling
- remove generic history dumps
- inject exact file paths and targeted retrieval only
- support one-time retry/handoff note injection

### `src/core/orchestrator.mjs`

- separate ideation from planning
- add run-state checkpoints
- add failure classification
- add lease model
- add startup recovery and handoff consumption
- stop retiring ideas for infra failures
- stop auto-generating hidden fallback backlog items in hardcoded prose

### `src/core/runner-opencode.mjs`

- keep server reuse
- create fresh session per stage attempt
- rotate session on retryable transport failure
- keep session URL logging and first-session auto-open

### `src/core/backlog-store.mjs`

- support lease/disposition model
- support expired lease recovery

### `src/core/state-store.mjs`

- keep global loop health bounded
- do not overload global state with resumable run truth

### `src/cli.mjs`

- add signal handling for graceful handoff writes on shutdown
- exit nonzero on fatal orchestrator bug so external restart is clean

### `src/core/artifact-store.mjs`

- add helpers for run-state, handoff, stage-input, stage-error, and retrieval-index rebuild artifacts

### `src/core/constants.mjs`

- remove hidden market-family narrowing from `FACTORY_GOAL`

### `src/core/runner-simulate.mjs`

- make simulate semantics clearly non-evidentiary

### `factory/memory/lessons.jsonl`

- normalize or quarantine malformed history
- enforce canonical schema version

### `factory/evidence/index.json`

- normalize schema
- separate live and simulate clearly

### `factory/leaderboard.json`

- purge simulate and inconclusive pollution
- rebuild using strict promotion rules

### `factory/memory/retrieval_index.json` (new)

- build derived retrieval entries from lessons plus evidence

### `factory/market-policy.json` (new)

- create explicit operator-visible market/source/history policy file

## 22. Implementation Phases

### Phase 1: Prompt-layer surgery

- create `runtime-invariants.md`
- remove runtime use of `AGENTS.md`
- remove runtime use of `shared-context.md`
- add `ideator.md`
- slim role prompts

### Phase 2: Runtime capsule cleanup

- rewrite `src/core/prompt-builders.mjs`
- remove hidden heuristics and generic dumps
- inject only exact facts and targeted retrieval

### Phase 3: Session isolation

- switch to fresh session per stage attempt
- keep server reuse
- preserve useful browser visibility behavior

### Phase 4: Control-plane hardening

- add leases
- add run-state checkpoints
- add failure classes
- add startup recovery
- add handoff files

### Phase 5: Memory normalization

- repair lessons
- rebuild evidence index
- add retrieval index
- introduce stage-specific retrieval

### Phase 6: Evidence cleanup

- isolate simulation semantics
- rebuild leaderboard cleanly
- tighten promotion rules

## 23. Validation Plan

### 23.1 Hard acceptance criteria

- one active architecture spec only
- one tiny runtime invariant file only
- no runtime overlap between shared doctrine, role contracts, and capsules
- each stage gets a fresh session
- planner and ideator are separate
- executor success requires real WFA artifacts
- infra failures do not retire research ideas
- one-time handoff notes do not leak beyond the resumed stage
- memory validates cleanly
- leaderboard contains only real promotable evidence
- no hidden asset narrowing in active helpers or constants

### 23.2 Health metrics

Track at minimum:
- prompt bytes per stage
- compaction frequency
- session reuse count
- transport retry recovery rate
- stranded lease count
- resumable-run recovery rate
- memory validation failure count
- simulate entries in leaderboard (target: zero)
- asset/timeframe distribution across live runs
- percent of plans with explicit scope justification

## 24. What Not To Build

Do not build any of the following unless a later need is proven:
- embeddings
- vector databases
- RL loops
- model-weight adaptation
- knowledge graphs
- Obsidian plugin integration
- a second parallel prompt system
- a second WFA truth path for convenience

## 25. Final Position

The best architecture for this project is not the most elaborate one.

It is the one that:
- stays lean
- stays explicit
- stays organized
- keeps roles cold and narrow
- keeps continuity on disk instead of in chat residue
- avoids hidden steering
- lets the loop roam intelligently across crypto, forex, and prediction markets
- improves over time through memory quality, not prompt bloat

This is the architecture most likely to stay healthy for a long-running factory whose actual purpose is to find profitable strategies, not to look busy.

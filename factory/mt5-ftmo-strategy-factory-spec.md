# MT5/FTMO Strategy Factory Spec

## 1. Document Status

This document is the authoritative architecture and decision spec for the strategy factory.

It defines:

- what the factory is optimizing for
- what counts as valid evidence
- what Python is allowed to do
- what MQL5 is allowed to do
- when a strategy becomes a serious candidate
- what must happen before a strategy is considered deployable for MT5/FTMO

This document is a specification, not a research memo.

Research documents may justify decisions, but they do not override this spec.

This spec supersedes earlier architecture conclusions wherever there is a conflict, especially where older reasoning implied that Python-only serious candidates were sufficient for MT5-native deployment confidence.

Revision note, 2026-04-28:

- the doctrine below remains authoritative
- the implementation order is now proof-first, not governance-first
- normal agent prompts must receive compact policy capsules, not this full spec
- the first deliverables are minimal control-plane evidence support, MT5/data identity, `FILE_COMMON` smoke, tester lifecycle proof, and FTMO rule-ledger skeletons

Revision note, 2026-05-11:

- the MT5/FTMO deployment doctrine remains authoritative
- the immediate implementation order is amended: insert worker-launched WFA execution truth before native MQL5 expansion, broad ResearchBrain work, agent-framework migration, portfolio work, or forward/live automation
- new run-level `executed` claims for `evidence_kind: research_wfa` require a deterministic WFA run worker that launched the WFA and was accepted by the control plane with verified worker provenance, artifacts, hashes, metrics, windows, and trade counts
- legacy WFA envelopes that only officialized existing artifacts may remain historical evidence when labeled as such, but they do not satisfy the new worker-launched WFA canary gate
- minimal trial accounting is mandatory from the first WFA worker slice, including failed, blocked, timed-out, LLM-generated, manual, optimizer, mutation, repair, and rerun attempts
- SQLite becomes the next repo-contained runtime mirror plus lease/outbox support after the worker-launched WFA canary path exists; JSON remains the official orchestration state and human-readable artifact/projection surface until a later spec amendment explicitly expands SQLite authority
- OpenCode is optional supervised tooling and an optional bounded cognitive backend, not the production control plane, evidence authority, or execution authority

Revision note, 2026-05-17:

- the corrected Phase 8 continuation is merged into this active spec; temporary Phase 8 research docs are no longer implementation authority after their accepted decisions are represented here
- Phase 8 is renamed to `Strategy Factory Production Readiness` and split into 8A MT5 tradable-universe/data alignment, 8B bounded ResearchBrain, 8C WFA/anti-overfit hardening, 8D hypothesis-led candidate screening, and 8E MT5 Strategy Tester parity
- the post-Phase-7C boundary is amended: Phase 8A-8D may proceed as non-deployment research-factory readiness work; Phase 8E remains blocked until a Phase 8D survivor, verified MT5 instrument equivalence, and explicit operator authorization exist
- this revision changes architecture direction only; it does not claim code implementation, strategy success, or evidence cleanup

Post-merge architecture review note, 2026-05-17:

- the Phase 8 merge is accepted as the active direction, but the review findings below are now part of this spec and must guide implementation
- Phase 7C is closed only as advisory statistical-consumer infrastructure; deterministic statistical input producers and hard statistical promotion gates remain deferred
- Historical 2026-05-17 baseline: Phase 8 evidence kinds listed in this spec were schema/acceptance contracts until deterministic producers, validators, and prompt/retrieval wiring were implemented in later slices
- Historical 2026-05-17 baseline: MT5 snapshot code supported explicit single-symbol probing; Phase 8A later closed with a real FTMO MT5 universe snapshot and data-alignment inventory
- Current 2026-05-22 baseline: Phase 8B deterministic Stage-0 contracts, validators, retrieval/indexing, request preparation, runtime seam, and fixture/scripted tool-loop plumbing exist, but live ResearchBrain is not implemented; WFA pre-registration, low-frequency registration, Phase 8D screening, and Phase 8E parity remain pending
- current WFA validator/prompt floors are weaker legacy gates; Phase 8D positive/survivor labels require the stricter Phase 8C/8D gates before screening begins
- current parity/promotion helpers do not yet enforce explicit operator authorization for Phase 8E; Phase 8E must remain blocked until that authorization artifact exists
- web/doc challenge supported the direction: MT5 terminal evidence, `FILE_COMMON` tester bridging, FTMO rule separation, time-series-aware anti-overfit controls, and simple bounded AI agents are consistent with current public docs and best-practice guidance

Implementation tracking rule, added 2026-04-30:

- every completed phase, task, and exit criterion in this spec must be explicitly ticked with `[x]` in the relevant implementation section
- partially implemented work must be marked `[~]` with a short note naming what is done and what remains
- pending or blocked work must remain `[ ]` and must not be implied complete by narrative text
- status ticks are evidence claims; only tick work that has disk-backed artifacts, tests, or exact blocked diagnostics
- every implementation session that changes code, workers, tests, evidence gates, artifacts, or factory behavior must update this spec before stopping: tick newly completed items, mark partial items `[~]` with a short explanation, and leave blocked/pending items `[ ]` with a concise reason when the absence would confuse future agents
- future agents must audit nearby checklist items after verification; do not rely on chat summaries as durable status truth

### Scope

This spec governs strategies intended for one or both of the following deployment surfaces:

- MT5-connected execution with FTMO-style constraints
- native MT5/MQL5 deployment on MT5 terminals

It governs:

- candidate lifecycle
- parity definitions
- promotion authority
- deployment-mode branching
- anti-false-confidence rules

It deliberately stays architecture-first, but later sections ground the doctrine in:

- current repo insertion points
- phase-level implementation targets
- explicit promotion and proof requirements

It is not a line-by-line coding guide, but it is specific enough to constrain implementation direction.

### Non-Goals

This factory is not trying to:

- maximize the number of strategies regardless of realism
- certify deployment candidates from external backtests alone
- build a universal multi-broker architecture first
- optimize for elegance over truthfulness
- duplicate every strategy in every language from the start
- create team/process/PR bureaucracy for a one-operator project

## 2. Mission

The mission of the factory is to produce strategies that survive the environment they are actually meant to trade in.

For MT5/FTMO-bound strategies, that means the factory must optimize for:

- realistic strategy discovery
- realistic validation
- realistic deployment progression
- minimum false confidence

The factory does **not** exist to output attractive research artifacts. It exists to output strategies that remain credible when they leave the research environment.

The operating principle is:

**search can be cheaper than truth, but promotion cannot be cheaper than truth.**

That means:

- cheap layers are allowed for search
- cheap layers are not allowed to certify deployment readiness

The factory should favor simple strategies with strong structural logic and realistic execution over complicated strategies that only survive in the research stack.

## 2A. Solo-Project Operating Doctrine

This is a solo-operated research and trading system.

Solo operation changes the structure of the project, but it does **not** lower quality standards.

The architecture must remove coordination overhead that exists only for teams while preserving:

- evidence quality
- reproducibility
- safety gates
- failure memory
- auditability
- deterministic execution
- repo cleanliness
- low-token operation

### 2A.1 What Solo Means

Solo means:

- no PR-style communication artifacts
- no team handoff rituals
- no committee approvals
- no enterprise process theater
- no duplicated doctrine across many documents
- no verbose reports that do not affect decisions

Solo does **not** mean:

- weaker evidence
- weaker risk controls
- weaker MT5 parity
- weaker data validation
- weaker deployment gates
- weaker artifact discipline

The project is built for one accountable operator who needs compact decision packets, not team ceremonies.

### 2A.2 Human Oversight Model

Human oversight should be exception-driven.

Human approval is required only for decisions that increase risk, cost, or irreversibility:

- promotion beyond research WFA
- accepting an MT5 parity exception
- enabling FTMO demo/forward execution
- enabling live execution
- changing risk limits
- changing capital allocation
- adding a new broker/execution integration
- trusting a new external data source
- deleting or tombstoning protected evidence

Human approval is not required for:

- routine failed experiments
- inconclusive experiments
- deterministic data validation
- deterministic WFA execution
- MT5 tester runs
- evidence indexing
- safe scratch cleanup
- failed-pattern memory updates backed by artifacts

When human input is needed, the system should produce a compact decision packet:

```text
Decision needed: promote/reject/continue/approve-risk-change
Candidate: <candidate_id>
Stage: <stage>
Evidence: <artifact paths>
Key metrics: <compact metrics>
Main risk: <one-line>
System recommendation: <one-line>
Required operator action: <approve/deny/edit>
```

### 2A.3 Documentation Policy

Documentation must be operational.

Keep documents that:

- define execution invariants
- define schemas or gates
- preserve architecture decisions
- summarize evidence
- help the operator trust, reject, or continue a strategy

Avoid documents that:

- repeat doctrine already present in the spec
- exist only for imagined team communication
- summarize trivial implementation work
- grow without changing future execution
- are disconnected from artifacts, gates, or backlog items

Rule:

**If a document does not guide future execution, explain evidence, define a gate, or preserve an important decision, it should be compressed, archived, or removed by policy.**

## 3. Core Doctrine

The following rules are mandatory unless explicitly revised by a newer spec.

1. **Search, validation, and deployment are different jobs.**
   They may share ideas and artifacts, but they do not have the same authority.

2. **Python is the discovery layer by default.**
   Python is the primary environment for broad research, hypothesis generation, WFA search, and cheap rejection of weak ideas.

3. **MT5/FTMO deployment readiness cannot be certified from Python evidence alone.**
   Python can nominate candidates. It cannot, by itself, certify MT5-bound deployability.

4. **If final deployment is native MT5/MQL5, serious candidates must become native MQL5 before final confidence is granted.**
   Late porting after all serious testing is forbidden as a validation model.

5. **If final deployment is Python-controlled through MT5, Python may remain the live strategy brain, but MT5 execution semantics still remain mandatory validation.**
   In that mode, Python logic can stay authoritative, but external simulation still cannot certify deployment on its own.

6. **The decisive validation environment must converge toward the real deployment environment.**
   The closer a strategy gets to deployment, the less acceptable research-only assumptions become.

7. **The factory must preserve one clear authority per stage.**
   Silent dual authority between Python and MQL5 is not allowed.

8. **Complexity is only justified when it reduces false positives, translation risk, or operational risk.**
   Complexity that does not serve realism or certification quality is harmful.

9. **Most ideas should die before native implementation work begins.**
   Native MQL5 effort is for shortlisted serious candidates, not for broad exploration.

10. **A strategy that cannot be specified clearly enough to graduate cleanly is not robust enough to deserve deployment confidence.**

11. **The factory must optimize for survivability, not only for discoverability.**
   Fast search matters, but only if the graduation path kills false positives before deployment.

12. **Simplicity is a first-class quality constraint.**
    The preferred strategy is the simplest one that survives realistic validation.

13. **Execution truth precedes research sophistication.**
    New WFA, MT5, MQL5, parity, FTMO, or forward execution claims are official only when a deterministic worker performed the execution and the control plane accepted its verified artifacts.

14. **The trial denominator is part of the evidence.**
    Failed, blocked, timed-out, optimizer, mutation, manual, LLM-generated, repair, and rerun attempts must be recorded before advanced overfit statistics are trusted.

15. **Research sources are not trading evidence.**
    Citations, papers, repos, and web findings may justify hypotheses and constraints. They cannot prove profitability, WFA execution, MT5 parity, FTMO survivability, or promotion readiness.

16. **OpenCode may propose, but workers must prove.**
    OpenCode can remain a supervised development/debugging tool and optional bounded cognitive backend. It must not become the production control plane, execution authority, metrics authority, evidence promoter, state writer, or live trading actor.

## 4. Parity Types

The factory must distinguish different kinds of parity. Confusing them creates false confidence.

### 4.1 Research Parity

Research parity asks:

- does the strategy idea survive robust external research controls?
- does it retain edge under realistic search hygiene?

Research parity is mainly about:

- data integrity
- WFA discipline
- robustness
- parameter stability
- regime survival
- avoiding obvious overfitting

Research parity is primarily established in the external research stack.

Research parity does **not** prove:

- MT5 platform behavior
- native implementation equivalence
- FTMO operational survivability

### 4.2 Execution Parity

Execution parity asks:

- if the same strategy intent is applied inside MT5 semantics, do the resulting orders, fills, costs, and state transitions still behave acceptably?

Execution parity is about:

- spread
- commission
- swap
- fill mechanics
- pending order behavior
- stop/limit behavior
- account mode behavior
- symbol constraints
- tester/runtime rules

Execution parity is primarily established by MT5 Strategy Tester and later by forward execution in the MT5 environment.

Execution parity does **not** automatically prove:

- that the deployable code is the same logic family as the research code
- that a later native rewrite will behave identically

### 4.3 Code/Logic Parity

Code/logic parity asks:

- is the code that will actually be deployed the same logic family as the code that was decisively validated?

This is the parity type that removes translation risk.

Code/logic parity matters most when the final deployment surface is native MQL5.

If deployment is native MQL5, then code/logic parity requires that serious candidates exist as native MQL5 implementations before final confidence is granted.

If deployment is Python-controlled via MT5, then Python remains the code authority and native MQL5 code/logic parity is not mandatory by default.

### 4.4 Deployment Parity

Deployment parity asks:

- does the candidate survive the actual forward environment that will carry real risk?

Deployment parity is about:

- operational behavior
- reconciliation
- environment drift
- FTMO rule survival
- realistic end-to-end behavior after the tester stage

Deployment parity is established by forward/demo/live progression, not by research backtests and not by tester results alone.

### 4.5 Required Interpretation

The factory must obey the following interpretation rules:

- research parity without execution parity is insufficient for MT5-bound deployment
- execution parity without code/logic parity is insufficient for native-MQL5 deployment confidence
- tester parity without deployment parity is insufficient for FTMO deployment confidence
- no earlier parity type may substitute for a later one

## 5. Deployment Modes

The factory must support two explicit deployment modes. They are not equivalent and they must not be mixed casually.

### 5.1 Mode A: Python-Controlled Execution Through MT5

In this mode:

- Python remains the strategy brain
- MT5 is the execution environment and account/runtime surface
- the final deployable artifact is a Python-controlled strategy integrated with MT5 execution

In this mode, the authoritative logic remains Python.

Required validation chain:

1. research parity in Python
2. MT5 execution parity
3. FTMO/demo deployment parity

In this mode, native MQL5 is optional unless terminal-native logic becomes materially necessary.

This mode is coherent only if the live strategy is truly intended to remain Python-authoritative.

### 5.2 Mode B: Native MQL5 EA Deployment

In this mode:

- Python is the discovery and search layer
- MQL5 becomes the serious-candidate and deployment logic layer
- the final deployable artifact is a native MQL5 EA

In this mode, decisive validation must move onto the native MQL5 implementation before deployment confidence is granted.

Required validation chain:

1. research parity in Python
2. native MQL5 serious-candidate implementation
3. MT5 tester validation of the native candidate
4. FTMO/demo deployment parity of the native candidate

In this mode, Python evidence alone can never certify a deployment candidate.

### 5.3 Undecided Final Deployment

If final deployment mode remains undecided, the spec must default to the safer interpretation.

That means:

- Python may remain the broad search layer
- no strategy may be called deployment-ready until the deployment mode is chosen
- if a strategy is a serious contender for native MT5 deployment, native MQL5 graduation becomes mandatory before final confidence

Practical implication:

- undecided mode does **not** justify Python-only decisive validation for strategies that may later become native EAs

### 5.4 Mode-Change Rule

If a strategy changes deployment mode, it must re-enter the appropriate validation chain.

Examples:

- a strategy validated for Python-via-MT5 is **not** automatically validated for native MQL5 deployment
- a research candidate intended for native MQL5 cannot skip native graduation because it previously passed Python tests

## 6. Candidate Graduation Ladder

The factory must use a stage-based candidate lifecycle. Stage names are normative, not decorative.

### Stage 0: Hypothesis

Definition:

- a market idea or structural claim

Purpose:

- decide whether the idea deserves coding effort

Minimum output:

- a plain-language rationale
- expected market behavior
- expected execution style
- expected failure modes

Not allowed:

- profitability claims
- deployment claims

### Stage 1: Python Exploratory Candidate

Definition:

- the first coded version of the hypothesis in the research environment

Purpose:

- cheap falsification
- reject weak ideas quickly

Minimum evidence:

- deterministic implementation
- minimal backtest evidence
- no obvious leakage
- no obvious data abuse

Allowed claim:

- worth further research

Not allowed:

- MT5 realism claims
- deployment claims

### Stage 2: Python Robust Candidate

Definition:

- a Python candidate that has survived serious external research controls

Purpose:

- determine whether the idea deserves expensive validation work

Minimum evidence:

- robust WFA evidence
- stress evidence
- parameter robustness
- sufficiently simple explanation of edge
- evidence that the idea is not trivially dependent on unrealistic assumptions

Allowed claim:

- research-credible candidate

Not allowed:

- MT5-certified
- FTMO-ready
- native-deployable

### Stage 3: Serious Candidate

Definition:

- a shortlisted candidate worthy of deployment-proximate validation work

This is the decisive branching stage.

#### Stage 3A: Serious Candidate Under Mode A

Applies when final deployment is Python-controlled via MT5.

Requirements:

- Python remains the logic authority
- the candidate is prepared for MT5 execution-semantic validation
- order intent and execution assumptions are explicit enough to be tested under MT5 semantics

Meaning:

- the candidate is serious because it is close to live Python-via-MT5 usage

#### Stage 3B: Serious Candidate Under Mode B

Applies when final deployment is native MQL5, or when native deployment remains a real possible destination.

Requirements:

- a native MQL5 candidate implementation exists
- the candidate is no longer only a Python idea with deferred translation risk
- serious validation from this point onward must judge the native implementation

Meaning:

- the strategy has graduated from research logic to deployment-proximate logic

Core rule:

- if the strategy may become a native MT5 deployable, Stage 3B cannot be skipped indefinitely

### Stage 4: MT5-Tested Candidate

Definition:

- a serious candidate that has passed MT5 tester validation under acceptable settings

Purpose:

- validate platform realism before forward deployment confidence

Required interpretation:

- under Mode A, this validates Python-authoritative logic under MT5 execution semantics
- under Mode B, this validates the native MQL5 candidate in the actual MT5 tester runtime

Allowed claim:

- tester-validated candidate

Not allowed:

- live-ready
- FTMO-ready without forward evidence

### Stage 5: FTMO Forward Candidate

Definition:

- a tester-validated candidate that has entered forward validation under FTMO-like conditions

Purpose:

- validate deployment parity and operational survivability

Minimum evidence:

- FTMO rule survival
- state reconciliation
- no critical operational mismatch
- no fatal divergence from expected behavior

Allowed claim:

- forward-validated candidate

### Stage 6: Deployable Strategy

Definition:

- a candidate that has passed the full chain required by its deployment mode

A strategy is deployable only when:

- its deployment mode is explicit
- all required parity types for that mode have been satisfied
- its final deployable artifact is the same code family that was decisively validated

That means:

- under Mode A, the Python-controlled strategy is the deployable artifact
- under Mode B, the native MQL5 strategy is the deployable artifact

### 6A. MT5 Instrument Classification

For MT5/FTMO-bound research, the target FTMO MT5 terminal is the instrument authority.

External crypto data is useful for broad, low-cost discovery. It is not deployment-proximate MT5 evidence unless MT5 instrument equivalence is verified.

Instrument classifications:

- `mt5_verified`: exact or approved equivalent symbol exists in the target FTMO MT5 terminal and has snapshot-backed symbol specs
- `mt5_proxy`: external data approximately maps to an MT5 CFD, but differences are documented
- `non_mt5_research_only`: useful for discovery, but not eligible for MT5/FTMO candidate promotion

Candidate manifests for MT5-bound research must include `deployment_intent`, `research_instruments`, `mt5_instrument_equivalence`, `data_relevance_classification`, exact MT5 terminal symbol when verified, snapshot artifact path/hash, and known differences from external data.

### Stage Authority Summary

The ladder must be interpreted strictly:

- Stage 1 and Stage 2 produce research candidates
- Stage 3 creates serious candidates
- Stage 4 validates tester realism
- Stage 5 validates forward realism
- Stage 6 is the only deployable stage

The words are not interchangeable.

## 7. Promotion Authority

The factory must define which layer is allowed to certify which claim.

### 7.1 Python Research Authority

Python research is allowed to:

- generate hypotheses
- reject candidates
- rank candidates
- nominate candidates for serious validation work

Python research is **not** allowed to certify:

- MT5 execution realism
- native MQL5 deployment readiness
- FTMO deployment readiness

### 7.2 MT5 Tester Authority

MT5 tester is allowed to certify:

- tester-conditioned execution realism
- platform-specific order and cost behavior
- whether a serious candidate survives MT5 tester semantics

Tester evidence is conditioned by the exact tester configuration. Every promotion-relevant tester artifact must record, when available:

- terminal build and broker/server identity
- account mode, currency, leverage, margin model, and initial balance
- symbol exact name and symbol specification
- tick model and history source
- spread source, commission, swap, execution delay, and slippage assumptions
- tester date range, timeframe, deposit/currency, and settings hash

MT5 tester is **not** allowed, by itself, to certify:

- that the candidate is operationally ready for FTMO deployment
- that Python-only logic equals native MQL5 logic
- that tester behavior equals broker/demo/live behavior outside the recorded tester conditions

MT5 parity work must guard against the known false-confidence risks:

- terminal/build/symbol/account drift must be snapshotted and compared before promotion-relevant claims
- tester bridge communication must use the approved artifact shuttle pattern, not network I/O that fails or behaves differently in the tester
- promotion-relevant tester runs must record tester mode, tick model, delay/slippage/spread assumptions, margin mode, and account type
- pending-order strategies need separate parity treatment because placement delay and later server trigger behavior can diverge
- stop level, freeze level, session, swap, and margin constraints must be mirrored or explicitly recorded as unmodeled
- crash/reconnect and duplicate-order behavior cannot be inferred from PnL similarity and must remain forward/demo safety evidence
- FTMO daily/max-loss rules must be reconciled through the FTMO ledger, not inferred from strategy profitability

### 7.3 Native MQL5 Authority

Native MQL5 is required to certify code/logic parity for Mode B.

If final deployment is native MQL5, then the serious candidate must become native before decisive deployment confidence is granted.

In Mode B, native MQL5 is not a convenience layer. It is a required authority layer.

### 7.4 FTMO Forward Authority

FTMO forward/demo validation is allowed to certify:

- deployment-proximate survivability
- rule-accounting survival
- operational reconciliation quality
- whether the strategy behaves acceptably under the forward environment

It is the final validation layer before deployment confidence.

### 7.5 Hard Promotion Rules

The following rules are mandatory:

1. A Python robust candidate may be promoted only to serious-candidate work, not to deployment confidence.
2. A serious candidate may be promoted to tester validation only after its deployment mode requirements are satisfied for that stage.
3. No MT5-native strategy may be promoted from Python evidence alone.
4. No candidate may be called deployable before passing the required forward layer for its deployment mode.
5. If deployment mode is changed, previous promotion authority does not automatically carry over.
6. `PaperTradingAdapter` output may support WFA orchestration/search only; it can never satisfy MT5 tester, MT5 execution, FTMO ledger, FTMO forward, or deployment promotion gates.
7. `walk forward engine/scripts/parity_test.py` is signal-path parity only; it is not MT5 execution parity and cannot satisfy Stage 4 or later gates.

### 7.6 Reserved Vocabulary

The factory should use the following labels precisely:

- `exploratory`
- `robust`
- `serious`
- `tester-validated`
- `forward-validated`
- `deployable`

It must not use the word `validated` without naming the stage and authority.

## 8. Anti-False-Confidence Rules

The factory exists to remove false positives before they become expensive. The following paths are forbidden.

1. **Python-only serious candidates for native-MQL5 deployment.**
   If final deployment is native MQL5, Python-only decisive validation is not acceptable.

2. **Late porting after full confidence has already been granted.**
   Porting after decisive validation is a source of hidden invalidation, not a clerical step.

3. **Treating external PnL as deployability evidence.**
   Attractive research results do not prove MT5/FTMO survivability.

4. **Treating execution parity as code parity.**
   A tester harness or replay path cannot be used to claim native code equivalence if the native candidate does not exist.

5. **Treating tester validation as deployment validation.**
   Tester success is necessary, not sufficient.

6. **Treating undecided deployment mode as permission for lazy validation.**
   Undecided mode increases the need for explicit boundaries; it does not relax them.

7. **Maintaining silent dual authority between Python and MQL5.**
   If both exist, the stage authority must be explicit.

8. **Native-implementing everything too early.**
   Native graduation must be selective, otherwise research throughput collapses.

9. **Scaling before one end-to-end path is proven.**
   Breadth before proof creates organizational noise and weak evidence.

10. **Adding complexity that does not reduce certification risk.**
    More machinery is not better if it does not make false positives less likely.

11. **Allowing stage language to drift.**
    Calling a robust candidate `validated` without naming the authority creates confusion and bad decisions.

12. **Assuming that deployment truth can be inferred instead of earned.**
    The later stage must actually happen; it cannot be replaced by optimism.

### 8.1 WFA Roulette Controls

The factory must not run many WFA experiments and promote whichever result looks best.

Forbidden:

- selecting a strategy because it tops a historical leaderboard
- trying small variations until one clears OOS floors
- renaming a failed mechanism as new without novelty proof
- adding a low-frequency exception after seeing low trade count
- changing assets, thresholds, families, or dates after seeing results
- treating external exchange data as MT5/FTMO deployment evidence without MT5 equivalence and later MT5 parity
- optimizing for the Phase 8D floors as targets

Required controls:

- every Phase 8D experiment must be pre-registered before WFA
- every attempt must enter denominator records, including blocked and failed attempts
- invalidation criteria must be written before execution
- thresholds are minimum credibility floors, not objectives
- advisory DSR/PBO/CPCV/White must be included when inputs exist and explicitly blocked when inputs are missing
- positive/survivor labels must cite artifact-backed metrics and pass Phase 8D floors

Operational worker acceptance remains separate. A WFA worker can prove that a run executed correctly while the strategy remains inconclusive or rejected.

## 9. Current Repo Reality

This section binds the doctrine above to the codebase that actually exists.

### 9.1 Existing Factory Control Plane

The repository already has a real orchestration and evidence layer under `src/`.

Important existing files include:

- `src/cli.mjs`
- `src/core/orchestrator.mjs`
- `src/core/paths.mjs`
- `src/core/artifact-store.mjs`
- `src/core/verification.mjs`
- `src/core/validators.mjs`

What this means:

- the repo already has a usable control plane
- parity evidence, promotion gates, and new MT5 artifacts should extend this control plane
- a second independent orchestration plane for MT5 work would be a mistake
- current execution validation is still WFA-shaped and must be generalized before MT5 evidence can be accepted honestly
- current prompt assembly must use compact policy capsules rather than asking agents to read this full spec each cycle

### 9.2 Existing External Research Plane

The repository already has a substantial Python research engine under `walk forward engine/`.

Important existing files include:

- `walk forward engine/scripts/walk_forward_smoke_test.py`
- `walk forward engine/src/walk_forward/walk_forward_runner.py`
- `walk forward engine/src/backtesting/vectorized_backtest_engine.py`
- `walk forward engine/src/walk_forward/transaction_cost_modeler.py`
- `walk forward engine/src/strategies/`

What this means:

- the external research/search layer already exists
- it should be kept and repurposed as the discovery engine
- it should not be mistaken for the deployment-certification layer

### 9.3 Existing Data, Model, And Adapter Foundations

The repository already contains useful abstractions for account, symbol, order, fill, and data concepts.

Important existing files include:

- `walk forward engine/src/core/models.py`
- `walk forward engine/src/data_handler/market_data_manager.py`
- `walk forward engine/src/api_connector/base_connector.py`
- `walk forward engine/src/api_connector/paper_trading_adapter.py`

What this means:

- the repo does not start from zero
- there is already a conceptual place for real platform adapters
- however, the current adapter layer is still stubbed and not MT5-realistic

### 9.4 Existing Realism Gap

The current repo is materially stronger at external research than at MT5/FTMO certification.

Evidence of that gap:

- `walk forward engine/src/api_connector/base_connector.py` is only an abstract stub
- `walk forward engine/src/api_connector/paper_trading_adapter.py` is a no-op compatibility adapter
- `walk forward engine/scripts/walk_forward_smoke_test.py` still initializes `PaperTradingAdapter`
- no native MQL5 source/binary artifacts exist yet in the repository
- `walk forward engine/src/backtesting/vectorized_backtest_engine.py` still uses scalar `fees` and `slippage`
- `walk forward engine/src/walk_forward/transaction_cost_modeler.py` contains generic cost heuristics, not MT5/FTMO-certified truth
- `walk forward engine/src/data_handler/market_data_manager.py` still carries mixed legacy/live/backtest concerns and non-backtest mock defaults

What this means:

- the repo already has strong research infrastructure
- the repo does **not** yet have MT5-native serious-candidate infrastructure
- current realism mechanisms are useful for search but cannot be treated as deployment-grade certification

### 9.5 Existing Strategy Readiness And Inconsistency

The repo already contains promising candidate strategies and partial parity work, but the first official proof path is not yet regularized.

Relevant files include:

- `walk forward engine/src/strategies/london_breakout.py`
- `walk forward engine/config/strategy_london_breakout.json`
- `walk forward engine/scripts/parity_test.py`
- `walk forward engine/scripts/wfa_london_breakout_full.py`
- `walk forward engine/strategies/london_breakout_rsi/wfa_config.yaml`

What this means:

- the repo has enough material to choose a first proof path
- the current path is fragmented across strategy code, configs, ad hoc scripts, and mixed naming
- before this path can become authoritative, it must be regularized into one canonical route

### 9.6 Repo-Grounded Design Consequences

The correct interpretation of current repo state is:

1. keep the JS control plane as the orchestration authority
2. keep the Python WFA engine as the discovery/search engine
3. add a real MT5 integration layer instead of extending the paper adapter fiction
4. add a native MQL5 serious-candidate path for Mode B strategies
5. add MT5 tester truth and FTMO forward truth as explicit promotion gates
6. do not refactor the repo into a Python production-runtime stack for strategies that are actually meant to graduate into native MT5/MQL5

## 10. Minimal Viable Proof

The factory must prove the architecture on the smallest meaningful path before scaling.

The minimum proof is not "many strategies". It is a sequence of small artifacts that proves the control plane can represent non-WFA evidence, then proves MT5 environment identity, then proves tester communication, then proves tester order lifecycle evidence, and only then attaches a real strategy candidate.

### 10.1 Proof 0: Non-WFA Evidence Representation

The first proof is not MT5 terminal code. It is a control-plane schema proof.

Purpose:

- prove that official artifacts can represent `research_wfa`, `mt5_snapshot`, `mt5_bridge_smoke`, `data_identity`, `mql_build`, `mt5_tester`, `parity_report`, `ftmo_ledger`, `forward_report`, and `promotion_gate`
- prevent MT5 work from being forced into fake WFA-shaped metrics
- update runtime doctrine so `executed` means accepted evidence-kind-specific worker output with verified artifacts and observed metrics appropriate to that kind

Exit criteria:

- WFA execution still validates as `research_wfa`
- a synthetic but schema-valid `mt5_snapshot` result can be represented without WFA metrics
- artifact paths are verified from disk
- normal prompts can reference a compact spec-policy capsule instead of this full spec

### 10.2 Proof 1: MT5 Environment And Data Identity Snapshot

The first MT5 proof is an environment/data snapshot, not a strategy.

Purpose:

- measure terminal build, broker/server, account mode, symbol specs, session/time assumptions, and data availability
- establish fixture choice from observed terminal/account reality, not guessed defaults
- produce hashed artifacts that later tester and parity work can cite

Minimum identity fields:

- terminal build, terminal path or portable-instance label, broker/server, account type/mode, currency, leverage, margin mode
- symbol exact name, point/tick size, digits, contract size, min/max/step volume, stop/freeze levels, swap/commission availability
- timeframe, timezone/server offset, DST/reset assumptions, quote basis, tick-vs-bar source, spread availability, volume semantics, gap report, import path, and content hash

Blocked conditions:

- MT5 terminal path or connection method is unavailable
- symbol metadata cannot be captured
- data coverage cannot be bounded by date/time and hash

### 10.3 Proof 2: `FILE_COMMON` Smoke

The next MT5 proof is a tester-compatible communication smoke test.

Purpose:

- prove that tester-side MQL can write and external workers can ingest run-scoped files through `FILE_COMMON`
- prove stale-message, wrong-run, checksum, and partial-write rejection before strategy or order logic is added

Minimum fields:

- run ID, schema version, sequence number, timestamp, payload checksum, producer identity, expected artifact path, and observed ingestion status

Blocked conditions:

- smoke proof requires tester-side network calls
- smoke proof requires manual copy/paste as the normal path
- wrong-run or corrupted messages are accepted

### 10.4 Proof 3: MT5 Tester Lifecycle Bench

After the bridge smoke passes, the factory must prove tester lifecycle evidence independently of strategy complexity.

Minimum required scenarios:

1. market-order lifecycle scenario
2. pending-order lifecycle scenario
3. SL/TP or hard-exit lifecycle scenario

Each run must record tester settings, tick model, spread source, commission/swap assumptions, execution delay, account/symbol settings, and output hashes.

Why this comes before a full strategy:

- it proves the MT5 bench before strategy logic can hide bridge or lifecycle bugs
- it separates platform evidence failures from strategy evidence failures

### 10.5 Proof 4: Minimal FTMO Rule Ledger Skeleton

Before a real candidate is promoted toward forward/demo readiness, the factory must represent FTMO rule accounting as deterministic evidence.

Minimum requirements:

- explicit FTMO target: `1-step`, `2-step`, or `both`
- rule-set version/source date
- CE(S)T daily reset handling
- equity-based daily loss and max loss accounting including floating P/L, commissions, and swaps
- account currency, starting balance, realized/unrealized P/L, deposits/withdrawals where applicable

The ledger skeleton may initially run on fixture data, but it must not be presented as forward/demo survival evidence.

### 10.6 Proof 5: First Candidate Proof

Only after the above proofs should the factory attach a real strategy candidate.

Fixture selection rule:

- choose `EURUSD M15 LondonBreakout`, `XAUUSD`, or another available symbol only after the MT5 snapshot proves terminal/data readiness
- `LondonBreakout` remains a practical candidate family because it already exists in the repo, but it is not a hard default if the measured account/symbol/data evidence points elsewhere

Minimum candidate proof requirements:

- one candidate ID
- one candidate manifest
- one canonical WFA/config route for the research layer
- one explicit deployment-mode assumption
- shared data identity or explicit explanation of unavoidable source differences

### 10.7 Mode Discipline For The First Proof

While final deployment mode remains undecided, the first proof must remain compatible with the stricter Mode B path.

That means:

- Python may produce the candidate rationale and robust external evidence
- the serious candidate stage must still leave room for native graduation
- the factory must not certify the first proof path using Python-only decisive validation
- native MQL5 work should wait until the bridge/tester bench and deployment-mode decision justify it, unless Mode B is explicitly selected earlier

### 10.8 Minimum Success Criteria

The minimal proof sequence is successful only if all of the following are true:

1. non-WFA evidence can be represented without fake WFA metrics
2. MT5 environment and data identity are measured and hashed
3. `FILE_COMMON` smoke passes with stale/corrupt/wrong-run rejection
4. tester lifecycle artifacts are captured automatically
5. tester evidence records its exact tester conditions
6. FTMO-rule interpretation is explicit and versioned
7. first fixture selection is evidence-based

### 10.9 Minimum Failure Criteria

The minimal proof must be treated as failed or blocked if any of the following happens:

- MT5 evidence is forced into WFA-only schema fields
- the tester bridge works only through manual operator intervention
- tester-side communication depends on `WebRequest`, sockets, or undocumented network shortcuts
- the tested strategy cannot be specified clearly enough to graduate into the serious-candidate stage
- native graduation is deferred while still claiming native-deployment confidence
- parity is judged only by headline PnL instead of lifecycle evidence

## 11. Architecture Components

This section defines the components the factory should contain and the authority of each one.

### 11.1 Factory Control Plane

Authority:

- session orchestration
- artifact persistence
- stage/state tracking
- promotion gates
- evidence bookkeeping

Existing base:

- `src/cli.mjs`
- `src/core/orchestrator.mjs`
- `src/core/artifact-store.mjs`
- `src/core/verification.mjs`

Rule:

- new MT5 parity and promotion logic must extend this plane, not bypass it

### 11.2 External Research Plane

Authority:

- idea coding
- broad WFA search
- robustness filtering
- cheap rejection of weak candidates

Existing base:

- `walk forward engine/src/walk_forward/`
- `walk forward engine/src/backtesting/`
- `walk forward engine/src/strategies/`

Rule:

- this plane is authoritative for discovery, not for MT5-native deployment certification

### 11.3 Candidate Contract Layer

Authority:

- make a candidate explicit enough to graduate between stages

This layer should define, at minimum:

- strategy rationale
- signal timing model
- order model
- exit model
- position sizing model
- symbol/timeframe assumptions
- session/timezone assumptions
- parameter freeze for the candidate instance being judged

Rule:

- if a candidate cannot be expressed cleanly at this layer, it is not ready for serious-candidate status

### 11.4 Native MQL5 Candidate Layer

Authority:

- native serious-candidate logic for Mode B
- native deployable artifact for Mode B

This layer is where native MQL5 candidates live.

Important rule:

- the spec does **not** require a full Python-to-MQL5 code-generation system as the first implementation
- the first native candidates may be manual or template-driven
- what matters is that the native candidate exists and becomes authoritative for Mode B

Rule:

- avoid designing a large meta-framework before one native candidate path is proven

### 11.5 MT5 Terminal Operations Layer

Authority:

- terminal snapshots
- account/symbol metadata capture
- environment identity capture
- tester launch support
- later, forward/demo coordination support

This layer should be thin and operational.

Rule:

- it exists to expose MT5 environment truth, not to become a second research engine

### 11.6 MT5 Strategy Tester Bench

Authority:

- tester-truth evidence
- controlled lifecycle validation inside MT5 tester semantics

Expected form:

- a `FILE_COMMON`-based artifact shuttle
- a thin MQL utility harness for bench/proof work
- structured outputs for comparator/gate consumption

Rule:

- the tester bench proves MT5 truth; it must not be disguised as a general bridge architecture for everything

### 11.7 Comparator And Drift Layer

Authority:

- compare external evidence and MT5-native evidence
- classify mismatch types
- produce promotion-grade parity reports

This layer should compare:

- order lifecycle behavior
- trigger timing
- exit timing
- cost effects
- drawdown and trade-count drift

Rule:

- parity reports must be structured enough to block promotion automatically where appropriate

### 11.8 FTMO Rule And Forward Layer

Authority:

- FTMO rule-accounting
- forward/demo survivability
- operational reconciliation

This layer exists because tester validation is necessary but not sufficient.

Minimum FTMO ledger requirements:

- declare FTMO target as `1-step`, `2-step`, or `both`
- record rule-set source date/version
- model daily reset at 00:00 CE(S)T
- compute daily loss and maximum loss from equity, not balance-only PnL
- include floating P/L, commissions, and swaps
- record account currency, starting balance, current equity, realized P/L, open risk, and breach status
- distinguish FTMO 2-Step static maximum loss from 1-Step trailing/end-of-day behavior when 1-Step is in scope
- when targeting both 1-Step and 2-Step, satisfy the stricter intersection: 1-Step tighter daily-loss/trailing/Best-Day constraints and 2-Step minimum-trading-day/static-loss constraints must both be represented or explicitly out of scope

The first ledger implementation may be a skeleton over fixture ledgers, but it must preserve these fields from the start.

Rule:

- no strategy becomes deployable without this layer for MT5/FTMO-bound deployment

### 11.9 Promotion Gate Layer

Authority:

- stage advancement
- quarantine
- downgrade on drift or invalidation

Rule:

- stage advancement must depend on explicit artifacts and named authority, not on narrative judgment alone

### 11.10 Brain / Body Architecture

The factory uses a strict brain/body split.

#### Brain

The reasoning brain is composed of replaceable cognitive backends, which may include direct provider APIs, bounded OpenCode jobs, or future agent frameworks behind the same contract.

OpenCode is a supervised development/debugging tool and optional bounded backend. It is not the production control plane, execution authority, metric authority, evidence promoter, state writer, or live trading actor.

The brain may propose, critique, diagnose, and summarize. It cannot convert its own narrative into evidence.

The brain is responsible for:

- hypothesis generation
- external research synthesis
- experiment design
- code-change proposals
- failure diagnosis
- artifact review
- evidence interpretation
- next-action recommendation

The brain is **not** responsible for official execution.

LLM agents must not directly own:

- official WFA execution
- official MT5 tester execution
- MQL5 compilation as evidence
- FTMO forward/live execution
- official scoring
- official promotion gates
- official state mutation

#### Body

The execution body is composed of deterministic workers.

Workers are responsible for:

- data acquisition
- data validation
- WFA execution
- MT5 environment snapshots
- MT5 tester bench runs
- MQL5 compilation
- native candidate tester runs
- parity comparison
- FTMO rule-ledger checks
- forward/demo execution operations
- artifact parsing
- artifact hashing
- deterministic gate calculations

Workers must be callable without LLM context.

#### Control Plane

The JS control plane owns:

- backlog leasing
- candidate registry updates
- run IDs
- worker dispatch
- agent dispatch
- schema validation
- artifact indexing
- gate persistence
- official state mutation

The control plane may ask agents for reasoning, but it must ask workers for evidence.

Core rule:

**LLMs decide what should be tested and why. Workers test it. The control plane decides what the result means.**

### 11.11 LLM Agent Roles

LLM roles are reasoning roles, not execution authorities.

#### Researcher

The researcher expands the factory's external intelligence.

It may use:

- academic papers
- MetaQuotes/MQL5 documentation
- FTMO and broker documentation
- exchange documentation
- GitHub repositories
- quant blogs
- forums, Reddit, and other low-trust signal sources

The researcher must output compact hypothesis packets or source-backed constraints. It must not output profitability claims as evidence.

The researcher is used when:

- backlog quality is low
- a new strategy family is needed
- a candidate needs source-backed mechanism review
- an MT5/FTMO operational constraint is unclear
- repeated failures suggest a research blind spot

It should not run every cycle by default.

#### Ideator

The ideator converts research memory and market policy into one backlog candidate.

It must check prior failed patterns before proposing an idea.

#### Planner

The planner converts one backlog item or hypothesis packet into a narrow experiment plan.

It must declare:

- candidate stage target
- deployment mode assumption
- authority layer being tested
- required deterministic workers
- expected artifacts
- stop/block conditions

#### Executor / Run Analyst

The executor agent is not an execution engine.

It is a run analyst.

It may:

- translate plans into worker job requests
- check preconditions
- inspect worker failures
- propose bounded repairs
- recommend retry, block, or replan

It must not certify execution success.

Execution success is determined only by verified worker result envelopes.

#### Evaluator

The evaluator judges evidence quality and overfitting/deployment risk.

It may recommend stage movement, but it cannot promote a candidate without gate-worker support.

For research strategy evidence, evaluator optimism is fail-closed by validator floors: positive labels such as promising/approve/promote must be rejected when the cited metrics lack enough completed OOS windows, enough trades, a minimum return proxy, or acceptable OOS-window consistency. These floors prevent narrative upgrades of weak WFA evidence and are separate from operational canary acceptance.

#### Summarizer

The summarizer compresses durable lessons into structured memory. It must preserve failed-pattern information when a candidate fails.

### 11.12 Deterministic Worker Contract

Every official execution path must be represented as a deterministic worker contract.

Implementation must start with concrete minimal wrappers and result envelopes. A broad generic worker framework is not required before there are at least two real workers to justify it.

Minimum generic worker request template:

This generic shape is only a floor for new evidence kinds. Evidence-kind-specific schemas may be stricter and supersede it. For `research_wfa`, the active request schema is `research_wfa_run_request_v1`, which requires lineage/family/attempt identity, canonical WFA config/source/parameter/data or data-manifest inputs, `expected_output_root`, `timeout_ms`, `python_executable`, and `environment_allowlist` as specified in Phase 7A.

```json
{
  "job_id": "string",
  "run_id": "string",
  "candidate_id": "string|null",
  "worker": "data|research_wfa_run|mt5_snapshot|mt5_file_common_smoke|mql_build|mt5_tester|parity|ftmo_ledger|forward|gate",
  "evidence_kind": "research_wfa|mt5_snapshot|mt5_bridge_smoke|data_identity|mql_build|mt5_tester|parity_report|ftmo_ledger|forward_report|promotion_gate",
  "authority_layer": "python_research|mt5_terminal|mt5_tester|native_mql5|ftmo_forward|control_plane",
  "schema_version": "1.0",
  "input_manifest_path": "repo-relative path",
  "expected_outputs": [],
  "constraints": {
    "timeout_sec": 3600,
    "max_retries": 1,
    "allow_network": false
  }
}
```

The `evidence_kind` example above reflects established Phase 1-7 worker/evidence categories. Phase 8 adds new evidence-kind contracts below, but they must not be treated as accepted `executed` evidence until validators, deterministic producers, and control-plane acceptance checks exist for each kind.

Minimum worker result:

```json
{
  "job_id": "string",
  "run_id": "string",
  "candidate_id": "string|null",
  "worker": "string",
  "evidence_kind": "string",
  "authority_layer": "string",
  "schema_version": "1.0",
  "status": "succeeded|failed|blocked|partial|inconclusive",
  "artifacts": [
    {
      "artifact_type": "string",
      "path": "repo-relative path",
      "sha256": "string"
    }
  ],
  "metrics": {},
  "observations": {},
  "blocked_reason": "string|null",
  "source_hashes": [],
  "diagnostics": {
    "error_code": "string|null",
    "message": "string|null",
    "stdout_path": "string|null",
    "stderr_path": "string|null"
  },
  "environment": {}
}
```

A worker result is valid only when:

- the result JSON matches schema
- all claimed artifact paths exist
- artifact hashes match
- status semantics match the exit condition
- the control plane accepts the result

`partial` is a terminal non-success status for a worker or executor attempt that produced some usable artifacts or observations but did not satisfy the evidence-kind acceptance contract. It must include structured blockers or errors and must not be normalized into `executed` evidence.

Official execution rule:

**No WFA, MT5, MQL5, parity, FTMO, or forward action is official unless performed by a deterministic worker and accepted by the control plane.**

### 11.12A Evidence-Kind Acceptance

Do not require every evidence kind to provide WFA metrics.

Common required fields:

- `evidence_kind`
- `candidate_id` where candidate-specific
- `candidate_stage` where candidate-specific
- `deployment_mode` where candidate-specific
- `authority_layer`
- `status`
- `artifacts`
- `metrics` or `observations`, depending on evidence kind
- `observed_at`
- `blocked_reason` when blocked
- `source_hashes` where source files, configs, data, or binaries matter

Evidence-kind minimums:

- `research_wfa`: WFA output artifacts, WFA provenance, windows completed, OOS metrics, trade count, drawdown, and data identity where available
- `mt5_snapshot`: terminal/account/symbol/data identity, timestamp, account/server identifiers, symbol specification, and snapshot hash
- `mt5_bridge_smoke`: run-scoped `FILE_COMMON` message protocol, checksum-backed accepted message, MQL5 FILE_COMMON source references, and deterministic stale/wrong-run/corrupt/partial rejection report
- `data_identity`: provider/broker, symbol exact name, timeframe, timezone/server offset, quote basis, source type, coverage, gap report, import path, and hash
- `mql_build`: source/include hashes, compiler/build identity, warnings/errors, `.ex5` hash when produced
- `mt5_tester`: tester settings, tick model, spread/cost assumptions, account/symbol settings, lifecycle outputs, logs/summaries, and tester artifact hashes
- `parity_report`: compared artifact IDs, drift taxonomy, thresholds, pass/block decision, and mismatch examples
- `ftmo_ledger`: FTMO target/rule version, CE(S)T reset model, equity/floating P/L/swap/commission accounting, breach status, and source ledger hash
- `forward_report`: account/server fingerprint, reconciliation summary, orders/deals/positions evidence, FTMO ledger reference, and operational incidents
- `promotion_gate`: gate type, candidate ID, required evidence refs, decision, failed checks, and reason
- `research_brain_discovery`: ResearchBrain ideation manifest, source records, and hypothesis packets; Stage 0 discovery only, not profitability or deployment evidence
- `research_source_record`: source URL/DOI/path, trust tier, accessed timestamp, content hash or unavailable reason, extracted claims, limitations, and disconfirming relevance
- `hypothesis_packet`: mechanism, falsifiable prediction, market-structure assumption, instrument scope, MT5 relevance classification, required data, expected frequency/holding period, invalidation criteria, source trace, and novelty check
- `research_ideation_manifest`: research run ID, memory inputs checked, sources considered, hypotheses accepted/rejected, duplicates detected, budget used, and blockers
- `mt5_instrument_equivalence`: exact MT5 terminal symbol or approved proxy mapping, source data identity, documented differences, snapshot artifact path/hash, and classification as `mt5_verified`, `mt5_proxy`, or `non_mt5_research_only`
- `low_frequency_registration`: pre-run frequency rationale, minimum acceptable trades, required extra controls, registration timestamp, and content hash
- `research_wfa_preregistration`: pre-run mechanism, instrument scope, data sources, WFA design, invalidation criteria, denominator rules, linked hypothesis packet, timestamp, and content hash

Phase 8 evidence-kind implementation boundary, added 2026-05-17:

- `research_brain_discovery`, `research_source_record`, `hypothesis_packet`, `research_ideation_manifest`, `mt5_instrument_equivalence`, `low_frequency_registration`, and `research_wfa_preregistration` are required contracts for Phase 8, not proof that the current validators accept them
- a Phase 8 artifact can be used for official acceptance only after the relevant validator verifies schema, identity, artifact paths, hashes, authority layer, and blocked/executed semantics
- if a Phase 8 artifact is produced before validator support exists, it is an implementation artifact or draft evidence only and must not be used to promote, rank, or declare success

`status: executed` at the run level means the relevant worker result was accepted by the control plane with evidence-kind-appropriate artifacts and observed metrics or observations. It does not always mean WFA ran.

### 11.12B Research WFA Run Worker Acceptance

For new run-level `executed` claims where `evidence_kind` is `research_wfa`, a deterministic WFA run worker envelope is mandatory.

Accepted succeeded worker results supporting run-level `executed` claims must prove:

- `execution_was_run_by_this_worker: true`
- request/result identity match for `run_id`, `job_id`, `candidate_id` where candidate-scoped, `lineage_id`, `family_id`, and `attempt_id` where present
- canonical command, working directory, Python executable, start time, end time, duration, timeout status, and exit code
- stdout and stderr artifact paths and hashes
- WFA config hash, strategy source hash, strategy parameter/config hash, and data/input manifest hashes
- pre-run output snapshot, accepted output allowlist, and stale-output guard result
- accepted artifacts created or modified during the worker run window, not merely present in a strategy results folder
- output artifact paths and hashes, including parsed metrics path/hash
- completed and failed window counts
- aggregate and per-window OOS metrics backed by WFA output artifacts
- selected parameters by window when optimization ran
- total trade count backed by a trade ledger or WFA result artifact
- trade ledger path/hash, equity curve path/hash, and optimizer trial table path/hash when the WFA engine emits them
- explicit `missing_because` diagnostics for optional trade/equity/optimizer artifacts that the current engine genuinely does not emit
- cost model assumptions and execution timing assumptions where available
- every parsed cost/timing assumption must cite the artifact path, artifact hash, and field it came from; unavailable assumptions must record explicit `missing_because` diagnostics rather than defaults
- trial-accounting record reference for every attempt

The stale-output guard must fail closed when:

- output files predate worker start time and are not explicitly allowed immutable inputs
- outputs were copied from a different run, job, candidate, or attempt
- accepted artifacts cannot be tied to the current request by path, manifest identity, run/job ID, or pre-run/post-run snapshot comparison
- hashes match but freshness or identity does not

New run-level `executed` evidence for `evidence_kind: research_wfa` must fail closed if required worker provenance, artifacts, hashes, metrics, completed-window count, trade count, or identity match is missing.

Zero-trade handling must preserve evidence without overstating it. A worker-launched WFA attempt with completed windows but zero trades is recorded as an inconclusive worker attempt with diagnostics, stdout/stderr, input hashes, and any produced artifacts. It must not satisfy accepted run-level `executed` `research_wfa` canary evidence, promotion gates, or strategy-quality claims.

Blocked, failed, timed-out, or inconclusive worker attempts may validly lack WFA metrics, but they must preserve diagnostics, stdout/stderr where available, input hashes, failure class, and trial-accounting records. They must not be normalized into executed evidence.

Legacy WFA envelopes that officialized existing artifacts may remain valid historical records only when clearly labeled as `officialized_existing_output`. They do not satisfy the worker-launched WFA canary gate.

### 11.13 Candidate Manifest And Registry

The factory must keep candidate state separate from backlog state, but implementation should start with a minimal manifest for the first real candidate. A full registry is delayed until real MT5 artifacts exist to attach.

Backlog items represent work to do. Candidate manifests represent strategy candidates moving through lifecycle stages.

Minimum candidate manifest fields:

- `candidate_id`
- `strategy_family`
- `deployment_mode`
- `candidate_stage`
- `status`
- `instrument_scope`
- `timeframe`
- `rationale`
- `signal_timing_model`
- `order_model`
- `exit_model`
- `position_sizing_model`
- `deployment_intent`: `mt5_bound`, `non_mt5_research_only`, or `undecided`
- `research_instruments`
- `mt5_instrument_equivalence`
- `data_relevance_classification`
- `session_timezone_assumptions`
- `parameter_freeze`
- `source_refs`
- `linked_backlog_item_ids`
- `linked_run_ids`
- `artifact_refs`
- `latest_gate_decision`
- `blocking_failure_ids`
- `updated_at`

Candidate manifest and later registry updates are written only by the control plane after artifact-backed validation.

LLM agents may recommend candidate updates, but they may not write them directly.

### 11.14 Artifact And Evidence Indexing

Every promotion-relevant artifact must be indexed or manifest-referenced. The first implementation only needs enough identity to verify artifacts and prevent fake evidence; full lifecycle governance comes later.

Minimum artifact index fields:

- `artifact_id`
- `artifact_type`
- `candidate_id`
- `run_id`
- `producer`
- `worker`
- `input_refs`
- `output_path`
- `sha256`
- `schema_version`
- `created_at`
- `evidence_kind`
- `authority_layer`
- `retention_class`

Required artifact classes include:

- `hypothesis_packet`
- `research_source_record`
- `research_digest`
- `research_ideation_manifest`
- `candidate_manifest`
- `research_wfa_result`
- `mt5_instrument_equivalence`
- `low_frequency_registration`
- `research_wfa_preregistration`
- `data_identity`
- `environment_identity`
- `mql_source`
- `mql_compile_report`
- `mql_binary_hash`
- `mt5_tester_result`
- `parity_report`
- `ftmo_rule_report`
- `forward_report`
- `promotion_gate`
- `failure_record`

Promotion gates must cite indexed artifacts, not free-text claims.

#### Evidence Index Versus Storage

`factory/evidence/index.json` is the normalized evidence index. It is not a blob store, scratch directory, or dumping ground.

Rules:

- bulky or raw evidence lives in its evidence-family root, not directly inside the index directory
- promotion gates cite indexed artifact IDs when available and exact repo-relative paths while the index is still minimal
- every indexed promotion-relevant artifact must include `retention_class`, `sha256`, `authority_layer`, and `evidence_kind`
- `factory/evidence/index.json` may summarize and link; it must not duplicate large WFA, tester, ledger, log, or report payloads
- if an artifact is important enough to influence a gate, candidate state, backlog decision, lesson, or leaderboard entry, it must become indexed or manifest-referenced

#### Evidence Placement Matrix

Evidence family placement is part of the architecture. Workers must write to the designated family root or block with diagnostics.

Current placement contract:

- `research_wfa`: official envelopes in `factory/runs/<job_or_run_id>/`; WFA engine outputs in `walk forward engine/strategies/<strategy_id>/results/`; candidate-local validation and gate notes in `factory/candidates/<candidate_id>/`
- `data_identity`: candidate or dataset validation under `factory/candidates/<candidate_id>/` or future `factory/data/<dataset_id>/`
- `mt5_snapshot`: `factory/mt5/environment/<job_id>/`
- `mt5_bridge_smoke`: `factory/mt5/bridge/ingested/<run_id>/`; rejected or malformed bridge files under `factory/mt5/bridge/quarantine/`; transient bridge files under `factory/mt5/bridge/scratch/`
- `mql_build`: future native build evidence under `factory/mt5/native/<candidate_id>/builds/<build_id>/`
- `mt5_tester`: `factory/mt5/tester/<job_id>/`
- `ftmo_ledger`: `factory/mt5/ftmo/<job_id>/`; ledger inputs under `factory/mt5/ftmo/inputs/`; rule artifacts under `factory/mt5/ftmo/rules/`
- `parity_report`: future reports under `factory/parity/reports/<candidate_id>/<run_id>.json`
- `promotion_gate`: candidate-local gates under `factory/candidates/<candidate_id>/gates/` when the candidate registry is expanded; until then, candidate-local gate artifacts may live directly under `factory/candidates/<candidate_id>/` and must be manifest-referenced
- `forward_report`: future forward/demo evidence under `factory/mt5/forward/<candidate_id>/<run_id>/`
- `research_brain_discovery`, `research_source_record`, `research_digest`, `research_ideation_manifest`: under `factory/research/hypotheses/`, `factory/research/sources/`, `factory/research/digests/`, and `factory/research/ideation/` respectively
- `mt5_instrument_equivalence`, `low_frequency_registration`, and `research_wfa_preregistration`: candidate-specific under `factory/candidates/<candidate_id>/`

Forbidden placement:

- no MT5, FTMO, WFA, parity, candidate, or promotion evidence may be dumped into the repo root
- no worker may invent a new top-level directory without a spec amendment
- no long-lived artifact may remain only in `/tmp`, terminal folders, `FILE_COMMON`, or ad hoc local paths after ingestion
- no diagnostic output may be left unclassified; it must become indexed evidence, run-local scratch, family-local scratch, quarantine, or an explicitly ignored transient

### 11.14A Artifact Lifecycle, Retention, And Hygiene

This is a later-scale policy section, not a first implementation slice.

Before MT5 snapshot, `FILE_COMMON` smoke, and tester lifecycle bench exist, implement only:

- artifact path existence checks
- SHA256 recording for promotion-relevant artifacts
- run-level artifact manifests
- conservative retention classes for new evidence
- quarantine instead of delete for unknown or ambiguous files

Do not build a full hygiene worker, curator, archive system, or reference-graph machinery before real MT5 artifact volume exists.

Repository organization is part of the loop.

The factory must keep itself clean without relying on the operator to periodically guess what is safe to delete.

However, cleanup is never informal filesystem tidying. Cleanup is an evidence lifecycle operation.

Core rule:

**Evidence is sacred. Scratch is disposable. Unknown is quarantined. LLMs recommend. Workers apply. The control plane records.**

No file lifecycle transition is official unless it is represented in a cleanup manifest, validated by the control plane, and recorded in the artifact lifecycle log.

#### Retention Classes

Every indexed artifact must declare a `retention_class`.

Required retention classes:

- `protected_evidence`
- `source_of_truth`
- `raw_supporting`
- `compact_summary`
- `state_index`
- `scratch`
- `quarantine`
- `archive`
- `external_cache`
- `operator_notes`

`protected_evidence` includes:

- WFA results
- MT5 tester results
- parity reports
- FTMO forward reports
- evaluator judgments
- promotion gates
- failure records
- accepted worker result envelopes

`source_of_truth` includes:

- candidate manifests
- strategy config snapshots
- MQL source snapshots used in compile/test/gate decisions
- data identity records
- environment identity records
- parameter freezes

`raw_supporting` includes:

- raw WFA logs
- raw MT5 tester logs
- raw trade ledgers
- raw worker stdout/stderr
- raw research notes

`compact_summary` includes:

- log digests
- trade summaries
- metric summaries
- run summaries
- source digests

`scratch` includes:

- worker temp directories
- partial files
- stale bridge files
- local transient outputs
- empty scratch directories

#### Canonical Organization Layout

The factory should organize artifacts by lifecycle role, not by whichever worker happened to create them.

Recommended `factory/` structure:

```text
factory/
  candidates/
    index.json
    <candidate_id>/
      candidate_manifest.json
      stage_history.jsonl
      evidence_refs.json
      gates/
      source_snapshots/

  research/
    sources/
    hypotheses/
    notes/
    digests/
    failed-patterns.jsonl

  artifacts/
    index.json
    lifecycle-log.jsonl
    manifests/

  runs/
    <run_id>/
      plan.json
      worker-results/
      agent-results/
      artifact_manifest.json
      summaries/
      logs/
      scratch/

  evidence/
    index.json
    research/
    wfa/
    mt5/
    parity/
    ftmo/
    failures/

  mt5/
    environment/
    tester/
    native/
    bridge/
      ingested/
      quarantine/
      scratch/

  parity/
    reports/
    drift-taxonomy.json

  memory/
    lessons.jsonl
    failed-patterns.jsonl
    source-digests.jsonl
    compaction-log.jsonl

  hygiene/
    scans/
    proposals/
    applied/
    reports/

  archive/
    by-run/
    by-candidate/
    bulky-raw/
    manifests/

  quarantine/
    orphaned/
    malformed/
    stale-bridge/
    unknown/
```

Implementation code should remain outside `factory/`.

Recommended code locations:

```text
src/core/
  artifact-lifecycle.mjs
  retention-policy.mjs
  reference-graph.mjs
  hygiene-worker-dispatch.mjs

scripts/hygiene/
  scan-artifacts.mjs
  compact-artifacts.mjs
  apply-cleanup.mjs
```

`factory/archive/` is still evidence storage.

`factory/quarantine/` is safety holding.

`scratch/` is disposable only after policy checks.

#### Active Repo Layout Contract

The spec exists to make the loop smoother and cleaner, not to create scattered complexity. Every implementation step must fit the big-picture layout before it is considered finished.

Active implementation may use these roots only:

- `src/` for JS control-plane, validation, state, workers, and core architecture code
- `scripts/` for deterministic CLI entrypoints and diagnostics that are tied to workers or run manifests
- `walk forward engine/` for WFA engine code, strategy research code, WFA configs, and WFA-local result artifacts
- `factory/` for official state, evidence, candidate manifests, MT5/FTMO artifacts, gate outputs, summaries, memory, archive, quarantine, and hygiene records
- `research/` for durable human/agent research notes that are not official execution evidence
- `workspace/` only for legacy or non-official research harness/data/results until those artifacts are promoted into factory evidence

Rules:

- no new top-level directory may be created unless this spec is amended with its purpose, retention class, and owner
- no new broad framework directory is allowed before at least one proof path consumes it
- implementation code must stay outside `factory/`; official evidence/state must stay inside `factory/` or the WFA strategy result folder when produced by the WFA engine
- if a file is created during a run, its lifecycle must be known at creation time: official evidence, source of truth, raw supporting, compact summary, scratch, quarantine, archive, or external cache
- if lifecycle is unknown, the file belongs in quarantine, not in the repo root or a random nearby folder
- future autonomous loop runs must produce artifacts that link back to the active plan, candidate, run/job ID, worker, and gate decision where applicable

#### Run And Job Folder Shape

Run structure is mandatory. The loop must not accumulate unrelated flat files under `factory/runs/`.

Canonical loop-run shape:

```text
factory/runs/<run_id>/
  run-state.json
  plan.json
  worker-results/
  agent-results/
  artifact_manifest.json
  gate-results.json
  summaries/
  logs/
  scratch/
```

Canonical official worker-envelope shape for one-off evidence jobs:

```text
factory/runs/<job_id>/
  worker-result.json
  execution-result.json
  <worker-request>.json
  <worker-summary>.json
```

Rules:

- new official loop cycles should prefer the full `<run_id>` shape
- one-off worker officialization jobs may use the compact `<job_id>` shape only when they are not full loop cycles
- MT5 long-lived evidence belongs under `factory/mt5/<evidence-family>/<job_id>/`, not beside unrelated loop runs
- every run/job folder must contain enough metadata to identify producer, evidence kind, authority layer, inputs, outputs, hashes, and blocked reasons if any
- flat files directly under `factory/runs/` are legacy or transitional only; new code must not add more
- scratch inside a run/job folder is disposable only after it is unreferenced and policy-approved

#### Scratch, Quarantine, And Archive Subset For Current Implementation

Until the full hygiene worker exists, use this minimal subset:

- scratch allowed under `factory/runs/<run_or_job_id>/scratch/`, `factory/mt5/bridge/scratch/`, and short-lived worker temp directories that are deleted or manifest-recorded
- quarantine allowed under `factory/quarantine/`, `factory/mt5/bridge/quarantine/`, and future family-local quarantine folders explicitly named in this spec
- archive allowed under `factory/archive/`
- unknown files in protected roots are quarantined, never deleted
- scratch cleanup requires exact path, expected hash when available, age/TTL rule, and unreferenced check
- any cleanup uncertainty becomes `noop` or `quarantine`, never `delete`

#### Anti-Clutter Implementation Rules

Every future implementation phase must obey these rules:

- one proof path before broad scaffolding
- no placeholder directories unless a current worker, candidate, run, or gate consumes them
- no standalone diagnostic script unless it lives under `scripts/` or a future `scripts/<family>/diagnostics/` path and writes outputs to an approved evidence or scratch location
- no duplicate source-of-truth files for the same candidate decision; if duplication is unavoidable, the manifest must name the authoritative one
- no official state mutation by agents or MT5/Python helper scripts; official acceptance remains JS control-plane responsibility
- no evidence movement, compaction, archive, or deletion outside a manifest-backed lifecycle operation
- any bug found while implementing the spec must be fixed immediately if narrow and safe; otherwise it must be documented in the spec, candidate manifest, or run summary with an exact blocked follow-up

#### Retention Rules

The following must never be auto-deleted:

- candidate registry and candidate manifests
- artifact/evidence indexes and lifecycle logs
- backlog, state, leaderboard, lessons, and failed-pattern memory
- experiment plans, worker result envelopes, evaluator judgments, and run summaries
- promotion gates and gate inputs
- WFA result summaries and accepted WFA evidence
- MT5 environment snapshots
- data identity records
- MQL source snapshots used in any compile/test/gate
- MQL compile reports for judged candidates
- `.ex5` hash records and binary identity records
- MT5 tester results
- parity reports and drift classifications
- FTMO rule reports
- forward/demo/live reports and reconciliation logs
- failure records
- raw evidence for serious candidates and later stages
- any artifact referenced by a gate, candidate, run, lesson, summary, backlog item, or state file
- human-authored notes unless explicitly marked as scratch
- anything unknown inside protected roots

The following may be auto-deleted only when exact-path, hash-checked, unreferenced, allowlisted, and older than policy TTL:

- worker temp directories
- stale `.tmp`, `.partial`, or `.lock` files
- stale `FILE_COMMON` bridge scratch files after successful ingestion
- reproducible local package/tool caches
- duplicate stdout/stderr files after digesting when unreferenced
- failed scratch outputs that never became worker results
- empty directories under scratch roots

The following should be archived or compacted rather than deleted:

- large WFA logs
- large MT5 tester logs
- full trade ledgers
- optimizer tables
- raw research source dumps
- old run directories after manifests and indexes are valid

Unknown, malformed, or ambiguous artifacts must be quarantined rather than deleted.

#### Lifecycle States

Artifacts may move through these lifecycle states:

- `active`
- `summarized`
- `compacted`
- `archived`
- `quarantined`
- `tombstoned`
- `deleted`

`deleted` is allowed only for policy-approved disposable artifacts.

`tombstoned` means the original location no longer holds the artifact, but the evidence chain records where it went or why it was intentionally retired.

#### Cleanup Manifests

Cleanup must use explicit manifests.

Required manifest classes:

- `cleanup_scan`
- `cleanup_proposal`
- `cleanup_application`
- `artifact_lifecycle_log`
- `retention_policy`

Each cleanup action must include:

- exact repo-relative path
- expected hash
- action type
- reason
- retention class
- policy rule
- risk level
- whether manual approval is required
- result status

If the file hash changed after scan, the action must be skipped.

If the action is uncertain, the action must become `quarantine` or `noop`, not `delete`.

Minimum `cleanup_scan` shape:

```json
{
  "schema_version": "cleanup_scan_v1",
  "scan_id": "string",
  "created_at": "ISO timestamp",
  "policy_version": "string",
  "files": [
    {
      "path": "repo-relative path",
      "sha256": "string",
      "size_bytes": 0,
      "known_artifact_id": "string|null",
      "referenced_by": [],
      "detected_class": "string",
      "schema_valid": true,
      "risk_flags": []
    }
  ],
  "reference_graph_summary": {
    "indexed_files": 0,
    "unindexed_files": 0,
    "orphan_files": 0,
    "missing_index_refs": 0
  }
}
```

Minimum `cleanup_proposal` shape:

```json
{
  "schema_version": "cleanup_proposal_v1",
  "proposal_id": "string",
  "scan_id": "string",
  "created_at": "ISO timestamp",
  "actions": [
    {
      "action_id": "string",
      "action": "delete|archive|compress|compact|quarantine|index|repair_index|noop",
      "path": "repo-relative path",
      "expected_sha256": "string",
      "destination_path": "repo-relative path|null",
      "reason": "string",
      "risk_level": "low|medium|high|blocked",
      "requires_manual_approval": false,
      "policy_rule": "string"
    }
  ]
}
```

Minimum `cleanup_application` shape:

```json
{
  "schema_version": "cleanup_application_v1",
  "application_id": "string",
  "proposal_id": "string",
  "applied_at": "ISO timestamp",
  "applied_by": "control_plane",
  "results": [
    {
      "action_id": "string",
      "status": "applied|skipped|blocked|failed",
      "path": "repo-relative path",
      "observed_sha256": "string|null",
      "destination_path": "repo-relative path|null",
      "message": "string|null"
    }
  ]
}
```

#### Hygiene Loop

The hygiene loop has five steps:

1. `scan`: deterministic worker inventories files, hashes them, validates schemas, and builds a reference graph
2. `classify`: deterministic rules classify obvious files; LLM curator handles only ambiguous semantic cases
3. `validate`: control plane validates proposed actions against retention policy
4. `apply`: deterministic worker applies approved exact-path actions only
5. `record`: control plane writes lifecycle log and updates indexes

Cleanup must not run inside an active WFA, MT5 tester, MQL compile, or forward/live execution transaction.

#### LLM Curator Role

The curator is optional, trigger-based, and advisory.

It is not a normal per-cycle stage.

The curator may recommend:

- evidence index repairs
- failed-pattern consolidation
- duplicate backlog labels
- stale or superseded artifact labels
- retrieval-memory compaction
- quarantine candidates for ambiguous clutter
- source/research note compaction

The curator must never:

- delete files
- mutate official state directly
- alter metrics
- rewrite evidence
- promote or demote strategies
- clean active-run artifacts
- convert simulation artifacts into real evidence
- create PR-style or team-style reports

Curator triggers may include:

- every N completed cycles
- artifact-volume threshold
- repeated blocked runs with the same root cause
- repeated failed strategy signatures
- retrieval/memory bloat
- hygiene scanner ambiguity
- manual operator request

If no trigger fires, the curator should not run.

The curator receives a compact hygiene manifest, not raw repo context.

Minimum curator input shape:

```json
{
  "schema_version": "curator_input_v1",
  "curator_run_id": "string",
  "trigger": {
    "type": "cycle_count|artifact_volume|memory_pressure|repeated_failure|manual|scan_ambiguity",
    "reason": "string"
  },
  "budgets": {
    "max_input_files": 80,
    "max_input_chars": 50000,
    "max_recommendations": 25
  },
  "index_deltas": {
    "unindexed_existing_paths": [],
    "indexed_missing_paths": [],
    "status_conflicts": []
  },
  "memory_candidates": {
    "duplicate_clusters": [],
    "failed_pattern_clusters": []
  },
  "retrieval_stats": {
    "capsule_chars_last_cycle": 0,
    "oversized_sections": []
  }
}
```

Minimum curator output shape:

```json
{
  "schema_version": "curator_recommendations_v1",
  "curator_run_id": "string",
  "status": "recommendations_ready|no_action|blocked",
  "recommendations": [
    {
      "id": "string",
      "action": "add_evidence_index_link|append_failed_pattern|mark_superseded|recommend_quarantine|recommend_memory_compaction|noop",
      "severity": "low|medium|high",
      "confidence": "low|medium|high",
      "reason": "string",
      "paths": [],
      "proposed_patch": {}
    }
  ],
  "forbidden_or_skipped": []
}
```

Curator output is advisory. The deterministic hygiene worker must validate and apply only policy-safe recommendations.

#### Deterministic Hygiene Worker

The deterministic hygiene worker owns actual cleanup mechanics.

It may:

- scan files
- compute hashes
- validate schemas
- detect references
- classify obvious scratch/cache/quarantine candidates
- compact allowed artifacts
- archive allowed artifacts
- apply approved cleanup manifests
- emit hygiene reports

It must not:

- delete protected evidence
- override retention policy
- decide evidence quality
- mutate candidate stage
- make promotion decisions

#### Solo-Project Hygiene Rule

The hygiene system exists to reduce burden on the solo operator.

It must not create enterprise process overhead.

Human-facing hygiene output should be limited to:

- actions applied
- actions rejected
- unresolved risks
- manual approvals required

Machine-readable manifests are primary. Prose is secondary.

### 11.15 Gate Engine

Promotion is deterministic.

LLM agents may recommend promotion, but promotion requires a gate-worker decision.

Gate result shape:

```json
{
  "gate_id": "string",
  "gate_type": "research|serious_candidate|mql_build|mt5_tester|parity|ftmo_forward|deployment",
  "evidence_kind": "string",
  "authority_layer": "string",
  "candidate_id": "string",
  "candidate_stage": "string|null",
  "deployment_mode": "string|null",
  "run_id": "string",
  "decision": "allow|deny|block|quarantine|downgrade",
  "evidence_paths": [],
  "worker_result_refs": [],
  "trial_accounting_refs": [],
  "source_hashes": [],
  "failed_checks": [],
  "reason": "string",
  "recorded_at": "ISO timestamp"
}
```

Gate decisions must be persisted as artifacts and reflected in the candidate registry.

### 11.16 Research Intelligence Layer

The research layer expands the factory's information intake without expanding prompt context.

Its purpose is:

- find source-backed mechanisms
- discover operational constraints
- identify known failure modes
- produce compact, falsifiable hypothesis packets

It is not evidence of strategy profitability.

Source trust tiers:

- high operational trust: MetaQuotes, MQL5 docs, FTMO docs, broker docs, exchange/data-provider docs
- high research trust: academic papers, market microstructure research, institutional notes with visible methodology
- medium implementation trust: GitHub repos, public notebooks, MQL5 CodeBase, QuantConnect-style examples
- low signal trust: Reddit, forums, TradingView, social posts, blogs with weak methodology

Research output must be stored as structured artifacts, not pasted into prompts.

The research layer must be a bounded, non-authoritative Stage 0 discovery component. ResearchBrain is its implementation contract.

ResearchBrain may:

- search sources
- synthesize mechanisms
- check prior memory
- propose falsifiable hypotheses
- produce source records and hypothesis packets
- recommend whether an idea deserves planning

ResearchBrain must not:

- execute WFA or MT5 jobs as official evidence
- run backtests or optimizers
- compile MQL5
- fetch market data, live prices, account state, or broker execution data
- certify metrics
- estimate Sharpe, return, PnL, CAGR, profitability, or edge strength
- score promotion
- mutate official state
- write candidate manifests directly
- defend its own ideas after evidence contradicts them

Required ResearchBrain request fields:

- `research_question`
- `market_scope`
- `mt5_instrument_scope` when MT5-bound
- `prior_failed_patterns`
- `prior_lessons`
- `max_sources`
- `max_hypotheses`
- `novelty_required`

Optional request fields may include prior hypothesis packets, prior source records, prior candidate history, source-family allowlists, and budget limits once deterministic retrieval can provide them by artifact path/hash.

Minimum `research_source_record_v1` fields:

- `schema_version`
- `source_id`
- `source_type`
- `trust_tier`
- `url_or_path_or_doi`
- `accessed_at`
- `content_hash_or_unavailable_reason`
- `claims_extracted`
- `limitations`
- `disconfirming_relevance`

Minimum `hypothesis_packet_v1` fields:

- `schema_version`
- `authority_layer: stage_0_discovery`
- `hypothesis_id`
- `mechanism`
- `falsifiable_prediction`
- `market_structure_assumption`
- `instrument_scope`
- `timeframe_candidate`
- `strategy_family`
- `mt5_relevance_classification`
- `required_data`
- `expected_holding_period`
- `expected_trade_frequency`
- `expected_failure_modes`
- `invalidation_criteria`
- `implementation_shape`
- `execution_sensitivity`
- `mt5_ftmo_concerns`
- `prior_related_lessons`
- `prior_failed_patterns_checked`
- `novelty_reason`
- `disconfirming_evidence`
- `proposed_experiment_shape`
- `source_records`
- `content_hash`

Minimum `research_ideation_manifest_v1` fields:

- `schema_version`
- `authority_layer: stage_0_discovery`
- `research_run_id`
- `memory_checked`
- `sources_considered`
- `hypotheses_accepted`
- `hypotheses_rejected`
- `duplicates_detected`
- `budget_used`
- `operator_relevant_blockers`
- `artifact_paths`

Planner prompts should receive only:

- hypothesis packet path/hash
- short summary
- source IDs
- relevant failure warnings

Raw research notes must stay on disk. A hypothesis is a test object, not an identity. If it fails, ResearchBrain records why and moves on. ResearchBrain output is indexed as Stage 0 discovery evidence and cannot create profitability or promotion claims.

### 11.16A ResearchBrain Autonomy Correction

Added 2026-05-21 after operator review.

This correction is part of the active architecture spec, not a side memo. Future agents must read it as implementation guidance for Phase 8B.

The intended ResearchBrain is an LLM reasoning and tool-using agent. It is not a deterministic prefetch pipeline pretending to discover hypotheses.

Decision logic:

- The factory exists to discover non-obvious, source-backed, falsifiable trading hypotheses, not only to validate ideas already obvious to deterministic code.
- Deterministic code is essential as the cage, ledger, validator, artifact writer, hash checker, budget enforcer, and evidence authority.
- Deterministic code has no discretion or judgment. If it replaces the ResearchBrain, the loop risks becoming safe but intellectually weak.
- ResearchBrain must be able to think, search, compare sources, inspect prior failures, reject weak ideas, notice disconfirming evidence, synthesize mechanisms, and choose where to dig next.
- A deterministic source prefetcher may exist as a helper tool or reproducibility aid, but it must not become the discovery brain.
- The safety boundary is that ResearchBrain output remains Stage 0 only. It can propose hypotheses; it cannot prove profitability, mutate official state, execute WFA or MT5 jobs, score promotion, or bypass deterministic workers.

Important model-bias observation:

- During Phase 8B architecture review, GPT-5.5 repeatedly tended toward a more deterministic ResearchBrain design, including deterministic prefetch plus constrained synthesis.
- That tendency is useful for preventing fake evidence, hidden state mutation, and uncontrolled execution.
- The same tendency can become excessive conservatism in the discovery layer and can defeat the purpose of the autonomous research loop if future agents treat deterministic safety as a replacement for LLM research judgment.
- This note is not an accusation against the model or agents. It is a burden marker: future agents must actively distinguish evidence authority from research intelligence.

Required design stance:

- Build a powerful bounded LLM ResearchBrain.
- Give it meaningful research tools behind explicit budgets, allowlists, transcripts, source capture, path/hash provenance, duplicate checks, and disconfirming-evidence requirements.
- Keep deterministic validation strict after the LLM acts.
- Do not weaken the ResearchBrain into a static crawler merely because deterministic designs feel safer.
- Do not let the LLM's confidence become evidence.

The correct separation is:

```text
LLM ResearchBrain: think, search, judge, reject, synthesize, propose.
Deterministic runtime: constrain, record, hash, validate, quarantine.
Deterministic WFA/MT5 workers: falsify or support later.
Official control plane: own state, evidence, gates, and promotion authority.
```

### 11.16B Phase 8B ResearchBrain Audit Consolidation

Added 2026-05-22 after end-to-end audit: `factory/research/phase8b-researchbrain-end-to-end-audit-2026-05-22.md`.

This spec is the active source of truth. Supporting Phase 8B memos may explain decisions, but they must not override this section.

Audit verdict:

- ResearchBrain's architecture direction is correct for a solo quant loop: powerful LLM research brain inside a deterministic Stage-0 cage.
- The deterministic Stage-0 cage, provenance, retrieval, and downstream executor gates are solid enough for bounded Phase 8B closeout.
- The current implementation has passed one source-backed live Stage-0 canary with deterministic Brave source capture and OpenCode Go DeepSeek through the OpenAI-compatible adapter, and Ideator/backlog consumption of the packet/source by exact path and hash is verified. Provider-native web/search output still cannot count without deterministic source capture artifacts.
- The strongest current risk is not fake WFA evidence. The strongest risk is fake or low-quality Stage-0 research entering backlog through source laundering, weak memory enforcement, low-trust single-source packets, or lost provenance.
- Phase 8B closed after a real source-backed live ResearchBrain canary produced one valid `hypothesis_packet_v1` and Ideator/backlog consumption by packet/source path and hash was verified. Stage-0 packets still cannot become execution, profitability, or promotion evidence.

Supporting docs (deleted 2026-06-24 as folded into this spec; decisions retained in the status entries below and in Section 11.16B):

Superseded material must not be treated as active doctrine when it conflicts with this spec. In particular, deterministic-prefetch-first interpretations, local metric/correlation tools inside ResearchBrain, generic `fetch_search_result` naming, fixture/scripted runs as closeout evidence, or any ResearchBrain market-data/WFA/MT5/MQL5/profitability tool are rejected.

Must fix before first live provider canary, in implementation order:

1. [x] Split fixture/live tool modes so live search tools cannot accept injected `input.results`, and live `capture_url_source` cannot accept LLM-supplied `content`.
2. [x] Add output-directory and run-id collision guards so ResearchBrain cannot overwrite prior run artifacts.
3. [x] Centralize Stage-0 packet/source field allowlists and profitability alias rejection; reject aliases such as `sharpe_ratio`, `cagr`, `pnl_total`, `edge_rating`, unexpected packet fields, and arbitrary provider-field spreading.
4. [x] Ensure `search_research_memory`, `check_duplicate_memory`, and `check_failed_pattern_similarity` prerequisites complete before `record_hypothesis` can accept a packet; current implementation may auto-run missing prerequisites internally while preserving hard failed-pattern blocking.
5. [x] Restrict `read_repo_artifact` to approved artifact roots and deny `.env`, credential, key/token, `.git`, opencode config, and unrelated repo files.
6. [x] Override or reject provider `research_run_id` mismatch so stale or cross-run provider output cannot label artifacts under another run.
7. [x] Add the provider-agnostic live LLM agent/provider seam and explicit live CLI flags only after the above safety fixes.
8. [x] Add the first concrete direct provider adapter boundary (OpenAI-compatible/DeepSeek), fail-closed unless live LLM opt-in and API-key environment are explicit; direct DeepSeek adapter boundary is implemented, fake-fetch tested, and does not enable provider-native web/search authority.
9. [x] Run one bounded source-backed live canary only after explicit operator authorization and required live source-capture prerequisites; source-backed live canary succeeded on 2026-05-23, and Ideator/backlog consumption by packet/source path and hash is now verified before Phase 8B closeout.

Status, 2026-05-22 safety-slice update: items 1-3 above are implemented and covered by focused tests. `src/core/researchbrain-tools.mjs` now has explicit fixture/live tool mode separation; live mode rejects caller-supplied search `input.results` and LLM-supplied `capture_url_source.content` because deterministic live adapters are not implemented yet. `src/core/researchbrain-runtime.mjs` now fails loud on non-empty output directory/run-id collisions unless an explicit test-only overwrite option is supplied. `src/core/researchbrain-artifacts.mjs` now centralizes Stage-0 profitability-key rejection, includes alias blocking for `sharpe_ratio`, `cagr`, `pnl_total`, and `edge_rating`, and rejects unexpected accepted source-record/hypothesis-packet fields so provider output cannot spread arbitrary packet fields into accepted artifacts. Focused ResearchBrain tests passed 40/40 after this slice.

Status, 2026-05-22 memory/read safety-slice update: items 4-5 above are implemented and covered by focused tests. `record_hypothesis` now requires same-run calls to `search_research_memory`, `check_duplicate_memory`, and `check_failed_pattern_similarity` before accepting a packet; the output ideation memory record now includes the exact required-tool-call booleans. `read_repo_artifact` is now restricted to approved artifact roots (`factory/research/`, `factory/mt5/`, `factory/verification/`, `factory/experiments/`, `factory/runs/`, `factory/summaries/`, `factory/evidence/`, `factory/memory/`, `workspace/results/`), requires a regular file under the repository real path, and denies `.env`, credential/key/token-like files, `.git`, `.opencode`, and `opencode.json/jsonc`. Focused ResearchBrain tests passed 42/42 after this slice. This still does not implement a live provider, WFA/MT5/MQL5 tools, market data, trading/account tooling, profitability estimation, official state/evidence/backlog/leaderboard mutation, or strategy edge claim. Remaining before canary: enforce provider `research_run_id` identity, then add the provider-agnostic live LLM seam.

Status, 2026-05-22 provider identity safety-slice update: item 6 above is implemented and covered by focused tests. `runResearchBrainStage0Runtime()` now assigns missing provider `research_run_id` to the runtime run id, but rejects any non-empty mismatch before source-support validation or artifact acceptance, so stale or cross-run provider output cannot label source records, digests, ideation manifests, or raw accepted artifacts under another run. The fixture provider now uses the runtime `run_id` from provider context. Focused ResearchBrain tests passed 43/43 after this slice. Remaining before canary: add the provider-agnostic live LLM seam and explicit live CLI flags.

Status, 2026-05-22 live-seam safety-slice update: the provider-agnostic live LLM agent seam and explicit CLI flags are implemented, but no concrete live provider adapter and no live canary had been run at that point. `createLiveResearchBrainAgentProvider()` requires explicit `allowLiveLlm=true`, accepts an injectable `llmClient.generate(context)` adapter, executes only the deterministic v1 tool catalog, writes transcript/tool/cost/working-notes artifacts, and returns the existing Stage-0 provider output shape for the runtime validators. The CLI exposes `--provider-mode live_llm_agent`, `--allow-live-llm`, `--llm-provider`, `--llm-model`, `--max-llm-calls`, and reserved explicit live source/YouTube opt-in flags; without a concrete adapter it fails closed. Focused ResearchBrain tests passed 45/45 after this slice. Remaining before Phase 8B closeout: implement the first concrete direct provider adapter and run one bounded source-backed live canary, then prove Ideator consumption by packet/source path and hash.

Status, 2026-05-22 direct-provider boundary slice: `src/core/researchbrain-llm-providers.mjs` adds the first concrete direct LLM provider boundary for OpenAI-compatible chat completions via injectable `fetchImpl`. It fails closed unless `allowLiveLlm=true`, provider is supported, model is non-empty, and an API key is supplied directly or through an explicit/default environment variable. The adapter exposes deterministic tool schemas only, sets `provider_native_search_enabled=false`, and treats a no-tool `stop` finish as the final stop signal for the local cage. The runtime CLI now wires `live_llm_agent` to this adapter and adds `--llm-api-key-env` / `--llm-max-tokens`; no live call occurs by default and no provider-native search output can count as a source artifact. Focused fake-fetch ResearchBrain tests passed 47/47 after this slice. Still not done at that point: no live provider canary, no live deterministic search/source adapters, no Ideator consumption proof, no WFA/MT5/MQL5/market-data/trading/profitability authority, and no official state/evidence/backlog/leaderboard mutation.

Status, 2026-05-22 deterministic source-adapter boundary slice: `src/core/researchbrain-tools.mjs` now accepts an injected deterministic `sourceToolAdapter` for live tool mode and includes a map/test adapter for fake-client coverage. Live `search_web` still rejects LLM-supplied `input.results`, but can now use `sourceToolAdapter.search`; live `capture_url_source` still rejects LLM-supplied `content`, requires prior discovered URL, and can now use `sourceToolAdapter.captureUrl` to write hashed source-capture artifacts with deterministic-capture provenance and `provider_native_search_enabled=false`. `createLiveResearchBrainAgentProvider()` passes the adapter into the local tool cage. This is a boundary only: no network source adapter, no provider-native search evidence, no YouTube/API live adapter, no canary, no WFA/MT5/MQL5/market-data/trading/profitability authority, and no official state/evidence/backlog/leaderboard mutation. Focused fake-client ResearchBrain tests passed 49/49 after this slice.

Status, 2026-05-22 Brave source adapter boundary slice: `src/core/researchbrain-tools.mjs` now includes a fail-closed Brave Search API source adapter for live `search_web` plus deterministic URL capture from prior Brave discoveries. It requires explicit `allowLiveSourceSearch=true`, explicit `allowLiveSourceCapture=true` for capture, and an API key supplied only through runtime env/config (`BRAVE_SEARCH_API_KEY` by default or `--source-api-key-env`). `scripts/run-researchbrain-stage0-runtime.mjs` exposes `--source-provider brave`, `--allow-live-source-search`, `--allow-live-source-capture`, and `--source-api-key-env`. No API key is stored or hardcoded in repo/spec; operator-provided env values are rotatable and external to artifacts. Tests use fake `fetchImpl` only. Focused ResearchBrain tests passed 50/50 after this slice. Still not done: no real live canary has run, and no OpenCode/OpenAI-compatible LLM adapter is wired for the operator's DeepSeek model yet.

Status, 2026-05-22 OpenAI-compatible LLM boundary slice: `src/core/researchbrain-llm-providers.mjs` now supports provider `openai_compatible` for OpenAI-style `/chat/completions` APIs, intended for operator-selected OpenCode-compatible/DeepSeek routing when the base URL is supplied out-of-repo. It requires explicit `allowLiveLlm=true`, model, API key env (`OPENCODE_API_KEY` default or `--llm-api-key-env`), and base URL env (`OPENCODE_API_BASE_URL` default or `--llm-base-url-env`/`--llm-base-url`). It maps function tool calls into the same local deterministic tool cage and marks `provider_native_search_enabled=false`. No secret values are stored in repo/spec/artifacts. Tests use fake `fetchImpl` only. Focused ResearchBrain tests passed 51/51 after this slice. Still not done: no real live canary has run.

Status, 2026-05-23 Opencode DeepSeek preset slice: `scripts/run-researchbrain-stage0-runtime.mjs` now exposes `--llm-preset opencode_deepseek_v4_pro`, which expands to `--llm-provider openai_compatible`, model `deepseek-v4-pro`, API key env `OPENCODE_GO_API_KEY`, and non-secret OpenCode Go base URL `https://opencode.ai/zen/go/v1`. The Go subscription endpoint is distinct from the Zen free-tier endpoint; the adapter appends `/chat/completions`. Live API connectivity was verified: both Brave Search (`https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token` header) and DeepSeek V4 Pro via OpenCode Go (`https://opencode.ai/zen/go/v1/chat/completions`, `Authorization: Bearer` header) return HTTP 200. No secret values stored in repo/spec/artifacts; env vars are operator-provided and rotatable. The preset fails closed when `OPENCODE_GO_API_KEY` is missing.

Status, 2026-05-23 source-backed live ResearchBrain canary: explicit operator-authorized live canary succeeded with `--provider-mode live_llm_agent`, `--allow-live-llm`, `--llm-preset opencode_deepseek_v4_pro`, `--tool-mode live`, Brave source search/capture, env-only credentials, and bounded budgets. Request: `factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-OFI-CANARY-20260523T135000Z/request.json` sha256 `8a46e46b9cde56b47177669bdfb44a891015f8cbd1a7f635f912003beb38624b`. Accepted runtime result: `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/runtime-result.json` sha256 `5bd881d858ffaacb80e14ff307fb2fd9d332763373c86728ec8cfc027e8357b9`, status `ready`, evidence kind `stage0_research_discovery`, authority `stage_0_discovery`, provider `live_llm_agent`, no quarantine, no official state/evidence/backlog/leaderboard mutation, no profitability labels, no WFA, and no MT5 execution. Deterministic source capture: `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/tool-captures/url/SRC-LIVE-CANARY-001/content.md` sha256 `89232ceb2dc247534ac4166eb8ab0e12c1827e8c4cdcbd0d86416ecbe3c2a71a`; source record: `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/source-records/SRC-LIVE-CANARY-001.json` sha256 `197b227b9b290cc3ce8fd06a5ae4ee2300fa79f6901a4fbd4e53ccb14f90f4d5`; hypothesis packet: `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/hypotheses/HYP-STAGE0-LIVE-CANARY-001.json` sha256 `a4412b1b91f24e024eda6aa51a0e9e085693e426864fb5d7bbc846f103c11af5`; ideation manifest: `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/ideation-manifest.json` sha256 `58dff21ca64f4ed0aa5d03621aa820adc894df4cd753bf67f1f29a8533fac3ee`; Stage-0 manifest: `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/manifest/manifest.json` sha256 `f267aaf3304f5c486ff5e3bd274e013545c36e52f403e25cb69fbb01b59a4a62`. Packet is Stage-0 only: OFI amplification hypothesis is `mt5_relevant_unverified`, cites deterministic captured source `SRC-LIVE-CANARY-001`, includes memory/duplicate/failed-pattern checks, and contains no execution/promotion/profitability authority. Important caveat: the source is a low-signal-trust Federal Reserve Treasury-market note, not FTMO/MT5 equivalence evidence and not a strategy edge claim. Phase 8B remains open until Ideator consumes the packet/source by exact path/hash.

Status, 2026-05-23 live-canary hardening from failures: `scripts/run-researchbrain-stage0-runtime.mjs` now applies `--source-max-bytes` to Brave deterministic source capture as well as generic source fetching; live LLM tool schemas now provide exact argument shapes/minimums for search, capture, memory checks, and `record_hypothesis`; the live agent narrows advertised tools to `record_hypothesis` after one captured source and required memory checks; and the live agent returns deterministic output immediately after `record_hypothesis` succeeds instead of requiring an extra final no-tool LLM turn. Focused verification after this slice: `node --test tests/researchbrain-artifacts.test.mjs tests/researchbrain-agent.test.mjs` passed 52/52 and `rtk npm run validate` passed.

Status, 2026-05-23 Phase 8B closeout slice: Ideator/backlog consumption of the accepted live canary packet is now path/hash enforced. `src/core/researchbrain-artifacts.mjs` validates ResearchBrain-derived backlog candidates with exact `hypothesis_packet_path`/`hypothesis_packet_sha256`, non-empty `source_record_refs` matching packet source records by path/hash, `research_run_id`, and preserved `researchbrain_evidence_kind: stage0_research_discovery` plus `researchbrain_authority_layer: stage_0_discovery`; it rejects prose-only candidates, dropped source hashes, Stage-0 executable evidence, Stage-0 executable authority, and profitability/promotion aliases. `src/core/orchestrator.mjs` preserves those fields on Ideator auto-generated ResearchBrain candidates and applies a source-quality gate. `src/core/prompt-builders.mjs` now tells Ideator to output exact packet/source refs and warns that a single `low_signal_trust` source is not WFA-ready. `src/core/wfa-plan-compiler.mjs` carries ResearchBrain packet/source hashes into deterministic WFA plans when allowed and blocks low-signal direct WFA routes. The accepted live canary remains Stage-0 only and is consumable only as `requires_more_research` because its single source is `low_signal_trust`. Verification: `node --test tests/researchbrain-artifacts.test.mjs tests/researchbrain-agent.test.mjs` passed 55/55 and includes the live packet `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/hypotheses/HYP-STAGE0-LIVE-CANARY-001.json` sha256 `a4412b1b91f24e024eda6aa51a0e9e085693e426864fb5d7bbc846f103c11af5` plus source record `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/source-records/SRC-LIVE-CANARY-001.json` sha256 `197b227b9b290cc3ce8fd06a5ae4ee2300fa79f6901a4fbd4e53ccb14f90f4d5`; `node --test tests/factory.test.mjs` passed 63/63. Phase 8B bounded ResearchBrain closeout is satisfied; Phase 8C and 8D are now closed; Phase 8E remains not started.

### 11.16C ResearchBrain Retry And Recovery Contract

Added 2026-06-03 after post-Phase-8D zero-survivor stop decision.

The continuous discovery loop must tolerate transient infrastructure failures without weakening evidence rules. Deterministic code remains the cage, ledger, validator, artifact writer, and retry classifier. ResearchBrain remains a bounded Stage-0 reasoning/search agent only.

Retry classes:

- `transient_retryable_failure`: provider/search/capture/network/rate-limit/timeout style failures that may be retried without changing the hypothesis, source query intent, symbol, timeframe, data, cost model, WFA config, or result interpretation.
- `schema_or_validation_failure`: malformed JSON, schema mismatch, invalid Stage-0 packet/source support, missing required fields, forbidden live-tool inputs, path validation, and similar deterministic validation failures. These are quarantined and normally terminal for that attempt.
- `poison_candidate_or_run`: profitability/promotion labels, forbidden metric claims, stale/cross-run `research_run_id`, source laundering, or other evidence-contamination signals. These are terminal and must not be retried as the same candidate/run.
- `terminal_failed_condition`: non-transient provider/account/config/tool failures that are not validation poison but still cannot proceed.

Retry artifact requirements:

- Every retryable provider/tool attempt must record attempt number, phase, started/completed timestamps, error class/message, failure class, `retryable`, backoff used, and final terminal state in runtime result, quarantine, transcript, or tool-ledger artifacts.
- Error messages persisted to artifacts must redact bearer tokens, API keys, auth headers, and token-like values. Secrets remain env-only and must not be written to repo, logs, specs, memory, transcripts, ledgers, or runtime-result artifacts.
- Bounded backoff is allowed only for infrastructure-equivalent retries. Retrying must not alter research semantics or hide denominator membership.
- Stage-0 ResearchBrain retries may re-call a provider or deterministic source adapter after transient failure, but accepted output remains Stage-0 only and still requires source records, hypothesis packets, digest, ideation manifest, and Stage-0 manifest validation.
- Source search/capture retries are allowed only through deterministic source adapters; provider-native web/search output still cannot count as evidence.
- If a deterministic WFA worker launched and produced metrics, the attempt is denominator evidence. It must not be rerun as a retry unless the failure is clearly infrastructural and pre-result, and existing denominator/pre-registration rules permit it. No retry may tune or change parameters after seeing results.
- Failed, blocked, timed-out, retried, and quarantined attempts remain evidence/denominator context. They must not be deleted or overwritten.

Status, 2026-06-03 narrow implementation slice: `src/core/retry-policy.mjs` adds shared retry classification, backoff, attempt recording, and error-message redaction. `runResearchBrainStage0Runtime()` records retry metadata on provider attempts and quarantines terminal validation/poison failures. Live ResearchBrain source search/capture tools now use bounded retry through deterministic source adapters and surface retry attempts in tool ledgers and capture provenance. `scripts/run-researchbrain-stage0-runtime.mjs` exposes explicit retry knobs for provider and source-tool retry delay/attempt caps. This does not start Phase 8E, does not add MT5/MQL5/parity/deployment work, does not run WFA, does not mutate official state/evidence/backlog/leaderboard directly from ResearchBrain, and does not claim a strategy edge.

### 11.16D ResearchBrain Continuous Loop Skeleton

Added 2026-06-03 as the first post-retry continuous-discovery control-plane slice.

`src/core/researchbrain-loop-runner.mjs` defines a narrow deterministic runner for `researchbrain_stage0` runtime-ledger jobs. The runner claims jobs through runtime-ledger leases/fencing tokens, reads a repo-relative `request_path` from job payload, calls the existing bounded `runResearchBrainStage0Runtime()`, records a `job_attempts` row, mirrors Stage-0 runtime artifacts/quarantine/result references into the runtime ledger, finalizes the job as `stage0_ready` or `blocked`, and emits a runtime-ledger outbox event. `scripts/run-researchbrain-stage0-loop.mjs` exposes the loop runner with explicit max-job, lease, and runtime-budget knobs.

Boundary: this loop skeleton is ledger/control-plane plumbing only. It does not mutate official `factory/state.json`, `factory/backlog.json`, `factory/evidence/index.json`, `factory/leaderboard.json`, or `factory/memory/lessons.jsonl`; does not launch WFA; does not touch MT5/MQL5/parity/deployment; does not create profitability labels; and does not grant ResearchBrain direct backlog/evidence authority. ResearchBrain output remains Stage-0 only until separate deterministic gates consume exact path/hash-backed artifacts.

Status, 2026-06-03 failure-memory retrieval slice: derived ResearchBrain memory now exposes details from same-run Stage-0 ideation manifest `hypotheses_rejected` and `duplicates_detected`, not only counts, so future ResearchBrain memory tools can see rejected ideas, duplicate reasons, and failed-pattern basis. The derived retrieval index also surfaces compact read-only `phase8d_failed_summary` entries from failed Phase 8D markdown summaries under `factory/summaries/`, including non-survivor/gate-denied/Phase-8E-blocked context. `check_failed_pattern_similarity` treats those derived entries as failed-pattern memory. This is read-only retrieval/index behavior only: it does not mutate official state/evidence/backlog/leaderboard, does not run WFA, does not start Phase 8E, does not loosen survivor gates, and does not make Stage-0 artifacts executable evidence.

Status, 2026-06-03 stale/poison loop reliability slice: the Stage-0 loop now preserves `poison_candidate_or_run` as terminal runtime-ledger job/run status `poisoned` instead of flattening it into generic `blocked`, and attempt payloads retain the runtime `final_terminal_state`. Expired claimed jobs remain reclaimable through the existing runtime-ledger lease/fencing path, while poisoned jobs are released under a non-claimable terminal status so unattended loop iterations do not spin forever on evidence-contaminating outputs. This remains runtime-ledger/control-plane hygiene only: no official state/evidence/backlog/leaderboard mutation, no WFA, no MT5/MQL5, no Phase 8E, and no survivor-gate loosening.

Status, 2026-06-03 outbox projection and source-count gate slice: `src/core/researchbrain-stage0-outbox-consumer.mjs` plus CLI `scripts/run-researchbrain-stage0-outbox-consumer.mjs` / npm `researchbrain:stage0-outbox` consume pending `researchbrain.stage0_job_finished` runtime-ledger outbox events, write bounded diagnostic projections under `factory/runtime/projections/researchbrain-stage0/`, and mark events processed idempotently. The projection is diagnostic/control-plane visibility only and does not append backlog/evidence or mutate official state. Direct WFA-ready influence from ResearchBrain packets is also tightened: even high-trust single-source packets remain `requires_more_research`; direct WFA-ready routes now require at least two readable same-run source records, clean memory/duplicate/rejection gates, and a valid same-run ideation manifest. This does not launch WFA, does not start Phase 8E, does not loosen survivor gates, and does not convert Stage-0 artifacts into executable evidence.

Status, 2026-06-04 unattended diagnostics slice: `src/core/researchbrain-stage0-diagnostics.mjs` plus CLI `scripts/run-researchbrain-stage0-diagnostics.mjs` / npm `researchbrain:stage0-diagnostics` provide a compact read-only operational report for the continuous Stage-0 loop. The report summarizes `researchbrain_stage0` job counts for queued/ready/claimed/stale-claimed/blocked/poisoned/`stage0_ready`, latest attempts, pending/processed `researchbrain.stage0_job_finished` outbox counts, oldest pending events, and recent projection artifacts under `factory/runtime/projections/researchbrain-stage0/` with paths and SHA-256 hashes. The command is diagnostic visibility only: it does not claim jobs, process outbox events, append backlog/evidence, mutate official state/evidence/leaderboard/memory files, run WFA, touch MT5/MQL5/parity/deployment, start Phase 8E, loosen survivor gates, or create profitability labels.

Status, 2026-06-04 request-queue seeding slice: `src/core/researchbrain-stage0-job-seeder.mjs` plus CLI `scripts/run-researchbrain-stage0-job-seeder.mjs` / npm `researchbrain:stage0-seed` seed one runtime-ledger `researchbrain_stage0` job from an existing `researchbrain_request_v1` artifact. The seeder requires a repo-relative JSON path under `factory/research/requests/`, a caller-supplied SHA-256 matching the file on disk, valid request schema with hash-backed Phase 8A references when present, and deterministic run/job IDs derived from the request path and hash. Re-running the same seed is idempotent; conflicting existing rows fail loud. This mutates only the runtime ledger queue, not official factory state/evidence/backlog/leaderboard/memory files; it does not call an LLM, search sources, process outbox events, run WFA, touch MT5/MQL5/parity/deployment, start Phase 8E, loosen survivor gates, or create profitability labels.

Status, 2026-06-04 request-integrity loop hardening slice: `src/core/researchbrain-loop-runner.mjs` now treats `payload.request_sha256` as an execution preflight when present. Before calling `runResearchBrainStage0Runtime()`, the loop validates the SHA format, resolves the repo-contained `request_path`, verifies the artifact still exists, hashes it, and blocks the job as `schema_or_validation_failure` if the queued hash no longer matches. Successful attempts record the verified request artifact in the attempt payload. This prevents stale or tampered Stage-0 request artifacts from being silently executed after queue seeding; it does not change ResearchBrain authority, mutate official state/evidence/backlog/leaderboard/memory files, run WFA, touch MT5/MQL5/parity/deployment, start Phase 8E, loosen survivor gates, or create profitability labels.

Status, 2026-06-04 request-deduplication and failure-observability slice: `src/core/researchbrain-stage0-job-seeder.mjs` now performs request-hash duplicate checks inside a single runtime-ledger immediate transaction. A second seed of the same `researchbrain_request_v1` SHA-256, including path-variant copies under `factory/research/requests/`, returns `already_seeded` with `duplicate_resolution: same_request_sha256` and the existing run/job identity instead of creating a parallel Stage-0 job. `src/core/researchbrain-loop-runner.mjs` now records compact `failure_summary` objects for blocked and poisoned attempts, including failure class, retryability, request artifact path/SHA when available, runtime-result/quarantine refs, final terminal state, and blockers. `src/core/researchbrain-stage0-outbox-consumer.mjs` carries that failure summary into diagnostic projections, and `src/core/researchbrain-stage0-diagnostics.mjs` reports bounded `attempts.latest_failures` plus a `--failure-limit` CLI knob. This improves unattended-loop safety and triage only: it mutates only runtime-ledger queue/projection state, does not mutate official state/evidence/backlog/leaderboard/memory files, does not run WFA, does not touch MT5/MQL5/parity/deployment, does not start Phase 8E, does not loosen survivor gates, and does not create profitability labels.

Status, 2026-06-04 bounded supervisor cycle slice: `src/core/researchbrain-stage0-supervisor.mjs` plus CLI `scripts/run-researchbrain-stage0-supervisor.mjs` / npm `researchbrain:stage0-supervisor` run one controlled Stage-0 operations cycle: optional request seed, bounded loop processing, outbox projection, and diagnostics. The supervisor enforces narrow bounds (`maxJobs` 1-25, outbox 1-100, diagnostics limits), requires both `request_path` and SHA-256 when seeding, reuses the seed-time request-SHA deduplication guard, and returns one non-authoritative JSON envelope with seed/loop/outbox/diagnostics subresults. It writes no official artifacts and performs no authority conversion; only the underlying runtime-ledger queue and diagnostic projection locations may mutate. This is operational plumbing only: no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate loosening, and no profitability labels.

Status, 2026-06-04 Stage-0 operations readiness slice, amended 2026-06-05: `src/core/researchbrain-stage0-readiness.mjs` plus CLI `scripts/run-researchbrain-stage0-readiness.mjs` / npm `researchbrain:stage0-readiness` provide a read-only operational readiness report that combines diagnostics, `factory/research/requests/` request artifacts, seeded `researchbrain_stage0` runtime-ledger jobs, and projection health. The report flags attention for diagnostics attention, pending outbox, claimable jobs, invalid request artifacts, unseeded valid request artifacts, malformed latest projections, and stale or hash-mismatched latest projection references. Projection integrity checks verify cited runtime-ledger event/run/job/attempt rows plus projection-cited request/runtime/artifact paths and SHA-256 hashes, including request refs inside runtime-result artifacts when present. Readiness now also compares a runtime-result artifact's internal `request_ref` against the request artifact cited by the same projection/event, so a stale cross-run runtime-result cannot pass merely because its own request ref is internally hash-valid. By default the command prints JSON only; `--write` writes a non-authoritative report under `factory/verification/` with no official authority conversion. This is visibility only: it does not claim jobs, process outbox, seed requests, call providers, run WFA, touch MT5/MQL5/parity/deployment, start Phase 8E, loosen survivor gates, create profitability labels, or mutate official state/evidence/backlog/leaderboard/memory files.

Status, 2026-06-05 Stage-0 operations reliability canary/invariant slice: readiness now also flags seeded jobs whose `output_dir` already contains `runtime-result.json` or `manifest/manifest.json` with a different run identity, preventing stale output collisions from hiding behind an otherwise valid request seed. A deterministic supervisor canary fixture exercises seed -> loop -> outbox -> readiness and asserts readiness is clean with no official state/evidence/backlog/leaderboard mutation, no WFA/MT5 execution, and no Phase 8E start. Focused package-script coverage verifies the supervisor/readiness npm aliases still point to existing CLIs. Prompt policy capsules now include the Context7 coding-work invariant so future prompt refactors cannot silently drop the requirement to fetch current docs before coding work. This remains Stage-0 operations and prompt-safety plumbing only: no ResearchBrain promotion authority, no WFA screening, no MT5/MQL5/parity/deployment, no survivor-gate changes, and no profitability labels.

Status, 2026-06-05 Stage-0 operations hardening batch: `src/core/researchbrain-stage0-job-seeder.mjs` now rejects a new seed before ledger insertion when the chosen runtime `output_dir` already contains `runtime-result.json` or `manifest/manifest.json` for a different run identity, and the supervisor inherits that pre-loop guard. `src/core/researchbrain-stage0-diagnostics.mjs` now emits explicit `attention_reasons` for stale claimed jobs, claimable jobs, blocked jobs, poisoned jobs, and pending outbox events instead of only a coarse status. `src/core/researchbrain-stage0-readiness.mjs` now groups latest projection-integrity failures in `issue_counts_by_reason`, making stale/mismatched projection classes visible without hand-counting entries. The supervisor canary now also writes a non-authoritative readiness report and verifies its SHA-256 while preserving official-state hashes. All ResearchBrain Stage-0 CLI help surfaces are covered by a compact regression test that verifies package aliases, command existence, usage output, and explicit no-official-mutation/no-WFA/no-MT5/no-Phase-8E/no-profitability-label boundaries. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 26/26. This is operational reliability only: it does not mutate official state/evidence/backlog/leaderboard/memory files, does not call live providers unless separately requested by existing runtime flags, does not run WFA, does not touch MT5/MQL5/parity/deployment, does not start Phase 8E, does not loosen survivor gates, and does not create profitability labels.

Status, 2026-06-05 Stage-0 CLI parsing guard slice: Stage-0 command entrypoints now share `scripts/researchbrain-stage0-cli-args.mjs` for fail-loud option parsing. Flags that require values reject missing values or another `--flag` token before execution, and numeric flags reject non-finite values instead of passing `undefined`/`NaN` into runtime behavior. Covered entrypoints include runtime, loop, outbox consumer, diagnostics, seeder, supervisor, readiness, and manifest helper CLIs. Focused CLI tests now cover missing `--root`, `--root --help`, and invalid numeric values. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 28/28, and `rtk npm run validate` passed. This remains Stage-0 operational hygiene only: no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-05 Stage-0 projection/lease reliability slice: runtime-ledger job claims now expose stale-lease reclaim metadata (`prior_owner_id`, prior/new fencing tokens, stale heartbeat/expiry) and the Stage-0 loop reports `lease_reclaims` plus per-job claim metadata while preserving it in attempt payloads. Readiness projection integrity now checks projection row status/identity against live runtime-ledger run/job/attempt rows, detects event-vs-ledger status drift, verifies projection-cited non-request artifacts are mirrored in the runtime-ledger artifact table by path/SHA/type, and flags artifact identity mismatches against projection run/job/attempt identity. Added canaries cover a tampered projection whose runtime artifact exists on disk but is absent from the ledger mirror, plus a supervisor cycle that reclaims an expired `researchbrain_stage0` lease and processes it through loop/outbox/readiness with clean readiness afterward. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 30/30. This remains runtime-ledger/projection reliability only: no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-05 Stage-0 processed-outbox projection accountability slice: readiness now also verifies every processed `researchbrain.stage0_job_finished` outbox row carries an `outbox_consumer.result.projection_artifact`, that the cited projection file exists with the recorded SHA-256, that the projection event id matches the processed outbox event, and that projection `projected_at` matches the consumer `processed_at` when both are present. Readiness separately scans projection files for duplicate `event_id` values and reports duplicate projection events plus stale duplicate projection files without deleting anything. These checks surface under `projection_health.processed_outbox` and add the `processed_outbox_projection_mismatch` attention reason. Focused canaries cover processed outbox rows missing projection artifacts and duplicate projection files for one processed event. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 32/32. This remains read-only Stage-0 runtime-ledger/projection diagnostics only: no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-06 Stage-0 projection freshness/schema/authority diagnostic slice: processed-outbox readiness now also bounds processed-event scanning with `processedOutboxLimit` / CLI `--processed-outbox-limit`, reports total/checked/truncated counts, validates cited projection schema version, rechecks projection authority flags (`official_*`, profitability, WFA, MT5), and flags projection files modified after the outbox event was processed beyond a small filesystem timestamp grace. Focused canaries cover the CLI option, bounded scan truncation, schema mismatch, invalid authority flag, and post-processing file modification. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 35/35. This remains read-only Stage-0 runtime-ledger/projection diagnostics only: no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-06 Stage-0 processed-outbox projection consistency addendum: readiness now also checks that the processed outbox consumer id matches projection `consumer_id`, that consumer-result `projected_status` matches the projection's status, and that recorded projection artifact `size_bytes` matches the file on disk when supplied. These are consistency diagnostics only; they do not delete projections, reprocess outbox events, or change authority boundaries.

Status, 2026-06-06 Stage-0 terminal-failure reconciliation slice: readiness now distinguishes expected terminal ResearchBrain Stage-0 failures from operational inconsistencies. Raw diagnostics still report blocked and poisoned jobs, but readiness adds `terminal_failure_reconciliation` and `actionable_diagnostics_reasons`; a blocked/poisoned Stage-0 job is treated as an expected terminal outcome only when its latest attempt has a non-retryable failure summary, the run/job/attempt statuses reconcile, the finished-job outbox event was processed, the diagnostic projection exists and matches the processed outbox record, projection authority flags remain false, and projection integrity has no actionable issues. Request artifacts that changed after seeding are reported as `changed_seeded_sha`, but if the loop blocked at request-SHA preflight and the terminal failure is fully projected, readiness remains `ready` instead of treating the known request drift as infrastructure failure. Unreconciled terminal failures still raise `unreconciled_terminal_stage0_failures`; invalid unseeded requests, claimable jobs, pending outbox, projection drift, authority drift, duplicate projections, and seeded drift without a reconciled terminal failure remain attention conditions. The supervisor envelope now includes `cycle_summary` with terminal job summaries, projected terminal event counts, and actionable diagnostics, so a seed -> loop -> outbox cycle that blocks cleanly is distinguishable from an operationally broken cycle. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 36/36. This remains Stage-0 operational reliability only: no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-06 Stage-0 projection recovery and supervisor-readiness slice: readiness now adds bounded projection recovery diagnostics under `projection_health.processed_outbox.recovery`. It reports checked processed events with no matching projection file by `event_id`, projection files whose `event_id` has no Stage-0 outbox row, and projection files with parse errors or missing event IDs, without deleting, rewriting, or reprocessing any projection. These conditions add `projection_recovery_attention`. The supervisor now builds a compact read-only `readiness_summary` after seed -> loop -> outbox -> diagnostics, using bounded `readinessRequestLimit` / `processedOutboxLimit` controls exposed in the CLI, so unattended callers can distinguish a clean projected terminal block from stale projection or orphan-file recovery needs in one envelope. Focused canaries cover missing matching projection files, orphan projections, supervisor readiness summaries for clean and terminal-block cycles, and help output for the new supervisor bounds. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 37/37. This remains Stage-0 operational reliability only: no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-06 Stage-0 bounded multi-cycle supervisor slice: `src/core/researchbrain-stage0-supervisor.mjs` now also exposes `runResearchBrainStage0SupervisorCycles()` and the existing supervisor CLI accepts `--cycles <n>` with an explicit 1-25 bound plus `--continue-on-attention`. The default one-cycle output remains unchanged; multi-cycle mode returns `researchbrain_stage0_supervisor_run_result_v1` with per-cycle envelopes, aggregate status counts, queued/processed/terminal/projection totals, final compact readiness summary, and a bounded failure envelope if a later cycle throws after partial progress. Multi-cycle mode seeds only on cycle 1, then drains queued/claimable work through the existing deterministic Stage-0 loop and outbox projection. It does not treat intermediate `claimable_stage0_jobs` / pending-drain attention as a stop condition when bounded cycles remain, but final readiness attention still makes the aggregate `attention`. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 40/40. This remains bounded Stage-0 operational progress reporting only: no daemon, no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-06 Stage-0 runtime-ledger consistency slice: readiness now includes bounded `runtime_consistency` checks for final `researchbrain_stage0` jobs beyond the latest-projection window. The check scans up to `runtimeConsistencyLimit` / CLI `--runtime-consistency-limit` final jobs (`stage0_ready`, `blocked`, `poisoned`) and reports run/job status divergence, latest-attempt status divergence, missing latest attempts, missing finished-job outbox events, unprocessed finished-job outbox events, and finished-event status mismatches. These diagnostics add `runtime_ledger_consistency_attention` when inconsistent final jobs exist. The supervisor compact `readiness_summary` now includes runtime-consistency status/counts/reason counts so unattended multi-cycle callers can see whether final ledger/outbox state is internally coherent without reading the full readiness report. Focused canaries cover healthy supervisor summaries, a divergent final job with no projection dependency, the CLI/help option, and limit validation. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 41/41. This is read-only consistency diagnostics only: no repair, deletion, reprocessing, official state/evidence/backlog/leaderboard/memory mutation, WFA, MT5/MQL5/parity/deployment, Phase 8E, survivor-gate change, or profitability labels.

Status, 2026-06-06 Stage-0 supervisor failure-envelope slice: supervisor cycle execution now classifies thrown exceptions by failed operational stage (`seed`, `loop`, `outbox`, `diagnostics`, `readiness`, or `preflight_or_unknown`) and multi-cycle results include a bounded `failure.partial_cycle_summary` when an exception occurs after partial progress. This lets unattended callers distinguish, for example, a seed/preflight failure from an outbox projection failure after the loop already produced a final Stage-0 job and pending outbox event. The supervisor CLI now accepts `--failure-report-dir <path>`; when supplied it routes through the bounded cycle runner even for one cycle, returns a JSON failure envelope on stdout, exits non-zero, and writes a non-authoritative `researchbrain_stage0_supervisor_failure_report_v1` artifact under the requested repo-relative directory. Failure reports preserve explicit false authority flags and do not repair, delete, reprocess, promote, or mutate official state/evidence/backlog/leaderboard/memory. Focused canaries cover seed-stage failure classification, outbox-stage failure after loop progress, failure artifact SHA/path integrity, and CLI JSON failure output. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 43/43; `rtk npm run validate` passed. This remains bounded Stage-0 operational reporting only: no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-06 Stage-0 supervisor aggregate/reporting slice: compact supervisor readiness summaries now include bounded diagnostic job, outbox, and projection counts, and multi-cycle aggregates include `final_operational_snapshot` with final attention reasons, queue/outbox counts, request counts, terminal-failure reconciliation, projection recovery, and runtime-consistency summaries. The supervisor CLI now also accepts `--run-report-dir <path>`; when supplied it routes through the bounded cycle runner even for one-cycle runs and writes a non-authoritative `researchbrain_stage0_supervisor_run_report_v1` artifact containing the supervisor run result and explicit false authority flags. This gives unattended operators a durable report for completed, attention, or failed bounded cycles without changing official state/evidence/backlog/leaderboard/memory and without repair/reprocessing. Focused canaries cover aggregate snapshot fields, compact diagnostic counts, successful run-report artifact path/SHA/authority, and CLI run-report output. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 44/44; `rtk npm run validate` passed. This remains bounded Stage-0 operational reporting only: no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Status, 2026-06-06 Stage-0 unattended attention/exit-code slice: supervisor compact readiness summaries and multi-cycle aggregates now classify attention reasons as `none`, `drainable`, or `actionable`, where currently drainable attention is limited to queued/claimable Stage-0 jobs, pending outbox events, or diagnostics attention caused by those drainable conditions. Aggregates now include `attention_class_counts`, and `final_operational_snapshot.attention_classification` makes it clear when a bounded run stopped with remaining work that another bounded cycle can drain versus an actionable consistency/infrastructure issue. The supervisor CLI now accepts `--fail-on-attention`; default behavior remains unchanged, but with this flag a JSON result with `status: "attention"` exits with code 2 while preserving stdout JSON and optional `--run-report-dir` artifacts. Focused canaries cover drainable attention classification, aggregate class counts, CLI exit code 2 on attention, JSON preservation, run-report artifact preservation, and help output. Verification: `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 46/46; `rtk npm run validate` passed. This remains bounded Stage-0 operational alerting only: no daemon, no repair, no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels.

Addendum, 2026-06-06 attention classification correction: `diagnostics_attention` is now classified as actionable only when its underlying `actionable_diagnostics_reasons` contain non-drainable reasons; drainable diagnostics such as remaining claimable Stage-0 jobs remain `drainable` with `next_action: "continue_bounded_cycles"`. Attention classifications now also include `next_action` (`none`, `continue_bounded_cycles`, or `inspect_operational_blocker`) so unattended callers can route alert handling without parsing reason names manually. A focused canary covers invalid Stage-0 request artifacts as actionable attention with `next_action: "inspect_operational_blocker"`. Verification: `rtk node --test tests/researchbrain-stage0-supervisor.test.mjs` passed 18/18; `rtk npm run validate` passed. This is classification/reporting only: no repair, no official mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, and no profitability labels.

Addendum, 2026-06-06 supervisor recommendation/report consistency slice: one-cycle and multi-cycle supervisor JSON envelopes now expose top-level `next_action` plus a diagnostic-only `recommendation` object derived from the existing run status, failure stage, and final attention classification. Clean/ready runs report `next_action: "none"`; drainable queued/pending Stage-0 work reports `continue_bounded_cycles`; actionable attention and failed operational stages report `inspect_operational_blocker` with bounded failure-stage or attention reason context. Non-authoritative supervisor run/failure reports now include `report_metadata` with report type, repo-relative artifact path, schema-stable marker, writer-returned SHA-256 marker, and diagnostic-only marker; returned report artifacts remain repo-relative and SHA-backed by the supervisor result. This remains operator-routing/reporting only: no auto-repair, no deletion/rewrite/reprocessing, no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels. Verification: `rtk node --test tests/researchbrain-stage0-supervisor.test.mjs` passed 18/18; `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 47/47; `rtk npm run validate` passed.

Addendum, 2026-06-06 supervisor report artifact consistency slice: supervisor run/failure report writers now fail loud after writing if the just-written report cannot be re-read and verified against the returned artifact reference. The verification checks repo-relative path safety, file existence, returned SHA-256, expected schema version, expected report type, `report_metadata.artifact_path`, diagnostic-only metadata, and explicit false authority flags. Successful report references returned to callers now include a bounded `consistency` block with those checks so unattended CLI consumers can confirm the durable non-authoritative report without reimplementing path/schema/SHA/authority validation. CLI failure-report and run-report outputs preserve the same consistency block. This is report-integrity reporting only: no report deletion/rewrite/reprocessing after verification, no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels. Verification: `rtk node --test tests/researchbrain-stage0-supervisor.test.mjs` passed 18/18; `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 47/47; `rtk npm run validate` passed.

Addendum, 2026-06-06 supervisor compact operational-summary slice: one-cycle supervisor envelopes now include diagnostic-only `operational_summary` with progress, processed jobs, Stage-0-ready jobs, terminal jobs, processed outbox events, projected terminal events, remaining claimable jobs, pending outbox events, readiness status, attention status/reasons, unreconciled terminal failures, and runtime-consistency status. Multi-cycle envelopes now include a similar `operational_summary` over aggregate totals, final readiness/attention state, failed stage when present, and whether written report artifacts verified. Multi-cycle envelopes also include `report_artifact_summary` showing requested/written run and failure reports, whether all requested reports were written, whether all written reports verified, and compact per-report consistency summaries. Direct API and CLI tests cover clean, drainable, actionable, failed, run-report, and failure-report cases. This is compact operator routing only: no auto-repair, no deletion/rewrite/reprocessing, no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels. Verification: `rtk node --test tests/researchbrain-stage0-supervisor.test.mjs` passed 18/18; `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 47/47; `rtk npm run validate` passed.

Addendum, 2026-06-06 supervisor health flags slice: one-cycle and multi-cycle supervisor envelopes now include diagnostic-only `supervisor_health` so unattended callers can route the next bounded action without reverse-engineering nested recommendation/summary fields. Health states are `healthy`, `drainable`, `blocked`, `failed`, or `idle`, with `alert_level`, `safe_to_run_another_bounded_cycle`, `operator_inspection_required`, optional `failed_stage`, and `reason`. Drainable queued/pending Stage-0 work is safe to continue with another bounded cycle; actionable attention and failed operational stages require inspection and are not marked safe for unattended continuation. Focused tests cover direct and CLI healthy/drainable/blocked/failed outputs. This is diagnostic routing only: no auto-repair, no deletion/rewrite/reprocessing, no official state/evidence/backlog/leaderboard/memory mutation, no WFA, no MT5/MQL5/parity/deployment, no Phase 8E, no survivor-gate change, and no profitability labels. Verification: `rtk node --test tests/researchbrain-stage0-supervisor.test.mjs` passed 18/18; `rtk node --test tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-supervisor.test.mjs tests/researchbrain-stage0-diagnostics.test.mjs tests/researchbrain-stage0-readiness.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 47/47; `rtk npm run validate` passed.

### 11.16E ResearchBrain finalization direction

Added 2026-06-23 after architecture red-team, repo audit, and provider/cost review.

This spec remains the implementation authority. Current supporting ResearchBrain finalization documents live at:

- `factory/research/researchbrain/researchbrain-architecture-finalization-2026-06-23.md`
- `factory/research/researchbrain/researchbrain-architecture-research-program-2026-06-23.md`

Current direction, amended by the 2026-07-05 ResearchBrain deep review:

- Do **not** treat multi-provider router/rotation as the main ResearchBrain mechanism.
- Treat the main mechanism as a **free-roaming LLM researcher inside a deterministic Stage-0 output cage**. The LLM may roam, compare, backtrack, and synthesize from external sources; deterministic code owns only budgets, source capture/provenance, schema validation, memory/failed-pattern checks, and downstream authority gates.
- Do **not** pivot to a curated source registry/corpus as the immediate fix for convergence. Curated registries may later enrich source quality, but the current binding implementation gap is the lack of hard synthesis phase boundaries plus the concrete reliability/provenance bugs listed in §11.16G.
- Keep live provider search/capture as bounded gap-filling infrastructure behind deterministic quotas, provenance, and source capture.
- Any future provider-rotation work is subordinate to convergence controls, source-quality gates, and the local evidence substrate.
- If later research materially overturns this direction, update this section and mark the supporting research accordingly.

Should fix soon after the canary boundary is safe:

- Continue long-running discovery-loop reliability and source-quality hardening without adding WFA/MT5/MQL5 tools or promotion authority to ResearchBrain.

Do not add broad frameworks, source warehouses, market-data APIs, WFA/MT5/MQL5 tools, social crawlers, bulk repo cloning, default audio transcription, or a separate multi-agent synthesis system before the lean convergence/reliability fixes in §11.16G are implemented and re-canary-tested.

### 11.16F ResearchBrain discovery-first doctrine

Added 2026-06-25 after the confirmation-bias finding and multi-source depth assessment.

**Mental model:** ResearchBrain is a free-roaming creative researcher that discovers NOVEL trading edges from external sources. It scouts diverse media — Reddit, YouTube, arxiv, MQL5 forums, broker docs, GitHub, quant blogs, X — reads thoroughly, watches videos, synthesizes creatively, and generates ideas grounded in external sources, NOT in LLM training data. The deterministic part comes at the END — converting ideas to testable hypotheses with hash-backed provenance and schema validation. Free-roaming does **not** mean infinite-roaming: a bounded researcher gets a reading/scouting phase and then a writing/synthesis phase.

**Trader mentality (core doctrine):** ResearchBrain thinks like a trader seeking alpha, not like an academic seeking consensus. A trader finds one good idea and tests it. A single source is sufficient to record a hypothesis if the idea looks worth trying. The LLM should be encouraged to look for corroborating or disconfirming evidence, but the absence of additional sources does NOT block hypothesis recording. Sometimes the best alpha is in a field where nobody else has written about it. Forcing multiple sources would rule out exactly the kind of contrarian, under-explored edges that are the most promising. The only hard rule: the idea must come from an external source, not from LLM training data.

**Research journal (Obsidian wiki):** The LLM needs a place to record free-form thoughts as it researches — observations, hunches, half-formed ideas — not just structured hypotheses at the end. This creates institutional memory for the research process. Implemented as a Karpathy-style LLM-maintained wiki in an Obsidian vault (based on [Karpathy's gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) + patterns from [ar9av/obsidian-wiki](https://github.com/ar9av/obsidian-wiki), [green-dalii/obsidian-llm-wiki](https://github.com/green-dalii/obsidian-llm-wiki), [kytmanov/obsidian-llm-wiki-local](https://github.com/kytmanov/obsidian-llm-wiki-local)). The vault lives on the Windows filesystem; the LLM writes markdown via `fs.writeFileSync()` from WSL. Zero dependencies. Obsidian's graph view/backlinks/search let the operator browse what the LLM was thinking. **2 tools:** `write_wiki_page` (create/merge page with contradiction flagging, includes hunches via `type: hunch`), `search_wiki` (tiered retrieval: server-side grep of `_index.md`, summaries by default, bodies on demand, NEVER returns full index — context-window safe). `write_hunch` was cut (folded into `write_wiki_page`). **Auto-write:** `capture_url_source` → `sources/` page, `record_hypothesis` → `hypotheses/` page. All auto-writes must be `try/catch` wrapped — wiki write failure must never break structured artifact write. **Atomic writes:** Use temp-file + `fs.renameSync()` for `_index.md` updates (9P/NTFS atomicity). **No duplicate helpers:** Wiki module must NOT copy `resolveRepoRelativePath`/`sha256File` (11+ duplicates already exist) — use raw `fs` + `crypto`. **Vault structure (4 content dirs + 3 meta files):** `concepts/`, `sources/`, `hypotheses/`, `hunches/`, `_index.md`, `_log.md`, `AGENTS.md`, `_raw/` (staging). No `entities/` (merged into concepts), no `sessions/` (log is timeline), no `failed-patterns/` (structured memory owns this), no `.manifest.json` (YAGNI for v1), no `_insights.md` (YAGNI), no `_meta/taxonomy.md` (freeform tags). No drafts (LLM is sole writer, no review gate). No SQLite state DB (markdown-only; revisit at 10K+ pages). Sustainability: ~20-100MB at 3 years, not 1GB. Context-window cost: ~150 tokens per search (summaries only), never 150K. The wiki is a human-facing synthesis layer, NOT a replacement for structured stores (`lessons.jsonl`, `retrieval_index.json` remain authoritative for agents). Env: `RESEARCH_WIKI_VAULT_PATH`. Detailed design in `factory/research/researchbrain/researchbrain-finalization-plan.md` Step 3.

**Two phases:**
- Research (INPUT): free, creative, multi-modal, backtracking, single-source-okay. Cage is minimal — only cost/budget bounds.
- Validation (OUTPUT): deterministic, bounded, schema-validated, hash-backed, no-fake-claims. Full cage — deterministic code owns truth.

**Confirmation-bias failure mode (must not recur):** The 2026-06-24 GLM "success" run was confirmation bias, not research. The agent started with "order flow imbalance" from training data, then searched to confirm it. It never scouted arxiv, reddit, or diverse sources. Root cause: `buildSystemPrompt()` (`src/core/researchbrain-llm-providers.mjs:38-51`) said "discovery agent" but never enforced discovery-first behavior.

**Discovery-first mandate:** The system prompt must enforce: (1) scout external sources FIRST with broad queries, (2) read and synthesize, (3) form hypothesis FROM sources after capturing at least one external source, (4) validate. The agent must capture at least one external source before `record_hypothesis` — this prevents training-data-only hypotheses. But the agent is NOT required to find multiple sources or multiple source families. One good source is enough if the idea looks worth testing.

**Discovery-first prompt correction (2026-07-05):** Do not turn source diversity into a checklist. Prompt wording should tell the model to start broad enough to avoid training-data confirmation, then follow the best sources. It should usually choose one or two promising source classes first, read/capture deeply, and switch source classes only when the current trail is weak. The phrase "scout broadly" must not mean "spend budget touching every adapter." A single source is acceptable only when the hypothesis extracts a concrete mechanism, states limitations/disconfirming relevance, and is externally grounded.

**Multi-source adapter plan:** The tool catalog has `search_arxiv`, `search_youtube`, `search_github_code`, `search_semantic_scholar`, `search_mql5_sources`, `search_broker_docs` — but only Brave (`search_web`) is wired. Finalization requires wiring real adapters for: arxiv (free API), Reddit (PRAW, free tier 100 QPM — HIGH PRIORITY, tons of quant communities with practitioner knowledge), MQL5 forum (site-scoped search, MT5-specific alpha), broker docs (FTMO/MetaQuotes docs), quant blogs (curated practitioner blogs), GitHub (free API), YouTube transcripts via Gemini API (official, ~$0.04/video, processes raw audio without captions), Semantic Scholar (free API). Agent Reach (`Panniantong/Agent-Reach`, 13 platforms) is an optional subprocess adapter for X/Twitter and Chinese platforms. Instagram/TikTok are explicitly out of scope (walled gardens, ToS risk, low-quality trading content).

**Adapter correction (2026-07-05):** Adapter failures must not be silently converted into empty result sets. Live search/capture tools should surface structured error diagnostics with provider, HTTP status, retryability, and rate-limit hints. Semantic Scholar was intentionally disabled only because no API key existed; the operator now has a key, so re-enable it only through env-only `SEMANTIC_SCHOLAR_API_KEY`, no persisted secrets, and adapter-aware rate limiting/error visibility.

**NotebookLM rejection (2026-06-25):** NotebookLM via MCP is NOT viable for production. No official API; all MCP servers are reverse-engineered, cookie-based, fragile. Critically, NotebookLM does NOT transcribe videos — it only pulls existing YouTube captions (fails for videos without captions, no timestamps, no speaker diarization). Use Gemini API directly for video transcription. NotebookLM may be used manually via web UI for one-off cross-source Q&A, but never as an agent loop dependency.

**Turn budget:** Default `maxLlmCalls` 4 is too tight for creative exploration. Bump to 12. Default `maxToolCalls` 20 → 50 (NOT 30→50 — 30 was canary override, code default is 20). Keep cost cap.

**Agent loop gate fix (2026-06-30):** `researchbrain-agent.mjs:307-310` `allowedForTurn` narrows to ONLY `record_hypothesis` after memory+source checks pass. This prevents the LLM from searching for disconfirming evidence before recording. Fix: allow ALL tools + additionally unlock `record_hypothesis` (don't narrow). The LLM should be free to search for disconfirming evidence after forming a tentative hypothesis, before recording it.

**Critic/self-review boundary:** The 2026-06-30 post-hoc critic prompt is logically invalid with the current loop because `researchbrain-agent.mjs` returns immediately after the first successful `record_hypothesis`. Self-review must happen **before** `record_hypothesis`: draft tentative mechanism from captured sources, inspect limitations/disconfirming evidence from existing captures, run memory/failed-pattern checks, then either `record_hypothesis` or `record_rejection`. Do not rely on a post-recording turn unless the loop is explicitly changed not to exit after record.

**Wiki reframing (2026-06-30 four-lane validation):** The wiki is an audit log + hunch buffer, NOT the LLM's cognitive engine. Zero production research agents (OpenAI Deep Research, Anthropic, Salesforce EDR, EurekAgent) use a persistent wiki as working memory — they synthesize in-context per session. The wiki's value is human browsability + hunches that don't fit structured memory. Do NOT spend tool-call budget on wiki maintenance (no "touch 10-15 pages per ingest").

**Wiki correction (2026-07-05 deep review):** The active wiki integration is not yet reliable enough to remain a required live-loop tool. `runId` is not passed into `createResearchBrainToolRuntime()`, page updates overwrite prior bodies instead of appending, the default vault path is machine-specific, `_index.md` is read-modify-write fragile under parallel writers, and the wiki is not integrated into the structured retrieval/index pipeline. Preferred lean path: remove `write_wiki_page`/`search_wiki` from the active LLM tool budget and render wiki markdown post-hoc from structured source/hypothesis artifacts. If the active wiki tools are kept, fix those issues first and keep all wiki failures non-authoritative.

**X/Twitter decision:** Deferred pending operator decision. X API is expensive ($100+/mo) or fragile (scraping). Third-party APIs ($49-100/mo) are the pragmatic middle ground. Document the decision when made.

**Where the cage stays (do not remove):** hash-backed source provenance, `research_run_id` enforcement, profitability-key rejection, memory duplicate/failed-pattern checks, transcript chunk-ID enforcement, schema validation, at least one source capture required before `record_hypothesis` (prevents training-data-only hypotheses). The cage may also force a writing/synthesis phase by changing available tools after budget thresholds; that is not input censorship, it is bounded research discipline.

**Implementation plan:** Current atomic steps live in this spec §11.16G. The supporting `factory/research/researchbrain/researchbrain-finalization-plan.md` is historical and must defer to §11.16G on conflicts.

#### Implementation status (2026-06-30)

All items below were implemented in a single day and verified with 501/501 tests passing and `rtk npm run validate` clean.

- [x] **Agent loop gate fix** (`researchbrain-agent.mjs:312`): `allowedForTurn` no longer narrows to only `record_hypothesis` after memory+source checks — all tools remain available. The `record_hypothesis` handler validation is the real gate.
- [x] **System prompt rewrite** (`researchbrain-llm-providers.mjs:38-70`): Discovery-first mandate landed, but the 2026-07-05 review supersedes the old post-hoc critic phrasing. Next prompt revision must use source-following rather than checklist scouting and must place critic/self-review before `record_hypothesis`.
- [x] **Budget defaults bumped**: `maxLlmCalls` 4→12, `maxToolCalls` 20→50 (applied in `researchbrain-agent.mjs`, `researchbrain-stage0-provider-utils.mjs`, `researchbrain-stage0-supervisor.mjs`, `run-researchbrain-stage0-runtime.mjs`).
- [x] **Wiki module built** (`researchbrain-wiki.mjs`, 225 lines, zero deps): 2 tools — `write_wiki_page` (create/merge with contradiction flagging, includes hunches via `type: hunch`), `search_wiki` (tiered retrieval, never returns full index). Atomic writes via temp-file + `fs.renameSync()`. `write_hunch` was folded into `write_wiki_page`.
- [x] **Wiki tools wired**: Added to `RESEARCHBRAIN_ALLOWED_TOOLS` in `researchbrain-tools.mjs`; tool handlers; auto-write hooks (try/catch wrapped) in `capture_url_source` and `record_hypothesis`; tool parameter schemas in `researchbrain-llm-providers.mjs`.
- [x] **6 source adapters wired** (`researchbrain-tools.mjs`): `createCompositeResearchBrainSourceToolAdapter` (composite dispatcher), `createArxivResearchBrainSourceToolAdapter` (free API), `createRedditResearchBrainSourceToolAdapter` (OAuth, free 100 QPM), `createGithubResearchBrainSourceToolAdapter` (GitHub Code Search, free), `createSemanticScholarResearchBrainSourceToolAdapter` (free), `createSiteScopedResearchBrainSourceToolAdapter` (site-scoped Brave for MQL5 + broker docs). CLI supports comma-separated providers: `--source-provider brave,arxiv,reddit,github,semantic_scholar,mql5,broker_docs`.
- [x] **`search_reddit` added** to `RESEARCHBRAIN_ALLOWED_TOOLS` and `RESEARCHBRAIN_SOURCE_SEARCH_TOOL_SET`.

Deferred (not started): YouTube/Gemini transcription (needs `GEMINI_API_KEY`), Agent Reach (optional), X/Twitter (operator decision required).

#### Step 12-14 status (2026-07-03)

- [x] **Step 12 — Live loop reliability fix**: Root cause was provider factory closure capturing CLI-level model settings; when jobs from different presets co-existed in the ledger, the factory created the LLM client with the wrong model. Fix: job payload now carries model identity (`llm_provider`, `llm_model`, `llm_reasoning_effort`); factory reads from payload first, falling back to CLI args (`researchbrain-stage0-job-seeder.mjs:86-108`, `researchbrain-stage0-provider-utils.mjs:178-204`).
- [x] **Step 13 — Ledger cleanup**: Nuked stale ledger DB + projections + recovery log (runtime state, not evidence). 0 blocked jobs, 0 unreconciled terminal failures.
- [x] **Step 14 — GLM 50-tool-call canary**: Ran GLM 5.2 (xhigh), 50 tool calls, 8192 tokens on 3 narrow MT5 Stage-0 requests. Result: 0/3 hypotheses. Root cause was NOT curated-corpus dependency — it was (1) rate-limit waste (Brave/arxiv/Semantic Scholar 429s), (2) no convergence nudge (LLM stuck in perpetual scouting), (3) YouTube tool schema bug. Confirmation bias SOLVED: 2/2 evaluable runs started with broad parallel scouting, zero pre-formed hypotheses. All 7 adapters called. Cost negligible ($0.000009–$0.000053/run).
- [x] **Canary fixes applied**: `normalizeSearchResults` returns `[]` on empty (was throwing); live search handler wraps adapter.search in try/catch returning `[]` on rate-limit failures; `inspect_youtube_video` validates `videoId` before proceeding.
- [x] **Semantic Scholar disabled**: No API key yet (429 rate-limit waste). Removed from `RESEARCHBRAIN_ALLOWED_TOOLS`, `RESEARCHBRAIN_SOURCE_SEARCH_TOOL_SET`, and provider-utils wiring. Re-enable when `SEMANTIC_SCHOLAR_API_KEY` configured.
- [x] **Budget-awareness prompt rule**: Added "if >60% tool-call budget used, MUST advance to synthesis" rule to system prompt.
- [x] **Anthropic adapter removed**: Operator uses DeepSeek as primary LLM. All Anthropic API adapter references removed from 8 files. Anthropic Research company mentions in external evidence tables retained.

**Next**: Re-run GLM canary with fixes (Semantic Scholar disabled, budget-awareness prompt, rate-limit resilience) to measure convergence. If still 0 hypotheses, investigate whether GLM 5.2 can advance from scouting to synthesis under budget pressure.

#### Step 14B canary re-run (2026-07-03)

Re-ran GLM 5.2 (xhigh), 50 tool calls, 8192 tokens on the same 3 MT5 requests with fixes applied (Semantic Scholar disabled, rate-limit resilience, YouTube arg validation, tool errors non-terminal, budget nudge injected into transcript).

**Results: 0/3 hypotheses.** All 3 runs hit the 50-tool-call budget. The LLM made 4-6 parallel tool calls per turn across 12 LLM turns, never advancing from scouting to synthesis. Budget alerts ("60% used, MUST advance to synthesis NOW") appeared in the transcript 5 times per run but were ignored by GLM 5.2.

| Run | Tool calls | Captures | First capture | Errors | Cost | Hypotheses |
|---|---|---|---|---|---|---|
| MULTIASSET-LIQVOL | 50 | 6 | call 9 | 0 | $0.000062 | 0 |
| SESSION-REGIME | 50 | 24 | call 5 | 9 | $0.000052 | 0 |
| CFD-SOURCE-MAPPING | 50 | 39 | call 5 | 0 | $0.000061 | 0 |

**Corrected root cause after 2026-07-05 deep review:** GLM 5.2 ignoring text nudges is real, but the failure is not model-only. The current architecture/affordances make endless scouting the lowest-friction behavior: all search tools remain available, the prompt starts with checklist-style broad scouting, `record_hypothesis` is much harder than another search, wiki calls can waste budget, and adapter failures can look like empty results. The missing control is a hard synthesis phase boundary enforced through tool availability, not another text nudge.

**Fixes applied during this run:**
- Model ID corrected: `opencode-go/glm-5.2` → bare `glm-5.2` (OpenCode Go endpoint changed since June 24 canary).
- Tool errors made non-terminal (`researchbrain-agent.mjs:365`): removed `if (!error?.rf_retry_attempts) throw error;` — all tool errors now return to LLM for retry, not fatal.
- Budget nudge injected into turn-completion system messages (`researchbrain-agent.mjs:382-391`): "BUDGET ALERT: 60% used, MUST advance to synthesis NOW" appears at 60% and 80% thresholds.

**Next options, superseded by §11.16G:** Do not start with model roulette or a new synthesis agent. First implement the lean convergence/reliability fixes: seed-payload propagation, hard synthesis gating via allowed tools, prompt cleanup, lower `record_hypothesis` friction, visible adapter errors/rate limits, wiki removal/fix, provenance validation, and GitHub capture correction. Then rerun the same canaries.

### 11.16G ResearchBrain deep review closeout and atomic implementation plan

Added 2026-07-05 after a parallel deep code review of `src/core/researchbrain-agent.mjs`, `researchbrain-llm-providers.mjs`, `researchbrain-tools.mjs`, `researchbrain-wiki.mjs`, `researchbrain-runtime.mjs`, `researchbrain-artifacts.mjs`, `researchbrain-stage0-supervisor.mjs`, `researchbrain-stage0-job-seeder.mjs`, `scripts/researchbrain-stage0-provider-utils.mjs`, external adapter docs, and the active ResearchBrain docs. This section supersedes any conflicting ResearchBrain finalization-plan language.

**Review verdict:** The Stage-0 authority boundary is sound. The current live loop is not broken because it lets the LLM roam; it is broken because it never forces the LLM to stop roaming. Text budget nudges are insufficient. The correct lean fix is structural phase control through tool availability, plus concrete reliability/provenance fixes. Do not add WFA/MT5/MQL5/profitability tools, broad frameworks, a source warehouse, or a multi-agent synthesizer as the next step.

**Status, 2026-07-06 first lean convergence batch plus record-friction/composite-diagnostic slice:** Implemented and verified the first meaningful §11.16G slice. `seedResearchBrainStage0Job()` now propagates request-level `job_settings` into runtime-ledger job payloads without persisting secret values. `createLiveResearchBrainAgentProvider()` now enforces hard synthesis-phase tool gating: early turns keep normal free-roam, at roughly 60% tool budget with zero hypotheses new search tools are removed, and at roughly 80% budget or final LLM turn only memory prerequisites plus `record_hypothesis`/`record_rejection` remain available; the 80% branch is checked before the 60% branch. The system prompt now emphasizes source-following over checklist scouting, requires pre-record critic/self-review, removes hardcoded budget examples, and preserves single-source-with-depth. Semantic Scholar is re-enabled through env-name-only `SEMANTIC_SCHOLAR_API_KEY`; Semantic Scholar and Brave now share a minimal rate-limiter shape; live search adapter failures surface serialized `adapter_error` diagnostics instead of silent empty results. Review follow-up also blocked live-mode LLM-supplied GitHub artifact content and passed `runId` into tool runtime so wiki handlers no longer hit the prior ReferenceError path. `record_hypothesis` friction is now reduced: the LLM schema requires only core identity/mechanism/prediction/source/family/instrument/timeframe fields, the server fills lower-value packet defaults, and missing memory prerequisites are auto-run internally while failed-pattern blocking remains hard. Composite source capture now reports all failed sub-adapters with adapter names/messages instead of throwing a generic no-capture error. Verification: `node --test tests/researchbrain-agent.test.mjs tests/researchbrain-stage0-job-seeder.test.mjs tests/researchbrain-stage0-cli-help.test.mjs` passed 63/63; `node --test tests/researchbrain-*.test.mjs && rtk npm run validate` passed 156/156 plus structure validation before the record-friction slice; record-friction and composite-diagnostic focused regression later passed 50/50 in `tests/researchbrain-agent.test.mjs`. No live canary was run because required env vars were absent in the execution environment. Remaining deferred items: broader per-adapter rate-limit/backoff polish, wiki active-loop removal/full hardening, provenance validation, and full deterministic GitHub live capture.

**Status, 2026-07-06 live-preflight/composite-source/provider-account slice:** Repo `.env` loading through the existing supervisor/provider-utils path was used for live preflight. A structural preflight bug was fixed: composite source providers such as `brave,semantic_scholar` now validate per-adapter env names (`BRAVE_SEARCH_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`) instead of failing with a single-provider Brave-only policy. Bounded live canaries reached the DeepSeek provider and blocked cleanly on upstream `HTTP 402 Insufficient Balance`; retry/runtime/loop diagnostics now classify this as explicit non-retryable `provider_account_or_quota_failure` instead of generic `no_valid_provider_output` / `schema_or_validation_failure` at the runtime and loop failure-summary boundary. Authority flags remained false; no WFA/MT5/MQL5/Phase 8E/profitability/official state mutation occurred. Verification: focused ResearchBrain runtime/loop/supervisor/retry tests passed 78/78. Live blocker artifact: `factory/verification/researchbrain-stage0-supervisor-runs/researchbrain-stage0-supervisor-run-attention-20260706T074918Z.json`, runtime result `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-4096-20260611T1945Z-DA2A50634186F291515F169F/runtime-result.json`.

**Corrected convergence model:**

1. The LLM should free-roam during early scouting.
2. Source diversity is a means, not a checklist; broad source-class enumeration can cause checklist scouting.
3. A single source remains enough to record a Stage-0 hypothesis when it is externally grounded and has explicit limitations.
4. Before recording, the LLM must synthesize from captured sources, inspect disconfirming/limitation evidence, and run memory/failed-pattern checks.
5. At budget thresholds the local cage must remove further scouting options and force record-or-reject behavior.

**BLOCKER 1 — seed payload propagation:** `seedResearchBrainStage0Job()` currently receives LLM/source/runtime settings from the supervisor but does not destructure or copy them into `runtimeOptions`, so `buildPayload()` cannot persist `llm_provider`, `llm_model`, `max_llm_calls`, `max_tool_calls`, source provider flags, etc. The provider factory reads payload-first correctly, but payloads lack the fields. Fix before trusting supervisor canaries: add all existing `buildPayload()` mapped fields to the seeder signature and `runtimeOptions` object.

**BLOCKER 2 — missing hard synthesis phase:** `createLiveResearchBrainAgentProvider()` currently passes all allowed tools every turn and appends only text nudges after budget use. Implement tool availability gating:

- before threshold: normal free-roam source/search/capture/memory tools;
- at roughly 60% tool budget with zero hypotheses: remove new source-search tools; allow capture of already discovered sources, memory tools, `record_hypothesis`, and `record_rejection`;
- at roughly 80% budget or final LLM turn: remove capture/search/wiki tools; allow only memory prerequisites, `record_hypothesis`, and `record_rejection`;
- check the 80% branch before the 60% branch, because the current `>=60` condition makes the `>=80` branch unreachable;
- avoid adding a separate synthesizer agent until this small control is tested.

**HIGH — prompt cleanup:** Replace checklist-style source enumeration with source-following guidance: start broad enough to avoid training-data confirmation, but choose 1-2 promising source classes first and switch only when weak. Move critic/self-review before `record_hypothesis`; the current post-record critic cannot run because the loop exits after recording. Remove hardcoded budget examples like "30 of 50" and rely on runtime-injected actual counts.

**HIGH — `record_hypothesis` friction:** The current tool schema requires too many fields and the handler requires explicit same-run memory tools before recording. This makes searching easier than synthesis. Keep required only the identity/mechanism/prediction/source/family/instrument/timeframe core; allow server-side defaults for lower-value fields. Prefer auto-running or auto-storing `search_research_memory`, `check_duplicate_memory`, and `check_failed_pattern_similarity` after a tentative mechanism/capture, or let `record_hypothesis` invoke missing memory checks internally. Preserve the safety outcome: failed-pattern blocking still blocks; duplicate is advisory unless parameter-only/failed-pattern blocked.

**HIGH — adapter error visibility and rate limits:** Live search errors must not become `[]`. Return structured tool errors with provider, HTTP status, retryability, and retry-after/rate-limit information so the LLM and operator can adapt. Add per-adapter rate limits: arXiv at one request per three seconds; GitHub code search at the stricter authenticated code-search bucket; Reddit OAuth with rate headers/429 handling; Brave/Semantic Scholar retry-after handling. Composite capture must collect and report sub-adapter failures instead of swallowing them.

**HIGH — wiki active-loop decision:** The wiki is currently broken (`runId` not supplied to tool runtime), can consume budget, and is not the LLM's cognitive engine. Preferred lean path: remove `write_wiki_page` and `search_wiki` from active LLM tools and create post-hoc markdown renderers from structured artifacts. If kept active, first fix `runId`, append existing page bodies instead of overwriting, require/validate vault path, harden `_index.md`, and keep all wiki failures non-authoritative.

**HIGH — provenance validation:** `hypothesis_packet.content_hash` must be recomputed and compared during validation, not only regex-checked. Validate `provider_provenance` and `source_fetch` object shape in source records. Validate every `source_hashes[]` entry in planner provenance, not only the one matching the hypothesis packet.

**HIGH — GitHub capture:** `capture_github_artifact` must not use fixture/default content in live mode. Implement deterministic authenticated public GitHub content fetch via an appropriate API/raw path or block live GitHub artifact capture with a clear tool error until implemented.

**MEDIUM — rejection-only terminal path:** `record_rejection` artifacts should be a clean Stage-0 blocked/rejected terminal outcome, not a malformed no-output failure. Runtime can remain non-ready because no hypothesis exists, but should preserve rejection artifacts and diagnostics.

**MEDIUM — provider/API compatibility:** Handle malformed tool JSON without burning productive LLM-call budget. Pre-truncate tool-call batches to remaining budget instead of throwing mid-batch. Consider provider support for `parallel_tool_calls: false` and forced tool choice during synthesis turns. For DeepSeek, keep reasoning/thinking parameters model-capability-aware and preserve provider semantics when using multi-round tool calls.

**Semantic Scholar policy:** Semantic Scholar was intentionally disabled because no API key existed. The operator now has a key; re-enable only through env-only configuration, no persisted key, no repo secret, and with adapter-aware rate limiting/error visibility. Do not treat prior disabled status as a design rejection.

**Do not do next:** no curated corpus/source warehouse, no broad provider-router, no separate scout/synthesis model, no supervisor decomposition, no shared-utils cleanup, no WFA/MT5/MQL5 tool expansion, and no strategy/profitability claims before the above lean fixes and a fresh bounded canary.

**Atomic implementation order:**

1. [x] Fix seeder payload propagation and add a tiny regression proving payload carries job-specific LLM/source settings.
2. [x] Implement synthesis-phase tool gating and fix the 80% dead branch; add focused loop tests for 60%/80% allowed tools and final-turn record-or-reject behavior.
3. [x] Rewrite the system prompt around source-following, pre-record critic, single-source-with-depth, and actual-budget language.
4. [x] Reduce `record_hypothesis` friction without weakening failed-pattern blocking; add tests for auto/defaulted fields and missing-memory-prerequisite handling.
5. [~] Surface adapter errors and add minimal rate-limit handling for Brave/arXiv/Reddit/GitHub/Semantic Scholar. Live search adapter errors are now visible, Semantic Scholar/Brave have minimal limiter shape, composite capture reports all sub-adapter failures, composite source-provider preflight validates per-adapter env names, and provider account/quota errors are explicit; broader adapter-specific rate-limit/backoff polish remains deferred.
6. [~] Remove wiki from active tools or fix it fully; prefer post-hoc renderer if no concrete canary proves active wiki helps convergence. The immediate `runId` ReferenceError path is fixed, but active-loop wiki removal/full hardening remains deferred.
7. [~] Harden provenance validation and GitHub live capture. Live-mode LLM-supplied GitHub content is now blocked; deterministic authenticated GitHub capture and broader provenance validation remain deferred.
8. [~] Rerun the three Step 14B-style canaries with the same budgets and compare hypothesis rate, first-capture call, search/capture ratio, error visibility, source grounding, and whether synthesis happened before forced threshold. One bounded DeepSeek canary reached the live provider via repo `.env` and blocked on upstream `HTTP 402 Insufficient Balance`; rerun meaningful convergence canaries after provider balance is restored.

### 11.17 Failed Pattern Memory

The factory must preserve failed strategy patterns in structured form.

Failed pattern memory prevents retesting the same idea under a different name.

Minimum failed pattern fields:

- `pattern_id`
- `strategy_family`
- `market_family`
- `instrument_scope`
- `timeframes`
- `failure_mode`
- `evidence_paths`
- `blocked_revisit_conditions`
- `last_seen`

Revisiting a failed pattern is allowed only when the new candidate changes at least one of:

- causal mechanism
- market structure assumption
- data input
- execution horizon
- MT5/FTMO constraint exposure

Parameter-only variation is not sufficient novelty.

ResearchBrain must check prior hypothesis packets and failed patterns before producing a new hypothesis. Duplicates must be marked as duplicates instead of creating new backlog items. Novelty is not satisfied by parameter-only variation of a failed pattern; the causal mechanism, market structure assumption, data input, execution horizon, or MT5/FTMO constraint exposure must differ.

If a ResearchBrain hypothesis duplicates a prior packet or failed pattern, the ideation manifest must count it as `duplicates_detected` and the hypothesis must not become a backlog item.

### 11.18 Context, Token, And Memory Economy

The factory must treat context window as a scarce resource.

Non-negotiable rules:

1. every prompt line must have a runtime purpose
2. static doctrine lives in specs and role prompts, not repeated capsules
3. runtime capsules contain only current-stage facts
4. long artifacts are never pasted by default
5. agents receive paths, hashes, IDs, compact metrics, and retrieval snippets
6. durable learning is stored as structured memory, not chat history
7. every stage attempt should use a fresh context unless deliberately debugging a previous agent failure
8. retrieval is bounded, stage-specific, and justified
9. normal agent calls must not include this full spec

### 11.18A Compact Spec-Policy Capsule

The orchestrator should expose this spec through a compact policy capsule, not by prompt-injecting the full document.

Minimum capsule fields:

- `spec_path`: `factory/mt5-ftmo-strategy-factory-spec.md`
- `spec_sha256`
- `policy_version`
- `applicable_stage`
- `evidence_kind`
- `authority_layer`
- `forbidden_shortcuts`
- `required_artifacts`
- `blocked_conditions`
- `max_capsule_chars`

The capsule should include only rules needed for the current stage. Examples:

- WFA planning gets discovery/search rules and WFA artifact requirements
- MT5 snapshot work gets environment/data identity rules
- tester work gets tester-conditioned evidence and `FILE_COMMON` constraints
- FTMO ledger work gets rule-set, CE(S)T reset, equity, floating P/L, swaps, and commission rules

If an agent needs the full spec, it must request exact sections by path and reason.

The following must not enter prompt context by default:

- full WFA logs
- full MT5 tester logs
- full trade ledgers
- full optimizer tables
- full backlog
- full evidence index
- full leaderboard
- raw CSV previews
- long research memos
- historical chat transcripts
- broad source dumps

Deterministic workers must create compact summaries before LLM review.

Required summaries include:

- `artifact_manifest.json`
- `wfa_metrics_summary.json`
- `trade_ledger_summary.json`
- `mt5_tester_summary.json`
- `mql_compile_summary.json`
- `log_digest.json`
- `diff_summary.json`

Agents may request raw artifact ranges only by exact path and reason.

### 11.19 Retrieval Policy

Retrieval must be deterministic before agent invocation.

The orchestrator should retrieve by:

- stage
- market family
- strategy family
- asset/timeframe
- validation gate
- failure signature
- evidence quality
- contradiction value
- recency
- hypothesis packet path and hash
- source records by market family
- candidate history by strategy family
- prior failed patterns by mechanism type and instrument scope

Retrieval output must be compact.

ResearchBrain, Ideator, and Planner retrieval output must include artifact paths and hashes so agents can consume structured records without re-fetching raw memory or source dumps.

A normal agent prompt should receive:

- 3-6 relevant lessons at most
- 1-3 relevant failures at most
- 1-2 comparable successes at most
- IDs and one-line retrieval text, not full records

The loop should optimize for retrieval precision over recall. Missing one marginal lesson is less harmful than bloating every prompt.

## 12. Implementation Phases

The implementation program is proof-first. It must make the current loop capable of representing non-WFA evidence, then prove MT5 environment identity, then prove tester-compatible communication, then prove tester lifecycle evidence, then attach a real candidate.

Until final deployment mode is chosen, implementation should stay **Mode-B-safe** wherever evidence quality is affected.

### Phase 0 - Evidence Schema Shim And Policy Capsule `[x]`

Status, 2026-04-30: complete. Implemented evidence-kind execution semantics, compact spec-policy capsules, `mt5_snapshot` validation without fake WFA metrics, `factory/mt5/` and `factory/artifacts/` paths, artifact manifests, and focused validation tests.

Status, 2026-05-18 validation hardening slice: Phase 8A broker-history manifests now require per-row terminal symbol evidence (`terminal_symbol_spec.name` matching `mt5_symbol`), and MT5 instrument-equivalence writing rejects broker-history manifests whose universe snapshot path/hash differs from the data-relevance classification universe snapshot. This prevents mixing artifacts from different MT5 universe snapshots and keeps `mt5_verified`/broker-history evidence terminal-bound. Phase 8A remains open because the real FTMO MT5 tradable-universe snapshot is still blocked by the missing `MetaTrader5` Python package.

Status, 2026-05-18 artifact-registration slice: added non-authoritative `phase8a_mt5_artifact_registration_v1` support through `src/core/mt5-artifact-registration.mjs`, CLI `scripts/run-phase8a-mt5-artifact-registration.mjs`, and npm script `mt5:artifact-registration`. The helper validates repo-relative Phase 8A MT5 artifacts (`mt5_snapshot`, `mt5_tradable_universe_snapshot`, `data_relevance_classification`, `broker_history_export_manifest`, `mt5_instrument_equivalence`), records hash-backed registration manifests under `factory/mt5/artifact-registration/`, supports blocked universe artifacts as blocked evidence, and explicitly sets `official_evidence_index_mutated: false`. This is an artifact inventory/registration aid only; official factory evidence/state mutation still belongs to the orchestrator.

Status, 2026-05-25 remediation/retrieval/denominator refinement slice: Phase 8C remains started, not closed. Added three narrow hardening pieces. First, ResearchBrain-derived backlog quality checks now also inspect the same-run `ideation-manifest.json` for candidate-referencing duplicate/rejection signals and run-level duplicate/rejection/failed-pattern blockers, so direct WFA-ready status is blocked even if those memory signals were not copied onto the backlog item. Second, `buildResearchWfaGateReport()` now flags reporting-only inconsistent optimizer search accounting when `optimizer_search_context_v1.planned_trial_count` does not equal completed plus failed trials; this does not change structural denominator completeness and does not enable DSR/PBO/CPCV/White as hard gates. Third, the orchestrator can create at most one bounded remediation backlog action for repeated comparable artifact-backed failures, keyed by `remediation_key`, through the existing orchestrator backlog path; generic follow-up cascades are not introduced. This does not run Phase 8D screening, does not mutate official state outside existing orchestrator-owned paths, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Focused verification before the full regression set: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 31/31; `rtk node --test tests/verification.test.mjs` passed 165/165; `rtk node --test tests/factory.test.mjs` passed 64/64.

Objective:

- let the control plane represent MT5/MQL5/FTMO evidence honestly before any MT5 terminal work begins

Primary work:

- [x] update `src/prompts/runtime-invariants.md` so `executed` means evidence-kind-appropriate accepted worker output, not WFA only
- [x] add `evidence_kind`, `authority_layer`, `candidate_id`, `candidate_stage`, `deployment_mode`, `blocked_reason`, and `source_hashes` where needed in validation/normalization
- [x] teach `src/core/validators.mjs` that non-WFA evidence kinds do not need WFA metrics
- [x] preserve `research_wfa` validation for existing WFA runs
- [x] add a compact spec-policy capsule with spec path, spec hash, current-stage rules, forbidden shortcuts, and blocked conditions
- [x] stop treating full-spec prompt injection as a normal path
- [x] add minimal `factory/mt5/` and `factory/artifacts/` path support only where required for the first evidence kinds
- [x] record SHA256 metadata for promotion-relevant artifacts before broad cleanup machinery exists

Primary targets:

- `src/prompts/runtime-invariants.md`
- `src/core/validators.mjs`
- `src/core/orchestrator.mjs`
- `src/core/prompt-builders.mjs`
- `src/core/artifact-store.mjs`
- `src/core/paths.mjs`

Exit criteria:

- [x] existing WFA output still validates as `research_wfa`
- [x] a schema-valid `mt5_snapshot` result can be represented without fake WFA metrics
- [x] artifact paths claimed by accepted evidence exist on disk
- [x] prompts carry compact policy capsules, not the full spec

### Phase 1 - Minimal Worker Result Envelope `[x]`

Status, 2026-05-02: complete for the minimal worker-result contract. `mt5_snapshot` and `research_wfa` worker envelopes exist and are validated through `validateWorkerResultEnvelope`, `validateExecutionResult`, and `validateExecutionArtifacts`. The `research_wfa` envelope worker officialized existing canonical EMA Trend Gate WFA artifacts from `factory/runs/EXP-20260405180000-01/execution-result.json` into `factory/runs/JOB-RESEARCH-WFA-EMA-20260405-OFFICIALIZED/`; it does not itself run a new WFA.

Objective:

- create the smallest deterministic worker-result contract that can feed official evidence into the JS control plane

Primary work:

- [x] define minimal worker request/result envelopes for `research_wfa` and `mt5_snapshot`
- [x] store `mt5_snapshot` worker results under deterministic artifact paths in `factory/mt5/environment/<job-id>/`
- [x] validate `mt5_snapshot` result JSON, status semantics, artifact paths, hashes, diagnostics, and blocked reasons
- [x] classify current WFA execution as `research_wfa`
- [x] keep the executor agent as run analyst until deterministic workers replace stage-specific execution authority; deterministic evidence envelopes now exist for `mt5_snapshot` and existing WFA artifacts

Primary targets:

- `src/core/orchestrator.mjs`
- `src/core/validators.mjs`
- `src/core/artifact-store.mjs`
- `walk forward engine/scripts/walk_forward_smoke_test.py`

Exit criteria:

- [x] at least one official WFA path can be represented as a worker result envelope
- [x] worker output produces artifacts suitable for evaluator review
- [x] LLM narrative alone cannot certify `mt5_snapshot` or `research_wfa` worker-envelope execution success

### Phase 2 - MT5 Environment And Data Identity Snapshot `[x]`

Status, 2026-05-03: MT5 Python connection blocker solved. The deterministic MT5 snapshot worker and Python probe exist, write repo-contained artifacts under `factory/mt5/environment/`, support WSL-to-Windows Python path conversion for the repo venv, pass explicitly supplied terminal path/login/server inputs to the probe without persisting terminal path or password, support env-only password authentication through `TRF_MT5_PASSWORD`, and return blocked evidence with exact diagnostics when `MetaTrader5` or MT5 terminal access is unavailable. The pinned `MetaTrader5==5.0.45` dependency is installed into `walk forward engine/.venv/`. A real terminal-backed `EURUSD M15` snapshot succeeded against FTMO demo account `1513283634` using `C:\Program Files\FTMO Global Markets MT5 Terminal\terminal64.exe`, server `FTMO-Demo`, and password supplied only through `TRF_MT5_PASSWORD`; successful evidence exists at `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/` with `snapshot.json`, `worker-result.json`, and `execution-result.json`. Focused validation passed with `rtk npm run test:verification` on 2026-05-03. Closed 2026-05-13 because Phase 6 fixture selection now cites the measured snapshot/data evidence in `factory/candidates/CAND-EURUSD-M15-LONDON-BREAKOUT-001/manifest.json` and data validation exists at `factory/candidates/CAND-EURUSD-M15-LONDON-BREAKOUT-001/data-validation.json`.

Objective:

- measure terminal/account/symbol/data reality before choosing fixtures or writing strategy logic

Primary work:

- [x] implement `mt5_snapshot` worker: `src/workers/mt5-snapshot-worker.mjs`, `scripts/run-mt5-snapshot-worker.mjs`, and `walk forward engine/src/mt5_snapshot_probe.py`
- [x] add the `MetaTrader5` dependency only when this worker is implemented: `walk forward engine/requirements.txt`
- [x] capture terminal build, broker/server, account mode, currency, leverage, margin mode, symbol specs, session/time assumptions, and data availability; real FTMO demo terminal evidence captured in `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/snapshot.json`
- [x] capture `data_identity` for MT5-side data with coverage, timezone basis, quote basis, source type, and bar hash; real `EURUSD M15` terminal data identity captured in `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/snapshot.json`

Primary targets:

- MT5 snapshot modules under `walk forward engine/src/`
- `factory/mt5/environment/`
- `src/core/paths.mjs`
- `src/core/artifact-store.mjs`
- `src/core/validators.mjs`

Exit criteria:

- [x] fixture choice is based on actual terminal/data evidence; Phase 6 selected `CAND-EURUSD-M15-LONDON-BREAKOUT-001` from the measured EURUSD M15 snapshot/data chain and recorded the rationale in the candidate manifest
- [x] account and symbol assumptions are measured, not guessed; worker enforces explicit symbol/timeframe and now has successful FTMO demo account/symbol evidence
- [x] MT5 or parity work is blocked if snapshot/data identity is missing

### Phase 3 - `FILE_COMMON` Smoke Proof `[x]`

Status, 2026-04-30: complete for protocol smoke. Implemented `mt5_bridge_smoke` evidence, deterministic FILE_COMMON protocol worker, checksum validation, atomic write/rename on the control-plane side, MQL5 FILE_COMMON source stubs, and focused rejection tests. This does not claim tester lifecycle execution.

Objective:

- prove tester-compatible communication before tester lifecycle or strategy work

Primary work:

- [x] create a run-scoped `FILE_COMMON` message protocol
- [x] include run ID, schema version, sequence number, timestamp, checksum, producer identity, and artifact path
- [x] implement stale-message, wrong-run, corrupted-payload, and partial-write rejection
- [x] use atomic write/rename discipline where possible

Primary targets:

- [x] `walk forward engine/mt5/experts/`
- [x] `walk forward engine/mt5/include/`
- [x] bridge ingestion modules under `src/workers/`; no WFA-engine runtime coupling added yet
- [x] `factory/mt5/bridge/`

Exit criteria:

- [x] tester-side network calls are not required
- [x] normal operation does not require manual copy/paste
- [x] stale, wrong-run, partial, or checksum-invalid bridge artifacts are rejected deterministically

### Phase 4 - MT5 Tester Lifecycle Bench `[x]`

Status, 2026-05-04: executed. `TrfTesterLifecycleBench.ex5` was deployed to the terminal-visible `MQL5\Experts\TRF\` advisor folder, `TrfTesterLifecycleBench.set` was deployed to `MQL5\Profiles\Tester\`, MT5 Strategy Tester was run via doc-aligned `/config`, and real tester outputs were ingested into `factory/mt5/tester/JOB-MT5-TESTER-LIFECYCLE-REAL-20260504-EURUSD-M15-R6/`. The FILE_COMMON lifecycle JSON proves market open/close, pending place/remove, and hard-exit scenarios were observed in Strategy Tester, and `rtk npm run mt5:tester-lifecycle -- --tester-output factory/mt5/tester/JOB-MT5-TESTER-LIFECYCLE-REAL-20260504-EURUSD-M15-R6/lifecycle_1.json ...` accepted the evidence as `status: executed`.

Objective:

- prove MT5 tester evidence capture independently of strategy complexity

Primary work:

- [x] run market-order lifecycle scenario in MT5 Strategy Tester
- [x] run pending-order lifecycle scenario in MT5 Strategy Tester
- [x] run SL/TP or hard-exit lifecycle scenario in MT5 Strategy Tester
- [x] emit structured tester summaries and logs
- [x] capture tester settings, tick model, spread source, commission/swap assumptions, account/symbol settings, execution delay, tester config hash, and output hashes

Primary targets:

- [x] `walk forward engine/mt5/experts/`; lifecycle bench source and compiled `.ex5` exist and the `.ex5` was deployed to terminal-visible `MQL5\Experts\TRF\` for the R6 Strategy Tester run
- [x] `walk forward engine/mt5/include/`
- [x] MT5 tester worker modules
- [x] `factory/mt5/tester/`

Exit criteria:

- [x] tester artifacts are captured automatically from a real MT5 Strategy Tester run
- [x] lifecycle evidence is parseable without manual spreadsheet work once repo-contained tester output exists
- [x] tester limitations are recorded with each run

### Phase 5 - Minimal FTMO Ledger Skeleton `[~]`

Status, 2026-05-04: partial but no longer fixture-only. Implemented deterministic `ftmo_ledger` worker, validation, explicit rule-set/input requirements, repo-contained official-source 2-Step and 1-Step rule-set artifacts, static 2-Step max-loss mechanics, 1-Step end-of-day trailing max-loss mechanics, fixture-ledger mechanics runs, blocked diagnostics when inputs are missing, and ledger-mechanics-only labeling. Real MT5 Strategy Tester report rows from `factory/mt5/tester/JOB-MT5-TESTER-LIFECYCLE-REAL-20260504-EURUSD-M15-R6/trf_lifecycle_20260504_r6.htm` were converted into non-fixture ledger input at `factory/mt5/ftmo/inputs/mt5-tester-lifecycle-r6-ledger-input.json` and accepted under both official rule artifacts at `factory/mt5/ftmo/JOB-FTMO-LEDGER-TESTER-LIFECYCLE-R6-2STEP-20260504/` and `factory/mt5/ftmo/JOB-FTMO-LEDGER-TESTER-LIFECYCLE-R6-1STEP-20260504/`. This remains ledger-mechanics evidence only: it is not candidate profitability evidence, not forward/demo survival, and closed-deal tester reports do not certify intratrade floating equity.

Objective:

- represent FTMO rule accounting before forward/demo claims exist

Primary work:

- [x] implement a deterministic `ftmo_ledger` worker over fixture or tester ledger data
- [x] declare FTMO target as `1-step`, `2-step`, or `both` through explicit rule-set input
- [x] record rule-set version/source date through explicit rule-set input
- [x] model CE(S)T daily reset, equity-based daily/max loss, floating P/L, commissions, and swaps; 2-Step static-loss and 1-Step end-of-day trailing max-loss fixture mechanics are implemented with repo-contained official-source rule artifacts
- [x] emit breach status and blocked reasons
- [x] ingest real MT5 Strategy Tester deal rows into a non-fixture FTMO ledger input

Primary targets:

- [ ] risk modules under `walk forward engine/src/risk/`; not implemented yet because Phase 5 ledger mechanics currently live in `src/workers/ftmo-ledger-worker.mjs`, while reusable strategy risk modules are deferred to forward/demo safety work
- [x] `factory/mt5/` or `factory/evidence/ftmo/`
- [x] `src/core/validators.mjs`

Exit criteria:

- [x] FTMO rule evidence is structured and versioned for the 2-Step static-loss and 1-Step trailing-loss ledger proofs
- [x] fixture-ledger output is clearly labeled as ledger-mechanics proof, not forward/demo survival
- [x] real tester-derived ledger input is clearly labeled as ledger-mechanics proof, not forward/demo survival

### Phase 6 - First Fixture And Minimal Candidate Manifest `[x]`

Status, 2026-05-04: executed as a negative research gate. Created the first minimal candidate identity anchor at `factory/candidates/CAND-EURUSD-M15-LONDON-BREAKOUT-001/manifest.json` and a canonical WFA route at `walk forward engine/strategies/london_breakout_eurusd/wfa_config.yaml`. The fixture choice cites the EURUSD M15 MT5 snapshot, real Strategy Tester lifecycle evidence, and non-fixture tester-derived FTMO ledger evidence. The EURUSD M15 data was validated at `factory/candidates/CAND-EURUSD-M15-LONDON-BREAKOUT-001/data-validation.json`, and the WFA route completed 87/87 windows with archived artifacts officialized at `factory/runs/JOB-RESEARCH-WFA-CAND-EURUSD-M15-LONDON-BREAKOUT-001-20260504/`. Result was negative: Sharpe -0.4048, aggregate return -0.077%, profit factor 0.8753, 912 trades. This is not a promotion; it is evidence to reject or pause this candidate before native/parity work.

Objective:

- attach one real candidate only after MT5/data identity and tester mechanics are proven

Primary work:

- [x] choose `EURUSD M15 LondonBreakout`, `XAUUSD`, or another available fixture from measured readiness
- [x] regularize one canonical WFA/config route for the selected fixture
- [x] classify existing `walk forward engine/scripts/parity_test.py` as signal parity only
- [x] create one minimal candidate manifest with candidate ID, deployment-mode assumption, signal/order/exit/sizing/session model, parameter freeze, and artifact refs

Primary targets:

- `walk forward engine/src/strategies/london_breakout.py` where selected
- `walk forward engine/config/strategy_london_breakout.json` where selected
- `walk forward engine/strategies/`
- `factory/candidates/`

Exit criteria:

- [x] one official proof path has one candidate ID and one canonical research route
- [x] fixture choice cites MT5/data identity evidence
- [x] candidate manifest exists before native or promotion work

### Phase 4-6 Durable Findings And Follow-Ups

Status, 2026-05-04: these findings are part of the operating spec, not chat-only notes. Future loop agents must read this section before altering MT5/FTMO evidence plumbing, candidate manifests, WFA routing, or promotion gates.

MT5 and FTMO communication findings:

- The real FTMO demo terminal path used for current evidence is `C:\Program Files\FTMO Global Markets MT5 Terminal\terminal64.exe`; terminal path, login, and server must be explicit runtime inputs and must not be invented from defaults.
- Passwords must remain env-only. The successful real snapshot used `TRF_MT5_PASSWORD`; no worker, request artifact, summary, or state file should persist the password.
- The canonical MT5 Python package is installed in `walk forward engine/.venv/`; the default Windows `python.exe` did not have `MetaTrader5` and blocked direct rates export attempts. Future MT5 probes should use the pinned repo venv unless a replacement environment is explicitly validated.
- `FILE_COMMON` is the proven tester-compatible artifact channel. It avoids tester-side network dependency and should remain the default channel for Strategy Tester evidence until a better deterministic channel is proven.
- MT5 tester evidence must remain repo-contained after ingestion. External terminal/common paths are allowed only for scoped EA, preset, tester report/log, and `FILE_COMMON` evidence handling; durable references belong under `factory/mt5/`.

Strategy Tester lifecycle findings:

- Real Strategy Tester lifecycle evidence exists at `factory/mt5/tester/JOB-MT5-TESTER-LIFECYCLE-REAL-20260504-EURUSD-M15-R6/`; it proves market order, pending order, and hard-exit mechanics for the lifecycle bench EA only.
- The lifecycle bench `.ex5` had to be visible under the terminal advisor folder `MQL5\Experts\TRF\`, and the preset had to be visible under `MQL5\Profiles\Tester\` before `/config` execution produced usable tester output.
- The accepted tester report is not a strategy profitability artifact. It is infrastructure evidence that MT5 Strategy Tester can run an EA, produce lifecycle rows, and feed deterministic workers.

FTMO ledger findings:

- The FTMO ledger worker can process explicit repo-contained 2-Step and 1-Step rule artifacts and non-fixture tester-derived closed-deal rows from the R6 lifecycle report.
- The current 2-Step proof covers static maximum-loss mechanics; the current 1-Step proof covers end-of-day trailing maximum-loss mechanics.
- Closed-deal MT5 tester reports do not prove intratrade floating-equity survival. Any FTMO rule gate that depends on floating equity must require an equity/time-series artifact, not only deal rows.
- Phase 5 artifacts are ledger-mechanics evidence only. They are not candidate profitability evidence, not forward/demo survival, and not deployability evidence.

Candidate and promotion findings:

- `CAND-EURUSD-M15-LONDON-BREAKOUT-001` is the first candidate identity anchor because EURUSD M15 is the only symbol/timeframe with a complete current MT5 snapshot, tester lifecycle, and tester-derived ledger chain.
- The London Breakout candidate WFA completed 87/87 windows but produced negative research evidence: Sharpe `-0.4048`, aggregate return `-0.077%`, profit factor `0.8753`, and 912 trades. This candidate should be rejected or parked unless a new pre-registered hypothesis justifies another run.
- No native MQL5 London Breakout candidate exists, no MT5 fill/cost/lifecycle parity exists for the strategy, and no FTMO forward/demo survival claim exists.
- `walk forward engine/scripts/parity_test.py` is signal-generation parity only. It must not satisfy MT5 fill parity, MT5 cost parity, lifecycle parity, FTMO rule-accounting parity, or promotion gates.
- The official research WFA envelope at `factory/runs/JOB-RESEARCH-WFA-CAND-EURUSD-M15-LONDON-BREAKOUT-001-20260504/` officializes existing WFA artifacts; the envelope worker did not itself launch the WFA. If future policy requires worker-launched WFA, the worker contract must change instead of silently reusing this pattern.
- The current `research_wfa` worker result has `candidate_id: null` despite the candidate-specific job/run IDs. Phase 7 should add explicit candidate-ID input and validation for candidate-scoped WFA envelopes.

WFA organization findings:

- The canonical candidate WFA route is `walk forward engine/strategies/london_breakout_eurusd/wfa_config.yaml`; candidate-specific WFA configs and outputs should remain under strategy-specific folders, while official evidence envelopes belong under `factory/runs/`.
- The validated EURUSD M15 data file already existed at `walk forward engine/data/Eurousd_M15_2003-2025/EURUSD_M15_2003_2025_COMBINED.csv`, not at the initially assumed flat data path. Future configs should reference actual validated paths and archive validation artifacts under `factory/candidates/<candidate-id>/`.
- The data validation artifact for this candidate is `factory/candidates/CAND-EURUSD-M15-LONDON-BREAKOUT-001/data-validation.json`; it recorded 438,746 rows, 0 duplicate timestamps, 0 OHLC violations, and expected FX market-closure gaps.
- The WFA runner appended this London Breakout run to `walk forward engine/strategies/gold_rush_pro_eurusd/wfa_history.json` even though the profile was `EURUSD_LONDON_BREAKOUT`. The copied London history at `walk forward engine/strategies/london_breakout_eurusd/wfa_history.json` is a documentation workaround, not a fix. Promotion gates must not rely on strategy-local `wfa_history.json` until this routing defect is fixed and tested.
- The London Breakout WFA initially failed until the strategy-specific `results/` directory existed. The WFA launcher should create missing output directories instead of requiring manual setup.
- A 50-trial London Breakout WFA attempt timed out after 34/87 windows and was archived as inconclusive at `factory/candidates/CAND-EURUSD-M15-LONDON-BREAKOUT-001/wfa-50trial-timeout.json`. Trial counts should be selected by explicit experiment budget, and timeout artifacts should be preserved rather than overwritten.
- The Windows-side WFA emitted Unicode logging errors from non-ASCII console output in the Hebrew Windows environment, but still wrote result artifacts. Logging should be made ASCII-safe or UTF-8-forced so successful runs are not obscured by console encoding noise.

Folder and artifact organization findings:

- `factory/mt5/environment/` is for terminal/account/data identity snapshots.
- `factory/mt5/tester/` is for repo-contained MT5 Strategy Tester lifecycle/report artifacts.
- `factory/mt5/ftmo/` is for rule artifacts, ledger inputs, and FTMO ledger worker outputs.
- `factory/candidates/<candidate-id>/` is for candidate manifests, data validation, candidate-local run notes, and candidate-scoped non-official research artifacts.
- `factory/runs/<job-id>/` is for official execution envelopes that the control plane can validate.
- Do not dump scratch, exports, tester files, or candidate evidence into the repo root. If a temporary file is needed, place it under the relevant factory subfolder or `/tmp/opencode` and either ingest it into evidence or remove it.

Immediate cleanup/follow-up checklist before serious candidate promotion work:

- [x] fix WFA history routing so each strategy writes history under its own strategy folder
- [x] make WFA result output directories auto-created by the launcher or engine
- [x] make WFA/MT5 subprocess logging ASCII-safe or UTF-8-safe on Windows Hebrew environments
- [x] add explicit candidate-ID input and validation to `research_wfa` envelope artifacts
- [x] add a promotion gate that rejects negative WFA candidates before native MQL5 work
- [x] require equity/time-series evidence, not only closed deals, for FTMO floating-equity rule gates
- [x] keep `CAND-EURUSD-M15-LONDON-BREAKOUT-001` parked/rejected unless a new pre-registered rationale exists

### Phase 7 - Promotion Gates And Parity Reports `[~]`

Status, 2026-05-05: partial control-plane slice implemented and wired into the executor-success path. Added deterministic parity report construction, parity report validation, candidate promotion gate construction, candidate gate writing under `factory/candidates/<candidate_id>/gates/`, failed-parity pattern record helpers, a deterministic candidate promotion gate runner at `scripts/run-candidate-promotion-gate.mjs`, npm alias `promotion:gate`, and an initial drift taxonomy at `factory/parity/drift-taxonomy.json`. Gates now explicitly deny `PaperTradingAdapter` output in MT5/FTMO promotion contexts, deny WFA-only evidence for MT5 tester / FTMO forward / deployable promotion contexts, and block parity promotion when empirical drift-threshold sources are missing. The runner reads existing evidence artifacts, writes the candidate gate, updates `manifest.json` latest-gate fields, and records failed-parity memory when applicable. The orchestrator now records a candidate promotion gate automatically after an accepted executor result with `candidate_id`, writes the gate into the aggregate run gate results, and updates the candidate manifest. This is still not a real strategy parity run: no native MQL5 candidate, MT5 strategy tester candidate output, or forward/demo parity evidence exists yet.

Objective:

- separate stage-output acceptance from candidate-promotion authority

Primary work:

- [x] implement minimal gate result artifacts for research, parity, and promotion decisions; MT5 snapshot/tester/FTMO ledger evidence is accepted by workers but dedicated promotion gates remain to be wired into real candidate flow
- [x] add explicit gate rejection for `PaperTradingAdapter` output in MT5/FTMO promotion contexts
- [x] add explicit rejection for WFA-only evidence at MT5 tester, FTMO forward, and deployable gates
- [x] emit structured parity reports with lifecycle, timing, fill, cost, trade-count, drawdown, and rule-accounting drift classifications

Primary targets:

- `src/core/validators.mjs`
- `src/core/orchestrator.mjs`
- `src/core/verification.mjs`
- `factory/parity/`

Exit criteria:

- [~] no candidate advances by narrative judgment alone; deterministic builders, CLI runner, and executor-success orchestrator hook exist, but full candidate-registry promotion state machine is still pending
- [x] failed parity creates artifact-backed failed-pattern memory through control-plane helpers
- [x] drift thresholds are empirical and recorded, not guessed silently

### WFA-Only Launch Readiness Checklist `[x]`

Purpose: define the minimum safe boundary for launching autonomous WFA-only research cycles before native MQL5, MT5 strategy parity, FTMO forward/demo, or deployable gates exist. This checklist is deliberately narrower than the full MT5/FTMO roadmap.

Launch boundary:

- autonomous loop may run `research_wfa` experiments only
- no MT5 strategy promotion, no FTMO forward/demo claim, no deployable claim
- candidate promotion gates are advisory/rejection controls only until native/parity evidence exists
- failed or negative WFA evidence must be preserved, not optimized away

Required before extended unattended WFA-only launch:

- [x] WFA launcher exits non-zero on setup failure, execution exception, missing results, or zero successful windows; zero-trade WFA attempts are preserved as blocked/inconclusive evidence and cannot satisfy accepted canary or promotion evidence
- [x] legacy/pre-Phase-7A `research_wfa` metrics require either a worker result envelope or deterministic metric backing from WFA result JSON artifacts; new run-level `executed` claims for `evidence_kind: research_wfa` require worker-launched Phase 7A provenance and cannot be satisfied by existing JSON artifacts alone
- [x] normalized memory preserves `evidence_kind`, `authority_layer`, `candidate_id`, `candidate_stage`, `deployment_mode`, `artifact_manifest_path`, `blocked_reason`, and `source_hashes`
- [x] planner validation allows planned new WFA config paths when the config is an expected artifact/input/implementation target, while still rejecting unexplained missing config references
- [x] planner prompt exposes canonical WFA config and strategy parameter locations
- [x] ready backlog is curated to 3-5 concrete WFA-only research tasks with explicit market, instrument scope, timeframe, data source, and canonical WFA route expectations; 2026-05-05 backlog was curated to 4 ready `research_wfa` items, and after the blocked canary it still has 3 ready WFA-only items
- [x] one short live canary cycle completes with verified `execution-result.json`, `artifact_manifest.json`, `gate-results.json`, evaluator output, summary, and updated evidence/memory; accepted infrastructure canary is `RUN-20260513113253-gghape`, with weak strategy evidence recalibrated to inconclusive/non-promotable

2026-05-05 canary status: blocked before WFA execution. Initial attempts resumed stale poisoned executor runs; fixed quarantine expiry to preserve stale run IDs as `blocked_resume_run_id` without auto-resume and cleared stale backlog resume pointers. Fresh run `RUN-20260505194725-nlq8sd` then reached planner but failed with empty/no RF JSON on attempt 1 and first-header transport timeouts on attempts 2-3. No `execution-result.json`, `artifact_manifest.json`, evaluator output, summary, evidence index update, or lesson append exists for that run.

Allowed to wait until after WFA-only canary stability:

- full `factory/candidates/index.json` registry/state machine
- native MQL5 candidate implementation
- real MT5 strategy tester parity for strategy logic
- FTMO forward/demo survival evidence
- deployable promotion state machine

### Phase 7A - Worker-Launched WFA Execution Truth `[x]`

Status, 2026-05-14: Phase 7A is closed. Core worker-launched WFA execution truth is operationally accepted for the official canary, the required request-field plus stale/copied-output adversarial tests exist, a recorded npm CLI canary has launched the real WFA subprocess with disk-backed evidence, and focused factory coverage proves WFA-ready live routing uses deterministic worker execution without planner/executor LLM authority. Cost/timing assumption parsing is artifact-backed for WFA result/config outputs. Optional separate trade/equity/optimizer artifact diagnostics are now implemented: emitted separate files are hashed and classified, while absent files produce explicit `missing_because` diagnostics. The existing `research_wfa` envelope worker officializes existing artifacts; it does not launch WFA. New unattended `research_wfa` execution claims require worker-launched provenance.

Canary acceptance, 2026-05-13: live run `RUN-20260513113253-gghape` reached official WFA-only acceptance through deterministic planner bypass plus `research_wfa_run` worker. Required artifacts exist under `factory/runs/RUN-20260513113253-gghape/`, summary `factory/summaries/RUN-20260513113253-gghape.md`, and WFA metrics artifact `walk forward engine/strategies/volatility_regime/results/walk_forward_results_20260513_143545.json`. This acceptance is execution-truth infrastructure evidence only, not strategy-quality evidence. The strategy result is weak/inconclusive: aggregate return was only `+1.4112%`, there were only `3` OOS windows and `20` trades, one window was negative (`-1.6014%`, Sharpe `-1.1051`, PF `0.3465`), window performance was uneven, and `hold_bars` stability was weak (`0.6464`). Future evaluator output must distinguish `operational canary accepted` from `strategy genuinely promising`; high Sharpe on low-return, low-window, low-trade samples must not be labeled promising. A genuinely promising research strategy generally needs at least `5` completed OOS windows, preferably more, at least `50` trades unless pre-registered as low-frequency, roughly `5-10%+` annualized return or a strong aggregate-return proxy, and mostly consistent OOS windows.

Evaluator/promotion calibration hardening, 2026-05-13: `src/core/validators.mjs` rejects positive `research_wfa` evaluator verdicts unless the evaluator's cited metric artifacts back the required promotion metrics: completed OOS window count, total trade count, and either annualized return or aggregate return. Later validator hardening also rejects positive labels when the backed metrics are below the strategy-quality floors: at least 5 completed OOS windows, at least 50 trades, roughly 5%+ annualized return or aggregate-return proxy, and acceptable OOS-window consistency. Verification tests cover rejection of missing artifact-backed window/trade/return metrics, weak positive labels, and acceptance when required metrics are present via WFA result aliases. Verified with `rtk npm run test:verification` passing `46/46` at the original slice and broader validator coverage in later full test runs.

Request strictness hardening, 2026-05-14: `validateResearchWfaRunRequest` now fails closed on missing `lineage_id`, missing `family_id`, missing/empty/invalid `environment_allowlist`, non-meaningful candidate IDs, and null candidate IDs when a request explicitly declares candidate scope. `compileWfaReadyPlan` now carries stable deterministic lineage/family IDs into WFA-ready compiled plans when older backlog items omit them. Focused coverage is in `tests/verification.test.mjs` and `tests/factory.test.mjs`; verified with `rtk npm run test:verification` passing `47/47` and `rtk npm run test:factory` passing `62/62`.

Adversarial WFA hardening, 2026-05-14: `tests/verification.test.mjs` now has dedicated Phase 7A coverage for false `execution_was_run_by_this_worker`, missing stdout/stderr artifact evidence, artifact hash mismatch, missing WFA config/source/config/data input hashes, zero completed windows, missing aggregate metrics, missing per-window metrics, non-zero WFA exit diagnostics, and timeout diagnostics. `research_wfa_run_worker` now blocks missing per-window metrics before any executed claim. Verified with `rtk npm run test:verification` passing `55/55`, full `rtk npm test` passing `171/171`, and `rtk npm run validate` passing.

Stale/copied-output hardening, 2026-05-14: accepted WFA result artifact records now carry request identity (`run_id`, `job_id`, `candidate_id`, `lineage_id`, `family_id`, `attempt_id`), worker results expose the same identity, and validators reject stale accepted WFA outputs by worker-start freshness plus copied-output request-identity mismatch. Disk-backed stale-output checks also reject accepted output files whose actual mtime predates worker start. Dedicated tests cover stale metadata, stale disk mtime, and copied output identity mismatches for run/job/candidate/attempt. Verified with `rtk npm run test:verification` passing `57/57` and full `rtk npm test` passing `173/173`.

Recorded CLI canary, 2026-05-14: `rtk npm run wfa:run -- factory/runs/RUN-20260514050018-cli-wfa-canary/worker-results/research-wfa-run-request.json` launched the real WFA subprocess from `walk forward engine/` through the npm CLI entrypoint and returned `status: executed`. Disk-backed evidence exists under `factory/runs/RUN-20260514050018-cli-wfa-canary/`: request/result artifacts, stdout/stderr, pre/post snapshots, accepted-output manifest, parsed metrics, trial attempt record, and accepted WFA outputs tagged with request identity. Metrics were artifact-backed but weak/negative strategy evidence: `3` completed windows, `0` failed windows, `23` trades, Sharpe `-0.7354`, aggregate return `-0.3931%`, PF `0.8739`, max drawdown `-4.4628%`; this is CLI execution-truth evidence only, not a strategy-quality claim.

Focused orchestrator routing test, 2026-05-14: `tests/factory.test.mjs` now asserts the live WFA-ready route skips planner and executor agent calls, writes an executor stage input with `execution_authority: "deterministic_research_wfa_run_worker"`, records a `research_wfa_run` worker result with `execution_was_run_by_this_worker: true`, and emits an executor gate validated by `deterministic_research_wfa_run_worker`. Verified with `rtk npm run test:factory` passing `62/62`.

Cost/timing assumption parsing, 2026-05-14: `src/workers/research-wfa-run-worker.mjs` now parses only artifact-backed cost and timing assumptions from the accepted WFA result JSON and WFA config artifact. Each parsed value records `source_path`, `source_sha256`, and `source_field`; unavailable assumptions record explicit `missing_because` diagnostics rather than invented values. `src/core/validators.mjs` now requires Phase 7A executed `research_wfa_run` results to expose cost/timing assumption availability diagnostics. Focused tests in `tests/verification.test.mjs` cover present artifact-backed assumptions and absent-assumption diagnostics. Verified with `rtk npm run test:verification` passing `59/59`.

Optional artifact hashing/diagnostics, 2026-05-14: the recorded real WFA canary output set was inspected and currently emits `analysis.json`, `walk_forward_results_*.json`, `walk_forward_summary_*.csv`, and `parameter_stability_*.json`, but no separate trade ledger, equity curve, or optimizer-trial ledger files. `src/workers/research-wfa-run-worker.mjs` now records `optional_wfa_artifacts` diagnostics for `trade_ledger`, `equity_curve`, and `optimizer_trials`; when separate files are emitted in accepted outputs, it adds classified hashed artifacts (`wfa_trade_ledger`, `wfa_equity_curve`, `wfa_optimizer_trials`), and when absent it records explicit `missing_because` notes without counting summaries or embedded result fields. `src/core/validators.mjs` requires these availability diagnostics for executed Phase 7A `research_wfa_run` evidence. Focused tests cover both absent diagnostics and emitted-file hashing/classification. Verified with `rtk npm run test:verification` passing `61/61` and full `rtk npm test` passing `177/177`.

Objective:

- make fake, stale, copied, cross-run, or LLM-invented executed `research_wfa` evidence impossible before native MQL5, broad ResearchBrain, framework migration, portfolio, or deployment work continues

Minimal WFA-ready preflight before a worker request:

- canonical WFA config exists under `walk forward engine/strategies/<name>/wfa_config.yaml`
- referenced strategy source exists, or the same task explicitly creates it before the worker request
- referenced strategy parameter/config file exists, or the same task explicitly creates it before the worker request
- referenced data file or data manifest exists, or the same task explicitly produces and validates it before the worker request
- canonical command, working directory, Python executable, timeout, and expected output root are explicit in the request
- backlog items marked ready for deterministic WFA execution must not point to missing config, strategy, or data paths unless those missing artifacts are implementation targets completed before launch

Primary work:

- [x] define `research_wfa_run_worker_v1` request/result schemas; implemented in `src/workers/research-wfa-run-worker.mjs` and validated through `validateResearchWfaRunRequest` plus worker-envelope validation
- [x] require request fields: `run_id`, `job_id`, `candidate_id` when candidate-scoped, `lineage_id`, `family_id`, `attempt_id`, `attempt_type`, `evidence_kind: research_wfa`, `authority_layer: python_research`, canonical WFA config path, strategy source paths, strategy parameter/config paths, data paths or data manifest paths, expected output root, timeout, canonical working directory, Python executable, and environment allowlist; strict `lineage_id`, `family_id`, `environment_allowlist`, and candidate-scoped null rejection are covered by `tests/verification.test.mjs`
- [x] implement `src/workers/research-wfa-run-worker.mjs`
- [x] implement `scripts/run-research-wfa-run-worker.mjs` and `npm run wfa:run`
- [x] make the worker CLI accept one validated request JSON and no hidden default strategy, symbol, timeframe, candidate, or data route
- [x] create or verify a run-scoped worker output folder under `factory/runs/<run_id>/worker-results/`; official canary wrote `factory/runs/RUN-20260513113253-gghape/worker-results/`
- [x] create a pre-run output snapshot of relevant WFA output locations before launch, including paths, mtimes, sizes, and hashes where practical
- [x] launch canonical WFA from `walk forward engine/` with captured command, cwd, start time, end time, duration, timeout status, exit code, stdout, and stderr
- [x] hash WFA config, strategy source, strategy params/config, data/input manifests, stdout/stderr, metrics, trades, equity, optimizer trials, and accepted output artifacts where present; current worker hashes inputs, stdout/stderr, parsed metrics, accepted outputs, snapshots, and any separate emitted trade/equity/optimizer-trial artifacts, while absent optional artifacts receive explicit diagnostics
- [x] discover actual WFA output paths from the current run and reject stale strategy-folder artifacts that cannot be tied to the current request; worker snapshots before/after output paths, accepts only changed outputs, records stale-output guard results, tags accepted WFA result artifacts with request identity, and tests reject stale/cross-run copied output artifacts
- [x] parse aggregate OOS metrics, per-window OOS metrics, completed/failed window counts, selected params by window when available, total trades, cost assumptions, and timing assumptions from artifact-backed outputs only; cost/timing assumptions now include source path/hash/field or explicit `missing_because` diagnostics
- [x] emit the worker result under `factory/runs/<run_id>/worker-results/research-wfa-run-worker-result.json` or an equivalent spec-approved run-local worker result path
- [x] write or link run-level `execution-result.json` and `artifact_manifest.json` when the worker is used inside a loop cycle
- [x] write a minimal append-only trial-attempt record for every attempt before the full SQLite ledger exists
- [x] make new run-level `executed` claims for `evidence_kind: research_wfa` fail closed unless `execution_was_run_by_this_worker: true`
- [x] route explicit WFA-ready executor stages through this deterministic worker rather than an LLM executor; official canary gate records deterministic worker execution authority

Minimum trial-attempt record fields for this phase:

- `trial_id`
- `run_id`
- `job_id`
- `candidate_id`
- `lineage_id`
- `family_id`
- `attempt_id`
- `parent_attempt_id`
- `attempt_type`
- `generated_by`
- `status`
- `started_at`
- `ended_at`
- `failure_code`
- `reason`
- `input_hashes`
- `output_refs`

Mandatory tests for this phase:

- [x] schema accepts a valid `research_wfa_run_worker_v1` request/result; covered by `tests/verification.test.mjs` and `rtk npm run test:verification` 57/57
- [x] schema rejects missing worker provenance for new executed `research_wfa`; covered by workerless WFA validation tests
- [x] validator rejects `execution_was_run_by_this_worker: false` for new executed `research_wfa`; covered by dedicated false-provenance test in `tests/verification.test.mjs`
- [x] validator rejects missing stdout/stderr artifact or hash mismatch; covered by dedicated missing stdout/stderr and tampered stdout hash tests in `tests/verification.test.mjs`
- [x] validator rejects missing WFA config, strategy source, strategy params, or data/input hashes; covered by dedicated missing input hash tests in `tests/verification.test.mjs`
- [x] validator rejects stale outputs created before worker start; covered by stale accepted-output metadata and stale disk-mtime adversarial tests in `tests/verification.test.mjs`
- [x] validator rejects copied outputs from another `run_id`, `job_id`, `candidate_id`, or `attempt_id`; covered by request-identity binding tests in `tests/verification.test.mjs`
- [x] validator rejects wrong or null `candidate_id` for candidate-scoped WFA; wrong `candidate_id` and explicit candidate-scoped null rejection are covered by `tests/verification.test.mjs`
- [x] validator rejects zero completed windows; worker blocks zero successful windows and `tests/verification.test.mjs` covers the non-executed result
- [x] validator rejects zero trades for accepted executed `research_wfa`; zero-trade attempts are preserved as inconclusive and covered by `tests/verification.test.mjs`
- [x] validator rejects missing aggregate OOS metrics; worker blocks missing parseable artifact-backed metrics and `tests/verification.test.mjs` covers the result
- [x] validator rejects missing per-window metrics; worker now blocks missing per-window metrics and `tests/verification.test.mjs` covers the result
- [x] validator rejects fabricated summary metrics not backed by WFA artifacts, including positive evaluator `research_wfa` labels whose cited metric artifacts do not back window count, trade count, and return metrics
- [x] timeout test preserves diagnostics and writes a non-executed trial record; covered by `tests/verification.test.mjs`
- [x] non-zero WFA exit test preserves diagnostics and writes a non-executed trial record; covered by `tests/verification.test.mjs`
- [x] orchestrator routing test proves an explicit WFA-ready item bypasses planner/executor LLM execution authority; `tests/factory.test.mjs` asserts no planner/executor agent calls, deterministic executor stage input, `research_wfa_run` worker result, and deterministic executor gate
- [x] worker records artifact-backed cost/timing assumptions or explicit missing diagnostics; covered by present and absent assumption tests in `tests/verification.test.mjs`
- [x] worker records separate optional trade/equity/optimizer artifacts where emitted, or explicit missing diagnostics when absent; covered by emitted and absent optional-artifact tests in `tests/verification.test.mjs`

Exit criteria:

- [x] `npm run wfa:run -- <request.json>` launches a real WFA subprocess from `walk forward engine/`; recorded canary evidence exists at `factory/runs/RUN-20260514050018-cli-wfa-canary/` from `rtk npm run wfa:run -- factory/runs/RUN-20260514050018-cli-wfa-canary/worker-results/research-wfa-run-request.json`
- [x] worker result records `execution_was_run_by_this_worker: true`
- [x] command, cwd, timing, timeout status, exit code, stdout, and stderr are recorded and hashed
- [x] input config/source/params/data hashes are recorded before execution
- [x] pre-run output snapshot and stale-output guard are recorded; snapshots, changed-output acceptance, freshness guard observations, and stale-output adversarial coverage exist
- [x] accepted WFA output artifacts exist on disk and hashes match
- [x] optional separate trade/equity/optimizer artifacts are hashed and classified where emitted, and absent optional artifacts are explicitly diagnosed without inferring from summaries
- [x] aggregate OOS metrics, per-window metrics, completed-window count, and trade count are artifact-backed
- [x] failed, blocked, timed-out, and non-zero-exit attempts preserve diagnostics and trial records without becoming executed evidence; covered by zero-window, missing-metric, timeout, and non-zero tests in `tests/verification.test.mjs`
- [x] fake, stale, wrong-ID, missing-window, missing-metric, missing-hash, and zero-trade adversarial cases fail closed; tests cover zero-trade, wrong/null candidate ID, workerless/false provenance, missing hash, missing window, missing metric, unbacked positive metrics, stale output, and cross-run copied-output identity cases
- [x] orchestrator can execute an explicit WFA-ready backlog item through compiler plus worker without planner/executor LLM execution authority; official canary `RUN-20260513113253-gghape` records deterministic planner bypass plus `research_wfa_run` worker execution
- [x] one real short WFA-only canary reaches official acceptance with worker result, execution result, artifact manifest, gate result, evaluator output, summary, evidence index update, and lesson/memory update (`RUN-20260513113253-gghape`)

### Phase 7B - Minimal Runtime Ledger, Data Readiness, And Research Gates `[x]`

Current status: closed as scoped prerequisite infrastructure. The chronological addenda below are retained as implementation history; the closeout status and exit criteria are authoritative for whether Phase 7B is complete.

Status, 2026-05-14: Phase 7B has started with the minimal SQLite runtime-ledger skeleton plus the first lease/fencing slice, WFA-worker mirror slice, outbox idempotency slice, tiny data-readiness manifest validator slice, one narrow Binance USD-M funding data-readiness helper, and a reporting-first research WFA gate reporter. `src/core/runtime-ledger.mjs` creates the repo-contained DB at `factory/runtime/factory.sqlite`, migrates the minimum tables, records schema/SQLite/journal/DB-location diagnostics, disables WAL on the current mounted path, supports basic run/job/attempt/artifact/trial inserts and reads, provides a `BEGIN IMMEDIATE` transactional run-status plus outbox helper, supports retryable job claim, heartbeat, stale-lease reclaim, and finalize helpers with fencing-token checks, mirrors worker-launched completed/blocked WFA result evidence into SQLite after JSON artifacts are written, and exposes pending-outbox reads plus idempotent processed marking by `event_id`. `src/core/data-readiness.mjs` validates a minimal `data_readiness_manifest_v1` with source URL, raw/normalized hashes, coverage, gap report, feature-lag rules, survivorship policy, and WFA integration paths. `src/workers/binance-usdm-funding-data-readiness-worker.mjs` normalizes supplied Binance USD-M funding rows and exposes an injectable live fetch wrapper, writes raw JSONL and normalized CSV under `workspace/data/binance/usdm_funding/<symbol>/`, emits a validated data-readiness manifest, records coverage/gaps/feature-lag/survivorship/WFA integration fields, fails loud on empty rows, and returns blocked diagnostics without fake artifacts on fetch failure. `src/core/verification.mjs` now builds and writes `research_wfa_gate_report_v1` advisory artifacts under `factory/research-gates/<candidate>/` when candidate-scoped research WFA promotion evidence is recorded; the report captures WFE/WFR definitions, underpowered flags, OOS-window consistency, profitable-window ratio, parameter stability, cost-assumption status, data-identity/gap flags, duplicate failed-pattern warnings, and advisory-only disabled DSR/PBO/CPCV/White fields. `scripts/migrate-runtime-ledger.mjs` creates the actual DB. Focused tests in `tests/runtime-ledger.test.mjs`, `tests/verification.test.mjs`, and `tests/data-readiness.test.mjs` pass. No worker/orchestrator SQLite authority, production crypto fetch scheduler, broad source warehouse, hard statistical research gates, or deployment path has been implemented. This phase must stay small; it is not a workflow-engine migration or data warehouse project.

Status, 2026-05-15 addendum: Phase 7B now also has `scripts/run-binance-usdm-funding-data-readiness.mjs` plus `npm run data:binance-funding`, a narrow production-safe Binance USD-M funding wrapper that requires explicit `--input` or `--live`, supports JSON/JSONL fixture input, writes the existing hash-backed raw/normalized/manifest artifacts through the helper, and does not introduce scheduling or a source warehouse.

Status, 2026-05-15 second addendum: minimal WFA plan consumption of data-readiness manifests now exists. `src/core/wfa-plan-compiler.mjs` carries explicit data-readiness manifest paths into deterministic WFA-ready plans, records consumed/not-consumable manifest diagnostics, and includes manifest-derived WFA data paths when the manifest validates. `src/core/orchestrator.mjs` projects those plan fields into `research_wfa_run_request_v1.data_manifest_paths` and `data_paths`. `src/workers/research-wfa-run-worker.mjs` validates `data_readiness_manifest_v1` contents before launching WFA and returns blocked worker evidence with exact manifest diagnostics when a manifest is not consumable.

Status, 2026-05-15 third addendum: advisory research-gate reports now consume existing worker-emitted `trial_attempt_record` JSONL artifacts as a partial worker-attempt denominator. `src/core/verification.mjs` hash-verifies the artifact path from the worker result, parses the attempt rows, reports status/attempt-type/generated-by counts plus lineage/family IDs, includes the trial record in gate evidence paths, and at this addendum point kept DSR/PBO/CPCV/White disabled because full optimizer, LLM, manual, mutation, repair, rerun, and multiple-comparison denominator context was still incomplete.

Status, 2026-05-15 fourth addendum: partial worker-trial-denominator consumption is now SHA-required. The advisory reporter refuses to parse `trial_attempt_record` artifacts that lack a valid SHA-256 or whose on-disk hash does not match the worker artifact record, marks the denominator artifact unreadable, and keeps statistical tests disabled rather than consuming unhash-backed or hash-mismatched attempt rows.

Status, 2026-05-15 fifth addendum: advisory worker-trial-denominator reports now expose compact accepted attempt rows and rejected-row diagnostics. The reporter validates each hash-backed `trial_attempt_record` row against the current worker result identity (`run_id`, `job_id`, `candidate_id`, `lineage_id`, `family_id`, `attempt_id`, `attempt_type`), counts only matching rows, records compact provenance fields plus input/output reference counts, and reports rejected mismatched rows without treating them as usable denominator evidence.

Status, 2026-05-15 sixth addendum: advisory research-gate reports now consume existing worker-classified `wfa_optimizer_trials` artifacts when present. The reporter requires a valid SHA-256, verifies the on-disk hash, parses bounded JSON/JSONL/CSV trial-row counts, includes readable optimizer-trial artifacts in evidence paths, reports missing/unreadable diagnostics, and at this addendum point still kept DSR/PBO/CPCV/White disabled until the full search denominator was represented.

Status, 2026-05-15 seventh addendum: advisory research-gate reports now include an explicit `search_denominator` coverage summary. It combines counted worker attempt rows and optimizer-trial artifact rows, marks the denominator incomplete, lists covered sources, lists missing sources including complete optimizer search context plus LLM/manual/mutation/repair/rerun/multiple-comparison context, and keeps statistical tests disabled until those missing sources become artifact-backed.

Status, 2026-05-15 eighth addendum: advisory research-gate reports now consume hash-backed `non_worker_denominator_attempts` artifacts using schema `non_worker_denominator_attempts_v1`. The format records advisory denominator rows for `llm_generated`, `manual`, `mutation`, `repair`, and `rerun` attempts only; it does not execute anything, start ResearchBrain, or become orchestration authority. `src/core/verification.mjs` requires a valid artifact SHA-256, verifies the on-disk hash, parses bounded JSON/JSONL rows, rejects malformed rows, rejects candidate/lineage/family identity conflicts when current identity is known, exposes compact accepted rows plus rejected-row diagnostics, and updates `search_denominator` missing sources only for categories with accepted rows. At this addendum point, DSR, PBO, CPCV, and White Reality Check remained disabled until the full denominator and multiple-comparison context were complete.

Status, 2026-05-15 ninth addendum: advisory research-gate reports now consume hash-backed `optimizer_search_context` artifacts using schema `optimizer_search_context_v1`. The context records candidate/lineage/family identity, optimizer name, search-space hash, planned/completed/failed trial counts, window count, timestamp, and source artifacts. `src/core/verification.mjs` requires a valid artifact SHA-256, verifies the on-disk hash, parses bounded JSON context rows, rejects malformed trial accounting, rejects candidate/lineage/family identity conflicts when current identity is known, exposes compact accepted contexts plus rejected-context diagnostics, and removes `complete_optimizer_search_context` from `search_denominator.missing_sources` only when a valid context is consumed. This is advisory denominator evidence only; it does not execute anything, does not make the denominator complete, and at this addendum point statistical tests remained disabled until multiple-comparison context and the full denominator were complete.

Status, 2026-05-15 tenth addendum: advisory research-gate reports now consume hash-backed `multiple_comparison_context` artifacts using schema `multiple_comparison_context_v1`. The context records candidate/lineage/family identity, total strategies tested, correction method, adjusted/nominal alpha, family-wise error rate, correction-applied flag, optional correction-parameters hash, timestamp, and source artifacts. `src/core/verification.mjs` requires a valid artifact SHA-256, verifies the on-disk hash, parses bounded JSON context rows, rejects malformed rows (non-positive total_strategies_tested, alpha outside [0,1], invalid correction_parameters_hash), rejects candidate/lineage/family identity conflicts when current identity is known, exposes compact accepted contexts plus rejected-context diagnostics, and removes `multiple_comparison_context` from `search_denominator.missing_sources` only when a valid context is consumed. `search_denominator` now also exposes `multiple_comparison_context_count` and `multiple_comparison_total_strategies_tested`. This is advisory denominator evidence only; it does not execute anything, does not make the denominator complete, and at this addendum point statistical tests remained disabled until the full denominator was complete.

Status, 2026-05-15 eleventh addendum: `search_denominator.complete` now reflects structural source coverage instead of being hard-coded false. When worker trial attempts, optimizer-trial rows, all five non-worker attempt categories, optimizer search context, and multiple-comparison context are all accepted from hash-backed artifacts, the gate report marks `status: "complete_search_denominator"`, clears `missing_sources`, and keeps `statistical_tests_enabled: false`. Structural denominator completeness alone does not produce hard confidence claims. DSR later gained explicit-input advisory computation; PBO/CPCV/White remain disabled until Phase 7C.

Status, 2026-05-15 twelfth addendum: Phase 7B now has a narrow Binance USD-M funding refresh-request path and exit-readiness reporter. `binance_usdm_funding_refresh_request_v1` in `src/workers/binance-usdm-funding-data-readiness-worker.mjs` requires explicit symbol, start/end time, mode, limit/config, and either `fixture_input` raw rows or explicit `live_fetch_allowed: true`; missing inputs and fetch/config failures return blocked diagnostics with `artifacts_written: false`. `scripts/run-binance-usdm-funding-refresh-request.mjs` plus `npm run data:binance-funding-refresh` execute request artifacts without introducing a warehouse or broad scheduler. WFA-ready data-readiness manifest consumption now also supports an optional freshness bound (`data_readiness_max_age_hours`) and marks stale manifests `not_consumable` with exact diagnostics before worker launch. `src/core/phase7b-exit-readiness.mjs`, `scripts/run-phase7b-exit-readiness.mjs`, and `npm run phase7b:exit-readiness` emit read-only `phase7b_exit_readiness_report_v1` verification artifacts summarizing met, pending, and deferred Phase 7B criteria.

Status, 2026-05-15 thirteenth addendum: broad SQLite orchestration authority is explicitly deferred beyond Phase 7B. Phase 7B closure should not wait for replacing JSON/orchestrator authority with SQLite; the Phase 7B SQLite deliverable is the repo-contained mirror/projection ledger with leases, fencing, outbox, and worker-result mirroring. `research_wfa_gate_report_v1` now has a narrow deterministic DSR advisory path: DSR is computed only when an explicit DSR input block supplies observed Sharpe, return count, skewness, kurtosis, trial count, benchmark Sharpe, complete search denominator, and hash-verified source artifacts. DSR source artifacts are promoted into report `evidence_paths`, successful advisory computation adds `dsr_computed_advisory`, and missing or unverified inputs add `dsr_blocked_insufficient_inputs` with no DSR probability. DSR remains reporting-only, not promotion authority. PBO, CPCV, White Reality Check, and any hard statistical promotion authority are explicitly owned by future Phase 7C, not Phase 7B.

Status, 2026-05-15 fourteenth addendum: Phase 7B is the prerequisite-builder for statistical validation, not the full statistical-validation phase. It owns denominator/readiness/ledger/gate-reporting infrastructure plus explicit-input advisory DSR. Phase 7C owns the careful deterministic implementation of PBO, CPCV, White Reality Check, their fixtures, their artifact input contracts, and any later decision about hard promotion authority. Phase 8 native MQL5 proof work is not blocked by Phase 7C unless a later promotion path tries to use those statistical tests as hard gates.

Status, 2026-05-15 closeout: Phase 7B is closed as scoped prerequisite infrastructure. The read-only readiness artifact `factory/verification/phase7b-exit-readiness-20260515T164711Z.json` reports `status: "ready_to_close"`, with 6 criteria met, 0 pending, and 2 deferred: Phase 7C statistical validation and broad SQLite orchestration authority. This closeout does not claim PBO/CPCV/White implementation, hard statistical promotion authority, broad source warehouse, ResearchBrain, native MQL5, MT5 parity, FTMO forward, deployment, or live trading.

Objective:

- make the worker-launched WFA path recoverable, trial-aware, and useful for stronger crypto research without expanding into broad architecture work

Primary work:

Phase 7B primary-work status is deliberately narrow: the SQLite skeleton, lease/fencing helper slice, WFA-worker mirror slice, outbox idempotency helper, data-readiness manifest validator, Binance USD-M funding fixture-driven source helper plus injectable live fetch wrapper, explicit CLI, explicit refresh-request runner, freshness-bound WFA manifest consumption, reporting-first research WFA gate reporter, identity-validated partial worker-trial-denominator consumption, advisory optimizer-trial artifact consumption, advisory optimizer-search-context consumption, advisory non-worker denominator artifact consumption, advisory multiple-comparison context artifact consumption, explicit search-denominator coverage/completeness reporting, advisory explicit-input DSR computation/blocking, and Phase 7B exit-readiness reporting exist. Broad SQLite orchestration authority is deferred beyond Phase 7B. Broad source warehouse, hard statistical promotion gates, and PBO/CPCV/White implementations are explicitly out of Phase 7B scope and belong to later phases.

- [x] create the local runtime SQLite DB at `factory/runtime/factory.sqlite`, unless a later spec amendment chooses another repo-contained local path; migration output verified the DB exists at this path
- [x] add minimum tables: `runs`, `jobs`, `job_attempts`, `leases`, `heartbeats`, `artifacts`, `trial_attempts`, `outbox`, and `schema_metadata`
- [x] claim jobs with `BEGIN IMMEDIATE`; `claimNextJob` uses the retryable immediate transaction helper and claims one eligible queued/ready/stale-claimed job
- [x] increment a fencing token on every claim and require the current token on heartbeat/finalize; stale heartbeat/finalize attempts are rejected after reclaim
- [x] use short transactions, `busy_timeout` plus retry, and no DB transaction held during WFA execution for the Phase 7B worker-mirror path; `busy_timeout`, retryable short `BEGIN IMMEDIATE` transactions, busy retry tests, and post-artifact WFA-worker mirroring exist, while broad orchestration authority is explicitly deferred beyond Phase 7B
- [x] write state transition and outbox event in the same transaction; covered by rollback-on-duplicate-outbox focused test
- [x] make outbox consumers idempotent by `event_id`; `listPendingOutboxEvents` plus `markOutboxEventProcessed` allow consumers to skip already processed events without rewriting `processed_at` or consumer result
- [x] log SQLite version, journal mode, WAL/checkpoint status when WAL is enabled, and DB filesystem location; migration diagnostics record SQLite `3.49.1`, journal `delete`, WAL disabled, and mounted-path location
- [x] use WAL only when the repo path is on a local filesystem where SQLite WAL locking is reliable; current migration detects the `/mnt/...` mounted path and keeps a repo-contained non-WAL `delete` journal with explicit diagnostics
- [x] keep JSON files as human-readable projections and immutable artifacts, not the runtime concurrency authority; WFA-worker mirroring happens only after existing worker/execution JSON artifacts are written, and SQLite is not used as worker runtime authority
- [x] add a tiny dataset manifest/coverage validator before broad fetcher work; `src/core/data-readiness.mjs` validates source URL, raw/normalized artifact hashes, coverage window, gap report, feature-lag rules, survivorship policy, and WFA integration paths
- [x] add one crypto data-readiness source family first, preferably Binance USD-M funding or open-interest related data, with raw/normalized hashes, coverage, gaps, survivorship flag, feature-lag rules, and WFA integration manifest; implemented as a fixture/input-driven Binance USD-M funding helper plus injectable live fetch wrapper, explicit `data:binance-funding` CLI, and narrow `binance_usdm_funding_refresh_request_v1` runner with blocked diagnostics, not a warehouse
- [x] add reporting-first WFA research gates: WFE/WFR definitions, minimum trade-count flags, OOS window consistency, profitable OOS-window ratio, parameter stability, cost-stress fields where data exists, data identity/gap flags, duplicate failed-pattern warnings, identity-validated partial consumed worker-trial-denominator summaries, SHA-verified optimizer-trial artifact row counts when emitted, SHA-verified optimizer-search context when emitted, SHA-verified advisory non-worker attempt rows when emitted, and explicit incomplete search-denominator coverage reporting; implemented as advisory `research_wfa_gate_report_v1` artifacts, not promotion authority
- [x] keep statistical tests reporting-only until their inputs and implementations are defensible; DSR can now compute only as explicit-input advisory when complete search denominator plus hash-verified DSR source artifacts exist, otherwise it blocks with `blocked_insufficient_inputs`; PBO, CPCV, and White Reality Check are deferred to Phase 7C and remain disabled in Phase 7B

Mandatory tests for this phase:

Phase 7B test status is closed as scoped: SQLite skeleton, lease/fencing/reclaim/retry tests, outbox idempotency tests, WFA-worker mirror tests, data-readiness manifest validator tests, Binance USD-M funding helper/fake-fetch/CLI/refresh-request tests, WFA plan manifest-consumption and stale-manifest tests, advisory research-gate reporter tests, partial worker-trial-denominator consumption tests, unhash-backed/hash-mismatched trial-record refusal tests, mismatched trial-row identity rejection tests, optimizer-trial artifact consumption/refusal tests, optimizer-search-context consumption/refusal/rejection tests, non-worker denominator artifact consumption/refusal/rejection tests, multiple-comparison context artifact consumption/refusal/rejection tests, explicit search-denominator coverage tests, structural-complete denominator integration coverage, DSR advisory/blocked-input tests, and Phase 7B exit-readiness reporter tests exist; PBO/CPCV/White and hard statistical-promotion tests are Phase 7C work.

- [x] SQLite schema migration creates exactly the minimum tables
- [x] run/job/attempt/artifact/trial rows can be inserted and read back
- [x] lease claim uses `BEGIN IMMEDIATE` and fencing token checks
- [x] heartbeat expiry and reclaim works for a stale lease
- [x] busy-timeout/retry path is tested
- [x] transactional outbox smoke test proves state transition and event are written atomically
- [x] outbox processing is idempotent by `event_id` and missing event IDs fail loud
- [x] WFA-worker completed and blocked attempts mirror run/job/job-attempt/artifact/trial rows into SQLite without making SQLite authority
- [x] WFA-worker JSON artifacts remain written as projections, and SQLite mirror failures are not silently swallowed
- [x] data-readiness validator rejects missing source URL, missing hash, missing coverage, missing gap report, missing feature-lag rules, missing survivorship policy, missing WFA integration, and hash mismatches
- [x] Binance USD-M funding helper fixture rows, injectable fake-fetch rows, and explicit-input CLI runs produce raw, normalized, and manifest artifacts with valid hashes, coverage, gap report, feature-lag rules, survivorship policy, WFA integration paths, exact empty-row diagnostics, blocked fetch-failure diagnostics without fake artifacts, and no implicit live fetch
- [x] Binance USD-M funding refresh requests require explicit symbol/time range/config/mode, produce hash-backed raw/normalized/manifest artifacts from fixture input, require explicit live opt-in for live fetch, and block missing inputs without fake artifacts
- [x] WFA-ready plans consume valid data-readiness manifests into worker `data_manifest_paths` and manifest-derived `data_paths`, while invalid or stale manifests block before WFA launch with exact `data_manifest_path not consumable` diagnostics
- [x] research-gate reporter records underpowered flags, WFE/WFR definitions, OOS consistency, profitable-window ratio, parameter stability, data-gap flags, duplicate failed-pattern warnings, partial hash-verified and identity-validated worker-trial-denominator summaries, compact accepted attempt rows, rejected-row diagnostics, refusal of unhash-backed/hash-mismatched worker trial records, SHA-verified optimizer-trial artifact row counts when available, SHA-verified optimizer-search context when available, SHA-verified advisory non-worker denominator rows when available, SHA-verified multiple-comparison context when available, explicit search-denominator coverage/completeness, and advisory-only disabled statistical tests without inventing hard statistical confidence
- [x] DSR advisory computation requires complete search denominator plus explicit hash-verified DSR inputs, and blocks missing/unverified inputs without emitting fake DSR probabilities
- [x] Phase 7B exit-readiness reporter summarizes met vs pending criteria from repo artifacts/state and emits verification artifacts without mutating orchestrator-owned state

Exit criteria:

Phase 7B exit criteria are scoped to prerequisite infrastructure: the minimal runtime ledger mirror/projection, data-readiness validator, reporting-first research gates, complete structural denominator coverage reporting, explicit-input DSR advisory path, and exit-readiness reporter. Broad SQLite orchestration authority is deferred beyond Phase 7B. PBO/CPCV/White deterministic designs and any hard statistical promotion policy are explicitly deferred to Phase 7C, so they are not Phase 7B exit blockers.

- [x] worker-launched WFA attempts are represented in SQLite and projected into existing JSON artifacts without conflicting state authority; completed and blocked WFA-worker attempts are covered, and broader SQLite orchestration authority is deferred beyond Phase 7B
- [x] trial attempts include completed, failed, blocked, timed-out, LLM-generated, manual, optimizer, mutation, repair, and rerun attempts where applicable for Phase 7B reporting; worker-launched WFA attempts are emitted, hash-backed, mirrored, and consumed by advisory reports only when their `trial_attempt_record` SHA and row identity verify, separate `wfa_optimizer_trials` artifacts are counted when emitted and hash-verified, `optimizer_search_context_v1` artifacts can represent optimizer search-space and trial-count context when emitted and hash/identity-verified, `non_worker_denominator_attempts_v1` artifacts can represent LLM/manual/mutation/repair/rerun attempts when emitted and hash/identity-verified, `multiple_comparison_context_v1` artifacts can represent multiple-testing correction context when emitted and hash/identity-verified, and `search_denominator` can mark structural completeness when every source is accepted; richer denominator policy for hard statistics moves to Phase 7C
- [x] one minimal crypto data-readiness artifact can be produced or blocked with exact diagnostics through helper, CLI, or explicit refresh request, and deterministic WFA-ready plans can consume the manifest or block before launch with exact invalid/stale diagnostics
- [x] basic anti-overfit fields are reported from real worker metrics, parsed WFA artifacts, identity-validated consumed worker trial-attempt records, emitted optimizer-trial artifact row counts, emitted optimizer-search context, emitted non-worker denominator rows, emitted multiple-comparison context, and explicit-input DSR by the advisory reporter; PBO/CPCV/White and hard statistical promotion are Phase 7C work
- [x] no broad ResearchBrain, native MQL5 expansion, portfolio optimizer, source warehouse, or live/deployment work is introduced by this phase

### Phase 7C - Advisory Anti-Overfit Statistical Consumers `[x]`

Status, 2026-05-16 closeout, amended 2026-05-17: Phase 7C is closed as the advisory-consumer statistical validation scope only. PBO, CPCV, and White Reality Check now have deterministic explicit-input contracts, hash-backed artifact readers, advisory computations, fixtures, fail-loud adversarial tests, and `research_wfa_gate_report_v1` wiring. The closeout artifact `factory/verification/phase7c-exit-readiness-20260516T161614Z.json` reports `status: "ready_to_close"`, with 6 criteria met, 0 pending, and 1 deferred item: deterministic statistical input producers are not part of this advisory-consumer closeout. Phase 7C itself does not enable hard statistical promotion, broaden SQLite authority, build a broad source warehouse, or start MT5/FTMO/live/deployment work. The 2026-05-17 post-closeout amendment below separately opens Phase 8A-8D as non-deployment readiness work.

Historical start note, 2026-05-15: started with the first narrow PBO advisory scaffold. Phase 7C exists because PBO, CPCV, White Reality Check, and any hard statistical promotion authority need careful deterministic design rather than being rushed into Phase 7B. Phase 7B produced the prerequisite denominator/readiness/gate-reporting infrastructure and explicit-input advisory DSR; Phase 7C owns the remaining statistical validation subsystem.

PBO design slice, 2026-05-15:

- PBO is reporting-only and cannot promote, reject, or hard-block a candidate.
- `research_wfa_gate_report_v1.statistical_tests.pbo` returns `disabled_advisory` when not requested, `blocked_insufficient_inputs` when requested inputs are missing or invalid, and `computed_advisory` only when every required input is explicit and hash-backed.
- Required PBO input contract: `schema_version: "pbo_input_matrix_v1"`, canonical candidate/lineage/family IDs, canonical `split_ids` array, explicit canonical trial identifiers, canonical `is` and `oos` performance arrays per row, explicit objective metric as a simple identifier and exact objective direction (`maximize` or `minimize`), canonical integer `trial_count`, structurally complete search denominator, and exactly one hash-verified `pbo_input_matrix` source artifact record for the matrix and split definitions.
- Fail-loud blockers include missing or non-array source artifacts, malformed source artifact path/SHA/hash-verification fields, multiple source artifacts, missing/wrong source artifact type, unverified/hash-mismatched source records, missing/non-object objective, missing/invalid objective metric or direction, missing/non-array performance matrix, missing/malformed/whitespace-padded trial IDs, missing/non-array canonical `is` or `oos` row arrays, forbidden `train`/`test` row aliases even beside canonical `is`/`oos`, missing/non-array `split_ids`, forbidden top-level `splits` or `strategy_count` aliases even beside canonical fields, whitespace-padded or malformed/non-canonical split IDs, missing canonical numeric `trial_count`, malformed or non-numeric matrix rows including numeric strings, duplicate split IDs, duplicate trial IDs, split-length mismatches, non-integer trial counts, candidate/lineage/family identity mismatch or malformed identity fields with explicit diagnostics even when expected identity is absent/null, matrix-row/trial-count mismatch, and incomplete search denominator.
- Initial deterministic advisory statistic: for each split, select the best IS/train trial, rank that same trial by OOS/test performance across all trials for the split, compute the logit rank, and report probability of backtest overfit as the fraction of split logits below zero. This is an explicit-input scaffold, not a full CSCV/CPCV subsystem.
- PBO split results report explicit direction-safe OOS ranks as `oos_rank_worst_to_best` and `oos_rank_best_to_worst`; legacy `oos_rank_ascending` is retained only for existing report consumers and should not be treated as semantically correct for `minimize` objectives.
- The candidate research-gate reporter can now consume one hash-backed `pbo_input_matrix` JSON artifact from the execution result artifact list and wire it into the same advisory PBO path. The artifact itself is the hash-verified source for the matrix/split input; missing, outside-repo, unhash-backed, hash-mismatched, oversized, unparsable, malformed, or identity-mismatched inputs fail closed as `blocked_insufficient_inputs`.
- Multiple `pbo_input_matrix` artifacts are treated as ambiguous evidence and fail closed rather than silently selecting a first artifact.
- A compact fixture body exists at `tests/fixtures/statistics/pbo-input-matrix-v1.example.json`; tests consume it through the real hash-backed artifact path and assert stable advisory output fields. The fixture body intentionally omits embedded `source_artifacts` because the candidate research-gate artifact reader injects the verified artifact record after hashing the file.
- PBO `known_limits` now explicitly states that the value is advisory only, depends on an explicit hash-backed IS/OOS matrix, does not prove unbiased CPCV/CSCV matrix construction, and does not replace future CPCV or White Reality Check advisory statistics.
- CPCV design slice, 2026-05-16: `research_wfa_gate_report_v1.statistical_tests.cpcv` now supports `disabled_advisory`, `blocked_insufficient_inputs`, and `computed_advisory` only; `enabled_as_promotion_gate` remains false. Required CPCV input contract: `schema_version: "cpcv_input_matrix_v1"`, canonical candidate/lineage/family IDs, explicit objective metric/direction, canonical integer `fold_count`, canonical integer `combination_count`, explicit numeric `benchmark_performance`, canonical `combinations` rows with unique `combination_id`, non-empty canonical `train_group_ids` and `test_group_ids`, no train/test group overlap, numeric `oos_performance`, non-negative integer `trade_count`, structurally complete search denominator, and exactly one hash-verified `cpcv_input_matrix` source artifact. The initial deterministic advisory statistic summarizes explicit combination-level OOS results only: mean/median/min/max OOS performance, benchmark pass count/rate using direction-aware comparison, total trade count, and per-combination benchmark pass flags. It does not generate purged/embargoed splits, does not prove supplied splits are unbiased, and cannot promote, reject, or deploy a candidate.
- The candidate research-gate reporter can consume one hash-backed `cpcv_input_matrix` JSON artifact from the execution result artifact list and wire it into the advisory CPCV path. Missing, outside-repo, unhash-backed, hash-mismatched, oversized, unparsable, malformed, identity-mismatched, denominator-incomplete, or multiple `cpcv_input_matrix` artifacts fail closed as `blocked_insufficient_inputs` with exact diagnostics.
- A compact fixture body exists at `tests/fixtures/statistics/cpcv-input-matrix-v1.example.json`; tests consume it through the real hash-backed artifact path and assert stable advisory output fields. The fixture body intentionally omits embedded `source_artifacts` because the candidate research-gate artifact reader injects the verified artifact record after hashing the file.
- White Reality Check design slice, 2026-05-16: `research_wfa_gate_report_v1.statistical_tests.white_reality_check` now supports `disabled_advisory`, `blocked_insufficient_inputs`, and `computed_advisory` only; `enabled_as_promotion_gate` remains false. Required input contract: `schema_version: "white_reality_check_input_v1"`, canonical candidate/lineage/family IDs, explicit objective metric/direction, explicit numeric `benchmark_performance`, explicit numeric `observed_best_performance`, canonical integer `trial_count`, explicit numeric `null_distribution` samples, explicit `null_assumption` object with method, explicit `source_metadata` object with generator, structurally complete search denominator, and exactly one hash-verified `white_reality_check_input` source artifact. The initial deterministic advisory statistic computes a simple supplied-null tail-frequency p-value: for maximize objectives, null samples greater than or equal to observed best; for minimize objectives, null samples less than or equal to observed best. It does not generate bootstrap samples, does not prove null/bootstrap validity, and cannot promote, reject, or deploy a candidate.
- The candidate research-gate reporter can consume one hash-backed `white_reality_check_input` JSON artifact from the execution result artifact list and wire it into the advisory White path. Missing, outside-repo, unhash-backed, hash-mismatched, oversized, unparsable, malformed, identity-mismatched, denominator-incomplete, or multiple `white_reality_check_input` artifacts fail closed as `blocked_insufficient_inputs` with exact diagnostics.
- A compact fixture body exists at `tests/fixtures/statistics/white-reality-check-input-v1.example.json`; tests consume it through the real hash-backed artifact path and assert stable advisory output fields. The fixture body intentionally omits embedded `source_artifacts` because the candidate research-gate artifact reader injects the verified artifact record after hashing the file.
- Hard statistical promotion authority remains explicitly disabled.
- Phase 7C closeout/readiness slice, 2026-05-16: `src/core/phase7c-exit-readiness.mjs` and `scripts/run-phase7c-exit-readiness.mjs` report whether the advisory PBO/CPCV/White consumers, fixtures, adversarial coverage, and no-hard-gate authority constraints are present. The readiness artifact treats deterministic statistical input producers as deferred, not as Phase 7C advisory-consumer blockers. It does not broaden SQLite authority, start MT5/FTMO/live work, or enable hard statistical promotion.

Objective:

- make the factory harder to fool by overfit strategy results without introducing false confidence from poorly specified statistics

Primary work:

- design deterministic input contracts for PBO, CPCV, and White Reality Check, including required return matrices, split definitions, trial denominators, benchmark/null assumptions, and hash-backed source artifacts
- implement PBO first because it directly estimates overfit probability from train/test performance degradation across trials or splits
- implement CPCV next because it strengthens train/test split robustness checks and can provide inputs for PBO-style diagnostics
- implement White Reality Check last because it is most sensitive to complete multiple-strategy/trial accounting and null/bootstrap assumptions
- keep all outputs advisory until fixtures, adversarial tests, and interpretation policy are validated
- only consider hard promotion authority after the statistical tests are deterministic, artifact-backed, and empirically validated against known examples

Mandatory tests:

- PBO/CPCV/White block with exact diagnostics when required hash-backed inputs are missing
- malformed split matrices, mismatched candidate/family/lineage IDs, incomplete denominators, and hash mismatches fail closed
- fixture examples produce stable deterministic outputs with bounded numerical tolerances
- advisory outputs are included in `research_wfa_gate_report_v1` evidence paths without becoming promotion gates
- hard promotion remains impossible unless a later spec amendment explicitly enables it

Exit criteria:

- PBO, CPCV, and White Reality Check each have a deterministic design note or schema section, focused implementation, and adversarial tests
- reports distinguish `computed_advisory`, `blocked_insufficient_inputs`, and `disabled_advisory` without inventing confidence
- no strategy is automatically promoted or rejected solely by these statistics until hard-promotion policy is separately approved

Post-closeout scope boundary, 2026-05-17 amended:

- deterministic PBO/CPCV/White input producers remain deferred and require an explicit future spec amendment or user request
- hard DSR/PBO/CPCV/White promotion gates remain disabled and require a separate explicit promotion-policy amendment
- the readiness reporter is a structural closeout artifact only, not statistical proof of a candidate or strategy
- Phase 8A-8D may proceed as non-deployment research-factory readiness work: MT5 tradable-universe enumeration, bounded ResearchBrain, Python WFA hardening, and hypothesis-led candidate screening
- Phase 8E MT5 Strategy Tester parity remains blocked without a Phase 8D survivor, verified MT5 instrument equivalence, and explicit operator authorization
- Phase 9 forward/demo safety, Phase 10 scale-out, broad SQLite orchestration authority, source warehouse, portfolio optimization, and live trading remain blocked

Post-Phase-7C next-scope decision gate, 2026-05-17:

- Current explicit implementation checklist status: Phase 7A, Phase 7B, and Phase 7C advisory-consumer scope are closed; the old Phase 7A-7C Immediate Next Work items are complete.
- The next numbered phase is Phase 8 Strategy Factory Production Readiness.
- The correct next action is Phase 8A, not native MQL5 work, broad crypto expansion, hard statistical gates, or live/forward work.
- The verification note `factory/verification/post-phase7c-next-scope-20260516T173500Z.json` remains historical evidence of the pre-amendment blocked state.

### Phase 8 - Strategy Factory Production Readiness `[x]`

Status, 2026-06-24: in progress. Phase 8A-8D are closed with disk-backed exit-readiness artifacts; Phase 8E remains not started and gated on a Phase 8D survivor plus explicit operator authorization. Phase 8 is restructured from stale native-MQL5-first wording into a five-part dependency chain. Phase 8A-8D are research-factory readiness work. Phase 8E is deployment-proximate tester/parity work.

The order is intentional. The target MT5 universe constrains ResearchBrain. ResearchBrain produces source-backed hypotheses. WFA hardening makes screening credible. Candidate screening is pre-registered and denominator-tracked. MT5 Strategy Tester parity comes only after a survivor.

Current implementation reality, updated 2026-06-24:

- Phase 7A deterministic WFA worker is closed as execution-truth infrastructure, not as profitable-strategy evidence
- Phase 7B runtime ledger/data-readiness/advisory-gate work is closed as scoped prerequisite infrastructure; broad SQLite orchestration authority is not open
- Phase 7C advisory PBO/CPCV/White consumers are closed as advisory-only; deterministic statistical input producers and hard statistical promotion gates are still deferred
- Phase 8A is closed as MT5/FTMO tradable-universe and data-alignment readiness, with real FTMO universe, terminal inventory, priority history probes, and data-relevance artifacts recorded as non-authoritative inventory
- Phase 8B is closed; deterministic Stage-0 contracts, validators, retrieval/indexing, request preparation, runtime seam, fixture/file/scripted providers, non-live scripted tool-loop plumbing, and a real source-backed live canary consumed by Ideator by path/hash are all verified
- Phase 8C is closed as scoped WFA/evidence-safety hardening; Phase 8D is closed as bounded hypothesis-led screening-pipeline validation with zero survivors accepted; the WFA plan compiler and role prompts enforce hypothesis packets and Phase 8D survivor floors
- Phase 8E must not begin from Python-only evidence; it requires a Phase 8D survivor, verified MT5 equivalence, and explicit operator authorization

#### Phase 8A - MT5 Tradable Universe And Data Alignment `[x]`

Status, 2026-05-19 explicit closeout: Phase 8A is closed as MT5/FTMO tradable-universe and data-alignment readiness only; Phase 8B/8C/8D are now closed (see below), Phase 8E remains not started. Deterministic exit-readiness artifact `factory/verification/phase8a-exit-readiness-20260519T203458Z.json` reports `status: "ready_to_close"`, 8 criteria met, 0 pending, 0 deferred. Evidence cited by the report: real FTMO universe snapshot `factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json` with 167 symbols and SHA-256 `545936404616ca3c00fd294861815cf53120367bc8c75f3ee2b6041a8ccac9ea`; terminal-path crypto/multi-asset inventory `factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json` with 43 FX, 14 index CFDs, 9 metal CFDs, 4 energy/commodity CFDs, 7 agriculture CFDs, 58 stock CFDs, 31 crypto CFDs, and 1 other/custom; current repo data relevance `factory/mt5/data-relevance/DATA-RELEVANCE-CURRENT-REPO-20260519T081345Z/classification.json` with 7/7 `non_mt5_research_only`; priority broker-history manifest `factory/mt5/history-availability/MT5-HISTORY-AVAILABILITY-PRIORITY-20260519T081345Z-WFA-VENV/manifest.json` with 6/6 H1/5000 probes available and 0 blocked; non-authoritative registration `factory/mt5/artifact-registration/PHASE8A-MT5-MULTI-ASSET-HISTORY-20260519T081345Z-WFA-VENV/registration.json`. No external data was marked `mt5_verified`; no official evidence/state mutation was performed; no ResearchBrain, WFA hardening, screening, tester parity, or deployment work was started.

Status, 2026-05-19 WFA-venv diagnostic and live universe retry: selected the canonical Windows WFA venv at `walk forward engine/.venv/Scripts/python.exe` as the intended MT5 Python environment because the MT5 terminal integration is Windows-bound, WSL `python3` cannot access the Windows terminal directly, and PATH `python.exe` points to a Hermes venv without `pip`. A global/uv-managed Windows Python install attempt was not forced after `pip` rejected it as externally managed. The scoped WFA venv already had `MetaTrader5 5.0.45` installed, verified by `walk forward engine/.venv/Scripts/python.exe -c "import MetaTrader5"`; no credentials were read or persisted. New diagnostic request `factory/mt5/environment/MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-20260519T080431Z-WFA-VENV/request.json` produced ready diagnostic `factory/mt5/environment/MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-20260519T080431Z-WFA-VENV/python-environment-diagnostic.json` with 1/4 commands available: WFA venv Python available with `MetaTrader5 5.0.45`, while WSL `python3`, PATH `python.exe`, and `py.exe -3` remain missing the package. The diagnostic was registered as non-authoritative Phase 8A inventory at `factory/mt5/artifact-registration/MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-20260519T080431Z-WFA-VENV/registration.json` from request `factory/mt5/artifact-registration/MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-20260519T080431Z-WFA-VENV/request.json`; official evidence/state remains untouched. A real all-symbol FTMO universe retry using `walk forward engine/.venv/Scripts/python.exe`, approved terminal path `C:\Program Files\FTMO Global Markets MT5 Terminal\terminal64.exe`, and `universe_scope: all_symbols` created blocked universe evidence at `factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T080431Z-WFA-VENV/blocked-universe-snapshot.json`: the package import succeeded, but `MetaTrader5.initialize()` returned `-6 Terminal: Authorization failed` with `password_env_provided: false`. That blocked universe artifact was registered at `factory/mt5/artifact-registration/JOB-MT5-UNIVERSE-ATTEMPT-20260519T080431Z-WFA-VENV/registration.json`. Phase 8A remains open: the package blocker is resolved for the canonical WFA venv path, but the real FTMO MT5 tradable-universe snapshot is still blocked until terminal/account authorization is available through the approved terminal/session or env-password path.

Status, 2026-05-18 Python-environment diagnostic slice: added deterministic `mt5_python_environment_diagnostic_v1` support through `src/core/mt5-environment-diagnostic.mjs`, CLI `scripts/run-mt5-python-environment-diagnostic.mjs`, and npm script `mt5:python-diagnostic`. The helper attempts `import MetaTrader5` through configured Python commands, writes stdout/stderr plus a diagnostic artifact under `factory/mt5/environment/`, never installs packages, never reads credentials, and keeps `official_evidence_index_mutated: false`. Live artifact `factory/mt5/environment/MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-20260518193805/blocked-python-environment-diagnostic.json` confirms `python3`, `python.exe`, and `py.exe -3` all return `ModuleNotFoundError: No module named 'MetaTrader5'`; Phase 8A remains blocked on a real FTMO MT5 tradable-universe snapshot until this environment issue is resolved externally.

Status, 2026-05-18 diagnostic-registration slice: Phase 8A artifact registration now accepts `mt5_python_environment_diagnostic` artifacts, validates them with the diagnostic schema, and includes `diagnostic_id` plus diagnostic status summaries in non-authoritative registration manifests. This keeps the current `MetaTrader5` package blocker inventoryable without mutating `factory/evidence/index.json` or starting Phase 8B. Focused data-readiness tests now cover 42/42 cases.

Status, 2026-05-18 diagnostic-consistency/live-registration slice: `mt5_python_environment_diagnostic_v1` validation now enforces `installation_attempted: false`, exact package identity, status-summary consistency, stdout/stderr artifact hashes, and `stdout_sha256`/`stderr_sha256` self-consistency. Phase 8A registration has CLI-level fixture coverage for diagnostic artifacts. The live blocked diagnostic was registered as non-authoritative inventory at `factory/mt5/artifact-registration/MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-20260518193805/registration.json` from request `factory/mt5/artifact-registration/MT5-PYTHON-ENVIRONMENT-DIAGNOSTIC-20260518193805/request.json`; official evidence/state remains untouched.

Status, 2026-05-18 registration-hardening slice: `phase8a_mt5_artifact_registration_v1` now records explicit ready/blocked status summaries, validates registered artifact paths as safe repo-relative paths with valid SHA-256 hashes, and fails loud if Phase 8B/ResearchBrain artifact kinds such as `hypothesis_packet_v1`, `research_source_record_v1`, `research_digest_v1`, or `research_ideation_manifest_v1` are included. Focused data-readiness tests now cover 38/38 cases.

Status, 2026-05-19 FIRST REAL FTMO UNIVERSE SNAPSHOT: the real all-symbol FTMO MT5 tradable-universe snapshot succeeded using credentials provided via `TRF_MT5_PASSWORD` env var (never persisted to disk), `walk forward engine/.venv/Scripts/python.exe` (MetaTrader5 5.0.45), approved terminal path `C:\Program Files\FTMO Global Markets MT5 Terminal\terminal64.exe`, login `1513441249`, server `FTMO-Demo`, and `universe_scope: all_symbols`. Succeeded snapshot artifact at `factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json` (SHA-256 `545936404616ca3c00fd294861815cf53120367bc8c75f3ee2b6041a8ccac9ea`, 629 KB). Terminal: FTMO Global Markets MT5 Terminal build 5833, company FTMO Global Markets Ltd. 167 symbols: 36 crypto_like, 58 stock_like, 45 fx_like, 13 index_like, 10 metal_like, 4 energy_like, 1 unknown. Crypto-like classification uses a keyword heuristic on symbol metadata and includes some false-positive FX pairs (e.g. USDCHF, USDCAD miscategorized via substring matching); all classifications are marked `classification_is_tradability_proof: false` and `basis: heuristic_terminal_metadata_keyword_match`. Registered as non-authoritative inventory at `factory/mt5/artifact-registration/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/registration.json`; official evidence/state remains untouched. This is the first real terminal-backed FTMO universe artifact — the Phase 8A exit criterion for a real universe snapshot is met.

Status, 2026-05-19 terminal-path crypto inventory and current-data relevance slice: derived exact terminal-path inventory from the real snapshot in `factory/mt5/universe-analysis/FTMO-UNIVERSE-SUMMARY-20260519T081345Z-WFA-VENV/summary.json`. The summary records 31 crypto CFDs by terminal path group (`Crypto I CFD` / `Crypto II CFD`) and documents 5 keyword-heuristic `crypto_like` false positives (`USDCHF`, `USDCAD`, `USDCZK`, `USDCNH`, `N25.cash`), so data expansion should use terminal path/spec evidence rather than `crypto_like` alone. It also records Phase 8A roadmap constraints: Binance/exchange symbols remain discovery/proxy until instrument-equivalence evidence exists, current Binance USDT datasets do not become MT5-bound by name similarity to BTCUSD/ETHUSD/SOLUSD/BNBUSD, and Polymarket remains out of MT5/FTMO/MQL5 scope. Current repo research instruments were enumerated in `factory/mt5/data-relevance/CURRENT-REPO-RESEARCH-INSTRUMENTS-20260519T081345Z/research-instruments.json` and classified against the real universe via `factory/mt5/data-relevance/DATA-RELEVANCE-CURRENT-REPO-20260519T081345Z/classification.json`: 7 total, 0 `mt5_verified`, 0 `mt5_proxy`, 7 `non_mt5_research_only`. The classification was registered as non-authoritative Phase 8A inventory at `factory/mt5/artifact-registration/DATA-RELEVANCE-CURRENT-REPO-20260519T081345Z/registration.json`; official evidence/state remains untouched. This satisfies the Phase 8A data-roadmap direction: no current in-repo research dataset may advance as MT5-bound evidence without later `mt5_instrument_equivalence`.

Status, 2026-05-18 first slices: minimal disk-backed `mt5_tradable_universe_snapshot_v1` foundation is implemented, not closed. The existing MT5 snapshot worker now supports explicit `snapshotMode: "universe"` / evidence kind `mt5_tradable_universe_snapshot`, writes request/stdout/stderr/universe snapshot/worker-result/execution-result artifacts under `factory/mt5/environment/<job>/`, preserves password env-only handling, requires explicit `universe_scope`, and records either an explicit `symbols_get` filter pattern or `"no filter used"`. The Python probe has an explicit universe path using `MetaTrader5.symbols_get()` plus fixture-symbol support for tests; unavailable live MT5/package/auth returns blocked diagnostics instead of fake artifacts. Validators and prompt policy recognize the new evidence kind. Per-symbol classification is generalized as heuristic `asset_class_hints` for all symbols; crypto-like is only one subset count, not the universe scope or strategy constraint. Focused fixture tests cover succeeded and blocked universe snapshots. First real snapshot attempt `JOB-MT5-UNIVERSE-ATTEMPT-20260518` produced blocked disk-backed evidence because `python3` in WSL lacks the `MetaTrader5` package; `python.exe` and `py.exe -3` are also missing `MetaTrader5`. Artifact path: `factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260518/blocked-universe-snapshot.json`. A narrow deterministic `data_relevance_classification_v1` builder/validator now classifies research data rows against a supplied MT5 universe snapshot as `mt5_verified` only when terminal symbol evidence exists; unmatched rows become `non_mt5_research_only`. The second slice adds `data_relevance_classification_request_v1`, `writeDataRelevanceClassificationFromRequest`, and CLI `scripts/run-mt5-data-relevance-classification.mjs` / `npm run mt5:data-relevance` to read a repo-relative non-blocked universe snapshot plus inline or file-backed research instruments, write hash-backed classification artifacts under `factory/mt5/data-relevance/<classification_id>/`, fail loud on missing/blocked/non-`mt5_tradable_universe_snapshot_v1` inputs, and remain fixture-testable without live MT5. The third slice adds `mt5_history_availability_request_v1`, `broker_history_export_manifest_v1` writer/validator, and CLI `scripts/run-mt5-history-availability-manifest.mjs` / `npm run mt5:history-availability` to consume a hash-backed non-blocked universe snapshot plus explicit MT5 symbol snapshot artifacts, record available or blocked bar-history status per symbol/timeframe, reject snapshots outside the supplied universe, and remain fixture-testable without live MT5. The fourth slice adds `mt5_instrument_equivalence_request_v1`, `mt5_instrument_equivalence_v1` writer/validator, and CLI `scripts/run-mt5-instrument-equivalence.mjs` / `npm run mt5:instrument-equivalence` to combine data relevance classification, hash-backed source data-readiness manifests, and optional broker history manifests into explicit MT5/external mapping rows with terminal symbol evidence, source data identity, known unresolved differences, and a no-promotion parity warning. Remaining Phase 8A work: run a real FTMO terminal snapshot with a working Windows MT5 Python environment, index the real artifact into factory evidence/state, use real symbol snapshots to produce broker history availability/export manifests, and run the equivalence writer on real data artifacts.

Status, 2026-05-19 multi-asset terminal inventory and priority history probe slice: added deterministic Phase 8A terminal-inventory support through `src/core/mt5-terminal-inventory.mjs`, CLI `scripts/run-mt5-terminal-inventory.mjs`, npm script `mt5:terminal-inventory`, registration support, and focused tests. Derived full multi-asset inventory from the real FTMO snapshot at `factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json` from request `factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/request.json`: 167 symbols; terminal asset classes: 43 FX, 14 index CFDs, 9 metal CFDs, 4 energy/commodity CFDs, 7 agriculture CFDs, 58 stock CFDs, 31 crypto CFDs, 1 other/custom; 13 visible, 25 selected. The inventory records all symbols from terminal path/spec evidence and a deterministic cross-asset H1/5000-bar priority probe list: `EURUSD`, `US100.cash`, `XAUUSD`, `USOIL.cash`, `AAPL`, `BTCUSD`. Real MT5 history probes succeeded for all six using the WFA venv and env-only credentials, producing `mt5_snapshot` artifacts under `factory/mt5/environment/JOB-MT5-HISTORY-PROBE-20260519T081345Z-*/snapshot.json`. History availability manifest `factory/mt5/history-availability/MT5-HISTORY-AVAILABILITY-PRIORITY-20260519T081345Z-WFA-VENV/manifest.json` from request `factory/mt5/history-availability/MT5-HISTORY-AVAILABILITY-PRIORITY-20260519T081345Z-WFA-VENV/request.json` reports 6 total, 6 available, 0 blocked. H1 coverage starts: `EURUSD` 2025-07-29, `US100.cash` 2025-07-15, `XAUUSD` 2025-07-15, `USOIL.cash` 2025-07-14, `AAPL` 2023-07-11, `BTCUSD` 2025-10-17; all returned 5000 bars. Registered as non-authoritative Phase 8A inventory at `factory/mt5/artifact-registration/PHASE8A-MT5-MULTI-ASSET-HISTORY-20260519T081345Z-WFA-VENV/registration.json` from request `factory/mt5/artifact-registration/PHASE8A-MT5-MULTI-ASSET-HISTORY-20260519T081345Z-WFA-VENV/request.json`; official evidence/state remains untouched. This remains Phase 8A only: no ResearchBrain, WFA hardening, candidate screening, instrument-equivalence promotion, tester parity, or `mt5_verified` external-data claim was started.

Objective:

- determine which instruments are actually relevant for MT5/FTMO-bound research before expanding external crypto data or candidate work

Primary work:

- extend the MT5 snapshot path or add a narrow universe snapshot worker to enumerate available FTMO MT5 symbols
- capture exact symbol names, symbol specs, contract details, tick/point/digits, volume min/max/step, trade mode, margin fields, swap fields, spread observations, and sessions/trading hours where available
- capture tick/bar history availability by symbol/timeframe where feasible
- add broker-history export or MT5 history ingestion for verified symbols where possible
- classify every research instrument as `mt5_verified`, `mt5_proxy`, or `non_mt5_research_only`
- mark Binance/exchange-only data as discovery/proxy unless MT5 equivalence is verified
- treat current in-repo crypto data as insufficient for new MT5-bound claims until refreshed or replaced; the Phase 8 scope audit found four crypto symbols, 1h only, stale to Mar/Apr 2026, BTC starting in 2021, and no live Python OHLCV fetcher

Candidate artifacts:

- `mt5_tradable_universe_snapshot_v1`
- `mt5_symbol_spec_v1`
- `mt5_instrument_equivalence_v1`
- `broker_history_export_manifest_v1`
- `data_relevance_classification`

Minimum `mt5_tradable_universe_snapshot_v1` fields:

- `schema_version`, `job_id`, `observed_at`, `terminal_path`, `terminal_build`, `account_login_hash_or_id`, `server`, and `company` where available
- `symbol_count_total`, `symbol_count_crypto_like`, `symbol_count_by_asset_class_guess`, `symbols[]`, and the exact enumeration filter or lack of filter
- per-symbol exact terminal `name`, `path`, `description`, `currency_base`, `currency_profit`, `currency_margin`, `digits`, `point`, `trade_mode`, `trade_contract_size`, `volume_min`, `volume_max`, `volume_step`, `tick_size`, `tick_value`, `spread`, `swap_long`, `swap_short`, margin fields where available, session/trading-hour fields where available, and history availability probes where feasible
- per-symbol `asset_class_hints.asset_class_guess` must be marked heuristic unless the terminal/symbol metadata directly proves the class; crypto-like is only one possible hint, and all broker-supported symbols remain eligible for later research if MT5 equivalence, data, WFA, and parity gates are satisfied
- `stdout_path`, `stderr_path`, source hashes, artifact hash, and blocked diagnostics for any unavailable field

Minimum `mt5_instrument_equivalence_v1` fields:

- exact MT5 terminal symbol, external source symbol, source data identity, mapping basis, known differences in quote basis/session/spread/cost/funding/swap/contract size, snapshot artifact path/hash, and classification as `mt5_verified`, `mt5_proxy`, or `non_mt5_research_only`
- `mt5_verified` requires real terminal symbol/spec evidence; public web symbol tables or exchange naming similarity are insufficient

Required operator inputs for Phase 8A:

- explicit MT5 terminal path or default approved terminal path
- account/server context sufficient to know the connected broker environment
- password only via approved environment variable; never persist credentials
- an explicit universe scope such as all symbols, crypto-like symbols, or a transparent filter expression; if no filter is used, record that no filter was used

Exit criteria:

- a real FTMO MT5 tradable-universe snapshot exists as disk-backed evidence
- available crypto CFDs are listed with exact terminal symbol names and specs, or absence is recorded explicitly
- data expansion roadmap is filtered by MT5 relevance
- no MT5-bound candidate advances without `mt5_instrument_equivalence` evidence

#### Phase 8B - Bounded ResearchBrain And Knowledge System `[x]`

Status, 2026-05-20 first bounded contract slice started: added deterministic Stage-0 ResearchBrain artifact validators for `researchbrain_request_v1`, `research_source_record_v1`, `hypothesis_packet_v1`, `research_digest_v1`, and `research_ideation_manifest_v1`. The slice is schema/validator-only: no live ResearchBrain execution, no WFA hardening/screening/tester-parity work, no strategy edge/profitability labels, and no official state/evidence mutation. Validators require Stage-0 authority, Phase 8A MT5 universe path/hash constraints, source-record path/hash references, novelty/disconfirming fields, and fail loud on official-state mutation, deterministic-worker bypass, promotion/profitability fields, or `mt5_verified` claims without `mt5_instrument_equivalence` path/hash evidence. Central execution validation recognizes `stage0_research_discovery` as non-executable discovery evidence so it cannot be accepted as WFA/MT5 execution evidence.

Status, 2026-05-20 retrieval/index slice: `rebuildNormalizedMemory()` now validates and indexes structured ResearchBrain JSON artifacts under `factory/research/` into the derived retrieval index as `research_source_record`, `research_hypothesis_packet`, `research_digest`, and `research_ideation_manifest` entries with artifact SHA-256, source paths, related source/hypothesis paths, and Phase 8A universe constraint paths. Ideator retrieval now exposes compact Stage-0 hypothesis/source packets by path/hash, and Planner retrieval scores Stage-0 hypothesis packets against backlog scope. This remains derived retrieval support only: it does not mutate official evidence/backlog/leaderboard authority, does not execute ResearchBrain, and does not start Phase 8C/8D/8E.

Status, 2026-05-20 Ideator/Planner provenance slice: Ideator and Planner prompts now include explicit Stage-0 ResearchBrain consumption rules. If Ideator derives a backlog item from a Stage-0 hypothesis packet, it must set `source: "researchbrain_stage0"` and include `hypothesis_packet_path`, `hypothesis_packet_sha256`, and `source_record_refs`; Planner is instructed to carry those path/hash references into auditable plan provenance. The orchestrator preserves those fields for auto-generated backlog items and validates ResearchBrain-derived backlog candidates before append, while rejecting any attempt to use `stage0_research_discovery` as executable `evidence_kind`. This still does not run ResearchBrain or mutate official state directly from ResearchBrain.

Status, 2026-05-20 deterministic manifest/provenance hardening slice: added a bounded Stage-0 manifest builder/CLI for existing structured `factory/research/` artifacts only. It validates supported ResearchBrain source, hypothesis, digest, and ideation JSON by path/hash, writes a non-authoritative `researchbrain_stage0_manifest_v1`, and records explicit false official-state/evidence/backlog/leaderboard mutation flags; an empty/no-packet scan is blocked, not success. Planner validation now enforces that ResearchBrain-derived backlog items carry hypothesis packet and source-record path/hash references into `source_hashes`, not just prompt prose. Central execution validation rejects `stage0_research_discovery` for all executor statuses, including blocked/failed/partial/inconclusive, so Stage-0 artifacts cannot enter executable evidence paths. Tests also cover Phase 8A registration rejection and leaderboard non-promotion for Stage-0 artifacts. This remains Phase 8B bounded knowledge-system work only: no live ResearchBrain run, no WFA hardening/screening/tester-parity work, no official state/evidence mutation, and no strategy edge claim.

Status, 2026-05-20 deterministic request-preparation slice: added `researchbrain_request_v1` artifact writing support and CLI `scripts/run-researchbrain-request-writer.mjs`. The writer prepares only a bounded Stage-0 ResearchBrain request: Phase 8A universe snapshot and terminal inventory path/hash constraints, multi-asset FTMO/MT5 scope, explicit non-crypto-only / no-prediction-market boundary, source and hypothesis budgets, novelty requirement, and false official-mutation flags. It does not search the web, call an LLM, produce source records, create hypothesis packets, label profitability, mutate official state/evidence/backlog/leaderboard, or start WFA hardening/screening/tester-parity. Current request artifact: `factory/research/requests/RESEARCHBRAIN-REQUEST-20260520T0718Z/request.json`, ready as a job envelope for a later bounded ResearchBrain execution.

Status, 2026-05-20 bounded runtime/tooling slice: added a Stage-0-only ResearchBrain runtime/provider seam in `src/core/researchbrain-runtime.mjs` plus dry-run CLI `scripts/run-researchbrain-stage0-runtime.mjs`. The runtime accepts `researchbrain_request_v1`, enforces provider-call/time/output budgets, supports deterministic fixture/test-double providers, captures raw provider output, writes source captures/source records/hypothesis packets/digest/ideation manifest/Stage-0 manifest under `factory/research/`, and quarantines invalid JSON or schema/profitability failures. It explicitly records no WFA execution, no MT5 execution, no profitability labels, and no official state/evidence/backlog/leaderboard mutation. This is tooling only: live web/LLM research is not enabled, fixture output cannot prove an edge or close Phase 8B by itself, and Phase 8C and 8D are now closed; Phase 8E remains not started.

Status, 2026-05-20 runtime adapter hardening slice: added `researchbrain_stage0_runtime_result_v1` validation, a repo-local JSON-file provider adapter, and repo-local source capture by `content_path`. This lets deterministic offline provider-output fixtures exercise the same artifact-writing path as a future bounded live adapter while preserving exact raw-output/source-file hashes. The runtime validator rejects fake official mutation, WFA/MT5 execution flags, missing ready artifacts, artifact hash mismatches, and profitability/promotion fields. The CLI accepts `--provider-output <repo-relative-json>` for deterministic file-backed runs; it still does not call live APIs or mutate official control-plane files.

Status, 2026-05-20 source-fetch adapter boundary slice: added explicit source-fetch plumbing for provider outputs that reference `fetch_url`. Fetching is fail-closed by default: a `fetch_url` without an explicit source fetcher is quarantined, not executed. The runtime now supports a deterministic map/test-double fetcher for tests and a bounded HTTP fetcher that requires explicit live opt-in, host allowlist, timeout, and byte cap before any network source fetch can occur. The CLI exposes this only through `--allow-live-source-fetch`, `--source-allow-host`, `--source-timeout-ms`, and `--source-max-bytes`; no live source fetch was run in this slice. Captured source content is written under the runtime run directory and linked into `research_source_record_v1` with source-fetch metadata and hashes. This remains Stage-0 only and does not call an LLM, execute WFA/MT5, mutate official state/evidence/backlog/leaderboard, or claim a strategy edge.

Status, 2026-05-21 live-agent architecture decision: `factory/research/phase8b-researchbrain-live-agent-decision-2026-05-21.md` supersedes deterministic-prefetch-first Phase 8B interpretations. ResearchBrain should be implemented as a bounded LLM tool-using agent with a custom local tool loop, deterministic transcripts/tool ledgers/source capture/path-hash provenance/budget enforcement/quarantine, and final output converted into existing Stage-0 artifacts. The first live canary used DeepSeek via the direct DeepSeek adapter with `deepseek-v4-flash` and xhigh reasoning. Framework runtimes such as LangGraph, LangChain, OpenAI Agents SDK, MCP orchestration, or OpenCode should not own the first live ResearchBrain loop. Deterministic prefetch remains allowed only as a helper tool. This decision does not start Phase 8C/8D/8E, does not execute WFA/MT5, does not mutate official state/evidence/backlog/leaderboard, and does not claim a strategy edge.

Status, 2026-05-22 YouTube source requirement: ResearchBrain must support YouTube as a first-class Stage-0 source class because trading talks, platform walkthroughs, practitioner interviews, conference presentations, and strategy explanations may contain useful mechanism ideas. This does not mean video popularity is evidence and does not permit hallucinating video content. The tool layer must include bounded `search_youtube` and `inspect_youtube_video` capability. `search_youtube` uses official YouTube Data API search/metadata discovery. `inspect_youtube_video` must call a deterministic `youtube_ingest` wrapper, not loose agent browsing. The wrapper should fetch official metadata first, then try transcript adapters in this order: official/authorized captions when owned/authorized/available, `youtube-transcript-api` public transcript extraction with unofficial risk labeling, `yt-dlp` subtitles/autocaptions with unofficial risk labeling, optional audio transcription only with explicit opt-in, then fail closed with `transcript_unavailable`. YouTube source records must preserve video/channel metadata, URL, publication date, duration/status validation, transcript/chunk availability, transcript provider, generated/translated flags, language/original language, raw and normalized transcript or unavailable reason, timestamped chunk IDs/URLs, hashes, source trust/risk label, limitations, and disconfirming relevance. A YouTube video can support a hypothesis only through captured timestamped chunks, not through title/description/channel/popularity inference. Downloading, transcription/ASR, non-official transcript extraction, browser automation, age/geo/login bypass, or audio/video access must require explicit opt-in where allowed, budget caps, source/provenance recording, and fail-closed behavior.

Status, 2026-05-22 tool-scope assessment: `factory/research/phase8b-tool-scope-assessment-2026-05-22.md` records the active tool-scope decision. Accepted impact: the original ResearchBrain tool list remains directionally correct, but v1 should explicitly add source-class discovery for official docs, MQL5/MetaQuotes sources, and broker/FTMO docs; use canonical `capture_url_source` for URL capture; keep GitHub capture source-specific for commit/path/license provenance; and strengthen memory tools beyond `check_duplicate_memory` with `search_research_memory` and failed-pattern similarity checks. Rejected/deferred impact: do not add market-data, MT5 terminal, MQL5 compilation, WFA/backtest/optimizer, account, live/paper trading, profitability-estimation, bulk social/comment/forum, paid-news scraping, or bulk repository cloning tools to ResearchBrain v1. MQL5/forum/social capture should remain bounded source capture or explicit opt-in weak-practitioner-source handling, not uncontrolled scraping.

Status, 2026-05-22 fake/scripted agent tool-loop slice: added the first non-live bounded ResearchBrain agent implementation through `src/core/researchbrain-agent.mjs`, `src/core/researchbrain-tools.mjs`, and `src/core/researchbrain-youtube-ingest.mjs`, with runtime integration in `src/core/researchbrain-runtime.mjs` and CLI support in `scripts/run-researchbrain-stage0-runtime.mjs`. The slice implements deterministic/scripted tool execution for the v1 discovery/capture/repo-memory/write catalog, transcript/tool/cost/working-notes artifacts, URL/GitHub/YouTube source capture artifacts, read-only memory searches, failed-pattern similarity blocking, YouTube `transcript_unavailable` fail-closed behavior, and final conversion into existing Stage-0 source records/hypothesis packets/digest/ideation manifest/manifest. No live LLM, live web, live YouTube API, MT5, MQL5 compilation, WFA/backtest/optimizer, market data, trading, official state/evidence/backlog/leaderboard mutation, profitability estimate, promotion label, or strategy edge claim was introduced. Focused tests: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 21/21, `rtk node --test tests/researchbrain-agent.test.mjs` passed 10/10, `rtk npm run validate` passed, and `rtk npm run test:factory` passed 63/63. This historical pending note is superseded by the 2026-05-23 Phase 8B closeout status below.

Status, 2026-05-22 audit consolidation: `factory/research/phase8b-researchbrain-end-to-end-audit-2026-05-22.md` is folded into this active spec. Audit verification reported `node --test tests/researchbrain-artifacts.test.mjs tests/researchbrain-agent.test.mjs` passed 37/37 and `rtk npm run validate` passed. The verdict is not a live-readiness claim: the current brain is fixture/scripted, not a provider-backed live LLM researcher. The immediate safety priority is preventing fake or low-quality Stage-0 research from entering backlog through source laundering, weak memory enforcement, low-trust single-source packets, or provenance loss. The next implementation sequence is the Section 11.16B must-fix list; broad frameworks, source warehouses, market-data APIs, WFA/MT5/MQL5 tools, social crawlers, bulk repo cloning, and default audio transcription remain out of scope before the first live canary.

Status, 2026-05-22 first safety implementation after audit: first three Section 11.16B must-fix items are complete. Implemented live/fixture tool mode separation, non-empty output directory collision guard, and centralized accepted Stage-0 source/packet allowlists plus profitability alias rejection. This still does not implement a live LLM provider, live web search, live YouTube API, MT5, MQL5, WFA/backtest/optimizer, market data, trading, official state/evidence/backlog/leaderboard mutation, profitability estimate, promotion label, or strategy edge claim. Remaining before canary after the current safety slices: add the provider-agnostic live LLM seam.

Status, 2026-05-22 memory/read safety implementation after audit: `record_hypothesis` now requires actual same-run calls to `search_research_memory`, `check_duplicate_memory`, and `check_failed_pattern_similarity`; `read_repo_artifact` is restricted to approved artifact roots and denies sensitive/unrelated repo paths. Focused ResearchBrain tests passed 42/42 for this slice. No live provider, execution authority, market-data, MT5/MQL5/WFA/backtest/optimizer, trading/account, profitability, or official state/evidence/backlog/leaderboard mutation was introduced.

Status, 2026-05-22 provider identity safety implementation after audit: provider `research_run_id` identity is now enforced. Missing IDs are deterministically assigned to the runtime run id, but non-empty mismatches are quarantined before artifact acceptance. Focused ResearchBrain tests passed 43/43 for this slice. No live provider, execution authority, market-data, MT5/MQL5/WFA/backtest/optimizer, trading/account, profitability, or official state/evidence/backlog/leaderboard mutation was introduced.

Status, 2026-05-22 live-seam implementation after audit: provider-agnostic live LLM agent seam and explicit live CLI flags are implemented without a concrete network adapter or canary. The seam requires `allowLiveLlm=true`, uses injectable clients, deterministic tools, transcripts, ledgers, and existing Stage-0 validators. The CLI live mode fails closed until a concrete direct provider adapter is added. Focused ResearchBrain tests passed 45/45 for this slice. No WFA/MT5/MQL5, market-data, trading/account, profitability, official mutation, or strategy edge claim was introduced.

Status, 2026-05-22 direct provider-boundary implementation after audit: first concrete direct provider adapter boundary (OpenAI-compatible/DeepSeek) is implemented in `src/core/researchbrain-llm-providers.mjs` and wired into `scripts/run-researchbrain-stage0-runtime.mjs`. It is fail-closed by default, requires `--allow-live-llm`, supported provider/model, and API-key env presence, and is tested only with injected fake fetch responses. It does not add live source search, provider-native web evidence, WFA/MT5/MQL5, market data, trading/account, profitability, official mutation, or strategy edge claims. Focused ResearchBrain tests passed 47/47 for this slice; live canary and Ideator path/hash consumption remain pending.

Status, 2026-05-22 deterministic source-adapter boundary after audit: live tool mode can now consume injected deterministic source search/capture adapters for `search_web` and `capture_url_source` while still rejecting LLM-supplied search results/content. The adapter boundary writes hashed capture artifacts and provenance but uses fake/map tests only; no real live source adapter or canary has run. Focused ResearchBrain tests passed 49/49 for this slice; live canary and Ideator path/hash consumption remain pending.

Status, 2026-05-22 Brave source adapter boundary after audit: Brave Search API is now the first concrete source adapter boundary, env-key gated and fake-fetch tested only. The repo/spec intentionally stores only env var names, not secret values. This prepares the source side of the canary but does not run one; LLM adapter choice still needed an OpenAI-compatible or direct DeepSeek adapter for the operator-selected DeepSeek model.

Status, 2026-05-22 OpenAI-compatible LLM adapter after audit: provider `openai_compatible` is now available for env-key/base-url-gated DeepSeek/OpenCode-compatible routing. The operator must provide env values externally; this repo/spec does not store secret values. This prepares the LLM side of the canary but does not run one.

Status, 2026-05-22 Opencode DeepSeek preset after audit: CLI preset `opencode_deepseek_v4_pro` now selects the OpenAI-compatible DeepSeek V4 Pro via Opencode-compatible env path. It is convenience wiring only and still requires env values outside repo.

Status, 2026-05-23 live canary after audit: source-backed live canary succeeded with request `factory/research/requests/RESEARCHBRAIN-REQUEST-LIVE-OFI-CANARY-20260523T135000Z/request.json` sha256 `8a46e46b9cde56b47177669bdfb44a891015f8cbd1a7f635f912003beb38624b` and runtime result `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/runtime-result.json` sha256 `5bd881d858ffaacb80e14ff307fb2fd9d332763373c86728ec8cfc027e8357b9`. Accepted artifacts include deterministic source record `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/source-records/SRC-LIVE-CANARY-001.json` sha256 `197b227b9b290cc3ce8fd06a5ae4ee2300fa79f6901a4fbd4e53ccb14f90f4d5`, hypothesis packet `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/hypotheses/HYP-STAGE0-LIVE-CANARY-001.json` sha256 `a4412b1b91f24e024eda6aa51a0e9e085693e426864fb5d7bbc846f103c11af5`, ideation manifest `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/ideation-manifest.json` sha256 `58dff21ca64f4ed0aa5d03621aa820adc894df4cd753bf67f1f29a8533fac3ee`, and Stage-0 manifest `factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/manifest/manifest.json` sha256 `f267aaf3304f5c486ff5e3bd274e013545c36e52f403e25cb69fbb01b59a4a62`. This is a Stage-0-only OFI amplification hypothesis, not profitability, execution, MT5 equivalence, MQL5 parity, or promotion evidence. Official state/evidence/backlog/leaderboard were not mutated. Ideator/backlog consumption by exact packet/source path and hash is now verified by the Phase 8B closeout tests; because the only source is `low_signal_trust`, it is accepted only as requiring more research, not as WFA-ready.

Status, 2026-05-23 Phase 8B closeout after audit: the final closeout requirement is met. `validateResearchBrainBacklogCandidate()` rejects ResearchBrain-derived ideas unless they preserve exact packet path/hash, matching source-record path/hash, research run id, and Stage-0 evidence/authority labels; it also rejects prose-only invention, source-hash dropping, Stage-0 executable evidence or authority, and profitability labels. Ideator prompt rules require those fields, the orchestrator preserves them, and the WFA-ready compiler propagates packet/source hashes while blocking a single `low_signal_trust` source from direct WFA readiness. Verification: `node --test tests/researchbrain-artifacts.test.mjs tests/researchbrain-agent.test.mjs` passed 55/55, including a test over the accepted live canary packet/source refs; `node --test tests/factory.test.mjs` passed 63/63. Phase 8C and 8D are now closed; Phase 8E remains not started.

Objective:

- create a bounded discovery component that finds source-backed, falsifiable edge hypotheses and turns them into pipeline-ready artifacts

Strategic importance:

- ResearchBrain is the sole remaining LLM-powered component in an otherwise deterministic factory pipeline. Every subsequent phase after Phase 7C (WFA execution, data readiness, SQLite mirroring, advisory statistical consumers) is deterministic worker code. ResearchBrain is the edge-finding engine: it feeds Ideator, Planner, and Executor with structured discovery artifacts. Without it, the factory can validate and reject strategies but cannot autonomously discover new edge hypotheses.
- ResearchBrain WILL be built. Its contracts (Section 11.16) are fully specified. Its position in the dependency chain (after 8A MT5 universe enumeration) is fixed. This deferred-build status is a sequencing decision, not a statement about necessity.
- Building deterministic workers first (7A-7C) and the MT5 universe snapshot (8A) before ResearchBrain (8B) is intentional: ResearchBrain cannot be usefully constrained without knowing the real tradable universe, and its output cannot be consumed without the deterministic validation pipeline that verifies its hypotheses.

Primary work:

- implement the bounded ResearchBrain request/result schema from Section 11.16
- retrieve prior lessons, failed patterns, prior hypothesis packets, source records, candidate history, and comparable evidence before new ideation
- connect Ideator and Planner by artifact path/hash, not vague prose
- require novelty checks, source trust labels, disconfirming evidence, and budget limits
- include YouTube video discovery and deterministic transcript/chunk ingestion as a bounded source tool, with explicit transcript availability, timestamped chunk citations, source-risk labels, and no title-only content inference
- include official-doc, MQL5/MetaQuotes, broker/FTMO, GitHub, academic, and YouTube source-class discovery with deterministic capture before any source can support a packet
- expose read-only research-memory tools that search prior packets, source records, rejections, lessons, failed WFA summaries, and known non-tradable/data-unavailable ideas; use them to reject duplicates and parameter-only novelty, not to tune parameters from prior failures
- mark duplicates as duplicates instead of creating new backlog items
- reduce backlog noise by preventing duplicate fillers, recursive follow-up cascades, and stale infra-blocked items from becoming apparent research depth

Implementation gaps to close in Phase 8B:

- [x] live/fixture tool modes must be split so live discovery and capture cannot use LLM-injected search results or LLM-supplied source content
- [x] output directories and run ids must fail loud on collision before any live run can write artifacts
- [x] Stage-0 packet/source field allowlists and profitability alias rejection must be centralized and enforced before provider outputs can become packets
- [x] `record_hypothesis` must require actual memory, duplicate, and failed-pattern checks in the same run
- [x] `read_repo_artifact` must be restricted to approved artifact roots and deny sensitive/unrelated files
- [x] provider `research_run_id` mismatch must be overridden or rejected
- [x] only after those safety fixes, add the provider-agnostic live LLM adapter seam and run one bounded canary; seam/flags, concrete provider adapters, Brave source capture, OpenCode Go DeepSeek preset, one source-backed live canary, and Ideator packet/source path-hash consumption are done
- after canary-boundary safety, propagate ResearchBrain source hashes through the WFA-ready compiler and strengthen trust-tier/rejection retrieval gates; source-hash propagation and the single-low-signal-source gate are done, broader rejection/duplicate retrieval remains Phase 8C-adjacent follow-up

Required output artifacts:

- `hypothesis_packet_v1`
- `research_source_record_v1`
- `research_digest_v1`
- `research_ideation_manifest_v1`

Exit criteria:

- a real non-fixture live provider canary produces at least one valid source-backed `hypothesis_packet_v1` constrained by the Phase 8A MT5 universe
- every supporting source claim comes from deterministic captured source artifacts with path/hash provenance, not provider-supplied text
- the packet passes field allowlist/profitability-alias rejection and includes actual memory/duplicate/failed-pattern checks
- Ideator consumes the packet and source refs by exact path/hash instead of inventing categories from scratch
- ResearchBrain output is indexed as Stage 0 discovery only and cannot create profitability, execution, or promotion claims

#### Phase 8C - WFA Engine And Anti-Overfit Hardening `[x]`

Current status: closed as scoped WFA/evidence-safety hardening. The chronological addenda below are retained as implementation history; the closeout status, rational boundary, and exit criteria are authoritative for whether Phase 8C is complete.

Status, 2026-05-27 Phase 8C closeout/readiness: Phase 8C is closed as the bounded safety layer required before Phase 8D screening, not as a strategy-edge claim. Deterministic readiness artifact `factory/verification/phase8c-exit-readiness-20260527T094947Z.json` reports `status: "ready_to_close"`, 14 criteria total, 10 met, 0 pending, and 4 explicitly deferred. Met criteria: canonical WFA config/output-root truth; artifact-backed WFE/WFR inputs; purge-gap and diagnostic-only warmup truth; optimizer/cost truth and provenance reporting; positive-label survivor-floor enforcement; pre-registered Phase 8D WFA launch gate; advisory-stat reporting-only boundary; ResearchBrain direct-WFA source-quality gate; bounded remediation without spam; and survivor-floor prompt guardrails. Deferred as non-blocking for Phase 8D safety: physical deletion/quarantine or full wiring of inactive optimizer/cost modules, generic indicator-warmup inference, hard statistical promotion/input producers, and cost-stress or multi-objective optimizer wiring. Rationale: the concrete bypasses that would create false Phase 8D evidence are now closed or fail-loud; continuing to add deterministic checks before screening would be overengineering unless a new artifact-backed bypass appears. This closeout does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not enable hard DSR/PBO/CPCV/White promotion gates, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim any strategy edge. Phase 8B remains closed; Phase 8D is now closed; Phase 8E remains not started.

Status, 2026-05-23 first WFA config/output-truth slice: Phase 8C is started but not closed. Implemented a minimal canonical WFA YAML contract in `src/core/wfa-config-contract.mjs` and wired it into the deterministic WFA-ready compiler, worker request validation, request building, executed-evidence validation, and artifact validation. The enforced fields are limited to what `walk forward engine/scripts/walk_forward_smoke_test.py` actually indexes: `walk_forward.training_months`, `walk_forward.testing_months`, `walk_forward.step_months`, `walk_forward.n_parameter_trials`, `walk_forward.output_directory`, `data.source_file`, `strategy.profile_key`, and `performance.max_execution_time_seconds`. Canonical output root must resolve to `walk forward engine/strategies/<name>/results`; `expected_output_root` must match the YAML `walk_forward.output_directory` before worker launch and before executed evidence acceptance. The worker now records `output_root_truth` and `metric_readiness` diagnostics in `parsed-wfa-metrics.json` and observations. Missing IS Sharpe, WFE inputs, or WFR inputs are recorded as blocked/missing diagnostics with no invented `wfe`/`wfr` metrics; computed WFR/WFE values require artifact-backed input paths/hashes. This slice did not run Phase 8D screening, did not add MT5/MQL5/parity/deployment tooling, did not add market-data/optimizer/account/profitability tools, and did not claim any strategy edge. Verification: `node --test tests/wfa-config-output-truth.test.mjs` passed 4/4; `node --test tests/factory.test.mjs` passed 63/63; `node --test tests/verification.test.mjs` passed 159/159; `node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `node --test tests/researchbrain-artifacts.test.mjs` passed 29/29; `rtk npm run validate` passed.

Status, 2026-05-23 second WFA IS-metric emission slice: normal WFA results now preserve optimizer best-value training objective as `WindowResult.in_sample_sharpe`, aggregate it as `WalkForwardResults.aggregate_in_sample_sharpe`, and emit it in `walk_forward_results_*.json`, `analysis.json`, and summary CSV. `WfaResultSchema` validates emitted IS Sharpe as finite when present. This is deliberately limited to IS Sharpe because the current engine does not emit artifact-backed IS return; WFE remains blocked/missing unless both IS and OOS return inputs are present. No Phase 8D screening, no MT5/MQL5/parity/deployment tooling, no market-data/optimizer/account/profitability tools, and no strategy edge claim were introduced. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py` passed 1/1; `node --test tests/factory.test.mjs` passed 63/63; `node --test tests/verification.test.mjs` passed 159/159; `node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `node --test tests/wfa-config-output-truth.test.mjs` passed 4/4; `rtk npm run validate` passed.

Status, 2026-05-24 purge-gap guard slice: WFA config now supports optional `walk_forward.purge_gap_bars` / `WalkForwardConfig.purge_gap_bars` with default `0`, preserving existing behavior unless explicitly configured. `WFAWindowManager` applies the guard by dropping the first N validation bars after each training window before OOS testing, for rolling and anchored windows, and records `purge_gap_bars` plus `purged_validation_bars` in per-window WFA results, summary CSV, and `analysis.json` WFA config diagnostics. The JS canonical config contract rejects negative/non-integer `walk_forward.purge_gap_bars`; the worker preserves emitted purge diagnostics in parsed per-window metrics. This is a narrow purge-gap guard only: it does not claim full leakage protection for every strategy indicator implementation, does not add generic indicator warmup inference, does not compute IS return, does not run Phase 8D screening, and does not add MT5/MQL5/parity/deployment, market-data, optimizer, account, trading, or profitability tooling. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_purge_gap_bars.py` passed 2/2; `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py` passed 1/1; `node --test tests/wfa-config-output-truth.test.mjs` passed 5/5; `node --test tests/factory.test.mjs` passed 63/63; `node --test tests/verification.test.mjs` passed 159/159; `node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-24 selected-training IS-return slice: normal vectorized WFA optimization now recomputes the selected best parameters on the exact training slice after optimization and emits `in_sample_return_pct` per successful window plus `aggregate_in_sample_return_pct` in `walk_forward_results_*.json`, `analysis.json`, summary CSV, and `wfa_history.json`. The metric is emitted only when the selected-parameter training backtest reports `backtest_success: true` and a finite `total_return_pct`; otherwise IS return remains unavailable and WFE stays blocked by existing worker diagnostics. `WfaResultSchema` validates finite/plausible emitted IS return fields, and the worker preserves per-window IS return in parsed metrics. This is a narrow WFE-readiness input slice only: it does not run Phase 8D screening, does not change survivor/promotion floors, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim any strategy edge. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_return_emission.py` passed 2/2; `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py` passed 5/5; `node --test tests/wfa-config-output-truth.test.mjs` passed 5/5; `node --test tests/factory.test.mjs` passed 63/63; `node --test tests/verification.test.mjs` passed 159/159; `node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-24 WFE/WFR readiness validation slice: the worker now validates WFR readiness through the same artifact-backed availability path used for WFE, so computed WFR inputs must preserve accepted metrics artifact path/hash provenance instead of relying on detached numeric fields. Added focused tests proving WFE computes only when accepted WFA metrics include artifact-backed aggregate IS return and aggregate OOS return, WFR computes only from artifact-backed successful/total window fields, and zero aggregate IS return blocks WFE with exact diagnostics while leaving WFR computable when its inputs exist. This is diagnostic/validation hardening only: it does not run Phase 8D screening, does not add survivor/promotion floors, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 2/2; `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py` passed 5/5; `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 5/5; `rtk node --test tests/factory.test.mjs` passed 63/63; `rtk node --test tests/verification.test.mjs` passed 159/159; `rtk node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-24 disconnected optimizer/cost truth slice: normal WFA `analysis.json` now emits an explicit `optimization_truth` block identifying the active parameter-selection path as direct Optuna TPE over `_evaluate_parameter_combination`, with active cost inputs limited to the runner's vectorized backtest `fees` and `slippage`. It explicitly records `MultiObjectiveOptimizer`, `TransactionCostModeler`, and `CostStressTester` as inactive/disconnected from selected-parameter optimization and accepted WFA metric computation, preventing those modules from implying active cost-adjusted or multi-objective optimization evidence. Separately, the known `TransactionCostModeler` `INSTRUMENT_DETAILS_AVAILABLE` undefined-name bug is fixed by defining the local protocol guard, and a focused test proves instrument-details overrides initialize without NameError. This is truthful diagnostics plus a narrow bug fix only: it does not wire multi-objective optimization, does not run cost-stress testing, does not run Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim any strategy edge. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_optimizer_cost_truth.py` passed 2/2; `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py tests/test_wfa_optimizer_cost_truth.py` passed 7/7; `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 2/2; `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 5/5; `rtk node --test tests/factory.test.mjs` passed 63/63; `rtk node --test tests/verification.test.mjs` passed 159/159; `rtk node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-24 Phase 8D survivor-floor validation groundwork slice: positive research-WFA evaluator labels now require the Phase 8D minimum floors before any `promising`/`passed`/`success` verdict can validate: at least 8 completed OOS windows, at least 200 trades, at least 5% annualized return or aggregate-return proxy, and at least 70% positive OOS windows. Artifact-backed positive WFA metrics must now also cite the positive-window ratio, not only windows/trades/return. `buildResearchWfaPromotionGate()` now denies research-promotion/survivor-style claims when those floor inputs are missing or below threshold, while still recording that downstream MT5/native gates are required even when the minimum research diagnostics clear. This is validation groundwork only: no Phase 8D screening was run, no low-frequency registration exception was implemented yet, no MT5/MQL5/parity/deployment tooling was added, no market-data, optimizer-search, account/trading, or profitability-estimation tooling was added, and no strategy edge was claimed. Verification: `rtk node --test tests/phase8c-survivor-floors.test.mjs` passed 4/4; `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py tests/test_wfa_optimizer_cost_truth.py` passed 7/7; `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 2/2; `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 5/5; `rtk node --test tests/factory.test.mjs` passed 63/63; `rtk node --test tests/verification.test.mjs` passed 159/159; `rtk node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-24 low-frequency registration groundwork slice: added `src/core/low-frequency-registration.mjs` with `low_frequency_registration_v1` builder, content-hash validator, candidate-scoped writer, and hash-backed artifact validator. A valid registration must be pre-run, candidate-scoped under `factory/candidates/<candidate_id>/registrations/`, tied to `registered_before_run_id`, content-hash consistent, invalid if added after WFA results, and include the required structural low-frequency controls: longer history, regime diversity, concentration-risk checks, drawdown scrutiny, hard minimum trade floor, and no after-the-fact excuses. This is registration/validation/storage only: it does not relax the 200-trade floor yet, does not promote any candidate, does not launch WFA screening, and does not add MT5/MQL5/parity/deployment, market-data, optimizer-search, account/trading, or profitability tooling. Verification: `rtk node --test tests/low-frequency-registration.test.mjs` passed 5/5.

Status, 2026-05-24 survivor-floor prompt guard slice: evaluator strategy-quality calibration now states that Phase 8D survivor floors are validation gates, not optimization targets; agents must not tune or rerun toward exactly 8 windows, 200 trades, 5% return, or 70% positive windows as post-hoc knobs. It also requires a hash-backed pre-run `low_frequency_registration_v1` artifact for any future low-frequency exception claim. This is prompt/behavior guard only: it does not start Phase 8D, does not change optimizer behavior, does not create a low-frequency trade-count exception in validators yet, and does not claim any strategy edge. Verification: `rtk node --test tests/factory.test.mjs` passed 63/63.

Status, 2026-05-24 low-frequency exception consumption slice: positive research-WFA validation and research-promotion gate diagnostics can now relax only the 200-trade floor when a candidate/run-scoped, hash-verified, pre-result `low_frequency_registration_v1` artifact is cited. The registration must be under `factory/candidates/<candidate_id>/registrations/`, match the candidate id and run id, have valid content hash and artifact sha256, predate WFA result availability, and the observed trade count must still clear the registration's `minimum_acceptable_trades`. Invalid, missing, post-result, hash-mismatched, or wrong-scope registrations do not relax anything. The 8 completed-window, 5% return proxy, and 70% positive-window floors remain unchanged. This is validator/gate consumption only: it does not promote any candidate, does not launch Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/phase8c-survivor-floors.test.mjs` passed 7/7; `rtk node --test tests/low-frequency-registration.test.mjs` passed 5/5.

Status, 2026-05-24 research-WFA pre-registration groundwork slice: added `src/core/research-wfa-preregistration.mjs` with `research_wfa_preregistration_v1` builder, content-hash validator, candidate-scoped writer, and hash-backed artifact validator. A valid pre-registration must be stored under `factory/candidates/<candidate_id>/registrations/`, match the candidate/run id, predate WFA result availability, cite hash-verified Stage-0 hypothesis packet and source-record artifacts under `factory/research/`, freeze mechanism/instrument/timeframe/family/frequency/data/cost/WFA/invalidation fields, and assert denominator controls that failed/blocked/repaired/rerun attempts and optimizer trials count. It explicitly records no WFA execution, official mutation, or strategy-edge claim. This is validation/storage only: it does not wire WFA launch consumption, does not promote any candidate, does not launch Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/research-wfa-preregistration.test.mjs` passed 4/4.

Status, 2026-05-24 research-WFA pre-registration launch-consumption slice: deterministic WFA-ready planning now consumes a hash-backed `research_wfa_preregistration_v1` artifact when supplied, validates candidate/run scope and Stage-0 packet/source hashes, carries the artifact into plan `source_hashes`, and blocks explicit `Phase 8D`/`screening` WFA intent when the artifact is missing. `buildResearchWfaRunRequestFromPlan()` propagates the pre-registration reference into the worker request, and `validateResearchWfaRunRequest()` validates it before subprocess launch so invalid or hash-mismatched pre-registration cannot reach WFA execution. This is launch-gate validation only: it does not promote any candidate, does not run Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 7/7 after this slice.

Status, 2026-05-24 explicit warmup diagnostics slice: WFA config validation now accepts optional non-negative `walk_forward.indicator_warmup_bars` and rejects invalid values, while normal Python WFA records `indicator_warmup_bars` only as `warmup_diagnostics` with `status: diagnostic_only` and `applied_to_window_boundaries: false`. This deliberately does not infer strategy-specific indicator warmup, does not change window boundaries beyond existing `purge_gap_bars`, and does not claim full leakage protection. Verification: `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 8/8 after this slice; `.venv/Scripts/python.exe -m pytest tests/test_wfa_purge_gap_bars.py` passed 3/3.

Status, 2026-05-24 optimizer/cost truth fail-loud worker validation slice: the WFA worker now preserves `optimization_truth` diagnostics in `parsed-wfa-metrics.json` and observations, and blocks accepted WFA metrics when an artifact claims disconnected modules are active or otherwise contradicts the current normal WFA truth (`direct_optuna_tpe_study`, training-slice Sharpe objective, inactive `MultiObjectiveOptimizer`, inactive `TransactionCostModeler`, inactive `CostStressTester`, and explicit active cost inputs). Missing `optimization_truth` remains a diagnostic, not an invented metric. This is fail-loud validation only: it does not wire multi-objective optimization or cost stress testing, does not run Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 3/3.

Status, 2026-05-24 parameter-stability diagnostics slice: the WFA worker now emits `parameter_stability` diagnostics into `parsed-wfa-metrics.json` and observations using artifact-backed per-window `best_parameters` when available. Missing parameters are recorded as missing diagnostics, partial parameter rows are flagged, and differing reported parameter sets are flagged as `parameter_instability_flagged`; none of these statuses are promotion, rejection, or statistical-confidence gates. This is diagnostic hardening only: it does not run Phase 8D screening, does not tune or optimize toward survivor floors, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 5/5.

Status, 2026-05-24 warmup fail-loud worker diagnostics slice: the WFA worker now preserves artifact-backed `warmup_diagnostics` in `parsed-wfa-metrics.json` and observations, records missing diagnostics as no assumed warmup application, and blocks accepted WFA metrics if an artifact claims generic `indicator_warmup_bars` was applied to WFA window boundaries. Accepted warmup diagnostics must remain `status: diagnostic_only`, non-negative integer metadata, and `applied_to_window_boundaries: false`. This is fail-loud diagnostic preservation only: it does not implement generic indicator warmup, does not change WFA window boundaries beyond existing `purge_gap_bars`, does not run Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 5/5.

Status, 2026-05-24 advisory-stat authority guard slice: `buildResearchWfaPromotionGate()` now returns an explicit `statistical_test_authority` block stating that DSR, PBO, CPCV, and White Reality Check are `advisory_only_not_a_promotion_gate` with `hard_gate_enabled: false`, and its allow/deny reasons reiterate that advisory statistics are non-authoritative in Phase 8C. This preserves the current advisory-consumer policy: stats may report or block missing inputs, but cannot authorize promotion without a separate promotion-policy amendment. This is validator/prompt-policy hardening only: no Phase 8D screening was run, no hard statistical promotion gate was added, no MT5/MQL5/parity/deployment tooling was added, and no strategy edge was claimed. Verification: `rtk node --test tests/phase8c-survivor-floors.test.mjs` passed 8/8.

Status, 2026-05-24 malformed parameter-artifact fail-loud slice: the WFA worker now distinguishes missing per-window `best_parameters` from malformed parameter artifacts. Missing parameters remain diagnostic-only, but malformed non-object `best_parameters` values in accepted WFA metrics now produce `parameter_stability.status: invalid_artifact_backed` and block accepted research-WFA execution instead of silently degrading to missing/partial parameter stability. This is artifact-shape validation only: it does not make parameter stability a promotion/rejection/statistical-confidence gate, does not run Phase 8D screening, does not add optimizer-search/profitability tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 6/6.

Status, 2026-05-24 research-gate WFE/WFR consumption slice: `buildResearchWfaGateReport()` now consumes worker-emitted `metric_readiness.wfe` and `metric_readiness.wfr` when present, preserving artifact-backed computed WFE/WFR inputs and blocked diagnostics instead of reporting the old hard-coded missing-WFE placeholder. If worker readiness is absent, the report keeps the prior conservative fallback and does not invent WFE. This is reporting/readiness hardening only: it does not run Phase 8D screening, does not promote any candidate, does not add MT5/MQL5/parity/deployment tooling, and does not claim any strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 160/160.

Status, 2026-05-24 research-gate worker-diagnostic reporting slice: `buildResearchWfaGateReport()` now preserves worker-emitted `parameter_stability`, `optimization_truth`, and `warmup_diagnostics` blocks as reporting-only anti-overfit diagnostics, adds flags for blocked/missing WFE/WFR inputs, partial or invalid parameter artifacts, missing/invalid optimization-truth diagnostics, and missing/invalid warmup diagnostics, and keeps all of them non-authoritative for promotion/rejection/statistical confidence. Missing diagnostics remain explicit blocked/missing observations rather than invented metrics. This is report hardening only: it does not change Python WFA behavior, does not run Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py tests/test_wfa_optimizer_cost_truth.py` passed 8/8; `rtk node --test tests/research-wfa-preregistration.test.mjs` passed 4/4; `rtk node --test tests/low-frequency-registration.test.mjs` passed 5/5; `rtk node --test tests/phase8c-survivor-floors.test.mjs` passed 8/8; `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 6/6; `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 8/8; `rtk node --test tests/factory.test.mjs` passed 63/63; `rtk node --test tests/verification.test.mjs` passed 162/162; `rtk node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-24 research-gate anti-overfit reporting refinement slice: `buildResearchWfaGateReport()` now labels parameter-stability evidence strength as `reported_complete_for_basic_review` or `weak_or_incomplete`, flags weak evidence when parameter rows are missing, partial, invalid, below the reporting window floor, or do not cover all reported windows, and separates missing cost-stress evidence from missing cost assumptions. When fee/slippage assumptions exist but no separate artifact-backed cost-stress output is supplied, the report records `cost_assumptions_recorded_stress_missing`, `stress_tested: false`, and `missing_cost_stress_evidence` without inventing adjusted metrics. This is reporting-only anti-overfit hardening: it does not change Python WFA behavior, does not run Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py tests/test_wfa_optimizer_cost_truth.py` passed 8/8; `rtk node --test tests/research-wfa-preregistration.test.mjs` passed 4/4; `rtk node --test tests/low-frequency-registration.test.mjs` passed 5/5; `rtk node --test tests/phase8c-survivor-floors.test.mjs` passed 8/8; `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 6/6; `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 8/8; `rtk node --test tests/factory.test.mjs` passed 63/63; `rtk node --test tests/verification.test.mjs` passed 163/163; `rtk node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-24 research-gate diagnostic visibility slice: `buildResearchWfaGateReport()` now makes three more Phase 8C limitations explicit without changing any gate authority. Valid `optimization_truth` now includes a reporting-only `disconnected_module_review` showing the active direct-Optuna path, active fee/slippage inputs, and inactive disconnected optimizer/cost modules, with `disconnected_optimizer_cost_modules_reported` as a visibility flag. Diagnostic-only warmup now includes `boundary_application.status: generic_indicator_warmup_not_applied` and the matching flag, reinforcing that `indicator_warmup_bars` does not change WFA boundaries. Search-denominator summaries now include `missing_source_count`, `missing_non_worker_attempt_sources`, and `missing_non_worker_attempt_denominator_context` when LLM/manual/mutation/repair/rerun attempt denominators are absent. This is reporting-only hardening: it does not change Python WFA behavior, does not run Phase 8D screening, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability tooling, and does not claim any strategy edge. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py tests/test_wfa_optimizer_cost_truth.py` passed 8/8; `rtk node --test tests/research-wfa-preregistration.test.mjs` passed 4/4; `rtk node --test tests/low-frequency-registration.test.mjs` passed 5/5; `rtk node --test tests/phase8c-survivor-floors.test.mjs` passed 8/8; `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 6/6; `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 8/8; `rtk node --test tests/factory.test.mjs` passed 63/63; `rtk node --test tests/verification.test.mjs` passed 163/163; `rtk node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Status, 2026-05-25 denominator and ResearchBrain-memory gate hardening slice: `buildResearchWfaGateReport()` now adds reporting-only optimizer-trial accounting that compares hash-backed optimizer-trial rows against `optimizer_search_context_v1` planned/completed/failed trial counts and flags `optimizer_trial_accounting_incomplete` or `optimizer_trial_accounting_mismatch` without changing structural denominator completeness or enabling hard DSR/PBO/CPCV/White gates. It also adds reporting-only multiple-comparison coverage diagnostics that compare known worker plus non-worker attempts against `multiple_comparison_context_v1.total_strategies_tested` and flags `multiple_comparison_context_underreports_known_attempts` when the context undercounts known attempts. Separately, ResearchBrain-derived backlog source-quality gates now block direct WFA-ready status when explicit duplicate-memory, rejection-memory, failed-pattern, or memory-similarity-blocked signals are preserved on the candidate; the orchestrator preserves those fields from Ideator output and downgrades affected candidates to `requires_more_research`. This is gate/report hardening only: it does not run Phase 8D screening, does not mutate official state outside existing orchestrator-owned paths, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `.venv/Scripts/python.exe -m pytest tests/test_wfa_is_metric_emission.py tests/test_wfa_purge_gap_bars.py tests/test_wfa_is_return_emission.py tests/test_wfa_optimizer_cost_truth.py` passed 8/8; `rtk node --test tests/research-wfa-preregistration.test.mjs` passed 4/4; `rtk node --test tests/low-frequency-registration.test.mjs` passed 5/5; `rtk node --test tests/phase8c-survivor-floors.test.mjs` passed 8/8; `rtk node --test tests/wfa-metric-readiness.test.mjs` passed 6/6; `rtk node --test tests/wfa-config-output-truth.test.mjs` passed 8/8; `rtk node --test tests/factory.test.mjs` passed 63/63; `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 30/30; `rtk node --test tests/verification.test.mjs` passed 164/164; `rtk node --test tests/wfa-data-manifest-consumption.test.mjs` passed 3/3; `rtk npm run validate` passed.

Objective:

- make Python WFA suitable for falsification and robust screening before positive candidate claims are allowed

Primary work:

- emit in-sample Sharpe and compute WFR/WFE where inputs make them defensible
- align WFA launcher output root with worker `expected_output_root`
- define and enforce one canonical WFA YAML schema
- add purge/warmup handling to reduce indicator leakage
- keep disconnected optimizer and cost modules from implying active cost-adjusted or multi-objective optimization; physical deletion/quarantine or full wiring is deferred unless a concrete bypass appears, because accepted WFA evidence now records the active direct-Optuna path and flags disconnected modules as inactive
- fix the known `TransactionCostModeler` `INSTRUMENT_DETAILS_AVAILABLE` undefined-name bug before any code path relies on that modeler
- retain the Phase 8 scope audit dead-code count as future cleanup context only; it is not a Phase 8C closeout blocker while fail-loud optimizer/cost truth diagnostics prevent false active-evidence claims
- enforce stricter positive-label and survivor floors for Phase 8D claims
- define `low_frequency_registration_v1` before any low-frequency WFA run
- wire lesson-to-action remediation for repeated artifact-backed failures

Status, 2026-05-25 remediation anti-spam hardening slice: `buildRepeatedFailureRemediationActions()` now refuses to create remediation follow-ups from remediation backlog items or items that already carry a `remediation_key`, requires at least two concrete scope fields among `market_family`, `instrument_scope`, and `timeframe`, and counts prior comparable failures only when artifact/summary-backed lessons exactly match those concrete scope fields. This keeps bounded remediation generation on the existing orchestrator-owned backlog append path while preventing generic unknown-scope token matches and recursive remediation cascades. This is backlog hygiene only: it does not run Phase 8D screening, does not mutate official state outside existing orchestrator-owned paths, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/factory.test.mjs` passed 65/65.

Status, 2026-05-25 ResearchBrain ideation-manifest gate hardening slice: ResearchBrain-derived direct WFA-ready backlog now requires the same-run `factory/research/runs/<research_run_id>/ideation-manifest.json` to be readable and valid before duplicate/rejection/blocker checks can clear. Missing or malformed ideation manifests now force `requires_more_research` for direct WFA routes instead of silently skipping the same-run memory ledger, while non-ready follow-up candidates may still be recorded for further research. This is Stage-0 consumption hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 33/33; `rtk node --test tests/factory.test.mjs` passed 65/65.

Status, 2026-05-25 ResearchBrain accepted-manifest linkage slice: ResearchBrain-derived direct WFA-ready backlog now also requires the same-run ideation manifest to list the candidate hypothesis packet in `hypotheses_accepted` by hypothesis id or packet path. A readable and schema-valid manifest that does not actually accept the candidate packet now forces `requires_more_research`, preventing source/path laundering through an unrelated same-run manifest. This is Stage-0 consumption hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 34/34; `rtk node --test tests/factory.test.mjs` passed 65/65.

Status, 2026-05-25 ResearchBrain ideation-manifest run-id integrity slice: ResearchBrain-derived direct WFA-ready backlog now requires the same-run ideation manifest's `research_run_id` to match the ResearchBrain run directory used by the candidate packet. A readable and schema-valid manifest with a mismatched run id now forces `requires_more_research`, preventing an unrelated valid manifest from satisfying direct-WFA manifest checks. This is Stage-0 consumption hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 35/35.

Status, 2026-05-25 ResearchBrain ideation-manifest hash/source linkage slice: ResearchBrain-derived direct WFA-ready backlog now requires the same-run ideation manifest's accepted hypothesis entry to match the candidate packet by path/id and packet hash, and requires `artifact_paths` to include the candidate packet and all candidate source records by exact path/sha256. A manifest that accepts the right packet id/path with the wrong hash, or omits exact source-record artifact refs, now forces `requires_more_research`. This is Stage-0 consumption hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 37/37.

Status, 2026-05-25 ResearchBrain planner-provenance direct-route gate slice: `validateResearchBrainPlannerProvenance()` now reuses the ResearchBrain source-quality gate before allowing a ResearchBrain-derived planner result to become a direct `research_wfa`/WFA-config route. Preserving packet/source hashes in planner `source_hashes` is still required, but is no longer sufficient if the Stage-0 candidate is blocked by low trust, memory, or same-run ideation-manifest gate reasons. This is planner-gate hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 37/37; `rtk node --test tests/factory.test.mjs` passed 65/65.

Status, 2026-05-25 ResearchBrain planner direct-route shape hardening slice: ResearchBrain planner-provenance direct-route detection now also treats canonical WFA config references in planner `inputs`, `expected_artifacts`, `implementation_steps`, or `data_acquisition.expected_outputs` as direct WFA route intent. This prevents a source-quality-blocked Stage-0 candidate from bypassing the gate by avoiding `research_wfa`, `advanced_wfa_config`, or command fields while still pointing the plan at a canonical WFA config. This is planner-gate hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 37/37; `rtk node --test tests/factory.test.mjs` passed 65/65.

Status, 2026-05-25 ResearchBrain nested-command direct-route gate slice: ResearchBrain planner-provenance direct-route detection now also treats WFA launcher/config references in `data_acquisition.commands` as direct WFA route intent, and canonical WFA config detection accepts engine-relative `strategies/<name>/wfa_config.yaml` refs in addition to repo-relative `walk forward engine/strategies/<name>/wfa_config.yaml` refs. This closes a narrow source-laundering loophole where a source-quality-blocked Stage-0 candidate could declare non-WFA `evidence_kind` while hiding a canonical WFA launch in acquisition commands. This is planner-gate hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `node --test tests/researchbrain-artifacts.test.mjs` passed 37/37 after `rtk` was unavailable in this PowerShell environment. `node --test tests/factory.test.mjs` was attempted because planner validation is touched; 60/65 tests passed, and the 5 failures were the existing environment-root issue where `/mnt/c/Users/.../trading-research-factory` resolves as missing `C:\mnt\c\Users\...\trading-research-factory` under PowerShell.

Status, 2026-05-25 ResearchBrain recursive/Windows-path direct-route gate slice: ResearchBrain planner-provenance direct-route detection now recursively inspects structured planner values for canonical WFA config references and normalizes Windows backslashes before matching `walk forward engine/strategies/<name>/wfa_config.yaml` or `strategies/<name>/wfa_config.yaml`. This prevents a source-quality-blocked Stage-0 candidate from bypassing direct-route blocking by hiding a WFA config ref inside an object-shaped implementation step or by using PowerShell-style path separators. This is planner-gate hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `node --test tests/researchbrain-artifacts.test.mjs` passed 37/37. `node --test tests/factory.test.mjs` was attempted because planner validation is touched; 60/65 tests passed, and the 5 failures were the existing environment-root issue where `/mnt/c/Users/.../trading-research-factory` resolves as missing `C:\mnt\c\Users\...\trading-research-factory` under PowerShell.

Status, 2026-05-25 ResearchBrain top-level WFA-config field direct-route gate slice: ResearchBrain planner-provenance direct-route detection now treats top-level `expected_wfa_config_path`, `wfa_config_path`, `advanced_wfa_config`, and `planner_bypass.wfa_config_path` references as direct WFA route intent. This prevents a source-quality-blocked Stage-0 candidate from bypassing planner blocking by avoiding command/input/step WFA references while still carrying the WFA config path in planner metadata. This is planner-gate hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 37/37; `rtk node --test tests/factory.test.mjs` passed 65/65; `rtk npm run validate` passed.

Status, 2026-05-25 ResearchBrain object-shaped command direct-route gate slice: ResearchBrain planner-provenance direct-route detection now inspects `commands` and `data_acquisition.commands` recursively even when they are object-shaped instead of arrays. This prevents a source-quality-blocked Stage-0 candidate from hiding a WFA launcher/config reference inside command metadata that was not array-shaped. This is planner-gate hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 37/37; `rtk node --test tests/factory.test.mjs` passed 65/65; `rtk npm run validate` passed.

Status, 2026-05-25 ResearchBrain metadata WFA-config direct-route gate slice: ResearchBrain planner-provenance direct-route detection now also inspects nested `data_acquisition` metadata and common top-level artifact/output containers (`outputs`, `expected_outputs`, `planned_artifacts`, `artifact_paths`, `result_artifacts`) for canonical WFA config references. This prevents a source-quality-blocked Stage-0 candidate from laundering direct WFA intent through non-command planner metadata. This is planner-gate hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 37/37; `rtk node --test tests/factory.test.mjs` passed 65/65; `rtk npm run validate` passed.

Status, 2026-05-25 ResearchBrain backlog explicit-route gate alignment slice: ResearchBrain backlog-candidate validation now applies explicit direct-WFA route detection to source-quality-blocked Stage-0 candidates, matching the planner route-shape coverage for top-level WFA config paths, `advanced_wfa_config`, `planner_bypass.wfa_config_path`, object- or array-shaped commands, nested `data_acquisition` metadata, implementation steps, and common artifact/output containers. `evidence_kind: research_wfa` alone remains allowed for non-ready follow-up items, but hidden WFA launcher/config intent now blocks even when the item status says `requires_more_research`. This is Stage-0 consumption hygiene only: it does not run Phase 8D screening, does not make ResearchBrain packets executable evidence, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/researchbrain-artifacts.test.mjs` passed 37/37; `rtk node --test tests/factory.test.mjs` passed 65/65.

Status, 2026-05-25 cost-stress provenance reporting slice: `buildResearchWfaGateReport()` now treats explicit cost-stress diagnostics as reporting-only evidence that still requires artifact provenance when `stress_tested: true` is claimed. A supplied cost-stress object with missing, malformed, or non-hash-verified `source_artifacts` now reports `invalid_artifact_backed` and flags `invalid_cost_stress_evidence`; valid hash-backed source artifacts are preserved in the report, counted, and included in `evidence_paths` with a reporting-only `cost_stress_evidence_reported` flag. This is diagnostic provenance hardening only: it does not run Phase 8D screening, does not wire cost-stress tooling into WFA optimization, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 167/167.

Status, 2026-05-25 cost-assumption provenance reporting slice: `buildResearchWfaGateReport()` now reports fee/slippage cost-assumption provenance separately from cost-stress result provenance. Cost assumptions with source path, source field, and SHA-256 metadata are surfaced as reporting-only `cost_assumption_provenance`; missing or primitive unsourced assumptions flag `unverified_cost_assumption_provenance`. A `stress_tested: true` cost-stress claim now requires both hash-verified stress-result source artifacts and hash-backed cost-assumption provenance, otherwise it reports `invalid_artifact_backed`. This is diagnostic provenance hardening only: it does not run Phase 8D screening, does not wire cost-stress tooling into WFA optimization, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 168/168.

Status, 2026-05-25 cost/optimizer provenance consistency slice: `buildResearchWfaGateReport()` now closes three related Phase 8C reporting gaps. First, fee/slippage cost assumptions are considered hash-backed only when both required fields are present with source path, source field, and SHA-256 metadata; incomplete cost assumptions now report exact missing fields. Second, `stress_tested: true` cost-stress claims require hash-backed source artifacts with artifact type `cost_stress_result`, so unrelated hash-backed artifacts cannot launder cost-stress evidence. Third, `optimization_truth.active_cost_inputs` is compared against hash-backed cost-assumption values and reports missing, unverified, or mismatched active cost inputs with reporting-only flags. This is diagnostic/provenance hardening only: it does not run Phase 8D screening, does not wire disconnected optimizer or cost modules, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 171/171.

Status, 2026-05-26 optimization-truth contract reporting slice: `buildResearchWfaGateReport()` now adds a reporting-only `optimization_truth.disconnected_module_review.contract_review` that compares worker-emitted optimizer/cost truth against the current Phase 8C normal-WFA contract: direct Optuna TPE selection, training-slice Sharpe objective, fee/slippage active cost inputs, and inactive/disconnected `MultiObjectiveOptimizer`, `TransactionCostModeler`, and `CostStressTester`. A supposedly valid optimization-truth artifact that omits required disconnected modules, claims disconnected flags are active, changes the active optimizer/objective path, or omits active cost inputs now gets explicit reporting flags without becoming a promotion/rejection/statistical gate. Follow-up source-provenance hardening adds reporting-only `optimization_truth.source_review`, flags missing/unverified source path/hash/field provenance, flags source fields that do not reference `optimization_truth` as an exact field segment, cross-checks source path/hash against `metrics_artifact` identity when available, and includes hash-backed optimization-truth source paths in gate-report evidence paths. Active cost inputs are now constrained to the current normal-WFA fee/slippage pair in reporting; unexpected active cost-input fields such as synthetic spread/model claims are flagged rather than treated as verified cost modeling. This is diagnostic/provenance hardening only: it does not run Phase 8D screening, does not wire disconnected optimizer or cost modules, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge.

Status, 2026-05-26 statistical-input provenance reporting slice: `buildResearchWfaGateReport()` now tightens advisory statistical-input provenance without changing promotion authority. DSR inputs require exactly one hash-backed `dsr_input` source artifact instead of accepting any generic hash-backed source, and malformed/wrong-type DSR source artifacts block only the advisory DSR calculation. DSR/PBO/CPCV/White outputs now carry reporting-only `denominator_review` diagnostics comparing declared trial coverage, where available, against `multiple_comparison_context_v1.total_strategies_tested`; underreported PBO/DSR/White trial coverage and CPCV's lack of a declared trial count are surfaced as flags but do not become promotion/rejection/statistical hard gates. This is Phase 8C anti-overfit/reporting hardening only: it does not run Phase 8D screening, does not make advisory statistics authoritative, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 176/176.

Status, 2026-05-26 DSR explicit-trial-count provenance slice: `buildResearchWfaGateReport()` now blocks advisory DSR calculation unless `dsr.trial_count` is explicitly supplied as an integer. It no longer falls back to `multiple_comparison_context_v1.total_strategies_tested` as an implicit DSR trial count, and it surfaces reporting-only `dsr_input_trial_count_not_declared` / `dsr_input_trial_count_not_integer` flags when the input is missing or malformed. This is statistical-input provenance hardening only: it does not run Phase 8D screening, does not make DSR/PBO/CPCV/White authoritative, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 178/178; `rtk npm run validate` passed.

Status, 2026-05-26 DSR identity-provenance reporting slice: advisory DSR inputs now use the same candidate/lineage/family identity diagnostics as PBO/CPCV/White before any `computed_advisory` DSR value is emitted. A hash-backed `dsr_input` artifact for the wrong candidate, lineage, or family now remains reporting-only and blocks the advisory DSR calculation with explicit `*_match` missing inputs plus `dsr_input_identity_mismatch` / `dsr_input_identity_missing_or_malformed` flags where applicable. This is statistical-input provenance hardening only: it does not run Phase 8D screening, does not make DSR/PBO/CPCV/White authoritative, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 179/179.

Status, 2026-05-26 statistical-input source-scope and identity-flag slice: advisory statistical input `source_artifacts` must now use canonical repo-relative paths with no absolute paths, Windows drive paths, backslashes, empty segments, `.` segments, or `..` traversal before they can count as hash-backed evidence or appear in gate-report evidence paths. PBO's direct source-artifact shape checks now share this stricter path rule, and DSR/PBO/CPCV/White gate reports now surface reporting-only identity mismatch or malformed-identity flags consistently. This is statistical-input provenance hardening only: it does not run Phase 8D screening, does not make advisory statistics authoritative, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 182/182.

Status, 2026-05-26 statistical-input unreadable-source slice: advisory DSR/PBO/CPCV/White calculations now block when their direct `source_artifacts` carry a `read_error`, even if the artifact row otherwise has a canonical repo-relative path, expected artifact type, SHA-256, and `hash_verified: true`. The gate report surfaces `readable_source_artifacts` as a missing input and preserves the read error in diagnostics, preventing unreadable statistical-input files from laundering advisory anti-overfit values. This is statistical-input provenance hardening only: it does not run Phase 8D screening, does not make advisory statistics authoritative, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 183/183.

Status, 2026-05-26 statistical-input denominator/source flag refinement slice: `buildResearchWfaGateReport()` now treats declared statistical trial counts as explicit numeric inputs only for reporting-only denominator review, avoiding JavaScript null-to-zero coercion in advisory DSR/PBO/CPCV/White diagnostics. CPCV's lack of a declared trial count is now reported as `declared_trial_count_missing` with `cpcv_input_trial_count_not_declared`, instead of looking like an underreported zero-trial declaration. Statistical source diagnostics also emit explicit reporting flags for unreadable, malformed, or unverified DSR/PBO/CPCV/White source artifacts. This is statistical-input provenance reporting only: it does not run Phase 8D screening, does not make advisory statistics authoritative, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 183/183.

Status, 2026-05-27 statistical-input trial-count/context diagnostic consistency slice: `buildResearchWfaGateReport()` now treats multiple-comparison context as available only when a valid hash-backed context row is actually consumed, so missing/rejected/unreadable context no longer appears as a real zero-strategy context in DSR/PBO/CPCV/White denominator reviews. Statistical-input denominator reviews now distinguish `declared_trial_count_missing`, `declared_trial_count_not_numeric`, `declared_trial_count_not_integer`, `declared_trial_count_not_positive`, `multiple_comparison_context_missing`, underreported context, and covered context as reporting-only statuses. The report emits consistent trial-count flags for DSR/PBO/CPCV/White, including PBO and White missing/non-numeric/non-integer/non-positive cases, while DSR continues to require an explicit positive integer `trial_count`. CPCV may report an optional declared trial-count quality diagnostic, but CPCV advisory summaries remain source-backed explicit-combination summaries, not promotion gates. This is statistical-input provenance/reporting hardening only: it does not run Phase 8D screening, does not make DSR/PBO/CPCV/White authoritative, does not add MT5/MQL5/parity/deployment tooling, does not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and does not claim a strategy edge. Verification: `rtk node --test tests/verification.test.mjs` passed 185/185.

Status, 2026-05-27 statistical-input diagnostic completeness slice: `buildResearchWfaGateReport()` now adds reporting-only `source_artifact_review` metadata to advisory DSR/PBO/CPCV/White outputs, including expected artifact type, provided source-artifact count, hash-backed canonical count, expected-type count, readable count, and source read/type/shape error counts. Statistical source flags now distinguish missing source artifacts, non-array source artifact fields, ambiguous multiple direct source artifacts, unreadable sources, malformed source rows, unverified sources, and wrong artifact types. PBO/CPCV/White schema-version failures now emit explicit reporting flags, and DSR non-numeric `trial_count` is reported as `declared_trial_count_not_numeric` rather than being collapsed into non-integer diagnostics. These remain advisory/reporting-only diagnostics; they do not authorize promotion or rejection, do not run Phase 8D screening, do not make ResearchBrain packets executable evidence, do not add MT5/MQL5/parity/deployment tooling, do not add market-data, optimizer-search, account/trading, or profitability-estimation tooling, and do not claim a strategy edge. Focused verification: `rtk node --test tests/verification.test.mjs` passed 186/186.

Phase 8C closure assessment and deferred non-blockers before Phase 8D screening:

- validator floors for Phase 8D positive/survivor labels are now tightened; evaluator prompt floors now distinguish validation gates from optimization targets; low-frequency registration artifacts now have validation/storage helpers and trade-count exception consumption; research-WFA pre-registration artifacts now have validation/storage helpers and WFA-launch validation for explicit Phase 8D/screening intent
- the WFA plan compiler now consumes hash-backed hypothesis packets and research-WFA pre-registration artifacts before explicit Phase 8D/screening WFA attempts; remaining work is Phase 8D screening orchestration, not more Phase 8C hardening
- role prompts distinguish survivor floors from optimization targets; agents must not optimize toward 8 windows, 200 trades, 5% return proxy, or 70% positive windows as post-hoc knobs
- advisory DSR/PBO/CPCV/White consumers may report or block, but cannot become hard gates without a separate explicit promotion-policy amendment; promotion-gate output records this authority boundary explicitly
- deferred, not Phase 8D blockers: physical inactive optimizer/cost module deletion or full wiring, generic strategy-specific warmup inference, hard statistical promotion gates/input producers, and cost-stress or multi-objective optimizer wiring

Phase 8D positive/survivor floors require, at minimum:

- at least 8 completed OOS windows
- at least 200 trades unless a valid pre-run `low_frequency_registration_v1` exists
- at least 5% annualized return or a strong aggregate-return proxy
- at least 70% positive OOS windows
- advisory DSR/PBO/CPCV/White reported or explicitly blocked with exact missing inputs for serious candidates

`low_frequency_registration_v1` must exist before WFA results are known and must include:

- `candidate_id`
- `registered_at`
- `registered_before_run_id`
- `content_hash`
- `expected_trade_count_class`
- `expected_trades_per_year`
- `expected_holding_period`
- `why_low_frequency_is_structural`
- `minimum_acceptable_trades`
- `required_extra_controls`
- `invalid_if_added_after_results: true`

Low-frequency controls must require longer history, regime diversity, concentration-risk checks, drawdown scrutiny, a hard minimum trade floor, and no after-the-fact excuses.

Exit criteria:

- [x] normal WFA runs expose IS/OOS metrics needed for WFR/WFE where applicable, with computed values only from artifact-backed accepted metrics and blocked diagnostics when inputs are unavailable
- [x] invalid WFA configs and output-root mismatches fail before worker launch and evidence acceptance
- [x] positive evaluator labels are impossible below Phase 8D floors unless a valid low-frequency registration adjusts only the trade-count floor
- [x] explicit Phase 8D/screening WFA launch intent requires hash-backed pre-run `research_wfa_preregistration_v1`
- [x] repeated artifact-backed lessons create bounded remediation backlog items without spam or recursive generic cascades
- [x] ResearchBrain Stage-0 packets remain non-executable and source-quality-blocked packets cannot reach direct WFA routes through hidden config/command metadata
- [x] advisory DSR/PBO/CPCV/White remain reporting-only and cannot authorize promotion without a separate promotion-policy amendment

#### Phase 8D - Hypothesis-Led Candidate Screening `[x]`

Status, 2026-06-02:

- Phase 8D is closed as bounded screening-pipeline validation after the Phase 8D closeout artifact `factory/verification/phase8d-exit-readiness-20260528T195145Z.json` reported `ready_to_close` with 16 mandatory criteria met, 0 pending, and 0 deferred
- real Phase 8D gate and execution canaries now exist on disk: prereg-blocked `RUN-20260528184735-xx0k9r`, source-quality-blocked `RUN-20260528185420-4ec6n9`, and executed below-floor screening canary `RUN-PHASE8D-SURVIVOR-FLOOR-20260528194629`
- first post-closeout production screening pass completed on EURUSD London breakout: `RUN-PHASE8D-LONDON-BREAKOUT-20260528201036`; result was non-survivor with 87 OOS windows, 842 trades, return proxy -0.09568138811736819%, positive OOS window ratio 0.298851, and Phase 8E authorization false
- additional operational screening completed on BTC BB-width squeeze after a denominator-counted timeout: `RUN-PHASE8D-BTC-BB-SQUEEZE-20260530215722` timed out before accepted WFA outputs; repaired runtime-feasibility attempt `RUN-PHASE8D-BTC-BB-SQUEEZE-RUNTIME-20260530223043` executed 57 OOS windows and 1101 trades but remained a non-survivor with return proxy 0.09117433540026997%, positive OOS window ratio 0.45614, and Phase 8E authorization false
- additional independent operational screening completed on BTC volatility-adaptive trend: `RUN-PHASE8D-VOL-ADAPTIVE-TREND-20260531133727` executed 57 OOS windows and 220 trades but remained a non-survivor with return proxy 1.3086664056586577%, positive OOS window ratio 0.403509, and Phase 8E authorization false
- later operational screens also remained non-survivors: EURUSD signed tick-volume OFI `RUN-PHASE8D-OFI-EURUSD-20260601125336`, EURUSD month-end rebalancing-flow `RUN-PHASE8D-MONTH-END-REBALANCE-EURUSD-20260601142040`, EURUSD WMR London 4pm fixing-flow `RUN-PHASE8D-FX-FIX-REVERSAL-EURUSD-20260601200452`, EURUSD NFP macro-announcement flow `RUN-PHASE8D-NFP-MACRO-EURUSD-20260601211740`, ETH/BTC residual mean reversion `RUN-PHASE8D-ETH-BTC-RESIDUAL-20260602160412`, and final manual BTC weekly calendar screen `RUN-PHASE8D-BTC-WEEKLY-CALENDAR-20260602202758`
- latest final manual screen `RUN-PHASE8D-BTC-WEEKLY-CALENDAR-20260602202758` executed 57 OOS windows and 12 trades but remained a non-survivor with return proxy -0.046742349123647525%, OOS Sharpe -0.2369846339001491, profit factor 0.6456865995974739, positive OOS window ratio 0.087719, C4 consistency with no pass route, and Phase 8E authorization false
- no Phase 8D survivor exists as of `factory/verification/phase8d-exit-readiness-20260602T203955Z.json` and `factory/verification/phase8d-ladder-calibration-20260602T203955Z.json`; the readiness reporter still shows the known old-evidence `15/16` issue, but the new final BTC calendar evidence packet is valid and gate-denied
- zero-survivor closeout is explicitly accepted because gate-integrity criteria are met; a real alpha loop may run days or weeks without a survivor, so zero survivors is not itself a factory failure
- the final manual Phase 8D trial for now is complete; do not continue manual strategy roulette, do not tune/rerun failed hypotheses without genuinely new independent source-backed evidence, and do not loosen gates or force a survivor
- next work should move to sequential non-8E tasks: continuous ResearchBrain/factory-loop activation, broader data-readiness/instrument-history expansion, and runtime reliability/queue durability so source-backed discovery can run for long periods without manual survivor hunting
- Phase 8E remains not started and blocked until a Phase 8D survivor, verified MT5 instrument equivalence, and explicit operator authorization exist

Start gate:

- Phase 8C closeout artifact exists and reports no pending mandatory criteria
- no newly discovered evidence-safety bypass blocks screening start
- ResearchBrain packets remain Stage-0 only until converted into a pre-registered, hash-backed screening attempt
- historical leaderboard winners and legacy ready WFA routes are not Phase 8D inputs unless a pre-run hypothesis packet and `research_wfa_preregistration_v1` explicitly justify the attempt

Bounded phase meaning:

- Phase 8D closes when the screening pipeline is proven safe and runnable, not when the factory has found a profitable strategy
- zero survivors is a valid Phase 8D closeout if the mandatory gate-integrity criteria below are met with disk-backed artifacts
- if a survivor exists, survivor-specific criteria become mandatory for that candidate
- deferred work must name a reactivation trigger; otherwise Phase 8D must not expand into endless hardening

Internal sequencing:

- 8D-A Screening Pipeline Validation: prove blocked-at-start gates, pre-registration, source-quality blocking, survivor-floor enforcement, denominator tracking, advisory-stat reporting, and no Phase 8E leakage on real or contract-conformant pipeline input
- 8D-B Candidate Screening: run 1-3 source-backed, pre-registered hypothesis packets through the deterministic WFA pipeline when eligible inputs exist; reject weak candidates cleanly; register any survivor under `factory/candidates/`

Implementation preflight before the first Phase 8D screening WFA:

- [x] remove stale prediction-market scope from active control-plane goal/policy surfaces so normal agents do not reintroduce non-MT5 ideas as screening inputs; deterministic checks include `factory/state.json` goal, `FACTORY_GOAL`, active market policy, market-policy defaults, and prompt goal-capsule plumbing through the Phase 8D exit-readiness reporter
- [x] prevent legacy `ready` WFA backlog items from being consumed as Phase 8D screening attempts unless they are converted through a hash-backed hypothesis packet and `research_wfa_preregistration_v1`
- [x] consolidate survivor-floor constants into one shared source so evaluator validation and research-promotion gates cannot drift
- [x] convert Phase 8D compiler/source-quality/pre-registration rejection into deterministic blocked-at-start run artifacts instead of falling through to LLM planner/executor paths
- [x] add targetable screening execution, such as a specific backlog/candidate selector, so Phase 8D can run one intended screening item without queue roulette
- [x] add a Phase 8D exit-readiness reporter that starts as `not_ready_to_close` and records criteria as met, pending, deferred, or not-applicable

Objective:

- test source-backed, pre-registered, MT5-relevant hypotheses without WFA roulette
- produce a census of screened hypotheses, not a post-hoc winner selection exercise
- preserve denominator evidence for blocked, failed, inconclusive, repaired, mutated, rerun, manual, LLM-generated, and optimizer attempts

Primary work:

- start candidate screening from `hypothesis_packet_v1`, not historical leaderboard winners
- pre-register mechanism, instrument scope, frequency class, data sources, invalidation criteria, WFA design, and denominator rules before execution
- freeze pre-registration by artifact path/hash before WFA launch
- track all attempts: failed, blocked, timed-out, repaired, mutated, rerun, LLM/manual, and optimizer trials
- screen multiple materially distinct families only when pre-registered; do not turn family count into a mechanical target
- classify assets as `mt5_verified`, `mt5_proxy`, or `non_mt5_research_only`

WFA roulette loopholes that Phase 8D implementation must close:

- no candidate may be selected because it is SOL, BTC, ETH, BNB, EMA Trend Gate, or any other historical best family unless a pre-run hypothesis packet justifies it
- changing asset, timeframe, date range, cost model, threshold, strategy family, or low-frequency status after seeing WFA results creates a new attempt and must be denominator-tracked
- a low-frequency exception can lower only the trade-count floor and only when registered before results; it cannot excuse weak windows, concentration, drawdown, data gaps, or missing MT5 equivalence
- failed, blocked, repaired, mutated, and rerun attempts are part of the denominator even when no attractive chart or WFA result is produced

Candidate artifacts:

- `research_wfa_preregistration_v1`
- candidate manifest fields for MT5 equivalence and deployment intent
- `trial_attempt_record`
- `optimizer_search_context_v1`
- `non_worker_denominator_attempts_v1`
- `multiple_comparison_context_v1`
- advisory `pbo_input_matrix_v1`, `cpcv_input_matrix_v1`, and `white_reality_check_input_v1` when inputs exist

Exit criteria:

- [x] Screening cycle completed: at least one non-legacy Phase 8D screening cycle reaches a terminal run state with disk-backed artifacts under `factory/runs/`, originates from a backlog item carrying a ResearchBrain `hypothesis_packet_path`/SHA-256 or a contract-conformant manual packet, and uses deterministic worker evidence for any accepted `research_wfa` execution
- [x] Pre-registration gate verified: at least one explicit Phase 8D/screening WFA intent without a valid hash-backed `research_wfa_preregistration_v1` artifact is blocked before WFA launch with exact diagnostics
- [x] ResearchBrain source-quality gate verified: at least one source-quality-blocked Stage-0 packet or direct-WFA laundering attempt is blocked with exact diagnostics rather than becoming executable WFA evidence
- [x] Survivor floor enforcement verified: at least one below-floor screening result remains below `promising`/`passed`/`success`; positive/survivor labels remain impossible below 8 completed OOS windows, 200 trades unless valid pre-run low-frequency registration adjusts only the trade-count floor, 5% return proxy, and 70% positive OOS windows
- [x] Denominator tracking exists: all Phase 8D screening attempts carry candidate, lineage, family, run, and attempt IDs; at least two attempts, including blocked/failed/inconclusive attempts where applicable, are represented in denominator artifacts or gate diagnostics
- [x] Candidate evidence packet exists for each completed screening attempt: denominator context, data identity when known, source/preregistration hashes, and advisory statistical diagnostics or exact blocked reasons are cited by artifact path/hash; WFA-specific fields including windows, trades, return proxy, OOS consistency, and WFR where computable are required only for attempts that launched WFA
- [x] Advisory stats boundary preserved: DSR/PBO/CPCV/White remain reported or explicitly blocked with missing inputs for serious candidates and are not used as promotion/rejection authority
- [x] No Phase 8E leak: no run artifact, evidence-index entry, leaderboard row, candidate manifest, prompt, or spec status claims MT5 Strategy Tester parity, MQL5 readiness, deployment readiness, or Phase 8E authorization from Phase 8D evidence
- [x] No post-hoc winner selection: no candidate is advanced because it was the best historical leaderboard family or the best of parameter/asset/timeframe/date-range/cost-model search without a pre-run hypothesis packet and denominator membership
- [x] Phase 8D closeout artifact exists: a timestamped `factory/verification/phase8d-exit-readiness-<timestamp>.json` records met, pending, deferred, and not-applicable criteria

Conditional survivor criteria:

- [ ] Survivor existence, if any, is supported only by pre-registered, artifact-backed WFA screening that clears the Phase 8D floors
- [ ] Each survivor has a registered `candidate_id` under `factory/candidates/` with candidate manifest, source/preregistration references, WFA metrics, gate report, and MT5 instrument equivalence classification
- [ ] A survivor is either backed by terminal-derived `mt5_instrument_equivalence` evidence or explicitly marked `non_mt5_research_only`; `mt5_proxy` is not deployment-proximate evidence
- [ ] A survivor remains research-only until Phase 8E preconditions are independently satisfied

Closeout deferrals, not Phase 8D blockers:

- broad multi-candidate throughput beyond 1-3 initial hypothesis packets; reactivation trigger: the first bounded screening path is stable and backlog quality justifies more volume
- hard statistical promotion gates and deterministic DSR/PBO/CPCV/White input producers; reactivation trigger: a separate promotion-policy amendment after denominator completeness is defensible
- cost-stress or multi-objective optimizer wiring; reactivation trigger: a concrete candidate's mechanism depends on cost sensitivity or objective trade-offs that current diagnostics cannot evaluate honestly
- generic indicator-warmup inference; reactivation trigger: a concrete strategy's indicator state makes leakage/warmup uncertainty the blocking risk
- physical removal or full wiring of inactive optimizer/cost modules; reactivation trigger: a concrete bypass appears or a candidate needs those modules as active evidence
- broad SQLite orchestration authority; reactivation trigger: query complexity, concurrency pressure, or recovery pressure proves JSON artifacts are insufficient
- broad hygiene/archive/quarantine infrastructure; reactivation trigger: artifact volume, retrieval pressure, or reference-validation failures become operational blockers
- Phase 8B exit-readiness builder and stale Phase 8A exit-readiness rerun fix; reactivation trigger: phase-authority ambiguity starts confusing current implementation or verification, not merely methodological symmetry
- Phase 8E MT5 Strategy Tester parity, MQL5 conversion, deployment, forward/demo, or live execution; reactivation trigger: Phase 8D survivor plus verified MT5 instrument equivalence plus explicit operator authorization artifact/control-plane field

#### Phase 8E - MT5 Strategy Tester Parity `[ ]`

Preconditions:

- Phase 8D has a survivor worth serious validation
- Phase 8A verified MT5 instrument equivalence for the candidate
- explicit operator authorization is recorded

Authorization boundary:

- operator authorization must be a disk-backed artifact or explicit recorded control-plane field naming the candidate, family, symbol, account/server context, allowed tester scope, and authorization timestamp
- chat text, prompt wording, or a ResearchBrain recommendation is not authorization
- current parity/promotion helpers must be treated as incomplete for Phase 8E until they verify this authorization boundary

Objective:

- test one serious candidate in the actual MT5/FTMO environment as deployment-proximate evidence

Primary work:

- implement one narrow native MQL5 or template-expanded candidate path for the authorized candidate family
- judge generated `.mq5` source and compiled `.ex5`, not generator narrative
- capture source hash, include hashes, compiler identity, compile logs, warnings, and `.ex5` hash
- launch MT5 Strategy Tester through deterministic worker/controller, not OpenCode GUI operation
- ingest `FILE_COMMON` outputs, tester logs, and tester reports
- compare Python-vs-MT5 behavior through `parity_report_v1` with drift classification
- preserve the minimum viable MT5 bridge pattern: EA `OnInit()` reads config from `FILE_COMMON`, `OnTick()` executes strategy logic, `OnTester()` writes results back to `FILE_COMMON`; a deterministic tester launcher writes `tester.ini`, launches `terminal64.exe`, polls `FILE_COMMON`, and parses results

Expected artifacts:

- `.mq5` source snapshot
- `.set` preset or tester config artifact
- MQL compile report
- `.ex5` hash record
- MT5 tester report/log artifacts
- `FILE_COMMON` run outputs
- `parity_report_v1`

Exit criteria:

- native candidate compiles or blocks with exact diagnostics
- MT5 tester run produces evidence or exact blocked diagnostics
- parity report classifies drift between Python and MT5 behavior
- Python evidence alone still cannot promote a native/deployment candidate

### Phase 9 - Forward/Demo Safety `[ ]`

Status, 2026-05-13: not started. Forward/demo safety remains intentionally blocked until there is a serious tester/parity-validated candidate and the runtime/data/gate prerequisites are in place.

Objective:

- convert tester-validated candidates into forward-validated candidates safely

Phase 9 remains explicitly dependent on Phase 8E tester/parity-validated candidates and explicit operator authorization before implementation begins.

Primary work:

- add account allowlist and account/server fingerprint checks
- add trade-disabled default, manual promotion token, kill switch, max orders, max volume, max exposure, and duplicate-order guard
- add forward/demo state reconciliation
- emit forward-validation artifacts linked to FTMO ledger evidence

Primary targets:

- risk modules under `walk forward engine/src/risk/`
- execution/reconciliation modules under `walk forward engine/src/execution/`
- gate logic under `src/core/`

Exit criteria:

- one tester-validated candidate can become forward-validated under explicit FTMO evidence
- no live/forward order path exists without safety gates

### Phase 10 - Scale-Out And Delayed Governance `[ ]`

Status, 2026-05-13: not started. Scale-out and governance work remains intentionally blocked until the single-candidate execution, evidence, data-readiness, and safety path is stable.

Objective:

- generalize only after the minimal MT5 path produces real artifact volume

Primary work:

- expand from minimal candidate manifest to full candidate registry if needed
- add full artifact lifecycle/hygiene worker only after hashing/manifests are already used
- add curator only for trigger-based ambiguity or memory/retrieval pressure
- expand beyond bounded Phase 8B ResearchBrain only when backlog quality, source volume, or retrieval pressure proves the need; broad source warehouse or unbounded ResearchBrain work requires a separate spec amendment
- expand beyond the Phase 7B minimal SQLite runtime ledger only if concurrency, query complexity, or recovery pressure proves the need
- add more symbols and strategies only after the first path remains stable
- implement PBO/CPCV/White as Phase 7C statistical-validation work before using them as hard gates; they are not required for Phase 8 native proof unless hard statistical promotion is explicitly enabled

Exit criteria:

- breadth does not bypass the graduation ladder
- token/memory/retrieval costs remain bounded as candidate count grows
- governance exists because evidence volume requires it, not because the spec imagined it early

### Sequencing Rules

The following sequencing mistakes are forbidden:

1. running MT5/MQL work before control-plane schemas can represent non-WFA evidence
2. prompt-injecting the full spec into normal agent calls
3. choosing the first fixture before terminal/data identity is measured
4. using `PaperTradingAdapter`, WFA-only output, or signal parity to satisfy MT5/FTMO promotion gates
5. building full candidate registry, curator, hygiene, broad research-intelligence/source-warehouse, or storage-backend machinery before MT5 snapshot and tester proof exist; bounded Phase 8B ResearchBrain is the narrow exception and remains non-authoritative
6. building broad Python-to-MQL5 code generation before one native proof path works
7. implementing many native strategies before bridge safety and tester lifecycle scenarios pass
8. allowing OpenCode agents to operate MT5 GUI/tester jobs directly as official execution
9. adding forward/live execution before safety gates and account fingerprints exist
10. deleting or compacting evidence before hash/manifest/reference safeguards exist
11. accepting new run-level `executed` claims for `research_wfa` without worker-launched provenance
12. letting SQLite, data-readiness, or anti-overfit gate work delay the Phase 7A worker-launched WFA canary
13. treating OpenCode, a direct LLM API, or any agent framework as the production control plane or evidence authority
14. hard-blocking strategies with DSR, PBO, CPCV, or White Reality Check before the relevant trial denominator, statistical implementation, fixtures, and promotion policy are defensible
15. expanding MT5-bound crypto data before enumerating the actual FTMO MT5 tradable universe
16. treating external exchange data as MT5/FTMO deployment-proximate evidence without verified MT5 instrument equivalence and later MT5 parity
17. using ResearchBrain output as profitability evidence or promotion authority
18. selecting historical-leaderboard winners or known best WFA families as default candidate paths without pre-registered hypothesis-packet justification
19. adding low-frequency WFA trade-count exceptions after seeing the results; low-frequency registration must exist before WFA execution
20. building Phase 8E tester/parity work before Phase 8D produces a survivor, MT5 instrument equivalence is verified, and operator authorization is recorded
21. treating Phase 8 evidence-kind names in this spec as implemented validator support before the validator/control-plane code accepts them
22. leaving active agent memory, README files, prompts, or handoff docs pointing to deleted superseded research memos as if they were still source-of-truth files
23. using public FTMO symbol pages, exchange ticker similarity, or ResearchBrain reasoning as a substitute for real MT5 terminal symbol/spec evidence
24. closing Phase 8D because a strategy looks attractive; Phase 8D closeout tests screening-pipeline integrity and denominator discipline, and zero survivors is a valid outcome
25. starting Phase 8E from chat intent, ResearchBrain recommendation, Python WFA attractiveness, or a Phase 8D survivor alone; Phase 8E still requires a survivor, verified MT5 instrument equivalence, and explicit operator authorization

## 13. Open Questions Requiring Empirical Validation

The following questions remain open. They should be resolved by evidence, not preference.

### 13.1 Final Organizational Default Deployment Mode

Open question:

- will the factory default to Mode A or Mode B for most real deployments?

Current rule:

- implementation should remain Mode-B-safe until this is decided

### 13.2 Actual FTMO Terminal Reality

Open questions:

- primary FTMO target for first ledger: `1-step`, `2-step`, or `both`
- account mode on the actual FTMO demo terminal
- symbol specs on the actual server
- broker/server build details
- session/timezone behavior on the actual setup

Resolution method:

- terminal snapshot artifacts, not assumptions

### 13.3 First Official Fixture

Open question:

- should the first official proof path be `EURUSD M15 LondonBreakout`, or should `XAUUSD` replace it due to better real terminal readiness?

Resolution method:

- choose based on actual data and terminal readiness, not on aesthetic preference

### 13.4 Native-Candidate Construction Method

Open question:

- should native serious candidates initially be hand-written, template-driven, or partially generated?

Current rule:

- automated code generation is **not** required for the first proof
- the first proof should prefer the simplest method that yields a trustworthy native candidate

### 13.5 Acceptable Drift Thresholds

Open question:

- what exact parity thresholds should block or allow stage advancement?

Resolution method:

- empirical calibration on the first proof path

### 13.6 Strategies Requiring Earlier Native Graduation

Open question:

- which strategy families require native graduation earlier because they are highly sensitive to MT5-native event semantics?

Likely candidates:

- pending-order-heavy logic
- intrabar-sensitive logic
- timer/event-driven logic
- logic heavily dependent on symbol/account constraints

### 13.7 Terminal Automation Surface

Open question:

- what is the cleanest reproducible way to launch and collect MT5 tester runs on the target machine setup?
- what exact local MT5 terminal path or portable-instance layout is available?
- what repo-contained artifact paths should ingest `FILE_COMMON` outputs without violating repository boundaries?

Current rule:

- the solution must stay compatible with the documented tester constraints and must not become dependent on forbidden or fragile shortcuts

### 13.8 Worker Implementation Boundary

Open question:

- which workers should be implemented in Node, Python, or MQL-supporting scripts?
- should the `MetaTrader5` Python dependency live inside `walk forward engine/requirements.txt`, a separate MT5 worker environment, or both?

Current rule:

- worker language is secondary to deterministic contracts, artifact schemas, timeouts, and reproducibility
- no worker may own official factory state directly

### 13.9 Researcher Tool Surface

Open question:

- which external research tools and sources should be available by default to the researcher?

Current rule:

- the researcher should have broad access to official docs, papers, repos, blogs, forums, and source search
- broad access does not mean broad prompt context
- every source used in a hypothesis must be distilled into a source record or hypothesis packet

### 13.10 Token Budget Targets

Open question:

- what exact token budget should each agent stage target after implementation?

Initial rule:

- normal planning/evaluation prompts should prefer compact capsules under a small fixed budget
- long artifacts stay on disk and enter context only through summaries or targeted ranges
- if a task needs large context, the agent must state why and reference exact paths

### 13.11 Candidate Registry Storage Backend

Open question:

- how much of candidate registry and artifact indexing should move to SQLite after the minimal runtime ledger exists?

Current rule:

- Phase 7B introduces a repo-contained SQLite mirror/projection for runtime run/job/attempt/lease/heartbeat/artifact/trial/outbox evidence at `factory/runtime/factory.sqlite`, unless a later spec amendment chooses another repo-contained local path
- keep the canonical DB repo-contained by default; use WAL only when the repo path is on a local filesystem where SQLite WAL locking is reliable
- if the repo is on DrvFS or another questionable filesystem, use a tested non-WAL mode or block with diagnostics instead of silently trusting unsafe concurrency
- use short transactions, `BEGIN IMMEDIATE` claims, `busy_timeout` plus retry, fencing tokens, leases, heartbeats, transactional outbox, checkpoint observability, and SQLite version checks
- JSON files remain immutable artifacts, human-readable projections, evidence indexes, and candidate artifacts until real query complexity or artifact volume justifies further migration
- no worker may own official factory state directly; workers emit results and the control plane accepts or rejects
- broad SQLite orchestration authority remains deferred until query complexity, concurrency pressure, or recovery needs prove the benefit

### 13.12 Hygiene Cadence And Thresholds

Open question:

- what exact triggers should run hygiene scan and optional curator review?

Initial rule:

- lightweight reference validation may run after each completed cycle
- full hygiene scan should run only on cycle-count, artifact-volume, memory-pressure, repeated-failure, or manual triggers
- curator should run only when deterministic scan finds semantic ambiguity or compaction opportunities

### 13.13 Archive And Quarantine Retention Durations

Open question:

- how long should quarantined unknowns, stale scratch, and bulky archived raw artifacts remain before manual review or deletion eligibility?

Initial rule:

- protected evidence has no automatic deletion TTL
- scratch may have a short TTL after successful ingestion
- quarantine should have a long TTL and require manifest-backed review before deletion

### 13.14 Post-Merge Best-Practice Challenge Sources

Open question:

- which external facts from the 2026-05-17 architecture review should remain durable constraints rather than chat-only context?

Current rule:

- MT5 terminal and tester facts must be verified against official MetaQuotes docs and local terminal artifacts; `symbols_get()` supports terminal-side universe discovery, Strategy Tester has modeling/history limitations, `WebRequest()` is unavailable in tester, and `FILE_COMMON` is the allowed shared-file bridge pattern
- FTMO rule assumptions must be separated from account/server/instrument evidence; public FTMO objectives and symbols pages support recording rule-version, CE(S)T reset assumptions, crypto maintenance/session variation, and simulated-account context rather than inventing broker defaults
- time-series validation must avoid ordinary random CV assumptions; use time-aware WFA, purge/warmup where needed, pre-registration, denominator tracking, and advisory multiple-testing diagnostics instead of post-hoc search confidence
- ResearchBrain design must follow simple bounded-agent practice: use the smallest useful agent surface, structured artifacts, source records, tool-grounded evidence, budget limits, and deterministic validation; do not introduce enterprise frameworks or broad source warehouses unless they directly reduce false positives, evidence loss, or loop failure
- external crypto/exchange data remains discovery/proxy until MT5 equivalence is verified by terminal evidence and, later, MT5 Strategy Tester parity

## 14. Final Direction

This factory will not be allowed to drift into the wrong mental model.

It is **not**:

- a Python simulator trying to impersonate MT5 all the way to deployment confidence
- a broad MQL5-first factory that sacrifices search speed on every idea

It **is**:

- a Python discovery engine
- a bounded LLM reasoning system
- a deterministic worker execution system
- a self-organizing artifact and memory system
- feeding a serious-candidate graduation process
- that becomes native MQL5 when native deployment truth is required
- and uses MT5 tester plus FTMO forward validation as the decisive gate sequence

The decisive operating direction is:

**LLMs reason. Workers execute. Python discovers. MT5 tests. Native MQL5 becomes the Mode-B code authority. FTMO forward validation certifies deployability.**

### Immediate Next Work

Operational state, 2026-06-11: source-quality/intake hardening is implemented and a direct DeepSeek live-through-supervisor canary has reached `stage0_ready`. The old broad unseeded request remains deleted after operator authorization; readiness is `ready` (0 unseeded_valid, terminal failures reconciled, runtime consistency ok, no official/WFA/MT5/Phase8E authority flags). Implemented hardening: adapter-aware live tool exposure, Brave/source retry defaults and backoff, non-terminal source/tool errors returned to the LLM instead of fatal run crashes, malformed provider tool JSON treated as retryable provider output, duplicate `source_id` capture guarded, and `deepseek_v4_flash_xhigh` default output budget raised to 8192 tokens.

Verified DeepSeek Stage-0 supervisor canary: request `factory/research/requests/RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z/request.json` sha256 `e91c060aca188625957e9d0a512b1b8f4555842fdceb2db60e38f3a83d4597da`; run `RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B`; runtime result `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/runtime-result.json` sha256 `5bc4989a42db14dc3d660bcf1f50816859f1d2053d867efa36f4abd12861a8fe`, status `ready`, provider `live_llm_agent`, DeepSeek V4 Flash, no quarantine. Projection `factory/runtime/projections/researchbrain-stage0/EVT-RB-STAGE0-a3dad18693a9a840f03c56f164ec5b85.json` sha256 `bcd9bc596a0d3b0bb1dfcd4e319530e4bd3228a6d3f9c43abd89c136eef7e68a` shows `stage0_ready`.

Accepted artifacts: source record `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/source-records/SRC-LIVE-8192D-001.json` sha256 `7bfb9581fe3cb76828c782436ee1c0fd29c96a561649162755ee131f71375295`; hypothesis packet `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/hypotheses/HYP-STAGE0-LIVE-CANARY-001.json` sha256 `120803bb261b31131efeed4b98927213973bb8127c38c5aac056fd8219a14204`; Stage-0 manifest `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/manifest/manifest.json` sha256 `a3aa7bb688ede97d32fc54eab23ba0bb7dc283f7be78d6c8ff9a9bb442d171a0`. This is Stage-0 discovery only: no profitability label, no WFA, no MT5, no Phase 8E, and no official state/evidence/backlog/leaderboard mutation. The packet is `mt5_relevant_unverified` and not WFA-ready by itself.

Residual operational lesson: direct DeepSeek V4 Flash xhigh can require larger live budgets than fixture runs. Successful canary settings used `--llm-preset deepseek_v4_flash_xhigh`, `--llm-max-tokens` default 8192, `--timeout-ms 180000`, `--max-llm-calls 12`, and explicit live Brave source search/capture opt-ins. Lower 30s/4-turn/8-turn budgets produced expected blocked diagnostic artifacts before final `record_hypothesis`.

**ResearchBrain flexibility = alpha-generation capacity (operating doctrine):**
The ResearchBrain is the factory's primary alpha-discovery engine. Its flexibility, resilience, adaptability, and source-intake richness directly determine the probability of finding genuine edges. Every hardening fix that lets the agent retry, switch sources, or continue past a transient failure multiplicatively increases the surface area the LLM can explore. A fragile tool loop that kills the agent on the first broken link or rate limit is functionally equivalent to no ResearchBrain at all. Source-quality/intake hardening is therefore the highest-priority immediate work — above WFA, above data-readiness, above continuous operation — because until ResearchBrain can reliably produce Stage-0 hypothesis packets, no downstream phase has meaningful input.

**Remaining priorities after source-quality/intake hardening:**
Current bounded continuous-operation slice, 2026-06-12: the Stage-0 supervisor now has an operator-safe queue-drain helper for valid unseeded request artifacts plus dry-run/live-provider policy checks and explicit unattended guardrails. CLI/core flags `--seed-unseeded-valid` and `--auto-seed-limit <n>` enqueue at most 1-25 valid unseeded `researchbrain_request_v1` artifacts per bounded cycle, then run the existing lease/outbox/readiness flow. `--preflight-only` reports exactly which valid unseeded requests would be selected, current readiness blockers, planned job/cost budgets, and redacted live-provider settings without seeding, executing jobs, or projecting outbox. The preflight now also emits a compact `researchbrain_stage0_queue_drain_plan_v1` with selected request IDs/paths/hashes, current claimable job/pending outbox/request counts, estimated runnable jobs/projections/cost, readiness attention classification, guardrail state, and live-canary discipline status. Live queue-drain mode fails closed when required live LLM/source opt-ins or environment-variable presence checks are incomplete, and `--max-estimated-live-cost-usd` fails closed when planned live queue-drain cost exceeds the operator cap, while only reporting environment variable names/booleans and never secret values. New unattended run caps `--max-total-jobs`, `--max-wall-clock-ms`, and `--max-terminal-failures` stop bounded multi-cycle runs before they become runaway loops or repeat terminal failures. New `--require-live-unattended-safe` blocks live queue-drain when live-provider policy has canary-budget warnings, not only hard blockers, so low-token/low-turn/low-timeout live batches cannot start under strict unattended discipline. Run diagnostics now expose auto-seeded request artifacts in cycle/aggregate summaries and guardrail stop reasons in operational summaries. Auto-seeding still refuses to proceed when actionable request/runtime/projection attention exists, keeps terminal-failure reconciliation and readiness diagnostics visible, treats remaining valid unseeded requests as drainable bounded-cycle work, and preserves non-authoritative authority flags: no official state/evidence/backlog/leaderboard mutation, no WFA, no MT5, no Phase 8E, no profitability labels. Focused tests cover bounded multi-cycle auto-seed/drain, dry-run preflight without enqueueing, queue-drain plan summaries, strict live-unattended warning blocks, live-provider/env fail-closed behavior, estimated-cost fail-closed behavior, max-total-job cap, terminal-failure cap, and invalid-request fail-closed behavior.

Status, later 2026-06-12 operator-safe live queue-drain discipline: preflight now emits `researchbrain_stage0_operator_command_profile_v1` with copyable redacted preflight/live command argv+shell strings, selected request refs, estimated cost, env-var presence booleans, do-not-run-live conditions, and explicit false authority flags. Strict unattended live policy now warns/blocks when `max_tool_calls_per_job < 30`; this was added after a bounded live queue-drain canary on `factory/research/requests/RESEARCHBRAIN-REQUEST-MT5-CFD-SOURCE-MAPPING-STAGE0-20260612T1307Z/request.json` reached a clean terminal block from `ResearchBrain tool call budget exceeded: 20`. Runtime artifact: `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-CFD-SOURCE-MAPPING-STAGE0-20260612T1307Z-20C3BB2CA0243332F9522E85/runtime-result.json` sha256 `f96b445a75d066b57050e4f2ab88f3100c5cc45efb08505a075c02b29346accf`; projection `factory/runtime/projections/researchbrain-stage0/EVT-RB-STAGE0-66a8962503e4004b6851ecd6a57bf86b.json` sha256 `5c9f5e28319aa10d6dee27c854fcd6bee2dc91d70f7c4b62c4e85d1e2e69c561`; quarantine `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-CFD-SOURCE-MAPPING-STAGE0-20260612T1307Z-20C3BB2CA0243332F9522E85/quarantine/attempt-001.json` sha256 `83e693493a7782557571dbedb4ad3d12ac245ef3541fae7f0b2aaafa407c9473`. Three narrow MT5/FTMO Stage-0-only requests were created for future bounded queue-drain: `RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z` sha256 `6b5415a334b60fbf0334095d6f250a08a1264e4abd05562e3ceb2c8a2fd5d093`, `RESEARCHBRAIN-REQUEST-MT5-SESSION-REGIME-STAGE0-20260612T1306Z` sha256 `8e36224171487ae971e90bab5f81fd3321986fa5d6792571de6a87b4d2d09386`, and `RESEARCHBRAIN-REQUEST-MT5-CFD-SOURCE-MAPPING-STAGE0-20260612T1307Z` sha256 `9de3fd5a08a25b5d9f5b8a5a3d9ef8bffc2c41978d31db8aef676185d65f971e`. Post-hardening preflight with `--max-tool-calls 30` selected the multi-asset liquidity/volatility request, status `ready`, blockers `[]`, estimated live cost `0.25`, env booleans true, and no mutation. Focused tests `rtk node --test "tests/researchbrain-stage0-supervisor.test.mjs" "tests/researchbrain-stage0-cli-help.test.mjs"` passed 33/33. Readiness command exited 0 with attention only for 2 remaining unseeded valid requests, no pending outbox, runtime consistency ok, expected terminal failures reconciled, and all official/WFA/MT5/Phase8E/deployment/trading/promotion authority flags false. No WFA, MT5, MQL5, Phase 8E, deployment, trading, promotion, or official state/evidence/backlog/leaderboard mutation occurred.

Status, 2026-06-17 bounded live queue-drain with `--max-tool-calls 30`: preflight selected exactly `factory/research/requests/RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z/request.json` sha256 `6b5415a334b60fbf0334095d6f250a08a1264e4abd05562e3ceb2c8a2fd5d093`, status `ready`, blockers `[]`, estimated max live cost `$0.25`, env presence booleans true for `DEEPSEEK_API_KEY` and `BRAVE_SEARCH_API_KEY`, and all official/WFA/MT5/Phase8E authority flags false. One live job was run and blocked cleanly from agent/tool-discipline budget exhaustion, not from schema drift or infrastructure corruption: runtime result `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/runtime-result.json` sha256 `ddd24c8795c12d7f7d67f859a32577b41acde038cc71bf20bd806a615ffd78f9`, quarantine `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/quarantine/attempt-001.json` sha256 `be611560dd0949aeedef29c9bd74e1fb9df6c0b5e73c5c66d53cf6af8e4c7cf7`, projection `factory/runtime/projections/researchbrain-stage0/EVT-RB-STAGE0-33cae77daa9b1c66f8778014bbc48366.json` sha256 `24df48a4b038ef9ac8a51c595d905f7a765d05a4c66c12b4e447a4e919939aca`, supervisor report `factory/verification/researchbrain-stage0-supervisor-runs/researchbrain-stage0-supervisor-run-attention-20260617T201613Z.json` sha256 `05ca9bc62eb1f68a951868e49273b277c09e7178b9a90c6c50efa82797e17981`, tool ledger `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/tool-ledger.json` sha256 `14751d42ef9a7f2224c356aecf08ca7b781f4c4078c8b1867e274a2d09599530`, transcript `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/agent-transcript.jsonl` sha256 `d407ad2c1f23b6b0187465d862e8701196315ba6cf75dbc9fbce4d701bda3ba4`, and cost ledger `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/cost-ledger.json` sha256 `b650bc4400176d2e1dd0572e822a73f41dc0f6202929b7240fb536d30f74e9e4`. Root cause: DeepSeek repeatedly requested broad `search_web` calls, captured only `SRC-FTMO-SYMBOLS-001`, then hit `ResearchBrain tool call budget exceeded: 30` with no valid provider output or Stage-0 manifest. Brave looked functional but free-plan rate-limited: multiple `HTTP 429 RATE_LIMITED` diagnostics cite `plan: Free`, `rate_limit: 1`, `quota_limit: 2000`, and low `quota_current` values, and then succeeded on retry; no payment/monthly-cap failure was observed. Post-run readiness remains `attention` but drainable: 1 valid unseeded request remains, pending outbox 0, runtime consistency ok, terminal failures reconciled/expected, all authority flags false. Next step should be code hardening/agent discipline before provider/service evaluation: cap or batch search calls more strictly, require earlier capture/rejection/finalization, and consider provider-service evaluation only if Brave produces unrecovered quota/payment/monthly-cap failures rather than transient free-plan per-second 429s.

1. [~] Bounded continuous ResearchBrain operation (long-duration source-backed discovery loop): queue-drain, dry-run preflight, redacted live-provider diagnostics, incomplete-live-opt fail-closed policy, estimated-cost cap, max-total-job cap, wall-clock cap, terminal-failure cap, operator command profile, and live canary tool-call floor are implemented; remaining work is longer-duration live-provider canary discipline across real request batches, agent/tool-call discipline, and operator scheduling guidance.
2. MT5-equivalent multi-asset data-readiness expansion.
3. Cleanup is lower priority and must be manifest-first under `factory/cleanup/`, with no deletion/move/archive unless explicitly authorized.

Current note, 2026-06-02: Phase 8A/8B/8C are closed as bounded readiness/hardening work. Phase 8D screening-pipeline validation is closed and the subsequent manual operational screening pass produced zero survivors through the final manual BTC weekly calendar screen `RUN-PHASE8D-BTC-WEEKLY-CALENDAR-20260602202758`. Phase 8E remains blocked. The older long-form item text below is retained as implementation history, but the active next work is no longer manual Phase 8D roulette.

Completed Phase 8 sequence status and next implementation work:

1. [x] 8A: enumerate the real FTMO MT5 tradable universe and record non-authoritative universe/inventory/history/data-relevance artifacts
2. [x] 8A: classify current research instruments as `mt5_verified`, `mt5_proxy`, or `non_mt5_research_only`; current repo data is not MT5-bound without future equivalence evidence
3. [x] 8B partial: implement deterministic Stage-0 contracts, validators, retrieval/indexing, request preparation, runtime seam, and fixture/scripted tool-loop plumbing
4. [x] 8B: split fixture/live tool modes so live search/capture cannot use injected search results or LLM-supplied source content
5. [x] 8B: add output-directory/run-id collision guards
6. [x] 8B: centralize Stage-0 field allowlists and profitability alias rejection
7. [x] 8B: enforce memory/duplicate/failed-pattern checks before `record_hypothesis`
8. [x] 8B: restrict `read_repo_artifact` to approved artifact roots and deny sensitive/unrelated files
9. [x] 8B: enforce provider `research_run_id` identity
10. [x] 8B: add provider-agnostic live LLM adapter seam and run one bounded source-backed canary; seam/flags, OpenAI-compatible/DeepSeek LLM boundary, `opencode_deepseek_v4_pro` preset, deterministic injected source search/capture boundary, Brave source adapter boundary, one real source-backed live canary, and Ideator/backlog consumption by valid packet/source path/hash are done
11. [x] 8B/8C: propagate ResearchBrain source hashes through WFA-ready compiler and add trust-tier/rejection retrieval gates before Phase 8D screening; packet/source hash propagation, single-low-signal-source WFA-ready blocking, explicit duplicate/rejection/failed-pattern memory-signal blocking, and same-run ideation-manifest duplicate/rejection/blocker gating are done
12. [~] 8C: harden WFA engine output and validation: first slice done for minimal canonical YAML contract, output-directory alignment, output-root truth validation, and WFE/WFR missing-input diagnostics; second slice emits artifact-backed IS Sharpe from the optimizer objective into normal WFA outputs; third slice adds optional `purge_gap_bars` validation-row purging and emitted diagnostics while explicitly not claiming full indicator warmup protection; fourth slice emits selected-parameter training-slice IS return only when the training backtest reports success and finite return, allowing WFE readiness where both IS and OOS return inputs exist; fifth slice verifies WFE/WFR readiness computation from artifact-backed accepted WFA metrics and blocks zero-IS-return WFE with exact diagnostics; sixth slice emits fail-loud `optimization_truth` diagnostics for disconnected multi-objective/cost modules and fixes the narrow `TransactionCostModeler` instrument-details guard bug; seventh slice tightens positive research-WFA evaluator labels and research-promotion gate diagnostics to Phase 8D minimum floors; eighth slice adds low-frequency registration validation/storage; ninth slice adds prompt guardrails that survivor floors are validation gates, not optimization targets; tenth slice consumes valid low-frequency registrations to adjust only the trade-count floor; eleventh slice adds `research_wfa_preregistration_v1` validation/storage; twelfth slice consumes pre-registration before explicit Phase 8D/screening WFA launch; thirteenth slice records diagnostic-only `indicator_warmup_bars`; fourteenth slice blocks contradictory optimizer/cost truth diagnostics; fifteenth slice records artifact-backed parameter-stability diagnostics without making them gates; sixteenth slice preserves and fail-loud-validates diagnostic-only warmup truth in worker output; seventeenth slice blocks malformed parameter artifacts separately from missing parameter diagnostics; eighteenth slice makes research-gate reports consume worker WFE/WFR readiness; still pending broader warmup handling beyond explicit diagnostics, real disconnected optimizer/cost cleanup or full wiring, and broader anti-overfit hardening
13. [x] 8C: add low-frequency registration and enforce Phase 8D positive/survivor floors: validator/promotion-gate minimum floors are enforced for 8 windows, 200 trades, 5%+ return proxy, and 70% positive windows; `low_frequency_registration_v1` artifact validation/storage exists; evaluator prompt guardrails require pre-run hash-backed registration for any future exception and prohibit tuning to survivor-floor thresholds; trade-count exception consumption now requires candidate/run-scoped hash-backed pre-result registration and can adjust only the trade-count floor; `research_wfa_preregistration_v1` artifact validation/storage now exists for candidate-scoped hash-backed Stage-0 hypothesis/source, frozen-field, and denominator-control pre-registration; explicit Phase 8D/screening WFA launch now requires/validates the artifact when intent is declared; advisory-stat authority handling now explicitly marks DSR/PBO/CPCV/White as non-authoritative advisory-only outputs; Phase 8D screening is now closed as zero-survivor validation/operational evidence and Phase 8E remains blocked
14. [~] 8C: preserve worker-emitted `parameter_stability`, `optimization_truth`, and `warmup_diagnostics` in research-gate reports as reporting-only anti-overfit diagnostics, with explicit flags for blocked WFE/WFR inputs, missing/invalid diagnostic evidence, weak/incomplete parameter-stability evidence, missing cost-stress evidence when only fee/slippage assumptions exist, invalid unbacked cost-stress claims when `stress_tested: true` lacks hash-backed `cost_stress_result` artifacts or complete fee/slippage cost-assumption source artifacts, active-cost-input mismatch versus reported cost assumptions, disconnected optimizer/cost module visibility, generic warmup-not-applied boundary visibility, missing non-worker attempt denominator context, incomplete/mismatched/internally inconsistent optimizer-trial accounting versus optimizer-search context, multiple-comparison context undercounting of known attempts, bounded remediation backlog actions for repeated artifact-backed failures with anti-spam guards against unknown-scope matches and remediation cascades, direct-WFA ResearchBrain candidate blocking when the same-run ideation manifest is missing, malformed, run-id mismatched, does not list the candidate packet as accepted with matching hash, or omits exact packet/source artifact refs, backlog-candidate blocking when source-quality-blocked Stage-0 items carry explicit WFA launcher/config intent in commands, WFA config fields, nested data-acquisition metadata, implementation steps, or artifact/output containers, and planner-provenance blocking when a ResearchBrain-derived plan tries to create a direct WFA route from a source-quality-blocked Stage-0 candidate via evidence kind, WFA config object, top-level or data-acquisition command, or repo-/engine-relative canonical WFA config path references including recursively nested structured values and Windows path separators; no promotion/rejection/statistical authority is added
15. [x] 8D: implement and run hypothesis-led candidate screening from ResearchBrain packets or contract-conformant manual packets only; pre-register all attempts, deny historical-leaderboard default paths, record denominator membership, prove blocked-at-start gates, and close with zero survivors if gate-integrity criteria are met; manual operational screening is stopped for now after zero survivors through `RUN-PHASE8D-BTC-WEEKLY-CALENDAR-20260602202758`
16. [ ] 8E: begin only after a Phase 8D survivor, verified MT5 equivalence, and explicit operator authorization artifact/control-plane field

Most reasonable next non-8E work, 2026-06-02:

1. [~] Continuous ResearchBrain/factory-loop activation: first bounded supervisor queue-drain helper implemented via `--seed-unseeded-valid` + `--auto-seed-limit`; still needs unattended live-provider operating policy and longer-duration canary discipline before it is a full discovery loop.
2. [ ] Data-readiness expansion: broaden terminal-backed history probes and research datasets across the 167-symbol FTMO universe; prefer symbols/timeframes with real MT5 history availability, explicit data relevance classification, and later `mt5_instrument_equivalence` paths instead of name-similar external proxy assumptions.
3. [ ] Runtime reliability and queue durability: improve the autonomous loop's durable queue/state/ledger behavior, retry/recovery, poison quarantine, circuit breakers, and unattended execution so the factory can run many discovery/screening cycles over days or weeks without requiring a manual survivor immediately.
4. [ ] ResearchBrain quality gates and retrieval/failure memory: strengthen source-quality scoring, duplicate/failure-pattern retrieval, rejection-memory use, and hypothesis comparison so ResearchBrain raises candidate quality before deterministic WFA launch.
5. [ ] Optional WFA/data hardening only when directly motivated: add cost-stress, multi-objective, statistical-input producers, or additional WFA diagnostics only when a concrete candidate or artifact-backed bypass shows the current evidence path is insufficient.

Worker launch, Python discovery, MT5 testing, and native MQL5 Mode-B code authority remain unchanged.

### Final Rule

No future implementation is acceptable if it quietly reintroduces the forbidden path:

- Python-only serious candidates
- late native porting after confidence has already been granted
- or deployment claims that outrun the actual validated code family
- or LLM-agent narrative pretending to be deterministic execution evidence
- or new WFA execution claims without worker-launched provenance
- or cleanup convenience outrunning evidence preservation

That is the architecture direction for this repository.

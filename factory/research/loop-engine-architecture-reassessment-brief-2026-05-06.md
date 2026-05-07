# Loop Engine Architecture Reassessment Brief

Date: 2026-05-06

Status: open architecture question, not a conclusion.

Purpose: decide whether the current autonomous research loop should continue to depend on OpenCode/OpenCode SDK as its agent engine, or whether the loop should be redesigned around a different execution substrate before the WFA-only launch is treated as production-ready.

## Core Context

This project exists because the long-term objective is not to manually build one more trading bot. The objective is to build a research factory that can continuously search for, test, reject, refine, and eventually promote robust trading strategies.

The business/research thesis is:

- Markets change.
- Static bots decay.
- A useful system must keep researching.
- The creative part must generate new hypotheses, discover possible edges, read outside sources, synthesize ideas, and convert them into testable strategies.
- The deterministic part must enforce evidence, run WFA correctly, prevent fake success, record artifacts, reject weak results, and eventually map surviving strategies toward real capital deployment.

The user has spent roughly one year and two months trying agentic trading-bot workflows: top gainers, BTC, SOL, and other bot attempts. The conclusion that led to this factory is that a system that can create and evaluate strategies may be more valuable than any single fixed strategy.

This makes the loop engine itself a critical dependency. If the research factory has excellent code and excellent evidence discipline but the underlying agent engine is unreliable, slow, weak, or unsuitable for 24/7 unsupervised operation, then the architecture may be elegant but practically unusable.

## Immediate Trigger

Recent WFA-only launch attempts failed before WFA execution because live OpenCode agent calls were brittle:

- Old poisoned runs were initially resumed because of a control-plane recovery issue. That was a code bug and was fixed.
- After stale resume pointers were cleared, a fresh curated WFA canary reached the planner but failed before creating a plan.
- Planner attempt 1 returned no usable RF JSON.
- Planner attempts 2-3 timed out waiting for first response headers.
- No WFA execution, evaluator output, summary, or evidence update occurred.

This raises a fundamental question: is the loop failing because the current OpenCode SDK integration is brittle, because the chosen model/agent is too weak, because the orchestrator design is wrong, or because the whole premise of using a coding-agent CLI as a 24/7 research-loop engine is mismatched?

## Non-Negotiable Objective

The final system must be capable of unsupervised 24/7 research operation.

It does not need to be live-trading now. It does need to reliably perform the research loop:

- discover or generate ideas
- plan narrow experiments
- run deterministic WFA/backtest infrastructure
- verify artifacts on disk
- evaluate evidence honestly
- remember what failed and why
- continue to the next useful experiment without human babysitting

The system should eventually support changing the “brain” while preserving the deterministic machine. The strategy factory should not be permanently trapped behind one brittle agent transport if the rest of the architecture can be made engine-agnostic.

## Primary Questions To Answer

### 0. Is OpenCode the right brain, or only a development tool?

This is the sharper version of the engine question.

There are two separate layers that must not be confused:

- The deterministic orchestrator: queue state, stage gates, artifact validation, WFA execution, evidence indexing, retries, and recovery.
- The cognitive brain: the model/agent that researches, reasons, proposes experiments, writes code changes, interprets failures, and decides what is worth exploring next.

Today, the repository has a deterministic JS orchestrator, but the cognitive brain is routed through OpenCode/OpenCode SDK agent calls. That means OpenCode is not merely a shell command runner. In practice, it is acting as the live research/planning/execution brain for the loop.

This must be questioned directly.

Questions:

- Should OpenCode be the brain of the factory, or only a human-facing development assistant?
- Should the autonomous loop depend on OpenCode agents for planning and execution, or should it call a different brain directly?
- Is the current failure pattern caused by OpenCode SDK transport, by weak model selection inside OpenCode, by OpenCode agent prompting/session behavior, or by using a coding-agent product as a daemon brain?
- If OpenCode regular chat works better than SDK, does that help a 24/7 loop, or only supervised development?
- If the default model is weak, does switching OpenCode's model fix the core issue, or only hide a deeper runtime mismatch?
- Should the loop support multiple brains behind one deterministic interface: direct LLM API, OpenCode, Claude Code-style agents, web-research agents, local models, and human-seeded ideas?
- Should the brain be stateless and replaceable, while the machine remains stable and deterministic?
- Can the brain be benchmarked independently from the loop with JSON compliance, latency, timeout rate, research quality, and strategy novelty metrics?

Possible conclusion to test:

- OpenCode may be excellent as an interactive coding/research assistant but not necessarily the right unattended brain for 24/7 autonomous alpha research.
- The loop may need a brain abstraction: `ResearchBrain` or `CognitiveEngine`, with OpenCode as one backend rather than the central architecture.
- The default production brain might be direct API access to a stronger model with strict structured outputs, while OpenCode remains available for development/debugging and special coding tasks.

Required assessment:

- Evaluate OpenCode not only as SDK transport, but as the cognition layer currently driving the loop.
- Compare it against direct model APIs and alternate agent runtimes as the actual research brain.
- Decide whether OpenCode should be central, optional, fallback, or removed from the autonomous runtime path.

### 1. How functional can this loop be if it runs through OpenCode SDK?

Questions:

- Is OpenCode SDK designed for long-running autonomous loops, or mostly for interactive coding sessions?
- Does it provide stable enough session creation, request/response handling, timeout behavior, and recoverability for 24/7 operation?
- Are first-header timeouts a known limitation, provider issue, local server issue, model latency issue, SDK bug, or orchestration misuse?
- Can OpenCode SDK calls be made deterministic enough for a control plane that requires structured JSON outputs?
- Does the SDK expose enough observability to debug failures without guessing?
- Can it safely run multiple stages over time without session contamination, stale state, plugin drift, browser dependencies, or server metadata mismatch?
- What is the expected failure rate over 100, 1,000, and 10,000 agent calls?
- What recovery behavior is realistic: retry, restart server, switch provider, fall back to deterministic worker, or skip the item?
- Is there a documented production pattern for OpenCode SDK agent loops, or are we inventing one?

Evidence required:

- Web research on OpenCode SDK behavior, issues, docs, timeout reports, and agent/session lifecycle.
- Direct repo evidence from current failures.
- A small reliability benchmark design: repeated planner-like calls, repeated executor-like calls, JSON compliance rate, timeout rate, latency distribution, server restart success rate.

### 2. Why OpenCode SDK at all?

Questions:

- What is the actual rationale for OpenCode SDK in this project?
- Is the benefit tool access, coding-agent autonomy, file editing, terminal execution, model routing, session memory, prompt/tool orchestration, or convenience?
- Which of those benefits are truly needed inside the autonomous factory loop?
- Which parts could be replaced by direct LLM API calls plus deterministic tools?
- Is OpenCode SDK adding useful capability, or mostly adding a fragile server/session layer between the orchestrator and the model?
- Does OpenCode SDK make it easier or harder to enforce strict RF JSON schemas?
- Does it make it easier or harder to swap models/providers?
- Does it make it easier or harder to run headless, unattended, and long-term?

Possible benefits to validate:

- Standardized coding-agent environment.
- Existing tool execution and workspace interaction.
- Familiar CLI ecosystem similar to Claude Code-style workflows.
- Agent roles and session URLs for debugging.
- Model-provider abstraction.
- Reuse of a known open-source tool rather than building a custom agent runtime from scratch.

Possible costs to validate:

- Extra server process and session lifecycle complexity.
- SDK transport failures that are outside the factory’s deterministic control.
- Weak/default model choices affecting structured output and planning quality.
- Less precise control than direct model API calls.
- Poor fit for 24/7 daemon-style operation if OpenCode is optimized for interactive use.

### 3. Why LLM at all, instead of deterministic code?

The answer cannot be generic. It must be specific to alpha research.

Questions:

- What can an LLM do here that deterministic code cannot do well?
- Is the LLM needed for ideation, external research, strategy translation, debugging, code editing, evaluation, summarization, or all of those?
- Which loop stages are genuinely creative or open-ended?
- Which loop stages should never depend on LLM judgment?
- Is an LLM useful enough to justify its failure modes: hallucination, schema failures, slow response, cost, non-determinism, and weak reasoning under bad model selection?
- Can the system isolate LLM creativity from deterministic truth so creativity helps generate alpha without corrupting evidence?

Initial hypothesis:

- LLMs may be valuable for idea generation, research synthesis, translating papers/blogs/repos into hypotheses, debugging unexpected failures, and proposing next experiments.
- LLMs should not be the authority for whether a WFA executed, whether artifacts exist, whether metrics are real, whether a strategy passes, or whether money should be risked.
- The profitable-machine thesis depends on the LLM being a creative researcher, not an oracle.

### 4. Is the current split between LLM stages and deterministic stages logical?

The spec appears to assume a hybrid design:

- LLM-based: ideation, planning/research, maybe interpretation and summarization.
- Deterministic: execution workers, WFA launcher, artifact validation, schema validation, gates, evidence indexing, promotion/parity checks.

Questions:

- Is that actually how the code behaves today?
- Does the executor still rely too much on LLM behavior when it should route to deterministic workers?
- Should the planner be required for already explicit backlog items, or should a deterministic planner/translator handle WFA-ready tasks?
- Should ideation/research produce structured experiment intents, then deterministic code compiles those intents into plans?
- Should execution be fully deterministic once a plan is accepted?
- Should evaluation be mostly deterministic metrics + rule checks, with LLM only writing interpretation?
- Should summarization be LLM-authored but deterministic-state-owned?
- Are the current role boundaries strong enough to prevent the LLM from being a bottleneck in every stage?

Core architecture question:

Should this be an “LLM loop that calls deterministic tools,” or a “deterministic loop that occasionally asks LLM researchers for ideas and explanations”?

For 24/7 unsupervised operation, the second may be safer.

### 4b. Is the loop truly researcher-led, or mostly pre-decided backlog execution?

The user does not want research ideation to be deterministic in the sense of pre-decided strategies, fixed templates, or a static backlog. The desired alpha-generation loop is more spontaneous:

- researcher discovers something new or timely
- researcher forms a hypothesis from that finding
- planner converts it into a falsifiable WFA experiment
- deterministic execution validates or rejects it
- memory updates so the next research step is smarter

The constraints should be domain and evidence constraints, not idea constraints.

The user-provided bounds are mainly:

- focus on tradable markets such as crypto, forex, and assets that may eventually map to MT5/FTMO-style deployment
- evidence over claims
- no fake metrics or artifacts
- WFA research before platform/deployment oracle work
- deterministic validation once an idea becomes an experiment

Questions:

- Is the current loop actually researcher-led, or is it primarily executing manually curated backlog items?
- Does the ideator browse the web and synthesize fresh market findings, or mostly remix local memory/backlog artifacts?
- Should there be a dedicated `researcher` stage before ideation that actively searches external sources for potential edge formation?
- Should ideation be allowed to originate from live market/news/funding/liquidity/regime findings rather than only existing repo memory?
- Are current prompt constraints too restrictive by forcing one narrow WFA-ready idea immediately?
- Should the loop separate broad research discovery from narrow experiment planning?
- Should the planner be forbidden from inventing new workstreams, while the researcher is explicitly encouraged to discover them?
- Should execution remain deterministic after research produces a plan, even though the idea source is spontaneous?
- Should deterministic workers accept researcher-generated experiment intents instead of requiring pre-seeded backlog items?

Current-code hypothesis to verify:

- The present ideator is bounded to produce one specific, narrow, WFA-ready backlog item and is mainly pointed at local files/memory.
- The planner is explicitly told not to ideate new workstreams.
- The executor follows the accepted plan.
- This is evidence-safe, but may be too pre-bounded for the user’s intended “live researcher that finds edge anywhere” concept.

Possible better design:

- Add or elevate a `researcher` brain stage whose job is open-ended external discovery inside domain bounds.
- Researcher output is not execution. It is a sourced research memo or structured hypothesis candidate.
- Ideator converts promising findings into experiment intents.
- Planner narrows only after the spontaneous research finding exists.
- Deterministic execution/WFA remains strict and artifact-driven.

Key principle:

Creativity should be unconstrained enough to discover potential alpha, but validation must be deterministic enough to avoid fake alpha.

### 5. What is the best way to run this specific loop unsupervised 24/7?

This is the main research question.

Options to compare:

- OpenCode SDK as the main agent engine.
- OpenCode regular chats/manual sessions for supervised research only.
- Direct LLM API calls with strict JSON schemas and deterministic tool runners.
- A queue-based worker architecture where LLM calls are optional jobs, not the control plane.
- Multiple model/provider fallback: strong model for research/planning, cheap model for summaries, deterministic worker for execution.
- Browser/web-research agent separated from code execution agent.
- Local benchmark harness that continuously measures agent-engine reliability before trusting it with long loops.

Questions:

- Which architecture has the best chance of running overnight, daily, and weekly without human babysitting?
- Which architecture lets the user change the “brain” without rewriting the machine?
- Which architecture gives the best balance of creativity, reliability, cost, observability, and reproducibility?
- Does OpenCode regular chat make sense for human-in-the-loop work, while the 24/7 loop uses a stricter API/worker design?
- Should OpenCode be treated as a development assistant, not the production research-loop runtime?
- Is the current model choice, possibly MiniMax 2.5, too weak for reliable structured planning and research synthesis?
- Should the loop require a stronger model for planner/researcher roles, even if it costs more?
- Should model/provider selection be an explicit part of the spec, with reliability gates and fallback policies?

## Required Deep Research Work

Before finalizing the loop architecture, perform a hard web and codebase research pass.

Research must cover:

- OpenCode SDK official docs.
- OpenCode GitHub issues related to SDK, server mode, sessions, timeout, fetch failed, streaming, headless operation, and long-running automation.
- Any examples of OpenCode SDK used for unattended agent loops.
- Known limitations of coding-agent CLIs as production automation backends.
- Comparisons with direct LLM API orchestration for structured agent loops.
- Best practices for 24/7 autonomous research agents: queues, heartbeats, retries, idempotency, model fallback, structured output validation, deterministic execution, and artifact-first state.
- Whether regular OpenCode chat is more reliable than SDK calls, and whether that matters for automation.
- Whether failures are likely caused by OpenCode, provider/model latency, local WSL/Windows networking, SDK request timeouts, or the factory’s own orchestration.

The research output should not defend the current architecture by default. It should be willing to say:

- keep OpenCode SDK
- use OpenCode SDK only for development/debugging
- replace OpenCode SDK for the autonomous runtime
- keep the spec but swap the agent engine
- redesign the loop around deterministic workers and optional LLM research jobs

## Decision Criteria

The final answer should score each engine option on:

- 24/7 reliability
- structured JSON compliance
- timeout/retry observability
- ability to swap models/providers
- web-research capability
- code-editing capability
- deterministic execution integration
- artifact/evidence discipline
- debugging ergonomics
- operational simplicity for a solo quant project
- cost control
- ability to generate creative alpha ideas
- ability to avoid fake evidence and overfitting

The result should include a concrete recommendation, not only pros/cons.

## Hard Questions That Must Be Answered Honestly

- Are we building a beautiful factory on top of a brittle engine?
- Is OpenCode SDK the correct runtime, or only a convenient development bridge?
- If OpenCode SDK fails 5-20% of calls, can the loop still be useful?
- If the planner often fails to output RF JSON, should the planner be deterministic for WFA-ready tasks?
- Should the loop continue if the ideator fails, but never if deterministic execution fails?
- Should the loop have a “no LLM required” path for already-curated WFA tasks?
- Does an LLM executor make sense, or should the executor be a deterministic dispatcher?
- Is the creative part currently too entangled with the execution part?
- Can the system generate alpha if the research agent is weak?
- Should stronger models be mandatory for ideation/research, while cheaper models handle summaries?
- What does “live research” mean operationally: always browsing, scheduled research cycles, event-triggered research, or backlog-driven experimentation?
- What should happen overnight if all LLM providers fail?
- What should happen if an LLM produces a brilliant idea but no deterministic route can validate it?
- What should happen if deterministic WFA finds a promising result but LLM evaluation is unavailable?

## Possible Architecture Directions To Explore

### Direction A: Keep OpenCode SDK, Harden Around It

Use OpenCode SDK as the main engine but add stronger recovery:

- server restart on first-header timeout clusters
- provider/model fallback
- strict JSON repair/retry prompts
- shorter prompts
- deterministic bypass for ready WFA tasks
- reliability dashboard
- periodic canary benchmark

Open question: is this enough, or just patching the wrong substrate?

### Direction B: OpenCode For Development, Direct LLM API For Runtime

Use OpenCode chats/tools for human-supervised development, but production loop uses direct provider APIs with:

- structured outputs
- explicit schemas
- queue jobs
- deterministic workers
- model routing by stage
- retry/fallback policies

Open question: would this reduce brittleness enough while preserving creative research?

### Direction C: Deterministic Control Plane With Optional LLM Researchers

The orchestrator never depends on LLM to advance deterministic work already specified.

LLMs propose ideas and write interpretations. Deterministic workers own:

- plan compilation for known strategy templates
- WFA execution
- artifact validation
- metrics extraction
- gate decisions
- state transitions

Open question: does this preserve enough creativity, or make the system too rigid?

### Direction D: Multi-Brain Research Factory

Keep the machine stable and allow interchangeable brains:

- OpenCode agent
- direct API agent
- web research agent
- local model agent
- human-seeded backlog

The loop accepts structured research intents from any brain, but only deterministic evidence can move candidates forward.

Open question: is this the most future-proof architecture for a solo project?

### Direction E: Brain-Orchestrator Split With Replaceable Cognitive Engine

Make the deterministic orchestrator the only production control plane. It owns state, queues, locks, retries, evidence gates, WFA execution, and artifact validation.

Behind it, define a replaceable cognitive engine interface:

- `proposeIdea(context) -> structured idea`
- `researchTopic(topic, constraints) -> sourced synthesis`
- `draftExperiment(intent) -> structured experiment plan`
- `debugFailure(artifacts) -> hypotheses and patch suggestions`
- `interpretEvidence(metrics, artifacts) -> narrative and next actions`

Possible brain backends:

- OpenCode SDK agent
- regular OpenCode/Claude-Code-style supervised session
- direct OpenAI/Anthropic/Gemini API with strict schemas
- web-research-specialized agent
- local model for cheap summarization
- human-written research intent

In this design, OpenCode is not the factory. It is one possible brain plugin.

The core research machine stays alive even if one brain fails:

- ready deterministic WFA tasks can still execute
- evidence validation still works
- state remains consistent
- failed brain calls become blocked research jobs, not loop-wide failures
- model/provider choice becomes operational policy, not architecture destiny

Open question: should this become the north-star architecture before WFA-only launch, because it best matches the user's goal of a long-lived adaptive research factory?

## Desired Final Outcome Of This Research

The next deep review should produce:

- clear diagnosis of current OpenCode/OpenCode SDK suitability
- evidence-backed recommendation for the runtime engine
- specific architecture changes if needed
- explicit answer to whether OpenCode SDK should remain central
- 24/7 unsupervised operation design
- model/provider policy for creative vs deterministic stages
- minimal migration path that does not throw away the existing spec or evidence discipline

The important distinction:

- The spec may still be valuable.
- The WFA and evidence machine may still be valuable.
- The current engine behind the loop may or may not be the right one.

This must be answered before treating WFA-only autonomous launch as solved.

# Executive Decision

Recommendation: redesign the production autonomous loop around a deterministic, engine-agnostic control plane that launches bounded, agentic `ResearchBrain` or `CognitiveEngine` jobs. This is not a choice between an OpenCode agentic loop and shallow one-shot API prompts. The intended pattern is `deterministic control plane -> bounded agentic research brain jobs -> deterministic validation/WFA/evidence`. OpenCode/OpenCode SDK should remain valuable for supervised development, debugging, repo exploration, and optional bounded research/coding-agent jobs, but it should not remain the central 24/7 unsupervised runtime control plane or evidence authority.

Confidence: high that OpenCode SDK should not be the sole production runtime/control plane; medium-high that deterministic workers plus replaceable agentic brain backends are the best next production path; medium that a later multi-brain architecture is worth adding after the deterministic base is stable.

Direct answers to the core questions:

1. OpenCode SDK is not currently proven functionally reliable enough for this loop's 24/7 central brain role. It is capable and useful, but current repo evidence plus upstream issue evidence do not justify treating it as the durable execution substrate.
2. OpenCode is better treated as a development/tooling interface and optional cognitive backend, not the production control plane.
3. Direct LLM APIs are not inherently shallow. They are more suitable as one substrate for bounded agentic brain jobs and schema-bound outputs because repo code can own tool loops, budgets, schemas, retries, provider fallback, and observability.
4. The orchestrator should be deterministic and engine-agnostic.
5. The loop should have a replaceable `ResearchBrain` or `CognitiveEngine` interface.
6. WFA-ready backlog tasks should bypass LLM planning when they satisfy a deterministic WFA-ready schema with explicit strategy, config, data, and command route.
7. The creative researcher should browse web, papers, repos, news, market data, and source feeds before ideation.
8. The current ideator is too constrained for spontaneous alpha discovery: it produces one WFA-ready backlog item from local memory/retrieval and does not have a dedicated external discovery stage.
9. The best architecture is spontaneous researcher-led hypothesis discovery plus deterministic source capture, plan compilation, WFA execution, artifact validation, scoring, and memory.
10. 24/7 unattended operation should include discovery, source capture, hypothesis generation, deterministic WFA, evidence scoring, memory updates, and failure recovery. Human supervision should remain mandatory for new trusted data-source classes, deployment/risk changes, MT5/FTMO/live promotion, and irreversible evidence deletion.
11. Use strong/frontier models for researcher, ideator, planner, and evaluator; use cheaper schema-reliable models for summarizer and JSON repair; use deterministic code for execution and gates.
12. Launch requires reliability gates: durable queue/state, leases, heartbeats, poison quarantine, idempotent artifacts, circuit breakers, watchdog, restart recovery, provider fallback, strict schemas, and evidence validation.
13. Minimal migration: keep the existing repo and OpenCode integration, add a brain interface, add deterministic WFA-ready plan compilation and deterministic WFA workers, then move live production away from `runner.callAgent` as the mandatory stage path.

# Bottom Line

OpenCode SDK should become optional, not central. The current production path should be replaced by a deterministic-worker-first architecture where the LLM can be a genuinely agentic researcher/planner/evaluator backend and deterministic code owns official state, WFA execution, artifacts, metrics, gates, and promotion decisions.

This is not a rejection of OpenCode. OpenCode has official server, SDK, CLI, agent, tool, and structured-output capabilities. It is a strong development assistant and can remain one backend behind an abstraction. The issue is role fit: a long-lived alpha research factory needs a durable machine that occasionally asks cognitive engines for ideas, not a coding-agent session system that acts as the machine itself.

Final mental model:

```text
The factory should not be an LLM agent pretending to be a machine.
It should be a deterministic machine that hires agentic researchers.
Researchers may roam; evidence may not.
```

The research brain can search, browse, inspect repos, read papers, follow leads, reject weak ideas, refine hypotheses, and return structured proposals. The research brain cannot mark WFA executed, invent metrics, mutate official state, promote strategies, or convert its own claims into evidence.

# Evidence Summary

Strongest evidence:

| Evidence | Fact | Interpretation for this factory |
|---|---|---|
| Repo state | Latest live canary failed in planner before WFA: attempt 1 had no RF JSON, attempts 2-3 timed out waiting for first response headers. See `factory/runs/RUN-20260505194725-nlq8sd/gate-results.json:5-45` and `factory/state.json:3-15`. | Current live loop cannot be claimed 24/7-ready. It can fail before any deterministic WFA work happens. |
| Repo transport health | `factory/health.json` records 46 transport failures, 29 `first_headers` failures, and OpenCode SDK as the dominant first-header failure adapter at `factory/health.json:46-72`. | This is not a single one-off timeout. It is a repeated operational risk. |
| Repo executor yield | Executor completion rate is 20 allowed executor gates out of 142, 14.08 percent, at `factory/health.json:113-117`. | The current loop has low live execution throughput. More prompt polish alone is unlikely to satisfy unattended operation. |
| Repo architecture | Live mode creates a live transport and every structured stage calls `runner.callAgent(...)`; `src/core/orchestrator.mjs:776-778`, `src/core/orchestrator.mjs:1383-1398`, and `src/core/orchestrator.mjs:1452-1588`. | OpenCode/LLM is in the critical path for planner, executor, evaluator, and summarizer. Planner failure blocks WFA. |
| Repo JSON path | Current integration extracts `<RF_JSON>` from free text after the agent response, `src/core/orchestrator.mjs:1392-1398`. The SDK call body does not pass OpenCode's documented structured-output schema in `src/core/transport/opencode-sdk-transport.mjs:121-130`. | The repo is not using the strongest structured-output capability available even within OpenCode. |
| OpenCode official docs | OpenCode has `opencode serve`, SDK, OpenAPI server, sessions, agents, CLI `run`, `--attach`, and SDK structured output using a `StructuredOutput` tool with validation retries. Docs last updated May 6, 2026. | OpenCode is capable for programmatic control. The question is not capability, but production-runtime suitability and failure isolation. |
| OpenCode upstream issues | Current/open issues and PRs include `opencode run` hanging after tool calls, MCP tool crashes in v1.14.39, API/free model timeout issues, and a session streaming race PR. | Upstream is active and serious, but session/tool/server behavior has enough churn that it should not be the factory's only durable runtime. |
| Direct API docs | OpenAI Structured Outputs state schema adherence is guaranteed for supported models; JSON mode only guarantees valid JSON. Anthropic recommends simple composable workflows, direct APIs when possible, and code-controlled workflows for predictability. | Direct API calls are better suited for schema-bound stages and deterministic orchestration. |
| Agent architecture evidence | Anthropic distinguishes code-controlled workflows from autonomous agents and recommends agents for open-ended problems only with ground-truth feedback, stopping conditions, testing, and guardrails. | This supports bounded agentic research jobs, not agent ownership of execution truth or official state. |
| Reliability sources | Temporal, BullMQ, Celery, Kubernetes/Docker, and circuit-breaker patterns all assume durable tasks, retries, heartbeats, workers, and watchdogs separate from business logic. | The factory needs queue/worker reliability architecture, not only an agent session retry loop. |
| Quant research sources | Backtest-overfitting literature and walk-forward guidance emphasize data validation, OOS discipline, trial accounting, overfitting controls, and promotion gates. | LLM creativity must be isolated from evidence authority. |

Main uncertainty:

There is no public, audited OpenCode SDK 24/7 unattended loop reliability benchmark matching this factory's usage. Absence of evidence is not proof of unsuitability, but for a production research factory it is insufficient to keep OpenCode SDK as the single central runtime without independent soak tests.

# Current Codebase Reality

The current repo is already partly hybrid, but the live loop still behaves like an LLM/OpenCode-driven loop that calls deterministic validation after the fact.

Current stage flow:

| Stage | Current owner | Current reality |
|---|---|---|
| Backlog selection | JS orchestrator | Local deterministic selection from `factory/backlog.json`, market policy, evidence, lessons. Ready policy uses status `ready` and min ready depth 3 at `factory/market-policy.json:44-60`. |
| Ideator | OpenCode agent in live mode | Spawned when ready backlog is below policy floor at `src/core/orchestrator.mjs:850-870`. Prompt says one backlog candidate only, `src/prompts/ideator.md:1-16`. |
| Planner | OpenCode agent in live mode | Always required for fresh research runs; starts at planner and validates RF JSON at `src/core/orchestrator.mjs:1452-1480`. |
| Executor | OpenCode agent in live mode | LLM executor is responsible for doing work and returning execution JSON; only after that do validators check artifacts at `src/core/orchestrator.mjs:1483-1537`. |
| Evaluator | OpenCode agent in live mode | LLM returns evaluation JSON; deterministic validator checks shape and artifact references at `src/core/orchestrator.mjs:1543-1569`. |
| Summarizer/memory | OpenCode agent plus deterministic state writes | LLM summary JSON is converted into summary, evidence index, and lessons by the orchestrator at `src/core/orchestrator.mjs:1573-1609`. |

Critical path facts:

- Live mode creates `createLiveTransport(...)`; simulate mode uses `SimulateRunner`, `src/core/orchestrator.mjs:776-778`.
- The live transport defaults to SDK or HTTP, but SDK is the default adapter in `src/core/transport/live-transport.mjs:24-31`.
- `OpenCodeSdkTransport` imports `@opencode-ai/sdk` at `src/core/transport/opencode-sdk-transport.mjs:1`.
- The server manager spawns `opencode serve`, `src/core/transport/opencode-server-manager.mjs:178-202`.
- Every structured stage writes prompt artifacts, calls `runner.callAgent`, parses `<RF_JSON>`, validates, and records a gate, `src/core/orchestrator.mjs:1376-1423`.
- Planner, executor, evaluator, and summarizer all use this same `executeStructuredStage` path, `src/core/orchestrator.mjs:1452-1588`.

The current loop has deterministic safeguards but not deterministic execution ownership:

- Validators reject fake WFA execution if observed metrics are missing, canonical WFA provenance is missing, result artifacts are absent, or no walk-forward window completed, `src/core/validators.mjs:464-492` and `src/core/validators.mjs:717-759`.
- The WFA envelope worker can officialize existing WFA artifacts with hashes and provenance, but it explicitly records `execution_was_run_by_this_worker: false`, `src/workers/research-wfa-envelope-worker.mjs:142-154`.
- The package exposes `wfa:envelope`, not a deterministic full WFA execution worker, `package.json:22`.

The current ideation path is not spontaneous alpha discovery:

- The ideator prompt asks for one specific WFA-ready idea and returns only JSON, `src/prompts/ideator.md:1-31`.
- The ideator prompt builder gives cycle facts, market policy, local retrieval, and exact local files to inspect, `src/core/prompt-builders.mjs:337-355`.
- Ideator retrieval is local live lessons and promotable evidence only, `src/core/retrieval.mjs:152-163`.
- There is no dedicated external-source `researcher` stage before ideation.

WFA-ready backlog tasks are structured enough for deterministic bypass, but the current orchestrator does not implement that bypass:

- Ready tasks already contain exact data, strategy, and expected WFA config paths, for example `factory/backlog.json:995-1023`, `factory/backlog.json:2233-2260`, and `factory/backlog.json:2544-2571`.
- Fresh runs still begin at planner. Executor cannot start without a persisted plan, `src/core/orchestrator.mjs:1452-1485`.
- The recent failed canary backlog item already had `expected_wfa_config_path`, `expected_strategy_config_path`, and `expected_strategy_source_path`, but died at planner, `factory/runs/RUN-20260505194725-nlq8sd/planner-attempt-3/stage-error.json:32-60`.

Current launch readiness is blocked:

- `factory/verification/rollout-gate-20260505200440396.json:16-24` records `ready_for_rollout: false`, `no_quarantined_runs: false`, and prompt budget issues.
- The latest state records `exit_reason: run_failed`, `last_status: error`, and `last_error: planner transport request timed out waiting for response headers`, `factory/state.json:3-15`.

# OpenCode SDK Assessment

OpenCode SDK strengths:

- Official JS/TS SDK for interacting with the OpenCode server.
- Can start server and client via `createOpencode()` or connect to an existing server via `createOpencodeClient()`.
- Server exposes health, sessions, messages, files, events, commands, agents, and OpenAPI 3.1.
- CLI supports non-interactive `opencode run`, `--format json`, `--attach`, `--agent`, `--model`, `--dir`, and `opencode serve`.
- Docs explicitly recommend attaching `opencode run` to an existing server to avoid MCP cold boot on every run.
- SDK structured output supports JSON schema through a `StructuredOutput` tool, with `retryCount` and `StructuredOutputError` after validation retries.
- Agent config supports per-agent prompts, models, permissions, task permissions, temperature, steps, and tools.

OpenCode SDK weaknesses for this factory:

- It adds server startup, server health, session creation, streaming, provider routing, tool execution, session persistence, plugin behavior, and client/server state as runtime dependencies.
- Official docs document programmatic use, but not a production-grade durable job model with leases, queue ownership, poison queues, restart recovery, idempotent execution, or long-running SLA behavior.
- Current repo evidence shows planner failure before WFA due to missing RF JSON and SDK first-header timeouts.
- Upstream issue traffic shows session/tool/run lifecycle risk, including open issue #17516 where `opencode run` hangs after tool calls, open issue #25914 where MCP tool calls crash in v1.14.39, issue #9733 around REST/session/free model timeout behavior, and PR #26079 for a session streaming race.
- The current repo uses `opencode/minimax-m2.5-free` for global and every factory agent, `opencode.json:3`, `opencode.json:31`, `opencode.json:48`, `opencode.json:65`, `opencode.json:85`, and `opencode.json:104`. Weak or slow default models increase JSON, planning, timeout, and research-quality risk.
- The current repo does not use OpenCode SDK structured output. It prompts for `<RF_JSON>` and parses free text, which is brittle compared to provider-native strict schemas.

OpenCode SDK verdict:

OpenCode SDK is acceptable as one optional `CognitiveEngine` backend after benchmarks, not as the central production runtime. To keep it in any autonomous path, require a soak test with stage-specific structured output, server restart recovery, timeout distribution, schema compliance rate, and WFA canary pass rate. Until it passes, fail closed and use direct API plus deterministic workers for production research loops.

# OpenCode As Control Plane / Agentic Backend Assessment

OpenCode is best understood as a coding-agent environment: TUI, server, SDK, CLI, sessions, agents, tool permissions, file operations, terminal integration, and developer workflow. That is valuable for building this repo.

This section is not an argument against agentic research. It is an argument against letting OpenCode, or any one agent runtime, become the production control plane, evidence authority, and execution truth source by default.

The production alpha factory needs a different center of gravity:

- It needs durable state and recoverable stages more than interactive session continuity.
- It needs deterministic WFA execution more than agentic shell autonomy.
- It needs strict schemas more than prose-delimited JSON blocks.
- It needs provider fallback more than one OpenCode-configured model path.
- It needs source provenance and artifact truth more than a rich coding transcript.
- It needs to continue when one cognitive backend degrades.

OpenCode as central brain creates tight coupling between three concerns that should be separate:

| Concern | Current coupling risk | Recommended owner |
|---|---|---|
| Thinking | OpenCode agent session | Replaceable `ResearchBrain` backend |
| Execution | OpenCode executor agent runs shell/workers | Deterministic worker process |
| Official truth | Orchestrator validates after agent returns | Orchestrator and deterministic gates only |

OpenCode should remain:

- interactive development assistant
- manual deep debugging interface
- codebase exploration assistant
- optional backend for bounded research/coding-agent tasks
- fallback researcher when direct API web research fails
- benchmark candidate, not unbenchmarked production dependency

If OpenCode is used as an agentic backend, it should receive a bounded job contract: allowed tools, max wall time, max turns, max cost, repo/file boundaries, output schema, required source/artifact references, and explicit prohibition on official state mutation. Its output should enter the same deterministic validation path as every other brain backend.

# Direct LLM API Assessment

Direct provider APIs fit this loop better when they are used as the substrate for controlled, auditable brain jobs, not when they are reduced to shallow `prompt -> answer` calls.

The correct comparison is not:

```text
OpenCode agentic loop vs one-shot API prompt
```

The correct comparison is:

```text
OpenCode as production control plane
vs
deterministic control plane that can call direct-API agentic jobs, OpenCode jobs, or other brain backends
```

Advantages:

- Provider-native strict schemas: OpenAI Structured Outputs, Anthropic strict tool use, Google Vertex response schemas, and other schema modes reduce malformed JSON risk.
- Better error classes and metadata: HTTP status, request IDs, rate-limit headers, usage, latency, safety/refusal fields, and provider-specific retry behavior are easier to log.
- Easier model fallback: stage-specific provider ladders can switch from one provider/model to another without changing the deterministic machine.
- Easier cost controls: per-stage token budgets, batch APIs, prompt caching, daily spend caps, and model tiers are direct.
- Easier observability: each cognitive call can be logged as `brain_call_id`, provider, model, schema, request hash, response hash, latency, token usage, validation result, and repair/fallback history.
- No local OpenCode server/session dependency for routine planner/evaluator/summarizer JSON.
- Better fit for queue workers: every LLM request is just a job activity with bounded retries and idempotent outputs.

Disadvantages:

- The repo must implement provider adapters, schema registry, prompt assembly, retry/fallback policy, and tool-call loop logic.
- Direct APIs do not automatically provide a rich coding-agent workspace; code edits need deterministic patch generation or a separate bounded coding backend.
- A direct API architecture still needs careful prompt/tool design and evaluation. It does not remove LLM non-determinism.
- One-shot direct API calls are too shallow for serious alpha discovery if used alone.

Decision:

Use direct APIs as the default production substrate for repo-controlled agentic research jobs and strict schema-returning cognitive stages. Use OpenCode only when a task specifically benefits from coding-agent workspace behavior, and run it behind the same bounded `ResearchBrain` contract.

# Agentic Research Brain Assessment

The choice is not only between one-shot API calls and OpenCode as the whole factory. The intended option is a bounded agentic research brain job called by deterministic orchestration.

In this model, the control plane creates a bounded research job and gives the brain tools, budget, context, and a strict output contract. The brain is allowed to behave autonomously inside that sandbox: search broadly, fetch sources, read papers/repos/news, query market APIs, inspect relevant repositories, compare mechanisms, reject weak ideas, refine hypotheses, and return structured outputs plus source references.

The key distinction is authority:

- The agent owns exploration.
- The deterministic orchestrator owns official state.
- The agent returns proposals, hypotheses, source references, and critique.
- Deterministic workers capture/verify sources, compile plans, run WFA, parse metrics, write evidence, and enforce gates.

This differs from weak one-shot API research:

```text
bad: prompt once -> model invents ideas -> trust answer
```

It also differs from making OpenCode the whole factory:

```text
bad: coding agent plans/runs/mutates/reports truth -> validators try to catch mistakes later
```

Preferred pattern:

```text
deterministic orchestrator
  -> create bounded research job
  -> agentic research brain uses allowed tools autonomously
  -> deterministic source capture and validation
  -> structured hypothesis/experiment intent
  -> deterministic plan compiler or planner brain
  -> deterministic WFA executor
  -> deterministic evidence gates
```

An agentic research brain can be implemented through multiple backends:

- direct provider API with a tool-use loop controlled by repo code
- LangGraph/CrewAI/AutoGen-style research workflow
- dedicated web-research API plus model synthesis
- OpenCode SDK as an optional bounded backend
- a custom researcher process that uses search/fetch/market-data tools and calls a strong model such as DeepSeek 4 Pro or another frontier model

Quality assessment:

- API-based research is not automatically shallow. It is shallow only if implemented as one call and one answer.
- High-quality agentic API research requires iterative tool use, source capture, claim extraction, contradiction checks, novelty checks against memory, and a final critic pass.
- A strong model improves synthesis quality, but the surrounding research loop determines whether the output is deep, sourced, and testable.
- The system should benchmark research brains on source quality, novelty, testability, WFA-ready conversion rate, latency, cost, and downstream evidence yield, not only on whether they return valid JSON.

Recommended conclusion:

The production architecture should explicitly support agentic research brain jobs. The objection is not to agentic research. The objection is to letting an agentic coding environment become the production control plane or evidence authority.

Four distinct runtime modes must not be conflated:

| Mode | Shape | Good for | Failure risk | Decision |
|---|---|---|---|---|
| One-shot API research | `prompt -> answer` | Small transforms, summaries, schema repair, simple extraction | Shallow synthesis, hallucinated confidence, weak source chasing | Not sufficient as final research design |
| Agentic API research | Code launches brain job; brain uses tools/search/fetch/market APIs; brain loops internally; brain returns structured output | Serious alpha discovery, source synthesis, hypothesis generation, critique | Needs sandboxing, budget limits, source validation, benchmark discipline | Recommended primary research-brain pattern |
| OpenCode/SDK backend | OpenCode agent session as bounded research/coding backend | Repo-aware coding, supervised debugging, optional exploratory agent jobs | Transport/session/tool churn; state/evidence coupling if central | Keep optional and benchmarked, not central |
| Deterministic factory machine | Queue, leases, state, source capture, WFA, artifacts, metrics, gates, memory writes | 24/7 reliability, reproducibility, evidence truth | Not creative by itself | Must own production control plane |

Direct answers to agentic-brain questions:

| Question | Answer |
|---|---|
| Is API-based research inherently lower quality than interactive/agentic LLM research? | No. API-based research is lower quality only when implemented as a shallow one-shot prompt. API access can drive a serious multi-step agentic loop if repo code gives it tools, memory, search, critique, stop conditions, and source capture. |
| What makes API research high quality? | Iterative search expansion, source capture with provenance, primary-source preference, claim extraction, contradiction checks, novelty checks against memory, falsification criteria, final critic pass, strict structured output, and deterministic validation after return. |
| Difference between one-shot API and agentic API brain? | One-shot asks for an answer. An agentic brain receives a bounded job, chooses tool calls, follows leads, inspects sources/data/repos, revises hypotheses, and returns structured proposals plus source references. |
| Can DeepSeek 4 Pro or a frontier-model brain be strong enough if wrapped seriously? | Yes, if benchmarked. Model strength matters, but scaffold quality matters as much: tool design, step budget, source capture, memory, critic passes, and deterministic validation decide whether outputs become useful research. |
| Should production support agentic research jobs rather than only strict call-answer schemas? | Yes. Strict schemas should constrain final outputs and tool calls, not eliminate exploratory loops. Serious alpha discovery needs bounded autonomy. |
| How can the researcher be creative without faking evidence? | Give the brain freedom to propose hypotheses, not authority to mark truth. Every external claim needs source capture; every trading claim needs deterministic data/WFA artifacts; unsupported outputs become `proposed`, `blocked`, or `not_testable`, never evidence. |
| What tools should the research brain have? | Web search, page fetch/crawl, repo read/search, paper/doc retrieval, market-data availability checks, funding/open-interest/liquidity feeds where available, source memory, experiment-memory retrieval, deterministic data-catalog inspection, and optional patch proposal tools. |
| What limits/sandboxing should it have? | No credential access, no live trading, no official state mutation, no arbitrary deletion, no unbounded shell, no unrestricted filesystem, no hidden network writes, max wall time, max tool calls, max spend, max tokens, allowlisted domains/APIs, and separate read-only research sandbox from execution workers. |
| What should deterministic code validate after the brain returns? | Schema validity, required fields, source URLs/artifacts, content hashes, publication/retrieval timestamps, repo-relative paths, data availability, duplicate/near-duplicate ideas, no invented metrics, no unsupported evidence claims, testability, WFA-ready route fields, and blocked/inconclusive semantics. |
| How should research-brain quality be benchmarked? | Valid schema rate, source-backed claim rate, unsupported-claim rate, novelty, duplicate rate, testability, plan acceptance rate, WFA-ready conversion rate, downstream WFA execution rate, evidence yield, false-success rate, latency, cost, and human-intervention rate. |

Recommended brain tools:

- Search: Exa, Tavily, Brave/SerpAPI, curated RSS/news feeds.
- Fetch/capture: Firecrawl or deterministic crawler that stores raw markdown/html, title, publisher, retrieved_at, published_at, canonical URL, and content hash.
- Market/data: Binance, CCXT, CoinGecko, DefiLlama, funding/open-interest sources, liquidity/volume data, GDELT/news APIs where relevant.
- Repo/docs: repo read/search, Context7/docs retrieval, paper fetch, GitHub source inspection for relevant open-source strategy implementations.
- Memory: retrieval over failed mechanisms, evidence index, leaderboard, source-quality history, and repeated blocker patterns.
- Planning helpers: data-catalog inspection, strategy/config path resolver, deterministic plan compiler preview, WFA feasibility checker.
- Critique: independent model or separate pass that attacks testability, look-ahead risk, data-snooping risk, overfitting risk, and source weakness.

Recommended sandbox limits:

- Read-only by default for research jobs.
- Writes only to source-capture/research-artifact directories through deterministic tools.
- No writes to `factory/state.json`, `factory/backlog.json`, `factory/evidence/index.json`, `factory/leaderboard.json`, or official memory files.
- No live trading, broker credentials, account actions, or irreversible operations.
- No unbounded shell; command execution only through approved deterministic workers.
- Max wall time, max steps, max searches, max fetched pages, max token budget, max spend, and max retries per job.
- Domain/API allowlists for autonomous network access.
- All tool calls logged with request parameters, outputs, hashes, and timestamps.

Deterministic validation after brain return:

- parse against `research_hypothesis_v1`, `source_claim_v1`, or `experiment_intent_v1` schemas
- verify every factual external claim has a source record
- verify source records have URL, retrieved_at, content hash, and stored raw content or snippet
- classify unsupported, stale, conflicting, or not-testable claims
- check whether the hypothesis maps to available data or an explicit data acquisition route
- check duplicate similarity against prior ideas, failures, and evidence
- require falsification criteria and expected failure modes
- require explicit market, instrument/selection rule, timeframe, data requirements, and WFA feasibility
- reject or downgrade any wording that implies evidence before WFA artifacts exist

Benchmark target:

```text
A better research brain is not the one that writes the most ideas.
It is the one that converts the most exploration into reproducible,
falsifiable, artifact-backed evidence with low human intervention
and low false-success rate.
```

# Deterministic Worker Assessment

The following stages should be deterministic or deterministic-first:

| Stage | Deterministic ownership | LLM role |
|---|---|---|
| Backlog queue and leasing | Control plane | None |
| Source fetching and source storage | Deterministic crawler/API clients | Suggest sources and queries |
| Source provenance | Deterministic hashing, timestamps, URL capture | Summarize only after capture |
| Data validation | Deterministic workers | Explain failures, propose fixes |
| WFA-ready plan compilation | Deterministic compiler when explicit route exists | Planner only for ambiguous/non-ready tasks |
| WFA execution | Deterministic Python/JS worker launching canonical WFA | None during execution, except bounded debugging if blocked |
| Artifact validation | Deterministic validators | None |
| Metric extraction | Deterministic parsers from WFA output | None |
| Evidence score pre-gates | Deterministic scoring + thresholds | Optional narrative evaluator after metrics are real |
| Promotion gates | Deterministic rule engine | Optional critique, no authority |
| Official state mutation | Control plane only | None |
| Summary prose | LLM can draft | Control plane writes official state and links artifacts |

The current repo already has some of this discipline in validators. The missing piece is moving execution itself behind deterministic workers instead of requiring an LLM executor to run commands and report back.

Brain jobs may propose commands, patches, source leads, or experiment intents. Only deterministic workers may execute accepted plans, and only deterministic validators may convert outputs into evidence.

WFA-ready bypass rule:

If a backlog item has explicit `evidence_kind: research_wfa`, authority layer, instrument/timeframe, strategy source path, strategy config path, WFA config path, dataset path, canonical command route, and success gates, the deterministic plan compiler should generate `experiment-plan.json` without calling the LLM planner. This directly addresses the current failure mode where an explicit BNB canary died in planner before WFA.

# Researcher-Led Alpha Discovery

The factory should add a distinct `researcher` stage before ideation. Its job is open-ended discovery inside domain and evidence constraints.

Recommended discovery pipeline:

| Layer | Output | Evidence status |
|---|---|---|
| Web/market discovery | Search queries, URLs, source candidates, raw snippets | Not evidence |
| Source capture | URL, title, publisher, retrieved_at, published_at, content hash, raw markdown/html path | Source artifact |
| Claim extraction | Atomic claims with source IDs and quotes/snippets | Sourced claim, not trading evidence |
| Claim verification | Stale/conflicting/unsupported/not-testable labels | Research hygiene |
| Hypothesis synthesis | Mechanism, market, timeframe, tradable variable, expected edge | Untested hypothesis |
| Ideator | One experiment intent from a hypothesis | Backlog candidate |
| Planner/compiler | Falsifiable plan | Experiment plan |
| Deterministic WFA | Metrics/artifacts | Evidence |

Key rule: researcher output can create hypotheses, not evidence. Only deterministic WFA artifacts and validated metrics can enter evidence, leaderboard, promotion, or positive memory.

Recommended research sources and tools:

- Semantic discovery: Exa, Tavily, Brave Search, SerpAPI.
- Source capture: Firecrawl or deterministic fetcher that stores raw content and content hashes.
- Synthesis with citations: direct LLM API or Perplexity-style API, but only after raw sources are captured separately.
- Market validation feeds: Binance, CoinGecko, DefiLlama, CCXT, CryptoPanic, NewsAPI, GDELT, Polygon where relevant.
- Curated watchlists: RSS and deterministic polling for exchange announcements, protocol blogs, funding/open-interest/liquidity data, market microstructure feeds.

Why this matters:

The current ideator is evidence-safe but not alpha-discovery-rich. It remixes local memory into one WFA-ready item. That is useful for backlog replenishment, but it is not the user's stated goal of a researcher that can spontaneously find fresh potential edges from outside sources.

# Architecture Options

## Keep OpenCode SDK Central

Description: preserve current architecture where OpenCode SDK agents run planner, executor, evaluator, summarizer, and sometimes ideator.

Pros:

- Lowest migration effort.
- Keeps existing prompts and artifacts.
- Good interactive debugging and code-editing capability.
- OpenCode has official SDK/server/CLI support.

Cons:

- Current failures occur exactly in this critical path.
- Planner failure prevents deterministic WFA execution.
- OpenCode server/session behavior remains production dependency.
- `<RF_JSON>` parsing remains brittle unless reworked.
- No engine abstraction.

Verdict: not recommended for production 24/7.

## Harden OpenCode SDK

Description: keep OpenCode central but add structured-output schema use, server restarts, health checks, SSE monitoring, better model choice, timeouts, transport benchmarks, and fallback to HTTP/CLI.

Pros:

- Preserves most existing work.
- Could improve current canary reliability quickly.
- Uses OpenCode's documented structured output and server APIs.

Cons:

- Still leaves OpenCode as central dependency.
- Still couples cognition, tooling, sessions, and server lifecycle.
- Hardening around a brittle critical path may create complex recovery code.
- Does not solve spontaneous research architecture by itself.

Verdict: useful as transitional stabilization, not final production architecture.

## Deterministic Runtime With Direct/API Research Brain Backend

Description: keep OpenCode for supervised repo work and optional debugging. Production loop uses direct provider APIs, agent frameworks, and optional OpenCode jobs as interchangeable `ResearchBrain` implementations, while deterministic workers own execution.

Pros:

- Clear separation of interactive development from unattended runtime.
- Stronger schema compliance and provider observability.
- Removes OpenCode server/session from routine production path.
- Keeps OpenCode available where it shines.

Cons:

- Requires new provider adapter/schema work.
- Requires deterministic code-edit and worker pathways for implementation tasks.
- Less reuse of OpenCode agent permissions and session tooling unless OpenCode is added as an optional backend.

Verdict: strong near-term target.

## Deterministic Orchestrator With Replaceable Agentic Brain

Description: define `ResearchBrain`/`CognitiveEngine` interface. Brain backends may be agentic and tool-using; replaceable does not mean shallow. Direct APIs can be the default backend, OpenCode can be one optional backend, and future engines can be added without changing the factory machine.

Pros:

- Best fit for 24/7 reliability and future-proofing.
- Lets the user benchmark brains independently.
- Preserves creativity while protecting evidence discipline.
- Deterministic WFA can continue when researcher/planner is unavailable.
- Supports model/provider strategy by stage.

Cons:

- Medium migration complexity.
- Requires schema registry and adapter tests.
- Requires clear boundaries between brain outputs and deterministic commands.

Verdict: recommended architecture.

## Multi-Brain Research Factory

Description: multiple cognitive engines run in parallel or by stage: web researcher, direct LLM planner, OpenCode coder, independent evaluator, cheap summarizer, local repair model.

Pros:

- Highest research creativity and provider resilience.
- Independent evaluator can reduce model-specific bias.
- Can route expensive models only to high-value stages.

Cons:

- Higher cost and operational complexity.
- More moving parts before the deterministic base is proven.
- Harder for a solo project if added too early.

Verdict: good later evolution after deterministic-worker-first base is stable.

# Scored Decision Matrix

Scale: 1 poor, 5 strong. Higher migration score means easier migration. Higher cost score means lower/healthier cost.

| Option | 24/7 reliability | Alpha creativity | Structured output | Web research | WFA integration | Evidence discipline | Provider flexibility | Cost | Solo maintainability | Migration ease | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Keep OpenCode SDK central | 2 | 4 | 3 | 3 | 3 | 3 | 3 | 4 | 3 | 5 | 33 |
| Harden OpenCode SDK | 3 | 4 | 3 | 3 | 4 | 4 | 3 | 3 | 3 | 4 | 34 |
| Deterministic runtime with direct/API research brain backend | 4 | 5 | 5 | 4 | 4 | 5 | 5 | 3 | 4 | 3 | 42 |
| Deterministic orchestrator with replaceable agentic brain | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 3 | 46 |
| Multi-brain research factory | 4 | 5 | 4 | 5 | 5 | 5 | 5 | 2 | 2 | 2 | 39 |

Decision from matrix:

The highest-scoring target is deterministic orchestrator with replaceable agentic brain. The best migration posture is to first implement a direct-API agentic research backend for cognitive jobs and deterministic WFA workers, while preserving OpenCode as a development/backend option. Multi-brain should be delayed until after core reliability is proven.

# Recommended Architecture

Recommended production loop:

```text
watchdog / scheduler
  -> durable queue / backlog lease
  -> bounded agentic researcher brain job
  -> source capture worker
  -> claim extraction brain job
  -> claim verification worker
  -> ideator brain job
  -> deterministic WFA-ready compiler OR planner brain job
  -> deterministic plan validator
  -> deterministic executor worker
  -> deterministic artifact/metric validator
  -> deterministic gates and score precheck
  -> evaluator brain job for critique only
  -> deterministic evidence/state writer
  -> summarizer brain job
  -> deterministic memory/index writer
```

Stage ownership:

| Stage | Primary owner | Brain allowed? | Notes |
|---|---|---:|---|
| Scheduler/watchdog | Deterministic JS/Python | No | Owns leases, heartbeats, stale recovery, circuit breakers. |
| Researcher | Brain plus deterministic source tools | Yes | Open-ended discovery; output is sourced hypotheses, not evidence. |
| Source capture | Deterministic worker | No | Fetch URL/content, timestamp, hash, store raw source artifacts. |
| Claim extraction | Brain with strict schema | Yes | Extract atomic claims with source IDs and quotes. |
| Claim verification | Deterministic plus optional brain critique | Limited | Mark unsupported, stale, conflicting, not testable. |
| Ideator | Brain with strict schema | Yes | Converts sourced hypothesis into one experiment intent. |
| Planner | Brain only when needed | Yes | Used for ambiguous tasks, new strategies, or data acquisition plans. |
| Deterministic plan compiler | Deterministic | No | Bypasses planner for WFA-ready tasks with explicit route fields. |
| Executor | Deterministic worker | No | Runs canonical WFA and records stdout/stderr/output artifacts. |
| Evaluator/gates | Deterministic first, brain second | Limited | Metrics/gates are deterministic; brain writes critique. |
| Summarizer/memory | Brain draft, deterministic write | Yes | LLM summarizes; orchestrator writes official memory/state. |

`ResearchBrain` interface sketch:

```text
runBrainJob({ stage, mode, schemaId, input, modelPolicy, toolPolicy, budget, sandbox })
  -> {
       parsed,
       raw_text,
       provider,
       model,
       request_id,
       latency_ms,
       token_usage,
       tool_calls,
       source_records,
       schema_valid,
       validation_errors,
       fallback_chain,
       source_artifacts
     }
```

`mode` should explicitly distinguish `one_shot_structured`, `agentic_research`, `agentic_code_proposal`, `critic`, and `repair`. The same backend may support multiple modes, but the control plane should know which authority boundary applies.

Brain backends:

- `direct_openai`: default candidate for strict schema and web/search-enabled agentic jobs where available.
- `direct_anthropic`: strong researcher/planner/evaluator backend; strict tool use where available.
- `direct_google` or other provider: fallback or evaluator diversity.
- `opencode_sdk`: optional bounded coding-agent backend, not official executor authority.
- `agent_framework`: LangGraph/CrewAI/AutoGen-style wrapper if it improves multi-step research without hiding state.
- `local_or_cheap_repair`: JSON repair/summarization only, never evidence authority.

Model/provider policy by stage:

| Stage | Model tier | Output mode | Fallback rule |
|---|---|---|---|
| Researcher | Frontier/high-reasoning with web/search/tools | Agentic research loop plus strict source/hypothesis digest | If unavailable, use alternate provider; do not fabricate sources. |
| Ideator | Strong/frontier | Strict JSON experiment-intent schema | One repair attempt, then fallback provider. |
| Planner | Frontier/high-reasoning | Strict plan schema | Skip if deterministic compiler can handle WFA-ready task. |
| Plan compiler | Code | Deterministic JSON | No LLM needed. |
| Executor | Code | Worker result envelope | No LLM unless blocked debugging path is triggered. |
| Evaluator | Frontier/high-reasoning, preferably different provider than planner | Strict evaluation schema | Deterministic gates remain authoritative if evaluator unavailable. |
| Summarizer | Cheap schema-reliable | Strict summary/lesson schema | Cheap fallback allowed. |
| JSON repair | Cheap constrained model or local guided decoding | Exact target schema | No semantic authority. |

24/7 unattended scope:

- allowed: source discovery, source capture, hypothesis queueing, deterministic data checks, WFA execution, artifact validation, failure memory, inconclusive/rejected evidence updates, retries, quarantine, and compact operator packets.
- not allowed without human approval: live trading, FTMO/demo enabling, new broker/execution integration, capital/risk changes, trusting a new source class as authoritative, deleting protected evidence, or promoting beyond research-only WFA.

Required reliability and observability gates before launch:

1. Durable run ledger with run, stage, attempt, lease owner, lease expiry, heartbeat, status, failure class, and artifact manifest.
2. Deterministic stage state machine with atomic state transitions.
3. Worker leases and expired-lease recovery tested by killing processes mid-stage.
4. Heartbeats for long WFA and long research tasks.
5. Poison/quarantine queue for repeated same-signature failures.
6. Retry classification: transient, schema invalid, artifact missing, transport, dependency unavailable, data invalid, permanent, poisoned.
7. Exponential backoff with jitter and max attempts.
8. Circuit breaker for provider/model/OpenCode/data-source failure bursts.
9. Idempotent artifact writes with run/stage/attempt paths and content hashes.
10. Deterministic artifact validation before `executed`, `evaluated`, or `summarized` is allowed.
11. Provider metadata logging: provider, model, request ID, latency, tokens, rate-limit headers when available, schema errors, fallback path.
12. Queue and health metrics: queue depth, oldest queued age, heartbeat lag, stage duration, retries, poison count, WFA success rate, evidence yield.
13. Watchdog process that scans stale heartbeats, expired leases, open circuits, runaway retries, and no-evidence-yield windows.
14. Soak tests: 100 planner-like calls, 100 evaluator-like calls, 20 WFA-ready deterministic canaries, forced malformed JSON, forced provider timeout, worker kill, missing artifact, and stale lease recovery.
15. Launch gate requiring sustained WFA evidence production, not only successful prompts.

# Minimal Migration Plan

Phase 0: Freeze the decision boundary.

- Mark OpenCode SDK as current live adapter, not future production assumption.
- Keep existing OpenCode prompts, agents, and transport for development/debugging.
- Do not claim WFA-only production launch until deterministic WFA canaries pass through the new gates.

Phase 1: Add schema and brain abstraction without removing OpenCode.

- Define `ResearchBrain`/`CognitiveEngine` interface.
- Add schema registry for ideator, planner, evaluator, summarizer, source claim, and hypothesis outputs.
- Define `ResearchBrainJob` limits: allowed tools, max steps, max wall time, max spend, max fetched sources, source artifact rules, output schema, and authority boundary.
- Add direct provider adapter for one strong provider first.
- Add OpenCode SDK as a compatible backend only after it supports the same schema contract.
- Persist raw brain calls with provider metadata and validation errors.

Phase 2: Add deterministic WFA-ready plan compiler.

- Define `wfa_ready_backlog_item_v1` schema.
- If a backlog item has explicit strategy source/config/WFA config/data paths, compile `experiment-plan.json` deterministically.
- Use this bypass for current curated ready items, such as BNB canary and BTC volatility-regime tasks.
- Keep LLM planner only for non-ready or ambiguous tasks.

Phase 3: Add deterministic full WFA executor worker.

- Implement a worker that runs the canonical `walk forward engine` command, captures stdout/stderr, verifies output paths, parses metrics, records windows completed, hashes artifacts, and returns the worker result envelope.
- Keep the current WFA envelope worker for officializing existing artifacts, but do not treat it as execution.
- Make executor agent optional and no longer required for WFA-ready runs.

Phase 4: Move official evaluator/gates deterministic-first.

- Compute hard gates from metrics/artifacts before calling an LLM evaluator.
- LLM evaluator writes critique, overfitting risks, and follow-up suggestions only after deterministic gates establish what exists.
- If evaluator brain fails, preserve deterministic verdict as `needs_narrative_evaluation` or similar, not as failed WFA execution.

Phase 5: Add researcher-led discovery.

- Add `researcher` stage separate from `ideator`.
- Integrate one search API and one source-capture tool first, for example Exa/Tavily plus Firecrawl or a deterministic fetcher.
- Store source artifacts and claim records under `factory/research/` or a structured source store.
- Allow the researcher to run multi-step exploratory loops, but keep source capture, WFA execution, evidence promotion, and official state mutation deterministic.
- Feed only sourced, timestamped hypotheses into ideator.

Phase 6: Add reliability substrate.

- For near-term solo simplicity, start with a repo-owned durable queue or BullMQ/Redis if Redis is acceptable.
- Consider Temporal later if workflows span many long-running workers, schedules, retries, and multi-process recovery requirements exceed the custom control plane.
- Add watchdog, circuit breakers, poison queue, and chaos tests before launch.

Phase 7: Benchmark brain backends.

- Compare OpenCode SDK, direct OpenAI/Anthropic/Google, and any cheap/local repair model on the same prompts and schemas.
- Metrics: schema compliance, source-backed claim rate, unsupported-claim rate, novelty, duplicate rate, testability, latency, timeout rate, cost, plan specificity, WFA-ready compile rate, downstream WFA execution rate, evidence yield, false-success rate, and human-intervention rate.
- Promote a backend only after evidence, not preference.

# Open Questions

- Which direct provider should be the first production `ResearchBrain` backend, given available API keys, cost limits, and desired web/search capability?
- What default research-job budget is acceptable for unattended alpha discovery: max steps, max sources, max spend, max wall time, and max retry count?
- Should the first agentic research backend be direct provider tool-loop code, a small LangGraph-style graph, or bounded OpenCode SDK jobs behind the same interface?
- Should the near-term durable queue be custom SQLite/JSON state, BullMQ/Redis, or Temporal from the start?
- Which web discovery APIs are worth paying for first: Exa, Tavily, Firecrawl, Brave/SerpAPI, Perplexity-style synthesis, or market-data feeds?
- What exact soak-test threshold is acceptable before declaring WFA-only loop launchable: 100 calls, 500 calls, overnight, one week, or evidence-yield target?
- What exact fields should define `wfa_ready_backlog_item_v1` so planner bypass is safe but not over-broad?

# Sources

Repo evidence, accessed 2026-05-06:

- `AGENTS.md:19-45`: anti-fake-completion and required artifact doctrine.
- `AGENTS.md:63-70`: real WFA execution requirement and canonical WFA launcher rule.
- `factory/mt5-ftmo-strategy-factory-spec.md:201-206`: search and validation are different jobs; Python is discovery layer.
- `factory/research/loop-engine-architecture-reassessment-brief-2026-05-06.md:27-35`: immediate trigger, planner no JSON and first-header timeouts.
- `factory/research/loop-engine-architecture-reassessment-brief-2026-05-06.md:55-89`: OpenCode as brain vs tool framing.
- `factory/state.json:3-15`: latest run failed at planner transport timeout.
- `factory/runs/RUN-20260505194725-nlq8sd/gate-results.json:5-45`: planner attempt failures.
- `factory/runs/RUN-20260505194725-nlq8sd/planner-attempt-3/stage-error.json:1-29`: OpenCode SDK first-header transport failure.
- `factory/runs/RUN-20260505194725-nlq8sd/planner-attempt-3/stage-error.json:32-60`: failed task already had explicit WFA-ready route fields.
- `factory/health.json:46-72`: transport failures by phase and adapter.
- `factory/health.json:113-117`: executor completion rate.
- `factory/verification/rollout-gate-20260505200440396.json:16-24`: rollout gate not ready.
- `opencode.json:1-127`: current all-stage OpenCode config and MiniMax free model usage.
- `src/core/orchestrator.mjs:776-778`: live transport vs simulate runner selection.
- `src/core/orchestrator.mjs:850-870`: ideator spawn and OpenCode call.
- `src/core/orchestrator.mjs:1376-1423`: structured stage calls agent, parses RF JSON, validates, gates.
- `src/core/orchestrator.mjs:1452-1588`: planner, executor, evaluator, summarizer all use structured stage path.
- `src/core/transport/live-transport.mjs:24-31`: live transport defaults to SDK unless HTTP adapter selected.
- `src/core/transport/opencode-sdk-transport.mjs:121-130`: current SDK prompt body has no documented structured-output schema format.
- `src/core/transport/opencode-server-manager.mjs:178-202`: server manager spawns `opencode serve`.
- `src/prompts/ideator.md:1-31`: current ideator constrained to one backlog candidate JSON.
- `src/prompts/planner.md:1-105`: planner must turn one backlog item into one falsifiable plan and must not ideate new workstreams.
- `src/core/prompt-builders.mjs:337-355`: ideator prompt builder uses local cycle facts, policy, retrieval, exact files.
- `src/core/retrieval.mjs:152-163`: ideator retrieval uses local live lessons and evidence.
- `src/core/validators.mjs:464-492`: executed WFA requires observed metrics and canonical provenance.
- `src/core/validators.mjs:717-759`: executed WFA artifacts must exist and metrics must be artifact-backed.
- `src/workers/research-wfa-envelope-worker.mjs:142-154`: WFA envelope officializes existing WFA artifacts and records it did not execute WFA.
- `factory/backlog.json:995-1023`, `factory/backlog.json:2233-2260`, `factory/backlog.json:2544-2571`: ready WFA tasks with explicit route fields.

OpenCode official sources, accessed 2026-05-06:

- OpenCode SDK docs, last updated May 6, 2026: https://opencode.ai/docs/sdk/. Type-safe SDK, server/client creation, default 5000 ms server-start timeout, client-only connection, sessions, files, events, and JSON schema structured output via `StructuredOutput` tool.
- OpenCode Server docs, last updated May 6, 2026: https://opencode.ai/docs/server/. `opencode serve`, headless HTTP server, OpenAPI 3.1 spec, basic auth via `OPENCODE_SERVER_PASSWORD`, sessions, messages, events.
- OpenCode CLI docs, last updated May 6, 2026: https://opencode.ai/docs/cli/. TUI default, `opencode run`, `--attach`, `--format json`, `opencode serve`, model/agent flags.
- OpenCode Agents docs, last updated May 6, 2026: https://opencode.ai/docs/agents/. Agent types, model/permission config, temperature, steps, task permissions, subagents.
- OpenCode repository: https://github.com/anomalyco/opencode. Active upstream project and issue/PR source.

OpenCode issue and PR evidence, accessed 2026-05-06:

- Open issue #17516, created 2026-03-14, updated 2026-05-03: https://github.com/anomalyco/opencode/issues/17516. `opencode run` hangs after completing tool calls.
- Open PR #26079, created 2026-05-06: https://github.com/anomalyco/opencode/pull/26079. Session/message ID streaming race fix proposal; notes missed `text-start` and clock-skew stall risk.
- Open issue #25914, created 2026-05-05: https://github.com/anomalyco/opencode/issues/25914. MCP tool calls crash in v1.14.39 due output-shape mismatch.
- Closed issue #9733, created 2026-01-21, closed 2026-04-07: https://github.com/anomalyco/opencode/issues/9733. REST/session prompt handling and free model timeout behavior report.
- Issue #24529, accessed through GitHub research stream: https://github.com/anomalyco/opencode/issues/24529. Edit tool crash risk signal.
- Issue #23928, accessed through GitHub research stream: https://github.com/anomalyco/opencode/issues/23928. Output cutoff risk signal.
- Issue #25168, accessed through GitHub research stream: https://github.com/anomalyco/opencode/issues/25168. Provider/compaction crash risk signal.

Direct LLM API and structured-output sources, accessed 2026-05-06:

- OpenAI Structured Outputs docs: https://platform.openai.com/docs/guides/structured-outputs. States Structured Outputs ensure schema adherence; JSON mode only ensures valid JSON.
- OpenAI Function Calling docs: https://platform.openai.com/docs/guides/function-calling. Tool/function call structured outputs.
- OpenAI Production Best Practices: https://platform.openai.com/docs/guides/production-best-practices. Production API considerations.
- OpenAI Rate Limits: https://platform.openai.com/docs/guides/rate-limits. Retry/rate-limit design source.
- Anthropic Tool Use docs: https://docs.anthropic.com/en/docs/build-with-claude/tool-use. Tool-use design.
- Anthropic Strict Tool Use docs: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/strict-tool-use. Strict tool input schema behavior.
- Anthropic Rate Limits: https://docs.anthropic.com/en/api/rate-limits. Provider limits and headers.
- Anthropic Errors: https://docs.anthropic.com/en/api/errors. Error handling.
- Anthropic Prompt Caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching. Cost/latency controls.
- Google Vertex AI structured output docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output. Response schema control.
- xAI Structured Outputs docs: https://docs.x.ai/docs/guides/structured-outputs. JSON schema support.
- DeepSeek JSON Output docs: https://api-docs.deepseek.com/guides/json_mode. JSON output caveats.
- Qwen JSON mode docs: https://www.alibabacloud.com/help/en/model-studio/json-mode. JSON mode and downstream validation caveats.
- vLLM structured outputs docs: https://docs.vllm.ai/en/latest/features/structured_outputs.html. Guided JSON/schema decoding.

Agent architecture and research-design sources, accessed 2026-05-06:

- Anthropic, `Building effective agents`, published 2024-12-19: https://www.anthropic.com/engineering/building-effective-agents. Distinguishes code-controlled workflows from autonomous agents; recommends simple, composable patterns and direct APIs when possible.
- ReAct paper: https://arxiv.org/abs/2210.03629. Reasoning/action loops for external information gathering.
- Retrieval-Augmented Generation survey: https://arxiv.org/abs/2312.10997. Retrieval helps freshness and traceability but requires evaluation.
- Chain-of-Note paper: https://arxiv.org/abs/2311.09210. Robustness for noisy retrieval and unknown handling.
- STORM paper: https://arxiv.org/abs/2402.14207. Multi-perspective source discovery and grounded question asking.
- FinGPT paper: https://arxiv.org/abs/2306.06031. Finance LLM/data-centric design.
- FinRobot paper: https://arxiv.org/abs/2405.14767. Financial agent architecture reference.
- NIST AI Risk Management Framework: https://www.nist.gov/itl/ai-risk-management-framework. Governance, mapping, measurement, management.

Quant and overfitting sources, accessed 2026-05-06:

- Bailey, Borwein, Lopez de Prado, Zhu, `The Probability of Backtest Overfitting`: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253.
- Bailey and Lopez de Prado, `The Deflated Sharpe Ratio`: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551.
- QuantConnect Walk Forward Optimization docs: https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/walk-forward-optimization.
- QuantConnect Backtesting Report docs: https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/report.
- QuantConnect Optimization Parameters docs: https://www.quantconnect.com/docs/v2/cloud-platform/optimization/parameters.
- Coqueret and Guida, `Machine Learning for Factor Investing`, backtesting chapter: https://www.mlfactor.com/backtest.html.
- White, `A Reality Check for Data Snooping`, Econometrica 2000: https://doi.org/10.1111/1468-0262.00152.
- Harvey, Liu, Zhu, expected returns and multiple testing, Review of Financial Studies 2016: https://doi.org/10.1093/rfs/hhv059.

Reliability architecture sources, accessed 2026-05-06:

- Temporal Workers docs: https://docs.temporal.io/workers. Worker/task-queue architecture, stateless workers, worker identity.
- Temporal Retry Policies: https://docs.temporal.io/encyclopedia/retry-policies.
- Temporal AI Cookbook: https://docs.temporal.io/ai-cookbook.
- BullMQ retrying failing jobs: https://docs.bullmq.io/guide/retrying-failing-jobs. Attempts, fixed/exponential backoff, jitter.
- BullMQ stalled jobs: https://docs.bullmq.io/guide/jobs/stalled.
- BullMQ graceful shutdown: https://docs.bullmq.io/guide/workers/graceful-shutdown.
- Celery tasks and retries: https://docs.celeryq.dev/en/stable/userguide/tasks.html.
- Celery workers: https://docs.celeryq.dev/en/stable/userguide/workers.html.
- Microsoft Circuit Breaker pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker.
- Microsoft Compensating Transaction pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction.
- Kubernetes probes: https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/.
- Docker restart policies: https://docs.docker.com/engine/containers/start-containers-automatically/.
- OpenTelemetry observability primer: https://opentelemetry.io/docs/concepts/observability-primer/.

Web research and market-source options, accessed 2026-05-06:

- Exa docs: https://exa.ai/docs/.
- Tavily docs: https://docs.tavily.com/.
- Firecrawl docs: https://docs.firecrawl.dev/.
- Perplexity API docs: https://docs.perplexity.ai/home.
- Brave Search API docs: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started.
- SerpAPI docs: https://serpapi.com/search-api.
- Binance Spot API docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-api-information.
- CoinGecko API docs: https://docs.coingecko.com/reference/introduction.
- DefiLlama docs: https://docs.llama.fi/.
- NewsAPI docs: https://newsapi.org/docs.
- GDELT docs: https://docs.gdeltproject.org/.
- CryptoPanic API: https://www.cryptopanic.com/developers/api/.
- CCXT docs: https://docs.ccxt.com/.

Alternative runtime sources, accessed 2026-05-06:

- LangGraph JS overview and durable execution docs: https://docs.langchain.com/oss/javascript/langgraph/overview and https://docs.langchain.com/oss/javascript/langgraph/durable-execution.
- LangSmith observability: https://docs.langchain.com/langsmith/observability.
- AutoGen docs: https://microsoft.github.io/autogen/stable/.
- CrewAI docs: https://docs.crewai.com/.
- CrewAI Flows: https://docs.crewai.com/en/concepts/flows.
- LlamaIndex docs: https://docs.llamaindex.ai/en/stable/.

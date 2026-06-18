# Phase 8B ResearchBrain End-To-End Audit

Date: 2026-05-22

Scope: Phase 8B ResearchBrain architecture, implementation, tooling, provenance, loop integration, and live-provider readiness. This memo does not claim a trading edge, does not execute WFA/MT5, and does not mutate official factory state, evidence, backlog, or leaderboard authority.

## Executive Verdict

ResearchBrain's direction is right: deterministic cage, Stage-0 artifacts, path/hash provenance, non-authoritative discovery, and Ideator/Planner handoff are conceptually well-balanced for a solo quant loop.

Current state is not live-ready. The cage is more mature than the brain. The implementation is still fixture/scripted, and the live tool path would currently allow source laundering unless tightened before provider integration.

Proceed toward a live provider-agnostic canary only after the `must_fix_now` items below. Do not add broad frameworks, source warehouses, market-data APIs, WFA/MT5/MQL5 tools, or social crawlers first.

Verification during audit:

- `node --test tests/researchbrain-artifacts.test.mjs tests/researchbrain-agent.test.mjs` passed 37/37.
- `rtk npm run validate` passed.

## Architecture Map

Request preparation:

- `scripts/run-researchbrain-request-writer.mjs`
- `src/core/researchbrain-artifacts.mjs`
- Produces `researchbrain_request_v1` under `factory/research/requests/` with Phase 8A universe path/hash constraints.

Runtime:

- `src/core/researchbrain-runtime.mjs`
- `runResearchBrainStage0Runtime()` loads the request, calls `provider.generate(context)`, enforces attempt/time/output budgets, quarantines invalid output, and writes Stage-0 artifacts.
- Current providers are fixture/file/scripted only.

Agent/tools:

- `src/core/researchbrain-agent.mjs`
- `src/core/researchbrain-tools.mjs`
- `src/core/researchbrain-youtube-ingest.mjs`
- Scripted tool loop can call discovery/capture/memory/rejection/hypothesis tools and writes transcript/tool/cost/notes artifacts.
- Current discovery tools are fixture-style; live API/search adapters are not implemented.

Accepted artifacts:

- source records
- hypothesis packets
- digest
- ideation manifest
- Stage-0 manifest

Index/retrieval:

- `src/core/memory-index.mjs` scans `factory/research/**/*.json` and indexes source records, hypothesis packets, digests, and ideation manifests into derived retrieval memory.
- `src/core/retrieval.mjs` surfaces Stage-0 hypothesis/source snippets to Ideator and Planner.

Loop handoff:

- `src/core/prompt-builders.mjs` tells Ideator/Planner to consume Stage-0 packets only by path/hash.
- `src/core/orchestrator.mjs` preserves ResearchBrain packet/source refs on auto-generated backlog items.
- `src/core/validators.mjs` enforces Planner source-hash provenance and rejects `stage0_research_discovery` as executable evidence.

Canonical flow:

```text
request.json
  -> runtime provider.generate(context)
  -> agent tool loop / direct provider output
  -> deterministic source capture + source records
  -> hypothesis packets + digest + ideation manifest + Stage-0 manifest
  -> memory index
  -> Ideator backlog item with packet/source path hashes
  -> Planner plan source_hashes
  -> deterministic WFA only if later planned as research_wfa
```

## Findings

### must_fix_now: No Live ResearchBrain Exists

Files:

- `src/core/researchbrain-agent.mjs`
- `src/core/researchbrain-runtime.mjs`
- `scripts/run-researchbrain-stage0-runtime.mjs`
- `factory/research/phase8b-researchbrain-live-agent-decision-2026-05-21.md`

Current provider modes are fixture/file/scripted only. There is no `src/core/researchbrain-llm-providers.mjs`, no live LLM loop, and no real discovery/search adapter.

Why it matters: ResearchBrain cannot discover non-obvious alpha hypotheses yet. It can only validate plumbing.

Minimal fix: add a provider-agnostic live agent provider plus explicit CLI flags: `--allow-live-llm`, `--llm-provider`, `--llm-model`, budget caps, and allowlisted tools.

### must_fix_now: Live Tool Path Would Allow Source Laundering

Files:

- `src/core/researchbrain-tools.mjs`

Search tools accept caller-supplied `input.results`, and `capture_url_source` writes caller-supplied `input.content`.

Why it matters: a live LLM could invent a search result and source text, then get a hash-backed source artifact for fabricated content.

Minimal fix: split fixture/live modes. In live mode, search results must come from deterministic APIs and captured content must come from deterministic fetch/ingest adapters, never LLM-provided text.

### must_fix_now: Output Directory Collision Can Overwrite Evidence

Files:

- `src/core/researchbrain-runtime.mjs`
- `src/core/researchbrain-tools.mjs`
- `src/core/researchbrain-agent.mjs`

Writers create directories recursively and overwrite files for a reused run id.

Why it matters: prior Stage-0 evidence can be replaced, violating evidence discipline.

Minimal fix: fail loud if the output directory exists and is nonempty unless an explicit test-only overwrite flag is passed.

### must_fix_now: Profitability Blocking Is Denylist-Only

Files:

- `src/core/researchbrain-artifacts.mjs`
- `src/core/researchbrain-runtime.mjs`
- `src/core/researchbrain-tools.mjs`

The validators block exact keys like `sharpe` and `return_pct`, but aliases such as `sharpe_ratio`, `cagr`, `pnl_total`, `edge_rating`, or nested unknown fields can pass. `buildHypothesisPacket()` spreads provider fields into the artifact.

Why it matters: Stage-0 can accidentally become pseudo-evidence.

Minimal fix: centralize Stage-0 schema validation, allowlist packet fields, reject unknown fields, and add profitability alias/pattern checks.

### must_fix_now: Memory Checks Are Not Actually Required

Files:

- `src/core/researchbrain-tools.mjs`
- `factory/mt5-ftmo-strategy-factory-spec.md`

`memoryChecked` starts true and `record_hypothesis` does not require `search_research_memory`, `check_duplicate_memory`, or `check_failed_pattern_similarity` to have run.

Why it matters: a live agent can skip memory checks and produce duplicate or parameter-mutated ideas.

Minimal fix: initialize memory checked false and require memory/duplicate/failed-pattern checks before hypothesis acceptance.

### must_fix_now: `read_repo_artifact` Is Too Broad

File:

- `src/core/researchbrain-tools.mjs`

`read_repo_artifact` can read any repo-relative file.

Why it matters: a live LLM could read secrets/configs or unrelated files into transcripts/source captures.

Minimal fix: restrict to approved artifact roots and deny `.env`, credential, `.git`, key/token, and opencode config patterns.

### should_fix_soon: Provider Run ID Can Drift

File:

- `src/core/researchbrain-runtime.mjs`

Runtime only sets `research_run_id` if absent.

Why it matters: stale or malicious provider output can cross-label artifacts with another run id.

Minimal fix: always override provider `research_run_id` with `runtimeRunId`, or reject mismatches.

### should_fix_soon: WFA-Ready Compiler Drops ResearchBrain Source Hashes

File:

- `src/core/wfa-plan-compiler.mjs`

The deterministic WFA-ready compiler does not propagate `hypothesis_packet_path`, `hypothesis_packet_sha256`, or `source_record_refs` into `plan.source_hashes`.

Why it matters: ResearchBrain-derived WFA-ready backlog items can lose provenance or fail planner validation.

Minimal fix: add `source_hashes` from ResearchBrain backlog linkage fields.

### should_fix_soon: Source Quality Gates Are Too Permissive

Files:

- `src/core/researchbrain-tools.mjs`
- `src/core/researchbrain-runtime.mjs`
- `src/core/researchbrain-artifacts.mjs`

Citation presence is checked, but trust tier is not used to filter or mark packet strength.

Why it matters: one low-signal blog/video can create a backlog-driving packet and waste WFA cycles.

Minimal fix: require higher-trust source support for MT5/MQL5/broker claims, and block or mark packets weak when all citations are low-signal and single-source.

### should_fix_soon: Rejections And Duplicates Are Not First-Class Enough In Retrieval

Files:

- `src/core/researchbrain-tools.mjs`
- `src/core/memory-index.mjs`
- `src/core/retrieval.mjs`

Rejections are written, but future retrieval mainly surfaces accepted packets/sources. Ideation manifest retrieval text does not carry enough rejection reasoning.

Why it matters: future ResearchBrain runs may repeat weak rejected ideas.

Minimal fix: include rejection reasons and duplicate summaries in retrieval text/snippets. Consider a small `research_rejection_v1` schema later only if needed.

## Missing Tests That Matter

Add tests only where they protect practical loop outcomes:

- live-mode `search_*` rejects injected `input.results`, and live `capture_url_source` rejects LLM-supplied `content`
- existing output dir/run id collision fails loud
- profitability aliases and unexpected packet fields are rejected
- `record_hypothesis` fails if memory/duplicate/failed-pattern tools were not run
- `read_repo_artifact` denies sensitive paths and allows approved Phase 8A/research artifacts
- provider `research_run_id` mismatch is overridden or rejected
- WFA compiler preserves ResearchBrain source hashes
- single low-signal source packet is blocked or marked weak

## Overengineering Watchlist

Do not build these yet:

- LangGraph/LangChain/OpenAI Agents SDK/MCP as the first runtime
- market-data, MT5, WFA, MQL5 compile, optimizer, account, or profitability tools inside ResearchBrain
- broad source warehouse/vector DB
- bulk social/forum/comment/news scraping
- default audio transcription for YouTube

Reason: they do not improve the immediate live canary enough to justify the complexity and boundary risk.

## Live Provider Readiness

Current seam is directionally provider-neutral: runtime requires `provider.generate(context)`.

Minimal provider interface:

```js
provider = {
  name,
  mode: "live_llm_agent",
  live_research: true,
  async generate({
    root_dir,
    run_repo_dir,
    observed_at,
    request,
    request_ref,
    attempt,
    run_id,
    budget,
    signal
  }) {
    return researchbrain_stage0_provider_output_v1;
  },
  getRuntimeArtifacts() {
    return transcript_tool_cost_notes_refs;
  }
};
```

Provider-specific LLM client interface should stay smaller:

```js
llmClient.complete({
  messages,
  tools,
  responseSchema,
  maxTokens,
  temperature,
  signal
}) -> { message, tool_calls, usage, raw, stop_reason };
```

Before first live canary:

- fix source laundering
- add output collision guard
- add field allowlist/profitability alias rejection
- enforce memory checks
- restrict repo reads
- write transcript/tool/cost/raw/quarantine/source artifacts
- accept at least one valid `hypothesis_packet_v1`, index it, and verify Ideator can consume it by path/hash

Always forbidden inside ResearchBrain:

- WFA/backtest/optimizer execution
- MT5 terminal work
- MQL5 compilation
- market data/live prices
- profitability/Sharpe/return estimates
- official state/evidence/backlog/leaderboard mutation
- strategy promotion

## Recommended Patch Sequence

1. Add live/fixture tool mode separation; disallow injected search results and LLM-supplied source content in live mode.
2. Add output-dir collision guard and tests.
3. Centralize Stage-0 field allowlists and profitability alias rejection; stop spreading unknown provider fields into packets.
4. Enforce actual memory/duplicate/failed-pattern checks before hypothesis acceptance.
5. Restrict `read_repo_artifact`.
6. Add provider-agnostic live agent adapter interface and CLI live flags, without vendor lock-in.
7. Add the smallest real source adapters needed for first canary: web search, URL capture, and one high-quality source class.
8. Patch WFA compiler source-hash propagation and improve rejection/duplicate retrieval.

## Durable Context Summary

The architecture is not wrong. The main risk is not fake WFA evidence; existing executor gates are good. The main risk is fake or low-quality Stage-0 research entering the backlog through source laundering, weak memory enforcement, or low-trust single-source hypotheses. The next work should strengthen the live-agent boundary and then run one real bounded canary, not add more scaffold.

# Phase 8B ResearchBrain Live Agent Decision

Date: 2026-05-21

Scope: Phase 8B Stage-0 discovery only. This document does not claim a trading edge, does not execute WFA/MT5, and does not mutate official factory state, evidence, backlog, or leaderboard files.

## Executive Verdict

Build ResearchBrain as a strong bounded LLM tool-using agent behind the existing deterministic Stage-0 cage.

The right separation is:

```text
LLM ResearchBrain: think, search, compare, reject, synthesize, propose.
Deterministic runtime: constrain, record, hash, validate, quarantine.
Deterministic WFA/MT5 workers: falsify later.
Official control plane: own state, evidence, gates, and promotion authority.
```

Recommendation:

- Implement a custom Node.js tool loop, not LangGraph, LangChain, OpenAI Agents SDK, or OpenCode runtime orchestration.
- Use direct provider adapters behind a stable local interface. Keep the current `provider.generate(context)` seam, but add an agent provider that performs multi-turn tool use before returning the existing `researchbrain_stage0_provider_output_v1` object.
- First live canary model: Anthropic Claude Opus 4.7 or latest Opus thinking-capable API model, budget-capped.
- Routine follow-up model: Claude Sonnet 4.6, once the live canary proves the loop.
- Benchmark alternate: OpenAI GPT-5.5/GPT-5.4 via the same adapter interface, not through OpenAI Agents SDK.
- Low-cost scout only: xAI Grok or Together-hosted frontier/open-weight models, after the primary loop works.

## Why This Supersedes Deterministic Prefetch

Deterministic prefetch is useful as a tool, but not as the discovery brain.

The operator correction in spec section 11.16A is binding: the factory needs a ResearchBrain that can make research choices. If deterministic code predefines the source list and synthesis path, it can only validate obvious ideas. It cannot reliably notice non-obvious relationships, reject weak analogies, pivot sources, or synthesize mechanisms across papers, MT5 instrument classes, and prior failures.

Safety comes from denying ResearchBrain evidence authority, not from weakening its research intelligence.

## Architecture

Use a small explicit loop:

```text
1. Build system prompt from request, Phase 8A constraints, prior lessons, and prior packet/source refs.
2. Call LLM with a bounded tool catalog.
3. Append raw assistant response to transcript.
4. Validate each requested tool call.
5. Execute allowed tool calls deterministically.
6. Write/hash source outputs and append tool results to transcript.
7. Continue until stop condition or budget exhaustion.
8. Require final structured Stage-0 output.
9. Feed the final output through existing validators/artifact writers.
10. Quarantine invalid, duplicate, promotional, unbacked, or over-budget output.
```

Do not hide source decisions inside provider-native web search unless the deterministic runtime also captures the exact source URLs/content by path and hash. Built-in web search may be an optional discovery accelerator, but raw captured sources are the only artifacts that should count.

## Initial Tool Catalog

Start narrow.

| Tool | Purpose | Authority Boundary |
|---|---|---|
| `search_web` | Query Brave Search or equivalent and return compact result IDs/snippets | Search result is discovery only, not evidence |
| `search_official_docs` | Search official docs for platform, broker, exchange, SEC/filing, macro-calendar, and source-policy references | Discovery only until captured |
| `search_mql5_sources` | Search MQL5 docs, Articles, CodeBase, Forum, and MetaQuotes/MetaTrader documentation | Discovery only; forum claims are weak practitioner claims |
| `search_broker_docs` | Search FTMO/broker symbol, contract-spec, hours, lot-size, swap, commission, and restriction docs | May identify required verification; cannot prove tradability/profitability |
| `capture_url_source` | Canonical capture for a URL or document returned by discovery tools | Writes raw/normalized content, metadata, extraction warnings, and hashes |
| `search_arxiv` | Find academic papers by title/abstract/category | Raw API response captured |
| `search_semantic_scholar` | Citation graph and paper metadata | Raw API response captured |
| `search_github_code` | Discover public MQL5/Python implementation ideas | Raw API response captured; never execute code |
| `capture_github_artifact` | Capture exact GitHub file/repo artifact with path, commit SHA, license when available, and hashes | Read-only; code is implementation evidence, not profitability evidence |
| `search_youtube` | Discover trading-research videos, channels, interviews, platform walkthroughs, and conference talks | Search/metadata is discovery only, not evidence |
| `inspect_youtube_video` | Calls the deterministic `youtube_ingest` wrapper for one video and returns bounded artifact/chunk refs | Writes raw metadata/transcript/chunk artifacts and hashes; no profitability authority |
| `read_repo_artifact` | Read approved repo-local Phase 8A/research artifacts | Repo-root safe paths only |
| `search_research_memory` | Search prior hypothesis packets, source records, rejections, lessons, failed WFA summaries, and known non-tradable/data-unavailable ideas | Read-only; used to avoid circular research |
| `check_duplicate_memory` | Compare proposed mechanism/family/source fingerprint against prior packets/failures | Duplicate blocks backlog creation |
| `check_failed_pattern_similarity` | Detect same mechanism with new parameters, renamed indicators, or shifted symbols/timeframes | Blocks parameter-only novelty |
| `record_rejection` | Record a rejected idea and reason | Rejections are first-class Stage-0 learning |
| `record_hypothesis` | Submit final `hypothesis_packet_v1` candidate fields | Existing validators decide acceptance |

Tool-scope assessment accepted 2026-05-22: `factory/research/phase8b-tool-scope-assessment-2026-05-22.md` records the active v1 tool decision. The original tool list was directionally good but under-specified for MT5/FTMO source classes and memory depth. The codebase impact should be selective, not maximal: add first-class source discovery modes for official docs, MQL5/MetaQuotes, and broker/FTMO docs; use canonical `capture_url_source` for URL capture; keep GitHub capture source-specific because commit/license/file-path provenance matters; keep MQL5 capture as `capture_url_source` with `source_class: mql5` initially unless a later implementation needs a dedicated parser.

Do not add market-data, MT5 terminal, MQL5 compilation, backtest, WFA, optimizer, account, live/paper trading, Sharpe/return/profitability-estimation, broad social scraping, bulk comments/forums, paid-news scraping, or bulk repository cloning tools to ResearchBrain v1. These either belong to deterministic workers, later explicit opt-in workflows, or should remain out of scope.

Memory access must be richer than a single exact duplicate check. The initial prompt should include a compact memory capsule, and the tool loop should expose read-only filtered memory search. ResearchBrain should use prior WFA summaries and failures only to avoid duplicates and known-bad mechanisms, never to reverse-engineer parameter tweaks.

YouTube support is mandatory for ResearchBrain. The tool should treat videos as source material, not as evidence by popularity. Use official YouTube Data API metadata/search first. The official YouTube Data API is not a general-purpose transcript API for arbitrary public videos, so transcript capture must run through a deterministic adapter chain with explicit source/risk labels. If no transcript chunks are captured, ResearchBrain may use title/description only for discovery and must not make video-content claims.

`inspect_youtube_video` should be implemented as a deterministic wrapper boundary, not as loose agent browsing:

```text
youtube_ingest(input) -> artifact_manifest.json
```

Recommended adapter order:

```text
1. Official YouTube Data API metadata via videos.list.
2. Official/authorized captions only when owned/authorized/available.
3. youtube-transcript-api public transcript adapter, risk-labeled unofficial.
4. yt-dlp subtitle/autocaption extraction, subtitles only and risk-labeled unofficial.
5. Optional audio transcription, disabled by default and requiring explicit opt-in.
6. Fail closed with transcript_unavailable and researchbrain_allowed=false for video-content claims.
```

Minimum YouTube artifacts:

- `video_metadata.json`
- `transcript_raw.json` when available
- `transcript_normalized.json`
- `chunks.jsonl`
- `ingestion_report.json`
- `source_manifest.json`

Each chunk must include `chunk_id`, `video_id`, `start_sec`, `end_sec`, `timestamp_url`, `text`, `text_hash`, `source_provider`, and `source_risk`. YouTube source records must preserve transcript provider, whether captions are generated or translated, language/original language, transcript unavailable reason when relevant, and artifact hashes.

Defer broad market-data APIs. ResearchBrain discovers source-backed mechanisms; deterministic data-readiness workers fetch and validate market data later.

## Backend And Model Decision

### Primary: Anthropic Claude Opus

Use Opus for the first live Stage-0 canary.

Rationale:

- Anthropic's TypeScript SDK supports manual multi-turn tool use and `tool_result` loops, which maps cleanly to the deterministic cage.
- Anthropic's public pricing lists Opus 4.7 at `$5 / MTok` input and `$25 / MTok` output, cheaper output than GPT-5.5 while positioned as its most intelligent model for agents and coding.
- LMArena text/document/search snapshots fetched on 2026-05-21 rank Claude Opus 4.6/4.7 variants at or near the top for text, document, webdev, and search categories.
- Anthropic's own agent guidance favors simple workflows and explicit loops over heavy frameworks, matching this repo's control-plane design.

Use Sonnet 4.6 after the first Opus canary for cheaper routine discovery. Anthropic pricing lists Sonnet 4.6 at `$3 / MTok` input and `$15 / MTok` output.

### Secondary Benchmark: OpenAI GPT-5.5 / GPT-5.4

OpenAI remains a strong benchmark backend, especially because the Node SDK supports function/tool calling and structured JSON outputs. Pricing fetched on 2026-05-21:

- GPT-5.5: `$5 / 1M` input, `$30 / 1M` output.
- GPT-5.4: `$2.50 / 1M` input, `$15 / 1M` output.
- GPT-5.4 mini: `$0.75 / 1M` input, `$4.50 / 1M` output.
- OpenAI web search: `$10 / 1k` calls, search content tokens free.

Do not use OpenAI Agents SDK initially. The local loop needs exact control over transcript writes, source hashing, quarantine, duplicate checks, and final Stage-0 schema enforcement.

### Watchlist: Gemini

The Google Gen AI SDK supports function declarations, function responses, and JSON-schema-style output configuration. LMArena snapshots show Gemini 3.x variants as competitive in text/search. However, Gemini pricing fetches against `ai.google.dev` failed repeatedly in this session, and the Google Cloud pricing page was too large/noisy for a clean artifact-backed comparison. Defer Gemini as a first canary until pricing/account/model IDs are verified.

### Low-Cost Scout: xAI Grok

xAI docs fetched on 2026-05-21 list Grok 4.3 / 4.20 variants around `$1.25 / 1M` input and `$2.50 / 1M` output with 1M context. This is attractive for cheap broad exploration, but LMArena text snapshots placed `grok-4.3` materially below Opus/GPT/Gemini leaders. Use only as a later low-cost scout under the same validators.

### Low-Cost Scout: Together/Open-Weight Hosts

Together pricing shows many cheap serverless models, including `gpt-oss-120B` at `$0.15 / 1M` input and `$0.60 / 1M` output, and stronger paid models such as Kimi/Qwen/DeepSeek variants. These are cost-attractive for parallel candidate generation, but should not be first-live authority because provider/model quality, tool-call reliability, and source discipline are the unknowns. Use after the primary loop works.

## Source Tool Decision

First tool integrations:

- Brave Search API for web discovery.
- YouTube Data API for video search and metadata, plus a deterministic `youtube_ingest` wrapper for transcript/chunk capture.
- MQL5/MetaQuotes and broker/FTMO source discovery through targeted official/source-class search modes.
- arXiv API for academic preprints.
- Semantic Scholar API for citation graph and summaries.
- GitHub Search API for MQL5/Python code discovery, plus exact file/repo capture with commit/license metadata where available.
- Crossref for DOI/journal metadata resolution.

MQL5 CodeBase/articles/forums are high value but scrape-prone. Access them through targeted source-class search and canonical source capture first, not uncontrolled scraping. Broker/FTMO docs should identify required verification items such as symbol specs, trading hours, lot/tick size, swaps, commission, and restrictions, but they cannot prove strategy tradability or profitability. YouTube is also high-value but noisy: require source trust labels, transcript availability flags, creator/channel metadata, publication date, timestamped chunk citations, and explicit disconfirming/limitation notes before a video can support a hypothesis packet. Do not ingest comments/forums/social as default v1 evidence sources; keep them disabled or bounded opt-in and classify them as weak practitioner sources.

## File-Level Implementation Plan

Minimal code slice:

- Add `src/core/researchbrain-agent.mjs` for the custom LLM/tool loop.
- Add `src/core/researchbrain-tools.mjs` for deterministic tool schemas, dispatch, source capture, duplicate lookup, and path safety.
- Add `src/core/researchbrain-youtube-ingest.mjs` or an equivalent helper behind `researchbrain-tools.mjs` for the deterministic YouTube ingestion wrapper.
- Add source-class discovery/capture support for `search_official_docs`, `search_mql5_sources`, `search_broker_docs`, `capture_url_source`, and `capture_github_artifact` without adding execution authority.
- Add memory-search support for `search_research_memory`, `check_duplicate_memory`, and `check_failed_pattern_similarity` using existing indexed Stage-0 packets, source records, lessons/evidence summaries, and failed-pattern records.
- Add `src/core/researchbrain-llm-providers.mjs` with provider adapters. Implement Anthropic first; keep OpenAI/Gemini adapters behind the same interface.
- Extend `src/core/researchbrain-runtime.mjs` to accept an agent provider that returns the existing `researchbrain_stage0_provider_output_v1` shape.
- Extend `scripts/run-researchbrain-stage0-runtime.mjs` with explicit live flags: `--allow-live-llm`, `--llm-provider`, `--llm-model`, `--max-llm-calls`, `--max-tool-calls`, `--max-cost-usd`, `--allow-tool`, `--search-allow-provider`, `--allow-youtube`, `--allow-unofficial-youtube-transcripts`, `--allow-yt-dlp`, `--allow-youtube-audio-transcription`, and YouTube quota/transcript/duration/chunk caps.
- Add transcript artifacts under the runtime run dir: `agent-transcript.jsonl`, `tool-ledger.json`, `working-notes.md`, and `cost-ledger.json`.
- Keep final accepted artifacts exactly as existing Stage-0 artifacts: source records, hypothesis packets, digest, ideation manifest, and Stage-0 manifest.

Prefer direct REST/fetch or very thin SDK wrappers. Do not introduce a graph/agent framework dependency for the first live canary.

## Required Tests Before First Live Run

- Fake LLM calls `search_web`, then `capture_url_source`, then `record_hypothesis`; artifacts are accepted and hashed.
- Fake LLM uses `search_mql5_sources` / `search_broker_docs` for discovery, then captured source artifacts before any MT5/FTMO source claim is accepted.
- Fake LLM uses `search_github_code`, then `capture_github_artifact`; code is captured with commit/license/path metadata and never executed.
- Fake LLM proposes a parameter-only mutation of a prior failed mechanism; memory tools identify it and accepted output is blocked or recorded as rejection.
- Fake LLM calls `search_youtube`, then `inspect_youtube_video`, then `record_hypothesis`; metadata/transcript artifacts are accepted and hashed.
- Fake LLM cites a YouTube video without transcript/caption/metadata capture; run quarantines or marks the source insufficient for hypothesis support.
- Fake LLM cites a YouTube title/description without timestamped chunk IDs; run rejects the claim.
- YouTube video with no captions and audio transcription disabled records `transcript_unavailable` and `researchbrain_allowed=false` for video-content claims.
- Unofficial transcript adapters are blocked unless explicitly enabled and all accepted artifacts carry `source_risk`.
- Fake LLM tries an unallowed tool; run quarantines and official file hashes stay unchanged.
- Fake LLM requests arbitrary URL fetch not returned by search; run quarantines.
- Fake LLM emits profitability/promotion fields; run quarantines.
- Fake LLM exceeds provider/tool/time/output/cost budget; run blocks or quarantines with diagnostics.
- Duplicate mechanism/family is detected from prior packets and does not create a new accepted packet.
- Output directory overwrite/collision fails loud unless run ID is unique.
- Transcript/tool ledger/cost ledger paths are included in runtime result artifacts but never in official evidence.

## First Live Canary

Candidate run shape:

```bash
rtk npm run researchbrain:stage0-runtime -- \
  --request factory/research/requests/RESEARCHBRAIN-REQUEST-20260520T0718Z/request.json \
  --provider-mode live_llm_agent \
  --allow-live-llm \
  --llm-provider anthropic \
  --llm-model claude-opus-4-7 \
  --allow-tool search_web \
  --allow-tool capture_url_source \
  --allow-tool search_arxiv \
  --allow-tool search_semantic_scholar \
  --allow-tool search_github_code \
  --max-llm-calls 8 \
  --max-tool-calls 20 \
  --max-cost-usd 5
```

The canary passes only if at least one source-backed `hypothesis_packet_v1` is accepted, indexed, and consumable by Ideator by path/hash. It still does not prove an edge.

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Prompt injection from web pages | Treat fetched source text as untrusted data; never let source text override system/tool rules |
| Hidden provider web-search citations | Require raw deterministic source capture before any source can back a packet |
| Cost runaway | Enforce call, token, wall-time, tool, source, output-byte, and dollar caps |
| Confident but unsupported hypotheses | Validators require source records, disconfirming evidence, failure modes, and Phase 8A constraints |
| Duplicate idea churn | Fingerprint mechanism/family/data/timeframe/asset assumptions and compare against prior packets/failures |
| Overfitting pressure leaks into Stage 0 | Stage 0 cannot contain Sharpe/return/profitability/promotion fields |
| Framework opacity | Keep the loop local and explicit |

## Sources Consulted

- Internal active spec: `factory/mt5-ftmo-strategy-factory-spec.md`, section 11.16A.
- Internal active spec audit consolidation: `factory/mt5-ftmo-strategy-factory-spec.md`, section 11.16B.
- Internal source/API track: `factory/research/phase8b-source-tools-research-2026-05-21.md`.
- Context7 docs: `/openai/openai-node/v6_1_0`, OpenAI Node function/tool calling and structured outputs.
- Context7 docs: `/anthropics/anthropic-sdk-typescript`, Anthropic Messages tool-use loop and `tool_result` examples.
- Context7 docs: `/websites/googleapis_github_io_js-genai`, Google Gen AI function calling and JSON schema output examples.
- OpenAI API pricing fetched 2026-05-21: https://openai.com/api/pricing/
- Anthropic pricing fetched 2026-05-21: https://www.anthropic.com/pricing
- xAI model pricing fetched 2026-05-21: https://docs.x.ai/docs/models
- Together pricing fetched 2026-05-21: https://www.together.ai/pricing
- LMArena leaderboard fetched 2026-05-21: https://lmarena.ai/leaderboard

## Confidence

High confidence: custom bounded loop, Stage-0-only authority, source hashing, and no framework dependency.

Medium confidence: Claude Opus first-live model choice. It is the best artifact-backed quality-per-dollar choice from fetched pricing and public leaderboard snapshots, but the factory should run provider bakeoffs after the first canary.

Low confidence: Gemini pricing and exact first-run model ID, because pricing fetch failed during this session.

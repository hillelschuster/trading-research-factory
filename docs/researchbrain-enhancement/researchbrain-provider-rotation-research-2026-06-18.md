# ResearchBrain Enhancement: Provider Rotation, Agent Behavior, and Model Upgrade

**Date:** 2026-06-18
**Status:** Research complete. No code changes yet. Awaiting deep-research agent review.

---

## 1. Current State: What's Failing and Why

### Latest Live Run (2026-06-17)

| Detail | Value |
|---|---|
| Request | `RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z` |
| Model | DeepSeek v4 Flash, preset `deepseek_v4_flash_xhigh` |
| Search provider | Brave Search API, free plan |
| Tool budget | 30 tool calls |
| Result | **Blocked:** `ResearchBrain tool call budget exceeded: 30` |
| `search_web` calls | ~28 |
| `capture_url_source` calls | 1 (FTMO symbols page) |
| `record_hypothesis` calls | 0 |
| Brave 429 rate-limits | Frequent (~15/30 calls); all recovered on retry |
| Terminal blocker | Tool-call budget, not unrecovered Brave failure |
| Readiness after | `attention` / `drainable`, 1 unseeded valid request remaining |

### Artifacts

| Artifact | SHA256 |
|---|---|
| Runtime result | `ddd24c8795c12d7f7d67f859a32577b41acde038cc71bf20bd806a615ffd78f9` |
| Quarantine | `be611560dd0949aeedef29c9bd74e1fb9df6c0b5e73c5c66d53cf6af8e4c7cf7` |
| Projection | `24df48a4b038ef9ac8a51c595d905f7a765d05a4c66c12b4e447a4e919939aca` |
| Supervisor report | `05ca9bc62eb1f68a951868e49273b277c09e7178b9a90c6c50efa82797e17981` |
| Tool ledger | `14751d42ef9a7f2224c356aecf08ca7b781f4c4078c8b1867e274a2d09599530` |
| Transcript | `d407ad2c1f23b6b0187465d862e8701196315ba6cf75dbc9fbce4d701bda3ba4` |

### Root Cause Attribution

**Primary (~60%): Agent behavior.** DeepSeek v4 Flash entered a breadth-first search loop with no convergence heuristic. It made ~28 broad searches (grouped in 3s across asset classes, mechanisms, etc.) but captured only 1 source and never called `record_hypothesis`. It treated search results as "insufficient information" rather than "material to capture and synthesize from."

**Secondary (~30%): Orchestration design.** Single-provider hard dependency on Brave. The memory gate (`check_duplicate_memory` → `check_failed_pattern_similarity` → `record_hypothesis`) never activated because the agent never attempted `record_hypothesis`. No mid-run convergence nudges, no budget-remaining warnings.

**Tertiary (~10%): Provider limits.** Brave free-plan 429s added ~2s latency per retry but always succeeded. All 28 searches completed. Budget exhaustion would have happened with or without rate limiting. Brave was not the terminal failure reason — but it is clearly a bad fit for autonomous continuous research.

### What "Budget Died" Means

The tool-call budget (30) counts each tool invocation by the LLM. Once exhausted, the agent is forcibly stopped. In this run, the agent burned calls on repeated `search_web` without capturing or producing output. It never got to `record_hypothesis`.

The agent's context window was not the limit. The tool-call cap was.

---

## 2. Model Upgrade: DeepSeek v4 Flash → v4 Pro

### Verified Facts (from official DeepSeek API docs)

| Aspect | Current (Flash) | Target (Pro) |
|---|---|---|
| API model name | `deepseek-v4-flash` | `deepseek-v4-pro` |
| reasoning_effort | `"max"` (already correct) | `"max"` (keep) |
| thinking | `{ type: "enabled" }` | `{ type: "enabled" }` |
| xhigh mapping | `"xhigh"` → `"max"` (compat only) | Same |
| Provider | Direct DeepSeek API | Direct DeepSeek API |
| API key env | `DEEPSEEK_API_KEY` | `DEEPSEEK_API_KEY` |
| Base URL | `https://api.deepseek.com` | Same |
| Pricing (1M input) | $0.14 | $0.435 (3.1x) |
| Pricing (1M output) | $0.28 | $0.87 (3.1x) |
| Concurrency | 2500 | 500 |
| Max output tokens | 8K (current adapter cap) | API supports up to 384K |

### Required Changes

1. Add a new preset `deepseek_v4_pro_max` in `scripts/researchbrain-stage0-provider-utils.mjs` (or allow `--llm-model deepseek-v4-pro` with `--llm-provider deepseek`).
2. Consider raising `maxTokens` beyond 8K — V4 Pro's deeper reasoning may benefit from larger output budget.
3. No change to `reasoning_effort` or `thinking` — already correct.

### Existing Presets (for reference)

| Preset | Provider | Model | Env Key | Routes through |
|---|---|---|---|---|
| `deepseek_v4_flash_xhigh` | `deepseek` | `deepseek-v4-flash` | `DEEPSEEK_API_KEY` | Direct DeepSeek |
| `opencode_deepseek_v4_pro` | `openai_compatible` | `deepseek-v4-pro` | `OPENCODE_GO_API_KEY` | OpenCode Go proxy |

**No existing preset routes `deepseek-v4-pro` directly through the DeepSeek API with `DEEPSEEK_API_KEY`.** One must be added.

---

## 3. Provider Rotation: Architecture Options

### Current Bottleneck

```
LLM → search_web tool → Brave adapter → live HTTP
                              ↓
                         429 RATE_LIMITED
                              ↓
                     3 retries (in tool runtime)
                              ↓
                     Error returned to LLM
                              ↓
               LLM retries search_web (burns another tool call)
                              ↓
                         ... loop ...
                              ↓
                  Tool-call budget 30 exhausted
```

Single provider. No fallback. Error transparency to LLM burns budget. No circuit breaker.

### Option A: Simple Round-Robin

- Flat array of providers. Each `search_web` picks `providers[call_count % providers.length]`.
- On failure: skip to next provider immediately.
- All failures → return clean `search_unavailable` (not HTTP error).

**Verdict:** Better than current, but wastes attempts on dead providers, no capability routing, no rate-limit awareness.

### Option B: Tiered Fallback Ladder with Circuit Breakers (RECOMMENDED)

**Core idea:** Provider operations don't burn LLM budget. The tool runtime tries providers internally and returns one result to the LLM.

**Per-tool provider ladders:**

| Tool | Primary | Fallback 1 | Fallback 2 |
|------|---------|------------|------------|
| `search_web` | Brave Search | Jina Search | Serper.dev |
| `capture_url_source` | Jina Reader | Firecrawl/Exa | Direct HTTP |
| `search_official_docs` | Context7 | — | — |
| `search_arxiv` | arXiv API | — | — |
| `search_semantic_scholar` | Semantic Scholar | — | — |

**Circuit breaker model (per-run, in-memory):**

```
provider: brave_search
  consecutive_failures: 5
  total_failures: 12
  total_successes: 8
  circuit_open_until: null | timestamp
  permanently_skipped: false
```

Rules:
- 3 consecutive failures → circuit open for 60 seconds.
- 10 total failures → permanently skipped for the run.
- Success → consecutive_failures resets.

**Capture independence:** `capture_url_source` has its own ladder. It does NOT require prior Brave discovery. Any provider's discovery is valid. Jina Reader is the primary reader.

**LLM context preservation:** Provider fallback is opaque to the LLM. The agent sees one clean result per tool call. Provenance is passive metadata (e.g., `provider: "Jina"`). No raw HTTP errors in the transcript.

**Budget impact:** 1 tool call per search, regardless of how many providers were tried internally. 30 tool calls can now yield 30+ actual searches across multiple providers, not 30 Brave attempts.

**Configuration-driven:** `factory/config/search-providers.json` defines providers, endpoints, ladders, circuit breaker settings. Adding a provider is a config change, not a code change.

**Code scope:** ~400-500 lines across 3-4 new files + modifications to existing `researchbrain-tools.mjs`, `researchbrain-agent.mjs`, and `researchbrain-stage0-provider-utils.mjs`.

### Option C: Full Provider Mesh with Semantic Routing

- Capability matrix per provider.
- Query classification (academic, web, code, news) → route to best provider.
- Cross-provider result blending.
- Predictive rate-limit modeling across runs.

**Verdict:** Deferred. Over-engineered for current state. Option B naturally upgrades to this after 3+ providers per tool exist.

### Smart Per-Request Rotation (User's Original Idea)

**Concept:** Each `search_web` call hits a different provider → no single provider gets rate-limited.

**Problem:** Does not handle follow-up link capture. If Brave found a URL, reading that URL should NOT depend on Brave. The reader should have its own providers.

**Solution from Option B:** Split search from read. Search rotates providers. Read rotates readers. Both are opaque to the LLM.

**Per-request rotation is valid, but it's an implementation detail inside the ladder, not the whole architecture.** The ladder can round-robin within a tier before falling to the next tier.

---

## 4. Verified Provider Candidates

### Ranking (Rigorously Verified via Official Docs)

#### TIER 1 — Primary Rotation

| # | Provider | Best For | Free Tier | Paid | Rate Limits | Notes |
|---|---|---|---|---|---|---|
| 1 | **Jina AI** | Search + Read | 10M tokens free; Reader 500 RPM / Search 100 RPM | Token top-up | Reader 500 RPM, Search 100 RPM free | One API key covers both `s.jina.ai` (search) and `r.jina.ai` (read). Open-source reader. |
| 2 | **Brave Search API** | High-quality search | $5/mo free credit (~1K req) | $5/1K searches | 50 QPS all tiers | Independent index, 30B+ pages. CC required for free tier. Current provider. |
| 3 | **Exa** | Agentic search + content | 20K req/mo free; $10 signup + $7/mo credits | $7/1K searches, $1/1K pages | 10 QPS search, 100 QPS content | Neural/semantic search. Good for deep research. |

#### TIER 2 — Strong Secondary

| # | Provider | Best For | Free Tier | Paid | Rate Limits | Notes |
|---|---|---|---|---|---|---|
| 4 | **Serper.dev** | Google SERP | 2,500 free queries, no CC | Claims "cheapest" | Unknown | Fast (1-2s). Google-quality results. Pricing page JS-rendered — unclear limits. Some risk. |
| 5 | **Tavily** | AI-optimized search | 1,000 credits/mo free, no CC | $0.008/credit | Not published | AI-native. Extract endpoint. Student plan free. |
| 6 | **Firecrawl** | Scrape + crawl | 1,000 cred/mo free | $16/mo (5K cred) | 2 concurrent free | Best for crawling. Search costs 2x credits. Thin free tier. |

#### TIER 3 — Budget / Self-Host

| # | Provider | Cost | Notes |
|---|---|---|---|
| 7 | **SearXNG** | $0 + VPS (~$5-10/mo) | Docker deploy, JSON API, 70+ engines aggregated. You own rate limits. Privacy-preserving. |
| 8 | **DuckDuckGo (unofficial)** | $0 | `ddgs` Python lib. No API key. Risk: IP bans, CAPTCHAs, violates ToS in spirit. Unreliable for continuous agents. |

#### DEAD / AVOID

| Provider | Reason |
|---|---|
| **Google Custom Search JSON API** | Closing Jan 2027. Not accepting new customers. Dead. |
| **Bing/Azure Web Search API** | No longer standalone. Only "Grounding with Bing" at $14/1K transactions in Azure AI Foundry. No free tier. Dead. |
| **SerpAPI** | 250 searches/mo free. $25/mo for 1K. Too expensive for volume. |
| **Kagi Search API** | $12/1K searches. No free tier. Good quality but too expensive. |

### Recommended Minimum Viable Stack

```
SEARCH rotation (per-request, within ladder):
  tier1: Brave Search API   ($5/mo free credit, 50 QPS)
  tier2: Jina Search API    ($0, 10M tokens, 100 RPM)
  tier3: Serper.dev         ($0, 2.5K queries)
  tier4: SearXNG self-host  ($5-10/mo infra, unlimited)

READ rotation:
  tier1: Jina Reader API    ($0, 500 RPM)
  tier2: Exa Contents       ($1/1K pages, paid backup)
  tier3: Firecrawl          ($0, 1K cred/mo)
  tier4: Direct HTTP fetch  ($0, survival)
```

**Cost at 1K requests/month:** $0 (all free tiers cover it). **At 5K+:** ~$5-10/mo (Brave paid + SearXNG infra).

---

## 5. Agent Behavior: Roam-Free vs. Deterministic

### The Tension

- ResearchBrain **should** roam broadly — that's the point of autonomous research.
- But it should also **converge** — save sources, write hypotheses, move on.
- The current agent never converged: 28 searches, 1 capture, 0 hypotheses.

### Design Principles

1. **Provider plumbing is hardened; agent behavior is guided, not rigidly constrained.** The agent should feel free. The infrastructure should make it safe to roam.

2. **Nudge, don't cage.** Inject convergence hints at budget milestones:
   - At 50% budget: "You have used 15/30 tool calls. Have you captured at least 1 source?"
   - After 5 searches without capture: "5 web searches since last capture. Consider saving promising sources now."

3. **Memory gates should activate earlier.** Currently `check_duplicate_memory` + `check_failed_pattern_similarity` are prerequisites for `record_hypothesis` to become the only allowed tool — but only if the agent attempts `record_hypothesis`. Move these prerequisites upstream so the agent is nudged to self-check before continuing to search.

4. **Search-to-capture soft ratio.** The system prompt should make clear: search broad first (2-3 queries), then narrow to specific leads, capture as you find them, don't wait.

5. **Budget-awareness without panic.** The agent should know: "You have X tool calls remaining. Budget is a constraint, not a target. Use it wisely."

### Recommended System Prompt Enrichment

Add to the existing ResearchBrain system prompt:

> "Your goal is to capture 2-6 sources and record 1-2 hypotheses. Search broadly first (2-3 queries), then narrow to specific leads. Capture promising sources as you find them — don't wait. Call `record_hypothesis` as soon as you have enough evidence. You have a tool-call budget — use it efficiently, not exhaustively."

---

## 6. Implementation Sequence (Recommended)

### Phase 1: Foundation (this cycle)
1. Switch ResearchBrain LLM: DeepSeek v4 Pro, direct provider, `reasoning_effort: max`.
2. Build provider registry engine (`src/adapters/search-provider-registry.mjs`) with ladder logic + circuit breakers.
3. Implement 3 live adapters: Brave, Jina Search, Jina Reader.
4. Refactor `researchbrain-tools.mjs` to use registry instead of single adapter.
5. `factory/config/search-providers.json` for config-driven provider management.

### Phase 2: Expansion (next cycle)
6. Add Serper.dev, Tavily adapters.
7. Implement mid-budget convergence nudges.
8. Live special engines: Context7, arXiv, Semantic Scholar.

### Phase 3: Maturation
9. Google PSE (if still viable), YouTube Data API, GitHub Code Search.
10. Per-run budget scaling from request constraints (`maxSources * 3 + 8`).
11. SearXNG self-host fallback for unlimited survival mode.

---

## 7. Key Files Referenced

| File | Purpose |
|---|---|
| `src/core/researchbrain-tools.mjs` | Tool definitions: `search_web`, `capture_url_source`, memory tools. Single Brave adapter. |
| `src/core/researchbrain-agent.mjs` | Agent loop orchestration + tool runtime. |
| `src/core/researchbrain-llm-providers.mjs` | LLM provider adapters (DeepSeek direct, Anthropic, OpenAI-compatible). Presets. |
| `scripts/researchbrain-stage0-provider-utils.mjs` | CLI provider construction, presets, env detection. |
| `scripts/researchbrain-stage0-runtime.mjs` | Stage-0 runtime CLI entrypoint. |
| `src/core/researchbrain-runtime.mjs` | Runtime execution, budget enforcement, quarantine. |
| `factory/config/` | (Target) Config-driven provider registry destination. |
| `factory/mt5-ftmo-strategy-factory-spec.md` | Active spec. Phase 8B ResearchBrain section. |
| `factory/research/requests/` | Stage-0 research requests (json). |
| `factory/research/runs/` | Stage-0 run outputs (runtime-result, quarantine, transcript, ledgers). |
| `factory/runtime/projections/researchbrain-stage0/` | Projection events. |
| `factory/verification/researchbrain-stage0-supervisor-runs/` | Supervisor run reports. |

---

## 8. Readiness Snapshot (Post Latest Run)

| Metric | Value |
|---|---|
| Total jobs | 15 |
| Blocked (terminal) | 13 |
| Stage-0 ready | 2 |
| Unseeded valid requests | 1 |
| Pending outbox | 0 |
| Runtime consistency | OK |
| Terminal failure reconciliation | Expected only |
| Authority flags | All false |
| Status | `attention` / `drainable` |

---

*End of research document. No code changes made. Awaiting deep-research agent review before implementation.*

# Phase 8B Research Track 2: Source Tools/APIs for LLM ResearchBrain

**Date:** 2026-05-21  
**Goal:** Recommend first-tool shortlist and deferred source tools/APIs for an LLM ResearchBrain discovering source-backed MT5/FTMO-mappable trading hypotheses. No strategy profitability claims.

**Status update, 2026-05-22:** retained as source/API research notes only. The active tool-priority and safety decisions are now in `factory/mt5-ftmo-strategy-factory-spec.md` Sections 11.16B and Phase 8B, plus `factory/research/phase8b-tool-scope-assessment-2026-05-22.md`. Later audit/spec decisions override this memo where they differ, especially: YouTube is now a first-class Stage-0 source class through bounded `search_youtube` and deterministic `inspect_youtube_video`/`youtube_ingest`; default audio transcription remains disabled; market-data, MT5, MQL5, WFA/backtest/optimizer, account, trading, and profitability tools remain out of ResearchBrain.

---

## First-Tool Shortlist (Integrate First)

### 1. Brave Search API (Web Search, Tier: 1st-Choice)

| Property | Detail |
|---|---|
| Endpoint | `https://api.search.brave.com/res/v1/web/search` |
| Auth | `X-Subscription-Token` header, API key from developer dashboard |
| Pricing | $5/1k requests (Search), $4/1k (Answers); $5/mo free credits |
| Rate Limit | 50 QPS (Search), 2 QPS (Answers) |
| Index Size | 30B+ pages, 100M+ daily updates |
| Key Features | Independent index (not Google wrapper), Search Goggles for domain filtering, LLM Context endpoint for RAG-ready snippets (up to 5 per result), SOC 2 attested, Zero Data Retention option |
| Trust Tier | High — independent index, SOC 2, no Google dependency |
| MCP Support | Official MCP server: `brave/brave-search-mcp-server` (MIT, 1.1k stars, 560 commits, 94 releases) |
| Constraints | Credit card required even for free tier (anti-fraud); web page content extraction requires separate HTTP fetch of each URL |
| **Recommendation** | **Primary web search tool.** Best quality/cost for LLM agent. Use Web Search + LLM Context endpoints for hypothesis discovery. Goggles can filter to finance/trading domains. |

### 2. arXiv API (Academic Papers, Tier: 1st-Choice)

| Property | Detail |
|---|---|
| Endpoint | `http://export.arxiv.org/api/query?search_query=...` |
| Auth | None (public API) |
| Pricing | Free, no API key |
| Rate Limit | No documented hard limit; be respectful (~1 request/3 sec recommended) |
| Key Features | Open Access repository (math, physics, CS, quantitative finance, statistics, econ); OAI-PMH compliant; search by author/title/abstract/category; returns Atom XML; full PDFs available |
| Trust Tier | High — academic pre-print server run by Cornell University |
| Constraints | No official JSON API (must parse Atom XML); rate limiting is self-policed; no full-text search in API (only title/abstract/author); commercial use requires attribution |
| Categories Relevant | `q-fin.ST` (Statistical Finance), `q-fin.GN` (General Finance), `q-fin.TR` (Trading), `q-fin.RM` (Risk Management), `cs.LG` (Machine Learning), `stat.ML` |
| **Recommendation** | **Primary academic source.** Free, high-signal papers on quantitative finance/ML. Search `q-fin.*` categories for trading-relevant research. Atom XML parsing required. |

### 3. Semantic Scholar API (Academic Papers, Tier: 1st-Choice)

| Property | Detail |
|---|---|
| Endpoint | `https://api.semanticscholar.org/graph/v1/paper/search` |
| Auth | Optional API key (higher rate limits with key) |
| Pricing | Free (with rate limits); bulk datasets available |
| Rate Limit | 100 req/min without key, 1000 req/min with free key |
| Key Features | Rich paper graph with citations, references, tldr summaries, embeddings; field-of-study filtering; structured JSON; covers arXiv + many other venues |
| Trust Tier | High — nonprofit academic search engine (Allen Institute for AI) |
| Constraints | Free tier sufficient for research; bulk access requires dataset API; not all finance papers are indexed (focused on CS/neuroscience/biomed) |
| **Recommendation** | **Secondary academic source.** Better structured response than arXiv (native JSON). Use for citation graph analysis and tldr summaries. Complements arXiv coverage. |

### 4. Crossref API (Academic Paper Metadata, Tier: 1st-Choice)

| Property | Detail |
|---|---|
| Endpoint | `https://api.crossref.org/works?query=...` |
| Auth | None (public API) |
| Pricing | Free, no API key |
| Rate Limit | 50 req/sec (with polite `mailto`); 5 req/sec without |
| Key Features | DOI resolution, rich metadata (journal, author, references, dates, funding); covers most peer-reviewed journals including finance/economics |
| Trust Tier | High — official DOI registration agency |
| Constraints | Search reliability varies; journal articles only (no pre-prints); high noise on generic queries |
| **Recommendation** | **DOI resolver and journal metadata source.** Use when you have a paper title or DOI and need structured metadata. Not ideal as primary discovery engine. |

### 5. GitHub Search API (Code Discovery, Tier: 1st-Choice)

| Property | Detail |
|---|---|
| Endpoint | `GET https://api.github.com/search/code` |
| Auth | Token required (personal access token, free) |
| Pricing | Free for public repos; 1,000 req/hr authenticated (5,000 for search) |
| Rate Limit | 30 req/min for code search (unauthenticated: 10 req/min) |
| Key Features | Search MQL4/MQL5/Python trading code; search by language (`language:mql5`), repo topic (`topic:trading`), stars, content; code search supports regex |
| Trust Tier | Medium-High — reliable but rate limits are tight for code search |
| Constraints | Code search is scoped to default branch; can't search by file size; can't do regex across repo boundaries; `search/code` has the tightest rate limits of all GitHub endpoints |
| **Recommendation** | **Primary code discovery source.** Search for MQL5 EAs, indicators, Python strategy frameworks. Pair with `search/repositories` to find topically relevant repos. Rate limits necessitate caching. |

---

## Deferred Tools (Integrate Later)

### 6. MQL5 CodeBase (MT5 Strategy Code, Tier: Deferred — Web Scrape)

| Property | Detail |
|---|---|
| URL | `https://www.mql5.com/en/code/mt5` |
| Auth | Public browsing; login required for download |
| Pricing | Free |
| Constraints | **No public API.** Must scrape HTML. Login required for actual code download. ~198 pages of MT5 code listings. Page structure is server-rendered HTML. Cloudflare protection likely. `robots.txt` may restrict scraping. |
| Content Value | Extremely high — 1000s of MQL5 EAs, indicators, scripts; many with source code; recent entries include ML, Fourier, GARCH, Kalman Filter implementations |
| **Defer Reason** | No API. Scraping is fragile, rate-limited, and may violate ToS. Recommend: (a) use GitHub search for MQL5 code (many MQL5 CodeBase authors mirror), (b) use Brave Search with `site:mql5.com/en/code` queries instead. |

### 7. MQL5 Articles (Strategy Research, Tier: Deferred — Web Scrape)

| Property | Detail |
|---|---|
| URL | `https://www.mql5.com/en/articles` |
| Auth | Public browsing |
| Pricing | Free |
| Constraints | **No public API.** 72 pages of articles. Server-rendered HTML. Recent articles cover advanced topics: nested CV, ONNX inference, GARCH, CRQA, entropy-based volatility. |
| Content Value | Very high — deep technical articles on strategy implementation, ML in MQL5, statistical methods |
| **Defer Reason** | Same as CodeBase — no API. Prefer Brave Search `site:mql5.com/en/articles` for LLM discovery. |

### 8. YouTube Data API v3 (Video Metadata And Transcript-Gated Inspection, Tier: First-Class Governed Source)

| Property | Detail |
|---|---|
| Endpoint | `https://www.googleapis.com/youtube/v3/search` |
| Auth | API key (Google Cloud Project) |
| Pricing | Free quota: 10,000 units/day; search = 100 units; video list = 1 unit |
| Rate Limit | 10,000 quota units/day default, can request more |
| Key Features | Search trading strategy videos; get captions/transcripts via YouTube Transcript API (separate, non-Google tool); channel search for trading educators |
| Constraints | Quota evaporates fast (100 search queries = 10,000 units = entire daily quota); transcript extraction requires third-party tools (e.g., `youtube-transcript-api`); captions often auto-generated, low accuracy for financial jargon |
| Trust Tier | Medium — Google API, well-documented, but quota is expensive |
| **Governed Use** | Active spec override, 2026-05-22: YouTube is first-class for Stage-0 discovery, but video-content claims require deterministic metadata/transcript/chunk artifacts with path/hash provenance. Use search sparingly because quota is expensive. If no timestamped transcript chunks are captured, title/description/channel/popularity are discovery-only and cannot support a hypothesis. |

### 9. Tavily API (AI-Optimized Web Search, Tier: Deferred — Evaluate)

| Property | Detail |
|---|---|
| Endpoint | `https://api.tavily.com/search` |
| Auth | API key |
| Pricing | Freemium (free tier with limited requests); paid plans |
| Rate Limit | Varies by plan |
| Key Features | Purpose-built for LLM agents: search + extract + research + crawl endpoints; built-in content extraction (no separate fetch step); 100M+ requests/month handled; SOC 2 attested; Databricks/IBM partners |
| Trust Tier | Medium — popular (1M+ developers) but newer company; $25M Series A |
| Constraints | Index is likely Bing or other third-party sourced (not independent); cost structure less transparent than Brave; proprietary crawling |
| **Defer Reason** | Brave Search covers the same use case cheaper (independent index, lower cost, MCP server) and with better transparency. Re-evaluate if Brave proves insufficient. |

### 10. Exchange/Data Provider APIs (Market Data, Tier: Deferred — Not for ResearchBrain)

| Property | Detail |
|---|---|
| Examples | Binance API (`https://api.binance.com`), Yahoo Finance (`yfinance`), Alpha Vantage, Polygon.io, Intrinio |
| Auth | API keys required for most |
| Pricing | Free tiers exist (Binance: free public endpoints; Yahoo: free but unofficial; Alpha Vantage: 5 req/min free); paid plans for professional use |
| Constraints | **Not for hypothesis discovery** — these are market data APIs, not research sources. They provide OHLCV/fundamental data for WFA, not strategy ideas. |
| **Defer Reason** | Out of scope for ResearchBrain (which discovers source-backed hypotheses). Data fetcher role already exists separately. |

### 11. Crossref/DOI Resolution (Tier: Deferred for now — Included in Shortlist above)

Already covered. Not deferred.

### 12. MQL5 Forum (Tier: Deferred — Web Scrape)

| Property | Detail |
|---|---|
| URL | `https://www.mql5.com/en/forum` |
| Auth | Public browsing; login for posting |
| Pricing | Free |
| Constraints | **No API.** 60,000+ general topics, 15,000+ EA threads, 5,000+ indicator threads. High noise-to-signal. Requires scrolling through pages. Cloudflare likely. |
| Trust Tier | Low-Medium — community content, variable quality |
| **Defer Reason** | No API, high noise. Prefer `site:mql5.com/en/forum` + Brave Search for targeted queries (e.g., "EURUSD mean reversion strategy site:mql5.com/en/forum"). |

---

## Per-Source Constraints Table

| Source | Auth | Rate Limit | Cost | Content Quality | Content Type | Legal/robots |
|---|---|---|---|---|---|---|
| **Brave Search** | API key | 50 QPS | $5/1k req (free $5/mo) | High | Web results, snippets | ZDR option, SOC 2, MIT MCP server |
| **arXiv** | None | Self-policed (~1/3s) | Free | Very High | Academic papers (ATM XML) | OA, attribution required for commercial |
| **Semantic Scholar** | Optional key | 1000 req/min (with key) | Free | High | Paper graph, JSON | Fair use, non-commercial preferred |
| **Crossref** | None | 50 req/sec (with mailto) | Free | Medium | Journal metadata (JSON) | Open metadata, CC0 |
| **GitHub Search** | Token | 30 req/min code search | Free | High | Source code | Public repo terms |
| **MQL5 CodeBase** | Login for download | Unpublished | Free | High | MQL5 source code | Login-wall for download |
| **MQL5 Articles** | None | Unpublished | Free | High | Technical articles | Copyright retained by authors |
| **YouTube Data** | API key | 10k quota/day | Free (quota-limited) | Medium | Video metadata, captions | Google ToS, quota per project |
| **Tavily** | API key | Varies by plan | Freemium | Medium | Web + extraction | SOC 2, proprietary |
| **MQL5 Forum** | None (read) | Unpublished | Free | Variable | Community discussions | No automated scraping likely allowed |

---

## Auth/Rate Limits Summary

| Complexity Tier | Sources |
|---|---|
| **Zero auth / Free** | arXiv, Crossref (with `mailto`) |
| **Key required, free tier** | Brave Search ($5/mo free), Semantic Scholar, GitHub Token (free), YouTube (quota-based free) |
| **Login wall required** | MQL5 CodeBase (code download only) |
| **No API / scrape only** | MQL5 CodeBase (listing), MQL5 Articles, MQL5 Forum |
| **Paid only beyond free tier** | Brave Search ($5/1k beyond free), Tavily |

**Practical advice for LLM agent:** Brave Search + arXiv + GitHub Search cover ~80% of hypothesis discovery needs with simple API key management. Add Semantic Scholar for deeper citation analysis. Scrape-based sources should be wrapped with Brave Search `site:` queries instead.

---

## Source Trust Tiers (for ResearchBrain source provenance)

| Tier | Criteria | Sources |
|---|---|---|
| **Tier 1 — Primary Verifiable** | Peer-reviewed or verifiable code; API-backed; no scraping fragile | arXiv, Semantic Scholar, Crossref, GitHub |
| **Tier 2 — Secondary Verifiable** | Semi-official documentation, moderated community, API-backed but lower authority | MQL5 Documentation (PDF/CHM), Brave Search as discovery only, MetaQuotes release notes |
| **Tier 3 — Community Discovery** | Unmoderated content, variable quality, potential noise | MQL5 Forum, trading blogs, YouTube |
| **Tier 4 — Unverified** | No API, scrape-only, content may be promotional, low quality | Most trading blogs, social media, market commentary sites |

---

## Cost Projection

| Usage Level | Monthly Cost | Source Mix |
|---|---|---|
| **Light** (~500 queries/mo) | $0 | Brave free credits + GitHub + arXiv + Semantic Scholar |
| **Medium** (~5,000 queries/mo) | ~$10-25 | Brave (5k web + 5k LLM context) + free academic APIs |
| **Heavy** (~50,000 queries/mo) | ~$250-500 | Brave Enterprise or Tavily paid; may still keep academic sources free |

---

## Failure Modes and Mitigations

| Failure Mode | Sources Affected | Mitigation |
|---|---|---|
| **Rate limit exceeded** | GitHub code search (30/min), YouTube (10k/day) | Cache results with TTL; queue requests; fallback to Brave for discovery |
| **API sunset/deprecation** | Google Custom Search (closing 2027) | Not in shortlist; Brave is independent |
| **Content behind login** | MQL5 CodeBase download | Use GitHub mirror or Brave search |
| **Scraping blocked** | MQL5 Articles/Forum | Use `site:mql5.com` + Brave Search; handle 403s gracefully; respect `robots.txt` |
| **Token expiry** | Brave, GitHub, YouTube | Store tokens in env/secrets; implement refresh/re-auth flow; fail without hallucinating |
| **Empty/no results** | Any source | Return blocked/inconclusive; log query + empty reason; do not fabricate |
| **Parse errors** | arXiv (Atom XML), Crossref (evolving schema) | Validate response schema; store raw response alongside parsed; log parse failures |
| **Stale/old content** | Academic papers (lag), code repos (unmaintained) | Check publication/update date; prefer recent (≤2yr for papers, ≤1yr for code); tag source freshness |
| **Downloaded code has malware** | GitHub, MQL5 CodeBase | Sandbox execution; never run untrusted MQL5 code in production; scan for suspicious patterns |
| **Copyright/license risk** | All content sources | Track source URL + hash; do not redistribute verbatim code; cite sources in hypotheses; no commercial use of GPL/CC-NC content |

---

## Fetch/Capture Feasibility Summary

| Source | Fetch Method | Capture Format | Pipeline Complexity |
|---|---|---|---|
| **Brave Search** | HTTPS GET | JSON | Low — single API call |
| **arXiv** | HTTPS GET | Atom XML → parse to JSON | Medium — XML parsing needed |
| **Semantic Scholar** | HTTPS GET | JSON | Low |
| **Crossref** | HTTPS GET | JSON | Low |
| **GitHub Search** | HTTPS GET | JSON | Low |
| **MQL5 CodeBase** | HTTPS GET + HTML parse | HTML → text extraction | High — fragile DOM parsing, login for download |
| **MQL5 Articles** | HTTPS GET + HTML parse | HTML → text extraction | High — fragile DOM parsing |
| **YouTube** | HTTPS GET | JSON | Medium — quota management |
| **MQL5 Forum** | HTTPS GET + HTML parse | HTML → text extraction | High — pagination, noise |

---

## Citations and URLs

### Web Search APIs
- Brave Search API: https://brave.com/search/api/
- Brave Search MCP Server: https://github.com/brave/brave-search-mcp-server
- Brave Search API Docs: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
- Google Custom Search JSON API (CLOSING 2027): https://developers.google.com/custom-search/v1/overview
- SerpAPI: https://serpapi.com/search-api
- SerpAPI Google Search Engine: https://serpapi.com/search-api
- Tavily: https://tavily.com (docs: https://docs.tavily.com)

### Academic/Semantic APIs
- arXiv API: https://info.arxiv.org/help/api/index.html
- arXiv API Basics: https://info.arxiv.org/help/api/basics.html
- Semantic Scholar API: https://api.semanticscholar.org/api-docs/graph
- Semantic Scholar Paper Search: https://api.semanticscholar.org/api-docs/graph#tag/Paper-Data/operation/get_paper_search
- Crossref REST API: https://api.crossref.org/swagger-ui/index.html

### Code Discovery
- GitHub REST API Docs: https://docs.github.com/en/rest/overview/resources-in-the-rest-api
- GitHub Search Endpoints: https://docs.github.com/en/rest/search/search

### MQL5/MetaQuotes
- MQL5 Documentation: https://www.mql5.com/en/docs
- MQL5 CodeBase: https://www.mql5.com/en/code
- MQL5 Articles: https://www.mql5.com/en/articles
- MQL5 Forum: https://www.mql5.com/en/forum
- MetaTrader 5 Help: https://www.metatrader5.com/en/terminal/help
- MT5 Trading Platform Docs: https://www.metatrader5.com/en/trading-platform
- MQL5 PDF Download: https://www.mql5.com/files/docs/mql5.pdf
- MQL5 AlgoBook: https://www.mql5.com/en/book
- MQL5 NeuroBook: https://www.mql5.com/en/neurobook

### YouTube
- YouTube Data API v3: https://developers.google.com/youtube/v3/getting-started
- YouTube Data API Reference: https://developers.google.com/youtube/v3/docs

### MCP
- Model Context Protocol: https://modelcontextprotocol.io/llms.txt
- Brave MCP Server: https://github.com/brave/brave-search-mcp-server

---

## Recommendation Summary

**Immediate integration (ResearchBrain v1):**
1. **Brave Search API** — primary web discovery (MCP server ready, $5/mo free)
2. **arXiv API** — academic quantitative finance papers (free, no key)
3. **Semantic Scholar API** — citation graph + paper tldr (free with key)
4. **GitHub Search API** — discover MQL5/Python strategy code (free with token)
5. **Crossref API** — DOI/journal metadata (free, no key)

**Deferred (v2+):**
6. MQL5 CodeBase (via Brave `site:` search — avoid direct scraping)
7. MQL5 Articles (via Brave `site:` search)
8. YouTube Data API (only for specific high-confidence video transcripts)
9. Tavily API (if Brave proves insufficient for content extraction)
10. MQL5 Forum (via Brave `site:` search — high noise)
11. Exchange data APIs (not for ResearchBrain — belong in data fetcher role)

**Never scrape directly** — use Brave Search as a crawler-proxy to discover MQL5 content without fragile HTML parsing. This aligns with operator doctrine: the LLM should think and discover, not maintain DOM parsers.

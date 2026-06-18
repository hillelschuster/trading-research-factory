# Phase 8B Tool Scope Assessment

Date: 2026-05-22

Input reviewed: 2026-05-22 advisor response. This assessment is the retained active summary; the raw response is superseded by the active spec and this file.

Scope: assess advisor recommendations against this repository's actual Phase 8B code/spec state. This document does not execute ResearchBrain, WFA, MT5, or mutate official state/evidence/backlog/leaderboard authority.

## Verdict

The advisor response is useful and materially affects the ResearchBrain v1 tool plan, but should be applied selectively.

Accepted core finding: the original tool set is directionally correct but under-specified for MT5/FTMO source classes and memory depth.

Rejected overreach: do not expand ResearchBrain into market-data, backtest, MT5, optimizer, account, social-scraping, or bulk-ingestion authority.

## Accepted Changes

1. Rename generic source fetch from `fetch_search_result` to `capture_url_source`.

Reason: ResearchBrain evidence should depend on captured, hashed source content, not whether a URL came from a search result.

2. Add first-class source-class discovery tools:

- `search_official_docs`
- `search_mql5_sources`
- `search_broker_docs`

Reason: this project targets MT5/FTMO and later MQL5 parity. Generic web search can find these sources, but explicit source-class tools improve coverage and provenance.

3. Keep GitHub capture source-specific with `capture_github_artifact`.

Reason: exact file path, commit SHA, repo URL, and license/provenance metadata matter. GitHub code may support implementation details only; it cannot support profitability.

4. Strengthen memory tools:

- `search_research_memory`
- `check_duplicate_memory`
- `check_failed_pattern_similarity`

Reason: existing code indexes Stage-0 packets/source records and exposes some retrieval to Ideator/Planner, but the live ResearchBrain tool loop needs explicit read-only memory search during a run. A single exact duplicate check is too weak against same-mechanism/new-parameter churn.

5. Keep market-data and execution tools out of ResearchBrain.

Reason: outcome inspection invites overfitting and blurs Stage-0 discovery with validation. Data readiness and WFA remain deterministic worker responsibilities.

## Modified V1 Tool Set

Discovery:

- `search_web`
- `search_official_docs`
- `search_mql5_sources`
- `search_broker_docs`
- `search_youtube`
- `search_arxiv`
- `search_semantic_scholar`
- `search_github_code`

Capture:

- `capture_url_source`
- `capture_github_artifact`
- `inspect_youtube_video` through deterministic `youtube_ingest`

Repo and memory:

- `read_repo_artifact`
- `search_research_memory`
- `check_duplicate_memory`
- `check_failed_pattern_similarity`

Writes:

- `record_rejection`
- `record_hypothesis`

## Deferred Or Rejected For V1

- market-data APIs
- MT5 terminal access
- MQL5 compilation
- backtest/WFA/optimizer execution
- live/paper trading
- broker login/account tools
- Sharpe/return/profitability estimators
- Telegram/Discord/Reddit/TradingView/social bulk scraping
- bulk forum/comment ingestion
- paid-news scraping
- automated repository cloning at scale
- full-video audio transcription by default

## Codebase Implications

Current code already has:

- Stage-0 artifact validators in `src/core/researchbrain-artifacts.mjs`
- runtime/provider seam in `src/core/researchbrain-runtime.mjs`
- Stage-0 indexing in `src/core/memory-index.mjs`
- Ideator/Planner retrieval in `src/core/retrieval.mjs`
- non-live scripted tool-loop plumbing in `src/core/researchbrain-agent.mjs`
- deterministic scripted tools in `src/core/researchbrain-tools.mjs`
- deterministic YouTube ingestion helper in `src/core/researchbrain-youtube-ingest.mjs`

Still needed:

- implement `src/core/researchbrain-llm-providers.mjs`
- split fixture/live tool modes so live tools cannot accept injected search results or LLM-supplied source content
- add output collision, field allowlist, profitability-alias, memory-check, repo-read, and provider-run-id enforcement before live ResearchBrain execution
- add live provider tests before first provider canary

## Safety Rule

ResearchBrain may use memory to reject duplicates and known failures. It must not use prior WFA outcomes to tune parameter variants.

# ResearchBrain Finalization Plan

> Supporting finalization record for ResearchBrain architecture direction, state, and next steps. The active implementation authority remains `factory/mt5-ftmo-strategy-factory-spec.md` (§11.16G). This document is supporting doctrine only.

> **2026-07-05 authority update:** The active implementation authority is now `factory/mt5-ftmo-strategy-factory-spec.md` §11.16G. This finalization plan is historical/supporting context. When this document conflicts with §11.16G, §11.16G wins. In particular, older language that treats convergence failure as model-only, requires multiple source families, relies on a post-recording critic turn, or treats the active wiki as required live-loop cognition is superseded.

## 0. 2026-07-05 deep review update — current lean path

Deep review verdict: ResearchBrain's Stage-0 authority boundary is sound, but the live loop is structurally biased toward endless scouting. The failure is **not** just GLM 5.2 compliance. Current affordances make another search easier than synthesis: all search tools remain available, source diversity reads like a checklist, `record_hypothesis` is high-friction, wiki tools can waste budget, and adapter failures can appear as empty results. Text budget nudges are insufficient.

**2026-07-06 implementation status:** First lean convergence batch is implemented and verified. Job-specific `job_settings` now propagate through seeding into runtime-ledger payloads without secret values; live agent tool availability now structurally forces synthesis at ~60% and ~80%/final-turn thresholds; prompt guidance now follows promising sources, moves critic before `record_hypothesis`, removes hardcoded budget counts, and keeps single-source-with-depth valid; Semantic Scholar is env-name-only via `SEMANTIC_SCHOLAR_API_KEY`; live search adapter errors now surface as serialized `adapter_error`; Semantic Scholar/Brave have minimal limiter shape. Review follow-up fixed live GitHub content-injection blocking and the wiki `runId` ReferenceError path. `record_hypothesis` now requires only core fields from the LLM, defaults lower-value packet fields server-side, and auto-runs missing memory prerequisites while failed-pattern blocking remains hard. Composite source capture now reports all failed sub-adapters with adapter names/messages. Verified with focused 63/63, broader ResearchBrain 156/156, `rtk npm run validate`, and later `tests/researchbrain-agent.test.mjs` 50/50 after the record-friction/composite-diagnostic slice. Live canary deferred because required env vars were absent in the execution environment.

**2026-07-06 live-preflight/provider-account status:** Repo `.env` loading through the existing supervisor/provider-utils path was used. Composite `brave,semantic_scholar` preflight now validates per-adapter env names and passed with `DEEPSEEK_API_KEY`, `BRAVE_SEARCH_API_KEY`, and `SEMANTIC_SCHOLAR_API_KEY` present. Bounded live canaries reached DeepSeek and blocked on upstream `HTTP 402 Insufficient Balance`; diagnostics now preserve that as non-retryable `provider_account_or_quota_failure` through retry, runtime, and loop failure summaries. Authority flags stayed false; no WFA/MT5/MQL5/Phase 8E/profitability/official state mutation occurred. Latest focused tests: 78/78.

Current corrected model:

1. Let the LLM free-roam early.
2. Do not force multiple source families; one externally grounded source can be enough.
3. Do not let "scout broadly" become "touch every adapter." Follow promising sources.
4. Move critic/self-review before `record_hypothesis`; a post-record critic cannot run while the loop exits immediately after recording.
5. Force a writing/synthesis phase by changing allowed tools after budget thresholds.

Current atomic implementation order, copied from the active spec so future workers do not resurrect superseded tasks:

1. [x] Fix `seedResearchBrainStage0Job()` payload propagation so job-specific LLM/source settings actually persist into runtime-ledger payloads.
2. [x] Add hard synthesis gating in `researchbrain-agent.mjs`: at ~60% budget remove new search tools; at ~80%/final turn allow only memory prerequisites, `record_hypothesis`, and `record_rejection`; fix the dead 80% branch.
3. [x] Rewrite the system prompt around source-following rather than checklist scouting, pre-record critic, single-source-with-depth, and actual runtime budget counts.
4. [x] Reduce `record_hypothesis` friction or auto-run/store memory prerequisites without weakening failed-pattern blocking.
5. [~] Surface adapter errors and add minimal adapter-aware rate-limit handling for Brave/arXiv/Reddit/GitHub/Semantic Scholar. Live search errors are visible; Semantic Scholar/Brave have minimal limiter shape; composite capture now reports sub-adapter failures; composite source-provider preflight validates per-adapter env names; provider account/quota failures are explicit. Broader adapter-specific polish remains deferred.
6. [~] Remove wiki tools from the active LLM loop or fix them fully; preferred lean path is post-hoc wiki rendering from structured artifacts. The `runId` crash path is fixed; active-loop wiki decision remains open.
7. [~] Recompute/validate hypothesis `content_hash`, validate provenance object shape, validate planner `source_hashes[]`, and fix/block live GitHub capture fixture content. Live GitHub LLM-supplied content is blocked; full deterministic GitHub capture/provenance hardening remains open.
8. [~] Rerun the three Step-14B style canaries with the same budgets and evaluate convergence. One bounded DeepSeek canary reached the live provider via repo `.env` and blocked on upstream `HTTP 402 Insufficient Balance`; meaningful convergence reruns remain blocked until provider balance is restored.

Do **not** do next: no curated source warehouse, broad provider-router, separate scout/synthesizer model, supervisor decomposition, shared-utils cleanup, WFA/MT5/MQL5 tool expansion, or profitability claims before the lean fixes above are implemented and re-canary-tested.

## 1. Where ResearchBrain stands

### 1.1 Architecture boundary is sound; convergence still needs structural loop control

The evidence-first hybrid pipeline recommended in `researchbrain-architecture-finalization-2026-06-23.md:28-49` remains useful long-term context, but the 2026-07-05 deep review supersedes the earlier conclusion that model choice alone dominates architecture shape. Model quality matters, but the immediate binding gap is structural loop control: the loop lets scouting continue after the point where a bounded researcher should synthesize or reject.

| Run | Model | Effort | Tool calls | First capture | Outcome | Cost |
|---|---|---|---|---|---|---|
| `RESEARCHBRAIN-STAGE0-RUNTIME-20260624190036` | GLM 5.2 | xhigh | 6 | call 2 | `ready`, 1 hypothesis, 3 disconfirming + 3 invalidation items | $0.000009 |
| `RESEARCHBRAIN-STAGE0-RUNTIME-20260624190347` | Kimi K2.7 Code | high | 1 | never | `blocked`, 0 hypotheses | $0.000001 |
| `RUN-RB-STAGE0-...-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z` | DeepSeek V4 Flash | xhigh | 12 | call 2 | `ready`, 1 hypothesis | $0.000019 |
| `RUN-RB-STAGE0-...-MT5-MULTIASSET-LIQVOL-...-20260612T1305Z` | DeepSeek V4 Flash | xhigh | 30 (budget exhausted) | call 19 | `blocked`, 0 hypotheses | $0.000041 |

The same Brave adapter, same tools, same 30-call budget produced convergence or failure depending on model. Later 50-call GLM canaries showed a second factor: even with enough calls, text nudges did not force synthesis. Therefore the next fix is hard synthesis gating plus reliability/provenance fixes, not model roulette or curated-corpus infrastructure.

**Verdict:** Keep the Stage-0 cage and free-roam mental model. Do not accelerate source warehouses or provider routing. The first §11.16G convergence batch is now implemented; next meaningful step is either `record_hypothesis` friction reduction / remaining reliability hardening, then rerun canaries once required env vars are present.

### 1.2 Live path works end-to-end but has a real reliability gap

The live path exists and is wired:
```
CLI (run-researchbrain-stage0-supervisor.mjs)
  → provider-utils → researchbrain-stage0-supervisor.mjs (~1855 lines)
  → job-seeder / loop-runner / outbox-consumer / diagnostics / readiness
  → runResearchBrainStage0Runtime() (researchbrain-runtime.mjs, 932 lines)
  → researchbrain-agent.mjs (428 lines) → researchbrain-tools.mjs (779 lines)
  → researchbrain-llm-providers.mjs: OpenAI-compatible / DeepSeek
  → artifacts (researchbrain-artifacts.mjs, 1127 lines) + projections
```

**But** `rtk npm run researchbrain:stage0-diagnostics` (2026-06-24) reports:
- 17 total jobs, **15 blocked**, 2 `stage0_ready`, 0 queued/ready/claimed.
- Latest failures include 2026-06-24 Kimi+GLM **loop** runs both blocked with `no_valid_provider_output` — despite standalone GLM runtime succeeding in the bakeoff. This suggests a **supervisor/loop wiring or policy issue** distinct from model quality: the loop path blocks where the direct-runtime path succeeds.
- `rtk npm run researchbrain:stage0-readiness` flags one **unreconciled terminal failure** (`JOB-RB-STAGE0-RESEARCHBRAIN-REQUEST-OPENCODE-GO-GLM-20260624-19091F2552B95A564A603BBD`, event `EVT-RB-STAGE0-696032161d91906723e71ce8ab3f718a`): projection artifact expected SHA `f2f3...` vs actual `f2b4...`, `consumer_id` mismatch (`...8581...` vs `...8604...`), `processed_at`/`projected_at` mismatch, `modified_after_processed`. Kimi event reconciled true. Official authority flags remained false.

This is a concrete queue/projection consistency bug, not an architecture problem.

### 1.3 Phase closure status (verified in spec)

- Phase 8A `[x]` closed 2026-05-19 — MT5/FTMO tradable universe + data alignment.
- Phase 8B `[x]` closed 2026-05-23 — ResearchBrain Stage-0 contracts/retrieval/provenance + live canary.
- Phase 8C `[x]` closed 2026-05-27 — WFA/evidence-safety hardening (10 met / 0 pending / 4 deferred).
- Phase 8D `[x]` closed 2026-06-02 — bounded screening-pipeline validation, **zero survivors accepted**, manual roulette stopped.
- Phase 8E `[ ]` blocked — correctly gated on Phase 8D survivor + MT5 equivalence + operator authorization.

### 1.4 Secret hygiene: clean

No committed secret values found. `.gitignore:8-13` covers `.opencode/`, `.slim/deepwork/`, `node_modules/`, `.env`. All `BRAVE_SEARCH_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENCODE_API_KEY` occurrences are env var **names**, never values. Test dummy keys are explicit safe placeholders. No bearer tokens committed. Runtime projections and ResearchBrain artifacts do not log API key values.

### 1.5 Code hygiene observations (non-blocking)

- `researchbrain-stage0-supervisor.mjs` is a **1855-line monolith** mixing policy, preflight, cycles, classification, health, report-writing, failure envelopes. Extractable but not urgent.
- `researchbrain-artifacts.mjs` (1127 lines) mixes schema constants, validators, builders, writers, and heavyweight business logic (`classifyResearchBrainBacklogSourceQuality`, `validateResearchBrainPlannerProvenance`).
- **Duplicate `resolveRepoRelativePath` / `sha256File` / `sha256Text` helpers** reimplemented verbatim in ~10 core files (~150 lines total). Could be a shared `path-utils.mjs`.
- `researchbrain-youtube-ingest.mjs` (251 lines) is **fixture-only with zero direct tests**. Cold dead weight until a live YouTube adapter is added.
- `createMapResearchBrainSourceToolAdapter` and `createMapResearchBrainSourceFetcher` are test-only exports.
- YouTube CLI flags in `run-researchbrain-stage0-runtime.mjs:66-73` are parsed but **never wired** (reserved/no-op).

---

## 2. Phase 1B two-model bakeoff (Kimi K2.7 Code vs GLM 5.2 via OpenCode Go, 2026-06-24)

Setup: same request shape, same tools, same budget (`--max-llm-calls 12 --max-tool-calls 30 --llm-max-tokens 8192 --timeout-ms 180000 --max-estimated-live-cost-usd 1.0 --source-provider brave --tool-mode live`).

Discovered live:
- `https://opencode.ai/zen/go/v1/models` — bare IDs (`kimi-k2.7-code`, `glm-5.2`). The `opencode-go/<id>` prefix from the docs returns HTTP 401 "Model not supported".
- Kimi `reasoning_effort` ∈ {minimal, low, medium, high}; `xhigh` is rejected.
- GLM accepts `reasoning_effort: xhigh`.

Run results:
- `RESEARCHBRAIN-STAGE0-RUNTIME-20260624190347` (kimi-k2.7-code, high): `blocked`, 1 tool call (search_web no results), $0.000001.
- `RESEARCHBRAIN-STAGE0-RUNTIME-20260624190036` (glm-5.2, xhigh): `ready`, 6 tool calls, first capture at call 2, 1 `record_hypothesis`, $0.000009, captured federalreserve.gov (Dobrev/Liu/Kim/Rodriguez 2025-11-03), 3 disconfirming + 3 invalidation + 3 expected-failure items.

Implications: model quality is a major control variable, not background noise. The earlier provider-router synthesis is even less compelling — model choice dominates search-query success rate. Hybrid evidence-first recommendation is unchanged; if anything, the GLM result strengthens it. Cost is < 5¢/canary across all backends tested.

Open follow-ups: re-run Kimi with different first query, run 3rd model (DeepSeek V4 Flash) on same request, capture "first-query chosen by each model" table.

---

## 3. Phase 1 baseline slice

- Keep it small: readiness + diagnostics + 1 successful live canary + 1 blocked budget-exhausted run.
- 2026-06-23 Step 1 snapshot: `researchbrain:stage0-diagnostics` reports 15 total Stage-0 jobs, 2 `stage0_ready`, 13 `blocked`, 0 queued/ready/claimed, 0 unreconciled terminal failures, 15 processed outbox events, runtime consistency `ok`.
- First comparison result: success run `RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B` finished `ready` with 12 total tool calls (`search_web` 1, `capture_url_source` 1, memory tools 9, `record_hypothesis` 1), first capture at tool call 2, estimated cost `$0.000019`. Blocked run `RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0` finished `blocked` / `terminal_failed_condition`, quarantine reason `ResearchBrain tool call budget exceeded: 30`, 30 total tool calls (`search_web` 28, `capture_url_source` 1, `search_research_memory` 1), first capture at tool call 19, estimated cost `$0.000041`, runtime blocker `no_valid_provider_output`.

---

## 4. Next-step plan (prioritized)

### P0 — Fix agent prompt: enforce discovery-first, kill confirmation bias

**Problem (identified 2026-06-25):** The GLM "success" run was not real research — it was confirmation bias. The agent started with "order flow imbalance" from its training data, then searched specifically to find a supporting source. It never scouted arxiv, reddit, broker docs, or diverse sources to DISCOVER a novel edge. The hypothesis was built on LLM training data, which is the OPPOSITE of what ResearchBrain is for.

**Root cause:** `src/core/researchbrain-llm-providers.mjs:38-51` `buildSystemPrompt()` says "discovery agent" but never enforces discovery-first behavior. The agent is free to generate a hypothesis from training data and then search to confirm it. No instruction to:
- Scout diverse external sources FIRST (arxiv, reddit, broker docs, semantic scholar, github) before forming any hypothesis
- Discover edges from external sources, not from LLM training data
- Let sources drive the hypothesis, not the other way around
- Avoid starting with a preconceived idea and searching to confirm it
- Search broadly across multiple source families before capturing anything

**Action:** Rewrite `buildSystemPrompt()` to enforce a discovery-first workflow:
1. **Phase 1 — Scout externally, then follow signal:** Start broad enough to avoid training-data confirmation, but do not treat source classes as a checklist. Choose one or two promising source classes first, capture/read deeply, and switch only when the trail is weak. Do NOT start with a specific hypothesis.
2. **Phase 2 — Read and synthesize:** Capture and read multiple sources. Let the sources suggest patterns, not the other way around.
3. **Phase 3 — Form hypothesis FROM sources:** Only after capturing 2+ sources from 2+ source families, form a hypothesis that is grounded in what was discovered, not in training data.
4. **Phase 4 — Validate:** Check for duplicates, failed patterns, disconfirming evidence. Then record.

**Enforcement:** The agent loop (`researchbrain-agent.mjs:303-310`) already gates `record_hypothesis` behind memory checks + source captures. Do **not** add a ≥2-source-family gate; that contradicts trader mentality and would block valid contrarian single-source hypotheses. The correct gate is at least one deterministic captured external source plus pre-record synthesis/disconfirmation/memory checks, followed by hard synthesis-phase tool gating when budget is mostly used.

**Verify:** Re-run the GLM request. The agent should NOT start with "order flow imbalance." It should scout broadly first, then form a hypothesis from what it finds.

### P0 — Fix live loop reliability (after prompt fix)

**Problem:** 2026-06-24 supervisor **loop** runs (Kimi + GLM) both blocked with `no_valid_provider_output`, but standalone GLM runtime succeeded in the bakeoff. The loop path blocks where the direct-runtime path succeeds.

**Action:** Debug the supervisor/loop wiring. Likely candidates: provider factory construction in loop context vs direct runtime, tool-call budget policy enforcement, or live-provider opt-in flags not propagating through the loop path. This is a bounded debug task, not architecture work.

**Verify:** After fix, re-run the GLM request through the supervisor loop and confirm it produces `ready` status matching the standalone runtime.

### P0 — Reconcile unreconciled terminal failure + clean stale blocked jobs

**Problem:** Readiness reports one unreconciled terminal failure with projection SHA/consumer_id mismatch. Diagnostics reports 15/17 jobs blocked.

**Action:**
1. Investigate `EVT-RB-STAGE0-696032161d91906723e71ce8ab3f718a` projection mismatch (expected `f2f3...` vs actual `f2b4...`).
2. Reconcile or quarantine the 15 stale blocked jobs. Most are old terminal blocked runs accumulating in the ledger.

**Verify:** `rtk npm run researchbrain:stage0-readiness` reports 0 unreconciled terminal failures; diagnostics shows clean job counts.

### P1 — Run GLM xhigh 50-tool-call convergence experiment (after P0 prompt + loop fix)

**Rationale:** The architecture memo diagnosed non-convergence from a 30-call budget floor. The binding question — "is live-search sufficient at adequate budget, or is curated corpus a hard dependency?" — is unsettled. A ~$0.50 experiment settles it. **But only meaningful after the prompt fix** — otherwise we're measuring confirmation-bias convergence, not research convergence.

**Action:** Run the existing live-search loop with GLM 5.2 (xhigh), 50 tool calls, 8192 tokens, on the 3 narrow MT5 Stage-0 requests:
- `RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z`
- `RESEARCHBRAIN-REQUEST-MT5-SESSION-REGIME-STAGE0-20260612T1306Z`
- `RESEARCHBRAIN-REQUEST-MT5-CFD-SOURCE-MAPPING-STAGE0-20260612T1307Z`

**Measure:** accepted-hypothesis rate per run, captures-per-search, source-family diversity, time-to-first-capture, disconfirming-evidence count per hypothesis, **and whether the hypothesis was source-discovered vs training-data-confirmed**.

**Decision gate:**
- If GLM reliably produces 1+ source-discovered hypothesis across ≥2 of 3 requests at <$0.01/run → curated corpus is **enrichment, not urgent pivot**. Shift to WFA candidate throughput + data-readiness.
- If GLM produces <33% hypothesis rate at 50 calls → curated corpus becomes a **hard dependency**; accelerate Phase 2/5.

**Constraint:** No new code needed beyond the P0 prompt fix — existing runtime, supervisor, and GLM adapter already work (once P0 loop fix lands).

### P2 — Do NOT build now

| Don't build | Reason |
|---|---|
| Curated source registry / ingestion pipeline | YAGNI until GLM-at-50-calls experiment proves live-search insufficient |
| Phase 2 architecture comparison | Wrong ordering: must characterize model/budget variable first |
| Phase 4 provider reality check | Brave alone was sufficient for GLM at 2nd-call capture; no evidence provider diversity is bottleneck |
| Phase 5 corpus/ingestion architecture | Maintenance burden unknown; convergence unmeasured at adequate budget |
| Provider router / 6-provider mesh | Model choice dominates provider count per bakeoff evidence |
| Firecrawl paid fallback | Operator budget unset; Brave+Jina sufficient for 2nd-call capture |
| Embeddings/vector retrieval | FTS+JSON index already enables single-call discovery |
| Broader continuous ResearchBrain loop beyond bounded canaries | Fix convergence first, then scale |
| CloakBrowser / `browse_web_page` capture tool | Tensions with finalization memo do-not-build list (`:238-247`); defer until reliability proven |
| Instagram/TikTok scraping | Walled gardens, anti-scraping, ToS risk; trading content there is overwhelmingly influencers selling courses, not genuine edges |

---

## 5. Mental model: free-roaming research + deterministic output cage

This is the doctrine that governs all ResearchBrain work. Future agents must understand this before touching ResearchBrain code.

### The vision

ResearchBrain is a **free-roaming creative researcher** that discovers NOVEL trading edges from external sources. It scouts diverse media — Reddit, YouTube, arxiv, MQL5 forums, broker docs, GitHub, quant blogs, X — reads thoroughly, watches videos, synthesizes creatively, and generates ideas that are **grounded in external sources, NOT in LLM training data.**

The deterministic part comes at the **END** — converting ideas to testable hypotheses with hash-backed provenance, schema validation, and no-fake-claims enforcement.

### The trader mentality (core doctrine)

ResearchBrain thinks like a **trader seeking alpha**, not like an academic seeking consensus. A trader finds one good idea and tests it. The idea may have only one source — a single Reddit thread, one blog post, one YouTube video — and that is **enough to test**. Sometimes the best alpha is in a field where nobody else has written about it, or where the idea appears differently across sources and nobody has connected the dots.

**Do NOT force the LLM to find multiple sources before recording a hypothesis.** A single source is valid if the idea looks worth trying. The LLM should be encouraged to look for corroborating or disconfirming evidence, but the absence of additional sources does NOT block hypothesis recording. The rationale: sometimes there is alpha in a field where there is a single thread, idea, or source talking about it. Forcing multiple sources would rule out exactly the kind of contrarian, under-explored edges that are the most promising.

The prompt should reflect this, something like: *"When roaming and researching, it is possible to create a hypothesis from only one source. It is logical to search for more ideas, sources, and data on the speculated hypothesis, but it is not mandatory. The rationale: sometimes there is alpha in a field where there is a single thread, idea, or source talking about it."*

### The research journal (Karpathy-style Obsidian wiki — audit/hunch layer, NOT cognitive engine)

The LLM needs a place to **record free-form thoughts as it researches** — not just structured hypotheses at the end, but observations, hunches, and half-formed ideas along the way. Example: *"I saw an interesting idea on r/algotrading about session-based order flow imbalance. I found only one source that supports it, but it looks worth trying."*

This is implemented as a **Karpathy-style LLM-maintained wiki** in an Obsidian vault. The LLM writes markdown files with `[[wikilinks]]`, YAML frontmatter, and provenance tags. Obsidian's graph view, backlinks, and search let the operator browse what the LLM was thinking. Future runs can search prior notes and build on them.

**Reframing (from §9.2 four-lane validation):** The wiki is an **audit log + hunch buffer**, NOT the LLM's cognitive engine. Zero production research agents (OpenAI Deep Research, Anthropic, Salesforce EDR, EurekAgent) use a persistent wiki as working memory — they synthesize in-context per session. The wiki's value is: (a) human browsability, (b) hunches that don't fit structured memory, (c) cross-run observations. The LLM could do ~70% of what the wiki enables with just `search_research_memory` + structured artifacts. The wiki's marginal value is the 30% that's free-form. **Do NOT spend tool-call budget on wiki maintenance** (no "touch 10-15 pages per ingest" — that's the community pattern, not what production agents do). The LLM writes hunches/sources/hypotheses as it goes, reads `_index.md` for context, but does NOT compile a knowledge graph.

**Based on:** [Karpathy's LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) + patterns from [ar9av/obsidian-wiki](https://github.com/ar9av/obsidian-wiki). The operator already has Obsidian installed. The vault lives on the Windows filesystem; the LLM writes from WSL via `/mnt/c/...`. Zero dependencies — just `fs.writeFileSync()`. See Step 3 for the full vault structure, page format, tools, and integration design.

**Current gap:** The agent has `search_research_memory`, `check_duplicate_memory`, `check_failed_pattern_similarity` — all READ tools. There is no WRITE tool for free-form notes. The only write tools are `record_hypothesis` and `record_rejection` (both structured). Step 3 adds `write_wiki_page` and `search_wiki` tools (2 tools, not 4 — `write_hunch` folded into `write_wiki_page`, `wiki_status` cut as YAGNI).

### The two phases

| Phase | Behavior | Cage |
|---|---|---|
| **Research (INPUT)** | Free, creative, multi-modal, backtracking, single-source-okay | Minimal — only cost/budget bounds |
| **Validation (OUTPUT)** | Deterministic, bounded, schema-validated, hash-backed, no-fake-claims | Full cage — this is where the deterministic code owns truth |

### The confirmation-bias failure mode (must not recur)

The GLM "success" run (2026-06-24) was confirmation bias, not research. The agent started with "order flow imbalance" from its training data, then searched specifically to find a supporting source. It never scouted arxiv, reddit, broker docs, or diverse sources. The hypothesis was built on LLM training data — the OPPOSITE of what ResearchBrain is for.

**Root cause:** `buildSystemPrompt()` (`researchbrain-llm-providers.mjs:38-51`) said "discovery agent" but never enforced discovery-first behavior. The agent was free to generate a hypothesis from training data and search to confirm it.

**Fix:** The prompt must mandate: **scout external sources FIRST** → read and synthesize → form hypothesis FROM sources (not from training data) → validate. The agent must capture at least one external source before recording a hypothesis. But the agent is NOT required to find multiple sources or multiple source families — one good source is enough if the idea looks worth testing. The cage is: "the idea must come from an external source, not from training data." The cage is NOT: "the idea must be backed by multiple sources."

### Where the cage is correctly placed (do not remove)

- Hash-backed source provenance prevents hallucinated citations
- `researchrun_id` enforcement prevents output-collision bugs
- Profitability-key rejection prevents "found a winning strategy" claims
- Memory duplicate/failed-pattern checks prevent re-inventing losing ideas
- Transcript chunk-ID enforcement prevents "I watched the video" citation fraud
- Schema validation prevents garbage hypotheses
- At least one source capture required before `record_hypothesis` (prevents training-data-only hypotheses)

### Where the cage currently fails or suffocates (fixable without architecture changes)

- System prompt still risks checklist scouting → rewrite for source-following discovery, not adapter coverage; critic must happen **before** `record_hypothesis`, not after.
- Agent loop now allows all tools too long → add hard synthesis-phase tool gating at budget thresholds, while preserving early free-roam.
- `record_hypothesis` is too high-friction → reduce required fields or auto-run/store memory prerequisites without weakening failed-pattern blocking.
- Adapter errors/rate limits can look like empty searches → surface structured errors and enforce adapter-aware rate limits.
- Wiki tools are broken/overweight for live convergence → remove from active loop or fix fully; prefer post-hoc wiki rendering from structured artifacts.
- YouTube ingest remains fixture/limited until a real transcription path exists; keep video title/metadata from supporting hypotheses.

---

## 6. Implementation plan: discovery-first finalization

**Historical section. Superseded where it conflicts with §0 and active spec §11.16G.** Steps 0-14B below record what was planned and implemented through 2026-07-03. Do not execute this section blindly. The current lean implementation path is §0 above / spec §11.16G.

This is the concrete path to a finalized ResearchBrain. Simple, documented, ordered. Steps 0-3 are the core fixes from the four-lane validation (§9). Steps 4-14 are adapter wiring + reliability + canary.

### Step 0: Fix agent loop gate (from §9.3 fix #1)

**File:** `src/core/researchbrain-agent.mjs:307-310`

**Problem:** The `allowedForTurn` logic narrows to ONLY `record_hypothesis` after memory+source checks pass. This means the LLM cannot search for disconfirming evidence before recording — it's forced to record immediately. The proposed discovery-first prompt (Phase 4: validate) requires the LLM to search for disconfirming evidence BEFORE recording, but the code gate prevents this.

**Change:** Instead of narrowing `allowedForTurn` to only `record_hypothesis`, allow ALL tools AND additionally unlock `record_hypothesis`. The LLM should be free to search for disconfirming evidence after forming a tentative hypothesis, before recording it.

```js
// BEFORE (current — narrows to only record_hypothesis):
const allowedForTurn = memoryComplete && toolRuntime.state.sourceCaptures.length > 0
  ? adapterAwareTools.filter((toolName) => toolName === "record_hypothesis")
  : adapterAwareTools;

// AFTER (fixed — allow all tools + unlock record_hypothesis):
const allowedForTurn = memoryComplete && toolRuntime.state.sourceCaptures.length > 0
  ? adapterAwareTools  // all tools still available
  : adapterAwareTools.filter((toolName) => toolName !== "record_hypothesis");  // gate record_hypothesis only
```

**Effort:** ~1 hour (code fix + test).

### Step 1: Rewrite system prompt (discovery-first, trader mentality, pre-record critic)

**File:** `src/core/researchbrain-llm-providers.mjs:38-51` `buildSystemPrompt()`

**Change:** Replace the compliance-style prompt with a discovery-first mandate that reflects the trader mentality:
1. **Scout broadly** — search across diverse source classes (Reddit, YouTube, arxiv, MQL5 forums, broker docs, GitHub, quant blogs) with broad queries. Do NOT start with a specific hypothesis from training data.
2. **Read and synthesize** — capture and read sources. Let sources suggest patterns. Record observations in the research journal as you go.
3. **Form hypothesis FROM sources** — after capturing at least one external source. A single source is sufficient if the idea looks worth testing. Do NOT require multiple sources or multiple source families — sometimes alpha is in a field where only one source talks about it.
4. **Validate** — check duplicates, failed patterns, disconfirming evidence. Then record.
5. **Critic (pre-record self-review — corrected 2026-07-05)** — before recording a hypothesis, re-read the captured source claims and limitations. Search/inspect existing captures for evidence that disconfirms it. If the idea is weak, call `record_rejection`; otherwise call `record_hypothesis`. Post-record self-review is invalid unless the loop stops exiting immediately after successful `record_hypothesis`.

**Key phrasing:** The prompt must explicitly state that creating a hypothesis from only one source is valid. It should encourage searching for more evidence but not mandate it. The only hard rule is: the idea must come from an external source, not from LLM training data.

**Effort:** ~2-3 hours (prompt rewrite + tests).

### Step 2: Bump turn budget

**Files (4 — from §9.3 fix #7):**
- `src/core/researchbrain-agent.mjs:227-228` (canonical defaults)
- `scripts/researchbrain-stage0-provider-utils.mjs:164-165`
- `src/core/researchbrain-stage0-supervisor.mjs:182,184`
- `scripts/run-researchbrain-stage0-runtime.mjs:194-195`

**Change:** Default `maxLlmCalls` 4 → 12. Default `maxToolCalls` 20 → 50 (NOT 30→50 — the 30 was a canary CLI override, not the code default; code default is 20 per Lane B verification). Keep cost cap.

**Effort:** ~1 hour (constant changes in 5 files + tests).

### Step 3: Obsidian research wiki (Karpathy-style LLM-maintained knowledge graph)

This is the research journal / second brain. Based on the [Karpathy LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), with patterns adopted from [ar9av/obsidian-wiki](https://github.com/ar9av/obsidian-wiki), [green-dalii/obsidian-llm-wiki](https://github.com/green-dalii/obsidian-llm-wiki), and [kytmanov/obsidian-llm-wiki-local](https://github.com/kytmanov/obsidian-llm-wiki-local). We implement as Node.js tools, not as a plugin or skills framework, since ResearchBrain is a custom loop.

**Why Obsidian:** The operator already has Obsidian installed. Obsidian vaults are just directories of markdown files on disk. The LLM writes markdown via `fs.writeFileSync()`; Obsidian's filesystem watcher picks up changes in seconds. Zero dependencies, zero plugins, zero running services. The operator browses the graph, backlinks, and search in Obsidian; the LLM writes and reads files from Node.js.

#### Sustainability analysis

The wiki will NOT bloat to 1GB. At ~3 runs/day for 3 years (~3,285 runs): vault is ~20-100MB. The real sustainability risk is not disk space — it's context-window overhead. The solution is tiered retrieval (see `search_wiki` below): the tool NEVER returns the full index to the LLM. It always filters server-side by keyword/tag, returning summaries only by default.

| Runs | Sources | Hypotheses | Hunches | Concepts | Total pages | Vault size |
|------|---------|------------|---------|----------|-------------|------------|
| 10 | 10-50 | 0-20 | 5-50 | 5-15 | 20-135 | 0.1-1 MB |
| 100 | 100-500 | 10-80 | 50-300 | 15-40 | 175-920 | 1-5 MB |
| 1,000 | 1,000-5,000 | 50-300 | 300-2,000 | 30-80 | 1,380-7,380 | 10-50 MB |
| 3,000 (3yr) | 3,000-15,000 | 100-500 | 500-3,000 | 50-120 | 3,650-18,620 | 20-100 MB |

No compaction, archival, or rotation needed for v1. `_log.md` at 10K entries = ~1MB. `_index.md` at 10K entries = ~1.2MB. Both negligible.

#### Vault location

The vault lives on the **Windows filesystem** (not WSL filesystem) to avoid Obsidian's `EISDIR` watch errors. The LLM writes from WSL via the `/mnt/c/...` path.

```
Vault path (Windows):  C:\Users\הלל\Documents\research-wiki\
Vault path (WSL):     /mnt/c/Users/הלל/Documents/research-wiki/
```

Configured via env var `RESEARCH_WIKI_VAULT_PATH` (name only, no value in repo). The operator creates the vault directory and opens it in Obsidian once. After that, all writes are automatic.

#### Vault structure (refined — 4 content dirs + 3 meta files + _raw/)

```
research-wiki/                        ← Opened in Obsidian on Windows
│
├── AGENTS.md                         ← Schema file (LLM reads at session start)
├── _index.md                         ← Master catalog (1 line per page: type, title, summary, tags, path)
├── _log.md                           ← Append-only changelog (ISO timestamp + what changed + why)
│
├── _raw/                             ← Staging for rough captures (URL dumps, raw notes, transcripts)
│   └── 2026-06-29-reddit-thread-rough.md
│
├── sources/                          ← One summary per captured source (auto-written by capture_url_source)
│   ├── 2026-06-29-reddit-order-flow.md
│   └── 2026-06-29-arxiv-liquidity.md
│
├── hypotheses/                       ← One page per hypothesis (auto-written by record_hypothesis)
│   └── bid-ask-bounce-eur-usd.md
│
├── hunches/                          ← Free-form thoughts, half-formed ideas (THE KEY GAP)
│   ├── 2026-06-29-unsorted-thoughts.md
│   └── 2026-06-29-single-source-idea.md
│
└── concepts/                         ← Trading concepts, instruments, brokers, people — unified
    ├── order-flow-imbalance.md
    ├── regime-detection.md
    ├── binance.md
    ├── ftmo-rules.md
    └── eur-usd.md
```

**What was cut from the original design (and why):**
- `entities/` — merged into `concepts/` (a broker IS a concept; classify via frontmatter tags, not directories)
- `sessions/` — cut; `_log.md` serves as the session timeline
- `failed-patterns/` — cut; structured memory (`lessons.jsonl`, `quarantine/`) is the source of truth
- `_insights.md` — cut; YAGNI (LLM can compute insights from index when curious)
- `.manifest.json` — cut; YAGNI for v1 (LLM discovers existing pages via `search_wiki`)
- `_meta/taxonomy.md` — cut; freeform tags for v1 (add controlled vocab in v2 if tag drift becomes a problem)

#### Page format

Every page is markdown with YAML frontmatter:

```markdown
---
type: concept|source|hypothesis|hunch
tags: [market-microstructure, order-flow, crypto]
summary: "1-sentence summary for tiered retrieval (index displays this)"
run_id: "RUN-20260628..."
updated: 2026-06-29
---

# Order Flow Imbalance

[[Order flow imbalance]] measures the difference between buy-side
and sell-side order flow at the microstructure level.

Key claim from source.

This suggests a potential edge in session-open timing.

> [!contradiction] Source X claims OFI is mean-reverting; Source Y claims trending.
```

**Frontmatter: 5 fields only** (type, tags, summary, run_id, updated). No `source_records` or `hypothesis_packets` path refs — use `[[wikilinks]]` in the body instead.

**Provenance tags** (`^[extracted]`, `^[inferred]`, `^[ambiguous]`): optional convention mentioned in AGENTS.md. NOT enforced by tool validation. The LLM can use them if helpful, but they're not required.

**Contradiction flagging:** When `write_wiki_page` merges new content into an existing page and detects conflicting claims, it prepends a `> [!contradiction]` callout. No state machine — just a callout.

#### Tools (2 tools — refined from 3, cut `write_hunch` per §9.3 fix #3)

**1. `write_wiki_page`** — create or update any wiki page (including hunches).

```
Args:
  path        — e.g., "concepts/order-flow-imbalance.md" (relative to vault root)
               for hunches: "hunches/YYYY-MM-DD-slug.md"
  type        — "concept" | "source" | "hypothesis" | "hunch"
  content     — markdown body (no frontmatter — tool auto-generates it)
  tags        — ["market-microstructure", "order-flow"]
  summary     — 1-sentence summary for index

Behavior:
  1. Validate: path must be in an allowed directory, content must not be empty
  2. Auto-generate YAML frontmatter: type, tags, summary, run_id, updated
  3. If page exists: READ existing content, APPEND new content with "## Update YYYY-MM-DD" heading
  4. If page exists and contradiction detected: prepend "> [!contradiction] ..." callout
  5. Write file via temp-file + fs.renameSync() (atomic on 9P/NTFS — §9.3 fix #4)
  6. Update _index.md via temp-file + rename (same atomic pattern)
  7. Append _log.md (append-only, no read-modify-write)
```

**2. `search_wiki`** — tiered retrieval. **This is the context-window safety mechanism.**

```
Args:
  query       — keyword or tag (empty string = match all)
  type        — optional filter: "concept" | "source" | "hypothesis" | "hunch"
  limit       — max results (default 10, max 50)
  include_bodies — boolean (default false)

Behavior:
  1. Read _index.md
  2. Filter entries by type (if provided) and query (keyword match in title + summary + tags)
  3. Sort by relevance (exact title match > tag match > summary match)
  4. Slice to limit
  5. If include_bodies: read each matched page, return full content
  6. Return array of { path, type, title, summary, tags, updated, content? }

  NEVER return the full _index.md to the LLM.
  NEVER read page bodies without include_bodies: true.
```

**Context-window cost per search:** ~150 tokens (5 matches, summaries only) to ~10K tokens (8 matches with bodies). Never 150K tokens.

**What was cut:** `write_hunch` tool (folded into `write_wiki_page` with `type: hunch`), `wiki_status` tool (LLM approximates from index).

#### Auto-write integration

When existing ResearchBrain tools run, they auto-write wiki pages. **All auto-writes must be `try/catch` wrapped** (§9.3 fix #5) — a wiki write failure must never break the structured artifact write:

```js
// In capture_url_source handler (researchbrain-tools.mjs:570):
try { wiki.writeSourcePage(root, runRepoDir, sourceCapture); } catch (err) { logWarning(err); }
// Primary artifact path continues regardless

// In record_hypothesis handler (researchbrain-tools.mjs:738):
try { wiki.writeHypothesisPage(root, runRepoDir, hypothesis); } catch (err) { logWarning(err); }
```

| Existing tool | Auto-writes to wiki | |
|---|---|---|
| `capture_url_source` | `sources/YYYY-MM-DD-source-type-slug.md` | ✅ Keep — source summary in prose |
| `record_hypothesis` | `hypotheses/hypothesis-slug.md` | ✅ Keep — hypothesis in prose |
| `record_rejection` | — | **CUT.** Structured memory (`lessons.jsonl`, `quarantine/`) handles this. LLM can manually write a hunch if it wants to reflect on a failure. |

#### No drafts, no state DB

**No draft → review → publish workflow.** Every `write_wiki_page` call writes immediately to the final directory. The LLM is the sole writer; there is no human approval gate. `_raw/` serves as staging for rough captures, not as a draft review queue.

**No SQLite state DB for the wiki.** Markdown-only for v1. The LLM discovers what's been processed by calling `search_wiki`. We already have `factory/runtime/factory.sqlite` for the runtime ledger — a second DB on the Windows filesystem adds complexity without benefit. Revisit at 10K+ pages if `search_wiki` grep becomes slow (unlikely).

#### Relationship to existing memory systems

The wiki is a **human-facing synthesis layer**, NOT a replacement for structured stores:

| Store | Format | Consumer | Relationship to wiki |
|---|---|---|---|
| `factory/memory/lessons.jsonl` | JSONL | Agents (structured) | Source of truth for structured lessons. Wiki is NOT a mirror. |
| `factory/research/retrieval_index.json` | JSON | Agents (search) | Indexes structured artifacts. Wiki is NOT indexed here. |
| `factory/memory/quarantine/` | JSON | Agents (blocked patterns) | Structured blocked patterns. Wiki does NOT replicate. |
| **Obsidian wiki** | **Markdown** | **Human + LLM (prose)** | **Synthesis layer.** Prose, connections, intuition. No backfeed into structured memory. |

**The wiki does NOT backfeed into the retrieval index.** Different schemas, different consumers, different update cadences.

#### AGENTS.md schema file

Lives at the vault root. ResearchBrain reads it at session start to learn the wiki rules. Created on first run if missing.

```markdown
# ResearchBrain Wiki Schema

You maintain a Karpathy-style LLM wiki in this vault.

## Directory structure
- concepts/ — trading concepts, instruments, brokers, people (unified)
- sources/ — one summary per ingested source, linked to source-record
- hypotheses/ — one page per hypothesis packet
- hunches/ — free-form thoughts, timestamped
- _raw/ — staging for rough captures
- _index.md — master catalog (update on every write)
- _log.md — append-only changelog

## Write rules
1. Every page MUST have YAML frontmatter with type, tags, summary, updated
2. Use [[wikilinks]] for ALL cross-references
3. When updating a page, READ the existing page first, then append with "## Update YYYY-MM-DD"
4. If new info contradicts a page, flag with > [!contradiction] — do NOT silently overwrite
5. Append to _log.md on every write: date, what changed, why
6. Update _index.md when adding a new page
7. Hunches are okay with only one source — do not require corroboration
8. Extract 3-5 key concepts per source, not 50 — control bloat
```

#### Operator co-use

The operator can install [ar9av/obsidian-wiki](https://github.com/ar9av/obsidian-wiki) or [green-dalii/obsidian-llm-wiki](https://github.com/green-dalii/obsidian-llm-wiki) separately for personal use with OpenCode/Claude Code on the **same vault**. Both coexist because both just read/write markdown files. The operator gets the full skills framework for manual use, while ResearchBrain writes via its own Node.js tools. No conflict.

#### Implementation

**Files:**
- `src/core/researchbrain-wiki.mjs` (new module, ~225 lines) — vault path resolution, page read/write/merge with frontmatter generation, index/log maintenance, tiered search with server-side grep. **Must NOT copy path/hash helpers** (§9.3 fix #6) — 11+ duplicates already exist. Use raw `fs` + `crypto` directly. Adopt `writeTextAtomic`'s tmp+rename pattern but not the `assertContainedPath` guard (vault is outside repo).
- `src/core/researchbrain-tools.mjs` (add 2 tools to catalog + handlers + tool parameter schemas in `researchbrain-llm-providers.mjs`)
- `research-wiki/AGENTS.md` (schema file at vault root — created on first run if missing)

**Env:** `RESEARCH_WIKI_VAULT_PATH` (name only). Defaults to `/mnt/c/Users/הלל/Documents/research-wiki/` if unset.

**Effort:** ~5-6 hours (wiki module + 2 tools + auto-write hooks + AGENTS.md + tests). Reduced from 8 hours by cutting `write_hunch` and not copying helpers.

**Dependencies:** Zero new npm packages. Node.js `fs` + `crypto` only.

**v2 triggers (deferred):**
- 10K+ pages → consider `.manifest.json` delta tracking
- 50K+ pages → consider SQLite mirror
- Tag drift → add `_meta/taxonomy.md` controlled vocabulary
- Operator wants analytics → add SQLite for queries

### Step 4: Wire arxiv adapter

**File:** `src/core/researchbrain-tools.mjs` (new adapter in `createBraveResearchBrainSourceToolAdapter` pattern)

**Change:** Add `createArxivResearchBrainSourceToolAdapter` implementing `search()` via arxiv API (free, no auth, 1 req/3sec) and `captureUrl()` for arxiv PDFs/abstracts. Wire to `search_arxiv` tool.

**Effort:** ~2-3 hours. arxiv API is REST, returns Atom XML, Python `arxiv` package exists.

### Step 5: Wire Reddit adapter (HIGH PRIORITY)

**File:** `src/core/researchbrain-tools.mjs` (new adapter)

**Change:** Add `createRedditResearchBrainSourceToolAdapter` implementing `search()` via Reddit API (OAuth via PRAW or direct, free tier 100 QPM) and `captureUrl()` for posts/comments. Wire to a new `search_reddit` tool (add to catalog).

**Why Reddit is critical:** Reddit has tons of quant communities — r/algotrading, r/quant, r/quantfinance, r/algotrading2, plus solo traders and teams writing spontaneous answers that embody hard-won knowledge and interesting ideas. These ideas may translate badly into MT5 code (no guarantee of success or good backtest), but the importance of Reddit as a source of creative, practitioner-grounded alpha ideas is very high. Reddit is where real traders share real experiences — not academic theory.

**Effort:** ~4-6 hours. Reddit API free tier: 100 QPM. OAuth app registration required.

**Env:** `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` (names only, no values in repo).

### Step 6: Wire MQL5 forum + broker docs + quant blogs adapters

**File:** `src/core/researchbrain-tools.mjs` (new adapters)

**Change:** Wire the existing `search_mql5_sources` and `search_broker_docs` tools (currently stubs) to real adapters:
1. **MQL5 forum** (`search_mql5_sources`) — search `https://www.mql5.com/en/forum` via site-scoped search or the MQL5 forum search API. This is where MT5 practitioners share code, strategies, and edge cases. Critical for MT5-specific alpha.
2. **Broker docs** (`search_broker_docs`) — search FTMO docs, MetaQuotes docs, and other broker documentation. Site-scoped search via Brave or direct fetch.
3. **Quant blogs** — add a new `search_quant_blogs` tool targeting curated quant blogs (QuantConnect, Quantpedia, RobotFX, BabyPips, etc.). These are practitioner blogs with strategy ideas and backtests.

**Why dedicated adapters (not just web search):** MQL5 forum has specific search functionality and structure. Broker docs are authoritative for MT5/FTMO rules. Quant blogs are curated sources with higher signal-to-noise than generic web search. Dedicated adapters enable targeted scouting of practitioner knowledge.

**Effort:** ~4-6 hours total (3 adapters, each ~1.5-2 hours).

### Step 7: Wire GitHub adapter

**File:** `src/core/researchbrain-tools.mjs` (new adapter)

**Change:** Add `createGithubResearchBrainSourceToolAdapter` implementing `search()` via GitHub Code Search API and `captureUrl()` for repo files. Wire to `search_github_code` + `capture_github_artifact` tools.

**Effort:** ~3-4 hours. GitHub API free tier: 10 req/min unauthenticated, 30/min with token.

**Env:** `GITHUB_TOKEN` (optional, for higher rate limits).

### Step 8: Wire YouTube transcription via Gemini API (not NotebookLM)

**File:** `src/core/researchbrain-youtube-ingest.mjs`

**Change:** Replace fixture-only ingest with real transcription via Gemini API:
1. YouTube Data API for metadata/search (free, 10K units/day) — `YOUTUBE_API_KEY`
2. Gemini API for full video transcription (pass YouTube URL directly, processes raw audio, works without captions, ~$0.04/video, free tier 8hrs/day) — `GEMINI_API_KEY`
3. Fallback: `yt-dlp` for subtitle extraction when available (free)
4. Fail closed with `transcript_unavailable` if all fail

Wire `search_youtube` to YouTube Data API search. Wire `inspect_youtube_video` to the real `youtubeIngest()` using Gemini.

**Why Gemini, not NotebookLM:** NotebookLM has NO official API. All MCP servers are reverse-engineered, cookie-based, fragile, and break when Google changes internal RPCs. Critically, NotebookLM does NOT transcribe videos — it only pulls existing YouTube captions (fails for videos without captions, no timestamps, no speaker diarization). Gemini API is official, documented, processes raw audio, works without captions, and costs ~$0.006 per 10-min video. The user's Google Plus plan gives Gemini API access.

**Effort:** ~6-8 hours. The structure already exists (`youtubeIngest()` function, chunk schema, provenance fields) — just needs Gemini adapter instead of fixtures.

**Env:** `YOUTUBE_API_KEY` (Data API search/metadata), `GEMINI_API_KEY` (video transcription).

**NotebookLM assessment (2026-06-25):** NOT viable for production agent loop. Reverse-engineered only, no official API, cookie auth expires, Google breaks it regularly. Useful only for manual one-off research sessions via web UI (grounded Q&A over 50-100 PDFs). Do not build agent loop dependencies on NotebookLM MCP.

### Step 9: Wire Semantic Scholar adapter

**File:** `src/core/researchbrain-tools.mjs` (new adapter)

**Change:** Add `createSemanticScholarResearchBrainSourceToolAdapter` implementing `search()` via Semantic Scholar API (free, 100 req/5min without key, 1 req/sec with key). Wire to `search_semantic_scholar` tool.

**Effort:** ~2-3 hours. REST API, clean JSON, Python `semanticscholar` package exists.

### Step 10: Agent Reach integration (optional, multi-platform)

**File:** `src/core/researchbrain-tools.mjs` (new subprocess adapter)

**Change:** Add `createAgentReachResearchBrainSourceToolAdapter` that shells out to `agent-reach fetch <url>` for platforms not covered by native adapters (X/Twitter, XiaoHongShu, Bilibili, WeChat articles). Agent Reach is a Python CLI (`Panniantong/Agent-Reach`, 39K stars, v1.4.0 2026-06-24) wrapping 13 platforms.

**Effort:** ~2-4 hours. `pip install agent-reach`, subprocess call, parse output.

**Decision:** Defer until Steps 4-9 are wired and tested. Agent Reach adds X/Twitter + Chinese platforms but requires cookie auth for some.

### Step 11: X/Twitter decision (operator decision required)

**Status:** DEFERRED pending operator decision.

X API is expensive ($100+/mo for Basic, $5K/mo for Pro) or fragile (Nitter self-hosted, twikit/twscrape scraping that breaks every few weeks). Third-party APIs ($49-100/mo) are the pragmatic middle ground.

**Operator question:** Is tracking specific traders on X worth $49-100/mo? If yes, use a third-party API (GetXAPI, TwitterAPI.io) or Agent Reach with cookie auth. If no, skip X and rely on Reddit + YouTube + arxiv + MQL5 + broker docs.

**Document the decision in this file when made.**

### Step 12: Fix live loop reliability

**Files:** `src/core/researchbrain-stage0-supervisor.mjs`, `researchbrain-loop-runner.mjs`, `researchbrain-stage0-provider-utils.mjs`

**Change:** Debug why supervisor loop runs block with `no_valid_provider_output` when standalone runtime succeeds. Likely: provider factory construction in loop context, tool-call budget policy, or live-provider opt-in flags not propagating.

**Effort:** ~4-8 hours (bounded debug task).

### Step 13: Reconcile terminal failure + clean stale jobs

**Files:** `src/core/researchbrain-stage0-readiness.mjs`, runtime ledger.

**Change:** Investigate `EVT-RB-STAGE0-696032161d91906723e71ce8ab3f718a` projection SHA mismatch. Reconcile or quarantine 15 stale blocked jobs.

**Effort:** ~2-4 hours.

### Step 14: Run GLM 50-tool-call convergence canary

**Action:** After Steps 1-3 + 12-13, run GLM 5.2 (xhigh), 50 tool calls, 8192 tokens on the 3 narrow MT5 Stage-0 requests. Measure: hypothesis rate, source-discovered vs training-data-confirmed, time-to-first-capture, research journal usage.

**Decision gate:**
- GLM produces 1+ source-discovered hypothesis across ≥2/3 requests at <$0.01/run → live-search is sufficient; curated corpus is enrichment.
- GLM produces <33% hypothesis rate → curated corpus is hard dependency; accelerate Phase 2/5.

**Cost:** ~$0.50.

---

## 7. Completed (from 2026-06-24/25 cleanup + 2026-06-30 implementation)

### 2026-06-24/25 cleanup
- Spec drift fixed: Phase 8 header `[x]`, preamble, 7 "remain not started" sentences corrected in `factory/mt5-ftmo-strategy-factory-spec.md`.
- Prompt/policy conflict fixed: `prediction_markets`/`polymarket_public` removed from `src/prompts/planner.md:28,42` and `src/prompts/ideator.md:24`.
- Codebase cleanup: ~600+ files / ~140MB deleted (legacy `wfa/`, `workspace/`, stale runs, orphaned strategies/scripts/MT5 workers, simulate mode retired, test suite cleaned).
- 501/501 tests pass; `rtk npm run validate` passes.
- 3 independent audit lanes confirmed: no broken imports, no orphaned exports (2 pre-flagged test-only), all critical files exist, structure clean.

### 2026-06-30 implementation (Steps 0-11 from §6)
- **Step 0:** Agent loop gate fixed (`researchbrain-agent.mjs:307-310`) — all tools always available; `record_hypothesis` tool handler validation is the real gate.
- **Step 1:** System prompt rewritten with discovery-first 5-phase mandate (scout→read→synthesize→validate→critic) + trader mentality (single source is okay).
- **Step 2:** Budget defaults bumped: `maxLlmCalls` 4→12, `maxToolCalls` 20→50 in 5 files (agent, provider-utils, supervisor, runtime CLI).
- **Step 3:** Wiki module built (`src/core/researchbrain-wiki.mjs`, ~200 lines) — 2 tools (`write_wiki_page`, `search_wiki`), atomic writes (temp+rename), tiered retrieval, zero deps, no duplicate helpers. `write_hunch` cut (folded into `write_wiki_page`). Auto-write hooks added to `capture_url_source` and `record_hypothesis` (try/catch wrapped).
- **Steps 4-9:** Source adapters wired: arxiv (free API), Reddit (OAuth, free 100 QPM), GitHub (free API), Semantic Scholar (free API), MQL5 (site-scoped Brave), broker docs (site-scoped Brave). Composite adapter pattern (`createCompositeResearchBrainSourceToolAdapter`) dispatches to multiple sub-adapters. CLI supports comma-separated providers: `--source-provider brave,arxiv,reddit,github,semantic_scholar,mql5,broker_docs`.
- **Step 10 (YouTube/Gemini):** Deferred — requires Gemini API key and restructuring `researchbrain-youtube-ingest.mjs`. Will implement when operator provides `GEMINI_API_KEY`.
- **Steps 12-14 (loop reliability, terminal failure, canary):** Not yet started — these require live API keys and operator-authorized live runs.
- 501/501 tests pass; `rtk npm run validate` passes.

---

## 8. Evidence index

| Claim | Source |
|---|---|
| Phase 8A–8D closed, 8E blocked | `factory/mt5-ftmo-strategy-factory-spec.md:3396,3467,3565,3726,3835` |
| Hybrid direction is spec §11.16E | `factory/mt5-ftmo-strategy-factory-spec.md:2607-2628` |
| Discovery-first doctrine is spec §11.16F | `factory/mt5-ftmo-strategy-factory-spec.md:2630-2650` |
| Model dominates architecture | `researchbrain-architecture-research-program-2026-06-23.md:380-423` |
| GLM success run (confirmation bias) | `factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-20260624190036/` |
| Kimi blocked run | `factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-20260624190347/` |
| DeepSeek success run | `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/` |
| DeepSeek blocked run | `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/` |
| 15/17 jobs blocked | `rtk npm run researchbrain:stage0-diagnostics` 2026-06-24 |
| Unreconciled terminal failure | `rtk npm run researchbrain:stage0-readiness` 2026-06-24; `EVT-RB-STAGE0-696032161d91906723e71ce8ab3f718a` |
| No committed secrets | Lane F scan; `.gitignore:8-13` |
| Supervisor monolith | `src/core/researchbrain-stage0-supervisor.mjs` (~1855 lines) |
| YouTube ingest untested | `src/core/researchbrain-youtube-ingest.mjs` (251 lines, 0 direct tests) |
| System prompt root cause | `src/core/researchbrain-llm-providers.mjs:38-51` `buildSystemPrompt()` |
| Agent loop gating | `src/core/researchbrain-agent.mjs:303-310` |
| Do-not-build list | `researchbrain-architecture-finalization-2026-06-23.md:238-247` |
| Agent Reach repo | `Panniantong/Agent-Reach` (39K stars, v1.4.0 2026-06-24, 13 platforms) |
| Reddit API | PRAW library, free tier 100 QPM, OAuth required |
| arxiv API | Free, no auth, 1 req/3sec, REST returning Atom XML |
| Semantic Scholar API | Free, 100 req/5min without key, 1 req/sec with key |
| YouTube transcription | yt-dlp (free, 173K stars), youtube-transcript-api, Whisper local, Gemini API ($0.005/min) |

---

## 9. Four-lane validation (2026-06-30)

Four parallel specialist lanes validated the architecture + plan: oracle (architecture deep-dive), explorer (codebase integration reality check), librarian (external production-system validation), oracle (alternative architecture stress-test). All four **converged**: the architecture is sound, no rewrite needed, the binding constraint is adapter coverage (1/10 wired), not loop structure or wiki design.

### 9.1 Convergent verdict

- **Lane A (oracle — architecture validation):** "The plan does NOT need architectural revision. The free-roaming research + deterministic output cage doctrine is correct. Main gaps: sequencing (adapters before wiki), tool-list overflow (remove `write_hunch`), filesystem-safety guard (temp-file+rename for index)."
- **Lane B (explorer — integration reality check):** "NEEDS-MINOR-ADJUSTMENT — the plan fits the actual code structure well. 3 adjustments: wiki module must NOT copy path/hash helpers (11+ duplicates exist), auto-write hook must be `try/catch` wrapped, the 7 fixture-only search tools already accept live adapters through `fixtureSearchResults()` dispatch — no handler changes needed."
- **Lane C (librarian — external validation):** "MODIFY — zero production research agents (OpenAI Deep Research, Anthropic, Salesforce EDR, EurekAgent) use a persistent wiki as working memory. They synthesize in-context per session. The wiki is useful for human review and auditing, not for the LLM's research process. Demote wiki from 'working memory' to 'audit log + hunch buffer.'"
- **Lane D (oracle — stress-test):** "The current plan is optimal. The binding constraint is NOT architecture — it's source-adapter coverage. A single agent with access to 10 source families can roam more creatively than 4 agents with access to 1. Do NOT build: multi-agent orchestration, recursive research, streaming graphs, vector DB."

### 9.2 Key reframing: wiki is audit/hunch layer, not cognitive engine

The wiki does NOT give the LLM more creative power. The LLM's power comes from: (a) search tools, (b) capture tools, (c) budget. The wiki is a **memory augmentation** — it helps the LLM not forget across runs, and gives the operator a browsable view. The LLM could do ~70% of what the wiki enables with just `search_research_memory` + structured artifacts. The wiki's marginal value is the 30% that's free-form: half-formed observations that don't fit structured memory.

**This does NOT mean cut the wiki.** It means: build it as an audit/hunch layer, not as the LLM's cognitive engine. The real power comes from wiring adapters (Reddit, arxiv, MQL5, YouTube).

### 9.3 Seven fixes from reconciliation (before/during implementation)

| # | Fix | Source | File:line | Effort |
|---|---|---|---|---|
| 1 | **Fix agent loop gate** — `allowedForTurn` at `researchbrain-agent.mjs:307-310` narrows to ONLY `record_hypothesis` after memory+source. LLM can't search for disconfirming evidence before recording. Fix: allow ALL tools + unlock `record_hypothesis` (don't narrow). | Lane A | `researchbrain-agent.mjs:307-310` | 1 hr |
| 2 | **Sequence: adapters before/alongside wiki** — prompt says "scout Reddit/arxiv" but no adapters exist. Wire Reddit + arxiv + MQL5 first (or at minimum alongside wiki). | Lanes A, D | plan §6 reordering | reordering |
| 3 | **Cut `write_hunch` tool** — fold into `write_wiki_page` with `type: hunch` + auto-path. 3 tools → 2. | Lane A | plan §6 Step 3 | reduces scope |
| 4 | **Temp-file+rename for `_index.md`** — 9P (WSL→NTFS) write atomicity risk. Use `writeTextAtomic` pattern (tmp+rename), not direct `writeFileSync`. | Lanes A, B | wiki module | 1 hr |
| 5 | **Auto-write hooks must be `try/catch`** — wiki write failure must never break structured artifact write. Wrap in `try { wiki.write(...) } catch (err) { logWarning(err) }`. | Lane B | `researchbrain-tools.mjs:570,738` | trivial |
| 6 | **Wiki module must NOT copy path/hash helpers** — 11+ duplicate copies already exist. Use raw `fs` + `crypto` directly; adopt `writeTextAtomic`'s tmp+rename pattern but not the `assertContainedPath` guard (vault is outside repo). | Lane B | wiki module | reduces scope |
| 7 | **Fix spec/code budget discrepancy** — plan said `maxToolCalls` default 30→50, but code default is 20 (30 was canary override). Bump 20→50. | Lane B | 5 files | doc fix |

### 9.4 Post-hoc critic turn (hybrid addition from Lane D)

After `record_hypothesis`, the SAME agent re-reads its hypothesis with a Critic prompt → if disconfirming evidence is found in its own source captures, it calls `record_rejection` instead. This closes the one structural gap (adversarial self-review) that the current architecture lacks — without multi-agent complexity. ~2-hour prompt change, no new code.

**Implementation:** Add to `buildSystemPrompt()` as Phase 5 (critic): "After recording a hypothesis, re-read it. Search your own source captures for evidence that disconfirms it. If found, call `record_rejection` with the disconfirming evidence. This is mandatory self-review."

### 9.5 What NOT to build (confirmed by all lanes)

- Multi-agent orchestration (4x cost, 4x maintenance, no quality gain for research gathering)
- Recursive/unbounded turns (LLMs don't self-terminate reliably; cost unpredictable)
- Streaming graph executor (massive complexity for sub-second latency savings)
- Vector DB / embeddings (FTS+JSON index already enables single-call discovery)
- SQLite for wiki (markdown-only is robust for v1; revisit at 10K+ pages)
- CloakBrowser / browser automation (ToS risk, maintenance nightmare)

### 9.6 External evidence (Lane C)

| System | Architecture | Persistent wiki? | Turn budget |
|---|---|---|---|
| OpenAI Deep Research | ReAct loop (Plan→Search→Read→Reflect→Iterate→Synthesize) | NO — in-context synthesis | 150-200 reasoning iterations, 30-60 searches |
| Anthropic Research | Orchestrator-worker (3-5 parallel subagents) | NO — checkpoint summaries only | ~15x token multiplier |
| Salesforce EDR | Master Planning Agent → 4 specialized search agents → reflection | NO — in-context | MCP-based tools |
| EurekAgent | "Engineer the environment, not the agent" — bounded cage, free strategy | NO — artifact engineering | <$11 API cost |

**Key finding:** Zero production research agents use a persistent wiki as working memory. All synthesize in-context per session. The wiki's value is human-centered (readability, audit, serendipitous browsing), not LLM-quality-centered.

**Implication for our plan:** Build the wiki as a lightweight audit log + hunch buffer, not as a compiled knowledge graph. The LLM reads `_index.md` for context, writes hunches/sources/hypotheses as it goes, but does NOT spend tool-call budget on wiki maintenance (no "touch 10-15 pages per ingest" — that's the Karpathy community pattern, not what production agents do).

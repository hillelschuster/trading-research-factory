# ResearchBrain architecture finalization memo

**Date:** 2026-06-23  
**Status:** current supporting recommendation; implementation authority remains `factory/mt5-ftmo-strategy-factory-spec.md`

## 1. Purpose

This memo records the current best recommendation for finalizing ResearchBrain after red-teaming the provider-router/provider-rotation direction, reviewing repo seams, checking provider/cost facts, and comparing broader autonomous-research architectures.

This document is deliberately narrower than the main factory spec:

- it captures the current ResearchBrain-specific architecture judgment
- it is allowed to hold unresolved research context
- when a recommendation becomes implementation doctrine, it must also be folded into the active spec

## 2. Current problem statement

The key ResearchBrain failure observed so far was not simply provider rate limits.

The stronger failure was **non-convergence**:

- roughly `28 search_web` calls
- `1` capture
- `0` accepted hypotheses

That means the main problem is not “how do we get more search calls?” The main problem is “how do we force high-quality evidence digestion, contradiction handling, and bounded hypothesis formation before tool budget is wasted?”

## 3. Executive recommendation

Implement ResearchBrain as a **hybrid evidence-first research pipeline**:

```text
curated source registry
→ scheduled / batch ingestion
→ local evidence library
→ source quality scoring
→ contradiction + disconfirmation pass
→ bounded hypothesis generation
→ hypothesis critique
→ Stage-0 packet / backlog handoff
```

Live web search should remain available, but only as a **bounded gap-filling mechanism** behind deterministic quotas and source capture.

### Core principle

ResearchBrain should not primarily be a search API router.

It should primarily be an **evidence digestion and hypothesis formation system**.

## 4. Why the current provider-router synthesis is not enough

The current provider-router/search-API rotation idea is useful as infrastructure, but it is the wrong primary abstraction.

### Why it loses as the core mechanism

1. **It solves the 429 problem, not the convergence problem.** More successful searches can still end with zero hypotheses.
2. **It rewards search volume.** This pushes the system toward discovery churn instead of evidence digestion.
3. **It increases operational surface area.** More providers means more drift, more auth, more rate-limit edge cases, and more debugging.
4. **It encourages free-tier gaming.** That is fragile and usually the wrong long-term optimization target.
5. **It does not create research quality discipline.** Source grading, contradiction tracking, disconfirming evidence, and falsifiability still need separate mechanisms.

### What is still worth keeping from that line of thought

- search and capture should stay separate concerns
- live provider failures should be hidden behind deterministic tool boundaries
- quota awareness is useful
- one small fallback ladder is reasonable
- clean `search_unavailable` handling is useful

## 5. Ranked architecture options

### 1. Hybrid curated corpus + bounded live gap search **(recommended)**

Use a curated evidence base for most reasoning. Only use live search when ResearchBrain explicitly identifies a freshness or coverage gap.

**Why it wins:**

- best source quality control
- best repeatability
- lowest search chaos
- easiest to audit
- manageable monthly cost

### 2. Curated corpus + periodic ingestion only

Very strong for quality and cost, but weaker on freshness and discovery outside the maintained registry.

### 3. Pipeline-first live research with a small paid search stack

Better than provider roulette because it enforces stages, but still too dependent on live search if used as the main substrate.

### 4. Provider-router hidden behind `search_web`

Keep only as infrastructure. Reject as the main ResearchBrain mechanism.

### 5. External research-agent architecture

Useful for separate advisory work, not as the core repo runtime.

### 6. Browser automation / full crawl primary

Too brittle and too operationally heavy for Stage-0 as the default path.

## 6. Recommended mechanism in concrete terms

### 6.1 Primary research substrate

Maintain a curated registry of source families such as:

- official platform docs (`MQL5`, broker docs, exchange docs)
- FTMO / broker tradability references
- academic sources (`arXiv`, papers, SSRN where usable)
- vetted quant blogs and code repositories
- prior factory lessons, Stage-0 packets, and failed-pattern memory

### 6.2 Required deterministic Stage-0 gates

Before a hypothesis is accepted, require:

- at least `3` captured and graded sources
- at least `2` source families
- at least `1` disconfirming or limiting source
- explicit invalidation criteria
- memory / duplicate / failed-pattern checks
- exact captured-source provenance

### 6.3 Live gap search policy

Allow live search only when the agent can state:

- what knowledge gap exists
- why the local corpus is insufficient
- what source family is being sought
- how many queries remain allowed

### 6.4 Small fallback provider stack

Use a **small**, role-specific live stack rather than a large rotation mesh.

Suggested live roles:

- **General search:** Brave
- **Semantic search:** Exa
- **URL capture:** Jina Reader
- **Hard-page capture fallback:** Firecrawl
- **Optional cheap SERP overflow:** Serper or DataForSEO only if later justified

## 7. Repo-specific implementation implications

Relevant current seams:

- `scripts/researchbrain-stage0-provider-utils.mjs`
- `src/core/researchbrain-agent.mjs`
- `src/core/researchbrain-tools.mjs`
- `src/core/researchbrain-runtime.mjs`
- `src/core/researchbrain-llm-providers.mjs`

### Implication A — Convergence controls come first

Before building more provider logic, strengthen:

- tool-call budgeting
- search/capture ratio limits
- forced intermediate synthesis
- hard stop conditions after repeated search-only behavior

### Implication B — Build Stage-0 evidence artifacts

ResearchBrain should emit explicit pre-hypothesis artifacts such as:

- source collection
- evidence grading
- contradiction matrix
- disconfirming sources
- session manifest

### Implication C — Provider work becomes subordinate

Provider routing should support the pipeline, not define it.

The likely order should be:

1. strengthen convergence and evidence gates
2. add curated corpus / ingestion layer
3. add bounded live gap-search policy
4. only then harden provider ladders if still needed

## 8. Minimal viable next build

The next practical implementation should be:

1. cap search behavior and force capture/synthesis
2. add source grading fields and session manifest artifacts
3. add a curated source registry
4. make live search explicitly gap-driven
5. keep the live provider set small

This is the shortest path to better research quality without over-investing in provider infrastructure.

## 9. Stronger long-term build

Longer-term, ResearchBrain should evolve into an evidence foundry:

- scheduled ingestion
- local index / retrieval
- source-family entropy checks
- contradiction graph
- novelty vs prior-failure scoring
- hypothesis critique pass
- explicit cost budget per research cycle

## 10. Monthly cost guidance for 5–10 cycles/day

### Fragile free-tier mode

- roughly `$0–5/month`
- not recommended as the main plan

### Recommended MVP range

- roughly `$10–35/month`
- enough for a modest search/capture budget plus a cheap strong synthesis model

### More reliable quality tier

- roughly `$25–75/month`
- gives room for better capture reliability and paid search overflow when needed

## 11. Open decisions still requiring operator input

1. target monthly budget ceiling
2. preferred Stage-0 synthesis model/provider
3. whether Firecrawl is acceptable as a paid fallback
4. how strict the disconfirming-evidence gate should be
5. whether to start with SQLite/FTS or go directly to embeddings/vector retrieval

## 12. Do-not-build list

Do not build next:

- a 6-provider rotation mesh
- browser automation as the default path
- large free-tier farming logic
- a cloud vector stack before a local pipeline exists
- a LangGraph / CrewAI rewrite
- market-data / WFA / MT5 tools inside ResearchBrain

## 13. Related documents

- Active spec: `factory/mt5-ftmo-strategy-factory-spec.md`
- Deeper research program: `researchbrain-architecture-research-program-2026-06-23.md`
- Historical provider-rotation inputs: `legacy-provider-rotation/`

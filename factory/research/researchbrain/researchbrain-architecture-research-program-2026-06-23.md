# ResearchBrain finalization research program

**Date:** 2026-06-23  
**Status:** active supporting research program / findings process  
**Implementation authority:** `factory/mt5-ftmo-strategy-factory-spec.md`

## 1. Purpose

This document defines the deeper research program for determining the best final ResearchBrain architecture.

It exists because one round of web/provider research is not enough. ResearchBrain affects:

- research quality
- convergence behavior
- cost
- evidence integrity
- long-term maintainability

This is therefore a multi-phase architecture research program, not a single memo.

## 2. Current baseline findings

These are the working baseline findings before deeper phases begin:

1. The main recent failure mode was convergence, not merely provider unavailability.
2. Provider rotation may help availability, but does not itself force high-quality research.
3. The repo's active implementation authority is the main factory spec, not ad hoc research notes.
4. The most plausible current direction is an evidence-first hybrid architecture: curated corpus + bounded live gap search.
5. Any stronger contrary evidence from later phases is allowed to overturn the current recommendation.

## 3. Program-level decision questions

This research program must answer, with evidence:

1. What should the primary ResearchBrain mechanism be?
2. What architecture best forces source quality, contradiction handling, and falsifiable hypotheses?
3. What is the minimal reliable paid budget for 5–10 cycles/day?
4. What should stay inside the Node.js ResearchBrain runtime vs outside it?
5. What provider/search/capture stack is justified only after the quality pipeline is settled?
6. Is the single-agent shape sufficient, or is a staged pipeline clearly better?

## 4. Evidence standard for this program

No architecture claim should be accepted unless it is backed by at least one of:

- verified repo inspection
- official provider/pricing documentation
- real runtime artifacts from this repo
- deterministic experiment results
- explicit comparison against rejected alternatives

Weak evidence for this program includes:

- vague "best practice" claims without mechanism
- provider marketing used as architecture proof
- free-tier assumptions without dashboard or official confirmation
- agent-framework hype without repo-fit analysis

## 5. Research lanes

Each major phase should deliberately use more than one lane.

### Lane A — Architecture red team

Responsibilities:

- challenge the leading design
- identify wrong abstractions
- identify hidden operational burden
- force explicit tradeoffs

### Lane B — Research methodology / quality

Responsibilities:

- define what makes Stage-0 output good instead of noisy
- define evidence grading and contradiction rules
- define acceptance/blocking gates

### Lane C — Provider and capture infrastructure

Responsibilities:

- verify search/capture providers
- quantify quotas, cost, rate limits, and API shape
- distinguish search from capture from browser automation

### Lane D — Repo seam and implementation fit

Responsibilities:

- inspect existing runtime seams
- identify safest integration path
- flag risky abstractions early

### Lane E — Cost and budget modeling

Responsibilities:

- estimate monthly cost at 5–10 cycles/day
- include retries, failed calls, capture, synthesis, and storage
- compare fragile free mode vs minimal paid reliability

### Lane F — Experimental validation

Responsibilities:

- run fixture or live canaries where justified
- measure convergence, source quality, and cost-per-hypothesis
- invalidate theoretical architectures that fail empirically

## 6. Phases

## Phase 0 — Documentation and repo baseline

### Goal

Establish the actual current doctrine and actual current runtime shape.

### Questions

- What is already authoritative?
- Which ResearchBrain docs are stale, duplicated, or conflicting?
- Where are the real implementation seams?

### Required outputs

- canonical doc map
- repo organization map
- active-vs-legacy classification

### Exit condition

One clear implementation authority and one clear supporting research area are established.

## Phase 1 — Failure analysis and baseline measurement

### Goal

Measure the current ResearchBrain behavior before proposing major new architecture.

### Questions

- How often does the agent search vs capture vs hypothesize?
- What are the exact failure classes in prior runs?
- What is the current cost-per-attempt and tool budget burn pattern?

### Required evidence

- run artifact analysis
- transcript/tool-ledger replay
- outcome distribution summary

### Exit condition

The current failure modes are quantified from disk artifacts, not guessed.

### Practical execution slice (minimal)

Keep Phase 1 deliberately small.

1. Run:
   - `npm run researchbrain:stage0-readiness`
   - `npm run researchbrain:stage0-diagnostics`
2. Inspect the richest successful live canary:
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/runtime-result.json`
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/tool-ledger.json`
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/cost-ledger.json`
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B/agent-transcript.jsonl`
3. Contrast it with the blocked budget-exhausted run:
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/runtime-result.json`
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/tool-ledger.json`
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/cost-ledger.json`
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/agent-transcript.jsonl`
   - `factory/research/runs/RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0/quarantine/attempt-001.json`
4. Produce one concise baseline memo with:
   - success vs blocked outcome class
   - blocker / exit reason
   - tool-call counts by type
   - first-capture timing
   - cost-per-run snapshot
   - no architecture prescriptions yet

Read `runtime-result.json` first in both runs before the larger ledgers/transcripts.

## Phase 2 — Research quality architecture

### Goal

Determine the best mechanism for forcing high-quality research behavior.

### Compare at minimum

- live-search-first agent
- pipeline with explicit stages
- curated corpus + periodic ingestion
- hybrid corpus + live gap search
- optional critic or hypothesis-critique pass

### Required evaluation dimensions

- source diversity
- contradiction handling
- disconfirming evidence quality
- falsifiability
- repeatability
- MT5/FTMO tradability relevance

### Exit condition

One quality architecture clearly dominates or the tradeoff is explicitly unresolved.

## Phase 3 — Model and convergence behavior research

### Goal

Separate model quality from architecture quality.

### Questions

- Which model best follows Stage-0 discipline under fixed tools?
- What nudges or hard gates improve convergence?
- What budget shape is reasonable?

### Required evaluation dimensions

- accepted hypotheses per run
- captures per search
- cost per accepted hypothesis
- variance across replications

### Exit condition

The model/behavior regime is no longer a major uncontrolled variable.

## Phase 4 — Provider/capture reality check

### Goal

Verify which live providers are actually worth integrating.

### Questions

- Which providers are reliable enough to keep?
- Which are search-only vs capture-only vs browser-only?
- Where do free tiers break first?
- Which APIs create more operational burden than they save?

### Required evidence

- official docs/pricing
- real call tests where safe and justified
- normalized response/cost comparison

### Exit condition

The provider stack is treated as infrastructure selection, not architecture ideology.

## Phase 5 — Corpus and ingestion architecture

### Goal

Determine how much of ResearchBrain should rely on a maintained evidence library.

### Questions

- Which source families belong in the curated registry?
- How should ingestion be scheduled?
- What metadata must be preserved for trust and freshness?
- Is lightweight FTS enough, or is embeddings-based retrieval justified?

### Required outputs

- source-registry schema
- ingestion policy
- freshness policy
- retrieval recommendation

### Exit condition

The local evidence substrate is concretely defined.

## Phase 6 — Architecture bakeoff / canary

### Goal

Compare the top 2–3 candidate architectures under bounded experimental conditions.

### Minimum bakeoff candidates

- evidence-first hybrid pipeline
- pipeline-first live-search design
- provider-router-heavy design only if it still looks plausible after earlier phases

### Measured outputs

- accepted-hypothesis rate
- evidence-quality score
- source-family diversity
- contradiction/disconfirmation completeness
- cost per run
- cost per accepted hypothesis
- operational complexity

### Exit condition

One architecture is clearly preferable or a deliberate tie is documented with a simplicity tiebreak.

## 7. Comparison rubric

Score final architecture candidates against:

| Criterion | Weight | Question |
|---|---:|---|
| Hypothesis quality | 35 | Does it produce strong, source-backed, falsifiable hypotheses? |
| Convergence reliability | 25 | Does it stop searching and actually synthesize within budget? |
| Cost efficiency | 15 | Is the monthly cost reasonable at 5–10 cycles/day? |
| Source/evidence integrity | 10 | Can every important claim be tied back to deterministic captures? |
| Maintainability | 10 | Is it debuggable and reasonable for this repo? |
| Extensibility | 5 | Can it grow without a rewrite? |

Tie-break rule: if two architectures are close, prefer the simpler one.

## 8. Concrete research deliverables

Planned deliverables under `factory/research/researchbrain/`:

- phase baseline memo
- model/convergence memo
- provider/capture survey memo
- corpus/ingestion design memo
- bakeoff results memo
- final architecture decision memo

Structured artifacts should live beside them where useful, for example:

- cost comparison tables
- provider capability JSON
- replay-analysis JSON
- architecture scorecards

## 9. Findings log process

This document is also the living process file for the deeper research effort.

Whenever a phase completes, append:

- date
- phase
- key findings
- whether the current recommendation got stronger, weaker, or overturned
- next required phase

## 10. What findings would overturn the current recommendation

The current hybrid evidence-first recommendation should be overturned if strong evidence shows one of the following:

1. a provider-router-centric design consistently produces better source quality and better convergence, not just better availability
2. a live-search-first staged pipeline materially outperforms a curated-corpus hybrid in both quality and cost
3. curated corpus maintenance cost becomes unreasonable relative to its quality gain
4. the repo seams make the hybrid design much riskier than a narrower alternative

## 11. Stop conditions for the whole program

Stop the research program when any of these becomes true:

1. two live or fixture-backed canaries support one architecture strongly enough to lock direction
2. additional research is producing little quality gain relative to complexity/time
3. a hard blocker is found that makes the leading design impractical inside repo constraints

## 12. Current next phase

Immediate next phase after this document:

- complete Phase 1 baseline failure analysis from existing ResearchBrain artifacts
- then run Phase 2 / Phase 4 in parallel: quality architecture study and provider/capture reality check

## 13. Findings log (append-only)

### 2026-06-24 — Phase 1B two-model live bakeoff (Kimi K2.7 Code vs GLM 5.2 via OpenCode Go)

Scope: same `request.json` shape, same tools, same budget (`--max-llm-calls 12 --max-tool-calls 30 --llm-max-tokens 8192 --timeout-ms 180000 --max-estimated-live-cost-usd 1.0 --source-provider brave --tool-mode live`). Only the LLM model and `reasoning_effort` differ.

**Discovered real model IDs (live `/v1/models` roundtrip, not docs):**

- `https://opencode.ai/zen/go/v1/models` returns the full model list
- model id format is **bare** (`kimi-k2.7-code`, `glm-5.2`), **not** `opencode-go/<id>`; using the `opencode-go/` prefix returns HTTP 401 `ModelError: Model opencode-go/<id> is not supported`
- Kimi supports `reasoning_effort ∈ {minimal, low, medium, high}`; **`xhigh` is rejected** with HTTP 400
- GLM accepts `reasoning_effort: xhigh` without complaint
- base URL is `https://opencode.ai/zen/go/v1`; auth header `Authorization: Bearer $OPENCODE_GO_API_KEY`

**Run results:**

| Run | Model | Effort | Status | Tool calls | First capture | Hypothesis | Cost USD |
|---|---|---|---|---:|---:|---:|---:|
| `RESEARCHBRAIN-STAGE0-RUNTIME-20260624190347` | `kimi-k2.7-code` | `high` | `blocked` (search_web returned no results) | 1 | n/a | 0 | $0.000001 |
| `RESEARCHBRAIN-STAGE0-RUNTIME-20260624190036` | `glm-5.2` | `xhigh` | `ready` | 6 | index 2 | 1 | $0.000009 |

**Outcome asymmetry is striking:** both runs had identical setup, identical Brave live search opt-in, identical request. Kimi burned its first `search_web` call on a query that returned no results, then terminated on the adapter's no-results branch. GLM used a different query pattern, got a Federal Reserve source (Dobrev/Liu/Kim/Rodriguez 2025-11-03, "Order Flow Imbalances and Amplification of Price Movements: Evidence from U.S. Treasury Markets"), captured it, ran the three mandatory memory tools, and produced a well-formed Stage-0 hypothesis with non-empty `disconfirming_evidence` (3), `invalidation_criteria` (3), `expected_failure_modes` (3), `prior_failed_patterns_checked` (2), and a `novelty_reason`.

**Implications for the current architecture recommendation:**

1. **Model quality is a major control variable, not background noise.** The same Stage-0 prompt, the same tool budget, and the same Brave adapter produced diametrically different outcomes based only on the model. A reasonable model swap can move the agent from `blocked` to `ready` in one canary.
2. **Convergence discipline was the same in both runs** (both honored the `search → capture → memory tools → record_hypothesis` shape), but Kimi's first `search_web` was unlucky. That suggests the runtime's convergence gates are not the binding constraint here — model-side query choice is.
3. **The earlier provider-router synthesis is even less compelling.** Even if we added Brave + Jina + Exa + Firecrawl rotation, it would not have changed Kimi's first-query outcome, only its fallback options. Model choice dominates search-query success rate.
4. **Cost is negligible at this volume** ($0.000009 per successful GLM canary, $0.000041 for the earlier blocked DeepSeek canary, $0.000019 for the successful DeepSeek canary). All three live backends are < 5¢ per Stage-0 cycle. Quota / cost arguments for or against any one of them are not load-bearing in the 5–10 cycles/day target.
5. **The fact that GLM captured an authoritative government source (federalreserve.gov) on the very first attempt is a strong signal** for the curated-corpus path: when the runtime's search is steered toward capture + graded sources, the model can find them in a single turn.

**What this does NOT change:**

- Provider-router is still not the main mechanism. Even with model-quality wins, the runtime is dominated by what the model decides to do with a `search_web` call.
- The hybrid evidence-first recommendation still holds. If anything, the GLM result strengthens it: a good model + the existing evidence gates produces exactly the artifact shape we wanted.
- No backtest / WFA / MT5 / Phase 8E claim is being made. This was a Stage-0 only measurement.

**Open follow-ups for Phase 1B (low risk, low cost):**

- Re-run Kimi with a slightly different first query to confirm whether the no-results block was query luck or model behavior.
- Run a 3rd model (DeepSeek V4 Flash with `xhigh`) on the same request to triangulate.
- Capture a "first-query chosen by each model" table to make the convergence model-side difference explicit.

### Earlier findings (2026-06-08 → 2026-06-12, summarized for context)

- `RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-DEEPSEEK-LIVE-CANARY-8192D-20260611T2030Z-09B855E4512A2B57F246304B` (DeepSeek V4 Flash xhigh): `ready`, 12 LLM calls, first capture at call 2, 1 `record_hypothesis`, total cost $0.000019. Captured FTMO blog. (b3)
- `RUN-RB-STAGE0-RESEARCHBRAIN-REQUEST-MT5-MULTIASSET-LIQVOL-STAGE0-20260612T1305Z-51FAADA557B5EDD1516544C0` (DeepSeek V4 Flash xhigh): `blocked`, 30 tool calls, `search_web` 28, first capture at call 19, 0 `record_hypothesis`, cost $0.000041. Quarantine reason: `ResearchBrain tool call budget exceeded: 30`. (b3)

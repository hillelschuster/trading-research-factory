import { RESEARCHBRAIN_ALLOWED_TOOLS } from "./researchbrain-tools.mjs";
import { sanitizeRetryErrorMessage } from "./retry-policy.mjs";

export const RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE = "openai_compatible";
export const RESEARCHBRAIN_LLM_PROVIDER_DEEPSEEK = "deepseek";

function normalizeProviderName(provider) {
  return String(provider ?? "").trim().toLowerCase();
}

function defaultApiKeyEnv(provider) {
  if (normalizeProviderName(provider) === RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE) return "OPENCODE_API_KEY";
  if (normalizeProviderName(provider) === RESEARCHBRAIN_LLM_PROVIDER_DEEPSEEK) return "DEEPSEEK_API_KEY";
  return null;
}

function defaultBaseUrlEnv(provider) {
  if (normalizeProviderName(provider) === RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE) return "OPENCODE_API_BASE_URL";
  return null;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

function clippedJson(value, maxChars = 12_000) {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...<clipped>`;
}

function buildSystemPrompt({ provider, model }) {
  return [
    "You are ResearchBrain, a free-roaming creative researcher for a solo autonomous quant research factory.",
    "Your job: discover NOVEL trading edges from EXTERNAL sources — NOT from your training data.",
    "",
    "## Research phases",
    "",
    "Phase 1 — SCOUT EXTERNALLY, THEN FOLLOW SIGNAL: Start broad enough to avoid training-data confirmation. Choose one or two promising source classes first, capture and read deeply. Switch only when the trail is weak. Do NOT start with a specific hypothesis from training data. Let the sources suggest patterns, not the other way around. Do NOT treat source classes as a coverage checklist — follow signal, not coverage.",
    "",
    "Phase 2 — READ AND SYNTHESIZE: Capture and read sources. Record observations and hunches in the research journal (write_wiki_page) as you go. Let sources drive your thinking.",
    "",
    "Phase 3 — FORM HYPOTHESIS FROM SOURCES: After capturing at least one external source, form a hypothesis grounded in what you discovered — not in training data. A single source is sufficient if the idea looks worth testing. Sometimes the best alpha is in a field where only one source talks about it. Do NOT require multiple sources or multiple source families.",
    "",
    "Phase 4 — VALIDATE: Before recording, run required memory checks (search_research_memory, check_duplicate_memory, check_failed_pattern_similarity). Then search your own captured sources for any evidence that disconfirms or weakens the hypothesis. Only after this pre-recording critic is complete, call record_hypothesis.",
    "",
    "Phase 5 — FINAL CHECK: After recording, reply with no tool calls to signal final=true to the local runtime. Do NOT search for more evidence or run more tool calls after recording — all validation and self-review must happen before record_hypothesis in Phase 4.",
    "",
    "## Rules",
    "",
    "Tool arguments must be compact valid JSON. Keep record_hypothesis string fields short and avoid markdown, quotes-heavy prose, or multiline strings inside tool arguments.",
    "You must not use provider-native web/search as evidence; only deterministic captured source artifacts may support a hypothesis.",
    "You must not claim profitability, Sharpe, CAGR, PnL, WFA, MT5 execution, MQL5 parity, trading, account access, or promotion authority.",
    "Call mandatory memory tools (search_research_memory, check_duplicate_memory, check_failed_pattern_similarity) before record_hypothesis. Do not repeat memory tools in a loop; after they have run once, proceed to record_hypothesis unless check_failed_pattern_similarity returned blocked=true.",
    "A duplicate=true result is advisory for novelty notes, not a hard block; record the hypothesis with a careful novelty_reason unless failed-pattern similarity is blocked.",
    "After record_hypothesis has been called, reply with no tool calls to signal final=true to the local runtime. All validation and self-review must happen before recording in Phase 4 — do not search for more evidence after recording.",
    "Budget awareness: if you have used more than 60% of your tool-call budget, you MUST stop scouting and advance to synthesis. Form a hypothesis from what you have captured, even if incomplete. A weak hypothesis from one source is better than zero hypotheses from many searches.",
    "",
    "## Trader mentality",
    "",
    "Think like a trader seeking alpha, not like an academic seeking consensus. A trader finds one good idea and tests it. The idea may have only one source — a single Reddit thread, one blog post, one YouTube video — and that is enough to test. The only hard rule: the idea must come from an external source, not from LLM training data.",
    "",
    `Provider adapter: ${provider}/${model}.`
  ].join("\n");
}

function buildUserMessage(context) {
  return [
    "ResearchBrain request and current transcript follow.",
    "Return provider tool-use calls only for the allowed deterministic tool catalog, or plain final text with no tool calls when finished.",
    "Do not include unsupported fields or profitability/promotion claims.",
    "",
    "Request:",
    clippedJson(context.request ?? {}),
    "",
    "Allowed tools:",
    clippedJson(context.allowed_tools ?? RESEARCHBRAIN_ALLOWED_TOOLS),
    "",
    "Transcript:",
    clippedJson(context.transcript ?? [])
  ].join("\n");
}

function toolParameterSchema(toolName) {
  const stringField = (description, extra = {}) => ({ type: "string", description, ...extra });
  const stringArrayField = (description, extra = {}) => ({ type: "array", items: { type: "string" }, description, ...extra });
  const coreHypothesisRequiredFields = [
    "hypothesis_id",
    "mechanism",
    "falsifiable_prediction",
    "instrument_scope",
    "timeframe_candidate",
    "strategy_family",
    "cited_source_ids",
    "source_claims"
  ];
  const commonHypothesisFields = {
    hypothesis_id: stringField("Stable Stage-0 hypothesis id, e.g. HYP-STAGE0-LIVE-CANARY-001."),
    mechanism: stringField("Concise mechanism only; no profitability or execution claim."),
    falsifiable_prediction: stringField("What later deterministic WFA could falsify; no result claim."),
    market_structure_assumption: stringField("Market structure premise constrained to FTMO/MT5 universe."),
    instrument_scope: stringField("FTMO MT5 symbol scope; no prediction markets."),
    timeframe_candidate: stringField("Candidate timeframe range, at least 8 characters, e.g. M15-H1 candidate.", { minLength: 8 }),
    strategy_family: stringField("Snake_case strategy family."),
    mt5_relevance_classification: stringField("Use mt5_relevant_unverified unless terminal equivalence is available."),
    required_data: stringField("Data needed for later deterministic validation."),
    expected_holding_period: stringField("Stage-0 expectation only."),
    expected_trade_frequency: stringField("Unknown or qualitative; no win-rate/return claim."),
    expected_failure_modes: stringArrayField("Ways the hypothesis could fail later.", { minItems: 1 }),
    invalidation_criteria: stringArrayField("Concrete later invalidation criteria; avoid Sharpe, returns, win-rate, profit-factor, or promotion terms.", { minItems: 1 }),
    implementation_shape: stringField("Rule-based candidate shape for later planning only."),
    execution_sensitivity: stringField("Spread, swap, session, contract-spec, or slippage sensitivities."),
    mt5_ftmo_concerns: stringField("FTMO/MT5 concerns requiring later verification."),
    prior_related_lessons: stringArrayField("Prior lessons checked.", { minItems: 1 }),
    prior_failed_patterns_checked: stringArrayField("Prior failed patterns or duplicate-memory results checked; must be non-empty even if only noting no blocking match.", { minItems: 1 }),
    novelty_reason: stringField("Why this is not a duplicate or parameter-only mutation."),
    disconfirming_evidence: stringArrayField("Disconfirming or limitation notes.", { minItems: 1 }),
    proposed_experiment_shape: stringField("Later deterministic falsification shape only."),
    cited_source_ids: stringArrayField("Captured source ids supporting the hypothesis.", { minItems: 1 }),
    source_claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim_class: stringField("Use source_backed_mechanism for this canary."),
          citation_source_id: stringField("Captured source id cited by this claim.")
        },
        required: ["claim_class", "citation_source_id"]
      }
    }
  };

  const schemas = {
    search_web: {
      type: "object",
      additionalProperties: false,
      properties: { query: stringField("Search query for deterministic Brave discovery.") },
      required: ["query"]
    },
    capture_url_source: {
      type: "object",
      additionalProperties: false,
      properties: {
        source_id: stringField("Required stable source id, e.g. SRC-LIVE-CANARY-001."),
        url: stringField("URL returned by a prior search result in this run."),
        source_class: stringField("Use web unless the captured source is broker, mql5, or official_docs."),
        claims_extracted: stringArrayField("Short source-backed claims extracted from the captured document."),
        limitations: stringArrayField("Source limitations."),
        disconfirming_relevance: stringArrayField("Reasons this source may not survive later validation.")
      },
      required: ["source_id", "url", "source_class"]
    },
    search_research_memory: {
      type: "object",
      additionalProperties: false,
      properties: { query: stringField("Memory query for prior packets and failures."), limit: { type: "integer", minimum: 1, maximum: 5 } },
      required: ["query"]
    },
    check_duplicate_memory: {
      type: "object",
      additionalProperties: false,
      properties: {
        mechanism: stringField("Proposed mechanism."),
        strategy_family: stringField("Strategy family."),
        instrument_scope: stringField("Instrument scope."),
        timeframe_candidate: stringField("Candidate timeframe."),
        min_overlap: { type: "integer", minimum: 1, maximum: 10 }
      },
      required: ["mechanism", "strategy_family", "instrument_scope", "timeframe_candidate"]
    },
    check_failed_pattern_similarity: {
      type: "object",
      additionalProperties: false,
      properties: {
        mechanism: stringField("Proposed mechanism."),
        strategy_family: stringField("Strategy family."),
        instrument_scope: stringField("Instrument scope."),
        timeframe_candidate: stringField("Candidate timeframe."),
        parameters: { type: "object", additionalProperties: true },
        min_overlap: { type: "integer", minimum: 1, maximum: 10 }
      },
      required: ["mechanism", "strategy_family", "instrument_scope", "timeframe_candidate"]
    },
    record_hypothesis: {
      type: "object",
      additionalProperties: false,
      properties: commonHypothesisFields,
      required: coreHypothesisRequiredFields
    },
    write_wiki_page: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: stringField("Wiki page path relative to vault root, e.g. 'concepts/order-flow.md' or 'hunches/2026-06-30-idea.md'"),
        type: { type: "string", enum: ["concept", "source", "hypothesis", "hunch"], description: "Page type" },
        content: stringField("Markdown body (no frontmatter — tool auto-generates it)"),
        tags: stringArrayField("Tags for the page"),
        summary: stringField("1-sentence summary for index")
      },
      required: ["path", "type", "content"]
    },
    search_wiki: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: stringField("Keyword or tag to search (empty = match all)"),
        type: { type: "string", enum: ["concept", "source", "hypothesis", "hunch"], description: "Filter by type" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max results (default 10)" },
        include_bodies: { type: "boolean", description: "Include full page content (default false)" }
      }
    }
  };
  return schemas[toolName] ?? { type: "object", additionalProperties: true };
}

function buildOpenAiCompatibleTools(allowedTools) {
  return allowedTools.map((toolName) => ({
    type: "function",
    function: {
      name: toolName,
      description: `ResearchBrain deterministic Stage-0 tool: ${toolName}. This tool has no execution/profitability authority.`,
      parameters: toolParameterSchema(toolName)
    }
  }));
}

async function readResponseText(response, maxResponseBytes) {
  const text = await response.text();
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxResponseBytes) throw new Error(`ResearchBrain LLM provider response exceeded maxResponseBytes ${maxResponseBytes}: ${bytes}`);
  return text;
}

function parseOpenAiCompatibleChatResponse(body, { provider = RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE } = {}) {
  const message = body?.choices?.[0]?.message ?? {};
  const toolCalls = [];
  let providerError = null;
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      try {
        toolCalls.push({
          provider_tool_call_id: call.id ?? null,
          tool: call.function?.name,
          input: call.function?.arguments ? JSON.parse(call.function.arguments) : {}
        });
      } catch (error) {
        providerError = {
          status: "malformed_tool_arguments",
          retryable_for_agent: true,
          tool: call.function?.name ?? null,
          provider_tool_call_id: call.id ?? null,
          error: sanitizeRetryErrorMessage(error instanceof Error ? error.message : String(error))
        };
      }
    }
  }
  return {
    tool_calls: toolCalls,
    final: !providerError && toolCalls.length === 0 && (body?.choices?.[0]?.finish_reason === "stop" || typeof message.content === "string"),
    text: typeof message.content === "string" ? message.content.trim() : "",
    provider_error: providerError,
    provider_raw: {
      provider,
      provider_native_search_enabled: false,
      id: body?.id ?? null,
      model: body?.model ?? null,
      finish_reason: body?.choices?.[0]?.finish_reason ?? null,
      usage: body?.usage ?? null
    }
  };
}

export function createOpenAiCompatibleResearchBrainLlmClient({
  allowLiveLlm = false,
  model,
  apiKey = null,
  apiKeyEnv = "OPENCODE_API_KEY",
  baseUrl = null,
  baseUrlEnv = "OPENCODE_API_BASE_URL",
  fetchImpl = globalThis.fetch,
  maxTokens = 2048,
  reasoningEffort = null,
  maxResponseBytes = 512_000
} = {}) {
  if (allowLiveLlm !== true) throw new Error("OpenAI-compatible ResearchBrain LLM adapter requires explicit allowLiveLlm=true");
  const llmModel = requireNonEmptyString(model, "OpenAI-compatible ResearchBrain model");
  const resolvedApiKey = apiKey ?? process.env[apiKeyEnv];
  if (typeof resolvedApiKey !== "string" || resolvedApiKey.trim().length === 0) throw new Error(`OpenAI-compatible ResearchBrain LLM adapter requires API key in ${apiKeyEnv}`);
  const resolvedBaseUrl = baseUrl ?? process.env[baseUrlEnv];
  if (typeof resolvedBaseUrl !== "string" || resolvedBaseUrl.trim().length === 0) throw new Error(`OpenAI-compatible ResearchBrain LLM adapter requires base URL in ${baseUrlEnv}`);
  if (typeof fetchImpl !== "function") throw new Error("OpenAI-compatible ResearchBrain LLM adapter requires fetchImpl");
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw new Error("OpenAI-compatible maxTokens must be an integer from 1 to 8192");
  const endpoint = new URL("chat/completions", resolvedBaseUrl.endsWith("/") ? resolvedBaseUrl : `${resolvedBaseUrl}/`).toString();
  return {
    name: "openai_compatible_researchbrain_llm_client",
    provider: RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE,
    model: llmModel,
    live_llm: true,
    provider_native_search_enabled: false,
    async generate(context = {}) {
      const allowedTools = Array.isArray(context.allowed_tools) && context.allowed_tools.length > 0 ? context.allowed_tools : RESEARCHBRAIN_ALLOWED_TOOLS;
      const body = {
        model: llmModel,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: buildSystemPrompt({ provider: RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE, model: llmModel }) },
          { role: "user", content: buildUserMessage(context) }
        ],
        tools: buildOpenAiCompatibleTools(allowedTools),
        tool_choice: "auto"
      };
      if (typeof reasoningEffort === "string" && reasoningEffort.trim().length > 0) body.reasoning_effort = reasoningEffort.trim();
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${resolvedApiKey}`
          },
          body: JSON.stringify(body),
          signal: context.signal
        });
        const text = await readResponseText(response, maxResponseBytes);
        if (!response.ok) throw new Error(`OpenAI-compatible ResearchBrain LLM adapter HTTP ${response.status}: ${text.slice(0, 500)}`);
        return parseOpenAiCompatibleChatResponse(JSON.parse(text), { provider: RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE });
      } catch (error) {
        throw new Error(sanitizeRetryErrorMessage(error instanceof Error ? error.message : String(error)));
      }
    }
  };
}

export function createDeepSeekResearchBrainLlmClient({
  allowLiveLlm = false,
  model,
  apiKey = null,
  apiKeyEnv = "DEEPSEEK_API_KEY",
  baseUrl = "https://api.deepseek.com",
  fetchImpl = globalThis.fetch,
  maxTokens = 2048,
  maxResponseBytes = 512_000
} = {}) {
  if (allowLiveLlm !== true) throw new Error("DeepSeek ResearchBrain LLM adapter requires explicit allowLiveLlm=true");
  const llmModel = requireNonEmptyString(model, "DeepSeek ResearchBrain model");
  const resolvedApiKey = apiKey ?? process.env[apiKeyEnv];
  if (typeof resolvedApiKey !== "string" || resolvedApiKey.trim().length === 0) throw new Error(`DeepSeek ResearchBrain LLM adapter requires API key in ${apiKeyEnv}`);
  if (typeof fetchImpl !== "function") throw new Error("DeepSeek ResearchBrain LLM adapter requires fetchImpl");
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw new Error("DeepSeek maxTokens must be an integer from 1 to 8192");
  const resolvedBaseUrl = baseUrl;
  if (typeof resolvedBaseUrl !== "string" || resolvedBaseUrl.trim().length === 0) throw new Error("DeepSeek ResearchBrain LLM adapter requires base URL");
  const endpoint = new URL("chat/completions", resolvedBaseUrl.endsWith("/") ? resolvedBaseUrl : `${resolvedBaseUrl}/`).toString();
  return {
    name: "deepseek_researchbrain_llm_client",
    provider: RESEARCHBRAIN_LLM_PROVIDER_DEEPSEEK,
    model: llmModel,
    live_llm: true,
    provider_native_search_enabled: false,
    async generate(context = {}) {
      const allowedTools = Array.isArray(context.allowed_tools) && context.allowed_tools.length > 0 ? context.allowed_tools : RESEARCHBRAIN_ALLOWED_TOOLS;
      const body = {
        model: llmModel,
        max_tokens: maxTokens,
        thinking: { type: "enabled" },
        reasoning_effort: "max",
        messages: [
          { role: "system", content: buildSystemPrompt({ provider: RESEARCHBRAIN_LLM_PROVIDER_DEEPSEEK, model: llmModel }) },
          { role: "user", content: buildUserMessage(context) }
        ],
        tools: buildOpenAiCompatibleTools(allowedTools),
        tool_choice: "auto"
      };
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${resolvedApiKey}`
          },
          body: JSON.stringify(body),
          signal: context.signal
        });
        const text = await readResponseText(response, maxResponseBytes);
        if (!response.ok) throw new Error(`DeepSeek ResearchBrain LLM adapter HTTP ${response.status}: ${text.slice(0, 500)}`);
        return parseOpenAiCompatibleChatResponse(JSON.parse(text), { provider: RESEARCHBRAIN_LLM_PROVIDER_DEEPSEEK });
      } catch (error) {
        throw new Error(sanitizeRetryErrorMessage(error instanceof Error ? error.message : String(error)));
      }
    }
  };
}

export function createResearchBrainLlmClient({
  allowLiveLlm = false,
  provider,
  model,
  apiKey = null,
  apiKeyEnv = null,
  fetchImpl = globalThis.fetch,
  ...options
} = {}) {
  if (allowLiveLlm !== true) throw new Error("ResearchBrain LLM client requires explicit allowLiveLlm=true");
  const normalizedProvider = normalizeProviderName(provider);
  if (normalizedProvider === RESEARCHBRAIN_LLM_PROVIDER_OPENAI_COMPATIBLE) {
    return createOpenAiCompatibleResearchBrainLlmClient({
      allowLiveLlm,
      model,
      apiKey,
      apiKeyEnv: apiKeyEnv ?? defaultApiKeyEnv(normalizedProvider),
      baseUrl: options.baseUrl,
      baseUrlEnv: options.baseUrlEnv ?? defaultBaseUrlEnv(normalizedProvider),
      fetchImpl,
      ...Object.fromEntries(Object.entries(options).filter(([key]) => !["baseUrl", "baseUrlEnv"].includes(key)))
    });
  }
  if (normalizedProvider === RESEARCHBRAIN_LLM_PROVIDER_DEEPSEEK) {
    return createDeepSeekResearchBrainLlmClient({
      allowLiveLlm,
      model,
      apiKey,
      apiKeyEnv: apiKeyEnv ?? defaultApiKeyEnv(normalizedProvider),
      baseUrl: options.baseUrl,
      fetchImpl,
      ...Object.fromEntries(Object.entries(options).filter(([key]) => !["baseUrl", "baseUrlEnv"].includes(key)))
    });
  }
  throw new Error(`Unsupported ResearchBrain LLM provider: ${provider ?? "unspecified"}`);
}

/**
 * Shared utilities for constructing ResearchBrain Stage-0 live LLM/source providers
 * from CLI-parsed options. Used by run-researchbrain-stage0-runtime.mjs (single provider)
 * and run-researchbrain-stage0-supervisor.mjs (provider factory for loop runner).
 */
import fs from "node:fs";
import path from "node:path";
import { createFixtureResearchBrainProvider, createJsonFileResearchBrainProvider } from "../src/core/researchbrain-runtime.mjs";
import { createLiveResearchBrainAgentProvider, createScriptedResearchBrainAgentProvider } from "../src/core/researchbrain-agent.mjs";
import { createResearchBrainLlmClient } from "../src/core/researchbrain-llm-providers.mjs";
import {
  RESEARCHBRAIN_ALLOWED_TOOLS,
  createBraveResearchBrainSourceToolAdapter,
  createArxivResearchBrainSourceToolAdapter,
  createCompositeResearchBrainSourceToolAdapter,
  createRedditResearchBrainSourceToolAdapter,
  createGithubResearchBrainSourceToolAdapter,
  createSemanticScholarResearchBrainSourceToolAdapter,
  createSiteScopedResearchBrainSourceToolAdapter
} from "../src/core/researchbrain-tools.mjs";

export { applyResearchBrainLlmPreset } from "../src/core/researchbrain-llm-catalog.mjs";

/**
 * Default live-loop catalog. Wiki tools remain available for explicit experiments,
 * but are excluded from normal ResearchBrain runs because they consume research
 * budget without contributing to the deterministic hypothesis output.
 */
export const RESEARCHBRAIN_ACTIVE_LIVE_TOOLS = Object.freeze(
  RESEARCHBRAIN_ALLOWED_TOOLS.filter((tool) => !["write_wiki_page", "search_wiki"].includes(tool))
);

/**
 * Provider output is untrusted. The runtime owns hypothesis content hashes, so provider-supplied
 * hashes are removed before validation and disk writes.
 */
export function removeProviderHypothesisContentHashes(output) {
  if (!output || typeof output !== "object" || Array.isArray(output) || !Array.isArray(output.hypothesis_packets)) return output;
  return {
    ...output,
    hypothesis_packets: output.hypothesis_packets.map((packet) => {
      if (!packet || typeof packet !== "object" || Array.isArray(packet)) return packet;
      const { content_hash: _ignoredProviderHash, ...trustedFields } = packet;
      return trustedFields;
    })
  };
}

export function wrapResearchBrainProviderOutput(provider) {
  if (!provider || typeof provider.generate !== "function") return provider;
  return {
    ...provider,
    async generate(context) {
      const output = await provider.generate.call(provider, context);
      return removeProviderHypothesisContentHashes(output);
    }
  };
}

/**
 * Loads repo-local .env values into process.env without printing or persisting secrets.
 * Existing process.env values win, matching the previous runtime CLI behavior.
 */
export function loadResearchBrainCliEnv({ rootDir = process.cwd() } = {}) {
  const envPath = path.resolve(rootDir, ".env");
  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath };
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
  return { loaded: true, path: envPath };
}

/**
 * Returns known env-var names for each source provider (env-only — never returns values).
 * Used for diagnostics, preflight checks, and help text without persisting secrets.
 *
 * @param {string} providerName - source provider short name (brave, semantic_scholar, etc.)
 * @returns {string|null} The env-var name that configures this provider, or null if unknown.
 */
export function getResearchBrainSourceAdapterEnvName(providerName) {
  const name = String(providerName ?? "").trim().toLowerCase();
  return {
    brave: "BRAVE_SEARCH_API_KEY",
    semantic_scholar: "SEMANTIC_SCHOLAR_API_KEY",
    mql5: "BRAVE_SEARCH_API_KEY",
    broker_docs: "BRAVE_SEARCH_API_KEY"
  }[name] ?? null;
}

/**
 * Reports whether the env var for a given source provider is present and non-empty (boolean only,
 * never the value itself). Returns false for unknown providers.
 */
export function isResearchBrainSourceAdapterEnvConfigured(providerName) {
  const envName = getResearchBrainSourceAdapterEnvName(providerName);
  return typeof envName === "string" && typeof process.env[envName] === "string" && process.env[envName].length > 0;
}

/**
 * Builds a source-tool adapter from CLI-parsed options, or null when no source provider is configured.
 */
export function buildResearchBrainSourceToolAdapter(args) {
  // Support comma-separated providers: --source-provider brave,arxiv,reddit
  const providers = String(args.sourceProvider ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (providers.length === 0) return null;
  const adapters = [];
  for (const provider of providers) {
    if (provider === "brave") {
      adapters.push(createBraveResearchBrainSourceToolAdapter({
        allowLiveSourceSearch: args.allowLiveSourceSearch === true,
        allowLiveSourceCapture: args.allowLiveSourceCapture === true,
        apiKeyEnv: args.sourceApiKeyEnv ?? "BRAVE_SEARCH_API_KEY",
        maxCaptureBytes: args.sourceMaxBytes ?? 500_000
      }));
    } else if (provider === "arxiv") {
      adapters.push(createArxivResearchBrainSourceToolAdapter({
        allowLiveSourceSearch: args.allowLiveSourceSearch === true,
        allowLiveSourceCapture: args.allowLiveSourceCapture === true,
        maxCaptureBytes: args.sourceMaxBytes ?? 500_000
      }));
    } else if (provider === "reddit") {
      adapters.push(createRedditResearchBrainSourceToolAdapter({
        allowLiveSourceSearch: args.allowLiveSourceSearch === true,
        allowLiveSourceCapture: args.allowLiveSourceCapture === true,
        maxCaptureBytes: args.sourceMaxBytes ?? 500_000
      }));
    } else if (provider === "github") {
      adapters.push(createGithubResearchBrainSourceToolAdapter({
        allowLiveSourceSearch: args.allowLiveSourceSearch === true,
        allowLiveSourceCapture: args.allowLiveSourceCapture === true,
        maxCaptureBytes: args.sourceMaxBytes ?? 500_000
      }));
    } else if (provider === "semantic_scholar") {
      adapters.push(createSemanticScholarResearchBrainSourceToolAdapter({
        allowLiveSourceSearch: args.allowLiveSourceSearch === true,
        allowLiveSourceCapture: args.allowLiveSourceCapture === true,
        apiKeyEnv: args.sourceApiKeyEnv ?? "SEMANTIC_SCHOLAR_API_KEY",
        maxCaptureBytes: args.sourceMaxBytes ?? 500_000
      }));
    } else if (provider === "mql5") {
      adapters.push(createSiteScopedResearchBrainSourceToolAdapter({
        toolName: "search_mql5_sources",
        siteDomain: "mql5.com",
        sourceClass: "mql5",
        allowLiveSourceSearch: args.allowLiveSourceSearch === true,
        allowLiveSourceCapture: args.allowLiveSourceCapture === true,
        apiKeyEnv: args.sourceApiKeyEnv ?? "BRAVE_SEARCH_API_KEY",
        maxCaptureBytes: args.sourceMaxBytes ?? 500_000
      }));
    } else if (provider === "broker_docs") {
      adapters.push(createSiteScopedResearchBrainSourceToolAdapter({
        toolName: "search_broker_docs",
        siteDomain: "ftmo.com",
        sourceClass: "broker",
        allowLiveSourceSearch: args.allowLiveSourceSearch === true,
        allowLiveSourceCapture: args.allowLiveSourceCapture === true,
        apiKeyEnv: args.sourceApiKeyEnv ?? "BRAVE_SEARCH_API_KEY",
        maxCaptureBytes: args.sourceMaxBytes ?? 500_000
      }));
    }
  }
  if (adapters.length === 0) return null;
  if (adapters.length === 1) return adapters[0];
  return createCompositeResearchBrainSourceToolAdapter({ adapters });
}

/**
 * Returns a providerFactory function compatible with runResearchBrainStage0Loop / resolveProvider.
 * The factory captures the CLI-provided live LLM/source options and selects the provider based on
 * each job's payload.provider_mode.
 *
 * Returns null when no explicit live opt-ins are present (caller should skip or use default fallback).
 */
export function buildResearchBrainProviderFactory(args) {
  const sourceToolAdapter = buildResearchBrainSourceToolAdapter(args);
  const allowLiveLlm = args.allowLiveLlm === true;
  const llmProvider = args.llmProvider;
  const llmModel = args.llmModel;
  const llmApiKeyEnv = args.llmApiKeyEnv;
  const llmBaseUrl = args.llmBaseUrl;
  const llmBaseUrlEnv = args.llmBaseUrlEnv;
  const llmMaxTokens = args.llmMaxTokens ?? 2048;
  const llmReasoningEffort = args.llmReasoningEffort;
  const allowedTools = args.allowedTools ?? RESEARCHBRAIN_ACTIVE_LIVE_TOOLS;
  const maxLlmCalls = args.maxLlmCalls ?? 12;
  const maxToolCalls = args.maxToolCalls ?? 50;
  const maxCostUsd = args.maxCostUsd ?? 0.25;
  const maxTranscriptBytes = args.maxTranscriptBytes ?? 250_000;
  const toolMode = args.toolMode;
  const sourceToolMaxAttempts = args.sourceToolMaxAttempts ?? 3;
  const sourceToolRetryDelayMs = args.sourceToolRetryDelayMs ?? 2000;
  const providerScript = args.providerScript;
  const providerOutput = args.providerOutput;
  const rootDir = args.rootDir ?? process.cwd();

  // If no live opt-ins are present, return null so the caller falls back to default fixture behavior.
  if (!allowLiveLlm && !providerScript && !providerOutput) return null;

  return ({ payload }) => {
    // Read model settings from payload first (job-specific), falling back to CLI args.
    // This prevents cross-contamination when jobs from different presets co-exist in the ledger.
    const jobLlmProvider = payload.llm_provider ?? llmProvider;
    const jobLlmModel = payload.llm_model ?? llmModel;
    const jobLlmApiKeyEnv = payload.llm_api_key_env ?? llmApiKeyEnv;
    const jobLlmBaseUrl = payload.llm_base_url ?? llmBaseUrl;
    const jobLlmBaseUrlEnv = payload.llm_base_url_env ?? llmBaseUrlEnv;
    const jobLlmMaxTokens = payload.llm_max_tokens ?? llmMaxTokens;
    const jobLlmReasoningEffort = payload.llm_reasoning_effort ?? llmReasoningEffort;
    const jobMaxLlmCalls = payload.max_llm_calls ?? maxLlmCalls;
    const jobMaxToolCalls = payload.max_tool_calls ?? maxToolCalls;
    const jobMaxCostUsd = payload.max_cost_usd ?? maxCostUsd;
    const jobMaxTranscriptBytes = payload.max_transcript_bytes ?? maxTranscriptBytes;
    const jobToolMode = payload.tool_mode ?? toolMode;

    if (payload.provider_mode === "live_llm_agent") {
      if (!allowLiveLlm) throw new Error("--allow-live-llm is required for provider_mode live_llm_agent");
      if (!jobLlmProvider || !jobLlmModel) throw new Error("Live LLM agent requires --llm-provider and --llm-model (either CLI or payload)");
      return wrapResearchBrainProviderOutput(createLiveResearchBrainAgentProvider({
        llmClient: createResearchBrainLlmClient({
          allowLiveLlm: true,
          provider: jobLlmProvider,
          model: jobLlmModel,
          apiKeyEnv: jobLlmApiKeyEnv,
          baseUrl: jobLlmBaseUrl,
          baseUrlEnv: jobLlmBaseUrlEnv,
          maxTokens: jobLlmMaxTokens,
          reasoningEffort: jobLlmReasoningEffort
        }),
        allowLiveLlm: true,
        llmProvider: jobLlmProvider,
        llmModel: jobLlmModel,
        allowedTools,
        maxLlmCalls: jobMaxLlmCalls,
        maxToolCalls: jobMaxToolCalls,
        maxCostUsd: jobMaxCostUsd,
        maxTranscriptBytes: jobMaxTranscriptBytes,
        toolMode: jobToolMode ?? "live",
        sourceToolAdapter,
        retryPolicy: { sourceToolMaxAttempts, sourceToolRetryDelayMs }
      }));
    }
    if (payload.provider_mode === "scripted_agent") {
      return wrapResearchBrainProviderOutput(createScriptedResearchBrainAgentProvider({
        script: providerScript ? JSON.parse(fs.readFileSync(providerScript, "utf8")) : [],
        allowedTools,
        maxToolCalls: maxToolCalls ?? 20,
        maxCostUsd: maxCostUsd ?? 0.01,
        maxTranscriptBytes: maxTranscriptBytes ?? 250_000,
        toolMode: toolMode ?? "fixture",
        sourceToolAdapter,
        retryPolicy: { sourceToolMaxAttempts, sourceToolRetryDelayMs }
      }));
    }
    if (providerOutput) {
      return wrapResearchBrainProviderOutput(createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput }));
    }
    return wrapResearchBrainProviderOutput(createFixtureResearchBrainProvider({ mode: payload.provider_mode ?? "valid" }));
  };
}

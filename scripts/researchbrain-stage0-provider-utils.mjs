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
import { createBraveResearchBrainSourceToolAdapter } from "../src/core/researchbrain-tools.mjs";

/**
 * Applies a known LLM preset short-name to fill in provider/model/api-key-env/base-url defaults.
 */
export function applyResearchBrainLlmPreset(args) {
  if (!args.llmPreset) return args;
  if (args.llmPreset === "opencode_deepseek_v4_pro") {
    return {
      ...args,
      llmProvider: args.llmProvider ?? "openai_compatible",
      llmModel: args.llmModel ?? "deepseek-v4-pro",
      llmApiKeyEnv: args.llmApiKeyEnv ?? "OPENCODE_GO_API_KEY",
      llmBaseUrl: args.llmBaseUrl ?? "https://opencode.ai/zen/go/v1",
      llmBaseUrlEnv: args.llmBaseUrlEnv ?? "OPENCODE_API_BASE_URL"
    };
  }
  if (args.llmPreset === "deepseek_v4_flash_xhigh") {
    return {
      ...args,
      llmProvider: args.llmProvider ?? "deepseek",
      llmModel: args.llmModel ?? "deepseek-v4-flash",
      llmApiKeyEnv: args.llmApiKeyEnv ?? "DEEPSEEK_API_KEY",
      llmMaxTokens: args.llmMaxTokens ?? 8192
    };
  }
  throw new Error(`Unknown ResearchBrain LLM preset: ${args.llmPreset}`);
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
 * Builds a Brave source-tool adapter from CLI-parsed options, or null when no brave source provider is configured.
 */
export function buildResearchBrainSourceToolAdapter(args) {
  if (args.sourceProvider !== "brave") return null;
  return createBraveResearchBrainSourceToolAdapter({
    allowLiveSourceSearch: args.allowLiveSourceSearch === true,
    allowLiveSourceCapture: args.allowLiveSourceCapture === true,
    apiKeyEnv: args.sourceApiKeyEnv ?? "BRAVE_SEARCH_API_KEY",
    maxCaptureBytes: args.sourceMaxBytes ?? 500_000
  });
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
  const allowedTools = args.allowedTools;
  const maxLlmCalls = args.maxLlmCalls ?? 4;
  const maxToolCalls = args.maxToolCalls ?? 20;
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
    if (payload.provider_mode === "live_llm_agent") {
      if (!allowLiveLlm) throw new Error("--allow-live-llm is required for provider_mode live_llm_agent");
      if (!llmProvider || !llmModel) throw new Error("Live LLM agent requires --llm-provider and --llm-model");
      return createLiveResearchBrainAgentProvider({
        llmClient: createResearchBrainLlmClient({
          allowLiveLlm: true,
          provider: llmProvider,
          model: llmModel,
          apiKeyEnv: llmApiKeyEnv,
          baseUrl: llmBaseUrl,
          baseUrlEnv: llmBaseUrlEnv,
          maxTokens: llmMaxTokens
        }),
        allowLiveLlm: true,
        llmProvider,
        llmModel,
        allowedTools,
        maxLlmCalls,
        maxToolCalls,
        maxCostUsd,
        maxTranscriptBytes,
        toolMode: toolMode ?? "live",
        sourceToolAdapter,
        retryPolicy: { sourceToolMaxAttempts, sourceToolRetryDelayMs }
      });
    }
    if (payload.provider_mode === "scripted_agent") {
      return createScriptedResearchBrainAgentProvider({
        script: providerScript ? JSON.parse(fs.readFileSync(providerScript, "utf8")) : [],
        allowedTools,
        maxToolCalls: maxToolCalls ?? 20,
        maxCostUsd: maxCostUsd ?? 0.01,
        maxTranscriptBytes: maxTranscriptBytes ?? 250_000,
        toolMode: toolMode ?? "fixture",
        sourceToolAdapter,
        retryPolicy: { sourceToolMaxAttempts, sourceToolRetryDelayMs }
      });
    }
    if (providerOutput) {
      return createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput });
    }
    return createFixtureResearchBrainProvider({ mode: payload.provider_mode ?? "valid" });
  };
}

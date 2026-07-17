export const RESEARCHBRAIN_LLM_PRESETS = Object.freeze({
  deepseek_v4_flash_xhigh: Object.freeze({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com",
    maxTokens: 8192,
    description: "Direct DeepSeek V4 Flash for normal ResearchBrain discovery runs."
  }),
  deepseek_v4_pro_max: Object.freeze({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com",
    maxTokens: 8192,
    description: "Direct DeepSeek V4 Pro for difficult ResearchBrain runs and review."
  }),
  opencode_deepseek_v4_pro: Object.freeze({
    provider: "openai_compatible",
    model: "deepseek-v4-pro",
    apiKeyEnv: "OPENCODE_GO_API_KEY",
    baseUrl: "https://opencode.ai/zen/go/v1",
    baseUrlEnv: "OPENCODE_API_BASE_URL",
    description: "DeepSeek V4 Pro through OpenCode Go."
  }),
  opencode_go_kimi_xhigh: Object.freeze({
    provider: "openai_compatible",
    model: "kimi-k2.7-code",
    apiKeyEnv: "OPENCODE_GO_API_KEY",
    baseUrl: "https://opencode.ai/zen/go/v1",
    maxTokens: 8192,
    description: "Legacy OpenCode Go Kimi research preset."
  }),
  opencode_go_glm_xhigh: Object.freeze({
    provider: "openai_compatible",
    model: "glm-5.2",
    apiKeyEnv: "OPENCODE_GO_API_KEY",
    baseUrl: "https://opencode.ai/zen/go/v1",
    maxTokens: 8192,
    description: "Legacy OpenCode Go GLM research preset."
  })
});

export function listResearchBrainLlmPresets() {
  return Object.entries(RESEARCHBRAIN_LLM_PRESETS).map(([name, preset]) => ({ name, ...preset }));
}

export function formatResearchBrainLlmPresetHelp() {
  return listResearchBrainLlmPresets()
    .map(({ name, provider, model }) => `${name} (${provider}/${model})`)
    .join(", ");
}

/**
 * Applies one catalog preset while preserving explicit per-run CLI overrides.
 * The catalog is the single source of truth for ResearchBrain provider/model defaults.
 */
export function applyResearchBrainLlmPreset(args) {
  if (!args?.llmPreset) return args;
  const preset = RESEARCHBRAIN_LLM_PRESETS[args.llmPreset];
  if (!preset) throw new Error(`Unknown ResearchBrain LLM preset: ${args.llmPreset}`);
  return {
    ...args,
    llmProvider: args.llmProvider ?? preset.provider,
    llmModel: args.llmModel ?? preset.model,
    llmApiKeyEnv: args.llmApiKeyEnv ?? preset.apiKeyEnv,
    llmBaseUrl: args.llmBaseUrl ?? preset.baseUrl,
    llmBaseUrlEnv: args.llmBaseUrlEnv ?? preset.baseUrlEnv,
    llmMaxTokens: args.llmMaxTokens ?? preset.maxTokens
  };
}

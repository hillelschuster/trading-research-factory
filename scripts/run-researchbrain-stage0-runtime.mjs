#!/usr/bin/env node
import { requireCliNumber, requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import {
  createFixtureResearchBrainProvider,
  createHttpResearchBrainSourceFetcher,
  createJsonFileResearchBrainProvider,
  runResearchBrainStage0Runtime
} from "../src/core/researchbrain-runtime.mjs";
import { createLiveResearchBrainAgentProvider, createScriptedResearchBrainAgentProvider } from "../src/core/researchbrain-agent.mjs";
import { createResearchBrainLlmClient } from "../src/core/researchbrain-llm-providers.mjs";
import { applyResearchBrainLlmPreset, buildResearchBrainSourceToolAdapter, loadResearchBrainCliEnv } from "./researchbrain-stage0-provider-utils.mjs";

function parseArgs(argv) {
  const args = {
    rootDir: process.cwd(),
    providerMode: "valid",
    maxAttempts: 2,
    maxProviderCalls: 2,
    timeoutMs: 30_000,
    maxOutputBytes: 256_000,
    retryDelayMs: 0,
    sourceToolMaxAttempts: 2,
    sourceToolRetryDelayMs: 0,
    sourceAllowedHosts: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = requireCliValue(argv, index++, arg);
    else if (arg === "--request") args.requestPath = requireCliValue(argv, index++, arg);
    else if (arg === "--output-dir") args.outputDir = requireCliValue(argv, index++, arg);
    else if (arg === "--run-id") args.runId = requireCliValue(argv, index++, arg);
    else if (arg === "--observed-at") args.observedAt = requireCliValue(argv, index++, arg);
    else if (arg === "--provider-mode") args.providerMode = requireCliValue(argv, index++, arg);
    else if (arg === "--tool-mode") args.toolMode = requireCliValue(argv, index++, arg);
    else if (arg === "--provider-output") args.providerOutput = requireCliValue(argv, index++, arg);
    else if (arg === "--provider-script") args.providerScript = requireCliValue(argv, index++, arg);
    else if (arg === "--allow-live-llm") args.allowLiveLlm = true;
    else if (arg === "--llm-preset") args.llmPreset = requireCliValue(argv, index++, arg);
    else if (arg === "--llm-provider") args.llmProvider = requireCliValue(argv, index++, arg);
    else if (arg === "--llm-model") args.llmModel = requireCliValue(argv, index++, arg);
    else if (arg === "--llm-api-key-env") args.llmApiKeyEnv = requireCliValue(argv, index++, arg);
    else if (arg === "--llm-base-url-env") args.llmBaseUrlEnv = requireCliValue(argv, index++, arg);
    else if (arg === "--llm-base-url") args.llmBaseUrl = requireCliValue(argv, index++, arg);
    else if (arg === "--llm-max-tokens") args.llmMaxTokens = requireCliNumber(argv, index++, arg);
    else if (arg === "--llm-reasoning-effort") args.llmReasoningEffort = requireCliValue(argv, index++, arg);
    else if (arg === "--max-llm-calls") args.maxLlmCalls = requireCliNumber(argv, index++, arg);
    else if (arg === "--allow-tool") {
      args.allowedTools = args.allowedTools || [];
      args.allowedTools.push(requireCliValue(argv, index++, arg));
    }
    else if (arg === "--max-tool-calls") args.maxToolCalls = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-cost-usd") args.maxCostUsd = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-transcript-bytes") args.maxTranscriptBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--allow-live-source-fetch") args.allowLiveSourceFetch = true;
    else if (arg === "--allow-live-source-search") args.allowLiveSourceSearch = true;
    else if (arg === "--allow-live-source-capture") args.allowLiveSourceCapture = true;
    else if (arg === "--source-provider") args.sourceProvider = requireCliValue(argv, index++, arg);
    else if (arg === "--source-api-key-env") args.sourceApiKeyEnv = requireCliValue(argv, index++, arg);
    else if (arg === "--source-allow-host") args.sourceAllowedHosts.push(requireCliValue(argv, index++, arg));
    else if (arg === "--source-timeout-ms") args.sourceTimeoutMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--source-max-bytes") args.sourceMaxBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--search-allow-provider") {
      args.searchAllowProviders = args.searchAllowProviders || [];
      args.searchAllowProviders.push(requireCliValue(argv, index++, arg));
    }
    else if (arg === "--allow-youtube") args.allowYoutube = true;
    else if (arg === "--allow-unofficial-youtube-transcripts") args.allowUnofficialYoutubeTranscripts = true;
    else if (arg === "--allow-yt-dlp") args.allowYtDlp = true;
    else if (arg === "--allow-youtube-audio-transcription") args.allowYoutubeAudioTranscription = true;
    else if (arg === "--youtube-quota-cap") args.youtubeQuotaCap = requireCliNumber(argv, index++, arg);
    else if (arg === "--youtube-max-duration-sec") args.youtubeMaxDurationSec = requireCliNumber(argv, index++, arg);
    else if (arg === "--youtube-max-transcript-bytes") args.youtubeMaxTranscriptBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--youtube-max-chunks") args.youtubeMaxChunks = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-attempts") args.maxAttempts = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-provider-calls") args.maxProviderCalls = requireCliNumber(argv, index++, arg);
    else if (arg === "--timeout-ms") args.timeoutMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-output-bytes") args.maxOutputBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--retry-delay-ms") args.retryDelayMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--source-tool-max-attempts") args.sourceToolMaxAttempts = requireCliNumber(argv, index++, arg);
    else if (arg === "--source-tool-retry-delay-ms") args.sourceToolRetryDelayMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--allow-output-overwrite-for-tests") args.allowOutputOverwrite = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && !args.requestPath) throw new Error("--request <repo-relative-request.json> is required");
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-runtime.mjs --request <path> [options]",
    "",
    "Runs the bounded Stage-0 ResearchBrain runtime. Default modes are deterministic fixture/test-double only.",
    "It does not call a live LLM by default, execute WFA/MT5, start Phase 8E, mutate official state/evidence/backlog/leaderboard files, or create profitability labels.",
    "Live source HTTP fetch is disabled unless --allow-live-source-fetch and host allowlists are explicit.",
    "",
    "Options:",
    "  --root <path>                 Repository root. Defaults to CWD.",
    "  --request <path>              Repo-relative researchbrain_request_v1 artifact.",
    "  --output-dir <path>           Repo-relative runtime output directory.",
    "  --run-id <id>                 Deterministic runtime run id.",
    "  --observed-at <iso>           Timestamp for generated artifacts.",
    "  --provider-mode <mode>        Fixture provider mode: valid, invalid_json, profitability_label.",
    "  --tool-mode <mode>            Scripted-agent tool mode: fixture or live. Live requires explicit deterministic adapters.",
    "  --provider-output <path>      Repo-local provider-output JSON fixture; overrides --provider-mode.",
    "  --provider-script <path>      Repo-local scripted-agent JSON array; use with --provider-mode scripted_agent.",
    "  --allow-live-llm              Required for --provider-mode live_llm_agent.",
    "  --llm-preset <name>           Presets: deepseek_v4_flash_xhigh uses direct deepseek/deepseek-v4-flash with xhigh reasoning; opencode_deepseek_v4_pro uses OpenCode Zen; opencode_go_kimi_xhigh and opencode_go_glm_xhigh route kimi-k2.7-code / glm-5.2 via OpenCode Go.",
    "  --llm-provider <name>         Live LLM provider name; supports openai_compatible or deepseek.",
    "  --llm-model <name>            Live LLM model id; required for live_llm_agent.",
    "  --llm-api-key-env <name>      API-key environment variable. Defaults by provider.",
    "  --llm-base-url-env <name>     Base URL env var for openai_compatible providers.",
    "  --llm-base-url <url>          Base URL for openai_compatible providers; prefer env outside repo.",
    "  --llm-max-tokens <n>          Per-provider response token cap for the direct adapter.",
    "  --llm-reasoning-effort <name> Optional reasoning effort hint for compatible providers, e.g. max.",
    "  --max-llm-calls <n>           Live LLM turn budget.",
    "  --allow-tool <name>           Allow scripted-agent tool; repeatable. Defaults to v1 catalog.",
    "  --max-tool-calls <n>          Scripted-agent tool-call budget.",
    "  --max-cost-usd <n>            Scripted-agent estimated cost budget.",
    "  --max-transcript-bytes <n>    Scripted-agent transcript byte budget.",
    "  --allow-live-source-fetch     Enable HTTP source fetches referenced by provider output.",
    "  --allow-live-source-search    Enable deterministic source search adapter for live tool mode.",
    "  --allow-live-source-capture   Enable deterministic URL capture adapter for live tool mode.",
    "  --source-provider <name>       Live source provider; currently supports brave.",
    "  --source-api-key-env <name>    Source API-key environment variable. Defaults by provider.",
    "  --search-allow-provider <name> Reserve an allowlisted live search provider name for future adapters.",
    "  --allow-youtube              Reserve explicit YouTube source-tool opt-in for future live adapters.",
    "  --allow-unofficial-youtube-transcripts  Reserve opt-in for unofficial transcript adapters.",
    "  --allow-yt-dlp               Reserve opt-in for yt-dlp subtitle adapters.",
    "  --allow-youtube-audio-transcription  Reserve opt-in for audio transcription adapters.",
    "  --youtube-quota-cap <n>       Reserve YouTube quota cap for future adapters.",
    "  --youtube-max-duration-sec <n> Reserve YouTube max duration cap for future adapters.",
    "  --youtube-max-transcript-bytes <n> Reserve YouTube transcript byte cap for future adapters.",
    "  --youtube-max-chunks <n>      Reserve YouTube chunk cap for future adapters.",
    "  --source-allow-host <host>     Allow one source host; repeatable and required for live fetch.",
    "  --source-timeout-ms <n>        Per-source HTTP timeout in ms.",
    "  --source-max-bytes <n>         Per-source byte cap.",
    "  --max-attempts <n>            Attempt budget, 1-5.",
    "  --max-provider-calls <n>      Provider call budget, 1-10.",
    "  --timeout-ms <n>              Per-call timeout in ms.",
    "  --max-output-bytes <n>        Provider output byte budget.",
    "  --retry-delay-ms <n>          Backoff base delay for retryable provider failures.",
    "  --source-tool-max-attempts <n> Bounded retry attempts for live source search/capture tools.",
    "  --source-tool-retry-delay-ms <n> Backoff base delay for retryable source tool failures.",
    "  --allow-output-overwrite-for-tests  Test-only escape hatch for non-empty output dirs."
  ].join("\n"));
}

try {
  const args = applyResearchBrainLlmPreset(parseArgs(process.argv.slice(2)));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  loadResearchBrainCliEnv({ rootDir: args.rootDir });
  const sourceToolAdapter = buildResearchBrainSourceToolAdapter(args);
  const result = await runResearchBrainStage0Runtime({
    rootDir: args.rootDir,
    requestPath: args.requestPath,
    outputDir: args.outputDir,
    runId: args.runId,
    observedAt: args.observedAt,
    maxAttempts: args.maxAttempts,
    maxProviderCalls: args.maxProviderCalls,
    timeoutMs: args.timeoutMs,
    maxOutputBytes: args.maxOutputBytes,
    retryDelayMs: args.retryDelayMs,
    allowOutputOverwrite: args.allowOutputOverwrite === true,
    sourceFetcher: args.allowLiveSourceFetch ? createHttpResearchBrainSourceFetcher({
      allowLiveFetch: true,
      allowedHosts: args.sourceAllowedHosts,
      timeoutMs: args.sourceTimeoutMs ?? 15_000,
      maxBytes: args.sourceMaxBytes ?? 250_000
    }) : null,
    provider: args.providerMode === "live_llm_agent"
      ? (() => {
        if (args.allowLiveLlm !== true) throw new Error("--provider-mode live_llm_agent requires --allow-live-llm");
        if (!args.llmProvider || !args.llmModel) throw new Error("--provider-mode live_llm_agent requires --llm-provider and --llm-model");
        return createLiveResearchBrainAgentProvider({
          llmClient: createResearchBrainLlmClient({
            allowLiveLlm: true,
            provider: args.llmProvider,
            model: args.llmModel,
            apiKeyEnv: args.llmApiKeyEnv,
            baseUrl: args.llmBaseUrl,
            baseUrlEnv: args.llmBaseUrlEnv,
            maxTokens: args.llmMaxTokens ?? 2048,
            reasoningEffort: args.llmReasoningEffort
          }),
          allowLiveLlm: true,
          llmProvider: args.llmProvider,
          llmModel: args.llmModel,
          allowedTools: args.allowedTools,
          maxLlmCalls: args.maxLlmCalls ?? 12,
          maxToolCalls: args.maxToolCalls ?? 50,
          maxCostUsd: args.maxCostUsd ?? 0.25,
          maxTranscriptBytes: args.maxTranscriptBytes ?? 250_000,
          toolMode: args.toolMode ?? "live",
          sourceToolAdapter,
          retryPolicy: {
            sourceToolMaxAttempts: args.sourceToolMaxAttempts,
            sourceToolRetryDelayMs: args.sourceToolRetryDelayMs
          }
        });
      })()
      : args.providerMode === "scripted_agent"
      ? createScriptedResearchBrainAgentProvider({
        script: args.providerScript ? JSON.parse((await import("node:fs")).readFileSync(args.providerScript, "utf8")) : [],
        allowedTools: args.allowedTools,
        maxToolCalls: args.maxToolCalls ?? 20,
        maxCostUsd: args.maxCostUsd ?? 0.01,
        maxTranscriptBytes: args.maxTranscriptBytes ?? 250_000,
        toolMode: args.toolMode ?? "fixture",
        sourceToolAdapter,
        retryPolicy: {
          sourceToolMaxAttempts: args.sourceToolMaxAttempts,
          sourceToolRetryDelayMs: args.sourceToolRetryDelayMs
        }
      })
      : args.providerOutput
        ? createJsonFileResearchBrainProvider({ rootDir: args.rootDir, outputPath: args.providerOutput })
        : createFixtureResearchBrainProvider({ mode: args.providerMode })
  });
  console.log(JSON.stringify({
    status: result.status,
    evidence_kind: result.evidence_kind,
    authority_layer: result.authority_layer,
    run_id: result.run_id,
    provider: result.provider,
    budget: result.budget,
    run_dir: result.run_dir,
    artifacts_created: result.artifacts_created,
    quarantine_paths: result.quarantine_paths,
    result_artifact: result.result_artifact,
    official_state_mutated: result.official_state_mutated,
    official_evidence_index_mutated: result.official_evidence_index_mutated,
    official_backlog_mutated: result.official_backlog_mutated,
    official_leaderboard_mutated: result.official_leaderboard_mutated,
    profitability_labels_created: result.profitability_labels_created,
    wfa_executed: result.wfa_executed,
    mt5_executed: result.mt5_executed
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

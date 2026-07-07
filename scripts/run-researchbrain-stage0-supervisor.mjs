#!/usr/bin/env node
import { requireCliNumber, requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import { buildResearchBrainStage0SupervisorPreflight, runResearchBrainStage0Supervisor, runResearchBrainStage0SupervisorCycles } from "../src/core/researchbrain-stage0-supervisor.mjs";
import { applyResearchBrainLlmPreset, buildResearchBrainProviderFactory, loadResearchBrainCliEnv } from "./researchbrain-stage0-provider-utils.mjs";

function parseArgs(argv) {
  const args = {
    rootDir: process.cwd(),
    ownerId: `researchbrain-stage0-supervisor-loop-cli-${process.pid}`,
    consumerId: `researchbrain-stage0-supervisor-outbox-cli-${process.pid}`,
    maxJobs: 1,
    leaseMs: 60_000,
    outboxLimit: 25,
    cycles: 1,
    stopOnAttention: true,
    projectionLimit: 5,
    staleLimit: 10,
    failureLimit: 10,
    readinessRequestLimit: 100,
    processedOutboxLimit: 100,
    runtimeConsistencyLimit: 100,
    seedUnseededValid: false,
    autoSeedLimit: 1,
    preflightOnly: false,
    failOnAttention: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = requireCliValue(argv, index++, arg);
    else if (arg === "--db-path") args.dbPath = requireCliValue(argv, index++, arg);
    else if (arg === "--request-path") args.requestPath = requireCliValue(argv, index++, arg);
    else if (arg === "--request-sha256") args.requestSha256 = requireCliValue(argv, index++, arg);
    else if (arg === "--priority") args.priority = requireCliNumber(argv, index++, arg);
    else if (arg === "--seed-status") args.seedStatus = requireCliValue(argv, index++, arg);
    else if (arg === "--provider-mode") args.providerMode = requireCliValue(argv, index++, arg);
    else if (arg === "--output-dir") args.outputDir = requireCliValue(argv, index++, arg);
    else if (arg === "--owner-id") args.ownerId = requireCliValue(argv, index++, arg);
    else if (arg === "--consumer-id") args.consumerId = requireCliValue(argv, index++, arg);
    else if (arg === "--max-jobs") args.maxJobs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-total-jobs") args.maxTotalJobs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-wall-clock-ms") args.maxWallClockMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-terminal-failures") args.maxTerminalFailures = requireCliNumber(argv, index++, arg);
    else if (arg === "--lease-ms") args.leaseMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--outbox-limit") args.outboxLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--cycles") args.cycles = requireCliNumber(argv, index++, arg);
    else if (arg === "--continue-on-attention") args.stopOnAttention = false;
    else if (arg === "--fail-on-attention") args.failOnAttention = true;
    else if (arg === "--projection-dir") args.projectionDir = requireCliValue(argv, index++, arg);
    else if (arg === "--projection-limit") args.projectionLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--stale-limit") args.staleLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--failure-limit") args.failureLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--readiness-request-limit") args.readinessRequestLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--processed-outbox-limit") args.processedOutboxLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--runtime-consistency-limit") args.runtimeConsistencyLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--seed-unseeded-valid") args.seedUnseededValid = true;
    else if (arg === "--auto-seed-limit") args.autoSeedLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--preflight-only") args.preflightOnly = true;
    else if (arg === "--require-live-unattended-safe") args.requireLiveUnattendedSafe = true;
    else if (arg === "--failure-report-dir") args.failureReportDir = requireCliValue(argv, index++, arg);
    else if (arg === "--run-report-dir") args.runReportDir = requireCliValue(argv, index++, arg);
    else if (arg === "--max-attempts") args.maxAttempts = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-provider-calls") args.maxProviderCalls = requireCliNumber(argv, index++, arg);
    else if (arg === "--timeout-ms") args.timeoutMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-output-bytes") args.maxOutputBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--retry-delay-ms") args.retryDelayMs = requireCliNumber(argv, index++, arg);
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
    else if (arg === "--tool-mode") args.toolMode = requireCliValue(argv, index++, arg);
    else if (arg === "--allow-tool") {
      args.allowedTools = args.allowedTools || [];
      args.allowedTools.push(requireCliValue(argv, index++, arg));
    }
    else if (arg === "--max-tool-calls") args.maxToolCalls = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-cost-usd") args.maxCostUsd = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-estimated-live-cost-usd") args.maxEstimatedLiveCostUsd = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-transcript-bytes") args.maxTranscriptBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--allow-live-source-search") args.allowLiveSourceSearch = true;
    else if (arg === "--allow-live-source-capture") args.allowLiveSourceCapture = true;
    else if (arg === "--source-provider") args.sourceProvider = requireCliValue(argv, index++, arg);
    else if (arg === "--source-api-key-env") args.sourceApiKeyEnv = requireCliValue(argv, index++, arg);
    else if (arg === "--source-tool-max-attempts") args.sourceToolMaxAttempts = requireCliNumber(argv, index++, arg);
    else if (arg === "--source-tool-retry-delay-ms") args.sourceToolRetryDelayMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--provider-script") args.providerScript = requireCliValue(argv, index++, arg);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-supervisor.mjs [options]",
    "",
    "Runs one or more bounded ResearchBrain Stage-0 operational cycles: optional seed, loop, outbox projection, diagnostics.",
    "It mutates only runtime-ledger/projection state; it does not mutate official state/evidence/backlog/leaderboard, run WFA/MT5, start Phase 8E, or create profitability labels.",
    "",
    "Options:",
    "  --root <path>                 Repository root. Defaults to CWD.",
    "  --db-path <path>              Optional repo-contained runtime ledger DB path.",
    "  --request-path <path>         Optional existing researchbrain_request_v1 JSON artifact under factory/research/requests/.",
    "  --request-sha256 <sha>        Required with --request-path; expected request artifact SHA-256.",
    "  --priority <n>                Seed priority, -1000 to 1000. Defaults to 0.",
    "  --seed-status <queued|ready>  Initial seed job status. Defaults to queued.",
    "  --provider-mode <mode>        Seeded runtime provider_mode. Defaults to valid.",
    "  --output-dir <path>           Optional repo-relative runtime output directory for seeded job.",
    "  --owner-id <id>               Loop lease owner id.",
    "  --consumer-id <id>            Outbox consumer id.",
    "  --max-jobs <n>                Loop jobs to process, 1-25. Defaults to 1.",
    "  --max-total-jobs <n>          Unattended run cap on jobs processed across all cycles, 1-625. Defaults to cycles*max-jobs.",
    "  --max-wall-clock-ms <n>       Stop before another bounded cycle when elapsed wall-clock reaches this cap.",
    "  --max-terminal-failures <n>   Stop after terminal blocked/poisoned jobs exceed this run-local cap.",
    "  --lease-ms <n>                Loop lease duration, 1000-3600000. Defaults to 60000.",
    "  --outbox-limit <n>            Pending outbox events to consume, 1-100. Defaults to 25.",
    "  --cycles <n>                  Bounded supervisor cycles, 1-25. Defaults to 1.",
    "  --continue-on-attention       Continue cycles after readiness/diagnostics attention instead of stopping early.",
    "  --fail-on-attention           Exit 2 when the JSON result status is attention. Default keeps attention as exit 0.",
    "  --projection-dir <path>       Repo-relative projection output directory.",
    "  --projection-limit <n>        Latest projections in diagnostics, 0-50. Defaults to 5.",
    "  --stale-limit <n>             Stale claims in diagnostics, 0-100. Defaults to 10.",
    "  --failure-limit <n>           Latest failures in diagnostics, 0-100. Defaults to 10.",
    "  --readiness-request-limit <n> Request artifacts scanned in readiness summary, 0-500. Defaults to 100.",
    "  --processed-outbox-limit <n>  Processed outbox rows checked in readiness summary, 1-1000. Defaults to 100.",
    "  --runtime-consistency-limit <n> Final Stage-0 jobs checked for ledger/outbox consistency, 1-1000. Defaults to 100.",
    "  --seed-unseeded-valid       Safely enqueue bounded valid unseeded Stage-0 request artifacts before each cycle.",
    "  --auto-seed-limit <n>        Max valid unseeded request artifacts to enqueue per cycle, 1-25. Defaults to 1.",
    "  --preflight-only             Dry-run readiness/live-provider/auto-seed policy without seeding, executing jobs, or projecting outbox.",
    "  --require-live-unattended-safe Block live queue-drain when live-provider policy has canary-budget warnings, not only hard blockers.",
    "  --failure-report-dir <path>   Optional repo-relative directory for non-authoritative JSON failure reports; also returns JSON failure envelopes for one-cycle failures.",
    "  --run-report-dir <path>       Optional repo-relative directory for non-authoritative JSON supervisor run reports; also returns the run-result envelope for one-cycle runs.",
    "  --max-attempts <n>            Runtime max_attempts default and seed payload override.",
    "  --max-provider-calls <n>      Runtime max_provider_calls default and seed payload override.",
    "  --timeout-ms <n>              Runtime timeout default and seed payload override.",
    "  --max-output-bytes <n>        Runtime max_output_bytes default and seed payload override.",
    "  --retry-delay-ms <n>          Runtime retry_delay_ms default and seed payload override.",
    "",
    "Live LLM Provider Options:",
    "  --allow-live-llm              Required opt-in for live_llm_agent provider_mode.",
    "  --llm-preset <name>           Presets: deepseek_v4_flash_xhigh uses direct deepseek/deepseek-v4-flash with xhigh reasoning; opencode_deepseek_v4_pro uses OpenCode Zen; opencode_go_kimi_xhigh and opencode_go_glm_xhigh route kimi-k2.7-code / glm-5.2 via OpenCode Go.",
    "  --llm-provider <name>         Live LLM provider name; supports openai_compatible or deepseek.",
    "  --llm-model <name>            Live LLM model id; required for live_llm_agent.",
    "  --llm-api-key-env <name>      API-key environment variable. Defaults by provider.",
    "  --llm-base-url-env <name>     Base URL env var for openai_compatible providers.",
    "  --llm-base-url <url>          Base URL for openai_compatible providers; prefer env outside repo.",
    "  --llm-max-tokens <n>          Per-provider response token cap for the direct adapter.",
    "  --llm-reasoning-effort <name> Optional reasoning effort hint for compatible providers, e.g. max.",
    "  --max-llm-calls <n>           Live LLM turn budget.",
    "  --tool-mode <mode>            Agent tool mode: fixture or live. Defaults to live with --allow-live-llm.",
    "  --allow-tool <name>           Allow agent tool; repeatable. Defaults to v1 catalog.",
    "  --max-tool-calls <n>          Agent tool-call budget.",
    "  --max-cost-usd <n>            Agent estimated cost budget.",
    "  --max-estimated-live-cost-usd <n> Fail closed when planned live queue-drain cost estimate exceeds this cap.",
    "  --max-transcript-bytes <n>    Agent transcript byte budget.",
    "",
    "Live Source Provider Options:",
    "  --allow-live-source-search    Enable deterministic source search adapter for live tool mode.",
    "  --allow-live-source-capture   Enable deterministic URL capture adapter for live tool mode.",
    "  --source-provider <name>      Live source provider; currently supports brave.",
    "  --source-api-key-env <name>   Source API-key environment variable. Defaults by provider.",
    "  --source-tool-max-attempts <n> Bounded retry attempts for live source search/capture tools.",
    "  --source-tool-retry-delay-ms <n> Backoff base delay for retryable source tool failures.",
    "",
    "Safe bounded live queue-drain canary profile:",
    "  First run --preflight-only with --seed-unseeded-valid --require-live-unattended-safe --max-estimated-live-cost-usd --max-total-jobs --max-terminal-failures 0,",
    "  --llm-preset deepseek_v4_flash_xhigh --timeout-ms 180000 --max-llm-calls 12 --max-tool-calls 30 --tool-mode live --source-provider brave,",
    "  --allow-live-source-search and --allow-live-source-capture. Inspect operator_command_profile, selected_requests, estimated_cost, blockers, and env presence booleans before any live run."
  ].join("\n"));
}

try {
  const args = applyResearchBrainLlmPreset(parseArgs(process.argv.slice(2)));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  loadResearchBrainCliEnv({ rootDir: args.rootDir });
  if (args.preflightOnly) {
    const result = buildResearchBrainStage0SupervisorPreflight(args);
    console.log(JSON.stringify(result, null, 2));
    if (args.failOnAttention && result.status === "blocked") process.exit(2);
    process.exit(0);
  }
  if (args.providerMode === "live_llm_agent" && args.allowLiveLlm !== true) {
    throw new Error("--provider-mode live_llm_agent requires --allow-live-llm");
  }
  if (args.providerMode === "live_llm_agent" && (!args.llmProvider || !args.llmModel)) {
    throw new Error("--provider-mode live_llm_agent requires --llm-provider and --llm-model or a complete --llm-preset");
  }
  const providerFactory = buildResearchBrainProviderFactory(args);
  const supervisorArgs = providerFactory ? { ...args, providerFactory } : args;
  const guardrailRun = args.maxTotalJobs !== undefined || args.maxWallClockMs !== undefined || args.maxTerminalFailures !== undefined || args.maxEstimatedLiveCostUsd !== undefined;
  const result = args.cycles > 1 || args.failureReportDir || args.runReportDir || guardrailRun
    ? await runResearchBrainStage0SupervisorCycles(supervisorArgs)
    : await runResearchBrainStage0Supervisor(supervisorArgs);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exit(1);
  if (args.failOnAttention && result.status === "attention") process.exit(2);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

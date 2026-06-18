#!/usr/bin/env node
import { requireCliNumber, requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import { seedResearchBrainStage0Job } from "../src/core/researchbrain-stage0-job-seeder.mjs";

function parseArgs(argv) {
  const args = {
    rootDir: process.cwd(),
    priority: 0,
    status: "queued",
    providerMode: "valid"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = requireCliValue(argv, index++, arg);
    else if (arg === "--db-path") args.dbPath = requireCliValue(argv, index++, arg);
    else if (arg === "--request-path") args.requestPath = requireCliValue(argv, index++, arg);
    else if (arg === "--request-sha256") args.requestSha256 = requireCliValue(argv, index++, arg);
    else if (arg === "--priority") args.priority = requireCliNumber(argv, index++, arg);
    else if (arg === "--status") args.status = requireCliValue(argv, index++, arg);
    else if (arg === "--provider-mode") args.providerMode = requireCliValue(argv, index++, arg);
    else if (arg === "--output-dir") args.outputDir = requireCliValue(argv, index++, arg);
    else if (arg === "--max-attempts") args.maxAttempts = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-provider-calls") args.maxProviderCalls = requireCliNumber(argv, index++, arg);
    else if (arg === "--timeout-ms") args.timeoutMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-output-bytes") args.maxOutputBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--retry-delay-ms") args.retryDelayMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-job-seeder.mjs --request-path <path> --request-sha256 <sha> [options]",
    "",
    "Seeds one runtime-ledger researchbrain_stage0 job from an existing request artifact.",
    "The request must be a repo-relative JSON artifact under factory/research/requests/ and the supplied SHA-256 must match the file.",
    "It mutates only the runtime ledger; it does not mutate official state/evidence/backlog/leaderboard, run WFA/MT5, start Phase 8E, or create profitability labels.",
    "",
    "Options:",
    "  --root <path>                 Repository root. Defaults to CWD.",
    "  --db-path <path>              Optional repo-contained runtime ledger DB path.",
    "  --request-path <path>         Existing repo-relative researchbrain_request_v1 JSON artifact.",
    "  --request-sha256 <sha>        Expected SHA-256 of the request artifact. Required.",
    "  --priority <n>                Ledger priority, -1000 to 1000. Defaults to 0.",
    "  --status <queued|ready>       Initial job status. Defaults to queued.",
    "  --provider-mode <mode>        Runtime provider_mode payload default. Defaults to valid.",
    "  --output-dir <path>           Optional repo-relative runtime output directory.",
    "  --max-attempts <n>            Optional runtime max_attempts payload override.",
    "  --max-provider-calls <n>      Optional runtime max_provider_calls payload override.",
    "  --timeout-ms <n>              Optional runtime timeout_ms payload override.",
    "  --max-output-bytes <n>        Optional runtime max_output_bytes payload override.",
    "  --retry-delay-ms <n>          Optional runtime retry_delay_ms payload override."
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = seedResearchBrainStage0Job(args);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

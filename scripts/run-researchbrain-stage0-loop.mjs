#!/usr/bin/env node
import { requireCliNumber, requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import { runResearchBrainStage0Loop } from "../src/core/researchbrain-loop-runner.mjs";

function parseArgs(argv) {
  const args = {
    rootDir: process.cwd(),
    ownerId: `researchbrain-stage0-loop-cli-${process.pid}`,
    maxJobs: 1,
    leaseMs: 60_000,
    runtimeDefaults: {}
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = requireCliValue(argv, index++, arg);
    else if (arg === "--db-path") args.dbPath = requireCliValue(argv, index++, arg);
    else if (arg === "--owner-id") args.ownerId = requireCliValue(argv, index++, arg);
    else if (arg === "--max-jobs") args.maxJobs = requireCliNumber(argv, index++, arg);
    else if (arg === "--lease-ms") args.leaseMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-attempts") args.runtimeDefaults.maxAttempts = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-provider-calls") args.runtimeDefaults.maxProviderCalls = requireCliNumber(argv, index++, arg);
    else if (arg === "--timeout-ms") args.runtimeDefaults.timeoutMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--max-output-bytes") args.runtimeDefaults.maxOutputBytes = requireCliNumber(argv, index++, arg);
    else if (arg === "--retry-delay-ms") args.runtimeDefaults.retryDelayMs = requireCliNumber(argv, index++, arg);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-loop.mjs [options]",
    "",
    "Claims queued researchbrain_stage0 jobs from the runtime ledger and runs the bounded Stage-0 runtime.",
    "It mirrors runtime status/artifacts into the runtime ledger only; it does not mutate official state/evidence/backlog/leaderboard, run WFA/MT5, start Phase 8E, or create profitability labels.",
    "",
    "Options:",
    "  --root <path>              Repository root. Defaults to CWD.",
    "  --db-path <path>           Optional repo-contained runtime ledger DB path.",
    "  --owner-id <id>            Lease owner id.",
    "  --max-jobs <n>             Number of jobs to process, 1-100. Defaults to 1.",
    "  --lease-ms <n>             Lease duration, 1000-3600000. Defaults to 60000.",
    "  --max-attempts <n>         Runtime attempt default for jobs without payload override.",
    "  --max-provider-calls <n>   Runtime provider-call default for jobs without payload override.",
    "  --timeout-ms <n>           Runtime provider timeout default.",
    "  --max-output-bytes <n>     Runtime output byte default.",
    "  --retry-delay-ms <n>       Runtime retry backoff base default."
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = await runResearchBrainStage0Loop(args);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

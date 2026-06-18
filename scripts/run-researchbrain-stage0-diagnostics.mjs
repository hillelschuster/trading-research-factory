#!/usr/bin/env node
import { requireCliNumber, requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import { buildResearchBrainStage0Diagnostics } from "../src/core/researchbrain-stage0-diagnostics.mjs";

function parseArgs(argv) {
  const args = {
    rootDir: process.cwd(),
    projectionLimit: 5,
    staleLimit: 10,
    failureLimit: 10
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = requireCliValue(argv, index++, arg);
    else if (arg === "--db-path") args.dbPath = requireCliValue(argv, index++, arg);
    else if (arg === "--job-type") args.jobType = requireCliValue(argv, index++, arg);
    else if (arg === "--event-type") args.eventType = requireCliValue(argv, index++, arg);
    else if (arg === "--projection-dir") args.projectionDir = requireCliValue(argv, index++, arg);
    else if (arg === "--projection-limit") args.projectionLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--stale-limit") args.staleLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--failure-limit") args.failureLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-diagnostics.mjs [options]",
    "",
    "Summarizes unattended ResearchBrain Stage-0 runtime-ledger operations.",
    "Reports job status counts, stale claims, attempts, outbox pending/processed counts, and latest projection artifacts.",
    "It does not mutate official state/evidence/backlog/leaderboard, run WFA/MT5, start Phase 8E, or create profitability labels.",
    "",
    "Options:",
    "  --root <path>                 Repository root. Defaults to CWD.",
    "  --db-path <path>              Optional repo-contained runtime ledger DB path.",
    "  --job-type <type>             Ledger job type. Defaults to researchbrain_stage0.",
    "  --event-type <type>           Outbox event type. Defaults to researchbrain.stage0_job_finished.",
    "  --projection-dir <path>       Repo-relative projection directory.",
    "  --projection-limit <n>        Latest projection artifacts to cite, 0-50. Defaults to 5.",
    "  --stale-limit <n>             Stale claimed jobs to list, 0-100. Defaults to 10.",
    "  --failure-limit <n>           Blocked/poisoned attempts to summarize, 0-100. Defaults to 10."
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = buildResearchBrainStage0Diagnostics(args);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

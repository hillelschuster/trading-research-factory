#!/usr/bin/env node
import { requireCliNumber, requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import { consumeResearchBrainStage0Outbox } from "../src/core/researchbrain-stage0-outbox-consumer.mjs";

function parseArgs(argv) {
  const args = {
    rootDir: process.cwd(),
    consumerId: `researchbrain-stage0-outbox-consumer-cli-${process.pid}`,
    limit: 25
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = requireCliValue(argv, index++, arg);
    else if (arg === "--db-path") args.dbPath = requireCliValue(argv, index++, arg);
    else if (arg === "--consumer-id") args.consumerId = requireCliValue(argv, index++, arg);
    else if (arg === "--limit") args.limit = requireCliNumber(argv, index++, arg);
    else if (arg === "--output-dir") args.outputDir = requireCliValue(argv, index++, arg);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-outbox-consumer.mjs [options]",
    "",
    "Consumes pending researchbrain.stage0_job_finished runtime-ledger outbox events.",
    "Writes bounded diagnostic projections under factory/runtime/projections/researchbrain-stage0 and marks events processed idempotently.",
    "It does not mutate official state/evidence/backlog/leaderboard, run WFA/MT5, start Phase 8E, or create profitability labels.",
    "",
    "Options:",
    "  --root <path>             Repository root. Defaults to CWD.",
    "  --db-path <path>          Optional repo-contained runtime ledger DB path.",
    "  --consumer-id <id>        Outbox consumer id.",
    "  --limit <n>               Pending events to consume, 1-100. Defaults to 25.",
    "  --output-dir <path>       Repo-relative projection output directory."
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = consumeResearchBrainStage0Outbox(args);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

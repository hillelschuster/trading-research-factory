#!/usr/bin/env node
import { requireCliNumber, requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import { buildResearchBrainStage0ReadinessReport, writeResearchBrainStage0ReadinessReport } from "../src/core/researchbrain-stage0-readiness.mjs";

function parseArgs(argv) {
  const args = {
    rootDir: process.cwd(),
    requestLimit: 100,
    projectionLimit: 5,
    staleLimit: 10,
    failureLimit: 10,
    processedOutboxLimit: 100,
    runtimeConsistencyLimit: 100,
    write: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = requireCliValue(argv, index++, arg);
    else if (arg === "--db-path") args.dbPath = requireCliValue(argv, index++, arg);
    else if (arg === "--request-dir") args.requestDir = requireCliValue(argv, index++, arg);
    else if (arg === "--request-limit") args.requestLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--projection-dir") args.projectionDir = requireCliValue(argv, index++, arg);
    else if (arg === "--projection-limit") args.projectionLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--stale-limit") args.staleLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--failure-limit") args.failureLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--processed-outbox-limit") args.processedOutboxLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--runtime-consistency-limit") args.runtimeConsistencyLimit = requireCliNumber(argv, index++, arg);
    else if (arg === "--write") args.write = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-readiness.mjs [options]",
    "",
    "Builds a read-only ResearchBrain Stage-0 operations readiness report from diagnostics, request artifacts, seeded jobs, projection health, and runtime consistency checks.",
    "By default it prints JSON only. With --write it writes a non-authoritative artifact under factory/verification/.",
    "It does not mutate official state/evidence/backlog/leaderboard, run WFA/MT5, start Phase 8E, or create profitability labels.",
    "",
    "Options:",
    "  --root <path>              Repository root. Defaults to CWD.",
    "  --db-path <path>           Optional repo-contained runtime ledger DB path.",
    "  --request-dir <path>       Repo-relative request artifact directory. Defaults to factory/research/requests.",
    "  --request-limit <n>        Request artifacts to scan, 0-500. Defaults to 100.",
    "  --projection-dir <path>    Repo-relative projection directory.",
    "  --projection-limit <n>     Latest projections in diagnostics, 0-50. Defaults to 5.",
    "  --stale-limit <n>          Stale claims in diagnostics, 0-100. Defaults to 10.",
    "  --failure-limit <n>        Latest failures in diagnostics, 0-100. Defaults to 10.",
    "  --processed-outbox-limit <n> Processed outbox rows to verify, 1-1000. Defaults to 100.",
    "  --runtime-consistency-limit <n> Final Stage-0 jobs to check for ledger/outbox consistency, 1-1000. Defaults to 100.",
    "  --write                    Write report under factory/verification/."
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const report = buildResearchBrainStage0ReadinessReport(args);
  if (args.write) {
    const write = writeResearchBrainStage0ReadinessReport(args.rootDir, report);
    console.log(JSON.stringify({ path: write.path, sha256: write.sha256, report }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

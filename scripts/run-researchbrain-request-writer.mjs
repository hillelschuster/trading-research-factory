#!/usr/bin/env node
import { writeResearchBrainRequestArtifact } from "../src/core/researchbrain-artifacts.mjs";

function parseJsonArray(value, label) {
  if (value === undefined || value === null) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be a valid JSON array: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArgs(argv) {
  const args = { rootDir: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.rootDir = argv[++index];
    else if (arg === "--output-dir") args.outputDir = argv[++index];
    else if (arg === "--request-id") args.requestId = argv[++index];
    else if (arg === "--observed-at") args.observedAt = argv[++index];
    else if (arg === "--question") args.researchQuestion = argv[++index];
    else if (arg === "--market-scope") args.marketScope = argv[++index];
    else if (arg === "--universe-snapshot") args.universeSnapshotPath = argv[++index];
    else if (arg === "--terminal-inventory") args.terminalInventoryPath = argv[++index];
    else if (arg === "--max-sources") args.maxSources = Number(argv[++index]);
    else if (arg === "--max-hypotheses") args.maxHypotheses = Number(argv[++index]);
    else if (arg === "--prior-failed-patterns-json") args.priorFailedPatterns = parseJsonArray(argv[++index], "prior_failed_patterns");
    else if (arg === "--prior-lessons-json") args.priorLessons = parseJsonArray(argv[++index], "prior_lessons");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-request-writer.mjs [options]",
    "",
    "Writes a deterministic Stage-0 ResearchBrain request artifact only. It does not",
    "run web search, call an LLM, create hypotheses, or mutate official state/evidence.",
    "",
    "Options:",
    "  --root <path>                      Repository root. Defaults to CWD.",
    "  --request-id <id>                  Deterministic request id.",
    "  --observed-at <iso>                Timestamp for generated_at.",
    "  --output-dir <path>                Repo-relative output directory.",
    "  --question <text>                  Research question.",
    "  --market-scope <text>              Market scope.",
    "  --universe-snapshot <path>         Phase 8A universe snapshot path.",
    "  --terminal-inventory <path>        Phase 8A terminal inventory path.",
    "  --max-sources <n>                  Source budget, 1-25.",
    "  --max-hypotheses <n>               Hypothesis budget, 1-10.",
    "  --prior-failed-patterns-json <arr> Prior failed-pattern array.",
    "  --prior-lessons-json <arr>         Prior lesson array."
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = writeResearchBrainRequestArtifact(args);
  console.log(JSON.stringify({
    status: result.status,
    evidence_kind: result.evidence_kind,
    authority_layer: result.authority_layer,
    request_id: result.request.request_id,
    artifact: result.artifact,
    phase8a_universe_constraints: result.request.phase8a_universe_constraints,
    max_sources: result.request.max_sources,
    max_hypotheses: result.request.max_hypotheses
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

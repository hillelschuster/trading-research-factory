#!/usr/bin/env node
import { requireCliValue } from "./researchbrain-stage0-cli-args.mjs";
import { writeResearchBrainStage0Manifest } from "../src/core/researchbrain-artifacts.mjs";

function parseArgs(argv) {
  const args = { rootDir: process.cwd(), outputDir: null, artifactPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      args.rootDir = requireCliValue(argv, index++, arg);
    } else if (arg === "--output-dir") {
      args.outputDir = requireCliValue(argv, index++, arg);
    } else if (arg === "--manifest-id") {
      args.manifestId = requireCliValue(argv, index++, arg);
    } else if (arg === "--observed-at") {
      args.observedAt = requireCliValue(argv, index++, arg);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      args.artifactPaths.push(arg);
    }
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage: node scripts/run-researchbrain-stage0-manifest.mjs [options] [artifact paths...]",
    "",
    "Options:",
    "  --root <path>          Repository root. Defaults to current working directory.",
    "  --output-dir <path>    Repo-relative output directory for manifest.json.",
    "  --manifest-id <id>     Deterministic manifest id.",
    "  --observed-at <iso>    Timestamp to record in generated_at.",
    "",
    "When no artifact paths are supplied, the script scans factory/research/**/*.json and",
    "indexes only supported Stage-0 ResearchBrain artifact schemas. It does not run live",
    "research and does not mutate official state, evidence, backlog, or leaderboard files."
  ].join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = writeResearchBrainStage0Manifest({
    rootDir: args.rootDir,
    outputDir: args.outputDir,
    observedAt: args.observedAt,
    manifestId: args.manifestId,
    artifactPaths: args.artifactPaths.length > 0 ? args.artifactPaths : null
  });
  console.log(JSON.stringify({
    status: result.status,
    evidence_kind: result.evidence_kind,
    authority_layer: result.authority_layer,
    artifact: result.artifact,
    artifact_counts: result.manifest.artifact_counts
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

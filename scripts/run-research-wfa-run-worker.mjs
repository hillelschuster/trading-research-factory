#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { runResearchWfaRunWorker, validateResearchWfaRunRequest } from "../src/workers/research-wfa-run-worker.mjs";
import { validateExecutionArtifacts, validateExecutionResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";

function usage() {
  return "Usage: npm run wfa:run -- <request.json> [--root <repo-root>]";
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const requestPath = args.find((arg, index) => index === 0 && !arg.startsWith("--")) ?? valueAfter(args, "--request");

if (!requestPath) {
  console.error(usage());
  process.exit(2);
}

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
validateResearchWfaRunRequest(request, { rootDir });
const result = runResearchWfaRunWorker({ rootDir, request });
validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: result.status === "executed", evidenceKind: "research_wfa" });
validateExecutionResult(result);
validateExecutionArtifacts(rootDir, result);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "executed" ? 0 : 2);

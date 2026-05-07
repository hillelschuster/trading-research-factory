#!/usr/bin/env node
import process from "node:process";
import { runMt5FileCommonSmokeWorker } from "../src/workers/mt5-file-common-smoke-worker.mjs";
import { validateExecutionArtifacts, validateExecutionResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const result = runMt5FileCommonSmokeWorker({
  rootDir,
  experimentId: valueAfter(args, "--experiment-id") ?? "EXP-MT5-BRIDGE-SMOKE",
  runId: valueAfter(args, "--run-id"),
  jobId: valueAfter(args, "--job-id")
});

validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: true, evidenceKind: "mt5_bridge_smoke" });
validateExecutionResult(result);
validateExecutionArtifacts(rootDir, result);
console.log(JSON.stringify(result, null, 2));

#!/usr/bin/env node
import process from "node:process";
import { runMt5TesterLifecycleWorker } from "../src/workers/mt5-tester-lifecycle-worker.mjs";
import { validateExecutionArtifacts, validateExecutionResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const result = runMt5TesterLifecycleWorker({
  rootDir,
  experimentId: valueAfter(args, "--experiment-id") ?? "EXP-MT5-TESTER-LIFECYCLE",
  runId: valueAfter(args, "--run-id"),
  jobId: valueAfter(args, "--job-id"),
  symbol: valueAfter(args, "--symbol"),
  timeframe: valueAfter(args, "--timeframe"),
  testerOutputPath: valueAfter(args, "--tester-output")
});

validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: false, evidenceKind: "mt5_tester" });
validateExecutionResult(result);
validateExecutionArtifacts(rootDir, result);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "executed" ? 0 : 2);

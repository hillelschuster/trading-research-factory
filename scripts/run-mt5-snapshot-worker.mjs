#!/usr/bin/env node
import process from "node:process";
import { runMt5SnapshotWorker } from "../src/workers/mt5-snapshot-worker.mjs";
import { validateExecutionArtifacts, validateExecutionResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function integerAfter(args, name) {
  const value = valueAfter(args, name);
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : value;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const result = runMt5SnapshotWorker({
  rootDir,
  experimentId: valueAfter(args, "--experiment-id") ?? "EXP-MT5-SNAPSHOT",
  runId: valueAfter(args, "--run-id"),
  jobId: valueAfter(args, "--job-id"),
  symbol: valueAfter(args, "--symbol"),
  timeframe: valueAfter(args, "--timeframe"),
  bars: integerAfter(args, "--bars"),
  snapshotMode: valueAfter(args, "--snapshot-mode") ?? "symbol",
  universeScope: valueAfter(args, "--universe-scope"),
  universeFilterPattern: valueAfter(args, "--universe-filter-pattern"),
  login: integerAfter(args, "--login"),
  server: valueAfter(args, "--server"),
  terminalPath: valueAfter(args, "--terminal-path"),
  pythonCommand: valueAfter(args, "--python") ?? (process.platform === "win32" ? "python" : "python3")
});

validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: false, evidenceKind: result.evidence_kind });
validateExecutionResult(result);
validateExecutionArtifacts(rootDir, result);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "executed" ? 0 : 2);

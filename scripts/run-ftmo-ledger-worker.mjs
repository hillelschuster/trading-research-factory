#!/usr/bin/env node
import process from "node:process";
import { runFtmoLedgerWorker } from "../src/workers/ftmo-ledger-worker.mjs";
import { validateExecutionArtifacts, validateExecutionResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const result = runFtmoLedgerWorker({ rootDir, experimentId: valueAfter(args, "--experiment-id") ?? "EXP-FTMO-LEDGER", runId: valueAfter(args, "--run-id"), jobId: valueAfter(args, "--job-id"), ruleSetPath: valueAfter(args, "--rule-set"), ledgerPath: valueAfter(args, "--ledger") });

validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: false, evidenceKind: "ftmo_ledger" });
validateExecutionResult(result);
validateExecutionArtifacts(rootDir, result);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "executed" ? 0 : 2);

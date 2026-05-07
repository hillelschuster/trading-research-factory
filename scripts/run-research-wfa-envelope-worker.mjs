#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { runResearchWfaEnvelopeWorker } from "../src/workers/research-wfa-envelope-worker.mjs";
import { validateExecutionArtifacts, validateExecutionResult, validateWorkerResultEnvelope } from "../src/core/validators.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function valuesAfter(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const metricsPath = valueAfter(args, "--metrics-json");
const metricsObserved = metricsPath ? JSON.parse(fs.readFileSync(metricsPath, "utf8")) : null;
const windowsValue = valueAfter(args, "--windows-completed");
const result = runResearchWfaEnvelopeWorker({
  rootDir,
  experimentId: valueAfter(args, "--experiment-id"),
  runId: valueAfter(args, "--run-id"),
  jobId: valueAfter(args, "--job-id"),
  candidateId: valueAfter(args, "--candidate-id"),
  executionResultPath: valueAfter(args, "--execution-result"),
  configPath: valueAfter(args, "--config-path"),
  resultArtifacts: valuesAfter(args, "--result-artifact"),
  metricsObserved,
  windowsCompleted: windowsValue ? Number(windowsValue) : null
});

validateWorkerResultEnvelope(result.worker_result, { requireSucceeded: result.status === "executed", evidenceKind: "research_wfa" });
validateExecutionResult(result);
validateExecutionArtifacts(rootDir, result);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "executed" ? 0 : 2);

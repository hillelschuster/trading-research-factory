#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readJson } from "../src/core/fs-utils.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { appendFailedParityPattern, buildCandidatePromotionGate, buildFailedParityPatternRecord, updateCandidateManifestWithGate, writeCandidatePromotionGate } from "../src/core/verification.mjs";
import { validatePromotionGate } from "../src/core/validators.mjs";

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    if (["evidence-result", "evidence-path"].includes(key)) {
      args[key] = [...(Array.isArray(args[key]) ? args[key] : []), next];
    } else {
      args[key] = next;
    }
    index += 1;
  }
  return args;
}

function repoRelative(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function readRepoJson(paths, repoRelativePath) {
  if (!repoRelativePath) return null;
  const fullPath = path.join(paths.root, repoRelativePath);
  return readJson(fullPath, null);
}

export function runCandidatePromotionGate({
  rootDir = process.cwd(),
  candidateId,
  runId,
  targetContext = "research",
  adapterName = null,
  evidenceResultPaths = [],
  evidencePaths = [],
  parityReportPath = null,
  updateManifest = true,
  recordFailedParity = true
} = {}) {
  const paths = buildPaths(rootDir);
  const evidenceResults = evidenceResultPaths.map((item) => readRepoJson(paths, item)).filter(Boolean);
  const parityReport = parityReportPath ? readRepoJson(paths, parityReportPath) : null;
  const gate = buildCandidatePromotionGate({
    runId,
    candidateId,
    targetContext,
    adapterName,
    evidenceResults,
    parityReport,
    evidencePaths: [...evidenceResultPaths, ...(parityReportPath ? [parityReportPath] : []), ...evidencePaths]
  });
  validatePromotionGate(gate);

  const gateWrite = writeCandidatePromotionGate(paths, gate);
  const manifestUpdate = updateManifest ? updateCandidateManifestWithGate(paths, gateWrite) : { path: null, updated: false, reason: "manifest update disabled" };
  let failedParityMemory = null;
  if (recordFailedParity && parityReport && gate.decision === "denied" && parityReport.decision !== "pass") {
    const record = buildFailedParityPatternRecord({ parityReport, gate, evidencePaths: [repoRelative(paths, gateWrite.path)] });
    const memoryWrite = appendFailedParityPattern(paths, record);
    failedParityMemory = { path: repoRelative(paths, memoryWrite.path), record };
  }

  return {
    schema_version: "candidate_promotion_gate_run_v1",
    status: gate.decision === "allowed" ? "allowed" : "denied",
    candidate_id: candidateId,
    target_context: targetContext,
    gate_path: repoRelative(paths, gateWrite.path),
    manifest_update: manifestUpdate,
    failed_parity_memory: failedParityMemory,
    gate
  };
}

if (IS_MAIN) {
  const args = parseArgs(process.argv.slice(2));
  const result = runCandidatePromotionGate({
    rootDir: args.root ?? process.cwd(),
    candidateId: args["candidate-id"],
    runId: args["run-id"],
    targetContext: args["target-context"] ?? "research",
    adapterName: args["adapter-name"] ?? null,
    evidenceResultPaths: Array.isArray(args["evidence-result"]) ? args["evidence-result"] : [],
    evidencePaths: Array.isArray(args["evidence-path"]) ? args["evidence-path"] : [],
    parityReportPath: args["parity-report"] ?? null,
    updateManifest: args["update-manifest"] !== "false",
    recordFailedParity: args["record-failed-parity"] !== "false"
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "allowed" ? 0 : 2);
}

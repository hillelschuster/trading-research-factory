#!/usr/bin/env node
import process from "node:process";
import { buildPhase8DExitReadinessReport, writePhase8DExitReadinessReport } from "../src/core/phase8d-exit-readiness.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const report = buildPhase8DExitReadinessReport({ rootDir });
const write = writePhase8DExitReadinessReport(rootDir, report);

console.log(JSON.stringify({ path: write.path, report: write.payload }, null, 2));
process.exit(write.payload.status === "ready_to_close" ? 0 : 2);

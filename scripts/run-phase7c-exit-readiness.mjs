#!/usr/bin/env node
import process from "node:process";
import { buildPhase7CExitReadinessReport, writePhase7CExitReadinessReport } from "../src/core/phase7c-exit-readiness.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const report = buildPhase7CExitReadinessReport({ rootDir });
const write = writePhase7CExitReadinessReport(rootDir, report);

console.log(JSON.stringify({ path: write.path, report }, null, 2));
process.exit(report.status === "ready_to_close" ? 0 : 2);

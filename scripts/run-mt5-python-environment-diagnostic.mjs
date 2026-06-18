#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION,
  writeMt5PythonEnvironmentDiagnosticFromRequest
} from "../src/core/mt5-environment-diagnostic.mjs";

function usage() {
  return "Usage: node scripts/run-mt5-python-environment-diagnostic.mjs [--request <repo-relative-request.json>] [--root <repo-root>]";
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (!repoRelativePath || path.isAbsolute(repoRelativePath)) throw new Error(`Request path must be repo-relative: ${String(repoRelativePath)}`);
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Request path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const requestPath = valueAfter(args, "--request");

if (args.includes("--help")) {
  console.log(usage());
  process.exit(0);
}

try {
  const request = requestPath
    ? JSON.parse(fs.readFileSync(resolveRepoRelativePath(rootDir, requestPath), "utf8"))
    : { schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION };
  const result = writeMt5PythonEnvironmentDiagnosticFromRequest({ rootDir, request });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "ready" ? 0 : 2);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}

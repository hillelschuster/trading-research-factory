#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { writeMt5InstrumentEquivalenceFromRequest } from "../src/core/mt5-instrument-equivalence.mjs";

function usage() {
  return "Usage: node scripts/run-mt5-instrument-equivalence.mjs --request <repo-relative-request.json> [--root <repo-root>]";
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

if (!requestPath) {
  console.error(usage());
  process.exit(2);
}

try {
  const fullRequestPath = resolveRepoRelativePath(rootDir, requestPath);
  const request = JSON.parse(fs.readFileSync(fullRequestPath, "utf8"));
  const result = writeMt5InstrumentEquivalenceFromRequest({ rootDir, request });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}

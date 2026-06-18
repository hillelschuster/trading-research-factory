#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runBinanceUsdmFundingRefreshRequest } from "../src/workers/binance-usdm-funding-data-readiness-worker.mjs";

function usage() {
  return [
    "Usage: npm run data:binance-funding-refresh -- --request <repo-relative-request.json> [--root <repo-root>]",
    "The request must declare mode fixture_input or live_fetch. live_fetch requires live_fetch_allowed: true."
  ].join("\n");
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const requestPath = valueAfter(args, "--request");

if (!requestPath) {
  console.error(usage());
  process.exit(2);
}

try {
  const root = path.resolve(rootDir);
  const fullRequestPath = path.resolve(root, requestPath);
  const relative = path.relative(root, fullRequestPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refresh request path escapes repository root: ${requestPath}`);
  const request = JSON.parse(fs.readFileSync(fullRequestPath, "utf8"));
  const result = await runBinanceUsdmFundingRefreshRequest({ rootDir, request });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "ready" ? 0 : 2);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}

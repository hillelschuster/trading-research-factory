#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { buildBinanceUsdmFundingDataReadiness, runBinanceUsdmFundingDataReadiness } from "../src/workers/binance-usdm-funding-data-readiness-worker.mjs";

function usage() {
  return [
    "Usage: npm run data:binance-funding -- --symbol <SYMBOL> (--input <rows.json|rows.jsonl> | --live) [--root <repo-root>] [--start <time>] [--end <time>] [--limit <1-1000>] [--output-dir <repo-path>]",
    "Live fetches are opt-in only via --live; tests and fixture runs should use --input."
  ].join("\n");
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseRawRows(inputPath) {
  const text = fs.readFileSync(inputPath, "utf8").trim();
  if (!text) throw new Error("Binance USD-M funding input file is empty.");
  if (text.startsWith("[")) return JSON.parse(text);
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const symbol = valueAfter(args, "--symbol");
const inputPath = valueAfter(args, "--input");
const live = hasFlag(args, "--live");
const outputDir = valueAfter(args, "--output-dir");

if (!symbol || (inputPath && live) || (!inputPath && !live)) {
  console.error(usage());
  process.exit(2);
}

try {
  const result = inputPath
    ? buildBinanceUsdmFundingDataReadiness({
      rootDir,
      symbol,
      rawRows: parseRawRows(inputPath),
      outputDir
    })
    : await runBinanceUsdmFundingDataReadiness({
      rootDir,
      symbol,
      startTime: valueAfter(args, "--start"),
      endTime: valueAfter(args, "--end"),
      limit: valueAfter(args, "--limit") ?? 1000,
      outputDir
    });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "ready" ? 0 : 2);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}

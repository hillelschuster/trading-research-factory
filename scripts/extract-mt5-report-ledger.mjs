#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) {
    throw new Error(`Path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

function decodeReport(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 128));
  let oddNulls = 0;
  for (let index = 1; index < sample.length; index += 2) {
    if (sample[index] === 0) oddNulls++;
  }
  return oddNulls > sample.length / 8 ? buffer.toString("utf16le") : buffer.toString("utf8");
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function parseNumber(value) {
  const normalized = String(value).replace(/\u2212/g, "-").replace(/[\s\u00a0]/g, "").replace(/,/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Unable to parse numeric MT5 report value: ${value}`);
  return parsed;
}

function parseMt5ReportTime(value) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Unable to parse MT5 report timestamp: ${value}`);
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

export function extractMt5ReportLedger({ rootDir = process.cwd(), reportPath, lifecyclePath, outputPath, currency, sourceJobId, createdAt = new Date().toISOString() }) {
  if (!reportPath) throw new Error("--report is required");
  if (!lifecyclePath) throw new Error("--lifecycle is required");
  if (!outputPath) throw new Error("--output is required");
  if (!currency) throw new Error("--currency is required");

  const reportFullPath = resolveRepoRelativePath(rootDir, reportPath);
  const lifecycleFullPath = resolveRepoRelativePath(rootDir, lifecyclePath);
  const outputFullPath = resolveRepoRelativePath(rootDir, outputPath);
  const html = decodeReport(fs.readFileSync(reportFullPath));
  const dealsIndex = html.indexOf("<b>Deals</b>");
  if (dealsIndex < 0) throw new Error("MT5 report Deals section was not found");
  const dealsSection = html.slice(dealsIndex);
  const rows = [...dealsSection.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => stripHtml(cell[1])));

  let startingBalance = null;
  let initialBalanceDeal = null;
  const events = [];
  for (const cells of rows) {
    if (cells.length !== 13 || !/^\d+$/.test(cells[1])) continue;
    const [time, deal, symbol, type, direction, volume, price, order, commission, swap, profit, balance, comment] = cells;
    if (type === "balance") {
      startingBalance = parseNumber(balance);
      initialBalanceDeal = { time, deal, balance: startingBalance };
      continue;
    }
    events.push({
      timestamp: parseMt5ReportTime(time),
      realized_pnl: parseNumber(profit),
      floating_pnl: 0,
      commission: parseNumber(commission),
      swap: parseNumber(swap),
      source: {
        report: "mt5_strategy_tester_html",
        deal: Number(deal),
        order: order ? Number(order) : null,
        symbol: symbol || null,
        type,
        direction: direction || null,
        volume: volume ? parseNumber(volume) : null,
        price: price ? parseNumber(price) : null,
        balance_after: parseNumber(balance),
        comment: comment || null
      }
    });
  }

  if (typeof startingBalance !== "number") throw new Error("MT5 report initial balance deal was not found");
  if (events.length === 0) throw new Error("MT5 report did not contain trade deal rows");

  const lifecycle = JSON.parse(fs.readFileSync(lifecycleFullPath, "utf8"));
  const ledger = {
    schema_version: "ftmo_ledger_input_v1",
    created_at: createdAt,
    fixture_ledger: false,
    source_kind: "mt5_strategy_tester_report",
    proof_scope: "ledger_mechanics_only",
    forward_demo_survival_claim: false,
    source_job_id: sourceJobId ?? null,
    account: { currency, starting_balance: startingBalance },
    events,
    source_artifacts: {
      mt5_report_path: reportPath,
      mt5_report_sha256: sha256File(reportFullPath),
      lifecycle_path: lifecyclePath,
      lifecycle_sha256: sha256File(lifecycleFullPath),
      lifecycle_run_id: lifecycle.run_id ?? null,
      lifecycle_summary: lifecycle.lifecycle_summary ?? null
    },
    extraction_notes: {
      initial_balance_deal: initialBalanceDeal,
      timestamp_interpretation: "MT5 report timestamps are terminal report timestamps. They are encoded with a Z suffix only to make the deterministic ledger worker parse them; no independent timezone certification is claimed.",
      floating_pnl: "Closed-deal report rows do not provide intratrade floating equity. Events therefore carry floating_pnl=0 and this remains ledger-mechanics evidence, not FTMO forward/demo survival evidence."
    }
  };

  fs.mkdirSync(path.dirname(outputFullPath), { recursive: true });
  fs.writeFileSync(outputFullPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return { output_path: outputPath, event_count: events.length, starting_balance: startingBalance, final_balance_after_last_deal: events.at(-1)?.source?.balance_after ?? startingBalance };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const result = extractMt5ReportLedger({
    rootDir: valueAfter(args, "--root") ?? process.cwd(),
    reportPath: valueAfter(args, "--report"),
    lifecyclePath: valueAfter(args, "--lifecycle"),
    outputPath: valueAfter(args, "--output"),
    currency: valueAfter(args, "--currency"),
    sourceJobId: valueAfter(args, "--source-job-id"),
    createdAt: valueAfter(args, "--created-at") ?? new Date().toISOString()
  });
  console.log(JSON.stringify(result, null, 2));
}

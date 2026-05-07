import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildPaths } from "../core/paths.mjs";
import { ensureDir, writeJsonAtomic } from "../core/fs-utils.mjs";

const WORKER_NAME = "ftmo_ledger";
const EVIDENCE_KIND = "ftmo_ledger";
const AUTHORITY_LAYER = "control_plane";
const WORKER_SCHEMA_VERSION = "ftmo_ledger_worker_result_v1";
const WORKER_RELATIVE_PATH = "src/workers/ftmo-ledger-worker.mjs";
const TARGETS = new Set(["1-step", "2-step", "both"]);

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function relativeToRoot(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) {
    throw new Error(`FTMO ledger path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`FTMO ledger path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

function artifactRecord(paths, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return { artifact_type: artifactType, path: relativeToRoot(paths, fullPath), sha256: sha256File(fullPath), size_bytes: stat.size, modified_at: stat.mtime.toISOString() };
}

function sourceHash(paths, repoRelativePath) {
  const fullPath = path.join(paths.root, repoRelativePath);
  if (!fs.existsSync(fullPath)) return null;
  return artifactRecord(paths, fullPath, "worker_source");
}

function sanitizeIdPart(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unspecified";
}

function defaultRunId(observedAt) {
  return `RUN-FTMO-LEDGER-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function defaultJobId(observedAt) {
  return `JOB-FTMO-LEDGER-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function readJsonInput(paths, repoRelativePath, override) {
  if (override) return override;
  if (!repoRelativePath) return null;
  return JSON.parse(fs.readFileSync(resolveRepoRelativePath(paths.root, repoRelativePath), "utf8"));
}

function validateRuleSet(ruleSet) {
  const errors = [];
  if (!ruleSet || typeof ruleSet !== "object") return ["rule set missing"];
  if (!TARGETS.has(ruleSet.ftmo_target)) errors.push("ftmo_target must be 1-step, 2-step, or both");
  if (!ruleSet.rule_set_version) errors.push("rule_set_version missing");
  if (!ruleSet.source_date) errors.push("source_date missing");
  if (!ruleSet.reset_timezone) errors.push("reset_timezone missing");
  if (!ruleSet.daily_loss_limit || typeof ruleSet.daily_loss_limit.value !== "number") errors.push("daily_loss_limit missing numeric value");
  if (!ruleSet.max_loss_limit || typeof ruleSet.max_loss_limit.value !== "number") errors.push("max_loss_limit missing numeric value");
  if (ruleSet.include_floating_pnl !== true) errors.push("include_floating_pnl must be true");
  if (ruleSet.include_commission_swap !== true) errors.push("include_commission_swap must be true");
  return errors;
}

function validateLedgerInput(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== "object") return ["ledger input missing"];
  if (!ledger.account || typeof ledger.account.starting_balance !== "number") errors.push("account.starting_balance missing");
  if (!ledger.account?.currency) errors.push("account.currency missing");
  if (!Array.isArray(ledger.events) || ledger.events.length === 0) errors.push("events missing");
  if (ledger.forward_demo_survival_claim === true && (!Array.isArray(ledger.equity_time_series) || ledger.equity_time_series.length === 0)) {
    errors.push("forward_demo_survival_claim requires explicit equity_time_series evidence");
  }
  for (const [index, event] of (ledger.events ?? []).entries()) {
    if (!event.timestamp) errors.push(`events[${index}].timestamp missing`);
  }
  for (const [index, point] of (ledger.equity_time_series ?? []).entries()) {
    if (!point.timestamp) errors.push(`equity_time_series[${index}].timestamp missing`);
    if (typeof point.equity !== "number") errors.push(`equity_time_series[${index}].equity missing`);
  }
  return errors;
}

function floatingEquityEvidence(ledger) {
  const equityPointCount = Array.isArray(ledger?.equity_time_series) ? ledger.equity_time_series.length : 0;
  return {
    available: equityPointCount > 0,
    equity_time_series_points: equityPointCount,
    closed_deal_only: equityPointCount === 0,
    limitation: equityPointCount > 0 ? null : "Closed-deal rows cannot prove intratrade floating-equity FTMO survival."
  };
}

function limitAmount(limit, startingBalance) {
  if (limit.type === "percent_of_starting_balance") return startingBalance * limit.value;
  return limit.value;
}

function maxLossModel(ruleSet) {
  return ruleSet.max_loss_limit.model ?? (ruleSet.ftmo_target === "1-step" ? "end_of_day_trailing" : "static");
}

function dayKey(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function computeFtmoLedger(ruleSet, ledger) {
  const startingBalance = ledger.account.starting_balance;
  const dailyLimit = limitAmount(ruleSet.daily_loss_limit, startingBalance);
  const maxLimit = limitAmount(ruleSet.max_loss_limit, startingBalance);
  const model = maxLossModel(ruleSet);
  const events = [...ledger.events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const days = new Map();
  let cash = startingBalance;
  let priorEquity = startingBalance;
  let minEquity = startingBalance;
  let currentDay = null;
  let highestEndOfDayBalance = startingBalance;
  let maxLossLimitLevel = startingBalance - maxLimit;
  const timeline = [];

  for (const event of events) {
    const key = dayKey(event.timestamp, ruleSet.reset_timezone);
    if (currentDay && currentDay.date !== key) {
      currentDay.closing_balance = cash;
      highestEndOfDayBalance = Math.max(highestEndOfDayBalance, cash);
    }
    if (!days.has(key)) {
      if (model === "end_of_day_trailing") maxLossLimitLevel = Math.max(maxLossLimitLevel, highestEndOfDayBalance - maxLimit);
      currentDay = {
        date: key,
        start_balance: cash,
        start_equity: priorEquity,
        min_equity: priorEquity,
        closing_balance: cash,
        daily_loss_limit_level: cash - dailyLimit,
        max_loss_limit_level: maxLossLimitLevel,
        daily_loss: 0,
        breached: false,
        daily_breached: false,
        max_loss_breached: false
      };
      days.set(key, currentDay);
    } else {
      currentDay = days.get(key);
    }
    const realized = Number(event.realized_pnl ?? 0);
    const commission = Number(event.commission ?? 0);
    const swap = Number(event.swap ?? 0);
    const deposit = Number(event.deposit ?? 0);
    const withdrawal = Number(event.withdrawal ?? 0);
    const floating = Number(event.floating_pnl ?? 0);
    cash += realized + commission + swap + deposit - withdrawal;
    const equity = cash + floating;
    const day = currentDay;
    day.min_equity = Math.min(day.min_equity, equity);
    day.closing_balance = cash;
    day.daily_loss = Math.max(0, day.start_balance - day.min_equity);
    day.daily_breached = day.daily_loss > dailyLimit;
    day.max_loss_breached = day.max_loss_breached || equity < day.max_loss_limit_level;
    day.breached = day.daily_breached || day.max_loss_breached;
    minEquity = Math.min(minEquity, equity);
    priorEquity = equity;
    timeline.push({ timestamp: event.timestamp, day: key, cash, equity, floating_pnl: floating, daily_loss: day.daily_loss, daily_loss_limit_level: day.daily_loss_limit_level, max_loss_limit_level: day.max_loss_limit_level, max_loss: Math.max(0, startingBalance - minEquity) });
  }

  const maxLoss = Math.max(0, startingBalance - minEquity);
  const dayValues = [...days.values()];
  const dailyBreaches = dayValues.filter((day) => day.daily_breached);
  const maxLossBreaches = dayValues.filter((day) => day.max_loss_breached);
  return {
    max_loss_model: model,
    daily_loss_limit: dailyLimit,
    max_loss_limit: maxLimit,
    max_loss_limit_level: dayValues.at(-1)?.max_loss_limit_level ?? maxLossLimitLevel,
    trailing_high_watermark_balance: highestEndOfDayBalance,
    days: dayValues,
    max_loss: maxLoss,
    breached: dailyBreaches.length > 0 || (model === "static" ? maxLoss > maxLimit : maxLossBreaches.length > 0),
    breach_reasons: [
      ...dailyBreaches.map((day) => `daily_loss_breach:${day.date}`),
      ...(model === "static" && maxLoss > maxLimit ? ["max_loss_breach"] : []),
      ...maxLossBreaches.map((day) => `max_loss_breach:${day.date}`)
    ],
    final_equity: priorEquity,
    timeline_sha256: sha256Text(stableJson(timeline))
  };
}

function buildExecutionResult({ workerResult, observedAt, experimentId, artifacts, blockedReason }) {
  const common = { experiment_id: experimentId, evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, observed_at: observedAt, artifacts_created: artifacts, metrics_observed: {}, observations: workerResult.observations, blocked_reason: blockedReason, source_hashes: workerResult.source_hashes, worker_result: workerResult };
  if (workerResult.status === "succeeded") return { ...common, status: "executed", blocked_reason: null };
  return { ...common, status: "blocked", blockers: [blockedReason], errors: [{ command: "ftmo_ledger_worker", message: blockedReason }] };
}

export function runFtmoLedgerWorker({ rootDir, experimentId = "EXP-FTMO-LEDGER", runId = null, jobId = null, observedAt = new Date().toISOString(), ruleSetPath = null, ledgerPath = null, ruleSetOverride = null, ledgerOverride = null } = {}) {
  const paths = buildPaths(rootDir ?? process.cwd());
  const effectiveRunId = runId ?? defaultRunId(observedAt);
  const effectiveJobId = sanitizeIdPart(jobId ?? defaultJobId(observedAt));
  const runDir = path.join(paths.mt5, "ftmo", effectiveJobId);
  ensureDir(runDir, paths);
  const sourceHashes = [sourceHash(paths, WORKER_RELATIVE_PATH)].filter(Boolean);
  const request = { schema_version: "ftmo_ledger_request_v1", evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, run_id: effectiveRunId, job_id: effectiveJobId, rule_set_path: ruleSetPath, ledger_path: ledgerPath, boundary: "No FTMO defaults are embedded; rule-set and ledger inputs must be explicit repo-contained artifacts." };
  const requestPath = path.join(runDir, "request.json");
  writeJsonAtomic(requestPath, request, paths);

  let ruleSet = null;
  let ledger = null;
  let blockedReason = null;
  let diagnostics = { error_code: null, message: null, stdout_path: null, stderr_path: null };
  try {
    ruleSet = readJsonInput(paths, ruleSetPath, ruleSetOverride);
    ledger = readJsonInput(paths, ledgerPath, ledgerOverride);
  } catch (error) {
    blockedReason = `Unable to read repo-contained FTMO ledger inputs: ${error.message}`;
    diagnostics = { ...diagnostics, error_code: "input_read_failed", message: blockedReason };
  }
  const errors = blockedReason ? [] : [...validateRuleSet(ruleSet), ...validateLedgerInput(ledger)];
  if (!blockedReason && errors.length > 0) {
    blockedReason = `FTMO ledger inputs failed validation: ${errors.join("; ")}.`;
    diagnostics = { ...diagnostics, error_code: "input_validation_failed", message: blockedReason };
  }

  const status = blockedReason ? "blocked" : "succeeded";
  const ledgerSummary = status === "succeeded" ? computeFtmoLedger(ruleSet, ledger) : null;
  const observations = status === "succeeded" ? {
    rule_set: { ftmo_target: ruleSet.ftmo_target, rule_set_version: ruleSet.rule_set_version, source_date: ruleSet.source_date, reset_timezone: ruleSet.reset_timezone, source_url: ruleSet.source_url ?? null },
    account: ledger.account,
    ledger_summary: ledgerSummary,
    floating_equity_evidence: floatingEquityEvidence(ledger),
    proof_scope: "ledger_mechanics_only",
    forward_demo_survival_claim: false,
    fixture_ledger: ledger.fixture_ledger === true,
    input_hashes: { rule_set_sha256: sha256Text(stableJson(ruleSet)), ledger_sha256: sha256Text(stableJson(ledger)) }
  } : { proof_scope: "ledger_mechanics_only", forward_demo_survival_claim: false, limitations: { reason: blockedReason } };
  const summary = { schema_version: "ftmo_ledger_summary_v1", evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, status, observed_at: observedAt, request, observations, blocked_reason: blockedReason, diagnostics, source_hashes: sourceHashes };
  const summaryPath = path.join(runDir, status === "succeeded" ? "ftmo-ledger-summary.json" : "blocked-ftmo-ledger-summary.json");
  writeJsonAtomic(summaryPath, summary, paths);
  const artifacts = [artifactRecord(paths, summaryPath, status === "succeeded" ? "ftmo_ledger_summary" : "blocked_ftmo_ledger_summary"), artifactRecord(paths, requestPath, "worker_request")];
  if (ruleSetPath) artifacts.push(artifactRecord(paths, resolveRepoRelativePath(paths.root, ruleSetPath), "ftmo_rule_set"));
  if (ledgerPath) artifacts.push(artifactRecord(paths, resolveRepoRelativePath(paths.root, ledgerPath), "ftmo_ledger_input"));
  const workerResult = { job_id: effectiveJobId, run_id: effectiveRunId, candidate_id: null, worker: WORKER_NAME, evidence_kind: EVIDENCE_KIND, authority_layer: AUTHORITY_LAYER, schema_version: WORKER_SCHEMA_VERSION, status, artifacts, metrics: {}, observations, observed_at: observedAt, blocked_reason: blockedReason, source_hashes: sourceHashes, diagnostics, environment: { node_version: process.version, platform: process.platform, arch: process.arch } };
  const workerResultPath = path.join(runDir, "worker-result.json");
  writeJsonAtomic(workerResultPath, workerResult, paths);
  const executionResult = buildExecutionResult({ workerResult, observedAt, experimentId, artifacts, blockedReason });
  const executionResultPath = path.join(runDir, "execution-result.json");
  writeJsonAtomic(executionResultPath, executionResult, paths);
  return executionResult;
}

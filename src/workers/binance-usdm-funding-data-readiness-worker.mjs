import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, writeTextAtomic } from "../core/fs-utils.mjs";
import { DATA_READINESS_MANIFEST_SCHEMA_VERSION, validateDataReadinessManifest } from "../core/data-readiness.mjs";

const SOURCE_FAMILY = "binance_usdm_funding";
const MARKET = "crypto_derivatives";
const TIMEFRAME = "8h";
const EXPECTED_FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
const BINANCE_USDM_FUNDING_URL = "https://fapi.binance.com/fapi/v1/fundingRate";
export const BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION = "binance_usdm_funding_refresh_request_v1";

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (typeof repoRelativePath !== "string" || !repoRelativePath.trim() || path.isAbsolute(repoRelativePath)) {
    throw new Error(`Binance funding output path must be repo-relative: ${String(repoRelativePath)}`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Binance funding output path escapes repository root: ${repoRelativePath}`);
  return fullPath;
}

function artifactRecord(rootDir, fullPath) {
  const stat = fs.statSync(fullPath);
  return {
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

function normalizeSymbol(symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(clean)) throw new Error(`Binance USD-M funding symbol is invalid: ${String(symbol)}`);
  return clean;
}

function optionalEpochMs(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  const parsedDate = Date.parse(value);
  if (Number.isFinite(parsedDate)) return parsedDate;
  throw new Error(`Binance USD-M funding ${field} must be epoch milliseconds or an ISO timestamp.`);
}

function normalizeLimit(limit) {
  const parsed = Number(limit ?? 1000);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) throw new Error("Binance USD-M funding limit must be an integer from 1 to 1000.");
  return parsed;
}

export function buildBinanceUsdmFundingUrl({ symbol, startTime = null, endTime = null, limit = 1000, baseUrl = BINANCE_USDM_FUNDING_URL } = {}) {
  const cleanSymbol = normalizeSymbol(symbol);
  const startMs = optionalEpochMs(startTime, "startTime");
  const endMs = optionalEpochMs(endTime, "endTime");
  if (startMs !== null && endMs !== null && endMs <= startMs) throw new Error("Binance USD-M funding endTime must be after startTime.");
  const url = new URL(baseUrl);
  url.searchParams.set("symbol", cleanSymbol);
  url.searchParams.set("limit", String(normalizeLimit(limit)));
  if (startMs !== null) url.searchParams.set("startTime", String(startMs));
  if (endMs !== null) url.searchParams.set("endTime", String(endMs));
  return url.toString();
}

function requireRows(rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new Error("Binance USD-M funding raw rows are required and must be non-empty.");
  if (rawRows.length < 2) throw new Error("Binance USD-M funding data readiness requires at least two raw rows for a coverage window.");
}

function isoFromMs(ms) {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

function compactIso(iso) {
  return iso.replace(/[-:]/g, "").replace(".000", "").replace(/Z$/, "Z");
}

function parseFundingRow(row, symbol, index) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Binance USD-M funding row ${index} must be an object.`);
  if (row.symbol && String(row.symbol).toUpperCase() !== symbol) throw new Error(`Binance USD-M funding row ${index} symbol does not match ${symbol}.`);

  const fundingTimeMs = Number(row.fundingTime);
  if (!Number.isInteger(fundingTimeMs) || fundingTimeMs <= 0) throw new Error(`Binance USD-M funding row ${index} fundingTime is required and must be epoch milliseconds.`);

  const fundingRate = Number(row.fundingRate);
  if (!Number.isFinite(fundingRate)) throw new Error(`Binance USD-M funding row ${index} fundingRate is required and must be numeric.`);

  let markPrice = "";
  if (row.markPrice !== undefined && row.markPrice !== null && row.markPrice !== "") {
    const parsedMarkPrice = Number(row.markPrice);
    if (!Number.isFinite(parsedMarkPrice)) throw new Error(`Binance USD-M funding row ${index} markPrice must be numeric when supplied.`);
    markPrice = String(row.markPrice);
  }

  return {
    timestamp_utc: isoFromMs(fundingTimeMs),
    symbol,
    funding_rate: String(row.fundingRate),
    mark_price: markPrice,
    source_funding_time_ms: fundingTimeMs
  };
}

function normalizeFundingRows(rawRows, symbol) {
  requireRows(rawRows);
  const seenTimes = new Set();
  const normalized = rawRows.map((row, index) => parseFundingRow(row, symbol, index));
  normalized.sort((a, b) => a.source_funding_time_ms - b.source_funding_time_ms);
  for (const row of normalized) {
    if (seenTimes.has(row.source_funding_time_ms)) throw new Error(`Binance USD-M funding duplicate fundingTime: ${row.source_funding_time_ms}`);
    seenTimes.add(row.source_funding_time_ms);
  }
  return normalized;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fundingRowsToCsv(rows) {
  const columns = ["timestamp_utc", "symbol", "funding_rate", "mark_price", "source_funding_time_ms"];
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

function rawRowsToJsonl(rawRows) {
  return `${rawRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function readRawRowsFile(rootDir, repoRelativePath) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Binance USD-M funding input path is missing on disk: ${repoRelativePath}`);
  const text = fs.readFileSync(fullPath, "utf8").trim();
  if (!text) throw new Error(`Binance USD-M funding input path is empty: ${repoRelativePath}`);
  if (text.startsWith("[")) return JSON.parse(text);
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function normalizeRefreshMode(mode) {
  const clean = String(mode || "").trim();
  if (clean !== "fixture_input" && clean !== "live_fetch") throw new Error("Binance USD-M funding refresh mode must be fixture_input or live_fetch.");
  return clean;
}

function validateRefreshRequest(request, { rootDir = process.cwd() } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Binance USD-M funding refresh request must be an object.");
  if (request.schema_version !== BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION) {
    throw new Error(`Binance USD-M funding refresh request schema_version must be ${BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION}.`);
  }
  if (request.source_family !== SOURCE_FAMILY) throw new Error(`Binance USD-M funding refresh request source_family must be ${SOURCE_FAMILY}.`);
  const symbol = normalizeSymbol(request.symbol);
  const startTime = optionalEpochMs(request.startTime ?? request.start_time, "startTime");
  const endTime = optionalEpochMs(request.endTime ?? request.end_time, "endTime");
  if (startTime === null) throw new Error("Binance USD-M funding refresh request startTime is required.");
  if (endTime === null) throw new Error("Binance USD-M funding refresh request endTime is required.");
  if (endTime <= startTime) throw new Error("Binance USD-M funding refresh request endTime must be after startTime.");
  const mode = normalizeRefreshMode(request.mode);
  const limit = normalizeLimit(request.limit ?? 1000);
  const outputDir = request.output_dir ?? request.outputDir ?? null;
  if (outputDir !== null) resolveRepoRelativePath(rootDir, outputDir);
  const rawRowsPath = request.raw_rows_path ?? request.input_path ?? null;
  if (mode === "fixture_input" && (typeof rawRowsPath !== "string" || !rawRowsPath.trim())) {
    throw new Error("Binance USD-M funding refresh request raw_rows_path is required for fixture_input mode.");
  }
  if (mode === "live_fetch" && request.live_fetch_allowed !== true) {
    throw new Error("Binance USD-M funding refresh request live_fetch_allowed must be true for live_fetch mode.");
  }
  return { symbol, startTime, endTime, limit, mode, outputDir, rawRowsPath, baseUrl: request.base_url ?? request.baseUrl ?? BINANCE_USDM_FUNDING_URL, timeoutMs: Number(request.timeout_ms ?? request.timeoutMs ?? 15000) };
}

function buildGapReport(rows) {
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const observedMs = current.source_funding_time_ms - previous.source_funding_time_ms;
    if (observedMs !== EXPECTED_FUNDING_INTERVAL_MS) {
      gaps.push({
        previous_timestamp_utc: previous.timestamp_utc,
        next_timestamp_utc: current.timestamp_utc,
        expected_interval_hours: 8,
        observed_interval_hours: observedMs / (60 * 60 * 1000)
      });
    }
  }
  return { checked: true, expected_interval_hours: 8, gap_count: gaps.length, gaps };
}

export async function fetchBinanceUsdmFundingRows({
  symbol,
  startTime = null,
  endTime = null,
  limit = 1000,
  baseUrl = BINANCE_USDM_FUNDING_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Binance USD-M funding fetchImpl is required for live fetching.");
  const sourceUrl = buildBinanceUsdmFundingUrl({ symbol, startTime, endTime, limit, baseUrl });
  const options = Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? { signal: AbortSignal.timeout(timeoutMs) }
    : {};
  const response = await fetchImpl(sourceUrl, options);
  if (!response?.ok) throw new Error(`Binance USD-M funding fetch failed with HTTP status ${response?.status ?? "unknown"}.`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Binance USD-M funding fetch response must be an array.");
  return { source_url: sourceUrl, retrieved_at: new Date().toISOString(), raw_rows: rows };
}

export function buildBinanceUsdmFundingDataReadiness({
  rootDir = process.cwd(),
  symbol,
  rawRows,
  retrievedAt = new Date().toISOString(),
  outputDir = null,
  sourceUrl = null
} = {}) {
  const root = path.resolve(rootDir);
  const cleanSymbol = normalizeSymbol(symbol);
  const normalizedRows = normalizeFundingRows(rawRows, cleanSymbol);
  const symbolLower = cleanSymbol.toLowerCase();
  const repoOutputDir = outputDir || `workspace/data/binance/usdm_funding/${symbolLower}`;
  const fullOutputDir = resolveRepoRelativePath(root, repoOutputDir);
  const rawPath = path.join(fullOutputDir, `${symbolLower}_funding_raw.jsonl`);
  const normalizedPath = path.join(fullOutputDir, `${symbolLower}_funding_8h.csv`);
  const manifestPath = path.join(fullOutputDir, `${symbolLower}_funding_manifest.json`);

  writeTextAtomic(rawPath, rawRowsToJsonl(rawRows), { rootDir: root, allowedTopLevelDirs: new Set(["workspace"]), allowedRootFiles: new Set() });
  writeTextAtomic(normalizedPath, fundingRowsToCsv(normalizedRows), { rootDir: root, allowedTopLevelDirs: new Set(["workspace"]), allowedRootFiles: new Set() });

  const rawArtifact = artifactRecord(root, rawPath);
  const normalizedArtifact = artifactRecord(root, normalizedPath);
  const first = normalizedRows[0];
  const last = normalizedRows[normalizedRows.length - 1];
  const manifestRepoPath = repoRelative(root, manifestPath);
  const manifest = {
    schema_version: DATA_READINESS_MANIFEST_SCHEMA_VERSION,
    evidence_kind: "data_identity",
    dataset_id: `DATA-BINANCE-USDM-FUNDING-${cleanSymbol}-${compactIso(first.timestamp_utc)}-${compactIso(last.timestamp_utc)}`,
    source_family: SOURCE_FAMILY,
    market: MARKET,
    instrument: cleanSymbol,
    timeframe: TIMEFRAME,
    source: {
      source_url: sourceUrl || `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${cleanSymbol}`,
      retrieved_at: retrievedAt
    },
    artifacts: {
      raw: rawArtifact,
      normalized: normalizedArtifact
    },
    coverage: {
      start_utc: first.timestamp_utc,
      end_utc: last.timestamp_utc,
      row_count: normalizedRows.length,
      timezone: "UTC"
    },
    gap_report: buildGapReport(normalizedRows),
    feature_lag_rules: [
      {
        field: "funding_rate",
        lag: "available_after_funding_timestamp",
        rationale: "Funding rates are only usable after Binance publishes the funding timestamp."
      },
      {
        field: "mark_price",
        lag: "same_funding_timestamp_only_when_present",
        rationale: "The optional mark price is tied to the funding row and must not be forward-filled before its timestamp."
      }
    ],
    survivorship: {
      survivorship_bias_checked: true,
      universe_policy: `single Binance USD-M symbol ${cleanSymbol}; this artifact does not claim a historical delisting-complete universe`
    },
    wfa_integration: {
      data_paths: [normalizedArtifact.path],
      data_manifest_paths: [manifestRepoPath],
      join_key: "timestamp_utc",
      integration_status: "ready_as_exogenous_feature"
    }
  };

  validateDataReadinessManifest(manifest, { rootDir: root });
  writeJsonAtomic(manifestPath, manifest, { rootDir: root, allowedTopLevelDirs: new Set(["workspace"]), allowedRootFiles: new Set() });

  return {
    status: "ready",
    source_family: SOURCE_FAMILY,
    manifest,
    artifacts: {
      raw: rawArtifact,
      normalized: normalizedArtifact,
      manifest: artifactRecord(root, manifestPath)
    },
    normalized_rows: normalizedRows,
    gap_report: manifest.gap_report
  };
}

export async function runBinanceUsdmFundingDataReadiness({
  rootDir = process.cwd(),
  symbol,
  startTime = null,
  endTime = null,
  limit = 1000,
  outputDir = null,
  baseUrl = BINANCE_USDM_FUNDING_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000
} = {}) {
  const cleanSymbol = (() => {
    try {
      return normalizeSymbol(symbol);
    } catch {
      return String(symbol || "").trim().toUpperCase() || null;
    }
  })();
  const diagnosticSourceUrl = (() => {
    try {
      return cleanSymbol ? buildBinanceUsdmFundingUrl({ symbol: cleanSymbol, startTime, endTime, limit, baseUrl }) : null;
    } catch {
      return null;
    }
  })();

  try {
    const fetched = await fetchBinanceUsdmFundingRows({ symbol, startTime, endTime, limit, baseUrl, fetchImpl, timeoutMs });
    return buildBinanceUsdmFundingDataReadiness({
      rootDir,
      symbol,
      rawRows: fetched.raw_rows,
      retrievedAt: fetched.retrieved_at,
      outputDir,
      sourceUrl: fetched.source_url
    });
  } catch (error) {
    return {
      status: "blocked",
      source_family: SOURCE_FAMILY,
      instrument: cleanSymbol,
      blocked_reason: "binance_usdm_funding_fetch_failed",
      diagnostics: {
        message: error instanceof Error ? error.message : String(error),
        source_url: diagnosticSourceUrl,
        artifacts_written: false
      },
      artifacts: {}
    };
  }
}

export async function runBinanceUsdmFundingRefreshRequest({
  rootDir = process.cwd(),
  request,
  fetchImpl = globalThis.fetch
} = {}) {
  const root = path.resolve(rootDir);
  let parsed;
  try {
    parsed = validateRefreshRequest(request, { rootDir: root });
    if (parsed.mode === "fixture_input") {
      const rawRows = readRawRowsFile(root, parsed.rawRowsPath);
      const result = buildBinanceUsdmFundingDataReadiness({
        rootDir: root,
        symbol: parsed.symbol,
        rawRows,
        outputDir: parsed.outputDir,
        sourceUrl: buildBinanceUsdmFundingUrl({ symbol: parsed.symbol, startTime: parsed.startTime, endTime: parsed.endTime, limit: parsed.limit, baseUrl: parsed.baseUrl })
      });
      return {
        ...result,
        refresh_request: {
          schema_version: BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION,
          mode: parsed.mode,
          symbol: parsed.symbol,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          limit: parsed.limit,
          raw_rows_path: parsed.rawRowsPath
        }
      };
    }

    const result = await runBinanceUsdmFundingDataReadiness({
      rootDir: root,
      symbol: parsed.symbol,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      limit: parsed.limit,
      outputDir: parsed.outputDir,
      baseUrl: parsed.baseUrl,
      fetchImpl,
      timeoutMs: parsed.timeoutMs
    });
    return {
      ...result,
      refresh_request: {
        schema_version: BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION,
        mode: parsed.mode,
        symbol: parsed.symbol,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        limit: parsed.limit
      }
    };
  } catch (error) {
    return {
      status: "blocked",
      source_family: SOURCE_FAMILY,
      instrument: parsed?.symbol ?? (typeof request?.symbol === "string" ? request.symbol.trim().toUpperCase() : null),
      blocked_reason: "binance_usdm_funding_refresh_request_invalid",
      diagnostics: {
        message: error instanceof Error ? error.message : String(error),
        artifacts_written: false
      },
      artifacts: {}
    };
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateDataReadinessManifest } from "./data-readiness.mjs";
import { validateDataRelevanceClassification } from "./mt5-data-relevance.mjs";
import { validateBrokerHistoryExportManifest } from "./mt5-history-availability.mjs";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION = "mt5_instrument_equivalence_request_v1";
export const MT5_INSTRUMENT_EQUIVALENCE_SCHEMA_VERSION = "mt5_instrument_equivalence_v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function normalize(value) {
  return String(value ?? "").trim().toUpperCase();
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`MT5 instrument equivalence ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`MT5 instrument equivalence ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function readJsonRepoRelative(rootDir, repoRelativePath, label) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, label);
  if (!fs.existsSync(fullPath)) throw new Error(`MT5 instrument equivalence ${label} is missing on disk: ${repoRelativePath}`);
  return { fullPath, value: JSON.parse(fs.readFileSync(fullPath, "utf8")) };
}

function artifactRecord(rootDir, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return {
    artifact_type: artifactType,
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "mt5-instrument-equivalence";
}

function defaultEquivalenceId(observedAt) {
  return `MT5-INSTRUMENT-EQUIVALENCE-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function dataIdentityKey({ sourceFamily, instrument, timeframe }) {
  return `${normalize(sourceFamily)}|${normalize(instrument)}|${normalize(timeframe)}`;
}

function rowDataIdentityKeys(row) {
  return [
    dataIdentityKey({ sourceFamily: row.source_family, instrument: row.source_symbol, timeframe: row.timeframe }),
    dataIdentityKey({ sourceFamily: "", instrument: row.source_symbol, timeframe: row.timeframe })
  ];
}

function indexDataReadinessManifests(manifestRecords) {
  const byKey = new Map();
  for (const record of manifestRecords) {
    const manifest = record.manifest;
    const keys = [
      dataIdentityKey({ sourceFamily: manifest.source_family, instrument: manifest.instrument, timeframe: manifest.timeframe }),
      dataIdentityKey({ sourceFamily: "", instrument: manifest.instrument, timeframe: manifest.timeframe })
    ];
    const summary = {
      status: "available",
      dataset_id: manifest.dataset_id,
      source_family: manifest.source_family,
      market: manifest.market,
      instrument: manifest.instrument,
      timeframe: manifest.timeframe,
      coverage: manifest.coverage,
      source: manifest.source,
      artifact: record.artifact
    };
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, summary);
  }
  return byKey;
}

function indexHistoryRows(historyManifest) {
  const byKey = new Map();
  for (const row of Array.isArray(historyManifest?.rows) ? historyManifest.rows : []) {
    byKey.set(`${normalize(row.mt5_symbol)}|${normalize(row.timeframe)}`, row);
  }
  return byKey;
}

function artifactsMatch(left, right) {
  return hasText(left?.path, 3)
    && hasText(right?.path, 3)
    && left.path === right.path
    && SHA256_PATTERN.test(String(left?.sha256 || ""))
    && left.sha256 === right.sha256;
}

function findSourceDataIdentity(row, dataIdentityIndex) {
  for (const key of rowDataIdentityKeys(row)) {
    const found = dataIdentityIndex.get(key);
    if (found) return found;
  }
  throw new Error(`MT5 instrument equivalence missing source data identity for ${row.source_symbol ?? row.instrument_id} ${row.timeframe ?? ""}`.trim());
}

function historyFor(row, historyIndex) {
  if (!hasText(row.mt5_symbol) || !hasText(row.timeframe)) return null;
  return historyIndex.get(`${normalize(row.mt5_symbol)}|${normalize(row.timeframe)}`) ?? null;
}

function knownDifferences({ row, sourceDataIdentity, brokerHistory }) {
  const symbolSpec = row.symbol_spec ?? null;
  return {
    quote_basis: {
      mt5: brokerHistory?.quote_basis ?? "not_observed",
      external: sourceDataIdentity.source?.source_url ?? sourceDataIdentity.source_family,
      status: row.classification === "mt5_verified" ? "not_proven_equal" : "not_applicable"
    },
    session_hours: {
      mt5: symbolSpec?.session_deals ?? symbolSpec?.session_quote ?? "not_observed",
      external: "not_compared",
      status: "not_proven_equal"
    },
    spread_and_costs: {
      mt5_spread_points: symbolSpec?.spread ?? null,
      external_cost_model: "not_compared",
      status: "not_proven_equal"
    },
    funding_swap: {
      mt5_swap_long: symbolSpec?.swap_long ?? null,
      mt5_swap_short: symbolSpec?.swap_short ?? null,
      external_source_family: sourceDataIdentity.source_family,
      status: "not_proven_equal"
    },
    contract_size: {
      mt5_trade_contract_size: symbolSpec?.trade_contract_size ?? null,
      external_contract_size: "not_compared",
      status: row.classification === "mt5_verified" ? "not_proven_equal" : "not_applicable"
    }
  };
}

function equivalenceRow({ row, sourceDataIdentity, brokerHistory }) {
  const mt5Verified = row.classification === "mt5_verified";
  return {
    instrument_id: row.instrument_id,
    classification: row.classification,
    mt5_symbol: row.mt5_symbol ?? null,
    external_source_symbol: row.source_symbol ?? null,
    source_family: row.source_family ?? null,
    timeframe: row.timeframe ?? null,
    mapping_basis: row.mapping_basis,
    source_data_identity: sourceDataIdentity,
    terminal_symbol_spec: mt5Verified ? row.symbol_spec : null,
    broker_history: brokerHistory
      ? {
        availability_status: brokerHistory.availability_status,
        returned_bars: brokerHistory.returned_bars,
        coverage_start_utc: brokerHistory.coverage_start_utc,
        coverage_end_utc: brokerHistory.coverage_end_utc,
        bars_sha256: brokerHistory.bars_sha256,
        source_snapshot: brokerHistory.source_snapshot,
        blocked_reason: brokerHistory.blocked_reason ?? null
      }
      : { availability_status: "not_supplied", reason: "No broker history availability manifest row was supplied for this MT5 symbol/timeframe." },
    known_differences: knownDifferences({ row, sourceDataIdentity, brokerHistory }),
    promotion_note: mt5Verified
      ? "MT5 terminal symbol is verified, but external-vs-MT5 data equivalence and Strategy Tester parity are not proven by this artifact."
      : "This research instrument is not MT5 verified and cannot advance as MT5-bound evidence."
  };
}

export function validateMt5InstrumentEquivalenceRequest(request, { rootDir = process.cwd() } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("MT5 instrument equivalence request must be an object.");
  if (request.schema_version !== MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION) {
    throw new Error(`MT5 instrument equivalence request schema_version must be ${MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION}.`);
  }
  if (!hasText(request.data_relevance_classification_path)) throw new Error("MT5 instrument equivalence request requires data_relevance_classification_path.");
  resolveRepoRelativePath(rootDir, request.data_relevance_classification_path, "data_relevance_classification_path");
  if (!Array.isArray(request.source_data_identity_paths) || request.source_data_identity_paths.length === 0) {
    throw new Error("MT5 instrument equivalence request requires non-empty source_data_identity_paths[].");
  }
  for (const sourcePath of request.source_data_identity_paths) resolveRepoRelativePath(rootDir, sourcePath, "source_data_identity_paths[]");
  if (request.broker_history_manifest_path !== undefined && request.broker_history_manifest_path !== null) {
    resolveRepoRelativePath(rootDir, request.broker_history_manifest_path, "broker_history_manifest_path");
  }
  if (request.output_dir !== undefined && request.output_dir !== null) resolveRepoRelativePath(rootDir, request.output_dir, "output_dir");
  return true;
}

export function validateMt5InstrumentEquivalence(equivalence) {
  const errors = [];
  if (!equivalence || typeof equivalence !== "object" || Array.isArray(equivalence)) throw new Error("MT5 instrument equivalence is missing or invalid.");
  if (equivalence.schema_version !== MT5_INSTRUMENT_EQUIVALENCE_SCHEMA_VERSION) errors.push(`schema_version must be ${MT5_INSTRUMENT_EQUIVALENCE_SCHEMA_VERSION}`);
  if (equivalence.evidence_kind !== "mt5_instrument_equivalence") errors.push("evidence_kind must be mt5_instrument_equivalence");
  if (!hasText(equivalence.equivalence_id, 3)) errors.push("equivalence_id is required");
  if (!hasText(equivalence.observed_at, 10)) errors.push("observed_at is required");
  if (!equivalence.data_relevance_classification || !hasText(equivalence.data_relevance_classification.path, 3) || !SHA256_PATTERN.test(String(equivalence.data_relevance_classification.sha256 || ""))) {
    errors.push("data_relevance_classification artifact path and sha256 are required");
  }
  if (!Array.isArray(equivalence.source_data_identities) || equivalence.source_data_identities.length === 0) errors.push("source_data_identities must be non-empty");
  if (!Array.isArray(equivalence.rows) || equivalence.rows.length === 0) errors.push("rows must be non-empty");

  for (const [index, row] of (Array.isArray(equivalence.rows) ? equivalence.rows : []).entries()) {
    if (!hasText(row.classification, 3)) errors.push(`rows[${index}].classification is required`);
    if (!hasText(row.external_source_symbol, 1)) errors.push(`rows[${index}].external_source_symbol is required`);
    if (!row.source_data_identity || row.source_data_identity.status !== "available") errors.push(`rows[${index}].source_data_identity must be available`);
    if (!row.known_differences || typeof row.known_differences !== "object" || Array.isArray(row.known_differences)) errors.push(`rows[${index}].known_differences is required`);
    if (row.classification === "mt5_verified") {
      if (!hasText(row.mt5_symbol, 1)) errors.push(`rows[${index}].mt5_symbol is required for mt5_verified`);
      if (!row.terminal_symbol_spec || row.terminal_symbol_spec.name !== row.mt5_symbol) errors.push(`rows[${index}].terminal_symbol_spec must match mt5_symbol for mt5_verified`);
    }
    if (row.classification === "non_mt5_research_only" && row.terminal_symbol_spec !== null) errors.push(`rows[${index}].terminal_symbol_spec must be null for non_mt5_research_only`);
  }

  const expectedCounts = {
    total: Array.isArray(equivalence.rows) ? equivalence.rows.length : 0,
    mt5_verified: Array.isArray(equivalence.rows) ? equivalence.rows.filter((row) => row.classification === "mt5_verified").length : 0,
    mt5_proxy: Array.isArray(equivalence.rows) ? equivalence.rows.filter((row) => row.classification === "mt5_proxy").length : 0,
    non_mt5_research_only: Array.isArray(equivalence.rows) ? equivalence.rows.filter((row) => row.classification === "non_mt5_research_only").length : 0
  };
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (equivalence.counts?.[key] !== value) errors.push(`counts.${key} must equal ${value}`);
  }

  if (errors.length > 0) throw new Error(`MT5 instrument equivalence validation failed: ${errors.join("; ")}`);
  return true;
}

export function writeMt5InstrumentEquivalenceFromRequest({
  rootDir = process.cwd(),
  request,
  observedAt = new Date().toISOString()
} = {}) {
  const paths = buildPaths(rootDir);
  validateMt5InstrumentEquivalenceRequest(request, { rootDir: paths.root });
  const equivalenceId = hasText(request.equivalence_id, 3) ? request.equivalence_id.trim() : defaultEquivalenceId(observedAt);

  const { fullPath: classificationFullPath, value: classification } = readJsonRepoRelative(paths.root, request.data_relevance_classification_path, "data_relevance_classification_path");
  validateDataRelevanceClassification(classification);

  const sourceDataIdentityRecords = request.source_data_identity_paths.map((sourcePath) => {
    const { fullPath, value: manifest } = readJsonRepoRelative(paths.root, sourcePath, "source_data_identity_paths[]");
    validateDataReadinessManifest(manifest, { rootDir: paths.root });
    return { manifest, artifact: artifactRecord(paths.root, fullPath, "data_readiness_manifest") };
  });
  const dataIdentityIndex = indexDataReadinessManifests(sourceDataIdentityRecords);

  let brokerHistoryManifest = null;
  let brokerHistoryArtifact = null;
  if (hasText(request.broker_history_manifest_path)) {
    const { fullPath, value } = readJsonRepoRelative(paths.root, request.broker_history_manifest_path, "broker_history_manifest_path");
    validateBrokerHistoryExportManifest(value);
    if (!artifactsMatch(value.universe_snapshot, classification.universe_snapshot)) {
      throw new Error("MT5 instrument equivalence broker_history_manifest universe_snapshot must match data_relevance_classification universe_snapshot.");
    }
    brokerHistoryManifest = value;
    brokerHistoryArtifact = artifactRecord(paths.root, fullPath, "broker_history_export_manifest");
  }
  const historyIndex = indexHistoryRows(brokerHistoryManifest);

  const rows = classification.rows.map((row) => {
    const sourceDataIdentity = findSourceDataIdentity(row, dataIdentityIndex);
    return equivalenceRow({ row, sourceDataIdentity, brokerHistory: historyFor(row, historyIndex) });
  });

  const equivalence = {
    schema_version: MT5_INSTRUMENT_EQUIVALENCE_SCHEMA_VERSION,
    evidence_kind: "mt5_instrument_equivalence",
    equivalence_id: equivalenceId,
    observed_at: observedAt,
    data_relevance_classification: artifactRecord(paths.root, classificationFullPath, "data_relevance_classification"),
    broker_history_manifest: brokerHistoryArtifact,
    source_data_identities: sourceDataIdentityRecords.map((record) => record.artifact),
    counts: {
      total: rows.length,
      mt5_verified: rows.filter((row) => row.classification === "mt5_verified").length,
      mt5_proxy: rows.filter((row) => row.classification === "mt5_proxy").length,
      non_mt5_research_only: rows.filter((row) => row.classification === "non_mt5_research_only").length
    },
    rows
  };
  validateMt5InstrumentEquivalence(equivalence);

  const outputDir = request.output_dir
    ? resolveRepoRelativePath(paths.root, request.output_dir, "output_dir")
    : path.join(paths.mt5, "instrument-equivalence", sanitizePathPart(equivalenceId));
  const equivalencePath = path.join(outputDir, "equivalence.json");
  writeJsonAtomic(equivalencePath, equivalence, paths);

  return {
    status: "ready",
    evidence_kind: "mt5_instrument_equivalence",
    equivalence_id: equivalenceId,
    observed_at: observedAt,
    artifacts: {
      equivalence: artifactRecord(paths.root, equivalencePath, "mt5_instrument_equivalence"),
      data_relevance_classification: equivalence.data_relevance_classification,
      broker_history_manifest: brokerHistoryArtifact,
      source_data_identities: equivalence.source_data_identities
    },
    counts: equivalence.counts,
    equivalence
  };
}

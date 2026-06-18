import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION = "mt5_history_availability_request_v1";
export const BROKER_HISTORY_EXPORT_MANIFEST_SCHEMA_VERSION = "broker_history_export_manifest_v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`MT5 history availability ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`MT5 history availability ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function readJsonRepoRelative(rootDir, repoRelativePath, label) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, label);
  if (!fs.existsSync(fullPath)) throw new Error(`MT5 history availability ${label} is missing on disk: ${repoRelativePath}`);
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
    .slice(0, 120) || "mt5-history-availability";
}

function defaultManifestId(observedAt) {
  return `MT5-HISTORY-AVAILABILITY-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function validateUniverseSnapshot(universeSnapshot) {
  if (!universeSnapshot || typeof universeSnapshot !== "object" || Array.isArray(universeSnapshot)) {
    throw new Error("MT5 history availability universe snapshot is invalid.");
  }
  if (universeSnapshot.schema_version !== "mt5_tradable_universe_snapshot_v1") {
    throw new Error("MT5 history availability universe snapshot must use schema_version mt5_tradable_universe_snapshot_v1.");
  }
  if (universeSnapshot.status === "blocked" || hasText(universeSnapshot.blocked_reason)) {
    throw new Error(`MT5 history availability universe snapshot is blocked: ${universeSnapshot.blocked_reason || "status is blocked"}`);
  }
  if (!Array.isArray(universeSnapshot.symbols) || universeSnapshot.symbols.length === 0) {
    throw new Error("MT5 history availability universe snapshot must include non-empty symbols[].");
  }
}

function universeSymbolIndex(universeSnapshot) {
  return new Map(universeSnapshot.symbols.map((symbol) => [symbol.name, symbol]));
}

function validateSnapshot(snapshot, repoRelativePath) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(`MT5 history availability snapshot is invalid: ${repoRelativePath}`);
  }
  if (snapshot.schema_version !== "mt5_environment_snapshot_v1") {
    throw new Error(`MT5 history availability snapshot must use schema_version mt5_environment_snapshot_v1: ${repoRelativePath}`);
  }
  if (snapshot.evidence_kind !== "mt5_snapshot") {
    throw new Error(`MT5 history availability snapshot evidence_kind must be mt5_snapshot: ${repoRelativePath}`);
  }
  if (!hasText(snapshot.request?.symbol) || !hasText(snapshot.request?.timeframe)) {
    throw new Error(`MT5 history availability snapshot must include request.symbol and request.timeframe: ${repoRelativePath}`);
  }
  if (!["succeeded", "blocked"].includes(snapshot.status)) {
    throw new Error(`MT5 history availability snapshot status must be succeeded or blocked: ${repoRelativePath}`);
  }
}

function rowFromSnapshot({ snapshot, snapshotArtifact, symbolSpec }) {
  const dataIdentity = snapshot.observations?.data_identity ?? null;
  const available = snapshot.status === "succeeded" && dataIdentity && Number(dataIdentity.returned_bars) > 0;
  return {
    mt5_symbol: snapshot.request.symbol,
    timeframe: snapshot.request.timeframe,
    availability_status: available ? "available" : "blocked",
    requested_bars: snapshot.request.bars ?? dataIdentity?.requested_bars ?? null,
    returned_bars: dataIdentity?.returned_bars ?? 0,
    coverage_start_utc: dataIdentity?.coverage_start_utc ?? null,
    coverage_end_utc: dataIdentity?.coverage_end_utc ?? null,
    bars_sha256: dataIdentity?.bars_sha256 ?? null,
    quote_basis: dataIdentity?.quote_basis ?? null,
    server: dataIdentity?.server ?? snapshot.observations?.account?.server ?? null,
    terminal_symbol_spec: symbolSpec,
    source_snapshot: snapshotArtifact,
    blocked_reason: available ? null : (snapshot.blocked_reason || snapshot.diagnostics?.message || "MT5 history snapshot did not provide available bars.")
  };
}

export function validateMt5HistoryAvailabilityRequest(request, { rootDir = process.cwd() } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("MT5 history availability request must be an object.");
  if (request.schema_version !== MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION) {
    throw new Error(`MT5 history availability request schema_version must be ${MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION}.`);
  }
  if (!hasText(request.universe_snapshot_path)) throw new Error("MT5 history availability request requires universe_snapshot_path.");
  resolveRepoRelativePath(rootDir, request.universe_snapshot_path, "universe_snapshot_path");
  if (!Array.isArray(request.history_snapshot_paths) || request.history_snapshot_paths.length === 0) {
    throw new Error("MT5 history availability request requires non-empty history_snapshot_paths[].");
  }
  for (const snapshotPath of request.history_snapshot_paths) resolveRepoRelativePath(rootDir, snapshotPath, "history_snapshot_paths[]");
  if (request.output_dir !== undefined && request.output_dir !== null) resolveRepoRelativePath(rootDir, request.output_dir, "output_dir");
  return true;
}

export function validateBrokerHistoryExportManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("broker history export manifest is missing or invalid.");
  if (manifest.schema_version !== BROKER_HISTORY_EXPORT_MANIFEST_SCHEMA_VERSION) errors.push(`schema_version must be ${BROKER_HISTORY_EXPORT_MANIFEST_SCHEMA_VERSION}`);
  if (!hasText(manifest.evidence_kind, 3) || manifest.evidence_kind !== "broker_history_export_manifest") errors.push("evidence_kind must be broker_history_export_manifest");
  if (!hasText(manifest.manifest_id, 3)) errors.push("manifest_id is required");
  if (!hasText(manifest.observed_at, 10)) errors.push("observed_at is required");
  if (!manifest.universe_snapshot || !hasText(manifest.universe_snapshot.path, 3) || !SHA256_PATTERN.test(String(manifest.universe_snapshot.sha256 || ""))) {
    errors.push("universe_snapshot path and sha256 are required");
  }
  if (!Array.isArray(manifest.rows) || manifest.rows.length === 0) errors.push("rows must be a non-empty array");

  for (const [index, row] of (Array.isArray(manifest.rows) ? manifest.rows : []).entries()) {
    if (!hasText(row.mt5_symbol, 1)) errors.push(`rows[${index}].mt5_symbol is required`);
    if (!hasText(row.timeframe, 1)) errors.push(`rows[${index}].timeframe is required`);
    if (!["available", "blocked"].includes(row.availability_status)) errors.push(`rows[${index}].availability_status is unsupported`);
    if (!row.source_snapshot || !hasText(row.source_snapshot.path, 3) || !SHA256_PATTERN.test(String(row.source_snapshot.sha256 || ""))) {
      errors.push(`rows[${index}].source_snapshot path and sha256 are required`);
    }
    if (!row.terminal_symbol_spec || typeof row.terminal_symbol_spec !== "object" || Array.isArray(row.terminal_symbol_spec)) {
      errors.push(`rows[${index}].terminal_symbol_spec is required`);
    } else if (row.terminal_symbol_spec.name !== row.mt5_symbol) {
      errors.push(`rows[${index}].terminal_symbol_spec.name must match mt5_symbol`);
    }
    if (row.availability_status === "available") {
      if (!Number.isInteger(row.returned_bars) || row.returned_bars < 1) errors.push(`rows[${index}].returned_bars must be positive for available history`);
      if (!hasText(row.coverage_start_utc, 10) || !hasText(row.coverage_end_utc, 10)) errors.push(`rows[${index}].coverage window is required for available history`);
      if (!SHA256_PATTERN.test(String(row.bars_sha256 || ""))) errors.push(`rows[${index}].bars_sha256 is required for available history`);
    }
    if (row.availability_status === "blocked" && !hasText(row.blocked_reason, 3)) errors.push(`rows[${index}].blocked_reason is required for blocked history`);
  }

  const expectedCounts = {
    total: Array.isArray(manifest.rows) ? manifest.rows.length : 0,
    available: Array.isArray(manifest.rows) ? manifest.rows.filter((row) => row.availability_status === "available").length : 0,
    blocked: Array.isArray(manifest.rows) ? manifest.rows.filter((row) => row.availability_status === "blocked").length : 0
  };
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (manifest.counts?.[key] !== value) errors.push(`counts.${key} must equal ${value}`);
  }

  if (errors.length > 0) throw new Error(`broker history export manifest validation failed: ${errors.join("; ")}`);
  return true;
}

export function writeMt5HistoryAvailabilityManifestFromRequest({
  rootDir = process.cwd(),
  request,
  observedAt = new Date().toISOString()
} = {}) {
  const paths = buildPaths(rootDir);
  validateMt5HistoryAvailabilityRequest(request, { rootDir: paths.root });
  const manifestId = hasText(request.manifest_id, 3) ? request.manifest_id.trim() : defaultManifestId(observedAt);

  const { fullPath: universeFullPath, value: universeSnapshot } = readJsonRepoRelative(paths.root, request.universe_snapshot_path, "universe_snapshot_path");
  validateUniverseSnapshot(universeSnapshot);
  const symbolsByName = universeSymbolIndex(universeSnapshot);

  const rows = request.history_snapshot_paths.map((snapshotPath) => {
    const { fullPath, value: snapshot } = readJsonRepoRelative(paths.root, snapshotPath, "history_snapshot_paths[]");
    validateSnapshot(snapshot, snapshotPath);
    const symbolSpec = symbolsByName.get(snapshot.request.symbol);
    if (!symbolSpec) throw new Error(`MT5 history availability snapshot symbol is not present in universe snapshot: ${snapshot.request.symbol}`);
    return rowFromSnapshot({
      snapshot,
      snapshotArtifact: artifactRecord(paths.root, fullPath, snapshot.status === "succeeded" ? "mt5_history_snapshot" : "blocked_mt5_history_snapshot"),
      symbolSpec
    });
  });

  const manifest = {
    schema_version: BROKER_HISTORY_EXPORT_MANIFEST_SCHEMA_VERSION,
    evidence_kind: "broker_history_export_manifest",
    manifest_id: manifestId,
    observed_at: observedAt,
    generation_mode: "mt5_snapshot_artifact_history_availability",
    universe_snapshot: artifactRecord(paths.root, universeFullPath, "mt5_tradable_universe_snapshot"),
    counts: {
      total: rows.length,
      available: rows.filter((row) => row.availability_status === "available").length,
      blocked: rows.filter((row) => row.availability_status === "blocked").length
    },
    rows
  };
  validateBrokerHistoryExportManifest(manifest);

  const outputDir = request.output_dir
    ? resolveRepoRelativePath(paths.root, request.output_dir, "output_dir")
    : path.join(paths.mt5, "history-availability", sanitizePathPart(manifestId));
  const manifestPath = path.join(outputDir, "manifest.json");
  writeJsonAtomic(manifestPath, manifest, paths);

  return {
    status: "ready",
    evidence_kind: "broker_history_export_manifest",
    manifest_id: manifestId,
    observed_at: observedAt,
    artifacts: {
      manifest: artifactRecord(paths.root, manifestPath, "broker_history_export_manifest"),
      universe_snapshot: artifactRecord(paths.root, universeFullPath, "mt5_tradable_universe_snapshot")
    },
    counts: manifest.counts,
    manifest
  };
}

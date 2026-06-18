import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const DATA_RELEVANCE_CLASSIFICATION_SCHEMA_VERSION = "data_relevance_classification_v1";
export const DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION = "data_relevance_classification_request_v1";

const CLASSIFICATIONS = new Set(["mt5_verified", "mt5_proxy", "non_mt5_research_only"]);

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`data relevance ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`data relevance ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function readJsonRepoRelative(rootDir, repoRelativePath, label) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, label);
  if (!fs.existsSync(fullPath)) throw new Error(`data relevance ${label} is missing on disk: ${repoRelativePath}`);
  return { fullPath, value: JSON.parse(fs.readFileSync(fullPath, "utf8")) };
}

function normalize(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function symbolIndex(universeSnapshot) {
  const symbols = asArray(universeSnapshot?.symbols);
  const byName = new Map();
  const byNormalizedName = new Map();
  for (const symbol of symbols) {
    if (!hasText(symbol?.name)) continue;
    byName.set(symbol.name.trim(), symbol);
    byNormalizedName.set(normalize(symbol.name), symbol);
  }
  return { byName, byNormalizedName };
}

function classifyInstrument(instrument, indexes) {
  const requestedMt5Symbol = hasText(instrument.mt5_symbol) ? instrument.mt5_symbol.trim() : null;
  const sourceSymbol = hasText(instrument.source_symbol) ? instrument.source_symbol.trim() : null;
  const exact = requestedMt5Symbol
    ? indexes.byName.get(requestedMt5Symbol) ?? null
    : null;
  const normalizedSource = sourceSymbol ? indexes.byNormalizedName.get(normalize(sourceSymbol)) ?? null : null;

  if (exact) {
    return {
      classification: "mt5_verified",
      mt5_symbol: exact.name,
      mapping_basis: "explicit_mt5_symbol_found_in_terminal_snapshot",
      reason: "Requested MT5 symbol exists exactly in the supplied terminal universe snapshot.",
      symbol_spec: exact
    };
  }

  if (!requestedMt5Symbol && normalizedSource) {
    return {
      classification: "mt5_verified",
      mt5_symbol: normalizedSource.name,
      mapping_basis: "source_symbol_normalizes_to_terminal_symbol_name",
      reason: "Source symbol normalizes to an exact terminal symbol name; quote/session/cost equivalence still needs separate validation.",
      symbol_spec: normalizedSource
    };
  }

  return {
    classification: "non_mt5_research_only",
    mt5_symbol: requestedMt5Symbol,
    mapping_basis: "no_terminal_symbol_match_in_snapshot",
    reason: "No matching MT5 terminal symbol exists in the supplied universe snapshot; this data cannot advance as MT5-bound evidence without later equivalence proof.",
    symbol_spec: null
  };
}

function normalizeClassificationId(value, observedAt) {
  if (hasText(value, 3)) return value.trim();
  return `DATA-RELEVANCE-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "data-relevance-classification";
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

function validateUniverseSnapshotForClassification(universeSnapshot, repoRelativePath) {
  if (!universeSnapshot || typeof universeSnapshot !== "object" || Array.isArray(universeSnapshot)) {
    throw new Error(`data relevance universe snapshot is invalid: ${repoRelativePath}`);
  }
  if (universeSnapshot.schema_version !== "mt5_tradable_universe_snapshot_v1") {
    throw new Error("data relevance universe snapshot must use schema_version mt5_tradable_universe_snapshot_v1.");
  }
  if (universeSnapshot.status === "blocked" || hasText(universeSnapshot.blocked_reason)) {
    throw new Error(`data relevance universe snapshot is blocked: ${universeSnapshot.blocked_reason || "status is blocked"}`);
  }
  if (universeSnapshot.evidence_kind && universeSnapshot.evidence_kind !== "mt5_tradable_universe_snapshot") {
    throw new Error("data relevance universe snapshot evidence_kind must be mt5_tradable_universe_snapshot when provided.");
  }
  if (!Array.isArray(universeSnapshot.symbols) || universeSnapshot.symbols.length === 0) {
    throw new Error("data relevance universe snapshot must include non-empty symbols[].");
  }
}

function researchInstrumentsFrom(value, sourceDescription) {
  const rows = Array.isArray(value) ? value : value?.research_instruments ?? value?.instruments;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`data relevance research instruments must be a non-empty array from ${sourceDescription}.`);
  }
  return rows;
}

export function validateDataRelevanceClassificationRequest(request, { rootDir = process.cwd() } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("data relevance classification request must be an object.");
  if (request.schema_version !== DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION) {
    throw new Error(`data relevance classification request schema_version must be ${DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION}.`);
  }
  if (!hasText(request.universe_snapshot_path)) throw new Error("data relevance classification request requires universe_snapshot_path.");
  resolveRepoRelativePath(rootDir, request.universe_snapshot_path, "universe_snapshot_path");
  if (request.research_instruments_path !== undefined && request.research_instruments_path !== null) {
    resolveRepoRelativePath(rootDir, request.research_instruments_path, "research_instruments_path");
  }
  if (!Array.isArray(request.research_instruments) && !hasText(request.research_instruments_path)) {
    throw new Error("data relevance classification request requires research_instruments or research_instruments_path.");
  }
  if (request.output_dir !== undefined && request.output_dir !== null) {
    resolveRepoRelativePath(rootDir, request.output_dir, "output_dir");
  }
  return true;
}

export function buildDataRelevanceClassification({
  classificationId,
  observedAt,
  universeSnapshotArtifact,
  researchInstrumentsSource = null,
  universeSnapshot,
  researchInstruments
}) {
  const indexes = symbolIndex(universeSnapshot);
  const rows = asArray(researchInstruments).map((instrument) => {
    const result = classifyInstrument(instrument, indexes);
    return {
      instrument_id: instrument.instrument_id ?? instrument.source_symbol ?? instrument.mt5_symbol ?? null,
      source_family: instrument.source_family ?? null,
      source_symbol: instrument.source_symbol ?? null,
      timeframe: instrument.timeframe ?? null,
      requested_mt5_symbol: instrument.mt5_symbol ?? null,
      ...result
    };
  });

  return {
    schema_version: DATA_RELEVANCE_CLASSIFICATION_SCHEMA_VERSION,
    evidence_kind: "data_relevance_classification",
    classification_id: classificationId,
    observed_at: observedAt,
    universe_snapshot: universeSnapshotArtifact,
    research_instruments_source: researchInstrumentsSource,
    counts: {
      total: rows.length,
      mt5_verified: rows.filter((row) => row.classification === "mt5_verified").length,
      mt5_proxy: rows.filter((row) => row.classification === "mt5_proxy").length,
      non_mt5_research_only: rows.filter((row) => row.classification === "non_mt5_research_only").length
    },
    rows
  };
}

export function validateDataRelevanceClassification(classification) {
  const errors = [];
  if (!classification || typeof classification !== "object" || Array.isArray(classification)) throw new Error("data relevance classification is missing or invalid.");
  if (classification.schema_version !== DATA_RELEVANCE_CLASSIFICATION_SCHEMA_VERSION) errors.push(`schema_version must be ${DATA_RELEVANCE_CLASSIFICATION_SCHEMA_VERSION}`);
  if (classification.evidence_kind !== "data_relevance_classification") errors.push("evidence_kind must be data_relevance_classification");
  if (!hasText(classification.classification_id, 3)) errors.push("classification_id is required");
  if (!hasText(classification.observed_at, 10)) errors.push("observed_at is required");
  if (!classification.universe_snapshot || typeof classification.universe_snapshot !== "object") errors.push("universe_snapshot artifact reference is required");
  if (!hasText(classification.universe_snapshot?.path, 3)) errors.push("universe_snapshot.path is required");
  if (!/^[a-f0-9]{64}$/i.test(String(classification.universe_snapshot?.sha256 || ""))) errors.push("universe_snapshot.sha256 must be a valid sha256");
  if (!Array.isArray(classification.rows) || classification.rows.length === 0) errors.push("rows must be a non-empty array");

  for (const [index, row] of asArray(classification.rows).entries()) {
    if (!CLASSIFICATIONS.has(row?.classification)) errors.push(`rows[${index}].classification is unsupported`);
    if (!hasText(row?.mapping_basis, 3)) errors.push(`rows[${index}].mapping_basis is required`);
    if (!hasText(row?.reason, 8)) errors.push(`rows[${index}].reason is required`);
    if (row?.classification === "mt5_verified") {
      if (!hasText(row?.mt5_symbol, 1)) errors.push(`rows[${index}].mt5_symbol is required for mt5_verified`);
      if (!row?.symbol_spec || typeof row.symbol_spec !== "object" || Array.isArray(row.symbol_spec)) errors.push(`rows[${index}].symbol_spec terminal evidence is required for mt5_verified`);
      if (hasText(row?.mt5_symbol, 1) && hasText(row?.symbol_spec?.name, 1) && row.mt5_symbol !== row.symbol_spec.name) errors.push(`rows[${index}].mt5_symbol must match symbol_spec.name for mt5_verified`);
      if (!String(row?.mapping_basis || "").includes("terminal")) errors.push(`rows[${index}].mapping_basis must cite terminal evidence for mt5_verified`);
    }
  }

  const expectedCounts = {
    total: asArray(classification.rows).length,
    mt5_verified: asArray(classification.rows).filter((row) => row.classification === "mt5_verified").length,
    mt5_proxy: asArray(classification.rows).filter((row) => row.classification === "mt5_proxy").length,
    non_mt5_research_only: asArray(classification.rows).filter((row) => row.classification === "non_mt5_research_only").length
  };
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (classification.counts?.[key] !== value) errors.push(`counts.${key} must equal ${value}`);
  }

  if (errors.length > 0) throw new Error(`data relevance classification validation failed: ${errors.join("; ")}`);
  return true;
}

export function writeDataRelevanceClassificationFromRequest({
  rootDir = process.cwd(),
  request,
  observedAt = new Date().toISOString()
} = {}) {
  const paths = buildPaths(rootDir);
  validateDataRelevanceClassificationRequest(request, { rootDir: paths.root });

  const classificationId = normalizeClassificationId(request.classification_id ?? request.classificationId, observedAt);
  const { fullPath: universeFullPath, value: universeSnapshot } = readJsonRepoRelative(paths.root, request.universe_snapshot_path, "universe_snapshot_path");
  validateUniverseSnapshotForClassification(universeSnapshot, request.universe_snapshot_path);

  let researchInstruments;
  let researchInstrumentsSource;
  if (hasText(request.research_instruments_path)) {
    const { fullPath, value } = readJsonRepoRelative(paths.root, request.research_instruments_path, "research_instruments_path");
    researchInstruments = researchInstrumentsFrom(value, request.research_instruments_path);
    researchInstrumentsSource = {
      mode: "repo_relative_json",
      path: repoRelative(paths.root, fullPath),
      sha256: sha256File(fullPath)
    };
  } else {
    researchInstruments = researchInstrumentsFrom(request.research_instruments, "inline request");
    researchInstrumentsSource = {
      mode: "inline_request",
      path: null,
      sha256: null
    };
  }

  const universeSnapshotArtifact = {
    artifact_type: "mt5_tradable_universe_snapshot",
    path: repoRelative(paths.root, universeFullPath),
    sha256: sha256File(universeFullPath)
  };
  const classification = buildDataRelevanceClassification({
    classificationId,
    observedAt,
    universeSnapshotArtifact,
    universeSnapshot,
    researchInstruments,
    researchInstrumentsSource
  });
  validateDataRelevanceClassification(classification);

  const outputDir = request.output_dir
    ? resolveRepoRelativePath(paths.root, request.output_dir, "output_dir")
    : path.join(paths.mt5, "data-relevance", sanitizePathPart(classificationId));
  const classificationPath = path.join(outputDir, "classification.json");
  writeJsonAtomic(classificationPath, classification, paths);
  const classificationArtifact = artifactRecord(paths.root, classificationPath, "data_relevance_classification");

  return {
    status: "ready",
    evidence_kind: "data_relevance_classification",
    classification_id: classificationId,
    observed_at: observedAt,
    artifacts: {
      classification: classificationArtifact,
      universe_snapshot: universeSnapshotArtifact,
      research_instruments: researchInstrumentsSource
    },
    counts: classification.counts,
    classification
  };
}

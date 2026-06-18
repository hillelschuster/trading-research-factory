import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const PHASE8A_EXIT_READINESS_SCHEMA_VERSION = "phase8a_exit_readiness_report_v1";

const DEFAULT_ARTIFACT_PATHS = {
  universeSnapshot: "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json",
  universeSummary: "factory/mt5/universe-analysis/FTMO-UNIVERSE-SUMMARY-20260519T081345Z-WFA-VENV/summary.json",
  terminalInventory: "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json",
  dataRelevanceClassification: "factory/mt5/data-relevance/DATA-RELEVANCE-CURRENT-REPO-20260519T081345Z/classification.json",
  priorityHistoryManifest: "factory/mt5/history-availability/MT5-HISTORY-AVAILABILITY-PRIORITY-20260519T081345Z-WFA-VENV/manifest.json",
  artifactRegistration: "factory/mt5/artifact-registration/PHASE8A-MT5-MULTI-ASSET-HISTORY-20260519T081345Z-WFA-VENV/registration.json"
};

const REQUIRED_ASSET_CLASSES = ["fx", "index_cfd", "metal_cfd", "energy_commodity_cfd", "stock_cfd", "crypto_cfd"];
const REQUIRED_PRIORITY_HISTORY_SYMBOLS = ["EURUSD", "US100.cash", "XAUUSD", "USOIL.cash", "AAPL", "BTCUSD"];

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoPath(paths, fullPath) {
  return path.relative(paths.root, fullPath).replace(/\\/g, "/");
}

function resolveRepoPath(paths, repoRelativePath) {
  const fullPath = path.resolve(paths.root, repoRelativePath);
  const relative = path.relative(paths.root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Phase 8A exit-readiness path escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function artifactRecord(paths, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return {
    artifact_type: artifactType,
    path: repoPath(paths, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

function readJsonArtifact(paths, repoRelativePath, artifactType) {
  const fullPath = resolveRepoPath(paths, repoRelativePath);
  if (!fs.existsSync(fullPath)) {
    return { exists: false, path: repoRelativePath, artifact_type: artifactType };
  }
  return {
    exists: true,
    path: repoRelativePath,
    fullPath,
    value: JSON.parse(fs.readFileSync(fullPath, "utf8")),
    artifact: artifactRecord(paths, fullPath, artifactType)
  };
}

function readIfExists(fullPath) {
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function criterion(id, status, evidence = [], pending = [], details = {}) {
  return { id, status, met: status === "met", evidence, pending, details };
}

function artifactEvidence(...records) {
  return records.filter((record) => record?.exists).map((record) => record.path);
}

function sameArtifact(left, right) {
  return hasText(left?.path, 3) && hasText(right?.path, 3) && left.path === right.path && left.sha256 === right.sha256;
}

function universeSnapshotCriterion(universe) {
  const value = universe.value;
  const symbolCount = Array.isArray(value?.symbols) ? value.symbols.length : 0;
  const ok = universe.exists
    && value?.schema_version === "mt5_tradable_universe_snapshot_v1"
    && value?.evidence_kind === "mt5_tradable_universe_snapshot"
    && value?.status === "succeeded"
    && symbolCount > 0
    && value?.symbol_count_total === symbolCount
    && hasText(value?.server, 3)
    && hasText(value?.company, 3)
    && hasText(value?.account_login_hash_or_id, 16);
  return criterion(
    "real_ftmo_universe_snapshot",
    ok ? "met" : "pending",
    artifactEvidence(universe),
    ["A succeeded disk-backed FTMO MT5 universe snapshot with symbols, account/server/company context, and symbol counts is required."],
    ok ? { symbol_count_total: value.symbol_count_total, server: value.server, company: value.company, sha256: universe.artifact.sha256 } : {}
  );
}

function cryptoInventoryCriterion(summary, inventory, universe) {
  const cryptoSymbols = Array.isArray(inventory.value?.symbols)
    ? inventory.value.symbols.filter((symbol) => symbol.terminal_asset_class === "crypto_cfd")
    : [];
  const count = inventory.value?.counts?.by_terminal_asset_class?.crypto_cfd ?? 0;
  const exactSpecs = cryptoSymbols.every((symbol) => hasText(symbol.name)
    && hasText(symbol.path)
    && symbol.path.startsWith("Crypto")
    && symbol.terminal_asset_class === "crypto_cfd"
    && Number.isFinite(symbol.digits)
    && symbol.trade_contract_size !== null
    && symbol.volume_min !== null
    && symbol.volume_max !== null
    && symbol.volume_step !== null);
  const universeMatches = sameArtifact(inventory.value?.source_universe_snapshot, universe.artifact)
    && sameArtifact(summary.value?.source_universe_snapshot, universe.artifact);
  const summaryCount = summary.value?.counts?.crypto_cfd_by_terminal_path;
  const ok = summary.exists
    && inventory.exists
    && inventory.value?.schema_version === "phase8a_mt5_terminal_inventory_v1"
    && inventory.value?.official_evidence_index_mutated === false
    && universeMatches
    && count === cryptoSymbols.length
    && summaryCount === count
    && (count === 0 || exactSpecs);
  return criterion(
    "crypto_cfd_terminal_inventory",
    ok ? "met" : "pending",
    artifactEvidence(summary, inventory),
    ["Crypto CFDs must be listed by terminal path/spec evidence, or explicit absence must be recorded."],
    ok ? { crypto_cfd_count: count, heuristic_crypto_like_false_positives: summary.value?.counts?.heuristic_crypto_like_false_positives ?? null } : {}
  );
}

function multiAssetInventoryCriterion(inventory) {
  const classCounts = inventory.value?.counts?.by_terminal_asset_class ?? {};
  const missing = REQUIRED_ASSET_CLASSES.filter((assetClass) => !Number.isInteger(classCounts[assetClass]) || classCounts[assetClass] < 1);
  const ok = inventory.exists && inventory.value?.counts?.total_symbols > 0 && missing.length === 0;
  return criterion(
    "multi_asset_terminal_scope",
    ok ? "met" : "pending",
    artifactEvidence(inventory),
    missing.length > 0 ? [`Missing terminal asset class coverage: ${missing.join(", ")}`] : ["Phase 8A must remain multi-asset, not crypto-only."],
    ok ? { by_terminal_asset_class: classCounts } : { missing_asset_classes: missing }
  );
}

function priorityHistoryCriterion(history, universe) {
  const rows = Array.isArray(history.value?.rows) ? history.value.rows : [];
  const availableSymbols = new Set(rows.filter((row) => row.availability_status === "available" && row.timeframe === "H1" && row.returned_bars >= 5000).map((row) => row.mt5_symbol));
  const missing = REQUIRED_PRIORITY_HISTORY_SYMBOLS.filter((symbol) => !availableSymbols.has(symbol));
  const symbolSpecsOk = rows.every((row) => row.terminal_symbol_spec?.name === row.mt5_symbol && hasText(row.source_snapshot?.path, 3) && hasText(row.source_snapshot?.sha256, 64));
  const ok = history.exists
    && history.value?.schema_version === "broker_history_export_manifest_v1"
    && history.value?.counts?.total === rows.length
    && history.value?.counts?.available === REQUIRED_PRIORITY_HISTORY_SYMBOLS.length
    && history.value?.counts?.blocked === 0
    && sameArtifact(history.value?.universe_snapshot, universe.artifact)
    && missing.length === 0
    && symbolSpecsOk;
  return criterion(
    "priority_broker_history_availability",
    ok ? "met" : "pending",
    artifactEvidence(history),
    missing.length > 0 ? [`Missing available H1/5000 priority history probes: ${missing.join(", ")}`] : ["Priority cross-asset MT5 history availability manifest is required."],
    ok ? { available: history.value.counts.available, blocked: history.value.counts.blocked, symbols: REQUIRED_PRIORITY_HISTORY_SYMBOLS } : { missing_symbols: missing }
  );
}

function dataRoadmapCriterion(classification, universe) {
  const rows = Array.isArray(classification.value?.rows) ? classification.value.rows : [];
  const counts = classification.value?.counts ?? {};
  const rowsAreFiltered = rows.length > 0 && rows.every((row) => ["mt5_verified", "mt5_proxy", "non_mt5_research_only"].includes(row.classification));
  const verifiedRowsHaveTerminalEvidence = rows.filter((row) => row.classification === "mt5_verified").every((row) => row.symbol_spec?.name === row.mt5_symbol && String(row.mapping_basis ?? "").includes("terminal"));
  const currentRepoHasNoMt5BoundRows = counts.mt5_verified === 0 && counts.mt5_proxy === 0 && counts.non_mt5_research_only === rows.length;
  const ok = classification.exists
    && classification.value?.schema_version === "data_relevance_classification_v1"
    && sameArtifact(classification.value?.universe_snapshot, universe.artifact)
    && counts.total === rows.length
    && rowsAreFiltered
    && verifiedRowsHaveTerminalEvidence
    && currentRepoHasNoMt5BoundRows;
  return criterion(
    "data_expansion_roadmap_filtered_by_mt5_relevance",
    ok ? "met" : "pending",
    artifactEvidence(classification),
    ["Current repo research data must be classified against the real MT5 universe and must not be treated as MT5-bound without equivalence evidence."],
    ok ? { counts } : { counts }
  );
}

function noCandidateWithoutEquivalenceCriterion(classification, spec, equivalenceSource, tests) {
  const counts = classification.value?.counts ?? {};
  const currentRepoHasNoMt5BoundRows = counts.mt5_verified === 0 && counts.mt5_proxy === 0;
  const policyDocumented = spec.includes("no MT5-bound candidate advances without `mt5_instrument_equivalence` evidence");
  const validatorPresent = equivalenceSource.includes("mt5_verified")
    && equivalenceSource.includes("terminal_symbol_spec must match mt5_symbol")
    && equivalenceSource.includes("broker_history_manifest universe_snapshot must match data_relevance_classification universe_snapshot");
  const testsPresent = tests.includes("MT5 instrument equivalence rejects broker history from a different universe snapshot")
    && tests.includes("MT5 instrument equivalence writer combines classification, source data identities, and broker history");
  const ok = currentRepoHasNoMt5BoundRows && policyDocumented && validatorPresent && testsPresent;
  return criterion(
    "no_mt5_bound_candidate_without_equivalence",
    ok ? "met" : "pending",
    ["factory/mt5-ftmo-strategy-factory-spec.md", "src/core/mt5-instrument-equivalence.mjs", "tests/data-readiness.test.mjs"],
    ["No current dataset may advance as MT5-bound unless terminal-backed mt5_instrument_equivalence evidence exists."],
    { current_repo_mt5_verified: counts.mt5_verified ?? null, current_repo_mt5_proxy: counts.mt5_proxy ?? null }
  );
}

function registrationCriterion(registration) {
  const kinds = registration.value?.status_summary?.by_evidence_kind ?? {};
  const ok = registration.exists
    && registration.value?.schema_version === "phase8a_mt5_artifact_registration_v1"
    && registration.value?.official_evidence_index_mutated === false
    && registration.value?.status_summary?.blocked === 0
    && kinds.phase8a_mt5_terminal_inventory === 1
    && kinds.broker_history_export_manifest === 1
    && kinds.mt5_snapshot === REQUIRED_PRIORITY_HISTORY_SYMBOLS.length;
  return criterion(
    "non_authoritative_artifact_registration",
    ok ? "met" : "pending",
    artifactEvidence(registration),
    ["Phase 8A closeout evidence should be registered as non-authoritative inventory without mutating official factory evidence/state."],
    ok ? { status_summary: registration.value.status_summary } : {}
  );
}

function phaseBoundaryCriterion(spec, registrationSource, packageJson) {
  const specBoundary = spec.includes("#### Phase 8B - Bounded ResearchBrain And Knowledge System")
    && spec.includes("Phase 8B ResearchBrain contracts are specified")
    && spec.includes("Phase 8E must not begin from Python-only evidence");
  const registrationRejectsResearchBrain = registrationSource.includes("FORBIDDEN_PHASE8B_RESEARCH_KINDS")
    && registrationSource.includes("ResearchBrain artifact");
  const noResearchBrainScript = !packageJson.includes("researchbrain") && !packageJson.includes("ResearchBrain");
  const ok = specBoundary && registrationRejectsResearchBrain && noResearchBrainScript;
  return criterion(
    "phase8b_plus_boundary_not_started",
    ok ? "met" : "pending",
    ["factory/mt5-ftmo-strategy-factory-spec.md", "src/core/mt5-artifact-registration.mjs", "package.json"],
    ["Phase 8A closeout must not start ResearchBrain, WFA hardening, screening, tester parity, or deployment work."],
    { researchbrain_started: !noResearchBrainScript ? "possible_package_script_present" : false }
  );
}

export function buildPhase8AExitReadinessReport({
  rootDir = process.cwd(),
  generatedAt = new Date().toISOString(),
  artifactPaths = DEFAULT_ARTIFACT_PATHS
} = {}) {
  const paths = buildPaths(rootDir);
  const specPath = path.join(paths.root, "factory/mt5-ftmo-strategy-factory-spec.md");
  const equivalencePath = path.join(paths.root, "src/core/mt5-instrument-equivalence.mjs");
  const registrationSourcePath = path.join(paths.root, "src/core/mt5-artifact-registration.mjs");
  const dataReadinessTestPath = path.join(paths.root, "tests/data-readiness.test.mjs");
  const packagePath = path.join(paths.root, "package.json");

  const spec = readIfExists(specPath);
  const equivalenceSource = readIfExists(equivalencePath);
  const registrationSource = readIfExists(registrationSourcePath);
  const tests = readIfExists(dataReadinessTestPath);
  const packageJson = readIfExists(packagePath);

  const universe = readJsonArtifact(paths, artifactPaths.universeSnapshot, "mt5_tradable_universe_snapshot");
  const summary = readJsonArtifact(paths, artifactPaths.universeSummary, "phase8a_ftmo_universe_summary");
  const inventory = readJsonArtifact(paths, artifactPaths.terminalInventory, "phase8a_mt5_terminal_inventory");
  const classification = readJsonArtifact(paths, artifactPaths.dataRelevanceClassification, "data_relevance_classification");
  const history = readJsonArtifact(paths, artifactPaths.priorityHistoryManifest, "broker_history_export_manifest");
  const registration = readJsonArtifact(paths, artifactPaths.artifactRegistration, "phase8a_mt5_artifact_registration");

  const criteria = [
    universeSnapshotCriterion(universe),
    cryptoInventoryCriterion(summary, inventory, universe),
    multiAssetInventoryCriterion(inventory),
    priorityHistoryCriterion(history, universe),
    dataRoadmapCriterion(classification, universe),
    noCandidateWithoutEquivalenceCriterion(classification, spec, equivalenceSource, tests),
    registrationCriterion(registration),
    phaseBoundaryCriterion(spec, registrationSource, packageJson)
  ];

  const met = criteria.filter((item) => item.met).length;
  const pending = criteria.filter((item) => item.status === "pending").length;
  const artifacts = [universe, summary, inventory, classification, history, registration]
    .filter((record) => record.exists)
    .map((record) => record.artifact);

  return {
    schema_version: PHASE8A_EXIT_READINESS_SCHEMA_VERSION,
    phase: "8A",
    generated_at: generatedAt,
    status: pending === 0 ? "ready_to_close" : "not_ready_to_close",
    summary: { criteria_total: criteria.length, criteria_met: met, criteria_pending: pending, criteria_deferred: 0 },
    criteria,
    artifacts,
    authority: {
      official_evidence_index_mutated: false,
      phase8b_researchbrain_started: false,
      phase8c_wfa_hardening_started: false,
      phase8d_screening_started: false,
      phase8e_tester_parity_started: false,
      mt5_bound_candidate_advanced_without_equivalence: false
    },
    closeout_verdict: pending === 0
      ? "Phase 8A exit criteria are satisfied by disk-backed MT5/FTMO universe, terminal inventory, current-data relevance, broker-history availability, and non-authoritative registration artifacts."
      : "Phase 8A is not ready to close; inspect pending criteria."
  };
}

export function writePhase8AExitReadinessReport(pathsOrRoot, report = buildPhase8AExitReadinessReport({ rootDir: pathsOrRoot.root ?? pathsOrRoot })) {
  const paths = buildPaths(pathsOrRoot.root ?? pathsOrRoot);
  const stamp = report.generated_at.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fullPath = path.join(paths.verification, `phase8a-exit-readiness-${stamp}.json`);
  writeJsonAtomic(fullPath, report, paths);
  return { path: fullPath, payload: report };
}

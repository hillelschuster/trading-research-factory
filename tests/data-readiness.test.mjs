import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { spawnSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { DATA_READINESS_MANIFEST_SCHEMA_VERSION, readAndValidateDataReadinessManifest, validateDataReadinessManifest } from "../src/core/data-readiness.mjs";
import { DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION, buildDataRelevanceClassification, validateDataRelevanceClassification, writeDataRelevanceClassificationFromRequest } from "../src/core/mt5-data-relevance.mjs";
import { MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION, validateBrokerHistoryExportManifest, writeMt5HistoryAvailabilityManifestFromRequest } from "../src/core/mt5-history-availability.mjs";
import { MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION, validateMt5InstrumentEquivalence, writeMt5InstrumentEquivalenceFromRequest } from "../src/core/mt5-instrument-equivalence.mjs";
import { PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION, validatePhase8AMt5ArtifactRegistration, writePhase8AMt5ArtifactRegistrationFromRequest } from "../src/core/mt5-artifact-registration.mjs";
import { MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION, validateMt5PythonEnvironmentDiagnostic, writeMt5PythonEnvironmentDiagnosticFromRequest } from "../src/core/mt5-environment-diagnostic.mjs";
import { MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION, validateMt5TerminalInventory, writeMt5TerminalInventoryFromRequest } from "../src/core/mt5-terminal-inventory.mjs";
import { PHASE8A_EXIT_READINESS_SCHEMA_VERSION, buildPhase8AExitReadinessReport, writePhase8AExitReadinessReport } from "../src/core/phase8a-exit-readiness.mjs";
import { BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION, buildBinanceUsdmFundingDataReadiness, buildBinanceUsdmFundingUrl, runBinanceUsdmFundingDataReadiness, runBinanceUsdmFundingRefreshRequest } from "../src/workers/binance-usdm-funding-data-readiness-worker.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "data-readiness-test-"));
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeFixture(rootDir, repoPath, content) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  return { path: repoPath, sha256: sha256Text(content), size_bytes: Buffer.byteLength(content) };
}

function writeJsonFixture(rootDir, repoPath, value) {
  return writeFixture(rootDir, repoPath, JSON.stringify(value, null, 2) + "\n");
}

function validManifest(rootDir) {
  const raw = writeFixture(rootDir, "workspace/data/binance/btcusdt_funding_raw.jsonl", "{\"fundingRate\":\"0.0001\",\"fundingTime\":1767225600000}\n");
  const normalized = writeFixture(rootDir, "workspace/data/binance/btcusdt_funding_8h.csv", "timestamp_utc,funding_rate\n2026-01-01T00:00:00Z,0.0001\n");
  return {
    schema_version: DATA_READINESS_MANIFEST_SCHEMA_VERSION,
    evidence_kind: "data_identity",
    dataset_id: "DATA-BINANCE-BTCUSDT-FUNDING-8H-20260101",
    source_family: "binance_usdm_funding",
    market: "crypto_derivatives",
    instrument: "BTCUSDT",
    timeframe: "8h",
    source: {
      source_url: "https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT",
      retrieved_at: "2026-01-01T00:05:00Z"
    },
    artifacts: { raw, normalized },
    coverage: {
      start_utc: "2026-01-01T00:00:00Z",
      end_utc: "2026-01-02T00:00:00Z",
      row_count: 3,
      timezone: "UTC"
    },
    gap_report: {
      checked: true,
      gap_count: 0,
      gaps: []
    },
    feature_lag_rules: [
      { field: "funding_rate", lag: "available_after_funding_timestamp", rationale: "Funding is only usable after the exchange-published funding time." }
    ],
    survivorship: {
      survivorship_bias_checked: true,
      universe_policy: "single currently listed Binance USD-M symbol; delisting survivorship is explicitly not generalized"
    },
    wfa_integration: {
      data_paths: [normalized.path]
    }
  };
}

function createPhase8AExitReadinessFixture(rootDir) {
  const universePath = "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json";
  const summaryPath = "factory/mt5/universe-analysis/FTMO-UNIVERSE-SUMMARY-20260519T081345Z-WFA-VENV/summary.json";
  const inventoryDir = "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV";
  const classificationDir = "factory/mt5/data-relevance/DATA-RELEVANCE-CURRENT-REPO-20260519T081345Z";
  const historyDir = "factory/mt5/history-availability/MT5-HISTORY-AVAILABILITY-PRIORITY-20260519T081345Z-WFA-VENV";
  const registrationDir = "factory/mt5/artifact-registration/PHASE8A-MT5-MULTI-ASSET-HISTORY-20260519T081345Z-WFA-VENV";
  const symbols = [
    { name: "EURUSD", path: "Forex\\EURUSD", description: "Euro vs United States Dollar", digits: 5, point: 0.00001, trade_mode: 4, trade_contract_size: 100000, volume_min: 0.01, volume_max: 50, volume_step: 0.01, spread: 2, swap_long: -1, swap_short: 0.2, currency_base: "EUR", currency_profit: "USD", currency_margin: "EUR", asset_class_hints: { asset_class_guess: "fx_like" } },
    { name: "US100.cash", path: "Cash CFD\\US100.cash", description: "NASDAQ 100 Index, Spot CFD", digits: 2, point: 0.01, trade_mode: 4, trade_contract_size: 1, volume_min: 0.1, volume_max: 100, volume_step: 0.1, spread: 120, swap_long: -1, swap_short: -1, asset_class_hints: { asset_class_guess: "index_like" } },
    { name: "XAUUSD", path: "Metals CFD\\XAUUSD", description: "Gold vs US Dollar, Spot CFD", digits: 2, point: 0.01, trade_mode: 4, trade_contract_size: 100, volume_min: 0.01, volume_max: 50, volume_step: 0.01, spread: 20, swap_long: -1, swap_short: -1, asset_class_hints: { asset_class_guess: "metal_like" } },
    { name: "USOIL.cash", path: "Cash II CFD\\USOIL.cash", description: "West Texas Intermediate Crude Oil, Spot CFD", digits: 3, point: 0.001, trade_mode: 4, trade_contract_size: 100, volume_min: 0.01, volume_max: 100, volume_step: 0.01, spread: 30, swap_long: -1, swap_short: -1, asset_class_hints: { asset_class_guess: "energy_like" } },
    { name: "AAPL", path: "Equities I CFD\\AAPL", description: "Apple, Spot CFD", digits: 2, point: 0.01, trade_mode: 4, trade_contract_size: 1, volume_min: 0.01, volume_max: 100, volume_step: 0.01, spread: 5, swap_long: -1, swap_short: -1, asset_class_hints: { asset_class_guess: "stock_like" } },
    { name: "BTCUSD", path: "Crypto I CFD\\BTCUSD", description: "Bitcoin vs US Dollar, Spot CFD", digits: 2, point: 0.01, trade_mode: 4, trade_contract_size: 1, volume_min: 0.01, volume_max: 5, volume_step: 0.01, spread: 100, swap_long: -30, swap_short: -30, asset_class_hints: { asset_class_guess: "crypto_like" } }
  ];

  writeJsonFixture(rootDir, "factory/mt5-ftmo-strategy-factory-spec.md", {
    note: "#### Phase 8B - Bounded ResearchBrain And Knowledge System; Phase 8B ResearchBrain contracts are specified; Phase 8E must not begin from Python-only evidence; no MT5-bound candidate advances without `mt5_instrument_equivalence` evidence"
  });
  writeFixture(rootDir, "src/core/mt5-instrument-equivalence.mjs", "mt5_verified terminal_symbol_spec must match mt5_symbol broker_history_manifest universe_snapshot must match data_relevance_classification universe_snapshot\n");
  writeFixture(rootDir, "src/core/mt5-artifact-registration.mjs", "FORBIDDEN_PHASE8B_RESEARCH_KINDS ResearchBrain artifact\n");
  writeFixture(rootDir, "tests/data-readiness.test.mjs", "MT5 instrument equivalence rejects broker history from a different universe snapshot\nMT5 instrument equivalence writer combines classification, source data identities, and broker history\n");
  writeJsonFixture(rootDir, "package.json", { scripts: { validate: "node scripts/validate-structure.mjs" } });

  const universe = {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    job_id: "JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV",
    observed_at: "2026-05-19T08:47:16.661Z",
    status: "succeeded",
    account_login_hash_or_id: "f".repeat(64),
    server: "FTMO-Demo",
    company: "FTMO Global Markets Ltd",
    terminal_build: 5833,
    symbol_count_total: symbols.length,
    symbol_count_crypto_like: 1,
    symbol_count_by_asset_class_guess: { fx_like: 1, index_like: 1, metal_like: 1, energy_like: 1, stock_like: 1, crypto_like: 1 },
    symbols
  };
  writeJsonFixture(rootDir, universePath, universe);
  const universeSha = sha256File(path.join(rootDir, universePath));

  const inventoryResult = writeMt5TerminalInventoryFromRequest({
    rootDir,
    observedAt: "2026-05-19T19:55:55.593Z",
    request: {
      schema_version: MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION,
      inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV",
      universe_snapshot_path: universePath,
      output_dir: inventoryDir
    }
  });

  writeJsonFixture(rootDir, summaryPath, {
    schema_version: "phase8a_ftmo_universe_summary_v1",
    evidence_kind: "phase8a_ftmo_universe_summary",
    summary_id: "FTMO-UNIVERSE-SUMMARY-20260519T081345Z-WFA-VENV",
    observed_at: "2026-05-19T09:05:20.841Z",
    authority_layer: "derived_from_mt5_terminal_snapshot",
    official_evidence_index_mutated: false,
    source_universe_snapshot: { path: universePath, sha256: universeSha, job_id: universe.job_id, observed_at: universe.observed_at, status: "succeeded" },
    terminal: { company: "FTMO Global Markets Ltd", server: "FTMO-Demo" },
    counts: { total_symbols: symbols.length, crypto_cfd_by_terminal_path: 1, heuristic_crypto_like_false_positives: 0 },
    crypto_cfds_terminal_path_verified: [symbols[5]]
  });

  const snapshotPaths = symbols.map((symbol) => {
    const clean = symbol.name.replace(/\.cash$/, "").replace(/[^A-Za-z0-9]+/g, "");
    const snapshotPath = `factory/mt5/environment/JOB-MT5-HISTORY-PROBE-20260519T081345Z-${clean}-H1/snapshot.json`;
    writeJsonFixture(rootDir, snapshotPath, {
      schema_version: "mt5_environment_snapshot_v1",
      evidence_kind: "mt5_snapshot",
      status: "succeeded",
      job_id: `JOB-MT5-HISTORY-PROBE-20260519T081345Z-${clean}-H1`,
      request: { symbol: symbol.name, timeframe: "H1", bars: 5000 },
      observations: {
        account: { server: "FTMO-Demo" },
        data_identity: {
          provider: "MetaTrader5 terminal",
          source_type: "mt5_terminal_rates",
          symbol: symbol.name,
          timeframe: "H1",
          requested_bars: 5000,
          returned_bars: 5000,
          coverage_start_utc: "2025-01-01T00:00:00Z",
          coverage_end_utc: "2026-05-19T00:00:00Z",
          quote_basis: "broker_terminal_bid_ohlc",
          server: "FTMO-Demo",
          bars_sha256: sha256Text(symbol.name)
        }
      },
      blocked_reason: null
    });
    return snapshotPath;
  });

  const historyResult = writeMt5HistoryAvailabilityManifestFromRequest({
    rootDir,
    observedAt: "2026-05-19T20:01:22.227Z",
    request: {
      schema_version: MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION,
      manifest_id: "MT5-HISTORY-AVAILABILITY-PRIORITY-20260519T081345Z-WFA-VENV",
      universe_snapshot_path: universePath,
      history_snapshot_paths: snapshotPaths,
      output_dir: historyDir
    }
  });

  const classificationResult = writeDataRelevanceClassificationFromRequest({
    rootDir,
    observedAt: "2026-05-19T09:07:03.481Z",
    request: {
      schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
      classification_id: "DATA-RELEVANCE-CURRENT-REPO-20260519T081345Z",
      universe_snapshot_path: universePath,
      research_instruments: [{ instrument_id: "DATA-BINANCE-BTCUSDT-1H-REPO-CURRENT", source_family: "binance_repo_csv", source_symbol: "BTCUSDT", timeframe: "1h" }],
      output_dir: classificationDir
    }
  });

  const registrationResult = writePhase8AMt5ArtifactRegistrationFromRequest({
    rootDir,
    observedAt: "2026-05-19T20:02:31.296Z",
    request: {
      schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION,
      registration_id: "PHASE8A-MT5-MULTI-ASSET-HISTORY-20260519T081345Z-WFA-VENV",
      artifact_paths: [inventoryResult.artifacts.inventory.path, ...snapshotPaths, historyResult.artifacts.manifest.path],
      output_dir: registrationDir
    }
  });

  return { universePath, summaryPath, inventoryPath: inventoryResult.artifacts.inventory.path, classificationPath: classificationResult.artifacts.classification.path, historyPath: historyResult.artifacts.manifest.path, registrationPath: registrationResult.artifacts.registration.path };
}

test("data-readiness manifest accepts a minimal valid manifest and verifies hashes", () => {
  const rootDir = tempRoot();
  const manifest = validManifest(rootDir);

  assert.equal(validateDataReadinessManifest(manifest, { rootDir }), true);
});

test("data relevance classification requires MT5 terminal symbol evidence", () => {
  const universeSnapshot = {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    symbols: [
      { name: "EURUSD", asset_class_hints: { asset_class_guess: "fx_like" }, digits: 5 },
      { name: "BTCUSD", asset_class_hints: { asset_class_guess: "crypto_like" }, digits: 2 }
    ]
  };
  const classification = buildDataRelevanceClassification({
    classificationId: "DATA-RELEVANCE-FIXTURE-001",
    observedAt: "2026-05-18T00:00:00Z",
    universeSnapshotArtifact: {
      path: "factory/mt5/environment/JOB-FIXTURE/universe-snapshot.json",
      sha256: "1".repeat(64)
    },
    universeSnapshot,
    researchInstruments: [
      { instrument_id: "EURUSD-DUKASCOPY", source_family: "dukascopy", source_symbol: "EURUSD", timeframe: "M15" },
      { instrument_id: "ETHUSDT-BINANCE", source_family: "binance", source_symbol: "ETHUSDT", timeframe: "1h" }
    ]
  });

  assert.equal(classification.counts.total, 2);
  assert.equal(classification.counts.mt5_verified, 1);
  assert.equal(classification.counts.non_mt5_research_only, 1);
  assert.equal(classification.rows[0].classification, "mt5_verified");
  assert.equal(classification.rows[0].mt5_symbol, "EURUSD");
  assert.equal(classification.rows[1].classification, "non_mt5_research_only");
  assert.match(classification.rows[1].reason, /No matching MT5 terminal symbol/i);
  assert.equal(validateDataRelevanceClassification(classification), true);
});

test("data relevance classification validation rejects unsupported promotion shortcuts", () => {
  const classification = {
    schema_version: "data_relevance_classification_v1",
    evidence_kind: "data_relevance_classification",
    classification_id: "DATA-RELEVANCE-BAD-001",
    observed_at: "2026-05-18T00:00:00Z",
    universe_snapshot: { path: "factory/mt5/environment/JOB-FIXTURE/universe-snapshot.json", sha256: "1".repeat(64) },
    counts: { total: 1, mt5_verified: 1, mt5_proxy: 0, non_mt5_research_only: 0 },
    rows: [{ classification: "mt5_verified", mt5_symbol: null, mapping_basis: "web_name_similarity", reason: "looks close" }]
  };

  assert.throws(() => validateDataRelevanceClassification(classification), /mt5_symbol is required/i);
});

test("data relevance classification writer reads hash-backed universe snapshot and instrument file", () => {
  const rootDir = tempRoot();
  const universe = {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [
      { name: "EURUSD", asset_class_hints: { asset_class_guess: "fx_like" }, digits: 5 },
      { name: "XAUUSD", asset_class_hints: { asset_class_guess: "metal_like" }, digits: 2 }
    ]
  };
  const universePath = "factory/mt5/environment/JOB-FIXTURE/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify(universe, null, 2) + "\n", "utf8");
  const instrumentsPath = "workspace/data/research-instruments.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, instrumentsPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, instrumentsPath), JSON.stringify([
    { instrument_id: "EURUSD-DATA", source_family: "dukascopy", source_symbol: "EURUSD", timeframe: "M15" },
    { instrument_id: "ETHUSDT-DATA", source_family: "binance", source_symbol: "ETHUSDT", timeframe: "1h" }
  ], null, 2) + "\n", "utf8");

  const result = writeDataRelevanceClassificationFromRequest({
    rootDir,
    observedAt: "2026-05-18T12:00:00.000Z",
    request: {
      schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
      classification_id: "DATA-RELEVANCE-WRITER-FIXTURE",
      universe_snapshot_path: universePath,
      research_instruments_path: instrumentsPath
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.artifacts.universe_snapshot.sha256, sha256File(path.join(rootDir, universePath)));
  assert.equal(result.artifacts.research_instruments.sha256, sha256File(path.join(rootDir, instrumentsPath)));
  assert.equal(result.counts.mt5_verified, 1);
  assert.equal(result.counts.non_mt5_research_only, 1);
  assert.equal(fs.existsSync(path.join(rootDir, result.artifacts.classification.path)), true);
  const persisted = JSON.parse(fs.readFileSync(path.join(rootDir, result.artifacts.classification.path), "utf8"));
  assert.equal(persisted.universe_snapshot.sha256, sha256File(path.join(rootDir, universePath)));
  assert.equal(persisted.rows[0].classification, "mt5_verified");
  assert.equal(persisted.rows[0].symbol_spec.name, "EURUSD");
  assert.equal(persisted.rows[1].classification, "non_mt5_research_only");
  assert.equal(validateDataRelevanceClassification(persisted), true);
});

test("data relevance classification writer fails loud for blocked universe snapshots", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-BLOCKED/blocked-universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "blocked",
    blocked_reason: "MetaTrader5 import failed",
    symbols: []
  }, null, 2) + "\n", "utf8");

  assert.throws(
    () => writeDataRelevanceClassificationFromRequest({
      rootDir,
      request: {
        schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
        classification_id: "DATA-RELEVANCE-BLOCKED-FIXTURE",
        universe_snapshot_path: universePath,
        research_instruments: [{ instrument_id: "EURUSD", source_symbol: "EURUSD" }]
      }
    }),
    /universe snapshot is blocked/i
  );
});

test("data relevance classification CLI supports inline request instruments", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-CLI/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "BTCUSD", asset_class_hints: { asset_class_guess: "crypto_like" }, digits: 2 }]
  }, null, 2) + "\n", "utf8");
  const requestPath = "factory/mt5/data-relevance/cli-request.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, requestPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, requestPath), JSON.stringify({
    schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
    classification_id: "DATA-RELEVANCE-CLI-FIXTURE",
    universe_snapshot_path: universePath,
    research_instruments: [
      { instrument_id: "BTCUSD-TERMINAL", source_symbol: "BTCUSD", timeframe: "H1" },
      { instrument_id: "SOLUSDT-EXCHANGE", source_symbol: "SOLUSDT", timeframe: "H1" }
    ]
  }, null, 2) + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-mt5-data-relevance-classification.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--request", requestPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.counts.mt5_verified, 1);
  assert.equal(parsed.counts.non_mt5_research_only, 1);
  assert.equal(fs.existsSync(path.join(rootDir, parsed.artifacts.classification.path)), true);
});

test("MT5 history availability manifest writer records available and blocked symbol snapshots", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-HISTORY-UNIVERSE/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [
      { name: "EURUSD", digits: 5, asset_class_hints: { asset_class_guess: "fx_like" } },
      { name: "XAUUSD", digits: 2, asset_class_hints: { asset_class_guess: "metal_like" } }
    ]
  }, null, 2) + "\n", "utf8");
  const eurusdSnapshotPath = "factory/mt5/environment/JOB-HISTORY-EURUSD/snapshot.json";
  const xauusdSnapshotPath = "factory/mt5/environment/JOB-HISTORY-XAUUSD/blocked-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, eurusdSnapshotPath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(rootDir, xauusdSnapshotPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, eurusdSnapshotPath), JSON.stringify({
    schema_version: "mt5_environment_snapshot_v1",
    evidence_kind: "mt5_snapshot",
    status: "succeeded",
    request: { symbol: "EURUSD", timeframe: "M15", bars: 256 },
    observations: {
      account: { server: "FTMO-Demo" },
      data_identity: {
        provider: "MetaTrader5 terminal",
        source_type: "mt5_terminal_rates",
        symbol: "EURUSD",
        timeframe: "M15",
        requested_bars: 256,
        returned_bars: 256,
        coverage_start_utc: "2026-05-15T00:00:00Z",
        coverage_end_utc: "2026-05-18T00:00:00Z",
        quote_basis: "broker_terminal_bid_ohlc",
        server: "FTMO-Demo",
        bars_sha256: "a".repeat(64)
      }
    },
    blocked_reason: null
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(rootDir, xauusdSnapshotPath), JSON.stringify({
    schema_version: "mt5_environment_snapshot_v1",
    evidence_kind: "mt5_snapshot",
    status: "blocked",
    request: { symbol: "XAUUSD", timeframe: "H1", bars: 128 },
    observations: {},
    blocked_reason: "rates unavailable in fixture",
    diagnostics: { message: "rates unavailable in fixture" }
  }, null, 2) + "\n", "utf8");

  const result = writeMt5HistoryAvailabilityManifestFromRequest({
    rootDir,
    observedAt: "2026-05-18T13:00:00.000Z",
    request: {
      schema_version: MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION,
      manifest_id: "MT5-HISTORY-AVAILABILITY-FIXTURE",
      universe_snapshot_path: universePath,
      history_snapshot_paths: [eurusdSnapshotPath, xauusdSnapshotPath]
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.counts.total, 2);
  assert.equal(result.counts.available, 1);
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.artifacts.universe_snapshot.sha256, sha256File(path.join(rootDir, universePath)));
  assert.equal(fs.existsSync(path.join(rootDir, result.artifacts.manifest.path)), true);
  const persisted = JSON.parse(fs.readFileSync(path.join(rootDir, result.artifacts.manifest.path), "utf8"));
  assert.equal(persisted.rows[0].availability_status, "available");
  assert.equal(persisted.rows[0].returned_bars, 256);
  assert.equal(persisted.rows[0].source_snapshot.sha256, sha256File(path.join(rootDir, eurusdSnapshotPath)));
  assert.equal(persisted.rows[1].availability_status, "blocked");
  assert.match(persisted.rows[1].blocked_reason, /rates unavailable/i);
  assert.equal(validateBrokerHistoryExportManifest(persisted), true);
});

test("MT5 history availability manifest writer rejects snapshots outside supplied universe", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-HISTORY-MISMATCH/universe-snapshot.json";
  const snapshotPath = "factory/mt5/environment/JOB-HISTORY-GBPUSD/snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(rootDir, snapshotPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "EURUSD", asset_class_hints: { asset_class_guess: "fx_like" } }]
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(rootDir, snapshotPath), JSON.stringify({
    schema_version: "mt5_environment_snapshot_v1",
    evidence_kind: "mt5_snapshot",
    status: "succeeded",
    request: { symbol: "GBPUSD", timeframe: "M15", bars: 64 },
    observations: { data_identity: { returned_bars: 64, coverage_start_utc: "2026-05-17T00:00:00Z", coverage_end_utc: "2026-05-18T00:00:00Z", bars_sha256: "b".repeat(64) } },
    blocked_reason: null
  }, null, 2) + "\n", "utf8");

  assert.throws(
    () => writeMt5HistoryAvailabilityManifestFromRequest({
      rootDir,
      request: {
        schema_version: MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION,
        manifest_id: "MT5-HISTORY-AVAILABILITY-MISMATCH",
        universe_snapshot_path: universePath,
        history_snapshot_paths: [snapshotPath]
      }
    }),
    /not present in universe snapshot/i
  );
});

test("MT5 history availability CLI writes a fixture manifest", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-HISTORY-CLI/universe-snapshot.json";
  const snapshotPath = "factory/mt5/environment/JOB-HISTORY-CLI-BTCUSD/snapshot.json";
  const requestPath = "factory/mt5/history-availability/request.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(rootDir, snapshotPath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(rootDir, requestPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "BTCUSD", digits: 2, asset_class_hints: { asset_class_guess: "crypto_like" } }]
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(rootDir, snapshotPath), JSON.stringify({
    schema_version: "mt5_environment_snapshot_v1",
    evidence_kind: "mt5_snapshot",
    status: "succeeded",
    request: { symbol: "BTCUSD", timeframe: "H1", bars: 100 },
    observations: {
      data_identity: {
        returned_bars: 100,
        coverage_start_utc: "2026-05-14T00:00:00Z",
        coverage_end_utc: "2026-05-18T00:00:00Z",
        bars_sha256: "c".repeat(64)
      }
    },
    blocked_reason: null
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(rootDir, requestPath), JSON.stringify({
    schema_version: MT5_HISTORY_AVAILABILITY_REQUEST_SCHEMA_VERSION,
    manifest_id: "MT5-HISTORY-AVAILABILITY-CLI-FIXTURE",
    universe_snapshot_path: universePath,
    history_snapshot_paths: [snapshotPath]
  }, null, 2) + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-mt5-history-availability-manifest.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--request", requestPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.counts.available, 1);
  assert.equal(fs.existsSync(path.join(rootDir, parsed.artifacts.manifest.path)), true);
});

test("MT5 terminal inventory writer builds multi-asset priority probes from universe snapshot", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-INVENTORY/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    job_id: "JOB-INVENTORY",
    status: "succeeded",
    observed_at: "2026-05-19T08:00:00.000Z",
    terminal_build: 5833,
    server: "FTMO-Demo",
    company: "FTMO Global Markets Ltd",
    observations: { terminal: { name: "FTMO Global Markets MT5 Terminal", build: 5833, company: "FTMO Global Markets Ltd" }, account: { server: "FTMO-Demo" } },
    symbols: [
      { name: "EURUSD", path: "Forex\\EURUSD", description: "Euro vs United States Dollar", digits: 5, visible: true, select: true, asset_class_hints: { asset_class_guess: "fx_like" } },
      { name: "US100.cash", path: "Cash CFD\\US100.cash", description: "NASDAQ 100 Index, Spot CFD", digits: 2, asset_class_hints: { asset_class_guess: "index_like" } },
      { name: "XAUUSD", path: "Metals CFD\\XAUUSD", description: "Gold vs US Dollar, Spot CFD", digits: 2, asset_class_hints: { asset_class_guess: "metal_like" } },
      { name: "USOIL.cash", path: "Cash II CFD\\USOIL.cash", description: "West Texas Intermediate Crude Oil, Spot CFD", digits: 3, asset_class_hints: { asset_class_guess: "energy_like" } },
      { name: "AAPL", path: "Equities I CFD\\AAPL", description: "Apple, Spot CFD", digits: 2, asset_class_hints: { asset_class_guess: "stock_like" } },
      { name: "BTCUSD", path: "Crypto I CFD\\BTCUSD", description: "Bitcoin vs US Dollar, Spot CFD", digits: 2, asset_class_hints: { asset_class_guess: "crypto_like" } }
    ]
  }, null, 2) + "\n", "utf8");

  const result = writeMt5TerminalInventoryFromRequest({
    rootDir,
    observedAt: "2026-05-19T10:00:00.000Z",
    request: {
      schema_version: MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION,
      inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-FIXTURE",
      universe_snapshot_path: universePath
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.counts.total_symbols, 6);
  assert.equal(result.counts.by_terminal_asset_class.fx, 1);
  assert.equal(result.counts.by_terminal_asset_class.index_cfd, 1);
  assert.equal(result.counts.by_terminal_asset_class.energy_commodity_cfd, 1);
  assert.deepEqual(result.priority_history_probe_symbols.map((row) => row.priority_class), ["fx", "index", "metal", "commodity_energy", "stock", "crypto"]);
  assert.equal(fs.existsSync(path.join(rootDir, result.artifacts.inventory.path)), true);
  const persisted = JSON.parse(fs.readFileSync(path.join(rootDir, result.artifacts.inventory.path), "utf8"));
  assert.equal(persisted.official_evidence_index_mutated, false);
  assert.equal(persisted.priority_history_probe_symbols[0].terminal_symbol_spec.name, "EURUSD");
  assert.equal(validateMt5TerminalInventory(persisted), true);
});

test("MT5 terminal inventory CLI writes a fixture inventory", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-INVENTORY-CLI/universe-snapshot.json";
  const requestPath = "factory/mt5/universe-analysis/inventory-request.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(rootDir, requestPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "BTCUSD", path: "Crypto I CFD\\BTCUSD", description: "Bitcoin vs US Dollar, Spot CFD", asset_class_hints: { asset_class_guess: "crypto_like" } }]
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(rootDir, requestPath), JSON.stringify({
    schema_version: MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION,
    inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-CLI-FIXTURE",
    universe_snapshot_path: universePath
  }, null, 2) + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-mt5-terminal-inventory.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--request", requestPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.inventory.evidence_kind, "phase8a_mt5_terminal_inventory");
  assert.equal(fs.existsSync(path.join(rootDir, parsed.artifacts.inventory.path)), true);
});

test("Phase 8A MT5 artifact registration accepts terminal inventory artifacts", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-INVENTORY-REG/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "BTCUSD", path: "Crypto I CFD\\BTCUSD", description: "Bitcoin vs US Dollar, Spot CFD", asset_class_hints: { asset_class_guess: "crypto_like" } }]
  }, null, 2) + "\n", "utf8");
  const inventoryResult = writeMt5TerminalInventoryFromRequest({
    rootDir,
    observedAt: "2026-05-19T10:02:00.000Z",
    request: {
      schema_version: MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION,
      inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-REG-FIXTURE",
      universe_snapshot_path: universePath
    }
  });

  const result = writePhase8AMt5ArtifactRegistrationFromRequest({
    rootDir,
    observedAt: "2026-05-19T10:03:00.000Z",
    request: {
      schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION,
      registration_id: "PHASE8A-MT5-INVENTORY-REGISTRATION-FIXTURE",
      artifact_paths: [inventoryResult.artifacts.inventory.path]
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.registration.status_summary.by_evidence_kind.phase8a_mt5_terminal_inventory, 1);
  assert.equal(result.registration.artifacts[0].summary.inventory_id, "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-REG-FIXTURE");
  assert.equal(validatePhase8AMt5ArtifactRegistration(result.registration), true);
});

test("Phase 8A exit-readiness report closes only from disk-backed MT5 readiness artifacts", () => {
  const rootDir = tempRoot();
  createPhase8AExitReadinessFixture(rootDir);

  const report = buildPhase8AExitReadinessReport({ rootDir, generatedAt: "2026-05-19T21:00:00.000Z" });

  assert.equal(report.schema_version, PHASE8A_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(report.status, "ready_to_close");
  assert.equal(report.summary.criteria_pending, 0);
  assert.equal(report.criteria.every((item) => item.met), true);
  assert.equal(report.authority.phase8b_researchbrain_started, false);
  assert.equal(report.authority.mt5_bound_candidate_advanced_without_equivalence, false);
  assert.equal(report.criteria.find((item) => item.id === "multi_asset_terminal_scope").details.by_terminal_asset_class.crypto_cfd, 1);
  assert.equal(report.criteria.find((item) => item.id === "data_expansion_roadmap_filtered_by_mt5_relevance").details.counts.non_mt5_research_only, 1);
});

test("Phase 8A exit-readiness CLI writes a report artifact", () => {
  const rootDir = tempRoot();
  createPhase8AExitReadinessFixture(rootDir);

  const scriptPath = path.resolve("scripts/run-phase8a-exit-readiness.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.report.status, "ready_to_close");
  assert.equal(fs.existsSync(parsed.path), true);
  const persisted = JSON.parse(fs.readFileSync(parsed.path, "utf8"));
  assert.equal(persisted.schema_version, PHASE8A_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(persisted.summary.criteria_pending, 0);
});

test("Phase 8A exit-readiness remains open when current repo data is MT5-bound without equivalence", () => {
  const rootDir = tempRoot();
  const paths = createPhase8AExitReadinessFixture(rootDir);
  const classificationFullPath = path.join(rootDir, paths.classificationPath);
  const classification = JSON.parse(fs.readFileSync(classificationFullPath, "utf8"));
  classification.counts = { total: 1, mt5_verified: 1, mt5_proxy: 0, non_mt5_research_only: 0 };
  classification.rows = [{
    ...classification.rows[0],
    classification: "mt5_verified",
    mt5_symbol: "BTCUSD",
    mapping_basis: "explicit_mt5_symbol_found_in_terminal_snapshot",
    symbol_spec: { name: "BTCUSD" }
  }];
  fs.writeFileSync(classificationFullPath, JSON.stringify(classification, null, 2) + "\n", "utf8");

  const report = buildPhase8AExitReadinessReport({ rootDir, generatedAt: "2026-05-19T21:01:00.000Z" });

  assert.equal(report.status, "not_ready_to_close");
  assert.equal(report.criteria.find((item) => item.id === "data_expansion_roadmap_filtered_by_mt5_relevance").status, "pending");
  assert.equal(report.criteria.find((item) => item.id === "no_mt5_bound_candidate_without_equivalence").status, "pending");
});

test("Phase 8A exit-readiness writer persists deterministic verification artifact", () => {
  const rootDir = tempRoot();
  createPhase8AExitReadinessFixture(rootDir);
  const report = buildPhase8AExitReadinessReport({ rootDir, generatedAt: "2026-05-19T21:02:00.000Z" });
  const write = writePhase8AExitReadinessReport(rootDir, report);

  assert.equal(path.relative(rootDir, write.path).replace(/\\/g, "/"), "factory/verification/phase8a-exit-readiness-20260519T210200Z.json");
  assert.equal(fs.existsSync(write.path), true);
  const persisted = JSON.parse(fs.readFileSync(write.path, "utf8"));
  assert.equal(persisted.status, "ready_to_close");
});

test("MT5 instrument equivalence writer combines classification, source data identities, and broker history", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-EQUIV-UNIVERSE/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "EURUSD", digits: 5, spread: 8, trade_contract_size: 100000, asset_class_hints: { asset_class_guess: "fx_like" } }]
  }, null, 2) + "\n", "utf8");
  const classificationResult = writeDataRelevanceClassificationFromRequest({
    rootDir,
    observedAt: "2026-05-18T14:00:00.000Z",
    request: {
      schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
      classification_id: "DATA-RELEVANCE-EQUIV-FIXTURE",
      universe_snapshot_path: universePath,
      research_instruments: [
        { instrument_id: "EURUSD-DUKASCOPY", source_family: "dukascopy_ohlcv", source_symbol: "EURUSD", timeframe: "M15" },
        { instrument_id: "ETHUSDT-BINANCE", source_family: "binance_spot_ohlcv", source_symbol: "ETHUSDT", timeframe: "1h" }
      ]
    }
  });
  const eurusdRaw = writeFixture(rootDir, "workspace/data/dukascopy/eurusd_m15_raw.csv", "timestamp,open\n2026-05-18T00:00:00Z,1.0\n");
  const eurusdNormalized = writeFixture(rootDir, "workspace/data/dukascopy/eurusd_m15.csv", "timestamp,open\n2026-05-18T00:00:00Z,1.0\n");
  const ethRaw = writeFixture(rootDir, "workspace/data/binance/ethusdt_1h_raw.csv", "timestamp,open\n2026-05-18T00:00:00Z,3000\n");
  const ethNormalized = writeFixture(rootDir, "workspace/data/binance/ethusdt_1h.csv", "timestamp,open\n2026-05-18T00:00:00Z,3000\n");
  const eurusdDataPath = "workspace/data/dukascopy/eurusd_m15_manifest.json";
  const ethDataPath = "workspace/data/binance/ethusdt_1h_manifest.json";
  fs.writeFileSync(path.join(rootDir, eurusdDataPath), JSON.stringify({
    schema_version: DATA_READINESS_MANIFEST_SCHEMA_VERSION,
    evidence_kind: "data_identity",
    dataset_id: "DATA-DUKASCOPY-EURUSD-M15",
    source_family: "dukascopy_ohlcv",
    market: "forex",
    instrument: "EURUSD",
    timeframe: "M15",
    source: { source_url: "https://example.test/dukascopy/eurusd", retrieved_at: "2026-05-18T14:00:00Z" },
    artifacts: { raw: eurusdRaw, normalized: eurusdNormalized },
    coverage: { start_utc: "2026-05-17T00:00:00Z", end_utc: "2026-05-18T00:00:00Z", row_count: 96, timezone: "UTC" },
    gap_report: { checked: true, gap_count: 0, gaps: [] },
    feature_lag_rules: [{ field: "ohlcv", lag: "bar_close", rationale: "Bar data is usable only after bar close." }],
    survivorship: { survivorship_bias_checked: true, universe_policy: "single FX symbol fixture; no broad universe claim" },
    wfa_integration: { data_paths: [eurusdNormalized.path] }
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(rootDir, ethDataPath), JSON.stringify({
    schema_version: DATA_READINESS_MANIFEST_SCHEMA_VERSION,
    evidence_kind: "data_identity",
    dataset_id: "DATA-BINANCE-ETHUSDT-1H",
    source_family: "binance_spot_ohlcv",
    market: "crypto_spot",
    instrument: "ETHUSDT",
    timeframe: "1h",
    source: { source_url: "https://api.binance.com/api/v3/klines?symbol=ETHUSDT", retrieved_at: "2026-05-18T14:00:00Z" },
    artifacts: { raw: ethRaw, normalized: ethNormalized },
    coverage: { start_utc: "2026-05-17T00:00:00Z", end_utc: "2026-05-18T00:00:00Z", row_count: 24, timezone: "UTC" },
    gap_report: { checked: true, gap_count: 0, gaps: [] },
    feature_lag_rules: [{ field: "ohlcv", lag: "bar_close", rationale: "Bar data is usable only after bar close." }],
    survivorship: { survivorship_bias_checked: true, universe_policy: "single crypto fixture; no broad universe claim" },
    wfa_integration: { data_paths: [ethNormalized.path] }
  }, null, 2) + "\n", "utf8");
  const historyPath = "factory/mt5/history-availability/MT5-HISTORY-EQUIV/manifest.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, historyPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, historyPath), JSON.stringify({
    schema_version: "broker_history_export_manifest_v1",
    evidence_kind: "broker_history_export_manifest",
    manifest_id: "MT5-HISTORY-EQUIV",
    observed_at: "2026-05-18T14:00:00Z",
    universe_snapshot: { path: universePath, sha256: sha256File(path.join(rootDir, universePath)) },
    counts: { total: 1, available: 1, blocked: 0 },
    rows: [{
      mt5_symbol: "EURUSD",
      timeframe: "M15",
      availability_status: "available",
      returned_bars: 256,
      coverage_start_utc: "2026-05-15T00:00:00Z",
      coverage_end_utc: "2026-05-18T00:00:00Z",
      bars_sha256: "d".repeat(64),
      quote_basis: "broker_terminal_bid_ohlc",
      terminal_symbol_spec: { name: "EURUSD", digits: 5, asset_class_hints: { asset_class_guess: "fx_like" } },
      source_snapshot: { path: "factory/mt5/environment/JOB-EQUIV-EURUSD/snapshot.json", sha256: "e".repeat(64) }
    }]
  }, null, 2) + "\n", "utf8");

  const result = writeMt5InstrumentEquivalenceFromRequest({
    rootDir,
    observedAt: "2026-05-18T14:05:00.000Z",
    request: {
      schema_version: MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION,
      equivalence_id: "MT5-INSTRUMENT-EQUIVALENCE-FIXTURE",
      data_relevance_classification_path: classificationResult.artifacts.classification.path,
      broker_history_manifest_path: historyPath,
      source_data_identity_paths: [eurusdDataPath, ethDataPath]
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.counts.mt5_verified, 1);
  assert.equal(result.counts.non_mt5_research_only, 1);
  assert.equal(fs.existsSync(path.join(rootDir, result.artifacts.equivalence.path)), true);
  const persisted = JSON.parse(fs.readFileSync(path.join(rootDir, result.artifacts.equivalence.path), "utf8"));
  assert.equal(persisted.rows[0].classification, "mt5_verified");
  assert.equal(persisted.rows[0].terminal_symbol_spec.name, "EURUSD");
  assert.equal(persisted.rows[0].broker_history.availability_status, "available");
  assert.match(persisted.rows[0].promotion_note, /parity are not proven/i);
  assert.equal(persisted.rows[1].classification, "non_mt5_research_only");
  assert.equal(persisted.rows[1].terminal_symbol_spec, null);
  assert.equal(validateMt5InstrumentEquivalence(persisted), true);
});

test("MT5 history availability manifest validation requires terminal symbol evidence", () => {
  assert.throws(
    () => validateBrokerHistoryExportManifest({
      schema_version: "broker_history_export_manifest_v1",
      evidence_kind: "broker_history_export_manifest",
      manifest_id: "MT5-HISTORY-MISSING-SPEC",
      observed_at: "2026-05-18T14:00:00Z",
      universe_snapshot: { path: "factory/mt5/environment/JOB/universe-snapshot.json", sha256: "1".repeat(64) },
      counts: { total: 1, available: 1, blocked: 0 },
      rows: [{
        mt5_symbol: "EURUSD",
        timeframe: "M15",
        availability_status: "available",
        returned_bars: 256,
        coverage_start_utc: "2026-05-15T00:00:00Z",
        coverage_end_utc: "2026-05-18T00:00:00Z",
        bars_sha256: "2".repeat(64),
        source_snapshot: { path: "factory/mt5/environment/JOB/snapshot.json", sha256: "3".repeat(64) }
      }]
    }),
    /terminal_symbol_spec is required/i
  );
});

test("MT5 instrument equivalence rejects broker history from a different universe snapshot", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-EQUIV-MISMATCH-UNIVERSE/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "EURUSD", digits: 5, asset_class_hints: { asset_class_guess: "fx_like" } }]
  }, null, 2) + "\n", "utf8");
  const classificationResult = writeDataRelevanceClassificationFromRequest({
    rootDir,
    request: {
      schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
      classification_id: "DATA-RELEVANCE-EQUIV-MISMATCH",
      universe_snapshot_path: universePath,
      research_instruments: [{ instrument_id: "EURUSD-DATA", source_family: "dukascopy_ohlcv", source_symbol: "EURUSD", timeframe: "M15" }]
    }
  });
  const raw = writeFixture(rootDir, "workspace/data/dukascopy/mismatch_raw.csv", "timestamp,open\n2026-05-18T00:00:00Z,1.0\n");
  const normalized = writeFixture(rootDir, "workspace/data/dukascopy/mismatch.csv", "timestamp,open\n2026-05-18T00:00:00Z,1.0\n");
  const dataPath = "workspace/data/dukascopy/mismatch_manifest.json";
  fs.writeFileSync(path.join(rootDir, dataPath), JSON.stringify({
    schema_version: DATA_READINESS_MANIFEST_SCHEMA_VERSION,
    evidence_kind: "data_identity",
    dataset_id: "DATA-DUKASCOPY-EURUSD-M15-MISMATCH",
    source_family: "dukascopy_ohlcv",
    market: "forex",
    instrument: "EURUSD",
    timeframe: "M15",
    source: { source_url: "https://example.test/dukascopy/eurusd", retrieved_at: "2026-05-18T14:00:00Z" },
    artifacts: { raw, normalized },
    coverage: { start_utc: "2026-05-17T00:00:00Z", end_utc: "2026-05-18T00:00:00Z", row_count: 96, timezone: "UTC" },
    gap_report: { checked: true, gap_count: 0, gaps: [] },
    feature_lag_rules: [{ field: "ohlcv", lag: "bar_close", rationale: "Bar data is usable only after bar close." }],
    survivorship: { survivorship_bias_checked: true, universe_policy: "single FX symbol fixture; no broad universe claim" },
    wfa_integration: { data_paths: [normalized.path] }
  }, null, 2) + "\n", "utf8");
  const historyPath = "factory/mt5/history-availability/MT5-HISTORY-MISMATCH/manifest.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, historyPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, historyPath), JSON.stringify({
    schema_version: "broker_history_export_manifest_v1",
    evidence_kind: "broker_history_export_manifest",
    manifest_id: "MT5-HISTORY-MISMATCH",
    observed_at: "2026-05-18T14:00:00Z",
    universe_snapshot: { path: "factory/mt5/environment/OTHER/universe-snapshot.json", sha256: "4".repeat(64) },
    counts: { total: 1, available: 1, blocked: 0 },
    rows: [{
      mt5_symbol: "EURUSD",
      timeframe: "M15",
      availability_status: "available",
      returned_bars: 256,
      coverage_start_utc: "2026-05-15T00:00:00Z",
      coverage_end_utc: "2026-05-18T00:00:00Z",
      bars_sha256: "5".repeat(64),
      terminal_symbol_spec: { name: "EURUSD", digits: 5, asset_class_hints: { asset_class_guess: "fx_like" } },
      source_snapshot: { path: "factory/mt5/environment/JOB-EQUIV-EURUSD/snapshot.json", sha256: "6".repeat(64) }
    }]
  }, null, 2) + "\n", "utf8");

  assert.throws(
    () => writeMt5InstrumentEquivalenceFromRequest({
      rootDir,
      request: {
        schema_version: MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION,
        equivalence_id: "MT5-INSTRUMENT-EQUIVALENCE-UNIVERSE-MISMATCH",
        data_relevance_classification_path: classificationResult.artifacts.classification.path,
        broker_history_manifest_path: historyPath,
        source_data_identity_paths: [dataPath]
      }
    }),
    /universe_snapshot must match/i
  );
});

test("MT5 instrument equivalence writer fails loud when source data identity is missing", () => {
  const rootDir = tempRoot();
  const classificationPath = "factory/mt5/data-relevance/MISSING/equivalence-input.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, classificationPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, classificationPath), JSON.stringify({
    schema_version: "data_relevance_classification_v1",
    evidence_kind: "data_relevance_classification",
    classification_id: "DATA-RELEVANCE-MISSING-SOURCE",
    observed_at: "2026-05-18T14:00:00Z",
    universe_snapshot: { path: "factory/mt5/environment/JOB/universe-snapshot.json", sha256: "f".repeat(64) },
    counts: { total: 1, mt5_verified: 0, mt5_proxy: 0, non_mt5_research_only: 1 },
    rows: [{ instrument_id: "ETHUSDT", classification: "non_mt5_research_only", mt5_symbol: null, source_symbol: "ETHUSDT", source_family: "binance_spot_ohlcv", timeframe: "1h", mapping_basis: "no_terminal_symbol_match_in_snapshot", reason: "No matching MT5 terminal symbol exists.", symbol_spec: null }]
  }, null, 2) + "\n", "utf8");
  const btcManifest = validManifest(rootDir);
  const btcManifestPath = "workspace/data/binance/btcusdt_funding_manifest.json";
  fs.writeFileSync(path.join(rootDir, btcManifestPath), JSON.stringify(btcManifest, null, 2) + "\n", "utf8");

  assert.throws(
    () => writeMt5InstrumentEquivalenceFromRequest({
      rootDir,
      request: {
        schema_version: MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION,
        equivalence_id: "MT5-INSTRUMENT-EQUIVALENCE-MISSING-SOURCE",
        data_relevance_classification_path: classificationPath,
        source_data_identity_paths: [btcManifestPath]
      }
    }),
    /missing source data identity/i
  );
});

test("MT5 instrument equivalence CLI writes a fixture artifact", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-EQUIV-CLI/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "BTCUSD", digits: 2, asset_class_hints: { asset_class_guess: "crypto_like" } }]
  }, null, 2) + "\n", "utf8");
  const classificationResult = writeDataRelevanceClassificationFromRequest({
    rootDir,
    request: {
      schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
      classification_id: "DATA-RELEVANCE-EQUIV-CLI",
      universe_snapshot_path: universePath,
      research_instruments: [{ instrument_id: "BTCUSD-FEED", source_family: "terminal_export", source_symbol: "BTCUSD", timeframe: "H1" }]
    }
  });
  const raw = writeFixture(rootDir, "workspace/data/terminal/btcusd_h1_raw.csv", "timestamp,open\n2026-05-18T00:00:00Z,100000\n");
  const normalized = writeFixture(rootDir, "workspace/data/terminal/btcusd_h1.csv", "timestamp,open\n2026-05-18T00:00:00Z,100000\n");
  const dataPath = "workspace/data/terminal/btcusd_h1_manifest.json";
  fs.writeFileSync(path.join(rootDir, dataPath), JSON.stringify({
    schema_version: DATA_READINESS_MANIFEST_SCHEMA_VERSION,
    evidence_kind: "data_identity",
    dataset_id: "DATA-TERMINAL-BTCUSD-H1",
    source_family: "terminal_export",
    market: "crypto_cfd",
    instrument: "BTCUSD",
    timeframe: "H1",
    source: { source_url: "https://example.test/terminal-export/btcusd", retrieved_at: "2026-05-18T14:00:00Z" },
    artifacts: { raw, normalized },
    coverage: { start_utc: "2026-05-17T00:00:00Z", end_utc: "2026-05-18T00:00:00Z", row_count: 24, timezone: "UTC" },
    gap_report: { checked: true, gap_count: 0, gaps: [] },
    feature_lag_rules: [{ field: "ohlcv", lag: "bar_close", rationale: "Bar data is usable only after bar close." }],
    survivorship: { survivorship_bias_checked: true, universe_policy: "single terminal-export fixture; no universe claim" },
    wfa_integration: { data_paths: [normalized.path] }
  }, null, 2) + "\n", "utf8");
  const requestPath = "factory/mt5/instrument-equivalence/request.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, requestPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, requestPath), JSON.stringify({
    schema_version: MT5_INSTRUMENT_EQUIVALENCE_REQUEST_SCHEMA_VERSION,
    equivalence_id: "MT5-INSTRUMENT-EQUIVALENCE-CLI-FIXTURE",
    data_relevance_classification_path: classificationResult.artifacts.classification.path,
    source_data_identity_paths: [dataPath]
  }, null, 2) + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-mt5-instrument-equivalence.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--request", requestPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.counts.mt5_verified, 1);
  assert.equal(fs.existsSync(path.join(rootDir, parsed.artifacts.equivalence.path)), true);
});

test("Phase 8A MT5 artifact registration writes non-authoritative hash-backed manifest", () => {
  const rootDir = tempRoot();
  const evidenceIndexPath = path.join(rootDir, "factory/evidence/index.json");
  fs.mkdirSync(path.dirname(evidenceIndexPath), { recursive: true });
  fs.writeFileSync(evidenceIndexPath, "[]\n", "utf8");
  const universePath = "factory/mt5/environment/JOB-REG-UNIVERSE/universe-snapshot.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    symbols: [{ name: "XAUUSD", digits: 2, asset_class_hints: { asset_class_guess: "metal_like" } }]
  }, null, 2) + "\n", "utf8");
  const classificationResult = writeDataRelevanceClassificationFromRequest({
    rootDir,
    request: {
      schema_version: DATA_RELEVANCE_CLASSIFICATION_REQUEST_SCHEMA_VERSION,
      classification_id: "DATA-RELEVANCE-REGISTRATION-FIXTURE",
      universe_snapshot_path: universePath,
      research_instruments: [{ instrument_id: "XAUUSD-DATA", source_family: "terminal_export", source_symbol: "XAUUSD", timeframe: "H1" }]
    }
  });

  const result = writePhase8AMt5ArtifactRegistrationFromRequest({
    rootDir,
    observedAt: "2026-05-18T15:00:00.000Z",
    request: {
      schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION,
      registration_id: "PHASE8A-MT5-REGISTRATION-FIXTURE",
      artifact_paths: [universePath, classificationResult.artifacts.classification.path]
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.official_evidence_index_mutated, false);
  assert.equal(result.artifacts.registered_artifacts.length, 2);
  assert.equal(result.artifacts.registered_artifacts[0].sha256, sha256File(path.join(rootDir, universePath)));
  assert.equal(fs.existsSync(path.join(rootDir, result.artifacts.registration.path)), true);
  const persisted = JSON.parse(fs.readFileSync(path.join(rootDir, result.artifacts.registration.path), "utf8"));
  assert.equal(persisted.artifacts[1].evidence_kind, "data_relevance_classification");
  assert.equal(persisted.official_evidence_index_mutated, false);
  assert.deepEqual(persisted.status_summary, {
    total: 2,
    ready: 2,
    blocked: 0,
    by_status: { succeeded: 1, ready: 1 },
    by_evidence_kind: { mt5_tradable_universe_snapshot: 1, data_relevance_classification: 1 }
  });
  assert.equal(fs.readFileSync(evidenceIndexPath, "utf8"), "[]\n");
  assert.equal(validatePhase8AMt5ArtifactRegistration(persisted), true);
});

test("Phase 8A MT5 artifact registration rejects Phase 8B ResearchBrain artifact kinds", () => {
  const rootDir = tempRoot();
  const artifactPath = "factory/mt5/artifact-registration/bad.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, artifactPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, artifactPath), JSON.stringify({
    schema_version: "research_ideation_manifest_v1",
    evidence_kind: "research_ideation_manifest"
  }, null, 2) + "\n", "utf8");

  assert.throws(
    () => writePhase8AMt5ArtifactRegistrationFromRequest({
      rootDir,
      request: {
        schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION,
        registration_id: "PHASE8A-MT5-REGISTRATION-BAD",
        artifact_paths: [artifactPath]
      }
    }),
    /Phase 8B\/ResearchBrain/i
  );
});

test("Phase 8A MT5 artifact registration validates safe paths and status summary counts", () => {
  const registration = {
    schema_version: "phase8a_mt5_artifact_registration_v1",
    evidence_kind: "phase8a_mt5_artifact_registration",
    registration_id: "PHASE8A-MT5-REGISTRATION-VALIDATION-FIXTURE",
    official_evidence_index_mutated: false,
    status_summary: {
      total: 1,
      ready: 1,
      blocked: 0,
      by_status: { ready: 1 },
      by_evidence_kind: { data_relevance_classification: 1 }
    },
    artifacts: [{
      evidence_kind: "data_relevance_classification",
      path: "../outside.json",
      sha256: "1".repeat(64),
      status: "ready"
    }]
  };

  assert.throws(
    () => validatePhase8AMt5ArtifactRegistration(registration),
    /safe repo-relative path/i
  );

  registration.artifacts[0].path = "factory/mt5/data-relevance/classification.json";
  registration.status_summary.ready = 0;
  assert.throws(
    () => validatePhase8AMt5ArtifactRegistration(registration),
    /status_summary\.ready must equal 1/i
  );

  registration.status_summary.ready = 1;
  assert.equal(validatePhase8AMt5ArtifactRegistration(registration), true);
});

test("Phase 8A MT5 artifact registration manifest validation rejects ResearchBrain artifacts", () => {
  const registration = {
    schema_version: "phase8a_mt5_artifact_registration_v1",
    evidence_kind: "phase8a_mt5_artifact_registration",
    registration_id: "PHASE8A-MT5-REGISTRATION-RESEARCHBRAIN-BAD",
    official_evidence_index_mutated: false,
    status_summary: {
      total: 1,
      ready: 1,
      blocked: 0,
      by_status: { ready: 1 },
      by_evidence_kind: { hypothesis_packet: 1 }
    },
    artifacts: [{
      evidence_kind: "hypothesis_packet",
      path: "factory/research/hypothesis-packet.json",
      sha256: "2".repeat(64),
      status: "ready"
    }]
  };

  assert.throws(
    () => validatePhase8AMt5ArtifactRegistration(registration),
    /Phase 8B\/ResearchBrain/i
  );
});

test("Phase 8A MT5 artifact registration CLI writes a fixture manifest", () => {
  const rootDir = tempRoot();
  const universePath = "factory/mt5/environment/JOB-REG-CLI/blocked-universe-snapshot.json";
  const requestPath = "factory/mt5/artifact-registration/request.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, universePath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(rootDir, requestPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, universePath), JSON.stringify({
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "blocked",
    blocked_reason: "MetaTrader5 import failed in fixture"
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(rootDir, requestPath), JSON.stringify({
    schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION,
    registration_id: "PHASE8A-MT5-REGISTRATION-CLI-FIXTURE",
    artifact_paths: [universePath]
  }, null, 2) + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-phase8a-mt5-artifact-registration.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--request", requestPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.official_evidence_index_mutated, false);
  assert.equal(parsed.artifacts.registered_artifacts[0].status, "blocked");
  assert.equal(parsed.registration.status_summary.blocked, 1);
  assert.equal(parsed.registration.status_summary.ready, 0);
  assert.equal(fs.existsSync(path.join(rootDir, parsed.artifacts.registration.path)), true);
});

test("MT5 Python environment diagnostic records blocked MetaTrader5 package imports without installation", () => {
  const rootDir = tempRoot();
  const fakePythonPath = path.join(rootDir, "tools/fake-python-missing.mjs");
  fs.mkdirSync(path.dirname(fakePythonPath), { recursive: true });
  fs.writeFileSync(fakePythonPath, `process.stdout.write(JSON.stringify({ ok: false, python_version: "3.fixture", platform: "fixture", error_type: "ModuleNotFoundError", message: "No module named 'MetaTrader5'" }) + "\\n"); process.exit(2);\n`, "utf8");

  const result = writeMt5PythonEnvironmentDiagnosticFromRequest({
    rootDir,
    observedAt: "2026-05-18T16:00:00.000Z",
    request: {
      schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION,
      diagnostic_id: "MT5-PYTHON-DIAGNOSTIC-MISSING-FIXTURE",
      python_commands: [{ label: "fixture-missing", command: process.execPath, args: [fakePythonPath] }]
    }
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.installation_attempted, false);
  assert.equal(result.diagnostic.status_summary.available, 0);
  assert.equal(result.diagnostic.commands[0].package_import_status, "missing");
  assert.match(result.blocked_reason, /No configured Python command/i);
  assert.equal(fs.existsSync(path.join(rootDir, result.artifacts.diagnostic.path)), true);
  assert.equal(validateMt5PythonEnvironmentDiagnostic(result.diagnostic), true);
});

test("MT5 Python environment diagnostic validation rejects inconsistent summaries and hashes", () => {
  const rootDir = tempRoot();
  const fakePythonPath = path.join(rootDir, "tools/fake-python-missing.mjs");
  fs.mkdirSync(path.dirname(fakePythonPath), { recursive: true });
  fs.writeFileSync(fakePythonPath, `process.stdout.write(JSON.stringify({ ok: false, python_version: "3.fixture", platform: "fixture", error_type: "ModuleNotFoundError", message: "No module named 'MetaTrader5'" }) + "\\n"); process.exit(2);\n`, "utf8");
  const result = writeMt5PythonEnvironmentDiagnosticFromRequest({
    rootDir,
    observedAt: "2026-05-18T16:01:00.000Z",
    request: {
      schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION,
      diagnostic_id: "MT5-PYTHON-DIAGNOSTIC-CONSISTENCY-FIXTURE",
      python_commands: [{ label: "fixture-missing", command: process.execPath, args: [fakePythonPath] }]
    }
  });

  const badSummary = structuredClone(result.diagnostic);
  badSummary.status_summary.missing_or_failed = 0;
  assert.throws(
    () => validateMt5PythonEnvironmentDiagnostic(badSummary),
    /status_summary\.missing_or_failed must equal 1/i
  );

  const badHash = structuredClone(result.diagnostic);
  badHash.commands[0].stdout_sha256 = "0".repeat(64);
  assert.throws(
    () => validateMt5PythonEnvironmentDiagnostic(badHash),
    /stdout_sha256 must match stdout\.sha256/i
  );
});

test("Phase 8A MT5 artifact registration accepts Python environment diagnostics", () => {
  const rootDir = tempRoot();
  const fakePythonPath = path.join(rootDir, "tools/fake-python-missing.mjs");
  fs.mkdirSync(path.dirname(fakePythonPath), { recursive: true });
  fs.writeFileSync(fakePythonPath, `process.stdout.write(JSON.stringify({ ok: false, python_version: "3.fixture", platform: "fixture", error_type: "ModuleNotFoundError", message: "No module named 'MetaTrader5'" }) + "\\n"); process.exit(2);\n`, "utf8");
  const diagnosticResult = writeMt5PythonEnvironmentDiagnosticFromRequest({
    rootDir,
    observedAt: "2026-05-18T16:02:00.000Z",
    request: {
      schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION,
      diagnostic_id: "MT5-PYTHON-DIAGNOSTIC-REGISTRATION-FIXTURE",
      python_commands: [{ label: "fixture-missing", command: process.execPath, args: [fakePythonPath] }]
    }
  });

  const result = writePhase8AMt5ArtifactRegistrationFromRequest({
    rootDir,
    observedAt: "2026-05-18T16:03:00.000Z",
    request: {
      schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION,
      registration_id: "PHASE8A-MT5-REGISTRATION-DIAGNOSTIC-FIXTURE",
      artifact_paths: [diagnosticResult.artifacts.diagnostic.path]
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.artifacts.registered_artifacts[0].evidence_kind, "mt5_python_environment_diagnostic");
  assert.equal(result.artifacts.registered_artifacts[0].status, "blocked");
  assert.equal(result.artifacts.registered_artifacts[0].summary.diagnostic_id, "MT5-PYTHON-DIAGNOSTIC-REGISTRATION-FIXTURE");
  assert.equal(result.registration.status_summary.blocked, 1);
  assert.deepEqual(result.registration.status_summary.by_evidence_kind, { mt5_python_environment_diagnostic: 1 });
  assert.equal(validatePhase8AMt5ArtifactRegistration(result.registration), true);
});

test("Phase 8A MT5 artifact registration CLI accepts Python environment diagnostics", () => {
  const rootDir = tempRoot();
  const fakePythonPath = path.join(rootDir, "tools/fake-python-missing.mjs");
  fs.mkdirSync(path.dirname(fakePythonPath), { recursive: true });
  fs.writeFileSync(fakePythonPath, `process.stdout.write(JSON.stringify({ ok: false, python_version: "3.fixture", platform: "fixture", error_type: "ModuleNotFoundError", message: "No module named 'MetaTrader5'" }) + "\\n"); process.exit(2);\n`, "utf8");
  const diagnosticResult = writeMt5PythonEnvironmentDiagnosticFromRequest({
    rootDir,
    observedAt: "2026-05-18T16:04:00.000Z",
    request: {
      schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION,
      diagnostic_id: "MT5-PYTHON-DIAGNOSTIC-REGISTRATION-CLI-FIXTURE",
      python_commands: [{ label: "fixture-missing", command: process.execPath, args: [fakePythonPath] }]
    }
  });
  const requestPath = "factory/mt5/artifact-registration/diagnostic-registration-request.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, requestPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, requestPath), JSON.stringify({
    schema_version: PHASE8A_MT5_ARTIFACT_REGISTRATION_REQUEST_SCHEMA_VERSION,
    registration_id: "PHASE8A-MT5-REGISTRATION-DIAGNOSTIC-CLI-FIXTURE",
    artifact_paths: [diagnosticResult.artifacts.diagnostic.path]
  }, null, 2) + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-phase8a-mt5-artifact-registration.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--request", requestPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.artifacts.registered_artifacts[0].evidence_kind, "mt5_python_environment_diagnostic");
  assert.equal(parsed.registration.status_summary.blocked, 1);
});

test("MT5 Python environment diagnostic records ready when any command imports MetaTrader5", () => {
  const rootDir = tempRoot();
  const missingPythonPath = path.join(rootDir, "tools/fake-python-missing.mjs");
  const availablePythonPath = path.join(rootDir, "tools/fake-python-available.mjs");
  fs.mkdirSync(path.dirname(missingPythonPath), { recursive: true });
  fs.writeFileSync(missingPythonPath, `process.stdout.write(JSON.stringify({ ok: false, python_version: "3.fixture", platform: "fixture", error_type: "ModuleNotFoundError", message: "No module named 'MetaTrader5'" }) + "\\n"); process.exit(2);\n`, "utf8");
  fs.writeFileSync(availablePythonPath, `process.stdout.write(JSON.stringify({ ok: true, python_version: "3.fixture", platform: "fixture", mt5_package_version: "5.fixture" }) + "\\n");\n`, "utf8");

  const result = writeMt5PythonEnvironmentDiagnosticFromRequest({
    rootDir,
    observedAt: "2026-05-18T16:05:00.000Z",
    request: {
      schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION,
      diagnostic_id: "MT5-PYTHON-DIAGNOSTIC-AVAILABLE-FIXTURE",
      python_commands: [
        { label: "fixture-missing", command: process.execPath, args: [missingPythonPath] },
        { label: "fixture-available", command: process.execPath, args: [availablePythonPath] }
      ]
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.blocked_reason, null);
  assert.equal(result.diagnostic.status_summary.available, 1);
  assert.equal(result.diagnostic.commands[1].package_import_status, "available");
  assert.equal(result.diagnostic.commands[1].mt5_package_version, "5.fixture");
  assert.equal(validateMt5PythonEnvironmentDiagnostic(result.diagnostic), true);
});

test("MT5 Python environment diagnostic CLI writes a blocked artifact", () => {
  const rootDir = tempRoot();
  const fakePythonPath = path.join(rootDir, "tools/fake-python-missing.mjs");
  fs.mkdirSync(path.dirname(fakePythonPath), { recursive: true });
  fs.writeFileSync(fakePythonPath, `process.stdout.write(JSON.stringify({ ok: false, python_version: "3.fixture", platform: "fixture", error_type: "ModuleNotFoundError", message: "No module named 'MetaTrader5'" }) + "\\n"); process.exit(2);\n`, "utf8");
  const requestPath = "factory/mt5/environment/python-diagnostic-request.json";
  fs.mkdirSync(path.dirname(path.join(rootDir, requestPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, requestPath), JSON.stringify({
    schema_version: MT5_PYTHON_ENVIRONMENT_DIAGNOSTIC_REQUEST_SCHEMA_VERSION,
    diagnostic_id: "MT5-PYTHON-DIAGNOSTIC-CLI-FIXTURE",
    python_commands: [{ label: "fixture-missing", command: process.execPath, args: [fakePythonPath] }]
  }, null, 2) + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-mt5-python-environment-diagnostic.mjs");
  const result = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--request", requestPath], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.installation_attempted, false);
  assert.equal(parsed.diagnostic.commands[0].package_import_status, "missing");
  assert.equal(fs.existsSync(path.join(rootDir, parsed.artifacts.diagnostic.path)), true);
});

test("data-readiness manifest can be read from a repo-relative path", () => {
  const rootDir = tempRoot();
  const manifest = validManifest(rootDir);
  const manifestPath = "workspace/data/binance/btcusdt_funding_manifest.json";
  fs.writeFileSync(path.join(rootDir, manifestPath), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  assert.equal(readAndValidateDataReadinessManifest(manifestPath, { rootDir }).dataset_id, manifest.dataset_id);
});

test("data-readiness manifest rejects missing source URL", () => {
  const rootDir = tempRoot();
  const manifest = validManifest(rootDir);
  delete manifest.source.source_url;

  assert.throws(() => validateDataReadinessManifest(manifest, { rootDir }), /source\.source_url/i);
});

test("data-readiness manifest rejects missing raw or normalized hashes", () => {
  const rootDir = tempRoot();
  const rawMissing = validManifest(rootDir);
  delete rawMissing.artifacts.raw.sha256;
  assert.throws(() => validateDataReadinessManifest(rawMissing, { rootDir }), /raw artifact sha256/i);

  const normalizedMissing = validManifest(rootDir);
  delete normalizedMissing.artifacts.normalized.sha256;
  assert.throws(() => validateDataReadinessManifest(normalizedMissing, { rootDir }), /normalized artifact sha256/i);
});

test("data-readiness manifest rejects hash mismatches", () => {
  const rootDir = tempRoot();
  const manifest = validManifest(rootDir);
  manifest.artifacts.normalized.sha256 = "0".repeat(64);

  assert.throws(() => validateDataReadinessManifest(manifest, { rootDir }), /normalized artifact sha256 mismatch/i);
});

test("data-readiness manifest rejects missing coverage window", () => {
  const rootDir = tempRoot();
  const manifest = validManifest(rootDir);
  delete manifest.coverage.start_utc;

  assert.throws(() => validateDataReadinessManifest(manifest, { rootDir }), /coverage\.start_utc/i);
});

test("data-readiness manifest rejects missing gap report", () => {
  const rootDir = tempRoot();
  const manifest = validManifest(rootDir);
  delete manifest.gap_report;

  assert.throws(() => validateDataReadinessManifest(manifest, { rootDir }), /gap_report is required/i);
});

test("data-readiness manifest rejects missing feature-lag rules", () => {
  const rootDir = tempRoot();
  const manifest = validManifest(rootDir);
  manifest.feature_lag_rules = [];

  assert.throws(() => validateDataReadinessManifest(manifest, { rootDir }), /feature_lag_rules/i);
});

test("data-readiness manifest rejects missing survivorship policy and WFA integration", () => {
  const rootDir = tempRoot();
  const missingSurvivorship = validManifest(rootDir);
  delete missingSurvivorship.survivorship;
  assert.throws(() => validateDataReadinessManifest(missingSurvivorship, { rootDir }), /survivorship is required/i);

  const missingWfa = validManifest(rootDir);
  delete missingWfa.wfa_integration;
  assert.throws(() => validateDataReadinessManifest(missingWfa, { rootDir }), /wfa_integration is required/i);
});

test("Binance USD-M funding helper writes raw, normalized, and valid manifest artifacts", () => {
  const rootDir = tempRoot();
  const result = buildBinanceUsdmFundingDataReadiness({
    rootDir,
    symbol: "BTCUSDT",
    retrievedAt: "2026-01-02T00:05:00Z",
    rawRows: [
      { symbol: "BTCUSDT", fundingTime: 1767225600000, fundingRate: "0.00010000", markPrice: "43000.10" },
      { symbol: "BTCUSDT", fundingTime: 1767254400000, fundingRate: "-0.00005000", markPrice: "43100.20" },
      { symbol: "BTCUSDT", fundingTime: 1767312000000, fundingRate: "0.00002000", markPrice: "43250.30" }
    ]
  });

  assert.equal(result.status, "ready");
  assert.equal(result.manifest.source_family, "binance_usdm_funding");
  assert.equal(result.manifest.coverage.start_utc, "2026-01-01T00:00:00Z");
  assert.equal(result.manifest.coverage.end_utc, "2026-01-02T00:00:00Z");
  assert.equal(result.manifest.coverage.row_count, 3);
  assert.equal(result.manifest.gap_report.checked, true);
  assert.equal(result.manifest.gap_report.gap_count, 1);
  assert.equal(result.manifest.feature_lag_rules.length, 2);
  assert.deepEqual(result.manifest.wfa_integration.data_paths, [result.artifacts.normalized.path]);
  assert.deepEqual(result.manifest.wfa_integration.data_manifest_paths, [result.artifacts.manifest.path]);

  for (const artifact of [result.artifacts.raw, result.artifacts.normalized, result.artifacts.manifest]) {
    const fullPath = path.join(rootDir, artifact.path);
    assert.equal(fs.existsSync(fullPath), true);
    assert.equal(artifact.sha256, sha256File(fullPath));
  }
});

test("Binance USD-M funding helper output manifest passes data-readiness validation", () => {
  const rootDir = tempRoot();
  const result = buildBinanceUsdmFundingDataReadiness({
    rootDir,
    symbol: "ETHUSDT",
    retrievedAt: "2026-01-01T16:05:00Z",
    rawRows: [
      { symbol: "ETHUSDT", fundingTime: 1767225600000, fundingRate: "0.00003000" },
      { symbol: "ETHUSDT", fundingTime: 1767254400000, fundingRate: "0.00001000" },
      { symbol: "ETHUSDT", fundingTime: 1767283200000, fundingRate: "-0.00002000" }
    ]
  });

  assert.equal(validateDataReadinessManifest(result.manifest, { rootDir }), true);
  assert.equal(readAndValidateDataReadinessManifest(result.artifacts.manifest.path, { rootDir }).dataset_id, result.manifest.dataset_id);
});

test("Binance USD-M funding helper rejects empty raw rows with exact diagnostics", () => {
  const rootDir = tempRoot();

  assert.throws(
    () => buildBinanceUsdmFundingDataReadiness({ rootDir, symbol: "BTCUSDT", rawRows: [] }),
    (error) => {
      assert.equal(error.message, "Binance USD-M funding raw rows are required and must be non-empty.");
      return true;
    }
  );
});

test("Binance USD-M funding live wrapper uses injectable fetch and writes valid artifacts", async () => {
  const rootDir = tempRoot();
  const seen = [];
  const result = await runBinanceUsdmFundingDataReadiness({
    rootDir,
    symbol: "BTCUSDT",
    startTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-01T16:00:00Z",
    limit: 3,
    timeoutMs: 1,
    fetchImpl: async (url, options) => {
      seen.push({ url, hasSignal: Boolean(options.signal) });
      return {
        ok: true,
        status: 200,
        json: async () => [
          { symbol: "BTCUSDT", fundingTime: 1767225600000, fundingRate: "0.00010000" },
          { symbol: "BTCUSDT", fundingTime: 1767254400000, fundingRate: "0.00002000" },
          { symbol: "BTCUSDT", fundingTime: 1767283200000, fundingRate: "-0.00001000" }
        ]
      };
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /symbol=BTCUSDT/);
  assert.match(seen[0].url, /limit=3/);
  assert.match(seen[0].url, /startTime=1767225600000/);
  assert.equal(result.manifest.source.source_url, seen[0].url);
  assert.equal(result.manifest.coverage.row_count, 3);
  assert.equal(result.manifest.gap_report.gap_count, 0);
  assert.equal(readAndValidateDataReadinessManifest(result.artifacts.manifest.path, { rootDir }).dataset_id, result.manifest.dataset_id);
});

test("Binance USD-M funding live wrapper blocks fetch failures without fake artifacts", async () => {
  const rootDir = tempRoot();
  const result = await runBinanceUsdmFundingDataReadiness({
    rootDir,
    symbol: "ETHUSDT",
    startTime: 1767225600000,
    endTime: 1767283200000,
    fetchImpl: async () => {
      throw new Error("network unavailable in test fixture");
    }
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blocked_reason, "binance_usdm_funding_fetch_failed");
  assert.equal(result.diagnostics.message, "network unavailable in test fixture");
  assert.equal(result.diagnostics.artifacts_written, false);
  assert.match(result.diagnostics.source_url, /symbol=ETHUSDT/);
  assert.deepEqual(result.artifacts, {});
  assert.equal(fs.existsSync(path.join(rootDir, "workspace", "data", "binance", "usdm_funding", "ethusdt")), false);
});

test("Binance USD-M funding URL builder validates time ranges", () => {
  assert.equal(
    buildBinanceUsdmFundingUrl({ symbol: "BTCUSDT", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-01T08:00:00Z", limit: 2 }),
    "https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2&startTime=1767225600000&endTime=1767254400000"
  );
  assert.throws(
    () => buildBinanceUsdmFundingUrl({ symbol: "BTCUSDT", startTime: 1767254400000, endTime: 1767225600000 }),
    /endTime must be after startTime/i
  );
});

test("Binance USD-M funding CLI writes hash-backed artifacts from explicit input without live fetch", () => {
  const rootDir = tempRoot();
  const inputPath = path.join(rootDir, "funding-rows.jsonl");
  fs.writeFileSync(inputPath, [
    JSON.stringify({ symbol: "BTCUSDT", fundingTime: 1767225600000, fundingRate: "0.00010000" }),
    JSON.stringify({ symbol: "BTCUSDT", fundingTime: 1767254400000, fundingRate: "0.00002000" }),
    JSON.stringify({ symbol: "BTCUSDT", fundingTime: 1767283200000, fundingRate: "-0.00001000" })
  ].join("\n") + "\n", "utf8");

  const scriptPath = path.resolve("scripts/run-binance-usdm-funding-data-readiness.mjs");
  const child = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--symbol", "BTCUSDT", "--input", inputPath], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");

  const result = JSON.parse(child.stdout);
  assert.equal(result.status, "ready");
  assert.equal(result.manifest.coverage.row_count, 3);
  assert.equal(result.manifest.wfa_integration.integration_status, "ready_as_exogenous_feature");
  for (const artifact of [result.artifacts.raw, result.artifacts.normalized, result.artifacts.manifest]) {
    const fullPath = path.join(rootDir, artifact.path);
    assert.equal(fs.existsSync(fullPath), true);
    assert.equal(artifact.sha256, sha256File(fullPath));
  }
});

test("Binance USD-M funding CLI refuses implicit live fetches", () => {
  const rootDir = tempRoot();
  const scriptPath = path.resolve("scripts/run-binance-usdm-funding-data-readiness.mjs");
  const child = spawnSync(process.execPath, [scriptPath, "--root", rootDir, "--symbol", "BTCUSDT"], { encoding: "utf8" });

  assert.equal(child.status, 2);
  assert.match(child.stderr, /Live fetches are opt-in only/i);
  assert.equal(fs.existsSync(path.join(rootDir, "workspace", "data", "binance", "usdm_funding", "btcusdt")), false);
});

test("Binance USD-M funding refresh request writes artifacts from explicit fixture input", async () => {
  const rootDir = tempRoot();
  const inputPath = "workspace/data/requests/btcusdt-funding-rows.jsonl";
  fs.mkdirSync(path.dirname(path.join(rootDir, inputPath)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, inputPath), [
    JSON.stringify({ symbol: "BTCUSDT", fundingTime: 1767225600000, fundingRate: "0.00010000" }),
    JSON.stringify({ symbol: "BTCUSDT", fundingTime: 1767254400000, fundingRate: "0.00002000" }),
    JSON.stringify({ symbol: "BTCUSDT", fundingTime: 1767283200000, fundingRate: "-0.00001000" })
  ].join("\n") + "\n", "utf8");

  const result = await runBinanceUsdmFundingRefreshRequest({
    rootDir,
    request: {
      schema_version: BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION,
      source_family: "binance_usdm_funding",
      mode: "fixture_input",
      symbol: "BTCUSDT",
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-01T16:00:00Z",
      limit: 3,
      raw_rows_path: inputPath
    },
    fetchImpl: async () => {
      throw new Error("test must not fetch for fixture_input refresh requests");
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.refresh_request.mode, "fixture_input");
  assert.equal(result.manifest.source.source_url, "https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=3&startTime=1767225600000&endTime=1767283200000");
  assert.equal(result.manifest.coverage.row_count, 3);
  assert.equal(readAndValidateDataReadinessManifest(result.artifacts.manifest.path, { rootDir }).dataset_id, result.manifest.dataset_id);
});

test("Binance USD-M funding refresh request blocks missing inputs without artifacts", async () => {
  const rootDir = tempRoot();
  const result = await runBinanceUsdmFundingRefreshRequest({
    rootDir,
    request: {
      schema_version: BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION,
      source_family: "binance_usdm_funding",
      mode: "fixture_input",
      symbol: "ETHUSDT",
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-01T16:00:00Z",
      raw_rows_path: "workspace/data/requests/missing.jsonl"
    }
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blocked_reason, "binance_usdm_funding_refresh_request_invalid");
  assert.match(result.diagnostics.message, /missing on disk/i);
  assert.equal(result.diagnostics.artifacts_written, false);
  assert.deepEqual(result.artifacts, {});
  assert.equal(fs.existsSync(path.join(rootDir, "workspace", "data", "binance", "usdm_funding", "ethusdt")), false);
});

test("Binance USD-M funding refresh request requires explicit live opt-in", async () => {
  const rootDir = tempRoot();
  const result = await runBinanceUsdmFundingRefreshRequest({
    rootDir,
    request: {
      schema_version: BINANCE_USDM_FUNDING_REFRESH_REQUEST_SCHEMA_VERSION,
      source_family: "binance_usdm_funding",
      mode: "live_fetch",
      symbol: "BTCUSDT",
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-01T16:00:00Z"
    },
    fetchImpl: async () => {
      throw new Error("test must not fetch without explicit live opt-in");
    }
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blocked_reason, "binance_usdm_funding_refresh_request_invalid");
  assert.match(result.diagnostics.message, /live_fetch_allowed must be true/i);
  assert.equal(fs.existsSync(path.join(rootDir, "workspace", "data", "binance", "usdm_funding", "btcusdt")), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeProject } from "../src/core/init.mjs";
import { buildResearchWfaRunRequestFromPlan } from "../src/core/orchestrator.mjs";
import { compileWfaReadyPlan } from "../src/core/wfa-plan-compiler.mjs";
import { runResearchWfaRunWorker } from "../src/workers/research-wfa-run-worker.mjs";

function tempRoot() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wfa-manifest-consumption-")), "trading-research-factory");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeFixture(rootDir, repoPath, content) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  return { path: repoPath, sha256: sha256Text(content), size_bytes: Buffer.byteLength(content) };
}

function createWfaRoute(rootDir) {
  const wfaRoot = path.join(rootDir, "walk forward engine");
  fs.mkdirSync(path.join(wfaRoot, "strategies", "manifest_route"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(wfaRoot, "src", "strategies"), { recursive: true });
  fs.writeFileSync(path.join(wfaRoot, "strategies", "manifest_route", "wfa_config.yaml"), "walk_forward:\n  training_months: 3\n  testing_months: 1\n  step_months: 1\n  n_parameter_trials: 5\n  output_directory: strategies/manifest_route/results\ndata:\n  source_file: data/manifest_route.csv\nstrategy:\n  profile_key: MANIFEST_ROUTE\nperformance:\n  max_execution_time_seconds: 60\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "config", "strategy_manifest_route.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(wfaRoot, "src", "strategies", "manifest_route.py"), "class ManifestRoute:\n    pass\n", "utf8");
}

function writeDataReadinessManifest(rootDir, { valid = true } = {}) {
  const base = "workspace/data/binance/usdm_funding/btcusdt";
  const raw = writeFixture(rootDir, `${base}/btcusdt_funding_raw.jsonl`, "{\"symbol\":\"BTCUSDT\",\"fundingTime\":1767225600000,\"fundingRate\":\"0.0001\"}\n");
  const normalized = writeFixture(rootDir, `${base}/btcusdt_funding_8h.csv`, "timestamp_utc,symbol,funding_rate\n2026-01-01T00:00:00Z,BTCUSDT,0.0001\n");
  const manifestPath = `${base}/btcusdt_funding_manifest.json`;
  const manifest = {
    schema_version: "data_readiness_manifest_v1",
    evidence_kind: "data_identity",
    dataset_id: "DATA-BINANCE-USDM-FUNDING-BTCUSDT-20260101",
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
      end_utc: "2026-01-01T08:00:00Z",
      row_count: 2,
      timezone: "UTC"
    },
    gap_report: { checked: true, gap_count: 0, gaps: [] },
    feature_lag_rules: [
      { field: "funding_rate", lag: "available_after_funding_timestamp", rationale: "Funding is only usable after the exchange-published funding timestamp." }
    ],
    survivorship: {
      survivorship_bias_checked: true,
      universe_policy: "single Binance USD-M symbol; this manifest does not claim a delisting-complete universe"
    },
    wfa_integration: {
      data_paths: [normalized.path],
      data_manifest_paths: [manifestPath],
      join_key: "timestamp_utc",
      integration_status: "ready_as_exogenous_feature"
    }
  };
  if (!valid) delete manifest.source.source_url;
  writeFixture(rootDir, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, normalizedPath: normalized.path };
}

function compileManifestPlan(rootDir, manifestPath) {
  return compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-MANIFEST-CONSUMPTION-001",
    backlogItem: {
      id: "IDEA-WFA-MANIFEST-CONSUMPTION",
      title: "Manifest-consuming WFA route",
      objective: "Run a deterministic WFA route with a data-readiness manifest.",
      status: "ready",
      priority: 90,
      market_family: "crypto",
      instrument_scope: "BTCUSDT derivatives",
      timeframe: "1h",
      evidence_kind: "research_wfa",
      authority_layer: "python_research",
      data_readiness_manifest_path: manifestPath,
      expected_wfa_config_path: "walk forward engine/strategies/manifest_route/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_manifest_route.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/manifest_route.py"
    }
  });
}

function compileFreshnessBoundManifestPlan(rootDir, manifestPath) {
  return compileWfaReadyPlan({
    rootDir,
    runId: "RUN-WFA-MANIFEST-STALE-001",
    backlogItem: {
      id: "IDEA-WFA-MANIFEST-STALE",
      title: "Freshness-bound manifest route",
      evidence_kind: "research_wfa",
      data_readiness_manifest_path: manifestPath,
      data_readiness_max_age_hours: 24,
      data_readiness_now_ms: Date.parse("2026-01-03T00:05:00Z"),
      expected_wfa_config_path: "walk forward engine/strategies/manifest_route/wfa_config.yaml",
      expected_strategy_config_path: "walk forward engine/config/strategy_manifest_route.json",
      expected_strategy_source_path: "walk forward engine/src/strategies/manifest_route.py"
    }
  });
}

test("WFA-ready compiler consumes a valid data-readiness manifest into the worker request", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  createWfaRoute(rootDir);
  const { manifestPath, normalizedPath } = writeDataReadinessManifest(rootDir);

  const compiled = compileManifestPlan(rootDir, manifestPath);
  assert.equal(compiled.compiled, true);

  const plan = compiled.plan;
  assert.deepEqual(plan.data_manifest_paths, [manifestPath]);
  assert.equal(plan.data_readiness_manifests[0].status, "consumed");
  assert.equal(plan.data_readiness_manifests[0].dataset_id, "DATA-BINANCE-USDM-FUNDING-BTCUSDT-20260101");
  assert.equal(plan.dataset_requirements.includes(normalizedPath), true);
  assert.equal(plan.dataset_requirements.includes(manifestPath), true);

  const request = buildResearchWfaRunRequestFromPlan({ plan, runId: "RUN-WFA-MANIFEST-CONSUMPTION-001", rootDir });
  assert.deepEqual(request.data_manifest_paths, [manifestPath]);
  assert.deepEqual(request.data_paths, [normalizedPath]);
});

test("WFA worker blocks invalid data-readiness manifests with exact diagnostics before launch", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  createWfaRoute(rootDir);
  const { manifestPath } = writeDataReadinessManifest(rootDir, { valid: false });

  const compiled = compileManifestPlan(rootDir, manifestPath);
  assert.equal(compiled.compiled, true);
  assert.equal(compiled.plan.data_readiness_manifests[0].status, "not_consumable");
  assert.match(compiled.plan.data_readiness_manifests[0].blocked_reason, /source\.source_url/i);

  const request = buildResearchWfaRunRequestFromPlan({ plan: compiled.plan, runId: "RUN-WFA-MANIFEST-BLOCKED-001", rootDir });
  const result = runResearchWfaRunWorker({ rootDir, request });

  assert.equal(result.status, "blocked");
  assert.match(result.blocked_reason, /data_manifest_path not consumable/i);
  assert.match(result.blocked_reason, /source\.source_url/i);
  assert.equal(result.worker_result.status, "blocked");
  assert.equal(result.worker_result.observations.execution_was_run_by_this_worker, false);
  assert.equal(result.artifacts_created.some((artifact) => artifact.artifact_type === "worker_request" && fs.existsSync(path.join(rootDir, artifact.path))), true);
});

test("WFA-ready compiler marks stale data-readiness manifests not consumable", () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  createWfaRoute(rootDir);
  const { manifestPath } = writeDataReadinessManifest(rootDir);

  const compiled = compileFreshnessBoundManifestPlan(rootDir, manifestPath);

  assert.equal(compiled.compiled, true);
  assert.equal(compiled.plan.data_readiness_manifests[0].status, "not_consumable");
  assert.match(compiled.plan.data_readiness_manifests[0].blocked_reason, /stale/i);
  assert.match(compiled.plan.data_readiness_manifests[0].blocked_reason, /exceeds 24h/i);
});

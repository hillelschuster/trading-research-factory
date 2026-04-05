import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { rebuildHealthMetrics } from "../src/core/health.mjs";
import { readLatestTransportBakeoff, resolvePreferredLiveTransportAdapter, runTransportBakeoff } from "../src/core/verification.mjs";

function createTempRoot() {
  const rootDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "transport-bakeoff-")), "trading-research-factory");
  initializeProject(rootDir);
  return rootDir;
}

test("runTransportBakeoff writes a machine-readable artifact and selects a winner by evidence", async () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  const { artifact, artifactPath } = await runTransportBakeoff({
    paths,
    synthetic: true,
    adapters: ["sdk", "http"],
    executeCandidate: async ({ adapter, scenario }) => {
      if (adapter === "http") {
        return {
          attempts: 1,
          session_create_success_rate: 1,
          stage_completion_rate: 1,
          retry_recovery_rate: 1,
          session_url_correctness_rate: 1,
          time_to_first_headers_ms: scenario === "fresh_server" ? 120 : 90,
          total_request_ms: scenario === "fresh_server" ? 280 : 220
        };
      }
      return {
        attempts: 1,
        session_create_success_rate: 1,
        stage_completion_rate: 0.5,
        retry_recovery_rate: 0,
        session_url_correctness_rate: 1,
        time_to_first_headers_ms: 180,
        total_request_ms: 320
      };
    }
  });

  assert.equal(fs.existsSync(artifactPath), true);
  assert.equal(artifact.schema_version, "transport_bakeoff_v1");
  assert.equal(artifact.winner.adapter, "http");
  assert.equal(artifact.default_adapter_recommended, "http");
});

test("resolvePreferredLiveTransportAdapter falls back to sdk without bakeoff evidence", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  assert.deepEqual(resolvePreferredLiveTransportAdapter(paths, "auto"), {
    adapter: "sdk",
    source: "default"
  });
});

test("resolvePreferredLiveTransportAdapter honors the latest bakeoff winner in auto mode", async () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  await runTransportBakeoff({
    paths,
    synthetic: true,
    adapters: ["sdk", "http"],
    executeCandidate: async ({ adapter }) => ({
      attempts: 1,
      session_create_success_rate: 1,
      stage_completion_rate: adapter === "http" ? 1 : 0.4,
      retry_recovery_rate: adapter === "http" ? 1 : 0,
      session_url_correctness_rate: 1,
      time_to_first_headers_ms: adapter === "http" ? 80 : 150,
      total_request_ms: adapter === "http" ? 180 : 260
    })
  });

  const resolved = resolvePreferredLiveTransportAdapter(paths, "auto");
  assert.equal(resolved.adapter, "http");
  assert.equal(resolved.source, "bakeoff");
  assert.match(resolved.artifactPath, /^factory\/verification\/transport-bakeoff-/);
});

test("explicit adapter override beats bakeoff-derived selection", async () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  await runTransportBakeoff({
    paths,
    synthetic: true,
    adapters: ["sdk", "http"],
    executeCandidate: async ({ adapter }) => ({
      attempts: 1,
      session_create_success_rate: 1,
      stage_completion_rate: adapter === "http" ? 1 : 0.4,
      retry_recovery_rate: 1,
      session_url_correctness_rate: 1,
      time_to_first_headers_ms: 100,
      total_request_ms: 200
    })
  });

  assert.deepEqual(resolvePreferredLiveTransportAdapter(paths, "sdk"), {
    adapter: "sdk",
    source: "explicit"
  });
});

test("health metrics surface the latest bakeoff summary", async () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  const { artifactPath } = await runTransportBakeoff({
    paths,
    synthetic: true,
    adapters: ["sdk", "http"],
    executeCandidate: async ({ adapter }) => ({
      attempts: 1,
      session_create_success_rate: 1,
      stage_completion_rate: adapter === "sdk" ? 1 : 0.8,
      retry_recovery_rate: 1,
      session_url_correctness_rate: 1,
      time_to_first_headers_ms: adapter === "sdk" ? 90 : 110,
      total_request_ms: adapter === "sdk" ? 180 : 210
    })
  });

  const latest = readLatestTransportBakeoff(paths);
  const health = rebuildHealthMetrics(paths);

  assert.equal(path.relative(paths.root, latest.path), path.relative(paths.root, artifactPath));
  assert.equal(health.latest_transport_bakeoff.artifact_path, path.relative(paths.root, artifactPath));
  assert.equal(health.latest_transport_bakeoff.synthetic, true);
  assert.equal(typeof health.latest_transport_bakeoff.winner_adapter, "string");
});

test("runTransportBakeoff persists blocked scenarios instead of aborting the artifact", async () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);

  const { artifact, artifactPath } = await runTransportBakeoff({
    paths,
    synthetic: false,
    adapters: ["sdk", "http"],
    executeCandidate: async ({ adapter, scenario }) => {
      if (adapter === "sdk" && scenario === "fresh_server") {
        const error = new Error("Timeout waiting for server to start after 20000ms");
        error.rf_failure_class = "transport_failure";
        error.rf_transport_phase = "boot";
        throw error;
      }

      return {
        attempts: 1,
        session_create_success_rate: 0,
        stage_completion_rate: 0,
        retry_recovery_rate: 0,
        session_url_correctness_rate: 0,
        notes: ["Did not run due to prior blocker"]
      };
    }
  });

  assert.equal(fs.existsSync(artifactPath), true);
  const blockedScenario = artifact.candidates.find((candidate) => candidate.adapter === "sdk").scenarios[0];
  assert.equal(blockedScenario.failure_class, "transport_failure");
  assert.equal(blockedScenario.transport_phase, "boot");
  assert.match(blockedScenario.error_message, /Timeout waiting for server to start/);
  assert.equal(artifact.winner.evidence_supported, false);
});

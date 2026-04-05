import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { loadRuntimeConfig } from "../src/core/config.mjs";
import { ArtifactStore } from "../src/core/artifact-store.mjs";
import { buildExecutorRetrieval } from "../src/core/retrieval.mjs";
import { writeJsonAtomic } from "../src/core/fs-utils.mjs";
import { initializeProject } from "../src/core/init.mjs";
import { resolveCanonicalRoot } from "../src/core/root-identity.mjs";

function createTempRepoRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-root-"));
  const projectRoot = path.join(tempRoot, "trading-research-factory");
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "trading-research-factory" }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "opencode.json"), JSON.stringify({ plugin: [], provider: {} }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Temp Test Repo\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "cli.mjs"), "", "utf8");
  return projectRoot;
}

function currentRepoWindowsAlias() {
  const currentRoot = process.cwd();
  const match = currentRoot.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (!match) return null;
  const drive = match[1].toUpperCase();
  const rest = match[2].replace(/\//g, "\\");
  return `${drive}:\\${rest}`;
}

test("loadRuntimeConfig keeps a literal repo root and exposes canonical root identity", () => {
  const projectRoot = createTempRepoRoot();
  const runtime = loadRuntimeConfig(["run", "--root", projectRoot], process.cwd());

  assert.equal(runtime.rootDir, projectRoot);
  assert.equal(runtime.rootIdentity.realPath, projectRoot);
  assert.equal(runtime.rootIdentity.sentinels["src/cli.mjs"], true);
  assert.equal(runtime.rootIdentity.aliases.includes(projectRoot), true);
});

test("loadRuntimeConfig rejects parent directories instead of auto-appending repo name", () => {
  const parentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "factory-parent-"));

  assert.throws(
    () => loadRuntimeConfig(["run", "--root", parentRoot], process.cwd()),
    /Missing sentinels/
  );
});

test("resolveCanonicalRoot rejects literal filesystem roots", () => {
  assert.throws(() => resolveCanonicalRoot("/"), /Refusing filesystem root/);
  assert.throws(() => resolveCanonicalRoot("C:\\"), /Refusing filesystem root/);
});

test("resolveCanonicalRoot preserves Unicode and Hebrew path segments for the live repo", () => {
  const identity = resolveCanonicalRoot(process.cwd());

  assert.equal(identity.realPath, process.cwd());
  assert.equal(identity.sentinels["AGENTS.md"], true);
  assert.match(identity.realPath, /הלל/);
});

test("resolveCanonicalRoot normalizes a Windows alias to the canonical WSL repo path when equivalent", (t) => {
  const windowsAlias = currentRepoWindowsAlias();
  if (!windowsAlias) {
    t.skip("Current repo is not on a /mnt/<drive> path.");
    return;
  }

  const identity = resolveCanonicalRoot(windowsAlias);
  assert.equal(identity.realPath, process.cwd());
  assert.equal(identity.aliases.includes(windowsAlias), true);
});

test("repo-scoped writes reject undeclared top-level paths and outside-root writes", () => {
  const rootDir = createTempRepoRoot();
  const paths = initializeProject(rootDir);

  assert.throws(
    () => writeJsonAtomic(path.join(rootDir, "rogue", "note.json"), { ok: true }, paths),
    /undeclared top-level write target/
  );

  assert.throws(
    () => writeJsonAtomic(path.join(path.dirname(rootDir), "escape.json"), { ok: true }, paths),
    /outside canonical root/
  );
});

test("artifact snapshots exclude the tooling sandbox", () => {
  const rootDir = createTempRepoRoot();
  const paths = initializeProject(rootDir);
  const artifactStore = new ArtifactStore(paths);

  fs.mkdirSync(paths.toolingSandbox, { recursive: true });
  fs.mkdirSync(path.join(paths.workspace, "results"), { recursive: true });
  fs.writeFileSync(path.join(paths.toolingSandbox, "session.log"), "sandbox\n", "utf8");
  fs.writeFileSync(path.join(paths.workspace, "results", "report.json"), "{}\n", "utf8");

  const snapshot = artifactStore.snapshotWorkspaceHashes(paths.root);
  assert.equal(Object.keys(snapshot).some((filePath) => filePath.startsWith(".opencode/")), false);
  assert.equal(Object.keys(snapshot).includes("workspace/results/report.json"), true);
});

test("executor retrieval excludes sandbox paths from surfaced artifacts", () => {
  const retrieval = buildExecutorRetrieval({
    retrievalIndex: [{
      source_type: "lesson",
      mode: "live",
      verdict: "failed",
      stage_targets: ["executor"],
      retrieval_text: "config timeout blocker",
      related_artifact_paths: [".opencode/session.log", "workspace/results/demo/report.json"],
      snippet: {
        lesson: "Use the real workspace dataset, not sandbox output."
      }
    }]
  }, {
    title: "Test plan",
    objective: "Check sandbox exclusion",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTCUSDT",
    timeframe: "1h"
  });

  assert.deepEqual(retrieval.relevant_paths, ["workspace/results/demo/report.json"]);
});

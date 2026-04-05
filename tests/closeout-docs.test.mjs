import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { validateStructure } from "../scripts/validate-structure.mjs";

const REQUIRED_LAYOUT = [
  "factory/state.json",
  "factory/backlog.json",
  "factory/leaderboard.json",
  "factory/verification",
  "factory/evidence/index.json",
  "factory/memory/lessons.jsonl",
  "workspace/harness",
  "workspace/strategies",
  "workspace/data",
  "workspace/data/fetchers"
];

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function createMinimalRepo() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-closeout-"));

  for (const relPath of REQUIRED_LAYOUT) {
    const fullPath = path.join(rootDir, relPath);
    if (path.extname(relPath)) {
      writeJson(fullPath, relPath.endsWith("lessons.jsonl") ? [] : {});
      if (relPath.endsWith("lessons.jsonl")) {
        fs.writeFileSync(fullPath, "", "utf8");
      }
    } else {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  return rootDir;
}

test("validateStructure accepts historical non-certifying closeout docs", () => {
  const rootDir = createMinimalRepo();

  writeText(path.join(rootDir, "factory/final-acceptance-sweep.md"), `# Final Acceptance Sweep

Status: historical record only; non-certifying

This document is historical and non-certifying.
It does not certify current endless-live readiness.
`);

  const result = validateStructure(rootDir);
  assert.equal(result.ok, true);
  assert.deepEqual(result.stale_certification_docs, []);
});

test("validateStructure fails on certifying prose without verification manifest", () => {
  const rootDir = createMinimalRepo();

  writeText(path.join(rootDir, "factory/final-acceptance-sweep.md"), `# Final Acceptance Sweep

Status: pass

The repository currently passes the hard acceptance criteria required before a controlled live loop run.
`);

  const result = validateStructure(rootDir);
  assert.equal(result.ok, false);
  assert.equal(result.stale_certification_docs.length, 1);
  assert.equal(result.stale_certification_docs[0].path, "factory/final-acceptance-sweep.md");
  assert.match(result.stale_certification_docs[0].reason, /without verification manifest reference/);
});

test("validateStructure fails when certifying prose cites a missing verification manifest", () => {
  const rootDir = createMinimalRepo();

  writeText(path.join(rootDir, "factory/final-acceptance-sweep.md"), `# Final Acceptance Sweep

Status: pass

Certification backed by \
\`factory/verification/verification-manifest-20260402.json\`.
`);

  const result = validateStructure(rootDir);
  assert.equal(result.ok, false);
  assert.equal(result.stale_certification_docs.length, 1);
  assert.equal(result.stale_certification_docs[0].missing_manifests[0], "factory/verification/verification-manifest-20260402.json");
});

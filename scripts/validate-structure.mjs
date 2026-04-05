#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { REQUIRED_LAYOUT } from "../src/core/constants.mjs";
import { rebuildHealthMetrics } from "../src/core/health.mjs";
import { initializeProject } from "../src/core/init.mjs";
import { rebuildNormalizedMemory } from "../src/core/memory-index.mjs";
import { resolveCanonicalRoot } from "../src/core/root-identity.mjs";
import { writeRolloutGate, writeVerificationManifest } from "../src/core/verification.mjs";

const CERTIFYING_DOC_PATTERNS = [
  /^Status:\s*pass\b/im,
  /The repository currently passes the hard acceptance criteria/i,
  /No genuine blockers remain/i,
  /Proceed to a controlled live loop run/i,
  /treated as live-ready/i
];

const VERIFICATION_MANIFEST_PATTERN = /(factory\/verification\/verification-manifest-[^\s`)"]+\.json)/g;

function readTopLevelFactoryDocs(rootDir) {
  const factoryDir = path.join(rootDir, "factory");
  if (!fs.existsSync(factoryDir)) {
    return [];
  }

  return fs.readdirSync(factoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(factoryDir, entry.name));
}

function collectManifestRefs(content) {
  return [...content.matchAll(VERIFICATION_MANIFEST_PATTERN)].map((match) => match[1]);
}

function docHasHistoricalBanner(content) {
  return /historical/i.test(content) && /non-certifying/i.test(content);
}

export function validateStructure(rootDir = process.cwd()) {
  const missing = REQUIRED_LAYOUT.filter((rel) => !fs.existsSync(path.join(rootDir, rel)));
  const staleCertificationDocs = [];

  for (const docPath of readTopLevelFactoryDocs(rootDir)) {
    const relativePath = path.relative(rootDir, docPath);
    const content = fs.readFileSync(docPath, "utf8");
    const hasCertifyingLanguage = CERTIFYING_DOC_PATTERNS.some((pattern) => pattern.test(content));

    if (!hasCertifyingLanguage) {
      continue;
    }

    const manifests = collectManifestRefs(content);
    const missingManifestRefs = manifests.filter((manifestPath) => !fs.existsSync(path.join(rootDir, manifestPath)));

    if (docHasHistoricalBanner(content)) {
      continue;
    }

    if (manifests.length === 0 || missingManifestRefs.length > 0) {
      staleCertificationDocs.push({
        path: relativePath,
        reason: manifests.length === 0
          ? "certifying prose without verification manifest reference"
          : "certifying prose references missing verification manifest",
        manifests,
        missing_manifests: missingManifestRefs
      });
    }
  }

  return {
    ok: missing.length === 0 && staleCertificationDocs.length === 0,
    checked: REQUIRED_LAYOUT.length,
    missing,
    stale_certification_docs: staleCertificationDocs
  };
}

export function refreshVerificationArtifacts(rootDir = process.cwd()) {
  const rootIdentity = resolveCanonicalRoot(rootDir);
  const paths = initializeProject(rootIdentity);
  rebuildNormalizedMemory(paths);
  rebuildHealthMetrics(paths);
  const manifest = writeVerificationManifest(paths);
  const rolloutGate = writeRolloutGate(paths);
  return {
    verification_manifest: path.relative(rootIdentity.realPath, manifest.path),
    rollout_gate: path.relative(rootIdentity.realPath, rolloutGate.path)
  };
}

if (import.meta.main) {
  const result = validateStructure();

  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ...result,
    ...refreshVerificationArtifacts()
  }, null, 2));
}

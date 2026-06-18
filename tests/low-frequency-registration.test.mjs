import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildPaths } from "../src/core/paths.mjs";
import {
  buildLowFrequencyRegistration,
  LOW_FREQUENCY_REGISTRATION_ARTIFACT_TYPE,
  validateLowFrequencyRegistration,
  validateLowFrequencyRegistrationArtifact,
  writeLowFrequencyRegistration
} from "../src/core/low-frequency-registration.mjs";

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "low-frequency-registration-"));
}

function fixture(overrides = {}) {
  return buildLowFrequencyRegistration({
    candidate_id: "CAND-LOW-FREQ-001",
    registered_at: "2026-05-24T08:00:00.000Z",
    registered_before_run_id: "RUN-LOW-FREQ-001",
    expected_trade_count_class: "structural_low_frequency",
    expected_trades_per_year: 18,
    expected_holding_period: "multi-day event-driven holds",
    why_low_frequency_is_structural: "The setup depends on rare macro event transitions, so trade frequency is structurally limited before any WFA result is known.",
    minimum_acceptable_trades: 80,
    required_extra_controls: [
      "longer_history",
      "regime_diversity",
      "concentration_risk_checks",
      "drawdown_scrutiny",
      "hard_minimum_trade_floor",
      "no_after_the_fact_excuses"
    ],
    ...overrides
  });
}

test("low_frequency_registration_v1 builds and validates pre-run structural rationale", () => {
  const registration = fixture();

  assert.equal(registration.schema_version, "low_frequency_registration_v1");
  assert.equal(registration.invalid_if_added_after_results, true);
  assert.match(registration.content_hash, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => validateLowFrequencyRegistration(registration, {
    expectedCandidateId: "CAND-LOW-FREQ-001",
    expectedRunId: "RUN-LOW-FREQ-001",
    resultsKnownAt: "2026-05-24T09:00:00.000Z"
  }));
});

test("low_frequency_registration_v1 rejects post-result and weak-control registrations", () => {
  const registration = fixture();
  assert.throws(
    () => validateLowFrequencyRegistration(registration, { resultsKnownAt: "2026-05-24T07:59:00.000Z" }),
    /after WFA results were known/i
  );

  const missingControls = { ...registration, required_extra_controls: ["longer_history"] };
  assert.throws(
    () => validateLowFrequencyRegistration(missingControls),
    /required_extra_controls missing/i
  );
});

test("low_frequency_registration_v1 is invalid when content is changed after hashing", () => {
  const registration = fixture();
  const tampered = { ...registration, minimum_acceptable_trades: 40 };

  assert.throws(
    () => validateLowFrequencyRegistration(tampered),
    /content_hash does not match/i
  );
});

test("low_frequency_registration_v1 writes candidate-scoped hash-backed artifact", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const registration = fixture();
  const artifact = writeLowFrequencyRegistration(paths, registration);

  assert.equal(artifact.artifact_type, LOW_FREQUENCY_REGISTRATION_ARTIFACT_TYPE);
  assert.equal(artifact.path, "factory/candidates/CAND-LOW-FREQ-001/registrations/low-frequency-RUN-LOW-FREQ-001.json");
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);

  const loaded = validateLowFrequencyRegistrationArtifact(artifact, {
    rootDir,
    expectedCandidateId: "CAND-LOW-FREQ-001",
    expectedRunId: "RUN-LOW-FREQ-001",
    resultsKnownAt: "2026-05-24T09:00:00.000Z"
  });
  assert.equal(loaded.content_hash, registration.content_hash);
});

test("low_frequency_registration_v1 artifact validation rejects wrong candidate scope and sha", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const artifact = writeLowFrequencyRegistration(paths, fixture());

  assert.throws(
    () => validateLowFrequencyRegistrationArtifact(artifact, { rootDir, expectedCandidateId: "CAND-OTHER-001" }),
    /expected candidate registrations folder/i
  );

  assert.throws(
    () => validateLowFrequencyRegistrationArtifact({ ...artifact, sha256: "0".repeat(64) }, { rootDir, expectedCandidateId: "CAND-LOW-FREQ-001" }),
    /sha256 mismatch/i
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { buildPaths } from "../src/core/paths.mjs";
import {
  buildResearchWfaPreregistration,
  RESEARCH_WFA_PREREGISTRATION_ARTIFACT_TYPE,
  validateResearchWfaPreregistration,
  validateResearchWfaPreregistrationArtifact,
  writeResearchWfaPreregistration
} from "../src/core/research-wfa-preregistration.mjs";

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "research-wfa-preregistration-"));
}

function writeJsonFixture(rootDir, repoPath, payload) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return {
    path: repoPath,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex")
  };
}

function writeStage0Refs(rootDir) {
  const source = writeJsonFixture(rootDir, "factory/research/runs/RB-RUN-001/source-records/SRC-001.json", {
    schema_version: "research_source_record_v1",
    source_id: "SRC-001"
  });
  const packet = writeJsonFixture(rootDir, "factory/research/runs/RB-RUN-001/hypotheses/HYP-001.json", {
    schema_version: "hypothesis_packet_v1",
    hypothesis_id: "HYP-001",
    source_records: [source]
  });
  return { packet, source };
}

function fixture(rootDir, overrides = {}) {
  const refs = overrides.refs ?? writeStage0Refs(rootDir);
  return buildResearchWfaPreregistration({
    candidate_id: "CAND-PREREG-001",
    registered_at: "2026-05-24T10:00:00.000Z",
    registered_before_run_id: "RUN-PREREG-001",
    hypothesis_packet_ref: refs.packet,
    source_record_refs: [refs.source],
    mechanism_summary: "Pre-registered source-backed imbalance continuation mechanism before any WFA result exists.",
    instrument_scope: "FTMO MT5 liquid FX and index CFD candidates",
    timeframe_candidate: "M15-H1",
    strategy_family: "ofi_continuation_filter",
    expected_trade_frequency: "medium frequency, not eligible for low-frequency exception by default",
    data_sources: ["MT5 broker OHLCV history plus pre-declared external proxy only if equivalence is later proven"],
    cost_assumptions: "Use current WFA vectorized fees and slippage diagnostics; no unverified cost-model uplift.",
    wfa_design: {
      config_path: "walk forward engine/strategies/ofi_continuation_filter/wfa_config.yaml",
      window_policy: "minimum 8 completed OOS windows before positive labels",
      optimizer_policy: "record optimizer trials and denominator context"
    },
    denominator_tracking: {
      attempt_is_denominator_member: true,
      failed_blocked_repaired_rerun_counted: true,
      parameter_or_scope_change_creates_new_attempt: true,
      optimizer_trials_recorded: true
    },
    frozen_fields: [
      "mechanism_summary",
      "instrument_scope",
      "timeframe_candidate",
      "strategy_family",
      "expected_trade_frequency",
      "data_sources",
      "cost_assumptions",
      "wfa_design",
      "invalidation_criteria"
    ],
    invalidation_criteria: [
      "Block if the source-backed mechanism cannot be mapped to an FTMO MT5 tradable symbol.",
      "Block if WFA outputs lack artifact-backed OOS consistency and denominator diagnostics."
    ],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "refs"))
  });
}

test("research_wfa_preregistration_v1 writes candidate-scoped hash-backed artifact", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const registration = fixture(rootDir);
  const artifact = writeResearchWfaPreregistration(paths, registration);

  assert.equal(artifact.artifact_type, RESEARCH_WFA_PREREGISTRATION_ARTIFACT_TYPE);
  assert.equal(artifact.path, "factory/candidates/CAND-PREREG-001/registrations/research-wfa-RUN-PREREG-001.json");
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);

  const loaded = validateResearchWfaPreregistrationArtifact(artifact, {
    rootDir,
    expectedCandidateId: "CAND-PREREG-001",
    expectedRunId: "RUN-PREREG-001",
    resultsKnownAt: "2026-05-24T11:00:00.000Z"
  });
  assert.equal(loaded.content_hash, registration.content_hash);
});

test("research_wfa_preregistration_v1 rejects weak denominator and frozen-field controls", () => {
  const rootDir = createTempRoot();
  const registration = fixture(rootDir);
  const weak = {
    ...registration,
    denominator_tracking: { attempt_is_denominator_member: true },
    frozen_fields: ["mechanism_summary"]
  };

  assert.throws(
    () => validateResearchWfaPreregistration(weak),
    /denominator_tracking missing true flags.*frozen_fields missing/i
  );
});

test("research_wfa_preregistration_v1 rejects post-result and wrong-candidate artifacts", () => {
  const rootDir = createTempRoot();
  const paths = buildPaths(rootDir);
  const artifact = writeResearchWfaPreregistration(paths, fixture(rootDir));

  assert.throws(
    () => validateResearchWfaPreregistrationArtifact(artifact, { rootDir, resultsKnownAt: "2026-05-24T09:59:00.000Z" }),
    /after WFA results were known/i
  );

  assert.throws(
    () => validateResearchWfaPreregistrationArtifact(artifact, { rootDir, expectedCandidateId: "CAND-OTHER-001" }),
    /expected candidate registrations folder/i
  );
});

test("research_wfa_preregistration_v1 validates referenced Stage-0 artifact hashes", () => {
  const rootDir = createTempRoot();
  const refs = writeStage0Refs(rootDir);
  const registration = fixture(rootDir, { refs });
  const tamperedSource = path.join(rootDir, refs.source.path);
  fs.writeFileSync(tamperedSource, JSON.stringify({ schema_version: "research_source_record_v1", source_id: "SRC-TAMPERED" }, null, 2) + "\n", "utf8");

  assert.throws(
    () => validateResearchWfaPreregistration(registration, { rootDir }),
    /source_record_refs\[0\]\.sha256 mismatch/i
  );
});

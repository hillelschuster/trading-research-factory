import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildResearchBrainRetrievalEntries,
  rebuildNormalizedMemory
} from "../src/core/memory-index.mjs";
import { buildIdeatorRetrieval, buildPlannerRetrieval } from "../src/core/retrieval.mjs";
import { initializeProject } from "../src/core/init.mjs";
import {
  HYPOTHESIS_PACKET_SCHEMA_VERSION,
  RESEARCH_DIGEST_SCHEMA_VERSION,
  RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
  RESEARCH_SOURCE_RECORD_SCHEMA_VERSION,
  RESEARCHBRAIN_REQUEST_SCHEMA_VERSION,
  RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION,
  STAGE0_AUTHORITY_LAYER,
  STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
  buildResearchBrainRequestArtifact,
  buildResearchBrainStage0Manifest,
  classifyResearchBrainBacklogSourceQuality,
  validateHypothesisPacket,
  validateResearchBrainBacklogCandidate,
  validateResearchBrainArtifact,
  validateResearchBrainRequest,
  validateResearchDigest,
  validateResearchIdeationManifest,
  validateResearchSourceRecord,
  validateResearchBrainStage0Manifest,
  writeResearchBrainRequestArtifact,
  writeResearchBrainStage0Manifest
} from "../src/core/researchbrain-artifacts.mjs";
import { validateExecutionResult, validatePlannerResult } from "../src/core/validators.mjs";
import { ideatorPrompt, plannerPrompt } from "../src/core/prompt-builders.mjs";
import { compileWfaReadyPlan } from "../src/core/wfa-plan-compiler.mjs";
import { writePhase8AMt5ArtifactRegistrationFromRequest } from "../src/core/mt5-artifact-registration.mjs";
import {
  createFixtureResearchBrainProvider,
  createHttpResearchBrainSourceFetcher,
  createJsonFileResearchBrainProvider,
  createMapResearchBrainSourceFetcher,
  validateResearchBrainStage0RuntimeResult,
  runResearchBrainStage0Runtime
} from "../src/core/researchbrain-runtime.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-artifacts-test-"));
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
  return { path: repoPath, sha256: sha256File(fullPath) };
}

function writeJsonFixture(rootDir, repoPath, value) {
  return writeFixture(rootDir, repoPath, `${JSON.stringify(value, null, 2)}\n`);
}

function officialFileHashes(paths) {
  return Object.fromEntries([
    ["state", paths.state],
    ["backlog", paths.backlog],
    ["evidenceIndex", paths.evidenceIndex],
    ["leaderboard", paths.leaderboard],
    ["lessons", paths.lessons]
  ].map(([label, filePath]) => [label, fs.existsSync(filePath) ? sha256File(filePath) : null]));
}

function phase8ARefs(rootDir) {
  const universe = writeJsonFixture(rootDir, "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json", {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    server: "FTMO-Demo",
    symbol_count_total: 2,
    symbols: [{ name: "EURUSD" }, { name: "BTCUSD" }]
  });
  const inventory = writeJsonFixture(rootDir, "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json", {
    schema_version: "mt5_terminal_inventory_v1",
    inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV",
    counts: { total_symbols: 2 }
  });
  return {
    universe_snapshot: universe,
    terminal_inventory: inventory
  };
}

function validSourceRecord(rootDir, extra = {}) {
  const rawSource = writeFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-001.md", "Academic market microstructure fixture text.\n");
  return {
    schema_version: RESEARCH_SOURCE_RECORD_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    source_id: "SRC-MICROSTRUCTURE-001",
    source_type: "academic_paper_fixture",
    trust_tier: extra.trust_tier ?? "high_research_trust",
    url_or_path_or_doi: "doi:10.0000/fixture",
    accessed_at: "2026-05-20T00:00:00Z",
    content_hash_or_unavailable_reason: rawSource.sha256,
    claims_extracted: ["Order-flow imbalance can be a falsifiable mechanism, not a profitability claim."],
    limitations: ["Fixture source record for schema validation only."],
    disconfirming_relevance: ["Mechanism may fail after realistic spread and swap costs."],
    artifact: rawSource,
    ...extra
  };
}

function validHypothesisPacket(rootDir, sourceRecordArtifact) {
  return {
    schema_version: HYPOTHESIS_PACKET_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    hypothesis_id: "HYP-STAGE0-ORDERFLOW-001",
    mechanism: "Liquidity-taking pressure after volatility contraction may produce short-lived continuation.",
    falsifiable_prediction: "If the mechanism is real, continuation after contraction should survive OOS windows after costs.",
    market_structure_assumption: "Broker-tradable CFD instruments expose enough bar-level structure to approximate the mechanism.",
    instrument_scope: "FTMO MT5 symbols from the Phase 8A universe, not exchange-only symbols.",
    timeframe_candidate: "M15-H1 to be selected during deterministic planning.",
    strategy_family: "volatility_contraction_orderflow",
    mt5_relevance_classification: "mt5_relevant_unverified",
    required_data: "MT5 broker OHLCV plus spread/swap/spec references where available.",
    expected_holding_period: "Intraday to multi-session, before any WFA result is known.",
    expected_trade_frequency: "Unknown until deterministic data and WFA planning; no profitability label assigned.",
    expected_failure_modes: ["Spread expansion overwhelms continuation.", "Effect disappears across asset classes."],
    invalidation_criteria: ["No OOS consistency after deterministic WFA.", "No defensible MT5 instrument equivalence."],
    implementation_shape: "Rule-based signal generator proposed for later deterministic planning only.",
    execution_sensitivity: "Sensitive to spread, swap, session boundaries, and CFD contract specs.",
    mt5_ftmo_concerns: "Requires MT5 symbol specs and later FTMO rule accounting before promotion.",
    prior_related_lessons: ["Avoid simple RSI variants and post-hoc Sharpe chasing."],
    prior_failed_patterns_checked: ["Historical simple mean-reversion WFA failures were checked for overlap."],
    novelty_reason: "Combines volatility contraction with source-backed order-flow mechanism and Phase 8A symbol constraints.",
    disconfirming_evidence: ["Retail forum variants often omit costs and survivorship controls."],
    proposed_experiment_shape: "Stage 0 only; planner may later compile a falsification plan if accepted.",
    source_records: [{ source_id: "SRC-MICROSTRUCTURE-001", ...sourceRecordArtifact }],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false,
    content_hash: sha256Text("HYP-STAGE0-ORDERFLOW-001")
  };
}

function validPlannerResult(extra = {}) {
  return {
    experiment_id: "EXP-STAGE0-PROVENANCE-001",
    title: "Stage-0 provenance falsification plan",
    objective: "Build a later deterministic falsification plan from Stage-0 packet provenance.",
    hypothesis: "A source-backed Stage-0 mechanism may be falsified by later deterministic WFA only.",
    strategy_rationale: "The plan preserves path/hash provenance and makes no profitability claim.",
    strategy_type: "volatility_contraction_orderflow",
    market_family: "multi_asset_ftmo_mt5",
    instrument_scope: "FTMO MT5 symbols constrained by Phase 8A universe artifacts.",
    timeframe: "M15-H1",
    historical_depth_requirement: { target: "maximum available MT5 history", justification: "Use the longest terminal-backed history feasible for falsification." },
    source_plan: { allowed_source_families: ["mt5_terminal"], primary_source_family: "mt5_terminal", selection_reason: "MT5-bound claims require terminal-backed data." },
    scope_selection_rationale: "Scope remains multi-asset and constrained by Phase 8A universe artifacts.",
    data_acquisition: { status: "present", reason: "No acquisition is performed in this validator fixture.", acquisition_method: "fixture", expected_outputs: ["factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json"] },
    inputs: ["factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json"],
    expected_artifacts: ["factory/experiments/EXP-STAGE0-PROVENANCE-001.plan.json"],
    evaluation_criteria: { status_gate: "Later deterministic execution must produce evidence-kind-appropriate artifacts.", min_evidence_score: 0, metrics: { planned_artifact_refs: 1 } },
    evidence_kind: "research_wfa",
    authority_layer: "python_research",
    source_hashes: [],
    ...extra
  };
}

function validProviderOutputFixture({ sourceContentPath, researchRunId = "RESEARCHBRAIN-STAGE0-FILE-PROVIDER-FIXTURE" }) {
  return {
    schema_version: "researchbrain_stage0_provider_output_v1",
    research_run_id: researchRunId,
    provider_mode: "repo_local_file_fixture",
    key_findings: ["File-backed fixture validates deterministic provider and source-capture plumbing only."],
    limitations: ["No live research, WFA, MT5 execution, profitability label, or promotion authority was used."],
    source_captures: [{
      source_id: "SRC-FILE-CAPTURE-001",
      source_type: "fixture_file_source",
      trust_tier: "low_signal_trust",
      url_or_path_or_doi: "fixture://file-backed-provider-output",
      content_path: sourceContentPath,
      claims_extracted: ["Stage-0 source capture can preserve repo-local file hashes before hypothesis validation."],
      limitations: ["Repo-local fixture source; not live research or broker evidence."],
      disconfirming_relevance: ["A plumbing-valid source record does not imply market edge or deployability."],
      provider_provenance: { mode: "repo_local_file_fixture", live_research: false }
    }],
    hypothesis_packets: [{
      hypothesis_id: "HYP-STAGE0-FILE-CAPTURE-001",
      mechanism: "Source-backed volatility contraction framing may become a falsifiable mechanism after later deterministic planning.",
      falsifiable_prediction: "If valid, a later pre-registered WFA may show OOS consistency after costs; this fixture does not test that.",
      market_structure_assumption: "Any later work must stay within Phase 8A FTMO MT5 tradable universe constraints.",
      instrument_scope: "Any Phase 8A FTMO MT5 symbol class; not crypto-only and no prediction markets.",
      timeframe_candidate: "M15-H1 candidate only, later planning required.",
      strategy_family: "file_fixture_volatility_contraction",
      mt5_relevance_classification: "mt5_relevant_unverified",
      required_data: "Terminal-backed MT5 OHLCV, spread, swap, and symbol specs before MT5-bound claims.",
      expected_holding_period: "Intraday to multi-session; not validated by this fixture.",
      expected_trade_frequency: "Unknown before deterministic data checks and WFA; no profitability label assigned.",
      expected_failure_modes: ["Cost stress removes any apparent effect.", "The mechanism fails outside a post-hoc subset."],
      invalidation_criteria: ["No later source-backed pre-registration exists.", "No OOS consistency after deterministic WFA."],
      implementation_shape: "Rule-based candidate shape for later planner consumption only.",
      execution_sensitivity: "Sensitive to spreads, swaps, sessions, and CFD symbol specifications.",
      mt5_ftmo_concerns: "Needs terminal specs and later FTMO rule accounting before any promotion path.",
      prior_related_lessons: ["Avoid RSI-only and post-hoc Sharpe-chasing variants."],
      prior_failed_patterns_checked: ["Simple indicator variants are treated as overfit-prone unless a new mechanism justifies them."],
      novelty_reason: "Validates file-backed source capture and Stage-0 provenance without claiming an edge.",
      disconfirming_evidence: ["Fixture provenance means no live external support has been gathered."],
      proposed_experiment_shape: "Stage-0 discovery artifact only; later experiment must be planned separately.",
      cited_source_ids: ["SRC-FILE-CAPTURE-001"]
    }]
  };
}

function validFetchProviderOutputFixture({ fetchUrl, researchRunId = "RESEARCHBRAIN-STAGE0-FETCH-PROVIDER-FIXTURE" }) {
  const output = validProviderOutputFixture({ sourceContentPath: "factory/research/fixtures/unused.md", researchRunId });
  output.provider_mode = "fetch_url_fixture";
  output.source_captures[0] = {
    ...output.source_captures[0],
    source_id: "SRC-FETCH-CAPTURE-001",
    source_type: "fixture_fetch_source",
    url_or_path_or_doi: fetchUrl,
    fetch_url: fetchUrl,
    provider_provenance: { mode: "fetch_url_fixture", live_research: false }
  };
  delete output.source_captures[0].content_path;
  output.hypothesis_packets[0] = {
    ...output.hypothesis_packets[0],
    hypothesis_id: "HYP-STAGE0-FETCH-CAPTURE-001",
    cited_source_ids: ["SRC-FETCH-CAPTURE-001"],
    novelty_reason: "Validates source fetch adapter plumbing without claiming an edge."
  };
  return output;
}

test("ResearchBrain request enforces bounded Stage-0 discovery limits", () => {
  assert.equal(validateResearchBrainRequest({
    schema_version: RESEARCHBRAIN_REQUEST_SCHEMA_VERSION,
    research_question: "Find source-backed edge mechanisms constrained to the FTMO MT5 universe.",
    market_scope: "multi_asset_ftmo_mt5",
    mt5_instrument_scope: { source: "phase8a_universe_snapshot" },
    prior_failed_patterns: [],
    prior_lessons: [],
    max_sources: 5,
    max_hypotheses: 2,
    novelty_required: true
  }), true);

  assert.throws(() => validateResearchBrainRequest({
    research_question: "Too broad",
    market_scope: "all markets",
    prior_failed_patterns: [],
    prior_lessons: [],
    max_sources: 100,
    max_hypotheses: 20,
    novelty_required: false
  }), /max_sources|novelty_required/);
});

test("ResearchBrain request writer produces Phase 8A constrained Stage-0 request artifacts only", () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);

  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-FIXTURE",
    observedAt: "2026-05-20T00:02:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    priorFailedPatterns: ["Simple RSI-only variants were excluded as stale overfit-prone patterns."],
    priorLessons: ["Use Phase 8A terminal symbol evidence before MT5-bound claims."],
    maxSources: 4,
    maxHypotheses: 2
  });

  assert.equal(request.schema_version, RESEARCHBRAIN_REQUEST_SCHEMA_VERSION);
  assert.equal(request.evidence_kind, STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND);
  assert.equal(request.authority_layer, STAGE0_AUTHORITY_LAYER);
  assert.equal(request.phase8a_universe_constraints.universe_snapshot.sha256, phase8a.universe_snapshot.sha256);
  assert.equal(request.official_state_mutated, false);
  assert.equal(request.official_evidence_index_mutated, false);
  assert.equal(validateResearchBrainRequest(request, { rootDir, requireExisting: true }), true);

  assert.throws(() => validateResearchBrainRequest({
    ...request,
    sharpe_oos: 9.9
  }, { rootDir }), /profitability|sharpe_oos/);

  const written = writeResearchBrainRequestArtifact({
    rootDir,
    outputDir: "factory/research/requests/RESEARCHBRAIN-REQUEST-FIXTURE",
    requestId: "RESEARCHBRAIN-REQUEST-FIXTURE",
    observedAt: "2026-05-20T00:02:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 4,
    maxHypotheses: 2
  });
  assert.equal(written.status, "ready");
  assert.equal(written.artifact.artifact_type, "researchbrain_request");
  assert.equal(written.artifact.path, "factory/research/requests/RESEARCHBRAIN-REQUEST-FIXTURE/request.json");
});

test("ResearchBrain source records require trust labels and reject profitability fields", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir);
  assert.equal(validateResearchSourceRecord(sourceRecord, { rootDir, requireExisting: true }), true);

  assert.throws(() => validateResearchSourceRecord({
    ...sourceRecord,
    sharpe_oos: 2.1
  }, { rootDir }), /profitability|sharpe_oos/);
});

test("hypothesis packets require Phase 8A path hashes and remain Stage-0 only", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);

  assert.equal(validateHypothesisPacket(packet, { rootDir, requireExisting: true }), true);
  assert.equal(validateResearchBrainArtifact(packet, { rootDir, requireExisting: true }), true);

  assert.throws(() => validateHypothesisPacket({
    ...packet,
    phase8a_universe_constraints: {
      ...packet.phase8a_universe_constraints,
      universe_snapshot: { ...packet.phase8a_universe_constraints.universe_snapshot, sha256: "0".repeat(64) }
    }
  }, { rootDir, requireExisting: true }), /sha256 does not match/);

  assert.throws(() => validateHypothesisPacket({
    ...packet,
    mt5_relevance_classification: "mt5_verified"
  }, { rootDir }), /mt5_instrument_equivalence/);

  assert.throws(() => validateHypothesisPacket({
    ...packet,
    sharpe_ratio: 2.4
  }, { rootDir }), /profitability|sharpe_ratio/);

  assert.throws(() => validateHypothesisPacket({
    ...packet,
    edge_rating: "strong"
  }, { rootDir }), /profitability|edge_rating/);

  assert.throws(() => validateHypothesisPacket({
    ...packet,
    provider_extra_field: "must not be spread into packets"
  }, { rootDir }), /unexpected field: provider_extra_field/);
});

test("research digest and ideation manifest validate discovery artifacts without official mutation", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json", validHypothesisPacket(rootDir, sourceRecordArtifact));
  const phase8a = phase8ARefs(rootDir);

  const digest = {
    schema_version: RESEARCH_DIGEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    digest_id: "DIGEST-RESEARCH-001",
    research_run_id: "RUN-RESEARCH-001",
    generated_at: "2026-05-20T00:05:00Z",
    key_findings: ["One hypothesis packet remains falsifiable and Stage-0 only."],
    limitations: ["No WFA, MT5 job, or profitability claim was executed."],
    source_records: [sourceRecordArtifact],
    hypothesis_packets: [packetArtifact],
    phase8a_universe_constraints: phase8a,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  };
  assert.equal(validateResearchDigest(digest, { rootDir, requireExisting: true }), true);

  const manifest = {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RUN-RESEARCH-001",
    memory_checked: { checked: true, paths: ["factory/memory/lessons.jsonl"] },
    sources_considered: [{ source_id: "SRC-MICROSTRUCTURE-001", trust_tier: "high_research_trust" }],
    hypotheses_accepted: [{ hypothesis_id: "HYP-STAGE0-ORDERFLOW-001", path: packetArtifact.path, sha256: packetArtifact.sha256 }],
    hypotheses_rejected: [],
    duplicates_detected: [],
    budget_used: { max_sources: 5, sources_used: 1, max_hypotheses: 2, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [sourceRecordArtifact, packetArtifact],
    phase8a_universe_constraints: phase8a,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  };
  assert.equal(validateResearchIdeationManifest(manifest, { rootDir, requireExisting: true }), true);

  assert.throws(() => validateResearchIdeationManifest({
    ...manifest,
    official_evidence_index_mutated: true
  }, { rootDir }), /must not mutate official state/);
});

test("central execution validator recognizes Stage-0 discovery as non-executable evidence", () => {
  assert.throws(() => validateExecutionResult({
    experiment_id: "EXP-STAGE0-001",
    status: "executed",
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    artifacts_created: [{ artifact_type: "hypothesis_packet", path: "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json", sha256: "1".repeat(64) }]
  }), /not executable evidence/);

  assert.throws(() => validateExecutionResult({
    experiment_id: "EXP-STAGE0-001",
    status: "blocked",
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    blockers: ["Stage-0 discovery is not an executor path."]
  }), /not executable evidence/);
});

test("ResearchBrain Stage-0 manifest builder validates existing artifacts without official mutation", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json", validHypothesisPacket(rootDir, sourceRecordArtifact));

  const manifest = buildResearchBrainStage0Manifest({
    rootDir,
    artifactPaths: [sourceRecordArtifact.path, packetArtifact.path],
    observedAt: "2026-05-20T00:10:00Z",
    manifestId: "RESEARCHBRAIN-STAGE0-MANIFEST-FIXTURE"
  });

  assert.equal(manifest.schema_version, RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.official_state_mutated, false);
  assert.equal(manifest.official_evidence_index_mutated, false);
  assert.equal(manifest.official_backlog_mutated, false);
  assert.equal(manifest.official_leaderboard_mutated, false);
  assert.equal(manifest.artifact_counts.research_source_record, 1);
  assert.equal(manifest.artifact_counts.hypothesis_packet, 1);
  assert.equal(validateResearchBrainStage0Manifest(manifest, { rootDir, requireExisting: true }), true);

  const written = writeResearchBrainStage0Manifest({
    rootDir,
    artifactPaths: [sourceRecordArtifact.path, packetArtifact.path],
    outputDir: "factory/research/manifests/RESEARCHBRAIN-STAGE0-MANIFEST-FIXTURE",
    observedAt: "2026-05-20T00:10:00Z",
    manifestId: "RESEARCHBRAIN-STAGE0-MANIFEST-FIXTURE"
  });
  assert.equal(written.status, "ready");
  assert.equal(written.artifact.path, "factory/research/manifests/RESEARCHBRAIN-STAGE0-MANIFEST-FIXTURE/manifest.json");
});

test("ResearchBrain Stage-0 runtime accepts valid fixture provider output without official mutation", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-RUNTIME-FIXTURE",
    observedAt: "2026-05-20T01:00:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const beforeOfficial = officialFileHashes(paths);

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-FIXTURE",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-FIXTURE",
    observedAt: "2026-05-20T01:01:00Z",
    provider: createFixtureResearchBrainProvider({ mode: "valid" }),
    maxAttempts: 2,
    maxProviderCalls: 2,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(result.evidence_kind, STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND);
  assert.equal(result.authority_layer, STAGE0_AUTHORITY_LAYER);
  assert.equal(result.official_state_mutated, false);
  assert.equal(result.official_evidence_index_mutated, false);
  assert.equal(result.official_backlog_mutated, false);
  assert.equal(result.official_leaderboard_mutated, false);
  assert.equal(result.profitability_labels_created, false);
  assert.equal(result.wfa_executed, false);
  assert.equal(result.mt5_executed, false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);

  const artifactTypes = result.artifacts_created.map((artifact) => artifact.artifact_type).sort();
  assert.deepEqual(artifactTypes, [
    "hypothesis_packet",
    "research_digest",
    "research_ideation_manifest",
    "research_source_record",
    "researchbrain_stage0_manifest"
  ].sort());
  assert.equal(result.artifacts_created.every((artifact) => artifact.path.startsWith("factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-FIXTURE/")), true);
  assert.equal(fs.existsSync(path.join(rootDir, result.result_artifact.path)), true);
});

test("ResearchBrain Stage-0 runtime quarantines invalid provider JSON", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-INVALID-JSON",
    observedAt: "2026-05-20T01:05:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-INVALID-JSON",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-INVALID-JSON",
    observedAt: "2026-05-20T01:06:00Z",
    provider: createFixtureResearchBrainProvider({ mode: "invalid_json" }),
    maxAttempts: 2,
    maxProviderCalls: 2,
    timeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.artifacts_created.length, 0);
  assert.equal(result.quarantine_paths.length, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.budget.provider_calls_used, 1);
  assert.match(result.attempts[0].reason, /JSON/);
  assert.equal(result.attempts[0].failure_class, "schema_or_validation_failure");
  assert.equal(result.attempts[0].retryable, false);
  assert.equal(fs.existsSync(path.join(rootDir, result.quarantine_paths[0].path)), true);
  assert.equal(fs.existsSync(path.join(rootDir, result.attempts[0].raw_provider_output.path)), true);
});

test("ResearchBrain Stage-0 runtime retries transient provider failures with artifact-backed metadata", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-BUDGET",
    observedAt: "2026-05-20T01:10:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });

  const fixtureProvider = createFixtureResearchBrainProvider({ mode: "valid" });
  let calls = 0;
  const transientProvider = {
    name: "transient_researchbrain_provider",
    mode: "test_transient_then_valid",
    async generate(context) {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 503 temporarily unavailable authorization: Bearer SECRET_PROVIDER_TOKEN");
      return fixtureProvider.generate(context);
    }
  };

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-BUDGET",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-BUDGET",
    observedAt: "2026-05-20T01:11:00Z",
    provider: transientProvider,
    maxAttempts: 5,
    maxProviderCalls: 2,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.budget.provider_calls_used, 2);
  assert.equal(result.quarantine_paths.length, 1);
  assert.equal(result.attempts[0].retryable, true);
  assert.equal(result.attempts[0].failure_class, "transient_retryable_failure");
  assert.equal(result.attempts[0].final_terminal_state, "retry_pending");
  assert.equal(result.attempts[1].status, "accepted");
  assert.equal(result.attempts[1].final_terminal_state, "accepted");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_PROVIDER_TOKEN/);
  const runtimeResult = fs.readFileSync(path.join(rootDir, result.result_artifact.path), "utf8");
  assert.doesNotMatch(runtimeResult, /SECRET_PROVIDER_TOKEN/);
});

test("ResearchBrain Stage-0 runtime rejects profitability labels from provider output", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-PROFITABILITY-REJECT",
    observedAt: "2026-05-20T01:15:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-PROFITABILITY-REJECT",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-PROFITABILITY-REJECT",
    observedAt: "2026-05-20T01:16:00Z",
    provider: createFixtureResearchBrainProvider({ mode: "profitability_label" }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.artifacts_created.length, 0);
  assert.equal(result.quarantine_paths.length, 1);
  assert.match(result.attempts[0].reason, /profitability_label/);
});

test("ResearchBrain Stage-0 runtime rejects provider research_run_id mismatch", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-RUN-ID-MISMATCH",
    observedAt: "2026-05-20T01:16:10Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const sourceText = writeFixture(rootDir, "factory/research/fixtures/run-id-mismatch-source.md", "Run id mismatch source fixture text for boundary validation.\n");
  const providerOutput = writeJsonFixture(
    rootDir,
    "factory/research/fixtures/provider-output-run-id-mismatch.json",
    validProviderOutputFixture({ sourceContentPath: sourceText.path, researchRunId: "RESEARCHBRAIN-STAGE0-STALE-PROVIDER-RUN" })
  );

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-RUN-ID-MISMATCH",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-RUN-ID-MISMATCH",
    observedAt: "2026-05-20T01:16:20Z",
    provider: createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput.path }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.artifacts_created.length, 0);
  assert.equal(result.quarantine_paths.length, 1);
  assert.match(result.attempts[0].reason, /research_run_id mismatch/);
});

test("ResearchBrain Stage-0 runtime rejects direct provider output without cited sources", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-UNCITED-DIRECT",
    observedAt: "2026-05-20T01:17:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const sourceText = writeFixture(rootDir, "factory/research/fixtures/uncited-source.md", "Uncited source fixture text for boundary validation.\n");
  const output = validProviderOutputFixture({ sourceContentPath: sourceText.path, researchRunId: "RESEARCHBRAIN-STAGE0-RUNTIME-UNCITED-DIRECT" });
  delete output.hypothesis_packets[0].cited_source_ids;
  const providerOutput = writeJsonFixture(rootDir, "factory/research/fixtures/provider-output-uncited.json", output);

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-UNCITED-DIRECT",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-UNCITED-DIRECT",
    observedAt: "2026-05-20T01:17:30Z",
    provider: createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput.path }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /cited_source_ids/);
});

test("ResearchBrain Stage-0 runtime rejects direct provider YouTube title-only claims", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-YOUTUBE-TITLE-DIRECT",
    observedAt: "2026-05-20T01:18:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const output = validProviderOutputFixture({ sourceContentPath: "factory/research/fixtures/unused.md", researchRunId: "RESEARCHBRAIN-STAGE0-RUNTIME-YOUTUBE-TITLE-DIRECT" });
  output.source_captures[0] = {
    source_id: "SRC-YOUTUBE-DIRECT-001",
    source_type: "youtube_transcript_chunks",
    trust_tier: "low_signal_trust",
    url_or_path_or_doi: "https://www.youtube.com/watch?v=YT_DIRECT_001",
    content: "Timestamped YouTube chunk fixture content exists, but the attempted claim cites title metadata instead.",
    claims_extracted: ["Video metadata exists."],
    limitations: ["Title and description cannot support hypotheses."],
    disconfirming_relevance: ["Video popularity is not evidence."],
    provider_provenance: { source_class: "youtube_video", chunk_ids: ["yt_YT_DIRECT_001_0001"], live_research: false }
  };
  output.hypothesis_packets[0].cited_source_ids = ["SRC-YOUTUBE-DIRECT-001"];
  output.hypothesis_packets[0].source_claims = [{ claim_class: "youtube_title_description", citation_source_id: "SRC-YOUTUBE-DIRECT-001" }];
  const providerOutput = writeJsonFixture(rootDir, "factory/research/fixtures/provider-output-youtube-title-direct.json", output);

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-YOUTUBE-TITLE-DIRECT",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-YOUTUBE-TITLE-DIRECT",
    observedAt: "2026-05-20T01:18:30Z",
    provider: createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput.path }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /title\/description/);
});

test("ResearchBrain Stage-0 runtime rejects direct provider MT5 claims without operational sources", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-MT5-GENERIC-DIRECT",
    observedAt: "2026-05-20T01:19:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const sourceText = writeFixture(rootDir, "factory/research/fixtures/generic-web-source.md", "Generic web source text that is not MQL5, broker, or official documentation.\n");
  const output = validProviderOutputFixture({ sourceContentPath: sourceText.path, researchRunId: "RESEARCHBRAIN-STAGE0-RUNTIME-MT5-GENERIC-DIRECT" });
  output.source_captures[0].provider_provenance = { source_class: "web", live_research: false };
  output.hypothesis_packets[0].source_claims = [{ claim_class: "mt5_ftmo", citation_source_id: "SRC-FILE-CAPTURE-001" }];
  const providerOutput = writeJsonFixture(rootDir, "factory/research/fixtures/provider-output-mt5-generic-direct.json", output);

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-MT5-GENERIC-DIRECT",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-MT5-GENERIC-DIRECT",
    observedAt: "2026-05-20T01:19:30Z",
    provider: createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput.path }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /MT5\/FTMO\/MQL5 claim/);
});

test("ResearchBrain Stage-0 runtime accepts repo-local file provider output and source capture", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-FILE-PROVIDER",
    observedAt: "2026-05-20T01:20:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const sourceText = writeFixture(
    rootDir,
    "factory/research/fixtures/source-capture-001.md",
    "Repo-local source fixture for deterministic ResearchBrain capture. It supports source hash plumbing only, not a trading edge claim.\n"
  );
  const providerOutput = writeJsonFixture(
    rootDir,
    "factory/research/fixtures/provider-output-file-backed.json",
    validProviderOutputFixture({ sourceContentPath: sourceText.path, researchRunId: "RESEARCHBRAIN-STAGE0-RUNTIME-FILE-PROVIDER" })
  );

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-FILE-PROVIDER",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-FILE-PROVIDER",
    observedAt: "2026-05-20T01:21:00Z",
    provider: createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput.path }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  assert.equal(result.provider.name, "json_file_researchbrain_provider");
  assert.equal(result.provider.live_research, false);
  const sourceRecordArtifact = result.artifacts_created.find((artifact) => artifact.artifact_type === "research_source_record");
  const sourceRecord = JSON.parse(fs.readFileSync(path.join(rootDir, sourceRecordArtifact.path), "utf8"));
  assert.equal(sourceRecord.source_fetch.mode, "repo_local_file_capture");
  assert.equal(sourceRecord.source_fetch.artifact.path, sourceText.path);
  assert.equal(sourceRecord.source_fetch.artifact.sha256, sourceText.sha256);
});

test("ResearchBrain Stage-0 runtime quarantines fetch_url when source fetcher is not explicit", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-FETCH-DISABLED",
    observedAt: "2026-05-20T01:22:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const fetchUrl = "https://researchbrain.test/source-one";
  const providerOutput = writeJsonFixture(
    rootDir,
    "factory/research/fixtures/provider-output-fetch-disabled.json",
    validFetchProviderOutputFixture({ fetchUrl, researchRunId: "RESEARCHBRAIN-STAGE0-RUNTIME-FETCH-DISABLED" })
  );

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-FETCH-DISABLED",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-FETCH-DISABLED",
    observedAt: "2026-05-20T01:23:00Z",
    provider: createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput.path }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.artifacts_created.length, 0);
  assert.equal(result.quarantine_paths.length, 1);
  assert.match(result.attempts[0].reason, /sourceFetcher|disabled by default/);
});

test("ResearchBrain Stage-0 runtime captures source fetcher output with hash provenance", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-FETCH-MAP",
    observedAt: "2026-05-20T01:24:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const fetchUrl = "https://researchbrain.test/source-one";
  const providerOutput = writeJsonFixture(
    rootDir,
    "factory/research/fixtures/provider-output-fetch-map.json",
    validFetchProviderOutputFixture({ fetchUrl, researchRunId: "RESEARCHBRAIN-STAGE0-RUNTIME-FETCH-MAP" })
  );

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-FETCH-MAP",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-FETCH-MAP",
    observedAt: "2026-05-20T01:25:00Z",
    provider: createJsonFileResearchBrainProvider({ rootDir, outputPath: providerOutput.path }),
    sourceFetcher: createMapResearchBrainSourceFetcher({
      sources: {
        [fetchUrl]: "Map source fetch fixture content for ResearchBrain Stage-0 source capture. It is a deterministic test double and makes no profitability claim."
      }
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  const sourceRecordArtifact = result.artifacts_created.find((artifact) => artifact.artifact_type === "research_source_record");
  const sourceRecord = JSON.parse(fs.readFileSync(path.join(rootDir, sourceRecordArtifact.path), "utf8"));
  assert.equal(sourceRecord.source_fetch.mode, "map_test_double_source_fetch");
  assert.equal(sourceRecord.source_fetch.url, fetchUrl);
  assert.equal(sourceRecord.source_fetch.live_fetch, false);
  assert.equal(sourceRecord.artifact.sha256, sourceRecord.content_hash_or_unavailable_reason);
});

test("ResearchBrain HTTP source fetcher is fail-closed without explicit live opt-in", async () => {
  const disabled = createHttpResearchBrainSourceFetcher({ allowLiveFetch: false });
  await assert.rejects(() => disabled.fetch({ url: "https://example.com/source" }), /disabled by default/);
  assert.throws(() => createHttpResearchBrainSourceFetcher({ allowLiveFetch: true, allowedHosts: [] }), /allowed host/);
});

test("ResearchBrain Stage-0 runtime fails loud on non-empty output directory collision", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-COLLISION-GUARD",
    observedAt: "2026-05-22T02:00:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const outputDir = "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-COLLISION-GUARD";
  writeFixture(rootDir, `${outputDir}/existing-artifact.txt`, "existing artifact must not be overwritten\n");

  await assert.rejects(() => runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-COLLISION-GUARD",
    outputDir,
    observedAt: "2026-05-22T02:01:00Z",
    provider: createFixtureResearchBrainProvider({ mode: "valid" }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  }), /output_dir already exists and is non-empty/);
});

test("ResearchBrain Stage-0 runtime result validator rejects fake authority flags", async () => {
  const rootDir = tempRoot();
  const phase8a = phase8ARefs(rootDir);
  const request = buildResearchBrainRequestArtifact({
    rootDir,
    requestId: "RESEARCHBRAIN-REQUEST-RUNTIME-VALIDATOR",
    observedAt: "2026-05-20T01:25:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    maxSources: 2,
    maxHypotheses: 1
  });
  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request,
    runId: "RESEARCHBRAIN-STAGE0-RUNTIME-VALIDATOR",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNTIME-VALIDATOR",
    observedAt: "2026-05-20T01:26:00Z",
    provider: createFixtureResearchBrainProvider({ mode: "valid" }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.throws(() => validateResearchBrainStage0RuntimeResult({
    ...result,
    official_state_mutated: true,
    wfa_executed: true
  }, { rootDir, requireExisting: true }), /official mutation flags|wfa_executed/);
});

test("memory rebuild indexes Stage-0 ResearchBrain artifacts for Ideator and Planner", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json", packet);

  const researchEntries = buildResearchBrainRetrievalEntries(rootDir);
  assert.equal(researchEntries.length, 2);
  assert.equal(researchEntries.some((entry) => entry.source_type === "research_source_record"), true);
  assert.equal(researchEntries.some((entry) => entry.source_type === "research_hypothesis_packet"), true);

  const rebuilt = rebuildNormalizedMemory(paths);
  const hypothesisEntry = rebuilt.retrievalIndex.find((entry) => entry.source_type === "research_hypothesis_packet");
  assert.equal(hypothesisEntry.source_path, packetArtifact.path);
  assert.equal(hypothesisEntry.artifact_sha256, packetArtifact.sha256);
  assert.equal(hypothesisEntry.snippet.phase8a_universe_constraints.universe_snapshot.path.includes("universe-snapshot.json"), true);

  const factoryStats = { retrievalIndex: rebuilt.retrievalIndex };
  const ideatorRetrieval = buildIdeatorRetrieval(factoryStats);
  assert.equal(ideatorRetrieval.stage0_hypothesis_packets[0].source_path, packetArtifact.path);
  assert.equal(ideatorRetrieval.stage0_hypothesis_packets[0].artifact_sha256, packetArtifact.sha256);
  assert.equal(ideatorRetrieval.stage0_source_records[0].source_id, sourceRecord.source_id);

  const plannerRetrieval = buildPlannerRetrieval(factoryStats, {
    title: "Volatility contraction orderflow continuation",
    objective: "Plan from Stage-0 hypothesis packet",
    category: "volatility_contraction_orderflow",
    market_family: "multi_asset_ftmo_mt5",
    instrument_scope: "FTMO MT5 symbols from the Phase 8A universe, not exchange-only symbols.",
    timeframe: "M15-H1"
  });
  assert.equal(plannerRetrieval.stage0_hypothesis_packets[0].hypothesis_id, packet.hypothesis_id);
});

test("ResearchBrain retrieval derives failed Phase 8D summary memory without official mutation", () => {
  const rootDir = tempRoot();
  writeFixture(rootDir, "factory/summaries/RUN-PHASE8D-BTC-RSI-20260603000100.md", [
    "# Phase 8D BTC RSI Screen",
    "",
    "Phase 8D candidate was a non-survivor.",
    "Gate denied: failed low trades, weak return, and parameter-only RSI novelty.",
    "Phase 8E remains blocked; do not tune or rerun this failed hypothesis without new independent source-backed evidence."
  ].join("\n"));
  writeFixture(rootDir, "factory/summaries/RUN-UNRELATED.md", "General summary without Phase 8D failure memory.\n");

  const entries = buildResearchBrainRetrievalEntries(rootDir);
  const failedSummary = entries.find((entry) => entry.source_type === "phase8d_failed_summary");

  assert.equal(failedSummary.retrieval_id, "phase8d_failed_summary:RUN-PHASE8D-BTC-RSI-20260603000100");
  assert.match(failedSummary.retrieval_text, /parameter-only RSI novelty/);
  assert.equal(failedSummary.snippet.phase8e_blocked, true);
  assert.equal(entries.some((entry) => entry.source_path === "factory/summaries/RUN-UNRELATED.md"), false);
});

test("ResearchBrain-derived backlog candidates require packet path/hash and cannot use Stage-0 as executable evidence", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json", validHypothesisPacket(rootDir, sourceRecordArtifact));

  assert.equal(validateResearchBrainBacklogCandidate({
    title: "Stage-0 packet candidate",
    objective: "Plan a later falsification run from packet provenance.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: null,
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa"
  }, { rootDir, requireExisting: true }), true);

  assert.throws(() => validateResearchBrainBacklogCandidate({
    source: "researchbrain_stage0",
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND
  }, { rootDir }), /executable evidence_kind|hypothesis_packet|researchbrain_evidence_kind/);

  assert.throws(() => validateResearchBrainBacklogCandidate({
    title: "Prose-only invented candidate",
    objective: "This tries to cite ResearchBrain prose without packet hashes.",
    source: "researchbrain_stage0",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa"
  }, { rootDir }), /hypothesis_packet|source_record_refs/);

  assert.throws(() => validateResearchBrainBacklogCandidate({
    title: "Dropped source hash candidate",
    objective: "This preserves the packet but drops source record hashes.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa"
  }, { rootDir, requireExisting: true }), /source_record_refs/);

  assert.throws(() => validateResearchBrainBacklogCandidate({
    title: "Profitability laundering candidate",
    objective: "This tries to promote a Stage-0 packet as profitable.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: null,
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    profitability_label: "promising"
  }, { rootDir, requireExisting: true }), /profitability_label|profitability/);
});

test("ResearchBrain low-signal single-source packets cannot become WFA-ready backlog", () => {
  const rootDir = tempRoot();
  const lowSignalSource = validSourceRecord(rootDir, { trust_tier: "low_signal_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-TEST/source-records/SRC-MICROSTRUCTURE-001.json", lowSignalSource);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-TEST/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", validHypothesisPacket(rootDir, sourceRecordArtifact));
  const baseCandidate = {
    title: "Low-signal packet candidate",
    objective: "This packet needs corroborating research before WFA screening.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-LIVE-TEST",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  assert.equal(validateResearchBrainBacklogCandidate(baseCandidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...baseCandidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /source-quality gate blocks direct WFA-ready/);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...baseCandidate,
    commands: { launch: ".venv/Scripts/python.exe scripts/walk_forward_smoke_test.py --config strategies/stage0_route/wfa_config.yaml" }
  }, { rootDir, requireExisting: true }), /source-quality gate blocks direct WFA-ready/);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...baseCandidate,
    data_acquisition: {
      status: "present",
      acquisition_method: "fixture",
      metadata: { config_path: "walk forward engine/strategies/stage0_route/wfa_config.yaml" }
    }
  }, { rootDir, requireExisting: true }), /source-quality gate blocks direct WFA-ready/);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...baseCandidate,
    planned_artifacts: [{ path: "walk forward engine\\strategies\\stage0_route\\wfa_config.yaml" }]
  }, { rootDir, requireExisting: true }), /source-quality gate blocks direct WFA-ready/);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...baseCandidate,
    advanced_wfa_config: { strategy: "stage0_route" }
  }, { rootDir, requireExisting: true }), /source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain direct WFA-ready backlog requires at least two source records", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", packet);
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE",
    memory_checked: { checked: true },
    sources_considered: [{ source_id: sourceRecord.source_id, trust_tier: sourceRecord.trust_tier }],
    hypotheses_accepted: [{ hypothesis_id: packet.hypothesis_id, path: packetArtifact.path, sha256: packetArtifact.sha256 }],
    hypotheses_rejected: [],
    duplicates_detected: [],
    budget_used: { max_sources: 4, sources_used: 1, max_hypotheses: 1, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [sourceRecordArtifact, packetArtifact],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  });
  const oneSourceCandidate = {
    title: "Single-source high-trust packet candidate",
    objective: "Even a high-trust single source needs corroboration before direct WFA screening.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const oneSourceQuality = classifyResearchBrainBacklogSourceQuality(oneSourceCandidate, { rootDir, requireExisting: true });
  assert.equal(oneSourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(oneSourceQuality.reasons.includes("single_source_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(oneSourceCandidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...oneSourceCandidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /single_source_requires_more_research|source-quality gate blocks direct WFA-ready/);

  const secondSourceRecord = validSourceRecord(rootDir, {
    source_id: "SRC-MICROSTRUCTURE-002",
    url_or_path_or_doi: "doi:10.0000/fixture-corroborating",
    claims_extracted: ["Independent corroborating source fixture for source-count gating."]
  });
  const secondSourceArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE/source-records/SRC-MICROSTRUCTURE-002.json", secondSourceRecord);
  const twoSourcePacket = {
    ...packet,
    source_records: [
      { source_id: sourceRecord.source_id, ...sourceRecordArtifact },
      { source_id: secondSourceRecord.source_id, ...secondSourceArtifact }
    ]
  };
  const twoSourcePacketArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE/hypotheses/HYP-STAGE0-ORDERFLOW-002.json", twoSourcePacket);
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RESEARCHBRAIN-STAGE0-TWO-SOURCE-GATE",
    memory_checked: { checked: true },
    sources_considered: [
      { source_id: sourceRecord.source_id, trust_tier: sourceRecord.trust_tier },
      { source_id: secondSourceRecord.source_id, trust_tier: secondSourceRecord.trust_tier }
    ],
    hypotheses_accepted: [{ hypothesis_id: twoSourcePacket.hypothesis_id, path: twoSourcePacketArtifact.path, sha256: twoSourcePacketArtifact.sha256 }],
    hypotheses_rejected: [],
    duplicates_detected: [],
    budget_used: { max_sources: 4, sources_used: 2, max_hypotheses: 1, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [sourceRecordArtifact, secondSourceArtifact, twoSourcePacketArtifact],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  });
  const twoSourceCandidate = {
    ...oneSourceCandidate,
    hypothesis_packet_path: twoSourcePacketArtifact.path,
    hypothesis_packet_sha256: twoSourcePacketArtifact.sha256,
    source_record_refs: [sourceRecordArtifact, secondSourceArtifact],
    status: "ready"
  };
  const twoSourceQuality = classifyResearchBrainBacklogSourceQuality(twoSourceCandidate, { rootDir, requireExisting: true });
  assert.equal(twoSourceQuality.direct_wfa_ready_allowed, true);
  assert.equal(validateResearchBrainBacklogCandidate(twoSourceCandidate, { rootDir, requireExisting: true }), true);
});

test("ResearchBrain duplicate or failed-pattern memory matches cannot become direct WFA-ready backlog", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MEMORY-GATE/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MEMORY-GATE/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", validHypothesisPacket(rootDir, sourceRecordArtifact));
  const baseCandidate = {
    title: "Memory-gated packet candidate",
    objective: "This packet needs additional review because duplicate memory matched.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-MEMORY-GATE",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    duplicate_memory_matches: [{ retrieval_id: "research_hypothesis_packet:HYP-PRIOR-001", score: 8 }],
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(baseCandidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.required_status, "requires_more_research");
  assert.equal(sourceQuality.memory_gate.duplicate_match_count, 1);
  assert.equal(sourceQuality.reasons.includes("researchbrain_duplicate_memory_matches_require_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(baseCandidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...baseCandidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /duplicate_memory_matches|source-quality gate blocks direct WFA-ready/);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...baseCandidate,
    duplicate_memory_matches: [],
    failed_pattern_matches: [{ retrieval_id: "prior_failed_pattern:1", score: 5 }],
    expected_wfa_config_path: "walk forward engine/strategies/demo/wfa_config.yaml"
  }, { rootDir, requireExisting: true }), /failed_pattern_matches|source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain ideation manifest duplicate signals block direct WFA-ready backlog", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MANIFEST-GATE/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MANIFEST-GATE/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", packet);
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MANIFEST-GATE/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RESEARCHBRAIN-STAGE0-MANIFEST-GATE",
    memory_checked: { checked: true },
    sources_considered: [{ source_id: sourceRecord.source_id, trust_tier: sourceRecord.trust_tier }],
    hypotheses_accepted: [{ hypothesis_id: packet.hypothesis_id, path: packetArtifact.path, sha256: packetArtifact.sha256 }],
    hypotheses_rejected: [],
    duplicates_detected: [{ hypothesis_id: packet.hypothesis_id, reason: "Prior Stage-0 memory overlap requires more research." }],
    budget_used: { max_sources: 4, sources_used: 1, max_hypotheses: 1, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [sourceRecordArtifact, packetArtifact],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  });
  const candidate = {
    title: "Manifest-gated packet candidate",
    objective: "This packet needs more research because the ideation manifest recorded a duplicate signal.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-MANIFEST-GATE",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.ideation_manifest_gate.duplicate_match_count, 1);
  assert.equal(sourceQuality.reasons.includes("researchbrain_ideation_manifest_duplicate_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /ideation_manifest_duplicate|source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain direct WFA-ready backlog requires readable same-run ideation manifest", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MISSING-MANIFEST/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MISSING-MANIFEST/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", validHypothesisPacket(rootDir, sourceRecordArtifact));
  const candidate = {
    title: "Missing-manifest packet candidate",
    objective: "This packet cannot become WFA-ready without the same-run ideation ledger.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-MISSING-MANIFEST",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.ideation_manifest_gate.manifest_status, "missing_or_unreadable");
  assert.equal(sourceQuality.reasons.includes("researchbrain_ideation_manifest_missing_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /ideation_manifest_missing|source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain malformed ideation manifest blocks direct WFA-ready backlog", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-BAD-MANIFEST/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-BAD-MANIFEST/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", validHypothesisPacket(rootDir, sourceRecordArtifact));
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-BAD-MANIFEST/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    research_run_id: "RESEARCHBRAIN-STAGE0-BAD-MANIFEST",
    memory_checked: false,
    phase8a_universe_constraints: phase8ARefs(rootDir)
  });
  const candidate = {
    title: "Malformed-manifest packet candidate",
    objective: "This packet cannot become WFA-ready with a malformed ideation ledger.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-BAD-MANIFEST",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.ideation_manifest_gate.manifest_status, "invalid");
  assert.equal(sourceQuality.reasons.includes("researchbrain_ideation_manifest_invalid_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /ideation_manifest_invalid|memory_checked|source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain direct WFA-ready backlog requires manifest accepted-hypothesis linkage", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-UNACCEPTED-PACKET/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-UNACCEPTED-PACKET/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", packet);
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-UNACCEPTED-PACKET/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RESEARCHBRAIN-STAGE0-UNACCEPTED-PACKET",
    memory_checked: { checked: true },
    sources_considered: [{ source_id: sourceRecord.source_id, trust_tier: sourceRecord.trust_tier }],
    hypotheses_accepted: [{ hypothesis_id: "HYP-STAGE0-DIFFERENT-001", path: "factory/research/runs/RESEARCHBRAIN-STAGE0-UNACCEPTED-PACKET/hypotheses/HYP-STAGE0-DIFFERENT-001.json", sha256: "0".repeat(64) }],
    hypotheses_rejected: [],
    duplicates_detected: [],
    budget_used: { max_sources: 4, sources_used: 1, max_hypotheses: 1, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [sourceRecordArtifact, packetArtifact],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  });
  const candidate = {
    title: "Unaccepted manifest packet candidate",
    objective: "This packet cannot become WFA-ready unless the same-run ideation manifest accepted it.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-UNACCEPTED-PACKET",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.ideation_manifest_gate.manifest_status, "validated");
  assert.equal(sourceQuality.ideation_manifest_gate.accepted_match_count, 0);
  assert.equal(sourceQuality.reasons.includes("researchbrain_ideation_manifest_candidate_not_accepted_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /candidate_not_accepted|source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain direct WFA-ready backlog requires accepted manifest packet hash match", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-ACCEPTED-HASH-MISMATCH/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-ACCEPTED-HASH-MISMATCH/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", packet);
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-ACCEPTED-HASH-MISMATCH/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RESEARCHBRAIN-STAGE0-ACCEPTED-HASH-MISMATCH",
    memory_checked: { checked: true },
    sources_considered: [{ source_id: sourceRecord.source_id, trust_tier: sourceRecord.trust_tier }],
    hypotheses_accepted: [{ hypothesis_id: packet.hypothesis_id, path: packetArtifact.path, sha256: "0".repeat(64) }],
    hypotheses_rejected: [],
    duplicates_detected: [],
    budget_used: { max_sources: 4, sources_used: 1, max_hypotheses: 1, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [sourceRecordArtifact, packetArtifact],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  });
  const candidate = {
    title: "Accepted hash mismatch packet candidate",
    objective: "This packet cannot become WFA-ready unless the accepted manifest entry hash matches the packet.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-ACCEPTED-HASH-MISMATCH",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.ideation_manifest_gate.accepted_match_count, 0);
  assert.equal(sourceQuality.reasons.includes("researchbrain_ideation_manifest_candidate_not_accepted_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /candidate_not_accepted|source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain direct WFA-ready backlog requires manifest artifact path linkage", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MISSING-MANIFEST-SOURCE/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MISSING-MANIFEST-SOURCE/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", packet);
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-MISSING-MANIFEST-SOURCE/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RESEARCHBRAIN-STAGE0-MISSING-MANIFEST-SOURCE",
    memory_checked: { checked: true },
    sources_considered: [{ source_id: sourceRecord.source_id, trust_tier: sourceRecord.trust_tier }],
    hypotheses_accepted: [{ hypothesis_id: packet.hypothesis_id, path: packetArtifact.path, sha256: packetArtifact.sha256 }],
    hypotheses_rejected: [],
    duplicates_detected: [],
    budget_used: { max_sources: 4, sources_used: 1, max_hypotheses: 1, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [packetArtifact],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  });
  const candidate = {
    title: "Missing manifest source artifact candidate",
    objective: "This packet cannot become WFA-ready unless manifest artifact paths include exact source records.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-MISSING-MANIFEST-SOURCE",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.ideation_manifest_gate.packet_artifact_listed, true);
  assert.equal(sourceQuality.ideation_manifest_gate.missing_source_artifact_count, 1);
  assert.equal(sourceQuality.reasons.includes("researchbrain_ideation_manifest_missing_source_artifacts_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /missing_source_artifacts|source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain direct WFA-ready backlog requires manifest run id to match packet run", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir, { trust_tier: "high_research_trust" });
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNID-MISMATCH/source-records/SRC-MICROSTRUCTURE-001.json", sourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNID-MISMATCH/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", packet);
  writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-RUNID-MISMATCH/ideation-manifest.json", {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: "RESEARCHBRAIN-STAGE0-DIFFERENT-RUN",
    memory_checked: { checked: true },
    sources_considered: [{ source_id: sourceRecord.source_id, trust_tier: sourceRecord.trust_tier }],
    hypotheses_accepted: [{ hypothesis_id: packet.hypothesis_id, path: packetArtifact.path, sha256: packetArtifact.sha256 }],
    hypotheses_rejected: [],
    duplicates_detected: [],
    budget_used: { max_sources: 4, sources_used: 1, max_hypotheses: 1, hypotheses_used: 1 },
    operator_relevant_blockers: [],
    artifact_paths: [sourceRecordArtifact, packetArtifact],
    phase8a_universe_constraints: phase8ARefs(rootDir),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  });
  const candidate = {
    title: "Run-id mismatch manifest packet candidate",
    objective: "This packet cannot become WFA-ready with a mismatched same-run ideation ledger.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-RUNID-MISMATCH",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, { rootDir, requireExisting: true });
  assert.equal(sourceQuality.direct_wfa_ready_allowed, false);
  assert.equal(sourceQuality.ideation_manifest_gate.manifest_status, "run_id_mismatch");
  assert.equal(sourceQuality.reasons.includes("researchbrain_ideation_manifest_run_id_mismatch_requires_more_research"), true);
  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /run_id_mismatch|source-quality gate blocks direct WFA-ready/);
});

test("accepted live ResearchBrain canary is consumable only by exact packet and source hashes", () => {
  const rootDir = process.cwd();
  const packetArtifact = {
    path: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/hypotheses/HYP-STAGE0-LIVE-CANARY-001.json",
    sha256: "a4412b1b91f24e024eda6aa51a0e9e085693e426864fb5d7bbc846f103c11af5"
  };
  const sourceRecordArtifact = {
    path: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z/source-records/SRC-LIVE-CANARY-001.json",
    sha256: "197b227b9b290cc3ce8fd06a5ae4ee2300fa79f6901a4fbd4e53ccb14f90f4d5"
  };
  const candidate = {
    title: "Live OFI Stage-0 packet follow-up",
    objective: "Require corroborating sources before any deterministic WFA screening from the live packet.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact],
    research_run_id: "RESEARCHBRAIN-STAGE0-LIVE-20260523T143000Z",
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    status: "requires_more_research"
  };

  assert.equal(validateResearchBrainBacklogCandidate(candidate, { rootDir, requireExisting: true }), true);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    source_record_refs: [{ ...sourceRecordArtifact, sha256: "0".repeat(64) }]
  }, { rootDir, requireExisting: true }), /sha256|source_record_refs/);
  assert.throws(() => validateResearchBrainBacklogCandidate({
    ...candidate,
    status: "ready"
  }, { rootDir, requireExisting: true }), /source-quality gate blocks direct WFA-ready/);
});

test("ResearchBrain-derived planner output must preserve packet and source path hashes", () => {
  const rootDir = tempRoot();
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);
  const secondSourceRecord = validSourceRecord(rootDir, { source_id: "SRC-MICROSTRUCTURE-002", url_or_path_or_doi: "doi:10.0000/fixture-2" });
  const secondSourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-002.json", secondSourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  packet.source_records.push({ source_id: secondSourceRecord.source_id, ...secondSourceRecordArtifact });
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json", packet);
  const backlogItem = {
    id: "AUTO-STAGE0-001",
    title: "Stage-0 packet candidate",
    objective: "Plan a later falsification run from packet provenance.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact, secondSourceRecordArtifact],
    research_run_id: null,
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa"
  };

  assert.throws(() => validatePlannerResult(validPlannerResult(), { rootDir, backlogItem }), /hypothesis_packet path\/sha256/);

  assert.equal(validatePlannerResult(validPlannerResult({
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...packetArtifact },
      { artifact_type: "research_source_record", ...sourceRecordArtifact },
      { artifact_type: "research_source_record", ...secondSourceRecordArtifact }
    ]
  }), { rootDir, backlogItem }), undefined);

  const lowSignalSource = validSourceRecord(rootDir, { trust_tier: "low_signal_trust" });
  const lowSignalSourceArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-PLANNER-LOW/source-records/SRC-MICROSTRUCTURE-001.json", lowSignalSource);
  const lowSignalPacketArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-PLANNER-LOW/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", validHypothesisPacket(rootDir, lowSignalSourceArtifact));
  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "research_wfa",
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    inputs: ["walk forward engine/strategies/stage0_route/wfa_config.yaml"],
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    data_acquisition: {
      status: "must_download",
      reason: "This fixture hides an invalid WFA launch in acquisition commands.",
      acquisition_method: "fixture",
      commands: [".venv/Scripts/python.exe scripts/walk_forward_smoke_test.py --config strategies/stage0_route/wfa_config.yaml"],
      sources: ["fixture://blocked-stage0-source"],
      expected_outputs: ["workspace/data/stage0_route.csv"]
    },
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    expected_artifacts: ["walk forward engine\\strategies\\stage0_route\\wfa_config.yaml"],
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    implementation_steps: [{ action: "write_config", outputs: ["strategies\\stage0_route\\wfa_config.yaml"] }],
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    expected_wfa_config_path: "walk forward engine/strategies/stage0_route/wfa_config.yaml",
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    commands: { launch: ".venv/Scripts/python.exe scripts/walk_forward_smoke_test.py --config strategies/stage0_route/wfa_config.yaml" },
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    data_acquisition: {
      status: "present",
      reason: "This fixture hides a direct WFA config in acquisition metadata.",
      acquisition_method: "fixture",
      expected_outputs: ["workspace/data/stage0_route.csv"],
      metadata: { config_path: "walk forward engine/strategies/stage0_route/wfa_config.yaml" }
    },
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);

  assert.throws(() => validatePlannerResult(validPlannerResult({
    evidence_kind: "data_identity",
    planned_artifacts: [{ path: "walk forward engine/strategies/stage0_route/wfa_config.yaml" }],
    source_hashes: [
      { artifact_type: "hypothesis_packet", ...lowSignalPacketArtifact },
      { artifact_type: "research_source_record", ...lowSignalSourceArtifact }
    ]
  }), {
    rootDir,
    backlogItem: {
      ...backlogItem,
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-PLANNER-LOW"
    }
  }), /planner provenance blocks direct WFA route|single_low_signal_trust_source/);
});

test("WFA-ready compiler propagates ResearchBrain source hashes and blocks low-signal direct routes", () => {
  const rootDir = tempRoot();
  const wfaConfig = writeFixture(rootDir, "walk forward engine/strategies/stage0_route/wfa_config.yaml", "walk_forward:\n  training_months: 3\n  testing_months: 1\n  step_months: 1\n  n_parameter_trials: 5\n  output_directory: strategies/stage0_route/results\ndata:\n  source_file: data/stage0_route.csv\nstrategy:\n  profile_key: STAGE0_ROUTE\nperformance:\n  max_execution_time_seconds: 60\n");
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);
  const secondSourceRecord = validSourceRecord(rootDir, { source_id: "SRC-MICROSTRUCTURE-002", url_or_path_or_doi: "doi:10.0000/fixture-2" });
  const secondSourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-002.json", secondSourceRecord);
  const packet = validHypothesisPacket(rootDir, sourceRecordArtifact);
  packet.source_records.push({ source_id: secondSourceRecord.source_id, ...secondSourceRecordArtifact });
  const packetArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json", packet);
  const backlogItem = {
    id: "IDEA-STAGE0-WFA-READY",
    title: "Stage-0 hash-backed WFA route",
    objective: "Compile a later deterministic WFA route while preserving packet/source hashes.",
    source: "researchbrain_stage0",
    hypothesis_packet_path: packetArtifact.path,
    hypothesis_packet_sha256: packetArtifact.sha256,
    source_record_refs: [sourceRecordArtifact, secondSourceRecordArtifact],
    research_run_id: null,
    researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
    evidence_kind: "research_wfa",
    authority_layer: "python_research",
    status: "ready",
    expected_wfa_config_path: wfaConfig.path
  };

  const compiled = compileWfaReadyPlan({ backlogItem, rootDir, runId: "RUN-STAGE0-WFA-READY" });
  assert.equal(compiled.compiled, true);
  assert.deepEqual(compiled.plan.source_hashes, [
    { artifact_type: "hypothesis_packet", path: packetArtifact.path, sha256: packetArtifact.sha256 },
    { artifact_type: "research_source_record", path: sourceRecordArtifact.path, sha256: sourceRecordArtifact.sha256 },
    { artifact_type: "research_source_record", path: secondSourceRecordArtifact.path, sha256: secondSourceRecordArtifact.sha256 }
  ]);

  const lowSignalSource = validSourceRecord(rootDir, { trust_tier: "low_signal_trust" });
  const lowSignalSourceArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-LOW/source-records/SRC-MICROSTRUCTURE-001.json", lowSignalSource);
  const lowSignalPacketArtifact = writeJsonFixture(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-LOW/hypotheses/HYP-STAGE0-ORDERFLOW-001.json", validHypothesisPacket(rootDir, lowSignalSourceArtifact));
  const blocked = compileWfaReadyPlan({
    rootDir,
    runId: "RUN-STAGE0-LOW",
    backlogItem: {
      ...backlogItem,
      id: "IDEA-STAGE0-LOW",
      hypothesis_packet_path: lowSignalPacketArtifact.path,
      hypothesis_packet_sha256: lowSignalPacketArtifact.sha256,
      source_record_refs: [lowSignalSourceArtifact],
      research_run_id: "RESEARCHBRAIN-STAGE0-LOW",
      status: "requires_more_research",
      candidate_stage: "Phase 8D screening"
    }
  });
  assert.equal(blocked.compiled, false);
  assert.equal(blocked.reason, "researchbrain_source_quality_gate_not_wfa_ready");
  assert.match(blocked.blocked_reason, /source-quality gate blocked direct Phase 8D WFA route/i);
});

test("ResearchBrain artifacts cannot enter Phase 8A registration or leaderboard authority", () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const sourceRecord = validSourceRecord(rootDir);
  const sourceRecordArtifact = writeJsonFixture(rootDir, "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json", sourceRecord);

  assert.throws(() => writePhase8AMt5ArtifactRegistrationFromRequest({
    rootDir,
    observedAt: "2026-05-20T00:20:00Z",
    request: {
      schema_version: "phase8a_mt5_artifact_registration_request_v1",
      registration_id: "PHASE8A-SHOULD-REJECT-RESEARCHBRAIN",
      artifact_paths: [sourceRecordArtifact.path]
    }
  }), /cannot register Phase 8B\/ResearchBrain/);

  fs.writeFileSync(paths.evidenceIndex, JSON.stringify([{
    run_id: "RUN-STAGE0-LEADERBOARD-001",
    mode: "live",
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    backlog_item_id: "AUTO-STAGE0-001",
    experiment_id: "EXP-STAGE0-001",
    verdict: "passed",
    evidence_score: 100,
    overall_score: 100,
    metrics: { sharpe_oos: 99, total_trades: 1000, windows_completed: 10, aggregate_return_pct: 50 },
    source_hashes: [sourceRecordArtifact],
    recorded_at: "2026-05-20T00:21:00Z"
  }], null, 2));

  const rebuilt = rebuildNormalizedMemory(paths);
  assert.equal(rebuilt.evidence[0].promotable, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.leaderboard, "utf8")), []);
});

test("Ideator and Planner prompts require Stage-0 packet path/hash provenance", () => {
  const retrieval = {
    stage0_hypothesis_packets: [{
      source_path: "factory/research/stage0/RUN-RESEARCH-001/hypothesis-packet-001.json",
      artifact_sha256: "1".repeat(64),
      hypothesis_id: "HYP-STAGE0-ORDERFLOW-001"
    }],
    stage0_source_records: [{
      source_path: "factory/research/stage0/RUN-RESEARCH-001/source-record-001.json",
      artifact_sha256: "2".repeat(64),
      source_id: "SRC-MICROSTRUCTURE-001"
    }]
  };
  const state = { iteration: 1, market_policy: { allowed: true } };
  const factoryStats = { totalRuns: 0, lessons: [], evidence: [], leaderboard: [], marketPolicy: { allowed: true } };
  const ideator = ideatorPrompt({ state, factoryStats, retrieval });
  assert.match(ideator, /source='researchbrain_stage0'/);
  assert.match(ideator, /hypothesis_packet_path/);
  assert.match(ideator, /hypothesis_packet_sha256/);
  assert.match(ideator, /research_run_id/);
  assert.match(ideator, /source_record_refs path\/sha256/);
  assert.match(ideator, /single low_signal_trust source is not WFA-ready/i);

  const planner = plannerPrompt({
    goal: "Plan from Stage-0 packet",
    backlogItem: {
      id: "AUTO-STAGE0-001",
      title: "Packet-derived candidate",
      objective: "Build a later falsification plan from packet provenance.",
      source: "researchbrain_stage0",
      hypothesis_packet_path: retrieval.stage0_hypothesis_packets[0].source_path,
      hypothesis_packet_sha256: retrieval.stage0_hypothesis_packets[0].artifact_sha256,
      researchbrain_evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
      researchbrain_authority_layer: STAGE0_AUTHORITY_LAYER,
      evidence_kind: "research_wfa"
    },
    state,
    retrieval
  });
  assert.match(planner, /carry hypothesis_packet_path/);
  assert.match(planner, /source_hashes or inputs/);
});

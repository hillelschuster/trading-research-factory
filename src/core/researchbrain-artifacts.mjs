import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RESEARCHBRAIN_REQUEST_SCHEMA_VERSION = "researchbrain_request_v1";
export const RESEARCH_SOURCE_RECORD_SCHEMA_VERSION = "research_source_record_v1";
export const HYPOTHESIS_PACKET_SCHEMA_VERSION = "hypothesis_packet_v1";
export const RESEARCH_DIGEST_SCHEMA_VERSION = "research_digest_v1";
export const RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION = "research_ideation_manifest_v1";
export const RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION = "researchbrain_stage0_manifest_v1";
export const STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND = "stage0_research_discovery";
export const STAGE0_AUTHORITY_LAYER = "stage_0_discovery";

const RESEARCHBRAIN_ARTIFACT_SCHEMA_VERSIONS = new Set([
  RESEARCH_SOURCE_RECORD_SCHEMA_VERSION,
  HYPOTHESIS_PACKET_SCHEMA_VERSION,
  RESEARCH_DIGEST_SCHEMA_VERSION,
  RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION
]);

const RESEARCHBRAIN_ARTIFACT_TYPES = {
  [RESEARCH_SOURCE_RECORD_SCHEMA_VERSION]: "research_source_record",
  [HYPOTHESIS_PACKET_SCHEMA_VERSION]: "hypothesis_packet",
  [RESEARCH_DIGEST_SCHEMA_VERSION]: "research_digest",
  [RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION]: "research_ideation_manifest"
};

const DEFAULT_PHASE8A_UNIVERSE_SNAPSHOT_PATH = "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json";
const DEFAULT_PHASE8A_TERMINAL_INVENTORY_PATH = "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SOURCE_TRUST_TIERS = new Set([
  "high_operational_trust",
  "high_research_trust",
  "medium_implementation_trust",
  "low_signal_trust"
]);
export const RESEARCHBRAIN_FORBIDDEN_PROFITABILITY_KEYS = new Set([
  "annualized_return_pct",
  "backtest_summary",
  "cagr",
  "edge_score",
  "edge_rating",
  "evidence_score",
  "estimated_pnl",
  "expected_return",
  "overall_score",
  "pnl_total",
  "profit_factor",
  "profitability_estimate",
  "profitability_label",
  "promotion_recommendation",
  "promote_to_leaderboard",
  "return_pct",
  "sharpe",
  "sharpe_ratio",
  "sharpe_oos",
  "sortino",
  "strategy_score",
  "wfa_metrics",
  "win_rate"
]);

const RESEARCH_SOURCE_RECORD_ALLOWED_FIELDS = new Set([
  "schema_version",
  "evidence_kind",
  "authority_layer",
  "source_id",
  "source_type",
  "trust_tier",
  "url_or_path_or_doi",
  "accessed_at",
  "content_hash_or_unavailable_reason",
  "claims_extracted",
  "limitations",
  "disconfirming_relevance",
  "artifact",
  "source_fetch",
  "request_id",
  "provider_provenance",
  "official_state_mutated",
  "official_evidence_index_mutated",
  "official_backlog_mutated",
  "official_leaderboard_mutated",
  "profitability_labels_created",
  "deterministic_workers_bypassed"
]);

const HYPOTHESIS_PACKET_ALLOWED_FIELDS = new Set([
  "schema_version",
  "evidence_kind",
  "authority_layer",
  "hypothesis_id",
  "mechanism",
  "falsifiable_prediction",
  "market_structure_assumption",
  "instrument_scope",
  "timeframe_candidate",
  "strategy_family",
  "mt5_relevance_classification",
  "mt5_instrument_equivalence",
  "required_data",
  "expected_holding_period",
  "expected_trade_frequency",
  "expected_failure_modes",
  "invalidation_criteria",
  "implementation_shape",
  "execution_sensitivity",
  "mt5_ftmo_concerns",
  "prior_related_lessons",
  "prior_failed_patterns_checked",
  "novelty_reason",
  "disconfirming_evidence",
  "proposed_experiment_shape",
  "source_records",
  "cited_source_ids",
  "source_claims",
  "phase8a_universe_constraints",
  "official_state_mutated",
  "official_evidence_index_mutated",
  "official_backlog_mutated",
  "official_leaderboard_mutated",
  "profitability_labels_created",
  "deterministic_workers_bypassed",
  "content_hash"
]);

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyObject(value) {
  return hasObject(value) && Object.keys(value).length > 0;
}

function hasMeaningfulArray(value, minLength = 1) {
  return Array.isArray(value) && value.length >= minLength;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`ResearchBrain ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function validateSha(value, label, errors) {
  if (!SHA256_PATTERN.test(String(value || ""))) errors.push(`${label}.sha256 must be a valid sha256`);
}

function validateArtifactRef(ref, label, errors, { rootDir = null, requireExisting = false } = {}) {
  if (!hasObject(ref)) {
    errors.push(`${label} artifact reference is required`);
    return;
  }
  if (!hasText(ref.path, 3)) errors.push(`${label}.path is required`);
  validateSha(ref.sha256, label, errors);
  if (!rootDir || !hasText(ref.path, 3)) return;

  let fullPath;
  try {
    fullPath = resolveRepoRelativePath(rootDir, ref.path, label);
  } catch (error) {
    errors.push(error.message);
    return;
  }
  if (!fs.existsSync(fullPath)) {
    if (requireExisting) errors.push(`${label}.path is missing on disk: ${ref.path}`);
    return;
  }
  const actual = sha256File(fullPath);
  if (actual !== String(ref.sha256).toLowerCase()) errors.push(`${label}.sha256 does not match ${ref.path}`);
}

function collectForbiddenKeys(value, pathPrefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenKeys(item, `${pathPrefix}[${index}]`));
  }
  if (!hasObject(value)) return [];
  const matches = [];
  for (const [key, item] of Object.entries(value)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (RESEARCHBRAIN_FORBIDDEN_PROFITABILITY_KEYS.has(key)) matches.push(currentPath);
    matches.push(...collectForbiddenKeys(item, currentPath));
  }
  return matches;
}

function rejectUnknownFields(value, allowedFields, label, errors) {
  if (!hasObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) errors.push(`${label} contains unexpected field: ${key}`);
  }
}

function assertNoProfitabilityClaims(value, errors) {
  const forbiddenKeys = collectForbiddenKeys(value);
  if (forbiddenKeys.length > 0) {
    errors.push(`Stage-0 ResearchBrain artifacts cannot contain profitability or promotion fields: ${forbiddenKeys.join(", ")}`);
  }
}

function validateStage0Boundary(value, errors) {
  if (value.authority_layer !== STAGE0_AUTHORITY_LAYER) errors.push(`authority_layer must be ${STAGE0_AUTHORITY_LAYER}`);
  if (value.evidence_kind !== undefined && value.evidence_kind !== STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND) {
    errors.push(`evidence_kind must be ${STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND} when provided`);
  }
  if (value.official_state_mutated === true || value.official_evidence_index_mutated === true || value.official_backlog_mutated === true || value.official_leaderboard_mutated === true) {
    errors.push("Stage-0 ResearchBrain artifacts must not mutate official state, evidence, backlog, or leaderboard files");
  }
  if (value.profitability_labels_created === true) errors.push("Stage-0 ResearchBrain artifacts must not create profitability labels");
  if (value.deterministic_workers_bypassed === true) errors.push("Stage-0 ResearchBrain artifacts must not bypass deterministic workers");
}

function validatePhase8AConstraints(value, errors, options) {
  const constraints = value.phase8a_universe_constraints;
  if (!hasObject(constraints)) {
    errors.push("phase8a_universe_constraints is required");
    return;
  }
  validateArtifactRef(constraints.universe_snapshot, "phase8a_universe_constraints.universe_snapshot", errors, options);
  if (constraints.terminal_inventory !== undefined) {
    validateArtifactRef(constraints.terminal_inventory, "phase8a_universe_constraints.terminal_inventory", errors, options);
  }
}

function validateSourceRecordRefs(records, errors, options) {
  if (!hasMeaningfulArray(records)) {
    errors.push("source_records must be a non-empty array of path/hash references");
    return;
  }
  records.forEach((record, index) => {
    if (!hasObject(record)) {
      errors.push(`source_records[${index}] must be an object`);
      return;
    }
    if (!hasText(record.source_id, 3)) errors.push(`source_records[${index}].source_id is required`);
    validateArtifactRef(record, `source_records[${index}]`, errors, options);
  });
}

function validateMt5Classification(value, errors, options) {
  const classification = hasObject(value.mt5_relevance_classification)
    ? value.mt5_relevance_classification.classification
    : value.mt5_relevance_classification;
  if (!hasText(classification, 3)) {
    errors.push("mt5_relevance_classification is required");
    return;
  }
  if (String(classification).trim() === "mt5_verified") {
    validateArtifactRef(value.mt5_instrument_equivalence, "mt5_instrument_equivalence", errors, options);
  }
}

function throwIfErrors(errors, label) {
  if (errors.length > 0) throw new Error(`${label} validation failed: ${errors.join("; ")}`);
  return true;
}

function researchJsonPaths(rootDir) {
  const researchRoot = path.join(rootDir, "factory", "research");
  if (!fs.existsSync(researchRoot)) return [];
  const paths = [];
  const stack = [researchRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) paths.push(fullPath);
    }
  }
  return paths.sort();
}

function artifactRecord(rootDir, repoRelativePath, artifact) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, "artifact.path");
  const stat = fs.statSync(fullPath);
  return {
    artifact_type: RESEARCHBRAIN_ARTIFACT_TYPES[artifact.schema_version],
    schema_version: artifact.schema_version,
    path: repoRelativePath,
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
    source_id: artifact.source_id ?? null,
    hypothesis_id: artifact.hypothesis_id ?? null,
    digest_id: artifact.digest_id ?? null,
    research_run_id: artifact.research_run_id ?? null
  };
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function manifestStatus(artifacts) {
  const counts = countBy(artifacts, (artifact) => artifact.artifact_type);
  if ((counts.research_source_record ?? 0) < 1 || (counts.hypothesis_packet ?? 0) < 1) {
    return "blocked_no_source_backed_hypothesis_packet";
  }
  return "ready";
}

function defaultStage0ManifestId(observedAt) {
  return `RESEARCHBRAIN-STAGE0-MANIFEST-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "researchbrain-stage0-manifest";
}

function artifactRefFromPath(rootDir, repoRelativePath) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, "artifact_path");
  if (!fs.existsSync(fullPath)) throw new Error(`ResearchBrain artifact path is missing on disk: ${repoRelativePath}`);
  return { path: repoRelativePath, sha256: sha256File(fullPath) };
}

function defaultResearchBrainRequestId(observedAt) {
  return `RESEARCHBRAIN-REQUEST-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

export function validateResearchBrainRequest(request, options = {}) {
  const errors = [];
  if (!hasObject(request)) throw new Error("ResearchBrain request must be an object.");
  if (request.schema_version !== undefined && request.schema_version !== RESEARCHBRAIN_REQUEST_SCHEMA_VERSION) errors.push(`schema_version must be ${RESEARCHBRAIN_REQUEST_SCHEMA_VERSION} when provided`);
  if (request.evidence_kind !== undefined && request.evidence_kind !== STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND) errors.push(`evidence_kind must be ${STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND} when provided`);
  if (request.authority_layer !== undefined && request.authority_layer !== STAGE0_AUTHORITY_LAYER) errors.push(`authority_layer must be ${STAGE0_AUTHORITY_LAYER} when provided`);
  if (request.request_id !== undefined && !hasText(request.request_id, 3)) errors.push("request_id must be meaningful when provided");
  if (!hasText(request.research_question, 12)) errors.push("research_question is required");
  if (!hasText(request.market_scope, 3) && !hasNonEmptyObject(request.market_scope)) errors.push("market_scope is required");
  if (request.mt5_instrument_scope !== undefined && !hasText(request.mt5_instrument_scope, 1) && !hasNonEmptyObject(request.mt5_instrument_scope) && !hasMeaningfulArray(request.mt5_instrument_scope)) {
    errors.push("mt5_instrument_scope must be meaningful when provided");
  }
  if (!Array.isArray(request.prior_failed_patterns)) errors.push("prior_failed_patterns must be an array");
  if (!Array.isArray(request.prior_lessons)) errors.push("prior_lessons must be an array");
  if (!Number.isInteger(request.max_sources) || request.max_sources < 1 || request.max_sources > 25) errors.push("max_sources must be an integer from 1 to 25");
  if (!Number.isInteger(request.max_hypotheses) || request.max_hypotheses < 1 || request.max_hypotheses > 10) errors.push("max_hypotheses must be an integer from 1 to 10");
  if (request.novelty_required !== true) errors.push("novelty_required must be true");
  if (request.phase8a_universe_constraints !== undefined) validatePhase8AConstraints(request, errors, options);
  asArray(request.prior_hypothesis_packets).forEach((record, index) => validateArtifactRef(record, `prior_hypothesis_packets[${index}]`, errors, options));
  asArray(request.prior_source_records).forEach((record, index) => validateArtifactRef(record, `prior_source_records[${index}]`, errors, options));
  if (request.official_state_mutated === true || request.official_evidence_index_mutated === true || request.official_backlog_mutated === true || request.official_leaderboard_mutated === true) {
    errors.push("ResearchBrain requests must not mutate official state, evidence, backlog, or leaderboard files");
  }
  assertNoProfitabilityClaims(request, errors);
  return throwIfErrors(errors, "ResearchBrain request");
}

export function buildResearchBrainRequestArtifact({
  rootDir = process.cwd(),
  observedAt = new Date().toISOString(),
  requestId = null,
  researchQuestion = "Find source-backed, falsifiable trading mechanisms constrained to the FTMO MT5 universe and suitable only for later deterministic WFA falsification.",
  marketScope = "multi_asset_ftmo_mt5",
  universeSnapshotPath = DEFAULT_PHASE8A_UNIVERSE_SNAPSHOT_PATH,
  terminalInventoryPath = DEFAULT_PHASE8A_TERMINAL_INVENTORY_PATH,
  priorFailedPatterns = [],
  priorLessons = [],
  priorHypothesisPackets = [],
  priorSourceRecords = [],
  maxSources = 8,
  maxHypotheses = 3
} = {}) {
  const root = path.resolve(rootDir);
  const request = {
    schema_version: RESEARCHBRAIN_REQUEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    request_id: requestId ?? defaultResearchBrainRequestId(observedAt),
    generated_at: observedAt,
    research_question: researchQuestion,
    market_scope: marketScope,
    mt5_instrument_scope: {
      source: "phase8a_ftmo_mt5_tradable_universe",
      allowed_scope: "Any broker-supported FTMO/MT5 symbol with enough data and plausible mechanism; not crypto-only; prediction markets excluded.",
      mt5_verified_requires: "terminal-backed mt5_instrument_equivalence before any external/current data becomes MT5-bound"
    },
    phase8a_universe_constraints: {
      universe_snapshot: artifactRefFromPath(root, universeSnapshotPath),
      terminal_inventory: artifactRefFromPath(root, terminalInventoryPath)
    },
    prior_failed_patterns: priorFailedPatterns,
    prior_lessons: priorLessons,
    prior_hypothesis_packets: priorHypothesisPackets,
    prior_source_records: priorSourceRecords,
    source_family_allowlist: [
      "high_operational_trust",
      "high_research_trust",
      "medium_implementation_trust",
      "low_signal_trust"
    ],
    max_sources: maxSources,
    max_hypotheses: maxHypotheses,
    novelty_required: true,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_allowed: false,
    deterministic_workers_bypass_allowed: false
  };
  validateResearchBrainRequest(request, { rootDir: root, requireExisting: true });
  return request;
}

export function writeResearchBrainRequestArtifact({
  rootDir = process.cwd(),
  outputDir = null,
  ...options
} = {}) {
  const root = path.resolve(rootDir);
  const request = buildResearchBrainRequestArtifact({ rootDir: root, ...options });
  const targetDir = outputDir
    ? resolveRepoRelativePath(root, outputDir, "output_dir")
    : path.join(root, "factory", "research", "requests", sanitizePathPart(request.request_id));
  fs.mkdirSync(targetDir, { recursive: true });
  const requestPath = path.join(targetDir, "request.json");
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  const artifact = {
    artifact_type: "researchbrain_request",
    schema_version: RESEARCHBRAIN_REQUEST_SCHEMA_VERSION,
    path: repoRelative(root, requestPath),
    sha256: sha256File(requestPath),
    size_bytes: fs.statSync(requestPath).size,
    modified_at: fs.statSync(requestPath).mtime.toISOString(),
    request_id: request.request_id
  };
  return {
    status: "ready",
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    request,
    artifact
  };
}

export function validateResearchSourceRecord(record, options = {}) {
  const errors = [];
  if (!hasObject(record)) throw new Error("research_source_record is missing or invalid.");
  rejectUnknownFields(record, RESEARCH_SOURCE_RECORD_ALLOWED_FIELDS, "research_source_record", errors);
  if (record.schema_version !== RESEARCH_SOURCE_RECORD_SCHEMA_VERSION) errors.push(`schema_version must be ${RESEARCH_SOURCE_RECORD_SCHEMA_VERSION}`);
  if (record.evidence_kind !== undefined && record.evidence_kind !== STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND) errors.push(`evidence_kind must be ${STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND} when provided`);
  if (!hasText(record.source_id, 3)) errors.push("source_id is required");
  if (!hasText(record.source_type, 3)) errors.push("source_type is required");
  if (!SOURCE_TRUST_TIERS.has(record.trust_tier)) errors.push("trust_tier is unsupported");
  if (!hasText(record.url_or_path_or_doi, 3)) errors.push("url_or_path_or_doi is required");
  if (!hasText(record.accessed_at, 10)) errors.push("accessed_at is required");
  const hashOrReason = record.content_hash_or_unavailable_reason;
  if (!SHA256_PATTERN.test(String(hashOrReason || "")) && !hasText(hashOrReason, 12)) errors.push("content_hash_or_unavailable_reason must be a sha256 or meaningful unavailable reason");
  if (!hasMeaningfulArray(record.claims_extracted)) errors.push("claims_extracted must be a non-empty array");
  if (!hasMeaningfulArray(record.limitations)) errors.push("limitations must be a non-empty array");
  if (!hasMeaningfulArray(record.disconfirming_relevance)) errors.push("disconfirming_relevance must be a non-empty array");
  if (record.artifact !== undefined) validateArtifactRef(record.artifact, "artifact", errors, options);
  assertNoProfitabilityClaims(record, errors);
  return throwIfErrors(errors, RESEARCH_SOURCE_RECORD_SCHEMA_VERSION);
}

export function validateHypothesisPacket(packet, options = {}) {
  const errors = [];
  if (!hasObject(packet)) throw new Error("hypothesis_packet is missing or invalid.");
  rejectUnknownFields(packet, HYPOTHESIS_PACKET_ALLOWED_FIELDS, "hypothesis_packet", errors);
  if (packet.schema_version !== HYPOTHESIS_PACKET_SCHEMA_VERSION) errors.push(`schema_version must be ${HYPOTHESIS_PACKET_SCHEMA_VERSION}`);
  validateStage0Boundary(packet, errors);
  validatePhase8AConstraints(packet, errors, options);

  for (const field of [
    "hypothesis_id",
    "mechanism",
    "falsifiable_prediction",
    "market_structure_assumption",
    "instrument_scope",
    "timeframe_candidate",
    "strategy_family",
    "required_data",
    "expected_holding_period",
    "expected_trade_frequency",
    "implementation_shape",
    "execution_sensitivity",
    "mt5_ftmo_concerns",
    "novelty_reason",
    "proposed_experiment_shape"
  ]) {
    if (!hasText(packet[field], field === "hypothesis_id" ? 3 : 8)) errors.push(`${field} is required`);
  }
  for (const field of [
    "expected_failure_modes",
    "invalidation_criteria",
    "prior_related_lessons",
    "prior_failed_patterns_checked",
    "disconfirming_evidence"
  ]) {
    if (!hasMeaningfulArray(packet[field])) errors.push(`${field} must be a non-empty array`);
  }
  validateMt5Classification(packet, errors, options);
  validateSourceRecordRefs(packet.source_records, errors, options);
  if (!SHA256_PATTERN.test(String(packet.content_hash || ""))) errors.push("content_hash must be a valid sha256");
  assertNoProfitabilityClaims(packet, errors);
  return throwIfErrors(errors, HYPOTHESIS_PACKET_SCHEMA_VERSION);
}

export function validateResearchDigest(digest, options = {}) {
  const errors = [];
  if (!hasObject(digest)) throw new Error("research_digest is missing or invalid.");
  if (digest.schema_version !== RESEARCH_DIGEST_SCHEMA_VERSION) errors.push(`schema_version must be ${RESEARCH_DIGEST_SCHEMA_VERSION}`);
  validateStage0Boundary(digest, errors);
  validatePhase8AConstraints(digest, errors, options);
  if (!hasText(digest.digest_id, 3)) errors.push("digest_id is required");
  if (!hasText(digest.research_run_id, 3)) errors.push("research_run_id is required");
  if (!hasText(digest.generated_at, 10)) errors.push("generated_at is required");
  if (!hasMeaningfulArray(digest.key_findings)) errors.push("key_findings must be a non-empty array");
  if (!hasMeaningfulArray(digest.limitations)) errors.push("limitations must be a non-empty array");
  if (!hasMeaningfulArray(digest.source_records)) errors.push("source_records must be a non-empty array");
  if (!hasMeaningfulArray(digest.hypothesis_packets)) errors.push("hypothesis_packets must be a non-empty array");
  asArray(digest.source_records).forEach((record, index) => validateArtifactRef(record, `source_records[${index}]`, errors, options));
  asArray(digest.hypothesis_packets).forEach((record, index) => validateArtifactRef(record, `hypothesis_packets[${index}]`, errors, options));
  assertNoProfitabilityClaims(digest, errors);
  return throwIfErrors(errors, RESEARCH_DIGEST_SCHEMA_VERSION);
}

export function validateResearchIdeationManifest(manifest, options = {}) {
  const errors = [];
  if (!hasObject(manifest)) throw new Error("research_ideation_manifest is missing or invalid.");
  if (manifest.schema_version !== RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION) errors.push(`schema_version must be ${RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION}`);
  validateStage0Boundary(manifest, errors);
  validatePhase8AConstraints(manifest, errors, options);
  if (!hasText(manifest.research_run_id, 3)) errors.push("research_run_id is required");
  if (manifest.memory_checked !== true && !(hasObject(manifest.memory_checked) && manifest.memory_checked.checked === true)) errors.push("memory_checked must prove memory was checked");
  if (!hasMeaningfulArray(manifest.sources_considered)) errors.push("sources_considered must be a non-empty array");
  if (!Array.isArray(manifest.hypotheses_accepted)) errors.push("hypotheses_accepted must be an array");
  if (!Array.isArray(manifest.hypotheses_rejected)) errors.push("hypotheses_rejected must be an array");
  if (!Array.isArray(manifest.duplicates_detected)) errors.push("duplicates_detected must be an array");
  if (!hasObject(manifest.budget_used)) errors.push("budget_used must be an object");
  if (!Array.isArray(manifest.operator_relevant_blockers)) errors.push("operator_relevant_blockers must be an array");
  if (!hasMeaningfulArray(manifest.artifact_paths)) errors.push("artifact_paths must be a non-empty array of path/hash references");
  asArray(manifest.artifact_paths).forEach((record, index) => validateArtifactRef(record, `artifact_paths[${index}]`, errors, options));
  assertNoProfitabilityClaims(manifest, errors);
  return throwIfErrors(errors, RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION);
}

export function validateResearchBrainArtifact(value, options = {}) {
  switch (value?.schema_version) {
    case RESEARCH_SOURCE_RECORD_SCHEMA_VERSION:
      return validateResearchSourceRecord(value, options);
    case HYPOTHESIS_PACKET_SCHEMA_VERSION:
      return validateHypothesisPacket(value, options);
    case RESEARCH_DIGEST_SCHEMA_VERSION:
      return validateResearchDigest(value, options);
    case RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION:
      return validateResearchIdeationManifest(value, options);
    default:
      throw new Error(`Unsupported ResearchBrain artifact schema_version: ${String(value?.schema_version)}`);
  }
}

export function validateResearchBrainStage0Manifest(manifest, options = {}) {
  const errors = [];
  if (!hasObject(manifest)) throw new Error("ResearchBrain Stage-0 manifest is missing or invalid.");
  if (manifest.schema_version !== RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION) errors.push(`schema_version must be ${RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION}`);
  validateStage0Boundary(manifest, errors);
  if (!hasText(manifest.manifest_id, 3)) errors.push("manifest_id is required");
  if (!hasText(manifest.generated_at, 10)) errors.push("generated_at is required");
  if (!["ready", "blocked_no_source_backed_hypothesis_packet"].includes(manifest.status)) errors.push("status is unsupported");
  if (!Array.isArray(manifest.artifacts)) errors.push("artifacts must be an array");
  if (!hasObject(manifest.artifact_counts)) errors.push("artifact_counts is required");
  if (manifest.official_state_mutated !== false || manifest.official_evidence_index_mutated !== false || manifest.official_backlog_mutated !== false || manifest.official_leaderboard_mutated !== false) {
    errors.push("official mutation flags must all be false");
  }

  const artifacts = asArray(manifest.artifacts);
  const expectedCounts = countBy(artifacts, (artifact) => artifact?.artifact_type);
  for (const [artifactType, expected] of Object.entries(expectedCounts)) {
    if (manifest.artifact_counts[artifactType] !== expected) errors.push(`artifact_counts.${artifactType} must equal ${expected}`);
  }
  if (manifest.status === "ready" && ((manifest.artifact_counts.research_source_record ?? 0) < 1 || (manifest.artifact_counts.hypothesis_packet ?? 0) < 1)) {
    errors.push("ready manifest requires at least one source record and one hypothesis packet");
  }
  artifacts.forEach((artifact, index) => {
    if (!RESEARCHBRAIN_ARTIFACT_SCHEMA_VERSIONS.has(artifact?.schema_version)) errors.push(`artifacts[${index}].schema_version is unsupported`);
    if (artifact?.artifact_type !== RESEARCHBRAIN_ARTIFACT_TYPES[artifact?.schema_version]) errors.push(`artifacts[${index}].artifact_type does not match schema_version`);
    validateArtifactRef(artifact, `artifacts[${index}]`, errors, options);
  });
  assertNoProfitabilityClaims(manifest, errors);
  return throwIfErrors(errors, RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION);
}

export function buildResearchBrainStage0Manifest({
  rootDir = process.cwd(),
  artifactPaths = null,
  observedAt = new Date().toISOString(),
  manifestId = null
} = {}) {
  const root = path.resolve(rootDir);
  const explicitPaths = Array.isArray(artifactPaths) ? artifactPaths : null;
  const candidatePaths = explicitPaths
    ? explicitPaths.map((repoPath) => resolveRepoRelativePath(root, repoPath, "artifact_paths[]"))
    : researchJsonPaths(root);
  const artifacts = [];

  for (const fullPath of candidatePaths) {
    const repoPath = repoRelative(root, fullPath);
    const value = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    if (!RESEARCHBRAIN_ARTIFACT_SCHEMA_VERSIONS.has(value?.schema_version)) {
      if (explicitPaths) throw new Error(`Unsupported ResearchBrain Stage-0 artifact schema_version at ${repoPath}: ${String(value?.schema_version)}`);
      continue;
    }
    validateResearchBrainArtifact(value, { rootDir: root, requireExisting: true });
    artifacts.push(artifactRecord(root, repoPath, value));
  }

  const artifactCounts = countBy(artifacts, (artifact) => artifact.artifact_type);
  const manifest = {
    schema_version: RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    manifest_id: manifestId ?? defaultStage0ManifestId(observedAt),
    generated_at: observedAt,
    status: manifestStatus(artifacts),
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false,
    artifact_counts: artifactCounts,
    artifacts
  };
  validateResearchBrainStage0Manifest(manifest, { rootDir: root, requireExisting: true });
  return manifest;
}

export function writeResearchBrainStage0Manifest({
  rootDir = process.cwd(),
  artifactPaths = null,
  outputDir = null,
  observedAt = new Date().toISOString(),
  manifestId = null
} = {}) {
  const root = path.resolve(rootDir);
  const manifest = buildResearchBrainStage0Manifest({ rootDir: root, artifactPaths, observedAt, manifestId });
  const targetDir = outputDir
    ? resolveRepoRelativePath(root, outputDir, "output_dir")
    : path.join(root, "factory", "research", "manifests", sanitizePathPart(manifest.manifest_id));
  fs.mkdirSync(targetDir, { recursive: true });
  const manifestPath = path.join(targetDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const artifact = artifactRecord(root, repoRelative(root, manifestPath), {
    schema_version: RESEARCHBRAIN_STAGE0_MANIFEST_SCHEMA_VERSION,
    research_run_id: manifest.manifest_id
  });
  artifact.artifact_type = "researchbrain_stage0_manifest";
  validateResearchBrainStage0Manifest(manifest, { rootDir: root, requireExisting: true });
  return {
    status: manifest.status,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    manifest,
    artifact
  };
}

function artifactRefFromCandidate(candidate) {
  if (hasObject(candidate?.hypothesis_packet)) return candidate.hypothesis_packet;
  if (hasText(candidate?.hypothesis_packet_path) || hasText(candidate?.hypothesis_packet_sha256)) {
    return {
      path: candidate.hypothesis_packet_path,
      sha256: candidate.hypothesis_packet_sha256
    };
  }
  return null;
}

function normalizeRefKey(ref) {
  return `${String(ref?.path || "").replace(/\\/g, "/")}|${String(ref?.sha256 || "").toLowerCase()}`;
}

function sourceRecordRefsFromCandidate(candidate) {
  return hasMeaningfulArray(candidate?.source_record_refs) ? candidate.source_record_refs : [];
}

function extractResearchRunIdFromPath(repoRelativePath) {
  const normalized = String(repoRelativePath || "").replace(/\\/g, "/");
  return normalized.match(/^factory\/research\/runs\/([^/]+)\//)?.[1] ?? null;
}

function readJsonArtifact(rootDir, repoRelativePath, label, errors) {
  if (!rootDir || !hasText(repoRelativePath, 3)) return null;
  try {
    const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, label);
    if (!fs.existsSync(fullPath)) return null;
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

function researchRunIdFromCandidate(candidate) {
  return candidate?.research_run_id
    ?? extractResearchRunIdFromPath(candidate?.hypothesis_packet_path ?? candidate?.hypothesis_packet?.path)
    ?? null;
}

function readCandidateHypothesisPacket(candidate, options, errors = []) {
  const ref = artifactRefFromCandidate(candidate);
  if (!options.rootDir || !hasText(ref?.path, 3)) return null;
  const packet = readJsonArtifact(options.rootDir, ref.path, "hypothesis_packet", errors);
  if (!packet) return null;
  try {
    validateHypothesisPacket(packet, options);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return packet;
}

function readSourceRecordTrustTiers(candidate, options, errors = []) {
  const tiers = [];
  if (!options.rootDir) return tiers;
  for (const [index, ref] of sourceRecordRefsFromCandidate(candidate).entries()) {
    const sourceRecord = readJsonArtifact(options.rootDir, ref?.path, `source_record_refs[${index}]`, errors);
    if (!sourceRecord) continue;
    try {
      validateResearchSourceRecord(sourceRecord, options);
      tiers.push(sourceRecord.trust_tier);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return tiers;
}

function researchBrainMemoryGateSignals(candidate) {
  const duplicateMatches = asArray(candidate?.duplicate_memory_matches ?? candidate?.duplicates_detected)
    .filter((item) => item && (typeof item === "object" || typeof item === "string"));
  const rejectionMatches = asArray(candidate?.rejection_memory_matches ?? candidate?.hypotheses_rejected ?? candidate?.rejections_detected)
    .filter((item) => item && (typeof item === "object" || typeof item === "string"));
  const failedPatternMatches = asArray(candidate?.failed_pattern_matches ?? candidate?.failed_pattern_similarity_matches)
    .filter((item) => item && (typeof item === "object" || typeof item === "string"));
  const blocked = candidate?.memory_similarity_blocked === true || candidate?.failed_pattern_blocked === true;
  const reasons = [
    duplicateMatches.length > 0 ? "researchbrain_duplicate_memory_matches_require_more_research" : null,
    rejectionMatches.length > 0 ? "researchbrain_rejection_memory_matches_require_more_research" : null,
    failedPatternMatches.length > 0 ? "researchbrain_failed_pattern_matches_require_more_research" : null,
    blocked ? "researchbrain_memory_similarity_blocked" : null
  ].filter(Boolean);
  return {
    direct_wfa_blocked: reasons.length > 0,
    reasons,
    duplicate_match_count: duplicateMatches.length,
    rejection_match_count: rejectionMatches.length,
    failed_pattern_match_count: failedPatternMatches.length,
    memory_similarity_blocked: blocked
  };
}

function itemReferencesCandidate(item, candidateRefs) {
  const identifiers = candidateRefs.filter((value) => hasText(value, 3));
  if (identifiers.length === 0) return false;
  if (typeof item === "string") return identifiers.some((identifier) => item.includes(identifier));
  if (!hasObject(item)) return false;
  const values = [
    item.hypothesis_id,
    item.candidate_hypothesis_id,
    item.path,
    item.hypothesis_packet_path,
    item.packet_path,
    item.accepted_hypothesis_id,
    item.rejected_hypothesis_id,
    item.duplicate_hypothesis_id,
    item.candidate?.hypothesis_id,
    item.candidate?.path,
    item.candidate?.hypothesis_packet_path,
    item.hypothesis?.hypothesis_id,
    item.hypothesis?.path
  ].filter((value) => typeof value === "string");
  return values.some((value) => identifiers.some((identifier) => value === identifier || value.includes(identifier)));
}

function itemHashMatchesCandidate(item, candidateHash) {
  if (!hasText(candidateHash, 64) || !hasObject(item)) return false;
  const hashes = [
    item.sha256,
    item.content_hash,
    item.hypothesis_packet_sha256,
    item.candidate?.sha256,
    item.candidate?.hypothesis_packet_sha256,
    item.hypothesis?.sha256,
    item.hypothesis?.content_hash
  ].filter((value) => typeof value === "string").map((value) => value.toLowerCase());
  return hashes.includes(candidateHash.toLowerCase());
}

function acceptedItemReferencesCandidate(item, candidateRefs, packetRef) {
  return itemReferencesCandidate(item, candidateRefs) && itemHashMatchesCandidate(item, packetRef?.sha256);
}

function looksLikeCanonicalWfaConfigRef(value) {
  if (typeof value !== "string") return false;
  return /(?:walk forward engine\/)?strategies\/[^/]+\/wfa_config\.ya?ml/i.test(value.replaceAll("\\", "/"));
}

function containsCanonicalWfaConfigRef(value) {
  if (looksLikeCanonicalWfaConfigRef(value)) return true;
  if (Array.isArray(value)) return value.some(containsCanonicalWfaConfigRef);
  if (!hasObject(value)) return false;
  return Object.values(value).some(containsCanonicalWfaConfigRef);
}

function looksLikeWfaCommand(value) {
  if (typeof value === "string") return /walk_forward|wfa_config\.ya?ml/i.test(value);
  if (Array.isArray(value)) return value.some(looksLikeWfaCommand);
  if (!hasObject(value)) return false;
  return Object.values(value).some((item) => looksLikeWfaCommand(item) || containsCanonicalWfaConfigRef(item));
}

function planHasDirectResearchWfaRoute(plan) {
  return plan?.evidence_kind === "research_wfa"
    || hasObject(plan?.advanced_wfa_config)
    || [
      plan?.expected_wfa_config_path,
      plan?.wfa_config_path,
      plan?.advanced_wfa_config,
      plan?.planner_bypass?.wfa_config_path
    ].some((value) => hasText(value, 3) || containsCanonicalWfaConfigRef(value))
    || looksLikeWfaCommand(plan?.commands)
    || looksLikeWfaCommand(plan?.data_acquisition?.commands)
    || [
      ...asArray(plan?.inputs),
      ...asArray(plan?.outputs),
      ...asArray(plan?.expected_outputs),
      ...asArray(plan?.expected_artifacts),
      ...asArray(plan?.planned_artifacts),
      ...asArray(plan?.artifact_paths),
      ...asArray(plan?.result_artifacts),
      ...asArray(plan?.implementation_steps),
      plan?.data_acquisition
    ].some(containsCanonicalWfaConfigRef);
}

function candidateHasExplicitDirectWfaRoute(candidate) {
  return hasObject(candidate?.advanced_wfa_config)
    || [
      candidate?.expected_wfa_config_path,
      candidate?.wfa_config_path,
      candidate?.advanced_wfa_config,
      candidate?.planner_bypass?.wfa_config_path
    ].some((value) => hasText(value, 3) || containsCanonicalWfaConfigRef(value))
    || looksLikeWfaCommand(candidate?.commands)
    || looksLikeWfaCommand(candidate?.data_acquisition?.commands)
    || [
      ...asArray(candidate?.inputs),
      ...asArray(candidate?.outputs),
      ...asArray(candidate?.expected_outputs),
      ...asArray(candidate?.expected_artifacts),
      ...asArray(candidate?.planned_artifacts),
      ...asArray(candidate?.artifact_paths),
      ...asArray(candidate?.result_artifacts),
      ...asArray(candidate?.implementation_steps),
      candidate?.data_acquisition
    ].some(containsCanonicalWfaConfigRef);
}

function artifactRefsInclude(refs, expectedRef) {
  const expectedKey = normalizeRefKey(expectedRef);
  if (!expectedKey || expectedKey === "|") return false;
  return asArray(refs).some((ref) => normalizeRefKey(ref) === expectedKey);
}

function researchBrainManifestGateSignals(candidate, options, errors = []) {
  const rootDir = options.rootDir;
  const runId = researchRunIdFromCandidate(candidate);
  if (!rootDir || !hasText(runId, 3)) {
    return { direct_wfa_blocked: false, reasons: [], manifest_path: null, manifest_status: "not_checked", accepted_match_count: 0, duplicate_match_count: 0, rejection_match_count: 0, blocker_count: 0 };
  }
  const manifestPath = `factory/research/runs/${runId}/ideation-manifest.json`;
  const manifest = readJsonArtifact(rootDir, manifestPath, "research_ideation_manifest", errors);
  if (!hasObject(manifest)) {
    return {
      direct_wfa_blocked: true,
      reasons: ["researchbrain_ideation_manifest_missing_requires_more_research"],
      manifest_path: manifestPath,
      manifest_status: "missing_or_unreadable",
      accepted_match_count: 0,
      duplicate_match_count: 0,
      rejection_match_count: 0,
      blocker_count: 0
    };
  }

  try {
    validateResearchIdeationManifest(manifest, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    return {
      direct_wfa_blocked: true,
      reasons: ["researchbrain_ideation_manifest_invalid_requires_more_research"],
      manifest_path: manifestPath,
      manifest_status: "invalid",
      accepted_match_count: 0,
      duplicate_match_count: 0,
      rejection_match_count: 0,
      blocker_count: 0
    };
  }
  if (manifest.research_run_id !== runId) {
    return {
      direct_wfa_blocked: true,
      reasons: ["researchbrain_ideation_manifest_run_id_mismatch_requires_more_research"],
      manifest_path: manifestPath,
      manifest_status: "run_id_mismatch",
      accepted_match_count: 0,
      duplicate_match_count: 0,
      rejection_match_count: 0,
      blocker_count: 0
    };
  }

  const packet = readCandidateHypothesisPacket(candidate, options, errors);
  const packetRef = artifactRefFromCandidate(candidate);
  const candidateRefs = [packet?.hypothesis_id, packetRef?.path, candidate?.hypothesis_id];
  const acceptedMatches = asArray(manifest.hypotheses_accepted).filter((item) => acceptedItemReferencesCandidate(item, candidateRefs, packetRef));
  const artifactPaths = asArray(manifest.artifact_paths);
  const packetArtifactListed = artifactRefsInclude(artifactPaths, packetRef);
  const missingSourceRefs = sourceRecordRefsFromCandidate(candidate).filter((record) => !artifactRefsInclude(artifactPaths, record));
  const duplicateMatches = asArray(manifest.duplicates_detected).filter((item) => itemReferencesCandidate(item, candidateRefs));
  const rejectionMatches = asArray(manifest.hypotheses_rejected).filter((item) => itemReferencesCandidate(item, candidateRefs));
  const blockerMatches = asArray(manifest.operator_relevant_blockers).filter((item) => {
    const text = typeof item === "string" ? item : JSON.stringify(item ?? {});
    return /duplicate|rejection|failed.pattern|memory.similarity/i.test(text);
  });
  const reasons = [
    acceptedMatches.length === 0 ? "researchbrain_ideation_manifest_candidate_not_accepted_requires_more_research" : null,
    !packetArtifactListed ? "researchbrain_ideation_manifest_missing_packet_artifact_requires_more_research" : null,
    missingSourceRefs.length > 0 ? "researchbrain_ideation_manifest_missing_source_artifacts_requires_more_research" : null,
    duplicateMatches.length > 0 ? "researchbrain_ideation_manifest_duplicate_requires_more_research" : null,
    rejectionMatches.length > 0 ? "researchbrain_ideation_manifest_rejection_requires_more_research" : null,
    blockerMatches.length > 0 ? "researchbrain_ideation_manifest_blocker_requires_more_research" : null
  ].filter(Boolean);
  return {
    direct_wfa_blocked: reasons.length > 0,
    reasons,
    manifest_path: manifestPath,
    manifest_status: "validated",
    accepted_match_count: acceptedMatches.length,
    packet_artifact_listed: packetArtifactListed,
    missing_source_artifact_count: missingSourceRefs.length,
    duplicate_match_count: duplicateMatches.length,
    rejection_match_count: rejectionMatches.length,
    blocker_count: blockerMatches.length
  };
}

export function researchRunIdFromResearchBrainPath(repoRelativePath) {
  return extractResearchRunIdFromPath(repoRelativePath);
}

export function classifyResearchBrainBacklogSourceQuality(candidate, options = {}) {
  if (!isResearchBrainBacklogCandidate(candidate)) {
    return { applies: false, direct_wfa_ready_allowed: true, reasons: [] };
  }
  const errors = [];
  const trustTiers = readSourceRecordTrustTiers(candidate, options, errors);
  const lowSignalCount = trustTiers.filter((tier) => tier === "low_signal_trust").length;
  const sourceCount = trustTiers.length;
  const insufficientIndependentSources = options.rootDir && sourceCount > 0 && sourceCount < 2;
  const lowSignalOnly = sourceCount > 0 && lowSignalCount === sourceCount;
  const singleLowSignalSource = sourceCount === 1 && lowSignalOnly;
  const memoryGate = researchBrainMemoryGateSignals(candidate);
  const manifestGate = researchBrainManifestGateSignals(candidate, options, errors);
  const directWfaReadyAllowed = errors.length === 0 && !insufficientIndependentSources && !singleLowSignalSource && !lowSignalOnly && memoryGate.direct_wfa_blocked !== true && manifestGate.direct_wfa_blocked !== true;
  const reasons = [
    ...errors,
    ...(insufficientIndependentSources ? ["single_source_requires_more_research"] : []),
    ...(singleLowSignalSource ? ["single_low_signal_trust_source_requires_more_research"] : []),
    ...(lowSignalOnly && !singleLowSignalSource ? ["only_low_signal_trust_sources_require_more_research"] : []),
    ...memoryGate.reasons,
    ...manifestGate.reasons
  ];
  return {
    applies: true,
    direct_wfa_ready_allowed: directWfaReadyAllowed,
    required_status: directWfaReadyAllowed ? "ready" : "requires_more_research",
    reasons,
    source_count: sourceCount,
    trust_tiers: trustTiers,
    memory_gate: memoryGate,
    ideation_manifest_gate: manifestGate
  };
}

export function isResearchBrainBacklogCandidate(candidate) {
  return candidate?.source === "researchbrain_stage0"
    || candidate?.source_type === "researchbrain_stage0"
    || hasObject(candidate?.hypothesis_packet)
    || hasText(candidate?.hypothesis_packet_path);
}

export function validateResearchBrainBacklogCandidate(candidate, options = {}) {
  if (!isResearchBrainBacklogCandidate(candidate)) return true;
  const errors = [];
  if (candidate.source !== undefined && candidate.source !== "researchbrain_stage0") errors.push("source must be researchbrain_stage0 when ResearchBrain fields are present");
  if (candidate.source_type !== undefined && candidate.source_type !== "researchbrain_stage0") errors.push("source_type must be researchbrain_stage0 when provided");
  if (candidate.evidence_kind === STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND) errors.push("ResearchBrain-derived backlog items must not use Stage-0 discovery as executable evidence_kind");
  if (candidate.authority_layer === STAGE0_AUTHORITY_LAYER) errors.push("ResearchBrain-derived backlog items must not use Stage-0 discovery as executable authority_layer");
  if (candidate.researchbrain_evidence_kind !== STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND) errors.push("researchbrain_evidence_kind must preserve stage0_research_discovery");
  if (candidate.researchbrain_authority_layer !== STAGE0_AUTHORITY_LAYER) errors.push("researchbrain_authority_layer must preserve stage_0_discovery");
  assertNoProfitabilityClaims(candidate, errors);

  const hypothesisPacketRef = artifactRefFromCandidate(candidate);
  validateArtifactRef(hypothesisPacketRef, "hypothesis_packet", errors, options);
  const sourceRecordRefs = sourceRecordRefsFromCandidate(candidate);
  if (!hasMeaningfulArray(sourceRecordRefs)) errors.push("source_record_refs must preserve at least one ResearchBrain source record path/sha256");
  sourceRecordRefs.forEach((record, index) => validateArtifactRef(record, `source_record_refs[${index}]`, errors, options));

  let packet = null;
  if (options.rootDir && hasText(hypothesisPacketRef?.path)) {
    try {
      const fullPath = resolveRepoRelativePath(options.rootDir, hypothesisPacketRef.path, "hypothesis_packet");
      if (fs.existsSync(fullPath)) {
        packet = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        validateHypothesisPacket(packet, options);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (packet) {
    const packetSourceRefs = asArray(packet.source_records);
    const candidateRefs = new Set(sourceRecordRefs.map(normalizeRefKey));
    packetSourceRefs.forEach((record, index) => {
      if (!candidateRefs.has(normalizeRefKey(record))) {
        errors.push(`source_record_refs must include packet.source_records[${index}] exact path/sha256`);
      }
    });
    const expectedRunId = extractResearchRunIdFromPath(hypothesisPacketRef.path);
    if (expectedRunId && candidate.research_run_id !== expectedRunId) {
      errors.push("research_run_id must match the ResearchBrain run directory for the hypothesis_packet");
    }
  }

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(candidate, options);
  if (sourceQuality.applies && sourceQuality.direct_wfa_ready_allowed === false) {
    const directWfaRoute = candidateHasExplicitDirectWfaRoute(candidate);
    const directScreeningStage = /phase\s*8d|screening|wfa_ready/i.test(String(candidate.candidate_stage || candidate.launch_stage || candidate.readiness || ""));
    if (candidate.status === "ready" || directWfaRoute || directScreeningStage) {
      errors.push(`ResearchBrain source-quality gate blocks direct WFA-ready backlog: ${sourceQuality.reasons.join(", ")}`);
    }
  }

  return throwIfErrors(errors, "ResearchBrain backlog candidate");
}

export function validateResearchBrainPlannerProvenance(plan, options = {}) {
  const backlogItem = options.backlogItem;
  const source = isResearchBrainBacklogCandidate(backlogItem) ? backlogItem : plan;
  if (!isResearchBrainBacklogCandidate(source)) return true;

  const errors = [];
  const hypothesisPacketRef = artifactRefFromCandidate(source);
  validateArtifactRef(hypothesisPacketRef, "hypothesis_packet", errors, options);

  const sourceHashes = asArray(plan?.source_hashes);
  const hasHypothesisPacketHash = sourceHashes.some((record) => record?.path === hypothesisPacketRef?.path && String(record?.sha256 || "").toLowerCase() === String(hypothesisPacketRef?.sha256 || "").toLowerCase());
  if (!hasHypothesisPacketHash) {
    errors.push("Planner result must carry ResearchBrain hypothesis_packet path/sha256 in source_hashes");
  }

  const sourceRecordRefs = hasMeaningfulArray(source?.source_record_refs) ? source.source_record_refs : [];
  sourceRecordRefs.forEach((record, index) => {
    validateArtifactRef(record, `source_record_refs[${index}]`, errors, options);
    const found = sourceHashes.some((sourceHash) => sourceHash?.path === record.path && String(sourceHash?.sha256 || "").toLowerCase() === String(record.sha256 || "").toLowerCase());
    if (!found) errors.push(`Planner result must carry source_record_refs[${index}] path/sha256 in source_hashes`);
  });

  const sourceQuality = classifyResearchBrainBacklogSourceQuality(source, options);
  if (planHasDirectResearchWfaRoute(plan) && sourceQuality.applies && sourceQuality.direct_wfa_ready_allowed === false) {
    errors.push(`ResearchBrain planner provenance blocks direct WFA route: ${sourceQuality.reasons.join(", ")}`);
  }

  if (options.rootDir && hasText(hypothesisPacketRef?.path)) {
    try {
      const fullPath = resolveRepoRelativePath(options.rootDir, hypothesisPacketRef.path, "hypothesis_packet");
      if (fs.existsSync(fullPath)) {
        const packet = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        validateHypothesisPacket(packet, options);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return throwIfErrors(errors, "ResearchBrain planner provenance");
}

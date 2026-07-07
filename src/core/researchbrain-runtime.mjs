import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  HYPOTHESIS_PACKET_SCHEMA_VERSION,
  RESEARCH_DIGEST_SCHEMA_VERSION,
  RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
  RESEARCH_SOURCE_RECORD_SCHEMA_VERSION,
  RESEARCHBRAIN_FORBIDDEN_PROFITABILITY_KEYS,
  STAGE0_AUTHORITY_LAYER,
  STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
  validateHypothesisPacket,
  validateResearchBrainRequest,
  validateResearchDigest,
  validateResearchIdeationManifest,
  validateResearchSourceRecord,
  writeResearchBrainStage0Manifest
} from "./researchbrain-artifacts.mjs";
import { classifyRetryFailure, computeRetryBackoffMs, runWithRetryAttempts } from "./retry-policy.mjs";

export const RESEARCHBRAIN_STAGE0_RUNTIME_RESULT_SCHEMA_VERSION = "researchbrain_stage0_runtime_result_v1";
export const RESEARCHBRAIN_STAGE0_PROVIDER_OUTPUT_SCHEMA_VERSION = "researchbrain_stage0_provider_output_v1";

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (typeof repoRelativePath !== "string" || repoRelativePath.trim().length === 0 || path.isAbsolute(repoRelativePath)) {
    throw new Error(`ResearchBrain runtime ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain runtime ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "researchbrain-stage0-runtime";
}

function jsonRef(rootDir, fullPath) {
  return {
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath)
  };
}

function writeJson(rootDir, repoPath, value) {
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "output_path");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return jsonRef(rootDir, fullPath);
}

function artifactRecord(rootDir, fullPath, artifactType, extra = {}) {
  const stat = fs.statSync(fullPath);
  return {
    artifact_type: artifactType,
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
    ...extra
  };
}

function collectForbiddenKeys(value, pathPrefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenKeys(item, `${pathPrefix}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const matches = [];
  for (const [key, item] of Object.entries(value)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (RESEARCHBRAIN_FORBIDDEN_PROFITABILITY_KEYS.has(key)) matches.push(currentPath);
    matches.push(...collectForbiddenKeys(item, currentPath));
  }
  return matches;
}

function loadRequest({ rootDir, request, requestPath }) {
  if (request) {
    validateResearchBrainRequest(request, { rootDir, requireExisting: true });
    return { request, requestRef: null };
  }
  const fullPath = resolveRepoRelativePath(rootDir, requestPath, "request_path");
  const loaded = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  validateResearchBrainRequest(loaded, { rootDir, requireExisting: true });
  return { request: loaded, requestRef: jsonRef(rootDir, fullPath) };
}

function normalizeProviderOutput(raw, maxOutputBytes) {
  const rawText = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  if (Buffer.byteLength(rawText, "utf8") > maxOutputBytes) {
    throw new Error(`provider output exceeded max_output_bytes ${maxOutputBytes}`);
  }
  const output = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("provider output must be a JSON object");
  if (output.schema_version !== RESEARCHBRAIN_STAGE0_PROVIDER_OUTPUT_SCHEMA_VERSION) {
    throw new Error(`provider output schema_version must be ${RESEARCHBRAIN_STAGE0_PROVIDER_OUTPUT_SCHEMA_VERSION}`);
  }
  const forbiddenKeys = collectForbiddenKeys(output);
  if (forbiddenKeys.length > 0) {
    throw new Error(`provider output contains forbidden profitability or promotion fields: ${forbiddenKeys.join(", ")}`);
  }
  return { rawText, output };
}

function enforceOutputBudget(output, request) {
  const sourceCount = Array.isArray(output.source_captures) ? output.source_captures.length : 0;
  const hypothesisCount = Array.isArray(output.hypothesis_packets) ? output.hypothesis_packets.length : 0;
  if (sourceCount < 1) throw new Error("provider output must include at least one source_captures entry");
  if (hypothesisCount < 1) throw new Error("provider output must include at least one hypothesis_packets entry");
  if (sourceCount > request.max_sources) throw new Error(`provider output used ${sourceCount} sources but request max_sources is ${request.max_sources}`);
  if (hypothesisCount > request.max_hypotheses) throw new Error(`provider output used ${hypothesisCount} hypotheses but request max_hypotheses is ${request.max_hypotheses}`);
}

function enforceProviderResearchRunId(output, runtimeRunId) {
  const providerRunId = output.research_run_id;
  if (providerRunId === undefined || providerRunId === null || providerRunId === "") {
    output.research_run_id = runtimeRunId;
    return;
  }
  if (providerRunId !== runtimeRunId) {
    throw new Error(`provider research_run_id mismatch: expected ${runtimeRunId}, got ${providerRunId}`);
  }
}

function sourceClass(sourceCapture) {
  const value = sourceCapture?.provider_provenance?.source_class ?? sourceCapture?.source_type ?? "";
  return String(value).toLowerCase();
}

function validateProviderOutputSourceSupport(output) {
  const errors = [];
  const captures = Array.isArray(output.source_captures) ? output.source_captures : [];
  const capturesById = new Map(captures.map((capture) => [capture?.source_id, capture]));

  for (const capture of captures) {
    if (!capture?.source_id) continue;
    const klass = sourceClass(capture);
    if (klass.includes("github") || capture.source_type === "github_code_artifact") {
      const metadata = capture.provider_provenance?.metadata;
      if (!metadata || typeof metadata !== "object") errors.push(`source_captures.${capture.source_id} github capture requires provider_provenance.metadata`);
      if (!/^[a-f0-9]{40}$/i.test(String(metadata?.commit_sha ?? ""))) errors.push(`source_captures.${capture.source_id} github capture requires 40-hex commit_sha`);
      if (typeof metadata?.path !== "string" || metadata.path.trim().length === 0) errors.push(`source_captures.${capture.source_id} github capture requires path`);
      if (typeof metadata?.repo_url !== "string" || metadata.repo_url.trim().length === 0) errors.push(`source_captures.${capture.source_id} github capture requires repo_url`);
      if (typeof metadata?.license !== "string" || metadata.license.trim().length < 2) errors.push(`source_captures.${capture.source_id} github capture requires license or unknown`);
      if (metadata?.executed === true || metadata?.imported === true || metadata?.compiled === true) errors.push(`source_captures.${capture.source_id} github artifacts must not be executed, imported, or compiled`);
    }
  }

  for (const hypothesis of Array.isArray(output.hypothesis_packets) ? output.hypothesis_packets : []) {
    const hypothesisId = hypothesis?.hypothesis_id ?? "unknown_hypothesis";
    const citedSourceIds = Array.isArray(hypothesis?.cited_source_ids)
      ? hypothesis.cited_source_ids.filter((sourceId) => typeof sourceId === "string" && sourceId.trim().length > 0)
      : [];
    if (citedSourceIds.length === 0) errors.push(`hypothesis_packets.${hypothesisId} requires cited_source_ids`);
    for (const sourceId of citedSourceIds) {
      if (!capturesById.has(sourceId)) errors.push(`hypothesis_packets.${hypothesisId} cites uncaptured source_id: ${sourceId}`);
    }

    for (const claim of Array.isArray(hypothesis?.source_claims) ? hypothesis.source_claims : []) {
      const sourceId = claim?.citation_source_id ?? claim?.source_id;
      const capture = capturesById.get(sourceId);
      if (!sourceId || !capture) {
        errors.push(`hypothesis_packets.${hypothesisId} source_claim cites uncaptured source_id: ${sourceId}`);
        continue;
      }
      if (!citedSourceIds.includes(sourceId)) errors.push(`hypothesis_packets.${hypothesisId} source_claim source_id is not listed in cited_source_ids: ${sourceId}`);
      if (claim.claim_class === "youtube_title_description") {
        errors.push(`hypothesis_packets.${hypothesisId} YouTube title/description/channel/popularity cannot support a hypothesis`);
      }
      if (claim.claim_class === "youtube_video_content") {
        const chunkIds = Array.isArray(claim.chunk_ids) ? claim.chunk_ids : [];
        const knownChunks = new Set(capture.provider_provenance?.chunk_ids ?? []);
        if (chunkIds.length === 0) errors.push(`hypothesis_packets.${hypothesisId} YouTube video-content claims require timestamped chunk_ids`);
        if (knownChunks.size === 0) errors.push(`hypothesis_packets.${hypothesisId} YouTube source has no captured transcript chunks`);
        for (const chunkId of chunkIds) {
          if (!knownChunks.has(chunkId)) errors.push(`hypothesis_packets.${hypothesisId} cites unknown YouTube chunk_id: ${chunkId}`);
        }
      }
      if (["mt5_ftmo", "mql5"].includes(claim.claim_class)) {
        const klass = sourceClass(capture);
        if (!klass.includes("mql5") && !klass.includes("broker") && !klass.includes("official_docs")) {
          errors.push(`hypothesis_packets.${hypothesisId} MT5/FTMO/MQL5 claim requires captured MQL5, broker, or official-doc source: ${sourceId}`);
        }
      }
    }
  }

  if (errors.length > 0) throw new Error(`provider output source-support validation failed: ${errors.join("; ")}`);
}

function validateArtifactRef(ref, label, errors, { rootDir = null, requireExisting = false } = {}) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    errors.push(`${label} artifact reference is required`);
    return;
  }
  if (typeof ref.path !== "string" || ref.path.length < 3) errors.push(`${label}.path is required`);
  if (!/^[a-f0-9]{64}$/i.test(String(ref.sha256 || ""))) errors.push(`${label}.sha256 must be a valid sha256`);
  if (!rootDir || typeof ref.path !== "string" || ref.path.length < 3) return;
  let fullPath;
  try {
    fullPath = resolveRepoRelativePath(rootDir, ref.path, label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!fs.existsSync(fullPath)) {
    if (requireExisting) errors.push(`${label}.path is missing on disk: ${ref.path}`);
    return;
  }
  const actual = sha256File(fullPath);
  if (actual !== String(ref.sha256).toLowerCase()) errors.push(`${label}.sha256 does not match ${ref.path}`);
}

function throwIfErrors(errors, label) {
  if (errors.length > 0) throw new Error(`${label} validation failed: ${errors.join("; ")}`);
  return true;
}

function computeResearchBrainBackoffMs(attempt, retryDelayMs, retryMaxDelayMs) {
  return computeRetryBackoffMs({ attemptNumber: attempt, baseDelayMs: retryDelayMs, maxDelayMs: retryMaxDelayMs });
}

async function callProviderWithTimeout(provider, context, timeoutMs) {
  const controller = new AbortController();
  let timeout = null;
  try {
    return await Promise.race([
      Promise.resolve(provider.generate({ ...context, signal: controller.signal })),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`provider timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function providerRuntimeArtifacts(provider) {
  if (!provider || typeof provider.getRuntimeArtifacts !== "function") return [];
  const artifacts = provider.getRuntimeArtifacts();
  return Array.isArray(artifacts) ? artifacts : [];
}

function assertOutputDirAvailable(rootDir, runRepoDir, { allowOutputOverwrite = false } = {}) {
  const fullPath = resolveRepoRelativePath(rootDir, runRepoDir, "output_dir");
  if (!fs.existsSync(fullPath)) return;
  const stat = fs.statSync(fullPath);
  if (!stat.isDirectory()) throw new Error(`ResearchBrain output_dir already exists and is not a directory: ${runRepoDir}`);
  const entries = fs.readdirSync(fullPath);
  if (entries.length > 0 && !allowOutputOverwrite) {
    throw new Error(`ResearchBrain output_dir already exists and is non-empty: ${runRepoDir}`);
  }
}

function writeRawAttempt(rootDir, runRepoDir, attemptNumber, rawText) {
  const repoPath = `${runRepoDir}/attempts/attempt-${String(attemptNumber).padStart(3, "0")}/provider-output.raw.json`;
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "attempt_output");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, rawText.endsWith("\n") ? rawText : `${rawText}\n`, "utf8");
  return jsonRef(rootDir, fullPath);
}

function writeQuarantine(rootDir, runRepoDir, attemptNumber, reason, rawRef = null, retry = null) {
  const quarantine = {
    schema_version: "researchbrain_stage0_quarantine_v1",
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    quarantined_at: new Date().toISOString(),
    attempt_number: attemptNumber,
    reason,
    failure_class: retry?.failure_class ?? null,
    retryable: retry?.retryable ?? false,
    retry_attempts: retry?.attempts ?? [],
    raw_provider_output: rawRef,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  };
  return writeJson(rootDir, `${runRepoDir}/quarantine/attempt-${String(attemptNumber).padStart(3, "0")}.json`, quarantine);
}

function validateFetchUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`fetch_url must be a valid URL: ${value}`);
  }
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error(`fetch_url protocol is unsupported: ${parsed.protocol}`);
  return parsed;
}

async function resolveSourceCaptureContent(rootDir, runRepoDir, sourceId, sourceCapture, sourceFetcher) {
  const hasInlineContent = typeof sourceCapture.content === "string" && sourceCapture.content.trim().length > 0;
  const hasContentPath = typeof sourceCapture.content_path === "string" && sourceCapture.content_path.trim().length > 0;
  const hasFetchUrl = typeof sourceCapture.fetch_url === "string" && sourceCapture.fetch_url.trim().length > 0;
  const contentModes = [hasInlineContent, hasContentPath, hasFetchUrl].filter(Boolean).length;
  if (contentModes > 1) throw new Error(`source_captures.${sourceId} must use exactly one of content, content_path, or fetch_url`);
  if (contentModes === 0) throw new Error(`source_captures.${sourceId} must provide content, content_path, or fetch_url`);

  let content;
  let sourceFetch = null;
  if (hasContentPath) {
    const sourceFullPath = resolveRepoRelativePath(rootDir, sourceCapture.content_path, `source_captures.${sourceId}.content_path`);
    if (!fs.existsSync(sourceFullPath)) throw new Error(`source_captures.${sourceId}.content_path is missing on disk: ${sourceCapture.content_path}`);
    content = fs.readFileSync(sourceFullPath, "utf8").trim();
    sourceFetch = {
      mode: "repo_local_file_capture",
      artifact: jsonRef(rootDir, sourceFullPath),
      live_fetch: false
    };
  } else if (hasFetchUrl) {
    if (!sourceFetcher || typeof sourceFetcher.fetch !== "function") {
      throw new Error(`source_captures.${sourceId}.fetch_url requires an explicit sourceFetcher; live fetch is disabled by default`);
    }
    const parsedUrl = validateFetchUrl(sourceCapture.fetch_url);
    const fetched = await sourceFetcher.fetch({ url: parsedUrl.toString(), source_id: sourceCapture.source_id });
    if (!fetched || typeof fetched.content !== "string") throw new Error(`source_captures.${sourceId}.fetch_url returned no content`);
    content = fetched.content.trim();
    sourceFetch = {
      mode: fetched.mode ?? "source_fetcher_capture",
      url: parsedUrl.toString(),
      status: fetched.status ?? null,
      content_type: fetched.content_type ?? null,
      fetched_at: fetched.fetched_at ?? new Date().toISOString(),
      live_fetch: fetched.live_fetch === true,
      source_fetcher: fetched.source_fetcher ?? "unspecified_source_fetcher",
      source_ref: fetched.source_ref ?? null
    };
  } else {
    content = sourceCapture.content.trim();
    sourceFetch = {
      mode: "inline_provider_capture",
      content_hash: sha256Text(content),
      live_fetch: false
    };
  }

  if (content.length < 20) throw new Error(`source_captures.${sourceId}.content must be meaningful`);
  const rawRepoPath = `${runRepoDir}/sources/${sourceId}.md`;
  const rawFullPath = resolveRepoRelativePath(rootDir, rawRepoPath, "source_capture");
  fs.mkdirSync(path.dirname(rawFullPath), { recursive: true });
  fs.writeFileSync(rawFullPath, `${content}\n`, "utf8");
  return { rawRef: jsonRef(rootDir, rawFullPath), sourceFetch };
}

async function writeSourceArtifacts({ rootDir, runRepoDir, request, sourceCapture, observedAt, sourceFetcher }) {
  const sourceId = sanitizePathPart(sourceCapture.source_id);
  const { rawRef, sourceFetch } = await resolveSourceCaptureContent(rootDir, runRepoDir, sourceId, sourceCapture, sourceFetcher);
  const record = {
    schema_version: RESEARCH_SOURCE_RECORD_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    source_id: sourceCapture.source_id,
    source_type: sourceCapture.source_type ?? "fixture_test_double_source",
    trust_tier: sourceCapture.trust_tier ?? "low_signal_trust",
    url_or_path_or_doi: sourceCapture.url_or_path_or_doi ?? `fixture://${sourceCapture.source_id}`,
    accessed_at: sourceCapture.accessed_at ?? observedAt,
    content_hash_or_unavailable_reason: rawRef.sha256,
    claims_extracted: sourceCapture.claims_extracted,
    limitations: sourceCapture.limitations,
    disconfirming_relevance: sourceCapture.disconfirming_relevance,
    artifact: rawRef,
    source_fetch: sourceFetch,
    request_id: request.request_id,
    provider_provenance: sourceCapture.provider_provenance ?? { mode: "fixture_or_test_double", live_research: false }
  };
  validateResearchSourceRecord(record, { rootDir, requireExisting: true });
  const recordRef = writeJson(rootDir, `${runRepoDir}/source-records/${sourceId}.json`, record);
  return { record, recordRef };
}

function buildHypothesisPacket({ rootDir, request, hypothesis, sourceRecordRefs }) {
  const packet = {
    ...hypothesis,
    schema_version: HYPOTHESIS_PACKET_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    source_records: sourceRecordRefs.map((ref) => ({ source_id: ref.source_id, path: ref.path, sha256: ref.sha256 })),
    phase8a_universe_constraints: request.phase8a_universe_constraints,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  };
  packet.content_hash = packet.content_hash ?? sha256Text(JSON.stringify({ ...packet, content_hash: undefined }));
  validateHypothesisPacket(packet, { rootDir, requireExisting: true });
  return packet;
}

async function writeAcceptedArtifacts({ rootDir, runRepoDir, request, output, observedAt, sourceFetcher }) {
  const sourceRecords = [];
  for (const sourceCapture of output.source_captures) {
    sourceRecords.push(await writeSourceArtifacts({
      rootDir,
      runRepoDir,
      request,
      sourceCapture,
      observedAt,
      sourceFetcher
    }));
  }
  const sourceRecordRefs = sourceRecords.map(({ record, recordRef }) => ({ source_id: record.source_id, ...recordRef }));

  const hypothesisRefs = [];
  for (const hypothesis of output.hypothesis_packets) {
    const citedSourceIds = Array.isArray(hypothesis.cited_source_ids) ? new Set(hypothesis.cited_source_ids) : null;
    const packetSourceRecordRefs = citedSourceIds ? sourceRecordRefs.filter((ref) => citedSourceIds.has(ref.source_id)) : sourceRecordRefs;
    const packet = buildHypothesisPacket({ rootDir, request, hypothesis, sourceRecordRefs: packetSourceRecordRefs });
    const hypothesisId = sanitizePathPart(packet.hypothesis_id);
    hypothesisRefs.push(writeJson(rootDir, `${runRepoDir}/hypotheses/${hypothesisId}.json`, packet));
  }

  const digest = {
    schema_version: RESEARCH_DIGEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    digest_id: output.digest_id ?? `DIGEST-${sanitizePathPart(request.request_id)}`,
    research_run_id: output.research_run_id,
    generated_at: observedAt,
    key_findings: output.key_findings ?? ["Fixture/test-double ResearchBrain runtime produced Stage-0 artifacts for plumbing validation only."],
    limitations: output.limitations ?? ["No live research, WFA, MT5 execution, profitability label, or promotion authority was used."],
    source_records: sourceRecordRefs.map(({ source_id, ...ref }) => ref),
    hypothesis_packets: hypothesisRefs,
    phase8a_universe_constraints: request.phase8a_universe_constraints,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  };
  validateResearchDigest(digest, { rootDir, requireExisting: true });
  const digestRef = writeJson(rootDir, `${runRepoDir}/digest.json`, digest);

  const ideation = {
    schema_version: RESEARCH_IDEATION_MANIFEST_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    research_run_id: output.research_run_id,
    memory_checked: output.memory_checked ?? { checked: true, basis: "request prior lessons and prior artifact refs were supplied to provider seam" },
    sources_considered: sourceRecords.map(({ record }) => ({ source_id: record.source_id, trust_tier: record.trust_tier, source_type: record.source_type })),
    hypotheses_accepted: hypothesisRefs.map((ref) => ({ ...ref, status: "accepted_stage0_only" })),
    hypotheses_rejected: output.hypotheses_rejected ?? [],
    duplicates_detected: output.duplicates_detected ?? [],
    budget_used: {
      max_sources: request.max_sources,
      sources_used: sourceRecords.length,
      max_hypotheses: request.max_hypotheses,
      hypotheses_used: hypothesisRefs.length,
      provider_mode: output.provider_mode ?? "fixture_or_test_double"
    },
    operator_relevant_blockers: output.operator_relevant_blockers ?? [],
    artifact_paths: [...sourceRecordRefs.map(({ source_id, ...ref }) => ref), ...hypothesisRefs, digestRef],
    phase8a_universe_constraints: request.phase8a_universe_constraints,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false
  };
  validateResearchIdeationManifest(ideation, { rootDir, requireExisting: true });
  const ideationRef = writeJson(rootDir, `${runRepoDir}/ideation-manifest.json`, ideation);

  return {
    sourceRecordRefs: sourceRecordRefs.map(({ source_id, ...ref }) => ref),
    hypothesisRefs,
    digestRef,
    ideationRef,
    artifactPaths: [...sourceRecordRefs.map(({ source_id, ...ref }) => ref.path), ...hypothesisRefs.map((ref) => ref.path), digestRef.path, ideationRef.path]
  };
}

function officialMutationFlags() {
  return {
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false,
    wfa_executed: false,
    mt5_executed: false
  };
}

export function createFixtureResearchBrainProvider({ mode = "valid" } = {}) {
  let calls = 0;
  return {
    name: "fixture_researchbrain_provider",
    mode,
    get calls() {
      return calls;
    },
    async generate({ request, attempt, run_id: runId }) {
      calls += 1;
      if (mode === "invalid_json") return "{ this is not valid JSON";
      if (mode === "profitability_label") {
        return JSON.stringify({
          schema_version: RESEARCHBRAIN_STAGE0_PROVIDER_OUTPUT_SCHEMA_VERSION,
          profitability_label: "profitable_fixture",
          source_captures: [],
          hypothesis_packets: []
        });
      }
      const researchRunId = runId ?? `RESEARCHBRAIN-STAGE0-FIXTURE-${sanitizePathPart(request.request_id)}-${String(attempt).padStart(3, "0")}`;
      return {
        schema_version: RESEARCHBRAIN_STAGE0_PROVIDER_OUTPUT_SCHEMA_VERSION,
        research_run_id: researchRunId,
        provider_mode: "fixture_test_double",
        key_findings: ["Fixture source supports only runtime plumbing validation, not an edge claim."],
        limitations: ["Fixture/test-double output is not live research and cannot close Phase 8B alone."],
        source_captures: [{
          source_id: "SRC-FIXTURE-STAGE0-001",
          source_type: "fixture_test_double_source",
          trust_tier: "low_signal_trust",
          url_or_path_or_doi: "fixture://researchbrain-stage0-runtime",
          content: "Fixture source text for ResearchBrain Stage-0 runtime plumbing. It describes falsifiable mechanism framing only and contains no profitability evidence.",
          claims_extracted: ["Mechanism-first hypotheses should be falsifiable before any deterministic WFA is launched."],
          limitations: ["Fixture source; not live web, paper, terminal, or broker evidence."],
          disconfirming_relevance: ["A mechanism can be plausible yet fail after spread, swap, session, and OOS controls."],
          provider_provenance: { mode: "fixture_test_double", live_research: false }
        }],
        hypothesis_packets: [{
          hypothesis_id: "HYP-STAGE0-FIXTURE-001",
          mechanism: "Volatility compression followed by directional liquidity-taking pressure may define a falsifiable continuation mechanism.",
          falsifiable_prediction: "If the mechanism is real, later deterministic WFA should show OOS consistency after realistic costs; this fixture makes no such claim.",
          market_structure_assumption: "The idea is constrained to broker-supported FTMO MT5 symbols from the Phase 8A universe.",
          instrument_scope: "Any Phase 8A FTMO MT5 symbol class may be considered later; not crypto-only and no prediction markets.",
          timeframe_candidate: "M15-H1 candidate only, to be selected later by deterministic planning.",
          strategy_family: "volatility_contraction_liquidity_pressure_fixture",
          mt5_relevance_classification: "mt5_relevant_unverified",
          required_data: "MT5 terminal OHLCV plus spread/swap/spec evidence before any MT5-bound claim.",
          expected_holding_period: "Intraday to multi-session; fixture estimate only before WFA.",
          expected_trade_frequency: "Unknown until deterministic planning and data checks; no profitability label assigned.",
          expected_failure_modes: ["Spread and swap costs overwhelm any apparent continuation.", "Effect is isolated to a post-hoc subset and fails across assets."],
          invalidation_criteria: ["No source-backed deterministic pre-registration exists later.", "No OOS consistency after later WFA and cost controls."],
          implementation_shape: "Rule-based signal generator candidate shape for later planning only; no code or WFA is executed here.",
          execution_sensitivity: "Sensitive to spread, swap, session boundaries, contract specs, and bar construction.",
          mt5_ftmo_concerns: "Requires terminal-backed symbol specs and later FTMO rule accounting before any promotion path.",
          prior_related_lessons: request.prior_lessons.length > 0 ? request.prior_lessons : ["Avoid simple RSI-only variants and post-hoc Sharpe chasing."],
          prior_failed_patterns_checked: request.prior_failed_patterns.length > 0 ? request.prior_failed_patterns : ["Historical simple indicator variants are treated as stale overfit-prone patterns."],
          novelty_reason: "Fixture exercises source-backed Stage-0 packet wiring under Phase 8A universe constraints.",
          disconfirming_evidence: ["Fixture provenance means no real external evidence has been collected."],
          proposed_experiment_shape: "Stage-0 discovery artifact only; any later experiment must be separately planned and deterministic.",
          cited_source_ids: ["SRC-FIXTURE-STAGE0-001"]
        }]
      };
    }
  };
}

export function createJsonFileResearchBrainProvider({ rootDir = process.cwd(), outputPath }) {
  const root = path.resolve(rootDir);
  const fullPath = resolveRepoRelativePath(root, outputPath, "provider_output");
  if (!fs.existsSync(fullPath)) throw new Error(`ResearchBrain provider output file is missing: ${outputPath}`);
  const sourceRef = jsonRef(root, fullPath);
  let calls = 0;
  return {
    name: "json_file_researchbrain_provider",
    mode: "repo_local_file_fixture",
    live_research: false,
    source_ref: sourceRef,
    get calls() {
      return calls;
    },
    async generate() {
      calls += 1;
      return fs.readFileSync(fullPath, "utf8");
    }
  };
}

export function createDisabledResearchBrainSourceFetcher() {
  return {
    name: "disabled_researchbrain_source_fetcher",
    live_fetch: false,
    async fetch() {
      throw new Error("ResearchBrain live source fetch is disabled by default");
    }
  };
}

export function createMapResearchBrainSourceFetcher({ sources = {} } = {}) {
  return {
    name: "map_researchbrain_source_fetcher",
    live_fetch: false,
    async fetch({ url }) {
      if (!Object.prototype.hasOwnProperty.call(sources, url)) throw new Error(`No test-double source content for URL: ${url}`);
      return {
        mode: "map_test_double_source_fetch",
        source_fetcher: "map_researchbrain_source_fetcher",
        url,
        status: 200,
        content_type: "text/plain; charset=utf-8",
        fetched_at: "1970-01-01T00:00:00.000Z",
        live_fetch: false,
        content: sources[url]
      };
    }
  };
}

export function createHttpResearchBrainSourceFetcher({
  allowLiveFetch = false,
  allowedHosts = [],
  timeoutMs = 15_000,
  maxBytes = 250_000
} = {}) {
  if (allowLiveFetch !== true) return createDisabledResearchBrainSourceFetcher();
  const allowed = new Set(allowedHosts.map((host) => String(host).toLowerCase()).filter(Boolean));
  if (allowed.size === 0) throw new Error("Live ResearchBrain source fetch requires at least one allowed host.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("source fetch timeoutMs must be 1-120000.");
  if (!Number.isInteger(maxBytes) || maxBytes < 100 || maxBytes > 2_000_000) throw new Error("source fetch maxBytes must be 100-2000000.");
  return {
    name: "http_researchbrain_source_fetcher",
    live_fetch: true,
    allowed_hosts: [...allowed],
    async fetch({ url }) {
      const parsed = validateFetchUrl(url);
      if (!allowed.has(parsed.hostname.toLowerCase())) throw new Error(`ResearchBrain source host is not allowlisted: ${parsed.hostname}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(parsed.toString(), { signal: controller.signal, redirect: "follow" });
        const text = await response.text();
        const bytes = Buffer.byteLength(text, "utf8");
        if (bytes > maxBytes) throw new Error(`ResearchBrain source fetch exceeded maxBytes ${maxBytes}: ${bytes}`);
        if (!response.ok) throw new Error(`ResearchBrain source fetch returned HTTP ${response.status}`);
        return {
          mode: "http_live_source_fetch",
          source_fetcher: "http_researchbrain_source_fetcher",
          url: parsed.toString(),
          status: response.status,
          content_type: response.headers.get("content-type"),
          fetched_at: new Date().toISOString(),
          live_fetch: true,
          content: text
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function validateResearchBrainStage0RuntimeResult(result, options = {}) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("ResearchBrain Stage-0 runtime result must be an object.");
  if (result.schema_version !== RESEARCHBRAIN_STAGE0_RUNTIME_RESULT_SCHEMA_VERSION) errors.push(`schema_version must be ${RESEARCHBRAIN_STAGE0_RUNTIME_RESULT_SCHEMA_VERSION}`);
  if (result.evidence_kind !== STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND) errors.push(`evidence_kind must be ${STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND}`);
  if (result.authority_layer !== STAGE0_AUTHORITY_LAYER) errors.push(`authority_layer must be ${STAGE0_AUTHORITY_LAYER}`);
  if (!["ready", "blocked"].includes(result.status)) errors.push("status must be ready or blocked");
  if (typeof result.run_id !== "string" || result.run_id.length < 3) errors.push("run_id is required");
  if (typeof result.generated_at !== "string" || result.generated_at.length < 10) errors.push("generated_at is required");
  if (!result.provider || typeof result.provider !== "object" || Array.isArray(result.provider)) errors.push("provider is required");
  if (!result.budget || typeof result.budget !== "object" || Array.isArray(result.budget)) {
    errors.push("budget is required");
  } else {
    for (const field of ["max_attempts", "max_provider_calls", "provider_calls_used", "timeout_ms", "max_output_bytes"]) {
      if (!Number.isInteger(result.budget[field]) || result.budget[field] < 0) errors.push(`budget.${field} must be a nonnegative integer`);
    }
    if (result.budget.provider_calls_used > result.budget.max_provider_calls) errors.push("budget.provider_calls_used exceeds max_provider_calls");
    if (result.budget.provider_calls_used > result.budget.max_attempts) errors.push("budget.provider_calls_used exceeds max_attempts");
  }
  if (!Array.isArray(result.attempts)) errors.push("attempts must be an array");
  for (const [index, attempt] of (Array.isArray(result.attempts) ? result.attempts : []).entries()) {
    if (!Number.isInteger(attempt?.attempt) || attempt.attempt < 1) errors.push(`attempts[${index}].attempt must be a positive integer`);
    if (typeof attempt?.status !== "string" || attempt.status.length < 2) errors.push(`attempts[${index}].status is required`);
    if (typeof attempt?.started_at !== "string" || attempt.started_at.length < 10) errors.push(`attempts[${index}].started_at is required`);
    if (typeof attempt?.completed_at !== "string" || attempt.completed_at.length < 10) errors.push(`attempts[${index}].completed_at is required`);
    if (attempt.status !== "accepted") {
      if (typeof attempt?.reason !== "string" || attempt.reason.length < 1) errors.push(`attempts[${index}].reason is required for non-accepted attempts`);
      if (typeof attempt?.error_class !== "string" || attempt.error_class.length < 1) errors.push(`attempts[${index}].error_class is required for non-accepted attempts`);
      if (typeof attempt?.failure_class !== "string" || attempt.failure_class.length < 1) errors.push(`attempts[${index}].failure_class is required for non-accepted attempts`);
    }
    if (attempt?.retryable !== undefined && typeof attempt.retryable !== "boolean") errors.push(`attempts[${index}].retryable must be boolean when present`);
    if (attempt?.backoff_ms !== undefined && (!Number.isInteger(attempt.backoff_ms) || attempt.backoff_ms < 0)) errors.push(`attempts[${index}].backoff_ms must be a nonnegative integer when present`);
    if (attempt?.final_terminal_state !== undefined && typeof attempt.final_terminal_state !== "string") errors.push(`attempts[${index}].final_terminal_state must be a string when present`);
  }
  if (!Array.isArray(result.blockers)) errors.push("blockers must be an array");
  if (!Array.isArray(result.quarantine_paths)) errors.push("quarantine_paths must be an array");
  if (!Array.isArray(result.artifacts_created)) errors.push("artifacts_created must be an array");
  if (result.official_state_mutated !== false || result.official_evidence_index_mutated !== false || result.official_backlog_mutated !== false || result.official_leaderboard_mutated !== false) {
    errors.push("official mutation flags must all be false");
  }
  if (result.profitability_labels_created !== false) errors.push("profitability_labels_created must be false");
  if (result.deterministic_workers_bypassed !== false) errors.push("deterministic_workers_bypassed must be false");
  if (result.wfa_executed !== false) errors.push("wfa_executed must be false");
  if (result.mt5_executed !== false) errors.push("mt5_executed must be false");

  const artifacts = Array.isArray(result.artifacts_created) ? result.artifacts_created : [];
  const artifactTypes = new Set(artifacts.map((artifact) => artifact?.artifact_type));
  if (result.status === "ready") {
    for (const requiredType of ["research_source_record", "hypothesis_packet", "research_digest", "research_ideation_manifest", "researchbrain_stage0_manifest"]) {
      if (!artifactTypes.has(requiredType)) errors.push(`ready result requires artifact_type ${requiredType}`);
    }
    if (!result.stage0_manifest) errors.push("ready result requires stage0_manifest");
  }
  artifacts.forEach((artifact, index) => validateArtifactRef(artifact, `artifacts_created[${index}]`, errors, options));
  if (result.stage0_manifest !== null && result.stage0_manifest !== undefined) validateArtifactRef(result.stage0_manifest, "stage0_manifest", errors, options);
  (Array.isArray(result.quarantine_paths) ? result.quarantine_paths : []).forEach((artifact, index) => validateArtifactRef(artifact, `quarantine_paths[${index}]`, errors, options));
  const forbiddenKeys = collectForbiddenKeys(result);
  if (forbiddenKeys.length > 0) errors.push(`runtime result cannot contain profitability or promotion fields: ${forbiddenKeys.join(", ")}`);
  return throwIfErrors(errors, RESEARCHBRAIN_STAGE0_RUNTIME_RESULT_SCHEMA_VERSION);
}

export async function runResearchBrainStage0Runtime({
  rootDir = process.cwd(),
  request = null,
  requestPath = null,
  outputDir = null,
  runId = null,
  observedAt = new Date().toISOString(),
  provider,
  sourceFetcher = null,
  maxAttempts = 2,
  maxProviderCalls = 2,
  timeoutMs = 30_000,
  maxOutputBytes = 256_000,
  retryDelayMs = 0,
  retryMaxDelayMs = 30_000,
  allowOutputOverwrite = false
} = {}) {
  const root = path.resolve(rootDir);
  if (!provider || typeof provider.generate !== "function") throw new Error("ResearchBrain runtime requires a provider with generate(context).");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error("maxAttempts must be an integer from 1 to 5.");
  if (!Number.isInteger(maxProviderCalls) || maxProviderCalls < 1 || maxProviderCalls > 10) throw new Error("maxProviderCalls must be an integer from 1 to 10.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("timeoutMs must be an integer from 1 to 300000.");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1_000 || maxOutputBytes > 5_000_000) throw new Error("maxOutputBytes must be an integer from 1000 to 5000000.");

  const loaded = loadRequest({ rootDir: root, request, requestPath });
  const runtimeRunId = runId ?? `RESEARCHBRAIN-STAGE0-RUNTIME-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const runRepoDir = outputDir ?? `factory/research/runs/${sanitizePathPart(runtimeRunId)}`;
  resolveRepoRelativePath(root, runRepoDir, "output_dir");
  assertOutputDirAvailable(root, runRepoDir, { allowOutputOverwrite });

  const attempts = [];
  const quarantinePaths = [];
  let providerCalls = 0;
  let accepted = null;

  for (let attempt = 1; attempt <= maxAttempts && providerCalls < maxProviderCalls; attempt += 1) {
    providerCalls += 1;
    let rawRef = null;
    let providerRetryAttempts = [];
    const startedAt = new Date().toISOString();
    try {
      const providerRetry = await runWithRetryAttempts(({ attemptNumber }) => callProviderWithTimeout(provider, {
        root_dir: root,
        run_repo_dir: runRepoDir,
        observed_at: observedAt,
        request: loaded.request,
        request_ref: loaded.requestRef,
        attempt,
        run_id: runtimeRunId,
        provider_retry_attempt: attemptNumber,
        budget: { max_attempts: maxAttempts, max_provider_calls: maxProviderCalls, timeout_ms: timeoutMs, max_output_bytes: maxOutputBytes }
      }, timeoutMs), {
        phase: "researchbrain_provider_call",
        maxAttempts: 1,
        baseDelayMs: retryDelayMs,
        maxDelayMs: retryMaxDelayMs
      });
      providerRetryAttempts = providerRetry.attempts;
      const raw = providerRetry.value;
      const rawText = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
      if (Buffer.byteLength(rawText, "utf8") <= maxOutputBytes) {
        rawRef = writeRawAttempt(root, runRepoDir, attempt, rawText);
      }
      const normalized = normalizeProviderOutput(raw, maxOutputBytes);
      enforceOutputBudget(normalized.output, loaded.request);
      enforceProviderResearchRunId(normalized.output, runtimeRunId);
      validateProviderOutputSourceSupport(normalized.output);
      accepted = { attempt, output: normalized.output, rawRef };
      attempts.push({
        attempt,
        status: "accepted",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        failure_class: null,
        retryable: false,
        backoff_ms: 0,
        final_terminal_state: "accepted",
        raw_provider_output: rawRef,
        provider_retry_attempts: providerRetryAttempts
      });
      break;
    } catch (error) {
      const classification = error?.rf_retry_classification ?? classifyRetryFailure(error, { phase: "researchbrain_provider_or_validation" });
      const retryAttempts = error?.rf_retry_attempts ?? providerRetryAttempts;
      const reason = classification.error_message;
      const backoffMs = classification.retryable === true && attempt < maxAttempts && providerCalls < maxProviderCalls ? computeResearchBrainBackoffMs(attempt, retryDelayMs, retryMaxDelayMs) : 0;
      const quarantineRef = writeQuarantine(root, runRepoDir, attempt, reason, rawRef, { ...classification, attempts: retryAttempts });
      quarantinePaths.push(quarantineRef);
      attempts.push({
        attempt,
        status: "quarantined",
        started_at: retryAttempts[0]?.started_at ?? startedAt,
        completed_at: new Date().toISOString(),
        reason,
        error_class: classification.error_class,
        failure_class: classification.failure_class,
        retryable: classification.retryable === true,
        backoff_ms: backoffMs,
        final_terminal_state: classification.retryable === true && attempt < maxAttempts && providerCalls < maxProviderCalls ? "retry_pending" : classification.failure_class,
        raw_provider_output: rawRef,
        quarantine: quarantineRef,
        provider_retry_attempts: retryAttempts
      });
      if (classification.retryable !== true) break;
      if (retryDelayMs > 0 && attempt < maxAttempts && providerCalls < maxProviderCalls) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  const artifactsCreated = [];
  for (const artifact of providerRuntimeArtifacts(provider)) {
    artifactsCreated.push(artifact);
  }
  let stage0Manifest = null;
  const blockers = [];
  let status = "blocked";

  if (accepted) {
    try {
      const written = await writeAcceptedArtifacts({ rootDir: root, runRepoDir, request: loaded.request, output: accepted.output, observedAt, sourceFetcher });
      for (const ref of written.sourceRecordRefs) artifactsCreated.push({ artifact_type: "research_source_record", ...ref });
      for (const ref of written.hypothesisRefs) artifactsCreated.push({ artifact_type: "hypothesis_packet", ...ref });
      artifactsCreated.push({ artifact_type: "research_digest", ...written.digestRef });
      artifactsCreated.push({ artifact_type: "research_ideation_manifest", ...written.ideationRef });
      stage0Manifest = writeResearchBrainStage0Manifest({
        rootDir: root,
        artifactPaths: written.artifactPaths,
        outputDir: `${runRepoDir}/manifest`,
        observedAt,
        manifestId: `MANIFEST-${sanitizePathPart(runtimeRunId)}`
      });
      artifactsCreated.push({ artifact_type: "researchbrain_stage0_manifest", ...stage0Manifest.artifact });
      status = stage0Manifest.status === "ready" ? "ready" : "blocked";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const classification = classifyRetryFailure(error, { phase: "researchbrain_artifact_acceptance" });
      const quarantineRef = writeQuarantine(root, runRepoDir, accepted.attempt, `accepted provider output rejected during artifact writing: ${classification.error_message}`, accepted.rawRef, classification);
      quarantinePaths.push(quarantineRef);
      const attemptRecord = attempts.find((record) => record.attempt === accepted.attempt);
      if (attemptRecord) {
        attemptRecord.status = "quarantined";
        attemptRecord.reason = classification.error_message;
        attemptRecord.error_class = classification.error_class;
        attemptRecord.failure_class = classification.failure_class;
        attemptRecord.retryable = false;
        attemptRecord.final_terminal_state = classification.failure_class;
        attemptRecord.quarantine = quarantineRef;
      }
      blockers.push("accepted_provider_output_rejected");
    }
  }

  if (!accepted || status !== "ready") {
    const terminalFailureClass = attempts.at(-1)?.final_terminal_state;
    if (terminalFailureClass === "provider_account_or_quota_failure") blockers.push("provider_account_or_quota_failure");
    else blockers.push(providerCalls >= maxProviderCalls ? "provider_call_budget_exhausted" : "no_valid_provider_output");
  }

  const result = {
    schema_version: RESEARCHBRAIN_STAGE0_RUNTIME_RESULT_SCHEMA_VERSION,
    evidence_kind: STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND,
    authority_layer: STAGE0_AUTHORITY_LAYER,
    status,
    run_id: runtimeRunId,
    generated_at: observedAt,
    provider: {
      name: provider.name ?? "anonymous_provider",
      mode: provider.mode ?? "unspecified",
      live_research: provider.live_research === true
    },
    request_ref: loaded.requestRef,
    budget: {
      max_attempts: maxAttempts,
      max_provider_calls: maxProviderCalls,
      provider_calls_used: providerCalls,
      timeout_ms: timeoutMs,
      max_output_bytes: maxOutputBytes
    },
    attempts,
    final_terminal_state: status === "ready" ? "ready" : (attempts.at(-1)?.final_terminal_state ?? "blocked"),
    blockers,
    quarantine_paths: quarantinePaths,
    artifacts_created: artifactsCreated,
    stage0_manifest: stage0Manifest?.artifact ?? null,
    ...officialMutationFlags()
  };

  validateResearchBrainStage0RuntimeResult(result, { rootDir: root, requireExisting: true });
  const resultRef = writeJson(root, `${runRepoDir}/runtime-result.json`, result);
  return {
    ...result,
    result_artifact: {
      artifact_type: "researchbrain_stage0_runtime_result",
      ...resultRef
    },
    run_dir: runRepoDir
  };
}

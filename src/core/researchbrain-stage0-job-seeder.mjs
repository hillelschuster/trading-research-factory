import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RuntimeLedger } from "./runtime-ledger.mjs";
import { validateResearchBrainRequest } from "./researchbrain-artifacts.mjs";
import { RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE } from "./researchbrain-loop-runner.mjs";

export const RESEARCHBRAIN_STAGE0_JOB_SEED_RESULT_SCHEMA_VERSION = "researchbrain_stage0_job_seed_result_v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function nowIso() {
  return new Date().toISOString();
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sanitizeIdPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "REQUEST";
}

function jsonObjectFromText(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Maps request.job_settings snake_case keys to camelCase runtimeOptions keys
// used by buildPayload(). Only the fields relevant to LLM/source/provider settings.
const JOB_SETTINGS_SNAKE_TO_CAMEL = {
  llm_provider: "llmProvider",
  llm_model: "llmModel",
  llm_reasoning_effort: "llmReasoningEffort",
  llm_max_tokens: "llmMaxTokens",
  llm_api_key_env: "llmApiKeyEnv",
  llm_base_url: "llmBaseUrl",
  llm_base_url_env: "llmBaseUrlEnv",
  source_provider: "sourceProvider",
  source_api_key_env: "sourceApiKeyEnv",
  tool_mode: "toolMode",
  max_llm_calls: "maxLlmCalls",
  max_tool_calls: "maxToolCalls",
  max_cost_usd: "maxCostUsd",
  max_transcript_bytes: "maxTranscriptBytes",
  allow_live_source_search: "allowLiveSourceSearch",
  allow_live_source_capture: "allowLiveSourceCapture"
};

function resolveRepoRelativePath(rootDir, repoPath, label = "path") {
  if (typeof repoPath !== "string" || repoPath.trim().length === 0 || path.isAbsolute(repoPath)) {
    throw new Error(`ResearchBrain Stage-0 job seed ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoPath);
  const relative = path.relative(root, fullPath).replace(/\\/g, "/");
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain Stage-0 job seed ${label} escapes repository root: ${repoPath}`);
  }
  return { fullPath, relative };
}

function requireRequestArtifactPath(repoPath) {
  const normalized = String(repoPath).replace(/\\/g, "/");
  if (!normalized.startsWith("factory/research/requests/") || !normalized.endsWith(".json")) {
    throw new Error("ResearchBrain Stage-0 job seed request_path must be an existing JSON artifact under factory/research/requests/.");
  }
}

function stableIds({ request, requestPath, requestSha256 }) {
  const hashPart = sha256Text(JSON.stringify([requestPath, requestSha256])).slice(0, 24).toUpperCase();
  const requestPart = sanitizeIdPart(request.request_id).toUpperCase();
  return {
    run_id: `RUN-RB-STAGE0-${requestPart}-${hashPart}`.slice(0, 140),
    job_id: `JOB-RB-STAGE0-${requestPart}-${hashPart}`.slice(0, 140)
  };
}

function buildPayload({ requestPath, requestSha256, request, runtimeOptions }) {
  const payload = {
    request_path: requestPath,
    request_sha256: requestSha256,
    request_id: request.request_id ?? null,
    run_id: runtimeOptions.runId,
    output_dir: runtimeOptions.outputDir ?? `factory/research/runs/${runtimeOptions.runId}`,
    provider_mode: runtimeOptions.providerMode,
    seeded_by: "researchbrain_stage0_job_seeder",
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    wfa_executed: false,
    mt5_executed: false
  };
  for (const [target, source] of [
    ["max_attempts", "maxAttempts"],
    ["max_provider_calls", "maxProviderCalls"],
    ["timeout_ms", "timeoutMs"],
    ["max_output_bytes", "maxOutputBytes"],
    ["retry_delay_ms", "retryDelayMs"],
    ["llm_provider", "llmProvider"],
    ["llm_model", "llmModel"],
    ["llm_reasoning_effort", "llmReasoningEffort"],
    ["llm_max_tokens", "llmMaxTokens"],
    ["llm_api_key_env", "llmApiKeyEnv"],
    ["llm_base_url", "llmBaseUrl"],
    ["llm_base_url_env", "llmBaseUrlEnv"],
    ["source_provider", "sourceProvider"],
    ["source_api_key_env", "sourceApiKeyEnv"],
    ["tool_mode", "toolMode"],
    ["max_llm_calls", "maxLlmCalls"],
    ["max_tool_calls", "maxToolCalls"],
    ["max_cost_usd", "maxCostUsd"],
    ["max_transcript_bytes", "maxTranscriptBytes"],
    ["allow_live_source_search", "allowLiveSourceSearch"],
    ["allow_live_source_capture", "allowLiveSourceCapture"]
  ]) {
    // Skip null/undefined — only add to payload if the value is meaningful
    if (runtimeOptions[source] !== undefined && runtimeOptions[source] !== null) payload[target] = runtimeOptions[source];
  }
  return payload;
}

function assertExistingRowsCompatible({ existingRun, existingJob, expected }) {
  if (existingRun && existingRun.evidence_kind !== "stage0_research_discovery") {
    throw new Error(`ResearchBrain Stage-0 job seed run_id conflict: ${expected.run_id}`);
  }
  if (existingJob) {
    const payload = jsonObjectFromText(existingJob.payload_json);
    if (existingJob.run_id !== expected.run_id || existingJob.job_type !== RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE || payload.request_sha256 !== expected.request_sha256 || payload.request_path !== expected.request_path) {
      throw new Error(`ResearchBrain Stage-0 job seed job_id conflict: ${expected.job_id}`);
    }
  }
}

function findExistingJobByRequestHash(ledger, requestSha256) {
  const rows = ledger.db.prepare(`
    SELECT jobs.job_id, jobs.run_id, jobs.job_type, jobs.status, jobs.priority, jobs.payload_json,
           runs.status AS run_status, runs.evidence_kind
    FROM jobs
    LEFT JOIN runs ON runs.run_id = jobs.run_id
    WHERE jobs.job_type = ?
    ORDER BY jobs.created_at ASC, jobs.job_id ASC
  `).all(RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE);
  for (const row of rows) {
    const payload = jsonObjectFromText(row.payload_json);
    if (payload.request_sha256 === requestSha256) return { row, payload };
  }
  return null;
}

function buildAlreadySeededResult({ ids, existingJob, existingPayload, actualSha, relative, request, outputDir }) {
  return {
    schema_version: RESEARCHBRAIN_STAGE0_JOB_SEED_RESULT_SCHEMA_VERSION,
    generated_at: nowIso(),
    status: "already_seeded",
    duplicate_resolution: existingJob.job_id === ids.job_id ? "same_job_id" : "same_request_sha256",
    duplicate_of: existingJob.job_id === ids.job_id ? null : {
      run_id: existingJob.run_id,
      job_id: existingJob.job_id,
      job_status: existingJob.status,
      request_path: existingPayload.request_path ?? null,
      request_sha256: existingPayload.request_sha256 ?? null
    },
    run_id: existingJob.run_id ?? ids.run_id,
    job_id: existingJob.job_id ?? ids.job_id,
    job_type: RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE,
    job_status: existingJob.status,
    priority: existingJob.priority,
    request_artifact: { path: relative, sha256: actualSha, request_id: request.request_id ?? null },
    output_dir: existingPayload.output_dir ?? outputDir,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false,
    wfa_executed: false,
    mt5_executed: false,
    phase8e_started: false
  };
}

function readJsonFileIfPresent(fullPath) {
  if (!fs.existsSync(fullPath)) return null;
  if (!fs.statSync(fullPath).isFile()) return { parse_error: "not_a_file" };
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return { parse_error: error instanceof Error ? error.message : String(error) };
  }
}

function inspectOutputIdentityFile({ outputDir, relativePath, expectedRunId }) {
  const parsed = readJsonFileIfPresent(path.join(outputDir.fullPath, relativePath));
  if (!parsed) return null;
  const filePath = `${outputDir.relative}/${relativePath}`;
  if (parsed.parse_error) return `ResearchBrain Stage-0 job seed output_dir collision: ${filePath} is not readable JSON (${parsed.parse_error}).`;
  const actualRunId = parsed.run_id ?? parsed.research_run_id ?? null;
  if (!actualRunId) return `ResearchBrain Stage-0 job seed output_dir collision: ${filePath} lacks run identity.`;
  if (actualRunId !== expectedRunId) return `ResearchBrain Stage-0 job seed output_dir collision: ${filePath} belongs to ${actualRunId}, expected ${expectedRunId}.`;
  return null;
}

function assertOutputDirSafeForNewSeed({ root, outputDir, expectedRunId }) {
  const resolved = resolveRepoRelativePath(root, outputDir, "output_dir");
  if (!fs.existsSync(resolved.fullPath)) return;
  if (!fs.statSync(resolved.fullPath).isDirectory()) {
    throw new Error(`ResearchBrain Stage-0 job seed output_dir exists but is not a directory: ${resolved.relative}`);
  }
  const issue = inspectOutputIdentityFile({ outputDir: resolved, relativePath: "runtime-result.json", expectedRunId })
    ?? inspectOutputIdentityFile({ outputDir: resolved, relativePath: "manifest/manifest.json", expectedRunId });
  if (issue) throw new Error(issue);
}

export function seedResearchBrainStage0Job({
  rootDir = process.cwd(),
  dbPath = null,
  requestPath,
  requestSha256,
  priority = 0,
  status = "queued",
  providerMode = "valid",
  outputDir = null,
  maxAttempts,
  maxProviderCalls,
  timeoutMs,
  maxOutputBytes,
  retryDelayMs
} = {}) {
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) throw new Error("ResearchBrain Stage-0 job seed priority must be an integer from -1000 to 1000.");
  if (!new Set(["queued", "ready"]).has(status)) throw new Error("ResearchBrain Stage-0 job seed status must be queued or ready.");
  if (!SHA256_PATTERN.test(String(requestSha256 || ""))) throw new Error("ResearchBrain Stage-0 job seed request_sha256 must be a valid SHA-256.");
  const root = path.resolve(rootDir);
  const { fullPath, relative } = resolveRepoRelativePath(root, requestPath, "request_path");
  requireRequestArtifactPath(relative);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error(`ResearchBrain Stage-0 job seed request_path is missing on disk: ${relative}`);
  const actualSha = sha256File(fullPath);
  if (actualSha !== String(requestSha256).toLowerCase()) throw new Error(`ResearchBrain Stage-0 job seed request_sha256 does not match ${relative}`);
  const request = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  validateResearchBrainRequest(request, { rootDir: root, requireExisting: true });
  const ids = stableIds({ request, requestPath: relative, requestSha256: actualSha });

  // Merge job-specific settings from the request artifact into runtime options.
  // Function-level params (providerMode, outputDir, etc.) take priority over request settings.
  const requestJobSettings = request.job_settings ?? {};
  const runtimeOptions = { runId: ids.run_id, providerMode, outputDir, maxAttempts, maxProviderCalls, timeoutMs, maxOutputBytes, retryDelayMs };
  for (const [snakeKey, camelKey] of Object.entries(JOB_SETTINGS_SNAKE_TO_CAMEL)) {
    if (requestJobSettings[snakeKey] !== undefined && runtimeOptions[camelKey] === undefined) {
      runtimeOptions[camelKey] = requestJobSettings[snakeKey];
    }
  }
  const payload = buildPayload({ requestPath: relative, requestSha256: actualSha, request, runtimeOptions });
  if (outputDir !== null) resolveRepoRelativePath(root, outputDir, "output_dir");
  const ledger = new RuntimeLedger({ rootDir: root, dbPath });
  const seededAt = nowIso();
  try {
    ledger.migrate();
    return ledger.withImmediateTransaction(() => {
      const existingRun = ledger.getRun(ids.run_id);
      const existingJob = ledger.getJob(ids.job_id);
      assertExistingRowsCompatible({ existingRun, existingJob, expected: { ...ids, request_path: relative, request_sha256: actualSha } });
      if (existingJob) {
        return buildAlreadySeededResult({ ids, existingJob, existingPayload: jsonObjectFromText(existingJob.payload_json), actualSha, relative, request, outputDir: payload.output_dir });
      }

      const duplicateByHash = findExistingJobByRequestHash(ledger, actualSha);
      if (duplicateByHash) {
        return buildAlreadySeededResult({ ids, existingJob: duplicateByHash.row, existingPayload: duplicateByHash.payload, actualSha, relative, request, outputDir: payload.output_dir });
      }

      assertOutputDirSafeForNewSeed({ root, outputDir: payload.output_dir, expectedRunId: ids.run_id });

      if (!existingRun) {
        ledger.insertRun({
          run_id: ids.run_id,
          status,
          evidence_kind: "stage0_research_discovery",
          created_at: seededAt,
          payload: {
            mirror_source: "researchbrain_stage0_job_seeder",
            request_path: relative,
            request_sha256: actualSha,
            request_id: request.request_id ?? null
          }
        });
      }
      ledger.insertJob({
        job_id: ids.job_id,
        run_id: ids.run_id,
        job_type: RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE,
        status,
        priority,
        created_at: seededAt,
        payload
      });
      return {
        schema_version: RESEARCHBRAIN_STAGE0_JOB_SEED_RESULT_SCHEMA_VERSION,
        generated_at: nowIso(),
        status: "seeded",
        run_id: ids.run_id,
        job_id: ids.job_id,
        job_type: RESEARCHBRAIN_STAGE0_LEDGER_JOB_TYPE,
        job_status: status,
        priority,
        request_artifact: { path: relative, sha256: actualSha, request_id: request.request_id ?? null },
        output_dir: payload.output_dir,
        official_state_mutated: false,
        official_evidence_index_mutated: false,
        official_backlog_mutated: false,
        official_leaderboard_mutated: false,
        profitability_labels_created: false,
        deterministic_workers_bypassed: false,
        wfa_executed: false,
        mt5_executed: false,
        phase8e_started: false
      };
    });
  } finally {
    ledger.close();
  }
}

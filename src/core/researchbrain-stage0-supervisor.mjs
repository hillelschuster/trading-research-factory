import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";
import { seedResearchBrainStage0Job } from "./researchbrain-stage0-job-seeder.mjs";
import { runResearchBrainStage0Loop } from "./researchbrain-loop-runner.mjs";
import { consumeResearchBrainStage0Outbox } from "./researchbrain-stage0-outbox-consumer.mjs";
import { buildResearchBrainStage0Diagnostics } from "./researchbrain-stage0-diagnostics.mjs";
import { buildResearchBrainStage0ReadinessReport } from "./researchbrain-stage0-readiness.mjs";

export const RESEARCHBRAIN_STAGE0_SUPERVISOR_RESULT_SCHEMA_VERSION = "researchbrain_stage0_supervisor_result_v1";
export const RESEARCHBRAIN_STAGE0_SUPERVISOR_RUN_RESULT_SCHEMA_VERSION = "researchbrain_stage0_supervisor_run_result_v1";
export const RESEARCHBRAIN_STAGE0_SUPERVISOR_FAILURE_REPORT_SCHEMA_VERSION = "researchbrain_stage0_supervisor_failure_report_v1";
export const RESEARCHBRAIN_STAGE0_SUPERVISOR_RUN_REPORT_SCHEMA_VERSION = "researchbrain_stage0_supervisor_run_report_v1";
export const RESEARCHBRAIN_STAGE0_SUPERVISOR_AUTO_SEED_SCHEMA_VERSION = "researchbrain_stage0_supervisor_auto_seed_result_v1";
export const RESEARCHBRAIN_STAGE0_SUPERVISOR_PREFLIGHT_SCHEMA_VERSION = "researchbrain_stage0_supervisor_preflight_v1";
export const RESEARCHBRAIN_STAGE0_QUEUE_DRAIN_PLAN_SCHEMA_VERSION = "researchbrain_stage0_queue_drain_plan_v1";
export const RESEARCHBRAIN_STAGE0_OPERATOR_COMMAND_PROFILE_SCHEMA_VERSION = "researchbrain_stage0_operator_command_profile_v1";

const TERMINAL_JOB_STATUSES = new Set(["blocked", "poisoned"]);
const NON_ACTIONABLE_TERMINAL_DIAGNOSTICS = new Set(["blocked_jobs", "poisoned_jobs"]);
const MULTI_CYCLE_DRAINABLE_ATTENTION = new Set(["diagnostics_attention", "claimable_stage0_jobs", "pending_outbox_events", "unseeded_valid_request_artifacts"]);
const AUTO_SEED_BLOCKING_ATTENTION = new Set([
  "invalid_request_artifacts",
  "seeded_request_artifact_drift",
  "seeded_output_collision",
  "projection_parse_error",
  "stale_projection_refs",
  "processed_outbox_projection_mismatch",
  "projection_recovery_attention",
  "runtime_ledger_consistency_attention",
  "unreconciled_terminal_stage0_failures"
]);

function nowIso() {
  return new Date().toISOString();
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function safePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "failure";
}

function resolveRepoRelativePath(rootDir, repoPath, label = "path") {
  if (typeof repoPath !== "string" || repoPath.trim().length === 0 || path.isAbsolute(repoPath)) {
    throw new Error(`ResearchBrain Stage-0 supervisor ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoPath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain Stage-0 supervisor ${label} escapes repository root: ${repoPath}`);
  }
  return fullPath;
}

function requireBoundedInteger(value, { field, min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`ResearchBrain Stage-0 supervisor ${field} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function requireBoundedNumber(value, { field, min, max }) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`ResearchBrain Stage-0 supervisor ${field} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}

function validateSeedArgs({ requestPath, requestSha256 }) {
  const hasPath = requestPath !== undefined && requestPath !== null;
  const hasSha = requestSha256 !== undefined && requestSha256 !== null;
  if (hasPath !== hasSha) throw new Error("ResearchBrain Stage-0 supervisor requires both requestPath and requestSha256 when seeding.");
  return hasPath;
}

function requestEntriesToAutoSeed(readiness, limit) {
  return (readiness?.requests?.entries ?? [])
    .filter((entry) => entry.valid === true && entry.seeded === false)
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, limit);
}

function autoSeedBlockingReasons(readiness) {
  const reasons = new Set();
  for (const reason of readiness?.attention_reasons ?? []) {
    if (AUTO_SEED_BLOCKING_ATTENTION.has(reason)) reasons.add(reason);
  }
  for (const reason of readiness?.actionable_diagnostics_reasons ?? []) reasons.add(reason);
  return [...reasons];
}

function autoSeedStatus({ enabled, blockers, seeded, failures, eligible }) {
  if (!enabled) return "disabled";
  if (blockers.length > 0) return "blocked";
  if (failures.length > 0) return seeded.length > 0 ? "partial" : "failed";
  if (seeded.length > 0) return "seeded";
  return eligible > 0 ? "limit_zero_or_no_selection" : "idle";
}

function defaultLlmApiKeyEnv(provider) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (normalized === "openai_compatible") return "OPENCODE_API_KEY";
  if (normalized === "deepseek") return "DEEPSEEK_API_KEY";
  return null;
}

function defaultSourceApiKeyEnv(provider) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  return {
    brave: "BRAVE_SEARCH_API_KEY",
    semantic_scholar: "SEMANTIC_SCHOLAR_API_KEY",
    mql5: "BRAVE_SEARCH_API_KEY",
    broker_docs: "BRAVE_SEARCH_API_KEY"
  }[normalized] ?? null;
}

function sourceProviderNames(sourceProvider) {
  return String(sourceProvider ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function sourceProviderKnown(provider) {
  return new Set(["brave", "semantic_scholar", "arxiv", "reddit", "github", "mql5", "broker_docs"]).has(provider);
}

function sourceApiKeyEnvChecks({ sourceProvider, sourceApiKeyEnv = null }) {
  const providers = sourceProviderNames(sourceProvider);
  return providers.map((provider) => {
    const env = providers.length === 1 && sourceApiKeyEnv ? sourceApiKeyEnv : defaultSourceApiKeyEnv(provider);
    return {
      provider,
      env,
      configured: env ? envVarConfigured(env) : true
    };
  });
}

function envVarConfigured(envName) {
  return typeof envName === "string" && envName.trim().length > 0 && typeof process.env[envName] === "string" && process.env[envName].length > 0;
}

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function buildResearchBrainStage0LiveProviderPolicy({
  providerMode = "valid",
  allowLiveLlm = false,
  llmPreset = null,
  llmProvider = null,
  llmModel = null,
  llmApiKeyEnv = null,
  llmBaseUrl = null,
  llmBaseUrlEnv = null,
  llmMaxTokens,
  maxLlmCalls,
  maxToolCalls,
  maxCostUsd,
  maxTranscriptBytes,
  toolMode = null,
  sourceProvider = null,
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  sourceApiKeyEnv = null,
  sourceToolMaxAttempts,
  sourceToolRetryDelayMs,
  timeoutMs,
  maxOutputBytes,
  cycles = 1,
  maxJobs = 1,
  maxEstimatedLiveCostUsd = null
} = {}) {
  const liveLlmRequested = providerMode === "live_llm_agent";
  const effectiveToolMode = toolMode ?? (allowLiveLlm ? "live" : "fixture");
  const effectiveLlmApiKeyEnv = llmApiKeyEnv ?? defaultLlmApiKeyEnv(llmProvider);
  const sourceProviders = sourceProviderNames(sourceProvider);
  const sourceEnvChecks = sourceApiKeyEnvChecks({ sourceProvider, sourceApiKeyEnv });
  const effectiveSourceApiKeyEnv = sourceEnvChecks.find((entry) => entry.env)?.env ?? null;
  const allSourceEnvConfigured = sourceEnvChecks.every((entry) => entry.configured === true);
  const hardBlockers = [];
  const warnings = [];

  if (liveLlmRequested && allowLiveLlm !== true) hardBlockers.push("live_llm_requires_allow_live_llm");
  if (liveLlmRequested && (typeof llmProvider !== "string" || llmProvider.trim().length === 0)) hardBlockers.push("live_llm_provider_missing");
  if (liveLlmRequested && (typeof llmModel !== "string" || llmModel.trim().length === 0)) hardBlockers.push("live_llm_model_missing");
  if (liveLlmRequested && !effectiveLlmApiKeyEnv) hardBlockers.push("live_llm_api_key_env_missing");
  if (liveLlmRequested && effectiveLlmApiKeyEnv && !envVarConfigured(effectiveLlmApiKeyEnv)) hardBlockers.push("live_llm_api_key_env_not_configured");

  if (liveLlmRequested && effectiveToolMode === "live") {
    if (sourceProviders.length === 0) hardBlockers.push("live_source_provider_missing");
    for (const provider of sourceProviders) {
      if (!sourceProviderKnown(provider)) hardBlockers.push(`live_source_provider_unknown:${provider}`);
    }
    if (allowLiveSourceSearch !== true) hardBlockers.push("live_source_search_opt_in_missing");
    if (allowLiveSourceCapture !== true) hardBlockers.push("live_source_capture_opt_in_missing");
    for (const entry of sourceEnvChecks) {
      if (entry.env && entry.configured !== true) {
        hardBlockers.push("live_source_api_key_env_not_configured");
        hardBlockers.push(`live_source_api_key_env_not_configured:${entry.provider}`);
      }
    }
  }

  const effectiveMaxLlmCalls = maxLlmCalls ?? 12;
  const effectiveLlmMaxTokens = llmMaxTokens ?? 2048;
  const effectiveMaxToolCalls = maxToolCalls ?? 50;
  const effectiveMaxCostUsd = maxCostUsd ?? 0.25;
  const effectiveTimeoutMs = timeoutMs ?? null;
  const plannedMaxJobs = cycles * maxJobs;
  if (liveLlmRequested && effectiveMaxLlmCalls < 8) warnings.push("max_llm_calls_below_live_canary_floor_8");
  if (liveLlmRequested && effectiveLlmMaxTokens < 4096) warnings.push("llm_max_tokens_below_live_canary_floor_4096");
  if (liveLlmRequested && effectiveMaxToolCalls < 30) warnings.push("max_tool_calls_below_live_canary_floor_30");
  if (liveLlmRequested && (effectiveTimeoutMs === null || effectiveTimeoutMs < 120_000)) warnings.push("timeout_ms_below_unattended_floor_120000");
  if (liveLlmRequested && (!Number.isFinite(effectiveMaxCostUsd) || effectiveMaxCostUsd <= 0)) warnings.push("max_cost_usd_missing_or_nonpositive");
  const estimatedMaxLiveCostUsd = liveLlmRequested ? Number((plannedMaxJobs * effectiveMaxCostUsd).toFixed(6)) : 0;
  if (liveLlmRequested && maxEstimatedLiveCostUsd !== null && maxEstimatedLiveCostUsd !== undefined && estimatedMaxLiveCostUsd > maxEstimatedLiveCostUsd) {
    hardBlockers.push("live_estimated_cost_exceeds_cap");
  }

  const budgetWarningsClear = warnings.length === 0;
  return {
    status: hardBlockers.length > 0 ? "blocked" : budgetWarningsClear ? "ready" : "warning",
    live_llm_requested: liveLlmRequested,
    safe_to_attempt_live_cycle: hardBlockers.length === 0,
    safe_for_unattended_queue_drain: liveLlmRequested ? hardBlockers.length === 0 && budgetWarningsClear : true,
    hard_blockers: hardBlockers,
    warnings,
    provider_settings: {
      provider_mode: providerMode,
      allow_live_llm: allowLiveLlm === true,
      llm_preset: llmPreset ?? null,
      llm_provider: llmProvider ?? null,
      llm_model: llmModel ?? null,
      llm_api_key_env: effectiveLlmApiKeyEnv,
      llm_api_key_env_configured: envVarConfigured(effectiveLlmApiKeyEnv),
      llm_base_url_configured: Boolean(llmBaseUrl || (llmBaseUrlEnv && envVarConfigured(llmBaseUrlEnv))),
      llm_base_url_env: llmBaseUrlEnv ?? null,
      llm_max_tokens: effectiveLlmMaxTokens,
      tool_mode: effectiveToolMode,
      source_provider: sourceProvider ?? null,
      source_providers: sourceProviders,
      allow_live_source_search: allowLiveSourceSearch === true,
      allow_live_source_capture: allowLiveSourceCapture === true,
      source_api_key_env: effectiveSourceApiKeyEnv,
      source_api_key_env_configured: allSourceEnvConfigured,
      source_api_key_envs: sourceEnvChecks
    },
    budgets: {
      cycles,
      max_jobs_per_cycle: maxJobs,
      planned_max_jobs: plannedMaxJobs,
      max_llm_calls_per_job: effectiveMaxLlmCalls,
      max_tool_calls_per_job: effectiveMaxToolCalls,
      max_cost_usd_per_job: effectiveMaxCostUsd,
      estimated_max_live_cost_usd: estimatedMaxLiveCostUsd,
      max_estimated_live_cost_usd: maxEstimatedLiveCostUsd ?? null,
      max_transcript_bytes: maxTranscriptBytes ?? 250_000,
      timeout_ms: finiteNumberOrNull(timeoutMs),
      max_output_bytes: finiteNumberOrNull(maxOutputBytes),
      source_tool_max_attempts: sourceToolMaxAttempts ?? 3,
      source_tool_retry_delay_ms: sourceToolRetryDelayMs ?? 2000
    },
    secrets_redacted: true,
    diagnostic_only: true
  };
}

function validateUnattendedGuardrailArgs({ cycles, maxJobs, maxTotalJobs, maxWallClockMs, maxTerminalFailures, maxEstimatedLiveCostUsd }) {
  if (maxTotalJobs !== null && maxTotalJobs !== undefined) requireBoundedInteger(maxTotalJobs, { field: "maxTotalJobs", min: 1, max: 625 });
  if (maxWallClockMs !== null && maxWallClockMs !== undefined) requireBoundedInteger(maxWallClockMs, { field: "maxWallClockMs", min: 1000, max: 86_400_000 });
  if (maxTerminalFailures !== null && maxTerminalFailures !== undefined) requireBoundedInteger(maxTerminalFailures, { field: "maxTerminalFailures", min: 0, max: 625 });
  if (maxEstimatedLiveCostUsd !== null && maxEstimatedLiveCostUsd !== undefined) requireBoundedNumber(maxEstimatedLiveCostUsd, { field: "maxEstimatedLiveCostUsd", min: 0, max: 10_000 });
  return {
    max_total_jobs: maxTotalJobs ?? cycles * maxJobs,
    max_total_jobs_explicit: maxTotalJobs !== null && maxTotalJobs !== undefined,
    max_wall_clock_ms: maxWallClockMs ?? null,
    max_wall_clock_ms_explicit: maxWallClockMs !== null && maxWallClockMs !== undefined,
    max_terminal_failures: maxTerminalFailures ?? null,
    max_terminal_failures_explicit: maxTerminalFailures !== null && maxTerminalFailures !== undefined,
    max_estimated_live_cost_usd: maxEstimatedLiveCostUsd ?? null
  };
}

function buildUnattendedGuardrailReport({ configured, liveProviderPolicy, aggregate = null, startedMs = null, endedMs = null, stopReason = null }) {
  const elapsedMs = Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : 0;
  const totals = aggregate?.totals ?? {};
  const hardBlockers = [];
  if (configured.max_total_jobs_explicit && (totals.jobs_processed ?? 0) >= configured.max_total_jobs) hardBlockers.push("max_total_jobs_reached");
  if (configured.max_wall_clock_ms !== null && elapsedMs >= configured.max_wall_clock_ms) hardBlockers.push("max_wall_clock_ms_reached");
  if (configured.max_terminal_failures !== null && (totals.terminal_jobs ?? 0) > configured.max_terminal_failures) hardBlockers.push("max_terminal_failures_exceeded");
  if (liveProviderPolicy?.hard_blockers?.includes("live_estimated_cost_exceeds_cap")) hardBlockers.push("max_estimated_live_cost_usd_exceeded");
  return {
    status: hardBlockers.length > 0 ? "stopped_or_blocked" : "within_limits",
    stop_reason: stopReason ?? null,
    hard_blockers: hardBlockers,
    configured,
    observed: {
      elapsed_ms: elapsedMs,
      jobs_processed: totals.jobs_processed ?? 0,
      terminal_jobs: totals.terminal_jobs ?? 0,
      auto_seeded_requests: totals.auto_seeded ?? 0,
      estimated_max_live_cost_usd: liveProviderPolicy?.budgets?.estimated_max_live_cost_usd ?? 0
    },
    diagnostic_only: true
  };
}

function liveUnattendedSafetyBlockers(policy, requireLiveUnattendedSafe = false) {
  if (policy?.live_llm_requested !== true) return [];
  if (requireLiveUnattendedSafe !== true || policy.safe_for_unattended_queue_drain === true) return [];
  return ["live_unattended_safety_warnings_present"];
}

function assertLiveQueueDrainPolicy(policy, { requireLiveUnattendedSafe = false } = {}) {
  if (policy?.live_llm_requested !== true) return;
  const blockers = [
    ...(policy.safe_to_attempt_live_cycle === true ? [] : (policy.hard_blockers ?? [])),
    ...liveUnattendedSafetyBlockers(policy, requireLiveUnattendedSafe)
  ];
  if (blockers.length === 0) return;
  throw new Error(`ResearchBrain Stage-0 supervisor live queue-drain preflight failed: ${blockers.join(", ")}`);
}

function buildAutoSeedPreflight({ readiness, enabled, limit }) {
  const blockers = enabled ? autoSeedBlockingReasons(readiness) : [];
  const eligibleEntries = enabled ? requestEntriesToAutoSeed(readiness, Number.MAX_SAFE_INTEGER) : [];
  const selectedEntries = enabled && blockers.length === 0 ? eligibleEntries.slice(0, limit) : [];
  return {
    schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_AUTO_SEED_SCHEMA_VERSION,
    enabled: enabled === true,
    status: enabled !== true ? "disabled" : blockers.length > 0 ? "blocked" : selectedEntries.length > 0 ? "would_seed" : "idle",
    limit,
    eligible_count: eligibleEntries.length,
    selected_count: selectedEntries.length,
    remaining_unseeded_valid_count: Math.max(0, eligibleEntries.length - selectedEntries.length),
    blockers,
    selected: selectedEntries.map((entry) => ({ path: entry.path, sha256: entry.sha256, request_id: entry.request_id ?? null })),
    diagnostic_only: true
  };
}

function buildQueueDrainPlan({
  generatedAt = nowIso(),
  explicitSeedRequested = false,
  requestPath = null,
  requestSha256 = null,
  cycles = 1,
  maxJobs = 1,
  outboxLimit = 25,
  guardrailConfig,
  readinessSummary,
  autoSeedPreview,
  liveProviderPolicy,
  unattendedGuardrails,
  blockers = [],
  requireLiveUnattendedSafe = false
}) {
  const attention = readinessSummary?.attention_classification ?? { status: "none", reasons: [], actionable_reasons: [], drainable_reasons: [] };
  const readinessActionable = (attention.actionable_reasons ?? []).map((reason) => `readiness:${reason}`);
  const liveSafetyBlockers = liveUnattendedSafetyBlockers(liveProviderPolicy, requireLiveUnattendedSafe).map((reason) => `live_provider:${reason}`);
  const allBlockers = [...new Set([...blockers, ...readinessActionable, ...liveSafetyBlockers])];
  const selected = autoSeedPreview?.selected ?? [];
  const selectedAutoSeedCount = selected.length;
  const explicitSeedCount = explicitSeedRequested ? 1 : 0;
  const claimableJobs = readinessSummary?.diagnostics?.jobs?.claimable_stale_or_ready ?? 0;
  const pendingOutboxEvents = readinessSummary?.diagnostics?.outbox?.pending ?? 0;
  const plannedJobCapacity = cycles * maxJobs;
  const guardrailJobCapacity = guardrailConfig?.max_total_jobs_explicit ? guardrailConfig.max_total_jobs : plannedJobCapacity;
  const effectiveJobCapacity = Math.min(plannedJobCapacity, guardrailJobCapacity);
  const seedableRequests = explicitSeedCount + selectedAutoSeedCount;
  const estimatedRunnableJobs = Math.min(effectiveJobCapacity, claimableJobs + seedableRequests);
  const estimatedOutboxEventsToProject = Math.min(cycles * outboxLimit, pendingOutboxEvents + estimatedRunnableJobs);

  let status = "idle";
  let nextAction = "none";
  if (allBlockers.length > 0) {
    status = "blocked";
    nextAction = "inspect_operational_blocker";
  } else if (estimatedRunnableJobs > 0 && seedableRequests > 0) {
    status = "ready_to_seed_and_drain";
    nextAction = "run_bounded_supervisor_cycle";
  } else if (estimatedRunnableJobs > 0) {
    status = "ready_to_drain";
    nextAction = "run_bounded_supervisor_cycle";
  } else if (pendingOutboxEvents > 0) {
    status = "ready_to_project_outbox";
    nextAction = "run_bounded_supervisor_cycle";
  }

  return {
    schema_version: RESEARCHBRAIN_STAGE0_QUEUE_DRAIN_PLAN_SCHEMA_VERSION,
    generated_at: generatedAt,
    status,
    next_action: nextAction,
    blockers: allBlockers,
    readiness_attention_status: attention.status ?? "none",
    readiness_attention_reasons: attention.reasons ?? [],
    explicit_seed: explicitSeedRequested ? { path: requestPath, sha256: requestSha256 } : null,
    auto_seed_selection: {
      enabled: autoSeedPreview?.enabled === true,
      status: autoSeedPreview?.status ?? "disabled",
      selected_count: selectedAutoSeedCount,
      eligible_count: autoSeedPreview?.eligible_count ?? 0,
      remaining_unseeded_valid_count: autoSeedPreview?.remaining_unseeded_valid_count ?? 0,
      selected_requests: selected.map((entry) => ({ path: entry.path, sha256: entry.sha256, request_id: entry.request_id ?? null }))
    },
    current_ledger: {
      claimable_stage0_jobs: claimableJobs,
      queued: readinessSummary?.diagnostics?.jobs?.queued ?? 0,
      ready: readinessSummary?.diagnostics?.jobs?.ready ?? 0,
      stale_claimed: readinessSummary?.diagnostics?.jobs?.stale_claimed ?? 0,
      pending_outbox_events: pendingOutboxEvents,
      unseeded_valid_requests: readinessSummary?.requests?.unseeded_valid ?? 0,
      invalid_requests: readinessSummary?.requests?.invalid ?? 0,
      unreconciled_terminal_failures: readinessSummary?.terminal_failures_unreconciled ?? 0,
      runtime_consistency_status: readinessSummary?.runtime_consistency?.status ?? null
    },
    planned_capacity: {
      cycles,
      max_jobs_per_cycle: maxJobs,
      outbox_limit_per_cycle: outboxLimit,
      planned_job_capacity: plannedJobCapacity,
      effective_job_capacity: effectiveJobCapacity,
      estimated_runnable_jobs: estimatedRunnableJobs,
      estimated_outbox_events_to_project: estimatedOutboxEventsToProject,
      estimated_max_live_cost_usd: liveProviderPolicy?.budgets?.estimated_max_live_cost_usd ?? 0,
      max_estimated_live_cost_usd: liveProviderPolicy?.budgets?.max_estimated_live_cost_usd ?? null
    },
    live_canary_discipline: {
      require_live_unattended_safe: requireLiveUnattendedSafe === true,
      live_llm_requested: liveProviderPolicy?.live_llm_requested === true,
      safe_to_attempt_live_cycle: liveProviderPolicy?.safe_to_attempt_live_cycle === true,
      safe_for_unattended_queue_drain: liveProviderPolicy?.safe_for_unattended_queue_drain === true,
      warnings: liveProviderPolicy?.warnings ?? [],
      hard_blockers: liveProviderPolicy?.hard_blockers ?? [],
      status: liveProviderPolicy?.live_llm_requested !== true
        ? "not_live"
        : liveProviderPolicy.safe_for_unattended_queue_drain === true
          ? "guardrail_safe"
          : requireLiveUnattendedSafe === true
            ? "blocked_by_policy_warnings"
            : "warning_only"
    },
    guardrails: {
      status: unattendedGuardrails?.status ?? "within_limits",
      stop_reason: unattendedGuardrails?.stop_reason ?? null,
      hard_blockers: unattendedGuardrails?.hard_blockers ?? [],
      configured: unattendedGuardrails?.configured ?? guardrailConfig ?? {}
    },
    would_execute_jobs: false,
    diagnostic_only: true
  };
}

function compactCommand(argv) {
  return argv.map((part) => String(part).includes(" ") ? JSON.stringify(String(part)) : String(part)).join(" ");
}

function buildOperatorSafeQueueDrainCommandProfile({
  cycles = 1,
  maxJobs = 1,
  autoSeedLimit = 1,
  outboxLimit = 25,
  maxTotalJobs = null,
  maxWallClockMs = null,
  maxTerminalFailures = null,
  maxEstimatedLiveCostUsd = null,
  timeoutMs = null,
  maxLlmCalls = null,
  llmPreset = null,
  llmProvider = null,
  llmModel = null,
  llmMaxTokens = null,
  maxCostUsd = null,
  maxToolCalls = null,
  maxTranscriptBytes = null,
  toolMode = null,
  sourceProvider = null,
  sourceToolMaxAttempts = null,
  sourceToolRetryDelayMs = null,
  readinessRequestLimit = 100,
  processedOutboxLimit = 100,
  runtimeConsistencyLimit = 100,
  runReportDir = "factory/verification/researchbrain-stage0-supervisor-runs",
  liveProviderPolicy,
  queueDrainPlan
} = {}) {
  const providerSettings = liveProviderPolicy?.provider_settings ?? {};
  const preflightArgv = [
    "rtk", "npm", "run", "researchbrain:stage0-supervisor", "--",
    "--preflight-only",
    "--seed-unseeded-valid",
    "--require-live-unattended-safe",
    "--cycles", String(cycles),
    "--max-jobs", String(maxJobs),
    "--auto-seed-limit", String(autoSeedLimit),
    "--max-total-jobs", String(maxTotalJobs ?? Math.max(1, cycles * maxJobs)),
    "--max-terminal-failures", String(maxTerminalFailures ?? 0),
    "--outbox-limit", String(outboxLimit),
    "--readiness-request-limit", String(readinessRequestLimit),
    "--processed-outbox-limit", String(processedOutboxLimit),
    "--runtime-consistency-limit", String(runtimeConsistencyLimit),
    "--provider-mode", "live_llm_agent",
    "--allow-live-llm"
  ];
  if (maxWallClockMs !== null && maxWallClockMs !== undefined) preflightArgv.push("--max-wall-clock-ms", String(maxWallClockMs));
  if (maxEstimatedLiveCostUsd !== null && maxEstimatedLiveCostUsd !== undefined) preflightArgv.push("--max-estimated-live-cost-usd", String(maxEstimatedLiveCostUsd));
  if (llmPreset) preflightArgv.push("--llm-preset", String(llmPreset));
  else {
    if (llmProvider) preflightArgv.push("--llm-provider", String(llmProvider));
    if (llmModel) preflightArgv.push("--llm-model", String(llmModel));
  }
  if (llmMaxTokens !== null && llmMaxTokens !== undefined) preflightArgv.push("--llm-max-tokens", String(llmMaxTokens));
  if (maxLlmCalls !== null && maxLlmCalls !== undefined) preflightArgv.push("--max-llm-calls", String(maxLlmCalls));
  if (maxCostUsd !== null && maxCostUsd !== undefined) preflightArgv.push("--max-cost-usd", String(maxCostUsd));
  if (maxToolCalls !== null && maxToolCalls !== undefined) preflightArgv.push("--max-tool-calls", String(maxToolCalls));
  if (maxTranscriptBytes !== null && maxTranscriptBytes !== undefined) preflightArgv.push("--max-transcript-bytes", String(maxTranscriptBytes));
  if (timeoutMs !== null && timeoutMs !== undefined) preflightArgv.push("--timeout-ms", String(timeoutMs));
  if (toolMode) preflightArgv.push("--tool-mode", String(toolMode));
  if (sourceProvider) preflightArgv.push("--source-provider", String(sourceProvider));
  preflightArgv.push("--allow-live-source-search", "--allow-live-source-capture");
  if (sourceToolMaxAttempts !== null && sourceToolMaxAttempts !== undefined) preflightArgv.push("--source-tool-max-attempts", String(sourceToolMaxAttempts));
  if (sourceToolRetryDelayMs !== null && sourceToolRetryDelayMs !== undefined) preflightArgv.push("--source-tool-retry-delay-ms", String(sourceToolRetryDelayMs));

  const liveRunArgv = preflightArgv
    .filter((part) => part !== "--preflight-only")
    .concat(["--run-report-dir", runReportDir]);

  const selectedRequests = queueDrainPlan?.auto_seed_selection?.selected_requests ?? [];
  return {
    schema_version: RESEARCHBRAIN_STAGE0_OPERATOR_COMMAND_PROFILE_SCHEMA_VERSION,
    status: queueDrainPlan?.status === "blocked" ? "blocked" : selectedRequests.length > 0 || (queueDrainPlan?.planned_capacity?.estimated_runnable_jobs ?? 0) > 0 ? "ready_for_operator_preflight" : "idle",
    operator_sequence: [
      "run_preflight_only",
      "inspect_selected_requests_cost_env_and_blockers",
      "run_live_queue_drain_only_if_preflight_status_ready_and_queue_drain_plan_ready"
    ],
    do_not_run_live_if: [
      "preflight.status_is_blocked",
      "queue_drain_plan.blockers_not_empty",
      "live_provider_policy.hard_blockers_not_empty",
      "live_provider_policy.warnings_not_empty_when_require_live_unattended_safe",
      "env_presence_booleans_are_false",
      "selected_requests_are_not_expected"
    ],
    selected_requests: selectedRequests,
    estimated_cost: {
      estimated_max_live_cost_usd: liveProviderPolicy?.budgets?.estimated_max_live_cost_usd ?? 0,
      max_estimated_live_cost_usd: liveProviderPolicy?.budgets?.max_estimated_live_cost_usd ?? null,
      max_cost_usd_per_job: liveProviderPolicy?.budgets?.max_cost_usd_per_job ?? null
    },
    env_presence: {
      llm_api_key_env: providerSettings.llm_api_key_env ?? null,
      llm_api_key_env_configured: providerSettings.llm_api_key_env_configured === true,
      llm_base_url_env: providerSettings.llm_base_url_env ?? null,
      llm_base_url_configured: providerSettings.llm_base_url_configured === true,
      source_api_key_env: providerSettings.source_api_key_env ?? null,
      source_api_key_env_configured: providerSettings.source_api_key_env_configured === true,
      source_api_key_envs: providerSettings.source_api_key_envs ?? []
    },
    known_good_live_settings: {
      provider_mode: "live_llm_agent",
      allow_live_llm: true,
      llm_preset: llmPreset ?? null,
      llm_provider: llmProvider ?? providerSettings.llm_provider ?? null,
      llm_model: llmModel ?? providerSettings.llm_model ?? null,
      llm_max_tokens: llmMaxTokens ?? providerSettings.llm_max_tokens ?? null,
      max_llm_calls: maxLlmCalls ?? liveProviderPolicy?.budgets?.max_llm_calls_per_job ?? null,
      max_tool_calls: maxToolCalls ?? liveProviderPolicy?.budgets?.max_tool_calls_per_job ?? null,
      timeout_ms: timeoutMs ?? liveProviderPolicy?.budgets?.timeout_ms ?? null,
      tool_mode: toolMode ?? providerSettings.tool_mode ?? null,
      source_provider: sourceProvider ?? providerSettings.source_provider ?? null,
      allow_live_source_search: true,
      allow_live_source_capture: true,
      require_live_unattended_safe: true
    },
    preflight_command: {
      argv: preflightArgv,
      shell: compactCommand(preflightArgv),
      secrets_included: false,
      executes_jobs: false,
      mutates_runtime_queue: false
    },
    bounded_live_command: {
      argv: liveRunArgv,
      shell: compactCommand(liveRunArgv),
      secrets_included: false,
      executes_jobs: true,
      mutates_runtime_queue: true,
      run_report_dir: runReportDir
    },
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false,
    wfa_executed: false,
    mt5_executed: false,
    phase8e_started: false,
    secrets_redacted: true,
    diagnostic_only: true
  };
}

class ResearchBrainStage0SupervisorStageError extends Error {
  constructor({ stage, cause, partial }) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message);
    this.name = "ResearchBrainStage0SupervisorStageError";
    this.stage = stage;
    this.partial = partial;
    this.cause = cause;
  }
}

async function runSupervisorStage(stage, partial, fn) {
  try {
    return await fn();
  } catch (error) {
    throw new ResearchBrainStage0SupervisorStageError({ stage, cause: error, partial: { ...partial } });
  }
}

function supervisorStatus({ seed, loop, outbox, diagnostics, readinessSummary }) {
  if (readinessSummary?.status === "attention") return "attention";
  const actionableDiagnostics = (diagnostics?.attention_reasons ?? []).filter((reason) => !NON_ACTIONABLE_TERMINAL_DIAGNOSTICS.has(reason));
  if (actionableDiagnostics.length > 0) return "attention";
  if (loop?.jobs_processed > 0 || outbox?.events_processed > 0 || seed) return "completed";
  return "idle";
}

function classifyAttentionReasons(reasons = [], actionableDiagnosticsReasons = []) {
  const unique = [...new Set(reasons)];
  const diagnosticsAreActionable = actionableDiagnosticsReasons.some((reason) => !MULTI_CYCLE_DRAINABLE_ATTENTION.has(reason));
  const drainable = unique.filter((reason) => MULTI_CYCLE_DRAINABLE_ATTENTION.has(reason) && !(reason === "diagnostics_attention" && diagnosticsAreActionable));
  const actionable = unique.filter((reason) => !MULTI_CYCLE_DRAINABLE_ATTENTION.has(reason) || (reason === "diagnostics_attention" && diagnosticsAreActionable));
  const status = unique.length === 0 ? "none" : actionable.length > 0 ? "actionable" : "drainable";
  return {
    status,
    next_action: status === "none" ? "none" : status === "drainable" ? "continue_bounded_cycles" : "inspect_operational_blocker",
    reasons: unique,
    drainable_reasons: drainable,
    actionable_reasons: actionable,
    actionable_diagnostics_reasons: actionableDiagnosticsReasons
  };
}

function readinessSummary(readiness) {
  if (!readiness) return null;
  return {
    schema_version: readiness.schema_version,
    generated_at: readiness.generated_at,
    status: readiness.status,
    attention_reasons: readiness.attention_reasons,
    attention_classification: classifyAttentionReasons(readiness.attention_reasons ?? [], readiness.actionable_diagnostics_reasons ?? []),
    actionable_diagnostics_reasons: readiness.actionable_diagnostics_reasons,
    diagnostics: {
      jobs: {
        total: readiness.diagnostics?.jobs?.total ?? 0,
        queued: readiness.diagnostics?.jobs?.queued ?? 0,
        ready: readiness.diagnostics?.jobs?.ready ?? 0,
        claimed: readiness.diagnostics?.jobs?.claimed ?? 0,
        stale_claimed: readiness.diagnostics?.jobs?.stale_claimed ?? 0,
        claimable_stale_or_ready: readiness.diagnostics?.jobs?.claimable_stale_or_ready ?? 0,
        blocked: readiness.diagnostics?.jobs?.blocked ?? 0,
        poisoned: readiness.diagnostics?.jobs?.poisoned ?? 0,
        stage0_ready: readiness.diagnostics?.jobs?.stage0_ready ?? 0
      },
      outbox: {
        total: readiness.diagnostics?.outbox?.by_status?.total ?? 0,
        pending: readiness.diagnostics?.outbox?.by_status?.pending ?? 0,
        processed: readiness.diagnostics?.outbox?.by_status?.processed ?? 0,
        other: readiness.diagnostics?.outbox?.by_status?.other ?? 0
      },
      projections: {
        total_files: readiness.diagnostics?.projections?.total_files ?? 0,
        latest_checked: readiness.diagnostics?.projections?.latest?.length ?? 0,
        latest_parse_errors: readiness.projection_health?.latest_parse_errors ?? 0
      }
    },
    terminal_failure_reconciliation_status: readiness.terminal_failure_reconciliation?.status ?? null,
    terminal_failures_total: readiness.terminal_failure_reconciliation?.total_terminal_failures ?? 0,
    terminal_failures_unreconciled: readiness.terminal_failure_reconciliation?.unreconciled_terminal_failures ?? 0,
    projection_recovery: {
      checked_processed_without_matching_projection_files: readiness.projection_health?.processed_outbox?.recovery?.checked_processed_without_matching_projection_files ?? 0,
      orphan_projection_files: readiness.projection_health?.processed_outbox?.recovery?.orphan_projection_files ?? 0,
      unidentified_projection_files: readiness.projection_health?.processed_outbox?.recovery?.unidentified_projection_files ?? 0
    },
    runtime_consistency: {
      status: readiness.runtime_consistency?.status ?? null,
      checked_final_jobs: readiness.runtime_consistency?.checked_final_jobs ?? 0,
      inconsistent_final_jobs: readiness.runtime_consistency?.inconsistent_final_jobs ?? 0,
      truncated: readiness.runtime_consistency?.truncated ?? false,
      issue_counts_by_reason: readiness.runtime_consistency?.issue_counts_by_reason ?? {}
    },
    requests: {
      seeded: readiness.requests?.seeded ?? 0,
      invalid: readiness.requests?.invalid ?? 0,
      unseeded_valid: readiness.requests?.unseeded_valid ?? 0,
      changed_seeded_sha: readiness.requests?.changed_seeded_sha ?? 0,
      seeded_output_collisions: readiness.requests?.seeded_output_collisions ?? 0
    },
    authority: readiness.authority
  };
}

function finalOperationalSnapshot(readiness) {
  if (!readiness) return null;
  return {
    status: readiness.status,
    attention_reasons: readiness.attention_reasons ?? [],
    attention_classification: readiness.attention_classification ?? classifyAttentionReasons(readiness.attention_reasons ?? [], readiness.actionable_diagnostics_reasons ?? []),
    actionable_diagnostics_reasons: readiness.actionable_diagnostics_reasons ?? [],
    jobs: readiness.diagnostics?.jobs ?? {},
    outbox: readiness.diagnostics?.outbox ?? {},
    requests: readiness.requests ?? {},
    terminal_failures: {
      status: readiness.terminal_failure_reconciliation_status ?? null,
      total: readiness.terminal_failures_total ?? 0,
      unreconciled: readiness.terminal_failures_unreconciled ?? 0
    },
    projection_recovery: readiness.projection_recovery ?? {},
    runtime_consistency: readiness.runtime_consistency ?? {}
  };
}

function buildSupervisorRecommendation({ status, failure = null, readinessSummary = null, aggregate = null, stopReason = null }) {
  if (failure) {
    return {
      status: "action_required",
      next_action: "inspect_operational_blocker",
      reason: `supervisor_${failure.failed_stage ?? "unknown"}_failure`,
      summary: "Supervisor failed before completing the bounded Stage-0 operations cycle.",
      failed_stage: failure.failed_stage ?? null,
      diagnostic_only: true
    };
  }
  const classification = readinessSummary?.attention_classification
    ?? aggregate?.final_operational_snapshot?.attention_classification
    ?? null;
  if (status === "attention" && classification?.status === "drainable") {
    return {
      status: "continue",
      next_action: "continue_bounded_cycles",
      reason: "drainable_stage0_work_remaining",
      summary: "Bounded supervisor cycle ended with drainable Stage-0 work still queued or pending projection.",
      attention_reasons: classification.reasons ?? [],
      diagnostic_only: true
    };
  }
  if (status === "attention") {
    return {
      status: "action_required",
      next_action: "inspect_operational_blocker",
      reason: "actionable_stage0_attention",
      summary: "Supervisor detected Stage-0 operational attention that should be inspected before continuing unattended cycles.",
      attention_reasons: classification?.reasons ?? readinessSummary?.attention_reasons ?? [],
      diagnostic_only: true
    };
  }
  if (status === "idle") {
    return {
      status: "no_work",
      next_action: "none",
      reason: stopReason === "idle" ? "no_claimable_stage0_work" : "idle",
      summary: "No claimable Stage-0 work remained in this bounded supervisor run.",
      diagnostic_only: true
    };
  }
  return {
    status: "ok",
    next_action: "none",
    reason: "stage0_supervisor_ready",
    summary: "Stage-0 supervisor run completed without actionable or drainable attention.",
    diagnostic_only: true
  };
}

function buildCycleOperationalSummary({ status, recommendation, cycleSummary, readinessSummary }) {
  const classification = readinessSummary?.attention_classification ?? null;
  return {
    status,
    next_action: recommendation?.next_action ?? "none",
    recommendation_status: recommendation?.status ?? null,
    progress_made: (cycleSummary?.auto_seeded_count ?? 0) > 0 || (cycleSummary?.jobs_processed ?? 0) > 0 || (cycleSummary?.outbox_events_processed ?? 0) > 0,
    auto_seeded_requests: cycleSummary?.auto_seeded_count ?? 0,
    auto_seed_failures: cycleSummary?.auto_seed_failure_count ?? 0,
    jobs_processed: cycleSummary?.jobs_processed ?? 0,
    stage0_ready_jobs: cycleSummary?.ready_jobs ?? 0,
    terminal_jobs: cycleSummary?.terminal_jobs ?? 0,
    outbox_events_processed: cycleSummary?.outbox_events_processed ?? 0,
    projected_terminal_events: cycleSummary?.projected_terminal_events ?? 0,
    remaining_claimable_jobs: readinessSummary?.diagnostics?.jobs?.claimable_stale_or_ready ?? 0,
    pending_outbox_events: readinessSummary?.diagnostics?.outbox?.pending ?? 0,
    readiness_status: readinessSummary?.status ?? null,
    attention_status: classification?.status ?? "none",
    attention_reasons: classification?.reasons ?? [],
    terminal_failures_unreconciled: readinessSummary?.terminal_failures_unreconciled ?? 0,
    runtime_consistency_status: readinessSummary?.runtime_consistency?.status ?? null,
    diagnostic_only: true
  };
}

function reportArtifactConsistencySummary(artifact) {
  if (!artifact) return null;
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    verified: artifact.consistency?.verified === true,
    report_type: artifact.consistency?.report_type ?? null,
    schema_version: artifact.consistency?.schema_version ?? null,
    authority_flags_false: artifact.consistency?.authority_flags_false === true,
    diagnostic_only: artifact.consistency?.diagnostic_only === true
  };
}

function buildReportArtifactSummary({ failure, failureReportDir, runReportDir, failureArtifact = null, runArtifact = null }) {
  const requested = {
    run_report: Boolean(runReportDir),
    failure_report: Boolean(failure && failureReportDir)
  };
  const artifacts = [failureArtifact, runArtifact].filter(Boolean);
  const written = {
    run_report: Boolean(runArtifact),
    failure_report: Boolean(failureArtifact)
  };
  return {
    requested,
    written,
    all_requested_reports_written: (!requested.run_report || written.run_report) && (!requested.failure_report || written.failure_report),
    all_written_reports_verified: artifacts.every((artifact) => artifact.consistency?.verified === true),
    artifacts: {
      run_report: reportArtifactConsistencySummary(runArtifact),
      failure_report: reportArtifactConsistencySummary(failureArtifact)
    },
    diagnostic_only: true
  };
}

function buildRunOperationalSummary({ status, stopReason, recommendation, aggregate, failure, reportArtifactSummary }) {
  const finalSnapshot = aggregate?.final_operational_snapshot ?? null;
  return {
    status,
    stop_reason: stopReason,
    next_action: recommendation?.next_action ?? "none",
    recommendation_status: recommendation?.status ?? null,
    cycles_run: aggregate?.cycles_run ?? 0,
    cycles_with_progress: aggregate?.totals?.cycles_with_progress ?? 0,
    jobs_processed: aggregate?.totals?.jobs_processed ?? 0,
    auto_seeded_requests: aggregate?.totals?.auto_seeded ?? 0,
    auto_seed_failures: aggregate?.totals?.auto_seed_failures ?? 0,
    stage0_ready_jobs: aggregate?.totals?.stage0_ready_jobs ?? 0,
    terminal_jobs: aggregate?.totals?.terminal_jobs ?? 0,
    outbox_events_processed: aggregate?.totals?.outbox_events_processed ?? 0,
    projected_terminal_events: aggregate?.totals?.projected_terminal_events ?? 0,
    remaining_claimable_jobs: finalSnapshot?.jobs?.claimable_stale_or_ready ?? 0,
    pending_outbox_events: finalSnapshot?.outbox?.pending ?? 0,
    final_readiness_status: finalSnapshot?.status ?? null,
    attention_status: finalSnapshot?.attention_classification?.status ?? "none",
    attention_reasons: finalSnapshot?.attention_classification?.reasons ?? [],
    failed_stage: failure?.failed_stage ?? null,
    guardrail_stop_reason: ["max_total_jobs", "max_wall_clock_ms", "max_terminal_failures"].includes(stopReason) ? stopReason : null,
    report_artifacts_all_verified: reportArtifactSummary?.all_written_reports_verified ?? true,
    diagnostic_only: true
  };
}

function buildSupervisorHealth({ status, recommendation, failure = null, operationalSummary = null }) {
  if (failure || status === "failed") {
    return {
      status: "failed",
      alert_level: "critical",
      reason: recommendation?.reason ?? "supervisor_failure",
      safe_to_run_another_bounded_cycle: false,
      operator_inspection_required: true,
      failed_stage: failure?.failed_stage ?? operationalSummary?.failed_stage ?? null,
      diagnostic_only: true
    };
  }
  if (recommendation?.status === "action_required") {
    return {
      status: "blocked",
      alert_level: "warning",
      reason: recommendation.reason ?? "action_required",
      safe_to_run_another_bounded_cycle: false,
      operator_inspection_required: true,
      failed_stage: null,
      diagnostic_only: true
    };
  }
  if (recommendation?.next_action === "continue_bounded_cycles") {
    return {
      status: "drainable",
      alert_level: "info",
      reason: recommendation.reason ?? "drainable_stage0_work_remaining",
      safe_to_run_another_bounded_cycle: true,
      operator_inspection_required: false,
      failed_stage: null,
      diagnostic_only: true
    };
  }
  return {
    status: status === "idle" ? "idle" : "healthy",
    alert_level: "none",
    reason: recommendation?.reason ?? "stage0_supervisor_ready",
    safe_to_run_another_bounded_cycle: true,
    operator_inspection_required: false,
    failed_stage: null,
    diagnostic_only: true
  };
}

function supervisorCycleSummary({ seed, autoSeed, loop, outbox, diagnostics }) {
  const jobs = Array.isArray(loop?.jobs) ? loop.jobs : [];
  const terminalJobs = jobs.filter((job) => TERMINAL_JOB_STATUSES.has(job.status));
  const autoSeeded = Array.isArray(autoSeed?.seeded) ? autoSeed.seeded : [];
  return {
    seed_status: seed?.status ?? null,
    auto_seed_status: autoSeed?.status ?? null,
    auto_seeded_count: autoSeed?.seeded_count ?? 0,
    auto_seed_failure_count: autoSeed?.failure_count ?? 0,
    auto_seeded_request_artifacts: autoSeeded.map((entry) => ({
      status: entry.status,
      job_id: entry.job_id ?? null,
      run_id: entry.run_id ?? null,
      job_status: entry.job_status ?? null,
      request_artifact: entry.request_artifact ?? null,
      output_dir: entry.output_dir ?? null
    })),
    auto_seed_failure_request_artifacts: (autoSeed?.failures ?? []).map((entry) => ({
      request_artifact: entry.request_artifact ?? null,
      error_class: entry.error_class ?? null,
      error_message: entry.error_message ?? null
    })),
    loop_status: loop?.status ?? null,
    jobs_processed: loop?.jobs_processed ?? 0,
    ready_jobs: jobs.filter((job) => job.status === "stage0_ready").length,
    terminal_jobs: terminalJobs.length,
    terminal_job_summaries: terminalJobs.map((job) => ({
      job_id: job.job_id,
      run_id: job.run_id,
      status: job.status,
      failure_class: job.failure_summary?.failure_class ?? job.failure_class ?? null,
      retryable: job.failure_summary?.retryable ?? job.retryable ?? null,
      error_message: job.failure_summary?.error_message ?? null,
      request_artifact: job.failure_summary?.request_artifact ?? null
    })),
    outbox_status: outbox?.status ?? null,
    outbox_events_processed: outbox?.events_processed ?? 0,
    projected_terminal_events: (outbox?.processed ?? []).filter((event) => TERMINAL_JOB_STATUSES.has(event.projected_status)).length,
    diagnostics_attention_reasons: diagnostics?.attention_reasons ?? [],
    actionable_diagnostics_reasons: (diagnostics?.attention_reasons ?? []).filter((reason) => !NON_ACTIONABLE_TERMINAL_DIAGNOSTICS.has(reason))
  };
}

function partialCycleSummary(partial = {}) {
  return supervisorCycleSummary({
    seed: partial.seed ?? null,
    autoSeed: partial.autoSeed ?? null,
    loop: partial.loop ?? null,
    outbox: partial.outbox ?? null,
    diagnostics: partial.diagnostics ?? null
  });
}

function cycleMadeOperationalProgress(cycle) {
  return cycle?.seed?.status === "seeded"
    || (cycle?.auto_seed?.seeded_count ?? 0) > 0
    || (cycle?.loop?.jobs_processed ?? 0) > 0
    || (cycle?.outbox?.events_processed ?? 0) > 0;
}

function aggregateCycleSummaries(cycles) {
  const statusCounts = {};
  const stopReasons = {};
  const readinessReasons = {};
  const diagnosticsReasons = {};
  const attentionClassCounts = { none: 0, drainable: 0, actionable: 0 };
  let lastReadinessSummary = null;
  for (const cycle of cycles) {
    statusCounts[cycle.status] = (statusCounts[cycle.status] ?? 0) + 1;
    const attentionClass = cycle.readiness_summary?.attention_classification?.status ?? "none";
    attentionClassCounts[attentionClass] = (attentionClassCounts[attentionClass] ?? 0) + 1;
    const loopStop = cycle.loop?.stop_reason ?? null;
    if (loopStop) stopReasons[loopStop] = (stopReasons[loopStop] ?? 0) + 1;
    for (const reason of cycle.readiness_summary?.attention_reasons ?? []) {
      readinessReasons[reason] = (readinessReasons[reason] ?? 0) + 1;
    }
    for (const reason of cycle.cycle_summary?.actionable_diagnostics_reasons ?? []) {
      diagnosticsReasons[reason] = (diagnosticsReasons[reason] ?? 0) + 1;
    }
    lastReadinessSummary = cycle.readiness_summary ?? lastReadinessSummary;
  }
  const totals = cycles.reduce((acc, cycle) => {
    acc.seeded += cycle.seed?.status === "seeded" ? 1 : 0;
    acc.already_seeded += cycle.seed?.status === "already_seeded" ? 1 : 0;
    acc.auto_seeded += cycle.auto_seed?.seeded_count ?? 0;
    acc.auto_seed_failures += cycle.auto_seed?.failure_count ?? 0;
    acc.jobs_processed += cycle.loop?.jobs_processed ?? 0;
    acc.lease_reclaims += cycle.loop?.lease_reclaims ?? 0;
    acc.stage0_ready_jobs += cycle.cycle_summary?.ready_jobs ?? 0;
    acc.terminal_jobs += cycle.cycle_summary?.terminal_jobs ?? 0;
    acc.outbox_events_processed += cycle.outbox?.events_processed ?? 0;
    acc.projected_terminal_events += cycle.cycle_summary?.projected_terminal_events ?? 0;
    acc.cycles_with_progress += cycleMadeOperationalProgress(cycle) ? 1 : 0;
    return acc;
  }, {
    seeded: 0,
    already_seeded: 0,
    auto_seeded: 0,
    auto_seed_failures: 0,
    jobs_processed: 0,
    lease_reclaims: 0,
    stage0_ready_jobs: 0,
    terminal_jobs: 0,
    outbox_events_processed: 0,
    projected_terminal_events: 0,
    cycles_with_progress: 0
  });
  const autoSeededRequestArtifacts = cycles.flatMap((cycle) => cycle.cycle_summary?.auto_seeded_request_artifacts ?? []);
  return {
    cycles_run: cycles.length,
    status_counts: statusCounts,
    attention_class_counts: attentionClassCounts,
    loop_stop_reasons: stopReasons,
    readiness_attention_reasons: readinessReasons,
    actionable_diagnostics_reasons: diagnosticsReasons,
    totals,
    auto_seeded_request_artifacts: autoSeededRequestArtifacts,
    final_operational_snapshot: finalOperationalSnapshot(lastReadinessSummary),
    final_readiness_summary: lastReadinessSummary
  };
}

function buildFailureEnvelope({ error, cycleNumber, cyclesCompletedBeforeFailure }) {
  const isStageError = error instanceof ResearchBrainStage0SupervisorStageError;
  return {
    cycle_number: cycleNumber,
    failed_stage: isStageError ? error.stage : "preflight_or_unknown",
    error_class: error?.name ?? "Error",
    error_message: error instanceof Error ? error.message : String(error),
    cycles_completed_before_failure: cyclesCompletedBeforeFailure,
    partial_cycle_summary: isStageError ? partialCycleSummary(error.partial) : null,
    retry_guidance: "Inspect the failed_stage and partial_cycle_summary; retry only after fixing the Stage-0 operational blocker. Do not treat this as research evidence."
  };
}

function verifySupervisorReportArtifact({ rootDir, artifactPath, expectedSha256, expectedSchemaVersion, expectedReportType }) {
  const root = path.resolve(rootDir);
  if (path.isAbsolute(artifactPath) || artifactPath.split("/").includes("..")) {
    throw new Error(`ResearchBrain Stage-0 supervisor report artifact path is not safe repo-relative: ${artifactPath}`);
  }
  const fullPath = resolveRepoRelativePath(root, artifactPath, "report_artifact");
  if (!fs.existsSync(fullPath)) {
    throw new Error(`ResearchBrain Stage-0 supervisor report artifact does not exist: ${artifactPath}`);
  }
  const observedSha256 = sha256File(fullPath);
  if (observedSha256 !== expectedSha256) {
    throw new Error(`ResearchBrain Stage-0 supervisor report artifact SHA mismatch: ${artifactPath}`);
  }
  const payload = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  if (payload?.schema_version !== expectedSchemaVersion) {
    throw new Error(`ResearchBrain Stage-0 supervisor report artifact schema mismatch: ${artifactPath}`);
  }
  if (payload?.report_metadata?.report_type !== expectedReportType) {
    throw new Error(`ResearchBrain Stage-0 supervisor report artifact type mismatch: ${artifactPath}`);
  }
  if (payload?.report_metadata?.artifact_path !== artifactPath || payload?.report_metadata?.path_scope !== "repo_relative") {
    throw new Error(`ResearchBrain Stage-0 supervisor report artifact metadata path mismatch: ${artifactPath}`);
  }
  const authority = payload?.authority ?? {};
  const falseAuthorityFlags = [
    "official_state_mutated",
    "official_evidence_index_mutated",
    "official_backlog_mutated",
    "official_leaderboard_mutated",
    "profitability_labels_created",
    "deterministic_workers_bypassed",
    "wfa_executed",
    "mt5_executed",
    "phase8e_started"
  ];
  const authorityFlagsFalse = falseAuthorityFlags.every((field) => authority[field] === false)
    && authority.non_authoritative_operational_report === true;
  if (!authorityFlagsFalse || payload?.report_metadata?.diagnostic_only !== true) {
    throw new Error(`ResearchBrain Stage-0 supervisor report artifact authority mismatch: ${artifactPath}`);
  }
  return {
    verified: true,
    checked_at: nowIso(),
    artifact_path: artifactPath,
    path_scope: "repo_relative",
    path_exists: true,
    schema_version: payload.schema_version,
    report_type: payload.report_metadata.report_type,
    sha256: observedSha256,
    sha256_matches_expected: true,
    metadata_path_matches: true,
    authority_flags_false: true,
    diagnostic_only: true
  };
}

export function writeResearchBrainStage0SupervisorFailureReport({ rootDir = process.cwd(), outputDir = "factory/verification", result }) {
  const root = path.resolve(rootDir);
  const fullDir = resolveRepoRelativePath(root, outputDir, "failure_report_dir");
  const stamp = (result?.generated_at ?? nowIso()).replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const stage = safePathPart(result?.failure?.failed_stage ?? "failure");
  const cycle = safePathPart(`cycle-${result?.failure?.cycle_number ?? "unknown"}`);
  const fullPath = path.join(fullDir, `researchbrain-stage0-supervisor-${stage}-${cycle}-${stamp}.json`);
  const artifactPath = repoRelative(root, fullPath);
  const payload = {
    schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_FAILURE_REPORT_SCHEMA_VERSION,
    generated_at: nowIso(),
    report_metadata: {
      report_type: "supervisor_failure",
      artifact_path: artifactPath,
      path_scope: "repo_relative",
      schema_stable: true,
      sha256_recorded_by_writer: true,
      diagnostic_only: true
    },
    authority: {
      non_authoritative_operational_report: true,
      official_state_mutated: false,
      official_evidence_index_mutated: false,
      official_backlog_mutated: false,
      official_leaderboard_mutated: false,
      profitability_labels_created: false,
      deterministic_workers_bypassed: false,
      wfa_executed: false,
      mt5_executed: false,
      phase8e_started: false
    },
    supervisor_result: result
  };
  writeJsonAtomic(fullPath, payload, buildPaths(root));
  const sha256 = sha256File(fullPath);
  const consistency = verifySupervisorReportArtifact({
    rootDir: root,
    artifactPath,
    expectedSha256: sha256,
    expectedSchemaVersion: RESEARCHBRAIN_STAGE0_SUPERVISOR_FAILURE_REPORT_SCHEMA_VERSION,
    expectedReportType: "supervisor_failure"
  });
  return { path: artifactPath, sha256, consistency, payload };
}

export function writeResearchBrainStage0SupervisorRunReport({ rootDir = process.cwd(), outputDir = "factory/verification", result }) {
  const root = path.resolve(rootDir);
  const fullDir = resolveRepoRelativePath(root, outputDir, "run_report_dir");
  const stamp = (result?.generated_at ?? nowIso()).replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const status = safePathPart(result?.status ?? "status-unknown");
  const fullPath = path.join(fullDir, `researchbrain-stage0-supervisor-run-${status}-${stamp}.json`);
  const artifactPath = repoRelative(root, fullPath);
  const payload = {
    schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_RUN_REPORT_SCHEMA_VERSION,
    generated_at: nowIso(),
    report_metadata: {
      report_type: "supervisor_run",
      artifact_path: artifactPath,
      path_scope: "repo_relative",
      schema_stable: true,
      sha256_recorded_by_writer: true,
      diagnostic_only: true
    },
    authority: {
      non_authoritative_operational_report: true,
      official_state_mutated: false,
      official_evidence_index_mutated: false,
      official_backlog_mutated: false,
      official_leaderboard_mutated: false,
      profitability_labels_created: false,
      deterministic_workers_bypassed: false,
      wfa_executed: false,
      mt5_executed: false,
      phase8e_started: false
    },
    supervisor_result: result
  };
  writeJsonAtomic(fullPath, payload, buildPaths(root));
  const sha256 = sha256File(fullPath);
  const consistency = verifySupervisorReportArtifact({
    rootDir: root,
    artifactPath,
    expectedSha256: sha256,
    expectedSchemaVersion: RESEARCHBRAIN_STAGE0_SUPERVISOR_RUN_REPORT_SCHEMA_VERSION,
    expectedReportType: "supervisor_run"
  });
  return { path: artifactPath, sha256, consistency, payload };
}

export function buildResearchBrainStage0SupervisorPreflight({
  rootDir = process.cwd(),
  dbPath = null,
  requestPath = null,
  requestSha256 = null,
  providerMode = "valid",
  projectionDir = "factory/runtime/projections/researchbrain-stage0",
  projectionLimit = 5,
  staleLimit = 10,
  failureLimit = 10,
  readinessRequestLimit = 100,
  processedOutboxLimit = 100,
  runtimeConsistencyLimit = 100,
  seedUnseededValid = false,
  autoSeedLimit = 1,
  cycles = 1,
  maxJobs = 1,
  leaseMs = 60_000,
  outboxLimit = 25,
  maxTotalJobs = null,
  maxWallClockMs = null,
  maxTerminalFailures = null,
  maxEstimatedLiveCostUsd = null,
  requireLiveUnattendedSafe = false,
  ...liveOptions
} = {}) {
  requireBoundedInteger(cycles, { field: "cycles", min: 1, max: 25 });
  requireBoundedInteger(maxJobs, { field: "maxJobs", min: 1, max: 25 });
  requireBoundedInteger(leaseMs, { field: "leaseMs", min: 1000, max: 3_600_000 });
  requireBoundedInteger(outboxLimit, { field: "outboxLimit", min: 1, max: 100 });
  requireBoundedInteger(projectionLimit, { field: "projectionLimit", min: 0, max: 50 });
  requireBoundedInteger(staleLimit, { field: "staleLimit", min: 0, max: 100 });
  requireBoundedInteger(failureLimit, { field: "failureLimit", min: 0, max: 100 });
  requireBoundedInteger(readinessRequestLimit, { field: "readinessRequestLimit", min: 0, max: 500 });
  requireBoundedInteger(processedOutboxLimit, { field: "processedOutboxLimit", min: 1, max: 1000 });
  requireBoundedInteger(runtimeConsistencyLimit, { field: "runtimeConsistencyLimit", min: 1, max: 1000 });
  if (seedUnseededValid) requireBoundedInteger(autoSeedLimit, { field: "autoSeedLimit", min: 1, max: 25 });
  const guardrailConfig = validateUnattendedGuardrailArgs({ cycles, maxJobs, maxTotalJobs, maxWallClockMs, maxTerminalFailures, maxEstimatedLiveCostUsd });
  const root = path.resolve(rootDir);
  const explicitSeedRequested = validateSeedArgs({ requestPath, requestSha256 });
  const readiness = buildResearchBrainStage0ReadinessReport({
    rootDir: root,
    dbPath,
    projectionDir,
    projectionLimit,
    staleLimit,
    failureLimit,
    requestLimit: readinessRequestLimit,
    processedOutboxLimit,
    runtimeConsistencyLimit
  });
  const readinessResultSummary = readinessSummary(readiness);
  const autoSeedPreview = buildAutoSeedPreflight({ readiness, enabled: seedUnseededValid, limit: autoSeedLimit });
  const liveProviderPolicy = buildResearchBrainStage0LiveProviderPolicy({
    providerMode,
    cycles,
    maxJobs,
    maxEstimatedLiveCostUsd,
    ...liveOptions
  });
  const unattendedGuardrails = buildUnattendedGuardrailReport({ configured: guardrailConfig, liveProviderPolicy, stopReason: null });
  const blockers = [
    ...autoSeedPreview.blockers.map((reason) => `auto_seed:${reason}`),
    ...(seedUnseededValid && providerMode === "live_llm_agent" ? liveProviderPolicy.hard_blockers.map((reason) => `live_provider:${reason}`) : []),
    ...(seedUnseededValid && providerMode === "live_llm_agent" ? liveUnattendedSafetyBlockers(liveProviderPolicy, requireLiveUnattendedSafe).map((reason) => `live_provider:${reason}`) : []),
    ...unattendedGuardrails.hard_blockers.map((reason) => `guardrail:${reason}`)
  ];
  const queueDrainPlan = buildQueueDrainPlan({
    generatedAt: nowIso(),
    explicitSeedRequested,
    requestPath,
    requestSha256,
    cycles,
    maxJobs,
    outboxLimit,
    guardrailConfig,
    readinessSummary: readinessResultSummary,
    autoSeedPreview,
    liveProviderPolicy,
    unattendedGuardrails,
    blockers,
    requireLiveUnattendedSafe
  });
  const operatorCommandProfile = buildOperatorSafeQueueDrainCommandProfile({
    cycles,
    maxJobs,
    autoSeedLimit,
    outboxLimit,
    maxTotalJobs,
    maxWallClockMs,
    maxTerminalFailures,
    maxEstimatedLiveCostUsd,
    readinessRequestLimit,
    processedOutboxLimit,
    runtimeConsistencyLimit,
    requireLiveUnattendedSafe,
    liveProviderPolicy,
    queueDrainPlan,
    ...liveOptions
  });
  const status = queueDrainPlan.status === "blocked" ? "blocked" : "ready";
  return {
    schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_PREFLIGHT_SCHEMA_VERSION,
    generated_at: nowIso(),
    status,
    next_action: status === "blocked" ? "inspect_operational_blocker" : queueDrainPlan.next_action,
    would_execute_jobs: false,
    explicit_seed_requested: explicitSeedRequested,
    planned_max_jobs: cycles * maxJobs,
    blockers,
    readiness_summary: readinessResultSummary,
    auto_seed_preview: autoSeedPreview,
    queue_drain_plan: queueDrainPlan,
    operator_command_profile: operatorCommandProfile,
    live_provider_policy: liveProviderPolicy,
    unattended_guardrails: unattendedGuardrails,
    official_state_mutated: false,
    official_evidence_index_mutated: false,
    official_backlog_mutated: false,
    official_leaderboard_mutated: false,
    profitability_labels_created: false,
    deterministic_workers_bypassed: false,
    wfa_executed: false,
    mt5_executed: false,
    phase8e_started: false,
    diagnostic_only: true
  };
}

function stage0SupervisorRunStatus({ cycles, failure, stopReason }) {
  if (failure) return "failed";
  const finalReadiness = cycles.at(-1)?.readiness_summary?.status ?? null;
  if (finalReadiness === "attention") return "attention";
  if (cycles.some(cycleMadeOperationalProgress)) return "completed";
  if (stopReason === "idle") return "idle";
  return cycles.length > 0 ? "completed" : "idle";
}

function multiCycleAttentionShouldStop(cycle) {
  if (cycle.status !== "attention") return false;
  const reasons = cycle.readiness_summary?.attention_reasons ?? [];
  if (reasons.length === 0) return true;
  const onlyDrainable = reasons.every((reason) => MULTI_CYCLE_DRAINABLE_ATTENTION.has(reason));
  return !onlyDrainable;
}

function runResearchBrainStage0AutoSeed({
  rootDir,
  dbPath,
  enabled = false,
  limit = 1,
  priority = 0,
  seedStatus = "queued",
  providerMode = "valid",
  outputDir = null,
  projectionDir = "factory/runtime/projections/researchbrain-stage0",
  projectionLimit = 5,
  staleLimit = 10,
  failureLimit = 10,
  readinessRequestLimit = 100,
  processedOutboxLimit = 100,
  runtimeConsistencyLimit = 100,
  maxAttempts,
  maxProviderCalls,
  timeoutMs,
  maxOutputBytes,
  retryDelayMs,
  llmProvider,
  llmModel,
  llmApiKeyEnv,
  llmBaseUrl,
  llmBaseUrlEnv,
  llmMaxTokens,
  llmReasoningEffort,
  maxLlmCalls,
  maxToolCalls,
  maxCostUsd,
  maxTranscriptBytes,
  toolMode,
  sourceProvider,
  sourceApiKeyEnv,
  allowLiveSourceSearch,
  allowLiveSourceCapture
} = {}) {
  if (!enabled) {
    return {
      schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_AUTO_SEED_SCHEMA_VERSION,
      generated_at: nowIso(),
      enabled: false,
      status: "disabled",
      limit,
      eligible_count: 0,
      selected_count: 0,
      seeded_count: 0,
      already_seeded_count: 0,
      failure_count: 0,
      blockers: [],
      seeded: [],
      failures: [],
      diagnostic_only: true,
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
  requireBoundedInteger(limit, { field: "autoSeedLimit", min: 1, max: 25 });
  const root = path.resolve(rootDir);
  const readiness = buildResearchBrainStage0ReadinessReport({
    rootDir: root,
    dbPath,
    projectionDir,
    projectionLimit,
    staleLimit,
    failureLimit,
    requestLimit: readinessRequestLimit,
    processedOutboxLimit,
    runtimeConsistencyLimit
  });
  const blockers = autoSeedBlockingReasons(readiness);
  const eligibleEntries = requestEntriesToAutoSeed(readiness, Number.MAX_SAFE_INTEGER);
  const selectedEntries = blockers.length > 0 ? [] : eligibleEntries.slice(0, limit);
  const seeded = [];
  const failures = [];
  for (const entry of selectedEntries) {
    try {
      const result = seedResearchBrainStage0Job({
        rootDir: root,
        dbPath,
        requestPath: entry.path,
        requestSha256: entry.sha256,
        priority,
        status: seedStatus,
        providerMode,
        outputDir,
        maxAttempts,
        maxProviderCalls,
        timeoutMs,
        maxOutputBytes,
        retryDelayMs,
        llmProvider,
        llmModel,
        llmApiKeyEnv,
        llmBaseUrl,
        llmBaseUrlEnv,
        llmMaxTokens,
        llmReasoningEffort,
        maxLlmCalls,
        maxToolCalls,
        maxCostUsd,
        maxTranscriptBytes,
        toolMode,
        sourceProvider,
        sourceApiKeyEnv,
        allowLiveSourceSearch,
        allowLiveSourceCapture
      });
      seeded.push(result);
    } catch (error) {
      failures.push({
        request_artifact: { path: entry.path, sha256: entry.sha256, request_id: entry.request_id ?? null },
        error_class: error?.name ?? "Error",
        error_message: error instanceof Error ? error.message : String(error)
      });
      break;
    }
  }
  const seededCount = seeded.filter((entry) => entry.status === "seeded").length;
  const alreadySeededCount = seeded.filter((entry) => entry.status === "already_seeded").length;
  return {
    schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_AUTO_SEED_SCHEMA_VERSION,
    generated_at: nowIso(),
    enabled: true,
    status: autoSeedStatus({ enabled: true, blockers, seeded, failures, eligible: eligibleEntries.length }),
    limit,
    eligible_count: eligibleEntries.length,
    selected_count: selectedEntries.length,
    remaining_unseeded_valid_count: Math.max(0, eligibleEntries.length - selectedEntries.length),
    seeded_count: seededCount,
    already_seeded_count: alreadySeededCount,
    failure_count: failures.length,
    blockers,
    seeded,
    failures,
    diagnostic_only: true,
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

export async function runResearchBrainStage0Supervisor({
  rootDir = process.cwd(),
  dbPath = null,
  requestPath = null,
  requestSha256 = null,
  priority = 0,
  seedStatus = "queued",
  providerMode = "valid",
  outputDir = null,
  ownerId = `researchbrain-stage0-supervisor-loop-${process.pid}`,
  consumerId = `researchbrain-stage0-supervisor-outbox-${process.pid}`,
  maxJobs = 1,
  leaseMs = 60_000,
  outboxLimit = 25,
  projectionDir = "factory/runtime/projections/researchbrain-stage0",
  projectionLimit = 5,
  staleLimit = 10,
  failureLimit = 10,
  readinessRequestLimit = 100,
  processedOutboxLimit = 100,
  runtimeConsistencyLimit = 100,
  seedUnseededValid = false,
  autoSeedLimit = 1,
  maxAttempts,
  maxProviderCalls,
  timeoutMs,
  maxOutputBytes,
  retryDelayMs,
  providerFactory = null,
  allowLiveLlm = false,
  llmPreset = null,
  llmProvider = null,
  llmModel = null,
  llmApiKeyEnv = null,
  llmBaseUrl = null,
  llmBaseUrlEnv = null,
  llmMaxTokens,
  llmReasoningEffort = null,
  maxLlmCalls,
  maxToolCalls,
  maxCostUsd,
  maxTranscriptBytes,
  toolMode = null,
  sourceProvider = null,
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  sourceApiKeyEnv = null,
  sourceToolMaxAttempts,
  sourceToolRetryDelayMs,
  maxEstimatedLiveCostUsd = null,
  requireLiveUnattendedSafe = false
} = {}) {
  requireBoundedInteger(maxJobs, { field: "maxJobs", min: 1, max: 25 });
  requireBoundedInteger(leaseMs, { field: "leaseMs", min: 1000, max: 3_600_000 });
  requireBoundedInteger(outboxLimit, { field: "outboxLimit", min: 1, max: 100 });
  requireBoundedInteger(projectionLimit, { field: "projectionLimit", min: 0, max: 50 });
  requireBoundedInteger(staleLimit, { field: "staleLimit", min: 0, max: 100 });
  requireBoundedInteger(failureLimit, { field: "failureLimit", min: 0, max: 100 });
  requireBoundedInteger(readinessRequestLimit, { field: "readinessRequestLimit", min: 0, max: 500 });
  requireBoundedInteger(processedOutboxLimit, { field: "processedOutboxLimit", min: 1, max: 1000 });
  requireBoundedInteger(runtimeConsistencyLimit, { field: "runtimeConsistencyLimit", min: 1, max: 1000 });
  if (seedUnseededValid) requireBoundedInteger(autoSeedLimit, { field: "autoSeedLimit", min: 1, max: 25 });
  const liveProviderPolicy = buildResearchBrainStage0LiveProviderPolicy({
    providerMode,
    allowLiveLlm,
    llmPreset,
    llmProvider,
    llmModel,
    llmApiKeyEnv,
    llmBaseUrl,
    llmBaseUrlEnv,
    llmMaxTokens,
    llmReasoningEffort,
    maxLlmCalls,
    maxToolCalls,
    maxCostUsd,
    maxTranscriptBytes,
    toolMode,
    sourceProvider,
    allowLiveSourceSearch,
    allowLiveSourceCapture,
    sourceApiKeyEnv,
    sourceToolMaxAttempts,
    sourceToolRetryDelayMs,
    timeoutMs,
    maxOutputBytes,
    cycles: 1,
    maxJobs,
    maxEstimatedLiveCostUsd
  });
  if (seedUnseededValid && providerMode === "live_llm_agent") assertLiveQueueDrainPolicy(liveProviderPolicy, { requireLiveUnattendedSafe });
  const root = path.resolve(rootDir);
  const generatedAt = nowIso();
  const partial = { seed: null, autoSeed: null, loop: null, outbox: null, diagnostics: null };

  const seed = await runSupervisorStage("seed", partial, async () => {
    const shouldSeed = validateSeedArgs({ requestPath, requestSha256 });
    return shouldSeed ? seedResearchBrainStage0Job({
      rootDir: root,
      dbPath,
      requestPath,
      requestSha256,
      priority,
      status: seedStatus,
      providerMode,
      outputDir,
      maxAttempts,
      maxProviderCalls,
      timeoutMs,
      maxOutputBytes,
      retryDelayMs,
      llmProvider,
      llmModel,
      llmApiKeyEnv,
      llmBaseUrl,
      llmBaseUrlEnv,
      llmMaxTokens,
      llmReasoningEffort,
      maxLlmCalls,
      maxToolCalls,
      maxCostUsd,
      maxTranscriptBytes,
      toolMode,
      sourceProvider,
      sourceApiKeyEnv,
      allowLiveSourceSearch,
      allowLiveSourceCapture
    }) : null;
  });
  partial.seed = seed;

  const autoSeed = await runSupervisorStage("auto_seed", partial, async () => runResearchBrainStage0AutoSeed({
    rootDir: root,
    dbPath,
    enabled: seedUnseededValid,
    limit: autoSeedLimit,
    priority,
    seedStatus,
    providerMode,
    outputDir,
    projectionDir,
    projectionLimit,
    staleLimit,
    failureLimit,
    readinessRequestLimit,
    processedOutboxLimit,
    runtimeConsistencyLimit,
    maxAttempts,
    maxProviderCalls,
    timeoutMs,
    maxOutputBytes,
    retryDelayMs,
    llmProvider,
    llmModel,
    llmApiKeyEnv,
    llmBaseUrl,
    llmBaseUrlEnv,
    llmMaxTokens,
    llmReasoningEffort,
    maxLlmCalls,
    maxToolCalls,
    maxCostUsd,
    maxTranscriptBytes,
    toolMode,
    sourceProvider,
    sourceApiKeyEnv,
    allowLiveSourceSearch,
    allowLiveSourceCapture
  }));
  partial.autoSeed = autoSeed;

  const runtimeDefaults = {};
  if (maxAttempts !== undefined) runtimeDefaults.maxAttempts = maxAttempts;
  if (maxProviderCalls !== undefined) runtimeDefaults.maxProviderCalls = maxProviderCalls;
  if (timeoutMs !== undefined) runtimeDefaults.timeoutMs = timeoutMs;
  if (maxOutputBytes !== undefined) runtimeDefaults.maxOutputBytes = maxOutputBytes;
  if (retryDelayMs !== undefined) runtimeDefaults.retryDelayMs = retryDelayMs;

  const loop = await runSupervisorStage("loop", partial, () => runResearchBrainStage0Loop({
    rootDir: root,
    dbPath,
    ownerId,
    maxJobs,
    leaseMs,
    runtimeDefaults,
    providerFactory
  }));
  partial.loop = loop;

  const outbox = await runSupervisorStage("outbox", partial, async () => consumeResearchBrainStage0Outbox({
    rootDir: root,
    dbPath,
    consumerId,
    limit: outboxLimit,
    outputDir: projectionDir
  }));
  partial.outbox = outbox;

  const diagnostics = await runSupervisorStage("diagnostics", partial, async () => buildResearchBrainStage0Diagnostics({
    rootDir: root,
    dbPath,
    projectionDir,
    projectionLimit,
    staleLimit,
    failureLimit
  }));
  partial.diagnostics = diagnostics;

  const readiness = await runSupervisorStage("readiness", partial, async () => buildResearchBrainStage0ReadinessReport({
    rootDir: root,
    dbPath,
    projectionDir,
    projectionLimit,
    staleLimit,
    failureLimit,
    requestLimit: readinessRequestLimit,
    processedOutboxLimit,
    runtimeConsistencyLimit
  }));
  const readinessResultSummary = readinessSummary(readiness);
  const status = supervisorStatus({ seed: seed ?? (autoSeed?.seeded_count > 0 ? autoSeed : null), loop, outbox, diagnostics, readinessSummary: readinessResultSummary });
  const recommendation = buildSupervisorRecommendation({ status, readinessSummary: readinessResultSummary });
  const cycleSummary = supervisorCycleSummary({ seed, autoSeed, loop, outbox, diagnostics });
  const operationalSummary = buildCycleOperationalSummary({
    status,
    recommendation,
    cycleSummary,
    readinessSummary: readinessResultSummary
  });
  const supervisorHealth = buildSupervisorHealth({ status, recommendation, operationalSummary });

  return {
    schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_RESULT_SCHEMA_VERSION,
    generated_at: generatedAt,
    status,
    next_action: recommendation.next_action,
    recommendation,
    supervisor_health: supervisorHealth,
    operational_summary: operationalSummary,
    cycle_summary: cycleSummary,
    readiness_summary: readinessResultSummary,
    live_provider_policy: liveProviderPolicy,
    seed,
    auto_seed: autoSeed,
    loop,
    outbox,
    diagnostics,
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

export async function runResearchBrainStage0SupervisorCycles({
  cycles = 1,
  stopOnAttention = true,
  ownerId = `researchbrain-stage0-supervisor-loop-${process.pid}`,
  consumerId = `researchbrain-stage0-supervisor-outbox-${process.pid}`,
  requestPath = null,
  requestSha256 = null,
  failureReportDir = null,
  runReportDir = null,
  maxTotalJobs = null,
  maxWallClockMs = null,
  maxTerminalFailures = null,
  maxEstimatedLiveCostUsd = null,
  requireLiveUnattendedSafe = false,
  ...options
} = {}) {
  requireBoundedInteger(cycles, { field: "cycles", min: 1, max: 25 });
  const configuredMaxJobs = options.maxJobs ?? 1;
  requireBoundedInteger(configuredMaxJobs, { field: "maxJobs", min: 1, max: 25 });
  const guardrailConfig = validateUnattendedGuardrailArgs({
    cycles,
    maxJobs: configuredMaxJobs,
    maxTotalJobs,
    maxWallClockMs,
    maxTerminalFailures,
    maxEstimatedLiveCostUsd
  });
  const root = path.resolve(options.rootDir ?? process.cwd());
  const generatedAt = nowIso();
  const startedMs = Date.now();
  const liveProviderPolicy = buildResearchBrainStage0LiveProviderPolicy({
    ...options,
    requestPath,
    requestSha256,
    cycles,
    maxJobs: configuredMaxJobs,
    maxEstimatedLiveCostUsd
  });
  const cycleResults = [];
  let stopReason = "cycles_exhausted";
  let failure = null;
  let failureArtifact = null;
  let runArtifact = null;
  const liveQueueDrainBlockers = [
    ...(liveProviderPolicy.safe_to_attempt_live_cycle === true ? [] : (liveProviderPolicy.hard_blockers ?? [])),
    ...liveUnattendedSafetyBlockers(liveProviderPolicy, requireLiveUnattendedSafe)
  ];
  if (options.seedUnseededValid === true && options.providerMode === "live_llm_agent" && liveQueueDrainBlockers.length > 0) {
    failure = buildFailureEnvelope({
      error: new Error(`ResearchBrain Stage-0 supervisor live queue-drain preflight failed: ${liveQueueDrainBlockers.join(", ")}`),
      cycleNumber: 1,
      cyclesCompletedBeforeFailure: 0
    });
    stopReason = "cycle_failed";
  }

  for (let index = 0; !failure && index < cycles; index += 1) {
    try {
      const beforeAggregate = aggregateCycleSummaries(cycleResults);
      const jobsRemaining = guardrailConfig.max_total_jobs_explicit
        ? guardrailConfig.max_total_jobs - (beforeAggregate.totals.jobs_processed ?? 0)
        : configuredMaxJobs;
      if (guardrailConfig.max_total_jobs_explicit && jobsRemaining <= 0) {
        stopReason = "max_total_jobs";
        break;
      }
      if (guardrailConfig.max_wall_clock_ms !== null && Date.now() - startedMs >= guardrailConfig.max_wall_clock_ms) {
        stopReason = "max_wall_clock_ms";
        break;
      }
      const cycle = await runResearchBrainStage0Supervisor({
        ...options,
        maxJobs: Math.min(configuredMaxJobs, jobsRemaining),
        maxEstimatedLiveCostUsd,
        requireLiveUnattendedSafe,
        requestPath: index === 0 ? requestPath : null,
        requestSha256: index === 0 ? requestSha256 : null,
        ownerId: `${ownerId}-cycle-${index + 1}`,
        consumerId: `${consumerId}-cycle-${index + 1}`
      });
      cycleResults.push({ cycle_number: index + 1, ...cycle });
      const afterAggregate = aggregateCycleSummaries(cycleResults);
      if (guardrailConfig.max_total_jobs_explicit && (afterAggregate.totals.jobs_processed ?? 0) >= guardrailConfig.max_total_jobs) {
        stopReason = "max_total_jobs";
        break;
      }
      if (guardrailConfig.max_terminal_failures !== null && (afterAggregate.totals.terminal_jobs ?? 0) > guardrailConfig.max_terminal_failures) {
        stopReason = "max_terminal_failures";
        break;
      }
      if (guardrailConfig.max_wall_clock_ms !== null && Date.now() - startedMs >= guardrailConfig.max_wall_clock_ms) {
        stopReason = "max_wall_clock_ms";
        break;
      }
      if (stopOnAttention && multiCycleAttentionShouldStop(cycle)) {
        stopReason = "attention";
        break;
      }
      if (!cycleMadeOperationalProgress(cycle)) {
        stopReason = "idle";
        break;
      }
    } catch (error) {
      failure = buildFailureEnvelope({ error, cycleNumber: index + 1, cyclesCompletedBeforeFailure: cycleResults.length });
      stopReason = "cycle_failed";
      break;
    }
  }

  const aggregate = aggregateCycleSummaries(cycleResults);
  const unattendedGuardrails = buildUnattendedGuardrailReport({
    configured: guardrailConfig,
    liveProviderPolicy,
    aggregate,
    startedMs,
    endedMs: Date.now(),
    stopReason
  });
  const status = stage0SupervisorRunStatus({ cycles: cycleResults, failure, stopReason });
  const recommendation = buildSupervisorRecommendation({
    status,
    failure,
    readinessSummary: aggregate.final_readiness_summary,
    aggregate,
    stopReason
  });
  const result = {
    schema_version: RESEARCHBRAIN_STAGE0_SUPERVISOR_RUN_RESULT_SCHEMA_VERSION,
    generated_at: generatedAt,
    status,
    stop_reason: stopReason,
    next_action: recommendation.next_action,
    recommendation,
    max_cycles: cycles,
    stop_on_attention: stopOnAttention,
    aggregate,
    live_provider_policy: liveProviderPolicy,
    unattended_guardrails: unattendedGuardrails,
    failure,
    failure_artifact: null,
    run_report_artifact: null,
    cycles: cycleResults,
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
  result.report_artifact_summary = buildReportArtifactSummary({ failure, failureReportDir, runReportDir });
  result.operational_summary = buildRunOperationalSummary({
    status,
    stopReason,
    recommendation,
    aggregate,
    failure,
    reportArtifactSummary: result.report_artifact_summary
  });
  result.supervisor_health = buildSupervisorHealth({
    status,
    recommendation,
    failure,
    operationalSummary: result.operational_summary
  });
  if (failure && failureReportDir) {
    failureArtifact = writeResearchBrainStage0SupervisorFailureReport({ rootDir: root, outputDir: failureReportDir, result });
    result.failure_artifact = { path: failureArtifact.path, sha256: failureArtifact.sha256, consistency: failureArtifact.consistency };
  }
  if (runReportDir) {
    runArtifact = writeResearchBrainStage0SupervisorRunReport({ rootDir: root, outputDir: runReportDir, result });
    result.run_report_artifact = { path: runArtifact.path, sha256: runArtifact.sha256, consistency: runArtifact.consistency };
  }
  result.report_artifact_summary = buildReportArtifactSummary({ failure, failureReportDir, runReportDir, failureArtifact, runArtifact });
  result.operational_summary = buildRunOperationalSummary({
    status,
    stopReason,
    recommendation,
    aggregate,
    failure,
    reportArtifactSummary: result.report_artifact_summary
  });
  result.supervisor_health = buildSupervisorHealth({
    status,
    recommendation,
    failure,
    operationalSummary: result.operational_summary
  });
  return result;
}

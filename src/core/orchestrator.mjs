import fs from "fs";
import path from "path";
import { FACTORY_GOAL } from "./constants.mjs";
import { initializeProject } from "./init.mjs";
import { StateStore } from "./state-store.mjs";
import { BacklogStore } from "./backlog-store.mjs";
import { ArtifactStore } from "./artifact-store.mjs";
import { Logger } from "./logger.mjs";
import { plannerPrompt, executorPrompt, evaluatorPrompt, summarizerPrompt, ideatorPrompt } from "./prompt-builders.mjs";
import { buildIdeatorRetrieval, buildPlannerRetrieval, buildExecutorRetrieval, buildEvaluatorRetrieval, buildSummarizerRetrieval } from "./retrieval.mjs";
import { extractRfJson } from "./parse.mjs";
import { SimulateRunner } from "./runner-simulate.mjs";
import { openBrowserUrl } from "./runner-opencode.mjs";
import { buildRunSummary } from "./summary.mjs";
import { appendCanonicalLessons, buildCanonicalLessonEntries, rebuildNormalizedMemory } from "./memory-index.mjs";
import { rebuildHealthMetrics } from "./health.mjs";
import { readLeaderboardEntries } from "./leaderboard-store.mjs";
import { marketPolicyCapsule, readMarketPolicy } from "./market-policy.mjs";
import { reconcileStartupState, RuntimeStateStore } from "./runtime-state.mjs";
import { validatePlannerResult, validateExecutionResult, validateExecutionArtifacts, validateEvaluationResult, validateSummaryResult } from "./validators.mjs";
import { appendLine, readJson, writeJsonAtomic } from "./fs-utils.mjs";
import { assertLiveTransport, createLiveTransport } from "./transport/live-transport.mjs";
import { acquireOwnerLock, appendRecoveryEvent, heartbeatOwnerLock, releaseOwnerLock } from "./runtime-lock.mjs";
import { buildStageGateResult, pruneOperationalArtifacts, resolvePreferredLiveTransportAdapter, writeRolloutGate, writeVerificationManifest } from "./verification.mjs";

function runId() {
  return `RUN-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

function evidenceEntry({ runId, mode, backlogItem, plan, executionResult, evaluation, summaryPath }) {
  return {
    run_id: runId,
    mode,
    backlog_item_id: backlogItem.id,
    experiment_id: plan.experiment_id,
    strategy_family: plan.strategy_type ?? null,
    market_family: plan.market_family ?? backlogItem.market_family ?? null,
    asset_scope: plan.instrument_scope ?? plan.instrument_selection_rule ?? backlogItem.instrument_scope ?? null,
    timeframe: plan.timeframe ?? backlogItem.timeframe ?? null,
    verdict: evaluation.verdict,
    evidence_score: evaluation.evidence_score,
    overall_score: evaluation.overall_score,
    metrics: evaluation.metrics ?? executionResult.metrics_observed ?? null,
    summary_path: summaryPath,
    recorded_at: new Date().toISOString()
  };
}

function getFactoryStats(paths) {
  const lessons = fs.existsSync(paths.lessons)
    ? fs.readFileSync(paths.lessons, "utf8").split("\n").filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean)
    : [];

  const evidence = fs.existsSync(paths.evidenceIndex)
    ? JSON.parse(fs.readFileSync(paths.evidenceIndex, "utf8"))
    : [];

  const leaderboard = readLeaderboardEntries(paths);

  const strategyDigest = fs.existsSync(paths.strategyDigest)
    ? fs.readFileSync(paths.strategyDigest, "utf8")
    : "";

  const retrievalIndex = fs.existsSync(paths.retrievalIndex)
    ? JSON.parse(fs.readFileSync(paths.retrievalIndex, "utf8"))
    : [];

  const marketPolicy = marketPolicyCapsule(readMarketPolicy(paths));

  const iterationHistory = fs.existsSync(paths.iterationDigest)
    ? fs.readFileSync(paths.iterationDigest, "utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-5)
        .map((line) => {
          const parts = line.split("|").map((p) => p.trim());
          return {
            iteration: parts[0] || "",
            experiment_id: parts[1] || "",
            verdict: parts[2]?.replace("Verdict:", "")?.trim() || "unknown",
            sharpe: parts[3]?.replace("Sharpe:", "")?.trim() || "N/A",
            key: parts[4]?.replace("Key:", "")?.trim() || ""
          };
        })
    : [];

  return {
    totalRuns: evidence.length,
    lessons,
    evidence,
    retrievalIndex,
    marketPolicy,
    recentLessons: lessons.slice(-5),
    leaderboard,
    strategyDigest,
    iterationHistory
  };
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      name: "NonError",
      message: String(error)
    };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack || null,
    failure_class: error.rf_failure_class ?? null,
    retry_class: error.rf_retry_class ?? null,
    transport_phase: error.rf_transport_phase ?? null,
    retryable: error.rf_retryable ?? null,
    timeout_bucket: error.rf_timeout_bucket ?? null,
    transport_adapter: error.rf_transport_adapter ?? null,
    server_fingerprint: error.rf_server_fingerprint ?? null,
    cause: error.cause instanceof Error
      ? { name: error.cause.name, message: error.cause.message, stack: error.cause.stack || null }
      : error.cause ?? null
  };
}

function summarizeLessonForDigest(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    return item.lesson || item.specific_finding || item.summary || JSON.stringify(item);
  }
  return "N/A";
}

function clearActiveSessionState(state) {
  state.active_session_id = null;
  state.active_session_url = null;
  return state;
}

function updateActiveSession(paths, patch) {
  const current = readJson(paths.activeSession, {
    status: "idle",
    run_id: null,
    agent: null,
    attempt: null,
    session_id: null,
    session_url: null,
    updated_at: null,
    ended_at: null
  });
  writeJsonAtomic(paths.activeSession, {
    ...current,
    ...patch,
    updated_at: new Date().toISOString()
  }, paths);
}

function closeActiveSession(paths, patch = {}) {
  updateActiveSession(paths, {
    status: "idle",
    ended_at: new Date().toISOString(),
    ...patch
  });
}

function updateActiveRun(runtimeStateStore, patch) {
  if (!runtimeStateStore) return;
  if (patch.status === "idle" || patch.status === "interrupted" || patch.status === "error") {
    runtimeStateStore.markIdle({
      status: patch.status,
      owner_id: patch.owner_id ?? null,
      run_id: patch.run_id ?? null,
      run_instance_id: patch.run_instance_id ?? null,
      backlog_item_id: patch.backlog_item_id ?? null,
      stage: patch.stage ?? null,
      attempt: patch.attempt ?? null,
      session_id: patch.session_id ?? null,
      session_url: patch.session_url ?? null,
      follow_url: patch.follow_url ?? null,
      heartbeat_at: patch.heartbeat_at ?? null,
      last_error: patch.last_error ?? null,
      last_retry_note: patch.last_retry_note ?? null
    });
    return;
  }

  runtimeStateStore.markActive({
    status: patch.status ?? "active",
    owner_id: patch.owner_id,
    run_id: patch.run_id,
    run_instance_id: patch.run_instance_id,
    backlog_item_id: patch.backlog_item_id,
    stage: patch.stage,
    attempt: patch.attempt,
    session_id: patch.session_id,
    session_url: patch.session_url,
    follow_url: patch.follow_url ?? patch.session_url,
    heartbeat_at: patch.heartbeat_at ?? new Date().toISOString(),
    last_error: patch.last_error ?? null,
    last_retry_note: patch.last_retry_note ?? null
  });
}

function tokenizeScopeText(...values) {
  return [...new Set(values
    .filter((value) => typeof value === "string")
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
    .filter((token) => token.length >= 3))];
}

function overlapsAnyToken(tokens, text) {
  if (!Array.isArray(tokens) || tokens.length === 0 || typeof text !== "string") return false;
  const haystack = text.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function comparableLessonsForItem(factoryStats, backlogItem) {
  const itemTokens = tokenizeScopeText(
    backlogItem?.title,
    backlogItem?.objective,
    backlogItem?.market_family,
    backlogItem?.instrument_scope,
    backlogItem?.timeframe,
    backlogItem?.data_requirement
  );

  return (Array.isArray(factoryStats.lessons) ? factoryStats.lessons : [])
    .filter((entry) => entry?.mode === "live")
    .filter((entry) => {
      if (backlogItem?.market_family && entry?.market_family === backlogItem.market_family) return true;
      if (backlogItem?.instrument_scope && entry?.asset_scope === backlogItem.instrument_scope) return true;
      if (backlogItem?.timeframe && entry?.timeframe === backlogItem.timeframe) return true;
      return overlapsAnyToken(itemTokens, entry?.lesson_text) || overlapsAnyToken(itemTokens, entry?.specific_finding);
    });
}

function textForLiveSuitability(item) {
  return [item?.title, item?.objective, item?.category].filter(Boolean).join(" ");
}

function isMetaAnalysisFollowupText(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return false;
  return /\bwfr\b|walk-forward ratio|consistency score|evaluation metric|evaluation metrics|metric validation|manual code inspection|code inspection|engine verification|possible from window results|for future evaluations|evaluate whether .* acceptable|verify .* calculation/i.test(normalized);
}

function isLiveQueueEligible(item) {
  if (!item || typeof item !== "object") return false;
  if (item.category !== "followup") return true;
  return !isMetaAnalysisFollowupText(textForLiveSuitability(item));
}

function selectNextBacklogItem(backlogStore, factoryStats) {
  const selectionPolicy = factoryStats.marketPolicy?.selection_policy || {};
  const readyStatuses = selectionPolicy.ready_statuses;
  const weights = selectionPolicy.ranking_weights || {};
  const readyItems = backlogStore.read().filter((item) => readyStatuses.includes(item.status) && isLiveQueueEligible(item));
  const recentLiveLessons = (Array.isArray(factoryStats.lessons) ? factoryStats.lessons : []).filter((entry) => entry?.mode === "live").slice(-20);
  const recentMarketCounts = recentLiveLessons.reduce((acc, entry) => {
    const key = entry?.market_family || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const totalRecent = recentLiveLessons.length || 1;

  const scoreItem = (item) => {
    const comparableLessons = comparableLessonsForItem(factoryStats, item);
    const comparableEvidenceScores = comparableLessons.map((entry) => entry?.evidence_score).filter((value) => typeof value === "number");
    const avgEvidenceScore = comparableEvidenceScores.length > 0
      ? comparableEvidenceScores.reduce((sum, value) => sum + value, 0) / comparableEvidenceScores.length
      : 0;
    const positiveComparableCount = comparableLessons.filter((entry) => ["promising", "promising_with_caveats", "passed", "success", "partial"].includes(entry?.verdict)).length;
    const lowTradeComparableCount = comparableLessons.filter((entry) => {
      const trades = entry?.metrics?.total_trades;
      return typeof trades === "number" && trades < selectionPolicy.minimum_trade_count_for_promotion;
    }).length;
    const blockerComparableCount = comparableLessons.filter((entry) => ["blocked", "failed"].includes(entry?.verdict)).length;
    const revisitSignal = ["partial", "promising_with_caveats", "research_inconclusive"].includes(item?.last_verdict) ? 1 : 0;
    const noveltySignal = comparableLessons.length === 0 ? 1 : 0;
    const marketShare = recentMarketCounts[item?.market_family || "unknown"] ? recentMarketCounts[item?.market_family || "unknown"] / totalRecent : 0;
    const underexploredSignal = item?.market_family && marketShare < 0.25 ? 1 : 0;
    const repeatedBlockerSignal = item?.last_failure_class ? 1 : 0;

    return (item?.priority ?? 0) * (weights.base_priority ?? 1)
      + avgEvidenceScore * (weights.comparable_evidence ?? 0)
      + positiveComparableCount * (weights.robustness_bonus ?? 0)
      + revisitSignal * (weights.revisit_bonus ?? 0)
      + noveltySignal * (weights.novelty_bonus ?? 0)
      + underexploredSignal * (weights.underexplored_market_bonus ?? 0)
      - blockerComparableCount * (weights.repeated_blocker_penalty ?? 0)
      - repeatedBlockerSignal * (weights.repeated_blocker_penalty ?? 0)
      - lowTradeComparableCount * (weights.low_trade_penalty ?? 0);
  };

  return readyItems
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score || (b.item.priority ?? 0) - (a.item.priority ?? 0))[0]?.item ?? null;
}

async function callWithRetry(fn, label, maxRetries, logger, options = {}) {
  const delays = [2000, 5000, 10000];
  let lastError = null;
  let retryNote = null;
  let lastRetryClass = null;
  let lastAttempt = 0;
  const attempts = Math.max(1, maxRetries);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let heartbeatTimer = null;
    let attemptError = null;
    lastAttempt = attempt;
    try {
      if (typeof options.onStart === "function") {
        options.onStart({ attempt, attempts });
      }
      if (typeof options.onHeartbeat === "function") {
        options.onHeartbeat({ attempt, attempts, status: "started" });
        heartbeatTimer = setInterval(() => {
          options.onHeartbeat({ attempt, attempts, status: "running" });
        }, 60000);
      }
      const activeRetryNote = retryNote;
      retryNote = null;
      return await fn({ attempt, attempts, retryNote: activeRetryNote });
    } catch (error) {
      attemptError = error;
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const failureClass = classifyRetryFailure(error);
      lastRetryClass = failureClass;
      retryNote = attempt < attempts
        ? buildRetryNote({ stage: label.toLowerCase(), attempt, failureClass, message: msg })
        : null;
      logger?.line(`${label} failed (attempt ${attempt}/${attempts})`, { error: serializeError(error) });
      if (typeof options.onError === "function") {
        options.onError({ attempt, attempts, error, message: msg, failureClass, retryNote });
      }
      if (attempt < attempts) {
        const delay = delays[Math.min(attempt - 1, delays.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (typeof options.onFinish === "function") {
        options.onFinish({ attempt, attempts, success: attemptError == null });
      }
    }
  }
  if (lastError && typeof lastError === "object") {
    lastError.rf_retry_class = lastRetryClass;
    lastError.rf_attempts_used = lastAttempt;
    lastError.rf_stage = label.toLowerCase();
  }
  throw lastError;
}

function classifyRetryFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out waiting for response headers|fetch failed|before response was received|timed out after/i.test(message)) {
    return "transport";
  }
  if (/Structured RF JSON block not found|JSON parse failed|without any artifacts_created|without any WFA result artifacts|without any observed WFA metrics|without structured errors or blockers|empty or invalid result object/i.test(message)) {
    return "schema";
  }
  return "execution_validation";
}

function buildRetryNote({ stage, attempt, failureClass, message }) {
  if (failureClass === "transport") {
    return {
      stage,
      previous_attempt: attempt,
      failure_class: failureClass,
      last_error: message
    };
  }
  if (failureClass === "schema") {
    return {
      stage,
      previous_attempt: attempt,
      failure_class: failureClass,
      validator_error: message
    };
  }
  return {
    stage,
    previous_attempt: attempt,
    failure_class: failureClass,
    last_error: message
  };
}

const RESEARCH_STAGES = ["planner", "executor", "evaluator", "summarizer"];
const STAGE_RANK = RESEARCH_STAGES.reduce((acc, stage, index) => ({ ...acc, [stage]: index }), {});
const LEASE_TTL_MS = 30 * 60 * 1000;

function defaultStageStatus() {
  return RESEARCH_STAGES.reduce((acc, stage) => {
    acc[stage] = { status: "pending", updated_at: null };
    return acc;
  }, {});
}

function createRunState(runIdValue, backlogItemId, { ownerId = null, runInstanceId = runIdValue } = {}) {
  return {
    run_id: runIdValue,
    backlog_item_id: backlogItemId,
    owner_id: ownerId,
    run_instance_id: runInstanceId,
    resume_generation: 0,
    current_stage: null,
    current_stage_attempt: null,
    current_stage_session: null,
    last_completed_stage: null,
    observer_opened_at: null,
    poison_streak_count: 0,
    poison_stage: null,
    poison_failure_class: null,
    stage_status: defaultStageStatus(),
    failure_class: null,
    resume_from_stage: "planner",
    attempt_counts: Object.fromEntries(RESEARCH_STAGES.map((stage) => [stage, 0])),
    artifact_paths: {},
    handoff_pending: false,
    last_error: null,
    updated_at: new Date().toISOString()
  };
}

function nextStageAfter(stage) {
  const index = RESEARCH_STAGES.indexOf(stage);
  if (index === -1 || index === RESEARCH_STAGES.length - 1) return null;
  return RESEARCH_STAGES[index + 1];
}

function classifyFailureClass(error) {
  if (error?.rf_failure_class) {
    return error.rf_failure_class;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/SIGINT|SIGTERM|Interrupted by|interruption/i.test(message)) {
    return "interruption";
  }
  if (/timed out waiting for response headers|fetch failed|before response was received|timed out after|socket hang up|ECONNRESET|disconnect/i.test(message)) {
    return "transport_failure";
  }
  if (/Structured RF JSON block not found|JSON parse failed|without any artifacts_created|without any WFA result artifacts|without any observed WFA metrics|without structured errors or blockers|empty or invalid result object|missing created artifacts/i.test(message)) {
    return "stage_output_failure";
  }
  if (/ENOSPC|EACCES|EPERM|EROFS|permission denied|disk|filesystem|broken venv|corrupted repo/i.test(message)) {
    return "environment_failure";
  }
  if (/command|traceback|walk-forward|walk forward|min_required_bars|dataset|data source|module not found|file not found|no such file/i.test(message)) {
    return "execution_failure";
  }
  return "orchestrator_bug";
}

function researchStatusFromEvaluation(evaluation) {
  if (evaluation.verdict === "blocked") return "research_blocked";
  if (evaluation.verdict === "promising" || evaluation.verdict === "promising_with_caveats") return "research_complete";
  return "research_inconclusive";
}

function createLeaseExpiry(ts = Date.now()) {
  return new Date(ts + LEASE_TTL_MS).toISOString();
}

function flattenArtifactPaths(artifactPaths) {
  return Object.values(artifactPaths || {}).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
}

function registerArtifactPath(artifactStore, runIdValue, fallbackState, key, fullPath, { append = false } = {}) {
  const relativePath = artifactStore.relativeToRoot(fullPath);
  artifactStore.updateRunState(runIdValue, (state) => {
    state.artifact_paths ||= {};
    if (append) {
      state.artifact_paths[key] ||= [];
      if (!state.artifact_paths[key].includes(relativePath)) {
        state.artifact_paths[key].push(relativePath);
      }
    } else {
      state.artifact_paths[key] = relativePath;
    }
    state.updated_at = new Date().toISOString();
    return state;
  }, fallbackState);
  return relativePath;
}

function setRunStageStatus(artifactStore, runIdValue, fallbackState, stage, status, extra = {}) {
  return artifactStore.updateRunState(runIdValue, (state) => {
    state.stage_status ||= defaultStageStatus();
    state.stage_status[stage] = {
      ...(state.stage_status[stage] || {}),
      status,
      updated_at: new Date().toISOString(),
      ...extra
    };
    state.updated_at = new Date().toISOString();
    return state;
  }, fallbackState);
}

function updateRunResumePoint(artifactStore, runIdValue, fallbackState, stage, failureClass = null) {
  return artifactStore.updateRunState(runIdValue, (state) => {
    state.resume_from_stage = stage;
    state.failure_class = failureClass;
    if (!stage) {
      state.current_stage = null;
      state.current_stage_attempt = null;
      state.current_stage_session = null;
    }
    state.updated_at = new Date().toISOString();
    return state;
  }, fallbackState);
}

function allocateStageAttemptOrdinal(artifactStore, runIdValue, fallbackState, stage, { ownerId = null, runInstanceId = runIdValue } = {}) {
  let allocated = 0;
  artifactStore.updateRunState(runIdValue, (state) => {
    state.attempt_counts ||= Object.fromEntries(RESEARCH_STAGES.map((item) => [item, 0]));
    state.attempt_counts[stage] = Number(state.attempt_counts[stage] || 0) + 1;
    allocated = state.attempt_counts[stage];
    state.owner_id ||= ownerId;
    state.run_instance_id ||= runInstanceId;
    state.current_stage = stage;
    state.current_stage_attempt = allocated;
    state.current_stage_session = null;
    state.updated_at = new Date().toISOString();
    return state;
  }, fallbackState);
  return allocated;
}

function readRunJson(paths, runIdValue, fileName, fallback = null) {
  const fullPath = path.join(paths.runs, runIdValue, fileName);
  if (!fs.existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return fallback;
  }
}

function readRunText(paths, runIdValue, fileName, fallback = null) {
  const fullPath = path.join(paths.runs, runIdValue, fileName);
  if (!fs.existsSync(fullPath)) return fallback;
  return fs.readFileSync(fullPath, "utf8");
}

function chooseResumeCandidate(paths, backlogStore, artifactStore) {
  const backlogItems = backlogStore.read();
  const candidates = [];

  for (const item of backlogItems) {
    if (!item.current_run_id) continue;
    if (!["ready", "leased", "infra_blocked"].includes(item.status)) continue;

    const runState = artifactStore.readRunState(item.current_run_id, null);
    if (!runState || !runState.resume_from_stage) continue;

    const handoff = artifactStore.readHandoff(item.current_run_id, null);
    const hasPendingHandoff = handoff
      && handoff.consumed === false
      && handoff.resume_generation === runState.resume_generation;
    const resumeFromStage = hasPendingHandoff ? handoff.resume_from_stage : item.resume_from_stage || runState.resume_from_stage;
    if (!resumeFromStage || !(resumeFromStage in STAGE_RANK)) continue;

    const needsPlan = ["executor", "evaluator", "summarizer"].includes(resumeFromStage);
    const needsExecution = ["evaluator", "summarizer"].includes(resumeFromStage);
    const needsEvaluation = resumeFromStage === "summarizer";
    if (needsPlan && !fs.existsSync(path.join(paths.runs, item.current_run_id, "experiment-plan.json"))) continue;
    if (needsExecution && !fs.existsSync(path.join(paths.runs, item.current_run_id, "execution-result.json"))) continue;
    if (needsEvaluation && !fs.existsSync(path.join(paths.runs, item.current_run_id, "evaluation.json"))) continue;

    candidates.push({
      backlogItem: item,
      runId: item.current_run_id,
      runState,
      handoff: hasPendingHandoff ? handoff : null,
      resumeFromStage,
      priority: hasPendingHandoff ? 2 : 1,
      stageRank: STAGE_RANK[resumeFromStage],
      updatedAt: Date.parse(runState.updated_at || 0) || 0
    });
  }

  candidates.sort((a, b) => b.priority - a.priority || b.stageRank - a.stageRank || b.updatedAt - a.updatedAt);
  return candidates[0] ?? null;
}

function buildHandoffRetryNote(handoff) {
  if (!handoff || handoff.consumed) return null;
  return {
    source: "handoff",
    resume_generation: handoff.resume_generation,
    resume_from_stage: handoff.resume_from_stage,
    failure_class: handoff.failure_class,
    last_error: handoff.last_error,
    attempts_used: handoff.attempts_used,
    safe_inputs: handoff.safe_inputs,
    produced_artifacts: handoff.produced_artifacts
  };
}

function signalExitReason(signal) {
  return signal ? `interrupted_by_${String(signal).toLowerCase()}` : "interrupted";
}

function enforcePromptBudget(stage, promptText, config, logger) {
  const budget = config?.promptBudgetPolicy?.stageBudgets?.[stage];
  if (!budget) return;
  const bytes = Buffer.byteLength(promptText, "utf8");
  if (bytes <= budget) return;

  const message = `${stage} prompt budget exceeded: ${bytes} bytes > ${budget} byte budget.`;
  if (config?.promptBudgetPolicy?.strict) {
    const error = new Error(message);
    error.rf_failure_class = "environment_failure";
    throw error;
  }

  logger?.line("Prompt budget warning", { stage, prompt_bytes: bytes, prompt_budget: budget });
}

function poisonDispositionForFailure(runState, stage, failureClass, policy, now = new Date()) {
  const sameFailure = runState?.poison_stage === stage && runState?.poison_failure_class === failureClass;
  const streak = sameFailure ? Number(runState?.poison_streak_count || 0) + 1 : 1;
  const stageAttempts = Number(runState?.attempt_counts?.[stage] || 0);
  if (typeof policy?.quarantineAttempts === "number" && stageAttempts >= policy.quarantineAttempts) {
    return {
      streak,
      disposition: "infra_quarantined",
      until: new Date(now.getTime() + policy.quarantineMs).toISOString()
    };
  }
  if (streak >= policy.quarantineStreak) {
    return {
      streak,
      disposition: "infra_quarantined",
      until: new Date(now.getTime() + policy.quarantineMs).toISOString()
    };
  }
  if (typeof policy?.cooldownAttempts === "number" && stageAttempts >= policy.cooldownAttempts) {
    return {
      streak,
      disposition: "infra_cooldown",
      until: new Date(now.getTime() + policy.cooldownMs).toISOString()
    };
  }
  if (streak >= policy.cooldownStreak) {
    return {
      streak,
      disposition: "infra_cooldown",
      until: new Date(now.getTime() + policy.cooldownMs).toISOString()
    };
  }
  return { streak, disposition: "infra_blocked", until: null };
}

export async function runFactory(config) {
  const paths = initializeProject(config.rootIdentity ?? config.rootDir);
  pruneOperationalArtifacts(paths);
  rebuildNormalizedMemory(paths);
  rebuildHealthMetrics(paths);
  const stateStore = new StateStore(paths);
  const runtimeStateStore = new RuntimeStateStore(paths);
  const backlogStore = new BacklogStore(paths);
  backlogStore.migrate();
  const artifactStore = new ArtifactStore(paths);
  artifactStore.migrateLegacyRunArtifacts();
  reconcileStartupState(paths, backlogStore, artifactStore);
  const maxRetries = config.maxRetries ?? 3;
  const shutdownController = config.shutdownController ?? null;
  const MAX_CONSECUTIVE_FAILURES = 5;
  const liveOwnerId = config.mode === "live"
    ? `live-owner-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    : null;
  let liveOwnerLease = null;
  let ownerHeartbeatTimer = null;

  stateStore.update((state) => ({ ...state, goal: FACTORY_GOAL }));
  const initialState = stateStore.readState();

  if (config.mode === "live") {
    liveOwnerLease = acquireOwnerLock(paths, {
      ownerId: liveOwnerId,
      intervalMs: config.intervalMs,
      mode: config.mode
    });
    if (!liveOwnerLease.acquired) {
      appendRecoveryEvent(paths, {
        kind: "observer_only_start",
        requested_owner_id: liveOwnerId,
        active_owner_id: liveOwnerLease.current?.owner_id || null,
        reason: liveOwnerLease.reason
      });
      updateActiveRun(runtimeStateStore, {
        status: "observer_only",
        owner_id: liveOwnerLease.current?.owner_id || null,
        follow_url: `${config.observerBaseUrl}/follow`,
        last_error: null
      });
      rebuildHealthMetrics(paths);
      writeVerificationManifest(paths);
      writeRolloutGate(paths);
      return {
        mode: config.mode,
        observer_only: true,
        active_owner_id: liveOwnerLease.current?.owner_id || null,
        active_run: runtimeStateStore.readActiveRun(),
        state: stateStore.readState(),
        backlog_remaining: backlogStore.read().filter((item) => item.status === "ready").length
      };
    }
    ownerHeartbeatTimer = setInterval(() => {
      heartbeatOwnerLock(paths, {
        ownerId: liveOwnerId,
        token: liveOwnerLease.token
      });
      updateActiveRun(runtimeStateStore, {
        owner_id: liveOwnerId,
        heartbeat_at: new Date().toISOString()
      });
    }, liveOwnerLease.policy.heartbeatMs);
  }

  const resolvedTransport = config.mode === "live"
    ? resolvePreferredLiveTransportAdapter(paths, config.liveTransportAdapter)
    : null;

  const runner = config.mode === "live"
    ? assertLiveTransport(config.liveTransport ?? createLiveTransport({ rootDir: config.rootDir, model: config.model, agentTimeoutMs: config.agentTimeoutMs, openBrowser: config.openBrowser, livePluginPolicy: config.livePluginPolicy, liveTransportAdapter: resolvedTransport?.adapter, transportTimeouts: config.liveTransportTimeouts }))
    : new SimulateRunner({ rootDir: config.rootDir });

  const seenStageSessions = new Map();

  await runner.init();
  stateStore.update((state) => {
    clearActiveSessionState(state);
    state.mode_history.push({ ts: new Date().toISOString(), mode: config.mode });
    return state;
  });

  let executed = 0;
  let consecutiveFailures = 0;
  let activeInterruptHandler = null;

  if (shutdownController && typeof shutdownController.setHandler === "function") {
    shutdownController.setHandler(async (signal) => {
      if (typeof activeInterruptHandler === "function") {
        await activeInterruptHandler(signal);
      }
    });
  }

      const appendSuggestedActions = (backlogItem, currentRunId, actions) => {
    for (const action of actions ?? []) {
      if (!isLiveQueueEligible({ title: action, objective: action, category: "followup" })) {
        continue;
      }
      const backlogItems = backlogStore.read();
      const alreadyExists = backlogItems.some((item) => item.title === action);
      if (!alreadyExists) {
        backlogStore.append([{
          id: `IDEA-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 5)}`,
          title: action,
          status: "ready",
          priority: Math.max(1, (backlogItem.priority ?? 50) - 10),
          category: "followup",
          objective: action,
          source: currentRunId
        }]);
      }
    }
  };

  try {
      while (config.cycles === 0 || executed < config.cycles) {
        backlogStore.recoverExpiredLeases();
        backlogStore.recoverCooldowns();
        const currentState = stateStore.readState();
      const factoryStats = getFactoryStats(paths);
      const resumeCandidate = chooseResumeCandidate(paths, backlogStore, artifactStore);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stateStore.update((state) => {
          state.last_status = "halted";
          state.last_error = `Halted after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`;
          state.exit_reason = "halted_after_consecutive_failures";
          state.run_started_at = null;
          state.stage_started_at = null;
          state.active_agent = null;
          state.active_agent_attempt = null;
          state.active_agent_status = null;
          state.last_agent_heartbeat_at = null;
          return clearActiveSessionState(state);
        });
        break;
      }

      let backlogItem = resumeCandidate?.backlogItem ?? null;
      let currentRunId = resumeCandidate?.runId ?? null;
      let resuming = Boolean(resumeCandidate);
      let resumeFromStage = resumeCandidate?.resumeFromStage ?? "planner";
      const selectionPolicy = factoryStats.marketPolicy?.selection_policy || {};
      const readyStatuses = selectionPolicy.ready_statuses;
      const readyBacklogCount = backlogStore.read().filter((item) => readyStatuses.includes(item.status) && isLiveQueueEligible(item)).length;
      const minReadyBacklogDepth = selectionPolicy.min_ready_backlog_depth;
      const shouldReplenishBacklog = !resuming && readyBacklogCount < minReadyBacklogDepth;

      if (!backlogItem) {
        backlogItem = selectNextBacklogItem(backlogStore, factoryStats);
      }

      if (shouldReplenishBacklog || !backlogItem) {
        console.log(readyBacklogCount === 0
          ? "[Orchestrator] Backlog empty — spawning ideator..."
          : `[Orchestrator] Ready backlog below policy floor (${readyBacklogCount}/${minReadyBacklogDepth}) — spawning ideator...`);
        try {
          const ideaResponse = await callWithRetry(
            ({ attempt, retryNote }) => {
              const retrieval = buildIdeatorRetrieval(factoryStats);
              return runner.callAgent(
                "ideator",
                ideatorPrompt({ state: currentState, factoryStats, retrieval, retryNote }),
                {
                  attempt,
                  onSessionCreated: ({ sessionId, sessionUrl }) => {
                    stateStore.update((state) => {
                      state.active_agent = "ideator";
                      state.active_agent_attempt = attempt;
                      state.active_agent_status = "started";
                      state.stage_started_at = new Date().toISOString();
                      state.last_agent_heartbeat_at = new Date().toISOString();
                      state.active_session_id = sessionId;
                      state.active_session_url = sessionUrl;
                      return state;
                    });
                    updateActiveSession(paths, {
                      status: "active",
                      run_id: currentRunId,
                      agent: "ideator",
                      attempt,
                      session_id: sessionId,
                      session_url: sessionUrl,
                      ended_at: null
                    });
                    updateActiveRun(runtimeStateStore, {
                      owner_id: liveOwnerId,
                      run_id: currentRunId,
                      run_instance_id: currentRunId,
                      backlog_item_id: null,
                      stage: "ideator",
                      attempt,
                      session_id: sessionId,
                      session_url: sessionUrl,
                      follow_url: `${config.observerBaseUrl}/follow`
                    });
                  }
                }
              );
            },
            "Ideator", maxRetries, null,
            {
              onFinish: () => {
                stateStore.update((state) => {
                  state.active_agent = null;
                  state.active_agent_attempt = null;
                  state.active_agent_status = null;
                  state.stage_started_at = null;
                  state.last_agent_heartbeat_at = null;
                  return clearActiveSessionState(state);
                });
                closeActiveSession(paths, { run_id: currentRunId, agent: "ideator" });
                updateActiveRun(runtimeStateStore, { status: "idle" });
              }
            }
          );
          let idea;
          try {
            idea = extractRfJson(ideaResponse.text);
          } catch {
            if (!backlogItem) {
              console.log("[Orchestrator] Ideator failed to return valid JSON, retrying...");
              await new Promise((resolve) => setTimeout(resolve, 5000));
              continue;
            }
            idea = null;
          }
          if (idea?.title && idea?.objective) {
            backlogStore.append([{
              id: `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              title: idea.title,
              objective: idea.objective,
              priority: idea.priority ?? 75,
              category: idea.category ?? "strategy",
              status: "ready",
              source: "ideator",
              market_family: idea.market_family ?? "unknown",
              instrument_scope: idea.instrument_scope ?? null,
              timeframe: idea.timeframe ?? null,
              history_requirement: idea.history_requirement ?? null,
              data_source: idea.data_source ?? "unknown",
              data_requirement: idea.data_requirement ?? null
            }]);
            console.log(`[Orchestrator] Auto-generated idea: ${idea.title}`);
          } else if (!backlogItem) {
            console.log("[Orchestrator] Ideator returned incomplete data, waiting...");
            await new Promise((resolve) => setTimeout(resolve, 5000));
            continue;
          }
        } catch (error) {
          if (!backlogItem) throw error;
          console.log(`[Orchestrator] Ideator replenishment failed but current backlog item exists: ${error instanceof Error ? error.message : String(error)}`);
        }

        if (!backlogItem) {
          backlogItem = selectNextBacklogItem(backlogStore, factoryStats);
        }

        if (!backlogItem) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
      }

      currentRunId ||= runId();
      const logger = new Logger(paths, currentRunId);
      const before = artifactStore.snapshotWorkspaceHashes(paths.workspace);
      const fallbackRunState = resuming
        ? { ...createRunState(currentRunId, backlogItem.id), ...resumeCandidate.runState }
        : createRunState(currentRunId, backlogItem.id, { ownerId: liveOwnerId, runInstanceId: currentRunId });
      if (!resuming) {
        const runStatePath = artifactStore.writeRunState(currentRunId, fallbackRunState);
        registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "run_state", runStatePath);
      }

      logger.line(resuming ? "Resuming run" : "Starting run", {
        iteration: currentState.iteration + 1,
        backlog_item_id: backlogItem.id,
        mode: config.mode,
        resume_from_stage: resumeFromStage,
        run_id: currentRunId
      });

      backlogStore.lease(backlogItem.id, {
        leaseOwner: `factory-${process.pid}`,
        leaseExpiresAt: createLeaseExpiry(),
        runId: currentRunId,
        resumeFromStage
      });

      stateStore.update((state) => {
        state.last_run_id = currentRunId;
        state.last_status = "running";
        state.last_error = null;
        state.exit_reason = null;
        state.run_started_at = new Date().toISOString();
        state.stage_started_at = null;
        state.last_agent_heartbeat_at = null;
        return clearActiveSessionState(state);
      });
      updateActiveRun(runtimeStateStore, {
        owner_id: liveOwnerId,
        run_id: currentRunId,
        run_instance_id: currentRunId,
        backlog_item_id: backlogItem.id,
        stage: resuming ? resumeFromStage : "planner",
        attempt: null,
        session_id: null,
        session_url: null,
        follow_url: `${config.observerBaseUrl}/follow`,
        heartbeat_at: new Date().toISOString(),
        last_error: null,
        last_retry_note: null
      });

      let activeStage = resumeFromStage;
      let interruptWritten = false;
      let plan = resuming && STAGE_RANK[resumeFromStage] > STAGE_RANK.planner ? readRunJson(paths, currentRunId, "experiment-plan.json", null) : null;
      let executionResult = resuming && STAGE_RANK[resumeFromStage] > STAGE_RANK.executor ? readRunJson(paths, currentRunId, "execution-result.json", null) : null;
      let changedFiles = resuming && STAGE_RANK[resumeFromStage] > STAGE_RANK.executor ? readRunJson(paths, currentRunId, "changed-files.json", []) : null;
      let evaluation = resuming && STAGE_RANK[resumeFromStage] > STAGE_RANK.evaluator ? readRunJson(paths, currentRunId, "evaluation.json", null) : null;

      if (!plan) {
        const persistedPlan = readRunJson(paths, currentRunId, "experiment-plan.json", null);
        try {
          if (persistedPlan) {
            validatePlannerResult(persistedPlan, { rootDir: config.rootDir });
            plan = persistedPlan;
            if (STAGE_RANK[resumeFromStage] <= STAGE_RANK.planner) {
              resumeFromStage = "executor";
              const pendingPlannerHandoff = artifactStore.readHandoff(currentRunId, null);
              const runStateSnapshot = artifactStore.readRunState(currentRunId, fallbackRunState);
              if (
                pendingPlannerHandoff?.resume_from_stage === "planner" &&
                pendingPlannerHandoff.consumed === false &&
                pendingPlannerHandoff.resume_generation === runStateSnapshot?.resume_generation
              ) {
                const consumedPlannerHandoff = {
                  ...pendingPlannerHandoff,
                  consumed: true,
                  consumed_by: currentRunId,
                  consumed_at: new Date().toISOString(),
                  superseded_by: "persisted_experiment_plan"
                };
                artifactStore.writeHandoff(currentRunId, consumedPlannerHandoff);
                if (resumeCandidate?.handoff) {
                  resumeCandidate.handoff = consumedPlannerHandoff;
                }
                artifactStore.updateRunState(currentRunId, (state) => {
                  state.handoff_pending = false;
                  state.resume_from_stage = "executor";
                  state.updated_at = new Date().toISOString();
                  return state;
                }, fallbackRunState);
              }
            }
          }
        } catch {
          plan = null;
        }
      }

      let pendingHandoffNote = buildHandoffRetryNote(resumeCandidate?.handoff ?? null);

      const markHandoffConsumed = () => {
        if (!resumeCandidate?.handoff || resumeCandidate.handoff.consumed) return;
        const currentRunState = artifactStore.readRunState(currentRunId, fallbackRunState);
        if (resumeCandidate.handoff.resume_generation !== currentRunState?.resume_generation) {
          pendingHandoffNote = null;
          return;
        }
        const consumed = {
          ...resumeCandidate.handoff,
          consumed: true,
          consumed_by: currentRunId,
          consumed_at: new Date().toISOString()
        };
        artifactStore.writeHandoff(currentRunId, consumed);
        artifactStore.updateRunState(currentRunId, (state) => {
          state.handoff_pending = false;
          state.updated_at = new Date().toISOString();
          return state;
        }, fallbackRunState);
        pendingHandoffNote = null;
      };

      const maybeOpenFollowUrl = () => {
        if (!config.openBrowser) return;
        const followUrl = `${config.observerBaseUrl}/follow`;
        const runStateSnapshot = artifactStore.readRunState(currentRunId, fallbackRunState);
        if (!followUrl || runStateSnapshot?.observer_opened_at) {
          return;
        }

        const opened = (config.browserOpener || openBrowserUrl)(followUrl);
        artifactStore.updateRunState(currentRunId, (state) => {
          state.observer_opened_at = opened?.ok ? new Date().toISOString() : state.observer_opened_at;
          state.updated_at = new Date().toISOString();
          return state;
        }, fallbackRunState);
      };

      const writeHandoff = ({ stage, failureClass, errorMessage, attemptsUsed, safeInputs, producedArtifacts, signal = null }) => {
        const runStateSnapshot = artifactStore.updateRunState(currentRunId, (state) => {
          state.resume_generation = Number(state.resume_generation || 0) + 1;
          state.failure_class = failureClass;
          state.resume_from_stage = stage;
          state.handoff_pending = true;
          state.last_error = errorMessage;
          state.updated_at = new Date().toISOString();
          return state;
        }, fallbackRunState);
        const handoff = {
          schema_version: "handoff_v2",
          resume_from_stage: stage,
          resume_generation: runStateSnapshot.resume_generation,
          failure_class: failureClass,
          last_error: errorMessage,
          attempts_used: attemptsUsed,
          safe_inputs: safeInputs,
          produced_artifacts: producedArtifacts,
          consumed: false,
          consumed_by: null,
          created_at: new Date().toISOString(),
          ...(signal ? { signal } : {})
        };
        const handoffPath = artifactStore.writeHandoff(currentRunId, handoff);
        registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "handoff", handoffPath);
        backlogStore.markInfraBlocked(backlogItem.id, {
          runId: currentRunId,
          failureClass,
          resumeFromStage: stage,
          patch: { last_error: errorMessage }
        });
      };

      activeInterruptHandler = async (signal) => {
        if (interruptWritten) return;
        interruptWritten = true;
        const stage = activeStage || resumeFromStage || "planner";
        const errorMessage = `Interrupted by ${signal}.`;
        writeHandoff({
          stage,
          failureClass: "interruption",
          errorMessage,
          attemptsUsed: artifactStore.readRunState(currentRunId, fallbackRunState)?.attempt_counts?.[stage] ?? 0,
          safeInputs: {
            backlog_item_id: backlogItem.id,
            run_id: currentRunId,
            resume_from_stage: stage
          },
          producedArtifacts: flattenArtifactPaths(artifactStore.readRunState(currentRunId, fallbackRunState)?.artifact_paths || {}),
          signal
        });
        stateStore.update((state) => {
          state.last_status = "interrupted";
          state.last_error = errorMessage;
          state.exit_reason = signalExitReason(signal);
          state.run_started_at = null;
          state.stage_started_at = null;
          state.active_agent = null;
          state.active_agent_attempt = null;
          state.active_agent_status = null;
          state.last_agent_heartbeat_at = null;
          return clearActiveSessionState(state);
        });
        closeActiveSession(paths, { run_id: currentRunId, agent: stage });
        updateActiveRun(runtimeStateStore, {
          status: "interrupted",
          last_error: errorMessage
        });
        if (ownerHeartbeatTimer) {
          clearInterval(ownerHeartbeatTimer);
          ownerHeartbeatTimer = null;
        }
        if (liveOwnerLease?.acquired) {
          releaseOwnerLock(paths, {
            ownerId: liveOwnerId,
            token: liveOwnerLease.token,
            reason: signalExitReason(signal)
          });
          liveOwnerLease = null;
        }
        await runner.close();
      };

      const setAgentStageStart = (agentName) => ({ attempt }) => {
        activeStage = agentName;
        stateStore.update((state) => {
          state.active_agent = agentName;
          state.active_agent_attempt = attempt;
          state.active_agent_status = "started";
          state.stage_started_at = new Date().toISOString();
          state.last_agent_heartbeat_at = new Date().toISOString();
          return clearActiveSessionState(state);
        });
        updateActiveRun(runtimeStateStore, {
          owner_id: liveOwnerId,
          run_id: currentRunId,
          run_instance_id: currentRunId,
          backlog_item_id: backlogItem.id,
          stage: agentName,
          attempt,
          heartbeat_at: new Date().toISOString(),
          session_id: null,
          session_url: null,
          follow_url: `${config.observerBaseUrl}/follow`
        });
        setRunStageStatus(artifactStore, currentRunId, fallbackRunState, agentName, "running", { attempt });
        updateRunResumePoint(artifactStore, currentRunId, fallbackRunState, agentName);
        artifactStore.updateRunState(currentRunId, (state) => {
          state.attempt_counts[agentName] = attempt;
          state.updated_at = new Date().toISOString();
          return state;
        }, fallbackRunState);
      };

      const writeAgentHeartbeat = (agentName) => ({ attempt, attempts, status }) => {
        const heartbeatPath = artifactStore.writeRunArtifact(currentRunId, `${agentName.toLowerCase()}-heartbeat.json`, {
          agent: agentName,
          attempt,
          attempts,
          status,
          ts: new Date().toISOString()
        });
        registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${agentName}_heartbeats`, heartbeatPath, { append: true });
        stateStore.update((state) => {
          state.active_agent = agentName;
          state.active_agent_attempt = attempt;
          state.active_agent_status = status;
          state.last_agent_heartbeat_at = new Date().toISOString();
          return state;
        });
        updateActiveRun(runtimeStateStore, {
          owner_id: liveOwnerId,
          run_id: currentRunId,
          run_instance_id: currentRunId,
          backlog_item_id: backlogItem.id,
          stage: agentName,
          attempt,
          heartbeat_at: new Date().toISOString()
        });
      };

      const recordStageSession = (agentName) => ({ attempt, sessionId, sessionUrl }) => {
        const attemptKey = `${agentName}:${attempt}`;
        const priorOwner = seenStageSessions.get(sessionId);
        if (priorOwner && priorOwner !== attemptKey) {
          const reuseError = new Error(`Fresh-session invariant violated: ${sessionId} was already used by ${priorOwner} and cannot be reused by ${attemptKey}.`);
          reuseError.rf_failure_class = "transport_failure";
          reuseError.rf_transport_phase = "session_create";
          reuseError.rf_retryable = false;
          reuseError.rf_transport_adapter = typeof runner.getStatus === "function" ? runner.getStatus()?.transport_adapter ?? null : null;
          reuseError.rf_server_fingerprint = typeof runner.getStatus === "function" ? runner.getStatus()?.serverFingerprint ?? null : null;
          throw reuseError;
        }
        seenStageSessions.set(sessionId, attemptKey);
        const sessionPath = artifactStore.writeRunArtifact(currentRunId, `${agentName.toLowerCase()}-attempt-${attempt}-session.json`, {
          agent: agentName,
          attempt,
          session_id: sessionId,
          session_url: sessionUrl,
          recorded_at: new Date().toISOString()
        });
        registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${agentName}_sessions`, sessionPath, { append: true });
        stateStore.update((state) => {
          state.active_agent = agentName;
          state.active_agent_attempt = attempt;
          state.active_session_id = sessionId;
          state.active_session_url = sessionUrl;
          return state;
        });
        updateActiveSession(paths, {
          status: "active",
          run_id: currentRunId,
          agent: agentName,
          attempt,
          session_id: sessionId,
          session_url: sessionUrl,
          ended_at: null
        });
        updateActiveRun(runtimeStateStore, {
          owner_id: liveOwnerId,
          run_id: currentRunId,
          run_instance_id: currentRunId,
          backlog_item_id: backlogItem.id,
          stage: agentName,
          attempt,
          session_id: sessionId,
          session_url: sessionUrl,
          follow_url: `${config.observerBaseUrl}/follow`
        });
        if (agentName === "executor") {
          maybeOpenFollowUrl();
        }
        artifactStore.updateRunState(currentRunId, (state) => {
          state.current_stage_session = {
            stage: agentName,
            attempt,
            session_id: sessionId,
            session_url: sessionUrl,
            recorded_at: new Date().toISOString()
          };
          state.updated_at = new Date().toISOString();
          return state;
        }, fallbackRunState);
      };

      const persistStageError = (agentName, stageInputBuilder) => ({ attempt, attempts, error, message }) => {
        const errorPayload = {
          agent: agentName,
          attempt,
          attempts,
          failure_class: classifyFailureClass(error),
          transport_phase: error?.rf_transport_phase ?? null,
          retryable: error?.rf_retryable ?? null,
          timeout_bucket: error?.rf_timeout_bucket ?? null,
          transport_adapter: error?.rf_transport_adapter ?? null,
          server_fingerprint: error?.rf_server_fingerprint ?? null,
          error: serializeError(error),
          message,
          recorded_at: new Date().toISOString(),
          input_snapshot: stageInputBuilder?.() ?? null
        };
        const errorPath = artifactStore.writeStageError(currentRunId, agentName, attempt, errorPayload);
        registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${agentName}_stage_errors`, errorPath, { append: true });
        const gate = buildStageGateResult({
          runId: currentRunId,
          stage: agentName,
          attempt,
          decision: "denied",
          validator: "stage_gate",
          evidencePaths: [artifactStore.relativeToRoot(errorPath)],
          reason: message
        });
        const stageGatePath = artifactStore.writeStageGate(currentRunId, agentName, attempt, gate);
        registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${agentName}_stage_gates`, stageGatePath, { append: true });
        const existingGates = artifactStore.readGateResults(currentRunId, { schema_version: "stage_gates_v1", run_id: currentRunId, stages: [] });
        existingGates.stages = [...(existingGates.stages || []), { ...gate, gate_path: artifactStore.relativeToRoot(stageGatePath) }];
        existingGates.updated_at = new Date().toISOString();
        artifactStore.writeGateResults(currentRunId, existingGates);
        setRunStageStatus(artifactStore, currentRunId, fallbackRunState, agentName, "failed", { attempt, failure_class: errorPayload.failure_class });
      };

      const executeStructuredStage = async ({
        stage,
        label,
        buildStageAttempt,
        validate,
        onSuccess,
        handoffStage = false
      }) => {
        let activeAttemptOrdinal = artifactStore.readRunState(currentRunId, fallbackRunState)?.attempt_counts?.[stage] ?? 0;
        const stageInputBuilder = () => buildStageAttempt({ attempt: activeAttemptOrdinal, retryNote: null }).stageInput;
        return callWithRetry(
          async ({ attempt: retryAttempt, retryNote }) => {
            let activeRetryNote = retryNote;
            const handoffUsedThisAttempt = !activeRetryNote && handoffStage && pendingHandoffNote;
            if (handoffUsedThisAttempt) {
              activeRetryNote = pendingHandoffNote;
            }

            activeAttemptOrdinal = allocateStageAttemptOrdinal(artifactStore, currentRunId, fallbackRunState, stage, {
              ownerId: liveOwnerId,
              runInstanceId: currentRunId
            });
            setAgentStageStart(stage)({ attempt: activeAttemptOrdinal });

            const { promptText, stageInput } = buildStageAttempt({ attempt: activeAttemptOrdinal, retryNote: activeRetryNote });
            const inputPath = artifactStore.writeStageInput(currentRunId, stage, activeAttemptOrdinal, stageInput);
            registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${stage}_stage_inputs`, inputPath, { append: true });
            enforcePromptBudget(stage, promptText, config, logger);
            const promptPath = artifactStore.writeStagePrompt(currentRunId, stage, activeAttemptOrdinal, promptText);
            registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${stage}_stage_prompts`, promptPath, { append: true });

            const response = await runner.callAgent(stage, promptText, {
              attempt: activeAttemptOrdinal,
              onSessionCreated: ({ sessionId, sessionUrl }) => recordStageSession(stage)({ attempt: activeAttemptOrdinal, sessionId, sessionUrl })
            });

            if (handoffUsedThisAttempt) {
              markHandoffConsumed();
            }

            const responsePath = artifactStore.writeStageResponse(currentRunId, stage, activeAttemptOrdinal, response.text);
            registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${stage}_stage_responses`, responsePath, { append: true });

            const parsed = extractRfJson(response.text);
            if (typeof validate === "function") {
              validate(parsed);
            }

            const validatedPath = artifactStore.writeStageValidated(currentRunId, stage, activeAttemptOrdinal, parsed);
            registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${stage}_stage_validated`, validatedPath, { append: true });
            const gateEvidencePaths = [artifactStore.relativeToRoot(validatedPath)];
            if (stage === "executor") {
              gateEvidencePaths.push(...(Array.isArray(parsed?.provenance?.result_artifacts) ? parsed.provenance.result_artifacts : []));
            }
            if (stage === "evaluator") {
              gateEvidencePaths.push(...(Array.isArray(parsed?.verification?.artifacts_checked) ? parsed.verification.artifacts_checked : []));
            }
            const gate = buildStageGateResult({
              runId: currentRunId,
              stage,
              attempt: activeAttemptOrdinal,
              decision: "allowed",
              validator: "stage_gate",
              evidencePaths: gateEvidencePaths
            });
            const stageGatePath = artifactStore.writeStageGate(currentRunId, stage, activeAttemptOrdinal, gate);
            registerArtifactPath(artifactStore, currentRunId, fallbackRunState, `${stage}_stage_gates`, stageGatePath, { append: true });
            const existingGates = artifactStore.readGateResults(currentRunId, { schema_version: "stage_gates_v1", run_id: currentRunId, stages: [] });
            existingGates.stages = [...(existingGates.stages || []), { ...gate, gate_path: artifactStore.relativeToRoot(stageGatePath) }];
            existingGates.updated_at = new Date().toISOString();
            artifactStore.writeGateResults(currentRunId, existingGates);
            return { response, parsed };
          },
          label,
          maxRetries,
          logger,
          {
            onError: persistStageError(stage, stageInputBuilder),
            onHeartbeat: ({ attempts, status }) => writeAgentHeartbeat(stage)({ attempt: activeAttemptOrdinal, attempts, status })
          }
        ).then(async (result) => {
          setRunStageStatus(artifactStore, currentRunId, fallbackRunState, stage, "completed", {
            attempt: artifactStore.readRunState(currentRunId, fallbackRunState)?.attempt_counts?.[stage] ?? 0
          });
          updateRunResumePoint(artifactStore, currentRunId, fallbackRunState, nextStageAfter(stage));
          artifactStore.updateRunState(currentRunId, (state) => {
            state.last_completed_stage = stage;
            state.current_stage = null;
            state.current_stage_attempt = null;
            state.current_stage_session = null;
            state.updated_at = new Date().toISOString();
            return state;
          }, fallbackRunState);
          if (typeof onSuccess === "function") {
            await onSuccess(result);
          }
          return result;
        });
      };

      try {
        if (STAGE_RANK[resumeFromStage] <= STAGE_RANK.planner) {
          const planResponse = await executeStructuredStage({
            stage: "planner",
            label: "Planner",
            handoffStage: resumeFromStage === "planner",
            buildStageAttempt: ({ retryNote }) => {
              const retrieval = buildPlannerRetrieval(factoryStats, backlogItem);
              return {
                promptText: plannerPrompt({ goal: FACTORY_GOAL, backlogItem, state: { ...currentState, market_policy: factoryStats.marketPolicy }, retrieval, retryNote }),
                stageInput: { goal: FACTORY_GOAL, backlogItem, retrieval, retryNote }
              };
            },
            validate: (parsed) => {
              validatePlannerResult(parsed, { rootDir: config.rootDir });
            },
            onSuccess: ({ response, parsed }) => {
              const responsePath = artifactStore.writeRunArtifact(currentRunId, "planner-response.txt", response.text, { asJson: false });
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "planner_response", responsePath);
              const planPath = artifactStore.writeRunArtifact(currentRunId, "experiment-plan.json", parsed);
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "experiment_plan", planPath);
              const experimentPlanPath = artifactStore.writeExperimentPlan(parsed.experiment_id, parsed);
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "experiment_plan_index", experimentPlanPath);
              plan = parsed;
              logger.line("Planner completed", { experiment_id: parsed.experiment_id });
            }
          });
          plan = planResponse.parsed;
          resumeFromStage = "executor";
        }

        if (STAGE_RANK[resumeFromStage] <= STAGE_RANK.executor) {
          if (!plan) throw new Error("Resume requested executor without a persisted plan.");
          const executionResponse = await executeStructuredStage({
            stage: "executor",
            label: "Executor",
            handoffStage: resumeFromStage === "executor",
            buildStageAttempt: ({ retryNote }) => {
              const retrieval = buildExecutorRetrieval(factoryStats, plan);
              return {
                promptText: executorPrompt({ goal: FACTORY_GOAL, plan, state: currentState, retrieval, retryNote }),
                stageInput: { goal: FACTORY_GOAL, plan, retrieval, retryNote }
              };
            },
            validate: (parsed) => {
              validateExecutionResult(parsed);
              validateExecutionArtifacts(config.rootDir, parsed);
            },
            onSuccess: ({ response, parsed }) => {
              const responsePath = artifactStore.writeRunArtifact(currentRunId, "executor-response.txt", response.text, { asJson: false });
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "executor_response", responsePath);
              const executionPath = artifactStore.writeRunArtifact(currentRunId, "execution-result.json", parsed);
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "execution_result", executionPath);
              executionResult = parsed;
              const after = artifactStore.snapshotWorkspaceHashes(paths.workspace);
              changedFiles = artifactStore.diffSnapshots(before, after);
              const changedPath = artifactStore.writeRunArtifact(currentRunId, "changed-files.json", changedFiles);
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "changed_files", changedPath);
              logger.line("Executor completed", { status: parsed.status });
            }
          });
          executionResult = executionResponse.parsed;
          resumeFromStage = "evaluator";
        }

        if (STAGE_RANK[resumeFromStage] <= STAGE_RANK.evaluator) {
          if (!plan || !executionResult) throw new Error("Resume requested evaluator without persisted execution context.");
          changedFiles ||= readRunJson(paths, currentRunId, "changed-files.json", []);
          const evaluationResponse = await executeStructuredStage({
            stage: "evaluator",
            label: "Evaluator",
            handoffStage: resumeFromStage === "evaluator",
            buildStageAttempt: ({ retryNote }) => {
              const retrieval = buildEvaluatorRetrieval(factoryStats, plan);
              return {
                promptText: evaluatorPrompt({ goal: FACTORY_GOAL, plan, executionResult, changedFiles, state: currentState, retrieval, retryNote }),
                stageInput: { goal: FACTORY_GOAL, plan, executionResult, changedFiles, retrieval, retryNote }
              };
            },
            validate: (parsed) => {
              validateEvaluationResult(parsed, { mode: config.mode, rootDir: config.rootDir });
            },
            onSuccess: ({ response, parsed }) => {
              const responsePath = artifactStore.writeRunArtifact(currentRunId, "evaluator-response.txt", response.text, { asJson: false });
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "evaluator_response", responsePath);
              const evaluationPath = artifactStore.writeRunArtifact(currentRunId, "evaluation.json", parsed);
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "evaluation", evaluationPath);
              evaluation = parsed;
              logger.line("Evaluator completed", { verdict: parsed.verdict, evidence_score: parsed.evidence_score });
            }
          });
          evaluation = evaluationResponse.parsed;
          resumeFromStage = "summarizer";
        }

        if (STAGE_RANK[resumeFromStage] <= STAGE_RANK.summarizer) {
          if (!plan || !executionResult || !evaluation) throw new Error("Resume requested summarizer without persisted evaluation context.");
          const summarizerResponse = await executeStructuredStage({
            stage: "summarizer",
            label: "Summarizer",
            handoffStage: resumeFromStage === "summarizer",
            buildStageAttempt: ({ retryNote }) => {
              const retrieval = buildSummarizerRetrieval(factoryStats, plan, evaluation);
              return {
                promptText: summarizerPrompt({ goal: FACTORY_GOAL, plan, executionResult, evaluation, state: currentState, retrieval, retryNote }),
                stageInput: { goal: FACTORY_GOAL, plan, executionResult, evaluation, retrieval, retryNote }
              };
            },
            validate: (parsed) => {
              validateSummaryResult(parsed);
            },
            onSuccess: ({ response, parsed }) => {
              const responsePath = artifactStore.writeRunArtifact(currentRunId, "summarizer-response.txt", response.text, { asJson: false });
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "summarizer_response", responsePath);
              const summaryPathJson = artifactStore.writeRunArtifact(currentRunId, "summary.json", parsed);
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "summary_json", summaryPathJson);
              const summaryMarkdown = buildRunSummary({ runId: currentRunId, mode: config.mode, backlogItem, plan, executionResult, evaluation, summary: parsed });
              const summaryPath = artifactStore.writeSummary(currentRunId, summaryMarkdown);
              registerArtifactPath(artifactStore, currentRunId, fallbackRunState, "summary_markdown", summaryPath);

              const indexEntry = evidenceEntry({ runId: currentRunId, mode: config.mode, backlogItem, plan, executionResult, evaluation, summaryPath: artifactStore.relativeToRoot(summaryPath) });
              artifactStore.updateEvidenceIndex(indexEntry);

              const runStateSnapshot = artifactStore.readRunState(currentRunId, fallbackRunState) ?? fallbackRunState;
              const lessonEntries = buildCanonicalLessonEntries({
                runId: currentRunId,
                experimentId: plan.experiment_id,
                backlogItemId: backlogItem.id,
                iteration: currentState.iteration + 1,
                mode: config.mode,
                verdict: evaluation.verdict,
                evidenceScore: evaluation.evidence_score,
                metrics: evaluation.metrics ?? executionResult.metrics_observed,
                summaryPath: artifactStore.relativeToRoot(summaryPath),
                artifactPaths: flattenArtifactPaths(runStateSnapshot.artifact_paths || {}),
                strategyFamily: plan.strategy_type ?? null,
                marketFamily: backlogItem.market_family ?? null,
                assetScope: backlogItem.instrument_scope ?? null,
                timeframe: backlogItem.timeframe ?? null,
                keyLessons: parsed.key_lessons,
                nextActions: parsed.next_actions
              });
              appendCanonicalLessons(paths, lessonEntries);
              rebuildNormalizedMemory(paths);

              const firstLesson = parsed.key_lessons?.[0] ? summarizeLessonForDigest(parsed.key_lessons[0]) : "N/A";
              const iterationEntry = `Iter ${currentState.iteration + 1}: ${plan.experiment_id} | Verdict: ${evaluation.verdict} | Sharpe: ${evaluation.metrics?.sharpe_oos ?? evaluation.metrics?.sharpe ?? "N/A"} | Key: ${firstLesson.substring(0, 80)}`;
              appendLine(paths.iterationDigest, iterationEntry, paths);

              const researchStatus = researchStatusFromEvaluation(evaluation);
              backlogStore.completeResearch(backlogItem.id, {
                status: researchStatus,
                lastFailureClass: researchStatus === "research_complete" ? null : "research_failure",
                patch: {
                  completed_at: new Date().toISOString(),
                  experiment_id: plan.experiment_id,
                  last_verdict: evaluation.verdict,
                  last_evidence_score: evaluation.evidence_score
                }
              });
              appendSuggestedActions(backlogItem, currentRunId, evaluation.next_backlog_actions ?? []);
              artifactStore.updateRunState(currentRunId, (state) => {
                state.resume_from_stage = null;
                state.failure_class = researchStatus === "research_complete" ? null : "research_failure";
                state.handoff_pending = false;
                state.updated_at = new Date().toISOString();
                return state;
              }, fallbackRunState);
              const consumedHandoff = artifactStore.readHandoff(currentRunId, null);
              const consumedRunStateSnapshot = artifactStore.readRunState(currentRunId, fallbackRunState);
              if (
                consumedHandoff &&
                consumedHandoff.consumed === false &&
                consumedHandoff.resume_generation === consumedRunStateSnapshot?.resume_generation
              ) {
                artifactStore.writeHandoff(currentRunId, {
                  ...consumedHandoff,
                  consumed: true,
                  consumed_by: currentRunId,
                  consumed_at: new Date().toISOString()
                });
              }
            }
          });
          logger.line("Summarizer completed", { run_id: currentRunId, verdict: evaluation.verdict });
          void summarizerResponse;
        }

        consecutiveFailures = 0;
        stateStore.update((state) => {
          state.iteration += 1;
          state.last_status = "idle";
          state.last_error = null;
          state.exit_reason = "completed_cycle";
          state.run_started_at = null;
          state.stage_started_at = null;
          state.active_agent = null;
          state.active_agent_attempt = null;
          state.active_agent_status = null;
          state.last_agent_heartbeat_at = null;
          return clearActiveSessionState(state);
        });
        closeActiveSession(paths, { run_id: currentRunId, agent: "summarizer" });
        updateActiveRun(runtimeStateStore, { status: "idle" });

        executed += 1;
        logger.line("Run completed", { run_id: currentRunId, verdict: evaluation?.verdict ?? null, iteration: currentState.iteration + 1 });
        rebuildHealthMetrics(paths);
      } catch (runError) {
        const failureClass = classifyFailureClass(runError);
        const stage = activeStage || resumeFromStage || "planner";
        const errorMsg = runError instanceof Error ? runError.message : String(runError);
        const attemptsUsed = runError?.rf_attempts_used ?? artifactStore.readRunState(currentRunId, fallbackRunState)?.attempt_counts?.[stage] ?? 0;
        writeHandoff({
          stage,
          failureClass,
          errorMessage: errorMsg,
          attemptsUsed,
          safeInputs: {
            backlog_item_id: backlogItem.id,
            run_id: currentRunId,
            resume_from_stage: stage,
            experiment_id: plan?.experiment_id ?? null
          },
          producedArtifacts: flattenArtifactPaths(artifactStore.readRunState(currentRunId, fallbackRunState)?.artifact_paths || {})
        });

        consecutiveFailures++;
        const now = new Date();
        const poisonDecision = poisonDispositionForFailure(
          artifactStore.readRunState(currentRunId, fallbackRunState),
          stage,
          failureClass,
          config.poisonedRunPolicy ?? { cooldownStreak: 3, quarantineStreak: 5, cooldownMs: 900000, quarantineMs: 86400000 },
          now
        );
        artifactStore.updateRunState(currentRunId, (state) => {
          state.poison_streak_count = poisonDecision.streak;
          state.poison_stage = stage;
          state.poison_failure_class = failureClass;
          state.updated_at = now.toISOString();
          return state;
        }, fallbackRunState);
        if (poisonDecision.disposition === "infra_cooldown") {
          backlogStore.markInfraCooldown(backlogItem.id, {
            runId: currentRunId,
            failureClass,
            resumeFromStage: stage,
            cooldownUntil: poisonDecision.until,
            patch: { last_error: errorMsg }
          });
        } else if (poisonDecision.disposition === "infra_quarantined") {
          backlogStore.markInfraQuarantined(backlogItem.id, {
            runId: currentRunId,
            failureClass,
            resumeFromStage: stage,
            quarantineUntil: poisonDecision.until,
            patch: { last_error: errorMsg }
          });
        }
        stateStore.update((state) => {
          state.last_status = failureClass === "interruption" ? "interrupted" : "error";
          state.last_error = errorMsg;
          state.exit_reason = failureClass === "interruption" ? signalExitReason() : "run_failed";
          state.iteration += 1;
          state.run_started_at = null;
          state.stage_started_at = null;
          state.active_agent = null;
          state.active_agent_attempt = null;
          state.active_agent_status = null;
          state.last_agent_heartbeat_at = null;
          return clearActiveSessionState(state);
        });
        closeActiveSession(paths, { run_id: currentRunId, agent: stage });
        updateActiveRun(runtimeStateStore, {
          status: failureClass === "interruption" ? "interrupted" : "error",
          last_error: errorMsg
        });
        logger.line("Run failed", { run_id: currentRunId, error: errorMsg, consecutive_failures: consecutiveFailures, failure_class: failureClass });
        executed += 1;
        rebuildHealthMetrics(paths);

        if (failureClass === "orchestrator_bug") {
          throw runError;
        }
      } finally {
        activeInterruptHandler = null;
      }

      if (config.cycles === 0 || executed < config.cycles) {
        await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
      }
    }

    if (config.cycles !== 0 && executed >= config.cycles) {
      stateStore.update((state) => {
        if (state.last_status === "idle") {
          state.exit_reason = "cycles_exhausted";
        }
        return state;
      });
    }
  } finally {
    rebuildHealthMetrics(paths);
    writeVerificationManifest(paths);
    writeRolloutGate(paths);
    if (ownerHeartbeatTimer) {
      clearInterval(ownerHeartbeatTimer);
      ownerHeartbeatTimer = null;
    }
    updateActiveRun(runtimeStateStore, { status: "idle" });
    if (liveOwnerLease?.acquired) {
      releaseOwnerLock(paths, {
        ownerId: liveOwnerId,
        token: liveOwnerLease.token,
        reason: "run_factory_finally"
      });
      liveOwnerLease = null;
    }
    if (shutdownController && typeof shutdownController.setHandler === "function") {
      shutdownController.setHandler(null);
    }
    await runner.close();
  }

  return {
    mode: config.mode,
    cycles_executed: executed,
    state: stateStore.readState(),
    backlog_remaining: backlogStore.read().filter((item) => item.status === "ready").length
  };
}

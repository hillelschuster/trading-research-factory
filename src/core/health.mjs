import fs from "fs";
import path from "path";
import { DEFAULT_STAGE_PROMPT_BUDGETS } from "./constants.mjs";
import { readJson, writeJsonAtomic } from "./fs-utils.mjs";
import { readLeaderboardEntries } from "./leaderboard-store.mjs";
import { readLatestTransportBakeoff } from "./verification.mjs";

const STAGES = ["planner", "executor", "evaluator", "summarizer"];

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function pushStageBytes(acc, stage, bytes) {
  acc[stage] ||= { count: 0, avg_bytes: 0, max_bytes: 0, last_bytes: 0 };
  const nextCount = acc[stage].count + 1;
  acc[stage].avg_bytes = Math.round(((acc[stage].avg_bytes * acc[stage].count) + bytes) / nextCount);
  acc[stage].count = nextCount;
  acc[stage].max_bytes = Math.max(acc[stage].max_bytes, bytes);
  acc[stage].last_bytes = bytes;
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return readJson(filePath, fallback);
}

function listRunDirs(paths) {
  if (!fs.existsSync(paths.runs)) return [];
  return fs.readdirSync(paths.runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("RUN-"))
    .map((entry) => path.join(paths.runs, entry.name));
}

function buildPromptByteStats(runDirs) {
  const stats = Object.fromEntries(STAGES.map((stage) => [stage, { count: 0, avg_bytes: 0, max_bytes: 0, last_bytes: 0 }]));

  for (const runDir of runDirs) {
    for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(planner|executor|evaluator|summarizer)-attempt-\d+$/);
      if (!match) continue;
      const stage = match[1];
      const promptPath = path.join(runDir, entry.name, "stage-prompt.txt");
      if (!fs.existsSync(promptPath)) continue;
      const bytes = fs.statSync(promptPath).size;
      pushStageBytes(stats, stage, bytes);
    }
  }

  return stats;
}

function buildPromptBudgetBreaches(runDirs) {
  const breaches = Object.fromEntries(Object.keys(DEFAULT_STAGE_PROMPT_BUDGETS).map((stage) => [stage, 0]));

  for (const runDir of runDirs) {
    for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(planner|executor|evaluator|summarizer)-attempt-\d+$/);
      if (!match) continue;
      const stage = match[1];
      const promptPath = path.join(runDir, entry.name, "stage-prompt.txt");
      if (!fs.existsSync(promptPath)) continue;
      if (fs.statSync(promptPath).size > DEFAULT_STAGE_PROMPT_BUDGETS[stage]) {
        breaches[stage] += 1;
      }
    }
  }

  return breaches;
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildSessionReuseStats(runDirs) {
  let totalSessionRecords = 0;
  let reusedSessionRecords = 0;
  for (const runDir of runDirs) {
    const sessionIds = [];
    for (const fileName of fs.readdirSync(runDir)) {
      if (!fileName.endsWith("-session.json")) continue;
      const payload = readJsonIfExists(path.join(runDir, fileName), null);
      if (payload?.session_id) sessionIds.push(payload.session_id);
    }
    totalSessionRecords += sessionIds.length;
    reusedSessionRecords += sessionIds.length - new Set(sessionIds).size;
  }
  return {
    total_session_records: totalSessionRecords,
    reused_session_records: reusedSessionRecords
  };
}

function buildTransportRetryStats(runDirs) {
  let transportFailures = 0;
  let recoveredTransportFailures = 0;

  for (const runDir of runDirs) {
    const recoveredStages = new Set();
    for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(planner|executor|evaluator|summarizer)-attempt-(\d+)$/);
      if (!match) continue;
      const stage = match[1];
      const errorPath = path.join(runDir, entry.name, "stage-error.json");
      const validatedPath = path.join(runDir, entry.name, "stage-validated.json");
      if (fs.existsSync(errorPath)) {
        const errorPayload = readJsonIfExists(errorPath, null);
        if (errorPayload?.failure_class === "transport_failure") {
          transportFailures += 1;
        }
      }
      if (fs.existsSync(validatedPath)) {
        recoveredStages.add(stage);
      }
    }

    for (const stage of recoveredStages) {
      const stageTransportErrors = fs.readdirSync(runDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${stage}-attempt-`))
        .map((entry) => readJsonIfExists(path.join(runDir, entry.name, "stage-error.json"), null))
        .filter((payload) => payload?.failure_class === "transport_failure");
      if (stageTransportErrors.length > 0) {
        recoveredTransportFailures += 1;
      }
    }
  }

  return {
    transport_failures: transportFailures,
    recovered_after_retry: recoveredTransportFailures,
    recovery_rate: rate(recoveredTransportFailures, transportFailures)
  };
}

function buildTransportFailureBreakdown(runDirs) {
  const byPhase = {};
  const byAdapter = {};

  for (const runDir of runDirs) {
    for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const errorPayload = readJsonIfExists(path.join(runDir, entry.name, "stage-error.json"), null);
      if (errorPayload?.failure_class !== "transport_failure") continue;

      const phase = errorPayload.transport_phase || "unknown";
      const adapter = errorPayload.transport_adapter || "unknown";
      byPhase[phase] = (byPhase[phase] || 0) + 1;
      byAdapter[adapter] ||= {};
      byAdapter[adapter][phase] = (byAdapter[adapter][phase] || 0) + 1;
    }
  }

  return {
    by_phase: byPhase,
    by_adapter: byAdapter
  };
}

function buildResumableRunStats(runDirs) {
  let totalHandoffs = 0;
  let recovered = 0;

  for (const runDir of runDirs) {
    const handoffPath = path.join(runDir, "handoff.json");
    if (!fs.existsSync(handoffPath)) continue;
    totalHandoffs += 1;
    const handoff = readJsonIfExists(handoffPath, null);
    if (handoff?.consumed === true) recovered += 1;
  }

  return {
    handoff_runs: totalHandoffs,
    recovered_runs: recovered,
    recovery_rate: rate(recovered, totalHandoffs)
  };
}

function buildMemoryValidationStats(paths) {
  if (!fs.existsSync(paths.memoryQuarantine)) {
    return { repair_reports: 0, total_bad_fragments: 0 };
  }

  let repairReports = 0;
  let badFragments = 0;
  for (const fileName of fs.readdirSync(paths.memoryQuarantine)) {
    if (!fileName.startsWith("repair-report-")) continue;
    repairReports += 1;
    const payload = readJsonIfExists(path.join(paths.memoryQuarantine, fileName), null);
    badFragments += payload?.bad_fragments ?? 0;
  }

  return {
    repair_reports: repairReports,
    total_bad_fragments: badFragments
  };
}

function buildOwnerLockEventStats(paths) {
  const events = parseJsonl(paths.recoveryLog);
  return {
    observer_only_starts: events.filter((event) => event.kind === "observer_only_start").length,
    owner_lock_takeovers: events.filter((event) => event.kind === "owner_lock_takeover").length,
    owner_lock_denials: events.filter((event) => event.kind === "owner_lock_denied").length
  };
}

function buildGateStats(runDirs) {
  let deniedStageGates = 0;
  let deniedFalseExecutedClaims = 0;
  let deniedGenericSummaries = 0;

  for (const runDir of runDirs) {
    const gates = readJsonIfExists(path.join(runDir, "gate-results.json"), { stages: [] });
    for (const gate of Array.isArray(gates?.stages) ? gates.stages : []) {
      if (gate.decision !== "denied") continue;
      deniedStageGates += 1;
      const reason = String(gate.reason || "");
      if (/reported 'executed'|canonical execution provenance|WFA result artifacts|observed WFA metrics/i.test(reason)) {
        deniedFalseExecutedClaims += 1;
      }
      if (/generic boilerplate/i.test(reason)) {
        deniedGenericSummaries += 1;
      }
    }
  }

  return {
    denied_stage_gates: deniedStageGates,
    denied_false_executed_claims: deniedFalseExecutedClaims,
    denied_generic_summaries: deniedGenericSummaries
  };
}

function buildOperationalArtifactStats(paths) {
  const recoveryLogLines = fs.existsSync(paths.recoveryLog)
    ? fs.readFileSync(paths.recoveryLog, "utf8").split("\n").filter(Boolean).length
    : 0;
  const verificationFiles = fs.existsSync(paths.verification)
    ? fs.readdirSync(paths.verification, { withFileTypes: true }).filter((entry) => entry.isFile()).length
    : 0;
  return {
    recovery_log_lines: recoveryLogLines,
    verification_files: verificationFiles
  };
}

function buildAssetTimeframeDistribution(evidence) {
  const distribution = {};
  for (const entry of evidence.filter((item) => item?.mode === "live")) {
    const key = `${entry.market_family || "unknown"}|${entry.asset_scope || "unknown"}|${entry.timeframe || "unknown"}`;
    distribution[key] = (distribution[key] || 0) + 1;
  }
  return distribution;
}

function buildExecutorCompletionStats(runDirs) {
  let totalExecutorGates = 0;
  let allowedExecutorGates = 0;

  for (const runDir of runDirs) {
    const gates = readJsonIfExists(path.join(runDir, "gate-results.json"), { stages: [] });
    for (const gate of Array.isArray(gates?.stages) ? gates.stages : []) {
      if (gate.stage !== "executor") continue;
      totalExecutorGates += 1;
      if (gate.decision === "allowed") {
        allowedExecutorGates += 1;
      }
    }
  }

  return {
    total_executor_stage_gates: totalExecutorGates,
    allowed_executor_stage_gates: allowedExecutorGates,
    completion_rate: rate(allowedExecutorGates, totalExecutorGates)
  };
}

function buildRecentEvidenceStats(evidence, nowMs = Date.now(), windowMs = 24 * 60 * 60 * 1000) {
  const liveResearchEvidence = evidence.filter((entry) => entry?.mode === "live" && entry?.evidence_kind === "research");
  const recent = liveResearchEvidence.filter((entry) => {
    const ts = entry?.recorded_at ? Date.parse(entry.recorded_at) : NaN;
    return Number.isFinite(ts) && ts >= (nowMs - windowMs);
  });

  return {
    live_research_entries_total: liveResearchEvidence.length,
    live_research_entries_last_24h: recent.length
  };
}

function buildMarketFamilyPolicyComparison(evidence, marketPolicy) {
  const counts = {};
  for (const entry of evidence.filter((item) => item?.mode === "live" && item?.evidence_kind === "research")) {
    const key = entry.market_family || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }

  return (Array.isArray(marketPolicy?.market_family_priorities) ? marketPolicy.market_family_priorities : []).map((item) => ({
    market_family: item.market_family,
    priority: item.priority,
    live_research_entries: counts[item.market_family] || 0
  }));
}

function buildResearchVsInfraStats(backlog, evidence) {
  const infraBlockedItems = backlog.filter((item) => ["infra_blocked", "infra_cooldown", "infra_quarantined"].includes(item?.status)).length;
  const researchBearingRuns = evidence.filter((entry) => entry?.mode === "live" && entry?.evidence_kind === "research").length;
  return {
    infra_blocked_like_items: infraBlockedItems,
    research_bearing_live_runs: researchBearingRuns,
    blocked_to_research_ratio: rate(infraBlockedItems, researchBearingRuns || 1)
  };
}

function buildPlanScopeJustificationStats(paths) {
  if (!fs.existsSync(paths.experiments)) {
    return { total_plans: 0, plans_with_explicit_scope_justification: 0, percent: null };
  }

  const plans = fs.readdirSync(paths.experiments)
    .filter((fileName) => fileName.endsWith(".plan.json"))
    .map((fileName) => readJsonIfExists(path.join(paths.experiments, fileName), null))
    .filter(Boolean);
  const qualifying = plans.filter((plan) => (
    typeof plan.market_family === "string" && plan.market_family.trim() &&
    ((typeof plan.instrument_scope === "string" && plan.instrument_scope.trim()) || (typeof plan.instrument_selection_rule === "string" && plan.instrument_selection_rule.trim())) &&
    typeof plan.timeframe === "string" && plan.timeframe.trim() &&
    typeof plan.scope_selection_rationale === "string" && plan.scope_selection_rationale.trim() &&
    plan.historical_depth_requirement?.target &&
    plan.historical_depth_requirement?.justification &&
    plan.source_plan?.primary_source_family
  )).length;

  return {
    total_plans: plans.length,
    plans_with_explicit_scope_justification: qualifying,
    percent: rate(qualifying, plans.length)
  };
}

export function rebuildHealthMetrics(paths) {
  const backlog = readJson(paths.backlog, []);
  const leaderboard = readLeaderboardEntries(paths);
  const evidence = readJson(paths.evidenceIndex, []);
  const marketPolicy = readJson(paths.marketPolicy, {});
  const runDirs = listRunDirs(paths);
  const sessionReuseStats = buildSessionReuseStats(runDirs);
  const latestBakeoff = readLatestTransportBakeoff(paths);
  const ownerLockEvents = buildOwnerLockEventStats(paths);
  const gateStats = buildGateStats(runDirs);
  const operationalArtifacts = buildOperationalArtifactStats(paths);

  const payload = {
    schema_version: "health_v1",
    updated_at: new Date().toISOString(),
    prompt_bytes_per_stage: buildPromptByteStats(runDirs),
    prompt_budget_breaches: buildPromptBudgetBreaches(runDirs),
    compaction_frequency: {
      proxy_basis: "fresh_session_reuse_rate",
      estimated_compaction_events: sessionReuseStats.reused_session_records,
      rate_per_session_record: rate(sessionReuseStats.reused_session_records, sessionReuseStats.total_session_records)
    },
    session_reuse_count: sessionReuseStats,
    transport_retry_recovery_rate: buildTransportRetryStats(runDirs),
    transport_failures: buildTransportFailureBreakdown(runDirs),
    owner_lock_events: ownerLockEvents,
    operational_artifacts: operationalArtifacts,
    stranded_lease_count: backlog.filter((item) => item?.status === "leased").length,
    cooldown_run_count: backlog.filter((item) => item?.status === "infra_cooldown").length,
    quarantined_run_count: backlog.filter((item) => item?.status === "infra_quarantined").length,
    false_pass_prevention: gateStats,
    resumable_run_recovery_rate: buildResumableRunStats(runDirs),
    memory_validation_failure_count: buildMemoryValidationStats(paths),
    simulate_entries_in_leaderboard: leaderboard.filter((entry) => entry?.mode === "simulate").length,
    asset_timeframe_distribution_live_runs: buildAssetTimeframeDistribution(evidence),
    executor_completion_rate: buildExecutorCompletionStats(runDirs),
    evidence_yield: buildRecentEvidenceStats(evidence),
    market_family_distribution_vs_policy: buildMarketFamilyPolicyComparison(evidence, marketPolicy),
    research_vs_infra_balance: buildResearchVsInfraStats(backlog, evidence),
    percent_of_plans_with_explicit_scope_justification: buildPlanScopeJustificationStats(paths),
    latest_transport_bakeoff: latestBakeoff ? {
      artifact_path: path.relative(paths.root, latestBakeoff.path),
      generated_at: latestBakeoff.artifact.generated_at,
      winner_adapter: latestBakeoff.artifact.winner?.adapter ?? null,
      evidence_supported: latestBakeoff.artifact.winner?.evidence_supported ?? false,
      synthetic: Boolean(latestBakeoff.artifact.synthetic)
    } : null
  };

  writeJsonAtomic(paths.health, payload, paths);
  return payload;
}

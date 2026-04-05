function getPlanPath(experimentId) {
  return experimentId ? `factory/experiments/${experimentId}.plan.json` : "factory/experiments/<experiment>.plan.json";
}

function uniqueStrings(values) {
  return [...new Set(
    values
      .flat()
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function jsonBlock(value) {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

function buildPrompt(parts) {
  return parts.filter(Boolean).join("\n\n");
}

function jsonSection(title, value) {
  return `${title}\n${jsonBlock(value)}`;
}

function pathSection(title, paths) {
  return `${title}\n${paths.map((filePath) => `- ${filePath}`).join("\n")}`;
}

function retrySection(retryNote) {
  if (!retryNote) return null;
  return jsonSection("## Retry Or Handoff Note", retryNote);
}

function hasMeaningfulData(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulData);
  if (typeof value === "object") return Object.values(value).some(hasMeaningfulData);
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function retrievalSection(retrieval) {
  if (!hasMeaningfulData(retrieval)) return null;
  return jsonSection("## Targeted Retrieval", retrieval);
}

function marketPolicySection(marketPolicy) {
  if (!hasMeaningfulData(marketPolicy)) return null;
  return jsonSection("## Market Policy", marketPolicy);
}

function cycleFacts(state, factoryStats) {
  return {
    iteration: state.iteration,
    total_runs: factoryStats.totalRuns,
    live_lessons: Array.isArray(factoryStats.lessons) ? factoryStats.lessons.filter((entry) => entry?.mode !== "simulate").length : 0,
    live_evidence_entries: Array.isArray(factoryStats.evidence) ? factoryStats.evidence.filter((entry) => entry?.mode !== "simulate").length : 0,
    leaderboard_entries: Array.isArray(factoryStats.leaderboard) ? factoryStats.leaderboard.filter((entry) => entry?.mode !== "simulate").length : 0
  };
}

function backlogCapsule(backlogItem) {
  return {
    id: backlogItem?.id,
    title: backlogItem?.title,
    objective: backlogItem?.objective,
    priority: backlogItem?.priority,
    category: backlogItem?.category,
    market_family: backlogItem?.market_family,
    instrument_scope: backlogItem?.instrument_scope,
    timeframe: backlogItem?.timeframe,
    history_requirement: backlogItem?.history_requirement,
    data_source: backlogItem?.data_source,
    data_requirement: backlogItem?.data_requirement,
    source: backlogItem?.source
  };
}

function plannerRequiredFieldsCapsule() {
  return {
    required_scope_fields: [
      "market_family",
      "instrument_scope_or_instrument_selection_rule",
      "timeframe",
      "historical_depth_requirement",
      "source_plan",
      "scope_selection_rationale"
    ],
    required_execution_fields: [
      "expected_artifacts",
      "evaluation_criteria"
    ]
  };
}

function planCapsule(plan) {
  return {
    experiment_id: plan?.experiment_id,
    title: plan?.title,
    backlog_item_id: plan?.backlog_item_id,
    objective: plan?.objective,
    hypothesis: plan?.hypothesis,
    strategy_rationale: plan?.strategy_rationale,
    strategy_type: plan?.strategy_type,
    market_family: plan?.market_family,
    instrument_scope: plan?.instrument_scope,
    instrument_selection_rule: plan?.instrument_selection_rule,
    timeframe: plan?.timeframe,
    dataset_requirements: plan?.dataset_requirements,
    historical_depth_requirement: plan?.historical_depth_requirement,
    source_plan: plan?.source_plan,
    scope_selection_rationale: plan?.scope_selection_rationale,
    data_acquisition: plan?.data_acquisition,
    inputs: plan?.inputs,
    implementation_steps: plan?.implementation_steps,
    commands: plan?.commands,
    expected_artifacts: plan?.expected_artifacts,
    advanced_wfa_config: plan?.advanced_wfa_config,
    evaluation_criteria: plan?.evaluation_criteria,
    fallback_if_blocked: plan?.fallback_if_blocked,
    notes: plan?.notes
  };
}

function executionCapsule(executionResult) {
  return {
    experiment_id: executionResult?.experiment_id,
    status: executionResult?.status,
    commands_attempted: executionResult?.commands_attempted,
    commands_completed: executionResult?.commands_completed,
    artifacts_created: executionResult?.artifacts_created,
    datasets_acquired: executionResult?.datasets_acquired,
    artifacts_updated: executionResult?.artifacts_updated,
    workspace_changes: executionResult?.workspace_changes,
    metrics_observed: executionResult?.metrics_observed,
    variants_tested: executionResult?.variants_tested,
    blockers: executionResult?.blockers,
    errors: executionResult?.errors,
    notes: executionResult?.notes
  };
}

function evaluationCapsule(evaluation) {
  return {
    experiment_id: evaluation?.experiment_id,
    verdict: evaluation?.verdict,
    evidence_score: evaluation?.evidence_score,
    performance_score: evaluation?.performance_score,
    robustness_score: evaluation?.robustness_score,
    novelty_score: evaluation?.novelty_score,
    overall_score: evaluation?.overall_score,
    metrics: evaluation?.metrics,
    red_flags: evaluation?.red_flags,
    verification: evaluation?.verification,
    strengths: evaluation?.strengths,
    weaknesses: evaluation?.weaknesses,
    missing_evidence: evaluation?.missing_evidence,
    promote_to_leaderboard: evaluation?.promote_to_leaderboard,
    leaderboard_tier: evaluation?.leaderboard_tier,
    next_backlog_actions: evaluation?.next_backlog_actions,
    confidence_level: evaluation?.confidence_level,
    confidence_rationale: evaluation?.confidence_rationale
  };
}

function executionReferencePaths(plan) {
  return uniqueStrings([
    getPlanPath(plan?.experiment_id),
    Array.isArray(plan?.inputs) ? plan.inputs : [],
    Array.isArray(plan?.data_acquisition?.expected_outputs) ? plan.data_acquisition.expected_outputs : [],
    Array.isArray(plan?.expected_artifacts) ? plan.expected_artifacts : [],
    "walk forward engine/strategies/",
    "walk forward engine/config/",
    "workspace/data/"
  ]);
}

export function ideatorPrompt({ state, factoryStats, retrieval, retryNote = null }) {
  return buildPrompt([
    "Goal: Generate one explicit backlog candidate.",
    jsonSection("## Cycle Facts", cycleFacts(state, factoryStats)),
    marketPolicySection(factoryStats.marketPolicy),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", [
      "factory/market-policy.json",
      "factory/memory/lessons.jsonl",
      "factory/evidence/index.json",
      "factory/leaderboard.json",
      "walk forward engine/src/strategies/",
      "workspace/data/fetchers/"
    ]),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

export function plannerPrompt({ goal, backlogItem, state, retrieval, retryNote = null }) {
  return buildPrompt([
    `Goal: ${goal}`,
    jsonSection("## Planning Task", {
      iteration: state.iteration,
      backlog_item: backlogCapsule(backlogItem)
    }),
    jsonSection("## Required Plan Fields", plannerRequiredFieldsCapsule()),
    marketPolicySection(state.market_policy),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", [
      "factory/market-policy.json",
      "factory/memory/lessons.jsonl",
      "factory/evidence/index.json",
      "factory/leaderboard.json",
      "walk forward engine/src/strategies/",
      "workspace/data/fetchers/"
    ]),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

export function executorPrompt({ goal, plan, state, retrieval, retryNote = null }) {
  return buildPrompt([
    `Goal: ${goal}`,
    jsonSection("## Execution Task", {
      iteration: state.iteration,
      plan: planCapsule(plan)
    }),
    jsonSection("## Execution Discipline", {
      inspect_scope: "Inspect only the exact files listed below unless a concrete blocker forces one adjacent file read.",
      first_action_rule: "If the canonical WFA config path already exists and data is present, use the provided command path immediately instead of broad repo exploration.",
      blocker_rule: "If the command cannot run, return a blocked result with exact path evidence and the smallest necessary fix path."
    }),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", uniqueStrings([
      executionReferencePaths(plan),
      "factory/memory/lessons.jsonl"
    ])),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

export function evaluatorPrompt({ goal, plan, executionResult, changedFiles, state, retrieval, retryNote = null }) {
  return buildPrompt([
    `Goal: ${goal}`,
    jsonSection("## Evaluation Task", {
      iteration: state.iteration,
      plan: {
        experiment_id: plan?.experiment_id,
        objective: plan?.objective,
        expected_artifacts: plan?.expected_artifacts,
        evaluation_criteria: plan?.evaluation_criteria
      },
      execution_result: executionCapsule(executionResult),
      changed_files: Array.isArray(changedFiles) ? changedFiles : []
    }),
    jsonSection("## Verification Output Rules", {
      artifacts_checked: "Use only repo-relative artifact paths that currently exist on disk and that you actually inspected.",
      metrics_verified_from: "Use only repo-relative artifact paths that currently exist on disk. Do not append metric names, JSON keys, line numbers, or values.",
      missing_or_unverified: "List any metric or artifact you could not verify from disk."
    }),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", uniqueStrings([
      getPlanPath(plan?.experiment_id),
      Array.isArray(executionResult?.artifacts_created) ? executionResult.artifacts_created : [],
      Array.isArray(executionResult?.artifacts_updated) ? executionResult.artifacts_updated : [],
      "factory/evidence/index.json"
    ])),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

export function summarizerPrompt({ goal, plan, executionResult, evaluation, state, retrieval, retryNote = null }) {
  return buildPrompt([
    `Goal: ${goal}`,
    jsonSection("## Summarization Task", {
      iteration: state.iteration,
      plan: {
        experiment_id: plan?.experiment_id,
        backlog_item_id: plan?.backlog_item_id,
        objective: plan?.objective
      },
      execution_result: executionCapsule(executionResult),
      evaluation: evaluationCapsule(evaluation)
    }),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", uniqueStrings([
      getPlanPath(plan?.experiment_id),
      Array.isArray(executionResult?.artifacts_created) ? executionResult.artifacts_created : [],
      Array.isArray(executionResult?.artifacts_updated) ? executionResult.artifacts_updated : [],
      "factory/memory/lessons.jsonl",
      "factory/leaderboard.json"
    ])),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

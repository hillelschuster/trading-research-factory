import fs from "fs";
import crypto from "crypto";
import path from "path";

const SPEC_POLICY_PATH = "factory/mt5-ftmo-strategy-factory-spec.md";
const POLICY_VERSION = "mt5_ftmo_phase0_2026_04_28";
const MAX_SPEC_POLICY_CAPSULE_CHARS = 1800;
const EVIDENCE_KINDS = [
  "research_wfa",
  "mt5_snapshot",
  "mt5_bridge_smoke",
  "data_identity",
  "mql_build",
  "mt5_tester",
  "parity_report",
  "ftmo_ledger",
  "forward_report",
  "promotion_gate"
];

const EVIDENCE_POLICY = {
  research_wfa: {
    authority_layer: "python_research",
    required_artifacts: ["real WFA output artifacts", "canonical WFA provenance", "observed WFA metrics"],
    forbidden_shortcuts: ["no simulation-only artifact can satisfy real WFA execution", "no WFA evidence can certify MT5/FTMO promotion gates"],
    blocked_conditions: ["missing WFA config", "missing WFA result artifacts", "missing observed WFA metrics"]
  },
  mt5_snapshot: {
    authority_layer: "mt5_terminal",
    required_artifacts: ["terminal/account/symbol/data identity observations", "repo-relative snapshot artifact", "sha256 for snapshot artifacts"],
    forbidden_shortcuts: ["do not invent terminal, broker, account, symbol, or data defaults", "do not fake WFA metrics for MT5 evidence"],
    blocked_conditions: ["terminal/account/symbol identity unavailable", "snapshot artifact missing", "artifact hash missing or mismatched"]
  },
  mt5_bridge_smoke: {
    authority_layer: "control_plane",
    required_artifacts: ["run-scoped FILE_COMMON message artifacts", "checksum-backed protocol report", "deterministic rejection cases"],
    forbidden_shortcuts: ["do not require tester WebRequest", "do not rely on manual copy/paste", "do not treat bridge smoke as tester lifecycle evidence"],
    blocked_conditions: ["missing checksum", "wrong run id accepted", "stale/corrupt/partial message accepted"]
  },
  mt5_tester: {
    authority_layer: "mt5_tester",
    required_artifacts: ["tester settings", "market/pending/exit lifecycle summaries", "tester logs or log digest", "output hashes"],
    forbidden_shortcuts: ["do not treat fixture ingestion as forward/demo evidence", "do not omit tester limitations", "do not use paper adapter output"],
    blocked_conditions: ["MT5 tester output missing", "required lifecycle scenario missing", "tester settings incomplete"]
  },
  ftmo_ledger: {
    authority_layer: "control_plane",
    required_artifacts: ["explicit rule-set version/source date", "ledger input", "daily/max loss accounting summary", "breach status"],
    forbidden_shortcuts: ["do not invent FTMO defaults", "do not claim forward/demo survival from fixture ledger mechanics", "do not omit floating P/L, commission, or swap handling"],
    blocked_conditions: ["rule set missing", "ledger input missing", "account currency/balance missing", "daily reset model missing"]
  }
};

function fileSha256(repoRelativePath) {
  const fullPath = path.resolve(process.cwd(), repoRelativePath);
  if (!fs.existsSync(fullPath)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function normalizeEvidenceKind(value) {
  return EVIDENCE_KINDS.includes(value) ? value : "research_wfa";
}

function specPolicyCapsule({ applicableStage, evidenceKind, authorityLayer = null } = {}) {
  const normalizedEvidenceKind = normalizeEvidenceKind(evidenceKind);
  const policy = EVIDENCE_POLICY[normalizedEvidenceKind] ?? {
    authority_layer: authorityLayer ?? "control_plane",
    required_artifacts: ["repo-relative artifacts", "evidence-kind-appropriate metrics or observations"],
    forbidden_shortcuts: ["do not force non-WFA evidence into fake WFA metrics"],
    blocked_conditions: ["missing schema fields", "missing artifacts", "missing observations or metrics"]
  };

  return {
    spec_path: SPEC_POLICY_PATH,
    spec_sha256: fileSha256(SPEC_POLICY_PATH),
    policy_version: POLICY_VERSION,
    applicable_stage: applicableStage,
    evidence_kind: normalizedEvidenceKind,
    known_evidence_kinds: EVIDENCE_KINDS,
    authority_layer: authorityLayer ?? policy.authority_layer,
    forbidden_shortcuts: policy.forbidden_shortcuts,
    required_artifacts: policy.required_artifacts,
    blocked_conditions: policy.blocked_conditions,
    max_capsule_chars: MAX_SPEC_POLICY_CAPSULE_CHARS
  };
}

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
    evidence_kind: backlogItem?.evidence_kind,
    authority_layer: backlogItem?.authority_layer,
    candidate_id: backlogItem?.candidate_id,
    candidate_stage: backlogItem?.candidate_stage,
    deployment_mode: backlogItem?.deployment_mode,
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
    evidence_kind: plan?.evidence_kind,
    authority_layer: plan?.authority_layer,
    candidate_id: plan?.candidate_id,
    candidate_stage: plan?.candidate_stage,
    deployment_mode: plan?.deployment_mode,
    expected_artifacts: plan?.expected_artifacts,
    advanced_wfa_config: plan?.advanced_wfa_config,
    evaluation_criteria: plan?.evaluation_criteria,
    source_hashes: plan?.source_hashes,
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
    evidence_kind: executionResult?.evidence_kind,
    authority_layer: executionResult?.authority_layer,
    candidate_id: executionResult?.candidate_id,
    candidate_stage: executionResult?.candidate_stage,
    deployment_mode: executionResult?.deployment_mode,
    artifacts_created: executionResult?.artifacts_created,
    artifacts: executionResult?.artifacts,
    artifact_manifest_path: executionResult?.artifact_manifest_path,
    datasets_acquired: executionResult?.datasets_acquired,
    artifacts_updated: executionResult?.artifacts_updated,
    workspace_changes: executionResult?.workspace_changes,
    metrics_observed: executionResult?.metrics_observed,
    observations: executionResult?.observations ?? executionResult?.observations_observed,
    source_hashes: executionResult?.source_hashes,
    worker_result: executionResult?.worker_result ?? executionResult?.worker_result_envelope,
    variants_tested: executionResult?.variants_tested,
    blocked_reason: executionResult?.blocked_reason,
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
  const evidenceKind = normalizeEvidenceKind(plan?.evidence_kind);
  const paths = [
    getPlanPath(plan?.experiment_id),
    Array.isArray(plan?.inputs) ? plan.inputs : [],
    Array.isArray(plan?.data_acquisition?.expected_outputs) ? plan.data_acquisition.expected_outputs : [],
    Array.isArray(plan?.expected_artifacts) ? plan.expected_artifacts : [],
    "walk forward engine/strategies/",
    "walk forward engine/config/",
    "workspace/data/"
  ];
  if (evidenceKind !== "research_wfa") {
    paths.push("factory/mt5/", "factory/artifacts/");
  }
  return uniqueStrings(paths);
}

function executionDisciplineCapsule(evidenceKind) {
  if (normalizeEvidenceKind(evidenceKind) === "research_wfa") {
    return {
      inspect_scope: "Inspect only the exact files listed below unless a concrete blocker forces one adjacent file read.",
      first_action_rule: "If the canonical WFA config path already exists and data is present, use the provided command path immediately instead of broad repo exploration.",
      blocker_rule: "If the command cannot run, return a blocked result with exact path evidence and the smallest necessary fix path."
    };
  }
  return {
    inspect_scope: "Inspect only the exact files listed below unless a concrete blocker forces one adjacent file read.",
    worker_result_rule: "Return evidence-kind-specific output backed by a deterministic worker result envelope and verified repo-relative artifacts.",
    no_fake_wfa_rule: "Do not invent WFA metrics for non-WFA evidence kinds; use observations, artifact hashes, and blocked reasons.",
    blocker_rule: "If required evidence cannot be produced, return blocked with exact path evidence and blocked_reason."
  };
}

function artifactPathFromRef(ref) {
  if (typeof ref === "string") return ref.trim();
  if (!ref || typeof ref !== "object") return null;
  if (typeof ref.path === "string") return ref.path.trim();
  if (typeof ref.output_path === "string") return ref.output_path.trim();
  return null;
}

function artifactPathsFromRefs(refs) {
  return (Array.isArray(refs) ? refs : [])
    .map(artifactPathFromRef)
    .filter((value) => typeof value === "string" && value.trim());
}

function executionArtifactPaths(executionResult) {
  const workerResult = executionResult?.worker_result ?? executionResult?.worker_result_envelope ?? null;
  return uniqueStrings([
    artifactPathsFromRefs(executionResult?.artifacts_created),
    artifactPathsFromRefs(executionResult?.artifacts),
    artifactPathsFromRefs(executionResult?.artifacts_updated),
    artifactPathsFromRefs(workerResult?.artifacts),
    artifactPathsFromRefs(executionResult?.source_hashes),
    artifactPathsFromRefs(workerResult?.source_hashes),
    executionResult?.artifact_manifest_path
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
      "walk forward engine/strategies/*/wfa_config.yaml",
      "walk forward engine/config/strategy_*.json",
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
    jsonSection("## Spec Policy Capsule", specPolicyCapsule({
      applicableStage: "planner",
      evidenceKind: backlogItem?.evidence_kind,
      authorityLayer: backlogItem?.authority_layer
    })),
    marketPolicySection(state.market_policy),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", [
      "factory/market-policy.json",
      "factory/memory/lessons.jsonl",
      "factory/evidence/index.json",
      "factory/leaderboard.json",
      "walk forward engine/src/strategies/",
      "walk forward engine/strategies/*/wfa_config.yaml",
      "walk forward engine/config/strategy_*.json",
      "workspace/data/fetchers/"
    ]),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

export function executorPrompt({ goal, plan, state, retrieval, retryNote = null }) {
  const evidenceKind = normalizeEvidenceKind(plan?.evidence_kind);
  return buildPrompt([
    `Goal: ${goal}`,
    jsonSection("## Execution Task", {
      iteration: state.iteration,
      plan: planCapsule(plan)
    }),
    jsonSection("## Spec Policy Capsule", specPolicyCapsule({
      applicableStage: "executor",
      evidenceKind,
      authorityLayer: plan?.authority_layer
    })),
    jsonSection("## Execution Discipline", executionDisciplineCapsule(evidenceKind)),
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
  const evidenceKind = normalizeEvidenceKind(executionResult?.evidence_kind ?? plan?.evidence_kind);
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
    jsonSection("## Spec Policy Capsule", specPolicyCapsule({
      applicableStage: "evaluator",
      evidenceKind,
      authorityLayer: executionResult?.authority_layer ?? plan?.authority_layer
    })),
    jsonSection("## Verification Output Rules", {
      artifacts_checked: "Use only repo-relative artifact paths that currently exist on disk and that you actually inspected.",
      metrics_verified_from: "Use only repo-relative artifact paths that currently exist on disk. Do not append metric names, JSON keys, line numbers, or values.",
      missing_or_unverified: "List any metric or artifact you could not verify from disk."
    }),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", uniqueStrings([
      getPlanPath(plan?.experiment_id),
      executionArtifactPaths(executionResult),
      "factory/evidence/index.json"
    ])),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

export function summarizerPrompt({ goal, plan, executionResult, evaluation, state, retrieval, retryNote = null }) {
  const evidenceKind = normalizeEvidenceKind(executionResult?.evidence_kind ?? plan?.evidence_kind);
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
    jsonSection("## Spec Policy Capsule", specPolicyCapsule({
      applicableStage: "summarizer",
      evidenceKind,
      authorityLayer: executionResult?.authority_layer ?? plan?.authority_layer
    })),
    retrievalSection(retrieval),
    retrySection(retryNote),
    pathSection("## Exact Files To Inspect", uniqueStrings([
      getPlanPath(plan?.experiment_id),
      executionArtifactPaths(executionResult),
      "factory/memory/lessons.jsonl",
      "factory/leaderboard.json"
    ])),
    "Return ONLY JSON in <RF_JSON>...</RF_JSON>"
  ]);
}

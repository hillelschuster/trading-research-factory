import fs from "fs";
import path from "path";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function repoPath(value) {
  const text = cleanText(value).replace(/\\/g, "/");
  if (!text || path.isAbsolute(text)) return null;
  return text;
}

function firstRepoPathFromText(value) {
  const text = cleanText(value).replace(/\\/g, "/");
  const match = text.match(/(?:walk forward engine|workspace|factory)\/[\w .\-/]+?(?:\.[A-Za-z0-9]+)(?=$|[\s,;])/);
  return match?.[0]?.trim() ?? null;
}

function existingRepoPath(rootDir, value) {
  const relative = repoPath(value);
  if (!relative) return null;
  const full = path.resolve(rootDir, relative);
  const root = path.resolve(rootDir);
  const rooted = path.relative(root, full);
  if (rooted.startsWith("..") || path.isAbsolute(rooted)) return null;
  return fs.existsSync(full) ? relative : null;
}

function strategyNameFromWfaConfig(wfaConfigPath) {
  return path.basename(path.dirname(wfaConfigPath.replace(/\\/g, "/")));
}

function safeId(value) {
  const cleaned = cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "WFA-READY";
}

function canonicalConfigRef(wfaConfigPath) {
  const normalized = wfaConfigPath.replace(/\\/g, "/");
  const prefix = "walk forward engine/";
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

export function compileWfaReadyPlan({ backlogItem, rootDir, runId }) {
  if (!backlogItem || typeof backlogItem !== "object") {
    return { compiled: false, reason: "missing_backlog_item" };
  }
  if ((backlogItem.evidence_kind ?? "research_wfa") !== "research_wfa") {
    return { compiled: false, reason: "non_research_wfa_item" };
  }

  const wfaConfigPath = repoPath(backlogItem.expected_wfa_config_path ?? backlogItem.wfa_config_path);
  if (!wfaConfigPath || !/^walk forward engine\/strategies\/[^/]+\/wfa_config\.ya?ml$/i.test(wfaConfigPath)) {
    return { compiled: false, reason: "missing_canonical_wfa_config_path" };
  }
  const configRef = canonicalConfigRef(wfaConfigPath);
  if (!configRef) {
    return { compiled: false, reason: "invalid_wfa_config_scope" };
  }
  if (!existingRepoPath(rootDir, wfaConfigPath)) {
    return { compiled: false, reason: "wfa_config_missing_on_disk", wfa_config_path: wfaConfigPath };
  }

  const optionalPathChecks = [
    ["strategy_config_path", backlogItem.expected_strategy_config_path ?? backlogItem.strategy_config_path],
    ["strategy_source_path", backlogItem.expected_strategy_source_path ?? backlogItem.strategy_source_path]
  ];
  for (const [field, value] of optionalPathChecks) {
    const relative = repoPath(value);
    if (relative && !existingRepoPath(rootDir, relative)) {
      return { compiled: false, reason: `${field}_missing_on_disk`, [field]: relative };
    }
  }

  const strategyName = strategyNameFromWfaConfig(wfaConfigPath);
  const dataPath = repoPath(backlogItem.data_requirement) ?? firstRepoPathFromText(backlogItem.data_requirement);
  const strategyConfigPath = repoPath(backlogItem.expected_strategy_config_path ?? backlogItem.strategy_config_path);
  const strategySourcePath = repoPath(backlogItem.expected_strategy_source_path ?? backlogItem.strategy_source_path);
  const inputs = [wfaConfigPath, strategyConfigPath, strategySourcePath, dataPath].filter(Boolean);
  const experimentId = backlogItem.experiment_id ?? `EXP-${safeId(backlogItem.id)}`;
  const command = `.venv\\Scripts\\python.exe scripts/walk_forward_smoke_test.py --config ${configRef}`;

  const plan = {
    experiment_id: experimentId,
    title: cleanText(backlogItem.title) || `Deterministic WFA route for ${strategyName}`,
    backlog_item_id: backlogItem.id,
    objective: cleanText(backlogItem.objective) || `Run the explicit ${strategyName} WFA route through the canonical walk-forward engine.`,
    hypothesis: `The explicit ${strategyName} WFA route can be evaluated as research_wfa evidence only if the canonical engine produces verified artifacts and out-of-sample metrics.`,
    strategy_rationale: cleanText(backlogItem.launch_readiness_note) || `This plan was compiled deterministically from a WFA-ready backlog item with an existing canonical config path.`,
    strategy_type: strategyName,
    market_family: cleanText(backlogItem.market_family) || "strategy_defined_market",
    instrument_scope: cleanText(backlogItem.instrument_scope) || cleanText(backlogItem.instrument_selection_rule) || "Instrument scope supplied by the WFA config route",
    timeframe: cleanText(backlogItem.timeframe) || "strategy-defined timeframe",
    priority: backlogItem.priority ?? 75,
    evidence_kind: "research_wfa",
    authority_layer: backlogItem.authority_layer ?? "python_research",
    deployment_mode: backlogItem.deployment_mode ?? "research_only",
    dataset_requirements: dataPath ? [dataPath] : [wfaConfigPath],
    historical_depth_requirement: {
      target: cleanText(backlogItem.history_requirement) || cleanText(backlogItem.data_requirement) || "History depth defined by the canonical WFA config and available dataset route.",
      justification: "The backlog item already defines a concrete WFA route; deterministic planning should not block on an LLM when execution gates will verify data and artifacts."
    },
    source_plan: {
      allowed_source_families: [cleanText(backlogItem.data_source) || "existing_wfa_route"],
      primary_source_family: cleanText(backlogItem.data_source) || "existing_wfa_route",
      selection_reason: "Backlog item supplied an explicit canonical WFA config route and research-only evidence boundary."
    },
    scope_selection_rationale: cleanText(backlogItem.objective) || "Explicit WFA-ready backlog item selected this market, instrument, timeframe, and strategy route before planning.",
    data_acquisition: {
      status: "present",
      reason: "The deterministic compiler only records the explicit route; executor and validators must verify data availability before evidence can be accepted.",
      acquisition_method: cleanText(backlogItem.data_source) || "existing_wfa_route",
      sources: dataPath ? [dataPath] : [wfaConfigPath],
      commands: [],
      expected_outputs: dataPath ? [dataPath] : [wfaConfigPath]
    },
    inputs,
    implementation_steps: [
      `Inspect ${wfaConfigPath} and referenced strategy/data inputs before execution.`,
      `Run the canonical WFA command from the walk forward engine directory: ${command}`,
      "Collect WFA output artifacts, metrics, completed-window count, stdout/stderr, and an artifact manifest.",
      "Mark the run blocked or inconclusive if any required artifact or metric is missing."
    ],
    commands: [command],
    expected_artifacts: [
      `factory/runs/${runId}/execution-result.json`,
      `factory/runs/${runId}/artifact_manifest.json`,
      `factory/runs/${runId}/gate-results.json`,
      `factory/summaries/${runId}.md`
    ],
    advanced_wfa_config: {
      config_path: wfaConfigPath,
      planner_bypass: "deterministic_wfa_ready_compiler"
    },
    evaluation_criteria: {
      status_gate: "Only accept executed research_wfa evidence when canonical WFA artifacts, observed metrics, and at least one completed walk-forward window are verified.",
      metrics: {
        min_wfa_windows: 1,
        min_trades: 1,
        min_evidence_score: 50
      },
      min_evidence_score: 50
    },
    fallback_if_blocked: [
      "If config or data is missing, mark blocked with exact missing path.",
      "If WFA exits nonzero or produces no trades/windows, mark inconclusive or blocked with captured logs.",
      "If artifacts cannot be verified from disk, do not claim executed evidence."
    ],
    notes: [
      "Compiled deterministically from a WFA-ready backlog item; no LLM planner authority was used.",
      "This plan is a proposal route only; execution, metrics, evidence, gates, and state remain deterministic/artifact-bound."
    ],
    planner_bypass: {
      compiler: "deterministic_wfa_ready_compiler_v1",
      reason: "explicit_research_wfa_route",
      wfa_config_path: wfaConfigPath,
      compiled_at: new Date().toISOString()
    }
  };

  return { compiled: true, plan };
}

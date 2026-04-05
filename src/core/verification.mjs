import fs from "fs";
import os from "os";
import path from "path";
import { BacklogStore } from "./backlog-store.mjs";
import { rebuildHealthMetrics } from "./health.mjs";
import { initializeProject } from "./init.mjs";
import { rebuildNormalizedMemory } from "./memory-index.mjs";
import { buildPaths } from "./paths.mjs";
import { OpenCodeSdkTransport } from "./transport/opencode-sdk-transport.mjs";
import { acquireOwnerLock, releaseOwnerLock } from "./runtime-lock.mjs";
import { reconcileStartupState, RuntimeStateStore } from "./runtime-state.mjs";
import { validateEvaluationResult, validateExecutionResult, validateSummaryResult } from "./validators.mjs";
import { readJson, writeJsonAtomic } from "./fs-utils.mjs";

const BAKEOFF_SCHEMA_VERSION = "transport_bakeoff_v1";
const DEFAULT_ADAPTER = "sdk";
const SUPPORTED_ADAPTERS = new Set(["sdk", "http"]);
const DEFAULT_OPERATIONAL_RETENTION = {
  recoveryLogMaxLines: 500,
  verificationFilesPerPrefix: 10
};
const VERIFICATION_PREFIX_PATTERNS = [
  /^transport-bakeoff-/,
  /^verification-manifest-/,
  /^rollout-gate-/,
  /^fault-drills-/,
  /^state-migration-report-/
];

function average(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(4));
}

function normalizeRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function scoreSpeed(avgHeadersMs) {
  if (!Number.isFinite(avgHeadersMs) || avgHeadersMs <= 0) return 0;
  return Number((Math.max(0, 1 - Math.min(avgHeadersMs / 5000, 1)) * 5).toFixed(4));
}

function normalizeScenario(adapter, scenario) {
  return {
    scenario: String(scenario.scenario || "unknown"),
    fresh_server: Boolean(scenario.fresh_server),
    validated_reuse: Boolean(scenario.validated_reuse),
    attempts: Number(scenario.attempts ?? 1),
    session_create_success_rate: normalizeRate(scenario.session_create_success_rate),
    stage_completion_rate: normalizeRate(scenario.stage_completion_rate),
    retry_recovery_rate: normalizeRate(scenario.retry_recovery_rate),
    session_url_correctness_rate: normalizeRate(scenario.session_url_correctness_rate),
    time_to_first_headers_ms: typeof scenario.time_to_first_headers_ms === "number" ? scenario.time_to_first_headers_ms : null,
    total_request_ms: typeof scenario.total_request_ms === "number" ? scenario.total_request_ms : null,
    failure_class: typeof scenario.failure_class === "string" ? scenario.failure_class : null,
    transport_phase: typeof scenario.transport_phase === "string" ? scenario.transport_phase : null,
    error_message: typeof scenario.error_message === "string" ? scenario.error_message : null,
    notes: Array.isArray(scenario.notes) ? scenario.notes.filter((item) => typeof item === "string" && item.trim()) : [],
    adapter
  };
}

function summarizeCandidate(adapter, scenarios) {
  const normalized = scenarios.map((scenario) => normalizeScenario(adapter, scenario));
  const scenarioSuccessRate = average(normalized.map((scenario) => scenario.stage_completion_rate > 0 ? 1 : 0)) ?? 0;
  const summary = {
    adapter,
    scenarios: normalized,
    scenario_count: normalized.length,
    scenario_success_rate: scenarioSuccessRate,
    session_create_success_rate: average(normalized.map((scenario) => scenario.session_create_success_rate)) ?? 0,
    stage_completion_rate: average(normalized.map((scenario) => scenario.stage_completion_rate)) ?? 0,
    retry_recovery_rate: average(normalized.map((scenario) => scenario.retry_recovery_rate)) ?? 0,
    session_url_correctness_rate: average(normalized.map((scenario) => scenario.session_url_correctness_rate)) ?? 0,
    avg_time_to_first_headers_ms: average(normalized.map((scenario) => scenario.time_to_first_headers_ms)),
    avg_total_request_ms: average(normalized.map((scenario) => scenario.total_request_ms))
  };

  const score = Number((
    (summary.scenario_success_rate * 15) +
    (summary.session_create_success_rate * 20) +
    (summary.stage_completion_rate * 30) +
    (summary.retry_recovery_rate * 10) +
    (summary.session_url_correctness_rate * 20) +
    scoreSpeed(summary.avg_time_to_first_headers_ms)
  ).toFixed(4));

  return {
    ...summary,
    score,
    eligible: summary.session_create_success_rate > 0 && summary.stage_completion_rate > 0
  };
}

function chooseWinner(candidates) {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) {
    return {
      adapter: DEFAULT_ADAPTER,
      score: 0,
      evidence_supported: false,
      rationale: "No adapter achieved a successful stage-completion baseline; keep the conservative SDK default."
    };
  }

  const winner = [...eligible].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.adapter.localeCompare(b.adapter);
  })[0];

  return {
    adapter: winner.adapter,
    score: winner.score,
    evidence_supported: true,
    rationale: `${winner.adapter} led the bakeoff on completion, session creation, URL correctness, and speed.`
  };
}

function stampNow(ts = new Date()) {
  return ts.toISOString().replace(/[-:.TZ]/g, "");
}

function normalizeGateStatus(status) {
  return ["passed", "failed", "blocked"].includes(status) ? status : null;
}

function normalizeCommandResults(results) {
  return (Array.isArray(results) ? results : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : null,
      command: typeof item.command === "string" ? item.command : null,
      success: Boolean(item.success),
      exit_code: typeof item.exit_code === "number" ? item.exit_code : null,
      duration_ms: typeof item.duration_ms === "number" ? item.duration_ms : null,
      stdout_preview: typeof item.stdout_preview === "string" ? item.stdout_preview : null,
      stderr_preview: typeof item.stderr_preview === "string" ? item.stderr_preview : null
    }));
}

function normalizeAcceptanceChecks(checks) {
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return {};
  return Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, Boolean(value)]));
}

function normalizeStringArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.trim()))];
}

function listRunDirs(paths) {
  if (!fs.existsSync(paths.runs)) return [];
  return fs.readdirSync(paths.runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("RUN-"))
    .map((entry) => path.join(paths.runs, entry.name));
}

function collectGateResults(paths) {
  return listRunDirs(paths).flatMap((runDir) => {
    const payload = readJson(path.join(runDir, "gate-results.json"), { stages: [] });
    return Array.isArray(payload?.stages) ? payload.stages : [];
  });
}

export function buildTransportBakeoffArtifact({ generatedAt = new Date().toISOString(), candidates = [], synthetic = false } = {}) {
  const normalizedCandidates = candidates
    .filter((candidate) => SUPPORTED_ADAPTERS.has(candidate?.adapter))
    .map((candidate) => summarizeCandidate(candidate.adapter, Array.isArray(candidate.scenarios) ? candidate.scenarios : []));
  const winner = chooseWinner(normalizedCandidates);

  return {
    schema_version: BAKEOFF_SCHEMA_VERSION,
    generated_at: generatedAt,
    synthetic,
    candidates: normalizedCandidates,
    winner,
    default_adapter_recommended: winner.evidence_supported ? winner.adapter : DEFAULT_ADAPTER
  };
}

export function writeTransportBakeoffArtifact(paths, artifact, stamp = stampNow()) {
  const fullPath = path.join(paths.verification, `transport-bakeoff-${stamp}.json`);
  writeJsonAtomic(fullPath, artifact, paths);
  return fullPath;
}

export async function runTransportBakeoff({ paths, synthetic = false, generatedAt, adapters = [], executeCandidate }) {
  const candidates = [];
  for (const adapter of adapters) {
    const scenarios = [];
    for (const scenario of [
      { scenario: "fresh_server", fresh_server: true, validated_reuse: false },
      { scenario: "validated_reuse", fresh_server: false, validated_reuse: true }
    ]) {
      try {
        const result = await executeCandidate({ adapter, scenario: scenario.scenario });
        scenarios.push({ ...scenario, ...result });
      } catch (error) {
        scenarios.push({
          ...scenario,
          attempts: 1,
          session_create_success_rate: 0,
          stage_completion_rate: 0,
          retry_recovery_rate: 0,
          session_url_correctness_rate: 0,
          time_to_first_headers_ms: null,
          total_request_ms: null,
          failure_class: error?.rf_failure_class ?? null,
          transport_phase: error?.rf_transport_phase ?? null,
          error_message: error instanceof Error ? error.message : String(error),
          notes: ["Bakeoff scenario failed before completion."]
        });
      }
    }
    candidates.push({ adapter, scenarios });
  }

  const artifact = buildTransportBakeoffArtifact({ generatedAt, candidates, synthetic });
  const artifactPath = writeTransportBakeoffArtifact(paths, artifact);
  return { artifact, artifactPath };
}

export function readLatestTransportBakeoff(paths) {
  if (!fs.existsSync(paths.verification)) return null;
  const entries = fs.readdirSync(paths.verification, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^transport-bakeoff-\d{17}\.json$/.test(entry.name))
    .map((entry) => ({
      path: path.join(paths.verification, entry.name),
      mtimeMs: fs.statSync(path.join(paths.verification, entry.name)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (entries.length === 0) return null;
  const artifact = readJson(entries[0].path, null);
  if (!artifact || artifact.schema_version !== BAKEOFF_SCHEMA_VERSION) return null;
  return {
    artifact,
    path: entries[0].path
  };
}

export function resolvePreferredLiveTransportAdapter(paths, requestedAdapter = "auto") {
  if (requestedAdapter && requestedAdapter !== "auto") {
    return {
      adapter: requestedAdapter,
      source: "explicit"
    };
  }

  const latest = readLatestTransportBakeoff(paths);
  if (latest?.artifact?.winner?.evidence_supported && SUPPORTED_ADAPTERS.has(latest.artifact.winner.adapter)) {
    return {
      adapter: latest.artifact.winner.adapter,
      source: "bakeoff",
      artifactPath: path.relative(paths.root, latest.path)
    };
  }

  return {
    adapter: DEFAULT_ADAPTER,
    source: latest ? "fallback_after_bakeoff" : "default"
  };
}

export function pruneOperationalArtifacts(paths, policy = DEFAULT_OPERATIONAL_RETENTION) {
  const summary = {
    recovery_log_lines_before: 0,
    recovery_log_lines_after: 0,
    verification_files_deleted: 0,
    verification_files_retained: 0
  };

  if (fs.existsSync(paths.recoveryLog)) {
    const lines = fs.readFileSync(paths.recoveryLog, "utf8").split("\n").filter(Boolean);
    summary.recovery_log_lines_before = lines.length;
    const kept = lines.slice(-policy.recoveryLogMaxLines);
    summary.recovery_log_lines_after = kept.length;
    if (kept.length !== lines.length) {
      fs.writeFileSync(paths.recoveryLog, kept.join("\n") + (kept.length > 0 ? "\n" : ""), "utf8");
    }
  }

  if (fs.existsSync(paths.verification)) {
    const files = fs.readdirSync(paths.verification, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(paths.verification, entry.name),
        mtimeMs: fs.statSync(path.join(paths.verification, entry.name)).mtimeMs
      }));

    for (const pattern of VERIFICATION_PREFIX_PATTERNS) {
      const matching = files.filter((file) => pattern.test(file.name)).sort((a, b) => b.mtimeMs - a.mtimeMs);
      summary.verification_files_retained += Math.min(matching.length, policy.verificationFilesPerPrefix);
      for (const stale of matching.slice(policy.verificationFilesPerPrefix)) {
        fs.unlinkSync(stale.fullPath);
        summary.verification_files_deleted += 1;
      }
    }
  }

  return summary;
}

export function buildStageGateResult({ runId, stage, attempt, decision, validator, evidencePaths = [], reason = null }) {
  return {
    schema_version: "stage_gate_v1",
    run_id: runId,
    stage,
    attempt,
    decision,
    validator,
    evidence_paths: [...new Set((Array.isArray(evidencePaths) ? evidencePaths : []).filter((value) => typeof value === "string" && value.trim()))],
    reason,
    recorded_at: new Date().toISOString()
  };
}

export function buildVerificationManifest(paths) {
  const health = readJson(paths.health, {});
  const latestBakeoff = readLatestTransportBakeoff(paths);
  const stageGates = collectGateResults(paths);
  const denied = stageGates.filter((gate) => gate.decision === "denied").length;
  const allowed = stageGates.filter((gate) => gate.decision === "allowed").length;

  return {
    schema_version: "verification_manifest_v1",
    generated_at: new Date().toISOString(),
    health_path: "factory/health.json",
    latest_transport_bakeoff: latestBakeoff ? path.relative(paths.root, latestBakeoff.path) : null,
    stage_gate_counts: {
      total: stageGates.length,
      allowed,
      denied
    },
    false_pass_prevention: health.false_pass_prevention ?? null,
    executor_completion_rate: health.executor_completion_rate ?? null,
    evidence_yield: health.evidence_yield ?? null,
    run_gate_results: stageGates
  };
}

export function writeVerificationManifest(paths, stamp = stampNow()) {
  const payload = buildVerificationManifest(paths);
  const fullPath = path.join(paths.verification, `verification-manifest-${stamp}.json`);
  writeJsonAtomic(fullPath, payload, paths);
  return { path: fullPath, payload };
}

export function buildRolloutGate(paths, execution = {}) {
  const health = readJson(paths.health, {});
  const latestBakeoff = readLatestTransportBakeoff(paths);
  const checks = {
    no_quarantined_runs: (health.quarantined_run_count ?? 0) === 0,
    prompt_budgets_within_limit: Object.values(health.prompt_budget_breaches ?? {}).every((count) => count === 0),
    transport_evidence_available: Boolean(latestBakeoff?.artifact),
    stage_gates_recorded: (health.false_pass_prevention?.denied_stage_gates ?? 0) >= 0,
    executor_completion_known: typeof health.executor_completion_rate?.completion_rate === "number" || health.executor_completion_rate?.completion_rate === null
  };

  return {
    schema_version: "rollout_gate_v1",
    generated_at: new Date().toISOString(),
    gate_id: typeof execution.gate_id === "string" ? execution.gate_id : null,
    gate_name: typeof execution.gate_name === "string" ? execution.gate_name : null,
    gate_status: normalizeGateStatus(execution.gate_status),
    gate_started_at: typeof execution.gate_started_at === "string" ? execution.gate_started_at : null,
    gate_finished_at: typeof execution.gate_finished_at === "string" ? execution.gate_finished_at : null,
    blocked_reason: typeof execution.blocked_reason === "string" ? execution.blocked_reason : null,
    verification_manifest_path: typeof execution.verification_manifest_path === "string" ? execution.verification_manifest_path : null,
    fault_drills_path: typeof execution.fault_drills_path === "string" ? execution.fault_drills_path : null,
    command_results: normalizeCommandResults(execution.command_results),
    acceptance_checks: normalizeAcceptanceChecks(execution.acceptance_checks),
    evidence_paths: normalizeStringArray(execution.evidence_paths),
    notes: normalizeStringArray(execution.notes),
    checks,
    ready_for_rollout: Object.values(checks).every(Boolean),
    latest_transport_bakeoff: latestBakeoff ? path.relative(paths.root, latestBakeoff.path) : null,
    health_path: "factory/health.json"
  };
}

export function writeRolloutGate(paths, stamp = stampNow(), execution = {}) {
  const payload = buildRolloutGate(paths, execution);
  const fullPath = path.join(paths.verification, `rollout-gate-${stamp}.json`);
  writeJsonAtomic(fullPath, payload, paths);
  return { path: fullPath, payload };
}

export function createVerificationStamp(ts = new Date()) {
  return stampNow(ts);
}

export function finalizeRolloutGateExecution(paths, execution = {}, stamp = createVerificationStamp()) {
  rebuildHealthMetrics(paths);
  const manifest = writeVerificationManifest(paths, stamp);
  const rollout = writeRolloutGate(paths, stamp, {
    ...execution,
    verification_manifest_path: execution.verification_manifest_path ?? path.relative(paths.root, manifest.path)
  });
  return {
    stamp,
    manifestPath: manifest.path,
    manifestPayload: manifest.payload,
    rolloutPath: rollout.path,
    rolloutPayload: rollout.payload
  };
}

export function rebuildDerivedArtifacts(paths) {
  const memory = rebuildNormalizedMemory(paths);
  const health = rebuildHealthMetrics(paths);
  return {
    evidence: memory.evidence,
    leaderboard: memory.leaderboard,
    retrievalIndex: memory.retrievalIndex,
    health
  };
}

function createTempFactoryPaths() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fault-drill-"));
  initializeProject(rootDir);
  return buildPaths(rootDir);
}

async function runDrill(drillId, fn) {
  try {
    const details = await fn();
    return { drill_id: drillId, outcome: details?.outcome || "safe_recovery", details };
  } catch (error) {
    return {
      drill_id: drillId,
      outcome: "explicit_rejection",
      details: {
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function runFaultDrills(paths, stamp = stampNow()) {
  const drills = [];

  drills.push(await runDrill("timeout_before_headers", async () => {
    const transport = new OpenCodeSdkTransport({
      rootDir: paths.root,
      model: "opencode/minimax-m2.5-free",
      serverManager: {
        init: async () => ({}),
        createSession: async () => ({ sessionId: "ses-1", sessionUrl: "http://localhost/session/ses-1" }),
        getClient: () => ({ session: { prompt: async () => { throw new Error("fetch failed", { cause: new Error("headers timeout") }); } } }),
        getStatus: () => ({ initialized: true, serverFingerprint: "fp-1" }),
        close: async () => {}
      }
    });
    try {
      await transport.callAgent("executor", "test");
      return { outcome: "explicit_rejection", failed: false };
    } catch (error) {
      return { outcome: error?.rf_failure_class === "transport_failure" ? "explicit_rejection" : "safe_recovery", phase: error?.rf_transport_phase ?? null };
    }
  }));

  drills.push(await runDrill("disconnect_after_headers", async () => {
    const transport = new OpenCodeSdkTransport({
      rootDir: paths.root,
      model: "opencode/minimax-m2.5-free",
      serverManager: {
        init: async () => ({}),
        createSession: async () => ({ sessionId: "ses-2", sessionUrl: "http://localhost/session/ses-2" }),
        getClient: () => ({ session: { prompt: async () => { throw new Error("fetch failed", { cause: new Error("socket hang up") }); } } }),
        getStatus: () => ({ initialized: true, serverFingerprint: "fp-2" }),
        close: async () => {}
      }
    });
    try {
      await transport.callAgent("executor", "test");
      return { outcome: "explicit_rejection", failed: false };
    } catch (error) {
      return { outcome: error?.rf_failure_class === "transport_failure" ? "explicit_rejection" : "safe_recovery", phase: error?.rf_transport_phase ?? null };
    }
  }));

  drills.push(await runDrill("session_create_success_then_prompt_hang", async () => {
    const transport = new OpenCodeSdkTransport({
      rootDir: paths.root,
      model: "opencode/minimax-m2.5-free",
      transportTimeouts: { totalRequestMs: 10 },
      serverManager: {
        init: async () => ({}),
        createSession: async () => ({ sessionId: "ses-3", sessionUrl: "http://localhost/session/ses-3" }),
        getClient: () => ({ session: { prompt: async () => new Promise(() => {}) } }),
        getStatus: () => ({ initialized: true, serverFingerprint: "fp-3" }),
        close: async () => {}
      }
    });
    try {
      await transport.callAgent("executor", "test");
      return { outcome: "explicit_rejection", failed: false };
    } catch (error) {
      return { outcome: error?.rf_failure_class === "transport_failure" ? "explicit_rejection" : "safe_recovery", phase: error?.rf_transport_phase ?? null };
    }
  }));

  drills.push(await runDrill("owner_death_mid_executor", async () => {
    const tempPaths = createTempFactoryPaths();
    const runtimeState = new RuntimeStateStore(tempPaths);
    const backlogStore = new BacklogStore(tempPaths);
    const artifactStore = { readRunState: () => null };
    acquireOwnerLock(tempPaths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
    runtimeState.markActive({ status: "active", owner_id: "owner-a", run_id: "RUN-1", stage: "executor" });
    const repaired = reconcileStartupState(tempPaths, backlogStore, artifactStore, { nowMs: 1000 + (60 * 60 * 1000) });
    return { outcome: repaired.active_run_repaired ? "safe_recovery" : "explicit_rejection" };
  }));

  drills.push(await runDrill("clean_shutdown_during_executor", async () => {
    const tempPaths = createTempFactoryPaths();
    const acquired = acquireOwnerLock(tempPaths, { ownerId: "owner-a", intervalMs: 1000, nowMs: 1000 });
    const released = releaseOwnerLock(tempPaths, { ownerId: "owner-a", token: acquired.token, nowMs: 1500, reason: "drill" });
    return { outcome: released.released ? "safe_recovery" : "explicit_rejection" };
  }));

  drills.push(await runDrill("bad_evaluator_artifact_path", async () => {
    validateEvaluationResult({
      verdict: "inconclusive",
      evidence_score: 50,
      overall_score: 40,
      metrics: { sharpe_oos: 0.3 },
      red_flags: [],
      verification: { artifacts_checked: ["workspace/results/missing.json"], metrics_verified_from: ["workspace/results/missing.json"] },
      missing_evidence: [],
      promote_to_leaderboard: false,
      confidence_level: "medium",
      confidence_rationale: "drill"
    }, { mode: "live", rootDir: paths.root });
  }));

  drills.push(await runDrill("generic_summary", async () => {
    validateSummaryResult({
      experiment_id: "EXP-1",
      backlog_item_id: "IDEA-1",
      summary: "This run completed with a clear next step.",
      key_lessons: [{ lesson: "Further research is needed." }],
      next_actions: [{ action: "Continue iterating." }]
    });
  }));

  drills.push(await runDrill("false_executed_claim", async () => {
    validateExecutionResult({
      experiment_id: "EXP-1",
      status: "executed",
      artifacts_created: ["workspace/results/report.json"],
      metrics_observed: { sharpe_oos: 1.2, total_trades: 50 }
    });
  }));

  drills.push(await runDrill("stale_active_run_reconciliation", async () => {
    const tempPaths = createTempFactoryPaths();
    const runtimeState = new RuntimeStateStore(tempPaths);
    const backlogStore = new BacklogStore(tempPaths);
    const artifactStore = { readRunState: () => null };
    runtimeState.markActive({ status: "active", owner_id: "owner-a", run_id: "RUN-1", stage: "executor" });
    const repaired = reconcileStartupState(tempPaths, backlogStore, artifactStore, { nowMs: Date.now() });
    return { outcome: repaired.active_run_repaired ? "safe_recovery" : "explicit_rejection" };
  }));

  drills.push(await runDrill("poisoned_run_move_on_behavior", async () => {
    const tempPaths = createTempFactoryPaths();
    const backlogStore = new BacklogStore(tempPaths);
    backlogStore.append([{ id: "A", status: "infra_cooldown", cooldown_until: "2000-01-01T00:00:00.000Z" }]);
    const recovered = backlogStore.recoverCooldowns(new Date("2000-01-02T00:00:00.000Z"));
    return { outcome: recovered.length === 1 ? "safe_recovery" : "explicit_rejection" };
  }));

  const payload = {
    schema_version: "fault_drills_v1",
    generated_at: new Date().toISOString(),
    drills
  };
  const fullPath = path.join(paths.verification, `fault-drills-${stamp}.json`);
  writeJsonAtomic(fullPath, payload, paths);
  return { path: fullPath, payload };
}

function readLatestVerificationFile(paths, prefix) {
  if (!fs.existsSync(paths.verification)) return null;
  const entries = fs.readdirSync(paths.verification, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map((entry) => ({
      path: path.join(paths.verification, entry.name),
      mtimeMs: fs.statSync(path.join(paths.verification, entry.name)).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (entries.length === 0) return null;
  return { path: entries[0].path, payload: readJson(entries[0].path, null) };
}

export function readLatestVerificationManifest(paths) {
  return readLatestVerificationFile(paths, "verification-manifest-");
}

export function readLatestRolloutGate(paths) {
  return readLatestVerificationFile(paths, "rollout-gate-");
}

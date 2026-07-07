#!/usr/bin/env node
import fs from "fs";
import path from "path";
import process from "process";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { readJson } from "../src/core/fs-utils.mjs";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { resolveCanonicalRoot } from "../src/core/root-identity.mjs";
import { createVerificationStamp, finalizeRolloutGateExecution, runFaultDrills } from "../src/core/verification.mjs";
import { validateStructure } from "./validate-structure.mjs";

const GATE_ALIASES = new Map([
  ["0", "gate-0"],
  ["gate-0", "gate-0"],
  ["source", "gate-0"],
  ["source-gate", "gate-0"],
  ["1", "gate-1"],
  ["gate-1", "gate-1"],
  ["simulate", "gate-1"],
  ["simulated-control-plane", "gate-1"],
  ["2", "gate-2"],
  ["gate-2", "gate-2"],
  ["failure", "gate-2"],
  ["failure-injection", "gate-2"],
  ["3", "gate-3"],
  ["gate-3", "gate-3"],
  ["live", "gate-3"],
  ["controlled-live", "gate-3"],
  ["4", "gate-4"],
  ["gate-4", "gate-4"],
  ["bounded-live", "gate-4"],
  ["unattended-live", "gate-4"]
]);

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function truncateOutput(value, limit = 800) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(-limit)}`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        index += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

export function normalizeGateArg(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return GATE_ALIASES.get(normalized) || null;
}

function commandString(cmd, args) {
  return [cmd, ...args].join(" ");
}

function runCommand(rootDir, label, cmd, args, extraEnv = {}) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv
    }
  });
  const finishedAt = new Date();
  return {
    label,
    command: commandString(cmd, args),
    success: result.status === 0,
    exit_code: typeof result.status === "number" ? result.status : null,
    duration_ms: Date.now() - startedMs,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    stdout_preview: truncateOutput(result.stdout),
    stderr_preview: truncateOutput(result.stderr)
  };
}

function runCommandStreaming(rootDir, label, cmd, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const startedMs = Date.now();
    const child = spawn(cmd, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        label,
        command: commandString(cmd, args),
        success: code === 0,
        exit_code: typeof code === "number" ? code : null,
        duration_ms: Date.now() - startedMs,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        stdout_preview: truncateOutput(stdout),
        stderr_preview: truncateOutput(stderr),
        stdout,
        stderr
      });
    });
  });
}

function listRunIds(paths) {
  if (!fs.existsSync(paths.runs)) return [];
  return fs.readdirSync(paths.runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("RUN-"))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const leftPath = path.join(paths.runs, left);
      const rightPath = path.join(paths.runs, right);
      return fs.statSync(leftPath).mtimeMs - fs.statSync(rightPath).mtimeMs;
    });
}

function snapshotState(paths) {
  const runIds = listRunIds(paths);
  return {
    runIds: new Set(runIds),
    runMtimes: new Map(runIds.map((runId) => [runId, fs.statSync(path.join(paths.runs, runId)).mtimeMs])),
    evidence: readJson(paths.evidenceIndex, []),
    leaderboard: readJson(paths.leaderboard, [])
  };
}

function countRecoveryEvents(paths) {
  if (!fs.existsSync(paths.recoveryLog)) return 0;
  return fs.readFileSync(paths.recoveryLog, "utf8").split("\n").filter(Boolean).length;
}

function selectTouchedRun(paths, before) {
  const allRunIds = listRunIds(paths);
  const newRunIds = allRunIds.filter((runId) => !before.runIds.has(runId));
  if (newRunIds.length > 0) {
    return {
      targetRunId: newRunIds.at(-1),
      newRunIds,
      touchedRunIds: newRunIds
    };
  }

  const touchedRunIds = allRunIds
    .filter((runId) => (before.runMtimes.get(runId) ?? 0) < fs.statSync(path.join(paths.runs, runId)).mtimeMs)
    .sort((left, right) => fs.statSync(path.join(paths.runs, left)).mtimeMs - fs.statSync(path.join(paths.runs, right)).mtimeMs);

  return {
    targetRunId: touchedRunIds.at(-1) || null,
    newRunIds,
    touchedRunIds
  };
}

function readRunStateForRun(paths, runId) {
  if (!runId) return null;
  return readJson(path.join(paths.runs, runId, "run-state.json"), null);
}

function selectGate3TargetRun(paths, before) {
  const selection = selectTouchedRun(paths, before);
  return {
    targetRunId: selection.targetRunId,
    newRunIds: selection.newRunIds,
    resumedRunIds: selection.newRunIds.length > 0 ? [] : selection.touchedRunIds
  };
}

function relativeToRoot(paths, fullPath) {
  return path.relative(paths.root, fullPath);
}

function addEvidencePathIfExists(paths, collection, fullPath) {
  if (fullPath && fs.existsSync(fullPath)) {
    collection.push(relativeToRoot(paths, fullPath));
  }
}

function readSessionIdsForRun(paths, runId) {
  const runDir = path.join(paths.runs, runId);
  if (!fs.existsSync(runDir)) return [];
  return fs.readdirSync(runDir)
    .filter((fileName) => fileName.endsWith("-session.json"))
    .map((fileName) => readJson(path.join(runDir, fileName), null)?.session_id)
    .filter((value) => typeof value === "string" && value.trim());
}

async function executeGate0(paths) {
  const startedAt = new Date().toISOString();
  const commandResults = [
    runCommand(paths.root, "validate", npmExecutable(), ["run", "validate"]),
    runCommand(paths.root, "test", npmExecutable(), ["test"]),
    runCommand(paths.root, "smoke", npmExecutable(), ["run", "smoke"])
  ];
  const acceptanceChecks = {
    validate_green: commandResults[0].success,
    tests_green: commandResults[1].success,
    smoke_green: commandResults[2].success
  };
  const gateStatus = Object.values(acceptanceChecks).every(Boolean) ? "passed" : "failed";
  const finishedAt = new Date().toISOString();
  const finalized = finalizeRolloutGateExecution(paths, {
    gate_id: "gate-0",
    gate_name: "source gate",
    gate_status: gateStatus,
    gate_started_at: startedAt,
    gate_finished_at: finishedAt,
    command_results: commandResults,
    acceptance_checks: acceptanceChecks,
    evidence_paths: ["factory/health.json"],
    notes: ["Gate 0 requires validate, test, and smoke to pass on the canonical repo root."]
  });
  return finalized;
}

async function executeGate1(paths) {
  const startedAt = new Date().toISOString();
  return finalizeRolloutGateExecution(paths, {
    gate_id: "gate-1",
    gate_name: "simulated control-plane gate",
    gate_status: "retired",
    gate_started_at: startedAt,
    gate_finished_at: new Date().toISOString(),
    command_results: [],
    acceptance_checks: {},
    evidence_paths: [],
    notes: ["Gate 1 retired: simulate mode was removed. Live mode is the only mode."]
  });
}

async function executeGate2(paths) {
  const stamp = createVerificationStamp();
  const startedAt = new Date().toISOString();
  const drills = await runFaultDrills(paths, stamp);
  const allSafe = drills.payload.drills.every((item) => ["safe_recovery", "explicit_rejection"].includes(item.outcome));
  const acceptanceChecks = {
    fault_drill_artifact_written: Boolean(drills.path),
    every_required_drill_safe_or_rejected: allSafe
  };
  const gateStatus = Object.values(acceptanceChecks).every(Boolean) ? "passed" : "failed";
  const finalized = finalizeRolloutGateExecution(paths, {
    gate_id: "gate-2",
    gate_name: "failure-injection gate",
    gate_status: gateStatus,
    gate_started_at: startedAt,
    gate_finished_at: new Date().toISOString(),
    fault_drills_path: relativeToRoot(paths, drills.path),
    acceptance_checks: acceptanceChecks,
    evidence_paths: [relativeToRoot(paths, drills.path), "factory/health.json"],
    notes: [`Fault drill count: ${drills.payload.drills.length}.`]
  }, stamp);
  return finalized;
}

async function waitForFollowSurface(paths, timeoutMs = 180000, pollMs = 250) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const activeRun = readJson(paths.activeRun, {});
    const followUrl = activeRun?.follow_url;
    if (typeof followUrl === "string" && followUrl.trim() && activeRun?.status && activeRun.status !== "idle") {
      try {
        const response = await fetch(followUrl);
        return {
          follow_url: followUrl,
          http_ok: response.ok,
          http_status: response.status,
          active_status: activeRun.status
        };
      } catch {
        return {
          follow_url: followUrl,
          http_ok: false,
          http_status: null,
          active_status: activeRun.status
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return {
    follow_url: null,
    http_ok: false,
    http_status: null,
    active_status: null
  };
}

function readExecutionResultForRun(paths, runId) {
  if (!runId) return null;
  return readJson(path.join(paths.runs, runId, "execution-result.json"), null);
}

function classifyGate3Status(commandResult, acceptanceChecks) {
  if (Object.values(acceptanceChecks).every(Boolean)) return { gate_status: "passed", blocked_reason: null };
  const output = `${commandResult.stderr || ""}\n${commandResult.stdout || ""}`;
  if (/observer_only|healthy_owner_exists|fetch failed|timed out|headers timeout|unauthorized|api key|credential/i.test(output)) {
    return {
      gate_status: "blocked",
      blocked_reason: "Live gate did not complete a fresh real run because runtime ownership or transport/provider preconditions were not met."
    };
  }
  return { gate_status: "failed", blocked_reason: null };
}

async function executeGate3(paths) {
  const startedAt = new Date().toISOString();
  const before = snapshotState(paths);
  const observerPort = String(process.env.RESEARCH_FACTORY_OBSERVER_PORT || 4310);
  const commandPromise = runCommandStreaming(
    paths.root,
    "controlled-live",
    process.execPath,
    ["src/cli.mjs", "run", "--mode", "live", "--cycles", "1", "--interval-ms", "1", "--no-open-browser"],
    { RESEARCH_FACTORY_OBSERVER_PORT: observerPort }
  );
  const followProbe = await waitForFollowSurface(paths);
  const commandResult = await commandPromise;
  const runSelection = selectGate3TargetRun(paths, before);
  const targetRunId = runSelection.targetRunId;
  const executionResult = readExecutionResultForRun(paths, targetRunId);
  const afterEvidence = readJson(paths.evidenceIndex, []);
  const beforeEvidenceCount = before.evidence.filter((entry) => entry?.run_id === targetRunId).length;
  const afterEvidenceForRun = afterEvidence.filter((entry) => entry?.run_id === targetRunId);
  const structure = validateStructure(paths.root);
  const provenance = executionResult?.provenance || {};
  const runDir = targetRunId ? path.join(paths.runs, targetRunId) : null;
  const acceptanceChecks = {
    live_command_green: commandResult.success,
    run_created_or_resumed: Boolean(targetRunId),
    observer_follow_surface_reachable: followProbe.http_ok,
    real_wfa_execution_recorded: executionResult?.status === "executed",
    canonical_wfa_provenance: provenance.engine === "walk_forward_engine"
      && typeof provenance.command === "string"
      && provenance.command.includes("scripts/walk_forward_smoke_test.py")
      && provenance.working_directory === "walk forward engine"
      && typeof provenance.config_path === "string"
      && provenance.config_path.startsWith("walk forward engine/strategies/"),
    live_evidence_recorded: afterEvidenceForRun.some((entry) => entry?.mode === "live") && afterEvidenceForRun.length > beforeEvidenceCount,
    structure_still_valid: structure.ok === true
  };
  const status = classifyGate3Status(commandResult, acceptanceChecks);
  const evidencePaths = ["factory/health.json"];
  if (runDir) {
    addEvidencePathIfExists(paths, evidencePaths, path.join(runDir, "execution-result.json"));
    addEvidencePathIfExists(paths, evidencePaths, path.join(runDir, "gate-results.json"));
    addEvidencePathIfExists(paths, evidencePaths, path.join(runDir, "run-state.json"));
    const latestExecutorError = [1, 2, 3, 4, 5]
      .map((attempt) => path.join(runDir, `executor-attempt-${attempt}`, "stage-error.json"))
      .filter((fullPath) => fs.existsSync(fullPath))
      .sort()
      .at(-1);
    addEvidencePathIfExists(paths, evidencePaths, latestExecutorError);
  }
  const finalized = finalizeRolloutGateExecution(paths, {
    gate_id: "gate-3",
    gate_name: "controlled live gate",
    gate_status: status.gate_status,
    blocked_reason: status.blocked_reason,
    gate_started_at: startedAt,
    gate_finished_at: new Date().toISOString(),
    command_results: [commandResult],
    acceptance_checks: acceptanceChecks,
    evidence_paths: evidencePaths,
    notes: [
      followProbe.follow_url ? `Observed follow URL: ${followProbe.follow_url}` : "No follow URL became active during Gate 3.",
      targetRunId
        ? (runSelection.newRunIds.includes(targetRunId) ? `Evaluated new live run ${targetRunId}.` : `Evaluated resumed live run ${targetRunId}.`)
        : "No live run directory was created or resumed by Gate 3."
    ]
  });
  return {
    ...finalized,
    runId: targetRunId,
    followProbe,
    runSelection
  };
}

async function runLiveCycle(paths, { interruptStage = null } = {}) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const before = snapshotState(paths);
  const observerPort = String(process.env.RESEARCH_FACTORY_OBSERVER_PORT || 4310);
  const child = spawn(process.execPath, ["src/cli.mjs", "run", "--mode", "live", "--cycles", "1", "--interval-ms", "1", "--no-open-browser"], {
    cwd: paths.root,
    env: {
      ...process.env,
      RESEARCH_FACTORY_OBSERVER_PORT: observerPort
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let interrupted = false;
  let interruptedRunId = null;
  const closePromise = new Promise((resolve) => {
    child.on("close", resolve);
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  while (child.exitCode === null) {
    const activeRun = readJson(paths.activeRun, null);
    if (!interrupted && interruptStage && activeRun?.status === "active" && activeRun?.stage === interruptStage && activeRun?.run_id) {
      interrupted = child.kill("SIGTERM");
      interruptedRunId = activeRun.run_id;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const code = await closePromise;
  const selection = selectTouchedRun(paths, before);
  return {
    label: interruptStage ? `live-cycle-${interruptStage}-interrupt` : "live-cycle",
    command: commandString(process.execPath, ["src/cli.mjs", "run", "--mode", "live", "--cycles", "1", "--interval-ms", "1", "--no-open-browser"]),
    success: code === 0,
    exit_code: typeof code === "number" ? code : null,
    duration_ms: Date.now() - startedMs,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    stdout_preview: truncateOutput(stdout),
    stderr_preview: truncateOutput(stderr),
    targetRunId: selection.targetRunId,
    newRunIds: selection.newRunIds,
    touchedRunIds: selection.touchedRunIds,
    interrupted,
    interruptedRunId
  };
}

async function executeGate4(paths) {
  const minCycles = Number(process.env.RESEARCH_FACTORY_GATE4_MIN_CYCLES ?? 10);
  const minDurationMs = Number(process.env.RESEARCH_FACTORY_GATE4_MIN_DURATION_MS ?? (4 * 60 * 60 * 1000));
  const startedAt = new Date();
  const commandResults = [];
  const completedRunIds = new Set();
  const interruptedRunIds = new Set();
  const resumedRunIds = new Set();
  const recoveryEventsBefore = countRecoveryEvents(paths);
  let interruptionAttempted = false;

  while ((Date.now() - startedAt.getTime()) < minDurationMs || completedRunIds.size < minCycles) {
    const cycle = await runLiveCycle(paths, { interruptStage: interruptionAttempted ? null : "executor" });
    commandResults.push(cycle);

    if (cycle.interrupted && cycle.interruptedRunId) {
      interruptionAttempted = true;
      interruptedRunIds.add(cycle.interruptedRunId);
      continue;
    }

    const runState = readRunStateForRun(paths, cycle.targetRunId);
    if (cycle.targetRunId && runState?.last_completed_stage === "summarizer" && runState?.handoff_pending === false) {
      completedRunIds.add(cycle.targetRunId);
      if (interruptedRunIds.has(cycle.targetRunId) && (runState.resume_generation ?? 0) >= 1) {
        resumedRunIds.add(cycle.targetRunId);
      }
    }
  }

  const activeRun = readJson(paths.activeRun, {});
  const ownerLock = readJson(paths.ownerLock, {});
  const health = readJson(paths.health, {});
  const acceptanceChecks = {
    minimum_duration_met: (Date.now() - startedAt.getTime()) >= minDurationMs,
    minimum_cycle_count_met: commandResults.length >= minCycles,
    completed_live_run_exists: completedRunIds.size >= 1,
    interruption_triggered: interruptedRunIds.size >= 1,
    interruption_resumed: resumedRunIds.size >= 1,
    no_quarantined_runs: (health.quarantined_run_count ?? 0) === 0,
    owner_lock_cleared: ownerLock.status === "idle" && !ownerLock.owner_id,
    active_run_cleared: !activeRun.run_id && !activeRun.owner_id,
    recovery_events_recorded: countRecoveryEvents(paths) > recoveryEventsBefore
  };
  const gateStatus = Object.values(acceptanceChecks).every(Boolean) ? "passed" : "blocked";
  const evidencePaths = ["factory/health.json", "factory/runtime/recovery-log.jsonl", "factory/runtime/owner-lock.json", "factory/runtime/active-run.json"];
  for (const runId of completedRunIds) {
    addEvidencePathIfExists(paths, evidencePaths, path.join(paths.runs, runId, "execution-result.json"));
    addEvidencePathIfExists(paths, evidencePaths, path.join(paths.runs, runId, "gate-results.json"));
    addEvidencePathIfExists(paths, evidencePaths, path.join(paths.runs, runId, "run-state.json"));
  }

  return finalizeRolloutGateExecution(paths, {
    gate_id: "gate-4",
    gate_name: "bounded unattended live gate",
    gate_status: gateStatus,
    blocked_reason: gateStatus === "passed" ? null : "Gate 4 window did not yet satisfy the full bounded unattended live acceptance checks.",
    gate_started_at: startedAt.toISOString(),
    gate_finished_at: new Date().toISOString(),
    command_results: commandResults,
    acceptance_checks: acceptanceChecks,
    evidence_paths: evidencePaths,
    notes: [
      `Observed cycles in window: ${commandResults.length}.`,
      `Completed live runs in window: ${completedRunIds.size}.`,
      `Interrupted run ids: ${[...interruptedRunIds].join(", ") || "none"}.`,
      `Resumed run ids: ${[...resumedRunIds].join(", ") || "none"}.`,
      `Gate 4 thresholds: ${minCycles} cycles and ${minDurationMs}ms.`
    ]
  });
}

export async function runRolloutGate(rootDir, gateArg) {
  const rootIdentity = resolveCanonicalRoot(rootDir);
  initializeProject(rootIdentity);
  const paths = buildPaths(rootIdentity);
  const gateId = normalizeGateArg(gateArg);
  if (!gateId) {
    throw new Error(`Unknown gate '${gateArg}'. Supported gates: gate-0, gate-1, gate-2, gate-3, gate-4.`);
  }
  if (gateId === "gate-0") return executeGate0(paths);
  if (gateId === "gate-1") return executeGate1(paths);
  if (gateId === "gate-2") return executeGate2(paths);
  if (gateId === "gate-3") return executeGate3(paths);
  return executeGate4(paths);
}

if (IS_MAIN) {
  const args = parseArgs(process.argv.slice(2));
  const gateArg = args._[0];
  if (!gateArg) {
    console.error("Usage: node scripts/run-rollout-gate.mjs <gate-0|gate-1|gate-2|gate-3|gate-4> [--root <repo-root>]");
    process.exit(1);
  }
  try {
    const result = await runRolloutGate(args.root || process.cwd(), gateArg);
    console.log(JSON.stringify({
      gate: normalizeGateArg(gateArg),
      gate_status: result.rolloutPayload.gate_status,
      rollout_gate: path.relative(process.cwd(), result.rolloutPath),
      verification_manifest: path.relative(process.cwd(), result.manifestPath)
    }, null, 2));
    process.exit(result.rolloutPayload.gate_status === "passed" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  }
}

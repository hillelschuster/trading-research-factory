import fs from "fs";
import path from "path";
import { appendLine, ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from "./fs-utils.mjs";
import { isSandboxRelativePath } from "./root-identity.mjs";

const RESEARCH_STAGES = ["planner", "executor", "evaluator", "summarizer"];

function defaultStageStatus() {
  return Object.fromEntries(RESEARCH_STAGES.map((stage) => [stage, { status: "pending", updated_at: null }]));
}

function normalizeStageStatus(stageStatus) {
  return {
    ...defaultStageStatus(),
    ...(stageStatus && typeof stageStatus === "object" ? stageStatus : {})
  };
}

function normalizeLegacyRunState(source, runId) {
  const state = source && typeof source === "object" ? source : {};
  const resumeGeneration = state.resume_generation ?? ((state.resume_from_stage || state.handoff_pending) ? 1 : 0);
  return {
    run_id: state.run_id ?? runId,
    backlog_item_id: state.backlog_item_id ?? null,
    owner_id: state.owner_id ?? null,
    run_instance_id: state.run_instance_id ?? state.run_id ?? runId,
    resume_generation: resumeGeneration,
    current_stage: state.current_stage ?? null,
    current_stage_attempt: state.current_stage_attempt ?? null,
    current_stage_session: state.current_stage_session ?? null,
    last_completed_stage: state.last_completed_stage ?? null,
    observer_opened_at: state.observer_opened_at ?? null,
    poison_streak_count: state.poison_streak_count ?? 0,
    poison_stage: state.poison_stage ?? null,
    poison_failure_class: state.poison_failure_class ?? null,
    stage_status: normalizeStageStatus(state.stage_status),
    failure_class: state.failure_class ?? null,
    resume_from_stage: state.resume_from_stage ?? "planner",
    handoff_pending: state.handoff_pending ?? false,
    last_error: state.last_error ?? null,
    attempt_counts: {
      planner: 0,
      executor: 0,
      evaluator: 0,
      summarizer: 0,
      ...(state.attempt_counts && typeof state.attempt_counts === "object" ? state.attempt_counts : {})
    },
    artifact_paths: state.artifact_paths && typeof state.artifact_paths === "object" ? state.artifact_paths : {},
    updated_at: state.updated_at ?? new Date().toISOString()
  };
}

function normalizeLegacyHandoff(source, runState) {
  const handoff = source && typeof source === "object" ? source : {};
  return {
    schema_version: handoff.schema_version ?? "handoff_v2",
    resume_from_stage: handoff.resume_from_stage ?? runState.resume_from_stage ?? null,
    resume_generation: handoff.resume_generation ?? runState.resume_generation ?? 1,
    failure_class: handoff.failure_class ?? runState.failure_class ?? null,
    last_error: handoff.last_error ?? runState.last_error ?? null,
    attempts_used: handoff.attempts_used ?? 0,
    safe_inputs: handoff.safe_inputs ?? {},
    produced_artifacts: Array.isArray(handoff.produced_artifacts) ? handoff.produced_artifacts : [],
    consumed: handoff.consumed ?? false,
    consumed_by: handoff.consumed_by ?? null,
    consumed_at: handoff.consumed_at ?? null,
    superseded_by: handoff.superseded_by ?? null,
    signal: handoff.signal ?? null,
    created_at: handoff.created_at ?? new Date().toISOString()
  };
}

export class ArtifactStore {
  constructor(paths) {
    this.paths = paths;
  }

  relativeToRoot(fullPath) {
    return path.relative(this.paths.root, fullPath);
  }

  runDir(runId) {
    const dir = path.join(this.paths.runs, runId);
    ensureDir(dir, this.paths);
    return dir;
  }

  stageAttemptDir(runId, stage, attempt) {
    const dir = path.join(this.runDir(runId), `${stage}-attempt-${attempt}`);
    ensureDir(dir, this.paths);
    return dir;
  }

  writeRunArtifact(runId, filename, data, { asJson = true } = {}) {
    const full = path.join(this.runDir(runId), filename);
    if (asJson) writeJsonAtomic(full, data, this.paths);
    else writeTextAtomic(full, typeof data === "string" ? data : JSON.stringify(data, null, 2), this.paths);
    return full;
  }

  writeExperimentPlan(experimentId, plan) {
    const full = path.join(this.paths.experiments, `${experimentId}.plan.json`);
    writeJsonAtomic(full, plan, this.paths);
    return full;
  }

  writeSummary(runId, markdown) {
    const full = path.join(this.paths.summaries, `${runId}.md`);
    writeTextAtomic(full, markdown, this.paths);
    return full;
  }

  readRunState(runId, fallback = null) {
    return readJson(path.join(this.runDir(runId), "run-state.json"), fallback);
  }

  writeRunState(runId, data) {
    const full = path.join(this.runDir(runId), "run-state.json");
    writeJsonAtomic(full, data, this.paths);
    return full;
  }

  updateRunState(runId, mutator, fallback = {}) {
    const current = this.readRunState(runId, fallback) ?? fallback;
    const next = mutator(structuredClone(current));
    this.writeRunState(runId, next);
    return next;
  }

  readHandoff(runId, fallback = null) {
    return readJson(path.join(this.runDir(runId), "handoff.json"), fallback);
  }

  writeHandoff(runId, data) {
    const full = path.join(this.runDir(runId), "handoff.json");
    writeJsonAtomic(full, data, this.paths);
    return full;
  }

  writeStageInput(runId, stage, attempt, data) {
    const full = path.join(this.stageAttemptDir(runId, stage, attempt), "stage-input.json");
    writeJsonAtomic(full, data, this.paths);
    return full;
  }

  writeStagePrompt(runId, stage, attempt, promptText) {
    const full = path.join(this.stageAttemptDir(runId, stage, attempt), "stage-prompt.txt");
    writeTextAtomic(full, promptText, this.paths);
    return full;
  }

  writeStageResponse(runId, stage, attempt, responseText) {
    const full = path.join(this.stageAttemptDir(runId, stage, attempt), "stage-response.raw.txt");
    writeTextAtomic(full, responseText, this.paths);
    return full;
  }

  writeStageValidated(runId, stage, attempt, data) {
    const full = path.join(this.stageAttemptDir(runId, stage, attempt), "stage-validated.json");
    writeJsonAtomic(full, data, this.paths);
    return full;
  }

  writeStageError(runId, stage, attempt, data) {
    const full = path.join(this.stageAttemptDir(runId, stage, attempt), "stage-error.json");
    writeJsonAtomic(full, data, this.paths);
    return full;
  }

  readGateResults(runId, fallback = { schema_version: "stage_gates_v1", run_id: runId, stages: [] }) {
    return readJson(path.join(this.runDir(runId), "gate-results.json"), fallback);
  }

  writeGateResults(runId, data) {
    const full = path.join(this.runDir(runId), "gate-results.json");
    writeJsonAtomic(full, data, this.paths);
    return full;
  }

  writeStageGate(runId, stage, attempt, data) {
    const full = path.join(this.stageAttemptDir(runId, stage, attempt), "stage-gate.json");
    writeJsonAtomic(full, data, this.paths);
    return full;
  }

  appendLesson(lesson) {
    appendLine(this.paths.lessons, JSON.stringify(lesson), this.paths);
  }

  updateEvidenceIndex(entry) {
    const current = readJson(this.paths.evidenceIndex, []);
    current.push(entry);
    writeJsonAtomic(this.paths.evidenceIndex, current, this.paths);
  }

  snapshotWorkspaceHashes(rootDir) {
    const out = {};
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        const relativeToRepoRoot = path.relative(this.paths.root, full);
        if (isSandboxRelativePath(relativeToRepoRoot)) continue;
        if (entry.isDirectory()) walk(full);
        else out[path.relative(rootDir, full)] = {
          size: fs.statSync(full).size,
          mtime_ms: fs.statSync(full).mtimeMs
        };
      }
    };
    walk(rootDir);
    return out;
  }

  diffSnapshots(before, after) {
    const changed = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...allKeys].sort()) {
      const a = before[key];
      const b = after[key];
      if (!a || !b || a.size !== b.size || a.mtime_ms !== b.mtime_ms) changed.push(key);
    }
    return changed;
  }

  migrateLegacyRunArtifacts() {
    const report = {
      schema_version: "state_migration_report_v1",
      generated_at: new Date().toISOString(),
      updated_runs: [],
      updated_handoffs: []
    };

    if (!fs.existsSync(this.paths.runs)) {
      return report;
    }

    for (const entry of fs.readdirSync(this.paths.runs, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("RUN-")) continue;
      const runId = entry.name;
      const runStatePath = path.join(this.runDir(runId), "run-state.json");
      if (fs.existsSync(runStatePath)) {
        const raw = readJson(runStatePath, {});
        const normalized = normalizeLegacyRunState(raw, runId);
        if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
          this.writeRunState(runId, normalized);
          report.updated_runs.push(runId);
        }

        const handoffPath = path.join(this.runDir(runId), "handoff.json");
        if (fs.existsSync(handoffPath)) {
          const rawHandoff = readJson(handoffPath, {});
          const normalizedHandoff = normalizeLegacyHandoff(rawHandoff, normalized);
          if (JSON.stringify(rawHandoff) !== JSON.stringify(normalizedHandoff)) {
            this.writeHandoff(runId, normalizedHandoff);
            report.updated_handoffs.push(runId);
          }
        }
      }
    }

    if (report.updated_runs.length > 0 || report.updated_handoffs.length > 0) {
      const verificationPath = path.join(this.paths.verification, `state-migration-report-${new Date().toISOString().replace(/[-:.TZ]/g, "")}.json`);
      writeJsonAtomic(verificationPath, report, this.paths);
    }

    return report;
  }
}

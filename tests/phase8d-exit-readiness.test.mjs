import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildPhase8DExitReadinessReport, PHASE8D_EXIT_READINESS_SCHEMA_VERSION, writePhase8DExitReadinessReport } from "../src/core/phase8d-exit-readiness.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phase8d-exit-readiness-"));
}

function copyFixtureRepoSubset(rootDir) {
  for (const repoPath of [
    "factory/mt5-ftmo-strategy-factory-spec.md",
    "factory/state.json",
    "factory/market-policy.json",
    "src/core/constants.mjs",
    "src/core/market-policy.mjs",
    "src/core/prompt-builders.mjs",
    "src/core/wfa-survivor-floors.mjs",
    "src/core/validators.mjs",
    "src/core/verification.mjs",
    "src/core/wfa-plan-compiler.mjs",
    "src/core/researchbrain-artifacts.mjs",
    "src/core/orchestrator.mjs",
    "src/core/config.mjs",
    "src/core/phase8d-exit-readiness.mjs",
    "scripts/run-phase8d-exit-readiness.mjs",
    "tests/phase8d-exit-readiness.test.mjs",
    "package.json"
  ]) {
    const source = path.resolve(repoPath);
    const target = path.join(rootDir, repoPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function writeJsonArtifact(rootDir, repoPath, payload) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    artifact_type: payload.schema_version === "hypothesis_packet_v1" ? "hypothesis_packet" : "artifact",
    path: repoPath,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex")
  };
}

function writeScreeningRun(rootDir, { runId, reason, status = "blocked", sourceRef, preregRef = null, wfaLaunched = false, belowFloorMetrics = null }) {
  const runDir = path.join(rootDir, "factory/runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const sourceHashes = [sourceRef, preregRef].filter(Boolean);
  const blocked = {
    schema_version: "phase8d_blocked_at_start_v1",
    run_id: runId,
    backlog_item_id: `IDEA-${runId}`,
    candidate_id: `CAND-${runId}`,
    lineage_id: `LINEAGE-${runId}`,
    family_id: `FAMILY-${runId}`,
    attempt_id: `${runId}:attempt-1`,
    status,
    reason,
    blocked_reason: reason,
    gate: "phase8d_pre_wfa_screening_gate",
    source_hashes: sourceHashes,
    wfa_launched: wfaLaunched,
    llm_planner_fallback_allowed: false,
    recorded_at: "2026-05-28T00:00:00Z"
  };
  const blockedRef = writeJsonArtifact(rootDir, `factory/runs/${runId}/phase8d-blocked-at-start.json`, blocked);
  blockedRef.artifact_type = "phase8d_blocked_at_start";
  const execution = {
    experiment_id: `EXP-${runId}`,
    status,
    evidence_kind: "research_wfa",
    authority_layer: "python_research",
    candidate_id: `CAND-${runId}`,
    source_hashes: sourceHashes,
    metrics_observed: belowFloorMetrics ?? {},
    observations: {
      phase8d_screening_attempt: true,
      wfa_launched: wfaLaunched,
      llm_planner_fallback_allowed: false
    },
    observed_at: "2026-05-28T00:00:00Z"
  };
  const executionRef = writeJsonArtifact(rootDir, `factory/runs/${runId}/execution-result.json`, execution);
  executionRef.artifact_type = "execution_result";
  const evidence = {
    schema_version: "phase8d_candidate_evidence_packet_v1",
    run_id: runId,
    backlog_item_id: `IDEA-${runId}`,
    candidate_id: `CAND-${runId}`,
    lineage_id: `LINEAGE-${runId}`,
    family_id: `FAMILY-${runId}`,
    attempt_id: `${runId}:attempt-1`,
    terminal_state: status,
    evidence_kind: "research_wfa",
    wfa_launched: wfaLaunched,
    source_hashes: sourceHashes,
    denominator_context: {
      attempt_is_denominator_member: true,
      failed_blocked_repaired_rerun_counted: true,
      parameter_or_scope_change_creates_new_attempt: true
    },
    wfa_metrics: belowFloorMetrics ? {
      windows: belowFloorMetrics.completed_oos_windows,
      trades: belowFloorMetrics.total_trades,
      return_proxy_pct: belowFloorMetrics.aggregate_return_pct,
      positive_oos_window_ratio: belowFloorMetrics.positive_oos_window_ratio,
      wfr: null
    } : { status: "not_applicable_before_wfa_launch" },
    advisory_statistics: {
      status: "blocked_missing_inputs",
      promotion_authority: false,
      rejection_authority: false
    },
    phase8e_boundary: {
      phase8e_authorized: false,
      mt5_mql5_parity_deployment_work_started: false,
      tester_parity_claimed: false
    },
    blocked_reasons: [reason],
    cited_artifacts: [blockedRef, executionRef],
    recorded_at: "2026-05-28T00:00:00Z"
  };
  writeJsonArtifact(rootDir, `factory/runs/${runId}/phase8d-candidate-evidence-packet.json`, evidence);
  writeJsonArtifact(rootDir, `factory/runs/${runId}/run-state.json`, { last_completed_stage: status === "blocked" ? "phase8d_blocked_at_start" : "completed" });
  if (belowFloorMetrics) {
    writeJsonArtifact(rootDir, `factory/runs/${runId}/evaluation.json`, { verdict: "research_inconclusive" });
  }
}

test("Phase 8D exit-readiness starts not ready but records completed preflight slices", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const report = buildPhase8DExitReadinessReport({ rootDir, generatedAt: "2026-05-28T00:00:00Z" });

  assert.equal(report.schema_version, PHASE8D_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(report.phase, "8D");
  assert.equal(report.status, "not_ready_to_close");
  assert.equal(report.criteria.find((item) => item.id === "stale_prediction_market_scope_removed").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "survivor_floor_constants_shared").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "phase8d_exit_readiness_reporter_exists").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "legacy_ready_wfa_routes_blocked_for_phase8d").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "deterministic_blocked_at_start_artifacts").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "targetable_screening_execution").status, "met");
  assert.equal(report.criteria.find((item) => item.id === "screening_cycle_completed").status, "pending");
  assert.equal(report.authority.zero_survivor_closeout_allowed, true);
  assert.equal(report.authority.phase8e_tester_parity_started, false);
  assert.equal(report.authority.strategy_edge_claimed, false);
});

test("Phase 8D exit-readiness reports stale scope when active state goal regresses", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const statePath = path.join(rootDir, "factory/state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.goal = "Research crypto, forex, and prediction markets.";
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const report = buildPhase8DExitReadinessReport({ rootDir, generatedAt: "2026-05-28T00:00:00Z" });
  const staleCriterion = report.criteria.find((item) => item.id === "stale_prediction_market_scope_removed");

  assert.equal(report.status, "not_ready_to_close");
  assert.equal(staleCriterion.status, "pending");
  assert.equal(report.diagnostics.stale_scope_surfaces.state_goal, false);
});

test("Phase 8D exit-readiness writer emits a verification artifact", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const report = buildPhase8DExitReadinessReport({ rootDir, generatedAt: "2026-05-28T00:00:00Z" });
  const write = writePhase8DExitReadinessReport(rootDir, report);

  assert.equal(fs.existsSync(write.path), true);
  const payload = JSON.parse(fs.readFileSync(write.path, "utf8"));
  assert.equal(payload.schema_version, PHASE8D_EXIT_READINESS_SCHEMA_VERSION);
  assert.equal(write.path.includes(path.join("factory", "verification", "phase8d-exit-readiness-")), true);
});

test("Phase 8D exit-readiness CLI writes report and exits nonzero while pending gates remain", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const scriptPath = path.resolve("scripts/run-phase8d-exit-readiness.mjs");
  const child = spawnSync(process.execPath, [scriptPath, "--root", rootDir], { encoding: "utf8" });

  assert.equal(child.status, 2, child.stderr);
  const output = JSON.parse(child.stdout);
  assert.equal(output.report.status, "not_ready_to_close");
  assert.equal(output.report.criteria.find((item) => item.id === "stale_prediction_market_scope_removed").status, "met");
  assert.equal(fs.existsSync(output.path), true);
});

test("Phase 8D exit-readiness recognizes contract-conformant screening-cycle evidence", () => {
  const rootDir = tempRoot();
  copyFixtureRepoSubset(rootDir);
  const hypothesisRef = writeJsonArtifact(rootDir, "factory/research/manual/HYP-PHASE8D-CONTRACT.json", {
    schema_version: "hypothesis_packet_v1",
    hypothesis_id: "HYP-PHASE8D-CONTRACT"
  });
  const preregRef = writeJsonArtifact(rootDir, "factory/research/preregistrations/PREREG-PHASE8D-CONTRACT.json", {
    schema_version: "research_wfa_preregistration_v1",
    candidate_id: "CAND-RUN-PHASE8D-BELOW-FLOOR"
  });
  preregRef.artifact_type = "research_wfa_preregistration";

  writeScreeningRun(rootDir, {
    runId: "RUN-PHASE8D-MISSING-PREREG",
    reason: "missing_research_wfa_preregistration",
    sourceRef: hypothesisRef
  });
  writeScreeningRun(rootDir, {
    runId: "RUN-PHASE8D-SOURCE-QUALITY",
    reason: "researchbrain_source_quality_gate_not_wfa_ready",
    sourceRef: hypothesisRef
  });
  writeScreeningRun(rootDir, {
    runId: "RUN-PHASE8D-BELOW-FLOOR",
    reason: "executed_below_survivor_floor",
    status: "executed",
    sourceRef: hypothesisRef,
    preregRef,
    wfaLaunched: true,
    belowFloorMetrics: {
      completed_oos_windows: 3,
      total_trades: 40,
      aggregate_return_pct: 1.5,
      positive_oos_window_ratio: 0.5
    }
  });
  writeJsonArtifact(rootDir, "factory/verification/phase8d-exit-readiness-existing.json", {
    schema_version: PHASE8D_EXIT_READINESS_SCHEMA_VERSION
  });

  const report = buildPhase8DExitReadinessReport({ rootDir, generatedAt: "2026-05-28T00:00:00Z" });
  const byId = Object.fromEntries(report.criteria.map((item) => [item.id, item.status]));

  assert.equal(byId.screening_cycle_completed, "met");
  assert.equal(byId.preregistration_gate_verified, "met");
  assert.equal(byId.source_quality_gate_verified, "met");
  assert.equal(byId.survivor_floor_enforcement_verified, "met");
  assert.equal(byId.denominator_tracking_exists, "met");
  assert.equal(byId.candidate_evidence_packets_exist, "met");
  assert.equal(byId.advisory_stats_boundary_preserved, "met");
  assert.equal(byId.no_phase8e_leak, "met");
  assert.equal(byId.no_post_hoc_winner_selection, "met");
  assert.equal(byId.phase8d_closeout_artifact_exists, "met");
  assert.equal(report.status, "ready_to_close");
});

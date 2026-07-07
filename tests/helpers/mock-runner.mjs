import path from "path";
import { ensureDir, writeTextAtomic } from "../../src/core/fs-utils.mjs";
import { buildPaths } from "../../src/core/paths.mjs";

/**
 * Test-only mock runner. Replaces the retired SimulateRunner for orchestrator tests
 * that need to cycle through stages without a live OpenCode server.
 * NOT used in production — only imported by test files.
 */
export class MockRunner {
  constructor({ rootDir }) {
    this.rootDir = rootDir;
    this.paths = buildPaths(rootDir);
    this.counter = 0;
    this.runSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async init() {
    return true;
  }

  async callAgent(agent, promptText, options = {}) {
    this.counter += 1;
    const sessionId = `MOCK-SESSION-${this.runSeed}-${String(this.counter).padStart(4, "0")}`;
    const sessionUrl = `mock://session/${sessionId}`;
    if (typeof options.onSessionCreated === "function") {
      await options.onSessionCreated({ sessionId, sessionUrl });
    }
    const experimentId = `EXP-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${String(this.counter).padStart(2, "0")}`;
    if (agent === "ideator") {
      const body = {
        title: "Mock liquid-crypto trend-following replenishment idea",
        objective: "Test whether a simple trend filter on a liquid crypto instrument selected at planning time can be turned into a real WFA plan.",
        priority: 75,
        category: "strategy",
        market_family: "crypto",
        instrument_scope: "Liquid crypto spot instrument chosen explicitly at planning time",
        timeframe: "Strategy-chosen liquid-market timeframe",
        history_requirement: "Multi-year history for the selected liquid crypto instrument.",
        data_source: "existing_fetcher",
        data_requirement: "OHLCV for one explicitly chosen liquid crypto instrument with the deepest realistic history"
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
    }

    if (agent === "planner") {
      const body = {
        experiment_id: experimentId,
        title: "Mock baseline WFA verification",
        backlog_item_id: "IDEA-0001",
        objective: "Verify that the baseline WFA engine can be executed reproducibly on demo data.",
        hypothesis: "If the harness and demo data are wired correctly, the engine will produce result JSON and trades CSV.",
        strategy_rationale: "Synthetic planning artifact for orchestration verification only.",
        strategy_type: "momentum",
        market_family: "crypto",
        instrument_scope: "Single explicit demo instrument for orchestration-only validation",
        instrument_selection_rule: "Pick one liquid demo instrument only for orchestration verification, not research narrowing.",
        timeframe: "Explicit demo timeframe chosen for orchestration verification only",
        priority: 100,
        dataset_requirements: [],
        historical_depth_requirement: {
          target: "Demo dataset only",
          justification: "Mock mode validates orchestration, not real research depth."
        },
        source_plan: {
          allowed_source_families: ["existing_fetcher"],
          primary_source_family: "existing_fetcher",
          selection_reason: "Mock mode uses a synthetic local dataset path to verify orchestration only."
        },
        scope_selection_rationale: "Use one explicit crypto demo scope so planner output still carries the same machine-checkable fields required in live mode.",
        data_acquisition: {
          status: "present",
          reason: "Demo dataset is already present for orchestration verification.",
          acquisition_method: "existing_fetcher",
          sources: [],
          commands: [],
          expected_outputs: []
        },
        inputs: [],
        implementation_steps: [
          "Run the baseline WFA engine on demo data.",
          "Collect metrics artifacts.",
          "Record evidence in the factory state."
        ],
        commands: [],
        expected_artifacts: ["factory/runs/mock_baseline/mock_note.txt"],
        advanced_wfa_config: {
          n_parameter_trials: 10,
          sampling_strategy: "tpe",
          "backtest.fees": 0.0006,
          "backtest.slippage": 0.0002,
          training_months: 3,
          testing_months: 1,
          step_months: 1,
          primary_objective: "sharpe",
          secondary_objectives: [],
          stability_weight: 0.1
        },
        evaluation_criteria: {
          status_gate: "report.json exists and includes out_of_sample metrics",
          metrics: {
            min_sharpe_oos: 1.0,
            min_wfr: 0.5,
            max_drawdown_pct: 35,
            min_trades: 30
          },
          min_evidence_score: 60
        },
        fallback_if_blocked: ["Check data path", "Check Python availability"],
        notes: ["Synthetic plan created by mock runner."]
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
    }

    if (agent === "executor") {
      const resultDir = path.join(this.rootDir, "factory", "runs", "mock_baseline");
      ensureDir(resultDir, this.paths);
      writeTextAtomic(path.join(resultDir, "mock_note.txt"), "Mock runner executed orchestrator-only artifact generation.\n", this.paths);
      const body = {
        experiment_id: experimentId,
        status: "partial",
        commands_attempted: ["mock: no live OpenCode execution used"],
        commands_completed: ["mock: wrote non-evidentiary artifact"],
        artifacts_created: ["factory/runs/mock_baseline/mock_note.txt"],
        datasets_acquired: [],
        artifacts_updated: [],
        workspace_changes: ["factory/runs/mock_baseline/mock_note.txt"],
        metrics_observed: {
          sharpe_is: null,
          sharpe_oos: null,
          wfr: null,
          is_oos_ratio: null,
          max_drawdown: null,
          win_rate: null,
          total_trades: null,
          fold_variance: null
        },
        variants_tested: [],
        blockers: ["Mock runner does not run the live WFA engine."],
        errors: [
          {
            command: "mock: no live OpenCode execution used",
            message: "Synthetic execution stopped before real WFA outputs by design.",
            suggestion: "Use live mode for real evidence.",
            code_path_inspected: "tests/helpers/mock-runner.mjs",
            recovery_attempts: ["Wrote a clearly synthetic artifact instead of claiming real WFA execution."]
          }
        ],
        notes: [
          "Synthetic execution result for orchestration verification only.",
          `Prompt digest length: ${promptText.length}`
        ]
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
    }

    if (agent === "evaluator") {
      const body = {
        experiment_id: experimentId,
        verdict: "inconclusive",
        evidence_score: 25,
        performance_score: 0,
        robustness_score: 0,
        novelty_score: 5,
        overall_score: 10,
        metrics: {
          sharpe_is: null,
          sharpe_oos: null,
          wfr: null,
          is_oos_ratio: null,
          max_drawdown: null,
          win_rate: null,
          total_trades: null,
          fold_variance: null,
          markets_tested: []
        },
        red_flags: ["mock_runner", "no_real_wfa_outputs"],
        verification: {
          artifacts_checked: ["factory/runs/mock_baseline/mock_note.txt"],
          metrics_verified_from: [],
          missing_or_unverified: ["Real backtest report", "Out-of-sample metrics"]
        },
        strengths: ["State transitions and artifact writing executed."],
        weaknesses: [
          {
            type: "no_live_execution",
            cross_experiment_patterns: "Mock runner is orchestration-only and cannot establish trading validity."
          }
        ],
        missing_evidence: ["Real backtest report", "Out-of-sample metrics"],
        promote_to_leaderboard: false,
        leaderboard_tier: "rejected",
        next_backlog_actions: ["Run the real WFA engine", "Use live mode with model credentials"],
        confidence_level: "high",
        confidence_rationale: "The absence of real WFA outputs is explicit and verified."
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
    }

    if (agent === "summarizer") {
      const body = {
        experiment_id: experimentId,
        backlog_item_id: "IDEA-0001",
        summary: "Mock runner verified orchestrator mechanics but did not establish trading evidence.",
        key_lessons: [
          {
            lesson: "Persistent state and artifact writing work end-to-end.",
            specific_finding: "The mock path can exercise the full orchestrator without claiming real evidence.",
            result: {
              sharpe_oos: null,
              wfr: null,
              max_drawdown: null,
              trades: null
            }
          },
          {
            lesson: "Mock output must remain clearly separated from real evidence.",
            specific_finding: "Synthetic artifacts should not be interpreted as WFA results or promotable evidence.",
            result: {
              sharpe_oos: null,
              wfr: null,
              max_drawdown: null,
              trades: null
            }
          }
        ],
        next_actions: [
          {
            action: "Run smoke test with actual Python WFA harness",
            rationale: "Verify the non-mocked path still works.",
            priority: "medium"
          },
          {
            action: "Use live mode for real OpenCode-driven research",
            rationale: "Only live mode can produce promotable WFA evidence.",
            priority: "high"
          }
        ]
      };
      return { text: `<RF_JSON>\n${JSON.stringify(body, null, 2)}\n</RF_JSON>`, raw: body, sessionId, sessionUrl };
    }

    throw new Error(`Unknown mock agent: ${agent}`);
  }

  async close() {}
}

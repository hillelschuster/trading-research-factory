import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeRetrievalArtifactPaths } from "../src/core/retrieval-artifacts.mjs";
import { buildExecutorRetrieval, buildPlannerRetrieval, buildSummarizerRetrieval } from "../src/core/retrieval.mjs";

test("sanitizeRetrievalArtifactPaths keeps only retrieval-safe final artifacts", () => {
  const paths = sanitizeRetrievalArtifactPaths([
    "factory/experiments/EXP-1.plan.json",
    "factory/summaries/RUN-1.md",
    "factory/runs/RUN-1/execution-result.json",
    "workspace/results/demo/report.json",
    "factory/runs/RUN-1/planner-attempt-1/stage-input.json",
    "factory/runs/RUN-1/executor-attempt-1/stage-error.json",
    "factory/runs/RUN-1/handoff.json",
    ".opencode/session.log",
    "workspace/data/demo.csv"
  ]);

  assert.deepEqual(paths, [
    "factory/experiments/EXP-1.plan.json",
    "factory/summaries/RUN-1.md",
    "factory/runs/RUN-1/execution-result.json",
    "workspace/results/demo/report.json"
  ]);
});

test("executor retrieval never surfaces diagnostic artifacts", () => {
  const retrieval = buildExecutorRetrieval({
    retrievalIndex: [{
      source_type: "lesson",
      mode: "live",
      verdict: "failed",
      stage_targets: ["executor"],
      retrieval_text: "executor blocker with good and bad paths",
      related_artifact_paths: [
        "factory/runs/RUN-1/executor-attempt-1/stage-input.json",
        "factory/runs/RUN-1/executor-attempt-1/stage-error.json",
        "factory/runs/RUN-1/handoff.json",
        "factory/runs/RUN-1/execution-result.json",
        "factory/summaries/RUN-1.md",
        "workspace/results/demo/report.json"
      ],
      snippet: {
        lesson: "Keep only final evidence paths in executor retrieval."
      }
    }]
  }, {
    title: "Test plan",
    objective: "Check retrieval hygiene",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTCUSDT",
    timeframe: "1h"
  });

  assert.deepEqual(retrieval.relevant_paths, [
    "factory/runs/RUN-1/execution-result.json",
    "factory/summaries/RUN-1.md",
    "workspace/results/demo/report.json"
  ]);
  assert.equal(retrieval.relevant_execution_lessons[0].related_artifact_paths.includes("factory/runs/RUN-1/executor-attempt-1/stage-input.json"), false);
});

test("stage-specific retrieval outputs stay compact", () => {
  const lessonEntries = Array.from({ length: 8 }, (_, index) => ({
    source_type: "lesson",
    mode: "live",
    verdict: index % 2 === 0 ? "failed" : "promising",
    stage_targets: ["planner", "executor", "summarizer"],
    retrieval_text: `btc momentum lesson ${index}`,
    market_family: "crypto",
    asset_scope: "BTCUSDT",
    timeframe: "1h",
    experiment_id: `EXP-${index}`,
    related_artifact_paths: ["factory/summaries/RUN-1.md"],
    snippet: { lesson: `lesson ${index}` }
  }));

  const planner = buildPlannerRetrieval({ retrievalIndex: lessonEntries }, {
    title: "BTC momentum",
    objective: "Plan BTCUSDT 1h momentum",
    market_family: "crypto",
    instrument_scope: "BTCUSDT",
    timeframe: "1h"
  });
  const executor = buildExecutorRetrieval({ retrievalIndex: lessonEntries }, {
    title: "BTC execution",
    objective: "Run BTCUSDT momentum",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTCUSDT",
    timeframe: "1h"
  });
  const summarizer = buildSummarizerRetrieval({ retrievalIndex: lessonEntries }, {
    title: "BTC summarize",
    objective: "Summarize BTCUSDT momentum",
    strategy_type: "momentum",
    market_family: "crypto",
    instrument_scope: "BTCUSDT",
    timeframe: "1h"
  }, {
    verdict: "promising"
  });

  assert.equal(planner.relevant_lessons.length <= 4, true);
  assert.equal(executor.relevant_execution_lessons.length <= 4, true);
  assert.equal(summarizer.comparable_prior_lessons.length <= 2, true);
});

export const REQUIRED_LAYOUT = [
  "factory/state.json",
  "factory/backlog.json",
  "factory/leaderboard.json",
  "factory/verification",
  "factory/evidence/index.json",
  "factory/memory/lessons.jsonl",
  "workspace/harness",
  "workspace/strategies",
  "workspace/data",
  "workspace/data/fetchers"
];

export const FACTORY_GOAL = "An autonomous trading research factory that continuously converts raw ideas into scored evidence across crypto, forex, and prediction markets.";

export const DEFAULT_MODEL = "opencode/minimax-m2.5-free";

export const DEFAULT_CYCLES = 5;

export const DEFAULT_INTERVAL_MS = 5000;

export const MAX_CONSECUTIVE_FAILURES = 5;

export const DEFAULT_STAGE_PROMPT_BUDGETS = {
  ideator: 10000,
  planner: 32000,
  executor: 24000,
  evaluator: 10000,
  summarizer: 16000
};

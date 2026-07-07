import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { DEFAULT_STAGE_PROMPT_BUDGETS } from "./constants.mjs";
import { resolveCanonicalRoot } from "./root-identity.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseBooleanish(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

export function loadRuntimeConfig(argv, cwd = process.cwd()) {
  const args = parseArgs(argv);
  const mode = args.mode || process.env.RESEARCH_FACTORY_MODE || "live";
  const cycles = Number(args.cycles ?? process.env.RESEARCH_FACTORY_CYCLES ?? 0);
  const intervalMs = Number(args["interval-ms"] ?? process.env.RESEARCH_FACTORY_INTERVAL_MS ?? 5000);
  const maxRetries = Number(args["max-retries"] ?? process.env.RESEARCH_FACTORY_MAX_RETRIES ?? 3);
  const agentTimeoutMs = Number(args["agent-timeout-ms"] ?? process.env.RESEARCH_FACTORY_AGENT_TIMEOUT_MS ?? 0);
  const openBrowser = args["no-open-browser"]
    ? false
    : (parseBooleanish(args["open-browser"] ?? process.env.RESEARCH_FACTORY_OPEN_BROWSER) ?? mode === "live");
  const projectRoot = resolveCanonicalRoot(path.resolve(__dirname, "../.."), { cwd });
  const rootIdentity = resolveCanonicalRoot(args.root ?? process.env.RESEARCH_FACTORY_ROOT ?? projectRoot.realPath, { cwd });
  const rootDir = rootIdentity.realPath;
  const model = process.env.RESEARCH_FACTORY_MODEL || "opencode/minimax-m2.5-free";
  const livePluginPolicy = { allowedPlugins: [] };
  const liveTransportAdapter = process.env.RESEARCH_FACTORY_LIVE_TRANSPORT || "auto";
  const observerHost = process.env.RESEARCH_FACTORY_OBSERVER_HOST || "127.0.0.1";
  const observerPort = Number(process.env.RESEARCH_FACTORY_OBSERVER_PORT ?? 4310);
  const observerBaseUrl = `http://${observerHost}:${observerPort}`;
  const screeningBacklogItemId = args["screening-backlog-id"] ?? args["backlog-id"] ?? process.env.RESEARCH_FACTORY_SCREENING_BACKLOG_ID ?? null;
  const liveTransportTimeouts = {
    bootMs: Number(process.env.RESEARCH_FACTORY_TRANSPORT_BOOT_TIMEOUT_MS ?? 20000),
    probeMs: Number(process.env.RESEARCH_FACTORY_TRANSPORT_PROBE_TIMEOUT_MS ?? 10000),
    sessionCreateMs: Number(process.env.RESEARCH_FACTORY_TRANSPORT_SESSION_CREATE_TIMEOUT_MS ?? 30000),
    firstHeadersMs: Number(process.env.RESEARCH_FACTORY_TRANSPORT_FIRST_HEADERS_TIMEOUT_MS ?? 0),
    totalRequestMs: Number(process.env.RESEARCH_FACTORY_TRANSPORT_TOTAL_REQUEST_TIMEOUT_MS ?? agentTimeoutMs ?? 0),
    shutdownMs: Number(process.env.RESEARCH_FACTORY_TRANSPORT_SHUTDOWN_TIMEOUT_MS ?? 5000)
  };
  const poisonedRunPolicy = {
    cooldownStreak: Number(process.env.RESEARCH_FACTORY_POISON_COOLDOWN_STREAK ?? 3),
    quarantineStreak: Number(process.env.RESEARCH_FACTORY_POISON_QUARANTINE_STREAK ?? 5),
    cooldownAttempts: Number(process.env.RESEARCH_FACTORY_POISON_COOLDOWN_ATTEMPTS ?? 6),
    quarantineAttempts: Number(process.env.RESEARCH_FACTORY_POISON_QUARANTINE_ATTEMPTS ?? 9),
    cooldownMs: Number(process.env.RESEARCH_FACTORY_POISON_COOLDOWN_MS ?? 900000),
    quarantineMs: Number(process.env.RESEARCH_FACTORY_POISON_QUARANTINE_MS ?? 86400000)
  };
  const promptBudgetPolicy = {
    strict: parseBooleanish(process.env.RESEARCH_FACTORY_PROMPT_BUDGET_STRICT) ?? false,
    stageBudgets: {
      ...DEFAULT_STAGE_PROMPT_BUDGETS,
      ideator: Number(process.env.RESEARCH_FACTORY_PROMPT_BUDGET_IDEATOR ?? DEFAULT_STAGE_PROMPT_BUDGETS.ideator),
      planner: Number(process.env.RESEARCH_FACTORY_PROMPT_BUDGET_PLANNER ?? DEFAULT_STAGE_PROMPT_BUDGETS.planner),
      executor: Number(process.env.RESEARCH_FACTORY_PROMPT_BUDGET_EXECUTOR ?? DEFAULT_STAGE_PROMPT_BUDGETS.executor),
      evaluator: Number(process.env.RESEARCH_FACTORY_PROMPT_BUDGET_EVALUATOR ?? DEFAULT_STAGE_PROMPT_BUDGETS.evaluator),
      summarizer: Number(process.env.RESEARCH_FACTORY_PROMPT_BUDGET_SUMMARIZER ?? DEFAULT_STAGE_PROMPT_BUDGETS.summarizer)
    }
  };
  return { mode, cycles, intervalMs, maxRetries, agentTimeoutMs, openBrowser, rootDir, rootIdentity, model, livePluginPolicy, liveTransportAdapter, observerHost, observerPort, observerBaseUrl, liveTransportTimeouts, poisonedRunPolicy, promptBudgetPolicy, screeningBacklogItemId, command: args._[0] ?? "run" };
}

export function parseModelString(modelString) {
  const [providerID, ...rest] = modelString.split("/");
  if (!providerID || rest.length === 0) throw new Error(`Invalid model string: ${modelString}`);
  return { providerID, modelID: rest.join("/") };
}

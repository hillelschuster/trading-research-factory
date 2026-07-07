import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createResearchBrainToolRuntime, RESEARCHBRAIN_ALLOWED_TOOLS } from "./researchbrain-tools.mjs";
import { sanitizeRetryErrorMessage } from "./retry-policy.mjs";

// Tool categories for synthesis-phase gating (live provider only)
const NEW_SEARCH_TOOLS = new Set([
  "search_web", "search_official_docs", "search_mql5_sources",
  "search_broker_docs", "search_youtube", "search_arxiv",
  "search_github_code", "search_reddit", "search_semantic_scholar"
]);

const CORE_RECORD_AND_MEMORY_TOOLS = new Set([
  "search_research_memory", "check_duplicate_memory",
  "check_failed_pattern_similarity",
  "record_hypothesis", "record_rejection"
]);

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (typeof repoRelativePath !== "string" || repoRelativePath.trim().length === 0 || path.isAbsolute(repoRelativePath)) {
    throw new Error(`ResearchBrain agent ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain agent ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function artifactRef(rootDir, fullPath) {
  return {
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath)
  };
}

function writeText(rootDir, repoPath, value) {
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "output_path");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return artifactRef(rootDir, fullPath);
}

function writeJson(rootDir, repoPath, value) {
  return writeText(rootDir, repoPath, JSON.stringify(value, null, 2));
}

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function estimateCostUsd(stepCount) {
  return Number((stepCount * 0.000001).toFixed(8));
}

export function createScriptedResearchBrainAgentProvider({
  script = [],
  allowedTools = RESEARCHBRAIN_ALLOWED_TOOLS,
  maxToolCalls = 20,
  maxCostUsd = 0.01,
  maxTranscriptBytes = 250_000,
  requireDiscoveryBeforeCapture = true,
  toolMode = "fixture",
  sourceToolAdapter = null,
  retryPolicy = {}
} = {}) {
  const allowed = new Set(allowedTools);
  let calls = 0;
  let runtimeArtifacts = [];
  let lastToolLedger = null;
  let lastCostLedger = null;

  function writeAgentArtifacts({ rootDir, runRepoDir, transcript, toolLedger, costLedger, notes }) {
    const refs = [];
    refs.push({ artifact_type: "researchbrain_agent_transcript", ...writeText(rootDir, `${runRepoDir}/agent-transcript.jsonl`, jsonl(transcript)) });
    refs.push({ artifact_type: "researchbrain_tool_ledger", ...writeJson(rootDir, `${runRepoDir}/tool-ledger.json`, toolLedger) });
    refs.push({ artifact_type: "researchbrain_cost_ledger", ...writeJson(rootDir, `${runRepoDir}/cost-ledger.json`, costLedger) });
    refs.push({ artifact_type: "researchbrain_working_notes", ...writeText(rootDir, `${runRepoDir}/working-notes.md`, notes) });
    runtimeArtifacts = refs;
  }

  return {
    name: "scripted_researchbrain_agent_provider",
    mode: "scripted_agent_fixture",
    live_research: false,
    get calls() {
      return calls;
    },
    getRuntimeArtifacts() {
      return runtimeArtifacts;
    },
    getLastLedgers() {
      return { toolLedger: lastToolLedger, costLedger: lastCostLedger };
    },
    async generate(context) {
      calls += 1;
      const rootDir = path.resolve(context.root_dir ?? process.cwd());
      const runRepoDir = context.run_repo_dir;
      const observedAt = context.observed_at ?? new Date().toISOString();
      const runId = context.run_id ?? `RESEARCHBRAIN-STAGE0-SCRIPTED-${Date.now()}`;
      if (!runRepoDir) throw new Error("scripted ResearchBrain agent requires run_repo_dir in provider context");

      const transcript = [];
      const toolCalls = [];
      const costEvents = [];
      let output = null;
      let failure = null;

      const toolRuntime = createResearchBrainToolRuntime({
        rootDir,
        runRepoDir,
        runId,
        request: context.request,
        observedAt,
        requireDiscoveryBeforeCapture,
        toolMode,
        sourceToolAdapter,
        retryPolicy
      });

      try {
        transcript.push({ role: "system", ts: observedAt, content: "Bounded Stage-0 ResearchBrain scripted agent. No live LLM/network/WFA/MT5/profitability authority." });
        transcript.push({ role: "memory", ts: observedAt, content: {
          prior_failed_patterns: asArray(context.request?.prior_failed_patterns).slice(0, 10),
          prior_lessons: asArray(context.request?.prior_lessons).slice(0, 10),
          prior_hypothesis_packets: asArray(context.request?.prior_hypothesis_packets).slice(0, 10),
          prior_source_records: asArray(context.request?.prior_source_records).slice(0, 10)
        } });

        for (let index = 0; index < script.length; index += 1) {
          const step = script[index];
          const toolName = step.tool;
          if (toolCalls.length >= maxToolCalls) throw new Error(`ResearchBrain tool call budget exceeded: ${maxToolCalls}`);
          if (!allowed.has(toolName)) throw new Error(`ResearchBrain scripted agent requested unallowed tool: ${toolName}`);
          if (!toolRuntime.isAllowedToolName(toolName)) throw new Error(`ResearchBrain tool is not in v1 catalog: ${toolName}`);

          const projectedCost = estimateCostUsd(toolCalls.length + 1);
          if (projectedCost > maxCostUsd) throw new Error(`ResearchBrain cost budget exceeded: ${projectedCost} > ${maxCostUsd}`);

          const startedAt = new Date().toISOString();
          transcript.push({ role: "assistant", ts: startedAt, tool_call: { index: index + 1, tool: toolName, input: step.input ?? {} } });
          let result;
          try {
            result = await toolRuntime.execute(toolName, step.input ?? {});
            const endedAt = new Date().toISOString();
            const ledgerEntry = {
              index: index + 1,
              tool: toolName,
              status: "ok",
              started_at: startedAt,
              ended_at: endedAt,
              input: step.input ?? {},
              output: result
            };
            toolCalls.push(ledgerEntry);
            transcript.push({ role: "tool", ts: endedAt, tool: toolName, result });
            costEvents.push({ event: "tool_call", tool: toolName, estimated_cost_usd: estimateCostUsd(1), cumulative_estimated_cost_usd: estimateCostUsd(toolCalls.length) });
          } catch (error) {
            const rawReason = error instanceof Error ? error.message : String(error);
            const reason = sanitizeRetryErrorMessage(rawReason);
            const endedAt = new Date().toISOString();
            toolCalls.push({ index: index + 1, tool: toolName, status: "error", started_at: startedAt, ended_at: endedAt, input: step.input ?? {}, reason, retry_attempts: error?.rf_retry_attempts ?? [] });
            transcript.push({ role: "tool", ts: endedAt, tool: toolName, error: reason });
            // External source/tool errors (from adapter retries) are non-terminal:
            // sanitize, record, and continue next script step.
            // Internal validation/schema errors (no rf_retry_attempts) remain fatal.
            if (!error?.rf_retry_attempts) throw error;
          }

          const transcriptBytes = Buffer.byteLength(jsonl(transcript), "utf8");
          if (transcriptBytes > maxTranscriptBytes) throw new Error(`ResearchBrain transcript byte budget exceeded: ${transcriptBytes} > ${maxTranscriptBytes}`);
        }

        output = toolRuntime.buildProviderOutput({ researchRunId: runId, providerMode: "scripted_agent_fixture" });
        transcript.push({ role: "assistant", ts: new Date().toISOString(), final_output: { source_captures: output.source_captures.length, hypothesis_packets: output.hypothesis_packets.length } });
        return output;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        transcript.push({ role: "assistant", ts: new Date().toISOString(), error: failure });
        throw error;
      } finally {
        const toolLedger = {
          schema_version: "researchbrain_tool_ledger_v1",
          generated_at: new Date().toISOString(),
          provider_mode: "scripted_agent_fixture",
          tool_mode: toolMode,
          live_research: toolMode === "live",
          allowed_tools: [...allowed],
          tool_calls: toolCalls,
          captured_artifacts: toolRuntime.state.artifacts,
          failure
        };
        const costLedger = {
          schema_version: "researchbrain_cost_ledger_v1",
          generated_at: new Date().toISOString(),
          provider_mode: "scripted_agent_fixture",
          tool_mode: toolMode,
          live_llm: false,
          estimated_cost_usd: estimateCostUsd(toolCalls.length),
          max_cost_usd: maxCostUsd,
          events: costEvents,
          failure
        };
        const notes = [
          "# ResearchBrain Working Notes",
          "",
          "Deterministic fake/scripted agent run only.",
          "No live LLM, live web, WFA, MT5, MQL5 compilation, market data, trading, profitability estimation, or official state mutation occurred.",
          failure ? `Failure: ${failure}` : "Final Stage-0 provider output was produced for runtime validation."
        ].join("\n");
        lastToolLedger = toolLedger;
        lastCostLedger = costLedger;
        writeAgentArtifacts({ rootDir, runRepoDir, transcript, toolLedger, costLedger, notes });
        runtimeArtifacts = [...runtimeArtifacts, ...toolRuntime.state.artifacts];
      }
    }
  };
}

export function createLiveResearchBrainAgentProvider({
  llmClient,
  allowLiveLlm = false,
  llmProvider = "unspecified",
  llmModel = "unspecified",
  allowedTools = RESEARCHBRAIN_ALLOWED_TOOLS,
  maxLlmCalls = 12,
  maxToolCalls = 50,
  maxCostUsd = 0.25,
  maxTranscriptBytes = 250_000,
  requireDiscoveryBeforeCapture = true,
  toolMode = "live",
  sourceToolAdapter = null,
  retryPolicy = {}
} = {}) {
  if (allowLiveLlm !== true) throw new Error("Live ResearchBrain LLM provider requires explicit allowLiveLlm=true");
  if (!llmClient || typeof llmClient.generate !== "function") throw new Error("Live ResearchBrain LLM provider requires llmClient.generate(context)");
  if (!Number.isInteger(maxLlmCalls) || maxLlmCalls < 1 || maxLlmCalls > 20) throw new Error("maxLlmCalls must be an integer from 1 to 20");
  const allowed = new Set(allowedTools);
  let calls = 0;
  let runtimeArtifacts = [];
  let lastToolLedger = null;
  let lastCostLedger = null;

  function writeAgentArtifacts({ rootDir, runRepoDir, transcript, toolLedger, costLedger, notes }) {
    const refs = [];
    refs.push({ artifact_type: "researchbrain_agent_transcript", ...writeText(rootDir, `${runRepoDir}/agent-transcript.jsonl`, jsonl(transcript)) });
    refs.push({ artifact_type: "researchbrain_tool_ledger", ...writeJson(rootDir, `${runRepoDir}/tool-ledger.json`, toolLedger) });
    refs.push({ artifact_type: "researchbrain_cost_ledger", ...writeJson(rootDir, `${runRepoDir}/cost-ledger.json`, costLedger) });
    refs.push({ artifact_type: "researchbrain_working_notes", ...writeText(rootDir, `${runRepoDir}/working-notes.md`, notes) });
    runtimeArtifacts = refs;
  }

  return {
    name: "live_researchbrain_agent_provider",
    mode: "live_llm_agent",
    live_research: true,
    llm_provider: llmProvider,
    llm_model: llmModel,
    get calls() {
      return calls;
    },
    getRuntimeArtifacts() {
      return runtimeArtifacts;
    },
    getLastLedgers() {
      return { toolLedger: lastToolLedger, costLedger: lastCostLedger };
    },
    async generate(context) {
      calls += 1;
      const rootDir = path.resolve(context.root_dir ?? process.cwd());
      const runRepoDir = context.run_repo_dir;
      const observedAt = context.observed_at ?? new Date().toISOString();
      const runId = context.run_id ?? `RESEARCHBRAIN-STAGE0-LIVE-${Date.now()}`;
      if (!runRepoDir) throw new Error("live ResearchBrain agent requires run_repo_dir in provider context");

      const transcript = [];
      const toolCalls = [];
      const costEvents = [];
      let output = null;
      let failure = null;

      const toolRuntime = createResearchBrainToolRuntime({
        rootDir,
        runRepoDir,
        runId,
        request: context.request,
        observedAt,
        requireDiscoveryBeforeCapture,
        toolMode,
        sourceToolAdapter,
        retryPolicy
      });

      try {
        transcript.push({ role: "system", ts: observedAt, content: "Bounded Stage-0 ResearchBrain live LLM agent. Tools are deterministic; final output has no WFA/MT5/profitability authority." });
        transcript.push({ role: "memory", ts: observedAt, content: {
          prior_failed_patterns: asArray(context.request?.prior_failed_patterns).slice(0, 10),
          prior_lessons: asArray(context.request?.prior_lessons).slice(0, 10),
          prior_hypothesis_packets: asArray(context.request?.prior_hypothesis_packets).slice(0, 10),
          prior_source_records: asArray(context.request?.prior_source_records).slice(0, 10)
        } });

        for (let llmCall = 1; llmCall <= maxLlmCalls; llmCall += 1) {
          const projectedCost = estimateCostUsd(toolCalls.length + llmCall);
          if (projectedCost > maxCostUsd) throw new Error(`ResearchBrain live LLM cost budget exceeded: ${projectedCost} > ${maxCostUsd}`);
          const adapterAwareTools = toolRuntime.getAllowedToolNames().filter((toolName) => allowed.has(toolName));

          // Synthesis-phase tool gating — hard restrictions on tool availability
          // to prevent endless scouting when budget runs low.
          // Check 80% BEFORE 60% to fix the previously dead 80% branch.
          const budgetPctInt = Math.round((toolCalls.length / maxToolCalls) * 100);
          const hasZeroHypotheses = toolRuntime.state.hypotheses.length === 0;
          const isFinalTurn = llmCall === maxLlmCalls;

          let allowedForTurn;
          if (budgetPctInt >= 80 || isFinalTurn) {
            // 80%+ or final LLM turn: only memory prerequisites and record tools
            allowedForTurn = adapterAwareTools.filter((toolName) => CORE_RECORD_AND_MEMORY_TOOLS.has(toolName));
          } else if (budgetPctInt >= 60 && hasZeroHypotheses && adapterAwareTools.some((t) => NEW_SEARCH_TOOLS.has(t))) {
            // ~60% with zero hypotheses: remove new search tools to force synthesis.
            // Only triggers when at least one search tool exists in the current set.
            allowedForTurn = adapterAwareTools.filter((toolName) => !NEW_SEARCH_TOOLS.has(toolName));
          } else {
            allowedForTurn = adapterAwareTools;
          }

          const llmStartedAt = new Date().toISOString();
          const response = await llmClient.generate({
            run_id: runId,
            request: context.request,
            transcript,
            allowed_tools: allowedForTurn,
            llm_provider: llmProvider,
            llm_model: llmModel,
            signal: context.signal
          });
          const llmEndedAt = new Date().toISOString();
          transcript.push({ role: "assistant", ts: llmEndedAt, llm_call: llmCall, response });
          costEvents.push({ event: "llm_call", llm_provider: llmProvider, llm_model: llmModel, estimated_cost_usd: estimateCostUsd(1), cumulative_estimated_cost_usd: estimateCostUsd(costEvents.length + 1) });

          if (response?.provider_error?.retryable_for_agent === true) {
            transcript.push({ role: "system", ts: llmEndedAt, content: `Provider output error was non-terminal: ${response.provider_error.status}. Retry with compact valid JSON tool arguments.` });
            continue;
          }

          const requestedToolCalls = asArray(response?.tool_calls);
          for (const requested of requestedToolCalls) {
            const toolName = requested.tool;
            if (toolCalls.length >= maxToolCalls) throw new Error(`ResearchBrain tool call budget exceeded: ${maxToolCalls}`);
            if (!allowed.has(toolName)) throw new Error(`ResearchBrain live agent requested unallowed tool: ${toolName}`);
            if (!allowedForTurn.includes(toolName)) throw new Error(`ResearchBrain synthesis-phase gating denied tool: ${toolName}`);
            if (!toolRuntime.isAllowedToolName(toolName)) throw new Error(`ResearchBrain tool is not in v1 catalog: ${toolName}`);
            const startedAt = new Date().toISOString();
            transcript.push({ role: "assistant", ts: startedAt, tool_call: { index: toolCalls.length + 1, tool: toolName, input: requested.input ?? {} } });
            try {
              const result = await toolRuntime.execute(toolName, requested.input ?? {});
              const endedAt = new Date().toISOString();
              const ledgerEntry = {
                index: toolCalls.length + 1,
                tool: toolName,
                status: "ok",
                started_at: startedAt,
                ended_at: endedAt,
                input: requested.input ?? {},
                output: result
              };
              toolCalls.push(ledgerEntry);
              transcript.push({ role: "tool", ts: endedAt, tool: toolName, result });
              costEvents.push({ event: "tool_call", tool: toolName, estimated_cost_usd: estimateCostUsd(1), cumulative_estimated_cost_usd: estimateCostUsd(costEvents.length + 1) });
            } catch (error) {
              const rawReason = error instanceof Error ? error.message : String(error);
              const reason = sanitizeRetryErrorMessage(rawReason);
              const endedAt = new Date().toISOString();
              toolCalls.push({ index: toolCalls.length + 1, tool: toolName, status: "error", started_at: startedAt, ended_at: endedAt, input: requested.input ?? {}, reason, retry_attempts: error?.rf_retry_attempts ?? [] });
              transcript.push({ role: "tool", ts: endedAt, tool: toolName, error: reason });
              // Tool errors are non-terminal: return the error to the LLM so it can retry or adjust.
              // This covers both adapter retry failures (rf_retry_attempts set) and argument
              // validation errors (no rf_retry_attempts) — neither should kill the run.
              // Truly fatal conditions (budget exceeded, unallowed tool) throw before this block.
            }
          }

          const transcriptBytes = Buffer.byteLength(jsonl(transcript), "utf8");
          if (transcriptBytes > maxTranscriptBytes) throw new Error(`ResearchBrain transcript byte budget exceeded: ${transcriptBytes} > ${maxTranscriptBytes}`);
          if (toolRuntime.state.hypotheses.length > 0) {
            output = toolRuntime.buildProviderOutput({ researchRunId: runId, providerMode: `live_llm_agent:${llmProvider}` });
            transcript.push({ role: "assistant", ts: new Date().toISOString(), final_output: { source_captures: output.source_captures.length, hypothesis_packets: output.hypothesis_packets.length } });
            return output;
          }
          if (response?.final === true) {
            output = toolRuntime.buildProviderOutput({ researchRunId: runId, providerMode: `live_llm_agent:${llmProvider}` });
            transcript.push({ role: "assistant", ts: new Date().toISOString(), final_output: { source_captures: output.source_captures.length, hypothesis_packets: output.hypothesis_packets.length } });
            return output;
          }
          if (requestedToolCalls.length === 0) throw new Error("ResearchBrain live LLM response included no tool calls and no final=true stop signal");
          const toolCallsUsed = toolCalls.length;
          const toolCallsRemaining = maxToolCalls - toolCallsUsed;
          const budgetPct = Math.round((toolCallsUsed / maxToolCalls) * 100);
          let budgetNudge = "";
          if (budgetPct >= 80 && toolRuntime.state.hypotheses.length === 0) {
            budgetNudge = ` CRITICAL: ${budgetPct}% budget used, 0 hypotheses. Record a hypothesis from your best source immediately or call record_rejection if nothing viable found.`;
          } else if (budgetPct >= 60 && toolRuntime.state.hypotheses.length === 0) {
            budgetNudge = ` BUDGET ALERT: ${budgetPct}% of tool budget used (${toolCallsUsed}/${maxToolCalls}), ${toolCallsRemaining} calls remaining, 0 hypotheses recorded. You MUST advance to synthesis NOW. Stop searching. Form a hypothesis from what you have captured and call record_hypothesis.`;
          }
          transcript.push({ role: "system", ts: llmStartedAt, content: `Completed live LLM turn ${llmCall} at ${llmEndedAt}; deterministic tool results appended. Tool budget: ${toolCallsUsed}/${maxToolCalls} (${budgetPct}%).${budgetNudge}` });
        }
        throw new Error(`ResearchBrain live LLM call budget exceeded: ${maxLlmCalls}`);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        transcript.push({ role: "assistant", ts: new Date().toISOString(), error: failure });
        throw error;
      } finally {
        const toolLedger = {
          schema_version: "researchbrain_tool_ledger_v1",
          generated_at: new Date().toISOString(),
          provider_mode: "live_llm_agent",
          llm_provider: llmProvider,
          llm_model: llmModel,
          tool_mode: toolMode,
          live_research: true,
          allowed_tools: [...allowed],
          tool_calls: toolCalls,
          captured_artifacts: toolRuntime.state.artifacts,
          failure
        };
        const costLedger = {
          schema_version: "researchbrain_cost_ledger_v1",
          generated_at: new Date().toISOString(),
          provider_mode: "live_llm_agent",
          llm_provider: llmProvider,
          llm_model: llmModel,
          live_llm: true,
          estimated_cost_usd: estimateCostUsd(costEvents.length),
          max_cost_usd: maxCostUsd,
          events: costEvents,
          failure
        };
        const notes = [
          "# ResearchBrain Working Notes",
          "",
          `Provider seam: ${llmProvider}/${llmModel}`,
          "Bounded Stage-0 live LLM tool loop only. Deterministic validators retain all artifact/evidence authority.",
          "No WFA, MT5, MQL5 compilation, market data, trading, profitability estimation, or official state mutation occurred.",
          failure ? `Failure: ${failure}` : "Final Stage-0 provider output was produced for runtime validation."
        ].join("\n");
        lastToolLedger = toolLedger;
        lastCostLedger = costLedger;
        writeAgentArtifacts({ rootDir, runRepoDir, transcript, toolLedger, costLedger, notes });
        runtimeArtifacts = [...runtimeArtifacts, ...toolRuntime.state.artifacts];
      }
    }
  };
}

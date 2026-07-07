import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeProject } from "../src/core/init.mjs";
import { buildResearchBrainRequestArtifact, STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND } from "../src/core/researchbrain-artifacts.mjs";
import { createLiveResearchBrainAgentProvider, createScriptedResearchBrainAgentProvider } from "../src/core/researchbrain-agent.mjs";
import { createResearchBrainLlmClient } from "../src/core/researchbrain-llm-providers.mjs";
import { createBraveResearchBrainSourceToolAdapter, createCompositeResearchBrainSourceToolAdapter, createMapResearchBrainSourceToolAdapter, createResearchBrainToolRuntime, createRateLimiter, createSemanticScholarResearchBrainSourceToolAdapter } from "../src/core/researchbrain-tools.mjs";
import { runResearchBrainStage0Runtime, validateResearchBrainStage0RuntimeResult } from "../src/core/researchbrain-runtime.mjs";
import { getResearchBrainSourceAdapterEnvName, isResearchBrainSourceAdapterEnvConfigured } from "../scripts/researchbrain-stage0-provider-utils.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "researchbrain-agent-test-"));
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJsonFixture(rootDir, repoPath, value) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: repoPath, sha256: sha256File(fullPath) };
}

function writeTextFixture(rootDir, repoPath, value) {
  const fullPath = path.join(rootDir, repoPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return { path: repoPath, sha256: sha256File(fullPath) };
}

function phase8ARefs(rootDir) {
  const universe = writeJsonFixture(rootDir, "factory/mt5/environment/JOB-MT5-UNIVERSE-ATTEMPT-20260519T081345Z-WFA-VENV/universe-snapshot.json", {
    schema_version: "mt5_tradable_universe_snapshot_v1",
    evidence_kind: "mt5_tradable_universe_snapshot",
    status: "succeeded",
    server: "FTMO-Demo",
    symbol_count_total: 3,
    symbols: [{ name: "EURUSD" }, { name: "XAUUSD" }, { name: "BTCUSD" }]
  });
  const inventory = writeJsonFixture(rootDir, "factory/mt5/universe-analysis/FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV/inventory.json", {
    schema_version: "mt5_terminal_inventory_v1",
    inventory_id: "FTMO-MULTI-ASSET-TERMINAL-INVENTORY-20260519T081345Z-WFA-VENV",
    counts: { total_symbols: 3 }
  });
  return { universe_snapshot: universe, terminal_inventory: inventory };
}

function officialFileHashes(paths) {
  return Object.fromEntries([
    ["state", paths.state],
    ["backlog", paths.backlog],
    ["evidenceIndex", paths.evidenceIndex],
    ["leaderboard", paths.leaderboard],
    ["lessons", paths.lessons]
  ].map(([label, filePath]) => [label, fs.existsSync(filePath) ? sha256File(filePath) : null]));
}

function request(rootDir, extra = {}) {
  const phase8a = phase8ARefs(rootDir);
  return buildResearchBrainRequestArtifact({
    rootDir,
    requestId: extra.requestId ?? "RESEARCHBRAIN-REQUEST-AGENT-FIXTURE",
    observedAt: "2026-05-22T01:00:00Z",
    universeSnapshotPath: phase8a.universe_snapshot.path,
    terminalInventoryPath: phase8a.terminal_inventory.path,
    priorFailedPatterns: extra.priorFailedPatterns ?? [],
    priorLessons: extra.priorLessons ?? [],
    maxSources: extra.maxSources ?? 4,
    maxHypotheses: extra.maxHypotheses ?? 2
  });
}

function hypothesis(overrides = {}) {
  return {
    hypothesis_id: overrides.hypothesis_id ?? "HYP-STAGE0-AGENT-001",
    mechanism: overrides.mechanism ?? "Volatility contraction followed by session liquidity imbalance may create a falsifiable continuation mechanism.",
    falsifiable_prediction: overrides.falsifiable_prediction ?? "If the mechanism is real, later deterministic WFA should show OOS consistency after realistic costs; this run does not test it.",
    market_structure_assumption: "FTMO MT5 CFD symbols may expose enough bar-level structure for later deterministic falsification.",
    instrument_scope: "Any Phase 8A FTMO MT5 symbol class; no prediction markets and not crypto-only.",
    timeframe_candidate: "M15-H1 candidate only, selected later by deterministic planning.",
    strategy_family: overrides.strategy_family ?? "agent_fixture_volatility_contraction",
    mt5_relevance_classification: "mt5_relevant_unverified",
    required_data: "Terminal-backed MT5 OHLCV plus spread/swap/spec references before MT5-bound claims.",
    expected_holding_period: "Intraday to multi-session; not validated by Stage-0 discovery.",
    expected_trade_frequency: "Unknown before deterministic data checks and WFA; no profitability label assigned.",
    expected_failure_modes: ["Spread and swap costs overwhelm the mechanism.", "Effect is a post-hoc subset artifact."],
    invalidation_criteria: ["No later OOS consistency after costs.", "No defensible MT5 instrument equivalence."],
    implementation_shape: "Rule-based signal candidate for later deterministic planning only.",
    execution_sensitivity: "Sensitive to spreads, swaps, sessions, rollover, and CFD symbol specs.",
    mt5_ftmo_concerns: "Requires terminal specs and later FTMO rule accounting before any promotion path.",
    prior_related_lessons: ["Avoid RSI-only and post-hoc Sharpe-chasing variants."],
    prior_failed_patterns_checked: ["Prior failed-pattern memory was checked before recording this hypothesis."],
    novelty_reason: overrides.novelty_reason ?? "Scripted tool loop validates source-captured Stage-0 hypothesis plumbing without claiming an edge.",
    disconfirming_evidence: ["Source content may be anecdotal and may fail deterministic WFA later."],
    proposed_experiment_shape: "Stage-0 discovery artifact only; planner may later build a deterministic falsification plan.",
    cited_source_ids: overrides.cited_source_ids ?? ["SRC-WEB-AGENT-001"],
    source_claims: overrides.source_claims ?? [{ claim_class: "source_backed_mechanism", citation_source_id: "SRC-WEB-AGENT-001" }],
    ...overrides.extra
  };
}

function memoryCheckSteps(overrides = {}) {
  const mechanism = overrides.mechanism ?? "Volatility contraction followed by session liquidity imbalance";
  const strategyFamily = overrides.strategy_family ?? "agent_fixture_volatility_contraction";
  const instrumentScope = overrides.instrument_scope ?? "multi asset FTMO MT5 CFD symbols";
  const timeframeCandidate = overrides.timeframe_candidate ?? "M15 H1";
  const checkInput = {
    mechanism,
    strategy_family: strategyFamily,
    instrument_scope: instrumentScope,
    timeframe_candidate: timeframeCandidate,
    ...(overrides.parameters ? { parameters: overrides.parameters } : {})
  };
  return [
    { tool: "search_research_memory", input: { query: overrides.query ?? [mechanism, strategyFamily, instrumentScope, timeframeCandidate].join(" ") } },
    { tool: "check_duplicate_memory", input: checkInput },
    { tool: "check_failed_pattern_similarity", input: checkInput }
  ];
}

async function runScript(rootDir, script, options = {}) {
  return runResearchBrainStage0Runtime({
    rootDir,
    request: options.request ?? request(rootDir, options.requestOptions),
    runId: options.runId ?? "RESEARCHBRAIN-STAGE0-AGENT-RUN",
    outputDir: options.outputDir ?? "factory/research/runs/RESEARCHBRAIN-STAGE0-AGENT-RUN",
    observedAt: "2026-05-22T01:01:00Z",
    provider: createScriptedResearchBrainAgentProvider({
      script,
      allowedTools: options.allowedTools,
      maxToolCalls: options.maxToolCalls ?? 20,
      maxCostUsd: options.maxCostUsd ?? 0.01,
      maxTranscriptBytes: options.maxTranscriptBytes ?? 250_000,
      toolMode: options.toolMode ?? "fixture"
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });
}

test("fake agent searches web, captures URL source, records hypothesis, and writes ledgers", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const url = "https://example.test/volatility-contraction";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { query: "volatility contraction liquidity continuation", results: [{ result_id: "web-1", url, title: "Volatility contraction", snippet: "Discovery only", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, source_class: "web", content: "A source discusses volatility contraction followed by liquidity imbalance as a falsifiable mechanism, while noting costs and regime instability as limitations." } },
    ...memoryCheckSteps(),
    { tool: "record_hypothesis", input: hypothesis() }
  ]);

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
  for (const artifactType of ["researchbrain_agent_transcript", "researchbrain_tool_ledger", "researchbrain_cost_ledger", "researchbrain_working_notes", "research_source_record", "hypothesis_packet"]) {
    assert.equal(result.artifacts_created.some((artifact) => artifact.artifact_type === artifactType), true, artifactType);
  }
});

test("capture_url_source returns existing source instead of overwriting duplicate source_id artifacts", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/duplicate-source-id";
  const originalContent = "Original source capture with a falsifiable mechanism, limitations, and no profitability evidence.";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { query: "duplicate source id", results: [{ result_id: "web-dup-1", url, title: "Duplicate source", snippet: "Discovery only", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, source_class: "web", content: originalContent } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, source_class: "web", content: "Overwriting this content would invalidate the first artifact hash." } },
    ...memoryCheckSteps(),
    { tool: "record_hypothesis", input: hypothesis({ hypothesis_id: "HYP-STAGE0-DUPLICATE-SOURCE-ID-001" }) }
  ]);

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  const contentPath = path.join(rootDir, "factory/research/runs/RESEARCHBRAIN-STAGE0-AGENT-RUN/tool-captures/url/SRC-WEB-AGENT-001/content.md");
  assert.equal(fs.readFileSync(contentPath, "utf8").trim(), originalContent);
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8"));
  const duplicateCapture = ledger.tool_calls.find((call) => call.tool === "capture_url_source" && call.output?.status === "already_captured");
  assert.equal(duplicateCapture.output.source_id, "SRC-WEB-AGENT-001");
});

test("record_hypothesis auto-runs missing memory prerequisites", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/missing-memory";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "missing-memory-1", url, title: "Missing memory", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A fixture source exists, but the agent did not call the mandatory memory tools before recording." } },
    { tool: "record_hypothesis", input: hypothesis() }
  ], { runId: "RESEARCHBRAIN-STAGE0-MISSING-MEMORY-TOOLS", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-MISSING-MEMORY-TOOLS" });

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8"));
  const recordCall = ledger.tool_calls.find((call) => call.tool === "record_hypothesis");
  assert.deepEqual(recordCall.output.auto_memory_prerequisites.completed, ["search_research_memory", "check_duplicate_memory", "check_failed_pattern_similarity"]);
  assert.deepEqual(recordCall.output.memory_checks.required_tool_calls, {
    search_research_memory: true,
    check_duplicate_memory: true,
    check_failed_pattern_similarity: true
  });
});

test("record_hypothesis accepts core fields and defaults lower-value packet fields", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/minimal-hypothesis";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "minimal-hypothesis-1", url, title: "Minimal hypothesis", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A captured source gives a falsifiable volatility contraction mechanism with explicit limitations." } },
    {
      tool: "record_hypothesis",
      input: {
        hypothesis_id: "HYP-STAGE0-MINIMAL-CORE-001",
        mechanism: "Volatility contraction can precede liquidity-driven continuation on MT5 CFD symbols.",
        falsifiable_prediction: "Later deterministic WFA should reject this if OOS consistency disappears after realistic costs.",
        instrument_scope: "FTMO MT5 CFD symbols",
        timeframe_candidate: "M15-H1 candidate",
        strategy_family: "minimal_volatility_contraction",
        cited_source_ids: ["SRC-WEB-AGENT-001"],
        source_claims: [{ claim_class: "source_backed_mechanism", citation_source_id: "SRC-WEB-AGENT-001" }]
      }
    }
  ], { runId: "RESEARCHBRAIN-STAGE0-MINIMAL-HYPOTHESIS", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-MINIMAL-HYPOTHESIS" });

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  const packetRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "hypothesis_packet");
  const packet = JSON.parse(fs.readFileSync(path.join(rootDir, packetRef.path), "utf8"));
  assert.equal(packet.hypothesis_id, "HYP-STAGE0-MINIMAL-CORE-001");
  assert.equal(packet.mt5_relevance_classification, "mt5_relevant_unverified");
  assert.match(packet.required_data, /MT5 terminal OHLCV/i);
  assert.deepEqual(packet.prior_failed_patterns_checked, ["record_hypothesis auto-ran required memory checks; no blocking failed-pattern similarity was found."]);
});

test("record_hypothesis LLM schema only requires core fields", async () => {
  const calls = [];
  const client = createResearchBrainLlmClient({
    allowLiveLlm: true,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: "test-deepseek-key",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "chatcmpl_record_schema_fixture",
            model: "deepseek-v4-flash",
            choices: [{ finish_reason: "stop", message: { content: "done" } }]
          });
        }
      };
    }
  });

  await client.generate({ request: request(tempRoot()), transcript: [], allowed_tools: ["record_hypothesis"] });
  const schema = calls[0].body.tools[0].function.parameters;
  assert.deepEqual(schema.required.sort(), [
    "cited_source_ids",
    "falsifiable_prediction",
    "hypothesis_id",
    "instrument_scope",
    "mechanism",
    "source_claims",
    "strategy_family",
    "timeframe_candidate"
  ].sort());
  assert.equal(Object.hasOwn(schema.properties, "required_data"), true);
});

test("record_hypothesis auto-memory still blocks parameter-only failed-pattern matches", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/failed-pattern-auto-memory";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "failed-pattern-auto-1", url, title: "Failed pattern", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A fixture source discusses an RSI parameter tweak without new market structure evidence." } },
    { tool: "record_hypothesis", input: hypothesis({ mechanism: "BTCUSD RSI period threshold tweak.", strategy_family: "rsi_mean_reversion" }) }
  ], {
    runId: "RESEARCHBRAIN-STAGE0-AUTO-MEMORY-FAILED-PATTERN",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-AUTO-MEMORY-FAILED-PATTERN",
    requestOptions: { priorFailedPatterns: ["BTCUSD RSI period threshold tweak failed as a parameter-only non-survivor screen."] }
  });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /record_hypothesis blocked by memory similarity/);
  assert.match(result.attempts[0].reason, /parameter_only_failed_pattern_similarity/);
});

test("ResearchBrain memory tools surface prior Stage-0 rejection details", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/rejection-memory";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "rejection-memory-1", url, title: "Rejection memory", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A fixture source supports a different non-RSI mechanism while warning that parameter tweaks are weak novelty." } },
    ...memoryCheckSteps(),
    { tool: "record_rejection", input: { rejection_id: "REJECTION-RSI-PARAM-ONLY", idea: "BTCUSD RSI period tweak", reason: "Rejected as duplicate parameter-only variant of failed RSI screens." } },
    { tool: "record_hypothesis", input: hypothesis() }
  ], { runId: "RESEARCHBRAIN-STAGE0-REJECTION-MEMORY-SEED", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-REJECTION-MEMORY-SEED" });
  assert.equal(result.status, "ready");

  const runtime = createResearchBrainToolRuntime({
    rootDir,
    runRepoDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-REJECTION-MEMORY-CHECK",
    request: request(rootDir)
  });

  const search = await runtime.execute("search_research_memory", { query: "BTCUSD RSI period tweak rejected failed screens", limit: 5 });
  assert.equal(search.results.some((entry) => entry.source_type === "research_ideation_manifest" && /RSI period tweak/i.test(entry.text)), true);

  const failed = await runtime.execute("check_failed_pattern_similarity", {
    mechanism: "BTCUSD RSI period tweak",
    strategy_family: "rsi_mean_reversion",
    parameters: "rsi period threshold",
    instrument_scope: "BTCUSD",
    timeframe_candidate: "H1",
    min_overlap: 1
  });
  assert.equal(failed.blocked, true);
  assert.equal(failed.matches.some((entry) => entry.source_type === "research_ideation_manifest"), true);
});

test("read_repo_artifact is restricted to approved artifact roots and denies sensitive paths", async () => {
  const rootDir = tempRoot();
  const req = request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-READ-REPO-ARTIFACT" });
  const allowed = writeTextFixture(rootDir, "factory/research/prior/allowed-source.md", "Prior Stage-0 source summary.");
  writeTextFixture(rootDir, "README.md", "Unrelated repo file.");
  writeTextFixture(rootDir, "factory/research/.env", "SECRET=value");
  writeTextFixture(rootDir, "factory/research/api-token.txt", "token");
  writeTextFixture(rootDir, "factory/research/.opencode/config.md", "opencode config");
  writeTextFixture(rootDir, "factory/research/.git/config", "git config");

  const runtime = createResearchBrainToolRuntime({
    rootDir,
    runRepoDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-READ-REPO-ARTIFACT",
    request: req
  });

  const result = await runtime.execute("read_repo_artifact", { path: allowed.path });
  assert.equal(result.path, allowed.path);
  assert.equal(result.sha256, allowed.sha256);
  assert.match(result.content, /Prior Stage-0 source/);

  await assert.rejects(() => runtime.execute("read_repo_artifact", { path: "README.md" }), /outside approved artifact roots/);
  await assert.rejects(() => runtime.execute("read_repo_artifact", { path: "factory/research/.env" }), /environment files/);
  await assert.rejects(() => runtime.execute("read_repo_artifact", { path: "factory/research/api-token.txt" }), /credential\/key\/token-like/);
  await assert.rejects(() => runtime.execute("read_repo_artifact", { path: "factory/research/.opencode/config.md" }), /git\/opencode paths/);
  await assert.rejects(() => runtime.execute("read_repo_artifact", { path: "factory/research/.git/config" }), /git\/opencode paths/);
});

test("live tool mode rejects injected search results before provider canary work", async () => {
  const rootDir = tempRoot();
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { query: "invented result", results: [{ result_id: "fake", url: "https://example.test/fake", title: "Fake", discovery_only: true }] } }
  ], {
    runId: "RESEARCHBRAIN-STAGE0-LIVE-MODE-SEARCH-INJECTION-BLOCK",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-MODE-SEARCH-INJECTION-BLOCK",
    toolMode: "live"
  });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /live mode rejects caller-supplied input\.results/);
});

test("live tool mode rejects LLM supplied URL capture content", async () => {
  const rootDir = tempRoot();
  const result = await runScript(rootDir, [
    { tool: "capture_url_source", input: { source_id: "SRC-LIVE-INJECTED", url: "https://example.test/injected", content: "Invented source content must not become a live captured source artifact." } }
  ], {
    runId: "RESEARCHBRAIN-STAGE0-LIVE-MODE-CONTENT-INJECTION-BLOCK",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-MODE-CONTENT-INJECTION-BLOCK",
    toolMode: "live"
  });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /live mode rejects LLM-supplied input\.content/);
});

test("live tool mode rejects LLM supplied GitHub artifact content", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const runtime = createResearchBrainToolRuntime({
    rootDir,
    runRepoDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-GITHUB-CONTENT-INJECTION-BLOCK",
    runId: "RESEARCHBRAIN-STAGE0-LIVE-GITHUB-CONTENT-INJECTION-BLOCK",
    request: request(rootDir),
    toolMode: "live",
    requireDiscoveryBeforeCapture: false
  });

  await assert.rejects(
    () => runtime.execute("capture_github_artifact", {
      source_id: "SRC-GITHUB-INJECTED",
      repo_url: "https://github.com/example/repo",
      path: "Experts/filter.mq5",
      commit_sha: "a".repeat(40),
      license: "MIT",
      content: "// Invented code must not become a live captured GitHub artifact."
    }),
    /live mode rejects LLM-supplied input\.content/
  );
});

test("live tool mode fails closed without deterministic source adapter", async () => {
  const rootDir = tempRoot();
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { query: "source adapter required" } }
  ], {
    runId: "RESEARCHBRAIN-STAGE0-LIVE-MODE-NO-SOURCE-ADAPTER",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-MODE-NO-SOURCE-ADAPTER",
    toolMode: "live"
  });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /sourceToolAdapter\.search/);
});

test("fake agent searches and inspects YouTube with timestamped chunks before recording hypothesis", async () => {
  const rootDir = tempRoot();
  const videoId = "YT_AGENT_001";
  const result = await runScript(rootDir, [
    { tool: "search_youtube", input: { query: "ATR breakout filter", results: [{ result_id: "yt-1", video_id: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: "ATR breakout filter", discovery_only: true }] } },
    { tool: "inspect_youtube_video", input: { source_id: "SRC-YOUTUBE-AGENT-001", video_id: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, metadata: { title: "ATR breakout filter", channel_title: "Fixture" }, transcript_provider: "fixture_transcript", source_risk: "low", transcript_segments: [{ start_sec: 12, end_sec: 40, text: "The filter rejects breakouts during volatility expansion and waits for contraction first." }] } },
    ...memoryCheckSteps({ mechanism: "ATR breakout filter after volatility contraction", strategy_family: "agent_fixture_atr_breakout_filter" }),
    { tool: "record_hypothesis", input: hypothesis({ cited_source_ids: ["SRC-YOUTUBE-AGENT-001"], source_claims: [{ claim_class: "youtube_video_content", citation_source_id: "SRC-YOUTUBE-AGENT-001", chunk_ids: ["yt_YT_AGENT_001_0001"] }] }) }
  ], { runId: "RESEARCHBRAIN-STAGE0-YOUTUBE-RUN", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-YOUTUBE-RUN" });

  assert.equal(result.status, "ready");
  assert.equal(result.artifacts_created.some((artifact) => artifact.artifact_type === "researchbrain_youtube_chunks"), true);
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8"));
  const inspect = ledger.tool_calls.find((call) => call.tool === "inspect_youtube_video");
  assert.equal(inspect.output.ingest.researchbrain_allowed, true);
  assert.deepEqual(inspect.output.ingest.chunk_ids, ["yt_YT_AGENT_001_0001"]);
});

test("YouTube title or description citation without timestamped chunks is quarantined", async () => {
  const rootDir = tempRoot();
  const videoId = "YT_TITLE_ONLY";
  const result = await runScript(rootDir, [
    { tool: "search_youtube", input: { results: [{ result_id: "yt-title", video_id: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: "Great trading setup", discovery_only: true }] } },
    { tool: "inspect_youtube_video", input: { source_id: "SRC-YOUTUBE-TITLE-001", video_id: videoId, transcript_segments: [{ start_sec: 1, end_sec: 5, text: "Transcript exists but is not cited by the attempted title-only claim." }] } },
    ...memoryCheckSteps({ mechanism: "YouTube title-only trading setup", strategy_family: "agent_fixture_youtube_title_only" }),
    { tool: "record_hypothesis", input: hypothesis({ cited_source_ids: ["SRC-YOUTUBE-TITLE-001"], source_claims: [{ claim_class: "youtube_title_description", citation_source_id: "SRC-YOUTUBE-TITLE-001" }] }) }
  ], { runId: "RESEARCHBRAIN-STAGE0-YOUTUBE-TITLE-BLOCK", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-YOUTUBE-TITLE-BLOCK" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /title\/description/);
});

test("YouTube without captions records transcript_unavailable and cannot support video-content claims", async () => {
  const rootDir = tempRoot();
  const videoId = "YT_NO_CAPTIONS";
  const result = await runScript(rootDir, [
    { tool: "search_youtube", input: { results: [{ result_id: "yt-none", video_id: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: "No captions", discovery_only: true }] } },
    { tool: "inspect_youtube_video", input: { source_id: "SRC-YOUTUBE-NO-CAPTIONS", video_id: videoId, allow_audio_transcription: false } },
    ...memoryCheckSteps({ mechanism: "YouTube video without captions", strategy_family: "agent_fixture_youtube_no_captions" }),
    { tool: "record_hypothesis", input: hypothesis({ cited_source_ids: ["SRC-YOUTUBE-NO-CAPTIONS"], source_claims: [{ claim_class: "youtube_video_content", citation_source_id: "SRC-YOUTUBE-NO-CAPTIONS", chunk_ids: ["missing"] }] }) }
  ], { runId: "RESEARCHBRAIN-STAGE0-YOUTUBE-NO-CAPTIONS", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-YOUTUBE-NO-CAPTIONS" });

  assert.equal(result.status, "blocked");
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8"));
  const inspect = ledger.tool_calls.find((call) => call.tool === "inspect_youtube_video");
  assert.equal(inspect.output.ingest.transcript_status, "transcript_unavailable");
  assert.equal(inspect.output.ingest.researchbrain_allowed, false);
  assert.match(result.attempts[0].reason, /uncaptured source_id|no transcript chunks/);
});

test("MQL5 or broker source claims require discovery and captured source artifacts", async () => {
  const rootDir = tempRoot();
  const url = "https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants";
  const result = await runScript(rootDir, [
    { tool: "search_mql5_sources", input: { query: "MQL5 symbol properties", results: [{ result_id: "mql5-1", url, title: "MQL5 symbol properties", source_class: "mql5", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-MQL5-AGENT-001", url, source_class: "mql5", content: "MQL5 documentation describes symbol properties needed for later MT5 implementation and contract-spec awareness." } },
    ...memoryCheckSteps({ mechanism: "MQL5 symbol property constraint awareness", strategy_family: "agent_fixture_mql5_context" }),
    { tool: "record_hypothesis", input: hypothesis({ cited_source_ids: ["SRC-MQL5-AGENT-001"], source_claims: [{ claim_class: "mql5", citation_source_id: "SRC-MQL5-AGENT-001" }] }) }
  ], { runId: "RESEARCHBRAIN-STAGE0-MQL5-RUN", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-MQL5-RUN" });

  assert.equal(result.status, "ready");
  const sourceRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "research_source_record");
  const source = JSON.parse(fs.readFileSync(path.join(rootDir, sourceRef.path), "utf8"));
  assert.equal(source.provider_provenance.source_class, "mql5");
});

test("GitHub code search and capture records commit, license, path, and never executes code", async () => {
  const rootDir = tempRoot();
  const repoUrl = "https://github.com/example/mt5-fixture";
  const codePath = "Experts/filter.mq5";
  const result = await runScript(rootDir, [
    { tool: "search_github_code", input: { query: "MQL5 ATR filter", results: [{ result_id: "gh-1", repo_url: repoUrl, path: codePath, commit_sha: "a".repeat(40), license: "MIT", discovery_only: true }] } },
    { tool: "capture_github_artifact", input: { source_id: "SRC-GITHUB-AGENT-001", repo_url: repoUrl, path: codePath, commit_sha: "a".repeat(40), license: "MIT", content: "// MQL5 fixture code. ResearchBrain captures this text but never executes or compiles it." } },
    ...memoryCheckSteps({ mechanism: "MQL5 ATR filter implementation context", strategy_family: "agent_fixture_github_context" }),
    { tool: "record_hypothesis", input: hypothesis({ cited_source_ids: ["SRC-GITHUB-AGENT-001"], source_claims: [{ claim_class: "implementation_context", citation_source_id: "SRC-GITHUB-AGENT-001" }] }) }
  ], { runId: "RESEARCHBRAIN-STAGE0-GITHUB-RUN", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-GITHUB-RUN" });

  assert.equal(result.status, "ready");
  const sourceRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "research_source_record");
  const source = JSON.parse(fs.readFileSync(path.join(rootDir, sourceRef.path), "utf8"));
  assert.equal(source.provider_provenance.metadata.commit_sha, "a".repeat(40));
  assert.equal(source.provider_provenance.metadata.license, "MIT");
  assert.equal(source.provider_provenance.metadata.path, codePath);
  assert.equal(source.provider_provenance.metadata.executed, false);
  assert.equal(source.provider_provenance.metadata.imported, false);
  assert.equal(source.provider_provenance.metadata.compiled, false);
});

test("GitHub capture rejects malformed commit provenance", async () => {
  const rootDir = tempRoot();
  const repoUrl = "https://github.com/example/bad-provenance";
  const codePath = "Experts/filter.mq5";
  const result = await runScript(rootDir, [
    { tool: "search_github_code", input: { results: [{ result_id: "gh-bad", repo_url: repoUrl, path: codePath, commit_sha: "abc", license: "MIT", discovery_only: true }] } },
    { tool: "capture_github_artifact", input: { source_id: "SRC-GITHUB-BAD", repo_url: repoUrl, path: codePath, commit_sha: "abc", license: "MIT", content: "// Bad commit fixture." } }
  ], { runId: "RESEARCHBRAIN-STAGE0-GITHUB-BAD", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-GITHUB-BAD" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /40-hex commit_sha/);
});

test("record_hypothesis requires cited captured sources", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/uncited";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "uncited-1", url, title: "Uncited source", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A fixture source exists, but the attempted hypothesis does not cite it." } },
    ...memoryCheckSteps({ mechanism: "Uncited source fixture", strategy_family: "agent_fixture_uncited" }),
    { tool: "record_hypothesis", input: hypothesis({ cited_source_ids: [] }) }
  ], { runId: "RESEARCHBRAIN-STAGE0-UNCITED-BLOCK", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-UNCITED-BLOCK" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /cited_source_ids/);
});

test("YouTube short URL inspection still requires discovery", async () => {
  const rootDir = tempRoot();
  const result = await runScript(rootDir, [
    { tool: "inspect_youtube_video", input: { source_id: "SRC-YOUTUBE-SHORT", url: "https://youtu.be/YT_SHORT_001", transcript_segments: [{ start_sec: 1, end_sec: 8, text: "A transcript fixture should not bypass discovery." }] } }
  ], { runId: "RESEARCHBRAIN-STAGE0-YOUTUBE-SHORT-BLOCK", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-YOUTUBE-SHORT-BLOCK" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /prior YouTube discovery/);
});

test("memory tools block parameter-only mutation of prior failed mechanism", async () => {
  const rootDir = tempRoot();
  const req = request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-MEMORY-BLOCK", priorFailedPatterns: ["RSI 14 mean-reversion failed net-of-cost across prior WFA windows; reject parameter-only RSI variants unless mechanism changes."] });
  const url = "https://example.test/rsi";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "rsi-1", url, title: "RSI variant", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A source describes an RSI mean-reversion parameter variant without changing the underlying mechanism." } },
    ...memoryCheckSteps({ mechanism: "RSI 17 mean-reversion on M15 is a parameter-only variation", strategy_family: "rsi_mean_reversion", parameters: { rsi_period: 17 } }),
    { tool: "record_hypothesis", input: hypothesis({ mechanism: "RSI 17 mean-reversion parameter-only variant.", strategy_family: "rsi_mean_reversion" }) }
  ], { request: req, runId: "RESEARCHBRAIN-STAGE0-MEMORY-BLOCK", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-MEMORY-BLOCK" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /memory similarity|parameter_only/);
});

test("unallowed tool quarantines run and official hashes stay unchanged", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const result = await runScript(rootDir, [
    { tool: "run_wfa", input: { config: "forbidden" } }
  ], { allowedTools: ["run_wfa"], runId: "RESEARCHBRAIN-STAGE0-FORBIDDEN-TOOL", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-FORBIDDEN-TOOL" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /not in v1 catalog|not allowed/);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
});

test("profitability or promotion fields from agent output quarantine the run", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/profitability";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "profit-1", url, title: "Bad claim", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A bad fixture source tempts profitability claims, which Stage-0 must reject." } },
    ...memoryCheckSteps({ mechanism: "Profitability claim temptation", strategy_family: "agent_fixture_profitability_block" }),
    { tool: "record_hypothesis", input: hypothesis({ extra: { sharpe_oos: 9.9 } }) }
  ], { runId: "RESEARCHBRAIN-STAGE0-PROFIT-BLOCK", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-PROFIT-BLOCK" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /profitability|sharpe_oos/);
});

test("agent tool budget blocks run with transcript, tool, and cost diagnostics", async () => {
  const rootDir = tempRoot();
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { query: "one" } },
    { tool: "search_web", input: { query: "two" } }
  ], { maxToolCalls: 1, runId: "RESEARCHBRAIN-STAGE0-BUDGET-BLOCK", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-BUDGET-BLOCK" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /tool call budget/);
  assert.equal(result.artifacts_created.some((artifact) => artifact.artifact_type === "researchbrain_agent_transcript"), true);
  assert.equal(result.artifacts_created.some((artifact) => artifact.artifact_type === "researchbrain_tool_ledger"), true);
  assert.equal(result.artifacts_created.some((artifact) => artifact.artifact_type === "researchbrain_cost_ledger"), true);
  assert.equal(result.evidence_kind, STAGE0_RESEARCH_DISCOVERY_EVIDENCE_KIND);
});

test("live LLM provider seam requires explicit opt-in and supports injectable clients", async () => {
  assert.throws(() => createLiveResearchBrainAgentProvider({ llmClient: { async generate() { return {}; } } }), /allowLiveLlm/);

  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const url = "https://example.test/live-seam";
  const toolCalls = [
    { tool: "search_web", input: { query: "live seam volatility contraction", results: [{ result_id: "live-seam-1", url, title: "Live seam source", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A live-seam fake LLM source discusses volatility contraction and liquidity imbalance without any profitability claim." } },
    ...memoryCheckSteps(),
    { tool: "record_hypothesis", input: hypothesis({ hypothesis_id: "HYP-STAGE0-LIVE-SEAM-001" }) }
  ];

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request: request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-LIVE-SEAM" }),
    runId: "RESEARCHBRAIN-STAGE0-LIVE-SEAM",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-SEAM",
    observedAt: "2026-05-22T01:02:00Z",
    provider: createLiveResearchBrainAgentProvider({
      allowLiveLlm: true,
      llmProvider: "fake_live_llm",
      llmModel: "fake-researchbrain-model",
      toolMode: "fixture",
      llmClient: {
        async generate() {
          return { tool_calls: toolCalls, final: true };
        }
      }
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(result.provider.mode, "live_llm_agent");
  assert.equal(result.provider.live_research, true);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8"));
  assert.equal(ledger.provider_mode, "live_llm_agent");
  assert.equal(ledger.llm_provider, "fake_live_llm");
  assert.equal(ledger.tool_calls.some((call) => call.tool === "record_hypothesis"), true);
});

test("direct ResearchBrain LLM adapter is fail-closed without opt-in, supported provider, and API key", () => {
  assert.throws(() => createResearchBrainLlmClient({ allowLiveLlm: true, provider: "openai", model: "gpt-fixture", apiKey: "test" }), /Unsupported ResearchBrain LLM provider/);
  assert.throws(() => createResearchBrainLlmClient({ allowLiveLlm: true, provider: "openai_compatible", model: "deepseek-fixture", apiKey: "test", baseUrlEnv: "RESEARCHBRAIN_TEST_MISSING_BASE_URL" }), /requires base URL/);
  assert.throws(() => createResearchBrainLlmClient({ allowLiveLlm: true, provider: "deepseek", model: "deepseek-v4-flash-fixture", apiKeyEnv: "RESEARCHBRAIN_TEST_MISSING_KEY" }), /requires API key/);
});



test("OpenAI-compatible direct adapter maps fake tool calls without storing credentials", async () => {
  const calls = [];
  const client = createResearchBrainLlmClient({
    allowLiveLlm: true,
    provider: "openai_compatible",
    model: "deepseek-v4-pro-fixture",
    apiKey: "test-opencode-key",
    baseUrl: "https://opencode-compatible.example.test/v1",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "chatcmpl_fixture",
            model: "deepseek-v4-pro-fixture",
            choices: [{
              finish_reason: "tool_calls",
              message: {
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "search_web", arguments: JSON.stringify({ query: "fixture query" }) }
                }]
              }
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 }
          });
        }
      };
    }
  });

  const response = await client.generate({ request: request(tempRoot()), transcript: [], allowed_tools: ["search_web"] });
  assert.equal(response.tool_calls[0].tool, "search_web");
  assert.equal(response.provider_raw.provider, "openai_compatible");
  assert.equal(response.provider_raw.provider_native_search_enabled, false);
  assert.equal(calls[0].endpoint, "https://opencode-compatible.example.test/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-opencode-key");
  assert.equal(calls[0].body.model, "deepseek-v4-pro-fixture");
  assert.equal(calls[0].body.tools[0].function.name, "search_web");
});

test("DeepSeek direct adapter sends thinking/reasoning_effort params and uses correct model and endpoint", async () => {
  const calls = [];
  const client = createResearchBrainLlmClient({
    allowLiveLlm: true,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: "test-deepseek-key",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "chatcmpl_deepseek_fixture",
            model: "deepseek-v4-flash",
            choices: [{
              finish_reason: "tool_calls",
              message: {
                tool_calls: [{
                  id: "call_ds_1",
                  type: "function",
                  function: { name: "search_web", arguments: JSON.stringify({ query: "deepseek fixture query" }) }
                }]
              }
            }],
            usage: { prompt_tokens: 15, completion_tokens: 8 }
          });
        }
      };
    }
  });

  const response = await client.generate({ request: request(tempRoot()), transcript: [], allowed_tools: ["search_web"] });
  assert.equal(response.tool_calls[0].tool, "search_web");
  assert.equal(response.provider_raw.provider, "deepseek");
  assert.equal(response.provider_raw.provider_native_search_enabled, false);
  assert.equal(calls[0].endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-deepseek-key");
  assert.equal(calls[0].body.model, "deepseek-v4-flash");
  assert.deepEqual(calls[0].body.thinking, { type: "enabled" });
  assert.equal(calls[0].body.reasoning_effort, "max");
  assert.equal(calls[0].body.tools[0].function.name, "search_web");
});

test("OpenAI-compatible adapter can send optional reasoning_effort for OpenCode Go bakeoffs", async () => {
  const calls = [];
  const client = createResearchBrainLlmClient({
    allowLiveLlm: true,
    provider: "openai_compatible",
    model: "glm-5.2",
    apiKey: "test-opencode-go-key",
    baseUrl: "https://opencode.ai/zen/go/v1",
    reasoningEffort: "max",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "chatcmpl_opencode_go_fixture",
            model: "glm-5.2",
            choices: [{ finish_reason: "stop", message: { content: "done" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 }
          });
        }
      };
    }
  });

  const response = await client.generate({ request: request(tempRoot()), transcript: [], allowed_tools: ["search_web"] });
  assert.equal(response.final, true);
  assert.equal(calls[0].endpoint, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(calls[0].body.model, "glm-5.2");
  assert.equal(calls[0].body.reasoning_effort, "max");
});

test("DeepSeek direct adapter reports malformed tool arguments as retryable provider error", async () => {
  const client = createResearchBrainLlmClient({
    allowLiveLlm: true,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: "test-deepseek-key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "chatcmpl_deepseek_malformed_fixture",
          model: "deepseek-v4-flash",
          choices: [{
            finish_reason: "tool_calls",
            message: {
              tool_calls: [{
                id: "call_bad_json",
                type: "function",
                function: { name: "search_web", arguments: "{\"query\": \"unterminated" }
              }]
            }
          }]
        });
      }
    })
  });

  const response = await client.generate({ request: request(tempRoot()), transcript: [], allowed_tools: ["search_web"] });
  assert.deepEqual(response.tool_calls, []);
  assert.equal(response.final, false);
  assert.equal(response.provider_error.status, "malformed_tool_arguments");
  assert.equal(response.provider_error.retryable_for_agent, true);
  assert.equal(response.provider_error.tool, "search_web");
});

test("live LLM seam can use deterministic source adapter for search and URL capture", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const url = "https://example.test/deterministic-live-source";
  const query = "deterministic live source volatility contraction";
  const sourceToolAdapter = createMapResearchBrainSourceToolAdapter({
    searches: {
      [`search_web:${query}`]: {
        results: [{ result_id: "det-live-1", url, title: "Deterministic live source", source_class: "web", discovery_only: true }]
      }
    },
    captures: {
      [url]: {
        title: "Deterministic live source",
        content: "A deterministic source adapter capture discusses volatility contraction, liquidity imbalance, explicit limitations, and later falsification without profitability evidence."
      }
    }
  });
  const toolCalls = [
    { tool: "search_web", input: { query } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, source_class: "web" } },
    ...memoryCheckSteps(),
    { tool: "record_hypothesis", input: hypothesis({ hypothesis_id: "HYP-STAGE0-LIVE-SOURCE-ADAPTER-001" }) }
  ];

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request: request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-LIVE-SOURCE-ADAPTER" }),
    runId: "RESEARCHBRAIN-STAGE0-LIVE-SOURCE-ADAPTER",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-LIVE-SOURCE-ADAPTER",
    observedAt: "2026-05-22T01:04:00Z",
    provider: createLiveResearchBrainAgentProvider({
      allowLiveLlm: true,
      llmProvider: "fake_live_llm",
      llmModel: "fake-researchbrain-model",
      toolMode: "live",
      sourceToolAdapter,
      llmClient: {
        async generate() {
          return { tool_calls: toolCalls, final: true };
        }
      }
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
  const sourceRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "research_source_record");
  const source = JSON.parse(fs.readFileSync(path.join(rootDir, sourceRef.path), "utf8"));
  assert.equal(source.provider_provenance.live_research, false);
  assert.equal(source.provider_provenance.deterministic_capture, true);
  assert.equal(source.provider_provenance.adapter.provider_native_search_enabled, false);
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8"));
  const searchCall = ledger.tool_calls.find((call) => call.tool === "search_web");
  assert.equal(searchCall.output.provider_native_search_enabled, false);
  assert.equal(searchCall.output.results[0].url, url);
});

test("live ResearchBrain continues after retryable provider output error", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/provider-error-retry-source";
  let llmCalls = 0;
  const sourceToolAdapter = createMapResearchBrainSourceToolAdapter({
    searches: {
      "search_web:provider error retry source": {
        results: [{ result_id: "provider-retry-1", url, title: "Provider retry source", source_class: "web", discovery_only: true }]
      }
    },
    captures: {
      [url]: {
        title: "Provider retry source",
        content: "A deterministic provider retry source capture discusses a falsifiable mechanism, limitations, and later validation without profitability evidence."
      }
    }
  });

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request: request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-PROVIDER-ERROR-RETRY" }),
    runId: "RESEARCHBRAIN-STAGE0-PROVIDER-ERROR-RETRY",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-PROVIDER-ERROR-RETRY",
    observedAt: "2026-06-08T20:40:00Z",
    provider: createLiveResearchBrainAgentProvider({
      allowLiveLlm: true,
      llmProvider: "fake_live_llm",
      llmModel: "fake-researchbrain-model",
      toolMode: "live",
      sourceToolAdapter,
      llmClient: {
        async generate() {
          llmCalls += 1;
          if (llmCalls === 1) {
            return { tool_calls: [], final: false, provider_error: { status: "malformed_tool_arguments", retryable_for_agent: true, tool: "search_web", error: "Unterminated string in JSON" } };
          }
          return { tool_calls: [
            { tool: "search_web", input: { query: "provider error retry source" } },
            { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, source_class: "web" } },
            ...memoryCheckSteps(),
            { tool: "record_hypothesis", input: hypothesis({ hypothesis_id: "HYP-STAGE0-PROVIDER-ERROR-RETRY-001" }) }
          ], final: true };
        }
      }
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(llmCalls, 2);
});

test("live source adapter retries transient search failures without persisting secrets", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/retry-source";
  const query = "retryable source search volatility contraction";
  let searchCalls = 0;
  const sourceToolAdapter = {
    name: "transient_source_adapter",
    async search() {
      searchCalls += 1;
      if (searchCalls === 1) throw new Error("HTTP 503 temporarily unavailable authorization: Bearer SOURCE_SECRET_TOKEN");
      return { provider: "transient_source_adapter", provider_native_search_enabled: false, results: [{ result_id: "retry-1", url, title: "Retry source", source_class: "web", discovery_only: true }] };
    },
    async captureUrl() {
      return { provider: "transient_source_adapter", live_fetch: false, provider_native_search_enabled: false, title: "Retry source", content: "A retried deterministic source capture discusses a falsifiable mechanism, limitations, and later WFA falsification without profitability evidence." };
    }
  };
  const toolCalls = [
    { tool: "search_web", input: { query } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, source_class: "web" } },
    ...memoryCheckSteps(),
    { tool: "record_hypothesis", input: hypothesis({ hypothesis_id: "HYP-STAGE0-SOURCE-RETRY-001" }) }
  ];

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request: request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-SOURCE-RETRY" }),
    runId: "RESEARCHBRAIN-STAGE0-SOURCE-RETRY",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-SOURCE-RETRY",
    observedAt: "2026-06-03T01:04:00Z",
    provider: createLiveResearchBrainAgentProvider({
      allowLiveLlm: true,
      llmProvider: "fake_live_llm",
      llmModel: "fake-researchbrain-model",
      toolMode: "live",
      sourceToolAdapter,
      retryPolicy: { sourceToolMaxAttempts: 2, sourceToolRetryDelayMs: 0 },
      llmClient: {
        async generate() {
          return { tool_calls: toolCalls, final: true };
        }
      }
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(searchCalls, 2);
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledgerText = fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8");
  assert.doesNotMatch(ledgerText, /SOURCE_SECRET_TOKEN/);
  const ledger = JSON.parse(ledgerText);
  const searchCall = ledger.tool_calls.find((call) => call.tool === "search_web");
  assert.equal(searchCall.output.retry_attempts.length, 2);
  assert.equal(searchCall.output.retry_attempts[0].retryable, true);
  assert.equal(searchCall.output.retry_attempts[0].failure_class, "transient_retryable_failure");
  assert.match(searchCall.output.retry_attempts[0].error_message, /\[REDACTED\]/);
});

test("live ResearchBrain exposes only adapter-backed search tools", async () => {
  const rootDir = tempRoot();
  const seenAllowedTools = [];
  const provider = createLiveResearchBrainAgentProvider({
    allowLiveLlm: true,
    llmProvider: "fake_live_llm",
    llmModel: "fake-researchbrain-model",
    toolMode: "live",
    sourceToolAdapter: createBraveResearchBrainSourceToolAdapter({
      allowLiveSourceSearch: true,
      allowLiveSourceCapture: true,
      apiKey: "test-brave-key",
      fetchImpl: async () => ({ ok: true, status: 200, async text() { return "{}"; } })
    }),
    llmClient: {
      async generate(context) {
        seenAllowedTools.push(...context.allowed_tools);
        return { final: true, tool_calls: [] };
      }
    }
  });

  await assert.rejects(() => provider.generate({
    root_dir: rootDir,
    run_repo_dir: "factory/research/runs/RESEARCHBRAIN-STAGE0-ADAPTER-TOOLS",
    run_id: "RESEARCHBRAIN-STAGE0-ADAPTER-TOOLS",
    request: request(rootDir)
  }), /produced no accepted hypothesis packet/);

  assert.ok(seenAllowedTools.includes("search_web"));
  assert.ok(seenAllowedTools.includes("capture_url_source"));
  assert.ok(seenAllowedTools.includes("search_research_memory"));
  assert.ok(!seenAllowedTools.includes("search_arxiv"));
  assert.ok(!seenAllowedTools.includes("search_youtube"));
  assert.ok(!seenAllowedTools.includes("search_mql5_sources"));
});

test("live ResearchBrain synthesis-phase gating restricts tools at 60% and 80% budget thresholds", async () => {
  const rootDir = tempRoot();
  initializeProject(rootDir);
  const seenAllowed = [];
  let llmTurn = 0;

  const provider = createLiveResearchBrainAgentProvider({
    allowLiveLlm: true,
    llmProvider: "fake_gating_test",
    llmModel: "fake-model",
    maxToolCalls: 10,
    maxLlmCalls: 5,
    toolMode: "fixture",
    llmClient: {
      async generate(context) {
        llmTurn++;
        seenAllowed.push({ turn: llmTurn, allowed: [...context.allowed_tools].sort() });
        // Only request tools that are in the current allowed_tools list
        const calls = [];
        if (context.allowed_tools.includes("search_web")) {
          calls.push({ tool: "search_web", input: { results: [{ result_id: `gating-${llmTurn}`, url: "https://example.test/gating", discovery_only: true }] } });
        }
        if (context.allowed_tools.includes("search_research_memory")) {
          calls.push({ tool: "search_research_memory", input: { query: "gating memory check" } });
        }
        if (calls.length === 0 && context.allowed_tools.includes("record_rejection")) {
          calls.push({ tool: "record_rejection", input: { rejection_id: `GATING-REJECTION-${llmTurn}`, idea: "Budget exhausted", reason: "No viable tools left in gated phase" } });
        }
        return { tool_calls: calls.length > 0 ? calls : [{ tool: "search_research_memory", input: { query: "gating fallback" } }], final: false };
      }
    }
  });

  await assert.rejects(
    () => provider.generate({
      root_dir: rootDir,
      run_repo_dir: "factory/research/runs/RESEARCHBRAIN-STAGE0-GATING-TEST",
      run_id: "RESEARCHBRAIN-STAGE0-GATING-TEST",
      request: request(rootDir)
    })
  );

  // Verify pre-60% turns have search_web available
  const preThreshold = seenAllowed.filter((entry) => entry.turn <= 2);
  for (const entry of preThreshold) {
    assert.ok(entry.allowed.includes("search_web"), `turn ${entry.turn} <60% should have search_web`);
    assert.ok(entry.allowed.includes("search_research_memory"), `turn ${entry.turn} <60% should have memory`);
  }

  // At >60% budget (turn 4, starts with toolCalls.length=6): search tools removed, capture/memory remain
  const at60Entry = seenAllowed.find((entry) => entry.turn === 4);
  if (at60Entry) {
    assert.ok(!at60Entry.allowed.includes("search_web"), "turn >=60% zero hypotheses should remove search_web");
    assert.ok(at60Entry.allowed.includes("search_research_memory"), "turn >=60% should keep memory tools");
    assert.ok(at60Entry.allowed.includes("capture_url_source"), "turn >=60% should keep capture tools");
    assert.ok(at60Entry.allowed.includes("record_rejection"), "turn >=60% should keep record tools");
  }

  // At >=80% or final turn (turn 5): only core record and memory tools
  const at80Entry = seenAllowed.find((entry) => entry.turn >= 5);
  if (at80Entry) {
    assert.ok(!at80Entry.allowed.includes("search_web"), "turn >=80% should remove search_web");
    assert.ok(!at80Entry.allowed.includes("capture_url_source"), "turn >=80% should remove capture tools");
    assert.ok(at80Entry.allowed.includes("record_hypothesis"), "turn >=80% should keep record_hypothesis");
    assert.ok(at80Entry.allowed.includes("search_research_memory"), "turn >=80% should keep memory tools");
    assert.ok(at80Entry.allowed.includes("record_rejection"), "turn >=80% should keep record_rejection");
  }
});

test("live ResearchBrain continues after non-terminal source capture failure", async () => {
  const rootDir = tempRoot();
  const badUrl = "https://example.test/paywalled-source";
  const goodUrl = "https://example.test/open-source";
  let llmCalls = 0;
  const sourceToolAdapter = {
    name: "capture_failure_then_success_adapter",
    supportedSearchToolNames: new Set(["search_web"]),
    async search({ input }) {
      const useGood = /open/i.test(String(input.query ?? ""));
      return {
        provider: "capture_failure_then_success_adapter",
        provider_native_search_enabled: false,
        results: [{ result_id: useGood ? "good-1" : "bad-1", url: useGood ? goodUrl : badUrl, title: useGood ? "Open source" : "Paywalled source", source_class: "web", discovery_only: true }]
      };
    },
    async captureUrl({ input }) {
      if (input.url === badUrl) throw new Error("HTTP 402 paywall token sk-secret-would-be-redacted");
      return { provider: "capture_failure_then_success_adapter", live_fetch: true, provider_native_search_enabled: false, title: "Open source", content: "Open captured source text with a falsifiable mechanism, limitations, and no profitability claim." };
    }
  };

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request: request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-CAPTURE-CONTINUES" }),
    runId: "RESEARCHBRAIN-STAGE0-CAPTURE-CONTINUES",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-CAPTURE-CONTINUES",
    observedAt: "2026-06-08T20:30:00Z",
    provider: createLiveResearchBrainAgentProvider({
      allowLiveLlm: true,
      llmProvider: "fake_live_llm",
      llmModel: "fake-researchbrain-model",
      toolMode: "live",
      sourceToolAdapter,
      retryPolicy: { sourceToolMaxAttempts: 1, sourceToolRetryDelayMs: 0 },
      llmClient: {
        async generate() {
          llmCalls += 1;
          if (llmCalls === 1) {
            return { tool_calls: [
              { tool: "search_web", input: { query: "paywalled source" } },
              { tool: "capture_url_source", input: { source_id: "SRC-BAD-001", url: badUrl, source_class: "web" } }
            ] };
          }
          return { tool_calls: [
            { tool: "search_web", input: { query: "open source" } },
            { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url: goodUrl, source_class: "web" } },
            ...memoryCheckSteps(),
            { tool: "record_hypothesis", input: hypothesis({ hypothesis_id: "HYP-STAGE0-CAPTURE-CONTINUES-001" }) }
          ], final: true };
        }
      }
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(llmCalls, 2);
  const toolLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_tool_ledger");
  const ledgerText = fs.readFileSync(path.join(rootDir, toolLedgerRef.path), "utf8");
  assert.doesNotMatch(ledgerText, /sk-secret-would-be-redacted/);
  const ledger = JSON.parse(ledgerText);
  const failedCapture = ledger.tool_calls.find((call) => call.tool === "capture_url_source" && call.status === "error");
  assert.match(failedCapture.reason, /HTTP 402/);
  assert.match(failedCapture.reason, /\[REDACTED\]/);
  assert.equal(ledger.tool_calls.some((call) => call.tool === "record_hypothesis" && call.status === "ok"), true);
});

test("Brave source adapter is fail-closed and supports fake search plus capture", async () => {
  assert.throws(() => createBraveResearchBrainSourceToolAdapter({ apiKey: "test" }), /allowLiveSourceSearch/);
  assert.throws(() => createBraveResearchBrainSourceToolAdapter({ allowLiveSourceSearch: true, apiKeyEnv: "RESEARCHBRAIN_TEST_MISSING_BRAVE_KEY" }), /requires API key/);

  const calls = [];
  const url = "https://example.test/brave-source";
  const adapter = createBraveResearchBrainSourceToolAdapter({
    allowLiveSourceSearch: true,
    allowLiveSourceCapture: true,
    apiKey: "test-brave-key",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options });
      if (String(endpoint).startsWith("https://api.search.brave.com/")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ web: { results: [{ url, title: "Brave fixture", description: "A deterministic fake Brave result." }] } });
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return "A deterministic captured source body from the fake Brave source adapter with limitations and no profitability evidence.";
        }
      };
    }
  });

  const search = await adapter.search({ toolName: "search_web", input: { query: "volatility contraction source" } });
  assert.equal(search.provider_native_search_enabled, false);
  assert.equal(search.results[0].url, url);
  assert.equal(calls[0].options.headers["x-subscription-token"], "test-brave-key");
  const capture = await adapter.captureUrl({ input: { url }, discovery: search.results[0] });
  assert.equal(capture.live_fetch, true);
  assert.match(capture.content, /deterministic captured source body/);
});

test("createRateLimiter enforces minimum interval between acquires", async () => {
  const limiter = createRateLimiter({ defaultIntervalMs: 50 });
  const start = Date.now();
  await limiter.acquire({ key: "test" });
  await limiter.acquire({ key: "test" });
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 45, `expected >= 45ms elapsed, got ${elapsed}ms`);
  const snap = limiter.snapshot();
  assert.ok(snap.tracked_keys.includes("test"));
  assert.equal(snap.defaultIntervalMs, 50);
});

test("createRateLimiter with zero interval passes immediately", async () => {
  const limiter = createRateLimiter({ defaultIntervalMs: 0 });
  const start = Date.now();
  await limiter.acquire({ key: "fast" });
  await limiter.acquire({ key: "fast" });
  assert.ok(Date.now() - start < 30);
});

test("createRateLimiter separate keys do not block each other", async () => {
  const limiter = createRateLimiter({ defaultIntervalMs: 200 });
  const start = Date.now();
  await Promise.all([
    limiter.acquire({ key: "a" }),
    limiter.acquire({ key: "b" })
  ]);
  assert.ok(Date.now() - start < 100);
});

test("createRateLimiter rejects invalid interval", () => {
  assert.throws(() => createRateLimiter({ defaultIntervalMs: -1 }), /nonnegative integer/);
});

test("Semantic Scholar adapter is fail-closed and exposes env-name config", () => {
  assert.throws(() => createSemanticScholarResearchBrainSourceToolAdapter({}), /allowLiveSourceSearch/);
  const adapter = createSemanticScholarResearchBrainSourceToolAdapter({
    allowLiveSourceSearch: true,
    allowLiveSourceCapture: true,
    apiKey: "test-ss-key",
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ data: [] }); }, async json() { return { data: [] }; } })
  });
  assert.equal(adapter.name, "semantic_scholar_researchbrain_source_tool_adapter");
  assert.equal(adapter.live_research, true);
  assert.ok(adapter.supportedSearchToolNames.has("search_semantic_scholar"));
  assert.equal(typeof adapter.getRateLimiterSnapshot, "function");
  const snap = adapter.getRateLimiterSnapshot();
  assert.equal(snap.defaultIntervalMs, 1000); // 1s with key
});

test("Semantic Scholar adapter respects rate limiter", async () => {
  const callTimes = [];
  const adapter = createSemanticScholarResearchBrainSourceToolAdapter({
    allowLiveSourceSearch: true,
    allowLiveSourceCapture: true,
    apiKey: "test-ss-key",
    fetchImpl: async () => {
      callTimes.push(Date.now());
      return { ok: true, status: 200, async text() { return JSON.stringify({ data: [] }); }, async json() { return { data: [] }; } };
    }
  });
  // Two sequential searches should be at least ~1000ms apart (rate-limited)
  await adapter.search({ toolName: "search_semantic_scholar", input: { query: "volatility clustering" } });
  await adapter.search({ toolName: "search_semantic_scholar", input: { query: "momentum factor" } });
  assert.equal(callTimes.length, 2);
  const gap = callTimes[1] - callTimes[0];
  assert.ok(gap >= 950, `expected >= 950ms gap, got ${gap}ms`);
  const snap = adapter.getRateLimiterSnapshot();
  assert.ok(snap.tracked_keys.includes("semantic_scholar_search"));
});

test("Semantic Scholar adapter uses wider interval without API key", () => {
  const adapter = createSemanticScholarResearchBrainSourceToolAdapter({
    allowLiveSourceSearch: true,
    apiKey: null,
    apiKeyEnv: "RESEARCHBRAIN_TEST_SS_KEY_MISSING",
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ data: [] }); }, async json() { return { data: [] }; } })
  });
  const snap = adapter.getRateLimiterSnapshot();
  // Without key (free tier): 100 req/5min = 3000ms
  assert.equal(snap.defaultIntervalMs, 3000);
});

test("Semantic Scholar env-name config is exposed through provider utils", () => {
  const envName = getResearchBrainSourceAdapterEnvName("semantic_scholar");
  assert.equal(envName, "SEMANTIC_SCHOLAR_API_KEY");
  assert.equal(getResearchBrainSourceAdapterEnvName("brave"), "BRAVE_SEARCH_API_KEY");
  assert.equal(getResearchBrainSourceAdapterEnvName("nonexistent"), null);
  const configured = isResearchBrainSourceAdapterEnvConfigured("semantic_scholar");
  assert.equal(typeof configured, "boolean");
  assert.ok(configured === true || configured === false);
});

test("fixtureSearchResults returns structured adapter_error diagnostic on live adapter failure", async () => {
  const rootDir = tempRoot();
  const failingAdapter = {
    name: "failing_adapter",
    async search() {
      throw new Error("HTTP 429 rate limit exceeded for source adapter: too many requests");
    }
  };
  const toolRuntime = createResearchBrainToolRuntime({
    rootDir,
    runRepoDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-ADAPTER-DIAG",
    request: { request_id: "RESEARCHBRAIN-REQUEST-ADAPTER-DIAG" },
    toolMode: "live",
    sourceToolAdapter: failingAdapter,
    retryPolicy: { sourceToolMaxAttempts: 2, sourceToolRetryDelayMs: 0 }
  });
  const result = await toolRuntime.execute("search_web", { query: "test adapter failure diagnostic" });
  assert.equal(result.results.length, 0);
  assert.ok(result.adapter_error, "expected adapter_error diagnostic on failed live search");
  assert.equal(result.adapter_error.tool_name, "search_web");
  assert.match(result.adapter_error.error_message, /rate limit/i);
  assert.equal(result.adapter_error.diagnostic_only, true);
  assert.equal(result.adapter_error.blocked, true);
  assert.ok(result.adapter_error.retry_attempts >= 1);
  assert.equal(result.adapter_error.failure_class, "transient_retryable_failure");
  // Verify the diagnostic survives JSON serialization (tool-ledger shape)
  const toolLedger = { schema_version: "researchbrain_tool_ledger_v1", tool_calls: [{ tool: "search_web", status: "ok", output: result }] };
  const serialized = JSON.parse(JSON.stringify(toolLedger));
  assert.ok(serialized.tool_calls[0].output.adapter_error);
  assert.equal(serialized.tool_calls[0].output.adapter_error.failure_class, "transient_retryable_failure");
});

test("fixtureSearchRoutes with live LLM preserves retry_attempts on success", async () => {
  const rootDir = tempRoot();
  let searchCalls = 0;
  const successAdapter = {
    name: "success_adapter",
    async search() {
      searchCalls += 1;
      if (searchCalls === 1) throw new Error("HTTP 503 temporarily unavailable");
      return { provider: "success_adapter", provider_native_search_enabled: false, results: [{ result_id: "success-1", url: "https://example.test/success", title: "Success", source_class: "web", discovery_only: true }] };
    }
  };
  const toolRuntime = createResearchBrainToolRuntime({
    rootDir,
    runRepoDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-RETRY-SUCCESS",
    request: { request_id: "RESEARCHBRAIN-REQUEST-RETRY-SUCCESS" },
    toolMode: "live",
    sourceToolAdapter: successAdapter,
    retryPolicy: { sourceToolMaxAttempts: 2, sourceToolRetryDelayMs: 0 }
  });
  const result = await toolRuntime.execute("search_web", { query: "retry then succeed" });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].result_id, "success-1");
  assert.ok(!result.results.adapter_error, "no adapter_error on success");
});

test("composite source adapter reports all capture sub-adapter failures", async () => {
  const composite = createCompositeResearchBrainSourceToolAdapter({
    adapters: [
      {
        name: "adapter_one",
        supportedSearchToolNames: new Set(["search_web"]),
        live_research: true,
        async captureUrl() {
          throw new Error("adapter one rejected host");
        }
      },
      {
        name: "adapter_two",
        supportedSearchToolNames: new Set(["search_web"]),
        live_research: true,
        async captureUrl() {
          throw new Error("adapter two timeout");
        }
      }
    ]
  });

  await assert.rejects(
    () => composite.captureUrl({ input: { url: "https://example.test/source" }, discovery: {} }),
    (err) => {
      assert.match(err.message, /No sub-adapter could capture URL/);
      assert.match(err.message, /adapter_one: adapter one rejected host/);
      assert.match(err.message, /adapter_two: adapter two timeout/);
      assert.deepEqual(err.failures, [
        { adapter: "adapter_one", message: "adapter one rejected host" },
        { adapter: "adapter_two", message: "adapter two timeout" }
      ]);
      return true;
    }
  );
});

test("runtime CLI exposes explicit live LLM flags", () => {
  const result = spawnSync(process.execPath, ["scripts/run-researchbrain-stage0-runtime.mjs", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--allow-live-llm/);
  assert.match(result.stdout, /--llm-preset/);
  assert.match(result.stdout, /--llm-provider/);
  assert.match(result.stdout, /--llm-model/);
  assert.match(result.stdout, /--llm-api-key-env/);
  assert.match(result.stdout, /--llm-base-url-env/);
  assert.match(result.stdout, /--allow-live-source-search/);
  assert.match(result.stdout, /--source-api-key-env/);
  assert.match(result.stdout, /--allow-youtube-audio-transcription/);
});

test("runtime CLI preset selects Opencode DeepSeek key env and default Zen base URL", () => {
  const result = spawnSync(process.execPath, [
    "scripts/run-researchbrain-stage0-runtime.mjs",
    "--request", "factory/research/requests/nonexistent.json",
    "--provider-mode", "live_llm_agent",
    "--allow-live-llm",
    "--llm-preset", "opencode_deepseek_v4_pro"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, OPENCODE_GO_API_KEY: "", OPENCODE_API_BASE_URL: "" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OPENCODE_GO_API_KEY/);
  assert.doesNotMatch(result.stderr, /OPENCODE_API_BASE_URL/);
});

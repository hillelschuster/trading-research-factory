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
import { createBraveResearchBrainSourceToolAdapter, createMapResearchBrainSourceToolAdapter, createResearchBrainToolRuntime } from "../src/core/researchbrain-tools.mjs";
import { runResearchBrainStage0Runtime, validateResearchBrainStage0RuntimeResult } from "../src/core/researchbrain-runtime.mjs";

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

test("record_hypothesis requires all memory tools in the same run", async () => {
  const rootDir = tempRoot();
  const url = "https://example.test/missing-memory";
  const result = await runScript(rootDir, [
    { tool: "search_web", input: { results: [{ result_id: "missing-memory-1", url, title: "Missing memory", discovery_only: true }] } },
    { tool: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A fixture source exists, but the agent did not call the mandatory memory tools before recording." } },
    { tool: "search_research_memory", input: { query: "volatility contraction" } },
    { tool: "record_hypothesis", input: hypothesis() }
  ], { runId: "RESEARCHBRAIN-STAGE0-MISSING-MEMORY-TOOLS", outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-MISSING-MEMORY-TOOLS" });

  assert.equal(result.status, "blocked");
  assert.match(result.attempts[0].reason, /requires prior memory tool calls/);
  assert.match(result.attempts[0].reason, /check_duplicate_memory/);
  assert.match(result.attempts[0].reason, /check_failed_pattern_similarity/);
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
  assert.throws(() => createResearchBrainLlmClient({ provider: "anthropic", model: "claude-opus-fixture", apiKey: "test" }), /allowLiveLlm/);
  assert.throws(() => createResearchBrainLlmClient({ allowLiveLlm: true, provider: "openai", model: "gpt-fixture", apiKey: "test" }), /Unsupported ResearchBrain LLM provider/);
  assert.throws(() => createResearchBrainLlmClient({ allowLiveLlm: true, provider: "anthropic", model: "claude-opus-fixture", apiKeyEnv: "RESEARCHBRAIN_TEST_MISSING_KEY" }), /requires API key/);
  assert.throws(() => createResearchBrainLlmClient({ allowLiveLlm: true, provider: "openai_compatible", model: "deepseek-fixture", apiKey: "test", baseUrlEnv: "RESEARCHBRAIN_TEST_MISSING_BASE_URL" }), /requires base URL/);
  assert.throws(() => createResearchBrainLlmClient({ allowLiveLlm: true, provider: "deepseek", model: "deepseek-v4-flash-fixture", apiKeyEnv: "RESEARCHBRAIN_TEST_MISSING_KEY" }), /requires API key/);
});

test("Anthropic direct adapter maps fake tool-use responses through the live agent seam", async () => {
  const rootDir = tempRoot();
  const paths = initializeProject(rootDir);
  const beforeOfficial = officialFileHashes(paths);
  const url = "https://example.test/anthropic-adapter";
  const calls = [];
  const toolCalls = [
    { name: "search_web", input: { query: "anthropic adapter volatility contraction", results: [{ result_id: "anthropic-1", url, title: "Adapter source", discovery_only: true }] } },
    { name: "capture_url_source", input: { source_id: "SRC-WEB-AGENT-001", url, content: "A fake Anthropic adapter source discusses volatility contraction, liquidity imbalance, limitations, and deterministic falsification without profitability claims." } },
    ...memoryCheckSteps().map((step) => ({ name: step.tool, input: step.input })),
    { name: "record_hypothesis", input: hypothesis({ hypothesis_id: "HYP-STAGE0-ANTHROPIC-ADAPTER-001" }) }
  ];

  const llmClient = createResearchBrainLlmClient({
    allowLiveLlm: true,
    provider: "anthropic",
    model: "claude-opus-fixture",
    apiKey: "test-anthropic-key",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              id: "msg_tool_fixture",
              type: "message",
              role: "assistant",
              model: "claude-opus-fixture",
              stop_reason: "tool_use",
              usage: { input_tokens: 100, output_tokens: 50 },
              content: toolCalls.map((call, index) => ({ type: "tool_use", id: `toolu_${index + 1}`, ...call }))
            });
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "msg_final_fixture",
            type: "message",
            role: "assistant",
            model: "claude-opus-fixture",
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 10 },
            content: [{ type: "text", text: "Final Stage-0 tool work is ready for deterministic runtime validation." }]
          });
        }
      };
    }
  });

  const result = await runResearchBrainStage0Runtime({
    rootDir,
    request: request(rootDir, { requestId: "RESEARCHBRAIN-REQUEST-ANTHROPIC-ADAPTER" }),
    runId: "RESEARCHBRAIN-STAGE0-ANTHROPIC-ADAPTER",
    outputDir: "factory/research/runs/RESEARCHBRAIN-STAGE0-ANTHROPIC-ADAPTER",
    observedAt: "2026-05-22T01:03:00Z",
    provider: createLiveResearchBrainAgentProvider({
      allowLiveLlm: true,
      llmProvider: "anthropic",
      llmModel: "claude-opus-fixture",
      toolMode: "fixture",
      maxLlmCalls: 2,
      llmClient
    }),
    maxAttempts: 1,
    maxProviderCalls: 1,
    timeoutMs: 1000
  });

  assert.equal(result.status, "ready");
  assert.equal(validateResearchBrainStage0RuntimeResult(result, { rootDir, requireExisting: true }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].options.headers["anthropic-version"], "2023-06-01");
  assert.equal(calls[0].body.tools.some((tool) => tool.name === "record_hypothesis"), true);
  assert.equal(calls[0].body.tools.some((tool) => String(tool.name).includes("web_search")), false);
  assert.deepEqual(officialFileHashes(paths), beforeOfficial);
  const costLedgerRef = result.artifacts_created.find((artifact) => artifact.artifact_type === "researchbrain_cost_ledger");
  const costLedger = JSON.parse(fs.readFileSync(path.join(rootDir, costLedgerRef.path), "utf8"));
  assert.equal(costLedger.llm_provider, "anthropic");
  assert.equal(costLedger.live_llm, true);
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

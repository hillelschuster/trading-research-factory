import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildResearchBrainRetrievalEntries } from "./memory-index.mjs";
import { RESEARCHBRAIN_FORBIDDEN_PROFITABILITY_KEYS } from "./researchbrain-artifacts.mjs";
import { youtubeIngest } from "./researchbrain-youtube-ingest.mjs";
import { runWithRetryAttempts } from "./retry-policy.mjs";

export const RESEARCHBRAIN_ALLOWED_TOOLS = Object.freeze([
  "search_web",
  "search_official_docs",
  "search_mql5_sources",
  "search_broker_docs",
  "search_youtube",
  "search_arxiv",
  "search_semantic_scholar",
  "search_github_code",
  "capture_url_source",
  "capture_github_artifact",
  "inspect_youtube_video",
  "read_repo_artifact",
  "search_research_memory",
  "check_duplicate_memory",
  "check_failed_pattern_similarity",
  "record_rejection",
  "record_hypothesis"
]);

const RESEARCHBRAIN_ALLOWED_TOOL_SET = new Set(RESEARCHBRAIN_ALLOWED_TOOLS);

const RESEARCHBRAIN_SOURCE_SEARCH_TOOL_SET = new Set([
  "search_web",
  "search_official_docs",
  "search_mql5_sources",
  "search_broker_docs",
  "search_youtube",
  "search_arxiv",
  "search_semantic_scholar",
  "search_github_code"
]);

const RESEARCHBRAIN_REPO_ARTIFACT_ALLOWED_ROOTS = Object.freeze([
  "factory/research/",
  "factory/mt5/",
  "factory/verification/",
  "factory/experiments/",
  "factory/runs/",
  "factory/summaries/",
  "factory/evidence/",
  "factory/memory/",
  "workspace/results/"
]);

const RESEARCHBRAIN_REQUIRED_MEMORY_TOOLS = Object.freeze([
  "search_research_memory",
  "check_duplicate_memory",
  "check_failed_pattern_similarity"
]);

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (typeof repoRelativePath !== "string" || repoRelativePath.trim().length === 0 || path.isAbsolute(repoRelativePath)) {
    throw new Error(`ResearchBrain tool ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain tool ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function assertRealPathInsideRoot(rootDir, fullPath, label = "path") {
  const realRoot = fs.realpathSync(rootDir);
  const realFullPath = fs.realpathSync(fullPath);
  const relative = path.relative(realRoot, realFullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ResearchBrain tool ${label} escapes repository root through real path: ${repoRelative(rootDir, fullPath)}`);
  }
}

function assertAllowedRepoArtifactReadPath(repoPath) {
  const normalized = repoPath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const parts = lower.split("/");
  if (!RESEARCHBRAIN_REPO_ARTIFACT_ALLOWED_ROOTS.some((root) => lower.startsWith(root))) {
    throw new Error(`read_repo_artifact path is outside approved artifact roots: ${repoPath}`);
  }
  if (parts.includes(".git") || parts.includes(".opencode")) {
    throw new Error(`read_repo_artifact denies git/opencode paths: ${repoPath}`);
  }
  const fileName = parts.at(-1) ?? "";
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    throw new Error(`read_repo_artifact denies environment files: ${repoPath}`);
  }
  if (fileName === "opencode.json" || fileName === "opencode.jsonc") {
    throw new Error(`read_repo_artifact denies opencode config: ${repoPath}`);
  }
  if (/(^|[-_.])(credential|credentials|secret|token|api[-_]?key|private[-_]?key|access[-_]?key)([-_.]|$)/i.test(fileName)) {
    throw new Error(`read_repo_artifact denies credential/key/token-like files: ${repoPath}`);
  }
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "researchbrain-tool";
}

function artifactRef(rootDir, fullPath) {
  return {
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath)
  };
}

function writeJson(rootDir, repoPath, value) {
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "output_path");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return artifactRef(rootDir, fullPath);
}

function writeText(rootDir, repoPath, value) {
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "output_path");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return artifactRef(rootDir, fullPath);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !["the", "and", "for", "with", "from", "this", "that", "using", "strategy"].includes(token));
}

function overlap(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  let count = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) count += 1;
  return count;
}

function collectForbiddenKeys(value, pathPrefix = "") {
  if (Array.isArray(value)) return value.flatMap((item, index) => collectForbiddenKeys(item, `${pathPrefix}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const matches = [];
  for (const [key, item] of Object.entries(value)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (RESEARCHBRAIN_FORBIDDEN_PROFITABILITY_KEYS.has(key)) matches.push(currentPath);
    matches.push(...collectForbiddenKeys(item, currentPath));
  }
  return matches;
}

function defaultSearchResult(toolName, input) {
  const host = toolName.replace(/^search_/, "").replace(/_/g, "-") || "web";
  return {
    result_id: `${toolName}-result-001`,
    url: input.url ?? `https://${host}.researchbrain.test/${sanitizePathPart(input.query ?? "source")}`,
    title: input.title ?? `${toolName} deterministic discovery result`,
    snippet: input.snippet ?? `Deterministic ${toolName} fixture result for ${input.query ?? "ResearchBrain"}.`,
    discovery_only: true,
    source_class: input.source_class ?? host
  };
}

function parseYoutubeVideoId(input) {
  if (typeof input.video_id === "string" && input.video_id.trim()) return input.video_id.trim();
  if (typeof input.url !== "string") return null;
  const parsed = new URL(input.url);
  return parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop() || null;
}

function memoryEntries(rootDir, request) {
  const entries = [];
  try {
    entries.push(...buildResearchBrainRetrievalEntries(rootDir));
  } catch {
    // Memory search is best-effort read-only; malformed active artifacts should fail elsewhere.
  }
  entries.push(...asArray(request.prior_failed_patterns).map((text, index) => ({
    retrieval_id: `request_prior_failed_pattern:${index + 1}`,
    source_type: "prior_failed_pattern",
    retrieval_text: text,
    snippet: { text }
  })));
  entries.push(...asArray(request.prior_lessons).map((text, index) => ({
    retrieval_id: `request_prior_lesson:${index + 1}`,
    source_type: "prior_lesson",
    retrieval_text: text,
    snippet: { text }
  })));
  return entries;
}

function sourceCaptureFromUrl({ input, contentRef, liveResearch = false, deterministicCapture = false, adapterProvenance = null }) {
  return {
    source_id: input.source_id,
    source_type: input.source_type ?? `${input.source_class ?? "web"}_captured_source`,
    trust_tier: input.trust_tier ?? (input.source_class === "official_docs" || input.source_class === "broker" ? "high_operational_trust" : "low_signal_trust"),
    url_or_path_or_doi: input.url,
    content_path: contentRef.path,
    claims_extracted: asArray(input.claims_extracted).length ? input.claims_extracted : ["Captured deterministic source content for Stage-0 hypothesis discovery only."],
    limitations: asArray(input.limitations).length ? input.limitations : ["Source capture is Stage-0 only and cannot prove profitability or deployment readiness."],
    disconfirming_relevance: asArray(input.disconfirming_relevance).length ? input.disconfirming_relevance : ["Source-backed mechanism may fail later deterministic WFA and MT5 cost checks."],
    provider_provenance: {
      tool: "capture_url_source",
      source_class: input.source_class ?? "web",
      live_research: liveResearch === true,
      deterministic_capture: deterministicCapture === true,
      adapter: adapterProvenance
    }
  };
}

function normalizeSearchResults(toolName, response) {
  const results = asArray(response?.results);
  if (results.length < 1) throw new Error(`${toolName} deterministic source adapter returned no results`);
  return results.map((result, index) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`${toolName} result ${index + 1} must be an object`);
    if (typeof result.result_id !== "string" || result.result_id.trim().length === 0) throw new Error(`${toolName} result ${index + 1} requires result_id`);
    if (["search_web", "search_official_docs", "search_mql5_sources", "search_broker_docs", "search_arxiv", "search_semantic_scholar"].includes(toolName)) {
      if (typeof result.url !== "string" || result.url.trim().length === 0) throw new Error(`${toolName} result ${index + 1} requires url`);
    }
    return { ...result, discovery_only: true };
  });
}

function requireSourceToolAdapter(sourceToolAdapter, methodName, toolName) {
  if (!sourceToolAdapter || typeof sourceToolAdapter[methodName] !== "function") {
    throw new Error(`${toolName} live mode requires deterministic sourceToolAdapter.${methodName}`);
  }
  return sourceToolAdapter;
}

export function createMapResearchBrainSourceToolAdapter({ searches = {}, captures = {}, provider = "map_researchbrain_source_tool_adapter" } = {}) {
  return {
    name: provider,
    supportedSearchToolNames: new Set(RESEARCHBRAIN_SOURCE_SEARCH_TOOL_SET),
    live_research: false,
    provider_native_search_enabled: false,
    search({ toolName, input }) {
      const key = `${toolName}:${String(input.query ?? "").trim()}`;
      const response = searches[key] ?? searches[toolName];
      if (!response) throw new Error(`No deterministic source search fixture for ${key}`);
      return { provider, provider_native_search_enabled: false, ...response };
    },
    captureUrl({ input }) {
      const response = captures[input.url];
      if (!response) throw new Error(`No deterministic source capture fixture for URL: ${input.url}`);
      return { provider, live_fetch: false, provider_native_search_enabled: false, ...response };
    }
  };
}

export function createBraveResearchBrainSourceToolAdapter({
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  apiKey = null,
  apiKeyEnv = "BRAVE_SEARCH_API_KEY",
  fetchImpl = globalThis.fetch,
  searchEndpoint = "https://api.search.brave.com/res/v1/web/search",
  maxSearchResults = 5,
  maxCaptureBytes = 500_000
} = {}) {
  if (allowLiveSourceSearch !== true) throw new Error("Brave ResearchBrain source adapter requires explicit allowLiveSourceSearch=true");
  const resolvedApiKey = apiKey ?? process.env[apiKeyEnv];
  if (typeof resolvedApiKey !== "string" || resolvedApiKey.trim().length === 0) throw new Error(`Brave ResearchBrain source adapter requires API key in ${apiKeyEnv}`);
  if (typeof fetchImpl !== "function") throw new Error("Brave ResearchBrain source adapter requires fetchImpl");
  if (!Number.isInteger(maxSearchResults) || maxSearchResults < 1 || maxSearchResults > 10) throw new Error("Brave maxSearchResults must be an integer from 1 to 10");
  if (!Number.isInteger(maxCaptureBytes) || maxCaptureBytes < 1_000 || maxCaptureBytes > 1_000_000) throw new Error("Brave maxCaptureBytes must be an integer from 1000 to 1000000");
  const discoveredUrls = new Set();
  return {
    name: "brave_researchbrain_source_tool_adapter",
    supportedSearchToolNames: new Set(["search_web"]),
    live_research: true,
    provider_native_search_enabled: false,
    async search({ toolName, input }) {
      if (toolName !== "search_web") throw new Error(`Brave source adapter currently supports search_web only, got ${toolName}`);
      const query = String(input.query ?? "").trim();
      if (query.length < 3) throw new Error("Brave source search requires a meaningful query");
      const url = new URL(searchEndpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(maxSearchResults));
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-subscription-token": resolvedApiKey
        }
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Brave source search HTTP ${response.status}: ${text.slice(0, 500)}`);
      const parsed = JSON.parse(text);
      const results = asArray(parsed?.web?.results).slice(0, maxSearchResults).map((item, index) => {
        const resultUrl = String(item.url ?? "").trim();
        if (resultUrl.length > 0) discoveredUrls.add(resultUrl);
        return {
          result_id: `brave-${index + 1}`,
          url: resultUrl,
          title: String(item.title ?? resultUrl),
          snippet: String(item.description ?? ""),
          source_class: "web",
          discovery_only: true
        };
      }).filter((item) => item.url.length > 0);
      return { provider: "brave_search_api", provider_native_search_enabled: false, live_fetch: true, results };
    },
    async captureUrl({ input, discovery }) {
      if (allowLiveSourceCapture !== true) throw new Error("Brave ResearchBrain source adapter capture requires explicit allowLiveSourceCapture=true");
      const url = String(input.url ?? "").trim();
      if (!discoveredUrls.has(url) && discovery?.url !== url) throw new Error(`Brave source capture requires prior Brave discovery for URL: ${url}`);
      const response = await fetchImpl(url, { method: "GET", headers: { accept: "text/html,text/plain,application/xhtml+xml" } });
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maxCaptureBytes) throw new Error(`Brave source capture exceeded maxCaptureBytes ${maxCaptureBytes}: ${bytes}`);
      if (!response.ok) throw new Error(`Brave source capture HTTP ${response.status}: ${text.slice(0, 500)}`);
      return {
        provider: "brave_search_api_capture",
        live_fetch: true,
        provider_native_search_enabled: false,
        title: discovery?.title ?? input.title ?? null,
        content: text
      };
    }
  };
}

export function createResearchBrainToolRuntime({
  rootDir = process.cwd(),
  runRepoDir,
  request,
  observedAt = new Date().toISOString(),
  requireDiscoveryBeforeCapture = true,
  toolMode = "fixture",
  sourceToolAdapter = null,
  retryPolicy = {}
} = {}) {
  const root = path.resolve(rootDir);
  if (!runRepoDir) throw new Error("ResearchBrain tools require runRepoDir");
  resolveRepoRelativePath(root, runRepoDir, "run_repo_dir");
  if (!["fixture", "live"].includes(toolMode)) throw new Error(`Unsupported ResearchBrain tool mode: ${toolMode}`);
  const liveMode = toolMode === "live";
  const sourceToolMaxAttempts = Number.isInteger(retryPolicy.sourceToolMaxAttempts) ? retryPolicy.sourceToolMaxAttempts : 3;
  const sourceToolRetryDelayMs = Number.isInteger(retryPolicy.sourceToolRetryDelayMs) ? retryPolicy.sourceToolRetryDelayMs : 2000;
  const sourceToolMaxDelayMs = Number.isInteger(retryPolicy.sourceToolMaxDelayMs) ? retryPolicy.sourceToolMaxDelayMs : 30_000;

    const state = {
    discoveries: new Map(),
    sourceCaptures: [],
    hypotheses: [],
    rejections: [],
    duplicatesDetected: [],
    memoryChecks: Object.fromEntries(RESEARCHBRAIN_REQUIRED_MEMORY_TOOLS.map((toolName) => [toolName, false])),
    memoryChecked: false,
    blockingMemoryFindings: [],
    artifacts: [],
    youtubeBySourceId: new Map()
  };

  function rememberArtifact(artifactType, ref, extra = {}) {
    const artifact = { artifact_type: artifactType, ...ref, ...extra };
    state.artifacts.push(artifact);
    return artifact;
  }

  function rememberDiscovery(results) {
    for (const result of results) {
      if (typeof result.url === "string") state.discoveries.set(result.url, result);
      if (typeof result.video_id === "string") state.discoveries.set(`youtube:${result.video_id}`, result);
      if (typeof result.repo_url === "string" && typeof result.path === "string") state.discoveries.set(`github:${result.repo_url}:${result.path}`, result);
    }
  }

  function requireDiscoveredUrl(url) {
    if (requireDiscoveryBeforeCapture && !state.discoveries.has(url)) {
      throw new Error(`capture_url_source requires prior discovery result for URL: ${url}`);
    }
  }

  function requireSourceId(sourceId) {
    const capture = state.sourceCaptures.find((item) => item.source_id === sourceId);
    if (!capture) throw new Error(`record_hypothesis cites uncaptured source_id: ${sourceId}`);
    return capture;
  }

  function validateHypothesisInput(input) {
    const forbidden = collectForbiddenKeys(input);
    if (forbidden.length > 0) throw new Error(`record_hypothesis contains forbidden profitability or promotion fields: ${forbidden.join(", ")}`);
    const missingMemoryTools = RESEARCHBRAIN_REQUIRED_MEMORY_TOOLS.filter((toolName) => state.memoryChecks[toolName] !== true);
    if (missingMemoryTools.length > 0) {
      throw new Error(`record_hypothesis requires prior memory tool calls in this run: ${missingMemoryTools.join(", ")}`);
    }
    if (state.blockingMemoryFindings.length > 0) {
      throw new Error(`record_hypothesis blocked by memory similarity: ${state.blockingMemoryFindings.map((item) => item.reason).join("; ")}`);
    }
    const citedSourceIds = asArray(input.cited_source_ids).filter((sourceId) => typeof sourceId === "string" && sourceId.trim().length > 0);
    if (citedSourceIds.length === 0) throw new Error("record_hypothesis requires at least one cited_source_ids entry");
    for (const sourceId of citedSourceIds) {
      requireSourceId(sourceId);
    }
    for (const claim of asArray(input.source_claims)) {
      const sourceId = claim.citation_source_id ?? claim.source_id;
      if (!citedSourceIds.includes(sourceId)) throw new Error(`record_hypothesis source_claim cites source_id not listed in cited_source_ids: ${sourceId}`);
      if (claim.claim_class === "youtube_title_description") {
        throw new Error("YouTube title/description/channel/popularity cannot support a hypothesis");
      }
      if (claim.claim_class === "youtube_video_content") {
        const yt = state.youtubeBySourceId.get(sourceId);
        if (!yt || yt.researchbrain_allowed !== true) throw new Error(`YouTube source ${sourceId} has no transcript chunks and cannot support video-content claims`);
        const chunkIds = asArray(claim.chunk_ids);
        if (chunkIds.length === 0) throw new Error("YouTube video-content claims must cite timestamped chunk_ids");
        const known = new Set(yt.chunk_ids);
        for (const chunkId of chunkIds) {
          if (!known.has(chunkId)) throw new Error(`Unknown YouTube chunk_id cited: ${chunkId}`);
        }
      }
      const capture = requireSourceId(sourceId);
      const sourceClass = capture.provider_provenance?.source_class;
      if (["mt5_ftmo", "mql5"].includes(claim.claim_class) && !["mql5", "broker", "official_docs"].includes(sourceClass)) {
        throw new Error(`MT5/FTMO/MQL5 claim requires captured mql5/broker/official_docs source: ${sourceId}`);
      }
    }
  }

  async function fixtureSearchResults(toolName, input, fallbackFactory) {
    if (asArray(input.results).length) {
      if (liveMode) throw new Error(`${toolName} live mode rejects caller-supplied input.results`);
      return input.results;
    }
    if (liveMode) {
      const adapter = requireSourceToolAdapter(sourceToolAdapter, "search", toolName);
      const retried = await runWithRetryAttempts(() => adapter.search({ toolName, input, request, observedAt }), {
        phase: `researchbrain_source_search:${toolName}`,
        maxAttempts: sourceToolMaxAttempts,
        baseDelayMs: sourceToolRetryDelayMs,
        maxDelayMs: sourceToolMaxDelayMs
      });
      const results = normalizeSearchResults(toolName, retried.value);
      Object.defineProperty(results, "retry_attempts", { value: retried.attempts, enumerable: false });
      return results;
    }
    return [fallbackFactory()];
  }

  function searchProvider(toolName, fallbackProvider) {
    if (!liveMode) return fallbackProvider;
    return sourceToolAdapter?.name ?? "deterministic_source_tool_adapter";
  }

  const tools = {
    async search_web(input = {}) {
      const results = await fixtureSearchResults("search_web", input, () => defaultSearchResult("search_web", input));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_web", "fixture_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async search_official_docs(input = {}) {
      const results = await fixtureSearchResults("search_official_docs", input, () => defaultSearchResult("search_official_docs", { ...input, source_class: "official_docs" }));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_official_docs", "fixture_official_docs_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async search_mql5_sources(input = {}) {
      const results = await fixtureSearchResults("search_mql5_sources", input, () => defaultSearchResult("search_mql5_sources", { ...input, source_class: "mql5" }));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_mql5_sources", "fixture_mql5_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async search_broker_docs(input = {}) {
      const results = await fixtureSearchResults("search_broker_docs", input, () => defaultSearchResult("search_broker_docs", { ...input, source_class: "broker" }));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_broker_docs", "fixture_broker_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async search_youtube(input = {}) {
      const results = await fixtureSearchResults("search_youtube", input, () => ({
        result_id: "youtube-result-001",
        video_id: input.video_id ?? "YOUTUBE_FIXTURE_001",
        url: input.url ?? "https://www.youtube.com/watch?v=YOUTUBE_FIXTURE_001",
        title: input.title ?? "Deterministic YouTube discovery fixture",
        channel_title: input.channel_title ?? "Fixture Channel",
        description: input.description ?? "Discovery metadata only; not hypothesis support.",
        discovery_only: true
      }));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_youtube", "fixture_youtube_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async search_arxiv(input = {}) {
      const results = await fixtureSearchResults("search_arxiv", input, () => defaultSearchResult("search_arxiv", { ...input, source_class: "academic" }));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_arxiv", "fixture_arxiv_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async search_semantic_scholar(input = {}) {
      const results = await fixtureSearchResults("search_semantic_scholar", input, () => defaultSearchResult("search_semantic_scholar", { ...input, source_class: "academic" }));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_semantic_scholar", "fixture_semantic_scholar_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async search_github_code(input = {}) {
      const results = await fixtureSearchResults("search_github_code", input, () => ({
        result_id: "github-code-result-001",
        repo_url: input.repo_url ?? "https://github.com/example/researchbrain-fixture",
        path: input.path ?? "strategy.py",
        commit_sha: input.commit_sha ?? "0".repeat(40),
        license: input.license ?? "unknown",
        snippet: input.snippet ?? "Fixture code discovery only; never executed.",
        discovery_only: true
      }));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_github_code", "fixture_github_code_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results };
    },
    async capture_url_source(input = {}) {
      if (typeof input.url !== "string") throw new Error("capture_url_source requires url");
      if (typeof input.source_id !== "string") throw new Error("capture_url_source requires source_id");
      if (liveMode && typeof input.content === "string" && input.content.trim().length > 0) {
        throw new Error("capture_url_source live mode rejects LLM-supplied input.content; deterministic capture adapter required");
      }
      requireDiscoveredUrl(input.url);
      const existingCapture = state.sourceCaptures.find((item) => item.source_id === input.source_id);
      if (existingCapture) {
        return { status: "already_captured", source_id: input.source_id, source_capture: existingCapture };
      }
      const liveCaptureResult = liveMode ? await runWithRetryAttempts(() => requireSourceToolAdapter(sourceToolAdapter, "captureUrl", "capture_url_source").captureUrl({ input, discovery: state.discoveries.get(input.url), request, observedAt }), {
        phase: "researchbrain_source_capture:capture_url_source",
        maxAttempts: sourceToolMaxAttempts,
        baseDelayMs: sourceToolRetryDelayMs,
        maxDelayMs: sourceToolMaxDelayMs
      }) : null;
      const liveCapture = liveCaptureResult?.value ?? null;
      const sourceId = sanitizePathPart(input.source_id);
      const content = String(liveCapture?.content ?? input.content ?? `${input.title ?? input.url}\n\n${input.snippet ?? "Captured deterministic source content for Stage-0 discovery."}`);
      if (content.trim().length < 20) throw new Error("capture_url_source content must be meaningful");
      const contentRef = writeText(root, `${runRepoDir}/tool-captures/url/${sourceId}/content.md`, content);
      const metadataRef = writeJson(root, `${runRepoDir}/tool-captures/url/${sourceId}/metadata.json`, {
        source_id: input.source_id,
        url: input.url,
        title: input.title ?? liveCapture?.title ?? state.discoveries.get(input.url)?.title ?? null,
        source_class: input.source_class ?? state.discoveries.get(input.url)?.source_class ?? "web",
        captured_at: observedAt,
        live_fetch: liveCapture?.live_fetch === true,
        deterministic_capture: liveMode,
        adapter: liveCapture ? { provider: liveCapture.provider ?? sourceToolAdapter?.name ?? "deterministic_source_tool_adapter", provider_native_search_enabled: false } : null,
        retry_attempts: liveCaptureResult?.attempts ?? [],
        content_sha256: contentRef.sha256
      });
      rememberArtifact("researchbrain_captured_url_source", contentRef, { source_id: input.source_id });
      rememberArtifact("researchbrain_captured_url_metadata", metadataRef, { source_id: input.source_id });
      const sourceCapture = sourceCaptureFromUrl({
        input: { ...input, source_class: input.source_class ?? state.discoveries.get(input.url)?.source_class ?? "web" },
        contentRef,
        liveResearch: liveCapture?.live_fetch === true,
        deterministicCapture: liveMode,
        adapterProvenance: liveCapture ? { provider: liveCapture.provider ?? sourceToolAdapter?.name ?? "deterministic_source_tool_adapter", live_fetch: liveCapture.live_fetch === true, provider_native_search_enabled: false, retry_attempts: liveCaptureResult?.attempts ?? [] } : null
      });
      state.sourceCaptures.push(sourceCapture);
      return { status: "captured", source_id: input.source_id, content: contentRef, metadata: metadataRef, source_capture: sourceCapture };
    },
    capture_github_artifact(input = {}) {
      if (typeof input.source_id !== "string") throw new Error("capture_github_artifact requires source_id");
      if (typeof input.repo_url !== "string" || typeof input.path !== "string") throw new Error("capture_github_artifact requires repo_url and path");
      const discoveryKey = `github:${input.repo_url}:${input.path}`;
      if (requireDiscoveryBeforeCapture && !state.discoveries.has(discoveryKey)) throw new Error(`capture_github_artifact requires prior GitHub discovery: ${discoveryKey}`);
      const discovered = state.discoveries.get(discoveryKey) ?? {};
      const commitSha = input.commit_sha ?? discovered.commit_sha;
      if (!/^[a-f0-9]{40}$/i.test(String(commitSha ?? ""))) throw new Error("capture_github_artifact requires a 40-hex commit_sha");
      if (discovered.commit_sha && input.commit_sha && discovered.commit_sha !== input.commit_sha) throw new Error("capture_github_artifact commit_sha must match prior discovery");
      const license = input.license ?? discovered.license ?? "unknown";
      if (typeof license !== "string" || license.trim().length < 2) throw new Error("capture_github_artifact requires a meaningful license value or unknown");
      const sourceId = sanitizePathPart(input.source_id);
      const content = String(input.content ?? "// Fixture GitHub code capture. This file is never executed by ResearchBrain.\n");
      const codeRef = writeText(root, `${runRepoDir}/tool-captures/github/${sourceId}/artifact.txt`, content);
      const metadata = {
        source_id: input.source_id,
        repo_url: input.repo_url,
        path: input.path,
        commit_sha: commitSha,
        license,
        captured_at: observedAt,
        executed: false,
        imported: false,
        compiled: false,
        content_sha256: codeRef.sha256
      };
      const metadataRef = writeJson(root, `${runRepoDir}/tool-captures/github/${sourceId}/metadata.json`, metadata);
      rememberArtifact("researchbrain_github_artifact", codeRef, { source_id: input.source_id });
      rememberArtifact("researchbrain_github_metadata", metadataRef, { source_id: input.source_id });
      const sourceCapture = {
        source_id: input.source_id,
        source_type: "github_code_artifact",
        trust_tier: "medium_implementation_trust",
        url_or_path_or_doi: `${input.repo_url}/blob/${metadata.commit_sha ?? "unknown"}/${input.path}`,
        content_path: codeRef.path,
        claims_extracted: asArray(input.claims_extracted).length ? input.claims_extracted : ["Captured public code artifact for implementation-shape context only; it was not executed."],
        limitations: asArray(input.limitations).length ? input.limitations : ["Code provenance cannot prove profitability or correctness."],
        disconfirming_relevance: asArray(input.disconfirming_relevance).length ? input.disconfirming_relevance : ["Public code may be incomplete, overfit, stale, or license-constrained."],
        provider_provenance: { tool: "capture_github_artifact", source_class: "github_code", metadata, live_research: false }
      };
      state.sourceCaptures.push(sourceCapture);
      return { status: "captured", source_id: input.source_id, artifact: codeRef, metadata: metadataRef, source_capture: sourceCapture };
    },
    inspect_youtube_video(input = {}) {
      const videoId = parseYoutubeVideoId(input);
      if (requireDiscoveryBeforeCapture && videoId && !state.discoveries.has(`youtube:${videoId}`)) throw new Error(`inspect_youtube_video requires prior YouTube discovery for video_id: ${videoId}`);
      const sourceId = input.source_id ?? `SRC-YOUTUBE-${sanitizePathPart(videoId ?? "VIDEO")}`;
      const ingest = youtubeIngest({
        rootDir: root,
        outputDir: `${runRepoDir}/tool-captures/youtube`,
        input,
        observedAt
      });
      for (const [label, ref] of Object.entries(ingest.artifacts)) {
        if (ref) rememberArtifact(`researchbrain_youtube_${label}`, ref, { video_id: ingest.video_id });
      }
      if (ingest.researchbrain_allowed === true) {
        const chunkText = ingest.chunks.map((chunk) => `[${chunk.chunk_id}] ${chunk.timestamp_url}\n${chunk.text}`).join("\n\n");
        const contentRef = writeText(root, `${runRepoDir}/tool-captures/youtube/${sanitizePathPart(ingest.video_id)}/source-content.md`, chunkText);
        rememberArtifact("researchbrain_youtube_source_content", contentRef, { video_id: ingest.video_id, source_id: sourceId });
        const sourceCapture = {
          source_id: sourceId,
          source_type: "youtube_transcript_chunks",
          trust_tier: "low_signal_trust",
          url_or_path_or_doi: input.url ?? `https://www.youtube.com/watch?v=${encodeURIComponent(ingest.video_id)}`,
          content_path: contentRef.path,
          claims_extracted: asArray(input.claims_extracted).length ? input.claims_extracted : ["Captured timestamped YouTube transcript chunks for Stage-0 discovery only."],
          limitations: [
            "YouTube title, description, channel, and popularity cannot support hypotheses.",
            "Video-content claims must cite timestamped chunk_ids.",
            ...(asArray(input.limitations).length ? input.limitations : [])
          ],
          disconfirming_relevance: asArray(input.disconfirming_relevance).length ? input.disconfirming_relevance : ["Practitioner video content may be anecdotal, wrong, stale, or non-transferable to FTMO/MT5 symbols."],
          provider_provenance: {
            tool: "inspect_youtube_video",
            source_class: "youtube_video",
            video_id: ingest.video_id,
            transcript_provider: ingest.transcript_provider,
            source_risk: ingest.source_risk,
            chunk_ids: ingest.chunk_ids,
            artifacts: ingest.artifacts,
            live_research: false
          }
        };
        state.sourceCaptures.push(sourceCapture);
      }
      state.youtubeBySourceId.set(sourceId, ingest);
      return { status: ingest.status, source_id: sourceId, ingest };
    },
    read_repo_artifact(input = {}) {
      const fullPath = resolveRepoRelativePath(root, input.path, "read_repo_artifact.path");
      if (!fs.existsSync(fullPath)) throw new Error(`Repo artifact does not exist: ${input.path}`);
      assertRealPathInsideRoot(root, fullPath, "read_repo_artifact.path");
      const repoPath = repoRelative(root, fullPath);
      assertAllowedRepoArtifactReadPath(repoPath);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) throw new Error(`read_repo_artifact requires a regular file: ${input.path}`);
      const text = fs.readFileSync(fullPath, "utf8");
      const maxBytes = Number.isInteger(input.max_bytes) ? input.max_bytes : 32_000;
      return { path: repoPath, sha256: sha256File(fullPath), truncated: Buffer.byteLength(text, "utf8") > maxBytes, content: text.slice(0, maxBytes) };
    },
    search_research_memory(input = {}) {
      state.memoryChecks.search_research_memory = true;
      state.memoryChecked = true;
      const query = String(input.query ?? "");
      const results = memoryEntries(root, request)
        .map((entry) => ({ entry, score: overlap(query, entry.retrieval_text ?? JSON.stringify(entry.snippet ?? {})) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit ?? 5)
        .map(({ entry, score }) => ({ retrieval_id: entry.retrieval_id, source_type: entry.source_type, score, text: entry.retrieval_text, source_path: entry.source_path ?? null }));
      return { query, results };
    },
    check_duplicate_memory(input = {}) {
      state.memoryChecks.check_duplicate_memory = true;
      state.memoryChecked = true;
      const text = [input.mechanism, input.strategy_family, input.instrument_scope, input.timeframe_candidate].filter(Boolean).join(" ");
      const matches = memoryEntries(root, request)
        .map((entry) => ({ entry, score: overlap(text, entry.retrieval_text ?? JSON.stringify(entry.snippet ?? {})) }))
        .filter((item) => item.score >= (input.min_overlap ?? 4))
        .slice(0, 5);
      const duplicate = matches.length > 0;
      if (duplicate) state.duplicatesDetected.push({ reason: "memory_overlap", matches: matches.map(({ entry, score }) => ({ retrieval_id: entry.retrieval_id, score })) });
      return { duplicate, matches: matches.map(({ entry, score }) => ({ retrieval_id: entry.retrieval_id, source_type: entry.source_type, score })) };
    },
    check_failed_pattern_similarity(input = {}) {
      state.memoryChecks.check_failed_pattern_similarity = true;
      state.memoryChecked = true;
      const text = [input.mechanism, input.strategy_family, input.parameters, input.instrument_scope, input.timeframe_candidate].filter(Boolean).join(" ");
      const failedEntries = memoryEntries(root, request).filter((entry) => [
        "prior_failed_pattern",
        "lesson",
        "evidence",
        "phase8d_failed_summary",
        "research_ideation_manifest"
      ].includes(entry.source_type) || /failed|blocked|inconclusive|reject|duplicate|non-survivor|gate denied/i.test(entry.retrieval_text ?? ""));
      const matches = failedEntries
        .map((entry) => ({ entry, score: overlap(text, entry.retrieval_text ?? JSON.stringify(entry.snippet ?? {})) }))
        .filter((item) => item.score >= (input.min_overlap ?? 3))
        .slice(0, 5);
      const parameterOnly = matches.length > 0 && /\b(rsi|ema|sma|macd|atr|period|lookback|threshold)\b/i.test(text);
      if (parameterOnly) {
        state.blockingMemoryFindings.push({ reason: "parameter_only_failed_pattern_similarity", matches: matches.map(({ entry, score }) => ({ retrieval_id: entry.retrieval_id, score })) });
      }
      return { blocked: parameterOnly, reason: parameterOnly ? "parameter_only_failed_pattern_similarity" : null, matches: matches.map(({ entry, score }) => ({ retrieval_id: entry.retrieval_id, source_type: entry.source_type, score })) };
    },
    record_rejection(input = {}) {
      const rejection = {
        rejection_id: input.rejection_id ?? `REJECTION-${String(state.rejections.length + 1).padStart(3, "0")}`,
        rejected_at: observedAt,
        idea: input.idea ?? null,
        reason: input.reason ?? "Rejected by ResearchBrain scripted tool loop.",
        memory_basis: input.memory_basis ?? state.blockingMemoryFindings,
        official_state_mutated: false
      };
      const ref = writeJson(root, `${runRepoDir}/rejections/${sanitizePathPart(rejection.rejection_id)}.json`, rejection);
      rememberArtifact("researchbrain_rejection", ref, { rejection_id: rejection.rejection_id });
      state.rejections.push(rejection);
      return { status: "recorded", rejection, artifact: ref };
    },
    record_hypothesis(input = {}) {
      validateHypothesisInput(input);
      state.hypotheses.push(input);
      return { status: "recorded", hypothesis_id: input.hypothesis_id };
    }
  };

  return {
    state,
    isAllowedToolName(toolName) {
      return RESEARCHBRAIN_ALLOWED_TOOL_SET.has(toolName);
    },
    getAllowedToolNames() {
      if (!liveMode || !sourceToolAdapter) return [...RESEARCHBRAIN_ALLOWED_TOOLS];
      if (sourceToolAdapter.supportedSearchToolNames) {
        return RESEARCHBRAIN_ALLOWED_TOOLS.filter((toolName) => {
          if (RESEARCHBRAIN_SOURCE_SEARCH_TOOL_SET.has(toolName)) return sourceToolAdapter.supportedSearchToolNames.has(toolName);
          return true;
        });
      }
      return [...RESEARCHBRAIN_ALLOWED_TOOLS];
    },
    async execute(toolName, input = {}) {
      if (!RESEARCHBRAIN_ALLOWED_TOOL_SET.has(toolName)) throw new Error(`ResearchBrain tool is not allowed in v1: ${toolName}`);
      return await tools[toolName](input);
    },
    buildProviderOutput({ researchRunId, providerMode = "scripted_agent_fixture" }) {
      if (state.hypotheses.length < 1) throw new Error("ResearchBrain agent produced no accepted hypothesis packet");
      if (state.sourceCaptures.length < 1) throw new Error("ResearchBrain agent produced no captured source records");
      return {
        schema_version: "researchbrain_stage0_provider_output_v1",
        research_run_id: researchRunId,
        provider_mode: providerMode,
        key_findings: ["Scripted ResearchBrain tool loop produced Stage-0 source-backed hypothesis artifacts only."],
        limitations: ["Deterministic fake/scripted agent slice; no live LLM, live web, WFA, MT5, or profitability validation."],
        source_captures: state.sourceCaptures,
        hypothesis_packets: state.hypotheses,
        hypotheses_rejected: state.rejections,
        duplicates_detected: state.duplicatesDetected,
        memory_checked: { checked: state.memoryChecked, required_tool_calls: { ...state.memoryChecks }, basis: "ResearchBrain required memory, duplicate, and failed-pattern tools were called before accepting a hypothesis." }
      };
    }
  };
}

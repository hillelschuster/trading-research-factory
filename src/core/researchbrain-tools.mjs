import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildResearchBrainRetrievalEntries } from "./memory-index.mjs";
import { RESEARCHBRAIN_FORBIDDEN_PROFITABILITY_KEYS } from "./researchbrain-artifacts.mjs";
import { youtubeIngest } from "./researchbrain-youtube-ingest.mjs";
import { runWithRetryAttempts } from "./retry-policy.mjs";
import { writeWikiPage, searchWiki, writeSourcePage, writeHypothesisPage } from "./researchbrain-wiki.mjs";

/**
 * Minimal interval-based rate limiter.
 * Enforces at least `intervalMs` between consecutive requests for the same key.
 * Keys are typically adapter names. The first request passes immediately.
 */
export function createRateLimiter({ defaultIntervalMs = 0 } = {}) {
  if (!Number.isInteger(defaultIntervalMs) || defaultIntervalMs < 0) throw new Error("defaultIntervalMs must be a nonnegative integer");
  const lastCall = new Map();
  return {
    defaultIntervalMs,
    async acquire({ key = "_default", intervalMs = null } = {}) {
      const effectiveInterval = intervalMs ?? defaultIntervalMs;
      if (effectiveInterval <= 0) return;
      const now = Date.now();
      const last = lastCall.get(key) ?? 0;
      const elapsed = now - last;
      if (elapsed < effectiveInterval) {
        const waitMs = effectiveInterval - elapsed;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      lastCall.set(key, Date.now());
    },
    /** Returns a snapshot of internal state for tests — no PII. */
    snapshot() {
      const entries = [];
      for (const [key] of lastCall) entries.push(key);
      return { defaultIntervalMs, tracked_keys: entries.sort() };
    }
  };
}

export const RESEARCHBRAIN_ALLOWED_TOOLS = Object.freeze([
  "search_web",
  "search_official_docs",
  "search_mql5_sources",
  "search_broker_docs",
  "search_youtube",
  "search_arxiv",
  "search_github_code",
  "search_reddit",
  "search_semantic_scholar",
  "capture_url_source",
  "capture_github_artifact",
  "inspect_youtube_video",
  "read_repo_artifact",
  "search_research_memory",
  "check_duplicate_memory",
  "check_failed_pattern_similarity",
  "record_rejection",
  "record_hypothesis",
  "write_wiki_page",
  "search_wiki"
]);

const RESEARCHBRAIN_ALLOWED_TOOL_SET = new Set(RESEARCHBRAIN_ALLOWED_TOOLS);

const RESEARCHBRAIN_SOURCE_SEARCH_TOOL_SET = new Set([
  "search_web",
  "search_official_docs",
  "search_mql5_sources",
  "search_broker_docs",
  "search_youtube",
  "search_arxiv",
  "search_github_code",
  "search_reddit",
  "search_semantic_scholar"
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
  if (results.length < 1) return [];
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
  maxCaptureBytes = 500_000,
  rateLimiter = null
} = {}) {
  if (allowLiveSourceSearch !== true) throw new Error("Brave ResearchBrain source adapter requires explicit allowLiveSourceSearch=true");
  const resolvedApiKey = apiKey ?? process.env[apiKeyEnv];
  if (typeof resolvedApiKey !== "string" || resolvedApiKey.trim().length === 0) throw new Error(`Brave ResearchBrain source adapter requires API key in ${apiKeyEnv}`);
  if (typeof fetchImpl !== "function") throw new Error("Brave ResearchBrain source adapter requires fetchImpl");
  if (!Number.isInteger(maxSearchResults) || maxSearchResults < 1 || maxSearchResults > 10) throw new Error("Brave maxSearchResults must be an integer from 1 to 10");
  if (!Number.isInteger(maxCaptureBytes) || maxCaptureBytes < 1_000 || maxCaptureBytes > 1_000_000) throw new Error("Brave maxCaptureBytes must be an integer from 1000 to 1000000");
  // Rate limiter: Brave free plan has per-second limits (429 with retry). Optional rate limiter for tests/admission control.
  const resolvedRateLimiter = rateLimiter ?? createRateLimiter({ defaultIntervalMs: 0 });
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
      await resolvedRateLimiter.acquire({ key: "brave_search" });
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
      await resolvedRateLimiter.acquire({ key: "brave_capture" });
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
    },
    /** Expose for test/diagnostic access — no PII. */
    getRateLimiterSnapshot() {
      return resolvedRateLimiter.snapshot();
    }
  };
}

// Composite adapter: dispatches to multiple sub-adapters based on tool name.
// This is how we support arxiv, Reddit, GitHub, etc. alongside Brave.
export function createCompositeResearchBrainSourceToolAdapter({ adapters = [] } = {}) {
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new Error("Composite adapter requires at least one sub-adapter");
  }
  const supportedSearchToolNames = new Set();
  for (const adapter of adapters) {
    for (const name of adapter.supportedSearchToolNames) supportedSearchToolNames.add(name);
  }
  return {
    name: "composite_researchbrain_source_tool_adapter",
    supportedSearchToolNames,
    live_research: adapters.some((a) => a.live_research),
    provider_native_search_enabled: false,
    async search({ toolName, input, request, observedAt }) {
      const adapter = adapters.find((a) => a.supportedSearchToolNames.has(toolName));
      if (!adapter) throw new Error(`No sub-adapter supports tool: ${toolName}`);
      return adapter.search({ toolName, input, request, observedAt });
    },
    async captureUrl({ input, discovery }) {
      // Try each adapter until one succeeds
      const failures = [];
      for (const adapter of adapters) {
        try {
          return await adapter.captureUrl({ input, discovery });
        } catch (err) {
          failures.push({ adapter: adapter.name ?? "unnamed_sub_adapter", message: err instanceof Error ? err.message : String(err) });
          // Try next adapter
        }
      }
      const details = failures.map((failure) => `${failure.adapter}: ${failure.message}`).join("; ");
      const error = new Error(`No sub-adapter could capture URL: ${input.url}${details ? ` (${details})` : ""}`);
      error.failures = failures;
      throw error;
    }
  };
}

// arxiv adapter — free API, no auth, 1 req/3sec, returns Atom XML.
// TODO: Wire createRateLimiter for 3s interval. See Semantic Scholar adapter for pattern.
export function createArxivResearchBrainSourceToolAdapter({
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  fetchImpl = globalThis.fetch,
  searchEndpoint = "http://export.arxiv.org/api/query",
  maxSearchResults = 5,
  maxCaptureBytes = 500_000
} = {}) {
  if (allowLiveSourceSearch !== true) throw new Error("arxiv ResearchBrain source adapter requires explicit allowLiveSourceSearch=true");
  if (typeof fetchImpl !== "function") throw new Error("arxiv ResearchBrain source adapter requires fetchImpl");
  const discoveredUrls = new Set();
  return {
    name: "arxiv_researchbrain_source_tool_adapter",
    supportedSearchToolNames: new Set(["search_arxiv"]),
    live_research: true,
    provider_native_search_enabled: false,
    async search({ toolName, input }) {
      if (toolName !== "search_arxiv") throw new Error(`arxiv adapter supports search_arxiv only, got ${toolName}`);
      const query = String(input.query ?? "").trim();
      if (query.length < 3) throw new Error("arxiv source search requires a meaningful query");
      const url = new URL(searchEndpoint);
      url.searchParams.set("search_query", `all:${query}`);
      url.searchParams.set("start", "0");
      url.searchParams.set("max_results", String(maxSearchResults));
      const response = await fetchImpl(url.toString(), { method: "GET", headers: { accept: "application/atom+xml" } });
      const text = await response.text();
      if (!response.ok) throw new Error(`arxiv source search HTTP ${response.status}: ${text.slice(0, 500)}`);
      // Parse Atom XML with regex (caveman mode — no npm XML parser)
      const entries = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;
      let index = 0;
      while ((match = entryRegex.exec(text)) !== null && index < maxSearchResults) {
        const entry = match[1];
        const id = (entry.match(/<id>([^<]+)<\/id>/) || [])[1]?.trim() || "";
        const title = (entry.match(/<title>([^<]+)<\/title>/) || [])[1]?.trim() || id;
        const summary = (entry.match(/<summary>([^<]*)<\/summary>/) || [])[1]?.trim() || "";
        if (id) discoveredUrls.add(id);
        entries.push({
          result_id: `arxiv-${index + 1}`,
          url: id,
          title,
          snippet: summary.slice(0, 300),
          source_class: "academic",
          discovery_only: true
        });
        index++;
      }
      return { provider: "arxiv_api", provider_native_search_enabled: false, live_fetch: true, results: entries };
    },
    async captureUrl({ input, discovery }) {
      if (allowLiveSourceCapture !== true) throw new Error("arxiv adapter capture requires explicit allowLiveSourceCapture=true");
      const url = String(input.url ?? "").trim();
      if (!discoveredUrls.has(url) && discovery?.url !== url) throw new Error(`arxiv capture requires prior arxiv discovery for URL: ${url}`);
      const response = await fetchImpl(url, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" } });
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maxCaptureBytes) throw new Error(`arxiv capture exceeded maxCaptureBytes ${maxCaptureBytes}: ${bytes}`);
      if (!response.ok) throw new Error(`arxiv capture HTTP ${response.status}: ${text.slice(0, 500)}`);
      return {
        provider: "arxiv_api_capture",
        live_fetch: true,
        provider_native_search_enabled: false,
        title: discovery?.title ?? input.title ?? null,
        content: text
      };
    }
  };
}

// Reddit adapter — OAuth client_credentials flow, free 100 QPM.
// Env: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
// TODO: Wire createRateLimiter for rate-limit discipline. See Semantic Scholar for pattern.
export function createRedditResearchBrainSourceToolAdapter({
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  clientId = null,
  clientSecret = null,
  clientIdEnv = "REDDIT_CLIENT_ID",
  clientSecretEnv = "REDDIT_CLIENT_SECRET",
  userAgent = "ResearchBrain/1.0",
  fetchImpl = globalThis.fetch,
  maxSearchResults = 5,
  maxCaptureBytes = 500_000
} = {}) {
  if (allowLiveSourceSearch !== true) throw new Error("Reddit adapter requires explicit allowLiveSourceSearch=true");
  const resolvedClientId = clientId ?? process.env[clientIdEnv];
  const resolvedClientSecret = clientSecret ?? process.env[clientSecretEnv];
  if (!resolvedClientId || !resolvedClientSecret) throw new Error(`Reddit adapter requires ${clientIdEnv} and ${clientSecretEnv}`);
  if (typeof fetchImpl !== "function") throw new Error("Reddit adapter requires fetchImpl");
  const discoveredUrls = new Set();
  let tokenCache = null;

  async function getAccessToken() {
    if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    const response = await fetchImpl("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${resolvedClientId}:${resolvedClientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent
      },
      body: "grant_type=client_credentials"
    });
    if (!response.ok) throw new Error(`Reddit OAuth HTTP ${response.status}`);
    const data = await response.json();
    tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return tokenCache.token;
  }

  return {
    name: "reddit_researchbrain_source_tool_adapter",
    supportedSearchToolNames: new Set(["search_reddit"]),
    live_research: true,
    provider_native_search_enabled: false,
    async search({ toolName, input }) {
      if (toolName !== "search_reddit") throw new Error(`Reddit adapter supports search_reddit only, got ${toolName}`);
      const query = String(input.query ?? "").trim();
      if (query.length < 3) throw new Error("Reddit search requires a meaningful query");
      const token = await getAccessToken();
      const url = new URL("https://oauth.reddit.com/search");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(maxSearchResults));
      url.searchParams.set("sort", "relevance");
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": userAgent }
      });
      if (!response.ok) throw new Error(`Reddit search HTTP ${response.status}`);
      const data = await response.json();
      const results = asArray(data?.data?.children).slice(0, maxSearchResults).map((item, index) => {
        const postData = item?.data ?? {};
        const postUrl = `https://www.reddit.com${postData.permalink ?? ""}`;
        if (postUrl) discoveredUrls.add(postUrl);
        return {
          result_id: `reddit-${index + 1}`,
          url: postUrl,
          title: String(postData.title ?? postUrl),
          snippet: String(postData.selftext ?? postData.url ?? "").slice(0, 300),
          source_class: "social",
          discovery_only: true
        };
      }).filter((item) => item.url.length > 0);
      return { provider: "reddit_api", provider_native_search_enabled: false, live_fetch: true, results };
    },
    async captureUrl({ input, discovery }) {
      if (allowLiveSourceCapture !== true) throw new Error("Reddit adapter capture requires explicit allowLiveSourceCapture=true");
      const url = String(input.url ?? "").trim();
      if (!discoveredUrls.has(url) && discovery?.url !== url) throw new Error(`Reddit capture requires prior Reddit discovery for URL: ${url}`);
      const token = await getAccessToken();
      const jsonUrl = url.replace(/\/$/, "") + ".json";
      const response = await fetchImpl(jsonUrl, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": userAgent }
      });
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maxCaptureBytes) throw new Error(`Reddit capture exceeded maxCaptureBytes ${maxCaptureBytes}: ${bytes}`);
      if (!response.ok) throw new Error(`Reddit capture HTTP ${response.status}: ${text.slice(0, 500)}`);
      return {
        provider: "reddit_api_capture",
        live_fetch: true,
        provider_native_search_enabled: false,
        title: discovery?.title ?? input.title ?? null,
        content: text
      };
    }
  };
}

// GitHub adapter — free API, 10 req/min unauthenticated, 30/min with token.
// Env: GITHUB_TOKEN (optional)
// TODO: Wire createRateLimiter for rate-limit discipline. See Semantic Scholar for pattern.
export function createGithubResearchBrainSourceToolAdapter({
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  token = null,
  tokenEnv = "GITHUB_TOKEN",
  fetchImpl = globalThis.fetch,
  maxSearchResults = 5,
  maxCaptureBytes = 500_000
} = {}) {
  if (allowLiveSourceSearch !== true) throw new Error("GitHub adapter requires explicit allowLiveSourceSearch=true");
  if (typeof fetchImpl !== "function") throw new Error("GitHub adapter requires fetchImpl");
  const resolvedToken = token ?? process.env[tokenEnv];
  const discoveredUrls = new Set();
  return {
    name: "github_researchbrain_source_tool_adapter",
    supportedSearchToolNames: new Set(["search_github_code"]),
    live_research: true,
    provider_native_search_enabled: false,
    async search({ toolName, input }) {
      if (toolName !== "search_github_code") throw new Error(`GitHub adapter supports search_github_code only, got ${toolName}`);
      const query = String(input.query ?? "").trim();
      if (query.length < 3) throw new Error("GitHub search requires a meaningful query");
      const url = new URL("https://api.github.com/search/code");
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", String(maxSearchResults));
      const headers = { "Accept": "application/vnd.github+json", "User-Agent": "ResearchBrain/1.0" };
      if (resolvedToken) headers["Authorization"] = `Bearer ${resolvedToken}`;
      const response = await fetchImpl(url.toString(), { method: "GET", headers });
      if (!response.ok) throw new Error(`GitHub search HTTP ${response.status}`);
      const data = await response.json();
      const results = asArray(data?.items).slice(0, maxSearchResults).map((item, index) => {
        const repoUrl = item?.repository?.html_url ?? "";
        const filePath = item?.path ?? "";
        const rawUrl = item?.html_url ?? `${repoUrl}/blob/HEAD/${filePath}`;
        if (rawUrl) discoveredUrls.add(rawUrl);
        return {
          result_id: `github-${index + 1}`,
          url: rawUrl,
          repo_url: repoUrl,
          title: `${item?.repository?.full_name ?? "unknown"}/${filePath}`,
          snippet: String(item?.text_matches?.[0]?.fragment ?? "").slice(0, 300),
          source_class: "code",
          discovery_only: true
        };
      }).filter((item) => item.url.length > 0);
      return { provider: "github_api", provider_native_search_enabled: false, live_fetch: true, results };
    },
    async captureUrl({ input, discovery }) {
      if (allowLiveSourceCapture !== true) throw new Error("GitHub adapter capture requires explicit allowLiveSourceCapture=true");
      const url = String(input.url ?? "").trim();
      if (!discoveredUrls.has(url) && discovery?.url !== url) throw new Error(`GitHub capture requires prior GitHub discovery for URL: ${url}`);
      const response = await fetchImpl(url, { method: "GET", headers: { "Accept": "text/plain", "User-Agent": "ResearchBrain/1.0" } });
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maxCaptureBytes) throw new Error(`GitHub capture exceeded maxCaptureBytes ${maxCaptureBytes}: ${bytes}`);
      if (!response.ok) throw new Error(`GitHub capture HTTP ${response.status}: ${text.slice(0, 500)}`);
      return {
        provider: "github_api_capture",
        live_fetch: true,
        provider_native_search_enabled: false,
        title: discovery?.title ?? input.title ?? null,
        content: text
      };
    }
  };
}

// Semantic Scholar adapter — free API, 100 req/5min without key, 1 req/sec with key.
// Env: SEMANTIC_SCHOLAR_API_KEY (optional)
export function createSemanticScholarResearchBrainSourceToolAdapter({
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  apiKey = null,
  apiKeyEnv = "SEMANTIC_SCHOLAR_API_KEY",
  fetchImpl = globalThis.fetch,
  maxSearchResults = 5,
  maxCaptureBytes = 500_000,
  rateLimiter = null
} = {}) {
  if (allowLiveSourceSearch !== true) throw new Error("Semantic Scholar adapter requires explicit allowLiveSourceSearch=true");
  if (typeof fetchImpl !== "function") throw new Error("Semantic Scholar adapter requires fetchImpl");
  const resolvedApiKey = apiKey ?? process.env[apiKeyEnv];
  const discoveredUrls = new Set();
  // Rate limit: 1 req/sec when API key present, else 100 req/5min → 3000ms min interval.
  const resolvedRateLimiter = rateLimiter ?? createRateLimiter({ defaultIntervalMs: resolvedApiKey ? 1000 : 3000 });
  return {
    name: "semantic_scholar_researchbrain_source_tool_adapter",
    supportedSearchToolNames: new Set(["search_semantic_scholar"]),
    live_research: true,
    provider_native_search_enabled: false,
    async search({ toolName, input }) {
      if (toolName !== "search_semantic_scholar") throw new Error(`Semantic Scholar adapter supports search_semantic_scholar only, got ${toolName}`);
      const query = String(input.query ?? "").trim();
      if (query.length < 3) throw new Error("Semantic Scholar search requires a meaningful query");
      await resolvedRateLimiter.acquire({ key: "semantic_scholar_search" });
      const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
      url.searchParams.set("query", query);
      url.searchParams.set("limit", String(maxSearchResults));
      url.searchParams.set("fields", "title,abstract,url,year,authors");
      const headers = { "Accept": "application/json" };
      if (resolvedApiKey) headers["x-api-key"] = resolvedApiKey;
      const response = await fetchImpl(url.toString(), { method: "GET", headers });
      if (!response.ok) throw new Error(`Semantic Scholar search HTTP ${response.status}`);
      const data = await response.json();
      const results = asArray(data?.data).slice(0, maxSearchResults).map((item, index) => {
        const paperUrl = item?.url ?? `https://www.semanticscholar.org/paper/${item?.paperId ?? ""}`;
        if (paperUrl) discoveredUrls.add(paperUrl);
        const authors = asArray(item?.authors).map(a => a.name).join(", ");
        return {
          result_id: `semantic-scholar-${index + 1}`,
          url: paperUrl,
          title: String(item?.title ?? paperUrl),
          snippet: String(item?.abstract ?? "").slice(0, 300),
          source_class: "academic",
          discovery_only: true,
          authors,
          year: item?.year ?? null
        };
      }).filter((item) => item.url.length > 0);
      return { provider: "semantic_scholar_api", provider_native_search_enabled: false, live_fetch: true, results };
    },
    async captureUrl({ input, discovery }) {
      if (allowLiveSourceCapture !== true) throw new Error("Semantic Scholar adapter capture requires explicit allowLiveSourceCapture=true");
      const url = String(input.url ?? "").trim();
      if (!discoveredUrls.has(url) && discovery?.url !== url) throw new Error(`Semantic Scholar capture requires prior discovery for URL: ${url}`);
      await resolvedRateLimiter.acquire({ key: "semantic_scholar_capture" });
      const response = await fetchImpl(url, { method: "GET", headers: { "Accept": "text/html,application/xhtml+xml" } });
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maxCaptureBytes) throw new Error(`Semantic Scholar capture exceeded maxCaptureBytes ${maxCaptureBytes}: ${bytes}`);
      if (!response.ok) throw new Error(`Semantic Scholar capture HTTP ${response.status}: ${text.slice(0, 500)}`);
      return {
        provider: "semantic_scholar_api_capture",
        live_fetch: true,
        provider_native_search_enabled: false,
        title: discovery?.title ?? input.title ?? null,
        content: text
      };
    },
    /** Expose for test/diagnostic access — no PII. */
    getRateLimiterSnapshot() {
      return resolvedRateLimiter.snapshot();
    }
  };
}

// Site-scoped adapter for MQL5 forum and broker docs.
// Uses Brave API with site: prefix. One function, two adapters.
export function createSiteScopedResearchBrainSourceToolAdapter({
  toolName,
  siteDomain,
  sourceClass,
  allowLiveSourceSearch = false,
  allowLiveSourceCapture = false,
  apiKey = null,
  apiKeyEnv = "BRAVE_SEARCH_API_KEY",
  fetchImpl = globalThis.fetch,
  searchEndpoint = "https://api.search.brave.com/res/v1/web/search",
  maxSearchResults = 5,
  maxCaptureBytes = 500_000
} = {}) {
  if (!toolName || !siteDomain) throw new Error("Site-scoped adapter requires toolName and siteDomain");
  if (allowLiveSourceSearch !== true) throw new Error(`${toolName} adapter requires explicit allowLiveSourceSearch=true`);
  const resolvedApiKey = apiKey ?? process.env[apiKeyEnv];
  if (!resolvedApiKey) throw new Error(`${toolName} adapter requires API key in ${apiKeyEnv}`);
  if (typeof fetchImpl !== "function") throw new Error(`${toolName} adapter requires fetchImpl`);
  const discoveredUrls = new Set();
  return {
    name: `${sourceClass}_researchbrain_source_tool_adapter`,
    supportedSearchToolNames: new Set([toolName]),
    live_research: true,
    provider_native_search_enabled: false,
    async search({ toolName: tn, input }) {
      if (tn !== toolName) throw new Error(`${toolName} adapter supports ${toolName} only, got ${tn}`);
      const query = String(input.query ?? "").trim();
      if (query.length < 3) throw new Error(`${toolName} search requires a meaningful query`);
      const url = new URL(searchEndpoint);
      url.searchParams.set("q", `site:${siteDomain} ${query}`);
      url.searchParams.set("count", String(maxSearchResults));
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { "accept": "application/json", "x-subscription-token": resolvedApiKey }
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${toolName} search HTTP ${response.status}: ${text.slice(0, 500)}`);
      const parsed = JSON.parse(text);
      const results = asArray(parsed?.web?.results).slice(0, maxSearchResults).map((item, index) => {
        const resultUrl = String(item.url ?? "").trim();
        if (resultUrl) discoveredUrls.add(resultUrl);
        return {
          result_id: `${sourceClass}-${index + 1}`,
          url: resultUrl,
          title: String(item.title ?? resultUrl),
          snippet: String(item.description ?? ""),
          source_class: sourceClass,
          discovery_only: true
        };
      }).filter((item) => item.url.length > 0);
      return { provider: `${sourceClass}_brave_search`, provider_native_search_enabled: false, live_fetch: true, results };
    },
    async captureUrl({ input, discovery }) {
      if (allowLiveSourceCapture !== true) throw new Error(`${toolName} adapter capture requires explicit allowLiveSourceCapture=true`);
      const url = String(input.url ?? "").trim();
      if (!discoveredUrls.has(url) && discovery?.url !== url) throw new Error(`${toolName} capture requires prior discovery for URL: ${url}`);
      const response = await fetchImpl(url, { method: "GET", headers: { "accept": "text/html,text/plain,application/xhtml+xml" } });
      const text = await response.text();
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > maxCaptureBytes) throw new Error(`${toolName} capture exceeded maxCaptureBytes ${maxCaptureBytes}: ${bytes}`);
      if (!response.ok) throw new Error(`${toolName} capture HTTP ${response.status}: ${text.slice(0, 500)}`);
      return {
        provider: `${sourceClass}_brave_capture`,
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
  runId = null,
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
  const runtimeRunId = typeof runId === "string" && runId.trim().length > 0 ? runId.trim() : path.basename(runRepoDir);
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

  function memoryCheckInputFromHypothesis(input) {
    return {
      mechanism: input.mechanism,
      strategy_family: input.strategy_family,
      instrument_scope: input.instrument_scope,
      timeframe_candidate: input.timeframe_candidate,
      parameters: input.parameters
    };
  }

  function memorySearchInputFromHypothesis(input) {
    return {
      query: [input.mechanism, input.strategy_family, input.instrument_scope, input.timeframe_candidate].filter(Boolean).join(" "),
      limit: 5
    };
  }

  function autoCompleteMissingMemoryPrerequisites(input) {
    const completed = [];
    if (state.memoryChecks.search_research_memory !== true) {
      tools.search_research_memory(memorySearchInputFromHypothesis(input));
      completed.push("search_research_memory");
    }
    const checkInput = memoryCheckInputFromHypothesis(input);
    if (state.memoryChecks.check_duplicate_memory !== true) {
      tools.check_duplicate_memory(checkInput);
      completed.push("check_duplicate_memory");
    }
    if (state.memoryChecks.check_failed_pattern_similarity !== true) {
      tools.check_failed_pattern_similarity(checkInput);
      completed.push("check_failed_pattern_similarity");
    }
    return completed;
  }

  function defaultHypothesisPacketFields(input) {
    return {
      ...input,
      market_structure_assumption: input.market_structure_assumption ?? "Stage-0 external-source hypothesis assumes MT5/FTMO CFD market structure may expose a testable bar-level effect.",
      mt5_relevance_classification: input.mt5_relevance_classification ?? "mt5_relevant_unverified",
      required_data: input.required_data ?? "MT5 terminal OHLCV plus spread, swap, session, and contract specification evidence before any MT5-bound claim.",
      expected_holding_period: input.expected_holding_period ?? "Unknown until deterministic planning; Stage-0 records only a candidate holding-period range.",
      expected_trade_frequency: input.expected_trade_frequency ?? "Unknown before deterministic data checks and WFA; no outcome label assigned.",
      expected_failure_modes: asArray(input.expected_failure_modes).length ? input.expected_failure_modes : ["Source-backed mechanism may be anecdotal, regime-specific, or fail after realistic costs and OOS checks."],
      invalidation_criteria: asArray(input.invalidation_criteria).length ? input.invalidation_criteria : ["Later deterministic validation cannot reproduce source-grounded behavior with adequate OOS consistency and cost realism."],
      implementation_shape: input.implementation_shape ?? "Rule-based candidate shape for later deterministic planning only; no executable strategy is created by Stage-0.",
      execution_sensitivity: input.execution_sensitivity ?? "Sensitive to spreads, swaps, sessions, rollover, symbol specifications, and data gaps.",
      mt5_ftmo_concerns: input.mt5_ftmo_concerns ?? "Requires later MT5 symbol equivalence, terminal history, costs, and FTMO rule checks before any downstream route.",
      prior_related_lessons: asArray(input.prior_related_lessons).length ? input.prior_related_lessons : ["record_hypothesis auto-ran required memory checks before accepting this Stage-0 packet."],
      prior_failed_patterns_checked: asArray(input.prior_failed_patterns_checked).length ? input.prior_failed_patterns_checked : ["record_hypothesis auto-ran required memory checks; no blocking failed-pattern similarity was found."],
      novelty_reason: input.novelty_reason ?? "Accepted as a source-grounded Stage-0 hypothesis after duplicate and failed-pattern checks found no blocking parameter-only match.",
      disconfirming_evidence: asArray(input.disconfirming_evidence).length ? input.disconfirming_evidence : ["Stage-0 source capture may be incomplete and the hypothesis may fail later deterministic falsification."],
      proposed_experiment_shape: input.proposed_experiment_shape ?? "If selected later, build a deterministic falsification plan using MT5-equivalent data and existing factory gates."
    };
  }

  /**
   * Normalizes fixtureSearchResults return: accepts either a plain array (legacy success)
   * or a { results, adapter_error? } object (structured result). Always returns { results, adapter_error }.
   */
  function normalizeToolSearchResult(raw) {
    if (Array.isArray(raw)) return { results: raw, adapter_error: null };
    if (raw && typeof raw === "object" && Array.isArray(raw.results)) {
      return { results: raw.results, adapter_error: raw.adapter_error ?? null };
    }
    return { results: [], adapter_error: null };
  }

  async function fixtureSearchResults(toolName, input, fallbackFactory) {
    if (asArray(input.results).length) {
      if (liveMode) throw new Error(`${toolName} live mode rejects caller-supplied input.results`);
      return input.results;
    }
    if (liveMode) {
      const adapter = requireSourceToolAdapter(sourceToolAdapter, "search", toolName);
      try {
        const retried = await runWithRetryAttempts(() => adapter.search({ toolName, input, request, observedAt }), {
          phase: `researchbrain_source_search:${toolName}`,
          maxAttempts: sourceToolMaxAttempts,
          baseDelayMs: sourceToolRetryDelayMs,
          maxDelayMs: sourceToolMaxDelayMs
        });
        const results = normalizeSearchResults(toolName, retried.value);
        Object.defineProperty(results, "retry_attempts", { value: retried.attempts, enumerable: false });
        return results;
      } catch (err) {
        // Return structured error diagnostic instead of silently returning [].
        // Returns an object { results: [], adapter_error: {...} } so JSON serialization
        // preserves the diagnostic in the tool ledger.
        const attempts = err.rf_retry_attempts ?? [];
        const classification = err.rf_retry_classification ?? null;
        return {
          results: [],
          adapter_error: {
            tool_name: toolName,
            error_message: attempts.length > 0 ? attempts[attempts.length - 1].error_message : String(err).slice(0, 500),
            failure_class: classification?.failure_class ?? "adapter_search_failure",
            retryable: classification?.retryable ?? false,
            retry_attempts: attempts.length,
            diagnostic_only: true,
            blocked: true
          }
        };
      }
    }
    return [fallbackFactory()];
  }

  function searchProvider(toolName, fallbackProvider) {
    if (!liveMode) return fallbackProvider;
    return sourceToolAdapter?.name ?? "deterministic_source_tool_adapter";
  }

  const tools = {
    async search_web(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_web", input, () => defaultSearchResult("search_web", input)));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_web", "fixture_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_official_docs(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_official_docs", input, () => defaultSearchResult("search_official_docs", { ...input, source_class: "official_docs" })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_official_docs", "fixture_official_docs_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_mql5_sources(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_mql5_sources", input, () => defaultSearchResult("search_mql5_sources", { ...input, source_class: "mql5" })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_mql5_sources", "fixture_mql5_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_broker_docs(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_broker_docs", input, () => defaultSearchResult("search_broker_docs", { ...input, source_class: "broker" })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_broker_docs", "fixture_broker_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_youtube(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_youtube", input, () => ({
        result_id: "youtube-result-001",
        video_id: input.video_id ?? "YOUTUBE_FIXTURE_001",
        url: input.url ?? "https://www.youtube.com/watch?v=YOUTUBE_FIXTURE_001",
        title: input.title ?? "Deterministic YouTube discovery fixture",
        channel_title: input.channel_title ?? "Fixture Channel",
        description: input.description ?? "Discovery metadata only; not hypothesis support.",
        discovery_only: true
      })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_youtube", "fixture_youtube_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_arxiv(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_arxiv", input, () => defaultSearchResult("search_arxiv", { ...input, source_class: "academic" })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_arxiv", "fixture_arxiv_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_reddit(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_reddit", input, () => defaultSearchResult("search_reddit", { ...input, source_class: "social" })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_reddit", "fixture_reddit_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_semantic_scholar(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_semantic_scholar", input, () => defaultSearchResult("search_semantic_scholar", { ...input, source_class: "academic" })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_semantic_scholar", "fixture_semantic_scholar_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
    },
    async search_github_code(input = {}) {
      const { results, adapter_error } = normalizeToolSearchResult(await fixtureSearchResults("search_github_code", input, () => ({
        result_id: "github-code-result-001",
        repo_url: input.repo_url ?? "https://github.com/example/researchbrain-fixture",
        path: input.path ?? "strategy.py",
        commit_sha: input.commit_sha ?? "0".repeat(40),
        license: input.license ?? "unknown",
        snippet: input.snippet ?? "Fixture code discovery only; never executed.",
        discovery_only: true
      })));
      rememberDiscovery(results);
      return { query: input.query ?? null, provider: searchProvider("search_github_code", "fixture_github_code_search"), discovery_only: true, provider_native_search_enabled: false, retry_attempts: results.retry_attempts ?? [], results, ...(adapter_error ? { adapter_error } : {}) };
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
      // Auto-write to wiki (try/catch — wiki failure must never break structured artifact)
      try {
        writeSourcePage({ runId: runtimeRunId, sourceCapture: { url: input.url, title: input.title, content: content.slice(0, 500), tags: [input.source_class ?? "web"] } });
      } catch (err) {
        // Wiki write failed — log but continue
      }
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
      if (liveMode && typeof input.content === "string" && input.content.trim().length > 0) {
        throw new Error("capture_github_artifact live mode rejects LLM-supplied input.content; deterministic capture adapter required");
      }
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
      if (!videoId) throw new Error("inspect_youtube_video requires video_id or url");
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
      const autoMemoryPrerequisites = autoCompleteMissingMemoryPrerequisites(input);
      const hypothesis = defaultHypothesisPacketFields(input);
      validateHypothesisInput(hypothesis);
      state.hypotheses.push(hypothesis);
      // Auto-write to wiki (try/catch — wiki failure must never break structured artifact)
      try {
        writeHypothesisPage({ runId: runtimeRunId, hypothesis });
      } catch (err) {
        // Wiki write failed — log but continue
      }
      return {
        status: "recorded",
        hypothesis_id: hypothesis.hypothesis_id,
        auto_memory_prerequisites: { completed: autoMemoryPrerequisites },
        memory_checks: { required_tool_calls: { ...state.memoryChecks } }
      };
    },
    write_wiki_page(input = {}) {
      if (typeof input.path !== "string") throw new Error("write_wiki_page requires path");
      if (typeof input.type !== "string") throw new Error("write_wiki_page requires type");
      if (typeof input.content !== "string") throw new Error("write_wiki_page requires content");
      const result = writeWikiPage({
        path: input.path,
        type: input.type,
        content: input.content,
        tags: input.tags || [],
        summary: input.summary || "",
        runId: runtimeRunId
      });
      return { status: "written", path: result.path };
    },
    search_wiki(input = {}) {
      const result = searchWiki({
        query: input.query || "",
        type: input.type,
        limit: input.limit || 10,
        includeBodies: input.include_bodies === true
      });
      return result;
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

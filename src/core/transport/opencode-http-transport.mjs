import { parseModelString } from "../config.mjs";
import { OpenCodeServerManager } from "./opencode-server-manager.mjs";

function createTransportError(message, cause, metadata = {}) {
  const error = cause instanceof Error ? new Error(message, { cause }) : new Error(message);
  error.rf_failure_class = "transport_failure";
  error.rf_transport_phase = metadata.phase ?? null;
  error.rf_retryable = metadata.retryable ?? true;
  error.rf_timeout_bucket = metadata.timeoutBucket ?? null;
  error.rf_transport_adapter = "opencode_http";
  error.rf_server_fingerprint = metadata.serverFingerprint ?? null;
  return error;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pathPhase(urlPath) {
  if (urlPath === "/session") return "session_create";
  if (urlPath.includes("/message")) return "request";
  return "probe";
}

function timeoutBucket(urlPath) {
  if (urlPath === "/session") return "session_create";
  if (urlPath.includes("/message")) return "total_request";
  return "probe";
}

function createHttpClient({ baseUrl, rootDir, fetchImpl, transportTimeouts, getServerFingerprint, recordRequestMetrics }) {
  async function requestJson(urlPath, { method = "GET", body = null, timeoutMs = 0 } = {}) {
    const url = new URL(urlPath, `${baseUrl}/`);
    url.searchParams.set("directory", rootDir);
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      recordRequestMetrics?.({
        started_at: new Date(startedAt).toISOString(),
        first_headers_ms: Date.now() - startedAt,
        method,
        url: String(url)
      });
      const text = await response.text();
      const json = safeJsonParse(text);
      if (!response.ok) {
        throw createTransportError(
          `HTTP transport request to ${url.pathname} failed with status ${response.status}.`,
          null,
          {
            phase: pathPhase(url.pathname),
            retryable: response.status >= 500,
            timeoutBucket: timeoutBucket(url.pathname),
            serverFingerprint: getServerFingerprint()
          }
        );
      }
      return { data: json };
    } catch (error) {
      if (error?.rf_failure_class === "transport_failure") {
        throw error;
      }
      if (error?.name === "AbortError") {
        throw createTransportError(
          `HTTP transport request to ${url.pathname} timed out after ${timeoutMs}ms.`,
          error,
          {
            phase: pathPhase(url.pathname),
            retryable: true,
            timeoutBucket: timeoutBucket(url.pathname),
            serverFingerprint: getServerFingerprint()
          }
        );
      }
      throw createTransportError(
        `HTTP transport request to ${url.pathname} failed before a valid response was received.`,
        error,
        {
          phase: pathPhase(url.pathname),
          retryable: true,
          timeoutBucket: timeoutBucket(url.pathname),
          serverFingerprint: getServerFingerprint()
        }
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    session: {
      list: async () => requestJson("/session", { timeoutMs: transportTimeouts.probeMs }),
      create: async ({ body } = {}) => requestJson("/session", { method: "POST", body, timeoutMs: transportTimeouts.sessionCreateMs }),
      prompt: async ({ path, body } = {}) => requestJson(`/session/${encodeURIComponent(path.id)}/message`, { method: "POST", body, timeoutMs: transportTimeouts.totalRequestMs })
    },
    project: {
      current: async () => requestJson("/project/current", { timeoutMs: transportTimeouts.probeMs })
    }
  };
}

export class OpenCodeHttpTransport {
  constructor({ rootDir, model, openBrowser = false, livePluginPolicy = { allowedPlugins: [] }, transportTimeouts = {}, fetchImpl = fetch, serverManager = null }) {
    this.rootDir = rootDir;
    this.model = parseModelString(model);
    this.transportTimeouts = {
      bootMs: Number(transportTimeouts.bootMs ?? 20000),
      probeMs: Number(transportTimeouts.probeMs ?? 10000),
      sessionCreateMs: Number(transportTimeouts.sessionCreateMs ?? 15000),
      totalRequestMs: Number(transportTimeouts.totalRequestMs ?? 0),
      shutdownMs: Number(transportTimeouts.shutdownMs ?? 5000)
    };
    this.fetchImpl = fetchImpl;
    this.lastRequestMetrics = null;
    this.serverManager = serverManager || new OpenCodeServerManager({
      rootDir,
      providerID: this.model.providerID,
      mode: "live",
      openBrowser,
      livePluginPolicy,
      fingerprintContext: { model, transport: "http", transportTimeouts: this.transportTimeouts },
      options: {
        newServerStartTimeoutMs: this.transportTimeouts.bootMs,
        serverProbeTimeoutMs: this.transportTimeouts.probeMs,
        sessionCreateTimeoutMs: this.transportTimeouts.sessionCreateMs,
        shutdownTimeoutMs: this.transportTimeouts.shutdownMs
      },
      createClient: ({ baseUrl }) => createHttpClient({
        baseUrl,
        rootDir,
        fetchImpl: this.fetchImpl,
        transportTimeouts: this.transportTimeouts,
        getServerFingerprint: () => this.serverManager?.getStatus?.()?.serverFingerprint ?? null,
        recordRequestMetrics: (metrics) => {
          this.lastRequestMetrics = metrics;
        }
      })
    });
  }

  async init() {
    return this.serverManager.init();
  }

  async createSession({ agent, attempt } = {}) {
    return this.serverManager.createSession({ agent, attempt });
  }

  getStatus() {
    return {
      ...this.serverManager.getStatus(),
      transport_adapter: "opencode_http"
    };
  }

  getLastRequestMetrics() {
    return this.lastRequestMetrics;
  }

  async callAgent(agent, promptText, options = {}) {
    try {
      const { sessionId, sessionUrl } = await this.createSession({ agent, attempt: options.attempt });
      if (typeof options.onSessionCreated === "function") {
        await options.onSessionCreated({ sessionId, sessionUrl });
      }
      const client = this.serverManager.getClient();
      const result = await client.session.prompt({
        path: { id: sessionId },
        query: { directory: this.rootDir },
        body: {
          model: { providerID: this.model.providerID, modelID: this.model.modelID },
          agent,
          parts: [{ type: "text", text: promptText }]
        }
      });
      const text = (result.data?.parts || [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      return {
        text,
        raw: result.data,
        sessionId,
        sessionUrl
      };
    } catch (error) {
      if (error?.rf_failure_class === "transport_failure") {
        if (!error.rf_server_fingerprint) {
          error.rf_server_fingerprint = this.serverManager.getStatus()?.serverFingerprint ?? null;
        }
        throw error;
      }
      throw createTransportError(
        `${agent} HTTP transport request failed before response was received.`,
        error,
        {
          phase: "request",
          retryable: true,
          timeoutBucket: "total_request",
          serverFingerprint: this.serverManager.getStatus()?.serverFingerprint ?? null
        }
      );
    }
  }

  async close() {
    await this.serverManager.close();
  }
}

import { createOpencodeClient } from "@opencode-ai/sdk";
import { parseModelString } from "../config.mjs";
import { OpenCodeServerManager } from "./opencode-server-manager.mjs";

const AGENT_REQUEST_TIMEOUT = false;

function createTransportError(message, cause, metadata = {}) {
  const error = cause instanceof Error ? new Error(message, { cause }) : new Error(message);
  error.rf_failure_class = "transport_failure";
  error.rf_transport_phase = metadata.phase ?? null;
  error.rf_retryable = metadata.retryable ?? true;
  error.rf_timeout_bucket = metadata.timeoutBucket ?? null;
  error.rf_transport_adapter = "opencode_sdk";
  error.rf_server_fingerprint = metadata.serverFingerprint ?? null;
  return error;
}

function normalizeAgentRequestError(agent, error) {
  if (error?.rf_failure_class === "transport_failure") {
    return error;
  }

  if (!(error instanceof Error)) {
    return createTransportError(`${agent} transport request failed before response: ${String(error)}`, null, {
      phase: "request",
      retryable: true
    });
  }

  const causeMessage = error.cause instanceof Error ? error.cause.message : "";
  if (error.message === "fetch failed") {
    if (/headers timeout/i.test(causeMessage)) {
      return createTransportError(`${agent} transport request timed out waiting for response headers.`, error, {
        phase: "first_headers",
        retryable: true,
        timeoutBucket: "first_headers"
      });
    }
    return createTransportError(`${agent} transport request failed before response was received.`, error, {
      phase: "request",
      retryable: true
    });
  }

  return error;
}

export class OpenCodeSdkTransport {
  constructor({ rootDir, model, agentTimeoutMs = 0, openBrowser = false, livePluginPolicy = { allowedPlugins: [] }, transportTimeouts = {}, serverManager = null }) {
    this.rootDir = rootDir;
    this.model = parseModelString(model);
    this.agentTimeoutMs = agentTimeoutMs;
    this.transportTimeouts = {
      bootMs: Number(transportTimeouts.bootMs ?? 20000),
      probeMs: Number(transportTimeouts.probeMs ?? 10000),
      sessionCreateMs: Number(transportTimeouts.sessionCreateMs ?? 15000),
      firstHeadersMs: Number(transportTimeouts.firstHeadersMs ?? 0),
      totalRequestMs: Number(transportTimeouts.totalRequestMs ?? agentTimeoutMs ?? 0),
      shutdownMs: Number(transportTimeouts.shutdownMs ?? 5000)
    };
    this.lastRequestMetrics = null;
    this.serverManager = serverManager || new OpenCodeServerManager({
      rootDir,
      providerID: this.model.providerID,
      mode: "live",
      openBrowser,
      livePluginPolicy,
      fingerprintContext: { model, transportTimeouts: this.transportTimeouts },
      options: {
        newServerStartTimeoutMs: this.transportTimeouts.bootMs,
        serverProbeTimeoutMs: this.transportTimeouts.probeMs,
        sessionCreateTimeoutMs: this.transportTimeouts.sessionCreateMs,
        shutdownTimeoutMs: this.transportTimeouts.shutdownMs
      },
      createClient: ({ baseUrl }) => createOpencodeClient({
        baseUrl,
        fetch: async (req) => {
          const startedAt = Date.now();
          // @ts-ignore timeout is used by the SDK transport stack.
          req.timeout = false;
          const response = await fetch(req);
          this.lastRequestMetrics = {
            started_at: new Date(startedAt).toISOString(),
            first_headers_ms: Date.now() - startedAt,
            method: req.method || "GET",
            url: req.url
          };
          return response;
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
      transport_adapter: "opencode_sdk"
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
      const request = client.session.prompt({
        path: { id: sessionId },
        query: { directory: this.rootDir },
        timeout: AGENT_REQUEST_TIMEOUT,
        maxRetries: 0,
        body: {
          model: { providerID: this.model.providerID, modelID: this.model.modelID },
          agent,
          parts: [{ type: "text", text: promptText }]
        }
      });

      const result = this.transportTimeouts.totalRequestMs > 0
        ? await Promise.race([
            request,
            new Promise((_, reject) => {
              setTimeout(() => reject(createTransportError(
                `${agent} transport total-request timeout after ${this.transportTimeouts.totalRequestMs}ms.`,
                null,
                {
                  phase: "request",
                  retryable: true,
                  timeoutBucket: "total_request",
                  serverFingerprint: this.serverManager.getStatus()?.serverFingerprint
                }
              )), this.transportTimeouts.totalRequestMs);
            })
          ])
        : await request;

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
      const normalized = normalizeAgentRequestError(agent, error);
      if (normalized?.rf_failure_class === "transport_failure" && !normalized.rf_server_fingerprint) {
        normalized.rf_server_fingerprint = this.serverManager.getStatus()?.serverFingerprint ?? null;
      }
      throw normalized;
    }
  }

  async close() {
    await this.serverManager.close();
  }
}

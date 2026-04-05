import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { buildPaths } from "../paths.mjs";
import { ensureDir, readJson, writeJsonAtomic } from "../fs-utils.mjs";

export const OPENCODE_BASE_URL = "http://127.0.0.1:4096";
export const DEFAULT_SERVER_MANAGER_OPTIONS = {
  existingServerRetries: 5,
  existingServerRetryDelayMs: 2000,
  newServerStartTimeoutMs: 20000,
  serverProbeTimeoutMs: 10000,
  sessionCreateTimeoutMs: 15000,
  shutdownTimeoutMs: 5000
};

const LIVE_PLUGIN_ALLOWLIST = new Set([]);

function absolutizeFileRef(value, rootDir) {
  if (typeof value !== "string") return value;
  const match = value.match(/^\{file:(.+)\}$/);
  if (!match) return value;
  const target = match[1].trim();
  if (!target) return value;
  if (path.isAbsolute(target)) return value;
  return `{file:${path.join(rootDir, target)}}`;
}

function absolutizeConfigValue(value, rootDir) {
  if (Array.isArray(value)) {
    return value.map((entry) => absolutizeConfigValue(entry, rootDir));
  }
  if (!value || typeof value !== "object") {
    return absolutizeFileRef(value, rootDir);
  }

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "instructions" && Array.isArray(entry)) {
      out[key] = entry.map((item) => {
        if (typeof item !== "string") return item;
        if (path.isAbsolute(item)) return item;
        return path.join(rootDir, item);
      });
      continue;
    }
    out[key] = absolutizeConfigValue(entry, rootDir);
  }
  return out;
}

export function buildOpencodeServerConfig(rootDir, providerID, { mode = "live", allowedPlugins = [] } = {}) {
  const configPath = path.join(rootDir, "opencode.json");
  const loaded = readJson(configPath, {});
  const config = loaded && typeof loaded === "object" && !Array.isArray(loaded)
    ? absolutizeConfigValue(structuredClone(loaded), rootDir)
    : {};

  if (mode === "live") {
    const invalidAllowlist = allowedPlugins.filter((plugin) => !LIVE_PLUGIN_ALLOWLIST.has(plugin));
    if (invalidAllowlist.length > 0) {
      throw new Error(`Unsupported live plugin allowlist entries: ${invalidAllowlist.join(", ")}`);
    }
    config.plugin = [];
  } else if (Array.isArray(config.plugin)) {
    config.plugin = config.plugin.filter((plugin) => plugin !== "opencode-agent-memory@0.2.0");
  }

  config.provider ||= {};
  config.provider[providerID] ||= {};
  config.provider[providerID].options ||= {};
  config.provider[providerID].options.timeout = false;
  return config;
}

function hashFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createTransportError(message, cause, metadata = {}) {
  const error = cause instanceof Error ? new Error(message, { cause }) : new Error(message);
  error.rf_failure_class = "transport_failure";
  error.rf_transport_phase = metadata.phase ?? null;
  error.rf_retryable = metadata.retryable ?? true;
  error.rf_timeout_bucket = metadata.timeoutBucket ?? null;
  error.rf_transport_adapter = metadata.adapter ?? "opencode_server_manager";
  error.rf_server_fingerprint = metadata.serverFingerprint ?? null;
  return error;
}

function projectSlug(rootDir) {
  return path.basename(rootDir)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

export function buildSessionUrl(baseUrl, projectId, sessionId) {
  if (!baseUrl || !projectId || !sessionId) return null;
  return new URL(`${encodeURIComponent(projectId)}/session/${encodeURIComponent(sessionId)}`, `${baseUrl}/`).toString();
}

export function openBrowserUrl(url) {
  const candidates = [
    { command: "cmd.exe", args: ["/c", "start", "", url] },
    { command: "xdg-open", args: [url] },
    { command: "open", args: [url] }
  ];

  let lastError = null;
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, { stdio: "ignore", windowsHide: true });
    if (!result.error && result.status === 0) {
      return { ok: true, command: candidate.command };
    }
    lastError = result.error || new Error(`${candidate.command} exited with status ${result.status}`);
  }

  return { ok: false, error: lastError };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildServerOutputError(code, output) {
  let message = `Server exited with code ${code}`;
  if (output.trim()) {
    message += `\nServer output: ${output}`;
  }
  return new Error(message);
}

function signalManagedProcess(proc, signal) {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform !== "win32" && Number.isInteger(proc.pid) && proc.pid > 0) {
      process.kill(-proc.pid, signal);
      return;
    }
  } catch {
    // Fall through to direct child signaling.
  }
  proc.kill(signal);
}

async function terminateManagedProcess(proc, closePromise, timeoutMs) {
  if (!proc || proc.exitCode !== null) {
    await closePromise.catch(() => {});
    return;
  }

  signalManagedProcess(proc, "SIGTERM");
  const closed = await Promise.race([
    closePromise.then(() => true).catch(() => true),
    sleep(timeoutMs).then(() => false)
  ]);

  if (!closed && proc.exitCode === null) {
    signalManagedProcess(proc, "SIGKILL");
    await closePromise.catch(() => {});
  }
}

export async function createManagedOpencodeServer(options = {}) {
  const normalized = {
    hostname: "127.0.0.1",
    port: 4096,
    timeout: 5000,
    shutdownTimeoutMs: 5000,
    ...options
  };
  const args = [
    "serve",
    `--hostname=${normalized.hostname}`,
    `--port=${normalized.port}`
  ];
  if (normalized.config?.logLevel) {
    args.push(`--log-level=${normalized.config.logLevel}`);
  }

  const proc = spawn("opencode", args, {
    signal: normalized.signal,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(normalized.config ?? {})
    }
  });

  let output = "";
  const closePromise = once(proc, "close").then(([code]) => code);
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      await terminateManagedProcess(proc, closePromise, normalized.shutdownTimeoutMs);
      reject(new Error(`Timeout waiting for server to start after ${normalized.timeout}ms`));
    }, normalized.timeout);

    const finish = (error, nextUrl = null) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(nextUrl);
    };

    proc.stdout?.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (!line.startsWith("opencode server listening")) continue;
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
        if (!match) {
          finish(new Error(`Failed to parse server url from output: ${line}`));
          return;
        }
        finish(null, match[1]);
        return;
      }
    });

    proc.on("close", (code) => {
      finish(buildServerOutputError(code, output));
    });
    proc.on("error", (error) => {
      finish(error);
    });
    if (normalized.signal) {
      normalized.signal.addEventListener("abort", () => {
        finish(new Error("Aborted"));
      }, { once: true });
    }
  });

  return {
    url,
    pid: proc.pid ?? null,
    async close() {
      await terminateManagedProcess(proc, closePromise, normalized.shutdownTimeoutMs);
    }
  };
}

export class OpenCodeServerManager {
  constructor({
    rootDir,
    providerID,
    mode = "live",
    openBrowser = false,
    baseUrl = OPENCODE_BASE_URL,
    createClient,
    createServer,
    livePluginPolicy = { allowedPlugins: [] },
    fingerprintContext = {},
    options = {},
    browserOpener = openBrowserUrl,
    logger = console
  }) {
    this.rootDir = rootDir;
    this.paths = buildPaths(rootDir);
    this.providerID = providerID;
    this.mode = mode;
    this.openBrowser = openBrowser;
    this.baseUrl = baseUrl;
    this.createClient = createClient;
    this.createServer = createServer || createManagedOpencodeServer;
    this.livePluginPolicy = livePluginPolicy;
    this.fingerprintContext = fingerprintContext;
    this.options = { ...DEFAULT_SERVER_MANAGER_OPTIONS, ...options };
    this.browserOpener = browserOpener;
    this.logger = logger;
    this.client = null;
    this.server = null;
    this.lastSessionId = null;
    this.lastSessionUrl = null;
    this.lastOpenedSessionUrl = null;
    this.connectedViaReuse = false;
    this.metadataPath = path.join(this.paths.toolingSandbox, "runtime", "opencode-server.json");
    this.effectiveConfig = null;
    this.serverFingerprint = null;
  }

  log(message) {
    if (typeof this.logger?.log === "function") {
      this.logger.log(message);
    }
  }

  getEffectiveConfig() {
    if (!this.effectiveConfig) {
      this.effectiveConfig = buildOpencodeServerConfig(this.rootDir, this.providerID, {
        mode: this.mode,
        allowedPlugins: this.livePluginPolicy.allowedPlugins
      });
    }
    return this.effectiveConfig;
  }

  buildFingerprintPayload() {
    return {
      root_dir: this.rootDir,
      provider_id: this.providerID,
      mode: this.mode,
      live_plugin_policy: this.livePluginPolicy,
      fingerprint_context: this.fingerprintContext,
      effective_config: this.getEffectiveConfig()
    };
  }

  getServerFingerprint() {
    if (!this.serverFingerprint) {
      this.serverFingerprint = hashFingerprint(this.buildFingerprintPayload());
    }
    return this.serverFingerprint;
  }

  readReuseMetadata() {
    const metadata = readJson(this.metadataPath, null);
    if (!metadata || typeof metadata !== "object") return null;
    const trackedPid = metadata.server_pid ?? metadata.owner_pid ?? metadata.launcher_pid ?? null;
    if (!isProcessAlive(trackedPid)) {
      this.clearReuseMetadata();
      return null;
    }
    return metadata;
  }

  hasCompatibleReuseMetadata(metadata) {
    if (!metadata) return false;
    return metadata.base_url === this.baseUrl
      && metadata.root_dir === this.rootDir
      && metadata.provider_id === this.providerID
      && metadata.mode === this.mode
      && metadata.fingerprint === this.getServerFingerprint();
  }

  writeReuseMetadata() {
    const ownerPid = this.server?.pid ?? this.server?.processPid ?? process.pid;
    const metadata = {
      schema_version: "opencode_server_metadata_v1",
      written_at: new Date().toISOString(),
      owner_pid: ownerPid,
      launcher_pid: process.pid,
      root_dir: this.rootDir,
      provider_id: this.providerID,
      mode: this.mode,
      base_url: this.baseUrl,
      fingerprint: this.getServerFingerprint()
    };
    ensureDir(path.dirname(this.metadataPath), this.paths);
    writeJsonAtomic(this.metadataPath, metadata, this.paths);
    return metadata;
  }

  clearReuseMetadata() {
    if (fs.existsSync(this.metadataPath)) {
      fs.unlinkSync(this.metadataPath);
    }
  }

  async connectToExistingServer({ retries = this.options.existingServerRetries, delayMs = this.options.existingServerRetryDelayMs } = {}) {
    let lastError = null;
    const metadata = this.readReuseMetadata();

    if (!this.hasCompatibleReuseMetadata(metadata)) {
      if (metadata) {
        this.log("[OpenCodeServerManager] Existing server metadata is incompatible with the current live policy; refusing reuse.");
      } else {
        this.log("[OpenCodeServerManager] No compatible live server metadata found; probe success alone is insufficient for reuse.");
      }
      return false;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const testClient = this.createClient({ baseUrl: this.baseUrl });
        await testClient.session.list({
          query: { directory: this.rootDir },
          timeout: this.options.serverProbeTimeoutMs,
          maxRetries: 0
        });
        this.client = testClient;
        this.connectedViaReuse = true;
        this.serverFingerprint = metadata.fingerprint;
        this.log(`[OpenCodeServerManager] Connected to existing server on port 4096 (attempt ${attempt}/${retries})`);
        return true;
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await sleep(delayMs);
        }
      }
    }

    if (lastError) {
      this.log(`[OpenCodeServerManager] Existing server connection failed after ${retries} attempts: ${lastError.message}`);
    }
    return false;
  }

  async init() {
    if (this.client) {
      return this.getStatus();
    }

    const connected = await this.connectToExistingServer();
    if (!connected) {
      this.log("[OpenCodeServerManager] Starting new OpenCode server...");
      try {
        const config = this.getEffectiveConfig();
        const created = await this.createServer({
          timeout: this.options.newServerStartTimeoutMs,
          shutdownTimeoutMs: this.options.shutdownTimeoutMs,
          config
        });
        const server = created?.server ?? created;
        const client = created?.client ?? this.createClient({ baseUrl: server?.url || this.baseUrl });
        this.client = client;
        this.server = server;
        this.baseUrl = server?.url || this.baseUrl;
        this.connectedViaReuse = false;
        this.writeReuseMetadata();
        this.log("[OpenCodeServerManager] New server started");
      } catch (error) {
        const wrappedError = createTransportError(
          "OpenCode server boot failed before a compatible managed server was available.",
          error,
          {
            phase: "boot",
            retryable: true,
            timeoutBucket: "boot",
            adapter: "opencode_server_manager",
            serverFingerprint: this.getServerFingerprint()
          }
        );
        this.log(`[OpenCodeServerManager] Starting new server failed: ${error.message}`);
        const recovered = await this.connectToExistingServer({ retries: 3, delayMs: 3000 });
        if (!recovered) {
          throw wrappedError;
        }
      }
    }

    return this.getStatus();
  }

  getClient() {
    if (!this.client) {
      throw new Error("OpenCode server manager not initialized.");
    }
    return this.client;
  }

  async createSession({ agent, attempt } = {}) {
    const client = this.getClient();
    const titleParts = ["Research Factory"];
    if (agent) titleParts.push(agent);
    if (Number.isFinite(attempt)) titleParts.push(`attempt ${attempt}`);

    let session;
    try {
      session = await Promise.race([
        client.session.create({
          body: { title: `${titleParts.join(" ")} ${new Date().toISOString()}` },
          query: { directory: this.rootDir }
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(createTransportError(
            `OpenCode ${agent || "session"} session creation timed out after ${this.options.sessionCreateTimeoutMs}ms.`,
            null,
            {
              phase: "session_create",
              retryable: true,
              timeoutBucket: "session_create",
              serverFingerprint: this.getServerFingerprint()
            }
          )), this.options.sessionCreateTimeoutMs);
        })
      ]);
    } catch (error) {
      if (error?.rf_failure_class === "transport_failure") {
        throw error;
      }
      throw createTransportError(
        `OpenCode ${agent || "session"} session creation failed before a session was returned.`,
        error,
        {
          phase: "session_create",
          retryable: true,
          timeoutBucket: "session_create",
          serverFingerprint: this.getServerFingerprint()
        }
      );
    }

    this.lastSessionId = session.data.id;
    const currentProject = !session.data.projectID && client.project
      ? await client.project.current({ query: { directory: this.rootDir } })
      : null;
    const projectId = session.data.projectID || currentProject?.data?.id || projectSlug(this.rootDir);
    this.lastSessionUrl = buildSessionUrl(this.baseUrl, projectId, this.lastSessionId);

    if (this.lastSessionUrl) {
      const label = agent && Number.isFinite(attempt)
        ? `${agent} attempt ${attempt}`
        : agent || "session";
      this.log(`[OpenCodeServerManager] Session URL (${label}): ${this.lastSessionUrl}`);
    }

    return {
      sessionId: this.lastSessionId,
      sessionUrl: this.lastSessionUrl,
      projectId
    };
  }

  getStatus() {
    return {
      baseUrl: this.baseUrl,
      initialized: Boolean(this.client),
      ownsServer: Boolean(this.server),
      reusedExisting: this.connectedViaReuse,
      serverFingerprint: this.getServerFingerprint(),
      metadataPath: this.metadataPath,
      lastSessionId: this.lastSessionId,
      lastSessionUrl: this.lastSessionUrl
    };
  }

  async close() {
    if (this.server) {
      try {
        if (typeof this.server.close !== "function") {
          throw new Error("OpenCode server handle does not expose a close() function.");
        }
        if (this.server.pid) {
          await this.server.close();
        } else {
          await Promise.race([
            this.server.close(),
            new Promise((_, reject) => {
              setTimeout(() => reject(createTransportError(
                `OpenCode server shutdown timed out after ${this.options.shutdownTimeoutMs}ms.`,
                null,
                {
                  phase: "shutdown",
                  retryable: false,
                  timeoutBucket: "shutdown",
                  serverFingerprint: this.getServerFingerprint()
                }
              )), this.options.shutdownTimeoutMs);
            })
          ]);
        }
      } catch (error) {
        if (error?.rf_failure_class === "transport_failure") {
          throw error;
        }
        throw createTransportError(
          "OpenCode server shutdown failed.",
          error,
          {
            phase: "shutdown",
            retryable: false,
            timeoutBucket: "shutdown",
            serverFingerprint: this.getServerFingerprint()
          }
        );
      } finally {
        this.clearReuseMetadata();
      }
    }
  }
}

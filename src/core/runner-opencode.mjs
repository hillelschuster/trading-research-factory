import { OpenCodeSdkTransport } from "./transport/opencode-sdk-transport.mjs";
import { buildOpencodeServerConfig, buildSessionUrl, openBrowserUrl, OpenCodeServerManager } from "./transport/opencode-server-manager.mjs";

export function buildServerConfigForTests(rootDir, providerID) {
  return buildOpencodeServerConfig(rootDir, providerID, { mode: "live", allowedPlugins: [] });
}

export { buildSessionUrl, openBrowserUrl, OpenCodeServerManager };

export class OpenCodeRunner {
  constructor(config) {
    this.transport = new OpenCodeSdkTransport(config);
  }

  get client() {
    return this.transport.serverManager.client;
  }

  set client(value) {
    this.transport.serverManager.client = value;
  }

  get server() {
    return this.transport.serverManager.server;
  }

  set server(value) {
    this.transport.serverManager.server = value;
  }

  get baseUrl() {
    return this.transport.serverManager.baseUrl;
  }

  set baseUrl(value) {
    this.transport.serverManager.baseUrl = value;
  }

  get rootDir() {
    return this.transport.rootDir;
  }

  get model() {
    return this.transport.model;
  }

  get agentTimeoutMs() {
    return this.transport.agentTimeoutMs;
  }

  async init() {
    return this.transport.init();
  }

  async createSession(options = {}) {
    return this.transport.createSession(options);
  }

  getSessionUrl() {
    return this.transport.getStatus()?.lastSessionUrl ?? null;
  }

  getStatus() {
    return this.transport.getStatus();
  }

  async callAgent(agent, promptText, options = {}) {
    return this.transport.callAgent(agent, promptText, options);
  }

  async close() {
    return this.transport.close();
  }
}

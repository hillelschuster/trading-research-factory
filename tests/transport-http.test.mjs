import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { OpenCodeHttpTransport } from "../src/core/transport/opencode-http-transport.mjs";
import { OpenCodeSdkTransport } from "../src/core/transport/opencode-sdk-transport.mjs";
import { createLiveTransport } from "../src/core/transport/live-transport.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createTempRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "transport-http-"));
  return rootDir;
}

function seedCompatibleMetadata(transport) {
  fs.mkdirSync(path.dirname(transport.serverManager.metadataPath), { recursive: true });
  fs.writeFileSync(transport.serverManager.metadataPath, JSON.stringify({
    owner_pid: process.pid,
    root_dir: transport.rootDir,
    provider_id: transport.model.providerID,
    mode: "live",
    base_url: "http://127.0.0.1:4096",
    fingerprint: transport.serverManager.getServerFingerprint()
  }, null, 2) + "\n", "utf8");
}

test("createLiveTransport can select the HTTP adapter", () => {
  const transport = createLiveTransport({
    adapter: "http",
    rootDir: "/tmp/project",
    model: "opencode/minimax-m2.5-free",
    fetchImpl: async () => jsonResponse([])
  });

  assert.equal(transport.constructor.name, "OpenCodeHttpTransport");
});

test("OpenCodeHttpTransport can create a session and submit a prompt against documented endpoints", async () => {
  const requests = [];
  const rootDir = createTempRoot();
  const transport = new OpenCodeHttpTransport({
    rootDir,
    model: "opencode/minimax-m2.5-free",
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
      const pathname = new URL(url).pathname;
      if (pathname === "/session") {
        if ((init.method || "GET") === "GET") return jsonResponse([]);
        return jsonResponse({ id: "ses-http-1", projectID: "global", directory: "/tmp/project", title: "x", version: "1", time: { created: 1, updated: 1 } });
      }
      if (pathname === "/session/ses-http-1/message") {
        return jsonResponse({ info: { id: "msg-1" }, parts: [{ type: "text", text: "hello from http" }] });
      }
      throw new Error(`Unexpected path ${pathname}`);
    }
  });

  seedCompatibleMetadata(transport);
  await transport.init();
  const result = await transport.callAgent("executor", "test prompt", { attempt: 1 });

  assert.equal(result.sessionId, "ses-http-1");
  assert.equal(result.text, "hello from http");
  assert.equal(requests.some((entry) => entry.url.includes("/session?") && entry.method === "GET"), true);
  assert.equal(requests.some((entry) => entry.url.includes("/session?") && entry.method === "POST"), true);
  assert.equal(requests.some((entry) => entry.url.includes("/session/ses-http-1/message?") && entry.method === "POST"), true);
});

test("OpenCodeHttpTransport tags request failures with transport metadata", async () => {
  const rootDir = createTempRoot();
  const transport = new OpenCodeHttpTransport({
    rootDir,
    model: "opencode/minimax-m2.5-free",
    fetchImpl: async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/session") {
        if ((init.method || "GET") === "GET") return jsonResponse([]);
        return jsonResponse({ id: "ses-http-2", projectID: "global", directory: "/tmp/project", title: "x", version: "1", time: { created: 1, updated: 1 } });
      }
      if (pathname === "/session/ses-http-2/message") {
        return new Response("boom", { status: 502 });
      }
      throw new Error(`Unexpected path ${pathname}`);
    }
  });

  seedCompatibleMetadata(transport);
  await transport.init();
  await assert.rejects(
    () => transport.callAgent("executor", "test prompt", { attempt: 1 }),
    {
      rf_failure_class: "transport_failure",
      rf_transport_phase: "request",
      rf_transport_adapter: "opencode_http"
    }
  );
});

test("HTTP and SDK transports emit the same normalized response shape", async () => {
  const rootDir = createTempRoot();
  const httpTransport = new OpenCodeHttpTransport({
    rootDir,
    model: "opencode/minimax-m2.5-free",
    fetchImpl: async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/session") {
        if ((init.method || "GET") === "GET") return jsonResponse([]);
        return jsonResponse({ id: "ses-http-3", projectID: "global", directory: "/tmp/project", title: "x", version: "1", time: { created: 1, updated: 1 } });
      }
      if (pathname === "/session/ses-http-3/message") {
        return jsonResponse({ info: { id: "msg-1" }, parts: [{ type: "text", text: "shape" }] });
      }
      throw new Error(`Unexpected path ${pathname}`);
    }
  });
  const sdkTransport = new OpenCodeSdkTransport({
    rootDir: "/tmp/project",
    model: "opencode/minimax-m2.5-free",
    serverManager: {
      init: async () => ({}),
      createSession: async () => ({ sessionId: "ses-sdk-1", sessionUrl: "http://localhost/session/ses-sdk-1" }),
      getClient: () => ({
        session: {
          prompt: async () => ({ data: { info: { id: "msg-1" }, parts: [{ type: "text", text: "shape" }] } })
        }
      }),
      getStatus: () => ({ initialized: true, serverFingerprint: "fp-sdk" }),
      close: async () => {}
    }
  });

  seedCompatibleMetadata(httpTransport);
  await httpTransport.init();
  const httpResult = await httpTransport.callAgent("executor", "shape", { attempt: 1 });
  const sdkResult = await sdkTransport.callAgent("executor", "shape", { attempt: 1 });

  assert.deepEqual(Object.keys(httpResult).sort(), Object.keys(sdkResult).sort());
  assert.equal(httpResult.text, "shape");
  assert.equal(sdkResult.text, "shape");
});

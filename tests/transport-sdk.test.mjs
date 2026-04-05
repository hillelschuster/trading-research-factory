import test from "node:test";
import assert from "node:assert/strict";
import { OpenCodeSdkTransport } from "../src/core/transport/opencode-sdk-transport.mjs";

test("OpenCodeSdkTransport creates a fresh session before prompting", async () => {
  const calls = [];
  const transport = new OpenCodeSdkTransport({
    rootDir: "/tmp/project",
    model: "opencode/minimax-m2.5-free",
    serverManager: {
      init: async () => ({}),
      createSession: async ({ agent, attempt }) => {
        calls.push(["createSession", agent, attempt]);
        return { sessionId: "ses-1", sessionUrl: "http://localhost/session/ses-1" };
      },
      getClient: () => ({
        session: {
          prompt: async (payload) => {
            calls.push(["prompt", payload.path.id, payload.body.agent]);
            return { data: { parts: [{ type: "text", text: "hello" }] } };
          }
        }
      }),
      getStatus: () => ({ initialized: true }),
      close: async () => { calls.push(["close"]); }
    }
  });

  const result = await transport.callAgent("executor", "run this", { attempt: 3 });
  assert.equal(result.sessionId, "ses-1");
  assert.equal(result.text, "hello");
  assert.deepEqual(calls[0], ["createSession", "executor", 3]);
  assert.deepEqual(calls[1], ["prompt", "ses-1", "executor"]);
});

test("OpenCodeSdkTransport normalizes fetch-failed header timeouts", async () => {
  const error = new Error("fetch failed", { cause: new Error("headers timeout") });
  const transport = new OpenCodeSdkTransport({
    rootDir: "/tmp/project",
    model: "opencode/minimax-m2.5-free",
    serverManager: {
      init: async () => ({}),
      createSession: async () => ({ sessionId: "ses-2", sessionUrl: "http://localhost/session/ses-2" }),
      getClient: () => ({
        session: {
          prompt: async () => {
            throw error;
          }
        }
      }),
      getStatus: () => ({ initialized: true }),
      close: async () => {}
    }
  });

  await assert.rejects(
    () => transport.callAgent("executor", "run this"),
    {
      message: /timed out waiting for response headers/,
      rf_failure_class: "transport_failure",
      rf_transport_phase: "first_headers",
      rf_retryable: true,
      rf_timeout_bucket: "first_headers"
    }
  );
});

test("OpenCodeSdkTransport tags total request timeouts with the request phase", async () => {
  const transport = new OpenCodeSdkTransport({
    rootDir: "/tmp/project",
    model: "opencode/minimax-m2.5-free",
    transportTimeouts: { totalRequestMs: 10 },
    serverManager: {
      init: async () => ({}),
      createSession: async () => ({ sessionId: "ses-3", sessionUrl: "http://localhost/session/ses-3" }),
      getClient: () => ({
        session: {
          prompt: async () => new Promise(() => {})
        }
      }),
      getStatus: () => ({ initialized: true, serverFingerprint: "fp-1" }),
      close: async () => {}
    }
  });

  await assert.rejects(
    () => transport.callAgent("executor", "run this"),
    {
      message: /total-request timeout/,
      rf_failure_class: "transport_failure",
      rf_transport_phase: "request",
      rf_retryable: true,
      rf_timeout_bucket: "total_request",
      rf_server_fingerprint: "fp-1"
    }
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { assertLiveTransport } from "../src/core/transport/live-transport.mjs";
import { OpenCodeSdkTransport } from "../src/core/transport/opencode-sdk-transport.mjs";

test("assertLiveTransport accepts the minimal live transport contract", () => {
  const transport = assertLiveTransport({
    init: async () => {},
    createSession: async () => ({ sessionId: "s1", sessionUrl: "http://localhost/session/s1" }),
    callAgent: async () => ({ text: "ok" }),
    close: async () => {},
    getStatus: () => ({ initialized: true })
  });

  assert.equal(typeof transport.callAgent, "function");
});

test("assertLiveTransport rejects missing required methods", () => {
  assert.throws(
    () => assertLiveTransport({ init: async () => {}, close: async () => {} }),
    /missing required method: createSession/
  );
});

test("OpenCodeSdkTransport satisfies the live transport contract", () => {
  const transport = new OpenCodeSdkTransport({
    rootDir: "/tmp/project",
    model: "opencode/minimax-m2.5-free",
    serverManager: {
      init: async () => ({}),
      createSession: async () => ({ sessionId: "s1", sessionUrl: "http://localhost/session/s1" }),
      getStatus: () => ({ initialized: true }),
      getClient: () => ({
        session: {
          prompt: async () => ({ data: { parts: [{ type: "text", text: "ok" }] } })
        }
      }),
      close: async () => {}
    }
  });

  assert.equal(assertLiveTransport(transport), transport);
});

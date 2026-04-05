import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildPaths } from "../src/core/paths.mjs";
import { OpenCodeServerManager, buildOpencodeServerConfig, buildSessionUrl } from "../src/core/transport/opencode-server-manager.mjs";

function createTempRepoRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "transport-server-"));
  const projectRoot = path.join(tempRoot, "trading-research-factory");
  fs.mkdirSync(path.join(projectRoot, "src", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "trading-research-factory" }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Temp\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "cli.mjs"), "", "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "prompts", "runtime-invariants.md"), "rules\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "opencode.json"), JSON.stringify({
    plugin: ["opencode-agent-memory@0.2.0", "keep-me"],
    instructions: ["src/prompts/runtime-invariants.md"],
    provider: {}
  }, null, 2) + "\n", "utf8");
  return projectRoot;
}

test("buildOpencodeServerConfig strips memory plugin and absolutizes instructions", () => {
  const rootDir = createTempRepoRoot();
  const config = buildOpencodeServerConfig(rootDir, "opencode");

  assert.deepEqual(config.plugin, []);
  assert.equal(config.instructions[0], path.join(rootDir, "src/prompts/runtime-invariants.md"));
  assert.equal(config.provider.opencode.options.timeout, false);
});

test("buildOpencodeServerConfig rejects unsupported live plugin allowlists", () => {
  const rootDir = createTempRepoRoot();

  assert.throws(
    () => buildOpencodeServerConfig(rootDir, "opencode", { mode: "live", allowedPlugins: ["keep-me"] }),
    /Unsupported live plugin allowlist entries/
  );
});

test("OpenCodeServerManager will not reuse on probe success alone without compatible metadata", async () => {
  let createServerCalls = 0;
  const rootDir = createTempRepoRoot();
  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({
      session: {
        list: async () => {},
        create: async () => ({ data: { id: "ses-1", projectID: "global" } })
      }
    }),
    createServer: async () => {
      createServerCalls += 1;
      return {
        client: { session: { create: async () => ({ data: { id: "ses-new", projectID: "global" } }) } },
        server: { url: "http://127.0.0.1:4096", close: async () => {} }
      };
    },
    options: { existingServerRetries: 1 },
    logger: { log() {} }
  });

  const status = await manager.init();
  assert.equal(status.reusedExisting, false);
  assert.equal(createServerCalls, 1);
});

test("OpenCodeServerManager reuses a compatible existing server", async () => {
  let listed = 0;
  const rootDir = createTempRepoRoot();
  const paths = buildPaths(rootDir);
  const metadataPath = path.join(paths.toolingSandbox, "runtime", "opencode-server.json");
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  const fingerprintManager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({ session: { list: async () => {} } }),
    createServer: async () => { throw new Error("unused"); },
    logger: { log() {} }
  });
  fs.writeFileSync(metadataPath, JSON.stringify({
    owner_pid: process.pid,
    root_dir: rootDir,
    provider_id: "opencode",
    mode: "live",
    base_url: "http://127.0.0.1:4096",
    fingerprint: fingerprintManager.getServerFingerprint()
  }, null, 2) + "\n", "utf8");

  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({
      session: {
        list: async () => { listed += 1; },
        create: async () => ({ data: { id: "ses-1", projectID: "global" } })
      }
    }),
    createServer: async () => {
      throw new Error("should not start");
    },
    logger: { log() {} }
  });

  const status = await manager.init();
  assert.equal(status.reusedExisting, true);
  assert.equal(listed >= 1, true);
});

test("OpenCodeServerManager removes stale reuse metadata when the tracked pid is dead", () => {
  const rootDir = createTempRepoRoot();
  const paths = buildPaths(rootDir);
  const metadataPath = path.join(paths.toolingSandbox, "runtime", "opencode-server.json");
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify({
    owner_pid: 999999,
    root_dir: rootDir,
    provider_id: "opencode",
    mode: "live",
    base_url: "http://127.0.0.1:4096",
    fingerprint: "deadbeef"
  }, null, 2) + "\n", "utf8");

  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({ session: { list: async () => {} } }),
    createServer: async () => { throw new Error("unused"); },
    logger: { log() {} }
  });

  const metadata = manager.readReuseMetadata();
  assert.equal(metadata, null);
  assert.equal(fs.existsSync(metadataPath), false);
});

test("OpenCodeServerManager starts a new server when reuse fails and closes owned server", async () => {
  let closed = false;
  const rootDir = createTempRepoRoot();
  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({
      session: {
        list: async () => {
          throw new Error("probe failed");
        }
      }
    }),
    createServer: async () => ({
      client: {
        session: {
          create: async () => ({ data: { id: "ses-2", projectID: "global" } })
        }
      },
      server: {
        url: "http://127.0.0.1:4096",
        close: async () => { closed = true; }
      }
    }),
    options: {
      existingServerRetries: 1
    },
    logger: { log() {} }
  });

  const status = await manager.init();
  assert.equal(status.ownsServer, true);
  assert.equal(status.reusedExisting, false);
  await manager.close();
  assert.equal(closed, true);
});

test("OpenCodeServerManager writes reuse metadata with the managed server pid", async () => {
  const rootDir = createTempRepoRoot();
  const paths = buildPaths(rootDir);
  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({
      session: {
        list: async () => {
          throw new Error("probe failed");
        }
      }
    }),
    createServer: async () => ({
      client: {
        session: {
          create: async () => ({ data: { id: "ses-4", projectID: "global" } })
        }
      },
      server: {
        url: "http://127.0.0.1:4096",
        pid: 54321,
        close: async () => {}
      }
    }),
    options: {
      existingServerRetries: 1
    },
    logger: { log() {} }
  });

  await manager.init();
  const metadata = JSON.parse(fs.readFileSync(path.join(paths.toolingSandbox, "runtime", "opencode-server.json"), "utf8"));
  assert.equal(metadata.owner_pid, 54321);
  assert.equal(metadata.launcher_pid, process.pid);
});

test("OpenCodeServerManager can build a client when createServer returns only server process info", async () => {
  const rootDir = createTempRepoRoot();
  let createdClientBaseUrl = null;
  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: ({ baseUrl }) => {
      createdClientBaseUrl = baseUrl;
      return {
        session: {
          list: async () => {
            throw new Error("probe failed");
          },
          create: async () => ({ data: { id: "ses-6", projectID: "global" } })
        }
      };
    },
    createServer: async () => ({
      url: "http://127.0.0.1:4096",
      pid: 77777,
      close: async () => {}
    }),
    options: {
      existingServerRetries: 1
    },
    logger: { log() {} }
  });

  const status = await manager.init();
  assert.equal(status.initialized, true);
  assert.equal(createdClientBaseUrl, "http://127.0.0.1:4096");
  const created = await manager.createSession({ agent: "executor", attempt: 1 });
  assert.equal(created.sessionUrl, buildSessionUrl("http://127.0.0.1:4096", "global", "ses-6"));
});

test("OpenCodeServerManager clears metadata only after async server close resolves", async () => {
  const rootDir = createTempRepoRoot();
  const paths = buildPaths(rootDir);
  const metadataPath = path.join(paths.toolingSandbox, "runtime", "opencode-server.json");
  let closeObservedMetadata = false;
  let releaseClose;
  const closeBarrier = new Promise((resolve) => {
    releaseClose = resolve;
  });

  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({
      session: {
        list: async () => {
          throw new Error("probe failed");
        }
      }
    }),
    createServer: async () => ({
      client: {
        session: {
          create: async () => ({ data: { id: "ses-5", projectID: "global" } })
        }
      },
      server: {
        url: "http://127.0.0.1:4096",
        pid: 65432,
        close: async () => {
          closeObservedMetadata = fs.existsSync(metadataPath);
          await closeBarrier;
        }
      }
    }),
    options: {
      existingServerRetries: 1
    },
    logger: { log() {} }
  });

  await manager.init();
  const closePromise = manager.close();
  assert.equal(fs.existsSync(metadataPath), true);
  releaseClose();
  await closePromise;
  assert.equal(closeObservedMetadata, true);
  assert.equal(fs.existsSync(metadataPath), false);
});

test("OpenCodeServerManager creates session URLs via project fallback", async () => {
  const rootDir = createTempRepoRoot();
  const paths = buildPaths(rootDir);
  const metadataPath = path.join(paths.toolingSandbox, "runtime", "opencode-server.json");
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  const fingerprintManager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({ session: { list: async () => {} } }),
    createServer: async () => { throw new Error("unused"); },
    logger: { log() {} }
  });
  fs.writeFileSync(metadataPath, JSON.stringify({
    owner_pid: process.pid,
    root_dir: rootDir,
    provider_id: "opencode",
    mode: "live",
    base_url: "http://127.0.0.1:4096",
    fingerprint: fingerprintManager.getServerFingerprint()
  }, null, 2) + "\n", "utf8");

  const manager = new OpenCodeServerManager({
    rootDir,
    providerID: "opencode",
    fingerprintContext: { model: "opencode/minimax-m2.5-free" },
    createClient: () => ({
      session: {
        list: async () => {},
        create: async () => ({ data: { id: "ses-3" } })
      },
      project: {
        current: async () => ({ data: { id: "global" } })
      }
    }),
    createServer: async () => {
      throw new Error("unused");
    },
    logger: { log() {} }
  });

  await manager.init();
  const created = await manager.createSession({ agent: "executor", attempt: 1 });
  assert.equal(created.sessionUrl, buildSessionUrl("http://127.0.0.1:4096", "global", "ses-3"));
});

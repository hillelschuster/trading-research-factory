#!/usr/bin/env node
import { hrtime } from "node:process";
import { loadRuntimeConfig } from "../src/core/config.mjs";
import { initializeProject } from "../src/core/init.mjs";
import { buildPaths } from "../src/core/paths.mjs";
import { createLiveTransport } from "../src/core/transport/live-transport.mjs";
import { runTransportBakeoff } from "../src/core/verification.mjs";

function elapsedMs(startNs) {
  return Number(hrtime.bigint() - startNs) / 1e6;
}

function sessionUrlCorrect(sessionUrl, sessionId) {
  return typeof sessionUrl === "string" && sessionUrl.includes(sessionId);
}

function stageCompleted(response) {
  if (!response || typeof response !== "object") return false;
  if (typeof response.text === "string" && response.text.trim()) return true;
  return Array.isArray(response.raw?.parts) && response.raw.parts.length > 0;
}

async function exerciseRecovery({ adapter, config }) {
  const lowTimeoutTransport = createLiveTransport({
    rootDir: config.rootDir,
    model: config.model,
    openBrowser: false,
    livePluginPolicy: config.livePluginPolicy,
    liveTransportAdapter: adapter,
    transportTimeouts: {
      ...config.liveTransportTimeouts,
      totalRequestMs: 1
    }
  });

  let timeoutObserved = false;
  try {
    await lowTimeoutTransport.init();
    await lowTimeoutTransport.callAgent(undefined, "Return exactly OK and nothing else.", { attempt: 91 });
  } catch (error) {
    timeoutObserved = error?.rf_failure_class === "transport_failure";
  } finally {
    await lowTimeoutTransport.close().catch(() => {});
  }

  const recoveryTransport = createLiveTransport({
    rootDir: config.rootDir,
    model: config.model,
    openBrowser: false,
    livePluginPolicy: config.livePluginPolicy,
    liveTransportAdapter: adapter,
    transportTimeouts: config.liveTransportTimeouts
  });

  try {
    await recoveryTransport.init();
    const recovered = await recoveryTransport.callAgent(undefined, "Return exactly OK and nothing else.", { attempt: 92 });
    return timeoutObserved && stageCompleted(recovered) ? 1 : 0;
  } catch {
    return 0;
  } finally {
    await recoveryTransport.close().catch(() => {});
  }
}

async function main() {
  const runtime = loadRuntimeConfig(process.argv.slice(2));
  const rootIdentity = runtime.rootIdentity;
  const paths = initializeProject(rootIdentity);
  const cleanup = new Set();
  const ownerByAdapter = new Map();

  const sharedConfig = {
    rootDir: rootIdentity.realPath,
    model: runtime.model,
    livePluginPolicy: runtime.livePluginPolicy,
    liveTransportTimeouts: {
      ...runtime.liveTransportTimeouts,
      totalRequestMs: runtime.liveTransportTimeouts.totalRequestMs || 45000
    }
  };

  try {
    const { artifact, artifactPath } = await runTransportBakeoff({
      paths,
      synthetic: false,
      generatedAt: new Date().toISOString(),
      adapters: ["sdk", "http"],
      executeCandidate: async ({ adapter, scenario }) => {
        const notes = [];
        let transport;
        let ownerTransport = ownerByAdapter.get(adapter);

        if (scenario === "fresh_server") {
          transport = createLiveTransport({
            rootDir: sharedConfig.rootDir,
            model: sharedConfig.model,
            openBrowser: false,
            livePluginPolicy: sharedConfig.livePluginPolicy,
            liveTransportAdapter: adapter,
            transportTimeouts: sharedConfig.liveTransportTimeouts
          });
          cleanup.add(transport);
          await transport.init();
          ownerByAdapter.set(adapter, transport);
          ownerTransport = transport;
        } else {
          if (!ownerTransport) {
            throw new Error(`Validated reuse requested before fresh server owner for adapter ${adapter}.`);
          }
          transport = createLiveTransport({
            rootDir: sharedConfig.rootDir,
            model: sharedConfig.model,
            openBrowser: false,
            livePluginPolicy: sharedConfig.livePluginPolicy,
            liveTransportAdapter: adapter,
            transportTimeouts: sharedConfig.liveTransportTimeouts
          });
          cleanup.add(transport);
          await transport.init();
        }

        const initStatus = transport.getStatus?.() ?? {};
        if (scenario === "fresh_server" && initStatus.reusedExisting) {
          notes.push("fresh_server unexpectedly reused an existing server");
        }
        if (scenario === "validated_reuse" && !initStatus.reusedExisting) {
          notes.push("validated_reuse did not attach to an existing compatible server");
        }

        let sessionCreateSuccessRate = 0;
        let sessionUrlCorrectnessRate = 0;
        let stageCompletionRate = 0;
        let totalRequestMs = null;
        let timeToFirstHeadersMs = null;

        const sessionStart = hrtime.bigint();
        const created = await transport.createSession({ attempt: scenario === "fresh_server" ? 1 : 2 });
        const sessionCreateMs = elapsedMs(sessionStart);
        if (created?.sessionId) {
          sessionCreateSuccessRate = 1;
          sessionUrlCorrectnessRate = sessionUrlCorrect(created.sessionUrl, created.sessionId) ? 1 : 0;
        }

        const promptStart = hrtime.bigint();
        const response = await transport.callAgent(undefined, "Return exactly OK and nothing else.", { attempt: scenario === "fresh_server" ? 11 : 12 });
        totalRequestMs = Number(elapsedMs(promptStart).toFixed(4));
        timeToFirstHeadersMs = transport.getLastRequestMetrics?.()?.first_headers_ms ?? null;
        stageCompletionRate = stageCompleted(response) ? 1 : 0;

        const retryRecoveryRate = await exerciseRecovery({ adapter, config: sharedConfig });

        if (scenario === "validated_reuse") {
          await transport.close().catch(() => {});
          cleanup.delete(transport);
          await ownerTransport.close().catch(() => {});
          cleanup.delete(ownerTransport);
          ownerByAdapter.delete(adapter);
        }

        return {
          attempts: 1,
          session_create_success_rate: sessionCreateSuccessRate,
          stage_completion_rate: stageCompletionRate,
          retry_recovery_rate: retryRecoveryRate,
          session_url_correctness_rate: sessionUrlCorrectnessRate,
          time_to_first_headers_ms: typeof timeToFirstHeadersMs === "number" ? Number(timeToFirstHeadersMs.toFixed(4)) : Number(sessionCreateMs.toFixed(4)),
          total_request_ms: totalRequestMs,
          notes
        };
      }
    });

    console.log(JSON.stringify({
      artifact_path: artifactPath,
      winner: artifact.winner,
      default_adapter_recommended: artifact.default_adapter_recommended,
      synthetic: artifact.synthetic
    }, null, 2));
  } finally {
    for (const transport of cleanup) {
      await transport.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});

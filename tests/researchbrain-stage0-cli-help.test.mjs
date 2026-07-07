import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyResearchBrainLlmPreset, buildResearchBrainProviderFactory } from "../scripts/researchbrain-stage0-provider-utils.mjs";

const STAGE0_COMMANDS = [
  ["researchbrain:stage0-runtime", "scripts/run-researchbrain-stage0-runtime.mjs", "--request <path>"],
  ["researchbrain:stage0-loop", "scripts/run-researchbrain-stage0-loop.mjs", "--max-jobs <n>"],
  ["researchbrain:stage0-outbox", "scripts/run-researchbrain-stage0-outbox-consumer.mjs", "--limit <n>"],
  ["researchbrain:stage0-diagnostics", "scripts/run-researchbrain-stage0-diagnostics.mjs", "--failure-limit <n>"],
  ["researchbrain:stage0-seed", "scripts/run-researchbrain-stage0-job-seeder.mjs", "--request-sha256 <sha>"],
  ["researchbrain:stage0-supervisor", "scripts/run-researchbrain-stage0-supervisor.mjs", "--outbox-limit <n>"],
  ["researchbrain:stage0-readiness", "scripts/run-researchbrain-stage0-readiness.mjs", "--write"]
];

const STAGE0_VALUE_COMMANDS = [
  "scripts/run-researchbrain-stage0-runtime.mjs",
  "scripts/run-researchbrain-stage0-loop.mjs",
  "scripts/run-researchbrain-stage0-outbox-consumer.mjs",
  "scripts/run-researchbrain-stage0-diagnostics.mjs",
  "scripts/run-researchbrain-stage0-job-seeder.mjs",
  "scripts/run-researchbrain-stage0-supervisor.mjs",
  "scripts/run-researchbrain-stage0-readiness.mjs"
];

test("ResearchBrain Stage-0 CLI help preserves safety boundaries and package aliases", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

  for (const [scriptName, scriptPath, expectedOption] of STAGE0_COMMANDS) {
    assert.equal(packageJson.scripts[scriptName], `node ${scriptPath}`);
    assert.equal(fs.existsSync(path.join(process.cwd(), scriptPath)), true);

    const result = spawnSync("node", [scriptPath, "--help"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `${scriptPath} --help failed: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /^Usage: node scripts\/run-researchbrain-stage0-/);
    assert.match(result.stdout, new RegExp(expectedOption.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout, /official state\/evidence\/backlog\/leaderboard/);
    assert.match(result.stdout, /WFA\/MT5/);
    assert.match(result.stdout, /Phase 8E/);
    assert.match(result.stdout, /profitability labels/);
    if (scriptPath === "scripts/run-researchbrain-stage0-readiness.mjs") {
      assert.match(result.stdout, /--processed-outbox-limit <n>/);
      assert.match(result.stdout, /--runtime-consistency-limit <n>/);
    }
    if (scriptPath === "scripts/run-researchbrain-stage0-supervisor.mjs") {
      assert.match(result.stdout, /--cycles <n>/);
      assert.match(result.stdout, /--continue-on-attention/);
      assert.match(result.stdout, /--fail-on-attention/);
      assert.match(result.stdout, /--max-total-jobs <n>/);
      assert.match(result.stdout, /--max-wall-clock-ms <n>/);
      assert.match(result.stdout, /--max-terminal-failures <n>/);
      assert.match(result.stdout, /--readiness-request-limit <n>/);
      assert.match(result.stdout, /--processed-outbox-limit <n>/);
      assert.match(result.stdout, /--runtime-consistency-limit <n>/);
      assert.match(result.stdout, /--seed-unseeded-valid/);
      assert.match(result.stdout, /--auto-seed-limit <n>/);
      assert.match(result.stdout, /--preflight-only/);
      assert.match(result.stdout, /--require-live-unattended-safe/);
      assert.match(result.stdout, /--failure-report-dir <path>/);
      assert.match(result.stdout, /--run-report-dir <path>/);
      assert.match(result.stdout, /--allow-live-llm/);
      assert.match(result.stdout, /--llm-preset/);
      assert.match(result.stdout, /deepseek_v4_flash_xhigh/);
      assert.match(result.stdout, /--llm-provider/);
      assert.match(result.stdout, /--llm-model/);
      assert.match(result.stdout, /--llm-api-key-env/);
      assert.match(result.stdout, /--llm-base-url/);
      assert.match(result.stdout, /--llm-max-tokens/);
      assert.match(result.stdout, /--llm-reasoning-effort/);
      assert.match(result.stdout, /--max-llm-calls/);
      assert.match(result.stdout, /--tool-mode/);
      assert.match(result.stdout, /--allow-tool/);
      assert.match(result.stdout, /--max-tool-calls/);
      assert.match(result.stdout, /--max-cost-usd/);
      assert.match(result.stdout, /--max-estimated-live-cost-usd/);
      assert.match(result.stdout, /--max-transcript-bytes/);
      assert.match(result.stdout, /--allow-live-source-search/);
      assert.match(result.stdout, /--allow-live-source-capture/);
      assert.match(result.stdout, /--source-provider/);
      assert.match(result.stdout, /--source-api-key-env/);
      assert.match(result.stdout, /--source-tool-max-attempts/);
      assert.match(result.stdout, /Live LLM Provider Options/);
      assert.match(result.stdout, /Live Source Provider Options/);
      assert.match(result.stdout, /Safe bounded live queue-drain canary profile/);
      assert.match(result.stdout, /operator_command_profile/);
      assert.match(result.stdout, /selected_requests/);
      assert.match(result.stdout, /env presence booleans/);
    }
  }
});

test("ResearchBrain Stage-0 CLIs reject missing option values before execution", () => {
  for (const scriptPath of STAGE0_VALUE_COMMANDS) {
    const missing = spawnSync("node", [scriptPath, "--root"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.notEqual(missing.status, 0, `${scriptPath} unexpectedly accepted --root without a value`);
    assert.match(missing.stderr, /Missing value for --root/);

    const nextFlag = spawnSync("node", [scriptPath, "--root", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.notEqual(nextFlag.status, 0, `${scriptPath} unexpectedly consumed --help as a --root value`);
    assert.match(nextFlag.stderr, /Missing value for --root/);
  }
});

test("ResearchBrain Stage-0 CLIs reject invalid numeric option values", () => {
  const result = spawnSync("node", ["scripts/run-researchbrain-stage0-loop.mjs", "--max-jobs", "not-a-number"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid numeric value for --max-jobs: not-a-number/);
});

test("ResearchBrain LLM preset deepseek_v4_flash_xhigh sets deepseek provider with DEEPSEEK_API_KEY", () => {
  const presetArgs = applyResearchBrainLlmPreset({
    providerMode: "live_llm_agent",
    allowLiveLlm: true,
    llmPreset: "deepseek_v4_flash_xhigh"
  });
  assert.equal(presetArgs.llmProvider, "deepseek");
  assert.equal(presetArgs.llmModel, "deepseek-v4-flash");
  assert.equal(presetArgs.llmApiKeyEnv, "DEEPSEEK_API_KEY");
  assert.equal(presetArgs.llmMaxTokens, 8192);
  assert.equal(presetArgs.llmBaseUrl, undefined);
});

test("ResearchBrain LLM preset opencode_go_kimi_xhigh routes kimi-k2.7-code via OpenCode Go", () => {
  const presetArgs = applyResearchBrainLlmPreset({
    providerMode: "live_llm_agent",
    allowLiveLlm: true,
    llmPreset: "opencode_go_kimi_xhigh"
  });
  assert.equal(presetArgs.llmProvider, "openai_compatible");
  assert.equal(presetArgs.llmModel, "kimi-k2.7-code");
  assert.equal(presetArgs.llmApiKeyEnv, "OPENCODE_GO_API_KEY");
  assert.equal(presetArgs.llmBaseUrl, "https://opencode.ai/zen/go/v1");
  assert.equal(presetArgs.llmMaxTokens, 8192);
});

test("ResearchBrain LLM preset opencode_go_glm_xhigh routes glm-5.2 via OpenCode Go", () => {
  const presetArgs = applyResearchBrainLlmPreset({
    providerMode: "live_llm_agent",
    allowLiveLlm: true,
    llmPreset: "opencode_go_glm_xhigh"
  });
  assert.equal(presetArgs.llmProvider, "openai_compatible");
  assert.equal(presetArgs.llmModel, "glm-5.2");
  assert.equal(presetArgs.llmApiKeyEnv, "OPENCODE_GO_API_KEY");
  assert.equal(presetArgs.llmBaseUrl, "https://opencode.ai/zen/go/v1");
  assert.equal(presetArgs.llmMaxTokens, 8192);
});

test("ResearchBrain LLM preset opencode_deepseek_v4_pro is still recognized and sets OpenCode base URL", () => {
  const presetArgs = applyResearchBrainLlmPreset({
    providerMode: "live_llm_agent",
    allowLiveLlm: true,
    llmPreset: "opencode_deepseek_v4_pro"
  });
  assert.equal(presetArgs.llmProvider, "openai_compatible");
  assert.equal(presetArgs.llmModel, "deepseek-v4-pro");
  assert.equal(presetArgs.llmApiKeyEnv, "OPENCODE_GO_API_KEY");
  assert.equal(presetArgs.llmBaseUrl, "https://opencode.ai/zen/go/v1");
});

test("ResearchBrain Stage-0 supervisor live provider flags fail closed and build provider factory", () => {
  const missingAllow = spawnSync("node", [
    "scripts/run-researchbrain-stage0-supervisor.mjs",
    "--provider-mode", "live_llm_agent",
    "--llm-preset", "opencode_deepseek_v4_pro"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.notEqual(missingAllow.status, 0);
  assert.match(missingAllow.stderr, /requires --allow-live-llm/);

  const presetArgs = applyResearchBrainLlmPreset({
    providerMode: "live_llm_agent",
    allowLiveLlm: true,
    llmPreset: "opencode_deepseek_v4_pro"
  });
  assert.equal(presetArgs.llmProvider, "openai_compatible");
  assert.equal(presetArgs.llmModel, "deepseek-v4-pro");

  const providerFactory = buildResearchBrainProviderFactory(presetArgs);
  assert.equal(typeof providerFactory, "function");
  const priorKey = process.env.OPENCODE_GO_API_KEY;
  process.env.OPENCODE_GO_API_KEY = "test-only-dummy-key";
  try {
    const provider = providerFactory({ payload: { provider_mode: "live_llm_agent" } });
    assert.equal(provider.mode, "live_llm_agent");
    assert.equal(provider.live_research, true);
    assert.equal(provider.llm_provider, "openai_compatible");
    assert.equal(provider.llm_model, "deepseek-v4-pro");
  } finally {
    if (priorKey === undefined) delete process.env.OPENCODE_GO_API_KEY;
    else process.env.OPENCODE_GO_API_KEY = priorKey;
  }
});

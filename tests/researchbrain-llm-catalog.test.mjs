import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RESEARCHBRAIN_LLM_PRESETS,
  applyResearchBrainLlmPreset,
  formatResearchBrainLlmPresetHelp
} from "../src/core/researchbrain-llm-catalog.mjs";
import {
  RESEARCHBRAIN_ACTIVE_LIVE_TOOLS,
  removeProviderHypothesisContentHashes,
  wrapResearchBrainProviderOutput
} from "../scripts/researchbrain-stage0-provider-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ResearchBrain catalog keeps Flash and Pro defaults in one source", () => {
  assert.deepEqual(RESEARCHBRAIN_LLM_PRESETS.deepseek_v4_flash_xhigh, {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com",
    maxTokens: 8192,
    description: "Direct DeepSeek V4 Flash for normal ResearchBrain discovery runs."
  });
  assert.equal(RESEARCHBRAIN_LLM_PRESETS.deepseek_v4_pro_max.model, "deepseek-v4-pro");
  assert.equal(RESEARCHBRAIN_LLM_PRESETS.deepseek_v4_pro_max.provider, "deepseek");
});

test("ResearchBrain preset application preserves explicit per-run overrides", () => {
  const resolved = applyResearchBrainLlmPreset({
    llmPreset: "deepseek_v4_flash_xhigh",
    llmModel: "temporary-review-model",
    llmMaxTokens: 4096
  });
  assert.equal(resolved.llmProvider, "deepseek");
  assert.equal(resolved.llmModel, "temporary-review-model");
  assert.equal(resolved.llmMaxTokens, 4096);
  assert.equal(resolved.llmApiKeyEnv, "DEEPSEEK_API_KEY");
});

test("ResearchBrain preset help is generated from the catalog", () => {
  const help = formatResearchBrainLlmPresetHelp();
  assert.match(help, /deepseek_v4_flash_xhigh/);
  assert.match(help, /deepseek_v4_pro_max/);
  assert.match(help, /opencode_deepseek_v4_pro/);
});

test("unknown ResearchBrain preset fails loud", () => {
  assert.throws(
    () => applyResearchBrainLlmPreset({ llmPreset: "unknown_model" }),
    /Unknown ResearchBrain LLM preset/
  );
});

test("normal live ResearchBrain tools exclude wiki but retain research and recording tools", () => {
  assert.equal(RESEARCHBRAIN_ACTIVE_LIVE_TOOLS.includes("write_wiki_page"), false);
  assert.equal(RESEARCHBRAIN_ACTIVE_LIVE_TOOLS.includes("search_wiki"), false);
  assert.equal(RESEARCHBRAIN_ACTIVE_LIVE_TOOLS.includes("search_web"), true);
  assert.equal(RESEARCHBRAIN_ACTIVE_LIVE_TOOLS.includes("capture_url_source"), true);
  assert.equal(RESEARCHBRAIN_ACTIVE_LIVE_TOOLS.includes("search_research_memory"), true);
  assert.equal(RESEARCHBRAIN_ACTIVE_LIVE_TOOLS.includes("record_hypothesis"), true);
  assert.equal(RESEARCHBRAIN_ACTIVE_LIVE_TOOLS.includes("record_rejection"), true);
});

test("provider-supplied hypothesis hashes are removed before runtime acceptance", async () => {
  const sanitized = removeProviderHypothesisContentHashes({
    hypothesis_packets: [{ hypothesis_id: "HYP-1", content_hash: "a".repeat(64) }],
    source_captures: []
  });
  assert.deepEqual(sanitized.hypothesis_packets, [{ hypothesis_id: "HYP-1" }]);

  const provider = wrapResearchBrainProviderOutput({
    name: "test-provider",
    async generate() {
      return { hypothesis_packets: [{ hypothesis_id: "HYP-2", content_hash: "b".repeat(64) }] };
    }
  });
  assert.deepEqual((await provider.generate({})).hypothesis_packets, [{ hypothesis_id: "HYP-2" }]);
});

test("OpenCode workers inherit one Flash default and reserve Pro for oracle review", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "opencode.json"), "utf8"));
  assert.equal(config.model, "opencode-go/deepseek-v4-flash");
  assert.equal(config.agent.oracle.model, "opencode-go/deepseek-v4-pro");
  assert.equal(config.agent.oracle.permission.write, "deny");
  assert.equal(config.agent.oracle.permission.edit, "deny");

  for (const [name, agent] of Object.entries(config.agent)) {
    if (name === "oracle") continue;
    assert.equal(agent.model, undefined, `${name} should inherit the single Flash default`);
  }
});

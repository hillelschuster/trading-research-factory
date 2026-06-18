import test from "node:test";
import assert from "node:assert/strict";
import { classifyRetryFailure, runWithRetryAttempts, sanitizeRetryErrorMessage } from "../src/core/retry-policy.mjs";

test("retry policy classifies transient, validation, poison, and terminal failures", () => {
  assert.deepEqual(classifyRetryFailure(new Error("HTTP 503 temporarily unavailable"), { phase: "provider" }).retryable, true);
  assert.equal(classifyRetryFailure(new Error("provider output schema_version must be researchbrain_stage0_provider_output_v1"), { phase: "provider" }).failure_class, "schema_or_validation_failure");
  assert.equal(classifyRetryFailure(new Error("provider output contains forbidden profitability_label"), { phase: "provider" }).failure_class, "poison_candidate_or_run");
  assert.equal(classifyRetryFailure(new Error("permanent provider account disabled"), { phase: "provider" }).failure_class, "terminal_failed_condition");
});

test("retry policy records bounded attempts and redacts bearer-like secrets", async () => {
  let calls = 0;
  const result = await runWithRetryAttempts(async () => {
    calls += 1;
    if (calls === 1) throw new Error("HTTP 429 rate limit authorization: Bearer SECRET_RETRY_TOKEN");
    return "ok";
  }, { phase: "test_retry", maxAttempts: 2, baseDelayMs: 0 });

  assert.equal(result.value, "ok");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, "retry_scheduled");
  assert.equal(result.attempts[0].retryable, true);
  assert.equal(result.attempts[1].status, "succeeded");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_RETRY_TOKEN/);
  assert.match(result.attempts[0].error_message, /\[REDACTED\]/);
});

test("retry sanitizer redacts common API-key forms", () => {
  const sanitized = sanitizeRetryErrorMessage("authorization: Bearer sk-testsecret123 x-api-key='abc123' token=xyz");
  assert.doesNotMatch(sanitized, /testsecret123|abc123|xyz/);
  assert.match(sanitized, /\[REDACTED\]/);
});

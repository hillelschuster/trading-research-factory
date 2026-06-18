export const RESEARCH_FACTORY_RETRY_ATTEMPTS_SCHEMA_VERSION = "research_factory_retry_attempts_v1";

const DEFAULT_RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function errorName(error) {
  return error instanceof Error ? error.name : "NonError";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function sanitizeRetryErrorMessage(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|x-api-key|api[-_ ]?key|token|secret)([\s:=\"']+)([^\s,;\"']+)/gi, "$1$2[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/(anthropic|opencode|brave)[-_]?(api[-_]?)?key[-_][A-Za-z0-9_-]{6,}/gi, "$1-[REDACTED]");
}

export function classifyRetryFailure(error, { phase = "unspecified", httpStatus = null } = {}) {
  const rawMessage = errorMessage(error);
  const message = sanitizeRetryErrorMessage(rawMessage);
  const name = errorName(error);
  const explicitRetryable = error?.rf_retryable;
  if (typeof explicitRetryable === "boolean") {
    return {
      phase,
      error_class: name,
      error_message: message,
      failure_class: error.rf_failure_class ?? (explicitRetryable ? "transient_retryable_failure" : "terminal_failed_condition"),
      retryable: explicitRetryable
    };
  }

  const status = Number.isInteger(httpStatus) ? httpStatus : Number(rawMessage.match(/\bHTTP\s+(\d{3})\b/i)?.[1]);
  if (DEFAULT_RETRYABLE_HTTP_STATUSES.has(status)) {
    return { phase, error_class: name, error_message: message, failure_class: "transient_retryable_failure", retryable: true };
  }
  if (/\b(timeout|timed out|abort|aborted|rate limit|temporarily unavailable|try again|socket hang up|connection reset|econnreset|etimedout|eai_again|network|fetch failed|service unavailable|too many requests)\b/i.test(rawMessage)) {
    return { phase, error_class: name, error_message: message, failure_class: "transient_retryable_failure", retryable: true };
  }
  if (/profitability|promotion|sharpe|cagr|pnl|edge_rating|research_run_id mismatch|forbidden/i.test(rawMessage)) {
    return { phase, error_class: name, error_message: message, failure_class: "poison_candidate_or_run", retryable: false };
  }
  if (/schema_version|JSON|must be|requires|invalid|unsupported|not allowed|not allowlisted|outside approved|escapes repository|missing on disk|content must|cited_source_ids|source-support validation|validation failed/i.test(rawMessage)) {
    return { phase, error_class: name, error_message: message, failure_class: "schema_or_validation_failure", retryable: false };
  }
  return { phase, error_class: name, error_message: message, failure_class: "terminal_failed_condition", retryable: false };
}

export function computeRetryBackoffMs({ attemptNumber, baseDelayMs = 0, maxDelayMs = 30_000 } = {}) {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("retry attemptNumber must be a positive integer");
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > maxDelayMs) throw new Error("retry baseDelayMs must be a nonnegative integer within maxDelayMs");
  const multiplier = Math.max(1, 2 ** (attemptNumber - 1));
  return Math.min(maxDelayMs, baseDelayMs * multiplier);
}

export async function runWithRetryAttempts(operation, {
  phase = "unspecified",
  maxAttempts = 1,
  baseDelayMs = 0,
  maxDelayMs = 30_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  classify = classifyRetryFailure
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("retry maxAttempts must be an integer from 1 to 10");
  const attempts = [];
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const startedAt = new Date().toISOString();
    try {
      const value = await operation({ attemptNumber });
      const completedAt = new Date().toISOString();
      attempts.push({
        attempt_number: attemptNumber,
        phase,
        status: "succeeded",
        started_at: startedAt,
        completed_at: completedAt,
        retryable: false,
        backoff_ms: 0,
        final_terminal_state: "succeeded"
      });
      return { value, attempts };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const classification = classify(error, { phase });
      const willRetry = classification.retryable === true && attemptNumber < maxAttempts;
      const backoffMs = willRetry ? computeRetryBackoffMs({ attemptNumber, baseDelayMs, maxDelayMs }) : 0;
      attempts.push({
        attempt_number: attemptNumber,
        phase,
        status: willRetry ? "retry_scheduled" : "failed_terminal",
        started_at: startedAt,
        completed_at: completedAt,
        error_class: classification.error_class,
        error_message: classification.error_message,
        failure_class: classification.failure_class,
        retryable: classification.retryable === true,
        backoff_ms: backoffMs,
        final_terminal_state: willRetry ? "retry_pending" : classification.failure_class
      });
      if (!willRetry) {
        error.rf_retry_attempts = attempts;
        error.rf_retry_classification = classification;
        throw error;
      }
      if (backoffMs > 0) await sleep(backoffMs);
    }
  }
  throw new Error("unreachable retry policy exhaustion");
}

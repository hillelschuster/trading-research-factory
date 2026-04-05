import { isSandboxRelativePath } from "./root-identity.mjs";

const DIAGNOSTIC_ARTIFACT_PATTERNS = [
  /(?:^|\/)stage-input\.json$/,
  /(?:^|\/)stage-prompt\.txt$/,
  /(?:^|\/)stage-response\.raw\.txt$/,
  /(?:^|\/)stage-error\.json$/,
  /(?:^|\/)[^/]+-session\.json$/,
  /(?:^|\/)handoff\.json$/,
  /(?:^|\/)run-state\.json$/,
  /(?:^|\/)run\.log$/
];

const SAFE_ARTIFACT_PATTERNS = [
  /^factory\/experiments\/[^/]+\.plan\.json$/,
  /^factory\/summaries\/[^/]+\.md$/,
  /^factory\/runs\/[^/]+\/(execution-result|evaluation|summary)\.json$/,
  /(?:^|\/)(workspace\/results\/|walk_forward_results|walk-forward-results|wfa-results|results\/)/i
];

export function isRetrievalSafeArtifactPath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return false;
  const normalized = filePath.trim().replace(/\\/g, "/");
  if (isSandboxRelativePath(normalized)) return false;
  if (DIAGNOSTIC_ARTIFACT_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return SAFE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function sanitizeRetrievalArtifactPaths(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => isRetrievalSafeArtifactPath(value)))];
}

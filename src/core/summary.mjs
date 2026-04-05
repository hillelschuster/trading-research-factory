function lessonText(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    return item.lesson || item.specific_finding || item.summary || JSON.stringify(item);
  }
  return String(item ?? "");
}

function actionText(item) {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    return item.action || item.rationale || JSON.stringify(item);
  }
  return String(item ?? "");
}

export function buildRunSummary({ runId, mode, backlogItem, plan, executionResult, evaluation, summary }) {
  return [
    `# Run ${runId}`,
    "",
    `- Mode: ${mode}`,
    `- Backlog item: ${backlogItem?.id ?? "n/a"}`,
    `- Experiment: ${plan.experiment_id}`,
    `- Evaluation verdict: ${evaluation.verdict}`,
    `- Evidence score: ${evaluation.evidence_score}`,
    "",
    "## Objective",
    plan.objective,
    "",
    "## Execution status",
    executionResult.status,
    "",
    "## Summary",
    summary.summary,
    "",
    "## Key lessons",
    ...(summary.key_lessons || []).map((item) => `- ${lessonText(item)}`),
    "",
    "## Next actions",
    ...(summary.next_actions || []).map((item) => `- ${actionText(item)}`),
    "",
    "## Missing evidence",
    ...(evaluation.missing_evidence || []).map((item) => `- ${item}`)
  ].join("\n");
}

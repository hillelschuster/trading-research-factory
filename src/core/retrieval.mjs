import { sanitizeRetrievalArtifactPaths } from "./retrieval-artifacts.mjs";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "under", "only", "than",
  "then", "they", "them", "their", "have", "has", "had", "was", "were", "are", "but", "not",
  "too", "very", "can", "will", "would", "should", "could", "about", "after", "before", "across",
  "using", "used", "use", "via", "per", "run", "runs", "real", "wfa", "data", "strategy", "test",
  "research", "market", "markets", "timeframe", "history", "need", "needs", "why", "what", "when",
  "where", "which", "your", "through", "same", "more", "less", "high", "low", "new",
  "old", "best", "good", "bad", "still", "just", "also", "exact", "make"
]);

const POSITIVE_VERDICTS = new Set(["promising", "promising_with_caveats", "passed", "success"]);
const NEGATIVE_VERDICTS = new Set(["rejected", "blocked", "failed", "inconclusive", "partial"]);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(values.flat().filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function compactText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function overlapScore(queryTokens, text) {
  if (!queryTokens.length || !text) return 0;
  const recordTokens = new Set(tokenize(text));
  let matches = 0;
  for (const token of queryTokens) {
    if (recordTokens.has(token)) matches += 1;
  }
  return matches;
}

function buildQuery(parts, scope = {}) {
  const text = uniqueStrings(parts).join(" ");
  return {
    text,
    tokens: tokenize(text),
    market_family: scope.market_family || null,
    asset_scope: scope.asset_scope || null,
    timeframe: scope.timeframe || null,
    strategy_family: scope.strategy_family || null
  };
}

function isLive(entry) {
  return entry?.mode === "live";
}

function getRetrievalEntries(factoryStats, { sourceType, liveOnly = false } = {}) {
  return safeArray(factoryStats?.retrievalIndex)
    .filter((entry) => !sourceType || entry?.source_type === sourceType)
    .filter((entry) => !liveOnly || isLive(entry));
}

function lessonSnippet(entry) {
  return {
    source_path: entry?.source_path ?? "factory/memory/lessons.jsonl",
    experiment_id: entry?.experiment_id ?? null,
    verdict: entry?.verdict ?? null,
    mode: entry?.mode ?? null,
    market_family: entry?.market_family ?? null,
    asset_scope: entry?.asset_scope ?? null,
    timeframe: entry?.timeframe ?? null,
    strategy_family: entry?.strategy_family ?? null,
    lesson: compactText(entry?.snippet?.lesson || entry?.retrieval_text || entry?.experiment_id || "No lesson text recorded"),
    specific_finding: entry?.snippet?.specific_finding ?? null,
    metrics: entry?.snippet?.metrics ?? null,
    related_artifact_paths: sanitizeRetrievalArtifactPaths(safeArray(entry?.related_artifact_paths))
  };
}

function evidenceSnippet(entry) {
  return {
    source_path: entry?.source_path ?? "factory/evidence/index.json",
    run_id: entry?.run_id ?? null,
    experiment_id: entry?.experiment_id ?? null,
    verdict: entry?.verdict ?? null,
    evidence_score: entry?.evidence_score ?? null,
    market_family: entry?.market_family ?? entry?.snippet?.market_family ?? null,
    asset_scope: entry?.asset_scope ?? entry?.snippet?.asset_scope ?? null,
    timeframe: entry?.timeframe ?? entry?.snippet?.timeframe ?? null,
    strategy_family: entry?.strategy_family ?? entry?.snippet?.strategy_family ?? null,
    metrics: entry?.snippet?.metrics ?? null,
    summary_path: entry?.snippet?.summary_path ?? null,
    evidence_kind: entry?.snippet?.evidence_kind ?? null,
    promotable: entry?.snippet?.promotable ?? false
  };
}

function researchHypothesisSnippet(entry) {
  return {
    source_path: entry?.source_path ?? null,
    artifact_sha256: entry?.artifact_sha256 ?? null,
    hypothesis_id: entry?.snippet?.hypothesis_id ?? null,
    mechanism: compactText(entry?.snippet?.mechanism || entry?.retrieval_text, 220),
    falsifiable_prediction: compactText(entry?.snippet?.falsifiable_prediction, 220),
    strategy_family: entry?.snippet?.strategy_family ?? entry?.strategy_family ?? null,
    instrument_scope: entry?.snippet?.instrument_scope ?? entry?.asset_scope ?? null,
    timeframe_candidate: entry?.snippet?.timeframe_candidate ?? entry?.timeframe ?? null,
    source_records: safeArray(entry?.snippet?.source_records).slice(0, 5),
    phase8a_universe_constraints: entry?.snippet?.phase8a_universe_constraints ?? null,
    related_artifact_paths: sanitizeRetrievalArtifactPaths(safeArray(entry?.related_artifact_paths))
  };
}

function researchSourceSnippet(entry) {
  return {
    source_path: entry?.source_path ?? null,
    artifact_sha256: entry?.artifact_sha256 ?? null,
    source_id: entry?.snippet?.source_id ?? null,
    source_type: entry?.snippet?.source_type ?? null,
    trust_tier: entry?.snippet?.trust_tier ?? null,
    claims_extracted: safeArray(entry?.snippet?.claims_extracted).slice(0, 3),
    limitations: safeArray(entry?.snippet?.limitations).slice(0, 3),
    disconfirming_relevance: safeArray(entry?.snippet?.disconfirming_relevance).slice(0, 3)
  };
}

function numericEvidenceQuality(entry) {
  return typeof entry?.evidence_score === "number" ? entry.evidence_score / 20 : 0;
}

function stageRelevance(entry, stage) {
  return safeArray(entry?.stage_targets).includes(stage) ? 5 : 0;
}

function recencyScore(index, total) {
  return total > 0 ? ((total - index) / total) * 2 : 0;
}

function contradictionValue(entry, targetVerdict) {
  if (!targetVerdict || !entry?.verdict) return 0;
  const targetPositive = POSITIVE_VERDICTS.has(targetVerdict);
  const entryPositive = POSITIVE_VERDICTS.has(entry.verdict);
  const entryNegative = NEGATIVE_VERDICTS.has(entry.verdict);
  if ((targetPositive && entryNegative) || (!targetPositive && entryPositive)) return 4;
  return 0;
}

function explicitFeatureScore(entry, query, { stage, contradictionTargetVerdict = null } = {}, index, total) {
  const features = {
    stage_relevance: stageRelevance(entry, stage),
    lexical_overlap: overlapScore(query.tokens, entry?.retrieval_text) * 2,
    market_match: query.market_family && entry?.market_family === query.market_family ? 5 : 0,
    asset_match: query.asset_scope && entry?.asset_scope === query.asset_scope ? 6 : 0,
    timeframe_match: query.timeframe && entry?.timeframe === query.timeframe ? 4 : 0,
    strategy_match: query.strategy_family && entry?.strategy_family === query.strategy_family ? 5 : 0,
    evidence_quality: numericEvidenceQuality(entry),
    recency: recencyScore(index, total),
    contradiction_value: contradictionValue(entry, contradictionTargetVerdict)
  };

  return {
    entry,
    score: Object.values(features).reduce((sum, value) => sum + value, 0),
    features
  };
}

function scoreEntries(entries, query, options = {}) {
  return entries
    .map((entry, index, all) => explicitFeatureScore(entry, query, options, index, all.length))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function buildIdeatorRetrieval(factoryStats) {
  const liveLessons = getRetrievalEntries(factoryStats, { sourceType: "lesson", liveOnly: true })
    .filter((entry) => safeArray(entry?.stage_targets).includes("ideator"));
  const liveEvidence = getRetrievalEntries(factoryStats, { sourceType: "evidence", liveOnly: true })
    .filter((entry) => entry?.snippet?.promotable)
    .sort((a, b) => (b.evidence_score ?? 0) - (a.evidence_score ?? 0));
  const hypothesisPackets = getRetrievalEntries(factoryStats, { sourceType: "research_hypothesis_packet" })
    .filter((entry) => safeArray(entry?.stage_targets).includes("ideator"));
  const sourceRecords = getRetrievalEntries(factoryStats, { sourceType: "research_source_record" })
    .filter((entry) => safeArray(entry?.stage_targets).includes("ideator"));

  return {
    recent_live_lessons: liveLessons.slice(0, 3).map(lessonSnippet),
    blocker_patterns: liveLessons.filter((entry) => NEGATIVE_VERDICTS.has(entry?.verdict)).slice(0, 2).map(lessonSnippet),
    comparable_promoted_runs: liveEvidence.slice(0, 2).map(evidenceSnippet),
    stage0_hypothesis_packets: hypothesisPackets.slice(0, 3).map(researchHypothesisSnippet),
    stage0_source_records: sourceRecords.slice(0, 3).map(researchSourceSnippet)
  };
}

export function buildPlannerRetrieval(factoryStats, backlogItem) {
  const query = buildQuery([
    backlogItem?.title,
    backlogItem?.objective,
    backlogItem?.category,
    backlogItem?.market_family,
    backlogItem?.instrument_scope,
    backlogItem?.timeframe,
    backlogItem?.history_requirement,
    backlogItem?.data_source,
    backlogItem?.data_requirement
  ], {
    market_family: backlogItem?.market_family,
    asset_scope: backlogItem?.instrument_scope,
    timeframe: backlogItem?.timeframe,
    strategy_family: backlogItem?.category
  });

  const lessonEntries = getRetrievalEntries(factoryStats, { sourceType: "lesson", liveOnly: true });
  const evidenceEntries = getRetrievalEntries(factoryStats, { sourceType: "evidence", liveOnly: true }).filter((entry) => entry?.snippet?.promotable);
  const hypothesisEntries = getRetrievalEntries(factoryStats, { sourceType: "research_hypothesis_packet" });

  const scoredLessons = scoreEntries(lessonEntries, query, { stage: "planner" });
  const relevantLessons = scoredLessons.slice(0, 4).map((item) => lessonSnippet(item.entry));
  const comparableRuns = scoreEntries(evidenceEntries, query, { stage: "planner" }).slice(0, 2).map((item) => evidenceSnippet(item.entry));
  const relevantHypotheses = scoreEntries(hypothesisEntries, query, { stage: "planner" }).slice(0, 3).map((item) => researchHypothesisSnippet(item.entry));
  const positive = scoredLessons.find((item) => POSITIVE_VERDICTS.has(item.entry?.verdict));
  const negative = scoreEntries(lessonEntries, query, {
    stage: "planner",
    contradictionTargetVerdict: positive?.entry?.verdict || "passed"
  }).find((item) => NEGATIVE_VERDICTS.has(item.entry?.verdict) && item.entry?.experiment_id !== positive?.entry?.experiment_id);

  return {
    relevant_lessons: relevantLessons,
    contradiction: positive && negative ? { positive: lessonSnippet(positive.entry), negative: lessonSnippet(negative.entry) } : null,
    comparable_promoted_runs: comparableRuns,
    stage0_hypothesis_packets: relevantHypotheses
  };
}

export function buildExecutorRetrieval(factoryStats, plan) {
  const query = buildQuery([
    plan?.title,
    plan?.objective,
    plan?.hypothesis,
    plan?.strategy_type,
    plan?.market_family,
    plan?.instrument_scope,
    plan?.timeframe,
    safeArray(plan?.dataset_requirements).join(" "),
    safeArray(plan?.inputs).join(" "),
    safeArray(plan?.commands).join(" "),
    safeArray(plan?.expected_artifacts).join(" "),
    safeArray(plan?.data_acquisition?.sources).join(" "),
    safeArray(plan?.data_acquisition?.expected_outputs).join(" ")
  ], {
    market_family: plan?.market_family,
    asset_scope: plan?.instrument_scope,
    timeframe: plan?.timeframe,
    strategy_family: plan?.strategy_type
  });

  const lessonEntries = getRetrievalEntries(factoryStats, { sourceType: "lesson", liveOnly: true });
  const scoredLessons = scoreEntries(lessonEntries, query, { stage: "executor" })
    .map((item) => ({
      ...item,
      score: item.score + (NEGATIVE_VERDICTS.has(item.entry?.verdict) ? 4 : 0) + (/pandas|numpy|config|dataset|ohlcv|fetch|timeout|wfa/i.test(item.entry?.retrieval_text || "") ? 3 : 0)
    }))
    .sort((a, b) => b.score - a.score);

  const relevantExecutionLessons = scoredLessons.slice(0, 2).map((item) => lessonSnippet(item.entry));
  const knownBlockerPatterns = lessonEntries
    .filter((entry) => NEGATIVE_VERDICTS.has(entry?.verdict))
    .map((entry) => {
      const text = entry?.retrieval_text || "";
      let blocker_type = "general_execution";
      if (/pandas|numpy|environment|venv/i.test(text)) blocker_type = "python_environment";
      else if (/fetch failed|timeout|headers timeout|transport/i.test(text)) blocker_type = "agent_transport";
      else if (/config|yaml|min_required_bars|loader/i.test(text)) blocker_type = "config_contract";
      else if (/dataset|ohlcv|column|schema/i.test(text)) blocker_type = "data_contract";
      return {
        blocker_type,
        source_path: entry?.source_path ?? "factory/memory/lessons.jsonl",
        experiment_id: entry?.experiment_id ?? null,
        lesson: compactText(entry?.snippet?.lesson || entry?.retrieval_text || entry?.experiment_id || "Execution blocker")
      };
    })
    .filter((item, index, all) => all.findIndex((other) => other.blocker_type === item.blocker_type) === index)
    .slice(0, 2);

  const relevantPaths = sanitizeRetrievalArtifactPaths(
    uniqueStrings(relevantExecutionLessons.map((item) => item.related_artifact_paths || []).flat())
  ).slice(0, 4);

  return {
    relevant_execution_lessons: relevantExecutionLessons,
    known_blocker_patterns: knownBlockerPatterns,
    relevant_paths: relevantPaths
  };
}

export function buildEvaluatorRetrieval(factoryStats, plan) {
  const query = buildQuery([
    plan?.title,
    plan?.objective,
    plan?.hypothesis,
    plan?.strategy_type,
    plan?.market_family,
    plan?.instrument_scope,
    plan?.timeframe,
    safeArray(plan?.dataset_requirements).join(" ")
  ], {
    market_family: plan?.market_family,
    asset_scope: plan?.instrument_scope,
    timeframe: plan?.timeframe,
    strategy_family: plan?.strategy_type
  });

  return {
    comparable_prior_experiments: scoreEntries(
      getRetrievalEntries(factoryStats, { sourceType: "evidence", liveOnly: true }),
      query,
      { stage: "evaluator" }
    )
      .filter((item) => item.entry?.experiment_id !== plan?.experiment_id)
      .slice(0, 2)
      .map((item) => evidenceSnippet(item.entry))
  };
}

export function buildSummarizerRetrieval(factoryStats, plan, evaluation) {
  const query = buildQuery([
    plan?.title,
    plan?.objective,
    plan?.hypothesis,
    plan?.strategy_type,
    plan?.market_family,
    plan?.instrument_scope,
    plan?.timeframe,
    evaluation?.verdict
  ], {
    market_family: plan?.market_family,
    asset_scope: plan?.instrument_scope,
    timeframe: plan?.timeframe,
    strategy_family: plan?.strategy_type
  });

  return {
    comparable_prior_lessons: scoreEntries(
      getRetrievalEntries(factoryStats, { sourceType: "lesson", liveOnly: true }),
      query,
      { stage: "summarizer", contradictionTargetVerdict: evaluation?.verdict }
    )
      .filter((item) => item.entry?.experiment_id !== plan?.experiment_id)
      .filter((item) => Boolean(evaluation?.verdict && item.entry?.verdict && item.entry.verdict !== evaluation.verdict))
      .slice(0, 2)
      .map((item) => ({
        ...lessonSnippet(item.entry),
        contradiction: true
      }))
  };
}

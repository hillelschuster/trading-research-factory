import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (typeof repoRelativePath !== "string" || repoRelativePath.trim().length === 0 || path.isAbsolute(repoRelativePath)) {
    throw new Error(`YouTube ingest ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`YouTube ingest ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "youtube-video";
}

function artifactRef(rootDir, fullPath) {
  return {
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath)
  };
}

function writeJson(rootDir, repoPath, value) {
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "output_path");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return artifactRef(rootDir, fullPath);
}

function writeText(rootDir, repoPath, value) {
  const fullPath = resolveRepoRelativePath(rootDir, repoPath, "output_path");
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return artifactRef(rootDir, fullPath);
}

function parseVideoId(input) {
  if (typeof input.video_id === "string" && input.video_id.trim()) return input.video_id.trim();
  if (typeof input.url !== "string") throw new Error("inspect_youtube_video requires video_id or url");
  const parsed = new URL(input.url);
  const id = parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop();
  if (!id) throw new Error(`Could not parse YouTube video id from ${input.url}`);
  return id;
}

function normalizeSegments(videoId, input) {
  const segments = Array.isArray(input.transcript_segments) ? input.transcript_segments : [];
  return segments.map((segment, index) => {
    const start = Number(segment.start_sec ?? segment.start ?? 0);
    const end = Number(segment.end_sec ?? segment.end ?? start + Number(segment.duration_sec ?? segment.duration ?? 0));
    const text = String(segment.text ?? "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || text.length < 3) {
      throw new Error(`Invalid transcript segment ${index} for YouTube video ${videoId}`);
    }
    return {
      segment_id: `seg_${String(index + 1).padStart(6, "0")}`,
      video_id: videoId,
      start_sec: start,
      end_sec: end,
      text,
      hash: sha256Text(text)
    };
  });
}

function chunkSegments(videoId, segments, provider, sourceRisk) {
  return segments.map((segment, index) => ({
    chunk_id: `yt_${sanitizePathPart(videoId)}_${String(index + 1).padStart(4, "0")}`,
    video_id: videoId,
    start_sec: segment.start_sec,
    end_sec: segment.end_sec,
    timestamp_url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(segment.start_sec)}s`,
    text: segment.text,
    text_hash: segment.hash,
    token_estimate: Math.ceil(segment.text.length / 4),
    source_provider: provider,
    source_risk: sourceRisk
  }));
}

export function youtubeIngest({
  rootDir = process.cwd(),
  outputDir,
  input = {},
  observedAt = new Date().toISOString()
} = {}) {
  const root = path.resolve(rootDir);
  if (!outputDir) throw new Error("youtube_ingest outputDir is required");
  const videoId = parseVideoId(input);
  const videoDir = `${outputDir}/${sanitizePathPart(videoId)}`;
  resolveRepoRelativePath(root, videoDir, "output_dir");

  const metadata = {
    source_type: "youtube_video",
    video_id: videoId,
    url: input.url ?? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    title: input.metadata?.title ?? input.title ?? null,
    channel_id: input.metadata?.channel_id ?? null,
    channel_title: input.metadata?.channel_title ?? input.channel_title ?? null,
    published_at: input.metadata?.published_at ?? null,
    duration_sec: input.metadata?.duration_sec ?? input.duration_sec ?? null,
    description_hash: input.metadata?.description || input.description ? sha256Text(input.metadata?.description ?? input.description) : null,
    metadata_provider: input.metadata_provider ?? "fixture_or_metadata_stub",
    fetched_at: observedAt
  };

  const metadataRef = writeJson(root, `${videoDir}/video_metadata.json`, metadata);
  const segments = normalizeSegments(videoId, input);
  const hasTranscript = segments.length > 0;
  const provider = hasTranscript ? (input.transcript_provider ?? "fixture_transcript") : "transcript_unavailable";
  const sourceRisk = hasTranscript ? (input.source_risk ?? "low") : "unavailable";
  const adapterAttempts = [
    { name: "youtube_data_api_metadata", status: "stubbed_or_fixture_metadata" },
    { name: "official_captions", status: "skipped", reason: "not_authorized_or_not_available_in_first_slice" }
  ];

  if (hasTranscript) {
    adapterAttempts.push({ name: provider, status: "success", source_risk: sourceRisk });
  } else {
    adapterAttempts.push({ name: "youtube_transcript_api", status: "skipped", reason: "no_fake_transcript_fixture_supplied" });
    adapterAttempts.push({ name: "yt_dlp_subtitles", status: "skipped", reason: "disabled_in_first_slice" });
    adapterAttempts.push({
      name: "audio_transcription",
      status: input.allow_audio_transcription === true ? "not_implemented_in_first_slice" : "disabled",
      reason: input.allow_audio_transcription === true ? "live audio transcription intentionally not implemented" : "audio transcription disabled by default"
    });
  }

  const rawTranscript = hasTranscript ? {
    video_id: videoId,
    transcript_provider: provider,
    provider_type: input.provider_type ?? "fixture_or_unofficial_public_transcript",
    source_risk: sourceRisk,
    segments: input.transcript_segments
  } : null;
  const rawRef = hasTranscript ? writeJson(root, `${videoDir}/transcript_raw.json`, rawTranscript) : null;
  const normalized = {
    video_id: videoId,
    transcript_status: hasTranscript ? "available" : "transcript_unavailable",
    transcript_provider: provider,
    provider_type: hasTranscript ? (input.provider_type ?? "fixture_or_unofficial_public_transcript") : "unavailable",
    language: input.language ?? "en",
    original_language: input.original_language ?? input.language ?? "en",
    is_generated: input.is_generated === true,
    is_translated: input.is_translated === true,
    source_risk: sourceRisk,
    segments,
    raw_transcript_hash: rawRef?.sha256 ?? null,
    transcript_unavailable_reason: hasTranscript ? null : (input.transcript_unavailable_reason ?? "no transcript fixture supplied and audio transcription disabled")
  };
  const normalizedRef = writeJson(root, `${videoDir}/transcript_normalized.json`, normalized);
  const chunks = hasTranscript ? chunkSegments(videoId, segments, provider, sourceRisk) : [];
  const chunksRef = writeText(root, `${videoDir}/chunks.jsonl`, chunks.map((chunk) => JSON.stringify(chunk)).join("\n"));

  const report = {
    video_id: videoId,
    status: hasTranscript ? "success" : "transcript_unavailable",
    metadata_status: "success",
    transcript_status: hasTranscript ? "available" : "transcript_unavailable",
    adapters_attempted: adapterAttempts,
    audio_transcription_used: false,
    researchbrain_allowed: hasTranscript,
    llm_content_policy: {
      may_use_title_description_only: false,
      must_cite_chunk_ids: true,
      profitability_claims_allowed: false
    },
    limitations: [
      "First implementation slice uses deterministic fixtures/stubs only; no live YouTube network calls.",
      hasTranscript ? "Timestamped chunks are required for any video-content claim." : "No transcript chunks exist; video content cannot support a hypothesis."
    ],
    artifact_hashes: {
      metadata: metadataRef.sha256,
      transcript_raw: rawRef?.sha256 ?? null,
      transcript_normalized: normalizedRef.sha256,
      chunks: chunksRef.sha256
    }
  };
  const reportRef = writeJson(root, `${videoDir}/ingestion_report.json`, report);
  const manifest = {
    schema_version: "researchbrain_youtube_ingest_manifest_v1",
    video_id: videoId,
    generated_at: observedAt,
    status: report.status,
    researchbrain_allowed: report.researchbrain_allowed,
    transcript_status: report.transcript_status,
    transcript_provider: provider,
    source_risk: sourceRisk,
    artifacts: {
      video_metadata: metadataRef,
      transcript_raw: rawRef,
      transcript_normalized: normalizedRef,
      chunks: chunksRef,
      ingestion_report: reportRef
    },
    chunk_ids: chunks.map((chunk) => chunk.chunk_id),
    limitations: report.limitations
  };
  const sourceManifestRef = writeJson(root, `${videoDir}/source_manifest.json`, manifest);
  const artifactManifestRef = writeJson(root, `${videoDir}/artifact_manifest.json`, {
    ...manifest,
    artifacts: {
      ...manifest.artifacts,
      source_manifest: sourceManifestRef
    }
  });

  return {
    video_id: videoId,
    status: report.status,
    researchbrain_allowed: report.researchbrain_allowed,
    transcript_status: report.transcript_status,
    transcript_provider: provider,
    source_risk: sourceRisk,
    chunks,
    chunk_ids: chunks.map((chunk) => chunk.chunk_id),
    metadata,
    report,
    artifacts: {
      video_metadata: metadataRef,
      transcript_raw: rawRef,
      transcript_normalized: normalizedRef,
      chunks: chunksRef,
      ingestion_report: reportRef,
      source_manifest: sourceManifestRef,
      artifact_manifest: artifactManifestRef
    }
  };
}

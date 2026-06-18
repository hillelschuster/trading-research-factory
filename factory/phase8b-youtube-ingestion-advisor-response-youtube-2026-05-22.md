# Phase 8B — YouTube Ingestion Advisor Response

**Date:** 2026-05-22  
**Filename:** `phase8b-youtube-ingestion-advisor-response-youtube-2026-05-22.md`  
**Context source:** User-provided prompt / uploaded requirements document in the conversation.  
**Web source basis used in the original answer:** YouTube Data API documentation, YouTube API quota documentation, YouTube Terms, `youtube-transcript-api` project documentation, and `yt-dlp` documentation.

---

## Executive verdict

The proposed architecture is **directionally correct**: metadata first, transcript-first ingestion, timestamped chunks, immutable artifacts, hashes, and “no transcript = no content claims.” That is the right design for a trading research factory because YouTube content should feed only **Stage-0 hypothesis generation**, not profitability claims or deterministic strategy promotion.

The main correction: **do not rely on the official YouTube Captions API as the main path for arbitrary public videos.** YouTube Data API is good for official metadata; `videos.list` returns video metadata and costs 1 quota unit, while projects get a default 10,000 units/day quota. But transcript/caption access is much more constrained; the official captions path is not a general public transcript ingestion API for any video.

The practical design should be:

1. **Official metadata via YouTube Data API.**
2. **Transcript retrieval via layered adapters**, clearly labeled by source/risk:
   - official/authorized captions when available,
   - `youtube-transcript-api` for public transcript extraction,
   - `yt-dlp` subtitle extraction as fallback,
   - audio transcription only when explicitly enabled.
3. **ResearchBrain consumes only normalized artifacts**, never raw YouTube pages or title/description alone.
4. **Every extracted claim must cite timestamped chunks.**

That gives maximum practical coverage while keeping legal, reproducibility, and hallucination risk visible.

---

## Recommended architecture

### 1. `youtube_ingest` should be a deterministic CLI wrapper

Use a dedicated local CLI tool, not loose agent browsing. The agent should call one command and receive deterministic JSON.

Example interface:

```bash
youtube_ingest \
  --url "https://www.youtube.com/watch?v=VIDEO_ID" \
  --out factory/artifacts/youtube/VIDEO_ID \
  --langs en,he \
  --max-duration-sec 14400 \
  --allow-unofficial-transcripts true \
  --allow-audio-transcription false \
  --audio-mode ephemeral \
  --force false
```

### 2. Ingestion pipeline

```text
URL/search result
  ↓
extract video_id
  ↓
official metadata fetch
  ↓
duration/license/status validation
  ↓
transcript adapter chain
  ↓
normalize transcript
  ↓
chunk by timestamp/token budget
  ↓
hash artifacts
  ↓
write ingestion_report.json
  ↓
ResearchBrain reads only artifacts
```

### 3. Transcript adapter priority

Use this order:

```text
A. Official captions API, only when authorized / owned / available
B. youtube-transcript-api
C. yt-dlp subtitles only, no video/audio download
D. Optional audio transcription, disabled by default
E. Fail closed: transcript_unavailable
```

`youtube-transcript-api` can retrieve transcripts/subtitles, including auto-generated subtitles, supports translation, and does not require an API key or headless browser. Its own README warns that it uses an undocumented YouTube web-client API and may stop working if YouTube changes behavior.

`yt-dlp` supports writing manual subtitles, auto-generated subtitles, listing available subtitles, choosing subtitle formats, and choosing subtitle languages. That makes it a strong operational fallback for subtitle extraction, but it should still be treated as unofficial access.

---

## Tool comparison

| Option | Best use | Strength | Weakness | Legal/ToS risk | Verdict |
|---|---:|---|---|---|---|
| **YouTube Data API `videos.list`** | Metadata | Official, stable, low quota cost | No full transcript for arbitrary public videos | Low | Use always |
| **YouTube Data API search** | Discover videos | Official | `search.list` is quota-expensive at 100 units/request | Low | Use only when needed |
| **Official Captions API** | Authorized/owned captions | Official | Not a general solution for arbitrary public videos | Low if authorized | Use when available, not as main path |
| **youtube-transcript-api** | Public transcript extraction | Fast, simple, Python-native, returns timestamped snippets | Undocumented YouTube web-client behavior; may break | Medium | Best practical MVP transcript adapter |
| **yt-dlp subtitles** | Robust subtitle fallback | Mature CLI; supports manual/auto subtitles/language selection | Unofficial; heavier dependency | Medium/high | Use as fallback, subtitles only |
| **Browser automation** | Last-resort scraping | Can mimic UI | Brittle, slow, higher ToS risk, hard to reproduce | High | Avoid |
| **Audio transcription** | Videos with no captions | Highest content coverage | Requires audio access/download/streaming; cost; legal sensitivity | Medium/high | Opt-in only |
| **Commercial STT APIs** | Scalable transcription | Good quality, diarization/options depending provider | Cost, privacy/data handling | Medium | Later extension |
| **Local Whisper/faster-whisper** | Private offline transcription | No external STT vendor | Needs compute; still needs audio source | Medium | Later extension |

Quota note: YouTube Data API default quota is 10,000 units/day; `videos.list` costs 1 unit, `search.list` costs 100 units, and `captions.list` costs 50 units.

---

## Legal / ToS risk summary

I cannot verify legal safety or give legal advice. The practical compliance posture should be conservative.

The safer boundary is:

```text
Allowed by default:
- official metadata via YouTube Data API
- transcript/caption text when obtained through authorized/available caption paths
- cached text artifacts with provenance and hashes

Disabled by default:
- downloading video
- downloading audio
- browser automation
- bypassing login, age gates, geo blocks, paywalls, private videos, or anti-bot controls
```

YouTube’s Terms restrict automated access and downloading content unless YouTube provides a permission mechanism or the user has permission.

So the accurate risk label is:

```text
Official metadata: low risk
Official authorized captions: low risk
youtube-transcript-api: practical but unofficial; medium risk
yt-dlp subtitle extraction: practical but unofficial; medium/high risk
audio/video download: higher risk; opt-in only
browser scraping: highest risk; avoid
```

Do not call unofficial transcript extraction “safe.” Call it **best-effort public transcript retrieval with explicit risk labeling**.

---

## Artifact schema

Use immutable, content-addressed artifacts. Minimum set:

```text
video_metadata.json
transcript_raw.json
transcript_normalized.json
chunks.jsonl
ingestion_report.json
source_manifest.json
```

### `video_metadata.json`

```json
{
  "source_type": "youtube_video",
  "video_id": "abc123",
  "url": "https://www.youtube.com/watch?v=abc123",
  "title": "...",
  "channel_id": "...",
  "channel_title": "...",
  "published_at": "2026-05-01T00:00:00Z",
  "duration_sec": 3720,
  "description_hash": "sha256:...",
  "metadata_provider": "youtube_data_api",
  "fetched_at": "2026-05-22T00:00:00Z"
}
```

### `transcript_normalized.json`

```json
{
  "video_id": "abc123",
  "transcript_status": "available",
  "transcript_provider": "youtube_transcript_api",
  "provider_type": "unofficial_public_transcript",
  "language": "en",
  "is_generated": true,
  "is_translated": false,
  "source_risk": "medium",
  "segments": [
    {
      "segment_id": "seg_000001",
      "start_sec": 12.4,
      "end_sec": 18.9,
      "text": "The strategy uses ATR to place the stop loss...",
      "hash": "sha256:..."
    }
  ],
  "raw_transcript_hash": "sha256:..."
}
```

### `chunks.jsonl`

Each chunk should be line-delimited JSON:

```json
{
  "chunk_id": "yt_abc123_0004",
  "video_id": "abc123",
  "start_sec": 480.0,
  "end_sec": 720.0,
  "timestamp_url": "https://www.youtube.com/watch?v=abc123&t=480s",
  "text": "...",
  "text_hash": "sha256:...",
  "token_estimate": 1180,
  "source_provider": "youtube_transcript_api",
  "source_risk": "medium"
}
```

### `ingestion_report.json`

```json
{
  "video_id": "abc123",
  "status": "success",
  "metadata_status": "success",
  "transcript_status": "available",
  "adapters_attempted": [
    {
      "name": "official_captions",
      "status": "skipped",
      "reason": "not_authorized_or_not_available"
    },
    {
      "name": "youtube_transcript_api",
      "status": "success"
    }
  ],
  "audio_transcription_used": false,
  "researchbrain_allowed": true,
  "llm_content_policy": {
    "may_use_title_description_only": false,
    "must_cite_chunk_ids": true,
    "profitability_claims_allowed": false
  },
  "artifact_hashes": {
    "metadata": "sha256:...",
    "transcript_normalized": "sha256:...",
    "chunks": "sha256:..."
  }
}
```

---

## Anti-hallucination rules for ResearchBrain

ResearchBrain must enforce this contract:

```text
1. No transcript/chunks → no video-content claims.
2. Title/description may only be used for discovery, not content extraction.
3. Every extracted idea must cite chunk_id + timestamp_url.
4. Every strategy hypothesis must be labeled Stage-0.
5. No claim may say “profitable,” “validated,” “edge,” or “works” unless deterministic backtest/WFA workers later prove it.
6. If the transcript is auto-generated, translated, incomplete, or unofficial, ResearchBrain must lower confidence and record that limitation.
```

Example ResearchBrain output shape:

```json
{
  "hypothesis_id": "HYP-YT-abc123-001",
  "claim": "The speaker describes an ATR-based stop-loss method for intraday futures trading.",
  "evidence": [
    {
      "chunk_id": "yt_abc123_0004",
      "timestamp_url": "https://www.youtube.com/watch?v=abc123&t=480s",
      "quote_hash": "sha256:..."
    }
  ],
  "asset_scope": ["futures", "indices", "crypto"],
  "stage": "stage_0_unvalidated",
  "confidence": "medium",
  "limitations": [
    "auto-generated transcript",
    "not backtested",
    "not verified against broker constraints"
  ]
}
```

---

## Handling long videos

Use two limits:

```text
hard_max_duration_sec
hard_max_tokens_per_video
```

Recommended MVP defaults:

```json
{
  "max_duration_sec": 14400,
  "chunk_duration_sec": 180,
  "chunk_token_target": 1000,
  "chunk_token_max": 1600,
  "max_chunks": 120
}
```

For long videos, do **not** send the whole transcript to the LLM. Store the full transcript, embed/index the chunks, and retrieve relevant chunks only.

---

## Multilingual and translated captions

Use this language priority:

```text
1. User-requested language, manual transcript
2. User-requested language, generated transcript
3. Original language, manual transcript
4. Original language, generated transcript
5. Translated transcript
6. Audio transcription, opt-in only
```

Always store:

```json
{
  "language": "en",
  "original_language": "he",
  "is_generated": true,
  "is_translated": true,
  "translation_provider": "youtube_transcript_api",
  "translation_warning": "machine translated captions may distort technical terminology"
}
```

`youtube-transcript-api` supports listing available transcripts, distinguishing generated/manual transcripts, and translating transcripts.

---

## Failure-mode test plan

Minimum test cases:

| Case | Expected behavior |
|---|---|
| Normal video with manual English transcript | success; `source_risk=low/medium` depending adapter |
| Video with auto-generated captions only | success; `is_generated=true`; confidence penalty |
| Video with no captions | `transcript_unavailable`; ResearchBrain blocked |
| Audio transcription disabled and no transcript | no content claims |
| Audio transcription enabled | transcript generated; `audio_transcription_used=true` |
| Private/deleted video | metadata/transcript failure; no ResearchBrain artifact |
| Age-restricted/geo-blocked video | fail closed; no bypass |
| Livestream or live chat | skip or mark unsupported |
| Very long video | chunk/index only; no full-context LLM call |
| Non-English transcript | language metadata preserved |
| Translated captions | `is_translated=true`; confidence penalty |
| Transcript adapter blocked/rate-limited | retry with backoff; then fallback |
| Duplicate URL | use existing cache by `video_id + adapter + lang + version` |
| Transcript text changes later | new hash/version; old artifact retained |
| Empty/malformed transcript | fail validation |
| LLM tries title-only inference | reject output |

---

## Concrete implementation steps

### Step 1 — Build the CLI wrapper

Create one tool boundary:

```text
youtube_ingest(input) -> artifact_manifest.json
```

Do not let the agent directly use `yt-dlp`, browser scraping, or raw transcript libraries. The wrapper owns all policy gates.

### Step 2 — Add adapters behind the wrapper

Adapter order:

```text
metadata_adapter_youtube_api
official_caption_adapter
youtube_transcript_api_adapter
ytdlp_subtitle_adapter
audio_transcription_adapter_disabled_by_default
```

The wrapper should produce the same artifact schema regardless of adapter.

### Step 3 — Add strict validation

Before ResearchBrain can consume the result:

```text
metadata exists
duration valid
transcript_status == available
chunks_count > 0
all chunks have timestamp_url
all chunks have hashes
source_risk recorded
adapter recorded
```

If any condition fails, set:

```json
{
  "researchbrain_allowed": false
}
```

### Step 4 — Add ResearchBrain evidence enforcement

ResearchBrain prompt/tool contract:

```text
You may only make claims from chunks.jsonl.
Every claim must cite chunk_id and timestamp_url.
Reject claims without evidence.
Do not infer from title, description, thumbnail, channel reputation, or comments.
```

### Step 5 — Add cache and reproducibility

Cache key:

```text
youtube:{video_id}:{language}:{adapter}:{adapter_version}:{translation_flag}
```

Hash:

```text
sha256(normalized_transcript_text)
sha256(chunks_jsonl)
sha256(metadata_json)
```

This lets later WFA/research workers know exactly what evidence produced a hypothesis.

---

## Final recommendation

For the trading research factory, the best MVP is:

```text
Official YouTube Data API metadata
+ youtube-transcript-api primary transcript adapter
+ yt-dlp subtitle fallback
+ no audio/video download by default
+ immutable timestamped chunk artifacts
+ ResearchBrain blocked unless transcript chunks exist
```

This is the highest practical coverage with acceptable engineering complexity. It is not legally perfect, because the best transcript coverage comes from unofficial tools. The safer version is to keep unofficial transcript adapters behind an explicit config flag and record `source_risk` in every artifact.

Advanced later:

```text
- local faster-whisper / WhisperX transcription
- commercial STT fallback
- embeddings + vector retrieval over transcript chunks
- channel-level ingestion
- playlist ingestion
- screenshot/frame extraction only for charts/slides, not default video parsing
- MCP wrapper around the same deterministic CLI
```

The strict design rule: **YouTube is an evidence source, not a truth source.** It may generate hypotheses. It must not validate alpha.

---

## Source references

- User-provided uploaded prompt: `Pasted text.txt` in the conversation.
- YouTube Data API `videos.list`: https://developers.google.com/youtube/v3/docs/videos/list
- YouTube Data API quota costs: https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube Terms: https://www.youtube.com/static?template=terms
- `youtube-transcript-api`: https://github.com/jdepoix/youtube-transcript-api
- `yt-dlp` documentation: https://github.com/yt-dlp/yt-dlp

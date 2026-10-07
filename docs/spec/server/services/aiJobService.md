# aiJobService Spec

Target-contract spec.

## 1. Overview

| Item              | Description                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role              | The AI enrichment pipeline: (a) fire-and-forget ENQUEUE hooks at content-commit seams, (b) a persistent-queue WORKER that executes per-kind role pipelines (`embed`, `features`, `caption`, `asr`, `backfill`), (c) budget-breaker consumption and degraded-flag bookkeeping. |
| DB-backed         | Queue truth is `ai_jobs` only (DB-backed; no new state in CacheAdapter). The worker is stateless: restart-safe via `recoverStaleRunning` + idempotent writes. Zero CacheAdapter/operationProgress imports (CODING_STYLE.md Express Patterns grep-gate).                       |
| Dependency stance | LLM is an ENRICHMENT dependency: unconfigured/failed role ⇒ jobs park/skip with degraded flags, never a user-facing error; existing vector math keeps working from DB data after un-configuring (no auto-backfill on model change — only an admin-launched re-embed).         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/ai/jobService.js` (enqueue API + worker loop)
- **Pipelines:** `server/domains/ai/pipelines/{embed,features,caption,asr}.js` (pure per-
  kind executors, unit-testable with a fake llmAdapter — adapter injection seam)
- **Test file:** `server/domains/ai/__tests__/aiJobService.test.js`

### 2.2 Enqueue hooks (content-commit seams)

`onNodeContentCommitted(nodeId)` — called fire-and-forget AFTER the domain TX COMMITS
(precedent: thumbnail invalidation `uploadService.js:181-187`) at exactly these points:

| Seam                  | Anchor                                                     |
| --------------------- | ---------------------------------------------------------- |
| S3 upload             | `server/service/uploadService.js` TX2 return (≈:73-88)     |
| WebDAV upload success | `server/domains/files/services/fileService.js` (≈:230-240) |
| Copy                  | `fileService.copyFile` success                             |
| Version restore       | `versionsService.restore` success                          |

The same commit points populate `filecache.content_hash` (column exists, null today —
`blobStorageService.js:66`); the hook receives the fresh hash.

Enqueue decision table (per node, at hook time):

| Node kind / config state                               | Kinds enqueued                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| text/document (pdf/docx/txt — local extractor applies) | `embed`, `features` (chat role present)                                                                  |
| image / video, `vision_chat` probed on                 | `caption` (on completion the caption pipeline chains `embed`)                                            |
| audio, `asr` probed on                                 | `asr` (on completion chains `embed`)                                                                     |
| media, capability absent                               | `embed` immediately (V0 `metadata_only` path — name/mime/path/date string, the zero-LLM floor for media) |
| directory nodes                                        | none                                                                                                     |

- **Idempotency:** `aiJobsStore.enqueue(nodeId, kind, generation, contentHash)` → ON
  CONFLICT `(node_id, kind, generation)` DO NOTHING returns `null` — crash retries,
  copies and restores NEVER re-pay. Content re-read at execution time via
  `blobStorageService.downloadBlob` (works on both backends; the upload buffer is not
  retained).
- **content_hash skip:** `embed` executor first runs the dedupe check
  (`embeddingsStore.get(node)`; same active `modelId` ∧ same `contentHash` ⇒
  `markSkipped`, no provider call — embeddingsStore §2.4; determinism within a model version is what makes the `(content_hash, modelId)` skip sufficient). For
  `features`/`caption`/`asr` the analogous skip is a prior `done` job of the same
  `(node, kind, generation)` whose stamped `content_hash` equals the current one
  (job-row comparison — those tables have no content_hash column; lineage
  columns record the model, the job row records the content).
- **generation:** per-kind integer (`embed|features|caption|asr` share one counter per
  kind), default 1, stored in settings (`AI_GEN_<KIND>`); admin model change / backfill
  launch increments the kind's generation and seeds `enqueueMany` over affected
  nodes with `kind='backfill'` drivers. UNIQUE is per-generation so fresh work is forced
  without colliding with history.
- The upload-hook path checks derived COLLECTION admission (definition evaluation)
  separately — that is collections domain, not this service; the only coupling is
  `touchMemberChange` on rule-admission.

### 2.3 Worker

`startAiWorker()` / `stopAiWorker()`; loop:

1. Test/ops seam: `WEA_SKIP_AI_WORKER` truthy ⇒ `startAiWorker` is a no-op (boot never
   schedules the loop; same idiom as `WEA_SKIP_BULK_WORKER`).
2. Startup once: `aiJobsStore.recoverStaleRunning(AI_JOB_STALE_MS)` (default 15 min —
   operational constant, not an AI profile value).
3. Loop: `claimNext()` (oldest claimable — `pending` or `failed` past `next_retry_at`);
   `null` ⇒ idle-sleep `AI_WORKER_POLL_MS` (default 5000, T2). Concurrency 1 per process
   (rate-limited enrichment; `AI_WORKER_CONCURRENCY` T2 default 1).
4. Before executing, check the role gate (order matters):

- Role unconfigured (llmAdapter `roleConfigured()` false) ⇒ that kind's jobs stay
  QUEUED, unconsumed: the worker claims via an ADDITIVE filter option
  `aiJobsStore.claimNext({ excludeKinds })` (predicate-level exclusion; the existing
  zero-arg `claimNext()` contract of aiJobsStore §2.3 is unchanged). This is how
  "pause never destroys queued work silently" holds with
  zero attempt inflation — backlog surfaces via `countByStatus`/`listFailed`.
- role budget breaker OPEN (per-role daily call/token cap hit) ⇒ same parking behavior;
  counters reset at day rollover; breaker state reported to the admin pipeline card.

5. Execute pipeline for the claimed kind (per-job timeout `AI_JOB_TIMEOUT_MS`, default
   120000 — operational): success ⇒ `markDone`; typed skip ⇒ `markSkipped(reason)`
   (content_hash dedupe, overlength `skip` policy note, unextractable text); any throw ⇒
   `markFailed(err)` ⇒ `attempt+1`, `next_retry_at = now + backoff(attempt)` =
   `min(30s · 2^(attempt−1), 30min)` (aiJobsStore §2.5), NO attempt cap — permanently
   failing jobs stay visible for retry/abandon in the admin table, never silently die.
6. A late `markDone` after a reap is a `{changes:0}` no-op (delayed worker logs+drops,
   never resurrects).
7. Running workers pick up new LLM config at the NEXT job (hot reconfiguration — config resolves per claim) — no
   in-job config caching beyond the claim.

### 2.4 Role pipelines

**`embed`:** input = locally extracted text (doc utilities; OCR-free:
media text arrives from caption/transcript). The input-budget ladder decides the call shape —
chunking: split at paragraph/heading boundaries first (char-window fallback) → uniform-
stride sample ≤ `LLM_CHUNK_BUDGET` (default 4) chunks → embed ALL sampled chunks →
`embeddingsChunkStore.replace` (chunk vectors retained; retrieval scores max-over-chunks)

- mean+renormalize → `embeddingsStore.upsert` pooled row with `source='chunk_pool'` →
  `vectorStore.upsert(node, vecs[], dim)` (pooled AND chunk half, one TX). Ladder tail:
  `truncate-head` (`source='head'`) → `metadata_only` (name/mime/path/date string,
  `source='metadata_only'`, weak-but-searchable — the V0 floor for media without
  capabilities) → `skip` (`markSkipped('overlength_skip')` + journal note). A length-class
  provider error mid-ladder degrades per §2.5, it never fails the job (overlength
  never fails a job).

**`features` (`features.extract`):** chat role; runs ONLY inside this job — never
on request paths. Input = extracted text clipped by the input-budget ladder + a
filename/mime/path/date metadata line. Fixed prompt template; output FORCED to JSON
schema `{tags:[{tag,confidence}], summary, category}`; ≤ small token budget; **reasoning
OFF** (`enable_thinking:false` via chat_template_kwargs
where supported — llmAdapter owns the kwarg). Written to `ai_features`
(`features_model_id`, `schema_version:1`, `truncated` flag from the ladder). Schema-parse
failure ⇒ `markFailed` (retried; provider flakiness is transient). Chat off ⇒ field
stays empty; downstream runs on local tags + vectors (the LLM-free fallback keeps every other pipeline working).

**`caption` (V2):** `vision_chat` role; local ffmpeg uniform-stride frame sampling
(≤4 frames, transient — frames never persisted); VLM captions in Korean; writes
`ai_features.caption` + `caption_model_id`; then CHAINS `enqueue(node,'embed',gen)`
(caption text is the embedding corpus for media). No `image_embed` path exists — every modality enters the same text embedding space.

**`asr` (V3 = TRANSCRIPTION ONLY):** `asr` role; audio
tracks/files → conditional transcript. The escape-prompt is MANDATORY and non-editable:
"if there is no actually audible speech, answer none". Output fields: `transcript` +
`asr_model_id` + ffprobe metadata into `ai_features.probe` — **no** audio_desc/genre/mood/
kind FIELDS ship in v1 (failure direction stays conservative — a missed transcript loses data, an invented genre poisons the index). Music detection is metadata-scoped
(ffprobe tags/`media_kind`): vocal music transcripts store LYRICS in `transcript` and
`ai_features.media_kind='music'` marks them EXCLUDED from document-content scoring —
every consumer of `transcript` (embed ladder input, features input, near-dup) filters
`media_kind='music'` out of doc-content paths; the transcript remains for display/search
in its own lane. Then chains `enqueue(node,'embed',gen)` (V0 metadata_only when the
transcript is `none`).
**`backfill`:** admin-launched driver job (rate-limited; never auto-fires on model change): seeds `enqueueMany`
per generation-bump and monitors progress via `countByModel`/`countByStatus`; the backfill
job itself performs no provider calls.

### 2.5 Budget breaker, usage counting, degraded flags

- The PROVIDER-TRAFFIC counters live in llmAdapter (its spec §5: `ai_usage_daily(day,
role, calls, input_chars, cached, degraded, failed_429)` PK `(day,role)`); this service
  CONSUMES the breaker state (§2.3 step 4) and owns the job-visible flags:
- `truncated` (overlength ladder entered — `ai_features.truncated`, embed `source` column
  for the vector side) and `degraded` (length-class halving active for the model,
  propagated from llmAdapter's limiter event) are persisted with the RESULT rows so the
  the admin degraded-input histogram and per-role ledger can be rebuilt from DB alone.
- A role hitting its daily cap pauses that KIND's execution (jobs park — §2.3); the
  admin pipeline card shows `queue depth, 24h fail/429 rates, breaker states` from
  `countByStatus`/`listFailed` + `ai_usage_daily`.
- Kill switches (pause semantics — a pause never destroys queued work silently): pausing enrichment (role/worker level) never destroys
  queued work — `pending`/`failed` rows are untouched; the only sanctioned terminal
  non-success states are `skipped` (data-driven) and admin-abandon (out of v1 API).

### 2.6 Error surface

Background service: throws are INTERNAL (recorded to `last_error`, ≤1KB truncated by the
store). Public enqueue functions throw nothing to callers (post-commit fire-and-forget:
enqueue failures are logged; the next hook/backfill heals — idempotency makes loss
recoverable). The only user-facing code in this domain is thrown by llmAdapter consumers
(`aiNotConfigured`) — see collectionsService §2.11 / searchService §2.7.

---

## 3. Configuration (T2 / dbOnly unless noted)

| Key                                          | Default         | Use                                                                                                    |
| -------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `WEA_SKIP_AI_WORKER`                         | unset           | test seam — disables worker scheduling                                                                 |
| `AI_WORKER_POLL_MS`                          | `5000`          | idle claim poll                                                                                        |
| `AI_WORKER_CONCURRENCY`                      | `1`             | per-process parallel jobs                                                                              |
| `AI_JOB_STALE_MS`                            | `900000`        | `recoverStaleRunning` cutoff                                                                           |
| `AI_JOB_TIMEOUT_MS`                          | `120000`        | per-job wall clock                                                                                     |
| `LLM_CHUNK_BUDGET`                           | `4`             | input-budget sampled-chunk cap (profile default; part of the chunking profile key — change ⇒ re-chunk) |
| `LLM_OVERLENGTH_POLICY`                      | `chunk-pool`    | ladder entry point: `chunk-pool\|truncate-head\|metadata_only\|skip`                                   |
| `AI_GEN_EMBED` … `AI_GEN_ASR`                | `1`             | per-kind generation counters (admin bump only)                                                         |
| `LLM_DAILY_CALL_CAP` / `LLM_DAILY_TOKEN_CAP` | `0` (unlimited) | per-role budget breaker (llmAdapter enforces; consumed here)                                           |

## 4. Dependencies

- `aiJobsStore` (queue), `embeddingsStore`, `embeddingsChunkStore`, `fileNodesStore`
  (content_hash read), `ai_features` repository via the AI store set
- `infrastructure/adapters/llm` (role clients + breaker state), `blobStorageService`
  (`downloadBlob` content re-read), `vectorStore` seam (`upsert`)
- local extractors: pdf/docx text utilities, ffmpeg/ffprobe (free)
- Callers of the hook: `uploadService`, `fileService` (upload success + `copyFile`),
  `versionsService.restore`

## 5. Verification Scenarios

- [ ] Hook at each of the 4 seams enqueues exactly the §2.2 kind-set for the node type;
      directory nodes enqueue nothing; enqueue never throws into the committed caller
- [ ] Double-fire the hook (crash-retry simulation) → second `enqueue` returns `null`,
      one row; job executes the provider call exactly once
- [ ] embed dedupe-skip: same model + same content_hash → `markSkipped`, zero provider
      calls (fake-adapter call counter), pooled row untouched
- [ ] Restart survival: kill loop mid-claim → `recoverStaleRunning` re-arms the row →
      file embedded exactly once per generation
- [ ] Backoff ladder: consecutive `markFailed` yields 30s/60s/120s… capped 30min
      `next_retry_at`; a `failed` row is claimable only past its `next_retry_at`
- [ ] Role unconfigured / breaker open ⇒ its kinds' jobs are NOT claimed (stay
      `pending`/`failed`) and nothing is deleted; configuring the role drains the backlog
- [ ] Overlength ladder: doc > budget → chunk-pool path stores ALL sampled chunk vectors + mean-renormalized pooled row; forced length-class error → `truncate-head` →
      `metadata_only` → finally `skipped`; job never FAILS on overlength; `truncated`/
      degraded flags observable on result rows
- [ ] features: schema-invalid JSON → `markFailed` (retryable); valid → `ai_features`
      row with `features_model_id` + `schema_version=1`; reasoning kwarg present in the
      fake server's captured request (`chat_template_kwargs.enable_thinking=false`)
- [ ] caption: ≤4 sampled frames, transient (assert nothing persisted); caption text
      lands in `ai_features.caption` AND chains one `embed` enqueue
- [ ] asr: request carries the escape-prompt; `none` transcript ⇒ no transcript written,
      metadata_only embed still chains; music-tagged input ⇒ `media_kind='music'` and the
      embed/features inputs EXCLUDE the transcript
- [ ] `ai_usage_daily` row for `(today,'embed')` increments `calls`/`input_chars` after a
      worker-run embed; breaker opens at `LLM_DAILY_CALL_CAP` and the kind stops claiming
- [ ] Grep: zero `CacheAdapter`/`operationProgress` imports in `domains/ai/**`

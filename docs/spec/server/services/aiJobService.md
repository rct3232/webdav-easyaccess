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
- **Pipelines:** `server/domains/ai/pipelines/{embed,caption,asr,backfill}.js` (pure per-
  kind executors, unit-testable with a fake llmAdapter — adapter injection seam; `backfill`
  takes the vectorStore seam and performs no provider call) and
  `pipelines/pipelineRunner.js` (shared claim/timeout/failure mechanics)
- **Media helpers:** `server/domains/ai/media/mediaSampling.js` (ffprobe metadata,
  frame sampling, audio decode/windowing, ladder arithmetic, metadata-scoped
  `media_kind`) and `server/domains/ai/media/mediaBackfillScope.js` (media node
  classification, the shared caption/transcript corpus rule, coverage
  classification and the admin re-embed plan)
- **Test files:** `server/domains/ai/__tests__/{jobService,embedPipeline,embedMediaPipeline,captionPipeline,asrPipeline,mediaDrainIntegration,mediaBackfillScope}.test.js`,
  `server/domains/ai/media/__tests__/mediaSampling.test.js`

### 2.2 Enqueue hooks (content-commit seams)

`onNodeContentCommitted(nodeId, contentHash)` — called fire-and-forget AFTER the domain
TX COMMITS (precedent: thumbnail invalidation `uploadService.js:≈204-209`) at exactly
these points. `contentHash` is the freshly computed write-side hash; it may be `null`
(restore re-read failure degrades to null — `versionsService.js:≈189-222`):

| Seam                  | Anchor                                                     |
| --------------------- | ---------------------------------------------------------- |
| S3 upload             | `server/service/uploadService.js` TX2 return (≈:99-123)    |
| WebDAV upload success | `server/domains/files/services/fileService.js` (≈:250-264) |
| Copy                  | `fileService.copyFile` success                             |
| Version restore       | `versionsService.restore` success                          |

**Hook module (implemented):** `server/domains/ai/nodeContentHook.js` — owns the
node lookup, the decision table below, and the per-kind enqueue. Capability gates
read the EFFECTIVE capability set published by the llmAdapter probe matrix
([llmAdapter](../infrastructure/llmAdapter.md) §2.4 — `probeState`), never raw
`LLM_*` config presence: a declared-but-unprobed or declared-but-failed role is
OFF and its media falls back to the `embed` floor. There is NO delete seam.
Job kinds are the `AI_JOB_KIND` values (`shared/constants.js`; the
`ai_jobs.kind` DDL CHECK is the persistence source of truth).

The same commit points populate `filecache.content_hash` (best-effort write, same
convention as `server/utils/contentHash.js`); the hook receives the fresh hash. A null
hash there means "hash unavailable" — restore re-read failure, a swallowed best-effort
write, or legacy pre-hook rows (healed by the admin backfill,
`adminReportsService.js:≈294-370`) — never "empty file": 0-byte content still hashes
to a deterministic digest (`e3b0c44…`).

Enqueue decision table (per node, at hook time):

| Node kind / config state                               | Kinds enqueued                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| text/document (pdf/docx/txt — local extractor applies) | `embed`, `features` (`chat` capability probed ON)                                                        |
| image / video, `vision_chat` probed on                 | `caption` (on completion the caption pipeline chains `embed`)                                            |
| audio, `asr` probed on                                 | `asr` (on completion chains `embed`)                                                                     |
| media, capability absent                               | `embed` immediately (V0 `metadata_only` path — name/mime/path/date string, the zero-LLM floor for media) |
| directory nodes                                        | none                                                                                                     |

- **Idempotency & content-change re-embed:** `aiJobsStore.enqueue` inserts `pending`; on
  the `(node_id, kind, generation)` conflict it is a no-op returning `null` when the
  stamped and incoming hashes are identical or either is absent — crash retries,
  byte-identical copies/restores and duplicate hook fires NEVER re-pay. When BOTH hashes
  are non-null and DIFFER, the same row is RESET to a fresh attempt (`pending`,
  `attempt=0`, retry/start/finish/last_error cleared, new hash), so an overwrite/restore
  of changed content always produces claimable work without a generation bump (aiJobsStore
  §2.3/§2.4). A reset applies to any prior status; the previous execution's late
  `markDone` is a `{changes:0}` no-op. Content re-read at execution time via
  `blobStorageService.downloadBlob` (works on both backends; the upload buffer is not
  retained). The `caption`/`asr` completion chains use the SAME call shape and therefore
  share this rule with the commit-seam hook (same per-kind generation).
- **content_hash skip:** `embed` executor first runs the dedupe check
  (`embeddingsStore.get(node)`; same active `modelId` ∧ same `contentHash` ⇒
  `markSkipped`, no provider call — embeddingsStore §2.4; a model version is deterministic, so the `(content_hash, modelId)` pair suffices as the skip key).
  **NULL never skips:** the skip fires only when BOTH the
  job's `content_hash` and the stored row's are non-null and equal — a null on either
  side ⇒ the embed executes. NULL means "hash unavailable" (never "empty file" —
  0-byte content still hashes deterministically), so never-skip is intentional: a
  re-embed is a bounded cost leak that self-heals, because the pipeline's write
  re-stamps the pooled row's hash. For
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
4. Before executing, check the role gate of EVERY pipeline (embed → role `embed`,
   caption → role `vision`, asr → role `asr`); one pass drains all pipelines whose role
   is configured, each with its own claim filter (order matters):

- Role unconfigured (llmAdapter `roleConfigured()` false — including the built-in `embed`
  role while its weights are still downloading or the attempt failed) ⇒ that kind's jobs stay
  QUEUED, unconsumed: the worker claims via an ADDITIVE filter option
  `aiJobsStore.claimNext({ excludeKinds })` (predicate-level exclusion; the existing
  zero-arg `claimNext()` contract of aiJobsStore §2.3 is unchanged). Queued kinds park
  with zero attempt inflation — "pause never destroys queued work silently" holds; backlog surfaces via `countByStatus`/`listFailed`.
  The built-in `embed` role counts as unconfigured while its weights are still being
  provisioned (the `preparing` readiness state) — parked embed jobs drain in claim order
  once the trigger finishes and the role flips configured.
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

- **Vector-space writes and the seam:** the canonical pooled + chunk writes ride the
  vectorStore seam `upsert(node, vecs[], dim)` and its pipeline `hooks`
  (`domains/ai/vectorStore/index.js`
  factory — the engine is selected by the boot probe; a degraded JsFallback engine is a
  legal sink, never a gate). `meta = { source, contentHash, generation }` stamps the
  pooled row's `source`/`content_hash` through the factory's injected `upsertPooled` hook
  (the merged engine contracts stay `(node, vecs[], dim)`-shaped); pooled half = the
  mean+renormalized row, chunk half = the sampled chunks, ONE TX for both halves plus the
  derived shadow sync (vectorStore.md §2.2 division of labor). Production passes the
  seam's `hooks` (`{ transaction, upsertPooled, replaceChunks }`), so the canonical
  pooled + chunk rows and the adapter-managed shadow commit in ONE TX; the direct-SQL
  hook pair remains only as the test / capability-absent fallback. The seam's dim is the
  `embed()` RESULT's runtime dim compared against the node's PERSISTED pooled-row
  identity — never `llm_models` (no dim column exists, llmModelsStore §1 dim note): the
  driver condition is `existing.modelId !== modelId || existing.dim !== dim`, i.e. a
  model change OR a runtime-dim change ⇒ the pipeline enqueues ONE deduped driver —
  `aiJobsStore.enqueue(nodeId, 'backfill', generation, 'shadow-rebuild:<nodeId>:<modelId>')`
  — before the fresh-space writes. The `content_hash` slot on that row is an OPAQUE
  driver key (never compared against a file hash; job dedupe uses the
  `(node_id, kind, generation)` UNIQUE). Enqueue failures are logged and dropped; the
  next embed re-enqueues.
- **Media branch (image/video/audio):** the pipeline resolves the node type/mime first
  (`shared/fileTypes` extension, mime fallback) and enters the media ladder instead of
  the document ladder. The per-modality capability (`image_embed`/`video_embed`/
  `audio_embed`) comes from the published probe matrix:
  - capability ON ⇒ `llmAdapter.embedMedia(segments, { mediaType })` over the sampled
    segment set — image single item, audio fixed `audioWindows` (`min(budget/25 s, 327 s)`)
    encoded as mono 16 kHz WAV, video locally frame-sampled at 1 fps with a uniform
    stride down to `budget/mediaTokenCost.videoFrame` frames (embedded provider: the model
    window; remote: the profile budget). Every segment vector becomes an
    `embeddings_chunk` row and the mean+renormalized pooled row is stamped
    `source='media_direct'`, ONE TX. Video frames ride the image media path (the sampled
    frame set IS the segment set); media never head-truncates.
  - capability OFF, `ai_enrichments.caption` (visual) or `transcript` (audio, EXCLUDING
    rows with `media_kind='music'`) present ⇒ that text is the corpus through the same
    chunk-pool ladder, pooled `source='chunk_pool'` (the V2 fallback). The selection rule
    is ONE helper (`mediaBackfillScope.mediaFallbackCorpus`), shared by the pipeline and
    the coverage classification below: image/video take `caption`, audio takes
    `transcript`, and a `media_kind='music'` row NEVER yields a corpus (its lyrics stay
    display/search-only).
  - no corpus ⇒ the V0 metadata string (name/mime/path/date), pooled
    `source='metadata_only'`; the metadata string also carries its single segment row so
    max-over-segments scoring sees the node.
  - Media IO is transient: bytes are read through `blobStorageService.downloadBlob`,
    frames/windows live in a per-call `os.tmpdir()` workspace removed before the job
    returns, and nothing is persisted except the vectors.
- **Media coverage & backfill scope (`media/mediaBackfillScope.js`):** read-only module
  behind the admin media-embed coverage card and its re-embed action. Node membership is
  `classifyMediaNode(node)` (shared `fileTypes` extension first, stored `filecache` mime as
  the fallback — the same rule the pipeline uses, so pipeline and coverage never
  disagree). `buildMediaBackfillScope` takes `userId` (omitted ⇒ the admin view),
  `modelId`, `fileNodesStore`, `embeddingsStore`, `aiEnrichmentsStore` and
  `capabilityEnabled`: it enumerates the live node rows of the scope (requester = own-root
  subtree; no `userId` = every live root subtree), then performs ONE bulk pooled read and
  ONE bulk enrichment read over the scoped media ids (id-batched, no per-node reads) and
  classifies each node into exactly one coverage state: `media_direct` (current-space row
  with `source='media_direct'`, the direct multimodal embed), `caption_fallback`
  (current-space text-ladder row on image/video, the V2 caption corpus),
  `transcript_fallback` (current-space text-ladder row on audio, the V3 transcript corpus),
  `metadata_only` (current-space row with `source='metadata_only'`, the V0 floor),
  `missing` (no pooled row at all — initial-coverage candidate), `stale_space` (pooled row
  exists under ANOTHER `model_id` — the model-change re-projection candidate).
  Return shape: `totals` (`media`, `embedded`, `missing`, `stale`), `bySource`,
  `byMediaKind`, `byCapability`, `byCorpus`, `missingIds`, `staleIds`, `sampleMissing`,
  `sampleStale`. `bySource` carries all six states and sums to `totals.media`;
  `byMediaKind` splits media/embedded/missing/stale per modality; `byCapability` counts
  nodes whose modality capability (`image_embed`/`video_embed`/`audio_embed`) is probed ON
  vs OFF; `byCorpus` counts the nodes whose V2/V3 fallback corpus is currently available
  (`caption`/`transcript`/`none` — the same helper as the pipeline, so a music transcript
  counts as `none`). `missingIds`/`staleIds` are complete and id-ascending;
  `sampleMissing`/`sampleStale` are their bounded prefixes (default 20) so the preview is
  deterministic across calls. `planMediaBackfill` takes `scope` and `limit` and returns the
  node-id list an admin action would re-embed — `missing ∪ stale_space`, id-ascending,
  capped by `limit` — and enqueues nothing: the admin action and its rate limit own the
  enqueue.
- **Backfill executor:** `pipelines/backfill.js` executes a claimed `backfill` row by
  calling the active vectorStore `rebuildShadow()` ONCE, then `markDone`. It performs NO
  provider calls, writes no canonical row and enqueues nothing; a rebuild throw goes
  through the shared drain catch (`markFailed` + store backoff), and a re-run after
  success finds no claimable row. The drain rides the embed role gate in
  `jobService.drainPass` and additionally requires the installed vectorStore seam —
  absent (no active embed model / pre-boot) ⇒ the rows park untouched. The job remains
  admin-launched and rate-limited: the unified re-embed action (initial coverage +
  model-change full re-embed) owns generation bumps and seed enqueues, and a model
  change enqueues nothing by itself. Its media half is the `planMediaBackfill` list above
  (`missing` for the initial coverage pass, `stale_space` for the model-change
  re-projection). No DDL column is added for the driver.
- **Restart idempotence:** a job claimed but unfinished (process death) is re-armed by
  `recoverStaleRunning` (§2.3 step 2) and re-executes; because the pooled upsert REPLACES
  per node and `replaceChunks` deletes the incoming model space's set before insert, a
  partially written node converges to the full fresh state on re-execution — the file is
  embedded exactly once per generation end to end (no duplicate pooled rows, no
  mixed-space scoring: canonical reads filter by the active `model_id`).
- **Kind coverage:** `embed`, `caption`, `asr` and `backfill` have executors; `features`
  stays PARKED (`UNEXECUTABLE_KINDS`) through `claimNext({ excludeKinds })` park&drain —
  zero attempt inflation. Each pipeline's exclusion set names every OTHER kind, so the
  drains sharing one worker pass can never double-claim.

**`features` (`features.extract`):** chat role; runs ONLY inside this job — never
on request paths. Input = extracted text clipped by the input-budget ladder + a
filename/mime/path/date metadata line. Fixed prompt template; output FORCED to JSON
schema `{tags:[{tag,confidence}], summary, category}`; ≤ small token budget; **reasoning
OFF** (`enable_thinking:false` via chat_template_kwargs
where supported — llmAdapter owns the kwarg). Written to `ai_enrichments`
(`features_model_id`, `schema_version:1`, `truncated` flag from the ladder). Schema-parse
failure ⇒ `markFailed` (retried; provider flakiness is transient). Chat off ⇒ field
stays empty; downstream runs on local tags + vectors (the LLM-free fallback keeps every other pipeline working).

**`caption` (V2):** `vision_chat` role (`adapter.roleConfigured('vision')`); local ffmpeg
uniform-stride frame sampling (video ≤4 frames, image raw single, transient — frames
never persisted); VLM captions in Korean; writes `ai_enrichments.caption` +
`caption_model_id`; then CHAINS `enqueue(node,'embed',gen)` with the job's content hash
(caption text is the media's embed corpus on the V2 fallback path). A claimed caption job
whose effective `vision_chat` capability is OFF is a typed `capability_absent` skip — the
hook's decision table already falls back to plain `embed` for that node.

**`asr` (V3 = TRANSCRIPTION ONLY):** `asr` role (`adapter.roleConfigured('asr')`; a
claimed job with the effective capability OFF is a `capability_absent` skip); audio
tracks/files → conditional transcript. The escape-prompt is MANDATORY and non-editable:
"if there is no actually audible speech, answer none". Output fields: `transcript` +
`asr_model_id` + ffprobe metadata into `ai_enrichments.probe` — **no** audio_desc/genre/mood/
kind FIELDS ship in v1. Music detection is metadata-scoped
(ffprobe tags/`media_kind`): vocal music transcripts store LYRICS in `transcript` and
`ai_enrichments.media_kind='music'` marks them EXCLUDED from document-content scoring —
every consumer of `transcript` (embed ladder input, features input, near-dup) filters
`media_kind='music'` out of doc-content paths; the transcript remains for display/search
in its own lane. Then chains `enqueue(node,'embed',gen)` (V0 metadata_only when the
transcript is `none`).
**`backfill`:** admin-launched driver job (rate-limited; never auto-fires on model change): seeds `enqueueMany`
per generation-bump and monitors progress via `countByModel`/`countByStatus`; the backfill
job itself performs no provider calls. The SAME admin-launched action serves the initial
coverage pass (first embedding sweep over an existing corpus) and a model-change full
re-embed — one UI/UX surface, no distinct flow, no automatic bulk enqueue in either case.

### 2.5 Budget breaker, usage counting, degraded flags

- The PROVIDER-TRAFFIC counters live in llmAdapter (its spec §5: `ai_usage_daily(day,
role, calls, input_chars, cached, degraded, failed_429)` PK `(day,role)`); this service
  CONSUMES the breaker state (§2.3 step 4) and owns the job-visible flags:
- `truncated` (overlength ladder entered — `ai_enrichments.truncated`, embed `source` column
  for the vector side) and `degraded` (length-class halving active for the model,
  propagated from llmAdapter's limiter event) are persisted with the RESULT rows so the
  the admin degraded-input histogram and per-role ledger can be rebuilt from DB alone.
- A role hitting its daily cap pauses that KIND's execution (jobs park — §2.3); the
  admin pipeline card shows `queue depth, 24h fail/429 rates, breaker states` from
  `countByStatus`/`listFailed` + `ai_usage_daily`.
- Media-embed coverage is DERIVED ON READ, never persisted: `buildMediaBackfillScope`
  recomputes the six-state split from the canonical node/pooled/enrichment rows on every
  call, so the admin card and the re-embed plan always describe the current space — a
  completed re-embed simply reports the rows under their new ladder source, with no
  bookkeeping table to reconcile.
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
  (content_hash read), `ai_enrichments` repository via the AI store set
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
- [ ] Content-change re-embed: upload a node, run its `embed` job to `done`, then
      overwrite/restore with DIFFERENT bytes → the same `(node,kind,1)` row becomes
      `pending` (`attempt=0`, stamps cleared, new hash) and the worker re-runs it; an
      overwrite/restore with IDENTICAL bytes leaves the `done` row untouched and enqueues
      nothing
- [ ] Restore + media chain: restoring an older version whose hash differs from the current
      embed row re-arms the `embed` job; a `caption`/`asr` job's chained `embed` enqueue
      uses the same generation and the same content-aware reset (no duplicate row)
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
- [ ] features: schema-invalid JSON → `markFailed` (retryable); valid → `ai_enrichments`
      row with `features_model_id` + `schema_version=1`; reasoning kwarg present in the
      fake server's captured request (`chat_template_kwargs.enable_thinking=false`)
- [ ] caption: ≤4 sampled frames, transient (assert nothing persisted); caption text
      lands in `ai_enrichments.caption` AND chains one `embed` enqueue
- [ ] asr: request carries the escape-prompt; `none` transcript ⇒ no transcript written,
      metadata_only embed still chains; music-tagged input ⇒ `media_kind='music'` and the
      embed/features inputs EXCLUDE the transcript
- [ ] Media fallback matrix: with the modality capability OFF, an image caption and a video
      caption both become the `chunk_pool` corpus, an audio transcript becomes the
      `chunk_pool` corpus, a `media_kind='music'` transcript never enters a corpus (the node
      falls to `metadata_only`), a long caption is uniform-stride sampled (never
      head-truncated), and a capability ON wins over a present caption (`media_direct`)
- [ ] Media coverage scope: the six-state split matches the rows present (`bySource` sums to
      `totals.media`), a requester scope sees only their own root subtree while the
      no-`userId` admin scope sees every root, samples are the id-ascending bounded prefixes
      and repeated calls are identical; `planMediaBackfill` returns `missing ∪ stale_space`
      id-ascending (capped by `limit`) and enqueues NO job
- [ ] `ai_usage_daily` row for `(today,'embed')` increments `calls`/`input_chars` after a
      worker-run embed; breaker opens at `LLM_DAILY_CALL_CAP` and the kind stops claiming
- [ ] Grep: zero `CacheAdapter`/`operationProgress` imports in `domains/ai/**`
- [ ] Vector-space write shape: after an embed job the node holds exactly ONE pooled row
      (replacing any prior space) whose `model_id`/`dim` equal the runtime `embed()` result
      and whose `source`/`content_hash` match the ladder outcome; `embeddings_chunk`
      holds the sampled chunk set in the SAME model space (cross-space rows untouched at
      non-colliding indices)
- [ ] Stale-dim path: an `embed()` runtime dim ≠ the node's persisted pooled-row dim
      enqueues ONE `backfill` driver (`shadow-rebuild:<nodeId>:<modelId>`); a re-run under
      the same condition enqueues nothing new (dedupe); the fresh-space writes still land
- [ ] Pipeline drain: `runPendingEmbedJobs` over seeded `embed`+`features` jobs drives ONLY
      the `embed` job to `done` (the unknown kind stays parked with attempt 0 —
      `claimNext({excludeKinds})`), leaving it claimable for its own unit later
- [ ] Restart survival end-to-end: claim an embed job, abandon it (no
      done/skip/fail), `recoverStaleRunning(0)` → re-claim → pipeline completes with the
      SAME single pooled row (upsert-replace, exactly-once per generation)

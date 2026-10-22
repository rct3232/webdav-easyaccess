# llmAdapter Spec

Target-contract spec.

## 1. Overview

| Item          | Description                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role          | The single gateway to every LLM provider: per-call config resolution, signature-keyed client cache (hot reconfiguration), role clients (`embed`/`chat`/`vision`/`asr`), the capability probe suite, the budget chain + breaker, the overlength ladder executor, error taxonomy, usage counting.                          |
| Hot by design | ALL `LLM_*` keys are T2 `dbOnly` (admin config, masked secrets, DB-stored plaintext). NOT boot-owned: LLM is an enrichment dependency (never a render dependency), so its config is FULLY hot. No `LLM_ENABLED` flag anywhere: role PRESENCE (non-empty resolved config) decides candidacy; PROBES decide truth.         |
| Never         | No LLM call blocks a request path except the two exception-family roles consumed by their services (query embed, `parse.nl`) — this adapter serves them under their cache/kill-switch contracts; enrichment/batch/naming/arbiter calls NEVER reach a request thread (vision-model request-path calls explicitly banned). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/adapters/llm/index.js` (factory + per-call resolver)
- **Peers:** `clients/` (**`openai-compatible.js`** = llama.cpp/OpenAI-compatible
  remote dialect used by every remote preset: text embed/query with profile task
  prefixes, media through the profile `requestShape` (`content-wrapper` media parts,
  data URLs, no prefix), chat with reasoning-off by default, vision data-URL image
  parts, multipart ASR with the fixed escape prompt, every failure classified before
  surfacing; **`embedded-onnx.js`** = in-process transformers.js client for the
  built-in provider (lazy `require` of `@huggingface/transformers`; dtype q4;
  **mean pooling, attention-mask weighted** + L2 normalize — cls pooling mis-shapes
  the plain-text space silently; text inputs carry the profile task prefixes;
  `embedMedia` runs `AutoProcessor` + `AutoModel`: image via `RawImage`, audio as
  mono 16 kHz `Float32Array` (WAV decoded in-process, compressed input normalized by
  ffmpeg), video as 1 fps sampled `RawImage[]`; media carries no prefix and returns
  the model's L2-normalized `sentence_embedding`), incl. local positive-control
  probe fixtures),
  **`mediaProbe.js`** (media/vision/asr positive controls + fixture access),
  `probe.js` (suite), `budget.js` (chain + limiter + breaker),
  **`provision.js`** (provider-triggered model provisioning for `engine='embedded'` — a
  blocking run at boot only for a CONFIGURED boot while the built-in is the active embed
  provider — the first boot after the setup wizard needs no special event or marker: it is
  ordinary boot processing under the same posture (setup mode makes zero attempts and never
  blocks) — plus an immediate in-place, server-non-blocking run (role reports `preparing`
  until done) when a remote embed override is cleared (restart-free); deferred,
  with no trigger and no weight deletion, while the override is active — existing weights persist:
  lockfile
  parse → `WEA_MODEL_DIR` / data-dir detection → checksummed downloads with per-file CLI
  progress logs, atomic temp-file+rename — the weights tree layout is
  `<modelDir>/<repo>/<revision>/<file.path>` (the HF snapshot layout the ONNX
  client reads directly from disk; a lock WITHOUT repo/revision — test
  fixtures — falls back to the flat `<modelDir>/<file.path>` form),
  **`model.lock.json`** (checked-in release artifact at
  `server/infrastructure/adapters/llm/model.lock.json`:
  repo/revision/files+sha256+size/dtype/dim/pooling —
  identity, §4.15; NO model bytes in the repo),
  `presets.js` ([llmPresets spec](llmPresets.md))
- **Test files:** `server/infrastructure/adapters/llm/__tests__/llmAdapter.test.js`
  (+ fake-server E2E leg, in-process adapter injection),
  `openai-compatible.test.js` (remote dialect request shapes),
  `mediaProbe.test.js` (media-drop / correctly-shaped fake endpoints, vision/asr
  positive controls), `embedded-onnx.multimodal.test.js` (real-weights smoke,
  skipped unless enabled).

### 2.2 Per-call config resolution + signature-keyed client cache

- Resolution per call via `configResolver` (5s TTL; `invalidateCache` fired on settings
  PUT): each role reads `{BASE_URL, API_KEY, MODEL}` → keys
  `LLM_EMBED_*`, `LLM_CHAT_*`, `LLM_VISION_*`, `LLM_ASR_*` (API keys `secret:true` —
  masking only, plaintext at rest). All `LLM_*` keys are T2 `dbOnly` (configRegistry §3):
  the resolver reads DB → default and **ignores env** — a `.env`-provided `LLM_*` value is
  never effective, and the DB `settings` row is the single config surface (wizard
  and admin editor both write rows).
  **Embed-role presence:** with `LLM_EMBED_*` unset, the resolver resolves the
  **built-in `embedded` provider** (lockfile shipped = present; provisioning per §2.1/
  [llmPresets](llmPresets.md) §2.3 — deferred while a remote override is active, run in
  place when it is cleared), so embed candidacy needs no config; an admin-set remote
  embed triple OVERRIDES the built-in (one active embed model) but activates only after the
  §2.4 **conformance gate** (EG2 model pin — endpoint names are untrusted metadata).
  `engine` lands on the `llm_models` row (identity); `precision`/`model_revision` are
  best-effort annotations (embedded: from the lock; remote: NULL unless verifiable —
  §4.20/§4.15).
- **Client cache keyed by the resolved-config SIGNATURE**
  (`sha256(base_url∥model∥api_key∥dialect)`): rebuild on change — no full teardown.
  `getRoleClient(role)` → client | `null` (role unconfigured ⇒ null ⇒ capability degrades,
  never fatal).
- **Probe cache:** probe and conformance verdicts are keyed by the resolved-config
  signature (`Map<signature, {conformance}>`) and invalidated when `observeRole` sees a
  new signature — one activation pass per signature, never a per-call probe. A transport
  fault is not an identity verdict: it fails closed for that pass, is not cached, and is
  retried by the next activation/debounced pass.
- **On signature change:** re-probe the role (debounced ~60s; admin "test" button =
  manual trigger) → `backendHealth` rows update → `settings/public` `ai:{embed,chat}`
  flags flip live (email_enabled precedent `settings.js:18-29`). Running enrichment
  workers adopt the new config at the NEXT job; query-embed adopts at the next request
  (mid-switch failure degrades — never surfaces as error); budget breakers RESET
  on reconfig. Usage HISTORY is DB truth and is NEVER reset by a reconfig
  (§2.9; aiUsageDailyStore §1 — no store code path resets, zeroes, or
  aggregates-away history; a day rollover is a new PK row).

### 2.3 Public API

| Export                                              | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roleConfigured(role)`                              | `true` iff the role resolves to a LIVE provider: remote ⇒ non-empty `{base_url, model}` AND, for the embed role, a PASSING §2.4 conformance verdict (the endpoint identity gate — a non-conforming endpoint is `false` and reports `ai.embed` `probe_failed`/`nonConformingEndpoint`); the built-in embed role ⇒ lockfile present AND weights provisioned and is exempt from conformance (lockfile checksum IS the identity). During an in-place provisioning run the role is NOT configured — consumers park their work (never claim-and-fail); readiness surfaces as the `preparing` state (§2.4). For chat/vision/asr presence is not a capability claim — the probe matrix is, see §2.4 |
| `embed(texts[])`                                    | batch per provider `batch_size` (llm_models row); returns `{vectors[][], dim, modelId, degraded?}` — `dim` is RUNTIME-DERIVED from the active model's profile (embedded: the lockfile `dim`; remote: the preset profile). `llm_models` has NO dim column and never will (DDL 001 is closed) — dim persistence lives ON THE EMBEDDING ROWS themselves (`embeddings.dim` / `embeddings_chunk.dim` are `NOT NULL` per row — history is self-describing); stale-dim detection compares this runtime dim against the per-row dim of the canonical rows, never against `llm_models`; pooled/chunk callers (worker) decide the ladder; applies the profile's `requestShape` + TEXT prefixes (§2.6) |
| `embedMedia(buffers[], {mediaType})`                | V1/V3 direct media embed: image/audio/video bytes → same embed role, NO text prefix, usage accounting like `embed`; remote sends one `content`-wrapper item per buffer with a base64 data URL (`image/jpeg\|png`, `audio/wav`, `video/mp4`), embedded sends `AutoProcessor` media objects. Oversized media enters the §2.6 MEDIA segment ladder; returns `{vectors[][], dim, modelId, degraded?}`. Each media sub-capability (`image_embed`/`audio_embed`/`video_embed`) is probe-gated independently (§2.4)                                                                                                                                                                                |
| `embedQuery(query)`                                 | Request-path wrapper (query embed): the `query_parses` cache read/write is owned by the CONSUMING search leg (`searchService.md` §2.3 step 4 — get-or-embed keyed by the normalized text); this call is the raw provider embed and respects the caller's kill-switch decision; applies the profile's query prefix; timeout ⇒ throw `transport` (caller degrades to empty section); the profile records serving-mode latency as an informational field                                                                                                                                                                                                                                       |
| `chat(messages, {schema?, maxTokens?, reasoning?})` | JSON-schema-forced where supported; `reasoning` defaults OFF (§2.7); returns `{json, text, usage, truncated}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `visionCaption(frames[], {prompt})`                 | V2 path ONLY from worker context                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `asrTranscribe(audioBuffer, {escapePrompt: true})`  | escape-prompt is part of the fixed template — callers cannot omit it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `probeLlm()`                                        | suite (§2.4). The probe module's `probeEmbedConformance({baseUrl, apiKey, model})` runs the checked-in EG2 reference kit through the endpoint and applies `evaluateConformance` — `roleConfigured('embed')` and `probeRole('embed')` depend on it for an external override. `probeLlm` remains the chat/vision/asr wizard/admin-test target: `runProbe(target='llm')` registration in `backendProbe.js:263` + `POST /api/admin/config/test` target `llm` + `/api/setup/test` target `llm` (wizard)                                                                                                                                                                                          |
| `probeRole(role)` / `probeConfiguredRoles()`        | The adapter's probe entry points: `probeRole` runs the role's suite (embed ⇒ conformance gate, chat/vision/asr ⇒ the injected probe suite) and publishes the matrix result; `probeConfiguredRoles()` probes every configured role once (the startup/INITIAL probe). Both return `{ok, role, reason}` and never throw on a probe failure.                                                                                                                                                                                                                                                                                                                                                    |
| `getEffectiveCapabilities()`                        | The EFFECTIVE `{embed, chat, vision, asr}` set published by the probe matrix (`probeState`). This — not raw config presence — is what the enrichment hook's decision table and admin capability surfaces read (§2.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `breakerState(role)` / `budgetStatus()`             | admin card inputs: `ok \| budget_paused \| breaker_open(cooldown_left)` + `ai_usage_daily` rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `syncModelRegistry()`                               | upsert `llm_models` rows from resolved configs + probe results (`max_input_chars`, `chunk_budget`, `batch_size`, `reasoning`, `enabled`) — there is NO `dim` column on `llm_models` and none will be added (DDL 001 is closed): the ACTIVE model's dim is runtime-derived from the model profile (llmModelsStore §1 dim note) and persisted per-row on the embeddings rows — the registry is the adapter's persisted view, never hand-edited except `reasoning` (experiment switch)                                                                                                                                                                                                         |

### 2.4 Probe suite (IN-DOMAIN samples — hard rule)

Startup probe (symmetric to s3/webdav probes, `index.js:293-348`) is the INITIAL probe,
not the only one (hot re-probes per §2.2). For `engine='embedded'` the sequence at every
provisioning trigger — a configured boot with the built-in active (blocking; includes the
first boot after the wizard), or an in-place trigger on a remote-override clear (server
runs, role
`preparing`) — is
**provision → probe** (blocking within a boot-path trigger, §2.1 `provision.js`; no embedded trigger
fires while a remote override is active; the same suite then
runs against the in-process client — fixtures local, no HTTP). Every probe sample is real
in-domain material; out-of-domain probes produce false negatives indistinguishable from false
capability claims:

- `embed`: real mixed-ko/en sentence set → verify non-empty, `dim` == profile, and
  NON-DEGENERACY (two distinct samples must not cosine ≥0.999 — catches constant-output
  endpoints). Text is sent with the profile's task prefixes. When the profile declares
  `pooling`, `/props` (llama family) is read: server pooling ≠ profile pooling ⇒ `text_embed`
  OFF with reason — pooling is SPACE-shaping (same weights, different space, zero errors).
  **CONFORMANCE (external embed only — EG2 model pin):** the fixed reference-kit strings are
  embedded and the **median cos to the canonical vectors ≥ calibrated threshold** (release
  artifact, [llmPresets](llmPresets.md) §2.2; negatives measured on same-dim model twins).
  Fail (or wrong dim) ⇒ the WHOLE embed role OFF with `nonConformingEndpoint`, admin card
  shows the measured median; partial activation (text-ok/media-off) only for endpoints that
  pass conformance and then fail a media probe. Built-in rows skip this gate (lockfile
  checksum IS the identity). The gate is executed by `probeEmbedConformance` with the
  profile's document prefix (the calibrated space); the verdict is cached per config
  signature — one activation pass per signature, reused by every later call and by the
  debounced re-probe — and reported to `ai.embed` as `probe_failed` with
  `reason=nonConformingEndpoint|wrongDim`; the `probeRole('embed')` outcome carries the
  measured median/threshold for the admin card. A rejected endpoint yields no role client:
  `roleConfigured('embed')` is `false` and callers park.
- `image_embed` / `audio_embed` / `video_embed`: probes run `mediaProbe.js` with
  POSITIVE CONTROLS in the profile `requestShape` — known failure mode: a
  multimodal-DECLARING endpoint silently ignores wrongly-shaped media and returns a TEXT
  vector with HTTP 200. The suite ships real fixtures (`__tests__/fixtures`: a real
  photo, its re-encode, a real ALSA speech clip at 16 kHz mono, a 1 fps clip).
  Image pass requires ALL of: (a) in-domain photo vs its re-encode cosine ≥ 0.94
  (media near-dup flag floor); (b) the same bytes as base64 TEXT diverge
  (cos < 0.90 — proves pixels were consumed, an INPUT-shaping failure, not a space
  change); (b2) a text-only control through the same wrapper diverges (cos < 0.99 —
  an endpoint that drops the media part returns the text vector); (c) when
  `vision_chat` is also configured, image↔its-caption > image↔unrelated text.
  Audio: a real-speech clip vs a deterministic noise clip must yield DISTINCT
  vectors (cos < 0.85); sine/noise-only probes remain BANNED as pass criteria.
  Video: a 1 fps frame-sampled video must land in the image space
  (cos ≥ 0.75) and fails when the image positive controls fail. A failed media probe
  switches ONLY that sub-capability OFF (media falls back to the caption→E1 or metadata
  path), it never blocks `text_embed`; each verdict is cached per config signature and
  published through `probeState`/`evaluateCapabilityMatrix`.
- `chat`: instruction-following JSON echo on an in-domain prompt (tag extraction from one
  real sentence) → schema validity is the pass criterion.
- `vision_chat`: the real photo fixture → non-trivial caption (length floor ≥ 12
  normalized chars). Known failure mode: an endpoint that embeds base64 images AS TEXT
  must be caught — the caption must differ from the same request with the image removed.
- `asr`: the real ALSA speech fixture → transcript overlapping `front`/`center`
  (case/punctuation normalized); the request carries the fixed escape prompt. Sine/noise
  probes are BANNED. Transport faults remain honest `transport` failures.

Result matrix = probe-verified ∩ configured roles ⇒ runtime capability flags. The matrix
is computed by `evaluateCapabilityMatrix(preset, probeResults)` and published to
`probeState`: declared-but-not-probed and declared-but-failed capabilities are OFF (with
an `ai.<role>` warning carrying the `serverErrors.ai.providerProbeFailed` hint), while an
undeclared-but-probed pass is ON. Consumers — the enrichment hook's enqueue decision table
and media gates included — read this EFFECTIVE set, never raw `LLM_*` presence. The
in-process capability matrix is also what the admin surfaces render, so the wizard,
admin card and background workers agree on one capability set.
Declared-but-failing ⇒ capability OFF + admin warning card (declared vs probed). User-
visible states are only ever `complete-working | absent`, never partial.
`not_configured | preparing(phase, progress) | probe_failed(reason) | partial | ok`
per-role is the ADMIN 5-state surface (`preparing` = the non-terminal readiness fields on
the `backendHealth` row — preparation running, capability already absent-not-disabled for
users); regular users see absent affordances, not disabled ones.

### 2.5 Budget chain (4 steps — never by probing calls)

`llm_models.max_input_chars` is set by this chain, in order:

1. admin-set `LLM_MAX_INPUT_CHARS` (T2) wins;
2. else PUBLISHED capability metadata — free GETs only: `/v1/models` (n_ctx / OpenAI
   `max_input_tokens`), llama.cpp `/props`, ollama `/api/show`;
3. else the preset manifest's RELEASE-MEASURED default (e.g. llama.cpp ub-512 profile;
   OpenAI-embed 8,191) — release artifacts per the constants-provenance rule;
4. else (and thereafter always) the PASSIVE, DOWNWARD-ONLY limiter: a real request that
   fails with a LENGTH-CLASS error HALVES that model's budget from then on — never
   self-raises; only admin/manual raises. Zero extra inference calls steady-state.

Daily caps: per-role `LLM_DAILY_CALL_CAP` / `LLM_DAILY_TOKEN_CAP` (0 = unlimited) →
budget breaker PAUSES the role (surface in admin; jobs park upstream, aiJobService §2.3).
A paused role's calls fail FAST with a `budget`-class error — no provider round-trip,
no usage row (counters move only on their events, aiUsageDailyStore §1). The TOKEN
cap is enforced against the input_chars-derived token estimate (§2.6 char→token
safety factor) — the ledger has no token column.
**Embedded provider budget mapping:** steps 1–2 are config-only (no metadata
GETs exist) — `max_input_chars` comes from the lockfile profile (step 3; model window 8,192,
server ub wall N/A, in-process memory governs batch size); the step-4 limiter stays armed
(OOM/refusal class ⇒ halve chunk window). Media segment ladder (§2.6) applies unchanged —
for the embedded provider the ladder's budget input is the model window (8,192) itself:
audio windows `min(window/25 s, 327 s)`, video frame-sampled locally (ffmpeg, 1 fps) to
≤ window/140 frames per segment through the image-processor path, image single; there is
no server `ub` wall to consult (in-process memory governs batching).
Circuit breaker (transport class): ≥5 consecutive transport failures ⇒ OPEN 300s, half-
open probe on expiry (operational tunables `LLM_BREAKER_THRESHOLD` (5) /
`LLM_BREAKER_COOLDOWN_S` (300) — T2, §3; not profile constants).

### 2.6 Overlength executor (ladder lives HERE, jobs consume its flags)

`LLM_OVERLENGTH_POLICY` (default `chunk-pool`) selects the entry point; the adapter
executes the overlength ladder and reports the outcome so the worker persists `source` +
`truncated`: paragraph/heading-boundary split (char-window fallback) → uniform-stride
sample ≤ `LLM_CHUNK_BUDGET` (4) chunks → every chunk vector returned for storage →
mean+renormalize for the pooled row → `truncate-head` → `metadata_only` → `skip`
(+journal note). Chat-role inputs NEVER hierarchical-summarize: head+stride excerpt only.
char→token safety factor **1.7** — release constant shipped in
the profile, used to convert `max_input_chars` budgeting (per-profile value; on a new model
it ships null+pending until release measurement). MEDIA segment ladder: media never
degrades to head-truncation; instead, per profile `mediaTokenCost` × server budget
(budget chain §2.5): audio → fixed windows (`min(ub/25 s, 327 s)` model cap), video →
frame-sampling to fit (embedded provider: local ffmpeg 1 fps sampling, cap = window/140,
image-processor path — no server wall), image → single-item always; every segment vector returned
(`embeddings_chunk` rows) + mean+renormalized pooled row; segment windows are chunking-
profile params — changing them re-embeds the media (chunking-profile rule, §2.6).
`source='media_direct'`. The worker performs the video sampling itself (1 fps, uniform
stride to the frame cap) and calls `embedMedia(frames[], { mediaType:'image' })` — one
segment vector per frame; `mediaType:'video'` remains available for a whole-file item.
Retrieval note (ownership):
the adapter only produces vectors; max-over-chunks SCORING is vectorStore's rule.

### 2.7 `enable_thinking` / chat_template_kwargs handling

All chat roles default reasoning OFF. Mechanism per provider family
(from the preset manifest): llama.cpp-compatible chat calls carry
`chat_template_kwargs: { "enable_thinking": false }`;
`llm_models.reasoning ∈ on|off` is the per-model OVERRIDE for experiments only — never a
plan assumption. Reasoning-EFFORT tiers are exposed ONLY where probing finds support
(unknown params break strict servers — send only probe-verified params).

### 2.8 Error taxonomy (every provider error classified before surfacing)

| Class                     | Examples                                                                                                                             | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `length`                  | 400 token/input-too-long, context-overflow messages                                                                                  | §2.5 step-4 halving + `degraded` flag + histogram counter; NEVER fails a job (ladder degrades)                                                                                                                                                                                                                                                                                                                                                                                     |
| `transport`               | timeout, ECONNRESET, 5xx, DNS                                                                                                        | retry-within-job, consecutive-failure breaker (§2.5), surfaced to caller as degrade signal (services choose their fallback; request paths never 5xx on this)                                                                                                                                                                                                                                                                                                                       |
| `rate`                    | 429                                                                                                                                  | `ai_usage_daily.failed_429` counter, short backoff, breaker-relevant                                                                                                                                                                                                                                                                                                                                                                                                               |
| `schema`                  | malformed JSON from chat roles                                                                                                       | surfaced as pipeline failure → job `markFailed` (retry)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `config`                  | 401/404 model-not-found, **non-conforming model at an external embed endpoint** (wrong dim, or reference-kit median below threshold) | role marked probe_failed(reason incl. `nonConformingEndpoint`), admin card CTA; jobs park (role treated as not-candidate); a save-time verify failure prevents the override from being stored at all (llmPresets §2.5)                                                                                                                                                                                                                                                             |
| `provisioning` (embedded) | no network at the provisioning trigger, checksum mismatch, disk full, partial download                                               | the attempt logs the failure (boot-path attempt: boot continues; in-place attempt: server keeps serving) ⇒ **embed caps OFF** + admin card (reason + retry action); the row carries `preparing(phase='provisioning', progress)` while running and flips to off-with-reason on failure; atomic staging ⇒ a partial file is never consumed; one retry per trigger, admin "re-provision" = manual trigger; remote override active ⇒ deferral is the normal state — no caps-off signal |

### 2.9 Usage counting

Every provider round-trip (including cached-hit accounting) upserts
`ai_usage_daily(day, role, calls, input_chars, cached, degraded, failed_429)` PK
`(day,role)` — the admin cost ledger reads it per-role; day rollover is a new PK row
(no reset job); reconfig resets BREAKERS, not history.

## 3. Configuration (T2 / dbOnly; API keys secret=true)

`LLM_{EMBED,CHAT,VISION,ASR}_{BASE_URL,API_KEY,MODEL}`, `LLM_MAX_INPUT_CHARS`,
`LLM_CHUNK_BUDGET` (4), `LLM_OVERLENGTH_POLICY` (`chunk-pool`), `LLM_DAILY_CALL_CAP`/
`LLM_DAILY_TOKEN_CAP` (0), `LLM_REPROBE_DEBOUNCE_S` (60), `LLM_BREAKER_THRESHOLD` (5),
`LLM_BREAKER_COOLDOWN_S` (300) (§2.5 breaker tunables),
`AI_SEMANTIC_SEARCH_ENABLED` (consumed by searchService, listed here as the query-embed
kill switch family).

## 4. Dependencies

- `configResolver` (per-call), `backendHealth` (report/getHealth), `backendProbe`
  (`runProbe` target registration), `settingsStore` via resolver, `ai_usage_daily`
  repository, [llmPresets](llmPresets.md) manifest
- Consumers: aiJobService pipelines, searchService (`embedQuery`), collectionsService
  (presence + llmNamer), evolutionService (merge-arbiter), setup wizard + admin config
  test surfaces. NO consumer may talk HTTP to a provider directly (single gateway).

## 5. Verification Scenarios

- [ ] Settings PUT flips `LLM_CHAT_MODEL` ⇒ next call uses a NEW client (signature
      change), old client dropped; re-probe debounced ≤60s; budget counters + breakers
      reset; no restart, no in-flight job aborted (adopts next job)
- [ ] `.env`-provided `LLM_*` value ⇒ NEVER effective: resolver reads DB → default
      (`dbOnly`, env ignored — configRegistry §3); the DB `settings` row remains the single
      config surface
- [ ] Unconfigured role ⇒ `roleConfigured` false, capability flags false, dependent
      features absent (never 404/5xx); configuring it mid-run flips `settings/public.ai`
      live
- [ ] Probe matrix: text-only endpoint fed the vision sample ⇒ `vision_chat` OFF +
      declared-vs-probed admin warning (a base64-as-text fixture reproduces the known
      failure mode); sine-tone audio sample NEVER used (test asserts the
      speech fixture is in the probe set)
- [ ] Embedded trigger matrix: a CONFIGURED boot with an empty model dir ⇒ boot blocks,
      progress lines emitted, files land checksum-verified, probe passes, embed caps ON; a
      setup-mode boot ⇒ no attempt at all (zero egress asserted by network stub); setup
      completion / override clear ⇒ in-place run (server already listening, `ai.embed` reports
      `preparing(phase='provisioning', progress)`, jobs of the embed kind stay parked and drain
      in order on caps-ON); corrupt one byte (fixture) ⇒
      `provisioning` failure path ⇒ caps OFF + reason, server still starts/serves; pre-seeded dir ⇒
      zero fetch calls (network stub asserts no requests); `LLM_EMBED_*` remote triple set ⇒
      embedded provider replaced (override) ONLY after probe + conformance pass — a
      same-dim wrong-model remote (embeddinggemma-1 twin fixture, alias-renamed to
      "embeddinggemma-2") must be rejected (`nonConformingEndpoint`, built-in untouched —
      rejection asserts the endpoint's self-declared name is never consulted); only one
      embed model active; engine + precision/revision annotations on the registry row
- [ ] Media-embed probe against the fake server that SILENTLY DROPS media fields (returns
      the text vector, HTTP 200 — reproduces the known silent media-drop failure mode):
      positive-control probe must fail it ⇒ media capability OFF + fallback V2/V0, while
      `text_embed` stays ON; correctly-shaped fake returns pass the near-dup + divergence
      checks
- [ ] `embedQuery`/`embed` bodies carry the profile prefixes; `embedMedia` bodies carry
      NONE; profile-declared `pooling` mismatch vs `/props` ⇒ `text_embed` OFF with reason
- [ ] Media over budget → segment ladder (fixed audio windows / sampled frames), segment
      rows + pooled row stored, `source='media_direct'`; no head-truncate on media
- [ ] Budget chain order: admin char cap beats published metadata beats preset default;
      with all absent, one real length-class failure halves the budget and the
      limiter never raises it back on success (sequence assertion)
- [ ] Length-class failure on embed ⇒ ladder walks chunk-pool→head→metadata_only→skip;
      job does not fail; `truncated`/`degraded` observable; histogram counter moved
- [ ] Chat requests carry `chat_template_kwargs.enable_thinking=false` (fake server
      capture) unless `llm_models.reasoning='on'`; no effort params on a family probed
      unsupported
- [ ] `embedQuery`: cache hit ⇒ zero provider calls; provider timeout ⇒ throws
      `transport`, searchService returns degraded-empty semantic (integration), 5xx never
      surfaces
- [ ] Daily cap hit ⇒ `breakerState=budget_paused`, role's kinds stop being claimed
      (aiJobService §2.3), day rollover + reconfig reset behavior; `ai_usage_daily`
      columns (calls/input_chars/cached/degraded/failed_429) move only on their events
- [ ] Grep: no HTTP client usage outside `adapters/llm/**` for LLM traffic; no
      `CacheAdapter` import; boot path does not require any `LLM_*` value

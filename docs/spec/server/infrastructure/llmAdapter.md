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
- **Peers:** `clients/` (Ollama / OpenAI-compatible / TEI-class dialects per preset),
  `probe.js` (suite), `budget.js` (chain + limiter + breaker),
  `presets.js` ([llmPresets spec](llmPresets.md))
- **Test file:** `server/infrastructure/adapters/llm/__tests__/llmAdapter.test.js`
  (+ fake-server E2E leg, in-process adapter injection)

### 2.2 Per-call config resolution + signature-keyed client cache

- Resolution per call via `configResolver` (5s TTL; `invalidateCache` fired on settings
  PUT): each role reads `{BASE_URL, API_KEY, MODEL}` → keys
  `LLM_EMBED_*`, `LLM_CHAT_*`, `LLM_VISION_*`, `LLM_ASR_*` (API keys `secret:true` —
  masking only, plaintext at rest). All `LLM_*` keys are T2 `dbOnly` (configRegistry §3):
  the resolver reads DB → default and **ignores env** — a `.env`-provided `LLM_*` value is
  never effective, and the DB `settings` row is the single config surface (wizard
  and admin editor both write rows).
- **Client cache keyed by the resolved-config SIGNATURE**
  (`sha256(base_url∥model∥api_key∥dialect)`): rebuild on change — no full teardown.
  `getRoleClient(role)` → client | `null` (role unconfigured ⇒ null ⇒ capability degrades,
  never fatal).
- **On signature change:** re-probe the role (debounced ~60s; admin "test" button =
  manual trigger) → `backendHealth` rows update → `settings/public` `ai:{embed,chat}`
  flags flip live (email_enabled precedent `settings.js:18-29`). Running enrichment
  workers adopt the new config at the NEXT job; query-embed adopts at the next request
  (mid-switch failure degrades — never surfaces as error); budget breakers and
  daily counters RESET on reconfig.

### 2.3 Public API

| Export                                              | Contract                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `roleConfigured(role)`                              | `true` iff the role resolves a non-empty `{base_url, model}` (presence, not probe — probes gate CAPABILITY, see §2.4)                                                                                                                                                                                  |
| `embed(texts[])`                                    | batch per provider `batch_size` (llm_models row); returns `{vectors[][], dim, modelId, degraded?}`; pooled/chunk callers (worker) decide the ladder; applies the profile's `requestShape` + TEXT prefixes (§2.6)                                                                                       |
| `embedMedia(buffers[], {mediaType})`                | V1/V3 direct media embed: image/audio/video bytes → same embed role, NO text prefix, profile `requestShape` (media rides the `content`-wrapper); oversized media enters the §2.6 MEDIA segment ladder; returns `{vectors[][], dim, modelId, degraded?}`                                                |
| `embedQuery(query)`                                 | Request-path wrapper (query embed): <100 ms-class (serving-mode profiled — CPU-served multimodal embedders FAIL this gate), `query_parses` signature-cache read/write first, kill-switch respected, timeout ⇒ throw `transport` (caller degrades to empty section); applies the profile's query prefix |
| `chat(messages, {schema?, maxTokens?, reasoning?})` | JSON-schema-forced where supported; `reasoning` defaults OFF (§2.7); returns `{json, text, usage, truncated}`                                                                                                                                                                                          |
| `visionCaption(frames[], {prompt})`                 | V2 path ONLY from worker context                                                                                                                                                                                                                                                                       |
| `asrTranscribe(audioBuffer, {escapePrompt: true})`  | escape-prompt is part of the fixed template — callers cannot omit it.                                                                                                                                                                                                                                  |
| `probeLlm()`                                        | suite (§2.4); `runProbe(target='llm')` registration in `backendProbe.js:263` + `POST /api/admin/config/test` target `llm` + `/api/setup/test` target `llm` (wizard)                                                                                                                                    |
| `breakerState(role)` / `budgetStatus()`             | admin card inputs: `ok \| budget_paused \| breaker_open(cooldown_left)` + `ai_usage_daily` rows                                                                                                                                                                                                        |
| `syncModelRegistry()`                               | upsert `llm_models` rows from resolved configs + probe results (`dim`, `max_input_chars`, `chunk_budget`, `batch_size`, `reasoning`, `enabled`) — the registry is the adapter's persisted view, never hand-edited except `reasoning` (experiment switch)                                               |

### 2.4 Probe suite (IN-DOMAIN samples — hard rule)

Startup probe (symmetric to s3/webdav probes, `index.js:272-327`) is the INITIAL probe,
not the only one (hot re-probes per §2.2). Every probe sample is real in-domain material;
out-of-domain probes produce false negatives indistinguishable from false capability
claims:

- `embed`: real mixed-ko/en sentence set → verify non-empty, `dim` == profile, and
  NON-DEGENERACY (two distinct samples must not cosine ≥0.999 — catches constant-output
  endpoints). Text is sent with the profile's task prefixes. When the profile declares
  `pooling`, `/props` (llama family) is read: server pooling ≠ profile pooling ⇒ `text_embed`
  OFF with reason — pooling is SPACE-shaping (same weights, different space, zero errors).
- `image_embed` / `audio_embed` / `video_embed`: probes need POSITIVE CONTROLS
  in the profile `requestShape` — known failure mode: a multimodal-DECLARING endpoint
  silently ignores wrongly-shaped media and returns a TEXT vector with HTTP 200.
  Pass requires ALL of: (a) in-domain photo vs its
  re-encode cosine ≥ profile media near-dup floor; (b) the same bytes as base64 TEXT
  diverge (proves pixels were consumed — an INPUT-shaping failure, not a space change); (c) when
  `vision_chat` is also configured, image↔its-caption > image↔unrelated text. Audio:
  real-speech clip vs noise clip must yield DISTINCT vectors; sine/noise-only probes
  remain BANNED as pass criteria. A failed media probe switches ONLY that sub-capability
  (media falls back to the caption→E1 or metadata path), it never blocks `text_embed`.
- `chat`: instruction-following JSON echo on an in-domain prompt (tag extraction from one
  real sentence) → schema validity is the pass criterion.
- `vision_chat`: a REAL PHOTO sample → non-trivial caption. Known failure mode: an
  endpoint that embeds base64 images AS TEXT must be caught — pass additionally requires
  the caption to reference visual content (deterministic check: differs from the same
  request with the image removed beyond a length floor).
- `asr`: a REAL SPEECH clip → transcript overlapping expected words. Sine/noise probes
  are BANNED.

Result matrix = probe-verified ∩ configured roles ⇒ runtime capability flags.
Declared-but-failing ⇒ capability OFF + admin warning card (declared vs probed). User-
visible states are only ever `complete-working | absent`, never partial.
`not_configured | probe_failed(reason) | partial | ok` per-role is the ADMIN 4-state
surface; regular users see absent affordances, not disabled ones.

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
Circuit breaker (transport class): ≥5 consecutive transport failures ⇒ OPEN 300s, half-
open probe on expiry (operational tunables, T2; not profile constants).

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
frame-sampling to fit, image → single-item always; every segment vector returned
(`embeddings_chunk` rows) + mean+renormalized pooled row; segment windows are chunking-
profile params — changing them re-embeds the media (chunking-profile rule, §2.6).
`source='media_direct'`.
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

| Class       | Examples                                            | Handling                                                                                                                                                     |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `length`    | 400 token/input-too-long, context-overflow messages | §2.5 step-4 halving + `degraded` flag + histogram counter; NEVER fails a job (ladder degrades)                                                               |
| `transport` | timeout, ECONNRESET, 5xx, DNS                       | retry-within-job, consecutive-failure breaker (§2.5), surfaced to caller as degrade signal (services choose their fallback; request paths never 5xx on this) |
| `rate`      | 429                                                 | `ai_usage_daily.failed_429` counter, short backoff, breaker-relevant                                                                                         |
| `schema`    | malformed JSON from chat roles                      | surfaced as pipeline failure → job `markFailed` (retry)                                                                                                      |
| `config`    | 401/404 model-not-found                             | role marked probe_failed(reason), admin card CTA; jobs park (role treated as not-candidate)                                                                  |

### 2.9 Usage counting

Every provider round-trip (including cached-hit accounting) upserts
`ai_usage_daily(day, role, calls, input_chars, cached, degraded, failed_429)` PK
`(day,role)` — the admin cost ledger reads it per-role; day rollover is a new PK row
(no reset job); reconfig resets BREAKERS, not history.

## 3. Configuration (T2 / dbOnly; API keys secret=true)

`LLM_{EMBED,CHAT,VISION,ASR}_{BASE_URL,API_KEY,MODEL}`, `LLM_MAX_INPUT_CHARS`,
`LLM_CHUNK_BUDGET` (4), `LLM_OVERLENGTH_POLICY` (`chunk-pool`), `LLM_DAILY_CALL_CAP`/
`LLM_DAILY_TOKEN_CAP` (0), `LLM_REPROBE_DEBOUNCE_S` (60), breaker tunables (§2.5),
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

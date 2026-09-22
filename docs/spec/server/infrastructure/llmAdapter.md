# llmAdapter Spec

Target-contract spec.

## 1. Overview

| Item          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | The single gateway to every LLM provider: per-call config resolution, signature-keyed client cache (hot reconfiguration), role clients (`embed`/`chat`/`vision`/`asr`), the capability probe suite, the budget chain + breaker, the overlength ladder executor, error taxonomy, usage counting.                                                                                                                                                     |
| Hot by design | ALL `LLM_*` keys are T2 `dbOnly` (admin config, masked secrets, DB-stored plaintext — app-layer secret encryption removed). NOT boot-owned: LLM is an enrichment dependency (§2 invariant framing), so its config is FULLY hot — contrast recorded: native vector capability is boot-frozen (§4.13), LLM config never is. No `LLM_ENABLED` flag anywhere: role PRESENCE (non-empty resolved config) decides candidacy; PROBES decide truth (§4.23). |
| Never         | No LLM call blocks a request path except the two exception-family roles consumed by their services (query embed E2, `parse.nl`) — this adapter serves them under their cache/kill-switch contracts; enrichment/batch/naming/arbiter calls NEVER reach a request thread (vision-model request-path calls explicitly banned, invariant 11).                                                                                                           |

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
  masking only, plaintext at rest). All `LLM_*` keys are T2 `dbOnly` (registry §3/PLAN §6):
  the resolver reads DB → default and **ignores env** — a `.env`-provided `LLM_*` value is
  never effective, and the DB `settings` row is the single config surface (wizard §4.23.5
  and admin editor both write rows).
- **Client cache keyed by the resolved-config SIGNATURE**
  (`sha256(base_url∥model∥api_key∥dialect)`): rebuild on change — no full teardown.
  `getRoleClient(role)` → client | `null` (role unconfigured ⇒ null ⇒ capability degrades,
  never fatal).
- **On signature change:** re-probe the role (debounced ~60s; admin "test" button =
  manual trigger) → `backendHealth` rows update → `settings/public` `ai:{embed,chat}`
  flags flip live (email_enabled precedent `settings.js:18-29`). Running enrichment
  workers adopt the new config at the NEXT job; E2 query-embed adopts at the next request
  (mid-switch failure degrades per §4.12 — never surfaces as error); budget breakers and
  daily counters RESET on reconfig.

### 2.3 Public API

| Export                                              | Contract                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roleConfigured(role)`                              | `true` iff the role resolves a non-empty `{base_url, model}` (presence, not probe — probes gate CAPABILITY, see §2.4)                                                                                                                                    |
| `embed(texts[])`                                    | batch per provider `batch_size` (llm_models row); returns `{vectors[][], dim, modelId, degraded?}`; pooled/chunk callers (worker) decide the ladder                                                                                                      |
| `embedQuery(query)`                                 | E2 request-path wrapper: <100 ms-class, `query_parses` signature-cache read/write first, kill-switch respected, timeout ⇒ throw `transport` (caller degrades to empty section)                                                                           |
| `chat(messages, {schema?, maxTokens?, reasoning?})` | JSON-schema-forced where supported; `reasoning` defaults OFF (§2.7); returns `{json, text, usage, truncated}`                                                                                                                                            |
| `visionCaption(frames[], {prompt})`                 | V2 path ONLY from worker context                                                                                                                                                                                                                         |
| `asrTranscribe(audioBuffer, {escapePrompt: true})`  | escape-prompt is part of the fixed template — callers cannot omit it (§4.21)                                                                                                                                                                             |
| `probeLlm()`                                        | suite (§2.4); `runProbe(target='llm')` registration in `backendProbe.js:263` + `POST /api/admin/config/test` target `llm` + `/api/setup/test` target `llm` (wizard, §4.23.5)                                                                             |
| `breakerState(role)` / `budgetStatus()`             | admin card inputs (§4.15): `ok \| budget_paused \| breaker_open(cooldown_left)` + `ai_usage_daily` rows                                                                                                                                                  |
| `syncModelRegistry()`                               | upsert `llm_models` rows from resolved configs + probe results (`dim`, `max_input_chars`, `chunk_budget`, `batch_size`, `reasoning`, `enabled`) — the registry is the adapter's persisted view, never hand-edited except `reasoning` (experiment switch) |

### 2.4 Probe suite (IN-DOMAIN samples — hard rule §4.23)

Startup probe (symmetric to s3/webdav probes, `index.js:272-327`) is the INITIAL probe,
not the only one (hot re-probes per §2.2). Every probe sample is real in-domain material;
out-of-domain probes produce false negatives indistinguishable from false capability
claims (both error modes observed this the pre-implementation study):

- `embed`: real mixed-ko/en sentence set → verify non-empty, `dim` == profile, and
  NON-DEGENERACY (two distinct samples must not cosine ≥0.999 — catches constant-output
  endpoints).
- `chat`: instruction-following JSON echo on an in-domain prompt (tag extraction from one
  real sentence) → schema validity is the pass criterion.
- `vision_chat`: a REAL PHOTO sample → non-trivial caption. Known failure mode: an
  endpoint that embeds base64 images AS TEXT (empirically confirmed against
  `bge-m3@10.0.0.106:8082`) must be caught — pass additionally requires the caption to
  reference visual content (deterministic check: differs from the same request with the
  image removed beyond a length floor).
- `asr`: a REAL SPEECH clip → transcript overlapping expected words. Known failure mode:
  Hana's audio endpoint mis-probed with SINE TONES (declared-but-false AND
  absent-but-working both observed) — sine/noise probes are banned.

Result matrix = probe-verified ∩ configured roles ⇒ runtime capability flags.
Declared-but-failing ⇒ capability OFF + admin warning card (declared vs probed). User-
visible states are only ever `complete-working | absent`, never partial.
`not_configured | probe_failed(reason) | partial | ok` per-role is the ADMIN 4-state
surface (§4.12); regular users see absent affordances, not disabled ones.

### 2.5 Budget chain (4 steps — never by probing calls; owner correction 2026-09-16)

`llm_models.max_input_chars` is set by this chain, in order:

1. admin-set `LLM_MAX_INPUT_CHARS` (T2) wins;
2. else PUBLISHED capability metadata — free GETs only: `/v1/models` (n_ctx / OpenAI
   `max_input_tokens`), llama.cpp `/props`, ollama `/api/show`;
3. else the preset manifest's RELEASE-MEASURED default (e.g. llama.cpp ub-512 profile;
   OpenAI-embed 8,191) — release artifacts per §4.15 provenance;
4. else (and thereafter always) the PASSIVE, DOWNWARD-ONLY limiter: a real request that
   fails with a LENGTH-CLASS error HALVES that model's budget from then on — never
   self-raises; only admin/manual raises. Zero extra inference calls steady-state.

Daily caps: per-role `LLM_DAILY_CALL_CAP` / `LLM_DAILY_TOKEN_CAP` (0 = unlimited) →
budget breaker PAUSES the role (surface in admin; jobs park upstream, aiJobService §2.3).
Circuit breaker (transport class): ≥5 consecutive transport failures ⇒ OPEN 300s, half-
open probe on expiry (operational tunables, T2; not profile constants).

### 2.6 Overlength executor (ladder lives HERE, jobs consume its flags)

`LLM_OVERLENGTH_POLICY` (default `chunk-pool`) selects the entry point; the adapter
executes the §4.3 ladder and reports the outcome so the worker persists `source` +
`truncated`: paragraph/heading-boundary split (char-window fallback) → uniform-stride
sample ≤ `LLM_CHUNK_BUDGET` (4) chunks → every chunk vector returned for storage →
mean+renormalize for the pooled row → `truncate-head` → `metadata_only` → `skip`
(+journal note). Chat-role inputs NEVER hierarchical-summarize: head+stride excerpt only
(§4.3). char→token safety factor **1.7 (mixed text, E10)** — release constant shipped in
the profile, used to convert `max_input_chars` budgeting. Retrieval note (ownership):
the adapter only produces vectors; max-over-chunks SCORING is vectorStore's rule (§4.13).

### 2.7 `enable_thinking` / chat_template_kwargs handling

All chat roles default reasoning OFF (E5/E5b/E7b: extraction hit 99.8% JSON validity at
5–10× speed; "judgment needs thinking" was n=2 noise). Mechanism per provider family
(from the preset manifest): llama.cpp-compatible chat calls carry
`chat_template_kwargs: { "enable_thinking": false }` (verified on Hana gemma family);
`llm_models.reasoning ∈ on|off` is the per-model OVERRIDE for experiments only — never a
plan assumption. Reasoning-EFFORT tiers are exposed ONLY where probing finds support
(Gemma4/Hana: none — effort params must not be sent where unsupported: unknown params
break strict servers).

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
`(day,role)` — the §4.15 cost ledger reads it per-role; day rollover is a new PK row
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
- [ ] `.env`-provided key ⇒ resolver reports source env, editor locked (`setInEnv`), DB
      value ignored while set
- [ ] Unconfigured role ⇒ `roleConfigured` false, capability flags false, dependent
      features absent (never 404/5xx); configuring it mid-run flips `settings/public.ai`
      live
- [ ] Probe matrix: text-only endpoint fed the vision sample ⇒ `vision_chat` OFF +
      declared-vs-probed admin warning (base64-as-text fixture reproduces the
      `bge-m3` empirical case); sine-tone audio sample NEVER used (test asserts the
      speech fixture is in the probe set)
- [ ] Budget chain order: admin char cap beats published metadata beats preset default;
      with all absent, one measured length-class failure halves the budget and the
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

# llmPresets Spec

Target-contract spec.

## 1. Overview

| Item            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role            | The provider/server-family PRESET MANIFEST: per-family declarations of EXPECTED capabilities + recommended budgets + per-model profile constants. **Embed is MODEL-PINNED (embeddinggemma-2 only): exactly two embed providers — `embedded` (built-in, lockfile-verified) and `external-endpoint` (any dialect serving EG2, ACTIVATION-GATED by reference conformance, §2.3).** Provider breadth + "adding a provider = adding a row" remain the rule for chat/vision/asr; CORE CODE NEVER BRANCHES ON PROVIDER NAMES. |
| Authority split | Presets declare EXPECTED; [llmAdapter](llmAdapter.md) §2.4 probes decide ACTUAL. Declared-but-failing ⇒ capability OFF + admin warning card (declared vs probed).                                                                                                                                                                                                                                                                                                                                                      |
| Provenance rule | Every numeric constant the AI passes (cos thresholds, ef_search, char/token factor) is a RELEASE ARTIFACT produced by the project on its dev-owned reference set. No runtime calibration, no dataset shipped to end users (measured corpus drift is the reserved re-open trigger).                                                                                                                                                                                                                                     |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/adapters/llm/presets.js` (frozen array + lookup)
- **Test file:** `server/infrastructure/adapters/llm/__tests__/presets.test.js`
- Consumed by: llmAdapter budget chain step 3 + probe expectation matrix + admin/setup
  preset picker UIs (wizard optional AI step — shortcut to the same DB rows);
  `SETUP.md` mirrors the table for operators.

### 2.2 Manifest schema (per row)

```js
{
 id: 'llamacpp-bge-m3', // stable slug, admin picker value only
 family: 'embedded' | 'llama.cpp' | 'ollama' | 'openai-compatible' | 'tei', // 'embedded' = in-process ONNX (the product default embed provider, no external server)
 roles: ['embed'|'chat'|'vision'|'asr'], // endpoints this row can serve
 engine: 'embedded' | 'remote', // llm_models.engine source (embedded needs no base_url)
 expected: { text_embed, image_embed, audio_embed, video_embed, chat, vision_chat, asr }, // BOOLEAN expectations (§2.4 map); media embed caps are embed-role sub-capabilities, probed separately
 lock: { // family 'embedded' ONLY — the trust boundary replacing a server URL
 repo, revision, // pinned HF commit (immutable resolve-URL)
 dtype: 'q4' | 'q8' | 'fp16' | 'fp32',
 files: [{ path, sha256 }], // verified at every provisioning trigger (never silently on setup-mode boots); mismatch ⇒ provisioning fails ⇒ caps OFF
 provisionDirEnv: 'WEA_MODEL_DIR', // else download at the provisioning trigger (BLOCKING within a boot-path trigger, CLI progress log; deferred while a remote override is active or setup mode is up)
 },
 conformance: { // family 'external-endpoint' (embed) ONLY — model-identity gate (llmAdapter.md §2.4)
 referenceKit: { strings, vectorsSha }, // checked-in release artifact: 24 fixed inputs + canonical
 //   embedded-q4 float32 vectors (base64) + sha — `server/infrastructure/adapters/llm/eg2-reference-kit.json`
 metric: 'median-cos', // aggregate statistic, never per-pair gating
 threshold: 'RELEASE ARTIFACT', // set by calibration on the dev reference set (SETUP.md checklist); never assumed
 // endpoint-reported NAMES are not identity evidence (freely aliasable) —
 // identity = structural (dim) + behavioral (this gate)
 },
 endpoints: { // free metadata GETs for budget-chain step 2 (remote families only)
 models: '/v1/models', props: '/props' // per family
 },
 budgets: { // step-3 fallbacks of the budget chain (llmAdapter.md §2.5)
 maxInputCharsDefault, chunkBudget: 4, batchSize
 },
 profile: { // model profile — release artifact
 dim, chPerTok, // chars→token safety factor
 edgeCos: { tight, mid, loose }, // kNN tier edges
 throughputDocsMin, calibrated: false, // provenance flag (always false in-product)
 // server-shape flags — probe-verified contract properties (llmAdapter.md §2.4).
 // Two DISTINCT silent-failure classes, never conflate:
 //   SPACE-shaping (pooling, dtype, mrlDims): same weights → different vector space.
 //   INPUT-shaping (requestShape, textPrefixes): same space → wrong/omitted input
 //     embedded anyway (media dropped, quality degraded) with a success response.
 requestShape: 'content-wrapper' | 'plain-input', // embeddings body dialect (INPUT-shaping)
 textPrefixes: { query, document } | null, // task-prefix policy, text-only (INPUT-shaping)
 pooling: 'mean' | 'cls' | 'last', // SPACE-shaping; MUST match server config, probe-verified
 mrlDims: [768, 512, 256] | null, // SPACE-shaping; truncation → renorm mandatory
 dtype: 'bf16|fp32', // SPACE-shaping; fp16 unsafe (silent NaN/degradation)
 mediaTokenCost: { image, videoFrame, audioPerSec } | null, // budgeting, not a space change
 },
 kwargs: { enableThinkingChatTemplateKwarg: true|false, reasoningEffort: false }
}
```

Rows are FROZEN; the admin UI renders from the manifest; probe results persist to
`llm_models` + `backendHealth`, never back into the manifest.

### 2.3 Manifest rows (embedded-EG2 [default], bge-m3, embeddinggemma-2, gemma-4-12b-it)

**`embeddinggemma-2-onnx-q4` @ embedded (in-process, THE DEFAULT embed provider):**

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| family/engine   | embedded — no base_url, no external server; the product ships with embed capability turned on                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| lock.repo       | `onnx-community/embeddinggemma-2-ONNX`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| lock.revision   | pinned commit (immutable resolve-URL; current pin `daa72c51…`) — upgrading the model = new lockfile PR → new model_id                                                                                                                                                                                                                                                                                                                                                                                                                           |
| lock.dtype      | **q4** (default, 473 MB full set); q8 available as a quality-first profile alternative (dtype change = model change = re-embed, §4.15)                                                                                                                                                                                                                                                                                                                                                                                                          |
| caps (expected) | text/image/audio/video embed true — verified by the local boot probe (llmAdapter.md §2.4), not assumed                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| profile.numbers | dim 768, chPerTok 1.5, θ_dup 0.955, edgeCos provisional {0.86,0.80,0.72} — q4 text-band re-check open (release runbook); δ_base **0.08** (dynamic-baseline margin over the per-query sample spread; junk ceiling .073 < δ < real-single floor .083, POC §6.10)                                                                                                                                                                                                                                                                                  |
| provisioning    | provider-triggered: BLOCKING on a CONFIGURED boot where built-in is the active embed provider — the first boot after the wizard is ordinary boot processing under the same posture (setup mode itself makes zero download attempts); IN-PLACE server-non-blocking run (role reports `preparing` until done) when a remote override is cleared (restart-free); deferred while remote is active — switching never deletes existing weights; CLI per-file progress log, sha256-verified, atomic; `WEA_MODEL_DIR` pre-seed ⇒ zero download attempts |
| offline result  | provisioning attempt fails → embed caps OFF + admin prompt; the boot continues (configured-boot trigger) or the server keeps serving (in-place trigger) — enrichment-dependency, never a crash                                                                                                                                                                                                                                                                                                                                                  |
| latency         | text 0.13 s / image 7 s / audio-seg 3.85 s (dev-box CPU); informational profile field — no ship gate                                                                                                                                                                                                                                                                                                                                                                                                                                            |

External embed rows below are **overrides** (one active embed model, §4.20). No embed model
other than embeddinggemma-2 is supported; the manifest carries no other embed-model row.
An external endpoint must pass the `conformance` gate (§2.2) before the remote row
activates; dialect family only selects the transport.

**`embeddinggemma-2` @ external endpoint (llama.cpp ≥b11452; ollama/TEI/OpenAI-compat dialects same contract):**

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| modality          | text + image + audio + video (one shared space); expectations true, EACH sub-capability probe-gated (§2.4)                                                                                                                                                                                                                                                                                                                                                                                  |
| dim               | 768; MRL truncations 512/256 (128 text-only-degraded) — stored dim is a profile choice, renorm after truncation mandatory                                                                                                                                                                                                                                                                                                                                                                   |
| requestShape      | `content-wrapper` only — top-level media fields are SILENTLY IGNORED by llama.cpp embed endpoints (HTTP 200 returns the text vector); catch requires the §2.4 positive controls                                                                                                                                                                                                                                                                                                             |
| textPrefixes      | query `task: search result \| query:`, doc `title: … \| text: …`; NONE on media; omission degrades quality silently                                                                                                                                                                                                                                                                                                                                                                         |
| pooling           | mean — server flag mismatch silently reshapes the plain-text space; probe verifies via /props                                                                                                                                                                                                                                                                                                                                                                                               |
| dtype             | bf16/fp32 only — fp16 yields NaN/silent degradation                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| mediaTokenCost    | image 280 (70–1120 soft budget) / video 140 per frame @1 fps / audio 25 per sec; window 8,192 shared                                                                                                                                                                                                                                                                                                                                                                                        |
| serving ub limits | `-ub 512` rejects >~20 s audio / multi-frame video → media segment ladder (llmAdapter.md §2.6)                                                                                                                                                                                                                                                                                                                                                                                              |
| profile numbers   | chPerTok ≈1.5 budgeted (mean 1.74, worst ko+digits class 1.50); throughput ≈6.1k docs/min sequential / ≈12.1k batch-8 (GPU serving); edgeCos tiers {0.86, 0.80, 0.72} PROVISIONAL (zero stock-contamination verified in image space; text-space rerun outstanding); θ_dup text **0.955** — media θ are FLAG-ONLY (image 0.94: same-event pairs reach 0.990; audio 0.969: noise-type pairs reach 0.9988)                                                                                     |
| query-embed class | GPU serving measured ≈0.01 s/sentence; CPU serving seconds-class (EG2 measured ~3.8 s/sentence) — the profile records the serving mode under which latency was measured (informational)                                                                                                                                                                                                                                                                                                     |
| activation gate   | dim==768 (structural) + `conformance` reference kit (median-cos ≥ **0.90**, §2.2) — a same-dim DIFFERENT model (e.g. embeddinggemma-1: 768-d, text-only, different space) passes dim and must be caught here; endpoint self-naming is ignored. Fail ⇒ embed role OFF (`nonConformingEndpoint`), no partial state. In-EG2 precision drift is same-space variance and is NOT gated: θ constants are single-set per model; `precision`/`model_revision` are best-effort annotations, not gates |

| Capability    | Verdict                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `text_embed`  | OK — probe passes with prefixes + mean pooling; constants are per-model, none inherited from other rows |
| `image_embed` | probe via content-wrapper + positive controls only (declared multimodal is not evidence, §2.4)          |
| `audio_embed` | OK ≤ ub-derived window; long files = segment ladder                                                     |
| `video_embed` | NOT OFFERED until its probe passes (server must accept multi-frame inputs; `-ub` gate)                  |

**`gemma-4-12b-it` (chat/vision/asr):**

| Capability             | Verdict                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `vision_chat`          | OK (in-domain photo probe passes; V2 captions ship)                        |
| `asr`                  | OK in-domain (REAL SPEECH transcript passes; probes must be speech-shaped) |
| non-speech audio       | transcription-only scope; escape-prompt mandatory                          |
| `enable_thinking`      | switch WORKS via `chat_template_kwargs`; default reasoning-off ships       |
| reasoning effort tiers | UNSUPPORTED (probing finds none — params must not be sent)                 |

**Ollama / OpenAI-compatible / TEI-class CHAT-side rows — RELEASE MEASUREMENT PENDING.**
Scope: matrix + pending mechanics apply to **chat/vision/asr roles only** —
embed is model-pinned (embedded or external-EG2). Expectations ship (from published docs),
every PROFILE/BUDGET number is null-marked
`pending` and MUST be filled on the dev reference set before the row is offered in the
picker (governing rule: a complete bundle or not offered). The per-row measurement
checklist is a release-runbook concern, not product behavior (runbook: `docs/SETUP.md`,
preset table).

### 2.4 Capability → feature map (the UI gating source)

| Capability                                    | Features it gates                                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text_embed`                                  | semantic search, seed collections, auto-create (clusters), vector merges, near-dup                                                                   |
| `image_embed` / `audio_embed` / `video_embed` | media direct-embed (V1/V3): search/clustering/near-dup/seed on RAW media; absent ⇒ media falls back to V2 caption→E1 or V0 — never mixed-space reads |
| `chat`                                        | NL features/summary (`features.extract`), llmNamer, `parse.nl`, merge-arbiter/keeper-adjudicator advisories                                          |
| `vision_chat`                                 | VLM captions — display + adjudicator material, and the media-embedding FALLBACK path (when media caps are absent, caption→E1 carries media search)   |
| `asr`                                         | ASR transcription (transcript-only scope; generated audio ATTRIBUTES — genre/mood/kind — are not offered by any capability)                          |

Absent capability ⇒ the feature is ABSENT (regular users), not disabled — every
advertised path is end-to-end functional under its own preset. **`chat-only` (no embed)
is a legal deployment**: the entire vector core runs as the None column of the
feature-degradation matrix (manual
collections, rules, dups-by-hash, name search) — no half-AI state exists. Distinct from
DB vector capability: missing LLM capability REMOVES a feature; missing DB vector
capability only degrades SPEED (fallback) — never both ways.
**There is no embed fallback chain (model pin):** built-in provisioning failure ⇒ caps OFF;
external conformance failure ⇒ embed role OFF with reason. Neither silently substitutes
another model — the absence itself is the honest state (same stance as §4.23.2 media caps).

**Media embed capabilities (`image_embed`/`audio_embed`/`video_embed`) are manifest
members** — consumers are the media direct-embed pipeline (V1/V3).
Expectations are advisory; probes (§2.4) gate each sub-capability.

### 2.5 Preset consumption surfaces

- Admin `/api/admin/config` editor: **embed = two-way choice** — `Built-in (default)` with
  its provisioning status card (`ready` / `preparing` download-progress / failed→caps-OFF reason),
  or `External endpoint` (dialect + base-url/key/model + **[verify]**: probe incl. the
  `conformance` gate must pass before the override saves; measured reference-kit median is
  displayed on the card). One active embed model; clearing the override returns to built-in —
  weights present ⇒ instant, absent ⇒ provisioning runs in place with the status card,
  restart-free.
  Other roles: preset picker → fills role fields → per-role test
  (`POST /api/admin/config/test` target `llm`); values stored as DB settings rows.
- Setup wizard OPTIONAL skippable "AI" step — **chat/vision/asr only** (embed needs no setup:
  the built-in engine auto-provisions on configured boots (zero bytes fetched while the wizard
  is up — provisioning begins at the next boot after the required restart), §4.2). preset picker → role checkboxes →
  base-url/key/model → per-role test (`/api/setup/test` target `llm`) — DB rows, NOT
  `.env`/envFileWriter (hot-apply rule): skipped step costs nothing, mid-install
  config is restart-free. The step also shows the embedded-engine provisioning status card
  (waiting state "begins at the next boot" during the wizard; live per-file progress and
  the ready/caps-off outcome on the first configured boot after the restart).
- Capability matrix display (per-role probe chips) is SHARED by both surfaces.

## 3. Dependencies

- Static data only (manifest); read by llmAdapter (`presets.js` import) and the admin/
  setup config route render helpers. No DB, no network.

## 4. Verification Scenarios

- [ ] Adding a hypothetical provider = adding ONE manifest row: grep-assert no provider
      string appears in adapter/service control flow (`switch (provider)` ban)
- [ ] All rows frozen; `findPreset(id)` lookup; unknown id ⇒ picker shows nothing, no
      crash
- [ ] Manifest rows carry non-null profile numbers; pending
      rows carry EXPLICIT `null` + `pending: true` — the wizard/admin picker refuses to
      complete a pending row without the operator acknowledging the fallback
      (defaults from expectations, budgets unset ⇒ budget chain falls to step 4 limiter)
- [ ] Media embed capabilities (`image_embed`/`audio_embed`/`video_embed`) present in
      manifest + types + consumers (grep)
- [ ] Probe result overrides expectation in BOTH directions: declared-not-probed ⇒ off +
      warning; undeclared-but-probed ⇒ capability ON with an "undeclared" admin note
      (expected set is advisory, probe is authority)
- [ ] Embed manifest rows carry ONLY embeddinggemma-2 (grep: no other embed model slug);
      bge-m3/other-model embed support absent from manifest, types, presets.js and fixtures
- [ ] Tag layer has no vector surface: no `tag_embeddings`/`tag_parents` consumers, no
      θ_tag/θ_lo constants anywhere (grep)
- [ ] Conformance gate fixture: a 768-dim DIFFERENT model served behind an
      "embeddinggemma-2"-ALIASED endpoint (fixture) ⇒ dim check passes, conformance fails ⇒
      embed role OFF + `nonConformingEndpoint`; assert no code path consults the endpoint's
      self-declared name for identity
- [ ] built-in lock dtype change ships as a new lock revision ⇒ new `llm_models` row
      (model_id change, re-embed policy §4.2); remote endpoint precision stays annotation —
      no precision-gate code path exists (grep)
- [ ] `embedded` default row: lockfile parses (repo/revision/dtype/files[] with sha256);
      a CONFIGURED boot with EMPTY `WEA_MODEL_DIR` blocks provisioning with per-file progress
      logs and ends checksum-verified; a setup-mode boot makes NO attempt (zero network egress,
      network-stub asserted), and the first boot after setup uses the SAME blocking boot
      posture — no special event; override-clear fires the IN-PLACE trigger (server keeps
      serving, `ai.embed` row carries `preparing(phase='provisioning')` until the
      outcome); pre-seeded dir ⇒ zero download attempts, zero network egress;
      one corrupted byte in one file ⇒ provisioning failure (atomic partial files never
      consumed) ⇒ embed caps OFF + admin reason, product boots or keeps serving

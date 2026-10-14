# llmPresets Spec

Target-contract spec.

## 1. Overview

| Item            | Description                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role            | The provider/server-family PRESET MANIFEST: per-family declarations of EXPECTED capabilities + recommended budgets + per-model profile constants. Adding a provider = adding a manifest row; CORE CODE NEVER BRANCHES ON PROVIDER NAMES.                                           |
| Authority split | Presets declare EXPECTED; [llmAdapter](llmAdapter.md) §2.4 probes decide ACTUAL. Declared-but-failing ⇒ capability OFF + admin warning card (declared vs probed).                                                                                                                  |
| Provenance rule | Every numeric constant the AI passes (cos thresholds, ef_search, char/token factor) is a RELEASE ARTIFACT produced by the project on its dev-owned reference set. No runtime calibration, no dataset shipped to end users (measured corpus drift is the reserved re-open trigger). |

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
 files: [{ path, sha256 }], // verified at boot; mismatch ⇒ provisioning fails ⇒ caps OFF
 provisionDirEnv: 'WEA_MODEL_DIR', // else download-at-boot (BLOCKING, CLI progress log)
 },
 endpoints: { // free metadata GETs for budget-chain step 2 (remote families only)
 models: '/v1/models', props: '/props' // per family
 },
 budgets: { // step-3 fallbacks of the budget chain (llmAdapter.md §2.5)
 maxInputCharsDefault, chunkBudget: 4, batchSize
 },
 profile: { // model profile — release artifact
 dim, chPerTok, // chars→token safety factor
 edgeCos: { tight, mid, loose }, thetaLo, // kNN tiers + tag-parent θ_lo
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

| Field           | Value                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| family/engine   | embedded — no base_url, no external server; the product ships with embed capability turned on                                          |
| lock.repo       | `onnx-community/embeddinggemma-2-ONNX`                                                                                                 |
| lock.revision   | pinned commit (immutable resolve-URL; the 2026-10-14 pin is `daa72c51…`) — upgrading the model = new lockfile PR → new model_id        |
| lock.dtype      | **q4** (default, 473 MB full set); q8 available as a quality-first profile alternative (dtype change = model change = re-embed, §4.15) |
| caps (expected) | text/image/audio/video embed true — verified by the local boot probe (llmAdapter.md §2.4), not assumed                                 |
| profile.numbers | dim 768, chPerTok 1.5, θ_dup 0.955, edgeCos provisional {0.86,0.80,0.72} — q4 text band re-check + q4 audio-drift open (Q12)           |
| provisioning    | boot-blocking, CLI per-file progress log, sha256-verified, atomic; `WEA_MODEL_DIR` pre-seed skips download                             |
| offline result  | provisioning attempt fails → embed caps OFF + admin prompt; product still boots (enrichment-dependency)                                |
| latency         | text 0.13 s / image 7 s / audio-seg 3.85 s on 6-core dev CPU (NOT target-hardware promise — §4.2 E2 gate verdict is per-deployment)    |

External llama.cpp/HTTP rows below are **overrides**: configuring one replaces the built-in
embed provider (one active embed model, §4.20); the built-in is the zero-config default.

**`bge-m3` @ llama.cpp (embed):**

| Field            | Value                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| modality         | TEXT ONLY — vision/audio expectations false                                            |
| dim              | 1024                                                                                   |
| budget profile   | llama.cpp ub-512 build profile (`maxInputCharsDefault` from the ub-512 context budget) |
| chPerTok         | ≈1.7 chars/token (release constant)                                                    |
| throughput       | ≈15k docs/min (local batch)                                                            |
| degeneracy check | distinct samples → non-degenerate cosines                                              |

**`embeddinggemma-2` @ llama.cpp ≥b11452 (embed, multimodal):**

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| modality          | text + image + audio + video (one shared space); expectations true, EACH sub-capability probe-gated (§2.4)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| dim               | 768; MRL truncations 512/256 (128 text-only-degraded) — stored dim is a profile choice, renorm after truncation mandatory                                                                                                                                                                                                                                                                                                                                                                                                               |
| requestShape      | `content-wrapper` only — top-level media fields are SILENTLY IGNORED by llama.cpp embed endpoints (HTTP 200 returns the text vector); catch requires the §2.4 positive controls                                                                                                                                                                                                                                                                                                                                                         |
| textPrefixes      | query `task: search result \| query:`, doc `title: … \| text: …`; NONE on media; omission degrades quality silently                                                                                                                                                                                                                                                                                                                                                                                                                     |
| pooling           | mean — server flag mismatch silently reshapes the plain-text space; probe verifies via /props                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| dtype             | bf16/fp32 only — fp16 yields NaN/silent degradation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| mediaTokenCost    | image 280 (70–1120 soft budget) / video 140 per frame @1 fps / audio 25 per sec; window 8,192 shared                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| serving ub limits | `-ub 512` rejects >~20 s audio / multi-frame video → media segment ladder (llmAdapter.md §2.6)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| profile numbers   | chPerTok ≈1.5 budgeted (mean 1.74, worst ko+digits class 1.50); throughput ≈6.1k docs/min sequential / ≈12.1k batch-8 (GPU serving); edgeCos tiers {0.86, 0.80, 0.72} PROVISIONAL (zero stock-contamination verified in image space; text-space rerun outstanding); θ_dup text **0.955** — media θ are FLAG-ONLY (image 0.94: same-event pairs reach 0.990; audio 0.969: noise-type pairs reach 0.9988); thetaLo **UNRESOLVED** — containment and sibling bands overlap in this space, the absolute-θ rule is not satisfied as designed |
| query-embed class | passes <100 ms only at GPU serving; CPU serving does not meet the gate — the profile records the serving mode under which the gate was measured                                                                                                                                                                                                                                                                                                                                                                                         |

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

**Ollama / OpenAI-compatible / TEI-class rows — RELEASE MEASUREMENT PENDING.**
Expectations ship (from published docs), every PROFILE/BUDGET number is null-marked
`pending` and MUST be filled on the dev reference set before the row is offered in the
picker (governing rule: a complete bundle or not offered). The per-row measurement
checklist is a release-runbook concern, not product behavior (runbook: `docs/SETUP.md`,
preset table).

### 2.4 Capability → feature map (the UI gating source)

| Capability                                    | Features it gates                                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text_embed`                                  | semantic search, seed collections, auto-create (clusters), vector merges, near-dup, `tag_embeddings` matching                                        |
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

**Media embed capabilities (`image_embed`/`audio_embed`/`video_embed`) are manifest
members** — consumers are the media direct-embed pipeline (V1/V3).
Expectations are advisory; probes (§2.4) gate each sub-capability.

### 2.5 Preset consumption surfaces

- Admin `/api/admin/config` editor: shows the **embedded engine as the default embed row**
  (provisioning status: provisioned / download-progress / offline-failed→caps-OFF) and, below
  it, override rows — picking an external embed server replaces the built-in (one active embed
  model). Other roles: preset picker → fills role fields → per-role test
  (`POST /api/admin/config/test` target `llm`); values stored as DB settings rows.
- Setup wizard OPTIONAL skippable "AI" step — **chat/vision/asr only** (embed needs no setup:
  the built-in engine auto-provisions at boot, §4.2). preset picker → role checkboxes →
  base-url/key/model → per-role test (`/api/setup/test` target `llm`) — DB rows, NOT
  `.env`/envFileWriter (hot-apply rule): skipped step costs nothing, mid-install
  config is restart-free. The step also shows the embedded-engine provisioning status card.
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
- [ ] `bge-m3` row values match this spec's table (dim 1024, chPerTok 1.7, ub-512
      budget, text-only expectations) — drift between doc and code fails CI
- [ ] `embeddinggemma-2` (llama.cpp) row: measured profile values shipped; the §4.18
      parent-hints FEATURE stays absent while `thetaLo` is unresolved (Q11 owner decision —
      the provider itself is offered; absent, not degraded)
- [ ] `embedded` default row: lockfile parses (repo/revision/dtype/files[] with sha256);
      boot with EMPTY `WEA_MODEL_DIR` blocks provisioning with per-file progress logs and
      ends checksum-verified; pre-seeded dir ⇒ zero download attempts, zero network egress;
      one corrupted byte in one file ⇒ provisioning failure (atomic partial files never
      consumed) ⇒ embed caps OFF + admin reason, product boots
- [ ] dtype is part of identity: switching lock dtype q4↔q8 yields a different
      `llm_models` row (new model_id); no cross-precision vector comparison passes CI

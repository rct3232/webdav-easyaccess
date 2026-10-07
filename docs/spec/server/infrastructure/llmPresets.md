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
 family: 'llama.cpp' | 'ollama' | 'openai-compatible' | 'tei',
 roles: ['embed'|'chat'|'vision'|'asr'], // endpoints this row can serve
 expected: { text_embed, chat, vision_chat, asr }, // BOOLEAN expectations (§2.4 map)
 endpoints: { // free metadata GETs for budget-chain step 2
 models: '/v1/models', props: '/props' // per family
 },
 budgets: { // step-3 fallbacks of the budget chain (llmAdapter.md §2.5)
 maxInputCharsDefault, chunkBudget: 4, batchSize
 },
 profile: { // model profile — release artifact
 dim, chPerTok, // chars→token safety factor
 edgeCos: { tight, mid, loose }, thetaLo, // kNN tiers + tag-parent θ_lo
 throughputDocsMin, calibrated: false // provenance flag (always false in-product)
 },
 kwargs: { enableThinkingChatTemplateKwarg: true|false, reasoningEffort: false }
}
```

Rows are FROZEN; the admin UI renders from the manifest; probe results persist to
`llm_models` + `backendHealth`, never back into the manifest.

### 2.3 Manifest rows (bge-m3, gemma-4-12b-it)

**`bge-m3` @ llama.cpp (embed):**

| Field            | Value                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| modality         | TEXT ONLY — vision/audio expectations false                                            |
| dim              | 1024                                                                                   |
| budget profile   | llama.cpp ub-512 build profile (`maxInputCharsDefault` from the ub-512 context budget) |
| chPerTok         | ≈1.7 chars/token (release constant)                                                    |
| throughput       | ≈15k docs/min (local batch)                                                            |
| degeneracy check | distinct samples → non-degenerate cosines                                              |

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

| Capability    | Features it gates                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `text_embed`  | semantic search, seed collections, auto-create (clusters), vector merges, near-dup, `tag_embeddings` matching |
| `chat`        | NL features/summary (`features.extract`), llmNamer, `parse.nl`, merge-arbiter/keeper-adjudicator advisories   |
| `vision_chat` | VLM captions — the ONLY media intelligence beyond ffprobe                                                     |
| `asr`         | ASR transcription (transcript-only scope)                                                                     |

Absent capability ⇒ the feature is ABSENT (regular users), not disabled — every
advertised path is end-to-end functional under its own preset. **`chat-only` (no embed)
is a legal deployment**: the entire vector core runs as the None column of the
feature-degradation matrix (manual
collections, rules, dups-by-hash, name search) — no half-AI state exists. Distinct from
DB vector capability: missing LLM capability REMOVES a feature; missing DB vector
capability only degrades SPEED (fallback) — never both ways.

**Explicitly NOT in the manifest: `image_embed`** — the product has a single text space;
no product path consumes image embeddings.

### 2.5 Preset consumption surfaces

- Admin `/api/admin/config` editor: preset picker → fills role fields → per-role test
  (`POST /api/admin/config/test` target `llm`); values stored as DB settings rows.
- Setup wizard OPTIONAL skippable "AI" step: preset picker → role checkboxes →
  base-url/key/model → per-role test (`/api/setup/test` target `llm`) — DB rows, NOT
  `.env`/envFileWriter (hot-apply rule): skipped step costs nothing, mid-install
  config is restart-free.
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
- [ ] No `image_embed` key exists anywhere in the manifest, types, or consumers (grep)
- [ ] Probe result overrides expectation in BOTH directions: declared-not-probed ⇒ off +
      warning; undeclared-but-probed (e.g. future TEI vision) ⇒ capability ON with a
      "undeclared" admin note (expected set is advisory, probe is authority)
- [ ] `bge-m3` row values match this spec's table (dim 1024, chPerTok 1.7, ub-512
      budget, text-only expectations) — drift between doc and code fails CI

# llmModelsStore Spec

## 1. Overview

| Item             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role             | Persistent model registry — table `llm_models(role, provider, engine, base_url_key, model_name, precision, model_revision, max_input_chars, chunk_budget, batch_size, reasoning, enabled)`. The registry is llmAdapter's PERSISTED VIEW (`syncModelRegistry`, llmAdapter §2.3): resolved role configs + probe/budget results land here; rows are never hand-edited except `reasoning` (per-model experiment switch, llmAdapter §2.7). `llm_models.id` is the MODEL-VERSION key consumed by the `embeddings` / `embeddings_chunk` / `ai_enrichments` / `collection_centroids` FKs (AI_FEATURE_PLAN §5). |
| Model versioning | A model version change (embedded lock revision change, llmPresets §4) is a NEW `llm_models` row — never an in-place mutation of the old row — so a stale-model vector can never mix into new-space math (§4.20/§4.21; `collection_centroids` keeps the model-version PK for the same reason). `precision` is an annotation only (§18: precision-level drift is same-space noise), never identity.                                                                                                                                                                                                      |
| Identity rule    | Natural identity = `(role, provider, engine, base_url_key, model_name, model_revision)`; a NULL `model_revision` matches only NULL (remote endpoints carry a verifiable revision only rarely, §4.15; embedded rows always carry the lock revision). The DDL has NO unique constraint on these columns — dedupe is the in-transaction pre-check (repository-contract rule 4). Embedded rows carry `base_url_key=''` (no URL — llmAdapter §2.2).                                                                                                                                                         |
| Dim note         | The DDL (single source of truth, PLAN §6) has NO `dim` column on `llm_models` — the ACTIVE model's dim lives in the preset profile and on the `embeddings.dim` rows. This store neither reads nor writes a dim.                                                                                                                                                                                                                                                                                                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/llmModelsStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/LlmModelsRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/LlmModelsRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/LlmModelsRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/llmModelsStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
  (`llm_models` block, incl. the §17 `engine`/`precision`/`model_revision` columns; declared
  BEFORE every table that references it — FK ordering per PLAN §6).

### 2.2 Row shape

`{ id, role, provider, engine, baseUrlKey, modelName, precision, modelRevision,
maxInputChars, chunkBudget, batchSize, reasoning, enabled, createdAt }` —
`role ∈ embed|chat|vision|asr`, `engine ∈ embedded|remote`, `reasoning ∈ on|off`
(TEXT+CHECK); `precision`/`modelRevision`/`maxInputChars`/`chunkBudget`/`batchSize`
nullable; `enabled` boolean; ids/timestamps domain-shaped (numbers, ISO strings).

### 2.3 Main Methods

| Method            | Signature                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `upsertModel`     | (spec) => Promise\<{ id }\>                 | Resolve the identity tuple in one TX: existing row ⇒ UPDATE the NON-identity fields only (`precision`, `max_input_chars`, `chunk_budget`, `batch_size`, `reasoning`, `enabled`) and return its `id`; otherwise INSERT. `spec`: `{ role, provider, engine?, baseUrlKey, modelName, precision?, modelRevision?, maxInputChars?, chunkBudget?, batchSize?, reasoning?, enabled? }` — `engine` defaults `'remote'`, `reasoning` `'off'`, `enabled` `true`. Same identity ⇒ same `model_id` forever (registry upsert is idempotent — restart-survival guarantee). |
| `getModel`        | (id) => Promise\<row \| null\>              | Single read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getActiveByRole` | (role) => Promise\<row \| null\>            | The ENABLED row of the role. If several enabled rows exist (transient registry states), the HIGHEST `id` wins (most recently provisioned) — the read is deterministic without write-ordering assumptions; the adapter owns the "one active model per role" invariant (llmPresets §2.3).                                                                                                                                                                                                                                                                      |
| `listByRole`      | (role) => Promise\<row[]\>                  | Registry history of the role (admin panel display), `id ASC`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `setReasoning`    | (id, 'on'\|'off') => Promise\<{ changes }\> | The single sanctioned hand edit (llmAdapter §2.7). Any other value is a TypeError BEFORE SQL (the DDL CHECK stays the last line of defense).                                                                                                                                                                                                                                                                                                                                                                                                                 |

Deliberately absent: delete methods (rows are FK targets — model lineage is history, never
garbage; a model swap disables, it does not delete), any dim read/write (§1 dim note).

### 2.4 Transaction Boundaries

- `upsertModel` is ONE `executor.transaction` (pre-check SELECT + INSERT/UPDATE).
- `setReasoning` and the reads are single statements.

### 2.5 Error Contracts

- Non-string `role`/`provider`/`modelName`/`baseUrlKey`, blank `role`/`provider`/`modelName`
  → TypeError before SQL (`baseUrlKey` MAY be `''` — embedded rows carry no URL, §1);
  CHECK violations (`role`/`engine`/`reasoning` enum) surface via `mapDatabaseError`.
- Reads → `null` / `[]`; `setReasoning` on an unknown id → `{ changes: 0 }`.

### 2.6 Restart Survival

Registry rows are DB truth and survive restarts untouched: no store code path deletes,
disables, or zeroes them at boot. Re-running `syncModelRegistry` (adapter, later unit) after
a restart is idempotent per identity — the same model version resolves to the SAME
`llm_models.id`, which is what keeps `embeddings`/`ai_enrichments` lineage columns stable
across restarts. Verified by asserting identical ids across a simulated restart (fresh
repository over the persisted database).

### 2.7 Dependencies

- `storage.getExecutor()` + `LlmModelsRepository` (+ twins).
- Callers: llmAdapter `syncModelRegistry` (writer), budget chain (`max_input_chars` reads),
  admin governance panel (registry display). No journal writes (registry state is
  configuration-derived, not a user-undoable act — §4.11).

### 2.8 Verification Scenarios

- [ ] `upsertModel` inserts once → `{id}`; the SAME identity again → the SAME id, one row
      total, non-identity fields updated (budget/precision refresh path)
- [ ] Same `(role, provider, engine, base_url_key, model_name)` with a DIFFERENT
      `model_revision` → a NEW row (new model_id on a lock revision change, llmPresets §4)
- [ ] A NULL-`model_revision` remote row does not collide with a revision-carrying row of
      the same name (NULL matches only NULL)
- [ ] `embedded` row with `base_url_key=''` persists; `engine='embedded'` stored verbatim
- [ ] `role`/`engine` CHECK violations reject; `setReasoning` rejects non-enum values with
      TypeError before SQL
- [ ] `getActiveByRole`: none → `null`; multiple enabled rows → highest id; disabled rows
      never returned
- [ ] `listByRole` returns the full history `id ASC` with domain-shaped rows (number ids,
      boolean `enabled`, ISO `createdAt`)
- [ ] `getModel` unknown id → `null`
- [ ] Restart survival: fresh repository over the same persisted DB returns the same rows
      with the same ids; a repeat `upsertModel` after the restart maps to the SAME id
- [ ] L2 conformance on both backends (sqlite default leg + `test:ci:pg:adapters`)

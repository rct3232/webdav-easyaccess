# aiTagStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Tag vocabulary substrate — facade over `tag_embeddings` (provider-global, model-keyed tag→vector cache) and `tag_parents` (display/grouping hint table).                                                                                                                                        |
| Hard scope   | **No alias or merge tables exist.** §4.18 retired the merge design (E6c: high-cosine pairs are spelling variants or hypernym containments, not synonyms); the orthographic fold is a read-time PURE FUNCTION and `tag_parents` is display-only, non-destructive. This store ships nothing else. |
| Out of scope | `ai_tag_raw` (materialized normalized grouping aid) is written by the tag pipeline service (DEF-25), not this facade; raw tags stay in `ai_features.tags`. Search-side fuzzy matching rides `tag_embeddings` vector similarity via vectorStore lookups (§3.2), never string equality here.      |
| Design owner | `docs/features/collections-platform.md` §4.18, §4.20 E3, §3.2 (tag predicates), §5 (schema rows).                                                                                                                                                                                               |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/aiTagStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/AiTagRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/AiTagRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/AiTagRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/aiTagStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/003_ai.sql` — §5 rows:
  `tag_embeddings(tag, model_id→llm_models, vector, updated_at, PK(tag,model_id))`,
  `tag_parents(child PK, parent, source CHECK(auto|admin), created_at)`.

### 2.2 Table contracts

**`tag_embeddings`** — global vocabulary cache (E3 batch, §4.20):

- PK `(tag, model_id)`; **provider-global, no user scoping** (§5). Tag cardinality is small.
- `model_id` is the embedding-space key — the same tag string has one row per model ever
  embedded against; consumers pass the ACTIVE model id on every read (same rule as
  `embeddingsStore`).
- `tag` is stored EXACTLY as given. **Decision:** the caller passes the orthographic
  canonical form (NFKC + whitespace/case fold, §4.18 step 1 — a pure function, zero
  tables); the store performs no normalization of its own.
- `vector` TEXT: same serialization/codec as pooled embeddings.

**`tag_parents`** — hierarchy HINTS only (§4.18 step 2):

- `child` is the PK ⇒ at most ONE parent per child (single-hint model; no multi-parent
  graph in v1).
- `source ∈ auto | admin`: auto rows come from the nightly containment rule
  (`containment ∧ cos ≥ profile θ_lo`, default 0.80→0.75 band per model profile);
  admin rows are manual edits.
- **Non-destructive contract:** nothing in this table rewrites or merges raw tags;
  `ai_features.tags` and `ai_tag_raw` are never read-modified by it; a wrong hint costs
  one odd group row (§4.18). The undo-journal `tags` domain stays reserved with NO writer
  precisely because there is no merge op to undo.

### 2.3 Main Methods — tag_embeddings

| Method                     | Signature                                                                     | Description                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `getTagVector`             | (tag, modelId) => Promise\<{ tag, modelId, dim, vector, updatedAt } \| null\> | dim is read back from the row's float count (repository maps it).                                |
| `getTagVectors`            | (tags, modelId) => Promise\<row[]\>                                           | Batch read; missing tags absent from the result.                                                 |
| `findTagsWithoutEmbedding` | (tags, modelId) => Promise\<tag[]\>                                           | Vocabulary-set minus cache — input list for the E3 batch embed job.                              |
| `upsertTagVector`          | (tag, modelId, vector) => Promise\<{ changes }\>                              | PK-pair upsert; the job re-runs cheaply (idempotent).                                            |
| `upsertTagVectors`         | (items, modelId) => Promise\<{ inserted }\>                                   | Batch upsert (`items: [{ tag, vector }]`) in one TX.                                             |
| `deleteByModel`            | (modelId) => Promise\<{ changes }\>                                           | Retires a model's whole space (admin model removal / after backfill completes on the new space). |

### 2.4 Main Methods — tag_parents

| Method             | Signature                                                          | Description                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getParent`        | (child) => Promise\<{ child, parent, source, createdAt } \| null\> | Single hint lookup.                                                                                                                                                 |
| `listParentHints`  | () => Promise\<row[]\>                                             | Full table (tiny), `ORDER BY child` — read-time display/grouping resolution + admin editor surface (§4.18 "Admin may view/edit").                                   |
| `upsertAutoParent` | (child, parent) => Promise\<{ changes }\>                          | Containment-rule write: INSERT ON CONFLICT `(child)` DO UPDATE **only when the existing row is `source='auto'`** — an auto pass never overwrites an admin decision. |
| `setAdminParent`   | (child, parent) => Promise\<{ changes }\>                          | Manual edit: unconditional upsert, stamps `source='admin'`.                                                                                                         |
| `deleteParent`     | (child) => Promise\<{ changes }\>                                  | Admin removes a hint; missing child → `changes: 0`.                                                                                                                 |

`tag_parents` has no `model_id` (textual containment relation, model-independent per §5);
re-running the auto rule after a model/profile change simply refreshes auto rows.

### 2.5 Transaction boundaries & error contracts

- Reads: `null` / `[]` for missing data.
- Writes: single statement or one TX per batch call; no `lockManager`, no journal (cache +
  display hints; admin edits ride the settings-style audit of §4.15, not the undo journal —
  **Decision:** parent edits are self-evident re-editable rows, undo would be theater).
- FK violation on `model_id` (retired model) surfaces as a mapped error at the repository.

### 2.6 Dependencies

- `storage.getExecutor()` + `AiTagRepository` (+ twins)
- Callers: E3 tag-embed batch job (DEF-25), tag predicate evaluation (collections service
  reads `getTagVectors` for §3.2 similarity predicates), admin AI tab (view/edit hints).

### 2.7 Verification Scenarios

- [ ] `upsertTagVector` twice → one row `(tag,modelId)`; same tag under a SECOND modelId → second row (space keying, no overwrite across spaces)
- [ ] `findTagsWithoutEmbedding` returns exactly the uncached subset, input order preserved
- [ ] `deleteByModel('1')` leaves other models' rows untouched (space teardown isolation)
- [ ] `upsertAutoParent` creates `source='auto'`; a second auto write for the same child replaces the parent; after `setAdminParent`, auto writes for that child are IGNORED (`changes: 0` semantics via the conditional DO UPDATE) and admin writes still replace
- [ ] `setAdminParent` on an existing auto row flips `source` to `'admin'`
- [ ] `deleteParent` on unknown child → `changes: 0`; `getParent` then `null`
- [ ] Non-destructive proof: writing/ deleting hints never touches `ai_features.tags` or `ai_tag_raw` (fixture assert)
- [ ] CHECK constraint rejects `source` outside `auto|admin` (mapped error)
- [ ] Store applies NO normalization: `getTagVector('시간 낭비')` and `getTagVector('시간낭비')` are independent rows (folding is the caller's pure function)
- [ ] Spec-level assertion (grep/doc): no `tag_aliases`/`tag_merges` table or repository exists in the DDL chain (§4.18 explicit state)
- [ ] L2 conformance (real sqlite + real PostgreSQL): PK pair semantics, conditional-upsert guard parity (`WHERE source <> 'admin'`), TEXT vector round-trip, batch expansion parity, FK `model_id` error mapping

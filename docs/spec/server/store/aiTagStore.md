# aiTagStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Tag vocabulary substrate — facade over `tag_embeddings` (provider-global, model-keyed tag→vector cache), `tag_parents` (display/grouping hint table) and `ai_tag_raw` (materialized folded tag→node grouping aid).                                                                                                                                                                                                                                                                                                                             |
| Hard scope   | **No alias or merge tables exist**; the orthographic fold is a read-time PURE FUNCTION and `tag_parents` is display-only, non-destructive. This store ships nothing else.                                                                                                                                                                                                                                                                                                                                                                      |
| Out of scope | Tag COMPUTATION is not this facade: LLM raw tags stay in `ai_features.tags` and the nightly normalization materialization is written by the tag pipeline service (evolutionService.md §2.10), local derived tags by `domains/ai/derivedTags.js` (v1 set: kind-prefixed `mime:`, `ext:`, `month:`, `path:`) — but the SQL SURFACE for `ai_tag_raw` rides this store (persistence policy: no SQL outside repositories). Search-side fuzzy matching rides `tag_embeddings` vector similarity via vectorStore lookups, never string equality here. |
| Design owner | `docs/features/collections-platform.md` §4.18, §4.20, §3.2 (tag predicates).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/aiTagStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/AiTagRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/AiTagRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/AiTagRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/aiTagStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql` — DDL rows:
  `tag_embeddings(tag, model_id→llm_models, vector, updated_at, PK(tag,model_id))`,
  `tag_parents(child PK, parent, source CHECK(auto|admin), created_at)`.

### 2.2 Table contracts

**`tag_embeddings`** — global vocabulary cache:

- PK `(tag, model_id)`; **provider-global, no user scoping**. Tag cardinality is small.
- `model_id` is the embedding-space key — the same tag string has one row per model ever
  embedded against; consumers pass the ACTIVE model id on every read (same rule as
  `embeddingsStore`).
- `tag` is stored EXACTLY as given: the caller passes the orthographic canonical form
  (NFKC + whitespace/case fold); the store performs no normalization of its
  own.
- `vector` TEXT: same serialization/codec as pooled embeddings — comma-separated floats
  (embeddingsStore §2.2 canonical codec). The repository parses the TEXT to `number[]` at
  the boundary and maps `dim` from the float count (§2.3); writers accept `number[]` or an
  already-serialized comma string and persist TEXT.

**`tag_parents`** — hierarchy HINTS only:

- `child` is the PK ⇒ at most ONE parent per child (single-hint model; no multi-parent
  graph in v1).
- `source ∈ auto | admin`: auto rows come from the nightly containment rule
  (`containment ∧ cos ≥ profile θ_lo`, default **0.75** per model profile);
  admin rows are manual edits.
- **Non-destructive contract:** nothing in this table rewrites or merges raw tags;
  `ai_features.tags` and `ai_tag_raw` are never read-modified by it. The undo-journal
  `tags` domain stays reserved with NO writer.

### 2.3 Main Methods — tag_embeddings

| Method                     | Signature                                                                     | Description                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `getTagVector`             | (tag, modelId) => Promise\<{ tag, modelId, dim, vector, updatedAt } \| null\> | dim is read back from the row's float count (repository maps it).                                |
| `getTagVectors`            | (tags, modelId) => Promise\<row[]\>                                           | Batch read; missing tags absent from the result.                                                 |
| `findTagsWithoutEmbedding` | (tags, modelId) => Promise\<tag[]\>                                           | Vocabulary-set minus cache — input list for the tag-embed batch job.                             |
| `upsertTagVector`          | (tag, modelId, vector) => Promise\<{ changes }\>                              | PK-pair upsert; the job re-runs cheaply (idempotent).                                            |
| `upsertTagVectors`         | (items, modelId) => Promise\<{ inserted }\>                                   | Batch upsert (`items: [{ tag, vector }]`) in one TX.                                             |
| `deleteByModel`            | (modelId) => Promise\<{ changes }\>                                           | Retires a model's whole space (admin model removal / after backfill completes on the new space). |

### 2.4 Main Methods — tag_parents

| Method             | Signature                                                          | Description                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getParent`        | (child) => Promise\<{ child, parent, source, createdAt } \| null\> | Single hint lookup.                                                                                                                                                 |
| `listParentHints`  | () => Promise\<row[]\>                                             | Full table (tiny), `ORDER BY child` — read-time display/grouping resolution + admin editor surface (admin may view/edit hints).                                     |
| `upsertAutoParent` | (child, parent) => Promise\<{ changes }\>                          | Containment-rule write: INSERT ON CONFLICT `(child)` DO UPDATE **only when the existing row is `source='auto'`** — an auto pass never overwrites an admin decision. |
| `setAdminParent`   | (child, parent) => Promise\<{ changes }\>                          | Manual edit: unconditional upsert, stamps `source='admin'`.                                                                                                         |
| `deleteParent`     | (child) => Promise\<{ changes }\>                                  | Admin removes a hint; missing child → `changes: 0`.                                                                                                                 |

`tag_parents` has no `model_id` (textual containment relation, model-independent);
re-running the auto rule after a model/profile change simply refreshes auto rows.

### 2.4.5 Main methods — ai_tag_raw

Grouping aid for tag predicates (None-column string equality) and nightly passes;
rows carry tags ALREADY folded by the caller (the store normalizes nothing).

| Method                | Signature                                 | Description                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listRawTags`         | (nodeId) => Promise\<tag[]\>              | Folded tags of one node, `ORDER BY tag`.                                                                                                                                                                                                                                                                                                                        |
| `listNodeIdsByRawTag` | (tag) => Promise\<nodeId[]\>              | Reverse lookup (`ai_tag_raw_tag_idx`) — drives cosine-free tag-atom evaluation; `node_id` asc.                                                                                                                                                                                                                                                                  |
| `replaceRawTags`      | (nodeId, tags) => Promise\<{ inserted }\> | ONE TX: DELETE rows of the node + INSERT the given folded set (dedup on the PK pair). Idempotent re-run with the same set ⇒ identical rows, `inserted` = set size; stale tags vanish with the delete — the caller OWNS the node's full tag set (v1: derived tags only; the LLM materialization pass replaces this call with a merged-set writer when it lands). |

### 2.5 Transaction boundaries & error contracts

- Reads: `null` / `[]` for missing data.
- Writes: single statement or one TX per batch call; no `lockManager`, no journal (cache +
  display hints; admin edits ride the settings-style audit, not the undo journal —
  parent edits are plain re-editable rows).
- FK violation on `model_id` (removed model) surfaces as a mapped error at the repository.

### 2.6 Dependencies

- `storage.getExecutor()` + `AiTagRepository` (+ twins)
- Callers: the tag-embed batch job, tag predicate evaluation (collections service
  reads `getTagVectors` for similarity predicates and `listNodeIdsByRawTag` for the
  cosine-free None-column match), the derived-tags pipeline and the nightly tag
  materialization (evolutionService.md §2.10) via the `ai_tag_raw` surface, admin AI tab (view/edit
  hints).

### 2.7 Verification Scenarios

- [ ] `upsertTagVector` twice → one row `(tag,modelId)`; same tag under a SECOND modelId → second row (space keying, no overwrite across spaces)
- [ ] `findTagsWithoutEmbedding` returns exactly the uncached subset, input order preserved
- [ ] `deleteByModel('1')` leaves other models' rows untouched (space teardown isolation)
- [ ] `upsertAutoParent` creates `source='auto'`; a second auto write for the same child replaces the parent; after `setAdminParent`, auto writes for that child are IGNORED (`changes: 0` semantics via the conditional DO UPDATE) and admin writes still replace
- [ ] `setAdminParent` on an existing auto row flips `source` to `'admin'`
- [ ] `deleteParent` on unknown child → `changes: 0`; `getParent` then `null`
- [ ] Non-destructive proof: writing/ deleting hints never touches `ai_features.tags` or `ai_tag_raw` (fixture assert)
- [ ] CHECK constraint rejects `source` outside `auto|admin` (mapped error)
- [ ] Store applies NO normalization: `getTagVector('wasted time')` and `getTagVector('wastedtime')` are independent rows (folding is the caller's pure function)
- [ ] `listRawTags`/`listNodeIdsByRawTag` round-trip; `replaceRawTags` idempotent (re-run same set → identical rows) and removes stale tags of the node
- [ ] `ai_tag_raw` FK cascade: purging the node takes its raw rows with it
- [ ] Spec-level assertion (grep/doc): no `tag_aliases`/`tag_merges` table or repository exists in the DDL chain
- [ ] L2 conformance (real sqlite + real PostgreSQL): PK pair semantics, conditional-upsert guard parity (`WHERE source <> 'admin'`), TEXT vector round-trip (comma-separated float codec, `dim` = float count), batch expansion parity, FK `model_id` error mapping

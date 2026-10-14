# aiTagStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Storage facade for the ONE surviving tag table: `ai_tag_raw` — materialized LOCAL DERIVED tags (kind-prefixed `mime:`/`ext:`/`month:`/`path:`), stored already-folded, consumed by rule predicates and templateNamer. (Scope reduced 2026-10-16: the `tag_embeddings` vector cache and `tag_parents` hint table were dissolved with AI_FEATURE_PLAN §4.18.) |
| Hard scope   | **No vocabulary institutions at all**: no alias/merge tables, no parent hints, no tag vectors, no LLM-tag materialization. The fold is a read-time pure function (`domains/ai/tagVocabulary.js`); `ai_features.tags` keeps raw LLM tags verbatim — this store never reads or rewrites them.                                                                 |
| Out of scope | Tag COMPUTATION: derived tags by `domains/ai/derivedTags.js`/derivedTagsService; LLM tags by `features.extract` (aiJobService). This store is the SQL surface for `ai_tag_raw` only (persistence policy: no SQL outside repositories).                                                                                                                      |
| Design owner | `docs/features/collections-platform.md` §4.18 (dissolved), §3.2 (tag predicate = folded equality on derived facets), §4.10.                                                                                                                                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/aiTagStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/AiTagRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/AiTagRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/AiTagRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/aiTagStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql` — the ONLY live row here is
  `ai_tag_raw(node_id→CASCADE, tag, PK(pair))` + `ai_tag_raw_tag_idx`.
- **Purge state:** `tag_embeddings`/`tag_parents` table definitions and the facade/repository
  methods for them (11 exports, zero domain callers since the dissolution) are slated for
  removal in the P1 dead-surface purge (PLAN T1.0b): facade + repo twins + conformance
  scenarios + DDL rows (big-bang migration, §17 posture). Until that task lands, the dead
  code paths must NOT gain new callers or consumers; nothing in collections/evolution/ai
  may reference them.

### 2.2 Table contract — `ai_tag_raw`

- Rows carry tags ALREADY folded by the caller; the store normalizes nothing.
- v1 content: derived facets ONLY (`mime:`, `ext:`, `month:`, `path:` kinds; T0.9
  kind-prefix ruling). LLM tags are never materialized (dissolved §4.18): the nightly
  LLM materialization pass is cancelled, `replaceRawTags` callers remain derivedTagsService only.
- No `model_id` — strings and folding are model-independent by design.

### 2.3 Methods

| Method                | Signature                                 | Description                                                                                                                                                                                                                                                                                           |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listRawTags`         | (nodeId) => Promise\<tag[]\>              | Folded tags of one node, `ORDER BY tag`.                                                                                                                                                                                                                                                              |
| `listNodeIdsByRawTag` | (tag) => Promise\<nodeId[]\>              | Reverse lookup (`ai_tag_raw_tag_idx`) — drives the cosine-free tag-atom evaluation of the definition engine; `node_id` asc.                                                                                                                                                                           |
| `replaceRawTags`      | (nodeId, tags) => Promise\<{ inserted }\> | ONE TX: DELETE rows of the node + INSERT the given folded set (dedup on the PK pair). Idempotent re-run with the same set ⇒ identical rows, `inserted` = set size; stale tags vanish with the delete — the caller OWNS the node's full derived-tag set (derivedTagsService is the only writer in v1). |

### 2.4 Transaction boundaries & error contracts

- Reads: `null` / `[]` for missing data.
- Writes: one TX per `replaceRawTags`; no `lockManager`, no journal (derived state,
  re-derivable at any time; undo of enrichment would be theater).
- FK violation on `node_id` surfaces as a mapped error at the repository.

### 2.5 Dependencies

- `storage.getExecutor()` + `AiTagRepository` (+ twins)
- Callers: definition engine tag-atom evaluation (`listNodeIdsByRawTag`), derivedTagsService
  (`replaceRawTags`), collections listing/preview paths (`listRawTags`), admin surfaces
  read-only at most. NO tag-embed job, NO hints editor, NO search-side fuzzy matching.

### 2.6 Verification Scenarios

- [ ] `listRawTags`/`listNodeIdsByRawTag` round-trip; `replaceRawTags` idempotent (re-run same set → identical rows) and removes stale tags of the node
- [ ] `ai_tag_raw` FK cascade: purging the node takes its raw rows with it
- [ ] Store applies NO normalization: writing `wasted time` and `wastedtime` as-given yields two rows (folding is the caller's pure function) — derived values never contain such variants anyway (fixed kind grammar)
- [ ] Grep gate: no `tag_embeddings`/`tag_parents`/`tag_aliases`/`tag_merges` references in `domains/` (purge-complete assertion; before T1.0b the gate exempts only the dead store/repository/DDL files themselves)
- [ ] L2 conformance (real sqlite + real PostgreSQL): PK pair semantics, batch expansion parity, FK `node_id` error mapping

# aiTagStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Storage facade for `ai_tag_raw` — the one tag table that exists: materialized LOCAL DERIVED tags (kind-prefixed `mime:`/`ext:`/`month:`/`path:`), stored already-folded, consumed by rule predicates and templateNamer. No tag vector cache, no parent-hint table, no LLM-tag materialization surface (§4.18). |
| Hard scope   | Three methods, one table. The orthographic fold is a read-time PURE FUNCTION owned by callers; this store normalizes nothing and ships nothing else. LLM tags (`ai_enrichments.tags`) are never materialized here.                                                                                             |
| Out of scope | Tag COMPUTATION: derived tags by `domains/ai/derivedTags.js`/derivedTagsService; LLM tags by `features.extract` (aiJobService). No nightly vocabulary pass exists. The SQL surface for `ai_tag_raw` rides this store (persistence policy: no SQL outside repositories).                                        |
| Design owner | `docs/features/collections-platform.md` §4.18, §3.2 (tag predicate = folded equality on derived facets), §4.10.                                                                                                                                                                                                |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/aiTagStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/AiTagRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/AiTagRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/AiTagRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/aiTagStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql` — the table is
  `ai_tag_raw(node_id→CASCADE, tag, PK(pair))` + `ai_tag_raw_tag_idx`. No other tag table exists in the DDL.

### 2.2 Table contract — `ai_tag_raw`

- Rows carry tags ALREADY folded by the caller; the store normalizes nothing.
- Content: derived facets only (`mime:`, `ext:`, `month:`, `path:` kinds; kind-prefix convention, §4.10).
  LLM tags are never materialized here (§4.18: tags stay in `ai_enrichments.tags`).
- No `model_id` — strings and folding are model-independent by design.

### 2.3 Methods

| Method                | Signature                                 | Description                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listRawTags`         | (nodeId) => Promise\<tag[]\>              | Folded tags of one node, `ORDER BY tag`.                                                                                                                                                                                                                                                        |
| `listNodeIdsByRawTag` | (tag) => Promise\<nodeId[]\>              | Reverse lookup (`ai_tag_raw_tag_idx`) — drives the string-equality tag-atom evaluation of the definition engine; `node_id` asc.                                                                                                                                                                 |
| `replaceRawTags`      | (nodeId, tags) => Promise\<{ inserted }\> | ONE TX: DELETE rows of the node + INSERT the given folded set (dedup on the PK pair). Idempotent re-run with the same set ⇒ identical rows, `inserted` = set size; stale tags vanish with the delete — the caller OWNS the node's full derived-tag set (derivedTagsService is the only writer). |

### 2.4 Transaction boundaries & error contracts

- Reads: `null` / `[]` for missing data.
- Writes: one TX per `replaceRawTags`; no `lockManager`, no journal (derived state, re-derivable).
- FK violation on `node_id` surfaces as a mapped error at the repository.

### 2.5 Dependencies

- `storage.getExecutor()` + `AiTagRepository` (+ twins)
- Callers: definition engine tag-atom evaluation (`listNodeIdsByRawTag`), derivedTagsService
  (`replaceRawTags`), collections listing/preview paths (`listRawTags`). NO tag-vector cache
  jobs, NO hints editor, NO search-side fuzzy matching.

### 2.6 Verification Scenarios

- [ ] `listRawTags`/`listNodeIdsByRawTag` round-trip; `replaceRawTags` idempotent (re-run same set → identical rows) and removes stale tags of the node
- [ ] `ai_tag_raw` FK cascade: purging the node takes its raw rows with it
- [ ] Store applies NO normalization: writing `wasted time` and `wastedtime` as-given yields two rows (folding is the caller's pure function)
- [ ] Contract surface: the facade exports exactly the three methods (array assert on `module.exports` keys)
- [ ] Grep: no `tag_embeddings`/`tag_parents`/`tag_aliases`/`tag_merges` table, repository, or
      facade surface exists anywhere in `server/`
- [ ] L2 conformance (real sqlite + real PostgreSQL): PK pair semantics, batch parity,
      FK `node_id` error mapping

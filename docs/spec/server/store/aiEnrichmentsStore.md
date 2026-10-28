# aiEnrichmentsStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | AI-derived descriptive metadata per node — table `ai_enrichments(node_id PK, features_model_id, schema_version, tags JSONB, summary, caption, caption_model_id, transcript, asr_model_id, probe JSONB, truncated, media_kind, updated_at)`. One row per node (node PK ⇒ model-current by construction).                                                                                                                                               |
| Tag posture  | `tags` stores FREE descriptive words (JSONB array of strings, folded at the writer boundary) — §4.18 dissolution: NO vocabulary machinery, no `tag_embeddings`/`tag_parents` code paths (PLAN §19). Consumers are exhaustively: display (AI Info chips), `llmNamer` + merge-arbiter text material. Nothing else. Raw `ai_enrichments.tags` is NEVER rewritten by any pass (E6c: nothing merges tags automatically); gray band = leave alone, forever. |
| Lineage      | Separate producer-family lineage columns (Q6): `features_model_id` (tags/summary), `caption_model_id` (caption), `asr_model_id` (transcript). LLM/VLM/ASR may point at the same `llm_models` row; consumers interpret JSON **by `schema_version`** — richer keys (objects/scene/relations) arrive as v2 rows or a side table at demand time; no v1 implementation of extended keys.                                                                   |
| Consumers    | AI Info display (client properties dialogs), llmNamer, merge-arbiter text material, admin AI governance panel, media pipeline reads (media_kind).                                                                                                                                                                                                                                                                                                     |
| Design owner | `docs/features/collections-platform.md` §4.18 (tag dissolution), §4.20/§4.21 (media pipeline), §5 (DDL).                                                                                                                                                                                                                                                                                                                                              |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/aiEnrichmentsStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/AiEnrichmentsRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/AiEnrichmentsRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/AiEnrichmentsRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/aiEnrichmentsStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`. This store NEVER references the retired `tag_embeddings`/`tag_parents` tables, and 001 no longer defines them (§4.18 dissolution).

### 2.2 Row shape

`{ nodeId, featuresModelId, schemaVersion, tags, summary, caption, captionModelId, transcript, asrModelId, probe, truncated, mediaKind, updatedAt }` — `tags: string[] | null` (JSONB array of folded free words; NOT normalized into any vocabulary), `probe: object | null` (JSONB, pass diagnostics), `truncated: boolean`, ids as numbers, ISO `updatedAt`. NULL producer columns stay `null` until that family writes.

### 2.3 Main Methods

| Method         | Signature                                                                                                                                                                             | Description                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`          | (nodeId) => Promise\<row \| null\>                                                                                                                                                    | Full enrichment row for one node (null = no enrichment yet).                                                                                                                                                                                                        |
| `getByNodeIds` | (nodeIds) => Promise\<row[]\>                                                                                                                                                         | Batch read (listing display enrichment); omitted nodes are simply absent.                                                                                                                                                                                           |
| `upsert`       | (nodeId, patch: { featuresModelId?, schemaVersion?, tags?, summary?, caption?, captionModelId?, transcript?, asrModelId?, probe?, truncated?, mediaKind? }) => Promise\<{ changes }\> | INSERT ON CONFLICT `(node_id)` DO UPDATE — a re-enrichment (content change, model change) REPLACES the patched fields; `updated_at` refreshed. Unspecified fields are NOT touched (partial producer-family updates: caption-only re-runs don't clobber transcript). |
| `delete`       | (nodeId) => Promise\<{ changes }\>                                                                                                                                                    | Explicit drop (regeneration-before-replacement, retirement). Missing row → `changes: 0`.                                                                                                                                                                            |
| `listByModel`  | (modelColumn, modelId, { afterNodeId?, limit? }?) => Promise\<row[]\>                                                                                                                 | Keyset pagination filtered by a producer lineage column (`features_model_id` \| `caption_model_id` \| `asr_model_id`) — backfill/re-embed scope reads.                                                                                                              |
| `countByModel` | (modelColumn, modelId) => Promise\<number\>                                                                                                                                           | Backfill progress per producer family.                                                                                                                                                                                                                              |

### 2.4 Storage semantics & invariants

- `node_id` is BOTH PK and FK `→ file_nodes ON DELETE CASCADE`: purging a file removes its enrichment (trash keeps the row — the node row survives).
- Producer-family lineage is per column: a `features` job run stamps `features_model_id` + `tags`/`summary`; a `caption` job stamps `caption_model_id` + `caption`; an `asr` job stamps `asr_model_id` + `transcript`. A model change re-runs the family: the new family's columns are replaced, other families' columns survive until their own backfill pass.
- `tags` is written WHOLESALE by the `features` producer as a JSONB array of free words — there is no merge, no diff, no vocabulary status, no parent lookup. The raw array is never rewritten by any other pass.
- `truncated` marks that the enrichment source content exceeded the model window (display chip + §4.21 media ladder outcome); it is a flag on the row, not a separate row.
- `media_kind` is written by the `asr` producer from ffprobe container tags (`music` marks a lyrics transcript EXCLUDED from document-content scoring); NULL for other rows.

### 2.5 Transaction boundaries

One statement or one `executor.transaction` per call; no locks, no journal (derived AI state, internal worker writes). Media/feature/caption/asr producers write this store in their own worker TX.

### 2.6 Error contracts

- Reads: missing → `null` / `[]`. Writes: `changes` counts; FK violation (unknown node) surfaces as a mapped error. Malformed `tags` (non-string entries) raise at the repository boundary (never stored half-written); `probe` accepts any JSON-serializable object.

### 2.7 Dependencies

- `storage.getExecutor()` + `AiEnrichmentsRepository` (+ twins)
- Callers: features/caption/asr producers (jobs worker pipelines), the embed pipeline's media fallback corpus read (`caption`/`transcript`), backfill service, display services, llmNamer, merge-arbiter. No lockManager.

### 2.8 Verification Scenarios

- [ ] `upsert` twice for one node → exactly ONE row; latest patched fields win; untouched fields survive the second write
- [ ] Producer-family isolation: a caption-only patch does NOT alter `tags`/`features_model_id`; a features re-run does NOT alter `caption`/`transcript`
- [ ] Model migration overwrite: upsert with a new `featuresModelId` replaces the features lineage; `listByModel` on the new id returns only migrated nodes
- [ ] `tags` round-trips as a JSONB array of strings (sqlite TEXT codec and PG jsonb parity); non-string entries rejected at the boundary
- [ ] `listByModel` keyset pagination returns every row exactly once across pages, in `nodeId` order, for each producer column
- [ ] Node purge cascades the row; trashing does NOT (node row persists)
- [ ] `probe` JSONB object round-trips (sqlite TEXT codec and PG jsonb parity)
- [ ] L2 conformance (real sqlite + real PostgreSQL): ON CONFLICT DO UPDATE parity, partial-field update parity, keyset pagination parity, `countByModel`, cascade parity, row-shape mapping (number ids, ISO `updatedAt`, boolean `truncated`)
- [ ] Grep gate: zero references to `tag_embeddings` or `tag_parents` anywhere in this store, its repository, or its conformance tests (§19-5)

# embeddingsStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Canonical pooled embedding row per node — table `embeddings(node_id PK, model_id, dim, vector TEXT, source, content_hash, updated_at)`. The `vector TEXT` column is the SYSTEM OF RECORD for every vector in the product; all ANN indexes are derived artifacts of it. |
| Space key    | `model_id` is the embedding-SPACE key: vectors from different `llm_models` rows are never comparable (cross-`model_id` cosine forbidden). One active model ⇒ one live row per node (PK is the node).                                                                   |
| Consumers    | vectorStore adapter (shadow-index rebuild), centroid/naming math (pooled row is canonical), seed preview, evolution passes.                                                                                                                                            |
| Design owner | `docs/features/collections-platform.md` §4.20, §4.13 (canonical TEXT).                                                                                                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/embeddingsStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/EmbeddingsRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/EmbeddingsRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/EmbeddingsRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/embeddingsStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`. **Never** in tracked
  DDL: the pgvector shadow table / sqlite vec0 virtual table — those are created and
  managed by the vectorStore adapter only (CODING_STYLE.md Express Patterns).

### 2.2 Row shape

`{ nodeId, modelId, dim, vector, source, contentHash, updatedAt }`.

- **Stored representation:** `vector` is TEXT — comma-separated floats (`dim`-checked at
  the repository boundary).
- **Domain representation:** the repository maps the stored TEXT to a `number[]`
  (`deserializeVector`) for all read paths (`get`, `getByNodeIds`, `listAll`); `upsert`
  accepts either a `number[]` or a pre-serialized string (round-tripped via
  `serializeVector`).
- `source ∈ fulltext | chunk_pool | head | metadata_only | media_direct` (DDL CHECK enum,
  overlength-ladder / media pipeline outcome).

### 2.3 Main Methods

| Method         | Signature                                                                         | Description                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`          | (nodeId) => Promise\<row \| null\>                                                | Single pooled row (node PK ⇒ model-current by construction after backfill).                                                                                                   |
| `getByNodeIds` | (nodeIds) => Promise\<row[]\>                                                     | Batch read (listing enrichment, similar-file lookups). Omitted nodes are simply absent.                                                                                       |
| `upsert`       | (nodeId, { modelId, dim, vector, source, contentHash }) => Promise\<{ changes }\> | INSERT ON CONFLICT `(node_id)` DO UPDATE — a re-embed (model change, re-chunk, content change) REPLACES the row; `updated_at` refreshed.                                      |
| `delete`       | (nodeId) => Promise\<{ changes }\>                                                | Explicit drop (re-embed-before-replacement, retirement). Missing row → `changes: 0`.                                                                                          |
| `deleteMany`   | (nodeIds) => Promise\<{ changes }\>                                               | Batch drop in one TX.                                                                                                                                                         |
| `listAll`      | (modelId, { afterNodeId?, limit? }?) => Promise\<row[]\>                          | Keyset pagination (`node_id > afterNodeId ORDER BY node_id LIMIT n`), filtered to `model_id = modelId` — drives vectorStore shadow rebuild and the JsFallback per-query load. |
| `countByModel` | (modelId) => Promise\<number\>                                                    | Backfill progress / admin pipeline card.                                                                                                                                      |

### 2.4 Dedupe-skip contract (content_hash)

The embed worker performs the dedupe decision itself — this store only
supplies the data:

- Worker reads `get(nodeId)`; if `row.modelId === activeModelId && row.contentHash ===
filecache.content_hash` ⇒ `aiJobsStore.markSkipped(jobId)` — **no provider call, no
  write**. Determinism within a model version makes the `(content_hash, model_id)` pair
  sufficient for this idempotency.
- The stored `content_hash` records WHICH content the vector describes (drift detector).

### 2.5 Storage semantics & invariants

- `node_id` is BOTH PK and FK `→ file_nodes ON DELETE CASCADE`: purging a file removes its
  embedding (trash keeps the row — the node row survives).
- A model change is a backfill overwrite (admin-triggered, single-active): old-space vectors are replaced row-by-row;
  `listAll` on the new modelId returns only fully-migrated nodes until backfill completes.
- `dim` is fixed per model. The store trusts its caller (embed worker /
  vectorStore seam resolves the model row's dim upstream) and simply persists the
  value — no `llm_models` lookup here; cross-model comparisons are prevented by the
  `modelId` read filters, not by dim validation.
- The pooled row is the ONE canonical vector per node for centroid/naming math; retrieval
  max-over-chunks scoring reads `embeddings_chunk` (separate spec), not this table.

### 2.6 Transaction boundaries

One statement or one `executor.transaction` per call; no locks, no journal (derived AI
state, internal worker writes). VectorStore's `upsert(node, vecs[], dim)` seam calls the
pooled write here and the chunk write in `embeddingsChunkStore` inside ITS own TX (vectorStore seam division of labor).

### 2.7 Error contracts

- Reads: missing → `null` / `[]`. Writes: `changes` counts; FK violation (unknown node)
  surfaces as a mapped error; `vector` strings failing the serialize/parse round trip raise
  at the repository boundary (never stored half-written).

### 2.8 Dependencies

- `storage.getExecutor()` + `EmbeddingsRepository` (+ twins)
- Callers: vectorStore adapter (`domains/ai/vectorStore/`), embed worker, backfill service,
  evolution service (pass reads). No lockManager.

### 2.9 Verification Scenarios

- [ ] `upsert` twice for one node → exactly ONE row, latest `vector`/`modelId`/`source` wins
- [ ] Model migration overwrite: upsert with a new `modelId` (different `dim`) replaces the row cleanly — `get` afterwards reports only the new space's `modelId`/`dim`
- [ ] Dedupe-skip path: same `contentHash` + same `modelId` → worker skips; changed hash → row replaced; changed `modelId` → row replaced (never a second live row per node)
- [ ] `listAll(modelId)` excludes rows of other `modelId`s; keyset pagination returns every row exactly once and in `nodeId` order across pages
- [ ] Node purge cascades the row; trashing does NOT (node row persists)
- [ ] `source` CHECK rejects an out-of-enum value (mapped error)
- [ ] TEXT vector round-trips bit-stably through serialize/parse at `dim` (no lossy REAL/NUMERIC in tracked DDL)
- [ ] L2 conformance (real sqlite + real PostgreSQL): ON CONFLICT DO UPDATE parity, keyset pagination parity, `countByModel`, cascade parity, row-shape mapping (number ids, ISO `updatedAt`)
- [ ] Shadow-index independence: deleting the vec0/pgvector derived artifact and rebuilding via `listAll` reproduces identical canonical TEXT rows (vectorStore conformance owns this; store spec asserts the read path supports it)

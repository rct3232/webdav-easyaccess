# embeddingsChunkStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role         | Chunked (segment-level) embedding rows per node — table `embeddings_chunk(node_id, chunk_idx, vector TEXT, model_id, updated_at)`. Holds long-document chunks so search can score max-over-chunks (§4.13 seam); the pooled `embeddings` row remains the ONE canonical vector for centroid/naming math. |
| Space key    | `model_id` is the embedding-SPACE key (same rule as the pooled table): chunks from different `llm_models` rows are never comparable. Retained per §4.3 — dropping rows loses only long-doc recall depth (derived-cache semantics, rebuildable by re-chunking). |
| Consumers    | vectorStore adapter (chunk-shadow-index rebuild), search max-over-chunks scoring, embed worker (chunk-pool ladder writes).                                                                                                                |
| Design owner | `docs/features/collections-platform.md` §4.3 (retention), §4.13 (seam), §5 (DDL).                                                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/embeddingsChunkStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/EmbeddingsChunkRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/EmbeddingsChunkRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/EmbeddingsChunkRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/embeddingsChunkStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`. **Never** in tracked DDL: the pgvector shadow table / sqlite vec0 virtual table for chunks — those are created and managed by the vectorStore adapter only.

### 2.2 Row shape

`{ nodeId, chunkIdx, vector, modelId, updatedAt }` — `vector` is TEXT (comma-separated floats, canonical pooled-embeddings codec), parsed to `number[]` at the repository boundary (float count read back as the chunk dim — chunks of one node/model share the pooled `dim`; no separate column). `chunk_idx` is 0-based SMALLINT.

### 2.3 Main Methods

| Method         | Signature                                                                 | Description                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listByNode`   | (nodeId, { modelId }?) => Promise\<row[]\>                                | All chunks of one node in `chunk_idx` ASC order; optional `modelId` filter (space-key read filter, same rule as the pooled store).                   |
| `get`          | (nodeId, chunkIdx) => Promise\<row \| null\>                              | Single chunk read.                                                                                                                                    |
| `replaceChunks`| (nodeId, modelId, chunks: Array\<{ chunkIdx, vector }\>) => Promise\<{ inserted }\> | ONE TX: DELETE the node's rows for the incoming `model_id` (that space's set for the node) + INSERT the given set. A cross-space write landing on an existing `(node_id, chunk_idx)` position claims it via the PK upsert (newer space wins); rows of OTHER models at non-colliding indices are untouched — a node may briefly hold rows in two spaces mid-backfill (readers filter by `model_id`). Re-chunking within one model replaces that model's whole set; no partial updates. |
| `deleteByNode` | (nodeId) => Promise\<{ changes }\>                                        | Explicit drop (content change, retirement). Missing rows → `changes: 0`.                                                                              |
| `deleteByModel`| (modelId) => Promise\<{ changes }\>                                       | Retire a whole embedding space (model migration backfill start).                                                                                      |
| `countByNode`  | (nodeId, { modelId }?) => Promise\<number\>                               | Chunk count for one node (progress / ladder outcome).                                                                                                 |
| `listAllByModel`| (modelId, { afterNodeId?, afterChunkIdx?, limit? }?) => Promise\<row[]\>  | Tuple keyset cursor over the composite PK — rows strictly after `(afterNodeId, afterChunkIdx)` (afterChunkIdx defaults to -1: resume at that node's first row), `ORDER BY node_id, chunk_idx LIMIT n`, filtered to `model_id` — drives chunk-shadow-index rebuild. A node-level cursor cannot paginate the composite PK without skipping boundary-node chunks (§2.8 "every row exactly once"). |

### 2.4 Storage semantics & invariants

- `node_id` is FK `→ file_nodes ON DELETE CASCADE`; purge removes the chunks; trash keeps them.
- `(node_id, chunk_idx)` is the PK: replacing chunks is a wholesale DELETE+INSERT in one TX, scoped to the node's set in the incoming model space; a second-space write replaces the first at a shared position via the PK upsert (space-exclusive positions). Partial chunk updates are forbidden (a half-written chunk set would break max-over-chunks determinism).
- Chunks inherit the pooled row's space: the caller (embed worker / vectorStore seam) resolves `modelId` upstream; the store persists it without an `llm_models` lookup.
- The `vector` TEXT column round-trips bit-stably through serialize/parse (no lossy REAL/NUMERIC in tracked DDL).

### 2.5 Transaction boundaries

One `executor.transaction` per call; no locks, no journal (derived AI state). The vectorStore seam's `upsert(node, vecs[], dim)` calls the pooled write (embeddingsStore) and the chunk write HERE inside ITS own TX (vectorStore seam division of labor — one TX for both, not nested).

### 2.6 Error contracts

- Reads: missing → `null` / `[]`. Writes: `{ changes }` / `{ inserted }`; FK violation (unknown node) surfaces as a mapped error; malformed vector TEXT raises at the repository boundary (never stored half-written).

### 2.7 Dependencies

- `storage.getExecutor()` + `EmbeddingsChunkRepository` (+ twins)
- Callers: vectorStore adapter (`domains/ai/vectorStore/`), embed worker (chunk-pool ladder), backfill service, search max-over-chunks read. No lockManager.

### 2.8 Verification Scenarios

- [ ] `replaceChunks` for one node → old chunk rows fully replaced, `chunk_idx` order preserved
- [ ] `listByNode` returns chunks in `chunk_idx` ASC order; `modelId` filter excludes other spaces
- [ ] Chunk count for a re-chunked node matches the new ladder outcome (old count discarded)
- [ ] `listAllByModel` keyset pagination returns every row exactly once across pages, in `(nodeId, chunkIdx)` order
- [ ] `deleteByNode` removes all chunks; `deleteByModel` retires the whole space
- [ ] Node purge cascades the rows; trashing does NOT
- [ ] TEXT vector round-trips bit-stably through serialize/parse (float count == pooled `dim`)
- [ ] L2 conformance (real sqlite + real PostgreSQL): PK upsert/replace parity, keyset pagination parity, cascade parity, row-shape mapping (number ids, ISO `updatedAt`)

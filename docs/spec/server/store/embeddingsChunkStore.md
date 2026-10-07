# embeddingsChunkStore Spec

## 1. Overview

| Item           | Description                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role           | Per-document chunk vectors — table `embeddings_chunk(node_id, chunk_idx, vector, model_id, updated_at)`, PK `(node_id, chunk_idx)`. Written by the `chunk-pool` overlength ladder; RETAINED (not discarded after pooling) — retrieval scores against chunks. |
| Derived status | A rebuildable derived artifact: dropping rows loses only long-document recall depth and is healed by re-running the embed job. The canonical source of truth remains `embeddings.vector` + the extractor pipeline.                                           |
| Scoring        | Max-over-chunks per-node neighbor scoring is **vectorStore's job** (`domains/ai/vectorStore/`) — this facade stores and returns rows; it never computes similarity.                                                                                          |
| Design owner   | `docs/features/collections-platform.md` §4.3 (chunking ladder), §4.20 ("store every chunk vector").                                                                                                                                                          |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/embeddingsChunkStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/EmbeddingsChunkRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/EmbeddingsChunkRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/EmbeddingsChunkRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/embeddingsChunkStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`. The vec0/pgvector
  shadow carry chunk rows too, but as **never-tracked DDL** managed by vectorStore.

### 2.2 Row shape

`{ nodeId, chunkIdx, vector, modelId, updatedAt }` — `chunkIdx` SMALLINT ≥ 0, dense from
0 within a node's set; `vector` TEXT serialized floats, same codec as the pooled row
(`embeddingsStore` §2.2).

### 2.3 Main Methods

| Method          | Signature                                             | Description                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replace`       | (nodeId, modelId, vectors) => Promise\<{ inserted }\> | REPLACE-ON-RECHUNK, one TX: `DELETE WHERE node_id=?` then bulk INSERT `chunk_idx = 0..n-1`. Changing chunk params (profile key) re-chunks fully — old-count leftovers are gone by construction. `vectors = []` deletes and inserts nothing. |
| `list`          | (nodeId) => Promise\<chunkRow[]\>                     | All chunk rows of a node, `ORDER BY chunk_idx ASC`. Missing node → `[]`.                                                                                                                                                                    |
| `listByNodeIds` | (nodeIds) => Promise\<chunkRow[]\>                    | Batch read for scoring passes (JsFallback per-query load; node ids dedup before k — vectorStore's contract).                                                                                                                                |
| `count`         | (nodeId) => Promise\<number\>                         | Chunk count (drives the `chunk_pool` vs `head` ladder outcome bookkeeping).                                                                                                                                                                 |
| `delete`        | (nodeId) => Promise\<{ changes }\>                    | Explicit drop (drop-and-rebuild path).                                                                                                                                                                                                      |
| `deleteMany`    | (nodeIds) => Promise\<{ changes }\>                   | Batch drop in one TX (model-change teardown before backfill re-chunks).                                                                                                                                                                     |

No `upsert`-per-chunk method exists on purpose: a chunk set is only ever valid as a whole
(the chunking profile is part of the model profile key — **mixed-chunk scoring is
forbidden**), so `replace` is the only write.

### 2.4 Storage semantics

- `node_id` FK `→ file_nodes ON DELETE CASCADE`: purge cascades chunk rows; trash does not.
- `model_id` is the space key (same rule as pooled rows): a node's chunk set always
  belongs to ONE model — `replace` stamps every inserted row with the given `modelId`;
  no per-row model mixing (the API allows no partial writes — replace-only), so
  readers may assume homogeneity per node.
- `updated_at` refreshed on every `replace` (the delete+insert set shares one timestamp).
- Retrieval note (pointer): `neighbors(vec, k, candidates)` scores per-node
  **max-over-chunks** from these rows;
  `allVectors`/shadow indexes INCLUDE chunk rows and dedup by node id. None of that math
  lives here.

### 2.5 Drop-and-rebuild derived semantics

- Losing rows (operator drop, failed shadow build, model retirement) is a performance
  event, not a data-integrity event: the embed job for the node's current generation can
  re-run and `replace` restores the set deterministically (same text, same profile ⇒ same
  chunks).
- On model change: teardown via `deleteMany` (or overwrite by `replace` per node during
  backfill); stale-model chunk rows never coexist with new-model rows for the same node
  after `replace`.

### 2.6 Transaction boundaries & error contracts

- `replace`/`deleteMany`: one `executor.transaction` each; others single statements.
- No locks, no journal (worker-side derived state).
- Reads: `[]` / `0` for missing data. Writes: FK violation → mapped error; oversized
  `chunk_idx` (> SMALLINT range) is impossible by construction (indices come from array
  position).

### 2.7 Dependencies

- `storage.getExecutor()` + `EmbeddingsChunkRepository` (+ twins)
- Callers: vectorStore adapter `upsert(node, vecs[], dim)` seam (chunk half), embed
  worker (overlength ladder), backfill teardown.

### 2.8 Verification Scenarios

- [ ] `replace(node, m, [v0,v1,v2])` then `replace(node, m, [v0])` → exactly one row (`chunk_idx=0`); shrinking re-chunks leave no orphans
- [ ] `replace` with `[]` removes all rows for the node (delete-only path)
- [ ] `list` ordering is `chunk_idx` ascending and dense from 0
- [ ] `listByNodeIds` dedups repeated node ids input, returns all rows of each node, and never mixes nodes
- [ ] Rows for a purged node cascade away; trashed nodes keep theirs
- [ ] Every row of a `replace` batch carries the same `modelId` and `updatedAt`
- [ ] Double `replace` in one TX rollback (forced failure) leaves the previous set untouched (atomic swap)
- [ ] Drop-and-rebuild: delete all chunks of a node, re-run the embed worker for its generation → byte-identical vector set restored (determinism check lives in the worker suite; store asserts re-insert fidelity)
- [ ] L2 conformance (real sqlite + real PostgreSQL): PK `(node_id, chunk_idx)` conflict behavior (only reachable via `replace`'s internal bulk insert), CASCADE parity, SMALLINT binding parity, TEXT vector round-trip parity, `listByNodeIds` batch-in expansion on both dialects
- [ ] Integration pointer: removing the vec0/pgvector shadow artifacts and rebuilding from `embeddings` + `embeddings_chunk` reads reproduces identical neighbor scores (vectorStore conformance owns the assertion)

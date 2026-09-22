# vectorStore Spec

Target-contract spec.

## 1. Overview

| Item                          | Description                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                          | The vector-engine SEAM: exactly two implementation families (Native adapters, JsFallback) behind one interface, hiding pgvector / sqlite-vec / brute-force differences from every caller.                                                                                                                                                                                                           |
| Canonical                     | `embeddings.vector TEXT` (+ `embeddings_chunk.vector TEXT`) is the SYSTEM OF RECORD for every vector. Every index below is a DERIVED ARTIFACT created/managed by this adapter and NEVER part of the tracked DDL chain (symmetric rule for the pg shadow table and the sqlite vec0 virtual table; CODING_STYLE.md Express Patterns; `REAL/NUMERIC` stay out of tracked DDL — transpiler vocabulary). |
| Policy (corrected 2026-09-15) | **No AI feature is ever disabled for missing vector capability.** Absence degrades to JsFallback, boot unblocked, all features ON; the admin health card shows `vectorOps=native \| fallback_js(degraded)` with the install hint — a PERFORMANCE warning, not a state gate (§4.13/§4.14 Tier B, §9 rejection of AI-off-on-missing-vector).                                                          |
| Boot stance                   | Engine choice is BOOT-FROZEN (DB connection presence selects dialect; extension availability probed at boot) — contrast recorded against fully-hot LLM config (§4.2). Model change ⇒ derived index rebuild; TEXT canonical untouched (§4.13c tail).                                                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Seam:** `server/domains/ai/vectorStore/index.js` (factory by boot probe)
- **Impls:** `vectorStore/PgVector.js`, `vectorStore/SqliteVec.js`,
  `vectorStore/TextVectorJs.js` (+ `vectorMath.js` pure cosine/mean helpers, unit-tested)
- **Shared ACL helper:** `vectorStore/aclFilter.js` (oversample→filter→retry, §2.5)
- **Tests:** `server/domains/ai/vectorStore/__tests__/vectorStore.test.js` + the
  §4.13c conformance suite `conformance.test.js` (oracle + held-out recall legs, run per
  active engine)

### 2.2 Seam interface (exact — §4.13)

```
upsert(node, vecs[], dim)
 // pooled half → embeddingsStore.upsert(nodeId,{modelId,dim,vector,source,contentHash})
 // chunk half → embeddingsChunkStore.replace(nodeId, modelId, chunkVectors)
 // + shadow-artifact sync — ALL in ONE TX (embeddingsStore §2.6 division of labor)
neighbors(vec, k, candidates)
 // → [{nodeId, score}] — score = per-node MAX over that node's chunk vectors when
 // chunks exist, pooled row otherwise (E12: pooled-only hides mid-document sections —
 // 0.51 < unrelated floor vs 0.67 chunk-max); node ids DEDUPED before k is cut;
 // `candidates` = ACL-scoped visibility predicate/set enforced ENGINE-side or via the
 // §2.5 helper — never post-hoc filtering below k without oversampling
allVectors(userScope)
 // canonical TEXT rows (pooled + chunks) for the scope, parsed via vectorMath;
 // JsFallback's per-query load path AND evolution clustering input;
 // NO resident state across queries (§6 gate — brute-force re-loads per call)
```

`userScope`: requester id → ACL resolution rides `fileNodesStore` joins (the same
closure/owner logic as listings); `userScope=null` = provider-global (system passes:
tag_embeddings lookups, clustering over a user's own corpus stays scoped).

### 2.3 Implementation matrix (exactly two families)

| Impl                            | When                                                                                         | Behavior                                                                                                                                                                                                                  | Evidence (the pre-implementation study)  |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Native — PgVector**           | PostgreSQL ∧ pgvector **≥0.7** installed                                                     | KNN pushed into SQL (HNSW on the shadow table, chunks included); `SET LOCAL hnsw.ef_search = 400` per query — FIXED default, never the library default 100 (§4.13c; E11: external recall 0.74@100 → 1.00@400, ~2 ms cost) | 0.7 ms@60k; filtered 6.2 ms recall 50/50 |
| **Native — SqliteVec**          | sqlite ∧ `node:sqlite` + `sqlite-vec` vec0 loadable                                          | vec0 virtual table, FLAT exact (no ANN upstream yet); BigInt PK binding (§2.5)                                                                                                                                            | 17 ms exact @20k; 5.3 ms @5.4k           |
| **JsFallback (`TextVectorJs`)** | native ops ABSENT: pgvector not installed, unsupported future engine, extension load failure | brute-force exact cosine via `allVectors`, per-query load, O(N·D) latency                                                                                                                                                 | 67 ms@60k resident-array benchmark       |

Future engines (MySQL9 / MariaDB / MSSQL2025 / Oracle23ai): one adapter each or fall
through to JsFallback — falling through is a supported, shipping state.

**Rejected:** `hnswlib-node` (§9 — A-plan decided: vec0 covers sqlite at all expected
product scales as an exact engine; ANN headroom lives on the PG tier by design, docs
already recommend PG for large deployments).

### 2.4 Derived artifacts — creation and lifecycle (never-tracked DDL)

- PgVector: shadow table (adapter-internal name, `vectorstore_shadow_pg` —
  **Decision:** the literal name is fixed here so ops runbooks can reference it) —
  columns `(node_id, chunk_idx NULLABLE, model_id, vector vector(dim))` + HNSW index;
  sqlite:
  vec0 virtual table `vectorstore_shadow_vec0` with `(node_id INTEGER PK BigInt-bound,
chunk_idx, model_id, embedding)`. Chunk rows carry into BOTH shadows (§4.13: "pg:
  shadow vec0/pgvector tables carry chunks too").
- Created/absent-checked/rebuilt by the adapter at boot and on `rebuildShadow()` (admin
  trigger); dropped-and-rebuilt idempotently from `embeddingsStore.listAll(modelId)` +
  `embeddingsChunkStore.listByNodeIds` — conformance asserts a rebuilt shadow reproduces
  identical neighbor results to the pre-drop run (embeddingsStore §2.9 pointer).
- The HNSW shadow dim is bound to the ACTIVE model (`llm_models.dim`): model change ⇒
  rebuild derived index; stale-model shadow data never coexists (drop-first).
- Absent/unloadable extension at boot ⇒ factory returns `TextVectorJs`, logs once,
  `backendHealth('vector').report` = fallback(degraded reason + hint
  `CREATE EXTENSION vector` ≥0.7 / sqlite-vec binary). Boot NEVER blocks.

### 2.5 vec0 constraints & the ACL filter helper (spike facts, recorded)

- Requires the **node:sqlite driver** (current `sqlite3` npm exposes no extension
  loading); migration confined to `db/sqliteExecutor.js`;
  **product Node floor ≥24** (node:sqlite experimental flag on v24 — tolerated, works).
- vec0 integer PKs bind via **BigInt** (node:sqlite binds JS numbers as doubles —
  silently corrupts vec0 keys otherwise).
- vec0 + JOIN has a planner bug ⇒ NO join-KNN: ACL filtering uses
  `neighborsFiltered(vec, k, aclPredicate)`: oversample `k·f` (f default 4) from the
  shadow → SQL/JS filter to the visible set → if fewer than k survive, adaptive retry
  doubling the oversample (bounded rounds, then short list — correctness over padding).
  The helper is SHARED code and is also the valid pre-0.7 pg behavior (§4.13 spike note).

### 2.6 Accuracy contract (§4.13c)

- Conformance suite, per active engine:
- EXACT engines (JsFallback, vec0-flat): results IDENTICAL to the JS oracle
  (`vectorMath` cosine over `allVectors`) — bit-parity of scores within fp tolerance.
- ANN engine (pgvector HNSW ef_search=400): **recall@50 ≥ 0.99** graded with
  **HELD-OUT (external) queries only** — self-queries flatter the index and are banned
  as grading input (external-query consequence of E11; §4.13c sentence adopted).
- Cross-engine result-identity is NOT promised (ANN is approximate); the promise is
  the recall floor.
- Reference corpus + query set are the dev-owned release artifact (§4.15: measured by the
  project, shipped as profile values, `calibrated:false` provenance in admin; NOT shipped
  to end users).

## 3. Configuration

Boot-frozen engine selection (no key). Operational: `VECTOR_OVERSAMPLE_F` (T2, default
4, §2.5). `hnsw.ef_search=400` is FIXED in code (not a knob — §9 bans the 100 default;
making it tunable invites re-introducing it). Threshold/θ values that CONSUMERS pass are
model-profile constants, owned by the callers — never by this seam.

## 4. Dependencies

- `storage.getExecutor()` (dialect), driver-level extension probes at boot
  (`CREATE EXTENSION`/`LOAD vector` availability checks), `embeddingsStore`,
  `embeddingsChunkStore`, `fileNodesStore` (ACL predicates), `vectorMath`, `backendHealth`
- Callers: searchService (`neighbors` per segment), collectionsService/definitionEngine
  (`neighbors` for membership + seed preview), evolutionService (`allVectors` clustering,
  centroid math via vectorMath), llmAdapter NOT involved (vector store never calls out).

## 5. Verification Scenarios

- [ ] Factory matrix: (pg∧pgvector≥0.7)→PgVector; (pg∧absent)→TextVectorJs + health
      card `fallback_js(degraded)` + install hint, boot completes, all AI features still
      on; (sqlite∧node:sqlite+vec0)→SqliteVec; (sqlite∧extension load failure)→TextVectorJs
- [ ] `upsert` writes pooled + chunk halves and the shadow in one TX; forced chunk-write
      failure rolls back the pooled write too
- [ ] `neighbors` = max-over-chunks: fixture doc whose mid-section matches scores ≥0.6
      while pooled-only would score <0.5 (E12 regression fixture); node dedup before k
- [ ] ACL: a candidate invisible to the requester NEVER appears even when it ranks in
      the raw top-k (oversample/filter/retry legs: f=4 hit, adaptive retry hit, short-
      list terminal case)
- [ ] vec0: BigInt PK round-trip (id > 2^53 sentinel skipped with warning — **Decision:**
      product ids are sequences far below that; assert binding type is BigInt not double);
      no JOIN-in-knn SQL in the adapter (grep the statements)
- [ ] §4.13c: exact engines ≡ JS oracle on the reference set; pg ANN leg reports
      recall@50 ≥0.99 at ef_search=400 with held-out queries ONLY (self-query grading
      makes the suite fail)
- [ ] ef_search assertion: captured `SET LOCAL hnsw.ef_search=400` on every ANN query;
      removing the setting degrades the recall leg (proves the knob bites)
- [ ] Shadow rebuild: drop derived artifacts → `rebuildShadow()` from canonical TEXT →
      identical neighbor scores; canonical rows untouched throughout
- [ ] Model dim change: shadow rebuilt at new dim; stale-space rows absent;
      cross-model_id candidate never returned (space key discipline)
- [ ] `allVectors` leaves no resident state between calls (heap probe / re-query loads
      again) — §6 no-cache-state gate grep + behavior
- [ ] L2 conformance on real sqlite (test:ci) AND real PostgreSQL (test:ci:pg:adapters)

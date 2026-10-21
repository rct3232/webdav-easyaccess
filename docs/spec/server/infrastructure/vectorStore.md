# vectorStore Spec

Target-contract spec.

## 1. Overview

| Item        | Description                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role        | The vector-engine SEAM: exactly two implementation families (Native adapters, JsFallback) behind one interface, hiding pgvector / sqlite-vec / brute-force differences from every caller.                                                                                                                                                                                                           |
| Canonical   | `embeddings.vector TEXT` (+ `embeddings_chunk.vector TEXT`) is the SYSTEM OF RECORD for every vector. Every index below is a DERIVED ARTIFACT created/managed by this adapter and NEVER part of the tracked DDL chain (symmetric rule for the pg shadow table and the sqlite vec0 virtual table; CODING_STYLE.md Express Patterns; `REAL/NUMERIC` stay out of tracked DDL — transpiler vocabulary). |
| Policy      | **No AI feature is ever disabled for missing vector capability.** Absence degrades to JsFallback, boot unblocked, all features ON; the admin health card shows `vectorOps=native \| fallback_js(degraded)` with the install hint — a PERFORMANCE warning, not a state gate.                                                                                                                         |
| Boot stance | Engine choice is BOOT-FROZEN (DB connection presence selects dialect; extension availability probed at boot). Model change ⇒ derived index rebuild; TEXT canonical untouched.                                                                                                                                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Seam:** `server/domains/ai/vectorStore/index.js` (factory by boot probe)
- **Impls:** `vectorStore/PgVector.js`, `vectorStore/SqliteVec.js`,
  `vectorStore/TextVectorJs.js` (+ `vectorMath.js` pure cosine/mean helpers, unit-tested)
- **Shared ACL helper:** `vectorStore/aclFilter.js` (oversample→filter→retry, §2.5)
- **Tests:** `server/domains/ai/vectorStore/__tests__/vectorStore.test.js` + the
  §2.6 conformance suite `conformance.test.js` (exact≡oracle harness
  `runExactEngineConformance` — EXACT engines only) + the ANN leg
  `pgvector.test.js` (PgVector recall@50 @ ef_search=400 over held-out queries;
  real-PG, skips when the `vector` extension is unavailable).

### 2.2 Seam interface (exact)

```
upsert(node, vecs[], dim)
 // pooled half → embeddingsStore.upsert(nodeId,{modelId,dim,vector,source,contentHash})
 // chunk half → embeddingsChunkStore.replace(nodeId, modelId, chunkVectors)
 // + shadow-artifact sync — ALL in ONE TX (embeddingsStore §2.6 division of labor)
neighbors(vec, k, candidates)
 // → [{nodeId, score}] — score = per-node MAX over that node's chunk vectors when
 // chunks exist, pooled row otherwise; node ids DEDUPED before k is cut;
 // `candidates` = ACL-scoped visibility predicate/set enforced ENGINE-side or via the
 // §2.5 helper — never post-hoc filtering below k without oversampling
allVectors(userScope)
 // canonical TEXT rows (pooled + chunks) for the scope, parsed via vectorMath;
 // JsFallback's per-query load path AND evolution clustering input;
 // NO resident state across queries (no-cache-state CI gate — brute-force re-loads per call)
```

`userScope`: requester id → ACL resolution rides `fileNodesStore` joins (the same
closure/owner logic as listings); `userScope=null` = provider-global (system passes:
tag_embeddings lookups, clustering over a user's own corpus stays scoped).

### 2.3 Implementation matrix (exactly two families)

| Impl                            | When                                                                                         | Behavior                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native — PgVector**           | PostgreSQL ∧ pgvector **≥0.7** installed                                                     | KNN pushed into SQL (HNSW on the shadow table, chunks included); `SET LOCAL hnsw.ef_search = 400` per query — FIXED default, never the library default 100 |
| **Native — SqliteVec**          | sqlite ∧ `node:sqlite` + `sqlite-vec` vec0 loadable                                          | vec0 virtual table, FLAT exact (no ANN upstream yet); BigInt PK binding (§2.5)                                                                             |
| **JsFallback (`TextVectorJs`)** | native ops ABSENT: pgvector not installed, unsupported future engine, extension load failure | brute-force exact cosine via `allVectors`, per-query load, O(N·D) latency                                                                                  |

Future engines (MySQL9 / MariaDB / MSSQL2025 / Oracle23ai): one adapter each or fall
through to JsFallback — falling through is a supported, shipping state.

### 2.4 Derived artifacts — creation and lifecycle (never-tracked DDL)

- PgVector: shadow table (adapter-internal name `vectorstore_shadow_pg` — the literal
  name is fixed for ops runbook references) —
  columns `(node_id, chunk_idx NULLABLE, model_id, vector vector(dim))` + HNSW index
  (`vector_cosine_ops`); `atttypmod` of the `vector` column carries the bound dim
  (numeric `dim`, `-1` = untyped), so a stale-dim table is detected from the catalog and
  the adapter drop-rebuilds (model change ⇒ rebuild; stale-space shadow data never
  coexists). Extension availability is probed by `probePgVector(executor)` — exported by
  the adapter for the boot factory: reads `pg_extension.extversion`, falls back to
  `pg_available_extensions` for the install hint, and gates on ≥0.7 semver.
  sqlite:
  vec0 virtual table `vectorstore_shadow_vec0` with `(node_id INTEGER PK BigInt-bound,
chunk_idx, model_id, embedding)`. Chunk rows carry into BOTH shadows.
- Created/absent-checked/rebuilt by the adapter at boot and on `rebuildShadow()` (admin
  trigger); dropped-and-rebuilt idempotently from `embeddingsStore.listAll(modelId)` +
  `embeddingsChunkStore.listByNodeIds` — conformance asserts a rebuilt shadow reproduces
  identical neighbor results to the pre-drop run (embeddingsStore §2.9 pointer).
- The HNSW shadow dim is bound to the ACTIVE model's RUNTIME dim (derived from the
  model profile — `llm_models` has no dim column (DDL 001); dim persistence lives
  per-row on `embeddings.dim`): model change ⇒
  rebuild derived index; stale-model shadow data never coexists (drop-first).
- Absent/unloadable extension at boot ⇒ factory returns `TextVectorJs`, logs once,
  `backendHealth('vector').report` = fallback(degraded reason + hint
  `CREATE EXTENSION vector` ≥0.7 / sqlite-vec binary). Boot NEVER blocks.

### 2.4a SqliteVec (vec0) adapter — physical layout

- Extension loading: `new DatabaseSync(path, { allowExtension: true })` is REQUIRED
  (`db.enableLoadExtension(true)` throws `ERR_INVALID_STATE` without the open option),
  then `enableLoadExtension(true)` + `vec.load(db)`; `sqlite-vec@^0.1.9`.
- Virtual table `vectorstore_shadow_vec0`:
  `CREATE VIRTUAL TABLE IF NOT EXISTS vectorstore_shadow_vec0 USING vec0(
embedding float[<dim>] distance_metric=cosine,
+node_id INTEGER, +chunk_idx INTEGER, +model_id INTEGER)` — aux `+` columns carry
  the space key; `chunk_idx = -1` marks the pooled row, `0..n-1` the chunk rows
  (vec0 aux INTEGER columns reject NULL and reject f64 bindings — every integer binds
  as BigInt). The virtual table plus its shadow internals live OUTSIDE the tracked DDL
  chain (§2.4); `DROP TABLE vectorstore_shadow_vec0` removes the artifact completely.
- Shadow rows are re-synced from canonical TEXT (`loadRows(modelId, null)`) whenever the
  shadow is stale (absent, wrong dim, or its `user_version` stamp ≠ the canonical
  generation counter) — same per-query freshness as JsFallback, no resident state.
- KNN statement: `SELECT node_id, chunk_idx, distance FROM vectorstore_shadow_vec0
WHERE embedding MATCH ? AND k = ?` (query vector JSON-stringified). Returned ids are
  JS numbers; ids beyond `Number.MAX_SAFE_INTEGER` are rejected at INSERT with a
  console.warn (sentinel skip — product ids are sequences far below 2^53; vec0 f64
  returns cannot round-trip larger integers).
- vec0 distances are FLOAT32 approximations of `1 − cosine`; the vec0 KNN ranks
  CANDIDATES ONLY. Scores are recomputed in f64 via `vectorMath.cosineSimilarity` over
  the canonical TEXT rows so `neighbors` output stays exact≡oracle (§2.6).
- `neighbors` ACL enforcement uses the §2.5 `neighborsFiltered` helper (no join-KNN);
  `userScope: null` loads the full model space and passes `candidates` through.

### 2.5 vec0 constraints & the ACL filter helper

- Requires the **node:sqlite driver** (current `sqlite3` npm exposes no extension
  loading); migration confined to `db/sqliteExecutor.js`;
  **product Node floor ≥24** (node:sqlite experimental flag on v24 — tolerated, works).
- vec0 integer PKs bind via **BigInt** (node:sqlite binds JS numbers as doubles —
  silently corrupts vec0 keys otherwise). This extends to EVERY vec0 INTEGER aux column
  (aux columns reject f64 bindings outright); vec0 SELECTs return ids as JS numbers.
- vec0 + JOIN has a planner bug ⇒ NO join-KNN: ACL filtering uses
  `neighborsFiltered(vec, k, aclPredicate)`: oversample `k·f` (f default 4) from the
  shadow → SQL/JS filter to the visible set → if fewer than k survive, adaptive retry
  doubling the oversample (bounded rounds, then short list — correctness over padding).
  The helper is SHARED code and is also the valid pre-0.7 pg behavior.
  Interim note (until the helper lands): `PgVector` implements the same
  oversample→filter→adaptive-retry inline with the f=4 default so its ANN leg is
  self-contained; consolidation into `aclFilter.js` must not change behavior.

### 2.6 Accuracy contract

- Conformance suite, per active engine:
- EXACT engines (JsFallback, vec0-flat): results IDENTICAL to the JS oracle
  (`vectorMath` cosine over `allVectors`) — bit-parity of scores within fp tolerance.
  For the vec0 adapter this is achieved by f64 score recomputation over canonical TEXT
  rows (§2.4a): the vec0 f32 `distance` column ranks candidates only and is never
  returned to callers.
- ANN engine (pgvector HNSW ef_search=400): **recall@50 ≥ 0.99** graded with
  **HELD-OUT (external) queries only** — self-queries are banned as grading input.
- Cross-engine result-identity is NOT promised (ANN is approximate); the promise is
  the recall floor.
- Suite layout (binding): `runExactEngineConformance` grades EXACT engines only
  (bit-parity of scores is unreachable for a C-side ANN accumulation order — the ANN
  engine is graded by the recall leg instead, never by the exact harness). The ANN leg
  runs against real pgvector (0.8.x verified) with a deterministic clustered corpus and
  HELD-OUT queries = noisy perturbations of corpus vectors (never byte-equal to a corpus
  row; a self-query grading input fails the suite). It also captures the
  `SET LOCAL hnsw.ef_search = 400` statement on every ANN query (knob-bites assertion)
  and measures the ef=100 contrast for evidence only.
- PG test leg: the recall leg needs a pgvector-enabled server
  (`pgvector/pgvector:pg16`); against a plain `postgres:16` the real-PG describes SKIP
  (extension probe fails ⇒ `describe.skip` with the reason). Run via
  `npm run test:ci:pg:vector` (server/package.json) targeting the `WEA_TEST_PG_*`
  namespace.
- Reference corpus + query set are the dev-owned release artifact (shipped as
  profile values, `calibrated:false` provenance in admin; NOT shipped
  to end users).

## 3. Configuration

Boot-frozen engine selection (no key). Operational: `VECTOR_OVERSAMPLE_F` (T2, default
4, §2.5). `hnsw.ef_search=400` is FIXED in code (not a knob — never the library default
100). Threshold/θ values that CONSUMERS pass are
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
      while pooled-only would score <0.5 (regression fixture); node dedup before k
- [ ] ACL: a candidate invisible to the requester NEVER appears even when it ranks in
      the raw top-k (oversample/filter/retry legs: f=4 hit, adaptive retry hit, short-
      list terminal case)
- [ ] vec0: BigInt PK round-trip (id > 2^53 sentinel skipped with warning —
      product ids are sequences far below that; assert binding type is BigInt not double);
      no JOIN-in-knn SQL in the adapter (grep the statements); every aux INTEGER column
      binds as BigInt; shadow re-syncs from canonical TEXT when stale and a dropped-
      shadow rebuild reproduces identical neighbor results (never-tracked-DDL rule §2.4)
- [ ] Accuracy contract (§2.6): exact engines ≡ JS oracle on the reference set; pg ANN leg reports
      recall@50 ≥0.99 at ef_search=400 with held-out queries ONLY (self-query grading
      makes the suite fail); vec0 recall@50 ≥0.99 held-out (§2.4a — the vec0 KNN is a
      candidate prefilter, recall measured end-to-end through the f64 rescoring path)
- [ ] ef_search assertion: captured `SET LOCAL hnsw.ef_search=400` on every ANN query;
      removing the setting degrades the recall leg (proves the knob bites)
- [ ] Shadow rebuild: drop derived artifacts → `rebuildShadow()` from canonical TEXT →
      identical neighbor scores; canonical rows untouched throughout
- [ ] Model dim change: shadow rebuilt at new dim; stale-space rows absent;
      cross-model_id candidate never returned (space key discipline)
- [ ] `allVectors` leaves no resident state between calls (heap probe / re-query loads
      again) — no-cache-state gate grep + behavior
- [ ] L2 conformance on real sqlite (test:ci) AND real PostgreSQL (test:ci:pg:adapters)

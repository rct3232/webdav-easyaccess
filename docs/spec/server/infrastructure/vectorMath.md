# vectorMath & TextVectorJs Spec

Target-contract spec. Seam authority: [vectorStore.md](vectorStore.md) — this doc owns the
pure math/extractor modules and the exact-computation oracle behind the seam.

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Shared deterministic foundation for every vector computation: `vectorMath` (pure operations + the canonical TEXT codec), the local text extractors (bytes→text and the segmentation ladder), and `TextVectorJs` — the JsFallback engine of vectorStore.md §2.3 that doubles as the exact-computation reference for the conformance gate (vectorStore.md §2.6). |
| Determinism  | Every exported function is pure: same inputs ⇒ identical outputs, no side effects, no I/O, no `Date.now()`/`Math.random()`. Scores are 64-bit doubles; no fused/widened arithmetic beyond the operations defined here.                                                                                                                                         |
| Canonicality | `embeddings.vector` / `embeddings_chunk.vector` TEXT columns remain the system of record (vectorStore.md §1). `vectorMath` owns the only sanctioned serialize/parse codec for that column.                                                                                                                                                                     |

## 2. vectorMath

### 2.1 File Paths

- **Source:** `server/domains/ai/vectorStore/vectorMath.js`
- **Tests:** `server/domains/ai/vectorStore/__tests__/vectorMath.test.js`

### 2.2 Operations (exact public surface)

| Function                           | Contract                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serializeVector(vec)`             | TEXT form: elements joined by `,`, each via JS number stringification (shortest exact round-trip for doubles).                                                                                                                                                                |
| `parseVector(text, dim)`           | Reverse of `serializeVector`; `Number` per element; throws `dimMismatch` when the element count ≠ `dim`; throws `invalidVector` on any non-finite element.                                                                                                                    |
| `l2Norm(vec)`                      | `sqrt(Σ vᵢ²)`; empty vector ⇒ `0`.                                                                                                                                                                                                                                            |
| `dotProduct(a, b)`                 | `Σ aᵢ·bᵢ`; throws `dimMismatch` on length mismatch.                                                                                                                                                                                                                           |
| `cosineSimilarity(a, b)`           | `dot(a,b) / (‖a‖·‖b‖)`; a zero-norm operand ⇒ `0` (no direction). Throws `dimMismatch` on length mismatch.                                                                                                                                                                    |
| `unitNormalize(vec)`               | `vec / ‖vec‖`; a zero-norm vector returns the zero vector unchanged (no division by zero).                                                                                                                                                                                    |
| `meanPool(vecs)`                   | Element-wise mean of the rows, then `unitNormalize` of the mean — the pooled-row rule (mean + renormalize, collections-platform.md §4.3). Throws `emptyVectors` on `[]`.                                                                                                      |
| `truncateAndRenormalize(vec, dim)` | MRL truncation: slice to the first `dim` elements, then `unitNormalize` — slicing breaks unit length, so renormalization is mandatory and query and corpus share the stored dim (vectorStore.md §2.6 accuracy contract). Throws `dimMismatch` when `dim` ≥ the source length. |

### 2.3 Error contract

Thrown errors carry a `code` property (`dimMismatch` | `invalidVector` | `emptyVectors`)
— engine code branches on the code, never on message text.

## 3. TextVectorJs (JsFallback engine — the oracle)

### 3.1 File Paths

- **Source:** `server/domains/ai/vectorStore/TextVectorJs.js`
- **Tests:** `server/domains/ai/vectorStore/__tests__/conformance.test.js`

### 3.2 Construction (adapter-injection seam)

`createTextVectorJs({ modelId, loadRows, upsertPooled, replaceChunks, transaction })` —
persistence is injected; the engine holds no store imports of its own (unit-testable
against in-memory doubles; the seam factory wires real stores — vectorStore.md §2.1).

- `loadRows(modelId, userScope)` → rows of `{ nodeId, chunkIdx, vector, dim }` where
  `chunkIdx: null` marks the pooled row — the canonical read executed per call; ACL
  scoping rides the loader (fileNodesStore joins, vectorStore.md §2.2; `userScope: null`
  = provider-global). The engine NEVER caches rows across calls (no-resident-state gate).
- `upsertPooled(row)` / `replaceChunks(nodeId, vectors)` — the two write halves, executed
  inside the injected `transaction(fn)` so pooled + chunk halves commit atomically
  (vectorStore.md §2.2).

### 3.3 Engine behavior (exact)

- `upsert(nodeId, vecs[], dim)`: `vecs[0]` is the pooled row; `vecs.slice(1)` are the
  chunk vectors (`chunkIdx` dense from 0). One element ⇒ the chunk half is empty
  (replace-with-empty deletes prior chunks). One TX.
- `allVectors(userScope)`: parsed pooled + chunk rows for the bound `modelId`, via
  `loadRows(modelId, userScope)` + `vectorMath.parseVector`. Returns
  `{ nodeId, chunkIdx, vector, dim }` rows; no resident state.
- `neighbors(queryVec, k, candidates)`:
  - `candidates` restricts ranking to visible nodes: a `Set` of node ids, a predicate
    `(nodeId) => boolean`, or `null` (no restriction). Enforced engine-side before
    ranking.
  - per-node score = **max over the node's chunk-row cosines** when chunk rows exist,
    the pooled-row cosine otherwise (searchService.md §2.3 max-over-chunks).
  - rows whose `dim` ≠ the query length are skipped (space-key discipline — a
    mismatched dim can never score).
  - node ids are deduped BEFORE `k` is cut; results ordered score desc, then `node_id`
    asc; cut to `k` after dedup.
- `rebuildShadow()`: no-op for this engine — the JsFallback has no derived artifact
  (vectorStore.md §2.4); present so the seam contract is uniform across engines.

### 3.4 Oracle role

The conformance gate (vectorStore.md §2.6) grades every exact engine against
`TextVectorJs` output. `TextVectorJs` itself is graded against an independent naive
recomputation performed by the conformance harness (plain arithmetic loops over the raw
serialized TEXT rows — deliberately NOT the `vectorMath` helpers, so the codec and the
math are cross-checked, not self-referential).

## 4. Extractors

### 4.1 File Paths

- **Source:** `server/domains/ai/extractors/documentText.js`,
  `server/domains/ai/extractors/textChunking.js`
- **Tests:** `server/domains/ai/extractors/__tests__/documentText.test.js`,
  `server/domains/ai/extractors/__tests__/textChunking.test.js`

### 4.2 documentText (bytes → text)

- `extractText({ buffer, mimeType })` → `{ text, extractor }` where `extractor` is one of
  `'plain' | 'pdf' | 'docx'`.
- `text/*` (and `application/json`) → UTF-8 decode (`plain`).
- `application/pdf` → pdfjs-dist legacy build, text content of every page joined in page
  order (`pdf`). No OCR; image-only pages contribute nothing.
- docx (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) →
  ZIP container read via `node:zlib` + `word/document.xml` paragraph text (`docx`).
- Any other mime ⇒ thrown error with `code: 'unextractableText'` — the embed worker maps
  it to a typed skip (aiJobService.md §2.3), never a job failure.
- Deterministic: identical bytes ⇒ identical text.

### 4.3 textChunking (the segmentation ladder, pure)

- `splitSegments(text)` → paragraph/heading segments: blank-line-separated paragraphs;
  heading-style lines (`#`-prefixed) form their own segment boundaries.
- `charWindows(text, maxChars)` → fixed-size char windows (the ladder fallback).
- `chunkPool(text, { maxChunkChars, chunkBudget })` → `{ chunks, sampled }`:
  paragraph/heading segmentation first; a segment longer than `maxChunkChars` falls back
  to char windows; when more chunks than `chunkBudget` remain, a uniform-stride sample of
  exactly `chunkBudget` chunks is returned and `sampled: true` is reported.
  Budget VALUES are caller-supplied — the budget chain lives in the LLM adapter
  (collections-platform.md §4.3); this module owns only the segmentation.

## 5. Conformance harness

`server/domains/ai/vectorStore/__tests__/conformance.test.js` exports
`runExactEngineConformance({ createEngine, corpus, k = 10 })` — `createEngine(deps)`
constructs the engine under test with the harness-provided canonical doubles
(`{ loadRows, upsertPooled, replaceChunks, transaction }`), `corpus` is a
`buildCorpus({...})` fixture, `k` the neighbor cut — so the native adapters pin
their engines with the SAME legs (vectorStore.md §2.6):

- deterministic fixture corpus (seeded xorshift PRNG — never `Math.random`) serialized
  through the canonical codec;
- oracle leg: engine `neighbors` output ≡ the naive recomputation — score bit-parity,
  identical ordering and ids, dedup-before-k;
- held-out queries only (vectorStore.md §2.6): fixture queries are never corpus rows;
- regression legs: max-over-chunks fixture (mid-section match ≥ 0.6 while the pooled row
  scores < 0.5), candidates filtering, zero-norm handling, dim-mismatch skipping,
  repeat-call determinism.

## 6. Dependencies

- `vectorMath`: none.
- `TextVectorJs`: `vectorMath` + injected loaders/writers only.
- extractors: `pdfjs-dist` (server dependency), `node:zlib`.
- Callers: vectorStore engines (vectorStore.md §2.3), the embed pipeline
  (aiJobService.md §2.4 — extraction + segmentation inputs), evolutionService (centroid
  math via `vectorMath`).

## 7. Verification Scenarios

- [ ] Codec: TEXT round-trip is bit-stable at `dim` (embeddingsStore.md §2.2); wrong
      length and non-finite values reject with the documented codes
- [ ] Cosine pins: identical ⇒ 1, orthogonal ⇒ 0, opposite ⇒ −1, zero-norm operand ⇒ 0
- [ ] `meanPool` returns a unit vector for non-zero input and preserves direction
- [ ] MRL: `truncateAndRenormalize` restores unit length after slicing
- [ ] `TextVectorJs.neighbors` ≡ naive oracle recomputation on the fixture corpus
      (scores, order, ids, dedup-before-k)
- [ ] max-over-chunks regression fixture: chunk-max ≥ 0.6 while pooled-only < 0.5
- [ ] `candidates` filtering: an invisible node ranking in the raw top-k never appears
- [ ] Dim mismatch: a row of another dim never scores; the query dim wins
- [ ] No resident state: consecutive `allVectors`/`neighbors` calls re-execute the loader
      (call counter grows; nothing memoized)
- [ ] `upsert`: pooled + chunk halves written through the single injected transaction;
      single-element `vecs` deletes prior chunk rows
- [ ] Extractors: pdf/docx/plain extraction deterministic; unknown mime ⇒
      `unextractableText`; chunk ladder legs (paragraph split, window fallback,
      uniform-stride sample cap, `sampled` flag)

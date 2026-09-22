# searchService Spec

Target-contract spec. Wire contract authority: [routes/search.md](../routes/search.md) — this
spec owns the engine behind it.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | The Search Engine layer (§4.22): two-stage hybrid query — `name_matches` (LLM-free containment SQL, ships P0) + `semantic` (segment-AND vector scoring, P1) — assembly, dedup, per-query dynamic baseline gate, `result_ref` signature emission, `search_hit` usage logging.                                                                                                                                                                                                                                                              |
| Boundaries | SQL executes against `fileNodesStore` ACL joins (closure/owner logic identical to `fileService` listing) — a node the requester cannot read never enters either section. The conversational layer is a RESERVED boundary: this MVP emits and structurally accepts `result_ref` only; no session state, no predicate parsing (`parse.nl` extends this service later, same two-section response). No LLM call blocks the request EXCEPT the query embed (invariant 11's exception family: cache + kill-switch + no-LLM fallback mandatory). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/ai/searchService.js`
- **Test file:** `server/domains/ai/__tests__/searchService.test.js` (+ route suite
  `__tests__/search.test.js`)

### 2.2 Public contract

`search(userId, { query, resultRef? })` → the domain object serialized by the route
(snake_case wire per routes §2.4). Throws `queryRequired` / `queryTooLong` / `fail`;
AI-absence is DATA, never an error (§4.12). `resultRef` is accepted, stored on the
signature computation input as `null`, and IGNORED by the MVP (interpretation is the
future layer's job) — sending it never changes the response.

### 2.3 Pipeline (per request)

1. **Validate + normalize:** trim; 1–200 chars. Normalized form (NFKC, ASCII-case fold,
   whitespace collapse) is the signature/cache key material.
2. **`name_matches`** (P0, zero-LLM): repository addition
   `FileNodeRepository.searchNodesByName(userId, query, limit)` —
   `lower(name) LIKE lower('%'||:query||'%')` over ALL user-visible file_nodes; the
   `lower()` on BOTH sides is mandatory (sqlite LIKE is ASCII-case-folded only).
   Whole-string containment — token-AND is explicitly NOT used (a 2-word query with no
   single-name containment legitimately returns zero rows; that is the semantic
   section's job). Order `name` asc then `node_id` asc; hard cap 200 →
   `counts.name_truncated`. Highlight ranges are CLIENT-side; the server never returns
   markup offsets.
3. **Semantic gate:** `roleConfigured('embed')` ∧ `AI_SEMANTIC_SEARCH_ENABLED` (kill
   switch) — false ⇒ response omits `semantic`, `semantic_available:false`,
   `semantic_unavailable_reason:"serverErrors.ai.notConfigured"`; done (name section
   intact, 200).
4. **Query embed :** `llmAdapter.embedQuery(normalizedQuery)` — the ONLY request-path
   AI call in the system; <100 ms-class model expectation; results cached. **Decision:**
   the cache IS the `query_parses` row — signature = its PK (§4.22/§5) — via an ADDITIVE
   nullable column `vector TEXT` (serialized query embedding, model-keyed inside the
   signature's space component); the `predicates` column keeps its the corresponding docs step NL-parse meaning
   untouched. DDL ships in `001_initial_normalized_schema.sql`. On ANY
   provider failure/timeout/mid-switch error ⇒ degrade honestly: empty semantic section

- `semantic_available:true` retained (config IS present) but `counts.semantic:0` —
  never a 5xx (§4.2 "mid-switch failure degrades per §4.12, never surfaces as error").

5. **Segment-AND:** split the ORIGINAL query on whitespace; ≤3 segments (more ⇒ first 3
   used + `counts.semantic_capped_segments:true`). Each segment is embedded through the
   same cached path. Per segment: `vectorStore.neighbors(segVec, k=50, visibleIds)` →
   per-node **max-over-chunks** cosine (§4.3/E12: chunk rows, not the pooled row).
   Document score = **MIN across segments** (E3: composite queries like
   "enjoyable fantasy movies I watched" fail under whole-sentence cosine alone). Single-segment queries:
   MIN degenerates to the segment score (no special case).
6. **Per-query dynamic baseline gate:** the SAME segment vectors are scored against a
   random ~500-doc sample of the requester's visible corpus (`BASELINE_SAMPLE_DOCS`,
   default 500 — operational constant). `spread` = the sample's max min-across-segments
   score. Keep results only if top candidate score ≥ `spread + δ_base`; otherwise return
   the section HONESTLY EMPTY (kills the anisotropy majority-class fallback on nonsense
   queries — E2v2/E11). `δ_base` ships in the model profile — release-measured value;
   there are NO absolute stored floors anywhere (the pre-implementation study §2.5/2.6; §9 bans absolute-θ gates).
7. **Assembly + dedup:** `semantic` ordered score desc then `node_id` asc, cap 50;
   entries already present in `name_matches` are REMOVED from `semantic` display;
   `counts.total` = post-dedup displayed rows. Section order in the response is fixed
   (name first) — "no results in section 1 → show only section 2" is a pure client
   display rule on the returned arrays.
8. **Usage logging:** one `usage_events` row `action='search_hit'` per RETURNED node
   (both sections; §3.4 low-frequency endpoint rule) — fire-and-forget post-response.

### 2.4 `result_ref` construction (§4.22 replay rule)

`sig = sha256( normalized-predicates ∥ vector-query ∥ space ∥ sort )`, wire form
`"sr1." + hex(sig)[0..16]`.

- MVP material: `normalized-predicates` = the normalized query string (§4.6 name-only
  fallback signature covers query string + space + sort; structured predicate slots
  serialize `""` and are reserved-additive for §4.22 deltas); `vector-query` = the
  embedded query text (normalized) or `""` when the semantic leg did not run; `space` =
  `v1|model:{embedModelId}` (the E-space key — a model change MUST change the signature,
  replay in a new space is meaningless); `sort` = the stable section-order+caps version.
- Determinism: same inputs ⇒ same `result_ref` (no timestamps, no random seeds — the
  baseline sample is execution noise and deliberately NOT signature material; replay
  re-samples). **Replay is the contract:** the reference resolves by RE-RUNNING the
  signature under CURRENT ACL at future execution time (Q7 always-replay — stored
  id-snapshots freeze past-ACL and are rejected, §9); an "of those…" follow-up =
  `rerun(sig) ∩ new-execution`. Cost is bounded by the §4.13 candidate caps.
- The signature doubles as the `query_parses` cache key (no separate table, §5).
  "those photos" pronominal binding, delta semantics, `$ref` intersections: FUTURE layer
  (§4.22 utterance-merge table) — this service only guarantees the emitted string is
  replay-derivable from its own content.

### 2.5 Repository / seam additions

| Addition                                                       | Owner spec                                           | Purpose                              |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| `FileNodeRepository.searchNodesByName(userId, query, {limit})` | FileNodeRepository twins (+conformance)              | ACL-scoped `lower LIKE` name section |
| `FileNodeRepository.sampleVisibleNodeIds(userId, n)`           | same                                                 | baseline corpus sample               |
| `vectorStore.neighbors(vec, k, candidates)`                    | [vectorStore](../infrastructure/vectorStore.md) §2.3 | max-over-chunks per-segment scoring  |
| `query_parses` repository                                      | `docs/features/collections-platform.md` §5           | signature-keyed embed/parse cache    |

### 2.6 Save-to-collection boundary (§4.6)

`semantic_available:false` OR empty `semantic` ⇒ the `Save as collection` button is HIDDEN
(client consumes the flag). Saved collections capture the SEMANTIC portion only —
name-match results are structurally excluded from definitions (§4.6; flatten snapshot via
`collectionsService.createSearchCollection`, whose confirm dialog carries the §4.5
batch-publish copy). This service NEVER persists collections.

### 2.7 Thrown string codes → route ERROR_MAP

| Thrown code     | → SERVER_ERROR_CODES   | HTTP |
| --------------- | ---------------------- | ---- |
| `queryRequired` | `search.queryRequired` | 400  |
| `queryTooLong`  | `search.queryTooLong`  | 400  |
| `searchFail`    | `search.fail`          | 500  |

`aiNotConfigured` is NOT thrown here — it appears only as the
`semantic_unavailable_reason` string constant on a 200 (§4.12: a section is absent, not
the feature; routes §2.4.1). `fail` is reserved for engine-internal errors (SQL throw,
vectorStore invariant break) — provider failure is a DEGRADATION, not a `fail`.

## 3. Configuration (T2 / dbOnly)

| Key                          | Default | Use                                                                   |
| ---------------------------- | ------- | --------------------------------------------------------------------- |
| `AI_SEMANTIC_SEARCH_ENABLED` | `true`  | query-embed kill switch (mandated by invariant 11's exception family) |
| `SEARCH_NAME_LIMIT`          | `200`   | name-section hard cap                                                 |
| `SEARCH_SEMANTIC_LIMIT`      | `50`    | semantic-section cap                                                  |
| `BASELINE_SAMPLE_DOCS`       | `500`   | dynamic-baseline sample size                                          |
| segment cap                  | `3`     | §4.6 bound (scoring limit, not input validation — routes decision)    |

`δ_base` and per-segment k are per-model profile values — release-measured (§4.15
provenance), never runtime-calibrated.

## 4. Dependencies

- `llmAdapter` (`embedQuery`, presence/kill-switch state), `vectorStore` seam,
  `fileNodesStore`/FileNodeRepository (ACL joins, name SQL, sampling),
  `query_parses` repository, usage-event writer (usage domain, `docs/features/collections-platform.md` §3.4), `configResolver`
- NOT used: any chat role on this path (`parse.nl` chains onto this SAME response
  shape later — additive header tab, no contract break, §4.6 alignment note)

## 5. Verification Scenarios

- [ ] `lower("NOTE")` query matches `fun-note.pdf` via both-sides `lower()`; a
      mid-string containment miss returns nothing (no fuzzy, no token-AND)
- [ ] 2-word query, no single-name containment → `name_matches: []` with 200 + intact
      semantic section (the sections are independent)
- [ ] ACL: node invisible to requester appears in NEITHER section, regardless of path or
      vector score (fixture: private other-user file)
- [ ] Dedup: node matching both name and vector shows ONLY under `name_matches`;
      `counts.total` reflects the de-duplicated set
- [ ] Segment-AND: 3-word composite → score = MIN across segments; 4 words → first 3 +
      `semantic_capped_segments:true`; 1 word → plain segment score
- [ ] Dynamic baseline: query embedding a nonsense string (random chars) returns an
      honestly EMPTY `semantic` section, `semantic_available` still true; a real query
      returns rows above `spread + δ_base`
- [ ] embed unconfigured → 200, `semantic` key ABSENT, `semantic_unavailable_reason` set,
      name section intact; kill switch off ⇒ identical shape
- [ ] Fake-adapter timeout ⇒ name section + `counts.total` unaffected, semantic empty,
      NO 5xx (`never surfaces as error`, §4.2)
- [ ] `result_ref`: present on every 200; identical query+corpus+model+sort ⇒ byte-identical
      signature; model id change flips the `space` component (signature changes); request
      `result_ref` accepted and provably ignored (same shape, fresh signature)
- [ ] Same query twice: second call served from `query_parses` signature cache (fake
      adapter call count = 1)
- [ ] `usage_events` `search_hit` rows: exactly one per returned node, none for
      deduplicated-away or truncated rows
- [ ] Response fields snake_case; scores 0–1 rounded 2-dec; empty query 400, >200 chars 400

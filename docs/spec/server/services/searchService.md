# searchService Spec

Target-contract spec. Wire contract authority: [routes/search.md](../routes/search.md) — this
spec owns the engine behind it.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role       | The Search Engine layer: two-stage hybrid query — `name_matches` (LLM-free containment SQL, ships P0) + `semantic` (segment-AND vector scoring, P1) — assembly, dedup, per-query dynamic baseline gate, `result_ref` signature emission, `search_hit` usage logging.                                                                                                                                                                                                                                                                                                                                                     |
| Boundaries | SQL executes against `fileNodesStore` ACL joins (closure/owner logic identical to `fileService` listing) — a node the requester cannot read never enters either section. The conversational layer is a RESERVED boundary: this MVP emits and structurally accepts `result_ref` only; no session state, no predicate parsing (`parse.nl` extends this service later, same two-section response). No LLM call blocks the request EXCEPT the query embed (the only allowed exception to the no-LLM-on-request-paths rule is explicitly user-initiated interactive roles — cache + kill-switch + no-LLM fallback mandatory). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/ai/searchService.js`
- **Test file:** `server/domains/ai/__tests__/searchService.test.js` (+ route suite
  `__tests__/search.test.js`)

### 2.2 Public contract

`search(userId, { query, resultRef? })` → the domain object serialized by the route
(snake_case wire per routes §2.4). Throws `queryRequired` / `queryTooLong` / `fail`;
AI-absence is DATA, never an error (a section is absent, not the feature). `resultRef` is accepted, stored on the
signature computation input as `null`, and IGNORED by the MVP (interpretation is the
future layer's job) — sending it never changes the response.

### 2.3 Pipeline (per request)

1. **Validate + normalize:** trim; 1–200 chars. Normalized form (NFKC, ASCII-case fold,
   whitespace collapse) is the signature/cache key material.
2. **`name_matches`** (P0, zero-LLM): repository addition
   `FileNodeRepository.searchNodesByName(userId, query, limit)` —
   `lower(name) LIKE lower('%'||:query||'%')` over ALL user-visible file_nodes; the
   `lower()` on BOTH sides is mandatory (sqlite LIKE is ASCII-case-folded only).
   Whole-string containment — token-AND is explicitly NOT used. Order `name` asc then `node_id` asc; hard cap 200 →
   `counts.name_truncated`. Highlight ranges are CLIENT-side; the server never returns
   markup offsets.
3. **Semantic gate:** `roleConfigured('embed')` ∧ `AI_SEMANTIC_SEARCH_ENABLED` (kill
   switch) — false ⇒ response omits `semantic`, `semantic_available:false`,
   `semantic_unavailable_reason:"serverErrors.ai.notConfigured"`; done (name section
   intact, 200).
4. **Query embed :** `llmAdapter.embedQuery(text)` — the ONLY request-path AI call in
   the system. The `query_parses` cache is OWNED BY THIS LEG (the adapter call is the
   raw provider embed — llmAdapter.md §2.2): get-or-embed keyed by the NORMALIZED
   TEXT — `query_parses.normalized_query` IS the primary key (no separate cache
   table; the `result_ref` signature is derivable from the row, not its key). DDL
   ships in `001_initial_normalized_schema.sql`. Row contract:
   - `vector TEXT` holds a JSON envelope `{ space, dim, v }` — the serialized query
     embedding plus the E-space identity (§2.4) it was produced in. A row is a cache
     HIT only when the envelope parses AND its `space` equals the CURRENT space
     identity; any other shape or model ⇒ MISS: re-embed and overwrite `vector`
     (`hit_count` is not incremented by a write).
   - Cache HIT ⇒ `hit_count` incremented by 1, the stored vector reused, ZERO
     provider calls.
   - `predicates` is RESERVED for NL-parse output — this stage always stores `[]`.
   - Space identity resolution is deterministic and provider-call-free: the ACTIVE
     embed registry row id (`llmModelsStore.getActiveByRole('embed')`) when present;
     otherwise the embedded lock identity `repo@revision`
     (`provisioner.loadLock()`); otherwise the empty string. When the embed call
     reports a DIFFERENT model id than the resolved identity (mid-switch) ⇒ degrade
     honestly (below).
   Segments reuse the SAME cached path with their own normalized segment text
   (§2.3 step 5); the ≤3 cap flag is set from the segment count regardless of the
   scoring outcome. On ANY provider failure/timeout/mid-switch error ⇒ degrade
   honestly: empty semantic section

- `semantic_available:true` retained (config IS present) but `counts.semantic:0` —
  never a 5xx (a mid-switch config failure degrades honestly, never surfaces as error).
  A failed cache READ is treated as a MISS and a failed cache WRITE is dropped — the
  cache is an optimization, never a correctness dependency (the provider embed still
  serves the leg).

5. **Segment-AND:** split the ORIGINAL query on whitespace; ≤3 segments (more ⇒ first 3
   used + `counts.semantic_capped_segments:true`). Each segment is embedded through the
   same cached path. Per segment: `vectorStore.neighbors(segVec, k=50, visibleIds)` →
   per-node **max-over-chunks** cosine (chunk rows, not the pooled row).
   Document score = **MIN across segments**. Single-segment queries:
   MIN degenerates to the segment score (no special case).
6. **Per-query dynamic baseline gate:** the SAME segment vectors are scored against a
   random ~500-doc sample of the requester's visible corpus (`BASELINE_SAMPLE_DOCS`,
   default 500 — operational constant) drawn EXCLUDING the candidate set (an unrestricted
   sample contains the true top candidate often enough to pin the margin to zero).
   `spread` = the sample's max min-across-segments
   score. Keep results only if top candidate score ≥ `spread + δ_base`; otherwise return
   the section HONESTLY EMPTY (an honestly empty section beats a wrong one on nonsense queries). `δ_base` ships in the model profile — release-measured value;
   there are NO absolute stored floors anywhere (absolute-θ gates are banned).
7. **Assembly + dedup:** `semantic` ordered score desc then `node_id` asc, cap 50
   (`SEARCH_SEMANTIC_LIMIT`);
   entries already present in `name_matches` are REMOVED from `semantic` display;
   `counts.total` = post-dedup displayed rows. Section order in the response is fixed
   (name first) — "no results in section 1 → show only section 2" is a pure client
   display rule on the returned arrays. Wire presence rules (routes/search.md §2.4):
   the `semantic` key and the `semantic_capped_segments` flag are present whenever
   the gate let the leg run (an honestly EMPTY leg returns `"semantic": []` — absence
   and honest emptiness are distinct wire states); the gate kept the leg off ⇒ both
   are omitted with the §2.3 step-3 degrade shape.
8. **Usage logging:** one `usage_events` row `action='search_hit'` per RETURNED node
   (both sections; low-frequency endpoints only — never directory listings, the write-amplification guard) — fire-and-forget post-response.

### 2.4 `result_ref` construction (replay rule)

`sig = sha256( normalized-predicates ∥ vector-query ∥ space ∥ sort )`, wire form
`"sr1." + hex(sig)[0..16]`.

- MVP material: `normalized-predicates` = the normalized query string (the name-only
  fallback signature covers query string + space + sort; structured predicate slots
  serialize `""` and are reserved-additive for future conversational deltas); `vector-query` = the
  embedded query text (normalized) or `""` when the semantic leg did not run; `space` =
  `v1|model:{embedModelId}` (the E-space key — a model change MUST change the signature,
  replay in a new space is meaningless). The model component follows the §2.3 step-4
  identity chain (registry row id, else the `repo@revision` lock fallback, else empty);
  when the leg did NOT run the whole space stays the P0 empty-model form `v1|model:`
  (deterministic and replay-stable); `sort` = the stable section-order+caps version.
- Determinism: same inputs ⇒ same `result_ref` (no timestamps, no random seeds — the
  baseline sample is execution noise and deliberately NOT signature material; replay
  re-samples). **Replay is the contract:** the reference resolves by RE-RUNNING the
  signature under CURRENT ACL at future execution time (stored id-snapshot variants:
  rejected — a frozen id list would keep past-ACL-revoked or purged nodes addressable); an "of those…" follow-up =
  `rerun(sig) ∩ new-execution`. Cost is bounded by the vectorStore candidate caps.
- The signature doubles as the `query_parses` cache row's space material (the row's
  primary key is the normalized query text — §2.3 step 4).
  "those photos" pronominal binding, delta semantics, `$ref` intersections: FUTURE
  conversational layer (utterance-merge rules) — this service only guarantees the emitted string is
  replay-derivable from its own content.

### 2.5 Repository / seam additions

| Addition                                                       | Owner spec                                           | Purpose                              |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| `FileNodeRepository.searchNodesByName(userId, query, {limit})` | FileNodeRepository twins (+conformance)              | ACL-scoped `lower LIKE` name section |
| `FileNodeRepository.sampleVisibleNodeIds(userId, n)`           | same                                                 | baseline corpus sample               |
| `vectorStore.neighbors(vec, k, candidates)`                    | [vectorStore](../infrastructure/vectorStore.md) §2.3 | max-over-chunks per-segment scoring  |
| `query_parses` repository                                      | `docs/features/collections-platform.md` §5           | signature-keyed embed/parse cache    |

### 2.5a The semantic scoring seam (steps 5–6 behind one boundary)

The scoring leg is ONE injectable factory option:

```
semanticScorer({ userId, queryVec, segmentVecs, sampleFn })
  → Array<{ nodeId, score }>   // score float 0–1
```

- `userId` — the requester; the ACL anchor. The scorer scopes EVERY vector
  operation to the requester's visible set (the `vectorStore.neighbors`
  `candidates` argument / the engine's userScope resolution) — a node the
  requester cannot read never reaches a score.
- `queryVec` — the cached full-query embedding (§2.3 step 4).
- `segmentVecs` — the ≤3 cached segment embeddings, positional (MIN-across-
  segments input; single-segment queries keep the degenerate form).
- `sampleFn(n)` — async; a random sample of at most `n` requester-visible live
  node ids (`FileNodeRepository.sampleVisibleNodeIds`) — the dynamic-baseline
  input; excluding the candidate set is the scorer's job (the baseline sample
  must not contain the true top candidate).
- The scorer OWNS the baseline gate: the `δ_base` margin over the sample's
  spread comes from the model profile; an ungated result is a spec violation.
- The service consumes the returned rows unchanged through steps 7–8 (order,
  dedup, cap, usage logging) — it never rescores.

No scorer injected ⇒ the leg cannot score: the semantic section is returned
HONESTLY EMPTY (`semantic_available:true`, `counts.semantic:0`) whenever the
§2.3 step-3 gate passed. Scores are never fabricated anywhere on this path.

### 2.6 Save-to-collection boundary

`semantic_available:false` OR empty `semantic` ⇒ the `Save as collection` button is HIDDEN
(client consumes the flag). Saved collections capture the SEMANTIC portion only —
name-match results are structurally excluded from definitions; the saved definition is the
flattened semantic snapshot via
`collectionsService.createSearchCollection`, whose confirm dialog carries the
batch-publish copy (the dialog states the ENTIRE initial set is publish-approved as a batch if/when the collection is shared). This service NEVER persists collections.

### 2.7 Thrown string codes → route ERROR_MAP

| Thrown code     | → SERVER_ERROR_CODES   | HTTP |
| --------------- | ---------------------- | ---- |
| `queryRequired` | `search.queryRequired` | 400  |
| `queryTooLong`  | `search.queryTooLong`  | 400  |
| `searchFail`    | `search.fail`          | 500  |

`aiNotConfigured` is NOT thrown here — it appears only as the
`semantic_unavailable_reason` string constant on a 200 (a section is absent, not
the feature; routes §2.4.1). `fail` is reserved for engine-internal errors (SQL throw,
vectorStore invariant break) — provider failure is a DEGRADATION, not a `fail`.

## 3. Configuration (T2 / dbOnly)

| Key                          | Default | Use                                                                                                               |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `AI_SEMANTIC_SEARCH_ENABLED` | `true`  | query-embed kill switch (mandatory part of the request-path LLM exception: cache + kill-switch + no-LLM fallback) |
| `SEARCH_NAME_LIMIT`          | `200`   | name-section hard cap                                                                                             |
| `SEARCH_SEMANTIC_LIMIT`      | `50`    | semantic-section cap                                                                                              |
| `BASELINE_SAMPLE_DOCS`       | `500`   | dynamic-baseline sample size                                                                                      |
| segment cap                  | `3`     | scoring bound (limit, not input validation)                                                                       |

`δ_base` and per-segment k are per-model profile values — release-measured
(release artifacts, no runtime calibration), never runtime-calibrated.

## 4. Dependencies

- `llmAdapter` (`embedQuery`, presence/kill-switch state), `vectorStore` seam,
  `fileNodesStore`/FileNodeRepository (ACL joins, name SQL, sampling),
  `query_parses` repository, usage-event writer (usage domain, `docs/features/collections-platform.md` §3.4), `configResolver`
- NOT used: any chat role on this path (`parse.nl` chains onto this SAME response
  shape later — additive header tab, no contract break)

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
      NO 5xx (provider failure never surfaces as error)
- [ ] `result_ref`: present on every 200; identical query+corpus+model+sort ⇒ byte-identical
      signature; model id change flips the `space` component (signature changes); request
      `result_ref` accepted and provably ignored (same shape, fresh signature)
- [ ] Same query twice: second call served from `query_parses` signature cache (fake
      adapter call count = 1), and the cache row's `hit_count` grew by exactly 1
- [ ] embed configured with no scoring seam ⇒ 200, `semantic` key PRESENT but empty
      (`[]`), `semantic_available:true`, `semantic_capped_segments` present — the
      absent-vs-honestly-empty distinction is observable on the wire
- [ ] Cache-row envelope from a different space (model change) ⇒ MISS: re-embed,
      `vector` overwritten, provider called again
- [ ] Provider failure with the role configured ⇒ `semantic` present-but-empty,
      `semantic_available:true`, name section + `counts.total` unchanged, NO 5xx
- [ ] `usage_events` `search_hit` rows: exactly one per returned node, none for
      deduplicated-away or truncated rows
- [ ] Response fields snake_case; scores 0–1 rounded 2-dec; empty query 400, >200 chars 400

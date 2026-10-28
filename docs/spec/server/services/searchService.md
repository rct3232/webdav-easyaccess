# searchService Spec

Target-contract spec. Wire contract authority: [routes/search.md](../routes/search.md) — this
spec owns the engine behind it.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | The Search Engine layer: two-stage hybrid query — `name_matches` (LLM-free containment SQL) + `semantic` (segment-AND vector scoring) — assembly, dedup, per-query dynamic baseline gate, `result_ref` signature emission, `search_hit` usage logging, and the `parse.nl` leg (chat → shared predicate grammar, §2.8) whose parsed predicate set is returned additively on the same two-section response.                                                                                                                                                                                                                                                                                                                                   |
| Boundaries | SQL executes against `fileNodesStore` ACL joins (closure/owner logic identical to `fileService` listing) — a node the requester cannot read never enters either section. The conversational layer (multi-turn routing, delta semantics, `$ref` interpretation) is a RESERVED boundary: this service emits and structurally accepts `result_ref` and carries request-side predicate STATE (field/value only) as `parse.nl` input; it stores no session and resolves no references. No LLM call blocks the request EXCEPT the query embed and the single `parse.nl` chat call (the allowed exceptions to the no-LLM-on-request-paths rule are explicitly user-initiated interactive roles — cache + kill-switch + no-LLM fallback mandatory). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/ai/searchService.js`
- **Peers:** `server/domains/ai/nlParser.js` (the §2.8 leg: prompt builder, closed schema,
  shared-grammar validation — pure module, adapter injected)
- **Test file:** `server/domains/ai/__tests__/searchService.test.js` (+ `nlParser.test.js`
  - route suite `__tests__/search.test.js`)

### 2.2 Public contract

`search(userId, { query, resultRef?, predicates? })` → the domain object serialized by the route
(snake_case wire per routes §2.4). Throws `queryRequired` / `queryTooLong` / `fail`;
AI-absence is DATA, never an error (a section is absent, not the feature). `resultRef` is accepted, stored on the
signature computation input as `null`, and IGNORED by this service (interpretation is the
future layer's job) — sending it never changes the response. `predicates` is the optional
request-side session predicate state (§2.8): an array of shared-grammar atoms
(path/tag/like/date/size); a non-array value or any non-grammar atom discards the whole state
(never a 4xx) and the parse runs stateless. Canonicalization through the shared grammar drops
every foreign key — the state is field/value ONLY by construction (atoms never carry vectors,
ids or permission data). When the
parse leg applies, the response carries `predicates` (the parsed canonical atom array, possibly
empty); when the chat role is unconfigured, its kill switch is off, or any parse step fails, the
key is ABSENT and the response shape is byte-identical to the parser-free contract.

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
   switch) — false ⇒ response omits `semantic` and sets `semantic_unavailable_reason`
   to the role-readiness token (`not_configured | preparing | provisioning_failed |
probe_failed | non_conforming | disabled`); done (name section intact, 200).

3a. **NL parse (`parse.nl`, §2.8):** `roleConfigured('chat')` ∧ `AI_NL_PARSE_ENABLED`
(kill switch) — false ⇒ the leg never runs and adds ZERO calls; the response then is
the §2.4/§2.3 shape with no `predicates` key. True ⇒ the cached-or-chat parse (§2.8)
runs ONCE per submit and yields `{ atoms, vectorQuery }` or a silent fall-back (no
predicates, unrefined embed text). When the parse supplied a refined vector-query text,
step 4 embeds THAT text for the whole-query vector (segments keep the original query
words); the response carries the canonical atom array as `predicates`.

4. **Query embed :** `llmAdapter.embedQuery(text)` — a request-path AI call (one of the
   two exception-family roles, with `parse.nl`). `text` is the refined vector-query text
   when step 3a supplied one (normalized, its own cache key — the same cached path),
   otherwise the normalized query. The `query_parses` cache is OWNED BY THIS LEG (the adapter call is the
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
   - `predicates` holds the NL-parse state (§2.8) — the embed leg never reads or writes
     it (fresh inserts bind the `[]` default; overwrites leave the stored value untouched).
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

- `semantic: []` retained (the key's presence is the availability signal) but
  `counts.semantic:0` — never a 5xx (a mid-switch config failure degrades honestly,
  never surfaces as error).
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
  serialize `""` and are reserved-additive for future conversational deltas); `vector-query` =
  the embedded query text (normalized) or `""` when the semantic leg did not run — when the
  parse leg (§2.3 step 3a, §2.8) supplied a refined vector-query text, THAT is the embedded
  text and therefore the signature material (cache-served parses make the refinement
  replay-stable); `space` =
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

| Addition                                                       | Owner spec                                                               | Purpose                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `FileNodeRepository.searchNodesByName(userId, query, {limit})` | FileNodeRepository twins (+conformance)                                  | ACL-scoped `lower LIKE` name section                                                   |
| `FileNodeRepository.sampleVisibleNodeIds(userId, n)`           | same                                                                     | baseline corpus sample                                                                 |
| `FileNodeRepository.listVisibleFileNodeIds(userId)`            | same                                                                     | ACL anchoring set (scorer scores inside it)                                            |
| `vectorStore.neighbors(vec, k, candidates)`                    | [vectorStore](../infrastructure/vectorStore.md) §2.3                     | max-over-chunks per-segment scoring                                                    |
| `query_parses` repository                                      | [queryParsesStore](../store/queryParsesStore.md) §2.2                    | signature-keyed embed/parse cache                                                      |
| shared grammar import (`ATOM_TYPES`, `parseDefinition`)        | [collectionsService](collectionsService.md) §2.3 (`definitionEngine.js`) | closed-grammar validation of `parse.nl` output — the grammar is IMPORTED, never forked |

### 2.5a The semantic scoring seam (steps 5–6 behind one boundary)

The scoring leg is ONE injectable factory option. The production default binds
`TextVectorJs` (the JsFallback engine, `vectorStore` §2.3) through the scorer's
`engineFactory` seam; the engineFactory seam is the production swap point for
the boot-frozen engine factory (`vectorStore` §2.3) — ANN adapters ride the
SAME `neighbors(vec, k, candidates)` contract when that factory lands.

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
- **Scoring rule (binding):** for EVERY segment vector, the scorer requests
  `vectorStore.neighbors(segVec, 50, candidates)` over the requester's visible
  set (a node the requester cannot read never enters the candidate list — ACL
  anchoring rides the `candidates` seam, never post-filtering). Per node, the
  engine returns the **max-over-chunks** cosine (chunk rows rank the node; a
  chunkless node falls back to its pooled row, the §2.2 seam contract). The
  document score is the **MIN across segments** (segment-AND: a document must
  score ≥δ in EVERY segment — a one-segment match never lands).
- **Dynamic baseline gate:** the SAME segment vectors are scored against the
  `sampleFn(BASELINE_SAMPLE_DOCS)` sample — the cap is resolved per `score()`
  call through the scorer's `configResolver` seam (default 500, hot for the
  next search) — drawn EXCLUDING the
  candidate set (a sample containing a candidate would contaminate the
  baseline). `spread` = the sample's max min-across-segments score. Keep results
  only if the top candidate score ≥ `spread + δ_base` (the model profile's
  `deltaBase` — read at gate time, never hardcoded); otherwise the section is
  returned HONESTLY EMPTY (an honestly empty section beats a wrong one on
  nonsense queries). The scorer owns the gate: an ungated result is a spec
  violation.
- The service consumes the returned rows unchanged through steps 7–8 (order,
  dedup, cap, usage logging) — it never rescores.

The PRODUCTION scorer is the default when no seam is injected — the service
constructs it with its own stores and `configResolver`. An explicitly injected
non-function disables scoring: the semantic section is then returned HONESTLY
EMPTY (`semantic: []`, `counts.semantic:0`) whenever the §2.3 step-3 gate passed.
Scores are never fabricated anywhere on this path.

### 2.6 Save-to-collection boundary

The `semantic` key being ABSENT OR the array being empty ⇒ the `Save as collection`
button is HIDDEN (the client derives availability from the key's presence). Saved
collections capture the SEMANTIC portion only —
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

`semantic_unavailable_reason` is NOT a thrown error code — it is a readiness token on a
200 (a section is absent, not the feature; routes §2.4.1). `fail` is reserved for
engine-internal errors (SQL throw, vectorStore invariant break) — provider failure is a
DEGRADATION, not a `fail`.

### 2.8 The NL-parse leg (`parse.nl` — chat → shared predicate grammar)

The second request-path exception-family role. One chat call MAX per search submit, run
alongside the query-embed moment (step 3a). Contract:

- **Gate:** `roleConfigured('chat')` ∧ `AI_NL_PARSE_ENABLED` (kill switch — §3). Either
  false ⇒ ZERO provider calls (embed-only or chat-less configs never reach `chat`), and
  the response is the parser-free shape.
- **Cache first:** the `query_parses.predicates` column (the row keyed by the normalized
  query text — [queryParsesStore](../store/queryParsesStore.md) §2.3) is the parsed-predicate
  cache. A cache HIT (valid parse envelope, below) ⇒ ZERO chat calls; the cached atoms and
  cached refined vector-query text are reused as-is. `recordEmbedding` overwrites only
  `vector`, so a model-space re-embed keeps the parse; `recordPredicates` writes only
  `predicates`, so a parse write keeps the vector and `hit_count`.
- **Parse envelope (cache value):** `{ grammar: "nl1", atoms: [ …canonical grammar
atoms… ], vectorQuery: string | null }` — stored in `predicates`; `[]`/absent/malformed ⇒
  a parse MISS. Canonical atoms are the shared-grammar normalized form (below) — the cache
  write stores what validation returned, never the raw model output. The envelope is not
  embed-space-validated: parse output is symbols, not vectors; an embed model change does
  not invalidate a predicate set.
- **Shared grammar (binding):** atom types and validation are the collections definition
  engine — `ATOM_TYPES = ['path','tag','like','date','size']` and `parseDefinition` from
  `server/domains/collections/definitionEngine.js` (collectionsService.md §2.3) imported,
  NEVER forked or re-declared. Validation = `parseDefinition({ kind: 'predicate',
all_of: atoms })` (the engine's normalized output is the canonical atom list; a throw is
  an unconstrained parse). Closed v1 form: a single AND list (`all_of`), no `any_of`, no
  negation, no vector content; cardinality is fixed in the grammar — at most ONE `path`,
  THREE `tag`, ONE `like`, ONE `date`, ONE `size` atom (overflow ⇒ unconstrained ⇒ fallback).
- **Prompt (closed grammar):** the chat call carries the enumerated field list + per-field
  params/operators + the cardinality table, the utterance, and (optionally) the request-side
  session predicate state — field/value symbols ONLY. NEVER tag-vocabulary injection (tag
  atoms bind derived local facets, resolved server-side by string equality), NEVER result-set
  content, node ids, or permission data (symbols resolve server-side — hallucinated values
  match nothing, safe-by-construction). Schema-forced JSON
  (`chat(messages, { schema, maxTokens })`; reasoning OFF — llmAdapter.md §2.7):
  `{ predicates: [atom…], vector_query: string|null }` — both required, closed object.
- **Output validation:** the returned JSON is grammar-validated (above) BEFORE anything is
  stored or returned. `vector_query` is normalized (step-1 normalizer) and capped at the
  query length limit (200) — an over-long or absent refinement keeps the original text
  (atoms still apply). ANY failure — provider error (budget/breaker/transport/config classes),
  non-JSON, schema violation, grammar violation, cache write failure — ⇒ SILENT FALLBACK: no
  `predicates` key, the whole-query embed uses the original normalized text, the response is
  byte-identical to the parser-free shape, never an error to the user, never a 5xx. A failed
  cache WRITE is dropped like in the embed leg (the cache is an optimization, never a
  correctness dependency).
- **Session-state rule:** when the request carries predicate state (§2.2), the parse runs
  LIVE with that context and the result is NOT cached (neither read nor written — the row is
  keyed by query text alone, so a state-dependent parse must not overwrite the stateless
  cache entry).
  A stateless request reads/writes the cache normally.
- **Additive response field:** `predicates` (the canonical atom array, possibly empty) is
  present ONLY when the parse applied. Wire atoms keep the shared-grammar canonical field
  names (`type`, `value`, `prefix`, `withinDays`, `after`, `before`, `min`, `max`).
- **Contract evolution:** the output may grow §4.22 delta semantics (`add|replace|exclude/
$ref`) later as ADDITIVE envelope/fields only — no meaning redefinition of the v1
  single-shot contract above; `grammar` keys the parse-envelope shape for forward
  discrimination.

## 3. Configuration (T2 / dbOnly)

| Key                          | Default | Use                                                                                                               |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `AI_SEMANTIC_SEARCH_ENABLED` | `true`  | query-embed kill switch (mandatory part of the request-path LLM exception: cache + kill-switch + no-LLM fallback) |
| `AI_NL_PARSE_ENABLED`        | `true`  | `parse.nl` kill switch (same exception family — §2.8)                                                             |
| `SEARCH_NAME_LIMIT`          | `200`   | name-section hard cap                                                                                             |
| `SEARCH_SEMANTIC_LIMIT`      | `50`    | semantic-section cap                                                                                              |
| `BASELINE_SAMPLE_DOCS`       | `500`   | dynamic-baseline sample size (read per `score()` call — hot)                                                      |
| segment cap                  | `3`     | scoring bound (limit, not input validation)                                                                       |

`δ_base` and per-segment k are per-model profile values — release-measured
(release artifacts, no runtime calibration), never runtime-calibrated.

## 4. Dependencies

- `llmAdapter` (`embedQuery`, `chat`, presence/kill-switch state), `vectorStore` seam,
  `fileNodesStore`/FileNodeRepository (ACL joins, name SQL, sampling),
  `query_parses` repository, usage-event writer (usage domain, `docs/features/collections-platform.md` §3.4), `configResolver`
- Chat use on this path is `parse.nl` ONLY (§2.8) — the other chat roles never reach a
  request thread. No session table, no multi-turn route: the parse rides this SAME
  two-section response shape (additive `predicates` header field), no contract break.

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
      honestly EMPTY `semantic` section (key present, `[]`); a real query returns rows
      above `spread + δ_base`
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
      (`[]`), `semantic_capped_segments` present — the absent-vs-honestly-empty
      distinction is observable on the wire
- [ ] Cache-row envelope from a different space (model change) ⇒ MISS: re-embed,
      `vector` overwritten, provider called again
- [ ] Provider failure with the role configured ⇒ `semantic` present-but-empty, name
      section + `counts.total` unchanged, NO 5xx
- [ ] `usage_events` `search_hit` rows: exactly one per returned node, none for
      deduplicated-away or truncated rows
- [ ] Response fields snake_case; scores 0–1 rounded 2-dec; empty query 400, >200 chars 400
- [ ] Chat unconfigured (embed-only or none) ⇒ ZERO `chat` calls and a response
      byte-identical to the parser-free shape (no `predicates` key)
- [ ] `AI_NL_PARSE_ENABLED:false` with chat configured ⇒ identical zero-call degrade
- [ ] Fake-chat parse of "pdfs from last year over 10mb" ⇒ response `predicates` carries
      canonical grammar atoms, one chat call, and the parse envelope lands in
      `query_parses.predicates`
- [ ] Same query twice ⇒ SECOND submit: chat call count unchanged, embed provider call
      count unchanged, cached atoms served (cache hit ⇒ zero chat calls)
- [ ] Unparseable or grammar-violating chat output (non-JSON / unknown atom type /
      cardinality overflow) ⇒ SILENT fallback: response byte-identical to the
      chat-unconfigured shape, no `predicates` key, semantic leg still served with the
      original text, never an error
- [ ] Chat provider failure (budget/breaker/transport class) ⇒ identical silent fallback
- [ ] Grammar-constrained output validates through the SHARED definition engine — a cached
      envelope re-validated on read; a tampered envelope is a MISS and re-parses
- [ ] Valid parse with refined `vector_query` ⇒ the whole-query embed runs on the refined
      normalized text (its own cache row), segments keep the original query words, and the
      `result_ref` `vector-query` slot is the refined text; the name section is unchanged
- [ ] Request-side `predicates` state: grammar-valid atoms reach the prompt (symbols only);
      malformed state is discarded (never a 4xx); a state-carrying submit neither reads nor
      writes the parse cache
- [ ] Parse write keeps the row's `vector`/`hit_count`; a space-change re-embed keeps the
      stored parse envelope

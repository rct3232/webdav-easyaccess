# search routes Spec

Target-contract spec.

## 1. Overview

| Item       | Description                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/search`                                                                                                                   |
| Role       | Server-wide hybrid search: name-containment section + semantic vector section + `result_ref` + additive NL-parsed `predicates`. |

**Layer boundary:** this endpoint is the Search Engine layer only
(`searchService` + `vectorStore` + `fileNodesStore` ACL joins + the `parse.nl` leg,
searchService.md §2.8). The conversational layer is a reserved boundary — this endpoint
emits/accepts the opaque `result_ref`, accepts request-side predicate STATE as parse context
(field/value atoms only), and returns the parsed predicate set; it stores no session and
resolves no references.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/ai/routes.js`
- **Service:** `server/domains/ai/searchService.js` (section assembly, dedup, baseline)
- **Test file:** `server/domains/ai/__tests__/search.test.js`

**Mount:** `server/index.js` registers the router **after** the app-level migrationGate
and with `setupModeGuardInstance` (coverage invariant, ARCHITECTURE §1.3):
`app.use('/api/search', setupModeGuardInstance, require('./domains/ai/routes'))`.

### 2.2 Route List (sync with api.md)

| Method | Path     | Auth  | Description                                                                                                                                |
| ------ | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/`      | Token | Hybrid query: `{ query, result_ref?, predicates? }` → sections (+ additive parsed `predicates`).                                           |
| POST   | `/click` | Token | Usage-signal list-entry-click recording point for search results: `{ node_id }` → one `usage_events` row `action='open'`, fire-and-forget. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser` (per-router)
- `setupModeGuardInstance` at mount (see §2.1)

### 2.4 Request/Response Spec

- **POST /:** Body `{ query, result_ref?, predicates? }`. `query`: trimmed, 1–200 chars (400
  `search.queryRequired` / `search.queryTooLong`). `result_ref` is optional and **ignored by
  the server** (conversational reservation: accepted shape, interpretation is
  the future layer's job); sending it never changes the response. `predicates` is optional
  session predicate state (searchService.md §2.2/§2.8): an array of shared-grammar atoms
  (path/tag/like/date/size, field/value only) used as `parse.nl` context; a non-array or any
  grammar-invalid entry is discarded silently (never a 4xx) and the parse runs stateless.
  Side effect: logs one `usage_events` row `action='search_hit'` per returned node
  (search is a low-frequency usage-logging endpoint).

  **Section 1 — `name_matches` (LLM-free, ships in P0):**
  plain containment over ALL user-visible `file_nodes`, ACL-scoped with the same
  closure/owner logic as `fileService` listing:
  `lower(name) LIKE lower('%'||:query||'%')` — the `lower()` on both sides is mandatory
  (sqlite LIKE is ASCII-case-folded only). **The whole query string must be contained**:
  token-AND is explicitly NOT used; multi-word queries
  legitimately return few/zero rows. Highlight ranges are computed client-side; the server
  never returns markup offsets. Order = `name` asc, then `node_id` asc; hard cap
  200 rows (`counts.name_truncated: true` when the cap cut the set).

  **Section 2 — `semantic` (P1, requires the `embed` role):**

- Scoring = **segment-AND**: query split on whitespace (≤3 segments; more → the first
  3 are used and `counts.semantic_capped_segments: true`), per-segment cosine via
  max-over-chunks (`embeddings_chunk`), document score = **MIN across
  segments**.
- Gated by a **per-query dynamic baseline**: the same query is scored against a random
  ~500-doc sample of the requester's visible corpus; if the top results are not
  meaningfully above the sample's spread, the section is returned **honestly empty**.
  No absolute stored floors anywhere.
- Entries already present in section 1 are **de-duplicated out of section 2** display.
- Order = score desc, then `node_id` asc. Cap 50 rows.

**Hybrid assembly order:** `name_matches` first, `semantic` second, exactly as
received by the client ("No results in section 1 → show only section 2, and vice
versa" is a pure display rule on the returned arrays).

**`result_ref`:** opaque string = the replay **signature** of this execution —
`hash(normalized predicates ∥ vector query ∥ space ∥ sort)` (the name-only
fallback signature covers the query string + ACL-space + sort; when the parse leg supplied a
refined vector-query text, the `vector query` slot is the refined text — searchService.md
§2.4). Always emitted, always
replayed (never a materialized id list). The client treats
it as a black box.

**NL-parsed `predicates` (additive, structured-predicate header element):** the parsed
shared-grammar atom array from the `parse.nl` leg (searchService.md §2.8). The key is
present EXACTLY when the parse applied (chat configured ∧ kill switch on ∧ schema- AND
grammar-valid output) — possibly as an empty array (valid parse, no atoms). The chat role
unconfigured, the kill switch off, or ANY parse failure ⇒ the key is ABSENT and the
response is byte-identical to the parser-free shapes below. Wire atoms keep the canonical
grammar field names (`type`, `value`, path's normalized `prefix`, `withinDays`, `after`,
`before`, `min`, `max`) — field/value symbols only, NEVER vectors or node ids. The name and
semantic sections are computed independently of the parse (the name section is LLM-free by
contract).

200 response (embed configured, both sections non-empty):

```json
{
  "name_matches": [{ "node_id": 90210, "name": "fun-movie-notes.pdf" }],
  "semantic": [{ "node_id": 90212, "name": "fantasy-movie-night.jpg", "score": 0.71 }],
  "result_ref": "sr1.9f3c2a7e41b0d8c5",
  "counts": {
    "name": 1,
    "semantic": 1,
    "total": 2,
    "name_truncated": false,
    "semantic_capped_segments": false
  }
}
```

200 response with the `parse.nl` leg applied (chat configured — the shape above plus the
additive `predicates` key; the example query parsed to a size + date atom):

```json
{
  "name_matches": [],
  "semantic": [{ "node_id": 90212, "name": "holiday-beach-video.mp4", "score": 0.74 }],
  "result_ref": "sr1.12ab34cd56ef7890",
  "counts": {
    "name": 0,
    "semantic": 1,
    "total": 1,
    "name_truncated": false,
    "semantic_capped_segments": false
  },
  "predicates": [
    { "type": "size", "min": 10485760 },
    { "type": "date", "withinDays": 365 }
  ]
}
```

200 response when the embed leg ran but scored NOTHING (provider failure degrade,
baseline-gated empty, or the scoring seam not wired): the `semantic` key is PRESENT
with an EMPTY array — the key's PRESENCE distinguishes honest emptiness from the
gate-off omission:

```json
{
  "name_matches": [],
  "semantic": [],
  "result_ref": "sr1.44de0c9a3f7b1028",
  "counts": {
    "name": 0,
    "semantic": 0,
    "total": 0,
    "name_truncated": false,
    "semantic_capped_segments": false
  }
}
```

The `semantic` key and the `semantic_capped_segments` flag are present exactly when
the embed leg ran; the §2.4.1 gate-off degrade (below) omits both.

200 response when the `embed` role is absent (name section still works): the
`semantic` key is **omitted**, and the degradation is reported as data, not as an
HTTP error:

```json
{
  "name_matches": [{ "node_id": 90210, "name": "fun-movie-notes.pdf" }],
  "result_ref": "sr1.44de0c9a3f7b1028",
  "counts": { "name": 1, "semantic": 0, "total": 1, "name_truncated": false },
  "semantic_unavailable_reason": "preparing"
}
```

Field rules: `score` is a float 0–1 rounded to 2 decimals; `counts.total` =
post-dedup displayed rows; the `semantic` key's presence is the availability signal and
a non-empty `semantic` array is the client's gate for the `Save as collection` button
(absent or empty ⇒ button hidden — a saved collection means the semantic part only;
name-match results are ALWAYS excluded from collection definitions); `predicates` follows
the presence rule above (absent when the parse did not apply — the chat-off degrade is
the parser-free shape, byte for byte).

### 2.4.0 `POST /click` — usage-signal list-entry-click recording point

- Body `{ node_id }` (positive integer). Auth: `authenticateToken, requireUser`
  (per-router, same as POST `/`). The recording path is
  `usageService.recordEvent({ userId, nodeId, action: 'open' })` (the usage-signal
  `list-entry-click` family records the `open` kind — the only usage action
  kind without a dedicated endpoint of its own), fire-and-forget: the route responds
  `204` without waiting for the insert; a recording failure never surfaces
  (usageService contract — errors are never thrown from the signal path).
- Missing/whitespace-free invalid `node_id` (non-integer, ≤ 0) → 400
  `serverErrors.search.clickTargetRequired`, nothing recorded.
- Dedicated endpoint for the search-result `open` signal: search-result opens are pure client
  navigation and no existing endpoint serves the recording.

### 2.4.1 Error Codes (SERVER_ERROR_CODES style)

| HTTP | errorCode                                 | Trigger                                             |
| ---- | ----------------------------------------- | --------------------------------------------------- |
| 400  | `serverErrors.search.queryRequired`       | Missing/empty/whitespace `query`.                   |
| 400  | `serverErrors.search.queryTooLong`        | `query` longer than 200 chars.                      |
| 400  | `serverErrors.search.clickTargetRequired` | `POST /click` without a positive-integer `node_id`. |
| 500  | `serverErrors.search.fail`                | Unexpected engine failure (envelope param).         |

`semantic_unavailable_reason` is a readiness token, not an i18n error key:
`not_configured`, `preparing`, `provisioning_failed`, `probe_failed`, `non_conforming`, or
`disabled` (200) — the query itself succeeded, so no 4xx is raised. A section is absent,
not the feature.

### 2.4.2 Contract clarifications

- The request fields keep the wire names `result_ref` and the §2.4.0 click body `node_id`
  (snake_case, request and response) — the search-domain request-body exceptions to the
  CODING_STYLE.md Express Patterns camelCase rule. The request/response `predicates` fields
  carry shared-grammar ATOM objects — the atoms' inner keys (`type`, `value`, `prefix`,
  `withinDays`, `after`, `before`, `min`, `max`) are the definition-engine grammar's canonical
  field names (the same shape the collections definition contract uses), not per-endpoint
  field names.
- Segment cap 3 with an explicit `semantic_capped_segments` flag; the "≤3 segments" limit is a
  scoring bound, not input validation.
- Read-only search is served by `POST` (not GET) — keeps query strings out of access logs.
- Search never returns `type`/`size` — the client fetches metadata via the existing
  `POST /api/files/metadata` for rendering; that endpoint's rows additionally carry the
  per-row `hasReadPermission`/`hasWritePermission` flags consumed by the results surface
  (`routes/files.md` §2.2).

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [collections.md](collections.md) (`Save as collection` consumes the semantic section only),
  `docs/features/collections-platform.md` §4.6/§4.12/§4.13/§4.20/§4.22, CODING_STYLE.md Express Patterns.

### 2.6 Integration Test Scenarios

- [ ] Name section: query contained in the middle of a name with different ASCII case
      matches (`lower()` both sides); a 2-word query with no single-name containment
      returns an empty name section (not token-AND)
- [ ] ACL scoping: a node the requester cannot read never appears in either section
- [ ] Dedup: a node matching both name and vector shows ONLY under `name_matches`;
      `counts.total` reflects the de-duplicated display set
- [ ] `result_ref` is present on every 200 and is stable for an identical
      query+corpus+sort replay (signature equality), opaque to the client
- [ ] Request `result_ref` is accepted and ignored (same response shape, fresh signature)
- [ ] Chat absent (fake adapter with no configured chat role) ⇒ the 200 body is
      byte-identical to the parser-free shapes (no `predicates` key) and ZERO chat calls
      reach the adapter
- [ ] Fake-chat configured parse ⇒ 200 carries `predicates` with canonical grammar atoms;
      the same query re-submitted serves from the `query_parses` parse cache (chat call
      count stays 1)
- [ ] Fake-chat returning non-grammar JSON ⇒ 200 without `predicates`, byte-identical to
      the chat-absent response for the same corpus (silent fallback, never an error)
- [ ] Request `predicates` array: grammar-valid atoms accepted; malformed array silently
      stateless (never a 4xx)
- [ ] embed role absent → 200, `semantic` key omitted,
      `semantic_unavailable_reason` one of the readiness tokens, name section intact
- [ ] embed configured, zero scored rows → 200, `semantic: []` PRESENT — the honest-empty
      shape is never conflated with the omit shape, and `semantic_capped_segments` is
      present in both leg-ran responses
- [ ] Dynamic baseline: nonsense/low-similarity query returns an honestly EMPTY semantic
      section (not a majority-class dump)
- [ ] Segment-AND: a composite query scores MIN across ≤3 segments; a 4-word query sets
      `semantic_capped_segments`
- [ ] Empty/whitespace query → 400 `search.queryRequired`; >200 chars → 400
      `search.queryTooLong`
- [ ] All response fields snake_case; usage events `search_hit` recorded for returned
      nodes
- [ ] Setup-mode: mount returns the guard response while setup incomplete
- [ ] `POST /click` with a valid `node_id` → 204 and exactly one `usage_events` row
      `action='open'` for (requester, node); missing/non-positive `node_id` → 400
      `search.clickTargetRequired`, nothing recorded; unauthenticated → 401

# derivedTagsService Spec

Target-contract spec (LLM-free hygiene items — the module runs with zero LLM configured).
Design owner sections: §2.3 (v1 tag set), §2.2 (fold step 1),
`docs/spec/server/store/aiTagStore.md` §2.4.5 (storage surface).

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Local derived tags — the LLM-free tag source. Pure computation of the v1 set (`mime`, `ext`, `month`, `path`) from node metadata + persistence of the folded result into `ai_tag_raw` through `aiTagStore`. EXIF is not a tag source (rejected for v1). |
| Boundaries | No LLM, no vectors, no CacheAdapter. Computes and persists ONLY; consumption (tag predicates, templateNamer, rule suggestions) rides `ai_tag_raw`.                                                                                                      |
| State      | DB-backed via `aiTagStore.replaceRawTags` (one TX per node; store normalizes nothing — the fold happens here before the write).                                                                                                                         |
| Scope      | Computation + per-node persist seam + idempotent user-scoped backfill. COMMIT-POINT WIRING (upload/copy/restore) is P1 — the files domain is not touched by this module's callers yet.                                                                  |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/domains/ai/derivedTags.js` (+ pure fold helper `server/domains/ai/tagVocabulary.js`)
- **Test files:** `server/domains/ai/__tests__/derivedTags.test.js` (unit + real-DB pipeline)

### 2.2 The fold (tagVocabulary.js)

`foldTag(value)` is the read-time orthographic normalization — a PURE function, zero
tables: NFKC → trim → collapse internal whitespace runs to a single space → lowercase
(asymmetric case folding). It never produces the empty string: non-string/empty input ⇒
`null` (callers drop). Idempotent: `foldTag(foldTag(x)) === foldTag(x)`.

### 2.3 v1 tag set (kind-prefixed values)

`computeDerivedTags({ name, createdAt, mimeType, pathSegments })` ⇒ **folded, deduped,
sorted** string array. v1 encoding: tags are KIND-PREFIXED so derived tags never collide
LLM tags are NEVER materialized into `ai_tag_raw` (§4.18: derived facets only), and predicates are
self-describing:

| Kind    | Value shape       | Source & rule                                                                                                                                                                                                            |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mime`  | `mime:<type>`     | `filecache.mime_type` primary type before `/` (e.g. `image/jpeg` ⇒ `mime:image`); absent mime ⇒ no tag.                                                                                                                  |
| `ext`   | `ext:<extension>` | trailing dot-extension of `name`, lowercased, alphanumeric-run only, no dot in value (`Photo.JPG` ⇒ `ext:jpg`); no dot ⇒ no tag.                                                                                         |
| `month` | `month:<YYYY-MM>` | calendar month of `file_nodes.created_at` in **UTC** (timestamps persist UTC).                                                                                                                                           |
| `path`  | `path:<segment>`  | up to TWO segments — the first ancestor directories BELOW the user's root (`/alice/Photos/2026/...` ⇒ `path:photos`, `path:2026`); root and username segment excluded, file name excluded, missing folders ⇒ fewer tags. |

Determinism: same input ⇒ same sorted output; path segment order = top-down (the two
highest non-root segments); the sort is lexicographic over the folded values.

### 2.4 Main functions

| Function                                                                   | Returns                  | Contract                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `foldTag(value)`                                                           | `string \| null`         | §2.2 pure fold (re-exported here for consumers; implemented in tagVocabulary.js).                                                                                                                                                                        |
| `computeDerivedTags({ name, createdAt, mimeType, pathSegments })`          | `string[]`               | Pure. §2.3 table; folded/deduped/sorted; never throws on odd metadata (garbage in ⇒ fewer tags).                                                                                                                                                         |
| `syncNodeDerivedTags({ nodeId, name, createdAt, mimeType, pathSegments })` | `{ inserted }`           | Compute → `aiTagStore.replaceRawTags(nodeId, tags)` — the per-node seam for the upload/copy/restore commit points (P1 wiring).                                                                                                                           |
| `backfillDerivedTagsForUser(userId)`                                       | `{ nodes, tagsWritten }` | Idempotent keyset-free full pass over the requester's OWN live subtree (`fileNodesStore.getUserRootNode` + `listSubtreeCacheRows`); ancestor chains resolved from the loaded rows; each node's derived set REPLACED. Returns counts. Re-run ⇒ same rows. |

- Ownership of the whole `ai_tag_raw` row set per node: v1 the ONLY writer is this module
  (aiTagStore §2.4.5 note).
- Directory nodes get NO derived tags (v1 set describes files); backfill skips them.
- Month/path use `file_nodes.created_at` / node ancestry — never object storage state.

### 2.5 Errors & transactions

- Store surfaces only (`aiTagStore` §2.5 error contract); this module adds no error codes.
- Per-node write = ONE TX inside the store; backfill = sequential per-node TXs (no
  global lock — idempotent, cheap, re-runnable).

### 2.6 Dependencies

- `aiTagStore` (`replaceRawTags`), `fileNodesStore` (`getUserRootNode`, `listSubtreeCacheRows`)
- Consumers (later phases): `templateNamer` top-2 names, tag predicates via
  `aiTagStore.listNodeIdsByRawTag` (collectionsService §2.3), rule-based cleanup suggestions.

### 2.7 Verification Scenarios

- [ ] `computeDerivedTags` deterministic cases: `IMG_0421.JPG` + `image/jpeg` + 2026-09-03T23:30Z + `[Photos,2026,paris]` ⇒ `['ext:jpg','mime:image','month:2026-09','path:2026','path:photos']` (sorted, folded)
- [ ] Absent mime / no-dot name / rootless path ⇒ the respective tags simply missing, never empty-string tags
- [ ] Fold: NFKC + whitespace collapse + lowercase, idempotent, `null` on empty/non-string
- [ ] `syncNodeDerivedTags` twice → identical `ai_tag_raw` rows (idempotent), stale derived tag replaced when input changes (rename `.jpg`→`.png` ⇒ `ext:png` present, `ext:jpg` gone)
- [ ] `backfillDerivedTagsForUser`: writes the own-subtree files only, skips trashed/directories/other users' subtrees; second run is a no-op at row level
- [ ] Purging a node cascades its raw rows away (FK, covered in aiTagStore conformance)

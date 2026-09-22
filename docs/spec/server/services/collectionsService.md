# collectionsService Spec

Target-contract spec.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Business logic behind `/api/collections` ([routes spec](../routes/collections.md)): CRUD + lifecycle, the member view (`stored ∪ derived − exclusions`), definition evaluation, preview/seed-confirm, merge execution, sorts, digests, for-nodes chips.                                                                                                                                                  |
| Boundaries | Never mutates file nodes (invariant 1) — the service exposes no rename/move/delete-of-file function. Grants/roles/publish/leave are owned by [collectionShareService](collectionShareService.md) and consumed here via `getRole`/publish-gate helpers. Undo flows live in the journal; mutation results carry `undo: { actionId }` pointers only (§4.11).                                                |
| Journal    | Every user-visible mutation reaches the DB through `collectionsStore` journaled mutators (`createCollection`, `renameCollection`, `setPinned`, `archiveCollection`, `restoreCollection`, `addItem`, `removeItem`, `addExclusion`, `removeExclusion`, `setItemPublished`) — i.e. `actionJournalStore.commitChange(mutation, inverse)` is the only write path. Permanent delete has NO inverse (see §2.5). |
| State      | DB-backed only — zero CacheAdapter/operationProgress imports (invariant 8, CODING_STYLE.md Express Patterns grep-gate).                                                                                                                                                                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/collections/service.js`
- **Helpers:** `server/domains/collections/definitionEngine.js` (pure evaluation core,
  DEF-25 — see §2.3), `server/domains/collections/templateNamer.js` (§2.9)
- **Test file:** `server/domains/collections/__tests__/collectionsService.test.js`
  (unit) + domain route suite `__tests__/collections.test.js` (integration)

### 2.2 Public Function Contracts

All functions take `userId` (requester) first, throw bare string codes (§2.10), and
return domain objects the route serializes snake_case. `ctx = { actor: userId }` is
passed to every journaled store mutator.

| Function                                                                 | Returns                                                         | Contract (condensed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listCollections(userId, { sort, include })`                             | `{ collections[] }`                                             | `sort ∈ activity\|name\|created\|updated\|similar` (default `activity`); `include ⊆ mine,shared,archived`. Shared rows: `definition` omitted, `granted_role` set. Hidden (left) collections filtered via `shareService`.                                                                                                                                                                                                                                                                                                    |
| `createCollection(userId, { name })`                                     | `{ collection, undo }`                                          | `origin='user'`, `status='active'`, `publish_mode='ask'`. Name validation + suffix-collision retry (§2.4).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `createSeedCollection(userId, { name, seedNodeId })`                     | `{ collection, undo }`                                          | `origin='seed'`, `definition={kind:'seed_vector', seed_ref, theta}`; INITIAL BATCH `published=true` (§2.7). Requires embed role: else throw `aiNotConfigured`.                                                                                                                                                                                                                                                                                                                                                              |
| `createSearchCollection(userId, { name, semantic })`                     | `{ collection, undo }`                                          | `origin='search'`; definition = flattened semantic SNAPSHOT (§2.7); name-match results NEVER included; initial batch `published=true` (§4.7 Q2).                                                                                                                                                                                                                                                                                                                                                                            |
| `updateCollection(userId, id, { name?, pinned?, publishMode? })`         | `{ collection, undo }`                                          | Owner-only. `name` write → `lockName=true`. `pinned:true` → `pinned_by='user'` (overwrites `'auto'`); `pinned:false` → NULL + unpin. `publishMode` write is the explicit sharing-mode act (§4.7).                                                                                                                                                                                                                                                                                                                           |
| `archiveCollection(userId, id)` / `restoreCollection(userId, id)`        | `{ collection, undo }`                                          | Manual lifecycle, 1 confirm client-side (invariant 5). Active↔archived guards: `alreadyArchived` / `notArchived`. Restore re-suffixes on name collision. Both are user touches → auto-pin eligible system rows via store.                                                                                                                                                                                                                                                                                                   |
| `deleteCollectionPermanent(userId, id)`                                  | `undefined` (route 204)                                         | Archived only (§2.5). NO undo pointer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `getItems(userId, id, { cursor?, limit?, since? })`                      | `{ items[], next_cursor, publish_pending_count?, digest? }`     | Member view engine (§2.3–§2.4); paged (limit default 50, max 200); order = activity score desc, then `node_id` asc; reading stamps the digest cursor (§2.8).                                                                                                                                                                                                                                                                                                                                                                |
| `addItems(userId, id, nodeIds)`                                          | `{ added[], already_members[], rejected_not_readable[], undo }` | Owner or editor. 1–200 ids else `emptyNodeIds`. "Only add what you can read" (§2.4). `published` default per publish-mode rules (§2.7). One command journal row with item-level inverses.                                                                                                                                                                                                                                                                                                                                   |
| `removeItems(userId, id, nodeIds)`                                       | `{ removed[], excluded[], ignored[], undo }`                    | Owner, or editor for what they added (else `forbidden`). Stored row → delete; derived member on non-`user` origin → `collection_exclusions` insert; on `user` origin → `ignored` (exclusion meaningless). Membership only — the node is never trashed (§3.2).                                                                                                                                                                                                                                                               |
| `preview(userId, { seedNodeId? , definition? })`                         | `{ count, sample[], sample_truncated }`                         | Exactly one target else `previewTargetRequired` (§2.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `previewCollection(userId, id)`                                          | same as `preview`                                               | Owner-only dry-run of the stored definition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `publishItems(userId, id, nodeIds, published)`                           | `{ published[], undo }`                                         | Owner-only (publish is an exposure decision; viewers/editors may not). Delegates to `shareService.publish` (§4.7). Stored rows flip `setItemPublished`; PUBLISHING A DERIVED MEMBER MATERIALIZES a stored row `published=true` (`addItem` idempotent — the view dedups `stored ∪ derived` by node, so membership truth stays derived), unpublish flips it back to `false` (never deletes an owner-added row). Route surface `PUT /:id/items/publish` (routes spec gains the line at the same PR as implementation, DEF-25). |
| `listMergeSuggestions(userId)`                                           | `{ suggestions[] }`                                             | Pending rows owned by requester, `score` desc; rows carry additive `recommendation: { verdict, reason } \| null` from the merge-arbiter prefill (§2.9).                                                                                                                                                                                                                                                                                                                                                                     |
| `mergeCollections(userId, id, otherId)`                                  | `{ survivor, absorbed_id, undo }`                               | §2.9. `id === otherId` → `mergeSameCollection`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `dismissMerge(userId, id, otherId)` / `rejectMerge(userId, id, otherId)` | `{ suggestion_id, state, *_at }`                                | `setSuggestionState('dismissed'\|'rejected')`; no pending row → `suggestionNotFound`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `getForNodes(userId, nodeIds)`                                           | `{ memberships: [{ nodeId, collectionIds[] }] }`                | §2.6. 1–200 ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `fingerprintDefinition(definition)`                                      | hex string                                                      | Pure. Normalized schema + core params (θ, tag-set, path — NOT raw centroid values). Shared with [evolutionService](evolutionService.md) (pass 4 tombstones); permanent delete of a `system` collection passes it to `deleteCollectionPermanent` (invariant 10).                                                                                                                                                                                                                                                             |

### 2.2.1 Route-surface mapping note

`POST /api/collections` dispatches on body shape: `{ name }` only → `createCollection`
(the routes-doc line "Create manual"); `{ name, seedNodeId }` → `createSeedCollection`;
`{ name, semantic }` → `createSearchCollection`. **Decision:** one create endpoint,
additive body fields (wire name `semantic` carries the §4.22 snapshot: centroid ref +
predicate set + member node ids of the semantic section only); [routes/collections.md](../routes/collections.md)
syncs this row in the same PR that lands DEF-25/T3.x.

**As-built scope (T0.3, 2026-09-22):** `createCollection` (manual) and
`createSeedCollection` (embed-gate entry) ship with the routes surface; the
`{ name, semantic }` dispatch and `createSearchCollection`/`publishItems` route rows land
with their DEF-25 sync PRs (T3.x) — the service functions and their rows above remain the
binding target contract until then. `createSeedCollection` at T0.3 implements the embed
presence gate (throw `aiNotConfigured`); vector candidate evaluation attaches when the
vectorStore seam (T1.4) and seed-confirm flow (T1.6) land. Seed preview with the embed
role present but no pooled embedding for the seed node resolves through the §2.7
missing-embedding branch (`count: 0`, `degraded: true`) — the `embeddingsStore` read is
wired at T1.2. The embed-role presence check resolves the `LLM_EMBED_*` config keys
(dbOnly registry group from T0.7b) per call until `infrastructure/adapters/llm`
`roleConfigured('embed')` exists (T1.1 swaps the helper in place).

### 2.3 Definition engine (derived membership)

- Definition kinds: `{kind:'predicate', any_of/all_of: [path_prefix|tag|like|date|size …]}`
  and `{kind:'seed_vector'|'centroid', seed_ref|centroid_ref, theta}` (vector rules may
  AND/OR with predicates). Evaluation is READ-TIME + upload-hook time (DEF-25); no derived
  rows are ever stored (invariant 6).
- Predicate-bool membership: path prefix / date / size → SQL over the requester-visible
  node set (`fileNodesStore` ACL joins, listing parity with `fileService`).
- Tag predicates are VECTOR-matched (§3.2): `cosine(embed(tag_value), embed(query_tag))
≥ θ_tag` through `aiTagStore.getTagVectors` + vectorStore lookups; match values resolve
  through the §4.18 orthographic fold + `tag_parents` hints first. With no embed role
  configured the predicate degrades to normalized string equality (§4.12 None column).
- Vector membership: candidate scoring via `vectorStore.neighbors(vec, k, visibleIds)`
  (per-node max-over-chunks, §4.13). Inclusion is `score ≥ θ` with **hysteresis**
  (θ_in > θ_out, per-model profile values — release-measured) so view-boost drift does not
  flip membership nightly.
- View-weighted soft boost for similarity definitions:
  `score = cosine × (1 + α·log10(1 + views))`, `α = 0.1` (T2), views from the per-user
  `node_activity` rollup. The boost moves only θ±δ borderline members and ordering; it can
  never drop a clear match nor admit a weak one (clamp: admitted/kept sets computed on the
  un-boosted score, ordering on the boosted one).
- `exclusions = listExclusions(id)` is subtracted from the derived set; exclusions never
  affect stored rows. After each evaluation wave the engine calls `touchMemberChange(id)`
  when the admitted set changed (drives digest + activity sort).
- **Decision (as-built T0.3 — candidate-set mechanism):** predicate-bool membership
  evaluates in JS over a candidate set assembled from existing store reads — the
  requester's own-root subtree (`getUserRootNode` + `getDescendants`, readable by
  ownership) plus explicitly granted nodes/subtrees (`permissionStore.getUserFilePermissions`
  / `getUserPermissions` + subtree expansion), mirroring the fileService listing parity.
  Per-node point checks: path (ancestor walk over the loaded candidate rows), date
  (`file_nodes.created_at`), size (`filecache` point read when a size atom is present),
  like (`fileLikesStore.listLikedNodeIds`), tag (no tag source until the T0.9 tag store /
  local tags land — tag atoms match nothing at T0.3, identical observable behavior to the
  normalized-equality fallback over an empty tag set). The ACL-joined SQL variant of this
  scan is the tracked optimization for the T0.9 rule-evaluation PR; no new repository
  surface was added for T0.3.

### 2.4 Member-view enrichment (per read; precedent `recentFiles/service.js` enrichRecentEntry)

Composition: `view = stored ∪ derived − exclusions`, then per-row enrichment under a
JOIN-TIME ACL check of the REQUESTER against `fileNodesStore`:

| Condition                              | Render                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| readable, not trashed                  | `state:'normal'`                                                                                         |
| previously-in-view, no longer readable | `state:'revoked'` placeholder — `name`/`type`/thumbnail NULL (metadata after revocation is a leak, §3.2) |
| trashed by owner (`deleted_at` set)    | hidden, row kept                                                                                         |
| purged                                 | absent (FK cascade removed the rows)                                                                     |

- Foreign-owned members (`node.ownerId ≠ collection.ownerId`): in the OWNER's view they
  render with `shared_excluded: true` (`Not owner's file — not shared` chip); in a SHARED view
  (requester is grantee) they are omitted entirely — the cross-leak rule (§3.2/§4.7).
- Publish gate (§4.7, via `shareService.isVisibleToGrantee`): grantees only ever see
  `published:true` rows; the owner sees everything plus `publish_pending_count`
  (owner-only key). Derived members carry a VIRTUAL `published:false` until published
  (publish materializes a stored marker row — see §2.2 `publishItems`);
  `publish_pending_count` = stored rows `published=false` + derived members lacking a
  published marker row.
- `liked` = `fileLikesStore.filterLiked(requester, nodeIds)` — current viewer only,
  identical in every collection (invariant 9); no counts, no other users' states.
- `reason` (derived rows only) = matched predicate name computed at query time
  (`"tag:poster"`, `"path:/travel/2026"`, `"similar:θ_in"`); `null` for stored. NOT a
  history table (§4.8).
- Adding: unreadable nodes go to `rejected_not_readable`, the rest still add (200). A
  foreign file may be added — you may add what you can READ (§3.2).

### 2.5 Lifecycle + permanent-delete no-inverse rule

- `active → archived` (manual or evolution pass 3) `→ restore | permanent delete`
  (archived only). Manual archive/restore are journaled like any collection act.
  **As-built (T0.3):** restore with a name collision journals the suffix rename and the
  restore as two chained commands; the surfaced `undo` pointer is the RESTORE command
  (undoing it re-archives; the silent rename keeps the row reachable). A multi-field
  `updateCollection` journals one command per present field; the response's undo pointer
  is the FIRST (lowest chain_seq) command so a tip undo cascade covers the whole update.
- `deleteCollectionPermanent`: guard active → `notArchived`. Executes
  `collectionsStore.deleteCollectionPermanent(id, { defFingerprint })`: ONE TX under the
  subject lock — DELETE (cascades items/exclusions/grants/visibility/centroids/cursors/
  suggestions), INSERT `collection_tombstones` when `origin='system'` (fingerprint from
  `fingerprintDefinition`), and `actionJournalStore.purgeSubject('collection',
'collection:<id>')`. Rows cascade-purged + tombstone = trash-parity contract: the
  response carries NO undo pointer and undo of such an id 404s by design (invariant 10).

### 2.6 for-nodes (DEF-25 — listing contracts frozen)

`getForNodes` resolves membership in every ACTIVE collection visible to the requester
(owned + granted, minus hidden): stored rows via `collectionsStore.listForNodes`, plus
derived admission evaluated per (collection, node) pair against ONLY the requested ids
(predicate SQL point-checks; vector defs one cosine per node vs its seed/centroid —
O(collections × nodes), no corpus scan). Exclusions subtract. Result order mirrors the
input `nodeIds`; every requested node gets an entry (possibly `collection_ids: []`).

### 2.7 Preview, seed/search creation, publish-batch copy rule

- `preview({ definition })`: rule dry-count — LLM-free (works with zero config).
- `preview({ seedNodeId })`: requires the embed role (llmAdapter presence, else
  `aiNotConfigured` → route 409). Seed vector = that node's pooled embedding
  (`embeddingsStore.get`); missing embedding → enqueue-eligible note and the preview runs
  against the metadata_only row when present, else empty sample with `count: 0` +
  `degraded: true` (**Decision:** preview never blocks on enrichment; an unembedded seed
  has no basis and the dialog says so client-side via the empty result).
  Cosine via `vectorStore.neighbors(seedVec, k=200+, visibleIds)`, partial top-K;
  `sample` capped at 12, `count` exact (within the cap), `sample_truncated = count>12`.
- Confirm-dialog copy obligation (§4.5): the dialog states that the ENTIRE initial set
  (preview + `plus N more`) is publish-approved as a batch if/when the collection is shared.
- Initial-batch publish rule (§4.7 Q2): the members materialized by the CONFIRMED initial
  execution of a `seed`/`search` collection are created `published=true` (the dialog IS
  the batch approval); all later arrivals park at `published=false` under `ask`/`off`
  and publish-on-add under `auto`. The service passes `published` explicitly to
  `addItem` on every call — store defaults are never relied on.
- `createSearchCollection` flattening (§4.22): the stored definition is the SNAPSHOT of
  the semantic execution (centroid + predicate set from that run's signature) — replay
  chains are never persisted; name-match ids are structurally absent from the input.

### 2.8 Digest + cursor (§4.8)

- `GET /:id/items` serves → `upsertDigestCursor(userId, id, now)` (the read IS the visit).
- With `since`: `added_since` = stored rows `created_at > since` + derived admissions whose
  node `file_nodes.created_at > since` (computed at query time from the live definition
  evaluation — no history table); `removed_since` = journaled removal/exclusion commands on
  the subject after `since` + derived members trashed/purged after `since` (ACL-joined
  `deleted_at`). Zero-change fast path: `last_member_change_at ≤ since` AND no stored
  additions → `{ added_since: 0, removed_since: 0 }` without evaluation.
  **Decision:** counts are display-truth approximations from live state, matching the
  "derived at read" contract; the exact event-sourced variant is out of scope (§9).

### 2.9 Merge flow (arbiter prefill advisory)

- Suggestion READ (`listMergeSuggestions`): pending rows where requester owns both sides;
  `score` desc; additive `recommendation` rendered from the suggestion row's arbiter
  columns (written by [evolutionService](evolutionService.md) pass 5; chat-off ⇒ NULL ⇒
  card shows no preselection — the card still appears).
- `mergeCollections`: owner of both, both active, `id !== otherId`. NO extra dialog — the
  card IS the confirmation (§4.4). ONE journaled command
  (`action='merge'`, subject `collection:<id>`, inverse = recreate loser + move rows
  back): survivor `:id` keeps its name and `name_locked` state as-is (loser name never
  adopted); stored members and exclusions move to the survivor (PK conflicts on overlap
  drop the loser's duplicate rows — the inverse records what was dropped); centroids and
  cursors of the loser are deleted (rebuild on next touch); loser's GRANTS are dropped,
  never migrated (exposure expansion must be explicit — rule 2); matching suggestion row
  → `state='merged'`; survivor `touchMemberChange`. Accepting a merge as survivor is a
  user touch → auto-pin.
- Dismiss = `Later` (`state='dismissed'` + `dismissed_at`; the 2-week re-raise / 30-day
  sleep timing lives in evolution pass 5, NOT here). Reject = `Keep separate`
  (`state='rejected'`, permanent suppression — evolution never re-suggests a rejected
  pair).
- **As-built (T0.3):** the merge command executes through the `collectionsStore.mergeCollections`
  journaled mutator (store spec §2.2): survivor subject lock via `commitChange` plus the
  loser subject lock held across the pre-read/move window; overlap duplicates drop via
  the idempotent item insert and are recorded in the inverse payload (`dropped`); the
  matching pending suggestion flips to `merged` opportunistically (guarded UPDATE — a
  concurrent dismiss/reject between the lookup and the TX leaves the row untouched
  without failing the merge).

### 2.10 Naming (templateNamer first, llmNamer swap)

- `templateNamer` (this domain, deterministic, ko/en locale strings) is DEFAULT and FINAL:
  search → query text verbatim; seed → `{seedFileName} and similar files`; system cluster →
  top-2 local derived tags `{tag1} · {tag2} photos`; split → `{parentName} · {diffTag}`;
  fallback `Auto collection N` (system-origin only). `llmNamer` (ai domain) replaces it for
  NEW creations only while chat is configured; failure ⇒ templateNamer (lossless swap).
  Existing names are never renamed (`name_locked` respected) (§2.7/§4.10).
- Service-side name writes (rename) always lock; auto-generated names do not lock.

### 2.11 Thrown string codes → route ERROR_MAP

Service throws bare codes; `server/domains/collections/routes.js` maps
(`mapServiceError(error, ERROR_MAP)`, recentFiles precedent):

| Thrown code             | → SERVER_ERROR_CODES                | HTTP |
| ----------------------- | ----------------------------------- | ---- |
| `nameRequired`          | `collections.nameRequired`          | 400  |
| `invalidName`           | `collections.invalidName`           | 400  |
| `invalidSort`           | `collections.invalidSort`           | 400  |
| `invalidInclude`        | `collections.invalidInclude`        | 400  |
| `invalidPublishMode`    | `collections.invalidPublishMode`    | 400  |
| `invalidDefinition`     | `collections.invalidDefinition`     | 400  |
| `emptyNodeIds`          | `collections.emptyNodeIds`          | 400  |
| `previewTargetRequired` | `collections.previewTargetRequired` | 400  |
| `mergeSameCollection`   | `collections.mergeSameCollection`   | 400  |
| `notFound`              | `collections.notFound`              | 404  |
| `forbidden`             | `collections.forbidden`             | 403  |
| `alreadyArchived`       | `collections.alreadyArchived`       | 409  |
| `notArchived`           | `collections.notArchived`           | 409  |
| `aiNotConfigured`       | `ai.notConfigured`                  | 409  |

Grant-domain codes (`invalidRole`, `granteeNotFound`, `grantNotFound`) are thrown by
`collectionShareService` and mapped by the SAME router-level ERROR_MAP. **As-built
(T0.3):** the collections service throws the grant codes itself (user lookup +
`viewer|editor` validation) until `collectionShareService` exists (T3.2 moves the
delegation in without changing the thrown codes or the ERROR_MAP). Unknown
collections / no-access reads throw `notFound` (404 masquerade — existence never leaks).

---

## 3. Configuration (T2 / dbOnly, hot)

| Key                      | Default | Use                                                                |
| ------------------------ | ------- | ------------------------------------------------------------------ |
| `AI_VIEW_WEIGHT_ALPHA`   | `0.1`   | §2.3 soft-boost α                                                  |
| `ARCHIVE_RETENTION_DAYS` | `30`    | lifecycle parity with trash; purge horizon (evolution pass 4 / GC) |

Cosine thresholds (θ, θ_in/θ_out, θ_tag) ship in the active model profile —
release-measured values (§4.15 provenance), never runtime-computed.

## 4. Dependencies

- `collectionsStore`, `fileLikesStore`, `actionJournalStore` (indirectly via journaled
  mutators), `fileNodesStore` (ACL enrichment joins), `embeddingsStore` (seed vector read)
- `collectionShareService` (role checks, publish gate, pending counts)
- `domains/ai/vectorStore` seam (`neighbors`, §4.13) — via `server/domains/ai` public API
- `infrastructure/adapters/llm` presence check (`roleConfigured('embed')`) for seed
  preview/creation only; NO LLM call in any request path here (§2 invariant 11)
- `templateNamer` (local); `llmNamer` strategy swap (ai domain, creation-time only)

## 5. Verification Scenarios

- [ ] Lifecycle chain via service: create → archive → restore → delete(archived) —
      active delete throws `notArchived`; permanent delete returns no undo handle and
      purges the subject's journal rows in the same TX (invariant 10)
- [ ] Permanent delete of a `system` collection writes exactly one tombstone with
      `fingerprintDefinition(definition)`; `isTombstoned(owner, fp)` true afterwards
- [ ] View composition: stored ∪ derived − exclusions; excluded derived match absent,
      excluded stored row absent from `excluded` semantics (stored delete path only)
- [ ] `removeItems` never touches `file_nodes` (membership-only; assert node intact)
- [ ] Enrichment: unreadable member → `state:'revoked'` with null name/type; trashed
      member hidden; foreign-owned member → owner sees `shared_excluded:true`, grantee
      never sees the row (cross-leak, §3.2/§4.7)
- [ ] Hysteresis: node at score between θ_out and θ_in does not flip between two reads
      when view counts change (α-boost moves ordering, not admission of clear cases)
- [ ] `addItems` partial success: readable nodes added, unreadable listed in
      `rejected_not_readable`, single command journal row with item-level inverses
- [ ] Editor removing a node they added succeeds; removing the owner-added row throws
      `forbidden` (check delegated to shareService)
- [ ] `publishItems` by non-owner throws `forbidden`; publish toggle on a system
      collection sets `pinned_by='auto'` (touch, no journal row for the pin itself)
- [ ] `preview({definition})` works with zero LLM; `preview({seedNodeId})` with embed
      unconfigured throws `aiNotConfigured`; sample capped at 12 with `count` exact
- [ ] `createSeedCollection` initial batch: every created row `published=true`; a node
      admitted later lands `published=false` under `ask`, `true` under `auto`
- [ ] `createSearchCollection` definition contains NO name-match ids (snapshot rule)
- [ ] Merge: survivor keeps name/name_locked; loser members+exclusions moved, overlap
      duplicates dropped and captured in the inverse; loser grants gone; suggestion →
      `merged`; undo restores loser row + moves members back
- [ ] Merge `:id==:other` throws `mergeSameCollection`; pair with no suggestion row still
      merges (opportunistic state transition)
- [ ] `listMergeSuggestions` includes `recommendation` when the arbiter wrote one,
      `null` without chat
- [ ] Digest: reading items advances cursor (second call with fresh `since` → zeros);
      zero-change fast path avoids definition re-evaluation
- [ ] `getForNodes` includes derived membership + exclusions, one entry per requested
      node, empty arrays for non-members
- [ ] `similar` sort: rows grouped with `cluster_index`, greedy nearest-neighbor over
      `getCentroids` (≤~20 rows), order stable across identical inputs
- [ ] Rename sets `name_locked`; auto names never lock
- [ ] Name collision on create/restore suffixes (DEF-16 pattern), never errors; archived
      same-name does not conflict (partial unique)
- [ ] Grep: zero `CacheAdapter`/`operationProgress` imports; zero SQL text outside stores

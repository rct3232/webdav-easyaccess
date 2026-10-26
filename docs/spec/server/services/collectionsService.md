# collectionsService Spec

Target-contract spec.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Business logic behind `/api/collections` ([routes spec](../routes/collections.md)): CRUD + lifecycle, the materialized member view, definition evaluation at commit/pass boundaries, preview/seed-confirm, merge execution, sorts, digests, for-nodes chips.                                                                                                                                                                  |
| Boundaries | Never mutates file nodes — view by collection, mutate by file: collection grants never touch file ACL, and the service exposes no rename/move/delete-of-file function. Grants/roles/publish/self-revocation are owned by [collectionShareService](collectionShareService.md) and consumed here via `getRole`/publish-gate helpers. Undo flows live in the journal; mutation results carry `undo: { actionId }` pointers only. |
| Journal    | Every user-visible mutation reaches the DB through `collectionsStore` journaled mutators (`createCollection`, `renameCollection`, `setPinned`, `archiveCollection`, `restoreCollection`, `addItem`, `removeItem`, `addExclusion`, `removeExclusion`, `setItemPublished`) — i.e. `actionJournalStore.commitChange(mutation, inverse)` is the only write path. Permanent delete has NO inverse (see §2.5).                      |
| State      | DB-backed only — zero CacheAdapter/operationProgress imports (no AI/collection state in CacheAdapter; CODING_STYLE.md Express Patterns grep-gate).                                                                                                                                                                                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/collections/service.js`
- **Helpers:** `server/domains/collections/definitionEngine.js` (pure evaluation core — see §2.3), `server/domains/collections/namingService.js` (§2.10)
- **Test file:** `server/domains/collections/__tests__/collectionsService.test.js`
  (unit) + domain route suite `__tests__/collections.test.js` (integration)

### 2.2 Public Function Contracts

All functions take `userId` (requester) first, throw bare string codes (§2.10), and
return domain objects the route serializes snake_case. `ctx = { actor: userId }` is
passed to every journaled store mutator.

| Function                                                                 | Returns                                                                 | Contract (condensed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listCollections(userId, { sort, include })`                             | `{ collections[] }`                                                     | `sort ∈ activity\|name\|created\|updated\|similar` (default `activity`); `include ⊆ mine,shared,archived`. Shared rows: `definition` omitted, `granted_role` set. Hidden collections (requester's `collection_visibility` flag set) are filtered by the list SQL; `setVisible` has no API caller at P0. Each row carries `preview_items`: up to 4 newest-added members built IN MEMORY from the same `resolveMemberRows` view already computed for `item_count` — `state!=='revoked'` only (shared-excluded rows preview to the owner; grantees never receive those rows), `createdAt` desc (tie-break `nodeId` desc), sliced to 4, mapped to `{node_id,name,type,mime}`; zero extra queries; `getCollection` serializes previews from its resolved view the same way. Rows also carry `last_visited_at`: the REQUESTER's digest cursor ISO string or `null` (never opened — sidebar new-dot source), read ONCE per list via `collectionsStore.listDigestCursorMap(userId)` (single SELECT, no per-row query) and attached through the `serializeCollection` opts; `getCollection` omits the field. |
| `createCollection(userId, { name })`                                     | `{ collection, undo }`                                                  | `origin='user'`, `status='active'`, `publish_mode='ask'`. Name validation + suffix-collision retry (§2.4). SEEDS the creator's digest cursor (`last_visited_at = created_at`) inside the same journaled create TX — self-created collections never render the sidebar `new` dot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `createSeedCollection(userId, { name, seedNodeId })`                     | `{ collection, undo }`                                                  | `origin='seed'`, `definition={kind:'seed_vector', seed_ref, theta}`; INITIAL BATCH `source='seed'`, `published=true` (§2.7). Requires embed role: else throw `aiNotConfigured`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `createSearchCollection(userId, { name, semantic })`                     | `{ collection, undo, rejected_not_readable }`                           | `origin='search'`; definition = flattened semantic SNAPSHOT (§2.7): `{ kind: 'search', result_ref, predicates }` — the `result_ref` is the stored centroid REFERENCE (searchService.md §2.4 replay rule; replay chains are never persisted); name-match results NEVER included; initial batch = the readable semantic ids via the `addItems` mechanics with `source='search'` and `published=true` explicit (§2.7 — the dialog IS the batch approval); unreadable ids land in `rejected_not_readable` (§2.4 "only add what you can read" — never a silent drop); `undo` = the CREATE command (tip undo deletes the collection together with the initial batch). Validation: name rules as `createCollection`; malformed snapshot (`resultRef` missing/non-string, `predicates` non-array or non-empty at P1) → `invalidDefinition`; `nodeIds` 1–200 else `emptyNodeIds` (an empty semantic member set rejects honestly — the §2.6 client gate prevents offering Save, the server never accepts one). No embed role required (the snapshot is flattened — no live definition evaluated at create).   |
| `updateCollection(userId, id, { name?, pinned?, publishMode? })`         | `{ collection, undo }`                                                  | Owner-only. `name` write → `lockName=true`. `pinned:true` → `pinned_by='user'` (overwrites `'auto'`); `pinned:false` → NULL + unpin. `publishMode` write is the explicit sharing-mode act (enabling/changing sharing is the only consent act; no automation publishes silently).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `archiveCollection(userId, id)` / `restoreCollection(userId, id)`        | `{ collection, undo }`                                                  | Manual lifecycle, 1 confirm client-side (user-triggered destructive/change actions get exactly one confirmation; system actions none, but are journaled). Active↔archived guards: `alreadyArchived` / `notArchived`. Restore re-suffixes on name collision. Both are user touches → auto-pin eligible system rows via store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `deleteCollectionPermanent(userId, id)`                                  | `undefined` (route 204)                                                 | Archived only (§2.5). NO undo pointer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `getItems(userId, id, { since? })`                                       | `{ items[], publish_pending_count?, digest? }`                          | Materialized member view (§2.3–§2.4); **full fetch — the complete row set in ONE response**; the `cursor`/`limit`/`next_cursor` params are IGNORED (never an error); order = activity score desc, then `node_id` asc; reading stamps the digest cursor (§2.8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `addItems(userId, id, nodeIds)`                                          | `{ added[], already_members[], rejected_not_readable[], undo }`         | Owner or editor. 1–200 ids else `emptyNodeIds`. "Only add what you can read" (§2.4). `published` default per publish-mode rules (§2.7). One command journal row with item-level inverses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `removeItems(userId, id, nodeIds)`                                       | `{ removed[], excluded[], ignored[], undo }`                            | Owner, or editor for what they added (else `forbidden`). Removes stored rows; on a definition-driven collection the same command inserts `collection_exclusions` for the ids so the next evaluation pass cannot re-admit them. Manual (definition-less) collections delete only. Membership only — removing a member never trashes the node.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `preview(userId, { seedNodeId? , definition? })`                         | `{ count, sample[], sample_truncated }`                                 | Exactly one target else `previewTargetRequired` (§2.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `previewCollection(userId, id)`                                          | same as `preview`                                                       | Owner-only dry-run of the stored definition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `publishItems(userId, id, nodeIds, published)`                           | `{ published[], ignored[], undo }`                                      | Owner or editor (parity with `addItems`); viewer → `forbidden`. Reuses the journaled `collectionsStore.setItemPublished` (inverse + undo case live) — materialized rows flip; unpublish flips back to `false` and never deletes a row. Ids outside the materialized membership → `ignored[]` — never added (anti-injection). `undo.action_id` = the flip command, else `null`. Publishing a row on a `system` collection is a user touch → auto-pin (`pinned_by='auto'`, no journal row for the pin). Route surface `PUT /:id/items/publish`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `listMergeSuggestions(userId)`                                           | `{ suggestions[] }`                                                     | Pending rows owned by requester, `score` desc; rows carry additive `recommendation: { verdict, reason } \| null` from the merge-arbiter prefill (§2.9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `mergeCollections(userId, id, otherId)`                                  | `{ survivor, absorbed_id, undo }`                                       | §2.9. `id === otherId` → `mergeSameCollection`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `dismissMerge(userId, id, otherId)` / `rejectMerge(userId, id, otherId)` | `{ suggestion_id, state, dismissed_at?, rejected_at?, dismiss_count? }` | `setSuggestionState('dismissed'\|'rejected')`; dismiss increments `dismiss_count`; no pending row → `suggestionNotFound`. …                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `getForNodes(userId, nodeIds)`                                           | `{ memberships: [{ nodeId, collectionIds[] }] }`                        | §2.6. 1–200 ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `fingerprintDefinition(definition)`                                      | hex string                                                              | Pure. Normalized schema + core params (θ, tag-set, path — NOT raw centroid values). Shared with [evolutionService](evolutionService.md) (pass 4 tombstones); permanent delete of a `system` collection passes it to `deleteCollectionPermanent` (permanent delete-from-archive is unrecoverable — trash-parity; the tombstone blocks silent regeneration).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `checkUploadAdmissions(userId, nodeId)`                                  | `{ nodeId, admittedCollectionIds[] }`                                   | Upload-hook rule-check (§2.3-bis). Point evaluation of the requester's ACTIVE definition-driven collections against ONE freshly committed node; each admitting collection materializes a rule-managed membership row (`source='system'`, matched `reason`, publish state per mode) and bumps `last_member_change_at`. Invoked fire-and-forget from the four content-commit seams.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `listGrants(userId, id)`                                                 | `{ grants[] }`                                                          | Owner only (`forbidden`); rows enriched with grantee username at the route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `grantCollectionAccess(userId, id, granteeId, role)`                     | `{ grant, username, undo }`                                             | Owner only. `role ∉ viewer\|editor` → `invalidRole`; unknown/approved-absent grantee → `granteeNotFound`; **admin grantee → `forbidden`** (403 — admin-as-grantee banned at grant creation, operator rule). Re-grant overwrites the role (PK pair). Journaled one command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `revokeCollectionAccess(userId, id, granteeId)`                          | `{ grantee_id, revoked, undo }`                                         | Owner only. No such row → `grantNotFound`. Instant (revocation takes effect on the next read — no cache, no grace). Store path `revokeAccess` journals action `revoke` with inverse `grant-access`. The same journaled TX also DELETES the grantee's digest cursor row (`deleteDigestCursor` — re-grant after revoke re-dots; see §2.8 for the undo boundary).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `revokeOwnGrant(userId, id)`                                             | `{ grantee_id, revoked, undo }`                                         | **Grantee self-revocation** (`DELETE /:id/grants/me` — the grantee removes their own grant; there is no `leave`/hide route). Caller must hold a `viewer\|editor` grant; removal + journaling ride the SAME `collectionsStore.revokeAccess` path as the owner side (actor = grantee). Zero-access/unknown id → `notFound` (masquerade via `getCollectionForRead`); caller with no grant row (incl. the owner) → `grantNotFound`. Instant (revocation takes effect on the next read — no cache, no grace). Cursor deletion rides the same store TX — the self-revoking grantee's cursor row is deleted too (§2.8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 2.2.1 Route-surface mapping note

`POST /api/collections` dispatches on body shape: `{ name }` only → `createCollection`
(the routes-doc line "Create manual"); `{ name, seedNodeId }` → `createSeedCollection`;
`{ name, semantic }` → `createSearchCollection`. One create endpoint with additive body
fields (wire name `semantic` carries the flattened semantic-execution snapshot: centroid ref +
predicate set + member node ids of the semantic section only — request body camelCase
`{ resultRef, predicates, nodeIds }`, stored definition snake_case
`{ kind: 'search', result_ref, predicates }`); [routes/collections.md](../routes/collections.md)
syncs this row.

**Shipped scope:** `createCollection` (manual), `createSeedCollection` (embed-gate
entry), `createSearchCollection` (the `{ name, semantic }` dispatch arm — the search
save leg) and `publishItems` (route `PUT /:id/items/publish`) ship with the routes
surface. `createSearchCollection` as-built: the request snapshot is validated
(`resultRef` non-empty string, `predicates` an array — non-empty rejected
`invalidDefinition` at P1, `nodeIds` 1–200 via the shared `parseNodeIds` boundary);
readability is classified per id with the §2.4 rule — readable ids join the initial
batch, unreadable ids are returned in the response's additive `rejected_not_readable`
key (an all-unreadable batch still creates the collection with zero members — the
addItems partial-success precedent); the empty member set rejects `emptyNodeIds`.
The create and the initial batch are two journaled commands; the returned
`undo` pointer is the CREATE command (its tip undo deletes the collection together
with the just-added batch). No embed role is required: the snapshot is flattened —
the stored definition is never evaluated at create time.
`createSeedCollection` implements the embed presence gate (throws `aiNotConfigured`)
and evaluates the seed's candidate set through the §2.3 pooled-vector membership
contract. Seed preview and creation share one internal
computation, so the created initial batch is exactly the preview set. Seed
preview with the embed role present but no pooled embedding for the seed node
resolves through the §2.7 missing-embedding branch (`count: 0`, `degraded: true`)
and enqueues an idempotent `embed` job when the seed is a file. The embed-role
presence check reads `infrastructure/adapters/llm` `roleConfigured('embed')`
once the adapter is installed; before boot it falls back to the `LLM_EMBED_*`
config keys.

### 2.3 Definition engine (rule-managed, materialized membership)

- Definition kinds: `{kind:'predicate', any_of/all_of: [path_prefix|tag|like|date|size …]}`
  and `{kind:'seed_vector'|'centroid', seed_ref|centroid_ref, theta, theta_in?, theta_out?}`
  (vector rules may AND/OR with predicates).
- **Self-centroid definitions.** For `{kind:'centroid', centroid_ref:null}` the reference is
  the OWNING collection's `collection_centroids` row for the active embed model. Callers
  that evaluate an existing collection pass its id through
  `evaluateDefinitionMembership`/`previewCollection`; the upload hook and the evolution
  reconcile/create passes do the same. A self-centroid definition evaluated without a
  collection id (for example a rule preview not tied to a stored collection) has no
  reference and degrades to no matches. System cluster creation writes exactly this shape
  (`theta` = tier edge cosine, `tier`, `event_class`), so later writes score against the
  same model-keyed centroid. A split sibling's definition carries the same shape plus
  `split_of: <parentId>` provenance (evolutionService §2.5); the field is inert for
  evaluation and is excluded from the parent-equivalent tombstone fingerprint.
- **Compute-on-write.** Definition evaluation runs only at write boundaries — the upload
  hook and [evolutionService](evolutionService.md) reconcile passes. The read path NEVER
  evaluates a definition: `GET /`, `GET /:id`, `GET /:id/items` and `POST /for-nodes`
  read `collection_items` only. Membership is materialized there with `source`
  (`manual|system|seed|search`) and `reason` columns; `collection_items` is the single
  membership state.
- **Hysteresis.** A reconcile pass compares the materialized set with the fresh scores:
  an existing member is kept while `score ≥ θ_out`; a non-member is admitted while
  `score ≥ θ_in`; otherwise the row is removed. Predicate atoms are boolean and have no
  band. `θ_in > θ_out`; both derive from the definition's `theta` plus the active model
  profile's membership offsets (`membershipHysteresis.inDelta/outDelta`). A profile
  without finite offsets uses `theta_in = theta_out = theta`.
- **Vector membership uses pooled vectors.** Seed cosine is computed against
  `embeddingsStore.get(seed_ref)`; centroid cosine against the active model's
  `collection_centroids` row. Cross-`model_id` comparison is forbidden.
  `vectorStore.neighbors` (max-over-chunks) is the RETRIEVAL scorer and is never used
  for membership or grouping.
- **View-weighted soft boost** applies to ordering only:
  `score = cosine × (1 + α·log10(1 + views))`, `α = 0.1` (T2), views from the per-user
  `node_activity` rollup. Admission/removal use the un-boosted score.
- **Exclusions** (`collection_exclusions`) are checked by each evaluation pass and are
  never applied to an existing stored row at read time. `Exclude` deletes the
  materialized row and inserts the exclusion in one command; the row therefore cannot be
  re-admitted. Manual (definition-less) collections never create exclusions.
- **Always materialized:** seed/search/system collections store their members. Seed and
  search initial batches are inserted `published=true` with `source='seed'|'search'`;
  later rule admissions carry `source='system'` and the publish state derived from
  `collections.publish_mode` (`auto` ⇒ true, `ask|off` ⇒ false).
- **Candidate-set mechanism:** each evaluation pass assembles the requester's visible
  candidate set from existing store reads — the requester's own-root subtree
  (`getUserRootNode` + `getDescendants`, readable by ownership) plus explicitly granted
  nodes/subtrees (`permissionStore.getUserFilePermissions` / `getUserPermissions` +
  subtree expansion), mirroring `fileService` listing parity. Per-node point checks:
  path (ancestor walk over the loaded candidate rows), date (`file_nodes.created_at`),
  size (`filecache` point read when a size atom is present), like
  (`fileLikesStore.listLikedNodeIds`), tag (folded string equality through the provider
  seam — the §2.3 tag bullet). The ACL-joined SQL variant of this scan is a tracked
  optimization, not shipped; no new repository surface is required for it.
- **Tag predicates** match by folded string equality in every state — there is no vector
  tag matching, no `θ_tag`, no `tag_embeddings` read path (§4.18). The tag atom resolves
  through `aiTagStore.listNodeIdsByRawTag(foldTag(value))` (orthographic fold
  `domains/ai/tagVocabulary.js` — NFKC + whitespace/case fold; `ai_tag_raw` rows are
  written folded by the derived-tags pipeline). No embed/chat dependency;
  model-invariant.
- `preview`/`previewCollection` are explicit dry-runs and MAY evaluate the definition
  live; they never mutate membership.

### 2.3-bis Upload-hook rule-check seam

`checkUploadAdmissions(userId, nodeId)` is the collections-domain half of the upload/copy/restore commit
points (aiJobService §2.2: "The upload-hook path checks rule-driven COLLECTION admission
separately — that is collections domain... the only coupling is membership materialization on
rule-admission"). Contract:

- Inputs: `userId` = the node OWNER whose collection definitions are checked; `nodeId` =
  the freshly committed content node. No request context, no route — a plain async
  service call, safe fire-and-forget (throws are the caller's to log; the hook never
  blocks a request — no LLM call or rule sweep may block a request path).
- Behavior: point evaluation (§2.6 mechanism — the node + its ancestor chain, NOT a corpus
  scan) against every ACTIVE definition-driven collection owned by `userId`; exclusions
  and existing rows short-circuit. Each collection whose definition admits the node
  materializes ONE membership row (`source='system'`, matched `reason`, publish state per
  `publish_mode`), all inside its journaled item command with `actor='system'`, and bumps
  `last_member_change_at`. Returns `{ nodeId, admittedCollectionIds }`.
- Vector definitions use the pooled-vector evaluator (§2.3); predicate atoms of mixed
  definitions evaluate point-wise. `checkUploadAdmissions` adds but never removes —
  removals belong to the reconcile pass.
- **Invocation:** the four content-commit seams (S3 upload, WebDAV upload, copy, version
  restore) call this fire-and-forget after commit, alongside the `ai_jobs` enqueue.

### 2.4 Member-view enrichment (per read; precedent `recentFiles/service.js` enrichRecentEntry)

Composition: `view = collection_items` (materialized membership), then per-row enrichment under a
JOIN-TIME ACL check of the REQUESTER against `fileNodesStore`:

| Condition                              | Render                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| readable, not trashed                  | `state:'normal'`                                                                                   |
| previously-in-view, no longer readable | `state:'revoked'` placeholder — `name`/`type`/thumbnail NULL (metadata after revocation is a leak) |
| trashed by owner (`deleted_at` set)    | hidden, row kept                                                                                   |
| purged                                 | absent (FK cascade removed the rows)                                                               |

- Foreign-owned members (`!isOwnerNode(collection.ownerId, nodeId)` — closure ancestry; the collection
  OWNER is non-admin by construction — the operator rule server-gates every
  collections route against admin requesters, so admin-owned collections are unreachable; the
  `permissionPolicy.js` admin-owns-everything convention stays scoped to file-ACL surfaces): in the
  OWNER's view they
  render with `shared_excluded: true` (`Not owner's file — not shared` badge — VpnLock); in a SHARED view
  (requester is grantee) they are omitted entirely — the cross-leak rule (foreign-owned members are never rendered into shared views).
- Publish gate (via `shareService.isVisibleToGrantee`): grantees only ever see
  `published:true` rows; the owner sees everything plus `publish_pending_count`
  (owner-only key) = materialized rows `published=false`.
- `liked` = `fileLikesStore.filterLiked(requester, nodeIds)` — current viewer only,
  identical in every collection (likes are per-file, viewer-scoped — the heart reflects the current viewer's own like only); no counts, no other users' states.
- `reason` = the `collection_items.reason` captured when a rule-managed row was
  materialized (`"tag:poster"`, `"path:/travel/2026"`, `"similar"`); `null` for manual
  rows. Read paths never recompute it.
- `membership` = `'stored'` for `source='manual'` rows and `'derived'` for every
  rule-managed `source` (`system|seed|search`) — a rendering label over the one
  materialized row, never a second read-time membership set.
- `mime`: the row carries the node's `mimeType` (filecache value; `null` on revoked
  rows like `name`/`type`). Same field feeds `preview_items` on collection rows.
- Adding: unreadable nodes go to `rejected_not_readable`, the rest still add (200). A
  foreign file may be added — you may add what you can READ.

### 2.5 Lifecycle + permanent-delete no-inverse rule

- `active → archived` (manual or evolution pass 3) `→ restore | permanent delete`
  (archived only). Manual archive/restore are journaled like any collection act.
  Restore with a name collision journals the suffix rename and the
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
  response carries NO undo pointer and undo of such an id 404s by design (permanent delete-from-archive is unrecoverable — trash-parity).

### 2.6 for-nodes (listing contracts frozen)

`getForNodes` resolves membership in every ACTIVE collection visible to the requester
(owned + granted, minus hidden) from `collection_items` only
(`collectionsStore.listForNodes`). No definition evaluation runs on this path. Result
order mirrors the input `nodeIds`; every requested node gets an entry (possibly
`collection_ids: []`).

### 2.7 Preview, seed/search creation, publish-batch copy rule

- `preview({ definition })`: rule dry-count — predicate-only definitions are LLM-free
  (works with zero config); `seed_vector`/`centroid` definitions require the active
  embed model and use the pooled-vector cosine of §2.3. A self-centroid definition
  (`centroid_ref: null`) resolves the owning collection's centroid only in
  `previewCollection` (which supplies the collection id); a free-standing definition
  preview has no owning row and reports `degraded`. Dry-runs never mutate membership.
- `preview({ seedNodeId })`: requires the embed role (`llmAdapter
.roleConfigured('embed')`; pre-boot fallback `LLM_EMBED_*`, else
  `aiNotConfigured` → route 409). Seed vector = that node's pooled embedding
  (`embeddingsStore.get`, parsed with `vectorMath.parseVector`); missing
  embedding → an idempotent `embed` job is enqueued for a file seed and the
  preview returns empty `count: 0` + `degraded: true` (preview never blocks on
  enrichment — an unembedded seed has no basis). Candidates are the requester's
  `fileNodesStore.listVisibleFileNodeIds` set with the seed itself removed
  BEFORE the top-K cut; cosine is computed over the candidate set from their
  **pooled** embeddings (`k=200`, partial top-K); `sample` capped at 12,
  `count` exact within the cap, `sample_truncated = count>12`. `degraded` appears
  only in the missing-embedding case.
- Seed creation reuses the SAME candidate computation as the preview: the
  definition is `{kind:'seed_vector', seed_ref: seedNodeId, theta:
SEED_VECTOR_THETA}` (`SEED_VECTOR_THETA = 0.62`, a documented create-time
  constant owned by the service; pass-time θ_in/θ_out admission policy stays
  with the active model profile, §2.3), and the preview ids materialize as the
  initial batch with `source='seed'`, `reason='similar'` and `published=true`.
  A missing embedding still creates the collection with the definition and zero
  members. A blank request name is filled by `templateNamer`/`llmNamer` (§2.10);
  a supplied name is used verbatim.
- Confirm-dialog copy obligation: the dialog states that the ENTIRE initial set
  (preview + `plus N more`) is publish-approved as a batch if/when the collection is shared.
- Initial-batch publish rule: the members materialized by the CONFIRMED initial
  execution of a `seed`/`search` collection are created `published=true` with
  `source='seed'|'search'` (the dialog IS the batch approval); all later rule
  arrivals carry `source='system'` and park at `published=false` under `ask`/`off`
  and publish-on-add under `auto`. The service passes `published` and `source`
  explicitly to the store on every call — store defaults are never relied on.
- `createSearchCollection` flattening: the stored definition is the SNAPSHOT of
  the semantic execution (centroid + predicate set from that run's signature) — replay
  chains are never persisted; name-match ids are structurally absent from the input.

### 2.8 Digest + cursor

- `GET /:id/items` serves → `upsertDigestCursor(userId, id, now)` (the read IS the visit).
- **Revoke deletes the grantee's cursor:** both revoke paths —
  owner-side `revokeCollectionAccess` and grantee self-revoke `revokeOwnGrant` — ride the SAME
  journaled `collectionsStore.revokeAccess` TX; inside that TX `deleteDigestCursor(tx, granteeId,
collectionId)` removes the grantee's row for that collection. A re-grant after a revoke therefore
  RE-DOTS (the grantee is "never opened" again). NO post-commit best-effort: the delete is part of
  the mutation TX (rollback-safe). **Undo boundary:** `undoAction` of a revoke
  restores the GRANT only (inverse `grant-access` re-inserts the row) but NOT the deleted cursor —
  re-grant-via-undo likewise RE-DOTS. Other users' cursors for the same collection are untouched.
- **Seed at create:** `createCollection` writes the creator's
  cursor (`last_visited_at = created_at`) inside the same journaled create TX. The sidebar
  `new` dot ⇔ the requesting user's cursor row is ABSENT (`GET /` row `last_visited_at` =
  `null`; client rule in `useFolderTreeController.md` §3).
- With `since`: `added_since` = materialized rows `created_at > since` (all
  `source` values; membership-added time is the row timestamp); `removed_since` =
  journaled removal/exclusion commands on the subject after `since` + member nodes
  trashed/purged after `since` (ACL-joined `deleted_at`). Zero-change fast path:
  `last_member_change_at ≤ since` → `{ added_since: 0, removed_since: 0 }` without
  additional reads. Counts are display-truth approximations from current state;
  the exact event-sourced variant is rejected.

### 2.9 Merge flow (arbiter prefill advisory)

- Suggestion READ (`listMergeSuggestions`): pending rows where requester owns both sides;
  `score` desc; additive `recommendation` rendered from the suggestion row's arbiter
  columns (written by [evolutionService](evolutionService.md) pass 5; chat-off ⇒ NULL ⇒
  card shows no preselection — the card still appears).
- `mergeCollections`: owner of both, both active, `id !== otherId`. NO extra dialog — the
  card IS the confirmation (the merge-proposal card is the only proposal surface — never an inbox). ONE journaled command
  (`action='merge'`, subject `collection:<id>`, inverse = recreate loser + move rows
  back): survivor `:id` keeps its name and `name_locked` state as-is (loser name never
  adopted); stored members and exclusions move to the survivor (PK conflicts on overlap
  drop the loser's duplicate rows — the inverse records what was dropped); centroids and
  cursors of the loser are deleted (rebuild on next touch); loser's GRANTS are dropped,
  never migrated (exposure expansion must always be explicit); matching suggestion row
  → `state='merged'`; survivor `touchMemberChange`. Accepting a merge as survivor is a
  user touch → auto-pin.
- Dismiss = `Later` (`state='dismissed'` + `dismissed_at`; the 2-week re-raise / 30-day
  sleep timing lives in evolution pass 5, NOT here). Reject = `Keep separate`
  (`state='rejected'`, permanent suppression — evolution never re-suggests a rejected
  pair).
- The merge command executes through the `collectionsStore.mergeCollections`
  journaled mutator (store spec §2.2): survivor subject lock via `commitChange` plus the
  loser subject lock held across the pre-read/move window; overlap duplicates drop via
  the idempotent item insert and are recorded in the inverse payload (`dropped`); the
  matching pending suggestion flips to `merged` opportunistically (guarded UPDATE — a
  concurrent dismiss/reject between the lookup and the TX leaves the row untouched
  without failing the merge).

### 2.10 Naming (templateNamer first, llmNamer swap)

- `templateNamer` (`namingService.js`, this domain, deterministic, ko/en locale
  strings) is DEFAULT and FINAL:
  search → query text verbatim; seed → `{seedFileName} and similar files`; system cluster →
  top-2 local derived tags `{tag1} · {tag2} photos`; split → `{parentName} · {diffTag}`;
  fallback `Auto collection N` (system-origin only). `createNamer({ llmAdapter,
chatConfigured, invokeLlm })` wraps the template: `llmNamer` replaces it for
  NEW creations only while chat is configured; any failure (unconfigured role,
  provider error, empty output) ⇒ templateNamer (lossless swap).
  Existing names are never renamed (`name_locked` respected; template output is final — no post-hoc rename jobs).
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
`collectionShareService` and mapped by the SAME router-level ERROR_MAP. The collections
service throws the grant codes itself today (user lookup +
`viewer|editor` validation); delegation to `collectionShareService` will not change
the thrown codes or the ERROR_MAP. Unknown
collections / no-access reads throw `notFound` (404 masquerade — existence never leaks).

---

## 3. Configuration (T2 / dbOnly, hot)

| Key                      | Default | Use                                                                |
| ------------------------ | ------- | ------------------------------------------------------------------ |
| `AI_VIEW_WEIGHT_ALPHA`   | `0.1`   | §2.3 soft-boost α (ordering only)                                  |
| `ARCHIVE_RETENTION_DAYS` | `30`    | lifecycle parity with trash; purge horizon (evolution pass 4 / GC) |

Cosine thresholds (`theta`, `theta_in`/`theta_out`) ship in the active model profile —
release-measured values (release artifacts, displayed with provenance in the admin governance panel), never runtime-computed. The membership band is carried by
`profile.membershipHysteresis.inDelta/outDelta`; absent finite offsets leave
`theta_in = theta_out = definition.theta`.

## 4. Dependencies

- `collectionsStore`, `fileLikesStore`, `actionJournalStore` (indirectly via journaled
  mutators), `fileNodesStore` (ACL enrichment joins), `embeddingsStore` (seed vector read),
  `aiTagStore` (tag atoms: `listNodeIdsByRawTag` — folded string equality) and `domains/ai/tagVocabulary` (pure orthographic fold of
  atom values before the store read)
- `collectionShareService` (role checks, publish gate, pending counts)
- `embeddingsStore` (pooled seed vectors), `collection_centroids` via `collectionsStore`
  (centroid membership), and `domains/ai/vectorStore` (`neighbors`) only for retrieval
  consumers — never for membership/grouping
- `infrastructure/adapters/llm` presence check (`roleConfigured('embed')`) for seed
  preview/creation only; NO LLM call in any request path here (only explicitly user-initiated interactive roles may ever run on a request path, and none are used here)
- `templateNamer` (local); `llmNamer` strategy swap (ai domain, creation-time only)

## 5. Verification Scenarios

- [ ] Lifecycle chain via service: create → archive → restore → delete(archived) —
      active delete throws `notArchived`; permanent delete returns no undo handle and
      purges the subject's journal rows in the same TX (permanent delete-from-archive is unrecoverable)
- [ ] Permanent delete of a `system` collection writes exactly one tombstone with
      `fingerprintDefinition(definition)`; `isTombstoned(owner, fp)` true afterwards
- [ ] View composition: `GET /`, `GET /:id`, `GET /:id/items` and `for-nodes` return
      `collection_items` only; an excluded node has no row and does not reappear until
      the exclusion is removed; a stored row never gets filtered by definitions at read
      time
- [ ] Read stability: two consecutive reads of the same collection (different view
      counts / new candidate files) return the same member set until a reconcile pass or
      user mutation runs
- [ ] `removeItems` never touches `file_nodes` (membership-only; assert node intact)
- [ ] Enrichment: unreadable member → `state:'revoked'` with null name/type; trashed
      member hidden; foreign-owned member → owner sees `shared_excluded:true`, grantee
      never sees the row (cross-leak)
- [ ] Hysteresis (pass-level): a materialized member with `theta_out ≤ score < theta_in`
      survives a reconcile pass; a non-member in the same band is not admitted; a member
      below `theta_out` is removed
- [ ] `addItems` partial success: readable nodes added, unreadable listed in
      `rejected_not_readable`, single command journal row with item-level inverses
- [ ] Editor removing a node they added succeeds; removing the owner-added row throws
      `forbidden` (check delegated to shareService)
- [ ] `publishItems` by a viewer grantee throws `forbidden`; owner and editor flip
      materialized rows; non-member ids land `ignored` (never added); publish toggle on
      a `system` collection sets `pinned_by='auto'` (touch, no journal row for the pin)
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
      zero-change fast path avoids extra reads; `added_since` counts materialized rows of
      every `source`
- [ ] `createCollection` seeds the creator's cursor row
      (`last_visited_at = created_at`, one row in `collection_digest_cursors` right after
      create); `listCollections` rows carry `last_visited_at` (ISO when seeded/stamped,
      `null` for a never-opened grantee/legacy row) from ONE batched
      `listDigestCursorMap` read
- [ ] Both revoke paths delete the grantee's cursor row INSIDE the
      journaled revoke TX (re-grant → `last_visited_at` `null` again, dot back; other users'
      cursors survive); `undoAction` of a revoke restores the grant but NOT the cursor
      (undo-revoke re-dots)
- [ ] `getForNodes` returns materialized membership only (no definition evaluation), one
      entry per requested node, empty arrays for non-members
- [ ] Tag atom: definition `{kind:'predicate',any_of:[{type:'tag',value:'ext:jpg'}]}`
      admits exactly the nodes whose folded `ai_tag_raw` set contains the folded value;
      folded string equality in every state (no vector variant — §4.18)
- [ ] `checkUploadAdmissions`: a freshly created node admitted by an owner collection
      materializes exactly one row (`source='system'`, matched `reason`, publish state per
      mode), advances `last_member_change_at`, and returns the id; excluded / already
      materialized / non-owner / archived collections untouched; vector definitions use
      pooled cosine
- [ ] `similar` sort: rows grouped with `cluster_index`, greedy nearest-neighbor over
      `getCentroids` (≤~20 rows), order stable across identical inputs
- [ ] Rename sets `name_locked`; auto names never lock
- [ ] Name collision on create/restore suffixes, never errors; archived
      same-name does not conflict (partial unique)
- [ ] Grep: zero `CacheAdapter`/`operationProgress` imports; zero SQL text outside stores

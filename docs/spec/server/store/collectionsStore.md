# collectionsStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Facade over the collection platform tables (`collections`, `collection_items`, `collection_exclusions`, `collection_grants`, `collection_visibility`, `collection_centroids`, `collection_tombstones`, `collection_digest_cursors`, `collection_merge_suggestions`). |
| Write rule   | Every journaled mutation executes through `actionJournalStore.commitChange()` — the change and its `action_journal` row land in ONE transaction under `lockManager`; the facade exposes no other public mutators (§4.11).                                            |
| Read rule    | The member view is `items ∪ stored ∪ derived − exclusions` (§2 invariant 6). Derived evaluation lives in the collections service (definition engine, DEF-25); this store exposes lookups only.                                                                       |
| Design owner | `docs/features/collections-platform.md` §3.1/§3.2 (lifecycle, members), §4.4 (merge suggestions), §4.7 (sharing), §4.8 (digest), §4.9 (evolution writes), §5 (schema).                                                                                               |

---

## 2. Implementation Spec

> **Layering (repository-contract):** `server/store/collectionsStore.js` is a facade — it
> contains no SQL and delegates to `CollectionsRepository` built over
> `storage.getExecutor()`. Dialect SQL lives in the twins
> `server/store/repositories/{sqlite,postgres}/CollectionsRepository.{sqlite,postgres}.js`.
> **Decision:** one repository interface covers the whole `collection*` table cluster
> (repository-contract rule 1, "one interface per domain"); the conformance suite groups
> cases per table.
>
> - **Source:** `server/store/collectionsStore.js`
> - **Interface + factory:** `server/store/repositories/CollectionsRepository.js`
> - **Conformance (L2):** `server/store/repositories/__tests__/CollectionsRepository.conformance.test.js`
> - **Facade test:** `server/domains/collections/__tests__/collectionsStore.test.js` (recentFiles precedent)
> - **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
>   (PG-canonical; sqlite via the transpiler). This spec does not duplicate DDL text.

### 2.1 Journal discipline

Journaled mutators (domain `collection`, subject `collection:<id>` — §4.11 matrix
"create/add/exclude/pin/publish/rename/grant·revoke", archive, restore, merge-confirm side effects):

`createCollection`, `renameCollection`, `setPinned`, `archiveCollection`,
`restoreCollection`, `addItem`, `removeItem`, `addExclusion`, `removeExclusion`,
`setItemPublished`, `grantAccess`, `revokeAccess`.

Each one calls `actionJournalStore.commitChange(domain, subject, meta, inverse, mutation)`
with the row write implemented against the tx-bound repository (write methods take the
commitChange TX; `createCollection` resolves its `collection:<id>` subject inside the TX —
actionJournalStore §2.3). Batch commands (multi-select add / exclude / publish) produce
ONE command journal row whose payload carries the item-level inverse list (§4.11 UI/UX
paragraph). Journaled mutators additionally return the `actionId` undo pointer alongside
their §2.2 shape (routes surface it as `undo: { action_id }` — routes/collections.md).

**Non-journaled mutators** (explicit exceptions, each with its design basis):

| Mutator                                       | Basis                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `upsertDigestCursor`, `setVisible`            | visits/leave are self-reversing trivial state (§4.11 matrix row)                            |
| `setAutoPin` (`pinned_by='auto'`)             | additive, invisible, "no journal" (§4.9b)                                                   |
| `upsertCentroid`, `deleteCentroids`           | derived math cache, never user-visible state (§4.9c)                                        |
| `upsertMergeSuggestion`, `setSuggestionState` | proposal plumbing; the merge CONFIRM is journaled by the caller as the merge command (§4.4) |
| `addTombstone`                                | written inside the permanent-delete TX, not standalone (§4.9 pass 4)                        |
| `deleteCollectionPermanent`                   | NO inverse exists (trash-parity, §4.11 matrix); see §2.4                                    |

### 2.2 Main Methods — collections

Row shape returned by reads (domain-shaped per repository-contract rule 2):
`{ id, ownerId, name, nameLocked, origin, status, definition, publishMode, pinned,
pinnedBy, archivedAt, lastMemberChangeAt, createdAt, updatedAt }`.

| Method                      | Signature                                                     | Description                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getCollection`             | (collectionId) => Promise\<row \| null\>                      | Single-row read by id (any status; ACL rendering is the service's job).                                                                                                                                                                                                                                                                           |
| `listForUser`               | (userId, { sort, status }?) => Promise\<row[]\>               | Owner's collections + granted collections. `sort ∈ activity\|name\|created\|updated` in SQL; `status` filter defaults to `active`.                                                                                                                                                                                                                |
| `listArchived`              | (ownerId) => Promise\<row[]\>                                 | `status='archived'` for `__archive__` (order = `archived_at DESC`).                                                                                                                                                                                                                                                                               |
| `existsActiveName`          | (ownerId, name) => Promise\<boolean\>                         | Partial-unique probe (`(owner,name)` active, §3.1); drives the caller's suffix-counter retry (DEF-16 precedent).                                                                                                                                                                                                                                  |
| `createCollection`          | (input, ctx) => Promise\<row\>                                | JOURNALED. INSERT; `origin ∈ system\|user\|seed\|search`, `publishMode` default `ask`. `ctx = { actor, actionId? }` passed to commitChange.                                                                                                                                                                                                       |
| `renameCollection`          | (collectionId, name, { lockName }?, ctx) => Promise\<row\>    | JOURNALED. Sets `name_locked=true` when `lockName` (user rename, §3.2).                                                                                                                                                                                                                                                                           |
| `setPinned`                 | (collectionId, pinned, ctx) => Promise\<{ changes }\>         | JOURNALED. User pin/unpin only (writes `pinned`; `pinned_by='user'` on pin).                                                                                                                                                                                                                                                                      |
| `setAutoPin`                | (collectionId) => Promise\<{ changes }\>                      | `pinned=true, pinned_by='auto'`; no-op when already pinned; ONLY for `origin='system'` rows. NON-JOURNALED (§4.9b).                                                                                                                                                                                                                               |
| `archiveCollection`         | (collectionId, { actor }?, ctx) => Promise\<{ changes }\>     | JOURNALED. `status='archived'`, `archived_at=now()`. Used by both user archive and evolution pass 3.                                                                                                                                                                                                                                              |
| `restoreCollection`         | (collectionId, ctx) => Promise\<{ changes }\>                 | JOURNALED. `status='active'`, clears `archived_at`.                                                                                                                                                                                                                                                                                               |
| `deleteCollectionPermanent` | (collectionId, { defFingerprint }?) => Promise\<{ changes }\> | NOT journaled (no inverse, §4.11): single TX under the subject lock — DELETE row (cascades items/exclusions/grants/visibility/centroids/cursors/suggestions) + INSERT `collection_tombstones` when `defFingerprint` given (system-origin only, invariant 10) + `actionJournalStore.purgeSubject('collection', 'collection:<id>')` in the same TX. |
| `touchMemberChange`         | (collectionId) => Promise\<{ changes }\>                      | Bumps `last_member_change_at=now()`; called inside item/exclusion mutators (stored side) and by the definition engine after derived evaluation (service side). NON-JOURNALED (rides inside journaled TXs otherwise).                                                                                                                              |

### 2.3 Main Methods — membership (items ∪ derived − exclusions)

| Method            | Signature                                                                      | Description                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listStoredItems` | (collectionId, { since }?) => Promise\<itemRow[]\>                             | `{ collectionId, nodeId, addedBy, published, createdAt }`; optional `created_at > since` for stored-side digests (§4.8).                                                               |
| `getStoredItem`   | (collectionId, nodeId) => Promise\<itemRow \| null\>                           | Single membership probe.                                                                                                                                                               |
| `addItem`         | (collectionId, nodeId, addedBy, { published }?, ctx) => Promise\<{ changes }\> | JOURNALED. Idempotent INSERT (PK pair, ON CONFLICT DO NOTHING → `changes: 0`); default `published=true` for owner-added rows.                                                          |
| `removeItem`      | (collectionId, nodeId, ctx) => Promise\<{ changes }\>                          | JOURNALED. Removes MEMBERSHIP ONLY — never trashes the node (§3.2).                                                                                                                    |
| `listExclusions`  | (collectionId) => Promise\<nodeId[]\>                                          | Exclusion set for the read path.                                                                                                                                                       |
| `isExcluded`      | (collectionId, nodeId) => Promise\<boolean\>                                   | Single probe.                                                                                                                                                                          |
| `addExclusion`    | (collectionId, nodeId, ctx) => Promise\<{ changes }\>                          | JOURNALED. Applies to derived members only ("block for this definition", §3.2); triggers `setAutoPin` inside the same TX when the collection is `origin='system'` (exclusion = touch). |
| `removeExclusion` | (collectionId, nodeId, ctx) => Promise\<{ changes }\>                          | JOURNALED.                                                                                                                                                                             |
| `listForNodes`    | (userId, nodeIds) => Promise\<{ nodeId, collectionId }[]\>                     | Membership-chip read (`POST /api/collections/for-nodes`, DEF-25): stored items of the user's visible collections.                                                                      |

**Derived membership is NOT resolved here.** The definition engine (collections service)
reads `getCollection().definition` + exclusions and evaluates predicates/vector rules; this
store only supplies `listStoredItems`, `listExclusions`, `getCollection`,
`touchMemberChange`. Member-row render states (normal / revoked / trashed / purged) and
join-time ACL are service-layer concerns (precedent `enrichRecentEntry`).

### 2.4 Main Methods — sharing, visibility, cursors, centroids, tombstones, suggestions

| Method                    | Signature                                                                                 | Description                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listGrants`              | (collectionId) => Promise\<grantRow[]\>                                                   | `{ collectionId, granteeId, role, grantedBy, createdAt }`; role `viewer\|editor`.                                                                                                                                                             |
| `getGrant`                | (collectionId, granteeId) => Promise\<grantRow \| null\>                                  | Single probe (live-resolution reads, §4.7).                                                                                                                                                                                                   |
| `grantAccess`             | (collectionId, granteeId, role, grantedBy, ctx) => Promise\<{ changes }\>                 | JOURNALED. UPSERT on PK `(collection_id, grantee_id)` — role change replaces in place. NEVER read or written by file-ACL code (invariant 1).                                                                                                  |
| `revokeAccess`            | (collectionId, granteeId, ctx) => Promise\<{ changes }\>                                  | JOURNALED. Instant (§4.7); payload notes restore-future-only semantics.                                                                                                                                                                       |
| `setVisible`              | (userId, collectionId, hidden) => Promise\<{ changes }\>                                  | `collection_visibility` upsert — `leave` is a local hidden flag (§4.7). NON-JOURNALED.                                                                                                                                                        |
| `isHiddenFor`             | (userId, collectionId) => Promise\<boolean\>                                              | Visibility filter at list read time.                                                                                                                                                                                                          |
| `getDigestCursor`         | (userId, collectionId) => Promise\<isoString \| null\>                                    | `collection_digest_cursors.last_visited_at`.                                                                                                                                                                                                  |
| `upsertDigestCursor`      | (userId, collectionId, lastVisitedAt) => Promise\<{ changes }\>                           | PK-pair upsert; drives `+N/-M` digest counts together with `listStoredItems(since)` and `last_member_change_at` (§4.8). NON-JOURNALED.                                                                                                        |
| `recomputeActivityScores` | (collectionIds?) => Promise\<{ changes }\>                                                | Σ member item-accumulator scores (`node_activity.score`) → `collections.activity_score` (§3.4). Called by the nightly rollup (maintenanceScheduler §3.1) and on every membership mutation (alongside `last_member_change_at`). NON-JOURNALED. |
| `getCentroids`            | (collectionIds, modelId) => Promise\<{ collectionId, modelId, centroid, memberCount }[]\> | Batch read of `collection_centroids` — `similar` sort grouping (service JS over ≤20 rows, §3.1) and merge PREFILTER only (never grounds, §4.9c).                                                                                              |
| `upsertCentroid`          | (collectionId, modelId, centroid, memberCount) => Promise\<{ changes }\>                  | PK `(collection_id, model_id)` upsert; model-keyed so a stale-space centroid never mixes into new-space math (§4.20). NON-JOURNALED.                                                                                                          |
| `deleteCentroids`         | (collectionId) => Promise\<{ changes }\>                                                  | Purge/rebuild support.                                                                                                                                                                                                                        |
| `isTombstoned`            | (ownerId, defFingerprint) => Promise\<boolean\>                                           | Blocks silent regeneration of the same definition (§4.9 pass 4, invariant 10).                                                                                                                                                                |
| `listTombstones`          | (ownerId) => Promise\<{ defFingerprint, deletedAt }[]\>                                   | Evolution-pass dedupe scan.                                                                                                                                                                                                                   |
| `purgeExpiredTombstones`  | (cutoff) => Promise\<{ changes }\>                                                        | GC: `deleted_at < cutoff` (lifetime = `ARCHIVE_RETENTION_DAYS`, Q1). GC calls, non-journaled.                                                                                                                                                 |
| `upsertMergeSuggestion`   | (aId, bId, score) => Promise\<row \| null\>                                               | `collection_merge_suggestions` INSERT ON CONFLICT DO NOTHING (UNIQUE(a,b)); pair normalized `aId < bId` before the write. Returns existing row on conflict, else the new row.                                                                 |
| `listMergeSuggestions`    | (collectionIds?) => Promise\<suggestionRow[]\>                                            | `state='pending'` (default) for the in-context card (§4.4); optional pair-scope filter.                                                                                                                                                       |
| `setSuggestionState`      | (suggestionId, state) => Promise\<{ changes }\>                                           | `pending → merged\|dismissed\|rejected`; stamps `dismissed_at` / `rejected_at` accordingly. State machine guarded (`changes: 0` on illegal transition).                                                                                       |

### 2.5 Sort and list semantics

- `activity` (sidebar default, §3.1): `ORDER BY activity_score DESC, last_member_change_at
DESC, created_at DESC`. **Decision (owner, 2026-09-22 — supersedes the prior
  timestamp-only ordering):** the card list IS activity-score ordered (§3.4);
  `last_member_change_at` → `created_at` remain as tie-breaker AND graceful fallback
  while `activity_score` is absent/all-zero (pre-rollup data).
- `name`: locale-unaware `ORDER BY name` (both dialects); `created`/`updated`: timestamps.
- `similar` is not a SQL sort: service fetches the list and groups by centroid nearest-
  neighbor in JS (§3.1, ≤~20 rows) using `getCentroids`.

### 2.6 Transaction boundaries

- Every journaled mutator: `lockManager` lock + `executor.transaction`
  (mutation writes + journal INSERT) — owned by `commitChange`, never re-opened here
  (executor rule 3: transactions must not nest).
- Reads: no explicit TX.
- `deleteCollectionPermanent`: TX + subject lock constructed directly (no commitChange —
  there is no inverse to record; the same TX purges the subject's journal rows, invariant 10).

### 2.7 Error contracts

- Reads of missing rows → `null` / `[]` (never throw).
- Guarded UPDATEs on missing/illegal rows → `{ changes: 0 }`.
- Unique/partial-unique/FK violations surface as `mapDatabaseError`-mapped errors at the
  repository boundary (route level maps to `serverErrors.collections.*`); duplicate-active-
  name on `createCollection`/`renameCollection` is the caller's suffix-retry signal
  (`existsActiveName` + pre-check pattern, repository-contract rule 4).
- No `getBackend()` branching outside the repository twins (CI grep-gate; stores and
  `domains/(collections|ai)/**` carry zero `CacheAdapter`/`operationProgress` imports —
  CODING_STYLE.md Express Patterns).

### 2.8 Dependencies

- `storage.getExecutor()` + `CollectionsRepository` (+ twins)
- `actionJournalStore` (`commitChange`, `purgeSubject`)
- `infrastructure/lockManager` (indirectly via commitChange; directly for permanent delete)

### 2.9 Verification Scenarios

- [ ] create/rename/archive/restore/pin/addItem/removeItem/addExclusion/removeExclusion/publish/grant/revoke each produce exactly one `action_journal` row in the SAME TX: a mutation that throws leaves NO journal row, and a forced journal failure rolls the mutation back
- [ ] batch addItem over 3 nodes (one command) writes 3 item rows + 1 command journal row whose payload carries 3 item-level inverses
- [ ] `addItem` is idempotent on the PK pair (second call → `changes: 0`, no duplicate, no journal row content change — the duplicate command still records its own row with an inverse that no-ops)
- [ ] `removeItem` deletes membership only — the `file_nodes` row is untouched
- [ ] `addExclusion` on a `origin='system'` collection also sets `pinned_by='auto'`; on `origin='user'` it does not touch `pinned`
- [ ] View composition sanity: for a stored collection, read path returns `stored − exclusions`; for a derived one, the service gets `exclusions` and empty `stored` from the lookups above
- [ ] Name uniqueness: insert `(owner,'X')` while another ACTIVE 'X' exists → conflict raised; an ARCHIVED 'X' with the same name does not conflict (partial index); `existsActiveName` reflects exactly this
- [ ] `deleteCollectionPermanent`: row + items + exclusions + grants + visibility + centroids + cursors + merge-suggestion rows gone (FK CASCADE); tombstone present when fingerprint given; prior journal rows for `collection:<id>` purged; second call → `changes: 0`
- [ ] `upsertCentroid` with a different `modelId` creates a second PK entry, does not overwrite the old-space row
- [ ] `grantAccess` twice with different roles replaces the role (single PK row); `collection_grants` is invisible to `permissionStore`/`aclService` reads (invariant 1 — integration check in the permissions suite)
- [ ] `setVisible(hidden=true)` removes the collection from `listForUser` for that user only; `upsertDigestCursor` round-trips `getDigestCursor`
- [ ] `upsertMergeSuggestion(2,1)` and `upsertMergeSuggestion(1,2)` yield ONE row (pair normalization)
- [ ] `setSuggestionState` rejects `merged → pending` (`changes: 0`)
- [ ] L2 conformance (`CollectionsRepository.conformance.test.js`) on real sqlite (`test:ci`) AND real PostgreSQL (`test:ci:pg:adapters`): PK/CASCADE semantics, partial-unique `(owner_id,name)` active-scoping, `activity`-sort (`activity_score` desc +
      tie-breaker chain) ordering parity, JSONB (PG) vs TEXT (sqlite) `definition` round-trip, ON CONFLICT idempotency parity
- [ ] Facade parity: no SQL text in `collectionsStore.js`; all mutators route through the repository + commitChange (grep assertion)

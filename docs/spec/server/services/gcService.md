# gcService & failSafeService Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Background maintenance services for the S3+PostgreSQL (and S3+SQLite) architecture. `gcService` reclaims orphaned blobs via a two-tier strategy; `failSafeService` scans and repairs `file_nodes` rows stuck in `sync_status='orphaned_node'`. |
| Depends on | Phase 2 services (`fileNodeService`, `fileNodesStore`, blob store adapters), Phase 0 schema (`object_map`, `file_nodes`)                                                                                                                       |
| Files      | `server/service/gcService.js`, `server/service/failSafeService.js`                                                                                                                                                                             |
| Test files | `server/service/__tests__/gcService.test.js`, `server/service/__tests__/failSafeService.test.js`                                                                                                                                               |

Both services are pure background/ops concerns — they expose no user-facing file behavior. They are only reachable via admin maintenance endpoints or the optional cron/startup hooks.

---

## 2. GC Strategy

Three-tier cleanup organized around **retention categories**. All tiers execute inside a single GC
cycle in order: Tier 1 (fast, DB-targeted, category-aware), Tier 2 (slower, storage-scan — S3
`ListObjectsV2` or WebDAV recursive listing — reconciling the ACTIVE backend against a keep-set
assembled per mode), Tier 3 (trash-retention purge, DEF-16 P5 — reclaims trashed nodes whose
retention expired; rides the same `GC_INTERVAL_MS` schedule as the other tiers, no new scheduler).

### Retention categories (Tier 1)

Categories are **derived by query** from the orphaned row's surrounding state (node sync status + presence of an active row) — they are not new `object_map.status` values. With DEF-11's managed-history model, `object_map.status='history'` marks a managed prior version and `orphaned` means **"evicted version"** (a former `history` row demoted by `evictVersionsBeyondCap`, or legacy residue): history rows are **never** GC targets — `getOrphanedObjectsWithNodeState` queries `status='orphaned'` only, so a `history` row survives any `olderThanDays`, and the keep-set carries a `history` arm.

| Category       | Definition (orphaned row where…)                                                                                                                                                                                                                                                                                                                 | Policy                                                                                                               | Config                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `garbage`      | The node is gone (LEFT JOIN `file_nodes` misses)                                                                                                                                                                                                                                                                                                 | Blob deleted (per-row `storage_backend` guard), then row deleted                                                     | `GC_ORPHAN_TTL_DAYS` (default 1)                  |
| `version`      | Any other orphaned row — i.e. an **evicted version** (`orphaned`, node live/pending_upload with an active row) or an orphan on an `orphaned_node` node. `GC_VERSION_TTL_DAYS` is the **eviction grace period**: the clock stays `created_at` (upload time), so an old upload's row evicted today is deleted at the first GC cycle after eviction | Blob deleted (per-row `storage_backend` guard), then row deleted                                                     | `GC_VERSION_TTL_DAYS` (default 1)                 |
| `guarded`      | The node is `pending_upload` **and** has no `active` object_map row (the stuck-overwrite state)                                                                                                                                                                                                                                                  | **Exempt** from deletion while the guard holds (last-good guard); counted in the report, never deleted while guarded | — (state-derived; no TTL)                         |
| `pending-live` | `status='pending'` row on a `pending_upload` node older than the stale cutoff (additive cleanup; nothing cleans these rows today)                                                                                                                                                                                                                | Blob deleted (per-row `storage_backend` guard), then row deleted — blob-first-then-rows like Tier 1                  | `GC_PENDING_STALE_DAYS` (default 3; `0` disables) |
| `trash`        | `object_map` rows on nodes with `deleted_at` set — NOT a Tier 1 target: a trashed node's active row stays in the keep-set and its versions stay `history`, so trash content survives the whole trash period and dies only at Tier 3 / the trash purge routes                                                                                     | keep (Tier 3 purges the whole trashed subtree when the retention expires)                                            | `TRASH_RETENTION_DAYS` (default 30; `0` disables) |

- **Last-good guard** (`guarded`): an orphaned row on a stuck `pending_upload` node with no active row is the node's last remaining good blob; deleting it would make the stuck file permanently undownloadable. It is exempt from Tier 1 deletion while the guard condition holds. With the DEF-11 history model a stuck node's last-good row is `history` — which never enters the Tier-1 query, so it is inherently safe and `guardedRows` does not count it; the orphaned-branch is kept defensively for legacy residue (DEF-11 pre-migration rows).
- **Pending-live cleanup**: strictly additive — `pending` rows on `pending_upload` nodes (the stuck-overwrite residue) are deleted together with their blobs after `GC_PENDING_STALE_DAYS`.
- **Empty set today**: with FK cascade, `garbage`-category rows (node gone) cannot exist; the category is still part of the classification flow for defense in depth.

### Keep-set widening (Tier 2)

Tier 2 reconciles the **ACTIVE backend** against `fileNodesStore.getKeptKeys(fileStorageMode)`. In S3 mode the seam narrows to `getKeptObjectMapKeys()` — the UNION of **active ∪ history ∪ version ∪ pending-live** keys — instead of the active-only set. `history` rows (managed prior versions) are protected unconditionally; `version` means every orphaned (evicted) row not yet expired by Tier 1 (Tier-1-first ordering expires rows before Tier 2 runs, so no age filters are applied in the keep-set query). No trash arm exists in the S3 keep-set (trashed nodes keep their object_map rows until Tier 3). At the default TTLs the outcome is identical to the historical active-only behavior **except** the intended deviations: (1) a guarded last-good row and its blob are kept, (2) a stuck node's pending blob is kept until the pending-stale cutoff, (3) `history` rows and their blobs are kept until cap eviction demotes them.

### WebDAV mode

Tier 1 in WebDAV mode follows the same category rules; the `deleteBlob` call is skipped **per row** when the row's `storage_backend` (default `'s3'`) differs from the active backend — a preserved `s3_key` on a migrated row is a UUID rollback marker, not a webdav path (and symmetrically, an S3-mode cycle must never delete a `webdav`-backend row's blob; see §3.1). Rows are still cleaned in both directions. **Tier 2 reconciles the ACTIVE WebDAV backend — it is no longer skipped.** Candidates are all files AND directories under the DAV root (recursive listing; `lastmod` age filter). The keep-set is assembled by `getKeptKeys('webdav')` from the `file_nodes` projection: (i) display paths of every LIVE node — files AND directories (the directory paths, stored with a trailing slash, give the ancestor-bias protection below), (ii) `/.wea-trash/<id>` for EVERY node row with `deleted_at` set (not only the topmost ones — nested trash rows stay protected even though their physical path lives under their root's trash entry), (iii) `/.wea-tmp/<id>` while the node exists AND (`deleted_at` set OR `sync_status='orphaned_node'`) — a healthy node's tmp snapshot is stale and reclaimable, (iv) structural roots `/`, `/.wea-trash`, `/.wea-tmp` (bare — they never trigger the ancestor bias). **Safety biases:** (S1) a candidate whose any ANCESTOR directory path is in the keep-set is only REPORTED (`untrackedKeys`), never deleted — protects in-flight subtree materialization and foreign content living inside live trees; (S2) the age cutoff comes from `GC_ORPHAN_TTL_DAYS`; (S3) deletions run bottom-up (deepest path first) so a collection's children are removed before the collection itself; per-item best-effort errors as today. `skipped = true` now only when the injected store lacks `listOrphanedKeys` (NoOp/test stores). Tier 1 still finds orphaned `object_map` rows in WebDAV mode (e.g. legacy/out-of-band rows, or superseded rows after a migration) and removes them from the DB. **Tier 3 in WebDAV mode deletes the remote trash paths** (`/.wea-trash/<nodeId>`) — that is where the trash MOVE parked the content — then removes the DB rows (see §3.1, Tier 3 algorithm).

### GC cycle lifecycle (per file mutation)

1. Upload new version → INSERT `object_map` (status=`pending`); the previous active row is demoted to `status='history'` and the per-node cap evicts the oldest history rows to `orphaned` (`blobStorageService.prepareUpload`, same TX)
2. S3 PUT succeeds → UPDATE status=`active`
3. GC service classifies orphaned rows (`garbage` / `guarded` / `version`), deletes expired rows + corresponding S3 blobs after TTL, and cleans stale pending rows (`pending-live`)

---

## 3. Implementation Spec

### 3.1 `createGcService({ blobStore, fileNodesStore, fileStorageMode, gcConfig, trashService })`

Factory function following the DI pattern used by the other Phase 2 services.

| Param             | Type   | Default                                                        | Description                                                                                                                                                                                                                 |
| ----------------- | ------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blobStore`       | object | —                                                              | S3BlobStore or WebdavBlobStore adapter                                                                                                                                                                                      |
| `fileNodesStore`  | object | —                                                              | fileNodesStore with object_map queries                                                                                                                                                                                      |
| `fileStorageMode` | string | `'s3'`                                                         | `'s3'` or `'webdav'`; selects the backend Tier 2 reconciles (`getKeptKeys(mode)` + `blobStore.listOrphanedKeys`); gates Tier 1 blob deletes per row by `storage_backend` match                                              |
| `gcConfig`        | object | `{ orphanTtlDays: 1, versionTtlDays: 1, pendingStaleDays: 3 }` | TTL overrides; each key defaults from its `GC_*` env key (`GC_ORPHAN_TTL_DAYS`, `GC_VERSION_TTL_DAYS`, `GC_PENDING_STALE_DAYS`) when not provided — same precedence idiom for all three (gcConfig → DB resolver → fallback) |
| `trashService`    | object | —                                                              | trashService instance (`server/service/trashService.js`) providing the shared purge core `purgeNode(nodeId)`; Tier 3 delegates each expired trashed root's physical purge to it. Composition injects the real instance.     |

> **Resolver 0-semantics note:** the gcService TTL resolvers treat `0` as "disabled" (pending-live, trash retention) and otherwise floor at 1. This differs from `GC_VERSION_MAX_PER_NODE` (DEF-11), where `0` means **unbounded** — that key is resolved by `blobStorageService.prepareUpload` (per-call, shared resolver), not here; do not "normalize" the two conventions.

#### `runGcCycle({ olderThanDays })`

Runs Tier 1, Tier 2, then Tier 3 and returns a summary. `olderThanDays` defaults to the configured TTL.

| Param         | Type   | Required | Description                                                                |
| ------------- | ------ | -------- | -------------------------------------------------------------------------- |
| olderThanDays | number | no       | Only orphans older than this many days are collected (default: config TTL) |

**Returns:**

```js
{
  tier1: {
    orphanedRows: number,      // object_map rows found
    deletedBlobs: number,      // blobs successfully deleted (only on rows whose storage_backend matches the active mode; includes stale-pending blobs)
    deletedRows: number,       // object_map rows removed from DB (orphaned + stale pending)
    guardedRows: number,       // orphaned rows exempt via the last-good guard (counted, not deleted)
    pendingDeletedRows: number, // stale pending rows deleted (their blobs fold into deletedBlobs)
    errors: string[],
  },
  tier2: {
    scannedKeys: number,    // candidate keys returned by listOrphanedKeys
    untrackedKeys: number,  // candidates with no reference in the keep-set (WebDAV: includes ancestor-biased report-only keys)
    deletedKeys: number,    // keys actually deleted (bottom-up; never exceeds untrackedKeys)
    skipped: boolean,       // true only when the injected blobStore exposes no listOrphanedKeys (NoOp/test stores)
    errors: string[],
  },
  tier3: {
    purgedNodes: number,    // trashed roots physically purged (their whole subtree dies with each root)
    deletedBlobs: number,   // physical blob deletes (S3 per-row keys; WebDAV trash-path deletes count as one per deleted path)
    deletedRows: number,    // DB rows removed (subtree sizes)
    skipped: boolean,       // true when TRASH_RETENTION_DAYS is 0 (retention off)
    errors: string[],       // per-node purge failures, collected — never aborting the cycle
  }
}
```

**Tier 1 algorithm:**

1. `fileNodesStore.getOrphanedObjectsWithNodeState(olderThanDays)` → orphaned rows annotated with `node_sync_status` and `has_active` (LEFT JOIN `file_nodes` + EXISTS active-row subquery).
2. Classify each row:
   - **`guarded`**: node is `pending_upload` and `has_active` is false → exempt; counted in `guardedRows`, never deleted while the guard holds.
   - **`garbage`**: node gone (LEFT JOIN miss) → collect with `orphanTtlDays`.
   - **`version`**: everything else — i.e. evicted versions on live nodes, orphans on `pending_upload` nodes with an active row, and orphans on `orphaned_node` nodes → collect with `versionTtlDays`.
3. For each collected row with a non-null `s3_key`: `blobStore.deleteBlob(s3_key)` — **blob-first-then-rows**; count successes, collect errors. **Per-row `storage_backend` guard:** skip the `deleteBlob` call when the row's `storage_backend` (default `'s3'`) differs from the active `fileStorageMode` — a preserved `s3_key` on a migrated webdav row is a UUID rollback marker, not a webdav path, and symmetrically an S3-mode cycle must never path-address a foreign row. The DB row is still deleted.
4. `fileNodesStore.deleteObjectMapRows(ids)` for every collected orphaned row id (runs in WebDAV mode too).
5. **Pending-live cleanup:** `fileNodesStore.getStalePendingObjects(pendingStaleDays)` → `pending` rows on `pending_upload` nodes older than the cutoff (`0` disables this step). Delete blobs first, then rows; `pendingDeletedRows` counts the rows removed and their blob deletions fold into `deletedBlobs`.
6. `deletedRows` reflects rows removed from `object_map` (orphaned + stale pending).

**Tier 2 algorithm (active backend; `skipped=true` only when the injected store exposes no `listOrphanedKeys`):**

1. Convert the day-based threshold to a Date cutoff: `olderThan = new Date(Date.now() - days * 86400000)`.
2. `blobStore.listOrphanedKeys(olderThan)` → candidate keys (S3 `LastModified < olderThan`).
3. `fileNodesStore.getKeptKeys(fileStorageMode)` → keep-set. S3 mode: the UNION (active ∪ history ∪ version ∪ pending-live) `s3_key` set. WebDAV mode: the path set per §2 (live display paths with directory entries trailing-slashed, every trashed row's `/.wea-trash/<id>`, tmp paths for trashed/`orphaned_node` rows, bare structural roots).
4. Diff → keys present only in S3 → `blobStore.deleteBlob(key)`.

Tier 1 always runs; in WebDAV mode it finds no rows during normal operation, but when orphaned rows do exist (legacy/out-of-band rows, or superseded rows after a migration) it removes them from the DB, deleting blobs only on rows whose `storage_backend` matches. Tier 2 in WebDAV mode additionally applies the safety biases (S1 ancestor-keep → report-only, S2 age cutoff, S3 bottom-up deletes). All tiers are best-effort: per-key/per-node errors are collected in `errors` and do not abort the cycle.

**Tier 3 algorithm (trash-retention purge, DEF-16 P5; rides `GC_INTERVAL_MS` — no new scheduler):**

1. Resolve the trash retention: `gcConfig.trashRetentionDays` → `TRASH_RETENTION_DAYS` (DB resolver) → default **30**. `0` = retention off → `tier3.skipped = true`, zero counts, no work (mirrors `resolvePendingStaleDays`).
2. `fileNodesStore.getTopmostTrashedNodes(retentionDays)` → the TOPMOST trashed rows (parent live-or-NULL) whose `deleted_at` is older than the cutoff; their whole subtrees die with each root, so nested trashed rows are never enumerated separately.
3. For each expired root: `trashService.purgeNode(nodeId)` — the shared physical purge core (WebDAV: remote delete at the trash path `/.wea-trash/<nodeId>` first; S3: `deleteBlob` for EVERY object_map row of the subtree — active + history + orphaned; then the DB hard delete + FK cascade). Per-node try/catch: a failure is pushed to `tier3.errors` and the loop continues.
4. Additive counters: `purgedNodes` (roots purged), `deletedBlobs` (physical deletes from the purge core results), `deletedRows` (DB rows removed), `errors`. The Tier 1/Tier 2 report shapes are untouched (additive only).

### 3.2 `createFailSafeService({ fileNodeService, fileNodesStore, blobStore, fileStorageMode })`

Factory for `sync_status='orphaned_node'` detection and manual repair, plus the S3-mode-only `pending_upload` scan/repair (DEF-12/13; contract: `uploadService.md` §2.5.1).

| Param             | Type   | Description                                                                                                       |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `fileNodeService` | object | fileNodeService (tree ops: deleteNode, getNode, getNodePath, updateSyncStatus)                                    |
| `fileNodesStore`  | object | fileNodesStore with `getNodesBySyncStatus`                                                                        |
| `blobStore`       | object | blob store adapter (`headBlob`/`deleteBlob`) for remote existence checks and blob cleanup                         |
| `fileStorageMode` | string | `'s3'` (default) or `'webdav'`; the `pending_upload` scan/repair is gated to S3 mode (refused 409 in WebDAV mode) |

#### `scanOrphanedNodes()`

Returns every node with `sync_status='orphaned_node'`, enriched with its display path.

**Returns:** `Array<{ nodeId, name, type, path, createdAt, updatedAt }>`

#### `repairNode(nodeId, { action })`

Resolves a single stuck node.

| Param  | Type   | Required | Description                                                                                            |
| ------ | ------ | -------- | ------------------------------------------------------------------------------------------------------ |
| nodeId | number | yes      | file_nodes.id to repair                                                                                |
| action | string | yes      | `'retry-delete'` (force-remove node + subtree from DB) or `'force-active'` (mark sync_status='active') |

**Returns:** `{ nodeId, action, status: 'resolved', path, detail }`

- `action='retry-delete'`: validates the node exists, calls `fileNodeService.deleteNode(nodeId)` (removes subtree + ancestor rows). The corresponding blob, if any, is left for Tier 2 GC if it is no longer referenced.
- `action='force-active'`: `fileNodeService.updateSyncStatus(nodeId, 'active')`; accepts an admin decision that the DB row matches storage state.

**Errors:** unknown node → throws notFound; unknown action → throws validation error.

#### `runStartupRecovery()`

Startup hook (Task 6.3). Scans orphaned nodes and returns a report. It never performs destructive actions automatically — stuck nodes are surfaced for manual review via `repair-sync`. This prevents accidental data loss on boot.

**Returns:** `{ scanned: number, resolved: number, manualReview: Array<{ nodeId, path }>, pendingUpload: { scanned: number, nodes: Array, error?: string } }` — the `pendingUpload` section delegates to `scanPendingUploadNodes()` (S3 mode only; empty in WebDAV mode) and is strictly report-only: zero mutations, stuck nodes are surfaced for manual review via `repair-sync`.

---

## 4. Repository Additions (`server/store/repositories/FileNodeRepository.js`)

New methods required by the services. The `fileNodesStore` facade forwards them unchanged to
`FileNodeRepository`; each method's dialect SQL lives in the repository twins
(`server/store/repositories/sqlite/FileNodeRepository.sqlite.js` /
`server/store/repositories/postgres/FileNodeRepository.postgres.js`), executed through the executor seam:

| Method                                           | Query                                                                                                                                                                                                  | Returns          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `getOrphanedObjectsWithNodeState(olderThanDays)` | orphaned rows older than cutoff, LEFT JOIN `file_nodes` (node sync status) + EXISTS active-row subquery → rows annotated with `node_sync_status` and `has_active`                                      | annotated rows[] |
| `getStalePendingObjects(staleThanDays)`          | `status='pending'` rows older than cutoff whose node is `pending_upload`                                                                                                                               | rows[]           |
| `getKeptObjectMapKeys()`                         | active ∪ **history** ∪ orphaned (evicted version) ∪ pending-on-pending_upload-node UNION; no trash arm, no age filters                                                                                 | string[]         |
| `getFileNodesPathRows()`                         | `SELECT id, parent_id, name, type, deleted_at, sync_status FROM file_nodes` — projection for the facade's WebDAV keep-set path materialization (JS assembly in `fileNodesStore`, no dialect recursion) | rows[]           |
| `getVersionsByNode(fileNodeId)`                  | `SELECT * FROM object_map WHERE file_node_id=? AND status IN ('active','history') ORDER BY version_number DESC` — versions browse read model (DEF-11)                                                  | rows[]           |
| `evictVersionsBeyondCap(fileNodeId, cap)`        | oldest-first (`version_number` ASC) demotion of `history` rows to `'orphaned'` while `active + history > cap`; `cap<=0` = unbounded no-op; active row untouched                                        | `{ changes }`    |
| `demoteActiveToHistory(s3Key)`                   | `UPDATE object_map SET status='history' WHERE s3_key=? AND status='active'` — restore-TX primitive (the demoted current version becomes history, not orphaned)                                         | `{ changes }`    |
| `reactivateObjectMapRow(id)`                     | flips a captured pre-state `history`/`orphaned` row back to `active` (overwrite rollback + version restore; guard widened by DEF-11) — see `fileNodesStore.md` §2.4                                    | `{ changes }`    |
| `deleteObjectMapRows(ids)`                       | `DELETE FROM object_map WHERE id IN (...)`, SQLite branch per-row via `executor.run` in the sqlite dialect twin                                                                                        | `{ changes }`    |
| `getNodesBySyncStatus(status)`                   | `file_nodes WHERE sync_status = ?`                                                                                                                                                                     | rows[]           |
| `getTopmostTrashedNodes(olderThanDays?)`         | trashed rows (`deleted_at IS NOT NULL`) whose parent is live-or-NULL (LEFT JOIN parent), optional `deleted_at < cutoff` filter — the Tier 3 enumeration (topmost only; subtrees die with their roots)  | rows[]           |
| `getObjectMapBySubtree(ancestorId)`              | all `object_map` rows of a subtree via the closure join (any status — the S3 purge deletes active + history + orphaned + pending keys)                                                                 | rows[]           |
| `getObjectMapByNode(fileNodeId)`                 | all `object_map` rows of a node, newest-version first (repair preconditions) — see `fileNodesStore.md` §2.4                                                                                            | rows[]           |

All of the above are dual-backend (PostgreSQL / SQLite), implemented in the `FileNodeRepository` dialect twins behind the executor seam (no store-internal dialect branching in the service) and covered by the repository conformance tests.

---

## 5. Admin Integration

### 5.1 Routes (`server/domains/admin/routes/maintenance.js`)

| Method | Path                                 | Description                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/admin/maintenance/repair-sync` | Resolve one stuck node. Body: `{ nodeId, action: 'retry-delete' \| 'force-active' }` (`orphaned_node`) or `{ nodeId, action: 'complete' \| 'restore-previous' \| 'delete' \| 'auto' }` (`pending_upload` — S3 mode only, refused 409 otherwise). Response: `{ messageCode, result }`. Repair contract: `uploadService.md` §2.5.1. |

Requires `authenticateToken` + `isAdmin`. The manual `POST /api/admin/maintenance/gc` route was retired as dead code; GC cycles run via the scheduler (`GC_INTERVAL_MS`) and via `cleanupOrphanedData()` (§5.2).

### 5.2 cleanupService Integration

`cleanupOrphanedData()` gains three additive result keys (existing keys unchanged):

- `gc: { tier1, tier2, tier3 }` — result of one GC cycle. Both backends run all three tiers; WebDAV Tier 1 deletes blobs only on `storage_backend`-matching rows and Tier 2 reconciles the remote tree per §2.
- `orphanedNodes: [...]` — fail-safe report from `failSafeService.scanOrphanedNodes()`.
- `pendingUploadNodes: [...]` — read-only report of file nodes stuck in `sync_status='pending_upload'` (S3 mode only; empty in WebDAV mode — `uploadService.md` §2.5.1).

### 5.3 Startup Hook + Cron

- **Startup:** after metadata store init, `runStartupRecovery()` executes once and logs any nodes requiring manual review.
- **Cron:** when `GC_INTERVAL_MS` is a positive integer, `setInterval` runs `runGcCycle()` every interval. Default (unset/`0`) disables the schedule. A guard flag `WEA_SKIP_GC_SCHEDULER` (test seam) disables scheduling without changing production defaults.

---

## 6. Configuration

| Env                       | Default          | Description                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GC_INTERVAL_MS`          | unset (disabled) | GC cron interval in milliseconds; `0`/unset disables                                                                                                                                                                                                                                                                                                                     |
| `GC_ORPHAN_TTL_DAYS`      | `1`              | Minimum age in days before a `garbage`-category orphaned blob/row is collected                                                                                                                                                                                                                                                                                           |
| `GC_VERSION_TTL_DAYS`     | `1`              | Eviction grace period: minimum age in days before an evicted (`orphaned`) version row/blob is collected (DEF-11; clock is `created_at` = upload time, so an old upload evicted today is deleted at the first GC after eviction)                                                                                                                                          |
| `GC_PENDING_STALE_DAYS`   | `3`              | Minimum age in days before a `pending` row on a `pending_upload` node is deleted with its blob (`pending-live` cleanup); `0` disables                                                                                                                                                                                                                                    |
| `GC_VERSION_MAX_PER_NODE` | `10`             | Per-node version cap (DEF-11): while `active + history > N`, the oldest `history` rows are demoted to `orphaned` eagerly at overwrite time (`blobStorageService.prepareUpload` → `evictVersionsBeyondCap`, same TX) — the cap holds even with the scheduler off. **`0` = unbounded** (no eviction); note the opposite 0-semantics vs the `*_DAYS` keys above. T2/dbOnly. |
| `TRASH_RETENTION_DAYS`    | `30`             | Trash retention (DEF-16 P5): a trashed node is physically purged (subtree rows + blobs/trash paths) by GC Tier 3 once its `deleted_at` is older than this many days. **`0` = retention off** (Tier 3 skipped — trash keeps content until the user purges/restores). T2/dbOnly.                                                                                           |
| `WEA_SKIP_GC_SCHEDULER`   | unset            | Test seam; any truthy value disables cron scheduling                                                                                                                                                                                                                                                                                                                     |

---

## 7. Verification Scenarios

- [ ] Tier 1: orphaned rows + corresponding S3 mock entries are cleaned; active blobs untouched
- [ ] History rows are never GC targets: a `history` row aged 10d survives any `olderThanDays` (Tier 1 queries `orphaned` only) and its blob is never deleted by Tier 1 or Tier 2 (keep-set history arm)
- [ ] Eviction grace: an orphaned (evicted) version row on a live node is deleted together with its blob after `GC_VERSION_TTL_DAYS`
- [ ] Guarded row exempt: an orphaned row on a `pending_upload` node with no active row (`guarded`) is reported in `guardedRows` and NOT deleted (row + blob kept) while the node is unrepaired; a stuck node whose last-good row is `history` produces no `guardedRows` count and loses nothing
- [ ] Guard released: once the node leaves `pending_upload` (or gains an active row), the previously guarded row is classified `version` and deleted after `GC_VERSION_TTL_DAYS`
- [ ] Stale pending cleaned: a `pending` row on a `pending_upload` node older than `GC_PENDING_STALE_DAYS` is deleted together with its blob (blob-first-then-rows); `pendingDeletedRows` increments
- [ ] Fresh pending kept: a `pending` row younger than the stale cutoff is left untouched
- [ ] Tier 2 keep-set: a stuck node's pending blob older than the untracked TTL is preserved by the keep-set while the pending row is young; after `GC_PENDING_STALE_DAYS` cleanup removes the row, Tier 2 deletes the now-untracked blob
- [ ] Defaults reproduce the historical Tier-1 outcome for evicted (`orphaned`) version rows on live nodes — orphaned = evicted version (guarded exemption + the history arm are the intended deviations)
- [ ] Tier 2: keys present in S3 with no keep-set reference are detected and deleted; active and history keys preserved
- [ ] Freshly-created orphaned rows (younger than TTL) are left untouched
- [ ] WebDAV mode Tier 1: orphaned `object_map` rows follow the same category rules; `blobStore.deleteBlob` is NOT called for foreign-backend rows (`storage_backend` mismatch), rows-only otherwise; stale pending rows likewise — and S3 mode symmetrically never deletes a `webdav`-backend row's blob
- [ ] WebDAV Tier 2 reconciliation: unexplained files/directories below a fully-unkept tree and orphan `/.wea-trash`/`/.wea-tmp` entries are deleted bottom-up; live-node paths, every trashed row's trash path, tmp while trashed/orphaned_node, and young (< cutoff) candidates are kept; a candidate under a KEPT ancestor directory is REPORTED (`untrackedKeys`) but not deleted (S1)
- [ ] Tier 2 `skipped` only when the injected store lacks `listOrphanedKeys`; S3 regression behavior unchanged
- [ ] Tier 3: a trashed root older than `TRASH_RETENTION_DAYS` is purged — DB rows gone (whole subtree), S3 mode deletes every object_map blob of the subtree (active + history + orphaned), WebDAV mode deletes the `/.wea-trash/<nodeId>` trash path
- [ ] Tier 3: a freshly trashed root (younger than the cutoff) is kept untouched
- [ ] Tier 3: `TRASH_RETENTION_DAYS = 0` → `tier3.skipped = true`, no purges, no errors (retention off)
- [ ] Tier 3: report counts are additive (`tier1`/`tier2` shapes unchanged) and per-node purge failures are collected in `tier3.errors` without aborting the cycle
- [ ] Tier 3: a trashed node's version (`history`) rows die WITH the trash — their S3 blobs are deleted by the Tier 3 purge (never by Tier 1)
- [ ] `scanOrphanedNodes()` returns orphaned nodes with paths
- [ ] `repairNode('retry-delete')` removes the node + subtree; `repairNode('force-active')` flips sync_status
- [ ] Admin endpoints require auth + admin; non-admin receives 403
- [ ] Cron scheduling disabled when `GC_INTERVAL_MS` unset or `WEA_SKIP_GC_SCHEDULER` set

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

Two-tier cleanup organized around **retention categories**. Both tiers execute inside a single GC cycle; Tier 1 runs first (fast, DB-targeted, category-aware), Tier 2 follows (slower, S3 `ListObjectsV2`-based) against a widened keep-set.

### Retention categories (Tier 1)

Categories are **derived by query** from the orphaned row's surrounding state (node sync status + presence of an active row) — they are not new `object_map.status` values.

| Category     | Definition (orphaned row where…)                                                                   | Policy                                                            | Config                                        |
| ------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| `garbage`    | The node is gone (LEFT JOIN `file_nodes` misses)                                                   | Blob deleted (S3 mode), then row deleted                          | `GC_ORPHAN_TTL_DAYS` (default 1)              |
| `version`    | Any other orphaned row — including orphans on `pending_upload` nodes that still have an active row, and orphans on `orphaned_node` nodes (identical to historical behavior) | Blob deleted (S3 mode), then row deleted                          | `GC_VERSION_TTL_DAYS` (default 1)             |
| `guarded`    | The node is `pending_upload` **and** has no `active` object_map row (the stuck-overwrite state)    | **Exempt** from deletion while the guard holds (last-good guard); counted in the report, never deleted while guarded | — (state-derived; no TTL)                     |
| `pending-live` | `status='pending'` row on a `pending_upload` node older than the stale cutoff (additive cleanup; nothing cleans these rows today) | Blob deleted (S3 mode), then row deleted — blob-first-then-rows like Tier 1 | `GC_PENDING_STALE_DAYS` (default 3; `0` disables) |

- **Last-good guard** (`guarded`): an orphaned row on a stuck `pending_upload` node with no active row is the node's last remaining good blob; deleting it would make the stuck file permanently undownloadable. It is exempt from Tier 1 deletion while the guard condition holds. This is the **only Tier-1 deletion deviation** from the historical binary behavior.
- **Pending-live cleanup**: strictly additive — `pending` rows on `pending_upload` nodes (the stuck-overwrite residue) are deleted together with their blobs after `GC_PENDING_STALE_DAYS`.
- **Empty set today**: with FK cascade, `garbage`-category rows (node gone) cannot exist; the category is still part of the classification flow for defense in depth.

### Keep-set widening (Tier 2)

Tier 2 diffs S3 against `getKeptS3Keys()` — the UNION of **active ∪ version ∪ pending-live** keys — instead of the active-only set. `version` here means every orphaned row not yet expired by Tier 1 (Tier-1-first ordering expires rows before Tier 2 runs, so no age filters are applied in the keep-set query). No trash arm exists in the keep-set. At the default TTLs the outcome is identical to the historical active-only behavior **except** the two intended deviations: (1) a guarded last-good row and its blob are kept, (2) a stuck node's pending blob is kept until the pending-stale cutoff.

### WebDAV mode

Tier 1 in WebDAV mode follows the same category rules but deletes **rows only** — the `deleteBlob` call is skipped because a preserved `s3_key` on a migrated row is a UUID rollback marker, not a webdav path (see §3.1). Tier 2 stays skipped: in WebDAV mode the app's own writes create no `object_map` rows (the blob storage service skips them) and the WebDAV adapter's `listOrphanedKeys()` returns `[]`, so Tier 2 is a no-op. Tier 1 still finds orphaned `object_map` rows in WebDAV mode (e.g. legacy/out-of-band rows, or superseded rows after a migration) and removes them from the DB without calling `deleteBlob`.

### GC cycle lifecycle (per file mutation)

1. Upload new version → INSERT `object_map` (status=`pending`)
2. S3 PUT succeeds → UPDATE status=`active`; old row → status=`orphaned`
3. GC service classifies orphaned rows (`garbage` / `guarded` / `version`), deletes expired rows + corresponding S3 blobs after TTL, and cleans stale pending rows (`pending-live`)

---

## 3. Implementation Spec

### 3.1 `createGcService({ blobStore, fileNodesStore, fileStorageMode, gcConfig })`

Factory function following the DI pattern used by the other Phase 2 services.

| Param             | Type   | Default                | Description                                                                                                         |
| ----------------- | ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `blobStore`       | object | —                      | S3BlobStore or WebdavBlobStore adapter                                                                              |
| `fileNodesStore`  | object | —                      | fileNodesStore with object_map queries                                                                              |
| `fileStorageMode` | string | `'s3'`                 | `'s3'` or `'webdav'`; Tier 2 disabled in WebDAV mode; Tier 1 skips blob deletes in WebDAV mode (rows still cleaned) |
| `gcConfig`        | object | `{ orphanTtlDays: 1, versionTtlDays: 1, pendingStaleDays: 3 }` | TTL overrides; each key defaults from its `GC_*` env key (`GC_ORPHAN_TTL_DAYS`, `GC_VERSION_TTL_DAYS`, `GC_PENDING_STALE_DAYS`) when not provided — same precedence idiom for all three (gcConfig → DB resolver → fallback) |

#### `runGcCycle({ olderThanDays })`

Runs Tier 1 then Tier 2 and returns a summary. `olderThanDays` defaults to the configured TTL.

| Param         | Type   | Required | Description                                                                |
| ------------- | ------ | -------- | -------------------------------------------------------------------------- |
| olderThanDays | number | no       | Only orphans older than this many days are collected (default: config TTL) |

**Returns:**

```js
{
  tier1: {
    orphanedRows: number,      // object_map rows found
    deletedBlobs: number,      // blobs successfully deleted (0 in WebDAV mode — delete is skipped; includes stale-pending blobs)
    deletedRows: number,       // object_map rows removed from DB (orphaned + stale pending)
    guardedRows: number,       // orphaned rows exempt via the last-good guard (counted, not deleted)
    pendingDeletedRows: number, // stale pending rows deleted (their blobs fold into deletedBlobs)
    errors: string[],
  },
  tier2: {
    scannedKeys: number,    // keys returned by listOrphanedKeys
    untrackedKeys: number,  // keys with no reference in the keep-set
    deletedKeys: number,    // keys deleted from S3
    skipped: boolean,       // true when Tier 2 is unavailable (WebDAV mode)
    errors: string[],
  }
}
```

**Tier 1 algorithm:**

1. `fileNodesStore.getOrphanedObjectsWithNodeState(olderThanDays)` → orphaned rows annotated with `node_sync_status` and `has_active` (LEFT JOIN `file_nodes` + EXISTS active-row subquery).
2. Classify each row:
   - **`guarded`**: node is `pending_upload` and `has_active` is false → exempt; counted in `guardedRows`, never deleted while the guard holds.
   - **`garbage`**: node gone (LEFT JOIN miss) → collect with `orphanTtlDays`.
   - **`version`**: everything else (including orphans on `pending_upload` nodes with an active row, and on `orphaned_node` nodes) → collect with `versionTtlDays`.
3. For each collected row with a non-null `s3_key`: `blobStore.deleteBlob(s3_key)` — **blob-first-then-rows**; count successes, collect errors. **WebDAV-mode guard:** skip the `deleteBlob` call entirely in WebDAV mode — a preserved `s3_key` on a migrated row is a UUID rollback marker, not a webdav path, and `WebdavBlobStore.deleteBlob` is path-addressed (it would treat the UUID as a path and issue a wasteful 404).
4. `fileNodesStore.deleteObjectMapRows(ids)` for every collected orphaned row id (runs in WebDAV mode too).
5. **Pending-live cleanup:** `fileNodesStore.getStalePendingObjects(pendingStaleDays)` → `pending` rows on `pending_upload` nodes older than the cutoff (`0` disables this step). Delete blobs first, then rows; `pendingDeletedRows` counts the rows removed and their blob deletions fold into `deletedBlobs`.
6. `deletedRows` reflects rows removed from `object_map` (orphaned + stale pending).

**Tier 2 algorithm (S3 mode only; `skipped=true` otherwise):**

1. Convert the day-based threshold to a Date cutoff: `olderThan = new Date(Date.now() - days * 86400000)`.
2. `blobStore.listOrphanedKeys(olderThan)` → candidate keys (S3 `LastModified < olderThan`).
3. `fileNodesStore.getKeptS3Keys()` → keep-set (active ∪ version ∪ pending-live, via UNION query).
4. Diff → keys present only in S3 → `blobStore.deleteBlob(key)`.

Tier 1 always runs; in WebDAV mode it finds no rows during normal operation, but when orphaned rows do exist (legacy/out-of-band rows, or superseded rows after a migration) it removes them from the DB without calling `blobStore.deleteBlob`. Both tiers are best-effort: per-key errors are collected in `errors` and do not abort the cycle.

### 3.2 `createFailSafeService({ fileNodeService, fileNodesStore })`

Factory for `sync_status='orphaned_node'` detection and manual repair.

| Param             | Type   | Description                                                                    |
| ----------------- | ------ | ------------------------------------------------------------------------------ |
| `fileNodeService` | object | fileNodeService (tree ops: deleteNode, getNode, getNodePath, updateSyncStatus) |
| `fileNodesStore`  | object | fileNodesStore with `getNodesBySyncStatus`                                     |

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

**Returns:** `{ scanned: number, resolved: number, manualReview: Array<{ nodeId, path }> }`

---

## 4. Repository Additions (`server/store/repositories/FileNodeRepository.js`)

New methods required by the services. The `fileNodesStore` facade forwards them unchanged to
`FileNodeRepository`; each method's dialect SQL lives in the repository twins
(`server/store/repositories/sqlite/FileNodeRepository.sqlite.js` /
`server/store/repositories/postgres/FileNodeRepository.postgres.js`), executed through the executor seam:

| Method                                           | Query                                                                                                                                                    | Returns          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `getOrphanedObjects(olderThanDays)`              | `object_map WHERE status='orphaned' AND created_at < NOW() - INTERVAL` / `datetime('now', '-N days')`                                                    | rows[]           |
| `getOrphanedObjectsWithNodeState(olderThanDays)` | orphaned rows older than cutoff, LEFT JOIN `file_nodes` (node sync status) + EXISTS active-row subquery → rows annotated with `node_sync_status` and `has_active` | annotated rows[] |
| `getStalePendingObjects(staleThanDays)`          | `status='pending'` rows older than cutoff whose node is `pending_upload`                                                                                  | rows[]           |
| `getKeptS3Keys()`                                | `SELECT s3_key FROM object_map WHERE s3_key IS NOT NULL AND (status='active' OR status='orphaned' OR (status='pending' AND EXISTS (SELECT 1 FROM file_nodes n WHERE n.id = object_map.file_node_id AND n.sync_status='pending_upload')))` — active ∪ version ∪ pending-live UNION; no trash arm, no age filters | string[]         |
| `getAllActiveS3Keys()`                           | `SELECT s3_key FROM object_map WHERE status='active' AND s3_key IS NOT NULL` (retained on the facade for parity; no GC caller)                            | string[]         |
| `deleteObjectMapRows(ids)`                       | `DELETE FROM object_map WHERE id IN (...)`, SQLite branch per-row via `executor.run` in the sqlite dialect twin                                            | `{ changes }`    |
| `getNodesBySyncStatus(status)`                   | `file_nodes WHERE sync_status = ?`                                                                                                                        | rows[]           |

All of the above are dual-backend (PostgreSQL / SQLite), implemented in the `FileNodeRepository` dialect twins behind the executor seam (no store-internal dialect branching in the service) and covered by the repository conformance tests.

---

## 5. Admin Integration

### 5.1 Routes (`server/domains/admin/routes/maintenance.js`)

| Method | Path                                 | Description                                                                                                                   |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/admin/maintenance/gc`          | Run one GC cycle (both tiers). Response: `{ messageCode, results }`.                                                          |
| POST   | `/api/admin/maintenance/repair-sync` | Resolve one orphaned node. Body: `{ nodeId, action: 'retry-delete' \| 'force-active' }`. Response: `{ messageCode, result }`. |

Both require `authenticateToken` + `isAdmin`.

### 5.2 cleanupService Integration

`cleanupOrphanedData()` gains two additive result keys (existing keys unchanged):

- `gc: { tier1, tier2 }` — result of one GC cycle (S3 mode; WebDAV mode yields a skipped Tier 2 and a Tier 1 that removes orphaned rows without blob deletes).
- `orphanedNodes: [...]` — fail-safe report from `failSafeService.scanOrphanedNodes()`.

### 5.3 Startup Hook + Cron

- **Startup:** after metadata store init, `runStartupRecovery()` executes once and logs any nodes requiring manual review.
- **Cron:** when `GC_INTERVAL_MS` is a positive integer, `setInterval` runs `runGcCycle()` every interval. Default (unset/`0`) disables the schedule. A guard flag `WEA_SKIP_GC_SCHEDULER` (test seam) disables scheduling without changing production defaults.

---

## 6. Configuration

| Env                     | Default          | Description                                                  |
| ----------------------- | ---------------- | ------------------------------------------------------------ |
| `GC_INTERVAL_MS`        | unset (disabled) | GC cron interval in milliseconds; `0`/unset disables         |
| `GC_ORPHAN_TTL_DAYS`    | `1`              | Minimum age in days before a `garbage`-category orphaned blob/row is collected |
| `GC_VERSION_TTL_DAYS`   | `1`              | Minimum age in days before a `version`-category orphaned blob/row is collected (default reproduces the historical orphan TTL behavior) |
| `GC_PENDING_STALE_DAYS` | `3`              | Minimum age in days before a `pending` row on a `pending_upload` node is deleted with its blob (`pending-live` cleanup); `0` disables |
| `WEA_SKIP_GC_SCHEDULER` | unset            | Test seam; any truthy value disables cron scheduling         |

---

## 7. Verification Scenarios

- [ ] Tier 1: orphaned rows + corresponding S3 mock entries are cleaned; active blobs untouched
- [ ] Guarded row exempt: an orphaned row on a `pending_upload` node with no active row (`guarded`) is reported in `guardedRows` and NOT deleted (row + blob kept) while the node is unrepaired
- [ ] Guard released: once the node leaves `pending_upload` (or gains an active row), the previously guarded row is classified `version` and deleted after `GC_VERSION_TTL_DAYS`
- [ ] Stale pending cleaned: a `pending` row on a `pending_upload` node older than `GC_PENDING_STALE_DAYS` is deleted together with its blob (blob-first-then-rows); `pendingDeletedRows` increments
- [ ] Fresh pending kept: a `pending` row younger than the stale cutoff is left untouched
- [ ] Tier 2 keep-set: a stuck node's pending blob older than the untracked TTL is preserved by the keep-set while the pending row is young; after `GC_PENDING_STALE_DAYS` cleanup removes the row, Tier 2 deletes the now-untracked blob
- [ ] Defaults reproduce the historical Tier-1 outcome for live-node orphans: with default TTLs, orphaned rows on live/orphaned nodes are deleted as `version` exactly as before (guarded exemption is the only deviation)
- [ ] Tier 2: keys present in S3 with no keep-set reference are detected and deleted; active keys preserved
- [ ] Freshly-created orphaned rows (younger than TTL) are left untouched
- [ ] WebDAV mode: Tier 2 skipped; orphaned `object_map` rows follow the same category rules but are rows-only — `blobStore.deleteBlob` is NOT called (the preserved `s3_key` is a UUID rollback marker, not a webdav path); stale pending rows are deleted rows-only as well
- [ ] `scanOrphanedNodes()` returns orphaned nodes with paths
- [ ] `repairNode('retry-delete')` removes the node + subtree; `repairNode('force-active')` flips sync_status
- [ ] Admin endpoints require auth + admin; non-admin receives 403
- [ ] Cron scheduling disabled when `GC_INTERVAL_MS` unset or `WEA_SKIP_GC_SCHEDULER` set

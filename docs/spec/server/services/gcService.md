# gcService & failSafeService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Background maintenance services for the S3+PostgreSQL (and S3+SQLite) architecture. `gcService` reclaims orphaned blobs via a two-tier strategy; `failSafeService` scans and repairs `file_nodes` rows stuck in `sync_status='orphaned_node'`. |
| Depends on | Phase 2 services (`fileNodeService`, `fileNodesStore`, blob store adapters), Phase 0 schema (`object_map`, `file_nodes`) |
| Files | `server/service/gcService.js`, `server/service/failSafeService.js` |
| Test files | `server/service/__tests__/gcService.test.js`, `server/service/__tests__/failSafeService.test.js` |

Both services are pure background/ops concerns — they expose no user-facing file behavior. They are only reachable via admin maintenance endpoints or the optional cron/startup hooks.

---

## 2. GC Strategy

Two-tier orphan cleanup. Both tiers execute inside a single GC cycle; Tier 1 runs first (fast, DB-targeted), Tier 2 follows (slower, S3 `ListObjectsV2`-based).

- **Tier 1 (DB-driven):** `object_map` rows with `status='orphaned'` that are older than the orphan TTL → the corresponding blob is deleted and the row is removed. These are known orphans created by version supersession (`overwriteBlob` / `prepareUpload`) and by `deleteBlob` marking. **WebDAV-mode guard:** the blob-delete step is skipped (see §3.1) — a preserved `s3_key` on a migrated row is a rollback marker, not a webdav path — while the rows are still removed.
- **Tier 2 (S3 scan):** `blobStore.listOrphanedKeys(olderThan)` (adapter contract: `olderThan` is a **`Date`** cutoff — see `docs/spec/server/store/blobstore.md`) diffed against the set of `s3_key` values still referenced by `object_map` rows with `status='active'`. Keys present only in S3 (TX2 failures, manual row deletion, copy-on-write leftovers) are deleted. gcService converts the day-based TTL into a Date cutoff (`now - days * 86400000`) before calling the adapter.

Tier 2 only applies to S3 file storage: in WebDAV mode the app's own writes create no `object_map`
rows (the blob storage service skips them) and the WebDAV adapter's `listOrphanedKeys()` returns
`[]`, so Tier 2 is a no-op. Tier 1 still runs in WebDAV mode — orphaned `object_map` rows (e.g.
legacy/out-of-band rows, or superseded rows after a migration) are removed from the DB, but the
`deleteBlob` call is skipped because the row's `s3_key` is a preserved UUID rollback marker and the
WebDAV adapter is path-addressed (`deleteBlob` would treat the UUID as a path and 404).

### GC cycle lifecycle (per file mutation)

1. Upload new version → INSERT `object_map` (status=`pending`)
2. S3 PUT succeeds → UPDATE status=`active`; old row → status=`orphaned`
3. GC service deletes orphaned rows + corresponding S3 blobs after TTL

---

## 3. Implementation Spec

### 3.1 `createGcService({ blobStore, fileNodesStore, fileStorageMode, gcConfig })`

Factory function following the DI pattern used by the other Phase 2 services.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `blobStore` | object | — | S3BlobStore or WebdavBlobStore adapter |
| `fileNodesStore` | object | — | fileNodesStore with object_map queries |
| `fileStorageMode` | string | `'s3'` | `'s3'` or `'webdav'`; Tier 2 disabled in WebDAV mode; Tier 1 skips blob deletes in WebDAV mode (rows still cleaned) |
| `gcConfig` | object | `{ orphanTtlDays: 1 }` | TTL overrides; `orphanTtlDays` defaults from `GC_ORPHAN_TTL_DAYS` env when not provided |

#### `runGcCycle({ olderThanDays })`

Runs Tier 1 then Tier 2 and returns a summary. `olderThanDays` defaults to the configured TTL.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| olderThanDays | number | no | Only orphans older than this many days are collected (default: config TTL) |

**Returns:**

```js
{
  tier1: {
    orphanedRows: number,   // object_map rows found
    deletedBlobs: number,   // blobs successfully deleted (0 in WebDAV mode — delete is skipped)
    deletedRows: number,    // object_map rows removed from DB
    errors: string[],
  },
  tier2: {
    scannedKeys: number,    // keys returned by listOrphanedKeys
    untrackedKeys: number,  // keys with no active object_map reference
    deletedKeys: number,    // keys deleted from S3
    skipped: boolean,       // true when Tier 2 is unavailable (WebDAV mode)
    errors: string[],
  }
}
```

**Tier 1 algorithm:**
1. `fileNodesStore.getOrphanedObjects(olderThanDays)` → rows with `status='orphaned'` and `created_at` older than the threshold.
2. For each row with a non-null `s3_key`: `blobStore.deleteBlob(s3_key)`; count successes, collect errors. **WebDAV-mode guard:** skip the `deleteBlob` call entirely in WebDAV mode — a preserved `s3_key` on a migrated row is a UUID rollback marker, not a webdav path, and `WebdavBlobStore.deleteBlob` is path-addressed (it would treat the UUID as a path and issue a wasteful 404).
3. `fileNodesStore.deleteObjectMapRows(ids)` for every orphaned row id (runs in WebDAV mode too).
4. `deletedRows` reflects rows removed from `object_map`.

**Tier 2 algorithm (S3 mode only; `skipped=true` otherwise):**
1. Convert the day-based threshold to a Date cutoff: `olderThan = new Date(Date.now() - days * 86400000)`.
2. `blobStore.listOrphanedKeys(olderThan)` → candidate keys (S3 `LastModified < olderThan`).
3. `fileNodesStore.getAllActiveS3Keys()` → active-key set.
4. Diff → keys present only in S3 → `blobStore.deleteBlob(key)`.

Tier 1 always runs; in WebDAV mode it finds no rows during normal operation, but when orphaned rows do exist (legacy/out-of-band rows, or superseded rows after a migration) it removes them from the DB without calling `blobStore.deleteBlob`. Both tiers are best-effort: per-key errors are collected in `errors` and do not abort the cycle.

### 3.2 `createFailSafeService({ fileNodeService, fileNodesStore })`

Factory for `sync_status='orphaned_node'` detection and manual repair.

| Param | Type | Description |
|-------|------|-------------|
| `fileNodeService` | object | fileNodeService (tree ops: deleteNode, getNode, getNodePath, updateSyncStatus) |
| `fileNodesStore` | object | fileNodesStore with `getNodesBySyncStatus` |

#### `scanOrphanedNodes()`

Returns every node with `sync_status='orphaned_node'`, enriched with its display path.

**Returns:** `Array<{ nodeId, name, type, path, createdAt, updatedAt }>`

#### `repairNode(nodeId, { action })`

Resolves a single stuck node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | file_nodes.id to repair |
| action | string | yes | `'retry-delete'` (force-remove node + subtree from DB) or `'force-active'` (mark sync_status='active') |

**Returns:** `{ nodeId, action, status: 'resolved', path, detail }`

- `action='retry-delete'`: validates the node exists, calls `fileNodeService.deleteNode(nodeId)` (removes subtree + ancestor rows). The corresponding blob, if any, is left for Tier 2 GC if it is no longer referenced.
- `action='force-active'`: `fileNodeService.updateSyncStatus(nodeId, 'active')`; accepts an admin decision that the DB row matches storage state.

**Errors:** unknown node → throws notFound; unknown action → throws validation error.

#### `runStartupRecovery()`

Startup hook (Task 6.3). Scans orphaned nodes and returns a report. It never performs destructive actions automatically — stuck nodes are surfaced for manual review via `repair-sync`. This prevents accidental data loss on boot.

**Returns:** `{ scanned: number, resolved: number, manualReview: Array<{ nodeId, path }> }`

---

## 4. Store Additions (`server/store/fileNodesStore.js`)

New methods required by the services:

| Method | Query |
|--------|-------|
| `getOrphanedObjects(olderThanDays)` | `object_map WHERE status='orphaned' AND created_at < NOW() - INTERVAL` / `datetime('now', '-N days')` |
| `getAllActiveS3Keys()` | `SELECT s3_key FROM object_map WHERE status='active' AND s3_key IS NOT NULL` |
| `deleteObjectMapRows(ids)` | `DELETE FROM object_map WHERE id IN (...)`, SQLite branch per-row via `sqliteRun` |
| `getNodesBySyncStatus(status)` | `file_nodes WHERE sync_status = ?` |

All four are dual-backend (PostgreSQL / SQLite) following the existing `fileNodesStore.js` branching pattern (`isPg`).

---

## 5. Admin Integration

### 5.1 Routes (`server/domains/admin/routes/maintenance.js`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/maintenance/gc` | Run one GC cycle (both tiers). Response: `{ messageCode, results }`. |
| POST | `/api/admin/maintenance/repair-sync` | Resolve one orphaned node. Body: `{ nodeId, action: 'retry-delete' \| 'force-active' }`. Response: `{ messageCode, result }`. |

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

| Env | Default | Description |
|-----|---------|-------------|
| `GC_INTERVAL_MS` | unset (disabled) | GC cron interval in milliseconds; `0`/unset disables |
| `GC_ORPHAN_TTL_DAYS` | `1` | Minimum age in days before an orphaned blob/row is collected |
| `WEA_SKIP_GC_SCHEDULER` | unset | Test seam; any truthy value disables cron scheduling |

---

## 7. Verification Scenarios

- [ ] Tier 1: orphaned rows + corresponding S3 mock entries are cleaned; active blobs untouched
- [ ] Tier 2: keys present in S3 with no `object_map` reference are detected and deleted; active keys preserved
- [ ] Freshly-created orphaned rows (younger than TTL) are left untouched
- [ ] WebDAV mode: Tier 2 skipped; orphaned `object_map` rows are still deleted from the DB but `blobStore.deleteBlob` is NOT called (the preserved `s3_key` is a rollback marker, not a webdav path)
- [ ] `scanOrphanedNodes()` returns orphaned nodes with paths
- [ ] `repairNode('retry-delete')` removes the node + subtree; `repairNode('force-active')` flips sync_status
- [ ] Admin endpoints require auth + admin; non-admin receives 403
- [ ] Cron scheduling disabled when `GC_INTERVAL_MS` unset or `WEA_SKIP_GC_SCHEDULER` set

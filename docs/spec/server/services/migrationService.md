# migrationService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Core blob-migration engine shared by the CLI (`server/scripts/migrateBlobs.js`) and the admin API (`server/domains/admin/routes/migration.js`). Performs snapshot traversal + per-node copy + direction-specific DB rules + resume/dry-run/failure isolation + finalize. |
| Depends on | `fileNodesStore`, `fileNodeService`, blob store adapters, dest-config normalization (`server/infrastructure/adapters/blobstore/config.js`), `lockManager` |
| Files | `server/domains/admin/services/migrationService.js` |
| Test files | `server/domains/admin/services/__tests__/migrationService.test.js` |

The service operates on injected dependencies only. It never constructs real adapters — tests inject `createFakeBlobStore()` and a fake `buildDestBlobStore` (see `docs/TESTING_STRATEGY.md`).

---

## 2. Implementation Spec

### 2.1 Factory

`createMigrationService({ srcBlobStore, fileNodesStore, fileNodeService, buildDestBlobStore, lockManager })`

| Param | Type | Description |
|-------|------|-------------|
| `srcBlobStore` | object | Source BlobStore adapter (WebdavBlobStore or S3BlobStore), already built from the app config |
| `fileNodesStore` | object | fileNodesStore with `getNodesBySyncStatus`, `getActiveObjectMap` / object_map upsert queries, filecache upsert |
| `fileNodeService` | object | fileNodeService (tree ops: `getNodePath`, node lookup) |
| `buildDestBlobStore` | function | `(destConfig) => { blobStore, summary }` from `server/infrastructure/adapters/blobstore/config.js` (or injected fake) |
| `lockManager` | object | Metadata locking for the required DB updates |

### 2.2 `run({ direction, phase, destConfig, mode, resume, force, onProgress })`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `direction` | string | — | `'webdav-to-s3'` or `'s3-to-webdav'` |
| `phase` | string | `'copy'` | `'copy'` or `'finalize'` |
| `destConfig` | object | — | User-supplied destination config (see `docs/spec/server/tools/blob-migration.md` §4.2) |
| `mode` | string | `'dry-run'` | `'dry-run'` or `'apply'` |
| `resume` | boolean | `false` | Skip nodes already migrated per the direction resume marker |
| `force` | boolean | `false` | Re-copy even when a resume marker is present |
| `onProgress` | function | — | Called after each node; see §2.6 |

**Returns:**

```js
{
  copied: number,
  skipped: number,
  failed: number,
  errors: [{ nodeId, path, error }],
}
```

### 2.3 Behavior (per run)

1. Build the destination store from `destConfig` (dry-run validates it; a missing required field fails before anything runs).
2. **Snapshot** = enumerate `file_nodes WHERE type='file' AND sync_status='active'` with an active `object_map` row (via `fileNodesStore.getNodesBySyncStatus('active')`, filtered to type=file + object_map row). Directories are only relevant for webdav-destination mkdir.
3. Process each node (order by id).
4. Per-node failures are caught, recorded in `results.errors`, and processing continues — a single failing node never aborts the run. Only config/snapshot/destination-validation failures abort.
5. `dry-run`: perform snapshot + destination connectivity + (for resume) count skippable nodes, but write nothing; return `{ ...results, dryRun: true }`.
6. `phase='finalize'` (s3-to-webdav only, `mode='apply'`): see §2.5.
7. `mode='apply'` runs an internal dry-run pass first; failure blocks writes.

### 2.4 Per-direction copy behavior

**`webdav-to-s3`** (per node):

1. `path = fileNodeService.getNodePath(nodeId)`.
2. Resume-skip if an active row has a non-null `s3_key` (unless `force`).
3. `buf = srcBlobStore.downloadBlob(path)`.
4. `key = uuid`.
5. `destBlobStore.uploadBlob(key, buf)` — flat UUID key, no directory structure.
6. `upsertObjectMap(nodeId, key, 'active')` (`storage_backend='s3'`, `s3_key=UUID`).
7. Upsert filecache `{ size, mime, content_hash: sha256(buf) }`.

**`s3-to-webdav`** (per node):

1. `key = getActiveObject.s3_key`; `nodePath = fileNodeService.getNodePath(nodeId)`.
2. Resume-skip if `destBlobStore.headBlob(nodePath).contentLength === filecache.size` (a partial/unfinished dest blob is never treated as complete) (unless `force`).
3. `buf = srcBlobStore.downloadBlob(key)`.
4. Ensure ancestor directories top-down (skip root) via `createDirectory` / `ensureDirectoryExists`.
5. `destBlobStore.uploadBlob(nodePath, buf)` — WebDAV path `/username/...`, directory structure preserved.
6. Update filecache `content_hash`.
7. **`object_map` is untouched.**

### 2.5 Finalize (`phase='finalize'`, s3-to-webdav only)

- Scan active `object_map` rows with `storage_backend='s3'`.
- If `destBlobStore.headBlob(path)` exists and size matches `filecache` → `UPDATE object_map SET storage_backend='webdav', s3_key=NULL`.
- Idempotent — re-running flips nothing new. Returns counts.
- Only valid for `s3-to-webdav` and `mode='apply'`; it is run after the app is switched to webdav mode.

### 2.6 Progress callback

`onProgress({ total, done, current, copied, skipped, failed })` — called after each node.

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total active nodes in the snapshot |
| `done` | number | Nodes processed so far |
| `current` | object | The node currently being processed |
| `copied` | number | Blobs copied so far |
| `skipped` | number | Nodes skipped (resume markers) so far |
| `failed` | number | Nodes failed so far |

### 2.7 Error isolation

- Per-node errors are caught and pushed to `results.errors` as `{ nodeId, path, error }`; the run continues.
- Fatal errors (config, snapshot enumeration, destination connectivity) abort the whole run.
- `mode='apply'` only reaches the write loop after the internal dry-run pass succeeds.

---

## 3. Verification Scenarios

- [ ] Round-trip WebDAV→S3→WebDAV: all content hashes equal, tree preserved
- [ ] S3 destination is flat (UUID keys only, no directories); WebDAV destination preserves structure and mkdirs ancestors
- [ ] dry-run writes nothing (destination store count `0`, DB unchanged)
- [ ] apply writes the expected `object_map` state per direction; finalize flips to `(webdav, NULL)`
- [ ] resume: fail on node N → rerun → completed skipped, remainder copied, no duplicates
- [ ] idempotent: full rerun → `0` copied
- [ ] error isolation: a failing node doesn't stop the run; errors reported
- [ ] partial-blob safety: an unfinished destination blob (size mismatch) is not treated as complete
- [ ] `onProgress` called after each node with the documented shape
- [ ] `mode='apply'` blocks writes when the internal dry-run pass fails

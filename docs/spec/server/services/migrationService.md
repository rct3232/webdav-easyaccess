# migrationService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Core blob-migration engine shared by the CLI (`server/scripts/migrateBlobs.js`) and the admin API (`server/domains/admin/routes/migration.js`). Performs snapshot traversal + per-node copy + direction-specific DB rules (incl. the inline `object_map` flip for s3→webdav) + automatic resume + dry-run/failure isolation. |
| Depends on | `fileNodesStore`, `fileNodeService`, blob store adapters, dest-config normalization (`server/infrastructure/adapters/blobstore/config.js`), `lockManager` |
| Files | `server/domains/admin/services/migrationService.js` |
| Test files | `server/domains/admin/services/__tests__/migrationService.test.js` |

The service operates on injected dependencies only. It never constructs real adapters — tests inject `createFakeBlobStore()` and a fake `buildDestBlobStore` (see `docs/TESTING_STRATEGY.md`).

---

## 2. Implementation Spec

### 2.1 Factory

`createMigrationService({ srcBlobStore, fileNodesStore, fileNodeService, buildDestBlobStore, lockManager, fileStorageMode })`

| Param | Type | Description |
|-------|------|-------------|
| `srcBlobStore` | object | Source BlobStore adapter (WebdavBlobStore or S3BlobStore), already built from the app config |
| `fileNodesStore` | object | fileNodesStore with `getNodesBySyncStatus`, `getNodesBySyncStatusNot`, `getActiveObject` / object_map upsert queries, filecache upsert |
| `fileNodeService` | object | fileNodeService (tree ops: `getNodePath`, node lookup) |
| `buildDestBlobStore` | function | `(destConfig) => { blobStore, summary }` from `server/infrastructure/adapters/blobstore/config.js` (or injected fake) |
| `lockManager` | object | Metadata locking for the required DB updates |
| `fileStorageMode` | string | `'webdav'` or `'s3'` — the current app config mode (`WEA_FILE_STORAGE`). Drives direction derivation: source = this mode, destination = the other backend |

### 2.2 `run({ destConfig, mode, force, onProgress })`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `destConfig` | object | — | User-supplied destination config (see `docs/spec/server/tools/blob-migration.md` §4.2); its `type` must equal the derived destination backend |
| `mode` | string | `'dry-run'` | `'dry-run'` or `'apply'` |
| `force` | boolean | `false` | Re-copy even when an automatic resume marker is present |
| `onProgress` | function | — | Called after each node; see §2.5 |

There is no `direction` parameter: the direction is derived internally from the injected `fileStorageMode` (source = that mode, destination = the other backend). Before any work the service validates that `destConfig.type` equals the expected destination type (webdav source → `'s3'`, s3 source → `'webdav'`) and throws a clear error on mismatch.

There is no `phase` or `resume` parameter: resume is internal and always on (destination-state markers per §2.4), and there is no separate finalize operation.

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

1. **Derive direction** from the injected `fileStorageMode` (source = that mode, destination = the other backend); validate `destConfig.type` equals the expected destination (webdav source → `'s3'`, s3 source → `'webdav'`). A mismatch throws before anything runs.
2. Build the destination store from `destConfig` (dry-run validates it; a missing required field fails before anything runs).
3. **Snapshot** = source-mode-aware enumeration (see §2.3.1). Directories are only relevant for webdav-destination mkdir.
4. Process each node (order by id).
5. Per-node failures are caught, recorded in `results.errors`, and processing continues — a single failing node never aborts the run. Only config/snapshot/destination-validation failures abort.
6. **Automatic resume:** already-migrated destination blobs are skipped per the direction marker in §2.4. No flag or checkbox is involved; `force` re-copies even when a marker is present.
7. `dry-run`: perform snapshot + destination connectivity + count skippable nodes, but write nothing; return `{ ...results, dryRun: true }`.
8. `mode='apply'` runs an internal dry-run pass first; failure blocks writes.

### 2.3.1 Source-mode-aware snapshot (webdav→s3)

The snapshot contract is source-mode aware — it only imposes the S3 lifecycle model
(`sync_status='active'` + an active `object_map` row) on an S3 source:

| Source mode | Enumeration | Per-node activeObject |
|---|---|---|
| `s3` (unchanged) | `file_nodes WHERE type='file' AND sync_status='active'` with an active `object_map` row (via `fileNodesStore.getNodesBySyncStatus('active')`, filtered to type=file + object_map row) | `fileNodesStore.getActiveObject(node.id)` (always present) |
| `webdav` | all file nodes with `sync_status != 'orphaned_node'` (via `fileNodesStore.getNodesBySyncStatusNot('orphaned_node')`, filtered to type=file) | `getActiveObject(node.id)` when present — its preserved `s3_key` is the resume marker from a prior migration — otherwise a synthesized `{ s3_key: null, storage_backend: 'webdav' }` |

**Why webdav-native files need no `object_map` row:** webdav is path-addressed — the blob **is** the
node's display path (`fileNodeService.getNodePath(node.id)`), so a mapping row would be redundant and
the app never creates one (the webdav upload branch only upserts filecache; `createNode` hardcodes
`sync_status='pending_upload'`). Requiring the S3 model on a webdav source would make every
app-produced webdav file invisible to the snapshot (a real `webdav → s3` migration silently copies 0
nodes). With the synthesized activeObject, the webdav→s3 `shouldSkip`/`processNode` paths behave
identically: they read `activeObject.s3_key` only as the resume marker and always download the source
from `nodePath`.

`orphaned_node` file nodes are excluded because they represent known-unrecoverable writes (the blob
PUT failed after the DB commit); they are a fail-safe/manual-review concern, never migration input.

### 2.4 Per-direction copy behavior

**`webdav-to-s3`** (per node):

1. `path = fileNodeService.getNodePath(nodeId)`.
2. Auto-resume-skip if an active row has a non-null `s3_key` (unless `force`).
3. `buf = srcBlobStore.downloadBlob(path)`.
4. `key = uuid`.
5. `destBlobStore.uploadBlob(key, buf)` — flat UUID key, no directory structure.
6. `upsertObjectMap(nodeId, key, 'active')` (`storage_backend='s3'`, `s3_key=UUID`).
7. Upsert filecache `{ size, mime, content_hash: sha256(buf) }`.
8. **`updateSyncStatus(nodeId, 'active')`** — a webdav-native node was left `pending_upload` at create
   time; after a successful copy it is set `active` so post-cutover (S3-mode) state matches the S3
   lifecycle model (resume marker + GC + future migrations all operate on `active` rows).

**`s3-to-webdav`** (per node):

1. `key = getActiveObject.s3_key`; `nodePath = fileNodeService.getNodePath(nodeId)`.
2. Auto-resume-skip if `destBlobStore.headBlob(nodePath).contentLength === filecache.size` (a partial/unfinished dest blob is never treated as complete) (unless `force`).
3. `buf = srcBlobStore.downloadBlob(key)`.
4. Ensure ancestor directories top-down (skip root) via `createDirectory` / `ensureDirectoryExists`.
5. `destBlobStore.uploadBlob(nodePath, buf)` — WebDAV path `/username/...`, directory structure preserved.
6. Update filecache `content_hash`.
7. **Inline flip (apply only):** `UPDATE object_map SET storage_backend='webdav'` for the node (via `fileNodesStore.setObjectMapBackendWebdav`), **keeping `s3_key`** — only `storage_backend` changes; `s3_key` is preserved. Dry-run and the internal dry pass never flip.

**Why the inline flip is safe:** `downloadBlob` in S3 mode reads only `row.s3_key`, never `storage_backend`; `storage_backend` is informational (no production logic reads it except migration code). Flipping only `storage_backend` while keeping `s3_key` therefore has zero functional impact on a running S3-mode app and preserves rollback. A flipped node is auto-skipped on re-run because `shouldSkip` for s3→webdav skips rows whose `storage_backend !== 's3'`.

### 2.5 Progress callback

`onProgress({ total, done, current, copied, skipped, failed })` — called after each node.

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total active nodes in the snapshot |
| `done` | number | Nodes processed so far |
| `current` | object | The node currently being processed |
| `copied` | number | Blobs copied so far |
| `skipped` | number | Nodes skipped (automatic resume markers) so far |
| `failed` | number | Nodes failed so far |

### 2.6 Error isolation

- Per-node errors are caught and pushed to `results.errors` as `{ nodeId, path, error }`; the run continues.
- Fatal errors (config, snapshot enumeration, destination connectivity) abort the whole run.
- `mode='apply'` only reaches the write loop after the internal dry-run pass succeeds.

---

## 3. Verification Scenarios

- [ ] Round-trip WebDAV→S3→WebDAV: all content hashes equal, tree preserved
- [ ] S3 destination is flat (UUID keys only, no directories); WebDAV destination preserves structure and mkdirs ancestors
- [ ] dry-run writes nothing (destination store count `0`, DB unchanged, no `object_map` flips)
- [ ] apply writes the expected `object_map` state per direction: webdav→s3 upserts `(s3, key, active)` and sets `sync_status='active'`; s3→webdav flips `storage_backend='webdav'` inline while preserving `s3_key`
- [ ] webdav-source snapshot: a native webdav file (no `object_map` row, `sync_status='pending_upload'`) is enumerated and copied; the synthesized activeObject is `{ s3_key: null, storage_backend: 'webdav' }`
- [ ] webdav-source snapshot: a node with a preserved active `s3_key` (prior migration) is skipped on rerun (resume marker), while native files are still copied
- [ ] webdav-source snapshot: file nodes with `sync_status='orphaned_node'` are excluded
- [ ] s3-source snapshot unchanged: only `active` file nodes with an active `object_map` row are enumerated
- [ ] automatic resume: fail on node N → rerun → completed skipped, remainder copied, no duplicates
- [ ] idempotent: full rerun → `0` copied
- [ ] error isolation: a failing node doesn't stop the run; errors reported
- [ ] partial-blob safety: an unfinished destination blob (size mismatch) is not treated as complete
- [ ] `onProgress` called after each node with the documented shape
- [ ] `mode='apply'` blocks writes when the internal dry-run pass fails
- [ ] `run` derives the direction internally from `fileStorageMode`; a `destConfig.type` that does not match the expected destination throws before any work

# blobStorageService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Blob lifecycle management with dual-backend support (S3 and WebDAV). Handles prepareUpload (pending object_map entry), completeUpload (pending→active + filecache write), download (S3 retrieval via active key or WebDAV GET), overwrite (orphan old + upload new + activate, or WebDAV PUT), delete (mark orphaned for S3; WebDAV DELETE best-effort). Factory dispatches based on `WEA_FILE_STORAGE` config: `s3` → S3BlobStore, `webdav` → WebdavBlobStore. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/service/blobStorageService.js`
- **Test file:** `server/service/__tests__/blobStorageService.test.js`

### 2.2 Factory Function Signature

```js
function createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode = 's3', fileNodeService }) {
  // fileStorageMode: 's3' | 'webdav'
  return {
    prepareUpload(fileNodeId),
    completeUpload(s3Key, size, mimeType),
    downloadBlob(fileNodeId),
    overwriteBlob(fileNodeId, buffer),
    deleteBlob(fileNodeId),
    getActiveS3Key(fileNodeId),
    countActiveObjectsByS3Key(s3Key),
    duplicateBlob(sourceS3Key),
    linkObject(fileNodeId, s3Key),
    ensureExclusiveBlob(fileNodeId),
    uploadToWebdav(fileNodeId, buffer, mimeType),
    downloadBlobWebdav(fileNodeId),
    createDirectoryWebdav(fileNodeId),
  };
}
```

### 2.3 Blob Store Factory (`createBlobStore()`)

The blob store factory is **parameterless** — it reads `process.env.WEA_FILE_STORAGE` internally. This is decision D2 from Wave 1 rectification.

- `WEA_FILE_STORAGE=webdav` → returns `new WebdavBlobStore(createFileStoreAdapter())`
- `WEA_FILE_STORAGE=s3` (or empty/undefined) → returns `new S3BlobStore(resolveS3Config())`
- No `NoOpBlobStore` is used; webdav mode returns a real `WebdavBlobStore` instance

### 2.4 Methods

#### `prepareUpload(fileNodeId)`

Prepares a new upload by creating a pending object_map entry. Orphans any existing active row for the same file node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node being uploaded to |

**Returns:** string — UUID s3Key for the pending upload (S3 mode); null (WebDAV mode)

**DB operations:** `upsertObjectMap(fileNodeId, s3Key, 'pending')` — if active row exists, marks it orphaned then INSERTs new pending.

#### `completeUpload(s3Key, size, mimeType)`

Finalizes an upload: transitions object_map from pending→active and writes filecache metadata.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| s3Key | string | yes | The UUID key returned by prepareUpload |
| size | number | yes | Content length in bytes |
| mimeType | string | yes | MIME type of the uploaded content |

**DB operations:** `activateObject(s3Key)` + `upsertCache(fileNodeId, size, mimeType, null)`

**WebDAV mode:** throws `'completeUpload is not applicable in WebDAV mode'`

#### `downloadBlob(fileNodeId)`

Downloads blob content for an active file node. Returns buffer or null if no active object exists.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to download |

**Returns:** Buffer \| null

**Operations:** `getActiveObject(fileNodeId)` → `blobStore.downloadBlob(s3Key)` (S3); delegates to `downloadBlobWebdav(fileNodeId)` (WebDAV).

#### `overwriteBlob(fileNodeId, buffer)`

Overwrites a file's content: orphans old key, uploads new blob, creates active mapping.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to overwrite |
| buffer | Buffer | yes | New content to upload |

**Returns:** string — new s3Key (S3 mode)

**Operations:** orphan old key → `blobStore.uploadBlob(newS3Key, buffer)` → INSERT active mapping (S3); delegates to `uploadToWebdav(fileNodeId, buffer)` (WebDAV).

#### `deleteBlob(fileNodeId)`

Marks the active object as orphaned. Actual S3 deletion is deferred to GC service (Phase 6).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to delete blob for |

**Operations:** `orphanObject(currentS3Key)` — no-op if no active object exists (S3); resolve path (guard node), `blobStore.deleteBlob(path)` (WebDAV).

#### `getActiveS3Key(fileNodeId)`

Returns the s3_key of the currently active object, or null.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node |

**Returns:** string \| null (always null in WebDAV mode)

#### `countActiveObjectsByS3Key(s3Key)`

Counts active object_map rows for a given s3_key.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| s3Key | string | yes | The s3_key to count |

**Returns:** number — count of active rows (always 0 in WebDAV mode)

#### `duplicateBlob(sourceS3Key)`

Copies a blob under a new random key.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| sourceS3Key | string | yes | The s3_key to copy from |

**Returns:** string — new s3Key

**Operations:** `blobStore.copyBlob(sourceS3Key, newS3Key)` → returns newS3Key

**WebDAV mode:** throws `'duplicateBlob is not applicable in WebDAV mode'`

#### `linkObject(fileNodeId, s3Key)`

Links an existing s3_key to a file node as active.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node |
| s3Key | string | yes | The s3_key to link |

**Operations:** `fileNodesStore.insertObject(fileNodeId, s3Key, 'active')`

**WebDAV mode:** throws `'linkObject is not applicable in WebDAV mode'`

#### `ensureExclusiveBlob(fileNodeId)`

Write barrier: if multiple file nodes share the same s3_key, duplicates the blob so this node gets its own copy.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node |

**Returns:** string — exclusive s3Key, or null if no active object

**Operations (S3):** checks `countActiveObjectsByS3Key`; if count > 1, calls `duplicateBlob` → orphan old → insert active → returns newKey; otherwise returns existing key.

**WebDAV mode:** returns null.

### 2.5 Dependencies

- `blobStore` — S3 blob operations (`uploadBlob`, `downloadBlob`, `deleteBlob`, `copyBlob`) from Phase 1 adapter
- `fileNodesStore` — object_map and filecache CRUD operations
- `fileNodeService` — (WebDAV mode) `getNode(nodeId)` and `getNodePath(nodeId)` for path resolution

---

## 3. WebDAV Mode

### 3.1 WebdavBlobStore Adapter Interface

`WebdavBlobStore` exposes the same S3-uniform method names so `blobStorageService` can call either backend transparently. Constructor takes a file-store adapter (`webdavClient`) from `createFileStoreAdapter()`. This is decision D1 from Wave 1 rectification.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `uploadBlob` | `(filepath: string, buffer: Buffer)` | `Promise<void>` | PUT to WebDAV path via `adapter.putFileContents()` |
| `downloadBlob` | `(filepath: string)` | `Promise<Buffer \| null>` | GET via `adapter.getFileContents()`; returns null if 404 |
| `deleteBlob` | `(filepath: string)` | `Promise<void>` | DELETE via `adapter.deleteFile()`; idempotent for 404 |
| `headBlob` | `(filepath: string)` | `Promise<{contentLength, contentType} \| null>` | HEAD via `adapter.getFileMetadata()`; maps `mime → contentType` |
| `listOrphanedKeys` | `()` | `Promise<string[]>` | Returns `[]` (no orphan tracking in WebDAV) |

### 3.2 Path Resolution

`file_node_id` → guard on `fileNodeService.getNode(fileNodeId)` (returns null if missing) → reconstruct display path via `fileNodeService.getNodePath(nodeId)` → pass to WebDAV blob store methods. `getNodePath(nodeId)` may return `null` for an unknown or empty node. WebDAV methods MUST null-guard: `downloadBlobWebdav(fileNodeId)` returns `null`; `uploadToWebdav(fileNodeId, buffer)` throws a descriptive error when the resolved path is falsy.

### 3.3 WebDAV Service Methods

#### `downloadBlobWebdav(fileNodeId)`

Downloads blob via WebDAV path. Guards on node existence.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to download |

**Returns:** Buffer \| null

**Operations:** resolve path (guard node via `fileNodeService.getNode`) → `blobStore.downloadBlob(path)` or null.

#### `createDirectoryWebdav(fileNodeId)`

Ensures the physical storage directory for a node exists on the WebDAV server (MKCOL).
Directory creation in WebDAV mode is otherwise DB-only (`fileNodeService.createDirectory`
inserts a `file_nodes` row), so without this step subsequent `PUT`s target a non-existent
remote path and fail (bytemark returns 403/409).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the directory node to materialize remotely |

**Returns:** string (resolved node path) in WebDAV mode; `null` in S3 mode (no-op).

**Operations:** S3 mode → immediate `null` no-op. WebDAV mode → resolve path (guard node via
`fileNodeService.getNode`, then `fileNodeService.getNodePath(fileNodeId)`) → `blobStore.createDirectory(path)`
which MKCOLs root → deepest segment via `WebdavBlobStore.createDirectory` / `ensureDirectoryExists`,
tolerating already-existing collections. On MKCOL failure the node is marked
`sync_status='orphaned_node'` via `fileNodeService.updateSyncStatus(fileNodeId, 'orphaned_node')`
(fail-safe) and the error is re-thrown so callers surface a failure response.

> **Fail-safe contract:** identical to `uploadToWebdav` — a DB node that committed but whose
> physical directory could not be materialized is left as `orphaned_node` for Phase 6
> GC / `POST /api/admin/maintenance/repair-sync`, never silently ignored.

#### `uploadToWebdav(fileNodeId, buffer, mimeType)`

Uploads blob via WebDAV path. Guards on node existence.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to upload to |
| buffer | Buffer | yes | Content to upload |
| mimeType | string | no | MIME type (optional) |

**Operations:** resolve path (guard node via `fileNodeService.getNode`) → `blobStore.uploadBlob(path, buffer)` → `upsertCache(fileNodeId, buffer.length, mimeType, null)`.

---

## 4. Dual-Backend Dispatch Table

| Operation | S3 Mode | WebDAV Mode |
|-----------|---------|-------------|
| prepareUpload | orphan old + INSERT pending → return s3Key | returns null (no-op) |
| completeUpload | UPDATE active + filecache | throws 'completeUpload is not applicable in WebDAV mode' |
| downloadBlob | blobStore.downloadBlob(s3Key) | delegates to downloadBlobWebdav |
| overwriteBlob | ensureExclusiveBlob (split shared) → orphan+upload+activate → return newKey | delegates to uploadToWebdav |
| deleteBlob | mark orphaned in object_map | resolve path → blobStore.deleteBlob(path) |
| getActiveS3Key | active s3_key or null | always null |
| countActiveObjectsByS3Key | COUNT active object_map rows by s3_key | returns 0 |
| duplicateBlob | blobStore.copyBlob(source, newKey) → newKey | throws 'duplicateBlob is not applicable in WebDAV mode' |
| linkObject | INSERT object_map (file_node_id, s3_key, 'active') | throws 'linkObject is not applicable in WebDAV mode' |
| ensureExclusiveBlob | write barrier: if countActiveObjectsByS3Key > 1, split shared blob before mutation | returns null |
| uploadToWebdav | n/a | resolve path → blobStore.uploadBlob(path, buffer) → upsertCache |
| downloadBlobWebdav | n/a | resolve path (guard node) → blobStore.downloadBlob(path) or null |
| createDirectoryWebdav | returns null (no-op) | resolve path → blobStore.createDirectory(path) (recursive MKCOL); on failure mark orphaned_node + rethrow |

---

## 5. Error Cases

### S3 Mode

- No active object for download → returns null (no throw)
- completeUpload with unknown s3Key → throws error
- deleteBlob with no active object → no-op, no error

### WebDAV Mode

- completeUpload → throws error
- duplicateBlob → throws error
- linkObject → throws error

## 6. Version Number Policy

Single-version mode: `version_number` is always 1 in all INSERT operations. The `UNIQUE(file_node_id, version_number)` constraint exists for future version history expansion but currently only one active version per node is maintained.

## 7. Verification Scenarios

- [ ] prepareUpload creates pending entry with valid UUID s3Key (S3 mode)
- [ ] prepareUpload returns null (WebDAV mode)
- [ ] prepareUpload orphans previous active row before inserting new pending
- [ ] completeUpload transitions pending→active and writes filecache metadata
- [ ] completeUpload throws in WebDAV mode
- [ ] downloadBlob with active object returns buffer matching uploaded content
- [ ] downloadBlob with no active object returns null
- [ ] overwriteBlob orphans old key and creates new active mapping
- [ ] deleteBlob marks active object orphaned (no S3 deletion)
- [ ] deleteBlob with no active object is a no-op
- [ ] deleteBlob in WebDAV mode resolves path and calls blobStore.deleteBlob
- [ ] countActiveObjectsByS3Key returns correct count
- [ ] duplicateBlob copies blob under new key
- [ ] ensureExclusiveBlob duplicates when count > 1
- [ ] downloadBlobWebdav resolves path and downloads via blobStore
- [ ] uploadToWebdav resolves path, uploads, and writes filecache
- [ ] createDirectoryWebdav is a no-op (null) in S3 mode without touching blobStore
- [ ] createDirectoryWebdav resolves path and calls blobStore.createDirectory(path) in WebDAV mode
- [ ] createDirectoryWebdav marks orphaned_node + rethrows when MKCOL fails

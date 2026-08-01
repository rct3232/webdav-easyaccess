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
function createBlobStorageService({ blobStore, fileNodesStore, webdavClient, fileNodeService, fileStorageMode }) {
  // fileStorageMode: 's3' | 'webdav'
  return {
    prepareUpload(fileNodeId),
    completeUpload(s3Key, size, mimeType),
    downloadBlob(fileNodeId),
    overwriteBlob(fileNodeId, buffer),
    deleteBlob(fileNodeId),
    getActiveS3Key(fileNodeId),
    // WebDAV-specific methods (no-op in S3 mode):
    uploadToWebdav(webdavPath, buffer),
    downloadFromWebdav(webdavPath),
    deleteOnWebdav(webdavPath),
    headOnWebdav(webdavPath)
  };
}
```

### 2.3 Methods

#### `prepareUpload(fileNodeId)`

Prepares a new upload by creating a pending object_map entry. Orphans any existing active row for the same file node.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node being uploaded to |

**Returns:** string — UUID s3Key for the pending upload

**DB operations:** `upsertObjectMap(fileNodeId, s3Key, 'pending')` — if active row exists, marks it orphaned then INSERTs new pending.

#### `completeUpload(s3Key, size, mimeType)`

Finalizes an upload: transitions object_map from pending→active and writes filecache metadata.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| s3Key | string | yes | The UUID key returned by prepareUpload |
| size | number | yes | Content length in bytes |
| mimeType | string | yes | MIME type of the uploaded content |

**DB operations:** `activateObject(s3Key)` + `upsertCache(fileNodeId, size, mimeType, null)`

#### `downloadBlob(fileNodeId)`

Downloads blob content for an active file node. Returns buffer or null if no active object exists.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to download |

**Returns:** Buffer \| null

**Operations:** `getActiveObject(fileNodeId)` → `blobStore.downloadBlob(s3Key)`

#### `overwriteBlob(fileNodeId, buffer)`

Overwrites a file's content: orphans old key, uploads new blob, creates active mapping.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to overwrite |
| buffer | Buffer | yes | New content to upload |

**Returns:** string — new s3Key

**Operations:** orphan old key → `blobStore.uploadBlob(newS3Key, buffer)` → INSERT active mapping

#### `deleteBlob(fileNodeId)`

Marks the active object as orphaned. Actual S3 deletion is deferred to GC service (Phase 6).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to delete blob for |

**Operations:** `orphanObject(currentS3Key)` — no-op if no active object exists.

#### `getActiveS3Key(fileNodeId)`

Returns the s3_key of the currently active object, or null.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node |

**Returns:** string \| null

### 2.4 Dependencies

- `blobStore` — S3 blob operations (`uploadBlob`, `downloadBlob`) from Phase 1 adapter
- `fileNodesStore` — object_map and filecache CRUD operations

---

## 3. WebDAV Mode (WebdavBlobStore Adapter)

Factory dispatch logic: `WEA_FILE_STORAGE=s3` → uses S3BlobStore; `WEA_FILE_STORAGE=webdav` → uses WebdavBlobStore. Factory validates that required config keys are present for the selected mode before instantiation.

### 3.1 Interface Methods

Methods matching S3BlobStore shape for dispatch uniformity:

| Method | Signature | Description |
|--------|-----------|-------------|
| uploadToWebdav | `(webdavPath, buffer) → Promise<void>` | PUT to WebDAV server at resolved path |
| downloadFromWebdav | `(webdavPath) → Promise<Buffer \| null>` | GET from WebDAV; returns null if 404 |
| deleteOnWebdav | `(webdavPath) → Promise<void>` | DELETE on WebDAV; idempotent for missing resources (404 = no throw) |
| headOnWebdav | `(webdavPath) → Promise<{ contentLength: number, contentType: string } \| null>` | HEAD request |

### 3.2 Path Resolution

`file_node_id` → reconstruct display path via `fileNodeService.getNodePath(nodeId)` → pass to WebDAV methods.

---

## 4. Dual-Backend Dispatch Table

| Operation | S3 Mode | WebDAV Mode |
|-----------|---------|-------------|
| prepareUpload | orphan old + INSERT pending | no-op (synchronous) |
| completeUpload | UPDATE active + filecache | no separate step; upload is atomic |
| downloadBlob | blobStore.downloadBlob(s3Key) | webdavClient.downloadFromWebdav(path) |
| overwriteBlob | ensureExclusiveBlob (split shared) → orphan+upload+activate | webdav PUT at same path |
| deleteBlob | mark orphaned in object_map | webdav DELETE (best-effort) |
| countActiveObjectsByS3Key | COUNT active object_map rows by s3_key | always 0 (no s3_key concept) |
| duplicateBlob | download current blob → upload under new key → return key | n/a (copy = download + uploadToWebdav) |
| linkObject(fileNodeId, s3Key) | INSERT object_map (file_node_id, s3_key, 'active') | n/a |
| ensureExclusiveBlob(fileNodeId) | write barrier: if countActiveObjectsByS3Key > 1, split shared blob before mutation | no-op |

---

## 5. Error Cases

### S3 Mode

- No active object for download → returns null (no throw)
- completeUpload with unknown s3Key → throws error
- deleteBlob with no active object → no-op, no error

### WebDAV Mode

- Connection refused / timeout → logs error; sets `sync_status='orphaned_node'` on affected file node rather than throwing
- 404 on remote (downloadFromWebdav) → returns null (no throw)
- 404 on DELETE (deleteOnWebdav) → idempotent no-op (no throw)

All WebDAV errors during file metadata operations must set `sync_status='orphaned_node'` rather than throwing.

## 6. Version Number Policy

Single-version mode: `version_number` is always 1 in all INSERT operations. The `UNIQUE(file_node_id, version_number)` constraint exists for future version history expansion but currently only one active version per node is maintained.

## 7. Verification Scenarios

- [ ] prepareUpload creates pending entry with valid UUID s3Key
- [ ] prepareUpload orphans previous active row before inserting new pending
- [ ] completeUpload transitions pending→active and writes filecache metadata
- [ ] downloadBlob with active object returns buffer matching uploaded content
- [ ] downloadBlob with no active object returns null
- [ ] overwriteBlob orphans old key and creates new active mapping
- [ ] deleteBlob marks active object orphaned (no S3 deletion)
- [ ] deleteBlob with no active object is a no-op

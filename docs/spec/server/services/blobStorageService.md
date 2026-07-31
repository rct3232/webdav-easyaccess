# blobStorageService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Blob lifecycle management for S3 storage. Handles prepareUpload (pending object_map entry), completeUpload (pending→active + filecache write), download (S3 retrieval via active key), overwrite (orphan old + upload new + activate), delete (mark orphaned, actual S3 deletion deferred to GC). S3 mode only; WebDAV support deferred to Phase 3. Factory `createBlobStorageService({ blobStore, fileNodesStore })`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/service/blobStorageService.js`
- **Test file:** `server/service/__tests__/blobStorageService.test.js`

### 2.2 Factory Function Signature

```js
function createBlobStorageService({ blobStore, fileNodesStore }) {
  return {
    prepareUpload(fileNodeId),
    completeUpload(s3Key, size, mimeType),
    downloadBlob(fileNodeId),
    overwriteBlob(fileNodeId, buffer),
    deleteBlob(fileNodeId),
    getActiveS3Key(fileNodeId)
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

### 2.5 Error Cases

- No active object for download → returns null (no throw)
- completeUpload with unknown s3Key → throws error
- deleteBlob with no active object → no-op, no error

### 2.6 Version Number Policy

Single-version mode: `version_number` is always 1 in all INSERT operations. The `UNIQUE(file_node_id, version_number)` constraint exists for future version history expansion but currently only one active version per node is maintained.

### 2.7 Verification Scenarios

- [ ] prepareUpload creates pending entry with valid UUID s3Key
- [ ] prepareUpload orphans previous active row before inserting new pending
- [ ] completeUpload transitions pending→active and writes filecache metadata
- [ ] downloadBlob with active object returns buffer matching uploaded content
- [ ] downloadBlob with no active object returns null
- [ ] overwriteBlob orphans old key and creates new active mapping
- [ ] deleteBlob marks active object orphaned (no S3 deletion)
- [ ] deleteBlob with no active object is a no-op

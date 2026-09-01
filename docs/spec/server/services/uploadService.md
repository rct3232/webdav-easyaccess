# uploadService Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role | Upload orchestration service. Manages the 4-step upload flow (TX1: DB INSERT → S3 PUT → TX2: DB UPDATE) with explicit transaction boundaries and failure recovery states. Owns TX ownership — all service methods are TX-agnostic. Factory `createUploadService({ fileNodeService, blobStorageService, blobStore, storage })`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/service/uploadService.js`
- **Test file:** `server/service/__tests__/uploadService.test.js`

### 2.2 Factory Function Signature

```js
function createUploadService({ fileNodeService, blobStorageService, blobStore, storage }) {
  return {
    uploadFile(parentNodeId, name, buffer, mimeType),
    overwriteFile(fileNodeId, buffer, mimeType),
    downloadFile(fileNodeId)
  };
}
```

### 2.3 Methods

#### `uploadFile(parentNodeId, name, buffer, mimeType)`

Creates a new file: TX1 creates node + pending blob mapping → S3 PUT uploads content → TX2 finalizes with active status + filecache metadata.

| Param        | Type           | Required | Description                                         |
| ------------ | -------------- | -------- | --------------------------------------------------- |
| parentNodeId | number \| null | yes      | Parent directory; null for root-level creation      |
| name         | string         | yes      | File name (subject to UNIQUE constraint per parent) |
| buffer       | Buffer         | yes      | File content bytes                                  |
| mimeType     | string         | yes      | MIME type of the file                               |

**Returns:** `{ nodeId, s3Key, size, mimeType }`

**Flow:**

1. **TX1:** `fileNodeService.createFile(parentNodeId, name)` + `blobStorageService.prepareUpload(nodeId)` — creates node with sync_status='pending_upload' and object_map entry with status='pending'
2. **S3 PUT:** `blobStore.uploadBlob(s3Key, buffer)` — outside transaction boundary
3. **TX2:** `blobStorageService.completeUpload(s3Key, size, mimeType)` + `fileNodeService.updateSyncStatus(nodeId, 'active')` — transitions pending→active, writes filecache

#### `overwriteFile(fileNodeId, buffer, mimeType)`

Overwrites existing file content: TX1 prepares new version → S3 PUT uploads new content → TX2 finalizes.

| Param      | Type   | Required | Description                               |
| ---------- | ------ | -------- | ----------------------------------------- |
| fileNodeId | number | yes      | ID of the existing file node to overwrite |
| buffer     | Buffer | yes      | New content bytes                         |
| mimeType   | string | yes      | MIME type of the new content              |

**Returns:** `{ nodeId, s3Key, size, mimeType }`

**Flow:**

1. **TX1:** `blobStorageService.prepareUpload(fileNodeId)` + `fileNodeService.updateSyncStatus(fileNodeId, 'pending_upload')` — orphans old active key, creates new pending entry
2. **S3 PUT:** `blobStore.uploadBlob(s3Key, buffer)` — outside transaction boundary
3. **TX2:** `blobStorageService.completeUpload(s3Key, size, mimeType)` + `fileNodeService.updateSyncStatus(fileNodeId, 'active')`

#### `downloadFile(fileNodeId)`

Downloads file content through blobStorageService (pass-through).

| Param      | Type   | Required | Description                     |
| ---------- | ------ | -------- | ------------------------------- |
| fileNodeId | number | yes      | ID of the file node to download |

**Returns:** Buffer \| null

### 2.4 Dependencies

- `fileNodeService` — tree operations (createFile, updateSyncStatus)
- `blobStorageService` — blob lifecycle (prepareUpload, completeUpload)
- `blobStore` — direct S3 access for upload step between TX1 and TX2 (`uploadBlob`)
- `storage` — transaction helpers (`getBackend`, `withTransaction`, `withSqliteTransaction`)

### 2.5 Failure Recovery States

| Failure Point | DB State                                           | S3 State            | Recovery                                           |
| ------------- | -------------------------------------------------- | ------------------- | -------------------------------------------------- |
| TX1 fails     | ROLLBACK, nothing persisted                        | Nothing written     | Idempotent retry                                   |
| S3 PUT fails  | object_map='pending', sync_status='pending_upload' | Nothing uploaded    | Retry endpoint or GC Tier 1 cleanup                |
| TX2 fails     | object_map='pending'; sync_status='pending_upload' | Blob uploaded in S3 | GC Tier 2 (listOrphanedKeys) cleans untracked blob |

### 2.6 Error Cases

- Duplicate file name under same parent → UNIQUE constraint error from DB (TX1 rollback)
- S3 PUT failure (network, permissions) → object_map stays 'pending', recoverable by retry or GC
- TX2 failure after successful S3 PUT → orphaned blob in S3, recovered by Tier 2 GC

### 2.7 Verification Scenarios

- [ ] uploadFile success: node created, pending→active transition, S3 blob uploaded, filecache populated
- [ ] uploadFile TX1 failure: ROLLBACK leaves nothing persisted in DB or S3
- [ ] uploadFile S3 PUT failure: object_map='pending' in DB; no blob in S3; recoverable state
- [ ] uploadFile TX2 failure: object_map='pending'; sync_status='pending_upload'; blob exists in S3; GC Tier 2 recoverable
- [ ] overwriteFile success: old key orphaned, new key active, filecache updated
- [ ] overwriteFile TX1 failure: ROLLBACK preserves original state entirely
- [ ] downloadFile returns buffer matching uploaded content
- [ ] downloadFile for non-existent node returns null

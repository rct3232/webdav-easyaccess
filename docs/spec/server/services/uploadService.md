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

**Failure rollback (steps 2–3):** steps 2 and 3 run inside one `try`; on ANY failure after TX1
committed, the just-created node is rolled back via `fileNodeService.deleteNode(nodeId)` (CASCADE
removes the pending object_map row) and the original error is re-thrown. A failed new-file upload
therefore never leaves a phantom 0-byte file row in listings and never blocks a retry with a
duplicate-name conflict. A blob that was fully written before a TX2 failure remains in S3 as an
untracked object (see §2.5).

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

A failed **new-file** upload (`uploadFile`) is fully rolled back so no visible DB residue remains;
an **overwrite** (`overwriteFile`) is protected at TX1 only (its post-TX1 failure state has no
automatic recovery — tracked in `docs/IMPROVEMENT_PLAN.md`).

| Method                        | Failure Point | DB State after failure                                           | Storage State                      | Behavior / Recovery (implemented)                                  |
| ----------------------------- | ------------- | ---------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| uploadFile (new file)         | TX1 fails     | ROLLBACK, nothing persisted                                      | Nothing written                   | Idempotent retry (duplicate check guards re-create)               |
| uploadFile (new file)         | S3 PUT fails  | Node rolled back (deleteNode) — nothing persisted                | Nothing (or partial object)       | No DB residue; partial untracked object → GC Tier 2 target        |
| uploadFile (new file)         | TX2 fails     | Node rolled back (deleteNode) — nothing persisted                | Blob uploaded (untracked)         | GC Tier 2 (listOrphanedKeys) removes untracked blob               |
| overwriteFile (existing file) | TX1 fails     | ROLLBACK — original active version preserved                     | Nothing written                   | Idempotent retry                                                  |
| overwriteFile (existing file) | S3 PUT fails  | object_map='pending'; sync_status='pending_upload'               | Nothing (or partial object)       | No automatic recovery (manual/GC gap — see `docs/IMPROVEMENT_PLAN.md`) |
| overwriteFile (existing file) | TX2 fails     | object_map='pending'; sync_status='pending_upload'               | New blob uploaded (untracked)     | No automatic recovery (manual/GC gap — see `docs/IMPROVEMENT_PLAN.md`) |

### 2.6 Error Cases

- Duplicate file name under same parent → UNIQUE constraint error from DB (TX1 rollback)
- S3 PUT failure during new-file upload (network, permissions) → created node rolled back; original error re-thrown to caller
- S3 PUT failure during overwrite → node stays `pending_upload` with pending object_map (no automatic recovery — see `docs/IMPROVEMENT_PLAN.md`)
- TX2 failure after successful S3 PUT (new file) → node rolled back; blob orphaned in S3, removed by Tier 2 GC
- `fileNodeService.deleteNode` cleanup failure during rollback is best-effort (swallowed) — the original upload error is always surfaced

### 2.7 Verification Scenarios

- [ ] uploadFile success: node created, pending→active transition, S3 blob uploaded, filecache populated
- [ ] uploadFile TX1 failure: ROLLBACK leaves nothing persisted in DB or S3
- [ ] uploadFile S3 PUT failure: node + pending object_map rolled back (no row remains); error propagated; no blob in S3
- [ ] uploadFile TX2 failure: node rolled back; blob remains in S3 as untracked object; error propagated
- [ ] overwriteFile success: old key orphaned, new key active, filecache updated
- [ ] overwriteFile TX1 failure: ROLLBACK preserves original state entirely
- [ ] downloadFile returns buffer matching uploaded content
- [ ] downloadFile for non-existent node returns null

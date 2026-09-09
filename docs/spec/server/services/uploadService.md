# uploadService Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role | Upload orchestration service. Manages the 4-step upload flow (TX1: DB INSERT → S3 PUT → TX2: DB UPDATE) with explicit transaction boundaries and failure recovery states. Owns TX ownership — all service methods are TX-agnostic. Factory `createUploadService({ fileNodeService, blobStorageService, blobStore, fileNodesStore })`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/service/uploadService.js`
- **Test file:** `server/service/__tests__/uploadService.test.js`

### 2.2 Factory Function Signature

```js
function createUploadService({ fileNodeService, blobStorageService, blobStore, fileNodesStore }) {
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

Overwrites existing file content: pre-state capture → TX1 prepares new version → S3 PUT uploads new content → TX2 finalizes; on S3 PUT or TX2 failure the pre-state is restored (rollback).

| Param      | Type   | Required | Description                               |
| ---------- | ------ | -------- | ----------------------------------------- |
| fileNodeId | number | yes      | ID of the existing file node to overwrite |
| buffer     | Buffer | yes      | New content bytes                         |
| mimeType   | string | yes      | MIME type of the new content              |

**Returns:** `{ nodeId, s3Key, size, mimeType }`

**Flow:**

0. **Pre-state capture:** `fileNodesStore.getActiveObject(fileNodeId)` — before TX1, captures the pre-state active `object_map` row (its `id` and `s3_key`, i.e. the last-good version B_k) and the current filecache values (`size`, `mime_type`, `content_hash` via `getCache`)
1. **TX1:** `blobStorageService.prepareUpload(fileNodeId)` + `fileNodeService.updateSyncStatus(fileNodeId, 'pending_upload')` — orphans old active key, creates new pending entry
2. **S3 PUT:** `blobStore.uploadBlob(s3Key, buffer)` — outside transaction boundary
3. **TX2:** `blobStorageService.completeUpload(s3Key, size, mimeType)` + `fileNodeService.updateSyncStatus(fileNodeId, 'active')`

**Failure rollback (steps 2–3):** if the S3 PUT or TX2 fails, a best-effort rollback runs inside
one `withTx`: `fileNodesStore.reactivateObjectMapRow(preState.id)` (guarded
`UPDATE ... WHERE id=? AND status='orphaned'`), node `sync_status` → `'active'` via
`updateSyncStatus`, and deletion of the v_{k+1} pending `object_map` row by the captured new
`s3Key`. Outside the TX, the pending blob is removed best-effort via `blobStore.deleteBlob(newS3Key)`
and the captured filecache values are re-asserted via `upsertCache`. The original error is
re-thrown. The last-good blob B_k is never deleted, so after a failed overwrite the file remains
downloadable as the previous version. If the pre-state row was not found (no active row existed
before TX1), the rollback skips reactivation and still cleans the pending row/blob (best-effort;
any residual state is handled by scan/repair and GC cleanup — see §2.5).

#### `downloadFile(fileNodeId)`

Downloads file content through blobStorageService (pass-through).

| Param      | Type   | Required | Description                     |
| ---------- | ------ | -------- | ------------------------------- |
| fileNodeId | number | yes      | ID of the file node to download |

**Returns:** Buffer \| null

### 2.4 Dependencies

- `fileNodeService` — tree operations (createFile, updateSyncStatus)
- `blobStorageService` — blob lifecycle (prepareUpload, completeUpload)
- `blobStore` — direct S3 access for upload step between TX1 and TX2 (`uploadBlob`) and pending-blob cleanup on overwrite rollback (`deleteBlob`)
- `fileNodesStore` — direct object_map/filecache access for overwrite pre-state capture and rollback (`getActiveObject`, `reactivateObjectMapRow`, `upsertCache`)

Transaction helpers (`getBackend`, `withTransaction`, `withSqliteTransaction`) are resolved from the
`server/store/storage` module inside the service — they are not injected factory parameters.

### 2.5 Failure Recovery States

A failed **new-file** upload (`uploadFile`) is fully rolled back so no visible DB residue remains;
a failed **overwrite** (`overwriteFile`) rolls back to the pre-state — the node is restored to
`active` with the previous version still downloadable. Only if the rollback itself fails does the
documented `pending_upload` stuck state remain, handled by scan/repair + GC cleanup (DEF-12/13,
`docs/IMPROVEMENT_PLAN.md`).

| Method                        | Failure Point | DB State after failure                                           | Storage State                      | Behavior / Recovery (implemented)                                  |
| ----------------------------- | ------------- | ---------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| uploadFile (new file)         | TX1 fails     | ROLLBACK, nothing persisted                                      | Nothing written                   | Idempotent retry (duplicate check guards re-create)               |
| uploadFile (new file)         | S3 PUT fails  | Node rolled back (deleteNode) — nothing persisted                | Nothing (or partial object)       | No DB residue; partial untracked object → GC Tier 2 target        |
| uploadFile (new file)         | TX2 fails     | Node rolled back (deleteNode) — nothing persisted                | Blob uploaded (untracked)         | GC Tier 2 (listOrphanedKeys) removes untracked blob               |
| overwriteFile (existing file) | TX1 fails     | ROLLBACK — original active version preserved                     | Nothing written                   | Idempotent retry                                                  |
| overwriteFile (existing file) | S3 PUT fails  | Rolled back to pre-state: node `active`, previous active object_map row reactivated, pending v_{k+1} row deleted | Pending blob deleted (best-effort); last-good blob B_k kept | File remains downloadable as the previous version; if the rollback itself fails, the `pending_upload` state remains (scan/repair + GC cleanup — DEF-12/13) |
| overwriteFile (existing file) | TX2 fails     | Rolled back to pre-state: node `active`, previous active object_map row reactivated, pending v_{k+1} row deleted, filecache values re-asserted | New blob deleted (best-effort); last-good blob B_k kept | Same as S3 PUT failure |

### 2.6 Error Cases

- Duplicate file name under same parent → UNIQUE constraint error from DB (TX1 rollback)
- S3 PUT failure during new-file upload (network, permissions) → created node rolled back; original error re-thrown to caller
- S3 PUT failure during overwrite → best-effort rollback to pre-state (previous active row reactivated, node `active`, pending row/blob deleted); file remains downloadable as the previous version; original error re-thrown. If the rollback itself fails, the node stays `pending_upload` with a pending object_map (scan/repair + GC cleanup — see `docs/IMPROVEMENT_PLAN.md`)
- TX2 failure after successful S3 PUT (overwrite) → same best-effort rollback as S3 PUT failure; the uploaded new blob is deleted best-effort and the last-good blob B_k is never deleted
- TX2 failure after successful S3 PUT (new file) → node rolled back; blob orphaned in S3, removed by Tier 2 GC
- `fileNodeService.deleteNode` cleanup failure during rollback is best-effort (swallowed) — the original upload error is always surfaced

### 2.7 Verification Scenarios

- [ ] uploadFile success: node created, pending→active transition, S3 blob uploaded, filecache populated
- [ ] uploadFile TX1 failure: ROLLBACK leaves nothing persisted in DB or S3
- [ ] uploadFile S3 PUT failure: node + pending object_map rolled back (no row remains); error propagated; no blob in S3
- [ ] uploadFile TX2 failure: node rolled back; blob remains in S3 as untracked object; error propagated
- [ ] overwriteFile success: old key orphaned, new key active, filecache updated
- [ ] overwriteFile TX1 failure: ROLLBACK preserves original state entirely
- [ ] overwriteFile S3 PUT failure → rolled back: previous active object_map row reactivated, node `sync_status='active'`, pending v_{k+1} row deleted, pending blob deleted, file downloadable as previous version, original error propagated
- [ ] overwriteFile TX2 failure → rolled back: same pre-state restoration (including filecache re-assert), new blob deleted, last-good blob B_k untouched, error propagated
- [ ] downloadFile returns buffer matching uploaded content
- [ ] downloadFile for non-existent node returns null

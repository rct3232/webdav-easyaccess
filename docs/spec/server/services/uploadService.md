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

#### 2.5.1 Stuck-state scan and repair (failSafeService)

When a rollback itself fails (or a crash lands between TX1 and the blob write), the residue is a
**file node** with `sync_status='pending_upload'` that never reached `active`. The fail-safe service
(`server/service/failSafeService.js`) scans and repairs these nodes. **S3 mode only**: the stuck
`pending_upload` state is an S3-upload artifact — in WebDAV mode file nodes intentionally keep
`pending_upload` for their whole lifetime (path-addressed backend; `fileService.md` §4), so both
the scan and the repair actions are gated to `fileStorageMode === 's3'` (the scan returns an empty
list and repair is refused with 409 in WebDAV mode). Directories are excluded — `createNode` starts
every node as `pending_upload` and directory nodes intentionally never transition to `active`, so
only file nodes are stuck-state candidates.

**Stuck-state shapes:**

| Shape | Rows | Blob | Detection |
| ----- | ---- | ---- | --------- |
| Overwrite residue | node `pending_upload`; v_k row `orphaned` (last good); v_{k+1} row `pending` | B_{k+1} maybe present; B_k present | an `orphaned` object_map row exists on the node |
| New-file residue | node `pending_upload`; single `pending` row (or no row at all) | maybe present | no `orphaned` row on the node |

**Scan** — `scanPendingUploadNodes()` enumerates file nodes via `getNodesBySyncStatus('pending_upload')`
and reports `{ nodeId, name, type, path, createdAt, updatedAt, classification: 'overwrite' | 'new-file', pendingS3Key, blobPresent }`.
`pendingS3Key` is the pending row's `s3_key` (null when absent); `blobPresent` is a read-only
`blobStore.headBlob` probe (`null` = no pending key or probe failed, `false` = key exists but the
blob is absent). The scan is strictly read-only.

**Repair** — `repairPendingUploadNode(nodeId, { action })` with actions:

| Action | Preconditions | Effect |
| ------ | ------------- | ------ |
| `complete` | pending row + blob present (else 409) | `activateObject(pending.s3_key)`, `upsertCache(nodeId, blob.contentLength, blob.contentType, null)` and node → `active` inside one TX — mirrors `blobStorageService.completeUpload` using blob HEAD metadata |
| `restore-previous` | an `orphaned` last-good row exists (else 409) | In one TX: `reactivateObjectMapRow(lastGood.id)` (highest `version_number`), pending v_{k+1} row deleted (`deleteObjectMapRows`), node → `active`. Outside the TX the pending blob is deleted best-effort; the last-good blob B_k is never touched |
| `delete` | — | Pending blob deleted best-effort, then `fileNodeService.deleteNode` removes the node tree (object_map/filecache rows cascade). A last-good blob, if any, becomes untracked and is left to GC Tier 2 |
| `auto` | — | D2 policy: overwrite residue (orphaned row present) → `restore-previous`; new-file residue with blob present → `complete`; new-file residue without blob → `delete` |

Errors: unknown action → 400 (`repairUploadInvalidAction`); WebDAV storage mode → 409
(`repairUploadNotPending`; repair is S3-mode only); missing node → 404
(`repairSyncNodeNotFound`); node not in `pending_upload` (or a required row is missing) → 409
(`repairUploadNotPending`); `complete` with an absent blob → 409 (`repairUploadBlobMissing`).
`auto` propagates blob-probe errors (an unknown blob state never triggers a destructive choice).

**Startup report (report-only)** — `runStartupRecovery()` extends its report with a
`pendingUpload: { scanned, nodes, error? }` section built from `scanPendingUploadNodes()`. It never
mutates anything; resolution is manual via `POST /api/admin/maintenance/repair-sync`. The startup
hook (`runStartupFailSafeRecovery` in `server/infrastructure/maintenanceScheduler.js`) logs the
count only when it is non-zero (threshold-gated); `POST /api/admin/cleanup/orphaned` surfaces the
same list as the additive `pendingUploadNodes` result key.

### 2.6 Error Cases

- Duplicate file name under same parent → UNIQUE constraint error from DB (TX1 rollback)
- S3 PUT failure during new-file upload (network, permissions) → created node rolled back; original error re-thrown to caller
- S3 PUT failure during overwrite → best-effort rollback to pre-state (previous active row reactivated, node `active`, pending row/blob deleted); file remains downloadable as the previous version; original error re-thrown. If the rollback itself fails, the node stays `pending_upload` with a pending object_map (scan/repair + GC cleanup — see `docs/IMPROVEMENT_PLAN.md`)
- TX2 failure after successful S3 PUT (overwrite) → same best-effort rollback as S3 PUT failure; the uploaded new blob is deleted best-effort and the last-good blob B_k is never deleted
- TX2 failure after successful S3 PUT (new file) → node rolled back; blob orphaned in S3, removed by Tier 2 GC
- `fileNodeService.deleteNode` cleanup failure during rollback is best-effort (swallowed) — the original upload error is always surfaced
- Repair of a `pending_upload` stuck node (failSafeService): unknown action → 400; missing node → 404; node not stuck or required row missing → 409; `complete` with absent blob → 409. `restore-previous`/`delete` blob deletions are best-effort (swallowed) and never delete the last-good blob B_k

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
- [ ] scan classifies overwrite residue (orphaned v_k + pending v_{k+1}) as `overwrite` and new-file residue (pending row only / no row) as `new-file`; directories are never reported
- [ ] repair `complete`: pending row activated, node `active`, filecache populated from blob HEAD metadata
- [ ] repair `restore-previous`: last-good orphaned row reactivated, pending row deleted, pending blob deleted, node `active`, last-good blob kept and downloadable
- [ ] repair `delete`: node tree + object_map rows removed, pending blob deleted best-effort
- [ ] repair `auto`: overwrite residue → `restore-previous`; new-file with blob → `complete`; new-file without blob → `delete`
- [ ] startup report lists stuck nodes and performs zero mutations

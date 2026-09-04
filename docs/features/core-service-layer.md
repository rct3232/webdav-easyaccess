# Core Service Layer

This document describes the Phase 2 core service layer architecture for filesystem tree management, blob lifecycle control, and upload orchestration against the S3+PostgreSQL storage backend. It references [ARCHITECTURE.md](../ARCHITECTURE.md) and [TESTING_STRATEGY.md](../TESTING_STRATEGY.md).

---

## Overview

The core service layer provides filesystem tree management, blob lifecycle control, and upload orchestration for the S3+PostgreSQL storage backend. The architecture follows a layered dependency model with factory-function-based dependency injection consistent with existing `createFileService` and `createBlobStore` conventions. Transaction ownership lives at the orchestration layer only — individual service methods are transaction-agnostic.

```
uploadService.js          ← Orchestration (TX1 → S3 PUT → TX2 flow)
  ├── fileNodeService.js   ← Tree operations (create/move/rename/delete/list/resolvePath)
  │       └── _ancestryHelper.js ← Closure table maintenance
  │               └── fileNodesStore.js ← SQL query layer (PostgreSQL / SQLite branching)
  └── blobStorageService.js ← Blob lifecycle (prepareUpload → completeUpload → download)
          └── S3BlobStore / NoOpBlobStore (Phase 1 adapters)
```

---

## Responsibility boundaries

| Service              | Owns                                                                                | Does NOT own                                                                          |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `uploadService`      | TX boundaries, 4-step flow coordination, S3 PUT between transactions                | No direct DB queries; no raw blob operations                                          |
| `fileNodeService`    | Tree CRUD, cycle detection, path resolution, ancestor chain dispatching             | No closure table algorithms (delegates to `_ancestryHelper`)                          |
| `_ancestryHelper`    | Closure table algorithms: build on insert, rebuild on move (BFS), cleanup on delete | No DB queries; calls only `fileNodesStore` methods                                    |
| `blobStorageService` | Object map lifecycle (`pending→active→orphaned`), filecache metadata writes         | No direct S3 operations except `downloadBlob` pass-through and `overwriteBlob` upload |
| `fileNodesStore`     | SQL query execution, PostgreSQL/SQLite branching                                    | No transaction wrapping; no business logic beyond single-row/batch SQL                |

These boundaries are about **who owns data mutations and orchestration concerns**; they define the service contract surface that tests verify against.

---

## Flows

### Upload flow (4-step)

```mermaid
sequenceDiagram
    participant C as Client
    participant US as uploadService
    participant FNS as fileNodeService
    participant AH as _ancestryHelper
    participant FStore as fileNodesStore
    participant BS as blobStorageService
    participant S3 as S3 Blob Store

    C->>US: upload({ file, parentPath })

    Note over US,S3: TX1
    US->>FNS: createFileNode(parentId, name, type)
    FNS->>AH: buildAncestorsForNode(nodeId)
    AH->>FStore: insertClosureTableRows(nodeId, ancestors)
    FStore-->>US: ok
    US->>BS: prepareUpload(nodeId)
    BS->>FStore: upsertObjectMap(pending)
    BS-->>US: s3Key

    Note over US,S3: S3 PUT (outside transaction)
    US->>S3: uploadBlob(s3Key, buffer)
    S3-->>US: success

    Note over US,S3: TX2
    US->>BS: completeUpload(nodeId, s3Key, metadata)
    BS->>FStore: activateObject(nodeId, s3Key)
    BS->>FStore: upsertCache(metadata)
    FStore-->>US: ok
    US->>FNS: updateSyncStatus('active')
    FNS-->>US: ok

    US-->>C: { nodeId, s3Key, size, mimeType }
```

### Overwrite flow

```mermaid
sequenceDiagram
    participant C as Client
    participant US as uploadService
    participant BS as blobStorageService
    participant S3 as S3 Blob Store
    participant FStore as fileNodesStore

    C->>US: overwrite({ nodeId, file })

    Note over US,S3: TX1
    US->>BS: prepareUpload(nodeId)
    BS->>FStore: orphan old active row
    BS->>FStore: insert new pending row
    FStore-->>US: s3Key
    US->>FStore: updateSyncStatus('pending_upload')

    Note over US,S3: S3 PUT (outside transaction)
    US->>S3: uploadBlob(newS3Key, buffer)
    S3-->>US: success

    Note over US,S3: TX2
    US->>BS: completeUpload(nodeId, newS3Key, metadata)
    BS->>FStore: activateObject + upsertCache
    FStore-->>US: ok
    US->>FStore: updateSyncStatus('active')

    US-->>C: { nodeId, s3Key, size, mimeType }
```

### Download flow

```mermaid
sequenceDiagram
    participant C as Client
    participant BS as blobStorageService
    participant FStore as fileNodesStore
    participant S3 as S3 Blob Store

    C->>BS: downloadBlob(fileNodeId)
    BS->>FStore: getActiveObject(fileNodeId)
    FStore-->>BS: s3Key (active row)
    BS->>S3: getObject(s3Key)
    S3-->>BS: Buffer | null
    BS-->>C: Buffer | null
```

### Move flow (with closure table rebuild)

```mermaid
sequenceDiagram
    participant C as Client
    participant FNS as fileNodeService
    participant AH as _ancestryHelper
    participant FStore as fileNodesStore

    C->>FNS: moveNode(nodeId, newParentId)

    Note over FNS,FStore: Cycle detection
    FNS->>FStore: getDescendantIds(nodeId)
    FStore-->>FNS: descendantSet
    alt newParentId in descendantSet
        FNS-->>C: 409 Conflict (cycle detected)
    end

    Note over FNS,FStore: TX
    FNS->>FStore: update parentId for nodeId
    FNS->>AH: rebuildAncestorsAfterMove(nodeId, newParentId)
    AH->>FStore: delete existing closure rows for nodeId
    AH->>FStore: insert new closure rows (BFS from root to nodeId)
    FStore-->>FNS: ok

    FNS-->>C: 200 OK
```

---

## Failure recovery

| Failure Point | DB State                                                                                          | S3 State          | Recovery Path                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| TX1 fails     | ROLLBACK, nothing persisted                                                                       | Nothing           | Idempotent retry                                                                                       |
| S3 PUT fails  | New-file upload: node rolled back (deleteNode), nothing persisted                                 | Nothing or partial object | None needed — no visible residue; untracked partial object is a Tier 2 GC target                |
| TX2 fails     | New-file upload: node rolled back (deleteNode), nothing persisted                                 | Blob exists in S3 | Blob is untracked; GC Tier 2: `listOrphanedKeys` finds S3 blob with no DB mapping → deletes it          |
| S3 PUT / TX2 fails (overwrite of an existing file) | Node remains `sync_status='pending_upload'` with a pending `object_map` row       | Nothing or new blob | No automatic recovery implemented (manual/GC gap — see `docs/IMPROVEMENT_PLAN.md`)                  |

> Note: `uploadService.uploadFile` (new file) rolls back the created node on any failure after TX1 so
> a failed upload never leaves a phantom 0-byte file in listings. `overwriteFile` (existing file) is
> protected at TX1 only — a post-TX1 failure leaves the pending state; automatic recovery for that
> path is not implemented (tracked in `docs/IMPROVEMENT_PLAN.md`).

---

## Testing strategy

### Unit vs integration split

- **fileNodesStore tests:** In-memory SQLite backend, verify all CRUD + ancestor + object_map operations. No mocks — real database queries.
- **\_ancestryHelper tests:** Real `fileNodesStore` against in-memory SQLite. Verify closure table correctness at depth 0/1/N after every mutation.
- **blobStorageService tests:** `s3Mock` for S3 operations, real SQLite for DB layer. Verify `pending→active→orphaned` transitions.
- **uploadService tests:** Integration test with real SQLite + `s3Mock`. Simulate failure at each of 3 points (TX1, S3 PUT, TX2), verify recoverable state after each.

### Mock strategy

- `s3Mock` — in-memory Map-backed mock of S3 operations; no real AWS connection required.
- SQLite — real in-memory database for all tests (not a mock).
- No mocking of `fileNodesStore` or storage layer in service-level tests.

Use [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) for contract and mocking guidance.

---

## Scope notes

- **Phase 2 delivered S3 mode only.** WebDAV blob storage support was deferred from Phase 2 to Phase 4 (not Phase 3), where `blobStorageService` was extended with a `WebdavBlobStore` adapter (Phase 4 Task 4.0). Blob mode is selected via `WEA_FILE_STORAGE=s3|webdav`.
- **Phase 4 added a composition root** (`server/service/composition.js`): it builds `fileNodeService`, `blobStorageService`, `uploadService`, `aclService`, and `fileService` once at startup. The blob store (S3BlobStore vs WebdavBlobStore) and file storage mode (`fileStorageMode` from `WEA_FILE_STORAGE`, default `'s3'`) are resolved there and injected into the services, so no service reads backend-specific config directly.
- **Version history** infrastructure is in place (`version_number` column in `object_map`) but single-version mode is enforced (always `version_number=1`). Multi-version support is a future expansion.

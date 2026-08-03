# files routes Spec (Phase 6 Domain Split)

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/files` |
| Role | File and folder operations: list, download, upload, rename, batch move/copy/delete, metadata, conflicts, thumbnails, bulk job status. Post-Phase 4, all routes accept `nodeId` exclusively; path strings are display-only in responses and never accepted in request payloads. |

---

## 2. Implementation Spec

### 2.1 File Path (Post-Phase 6)

The monolithic `server/routes/files.js` was split into domain-bounded modules:

| Route Module | Source File | Mount Point | Endpoints |
|-------------|-------------|-------------|-----------|
| CRUD operations | `domains/files/routes/crud.js` | `/api/files` | check-conflicts, metadata, list, download, upload, rename |
| Batch operations | `domains/files/routes/batch.js` | `/api/files` | batch-delete, batch-move, batch-copy, bulk-operation/:jobId, :jobId/cancel |
| Preview & thumbnails | `domains/files/routes/preview.js` | `/api/files` | preview-ticket, preview-stream, download-multiple, download-progress/:id, thumbnail/:hash, thumbnails/batch |

- **Test file:** `server/domains/files/__tests__/files.test.js` (relocated from routes)
- **Services:** `domains/files/services/` — conflictResolver, batchOperationService, fileService, selectiveDelete
- **Stores:** `domains/files/stores/operationProgress.js`

### 2.2 Route List

| Method | Path | Request Payload (nodeId only) | Response |
|--------|------|------------------------------|----------|
| GET | `/list` | Query: `nodeId` (required); `?nodeId=5`; missing/invalid → 400 | Each item: `{ nodeId, display_path, ... }` |
| GET | `/download` | Query: `nodeId` (required); `?nodeId=5`; 404 if not found | File buffer + `X-Node-ID` header |
| POST | `/upload` | multipart + `parentNodeId`; file field; overwrite via `onConflict: 'overwrite'` against `(parent_id, name)` | `{ nodeId, display_path }`; `{ nodeId, skipped: true }` for skip |
| PUT | `/rename` | Body: `{ nodeId, newName }` — `sourceNodeId` replaces prior design | `{ nodeId, new_display_path }` |
| POST | `/move` | Body: `{ nodeId, destinationParentNodeId }` — single-item move (new route) | `{ nodeId, new_display_path }` |
| POST | `/copy` | Body: `{ nodeId, destinationParentNodeId, newName? }` — single-item copy (new route); S3 = copy-on-write | `{ nodeId, display_path }` |
| DELETE | `/delete` | Body: `{ nodeId }` — single-item delete (new route) | `{ deletedCount }` |
| POST | `/batch-move` | Body: `{ moves[] }`; moves = `{ sourceNodeId, destinationParentNodeId }` | jobId; results keyed by nodeId |
| POST | `/batch-copy` | Body: `{ copies[] }`; copies = `{ sourceNodeId, destinationParentNodeId, newName? }` | jobId; results keyed by nodeId |
| POST | `/batch-delete` | Body: `{ nodeIds[] }`; `nodeIds` array (no `paths`) | jobId; deleted nodeIds |
| POST | `/download-multiple` | Body: `{ nodeIds[], downloadId }`; `nodeIds` array (no `paths`) | Unchanged (ZIP stream) |

### 2.3 Phase 4 nodeId Contracts

**All endpoints accept `nodeId` exclusively.** Path strings are display-only in responses and are never accepted in request payloads. Response objects include `nodeId` field for every file/folder entry.

#### Route Module Mapping (Post-Phase 4)

Route handlers delegate to `fileService` instead of calling WebDAV directly. No path fallback anywhere — nodeId is mandatory.

| Module | Endpoints |
|--------|-----------|
| `crud.js` | list, download, upload, rename, move, copy, delete, check-conflicts, metadata |
| `batch.js` | batch-move, batch-copy, batch-delete, bulk-operation/:jobId, cancel |
| `preview.js` | preview-ticket, preview-stream, download-multiple, download-progress, thumbnail, thumbnails/batch |

#### Middleware Removal

- `normalizePathParam` middleware is deleted in Task 4.8. Routes validate `nodeId`/`parentNodeId` as positive integers (400 on missing/invalid).

### 2.4 Middleware Used

- `authenticateTokenOrShare`, `authenticateToken`, `requireUser`, `requireAuth`
- `checkMetaPathAccess`
- ~~`normalizePathParam`~~ — removed in Phase 4; replaced by nodeId integer validation at route level.

### 2.5 Test Mock Strategy

- Routes run with Supertest + service mocks injected through the composition root (`server/service/composition.js`): `fileNodeService`, `blobStorageService`, `aclService`, `uploadService`. Do NOT mock the WebDAV adapter at route level. Defaults are deterministic success (e.g. `listDirectory` returns two children; `downloadBlob` returns a small stub buffer). Failure scenarios (404, conflict, permission-denied) are per-test overrides (`mockResolvedValueOnce`/`mockRejectedValueOnce`). Worker internals (batch) are tested as unit tests; routes assert only API contract (status/body).

### 2.6 Request/Response Spec

- List, download, metadata, download-multiple, thumbnails: support share token (header/query)
- All request payloads use nodeId-based fields post-Phase 4 (`nodeId`, `parentNodeId`, `destinationParentNodeId`, `sourceNodeId`, `nodeIds`). Path strings are never accepted in request bodies.
- **preview-ticket / preview-stream (video preview streaming):**
  - Purpose: allow `<video src>` to load video preview without custom headers (browser cannot set `Authorization` header on `<video src>`).
  - `POST /preview-ticket`: validates `nodeId` references an existing file, caller has read permission, and file type is `video`. Returns `{ ticket }`.
  - `GET /preview-stream`: validates `{ nodeId, ticket }` and responds with `Content-Disposition: inline` + `Content-Type` derived from filename.
  - Tickets are short-lived (e.g. 60–120s) and must not embed JWT in query params.
- Meta path (/.wea) blocked for non-admin
- **GET /list:** When `user.is_admin`, items are not filtered by permission (admin bypass); each item's read permission is also treated as true for admin. Non-admin: permission-based filter as before.
- Bulk ops: returns jobId; poll via bulk-operation
- Upload 413 (payload too large): body-parser 또는 서버 제한; 413 반환
- download-multiple nodeIds 빈 배열: 400 (validation)
- download-multiple: POST returns 200 with ZIP stream (application/zip) directly. Client sends optional `downloadId` in body; server writes progress to `downloadProgress` map under that ID. Progress is polled via GET /download-progress/:id. Does not return 202+downloadId.
- bulk-operation/:jobId 존재하지 않음: 404
- Share token + write 요청(rename, batch-move 등): 403 (share는 read-only)

### 2.7 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)
- selectiveDelete service

### 2.8 Integration Test Scenarios

- [ ] List returns files with correct permissions
- [ ] Download returns blob
- [ ] Upload accepts multipart
- [ ] PUT /rename: nodeId, newName required; validation errors (400 on missing/invalid nodeId)
- [ ] POST /check-conflicts returns conflicts array

- [ ] POST /metadata with shareToken
- [ ] POST /bulk-operation/:jobId/cancel returns 200
- [ ] Batch move/copy return 202 + jobId (API contract only; worker execution covered by batchOperationService unit tests)
- [ ] Share token allows list/download for valid token
- [ ] Upload 413 when payload too large
- [ ] download-multiple 빈 nodeIds → 400
- [ ] bulk-operation 404 for invalid jobId

- [ ] Share token write 요청 → 403

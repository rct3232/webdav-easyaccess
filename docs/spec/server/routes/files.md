# files routes Spec (Phase 6 Domain Split)

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/files` |
| Role | File and folder operations: list, download, upload, rename, batch move/copy/delete, metadata, conflicts, thumbnails, bulk job status. |

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
- **Services:** `domains/files/services/` — conflictResolver, batchOperationService, fileService, selectiveTransfer, selectiveDownload, selectiveDelete
- **Stores:** `domains/files/stores/operationProgress.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/list` | Token or share | List folder contents. Query: path. |
| GET | `/download` | Token or share | Download file. Query: path. |
| POST | `/preview-ticket` | Token or share | Video preview only. Issues short-lived ticket for a streaming URL. Body: { path }. |
| GET | `/preview-stream` | Ticket | Video preview only. Streams video bytes inline. Query: path, ticket. |
| POST | `/upload` | Token | Upload file. Multipart: file, path. |
| PUT | `/rename` | Token | Rename. Body: oldPath, newName. |
| POST | `/batch-move` | Token | Move items. Body: moves, onConflict. |
| POST | `/batch-copy` | Token | Copy items. Body: copies, onConflict. |
| POST | `/batch-delete` | Token | Delete items. Body: paths. |
| POST | `/download-multiple` | Token or share | ZIP multiple files. Body: paths, downloadId. |
| GET | `/download-progress/:id` | Token or share | ZIP download progress. |
| GET | `/bulk-operation/:jobId` | Token | Bulk job status. |
| POST | `/bulk-operation/:jobId/cancel` | Token | Cancel bulk operation. |
| GET | `/thumbnail/:hash` | Token | Single thumbnail image. |
| POST | `/thumbnails/batch` | Token or share | Batch thumbnails. Body: paths. |
| POST | `/check-conflicts` | Token | Check name conflicts. Body: operations. |
| POST | `/metadata` | Token or share | Get file metadata. Body: paths. |

### 2.3 Middleware Used

- `authenticateTokenOrShare`, `authenticateToken`, `requireUser`, `requireAuth`
- `normalizePathParam`, `checkMetaPathAccess`

### 2.3.1 Test Mock Strategy

- Route integration tests use Supertest with shared WebDAV mock factories; avoid duplicated inline mock objects across test files.
- Default mock behavior should stay deterministic and represent common success paths (`pathExists`, `listDirectory`, `getFileContents`).
- Scenario-specific failures (404, conflict, permission-denied) must be applied as per-test overrides (`mockResolvedValueOnce` / `mockRejectedValueOnce`).
- Batch worker internals are not validated in this route integration test. Validate API contract here and worker internals in dedicated service/unit tests.
- Keep assertions outcome-focused (HTTP status, response body, visible side effects), not helper implementation details.

### 2.4 Request/Response Spec

- List, download, metadata, download-multiple, thumbnails: support share token (header/query)
- **preview-ticket / preview-stream (video preview streaming):**
  - Purpose: allow `<video src>` to load video preview without custom headers (browser cannot set `Authorization` header on `<video src>`).
  - `POST /preview-ticket`: validates `path` exists, caller has read permission, and file type is `video`. Returns `{ ticket }`.
  - `GET /preview-stream`: validates `{ path, ticket }` and responds with `Content-Disposition: inline` + `Content-Type` derived from filename.
  - Tickets are short-lived (e.g. 60–120s) and must not embed JWT in query params.
- Path params normalized; meta path (/.wea) blocked for non-admin
- **GET /list:** When `user.is_admin`, items are not filtered by permission (admin bypass); each item's read permission is also treated as true for admin. Non-admin: permission-based filter as before.
- Bulk ops: returns jobId; poll via bulk-operation
- Upload 413 (payload too large): body-parser 또는 서버 제한; 413 반환
- download-multiple paths 빈 배열: 400 (validation)
- download-multiple: POST returns 200 with ZIP stream (application/zip) directly. Client sends optional `downloadId` in body; server writes progress to `downloadProgress` map under that ID. Progress is polled via GET /download-progress/:id. Does not return 202+downloadId.
- bulk-operation/:jobId 존재하지 않음: 404
- Share token + write 요청(rename, batch-move 등): 403 (share는 read-only)

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)
- selectiveTransfer, selectiveDownload, selectiveDelete services

### 2.6 Integration Test Scenarios

- [ ] List returns files with correct permissions
- [ ] Download returns blob
- [ ] Upload accepts multipart
- [ ] PUT /rename: oldPath, newName required; validation errors
- [ ] POST /check-conflicts returns conflicts array
- [ ] POST /metadata with shareToken
- [ ] POST /bulk-operation/:jobId/cancel returns 200
- [ ] Batch move/copy return 202 + jobId (API contract only; worker execution covered by selectiveTransfer unit tests)
- [ ] Share token allows list/download for valid token
- [ ] Upload 413 when payload too large
- [ ] download-multiple 빈 paths → 400
- [ ] bulk-operation 404 for invalid jobId
- [ ] Share token write 요청 → 403

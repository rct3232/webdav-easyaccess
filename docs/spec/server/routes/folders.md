# folders routes Spec

## 1. Overview

| Item       | Description                               |
| ---------- | ----------------------------------------- |
| Mount path | `/api/folders`                            |
| Role       | Folder creation and recursive statistics. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/routes/folders.js`
- **Test file:** `server/domains/files/routes/__tests__/folders.test.js`

### 2.2 Route List

| Method | Path      | Auth  | Description                                                               |
| ------ | --------- | ----- | ------------------------------------------------------------------------- |
| POST   | `/create` | Token | Create folder. Body: parentNodeId, name.                                  |
| GET    | `/stats`  | Token | Recursive folder statistics. Query: nodeId. Returns fileCount, totalSize. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`

### 2.3.1 Test Mock Strategy

- Route integration tests should use a shared WebDAV mock factory rather than repeating large inline `jest.mock('../../utils/webdav', ...)` objects.
- Keep factory defaults simple (`pathExists`, `createDirectory`, `getRecursiveFolderStats`) and override only what each test scenario needs.
- Duplicate/parent-missing paths must be modeled using explicit per-test override sequences so scenario intent is readable.
- Maintain black-box verification: assert status/error contracts and returned payload shape; inspect call arguments only when interaction is the behavior under test.

### 2.4 Request/Response Spec

- **POST /create:** Body: `{ parentNodeId, name }`. 200 or 201. Errors: 400, 404.
- 동일 경로에 폴더 이미 존재: 409 (duplicate)
- 부모 경로 없음: 404
- **GET /stats:** Query `nodeId` required. 200: `{ fileCount, totalSize }`. 403 when non-admin and canReadFolder fails. Uses requireUser.

### 2.4.1 POST /create — WebDAV Mode (MKCOL-on-create)

In WebDAV blob-storage mode (`WEA_FILE_STORAGE=webdav`) the `file_nodes` row created by
`fileNodeService.createDirectory(parentNodeId, name)` is **not** sufficient: the physical
directory must also exist on the WebDAV server, otherwise subsequent `PUT`s to that path
are rejected (bytemark returns `403 Forbidden` / `409 Conflict` for missing parents).

After the DB node is committed the route calls
`blobStorageService.createDirectoryWebdav(dir.id)` (composition service), which:

1. Resolves the node's display path via `fileNodeService.getNodePath(dir.id)`.
2. MKCOLs the path recursively (root → deepest segment) via `WebdavBlobStore.createDirectory`
   → `ensureDirectoryExists`, tolerating already-existing collections.
3. On MKCOL failure marks the node `sync_status='orphaned_node'` (fail-safe, same pattern as
   `uploadToWebdav` in `fileService`) and **re-throws** the error. The route does not catch it,
   so the Express error handler maps it to the appropriate HTTP error response — the folder is
   reported as failed even though its DB row exists (recoverable via Phase 6 GC / repair-sync).

S3 mode is a strict no-op: `createDirectoryWebdav` returns `null` without any storage call,
so S3 folder creation remains DB-only and unchanged.

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Create folder requires auth and write permission
- [ ] 동일 폴더명 create → 409
- [ ] 부모 경로 없음 → 404
- [ ] GET /stats: requires auth; nodeId required; returns fileCount, totalSize; 403 for non-admin when no read permission
- [ ] WebDAV mode: successful create triggers `webdavMock.createDirectory` at the resolved node path (`/username/folder`)
- [ ] WebDAV mode: MKCOL failure → node marked `orphaned_node`, non-2xx error returned to caller

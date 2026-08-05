# folders routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/folders` |
| Role | Folder creation and recursive statistics. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/routes/folders.js`
- **Test file:** `server/domains/files/routes/__tests__/folders.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/create` | Token | Create folder. Body: parentNodeId, name. |
| GET | `/stats` | Token | Recursive folder statistics. Query: nodeId. Returns fileCount, totalSize. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`, `checkMetaPathAccess`

### 2.3.1 Test Mock Strategy

- Route integration tests should use a shared WebDAV mock factory rather than repeating large inline `jest.mock('../../utils/webdav', ...)` objects.
- Keep factory defaults simple (`pathExists`, `createDirectory`, `getRecursiveFolderStats`) and override only what each test scenario needs.
- Duplicate/parent-missing paths must be modeled using explicit per-test override sequences so scenario intent is readable.
- Maintain black-box verification: assert status/error contracts and returned payload shape; inspect call arguments only when interaction is the behavior under test.

### 2.4 Request/Response Spec

- **POST /create:** Body: `{ parentNodeId, name }`. 200 or 201. Errors: 403 (meta path), 400, 404.
- 동일 경로에 폴더 이미 존재: 409 (duplicate)
- 부모 경로 없음: 404
- **GET /stats:** Query `nodeId` required. 200: `{ fileCount, totalSize }`. 403 when non-admin and canReadFolder fails. Uses checkMetaPathAccess, requireUser.

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Create folder requires auth and write permission
- [ ] Meta path returns 403 for non-admin
- [ ] 동일 폴더명 create → 409
- [ ] 부모 경로 없음 → 404
- [ ] GET /stats: requires auth; nodeId required; returns fileCount, totalSize; 403 for non-admin when no read permission

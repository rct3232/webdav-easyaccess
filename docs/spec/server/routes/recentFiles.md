# recentFiles routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/recent-files` |
| Role | Recent files for current user: list, add, remove, clear. Entries are nodeId-based; displayPath resolved server-side. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/recentFiles/routes.js`
- **Test file:** `server/domains/recentFiles/__tests__/recentFiles.test.js`

**Architecture note:** Business logic is extracted into `server/domains/recentFiles/service.js`, which exports: `getRecentFiles(userId)`, `addRecentFile(userId, fileNodeId)`, `removeRecentFile(userId, fileNodeId)`, `clearRecentFiles(userId)`. `applyBulkMove` and `removePaths` are **REMOVED** — node_ids are stable across rename/move, so no post-operation synchronization is needed. The service delegates to `server/store/recentFilesStore` for persistence.

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Token | List recent files. |
| POST | `/` | Token | Add file. Body: fileNodeId. |
| DELETE | `/:fileNodeId` | Token | Remove one entry (numeric nodeId). |
| DELETE | `/` | Token | Clear all. |

**Route order:** `DELETE /` must be defined before `DELETE /:fileNodeId` so that clear-all matches before single-entry remove.

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`

### 2.4 Request/Response Spec

- **GET /:** 200: array of `{ fileNodeId, name, type, lastAccessed, displayPath }` — `displayPath` resolved server-side via `fileNodeService.getNodePath(fileNodeId)` at render time.
- **POST /:** Body: `{ fileNodeId }` (numeric). 200 or 201. 400 when fileNodeId missing/invalid.
- **DELETE /:fileNodeId:** numeric nodeId param. 200 or 204.
- **DELETE /:** 200 or 204.

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] List returns user's recent files with fileNodeId and resolved displayPath
- [ ] Add, remove, clear require auth
- [ ] Add with missing/invalid fileNodeId → 400
- [ ] Remove by numeric fileNodeId removes the correct entry
- [ ] Clear all empties the user's recent list

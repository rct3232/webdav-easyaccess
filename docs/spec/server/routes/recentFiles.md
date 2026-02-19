# recentFiles routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/recent-files` |
| Role | Recent files for current user: list, add, remove, clear, apply-moves, remove-paths. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/recentFiles.js`
- **Test file:** `server/routes/__tests__/recentFiles.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Token | List recent files. |
| POST | `/` | Token | Add file. Body: path; optional name, type, basename. |
| DELETE | `/:filePath(*)` | Token | Remove one path. |
| DELETE | `/` | Token | Clear all. |
| POST | `/apply-moves` | Token | Update paths after bulk move. Body: array of moves. |
| POST | `/remove-paths` | Token | Remove paths after delete. Body: filePaths, folderPaths. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`

### 2.4 Request/Response Spec

- **GET /:** 200: array
- **POST /:** Body: `{ path, name?, type?, basename? }`. 200 or 201.
- **DELETE /:filePath(*):** path may contain slashes. 200 or 204.
- **DELETE /:** 200 or 204.
- **POST /apply-moves:** Body: array of `{ oldPath, newPath }`. 200.
- **POST /remove-paths:** Body: `{ filePaths, folderPaths }`. 200.

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] List returns user's recent files
- [ ] Add, remove, clear require auth
- [ ] apply-moves, remove-paths update store correctly

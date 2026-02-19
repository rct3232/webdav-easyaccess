# folders routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/folders` |
| Role | Folder creation. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/folders.js`
- **Test file:** `server/routes/__tests__/folders.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/create` | Token | Create folder. Body: path. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`, `normalizePathParam`, `checkMetaPathAccess`

### 2.4 Request/Response Spec

- **POST /create:** Body: `{ path }`. 200 or 201. Errors: 403 (meta path), 400, 404.

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Create folder requires auth and write permission
- [ ] Meta path returns 403 for non-admin

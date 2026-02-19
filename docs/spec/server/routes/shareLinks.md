# shareLinks routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/share-links` |
| Role | Authenticated share link CRUD: create, list, get, update, delete. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/shareLinks.js`
- **Test file:** `server/routes/__tests__/shareLinks.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | Token | Create. Body: filePath, expiresInDays? |
| GET | `/` | Token | List own links. |
| GET | `/:token` | Token | Get link details. |
| PUT | `/:token` | Token | Update (e.g. expiry). |
| DELETE | `/:token` | Token | Delete. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`

### 2.4 Request/Response Spec

- Create: body filePath, expiresInDays; 200: `{ token, filePath, createdAt, expiresAt, downloadCount }`
- List: 200 array
- Get: 200 link object
- Update: body expiresInDays; 200
- Delete: 200 or 204

### 2.5 Related Documents

- [api.md](../../../api.md), ShareLink model

### 2.6 Integration Test Scenarios

- [ ] Create requires path exists; meta path forbidden
- [ ] List returns only own links
- [ ] Delete requires ownership

# shareLinks routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/share-links` |
| Role | Authenticated share link CRUD: create, list, get, update, delete. Share links are nodeId-based. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/sharing/routes/shareLinks.js`
- **Service:** `server/domains/sharing/services/shareLinkService.js`
- **Test file:** `server/domains/sharing/routes/__tests__/shareLinks.test.js`

### 2.1.1 Service Layer

Business logic is delegated to `shareLinkService`, which exports:

| Function | Description |
|----------|-------------|
| `createShareLink(fileNodeId, userId, expiresInDays)` | Validates node exists, creates link and grants share permission. |
| `listUserShareLinks(userId)` | Returns all nodeId-based links for a user with `isExpired` flag. |
| `getShareLinkInfo(token, userId)` | Ownership check; returns nodeId-based link details. |
| `updateShareLink(token, expiresInDays, userId)` | Ownership check; updates expiry (null removes expiry). |
| `deleteShareLink(token, userId)` | Ownership check; deletes link and revokes share permission. |

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | Token | Create. Body: fileNodeId, expiresInDays? |
| GET | `/` | Token | List own links. |
| GET | `/:token` | Token | Get link details. |
| PUT | `/:token` | Token | Update (e.g. expiry). |
| DELETE | `/:token` | Token | Delete. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`

### 2.4 Request/Response Spec

- Create: body `{ fileNodeId, expiresInDays }`; 200: `{ token, nodeId, fileName, fileType, isDirectory, displayPath, createdAt, expiresAt, downloadCount }`
- Create: fileNodeId 필수; 없거나 invalid → 400; node 존재하지 않으면 → 404
- List: 200 array of nodeId-based link objects
- Get: 200 nodeId-based link object
- Update: body expiresInDays; 200
- Delete: 200 or 204
- Response objects do NOT include `filePath`; paths are exposed only as `displayPath` (resolved via `fileNodeService.getNodePath`).

### 2.5 Related Documents

- [api.md](../../../api.md), ShareLink model

### 2.6 Integration Test Scenarios

- [ ] Create requires node exists; invalid/missing fileNodeId → 400; non-existent node → 404
- [ ] List returns only own links; entries include nodeId, fileName, fileType, isDirectory, displayPath
- [ ] Get/Update/Delete require ownership
- [ ] Response objects never contain `filePath`
- [ ] 만료된 링크 Update/Delete (소유자) 동작

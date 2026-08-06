# sharePublic routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/share` |
| Role | Public share access via token: info, download, preview, check-my-permission, add-to-my-permissions. All access resolves the shared node by nodeId. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/sharing/routes/sharePublic.js`
- **Service:** `server/domains/sharing/services/shareAccessService.js`
- **Test file:** `server/domains/sharing/routes/__tests__/sharePublic.test.js`

### 2.1.1 Service Layer

Business logic is delegated to `shareAccessService`, which exports:

| Function | Description |
|----------|-------------|
| `resolveShareLink(token)` | Validates token existence and expiration (returns error for expired links). |
| `getShareLinkMetadata(token)` | Returns public metadata including `nodeId`, `fileName`, `fileType`, `isDirectory`, `displayPath`. |
| `checkUserSharePermission(token, userId)` | Closure-table descendant check (via `fileNodeService.getDescendantIds`) to find the first missing node under the shared root; returns `{ hasSufficientPermission, nodeId? }`. |
| `addToMyPermissions(token, userId)` | Grants READ on the shared node via nodeId (directory via `permissionStore.grant`, file via `grantFilePermission`). |
| `previewFile(token)` | Returns `{ buffer, fileName, contentType }` for inline preview. |
| `downloadFile(token)` | Returns `{ buffer, fileName }`; increments download count. |

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/:token/info` | None | Public: share link info. |
| GET | `/:token` | None | Public: download file. |
| GET | `/:token/preview` | None | Public: preview file. |
| GET | `/:token/check-my-permission` | Token | Check if user has access. |
| POST | `/:token/add-to-my-permissions` | Token | Add shared item to user permissions. |

### 2.3 Middleware Used

- None for info, download, preview
- `authenticateToken`, `requireUser` for check-my-permission, add-to-my-permissions

### 2.4 Request/Response Spec

- **GET /:token/info:** 200: `{ token, nodeId, fileName, fileType, isDirectory, displayPath, createdAt, expiresAt, downloadCount, isExpired }`; 만료 시 403 또는 404 + isExpired
- **GET /:token:** streams file blob (resolved via `fileNodeService.getNode` + `blobStorageService.downloadBlob(nodeId)`); 만료 시 403
- **GET /:token/preview:** streams file (inline) using chunked response; 만료 시 403
- **GET /:token/check-my-permission:** 200: `{ hasSufficientPermission, nodeId? }` — `nodeId` is the first missing node id, `null` when permission is sufficient; 비인증 401
- **POST /:token/add-to-my-permissions:** 200: `{ message }`

Notes:
- **Headers must remain stable** for `/preview`: `Content-Disposition: inline` and `Content-Type` derived from filename.
- Response body bytes are identical to non-streaming behavior; only the server→client transfer uses chunked writes.
- Range support may be added later by branching on `req.headers.range` and returning `206 Partial Content`.

### 2.5 Related Documents

- [api.md](../../../api.md), [shareAccessService.md](../services/shareAccessService.md)

### 2.6 Integration Test Scenarios

- [ ] Info returns without auth; expired link returns error
- [ ] Info response includes nodeId and displayPath
- [ ] Download/preview stream correct file
- [ ] check-my-permission, add-to-my-permissions require auth
- [ ] check-my-permission returns `{ hasSufficientPermission, nodeId }` (nodeId null when access sufficient)
- [ ] 만료된 링크 download/preview → 403
- [ ] check-my-permission 비인증 → 401

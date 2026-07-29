# sharePublic routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/share` |
| Role | Public share access via token: info, download, preview, check-my-permission, add-to-my-permissions. |

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
| `getShareLinkMetadata(token)` | Returns public metadata including `fileName`, `fileType`, `isDirectory`. |
| `checkUserSharePermission(token, userId)` | Walks all paths under shared path; checks effective permission rank. |
| `addToMyPermissions(token, userId)` | Grants READ on all directories under the shared path. |
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

- **GET /:token/info:** 200: `{ filePath, fileName, isDirectory, isExpired?, ... }`; 만료 시 403 또는 404 + isExpired
- **GET /:token:** streams file blob; 만료 시 403
- **GET /:token/preview:** streams file (inline) using chunked response; 만료 시 403
- **GET /:token/check-my-permission:** 200: `{ hasSufficientPermission, path? }`; 비인증 401
- **POST /:token/add-to-my-permissions:** 200: `{ message }`

Notes:
- **Headers must remain stable** for `/preview`: `Content-Disposition: inline` and `Content-Type` derived from filename.
- Response body bytes are identical to non-streaming behavior; only the server→client transfer uses chunked writes.
- Range support may be added later by branching on `req.headers.range` and returning `206 Partial Content`.

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Info returns without auth; expired link returns error
- [ ] Download/preview stream correct file
- [ ] check-my-permission, add-to-my-permissions require auth
- [ ] 만료된 링크 download/preview → 403
- [ ] check-my-permission 비인증 → 401

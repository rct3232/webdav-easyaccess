# sharePublic routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/share` |
| Role | Public share access via token: info, download, preview, check-my-permission, add-to-my-permissions. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/sharePublic.js`
- **Test file:** `server/routes/__tests__/sharePublic.test.js`

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
- **GET /:token/preview:** streams file (inline); 만료 시 403
- **GET /:token/check-my-permission:** 200: `{ hasSufficientPermission, path? }`; 비인증 401
- **POST /:token/add-to-my-permissions:** 200: `{ message }`

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Info returns without auth; expired link returns error
- [ ] Download/preview stream correct file
- [ ] check-my-permission, add-to-my-permissions require auth
- [ ] 만료된 링크 download/preview → 403
- [ ] check-my-permission 비인증 → 401

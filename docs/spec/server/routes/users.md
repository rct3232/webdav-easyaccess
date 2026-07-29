# users routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/users` |
| Role | User management: list, approved list, get by id, update password, email, permissions. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/routes/users.js` (merged into admin domain)
- **Test file:** `server/domains/admin/routes/__tests__/users.test.js`

**Architecture note:** Routes are served by the admin domain. Business logic is delegated to `server/domains/admin/services/userService.js`, which exports: `listUsers`, `listApprovedUsers`, `getUserById`, `updatePassword`, `updateEmail`.

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Token | List users (for share dialogs). |
| GET | `/approved` | Token | List approved users. |
| GET | `/:id` | Token | Get user by id. |
| PUT | `/:id/password` | Token | Change password. Body: password (or currentPassword, newPassword per api.md). |
| PUT | `/:id/email` | Token | Update email. Body: email. |
| PUT | `/:id/permissions` | Token | Update user's own permissions. Body: permissions. |

### 2.3 Middleware Used

- `authenticateToken` for all routes

### 2.4 Request/Response Spec

- **GET /:** 200: user array
- **GET /approved:** 200: approved user array
- **GET /:id:** 200: user object. 404 if not found.
- **PUT /:id/password:** Body: `{ password }`. 200 or 204.
- **PUT /:id/email:** Body: `{ email }`. 200 or 204.
- **PUT /:id/permissions:** Body: `{ permissions }`. 200 or 204.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.6 Integration Test Scenarios

- [ ] List users requires auth
- [ ] Get approved users returns array
- [ ] Get user by id returns user or 404
- [ ] Update password, email require own user or admin

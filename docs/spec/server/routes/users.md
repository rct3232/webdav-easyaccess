# users routes Spec

## 1. Overview

| Item       | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| Mount path | `/api/users`                                                 |
| Role       | User self-service: approved list, update own password/email. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/routes/users.js` (merged into admin domain)
- **Test file:** `server/domains/admin/routes/__tests__/users.test.js`

**Architecture note:** Routes are served by the admin domain. Business logic is delegated to `server/domains/admin/services/userService.js`, which exports: `listUsers`, `listApprovedUsers`, `getUserById`, `updatePassword`, `updateEmail`.

### 2.2 Route List

| Method | Path            | Auth  | Description                                                                                     |
| ------ | --------------- | ----- | ----------------------------------------------------------------------------------------------- |
| GET    | `/approved`     | Token | List approved users.                                                                            |
| PUT    | `/:id/password` | Token | Reset password. Body: `{ password }`. Self-only — changing another user's password returns 403. |
| PUT    | `/:id/email`    | Token | Update email. Body: email.                                                                      |

### 2.3 Middleware Used

- `authenticateToken` for all routes

### 2.4 Request/Response Spec

- **GET /approved:** 200: approved user array
- **PUT /:id/password:** Body: `{ password }` (single field; no `currentPassword`/`newPassword` pair). 200: `{ messageCode }`. **Self-only** (`parseInt(id) !== req.user.id` → 403 `permissionsMiddleware.accessDenied`, admin routes/users.js:55-57). A password change revokes all of the user's tokens via `revokeAllUserTokens` (userService.updatePassword, userService.js:257-262) — sessions are invalidated by token disposal.
- **PUT /:id/email:** Body: `{ email }`. 200 or 204.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.6 Integration Test Scenarios

- [ ] Get approved users returns array
- [ ] Update password, email require own user or admin

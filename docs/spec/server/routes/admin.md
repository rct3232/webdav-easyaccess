# admin routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/admin` |
| Role | Admin-only: settings, user management (pending, list, approve, reject, delete, create), folder list, user permissions, cleanup. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/admin.js`
- **Test file:** `server/routes/__tests__/admin.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/settings` | Token + Admin | Get system settings. |
| PUT | `/settings` | Token + Admin | Update settings. Body: registration_enabled, etc. |
| GET | `/users/pending` | Token + Admin | Pending signup approvals. |
| GET | `/users` | Token + Admin | List users. |
| POST | `/users` | Token + Admin | Add user. Body: username, email, password. |
| POST | `/users/:id/approve` | Token + Admin | Approve signup. |
| POST | `/users/:id/reject` | Token + Admin | Reject signup. |
| DELETE | `/users/:id` | Token + Admin | Delete user. |
| GET | `/folders/list` | Token + Admin | List folders for permission UI. |
| PUT | `/users/:id/permissions` | Token + Admin | Set user folder permissions. |
| POST | `/permissions/ensure-home-owner-admin` | Token + Admin | Ensure home owner has admin. |
| POST | `/cleanup/orphaned` | Token + Admin | Clean orphaned metadata. |

### 2.3 Middleware Used

- `authenticateToken`, `isAdmin` (inline middleware)

### 2.4 Request/Response Spec

- **GET /settings:** 200: settings object
- **PUT /settings:** Body: `{ registration_enabled }`. 200: `{ messageCode, settings }`
- **GET /users/pending:** 200: user array
- **GET /users:** 200: user array
- **POST /users:** Body: `{ username, email, password }`. 201 or 200
- **POST /users/:id/approve:** 200
- **POST /users/:id/reject:** 200
- **DELETE /users/:id:** 200 or 204
- **GET /folders/list:** 200: folder list
- **PUT /users/:id/permissions:** Body: `{ permissions }`. 200
- **POST /permissions/ensure-home-owner-admin:** 200: `{ updatedUsers, upgradedPaths, grantedPaths, errors }`
- **POST /cleanup/orphaned:** 200: `{ results }`

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.6 Integration Test Scenarios

- [ ] Non-admin returns 403
- [ ] Get/update settings
- [ ] Approve, reject, delete users
- [ ] Create user with validation
- [ ] Cleanup endpoints return results

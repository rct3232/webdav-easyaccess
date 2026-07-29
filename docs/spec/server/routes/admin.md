# admin routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/admin` |
| Role | Admin-only: settings, user management (pending, list, approve, reject, delete, create), folder list, user permissions, cleanup. |

---

## 2. Implementation Spec

The original monolithic `server/routes/admin.js` has been split into separate route modules under `server/domains/admin/routes/`, each with dedicated service layers.

### 2.1 Route Modules

| Module | Source | Mount Path | Test File |
|--------|--------|------------|-----------|
| userManagement | `server/domains/admin/routes/userManagement.js` | `/api/admin` | `server/domains/admin/routes/__tests__/admin.test.js` |
| settings | `server/domains/admin/routes/settings.js` | `/api/admin`, `/api/settings` (public) | `server/domains/admin/routes/__tests__/settings.test.js` |
| maintenance | `server/domains/admin/routes/maintenance.js` | `/api/admin` | `server/domains/admin/routes/__tests__/admin.test.js` |

### 2.2 Route List

#### 2.2.1 userManagement (`/api/admin`)

Admin-only user lifecycle management. Service: `domains/admin/services/userService.js`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/pending` | Token + Admin | Pending signup approvals. |
| GET | `/users` | Token + Admin | List all users. |
| POST | `/users` | Token + Admin | Add user. Body: username, email, password. |
| POST | `/users/:id/approve` | Token + Admin | Approve signup. Creates home folder, grants admin on it. |
| POST | `/users/:id/reject` | Token + Admin | Reject signup. Revokes all permissions and requests. |
| DELETE | `/users/:id` | Token + Admin | Delete user cascade. Cannot delete self or other admins. |
| PUT | `/users/:id/permissions` | Token + Admin | Bulk update folder permissions. Body: `{ permissions }`. |

#### 2.2.2 settings (`/api/admin`)

System configuration. Also exposes a public endpoint at `/api/settings/public`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/settings` | Token + Admin | Get system settings. |
| PUT | `/settings` | Token + Admin | Update settings. Body: registration_enabled, etc. |

#### 2.2.3 maintenance (`/api/admin`)

System maintenance operations. Service: `domains/admin/services/cleanupService.js`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/folders/list` | Token + Admin | List folders for permission UI (single level). |
| POST | `/permissions/ensure-home-owner-admin` | Token + Admin | Upgrade home-path permissions to admin. |
| POST | `/cleanup/orphaned` | Token + Admin | Clean orphaned metadata files and permission requests. |

### 2.3 Middleware Used

- `authenticateToken`, `isAdmin` (inline middleware defined per module)

### 2.4 Request/Response Spec

#### userManagement

- **GET /users/pending:** 200: user array
- **GET /users:** 200: user array
- **POST /users:** Body: `{ username, email, password }`. 201: `{ messageCode, user }`
- **POST /users/:id/approve:** 200: `{ messageCode, user }`
- **POST /users/:id/reject:** 200: `{ messageCode, user }`
- **DELETE /users/:id:** 200: `{ messageCode, user }`
- **PUT /users/:id/permissions:** Body: `{ permissions: [{ folderPath, permission }] }`. 200

#### settings

- **GET /settings:** 200: settings object
- **PUT /settings:** Body: `{ registration_enabled }`. 200: `{ messageCode, settings }`

#### maintenance

- **GET /folders/list:** 200: folder list (sorted by name)
- **POST /permissions/ensure-home-owner-admin:** 200: `{ success: true, updatedUsers, upgradedPaths, grantedPaths, errors }`
- **POST /cleanup/orphaned:** 200: `{ messageCode, results: { deletedPermissionFiles, deletedUserFiles, deletedEmailIndexFiles, cleanedPermissionRequests, errors } }`

### 2.5 Service Layers

#### userService (`domains/admin/services/userService.js`)

| Function | Description |
|----------|-------------|
| `createAdminUser({ username, email, password })` | Validates fields (min 6-char password), creates user folder, grants admin permission. Rollback on failure. |
| `approvePendingUser(userId)` | Updates status to APPROVED, creates home folder, grants admin permission, sends approval email. |
| `rejectPendingUser(userId, adminId)` | Revokes all permissions and requests, updates status to REJECTED, sends rejection email. |
| `deleteUserCascade(userId, adminId)` | Full cleanup: permission requests, permissions files, user record. Prevents self-deletion and admin deletion. |
| `bulkUpdateUserPermissions(userId, permissionEntries)` | Revokes all existing permissions, then grants new ones in batch. |

#### cleanupService (`domains/admin/services/cleanupService.js`)

| Function | Description |
|----------|-------------|
| `cleanupOrphanedData()` | Scans `.wea` meta directories for orphaned permission files, user files, email index entries, and stale permission requests. |
| `ensureHomeOwnerAdminForAllUsers()` | Upgrades existing home-path permissions to admin; grants admin on first-level subdirectories where missing. |

### 2.6 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.7 Integration Test Scenarios

- [ ] Non-admin returns 403
- [ ] Get/update settings
- [ ] Approve, reject, delete users
- [ ] Create user with validation
- [ ] Cleanup endpoints return results

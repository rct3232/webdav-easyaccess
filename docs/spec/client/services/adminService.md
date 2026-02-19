# adminService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Admin API: users (pending, list, approve, reject, delete, create), settings, cleanup. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/adminService.js`
- **Test file:** `client/src/services/__tests__/adminService.test.js`

### 2.2 Main Functions

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| getPendingUsers | () | Promise\<Array\> | GET /api/admin/users/pending |
| getUsers | () | Promise\<Array\> | GET /api/admin/users |
| getSettings | () | Promise\<Object\> | GET /api/admin/settings |
| updateSettings | (settings) | Promise\<void\> | PUT /api/admin/settings |
| approveUser | (userId) | Promise\<void\> | POST /api/admin/users/:id/approve |
| rejectUser | (userId) | Promise\<void\> | POST /api/admin/users/:id/reject |
| deleteUser | (userId) | Promise\<void\> | DELETE /api/admin/users/:id |
| createUser | ({ username, email, password }) | Promise\<void\> | POST /api/admin/users |
| cleanupOrphaned | () | Promise\<Object\> | POST /api/admin/cleanup/orphaned |
| ensureHomeOwnerAdmin | () | Promise\<Object\> | POST /api/admin/permissions/ensure-home-owner-admin |

- All require admin JWT.

### 2.3 Error Handling

- Errors propagated; AdminDashboard uses getServerErrorDisplay
- Cleanup/ensureHomeOwnerAdmin return results object with counts/errors

### 2.4 Verification Scenarios

- [ ] getUsers, getPendingUsers return arrays
- [ ] approve, reject, delete, create call correct endpoints
- [ ] getSettings/updateSettings for settings tab
- [ ] cleanupOrphaned, ensureHomeOwnerAdmin return results

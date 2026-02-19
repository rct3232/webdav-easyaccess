# ensureHomeOwnerAdmin Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Ensure home owner admin: upgrade existing permissions under home to admin, grant admin on first-level dirs. Used on startup and admin "권한정리" button. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/ensureHomeOwnerAdmin.js`
- **Test file:** `server/utils/__tests__/ensureHomeOwnerAdmin.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| ensureHomeOwnerAdminForAllUsers | () => Promise\<object\> | Process all users, upgrade/grant admin under home |

### 2.3 Input / Output

- Returns { updatedUsers, upgradedPaths, grantedPaths, errors }

### 2.4 Dependencies

- User, Permission, permissionPolicy.isOwnerPath
- listDirectory (webdav)

### 2.5 Mock Targets

- User.findAll
- Permission.getPermissionDoc, Permission.grant, Permission.checkPermission
- listDirectory

### 2.6 Verification Scenarios

- [ ] Upgrade existing read/write to admin under home
- [ ] Grant admin on first-level dirs
- [ ] Errors collected

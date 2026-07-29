# ensureHomeOwnerAdmin Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Ensure home owner admin: upgrade existing permissions under home to admin, grant admin on first-level dirs. Co-located with other admin maintenance logic in cleanupService. Used on startup and admin "권한정리" button. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/services/cleanupService.js`
- **Test file:** None yet

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| ensureHomeOwnerAdminForAllUsers | () => Promise\<object\> | Process all non-admin users; upgrade/grant admin under home |
| cleanupOrphanedData | () => Promise\<object\> | Clean orphaned permission files, user metadata, email index, and permission requests |

### 2.3 Input / Output — ensureHomeOwnerAdminForAllUsers

- Returns `{ updatedUsers, upgradedPaths, grantedPaths, errors }`
- Action 1: Upgrade existing permission entries (read/write → admin) for paths under each user's home
- Action 2: List first-level dirs under each user's home and grant admin where missing

### 2.4 Input / Output — cleanupOrphanedData

- Returns `{ deletedPermissionFiles, deletedUserFiles, deletedEmailIndexFiles, cleanedPermissionRequests, errors }`
- Cleans orphaned permission files, user metadata files, email index files, and invalid permission requests

### 2.5 Dependencies

- User model (findAll)
- Permission model (getPermissionDoc, grant, checkPermission)
- `isOwnerPath` from `../../permissions/policy/permissionPolicy`
- `listDirectory` from `../../../utils/webdav`
- storage (listDir, deletePath, exists, readFile, writeFile, ensureDir)
- metaPaths constants and helpers
- withLock for permission request cleanup

### 2.6 Verification Scenarios

- [ ] Upgrade existing read/write to admin under home
- [ ] Grant admin on first-level dirs where missing
- [ ] Errors collected in result.errors array
- [ ] Non-admin users only; admin users skipped
- [ ] Users without id or username skipped gracefully

# permissions Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission check utilities and middleware: checkFilePermission, checkFolderPermission, canAccessPath, requirePermission, requireFolderPermission, isSharePrincipal, extractShareToken. Principal: userId or share:token. Owner path, admin bypass. |
| Pipeline position | requirePermission/requireFolderPermission used in routes; check* used by permissionPolicy |
| Preceding middleware | requireAuth (req.principalId) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/middleware/permissions.js`
- **Test file:** `server/middleware/__tests__/permissions.test.js`

### 2.2 Input Conditions

- principalId: number (userId) or string ("share:token")
- filePath, folderPath (normalized)

### 2.3 Side Effects

- User cache (USER_CACHE_TTL_MS)
- requirePermission, requireFolderPermission: res.status(400/401/403/500).json() on error

### 2.4 Error Cases

- Returns false when no permission
- Share: read-only, path under share root

### 2.5 Mock Targets

- User.findById (getCachedUser)
- Permission.checkPermission, Permission.checkSharePermission
- Permission.getPermissionDoc

### 2.6 Verification Scenarios

- [ ] checkFilePermission, checkFolderPermission, canAccessPath
- [ ] requirePermission, requireFolderPermission middleware
- [ ] Admin bypass
- [ ] Owner path bypass
- [ ] Share principal
- [ ] isSharePrincipal, extractShareToken

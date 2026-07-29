# permissionPolicy Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission policy module split across four files under `server/domains/permissions/policy/`. Covers owner path resolution, read/write checks, grant/revoke/view authorization, and synchronous batch checkers. |

---

## 2. Implementation Spec

### 2.1 File Paths

| Module | Source | Purpose |
|--------|--------|---------|
| permissionPolicy | `server/domains/permissions/policy/permissionPolicy.js` | Main policy: isAdminUser, read/write checks, grant/revoke/view authorization, sync checkers |
| ownerPathResolver | `server/domains/permissions/policy/ownerPathResolver.js` | Owner path detection: userRootPath, isOwnerPath, getHomeOwnerUserIdForPath |
| inheritancePolicy | `server/domains/permissions/policy/inheritancePolicy.js` | Path normalization for permission lookup: isDirectoryPath, getLookupPaths, isDirectPermission marker |
| permissionRank | `server/domains/permissions/policy/permissionRank.js` | Permission level comparison: getPermissionRank, meetsRank |

- **Test file:** `server/utils/__tests__/permissionPolicy.test.js` (test has not been relocated yet)

### 2.2 Functions / Exports — permissionPolicy.js

| Function | Signature | Description |
|----------|-----------|-------------|
| isAdminUser | (user) => boolean | user?.is_admin |
| isOwnerPath | (user, targetPath) => boolean | Re-exported from ownerPathResolver; target under /{username} |
| getHomeOwnerUserIdForPath | (folderPath) => Promise\<number \| null\> | Re-exported from ownerPathResolver; first segment as username |
| hasDirectFolderPermission | (userId, folderPath, perm?) => Promise\<boolean\> | Direct check with slash/no-slash compatibility |
| canReadFolder | (principalId, folderPath, requiredPermission?) => Promise\<boolean\> | Delegates to aclService.checkFolderPermission |
| canReadFile | (principalId, filePath, requiredPermission?) => Promise\<boolean\> | Delegates to aclService.checkFilePermission |
| canWriteFolder | (user, folderPath) => Promise\<boolean\> | Admin/owner bypass + direct write check |
| canWriteFileByParent | (user, filePath) => Promise\<boolean\> | Admin/owner bypass + file-level write check |
| buildSyncWriteChecker | (user, doc) => (folderPath) => boolean | Sync checker using preloaded permission doc for batch ops |
| buildSyncReadChecker | (user, doc) => (folderPath) => boolean | Sync read checker for folders using preloaded doc |
| buildSyncReadFileChecker | (user, doc) => (filePath) => boolean | Sync read checker for files using preloaded doc |
| buildSyncWriteFileByParentChecker | (user, doc) => (filePath) => boolean | Sync file write checker using preloaded doc |
| getUserOrNull | (userId) => Promise\<User \| null\> | Fetch user by ID or return null |
| canGrantPermission | (user, folderPath, userId) => Promise\<boolean\> | Check if user can grant permission to another user |
| canRevokePermission | (user, folderPath, userId, targetUserId) => Promise\<boolean\> | Check if user can revoke permission from another user |
| canViewPermissions | (user, folderPath, userId) => Promise\<boolean\> | Check if user can view permissions for a folder |

### 2.3 Functions / Exports — ownerPathResolver.js

| Function | Signature | Description |
|----------|-----------|-------------|
| userRootPath | (user) => string \| null | Returns /{username} or null |
| isOwnerPath | (user, targetPath) => boolean | Safe prefix match against /{username} |
| getHomeOwnerUserIdForPath | (folderPath) => Promise\<number \| null\> | Resolves first path segment as username to userId |

### 2.4 Functions / Exports — permissionRank.js

| Function | Signature | Description |
|----------|-----------|-------------|
| getPermissionRank | (permission) => number | Numeric rank via PERMISSIONS.ALL.indexOf; -1 for unknown |
| meetsRank | (actual, required) => boolean | actual rank >= required rank |

### 2.5 Functions / Exports — inheritancePolicy.js

| Function | Signature | Description |
|----------|-----------|-------------|
| isDirectoryPath | (path) => boolean | Ends with '/' or equals '/' |
| getLookupPaths | (path, options?) => string[] | Returns [withSlash, noSlash] variants for permission lookup |
| isDirectPermission | (userId, folderPath, requiredPermission) => boolean | Policy marker; actual DB check happens in store layer |

### 2.6 Input / Output

- Compliant with shared-contracts
- principalId: number (userId) or string ("share:token")

### 2.7 Dependencies

- `@webdav-easyaccess/shared/constants` (PERMISSIONS)
- `@webdav-easyaccess/shared/pathUtils` (normalizePath)
- Permission model, User model
- aclService (checkFilePermission, checkFolderPermission, isSharePrincipal) — from `../services/aclService`

### 2.8 Mock Targets

- User.findByUsername, User.findById
- Permission.checkPermission, Permission.getPermissionDoc, Permission.grant
- aclService.checkFolderPermission, aclService.checkFilePermission

### 2.9 Verification Scenarios

- [ ] isOwnerPath, userRootPath (ownerPathResolver)
- [ ] getHomeOwnerUserIdForPath
- [ ] hasDirectFolderPermission with slash/no-slash compatibility
- [ ] canReadFolder, canReadFile delegates to aclService
- [ ] canWriteFolder, canWriteFileByParent admin/owner bypass
- [ ] buildSync*Checker returns sync functions using preloaded doc
- [ ] canGrantPermission, canRevokePermission, canViewPermissions authorization

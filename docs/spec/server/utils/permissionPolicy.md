# permissionPolicy Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission policy module split across four files under `server/domains/permissions/policy/`. Covers owner path resolution, read/write checks, grant/revoke/view authorization, and synchronous batch checkers. |

> **Phase 4 note:** Path-based compat layer (Tier 2) and sync checker builders (Tier 3) are scheduled for removal in Phase 4 Tasks 4.8d-4.8f. The nodeId-based functions (Tier 1) are retained as the primary interface.

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

### 2.2 Tier Classification

Functions in permissionPolicy.js are classified into three tiers for Phase 4 migration:

**Tier 1 (Retained)** — nodeId-based functions only:
- `canReadNode(userId, nodeId)`
- `canWriteNode(userId, nodeId)`
- `isAdminUser(user)`

**Tier 2 (Removing in Task 4.8d)** — path-based compat layer:
- `canReadFolder(principalId, folderPath)`
- `canReadFile(principalId, filePath)`
- `canWriteFolder(user, folderPath)`
- `canWriteFileByParent(user, filePath)`
- `hasDirectFolderPermission(userId, folderPath)`

**Tier 3 (Removing in Task 4.8d)** — sync checker builders:
- `buildSyncWriteChecker(user, doc)`
- `buildSyncReadChecker(user, doc)`
- `buildSyncReadFileChecker(user, doc)`
- `buildSyncWriteFileByParentChecker(user, doc)`

### 2.3 Callers That Must Migrate Before Removal

| Tier 2/3 Function | Current Callers | Migration Target | Phase 4 Task |
|-------------------|-----------------|------------------|--------------|
| `canReadFolder` | fileService.listDirectoryWithPermissions, downloadService.downloadMultiple | `aclService.checkFolderPermission(userId, nodeId, 'read')` | 4.1, 4.6 |
| `canWriteFolder` | batchOperationService.batchMove, batchOperationService.batchDelete | `aclService.checkFolderPermission(userId, nodeId, 'write')` | 4.6 |
| `canReadFile` | fileService.downloadFile | `aclService.checkFilePermission(userId, nodeId, 'read')` | 4.1 |
| `buildSyncWriteChecker` | batchOperationService (pre-migration) | async gate per item | 4.8c |
| `buildSyncReadChecker` | downloadService (pre-migration) | async gate per file | 4.6 |

### 2.4 Post-Removal State

After Tasks 4.8d-4.8g, `permissionPolicy.js` contains only Tier 1 functions + re-exports from `ownerNodeResolver`, `inheritancePolicy`, `permissionRank`. Expected line count reduction from ~307 to ~100 lines.

Removal is safe only after ALL callers in the table above have migrated to async nodeId checks. Tasks 4.8c (fileService sync→async), 4.6 (batchOperationService, downloadService) must complete before 4.8d can remove Tier 2/3.

### 2.5 Functions / Exports — permissionPolicy.js

> **PRE-REMOVAL — NOT FOR NEW USE** — Any Tier-2 (path-based) and Tier-3 (`buildSync*Checker`) entries listed in this tab are intermediates for Phase 4 removal (Tasks 4.8d-4.8f). Treat them as reference only; new code must use the Tier-1 node-id API (`canReadNode`, `canWriteNode`, aclService). The banner does NOT cover Tier-1 rows (`isAdminUser`, `canReadNode`/`canWriteNode`, ownerNodeResolver, inheritance, permissionRank).

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

### 2.6 Functions / Exports — ownerPathResolver.js

| Function | Signature | Description |
|----------|-----------|-------------|
| userRootPath | (user) => string \| null | Returns /{username} or null |
| isOwnerPath | (user, targetPath) => boolean | Safe prefix match against /{username} |
| getHomeOwnerUserIdForPath | (folderPath) => Promise\<number \| null\> | Resolves first path segment as username to userId |

### 2.7 Functions / Exports — permissionRank.js

| Function | Signature | Description |
|----------|-----------|-------------|
| getPermissionRank | (permission) => number | Numeric rank via PERMISSIONS.ALL.indexOf; -1 for unknown |
| meetsRank | (actual, required) => boolean | actual rank >= required rank |

### 2.8 Functions / Exports — inheritancePolicy.js

| Function | Signature | Description |
|----------|-----------|-------------|
| isDirectoryPath | (path) => boolean | Ends with '/' or equals '/' |
| getLookupPaths | (path, options?) => string[] | Returns [withSlash, noSlash] variants for permission lookup |
| isDirectPermission | (userId, folderPath, requiredPermission) => boolean | Policy marker; actual DB check happens in store layer |

### 2.9 Input / Output

- Compliant with shared-contracts
- principalId: number (userId) or string ("share:token")

### 2.10 Dependencies

- `@webdav-easyaccess/shared/constants` (PERMISSIONS)
- `@webdav-easyaccess/shared/pathUtils` (normalizePath)
- Permission model, User model
- aclService (checkFilePermission, checkFolderPermission, isSharePrincipal) — from `../services/aclService`

### 2.11 Mock Targets

- User.findByUsername, User.findById
- Permission.checkPermission, Permission.getPermissionDoc, Permission.grant
- aclService.checkFolderPermission, aclService.checkFilePermission

### 2.12 Verification Scenarios

> **PRE-REMOVAL — NOT FOR NEW USE** — Any Tier-2 (path-based) and Tier-3 (`buildSync*Checker`) entries listed in this tab are intermediates for Phase 4 removal (Tasks 4.8d-4.8f). Treat them as reference only; new code must use the Tier-1 node-id API (`canReadNode`, `canWriteNode`, aclService). The banner does NOT cover Tier-1 rows (`isAdminUser`, `canReadNode`/`canWriteNode`, ownerNodeResolver, inheritance, permissionRank).

- [ ] isOwnerPath, userRootPath (ownerPathResolver)
- [ ] getHomeOwnerUserIdForPath
- [ ] hasDirectFolderPermission with slash/no-slash compatibility
- [ ] canReadFolder, canReadFile delegates to aclService
- [ ] canWriteFolder, canWriteFileByParent admin/owner bypass
- [ ] buildSync*Checker returns sync functions using preloaded doc
- [ ] canGrantPermission, canRevokePermission, canViewPermissions authorization

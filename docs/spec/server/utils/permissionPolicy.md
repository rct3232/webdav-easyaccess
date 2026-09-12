# permissionPolicy Spec

## 1. Overview

| Item | Description                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | nodeId-only permission policy helpers. All exports operate on `nodeId` (BIGINT) — no path-based functions remain after Wave 4 removal of Tier 2/3 compat layers. |

---

## 2. Implementation Spec

### 2.1 File Paths

| Module            | Source                                                   | Purpose                                                                                 |
| ----------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| permissionPolicy  | `server/domains/permissions/policy/permissionPolicy.js`  | Main policy: nodeId-based read/write/grant/revoke/view checks with admin + owner bypass |
| ownerNodeResolver | `server/domains/permissions/policy/ownerNodeResolver.js` | Owner node detection: isOwnerNode(userId, nodeId) via closure table                     |
| permissionRank    | `server/domains/permissions/policy/permissionRank.js`    | Permission level comparison: getPermissionRank, meetsRank                               |

- **Test file:** `server/utils/__tests__/permissionPolicy.test.js` (test has not been relocated yet)

> **Removed modules** — the following sub-modules were deleted during Wave 4 as their Tier 2/Tier 3 functions had no remaining callers:
>
> - `ownerPathResolver.js` — path-based owner resolution; replaced by `ownerNodeResolver.js` (nodeId-based)
> - `inheritancePolicy.js` — path normalization for permission lookup; inheritance is now handled via closure table queries in the store
>
> **Removed functions (2026-09 dead-code cleanup)** — `canReadFolderNode`, `canWriteFolderNode`, `canReadFileNode`, `canWriteFileNode` had no production callers; use `aclService.checkFolderPermission` / `aclService.checkFilePermission` or `permissionStore.checkPermission` directly.

### 2.2 Post-Wave 4 State

All Tier 2 (path-based compat layer) and Tier 3 (sync checker builder) functions have been removed. The module exports only nodeId-based helpers:

| Function                | Signature                                                  | Description                                                       |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| isAdminUser             | `(user) => boolean`                                        | `user?.is_admin` truthiness check                                 |
| canGrantPermissionNode  | `(userId, targetNodeId) => Promise<boolean>`               | Admin + owner bypass → store.checkPermission(ADMIN)               |
| canRevokePermissionNode | `(userId, targetNodeId, targetUserId) => Promise<boolean>` | Self-revoke + admin + owner bypass → store.checkPermission(ADMIN) |
| canViewPermissionsNode  | `(userId, targetNodeId) => Promise<boolean>`               | Admin + owner bypass → store.checkPermission(ADMIN)               |
| getUserOrNull           | `(userId) => Promise<User \| null>`                        | Fetch user by ID or return null                                   |

### 2.3 Functions / Exports — permissionRank.js

| Function          | Signature                     | Description                                              |
| ----------------- | ----------------------------- | -------------------------------------------------------- |
| getPermissionRank | (permission) => number        | Numeric rank via PERMISSIONS.ALL.indexOf; -1 for unknown |
| meetsRank         | (actual, required) => boolean | actual rank >= required rank                             |

### 2.4 Input / Output

- All node identifiers are BIGINT (`nodeId`), never path strings.
- `userId`: number

### 2.5 Dependencies

- `@webdav-easyaccess/shared/constants` (PERMISSIONS)
- User model
- permissionStore — direct store import for checkPermission calls
- ownerNodeResolver.isOwnerNode — nodeId-based ownership check

### 2.6 Mock Targets

- User.findById
- permStore.checkPermission
- isOwnerNode

### 2.7 Verification Scenarios

- [ ] canGrantPermissionNode checks ADMIN permission via store
- [ ] canRevokePermissionNode allows self-revoke (userId === targetUserId) without admin check
- [ ] getUserOrNull returns null for non-existent userId instead of throwing

### 2.8 Removed Functions (Wave 4)

The following functions were removed during Wave 4 and are **not available**:

**Tier 2 — path-based compat layer:**
| Function | Replacement |
|----------|-------------|
| `canReadFolder(principalId, folderPath)` | `aclService.checkFolderPermission` |
| `canReadFile(principalId, filePath)` | `aclService.checkFilePermission` |
| `canWriteFolder(user, folderPath)` | `aclService.checkFolderPermission(user, dirNodeId, WRITE)` |
| `canWriteFileByParent(user, filePath)` | `aclService.checkFilePermission(user, fileNodeId, WRITE)` |
| `hasDirectFolderPermission(userId, folderPath)` | N/A — direct permission checks handled by store closure table query |

**Tier 3 — sync checker builders:**
| Function | Replacement |
|----------|-------------|
| `buildSyncWriteChecker(user, doc)` | Per-item async check via aclService |
| `buildSyncReadChecker(user, doc)` | Per-item async check via aclService |
| `buildSyncReadFileChecker(user, doc)` | Per-item async check via aclService |
| `buildSyncWriteFileByParentChecker(user, doc)` | Per-item async check via aclService |

**Other removed:**
| Function | Replacement |
|----------|-------------|
| `canGrantPermission(user, folderPath, userId)` | `canGrantPermissionNode(userId, targetNodeId)` |
| `canRevokePermission(user, folderPath, userId, targetUserId)` | `canRevokePermissionNode(userId, targetNodeId, targetUserId)` |
| `canViewPermissions(user, folderPath, userId)` | `canViewPermissionsNode(userId, targetNodeId)` |

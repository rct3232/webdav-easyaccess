> **REMOVED** — `server/models/Permission.js` deleted in Phase 4 Task 4.8e.
> The legacy Permission model wrapper no longer exists in the codebase. All permission CRUD and query operations are performed directly through `permissionStore` (`server/domains/permissions/stores/permissionStore.js`) and `aclService` (`server/domains/permissions/services/aclService.js`), both of which are nodeId-based (`file_node_id BIGINT`).
> This spec is retained for historical reference only.

# Permission Model Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Removed. Legacy Permission model class that proxied path-string based methods to `permissionStore`. Superseded by direct nodeId-based `permissionStore` / `aclService` usage. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/models/Permission.js` — **DELETED**
- **Test file:** `server/models/__tests__/Permission.test.js` — **DELETED**

### 2.2 Removal Details

Phase 4 Task 4.8e removed `server/models/Permission.js` and `server/domains/permissions/services/permissionFacade.js`. All production callers were migrated to import `permissionStore` or `aclService` directly.

The methods this model previously proxied were path-based and have no nodeId-based counterpart on the model layer:

| Legacy Model Method (removed) | nodeId-based replacement |
|-------------------------------|--------------------------|
| grant(userId, folderPath, permission) | permissionStore.grant(userId, nodeId, permission) |
| revoke(userId, folderPath) | permissionStore.revoke(userId, nodeId) |
| checkPermission(userId, folderPath, requiredPermission) | permissionStore.checkPermission(userId, nodeId, requiredPermission) / aclService.checkFolderPermission |
| checkPermissionSync(doc, folderPath, ...) | removed — no synchronous checks exist |
| getFolderPermissions(folderPath, filePath?) | permissionStore.getFolderPermissions(nodeId, fileNodeId?) |
| getFilePermission(userId, filePath) | permissionStore.getFilePermission(userId, fileNodeId) |
| getEffectivePermission(userId, path) | permissionStore.getEffectivePermission(userId, fileNodeId) |
| grantFile(userId, filePath, permission) | permissionStore.grantFilePermission(userId, fileNodeId, permission) |
| revokeFile(userId, filePath) | permissionStore.revokeFilePermission(userId, fileNodeId) |
| grantSharePermission(token, rootPath, isDirectory) | permissionStore.grantSharePermission(token, nodeId) |
| checkSharePermission(token, path, requiredPermission) | permissionStore.checkSharePermission(token, nodeId, requiredPermission) |
| getPermissionDoc / getSharePermissionDoc | permissionStore.getPermissionDoc / getSharePermissionDoc (nodeId-based) |

### 2.3 Current Entry Points

Callers use these modules directly:

- **`permissionStore`** — nodeId-based permission CRUD and queries (`grant`, `revoke`, `checkPermission`, `getFolderPermissions`, `grantFilePermission`, `getEffectivePermission`, `checkSharePermission`, ...). See `docs/spec/server/store/permissionStore.md`.
- **`aclService`** — nodeId-based async permission checks with closure-table inheritance (`checkFolderPermission`, `checkFilePermission`, `checkPermission`, `isAdminUser`).

### 2.4 Dependencies

- None. Module removed; no import sites remain.

### 2.5 Verification Scenarios

- [ ] No file at `server/models/Permission.js`
- [ ] No imports of `models/Permission` or `permissionFacade` remain in server code
- [ ] All permission operations go through nodeId-based `permissionStore` / `aclService` methods

# Permission Model Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission model: delegates to permissionStore for folder/file permissions and share-token permissions. Thin wrapper. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/models/Permission.js`
- **Test file:** `server/models/__tests__/Permission.test.js`

### 2.2 Static Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| grant | (userId, fileNodeId, permission) | permissionStore.grant |
| revoke | (userId, fileNodeId) | permissionStore.revoke |
| revokeAllUserPermissions | (userId) | permissionStore.revokeAllUserPermissions |
| deleteUserPermissionsFile | (userId) | permissionStore.deleteUserPermissionsFile |
| getUserPermissions | (userId) | permissionStore.getUserPermissions |
| checkPermission | (userId, fileNodeId, requiredPermission) | permissionStore.checkPermission |
| getPermissionDoc | (userId) | permissionStore.getPermissionDoc |
| getFolderPermissions | (fileNodeId) | permissionStore.getFolderPermissions |
| hasPermissionsInPath | (fileNodeId) | permissionStore.hasPermissionsInPath |
| getFilePermission | (userId, fileNodeId) | permissionStore.getFilePermission |
| getEffectivePermission | (userId, nodeId) | permissionStore.getEffectivePermission |
| grantFile | (userId, fileNodeId, permission) | permissionStore.grant(..., { target: 'file' }) |
| revokeFile | (userId, fileNodeId) | permissionStore.revoke(..., { scope: 'pathOnly' }) |
| getUserFilePermissions | (userId) | permissionStore.getUserFilePermissions |
| grantSharePermission | (token, fileNodeId) | permissionStore.grantSharePermission |
| revokeSharePermission | (token) | permissionStore.revokeSharePermission |
| getSharePermissionDoc | (token) | permissionStore.getSharePermissionDoc |
| checkSharePermission | (token, nodeId, requiredPermission) | permissionStore.checkSharePermission |

**REMOVED methods:** `rewritePermissionsForAllUsers`, `revokePermissionsPrefixForAllUsers` — node_ids are stable; rename/move does not change node_id.

### 2.3 Dependencies

- permissionStore

### 2.4 Verification Scenarios

- [ ] All methods delegate to store using file_node_id parameters; mock store and assert calls

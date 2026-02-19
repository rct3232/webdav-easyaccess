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
| grant | (userId, folderPath, permission, options) | permissionStore.grant |
| revoke | (userId, folderPath, options) | permissionStore.revoke |
| revokeAllUserPermissions | (userId) | permissionStore.revokeAllUserPermissions |
| deleteUserPermissionsFile | (userId) | permissionStore.deleteUserPermissionsFile |
| getUserPermissions | (userId) | permissionStore.getUserPermissions |
| checkPermission | (userId, folderPath, requiredPermission) | permissionStore.checkPermission |
| checkPermissionSync | (doc, folderPath, requiredPermission) | permissionStore.checkPermissionSync |
| getPermissionDoc | (userId) | permissionStore.getPermissionDoc |
| checkPermissions | (userId, paths, requiredPermission) | permissionStore.checkPermissions |
| getFolderPermissions | (folderPath, filePath) | permissionStore.getFolderPermissions |
| hasPermissionsInPath | (folderPath) | permissionStore.hasPermissionsInPath |
| rewritePermissionsForAllUsers | (mappings, options) | permissionStore.rewritePermissionsForAllUsers |
| revokePermissionsPrefixForAllUsers | (prefixes) | permissionStore.revokePermissionsPrefixForAllUsers |
| getFilePermission | (userId, filePath) | permissionStore.getFilePermission |
| getEffectivePermission | (userId, path) | permissionStore.getEffectivePermission |
| grantFile | (userId, filePath, permission) | permissionStore.grant(..., { target: 'file' }) |
| revokeFile | (userId, filePath) | permissionStore.revoke(..., { scope: 'pathOnly' }) |
| getUserFilePermissions | (userId) | permissionStore.getUserFilePermissions |
| checkFilePermissionSync | (doc, filePath, requiredPermission) | permissionStore.checkFilePermissionSync |
| getPathEffectivePermission | (userId, folderPath) | permissionStore.getPathEffectivePermission |
| grantSharePermission | (token, rootPath, isDirectory) | permissionStore.grantSharePermission |
| revokeSharePermission | (token) | permissionStore.revokeSharePermission |
| getSharePermissionDoc | (token) | permissionStore.getSharePermissionDoc |
| checkSharePermission | (token, path, requiredPermission) | permissionStore.checkSharePermission |

### 2.3 Dependencies

- permissionStore

### 2.4 Verification Scenarios

- [ ] All methods delegate to store; mock store and assert calls

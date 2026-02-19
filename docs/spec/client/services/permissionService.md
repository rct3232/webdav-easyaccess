# permissionService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission API: list by user/folder, grant, revoke, check effective permission, file-level permissions. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/permissionService.js`
- **Test file:** `client/src/services/__tests__/permissionService.test.js`

### 2.2 Main Functions

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| getUserPermissions | (userId) | Promise\<Array\> | GET /api/permissions/user/:userId |
| getFolderPermissions | (path, includeSubfolders?, filePath?) | Promise\<Array\> | GET /api/permissions/folder |
| grantPermission | ({ userId, folderPath, permission, target? }) | Promise\<void\> | POST /api/permissions/grant |
| revokePermission | ({ userId, folderPath, includeSubfolders?, scope? }) | Promise\<void\> | DELETE /api/permissions/revoke |
| checkPermission | (path) | Promise\<Object\> | GET /api/permissions/check |
| listFilePermissions | (folderPath?) | Promise\<Array\> | GET /api/permissions/file/list |

- target: 'file' for file-level grant
- scope: 'pathOnly' for file-level revoke

### 2.3 Error Handling

- Errors propagated; callers use getServerErrorDisplay

### 2.4 Verification Scenarios

- [ ] getUserPermissions, getFolderPermissions return arrays
- [ ] grantPermission with target 'file' for file permission
- [ ] revokePermission with scope 'pathOnly' for file
- [ ] checkPermission returns hasRead, hasWrite, source

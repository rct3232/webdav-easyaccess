# permissionPolicy Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission policy: isAdminUser, userRootPath, isOwnerPath, getHomeOwnerUserIdForPath, hasDirectFolderPermission, canReadFolder, canReadFile. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/permissionPolicy.js`
- **Test file:** `server/utils/__tests__/permissionPolicy.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| isAdminUser | (user) => boolean | user?.is_admin |
| userRootPath | (user) => string \| null | /{username} |
| isOwnerPath | (user, targetPath) => boolean | target under /{username} |
| getHomeOwnerUserIdForPath | (folderPath) => Promise\<number \| null\> | First segment as username |
| hasDirectFolderPermission | (userId, folderPath, perm) => Promise\<boolean\> | Direct check |
| canReadFolder | (principalId, folderPath) => Promise\<boolean\> | Delegates to checkFolderPermission |
| canReadFile | (principalId, filePath) => Promise\<boolean\> | Delegates to checkFilePermission |

### 2.3 Input / Output

- Compliant with shared-contracts
- principalId: number (userId) or string (share:token)

### 2.4 Dependencies

- Permission, User, permissions middleware (checkFolderPermission, checkFilePermission)
- normalizePath

### 2.5 Mock Targets

- User.findByUsername
- Permission.checkPermission
- checkFolderPermission, checkFilePermission

### 2.6 Verification Scenarios

- [ ] isOwnerPath, userRootPath
- [ ] getHomeOwnerUserIdForPath
- [ ] hasDirectFolderPermission
- [ ] canReadFolder, canReadFile with principalId

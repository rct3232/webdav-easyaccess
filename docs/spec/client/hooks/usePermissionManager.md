# usePermissionManager Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Folder permissions state for ShareDialog: folderPermissions Map, handleAddUserPermission, handleRemoveUserPermission, handleToggleUserPermission, hasPermissionChanged. |
| Used by components/pages | ShareDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareDialog/hooks/usePermissionManager.js`
- **Test file:** `client/src/components/dialogs/ShareDialog/hooks/__tests__/usePermissionManager.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| mode | string | Y | Mode |
| userId | string | N | User ID |
| username | string | N | Username |
| permissionRequest | object | N | Permission request |
| onMessage | function | N | Message |
| onSave | function | N | Save |
| onApprove | function | N | Approve |
| onClose | function | N | Close |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| folderPermissions | Map | Path -> Map(userId -> permission) |
| setFolderPermissions | function | Set |
| initialFolderPermissions | Map | Initial |
| userInfoMap | Map | User info |
| saving | boolean | Saving |
| loadingPermissions | boolean | Loading |
| handleAddUserPermission | (path, userId, perm, subPaths?) => void | Add |
| handleRemoveUserPermission | (path, userId, subPaths?) => void | Remove |
| handleToggleUserPermission | (path, userId, subPaths?) => void | Toggle |
| hasPermissionChanged | boolean | Dirty |

### 2.4 Dependencies

- normalizePath
- No direct API (used with useShareDialog)

### 2.5 Side Effects

- State updates only

### 2.6 Error Handling

- None

### 2.7 Verification Scenarios

- [ ] Add, remove, toggle permission
- [ ] subfolderPaths applied
- [ ] hasPermissionChanged

### 2.8 Edge Cases

- Path -> Map structure
- Subfolder propagation

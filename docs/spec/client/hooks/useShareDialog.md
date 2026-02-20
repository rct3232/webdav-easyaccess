# useShareDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | ShareDialog state: users, folderTree, expandedPaths, folder menu, external share. Loads users, folder children. Integrates usePermissionManager. |
| Used by components/pages | ShareDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useShareDialog.js`
- **Test file:** `client/src/hooks/__tests__/useShareDialog.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| open | boolean | Y | Dialog open |
| mode | string | Y | 'admin' \| 'share' \| 'manage' \| 'review' |
| userId | string | N | Target user |
| username | string | N | Username |
| startFromUserHome | boolean | N | Admin start |
| folderPath | string | N | Folder path |
| folderName | string | N | Folder name |
| permissionRequest | object | N | Review request |
| enableExternalShare | boolean | N | External share |
| onMessage | function | N | Message |
| onSave | function | N | Save |
| onApprove | function | N | Approve |
| onClose | function | N | Close |
| folderPermissions, setFolderPermissions, ... | from usePermissionManager | Y | Permission state |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| rootPath | string | Root path |
| users | array | Users list |
| folderTree | Map | Folder tree |
| expandedPaths | Set | Expanded |
| loadingPaths | Set | Loading paths |
| loadingAllFolders | boolean | Loading |
| folderMenuAnchor | element | Menu anchor |
| folderMenuPath | string | Menu path |
| folderMenuView | string | 'manage' \| 'add' |
| externalShare* | state | External share state |
| toggleExpand | (path) => void | Toggle |
| handleSave | () => Promise | Save |
| ... | | Other handlers |

### 2.4 Dependencies

- getApprovedUsers, updateUserPermissions (userService)
- getUserPermissions, getFolderPermissions, grantPermission, revokePermission (permissionService)
- listFiles (fileService)
- approvePermissionRequest (permissionRequestService)
- normalizePath, getUserBaseFolder (pathUtils, userUtils)
- getServerErrorDisplay (errorUtils)

### 2.5 Side Effects

- loadUsers, loadFolderChildren on open
- API calls for save, approve

### 2.6 Error Handling

- onMessage for errors
- **On API failure (save, approve – 4xx/5xx, network error):** Do **not** call onClose. Dialog stays open; error shown via onMessage. User can retry or close. Same pattern as useFileOperations §2.6, useSharedManage.

### 2.7 Verification Scenarios

- [ ] Load users, folder tree
- [ ] Expand, folder menu
- [ ] Save, approve
- [ ] External share

### 2.8 Edge Cases

- isAdminMode, isShareMode, isReviewMode
- rootPath from mode

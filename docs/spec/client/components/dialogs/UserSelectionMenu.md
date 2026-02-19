# UserSelectionMenu Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Menu for share dialog: add user, manage permissions per user, toggle permissions. Anchored to folder tree item. |
| Used in | ShareDialog |
| Related components | ShareFolderTree |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/UserSelectionMenu.js`
- **Test file:** `client/src/components/__tests__/UserSelectionMenu.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| folderMenuAnchor | element | Y | - | Menu anchor |
| onClose | function | Y | - | Close handler |
| folderMenuPath | string | Y | - | Folder path |
| folderPermissions | Map | Y | - | Path -> user permissions |
| isAdminMode | boolean | Y | - | Admin mode |
| userId | string | N | - | Current user ID |
| username | string | N | - | Username |
| user | object | N | - | Current user |
| userInfoMap | Map | Y | - | User info map |
| users | array | Y | - | Users list |
| getUserName | function | Y | - | Get display name |
| handleTogglePermission | function | Y | - | Toggle permission |
| handleRemoveUser | function | Y | - | Remove user |
| folderMenuView | string | Y | - | 'manage' \| 'add' |
| setFolderMenuView | function | Y | - | Set view |
| handleAddUser | function | N | - | Add user |
| handleUserSelect | function | N | - | User select |
| isShareMode | boolean | Y | - | Share mode |
| isReviewMode | boolean | Y | - | Review mode |
| permissionRequest | object | N | - | Pending request |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Menu close | - |
| handleTogglePermission | Permission toggle | (userId, permission) |
| handleRemoveUser | Remove user | (userId) |
| setFolderMenuView | View switch | ('manage' \| 'add') |

### 2.4 Dependencies

- **imports:** PERMISSIONS
- **Reference implementation:** `client/src/components/dialogs/UserSelectionMenu.js`

### 2.5 i18n Keys

- dialogs.*, permissions.*

### 2.6 Conditional Rendering

- Returns null when !folderMenuPath
- Admin vs share mode: different user filtering
- Manage view: list users with toggle/remove
- Add view: user selector

### 2.7 Verification Scenarios

- [ ] Renders manage/add views
- [ ] Toggle, remove, add user
- [ ] onClose

### 2.8 Edge Cases

- currentIsUserBaseFolder: canEdit logic

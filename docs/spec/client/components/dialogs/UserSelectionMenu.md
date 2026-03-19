# UserSelectionMenu Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Menu view for the share-dialog folder tree. Renders manage/select-user menu states and forwards user actions through callbacks. The target boundary is view-lean rendering from prepared props, with only minimal local branching. |
| Used in | ShareDialog |
| Related components | ShareFolderTree |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/UserSelectionMenu.js`
- **Test file:** `client/src/components/dialogs/__tests__/UserSelectionMenu.test.js`

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
| folderMenuView | string | Y | - | `'manage' \| 'selectUser'` |
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
| handleTogglePermission | Permission toggle | `(folderPath, userId)` |
| handleRemoveUser | Remove user | `(folderPath, userId)` |
| setFolderMenuView | View switch | `('manage' \| 'selectUser')` |
| handleUserSelect | Select a user to add | `(userId)` |

### 2.4 Dependencies

- **imports:** `PERMISSIONS`, `deriveShareFolderAccessView`
- **Reference implementation:** `client/src/components/dialogs/UserSelectionMenu.js`

### 2.4.1 Boundary notes

- Prepared display-user models should come from upstream helpers/controllers where practical.
- `deriveShareFolderAccessView` should prepare both rendered access chips and select-user candidates for this menu while staying side-effect-free and UI-neutral.
- Policy-heavy filtering such as addable-user selection and review-request special casing should stay in helpers/controllers rather than accumulating inline branches here.

### 2.5 i18n Keys

- `dialogs.*`, `permissions.*`

### 2.6 Conditional Rendering

- Returns null when !folderMenuPath
- Manage view: list prepared users with toggle/remove actions
- Select-user view: list prepared addable users or a helper-prepared review-request requester entry
- Any filtering or display-user shaping should be prepared upstream where practical; this component should not become a policy-heavy controller

### 2.7 Verification Scenarios

- [ ] Renders manage/select-user views
- [ ] Toggle, remove, add user
- [ ] Review mode shows requester-only add option when applicable
- [ ] onClose
- [ ] Prepared user lists render the same visible menu options after filtering/derivation is moved upstream

### 2.8 Edge Cases

- Admin user base folder may disable edit/remove actions for the owner's root path
- Empty prepared user names should not render user chips

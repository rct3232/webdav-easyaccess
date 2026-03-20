# deriveShareFolderAccessView Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure helper that derives view-ready sharing state for `ShareFolderTree` and `UserSelectionMenu` from raw folder permission maps, review-request data, and user metadata. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/deriveShareFolderAccessView.js`
- **Test file:** `client/src/utils/__tests__/deriveShareFolderAccessView.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| deriveShareFolderAccessView | `(params) => derivedViewState` |

### 2.3 Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| folderPath | string | Y | Path whose menu/button state is being derived |
| folderPermissions | `Map<string, Map<string, string>>` | Y | Raw folder permission map |
| isAdminMode | boolean | Y | Admin mode flag |
| userId | string | N | Admin target user id |
| username | string | N | Admin target username |
| user | object | N | Current user |
| userInfoMap | `Map<string, object>` | Y | Supplemental user metadata |
| users | array | Y | Approved-user list |
| getUserName | function | Y | Display-name resolver |
| hasPermissionChanged | function | N | Path changed-state predicate |
| isReviewMode | boolean | N | Whether the menu is showing permission-review affordances |
| permissionRequest | object | N | Pending request used to derive requester-only add behavior |

### 2.4 Output

- `currentFolderUserPerms`
- `displayUsers` (view-ready user entries with `userId`, `permission`, `userName`)
- `availableUsers` (view-ready add-user candidates)
- `reviewRequesterOption` (`null` or `{ userId, userName, alreadyAdded }`)
- `userCount`
- `currentIsUserBaseFolder`
- `isFolderWithAdminPermission`
- `isChanged`

### 2.5 Dependencies

- `PERMISSIONS`

### 2.6 Verification Scenarios

- [ ] Admin mode includes only the target user
- [ ] Non-admin mode excludes the current user and admin users
- [ ] Empty display names are filtered from `displayUsers`
- [ ] Available-user candidates exclude already-added users, the current user, and admin users
- [ ] Review mode derives a requester-only add option with the correct already-added state
- [ ] User-count reflects only rendered users
- [ ] Admin root path is marked as owner-locked when the target user has admin permission there

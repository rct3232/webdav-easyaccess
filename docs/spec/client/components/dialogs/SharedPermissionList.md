# SharedPermissionList Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Unified permission list for folder/file. Folder: hasReadPermission, hasWritePermission. File: pathPermission, filePermissionLevel with 4 levels and 5 modifiers. |
| Used in | SharedManageBody |
| Related components | PERMISSIONS constants |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/SharedPermissionList.js`
- **Test file:** `client/src/components/__tests__/SharedPermissionList.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| isDirectory | boolean | Y | - | Is folder |
| hasReadPermission | boolean | Y | - | Folder read |
| hasWritePermission | boolean | Y | - | Folder write |
| pathPermission | string | N | - | File path permission |
| filePermissionLevel | string | N | - | File permission level |
| pendingRequest | object | N | - | Pending request |
| loading | boolean | Y | - | Loading |
| ownerExists | boolean | Y | - | Owner exists |
| onRequestPermission | function | Y | - | Request handler |
| onCancelPendingRequest | function | Y | - | Cancel handler |
| onRevokeClick | function | Y | - | Revoke click (opens confirm) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onRequestPermission | Request button | - |
| onCancelPendingRequest | Cancel request | - |
| onRevokeClick | Revoke button | - |

### 2.4 Dependencies

- **imports:** PERMISSIONS, getPermissionLevels, MUI Box/Button/Typography
- **Reference implementation:** `client/src/components/dialogs/SharedPermissionList.js`

### 2.5 i18n Keys

- dialogs.*, permissions.*

### 2.6 Conditional Rendering

- Folder vs file layout (different permission levels)
- pendingRequest: show cancel instead of request
- ownerExists false: disable revoke

### 2.7 Verification Scenarios

- [ ] Folder: read/write buttons
- [ ] File: path + file permission levels
- [ ] Request, cancel, revoke callbacks

### 2.8 Edge Cases

- getPermissionLevels normalizes folder vs file inputs

# SharedManageBody Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Presentational body for shared item management. Shows display name, loading/skeleton, SharedPermissionList. No hooks. |
| Used in | SharedManageDialog, ShareTargetDialog |
| Related components | SharedPermissionList |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/SharedManageBody.js`
- **Test file:** `client/src/components/dialogs/__tests__/SharedManageBody.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| displayName | string | Y | - | Item name |
| isDirectory | boolean | Y | - | Is folder |
| loading | boolean | Y | - | Loading state |
| initialLoading | boolean | Y | - | Initial fetch |
| confirmDialogOpen | boolean | Y | - | Revoke confirm open |
| setConfirmDialogOpen | function | Y | - | Set confirm state |
| hasReadPermission | boolean | Y | - | Read permission |
| hasWritePermission | boolean | Y | - | Write permission |
| pathPermission | string | N | - | Path permission (file) |
| filePermissionLevel | string | N | - | File permission level |
| pendingRequest | object | N | - | Pending permission request |
| ownerExists | boolean | Y | - | Owner exists |
| onRequestPermission | function | Y | - | Request handler |
| onCancelPendingRequest | function | Y | - | Cancel request handler |
| onRevokePermission | function | Y | - | Revoke handler |
| loadingVariant | string | N | 'skeleton' | 'skeleton' \| 'spinner' |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| setConfirmDialogOpen | Revoke click | (boolean) |
| onRequestPermission | Request permission | - |
| onCancelPendingRequest | Cancel request | - |
| onRevokePermission | Revoke confirm | - |

### 2.4 Dependencies

- **imports:** SharedPermissionList, MUI Box/Button/Dialog/Typography/CircularProgress/Skeleton
- **Reference implementation:** `client/src/components/dialogs/SharedManageBody.js`

### 2.5 i18n Keys

- `actions.folder`, `actions.file`, `dialogs.revokeConfirmBody`, `dialogs.ownerDeleted`

### 2.6 Conditional Rendering

- initialLoading: spinner or skeleton by loadingVariant
- SharedPermissionList when !initialLoading
- ownerExists === false: error message

### 2.7 Verification Scenarios

- [ ] Renders label, SharedPermissionList
- [ ] Loading states
- [ ] Callbacks invoked

### 2.8 Edge Cases

- loadingVariant spinner vs skeleton

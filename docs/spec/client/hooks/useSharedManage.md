# useSharedManage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Shared item management: load permission info, request permission, cancel request, revoke. For SharedManageDialog, ShareTargetDialog. |
| Used by components/pages | SharedManageDialog, ShareTargetDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useSharedManage.js`
- **Test file:** `client/src/hooks/__tests__/useSharedManage.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| open | boolean | Y | Dialog open |
| targetPath | string | Y | Target path |
| displayName | string | Y | Display name |
| isDirectory | boolean | Y | Is directory |
| user | object | Y | User |
| directHasReadPermission | boolean | N | Direct read |
| onMessage | function | N | Message |
| onActionComplete | function | N | Action complete |
| onClose | function | N | Close |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| loading | boolean | Loading |
| initialLoading | boolean | Initial load |
| confirmDialogOpen | boolean | Revoke confirm |
| setConfirmDialogOpen | function | Set confirm |
| hasReadPermission | boolean | Read |
| hasWritePermission | boolean | Write |
| pathPermission | string | Path permission (file) |
| filePermissionLevel | string | File level |
| pendingRequest | object | Pending request |
| ownerExists | boolean | Owner exists |
| handlePermissionRequest | function | Request |
| handleCancelPendingRequest | function | Cancel |
| handleRevokePermission | function | Revoke |

### 2.4 Dependencies

- checkPermission, revokePermission
- cancelPermissionRequest, createPermissionRequest, listOutboxPermissionRequests, checkOwnerExists

### 2.5 Side Effects

- checkPermission on open
- checkOwnerExists
- API calls for request, cancel, revoke

### 2.6 Error Handling

- getServerErrorDisplay, onMessage

### 2.7 Verification Scenarios

- [ ] Load permission info
- [ ] Admin: hasRead/hasWrite true
- [ ] Request, cancel, revoke
- [ ] ownerExists

### 2.8 Edge Cases

- isDirectory vs file: pathPermission, filePermissionLevel
- Admin skips API

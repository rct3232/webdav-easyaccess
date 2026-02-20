# SharedManageDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog to manage shared item: view/request/revoke permissions. Uses useSharedManage and SharedManageBody. |
| Used in | FileManager (manage sharing from context menu) |
| Related components | SharedManageBody, useSharedManage |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/SharedManageDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/SharedManageDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| targetPath | string | Y | - | Path to manage |
| displayName | string | Y | - | Display name |
| isDirectory | boolean | Y | - | Is directory |
| user | object | Y | - | Current user |
| directHasReadPermission | boolean | N | - | Direct read permission |
| onMessage | function | N | - | Message handler |
| onActionComplete | function | N | - | Action complete handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Dialog close | - |
| onMessage | Show message | - |
| onActionComplete | Action done | - |

### 2.4 Dependencies

- **imports:** useSharedManage, SharedManageBody
- **Reference implementation:** `client/src/components/dialogs/SharedManageDialog.js`

### 2.5 i18n Keys

- `dialogs.sharedManageTitle`, `dialogs.ownerDeleted`, `common.close`

### 2.6 Conditional Rendering

- Dialog hidden when confirmDialogOpen
- ownerExists === false: error caption
- SharedManageBody with loading, permission, pending request, revoke

### 2.7 Verification Scenarios

- [ ] Renders SharedManageBody
- [ ] onClose, onMessage
- [ ] Request permission, cancel request, revoke

### 2.8 Edge Cases

- ownerDeleted – owner no longer exists

### 2.9 API Error Behavior

- **On API success (request, cancel, revoke):** onActionComplete called; parent may close dialog.
- **On API failure (4xx/5xx, network error):** Dialog **stays open**. Error shown via onMessage. User can retry or close. Same pattern as RenameDialog, ShareTargetDialog, useSharedManage.

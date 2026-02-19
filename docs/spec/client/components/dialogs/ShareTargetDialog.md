# ShareTargetDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog for selecting share target (user or external link). Integrates user selection, folder permissions, external share section. Uses useSharedManage. |
| Used in | FileManager (share action) |
| Related components | SharedManageBody, ExternalShareSection, useSharedManage, getApprovedUsers, permissionService, shareLinkService |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareTargetDialog.js`
- **Test file:** `client/src/components/__tests__/ShareTargetDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| targetPath | string | Y | - | Path to share |
| displayName | string | Y | - | Display name |
| isDirectory | boolean | Y | - | Whether target is directory |
| user | object | Y | - | Current user |
| directHasReadPermission | boolean | N | - | Direct read permission |
| onMessage | function | N | - | Message handler |
| onActionComplete | function | N | - | Action complete handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Dialog close | - |
| onMessage | Show message | - |
| onActionComplete | Permission/share action done | - |

### 2.4 Dependencies

- **imports:** useSharedManage, SharedManageBody, ExternalShareSection, permissionService, shareLinkService, getApprovedUsers
- **Reference implementation:** `client/src/components/dialogs/ShareTargetDialog.js`

### 2.5 i18n Keys

- dialogs.*, permissions.*

### 2.6 Conditional Rendering

- User dropdown, folder permission options, external share
- Permission options based on pathPermission, filePermissionLevel

### 2.7 Verification Scenarios

- [ ] User selection, permission change, external link creation
- [ ] onClose, onMessage, onActionComplete

### 2.8 Edge Cases

- pathPermission ADMIN – limited options
- hasSameLevelFilePermission – revoke/same-as-path options

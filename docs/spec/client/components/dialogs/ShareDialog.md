# ShareDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Share/manage permissions dialog. Uses usePermissionManager and useShareDialog. Contains ShareFolderTree, UserSelectionMenu, ExternalShareSection, FolderShareSection. |
| Used in | FileManager, MyPage |
| Related components | ShareFolderTree, UserSelectionMenu, ExternalShareSection, FolderShareSection, useShareDialog, usePermissionManager |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareDialog.js`
- **Test file:** `client/src/components/__tests__/ShareDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| mode | string | N | 'share' | 'share' \| 'manage' \| 'review' |
| userId | string | N | null | Target user ID |
| username | string | N | null | Target username |
| onSave | function | N | null | Save handler |
| startFromUserHome | boolean | N | false | Start from user home |
| folderPath | string | N | null | Initial folder path |
| folderName | string | N | null | Folder display name |
| user | object | N | null | Current user |
| permissionRequest | object | N | null | Permission request (review mode) |
| onApprove | function | N | null | Approve handler |
| onMessage | function | N | null | Message handler |
| enableExternalShare | boolean | N | false | Show external share section |
| filePath | string | N | null | File path (single file share) |
| fileName | string | N | null | File name |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Dialog close | - |
| onSave | Save permissions | - |
| onApprove | Approve request (review mode) | - |
| onMessage | Show message | - |

### 2.4 Dependencies

- **imports:** usePermissionManager, useShareDialog, ShareFolderTree, UserSelectionMenu, ExternalShareSection, FolderShareSection, useResponsive, createShareLink, getShareLinkUrl (shareLinkService)
- **Reference implementation:** `client/src/components/dialogs/ShareDialog.js`

### 2.5 i18n Keys

- `dialogs.permissionSettings` – admin mode title
- `dialogs.permissionReview` – review mode title
- `dialogs.folderShare` – share mode title
- `dialogs.externalShareTitle` – external share section title
- `common.close` – close button (external share mode)
- `common.cancel` – cancel button
- `common.saving` – save button loading state
- `common.confirm` – confirm/save button

### 2.6 Conditional Rendering

- mode, isAdminMode, isShareMode, isReviewMode control layout
- enableExternalShare shows ExternalShareSection
- fullScreen on mobile

### 2.7 Verification Scenarios

- [ ] Renders folder tree, user selection, external share when enabled
- [ ] onSave, onClose, onApprove invoked
- [ ] Mode-specific content

### 2.8 Edge Cases

- permissionRequest for review mode
- filePath/fileName for single file share

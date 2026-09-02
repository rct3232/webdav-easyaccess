# ShareDialog Spec

## 1. Overview

| Item               | Description                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Dialog shell for share/admin/review flows. Composes `usePermissionManager` and `useShareDialog`, then renders prepared state through child view components. |
| Used in            | FileManager, MyPage                                                                                                                                         |
| Related components | `ShareFolderTree`, `UserSelectionMenu`, `ExternalShareSection`, `FolderShareSection`, `useShareDialog`, `usePermissionManager`                              |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareDialog/ShareDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/ShareDialog.test.js`

### 2.2 Props

| Name                | Type     | Required | Default | Description                      |
| ------------------- | -------- | -------- | ------- | -------------------------------- |
| open                | boolean  | Y        | -       | Dialog open                      |
| onClose             | function | Y        | -       | Close handler                    |
| mode                | string   | N        | 'share' | 'share' \| 'manage' \| 'review'  |
| userId              | string   | N        | null    | Target user ID                   |
| username            | string   | N        | null    | Target username                  |
| onSave              | function | N        | null    | Save handler                     |
| startFromUserHome   | boolean  | N        | false   | Start from user home             |
| folderPath          | string   | N        | null    | Initial folder path              |
| folderName          | string   | N        | null    | Folder display name              |
| user                | object   | N        | null    | Current user                     |
| permissionRequest   | object   | N        | null    | Permission request (review mode) |
| onApprove           | function | N        | null    | Approve handler                  |
| onMessage           | function | N        | null    | Message handler                  |
| enableExternalShare | boolean  | N        | false   | Show external share section      |
| fileNodeId          | number   | N        | null    | File node id (single file share) |
| fileName            | string   | N        | null    | File name                        |

### 2.3 Callback Signatures

| Callback  | When invoked                  | Arguments |
| --------- | ----------------------------- | --------- |
| onClose   | Dialog close                  | -         |
| onSave    | Save permissions              | -         |
| onApprove | Approve request (review mode) | -         |
| onMessage | Show message                  | -         |

### 2.4 Dependencies

- **imports:** `usePermissionManager`, `useShareDialog`, `ShareFolderTree`, `UserSelectionMenu`, `ExternalShareSection`, `FolderShareSection`, `useResponsive`, `createShareLink`, `getShareLinkUrl`, browser-opening adapter callbacks
- **Reference implementation:** `client/src/components/dialogs/ShareDialog/ShareDialog.js`

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

- `mode`, `isAdminMode`, `isShareMode`, and `isReviewMode` determine title and save behavior
- `enableExternalShare` hides folder-permission content and shows only `ExternalShareSection`
- Full-screen behavior is responsive-only; no sharing logic should depend on viewport
- This shell may compose child views and callback wiring, but it should not derive sharing rules inline
- Browser-specific side effects needed by child views (for example opening an external share link) should be provided as adapter-backed callbacks instead of letting the child view call `window.*`

### 2.7 Verification Scenarios

- [ ] Renders folder-permission content in admin/share/review modes
- [ ] Renders only external-share content when `enableExternalShare` is true
- [ ] Admin mode title includes the target username
- [ ] Review mode title includes the selected folder name
- [ ] Save success closes through hook/controller behavior; save failure keeps the dialog open
- [ ] Review approval success calls `onApprove`

### 2.8 Edge Cases

- permissionRequest for review mode
- fileNodeId/fileName for single file share
- `mode='review'` with missing `permissionRequest` is undefined; parent flow should not open the dialog in that state
- `fileNodeId` present with missing `fileName` should rely on the upstream fallback or caller guarantee

### 2.9 API Error Behavior

- **On API success (save, approve):** The controller hook dispatches success callbacks and closes the dialog.
- **On API failure (4xx/5xx, network error):** The dialog **stays open**. Error is shown via `onMessage`. User can retry or close manually.

# CreateFolderDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog to create a new folder in the current path. Validates folder name, calls createFolder API, reports progress. |
| Used in | FileManager (when user triggers create folder) |
| Related components | BaseDialog, useFormState, fileService.createFolder |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/CreateFolderDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/CreateFolderDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Whether dialog is open |
| onClose | function | Y | - | Close handler |
| onComplete | function | Y | - | Called on success with (folderPath, folderName) |
| currentPath | string | Y | - | Display path where folder will be created (used for the display folderPath in onComplete) |
| parentNodeId | number\|null | Y | - | Parent folder nodeId sent to `createFolder` (`null` = root level) |
| onProgress | function | N | - | Progress callback for progressItem updates |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Cancel or dialog close | - |
| onComplete | After successful create | (folderPath: string, folderName: string) |
| onProgress | During create (preparing, processing, completed, error) | progressItem object |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Button/TextField, BaseDialog, useFormState, createFolder (fileService), validateFileName (shared), getValidationMessage, getServerErrorDisplay
- **Reference implementation:** `client/src/components/dialogs/CreateFolderDialog.js`

### 2.5 i18n Keys

- `dialogs.createFolderTitle` – dialog title
- `dialogs.folderName` – input label
- `dialogs.create` – create button
- `common.cancel` – cancel button
- `fileManager.createFolder` – progress name
- `fileManager.statusCreatingFolder` – processing status
- `common.confirm` – completed status
- `dialogs.createFolderFail` – error fallback

### 2.6 Conditional Rendering

- Form resets on close
- Submit disabled during isSubmitting
- onProgress called when provided (optional progress reporting)
- E2E selector contract:
  - the folder-name input exposes a stable `data-testid`
  - the primary submit button exposes a stable `data-testid`
  - these selectors avoid coupling flow tests to localized dialog copy

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders folder name input and create/cancel buttons
- [ ] Validation: empty/invalid folder name shows error
- [ ] createFolder API called on submit with `parentNodeId` and name
- [ ] onComplete called with folderPath and folderName on success
- [ ] onClose and reset called on cancel
- [ ] Error from API shows via getServerErrorDisplay
- [ ] onProgress called when provided

### 2.8 Edge Cases

- currentPath='/' – folder path = `/${folderName}`
- currentPath with trailing – `${currentPath}/${folderName}`
- Trimmed folder name used for API and onComplete
- Progress item remove: true after 3s on success
- 폴더명 길이 제한: validateFileName(shared) 기준; 초과 시 validation error
- 동일 경로에 동시 생성 요청: 409 또는 400(이미 존재); 에러 표시 후 사용자 재시도

### 2.9 API Error Behavior

- **On API success:** Parent calls onClose; dialog closes. onComplete called; list refreshes.
- **On API failure (4xx/5xx, network error):** Dialog **stays open**. Error shown via onProgress (status 'error') or getServerErrorDisplay. User can correct input, retry, or cancel. Same pattern as RenameDialog, LoginDialog, useFileOperations.

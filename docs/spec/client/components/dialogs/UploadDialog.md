# UploadDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog for selecting files to upload. Uses react-dropzone for drag-and-drop. Lists selected files, remove option, upload button. |
| Used in | FileManager |
| Related components | BaseDialog, useDropzone |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/UploadDialog.js`
- **Test file:** `client/src/components/__tests__/UploadDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| currentPath | string | Y | - | Upload destination path |
| onUploadStart | function | Y | - | Called with (fileList, currentPath) on upload |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Dialog close | - |
| onUploadStart | Upload button click | (fileList: File[], currentPath: string) |

### 2.4 Dependencies

- **imports:** BaseDialog, useDropzone
- **Reference implementation:** `client/src/components/dialogs/UploadDialog.js`

### 2.5 i18n Keys

- `dialogs.uploadTitle`, `dialogs.upload`, `common.cancel`, `dialogs.uploadDropzone`, `dialogs.removeFile`

### 2.6 Conditional Rendering

- Files list with remove per file
- Upload disabled when files.length === 0
- Files reset when dialog closes

### 2.7 Verification Scenarios

- [ ] Dropzone accepts files
- [ ] Remove file
- [ ] onUploadStart called with fileList, currentPath
- [ ] Files cleared on close

### 2.8 Edge Cases

- onUploadStart called twice: once without args (dismiss), then with (fileList, currentPath)

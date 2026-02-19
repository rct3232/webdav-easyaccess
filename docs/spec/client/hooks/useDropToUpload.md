# useDropToUpload Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Drop-to-upload from OS: extract files (including directories), upload to path. Folder mode: onExplorerDrop. Main mode: onUploadComplete, onUploadError. |
| Used by components/pages | FileManager, BaseFolderTreeItem |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useDropToUpload.js`
- **Test file:** `client/src/hooks/__tests__/useDropToUpload.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| options | object | N | onUploadComplete, onUploadError, path, isDisabled, hasWritePermission, onExplorerDrop |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| isDraggingOver | boolean | Dragging over |
| uploadProgress | array | Progress items |
| isDropTarget | boolean | Drop target |
| dragHandlers | object | Drag handlers |
| dropHandlers | object | Drop handlers |

### 2.4 Dependencies

- uploadFiles (fileService)
- traverseDirectory for DataTransferItem webkitGetAsEntry

### 2.5 Side Effects

- uploadFiles API on drop
- onExplorerDrop (folder mode) or internal upload
- Directory traversal (createReader, readEntries)

### 2.6 Error Handling

- onUploadError
- isDisabled, hasWritePermission: no drop

### 2.7 Verification Scenarios

- [ ] extractFiles with directory
- [ ] uploadProgress updates
- [ ] Folder mode: onExplorerDrop
- [ ] Main mode: uploadFiles, onUploadComplete

### 2.8 Edge Cases

- webkitGetAsEntry for directory
- Relative path preservation
- isDisabled, !hasWritePermission

# useFileOperations Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Unified file operation handlers: download, rename. Integrates with progress, processing map. |
| Used by components/pages | FileManager, FileContextMenu |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useFileOperations.js`
- **Test file:** `client/src/hooks/__tests__/useFileOperations.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| onProgress | function | N | Progress callback |
| onMessage | function | N | Message callback (FileContextMenu) |
| setDropMessage | function | N | Drop message setter (FileManager) |
| setProcessingMap | function | N | Processing map setter |
| onProcessingStart | function | N | Processing start |
| onProcessingEnd | function | N | Processing end |
| onActionComplete | function | N | Action complete |
| onClose | function | N | Close callback |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| handleFileDownload | (file) => Promise | Download file/folder |
| handleFileRename | (file, newName) => Promise | Rename |

### 2.4 Dependencies

- fileService (downloadFile, downloadMultipleFiles, renameFile)
- getErrorMessage, markProcessing, clearProcessing, normalizePath, applyRecentFilesAfterRename

### 2.5 Side Effects

- API calls: download, rename
- onProgress, setProcessingMap, onProcessingStart/End updates

### 2.6 Error Handling

- getErrorMessage for user display
- onProgress with status 'error' for progress UI
- **onClose only on success:** On API failure (4xx/5xx, network error), do **not** call onClose. Dialog stays open; user sees error (progress overlay or alert) and can retry or cancel. Consistent with CreateFolderDialog, LoginDialog.

### 2.7 Verification Scenarios

- [ ] handleFileDownload, handleFileRename call correct API
- [ ] Progress updates
- [ ] onClose on success
- [ ] On API failure: onClose not called; dialog stays open; error shown

### 2.8 Edge Cases

- Directory download: zip
- Skipped paths: warning status

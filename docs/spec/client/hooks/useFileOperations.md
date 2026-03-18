# useFileOperations Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Transitional single-entry operation helper for FileManager-era flows. It currently encapsulates rename and download mechanics, but in the target explorer architecture it is a lower-level helper that can be reused by `useExplorerCommands` rather than remaining the primary owner of explorer command orchestration. |
| Used by components/pages | FileManager, FileContextMenu, and target explorer command composition |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useFileOperations.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useFileOperations.test.js`

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
| handleFileDownload | (file) => Promise | Download file/folder; passes file metadata (e.g. name, path, type) to fileService.downloadFile so the service can apply platform-specific behavior (e.g. iOS + image → Web Share or inline fallback) |
| handleFileRename | (file, newName) => Promise | Rename |

### 2.4 Boundaries

- **Currently owns**
  - Download and rename execution details for the current FileManager wiring
  - Progress and processing-map integration for those operations
- **Does not own in target architecture**
  - Top-level explorer command orchestration for FileManager
  - Navigation, selection, or progress-drawer ownership
  - Product overlay policy or dialog ownership

### 2.5 Dependencies

- fileService (downloadFile with optional file-metadata options for single-file downloads, downloadMultipleFiles, renameFile)
- getErrorMessage, markProcessing, clearProcessing, normalizePath, applyRecentFilesAfterRename

### 2.6 Side Effects

- API calls: download, rename
- onProgress, setProcessingMap, onProcessingStart/End updates

### 2.7 Error Handling

- getErrorMessage for user display
- onProgress with status 'error' for progress UI
- **onClose only on success:** On API failure (4xx/5xx, network error), do **not** call onClose. Dialog stays open; user sees error (progress overlay or alert) and can retry or cancel. Consistent with CreateFolderDialog, LoginDialog.

### 2.8 Verification Scenarios

- [ ] handleFileDownload, handleFileRename call correct API
- [ ] Progress updates
- [ ] onClose on success
- [ ] On API failure: onClose not called; dialog stays open; error shown
- [ ] The hook remains reusable as a lower-level operation helper under `useExplorerCommands`

### 2.9 Edge Cases

- Directory download: zip (unchanged; no iOS/image share path).
- Skipped paths: warning status.
- Single-file download: when file metadata is passed, fileService may use iOS + image policy (Web Share or inline fallback); hook does not branch on platform—it delegates to fileService.

# useFileOperations Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Unified file operation handlers: download, rename, move, copy, delete. Integrates with progress, processing map, conflict resolution. |
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
| onConflictResolveStart | function | N | Before conflict resolve |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| handleFileDownload | (file) => Promise | Download file/folder |
| handleRename | (file, newName) => Promise | Rename |
| handleMove | (file, destPath) => Promise | Move |
| handleCopy | (file, destPath) => Promise | Copy |
| handleDelete | (file) => Promise | Delete |
| handleFileDrop | (sourcePaths, destPath) => Promise | Drop handler |
| conflictState | object | Conflict dialog state |

### 2.4 Dependencies

- fileService (downloadFile, downloadMultipleFiles, renameFile, etc.)
- getErrorMessage, markProcessing, clearProcessing, normalizePath, applyRecentFilesAfterRename

### 2.5 Side Effects

- API calls: download, rename, move, copy, delete
- onProgress, setProcessingMap, onProcessingStart/End updates

### 2.6 Error Handling

- getErrorMessage for user display
- onProgress with status 'error' for progress UI

### 2.7 Verification Scenarios

- [ ] Each handler calls correct API
- [ ] Progress updates
- [ ] Conflict handling
- [ ] onClose on success

### 2.8 Edge Cases

- Directory download: zip
- Skipped paths: warning status

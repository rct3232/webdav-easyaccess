# useBulkOperations Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Bulk move, copy, delete, download. Folder picker state, conflict check, progress polling. Uses useFileOperationProgress, fileService batch APIs. |
| Used by components/pages | FileManager |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useBulkOperations.js`
- **Test file:** `client/src/hooks/__tests__/useBulkOperations.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| selectedFiles | Set | Y | Selected paths |
| files | array | Y | File list |
| onOperationComplete | function | Y | Complete callback |
| setTreeUpdateTrigger | function | Y | Tree refresh |
| setDropMessage | function | N | Drop message |
| setSelectedFiles | function | Y | Set selection |
| setSelectionMode | function | Y | Set selection mode |
| getCurrentPath | function | Y | Current path |
| options | object | N | markProcessing, clearProcessing, shareToken |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| folderPickerOpen | boolean | Folder picker open |
| folderPickerAction | 'move' \| 'copy' \| null | Action |
| handleBulkMove | () => void | Open move picker |
| handleBulkCopy | () => void | Open copy picker |
| handleBulkDelete | (retryData?, onConfirm?) => void | Delete |
| handleBulkDownload | () => Promise | Download |
| handleFolderPickerSelect | (destinationPath, retryData?) => Promise | Pick folder, triggers move/copy |
| handleRetry | (progressId) => Promise | Retry failed operation |
| handleCancelBulkOperation | (progressId) => Promise | Cancel bulk job |
| dismissFailedItems | () => void | Dismiss failed items |
| setFolderPickerOpen | function | Set folder picker open |
| setFolderPickerAction | function | Set folder picker action |
| bulkConflictData | object | Conflict data |
| resolveBulkConflict | (resolution) => Promise | Resolve conflict (overwrite/skip) |
| setBulkConflictData | function | Set conflict data |
| progressItems | array | Progress items |
| updateProgress | function | Update progress |

### 2.4 Dependencies

- fileService (batchMove, batchCopy, batchDelete, downloadMultipleFiles, checkConflicts, getBulkOperationStatus, cancelBulkOperation)
- useFileOperationProgress, recentFiles utils

### 2.5 Side Effects

- API calls for bulk ops
- Polling for batch job status (POLL_INTERVAL_MS)
- dismissFailedItems before new op

### 2.6 Error Handling

- Conflict check -> bulkConflictData
- Progress updates for error/warning

### 2.7 Verification Scenarios

- [ ] handleBulkMove, handleBulkCopy open picker
- [ ] handleBulkDelete with/without retry
- [ ] handleBulkDownload
- [ ] handleFolderPickerSelect triggers move/copy
- [ ] Conflict flow

### 2.8 Edge Cases

- retryData for retry
- Polling cleanup

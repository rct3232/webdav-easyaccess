# useBulkOperations Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Transitional bulk-operation helper for FileManager. It currently encapsulates bulk move/copy/delete/download mechanics, conflict checks, folder-picker state, and polling, but in the target architecture it serves as an internal dependency that can be wrapped by `useExplorerCommands` rather than remaining the top-level owner of explorer command orchestration. |
| Used by components/pages | FileManager (current implementation); target usage may be via `useExplorerCommands` |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useBulkOperations.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useBulkOperations.test.js`

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

### 2.4 Boundaries

- **Currently owns**
  - Bulk move/copy/delete/download execution details
  - Folder picker coordination for bulk move/copy
  - Bulk conflict-check flow and retry/cancel mechanics for existing batch jobs
- **Does not own in target architecture**
  - Top-level explorer command ownership for FileManager page shell
  - Search/sort/view session state
  - Path navigation orchestration
  - Progress drawer/list ownership as an explorer-core concern
  - Product overlay policies such as share-link restrictions

### 2.5 Dependencies

- fileService (batchMove, batchCopy, batchDelete, downloadMultipleFiles, checkConflicts, getBulkOperationStatus, cancelBulkOperation)
- useFileOperationProgress
- recentFilesRepository (`applyRecentFilesAfterBulkDelete({ filePaths, folderPaths })`, `applyRecentFilesAfterBulkMove(moves)`)

### 2.6 Side Effects

- API calls for bulk ops
- Polling for batch job status (POLL_INTERVAL_MS)
- dismissFailedItems before new op
- For bulk move success paths, recent-file synchronization may be delegated to `recentFilesRepository.applyRecentFilesAfterBulkMove(moves)` using only the subset of moves that actually succeeded.

### 2.7 Error Handling

- Conflict check -> bulkConflictData
- Progress updates for error/warning

### 2.8 Verification Scenarios

- [ ] handleBulkMove, handleBulkCopy open picker
- [ ] handleBulkDelete with/without retry
- [ ] handleBulkDownload
- [ ] handleFolderPickerSelect triggers move/copy
- [ ] Conflict flow
- [ ] When a bulk move partially succeeds, recent-file synchronization still runs for the successfully moved subset and does not depend on all items succeeding.
- [ ] The hook remains behavior-compatible while being documented as a lower-level dependency that can sit behind `useExplorerCommands`

### 2.9 Edge Cases

- retryData for retry
- Polling cleanup
- Partial success with skipped items: success-side follow-up work (including recent-file sync) must use only the succeeded items and must not invent updates for skipped items.

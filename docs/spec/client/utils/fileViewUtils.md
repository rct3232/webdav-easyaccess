# fileViewUtils Spec

## 1. Overview

| Item | Description                                                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | File list/grid view helpers: render processing icon (move/copy/delete), compute file item state (selected, disabled, processing), drop target styles. Used in FileListItem, FileGridItem. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/fileViewUtils.js`
- **Test file:** `client/src/utils/__tests__/fileViewUtils.test.js`

### 2.2 Function Signatures

| Function             | (input) => return                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| getEntryKey          | (file) => number \| string — `file.nodeId` when present, otherwise `file.path`                                                        |
| renderProcessingIcon | (processingType: 'move' \| 'copy' \| 'delete') => JSX.Element \| null                                                                 |
| getFileItemState     | (file, selectionMode, selectedFiles, processingMap) => { isSelected, isDisabled, isProcessing, processingType, isPermissionDisabled } |
| getDropTargetStyles  | (isDropTarget) => sx object \| {}                                                                                                     |

### 2.3 Dependencies

- React, `@mui/icons-material` (DriveFileMove, ContentCopy, Delete)
- File shape: { nodeId, path, type, hasReadPermission }
- processingMap: Map<nodeId, processingType>
- `getEntryKey` is the single entry-key helper for selection/processing state: nodeId when available, path fallback ONLY for entries lacking a nodeId (synthetic `/__recent__` entries, Phase 5 scope)

### 2.4 getFileItemState Logic

- isSelected = selectionMode && selectedFiles.has(getEntryKey(file))
- isPermissionDisabled = type===directory && hasReadPermission===false
- isProcessing = Boolean(processingMap.get(file.nodeId)) — processingMap is nodeId-keyed by `useFileOperations`/`useBulkOperations`
- isDisabled = isPermissionDisabled || isProcessing

### 2.5 Verification Scenarios

- [ ] getEntryKey: returns nodeId when present, path otherwise
- [ ] renderProcessingIcon: 'move'/'copy'/'delete' → correct icon; other → null
- [ ] getFileItemState: selected when in selectedFiles; disabled when no read permission (dir) or processing
- [ ] getDropTargetStyles: true → primary.main bg, white text/icons; false → {}

### 2.6 Edge Cases

- processingMap null/undefined → isProcessing false
- selectedFiles null → isSelected false

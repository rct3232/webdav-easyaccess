# fileViewUtils Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | File list/grid view helpers: render processing icon (move/copy/delete), compute file item state (selected, disabled, processing), drop target styles. Used in FileListItem, FileGridItem. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/fileViewUtils.js`
- **Test file:** `client/src/utils/__tests__/fileViewUtils.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| renderProcessingIcon | (processingType: 'move' \| 'copy' \| 'delete') => JSX.Element \| null |
| getFileItemState | (file, selectionMode, selectedFiles, processingMap) => { isSelected, isDisabled, isProcessing, processingType, isPermissionDisabled } |
| getDropTargetStyles | (isDropTarget) => sx object \| {} |

### 2.3 Dependencies

- React, `@mui/icons-material` (DriveFileMove, ContentCopy, Delete)
- File shape: { path, type, hasReadPermission }
- processingMap: Map<path, processingType>

### 2.4 getFileItemState Logic

- isSelected = selectionMode && selectedFiles.has(file.path)
- isPermissionDisabled = type===directory && hasReadPermission===false
- isProcessing = Boolean(processingMap.get(file.path))
- isDisabled = isPermissionDisabled || isProcessing

### 2.5 Verification Scenarios

- [ ] renderProcessingIcon: 'move'/'copy'/'delete' → correct icon; other → null
- [ ] getFileItemState: selected when in selectedFiles; disabled when no read permission (dir) or processing
- [ ] getDropTargetStyles: true → primary.main bg, white text/icons; false → {}

### 2.6 Edge Cases

- processingMap null/undefined → isProcessing false
- selectedFiles null → isSelected false

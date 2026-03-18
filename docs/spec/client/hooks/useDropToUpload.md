# useDropToUpload Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Drop-to-upload from OS: extract files (including directories), upload to path. Folder mode: onExplorerDrop, optional onInternalFileDrop for internal (file manager) drag. Main mode: onUploadComplete, onUploadError. |
| Used by components/pages | FileManager, BaseFolderTreeItem |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useDropToUpload.js`
- **Test file:** `client/src/hooks/__tests__/useDropToUpload.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| options | object | N | onUploadComplete, onUploadError, path, isDisabled, hasWritePermission, onExplorerDrop, onInternalFileDrop |

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
- onInternalFileDrop (folder mode): when drop is internal drag (`dataTransfer.types` includes `'text/plain'`), called with (draggedPath, targetFolderPath) instead of upload
- Directory traversal (createReader, readEntries)

### 2.5.1 Internal drag (folder mode)

When `dataTransfer.types` includes `'text/plain'`, the drag is treated as internal (e.g. from file manager). handleDragEnter and handleDragOver accept it only when the tree node has write permission (same as external drops: isDisabled or !hasWritePermission → no drop target). When accepted: preventDefault, set drop effect (e.g. `'move'`), set isDropTarget so the tree node is highlighted. handleDrop: when `dataTransfer.getData('text/plain')` is present, call `onInternalFileDrop(draggedPath, targetFolderPath)` with targetFolderPath = path (the tree node’s path). If onInternalFileDrop is not provided, internal drop is no-op (no upload). **Permission consistency:** Tree nodes with no write permission do not show as drop targets for internal (or external) drags. **No-op:** When target path is the parent of draggedPath or equals draggedPath (drop on self), do not set isDropTarget/isDraggingOver and do not call onInternalFileDrop on drop.

### 2.6 Error Handling

- onUploadError
- isDisabled, hasWritePermission: no drop

### 2.7 Verification Scenarios

- [ ] extractFiles with directory
- [ ] uploadProgress updates
- [ ] Folder mode: onExplorerDrop
- [ ] Folder mode: internal drag (text/plain): drag over shows drop target; on drop, onInternalFileDrop(draggedPath, targetFolderPath) called; no upload when onInternalFileDrop provided
- [ ] Folder mode: internal drop onto same folder or self does not call onInternalFileDrop
- [ ] Main mode: uploadFiles, onUploadComplete

### 2.8 Edge Cases

- webkitGetAsEntry for directory
- Relative path preservation
- isDisabled, !hasWritePermission

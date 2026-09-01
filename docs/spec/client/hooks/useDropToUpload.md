# useDropToUpload Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Drop-to-upload from OS: extract files (including directories), upload to target. Folder mode: onExplorerDrop, optional onInternalFileDrop for internal (file manager) drag. Main mode: onUploadComplete, onUploadError. |
| Used by components/pages | FileManager, BaseFolderTreeItem                                                                                                                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useDropToUpload.js`
- **Test file:** `client/src/hooks/__tests__/useDropToUpload.test.js`

### 2.2 Input Parameters

All references are nodeId-based — the target is identified by `nodeId` (BIGINT `file_nodes.id`), not a path string.

| Name    | Type   | Required | Description                                                                                                                        |
| ------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| options | object | N        | onUploadComplete, onUploadError, nodeId, isDisabled, hasWritePermission, onExplorerDrop, onInternalFileDrop, internalDraggedNodeId |

- `nodeId` — folder node ID (folder-tree mode); when present with `onExplorerDrop`, the hook runs in folder mode.
- `onInternalFileDrop` — internal drag/drop callback: `(draggedNodeId, targetNodeNodeId) => void`.

### 2.3 Return Value / State

Folder mode (`nodeId` + `onExplorerDrop` provided) returns:

| Key                   | Type     | Meaning                                                                  |
| --------------------- | -------- | ------------------------------------------------------------------------ |
| isDraggingOver        | boolean  | Dragging over                                                            |
| isDropTarget          | boolean  | Drop target                                                              |
| setIsDropTarget       | function | Drop-target setter                                                       |
| handleFolderDragOver  | function | Folder-mode drag over handler                                            |
| handleFolderDragEnter | function | Folder-mode drag enter handler                                           |
| handleFolderDragLeave | function | Folder-mode drag leave handler                                           |
| handleFolderDrop      | function | Folder-mode drop handler: `(e) => handleDrop(e, nodeId, onExplorerDrop)` |

Main mode returns:

| Key             | Type     | Meaning                                                                |
| --------------- | -------- | ---------------------------------------------------------------------- |
| isDraggingOver  | boolean  | Dragging over                                                          |
| uploadProgress  | array    | Progress items                                                         |
| handleDragEnter | function | Drag enter handler                                                     |
| handleDragOver  | function | Drag over handler                                                      |
| handleDragLeave | function | Drag leave handler                                                     |
| handleDrop      | function | Drop handler: `(e, targetNodeNodeId, uploadCallback) => Promise<void>` |
| reset           | function | Resets drag/upload state                                               |

### 2.4 Dependencies

- `traverseDirectory` for DataTransferItem webkitGetAsEntry (recursive directory traversal)
- No direct service imports — uploads are delegated through `onExplorerDrop` (folder mode) or the `uploadCallback` passed to `handleDrop` (main mode)

### 2.5 Side Effects

- `onExplorerDrop(filesToUpload, targetNodeNodeId, progressCallback)` (folder mode) or the `uploadCallback(filesToUpload, targetNodeNodeId, progressCallback)` provided by the caller (main mode)
- `onInternalFileDrop(draggedNodeId, targetNodeNodeId)` (folder mode): when drop is internal drag (`dataTransfer.types` includes `'text/plain'`), called with node IDs instead of upload
- Directory traversal (createReader, readEntries)

### 2.5.1 Internal drag (folder mode)

When `dataTransfer.types` includes `'text/plain'`, the drag is treated as internal (e.g. from file manager). The payload is the dragged node ID (string from `dataTransfer.getData('text/plain')`). handleDragEnter and handleDragOver accept it only when the tree node has write permission (same as external drops: isDisabled or !hasWritePermission → no drop target). When accepted: preventDefault, set drop effect (e.g. `'move'`), set isDropTarget so the tree node is highlighted. handleDrop: when `dataTransfer.getData('text/plain')` is present, call `onInternalFileDrop(Number(internalNodeId), targetNodeNodeId)` with targetNodeNodeId = the tree node's node ID. If onInternalFileDrop is not provided, internal drop is no-op (no upload). **Permission consistency:** Tree nodes with no write permission do not show as drop targets for internal (or external) drags. **No-op:** When the dropped node ID equals the target node ID (drop on self), do not set isDropTarget/isDraggingOver and do not call onInternalFileDrop on drop.

### 2.6 Error Handling

- onUploadError
- isDisabled, hasWritePermission: no drop

### 2.7 Verification Scenarios

- [ ] extractFiles with directory
- [ ] uploadProgress updates
- [ ] Folder mode: onExplorerDrop
- [ ] Folder mode: internal drag (text/plain): drag over shows drop target; on drop, onInternalFileDrop(draggedNodeId, targetNodeNodeId) called; no upload when onInternalFileDrop provided
- [ ] Folder mode: internal drop onto self (same node ID) does not call onInternalFileDrop
- [ ] Main mode: uploadCallback, onUploadComplete

### 2.8 Edge Cases

- webkitGetAsEntry for directory
- Relative path preservation
- isDisabled, !hasWritePermission

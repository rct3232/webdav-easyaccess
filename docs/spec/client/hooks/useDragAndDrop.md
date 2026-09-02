# useDragAndDrop Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Provides drag-and-drop state and handlers for moving files/folders within the file manager (list/grid/detail) and for drops from the folder tree. Handles drag start/end, drag over (drop target), and drop; supports permission-based blocking (no write on target → forbidden cursor and optional callback). Tree-origin drags: when `dataTransfer.types` includes `'text/plain'` and there is no in-view dragged file, treat as drop-from-tree; same permission rules and onDropPermissionDenied apply. |
| Used by components/pages | useFileViewCommon (FileList, FileGrid, FileDetail)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useDragAndDrop.js`
- **Test file:** `client/src/hooks/__tests__/useDragAndDrop.test.js`

### 2.2 Input Parameters

| Name                   | Type     | Required | Description                                                                                                                                                            |
| ---------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| onFileDrop             | function | N        | Callback when a file is dropped on a valid folder: `(draggedFile, targetFolder) => void`. For tree-origin drops, draggedFile is `{ nodeId }` with the dropped node ID. |
| selectionMode          | boolean  | Y        | When true, drag/drop is disabled (no handlers used)                                                                                                                    |
| theme                  | object   | N        | MUI theme for drag ghost image                                                                                                                                         |
| onDropPermissionDenied | function | N        | Callback when user drops on a folder with no write permission: `(destinationNodeId) => void`                                                                           |
| onDragStart            | function | N        | Callback when drag starts: `(nodeId) => void`. Used so the host can know the dragged node ID (e.g. to hide content-area overlay when drop would be no-op).             |
| onDragEnd              | function | N        | Callback when drag ends: `() => void`. Clears any host state tied to the drag.                                                                                         |

### 2.3 Return Value / State

| Key             | Type           | Meaning                                                 |
| --------------- | -------------- | ------------------------------------------------------- |
| draggedFile     | object \| null | Currently dragged file object                           |
| dropTarget      | number \| null | Node ID of folder currently under cursor as drop target |
| handleDragStart | function       | (e, file) => void                                       |
| handleDragEnd   | function       | () => void                                              |
| handleDragOver  | function       | (e, file) => void                                       |
| handleDragLeave | function       | () => void                                              |
| handleDrop      | function       | (e, targetFolder) => void                               |

### 2.4 Dependencies

- `setupDragGhost` from `../utils/dragGhostImage`
- No API

### 2.5 Side Effects

- Updates internal state (draggedFile, dropTarget) during drag/drop.
- Sets `e.dataTransfer.effectAllowed`, `e.dataTransfer.dropEffect`, and `e.dataTransfer.setData('text/plain', String(file.nodeId))` where applicable.

### 2.6 Error Handling

- When target folder has no write permission: `handleDragOver` sets `dropEffect = 'none'` and does not set drop target; `handleDrop` calls `onDropPermissionDenied?.(targetFolder.nodeId)`, prevents default, and does not call `onFileDrop`.

### 2.7 Verification Scenarios

- [ ] handleDragOver sets `dropEffect = 'none'` and does not set drop target when target folder has `hasWritePermission === false`.
- [ ] handleDrop calls `onDropPermissionDenied(nodeId)` and does not call `onFileDrop` when target folder has no write permission.
- [ ] When target has write permission, handleDragOver sets dropEffect to `'move'` and sets drop target; handleDrop calls `onFileDrop`.
- [ ] Tree-origin drop: when `dataTransfer` has `text/plain` and no in-view draggedFile, handleDragOver accepts folder as drop target (with write); handleDrop calls `onFileDrop({ nodeId: droppedNodeId }, targetFolder)`. Same permission rules apply (no-write target → forbidden, onDropPermissionDenied).
- [ ] When target folder is the parent of the dragged node ID (no-op move), handleDragOver does not set drop target (no highlight).
- [ ] Tree-origin no-op: when target is parent of tree node ID or tree node ID equals target, handleDragOver does not set drop target; handleDrop does not call onFileDrop.

### 2.8 Edge Cases

- selectionMode: all drag/drop effectively disabled by caller (handlers may still run; caller should not attach when selection mode).
- Missing `e.dataTransfer` in tests: code guards with `e?.dataTransfer`.
- Same node (drag file onto itself): not treated as valid drop target (existing check).
- **No-op move (target is parent of source):** When the drop target folder is the parent of the dragged node ID (moving into the folder where the item already lives), the drop target is not set—no highlight and no effective move. This avoids showing "drop here" for a no-op.
- **handleDrop no-op:** handleDrop must not call onFileDrop when the target is the parent of the dragged node ID (list or tree) or when node ID === target (drop on self).

# useFileViewCommon Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Shared logic for FileList, FileGrid, FileDetail: getFileState, handleFileCheck, getDragHandlers, getDropHandlers. Uses useDragAndDrop, getFileItemState. Drag is disabled when file has no write permission; drop on no-write folder is handled by useDragAndDrop (forbidden cursor, onDropPermissionDenied). |
| Used by components/pages | FileList, FileGrid, FileDetail |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/hooks/useFileViewCommon.js`
- **Test file:** `client/src/components/file-manager/hooks/__tests__/useFileViewCommon.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| onFileDrop | function | N | Drop callback |
| onDropPermissionDenied | function | N | Callback when drop target has no write permission: `(destinationPath) => void` |
| onDragStart | function | N | Callback when drag starts: `(path) => void`. Passed to useDragAndDrop so host can hide content-area overlay when drop would be no-op. |
| onDragEnd | function | N | Callback when drag ends: `() => void`. Clears host state tied to drag. |
| selectionMode | boolean | Y | Selection mode |
| selectedFiles | Set | Y | Selected paths |
| onFileCheck | function | N | Check callback |
| processingMap | Map | N | Processing state |
| theme | object | Y | MUI theme |
| isMobile | boolean | N | false |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| draggedFile | object | Dragged file |
| dropTarget | string | Drop target path |
| getFileState | (file) => object | File state |
| handleFileCheck | (file, checked, e) => void | Check handler |
| isSelected | (file) => boolean | Whether file is selected |
| getDragHandlers | (file, isDisabled) => object | Drag handlers (empty when file has no write permission or disabled) |
| getDropHandlers | (file, isDisabled) => object | Drop handlers |

### 2.4 Dependencies

- useDragAndDrop, getFileItemState
- No API

### 2.5 Side Effects

- useDragAndDrop side effects
- Ref sync for selectionMode, isMobile

### 2.6 Error Handling

- None

### 2.7 Verification Scenarios

- [ ] getFileState returns correct state
- [ ] handleFileCheck calls onFileCheck
- [ ] getDragHandlers returns empty when mobile/selection/disabled
- [ ] getDragHandlers returns empty when `file.hasWritePermission === false`
- [ ] getDropHandlers

### 2.8 Edge Cases

- emptyDragHandlers when disabled, or when `file.hasWritePermission === false` (use strict `=== false` so `undefined` remains draggable for backward compatibility).
- Drop on folder with no write permission: handled inside useDragAndDrop (forbidden cursor, no highlight, onDropPermissionDenied). getDropHandlers does not disable drop targets by write permission so that the UI can show forbidden cursor and run the permission-denied handler.
- emptyDropHandlers when disabled (read permission or processing only).

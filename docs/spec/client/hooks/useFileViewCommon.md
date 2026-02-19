# useFileViewCommon Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Shared logic for FileList, FileGrid, FileDetail: getFileState, handleFileCheck, getDragHandlers, getDropHandlers. Uses useDragAndDrop, getFileItemState. |
| Used by components/pages | FileList, FileGrid, FileDetail |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useFileViewCommon.js`
- **Test file:** `client/src/hooks/__tests__/useFileViewCommon.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| onFileDrop | function | N | Drop callback |
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
| getDragHandlers | (file, isDisabled) => object | Drag handlers |
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
- [ ] getDropHandlers

### 2.8 Edge Cases

- emptyDragHandlers, emptyDropHandlers when disabled

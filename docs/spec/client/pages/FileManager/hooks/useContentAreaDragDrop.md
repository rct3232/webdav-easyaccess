# useContentAreaDragDrop Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Centralizes content-area drag/drop logic for the file manager: guards (mobile, selection mode, write permission), same-parent skip, data-file-path skip, and delegation to file-area handlers (useDropToUpload) or internal move (handleInternalFileDrop). |
| Used by components/pages | FileManager |

---

## 2. Implementation Spec

### 2.1 File Path

| Scope | Source path | Test path |
|-------|-------------|-----------|
| Page-local | `client/src/pages/FileManager/hooks/useContentAreaDragDrop.js` | `client/src/pages/FileManager/hooks/__tests__/useContentAreaDragDrop.test.js` |

- **Source:** `client/src/pages/FileManager/hooks/useContentAreaDragDrop.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useContentAreaDragDrop.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| isMobile | boolean | Y | When true, all handlers no-op (no content-area drop UI) |
| selectionMode | boolean | Y | When true, all handlers no-op |
| hasWritePermission | boolean | Y | When false, all handlers no-op |
| isShareLinkMode | boolean | N | Reserved for overlay logic in caller; hook may not use |
| currentPath | string | Y | Current folder path (target for drops) |
| contentAreaDraggedPath | string \| null | Y | Path of the file being dragged (internal drag); used for same-parent skip |
| setContentAreaDraggedPath | function | Y | Setter for contentAreaDraggedPath (e.g. clear on drop) |
| setContentAreaDragType | function | Y | Setter for overlay type: `'external'` \| `'internal'` \| null |
| handleInternalFileDrop | function | Y | `(draggedPath, targetFolderPath) => void` for internal move |
| handleExplorerDrop | function | Y | Passed to file-area drop for external uploads |
| handleFileAreaDragEnter | function | Y | From useDropToUpload (file-area drag enter) |
| handleFileAreaDragOver | function | Y | From useDropToUpload (file-area drag over) |
| handleFileAreaDragLeave | function | Y | From useDropToUpload (file-area drag leave) |
| handleFileAreaDrop | function | Y | From useDropToUpload (file-area drop) |
| resetFileAreaDrag | function | N | From useDropToUpload (reset file-area drag state) |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| handleContentAreaDragEnter | function | `(e: DragEvent) => void` |
| handleContentAreaDragOver | function | `(e: DragEvent) => void` |
| handleContentAreaDragLeave | function | `(e: DragEvent) => void` |
| handleContentAreaDrop | function | `(e: DragEvent) => void` |

### 2.4 Dependencies

- `getParentPath` from `pathUtils` (import in the hook)
- No direct service calls; delegates to passed-in handlers

### 2.5 Side Effects

- **Guards:** At the start of each returned handler, if `isMobile || selectionMode || !hasWritePermission`, return without calling any delegate.
- **Drag types:** Use `e.dataTransfer?.types || []`; `isExternal = types.includes('Files')`; `isInternalTree = types.includes('text/plain')`.
- **Same-parent skip:** If `isInternalTree && contentAreaDraggedPath && getParentPath(contentAreaDraggedPath) === currentPath`, return (do not show drop zone when dragging within same folder).
- **Data-file-path skip:** If `e.target.closest('[data-file-path]')` then: in DragOver call `handleFileAreaDragLeave(e)` and return; in DragEnter return without delegating. So the dotted drop zone appears only over empty content area, not over file/folder rows.
- **DragEnter:** When external or internal and not skipped, `setContentAreaDragType(isExternal ? 'external' : 'internal')`, then `handleFileAreaDragEnter(e)`.
- **DragOver:** When external or internal and not skipped, `handleFileAreaDragOver(e)`.
- **DragLeave:** When external or internal, if `!e.currentTarget.contains(e.relatedTarget)` then `setContentAreaDragType(null)`; then `handleFileAreaDragLeave(e)`.
- **Drop:** Clear state: `setContentAreaDraggedPath(null)`, `setContentAreaDragType(null)`. If internal (`text/plain` data): `e.preventDefault()`, `e.stopPropagation()`, `resetFileAreaDrag?.()`. When internal drop: if `getParentPath(internalPath) === currentPath` (same folder), do not call handleInternalFileDrop; otherwise call `handleInternalFileDrop(internalPath, currentPath)`. If external: `handleFileAreaDrop(e, currentPath, handleExplorerDrop)`.

### 2.6 Error Handling

- No direct error state. Delegates (handleInternalFileDrop, handleFileAreaDrop) are responsible for their own errors.

### 2.7 Verification Scenarios

- [ ] When guards are true (e.g. isMobile, or selectionMode, or !hasWritePermission), handlers do not call any delegate (e.g. handleFileAreaDragEnter, handleInternalFileDrop).
- [ ] When guards are false and event has same-parent internal drag (contentAreaDraggedPath parent === currentPath), handlers do not call delegates (same-parent skip).
- [ ] When event target is inside `[data-file-path]`, DragEnter/DragOver do not show content-area drop (data-file-path skip); DragOver calls handleFileAreaDragLeave.
- [ ] When guards false and external drag: DragEnter sets type and calls handleFileAreaDragEnter; DragOver calls handleFileAreaDragOver; Drop calls handleFileAreaDrop(e, currentPath, handleExplorerDrop).
- [ ] When guards false and internal drag (text/plain): Drop calls handleInternalFileDrop(internalPath, currentPath) and resetFileAreaDrag; handleFileAreaDrop not called for internal.
- [ ] When internal drop and getParentPath(internalPath) === currentPath (same folder), handleInternalFileDrop is not called.
- [ ] Assert on observable behavior: which callbacks were called with what arguments (not implementation internals).

### 2.8 Edge Cases

- relatedTarget null or outside content area in DragLeave: use `!e.currentTarget.contains(e.relatedTarget)` to clear drag type only when actually leaving the content area.
- resetFileAreaDrag optional: call as `resetFileAreaDrag?.()` when handling internal drop.

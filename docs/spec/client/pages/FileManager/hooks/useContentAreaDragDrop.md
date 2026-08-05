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
| currentNodeId | number \| null | Y | Current folder nodeId (target for drops) |
| contentAreaDraggedNodeId | number \| null | Y | NodeId of the file being dragged (internal drag); used for same-parent skip |
| setContentAreaDraggedNodeId | function | Y | Setter for contentAreaDraggedNodeId (e.g. clear on drop) |
| setContentAreaDragType | function | Y | Setter for overlay type: `'external'` \| `'internal'` \| null |
| handleInternalFileDrop | function | Y | `(draggedNodeId, targetNodeId) => void` for internal move |
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

- `parentNodeId` comparison for same-parent skip (no path parsing; pending implementation: current source imports `getParentPath` from `pathUtils`)
- No direct service calls; delegates to passed-in handlers

### 2.5 Side Effects

- **Guards:** At the start of each returned handler, if `isMobile || selectionMode || !hasWritePermission`, return without calling any delegate.
- **Drag types:** Use `e.dataTransfer?.types || []`; `isExternal = types.includes('Files')`; `isInternalTree = types.includes('text/plain')`.
- **Same-parent skip:** If `isInternalTree && contentAreaDraggedNodeId && parentNodeId(contentAreaDraggedNodeId) === currentNodeId`, return (do not show drop zone when dragging within same folder).
- **Data-file-path skip:** If `e.target.closest('[data-file-path]')` then: in DragOver call `handleFileAreaDragLeave(e)` and return; in DragEnter return without delegating. So the dotted drop zone appears only over empty content area, not over file/folder rows.
- **Attachment scope (caller):** The caller should attach these handlers to the **file view content area container** (list/grid/detail region). Do not attach to page-level wrappers that include breadcrumb or toolbar, otherwise the dotted overlay would cover non-file UI.
- **DragEnter:** When external or internal and not skipped, `setContentAreaDragType(isExternal ? 'external' : 'internal')`, then `handleFileAreaDragEnter(e)`.
- **DragOver:** When external or internal and not skipped, `handleFileAreaDragOver(e)`.
- **DragLeave:** When external or internal, if `!e.currentTarget.contains(e.relatedTarget)` then `setContentAreaDragType(null)`; then `handleFileAreaDragLeave(e)`.
- **Drop:** Clear state: `setContentAreaDraggedNodeId(null)`, `setContentAreaDragType(null)`. If internal (`text/plain` data): `e.preventDefault()`, `e.stopPropagation()`, `resetFileAreaDrag?.()`. The `text/plain` payload is the dragged file's nodeId string; parse it as `Number(text)`. When internal drop: if the dragged node's `parentNodeId === currentNodeId` (same folder), do not call handleInternalFileDrop; otherwise call `handleInternalFileDrop(Number(text), currentNodeId)`. If external: `handleFileAreaDrop(e, currentNodeId, handleExplorerDrop)`.

> **Note (pending implementation):** The current source still keys the drag by path — `contentAreaDraggedPath` / `currentPath` — and compares `getParentPath(internalPath) === currentPath`; the nodeId end-state reads `text/plain` as the nodeId string and compares `parentNodeId`.

### 2.6 Error Handling

- No direct error state. Delegates (handleInternalFileDrop, handleFileAreaDrop) are responsible for their own errors.

### 2.7 Verification Scenarios

- [ ] When guards are true (e.g. isMobile, or selectionMode, or !hasWritePermission), handlers do not call any delegate (e.g. handleFileAreaDragEnter, handleInternalFileDrop).
- [ ] When guards are false and event has same-parent internal drag (dragged node's `parentNodeId === currentNodeId`), handlers do not call delegates (same-parent skip).
- [ ] When event target is inside `[data-file-path]`, DragEnter/DragOver do not show content-area drop (data-file-path skip); DragOver calls handleFileAreaDragLeave.
- [ ] When guards false and external drag: DragEnter sets type and calls handleFileAreaDragEnter; DragOver calls handleFileAreaDragOver; Drop calls handleFileAreaDrop(e, currentNodeId, handleExplorerDrop).
- [ ] When guards false and internal drag (`text/plain` = nodeId string): Drop calls `handleInternalFileDrop(Number(text), currentNodeId)` and resetFileAreaDrag; handleFileAreaDrop not called for internal.
- [ ] When internal drop and the dragged node's `parentNodeId === currentNodeId` (same folder), handleInternalFileDrop is not called.
- [ ] Assert on observable behavior: which callbacks were called with what arguments (not implementation internals).

### 2.8 Edge Cases

- relatedTarget null or outside content area in DragLeave: use `!e.currentTarget.contains(e.relatedTarget)` to clear drag type only when actually leaving the content area.
- resetFileAreaDrag optional: call as `resetFileAreaDrag?.()` when handling internal drop.

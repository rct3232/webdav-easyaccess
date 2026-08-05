# useSelection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Manages multi-file selection state for FileManager. Handles selection mode entry/exit, single/range/add-to-selection semantics, and auto-exit when empty. |
| Used by components/pages | FileManager, FileList, FileGrid, FileDetail, FileManagerControls |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useSelection.js`
- **Test file:** `client/src/hooks/__tests__/useSelection.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| displayedFiles | array | Y | Files currently displayed (for index lookup, range selection) |
| allFiles | array | N | If provided, select-all uses all files; otherwise uses displayedFiles |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| selectionMode | boolean | Whether selection mode is active |
| setSelectionMode | function | Set selection mode explicitly (e.g. for mobile long-press entry) |
| selectedFiles | Set | Set of selected file nodeIds (keyed by `file.nodeId`) |
| setSelectedFiles | function | Set selected files (e.g. clear after bulk op) |
| handleSelectAll | function | Select all (uses allFiles or displayedFiles) |
| handleDeselectAll | function | Clear selection |
| handleFileCheck | function | Checkbox handler: (file, checked) — add or remove `file.nodeId` from selection |
| toggleFileSelection | function | Toggle single file: (file) — add `file.nodeId` if not selected, remove if selected |
| handleFileClickSelection | function | Main click handler for desktop: (file, event, fileIndex) — handles single click (select only), Ctrl+click (add/toggle), Shift+click (range select), double click delegates to caller for open |
| lastSelectedIndex | number \| null | Index of last-selected file (anchor for range select) |
| selectRange | function | Select range from anchor to given index: (fromIndex, toIndex) |
| enterSelectionMode | function | Enter selection mode (e.g. on mobile long-press) |

### 2.4 handleFileClickSelection Semantics

- **Single click:** Enter selection mode, select only this file (clear others). Store as `lastSelectedIndex`.
- **Double click:** Do not handle selection; caller opens folder/preview.
- **Ctrl+click (metaKey):** Enter selection mode, add file to selection (or remove if already selected). Update `lastSelectedIndex`.
- **Shift+click:** Enter selection mode, range select from `lastSelectedIndex` (or 0 if none) to current file index. Update `lastSelectedIndex`.

### 2.5 Auto-Exit Behavior

- When `selectedFiles.size === 0`, selection mode automatically exits (via `useEffect` or equivalent).
- No manual toggle for selection mode; entry via `handleFileClickSelection` (desktop single click) or `enterSelectionMode` (mobile long-press).

### 2.6 Dependencies

- React (useState, useEffect)
- No external services

### 2.7 Verification Scenarios

- [ ] Initial state: selectionMode false, selectedFiles empty
- [ ] handleFileClickSelection single click: enters selection mode, selects file, clears others
- [ ] handleFileClickSelection Ctrl+click: adds/removes file, keeps others
- [ ] handleFileClickSelection Shift+click: selects range from last anchor to current
- [ ] selectRange: selects files in given index range
- [ ] Auto-exit when selectedFiles becomes empty
- [ ] enterSelectionMode + toggleFileSelection for mobile flow
- [ ] handleSelectAll / handleDeselectAll

### 2.8 Edge Cases

- lastSelectedIndex undefined → treat as 0 for Shift+click range
- displayedFiles empty → no-op for index-based operations
- Double click: return early, let caller handle open

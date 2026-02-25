# FileDetail Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Table view of files: icon, name, type/mime, size, date. Supports selection, drag-and-drop, long-press on mobile. |
| Used in | FileManager |
| Related components | useFileViewCommon, FileDetailSkeleton, formatFileSize, formatDate, getFileIcon |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileDetail.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileDetail.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| files | array | Y | - | File objects |
| onFileClick | function | Y | - | Row click handler; receives (file, event) for modifier detection |
| onMoreClick | function | Y | - | More button click handler (file); opens FileActionSheet |
| onLongPressSelect | function | Y | - | Long-press handler for mobile: enters selection mode and selects file |
| onContextMenu | function | Y | - | Context menu handler |
| onFileDrop | function | N | - | Drop handler |
| selectionMode | boolean | Y | - | Selection mode active (row shows light primary background when selected) |
| selectedFiles | Set | Y | - | Selected paths |
| processingMap | object | N | - | Processing state |
| hasWritePermission | boolean | N | - | Write permission |
| currentPath | string | Y | - | Current path |
| onPathClick | function | N | - | Path click |
| loading | boolean | N | false | Loading state |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onFileClick | Row click | (file, event) |
| onMoreClick | More button click (IconButton in row) | (file) |
| onLongPressSelect | Mobile long-press on row | (file) |
| onContextMenu | Right-click | (e, file) |

### 2.4 Dependencies

- **imports:** React, useFileViewCommon, useResponsive, formatFileSize, formatDate, getFileIcon, renderProcessingIcon, FileDetailSkeleton
- **Reference implementation:** `client/src/components/file-manager/FileDetail.js`

### 2.5 i18n Keys

- `fileManager.noFiles` – empty state
- `actions.folder` – directory type label

### 2.6 Conditional Rendering

- loading && files.length === 0: FileDetailSkeleton
- files.length === 0: empty row with noFiles
- **Selection display:** No checkbox column. When selectionMode and row is selected, use light primary background (e.g. alpha(primary.main, 0.12)).
- **Filename:** Use `pixelMiddleTruncate` for middle ellipsis (...) with `Tooltip` showing the full name when truncated. Uses `ResizeObserver` to track container width.
- Long-press (onLongPressSelect) on mobile when !selectionMode — enters selection mode and selects file. More IconButton at right end of row (last TableCell); visible when !selectionMode. Uses `onTouchStart`/`onTouchEnd` with `stopPropagation` so parent long-press does not capture touch; touch fires onMoreClick immediately (avoids click delay/loss on mobile).
- Detail view hidden on mobile (via parent)

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [x] Table with name, type, size, date columns
- [x] onFileClick, onContextMenu
- [x] Loading/empty states
- [x] Long-press invokes onLongPressSelect on mobile — enters selection mode
- [x] Drag-and-drop
- [x] More IconButton visible when !selectionMode; hidden when selectionMode; onMoreClick called with file

### 2.8 Edge Cases

- file.type === 'directory' – size shows '-', type shows folder label
- Horizontal scroll on mobile (minWidth 600)
- Processing overlay overlay on row

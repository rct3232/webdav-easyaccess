# FileGrid Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Grid view of files (cards). Supports selection, drag-and-drop, long-press context menu on mobile, infinite scroll. |
| Used in | FileManager |
| Related components | FileGridItem, FileSkeletons, useFileViewCommon, useThumbnailLazyLoad |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileGrid.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileGrid.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| files | array | Y | - | File objects |
| onFileClick | function | Y | - | Click handler |
| onContextMenu | function | Y | - | Context menu handler |
| onFileDrop | function | N | - | Drop handler |
| selectionMode | boolean | Y | - | Show checkboxes |
| selectedFiles | Set | Y | - | Selected paths |
| onFileCheck | function | Y | - | Checkbox handler |
| processingMap | object | N | - | Processing state map |
| hasWritePermission | boolean | N | - | Write permission |
| currentPath | string | Y | - | Current path |
| onPathClick | function | N | - | Path click |
| loading | boolean | N | false | Loading state |
| onThumbnailsLoaded | function | N | - | Thumbnail callback |
| loadMoreRef | ref | N | - | Infinite scroll ref |
| hasMore | boolean | N | - | More items flag |
| shareToken | string | N | - | Share token |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onFileClick | Card click | (file) |
| onContextMenu | Right-click or long-press | (e, file) |
| onFileCheck | Checkbox toggle | (file, checked, e) |

### 2.4 Dependencies

- **imports:** React, useFileViewCommon, useResponsive, useThumbnailLazyLoad, FileGridSkeleton, FileGridItem
- **Reference implementation:** `client/src/components/file-manager/FileGrid.js`

### 2.5 i18n Keys

- `fileManager.noFiles` – empty state

### 2.6 Conditional Rendering

- loading && files.length === 0: FileGridSkeleton
- files.length === 0: empty message
- Long-press on mobile when !selectionMode
- Grid item sizing: xs=6, sm=4, md=3, lg=2, xl=2

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders FileGridItem for each file
- [ ] onFileClick, onContextMenu, onFileCheck work
- [ ] Loading/empty states
- [ ] Long-press on mobile
- [ ] Drag-and-drop
- [ ] loadMoreRef when hasMore

### 2.8 Edge Cases

- Same as FileList for disabled, permission, touch handling

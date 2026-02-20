# FileList Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | List view of files in a responsive grid. Supports selection, drag-and-drop, long-press context menu on mobile, infinite scroll. |
| Used in | FileManager |
| Related components | FileListItem, FileSkeletons, useFileViewCommon, useThumbnailLazyLoad |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileList.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileList.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| files | array | Y | - | File objects to display |
| onFileClick | function | Y | - | Click handler for file |
| onContextMenu | function | Y | - | Context menu handler (e, file) |
| onFileDrop | function | N | - | Drop handler for drag-and-drop |
| selectionMode | boolean | Y | - | Whether selection mode active |
| selectedFiles | Set | Y | - | Selected file paths |
| onFileCheck | function | Y | - | Checkbox change handler |
| processingMap | object | N | - | Map of path -> processing state |
| currentPath | string | Y | - | Current folder path |
| onPathClick | function | N | - | Path click handler |
| loading | boolean | N | false | Shows skeleton when true and files empty |
| onThumbnailsLoaded | function | N | - | Callback when thumbnails loaded |
| loadMoreRef | ref | N | - | Ref for infinite scroll sentinel |
| hasMore | boolean | N | - | Whether more items to load |
| shareToken | string | N | - | Share token for thumbnail URLs |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onFileClick | File row click | (file) |
| onContextMenu | Right-click or long-press | (e, file) |
| onFileDrop | File dropped on target | via useFileViewCommon |
| onFileCheck | Checkbox toggle | (file, checked, e) |

### 2.4 Dependencies

- **imports:** React, useTranslation, useFileViewCommon, useResponsive, useThumbnailLazyLoad, FileListSkeleton, FileListItem
- **Reference implementation:** `client/src/components/file-manager/FileList.js`

### 2.5 i18n Keys

- `fileManager.noFiles` – empty state message

### 2.6 Conditional Rendering

- loading && files.length === 0: FileListSkeleton
- files.length === 0: empty message box
- Long-press handlers only on mobile and when !selectionMode
- loadMoreRef/Box rendered when hasMore for infinite scroll

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders FileListItem for each file
- [ ] onFileClick called when file row clicked (and not disabled)
- [ ] onContextMenu called on right-click
- [ ] Long-press opens context menu on mobile (500ms)
- [ ] Checkbox and onFileCheck when selectionMode
- [ ] Loading shows FileListSkeleton
- [ ] Empty files shows noFiles message
- [ ] Drag-and-drop via useFileViewCommon
- [ ] loadMoreRef present when hasMore

### 2.8 Edge Cases

- isDisabled files – no onClick, reduced opacity
- isPermissionDisabled && !isProcessing – allowContextMenu for read-only items
- Touch move cancels long-press
- Timers cleared on unmount

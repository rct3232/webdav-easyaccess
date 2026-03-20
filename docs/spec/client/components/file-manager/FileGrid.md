# FileGrid Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Grid view of files (cards). Supports selection, drag-and-drop, long-press selection entry on mobile, infinite scroll. |
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
| onFileClick | function | Y | - | Click handler; receives (file, event) for modifier detection |
| onMoreClick | function | Y | - | More button click handler (file); opens FileActionSheet |
| onLongPressSelect | function | Y | - | Long-press handler for mobile: enters selection mode and selects file |
| onContextMenu | function | Y | - | Context menu handler |
| onFileDrop | function | N | - | Drop handler |
| selectionMode | boolean | Y | - | Selection mode active; no checkboxes; selection indicated by card background highlight (see FileGridItem). |
| selectedFiles | Set | Y | - | Selected paths |
| onFileCheck | function | Y | - | Selection toggle handler (e.g. called when card is clicked in selection mode); no checkbox UI. |
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
| onFileClick | Card click | (file, event) |
| onMoreClick | More button click | (file) |
| onLongPressSelect | Mobile long-press on file | (file) |
| onContextMenu | Right-click | (e, file) |
| onFileCheck | Selection toggle (card click in selection mode) | (file, checked, e) |

### 2.4 Dependencies

- **imports:** React, Box, useFileViewCommon, useResponsive, useThumbnailLazyLoad, FileGridSkeleton, FileGridItem
- **Layout:** CSS Grid via Box `sx` (no MUI Grid)
- **Reference implementation:** `client/src/components/file-manager/FileGrid.js`

### 2.5 i18n Keys

- `fileManager.noFiles` – empty state

### 2.6 Layout (CSS Grid)

Uses CSS Grid (breakpoint-based `repeat(N, 1fr)`), not MUI Grid:

- **Container:** `Box` with `display: 'grid'`, `gridTemplateColumns` (responsive), `gap`.
- **Breakpoints:** `xs: repeat(2, 1fr)`, `sm: repeat(3, 1fr)`, `md: repeat(4, 1fr)`, `lg: repeat(6, 1fr)`, `xl: repeat(6, 1fr)` — fixed column count per breakpoint; item width = container width / N (filename-independent).
- **Grid item:** `minWidth: 0` so content does not expand beyond column; ellipsis on long filenames.
- **Gap:** `1.5` on mobile, `2` on PC (aligned with `isMobile`).
- **loadMore area:** `gridColumn: '1 / -1'` to span full width.

### 2.7 Conditional Rendering

- loading && files.length === 0: FileGridSkeleton
- files.length === 0: empty message
- Long-press (onLongPressSelect) on mobile when !selectionMode — enters selection mode and selects file. onMoreClick and showMoreButton (!selectionMode) passed to FileGridItem.
- E2E selector contract:
  - each rendered card container keeps the stable `data-file-path` attribute so end-to-end tests can target a specific file/folder across view modes
  - no per-card `data-testid` is required when `data-file-path` is present

### 2.8 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders FileGridItem for each file
- [ ] onFileClick, onContextMenu, onFileCheck work
- [ ] Loading/empty states
- [ ] Long-press invokes onLongPressSelect on mobile — enters selection mode
- [ ] Drag-and-drop
- [ ] loadMoreRef when hasMore
- [ ] Selection mode does not require checkbox role UI; selection is card-interaction based

### 2.9 Edge Cases

- Same as FileList for disabled, permission, touch handling

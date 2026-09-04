# FileList Spec

## 1. Overview

| Item               | Description                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Role               | List view of files in a responsive grid. Supports selection, drag-and-drop, long-press selection entry on mobile, infinite scroll. |
| Used in            | FileManager                                                                                                                        |
| Related components | FileListItem, FileSkeletons, useFileViewCommon, useThumbnailLazyLoad                                                               |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileList.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileList.test.js`

### 2.2 Props

| Name               | Type     | Required | Default | Description                                                                                    |
| ------------------ | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------- |
| files              | array    | Y        | -       | File objects to display                                                                        |
| onFileClick        | function | Y        | -       | Click handler for file; receives (file, event) for modifier detection                          |
| onMoreClick        | function | Y        | -       | More button click handler (file); opens FileActionSheet                                        |
| onLongPressSelect  | function | Y        | -       | Long-press handler for mobile: enters selection mode and selects file                          |
| onContextMenu      | function | Y        | -       | Context menu handler (e, file)                                                                 |
| onFileDrop         | function | N        | -       | Drop handler for drag-and-drop                                                                 |
| selectionMode      | boolean  | Y        | -       | Whether selection mode active                                                                  |
| selectedFiles      | Set      | Y        | -       | Selected file paths                                                                            |
| onFileCheck        | function | Y        | -       | Selection toggle handler (used by row interactions in selection mode; no checkbox UI required) |
| processingMap      | object   | N        | -       | Map of path -> processing state                                                                |
| loading            | boolean  | N        | false   | Shows skeleton when true and files empty                                                       |
| onThumbnailsLoaded | function | N        | -       | Callback when thumbnails loaded                                                                |
| loadMoreRef        | ref      | N        | -       | Ref for infinite scroll sentinel                                                               |
| hasMore            | boolean  | N        | -       | Whether more items to load                                                                     |
| shareToken         | string   | N        | -       | Share token for thumbnail URLs                                                                 |

### 2.3 Callback Signatures

| Callback          | When invoked                       | Arguments             |
| ----------------- | ---------------------------------- | --------------------- |
| onFileClick       | File row click                     | (file, event)         |
| onMoreClick       | More button click                  | (file)                |
| onLongPressSelect | Mobile long-press on file          | (file)                |
| onContextMenu     | Right-click                        | (e, file)             |
| onFileDrop        | File dropped on target             | via useFileViewCommon |
| onFileCheck       | Selection toggle in selection mode | (file, checked, e)    |

### 2.4 Dependencies

- **imports:** React, useTranslation, useFileViewCommon, useResponsive, useThumbnailLazyLoad, FileListSkeleton, FileListItem
- **Reference implementation:** `client/src/components/file-manager/FileList.js`

### 2.5 i18n Keys

- `fileManager.noFiles` – empty state message

### 2.6 Conditional Rendering

- loading && files.length === 0: FileListSkeleton
- files.length === 0: empty message box
- Long-press (onLongPressSelect) only on mobile when !selectionMode — enters selection mode and selects file; does not open context menu
- loadMoreRef/Box rendered when hasMore for infinite scroll
- E2E selector contract:
  - each rendered item container keeps the stable `data-file-path` attribute so end-to-end tests can target a specific file/folder without depending on localized visible text
  - no per-row `data-testid` is required when `data-file-path` is present

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders FileListItem for each file
- [ ] onFileClick called when file row clicked (and not disabled)
- [ ] onContextMenu called on right-click
- [ ] Long-press invokes onLongPressSelect on mobile (500ms) — enters selection mode
- [ ] Selection mode toggles via row interactions and calls `onFileCheck` appropriately
- [ ] No checkbox role is required in selection mode
- [ ] Loading shows FileListSkeleton
- [ ] Empty files shows noFiles message
- [ ] Drag-and-drop via useFileViewCommon
- [ ] loadMoreRef present when hasMore

### 2.8 Edge Cases

- isDisabled files – no onClick, reduced opacity
- isPermissionDisabled && !isProcessing – allowContextMenu for read-only items
- Touch move cancels long-press. onMoreClick passed to FileListItem; More button visible when !selectionMode.
- Timers cleared on unmount

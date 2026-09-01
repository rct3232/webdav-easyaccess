# FileOperationProgress Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | File operation progress: shrink state (icon + primary/secondary in AppBar) opens right-side Drawer; expanded state (Drawer open) shows per-item list with progress, retry, close. Auto-collapse list on new operations. On error/warning, expand that item only when drawer is opened (no auto-open). Show toast notification for error/warning messages (once per item). |
| Used in            | FileManager                                                                                                                                                                                                                                                                                                                                                               |
| Related components | ProgressSummary, FileManagerHeader (slot #file-progress-slot), useResponsive, getServerErrorDisplay                                                                                                                                                                                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileOperationProgress/FileOperationProgress.js`
- **Entry point:** `client/src/components/file-manager/FileOperationProgress/index.js`
- **Test file:** `client/src/components/file-manager/FileOperationProgress/__tests__/FileOperationProgress.test.js`

### 2.2 Props

| Name          | Type     | Required | Default | Description                                                           |
| ------------- | -------- | -------- | ------- | --------------------------------------------------------------------- |
| items         | array    | Y        | -       | Progress items (id, type, status, progress, total, name, error, etc.) |
| drawerOpen    | boolean  | Y        | -       | Whether the right-side Drawer is open                                 |
| onDrawerOpen  | function | N        | -       | Called to open the Drawer (e.g. shrink chip click)                    |
| onDrawerClose | function | N        | -       | Called to close the Drawer (X button)                                 |
| onClose       | function | N        | -       | Dismiss handler (item.id)                                             |
| onRetry       | function | N        | -       | Retry handler (item.id)                                               |
| onCancelFile  | function | N        | -       | Cancel single file (itemId, fileName)                                 |
| onCancelAll   | function | N        | -       | Cancel operation (itemId)                                             |
| showError     | function | N        | -       | Toast error message (text)                                            |
| showWarning   | function | N        | -       | Toast warning message (text)                                          |

### 2.3 Callback Signatures

| Callback      | When invoked                    | Arguments          |
| ------------- | ------------------------------- | ------------------ |
| onDrawerOpen  | Shrink chip (in AppBar) clicked | none               |
| onDrawerClose | Drawer X close button clicked   | none               |
| onClose       | Confirm/dismiss button          | (itemId)           |
| onRetry       | Retry button (error items)      | (itemId)           |
| onCancelFile  | Cancel single upload file       | (itemId, fileName) |
| onCancelAll   | Cancel operation link           | (itemId)           |

### 2.4 Dependencies

- **imports:** React, createPortal (react-dom), useTranslation, MUI Drawer/Box/Paper/Typography/LinearProgress/IconButton/Collapse/CircularProgress/Button/List/ListItem/ListItemText, ProgressSummary, getServerErrorDisplay, styles
- **Reference implementation:** `client/src/components/file-manager/FileOperationProgress/FileOperationProgress.js`

### 2.5 i18n Keys

- `fileManager.progressTitle`, `fileManager.statusPreparing`, `fileManager.statusProcessing`, `fileManager.statusCompleted`, `fileManager.statusExcluded`, `fileManager.statusFail`, `fileManager.statusPartialFail`, `fileManager.statusWorking`, `fileManager.statusConflictCheck`, `fileManager.statusDeleting`, `fileManager.statusCopying`, `fileManager.statusMoving`, `fileManager.statusUploading`, `fileManager.statusDownloading`, `fileManager.statusRenaming`, `fileManager.statusCreatingFolder`, `fileManager.statusUploadPreparing`, `fileManager.statusRetryPreparing`, `fileManager.cancelOperation`, `fileManager.bulkSkippedCount`, `fileManager.bulkExcludedByPermission`, `fileManager.bulkExcludedTruncated`, `fileManager.failedItemsLabel`, `fileManager.retry`, `fileManager.errorWithMessage`, `fileManager.workingFallback`, `common.confirm`, `common.close`, `common.collapse`, `common.expand`, `common.unknownError`, `common.noItems`

### 2.6 Conditional Rendering

- Returns null when !items or items.length === 0
- Shrink: chip rendered via createPortal into #file-progress-slot when !drawerOpen
- Drawer: MUI Drawer anchor="right" when drawerOpen; header has X (close) and title only
- expandedItemIndex (number | null): which item is expanded; null = all collapsed
- Collapsed view: each item shows header + "펼치기" button (full width, narrow); body hidden
- Expanded view: single item fills drawer (header + body); "접기" button at bottom
- New preparing/processing items: setExpandedItemIndex(null)
- Error/warning: set expandedItemIndex to error item (no auto-open drawer); call showError/showWarning with message once per item
- Retry button only when item.status === 'error' && item.failedItems?.length && onRetry
- Cancel link only when cancellable operations (upload, move, copy, delete)

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Shrink: chip in AppBar slot with primary/secondary labels; click opens Drawer (onDrawerOpen)
- [ ] Collapsed: all headers visible; each has "펼치기" button; 펼치기 opens that item
- [ ] Expanded: single item (header + body); "접기" at bottom; 접기 returns to collapsed
- [ ] onClose, onRetry, onCancelFile, onCancelAll invoked correctly
- [ ] Auto-collapse on new items; on error/warning expand that item when drawer is opened (no auto-open)
- [ ] Upload fileItems list with per-file cancel
- [ ] Skipped/excluded lists, failed items list

### 2.8 Edge Cases

- item.percentage vs progress/total
- getServerErrorDisplay for errorCode
- Skipped by conflict vs by permission (legacy skippedPaths)
- Drawer width: full on mobile, 400px on desktop

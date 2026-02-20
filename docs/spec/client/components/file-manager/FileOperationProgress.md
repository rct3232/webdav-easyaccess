# FileOperationProgress Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Fixed overlay for file operation progress: minimized (summary) and expanded (per-item list with progress, retry, close). Auto-collapse on new operations, expand on error/warning. |
| Used in | FileManager |
| Related components | ProgressSummary, useResponsive, getServerErrorDisplay |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileOperationProgress.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileOperationProgress.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| items | array | Y | - | Progress items (id, type, status, progress, total, name, error, etc.) |
| onClose | function | N | - | Dismiss handler (item.id) |
| onRetry | function | N | - | Retry handler (item.id) |
| onCancelFile | function | N | - | Cancel single file (itemId, fileName) |
| onCancelAll | function | N | - | Cancel operation (itemId) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Confirm/dismiss button | (itemId) |
| onRetry | Retry button (error items) | (itemId) |
| onCancelFile | Cancel single upload file | (itemId, fileName) |
| onCancelAll | Cancel operation link | (itemId) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Box/Paper/Typography/LinearProgress/IconButton/Collapse/CircularProgress/Button/List/ListItem/ListItemText, ProgressSummary, getServerErrorDisplay, styles
- **Reference implementation:** `client/src/components/file-manager/FileOperationProgress.js`

### 2.5 i18n Keys

- `fileManager.progressTitle`, `fileManager.statusPreparing`, `fileManager.statusProcessing`, `fileManager.statusCompleted`, `fileManager.statusExcluded`, `fileManager.statusFail`, `fileManager.statusPartialFail`, `fileManager.statusWorking`, `fileManager.statusConflictCheck`, `fileManager.statusDeleting`, `fileManager.statusCopying`, `fileManager.statusMoving`, `fileManager.statusUploading`, `fileManager.statusDownloading`, `fileManager.statusRenaming`, `fileManager.statusCreatingFolder`, `fileManager.statusUploadPreparing`, `fileManager.statusRetryPreparing`, `fileManager.cancelOperation`, `fileManager.bulkSkippedCount`, `fileManager.bulkExcludedByPermission`, `fileManager.bulkExcludedTruncated`, `fileManager.failedItemsLabel`, `fileManager.retry`, `fileManager.errorWithMessage`, `fileManager.workingFallback`, `common.confirm`, `common.unknownError`, `common.noItems`

### 2.6 Conditional Rendering

- Returns null when !items or items.length === 0
- Expanded vs minimized by expanded state
- New preparing/processing items: auto-collapse
- Error/warning: auto-expand
- Retry button only when item.status === 'error' && item.failedItems?.length && onRetry
- Cancel link only when cancellable operations (upload, move, copy, delete)

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Minimized: ProgressSummary with primary/secondary labels, expand on click
- [ ] Expanded: list of items with progress, status, retry/close
- [ ] onClose, onRetry, onCancelFile, onCancelAll invoked correctly
- [ ] Auto-collapse on new items, auto-expand on error
- [ ] Upload fileItems list with per-file cancel
- [ ] Skipped/excluded lists, failed items list

### 2.8 Edge Cases

- item.percentage vs progress/total
- getServerErrorDisplay for errorCode
- Skipped by conflict vs by permission (legacy skippedPaths)
- Mobile vs desktop layout (position, width)

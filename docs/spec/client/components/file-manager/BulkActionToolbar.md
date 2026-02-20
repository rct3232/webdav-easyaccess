# BulkActionToolbar Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Toolbar for bulk actions on selected files: move, copy, download, delete. Fixed at bottom (desktop: centered; mobile: full width). |
| Used in | FileManager |
| Related components | MUI Paper, IconButton, Typography, Box |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/BulkActionToolbar.js`
- **Test file:** `client/src/components/file-manager/__tests__/BulkActionToolbar.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| isMobile | boolean | Y | - | Mobile layout flag |
| selectedFiles | Set\<string\> | Y | - | Set of selected file paths |
| handleBulkMove | function | Y | - | Move button handler |
| handleBulkCopy | function | Y | - | Copy button handler |
| handleBulkDownload | function | Y | - | Download button handler |
| openBulkDeleteDialog | function | Y | - | Delete button handler; receives filePaths array |
| hasWritePermission | boolean | Y | - | Whether write actions allowed |
| hasReadOnlyInSelection | boolean | N | false | Show read-only warning when some selected are read-only |
| disabled | boolean | N | false | Disable all bulk actions |
| downloadOnly | boolean | N | false | Hide move, copy, delete; show only download |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| handleBulkMove | Move icon click | - |
| handleBulkCopy | Copy icon click | - |
| handleBulkDownload | Download icon click | - |
| openBulkDeleteDialog | Delete icon click | (filePaths: string[]) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Paper/Typography/IconButton/Box, Move/Copy/Download/Delete icons
- **Reference implementation:** `client/src/components/file-manager/BulkActionToolbar.js`

### 2.5 i18n Keys

- `fileManager.readOnlyInSelection` – warning when hasReadOnlyInSelection
- `actions.move`, `actions.copy`, `actions.download`, `actions.delete` – button titles

### 2.6 Conditional Rendering

- downloadOnly: move, copy, delete buttons hidden
- hasReadOnlyInSelection: caption with read-only message
- move/delete disabled when !hasWritePermission or disabled
- copy/download disabled when disabled (destination permission checked separately for copy)
- openBulkDeleteDialog called with Array.from(selectedFiles) only when length > 0

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Each button click invokes corresponding callback
- [ ] Move/copy/delete disabled when hasWritePermission false
- [ ] All buttons disabled when disabled prop true
- [ ] downloadOnly hides move, copy, delete
- [ ] hasReadOnlyInSelection shows read-only caption
- [ ] openBulkDeleteDialog receives array, not called when selectedFiles empty
- [ ] isMobile affects layout (position, size)

### 2.8 Edge Cases

- selectedFiles.size === 0 – toolbar may still render; delete checks length before calling
- hasReadOnlyInSelection – message displayed; move/delete still disabled by hasWritePermission
- Safe area inset on mobile (paddingBottom)

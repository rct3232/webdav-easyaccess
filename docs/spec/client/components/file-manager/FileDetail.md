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
- **Test file:** `client/src/components/__tests__/FileDetail.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| files | array | Y | - | File objects |
| onFileClick | function | Y | - | Row click handler |
| onContextMenu | function | Y | - | Context menu handler |
| onFileDrop | function | N | - | Drop handler |
| selectionMode | boolean | Y | - | Show checkbox column |
| selectedFiles | Set | Y | - | Selected paths |
| onFileCheck | function | Y | - | Checkbox handler |
| processingMap | object | N | - | Processing state |
| hasWritePermission | boolean | N | - | Write permission |
| currentPath | string | Y | - | Current path |
| onPathClick | function | N | - | Path click |
| loading | boolean | N | false | Loading state |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onFileClick | Row click | (file) |
| onContextMenu | Right-click or long-press | (e, file) |
| onFileCheck | Checkbox change | (file, checked, e) |

### 2.4 Dependencies

- **imports:** React, useFileViewCommon, useResponsive, formatFileSize, formatDate, getFileIcon, renderProcessingIcon, FileDetailSkeleton
- **Reference implementation:** `client/src/components/file-manager/FileDetail.js`

### 2.5 i18n Keys

- `fileManager.noFiles` – empty state
- `actions.folder` – directory type label

### 2.6 Conditional Rendering

- loading && files.length === 0: FileDetailSkeleton
- files.length === 0: empty row with noFiles
- Long-press on mobile when !selectionMode
- Detail view hidden on mobile (via parent)

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Table with name, type, size, date columns
- [ ] onFileClick, onContextMenu, onFileCheck
- [ ] Loading/empty states
- [ ] Long-press on mobile
- [ ] Drag-and-drop

### 2.8 Edge Cases

- file.type === 'directory' – size shows '-', type shows folder label
- Horizontal scroll on mobile (minWidth 600)
- Processing overlay overlay on row

# FileListItem Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Single row item in list view: checkbox, thumbnail/icon, filename, metadata (size/date). Shows processing overlay. React.memo optimized. |
| Used in | FileList |
| Related components | formatFileSize, formatDate, getFileIcon, getThumbnail, renderProcessingIcon |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileListItem.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileListItem.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| file | object | Y | - | File object (path, basename, size, lastmod, type, thumbnailUrl, isHidden) |
| isSelected | boolean | Y | - | Checkbox checked state |
| isDisabled | boolean | Y | - | Disabled appearance |
| isProcessing | boolean | Y | - | Show processing overlay |
| processingType | string | N | - | Type for renderProcessingIcon |
| isDropTarget | boolean | Y | - | Drop target highlight |
| isDragging | boolean | Y | - | Dragging state (handled by parent) |
| selectionMode | boolean | Y | - | Show checkbox |
| isMobile | boolean | Y | - | Mobile styles |
| onCheck | function | Y | - | Checkbox change handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onCheck | Checkbox change | (file, checked, e) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Typography/Box/Checkbox/Avatar/CircularProgress, formatFileSize, formatDate, renderProcessingIcon, getDropTargetStyles, getFileIcon, getThumbnail
- **Reference implementation:** `client/src/components/file-manager/FileListItem.js`

### 2.5 i18n Keys

- `actions.folder` – label for directory type

### 2.6 Conditional Rendering

- Checkbox only when selectionMode
- Thumbnail or icon based on getThumbnail(file)
- Processing overlay (CircularProgress + icon) when isProcessing
- Metadata: folder label or formatFileSize, formatDate(lastmod)

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders basename, size/date or folder label
- [ ] Checkbox shown when selectionMode
- [ ] onCheck called with (file, checked, e)
- [ ] Thumbnail or icon displayed
- [ ] Processing overlay when isProcessing
- [ ] React.memo prevents re-render when props unchanged

### 2.8 Edge Cases

- file.type === 'directory' – shows folder label instead of size
- Hidden files – opacity handled by parent container
- getFileListItemContainerStyles exported for container styling

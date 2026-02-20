# FileGridItem Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Card-style grid item: checkbox, thumbnail/icon, filename. Processing overlay. React.memo optimized. |
| Used in | FileGrid |
| Related components | getFileIconForGrid, getThumbnail, renderProcessingIcon |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileGridItem.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileGridItem.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| file | object | Y | - | File object |
| isSelected | boolean | Y | - | Selected state |
| isDisabled | boolean | Y | - | Disabled |
| isProcessing | boolean | Y | - | Processing overlay |
| processingType | string | N | - | Processing type |
| isDropTarget | boolean | Y | - | Drop target highlight |
| isDragging | boolean | Y | - | Dragging |
| selectionMode | boolean | Y | - | Show checkbox |
| isMobile | boolean | Y | - | Mobile styles |
| onCheck | function | Y | - | Checkbox handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onCheck | Checkbox change | (file, checked, e) |

### 2.4 Dependencies

- **imports:** React, MUI Card/CardMedia/CardContent/Typography/Box/Checkbox/CircularProgress, renderProcessingIcon, getFileIconForGrid, getThumbnail
- **Reference implementation:** `client/src/components/file-manager/FileGridItem.js`

### 2.5 i18n Keys

- None

### 2.6 Conditional Rendering

- Checkbox when selectionMode
- Thumbnail or getFileIconForGrid
- Processing overlay when isProcessing
- Border/background for isSelected, isDropTarget

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders basename, thumbnail/icon
- [ ] Checkbox when selectionMode
- [ ] onCheck invocation
- [ ] Selected/drop target styles
- [ ] Processing overlay
- [ ] React.memo optimization

### 2.8 Edge Cases

- isHidden – reduced opacity
- Mobile touch styles

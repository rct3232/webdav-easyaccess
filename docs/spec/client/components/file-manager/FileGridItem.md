# FileGridItem Spec

## 1. Overview

| Item               | Description                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Card-style grid item: thumbnail/icon, filename, More button. Selection indicated by light primary background. Processing overlay. React.memo optimized. |
| Used in            | FileGrid                                                                                                                                                |
| Related components | getFileIconForGrid, getThumbnail, renderProcessingIcon                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileGridItem.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileGridItem.test.js`

### 2.2 Props

| Name           | Type     | Required | Default | Description                                                                                                  |
| -------------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| file           | object   | Y        | -       | File object                                                                                                  |
| isSelected     | boolean  | Y        | -       | Selected state                                                                                               |
| isDisabled     | boolean  | Y        | -       | Disabled                                                                                                     |
| isProcessing   | boolean  | Y        | -       | Processing overlay                                                                                           |
| processingType | string   | N        | -       | Processing type                                                                                              |
| isDropTarget   | boolean  | Y        | -       | Drop target highlight                                                                                        |
| isDragging     | boolean  | Y        | -       | Dragging                                                                                                     |
| selectionMode  | boolean  | Y        | -       | Selection mode active (affects card styling when isSelected)                                                 |
| showMoreButton | boolean  | Y        | -       | Show More (⋮) button; false when in selection mode                                                           |
| onMoreClick    | function | Y        | -       | More button click handler; opens FileActionSheet; call stopPropagation so card tap does not toggle selection |
| isMobile       | boolean  | Y        | -       | Mobile styles                                                                                                |

### 2.3 Callback Signatures

| Callback    | When invoked      | Arguments                                           |
| ----------- | ----------------- | --------------------------------------------------- |
| onMoreClick | More button click | (file) — must stopPropagation to prevent card click |

### 2.4 Dependencies

- **imports:** React, MUI Card/CardMedia/CardContent/Typography/Box/CircularProgress, renderProcessingIcon, getFileIconForGrid, getThumbnail
- **Reference implementation:** `client/src/components/file-manager/FileGridItem.js`

### 2.5 i18n Keys

- None

### 2.6 Layout and Conditional Rendering

- **More button placement:** Top-right of preview (thumbnail/icon) area, overlaid with `position: absolute`, `top`, `right`, and `z-index` so the icon is not pushed. Hidden when `!showMoreButton` (i.e. when in selection mode). IconButton with ⋮ icon; onMoreClick must call `event.stopPropagation()` so parent card tap does not trigger selection toggle. Uses `onTouchStart`/`onTouchEnd` with `stopPropagation` on mobile so parent long-press handler does not capture the touch and touch fires onMoreClick immediately (avoids click delay/loss on mobile).
- **Selection display:** No checkbox. When isSelected, card uses light primary background (e.g. alpha(primary.main, 0.12)) instead of border.
- Thumbnail or getFileIconForGrid
- Processing overlay when isProcessing
- Border/background for isSelected, isDropTarget
- **Filename placement:** CardContent uses flex (`display: flex`, `alignItems: center`, `justifyContent: center`) so the filename is centered horizontally and vertically within the content area. Use `pixelMiddleTruncate` for middle ellipsis (...) with `Tooltip` showing the full name when truncated. Uses `ResizeObserver` to track container width.
- **Padding:** `p: 1`, `pt: 0.5`, `pb: 1`; `'&:last-child': { pb: 1 }` overrides MUI CardContent default paddingBottom so the text area matches FileGridSkeleton.

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [x] Renders basename, thumbnail/icon
- [x] Selection indicated by light primary background when isSelected
- [x] More button shown when showMoreButton; hidden when !showMoreButton; onMoreClick called with file and stopPropagation
- [x] Selected/drop target styles
- [x] Processing overlay

### 2.8 Edge Cases

- isHidden – reduced opacity
- Mobile touch styles

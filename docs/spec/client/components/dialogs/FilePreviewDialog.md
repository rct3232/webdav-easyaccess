# FilePreviewDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Full-screen preview for images, PDFs, text, video. Supports gallery mode for multiple media. Uses getFileBlob, react-pdf. |
| Used in | FileManager (Preview from context menu) |
| Related components | PreviewThumbnailBar, getFileBlob, getFileType |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/index.js`
- **Test file:** `client/src/components/dialogs/__tests__/FilePreviewDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| file | object | Y | - | File to preview |
| mediaFiles | array | N | [] | Multiple media for gallery |
| shareToken | string | N | - | Share token |
| onThumbnailsLoaded | function | N | - | Thumbnail callback |
| hideCloseButton | boolean | N | false | Hide close button |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Close | - |
| onThumbnailsLoaded | Thumbnails ready | - |

### 2.4 Dependencies

- **imports:** getFileBlob, react-pdf, getFileType, PreviewThumbnailBar, useResponsive
- **Reference implementation:** `client/src/components/dialogs/FilePreviewDialog/index.js`

### 2.5 i18n Keys

- preview.*, common.*

### 2.6 Conditional Rendering

- Image: img with blob URL
- PDF: react-pdf Document/Page
- Video: video element
- Text: pre/code
- Gallery mode when mediaFiles.length > 1 (image/video)
- Auto-hide UI after 5s

### 2.7 Verification Scenarios

- [ ] Renders correct preview type
- [ ] Gallery navigation
- [ ] onClose
- [ ] Error/loading states

### 2.8 Edge Cases

- pdf.worker.min.js from public
- Unsupported file type
- Header filename may be very long: render a pixel-based middle truncation (via `pixelMiddleTruncate`) so it never overlaps the action buttons (download/close). Do not rely on CSS end-ellipsis for the visible text; the UI should display the `pixelMiddleTruncate` result as-is. When truncated (desktop), show the full filename via Tooltip.

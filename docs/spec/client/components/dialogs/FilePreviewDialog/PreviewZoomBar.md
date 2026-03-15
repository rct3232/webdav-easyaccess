# PreviewZoomBar Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Bottom zoom bar with zoom in/out, reset, and percentage display for PDF and image previews |
| Used in | FilePreviewDialog |
| Related components | PreviewThumbnailBar (similar bottom positioning) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/PreviewZoomBar.js`
- **Entry point:** Re-exported via FilePreviewDialog

### 2.2 Props

| Name | Type | Required | Description |
|------|------|----------|-------------|
| zoom | number | Y | Current zoom factor (e.g. 1, 1.25, 0.75) |
| onZoomIn | function | Y | Called when zoom-in button clicked |
| onZoomOut | function | Y | Called when zoom-out button clicked |
| onReset | function | Y | Called when reset (100%) button clicked |
| visible | boolean | Y | Whether bar is visible (display or opacity) |
| t | function | Y | i18n function for aria-labels/tooltips |

### 2.3 Layout and Styling

- **Position:** `position: absolute`, `bottom: 16`, `left: 50%`, `transform: translateX(-50%)`
- **Style:** Pill-shaped bar, semi-transparent background (match PreviewThumbnailBar z-index/backdrop; e.g. `zIndex: 10`)
- **Content:** Zoom out (-), percentage text (e.g. 100%), reset (100%), zoom in (+)
- **Visibility:** `visibility: visible ? 'visible' : 'hidden'` and/or `opacity`; or `display: visible ? 'flex' : 'none'`

### 2.4 i18n Keys

- `preview.zoomIn` — aria-label for zoom-in button
- `preview.zoomOut` — aria-label for zoom-out button
- `preview.zoomReset` — aria-label for reset button

### 2.5 Dependencies

- MUI: Box, IconButton (Add/Remove icons for +/-)
- i18n: `t` from useTranslation

### 2.6 Verification Scenarios

- [ ] Bar renders with zoom percentage displayed
- [ ] Zoom-in button calls onZoomIn
- [ ] Zoom-out button calls onZoomOut
- [ ] Reset button calls onReset
- [ ] Bar visibility toggles based on `visible`
- [ ] Layout does not overlap PreviewThumbnailBar (positioning coordinated by parent)

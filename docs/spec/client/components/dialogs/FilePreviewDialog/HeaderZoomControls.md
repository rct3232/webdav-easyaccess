# HeaderZoomControls Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Zoom controls for the FilePreviewDialog header (PDF/image). Desktop: full inline controls. Mobile: single compact control (icon or value); full controls appear in a floating bar when the control is tapped. |
| Used in            | FilePreviewDialog (header actions row); ZoomControlButtons also used in mobile floating bar)                                                                                                                  |
| Related components | usePreviewZoom, useZoomInputs (keyboard/pinch still handled by dialog)                                                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/HeaderZoomControls.js`
- **Entry point:** Used only by FilePreviewDialog (no re-export in index). Exports `ZoomControlButtons` for reuse in the mobile floating bar.

### 2.2 Props

| Name      | Type     | Required | Description                                                                                                     |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| zoom      | number   | Y        | Current zoom factor (e.g. 1, 1.25, 0.75)                                                                        |
| onZoomIn  | function | Y        | Called when zoom-in button clicked                                                                              |
| onZoomOut | function | Y        | Called when zoom-out button clicked                                                                             |
| onReset   | function | Y        | Called when percentage/reset control clicked                                                                    |
| t         | function | Y        | i18n function for aria-labels                                                                                   |
| isMobile  | boolean  | N        | When true, render compact single control (display-only); floating bar is shown by parent with header visibility |

### 2.3 Layout and Styling

- **Desktop (!isMobile):** Inline flex row with Zoom out IconButton, percentage/reset button, Zoom in IconButton.
- **Mobile (isMobile):** Single control in header (display-only): when zoom === 1 show ZoomIn icon; when zoom !== 1 show current value (e.g. "125%"). Style matches header (color: inherit).
- **Floating bar (mobile):** Rendered by FilePreviewDialog at top of DialogContent. Visible when header is visible (same show/hide and transition). Centered; width is content-sized (inline-flex). Uses ZoomControlButtons.

### 2.4 i18n Keys

- `preview.zoomIn` — aria-label for zoom-in button
- `preview.zoomOut` — aria-label for zoom-out button
- `preview.zoomReset` — aria-label for reset (percentage) button

### 2.5 Dependencies

- MUI: Box, IconButton; Add/Remove icons for zoom in/out
- i18n: `t` from parent (useTranslation in FilePreviewDialog)

### 2.6 Verification Scenarios

- [ ] Desktop: renders zoom out, percentage text, zoom in; all buttons work
- [ ] Mobile: when zoom === 1 shows ZoomIn icon; when zoom !== 1 shows e.g. "125%"
- [ ] Mobile: compact control is display-only; floating bar visibility follows header
- [ ] ZoomControlButtons: zoom out, percentage, zoom in; percentage displays Math.round(zoom \* 100)

### 2.7 Edge Cases

- Component is only rendered when `needsZoom` is true (PDF/image). No behavior when zoom is 0 or very large; parent clamps zoom.
- Mobile floating bar appears and disappears with the header (same visibility and transition).

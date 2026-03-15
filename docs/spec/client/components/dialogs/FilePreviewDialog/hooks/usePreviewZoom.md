# usePreviewZoom Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Manages zoom state for zoomable preview types (PDF, image); provides zoom in/out, reset, and setZoom |
| Used by components/pages | FilePreviewDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/usePreviewZoom.js`

### 2.2 Input Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| minZoom | number | N | 0.5 | Minimum zoom factor |
| maxZoom | number | N | 3 | Maximum zoom factor |
| initialZoom | number | N | 1 | Initial zoom value |
| step | number | N | 0.25 | Zoom increment for zoomIn/zoomOut |
| open | boolean | N | - | Dialog open state; reset zoom when becomes false |
| previewFileType | string | N | - | Active preview type; reset zoom when changes |
| displayFile | object | N | - | Currently displayed file; reset zoom when its path changes (e.g. gallery navigation) |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| zoom | number | Current zoom factor (clamped between minZoom and maxZoom) |
| zoomIn | function | Increase zoom by step |
| zoomOut | function | Decrease zoom by step |
| resetZoom | function | Set zoom to 1 |
| setZoom | function | Set zoom directly (will be clamped) |

### 2.4 Dependencies

- Other hooks: none
- Clamp logic: `Math.min(maxZoom, Math.max(minZoom, value))`

### 2.5 Side Effects

- Reset effect: when `open` becomes false, `previewFileType` changes, or `displayFile?.path` changes, reset zoom to 1.

### 2.6 Error Handling

- No external calls; no error state. Clamping ensures zoom stays within bounds.

### 2.7 Verification Scenarios

- [ ] Initial zoom is 1
- [ ] zoomIn increases by step; does not exceed maxZoom
- [ ] zoomOut decreases by step; does not go below minZoom
- [ ] resetZoom sets zoom to 1
- [ ] setZoom clamps to min/max bounds
- [ ] zoom resets when open becomes false, previewFileType changes, or displayFile path changes (e.g. gallery image switch)

### 2.8 Edge Cases

- Configurable step; default 0.25.
- Reset zoom when switching between preview types, closing the dialog, or switching media (e.g. gallery image A → image B).

# useHeaderTruncation Spec

## 1. Overview

| Item                     | Description                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role                     | Measures header title row and actions widths via ResizeObserver, computes pixel-based middle-truncated filename, and detects text overflow in the text preview container |
| Used by components/pages | FilePreviewDialog                                                                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/useHeaderTruncation.js`

### 2.2 Input Parameters

| Name            | Type         | Required | Description                                       |
| --------------- | ------------ | -------- | ------------------------------------------------- |
| open            | boolean      | Y        | Dialog open state; observer starts on open        |
| hideCloseButton | boolean      | Y        | Affects actions width; used as effect dependency  |
| textContent     | string\|null | Y        | Text preview content; triggers overflow detection |
| displayFile     | object       | N        | Currently displayed file                          |
| file            | object       | Y        | Original file prop                                |

### 2.3 Return Value / State

| Key                 | Type      | Meaning                                                               |
| ------------------- | --------- | --------------------------------------------------------------------- |
| titleRowRef         | React.Ref | Ref for the title row container                                       |
| actionsRef          | React.Ref | Ref for the actions (zoom when applicable, download, close) container |
| textContainerRef    | React.Ref | Ref for the text preview outer container                              |
| textPreRef          | React.Ref | Ref for the `<pre>` element inside text preview                       |
| truncatedHeaderName | string    | Pixel-truncated filename (middle truncation)                          |
| isHeaderTruncated   | boolean   | True when truncatedHeaderName !== originalHeaderName                  |

### 2.4 Dependencies

- Utilities: `pixelMiddleTruncate` from `../../../utils/stringUtils`
- Browser API: `ResizeObserver`, `window.addEventListener('resize', ...)`

### 2.5 Side Effects

- **Header ResizeObserver effect**: observes `titleRowRef` and `actionsRef`; updates `titleRowWidth` and `actionsWidth`; also attaches a window resize listener. Triggered by `open` and `hideCloseButton` changes.
- **Text overflow detection effect**: observes `textContainerRef` via ResizeObserver; compares `pre.scrollHeight > container.clientHeight`; sets `textOverflows` boolean. Triggered by `open` and `textContent` changes.

### 2.6 Error Handling

- If `ResizeObserver` is undefined (non-browser environment), header measurement effect exits early.
- If refs are not yet attached, measurements default to 0 / false.

### 2.7 Verification Scenarios

- [ ] `titleRowWidth` and `actionsWidth` updated after ResizeObserver fires
- [ ] `truncatedHeaderName` shortens long filenames to fit `maxHeaderTitleWidth`
- [ ] `isHeaderTruncated` is false when name fits
- [ ] `textOverflows` is true when `pre.scrollHeight > container.clientHeight`
- [ ] `textOverflows` resets to false when `open` or `textContent` is falsy

### 2.8 Edge Cases

- Header constants: `headerFont = '500 1.25rem Inter, ...'`, `headerSafetyPx = 24`, `headerGapPx = 8`, `headerFallbackWidthPx = 360`.
- `maxHeaderTitleWidth = titleRowWidth > 0 ? max(40, titleRowWidth - actionsWidth - safetyPx - gapPx) : fallbackPx`.
- RAF used before attaching ResizeObserver to avoid measuring before DOM settles.
- Zoom controls are inside the actions container when preview is PDF/image; no formula change. ResizeObserver picks up the larger actions width so title truncation adapts automatically.

# usePdfLayout Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Measures the PDF container dimensions via ResizeObserver, calculates optimal page render width, and manages numPages/pageInfo state for react-pdf |
| Used by components/pages | FilePreviewDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/usePdfLayout.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| open | boolean | Y | Dialog open state; measurement starts on open |
| previewUrl | string\|null | Y | PDF blob URL; used as effect dependency to re-measure after URL resolves |
| isMobile | boolean | Y | Mobile breakpoint flag; affects fallback width calculation |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| pdfContainerRef | React.Ref | Ref to attach to the scrollable PDF container |
| containerWidth | number\|null | Measured container width (minus padding) |
| containerHeight | number\|null | Measured container height (minus padding) |
| numPages | number\|null | Total page count from react-pdf `onLoadSuccess` |
| pageInfo | object\|null | `{ width, height }` from first page `onLoadSuccess` |
| calculatedWidth | number\|undefined | Computed render width for each `<Page>` |
| pageArray | number[] | `[1, 2, ..., numPages]` memoized array |
| setNumPages | function | Setter for numPages (passed to react-pdf Document) |
| setPageInfo | function | Setter for pageInfo (passed to react-pdf Page) |

### 2.4 Dependencies

- Other hooks: none
- Browser API: `ResizeObserver`, `window.addEventListener('resize', ...)`

### 2.5 Side Effects

- ResizeObserver on `pdfContainerRef`: updates `containerWidth` and `containerHeight` on container size change.
- Window resize listener: triggers same measurement.
- `stableWidthRef`: once `calculatedWidth` is computed with all inputs available, caches the value to avoid recalculation on re-renders (reset when previewUrl changes).

### 2.6 Error Handling

- No error state; if container not yet mounted, measurements default to null and fallback widths are used.

### 2.7 Verification Scenarios

- [ ] `pdfContainerRef` attached; containerWidth/Height updated on resize
- [ ] `calculatedWidth` uses fallback when containerWidth is null
- [ ] `calculatedWidth` fits page within container dimensions (min of width/height ratios)
- [ ] `pageArray` is `[1..numPages]`
- [ ] `stableWidthRef` prevents recalculation on subsequent renders

### 2.8 Edge Cases

- Container padding (32px) subtracted from measured dimensions.
- `stableWidthRef` reset to null when dialog closes or previewUrl changes.
- Mobile fallback: `undefined` (react-pdf uses container width); desktop fallback: `min(800, window.innerWidth - 100)`.

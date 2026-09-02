# useZoomInputs Spec

## 1. Overview

| Item                     | Description                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Attaches wheel (Ctrl+wheel) and pointer (two-finger pinch) zoom handlers to a container ref; enables keyboard-free zoom interaction |
| Used by components/pages | FilePreviewDialog                                                                                                                   |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/useZoomInputs.js`

### 2.2 Input Parameters

| Name         | Type            | Required | Description                                                            |
| ------------ | --------------- | -------- | ---------------------------------------------------------------------- |
| containerRef | React.RefObject | Y        | Ref to the DOM element that receives zoom events                       |
| zoom         | number          | Y        | Current zoom factor                                                    |
| setZoom      | function        | Y        | Callback `(prev => next) => void` to update zoom                       |
| isMobile     | boolean         | Y        | Mobile breakpoint; enables pinch, may disable or adjust wheel behavior |
| enabled      | boolean         | Y        | Whether to attach listeners; when false, no listeners                  |
| minZoom      | number          | Y        | Minimum zoom for clamping                                              |
| maxZoom      | number          | Y        | Maximum zoom for clamping                                              |

### 2.3 Return Value / State

- None; this hook only attaches and cleans up event listeners.

### 2.4 Dependencies

- Browser APIs: `addEventListener` for `wheel`, `pointerdown`, `pointermove`, `pointerup`, `pointercancel`
- Wheel: use `{ passive: false }` to allow `preventDefault` when `ctrlKey` is true

### 2.5 Side Effects

- **Wheel (Ctrl+wheel / trackpad pinch):** When `ctrlKey` is true, `preventDefault()`, and apply zoom via delta-proportional scale: `scaleFactor = 1 + (-deltaY) * WHEEL_SENSITIVITY`, clamped per-event by `MAX_SCALE_PER_EVENT` (e.g. ±15%) to avoid trackpad oversensitivity; then `setZoom(prev => clamp(prev * clampedScale, minZoom, maxZoom))`. Uses `WHEEL_SENSITIVITY` and `MAX_SCALE_PER_EVENT` constants.
- **Pointer (pinch):** Track two active pointers; use incremental ratio: `ratio = currentDistance / lastDistance`, `setZoom(prev => clamp(prev * ratio, minZoom, maxZoom))`. Update `lastDistance` on each touchstart (2 touches) and touchmove. Skip when `lastDistance &lt; 10`. Reset `lastDistance` when pointer count &lt; 2. Avoids wrong-baseline bugs when user briefly lifts and re-touches during pinch.
- Effect runs when `enabled`, `containerRef.current`, `zoom`, `setZoom`, `minZoom`, `maxZoom`, `isMobile` change.
- Cleanup: remove all listeners on unmount or when dependencies change.

### 2.6 Error Handling

- No external calls; no error state. Guard against missing containerRef.current.

### 2.7 Verification Scenarios

- [ ] When enabled and ref exists, wheel with ctrlKey updates zoom
- [ ] Wheel without ctrlKey does not update zoom (or does not preventDefault)
- [ ] Two-finger pinch on mobile updates zoom
- [ ] Cleanup removes listeners
- [ ] When enabled is false, no listeners attached

### 2.8 Edge Cases

- Re-attach listeners when active preview changes (ref may point to different DOM node). Use `previewFileType` or similar in effect dependency to force re-run.
- touchAction: parent/container may need `touchAction: 'pan-x pan-y'` or `'none'` to prevent browser zoom; `useZoomInputs` provides pinch handling.

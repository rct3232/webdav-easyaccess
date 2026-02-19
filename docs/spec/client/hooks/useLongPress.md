# useLongPress Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Long-press event: returns touch/mouse handlers. Fires onLongPress after delay if no touch/mouse move. Haptic feedback on fire. |
| Used by components/pages | FileList, FileGrid, FileDetail (inline long-press pattern) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useLongPress.js`
- **Test file:** `client/src/hooks/__tests__/useLongPress.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| onLongPress | function | Y | Callback on long press |
| delay | number | N | 500 (ms) |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| onTouchStart | function | Start timer |
| onTouchEnd | function | Clear timer |
| onTouchMove | function | Cancel (set touchMoveRef) |
| onMouseDown | function | Start timer |
| onMouseUp | function | Clear timer |
| onMouseLeave | function | Clear timer |

### 2.4 Dependencies

- React useCallback, useRef
- navigator.vibrate (optional)

### 2.5 Side Effects

- setTimeout for delay
- navigator.vibrate(50) on fire

### 2.6 Error Handling

- None

### 2.7 Verification Scenarios

- [ ] onLongPress called after delay with no move
- [ ] Move cancels long press
- [ ] Touch and mouse handlers

### 2.8 Edge Cases

- touchMove cancels before fire
- clear on mouseLeave

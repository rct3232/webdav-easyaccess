# useLongPressSelect Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Provides long-press touch handlers for file items so that on mobile, a long press enters selection mode and selects the file (without opening context menu) |
| Used by components/pages | FileList, FileGrid, FileDetail |

---

## 2. Implementation Spec

### 2.1 File Path

| Scope | Source path | Test path |
|-------|-------------|-----------|
| Component-family | `client/src/components/file-manager/hooks/useLongPressSelect.js` | `client/src/components/file-manager/hooks/__tests__/useLongPressSelect.test.js` |

- **Source:** `client/src/components/file-manager/hooks/useLongPressSelect.js`
- **Test file:** `client/src/components/file-manager/hooks/__tests__/useLongPressSelect.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| isMobile | boolean | Y | Whether the view is in mobile breakpoint; when false, hook returns no handlers |
| selectionMode | boolean | Y | Whether selection mode is already active; when true, long-press is disabled |
| onLongPressSelect | function | Y | Callback when long-press is detected: `(file) => void`. When falsy, hook returns no handlers |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| getLongPressHandlers | function | `(file) => { onTouchStart, onTouchEnd, onTouchMove }`. Returns empty object when disabled (!isMobile \|\| selectionMode \|\| !onLongPressSelect); otherwise returns touch handlers for the given file |

### 2.4 Dependencies

- Browser APIs: `setTimeout`, `clearTimeout`, `navigator.vibrate` (optional)
- React: `useRef`, `useCallback`, `useEffect`

### 2.5 Side Effects

- **Touch start:** Start a timer (e.g. 500ms). If it fires without touch move/cancel, call `onLongPressSelect(file)` and optionally `navigator.vibrate(50)`.
- **Touch end / touch move:** Clear the timer for that file so long-press does not fire.
- **Cleanup:** On unmount, clear all timers and clear internal refs (e.g. longPressTimersRef, touchMovedRef) so no timers remain.

### 2.6 Error Handling

- No external API or error state. Guard by only returning handlers when `isMobile && !selectionMode && onLongPressSelect` are satisfied.

### 2.7 Verification Scenarios

- [ ] When `!isMobile` or `selectionMode` or `!onLongPressSelect`, `getLongPressHandlers(file)` returns empty object (no handlers)
- [ ] When enabled, `getLongPressHandlers(file)` returns an object with `onTouchStart`, `onTouchEnd`, `onTouchMove`
- [ ] When enabled and long-press completes (no touch move), `onLongPressSelect` is called with the file
- [ ] When touch move occurs before timer fires, `onLongPressSelect` is not called
- [ ] Cleanup on unmount: no timers left (e.g. clear all entries in refs)

### 2.8 Edge Cases

- Multiple files: each file has its own timer keyed by `file.path`; cleanup clears all.
- User lifts finger (touch end) before 500ms: timer is cleared, `onLongPressSelect` not called.
- Rapid touch start/end: timers cleared on end, no stray callbacks.

# useUIVisibility Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Manages header/controls visibility with auto-hide timer; exposes show/hide callbacks used by gallery navigation and mouse/touch events |
| Used by components/pages | FilePreviewDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/useUIVisibility.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| open | boolean | Y | Dialog open state |
| isGalleryMode | boolean | Y | True when multiple media files are shown |
| loading | boolean | Y | Preview loading state; timer starts after loading finishes |
| isMobile | boolean | Y | Mobile breakpoint flag |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| headerVisible | boolean | Header visibility (mobile: controlled; desktop: always true) |
| controlsVisible | boolean | Controls visibility (desktop: auto-hide; mobile: always true) |
| startHideTimer | function | Starts (or restarts) the 2s auto-hide countdown |
| clearHideTimer | function | Cancels the pending hide timer |
| resetHideTimer | function | Shows UI and restarts the hide timer |

### 2.4 Dependencies

- Other hooks: none
- Constants: `HIDE_UI_DELAY_MS = 2000`

### 2.5 Side Effects

- Timer cleanup effect: clears timer on unmount and when `open` becomes false.
- Gallery+loading effect: starts hide timer when `open && isGalleryMode && !loading`.
- On open: resets `headerVisible=true` and `controlsVisible=true`.
- On close: clears timer.

### 2.6 Error Handling

- No external calls; no error state.

### 2.7 Verification Scenarios

- [ ] Initial: `headerVisible=true`, `controlsVisible=true`
- [ ] `startHideTimer` hides header (mobile) or controls (desktop) after 2s
- [ ] `clearHideTimer` cancels pending hide
- [ ] `resetHideTimer` shows UI and restarts timer
- [ ] Timer clears when dialog closes
- [ ] Timer starts automatically when `loading` finishes in gallery mode

### 2.8 Edge Cases

- Timer cleared on unmount to prevent setState after unmount.
- Mobile: `headerVisible` drives hide; `controlsVisible` always true.
- Desktop: `controlsVisible` drives hide; `headerVisible` always true.

# useGalleryNavigation Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Manages gallery index state and navigation: syncs index from file.path on open, provides goPrev/goNext, handles touch swipe gestures for navigation |
| Used by components/pages | FilePreviewDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/useGalleryNavigation.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| open | boolean | Y | Dialog open state |
| isGalleryMode | boolean | Y | True when multiple media files are shown |
| file | object | Y | Original file prop (used for path-based index sync) |
| mediaFiles | array | Y | All media files in gallery |
| isMobile | boolean | Y | Mobile breakpoint flag |
| currentPreviewFileType | string | N | File type of currently displayed file |
| resetHideTimer | function | Y | Resets UI hide timer on navigation |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| currentMediaIndex | number | Index of currently displayed file in mediaFiles |
| goPrev | function | Navigates to previous media |
| goNext | function | Navigates to next media |
| handleTouchStart | function | Records touch start X coordinate |
| handleTouchEnd | function | Handles swipe navigation or tap toggle |

### 2.4 Dependencies

- Other hooks: none
- Refs (internal): `touchStartX`, `touchStartedOnPlyrControls`, `lastSyncedFilePathRef`

### 2.5 Side Effects

- `useLayoutEffect`: syncs `currentMediaIndex` from `file.path` when dialog opens or `mediaFiles` changes; does not lock to 0 if file not found (resilient to async mediaFiles population). Uses `lastSyncedFilePathRef` to prevent re-sync on gallery arrow navigation.
- `useEffect`: resets `currentMediaIndex` to 0 and clears `lastSyncedFilePathRef` when `open` becomes false.

### 2.6 Error Handling

- If file not found in mediaFiles during sync, index is not updated (retry on next mediaFiles change).

### 2.7 Verification Scenarios

- [ ] Initial `currentMediaIndex` is 0
- [ ] `goPrev` decrements index; disabled at 0
- [ ] `goNext` increments index; disabled at last item
- [ ] Swipe left calls `goNext`; swipe right calls `goPrev`
- [ ] `currentMediaIndex` resets to 0 when dialog closes
- [ ] Index syncs correctly to matching file in mediaFiles on open
- [ ] If file not in mediaFiles on open, index is not set to 0

### 2.8 Edge Cases

- Touch started on Plyr controls: swipe/tap navigation suppressed.
- Horizontal swipe threshold: >50px diff triggers navigation, not tap.
- `lastSyncedFilePathRef` prevents re-sync on user-initiated gallery navigation.

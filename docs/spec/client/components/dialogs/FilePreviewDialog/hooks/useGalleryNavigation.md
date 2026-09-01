# useGalleryNavigation Spec

## 1. Overview

| Item                     | Description                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Manages gallery index state and navigation: derives opened index from file.path, provides goPrev/goNext, handles touch swipe gestures for navigation |
| Used by components/pages | FilePreviewDialog                                                                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/useGalleryNavigation.js`

### 2.2 Input Parameters

| Name                   | Type     | Required | Description                                         |
| ---------------------- | -------- | -------- | --------------------------------------------------- |
| open                   | boolean  | Y        | Dialog open state                                   |
| isGalleryMode          | boolean  | Y        | True when multiple media files are shown            |
| file                   | object   | Y        | Original file prop (used for path-based index sync) |
| mediaFiles             | array    | Y        | All media files in gallery                          |
| isMobile               | boolean  | Y        | Mobile breakpoint flag                              |
| currentPreviewFileType | string   | N        | File type of currently displayed file               |
| resetHideTimer         | function | Y        | Resets UI hide timer on navigation                  |

### 2.3 Return Value / State

| Key               | Type     | Meaning                                         |
| ----------------- | -------- | ----------------------------------------------- |
| currentMediaIndex | number   | Index of currently displayed file in mediaFiles |
| goPrev            | function | Navigates to previous media                     |
| goNext            | function | Navigates to next media                         |
| handleTouchStart  | function | Records touch start X coordinate                |
| handleTouchEnd    | function | Handles swipe navigation or tap toggle          |

### 2.4 Dependencies

- Other hooks: none
- Refs (internal): `touchStartX`, `touchStartedOnPlyrControls`

### 2.5 Side Effects

- `openedIndex` is derived during render via `mediaFiles.findIndex(f => f.path === file.path)`. No sync effect needed; PreviewThumbnailBar receives the correct index on first paint, avoiding scroll animation on open.
- `navigationOffset` (state) tracks user prev/next navigation from the opened index.
- `currentMediaIndex = clamp(openedIndex + navigationOffset, 0, mediaFiles.length - 1)`; falls back to 0 when `openedIndex < 0`.
- `useEffect`: resets `navigationOffset` to 0 when `open` becomes false or when `file?.path` changes.

### 2.6 Error Handling

- If file not found in mediaFiles during sync, index is not updated (retry on next mediaFiles change).

### 2.7 Verification Scenarios

- [ ] Initial `currentMediaIndex` matches `file.path` in mediaFiles (derived from openedIndex)
- [ ] `goPrev` decrements index; disabled at 0
- [ ] `goNext` increments index; disabled at last item
- [ ] Swipe left calls `goNext`; swipe right calls `goPrev`
- [ ] `currentMediaIndex` resets to match opened file when dialog closes
- [ ] Index is derived correctly from matching file in mediaFiles on open
- [ ] If file not in mediaFiles on open, openedIndex is -1 and display falls back to file

### 2.8 Edge Cases

- Touch started on Plyr controls: swipe/tap navigation suppressed.
- Horizontal swipe threshold: >50px diff triggers navigation, not tap.
- `navigationOffset` isolates user prev/next from the derived opened index; no re-sync on arrow navigation.

# usePlyrPlayer Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Imperatively creates and destroys Plyr audio/video instances; syncs Plyr controls visibility with headerVisible/controlsVisible; prevents click synthesis on tap-to-toggle (mobile video) |
| Used by components/pages | FilePreviewDialog                                                                                                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/usePlyrPlayer.js`

### 2.2 Input Parameters

| Name                   | Type         | Required | Description                                                      |
| ---------------------- | ------------ | -------- | ---------------------------------------------------------------- |
| open                   | boolean      | Y        | Dialog open state                                                |
| previewUrl             | string\|null | Y        | Stream or blob URL for the media                                 |
| displayFile            | object       | N        | Currently displayed file                                         |
| file                   | object       | Y        | Original file prop                                               |
| headerVisible          | boolean      | Y        | From useUIVisibility                                             |
| controlsVisible        | boolean      | Y        | From useUIVisibility                                             |
| isMobile               | boolean      | Y        | Mobile breakpoint flag                                           |
| currentPreviewFileType | string       | N        | Resolved file type of displayed file                             |
| loading                | boolean      | Y        | Preview loading state (triggers effect re-run when video mounts) |
| isGalleryMode          | boolean      | Y        | True when gallery mode is active                                 |

### 2.3 Return Value / State

| Key               | Type      | Meaning                                                 |
| ----------------- | --------- | ------------------------------------------------------- |
| videoNotPlayable  | boolean   | True when video cannot be played (format/network error) |
| audioContainerRef | React.Ref | Ref for the audio Plyr mount container div              |
| videoContainerRef | React.Ref | Ref for the video Plyr mount container div              |
| mediaTouchRef     | React.Ref | Ref for the touch-event wrapper (image or video Box)    |

### 2.4 Dependencies

- Libraries: `PlyrLib` (plyr), `plyr/dist/plyr.css`
- Utilities: `getFileType`

### 2.5 Side Effects

- **Audio effect**: creates `<audio>` element, mounts Plyr instance into `audioContainerRef`; destroys on cleanup.
- **Video effect**: creates `<video>` element with `<source>`, mounts Plyr with `hideControls: false`; listens for error/canplay/waiting/stalled events; calls `videoEl.load()` after source is set; destroys on cleanup.
- **Controls sync effect**: calls `plyr.toggleControls(visible)` when `headerVisible`/`controlsVisible` changes for video previews.
- **Touchend preventDefault effect**: attaches `{ passive: false, capture: true }` listener to `mediaTouchRef`; suppresses synthetic click on tap-to-toggle (mobile video) without cancelling Plyr control taps (`.plyr__control`).

### 2.6 Error Handling

- `onError` → `setVideoNotPlayable(true)`
- `onWaiting` / `onStalled` with `networkState === 3` → `setVideoNotPlayable(true)`
- `onCanPlay` → `setVideoNotPlayable(false)`

### 2.7 Verification Scenarios

- [ ] Audio: Plyr created when `open && previewUrl && type === 'audio'`; destroyed on close
- [ ] Video: Plyr created when `open && previewUrl && type === 'video'`; destroyed on close
- [ ] `videoNotPlayable` set true on error
- [ ] `videoNotPlayable` reset false on `canplay`
- [ ] Controls sync: `plyr.toggleControls` called with correct value on visibility change
- [ ] Touchend: prevents default on tap but not on Plyr control tap

### 2.8 Edge Cases

- Plyr wraps the video element (moves it in DOM); cleanup uses `while (container.firstChild)` to clear all children.
- `controls: false` on native video element (Plyr provides its own UI).
- `videoEl.load()` called after source set so unsupported formats surface early.

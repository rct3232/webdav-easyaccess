# FilePreviewDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Full-screen preview for images, PDFs, text, video. Supports gallery mode for multiple media. Uses getFileBlob (non-video), react-pdf, and a ticket-based streaming URL for video preview. |
| Used in | FileManager (Preview from context menu) |
| Related components | PreviewThumbnailBar, getFileBlob, getFileType |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/index.js`
- **Test file:** `client/src/components/dialogs/__tests__/FilePreviewDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| file | object | Y | - | File to preview |
| mediaFiles | array | N | [] | Multiple media for gallery |
| shareToken | string | N | - | Share token |
| onThumbnailsLoaded | function | N | - | Thumbnail callback |
| hideCloseButton | boolean | N | false | Hide close button |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Close | - |
| onThumbnailsLoaded | Thumbnails ready | - |

### 2.4 Dependencies

- **imports:** getFileBlob, **getVideoPreviewStreamUrl**, react-pdf, getFileType, PreviewThumbnailBar, useResponsive, plyr; fileService for download (same policy as list/grid download).
- **Reference implementation:** `client/src/components/dialogs/FilePreviewDialog/index.js`
- **Download:** The preview dialog’s download action uses the same single-file download path as the file manager (fileService.downloadFile with file metadata). On iOS + image, this yields the share sheet or inline fallback; no duplicate logic. User guidance (e.g. i18n): when the share sheet is shown, the user can choose “Save Image” (or equivalent) to save to Photos.

### 2.5 i18n Keys

- preview.*, common.*
- Video playback failure overlay uses: `preview.videoNotPlayable`
- When using Web Share for image download (iOS), consider a short hint (e.g. tooltip or toast) that the user can choose “Save Image” (or locale equivalent) in the share sheet to save to Photos.

### 2.6 Conditional Rendering

- Image: img with blob URL
- PDF: react-pdf Document/Page
- **Video:** Plyr player (video element) with **streaming URL** (`<video src="/api/files/preview-stream?...">`). Uses a short-lived ticket so the video element can load without custom headers. Fills content area (width/height 100%, object-fit contain).
- **Video source type hint:** Do not set `<source type="...">` for video preview. Let the browser decide based on response headers/sniffing to avoid prematurely rejecting playable `.mov` content in Chromium-based browsers.
- Audio: Plyr player (audio element); centered, transparent background, white controls/sliders/text
- Text: pre/code
- Gallery mode when mediaFiles.length > 1 (image/video)
- **Gallery index:** `currentMediaIndex` is derived from `file.path` and synchronized in an effect (no render-time state updates). The sync must be resilient to delayed `mediaFiles` updates: if the opened file is not found in `mediaFiles` yet, do not lock the index to 0; retry when `mediaFiles` changes. Use a layout effect when necessary so the first paint uses the correct index and PreviewThumbnailBar does not animate scroll on open.
- **Video preview:** PreviewThumbnailBar is hidden (avoids conflict with Plyr controls)
- Auto-hide UI after 2s

### 2.7 Verification Scenarios

- [ ] Renders correct preview type
- [ ] Gallery navigation
- [ ] onClose
- [ ] Error/loading states

### 2.8 Content Vertical Layout

- **Image, video:** Centered in available space (flex: 1, center). Video: Plyr wrapper fills container; video element uses object-fit: contain.
- **Loading, error, canPreview=false, default:** Vertical center. Use `flex: 1`, `minHeight: 0`, `justifyContent: 'center'`, `alignItems: 'center'`.
- **Audio:** Vertical center. Use `flex: 1`, `minHeight: 0`, `justifyContent: 'center'`, `alignItems: 'center'`.
- **Text:** Center when content fits; when overflow (scroll needed), switch to top align so scroll is downward only. Use ResizeObserver. Scrollbar hidden (same as PDF).
- **PDF:** Original layout preserved (top-aligned, scrollable). Scrollbar hidden via CSS (scrollbar-width, ::-webkit-scrollbar) while scroll remains functional.

### 2.9 Edge Cases

- pdf.worker.min.js from public
- Unsupported file type
- Header filename may be very long: render a pixel-based middle truncation (via `pixelMiddleTruncate`) so it never overlaps the action buttons (download/close). Do not rely on CSS end-ellipsis for the visible text; the UI should display the `pixelMiddleTruncate` result as-is. When truncated (desktop), show the full filename via Tooltip.
- **Preview download:** Reuse fileService.downloadFile with file metadata so iOS + image uses share sheet or inline fallback; avoid duplicating download logic (e.g. direct blob URL download) in the dialog.
- **Video preview auth:** Do not use JWT in query params. Use `getVideoPreviewStreamUrl` which obtains a short-lived ticket from the server and returns a streaming URL safe for `<video src>`.
- **Video + touch:** On mobile, when the user touches or swipes on Plyr video controls (progress bar, volume, etc.), horizontal swipe does not change media (prevents accidental navigation while scrubbing).
- **Video + UI sync:** Header (mobile), left/right chevrons, and Plyr video controls show/hide together. Mobile: tap on video surface toggles all; `headerVisible` drives Plyr. Desktop: mouse move in gallery shows all; after 2s inactivity `controlsVisible` hides all; `controlsVisible` drives Plyr. Plyr play-large follows default behavior (hidden when playing).

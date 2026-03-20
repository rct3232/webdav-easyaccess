# FilePreviewDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Full-screen preview for images, PDFs, text, video. Supports gallery mode for multiple media. Uses getFileBlob (non-video), react-pdf, and a ticket-based streaming URL for video preview. |
| Used in | FileManager (Preview from context menu) |
| Related components | PreviewThumbnailBar, HeaderZoomControls, getFileBlob, getFileType |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/FilePreviewDialog.js`
- **Entry point (re-export):** `client/src/components/dialogs/FilePreviewDialog/index.js`
- **Test file:** `client/src/components/dialogs/__tests__/FilePreviewDialog.test.js`

### 2.2a Local Hooks

All hooks live under `client/src/components/dialogs/FilePreviewDialog/hooks/`:

| Hook | Responsibility |
|------|---------------|
| `usePreviewLoader` | `loading`, `error`, `previewUrl`, `previewBlob`, `textContent`, `loadPreview` callback, blob cleanup effect |
| `useGalleryNavigation` | `currentMediaIndex`, `goPrev`, `goNext`, `handleTouchStart/End`, derived opened index + navigation offset, reset on close |
| `useUIVisibility` | `headerVisible`, `controlsVisible`, `startHideTimer`, `clearHideTimer`, `resetHideTimer`, hide timer effects |
| `usePlyrPlayer` | Plyr audio/video DOM effects, `videoNotPlayable` state, controls sync effect, touchend preventDefault effect, `audioContainerRef`, `videoContainerRef`, `mediaTouchRef` |
| `usePdfLayout` | `pdfContainerRef`, `containerWidth/Height`, `calculatedWidth` (useMemo), `pageArray` (useMemo), `numPages`, `pageInfo`, PDF container ResizeObserver effect |
| `useHeaderTruncation` | `titleRowRef`, `actionsRef`, `titleRowWidth`, `actionsWidth`, `textOverflows`, `truncatedHeaderName`, `isHeaderTruncated`, header ResizeObserver effect, text overflow detection effect |

Spec files: `docs/spec/client/components/dialogs/FilePreviewDialog/hooks/`

### 2.2b Preview Subcomponents

All subcomponents live under `client/src/components/dialogs/FilePreviewDialog/previews/`:

| Component | Rendered for |
|-----------|-------------|
| `ImagePreview` | `fileType === 'image'` — img + gallery chevrons; supports zoom |
| `VideoPreview` | `fileType === 'video'` — Plyr video container, videoNotPlayable overlay, gallery chevrons |
| `AudioPreview` | `fileType === 'audio'` — Plyr audio container |
| `PdfPreview` | `fileType === 'pdf'` — react-pdf Document/Page; supports zoom |
| `TextPreview` | `fileType === 'text'` — pre tag with scrollable text (no zoom) |
| `PreviewUnsupported` | `canPreview === false` and unrecognised types |

### 2.2c Zoom Support

- **Zoomable types:** `pdf`, `image` (text preview does not support zoom).
- **HeaderZoomControls:** Zoom controls are integrated in the dialog header. Order in header: zoom controls (when applicable) → download → close.
  - **Desktop:** Full inline controls (zoom out, percentage/reset, zoom in) in the header.
  - **Mobile:** Header shows a single compact control (ZoomIn icon when zoom is 1, or e.g. 125% when zoom has changed). A floating bar with full controls (zoom out, %, zoom in) appears and disappears with the header, positioned just below the header; bar width is content-sized (not full width).
- **Inputs:** Ctrl+wheel zoom (desktop), two-finger pinch zoom (mobile).

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
- **Video source type hint:** Set `<source type="...">` using shared `getContentType(filename)` so the player provides an explicit MIME hint (e.g. `.mov` -> `video/quicktime`).
- **Video preload:** Set `preload="metadata"` and call `load()` after wiring the source so unsupported formats surface quickly (without requiring the user to press play).
- **Video play-large button:** Keep Plyr's large play button visible. Background is white; icon color is `rgba(0,0,0,0.5)` (including hover/focus) for readability.
- Audio: Plyr player (audio element); centered, transparent background, white controls/sliders/text
- Text: pre/code
- Gallery mode when mediaFiles.length > 1 (image/video)
- **Gallery index:** `openedIndex` is derived during render via `mediaFiles.findIndex(f => f.path === file.path)`. `navigationOffset` (state) tracks prev/next from the opened index. `currentMediaIndex = clamp(openedIndex + navigationOffset, 0, mediaFiles.length - 1)`; falls back to 0 when `openedIndex < 0`. This ensures the correct index on first paint so PreviewThumbnailBar does not animate scroll on open. Reset `navigationOffset` when the dialog closes or when `file.path` changes.
- **Preview race condition prevention:** `loadPreview` must use an `AbortController` signal to cancel stale in-flight requests. When `displayFile` changes (e.g. gallery navigation or `mediaFiles` update), the previous fetch must be aborted before the new one starts. The calling `useEffect` creates an `AbortController`, passes its `signal` to `loadPreview`, and returns `() => controller.abort()` as the cleanup. Inside `loadPreview`, `signal.aborted` is checked after each `await` before calling any `setState`. `AbortError` exceptions are silently swallowed (not treated as preview errors). `getFileBlob` forwards the signal to the underlying `get()` call.
- **Video preview:** PreviewThumbnailBar is hidden (avoids conflict with Plyr controls)
- Auto-hide UI after 2s

### 2.7 Verification Scenarios

- [ ] Renders correct preview type
- [ ] Gallery navigation
- [ ] onClose
- [ ] Error/loading states
- [ ] Zoom controls in header for zoomable types (PDF, image); order: zoom → download → close; zoom controls change scale

### 2.8 Content Vertical Layout

- **Image, video:** Centered in available space (flex: 1, center). Video: Plyr wrapper fills container; video element uses object-fit: contain.
  - **Image zoom layout:** Use a three-layer structure to correctly support zoom + scroll + fixed chevrons:
    1. `outerWrapper` — `position: relative`, `overflow: hidden`, `flex: 1`; serves as the chevron positioning context and touch/swipe target (`mediaTouchRef`).
    2. `scrollBox` — `overflow: auto` inner box filling `outerWrapper`; handles scrolling when image is zoomed.
    3. `centerBox` — `min-width: 100%`, `min-height: 100%`, `display: flex`, `justify-content/align-items: center`; centers the image when it fits; allows it to overflow (and scroll) when zoomed.
    - Chevrons (`position: absolute`) are placed in `outerWrapper`, not in `scrollBox`, so they remain fixed on screen regardless of scroll position.
    - **Do NOT use `transform: scale()` for zoom on images.** Use actual layout dimensions instead: record the image's rendered base size on load (`onLoad` → `imgRef.current.offsetWidth/offsetHeight`), then set explicit `width = baseSize.width * zoom` (with `maxWidth`/`maxHeight` removed when zoom > 1). This ensures the scroll container's scrollable area reflects the true scaled size in all directions (including left/top), preventing the left-side clipping issue caused by CSS transform not affecting layout.
    - `centerBox` uses `minWidth: zoomed width` and `minHeight: max(100%, zoomed height)`. The `max(100%, ...)` for height is required because block elements automatically fill container width but NOT height — without it, a landscape image shorter than the viewport would sit at the top instead of being vertically centered.
    - Reset `baseSize` when `previewUrl` changes.
- **Loading, error, canPreview=false, default:** Vertical center. Use `flex: 1`, `minHeight: 0`, `justifyContent: 'center'`, `alignItems: 'center'`.
- **Audio:** Vertical center. Use `flex: 1`, `minHeight: 0`, `justifyContent: 'center', `alignItems: 'center'`.
- **Text:** Center when content fits; when overflow (scroll needed), switch to top align so scroll is downward only. Use ResizeObserver. Scrollbar hidden (same as PDF).
- **PDF:** Top-aligned and scrollable inside a container that fills the available content area (flex: 1, minHeight: 0). Do not clamp height with a fixed viewport-relative value (e.g. 70vh); instead, let the PDF container inherit height from `DialogContent` so there is no unused vertical gap beneath the preview. Scrollbar hidden via CSS (scrollbar-width, ::-webkit-scrollbar) while scroll remains functional.

### 2.9 Edge Cases

- pdf.worker.min.js from public
- Unsupported file type
- Header filename may be very long: render a pixel-based middle truncation (via `pixelMiddleTruncate`) so it never overlaps the action buttons (zoom when applicable, download, close). Do not rely on CSS end-ellipsis for the visible text; the UI should display the `pixelMiddleTruncate` result as-is. When truncated (desktop), show the full filename via Tooltip.
- **Preview download:** Reuse fileService.downloadFile with file metadata so iOS + image uses share sheet or inline fallback; avoid duplicating download logic (e.g. direct blob URL download) in the dialog.
- **Video preview auth:** Do not use JWT in query params. Use `getVideoPreviewStreamUrl` which obtains a short-lived ticket from the server and returns a streaming URL safe for `<video src>`.
- **Video + touch:** On mobile, when the user touches or swipes on Plyr video controls (progress bar, volume, etc.), horizontal swipe does not change media (prevents accidental navigation while scrubbing).
- **Video + UI sync:** Header (mobile), left/right chevrons, and Plyr video controls show/hide together. Mobile: tap on video surface toggles all; `headerVisible` drives Plyr. Desktop: mouse move in gallery shows all; after 2s inactivity `controlsVisible` hides all; `controlsVisible` drives Plyr. Plyr play-large follows default behavior (hidden when playing).

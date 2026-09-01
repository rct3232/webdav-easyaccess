# usePreviewLoader Spec

## 1. Overview

| Item                     | Description                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Manages file preview loading: fetches blob/stream URL, handles text decoding, tracks loading/error state, revokes blob URLs on cleanup |
| Used by components/pages | FilePreviewDialog                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePreviewDialog/hooks/usePreviewLoader.js`

### 2.2 Input Parameters

| Name        | Type     | Required | Description                                                       |
| ----------- | -------- | -------- | ----------------------------------------------------------------- |
| displayFile | object   | N        | Currently displayed file (gallery-resolved); falls back to `file` |
| file        | object   | Y        | Original file prop passed to dialog                               |
| shareToken  | string   | N        | Share token for authenticated requests                            |
| t           | function | Y        | i18n translation function                                         |

### 2.3 Return Value / State

| Key         | Type         | Meaning                                                                              |
| ----------- | ------------ | ------------------------------------------------------------------------------------ |
| loading     | boolean      | True while preview is being fetched                                                  |
| error       | string\|null | Error message, or null on success                                                    |
| previewUrl  | string\|null | Blob URL or stream URL for the preview                                               |
| previewBlob | Blob\|null   | Raw Blob (PDF only, for react-pdf `file` prop)                                       |
| textContent | string\|null | Decoded text (text files only)                                                       |
| loadPreview | function     | `(signal: AbortSignal) => Promise<void>` — triggers a fetch; called by parent effect |

### 2.4 Dependencies

- Services called: `getFileBlob` (non-video), `getVideoPreviewStreamUrl` (video)
- Other hooks: none (receives `t` as parameter)
- Utilities: `getFileType`

### 2.5 Side Effects

- Blob URL cleanup: on state reset (dialog close), `URL.revokeObjectURL` is called on the previous `previewUrl` if it starts with `blob:`.
- Resets `previewUrl`, `previewBlob`, `textContent`, `numPages`, `loading`, `error` when dialog closes (`open` becomes false via the parent's `useEffect` that calls `loadPreview`).

### 2.6 Error Handling

- `AbortError` is silently swallowed (cancelled request).
- Other errors: `setError(t('preview.loadFail'))`, `setLoading(false)`.

### 2.7 Verification Scenarios

- [ ] Initial state: `loading=true`, `error=null`, `previewUrl=null`, `previewBlob=null`, `textContent=null`
- [ ] After successful image load: `loading=false`, `previewUrl` is a blob URL
- [ ] After successful video load: `loading=false`, `previewUrl` is a stream URL
- [ ] After successful text load: `loading=false`, `textContent` is a string
- [ ] After successful PDF load: `loading=false`, `previewUrl` and `previewBlob` are set
- [ ] AbortError does not set error state
- [ ] Network error sets `error` string and `loading=false`

### 2.8 Edge Cases

- AbortController signal passed from caller; stale requests aborted when `displayFile` changes.
- `signal.aborted` checked after every `await` before calling setState.
- Blob URL from previous preview revoked before setting new one.

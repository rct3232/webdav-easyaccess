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

- A failure is ignored ONLY when the **caller** aborted the request (`signal.aborted` is true — user navigated away, dialog closed, or effect re-ran).
- `httpClient` converts both caller aborts AND its own transport timeout into an error with `code='ECONNABORTED'`; the two are distinguished by `signal.aborted`, never by the error code alone. A transport timeout (caller signal NOT aborted) is a real failure.
- Preview blob fetches (text/pdf/image) disable transport retries (`maxRetries: 0`), so a fast
  server error (e.g. an S3/WebDAV auth failure that the storage provider answers immediately)
  surfaces to the user right away instead of after ~7 s of backoff retries. The transport total
  timeout stays at the httpClient default (5 min) — no short cap is applied, so slow-but-working
  transfers on a healthy backend are never cut off.
- The client cannot detect an unreachable backend itself — the server-side storage attempt must
  first fail or time out. A hung backend therefore resolves via the transport timeout; bounding
  that further is a server-side concern, not a client timeout.
- Other errors: message resolution is `getServerErrorDisplay(error.response.data, t)` when the server returned an `errorCode` (connection-class failures map to the friendly `files.storageUnavailable` text); otherwise the generic `t('preview.loadFail')`. In every non-abort failure `setLoading(false)` is called so the spinner always resolves.
- Failed loads do not keep `loading=true` — the spinner clears and an error is shown.

### 2.7 Verification Scenarios

- [ ] Initial state: `loading=true`, `error=null`, `previewUrl=null`, `previewBlob=null`, `textContent=null`
- [ ] After successful image load: `loading=false`, `previewUrl` is a blob URL
- [ ] After successful video load: `loading=false`, `previewUrl` is a stream URL
- [ ] After successful text load: `loading=false`, `textContent` is a string
- [ ] After successful PDF load: `loading=false`, `previewUrl` and `previewBlob` are set
- [ ] AbortError (caller signal aborted) does not set error state
- [ ] Transport timeout (`code='ECONNABORTED'` with caller signal NOT aborted) sets `error` and `loading=false` — no infinite spinner
- [ ] Server `errorCode` on the response is surfaced via `getServerErrorDisplay` (connection-class codes → `files.storageUnavailable`)
- [ ] Network error without a server response sets `error` (generic preview message) and `loading=false`
- [ ] A fast server error is not transport-retried (maxRetries 0) — no backoff delay before the error shows
- [ ] A settled request never leaves `loading=true`

### 2.8 Edge Cases

- AbortController signal passed from caller; stale requests aborted when `displayFile` changes.
- `signal.aborted` checked after every `await` before calling setState.
- Blob URL from previous preview revoked before setting new one.

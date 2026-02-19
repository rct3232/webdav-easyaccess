# thumbnail Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Thumbnail generation: generateThumbnail for images (sharp) and videos (ffmpeg). Token-based URL, cache. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/thumbnail.js`
- **Test file:** `server/utils/__tests__/thumbnail.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| generateThumbnail | (filePath, options?) => Promise\<Buffer\> | Generate thumbnail |
| getThumbnailToken | (path) => string | JWT token for thumbnail URL |
| verifyThumbnailToken | (token, path) => boolean | Verify token |
| getFfmpegStatus | () => object | ffmpeg availability |

### 2.3 Input / Output

- Returns image buffer (png/jpeg)
- Uses sharp for images, ffmpeg for video

### 2.4 Dependencies

- sharp, fluent-ffmpeg, webdav (getFileContents, isImageFile, isVideoFile)
- THUMBNAIL_TOKEN_SECRET, FFMPEG_PATH

### 2.5 Mock Targets

- sharp, ffmpeg
- webdav.getFileContents
- fs, child_process

### 2.6 Verification Scenarios

- [ ] Image thumbnail via sharp
- [ ] Video thumbnail via ffmpeg
- [ ] Token verify
- [ ] Cache behavior

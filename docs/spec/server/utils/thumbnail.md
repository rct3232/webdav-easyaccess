# thumbnail Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Thumbnail generation: generateThumbnail for images (sharp) and videos (ffmpeg). Token-based URL, cache. |
| Status | **Phase 2 relocated** — Logic moved to `domains/thumbnails/services/`. This file retained for backward compatibility only. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Original source:** `server/utils/thumbnail.js` (457 lines — relocated in Phase 2)
- **Relocated to:** `server/domains/thumbnails/services/thumbnailService.js`
- **Test file:** `server/domains/thumbnails/routes/__tests__/thumbnails.test.js`

### 2.2 Functions / Exports

| Function | Signature | Location | Description |
|----------|-----------|----------|-------------|
| getThumbnail | (webdavPath) => Promise\<Buffer\|null\> | thumbnailService.js | Dispatch to image/video processor |
| getThumbnailUrl | (webdavPath) => string\|null | thumbnailService.js | URL string for cached thumbnail |
| getThumbnailFromCache | (webdavPath) => Object\|null | thumbnailService.js | Cached thumbnail data |
| ensureThumbnail | (webdavPath) => Promise\<string\|null\> | thumbnailService.js | Generate if not cached, return URL |
| ensureThumbnailsBatch | (webdavPaths) => Promise\<Array\> | thumbnailService.js | Batch generation with concurrency limit |
| getThumbnailHash | (webdavPath) => string | thumbnailService.js | MD5 hash of path |
| signThumbnailToken | (webdavPath) => string | thumbnailService.js | JWT sign |
| verifyThumbnailToken | (token, hash) => boolean | thumbnailService.js | JWT verify |
| generateImageThumbnail | (filePath, webdavPath) => Promise\<Object\|null\> | imageProcessor.js | Sharp-based image resize |
| generateVideoThumbnail | (filePath, webdavPath) => Promise\<Object\|null\> | videoProcessor.js | FFmpeg frame extraction + sharp |
| initFfmpegOnce | () => Promise\<Object\> | videoProcessor.js | One-time ffmpeg availability check |
| getFfmpegStatus | () => object | videoProcessor.js | ffmpeg state object |

### 2.3 CacheAdapter Integration

- Thumbnail cache uses `CacheAdapter` interface (injected via `thumbnailService.js`)
- FIFO eviction: oldest entry deleted when cache reaches MAX_CACHE_SIZE (1000)
- `thumbnailCache` Map no longer exported directly

### 2.4 Dependencies

- sharp, fluent-ffmpeg, webdav (getFileContents, isImageFile, isVideoFile)
- THUMBNAIL_TOKEN_SECRET, FFMPEG_PATH
- CacheAdapter (injected)

### 2.5 Mock Targets

- sharp, ffmpeg
- webdav.getFileContents
- fs, child_process
- CacheAdapter (mock for tests)

### 2.6 Verification Scenarios

- [ ] Image thumbnail via sharp
- [ ] Video thumbnail via ffmpeg
- [ ] Token verify
- [ ] Cache behavior via CacheAdapter

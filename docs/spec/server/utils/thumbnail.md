# thumbnail Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Thumbnail generation for images (sharp) and videos (ffmpeg). Token-based URL, cache. All APIs keyed by `fileNodeId`. |
| Status | **Phase 2 relocated** — Logic moved to `domains/thumbnails/services/`. This file retained for backward compatibility only. **Phase 4 nodeId migration** (target contract, pending implementation in S1) — cache/hash/token/batch keyed by `fileNodeId`; blob bytes fetched via `blobStorageService.downloadBlob(nodeId)` instead of webdav path. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Original source:** `server/utils/thumbnail.js` (457 lines — relocated in Phase 2)
- **Relocated to:** `server/domains/thumbnails/services/thumbnailService.js`
- **Test file:** `server/domains/thumbnails/routes/__tests__/thumbnails.test.js`

### 2.2 Functions / Exports

| Function | Signature | Location | Description |
|----------|-----------|----------|-------------|
| getThumbnail | (nodeId) => Promise\<Buffer\|null\> | thumbnailService.js | Dispatch to image/video processor |
| getThumbnailUrl | (nodeId) => string\|null | thumbnailService.js | URL string for cached thumbnail (`/api/thumbnails/<hash>.<ext>?token=`) |
| getThumbnailFromCache | (nodeId) => Object\|null | thumbnailService.js | Cached thumbnail data |
| ensureThumbnail | (nodeId) => Promise\<string\|null\> | thumbnailService.js | Generate if not cached, return URL |
| ensureThumbnailsBatch | (nodeIds) => Promise\<Array\> | thumbnailService.js | Batch generation with concurrency limit; reads bytes via `blobStorageService.downloadBlob(nodeId)` |
| getCachedThumbnail | (nodeId) => Object\|null | thumbnailService.js | Cache read keyed `thumb:<nodeId>` |
| setCachedThumbnail | (nodeId, buffer, extension) => void | thumbnailService.js | Cache write keyed `thumb:<nodeId>` |
| findCachedThumbnailByHash | (hash) => { nodeId, thumbnail }\|null | thumbnailService.js | Linear cache scan; matches `md5(String(nodeId))` against hash |
| getThumbnailHash | (nodeId) => string | thumbnailService.js | MD5 hash of the numeric `fileNodeId` string: `md5(String(nodeId))` |
| signThumbnailToken | (nodeId) => string | thumbnailService.js | JWT sign over the nodeId-derived hash |
| verifyThumbnailToken | (token, hash) => boolean | thumbnailService.js | JWT verify; unchanged mechanics |
| generateImageThumbnail | (nodeId) => Promise\<Object\|null\> | imageProcessor.js | Sharp-based resize; reads bytes via `blobStorageService.downloadBlob(nodeId)` |
| generateVideoThumbnail | (nodeId) => Promise\<Object\|null\> | videoProcessor.js | FFmpeg frame extraction + sharp; reads bytes via `blobStorageService.downloadBlob(nodeId)` |
| initFfmpegOnce | () => Promise\<Object\> | videoProcessor.js | One-time ffmpeg availability check |
| getFfmpegStatus | () => object | videoProcessor.js | ffmpeg state object |

### 2.3 CacheAdapter Integration

- Thumbnail cache uses `CacheAdapter` interface (injected via `thumbnailService.js`, shared singleton via `getThumbnailCacheAdapter()`)
- Cache key: `thumb:<fileNodeId>` (numeric nodeId string)
- FIFO eviction: oldest entry deleted when cache reaches MAX_CACHE_SIZE (1000)
- `thumbnailCache` Map no longer exported directly

### 2.4 Dependencies

- sharp, fluent-ffmpeg
- `blobStorageService` — `downloadBlob(fileNodeId)` (replaces webdav `getFileContents`)
- THUMBNAIL_TOKEN_SECRET, FFMPEG_PATH
- CacheAdapter (injected)

### 2.5 Mock Targets

- sharp, ffmpeg
- `blobStorageService.downloadBlob`
- fs, child_process
- CacheAdapter (mock for tests)

### 2.6 Verification Scenarios

- [ ] Image thumbnail via sharp (nodeId → bytes via `blobStorageService.downloadBlob`)
- [ ] Video thumbnail via ffmpeg (nodeId → bytes via `blobStorageService.downloadBlob`)
- [ ] Cache keyed `thumb:<nodeId>`; `getThumbnailHash` = `md5(String(nodeId))`
- [ ] Token verify (hash round-trip)
- [ ] Cache behavior via CacheAdapter (FIFO, max 1000)

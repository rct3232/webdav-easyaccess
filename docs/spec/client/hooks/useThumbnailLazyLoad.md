# useThumbnailLazyLoad Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | IntersectionObserver-based thumbnail lazy loading. Filters image/video files, requests batch via requestThumbnailsBatch, calls onThumbnailsLoaded. Debounced. |
| Used by components/pages | FileList, FileGrid |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useThumbnailLazyLoad.js`
- **Test file:** `client/src/hooks/__tests__/useThumbnailLazyLoad.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| files | array | Y | File list |
| onThumbnailsLoaded | function | N | Callback (thumbnailMap) |
| options | object | N | { shareToken } |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| containerRef | ref | Container ref (optional) |

### 2.4 Dependencies

- requestThumbnailsBatch
- getFileType (isImageOrVideoFile)

### 2.5 Side Effects

- IntersectionObserver on visible image/video files
- requestThumbnailsBatch (debounced DEBOUNCE_MS)
- onThumbnailsLoaded(thumbnailMap)

### 2.6 Error Handling

- console.error on fail
- requestedPathsRef prevents re-request

### 2.7 Verification Scenarios

- [ ] Only image/video files observed
- [ ] requestThumbnailsBatch called
- [ ] onThumbnailsLoaded with Map
- [ ] Debouncing

### 2.8 Edge Cases

- pendingRequestRef prevents concurrent
- ROOT_MARGIN for preload

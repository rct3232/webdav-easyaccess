# thumbnails routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/thumbnails` |
| Role | Public thumbnail by hash and extension. No auth required. |
| Status | **Phase 2 relocated** — Moved from `server/routes/thumbnails.js` to `server/domains/thumbnails/routes.js` |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/thumbnails/routes.js`
- **Test file:** `server/domains/thumbnails/routes/__tests__/thumbnails.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/:hash.:ext` | None | Thumbnail image. |

### 2.3 Middleware Used

- None

### 2.4 Request/Response Spec

- **GET /:hash.:ext:** 200: image blob (e.g. jpeg, png). 404 if not found.

### 2.5 Dependencies

- `./services/thumbnailService` — `findCachedThumbnailByHash`, `getThumbnailHash`, `verifyThumbnailToken`

### 2.6 Related Documents

- [api.md](../../../api.md), thumbnail service

### 2.7 Integration Test Scenarios

- [ ] Returns image for valid hash.ext
- [ ] 404 for invalid hash

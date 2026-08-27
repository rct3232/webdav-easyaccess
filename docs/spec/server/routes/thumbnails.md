# thumbnails routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/thumbnails` |
| Role | Authed batch thumbnail URL resolution keyed by `fileNodeId` (`POST /batch`) plus public single-thumbnail serving by hash and extension (`GET /:hash.:ext`, signed token in query). |
| Status | **Phase 2 relocated** — Moved from `server/routes/thumbnails.js` to `server/domains/thumbnails/routes.js`. **Phase 4 nodeId migration** (target contract, pending implementation in S1) — batch keyed by `nodeId`; authed single route `GET /thumbnail/:hash` removed. |

---

## 2. Implementation Spec

### 2.1 File Path

Two modules are mounted under `/api/thumbnails` (`server/index.js`):

| Module | Source File | Endpoints |
|--------|-------------|-----------|
| Public single | `server/domains/thumbnails/routes.js` | `GET /:hash.:ext` |
| Authed batch | `server/domains/thumbnails/routes/thumbnailRoutes.js` | `POST /batch` |

- **Test file:** `server/domains/thumbnails/routes/__tests__/thumbnails.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/batch` | Token or share | Batch thumbnail URL resolution by `nodeId`. Body: `{ nodeIds: number[] }` → `{ thumbnails: [{ nodeId, thumbnailUrl }] }`. |
| GET | `/:hash.:ext` | None (signed `token` query required) | Single thumbnail image by hash and extension. |
| ~~GET~~ | ~~`/thumbnail/:hash`~~ | ~~Auth~~ | **Removed** — authed single-thumbnail serving is consolidated into the public `GET /:hash.:ext` route. |

### 2.3 Phase 4 nodeId Contract

- `POST /batch` accepts `nodeId` exclusively. Path strings are never accepted in request payloads.
- Read permission is enforced per node via `aclService.checkFilePermission(principalId, fileNodeId, READ)`; nodes the caller cannot read are skipped.

### 2.4 Middleware Used

- `authenticateTokenOrShare`, `requireAuth` — POST `/batch`
- `verifyThumbnailToken` — GET `/:hash.:ext`

### 2.5 Request/Response Spec

- **POST /batch:** Body `{ nodeIds: number[] }` (required, non-empty array of integers; 400 otherwise). Each `fileNodeId` is permission-checked via `aclService.checkFilePermission(principalId, fileNodeId, READ)`; unauthorized nodes are filtered out before generation. Response 200: `{ thumbnails: [{ nodeId, thumbnailUrl }] }` — one entry per processed node; `thumbnailUrl` is `null` when generation fails (unsupported type, FFmpeg unavailable, blob download failure).
- **GET /:hash.:ext:** 200: image blob (e.g. jpeg, png). 401 if the query `token` is missing, invalid, or expired. 404 if the hash is not cached or the extension does not match.

### 2.6 Dependencies

- `./services/thumbnailService` — `findCachedThumbnailByHash`, `getThumbnailHash`, `verifyThumbnailToken`, `ensureThumbnailsBatch`
- `../../permissions/services/aclService` — `checkFilePermission`
- `../../../utils/auth` — `authenticateTokenOrShare`

### 2.7 Related Documents

- [api.md](../../../api.md), [ARCHITECTURE.md](../../../ARCHITECTURE.md), thumbnail service

### 2.8 Integration Test Scenarios

- [ ] Returns image for valid hash.ext
- [ ] 404 for invalid hash
- [ ] POST /batch returns nodeId-keyed thumbnail URLs (`{ thumbnails: [{ nodeId, thumbnailUrl }] }`)
- [ ] POST /batch skips nodes the caller cannot read
- [ ] `GET /thumbnail/:hash` returns 404 (route removed)

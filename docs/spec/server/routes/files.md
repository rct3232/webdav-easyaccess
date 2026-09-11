# files routes Spec (Phase 6 Domain Split)

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mount path | `/api/files`                                                                                                                                                                                                                                                                   |
| Role       | File and folder operations: list, download, upload, rename, batch move/copy/delete, metadata, conflicts, thumbnails, bulk job status. Post-Phase 4, all routes accept `nodeId` exclusively; path strings are display-only in responses and never accepted in request payloads. |

---

## 2. Implementation Spec

### 2.1 File Path (Post-Phase 6)

The monolithic `server/routes/files.js` was split into domain-bounded modules:

| Route Module         | Source File                        | Mount Point  | Endpoints                                                                                                   |
| -------------------- | ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| CRUD operations      | `domains/files/routes/crud.js`     | `/api/files` | check-conflicts, metadata, list, ancestors, download, upload, rename, resolve-path                          |
| Batch operations     | `domains/files/routes/batch.js`    | `/api/files` | batch-delete, batch-move, batch-copy, bulk-operation/:jobId, :jobId/cancel                                  |
| Preview & thumbnails | `domains/files/routes/preview.js`  | `/api/files` | preview-ticket, preview-stream, download-multiple, download-progress/:id, thumbnail/:hash, thumbnails/batch |
| Version history      | `domains/files/routes/versions.js` | `/api/files` | versions (browse), versions/restore, versions/download (S3 storage mode only)                               |

- **Test file:** `server/domains/files/__tests__/files.test.js` (relocated from routes)
- **Services:** `domains/files/services/` — conflictResolver, batchOperationService, fileService, versionsService
- **Stores:** `domains/files/stores/operationProgress.js`

### 2.2 Route List

| Method | Path                 | Request Payload (nodeId only)                                                                                                                                                                                                                                                                                                                                                                 | Response                                                                                                                                                               |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/list`              | Query: `nodeId` (required); `?nodeId=5`; missing/invalid → 400                                                                                                                                                                                                                                                                                                                                | Each item: `{ nodeId, display_path, ... }`                                                                                                                             |
| POST   | `/metadata`          | Body: `{ nodeIds[] }` (≤ `METADATA_PATHS_LIMIT`); powers the recent/shared listing enrichment; nodes without read permission are silently skipped                                                                                                                                                                                                                                              | `[{ nodeId, name, type, size, lastmod, mime }]` — `size`/`mime` from `filecache` (null for directories and nodes without a cache row)                                  |
| GET    | `/ancestors`         | Query: `nodeId` (required); missing/invalid → 400; 404 `files.notFound` if the node does not exist                                                                                                                                                                                                                                                                                            | `{ ancestors: [{ nodeId, name }] }` ordered root→current (current node last, including itself)                                                                         |
| GET    | `/download`          | Query: `nodeId` (required); `?nodeId=5`; 404 if not found                                                                                                                                                                                                                                                                                                                                     | File buffer + `X-Node-ID` header                                                                                                                                       |
| POST   | `/upload`            | multipart + `parentNodeId`; file field; overwrite via `onConflict: 'overwrite'` against `(parent_id, name)`                                                                                                                                                                                                                                                                                   | `{ nodeId, display_path }`; `{ nodeId, skipped: true }` for skip                                                                                                       |
| PUT    | `/rename`            | Body: `{ nodeId, newName }` — `sourceNodeId` replaces prior design                                                                                                                                                                                                                                                                                                                            | `{ nodeId, new_display_path }`                                                                                                                                         |
| POST   | `/batch-move`        | Body: `{ moves[] }`; moves = `{ sourceNodeId, destinationParentNodeId }`                                                                                                                                                                                                                                                                                                                      | jobId; results keyed by nodeId                                                                                                                                         |
| POST   | `/batch-copy`        | Body: `{ copies[] }`; copies = `{ sourceNodeId, destinationParentNodeId, newName? }`; S3 copy = copy-on-write + filecache metadata mirror (via `fileService.copyFile`)                                                                                                                                                                                                                        | jobId; results keyed by nodeId                                                                                                                                         |
| POST   | `/batch-delete`      | Body: `{ nodeIds[] }`; `nodeIds` array (no `paths`). Each item **trashes** the subtree via `fileService.deleteNode` (DEF-16 P2): every row of node + descendants is marked `deleted_at`; WebDAV mode performs ONE remote MOVE of the subtree root to `/.wea-trash/<nodeId>` (destination-exists → item error `files.trashTargetExists`; MOVE failure → item marked `orphaned_node`, trash aborted); S3 mode: zero physical I/O | jobId; deleted nodeIds                                                                                                                                                 |
| POST   | `/download-multiple` | Body: `{ nodeIds[], downloadId }`; `nodeIds` array (no `paths`)                                                                                                                                                                                                                                                                                                                               | Unchanged (ZIP stream)                                                                                                                                                 |
| POST   | `/resolve-path`      | Body: `{ path }` (string, required); 400 if missing/not a string                                                                                                                                                                                                                                                                                                                              | `{ nodeId }`; 404 `files.notFound` if the path does not resolve                                                                                                        |
| GET    | `/versions`          | Query: `nodeId` (required, flat nodeId style). S3 storage mode only                                                                                                                                                                                                                                                                                                                           | `{ nodeId, currentVersionNumber, versions: [{ versionNumber, status, createdAt, size, isCurrent }] }` — storage internals (`s3_key`, `storage_backend`, `id`) stripped |
| POST   | `/versions/restore`  | Body: `{ nodeId, versionNumber }` — token-only (no share); write perm                                                                                                                                                                                                                                                                                                                         | `{ messageCode: files.versionRestored, nodeId, restoredVersionNumber }`                                                                                                |
| GET    | `/versions/download` | Query: `nodeId`, `versionNumber` (both required). Attachment-only                                                                                                                                                                                                                                                                                                                             | Blob with `Content-Type: application/octet-stream` + `Content-Disposition: attachment`                                                                                 |
| GET    | `/trash`             | Query: `parentId?` (trashed-folder navigation), `limit` (default 50), `offset` (default 0) — pagination over the caller-visible trashed rows                                                                                                                                                                                                                                                  | `{ items: [{ nodeId, name, type, size, deletedAt, displayPath, hasReadPermission, hasWritePermission, hasAdminPermission }], total }`                                 |
| POST   | `/trash/restore`     | Body: `{ nodeId }` — token-only (no share); write perm on the node + live parent                                                                                                                                                                                                                                                                                                              | `{ messageCode: files.trashRestored, nodeId, restoredNodes: number[], finalPath }`                                                                                     |
| POST   | `/trash/purge`       | Body: `{ nodeId }` — token-only (no share); delete perm (write, admin bypasses); node must be trashed → 409 `files.notTrashed`                                                                                                                                                                                                                                                                | `{ messageCode: files.trashPurged, nodeId, purgedNodes, deletedBlobs }`                                                                                                |
| POST   | `/trash/empty`       | No body — ADMIN-only (403 for non-admin)                                                                                                                                                                                                                                                                                                                                                      | `{ purgedNodes, purgedBlobs, errors: [] }`                                                                                                                             |

#### Mutation channels

Single-node mutations do **not** have dedicated endpoints (the former `POST /move`, `POST /copy`
and `DELETE /delete` routes were removed). The batch job endpoints are the canonical mutation
channel for one item or many: `POST /api/files/batch-move`, `POST /api/files/batch-copy` and
`POST /api/files/batch-delete` return **202 + `{ jobId }`**, the async bulk worker executes the
operation, and clients poll `GET /api/files/bulk-operation/:jobId` until a terminal status
(`completed` / `failed` / `cancelled`) with per-item `results`. The batch worker delegates to the
same `fileService.moveNode` / `copyFile` / `deleteNode` methods the removed routes called
(`fileService` itself stays the single implementation seam, also used by the trash routes and the
repair channel).

#### Trash routes (`domains/files/routes/trash.js`, DEF-16 P2/P3/P9 companion)

`GET /api/files/trash` — permission-based (NOT admin-only). Returns the trashed nodes **visible to
the caller**: a trashed row is visible iff the caller has WRITE permission on it (permission rows
survive the trash) or is an admin; per-row `hasReadPermission`/`hasWritePermission`/`hasAdminPermission`
flags are computed like `listDirectoryWithPermissions` (admin bypass → all true; ownership via
`ownerNodeResolver` + explicit admin grants otherwise). Each row carries `size` (filecache-backed —
real byte count for files, null for directories and cache-less rows) plus `deletedAt` and the
`displayPath` (original path — path resolution is trash-aware, so a trashed subtree root resolves
its full pre-trash path). **Hierarchical navigation:** WITHOUT `parentId` the route returns only the
TOPMOST trashed rows (deleted_at ≠ NULL AND the parent is live-or-NULL — never the full flat
subtree list; the former flat `getTrashedNodes` enumeration was retired — topmost + hierarchical reads cover the GC/empty paths). With `parentId` = an existing node id
(404 `files.notFound` when unknown), the route returns that node's trashed children
(`getTrashChildren`) — the trash view navigates into trashed folders. `limit` (default 50, capped
at 200) / `offset` query params paginate the caller-visible set; `total` is the caller-visible
count before pagination. Share-token access is refused (403, `requireTokenNotShare` — the trash
view is a per-user surface, never share-scoped); unauthenticated → 401.

`POST /api/files/trash/restore` — `{ nodeId }`. Share tokens refused 403; unauthenticated 401.
Gates in order (in `trashService.restoreNode`): node exists among trashed-aware reads
(404 `files.notFound`), node is trashed (409 `files.notTrashed`), write permission on the node
(403 `files.permissionDenied`, admin bypasses), write permission on the first LIVE ancestor folder
when it exists (move-dest precedent, 403). OS-recycle-bin semantics: trashed ANCESTORS are
auto-restored deepest-chain-first (topmost trashed ancestor → target; siblings of each restored
ancestor stay trashed), then the target's whole subtree is untrashed; name collisions against LIVE
siblings at every restore boundary auto-suffix `name (2).ext` (`resolveRestoreName` — live siblings
only, never `conflictResolver`); WebDAV mode MOVEs each row's own `/.wea-trash/<id>` entry back to
its resolved display path before the single all-or-nothing DB TX (rename + untrash). Response:
`{ messageCode: files.trashRestored, nodeId, restoredNodes, finalPath }`.

`POST /api/files/trash/purge` — `{ nodeId }`. Share tokens refused 403. Gates: node must be
trashed (409 `files.notTrashed`); delete perm = the same write check a hard-delete requires today
(`checkFilePermission`, admin bypasses — owners and write-grantees purge their own items) → 403.
Physical: WebDAV deletes the row's `/.wea-trash/<nodeId>` path (plus the covered-by-ancestor
trash path when the row sits inside a still-trashed subtree) best-effort; S3 `deleteBlob`s every
object_map row of the subtree (active + history + orphaned — version rows die with the trash);
then the DB hard delete FK-cascades object_map/filecache/closure/permission/share/recent rows.
Response: `{ messageCode: files.trashPurged, nodeId, purgedNodes, deletedBlobs }`.

`POST /api/files/trash/empty` — ADMIN-only (403 for non-admin; share tokens refused). Purges all
topmost trashed items through the same purge core, best-effort per node. Response:
`{ purgedNodes, purgedBlobs, errors: [] }`.

#### Version history routes (`domains/files/routes/versions.js`, DEF-11)

S3 storage mode only (WebDAV has no version rows). Share-token access is refused on all three
endpoints (past-content disclosure guard): `authenticateTokenOrShare` + `requireTokenNotShare`
→ share principal receives 403 `files.accessDenied`.

- **`GET /api/files/versions?nodeId=`** — browse. Read permission on the node, 404-masqueraded
  (no permission / unknown node → 404 `files.notFound`, identical to `downloadFile`). Rows come
  from `fileNodesStore.getVersionsByNode` (`active` + `history`, `version_number` DESC);
  per-row `size` is a `blobStore.headBlob` probe (probe failure → `size: null`); responses strip
  `s3_key`/`storage_backend`/`id` internals. `isCurrent` marks the `active` row;
  `currentVersionNumber` is the active row's version (null when the node has no active row).
- **`POST /api/files/versions/restore`** — `{ nodeId, versionNumber }`. Gates in order: write
  permission (403 `files.permissionDenied`), WebDAV storage mode (409 `files.versionRestoreUnavailable`,
  `reason: 'version restore is available in s3 storage mode only'`), node stuck `pending_upload`
  (409 `files.versionRestoreUnavailable`, `reason: 'node_pending_upload'`), version exists among
  `active`+`history` rows (404 `files.versionNotFound`), target blob present via `headBlob`
  (409 `files.versionBlobMissing`). Effect (one TX): `reactivateObjectMapRow(historyRow.id)`
  (guard `IN ('history','orphaned')`) + `demoteActiveToHistory(current.s3_key)` + node → `active`;
  after the TX the filecache is re-asserted from the blob HEAD (`repair-complete` precedent,
  `content_hash` null) and the thumbnail cache entry is evicted (`thumbnailService.invalidate`).
  NO new version row is created (row count unchanged); the previous current version is ALWAYS kept
  (demoted to `history` — deletion stays the repair channel's job). Restoring the version that is
  already current is an idempotent no-op (200). The response message code is
  `files.versionRestored`.
- **`GET /api/files/versions/download`** — serves an arbitrary version's blob **attachment-only**
  (`Content-Type: application/octet-stream`, `Content-Disposition: attachment`) — sidesteps the
  mime-changed-between-versions class. Read permission, 404-masquerade; version must exist among
  `active`+`history` (404 `files.versionNotFound`); blob absence → 404 `files.notFound` (a download
  of missing content is a plain miss, not a repairable conflict). The sent filename is the node's
  display name.

### 2.3 Phase 4 nodeId Contracts

**All endpoints accept `nodeId` exclusively.** Path strings are display-only in responses and are never accepted in request payloads. Response objects include `nodeId` field for every file/folder entry.

**Exception — `POST /resolve-path`:** the sole path-accepting endpoint. It is a legacy-URL/boostrap resolver (deep-link + share-link fallback for nodeId-first navigation) exposing `fileNodeService.resolvePath(path)`. It returns `{ nodeId }` for a resolvable path and 404 `files.notFound` otherwise. No other path-based endpoints may be added (Execution Rule 13).

#### Route Module Mapping (Post-Phase 4)

Route handlers delegate to `fileService` instead of calling WebDAV directly. No path fallback anywhere — nodeId is mandatory.

| Module       | Endpoints                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `crud.js`    | list, ancestors, download, upload, rename, resolve-path, check-conflicts, metadata                |
| `batch.js`   | batch-move, batch-copy, batch-delete, bulk-operation/:jobId, cancel                               |
| `preview.js` | preview-ticket, preview-stream, download-multiple, download-progress, thumbnail, thumbnails/batch |
| `trash.js`   | trash (GET), trash/restore, trash/purge, trash/empty                                              |

#### Middleware Removal

- `normalizePathParam` middleware is deleted in Task 4.8. Routes validate `nodeId`/`parentNodeId` as positive integers (400 on missing/invalid).

### 2.4 Middleware Used

- `authenticateTokenOrShare`, `authenticateToken`, `requireUser`, `requireAuth`
- ~~`normalizePathParam`~~ — removed in Phase 4; replaced by nodeId integer validation at route level.

### 2.5 Test Mock Strategy

- Routes run with Supertest + service mocks injected through the composition root (`server/service/composition.js`): `fileNodeService`, `blobStorageService`, `aclService`, `uploadService`. Do NOT mock the WebDAV adapter at route level. Defaults are deterministic success (e.g. `listDirectory` returns two children; `downloadBlob` returns a small stub buffer). Failure scenarios (404, conflict, permission-denied) are per-test overrides (`mockResolvedValueOnce`/`mockRejectedValueOnce`). Worker internals (batch) are tested as unit tests; routes assert only API contract (status/body).

### 2.6 Request/Response Spec

- List, download, metadata, download-multiple, thumbnails: support share token (header/query)
- All request payloads use nodeId-based fields post-Phase 4 (`nodeId`, `parentNodeId`, `destinationParentNodeId`, `sourceNodeId`, `nodeIds`). Path strings are never accepted in request bodies.
- **preview-ticket / preview-stream (video preview streaming):**
  - Purpose: allow `<video src>` to load video preview without custom headers (browser cannot set `Authorization` header on `<video src>`).
  - `POST /preview-ticket`: validates `nodeId` references an existing file, caller has read permission, and file type is `video`. Returns `{ ticket }`.
  - `GET /preview-stream`: validates `{ nodeId, ticket }` and responds with `Content-Disposition: inline` + `Content-Type` derived from filename.
  - Tickets are short-lived (e.g. 60–120s) and must not embed JWT in query params.
- **GET /list:** When `user.is_admin`, items are not filtered by permission (admin bypass); each item's read permission is also treated as true for admin. Non-admin: permission-based filter as before.
- Bulk ops: returns jobId; poll via bulk-operation
- Upload 413 (payload too large): body-parser 또는 서버 제한; 413 반환
- download-multiple nodeIds 빈 배열: 400 (validation)
- download-multiple: POST returns 200 with ZIP stream (application/zip) directly. Client sends optional `downloadId` in body; server writes progress to `downloadProgress` map under that ID. Progress is polled via GET /download-progress/:id. Does not return 202+downloadId.
- bulk-operation/:jobId 존재하지 않음: 404
- Share token + write 요청(rename, batch-move 등): 403 (share는 read-only)

### 2.7 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.8 Integration Test Scenarios

- [ ] List returns files with correct permissions
- [ ] Download returns blob
- [ ] Upload accepts multipart
- [ ] PUT /rename: nodeId, newName required; validation errors (400 on missing/invalid nodeId)
- [ ] POST /check-conflicts returns conflicts array

- [ ] POST /metadata with shareToken
- [ ] POST /metadata returns real `size`/`mime` from filecache (not hardcoded null)
- [ ] POST /batch-copy (S3 mode): copied node gets a filecache row mirroring the source (list shows real size)
- [ ] POST /bulk-operation/:jobId/cancel returns 200
- [ ] Batch move/copy return 202 + jobId (API contract only; worker execution covered by batchOperationService unit tests)
- [ ] Share token allows list/download for valid token
- [ ] Upload 413 when payload too large
- [ ] download-multiple 빈 nodeIds → 400
- [ ] bulk-operation 404 for invalid jobId

- [ ] Share token write 요청 → 403

- [ ] GET /versions: strips storage internals (s3_key/storage_backend/id absent), newest version first, active row flagged isCurrent
- [ ] GET /versions: 404-masquerade for no-read-permission and unknown node; share token → 403
- [ ] POST /versions/restore: history→active + active→history swap, no new row, cache re-asserted, thumbnail invalidated; 403/404/409 boundaries (no write perm, unknown version, WebDAV mode, stuck node, missing blob)
- [ ] GET /versions/download: attachment-only octet-stream of the requested version; 404 for unknown version/no-permission

- [ ] GET /trash: without parentId returns topmost trashed rows only (nested trashed children hidden); with parentId returns the trashed children of that node; unknown parentId → 404; share token → 403
- [ ] POST /trash/restore: owner restore round-trips (content intact); auto-restores trashed ancestors; suffixed name on live-sibling collision; siblings of restored ancestors stay trashed; 409 notTrashed on a live node; 403 without write perm; share token → 403
- [ ] POST /trash/purge: owner purge OK (rows gone + FK cascade); read-only grantee → 403; live node → 409 notTrashed; share token → 403
- [ ] POST /trash/empty: admin purges everything trashed; non-admin → 403; share token → 403

### 2.9 folders.js nodeId Contracts

Route module: `domains/files/routes/folders.js` — mounted at `/api/folders` (`server/index.js:178`), **not** under `/api/files`. Both endpoints are nodeId-only; no path fallback.

#### POST `/api/folders/create` — Create Directory

**Request Body:** `{ parentNodeId: number, name: string }`

- `parentNodeId`: target parent directory node ID (required, positive integer)
- `name`: folder display name (required, non-empty string)
- Missing/invalid → 400 error

**Permission Gate:** Non-admin users checked via `aclService.checkFolderPermission(principalId, parentNodeId, PERMISSIONS.WRITE)` before creation. Admin users bypass.

**Response:** `{ messageCode, nodeId, name, path }` — includes created directory's nodeId, name, and resolved display path via `fileNodeService.getNodePath(dir.id)`. A duplicate-name check against siblings returns 409 conflict.

> **No self-grant:** Folder creation no longer writes a `permissions_user_paths` row for the creator. The creator already owns the folder through the home-root `ADMIN` grant (closure-table ancestor inheritance) and the owner exception in [permissions.md](../../../features/permissions.md#owner-exception). Self-grants on own folders were removed because they are redundant ACL state that leaked into the "shared with me" listing.

**Server Flow:**

1. Validate `parentNodeId` (positive integer) and `name` (non-empty); 400 if missing/invalid
2. Permission check on parent folder
3. Check for name conflicts among siblings via `fileNodeService.listDirectory(parentNodeId)` — 409 if duplicate exists
4. Call `fileNodeService.createDirectory(parentNodeId, name)` → returns new node with `.id`
5. Resolve display path via `fileNodeService.getNodePath(dir.id)`
6. Return `{ nodeId: dir.id, name: dir.name, path: display_path }`

#### GET `/api/folders/stats` — Folder Statistics

**Query Parameter:** `?nodeId=10` (replaces prior `?path=/folder`)

- `nodeId`: target folder node ID (required, positive integer)
- Missing/invalid → 400 error

**Permission Gate:** Non-admin users checked via `aclService.checkFolderPermission(principalId, dirNodeId, PERMISSIONS.READ)`. Admin users bypass.

**Response:** `{ nodeId, name, totalFiles, totalFolders, totalSize }` — computed via closure table descendant queries and aggregated file node sizes instead of recursive WebDAV probes. `totalSize` sums the per-file `size` exposed by `fileNodesStore.getNode` (filecache LEFT JOIN); trashed descendants contribute 0 (`getNode` is a live-row read).

**Server Flow:**

1. Validate `nodeId` (positive integer); 400 if missing/invalid
2. Permission check: read access on target folder
3. Verify node exists and is type `'directory'`; 400 otherwise
4. Query descendants via `fileNodeService.getDescendantIds(dirNodeId)` then iterate each child to count files/folders and sum sizes
5. Return aggregate stats object including nodeId

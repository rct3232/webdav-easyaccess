# permissions routes Spec

## 1. Overview

| Item       | Description                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/permissions`                                                                                                                                                    |
| Role       | Folder and file permissions: grant, revoke, list by user/folder, check effective permission. All operations use `nodeId` (BIGINT) references instead of path strings. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Route index:** `server/domains/permissions/routes/index.js` (re-exports from modules below)
- **Folder permissions:** `server/domains/permissions/routes/folderPermissions.js` (`POST /grant`, `DELETE /revoke`, `GET /user/:userId`, `GET /shared`, `GET /folder`)
- **File permissions:** `server/domains/permissions/routes/filePermissions.js` (`POST /file/grant`, `DELETE /file/revoke`, `PATCH /file`, `GET /file/check`, `GET /file/list`)
- **Queries:** `server/domains/permissions/routes/queries.js` (`GET /check`)
- **Existence index helper:** `server/domains/permissions/stores/permissionExistenceIndex.js`
- **Test file:** `server/domains/permissions/routes/__tests__/permissions.test.js`

### 2.2 Route List

| Method | Path            | Auth  | Description                                                                                           |
| ------ | --------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| POST   | `/grant`        | Token | Grant permission. Body: nodeId, userId, permission, targetType?                                       |
| DELETE | `/revoke`       | Token | Revoke. Query: userId, nodeId, scope?                                                                 |
| GET    | `/user/:userId` | Token | List permissions for user.                                                                            |
| GET    | `/shared`       | Token | List current user's "shared with me" permissions (own subtree excluded), including `name` and `type`. |
| GET    | `/folder`       | Token | List permissions for folder. Query: nodeId, fileNodeId?                                               |
| GET    | `/check`        | Token | Check current user permission. Query: nodeId.                                                         |
| POST   | `/file/grant`   | Token | Grant file-level permission. Body: userId, fileNodeId, permission.                                    |
| DELETE | `/file/revoke`  | Token | Revoke file-level permission. Query: userId, fileNodeId.                                              |
| PATCH  | `/file`         | Token | Update file-level permission. Body: userId, fileNodeId, permission.                                   |
| GET    | `/file/check`   | Token | Check file permission. Query: fileNodeId.                                                             |
| GET    | `/file/list`    | Token | List file permissions. Query: nodeId? (parent directory)                                              |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`

> **Removed:** `normalizePathParam` — node IDs are opaque integers requiring no normalization.

### 2.4 Request/Response Spec

#### POST `/grant`

- **Body:** `{ nodeId: BIGINT, userId: BIGINT, permission: string, targetType?: 'file' | 'directory' }`
- `targetType` defaults to `'directory'`; when `'file'`, grants a file-level permission on the node

#### DELETE `/revoke`

- **Query:** `?userId=<BIGINT>&nodeId=<BIGINT>&scope=?`
- `scope`: optional; `'pathOnly'` for file-level revoke (revokes only direct grant, not inherited)

#### GET `/folder`

- **Query:** `?nodeId=<BIGINT>&fileNodeId=<BIGINT>`
- Returns permissions granted on the directory identified by `nodeId`; if `fileNodeId` is provided, returns only entries relevant to that specific file within the folder

#### GET `/check`

- **Query:** `?nodeId=<BIGINT>`
- Returns `{ hasRead: boolean, hasWrite: boolean, source: string }` for current user on the target node

#### GET `/shared`

- **Auth:** Token + user (admin returns `[]`)
- **Purpose:** authoritative "shared with me" listing for the sidebar tree and `/files/__shared__` view.
- Resolves the current user's home root node (`fileNodesStore.getUserRootNode`) and returns every grant where the user is the grantee **and the node is not inside the user's own subtree** (home root + all descendants, resolved via the `node_ancestors` closure table).
- **Response:** `[{ nodeId: BIGINT, name: string, permission: string, type: 'file' | 'directory' }]`. `name` is the real node name from `file_nodes`; no `node-<id>` placeholders.
- Same existence-index filtering semantics as `GET /user/:userId` (§2.4.3).

### 2.4.1 Validation

- grant: `nodeId`, `userId`, `permission` are required; otherwise `400`
- check: `nodeId` is required; otherwise `400`
- revoke: `userId`, `nodeId` are required; otherwise `400`
- grant to self is allowed (effectively no-op or same-permission update)

### 2.4.2 Node ID Validation

All `nodeId` and `fileNodeId` parameters must correspond to an existing row in `file_nodes`. If the referenced node does not exist, the route returns `404 Not Found` before proceeding with permission logic. This validation applies to all routes accepting nodeId parameters: `/grant`, `/revoke`, `/check`, `/folder`, `/file/grant`, `/file/revoke`, `/file/check`, `/file/list`.

### 2.4.3 `GET /user/:userId` Fast-Path Semantics

- Route returns ACL records using a fast path and avoids per-row existence checks in the request hot path.
- Existence state is read from index/cache with three states:
  - `exists`: node confirmed present by fresh evidence
  - `missing`: node confirmed absent by fresh evidence
  - `unknown`: state not fresh enough to decide
- Response rules:
  - `exists` entries are returned.
  - `unknown` entries remain visible until reconciliation confirms missing.
  - `missing` entries are excluded only when evidence freshness is valid.
- Public response schema remains backward-compatible.

### 2.4.4 Conditional Gate (`If-None-Match` / `304`)

- Route computes ETag using:
  - permission document `updated_at`
  - existence-index version marker
- If `If-None-Match` equals computed ETag, route returns `304 Not Modified` early.
- Early `304` must happen before expensive permission shaping/reconciliation work.

### 2.4.5 Reconciliation and Invalidation

- Stale or absent index entries schedule non-blocking reconciliation jobs.
- Reconciliation runs with bounded concurrency and must not block the API response path.
- Route maintains an in-memory existence index keyed by node ID:
  - persisted shape: `{ state: 'exists'|'missing', checkedAt: epochMs }`
  - `unknown` is a read-time derived state used when entry is missing or stale
  - freshness window: configured by env (default short TTL), stale entries treated as `unknown`
- While state is `unknown`, route keeps the ACL row visible and only enqueues refresh.
- ACL mutation routes invalidate affected node IDs:
  - `POST /grant`
  - `DELETE /revoke`
  - `POST /file/grant`
  - `DELETE /file/revoke`
  - `PATCH /file`
- Invalidation is also wired at ACL-store mutation points so non-route callers keep index consistency.
- File-system mutation integrations (move/copy/delete flows) can also invalidate affected node IDs via CASCADE or explicit invalidation.
- Env knobs:
  - `PERMISSIONS_EXISTENCE_INDEX_TTL_MS` (freshness window)
  - `PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY` (bounded concurrent checks)

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Grant/revoke require ownership or admin
- [ ] Check returns correct hasRead, hasWrite
- [ ] grant missing `nodeId`/`userId` returns `400`
- [ ] check missing `nodeId` returns `400`
- [ ] revoke followed by check removes access immediately
- [ ] nodeId referencing non-existent file_node returns `404`
- [ ] `GET /user/:userId` does not perform N-permission synchronous WebDAV checks
- [ ] stale index entries enqueue reconciliation and still return response quickly
- [ ] only freshly confirmed missing nodes are excluded from user-visible response
- [ ] matching `If-None-Match` returns `304` before expensive read work
- [ ] performance regression guard: with many ACL rows and slow mocked node lookup, response latency stays near fast-path bound and does not scale linearly with ACL count

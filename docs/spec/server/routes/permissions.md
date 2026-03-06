# permissions routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/permissions` |
| Role | Folder and file permissions: grant, revoke, list by user/folder, check effective permission. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/permissions.js`
- **Existence index helper:** `server/store/permissionExistenceIndex.js`
- **Test file:** `server/routes/__tests__/permissions.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/grant` | Token | Grant permission. Body: folderPath, userId, permission, target? |
| DELETE | `/revoke` | Token | Revoke. Query: userId, folderPath, includeSubfolders?, scope? |
| GET | `/user/:userId` | Token | List permissions for user. |
| GET | `/folder` | Token | List permissions for folder. Query: path, includeSubfolders, filePath? |
| GET | `/check` | Token | Check current user permission. Query: path. |
| POST | `/file/grant` | Token | Grant file-level permission. |
| DELETE | `/file/revoke` | Token | Revoke file-level permission. |
| PATCH | `/file` | Token | Update file-level permission. |
| GET | `/file/check` | Token | Check file permission. |
| GET | `/file/list` | Token | List file permissions. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`, `normalizePathParam`

### 2.4 Request/Response Spec

- grant: body folderPath, userId, permission; optional target ('file')
- revoke: query userId, folderPath; optional scope ('pathOnly') for file
- check: returns hasRead, hasWrite, source

### 2.4.1 Validation

- grant: `folderPath`, `userId`, `permission` are required; otherwise `400`
- check: `path` is required; otherwise `400`
- grant to self is allowed (effectively no-op or same-permission update)

### 2.4.2 `GET /user/:userId` Fast-Path Semantics

- Route returns ACL records using a fast path and avoids per-row `pathExists` checks in the request hot path.
- Existence state is read from index/cache with three states:
  - `exists`: path confirmed present by fresh evidence
  - `missing`: path confirmed absent by fresh evidence
  - `unknown`: state not fresh enough to decide
- Response rules:
  - `exists` entries are returned.
  - `unknown` entries remain visible until reconciliation confirms missing.
  - `missing` entries are excluded only when evidence freshness is valid.
- Public response schema remains backward-compatible.

### 2.4.3 Conditional Gate (`If-None-Match` / `304`)

- Route computes ETag using:
  - permission document `updated_at`
  - existence-index version marker
- If `If-None-Match` equals computed ETag, route returns `304 Not Modified` early.
- Early `304` must happen before expensive permission shaping/reconciliation work.

### 2.4.4 Reconciliation and Invalidation

- Stale or absent index entries schedule non-blocking reconciliation jobs.
- Reconciliation runs with bounded concurrency and must not block the API response path.
- Route maintains an in-memory existence index keyed by normalized ACL path:
  - persisted shape: `{ state: 'exists'|'missing', checkedAt: epochMs }`
  - `unknown` is a read-time derived state used when entry is missing or stale
  - freshness window: configured by env (default short TTL), stale entries treated as `unknown`
- While state is `unknown`, route keeps the ACL row visible and only enqueues refresh.
- ACL mutation routes invalidate affected paths/prefixes:
  - `POST /grant`
  - `DELETE /revoke`
  - `POST /file/grant`
  - `DELETE /file/revoke`
  - `PATCH /file`
- Invalidation is also wired at ACL-store mutation points so non-route callers keep index consistency.
- File-system mutation integrations (move/copy/delete flows) can also invalidate affected prefixes.
- Env knobs:
  - `PERMISSIONS_EXISTENCE_INDEX_TTL_MS` (freshness window)
  - `PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY` (bounded concurrent checks)

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Grant/revoke require ownership or admin
- [ ] Check returns correct hasRead, hasWrite
- [ ] grant missing `folderPath`/`userId` returns `400`
- [ ] check missing `path` returns `400`
- [ ] revoke followed by check removes access immediately
- [ ] `GET /user/:userId` does not perform N-permission synchronous WebDAV checks
- [ ] stale index entries enqueue reconciliation and still return response quickly
- [ ] only freshly confirmed missing paths are excluded from user-visible response
- [ ] matching `If-None-Match` returns `304` before expensive read work
- [ ] performance regression guard: with many ACL rows and slow mocked `pathExists`, response latency stays near fast-path bound and does not scale linearly with ACL count

# permissionService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission API: list by user/folder, grant, revoke, check effective permission, file-level permissions. All operations use `nodeId` (BIGINT) instead of path strings. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/permissionService.js`
- **Test file:** `client/src/services/__tests__/permissionService.test.js`

> All permission endpoints are mounted at `/api/permissions`. The service implementation passes relative `/permissions/...`; httpClient (`BASE_URL='/api'`) resolves the absolute prefix. Treat `/api/permissions/...` as the canonical documented form.

### 2.2 Main Functions

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| getUserPermissions | (userId, options?) | Promise\<Array\> | GET /api/permissions/user/:userId |
| getSharedPermissions | () | Promise\<Array\> | GET /api/permissions/shared |
| getFolderPermissions | (nodeId, fileNodeId?) | Promise\<Array\> | GET /api/permissions/folder?nodeId=... |
| grantPermission | ({ userId, nodeId, permission, target? }) | Promise\<void\> | POST /api/permissions/grant |
| revokePermission | ({ userId, nodeId, scope? }) | Promise\<void\> | DELETE /api/permissions/revoke |
| checkPermission | (nodeId) | Promise\<Object\> | GET /api/permissions/check?nodeId=... |
| listFilePermissions | (parentNodeId?) | Promise\<Array\> | GET /api/permissions/file/list?parentNodeId=... |
| clearUserPermissionsCache | (userId?) | void | - |

- `target`: `'file'` for file-level grant; defaults to `'directory'`
- `scope`: `'pathOnly'` for file-level revoke

### 2.3 getUserPermissions shared request path

- `getUserPermissions` uses a shared client-side fetch path for the same `userId`:
  - in-flight dedupe: concurrent requests reuse one Promise
  - short TTL memoization: near-sequential requests reuse cached data without another HTTP call
- `options.forceRefresh === true` bypasses cached data and triggers a new request (while still deduping concurrent force-refresh calls for the same `userId`).
- Default usage in UI call sites should keep `forceRefresh` unset.

### 2.4 Cache invalidation

- `grantPermission` and `revokePermission` invalidate the cached user-permission entry for the target `userId` after successful mutation.
- `clearUserPermissionsCache(userId?)` supports manual invalidation:
  - with `userId`: clear only that user entry
  - without `userId`: clear all user permission cache entries

### 2.5 Removed Parameters

The following parameters are removed in Phase 4:

- **`includeSubfolders`** — server handles permission inheritance via closure table automatically; client no longer sends this parameter
- **`folderPath` / `filePath` / `path`** as request identifiers — all replaced by `nodeId` / `parentNodeId`
- Permission route contracts were already nodeId-based in Phase 3 on the server side; client params must match them exactly

#### Payload Shape Changes

| Before | After |
|---------|-------|
| `{ folderPath: '/a/b', permission: 'read' }` | `{ userId: 'u1', nodeId: 123, permission: 'read' }` |
| `{ userId: 'u1', folderPath: '/a', includeSubfolders: false }` | `{ userId: 'u1', nodeId: 123 }` |

#### Response Shape Changes

- Responses include `{ nodeId, display_path, permission }`. The canonical identifier is `nodeId`; `fileNodeId` is NOT serialized for permission-list responses.

### 2.6 Error Handling

- Errors propagated; callers use getServerErrorDisplay

### 2.7 Verification Scenarios

- [ ] getUserPermissions, getFolderPermissions return arrays
- [ ] concurrent `getUserPermissions` calls for same user are deduped to one HTTP request
- [ ] repeated `getUserPermissions` call within TTL returns cached result
- [ ] `forceRefresh` triggers fresh HTTP request
- [ ] grant/revoke invalidates affected user permission cache entry
- [ ] grantPermission with target 'file' grants file-level permission
- [ ] revokePermission with scope 'pathOnly' revokes file-level only
- [ ] checkPermission returns hasRead, hasWrite, source
- [ ] All payloads send `nodeId` (BIGINT) instead of path strings

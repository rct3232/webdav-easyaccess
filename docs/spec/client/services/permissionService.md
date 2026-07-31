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

### 2.2 Main Functions

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| getUserPermissions | (userId, options?) | Promise\<Array\> | GET /api/permissions/user/:userId |
| getFolderPermissions | (nodeId, fileNodeId?) | Promise\<Array\> | GET /api/permissions/folder |
| grantPermission | ({ userId, nodeId, permission, targetType? }) | Promise\<void\> | POST /api/permissions/grant |
| revokePermission | ({ userId, nodeId, scope? }) | Promise\<void\> | DELETE /api/permissions/revoke |
| checkPermission | (nodeId) | Promise\<Object\> | GET /api/permissions/check |
| listFilePermissions | (nodeId?) | Promise\<Array\> | GET /api/permissions/file/list |
| clearUserPermissionsCache | (userId?) | void | - |

- `targetType`: `'file'` for file-level grant; defaults to `'directory'`
- `scope`: `'pathOnly'` for file-level revoke
- `includeSubfolders` removed from all signatures — server handles descendant coverage via closure table at query time

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

### 2.5 Error Handling

- Errors propagated; callers use getServerErrorDisplay

### 2.6 Verification Scenarios

- [ ] getUserPermissions, getFolderPermissions return arrays
- [ ] concurrent `getUserPermissions` calls for same user are deduped to one HTTP request
- [ ] repeated `getUserPermissions` call within TTL returns cached result
- [ ] `forceRefresh` triggers fresh HTTP request
- [ ] grant/revoke invalidates affected user permission cache entry
- [ ] grantPermission with targetType 'file' grants file-level permission
- [ ] revokePermission with scope 'pathOnly' revokes file-level only
- [ ] checkPermission returns hasRead, hasWrite, source
- [ ] All payloads send `nodeId` (BIGINT) instead of path strings

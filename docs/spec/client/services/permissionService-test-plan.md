# permissionService Test Plan — Phase 4 nodeId Migration

## Purpose

Document the required updates to `client/src/services/__tests__/permissionService.test.js` so that all fixtures, assertions, and scenarios align with the nodeId-based contract defined in [permissionService spec](./permissionService.md).

---

## Current State Analysis

### Describe Blocks & Test Cases

| # | describe block | test case | line |
|---|---------------|-----------|------|
| 1 | `getUserPermissions` | returns array from GET /permissions/user/:userId | ~34 |
| 2 | `getUserPermissions` | dedupes in-flight calls for same userId | ~44 |
| 3 | `getUserPermissions` | returns memoized result within ttl without extra request | ~64 |
| 4 | `getUserPermissions` | fetches again with forceRefresh even within ttl | ~76 |
| 5 | `getFolderPermissions` | returns array from GET /permissions/folder with path params | ~92 |
| 6 | `getFolderPermissions` | sends includeSubfolders true and filePath when provided | ~104 |
| 7 | `grantPermission` | calls POST /permissions/grant with userId, folderPath, permission | ~116 |
| 8 | `grantPermission` | includes target "file" for file-level grant | ~132 |
| 9 | `grantPermission` | invalidates user cache after successful grant | ~150 |
| 10 | `revokePermission` | calls DELETE /permissions/revoke with params | ~170 |
| 11 | `revokePermission` | includes scope pathOnly for file-level revoke | ~184 |
| 12 | `revokePermission` | invalidates user cache after successful revoke | ~204 |
| 13 | `checkPermission` | returns object with hasRead, hasWrite, source | ~224 |
| 14 | `listFilePermissions` | returns array from GET /permissions/file/list | ~239 |
| 15 | `listFilePermissions` | sends folderPath when provided | ~249 |

### Tests Using Path-Based Fixtures (`folderPath`, `path`)

All 15 tests currently use path-based identifiers. The following tables summarize the affected fixtures:

**getUserPermissions (tests #1–#4)** — response arrays contain `{ folderPath, permission }`:
- Test #1: `[{ folderPath: '/a', permission: 'read' }]`
- Test #2: `[{ folderPath: '/shared', permission: 'read' }]`
- Test #3: `[{ folderPath: '/docs', permission: 'write' }]`
- Test #4: `{ folderPath: '/a', permission: 'read' }` → `{ folderPath: '/a', permission: 'admin' }`

**getFolderPermissions (tests #5–#6)** — params contain `path`, `includeSubfolders`:
- Test #5: `params: { path: '/docs', includeSubfolders: 'false' }`
- Test #6: `params: { path: '/docs', includeSubfolders: 'true', filePath: '/docs/file.txt' }`

**grantPermission (tests #7–#9)** — POST body contains `folderPath`:
- Test #7: `{ userId: 'u1', folderPath: '/a', permission: 'read' }`
- Test #8: `{ userId: 'u1', folderPath: '/a/file.txt', permission: 'read', target: 'file' }`
- Test #9: grant body `folderPath: '/a'`; response arrays use `folderPath`

**revokePermission (tests #10–#12)** — params contain `folderPath`, `includeSubfolders`:
- Test #10: `params: { userId: 'u1', folderPath: '/a', includeSubfolders: 'false' }`
- Test #11: `params: { userId: 'u1', folderPath: '/a/file.txt', includeSubfolders: 'false', scope: 'pathOnly' }`
- Test #12: revoke body `folderPath: '/a'`, `includeSubfolders: false`; response arrays use `folderPath`

**checkPermission (test #13)** — params contain `path`; response contains `path`:
- Request: `params: { path: '/a' }`
- Response: `{ path: '/a', hasRead: true, hasWrite: false, source: 'path' }`

**listFilePermissions (tests #14–#15)** — params contain `folderPath`:
- Test #15: `params: { folderPath: '/docs' }`

### Tests Exercising `includeSubfolders`

| Test | Current behavior | Disposition |
|------|-------------------|-------------|
| #5 (getFolderPermissions, path params) | sends `includeSubfolders: 'false'` in query | **Remove** — replaced by nodeId-only variant |
| #6 (getFolderPermissions, includeSubfolders true + filePath) | sends `includeSubfolders: 'true'`, `filePath` | **Remove** — parameter no longer exists |
| #10 (revokePermission, params) | sends `includeSubfolders: 'false'` in query | **Fix** — remove `includeSubfolders`, use `nodeId` |
| #11 (revokePermission, scope pathOnly) | sends `includeSubfolders: 'false'` in query | **Fix** — remove `includeSubfolders`, keep `scope` |

---

## Required Changes

### 1. Fixture Transformations

Every occurrence of a path-based field must be replaced with its nodeId equivalent per the spec at §2.5:

| Old fixture shape | New fixture shape |
|-------------------|-------------------|
| `{ folderPath: '/a', permission: 'read' }` | `{ fileNodeId: 42, nodeId: 42, display_path: '/a', permission: 'read' }` |
| `grant({ userId: 'u1', folderPath: '/a', permission: 'read' })` | `grant({ userId: 'u1', nodeId: 42, permission: 'read' })` |
| `revoke({ userId: 'u1', folderPath: '/a', includeSubfolders: false })` | `revoke({ userId: 'u1', nodeId: 42 })` |
| `checkPermission('/a')` → params `{ path: '/a' }` | `checkPermission(42)` → params `{ nodeId: 42 }` |
| Response `{ path: '/a', hasRead, hasWrite, source }` | Response `{ nodeId: 42, display_path: '/a', hasRead, hasWrite, source }` |
| `listFilePermissions('/docs')` → params `{ folderPath: '/docs' }` | `listFilePermissions(99)` → params `{ parentNodeId: 99 }` |

### 2. Tests to Remove

The following tests must be removed entirely because the parameters they exercise no longer exist:

- **Test #6** — `getFolderPermissions` with `includeSubfolders true and filePath`. The `includeSubfolders` parameter is eliminated; inheritance is handled server-side via closure table.
- **Test #5's includeSubfolders assertion** — if test #5 is kept, the `includeSubfolders` key must be stripped from expected params.

### 3. Tests to Modify

All remaining tests require fixture updates:

| Test | Modification |
|------|-------------|
| #1–#4 (getUserPermissions) | Replace response objects: `{ folderPath }` → `{ fileNodeId, nodeId, display_path, permission }` |
| #5 (getFolderPermissions) | Change signature to `(nodeId, fileNodeId?)`; params become `{ nodeId }` instead of `{ path, includeSubfolders }` |
| #7–#9 (grantPermission) | POST body: `{ userId, folderPath, permission }` → `{ userId, nodeId, permission }` |
| #10–#12 (revokePermission) | Query params: `{ userId, folderPath, includeSubfolders }` → `{ userId, nodeId }`; keep `scope` for file-level revoke |
| #13 (checkPermission) | Request param: `path` → `nodeId`; response adds `nodeId`, `display_path` fields |
| #14–#15 (listFilePermissions) | Param: `{ folderPath }` → `{ parentNodeId }` |

### 4. New Describe Blocks to Add

After updating the existing tests, add a new top-level describe block to cover nodeId-specific scenarios explicitly:

```
describe('permissionService — nodeId mode')
  beforeEach(() => { clearUserPermissionsCache(); jest.clearAllMocks(); });

  describe('grantPermission with nodeId')
    it('sends POST /permissions/grant with userId, nodeId, permission (no folderPath)')
      // Verify post() receives body { userId: 'u1', nodeId: 42, permission: 'read' }
      // Assert folderPath is NOT present in the body

    it('invalidates user cache after successful grant by nodeId')
      // Grant with nodeId, then verify getUserPermissions fetches fresh data

  describe('revokePermission with nodeId')
    it('sends DELETE /permissions/revoke with userId and nodeId params (no includeSubfolders)')
      // Verify del() receives params { userId: 'u1', nodeId: 42 }
      // Assert includeSubfolders is NOT present in params

    it('invalidates user cache after successful revoke')
      // Revoke by nodeId, then verify getUserPermissions fetches fresh data

  describe('checkPermission with nodeId')
    it('returns object with hasRead, hasWrite, source using nodeId param')
      // Verify get() called with params { nodeId: 42 }
      // Response includes { nodeId, display_path, hasRead, hasWrite, source }
```

---

## Execution Order

1. **Remove** test #6 (`includeSubfolders true and filePath`) — no replacement needed.
2. **Update** tests #1–#5, #7–#15 with nodeId-based fixtures (Section 3 above).
3. **Add** new `permissionService — nodeId mode` describe block (Section 4 above).
4. **Verify** all tests pass against the updated implementation.

## Success Criteria

- [ ] Zero references to `folderPath`, `includeSubfolders`, or `path` as request identifiers remain in test fixtures
- [ ] All grant/revoke/check calls use `nodeId` in requests
- [ ] Response assertions include `{ fileNodeId, nodeId, display_path }` shape
- [ ] New nodeId-mode tests confirm absence of deprecated parameters
- [ ] Full test suite passes: `npm run test:ci` in `client/`

# Phase 3 Sub-Plan: Permissions Domain → Node ID

## Design Decisions

| Item | Decision | Rationale |
|------|----------|-----------|
| Permission storage | `file_node_id` BIGINT FK references | DDL final state (Phase 0) defines all tables with `file_node_id`; no path columns remain |
| Inheritance mechanism | Closure table (`node_ancestors`) JOINs | Replaces O(n) string prefix matching (`startsWith`) with O(1) indexed lookup |
| Target type derivation | `file_nodes.type` column | No separate `target_type` or `is_directory` column needed — derivable from node itself |
| Sync checkers | Deprecated | `checkPermissionSync(doc, folderPath)` required in-memory doc; closure table requires DB query. All checks become async |
| Owner detection | Node ancestry check via root nodeId | Replaces `/alice/...` path prefix matching with closure table lookup |
| API contract | `nodeId` exclusively | Execution Rule #13: no path compatibility layer; all payloads use `nodeId` |

## Current State (Evidence)

### Path-Based Code (To Be Migrated)

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| permissionStore.js | `server/domains/permissions/stores/permissionStore.js` | 1290 lines | SQL queries use `folder_path`, `file_path`, `root_path`, `is_directory` — none exist in target DDL |
| permissionRequestStore.js | `server/domains/permissions/stores/permissionRequestStore.js` | 757 lines | SQL uses `folder_path`, `file_path`, `target_type` — all removed from DDL |
| aclService.js | `server/domains/permissions/services/aclService.js` | 263 lines | All path-string arguments; string prefix matching for inheritance |
| permissionPolicy.js | `server/domains/permissions/policy/permissionPolicy.js` | 204 lines | Path-based checks, owner detection via string prefix |
| ownerPathResolver.js | `server/domains/permissions/policy/ownerPathResolver.js` | 42 lines | `/alice/...` path prefix matching |
| inheritancePolicy.js | `server/domains/permissions/policy/inheritancePolicy.js` | 52 lines | Path normalization and lookup variant generation |
| permissionFacade.js | `server/domains/permissions/services/permissionFacade.js` | 105 lines | Thin pass-through with path-string arguments |
| Permission.js (model) | `server/models/Permission.js` | 102 lines | Thin pass-through over permissionStore |
| PermissionRequest.js (model) | `server/models/PermissionRequest.js` | 38 lines | Thin pass-through over permissionRequestStore |
| permissions middleware | `server/middleware/permissions.js` | 93 lines | Path extraction from `req.query.path` / `req.body.path` |

### Client-Side Code (To Be Migrated)

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| permissionService.js | `client/src/services/permissionService.js` | 110 lines | All API calls use path strings (`folderPath`, `path`) |
| sharePermissionGateway.js | `client/src/services/sharePermissionGateway.js` | 78 lines | Re-exports with path-based signatures |
| permissionRequestService.js | `client/src/services/permissionRequestService.js` | 49 lines | `{ folderPath, filePath }` payloads |
| useSharedManage.js | `client/src/hooks/useSharedManage.js` | 299 lines | Path-string state management |
| buildPermissionDiff.js | `client/src/utils/buildPermissionDiff.js` | 59 lines | path-string Maps and prefix matching |
| folderUtils.js | `client/src/utils/folderUtils.js` | 42 lines | `collectSubfolderPaths()` recursive path collection |
| shareTargetPermissionSaveUseCase.js | `client/src/services/shareTargetPermissionSaveUseCase.js` | 100 lines | Calls `collectSubfolderPaths()` + per-path grant |

### Existing Tests (To Be Updated)

| Test File | Coverage | Status |
|-----------|----------|--------|
| `server/domains/permissions/stores/__tests__/permissionStore.test.js` | grant, revoke, getUserPermissions, checkPermission, etc. | Path-string fixtures — needs nodeId conversion |
| `server/domains/permissions/stores/__tests__/requestStore.test.js` | createRequest, getById, listInbox/outbox, updateStatus | Path-string fixtures — needs nodeId conversion |
| `server/domains/permissions/routes/__tests__/permissions.test.js` | POST grant, DELETE revoke, GET check, existence index | 360 lines, path-based payloads |
| `server/domains/permissions/routes/__tests__/permissionRequests.test.js` | create, inbox/outbox, approve, cancel, reject | Path-string fixtures |
| `server/middleware/__tests__/permissions.test.js` | requirePermission, requireFolderPermission middleware | 205 lines, path-based |
| `client/src/services/__tests__/permissionService.test.js` | getUserPermissions, grant, revoke, check | 259 lines, path-string payloads |
| `client/src/utils/__tests__/folderUtils.test.js` | collectSubfolderPaths | Will be removed (server-side replacement) |
| `client/src/utils/__tests__/buildPermissionDiff.test.js` | Diff computation over path Maps | Needs nodeId conversion |

### DDL Tables (Final State — Phase 0 Complete)

```sql
-- permissions_user_paths: user_id + file_node_id FK
CREATE TABLE permissions_user_paths (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_user_paths_unique UNIQUE (user_id, file_node_id)
);

-- permissions_user_files: user_id + file_node_id FK
CREATE TABLE permissions_user_files (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_user_files_unique UNIQUE (user_id, file_node_id)
);

-- permissions_shares: token + file_node_id FK
CREATE TABLE permissions_shares (
  token TEXT PRIMARY KEY,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- permission_requests: file_node_id FK replaces folder_path + file_path + target_type
CREATE TABLE permission_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_username TEXT NOT NULL,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_username TEXT NOT NULL,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  requested_permission TEXT NOT NULL CHECK (requested_permission IN ('read', 'write')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by BIGINT NULL
);

-- Partial unique index for deduplication
CREATE UNIQUE INDEX permission_requests_pending_dedupe_uq
  ON permission_requests (requester_id, owner_id, requested_permission, file_node_id)
  WHERE status = 'pending';
```

### Dependencies Available

| Component | Status | Used In |
|-----------|--------|---------|
| `fileNodesStore.js` | Phase 2 complete | Ancestor queries, node lookups |
| `_ancestryHelper.js` | Phase 2 complete | Closure table maintenance (not needed for reads) |
| `fileNodeService.js` | Phase 2 complete | `getAncestorChain()`, `getNode()`, `resolvePath()` |
| `node_ancestors` table | Phase 0 DDL + Phase 2 populated | Permission inheritance via JOIN |

---

## Execution Order

```
Phase 3a (Docs-First GATE):
  [D1-D5 spec updates] ──▶ GATE: all specs reference nodeId only

Phase 3b (TDD — Tests first, then implementation):
  [fileNodesStore.isAncestor()] ──┐
  [3.1 permissionStore TDD+impl] ─┤
                                  ├─▶ [3.3a aclService TDD+impl] ──┐
  [3.2 requestStore TDD+impl] ───┤                                  │
                                 ├─▶ [3.3b ownerNodeResolver +      │
                                 │     permissionPolicy TDD+impl]   │
  [3.4 Middleware TDD+impl] ◄────┘                                  │
                                                                    ├─▶ [3.5 Routes TDD+impl]
                                                                    │
Phase 3c (Client):                                                  │
  [3.6 Client services/hooks/utils TDD+impl] ──────────────────────┘

Phase 3d (Integration):
  [3.7 Full integration tests: grant→inheritance→check lifecycle]
```

---

## Phase 3a: Docs-First Gate (Mandatory)

**All spec documents must be updated before any implementation begins.**

### D1: `docs/spec/server/store/permissionStore.md`

**Changes required:**

| Section | Current | Target |
|---------|---------|--------|
| Method signatures | `grant(userId, folderPath, permission)` | `grant(userId, nodeId, permission)` — `nodeId` is BIGINT |
| Folder permissions table | All methods use `folderPath`, `filePath` parameters | Replace with `nodeId` (directory nodes), `fileNodeId` (file nodes) |
| Share token section | `grantSharePermission(token, rootPath, isDirectory)` | `grantSharePermission(token, nodeId)` — `isDirectory` derivable from `file_nodes.type` |
| Admin/Lifecycle | Path-based bulk operations (`rewritePermissionsForAllUsers(mapping)`) | Remove — no path rewrites needed with node IDs |
| Verification Scenarios | Path-string assertions | NodeId-based assertions; add closure table inheritance tests |

**New sections to add:**

- `§2.4 PostgreSQL v2 Table Mapping` → Update to reflect actual DDL (remove "Note: current implementation still uses legacy" disclaimer)
- `§2.7 Ancestor Inheritance` — Document how permission checks traverse `node_ancestors`:
  ```
  SELECT p.permission FROM permissions_user_paths p
    JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
   WHERE a.descendant_id = ? AND p.user_id = ?
   ORDER BY a.depth ASC LIMIT 1
  ```

### D2: `docs/spec/server/store/permissionRequestStore.md`

**Changes required:**

| Section | Current | Target |
|---------|---------|--------|
| createRequest signature | `{ requesterId, ownerId, folderPath?, filePath?, requestedPermission }` | `{ requesterId, ownerId, fileNodeId, requestedPermission }` — single `fileNodeId`, no path fields |
| Request shape | Lists `folder_path`, `file_path`, `target_type` | Only `file_node_id`; type derived from `file_nodes.type` |
| Deduplication | `(requester_id, owner_id, folder_path/file_path)` | `(requester_id, owner_id, requested_permission, file_node_id)` — matches DDL partial unique index |

### D3: `docs/spec/server/routes/permissions.md`

**Changes required:**

| Route | Current Payload | Target Payload |
|-------|---------------|----------------|
| POST `/grant` | `{ folderPath, userId, permission }` | `{ nodeId, userId, permission }` |
| DELETE `/revoke` | `?userId=&folderPath=` | `?userId=&nodeId=` |
| GET `/check` | `?path=` | `?nodeId=` |
| GET `/folder` | `?path=&filePath=` | `?nodeId=&fileNodeId=` |

**New sections to add:**

- `§2.4.5 Node ID Validation` — All nodeId parameters must exist in `file_nodes`; 404 if not found
- Remove existence index section (path-based concept); replace with node existence check

### D4: `docs/spec/server/middleware/permissions.md`

**Changes required:**

| Item | Current | Target |
|------|---------|--------|
| Input conditions | `filePath`, `folderPath` (normalized strings) | `nodeId` (BIGINT from request body/query) |
| Path normalization | Required (`normalizePathParam`) | Not needed — nodeId is opaque integer |
| Owner path detection | `/alice/...` prefix matching | Ancestor check: user's root nodeId in `node_ancestors` chain |

### D5: `docs/spec/client/services/permissionService.md`

**Changes required:**

| Function | Current Signature | Target Signature |
|----------|------------------|------------------|
| grantPermission | `{ userId, folderPath, permission, target? }` | `{ userId, nodeId, permission, targetType? }` — `targetType: 'file'|\`directory\`` from caller |
| revokePermission | `{ userId, folderPath, includeSubfolders?, scope? }` | `{ userId, nodeId, scope? }` — `includeSubfolders` removed (server handles via closure table) |
| getFolderPermissions | `(path, ...)` | `(nodeId, ...)` |
| checkPermission | `(path)` | `(nodeId)` |

---

## Task Details

### Task 3.1: permissionStore.js — SQL Rewrite + Sync Checkers Removal

**Output:** `server/domains/permissions/stores/permissionStore.js` (rewrite in place)
**Dependencies:** Task 3.0 (DDL ready), Phase 2 (`fileNodesStore`, `node_ancestors`)
**Estimated lines:** ~600 lines (reduced from 1290 by removing JSON backend, sync checkers, path normalization helpers)

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | grant(userId, nodeId, 'read') for directory node | INSERT into `permissions_user_paths(user_id, file_node_id, permission)` succeeds |
| V2 | grant duplicate with higher permission | UPSERT replaces permission; no duplicate row |
| V3 | grant(userId, nodeId, 'read') for file node | INSERT into `permissions_user_files` succeeds |
| V4 | revoke(userId, nodeId) for directory | DELETE FROM `permissions_user_paths WHERE user_id=? AND file_node_id=?` |
| V5 | getUserPermissions(userId) | Returns array of `{ nodeId, permission }` from both tables UNIONed with node type info |
| V6 | checkPermission(userId, nodeId, 'read') — direct match | TRUE if exact `file_node_id=nodeId` row exists with sufficient rank |
| V7 | checkPermission(userId, nodeId, 'read') — ancestor inheritance | TRUE if any ancestor (via `node_ancestors`) has permission; closest ancestor wins |
| V8 | grantSharePermission(token, nodeId) | INSERT/UPDATE `permissions_shares` with `file_node_id=nodeId`; no `is_directory` column |
| V9 | checkSharePermission(token, targetNodeId) | Share applies if `targetNodeId` is descendant of share's `file_node_id` (closure table check) |
| V10 | writeUserPermissionsDoc(userId, [{ nodeId, permission }]) | DELETE all + INSERT loop for new permissions by nodeId |
| V11 | getEffectivePermission(userId, nodeId) — file overrides folder | File-level permission takes precedence; if absent, folder ancestor chain checked |

#### Implementation Plan

**Step 1: Remove JSON backend entirely**

The FsJSON metadata backend was deprecated in Phase 0 (Task 0.6). All in-memory doc-based functions (`grant`/`revoke` with `doc.permissions[folder] = permission`, prefix-matching helpers, `normalizeNoSlash`, `rewriteKeyByMapping`) are removed. The store now has only PostgreSQL and SQLite branches.

**Step 2: Rewrite folder permissions (PostgreSQL branch)**

Current code at lines ~343-527 operates on path strings. Replace with nodeId-based queries:

```javascript
// readUserPermissionsDoc — BEFORE (path-based)
const [folderRows] = await pool.query(
  'SELECT folder_path, permission, updated_at FROM permissions_user_paths WHERE user_id = $1',
  [userId]
);

// readUserPermissionsDoc — AFTER (nodeId-based)
const folderRows = await pgQuery(
  `SELECT p.file_node_id, p.permission, p.updated_at, fn.type
   FROM permissions_user_paths p
   JOIN file_nodes fn ON fn.id = p.file_node_id
   WHERE p.user_id = $1`,
  [userId]
);
```

**Step 3: Rewrite folder permissions (SQLite branch)**

Same transformation for SQLite parameter syntax (`?` placeholders, `datetime('now')`).

**Step 4: Rewrite grant/revoke/check with closure table support**

The critical change is `checkPermission`. Before, it used in-memory doc lookup with string prefix matching. After, it uses SQL JOINs against `node_ancestors`:

```javascript
// checkPermission — AFTER (closure table inheritance)
async function checkPermission(userId, nodeId, requiredPermission) {
  // Direct permission on this node?
  const direct = await pgQuery(
    `SELECT permission FROM permissions_user_paths
     WHERE user_id = $1 AND file_node_id = $2`,
    [userId, nodeId]
  );
  if (direct.rows.length > 0) {
    return rankMeetsRequirement(direct.rows[0].permission, requiredPermission);
  }

  // Ancestor permission via closure table?
  const inherited = await pgQuery(
    `SELECT p.permission, a.depth FROM permissions_user_paths p
     JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
     WHERE a.descendant_id = $1 AND p.user_id = $2
     ORDER BY a.depth ASC LIMIT 1`,
    [nodeId, userId]
  );

  return inherited.rows.length > 0 && rankMeetsRequirement(inherited.rows[0].permission, requiredPermission);
}
```

**Step 5: Remove sync checkers entirely**

`checkPermissionSync(doc, folderPath, requiredPermission)` and `checkFilePermissionSync(doc, filePath, requiredPermission)` operated on in-memory permission documents loaded once per request. With closure table inheritance requiring DB queries, these cannot be synchronous. All callers must migrate to async versions.

Functions to remove:
- `checkPermissionSync` (line ~430)
- `checkFilePermissionSync` (line ~650)
- In-memory doc loading pattern (`getPermissionDoc` → parse JSON → object lookup)

**Step 6: Rewrite share permissions**

```javascript
// grantSharePermission — BEFORE
await pool.query(
  'INSERT INTO permissions_shares (token, root_path, is_directory, permission) VALUES ($1, $2, $3, $4)',
  [token, rootPath, isDirectory ? 1 : 0, permission]
);

// grantSharePermission — AFTER
await pgQuery(
  'INSERT INTO permissions_shares (token, file_node_id, permission, updated_at) VALUES ($1, $2, $3, NOW())',
  [token, nodeId]
);
```

**Step 7: Rewrite getUserPermissions to return nodeId-based results**

Return shape changes from `{ folder_path, permission }` to `{ nodeId, path, permission, type }`. The `path` is resolved via `fileNodeService.getNodePath(nodeId)` for display purposes.

#### Test File: `permissionStore.test.js` (rewrite)

```javascript
// TDD test scenarios — write before implementation
describe('permissionStore (nodeId-based)', () => {
  describe('folder permissions', () => {
    it('grants folder permission by nodeId');           // V1
    it('upserts on duplicate grant with higher rank');  // V2
    it('revokes folder permission by nodeId');          // V4
    it('lists user permissions as [{ nodeId, permission }]'); // V5
  });

  describe('file permissions', () => {
    it('grants file permission by nodeId');             // V3
    it('getEffectivePermission prefers file over folder'); // V11
  });

  describe('ancestor inheritance', () => {
    it('checkPermission finds direct match');          // V6
    it('checkPermission inherits from ancestor via closure table'); // V7
    it('closest ancestor wins (lowest depth)');        // V7 extension
  });

  describe('share permissions', () => {
    it('grantSharePermission stores nodeId only');     // V8
    it('checkSharePermission applies to descendants'); // V9
  });
});
```

---

### Task 3.2: permissionRequestStore.js — SQL Rewrite

**Output:** `server/domains/permissions/stores/permissionRequestStore.js` (rewrite in place)
**Dependencies:** None independent of 3.1 (can run in parallel)
**Estimated lines:** ~400 lines (reduced from 757 by removing JSON backend, path normalization)

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | createRequest with fileNodeId | INSERT succeeds; `file_node_id` stored |
| V2 | createRequest duplicate pending for same (requester, owner, permission, nodeId) | Returns existing request; partial unique index prevents duplicate |
| V3 | getById returns node_id and derived type | `targetType` field populated from `file_nodes.type` via JOIN |
| V4 | listInbox filters by status | Correct subset returned |
| V5 | updateStatus PENDING → APPROVED sets resolved_at/resolved_by | Timestamps and resolver ID set correctly |
| V6 | deleteByRequesterId cascades | All requests for user removed |

#### Implementation Plan

**Step 1: Remove JSON backend** (same as Task 3.1)

**Step 2: Rewrite createRequest SQL**

Before:
```sql
INSERT INTO permission_requests (requester_id, requester_username, owner_id, owner_username, folder_path, file_path, target_type, requested_permission, status, message)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
```

After:
```sql
INSERT INTO permission_requests (requester_id, requester_username, owner_id, owner_username, file_node_id, requested_permission, status, message)
VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
```

Deduplication query changes from checking `(folder_path, file_path)` tuple to `file_node_id`:
```sql
-- Dedup check — AFTER
SELECT id FROM permission_requests
 WHERE requester_id = $1 AND owner_id = $2 AND requested_permission = $3
   AND file_node_id = $4 AND status = 'pending' LIMIT 1
```

**Step 3: Remove target_type column references everywhere**

Type is now derived at read time via JOIN:
```sql
SELECT pr.*, fn.type AS target_type FROM permission_requests pr
JOIN file_nodes fn ON fn.id = pr.file_node_id WHERE pr.id = $1
```

**Step 4: Rewrite row mapper**

`mapPermissionRequestRow()` currently reads `row.folder_path`, `row.file_path`. Replace with `row.file_node_id` and derive display path via separate lookup if needed.

#### Test File: `requestStore.test.js` (rewrite)

TDD tests use nodeId fixtures instead of path strings. Verify deduplication against partial unique index on `(requester_id, owner_id, requested_permission, file_node_id)`.

---

### Task 3.3a: aclService.js — Core Permission Checks

**Output:** `server/domains/permissions/services/aclService.js` (rewrite)
**Dependencies:** Task 3.1 (permissionStore returns nodeId results), `fileNodesStore.isAncestor()` (prerequisite)
**Estimated lines:** ~120 (reduced from 263)

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | checkFilePermission(principalId, fileNodeId) — direct file permission | TRUE if `permissions_user_files` has entry |
| V2 | checkFilePermission(fileNodeId) — inherited from parent folder | TRUE if ancestor directory has permission via closure table |
| V3 | checkFolderPermission(principalId, dirNodeId) — direct | TRUE if `permissions_user_paths` has entry |
| V4 | checkFolderPermission(dirNodeId) — inherited from grandparent | TRUE via `node_ancestors` JOIN at depth 2 |
| V6 | admin bypass | Returns true regardless of permission state |
| V7 | share principal access | Resolves via token → `permissions_shares` → closure table descendant check |

#### Implementation Plan

**Step 1: Rewrite aclService.js function signatures**

```javascript
// BEFORE
async function checkFilePermission(principalId, filePath, requiredPermission) {
  const parentFolder = getParentPath(filePath);
  return await Permission.checkPermission(userId, normalizedFolderPath, requiredPermission);
}

// AFTER
async function checkFilePermission(principalId, fileNodeId, requiredPermission) {
  // Direct file permission?
  const filePerm = await Permission.getFilePermission(principalId, fileNodeId);
  if (filePerm && rankMeetsRequirement(filePerm, requiredPermission)) return true;

  // Inherited from ancestor folder via closure table?
  return await Permission.checkPermission(principalId, fileNodeId, requiredPermission);
}
```

**Step 2: Rewrite checkFolderPermission**

The `checkPermission` in permissionStore (Task 3.1) already handles ancestor inheritance via closure table JOIN. The aclService becomes a thin dispatcher:

```javascript
async function checkFolderPermission(principalId, dirNodeId, requiredPermission) {
  return await Permission.checkPermission(principalId, dirNodeId, requiredPermission);
}
```

**Step 3: Remove sync checker builders**

`buildSyncReadChecker`, `buildSyncWriteChecker`, etc. — all relied on in-memory doc lookup. With DB-based closure table queries, these are no longer viable. Callers must use async versions.

#### Test File: New `aclService.test.js`

```javascript
describe('aclService (nodeId-based)', () => {
  describe('file permission checks', () => {
    it('direct file permission returns true');              // V1
    it('inherited from ancestor folder returns true');      // V2
  });

  describe('folder permission checks', () => {
    it('direct folder permission returns true');            // V3
    it('inherits from grandparent via closure table');       // V4
  });

  describe('admin and share access', () => {
    it('admin bypasses all checks');                        // V6
    it('share principal accesses descendants of share root'); // V7
  });
});
```

---

### Task 3.3b: Owner Detection + Permission Policy — Node ID Migration

**Output:** `ownerPathResolver.js` → `ownerNodeResolver.js` (rename + rewrite), `permissionPolicy.js` (rewrite), `inheritancePolicy.js` (rewrite)
**Dependencies:** Task 3.3a (aclService accepts nodeIds), `fileNodesStore.isAncestor()` (prerequisite)
**Estimated lines:** ~80 total

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V5 | canAccessNode(userId, nodeId) — owner's own files | TRUE if node is under user's root directory (ancestor check) |
| V8 | permissionPolicy.canReadFolder(dirNodeId) | TRUE if user has read permission on node or ancestor |
| V9 | permissionPolicy.canGrantPermission(userId, nodeId) | TRUE if user has admin permission on node or ancestor |
| V10 | inheritancePolicy.getEffectivePermission(userId, nodeId) | Returns highest-rank permission from ancestor chain |

#### Implementation Plan

**Step 1: Rewrite ownerPathResolver.js → ownerNodeResolver.js**

Before: `isOwnerPath(user, targetPath)` used string prefix matching (`normalized.startsWith(root + '/')`).

After: Use closure table to check if user's root node is an ancestor of the target node.

```javascript
async function isOwnerNode(userId, targetNodeId) {
  // Find user's root directory node
  const rootNode = await fileNodesStore.getNodeByUserRoot(userId);
  if (!rootNode) return false;

  // Check if rootNode is an ancestor of targetNodeId (or the node itself)
  const ancestryRow = await fileNodesStore.isAncestor(rootNode.id, targetNodeId);
  return !!ancestryRow;
}
```

**Step 2: Rewrite canAccessNode**

Before: `normalizedPath.startsWith(userFolder + '/')`. After: closure table check.

```javascript
async function canAccessNode(userId, targetNodeId) {
  const userRoot = await getUserRootNodeId(userId);
  if (!userRoot) return false;

  // User's own root? Or descendant of root?
  if (targetNodeId === userRoot) return true;

  const isDescendant = await fileNodesStore.isAncestor(userRoot, targetNodeId);
  return !!isDescendant;
}
```

**Step 3: Rewrite permissionPolicy.js**

Same pattern: replace path-string arguments with nodeIds throughout `hasDirectFolderPermission`, `canReadFolder`, `canWriteFolder`, `canGrantPermission`, `canRevokePermission`.

**Step 4: Rewrite inheritancePolicy.js**

Path normalization → nodeId ancestor queries. Remove `generateLookupVariants()` and path normalization helpers.

#### Test File: New `ownerNodeResolver.test.js` + `permissionPolicy.test.js`

```javascript
describe('ownerNodeResolver (nodeId-based)', () => {
  it('owner can access own nodes');                       // V5
  it('non-owner cannot access private nodes');
});

describe('permissionPolicy (nodeId-based)', () => {
  it('canReadFolder checks ancestor chain');              // V8
  it('canGrantPermission requires admin on ancestor');    // V9
  it('getEffectivePermission returns highest rank');      // V10
});
```

---

### Task 3.4: Middleware — Node ID Migration

**Output:** `server/middleware/permissions.js` (rewrite)
**Dependencies:** Task 3.3a (aclService accepts nodeIds)
**Estimated lines:** ~80 lines

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | requirePermission with valid nodeId | Request proceeds; no 4xx |
| V2 | requirePermission with unauthorized nodeId | Returns 403 |
| V3 | requirePermission with missing nodeId | Returns 400 |
| V4 | Admin user bypasses all checks | Returns 200 regardless of permission state |
| V5 | Owner accesses own node | Returns 200 via ownership check |

#### Implementation Plan

**Step 1: Rewrite pathExtractors to nodeIdExtractors**

```javascript
// BEFORE
function requirePermission(permissionType, pathExtractor = (req) => req.query.path || req.body.path) {
  return async (req, res, next) => {
    const path = pathExtractor(req);
    // ... normalizePath(path) ...
    const allowed = await aclService.checkFilePermission(principalId, path, permissionType);
  };
}

// AFTER
function requirePermission(permissionType, nodeIdExtractor = (req) => req.query.nodeId || req.body.nodeId) {
  return async (req, res, next) => {
    const nodeId = nodeIdExtractor(req);
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });

    // Admin bypass
    const user = await aclService.getCachedUser(principalId);
    if (aclService.isAdminUser(user)) return next();

    const allowed = await aclService.checkPermission(nodeId, principalId, permissionType);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    next();
  };
}
```

**Step 2: Remove path normalization middleware**

`normalizePathParam` is no longer needed — `nodeId` is an integer, not a string subject to trailing slash variants.

#### Test File: `permissions.test.js` (middleware) — rewrite

Convert from path-string fixtures to nodeId-based tests. Mock `aclService.checkPermission` with nodeId argument.

---

### Task 3.5: Routes — Payload Migration + Integration Tests

**Output:** Route files in `server/domains/permissions/routes/`
**Dependencies:** Tasks 3.1, 3.2, 3.3a, 3.3b, 3.4 (store, service, policy, middleware all accept nodeIds)
**Estimated lines:** Minor changes across existing route files

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | POST /grant with `{ nodeId, userId, permission }` | 200; permission stored in DB by nodeId |
| V2 | POST /grant missing nodeId | 400 |
| V3 | DELETE /revoke?userId=&nodeId= | 200; permission removed |
| V4 | GET /check?nodeId= | Returns `{ hasRead, hasWrite, source }` with nodeId-based resolution |
| V5 | Grant folder → child/grandchild accessible via closure table inheritance | Permission check on descendant returns true |

#### Implementation Plan

**Step 1: Update request body/query parsing in all route handlers**

```javascript
// folderPermissions.js — BEFORE
router.post('/grant', async (req, res) => {
  const { folderPath, userId, permission } = req.body;
  if (!folderPath || !userId || !permission) return res.status(400).json({ error: 'Missing fields' });
  await Permission.grant(userId, folderPath, permission);
});

// folderPermissions.js — AFTER
router.post('/grant', async (req, res) => {
  const { nodeId, userId, permission } = req.body;
  if (!nodeId || !userId || !permission) return res.status(400).json({ error: 'Missing fields' });

  // Validate node exists and is a directory
  const node = await fileNodesStore.getNode(nodeId);
  if (!node || node.type !== 'directory') return res.status(404).json({ error: 'Directory not found' });

  await Permission.grant(userId, nodeId, permission);
});
```

**Step 2: Update response format**

Responses that previously returned `{ folder_path, permission }` now return `{ nodeId, path, permission, type }`. The `path` is resolved via `fileNodeService.getNodePath(nodeId)` for display.

**Step 3: Rewrite route tests**

Replace all `folderPath`/`filePath` fixtures with `nodeId` values. Create test nodes in `file_nodes` table before running route tests.

---

### Task 3.6: Client Services/Hooks/Utils — Node ID Migration

**Output:** Client-side files (see list below)
**Dependencies:** Task 3.5 (server routes accept nodeId payloads)
**Estimated lines:** ~400 lines across multiple files

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | grantPermission sends `{ userId, nodeId, permission }` | Server accepts and stores by nodeId |
| V2 | revokePermission sends `{ userId, nodeId }` — no `includeSubfolders` flag | Server handles inheritance via closure table; no client-side fan-out needed |
| V3 | checkPermission sends nodeId in query | Returns correct hasRead/hasWrite/source |
| V4 | useSharedManage hook uses nodeId throughout | No path-string references remain |

#### Implementation Plan

**Step 1: Rewrite `permissionService.js`**

```javascript
// BEFORE
export async function grantPermission({ userId, folderPath, permission, target }) {
  await api.post('/permissions/grant', { folderPath, userId, permission, target });
}

// AFTER
export async function grantPermission({ userId, nodeId, permission, targetType }) {
  // targetType: 'directory' | 'file' — determines which endpoint to call
  const endpoint = targetType === 'file' ? '/permissions/file/grant' : '/permissions/grant';
  await api.post(endpoint, { nodeId, userId, permission });
}
```

**Step 2: Rewrite `revokePermission` — remove `includeSubfolders`**

Previously, the client collected subfolder paths and sent per-path revoke requests. With closure table inheritance, revoking a single nodeId is sufficient — descendants lose inherited access automatically (no explicit descendant rows exist; inheritance is computed at query time).

```javascript
// BEFORE
export async function revokePermission({ userId, folderPath, includeSubfolders }) {
  await api.delete('/permissions/revoke', { params: { userId, folderPath } });
  if (includeSubfolders) {
    // Client-side fan-out — NO LONGER NEEDED
  }
}

// AFTER
export async function revokePermission({ userId, nodeId }) {
  await api.delete('/permissions/revoke', { params: { userId, nodeId } });
}
```

**Step 3: Rewrite `sharePermissionGateway.js` and `permissionRequestService.js`**

Same pattern: `{ folderPath, filePath }` → `{ fileNodeId }`. The gateway's `createPermissionRequest` sends `fileNodeId` instead of separate path fields.

**Step 4: Rewrite `useSharedManage.js`**

Replace all `targetPath` references with `targetNodeId`. Remove `checkOwnerExists(targetPath, { forFile })` — replace with server-side ownership check via nodeId ancestry.

**Step 5: Rewrite `buildPermissionDiff.js`**

Input changes from `Map<string, Map<string, string>>` (path → userId → permission) to `Map<number, Map<number, string>>` (nodeId → userId → permission). No prefix matching needed — ancestor checks are server-side.

```javascript
// BEFORE: path-string keys with startsWith for subfolder detection
if (currentPath.startsWith(initialPath + '/')) { ... }

// AFTER: nodeId integer keys; no client-side inheritance logic needed
const diff = computeDiff(initialPermissions, currentPermissions);
// Permissions to grant/revoke are computed per-nodeId pair
```

**Step 6: Remove `collectSubfolderPaths` and callers**

`folderUtils.js::collectSubfolderPaths()` is eliminated. The server handles descendant permission inheritance via the closure table — no client-side path fan-out is needed.

Remove from `shareTargetPermissionSaveUseCase.js`:
```javascript
// BEFORE: Client collects all subfolder paths, then grants per-path
const pathsToGrant = await collectSubfolderPaths(targetPath);
for (const p of pathsToGrant) {
  await grantPermission({ userId, folderPath: p, permission });
}

// AFTER: Single grant on the target nodeId; inheritance is computed at query time
await grantPermission({ userId, nodeId: targetNodeId, permission });
```

---

### Task 3.7: Integration Tests — End-to-End Permission Lifecycle

**Output:** Updated test files across server and client
**Dependencies:** All Tasks 3.1–3.6 complete
**Estimated lines:** ~400 lines of tests

#### Test Scenarios

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | Grant folder permission → child/grandchild accessible via closure table (depth 0, 1, N) | Permission check on any descendant returns true without explicit grant |
| V2 | Revoke folder permission → all descendants lose access immediately | No stale inherited permissions |
| V3 | File-level permission overrides folder inheritance | Direct file grant takes precedence over ancestor folder grant |
| V4 | Move node to new parent → permissions follow via updated closure table | After `moveNode`, ancestor chain is rebuilt; permission checks use new chain |
| V5 | Delete parent node → CASCADE removes permission rows | FK CASCADE on `file_node_id` cleans up `permissions_user_paths`/`_files` |
| V6 | Share link + folder restriction interaction | Shared access respects folder-level restrictions via closure table |
| V7 | Permission request lifecycle (create → approve) with nodeId payload | Request stored by fileNodeId; approval creates permission row |

---

## File Modification List

### Server Files to Rewrite

| File | Action | Estimated Lines After |
|------|--------|---------------------|
| `server/domains/permissions/stores/permissionStore.js` | Full rewrite: SQL queries, remove JSON backend, add closure table JOINs | ~600 (from 1290) |
| `server/domains/permissions/stores/permissionRequestStore.js` | Full rewrite: SQL queries, remove JSON backend, single fileNodeId field | ~400 (from 757) |
| `server/domains/permissions/services/aclService.js` | Rewrite: path→nodeId arguments, closure table inheritance | ~120 (from 263) |
| `server/domains/permissions/policy/permissionPolicy.js` | Rewrite: nodeId parameters throughout | ~80 (from 204) |
| `server/domains/permissions/policy/ownerPathResolver.js` | Rename to `ownerNodeResolver.js`, rewrite with ancestry check | ~50 (from 42) |
| `server/domains/permissions/policy/inheritancePolicy.js` | Rewrite: path normalization → nodeId ancestor queries | ~30 (from 52) |
| `server/domains/permissions/services/permissionFacade.js` | Update signatures: all methods accept nodeId | ~80 (from 105) |
| `server/models/Permission.js` | Update pass-through signatures | ~70 (from 102) |
| `server/models/PermissionRequest.js` | Update pass-through signatures | ~30 (from 38) |
| `server/middleware/permissions.js` | Rewrite: nodeIdExtractors, remove path normalization | ~80 (from 93) |

### Server Test Files to Rewrite

| File | Action |
|------|--------|
| `server/domains/permissions/stores/__tests__/permissionStore.test.js` | Rewrite fixtures: path strings → nodeIds; add inheritance tests |
| `server/domains/permissions/stores/__tests__/requestStore.test.js` | Rewrite fixtures: paths → fileNodeId |
| `server/domains/permissions/routes/__tests__/permissions.test.js` | Rewrite payloads and assertions for nodeId API |
| `server/domains/permissions/routes/__tests__/permissionRequests.test.js` | Rewrite fixtures for fileNodeId |
| `server/middleware/__tests__/permissions.test.js` | Rewrite: nodeId-based middleware tests |

### Client Files to Rewrite

| File | Action |
|------|--------|
| `client/src/services/permissionService.js` | API payloads: `{ folderPath }` → `{ nodeId }`; remove `includeSubfolders` fan-out |
| `client/src/services/sharePermissionGateway.js` | Pass-through with nodeId signatures |
| `client/src/services/permissionRequestService.js` | `{ fileNodeId }` instead of `{ folderPath, filePath }` |
| `client/src/hooks/useSharedManage.js` | All state keyed by nodeId; remove path-string operations |
| `client/src/utils/buildPermissionDiff.js` | nodeId Maps; remove prefix matching |

### Client Files to Remove

| File | Reason |
|------|--------|
| `client/src/utils/folderUtils.js::collectSubfolderPaths` | Replaced by server-side closure table inheritance |
| `client/src/services/shareTargetPermissionSaveUseCase.js::pathsToGrant loop` | Single grant per nodeId replaces fan-out |

### Client Test Files to Rewrite

| File | Action |
|------|--------|
| `client/src/services/__tests__/permissionService.test.js` | nodeId payloads, no includeSubfolders |
| `client/src/utils/__tests__/buildPermissionDiff.test.js` | nodeId Maps instead of path strings |

### Client Test Files to Remove

| File | Reason |
|------|--------|
| `client/src/utils/__tests__/folderUtils.test.js::collectSubfolderPaths tests` | Function removed — server-side replacement |

---

## New Methods Required on fileNodesStore

**Prerequisite for Task 3.3a and 3.3b.** Must be implemented before aclService rewrite begins.

```javascript
// In fileNodesStore.js — add to existing methods
isAncestor(ancestorId, descendantId)
  // SELECT 1 FROM node_ancestors WHERE ancestor_id = ? AND descendant_id = ? LIMIT 1
  // → { count } | null
```

**Verification:** Unit test in `fileNodesStore.test.js` — insert ancestor chain (A→B→C), verify `isAncestor(A, C)` returns truthy, `isAncestor(C, A)` returns falsy.

This is a minor addition to the existing store and should be implemented as a prerequisite before Task 3.3a begins.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Closure table not populated for existing nodes | Permission checks return false (no access) | Phase 2 ensures closure table is built on node creation; migration tooling (Future Work) populates for existing data |
| Sync checkers removed → performance regression | Every permission check hits DB instead of in-memory doc | Acceptable trade-off: closure table queries are O(1) indexed lookups. Caching layer can be added later (Redis, Phase Future Work) |
| 1290-line file rewrite introduces regressions | High — many code paths affected | TDD approach: write tests before implementation; run full test suite after each sub-task |
| Client `includeSubfolders` removal changes UI behavior | Medium — bulk grant/revoke across subfolders no longer client-side | Server-side closure table inheritance makes explicit per-subfolder grants unnecessary. Single grant on parent covers all descendants at query time |
| Owner detection via ancestry check is slower than string prefix | Low | Closure table index (`node_ancestors_descendant_idx`) makes this O(1) lookup |

---

## Success Criteria

| Verification Item | Command | Expected Result |
|------------------|---------|-----------------|
| Spec docs updated | `grep -r "folderPath\|filePath\|root_path" docs/spec/server/store/permissionStore.md` | No matches — all references use nodeId |
| permissionStore tests pass (nodeId) | `npm run test:unit -w server -- --testPathPattern="permissionStore"` | All pass with nodeId fixtures |
| requestStore tests pass | `npm run test:unit -w server -- --testPathPattern="requestStore"` | All pass with fileNodeId fixtures |
| ACL service tests pass (inheritance) | `npm run test:unit -w server -- --testPathPattern="aclService"` | Closure table inheritance verified at depth 0/1/N |
| Owner/policy tests pass | `npm run test:unit -w server -- --testPathPattern="ownerNodeResolver\|permissionPolicy"` | Ancestry-based ownership and policy checks pass |
| Middleware tests pass | `npm run test:unit -w server -- --testPathPattern="middleware.*permissions"` | nodeId-based checks work; admin/owner bypasses functional |
| Route integration tests pass | `npm run test:integration -w server -- --testPathPattern="permissions"` | Grant/revoke/check endpoints return correct results with nodeId payloads |
| Client tests pass | `npm run test:ci -w client -- --testPathPattern="permissionService\|buildPermissionDiff"` | nodeId-based API calls succeed |
| No path-string references in permission code | `grep -r "folder_path\|file_path\|root_path" server/domains/permissions/` (excluding tests and DDL) | Zero matches — migration complete |
| permissionRequestStore DDL alignment | `grep -r "folder_path\|file_path\|target_type" server/domains/permissions/stores/permissionRequestStore.js` | Zero matches — single file_node_id field |
| No JSON backend remnants | `grep -r "getPermissionDoc\|permissions\[" server/domains/permissions/stores/permissionStore.js` | Zero matches — JSON backend fully removed |
| No path-string in route handlers | `grep -r "folderPath\|filePath" server/domains/permissions/routes/` (excluding tests) | Zero matches in production route code |
| Client build passes | `npm run build -w client` | No compilation errors |
| fileNodesStore.isAncestor() works | `npm run test:unit -w server -- --testPathPattern="fileNodesStore"` | Ancestor chain queries return correct results |

---

## Commit Strategy

Following Execution Rule #3 (commit per task):

```
docs: update Phase 3 permission specs to nodeId signatures
feat(permissionStore): rewrite SQL queries for file_node_id columns
feat(permissionRequestStore): migrate to single fileNodeId field
refactor(aclService): replace path strings with nodeId + closure table inheritance
refactor(permissions): convert ownerPathResolver to ownership via node ancestry
refactor(middleware): update permission middleware to use nodeIdExtractors
refactor(routes): update permission routes for nodeId payloads
refactor(client/permissionService): migrate API calls to nodeId payloads
refactor(client/useSharedManage): replace path-string state with nodeId references
refactor(client/buildPermissionDiff): switch from path Maps to nodeId Maps
test(permissionStore): rewrite tests with nodeId fixtures
test(aclService): add closure table inheritance tests
test(middleware): update permission middleware tests for nodeIds
```

---

## Items Explicitly NOT in Phase 3 Scope

| Item | Deferred To | Reason |
|------|-------------|--------|
| `share_links` table migration | Phase 5 (Task 5.1) | Sharing domain handled separately |
| `recent_files` table migration | Phase 5 (Task 5.3) | RecentFiles domain handled separately |
| GC service for orphaned permission rows | Phase 6 | Not needed — FK CASCADE handles cleanup |
| Existence index reconciliation | Removed | Path-based concept; not applicable with nodeId primary keys |

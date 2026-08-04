# Phase 4 — Wave 4: Permission Legacy Cleanup + Client Migration

## Objective

Remove all path-based compatibility code from the server and migrate client-side permission services to nodeId payloads. This wave eliminates sync checker closures, dual-mode functions, thin wrapper facades, and re-export chains — leaving only the nodeId-based async API as the single path through the permissions layer. Every step is ordered sequentially because removing a function while it is still imported causes runtime crashes.

## Prerequisites

- Wave 3 complete (`phase4-sub-plan-wave3.md`):
  - [ ] All routes accept/return nodeId as primary identifier
  - [ ] Operation flows (list/upload/download/rename/batch/copy-on-write) working against nodeId backend
  - [ ] `fileService.js`, `batchOperationService.js`, `downloadService.js` updated to call aclService nodeId methods where Wave 3 touched them
- Reference: `phase4-sub-plan-wave1.md` through `phase4-sub-plan-wave3.md`

## Critical Execution Order

```
W4.0 (fileService sync checker removal)
    → W4.1 (batchOperationService sync checker removal)
        → W4.2 (downloadService sync checker removal)
            → W4.3 (permissionPolicy compat layer removal)
                → W4.4 (permissionFacade + Permission model cleanup)
                    → W4.5 (aclService re-export removal)
                        → W4.6 (ownerNodeResolver path helper removal)
                            → W4.7–W4.9 (client migration, parallel after server is clean)
```

Each step MUST be verified before proceeding to the next. The grep verification commands are provided per task.

---

## Server-Side Cleanup Sequence

### W4.0: fileService.js Sync Checker Removal

#### Current State Analysis

File: `server/domains/files/services/fileService.js` (~526 lines — verify current line count before migration; all line references below are approximate and must be confirmed against the live file)

**Imports to remove (approx. lines 12-13, verify against live file):**
```js
const { buildSyncWriteChecker, buildSyncReadChecker, buildSyncWriteFileByParentChecker, buildSyncReadFileChecker, isOwnerPath } = require('../../../domains/permissions/services/aclService');
const { getHomeOwnerUserIdForPath } = require('../../../domains/permissions/policy/ownerNodeResolver');
```

**Sync checker usage (lines ~62-68 (verify)):**
```js
const syncCheckers = {};
if (!isShare && !user.is_admin) {
  syncCheckers.canWriteFolder = buildSyncWriteChecker(user, doc);
  syncCheckers.canReadFolder = buildSyncReadChecker(user, doc);
  syncCheckers.canWriteFileByParent = buildSyncWriteFileByParentChecker(user, doc);
  syncCheckers.canReadFile = buildSyncReadFileChecker(user, doc);
}
```

**isOwnerPath + PermissionFacade.sync usage (lines ~60, ~90-91, ~98-99 (verify)):**
```js
// Line 60: currentDirWritePermission check
user.is_admin || isOwnerPath(user, folderPath) || PermissionFacade.checkPermissionSync(doc, folderPath, PERMISSIONS.WRITE)

// Lines 90-91: directory item permissions
hasReadPermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkPermissionSync(doc, normalizedPath, PERMISSIONS.READ);
hasWritePermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkPermissionSync(doc, normalizedPath, PERMISSIONS.WRITE);

// Lines 98-99: file item permissions
hasReadPermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkFilePermissionSync(doc, normalizedPath, PERMISSIONS.READ);
hasWritePermission = isOwnerPath(user, normalizedPath) || PermissionFacade.checkFilePermissionSync(doc, normalizedPath, PERMISSIONS.WRITE);
```

**getHomeOwnerUserIdForPath usage (lines ~195, ~266 (verify)):**
Called during `uploadFile` intermediate directory creation and `renameFile` post-rename owner grant.

#### Migration Steps

1. **Remove lines 12-13 entirely.** After Wave 3, `listDirectoryWithPermissions` receives `parentNodeId` instead of `folderPath`. The function signature becomes:
   ```js
   async function listDirectoryWithPermissions(userId, parentNodeId, user) {
   ```
   The `isShare` parameter was dropped in W1.0-1/W3.0 — share context is resolved server-side from the node's ancestor chain; read-only semantics are not expressed as a separate client flag.
2. **Remove PermissionFacade.getPermissionDoc call (line 42).** This loaded the full doc for sync checks — no longer needed.

3. **Replace `listDirectoryWithPermissions` body:**
   - OLD pattern: Load doc once → create 4 sync closures → iterate items calling closures synchronously
   - NEW pattern: For each child node, await async aclService calls

   ```js
   async function listDirectoryWithPermissions(userId, parentNodeId, user) {
     // 1. Fetch children from file_nodes tree with filecache LEFT JOIN for size/mimeType
     const children = await fileNodeService.listDirectory(parentNodeId);

     if (!children || children.length === 0) {
       return [];
     }

     // 2. Admin bypass: all items get full permissions
     const isAdmin = user && aclService.isAdminUser(user);

     // 3. Enrich each child with permission flags and display path
     const results = [];
     for (const child of children) {
       let hasReadPermission;
       let hasWritePermission;

       if (isAdmin) {
         hasReadPermission = true;
         hasWritePermission = true;
       } else {
         if (child.type === 'directory') {
           hasReadPermission = await aclService.checkFolderPermission(userId, child.id, PERMISSIONS.READ);
           hasWritePermission = await aclService.checkFolderPermission(userId, child.id, PERMISSIONS.WRITE);
         } else {
           hasReadPermission = await aclService.checkFilePermission(userId, child.id, PERMISSIONS.READ);
           hasWritePermission = await aclService.checkFilePermission(userId, child.id, PERMISSIONS.WRITE);
         }
       }

       // Resolve display path from nodeId (used only for UI rendering)
       const nodePath = await fileNodeService.getNodePath(child.id);
       results.push({
         nodeId: child.id,
         name: child.name,
         type: child.type,
         display_path: nodePath || `/${child.name}`,
         size: child.size ?? null,
         mimeType: child.mimeType ?? null,
         modifiedAt: child.modifiedAt ?? null,
         hasReadPermission,
         hasWritePermission,
         isHidden: (child.name || '').startsWith('.'),
         thumbnailUrl, // set via isImageFile/isVideoFile(child.name) — full shape in W3.0
       });
     }

     return results;
   }
   ```

4. **Intermediate-directory grants / post-rename permission rewrites / `getHomeOwnerUserIdForPath`:** already eliminated by the W2.3 factory rewrite and W3.3 rename/move/delete semantics:
   - `uploadFile` no longer creates intermediate directories (W3.1) — no path-based grants to migrate
   - `renameNode` is a DB-only name update; the closure table handles ancestry, so `rewritePermissionsForAllUsers` has no replacement (W3.3)
   - `getHomeOwnerUserIdForPath` was removed in W2.3 — ownership is stored in `file_nodes.owner_id`
   - Verification: `grep -rn "getHomeOwnerUserIdForPath\|rewritePermissionsForAllUsers\|PermissionFacade" server/` → empty (outside permission domain cleanup tasks)

#### Performance Strategy

**Decision: Batch async permission checks via Promise.all().**

Sequential `await` per directory entry would be O(N) round-trips to DB. For directories with 100+ items, this is unacceptable. Instead:

```js
// Batch parallel permission checks — type-discriminated (files vs directories)
const readChecks = children.map(child =>
  child.type === 'directory'
    ? aclService.checkFolderPermission(userId, child.id, PERMISSIONS.READ)
    : aclService.checkFilePermission(userId, child.id, PERMISSIONS.READ)
);
const writeChecks = children.map(child =>
  child.type === 'directory'
    ? aclService.checkFolderPermission(userId, child.id, PERMISSIONS.WRITE)
    : aclService.checkFilePermission(userId, child.id, PERMISSIONS.WRITE)
);

// Fire all in parallel (closure table supports batch IN queries)
const [readResults, writeResults] = await Promise.all([Promise.all(readChecks), Promise.all(writeChecks)]);

// Zip results back onto children
children.forEach((child, i) => {
  child.hasReadPermission = readResults[i];
  child.hasWritePermission = writeResults[i];
});
```

**Optimization note:** If `aclService.checkFolderPermission` already supports batch mode (accepts array of nodeIds), use that instead. Otherwise, add a `checkPermissionsBatch(userId, nodeIds, requiredPermission)` method to aclService as part of this task. This is the preferred long-term path and should be documented in `docs/spec/server/domains/permissions/services/aclService.md`.

#### Verification

```bash
# Must return zero results after W4.0 completion:
grep -n "buildSync\|checkPermissionSync\|isOwnerPath" server/domains/files/services/fileService.js
```

Expected output: (empty)

---

### W4.1: batchOperationService.js Sync Checker Removal

> **Status:** Wave 3 Task W3.4 defined the nodeId-based factory for `batchOperationService` but did not remove the legacy sync checker code from the existing source file. This task performs the actual migration: removing all path-based sync checkers, PermissionFacade calls, and isOwnerPath references from the live `batchOperationService.js`. The Migration Steps below describe what must be done in this Wave 4 task.

#### Current State Analysis

File: `server/domains/files/services/batchOperationService.js` (439 lines)

**Sync checker imports (lines 14-19):**
```js
const {
  buildSyncWriteChecker,
  buildSyncReadChecker,
  buildSyncWriteFileByParentChecker,
  buildSyncReadFileChecker,
} = require('../../permissions/services/aclService');
```

**isOwnerPath import (line 8):**
```js
const { getCachedUser, isOwnerPath } = require('../../permissions/services/aclService');
```

**getHomeOwnerUserIdForPath import (line 20):**
```js
const { getHomeOwnerUserIdForPath } = require('../../permissions/policy/ownerNodeResolver');
```

**Sync checker initialization in runBulkJobWorker (lines 69-73):**
```js
const doc = await PermissionFacade.getPermissionDoc(userId);
const canWriteDirSync = buildSyncWriteChecker(user, doc);
const canWriteFileByParentSync = buildSyncWriteFileByParentChecker(user, doc);
const canReadDirSync = buildSyncReadChecker(user, doc);
const canReadFileSync = buildSyncReadFileChecker(user, doc);
```

**All sync checker call sites:**
- Line 100: `canWriteDirSync(normalizedTargetPath)` — delete operation
- Line 101: `canWriteFileByParentSync(normalizedTargetPath)` — delete file
- Line 124: `isOwnerPath(user, normalizedTargetPath)` — admin bypass for dir deletion
- Lines 135-136: `canEnterDirectory`, `canDeleteFileByParent` callbacks to selectiveDelete
- Lines 216-223: Move operation source/dest permission checks
- Lines 233-234: selectiveTransfer callbacks for move
- Lines 343-352: Copy operation read/write permission checks

**PermissionFacade calls:**
- Line 69: `getPermissionDoc` (for sync checkers — will be removed)
- Line 127: `revokePermissionsPrefixForAllUsers`
- Line 146: `revokePermissionsPrefixForAllUsers`
- Line 250, 259: `rewritePermissionsForAllUsers`
- Lines 268, 379, 389: `grant` with path strings

**getHomeOwnerUserIdForPath calls:**
- Line 266: After move creates directories
- Line 387: After copy creates directories

#### Migration Steps

1. **Remove lines 14-19 (sync checker imports) and line 8's `isOwnerPath` destructuring.**

2. **Replace runBulkJobWorker permission setup (lines 69-73):**
   ```js
   // OLD:
   const doc = await PermissionFacade.getPermissionDoc(userId);
   const canWriteDirSync = buildSyncWriteChecker(user, doc);
   const canReadDirSync = buildSyncReadChecker(user, doc);
   // ...

   // NEW (inline per-item checks):
   // No pre-computed checkers. Each item resolves nodeId → async aclService call.
   ```

3. **Replace delete operation permission checks (lines 97-105):**
   ```js
   // OLD:
   const hasPermission = isDir
     ? canWriteDirSync(normalizedTargetPath)
     : canWriteFileByParentSync(normalizedTargetPath);

   // NEW (W4.1 — migrating from path-based sync checkers to nodeId-based async gates):
   const hasPermission = isDir
     ? await aclService.checkFolderPermission(userId, targetNodeId, PERMISSIONS.WRITE)
     : await aclService.checkFilePermission(userId, targetNodeId, PERMISSIONS.WRITE);
   ```

4. **Replace selectiveDelete callbacks (lines 135-140):**
   ```js
   // OLD:
   const canEnterDirectory = (dirPath) => canWriteDirSync(dirPath);
   const canDeleteFileByParent = (filePath) => canWriteFileByParentSync(filePath);

   // NEW (W4.1 — no selectiveDelete; fileService.deleteNode handles subtrees via closure table):
   // N/A — the nodeId-based factory delegates to fileService.deleteNode/moveNode/copyFile.
   ```

5. **Replace move/copy permission checks** with same pattern: resolve nodeId → `aclService.checkFolderPermission` / `aclService.checkFilePermission`.

6. **Replace all PermissionFacade calls:** Direct to `permissionStore` or `aclService`:
   - `PermissionFacade.grant(userId, path, perm)` → `permissionStore.grant(userId, nodeId, perm)`
   - `PermissionFacade.revokePermissionsPrefixForAllUsers(paths)` → nodeId-based bulk revoke via closure table
   - `PermissionFacade.rewritePermissionsForAllUsers(mappings)` → nodeId-based migration

7. **Replace `isOwnerPath` (line 124):** Use `await ownerNodeResolver.isOwnerNode(userId, targetNodeId)`.

8. **Replace `getHomeOwnerUserIdForPath` (lines 266, 387):** Use `ownerNodeResolver.getUserRootNodeId(username)` — derive username from nodeId ancestor chain via fileNodeService.

#### Verification

```bash
# Must return zero results after W4.1 completion:
grep -n "buildSync\|canWriteDirSync\|canReadDirSync\|canWriteFileByParentSync\|canReadFileSync\|isOwnerPath\|getHomeOwnerUserIdForPath" server/domains/files/services/batchOperationService.js
```

Expected output: (empty)

---

### W4.2: downloadService.js Sync Checker Removal

> **Status:** This task owns the **full rewrite** of `downloadService.js` into the `createDownloadService` factory specified in W1.0-4 (nodeId-based `downloadMultiple(nodeIds, principalId, user, opStore)` + `getDownloadProgress`), integrating progress via the operation-progress store. The migration steps below remove all sync checkers / path resolution as part of that rewrite.

#### Current State Analysis

File: `server/domains/files/services/downloadService.js` (262 lines)

**Sync checker imports (line 9):**
```js
const { isSharePrincipal, buildSyncReadChecker, buildSyncReadFileChecker, checkFolderPermission, checkFilePermission } = require('../../permissions/services/aclService');
```

**PermissionFacade import (line 10):**
```js
const PermissionFacade = require('../../permissions/services/permissionFacade');
```

**Non-share path sync checker initialization (lines 52-56):**
```js
const user = req.user.full;
const doc = await PermissionFacade.getPermissionDoc(principalId);
const canReadDirSync = buildSyncReadChecker(user, doc);
const canReadFileSync = buildSyncReadFileChecker(user, doc);
canEnterDirectory = (dirPath) => canReadDirSync(dirPath);
canIncludeFile = (filePath) => canReadFileSync(filePath);
```

**Share path uses aclService directly (lines 48-49):** Already correct:
```js
canEnterDirectory = (dirPath) => checkFolderPermission('share:' + token, dirPath, PERMISSIONS.READ);
canIncludeFile = (filePath) => checkFilePermission('share:' + token, filePath, PERMISSIONS.READ);
```

#### Migration Steps

1. **Remove `buildSyncReadChecker` and `buildSyncReadFileChecker` from line 9 import.** Keep only `isSharePrincipal`, `checkFolderPermission`, `checkFilePermission`.

2. **Remove PermissionFacade import (line 10).** Not needed after sync checker removal.

3. **Replace non-share block (lines 50-57):**
   ```js
   // OLD:
   const user = req.user.full;
   const doc = await PermissionFacade.getPermissionDoc(principalId);
   const canReadDirSync = buildSyncReadChecker(user, doc);
   const canReadFileSync = buildSyncReadFileChecker(user, doc);
   canEnterDirectory = (dirPath) => canReadDirSync(dirPath);
   canIncludeFile = (filePath) => canReadFileSync(filePath);

   // NEW:
   canEnterDirectory = async (nodeId) => checkFolderPermission(principalId, nodeId, PERMISSIONS.READ);
   canIncludeFile = async (nodeId) => checkFilePermission(principalId, nodeId, PERMISSIONS.READ);
   ```

4. **Update selectiveCollectFiles call** to pass async callbacks instead of sync:
   - The `selectiveDownload.js` module must accept `async (nodeId) => boolean` for `canEnterDirectory` and `canIncludeFile`.
   - If it currently expects sync functions, update it to support async: change internal calls from `callback(path)` to `await callback(nodeId)`.

5. **File path resolution:** removed — the new factory consumes `nodeIds[]` directly (PLAN.md Rule 13). `req.body.nodeIds` is validated as positive integers; there is no `getNodeIdByPath` / `resolvePath` step in the pipeline.

#### Verification

```bash
# Must return zero results after W4.2 completion:
grep -n "buildSync\|getPermissionDoc" server/domains/files/services/downloadService.js
```

Expected output: (empty)

---

### W4.3: permissionPolicy.js Compat Layer Removal

#### Pre-Deletion Verification Command

Run these BEFORE deleting any functions to confirm zero remaining callers in production code:

```bash
# Check for canReadFolder path-based calls (not the nodeId variant):
grep -rn "canReadFolder(" server/ --include="*.js" | grep -v "\.test\." | grep -v "permissionPolicy\.js" | grep -v "canReadFolderNode"

# Check for canWriteFolder path-based calls:
grep -rn "canWriteFolder(" server/ --include="*.js" | grep -v "\.test\." | grep -v "permissionPolicy\.js" | grep -v "canWriteFolderNode"

# Check for canWriteFileByParent calls:
grep -rn "canWriteFileByParent\|hasDirectFolderPermission" server/ --include="*.js" | grep -v "\.test\." | grep -v "permissionPolicy\.js"

# Check for sync checker builder imports outside of files already cleaned (W4.0-W4.2):
grep -rn "buildSyncWriteChecker\|buildSyncReadChecker\|buildSyncWriteFileByParentChecker\|buildSyncReadFileChecker" server/ --include="*.js" | grep -v "\.test\." | grep -v "permissionPolicy\.js"

# Check for canGrantPermission, canRevokePermission, canViewPermissions path-based:
grep -rn "canGrantPermission(\|canRevokePermission(\|canViewPermissions(" server/ --include="*.js" | grep -v "\.test\." | grep -v "permissionPolicy\.js" | grep -v "Node"
```

If any of these return results, **STOP** and migrate the remaining caller before proceeding.

#### Functions Being Removed (detailed list)

> **Warning:** Line numbers in the table below are from a snapshot of `permissionPolicy.js` and may have shifted. Verify each line range against the live file before deletion.

| Function | Lines | Current Callers (production) | Status |
|---|---|---|---|
| `hasDirectFolderPermission` | 111-121 | cleanupService.js:211 (`isOwnerPath`, not this fn directly — verify) | Remove if zero callers |
| `canReadFolder(path)` | 126-131 | None after W4.0-W4.2 | Remove |
| `canReadFile(path)` | 136-141 | None after W4.0-W4.2 | Remove |
| `canWriteFolder(user, path)` | 146-155 | folders.js:35 — MUST migrate first | Blocker |
| `canWriteFileByParent` | 160-169 | None after W4.0-W4.2 | Remove |
| `canGrantPermission(user, path)` | 174-186 | None after W4.0-W4.2 | Remove |
| `canRevokePermission(user, path)` | 191-207 | None after W4.0-W4.2 | Remove |
| `canViewPermissions(user, path)` | 212-225 | None after W4.0-W4.2 | Remove |
| `buildSyncWriteChecker` | 229-235 | Zero callers (W4.0-W4.2 cleaned) | Remove |
| `buildSyncReadChecker` | 237-243 | Zero callers (W4.0-W4.2 cleaned) | Remove |
| `buildSyncReadFileChecker` | 245-251 | Zero callers (W4.0-W4.2 cleaned) | Remove |
| `buildSyncWriteFileByParentChecker` | 253-259 | Zero callers (W4.0-W4.2 cleaned) | Remove |

**Blocker: folders.js line 35 calls `canWriteFolder(user, parentPath)` with path-based arguments.** This is NOT resolved by W3.6 — the actual source file still uses the legacy path-based pattern. Before W4.3 can remove these functions from permissionPolicy.js, folders.js must be migrated to nodeId-based calls (`aclService.checkFolderPermission(principalId, parentNodeId, PERMISSIONS.WRITE)`). If the migration in W3.6 was not applied, perform it as a prerequisite to W4.3:

```js
// VERIFY (must return zero production hits):
// grep -rn "canWriteFolder(user\|canReadFolder(principal\|canGrantPermission(user" server/ --include="*.js" | grep -v "\.test\."
```

> **Diagnostic note:** `aclService.canWriteFolder(user, dirNodeId)` currently accepts a nodeId parameter internally, but `folders.js` passes a path string (`parentPath`). This type mismatch may cause silent failure or unexpected behavior. Confirm whether `canWriteFolder` performs an internal path-to-nodeId lookup (which would mask the bug) or expects a nodeId directly (which would make the current call broken).

#### Functions Being Removed From Imports (line 18)

```js
// REMOVE from line 18:
const { isOwnerNode, isOwnerPath, getHomeOwnerUserIdForPath, userRootPath } = require('./ownerNodeResolver');
// KEEP only:
const { isOwnerNode } = require('./ownerNodeResolver');
```

#### Post-Removal File Structure

> **Note on names:** the retained Tier-1 set below must match the **actual** nodeId-based exports present in `permissionPolicy.js` (verified at execution time — e.g. `canReadFolderNode`, `canWriteFileNode`). Do not invent function names during cleanup; re-run `grep -n "module.exports" -A 25 server/domains/permissions/policy/permissionPolicy.js` and keep only the nodeId-based entries.

After W4.3, `permissionPolicy.js` contains only:

1. **Identity helpers:** `isAdminUser`, `getUserOrNull`
2. **Tier 1 nodeId-based functions (lines 28-102):**
   - `canReadFolderNode(userId, dirNodeId)`
   - `canReadFileNode(userId, fileNodeId)`
   - `canWriteFolderNode(userId, dirNodeId)`
   - `canWriteFileNode(userId, fileNodeId)`
   - `canGrantPermissionNode(userId, targetNodeId)`
   - `canRevokePermissionNode(userId, targetNodeId, targetUserId)`
   - `canViewPermissionsNode(userId, targetNodeId)`

3. **Exports (updated):**
   ```js
   module.exports = {
     isAdminUser,
     getUserOrNull,
     canReadFolderNode,
     canWriteFolderNode,
     canReadFileNode,
     canWriteFileNode,
     canGrantPermissionNode,
     canRevokePermissionNode,
     canViewPermissionsNode,
   };
   ```

#### Verification

```bash
# After deletion, confirm only nodeId-based functions remain in exports:
grep -n "module.exports" -A 20 server/domains/permissions/policy/permissionPolicy.js | grep -v "Node" | grep -E "(canRead|canWrite|canGrant|canRevoke|canView)"

# Must return zero lines — all exported permission functions should have "Node" in their name.
```

---

### W4.4: permissionFacade + Permission Model Cleanup

#### Caller Audit Command

Run this to find ALL remaining imports of both files:

```bash
grep -rn "PermissionFacade\|from.*models/Permission\|require.*models/Permission\|require.*permissionFacade" server/ --include="*.js" | grep -v "\.test\."
```

**Current callers (from evidence):**

| File | Line(s) | Call Pattern | Migration Target |
|---|---|---|---|
| `fileService.js` | 8, 42, 60, 90-91, 98-99, 161, 182, 187, 197, 260, 268 | Multiple: getPermissionDoc, checkPermissionSync, checkFilePermissionSync, grant, rewritePermissionsForAllUsers, getFolderPermissions | All migrated in W4.0 → zero callers remain |
| `batchOperationService.js` | 6, 69, 127, 146, 250, 259, 268, 379, 389 | getPermissionDoc, revokePermissionsPrefixForAllUsers, rewritePermissionsForAllUsers, grant | All migrated in W4.1 → zero callers remain |
| `downloadService.js` | 10, 52 | getPermissionDoc | Migrated in W4.2 → zero callers remain |
| `folders.js` | 7, 54, 62 | grant | MUST migrate: `permissionStore.grant(userId, nodeId, perm)` |
| `test-utils.js` | 12, 119 | PermissionFacade.grant | **MUST migrate BEFORE the facade is deleted** — `test-utils.js` line 12 requires PermissionFacade at module load, so deleting the file first crashes every test (see deletion steps) |

#### Per-Caller Migration Table

| Caller File | Old Call | New Direct Call | Notes |
|---|---|---|---|
| `folders.js:54` | `PermissionFacade.grant(req.user.id, folderPath, PERMISSIONS.WRITE)` | `permissionStore.grant(req.user.id, nodeId, PERMISSIONS.WRITE)` | Requires nodeId from Wave 3 route update |
| `folders.js:62` | `PermissionFacade.grant(homeOwnerId, folderPath, PERMISSIONS.ADMIN)` | `permissionStore.grant(homeOwnerId, nodeId, PERMISSIONS.ADMIN)` | Same |
| `test-utils.js:119` | `PermissionFacade.grant(userId, folderPath, permission)` | `permissionStore.grant(userId, nodeId, permission)` | **Do this in W4.4 before deleting the facade** — also fix the already-broken `grantTestPermission` (`Number(path)` → NaN); move to `grantTestPermissionByNodeId` (W1.1-8) |

#### Deletion Steps

1. **Migrate folders.js first** — this is the last production caller of PermissionFacade outside the three services already cleaned in W4.0-W4.2:
   ```js
   // OLD (folders.js):
   const PermissionFacade = require('../../../domains/permissions/services/permissionFacade');
   await PermissionFacade.grant(req.user.id, folderPath, PERMISSIONS.WRITE);

   // NEW:
   const permissionStore = require('../../../store/permissionStore');
   await permissionStore.grant(req.user.id, nodeId, PERMISSIONS.WRITE);
   ```

2. **Migrate test-utils.js BEFORE deleting the facade** (module-load `require` at `test-utils.js:12` would crash the entire suite once `permissionFacade.js` is gone):
   ```js
   // OLD (test-utils.js:12): const PermissionFacade = require('.../permissionFacade');
   // NEW: const permissionStore = require('.../store/permissionStore');
   // Replace grantTestPermission(folderPath, ...) with grantTestPermissionByNodeId({ userId, fileNodeId, permission })
   // (W1.1-8, object-args contract) using the permissionStore schema (user_id, file_node_id, permission).
   ```

3. **Verify zero production callers:**
   ```bash
   grep -rn "PermissionFacade" server/ --include="*.js" | grep -v "\.test\." | grep -v "permissionFacade\.js"
   # Must return zero results (test-utils migrated in step 2)
   ```

4. **Delete `server/domains/permissions/services/permissionFacade.js`.**

5. **Verify zero production callers of Permission model:**
   ```bash
   grep -rn "require.*models/Permission\|from.*models/Permission" server/ --include="*.js" | grep -v "\.test\." | grep -v "Permission\.js$"
   # Check who imports it — only permissionPolicy.js line 14 and test files should remain
   ```

6. **Migrate `permissionPolicy.js:14`** if it still imports Permission model:
   ```js
   // OLD:
   const Permission = require('../../../models/Permission');
   // NEW (use permStore directly, already imported as permStore on line 17):
   // Remove the Permission import entirely.
   ```

7. **Delete `server/models/Permission.js`** once zero production imports remain.

#### Verification

```bash
# After deletion:
grep -rn "permissionFacade\|from.*models/Permission" server/ --include="*.js" | grep -v "\.test\." | grep -v "^Binary"
# Must return zero results (excluding test files)

ls server/domains/permissions/services/permissionFacade.js 2>/dev/null && echo "STILL EXISTS" || echo "DELETED OK"
ls server/models/Permission.js 2>/dev/null && echo "STILL EXISTS" || echo "DELETED OK"
```

---

### W4.5: aclService.js Re-Export Removal

#### Current State Analysis

File: `server/domains/permissions/services/aclService.js` (218 lines)

**Re-export block (lines 14-20):**
```js
const {
  buildSyncReadChecker,
  buildSyncWriteChecker,
  buildSyncReadFileChecker,
  buildSyncWriteFileByParentChecker,
} = require('../policy/permissionPolicy');
const { isOwnerPath, userRootPath } = require('../policy/ownerNodeResolver');
```

**canAccessPath function (lines 163-183):** Path-based backward compat using `userRootPath`.

**Export block (lines 209-213):** Re-exports the above.

#### Pre-Removal Verification

```bash
# Confirm no production code imports these from aclService:
grep -rn "from.*aclService\|require.*aclService" server/ --include="*.js" | grep -v "\.test\."
# Then for each result, check what it destructures. After W4.0-W4.2, no file should import buildSync* or isOwnerPath from aclService.

grep -rn "buildSyncReadChecker\|buildSyncWriteChecker\|buildSyncReadFileChecker\|buildSyncWriteFileByParentChecker" server/ --include="*.js" | grep -v "\.test\." | grep -v "aclService\.js"
# Must return zero results

grep -rn "isOwnerPath.*from.*aclService\|isOwnerPath.*require.*aclService" server/ --include="*.js" | grep -v "\.test\." | grep -v "aclService\.js"
# Must return zero results (cleanupService.js imports from permissionPolicy, not aclService)
```

#### Migration Steps

1. **Remove lines 14-20** (re-export destructuring block).

2. **Remove `canAccessPath` function (lines 163-183).** This is the last path-based function in aclService. Verify no callers:
   ```bash
   grep -rn "canAccessPath" server/ --include="*.js" | grep -v "\.test\." | grep -v "aclService\.js"
   # Must return zero results before removal
   ```

3. **Update module.exports (lines 190-218):** Remove re-exported names and `canAccessPath`:
   ```js
   // OLD exports include: canAccessPath, isOwnerPath, buildSyncReadChecker, etc.
   // NEW:
   module.exports = {
     isSharePrincipal,
     extractShareToken,
     isAdminUser,
     checkFilePermission,
     checkFolderPermission,
     checkPermission,
     canWriteFolder,
     canWriteFile,
     getCachedUser,
     __clearUserCacheForTests,
   };
   ```

4. **Update `canWriteFolder` and `canWriteFile` (lines 150-160)** — these currently accept a user object with admin bypass. Verify they use nodeId internally:
   ```js
   // Current implementation already uses dirNodeId/fileNodeId params — confirm they work.
   // If not, update to: checkFolderPermission(userId, nodeID, PERMISSIONS.WRITE)
   ```

#### Verification

```bash
grep -n "buildSync\|isOwnerPath\|canAccessPath\|userRootPath" server/domains/permissions/services/aclService.js
# Must return zero results after W4.5 completion
```

---

### W4.6: ownerNodeResolver Path Helper Removal

#### Current State Analysis

File: `server/domains/permissions/policy/ownerNodeResolver.js` (84 lines)

**Functions to remove:**
- `userRootPath(user)` — line 53, returns `/username` from user object
- `isOwnerPath(user, targetPath)` — line 58, path-prefix check against root
- `getHomeOwnerUserIdForPath(folderPath)` — line 65, extracts username from path → finds userId

**Functions to keep:**
- `getUserRootNodeId(userId)` — nodeId-based owner detection
- `isOwnerNode(userId, targetNodeId)` — closure table ancestor check
- `canAccessNode(userId, targetNodeId)` — alias for isOwnerNode

#### Pre-Removal Verification

```bash
# Check remaining callers of path helpers in production code:
grep -rn "isOwnerPath\|userRootPath\|getHomeOwnerUserIdForPath" server/ --include="*.js" | grep -v "\.test\." | grep -v "ownerNodeResolver\.js"

# Expected results after W4.0-W4.3:
# - permissionPolicy.js might still import isOwnerPath (cleaned in W4.3)
# - cleanupService.js imports isOwnerPath from permissionPolicy — defer or migrate
# - folders.js imports getHomeOwnerUserIdForPath — MUST be migrated first
```

**Blocker check:** `folders.js:10-11` still imports `isOwnerPath` and `getHomeOwnerUserIdForPath`. These must be migrated during W4.4 (folders.js PermissionFacade cleanup) or as a prerequisite to W4.6:

```js
// OLD (folders.js):
const { canWriteFolder, isOwnerPath, checkFolderPermission } = require('../../../domains/permissions/services/aclService');
const { getHomeOwnerUserIdForPath } = require('../../../domains/permissions/policy/ownerNodeResolver');

// Line 33: if (!isOwnerPath(user, folderPath))
// NEW: const rootNodeId = await ownerNodeResolver.getUserRootNodeId(userId);
//      const isOwner = await ownerNodeResolver.isOwnerNode(userId, targetNodeId);
//      if (!isOwner) { ... }

// Line 60: const homeOwnerId = await getHomeOwnerUserIdForPath(folderPath);
// NEW: Resolve from nodeId ancestor chain or skip (if folder creation already grants via nodeId)
```

#### Migration Steps

1. **Migrate folders.js** (prerequisite — see blocker check above).

2. **Defer cleanupService.js migration to Phase 5.** `server/domains/admin/services/cleanupService.js` still operates on the legacy path-based `Permission` doc (`Permission.getPermissionDoc`/`Permission.grant`) and `listDirectory(path)` — there is no nodeId path in the current Phase 4 scope for it. Do **not** rewrite it with `fileNodeService.getNodeIdByPath` (that method does not exist — removed per PLAN.md Rule 13). Leave it path-based for now; it is scheduled for a full nodeId rewrite alongside the sharing/admin migration in Phase 5.

3. **Remove path-based functions from `ownerNodeResolver.js`:** Delete lines 49-72 (userRootPath, isOwnerPath, getHomeOwnerUserIdForPath).

4. **Update exports:**
   ```js
   module.exports = {
     getUserRootNodeId,
     isOwnerNode,
     canAccessNode,
   };
   ```

5. **Remove unused imports** from files that no longer need `normalizePath` in this context (only if `normalizePath` was imported solely for path helpers).

#### Verification

```bash
grep -n "userRootPath\|isOwnerPath\|getHomeOwnerUserIdForPath" server/domains/permissions/policy/ownerNodeResolver.js
# Must return zero results after W4.6 completion

# Cross-check: no production file imports these from anywhere:
grep -rn "isOwnerPath\|userRootPath\|getHomeOwnerUserIdForPath" server/ --include="*.js" | grep -v "\.test\."
# Must return zero results
```

---

## Client-Side Migration

### W4.7: permissionService.js nodeId Payloads

#### Method Signature Changes

| Old Signature | New Signature | File:Line |
|---|---|---|
| `grantPermission({ userId, folderPath, permission, target })` | `grantPermission({ userId, nodeId, permission, target })` | L75-80 |
| `revokePermission({ userId, folderPath, includeSubfolders, scope })` | `revokePermission({ userId, nodeId, scope })` | L86-91 |
| `checkPermission(path)` | `checkPermission(nodeId)` | L96-99 |
| `getFolderPermissions(path, includeSubfolders, filePath)` | `getFolderPermissions(nodeId, filePathNodeId)` | L64-69 |
| `listFilePermissions(folderPath)` | `listFilePermissions(parentNodeId)` | L106-110 |

#### API Endpoint Mapping — Old→New Payload Formats

**grantPermission:**
```jsonc
// OLD request body:
{ "userId": 5, "folderPath": "/alice/shared/docs", "permission": "write" }

// NEW request body:
{ "userId": 5, "nodeId": 42, "permission": "write" }
```

**revokePermission:**
```jsonc
// OLD query params (DELETE):
?userId=5&folderPath=/alice/shared/docs&includeSubfolders=true

// NEW query params:
?userId=5&nodeId=42
// includeSubfolders removed — server handles via closure table descendant check automatically
```

**checkPermission:**
```jsonc
// OLD query params (GET):
?path=/alice/shared/docs

// NEW query params:
?nodeId=42
```

**getFolderPermissions:**
```jsonc
// OLD query params:
?path=/alice/shared/docs&includeSubfolders=true

// NEW query params:
?nodeId=42
// includeSubfolders removed — closure table provides inheritance automatically
```

#### Implementation Steps

1. **Update `grantPermission` (line 75):**
   ```js
   // OLD:
   export const grantPermission = async ({ userId, folderPath, permission, target }) => {
     const body = { userId, folderPath, permission };
     if (target != null) body.target = target;
     await post('/permissions/grant', body);

   // NEW:
   export const grantPermission = async ({ userId, nodeId, permission, target }) => {
     const body = { userId, nodeId, permission };
     if (target != null) body.target = target;
     await post('/permissions/grant', body);
   ```

2. **Update `revokePermission` (line 86):**
   ```js
   // OLD:
   export const revokePermission = async ({ userId, folderPath, includeSubfolders = false, scope }) => {
     const params = { userId, folderPath, includeSubfolders: includeSubfolders ? 'true' : 'false' };

   // NEW:
   export const revokePermission = async ({ userId, nodeId, scope }) => {
     const params = { userId, nodeId };
   ```

3. **Update `checkPermission` (line 96):**
   ```js
   // OLD:
   export const checkPermission = async (path) => {
     const response = await get('/permissions/check', { params: { path } });

   // NEW:
   export const checkPermission = async (nodeId) => {
     const response = await get('/permissions/check', { params: { nodeId } });
   ```

4. **Update `getFolderPermissions` (line 64):**
   ```js
   // OLD:
   export const getFolderPermissions = async (path, includeSubfolders = false, filePath) => {
     const params = { path, includeSubfolders: includeSubfolders ? 'true' : 'false' };

   // NEW:
   export const getFolderPermissions = async (nodeId, fileNodeId) => {
     const params = { nodeId };
     if (fileNodeId != null && fileNodeId !== '') params.fileNodeId = fileNodeId;
   ```

5. **Update `listFilePermissions` (line 106):**
   ```js
   // OLD:
   export const listFilePermissions = async (folderPath = null) => {
     const params = folderPath != null ? { folderPath } : {};

   // NEW:
   export const listFilePermissions = async (parentNodeId = null) => {
     const params = parentNodeId != null ? { parentNodeId } : {};
   ```

#### Verification

```bash
# After migration, no client file should reference "folderPath" in permissionService context:
grep -n "folderPath\|includeSubfolders" client/src/services/permissionService.js
# Must return zero results (except JSDoc comments documenting the change)
```

---

### W4.8: useSharedManage + buildPermissionDiff + Gateway Rewrite

#### useSharedManage.js Changes

File: `client/src/hooks/useSharedManage.js`

**State migration:** Replace `targetPath` with `targetNodeId`.

The hook receives `{ targetPath, displayName, isDirectory, ... }` from its caller. After migration, it receives `{ targetNodeId, displayName, isDirectory, ... }`.

```js
// OLD signature:
export function useSharedManage({ open, targetPath, displayName, isDirectory, user, directHasReadPermission, onMessage, onActionComplete, onClose })

// NEW signature:
export function useSharedManage({ open, targetNodeId, displayName, isDirectory, user, directHasReadPermission, onMessage, onActionComplete, onClose })
```

**Key changes inside the hook:**

1. **Line 70-75 (initial load guard):** `targetPath` → `targetNodeId`
2. **Lines 89, 93 (checkPermission calls):** Pass `targetNodeId` instead of path string
3. **Lines 99-106 (parent permission check for files):** Instead of computing parent path via `getParentPath(targetPath)`, resolve the parent nodeId from the file node's parentId field:
   ```js
   // OLD:
   const parentPath = getParentPath(targetPath);
   if (parentPath) {
     const pathResult = await checkPermission(parentPath);

   // NEW:
   const parentNodeId = nodeData?.parentId; // passed from caller or resolved from nodeId
   if (parentNodeId) {
     const pathResult = await checkPermission(parentNodeId);
   ```
4. **Lines 160-165 (pending request state):** `targetPath` in `buildPendingRequestState` → `targetNodeId`

**handleRevokePermission (lines 253-282):**
```js
// OLD:
await revokePermission({ userId: user.id, folderPath: targetPath, includeSubfolders: true });

// NEW:
await revokePermission({ userId: user.id, nodeId: targetNodeId });
```

**handlePermissionRequest (lines 213-250):**
```js
// OLD payload construction:
const payload = isDirectory
  ? { folderPath: targetPath, permission: requestedPermission }
  : { filePath: targetPath, permission: requestedPermission };

// NEW:
const payload = { nodeId: targetNodeId, permission: requestedPermission };
```

#### buildPermissionDiff.js Changes

File: `client/src/utils/buildPermissionDiff.js`

**Map key type change:** From `Map<string, Map<string, string>>` (path → userId → perm) to `Map<number, Map<string, string>>` (nodeId → userId → perm).

```js
// OLD JSDoc:
/**
 * @param {Map<string, Map<string, string>>} params.initialFolderPermissions Path -> (userId -> permission)
 */

// NEW JSDoc:
/**
 * @param {Map<number, Map<string, string>>} params.initialNodePermissions nodeId -> (userId -> permission)
 */
```

**Code changes:**
1. Remove `normalizePath` import — no longer needed for path normalization of keys
2. Rename parameter names in `buildPermissionDiff`: `initialFolderPermissions` → `initialNodePermissions`, `folderPermissions` → `nodePermissions`
3. The `normalizeFolderPermissions` helper becomes a no-op or is removed (line 45-58):
   ```js
   // OLD: normalizes path strings with normalizePath(folderPath)
   // NEW: nodeId integers need no normalization — just copy the map as-is
   function normalizeNodePermissions(map) {
     if (!map) return new Map();
     return map; // nodeIds are already canonical integers
   }
   ```
4. Output object keys change:
   ```js
   // OLD output:
   { userId: 'u1', folderPath: '/a', permission: 'read' }

   // NEW output:
   { userId: 'u1', nodeId: 42, permission: 'read' }
   ```

#### sharePermissionGateway.js Changes

File: `client/src/services/sharePermissionGateway.js`

Every function signature must be updated to use nodeId parameters:

```js
// OLD:
export const getFolderPermissions = async (path, includeSubfolders = false, filePath) => {
  return getFolderPermissionsService(path, includeSubfolders, filePath);
};

// NEW:
export const getFolderPermissions = async (nodeId, fileNodeId) => {
  return getFolderPermissionsService(nodeId, fileNodeId);
};

// OLD:
export const checkPermission = async (path) => {
  return checkPermissionService(path);
};

// NEW:
export const checkPermission = async (nodeId) => {
  return checkPermissionService(nodeId);
};

// OLD:
export const grantPermission = async ({ userId, folderPath, permission, target }) => {
  return grantPermissionService({ userId, folderPath, permission, target });
};

// NEW:
export const grantPermission = async ({ userId, nodeId, permission, target }) => {
  return grantPermissionService({ userId, nodeId, permission, target });
};

// OLD:
export const revokePermission = async ({ userId, folderPath, includeSubfolders, scope }) => {
  return revokePermissionService({ userId, folderPath, includeSubfolders, scope });
};

// NEW:
export const revokePermission = async ({ userId, nodeId, scope }) => {
  return revokePermissionService({ userId, nodeId, scope });
};
```

#### permissionRequestService.js Changes

File: `client/src/services/permissionRequestService.js`

```js
// OLD createPermissionRequest (line 5):
export const createPermissionRequest = async ({ folderPath, filePath, permission, message } = {}) => {
  const body = { permission, message };
  if (filePath != null && filePath !== '') body.filePath = filePath;
  else if (folderPath != null && folderPath !== '') body.folderPath = folderPath;

// NEW:
export const createPermissionRequest = async ({ nodeId, permission, message } = {}) => {
  const body = { nodeId, permission, message };

// OLD checkOwnerExists (line 45):
export const checkOwnerExists = async (folderPathOrFilePath, { forFile = false } = {}) => {
  const params = forFile ? { filePath: folderPathOrFilePath } : { folderPath: folderPathOrFilePath };

// NEW:
export const checkOwnerExists = async (nodeId) => {
  const params = { nodeId };
```

#### Verification

```bash
# After migration, no client file should use "folderPath" or "targetPath" in permission context:
grep -rn "folderPath\|includeSubfolders" client/src/services/permissionService.js client/src/hooks/useSharedManage.js client/src/services/sharePermissionGateway.js client/src/utils/buildPermissionDiff.js client/src/services/permissionRequestService.js | grep -v "\.test\."

# Expected: zero results (all replaced with nodeId equivalents)
```

---

### W4.9: Client Test Rewrites

> **Scope:** In addition to the permission tests below, this task covers the client **file-layer** tests (W4.10 changes): `client/src/services/__tests__/fileService.test.js`, `useBulkOperations.test.js`, `useExplorerCommands.test.js`, `useFileOperations.test.js`, `useDragAndDrop.test.js`, `useDropToUpload.test.js`, `usePreviewLoader.test.js`, and gateway tests. All path-based fixtures become nodeId-based, matching the W4.10 migration and the rewritten MSW handlers.

#### permissionService.test.js Changes

File: `client/src/services/__tests__/permissionService.test.js` (259 lines)

Every test case using path strings in fixtures must be updated to use nodeId integers.

| Test Case | Old Fixture Value | New Fixture Value | Lines |
|---|---|---|---|
| getUserPermissions basic | `folderPath: '/a'` in response data | `nodeId: 10` in response data | L34-42 |
| getUserPermissions dedupe | `folderPath: '/shared'` | `nodeId: 20` | L45-63 |
| getUserPermissions memoize | `folderPath: '/docs'` | `nodeId: 30` | L65-70 |
| getUserPermissions forceRefresh | `folderPath: '/a'` → `'read'`, then `'admin'` | `nodeId: 10` → same perm change | L77-89 |
| getFolderPermissions basic | `/docs` path, params include `path: '/docs', includeSubfolders: 'false'` | nodeId `42`, params `{ nodeId: '42' }` | L93-103 |
| getFolderPermissions with filePath | `filePath: '/docs/file.txt'` | `fileNodeId: 55` | L105-113 |
| grantPermission basic | `folderPath: '/a'` in body | `nodeId: 10` in body | L116-130 |
| grantPermission file target | `folderPath: '/a/file.txt', target: 'file'` | `nodeId: 20, target: 'file'` | L132-148 |
| grantPermission cache invalidation | `folderPath: '/a'` in responses | `nodeId: 10` | L150-167 |
| revokePermission basic | `folderPath: '/a', includeSubfolders: 'false'` params | `nodeId: 10` params (no includeSubfolders) | L170-183 |
| revokePermission file scope | `folderPath: '/a/file.txt', scope: 'pathOnly'` | `nodeId: 20, scope: 'pathOnly'` | L185-203 |
| revokePermission cache invalidation | `folderPath: '/a'` in responses | `nodeId: 10` | L204-221 |
| checkPermission basic | `{ path: '/a', ... }`, query param `path: '/a'` | `{ nodeId: 10, ... }`, query param `nodeId: '10'` | L223-237 |
| listFilePermissions no filter | params `{}` (unchanged) | params `{}` — same | L239-248 |
| listFilePermissions with folderPath | `folderPath: '/docs'` param | `parentNodeId: '42'` param | L250-258 |

#### buildPermissionDiff.test.js Changes

File: `client/src/utils/__tests__/buildPermissionDiff.test.js` (123 lines)

All Map keys change from path strings to nodeId integers. Output objects use `nodeId` instead of `folderPath`.

| Test Case | Old Key/Output | New Key/Output | Lines |
|---|---|---|---|
| Empty initial → grants | `Map([['/a', ...], ['/b', ...]])`, output `{ folderPath: '/a' }` | `Map([[10, ...], [20, ...]])`, output `{ nodeId: 10 }` | L8-28 |
| Folder empty → revokes | Keys `/a`, `/b`; output `{ folderPath: '/a' }` | Keys `10`, `30`; output `{ nodeId: 10 }` | L30-51 |
| Removed user assignment | Key `/a`; revoke `{ userId: 'u2', folderPath: '/a' }` | Key `10`; revoke `{ userId: 'u2', nodeId: 10 }` | L53-68 |
| Permission change | Key `/a`; grant `{ folderPath: '/a', permission: 'write' }` | Key `10`; grant `{ nodeId: 10, permission: 'write' }` | L70-84 |
| Extra user assignment | Key `/a`; grants include `{ folderPath: '/a' }` | Key `10`; grants include `{ nodeId: 10 }` | L86-107 |
| Path normalization | Key `/a//`; output normalizes to `{ folderPath: '/a' }` | **Remove this test** — nodeIds need no normalization | L109-122 |

#### Verification

```bash
# Run client tests after migration (use --watchAll=false — react-scripts watch would hang in CI):
cd client && npm run test -- --watchAll=false --testPathPatterns="permissionService|buildPermissionDiff|fileService|useBulkOperations|useExplorerCommands|useFileOperations" --no-coverage

# All tests must pass. If any fail, diagnose per Section 3.2 (RCA) before modifying implementation.
```

---

### W4.10: Client File-Layer Migration (nodeId payloads)

> **Source:** PLAN.md Task 4.8i. This is the client counterpart to the server nodeId migration (W3.6). All client file operations switch from path identifiers to `nodeId`/`parentNodeId`. It depends on W3.6 (server nodeId contracts), W4.7/W4.8 (permission layer), and the MSW handler rewrite below.

#### service layer — `client/src/services/fileService.js`

All file-layer functions migrate to nodeId payloads (`API_BASE` stays `/files`):

| Function | Current (path) | New (nodeId) |
|---|---|---|
| `listFiles` (L25-33) | params `{ path, shareToken? }` | `{ nodeId, shareToken? }` |
| `getFilesMetadata` (L40-55) | `paths: string[]` | `nodeIds: number[]` |
| `getFileBlob` (L57-69) | `filePath` param | `nodeId` param |
| `getVideoPreviewStreamUrl` (L79-95) | `filePath` param | `nodeId` param |
| `downloadFile` (L97-162) | `path` based | `nodeId` based |
| `uploadFileWithPath` (L164-186) → rename `uploadFile` | FormData `file, path, relativePath?, onConflict?` | FormData `file, parentNodeId, relativePath?, onConflict?` |
| `uploadMultipleFiles` (L188-272) | builds nested `path` | builds `parentNodeId` + `relativePath` per file |
| `renameFile` (L274-280) | `{ oldPath, newName }` | `{ nodeId, newName }` |
| `createFolder` (L282-292) | `folderPath` param | `parentNodeId` + `name` params |
| `getFolderStats` (L294-299) | `folderPath` param | `nodeId` param |
| `checkConflicts` (L306-313) | `operations` keyed by path | operations keyed by `nodeId` |
| `downloadMultipleFiles` (L326-477) | `paths: string[]` | `nodeIds: number[]` |
| `requestThumbnailsBatch` (L516-526) | `paths: string[]` | `nodeIds: number[]` |
| `batchDeleteFiles` (L528-531) | `{ paths }` | `{ nodeIds }` |
| `batchMoveFiles` (L534-537) | `moves: [{ sourcePath, destinationPath }]` | `moves: [{ sourceNodeId, destinationParentNodeId }]` |
| `batchCopyFiles` (L540-543) | same | same as batchMoveFiles |

Display paths (`display_path` from server responses) are used **only** for breadcrumbs/UI, never as request identifiers.

#### gateways

- `explorerGateway`, `folderTreeGateway`, `folderPickerGateway`: path-based lookup replaced by nodeId-based; folder tree builds children via `listFiles(nodeId)`.

#### hooks

- `useBulkOperations` (L302-306): move/copy payloads built from `file.path` → `file.nodeId` (destination nodeId from the target folder's selected node)
- `useExplorerCommands`: rename/delete/copy/move invoke the nodeId service functions
- `useFileOperations` (L173-174): **remove the client-side path recompute on rename** — the server returns the updated node with `display_path`; no local `path` bookkeeping
- `useDragAndDrop` / `useDropToUpload`: drop targets resolve `parentNodeId` instead of destination path
- `usePreviewLoader`: preview requests use `nodeId`
- `useShareDialog`: already migrated to `targetNodeId` by W4.8

#### components / state keying

- FileManager list/table components keyed on `file.path` → `file.nodeId`
- Breadcrumb navigation: path segments → nodeId chain (resolved via `getNodePath`/parent ids from list responses)
- `FileActionSheet` actions pass `nodeId` to hooks/services

#### mocks

- `client/src/mocks/handlers.js`: mirror the nodeId contracts — list/download/upload/rename/batch endpoints read `nodeId`/`parentNodeId`; move/copy/delete endpoints return `{ nodeId, display_path }`

#### dependencies & order

1. Server nodeId contracts live (W3.6) and MSW handlers rewritten
2. `permissionService`/`useSharedManage`/gateways nodeId-based (W4.7, W4.8)
3. Then this task migrates the file layer; tests (W4.9) are rewritten in lockstep

#### Verification

```bash
# No client request may send path identifiers for file operations:
grep -rn "path:" client/src/services/fileService.js client/src/services/explorerGateway.js client/src/services/folderTreeGateway.js client/src/services/folderPickerGateway.js client/src/pages/FileManager/hooks/useBulkOperations.js client/src/pages/FileManager/hooks/useFileOperations.js | grep -v "\.test\."
# Expected: only display-path usage remains (no request payload identifiers)

cd client && npm run test -- --watchAll=false --testPathPatterns="fileService|useBulkOperations|useExplorerCommands|useFileOperations|useDragAndDrop|useDropToUpload|usePreviewLoader" --no-coverage
# All nodeId-based client tests pass
```

---

## Plan Update Guide

After each task completes, update this section:

### Completed Tasks

| Task | Status | Verification Command Passed? | Notes |
|---|---|---|---|
| W4.0 fileService.js cleanup | ⬜ Pending | `grep -n "buildSync\|checkPermissionSync" server/domains/files/services/fileService.js` → empty | |
| W4.1 batchOperationService.js cleanup | ⬜ Pending | `grep -n "buildSync\|isOwnerPath" server/domains/files/services/batchOperationService.js` → empty | |
| W4.2 downloadService.js cleanup | ⬜ Pending | `grep -n "buildSync\|getPermissionDoc" server/domains/files/services/downloadService.js` → empty | |
| W4.3 permissionPolicy.js compat removal | ⬜ Pending | See Pre-Deletion Verification section above | |
| W4.4 PermissionFacade + Permission model deletion | ⬜ Pending | `grep -rn "PermissionFacade" server/ --include="*.js" \| grep -v "\.test\."` → empty (test-utils migrated in W4.4 step 2, before facade deletion) | |
| W4.5 aclService.js re-export removal | ⬜ Pending | `grep -n "buildSync\|isOwnerPath\|canAccessPath" server/domains/permissions/services/aclService.js` → empty | |
| W4.6 ownerNodeResolver path helper removal | ⬜ Pending | `grep -rn "isOwnerPath\|userRootPath\|getHomeOwnerUserIdForPath" server/ --include="*.js" \| grep -v "\.test\."` → empty | |
| W4.7 permissionService.js nodeId migration | ⬜ Pending | `grep -n "folderPath\|includeSubfolders" client/src/services/permissionService.js` → empty | |
| W4.8 useSharedManage + buildPermissionDiff + gateway rewrite | ⬜ Pending | `grep -rn "folderPath\|targetPath" client/src/hooks/useSharedManage.js client/src/utils/buildPermissionDiff.js client/src/services/sharePermissionGateway.js` → empty (except display path for UI) | |
| W4.9 Client test rewrites | ⬜ Pending | `cd client && npm run test -- --watchAll=false --testPathPatterns="permissionService\|buildPermissionDiff\|fileService\|useBulkOperations\|useExplorerCommands\|useFileOperations"` → all pass | |
| W4.10 Client file-layer migration | ⬜ Pending | `grep -rn "path:" client/src/services/fileService.js client/src/services/explorerGateway.js client/src/services/folderTreeGateway.js client/src/services/folderPickerGateway.js client/src/pages/FileManager/hooks/useBulkOperations.js client/src/pages/FileManager/hooks/useFileOperations.js` → no request-identifier usage | |

---

## Execution Log Template

```markdown
### [Date] — Task W4.X: [Name]
- **Started:** HH:MM
- **Completed:** HH:MM
- **Files modified:** file1, file2, ...
- **Verification command output:** (paste grep results)
- **Issues encountered:** (none / description + resolution)
```

---

## Hypothesis Revisions Template

```markdown
### [Date] — Hypothesis Revision for W4.X

**Previous hypothesis:** Based on [Evidence], it was likely that [Component] would behave as [Expected]. Therefore [Action] was taken.

**Contradicting evidence:** [Observation from verification step, test failure, or runtime error]

**Revised hypothesis:** Based on [New Evidence], [Component] actually [Corrected Understanding]. Therefore [Corrected Action] is required.
```

---

## Handoff to Wave 5

- [ ] Zero sync checker imports remain in production code (verified by grep)
- [ ] `permissionFacade.js` deleted — all callers use direct store/service calls (test-utils migrated first)
- [ ] `Permission.js` model deleted — only `permissionStore.js` remains as source of truth
- [ ] `aclService.js` exports only nodeId-based methods (`checkFilePermission`, `checkFolderPermission`, etc.)
- [ ] `ownerNodeResolver.js` has no path-based functions (only `getUserRootNodeId`, `isOwnerNode`, `canAccessNode`)
- [ ] Client sends/reads nodeId in all permission API calls
- [ ] Client sends/reads nodeId in all file-operation API calls (W4.10) — no path request identifiers remain
- [ ] MSW handlers mirror the nodeId contracts (W4.10)
- [ ] All client tests pass with nodeId fixtures
- [ ] Server test suite passes (`npm run test:ci` in server/)
- [ ] Client test suite passes (`npm run test:ci` in client/)

Wave 5 will:
- Run full CRUD integration tests against SQLite backend
- Add test utility helpers (`createTestFileNode`, `grantTestPermissionByNodeId`) to `test-utils.js`
- Final verification of complete Phase 4 scope including end-to-end file operations with nodeId-based permissions

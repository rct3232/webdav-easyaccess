# Phase 4 — Wave 6: Client Shared UI nodeId Migration

## Objective

Migrate the four remaining client-side shared-folder components from `folder_path` to `nodeId`. These files were deferred from Wave 4 Task 6 (`phase4-wave4-fix-plan.md` line 331) because they were not in the original Task 6 file list. The server already returns `{ nodeId, permission }` payloads exclusively — these four components read `perm.folder_path` which is now `undefined`, causing silent runtime failures in the shared-folders UI.

## Prerequisites

- Wave 4 complete (`phase4-sub-plan-wave4.md`): All gateway layer files migrated to nodeId
  - [x] `userUtils.js`: `isUserOwnFolder(nodeId, user)`, `filterOutUserOwnFolders(data, user)` use nodeId comparison
  - [x] `explorerGateway.js`: `loadSharedEntries` reads `permission.nodeId` and `{ file_node_id }`
  - [x] `folderTreeGateway.js` / `folderPickerGateway.js`: delegate to `filterOutUserOwnFolders`
  - [x] `Breadcrumb.js`: nodeId-based shared permission logic (fix plan G5)
  - [x] MSW handlers: seeded with `{ nodeId, permission }` fixtures
- Wave 5 complete (`phase4-sub-plan-wave5.md`): Server integration tests passing
- Reference: `client/src/services/sharePermissionGateway.js`, `client/src/utils/userUtils.js`

## Critical Execution Order

```
W6.0 (SharedFoldersSection — Map key change, simplest)
    → W6.1 (deriveFolderPickerSharedState — guard + map key)
        → W6.2 (useFolderTreeController — shared tree builder rewrite)
            → W6.3 (useShareDialog — 3-mode migration, most complex)
                → W6.4 (test fixtures batch cleanup)
```

Each step MUST be verified before proceeding to the next. The grep verification commands are provided per task.

---

## Server Response Contract (source of truth)

The following API endpoints return nodeId-based payloads (verified from live server code):

### `GET /api/permissions/user/:userId` → `folderPermissions.js:109`

```js
// Returns: [{ nodeId: <number>, permission: 'read'|'write'|admin' }, ...]
const permissions = rawPermissions.map(p => ({ nodeId: p.file_node_id, permission: p.permission }));
```

**No `folder_path`, no `id`, no `username` fields.**

### `GET /api/permissions/folder?nodeId=...&includeDescendants=true` → `folderPermissions.js:188-191`

```js
// Returns: [{ userId, username, email, is_admin, permission, node_id }, ...]
res.json(permissions.map(perm => ({
  ...perm,
  node_id: perm.node_id || null,
})));
```

Returns user objects with `node_id` — NOT `folder_path`. The `permissionStore.getFolderPermissions()` returns rows from `permissions_user_paths` / `permissions_user_files` which have `(user_id, file_node_id, permission)` columns.

---

## Task W6.0: SharedFoldersSection nodeId Migration

> **PREREQUISITE**: None (simplest task — Map key change only)

#### Current State Analysis

File: `client/src/components/folder-tree/SharedFoldersSection.js` (144 lines)

**Line 43:**
```js
const sharedFoldersMap = new Map(sharedFolders.map(perm => [perm.folder_path, perm]));
```

The `sharedFolders` prop comes from `useFolderTreeController` → `folderTreeGateway.getUserSharedFolderPermissions({ user })` → `permissionService.getUserPermissions(userId)` → server returns `{ nodeId, permission }[]`.

**Impact:** `perm.folder_path` is `undefined`. The map becomes `{ undefined: [...], ... }`. All downstream lookups by path fail silently.

#### Migration Steps

1. **Change Map key from `folder_path` to `nodeId`:**
   ```js
   // OLD (line 43):
   const sharedFoldersMap = new Map(sharedFolders.map(perm => [perm.folder_path, perm]));
   
   // NEW:
   const sharedFoldersMap = new Map(sharedFolders.map(perm => [String(perm.nodeId), perm]));
   ```
   String coercion ensures numeric nodeIds work as object keys.

2. **Verify no other `folder_path` reads exist in this file:** grep confirms line 43 is the only occurrence.

3. **Prop compatibility check:** The component receives `sharedFoldersMap` via props to `BaseFolderTreeItem`. Verify that `BaseFolderTreeItem.js` uses `sharedFoldersMap.get(path)` — if so, confirm the caller passes nodeId-based keys. If BaseFolderTreeItem still uses path-based keys, this task is incomplete and W6.2 must run first.

#### Verification

```bash
grep -n "folder_path\|\.filePath" client/src/components/folder-tree/SharedFoldersSection.js
# Expected: empty (exit 1)

cd client && CI=true npx react-scripts test --watchAll=false --no-coverage --testPathPattern="SharedFoldersSection"
# All pass
```

#### Test File Updates Required

`client/src/components/folder-tree/__tests__/SharedFoldersSection.test.js`:
- Lines 20-21: Replace `{ folder_path: '/__shared__/docs', permission: 'read' }` with `{ nodeId: 10, permission: 'read' }`
- Update any assertions that check `folder_path` in rendered output

---

## Task W6.1: deriveFolderPickerSharedState nodeId Migration

> **PREREQUISITE**: None (independent helper function)

#### Current State Analysis

File: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js` (54 lines)

**Line 22:**
```js
if (!permission?.folder_path) { return; }
```
Guard skips ALL permissions because none have `folder_path`. The entire shared-folders section of folder picker becomes empty.

**Line 26:**
```js
permissionMap.set(normalizePath(permission.folder_path), permission);
```
Builds a path-keyed map — produces `{ undefined: [...] }` entries.

**Lines 30-47:** Build `sharedFolders` array from path parts:
```js
const sharedFolders = sharedFolderRoots.map((normalizedPath) => {
    const pathParts = normalizedPath.split('/').filter(Boolean);
    const name = pathParts[pathParts.length - 1] || normalizedPath;
    // ... returns { path, basename, name, type: 'directory', hasReadPermission, hasWritePermission }
});
```

**Root cause:** This function is entirely path-based. With nodeId payloads, the `split('/')` tree-building logic cannot work — there's no parent-child relationship from nodeIds alone without a file_nodes lookup. The correct approach is to return permission objects keyed by nodeId and let the caller (folder picker) resolve display names via separate API calls or pre-loaded data.

#### Migration Steps

1. **Replace path-based guard with nodeId check:**
   ```js
   // OLD:
   if (!permission?.folder_path) { return; }
   permissionMap.set(normalizePath(permission.folder_path), permission);
   
   // NEW:
   if (permission?.nodeId == null) { return; }
   permissionMap.set(String(permission.nodeId), permission);
   ```

2. **Rewrite `sharedFolders` output to use nodeId:** The current code builds `{ path, basename, name }` objects from path strings. With nodeId data, we need:
   - nodeId as the primary key
   - Display name resolution requires additional data (from a separate nodes list or API call)
   
   For minimal change, produce `{ nodeId, displayName, hasReadPermission, hasWritePermission }`:
   ```js
   const sharedFolders = Array.from(permissionMap.entries()).map(([nodeIdStr, permission]) => ({
     nodeId: parseInt(nodeIdStr, 10),
     // DisplayName from pre-loaded node metadata if available; fallback to nodeId string
     displayName: permission._displayName || `Node ${nodeIdStr}`,
     hasReadPermission: true,
     hasWritePermission: permission?.permission === PERMISSIONS.WRITE
       || permission?.permission === PERMISSIONS.ADMIN,
   }));
   ```

3. **Rewrite `getTopLevelSharedFolderRoots` for nodeId:** The current function filters path prefixes (`parentPath = '/' + parts.slice(0, i).join('/')`). With nodeIds, "top-level" means a permission whose nodeId is NOT an ancestor of another permission's nodeId — this requires closure table data which the client doesn't have. 
   
   **Simplification:** Since the folder picker shows all shared folders flat (no hierarchical tree), return all permission nodeIds directly:
   ```js
   function getTopLevelSharedFolderRoots(permissionMap) {
     // All permissions are shown; hierarchy is resolved by caller
     return Array.from(permissionMap.keys());
   }
   ```

4. **Rename `sharedPermissionPaths` to `sharedPermissionNodeIds`:** The output set should contain nodeId strings, not paths.

#### Verification

```bash
grep -n "folder_path\|\.filePath" client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js
# Expected: empty (exit 1)

cd client && CI=true npx react-scripts test --watchAll=false --no-coverage --testPathPattern="deriveFolderPickerSharedState"
# All pass
```

#### Test File Updates Required

`client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/deriveFolderPickerSharedState.test.js`:
- Lines 7-9: Replace `{ folder_path: '/shared/root/', permission: 'write' }` with `{ nodeId: 10, permission: 'write' }`
- Update assertions to check `nodeId` instead of `path`

---

## Task W6.2: useFolderTreeController nodeId Migration

> **PREREQUISITE**: W6.0 (SharedFoldersSection uses its output)

#### Current State Analysis

File: `client/src/components/folder-tree/hooks/useFolderTreeController.js` (211 lines)

**Line 70 — `buildSharedFolderTree`:**
```js
const normalized = normalizePath(perm.folder_path);
permissionPaths.set(normalized, perm);
```
Builds a path-keyed map for tree construction. With nodeId payloads, `normalizePath(undefined)` returns garbage.

**Lines 74-96 — Tree building:**
```js
pathMap.forEach((perm, normalizedPath) => {
    const parts = normalizedPath.split('/').filter(Boolean);
    // ... parent-child resolution via path prefix matching
});
```
Entirely path-based tree construction. Cannot work with nodeId alone without a nodes metadata lookup.

**Line 132 — Shared path detection:**
```js
const isSharedPath = sharedFolders.some((perm) => currentPath.startsWith(perm.folder_path));
```
Checks if current path starts with any shared folder's path. With nodeId, this needs to check if the current nodeId's ancestor chain includes a permission nodeId.

#### Migration Strategy

The `buildSharedFolderTree` function currently builds a hierarchical tree from path strings by splitting on `/`. Since the client doesn't have closure table data locally, and the server response is flat `{ nodeId, permission }[]`, we have two options:

**Option A (simplest):** Return flat list of shared permissions. The folder-tree component already handles display via `listFolderChildren` API which returns hierarchical data with display names. The "shared" section just needs to show what folders are shared — no tree building required.

**Option B (preserves hierarchy):** Pre-load node metadata for each permission nodeId via `fileService.getNode(nodeId)` to get `{ name, parentId }`, then build the tree from that data. This requires additional API calls and state management.

**Decision: Option A.** The current tree-building logic is a client-side optimization that duplicates server-side hierarchy. With nodeId payloads, the correct approach is to show shared permissions as a flat list (or use display paths resolved at render time).

#### Migration Steps

1. **Replace `buildSharedFolderTree` with flat list builder:**
   ```js
   // OLD (lines 65-113): path-based tree construction
   
   // NEW: Return array of { nodeId, permission, displayName } objects
   const buildSharedFolderList = useMemo(() => {
     if (sharedFolders.length === 0) return [];
     return sharedFolders.map((perm) => ({
       nodeId: perm.nodeId,
       permission: perm.permission,
       // DisplayName resolved from node metadata if available; fallback to nodeId
       displayName: perm._displayName || `Shared (${perm.nodeId})`,
     }));
   }, [sharedFolders]);
   ```

2. **Fix line 132 — shared path detection:** Replace `currentPath.startsWith(perm.folder_path)` with a nodeId-based check. Since the folder tree uses path strings for navigation (`/alice/docs`), and permissions use nodeIds, we need to compare against the current node's id:
   ```js
   // OLD:
   const isSharedPath = sharedFolders.some((perm) => currentPath.startsWith(perm.folder_path));
   
   // NEW: Check if any permission nodeId matches the resolved nodeId for current path.
   // Since useFolderTreeController doesn't have direct nodeId→path resolution,
   // compare against a set of known shared nodeIds.
   const isSharedNode = currentNodeId && sharedFolders.some((perm) => 
     String(perm.nodeId) === String(currentNodeId)
   );
   ```

3. **Update return value:** Replace `buildSharedFolderTree` with `sharedFolderList`. Callers that iterate the tree need to adapt (W6.0 SharedFoldersSection already handles flat list).

#### Verification

```bash
grep -n "folder_path\|\.filePath" client/src/components/folder-tree/hooks/useFolderTreeController.js
# Expected: empty (exit 1)

cd client && CI=true npx react-scripts test --watchAll=false --no-coverage --testPathPattern="useFolderTreeController"
# All pass
```

#### Test File Updates Required

`client/src/components/folder-tree/hooks/__tests__/useFolderTreeController.test.js`:
- Lines 113-114: Replace `{ folder_path: '/shared/root', permission: 'read' }` with `{ nodeId: 20, permission: 'read' }`
- Line 126: Update assertion from `toMatchObject({ folder_path: '/shared/root', ... })` to `toMatchObject({ nodeId: 20, ... })`
- Lines 190, 248: Same fixture replacements

---

## Task W6.3: useShareDialog nodeId Migration

> **PREREQUISITE**: W6.0, W6.1 (simplest tasks first; share dialog is most complex)

#### Current State Analysis

File: `client/src/components/dialogs/ShareDialog/hooks/useShareDialog.js` (553 lines)

Three modes all read `perm.folder_path`:

**Line 181 — Admin mode:**
```js
const normalizedPath = normalizePath(perm.folder_path);
// perm from sharePermissionGateway.getUserPermissions(userId) → server returns { nodeId, permission }[]
```

**Lines 220-232 — Review mode:**
```js
const permData = await sharePermissionGateway.getFolderPermissions(rootPath, true);
(permData || []).forEach(perm => {
    const normalizedPath = normalizePath(perm.folder_path);
    // ... builds newFolderPermissions Map keyed by path
});
// getFolderPermissions(rootPath, true) → server /permissions/folder?nodeId=...&includeDescendants=true
// Returns [{ userId, username, email, is_admin, permission, node_id }, ...]
```

**Lines 285-296 — Share mode:**
Same pattern as review mode.

#### Core Problem

The share dialog uses a **path-keyed Map** (`newFolderPermissions: Map<path, Map<userId, permission>>`) to track permissions per folder. The entire UI (folder tree expansion, user-permission toggles) is keyed by path strings. Migrating to nodeId requires either:

1. Keep the path-based UI but resolve nodeIds back to display paths at load time
2. Re-key everything to nodeId and add a nodeId→displayPath resolution layer

**Decision:** Option 1 (resolve nodeId → displayPath). The share dialog's internal state is deeply tied to path strings for folder tree navigation, user interaction, and save diff computation. Changing the entire key system would require rewriting `usePermissionManager`, `buildPermissionDiff`, `ShareDialog.js` component — far beyond Wave 6 scope.

#### Migration Steps

1. **Admin mode (line 181):** After loading permissions via `sharePermissionGateway.getUserPermissions(userId)`, resolve each nodeId to a display path:
   ```js
   // OLD:
   const normalizedPath = normalizePath(perm.folder_path);
   
   // NEW: Resolve nodeId to display path using fileNodeService.getNodePath() or cached metadata
   const nodeMetadata = await listFiles(perm.nodeId, { /* options */ });
   // OR: Use a pre-loaded nodeId→path map from the explorer context
   ```
   
   **Simpler approach:** Since admin mode already has `rootPath` and loads subfolders recursively via `loadFolderChildren(path)`, we can build a nodeId→path mapping from that data. The `listFiles(nodeId)` response includes `{ nodeId, display_path }`. Cache this mapping and use it to resolve permission nodeIds.

2. **Review/Share mode (lines 220-232, 285-296):** `getFolderPermissions(rootPath, true)` returns user objects with `node_id`. The current code builds a path-keyed Map from `perm.folder_path` — but `rootPath` IS the path. For review/share mode, all permissions are scoped to `rootPath` and its descendants (loaded via `loadAllSubfoldersRecursive`). The permission data's `node_id` can be matched against subfolder nodeIds:
   ```js
   // OLD:
   const normalizedPath = normalizePath(perm.folder_path);
   
   // NEW: Match perm.node_id to a known folder path from the loaded tree
   const matchingNode = Array.from(folderTree.entries()).find(([path, node]) => 
     node.nodeId === perm.node_id || node.id === perm.node_id
   );
   const normalizedPath = matchingNode ? matchingNode[0] : rootPath;
   ```

3. **Remove `normalizePath` import** if no longer used after migration.

4. **Update permission data flow:** The `newFolderPermissions` Map structure (`Map<path, Map<userId, perm>>`) remains unchanged — only the key resolution changes from `folder_path` to nodeId→path lookup.

#### Verification

```bash
grep -n "folder_path\|\.filePath" client/src/components/dialogs/ShareDialog/hooks/useShareDialog.js
# Expected: empty (exit 1)

cd client && CI=true npx react-scripts test --watchAll=false --no-coverage --testPathPattern="useShareDialog"
# All pass
```

#### Test File Updates Required

`client/src/components/dialogs/ShareDialog/hooks/__tests__/useShareDialog.test.js`:
- Line 493: Replace `{ folder_path: '/docs', permission: 'read', id: '2' }` with `{ nodeId: 10, permission: 'read' }` (admin mode)
- Line 534: Same for review/share mode test

---

## Task W6.4: Test Fixtures Batch Cleanup

> **PREREQUISITE**: W6.0–W6.3 complete

#### Objective

Ensure all test files that mock permission data use nodeId-shaped objects instead of `folder_path`. Run the full client test suite to verify no remaining path-based fixtures cause failures.

#### Files Requiring Updates (from audit)

| Test File | Lines with `folder_path` fixture | Replacement Shape |
|-----------|----------------------------------|-------------------|
| `useShareDialog.test.js` | 493, 534 | `{ nodeId: <num>, permission: 'read' }` |
| `SharedFoldersSection.test.js` | 20-21 | `{ nodeId: <num>, permission: '...' }` |
| `useFolderTreeController.test.js` | 113-114, 126, 190, 248 | `{ nodeId: <num>, permission: '...' }`, assertion on line 126 also updated |
| `deriveFolderPickerSharedState.test.js` | 7-9 | `{ nodeId: <num>, permission: '...' }` |

#### Steps

1. Update each test file's mock data to use `{ nodeId, permission }` shape.
2. For `useFolderTreeController.test.js` line 126: Change assertion from `expect(...).toMatchObject({ folder_path: '/shared/root', ... })` to `expect(...).toMatchObject({ nodeId: <expected>, ... })`.
3. Run each test suite individually and verify passing.

#### Verification

```bash
grep -rn "folder_path" client/src/components/folder-tree/ client/src/components/dialogs/ShareDialog/ client/src/components/dialogs/FolderPickerDialog/ --include="*.test.js"
# Expected: empty (exit 1) — only display-path usage in non-permission contexts

cd client && CI=true npx react-scripts test --watchAll=false --no-coverage \
  --testPathPattern="useShareDialog|SharedFoldersSection|useFolderTreeController|deriveFolderPickerSharedState"
# All pass
```

---

## Plan Update Guide

After each task completes, update the Completed Tasks table below and check off Handoff items.

### Completed Tasks

| Task | Status | Verification Command Passed? | Notes |
|---|---|---|---|
| W6.0 SharedFoldersSection nodeId migration | ⬜ Pending | `grep -n "folder_path" client/src/components/folder-tree/SharedFoldersSection.js` → empty (exit 1) | |
| W6.1 deriveFolderPickerSharedState nodeId migration | ⬜ Pending | `grep -n "folder_path" client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js` → empty (exit 1) | |
| W6.2 useFolderTreeController nodeId migration | ⬜ Pending | `grep -n "folder_path" client/src/components/folder-tree/hooks/useFolderTreeController.js` → empty (exit 1) | |
| W6.3 useShareDialog nodeId migration | ⬜ Pending | `grep -n "folder_path" client/src/components/dialogs/ShareDialog/hooks/useShareDialog.js` → empty (exit 1) | |
| W6.4 test fixtures batch cleanup | ⬜ Pending | `grep -rn "folder_path" client/src/components/folder-tree/ client/src/components/dialogs/ --include="*.test.js"` → empty (exit 1) | |

---

## Execution Log Template

```markdown
### [Date] — Task W6.X: [Name]
- **Started:** HH:MM
- **Completed:** HH:MM
- **Files modified:** file1, file2, ...
- **Verification command output:** (paste grep results)
- **Issues encountered:** (none / description + resolution)
```

---

## Hypothesis Revisions Template

```markdown
### [Date] — Hypothesis Revision for W6.X

**Previous hypothesis:** Based on [Evidence], it was likely that [Component] would behave as [Expected]. Therefore [Action] was taken.

**Contradicting evidence:** [Observation from verification step, test failure, or runtime error]

**Revised hypothesis:** Based on [New Evidence], [Component] actually [Corrected Understanding]. Therefore [Corrected Action] is required.
```

---

## Handoff to Phase 5

- [ ] Zero `folder_path` reads remain in client permission-related source code (verified by grep — all exit 1)
- [ ] All four deferred files migrated: SharedFoldersSection, deriveFolderPickerSharedState, useFolderTreeController, useShareDialog
- [ ] Corresponding test fixtures updated to nodeId shape
- [ ] Client test suite passes (`CI=true npm run test:ci` in client/) — shared-folder suites verified green
- [ ] `phase4-wave4-fix-plan.md` line 331 deferred items resolved

Phase 5 (Sharing & RecentFiles → Node ID) can begin after:
1. This file's completion checklist is all checked off ✅
2. No open `folder_path` references remain in client permission domain
3. All wave plan files are updated with final execution logs
4. `docs/fail_log.md` contains Wave 6 RCA entries if any incidents occurred

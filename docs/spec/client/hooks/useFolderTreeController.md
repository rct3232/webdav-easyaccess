# useFolderTreeController Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Folder-tree section controller: loads and maintains “**shared**” + “**recent**” data, manages expansion state for tree nodes, and exposes view-ready handlers plus controller-owned derived shared-tree data for Phase 4. |
| Used by components/pages | `client/src/components/folder-tree/FolderTree.js`                                                                                                                                                                         |
| Ownership note           | This hook owns folder-tree section loading/expansion coordination only. It must not become a UI component or own product overlay policies beyond what `FolderTree` already supports.                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/hooks/useFolderTreeController.js`
- **Test file:** `client/src/components/folder-tree/hooks/__tests__/useFolderTreeController.test.js`

> **NodeId-first controller:** the controller uses nodeId-first state — `expandedNodeIds`, `currentNodeId`, `onNodeClick(nodeId)` — and shared folders are keyed by nodeId (the permissions API already returns nodeId). Virtual roots `/__shared__` and `/__recent__` remain unchanged (decision D1).

### 2.2 Input Parameters

| Name          | Type     | Required | Description                                                                                                                                                                |
| ------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| currentNodeId | number   | Y        | Current explorer node id (drives which sections/nodes should be marked expanded). Virtual-root routes (`__shared__`/`__recent__`) keep their route-based selection per D1. |
| user          | object   | Y        | Current user (drives whether shared/recent sections can load).                                                                                                             |
| onNodeClick   | function | Y        | Called when the controller wants to navigate via the host: `(nodeId) => void`. Also used to navigate to the `__shared__`/`__recent__` virtual-root routes.                 |

### 2.3 Return Value / State

| Key                     | Type                                                                                                                                         | Meaning                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| homeNodeId              | number                                                                                                                                       | Host "home" folder node id (admin -> root node id, others -> user home node id).                                                                                                                                           |
| expandedNodeIds         | Set<number>                                                                                                                                  | Expanded folder node ids for the main tree and shared section items.                                                                                                                                                       |
| onToggleExpand          | (nodeId: number) => void                                                                                                                     | Toggles expansion for an individual folder node id.                                                                                                                                                                        |
| sharedFolders           | Array<{ nodeId: number, permission: string }>                                                                                                | Shared-folder permission entries (filtered), keyed by nodeId, used by the shared tree builder.                                                                                                                             |
| sharedExpanded          | boolean                                                                                                                                      | Whether the “**shared**” section is expanded.                                                                                                                                                                              |
| handleSharedToggle      | (e: any) => void                                                                                                                             | Stops propagation and toggles “**shared**” expanded state (and navigates to `/__shared__` when expanding).                                                                                                                 |
| handleSharedClick       | () => void                                                                                                                                   | Navigates to `/__shared__`.                                                                                                                                                                                                |
| handleSharedFolderClick | (nodeId: number) => void                                                                                                                     | Navigates to a specific shared folder by nodeId.                                                                                                                                                                           |
| buildSharedFolderTree   | () => Array<{ nodeId: number, name: string, children: any[], parentNodeId: number \| null, permission: string, hasReadPermission: boolean }> | Derived shared-tree structure consumed by `SharedFoldersSection`. Nodes are keyed by nodeId; the interim synthetic `/__shared__/<nodeId>` path entries are removed. Extraction to a standalone pure helper is future work. |
| recentExpanded          | boolean                                                                                                                                      | Whether the “**recent**” section is expanded.                                                                                                                                                                              |
| handleRecentToggle      | (e: any) => void                                                                                                                             | Stops propagation and toggles “**recent**” expanded state.                                                                                                                                                                 |
| handleRecentClick       | () => void                                                                                                                                   | Navigates to `/__recent__`.                                                                                                                                                                                                |
| recentFilesList         | Array<any>                                                                                                                                   | Current recent files list consumed by `RecentFilesSection` (nodeId-first since Phase 5).                                                                                                                                   |

### 2.4 Dependencies

- Services called / IO boundaries:
- `getRecentFiles` from `client/src/services/recentFilesRepository`
- `onRecentFilesChange` from `client/src/services/recentFilesNotifier`
- `folderTreeGateway.getUserSharedFolderPermissions` from `client/src/services/folderTreeGateway` (returns nodeId-keyed permission entries)
- Pure utilities:
- `normalizePath` only where path normalization still applies (virtual-root checks; no longer used to build synthetic shared-folder paths)
- `user.rootNodeId` to compute the user home node id (admin -> null root listing)

### 2.5 Side Effects

- On mount / whenever `user` changes:
- Loads recent files when `user` is present
- Subscribes to recent-file updates via `onRecentFilesChange`, reloading on updates
- Clears recent files when `user` becomes falsy
- On mount / whenever `user` changes:
- Loads shared-folder permissions for non-admin users (nodeId-keyed entries)
- Clears shared-folder permissions for admin users
- Whenever `currentNodeId`, `user homeNodeId`, or `sharedFolders` changes:
- Recomputes `expandedNodeIds` to include the current node's ancestor node ids and `homeNodeId`
- Sets `sharedExpanded` to `true` when the current location is the `/__shared__` virtual root or within a shared folder node subtree
- Sets `recentExpanded` to `true` when the current location is `/__recent__`
- Manual toggles:
- `handleSharedToggle` and `handleRecentToggle` allow the user to collapse/expand sections after auto-expansion has been derived from location state

### 2.6 Error Handling

- Recent-files loading errors:
- The controller expects `recentFilesRepository.getRecentFiles()` to resolve to a contract-safe array (`[]` on ordinary IO failure).
- The local `try/catch` remains a defensive guard for unexpected exceptions and still falls back to `[]`.
- Shared-folder loading errors:
- Log and set `sharedFolders` to `[]`

### 2.7 Verification Scenarios

The following should be covered by `useFolderTreeController` unit tests (renderHook):

- Initial `recentFilesList` loads for a non-null `user`.
- When `user` becomes falsy, `recentFilesList` becomes `[]`.
- `onRecentFilesChange` triggers a reload of recent files.
- The notifier subscription returns a callable cleanup function that the controller can invoke safely on unmount.
- Shared folders load for non-admin users, and do not load for admin users.
- Repository-provided empty recent results still keep `recentFilesList` array-safe.
- Shared-folder load failure falls back to `[]`.
- `expandedNodeIds` includes `homeNodeId` and the current node's ancestor node ids when `currentNodeId` is set.
- Falsy `currentNodeId` leaves `expandedNodeIds` with only `homeNodeId`.
- Setting the current location to `/__shared__` sets `sharedExpanded` to `true`.
- Setting the current location to a shared folder node subtree sets `sharedExpanded` to `true`.
- Setting the current location to `/__recent__` sets `recentExpanded` to `true`.
- `handleSharedToggle` toggles `sharedExpanded` and calls `onNodeClick` for the `/__shared__` route when transitioning to expanded.
- `handleRecentClick` and `handleSharedFolderClick` navigate through the host callback with the expected location (virtual-root route / nodeId).

### 2.8 Edge Cases

- `currentNodeId` is empty/falsy: `expandedNodeIds` contains only `homeNodeId`.
- Shared permission entries are keyed by nodeId; the shared-tree builder no longer normalizes synthetic paths. Shared folders with the same nodeId must not duplicate.

---

## 3. AI-platform virtual-node registration (AI platform)

Addendum per docs/features/collections-platform.md §3.1/§4.9 (archive lifecycle) and `CollectionsListView.md` §2.2; extends the D1 virtual-root pattern (`__shared__`/`__recent__` semantics unchanged).

- **`__collections__` section:** new controller-owned section state mirroring §2.3 (`collectionsExpanded`, `handleCollectionsToggle`, `handleCollectionsClick` → navigate `/files/__collections__`). Expansion renders a **flat collection list** (rows host-prepared via `useCollections`/gateway; no IO added here beyond the existing seams); **members are never tree-walked — depth = 1** (collection ≠ folder in the tree).
- **As-built API surface (T0.4):** inputs additionally take `currentPath` (pre-existing) which the §3 location rules key off; returns `collectionsExpanded`, `collectionsTreeRows` (server `activity` order verbatim), `newCollectionIds`, `handleCollectionsToggle`, `handleCollectionsClick`, `handleCollectionClick(collectionId)`, `handleArchiveClick`. IO goes through `explorerGateway.loadCollections({ sort: 'activity', include: 'mine,shared' })` — a single read (the former second `mine,archived` badge-count read was removed with the §11 follow-up, owner ruling 2026-10-01) plus `subscribeToCollections` refresh (CollectionsSection §2.5 boundary satisfied: the section component stays import-free).
- **As-built new-dot cursor (CollectionsSection §2.6):** `localStorage['collections.lastVisitedAt']` (epoch ms). Rows with `created_at` after the cursor get `newCollectionIds`; navigating to `/__collections__` writes the cursor (dots clear). No record ⇒ no dots.
- **`__archive__` child row:** nested under `__collections__`, routes `/files/__collections__/__archive__`; selecting it lists the `status=archived` set (`include=mine,archived`) — restore/permanent-delete affordances live in `CollectionsListView`, not the tree.
- **Selection → route/view mapping:** these virtual roots keep `currentNodeId` falsy (route-based selection per D1); the mapping "active node `__collections__`/`__archive__` ⇒ `CollectionsListView` replaces the FileList region" is owned by `FileManagerView.md` §3 / the shell — this controller only marks section expansion/selection state. Auto-expansion follows the §2.5 location rule (current location within a collections route ⇒ `collectionsExpanded = true`, same as `sharedExpanded`).
- Subscribes to collection changes independently (per `useCollections.md` ownership note): notifier events refresh the flat list rows only; no card mutations from the tree.

Verification (appends §2.7):

- [x] (as-built T0.4) `handleCollectionsToggle` expands and navigates the route; `handleArchiveClick` selects `/files/__collections__/__archive__` (host target string `/__collections__/__archive__`).
- [x] (as-built T0.4) Location `/files/__collections__/…` auto-expands the section; collection members never appear as tree rows (depth-1 assertion — rows come only from the flat `loadCollections` read).

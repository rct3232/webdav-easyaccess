# explorerGateway Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Explorer IO boundary. Owns the low-level listing, capability, metadata, and recent-files persistence helpers required by explorer controllers. Provides a replaceable adapter layer over current service/repository/browser-storage calls. |
| Used by | `useFileManager` (listing seam), `useExplorerNavigation`, `useExplorerCommands`, `useRecentFile`, and other explorer-focused controller hooks. |
| Does not own | Product overlays or routing policy such as share-link UX, virtual collection selection (`__recent__`, `__shared__`), share-dialog workflows, or page-shell composition. Callers decide *when* a special collection is active; the gateway only performs the requested IO. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/explorerGateway.js`
- **Test file:** `client/src/services/__tests__/explorerGateway.test.js`

### 2.2 Main Functions

All file/folder references are nodeId-based (`nodeId`, `parentNodeId` are BIGINT `file_nodes.id` values, not path strings).

| Function | Input | Return | Notes |
|----------|-------|--------|------|
| listDirectory | `({ nodeId, options? })` | `Promise<Array<object>>` | Lists directory children via `fileService.listFiles(nodeId)`. `nodeId` may be `null`/omitted to list the root level (server resolves `parentNodeId = null`). Handles share-token forwarding and hidden-file policy at this seam instead of in controller hooks. Each row passes through the server-computed permission flags, including `hasAdminPermission` (admin bypass / owner / explicit admin grant — computed server-side; see `docs/spec/server/services/fileService.md`). The gateway no longer enriches the listing via `getUserPermissions`. |
| canNavigateToNode | `(nodeId, options?)` | `Promise<boolean>` | Permission/availability check for explorer navigation via `getPathAccess({ nodeId })`. |
| getPathAccess | `({ nodeId, options? })` | `Promise<{ canRead: boolean, canWrite: boolean, raw?: object }>` | Raw access facts via `permissionService.checkPermission(nodeId)`, with `canRead`/`canWrite` derived from `hasRead`/`hasWrite`. |
| getEntriesMetadata | `({ entries, options? })` | `Promise<Array<object>>` | Enriches file entries with metadata via `fileService.getFilesMetadata(nodeIds)` (nodeIds collected from `entry.nodeId`). |
| loadRecentFiles | `(options?: object)` | `Promise<Array<object>>` | Loads recent-file repository entries via `recentFilesRepository.getRecentFiles`. |
| loadSharedEntries | `({ user, options? })` | `Promise<Array<object>>` | Loads the `__shared__` collection data from `GET /api/permissions/shared` (server excludes the user's own subtree and returns real `name`/`type`), splits into directory and file-only entries, dedupes by `nodeId`, and enriches file entries with metadata. |
| addRecentFile | `(file: object, options?: object)` | `Promise<object>` | Records preview/open activity in the recent-files repository. |
| removeRecentFile | `(path: string, options?: object)` | `Promise<object>` | Removes a recent-files repository entry (recent-files entries are still keyed by path; Node-ID migration of recent files is Phase 5 scope). |
| subscribeToRecentFiles | `((callback: () => void)) => (() => void)` | `function` | Subscribes to recent-file change notifications for explorer listing hooks. |
| checkConflicts | `({ operations, parentNodeId, files, options? })` | `Promise<Array<object>>` | Preflight conflict detection. Accepts prebuilt `operations` or derives them from `files` + `parentNodeId` (`sourceNodeId`, `destinationParentNodeId`, `fileName`). |
| uploadToPath | `({ parentNodeId, files, onProgress, onConflict?, options? })` | `Promise<object>` | Uploads files into the `parentNodeId` directory via `fileService.uploadMultipleFiles(files, parentNodeId, onProgress, onConflict, options)`. Progress and conflict behavior preserved. |

Notes:

- Controllers may compose multiple gateway calls, but they must not bypass the gateway for explorer-related IO.
- `explorerGateway` may expose additional narrow helpers only when a controller needs them and the helper still represents explorer IO rather than product policy.
- Virtual collections remain product decisions. For example, the shell may decide that `currentPath === '/__recent__'` means “load recent entries, enrich them, then render them”; the gateway only supplies the IO helpers used by that flow.
- `loadSharedEntries` is still an IO helper, not product policy. The shell or listing seam decides when `__shared__` is active; the gateway only returns the shared entries for that requested flow.
- **Bulk move/copy/delete/download are NOT part of this gateway.** Orchestration lives in `useBulkOperations` (via `handleFolderPickerSelect`, `handleBulkDelete`, `handleBulkDownload`) and the command hooks in `docs/spec/client/hooks/useExplorerCommands.md`. The legacy `renamePath` / `movePaths` / `copyPaths` / `deletePaths` / `downloadPaths` gateway functions were removed; the equivalent nodeId-based operations are dispatched by `useBulkOperations` (`handleBulkMove`, `handleBulkCopy`, `handleBulkDelete`, `handleBulkDownload`) against the file batch routes.
- Listing-policy helpers such as hidden-file preference lookup may be resolved at this boundary when needed to keep controller hooks storage-free. `useExplorerSession` still owns sort/view preference persistence, and unrelated ancillary service lookups stay outside this gateway.

### 2.3 Error Handling

- Errors must preserve the same error codes and user-visible outcomes as today.
- The gateway should not display UI; it should return structured errors that callers can map to dialogs/snackbars.

### 2.4 Dependencies

- Existing service functions (file listing, uploads, metadata lookups, permission/capability checks), permission listing helpers, recent-files repository/notifier helpers, and transport/storage adapters are internal to this gateway.
- The gateway is the explorer IO boundary: explorer controller hooks must not import those low-level modules directly.
- View components and pure helpers must not import the gateway directly; they consume prepared data/callbacks from controller hooks.

### 2.5 Verification Scenarios

Verify observable IO behavior from the caller perspective:

- [ ] `listDirectory({ nodeId })` returns the same entries as the current listing behavior for a given node (including permission flags and hidden-file behavior as currently implemented), with `hasAdminPermission` taken from the server response rather than recomputed from `getUserPermissions`.
- [ ] `canNavigateToNode(nodeId)` returns the same read/forbidden outcome the shell used before the extraction.
- [ ] `getPathAccess({ nodeId })` preserves the current read/write capability facts used by explorer flows.
- [ ] `getEntriesMetadata` preserves the current metadata enrichment behavior used when recent/shared-derived lists need extra entry data.
- [ ] `loadRecentFiles`, `addRecentFile`, `removeRecentFile`, and `subscribeToRecentFiles` preserve the existing recent-files persistence and notifier behavior from the caller perspective.
- [ ] `loadSharedEntries` preserves the current `__shared__` collection behavior for top-level folders, file-only entries, and file metadata enrichment, and uses real node names (`permission.name`) rather than `node-<id>` / `file-<id>` placeholders.
- [ ] `checkConflicts` returns the same conflict entries as the current preflight conflict check for the same operations list.
- [ ] `uploadToPath({ parentNodeId, files })` triggers the same conflict behavior and supports the same progress integration points as today.
- [ ] Move/copy/delete/download flows dispatch nodeId-based operations through `useBulkOperations` rather than this gateway.

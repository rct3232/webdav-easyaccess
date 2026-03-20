# explorerGateway Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Explorer IO boundary. Owns the low-level listing, capability, metadata, and recent-files persistence helpers required by explorer controllers. Provides a replaceable adapter layer over current service/repository/browser-storage calls (and future WebDAV IO). |
| Used by | `useFileManager` (listing/path seam), `useExplorerNavigation`, `useExplorerCommands`, `useRecentFile`, and other explorer-focused controller hooks. |
| Does not own | Product overlays or routing policy such as share-link UX, virtual collection selection (`__recent__`, `__shared__`), share-dialog workflows, or page-shell composition. Callers decide *when* a special collection is active; the gateway only performs the requested IO. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/explorerGateway.js`
- **Test file:** `client/src/services/__tests__/explorerGateway.test.js`

### 2.2 Main Functions

This gateway should stay narrow, but it must be broad enough that explorer hooks stop importing service, repository, or browser-storage modules directly.

The exact function names may differ, but the final target seam must cover these responsibilities:

| Function | Input | Return | Notes |
|----------|-------|--------|------|
| listDirectory | `({ path, options? })` | `Promise<Array<object>>` | Wraps current directory listing behavior. Used by the listing/path seam and by recent-file recovery when a parent folder needs to be checked. The gateway keeps share-token forwarding and hidden-file policy inputs at this seam instead of in controller hooks. |
| canNavigateToPath | `(path: string, options?: object)` | `Promise<boolean>` | Permission/availability check for explorer navigation. Must preserve the current read-allowed vs forbidden behavior without shell-owned direct imports. |
| getPathAccess | `({ path, options? })` | `Promise<{ canRead: boolean, canWrite: boolean, raw?: object }>` | Optional capability helper for listing/navigation decisions when callers need more than a boolean. Keep this about raw access facts, not product policy. |
| getEntriesMetadata | `({ entries, options? })` | `Promise<Array<object>>` | Enriches already-known entries with metadata needed by explorer-derived lists such as `__recent__` and `__shared__`. The gateway performs metadata IO; callers decide when special collections should use it. |
| loadRecentFiles | `(options?: object)` | `Promise<Array<object>>` | Loads recent-file repository entries for explorer flows. Replaces direct `recentFilesRepository` imports in explorer hooks. |
| loadSharedEntries | `({ user, options? })` | `Promise<Array<object>>` | Loads the `__shared__` collection data needed by explorer listing: top-level shared folders, file-only shared entries, and any metadata enrichment required for file rows. The gateway performs permission/file-metadata IO while callers still decide when the product overlay activates `__shared__`. |
| addRecentFile | `(file: object, options?: object)` | `Promise<object>` | Records preview/open activity in the recent-files repository. |
| removeRecentFile | `(path: string, options?: object)` | `Promise<object>` | Removes stale recent entries during recovery/error handling without `useRecentFile` importing the repository directly. |
| subscribeToRecentFiles | `((callback: () => void)) => (() => void)` | `function` | Subscribes to recent-file change notifications for explorer listing hooks while the recent collection is active. |
| checkConflicts | `({ operations, options? })` | `Promise<Array<object>>` | Preflight conflict detection for uploads/move/copy flows. Must preserve the same conflict identification behavior and limits used today. |
| uploadToPath | `({ targetPath, files, options? })` | `Promise<object>` | Upload files to a path. Must preserve conflict behavior and progress integration hooks used today. |
| renamePath | `({ path, newName, options? })` | `Promise<object>` | Rename operation for file/folder. |
| movePaths | `({ paths, targetPath, options? })` | `Promise<object>` | Move operation (bulk-capable). |
| copyPaths | `({ paths, targetPath, options? })` | `Promise<object>` | Copy operation (bulk-capable). |
| deletePaths | `({ paths, options? })` | `Promise<object>` | Delete operation (bulk-capable). |
| downloadPaths | `({ paths, options? })` | `Promise<object>` | Download operation (bulk-capable). |

Notes:

- Controllers may compose multiple gateway calls, but they must not bypass the gateway for explorer-related IO.
- `explorerGateway` may expose additional narrow helpers only when a controller needs them and the helper still represents explorer IO rather than product policy.
- Virtual collections remain product decisions. For example, the shell may decide that `currentPath === '/__recent__'` means “load recent entries, enrich them, then render them”; the gateway only supplies the IO helpers used by that flow.
- `loadSharedEntries` is still an IO helper, not product policy. The shell or listing seam decides when `__shared__` is active; the gateway only returns the shared entries for that requested flow.
- Listing-policy helpers such as hidden-file preference lookup may be resolved at this boundary when needed to keep controller hooks storage-free. `useExplorerSession` still owns sort/view preference persistence, and unrelated ancillary service lookups stay outside this gateway.

### 2.3 Error Handling

- Errors must preserve the same error codes and user-visible outcomes as today.
- The gateway should not display UI; it should return structured errors that callers can map to dialogs/snackbars.

### 2.4 Dependencies

- Existing service functions (file listing, file ops, bulk ops, permission/capability checks, metadata lookups), permission listing helpers, recent-files repository/notifier helpers, and transport/storage adapters are internal to this gateway.
- The gateway is the explorer IO boundary: explorer controller hooks must not import those low-level modules directly.
- View components and pure helpers must not import the gateway directly; they consume prepared data/callbacks from controller hooks.

### 2.5 Verification Scenarios

Verify observable IO behavior from the caller perspective:

- [ ] `listDirectory` returns the same entries as the current listing behavior for a given path (including permission flags and hidden-file behavior as currently implemented).
- [ ] `canNavigateToPath` returns the same read/forbidden outcome the shell used before the extraction.
- [ ] `getPathAccess` preserves the current read/write capability facts used by explorer flows.
- [ ] `getEntriesMetadata` preserves the current metadata enrichment behavior used when recent/shared-derived lists need extra entry data.
- [ ] `loadRecentFiles`, `addRecentFile`, `removeRecentFile`, and `subscribeToRecentFiles` preserve the existing recent-files persistence and notifier behavior from the caller perspective.
- [ ] `loadSharedEntries` preserves the current `__shared__` collection behavior for top-level folders, file-only entries, and file metadata enrichment.
- [ ] `checkConflicts` returns the same conflict entries as the current preflight conflict check for the same operations list.
- [ ] `uploadToPath` triggers the same conflict behavior and supports the same progress integration points as today.
- [ ] `renamePath`, `movePaths`, `copyPaths`, `deletePaths`, `downloadPaths` produce the same success/error outcomes as current service calls.


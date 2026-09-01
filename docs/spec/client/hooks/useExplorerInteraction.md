# useExplorerInteraction Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Explorer interaction controller for FileManager: item click/open behavior, action-sheet/context-menu affordances, desktop double-click handling, and explorer-specific file-open flows including recent-file special cases. |
| Used by components/pages | `client/src/pages/FileManager/FileManager.js`                                                                                                                                                                               |
| Does not own             | Generic explorer command orchestration, progress state, or share-link overlay modal state.                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerInteraction.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerInteraction.test.js`

### 2.2 Input Parameters

`useExplorerInteraction(params)`

| Name                     | Type                                                 | Required | Description                                                                                                                  |
| ------------------------ | ---------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| isMobile                 | boolean                                              | Y        | Determines desktop vs mobile click semantics.                                                                                |
| isShareLinkMode          | boolean                                              | Y        | Applies share-link-specific interaction policy.                                                                              |
| selectionMode            | boolean                                              | Y        | Current explorer selection mode.                                                                                             |
| displayedFiles           | Array<object>                                        | Y        | Current visible file list used for desktop selection indexing.                                                               |
| toggleFileSelection      | (file: object) => void                               | Y        | Selection toggle callback.                                                                                                   |
| handleFileClickSelection | (file: object, event: object, index: number) => void | Y        | Desktop selection-click handler from `useSelection`.                                                                         |
| enterSelectionMode       | () => void                                           | Y        | Enters selection mode for long-press.                                                                                        |
| setSelectedFiles         | (set: Set<number>) => void                           | Y        | Setter for selected file nodeIds (keyed by `file.nodeId`).                                                                   |
| navigateToExplorerPath   | (path: string) => Promise<void> \| void              | Y        | Generic explorer navigation from `useExplorerNavigation`.                                                                    |
| openExplorerFolder       | (nodeId: number) => Promise<void> \| void            | Y        | Folder-open entry point from `useExplorerNavigation` (by nodeId).                                                            |
| openPreviewDialog        | () => void                                           | Y        | Opens preview dialog.                                                                                                        |
| setSelectedFile          | (file: object) => void                               | Y        | Sets currently previewed / context-selected file.                                                                            |
| setContextMenu           | (state: object) => void                              | Y        | Shell-owned desktop context-menu setter.                                                                                     |
| setActionSheetFile       | (file: object) => void                               | Y        | Mobile action-sheet opener.                                                                                                  |
| actionSheetFile          | object                                               | N        | Currently selected action-sheet file, used for preview.                                                                      |
| showError                | (message: string) => void                            | Y        | Shell-owned message surface.                                                                                                 |
| t                        | function                                             | Y        | Translation function.                                                                                                        |
| recentFileApi            | object                                               | N        | Recent-file-specific callbacks (`trackRecentFileClick`, `clearTracking`, `handleRecentFileError`, `setRecentFileToPreview`). |
| handleProductPathClick   | (path: string) => Promise<boolean> \| boolean        | N        | Product-policy hook used to intercept path clicks before generic explorer navigation.                                        |

### 2.3 Return Value / State

| Key                      | Type                                                       | Meaning                                                                            |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| handlePathClick          | (path: string) => Promise<void> \| void                    | Path click handler that applies product policy before generic explorer navigation. |
| handleFileClick          | (file: object, event?: object, fileIndex?: number) => void | Main file-item click handler matching current desktop/mobile semantics.            |
| handleMoreClick          | (file: object, event?: object) => void                     | Opens action sheet or desktop context menu.                                        |
| handleLongPressSelect    | (file: object) => void                                     | Mobile long-press selection entry point.                                           |
| handleActionSheetPreview | () => void                                                 | Opens preview for the current mobile action-sheet file.                            |

### 2.4 Responsibilities

- **Owns**
  - Desktop/mobile click semantics and double-click detection.
  - Folder-open vs preview behavior for files/directories.
  - Product-aware interaction branching for share-link mode and recent-file special cases, while keeping those policies injected rather than hard-coded into explorer navigation.
  - Context-menu / action-sheet opening behavior tied to a file item.
- **Does not own**
  - Bulk command execution or dialog completion flows.
  - Progress drawer state.
  - Share-link overlay modal state (login, add-to-my-permissions, leave-share confirm).

> **Note:** Selection, long-press, and double-click detection are keyed by `getEntryKey(file)` (`file.nodeId` when present, else `file.path`). Recent-file click branches (`file.isRecentFile`) are nodeId-first since Phase 5: when `file.nodeId` is present they navigate/open by nodeId and only fall back to the path-based branch for legacy entries that lack a nodeId.

### 2.5 Dependencies

- Pure helpers: `canPreview`, `normalizePath`, file-type/path helpers
- Explorer gateway for recent-file persistence when a normal file preview should be recorded
- Error utilities for preserving current user-visible error mapping
- Shell-/controller-owned callbacks for recent-file behavior and product navigation policy

### 2.6 Side Effects

- May add files to recent-files persistence through the explorer gateway.
- May set preview/dialog/context state through injected setters.
- May call navigation callbacks and surface translated errors.

### 2.7 Error Handling

- Permission-denied and missing-path errors must map to the same user-visible messages as today.
- Recent-file failures must preserve the current remove-from-recent / preview cancellation behavior.

### 2.8 Verification Scenarios

These scenarios should be covered by a dedicated hook unit test in `client/src/pages/FileManager/hooks/__tests__/useExplorerInteraction.test.js`, not only by FileManager page regression tests.

- [ ] Desktop single click, double click, Ctrl/Meta click, and Shift click keep current observable selection/open behavior.
- [ ] Mobile tap and long-press keep current open/select behavior.
- [ ] Recent-file directory and file clicks preserve current open/preview behavior: nodeId-first navigation when `file.nodeId` is present, with the path fallback reserved for entries without a nodeId.
- [ ] Share-link mode path clicks bypass generic explorer navigation only in the same product-defined cases as today.
- [ ] More button opens the same desktop/mobile affordance without entering selection mode.

### 2.9 Edge Cases

- Empty file/path input is a no-op.
- Recent-file entries lacking a nodeId use the path-based fallback branch and preserve current error behavior (nodeId entries never hit the path branch).
- Double-click detection resets after a confirmed open so later clicks do not re-trigger stale state.

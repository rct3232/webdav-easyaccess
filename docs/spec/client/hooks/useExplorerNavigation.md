# useExplorerNavigation Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Explorer navigation controller: owns explorer nodeId transitions (folder navigation, breadcrumb navigation, open-folder from list/grid/detail) and any optimistic/rollback behavior required to preserve current UX. It coordinates navigation decisions, but it does not own listing or product-overlay policy. |
| Used by components/pages | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`) |
| Does not own | Search/sort/view session derivation (`useExplorerSession`), directory listing state (`useFileManager` or equivalent listing seam), command orchestration (`useExplorerCommands`), progress orchestration (`useExplorerProgress`), product overlays (share-link policy, `__recent__`, `__shared__`). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerNavigation.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerNavigation.test.js`

### 2.2 Input Parameters

`useExplorerNavigation(params)`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| currentNodeId | number \| null | Y | Current folder nodeId. |
| getPreviousNodeId | () => number \| null \| undefined | Y | Returns the last committed nodeId to support optimistic navigation rollback (typically backed by a ref in the shell). |
| setCurrentNodeId | (nodeId: number \| null) => void | Y | Shell-owned nodeId setter (or equivalent routing setter) used to transition explorer location. |
| onAfterNavigate | (nextNodeId: number \| null) => void | N | Hook for the shell to run follow-up behavior after navigation (e.g. close drawer, selection reset timing) while preserving current UX. |
| onTrackNodeHistory | (nextNodeId: number \| null, previousNodeId: number \| null) => void | N | Optional callback to record optimistic navigation history used by existing rollback/error flows (e.g. recent-file navigation, which stays path-based until Phase 5). |
| canNavigateToNode | (nodeId: number) => boolean \| Promise<boolean> | N | Optional guard for permission/availability checks used to preserve current "permission denied" rollback behavior (renamed from `canNavigateToPath`). In FileManager this should normally be provided by `explorerGateway` (or a narrow adapter over it) rather than a shell-owned direct service import. When it returns false, navigation must roll back and reject with a forbidden-shaped error. |

Notes:

- This hook should not directly talk to the router; it should operate on nodeIds and delegate route updates to the shell (or a narrow adapter passed in).
- Share-link mode and virtual collections may impose product rules; those rules remain in the shell, which may bypass this hook entirely for those cases.
- This hook may ask the gateway whether a node is navigable, but it must not turn product concepts such as `__recent__` or `__shared__` into hard-coded explorer-core policy.

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| navigateToNode | (nextNodeId: number \| null) => Promise<void> \| void | Primary navigation entry point used by breadcrumbs/tree/node click (renamed from `navigateToPath`). Must preserve current optimistic/rollback + error behavior. |
| handleFolderOpen | (nodeId: number) => Promise<void> \| void | Entry point used when a folder is "opened" from the content area (double click / tap semantics as today). Typically delegates to `navigateToNode`. |
| isNavigating | boolean | Whether a navigation transition is in progress (optional, if needed to preserve current UI disables/spinners). |

### 2.4 Responsibilities (must be non-overlapping)

- **Owns**
  - The logic that transitions the explorer from one node to another, matching current behavior.
  - A single navigation entry point for both breadcrumb/tree node clicks and folder-open transitions from the content area.
  - Any optimistic updates and rollbacks related to navigation (e.g. permission-denied rollback), if such behavior exists today.
  - Identity/equality comparisons for nodeIds for navigation decisions (as a pure concern; no path normalization).
- **Does not own**
  - Fetching the directory contents for the destination node (listing seam + gateway).
  - Deriving filtered/sorted display lists (`useExplorerSession`).
  - Orchestrating upload/rename/move/copy/delete/download (`useExplorerCommands`).
  - Progress UI state and retry/cancel (`useExplorerProgress`).
  - Share-link policy, virtual collection mapping (`__recent__`, `__shared__`) (shell-owned).

### 2.5 Dependencies

- **May use:** pure nodeId comparison helpers.
- **Must not use:** service modules for listing/permissions directly; if permission checks are needed, they must be provided via `canNavigateToNode` or a narrow gateway adapter passed in by the shell.
- The page shell may wire `explorerGateway.canNavigateToNode` into this hook, but should not keep a dedicated `fileService.checkPermission` import for explorer navigation.

### 2.6 Side Effects

- Updates the current explorer nodeId via `setCurrentNodeId`.
- May invoke `onAfterNavigate` to preserve existing selection-reset and scroll-reset timing (if applicable today).
- If product-specific views such as `__recent__` / `__shared__` require special handling, the shell must resolve that before or around this hook rather than hard-coding those policies inside explorer core.

### 2.7 Error Handling

- If `canNavigateToNode` rejects, navigation must roll back to the previous nodeId and rethrow the same error.
- If `canNavigateToNode` returns false, navigation must roll back to the previous nodeId and reject with an error that callers can interpret as “permission denied” (today this is handled via an error with `response.status === 403`).

### 2.8 Verification Scenarios

- [ ] When a breadcrumb/tree/node click triggers navigation, the visible nodeId changes and the explorer content updates as it does today.
- [ ] Opening a folder from the content area triggers the same navigation semantics as today (desktop double click, mobile tap as applicable).
- [ ] If the user navigates elsewhere while an async decision is pending (if applicable), the final outcome does not incorrectly force navigation back (preserve current behavior).
- [ ] Permission-denied navigation attempts roll back and do not strand the explorer in an unusable state (same as today).

### 2.9 Edge Cases

- Navigating to the same nodeId is a no-op (unless current behavior explicitly refreshes).
- Empty/undefined nodeId inputs keep the same fallback behavior used today.


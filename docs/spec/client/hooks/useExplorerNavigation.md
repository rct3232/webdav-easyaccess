# useExplorerNavigation Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Explorer navigation controller: owns path transitions (folder navigation, breadcrumb navigation, open-folder from list/grid/detail) and any optimistic/rollback behavior required to preserve current UX. |
| Used by components/pages | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`) |
| Does not own | Search/sort/view session derivation (`useExplorerSession`), command orchestration (`useExplorerCommands`), progress orchestration (`useExplorerProgress`), product overlays (share-link policy, `__recent__`, `__shared__`). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerNavigation.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerNavigation.test.js`

### 2.2 Input Parameters

`useExplorerNavigation(params)`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| currentPath | string | Y | Current normalized path. |
| setCurrentPath | (path: string) => void | Y | Shell-owned path setter (or equivalent routing setter) used to transition explorer location. |
| onAfterNavigate | (nextPath: string) => void | N | Hook for the shell to run follow-up behavior after navigation (e.g. selection reset timing) while preserving current UX. |
| canNavigateToPath | (path: string) => boolean \| Promise<boolean> | N | Optional guard for permission/availability checks used to preserve current “permission denied” rollback behavior. |

Notes:

- This hook should not directly talk to the router; it should operate on paths and delegate route updates to the shell (or a narrow adapter passed in).
- Share-link mode and virtual collections may impose product rules; those rules remain in the shell and are passed in via guards/callbacks.

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| navigateToPath | (nextPath: string) => Promise<void> \| void | Primary navigation entry point used by breadcrumbs/tree/path click. |
| handleFolderOpen | (folderPath: string) => Promise<void> \| void | Entry point used when a folder is “opened” from the content area (double click / tap semantics as today). |
| isNavigating | boolean | Whether a navigation transition is in progress (optional, if needed to preserve current UI disables/spinners). |

### 2.4 Responsibilities (must be non-overlapping)

- **Owns**
  - The logic that transitions the explorer from one path to another, matching current behavior.
  - Any optimistic updates and rollbacks related to navigation (e.g. permission-denied rollback), if such behavior exists today.
  - Normalization and equality comparisons for paths for navigation decisions (as a pure concern).
- **Does not own**
  - Deriving filtered/sorted display lists (`useExplorerSession`).
  - Orchestrating upload/rename/move/copy/delete/download (`useExplorerCommands`).
  - Progress UI state and retry/cancel (`useExplorerProgress`).
  - Share-link policy, virtual collection mapping (`__recent__`, `__shared__`) (shell-owned).

### 2.5 Dependencies

- **May use:** pure path utilities (normalize/compare).
- **Must not use:** service modules for listing/permissions directly; if permission checks are needed, they must be provided via `canNavigateToPath` or a narrow gateway adapter passed in by the shell.

### 2.6 Side Effects

- Updates the current explorer path via `setCurrentPath`.
- May invoke `onAfterNavigate` to preserve existing selection-reset and scroll-reset timing (if applicable today).

### 2.7 Error Handling

- If `canNavigateToPath` rejects or returns false, navigation must not transition the explorer and should preserve current “permission denied” outcomes (messaging itself remains shell-owned unless it is already owned here today).

### 2.8 Verification Scenarios

- [ ] When a breadcrumb/path click triggers navigation, the visible path changes and the explorer content updates as it does today.
- [ ] Opening a folder from the content area triggers the same navigation semantics as today (desktop double click, mobile tap as applicable).
- [ ] If the user navigates elsewhere while an async decision is pending (if applicable), the final outcome does not incorrectly force navigation back (preserve current behavior).
- [ ] Permission-denied navigation attempts roll back and do not strand the explorer in an unusable state (same as today).

### 2.9 Edge Cases

- Navigating to the same path is a no-op (unless current behavior explicitly refreshes).
- Empty/undefined path inputs are normalized to the same fallback behavior used today.


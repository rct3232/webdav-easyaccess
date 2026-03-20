# useExplorerCommands Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Explorer command controller: orchestrates user-initiated file operations (upload/rename/move/copy/delete/download) and exposes view-ready command callbacks. Uses the explorer gateway for IO and coordinates with progress + refresh policy without changing UX. |
| Used by components/pages | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`) |
| Does not own | Search/sort/view derivation (`useExplorerSession`), navigation transitions (`useExplorerNavigation`), progress drawer state and retry/cancel UI (`useExplorerProgress`), product overlays (share-link policy, `__recent__`, `__shared__`). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerCommands.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerCommands.test.js`

### 2.2 Input Parameters

`useExplorerCommands(params)`

Transitional note:

- The current implementation still receives concrete FileManager shell/controller wiring (for example `t`, `currentPathRef`, selection setters, dialog close handlers, and message surfaces) while it reuses `useBulkOperations` and `useFileOperations` internally.
- Until the extraction fully converges on the narrower gateway/refresh-oriented signature below, dedicated hook tests should target the currently exported public command API and observable orchestration outcomes rather than assuming the future simplified constructor shape.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| gateway | object | Y | Explorer IO gateway matching `docs/spec/client/services/explorerGateway.md`. |
| currentPath | string | Y | Current normalized path used for list-refresh decisions. |
| refreshNow | () => void \| Promise<void> | Y | Shell-provided “refresh listing” entry point (implementation-owned elsewhere). |
| getCurrentPathNow | () => string | Y | Function returning the latest current path at decision time (avoid stale closures; aligns with `refreshPolicy`). |
| openDialogs | object | N | Shell-provided dialog openers for existing UX (rename prompt, conflict prompt, confirm delete, etc.). |
| notify | (message: object) => void | N | Shell-provided user messaging mechanism (snackbar/toast) matching current behavior. |
| modePolicy | object | N | Product overlay policy (e.g. share-link mode restrictions). Must be provided by the shell; explorer core must not own these rules. |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| handleOperationComplete | `(info?: object | string) => void` | Explorer-owned completion handler that applies refresh policy and tree refresh coordination for operation outcomes. The shell may reuse this callback for adjacent explorer flows (for example create-folder completion) rather than duplicating refresh logic inline. |
| uploadFiles | (files: FileList \| File[], targetPath?: string) => Promise<void> | Upload entry point (drop/select). |
| renameEntry | (file: object) => Promise<void> | Rename orchestration, including validation and dialog lifecycle as today. |
| moveEntries | (paths: string[], targetPath: string) => Promise<void> | Move orchestration (single/bulk). |
| copyEntries | (paths: string[], targetPath: string) => Promise<void> | Copy orchestration (single/bulk). |
| deleteEntries | (paths: string[]) => Promise<void> | Delete orchestration. |
| downloadEntries | (paths: string[]) => Promise<void> | Download orchestration (single/bulk). |

Notes:

- Names are indicative; the concrete exported API should match current FileManager wiring while responsibilities are being extracted. The hook must not force a UX redesign.

### 2.4 Responsibilities (must be non-overlapping)

- **Owns**
  - Operation orchestration and required branching to preserve current behavior (including conflict-resolution entry points and any confirm flows already present today).
  - Choosing when to trigger a list refresh after operations complete using `refreshPolicy` (or equivalent), so operations do not refresh an unrelated folder if the user navigated away.
  - Producing the explorer-facing operation completion callback that progress flows and nearby explorer actions can reuse instead of the page shell duplicating refresh-policy logic.
  - Delegating IO to `explorerGateway` (not directly importing low-level services).
- **Does not own**
  - Progress list/drawer state, retry/cancel routing (belongs to `useExplorerProgress`).
  - Navigation orchestration (belongs to `useExplorerNavigation`).
  - Local search/sort/view derivation (belongs to `useExplorerSession`).
  - Product overlay policies (share-link restrictions, virtual collections) (shell-owned).

### 2.5 Dependencies

- `docs/spec/client/services/explorerGateway.md`
- `docs/spec/client/utils/refreshPolicy.md` (pure utility used to decide refresh)
- Existing lower-level hooks/services may be reused initially, but this controller is the owner of orchestration (not the view).
- Upload and conflict-preflight IO should be routed through the gateway boundary even if the gateway is currently a thin facade over existing service functions.
- Transitional note: while existing lower-level hooks are being reused, command execution state may still be surfaced through those helpers; however, retry/cancel presentation logic should be routed through `useExplorerProgress`, not duplicated in the page shell.

### 2.6 Side Effects

- Invokes gateway operations.
- Triggers progress creation through whichever progress mechanism is used today (may be wired via `useExplorerProgress` in the shell).
- Calls `refreshNow` conditionally based on refresh policy and current vs started/target paths.
- May trigger explorer tree refresh/update notifications tied to operation outcomes.

### 2.7 Error Handling

- Errors must map to the same user-visible outcomes as today (dialogs/snackbars/messages). The hook should use `notify`/`openDialogs` provided by the shell rather than importing UI concerns directly.

### 2.8 Verification Scenarios

These scenarios should be covered by a dedicated hook unit test in `client/src/pages/FileManager/hooks/__tests__/useExplorerCommands.test.js`, not only by FileManager page regression tests.

- [ ] Upload:
  - [ ] Uploading files triggers progress items and completes/cancels/retries as today.
  - [ ] Upload conflict prompts appear under the same conditions as today.
- [ ] Rename:
  - [ ] Validation outcomes and close behavior match current UX.
- [ ] Move/copy/delete:
  - [ ] Bulk operations produce the same success/error outcomes as today.
  - [ ] Refresh behavior does not incorrectly refresh a folder the user navigated away from (same as today).
- [ ] `handleOperationComplete` refreshes the active explorer only when the refresh policy says the current path is affected, while still emitting tree-refresh updates for deleted folders.
- [ ] Share-link mode policy:
  - [ ] Restricted commands remain unavailable and cannot be executed (policy remains shell-owned).

### 2.9 Edge Cases

- Empty selection/path lists are no-ops.
- Target path missing for move/copy uses the same fallback behavior as today (or is treated as invalid and rejected consistently).


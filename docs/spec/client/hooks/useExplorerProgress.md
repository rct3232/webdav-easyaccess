# useExplorerProgress Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Explorer progress controller: owns progress drawer/list state and exposes retry/cancel entry points and completion notifications, matching current FileManager UX.                                                     |
| Used by components/pages | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`)                                                                                                                                                     |
| Does not own             | Navigation transitions (`useExplorerNavigation`), command orchestration (`useExplorerCommands`), search/sort/view derivation (`useExplorerSession`), product overlays (share-link policy, `__recent__`, `__shared__`). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerProgress.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerProgress.test.js`

### 2.2 Input Parameters

`useExplorerProgress(params)`

| Name           | Type                                          | Required | Description                                                                                                |
| -------------- | --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| progressSource | object                                        | Y        | Abstraction representing current progress items/events (may initially wrap existing progress state/hooks). |
| onRetry        | (progressId: string) => void \| Promise<void> | Y        | Retry handler provided by the shell/commands layer.                                                        |
| onCancel       | (progressId: string) => void \| Promise<void> | Y        | Cancel handler provided by the shell/commands layer.                                                       |
| notify         | (message: object) => void                     | N        | Shell-provided user messaging mechanism (snackbar/toast) matching current behavior.                        |

Notes:

- This controller owns _presentation-level progress coordination_ (drawer state, list ordering, mapping retry/cancel affordances), but does not own executing the underlying operations.

### 2.3 Return Value / State

| Key                  | Type                                          | Meaning                                     |
| -------------------- | --------------------------------------------- | ------------------------------------------- |
| progressItems        | Array<object>                                 | View-ready progress items to render.        |
| isProgressDrawerOpen | boolean                                       | Whether the progress drawer is open.        |
| openProgressDrawer   | () => void                                    | Open drawer.                                |
| closeProgressDrawer  | () => void                                    | Close drawer.                               |
| retryProgress        | (progressId: string) => Promise<void> \| void | Calls `onRetry` and preserves existing UX.  |
| cancelProgress       | (progressId: string) => Promise<void> \| void | Calls `onCancel` and preserves existing UX. |

### 2.4 Responsibilities (must be non-overlapping)

- **Owns**
  - Progress drawer open/close state and any view-ready state shaping required by the progress UI.
  - Mapping “retry/cancel” affordances to the correct progress items.
  - Triggering completion notifications/messages if the current UX does so from the progress layer.
- **Does not own**
  - Starting operations (upload/rename/move/copy/delete/download) (belongs to `useExplorerCommands`).
  - Navigation or file listing.
  - Product overlay policies.

### 2.5 Dependencies

- Existing progress utilities/hooks may be used as `progressSource` initially, but this controller becomes the single owner of progress-drawer state for FileManager explorer core.
- Transitional note: this hook may temporarily receive retry/cancel adapters backed by existing command-layer refs or lower-level hooks, but `FileManager` should not keep separate inline progress retry/cancel logic once this controller is introduced.

### 2.6 Side Effects

- May call `notify` on completion/failure according to current behavior.

### 2.7 Error Handling

- Retry/cancel failures must produce the same user-visible outcomes as today (e.g. message shown, item remains in the list, etc.).

### 2.8 Verification Scenarios

- [ ] Progress drawer opens and closes the same way it does today.
- [ ] Progress list renders the same items for the same underlying operations.
- [ ] Retry appears for the same failure states and triggers the same observable outcomes.
- [ ] Cancel appears for the same in-flight states and triggers the same observable outcomes.

### 2.9 Edge Cases

- No progress items → drawer may remain closed and list shows empty state (as today).
- Duplicate progress IDs are handled deterministically (stable rendering; no crash).

# useTrashOperations Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Trash-view operation controller (DEF-16 P9). Owns restore / permanent-delete (purge) / empty-trash flows against the trash REST API, including their confirm-dialog state, `FileOperationProgress` items for multi-item runs, processing marks, and post-operation refresh. |
| Used by components/pages | FileManager page shell (wired once; consumed by FileManagerControls trash toolbar, FileContextMenu/FileActionSheet trash rows, FilePropertiesDialog trash actions)                                                                                                          |
| Related specs            | `docs/spec/client/services/fileService.md` (trash endpoints), `docs/spec/client/services/trashNotifier.md`, `docs/spec/client/components/file-manager/FileManagerControls.md`                                                                                               |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useTrashOperations.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useTrashOperations.test.js`

### 2.2 Input Parameters

| Name           | Type     | Required | Description                                                                           |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------------- |
| t              | function | Y        | i18n translator (progress labels, toasts)                                             |
| showError      | function | Y        | Error surface (message hook)                                                          |
| refreshNow     | function | Y        | Listing reload callback (`loadFiles` from `useFileManager`)                           |
| updateProgress | function | Y        | Shared progress updater (same `useFileOperationProgress` seam as `useBulkOperations`) |
| setDropMessage | function | N        | Snackbar messaging for single-item success toasts                                     |

### 2.3 Return Value / State

| Key                    | Type                  | Meaning                                                                                 |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| restoreConfirmState    | `{ nodeIds } \| null` | Restore confirm dialog state (null = closed); carries the node ids for `{{count}}` copy |
| purgeConfirmState      | `{ nodeIds } \| null` | Purge confirm dialog state (null = closed); carries the node ids for `{{count}}` copy   |
| emptyTrashConfirmOpen  | boolean               | Empty-trash confirm dialog open (admin-only flow)                                       |
| openRestoreConfirm     | (nodeIds[]) => void   | Open the restore confirm with the selected node ids                                     |
| openPurgeConfirm       | (nodeIds[]) => void   | Open the purge confirm with the node ids                                                |
| openEmptyTrashConfirm  | () => void            | Open the empty-trash confirm                                                            |
| closeRestoreConfirm    | () => void            | Close restore confirm                                                                   |
| closePurgeConfirm      | () => void            | Close purge confirm                                                                     |
| closeEmptyTrashConfirm | () => void            | Close empty-trash confirm                                                               |
| confirmRestore         | () => Promise         | Execute restore for the confirmed node ids                                              |
| confirmPurge           | () => Promise         | Execute purge for the confirmed node ids                                                |
| confirmEmptyTrash      | () => Promise         | Execute `emptyTrash()` (purge ALL trashed items for ALL users)                          |
| handleTrashRestore     | (file) => Promise     | Single-item restore, no confirm (context menu / action sheet / properties dialog)       |
| handleTrashPurge       | (file) => Promise     | Single-item purge executor, no confirm — callers own the confirm (properties dialog)    |

### 2.4 Behavior Contract

- **Gates (enforced by callers; hook re-checks server errors):** restore = write permission on the
  trash row (`hasWritePermission`); purge = write permission (delete perm today); empty trash =
  admin only (`user.is_admin`) — the Empty-trash control is only rendered for admins.
- **Single-item ops** (context menu / action sheet / properties dialog): no `FileOperationProgress`
  item; success surfaces a snackbar toast (`fileManager.trashRestoreDone` / `trashPurgeDone`),
  failures via `getServerErrorDisplay` fallback keys (`trashRestoreFail` / `trashPurgeFail`).
  Refresh the listing after success.
- **Bulk ops** (toolbar Restore / Permanent delete): sequential per-node calls with a
  `FileOperationProgress` item (`type: 'restore'` / `'purge'`, `retryData: { type, nodeIds }`),
  reusing the existing progress vocabulary (`fileManager.bulkItemCount`, `bulkActionProgress`,
  `bulkActionDone`, `uploadFailCount` with `{{count}}` interpolation — no pluralization infra).
  Partial failures keep the item (`keepOnError`) with a failed list; retry is not wired for trash
  ops (single-node endpoints, no bulk job id).
- **Empty trash:** confirm copy must state that it purges ALL trashed items for ALL users
  (`dialogs.emptyTrashConfirm`); runs `emptyTrash()` and refreshes.
- **Confirm dialogs:** bulk restore (`dialogs.restoreConfirm`), purge (`dialogs.purgeBulkMessage`,
  single purge `dialogs.purgeConfirm`) render with `confirmColor="error"`.
- **Selection:** bulk ops run within the trash view; the shell clears selection on navigation, and
  the trash toolbar actions clear selection on confirm (same as main-view bulk delete).
- **Notify:** after any successful restore/purge/empty that changes trash contents, the hook calls
  `notifyTrashChanged()` (see `trashNotifier.md`) so the sidebar trash icon animates.

### 2.5 Dependencies

- **imports:** `fileService` (`restoreTrashedItem`, `purgeTrashedItem`, `emptyTrash`),
  `trashNotifier` (`notifyTrashChanged`), `getServerErrorDisplay`.
- **Boundary:** the hook performs trash IO only; listing state stays in `useFileManager`, progress
  rendering stays in `FileOperationProgress`. Views must not import `fileService` trash functions
  directly.

### 2.6 Verification Scenarios

- [ ] `openRestoreConfirm` → `confirmRestore` calls `restoreTrashedItem` per node id and refreshes
- [ ] `openPurgeConfirm` → `confirmPurge` calls `purgeTrashedItem` per node id with a progress item and refreshes
- [ ] `confirmEmptyTrash` calls `emptyTrash()` once and refreshes
- [ ] Single restore/purge surface success toasts and refresh; failures surface `getServerErrorDisplay` or the fallback key
- [ ] Confirm dialogs close after execution; selection clears for bulk runs
- [ ] Successful operations call `notifyTrashChanged`

### 2.7 Edge Cases

- Empty node id list → no-op
- Partial failures in a bulk run → progress item shows partial done/fail counts and stays open
- Server errors (403/404) surface through the shared error display path

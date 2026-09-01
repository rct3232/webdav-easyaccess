# folderPickerGateway Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | IO boundary for the FolderPicker dialog controller logic (`useFolderPicker`). Provides directory listing, write-permission checking, and shared-folder permission data for the “**shared**” root. |
| Used by      | `client/src/components/dialogs/FolderPickerDialog/hooks/useFolderPicker.js`                                                                                                                       |
| Does not own | Breadcrumb rendering, validation rules (`isInvalidDestination`), and copy/move UI state.                                                                                                          |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/folderPickerGateway.js`
- **Test file:** `client/src/services/__tests__/folderPickerGateway.test.js`

---

### 2.2 Main Functions

| Function                         | Input                    | Return                                                                               | API called (see api.md)                 |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------- |
| `listFolderContents`             | `({ nodeId, options? })` | `Promise<Array<object>>`                                                             | `GET /api/files/list?nodeId=...`        |
| `checkWritePermission`           | `({ nodeId })`           | `Promise<{ hasRead?: boolean, hasWrite?: boolean, source?: string }>`                | `GET /api/permissions/check?nodeId=...` |
| `getUserSharedFolderPermissions` | `({ user, options? })`   | `Promise<Array<{ nodeId: number, name: string, permission: string, type: string }>>` | `GET /api/permissions/shared`           |

Notes:

- All functions are nodeId-based — `nodeId` is a BIGINT `file_nodes.id`; no path strings.
- `listFolderContents` must preserve the same raw directory-list entries shape as `fileService.listFiles` so the caller hook can apply its existing directory/breadcrumb logic without behavior change.
- `checkWritePermission` must return the same structure as the current `checkPermission` usage in the picker hook (`permission.hasWrite`).
- `getUserSharedFolderPermissions` returns the shared-with-me entries from `GET /api/permissions/shared`. The server already excludes the user's own home subtree; the gateway keeps `isUserOwnFolder` (`nodeId === user.rootNodeId`) as a defensive safety net and returns only `type === 'directory'` entries for the picker root.
- Admin users return `[]` from `getUserSharedFolderPermissions` without calling the permissions service.

---

### 2.3 Error Handling

- The gateway must not display UI.
- Propagate errors (throw) so callers can decide whether to empty out state.

---

### 2.4 Dependencies

- Internal services/utilities:
  - `client/src/services/fileService` (`listFiles`)
  - `client/src/services/permissionService` (`checkPermission`, `getSharedPermissions`)
  - `client/src/utils/userUtils` (`filterOutUserOwnFolders`)

---

### 2.5 Verification Scenarios

Verify from the caller perspective (observable outcome of picker):

- [ ] `listFolderContents({ nodeId })` returns list entries equivalent to current `listFiles(nodeId)` usage.
- [ ] `checkWritePermission({ nodeId })` returns an object compatible with the existing `permission.hasWrite` usage.
- [ ] `getUserSharedFolderPermissions` returns only shared folders (server excludes the user's own subtree; client keeps the root-level safety filter).
- [ ] Admin users receive `[]` for `getUserSharedFolderPermissions`.
- [ ] Gateway errors are propagated to the caller.

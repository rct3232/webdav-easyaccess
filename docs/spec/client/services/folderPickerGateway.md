# folderPickerGateway Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | IO boundary for the FolderPicker dialog controller logic (`useFolderPicker`). Provides directory listing, write-permission checking, and shared-folder permission data for the “__shared__” root. |
| Used by | `client/src/components/dialogs/FolderPickerDialog/hooks/useFolderPicker.js` |
| Does not own | Breadcrumb rendering, validation rules (`isInvalidDestination`), and copy/move UI state. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/folderPickerGateway.js`
- **Test file:** `client/src/services/__tests__/folderPickerGateway.test.js`

---

### 2.2 Main Functions

| Function | Input | Return | API called (see api.md) |
|----------|-------|--------|-------------------------|
| `listFolderContents` | `({ path, options? })` | `Promise<Array<object>>` | `GET /api/files/list` |
| `checkWritePermission` | `({ path })` | `Promise<{ hasRead?: boolean, hasWrite?: boolean, source?: string }>` | `GET /api/permissions/check` |
| `getUserSharedFolderPermissions` | `({ user, options? })` | `Promise<Array<{ folder_path: string, permission: string }>>` | `GET /api/permissions/user/:userId` |

Notes:

- `listFolderContents` must preserve the same raw directory-list entries shape as `fileService.listFiles` so the caller hook can apply its existing directory/breadcrumb logic without behavior change.
- `checkWritePermission` must return the same structure as the current `checkPermission` usage in the picker hook (`permission.hasWrite`).
- `getUserSharedFolderPermissions` must filter out folders that belong to the current user.
- Admin users return `[]` from `getUserSharedFolderPermissions` without calling the permissions service.

---

### 2.3 Error Handling

- The gateway must not display UI.
- Propagate errors (throw) so callers can decide whether to empty out state.

---

### 2.4 Dependencies

- Internal services/utilities:
  - `client/src/services/fileService` (`listFiles`)
  - `client/src/services/permissionService` (`checkPermission`, `getUserPermissions`)
  - `client/src/utils/userUtils` (`filterOutUserOwnFolders`)

---

### 2.5 Verification Scenarios

Verify from the caller perspective (observable outcome of picker):

- [ ] `listFolderContents` returns list entries equivalent to current `listFiles(path)` usage.
- [ ] `checkWritePermission` returns an object compatible with the existing `permission.hasWrite` usage.
- [ ] `getUserSharedFolderPermissions` returns only folders the user does not own.
- [ ] Admin users receive `[]` for `getUserSharedFolderPermissions`.
- [ ] Gateway errors are propagated to the caller.


# deriveFolderPickerSharedState Spec

## 1. Overview

| Item | Description                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Pure helper that normalizes shared-permission results into the folder models and permission-path context consumed by `useFolderPicker`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/deriveFolderPickerSharedState.test.js`

### 2.2 Function Signatures

| Function                        | (input) => return                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `deriveFolderPickerSharedState` | `({ permissions }) => { sharedPermissionPaths, sharedFolders, sharedFolderRoots }` |

### 2.3 Dependencies

- `normalizePath`
- `PERMISSIONS`

### 2.4 Verification Scenarios

- [ ] Shared permission paths are normalized before comparison/output
- [ ] Only top-level shared folders are exposed for the `__shared__` root list
- [ ] Returned shared folder entries preserve read/write visibility expected by the picker
- [ ] Nested shared paths still produce the correct root candidates for toggle/breadcrumb logic

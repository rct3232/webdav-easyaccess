# resolveFolderPickerToggleTarget Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure helper that resolves the landing path for home/shared toggle changes in `useFolderPicker` without mutating state or calling gateways. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/resolveFolderPickerToggleTarget.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/resolveFolderPickerToggleTarget.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `resolveFolderPickerToggleTarget` | `({ nextPathType, action, user, sourceFilePath, sourceFilePaths, sharedFolderRoots }) => { path, pathType, presetHasWritePermission } \| null` |

### 2.3 Dependencies

- `normalizePath`
- `getParentPath`
- `getUserBaseFolder`

### 2.4 Verification Scenarios

- [ ] Home-origin copy/move sources toggle to `__shared__` when shared is selected
- [ ] Home-origin copy/move sources toggle back to their home parent path when home is selected
- [ ] Shared-origin copy/move sources reuse the best matching shared root when shared is selected
- [ ] Shared-origin copy/move sources fall back to the first shared path segment when no explicit shared root matches
- [ ] Non copy/move flows still resolve stable home/shared landing paths without invalid source assumptions

# validateFolderDestination Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure validation for FolderPicker copy/move destinations. Determines whether the currently selected destination would be an invalid target for one or more source paths. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/isInvalidFolderPickerDestination.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/isInvalidFolderPickerDestination.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `isInvalidFolderPickerDestination` | `({ action, selectedPath, sourceFilePath, sourceFilePaths }) => boolean` |

### 2.3 Dependencies

- `normalizePath`
- `getParentPath`

### 2.4 Rules

- Return `false` unless `action` is `'copy'` or `'move'`.
- Build the source list from `sourceFilePath` or `sourceFilePaths`.
- Return `true` if any source path would move/copy into:
  - its own parent directory
  - the source path itself
  - any descendant of the source path
- Return `false` only when every provided source path is valid for the selected destination.

### 2.5 Verification Scenarios

- [ ] Non-copy/move actions always return `false`
- [ ] Selecting the source path itself returns `true`
- [ ] Selecting the source parent directory returns `true`
- [ ] Selecting a descendant of the source path returns `true`
- [ ] Multi-source input returns `true` when any one source path is invalid for the selected destination
- [ ] Valid unrelated destinations return `false`

### 2.6 Edge Cases

- `sourceFilePath` and `sourceFilePaths` must behave equivalently for a single source
- All source and destination paths are normalized before comparison

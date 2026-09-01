# validateFolderDestination Spec

## 1. Overview

| Item | Description                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Pure validation for FolderPicker copy/move destinations. Determines whether the currently selected destination nodeId would be an invalid target for one or more source nodeIds. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/isInvalidFolderPickerDestination.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/isInvalidFolderPickerDestination.test.js`

### 2.2 Function Signatures

| Function                           | (input) => return                                                      |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `isInvalidFolderPickerDestination` | `({ action, selectedNodeId, sourceNodeId, sourceNodeIds }) => boolean` |

### 2.3 Dependencies

None.

### 2.4 Rules

- Return `false` unless `action` is `'copy'` or `'move'`.
- Build the source list from `sourceNodeId` or `sourceNodeIds`.
- Return `true` if any source nodeId equals the selected destination nodeId (moving/copying into the source folder itself). Without server ancestor calls, ancestor/descendant destinations are not resolvable and are not checked.
- Return `false` when no provided source nodeId equals the selected destination.

### 2.5 Verification Scenarios

- [ ] Non-copy/move actions always return `false`
- [ ] Selecting the source nodeId itself returns `true`
- [ ] Multi-source input returns `true` when any one source nodeId equals the selected destination
- [ ] Valid unrelated destinations return `false`

### 2.6 Edge Cases

- `sourceNodeId` and `sourceNodeIds` must behave equivalently for a single source
- A `null` selected destination (virtual shared root / admin root) is never invalid

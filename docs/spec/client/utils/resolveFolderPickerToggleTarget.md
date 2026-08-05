# resolveFolderPickerToggleTarget Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure helper that resolves the landing nodeId for home/shared toggle changes in `useFolderPicker` without mutating state or calling gateways. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/resolveFolderPickerToggleTarget.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/resolveFolderPickerToggleTarget.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `resolveFolderPickerToggleTarget` | `({ nextPathType, action, sourceNodeId, sourceNodeIds, sharedFolderRoots, homeNodeId }) => { nodeId, pathType, presetHasWritePermission } \| null` |

### 2.3 Dependencies

None (pure nodeId resolution; no path normalization or ancestor calls).

### 2.4 Verification Scenarios

- [ ] Home-origin copy/move sources toggle to the shared root (`nodeId: null`, `pathType: 'shared'`)
- [ ] Shared-origin copy/move sources whose source nodeId is a top-level shared root land on that root
- [ ] Home toggle lands on the user home nodeId (`homeNodeId`)
- [ ] Non copy/move flows still resolve stable home/shared landing nodeIds

### 2.5 Edge Cases

- `homeNodeId` may be `null` (admin root)
- `sourceNodeId` and `sourceNodeIds` are both supported; the first valid source nodeId is the primary source
- Without server ancestor calls, a shared-origin source that is not a top-level shared root falls back to the shared root

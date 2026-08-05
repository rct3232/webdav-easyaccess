# buildFolderPickerBreadcrumbs Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure breadcrumb derivation for `FolderPickerDialog`. Converts the picker's nodeId navigation stack plus home/shared context into the breadcrumb model rendered by the dialog. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/buildFolderPickerBreadcrumbs.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/buildFolderPickerBreadcrumbs.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `buildFolderPickerBreadcrumbs` | `({ homeNodeId, homeLabel, navStack, sharedLabel }) => Array<{ name: string, nodeId: number \| null }>` |

### 2.3 Dependencies

None (pure normalization of the hook-maintained navigation stack).

### 2.4 Rules

- `navStack` entries are `{ nodeId, name }`; the first entry is the home or shared root base.
- For the shared root entry (`isSharedRoot`), the rendered name is `sharedLabel` and the nodeId is `null`.
- All other entries render their stored `name` and `nodeId`.
- An empty/absent `navStack` falls back to a single home crumb `{ name: homeLabel, nodeId: homeNodeId ?? null }`.

### 2.5 Verification Scenarios

- [ ] Shared root returns a single `{ name: sharedLabel, nodeId: null }` crumb
- [ ] Home navigation stacks render home base plus visited folders with their nodeIds
- [ ] Admin home root normalizes to `nodeId: null`
- [ ] Empty navStack falls back to a single home crumb

### 2.6 Edge Cases

- `homeNodeId` may be `null` (admin root); the home crumb nodeId is normalized to `null`
- Entries without a usable name fall back to `homeLabel`

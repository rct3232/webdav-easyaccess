# buildFolderPickerBreadcrumbs Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure breadcrumb derivation for `FolderPickerDialog`. Converts the selected picker path plus home/shared context into the breadcrumb model rendered by the dialog. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/buildFolderPickerBreadcrumbs.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/__tests__/buildFolderPickerBreadcrumbs.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `buildFolderPickerBreadcrumbs` | `({ selectedPath, user, homePath, homeLabel, sharedPermissionPaths, sharedLabel }) => Array<{ name: string, path: string }>` |

### 2.3 Dependencies

- `normalizePath` from `client/src/utils/pathUtils`

### 2.4 Rules

- If `selectedPath === '/__shared__'`, return only the shared root breadcrumb.
- For home paths:
  - start with `{ name: homeLabel, path: homePath }`
  - append path segments derived from `selectedPath`
  - for non-admin users, hide the repeated username crumb directly beneath the home root
- For shared paths below `__shared__`:
  - start with `{ name: sharedLabel, path: '/__shared__' }`
  - if any prefix of `selectedPath` appears in `sharedPermissionPaths`, start the visible shared path trail from the first matching prefix
  - otherwise, fall back to rendering all normalized path segments under the shared root

### 2.5 Verification Scenarios

- [ ] `'/__shared__'` returns a single shared-root breadcrumb
- [ ] Non-admin home paths hide the repeated username crumb below `homeLabel`
- [ ] Admin home paths keep the full root-based breadcrumb trail
- [ ] Shared subpaths start the visible trail at the first matching `sharedPermissionPaths` prefix
- [ ] Shared subpaths without a matching permission prefix fall back to `__shared__` plus full normalized segments

### 2.6 Edge Cases

- `selectedPath` may contain trailing slashes and must be normalized consistently for shared-path derivation
- Empty or root-like home paths still return a valid home breadcrumb

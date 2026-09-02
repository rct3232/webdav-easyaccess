# folderTreeGateway Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role         | IO boundary for folder-tree surfaces (FolderTree + its sections + tree items). Provides: (1) folder child listing for expandable tree nodes and share-link tree roots, and (2) shared-folder permission data for building the “**shared**” tree. |
| Used by      | `client/src/components/folder-tree/FolderTree.js`, `client/src/components/folder-tree/BaseFolderTreeItem.js`, `client/src/components/folder-tree/ShareLinkSection.js`, `client/src/components/folder-tree/SharedFoldersSection.js` (via props)   |
| Does not own | Product overlays and dialog/picker UX (breadcrumbs, validation, share-link policy, “**recent**” logic, etc.).                                                                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/folderTreeGateway.js`
- **Test file:** `client/src/services/__tests__/folderTreeGateway.test.js`

---

### 2.2 Main Functions

| Function                         | Input                                                                       | Return                                                                                                                            | API called (see api.md)          |
| -------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `listFolderChildren`             | `({ nodeId, listFilesOptions?, useHiddenFilesFilter?, filterChildNames? })` | `Promise<Array<{ nodeId: number, name: string, hasReadPermission?: boolean, hasWritePermission?: boolean, isHidden?: boolean }>>` | `GET /api/files/list?nodeId=...` |
| `getUserSharedFolderPermissions` | `({ user, options? })`                                                      | `Promise<Array<{ nodeId: number, name: string, permission: string, type: string }>>`                                              | `GET /api/permissions/shared`    |

Notes:

- `listFolderChildren` must preserve the current folder-tree observable behavior:
  - Takes a directory `nodeId` (BIGINT `file_nodes.id`) as the expandable tree node reference — no path strings.
  - Only directory entries are returned.
  - Hidden entries are filtered based on the `showHiddenFiles` localStorage flag only when `useHiddenFilesFilter` is `true`.
  - `filterChildNames`, when provided, is a string array denylist matched against child `name`.
  - Returned entries include `nodeId`, `name` (basename/name), and permission flags (`hasReadPermission`, `hasWritePermission`) shaped exactly like the current tree implementation expects.
  - Returned entries are sorted lexicographically by `name`.
- `getUserSharedFolderPermissions` returns the shared-with-me permission entries (`{ nodeId, name, permission, type }`) from `GET /api/permissions/shared`. The server already excludes the user's own home subtree; the gateway keeps `isUserOwnFolder` (`nodeId === user.rootNodeId`) as a defensive client-side safety net and returns only `type === 'directory'` entries for the tree.
- Admin users return `[]` without hitting the permissions service.

---

### 2.3 Error Handling

- The gateway must not display UI.
- Propagate errors (throw) so callers can decide whether to empty out state or retry.

---

### 2.4 Dependencies

- Internal services/utilities:
  - `client/src/services/fileService` (`listFiles`)
  - `client/src/services/permissionService` (`getSharedPermissions`)
  - `client/src/utils/localStorage` (`getShowHiddenFiles`)
  - `client/src/utils/userUtils` (`filterOutUserOwnFolders`)

---

### 2.5 Verification Scenarios

Verify from the caller perspective (observable outcome of the tree):

- [ ] `listFolderChildren({ nodeId })` returns only directories and preserves permission flags from `listFiles`.
- [ ] With `useHiddenFilesFilter: true`, hidden directories are excluded when `showHiddenFiles` is `false`.
- [ ] With `useHiddenFilesFilter: false`, hidden directories are included.
- [ ] `filterChildNames` excludes children by their `name`.
- [ ] `getUserSharedFolderPermissions` returns only shared folders (server excludes the user's own subtree; client keeps the root-level safety filter).
- [ ] `getUserSharedFolderPermissions` returns only `type === 'directory'` entries with real `name` values (no `node-<id>` placeholders).
- [ ] Admin users receive `[]` for `getUserSharedFolderPermissions`.
- [ ] Listing/permissions errors are propagated to the caller.

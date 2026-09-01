# useShareDialog Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Controller hook for `ShareDialog`. Owns dialog orchestration, tree expansion state, menu state, and mode-specific callback flow. It prepares view-ready state for the dialog shell and delegates permission persistence to gateway-backed use-cases. |
| Used by components/pages | `ShareDialog`                                                                                                                                                                                                                                        |
| Does not own             | JSX rendering, low-level permission mutation loops, or pure permission-diff rules                                                                                                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareDialog/hooks/useShareDialog.js`
- **Test file:** `client/src/components/dialogs/ShareDialog/hooks/__tests__/useShareDialog.test.js`

### 2.2 Input Parameters

| Name                                                                                                                                                                                                                                                                 | Type     | Required | Description                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ------------------------------------------------------------------------- |
| open                                                                                                                                                                                                                                                                 | boolean  | Y        | Dialog open state                                                         |
| mode                                                                                                                                                                                                                                                                 | string   | Y        | `'admin' \| 'share' \| 'manage' \| 'review'`                              |
| userId                                                                                                                                                                                                                                                               | string   | N        | Target user id in admin mode                                              |
| username                                                                                                                                                                                                                                                             | string   | N        | Target username in admin mode                                             |
| startFromUserHome                                                                                                                                                                                                                                                    | boolean  | N        | Whether admin mode should anchor at the user's home folder                |
| folderPath                                                                                                                                                                                                                                                           | string   | N        | Root folder path for share/review flows (display/bootstrap)               |
| folderNodeId                                                                                                                                                                                                                                                         | number   | N        | Root folder node id for share/review flows                                |
| targetNodeId                                                                                                                                                                                                                                                         | number   | N        | Alias for the target node id (used when `folderNodeId` is absent)         |
| folderName                                                                                                                                                                                                                                                           | string   | N        | Display name for the selected folder                                      |
| permissionRequest                                                                                                                                                                                                                                                    | object   | N        | Request under review in review mode                                       |
| enableExternalShare                                                                                                                                                                                                                                                  | boolean  | N        | External share-only mode                                                  |
| onMessage                                                                                                                                                                                                                                                            | function | N        | User-visible message dispatcher                                           |
| onSave                                                                                                                                                                                                                                                               | function | N        | Success callback for admin/share save flows                               |
| onApprove                                                                                                                                                                                                                                                            | function | N        | Success callback for review approval                                      |
| onClose                                                                                                                                                                                                                                                              | function | Y        | Dialog close callback                                                     |
| folderPermissions, setFolderPermissions, initialFolderPermissions, setInitialFolderPermissions, userInfoMap, setUserInfoMap, setSaving, setLoadingPermissions, handleAddUserPermission, handleRemoveUserPermission, handleToggleUserPermission, hasPermissionChanged | mixed    | Y        | Permission-manager state and actions injected from `usePermissionManager` |

### 2.3 Return Value / State

| Key                                                                                                         | Type                         | Meaning                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| rootPath                                                                                                    | string                       | Effective root path for the current mode (display only; navigation resolves by nodeId) |
| rootNodeId / baseFolderNodeId                                                                               | number \| null               | Resolved root / base-folder node ids for the current mode                              |
| isAdminMode / isShareMode / isReviewMode                                                                    | boolean                      | Mode flags for the dialog shell                                                        |
| users                                                                                                       | array                        | Approved-user list for add-user flows                                                  |
| folderTree                                                                                                  | `Map<number, object>`        | Loaded folder tree nodes keyed by nodeId (path aliases retained for display)           |
| expandedNodeIds                                                                                             | `Set<number>`                | Expanded tree node ids                                                                 |
| loadingNodeIds                                                                                              | `Set<number>`                | Node ids currently being loaded                                                        |
| loadingAllFolders                                                                                           | boolean                      | Full dialog tree initialization/loading state                                          |
| folderMenuAnchor                                                                                            | element \| null              | Menu anchor element                                                                    |
| folderMenuNodeId                                                                                            | number \| null               | Node id whose menu is currently open                                                   |
| folderMenuView                                                                                              | string                       | `'manage' \| 'selectUser'`                                                             |
| externalShareLoading / externalShareLink / externalShareExpiresInDays / externalShareUnlimited / linkCopied | mixed                        | External-share section state                                                           |
| loadFolderChildren                                                                                          | `(nodeId) => Promise<Array>` | Lazy folder load function with in-flight deduplication                                 |
| toggleExpand                                                                                                | `(nodeId) => Promise<void>`  | Expand/collapse handler                                                                |
| getAllSubfolderNodeIds                                                                                      | `(nodeId) => number[]`       | Helper for recursive permission application (node ids)                                 |
| getUserName                                                                                                 | `(userId) => string`         | Display-name resolver for tree/menu views                                              |
| handleAddUser / handleUserSelect / handleRemoveUser / handleTogglePermission                                | function                     | Menu-driven permission editing actions                                                 |
| handleSave                                                                                                  | `() => Promise<void>`        | Mode-specific save/approve entry point                                                 |
| handleClose                                                                                                 | `() => void`                 | Local reset + close handler                                                            |

### 2.4 Dependencies

- `getApprovedUsers` (`userService`) for share/review add-user choices
- `listFiles` + `resolvePath` (`fileService`) for folder-tree loading and root path→nodeId resolution
- `sharePermissionGateway` for permission/request reads
- `shareReviewUseCase` for review-mode approval persistence
- `sharePermissionSaveUseCase` for share-mode permission persistence
- `adminPermissionSaveUseCase` for admin-mode user-permission persistence
- `buildPermissionDiff` only through save-oriented use-cases, not inline in the controller hook
- `getUserBaseFolder`
- `getServerErrorDisplay`

### 2.5 Side Effects

- Loads users on open for share/review flows
- Initializes folder tree and permission state on open
- Loads child folders lazily and de-duplicates concurrent requests per nodeId by reusing one in-flight Promise
- Calls the appropriate save use-case based on mode:
  - admin mode -> `adminPermissionSaveUseCase`
  - share mode -> `sharePermissionSaveUseCase`
  - review mode -> `shareReviewUseCase`

### 2.6 Error Handling

- All API/use-case failures are surfaced via `onMessage`
- **On save/approve failure:** do **not** call `onClose`; keep the dialog open so the user can retry or cancel manually
- Child-folder load `404` is treated as an empty folder

### 2.7 Verification Scenarios

- [ ] Opening in share/review mode loads users and the initial folder tree
- [ ] Concurrent `loadFolderChildren(nodeId)` calls reuse one request and resolve all callers
- [ ] Admin save success calls `onSave`, shows success message, and closes
- [ ] Share save success calls the share save use-case, shows success message, and closes
- [ ] Review save success calls the review use-case, shows success message, calls `onApprove`, and closes
- [ ] Any save/approve failure keeps the dialog open and shows an error message
- [ ] External-share mode exposes only external-share state/actions

### 2.8 Edge Cases

- `rootPath` depends on mode and `startFromUserHome`
- Review mode may need to inject the requester into the loaded permission state even when not already present
- Folder menu state must reset back to `'manage'` on close
- Concurrent folder loads must not poll `loadingNodeIds` or wait via timers for completion

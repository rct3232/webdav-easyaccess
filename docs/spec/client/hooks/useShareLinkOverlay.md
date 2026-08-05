# useShareLinkOverlay Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Product-overlay controller for FileManager share-link flows: add-to-my-permissions modal lifecycle, share-link permission bootstrap, and leave-share confirmation routing. |
| Used by components/pages | `client/src/pages/FileManager/FileManager.js` |
| Does not own | Generic explorer navigation, command orchestration, progress state, or file list rendering. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useShareLinkOverlay.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useShareLinkOverlay.test.js`

### 2.2 Input Parameters

`useShareLinkOverlay(params)`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| isShareLinkMode | boolean | Y | Whether FileManager is currently rendering in share-link mode. |
| shareToken | string | N | Public share token used for add/check flows. |
| linkInfo | object | N | Share metadata from `ShareLinkLoader` (used for directory routing after success). When it carries `nodeId`, post-success routing is nodeId-first (`/files/node/<nodeId>`, C2.5). |
| user | object | N | Current authenticated user; enables "add to my permissions" bootstrap when present. |
| navigate | (path: string) => void | Y | Shell-owned navigation function. |
| showError | (message: string) => void | Y | Shell-owned message surface. |
| setDrawerOpen | (open: boolean) => void | N | Optional shell setter used when leaving share mode from mobile tree interactions. |
| t | function | Y | Translation function. |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| addToSharedModalOpen | boolean | Whether the add-to-my-permissions modal is visible. |
| setAddToSharedModalOpen | (open: boolean) => void | Setter for modal visibility. |
| addToSharedStatus | string | Modal state (`loading`, `confirm`, etc.) matching current UX. |
| addToSharedConfirmLoading | boolean | Whether the confirm action is in flight. |
| openAddToSharedModal | () => void | Opens modal and runs permission bootstrap. |
| handleAddToSharedConfirm | () => Promise<void> | Confirms add-to-my-permissions flow and preserves current post-success navigation. |
| leaveShareConfirmOpen | boolean | Whether the leave-share confirmation dialog is visible. |
| setLeaveShareConfirmOpen | (open: boolean) => void | Setter for leave-share dialog visibility. |
| leaveShareConfirmTargetPath | string \| null | Destination path selected before leaving share mode. |
| setLeaveShareConfirmTargetPath | (path: string \| null) => void | Setter for the pending destination path. |
| handleLeaveSharePathClick | (path: string) => void | Opens leave-share confirmation for a target path. |
| handleLeaveShareConfirm | () => void | Confirms leaving share mode and navigates to authenticated files route. |

### 2.4 Responsibilities

- **Owns**
  - Share-link permission bootstrap when an authenticated user lands on a shared directory and may need the add-to-my-permissions flow.
  - Modal/dialog state for add-to-my-permissions and leave-share confirmation.
  - Product-specific navigation after successful add-to-my-permissions for shared directories.
- **Does not own**
  - Generic explorer folder navigation or breadcrumb behavior.
  - File operation commands or progress handling.
  - Generic login modal state unrelated to share-link overlay flows.

### 2.5 Dependencies

- `client/src/services/shareLinkService.js`
- Pure path helpers such as `toFilesPath` (fallback when `linkInfo` has no `nodeId`)
- Shell-owned routing and error presentation callbacks

### 2.6 Side Effects

- May call share-link permission check/add APIs.
- May auto-open the add-to-my-permissions modal after authenticated share-link entry.
- May navigate to `/files/*` after success or leave-share confirmation. Directory routing after add-to-shared is nodeId-first (`/files/node/<linkInfo.nodeId>`); the legacy `/files/<path>` route is the fallback when `nodeId` is unavailable (C2.5, removed in Phase 5).

### 2.7 Error Handling

- Permission bootstrap timeout or failure should preserve current behavior: close the modal rather than trapping the user.
- Confirm action failures should surface the same translated error message via `showError`.

### 2.8 Verification Scenarios

These scenarios should be covered by a dedicated hook unit test in `client/src/pages/FileManager/hooks/__tests__/useShareLinkOverlay.test.js`, not only by FileManager page regression tests.

- [ ] Authenticated share-link entry triggers the same add-to-my-permissions bootstrap behavior as today.
- [ ] If the user already has sufficient permission, the modal closes and shared-directory navigation is nodeId-first when `linkInfo.nodeId` is present (`/files/node/<id>`).
- [ ] Confirming add-to-my-permissions keeps the same success navigation and loading state, routing to the nodeId route when available.
- [ ] Clicking a non-share tree path in share mode opens leave-share confirmation and confirmation routes to the authenticated files path.

### 2.9 Edge Cases

- Missing `shareToken` is a no-op for add-to-my-permissions actions.
- `linkInfo` without `nodeId` falls back to the legacy `/files/<path>` route for shared-directory navigation.
- Repeated permission bootstrap for the same token is deduplicated.
- Out-of-order async responses must not reopen or overwrite the latest modal state.

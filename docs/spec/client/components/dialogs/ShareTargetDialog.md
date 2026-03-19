# ShareTargetDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog shell for item-level sharing. Admin users can edit direct access and external share state through gateway/use-case-backed flows; non-admin users see shared-manage actions through `useSharedManage`. |
| Used in | FileManager (share action) |
| Related components | `SharedManageBody`, `ExternalShareSection`, `useSharedManage`, `sharePermissionGateway`, sharing save use-cases, `shareLinkService` |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareTargetDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/ShareTargetDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| file | object | Y | - | Selected item to share; includes `path`, `basename`/`name`, `type`, and caller-known permission flags |
| user | object | Y | - | Current user |
| onMessage | function | N | - | Message handler |
| onSave | function | N | - | Success callback after admin-side save flows |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Dialog close | - |
| onMessage | Show message | - |
| onSave | Admin permission/share action completed successfully | - |

### 2.4 Dependencies

- **imports:** `useSharedManage`, `SharedManageBody`, `ExternalShareSection`, `sharePermissionGateway`, `shareTargetPermissionSaveUseCase`, `deriveShareTargetAdminView`, `getApprovedUsers`, `shareLinkService`
- **Reference implementation:** `client/src/components/dialogs/ShareTargetDialog.js`

### 2.4.1 Boundary notes

- Admin-side permission reads/mutations must stay behind `sharePermissionGateway` and `shareTargetPermissionSaveUseCase`.
- User filtering and gateway-response shaping for the admin branch must stay behind prepared helper/use-case seams such as `deriveShareTargetAdminView`; this dialog should remain a shell/controller composition layer rather than a policy-heavy rules container.
- Non-admin request/cancel/revoke ownership remains in `useSharedManage`; this dialog only wires that branch into dialog chrome.
- Browser-specific side effects required by `ExternalShareSection` must be passed in as adapter-backed callbacks rather than implemented through direct `window` access in the child view.

### 2.5 i18n Keys

- `dialogs.*`, `permissions.*`, `common.*`

### 2.6 Conditional Rendering

- Admin users see:
  - user search / access list editing UI
  - folder/file permission options
  - external share section for file targets
- Non-admin users see `SharedManageBody` driven by `useSharedManage`
- Permission-option rendering depends on prepared permission state for files vs directories
- This component may remain a shell plus controller wiring, but low-level permission IO must go through `sharePermissionGateway` and dedicated save orchestration
- File targets render the external-share section; directories do not

### 2.7 Data/Workflow Boundaries

- Admin save flows must not implement raw revoke/grant loops directly in the component once the refactor is complete
- File/folder access reads and mutations must go through `sharePermissionGateway`
- Request/cancel/revoke for non-admin users remain owned by `useSharedManage`

### 2.8 Verification Scenarios

- [ ] Admin mode shows search, editable access list, and save/cancel actions
- [ ] Non-admin mode renders shared-manage actions and close-only footer
- [ ] File targets render external-share controls; folders do not
- [ ] Successful admin save calls `onSave` and closes
- [ ] Failed admin save keeps the dialog open and shows an error
- [ ] File and folder save flows preserve their current visible outcomes

### 2.9 Edge Cases

- pathPermission ADMIN – limited options
- hasSameLevelFilePermission – revoke/same-as-path options
- Missing `file` should prevent actionable save behavior
- Direct read/admin flags on `file` are caller-provided hints, not a replacement for gateway-backed reads in admin flows

### 2.10 API Error Behavior

- **On API success (permission grant/revoke/save):** `onSave` is called and the dialog closes.
- **On API failure (4xx/5xx, network error):** Dialog **stays open**. Error is shown via `onMessage`. Partial failures must not be silently treated as success.

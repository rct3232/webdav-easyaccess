# SystemSettingsContent Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | System settings for admins: backend-health status card, registration toggle, show hidden files toggle, orphan data cleanup, permission cleanup, key-lost warning, and the "Advanced settings" config accordion. Direct content. Admin only. |
| Used in | MyPageContentArea (when selectedCategory is 'admin-settings') |
| Related components | adminService, getShowHiddenFiles, setShowHiddenFiles (localStorage), SystemConfigEditor |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/SystemSettingsContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/SystemSettingsContent.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| onMessage | function | N | - | Message handler for feedback |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onMessage | Feedback from actions | (object) – { type, text } |

### 2.4 Dependencies

- **imports:** useTranslation, usePageHeader (PageHeaderContext), adminService, getShowHiddenFiles, setShowHiddenFiles (localStorage)
- **Header:** Uses `usePageHeader()` to set title `admin.systemSettings` and no header actions (`setActions(null)`). Resets on unmount.
- **Auto-save:** Registration toggle calls `adminService.updateSettings` on change; show hidden files persists to localStorage on change; cleanup actions run on confirm.
- **Advanced settings accordion:** Below the migration row, an MUI Accordion titled `admin.advancedSettings` renders `<SystemConfigEditor active={expanded} onSnackbar={...} />`. The config is fetched lazily on first expand (see `SystemConfigEditor.md`).
- **Backend-health status card (D3):** At the top of the page (above the key-lost warning) an Alert/card renders `GET /api/admin/health` (`adminService.getAdminHealth()`). It is shown **only when at least one backend is failing** and lists **only the failing backends** — name + `admin.health.fail` label + classification hint/code + last-checked. Healthy/unknown backends are never listed. `data-testid="backend-health-card"`.
- **Success feedback:** Registration toggle, show hidden files toggle, data cleanup, and permission cleanup each show a success toast (Snackbar) when the action completes without error. The config editor reuses the same page-level Snackbar via `onSnackbar`.

### 2.5 i18n Keys

- `admin.systemSettings`
- `admin.registrationEnabled`, `admin.registrationEnabledDesc`
- `admin.showHiddenFiles`, `admin.showHiddenFilesDesc`
- `admin.dataCleanup`, `admin.dataCleanupDesc`
- `admin.permissionCleanup`, `admin.permissionCleanupDesc`
- `admin.orphanCleanupConfirmTitle`, `admin.orphanCleanupConfirmBody`, `admin.orphanCleanupConfirmNote`
- `admin.permissionCleanupConfirmTitle`, `admin.permissionCleanupConfirmQuestion`
- `admin.runCleanup`, `admin.run`
- `common.cancel`
- `admin.settingsLoadFail`, `admin.registrationSaveSuccess`, `admin.showHiddenFilesSaveSuccess`, `admin.settingsSaveFail`
- `admin.noDataToClean`, `admin.cleanupDone`, `admin.cleanupDonePartial`, `admin.orphanCleanupFail`
- `admin.noPermissionToFix`, `admin.permissionCleanupDone`, `admin.permissionCleanupDonePartial`, `admin.permissionCleanupFail`

### 2.6 Conditional Rendering

- No header actions.
- Registration toggle (auto-saves on change, optional loading state during API call), show hidden files toggle (persists to localStorage on change).
- Data cleanup button with confirm dialog.
- Permission cleanup button with confirm dialog.
- Advanced settings Accordion (collapsed by default; config fetched on expand).
- Snackbar for feedback.

### 2.7 Verification Scenarios

- [x] Renders registration and show hidden files toggles
- [x] Registration toggle auto-saves on change (calls updateSettings API)
- [x] Toggle show hidden files persists to localStorage
- [x] Data cleanup shows confirm dialog and runs on confirm
- [x] Permission cleanup shows confirm dialog and runs on confirm

### 2.8 Edge Cases

- Cleanup confirmations – dialogs before run.
- Settings load failure – error message via Snackbar.

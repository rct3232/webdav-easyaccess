# SystemSettingsContent Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | System settings for admins: backend-health status card, registration toggle, show hidden files toggle, orphan data cleanup, permission cleanup, env→DB config sync, and the "Advanced settings" config accordion. Direct content. Admin only. |
| Used in            | MyPageContentArea (when selectedCategory is 'admin-settings')                                                                                                                                                                               |
| Related components | adminService, getShowHiddenFiles, setShowHiddenFiles (localStorage), SystemConfigEditor                                                                                                                                                     |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/SystemSettingsContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/SystemSettingsContent.test.js`

### 2.2 Props

| Name      | Type     | Required | Default | Description                  |
| --------- | -------- | -------- | ------- | ---------------------------- |
| onMessage | function | N        | -       | Message handler for feedback |

### 2.3 Callback Signatures

| Callback  | When invoked          | Arguments                 |
| --------- | --------------------- | ------------------------- |
| onMessage | Feedback from actions | (object) – { type, text } |

### 2.4 Dependencies

- **imports:** useTranslation, usePageHeader (PageHeaderContext), adminService, getShowHiddenFiles, setShowHiddenFiles (localStorage)
- **Header:** Uses `usePageHeader()` to set title `admin.systemSettings` and no header actions (`setActions(null)`). Resets on unmount.
- **Auto-save:** Registration toggle calls `adminService.updateSettings` on change; show hidden files persists to localStorage on change; cleanup actions run on confirm.
- **Env→DB config sync row:** Below the metadata migration row, an action row ("Sync environment → DB", icon button `admin.runConfigSync`) opens a **preview-then-apply** dialog:
  1. on open it calls `adminService.getConfigSyncReport()` (`GET /api/admin/config/sync-report`) and shows the drift summary (keys to update / to add, or "nothing to sync");
  2. the "Apply" button (`admin.runConfigSync`) is disabled while the report loads, on a report error, when there is nothing actionable (`drift === 0 && envOnly === 0`), and while applying;
  3. on confirm it calls `adminService.syncConfigFromEnv()` (`POST /api/admin/config/sync-from-env`); success closes the dialog and shows the page Snackbar (`getServerMessageDisplay` → `serverMessages.admin.configSyncDone`); a failure keeps the dialog open, shows the Snackbar error, and re-fetches the report so the operator can retry. Server contract: `docs/spec/server/routes/config.md`; feature: `docs/features/config-sync.md`. The action syncs the **running environment** (DB rows are not deleted and T0 keys are never written server-side).
- **Advanced settings accordion:** Below the sync row, an MUI Accordion titled `admin.advancedSettings` renders `<SystemConfigEditor active={expanded} onSnackbar={...} />`. The config is fetched lazily on first expand (see `SystemConfigEditor.md`). The editor renders **two top-level sections**: Section A "Runtime settings" (editable) and Section B "Deploy-time / platform configuration" (read-only summary of T0 + env-sourced keys).
- **Backend-health status card (D3):** At the top of the page an Alert/card renders `GET /api/admin/health` (`adminService.getAdminHealth()`). It is shown **only when an in-use backend is failing** and lists **only the failing in-use backends** — name + `admin.health.fail` label + classification hint/code + last-checked. Healthy/unknown backends and **inactive backends** (active set derived from the effective config: `WEA_STORAGE_BACKEND` for metadata + `WEA_FILE_STORAGE` for file storage) are never listed. `data-testid="backend-health-card"`. The admin-health endpoint authorizes via the JWT `is_admin` claim (no DB read), so the card can still load and display a metadata-DB failure while the DB itself is down.
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
- `admin.health.title`, `admin.health.fail`, `admin.health.hintPrefix`, `admin.health.lastChecked` (`lastChecked` interpolates `{ time }`) — backend-health card
- `admin.runMigration`, `admin.runMetadataMigration` — migration row buttons
- `admin.configSyncFromEnv`, `admin.configSyncFromEnvDesc`, `admin.runConfigSync`, `admin.configSyncConfirmTitle`, `admin.configSyncPreviewLoading`, `admin.configSyncPreviewReportFail`, `admin.configSyncPreviewNoChanges`, `admin.configSyncPreviewChanges` (`{updated}`/`{added}`), `admin.configSyncPreviewUpdatedKeys` (`{keys}`), `admin.configSyncPreviewAddedKeys` (`{keys}`), `admin.configSyncApplyFail`, `admin.configSyncDone` — env→DB sync row + preview dialog
- `serverMessages.admin.configSyncDone` (server message code)

### 2.6 Conditional Rendering

- No header actions.
- Registration toggle (auto-saves on change, optional loading state during API call), show hidden files toggle (persists to localStorage on change).
- Data cleanup button with confirm dialog.
- Permission cleanup button with confirm dialog.
- Env→DB sync action row opens a preview dialog (report fetched on open); "Apply" gated on an actionable, error-free report.
- Advanced settings Accordion (collapsed by default; config fetched on expand).
- Backend-health card renders above the settings rows, only when its condition holds (a failing in-use backend).
- Snackbar for feedback.

### 2.7 Verification Scenarios

- [x] Renders registration and show hidden files toggles
- [x] Registration toggle auto-saves on change (calls updateSettings API)
- [x] Toggle show hidden files persists to localStorage
- [x] Data cleanup shows confirm dialog and runs on confirm
- [x] Permission cleanup shows confirm dialog and runs on confirm
- [x] Env→DB sync row opens a preview dialog that fetches `GET /admin/config/sync-report`, renders the summary (changes / nothing-to-sync), disables Apply while loading / on error / when nothing is actionable, and applies via `POST /admin/config/sync-from-env` on confirm
- [x] Env→DB sync success shows the success Snackbar and closes the dialog; a failed apply keeps the dialog open, shows the error Snackbar, and re-fetches the report
- [x] Backend-health card renders only when an in-use backend is failing and lists only the failing in-use backends
- [x] Advanced settings accordion fetches config lazily on expand

### 2.8 Edge Cases

- Cleanup confirmations – dialogs before run.
- Settings load failure – error message via Snackbar.

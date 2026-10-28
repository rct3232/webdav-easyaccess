# SystemSettingsContent Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | System settings for admins: backend-health status card, registration toggle, show hidden files toggle, orphan data cleanup, permission cleanup, storage & metadata migration rows, ".env setup needed" banner, env→DB config sync, the "Admin reports" section, and the "Advanced settings" config accordion. Direct content. Admin only. |
| Used in            | MyPageContentArea (when selectedCategory is 'admin-settings')                                                                                                                                                                                                                                                                             |
| Related components | adminService, getShowHiddenFiles, setShowHiddenFiles (localStorage), SystemConfigEditor, AdminReportsContent                                                                                                                                                                                                                              |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/SystemSettingsContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/SystemSettingsContent.test.js`

### 2.2 Props

None. `SystemSettingsContent` is a zero-prop component (`const SystemSettingsContent = () => { ... }`): it takes no `onMessage` prop and manages its own page-level Snackbar via local `message` state.

### 2.3 Callback Signatures

None at the page level. Feedback callbacks exist only on child components: `MigrationDialog` and `MetadataMigrationDialog` receive an `onMessage` handler (wired to `setMessage`), and `SystemConfigEditor` and `AdminReportsContent` receive an `onSnackbar` handler (wired to the same page Snackbar).

### 2.4 Dependencies

- **imports:** useTranslation, usePageHeader (PageHeaderContext), adminService, getShowHiddenFiles, setShowHiddenFiles (localStorage)
- **Header:** Uses `usePageHeader()` to set title `admin.systemSettings` and no header actions (`setActions(null)`). Resets on unmount.
- **Auto-save:** Registration toggle calls `adminService.updateSettings` on change; show hidden files persists to localStorage on change; cleanup actions run on confirm.
- **Data cleanup summary:** The orphan-cleanup button calls `adminService.cleanupOrphaned()` (`POST /api/admin/cleanup/orphaned`) and reads the real `cleanupOrphanedData()` shape: `deletedBlobs = gc.tier1.deletedBlobs`, `deletedRows = gc.tier1.deletedRows`, `deletedKeys = gc.tier2.deletedKeys` (missing → 0) and `reports = orphanedNodes.length + pendingUploadNodes.length`. All-zero → `admin.noDataToClean`; otherwise `admin.cleanupDoneGc` (`{blobs}/{rows}/{keys}`), with `admin.cleanupReports` (`{orphaned}/{pending}`) appended when reports > 0. Any error entry (top-level `errors` or any GC tier `errors`) raises the Snackbar severity to `warning` (else `success`).
- **Env→DB config sync row:** Below the metadata migration row, an action row ("Sync environment → DB", icon button `admin.runConfigSync`) opens a **preview-then-apply** dialog:
  1. on open it calls `adminService.getConfigSyncReport()` (`GET /api/admin/config/sync-report`) and shows the drift summary (keys to update / to add, or "nothing to sync");
  2. the "Apply" button (`admin.runConfigSync`) is disabled while the report loads, on a report error, when there is nothing actionable (`drift === 0 && envOnly === 0`), and while applying;
  3. on confirm it calls `adminService.syncConfigFromEnv()` (`POST /api/admin/config/sync-from-env`); success closes the dialog and shows the page Snackbar (`getServerMessageDisplay` → `serverMessages.admin.configSyncDone`). A failure keeps the dialog open, shows the error Snackbar and an in-dialog error Alert, and does NOT re-fetch the report — the Apply button stays disabled while the error is shown; the operator closes and reopens the dialog to retry (reopening re-fetches the report). Server contract: `docs/spec/server/routes/config.md`; feature: `docs/features/config-sync.md`. The action syncs the **running environment** (DB rows are not deleted and T0 keys are never written server-side).
- **Admin reports section:** Between the env→DB config-sync row and the Advanced settings accordion, the page mounts `<AdminReportsContent onSnackbar={...} />` (`data-testid="admin-reports-section"`). The section owns its list refresh and row-level repairs end-to-end (contract: `AdminReportsContent.md`); `SystemSettingsContent` itself stays zero-prop and keeps the child on the shared page Snackbar.
- **Advanced settings accordion:** Below the sync row, an MUI Accordion titled `admin.advancedSettings` renders `<SystemConfigEditor active={expanded} onSnackbar={...} />`. The config is fetched lazily on first expand (see `SystemConfigEditor.md`). The editor renders **two top-level sections**: Section A "Runtime settings" (editable) and Section B "Deploy-time configuration" (read-only summary of T0 + env-sourced keys; locale `admin.config.sectionTitlePlatform`).
- **Migration rows:** A "Storage migration" action row (`admin.storageMigration`/`admin.storageMigrationDesc`, icon `admin.runMigration`) opens `MigrationDialog`, and a "Metadata migration" action row (`admin.metadataMigration`/`admin.metadataMigrationDesc`, icon `admin.runMetadataMigration`) opens `MetadataMigrationDialog`. Both sit above the env→DB sync row and report back through the page Snackbar (`onMessage`).
- **".env setup needed" banner:** When the metadata backend of another environment already holds data (`metadataPresence.otherHasData`, from `getMigrationPresence` via `migrationService`), an Alert (`data-testid="env-setup-needed-banner"`, text `admin.envSetupNeededTitle`/`admin.envSetupNeededBody`) renders below the backend-health card; its action button (`admin.envSetupNeededAction`) opens the MetadataMigrationDialog.
- **Backend-health status card:** At the top of the page an Alert/card renders `GET /api/admin/health` (`adminService.getAdminHealth()`). It is shown **only when an in-use backend is failing** and lists **only the failing in-use backends** — name + `admin.health.fail` label + classification hint/code + last-checked. Healthy/unknown backends and **inactive backends** (active set derived from the effective config: the remote PostgreSQL metadata backend when any `WEA_DB_*` credential is set, else sqlite; `WEA_FILE_STORAGE` for file storage) are never listed. `data-testid="backend-health-card"`. The admin-health endpoint authorizes via the JWT `is_admin` claim (no DB read), so the card can still load and display a metadata-DB failure while the DB itself is down.
- **AI role warning rows (5-state):** the card additionally renders the `ai.*` tracker rows of the same snapshot (`ai.embed`, `ai.chat` — every `backends` key starting with `ai.`) **only when their admin 5-state mapping is a warning state** (`preparing`, `probe_failed`, `partial`). `ok` and `not_configured` are silent in this warning card (the full 5-state admin display belongs to the AI governance panel). The mapping is the pure `client/src/utils/aiRoleState.js` (`mapAiRoleState`): `preparing:true` → `preparing` (phase/progress shown), `status:'ok'` with a `hint` → `partial`, `status:'ok'` → `ok`, `status:'fail'` → `probe_failed` (reason shown), otherwise `not_configured`. The warning rows live inside the same `backend-health-card` testid; per-role labels are `admin.ai.role.<role>` and state labels `admin.aiState.<state>`; a `partial` hint is rendered through `t(hint, { defaultValue: hint })` so shipped hint keys (e.g. `ai.provisionFailed`) translate and unknown text falls back to the raw string. `vision`/`asr` are NOT tracker rows (`backendHealth.md` §2.3) and appear only when the AI governance panel lands (P4).
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
- `admin.noDataToClean`, `admin.cleanupDoneGc`, `admin.cleanupReports`, `admin.orphanCleanupFail`
- `admin.noPermissionToFix`, `admin.permissionCleanupDone`, `admin.permissionCleanupDonePartial`, `admin.permissionCleanupFail`
- `admin.health.title`, `admin.health.fail`, `admin.health.hintPrefix`, `admin.health.lastChecked` (`lastChecked` interpolates `{ time }`) — backend-health card
- `admin.ai.title` — AI capability rows heading; `admin.ai.role.embed`/`admin.ai.role.chat` — per-role labels
- `admin.aiState.not_configured`, `admin.aiState.preparing`, `admin.aiState.probe_failed`, `admin.aiState.partial`, `admin.aiState.ok` — the five admin states
- `ai.provisionFailed` — i18n mirror of the provisioner's health-row `hint` (en/ko)
- `admin.storageMigration`, `admin.storageMigrationDesc`, `admin.runMigration` — storage migration row
- `admin.metadataMigration`, `admin.metadataMigrationDesc`, `admin.runMetadataMigration` — metadata migration row
- `admin.envSetupNeededTitle`, `admin.envSetupNeededBody`, `admin.envSetupNeededAction` — ".env setup needed" banner
- `admin.configSyncFromEnv`, `admin.configSyncFromEnvDesc`, `admin.runConfigSync`, `admin.configSyncConfirmTitle`, `admin.configSyncConfirmScope`, `admin.configSyncPreviewLoading`, `admin.configSyncPreviewReportFail`, `admin.configSyncPreviewNoChanges`, `admin.configSyncPreviewChanges` (`{updated}`/`{added}`), `admin.configSyncPreviewUpdatedKeys` (`{keys}`), `admin.configSyncPreviewAddedKeys` (`{keys}`), `admin.configSyncApplyFail`, `admin.configSyncDone` — env→DB sync row + preview dialog
- `admin.reports.*` — owned by the AdminReportsContent section (see `AdminReportsContent.md`)
- `serverMessages.admin.configSyncDone` (server message code)

### 2.6 Conditional Rendering

- No header actions.
- Registration toggle (auto-saves on change, optional loading state during API call), show hidden files toggle (persists to localStorage on change).
- Data cleanup button with confirm dialog.
- Permission cleanup button with confirm dialog.
- Storage migration row (opens MigrationDialog) and metadata migration row (opens MetadataMigrationDialog).
- ".env setup needed" banner renders below the backend-health card, only when `metadataPresence.otherHasData` is set.
- Env→DB sync action row opens a preview dialog (report fetched on open); "Apply" gated on an actionable, error-free report.
- Admin reports section between the sync row and the Advanced settings accordion (no fetch on mount; refresh-driven list with row-level repair actions).
- Advanced settings Accordion (collapsed by default; config fetched on expand).
- Backend-health card renders above the settings rows, only when its condition holds (a failing in-use backend).
- Snackbar for feedback.

### 2.7 Verification Scenarios

- [x] Renders registration and show hidden files toggles
- [x] Registration toggle auto-saves on change (calls updateSettings API)
- [x] Toggle show hidden files persists to localStorage
- [x] Data cleanup shows confirm dialog and runs on confirm
- [x] Data cleanup summarizes the GC result (blob/row/key counts + manual-review reports), shows "no data to clean" on an all-zero cycle, and warns when the cycle reports errors
- [x] Permission cleanup shows confirm dialog and runs on confirm
- [x] Env→DB sync row opens a preview dialog that fetches `GET /admin/config/sync-report`, renders the summary (changes / nothing-to-sync), disables Apply while loading / on error / when nothing is actionable, and applies via `POST /admin/config/sync-from-env` on confirm
- [x] Env→DB sync success shows the success Snackbar and closes the dialog; a failed apply keeps the dialog open, shows the error Snackbar and an in-dialog error Alert, and does NOT re-fetch the report (retry requires closing and reopening the dialog)
- [x] Backend-health card renders only when an in-use backend is failing and lists only the failing in-use backends
- [x] Advanced settings accordion fetches config lazily on expand
- [x] Admin reports section (`admin-reports-section`) mounts between the env→DB sync row and the Advanced settings accordion, fed by the page Snackbar callback

### 2.8 Edge Cases

- Cleanup confirmations – dialogs before run.
- Settings load failure – error message via Snackbar.

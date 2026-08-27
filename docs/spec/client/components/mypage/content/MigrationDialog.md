# MigrationDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Admin-only dialog that runs a blob-storage migration between WebDAV and S3: dest-config form, Start, 400ms progress polling, Cancel. |
| Used in | `SystemSettingsContent` settings tab (Storage migration action row). |
| Related components | migrationService, getServerErrorDisplay, MUI Dialog. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/MigrationDialog.js`
- **Test file:** `client/src/components/mypage/content/__tests__/MigrationDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Controls dialog visibility |
| onClose | function | Y | - | Closes the dialog |
| onMessage | function | N | - | Snackbar feedback handler `({ type, text })` (SystemSettingsContent settings Snackbar) |

### 2.3 Form Fields

| Field | Control | Values / Default | Notes |
|-------|---------|------------------|-------|
| Source → Destination label | Text | — | Read-only; derived from `GET /api/admin/migration/info` (`source`); destination is the other backend (webdav → s3, s3 → webdav). No user choice. |
| Mode | Radio | `dry-run` (default) \| `apply` | |
| Auto-resume note | Text | — | Shown when mode is `apply`: already copied files are skipped automatically |
| S3 dest | TextFields | bucket* , accessKey* , secretKey* (password), endpoint (optional), region (default `us-east-1`) | Shown when info `source` is `webdav` |
| WebDAV dest | TextFields | url* , username* , password* (password), authType (default `auto`), upstreamUrl (optional) | Shown when info `source` is `s3` |

`*` required; Start is blocked until all required fields for the current dest type are filled.

### 2.4 Behavior

- **Info load:** when the dialog opens, calls `getMigrationInfo()`. While loading, a small progress indicator is shown and Start is disabled. On failure an inline error (`migration.infoLoadFail`) is shown and Start stays disabled. Destination type = `source === 'webdav' ? 's3' : 'webdav'`.
- **Start:** validates required fields client-side; on success calls `startBlobMigration` with `{ mode, force: false, dest }` (no `direction`), then polls `getBlobMigrationStatus(jobId)` immediately and every 400ms (mirrors `useBulkOperations`).
- **Polling:** stops on terminal status (`completed`, `failed`, `cancelled`); interval cleared on unmount/close.
- **Progress UI:** LinearProgress (`progress/total`), current path, copied/skipped/failed counts, error list (first 5) when failed, result summary on terminal. `jobId` stays visible.
- **Terminal popups:** when a job reaches a terminal status (`completed`, `failed`, `cancelled`), a separate Dialog is shown **exactly once per job run** (a `useRef` guard records the `jobId` whose popup was already shown; `handleStart` resets the guard so the next run can popup again). The popup content depends on the terminal state:
  - `completed` + `mode === 'apply'` → **Restart popup** (`migration.restartRequiredTitle`/`restartRequiredBody`): instructs the admin to update `WEA_FILE_STORAGE` + the target storage env block in `.env` and restart the server process.
  - `completed` + `mode === 'dry-run'` → **Dry-run popup** (`migration.dryRunDoneTitle`/`dryRunDoneBody`): reports nothing was written and interpolates the scan result counts from `job.results` (`copied`, `skipped`, `failed`). No restart instructions.
  - `failed` → **Failed popup** (`migration.failedTitle`/`migration.failedBody`): points at the error list in the dialog and the Apply-mode resume behavior.
  - `cancelled` → **Cancelled popup** (`migration.cancelledTitle`/`migration.cancelledBody`): points at the Apply-mode resume behavior.
  Dismissal is via the OK button; the inline terminal summary UI is unaffected and always rendered.
- **Cancel:** calls `cancelBlobMigration(jobId)`; polling continues until the job reaches `cancelled`.
- **Start disabled** while a job is running, while starting, while info is loading, or when info failed to load; **Cancel job** shown only while running.
- **Errors:** missing required fields and `400` start failures show an inline Alert; polling/cancel failures use `onMessage`.

### 2.5 i18n Keys

- `migration.*` (title, sourceLabel, destinationLabel, backendWebdav, backendS3, infoLoading, infoLoadFail, mode*, dest*, field labels, autoResume, start, cancelJob, status*, progress, current, copied/skipped/failed, errorsTitle, jobId, requiredFields, startFail, statusLoadFail, cancelFail, cancelSuccess, ok) — added to `client/src/locales/en.json` and `ko.json`.
- Terminal popup copy: `migration.restartRequiredTitle`, `migration.restartRequiredBody`, `migration.dryRunDoneTitle`, `migration.dryRunDoneBody` (interpolates `copied`/`skipped`/`failed`), `migration.failedTitle`, `migration.failedBody`, `migration.cancelledTitle`, `migration.cancelledBody`.
- `admin.storageMigration`, `admin.storageMigrationDesc`, `admin.runMigration` — SystemSettingsContent settings row.
- `serverErrors.admin.migration*` and `serverMessages.admin.migrationCancelled` for server codes.

### 2.6 Verification Scenarios

- [ ] Dialog loads `/info` and shows the read-only Source → Destination label
- [ ] WebDAV source renders S3 destination fields; S3 source (override) renders WebDAV destination fields; apply mode shows the auto-resume note
- [ ] Required-field validation blocks Start without a network call
- [ ] Start → poll → running progress → completed summary
- [ ] Apply-mode completion shows the restart popup; dry-run completion shows the dry-run popup (with interpolated counts), not the restart popup
- [ ] Failed completion shows the failed popup; cancelled completion shows the cancelled popup
- [ ] Each terminal popup is shown exactly once per job run
- [ ] Info-load failure shows an inline error and disables Start
- [ ] Cancel calls the cancel API and stops on `cancelled`

### 2.7 Edge Cases

- Poll returning terminal status immediately after start must not leave a running interval.
- Interval is cleared on close and on unmount.

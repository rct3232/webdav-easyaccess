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
| Direction | Radio | `webdav-to-s3` (default) \| `s3-to-webdav` | Determines dest type |
| Mode | Radio | `dry-run` (default) \| `apply` | |
| Auto-resume note | Text | — | Shown when mode is `apply`: already copied files are skipped automatically |
| S3 dest | TextFields | bucket* , accessKey* , secretKey* (password), endpoint (optional), region (default `us-east-1`) | Shown when direction is `webdav-to-s3` |
| WebDAV dest | TextFields | url* , username* , password* (password), authType (default `auto`), upstreamUrl (optional) | Shown when direction is `s3-to-webdav` |

`*` required; Start is blocked until all required fields for the current dest type are filled.

### 2.4 Behavior

- **Start:** validates required fields client-side; on success calls `startBlobMigration` with `{ direction, mode, force: false, dest }`, then polls `getBlobMigrationStatus(jobId)` immediately and every 400ms (mirrors `useBulkOperations`).
- **Polling:** stops on terminal status (`completed`, `failed`, `cancelled`); interval cleared on unmount/close.
- **Progress UI:** LinearProgress (`progress/total`), current path, copied/skipped/failed counts, error list (first 5) when failed, result summary on terminal. `jobId` stays visible.
- **Cancel:** calls `cancelBlobMigration(jobId)`; polling continues until the job reaches `cancelled`.
- **Start disabled** while a job is running or while starting; **Cancel job** shown only while running.
- **Errors:** missing required fields and `400` start failures show an inline Alert; polling/cancel failures use `onMessage`.

### 2.5 i18n Keys

- `migration.*` (title, direction*, mode*, dest*, field labels, autoResume, start, cancelJob, status*, progress, current, copied/skipped/failed, errorsTitle, jobId, requiredFields, startFail, statusLoadFail, cancelFail, cancelSuccess) — added to `client/src/locales/en.json` and `ko.json`.
- `admin.storageMigration`, `admin.storageMigrationDesc`, `admin.runMigration` — SystemSettingsContent settings row.
- `serverErrors.admin.migration*` and `serverMessages.admin.migrationCancelled` for server codes.

### 2.6 Verification Scenarios

- [ ] Renders S3 destination fields by default; direction radios correct
- [ ] `s3-to-webdav` shows WebDAV destination fields; apply mode shows the auto-resume note
- [ ] Required-field validation blocks Start without a network call
- [ ] Start → poll → running progress → completed summary
- [ ] Cancel calls the cancel API and stops on `cancelled`

### 2.7 Edge Cases

- Poll returning terminal status immediately after start must not leave a running interval.
- Interval is cleared on close and on unmount.

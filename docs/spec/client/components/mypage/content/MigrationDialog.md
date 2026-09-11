# MigrationDialog Spec

## 1. Overview

| Item               | Description                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | Admin-only dialog that STARTS a blob-storage migration between WebDAV and S3 (dest-config form + Start). Progress/cancel live on `/migration` (`docs/spec/client/pages/MigrationPage.md`) — the dialog closes and navigates there on a successful start (relocation since the unified migration mode). |
| Used in            | `SystemSettingsContent` settings tab (Storage migration action row).                                                                 |
| Related components | migrationService, getServerErrorDisplay, MUI Dialog.                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/MigrationDialog.js`
- **Test file:** `client/src/components/mypage/content/__tests__/MigrationDialog.test.js`

### 2.2 Props

| Name      | Type     | Required | Default | Description                                                                            |
| --------- | -------- | -------- | ------- | -------------------------------------------------------------------------------------- |
| open      | boolean  | Y        | -       | Controls dialog visibility                                                             |
| onClose   | function | Y        | -       | Closes the dialog                                                                      |
| onMessage | function | N        | -       | Snackbar feedback handler `({ type, text })` (SystemSettingsContent settings Snackbar) |

### 2.3 Form Fields

| Field                      | Control    | Values / Default                                                                                 | Notes                                                                                                                                            |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source → Destination label | Text       | —                                                                                                | Read-only; derived from `GET /api/admin/migration/info` (`source`); destination is the other backend (webdav → s3, s3 → webdav). No user choice. |
| Mode                       | Radio      | `dry-run` (default) \| `apply`                                                                   |                                                                                                                                                  |
| Auto-resume note           | Text       | —                                                                                                | Shown when mode is `apply`: already copied files are skipped automatically                                                                       |
| S3 dest                    | TextFields | bucket* , accessKey* , secretKey\* (password), endpoint (optional), region (default `us-east-1`) | Shown when info `source` is `webdav`                                                                                                             |
| WebDAV dest                | TextFields | url* , username* , password\* (password), authType (default `auto`), upstreamUrl (optional)      | Shown when info `source` is `s3`                                                                                                                 |

`*` required; Start is blocked until all required fields for the current dest type are filled.

### 2.4 Behavior

- **Info load:** when the dialog opens, calls `getMigrationInfo()`. While loading, a small progress indicator is shown and Start is disabled. On failure an inline error (`migration.infoLoadFail`) is shown and Start stays disabled. Destination type = `source === 'webdav' ? 's3' : 'webdav'`.
- **Start:** validates required fields client-side; on success calls `startBlobMigration` with `{ mode, force: false, dest }` (no `direction`), then **closes the dialog and navigates to `/migration`**, which takes over polling, progress, the terminal modal and the Cancel control (`docs/spec/client/pages/MigrationPage.md`).
- **Start disabled** while starting, while info is loading, or when info failed to load.
- **Errors:** missing required fields and start failures show an inline Alert.

### 2.5 i18n Keys

- `migration.*` (title, sourceLabel, destinationLabel, backendWebdav, backendS3, infoLoading, infoLoadFail, mode*, dest*, field labels, autoResumeNote, start, starting, requiredFields, startFail) — added to `client/src/locales/en.json` and `ko.json`.
- Terminal/cancel copy belongs to the `/migration` page (`migrationPage.*` — see `docs/spec/client/pages/MigrationPage.md`).
- `admin.storageMigration`, `admin.storageMigrationDesc`, `admin.runMigration` — SystemSettingsContent settings row.
- `serverErrors.admin.migration*` and `serverMessages.admin.migrationCancelled` for server codes.

### 2.6 Verification Scenarios

- [ ] Dialog loads `/info` and shows the read-only Source → Destination label
- [ ] WebDAV source renders S3 destination fields; S3 source (override) renders WebDAV destination fields; apply mode shows the auto-resume note
- [ ] Required-field validation blocks Start without a network call
- [ ] Start success closes the dialog and navigates to `/migration` (no polling or Cancel here)
- [ ] Info-load failure shows an inline error and disables Start

### 2.7 Edge Cases

- Start failure keeps the dialog open with the inline Alert (no navigation).

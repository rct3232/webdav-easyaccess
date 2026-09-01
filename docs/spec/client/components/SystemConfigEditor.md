# SystemConfigEditor Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Admin "Advanced settings" config editor: reads the effective config (`GET /api/admin/config`), renders grouped type-aware inputs (TextField / Switch / Select / Number / secret), dirty-tracks edits and writes only changed keys via `PUT /api/admin/config`. |
| Used in            | `SystemSettingsContent` inside the "Advanced settings" MUI Accordion (below the main settings rows).                                                                                                                                                           |
| Related components | `adminService.getConfig` / `adminService.updateConfig`, `SystemSettingsContent` (page-level Snackbar via `onSnackbar`)                                                                                                                                         |
| API contract       | `docs/spec/server/routes/config.md`, feature SoT `docs/features/config-source-resolution.md`                                                                                                                                                                   |

Display metadata (`labelKey`, `group`, `inputType`, `options`, `helpKey`) is defined client-side in `CONFIG_DISPLAY_META`. The server registry (`server/infrastructure/configRegistry.js`) is authoritative for `tier` / `secret` / `source`.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/SystemConfigEditor.js`
- **Test file:** `client/src/components/mypage/content/__tests__/SystemConfigEditor.test.js`

### 2.2 Props

| Name       | Type     | Required | Default | Description                                                                                                   |
| ---------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| active     | boolean  | Y        | -       | When truthy the config is fetched (lazily, once on first activation — wired to the Accordion expanded state). |
| onSnackbar | function | N        | -       | Page-level Snackbar handler; called with `{ type: 'success'\|'error', text }`.                                |

### 2.3 Callback Signatures

| Callback   | When invoked                           | Arguments                            |
| ---------- | -------------------------------------- | ------------------------------------ |
| onSnackbar | Save success / save error / load error | `(msg)` where `msg = { type, text }` |

### 2.4 Dependencies

- **imports:** `useTranslation`, MUI (`Alert, Box, Button, CircularProgress, MenuItem, Switch, TextField, Typography`), `adminService`, `errorUtils` (`getServerErrorDisplay`, `getServerMessageDisplay`)
- **Reference implementation:** `MigrationDialog.js` (page-level feedback via `onMessage`), `SystemSettingsContent.js` (row layout + Snackbar)

### 2.5 Data Contract

`GET /api/admin/config` → `{ config: { "<KEY>": { value, source: 'env'|'db'|'default', tier: 'T0'|'T1'|'T2', secret: boolean } } }`.

- `adminService.getConfig()` normalizes to the `config` map.
- Secrets always arrive masked as `"****"` — never display a decrypted value.
- `adminService.updateConfig(values)` → `PUT /api/admin/config` with `{ values }`; returns `{ applied, restartRequired, messageCode }`.

### 2.6 CONFIG_DISPLAY_META

Client-side display map: `{ KEY: { labelKey, group, inputType, options?, helpKey? } }`.

- `labelKey` → `admin.config.key.<KEY>`; `group` → `metadata|fileStorage|serverSecurity|email|runtime`.
- `inputType` → `text | number | switch | select`.
- `options` (select only) → `[{ value, labelKey }]` (reuses existing i18n keys for s3/webdav, sqlite/postgresql, auto/digest).
- A registry key with no display entry is **skipped**.

Grouping (group → keys):

| Group            | Keys                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fileStorage`    | WEA_FILE_STORAGE, S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_ENDPOINT, WEBDAV_URL, WEBDAV_USERNAME, WEBDAV_PASSWORD, WEBDAV_AUTH_TYPE, WEBDAV_UPSTREAM_URL, MAX_THUMBNAIL_SIZE, THUMBNAIL_CONCURRENCY_LIMIT, THUMBNAIL_TOKEN_SECRET, THUMBNAIL_TOKEN_EXPIRY, FFMPEG_PATH, FFMPEG_INIT_TIMEOUT_MS, WEA_PREVIEW_TICKET_TTL_MS |
| `serverSecurity` | PORT, CORS_ORIGINS, CORS_ORIGIN, LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS, JWT_EXPIRES_IN, ADMIN_DEFAULT_PASSWORD, WEA_DISABLE_DEFAULT_ADMIN, HOSTNAME                                                                                                                                                                                       |
| `email`          | EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD, EMAIL_SECURE, EMAIL_FROM_NAME                                                                                                                                                                                                                                                                    |
| `runtime`        | GC_INTERVAL_MS, GC_ORPHAN_TTL_DAYS, REFRESH_TOKEN_EXPIRES_IN_DAYS, USER_CACHE_TTL_MS, PERMISSION_CACHE_TTL_MS, PERMISSIONS_EXISTENCE_INDEX_TTL_MS, PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE, PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY, WEA_SKIP_MIGRATION_WORKER, WEA_SKIP_BULK_WORKER, WEA_SKIP_GC_SCHEDULER                                   |

**Metadata (T0) group removed (D5):** `WEA_STORAGE_BACKEND`, `WEA_SQLITE_PATH`, `WEA_PG_*`,
`NODE_ENV`, `DOTENV_CONFIG_PATH` are **never rendered** — the DB connection is `.env`-owned and
verified via the health card. (The server GET still returns them; the editor simply has no
display group for them.)

**Intentionally omitted** (no display entry → not rendered):

- `registration_enabled` — stays in the main settings rows (above the accordion), never duplicated.
- `WEA_PG_PASSWORD`, `encrypt_secret_key`, `JWT_SECRET` — T0 `.env`-only secrets; not editable via this route and not displayed (reduces sensitive surface).

### 2.7 Read-Only Rules

A row is read-only (inputs disabled) when `source === 'env'` **or** `tier === 'T0'`:

- `source === 'env'` → note `admin.config.setInEnv` ("Set in .env (env takes precedence)") — a DB edit would be silently shadowed by the env value (D9).
- `tier === 'T0'` → metadata group; `.env`-only by contract (D2/D4/D7); the server rejects T0 writes.

### 2.8 Secret Handling

- Always displayed as the mask `"****"` (server never sends plaintext).
- A "Set new value" toggle (`admin.config.setNewValue`) reveals an empty password field.
- Blank / null / `'****'` on save → the key is **skipped** (keeps existing ciphertext; "only re-encrypt on new value").
- `source === 'env'` secrets are read-only (no toggle).

### 2.9 Connection-Key Save Gating (D1)

**Connection keys:** S3 → `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`; WebDAV → `WEBDAV_URL`, `WEBDAV_USERNAME`,
`WEBDAV_PASSWORD`, `WEBDAV_AUTH_TYPE` (all in the `fileStorage` group).

- When any connection key is dirty, a **"Test connection"** control appears on the group.
  It posts the **pending values** (the active backend's connection keys from the form) to
  `POST /api/admin/config/test`; `target` = the current `WEA_FILE_STORAGE` value.
- **Save is disabled** until that group's test passes (`status === 'ok'`) — complete block.
- **Editing a connection key invalidates the test result** (back to `idle`).
- **Non-connection keys do not require a test**.
- Test state machine mirrors the setup wizard: `{ status: 'idle'|'testing'|'ok'|'error', message, reason }`.

### 2.9 Save Flow

1. Edits accumulate in a local `values` map; a derived dirty set tracks keys whose value differs from the original (secrets: dirty only when the new-value field is non-blank).
2. "Save changes" (`admin.config.save`) enabled only when dirty.
3. `updateConfig(changedValues)` sends **only changed keys** (`{ values: { KEY: value } }`), blank secrets excluded.
4. On success: Snackbar via `onSnackbar` (`admin.config.saved` / `serverMessages.admin.configSaved`), set the "Restart required" Alert banner from `restartRequired` (T1 keys), set the "Applied" Alert banner from `applied` (T2 keys), clear dirty + revealed secrets, re-fetch the config.
5. On failure: error Snackbar via `getServerErrorDisplay`.

### 2.10 Feedback

- **Snackbar** (page-level, via `onSnackbar`): save success/error.
- **Alert banner — restart required** (inside the editor): `admin.config.restartRequired` + `admin.config.restartRequiredDetail` listing the T1 keys in `restartRequired` (`data-testid="config-restart-banner"`).
- **Alert banner — applied** (inside the editor): `admin.config.appliedNow` + `admin.config.appliedNowDetail` listing the T2 keys in `applied` — surfaced so the operator sees exactly what took effect immediately (`data-testid="config-applied-banner"`).
- **Per-field tier badge** (while editing): each non-read-only field renders a badge from `entry.tier` — T1 → `admin.config.tierRestart` ("Restart required"), T2 → `admin.config.tierImmediate` ("Applies immediately"). Feedback is visible _before_ save, not only after.

### 2.11 i18n Keys

- `admin.advancedSettings` (accordion title in SystemSettingsContent)
- `admin.config.save`, `admin.config.saving`, `admin.config.saved`, `admin.config.saveFail`, `admin.config.loadFail`, `admin.config.retry`
- `admin.config.restartRequired`, `admin.config.restartRequiredDetail`
- `admin.config.appliedNow`, `admin.config.appliedNowDetail`
- `admin.config.tierRestart`, `admin.config.tierImmediate`
- `admin.config.setInEnv`, `admin.config.setNewValue`, `admin.config.secretKeepExisting`
- `admin.config.group.metadata`, `admin.config.group.fileStorage`, `admin.config.group.serverSecurity`, `admin.config.group.email`, `admin.config.group.runtime`
- `admin.config.key.<KEY>` for every displayed key
- `admin.config.help.CORS_ORIGINS` (optional help; `setup.expiresInHelp` reused for expiry keys)
- New server codes: `serverErrors.admin.configUnknownKey`, `serverErrors.admin.configT0Protected`, `serverErrors.admin.configInvalidPayload`, `serverErrors.admin.configEncryptKeyMissing`, `serverErrors.admin.configEnvSourcedProtected`, `serverMessages.admin.configSaved`

### 2.12 Verification Scenarios

- [ ] Renders all five groups; empty groups are skipped
- [ ] `source=env` and `tier=T0` rows are disabled with the env note
- [ ] Secrets masked (`'****'`); "Set new value" reveals an empty field
- [ ] Editing marks dirty; Save enabled only when dirty
- [ ] Save sends only changed keys (MSW captures `{ values: { KEY } }`)
- [ ] Blank new-value secret is skipped on save; a typed value is sent
- [ ] `restartRequired` keys render the Alert banner; success goes to `onSnackbar`
- [ ] `applied` keys render the "applied immediately" Alert banner
- [ ] Non-read-only fields show the per-field tier badge (T1 "restart required" / T2 "applies immediately")
- [ ] Fetch happens lazily on first `active` (accordion expand)

### 2.13 Edge Cases

- Config load failure → error Alert + Retry button (no infinite spinner).
- Registry key returned by the server with no display entry → skipped (never rendered).
- Boolean values from `default` source (e.g. `EMAIL_SECURE`) → normalized to `'true'`/`'false'` for Switch.
- Re-collapse/re-expand the accordion → config is not refetched (local state preserved).

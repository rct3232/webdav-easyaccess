# SystemConfigEditor Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Admin "Advanced settings" config editor: reads the effective config (`GET /api/admin/config`) and renders **two top-level sections** — Section A "Runtime settings" (editable) and Section B "Deploy-time / platform configuration" (read-only). Section A renders the four existing subgroups of type-aware editable inputs (TextField / Switch / Select / Number / secret) for T1/T2 keys whose effective source is not `env`; Section B renders a flat read-only summary of T0 keys plus env-sourced T1/T2 keys. Edits are dirty-tracked and only changed Section A keys are written via `PUT /api/admin/config`. |
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
- Secrets always arrive masked as `"****"` — the server never sends a secret value to the client.
- `adminService.updateConfig(values)` → `PUT /api/admin/config` with `{ values }`; returns `{ applied, restartRequired, messageCode }`.
- **State-driven classification (no server change):** the payload is authoritative for section
  membership. The client derives it purely from `tier` / `source`:
  `editable = tier !== 'T0' && source !== 'env'` → Section A; otherwise (`tier === 'T0'` **or**
  `source === 'env'`) → Section B. There is no static key list and no hidden set.

### 2.6 CONFIG_DISPLAY_META

Client-side display map: `{ KEY: { labelKey, group, inputType, options?, helpKey? } }`.

- `labelKey` → `admin.config.key.<KEY>`; required for **every** shown key (Sections A and B).
- `group` → Section A subgroup: `fileStorage|serverSecurity|email|runtime`. Required for editable
  (Section A) keys only; Section B keys have no editable subgroup.
- `inputType` → `text | number | switch | select`. Editable keys only.
- `options` (select only) → `[{ value, labelKey }]` (reuses existing i18n keys for s3/webdav, sqlite/postgresql, auto/digest).
- A registry key with no display entry is **skipped** (never rendered in either section).

**Section membership.** Section A renders only keys whose effective state is editable
(`tier` T1/T2 AND `source !== 'env'`); every other returned key (T0, or T1/T2 with
`source === 'env'`) is shown read-only under Section B. Because classification is state-driven,
a key's `group`/`inputType` are only exercised when the key is currently editable; the same entry
may supply just the `labelKey` (for its Section B row) when the key is env-sourced.

Section A subgroups (group → keys):

| Group            | Keys                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fileStorage`    | WEA_FILE_STORAGE, S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_ENDPOINT, WEBDAV_URL, WEBDAV_USERNAME, WEBDAV_PASSWORD, WEBDAV_AUTH_TYPE, WEBDAV_UPSTREAM_URL, MAX_THUMBNAIL_SIZE, THUMBNAIL_CONCURRENCY_LIMIT, THUMBNAIL_TOKEN_SECRET, THUMBNAIL_TOKEN_EXPIRY, FFMPEG_PATH, FFMPEG_INIT_TIMEOUT_MS, WEA_PREVIEW_TICKET_TTL_MS |
| `serverSecurity` | PORT, CORS_ORIGINS, CORS_ORIGIN, LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS, JWT_EXPIRES_IN, ADMIN_DEFAULT_PASSWORD, WEA_DISABLE_DEFAULT_ADMIN, HOSTNAME                                                                                                                                                                                       |
| `email`          | EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD, EMAIL_SECURE, EMAIL_FROM_NAME                                                                                                                                                                                                                                                                    |
| `runtime`        | GC_INTERVAL_MS, GC_ORPHAN_TTL_DAYS, REFRESH_TOKEN_EXPIRES_IN_DAYS, USER_CACHE_TTL_MS, PERMISSION_CACHE_TTL_MS, PERMISSIONS_EXISTENCE_INDEX_TTL_MS, PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE, PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY, WEA_SKIP_MIGRATION_WORKER, WEA_SKIP_BULK_WORKER, WEA_SKIP_GC_SCHEDULER                                   |

**Section B — "Deploy-time / platform configuration" (read-only):** rendered below Section A as a
flat list in **registry order** (the order keys arrive in `GET /api/admin/config`). A key is
platform-managed — listed in Section B, never editable — when `tier === 'T0'` **or**
`source === 'env'`:

- **All T0 keys the server returns**, including the metadata DB/boot set that previously had no
  editor surface (`WEA_SQLITE_PATH`, the `WEA_DB_*` block — incl. the
  `WEA_DB_PASSWORD` secret — `NODE_ENV`, `DOTENV_CONFIG_PATH`) and the boot auth secret
  `JWT_SECRET`. The former "Metadata (T0) group removed (D5)" behavior is **superseded**: these
  keys are no longer hidden; they are shown read-only here, so the metadata DB / boot secrets are
  visible without being editable.
- **Any T1/T2 key whose effective `source === 'env'`** — a DB edit would be silently shadowed by
  the env value, so the row is moved out of Section A into this summary.

Each Section B row shows the translated label, the value (the `'****'` mask for `secret: true`
entries; the `admin.config.unset` "(unset)"-style text when `value` is undefined), and a caption
with the tier plus a "set in env" note. An intro note (`admin.config.platformIntro`) states that
these values are provided at deploy time (env / `.env`), cannot be edited here, and require a
deployment change + restart.

**Intentionally omitted** (no display entry → not rendered):

- `registration_enabled` — stays in the main settings rows (above the accordion), never duplicated.

### 2.7 Read-Only Rules

Read-only-ness is **section-level, not per-row**. A key is read-only iff it belongs to Section B
(platform-managed: `tier === 'T0'` or `source === 'env'`). The old per-row env/T0 lock styling
inside the editable list is gone — an env-sourced or T0 key is never rendered as a disabled
Section A input; it is moved out to the Section B summary.

- **Section A** rows are editable by construction: only `tier` T1/T2 keys with effective
  `source !== 'env'` (db/default) are rendered as inputs, so no per-field `admin.config.setInEnv`
  helper text is needed.
- **Section B** rows have **no input controls** (a flat summary list). Each row's caption combines
  the tier with a "set in env" note (`admin.config.setInEnv`); T0 rows carry a T0/startup tier
  marker. The `admin.config.platformIntro` note explains that these values are deploy-time and
  require a deployment change + restart.
- Server enforcement is unchanged and matches this split: `PUT` rejects (400) T0 keys
  (`configT0Protected`) and keys whose current effective source is `env`
  (`configEnvSourcedProtected`), so Section A can never be used to write a platform-managed key.

### 2.8 Secret Handling

**Section A (editable secrets):**

- Always displayed as the mask `"****"` (server never sends plaintext).
- A "Set new value" toggle (`admin.config.setNewValue`) reveals an empty password field.
- Blank / null / `'****'` on save → the key is **skipped** (keeps the existing stored value — masked input never overwrites a stored secret).

**Section B (platform-managed secrets):**

- Rendered in the read-only summary, always masked as `"****"` — no toggle, no input. This is why
  `JWT_SECRET` and `WEA_DB_PASSWORD` can be displayed without widening the sensitive surface.
- An undefined Section B value (secret or not) renders as the `admin.config.unset`
  "(unset)"-style text.

`source === 'env'` secrets never appear as editable inputs (they belong to Section B).

### 2.9 Connection-Key Save Gating (D1)

**Connection keys:** S3 → `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`; WebDAV → `WEBDAV_URL`, `WEBDAV_USERNAME`,
`WEBDAV_PASSWORD`, `WEBDAV_AUTH_TYPE` (all in the Section A `fileStorage` subgroup).

- When any connection key is dirty, a **"Test connection"** control appears on the group.
  It posts the **pending values** (the active backend's connection keys from the form) to
  `POST /api/admin/config/test`; `target` = the current `WEA_FILE_STORAGE` value.
- **Save is disabled** until that group's test passes (`status === 'ok'`) — complete block.
- **Editing a connection key invalidates the test result** (back to `idle`).
- **Non-connection keys do not require a test**.
- Test state machine mirrors the setup wizard: `{ status: 'idle'|'testing'|'ok'|'error', message, reason }`.

### 2.9 Save Flow

1. Only Section A (editable) values can ever become dirty; Section B rows are not tracked and are never submitted. Edits accumulate in a local `values` map; a derived dirty set tracks keys whose value differs from the original (secrets: dirty only when the new-value field is non-blank).
2. "Save changes" (`admin.config.save`) enabled only when dirty.
3. `updateConfig(changedValues)` sends **only changed keys** (`{ values: { KEY: value } }`), blank secrets excluded.
4. On success: Snackbar via `onSnackbar` (`admin.config.saved` / `serverMessages.admin.configSaved`), set the "Restart required" Alert banner from `restartRequired` (T1 keys), set the "Applied" Alert banner from `applied` (T2 keys), clear dirty + revealed secrets, re-fetch the config.
5. On failure: error Snackbar via `getServerErrorDisplay`.

### 2.10 Feedback

- **Snackbar** (page-level, via `onSnackbar`): save success/error.
- **Alert banner — restart required** (inside the editor): `admin.config.restartRequired` + `admin.config.restartRequiredDetail` listing the T1 keys in `restartRequired` (`data-testid="config-restart-banner"`).
- **Alert banner — applied** (inside the editor): `admin.config.appliedNow` + `admin.config.appliedNowDetail` listing the T2 keys in `applied` — surfaced so the operator sees exactly what took effect immediately (`data-testid="config-applied-banner"`).
- **Per-field tier badge** (while editing): every Section A field renders a badge from `entry.tier` — T1 → `admin.config.tierRestart` ("Restart required"), T2 → `admin.config.tierImmediate` ("Applies immediately"); Section B rows instead show a tier + "set in env" caption (no badge is tied to an editable input). Feedback is visible _before_ save, not only after.

### 2.11 i18n Keys

- `admin.advancedSettings` (accordion title in SystemSettingsContent)
- `admin.config.save`, `admin.config.saving`, `admin.config.saved`, `admin.config.saveFail`, `admin.config.loadFail`, `admin.config.retry`
- `admin.config.restartRequired`, `admin.config.restartRequiredDetail`
- `admin.config.appliedNow`, `admin.config.appliedNowDetail`
- `admin.config.tierRestart`, `admin.config.tierImmediate`
- `admin.config.setInEnv`, `admin.config.setNewValue`, `admin.config.secretKeepExisting`
- `admin.config.group.fileStorage`, `admin.config.group.serverSecurity`, `admin.config.group.email`, `admin.config.group.runtime` (Section A subgroup titles)
- `admin.config.sectionTitleRuntime` ("Runtime settings"), `admin.config.sectionTitlePlatform` ("Deploy-time / platform configuration") — Section A / Section B headers
- `admin.config.platformIntro` — Section B intro note: values are provided at deploy time (env / `.env`), cannot be edited here, and require a deployment change + restart
- `admin.config.unset` — "(unset)"-style text for undefined Section B values
- `admin.config.key.<KEY>` for every displayed key (Section A and Section B); the Section B set
  needs new labels for the previously-hidden T0 secrets `admin.config.key.WEA_DB_PASSWORD` and
  `admin.config.key.JWT_SECRET` (the other T0 labels — `WEA_SQLITE_PATH`,
  `WEA_DB_HOST`…`WEA_DB_CONNECTION_TIMEOUT_MS`, `NODE_ENV`, `DOTENV_CONFIG_PATH` — already exist)
- `admin.config.help.CORS_ORIGINS` (optional help; `setup.expiresInHelp` reused for expiry keys)
- New server codes: `serverErrors.admin.configUnknownKey`, `serverErrors.admin.configT0Protected`, `serverErrors.admin.configInvalidPayload`, `serverErrors.admin.configEnvSourcedProtected`, `serverMessages.admin.configSaved`

### 2.12 Verification Scenarios

- [ ] Renders two top-level sections: Section A "Runtime settings" and Section B "Deploy-time / platform configuration" (Section A shows its four subgroups; empty subgroups are skipped)
- [ ] Section A shows only editable keys (T1/T2 with `source` db/default); Section B lists all T0 keys plus env-sourced T1/T2 keys, in registry/GET order
- [ ] Section B rows are read-only (no input controls): secret values masked `'****'`, undefined values show the "(unset)"-style text, and each row has a tier + "set in env" caption; the intro note renders once under the section title
- [ ] A key's section membership follows the GET payload: same key flips to Section B when its `source` becomes `env` (no static list)
- [ ] Section A secrets masked (`'****'`); "Set new value" reveals an empty field
- [ ] Editing marks dirty; Save enabled only when dirty
- [ ] Save sends only changed Section A keys (MSW captures `{ values: { KEY } }`)
- [ ] Blank new-value secret is skipped on save; a typed value is sent
- [ ] `restartRequired` keys render the Alert banner; success goes to `onSnackbar`
- [ ] `applied` keys render the "applied immediately" Alert banner
- [ ] Every Section A field shows the per-field tier badge (T1 "restart required" / T2 "applies immediately")
- [ ] Fetch happens lazily on first `active` (accordion expand)

### 2.13 Edge Cases

- Config load failure → error Alert + Retry button (no infinite spinner).
- Registry key returned by the server with no display entry → skipped (never rendered in either section).
- T0 key present with no runtime value → Section B row shows the "(unset)"-style text.
- Boolean values from `default` source (e.g. `EMAIL_SECURE`) → normalized to `'true'`/`'false'` for Switch.
- Re-collapse/re-expand the accordion → config is not refetched (local state preserved).

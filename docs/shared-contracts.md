# Shared Contracts

This document describes data formats and rules shared by the client, server, and tests. When changing these contracts, update client display logic, server responses, and any tests that depend on them.

---

## Error Response Format

The server returns a consistent JSON body for errors. See `server/utils/errorHandler.js` and `formatErrorResponse`.

**Response body (when `errorCode` is set):**

| Field       | Type   | Description                                             |
| ----------- | ------ | ------------------------------------------------------- |
| `errorCode` | string | i18n key for the error (e.g. from `SERVER_ERROR_CODES`) |
| `params`    | object | Optional interpolation params for the translation       |
| `details`   | string | Optional; only in development, may include stack trace  |

If the error has no `errorCode`, the handler uses a default internal-server-error code and may put `reason` in `params` from the error message.

**HTTP status:** Set via `err.status` or `err.statusCode` (e.g. 400, 401, 403, 404, 409, 500).

**Client usage:** Use `t(errorCode, params)` to show the translated message. See `client/src/utils/errorUtils.js` and related i18n keys.

---

## Server Error and Message Codes

Defined in `shared/serverMessageCodes.js`.

- **SERVER_ERROR_CODES**: Nested object of i18n keys for errors (e.g. `auth.invalidCredentials`, `files.accessDenied`). Values are full i18n keys like `serverErrors.auth.invalidCredentials`.
- **SERVER_MESSAGE_CODES**: Nested object of i18n keys for success/info messages (e.g. `auth.loginSuccess`, `admin.settingsSaved`).

**Rules:**

- All values are i18n keys. The client is responsible for translation; the server only sends the key and optional `params`.
- When adding or changing a code, update:
- Server usage (where the code is thrown or returned)
- Client locale files (e.g. `client/src/locales/en.json`, `ko.json`) so the key exists and is translated.

### Error-code domains introduced by the AI platform

The collections/search/undo-feed/AI/dashboard surfaces (`docs/spec/server/routes/{collections,search,actions,dashboard}.md`) add five domain keys to `SERVER_ERROR_CODES`. Concrete keys (`serverErrors.<domain>.<key>`; the `en.json`/`ko.json` mirror is mandatory per the rules above):

| Domain        | Keys                                                                                                                                                                                                                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------- | ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `collections` | `nameRequired`, `invalidName`, `invalidSort`, `invalidInclude`, `invalidPublishMode`, `invalidRole`, `emptyNodeIds`, `previewTargetRequired`, `mergeSameCollection`, `invalidDefinition`, `forbidden`, `notFound`, `granteeNotFound`, `grantNotFound`, `suggestionNotFound`, `alreadyArchived`, `notArchived` | `notArchived` = restore/permanent-delete on an active collection (archived state required). `notFound` doubles as the no-access 404 masquerade; every ownership / shared-write violation collapses into the single 403 `forbidden`. `collections.forbidden` is ALSO the **admin-operator gate code** (operator rule): every collections/file-likes/dashboard endpoint and the admin-grantee grant ban respond 403 with it (no new i18n codes). Name collision is **not** an error (auto-suffix counter, docs/features/collections-platform.md §3.1); membership/batch-cap violations ride on `emptyNodeIds`. `invalidDefinition` = malformed rule payload (unknown kind / predicate type / bad atom). |
| `search`      | `queryRequired`, `queryTooLong`, `clickTargetRequired`, `fail`                                                                                                                                                                                                                                                | `tooManySegments` is a RESERVED (optional) key: the ≤3-segment cap is currently a silent scorer truncation, not an error. `clickTargetRequired` guards the list-entry-click recording point (`POST /api/search/click`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ai`          | `notConfigured`, `budgetExceeded`, `providerProbeFailed`, `nonConformingEndpoint`                                                                                                                                                                                                                             | `notConfigured` is returned (409, never 404) when an AI-surface request needs an unconfigured role. The search `semantic_unavailable_reason` is a readiness token (`not_configured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | preparing | provisioning_failed | probe_failed | non_conforming | disabled`), not an error key (HTTP stays 200 there; see `docs/spec/server/routes/search.md`§2.4.1).`providerProbeFailed`carries the probe`reason`in`params`. |
| `actions`     | `invalidDomain`, `notFound`, `cascadeConfirmRequired`, `fingerprintMismatch`, `expired`, `alreadyUndone`                                                                                                                                                                                                      | `cascadeConfirmRequired` is the non-tip-undo case (`params: { laterChanges }`). `expired` = journal payload NULLed at retention.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `dashboard`   | `emptyNodeIds`, `invalidSuggestionId`, `suggestionNotFound`                                                                                                                                                                                                                                                   | Storage-dashboard accept/dismiss (`routes/dashboard.md`). Membership/batch-cap violations ride on `dashboard.emptyNodeIds`; `invalidSuggestionId` (400) and `suggestionNotFound` (404) govern the dismiss route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Admin reports repair codes (`docs/spec/server/routes/admin.md` §2.2.6 — extend the existing `admin` domain; `en.json`/`ko.json` mirror is mandatory per the rules above): `admin.reportNotFound` (404 — unknown `admin_reports` row), `admin.repairNotAvailable` (400 — row/action without a registered repair dispatch), and the success message `serverMessages.admin.reportRepaired` (200 — dispatch completion).

AI admin launcher codes (`docs/spec/server/routes/admin.md` §2.2.7 — same `admin` domain): `admin.reembedRateLimited` (429, `params: { retry_after_seconds }`), `admin.reembedAlreadyActive` (409 — the previous launch still has pending/running ids), and `admin.reembedModelUnavailable` (409 — no active embed model). The shared error envelope is unchanged; routes that map bare-string service errors MUST re-attach `params` because `mapServiceError` drops them.

**Wire casing:** new admin AI endpoints return snake_case response fields (`node_id`, `last_error`, `retry_after_seconds`, `action_id`) while request bodies stay camelCase. Existing endpoints keep their current shape.

---

## Shared Constants

Defined in `shared/constants.js`. Both client and server may import `@webdav-easyaccess/shared/constants`.

| Constant                    | Purpose                         | Allowed values / notes                                                                                             |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PERMISSIONS`               | Folder/file permission levels   | `read`, `write`, `admin`; `PERMISSIONS.isValid(permission)`                                                        |
| `HTTP_STATUS`               | HTTP status codes for responses | e.g. `OK`, `CREATED`, `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR` |
| `USER_STATUS`               | User approval state             | `pending`, `approved`, `rejected`; `USER_STATUS.isValid(status)`                                                   |
| `PERMISSION_REQUEST_STATUS` | Permission request state        | `pending`, `approved`, `rejected`, `cancelled`; `PERMISSION_REQUEST_STATUS.isValid(status)`                        |
| `IMAGE_EXTENSIONS`          | Recognized image extensions     | Array of strings (e.g. `jpg`, `png`)                                                                               |
| `VIDEO_EXTENSIONS`          | Recognized video extensions     | Array of strings                                                                                                   |
| `AUDIO_EXTENSIONS`          | Recognized audio extensions     | Array of strings                                                                                                   |
| `TEXT_EXTENSIONS`           | Recognized text extensions      | Array of strings                                                                                                   |

AI-platform enums (same file, same `ALL`/`isValid` shape as the existing status enums):

| Constant                 | Purpose                                                          | Allowed values / notes                                                                                                    |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `COLLECTION_ORIGIN`      | Collection provenance                                            | `system`, `user`, `seed`, `search` — silent evolution touches `system` only (invariant 3)                                 |
| `COLLECTION_STATUS`      | Collection lifecycle                                             | `active`, `archived`                                                                                                      |
| `PUBLISH_MODE`           | Per-collection shared-view publish gate                          | `ask` (default), `off`, `auto`                                                                                            |
| `GRANT_ROLE`             | Collection grant role (separate channel from file `PERMISSIONS`) | `viewer`, `editor` (owner is implicit, not a grant row)                                                                   |
| `JOURNAL_DOMAIN`         | `action_journal.domain`                                          | `collection`, `batch`, `settings`, `permissions`, `tags`, `file`, `sharing`                                               |
| `LLM_ROLE`               | LLM adapter role                                                 | `embed`, `chat`, `vision`, `asr`                                                                                          |
| `MERGE_SUGGESTION_STATE` | `collection_merge_suggestions.state`                             | `pending`, `merged`, `dismissed`, `rejected` — mirrors the DDL CHECK; `dismissed → pending` on a re-surfaced pair         |
| `FILE_SUGGESTION_STATE`  | `file_suggestions.state`                                         | `pending`, `accepted`, `dismissed`, `expired` — separate enum from merge suggestions (`accepted`/`expired` are file-only) |
| `USAGE_ACTION`           | `usage_events.action`                                            | `open`, `download`, `preview`, `search_hit`, `like`                                                                       |
| `AI_JOB_KIND`            | `ai_jobs.kind`                                                   | `embed`, `features`, `caption`, `asr`, `backfill` — mirrors the DDL CHECK (parity-tested)                                 |

Use these constants instead of magic strings so client and server stay in sync.

---

## Validation Contract

Defined in `shared/validation.js`. Used by both client and server for form and input validation.

**Return values:**

- **Success:** `null`.
- **Error:** Either:
- A string (i18n key), e.g. `'validation.fileNameRequired'`, `'validation.emailInvalid'`, or
- An object `{ key,...params }`, e.g. `{ key: 'validation.passwordMinLength', minLength }`, `{ key: 'validation.required', fieldName }`.

**Functions:**

| Function           | Purpose                            | Typical return (error)                                |
| ------------------ | ---------------------------------- | ----------------------------------------------------- |
| `validateFileName` | File/folder name                   | String key or `null`                                  |
| `validateEmail`    | Email format                       | String key or `null`                                  |
| `validatePassword` | Password length etc.               | `{ key, minLength }` / `{ key, maxLength }` or `null` |
| `validateUsername` | Username format and reserved names | String key or `null`                                  |
| `validateMatch`    | Two values must match              | `{ key: 'validation.match', fieldName }` or `null`    |
| `validateRequired` | Required field                     | `{ key: 'validation.required', fieldName }` or `null` |

**Reserved name namespace (`.wea-`):** names starting with `.wea-` (case-insensitive) are
RESERVED — `validateFileName` returns `'validation.fileNameReserved'` for them. The server
enforces the same check on create/upload/folder/rename routes (400 `files.fileNameReserved`), so
the trash subsystem's hidden root namespace `/.wea-trash/<nodeId>` can never collide with
a user-created node.

**Client usage:** If the result is a string, use `t(result)`. If it is an object, use `t(result.key, result)` (or `t(result.key, { fieldName: result.fieldName })` etc.). Changing the return shape (e.g. adding a new param) requires updating client display logic and any tests that assert on validation output.

---

## Files Metadata Row

Shared by the server response, the client metadata repository seam, and tests (`docs/spec/server/routes/files.md` §2.2; `api.md`). `POST /api/files/metadata` returns an array of rows:

| Field                | Type           | Notes                                                                           |
| -------------------- | -------------- | ------------------------------------------------------------------------------- |
| `nodeId`             | number         | Camel casing is the files-domain legacy shape — unchanged by this contract      |
| `name`, `type`       | string         | Node name / `file` \| `directory`                                               |
| `size`, `mime`       | number \| null | From `filecache`; null for directories and cache-less rows                      |
| `lastmod`            | string         | ISO timestamp (node `updatedAt`)                                                |
| `hasReadPermission`  | boolean        | Additive; resolved with the directory-listing permission engine                 |
| `hasWritePermission` | boolean        | Additive; same engine (admin bypass ⇒ both true; read-only grant ⇒ write false) |

Rows for nodes the requester cannot READ are omitted (skip behavior unchanged). No new error codes: the endpoint keeps the existing validation failures (`files.sourceDestRequired`, `files.invalidPath`).

---

## Path Rules

- **Normalization:** Paths are normalized with `normalizePath` from `shared/pathUtils.js`: leading slash, no duplicate slashes, backslashes replaced by forward slashes, trailing slash removed unless the path is treated as a directory. Display paths are resolved server-side via the node graph; request payloads accept nodeId-based fields, not raw path strings.

Client and server should use the same normalization so display paths and name comparisons stay consistent.

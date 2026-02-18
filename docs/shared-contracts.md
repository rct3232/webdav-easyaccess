# Shared Contracts

This document describes data formats and rules shared by the client, server, and tests. When changing these contracts, update client display logic, server responses, and any tests that depend on them.

---

## Error Response Format

The server returns a consistent JSON body for errors. See `server/utils/errorHandler.js` and `formatErrorResponse`.

**Response body (when `errorCode` is set):**

| Field       | Type   | Description |
|------------|--------|-------------|
| `errorCode`| string | i18n key for the error (e.g. from `SERVER_ERROR_CODES`) |
| `params`   | object | Optional interpolation params for the translation |
| `details`  | string | Optional; only in development, may include stack trace |

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

---

## Shared Constants

Defined in `shared/constants.js`. Both client and server may import `@webdav-easyaccess/shared/constants`.

| Constant                 | Purpose | Allowed values / notes |
|--------------------------|---------|-------------------------|
| `PERMISSIONS`            | Folder/file permission levels | `read`, `write`, `admin`; `PERMISSIONS.isValid(permission)` |
| `HTTP_STATUS`            | HTTP status codes for responses | e.g. `OK`, `CREATED`, `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR` |
| `USER_STATUS`            | User approval state | `pending`, `approved`, `rejected`; `USER_STATUS.isValid(status)` |
| `PERMISSION_REQUEST_STATUS` | Permission request state | `pending`, `approved`, `rejected`, `cancelled`; `PERMISSION_REQUEST_STATUS.isValid(status)` |
| `IMAGE_EXTENSIONS`       | Recognized image extensions | Array of strings (e.g. `jpg`, `png`) |
| `VIDEO_EXTENSIONS`        | Recognized video extensions | Array of strings |
| `AUDIO_EXTENSIONS`        | Recognized audio extensions | Array of strings |
| `TEXT_EXTENSIONS`         | Recognized text extensions | Array of strings |

Use these constants instead of magic strings so client and server stay in sync.

---

## Validation Contract

Defined in `shared/validation.js`. Used by both client and server for form and input validation.

**Return values:**

- **Success:** `null`.
- **Error:** Either:
  - A string (i18n key), e.g. `'validation.fileNameRequired'`, `'validation.emailInvalid'`, or
  - An object `{ key, ...params }`, e.g. `{ key: 'validation.passwordMinLength', minLength }`, `{ key: 'validation.required', fieldName }`.

**Functions:**

| Function            | Purpose | Typical return (error) |
|---------------------|---------|-------------------------|
| `validateFileName`  | File/folder name | String key or `null` |
| `validateEmail`     | Email format | String key or `null` |
| `validatePassword` | Password length etc. | `{ key, minLength }` / `{ key, maxLength }` or `null` |
| `validateUsername`  | Username format and reserved names | String key or `null` |
| `validateMatch`     | Two values must match | `{ key: 'validation.match', fieldName }` or `null` |
| `validateRequired`   | Required field | `{ key: 'validation.required', fieldName }` or `null` |

**Client usage:** If the result is a string, use `t(result)`. If it is an object, use `t(result.key, result)` (or `t(result.key, { fieldName: result.fieldName })` etc.). Changing the return shape (e.g. adding a new param) requires updating client display logic and any tests that assert on validation output.

---

## Path Rules

- **Normalization:** Paths are normalized with `normalizePath` from `shared/pathUtils.js`: leading slash, no duplicate slashes, backslashes replaced by forward slashes, trailing slash removed unless the path is treated as a directory. The server applies this via `normalizePathParam` middleware to `req.query.path`, `req.body.path`, `req.body.sourcePath`, `req.body.destinationPath`, `req.body.oldPath`, `req.body.folderPath`, and `req.query.folderPath`.
- **Reserved path:** The path `/.wea` is reserved for metadata storage. Non-admin access is blocked by `checkMetaPathAccess` in `server/middleware/metaPathGuard.js`. See [ARCHITECTURE.md](ARCHITECTURE.md) and [features/permissions.md](features/permissions.md).

Client and server should use the same normalization and treat `/.wea` as inaccessible to normal users.

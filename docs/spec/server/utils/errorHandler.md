# errorHandler Spec

## 1. Overview

| Item | Description                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role | Centralized error handling: asyncHandler wrapper, formatErrorResponse, logError, error middleware. Standard error format (errorCode, params, details). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/errorHandler.js`
- **Test file:** `server/utils/__tests__/errorHandler.test.js`

### 2.2 Functions / Exports

| Function            | Signature                              | Description                                                  |
| ------------------- | -------------------------------------- | ------------------------------------------------------------ |
| asyncHandler        | (fn) => (req, res, next)               | Wraps async handlers, catches and forwards errors            |
| errorHandler        | (err, req, res, next) => void          | Express error middleware (add last)                          |
| formatErrorResponse | (error, options?) => object            | Standard error body                                          |
| logError            | (error, context?) => void              | Log error with context                                       |
| createError         | (errorCode, status?, params?) => Error | Create error with errorCode                                  |
| mapDatabaseError    | (error, options?) => Error             | Maps PostgreSQL/DB errors to standardized status + errorCode |
| validationError     | (errorCode, params?) => Error          | Validation error (400)                                       |
| unauthorizedError   | (errorCode?, params?) => Error         | Unauthorized (401)                                           |
| forbiddenError      | (errorCode?, params?) => Error         | Forbidden (403)                                              |
| notFoundError       | (errorCode?, params?) => Error         | Not found (404)                                              |
| conflictError       | (errorCode?, params?) => Error         | Conflict (409)                                               |

### 2.3 Input / Output

- formatErrorResponse: returns { errorCode, params?, details? }
- details only in development (NODE_ENV !== 'production')
- error.status or error.statusCode for HTTP status
- mapDatabaseError:
  - input: DB error object (`code`, `constraint`, `detail`, `message`)
  - output: existing Error with normalized `status`, `errorCode`, optional `params`
  - SQLSTATE/error-code mapping baseline:
    - `23505` -> 409 `errorHandler.databaseConflict`
    - `23503`, `23514`, `22P02` -> 400 `errorHandler.databaseConstraintViolation`
    - `57P01`, `53300` -> 503 `errorHandler.databaseUnavailable`
    - reachability/system codes (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, `ECONNRESET`) and client `query_timeout` expiry ("Query read timeout") -> 503 `errorHandler.databaseUnavailable`
    - auth codes (`28P01`, `28000`) -> 503 `errorHandler.databaseUnavailable`
    - fallback -> 500 `errorHandler.databaseQueryFailed`
  - Passive health reporting: only `databaseUnavailable`-mapped errors report `postgresql` to the backend-health tracker, classified `unreachable` (reachability/timeout/shutdown) vs `auth` (`28P01`/`28000`).

### 2.4 Dependencies

- HTTP_STATUS, SERVER_ERROR_CODES

### 2.5 Mock Targets

- console.error, console.log
- process.env.NODE_ENV

### 2.6 Verification Scenarios

- [ ] asyncHandler catches and forwards
- [ ] formatErrorResponse: errorCode, params, details (dev only)
- [ ] mapDatabaseError maps SQLSTATE codes to expected status/errorCode
- [ ] mapDatabaseError preserves existing app errors with predefined `status` + `errorCode`
- [ ] createError, validationError, unauthorizedError, forbiddenError, notFoundError, conflictError

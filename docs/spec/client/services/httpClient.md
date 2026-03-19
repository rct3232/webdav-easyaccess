# httpClient Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Transport adapter that performs HTTP requests to the client `/api/*` namespace, parses responses into a stable shape, applies timeouts, and retries only on network failures and 5xx responses. |
| Used by | `apiClient` (transport layer only). |
| Does not own | Auth token storage/injection, refresh behavior, auth navigation/redirect rules, `x-new-token` application to session storage. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/httpClient.js`
- **Test file:** `client/src/services/__tests__/httpClient.test.js`

### 2.2 Main Functions

| Function | Input | Return |
|----------|-------|--------|
| `request` | `(config)` | `Promise<{ data: any, status: number, statusText: string, headers: Record<string,string> }>` |

`request(config)` supports (at least):
- `url` (string): path or absolute URL
- `method` (string, default `'GET'`)
- `data` (any): JSON-serializable value, string, or `FormData`
- `params` (object): query params appended to the URL
- `headers` (Headers | object): additional request headers
- `timeout` (number, ms): default `300000`
- `signal` (AbortSignal): optional external abort signal
- `responseType` (`'json'` default or `'blob'`)
- `onDownloadProgress` (function): optional progress callback for `'blob'` streaming
- `maxRetries` (number, default `3`)

### 2.3 Error Handling

The transport throws structured errors:
- For HTTP responses with status `>= 400`, throw an `Error` where:
  - `error.response` is the parsed payload shape `{ data, status, statusText, headers }`
  - `error.config` is the original request config
- For network/timeout failures, throw an `Error` where:
  - `error.code = 'ERR_NETWORK'` for network failures
  - `error.code = 'ECONNABORTED'` for timeout aborts
  - `error.config` is set to the original request config

### 2.4 Retry Rules

- Retry only on:
  - network failures, or
  - response status `>= 500`
- Do **not** retry timeout aborts (`error.code = 'ECONNABORTED'`).
- Never retry on `4xx` responses.
- Retry uses exponential backoff: `delay = baseDelay * 2^attempt`, with `baseDelay = 1000`.
- Max attempts are controlled by `maxRetries` (default `3`).

### 2.5 Side Effects

- Reads `window.location.origin` when an absolute URL is not provided.
- Does not read/write session/local storage.
- Does not dispatch `token-refreshed`.

### 2.6 Verification Scenarios

- [ ] JSON responses are parsed into `result.data`.
- [ ] Non-JSON responses return `result.data` as text (or raw content per existing behavior).
- [ ] `timeout` aborts requests and throws with `error.code = 'ECONNABORTED'`.
- [ ] `timeout` aborts are not retried.
- [ ] Network failures throw with `error.code = 'ERR_NETWORK'`.
- [ ] 5xx responses retry with exponential backoff; after exhaustion, the last error is thrown with `error.response` preserved.
- [ ] 4xx responses do not retry; `error.response` is available.

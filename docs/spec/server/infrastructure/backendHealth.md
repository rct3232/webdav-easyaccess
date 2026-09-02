# backendHealth Spec

## 1. Overview

| Item            | Description                                                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role            | In-memory per-backend health tracker for `postgresql`, `s3`, `webdav`. Passive, event-based (D2): callers report success/failure; the tracker records state, fires a transition callback only on `OK→FAIL` / `FAIL→OK`, and serves a snapshot for the admin card/banner and public status. State resets on restart (D4). |
| Source of truth | `docs/features/backend-health.md`, `PLAN.md` Phase B (B1, D2–D4)                                                                                                                                                                                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/backendHealth.js` (new)
- **Test file:** `server/infrastructure/__tests__/backendHealth.test.js`

### 2.2 State shape (per backend)

```js
{
  status: 'ok' | 'fail' | 'unknown',   // 'unknown' until the first report
  code: 'unreachable' | 'auth' | 'missing_resource' | 'unknown' | undefined,
  reason: string | undefined,          // short diagnostic (≤200 chars), never user-facing
  hint: string | undefined,            // human hint (i18n key or short text) for admin surfaces
  lastCheckedAt: number | undefined,   // epoch ms of the last report
  firstFailedAt: number | undefined,   // epoch ms when the current FAIL streak started
  consecutiveFailures: number,         // 0 when OK
}
```

### 2.3 Public API

| Export                | Signature                                             | Description                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBackendHealth` | `() => { report, getHealth, reset, setOnTransition }` | Factory (tests get an isolated instance; production uses the shared singleton).                                                                                                   |
| `getHealth`           | `() => { postgresql, s3, webdav }`                    | Snapshot for `GET /api/admin/health` (full) and `GET /api/health` (status strings only).                                                                                          |
| `report`              | `(backend, { ok, code?, reason?, hint? }) => void`    | Update state; fire the transition callback only when the status flips `ok`↔`fail`. `ok:true` clears `code/reason/hint`, resets `consecutiveFailures` to 0, keeps `lastCheckedAt`. |
| `reset`               | `() => void`                                          | Reset all backends to `unknown` (boot + test hook).                                                                                                                               |
| `setOnTransition`     | `(cb) => void`                                        | Register a callback for `OK→FAIL` / `FAIL→OK` transitions (terminal logging).                                                                                                     |

### 2.4 Classification

Stable `code` values and the probe/i18n codes that map to them (shared with
`server/infrastructure/backendProbe.js` `classifyToHealthCode`):

| `code`             | Sources                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unreachable`      | PG `ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ETIMEDOUT/ECONNRESET`; S3 unreachable; webdav `connectionRefused`/`serverNotResponding`/`cannotConnect`/`allConnectionAttemptsFailed`; PG `57P01/53300` |
| `auth`             | PG `28P01/28000`; S3 `403/AccessDenied`; webdav `credentialsNotConfigured`/403                                                                                                               |
| `missing_resource` | PG `3D000`; S3 `NoSuchBucket`/404; webdav `pathNotFound`/`sourceNotFound`/`fileOrFolderNotFound`                                                                                             |
| `unknown`          | anything else                                                                                                                                                                                |

### 2.5 Terminal logging (D3)

The boot path installs a transition callback that logs only transitions:

```
[backend-health] postgresql: OK → FAIL (unreachable) — <reason>
[backend-health] s3: FAIL → OK
```

Never logs steady-state reports.

---

## 3. Verification Scenarios

- [ ] `report` with no prior state → `status` reflects the first report
- [ ] `ok:true` after `fail` flips to `ok`, clears `code/reason`, resets `consecutiveFailures`
- [ ] `ok:false` increments `consecutiveFailures`; first `fail` sets `firstFailedAt`
- [ ] transition callback fires only on `ok`↔`fail` flips (not on repeated same-state reports)
- [ ] `reset()` returns all backends to `unknown`
- [ ] `getHealth()` returns the three backends with no cross-contamination

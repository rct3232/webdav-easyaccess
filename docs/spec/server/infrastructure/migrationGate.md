# migrationGate Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Process-local in-memory migration gate: while a migration runs, every HTTP route except a small allow-list returns `503 migrationInProgress`, locking the app. Authenticated admins land on the `/migration` page; regular/anonymous users land on the generic `/maintenance` page. Exposes a minimal public gate state (`{ active }`) so the client app-guard can redirect before login. |
| Depends on | `crypto` (randomUUID for `jobId`), the migration job store (`server/domains/admin/stores/migrationJobStore.js`) for blob jobs                                                                                                                                                                                                                                                             |
| Files      | `server/infrastructure/migrationGate.js` (new)                                                                                                                                                                                                                                                                                                                                            |
| Test files | `server/infrastructure/__tests__/migrationGate.test.js` (new)                                                                                                                                                                                                                                                                                                                             |

Source of truth: `docs/features/migration-mode.md`, `PLAN.md` (`feature/migration-mode`, D2–D4, D9).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/migrationGate.js` (new)
- **Test file:** `server/infrastructure/__tests__/migrationGate.test.js`

### 2.2 Gate state shape

```js
{
  active: boolean,          // true while a migration is running
  type: 'metadata' | 'blobs' | undefined,
  jobId: string | undefined,
  startedAt: string | undefined,   // ISO timestamp of gate set
}
```

- `active: false` (boot default): the app is fully unlocked.
- One gate at a time: attempting to start a second migration while active is rejected (the
  migration router returns `409` when a blob job is already running; the metadata endpoint
  returns the same while the gate is active).

### 2.3 Public API

| Export                | Signature                    | Description                                                                                                                   |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `createMigrationGate` | `() => instance`             | Factory (tests get an isolated instance; production uses the shared singleton).                                               |
| `set`                 | `({ type, jobId }) => state` | Set the gate to `{ active: true, type, jobId, startedAt: now }`. Rejects (throws) if already active.                          |
| `clear`               | `() => state`                | Clear the gate to the inactive boot state. Called when a job reaches a terminal state (`completed` / `failed` / `cancelled`). |
| `reset`               | `() => state`                | Reset to inactive (boot + test hook).                                                                                         |
| `getStatus`           | `() => state`                | Snapshot for `GET /api/migration/status` and the gating middleware.                                                           |
| `isActive`            | `() => boolean`              | Convenience predicate for route handlers (e.g. `POST /api/admin/migration/metadata` conflict check).                          |

### 2.4 Transitions

| Transition                   | Trigger                                                                                                                     | Result                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `inactive → active`          | Migration start — blob `apply` (`POST /api/admin/migration/blobs`) or metadata start (`POST /api/admin/migration/metadata`) | `{ active: true, type, jobId, startedAt }` |
| `active → inactive`          | Job reaches a terminal state (`completed` / `failed` / `cancelled`); the worker clears the gate when it finishes            | `{ active: false }`                        |
| `active → inactive` (forced) | `reset()` at boot                                                                                                           | `{ active: false }`                        |

- **Boot reset:** `getBackendHealth().reset()`-style — the gate is reset to inactive at boot
  (`server/index.js` `runBoot`). A restart during a migration leaves the gate inactive; blob jobs
  are process-local and lost (resume by re-running), metadata jobs are transactional (rollback).
- **Terminal clear:** the migration worker (`runMigrationWorker` / the metadata worker) clears the
  gate in the same terminal-update path that writes `status: 'completed' | 'failed' |
'cancelled'`. The client observes the terminal state via polling and stops waiting.

### 2.5 Gating middleware

Mounted in `server/index.js` at the app level so it covers **every** HTTP route, including the
file-domain routes that proxy to the WebDAV/S3 blob backends during normal operation:

```js
app.use(gatingMiddleware); // after requestLogger/body parsing, before domain routers
```

Behavior:

| Gate state | Request          | Response                                                                                            |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| inactive   | any              | `next()` — normal processing                                                                        |
| active     | allow-listed     | `next()` — route proceeds                                                                           |
| active     | not allow-listed | `503` `{ errorCode: 'migrationInProgress', messageCode, message }` (no `type`/`jobId`/`retryAfter`) |

### 2.6 Allow-list

While the gate is active, only the following routes proceed:

| Method + path               | Reason                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`           | Liveness probes stay open.                                                                                                                                                                                                            |
| `POST /api/auth/login`      | Authentication stays open so the operator can reach `/migration` after a session expiry. _PLAN D3 lists this as the admin login; the real route is `POST /api/auth/login` (`server/domains/auth/routes.js`, mounted at `/api/auth`)._ |
| `/api/admin/migration/*`    | The admin migration API (start/cancel/poll, target-scan) must remain reachable while a migration runs so the operator can observe and cancel it.                                                                                      |
| `GET /api/migration/status` | The migration-gate status endpoint: unauthenticated callers get `{ active }` only (polled by the app-guard); an authenticated admin gets the full gate state (polled by the `/migration` page).                                       |

Implementation note: `OPTIONS`/CORS preflight is handled by the `cors` middleware which runs
before the gate; the gate must not block preflight. The allow-list is matched on `(method, path)`
prefix rules exactly as above.

### 2.7 `503 migrationInProgress` semantics

- Status: `HTTP_STATUS.SERVICE_UNAVAILABLE` (503).
- Body: `{ errorCode: 'migrationInProgress', messageCode, message }` — **no operational
  metadata**; the former
  `params: { type, jobId }` is removed so a blocked client (including external WebDAV clients and
  anonymous visitors) cannot learn which migration is running or its job id. `errorCode`/`messageCode` added to
  `shared/serverMessageCodes.js` (or the existing `SERVER_ERROR_CODES` group used by the admin
  migration routes). `retryAfter` is not sent.
- **WebDAV protocol coverage:** because the middleware is app-level, the WebDAV file-domain
  routes (`/api/files/*`, `/api/folders/*`, `/api/thumbnails/*`, ...) return `503` while the gate
  is active — the running app cannot read/write the WebDAV backend during a migration. Any future
  raw-WebDAV protocol mount must also be placed behind the gate so external clients are blocked.
- The client treats `503 migrationInProgress` like the app-guard's force-redirect: any screen
  receiving it is routed by the app-guard (admin → `/migration`, others → `/maintenance`).

### 2.8 `GET /api/migration/status`

Mounted at the app level (so it is reachable before login) and allow-listed by the gate. The
handler is **auth-optional**: it inspects the request for a valid admin token and responds
accordingly.

**Unauthenticated (and non-admin) response** — the only fields an anonymous or regular user may
see:

```json
{ "active": true }
```

**Authenticated-admin response** — full gate state, used by the `/migration` page to restore a
running job after a refresh:

```json
{ "active": true, "type": "blobs", "jobId": "<uuid>", "startedAt": "2026-09-01T00:00:00.000Z" }
```

- When `active: false`, `type` / `jobId` / `startedAt` are omitted in the admin view.
- When active and the backing job is `blobs`, `jobId` matches the `migrationJobStore` job so the
  `/migration` page can restore the job after a refresh by polling
  `GET /api/admin/migration/jobs/:jobId`.
- The app-guard needs only `{ active }` and polls unauthenticated (it must redirect anonymous
  and regular sessions to `/maintenance` and admins to `/migration`; the admin-vs-maintenance
  decision comes from the session user's `is_admin` flag, not from this endpoint's payload).

---

## 3. Verification Scenarios

- [ ] Boot: gate starts inactive (`active: false`); `reset()` clears an active gate
- [ ] `set({ type, jobId })` transitions to active with `startedAt`; a second `set` while active throws
- [ ] `clear()` returns the gate to inactive after a terminal status
- [ ] Gating middleware: gate inactive → all routes proceed; gate active → allow-listed routes proceed, all others return `503 { errorCode: 'migrationInProgress' }` with no `type`/`jobId`
- [ ] Allow-list: `GET /api/health`, `POST /api/auth/login`, `/api/admin/migration/*`, `GET /api/migration/status` pass while active
- [ ] WebDAV file-domain route (e.g. `GET /api/files/...`) returns `503` while the gate is active
- [ ] `GET /api/migration/status`: unauthenticated → `{ active }`; authenticated admin → full gate state (`{ active, type, jobId, startedAt }`)
- [ ] `OPTIONS` preflight passes while the gate is active
- [ ] Worker clears the gate when a job reaches `completed` / `failed` / `cancelled`

# Unified Migration Mode

This document is the **Source-of-Truth** for the unified migration-mode feature. It describes
the migration-mode concept, the server-side gating semantics, the `/migration` page UX, the
metadata DB migration flow (F1), the blob migration cutover flow (F2), the auto-persist of the
destination config, the ".env setup needed" banner, the S3 boot probe, and the manual env
cutover contract.

Working decisions D1–D14 are recorded in this document ([Decisions summary
(D1–D14)](#decisions-summary-d1d14)); the feature's progress log lives in the repository's
commit history (`git log`).

Detailed implementation contracts live in:

- `docs/spec/server/infrastructure/migrationGate.md` — gate state, transitions, gating middleware + allow-list, `503 migrationInProgress`.
- `docs/spec/server/services/metadataMigrationService.md` — target scan, schema apply, transactional wipe+copy, rollback.
- `docs/spec/server/tools/metadata-migration.md` — the admin-API metadata migration path (`target-scan`, `POST /metadata`).
- `docs/spec/server/tools/blob-migration.md` (updated) — blob migration spec incl. `configPersist` (D10), cancel semantics, `/migration`-page execution, and the type-specific job payload (blob jobs keep scalar `progress` + top-level `current`/`results`; see §4.4).
- `docs/SETUP.md` — operator env reference and the updated cutover runbook.
- `docs/ARCHITECTURE.md` — the (now supported) metadata migration path.

---

## Overview

The app supports two storage migrations:

- **F1 — metadata DB migration:** copy all metadata between the `sqlite` and `postgresql`
  backends. Previously unsupported (the old `migrateMetadataToPostgresql.js` CLI was removed and
  `server/scripts/migrate/` is empty; docs only supported fresh-DB boot).
- **F2 — blob migration cutover:** move physical blobs between the `s3` and `webdav` blob
  backends (already available via `migrationService` + the `MigrationDialog`).

Both are unified under a single **migration mode**: while a migration runs, the whole app is
locked. A dedicated `/migration` page shows progress and forces the operator to stay until the
migration reaches a terminal state (`completed` / `failed` / `cancelled`). Migrations are
cancellable mid-way.

Key properties:

- **Configuration stays in dialogs (D1).** The blob `MigrationDialog` (System Settings) is kept;
  a new metadata-migration dialog is added. The `/migration` page is **execution/progress only**,
  never configuration.
- **Start flow (D2):** clicking apply/start in a dialog begins the migration, sets the migration
  gate, and **auto-redirects the operator to `/migration`**. While running, the operator is
  forced to stay on `/migration`.
- **Server-side gating (D3):** a migration-gate middleware returns `503 migrationInProgress` for
  all routes — including the WebDAV protocol — except an allow-list. The client app-guard polls
  `GET /api/migration/status`; while the gate is active it is **role-aware**: an authenticated
  admin goes to `/migration` (operator progress), everyone else (regular users and anonymous
  visitors) goes to the generic public `/maintenance` page (double safety — see [Role-aware
  lock UX](#role-aware-lock-ux-maintenance-vs-migration)).
- **Cancellation (D4):** DB migration = one target transaction → cancel = **ROLLBACK**, both
  sides unharmed. Blob migration = cancel flag set immediately, the current node finishes then
  stops; partial progress is kept (source preserved) and resumed on rerun (`shouldSkip`).
- **Final cutover is manual (D11):** the T0 keys (`WEA_STORAGE_BACKEND`, `WEA_PG_*`) are
  env-owned by design; the final step stays a manual `.env` edit + restart. The UI guides it
  (".env setup needed") and the server shows a persistent banner while data lives in the
  non-active backend.

---

## Migration mode concept

Migration mode is a server-side, process-local state machine backed by
`server/infrastructure/migrationGate.js` (new). While active, the running application is treated
as locked for migration: the operator may only observe progress on `/migration` and may cancel
the job; all other application routes are blocked.

- The gate is **set** when a migration starts (dialog apply for blobs, or `POST
/api/admin/migration/metadata` for metadata), **cleared** when the job reaches a terminal
  state, and **reset at boot** (a restart during a migration leaves the gate inactive; the
  in-memory blob `migrationJobStore` also resets, so an interrupted run is resumed by re-running
  the copy).
- Gate state is exposed to the client via `GET /api/migration/status` so the app-guard can
  force-redirect and the `/migration` page can restore a running job after a refresh. The public
  (unauthenticated) response is intentionally minimal — `{ active: boolean }` only; an
  authenticated admin receives the full gate state (see the API surface summary below).
- Because blob jobs are process-local (in-memory `migrationJobStore`, ~60-minute TTL for terminal
  jobs), a migration does **not** survive a server restart. Metadata DB migrations are
  transactional and atomic, so a restart mid-copy leaves both sides intact (the target
  transaction rolls back); blob migrations are resumable by re-running.

---

## Server-side gating (D3)

A gating middleware installed in `server/index.js` (see
`docs/spec/server/infrastructure/migrationGate.md`) enforces the lock for every HTTP route:

- **Gate active →** every route returns `503` with error body `{ errorCode:
'migrationInProgress', ... }` **except** the allow-list:
  - `GET /api/health` — liveness stays open.
  - `POST /api/auth/login` — authentication stays open so the operator can reach `/migration`
    after a session expiry. _(Decision D3 lists this as the admin login; the real route is
    `POST /api/auth/login`, mounted from `server/domains/auth/routes.js`.)_
  - `/api/admin/migration/*` — the admin migration API (start/cancel/poll, target-scan) stays
    open so a running migration can be observed and cancelled.
  - `GET /api/migration/status` — the migration-gate status endpoint: unauthenticated callers
    receive only `{ active: boolean }`; an authenticated admin receives the full gate state
    (`{ active, type, jobId, startedAt }`).
- **WebDAV protocol coverage:** the gate is mounted at the app level, so it covers the
  file-domain routes (`/api/files/*`, `/api/folders/*`, `/api/thumbnails/*`, ...) that read/write
  the WebDAV blob backend during normal operation. Any future raw-WebDAV protocol mount must also
  be placed behind the gate so external clients are blocked while a migration runs.
- **Double safety:** independent of the server gate, the client app-guard polls
  `GET /api/migration/status`; while `active` it redirects each session to the right screen —
  admin → `/migration`, everyone else → `/maintenance`.

The gate is deliberately conservative: a false "in progress" during the brief window between the
`POST` response and worker scheduling is acceptable; the app-guard polls the same endpoint so the
UI converges.

The 503 body carries no operational metadata: `{ errorCode: 'migrationInProgress', messageCode,
message }` (the former `params: { type, jobId }` was removed — see
`docs/spec/server/infrastructure/migrationGate.md`).

---

## Role-aware lock UX: `/maintenance` vs `/migration`

While the migration gate is active the app is locked for everyone, but different sessions land
on different screens:

| Session                        | Screen         | Content                                                                                                                                             |
| ------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated **admin**        | `/migration`   | Operator progress page (type badge, direction, `%`, current label, counters, cancel).                                                               |
| Authenticated **regular user** | `/maintenance` | Generic "system maintenance in progress" message. **No operational metadata.** A plain "Log out" link (there is nothing else to do on this screen). |
| **Anonymous** visitor          | `/maintenance` | Generic message. **No action** — nothing to sign out of.                                                                                            |

- `/maintenance` is a new public page registered next to `/login`/`/setup` in `App.js`. It is
  read-only and shows no `type`/`jobId`/timing — it exists so regular users never see the
  operator `/migration` page or its data. It deliberately offers **no sign-in action**; the
  `/login` route itself stays reachable (the gate allow-list keeps it open) for anyone who
  types it.
- The app-guard decides the target from the session user's `is_admin` flag; it requires only the
  public `{ active }` status to trigger. Admins whose session expired during the migration land
  on `/maintenance` (no action is offered) until they open `/login` and re-authenticate, after
  which the guard routes them to `/migration`.
- `/migration` is therefore **admin-only in practice**: its page shell is harmless, but every
  data call behind it (`GET /api/migration/status` full view and `/api/admin/migration/*`)
  requires a valid admin token.

---

## `/migration` page UX (D7, D8, D9)

The page is progress-only and is registered at the top level of `App.js` (same level as
`/login`/`/setup`). The app-guard routes **authenticated admins** here while the gate is active;
regular users and anonymous visitors land on `/maintenance` instead (see [Role-aware lock
UX](#role-aware-lock-ux-maintenance-vs-migration)). The page reads the full gate status and job
progress only through admin-authenticated requests.

**Layout (D7):**

- Header: title + migration type badge (`metadata` / `blobs`) + elapsed time. **No back button.**
- Direction/status card: `sqlite → postgresql` (metadata) or `webdav → s3` / `s3 → webdav`
  (blobs), status badge (`Running` / `Completed` / `Failed` / `Cancelled`), started/elapsed.
- Progress card: overall determinate `%` bar, current-operation label, and counters
  (blobs: copied / failed / skipped). **No per-step/table list** (dropped by request).
- State alerts: `failed` → error + reason; `cancelled` → warning + partial summary.
- Empty state when no active job: "No active migration" + back.

**Blob progress (D8):** node-count based. `total` = the enumerated snapshot size — for an **S3
source**, active `file_nodes`; for a **webdav source**, all non-orphaned file nodes (native webdav
files are included even without an `object_map` row — see `docs/spec/server/tools/blob-migration.md`
§6). `progress` incremented per processed node; `% = progress / total`. The current file label
(`current`) is shown so stalls on large files are understandable. Byte-weighted progress is
optional/out of scope.

**Metadata progress:** per-source-table `COUNT(*)` pre-aggregation, `Σ done / Σ total`;
`currentLabel` = current table + rows (e.g. "Copying users … 3,420/5,100").

**Terminal UX (D9):** when polling detects a terminal state, an **auto modal popup** appears:

- `completed` → summary + next-step guidance (metadata: env cutover; blobs: persist result +
  restart guidance).
- `failed` → error + reason.
- `cancelled` → warning + partial summary.

Each popup has a **"Go to settings"** button that immediately navigates back to System Settings.

**Polling:** reuse the 400ms job-poll pattern; stop on terminal; the client computes elapsed time
locally.

---

## DB metadata migration flow (F1, D5, D6)

Metadata migration is an **admin-API + dialog** feature (D14) — there is no standalone CLI. The
target is always the **non-active** metadata backend: when `WEA_STORAGE_BACKEND=sqlite` the
target is `postgresql`, and vice versa.

**Flow (D5/D6):**

1. **Configure in the dialog** (System Settings → metadata migration): target connection fields
   (PG: host/port/database/user/password; sqlite: path). D1 — the dialog is the config surface.
2. **Target scan:** the server connects to the explicit target (direct `pg.Client` /
   `better-sqlite3` connection, following the `probePostgresql` pattern in
   `server/infrastructure/backendProbe.js`) and reports `schemaExists` + per-table row counts
   (`GET /api/admin/migration/target-scan`, see `docs/spec/server/tools/metadata-migration.md`).
3. **Wipe alert:** if the target already holds data, the config dialog shows a wipe alert listing
   the affected tables/rows; the operator must explicitly confirm (`wipeTarget=true`) before
   proceed.
4. **Transactional copy:** if the target has no schema, the service **auto-applies the DDL** to
   the explicit target backend (D6; refactors `schemaManager`/`initSqliteSchema` to apply
   `server/store/postgresql/ddl/*.sql` — via `convertPostgresToSqlite` for sqlite targets — to an
   explicit connection). Wipe + copy run in a **single target transaction**; `cancel` = rollback
   of both.
5. **Cancel = rollback (D4):** because the whole operation (schema + wipe + copy) runs in one
   target transaction, cancelling rolls back every write — both sides are unharmed.
6. **Final cutover stays manual (D11):** the T0 keys (`WEA_STORAGE_BACKEND`, `WEA_PG_*` /
   `WEA_SQLITE_PATH`) are `.env`-owned, so the last step is a manual `.env` edit + restart. The
   UI guides it and the server shows a **persistent ".env setup needed" banner** while the
   non-active backend still holds metadata (D13).

Full API contract: `docs/spec/server/tools/metadata-migration.md`; service internals:
`docs/spec/server/services/metadataMigrationService.md`.

---

## Blob migration flow (F2, D10)

The existing blob migration core (`migrationService`, admin API `POST
/api/admin/migration/blobs`, `MigrationDialog`) is kept and re-wired into migration mode:

1. **Configure in the dialog:** destination credentials are entered in the blob
   `MigrationDialog` (System Settings) exactly as today (D1). `GET /api/admin/migration/info`
   reports the derived `{ source, direction }`.
2. **Start → redirect:** clicking **start** (both `dry-run` and `apply`) begins the migration, sets
   the gate, and **auto-redirects to `/migration`** (D2). A `dry-run` also enters migration mode —
   it performs real enumeration work, so its progress is shown on `/migration` just like an
   `apply` run (nothing is written).
3. **Progress:** node-count based on `/migration` (D8): `total` = the enumerated snapshot size (S3 source: active file nodes; webdav source: all non-orphaned file nodes), `% = progress/total`, current file label, counters.
4. **Cancel + resume (D4):** cancel sets the flag immediately; the current node finishes then the
   copy stops. Partial progress is kept (source preserved) and rerun resumes via the existing
   `shouldSkip` resume markers. The `runCopy` loop gains a cancel check.
5. **Auto-persist of the destination config (D10):** when an `apply` completes, **DB-sourced**
   storage keys are persisted to the DB via `Settings.set` (secret values written as
   **plaintext strings**, then `getSharedResolver().invalidateCache`), and the job records
   `configPersist { persisted, skippedEnvSourced }`. **Env-sourced** keys fall back to the
   existing manual `.env` guidance. Either way a restart is
   required — storage config is boot-frozen (`process.env.WEA_FILE_STORAGE` is snapshotted at
   composition/blobstore creation).
6. **Restart → boot probe (D12):** after restart, the active backend is verified at boot — the
   existing warn-only WebDAV probe plus a new symmetric **S3 boot probe** — and reflected on the
   backend-health card.

Full spec: `docs/spec/server/tools/blob-migration.md` (updated for `configPersist`, cancel
semantics, `/migration`-page execution, type-specific job payload).

---

## ".env setup needed" banner (D13)

A new `metadataPresence` detection runs on the server: when the **non-active** metadata backend
holds metadata (`settings` / `users` rows), an admin endpoint exposes that fact and System
Settings renders a persistent banner with a link to the migration flow.

- The banner persists while data lives in the non-active backend — i.e. from the moment a
  metadata migration completes until the operator cuts over `.env` and restarts (and, after
  restart, while the old backend still holds the data).
- It is the visible counterpart of D11 (manual env cutover) and D13 (detection).

---

## S3 boot probe (D12)

Today only the WebDAV backend has a warn-only boot probe (`server/index.js:214-228`); S3 has
none. This feature adds a **symmetric S3 boot probe**: at boot, when `WEA_FILE_STORAGE=s3`, probe
the active S3 config and report the result to the backend-health tracker
(`getBackendHealth().report('s3', ...)`) as warn-only (never a boot failure). After a post-restart
cutover to either backend, the boot probe verifies the new backend and the health card reflects
it.

---

## Decisions summary (D1–D14)

| #   | Area                 | Decision                                                                                                                                                                                                                                                                               |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Config location      | Migration configuration stays in dialogs (System Settings); `/migration` is execution/progress only.                                                                                                                                                                                   |
| D2  | Start flow           | Apply/start in a dialog begins the migration, sets the gate, auto-redirects to `/migration`; operator is forced to stay there.                                                                                                                                                         |
| D3  | Gating               | Server-side middleware returns `503 migrationInProgress` (no `type`/`jobId` in the body) for all routes (incl. WebDAV protocol) except the allow-list; client app-guard polls `GET /api/migration/status` as double safety — admin → `/migration`, regular/anonymous → `/maintenance`. |
| D4  | Cancellation         | DB migration = one target transaction → cancel = rollback; blob migration = cancel flag, current node finishes, partial progress kept + resumed on rerun.                                                                                                                              |
| D5  | DB target handling   | Scan the target first (`schemaExists` + per-table row counts); data present → wipe alert → explicit `wipeTarget=true` confirm; wipe + copy in the same transaction.                                                                                                                    |
| D6  | Target schema        | Auto-apply the DDL to the explicit target backend/connection (schema-manager refactor).                                                                                                                                                                                                |
| D7  | `/migration` content | Progress only: determinate %, current-operation label, counters. No per-step/table list.                                                                                                                                                                                               |
| D8  | Blob progress        | Node-count based: `% = progress/total` over the snapshot; current file label shown.                                                                                                                                                                                                    |
| D9  | Terminal UX          | No header back button; auto modal popup on terminal state with summary + "Go to settings".                                                                                                                                                                                             |
| D10 | F2 persist           | After blob `apply`: DB-sourced storage keys persist to DB (`Settings.set`, secrets stored as plaintext, `invalidateCache`), job carries `configPersist { persisted, skippedEnvSourced }`; env-sourced keys → manual `.env` guidance.                                                             |
| D11 | Final DB cutover     | T0 keys env-owned; final step is manual env edit + restart; UI guides it and the server shows a persistent banner.                                                                                                                                                                     |
| D12 | Boot verification    | Add an S3 boot probe symmetric to the WebDAV one (warn-only).                                                                                                                                                                                                                          |
| D13 | ".env setup needed"  | `metadataPresence` detection for the non-active backend, exposed via an admin endpoint, banner in System Settings with a link to the migration flow.                                                                                                                                   |
| D14 | F1 tool form         | Admin API + dialogs; no standalone CLI (`migrateBlobs.js` CLI stays but is not the primary path).                                                                                                                                                                                      |

---

## API surface summary

| Endpoint                                       | Guard                    | Behavior                                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/migration/status`                    | public (gate allow-list) | **Unauthenticated:** `{ active: boolean }` only. **Authenticated admin:** full gate state `{ active, type?, jobId?, startedAt? }`. Polled by the app-guard (public) and the `/migration` page (admin) |
| `GET /api/admin/migration/target-scan`         | Token + Admin            | Metadata target scan: `schemaExists` + per-table row counts                                                                                                                                           |
| `POST /api/admin/migration/metadata`           | Token + Admin            | Start a metadata DB migration. Body `{ targetBackend, pg?, sqlitePath?, wipeTarget? }`; gate set; cancel = rollback                                                                                   |
| `GET /api/admin/migration/info`                | Token + Admin            | Derived blob direction `{ source, direction }` (existing)                                                                                                                                             |
| `POST /api/admin/migration/blobs`              | Token + Admin            | Start a blob migration job; both `dry-run` and `apply` set the gate (existing; blob jobs keep scalar `progress` + top-level `current`/`results`)                                                                                    |
| `GET /api/admin/migration/jobs/:jobId`         | Token + Admin            | Job status/progress (existing; type-specific payload: blob scalar `progress` + top-level `current`/`results`, metadata extended `{ percent, currentLabel }`)                                                                       |
| `POST /api/admin/migration/jobs/:jobId/cancel` | Token + Admin            | Cancel a running job (existing)                                                                                                                                                                       |

While the gate is active all non-allow-listed routes return `503 migrationInProgress`
(`GET /api/health`, `POST /api/auth/login`, `/api/admin/migration/*`, `GET
/api/migration/status` stay open). The 503 body carries no operational metadata — it does not
expose `type` or `jobId`.

---

## Testing anchors

Representative observable behaviors to cover:

- Gate active → every route except the allow-list returns `503 migrationInProgress` (WebDAV
  file-domain included); authenticated admins are routed to `/migration`, regular/anonymous
  users to the generic `/maintenance` page; the public status response is `{ active }` only;
  external clients are blocked.
- DB migration: target scan → wipe alert → explicit confirm → transactional copy. Cancel → full
  rollback on both sides. Completion → env-cutover guidance → restart → data live; the ".env
  setup needed" banner persists while data sits in the non-active backend.
- Blob migration: apply starts in the dialog and auto-redirects the operator to `/migration`;
  cancellable mid-copy (resume on rerun); DB-sourced storage config auto-persisted (+restart
  guidance); env-sourced falls back to manual `.env` guidance; restart → S3/WebDAV boot probe
  verifies the new backend on the health card.
- Terminal always surfaces an auto modal with summary + "Go to settings".
- No schema change beyond the existing DDL; `client`/`server` `test:ci` + E2E stay green.

---

## Future work

Future admin/operator app split — tracked in `docs/IMPROVEMENT_PLAN.md`.

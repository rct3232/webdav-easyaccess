# Installation and Execution Guide

## Document Responsibility

Use this guide only for operator workflow:

- installation and run commands
- environment variable setup
- migration execution order
- runtime smoke checks

Do not use this file as a full schema/spec reference. Canonical technical contracts live in:

- Permission enum: `shared/constants.js`
- PostgreSQL schema constraints/indexes: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
- PostgreSQL runtime env parsing: `server/store/storage.js`
- Store API contracts and verification scenarios: `docs/spec/server/store/*.md`

## 1. Install Dependencies

```bash
npm install
```

- **Note**: For video thumbnail generation on the server, **FFmpeg** must be installed on the system.

## 2. Environment Variables

Copy `.env.example` to create a `.env` file at the project root:

**Windows:**

```cmd
copy .env.example .env
```

**Linux/Mac:**

```bash
cp .env.example .env
```

> **Note (first-run wizard):** When the app boots with **no** `.env` file, the web-based
> first-run **setup wizard** ([`docs/features/setup-wizard.md`](features/setup-wizard.md))
> lets you configure the keys below from the browser (file-storage backend, admin
> account, JWT secret, optional SMTP/CORS/port). While setup is incomplete the server binds
> `127.0.0.1` only — use an on-host browser, an SSH tunnel, or the **CLI setup tool**
> ([`docs/features/setup-cli.md`](features/setup-cli.md)) for headless/remote hosts. Per the
> **config-source-resolution**
> model ([`docs/features/config-source-resolution.md`](features/config-source-resolution.md)),
> the wizard/CLI write `JWT_SECRET` into `.env` **only when the operator supplies one** (the
> `jwt` block is optional — omitted, the server uses an ephemeral per-boot secret);
> **every other value — including secret values — is stored in the metadata DB `settings`
> table** as plaintext and read back at boot (`.env` always wins when a value is present
> there). The
> **metadata connection is `.env`-owned**: the remote DB block (`WEA_DB_HOST` /
> `WEA_DB_DATABASE` / `WEA_DB_USER` / `WEA_DB_PASSWORD`, plus optional `WEA_DB_PORT` /
> pool/SSL keys) — or the default SQLite backend's `WEA_SQLITE_PATH` — must be declared in
> `.env` before boot and is **never written by the wizard/CLI**. A
> restart completes the setup. The reference table below remains canonical for the T0
> `.env` set and for manual/container configuration of DB-stored keys.

### Environment Variable Reference

**Source column** — `T0` = `.env`-owned (read at boot / `.env`-only, D2/D4/D7); `DB` = may be stored in the metadata DB `settings` table (via the wizard or the admin "Advanced settings" editor); a `.env` value always wins over the DB row (D1). T0 does not imply required: `JWT_SECRET` is `.env`-owned but **optional** (unset/empty → ephemeral random secret generated at boot).

| Variable                         | Source |              Required               | Description                                                                                                                                                        | Default            |
| :------------------------------- | :----: | :---------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------- |
| **WEA_FILE_STORAGE**             |   DB   |                 No                  | File/blob storage backend (`s3` or `webdav`)                                                                                                                       | `s3`               |
| **S3_BUCKET**                    |   DB   |   Only when `WEA_FILE_STORAGE=s3`   | S3 bucket name for blob storage                                                                                                                                    | -                  |
| **AWS_REGION**                   |   DB   |   Only when `WEA_FILE_STORAGE=s3`   | AWS region of the S3 bucket                                                                                                                                        | -                  |
| **AWS_ACCESS_KEY_ID**            |   DB   |   Only when `WEA_FILE_STORAGE=s3`   | AWS access key ID for S3                                                                                                                                           | -                  |
| **AWS_SECRET_ACCESS_KEY**        |   DB   |   Only when `WEA_FILE_STORAGE=s3`   | AWS secret access key for S3                                                                                                                                      | -                  |
| **S3_ENDPOINT**                  |   DB   |                 No                  | Custom S3-compatible endpoint (e.g. MinIO); empty for AWS                                                                                                          | -                  |
| **WEBDAV_URL**                   |   DB   | Only when `WEA_FILE_STORAGE=webdav` | WebDAV server base URL (e.g. `https://dav.example.com`)                                                                                                            | -                  |
| **WEBDAV_USERNAME**              |   DB   | Only when `WEA_FILE_STORAGE=webdav` | WebDAV server account name                                                                                                                                         | -                  |
| **WEBDAV_PASSWORD**              |   DB   | Only when `WEA_FILE_STORAGE=webdav` | WebDAV server password                                                                                                                                             | -                  |
| **JWT_SECRET**                   |   T0   |                 No                  | JWT signing key. Optional — unset/empty ⇒ ephemeral random secret generated at boot (restart invalidates all sessions). Set one unified value across instances; the legacy placeholder only warns. | -                  |
| **PORT**                         |   DB   |                 No                  | Server port                                                                                                                                                        | `5001`             |
| **CORS_ORIGINS**                 |   DB   |                 No                  | Allowed browser origins (comma-separated)                                                                                                                          | `*` (with warning) |
| **WEA_SQLITE_PATH**              |   T0   |                 No                  | Path to the SQLite metadata database file (SQLite is the default metadata backend when no remote DB keys are set)                                                  | `data/webdav.db`   |
| **WEA_DB_HOST**                  |   T0   |         Only with remote DB         | Remote PostgreSQL host; with DATABASE/USER/PASSWORD it selects the remote metadata backend (all four required together)                                            | -                  |
| **WEA_DB_PORT**                  |   T0   |                 No                  | Remote PostgreSQL port                                                                                                                                             | `5432`             |
| **WEA_DB_DATABASE**              |   T0   |         Only with remote DB         | Remote PostgreSQL database name                                                                                                                                    | -                  |
| **WEA_DB_USER**                  |   T0   |         Only with remote DB         | Remote PostgreSQL user                                                                                                                                             | -                  |
| **WEA_DB_PASSWORD**              |   T0   |         Only with remote DB         | Remote PostgreSQL password (secret)                                                                                                                                | -                  |
| **WEA_DB_SSL**                   |   T0   |                 No                  | Enable remote PostgreSQL TLS from app pool (`true`/`false`)                                                                                                        | `false`            |
| **WEA_DB_MAX**                   |   T0   |                 No                  | Remote PostgreSQL pool max connections                                                                                                                             | `10`               |
| **WEA_DB_IDLE_TIMEOUT_MS**       |   T0   |                 No                  | Remote PostgreSQL pool idle timeout (ms)                                                                                                                           | `30000`            |
| **WEA_DB_CONNECTION_TIMEOUT_MS** |   T0   |                 No                  | Remote PostgreSQL pool connection timeout (ms)                                                                                                                     | `10000`            |
| **PGSSLMODE**                    |   T0   |                 No                  | Optional CLI/client SSL mode (for tools such as `psql`)                                                                                                            | `prefer`           |
| **MAX_THUMBNAIL_SIZE**           |   DB   |                 No                  | Max thumbnail resolution (pixels)                                                                                                                                  | `300`              |
| **FFMPEG_PATH**                  |   DB   |                 No                  | Absolute path to FFmpeg executable (when auto-detect fails)                                                                                                        | `ffmpeg` (PATH)    |
| **WEBDAV_AUTH_TYPE**             |   DB   |                 No                  | WebDAV auth method (`auto`, `basic`, `digest`)                                                                                                                     | `auto`             |
| **WEBDAV_UPSTREAM_URL**          |   DB   |                 No                  | For `Destination` header issues behind a reverse proxy                                                                                                             | -                  |
| **JWT_EXPIRES_IN**               |   DB   |                 No                  | Login session duration (e.g. `30m`, `1h`, `7d`)                                                                                                                    | `30m`              |
| **EMAIL\_\***                    |   DB   |                 No                  | SMTP settings for signup/approval notifications (HOST, PORT, USER, PASS, etc.)                                                                                     | -                  |

> **Secret values:** DB-stored secret keys (`EMAIL_PASSWORD`, `WEBDAV_PASSWORD`,
> `AWS_SECRET_ACCESS_KEY`, `ADMIN_DEFAULT_PASSWORD`) are stored as **plaintext strings** in
> the `settings` table; the registry `secret` flag only masks them (`****`) on API/UI
> surfaces. A DB backup leak therefore exposes these values in plaintext — treat DB backups
> with the same care as `.env`.

## 3. Metadata Storage Configuration

The system supports a SQLite-backed (default) and a remote PostgreSQL-backed metadata store with the same store interfaces. The legacy `fs`/`webdav` metadata backends are removed (Phase 7).

> **The metadata (DB) connection is `.env`-owned.** The remote DB block (`WEA_DB_HOST`,
> `WEA_DB_DATABASE`, `WEA_DB_USER`, `WEA_DB_PASSWORD`, plus optional pool/SSL keys) and the
> SQLite path (`WEA_SQLITE_PATH`) must be declared in `.env`/env before boot; the metadata
> backend is **not** configurable through the admin UI or the setup wizard (D5/D6/D7).
> Setting any one of `WEA_DB_HOST`/`WEA_DB_DATABASE`/`WEA_DB_USER`/`WEA_DB_PASSWORD` selects
> the remote PostgreSQL backend; an incomplete set (at least one set but not all four) aborts
> boot with a clear terminal error that lists the missing keys. When none of them is set, the
> default SQLite backend is used.
> The setup wizard then serves only non-T0 settings (file storage, email, server, runtime) into
> the connected DB. A minimal first-boot `.env` is:
>
> ```dotenv
> # SQLite (default): no remote DB keys set
> WEA_SQLITE_PATH=/path/to/webdav.db
> # or remote PostgreSQL: all four WEA_DB_* keys required
> WEA_DB_HOST=db.example.com
> WEA_DB_DATABASE=webdav_easyaccess
> WEA_DB_USER=webdav
> WEA_DB_PASSWORD=change-me
> # JWT_SECRET is OPTIONAL: omit it and the server generates an ephemeral per-boot secret
> # (restart -> new secret -> all sessions invalidated). Non-T0 values (file storage,
> # email, server) are stored in the DB by the wizard.
> # JWT_SECRET=change-me
> ```

1.  **SQLite backend (`sqlite`)** (default):
    - Stores metadata in a local SQLite database file (development/testing).
    - Used when no remote DB keys are set; optionally set `WEA_SQLITE_PATH=/path/to/webdav.db`.
2.  **PostgreSQL backend (`postgresql`)**:
    - Stores metadata in normalized relational tables (`users`, `settings`, `permissions_*`, `share_links`, `recent_files`, `permission_requests`, `locks`).
    - Recommended for stronger consistency and high-concurrency metadata operations.
    - Provide `WEA_DB_HOST`, `WEA_DB_PORT`, `WEA_DB_DATABASE`, `WEA_DB_USER`, `WEA_DB_PASSWORD` (plus optional pool/SSL settings) — all four credential keys are required together.

### File Storage (Blob) Configuration

File/blob storage is selected independently of the metadata backend:

- **`WEA_FILE_STORAGE=s3`** (default): blob content lives in S3. Requires `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; optionally `S3_ENDPOINT` for an S3-compatible service (e.g. MinIO). WebDAV settings are unused in this mode.
- **`WEA_FILE_STORAGE=webdav`**: blob content lives on the WebDAV server. Requires `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`.
- The file-storage backend is independent of the metadata backend (SQLite or remote PostgreSQL): either blob backend can be combined with either metadata backend.
- Migrating blob content between the two backends (WebDAV ↔ S3) is supported — see [Data Migration: WebDAV ↔ S3](#data-migration-webdav--s3).

### PostgreSQL Initialization (v2)

The schema is applied **automatically at startup**. On a **fresh empty database**, the server boots and `initMetadataStore()` (`server/store/bootstrap.js`) runs `applyPendingMigrations('postgresql')` (`server/infrastructure/schemaManager.js`), which applies `server/store/postgresql/ddl/*.sql` in order and records each file in `_schema_migrations`. Subsequent boots detect all files as applied and are no-ops (idempotent).

**Deployment contract: point the app only at a fresh empty database. Never point it at an existing/old DB.** No "already exists" tolerance is added — a misconfigured app aimed at a pre-existing (e.g. legacy path-based) database must fail loudly at boot rather than be silently recorded as migrated. Moving existing metadata into a fresh target DB is handled out of band by the **metadata migration admin path** (`GET /api/admin/migration/target-scan` → `POST /api/admin/migration/metadata`, target scan → wipe alert → confirm → transactional copy; see `docs/features/migration-mode.md` and `docs/spec/server/tools/metadata-migration.md`), followed by a manual `.env` cutover + restart (the DB connection is T0/`.env`-owned). Blob content is moved with the WebDAV ↔ S3 migration tool (see [Data Migration: WebDAV ↔ S3](#data-migration-webdav--s3) and `docs/spec/server/tools/blob-migration.md`).

To apply the DDL manually (equivalent to what startup does), instead:

1.  Apply the initial normalized DDL:
    ```bash
    PGPASSWORD="$WEA_DB_PASSWORD" psql \
      -h "$WEA_DB_HOST" \
      -p "${WEA_DB_PORT:-5432}" \
      -U "$WEA_DB_USER" \
      -d "$WEA_DB_DATABASE" \
      -f server/store/postgresql/ddl/001_initial_normalized_schema.sql
    ```
2.  Verify schema apply status using your DB tooling (for example `\dt` / `\d` in `psql`) and treat the DDL file as canonical:
    - `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
3.  Start the server and confirm `/api/health` reports healthy metadata store access.

Permission contract source of truth:

- Runtime enum: `shared/constants.js` (`PERMISSIONS.ALL`)
- Database checks: `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (`permissions_*` permission constraints)

### Data Migration: WebDAV ↔ S3

> **Active — see `docs/spec/server/tools/blob-migration.md` for the full spec.**

Moves physical blobs between the two supported blob backends (WebDAV and S3) in either direction, guided by the DB metadata (`file_nodes` + `object_map` + `filecache`). The tool is **bidirectional** and resumable. It runs **in-app** via the admin API (`POST /api/admin/migration/blobs`, 202 + `{ jobId }` polling) — the primary path, executed on the `/migration` page under migration mode — or as a **standalone CLI** (`server/scripts/migrateBlobs.js`, kept but not the primary path). Both trigger the same `migrationService` core. Feature spec: `docs/features/migration-mode.md`.

**How it works**

- The **direction** is auto-derived from the current app config (`WEA_FILE_STORAGE`): source = the env mode, destination = the other backend. The server is the single source of truth; only the **destination** config is user input (`--dest-*` flags or `DEST_*` env; e.g. `DEST_TYPE=s3`, `DEST_S3_BUCKET`, ... or `DEST_TYPE=webdav`, `DEST_WEBDAV_URL`, ...). `DEST_TYPE` must match the derived destination (`s3` for a webdav source, `webdav` for an s3 source).
- The migration run uses a **snapshot approach**: the active file-node set is enumerated once at start; the tool reads only from source and writes only to the destination store plus the required DB updates. The app remains fully usable during the copy.
- **Source blobs are never deleted** (a delete-mode follow-up is tracked in `docs/IMPROVEMENT_PLAN.md`).

**Direction and cutover (migration mode)**

The migration direction is never selected — it follows from the current `WEA_FILE_STORAGE`. `GET /api/admin/migration/info` reports the derived `{ source, direction }`. Starting an **apply** run from the storage-migration dialog (System Settings) enters **migration mode**: the whole app locks (all routes return `503 migrationInProgress` except health/login/migration/status) and the operator's browser **auto-redirects to `/migration`**, which shows node-count progress (`% = copied/total`), the current file label, and copied/skipped/failed counters. Regular users (and anonymous visitors) are shown the generic `/maintenance` screen instead of the operator page. The run is cancellable mid-copy and resumable on re-run.

Both directions follow the same cutover shape:

1. **Run the copy (`apply`)** — dialog destination credentials are used for the copy; on completion the destination config is **auto-persisted** (DB-sourced storage keys are written to the DB `settings` table as plaintext, secret values included; env-sourced keys are reported as `skippedEnvSourced` and you edit `.env` manually instead). A `dry-run` also enters migration mode (its enumeration progress is shown on `/migration`) but writes nothing.
2. **Restart the app** — storage config is boot-frozen (`WEA_FILE_STORAGE` + the backend block are read once at startup), so a restart is strictly required for the switch to take effect.
3. **Verify** — after restart the active backend is probed at boot (WebDAV probe, or the S3 probe) and the backend-health card reflects the new backend.

- **WebDAV → S3 (derived when `WEA_FILE_STORAGE=webdav`):** run the copy while the app is in webdav mode. `object_map` is updated per node during copy (safe because the webdav-mode app ignores it). After the copy completes and the restart is done, the app runs in s3 mode — no finalize step is needed.
- **S3 → WebDAV (derived when `WEA_FILE_STORAGE=s3`):** run the copy while the app is in s3 mode. Each node's `object_map.storage_backend` is flipped to `'webdav'` **inline** right after its webdav upload succeeds, while `s3_key` is **preserved** — the running S3-mode app keeps serving via the retained key and rollback stays possible. Then **cut over**: restart with `WEA_FILE_STORAGE=webdav` (+ `WEBDAV_*` env). No separate finalize step is needed.

**Execution order**

Direction is derived from `WEA_FILE_STORAGE`, so it is not passed on the command line. The examples below assume `WEA_FILE_STORAGE=webdav` (webdav → s3); for the reverse, set `WEA_FILE_STORAGE=s3` and use `--dest-type=webdav` + `--dest-webdav-*`.

```bash
# 1) Preflight validation: config + snapshot + destination connectivity, no writes
node server/scripts/migrateBlobs.js --check-env

# 2) Dry run (mandatory before any apply) — writes nothing
node server/scripts/migrateBlobs.js --dest-type=s3 \
  --dest-s3-bucket=my-bucket --dest-s3-access-key=... --dest-s3-secret-key=... --dry-run

# 3) Apply — requires --yes; runs the internal dry-run pass first
node server/scripts/migrateBlobs.js --dest-type=s3 \
  --dest-s3-bucket=my-bucket --dest-s3-access-key=... --dest-s3-secret-key=... --apply --yes

# 4) Re-run to resume (automatic): already-migrated nodes are skipped; a full re-run copies nothing
node server/scripts/migrateBlobs.js --dest-type=s3 ... --apply --yes

# s3-to-webdav copy (with WEA_FILE_STORAGE=s3): the object_map flip happens inline per node during apply; then cut over (see above)
node server/scripts/migrateBlobs.js --dest-type=webdav \
  --dest-webdav-url=... --dest-webdav-username=... --dest-webdav-password=... --apply --yes
```

**Rules**

- Dry-run is **mandatory** before every `--apply` run; `--apply` itself performs the dry-run pass first, and a failed dry-run blocks all writes (exit 1, nothing written).
- `--apply` requires `--yes`; abort otherwise.
- The destination `type` (`--dest-type` / `DEST_TYPE`) must match the derived destination backend; a mismatch aborts before any work (exit 1).
- `.wea` is a normal folder — migrated like any other node.
- Per-node failures are recorded and processing continues; the run only aborts on config/snapshot/destination-validation failure.
- **Resume is automatic:** re-running an interrupted migration skips already-migrated nodes (no `--resume` flag); `--force` re-copies nodes even when an automatic resume marker is present.

### Config Sync: `.env` ↔ DB (`configSync`)

> **Active — see `docs/spec/server/tools/config-sync.md` for the full spec.**

Detects drift between `.env` values and the metadata DB `settings` rows for every non-T0 config key (`.env` always wins per the config-source-resolution model, so a DB row under an env-set key is a shadow copy that can go stale), alerts on it, and optionally reconciles the DB rows to mirror `.env`. T0 keys (`.env`-owned, incl. `JWT_SECRET`) are never reported or written; DB rows are never deleted; comparison is plaintext string equality on every key; secret values are always masked (`****`) in output. Feature spec: `docs/features/config-sync.md`.

**Usage**

```bash
# 1) Drift report (read-only, default mode). Exit 0 = clean, 1 = drift
node server/scripts/configSync.js --check

# 2) Same report, machine-readable (single JSON document: findings + summary + exitCode)
node server/scripts/configSync.js --check --json

# 3) Reconcile: upsert DB rows for every non-T0 key set in .env (plaintext), then re-run
#    the check in-process. Requires --yes
node server/scripts/configSync.js --apply --yes
```

**Report statuses**: `differs` (drift → exit 1), `shadowed` / `env-only` / `db-only` (informational), each with `db_updated_at` for DB-backed findings. There is no key-loss status — DB rows are plaintext and always readable.

**Rules**

- `--apply` requires `--yes`; without it the run is a usage error (exit 2).
- The tool boots the metadata schema only (no default-admin seeding) and never writes `.env`; a running server is unaffected until its next config read/restart, as with any other `settings` change.

### Transaction and Concurrency Notes (postgresql)

- User creation/email change/deletion run in a single transaction.
- ACL grant/revoke and request status transitions run in per-operation transactions.
- Share download counters are incremented atomically in SQL.
- Metadata lock semantics use database locks table with TTL-aware cleanup.

### Operational Verification Checklist

Use this checklist for deployment/runtime validation only:

- [ ] Metadata backend env keys are set as intended (the remote `WEA_DB_*` block is either complete or absent — partial sets abort boot).
- [ ] Required DDL has been applied (`001`). On a fresh DB the server applies it automatically at startup; on a migrated target DB the migration tool applies it first.
- [ ] Blob migration (WebDAV ↔ S3, `docs/spec/server/tools/blob-migration.md`) ran a `dry-run` before `apply` and report warnings are resolved; cutover steps (persist/restart/probe) followed.
- [ ] Metadata migration (sqlite ↔ PG, `docs/spec/server/tools/metadata-migration.md`) used `target-scan` + explicit wipe confirm; `.env` cutover (the remote `WEA_DB_*` block) and restart performed; ".env setup needed" banner resolved.
- [ ] `/api/health` returns healthy status after server start.

For store contract validation, use `docs/spec/server/store/*.md`.

## 4. Running the Application

### Development Mode (client + server)

```bash
npm run dev
```

- Access: `http://localhost:3000` (frontend dev server)

### E2E WebDAV readiness

For local Playwright E2E runs that use `docker-compose.e2e.yml`, treat the WebDAV container as ready only after an authenticated directory-list style probe succeeds. A plain unauthenticated `GET /` can become reachable before authenticated `PROPFIND /` requests are accepted, which can lead to flaky explorer startup failures even though the container looks "up".

On Apple Silicon hosts, prefer a multi-architecture WebDAV image for the E2E compose stack. Running an amd64-only WebDAV image under emulation can introduce intermittent connection failures during longer repeat runs.

### Production Mode

1.  **Build frontend**:
    ```bash
    npm run build
    ```
2.  **Start server**:
    ```bash
    cd server
    npm start
    ```

- Access: `http://localhost:5001` (or your configured `PORT`)

## 5. Security and Initial Admin Setup

### First-run network posture (loopback-only)

While the app is **not yet configured** (`setup_complete === false`) the HTTP server binds to
`127.0.0.1` only. This is a hard rule with **no opt-out**: a fresh/partial install is never
reachable from another machine, so its unauthenticated setup surface
(`/setup`, `/api/setup/*`, the setup-mode login) cannot be claimed or attacked remotely. Once
the configuration is complete, a restart makes the server bind all interfaces (the default), at
which point a reverse proxy can publish it.

Complete the first run using **one** of:

1. **Browser on the host** — open `http://127.0.0.1:<PORT>` and follow the wizard.
2. **Browser + SSH tunnel** — from a machine with a browser: `ssh -L 5001:127.0.0.1:5001
user@host`, then open `http://127.0.0.1:5001`.
3. **No browser (headless/remote)** — run the **CLI setup tool** on the host:
   `node server/scripts/setup.js` (interactive) or `node server/scripts/setup.js --help` for
   the flag-driven non-interactive mode; feature spec: `docs/features/setup-cli.md`. Equivalent
   to pre-populating the configuration directly (see below).
4. **env-only first run (containerized/automated)** — inject every key the completeness rules
   require (the remote `WEA_DB_*` block when PostgreSQL metadata is used — none is required for
   the default SQLite backend — `WEA_FILE_STORAGE` + its credential block, and any non-default
   settings) via environment. `JWT_SECRET` is **not** part of completeness: a single instance
   may rely on the ephemeral per-boot fallback, while multi-instance deployments must inject one
   unified `JWT_SECRET`. `setup_complete` is derived, so
   the app boots fully configured on the first run, never enters setup mode, and binds all
   interfaces immediately. `.env` never needs to exist.

### Default admin account

- On first run, an account is created with username `admin` and password `admin` (or
  `ADMIN_DEFAULT_PASSWORD` from `.env`).
- **Change the admin password immediately after first login.**

### HTTPS recommended

- Auth tokens and WebDAV credentials are sent over the network; production deployments must use
  **HTTPS** via Nginx, Caddy, etc.

### Browser session

- Auth tokens are stored in `sessionStorage` for security. Closing the browser tab or window
  logs you out automatically.

### Reverse-proxy hardening checklist

- [ ] **Publish only after the first run is complete.** Do not expose the port in the reverse
      proxy (or a firewall/NAT rule) while `setup_complete === false` — even though the app
      binds loopback only, keeping the proxy rule out until first run is complete removes all
      accidental-exposure risk. Complete setup over SSH or with the CLI, restart, then publish.
- [ ] Serve the app over HTTPS and set `CORS_ORIGINS` to your public origin(s) in production
      (`CORS_ORIGINS` unset ⇒ allow-all with a warning).
- [ ] During a storage migration (migration mode) regular users see a generic maintenance
      screen (`/maintenance`); the operator `/migration` progress page is admin-only. No
      restriction is needed at the proxy for these.
- [ ] Keep `JWT_SECRET` out of version control and rotate it if it was ever exposed.
- [ ] Restrict `/api/health` exposure at the proxy if you do not want liveness probes public.

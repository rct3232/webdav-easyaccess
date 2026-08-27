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

*   **Note**: For video thumbnail generation on the server, **FFmpeg** must be installed on the system.

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

### Environment Variable Reference

| Variable | Required | Description | Default |
| :--- | :---: | :--- | :--- |
| **WEA_FILE_STORAGE** | No | File/blob storage backend (`s3` or `webdav`) | `s3` |
| **S3_BUCKET** | Only when `WEA_FILE_STORAGE=s3` | S3 bucket name for blob storage | - |
| **AWS_REGION** | Only when `WEA_FILE_STORAGE=s3` | AWS region of the S3 bucket | - |
| **AWS_ACCESS_KEY_ID** | Only when `WEA_FILE_STORAGE=s3` | AWS access key ID for S3 | - |
| **AWS_SECRET_ACCESS_KEY** | Only when `WEA_FILE_STORAGE=s3` | AWS secret access key for S3 | - |
| **S3_ENDPOINT** | No | Custom S3-compatible endpoint (e.g. MinIO); empty for AWS | - |
| **WEBDAV_URL** | Only when `WEA_FILE_STORAGE=webdav` | WebDAV server base URL (e.g. `https://dav.example.com`) | - |
| **WEBDAV_USERNAME** | Only when `WEA_FILE_STORAGE=webdav` | WebDAV server account name | - |
| **WEBDAV_PASSWORD** | Only when `WEA_FILE_STORAGE=webdav` | WebDAV server password | - |
| **JWT_SECRET** | Yes | Secret key for token signing (must change in production!) | - |
| **PORT** | No | Server port | `5001` |
| **CORS_ORIGINS** | No | Allowed browser origins (comma-separated) | `*` (with warning) |
| **WEA_STORAGE_BACKEND** | No | Metadata storage backend (`sqlite` or `postgresql`) | `sqlite` |
| **WEA_SQLITE_PATH** | No | Path to the SQLite metadata database file | `data/webdav.db` |
| **WEA_PG_HOST** | No | PostgreSQL host when using `postgresql` backend | - |
| **WEA_PG_PORT** | No | PostgreSQL port when using `postgresql` backend | `5432` |
| **WEA_PG_DATABASE** | No | PostgreSQL database name when using `postgresql` backend | - |
| **WEA_PG_USER** | No | PostgreSQL user when using `postgresql` backend | - |
| **WEA_PG_PASSWORD** | No | PostgreSQL password when using `postgresql` backend | - |
| **WEA_PG_SSL** | No | Enable PostgreSQL TLS from app pool (`true`/`false`) | `false` |
| **WEA_PG_MAX** | No | PostgreSQL pool max connections | `10` |
| **WEA_PG_IDLE_TIMEOUT_MS** | No | PostgreSQL pool idle timeout (ms) | `30000` |
| **WEA_PG_CONNECTION_TIMEOUT_MS** | No | PostgreSQL pool connection timeout (ms) | `10000` |
| **PGSSLMODE** | No | Optional CLI/client SSL mode (for tools such as `psql`) | `prefer` |
| **MAX_THUMBNAIL_SIZE** | No | Max thumbnail resolution (pixels) | `300` |
| **FFMPEG_PATH** | No | Absolute path to FFmpeg executable (when auto-detect fails) | `ffmpeg` (PATH) |
| **WEBDAV_AUTH_TYPE** | No | WebDAV auth method (`auto`, `basic`, `digest`) | `auto` |
| **WEBDAV_UPSTREAM_URL** | No | For `Destination` header issues behind a reverse proxy | - |
| **JWT_EXPIRES_IN** | No | Login session duration (e.g. `30m`, `1h`, `7d`) | `30m` |
| **EMAIL_*** | No | SMTP settings for signup/approval notifications (HOST, PORT, USER, PASS, etc.) | - |

## 3. Metadata Storage Configuration

The system supports PostgreSQL-backed and SQLite-backed metadata with the same store interfaces. The legacy `fs`/`webdav` metadata backends are removed (Phase 7).

1.  **SQLite backend (`sqlite`)** (default):
    *   Stores metadata in a local SQLite database file (development/testing).
    *   Set `WEA_STORAGE_BACKEND=sqlite` and `WEA_SQLITE_PATH=/path/to/webdav.db`.
2.  **PostgreSQL backend (`postgresql`)**:
    *   Stores metadata in normalized relational tables (`users`, `settings`, `permissions_*`, `share_links`, `recent_files`, `permission_requests`, `locks`).
    *   Recommended for stronger consistency and high-concurrency metadata operations.
    *   Set `WEA_STORAGE_BACKEND=postgresql` and provide `WEA_PG_HOST`, `WEA_PG_PORT`, `WEA_PG_DATABASE`, `WEA_PG_USER`, `WEA_PG_PASSWORD` (plus optional pool/SSL settings).

### File Storage (Blob) Configuration

File/blob storage is selected independently of the metadata backend:

- **`WEA_FILE_STORAGE=s3`** (default): blob content lives in S3. Requires `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; optionally `S3_ENDPOINT` for an S3-compatible service (e.g. MinIO). WebDAV settings are unused in this mode.
- **`WEA_FILE_STORAGE=webdav`**: blob content lives on the WebDAV server. Requires `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`.
- The file-storage backend is independent of the metadata backend (`WEA_STORAGE_BACKEND`): either blob backend can be combined with either metadata backend.
- Migrating blob content between the two backends (WebDAV ↔ S3) is supported — see [Data Migration: WebDAV ↔ S3](#data-migration-webdav--s3).

### PostgreSQL Initialization (v2)

The schema is applied **automatically at startup**. On a **fresh empty database**, the server boots and `initMetadataStore()` (`server/store/bootstrap.js`) runs `applyPendingMigrations('postgresql')` (`server/infrastructure/schemaManager.js`), which applies `server/store/postgresql/ddl/*.sql` in order and records each file in `_schema_migrations`. Subsequent boots detect all files as applied and are no-ops (idempotent).

**Deployment contract: point the app only at a fresh empty database. Never point it at an existing/old DB.** No "already exists" tolerance is added — a misconfigured app aimed at a pre-existing (e.g. legacy path-based) database must fail loudly at boot rather than be silently recorded as migrated. Data migration is handled out of band: blob content is moved with the active WebDAV ↔ S3 migration tool (see [Data Migration: WebDAV ↔ S3](#data-migration-webdav--s3) and `docs/spec/server/tools/blob-migration.md`).

To apply the DDL manually (equivalent to what startup does), instead:

1.  Apply the initial normalized DDL:
    ```bash
    PGPASSWORD="$WEA_PG_PASSWORD" psql \
      -h "$WEA_PG_HOST" \
      -p "${WEA_PG_PORT:-5432}" \
      -U "$WEA_PG_USER" \
      -d "$WEA_PG_DATABASE" \
      -f server/store/postgresql/ddl/001_initial_normalized_schema.sql
    ```
2.  Verify schema apply status using your DB tooling (for example `\dt` / `\d` in `psql`) and treat the DDL file as canonical:
    *   `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
3.  Start the server and confirm `/api/health` reports healthy metadata store access.

Permission contract source of truth:

- Runtime enum: `shared/constants.js` (`PERMISSIONS.ALL`)
- Database checks: `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (`permissions_*` permission constraints)

### Data Migration: WebDAV ↔ S3

> **Active — see `docs/spec/server/tools/blob-migration.md` for the full spec.**

Moves physical blobs between the two supported blob backends (WebDAV and S3) in either direction, guided by the DB metadata (`file_nodes` + `object_map` + `filecache`). The tool is **bidirectional** and resumable. It runs as a **standalone CLI** (`server/scripts/migrateBlobs.js`) or in-app via the admin API (`POST /api/admin/migration/blobs`, 202 + `{ jobId }` polling). Both trigger the same `migrationService` core.

**How it works**

- The **direction** is auto-derived from the current app config (`WEA_FILE_STORAGE`): source = the env mode, destination = the other backend. The server is the single source of truth; only the **destination** config is user input (`--dest-*` flags or `DEST_*` env; e.g. `DEST_TYPE=s3`, `DEST_S3_BUCKET`, ... or `DEST_TYPE=webdav`, `DEST_WEBDAV_URL`, ...). `DEST_TYPE` must match the derived destination (`s3` for a webdav source, `webdav` for an s3 source).
- The migration run uses a **snapshot approach**: the active file-node set is enumerated once at start; the tool reads only from source and writes only to the destination store plus the required DB updates. The app remains fully usable during the copy.
- **Source blobs are never deleted** in the MVP (a delete mode is a follow-up).

**Direction and cutover**

The migration direction is never selected — it follows from the current `WEA_FILE_STORAGE`. `GET /api/admin/migration/info` reports the derived `{ source, direction }`. After an `apply` run completes, the in-app UI shows a popup instructing you to change `WEA_FILE_STORAGE` + the target storage env block in `.env` and restart the server process (a dry-run completion does not show it).

Both directions follow the same cutover shape — run the copy (`apply`), switch `WEA_FILE_STORAGE` + the backend's storage env in `.env`, restart the app, then verify:

- **WebDAV → S3 (derived when `WEA_FILE_STORAGE=webdav`):** run the copy while the app is in webdav mode. `object_map` is updated per node during copy (safe because the webdav-mode app ignores it). After the copy completes, stop the app, set `WEA_FILE_STORAGE=s3` (+ `S3_*` env), and restart — no finalize step is needed.
- **S3 → WebDAV (derived when `WEA_FILE_STORAGE=s3`):** run the copy while the app is in s3 mode. Each node's `object_map.storage_backend` is flipped to `'webdav'` **inline** right after its webdav upload succeeds, while `s3_key` is **preserved** — the running S3-mode app keeps serving via the retained key and rollback stays possible. Then **cut over**: stop the app, set `WEA_FILE_STORAGE=webdav` (+ `WEBDAV_*` env), and restart. No separate finalize step is needed.

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

### Transaction and Concurrency Notes (postgresql)

*   User creation/email change/deletion run in a single transaction.
*   ACL grant/revoke and request status transitions run in per-operation transactions.
*   Share download counters are incremented atomically in SQL.
*   Metadata lock semantics use database locks table with TTL-aware cleanup.

### Operational Verification Checklist

Use this checklist for deployment/runtime validation only:

- [ ] `WEA_STORAGE_BACKEND` and backend-specific env keys are set as intended.
- [ ] Required DDL has been applied (`001`). On a fresh DB the server applies it automatically at startup; on a migrated target DB the migration tool applies it first.
- [ ] Blob migration (WebDAV ↔ S3, `docs/spec/server/tools/blob-migration.md`) ran `--check-env` and `--dry-run` before `--apply`, and report warnings are resolved; cutover steps followed.
- [ ] `/api/health` returns healthy status after server start.

For store contract validation, use `docs/spec/server/store/*.md`.

## 4. Running the Application

### Development Mode (client + server)
```bash
npm run dev
```
*   Access: `http://localhost:3000` (frontend dev server)

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
*   Access: `http://localhost:5001` (or your configured `PORT`)

## 5. Security and Initial Admin Setup

1.  **Default admin account**:
    *   On first run, an account is created with username `admin` and password `admin` (or `ADMIN_DEFAULT_PASSWORD` from `.env`).
    *   **Change the admin password immediately after first login.**
2.  **HTTPS recommended**:
    *   Auth tokens and WebDAV credentials are sent over the network; production deployments must use **HTTPS** via Nginx, Caddy, etc.
3.  **Browser session**:
    *   Auth tokens are stored in `sessionStorage` for security. Closing the browser tab or window logs you out automatically.

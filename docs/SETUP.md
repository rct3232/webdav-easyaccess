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
| **WEBDAV_URL** | Yes | WebDAV server base URL (e.g. `https://dav.example.com`) | - |
| **WEBDAV_USERNAME** | Yes | WebDAV server account name | - |
| **WEBDAV_PASSWORD** | Yes | WebDAV server password | - |
| **JWT_SECRET** | Yes | Secret key for token signing (must change in production!) | - |
| **PORT** | No | Server port | `5001` |
| **CORS_ORIGINS** | No | Allowed browser origins (comma-separated) | `*` (with warning) |
| **WEA_STORAGE_BACKEND** | No | Metadata storage backend (`postgresql` or `sqlite`) | `postgresql` |
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

1.  **PostgreSQL backend (`postgresql`)** (default):
    *   Stores metadata in normalized relational tables (`users`, `settings`, `permissions_*`, `share_links`, `recent_files`, `permission_requests`, `locks`).
    *   Recommended for stronger consistency and high-concurrency metadata operations.
    *   Set `WEA_STORAGE_BACKEND=postgresql` and provide `WEA_PG_HOST`, `WEA_PG_PORT`, `WEA_PG_DATABASE`, `WEA_PG_USER`, `WEA_PG_PASSWORD` (plus optional pool/SSL settings).
    *   Keep WebDAV settings configured for actual file content operations; PostgreSQL stores metadata only.
2.  **SQLite backend (`sqlite`)**:
    *   Stores metadata in a local SQLite database file (development/testing).
    *   Set `WEA_STORAGE_BACKEND=sqlite` and `WEA_SQLITE_PATH=/path/to/webdav.db`.

### PostgreSQL Initialization (v2)

When enabling `postgresql`, initialize the schema before running the server. The migration script (`--apply`) can create metadata tables automatically if they do not exist (by running `001_initial_normalized_schema.sql`). To create schema manually instead:

1.  Apply the initial normalized DDL:
    ```bash
    PGPASSWORD="$WEA_PG_PASSWORD" psql \
      -h "$WEA_PG_HOST" \
      -p "${WEA_PG_PORT:-5432}" \
      -U "$WEA_PG_USER" \
      -d "$WEA_PG_DATABASE" \
      -f server/store/postgresql/ddl/001_initial_normalized_schema.sql
    ```
2.  If your database was initialized before admin-permission alignment, apply the follow-up constraint migration:
    ```bash
    PGPASSWORD="$WEA_PG_PASSWORD" psql \
      -h "$WEA_PG_HOST" \
      -p "${WEA_PG_PORT:-5432}" \
      -U "$WEA_PG_USER" \
      -d "$WEA_PG_DATABASE" \
      -f server/store/postgresql/ddl/002_allow_admin_permission_values.sql
    ```
3.  Verify schema apply status using your DB tooling (for example `\dt` / `\d` in `psql`) and treat the DDL file as canonical:
    *   `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
4.  Start the server and confirm `/api/health` reports healthy metadata store access.

Permission contract source of truth:

- Runtime enum: `shared/constants.js` (`PERMISSIONS.ALL`)
- Database checks: `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (`permissions_*` permission constraints)

### One-shot Metadata Migration (fs/webdav -> postgresql)

After schema initialization, migrate legacy metadata (`/.wea`) into PostgreSQL with the one-shot migrator:

```bash
cd server
node scripts/migrateMetadataToPostgresql.js --source-backend=fs --dry-run --report-file=./migration-report.json
node scripts/migrateMetadataToPostgresql.js --source-backend=fs --apply --report-file=./migration-report.json
```

For WebDAV-backed metadata source:

```bash
cd server
node scripts/migrateMetadataToPostgresql.js --source-backend=webdav --dry-run --report-file=./migration-report.json
```

Options:

- `--source-backend=fs|webdav` (required): source metadata backend to read from.
- `--dry-run` (default): analyze source and generate validation report without DB writes.
- `--apply`: execute migration in a single transaction (upsert-based). Creates metadata tables automatically if they do not exist.
- `--full-sync`: with `--apply`, truncates the migrated metadata tables and re-inserts from the source so the DB exactly matches the source. Use with care; removes any rows not present in the source.
- `--report-file=<path>`: write JSON validation report to file.

Validation report includes:

- source entity counts per domain table.
- migrated/skipped counts and warning details.
- post-write DB row counts (for `--apply`) and expected-vs-actual checks.

Recommended sequence:

1. run `--dry-run`, resolve warnings.
2. run `--apply`.
3. run server with `WEA_STORAGE_BACKEND=postgresql` and verify core APIs.

### Transaction and Concurrency Notes (postgresql)

*   User creation/email change/deletion run in a single transaction.
*   ACL grant/revoke and request status transitions run in per-operation transactions.
*   Share download counters are incremented atomically in SQL.
*   Metadata lock semantics use database locks table with TTL-aware cleanup.

### Operational Verification Checklist

Use this checklist for deployment/runtime validation only:

- [ ] `WEA_STORAGE_BACKEND` and backend-specific env keys are set as intended.
- [ ] Required DDL has been applied (`001`, and `002` only if your instance needs follow-up permission alignment). The migration script creates tables automatically when using `--apply` if they do not exist.
- [ ] Migration runs `--dry-run` before `--apply`, and report warnings are resolved.
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

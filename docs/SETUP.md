# Installation and Execution Guide

## 1. Install Dependencies

```bash
npm run install-all
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
| **WEA_STORAGE_BACKEND** | No | Metadata storage backend (`webdav`, `fs`, or `postgresql`) | `webdav` |
| **WEA_FS_DIR** | No | Local storage path when using `fs` backend | OS temp dir under `webdav-easyaccess-meta` |
| **DATABASE_URL** | No | PostgreSQL connection string when using `postgresql` backend | - |
| **PGSSLMODE** | No | PostgreSQL SSL mode used by client/pool in secure environments | `prefer` |
| **MAX_THUMBNAIL_SIZE** | No | Max thumbnail resolution (pixels) | `300` |
| **FFMPEG_PATH** | No | Absolute path to FFmpeg executable (when auto-detect fails) | `ffmpeg` (PATH) |
| **WEBDAV_AUTH_TYPE** | No | WebDAV auth method (`auto`, `basic`, `digest`) | `auto` |
| **WEBDAV_UPSTREAM_URL** | No | For `Destination` header issues behind a reverse proxy | - |
| **JWT_EXPIRES_IN** | No | Login session duration (e.g. `30m`, `1h`, `7d`) | `30m` |
| **EMAIL_*** | No | SMTP settings for signup/approval notifications (HOST, PORT, USER, PASS, etc.) | - |

## 3. Metadata Storage Configuration

The system supports file-backed metadata and PostgreSQL-backed metadata with the same store interfaces.

1.  **WebDAV backend (`webdav`)**:
    *   Stores all data under `/.wea` on the WebDAV server.
    *   Data persists across server restarts and reinstalls, tied to the storage.
2.  **Filesystem backend (`fs`)**:
    *   Stores data on the application server's local disk.
    *   Recommended when WebDAV response times are slow.
    *   Set `WEA_STORAGE_BACKEND=fs` and `WEA_FS_DIR=/path/to/data`.
3.  **PostgreSQL backend (`postgresql`)**:
    *   Stores metadata in normalized relational tables (`users`, `settings`, `permissions_*`, `share_links`, `recent_files`, `permission_requests`, `locks`).
    *   Recommended for stronger consistency and high-concurrency metadata operations.
    *   Set `WEA_STORAGE_BACKEND=postgresql` and provide `DATABASE_URL`.
    *   Keep WebDAV settings configured for actual file content operations; PostgreSQL stores metadata only.

### PostgreSQL Initialization (v2)

When enabling `postgresql`, initialize the schema before running the server:

1.  Apply the project migration/DDL for the v2 schema.
2.  Verify required constraints exist:
    *   user uniqueness (`username`, `email`, `email_hash`)
    *   permission and request status checks
    *   `recent_files` and permission uniqueness by `(user_id, path)`
    *   pending permission-request dedupe partial index
3.  Start the server and confirm `/api/health` reports healthy metadata store access.

### Transaction and Concurrency Notes (postgresql)

*   User creation/email change/deletion run in a single transaction.
*   ACL grant/revoke and request status transitions run in per-operation transactions.
*   Share download counters are incremented atomically in SQL.
*   Metadata lock semantics use database locks table with TTL-aware cleanup.

## 4. Running the Application

### Development Mode (client + server)
```bash
npm run dev
```
*   Access: `http://localhost:3000` (frontend dev server)

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

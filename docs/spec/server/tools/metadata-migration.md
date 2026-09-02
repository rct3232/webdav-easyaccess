# Metadata Migration Tool Spec (admin API)

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role       | The supported metadata DB migration path (`sqlite` ↔ `postgresql`), exposed as an **admin API + config dialogs** (D14). Replaces the removed standalone CLI `server/scripts/migrateMetadataToPostgresql.js` (Phase 7; `server/scripts/migrate/` is empty). Drives `server/domains/admin/services/metadataMigrationService.js`. |
| Depends on | `metadataMigrationService` (`server/domains/admin/services/metadataMigrationService.js`), the migration gate (`server/infrastructure/migrationGate.js`), the migration router (`server/domains/admin/routes/migration.js`)                                                                                                     |
| Files      | routes added to `server/domains/admin/routes/migration.js` (mounted at `/api/admin`, behind `authenticateToken` + `isAdmin`)                                                                                                                                                                                                   |
| Test files | `server/domains/admin/routes/__tests__/migration.test.js` (extended); `test:ci:pg` for the sqlite↔PG roundtrip                                                                                                                                                                                                                 |

Source of truth: `docs/features/migration-mode.md`, `docs/spec/server/services/metadataMigrationService.md`,
`PLAN.md` (`feature/migration-mode`, D4–D6, D11, D14).

There is **no CLI** for metadata migration. The in-app dialog (System Settings → metadata
migration) drives the endpoints below; the flow is target-scan → wipe alert → explicit confirm →
transactional copy.

---

## 2. Endpoints

### 2.1 `GET /api/admin/migration/target-scan`

Admin-gated (Token + Admin). Read-only scan of the explicit **non-active** target metadata
backend.

Query/body: none (target is inferred as the non-active backend). The dialog holds the target
connection fields; the scan uses the **same** connection payload as the start call.

Response `200`:

```json
{
  "backend": "postgresql" | "sqlite",
  "connected": true,
  "schemaExists": false,
  "tables": [{ "name": "users", "rows": 0 }],
  "totalRows": 0
}
```

- `schemaExists: true` with `totalRows > 0` → the dialog renders the **wipe alert** (list of
  tables/rows) and requires explicit `wipeTarget=true` confirmation before start.
- Connection failures classify like the setup/backend probes (unreachable / auth / missing
  database) so the dialog shows a translated error.
- While the migration gate is active this route is allow-listed (see
  `docs/spec/server/infrastructure/migrationGate.md`).

### 2.2 `POST /api/admin/migration/metadata`

Admin-gated (Token + Admin). Start a metadata DB migration. Sets the migration gate (D2/D3) and
dispatches the worker; the client auto-redirects to `/migration`.

Body:

```jsonc
{
  "targetBackend": "postgresql", // must be the NON-active backend (source = WEA_STORAGE_BACKEND)
  "pg": {
    // required when targetBackend === 'postgresql'
    "host": "…",
    "port": 5432,
    "database": "…",
    "user": "…",
    "password": "…",
    "ssl": false,
  },
  "sqlitePath": "/abs/path/target.db", // required when targetBackend === 'sqlite'
  "wipeTarget": false, // must be true when the target already holds data
}
```

Responses:

- `202 { jobId }` — accepted; the worker runs the transactional copy and updates the extended
  job payload (see §3). `jobId` is the gate `jobId`, surfaced through
  `GET /api/migration/status`.
- `400` — invalid payload: `targetBackend` equals the active backend, missing/empty connection
  fields, or `wipeTarget: false` while the target already holds data (the dialog must show the
  wipe alert and re-confirm).
- `409` — a migration is already running (gate active or blob job in flight).
- `403` — non-admin.

### 2.3 Wipe-confirm flow (D5)

1. The dialog calls `GET /api/admin/migration/target-scan`.
2. If the target already holds data, the dialog shows a **wipe alert** listing the affected
   tables/rows ("Wiping will delete N rows from users, M from file_nodes, …").
3. The operator must explicitly confirm (e.g. a checkbox or typed confirmation); the start call
   is sent with `wipeTarget: true`.
4. The wipe runs inside the same target transaction as the copy — a mid-way cancel rolls back
   the wipe too (D4).

### 2.4 Progress and cancellation

- The worker reports `stage` (`scan`/`schema`/`wipe`/`copy`/`done`), an overall determinate `%`
  (per-source-table `COUNT(*)` pre-aggregation), and `progress.currentLabel` (current table +
  rows) into the extended job payload (PLAN §4/§5).
- Cancellation: `POST /api/admin/migration/jobs/:jobId/cancel` reuses the existing blob cancel
  route for the gate-level job; the metadata worker aborts the transaction → **ROLLBACK**, both
  sides unharmed.

---

## 3. Extended job payload (shared with blob migration)

Both migration types publish the same extended job shape (PLAN §5), so the `/migration` page
renders uniformly:

```js
{
  id: string,                    // gate jobId
  type: 'metadata' | 'blobs',
  direction: 'sqlite-to-postgresql' | 'postgresql-to-sqlite'   // metadata
             | 'webdav-to-s3' | 's3-to-webdav',                // blobs
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
  stage: 'scan' | 'schema' | 'wipe' | 'copy' | 'done' | null,
  progress: { percent, currentLabel, counters? },
  results?: any,                 // metadata: per-table counts; blobs: { copied, skipped, failed, errors }
  startedAt: string,
  completedAt?: string,
  error?: string,                // human failure reason (replaces/extends blob errorMessage)
  configPersist?: { persisted, skippedEnvSourced },   // blobs apply only (D10)
}
```

---

## 4. T0 ".env setup needed" manual cutover (D11, D13)

The DB connection is `.env`-owned (T0: `WEA_STORAGE_BACKEND` + `WEA_PG_*` / `WEA_SQLITE_PATH`,
`encrypt_secret_key`, `JWT_SECRET`). A metadata migration only copies data; it **never edits
`.env`**. The final step stays manual:

1. The migration completes; `/migration` shows the terminal modal with next-step guidance
   ("set `WEA_STORAGE_BACKEND=postgresql` (+ `WEA_PG_*`) in `.env` and restart" — or the reverse).
2. The operator edits `.env` and restarts the server.
3. **".env setup needed" banner:** while the non-active backend still holds metadata
   (`metadataPresence`, D13), System Settings shows a persistent banner with a link to the
   migration flow. After cutover + restart the old backend becomes the non-active one; the banner
   flips to point the other way, and clears once the old data is gone.
4. Boot verification: PG pre-flight exits on missing `WEA_PG_*` (unchanged); the new backend's
   health is verified via the boot probe (WebDAV or the new S3 probe, D12) and the health card.

The same banner logic means the operator can also cut over **before** migrating: the banner
points to the migration dialog, they migrate, then restart.

---

## 5. Verification Scenarios

- [ ] `target-scan` returns `schemaExists` + per-table counts for the non-active backend; never
      writes
- [ ] Start with a populated target and `wipeTarget: false` → `400` (wipe alert required)
- [ ] Start with a populated target and `wipeTarget: true` → `202 { jobId }`; gate active
- [ ] `targetBackend` equal to the active backend → `400`
- [ ] Non-admin → `403`; a second migration while the gate is active → `409`
- [ ] Job completes with per-table `results`; cancel mid-copy → `cancelled`, target rolled back
- [ ] After completion the ".env setup needed" banner appears while the non-active backend holds
      metadata and clears once the old data is gone
- [ ] No `.env` file is ever modified by the metadata migration path

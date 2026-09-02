# metadataMigrationService Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Metadata DB migration engine: moves all metadata rows between the `sqlite` and `postgresql` backends (both directions) via direct target connections. Performs a target scan, applies the schema to an explicit target, and runs a single-transaction wipe + copy whose cancellation rolls back everything. |
| Depends on | `server/infrastructure/backendProbe.js` (`probePostgresql` pattern for direct `pg.Client` connections), `server/infrastructure/schemaManager.js` / `sqliteSchemaInit.js` (`convertPostgresToSqlite`), the settings-value contract of `server/store/settingsStore.js`                                        |
| Files      | `server/domains/admin/services/metadataMigrationService.js` (new)                                                                                                                                                                                                                                           |
| Test files | `server/domains/admin/services/__tests__/metadataMigrationService.test.js` (new; sqlite↔PG roundtrip under `test:ci:pg`)                                                                                                                                                                                    |

Source of truth: `docs/features/migration-mode.md`, `docs/spec/server/tools/metadata-migration.md`,
`docs/features/migration-mode.md` (decisions D4–D6, D11, D14).

The service operates on **direct target connections** (`pg.Client` for PostgreSQL,
`better-sqlite3` for SQLite) — it does **not** use the app's own metadata adapter/store layer,
which is tied to the active backend. The active backend is never touched by the copy.

---

## 2. Implementation Spec

### 2.1 Factory

`createMetadataMigrationService({ getBackend, pgConnectionProvider, sqliteFactory })`

| Param                  | Type     | Description                                                                                                                                                                                                                            |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getBackend`           | function | Returns the active metadata backend (`'sqlite'` \| `'postgresql'`) from `server/store/storage.js`. Used to derive the migration direction (target = the other backend).                                                                |
| `pgConnectionProvider` | function | `(pgConfig) => pg.Client` — direct PG connection factory. Defaults to a `pg.Client` built like `probePostgresql` in `server/infrastructure/backendProbe.js` (host/port/database/user/password, ssl option, `connectionTimeoutMillis`). |
| `sqliteFactory`        | function | `(path) => sqlite connection` — direct SQLite factory (better-sqlite3).                                                                                                                                                                |

### 2.2 Public API

| Function       | Signature                                                                                | Description                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `scanTarget`   | `({ targetBackend, pg?, sqlitePath? }) => Promise<ScanResult>`                           | Connect to the explicit target and report `schemaExists` + per-table row counts. Read-only.                                         |
| `runMigration` | `({ targetBackend, pg?, sqlitePath?, wipeTarget?, onStage, signal }) => Promise<Result>` | Apply schema if missing, wipe the target if `wipeTarget`, then copy all rows in one target transaction. `signal` aborts → ROLLBACK. |

### 2.3 Target scan (`scanTarget`)

Read-only; never writes to the target.

```js
{
  backend: 'postgresql' | 'sqlite',
  connected: true,
  schemaExists: boolean,           // settings table present (and, for PG, _schema_migrations)
  tables: [
    { name: 'users', rows: number },
    { name: 'file_nodes', rows: number },
    ...                            // every copyable table, row-counted
  ],
  totalRows: number,
}
```

- `schemaExists` detection: check for the `settings` table (always present in the app schema). On
  PostgreSQL also check `_schema_migrations` (PG-only; the sqlite schema is created by the
  conversion layer and does not use it).
- Per-table row counts use `COUNT(*)` on each copyable table.
- A missing database/connection failure surfaces the same classification as
  `probePostgresql`/`classifyPgError` (unreachable / auth / missing database) so the dialog can
  render a translated error.

### 2.4 Direction and target payload

- Target = the **non-active** backend: `getBackend() === 'sqlite'` ⇒ target `postgresql`, and
  vice versa. The router validates that `targetBackend` is the non-active backend before any work.
- Target connection fields:
  - `postgresql`: `{ host, port, database, user, password, ssl? }`.
  - `sqlite`: `{ sqlitePath }` (absolute path to the target `.db` file).

### 2.5 Schema apply to an explicit target (D6)

If `schemaExists === false`, apply the DDL **to the explicit target connection** before copying:

- **PostgreSQL target:** execute `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
  on the target `pg.Client`.
- **SQLite target:** run `convertPostgresToSqlite(DDL)` (`server/infrastructure/sqliteSchemaInit.js`)
  on the target sqlite connection.
- The explicit-target schema apply is **implemented** (no schema-manager refactor pending):
  `applyPendingMigrations(backend, options)` accepts `{ pgClient }` to apply the PG DDL to a
  caller-supplied connection (`server/infrastructure/schemaManager.js:162-170`), and
  `initSqliteSchema({ connection })` applies the SQLite DDL to a caller-supplied sqlite3
  connection (`server/infrastructure/sqliteSchemaInit.js:107-118`). `applySchema` invokes them
  against the migration-target connection (metadataMigrationService.js:631-637); the boot path is
  unchanged (no options → the active backend, `storage.getPgPool()` /
  `storage.getSqliteConnection()`).
- `_schema_migrations` is **not** copied (see §2.8); for a PG target the schema-apply records the
  applied DDL files so subsequent app boots are no-ops.

### 2.6 Single-transaction wipe + copy (D4, D5)

`runMigration` runs **one target transaction**:

```
BEGIN
  [schema apply if missing]
  [if wipeTarget: TRUNCATE/DELETE all copyable tables]     // rolled back on abort
  copy users → file_nodes → object_map/filecache/node_ancestors
        → permissions_user_paths/user_files/shares → share_links/recent_files/permission_requests
        → locks → settings
COMMIT   // or ROLLBACK on error/cancel
```

- **Wipe** is part of the same transaction as the copy (D5) — a mid-way cancel rolls back the
  wipe too, so the target is never left partially emptied.
- **Cancellation = ROLLBACK (D4):** the worker checks the cancel signal before/after each table;
  when cancelled (or on any error) the transaction is rolled back and both sides are unharmed.
- The active backend is only ever **read**; the target is only ever **written**.

### 2.7 FK copy order

Rows must be inserted in FK-dependency order so `REFERENCES` checks pass (foreign keys are
enforced on both backends):

| Step | Table(s)                                                                 | Why here                                                                                                           |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 1    | `users`                                                                  | Referenced by `permissions_*`, `share_links`, `recent_files`, `permission_requests`.                               |
| 2    | `file_nodes`                                                             | `parent_id` self-references `file_nodes`; referenced by every child table. All nodes must exist before child rows. |
| 3    | `object_map`, `filecache`, `node_ancestors`                              | Reference `file_nodes` only.                                                                                       |
| 4    | `permissions_user_paths`, `permissions_user_files`, `permissions_shares` | Reference `users` + `file_nodes`.                                                                                  |
| 5    | `share_links`, `recent_files`, `permission_requests`                     | Reference `users` + `file_nodes` (permission_requests has a SERIAL id).                                            |
| 6    | `locks`                                                                  | No FK dependencies; copied for completeness.                                                                       |
| 7    | `settings`                                                               | Last — values may depend on nothing, but the table is the config surface.                                          |

### 2.8 Per-table copy rules

- **`settings.value` serialization.** The two backends store the column differently:
  `settings.value` is `JSONB` in PG and raw `TEXT` in sqlite (converted by
  `sqliteSchemaInit`). The copy must wrap accordingly:
  - **→ PG:** write `JSON.stringify(String(value))` (the same shape `settingsStore.set` produces
    for PG — plaintext rows become a JSON string like `"smtp.gmail.com"`; encrypted secret rows
    already carry a JSON object and are written as their serialized JSON).
  - **→ sqlite:** write `String(value)` verbatim.
  - Encrypted secret rows (AES-256-GCM objects) are copied **verbatim** — the ciphertext
    survives iff the target runtime uses the same `encrypt_secret_key` (see §2.11).
- **Booleans (`users.is_admin`).** sqlite stores `INTEGER 0/1` (converted from `BOOLEAN`); PG
  stores real `true/false`. The copy maps:
  - **→ PG:** `0 → false`, `1 → true`.
  - **→ sqlite:** `true → 1`, `false → 0`.
    This is the only BOOLEAN column in the schema (`users.is_admin`,
    `001_initial_normalized_schema.sql:20`).
- **Explicit-id inserts + sequence resync.** SERIAL-id tables (`users`, `file_nodes`,
  `permission_requests`) are inserted **with their explicit source `id`** so FK references stay
  intact. Afterwards the target sequences are resynced so new inserts do not collide:
  - **→ PG:** `SELECT setval(pg_get_serial_sequence('users','id'), (SELECT MAX(id) FROM users))`
    (and the same for `file_nodes`, `permission_requests`).
  - **→ sqlite:** update `sqlite_sequence` (`INSERT INTO sqlite_sequence(name, seq) ...` / update
    for the three tables) so `AUTOINCREMENT` continues after the copied max id.
- **`_schema_migrations` is never copied.** It exists only in PG and tracks the active backend's
  applied DDL files; the target's schema-apply step manages it independently (§2.5).
- **`locks`** is copied for completeness; stale lock rows are harmless (TTL-aware cleanup).

### 2.9 Progress / stage reporting

`onStage({ stage, label, done, total })` is called per table:

| Field            | Description                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`          | `'scan'` \| `'schema'` \| `'wipe'` \| `'copy'` \| `'done'` (matches the extended job payload in `docs/spec/server/tools/blob-migration.md` §job payload and PLAN §4) |
| `label`          | Current table + rows, e.g. `"Copying users … 3,420/5,100"` (this becomes `progress.currentLabel`)                                                                    |
| `done` / `total` | Running per-table `COUNT(*)` pre-aggregation, `Σ done / Σ total` → overall `%`                                                                                       |

### 2.10 Result

```js
{
  copiedTables: { [tableName]: rows },
  totalRows: number,
  schemaApplied: boolean,   // true if the schema was applied by this run
  wiped: boolean,           // true if wipeTarget was honored
}
```

### 2.11 `encrypt_secret_key` warning

DB-stored secrets (`WEBDAV_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_PASSWORD`,
`ADMIN_DEFAULT_PASSWORD`) are AES-256-GCM-encrypted under `encrypt_secret_key` (T0, `.env`).
`settings.value` ciphertext is copied verbatim, so it decrypts correctly on the target **only if
the target runtime uses the same `encrypt_secret_key`**. The service therefore surfaces an
explicit warning before/after a metadata migration: the operator must keep (or set) an identical
`encrypt_secret_key` on the target environment, or the migrated secret rows become
undecryptable. `encrypt_secret_key` itself is never part of the migration (T0/.env-only).

---

## 3. Verification Scenarios

- [ ] `scanTarget` on an empty target reports `schemaExists: false`, `totalRows: 0`; on a
      populated target reports per-table counts
- [ ] `scanTarget` never writes (target row counts unchanged after scan)
- [ ] Migration to a schema-less target auto-applies the DDL (`IF NOT EXISTS`, PG via
      `_schema_migrations`, sqlite via `convertPostgresToSqlite`)
- [ ] Round-trip sqlite→PG→sqlite: row counts equal per table; `users.is_admin` boolean ↔ 0/1
      mapped correctly; `settings.value` JSON-string ↔ raw TEXT wrapped correctly
- [ ] Explicit ids preserved (FK references intact); sequences resynced — a new insert after
      migration does not collide (`setval` / `sqlite_sequence`)
- [ ] `_schema_migrations` is not copied
- [ ] `wipeTarget` only deletes the target when the operator confirmed it; wipe + copy are in the
      same transaction
- [ ] Cancel mid-copy → target ROLLBACK: target row counts unchanged, source untouched
- [ ] Error mid-copy → ROLLBACK, target unchanged
- [ ] The active backend is never written by the copy
- [ ] `onStage` reports `scan` → `schema` → `wipe` → `copy` → `done` with a sensible `%`
- [ ] Encrypted secret rows round-trip byte-identical; a different `encrypt_secret_key` on the
      target triggers the warning

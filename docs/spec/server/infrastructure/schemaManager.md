# schemaManager Spec

## 1. Overview

| Item | Description                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Pending migration detection + idempotent application across backends. Tracks applied DDL files in `_schema_migrations` table using SHA-256 checksums. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/schemaManager.js`
- **Test file:** `server/infrastructure/__tests__/schemaManager.test.js`

### 2.2 Main Methods

| Method                 | Signature                                                         | Description                                      |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| applyPendingMigrations | (backend, options?) => Promise\<void\>                            | Detect and apply unapplied DDL files; idempotent. `options.pgClient` targets an explicit PG connection (caller owns the transaction); `options.sqliteConnection` targets an explicit sqlite3.Database (caller owns the transaction). No options → the active backend. |

### 2.3 `_schema_migrations` Table

Auto-created if missing:

```sql
CREATE TABLE _schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  checksum TEXT NOT NULL
);
```

### 2.4 Algorithm

1. Create `_schema_migrations` table if not exists
2. Glob all `ddl/*.sql` files, sorted alphabetically
3. For each file:
   a. Read DDL content and compute its SHA-256 checksum
   b. Look up the file in `_schema_migrations`:
      - **Row exists, checksum matches** → skip (idempotent no-op)
      - **Row exists, checksum differs** → throw a hard error naming the file and
        both checksums (stored vs current) — modified-DDL detection, fail fast
      - **No row** → apply:
        i. If sqlite backend: apply `convertPostgresToSqlite()`
        ii. Execute the file's statements — transaction mode is backend-dependent (see below)
        iii. INSERT into `_schema_migrations` { filename, applied_at, checksum }

**Execution mode per backend:**

- **PostgreSQL, boot path (no explicit client):** the whole DDL file executes in one
  transaction via `storage.withTransaction` (the file keeps its `BEGIN`/`COMMIT` wrapper).
- **PostgreSQL, explicit `pgClient`:** the file's `BEGIN`/`COMMIT` wrapper is stripped and the
  statements run on the caller-supplied client — the caller owns the transaction
  (`metadataMigrationService` applies the DDL inside its own target transaction).
- **SQLite, boot path (no explicit connection):** the whole DDL file executes in one transaction —
  `PRAGMA foreign_keys = OFF` → `BEGIN` → statements → `COMMIT` → `PRAGMA foreign_keys = ON`
  (rolled back + FKs restored on error, and the `_schema_migrations` record is written inside the
  same transaction). The FK pragmas sit outside the transaction because `PRAGMA foreign_keys` is a
  no-op inside one; the file's own `BEGIN`/`COMMIT` wrapper is stripped for sqlite.
- **SQLite, explicit `sqliteConnection`:** statements run individually on the caller-supplied
  connection — the caller owns the transaction (`metadataMigrationService` applies the DDL inside
  its own target transaction).

### 2.5 Key Properties

- **Idempotent**: Running twice produces no changes (second run detects all files as already applied)
- **Modified-DDL detection**: Each file's SHA-256 is recorded at apply time and re-verified on every run; a checksum mismatch for an already-applied file is a hard boot error (fail fast) naming the file and both checksums, consistent with the §2.8 deployment contract
- **Called at startup (both backends)**: `server/store/bootstrap.js` `initMetadataSchema()` calls
  `applyPendingMigrations('postgresql')` for PostgreSQL and `applyPendingMigrations('sqlite')` for
  SQLite, before `ensureDefaultAdmin()`. Both backends are checksum-tracked. The converter module
  (`initSqliteSchema`/`convertPostgresToSqlite`, `sqliteSchemaInit.js`) remains as the transpile
  layer used by `applyPendingMigrations` and as an explicit-target/temp-DB initializer
  (`{ connection }`/`{ path }` modes); it is no longer the boot path.

### 2.6 Dependencies

- glob-based DDL discovery
- crypto (SHA-256)
- sqliteSchemaInit (for SQLite conversion)
- storage (pgPool, transaction helpers)

### 2.7 Verification Scenarios

- [ ] `_schema_migrations` auto-created if missing
- [ ] Pending migration detection: only unapplied files execute
- [ ] Idempotency: second call produces zero SQL executions
- [ ] SHA-256 checksum recorded for each applied file
- [ ] Modified-DDL detection: a pre-existing row whose stored checksum differs from the file's current SHA-256 → `applyPendingMigrations` throws a hard error naming the file and both checksums; repeated runs keep failing deterministically with no further side effects
- [ ] `initMetadataSchema()` applies pending DDL at startup for BOTH branches before `ensureDefaultAdmin()`
- [ ] SQLite boot path applies each file inside one transaction and restores `PRAGMA foreign_keys = ON` afterwards

### 2.8 Deployment Contract (both backends)

- **Fresh DB → one-time DDL apply**: On a fresh empty database, `initMetadataSchema()` runs
  `applyPendingMigrations(<backend>)` at boot, applying `server/store/postgresql/ddl/*.sql` in
  filename order and recording each file in `_schema_migrations`. Subsequent boots detect all
  files as applied and are no-ops.
- **Never point the app at a legacy (pre-normalized) DB**: A misconfigured deployment aimed at a
  pre-existing (e.g. legacy path-based) database is **unsupported**. No "already exists" tolerance
  is added for untracked tables — any DDL failure or schema mismatch surfaces as a hard boot error
  rather than being silently recorded as migrated. An already-tracked normalized database (its
  `_schema_migrations` rows match the recorded checksums) migrates forward by applying pending
  files at boot.
- **Data migration is out of band**: the migration service applies the schema to a fresh target
  (`applyPendingMigrations` with an explicit target connection) before importing data; the new
  instance's DB is always fresh at cutover.

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

| Method                 | Signature                    | Description                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------ |
| applyPendingMigrations | (backend) => Promise\<void\> | Detect and apply unapplied DDL files; idempotent |

### 2.3 `_schema_migrations` Table

Auto-created if missing:

```sql
CREATE TABLE _schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
        ii. Execute statements within a transaction
        iii. INSERT into `_schema_migrations` { filename, applied_at, checksum }

### 2.5 Key Properties

- **Idempotent**: Running twice produces no changes (second run detects all files as already applied)
- **Modified-DDL detection**: Each file's SHA-256 is recorded at apply time and re-verified on every run; a checksum mismatch for an already-applied file is a hard boot error (fail fast) naming the file and both checksums, consistent with the §2.8 deployment contract
- **Called at startup**: `applyPendingMigrations('postgresql')` is invoked from `server/store/bootstrap.js` `initMetadataStore()` for the non-SQLite branch, before `ensureDefaultAdmin()`. The SQLite path is unchanged and uses `initSqliteSchema()` (converter-based) instead — `applyPendingMigrations('sqlite')` is exercised only by its unit tests.

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
- [ ] `initMetadataStore()` applies PG DDL at startup for the non-SQLite branch before `ensureDefaultAdmin()`; SQLite path behavior unchanged

### 2.8 Deployment Contract (PostgreSQL)

- **Fresh DB → one-time DDL apply**: On a fresh empty database, `initMetadataStore()` runs `applyPendingMigrations('postgresql')` at boot, applying `server/store/postgresql/ddl/*.sql` in order and recording each file in `_schema_migrations`. Subsequent boots detect all files as applied and are no-ops.
- **Never point the app at an existing/old DB**: A misconfigured deployment aimed at a pre-existing (e.g. legacy path-based) database is **unsupported**. No "already exists" tolerance is added — any DDL failure or schema mismatch surfaces as a hard boot error rather than being silently recorded as migrated.
- **Data migration is out of band**: the migration script applies the schema (or boots the app once on an empty DB with `WEA_DISABLE_DEFAULT_ADMIN=true`) before importing data; the new instance's DB is always fresh at cutover.

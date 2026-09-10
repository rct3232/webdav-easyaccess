# sqliteSchemaInit Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | PostgreSQL→SQLite DDL conversion (`convertPostgresToSqlite`) plus explicit-target SQLite schema initialization (`initSqliteSchema`). The transpiler is consumed by `schemaManager.applyPendingMigrations('sqlite', ...)` — the boot path on both backends — and `initSqliteSchema` remains for caller-supplied connections and temporary DBs (it is no longer the app boot path). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/sqliteSchemaInit.js`
- **Test file:** `server/infrastructure/__tests__/sqliteSchemaInit.test.js`

### 2.2 Main Methods

| Method                  | Signature                          | Description                                                                                                                                                                                |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| initSqliteSchema        | ({ connection?, path? }) => Promise\<{ connection }\> | DDL discovery via `fs.readdir`, type conversion, execute against SQLite DB. Returns `{ connection }`. Two modes: `{ connection }` applies to a caller-supplied `sqlite3.Database` (the caller owns its lifecycle); `{ path }` opens a temporary DB at `path` (`PRAGMA foreign_keys = ON`), applies the DDL, then closes it. The no-arg boot form still applies to `storage.getSqliteConnection()` but is unused in production — the boot path is `schemaManager.applyPendingMigrations('sqlite')`. |
| convertPostgresToSqlite | (ddl) => string                     | Convert PostgreSQL DDL to SQLite-compatible SQL                                                                                                                                             |

### 2.3 Type Conversions (`convertPostgresToSqlite`)

Applied in order:

1. `BEGIN;` / `COMMIT;` → stripped (removed)
2. `BIGSERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`
3. Standalone `BIGSERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`
4. `\bBIGINT\b` → `INTEGER` (must be AFTER BIGSERIAL replacements to avoid partial match corruption)
5. `TIMESTAMPTZ` → `TEXT`
6. `JSONB` → `TEXT`
7. `BOOLEAN` → `INTEGER`
8. `DEFAULT NOW()` → `DEFAULT CURRENT_TIMESTAMP`
9. `DEFAULT FALSE` → `DEFAULT 0`
10. `DEFAULT TRUE` → `DEFAULT 1`
Pass-through (no conversion needed):

- `CHECK` constraints — SQLite supports them natively
- Partial indexes (`WHERE ...`) — SQLite 3.9.0+ supports them (e.g.
  `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL` survives verbatim)
- Self-referencing FKs — inline syntax works on both backends
- `DROP INDEX IF EXISTS` / `CREATE [UNIQUE] INDEX IF NOT EXISTS` — supported by SQLite

### 2.4 Dependencies

- DDL file discovery via `fs.readdir` on `server/store/postgresql/ddl/` (`.sql` files, sorted alphabetically)
- node sqlite3 (sqlite3 driver) (via `storage.getSqliteConnection()`, or the caller-supplied `connection`)
- PRAGMA handling: `server/store/storage.js` sets only `journal_mode = WAL` and `foreign_keys = ON`
  on the app connection; `defer_foreign_keys` is set only in test setups (e.g.
  `server/infrastructure/__tests__/schemaManager.test.js`) and by `metadataMigrationService`
  before its target transaction. This module itself sets `foreign_keys = ON` only on a DB it
  opens itself (the `{ path }` mode).

### 2.5 Verification Scenarios

- [ ] Glob discovers all DDL files in alphabetical order
- [ ] Type mappings are correct after conversion (all 10 mappings above)
- [ ] Converted SQL executes without error against in-memory SQLite DB
- [ ] FK enforcement works with deferred foreign keys

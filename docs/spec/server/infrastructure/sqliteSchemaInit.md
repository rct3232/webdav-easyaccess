# sqliteSchemaInit Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | DDL discovery + PostgreSQL→SQLite conversion for SQLite schema initialization. Reads `ddl/*.sql` files via directory listing, converts PostgreSQL types to SQLite equivalents, and executes against better-sqlite3. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/sqliteSchemaInit.js`
- **Test file:** `server/infrastructure/__tests__/sqliteSchemaInit.test.js`

### 2.2 Main Methods

| Method                  | Signature             | Description                                                                                                                                 |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| initSqliteSchema        | () => Promise\<void\> | DDL discovery via `fs.readdir`, type conversion, execute against SQLite DB. Reads DB handle internally via `storage.getSqliteConnection()`. |
| convertPostgresToSqlite | (ddl) => string       | Convert PostgreSQL DDL to SQLite-compatible SQL                                                                                             |

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
- Partial indexes (`WHERE ...`) — SQLite 3.9.0+ supports them
- Self-referencing FKs — inline syntax works on both backends

### 2.4 Dependencies

- DDL file discovery via `fs.readdir` on `server/store/postgresql/ddl/` (`.sql` files, sorted alphabetically)
- better-sqlite3 (via `storage.getSqliteConnection()`)
- PRAGMAs (`foreign_keys = ON`, `defer_foreign_keys = ON`) are set in `storage.js` and test setup, not in this module

### 2.5 Verification Scenarios

- [ ] Glob discovers all DDL files in alphabetical order
- [ ] Type mappings are correct after conversion (all 10 mappings above)
- [ ] Converted SQL executes without error against in-memory SQLite DB
- [ ] FK enforcement works with deferred foreign keys

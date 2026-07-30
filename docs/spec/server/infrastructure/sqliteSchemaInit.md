# sqliteSchemaInit Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | DDL discovery + PostgreSQL→SQLite conversion for SQLite schema initialization. Reads `ddl/*.sql` files via glob, converts PostgreSQL types to SQLite equivalents, and executes against better-sqlite3. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/sqliteSchemaInit.js`
- **Test file:** `server/infrastructure/__tests__/sqliteSchemaInit.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| initSqliteSchema | (db) => void | Glob-based DDL discovery, type conversion, execute against SQLite DB |

### 2.3 Type Conversions (`convertPostgresToSqlite`)

Applied in order:
1. `BIGSERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`
2. Standalone `BIGSERIAL` → `INTEGER GENERATED ALWAYS AS IDENTITY` (or similar)
3. `\bBIGINT\b` → `INTEGER` (must be AFTER BIGSERIAL replacements to avoid partial match corruption)
4. `TIMESTAMPTZ` → `TEXT`
5. `JSONB` → `TEXT`
6. `BOOLEAN` → `INTEGER`

Pass-through (no conversion needed):
- `CHECK` constraints — SQLite supports them natively
- Partial indexes (`WHERE ...`) — SQLite 3.9.0+ supports them
- Self-referencing FKs — inline syntax works on both backends with `PRAGMA defer_foreign_keys = ON`

### 2.4 Dependencies

- glob-based DDL file discovery (`server/store/postgresql/ddl/*.sql`, sorted alphabetically)
- better-sqlite3
- PRAGMA: `foreign_keys = ON`, `defer_foreign_keys = ON`

### 2.5 Verification Scenarios

- [ ] Glob discovers all DDL files in alphabetical order
- [ ] Type mappings are correct after conversion
- [ ] Converted SQL executes without error against in-memory SQLite DB
- [ ] FK enforcement works with deferred foreign keys

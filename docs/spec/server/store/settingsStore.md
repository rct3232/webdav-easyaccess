# settingsStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Global settings (e.g. `registration_enabled`). Stored as key-value rows in `postgresql`/`sqlite`. FsJSON/WebDAV file fallback removed in Phase 7. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/settingsStore.js`
- **Test file:** `server/store/__tests__/settingsStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| get | (key) => Promise\<*\> | Get value; undefined keys → null |
| set | (key, value) => Promise\<{ success }\> | Set (values stringified) |
| getAll | () => Promise\<object\> | All keys except updated_at |
| isRegistrationEnabled | () => Promise\<boolean\> | get('registration_enabled') === 'true' |

> **Removed in Phase 7:** `ensureSettingsFile` — FsJSON bootstrap file creation; settings are DB rows only.

### 2.3 Storage Paths

- None — settings are DB rows (`settings` table) only. FsJSON `/.wea/settings.json` removed in Phase 7.

### 2.4 PostgreSQL v2 Table Mapping

- Table: `settings(key, value, updated_at)`
- Constraints:
  - primary key (`key`)

### 2.5 Transaction Boundaries

- `set`: transactional upsert per key.
- `get`/`getAll`: read-only operations (outside explicit transaction unless called by upper-level transaction scope).

### 2.6 Dependencies

- storage (getBackend, withTransaction, getPgPool, isSqliteBackend, getSqliteConnection, withSqliteTransaction)

### 2.7 Verification Scenarios

- [ ] get returns value or null for unknown key
- [ ] set upserts by key
- [ ] isRegistrationEnabled true only when 'true' string
- [ ] PostgreSQL: set upserts by `key` and preserves latest value

# settingsStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Global settings (e.g. `registration_enabled`). Stored as single JSON file in `webdav`/`fs`, and as key-value rows in `postgresql`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/settingsStore.js`
- **Test file:** `server/store/__tests__/settingsStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| ensureSettingsFile | () => Promise\<void\> | Bootstrap file |
| get | (key) => Promise\<*\> | Get value; undefined keys → null |
| set | (key, value) => Promise\<{ success }\> | Set (values stringified) |
| getAll | () => Promise\<object\> | All keys except updated_at |
| isRegistrationEnabled | () => Promise\<boolean\> | get('registration_enabled') === 'true' |

### 2.3 Storage Paths

- `/.wea/settings.json` (initial: registration_enabled: 'false')

### 2.4 PostgreSQL v2 Table Mapping

- Table: `settings(key, value, updated_at)`
- Constraints:
  - primary key (`key`)

### 2.5 Transaction Boundaries

- `set`: transactional upsert per key.
- `get`/`getAll`: read-only operations (outside explicit transaction unless called by upper-level transaction scope).

### 2.6 Dependencies

- storage (ensureDir, exists, readFile, writeFile)
- metaPaths (SETTINGS_PATH, META_ROOT)
- locks.withLock for set

### 2.7 Verification Scenarios

- [ ] get returns value or null for unknown key
- [ ] set updates file; lock prevents concurrent writes
- [ ] Corrupt file → reset to fallback (registration_enabled: 'false')
- [ ] isRegistrationEnabled true only when 'true' string
- [ ] PostgreSQL: set upserts by `key` and preserves latest value

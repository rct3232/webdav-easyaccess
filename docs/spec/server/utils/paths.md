# paths Spec

## 1. Overview

| Item | Description                                  |
| ---- | -------------------------------------------- |
| Role | Path resolution: getProjectRoot, getDataDir. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/paths.js`
- **Test file:** none (verified via consumers)

### 2.2 Functions / Exports

| Function       | Signature    | Description               |
| -------------- | ------------ | ------------------------- |
| getProjectRoot | () => string | Resolve \_\_dirname/../.. |
| getDataDir     | () => string | data/ under project root  |

Note: `getThumbnailDir` and `getDatabasePath` were retired (dead-code cleanup
2026-09) — thumbnails are held in the in-memory `CacheAdapter` (no on-disk dir) and
the SQLite DB path is resolved inside `store/storage.js`, so these helpers had no
remaining caller.

### 2.3 Input / Output

- All return absolute paths (path.resolve)

### 2.4 Dependencies

- path

### 2.5 Mock Targets

- \_\_dirname (or path.resolve)

### 2.6 Verification Scenarios

- [ ] Paths resolve correctly

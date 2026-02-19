# paths Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Path resolution: getProjectRoot, getDataDir, getThumbnailDir, getDatabasePath. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/paths.js`
- **Test file:** `server/utils/__tests__/paths.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| getProjectRoot | () => string | Resolve __dirname/../.. |
| getDataDir | () => string | data/ under project root |
| getThumbnailDir | () => string | data/thumbnails |
| getDatabasePath | () => string | data/database.sqlite |

### 2.3 Input / Output

- All return absolute paths (path.resolve)

### 2.4 Dependencies

- path

### 2.5 Mock Targets

- __dirname (or path.resolve)

### 2.6 Verification Scenarios

- [ ] Paths resolve correctly
- [ ] Thumbnail dir under data

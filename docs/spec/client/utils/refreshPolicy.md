# refreshPolicy Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Decide whether to refresh the file list after an async operation completes, to avoid stale-closure refreshes after user navigates elsewhere. Supports move/copy (refresh if on target) and other ops (refresh only if still on started path). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/refreshPolicy.js`
- **Test file:** `client/src/utils/__tests__/refreshPolicy.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| shouldRefreshAfterOperation | ({ opType, startedPath, currentPathNow, targetPath }) => boolean |

### 2.3 Dependencies

- pathUtils.normalizePath (for path comparison)

### 2.4 Rules

- **move/copy:** refresh if `currentPathNow === startedPath` OR `currentPathNow === targetPath`
- **other ops (delete, etc.):** refresh only if `currentPathNow === startedPath`
- Paths are normalized before comparison

### 2.5 Verification Scenarios

- [ ] move: same path → true; navigated to target → true; navigated elsewhere → false
- [ ] copy: same behavior as move
- [ ] delete/refresh: same path → true; navigated away → false
- [ ] targetPath null for move/copy → no target match

### 2.6 Edge Cases

- opType null/undefined → treated as 'refresh'
- Empty paths normalized consistently

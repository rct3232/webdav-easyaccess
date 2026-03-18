# refreshPolicy Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Decide whether to refresh the current directory listing after an async operation completes, preventing stale-closure refreshes when the user navigates elsewhere. Used by command orchestration (see `docs/spec/client/hooks/useExplorerCommands.md`). Move/copy can refresh when the user is on either started path or target path; other ops refresh only when still on the started path. |

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

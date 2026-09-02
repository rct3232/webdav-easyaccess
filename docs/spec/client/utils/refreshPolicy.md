# refreshPolicy Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Decide whether to refresh the current directory listing after an async operation completes, preventing stale-closure refreshes when the user navigates elsewhere. Used by command orchestration (see `docs/spec/client/hooks/useExplorerCommands.md`). Move/copy can refresh when the user is on either the started nodeId or target nodeId; other ops refresh only when still on the started nodeId. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/refreshPolicy.js`
- **Test file:** `client/src/utils/__tests__/refreshPolicy.test.js`

### 2.2 Function Signatures

| Function                    | (input) => return                                                      |
| --------------------------- | ---------------------------------------------------------------------- |
| shouldRefreshAfterOperation | ({ opType, startedNodeId, currentNodeIdNow, targetNodeId }) => boolean |

> **Note (pending implementation):** The current source still accepts `startedPath` / `currentPathNow` / `targetPath` and normalizes via `pathUtils.normalizePath`; the nodeId rename is the end-state.

### 2.3 Dependencies

- None (nodeIds compare by identity; no path normalization)

### 2.4 Rules

- **move/copy:** refresh if `currentNodeIdNow === startedNodeId` OR `currentNodeIdNow === targetNodeId`
- **other ops (delete, etc.):** refresh only if `currentNodeIdNow === startedNodeId`
- NodeIds are compared by identity

### 2.5 Verification Scenarios

- [ ] move: same nodeId → true; navigated to target nodeId → true; navigated elsewhere → false
- [ ] copy: same behavior as move
- [ ] delete/refresh: same nodeId → true; navigated away → false
- [ ] targetNodeId null for move/copy → no target match

### 2.6 Edge Cases

- opType null/undefined → treated as 'refresh'
- null/undefined nodeIds handled consistently (no accidental equality match unless both values are identical)

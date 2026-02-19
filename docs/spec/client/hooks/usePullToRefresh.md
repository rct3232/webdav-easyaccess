# usePullToRefresh Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pull-to-refresh gesture: touch handlers, pullDistance, isRefreshing. Calls onRefresh when threshold exceeded. Uses scrollContainerRef for scroll position. |
| Used by components/pages | FileManager (mobile) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/usePullToRefresh.js`
- **Test file:** `client/src/hooks/__tests__/usePullToRefresh.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| onRefresh | function | Y | Refresh callback |
| options | object | N | threshold (80), maxPullDistance (120), scrollContainerRef, onRefreshComplete |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| pullDistance | number | Pull distance |
| isPulling | boolean | Pulling |
| isRefreshing | boolean | Refreshing |
| canPull | boolean | At top |
| pullHandlers | object | Touch handlers |
| resetPull | () => void | Reset |

### 2.4 Dependencies

- None (touch events)

### 2.5 Side Effects

- Touch event listeners
- Scroll listener for canPull
- onRefresh (async)

### 2.6 Error Handling

- None

### 2.7 Verification Scenarios

- [ ] pullDistance updates on touch move
- [ ] onRefresh when threshold exceeded
- [ ] canPull when scrollTop <= 1
- [ ] resetPull

### 2.8 Edge Cases

- scrollContainerRef required
- showRefreshSuccess: no reset during success display

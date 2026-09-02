# useExplorerRefreshIndicator Spec

## 1. Overview

| Item                     | Description                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Role                     | Explorer presentation controller for mobile pull-to-refresh and refresh-success indicator state used by FileManager. |
| Used by components/pages | `client/src/pages/FileManager/FileManager.js`                                                                        |
| Does not own             | File listing itself, generic explorer commands, or share-link overlay policy.                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerRefreshIndicator.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerRefreshIndicator.test.js`

### 2.2 Input Parameters

`useExplorerRefreshIndicator(params)`

| Name               | Type                        | Required | Description                                                             |
| ------------------ | --------------------------- | -------- | ----------------------------------------------------------------------- |
| isMobile           | boolean                     | Y        | Whether mobile pull-to-refresh should be active.                        |
| loading            | boolean                     | Y        | Current FileManager loading state; used to preserve indicator behavior. |
| loadFiles          | () => void \| Promise<void> | Y        | Refresh entry point used by pull-to-refresh.                            |
| scrollContainerRef | React.RefObject             | Y        | Scroll container used by `usePullToRefresh`.                            |
| t                  | function                    | Y        | Translation function.                                                   |

### 2.3 Return Value / State

| Key                   | Type       | Meaning                                                                                          |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| pullDistance          | number     | Current pull distance from `usePullToRefresh`.                                                   |
| isPulling             | boolean    | Whether the user is currently pulling.                                                           |
| isRefreshing          | boolean    | Whether a refresh is currently running.                                                          |
| threshold             | number     | Pull threshold for triggering refresh.                                                           |
| showRefreshSuccess    | boolean    | Whether the success indicator is visible.                                                        |
| handleLoadComplete    | () => void | Callback for list-load completion to show success indicator when appropriate.                    |
| handleRefreshComplete | () => void | Callback for pull-to-refresh completion to show success indicator and reset pull state.          |
| indicatorStyles       | object     | Prepared styles for the indicator container.                                                     |
| iconStyles            | object     | Prepared styles for the indicator icon.                                                          |
| progress              | number     | Current normalized pull progress in the `0..1` range.                                            |
| progressColor         | string     | Current indicator progress color token.                                                          |
| textColor             | string     | Current indicator text color token.                                                              |
| textContent           | string     | Current translated status message.                                                               |
| shouldShowIndicator   | boolean    | Whether the indicator should currently be visible.                                               |
| isDeterminateProgress | boolean    | Whether the progress indicator should render determinate pull progress instead of loading state. |

### 2.4 Responsibilities

- **Owns**
  - Wiring `usePullToRefresh` into FileManager mobile explorer behavior.
  - Success-indicator timing, visibility, and visual state shaping.
  - View-ready styles/text for the pull-to-refresh indicator.
- **Does not own**
  - Actual file loading logic beyond invoking the provided `loadFiles`.
  - Any explorer command completion policy unrelated to refresh indicator presentation.

### 2.5 Dependencies

- `client/src/hooks/usePullToRefresh.js`
- Shell-owned `loadFiles` and `scrollContainerRef`

### 2.6 Side Effects

- Starts pull-to-refresh behavior only on mobile.
- Uses a timer to hide the success indicator after the configured duration.

### 2.7 Error Handling

- Refresh indicator state should not block or throw if the refresh callback fails; file-load errors remain owned by FileManager/useFileManager.

### 2.8 Verification Scenarios

These scenarios should be covered by a dedicated hook unit test in `client/src/pages/FileManager/hooks/__tests__/useExplorerRefreshIndicator.test.js`, not only by FileManager page regression tests.

- [ ] Mobile refresh completion shows the same success indicator and text as today.
- [ ] Desktop renders no active pull-to-refresh behavior.
- [ ] `handleLoadComplete` does not show a success indicator while a pull refresh is still marked refreshing.
- [ ] Indicator text/colors/styles follow the same observable states for pulling, release-to-refresh, loading, and success.

### 2.9 Edge Cases

- Non-mobile mode keeps the indicator inert.
- Repeated refresh completions clear the previous success timeout before starting a new one.

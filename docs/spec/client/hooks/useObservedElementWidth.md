# useObservedElementWidth Spec

## 1. Overview

| Item                     | Description                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Component-family hook that exposes a ref callback and the latest observed element width for width-sensitive rendering such as recent-file name truncation. |
| Used by components/pages | `RecentFilesSection` and other folder-tree/file-list views that need prepared width state                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

Choose the scope according to [CODING_STYLE.md § Hook Placement](../../../../CODING_STYLE.md):

| Scope            | Source path                                                          | Test path                                                                           |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Component-family | `client/src/components/folder-tree/hooks/useObservedElementWidth.js` | `client/src/components/folder-tree/hooks/__tests__/useObservedElementWidth.test.js` |

- **Source:** `client/src/components/folder-tree/hooks/useObservedElementWidth.js`
- **Test file:** `client/src/components/folder-tree/hooks/__tests__/useObservedElementWidth.test.js`

### 2.2 Input Parameters

| Name           | Type     | Required | Description                                                                  |
| -------------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `initialWidth` | `number` | N        | Width used before observation starts; defaults to a safe truncation baseline |

### 2.3 Return Value / State

| Key                  | Type               | Meaning                       |
| -------------------- | ------------------ | ----------------------------- | ----------------------------------------------------------- |
| `setObservedElement` | `(element: Element | null) => void`                | Ref callback for the element whose width should be observed |
| `width`              | `number`           | Latest observed element width |

### 2.4 Dependencies

- Services called: `resizeObserverAdapter`
- Other hooks: React state/effect hooks only

### 2.5 Side Effects

- Starts observing when a non-null element is attached through the returned ref callback
- Stops observing on ref changes and unmount

### 2.6 Error Handling

- Missing element or missing `ResizeObserver` should not throw; the hook should keep the last known width or the initial width

### 2.7 Verification Scenarios

Checklist for unit tests with renderHook:

- [ ] Returns the initial width before an element is attached
- [ ] Updates width when the adapter reports a new width
- [ ] Disconnects the previous observer when the observed element changes or unmounts

### 2.8 Edge Cases

- `null` ref callback input
- Reattaching the same element
- Observer unavailable in the test/runtime environment

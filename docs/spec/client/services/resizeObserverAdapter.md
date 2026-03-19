# resizeObserverAdapter Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Browser adapter that observes element size changes and reports width updates through a narrow callback interface. Owns direct `ResizeObserver` access. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/resizeObserverAdapter.js`
- **Test file:** `client/src/services/__tests__/resizeObserverAdapter.test.js`

### 2.2 Main Functions

| Function | Input | Return | API called (see api.md) |
|----------|-------|--------|-------------------------|
| `observeElementWidth` | `(element: Element, onWidthChange: (width: number) => void)` | `() => void` cleanup | None; browser adapter only |

### 2.3 Error Handling

- If `element` is missing, the adapter should return a no-op cleanup function.
- If `ResizeObserver` is unavailable, the adapter should report the current width once when possible and return a no-op cleanup function.

### 2.4 Verification Scenarios

For unit tests: verify callback and cleanup behavior with mocked observer implementations.

- [ ] Reports width changes from observer entries
- [ ] Falls back safely when `ResizeObserver` is unavailable
- [ ] Returned cleanup disconnects the observer only once

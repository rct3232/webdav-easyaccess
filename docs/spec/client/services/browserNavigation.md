# browserNavigation Spec

## 1. Overview

| Item | Description                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| Role | Browser adapter for opening share links or other URLs in a new tab/window behind a small replaceable function boundary. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/browserNavigation.js`
- **Test file:** `client/src/services/__tests__/browserNavigation.test.js`

### 2.2 Main Functions

| Function          | Input           | Return | API called (see api.md)    |
| ----------------- | --------------- | ------ | -------------------------- |
| `openUrlInNewTab` | `(url: string)` | `void` | None; browser adapter only |

### 2.3 Error Handling

- No server/API error handling. Invalid or blocked browser-open behavior should surface naturally to the caller without swallowing exceptions.
- Callers remain responsible for any user-facing messaging around the related workflow.

### 2.4 Verification Scenarios

For unit tests: verify observable adapter delegation with a mocked opener function.

- [ ] Opens the provided URL in a new tab/window with `noopener,noreferrer`
- [ ] Allows callers/tests to provide a mocked opener instead of relying on a real browser global

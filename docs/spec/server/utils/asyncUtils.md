# asyncUtils Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Async helpers: asyncLimit, asyncLimitSettled (concurrency limit), asyncLimitSettledWithCancel (cancelable). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/asyncUtils.js`
- **Test file:** `server/utils/__tests__/asyncUtils.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| asyncLimit | (limit, items, fn) => Promise\<Array\> | Run fn for each item with concurrency limit |
| asyncLimitSettled | (limit, items, fn) => Promise\<Array\> | Like allSettled with limit |
| asyncLimitSettledWithCancel | (limit, items, fn, getCancelFlag) => Promise\<Array\> | Like asyncLimitSettled, stops when getCancelFlag() true |

### 2.3 Input / Output

- asyncLimit: results in order
- asyncLimitSettled: { status, value } or { status, reason }

### 2.4 Dependencies

- None

### 2.5 Mock Targets

- None

### 2.6 Verification Scenarios

- [ ] asyncLimit respects concurrency
- [ ] asyncLimitSettled returns settled results
- [ ] asyncLimitSettledWithCancel stops when getCancelFlag returns true

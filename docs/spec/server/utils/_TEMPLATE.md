# [utilName] Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | (e.g. errorHandler = error JSON formatting) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/[utilName].js`
- **Test file:** `server/utils/__tests__/[utilName].test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| formatErrorResponse | (err) => object | ... |
| createError | (...) => Error | ... |
| etc. | | |

### 2.3 Input / Output

- Compliant with shared-contracts
- Error body format (errorCode, params, details)

### 2.4 Dependencies

- SERVER_ERROR_CODES, NODE_ENV, etc.

### 2.5 Mock Targets

- console.error, etc. (mock in tests)

### 2.6 Verification Scenarios

For unit tests:

- [ ] err.status reflected
- [ ] details included based on NODE_ENV
- [ ] errorCode, params format
- [ ] Other cases

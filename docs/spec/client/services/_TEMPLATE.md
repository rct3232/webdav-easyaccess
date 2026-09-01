# [serviceName] Spec

## 1. Overview

| Item | Description                                        |
| ---- | -------------------------------------------------- |
| Role | (e.g. fileService = file CRUD and bulk operations) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/[serviceName].js`
- **Test file:** `client/src/services/__tests__/[serviceName].test.js`

### 2.2 Main Functions

| Function | Input    | Return        | API called (see api.md) |
| -------- | -------- | ------------- | ----------------------- |
| (fn)     | (params) | (return type) | METHOD /api/path        |

### 2.3 Error Handling

- errorCode mapping (see shared-contracts, errorUtils)
- How errors are displayed on the client

### 2.4 Verification Scenarios

For unit tests: verify calls and responses after MSW mocking

- [ ] Response format on success
- [ ] errorCode and params on error
- [ ] Request body/query verification

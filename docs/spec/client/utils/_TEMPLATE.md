# [utilName] Spec

## 1. Overview

| Item | Description                                                  |
| ---- | ------------------------------------------------------------ |
| Role | (Util's role, e.g. path normalization, file icon resolution) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/[utilName].js`
- **Test file:** `client/src/utils/__tests__/[utilName].test.js`

### 2.2 Function Signatures

| Function | (input) => return   |
| -------- | ------------------- |
| (fn)     | (input) => (output) |

### 2.3 Dependencies

- shared package, i18n, etc.

### 2.4 Verification Scenarios

For unit tests: verify output for each input

- [ ] Valid input
- [ ] Empty input / boundary values
- [ ] Behavior on invalid input

# asyncUtils Spec

## 1. Overview

| Item | Description                                         |
| ---- | ----------------------------------------------------- |
| Role | Async helpers: asyncLimit (concurrency-limited map). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/asyncUtils.js`
- **Test file:** none (verified via consumers)

### 2.2 Functions / Exports

| Function   | Signature                              | Description                                   |
| ---------- | -------------------------------------- | --------------------------------------------- |
| asyncLimit | (limit, items, fn) => Promise\<Array\> | Run fn for each item with concurrency limit   |

Note: `asyncLimitSettled` and `asyncLimitSettledWithCancel` were retired (dead-code
cleanup 2026-09) — no production caller remained; cancellation-aware batching uses
service-local loops.

### 2.3 Input / Output

- asyncLimit: results in order

### 2.4 Dependencies

- None

### 2.5 Mock Targets

- None

### 2.6 Verification Scenarios

- [ ] asyncLimit respects concurrency

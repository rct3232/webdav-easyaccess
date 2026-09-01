# Settings Model Spec

## 1. Overview

| Item | Description                                                                               |
| ---- | ----------------------------------------------------------------------------------------- |
| Role | Settings model: get, set, getAll, isRegistrationEnabled. Thin wrapper over settingsStore. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/models/Settings.js`
- **Test file:** `server/models/__tests__/Settings.test.js`

### 2.2 Static Methods

| Method                | Signature                         | Description                         |
| --------------------- | --------------------------------- | ----------------------------------- |
| get                   | (key) => Promise\<\*\>            | settingsStore.get                   |
| set                   | (key, value) => Promise\<object\> | settingsStore.set                   |
| getAll                | () => Promise\<object\>           | settingsStore.getAll                |
| isRegistrationEnabled | () => Promise\<boolean\>          | settingsStore.isRegistrationEnabled |

### 2.3 Dependencies

- settingsStore

### 2.4 Verification Scenarios

- [ ] All methods delegate to store; mock store and assert calls

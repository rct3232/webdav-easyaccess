# [ModelName] Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | (User, Permission, etc. model role) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/models/[ModelName].js`
- **Test file:** `server/models/__tests__/[ModelName].test.js`

### 2.2 Static Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| (method) | (params) => return | (description) |

### 2.3 Dependencies

- (Store: userStore, permissionStore, etc.)

### 2.4 Verification Scenarios

- [ ] Delegate to store correctly
- [ ] Mock store, assert calls

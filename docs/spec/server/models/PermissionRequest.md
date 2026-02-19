# PermissionRequest Model Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission request model: ensureFile, create, findById, listInbox, listOutbox, updateStatus, deleteByRequesterId, rejectByOwnerId. Thin wrapper over permissionRequestStore. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/models/PermissionRequest.js`
- **Test file:** `server/models/__tests__/PermissionRequest.test.js`

### 2.2 Static Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| ensureFile | () => Promise\<void\> | permissionRequestStore.ensurePermissionRequestsFile |
| create | (payload) => Promise\<object\> | permissionRequestStore.createRequest |
| findById | (id) => Promise\<object \| null\> | permissionRequestStore.getById |
| listInbox | (ownerId, opts) => Promise\<Array\> | permissionRequestStore.listInbox |
| listOutbox | (requesterId, opts) => Promise\<Array\> | permissionRequestStore.listOutbox |
| updateStatus | (id, opts) => Promise\<object\> | permissionRequestStore.updateStatus |
| deleteByRequesterId | (userId) => Promise\<object\> | permissionRequestStore.deleteByRequesterId |
| rejectByOwnerId | (userId, resolvedBy?) => Promise\<object\> | permissionRequestStore.rejectByOwnerId |

### 2.3 Dependencies

- permissionRequestStore

### 2.4 Verification Scenarios

- [ ] All methods delegate to store; mock store and assert calls

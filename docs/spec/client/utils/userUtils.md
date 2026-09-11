# userUtils Spec

## 1. Overview

| Item | Description                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| Role | User-related utilities: base folder path, filter out own folders from permissions list.                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/userUtils.js`
- **Test file:** `client/src/utils/__tests__/userUtils.test.js`

### 2.2 Function Signatures

| Function                | (input) => return                   |
| ----------------------- | ----------------------------------- |
| getUserBaseFolder       | (user) => string (e.g. '/username') |
| filterOutUserOwnFolders | (permissions, user) => Array        |

Module-private helper: `isUserOwnFolder(nodeId, user)` (used by `filterOutUserOwnFolders`).

### 2.3 Dependencies

- pathUtils.normalizePath

### 2.4 Verification Scenarios

- [ ] getUserBaseFolder({ username: 'x' }) → '/x'
- [ ] filterOutUserOwnFolders removes entries where nodeId === user.rootNodeId

### 2.5 Edge Cases

- user null → getUserBaseFolder '/'

### 2.6 Ownership filter boundary

- `isUserOwnFolder` / `filterOutUserOwnFolders` are a **client-side root-level safety net** only (`nodeId === user.rootNodeId`). The client cannot resolve full tree ancestry, so it cannot detect descendants of the user's home root.
- The authoritative "is this my own folder" exclusion (home root **and** all descendants) is performed server-side by `GET /api/permissions/shared` via the closure table (see [permissions.md](../../../features/permissions.md#shared-with-me-listing-semantics)).

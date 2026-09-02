# userUtils Spec

## 1. Overview

| Item | Description                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | User-related utilities: base folder path, ownership check, filter out own folders from permissions, filter display users (ShareFolderTree, UserSelectionMenu), display name. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/userUtils.js`
- **Test file:** `client/src/utils/__tests__/userUtils.test.js`

### 2.2 Function Signatures

| Function                | (input) => return                   |
| ----------------------- | ----------------------------------- |
| getUserBaseFolder       | (user) => string (e.g. '/username') |
| isUserOwnFolder         | (path, user) => boolean             |
| filterOutUserOwnFolders | (permissions, user) => Array        |
| filterDisplayUsers      | (users, options) => Array           |
| getUserDisplayName      | (user) => string                    |

### 2.3 filterDisplayUsers Options

- `isAdminMode` – return only currentUserId
- `currentUserId` – for admin mode
- `user` – current user (excluded from list)
- `userInfoMap` – Map<userId, { is_admin }>
- `allUsers` – full user objects for is_admin check

### 2.4 Dependencies

- pathUtils.normalizePath

### 2.5 Verification Scenarios

- [ ] getUserBaseFolder({ username: 'x' }) → '/x'
- [ ] isUserOwnFolder('/x/y', { username: 'x' }) → true; '/other/y' → false
- [ ] filterOutUserOwnFolders removes entries where nodeId === user.rootNodeId
- [ ] filterDisplayUsers: excludes self and admins (unless isAdminMode)
- [ ] getUserDisplayName: username || email || id || ''

### 2.6 Edge Cases

- user null → getUserBaseFolder '/'; isUserOwnFolder false; getUserDisplayName ''
- isAdminMode true → single user (currentUserId)

### 2.7 Ownership filter boundary

- `isUserOwnFolder` / `filterOutUserOwnFolders` are a **client-side root-level safety net** only (`nodeId === user.rootNodeId`). The client cannot resolve full tree ancestry, so it cannot detect descendants of the user's home root.
- The authoritative "is this my own folder" exclusion (home root **and** all descendants) is performed server-side by `GET /api/permissions/shared` via the closure table (see [permissions.md](../../../features/permissions.md#shared-with-me-listing-semantics)).

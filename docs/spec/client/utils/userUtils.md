# userUtils Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User-related utilities: base folder path, ownership check, filter out own folders from permissions, filter display users (ShareFolderTree, UserSelectionMenu), display name. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/userUtils.js`
- **Test file:** `client/src/utils/__tests__/userUtils.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| getUserBaseFolder | (user) => string (e.g. '/username') |
| isUserOwnFolder | (path, user) => boolean |
| filterOutUserOwnFolders | (permissions, user) => Array |
| filterDisplayUsers | (users, options) => Array |
| getUserDisplayName | (user) => string |

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
- [ ] filterOutUserOwnFolders removes entries where folder is user's
- [ ] filterDisplayUsers: excludes self and admins (unless isAdminMode)
- [ ] getUserDisplayName: username || email || id || ''

### 2.6 Edge Cases

- user null → getUserBaseFolder '/'; isUserOwnFolder false; getUserDisplayName ''
- isAdminMode true → single user (currentUserId)

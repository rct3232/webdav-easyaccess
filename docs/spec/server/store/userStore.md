# userStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User persistence: CRUD users, index by id/username/email. Stored under /.wea/users/ as JSON. Uses email hash index for lookup. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/userStore.js`
- **Test file:** `server/store/__tests__/userStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| findByUsername | (username) => Promise\<object \| undefined\> | Lookup by username |
| findByEmail | (email) => Promise\<object \| undefined\> | Lookup via email hash index |
| findById | (id) => Promise\<object \| undefined\> | Lookup via index.byId |
| findAll | () => Promise\<Array\> | All users, sorted by created_at desc |
| findByStatus | (status) => Promise\<Array\> | Filter by status |
| createUser | ({ username, email, passwordHash, isAdmin }) => Promise\<object\> | Create user; throws on duplicate username/email |
| updateStatus | (userId, status) => Promise\<{ success }\> | Update user status |
| updateEmail | (userId, newEmail) => Promise\<{ success }\> | Update email, reindex |
| updatePassword | (userId, passwordHash) => Promise\<{ success }\> | Update password, bump token_version |
| deleteUser | (userId) => Promise\<{ success }\> | Remove user and email index |
| ensureUserIndexFile | () => Promise\<void\> | Bootstrap index |

### 2.3 Storage Paths

- Index: `/.wea/users/_index.json` (nextId, byId, byUsername)
- User files: `/.wea/users/{username}.json`
- Email index: `/.wea/index/email/{sha256(email)}.txt` → username

### 2.4 Dependencies

- storage (ensureDir, exists, readFile, writeFile, deletePath, listDir)
- metaPaths (META_ROOT, USERS_DIR, USERS_INDEX_PATH, userPathByUsername, emailIndexPathByEmailHash, sha256HexLower)
- locks.withLock
- errorHandler.createError, SERVER_ERROR_CODES

### 2.5 Verification Scenarios

- [ ] createUser returns user; duplicate username/email throws 409
- [ ] findByUsername, findByEmail, findById return user or undefined
- [ ] findAll returns array sorted by created_at desc
- [ ] updateStatus, updateEmail, updatePassword, deleteUser mutate correctly
- [ ] Corrupt index → reset and write fallback

# User Model Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User model: create, lookup (username/email/id), update status/email/password, delete. Password hashing via bcrypt. Does not expose password in findById/findAll/findByStatus. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/models/User.js`
- **Test file:** `server/models/__tests__/User.test.js`

### 2.2 Static Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| create | (username, email, password, isAdmin?) => Promise\<object\> | Hash password, userStore.createUser |
| findByUsername | (username) => Promise\<object \| undefined\> | userStore.findByUsername |
| findByEmail | (email) => Promise\<object \| undefined\> | userStore.findByEmail |
| findById | (id) => Promise\<object \| undefined\> | userStore.findById; strips password |
| findAll | () => Promise\<Array\> | userStore.findAll; strips password |
| findByStatus | (status) => Promise\<Array\> | userStore.findByStatus; strips password |
| updateStatus | (userId, status) => Promise\<object\> | userStore.updateStatus |
| updateEmail | (userId, newEmail) => Promise\<object\> | userStore.updateEmail |
| delete | (userId) => Promise\<object\> | userStore.deleteUser |
| verifyPassword | (user, password) => Promise\<boolean\> | bcrypt.compare; **user must include `password` field** (e.g. from findByUsername; findById strips it) |
| updatePassword | (userId, newPassword) => Promise\<object\> | Hash, userStore.updatePassword |

### 2.3 Dependencies

- userStore
- bcryptjs (hash, compare)

### 2.4 Verification Scenarios

- [ ] create returns user without password
- [ ] findById/findAll/findByStatus never expose password
- [ ] verifyPassword returns true for correct password (user from findByUsername has password hash)
- [ ] updatePassword hashes and stores new hash

### 2.5 verifyPassword Usage Note

`verifyPassword(user, password)` expects `user` to contain the `password` (hash) field. Use `User.findByUsername` or `userStore.findByUsername` for login flows; `User.findById` / `findAll` / `findByStatus` strip the password field.

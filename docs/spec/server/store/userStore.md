# userStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User persistence: CRUD users and identity lookups by id/username/email. Uses the normalized `users` table in `postgresql`/`sqlite` backends. FsJSON file/index storage removed in Phase 7. |

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

### 2.3 Storage Paths

- None — users are DB rows (`users` table) only. FsJSON `/.wea/users/*` and `/.wea/index/email/*` removed in Phase 7.

### 2.4 PostgreSQL v2 Table Mapping

- Table: `users`
- Key columns: `id`, `username`, `email`, `email_hash`, `password`, `status`, `is_admin`, `token_version`, `created_at`, `updated_at`
- Constraints:
  - unique (`username`)
  - unique (`email`)
  - unique (`email_hash`)
  - status check (`pending|approved|rejected`)

### 2.5 Transaction Boundaries

- `createUser`: single transaction for insert and uniqueness-safe writes.
- `updateEmail`: single transaction for email + email_hash consistency.
- `deleteUser`: single transaction for user deletion and related metadata cleanup.
- `updatePassword`/`updateStatus`: atomic single-row updates (transactional by default).

### 2.6 Dependencies

- PostgresqlMetadataAdapter / SqliteMetadataAdapter (via store adapter)
- errorHandler.createError, SERVER_ERROR_CODES

### 2.7 Verification Scenarios

- [ ] createUser returns user; duplicate username/email throws 409
- [ ] findByUsername, findByEmail, findById return user or undefined
- [ ] findAll returns array sorted by created_at desc
- [ ] updateStatus, updateEmail, updatePassword, deleteUser mutate correctly
- [ ] PostgreSQL: unique constraint violations map to duplicate username/email errors
- [ ] PostgreSQL: updateEmail persists canonical email + email_hash in same transaction

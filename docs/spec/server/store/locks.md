# locks Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Distributed metadata lock abstraction for all backends. Uses lock rows for `postgresql` and `sqlite`, with TTL-based stale recovery and ownership-safe release. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/locks.js`
- **Test file:** `server/store/__tests__/locks.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| acquireLock | (lockName, options?) => Promise\<{ token, lockPath, release }\> | Acquire backend-specific lock. `postgresql`/`sqlite`: retries on PK conflict with stale row cleanup (`expires_at < NOW()`). |
| withLock | (lockName, fn, options?) => Promise\<T\> | Acquire, run fn, release in `finally` for both success and error paths. |

### 2.3 Options

- ttlMs (default 30000)
- waitMs (default 30000) – timeout for acquire
- retryDelayMs (default 250)
- owner – debug identifier

### 2.4 Backend Strategy

#### `postgresql`

- Table: `locks(lock_name_hash, token, owner, created_at, expires_at)`
- Acquire attempt:
  - First run TTL cleanup for this key: delete row where `lock_name_hash` matches and `expires_at < NOW()`
  - Try `INSERT` with `(lock_name_hash, token, owner, NOW(), NOW() + ttl interval)`
  - On unique conflict, wait/retry until `waitMs` deadline
- Release:
  - Delete only when both `lock_name_hash` and `token` match (ownership-safe release)
  - Repeated release is no-op (0-row delete)

### 2.5 Dependencies

- storage (getBackend, getPgPool, sqliteRun, withSqliteTransaction)
- hash (sha256HexLower)
- crypto (randomUUID)
- storage.getBackend / storage.getPgPool for backend selection and PostgreSQL queries

### 2.6 Verification Scenarios

- [ ] acquireLock returns release function
- [ ] Stale lock (expired) → delete and retry
- [ ] waitMs exceeded → LOCK_TIMEOUT error
- [ ] withLock runs fn and releases on success and on throw
- [ ] release checks token ownership before delete
- [ ] release 재호출 시 안전 동작(no-op)
- [ ] postgresql: stale row cleanup (`expires_at < now`) runs before insert retry
- [ ] postgresql: release only removes row when token matches
- [ ] postgresql: concurrent contenders enforce single-owner lock semantics and loser timeout behavior

### 2.7 Edge Cases

- release() 호출 후 재호출: no-op 또는 경고 로그; deletePath 이미 됐으면 에러 없음
- withLock 내부에서 동일 lockName으로 withLock 재호출: deadlock 가능; 지원 안 함. 문서화만.

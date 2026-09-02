# locks Spec

## 1. Overview

| Item | Description                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Distributed metadata lock abstraction for all backends. Uses lock rows for `postgresql` and `sqlite`, with TTL-based stale recovery and ownership-safe release. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/locks.js` is a **1-line re-export** of `server/infrastructure/lockManager.js` — that module holds the implementation (`acquireLock`/`withLock`, exports at lockManager.js:175-178)
- **Test file:** `server/store/__tests__/locks.test.js`

### 2.2 Main Methods

| Method      | Signature                                                       | Description                                                                                                                 |
| ----------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| acquireLock | (lockName, options?) => Promise\<{ token, release }\>           | Acquire a lock row on the active DB backend. `postgresql`: stale-row cleanup then `INSERT ... ON CONFLICT (lock_name_hash) DO NOTHING`; `sqlite`: stale-row cleanup then INSERT-or-fail inside a transaction. Retries until the `waitMs` deadline, then throws `LOCK_TIMEOUT`. |
| withLock    | (lockName, fn, options?) => Promise\<T\>                        | Acquire, run fn, release in `finally` for both success and error paths.                                                     |

### 2.3 Options

- ttlMs (default 30000)
- waitMs (default 30000) – timeout for acquire
- retryDelayMs (default 250)
- owner – debug identifier (default `"${hostname}:${pid}"`; `HOSTNAME` read via `getSharedResolver().getConfigSync('HOSTNAME')`, lockManager.js:148-149)

### 2.4 Backend Strategy

Locks are **DB rows in a `locks` table** — there is no lock-file (`lockPath`) storage.

#### `postgresql`

- Table: `locks(lock_name_hash, token, owner, created_at, expires_at)`
- Acquire attempt:
  - First run TTL cleanup for this key: delete row where `lock_name_hash` matches and `expires_at < NOW()`
  - `INSERT INTO locks (lock_name_hash, token, owner, created_at, expires_at) VALUES (...) ON CONFLICT (lock_name_hash) DO NOTHING RETURNING lock_name_hash` (lockManager.js:66-72)
  - On conflict (row not returned), wait/retry until `waitMs` deadline
- Success returns `{ token, release }` where `release` deletes only when both `lock_name_hash` and `token` match (ownership-safe; idempotent via an internal `released` guard, lockManager.js:24-40)

### 2.5 Dependencies

- storage (`getBackend`, `getPgPool`, `isSqliteBackend`, `withSqliteTransaction`, `sqliteRun`)
- `server/utils/hash` (`sha256HexLower`) — lock name → `lock_name_hash`
- `server/infrastructure/configResolver` (`getSharedResolver`) — `HOSTNAME` for the default owner label
- crypto (`randomUUID`) — owner token

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

- release() 호출 후 재호출: no-op (`released` 가드, lockManager.js:24-28); 소유자 토큰 불일치 시 해당 행은 삭제되지 않음
- withLock 내부에서 동일 lockName으로 withLock 재호출: deadlock 가능; 지원 안 함. 문서화만.

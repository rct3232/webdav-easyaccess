# locks Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Distributed lock via WebDAV conditional PUT (If-None-Match: *). Lock file under /.wea/locks/{sha256(lockName)}.lock. TTL for stale recovery. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/locks.js`
- **Test file:** `server/store/__tests__/locks.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| acquireLock | (lockName, options?) => Promise\<{ token, lockPath, release }\> | Acquire; retries on 412/409; releases stale expired lock |
| withLock | (lockName, fn, options?) => Promise\<T\> | Acquire, run fn, release in finally |

### 2.3 Options

- ttlMs (default 30000)
- waitMs (default 30000) – timeout for acquire
- retryDelayMs (default 250)
- owner – debug identifier

### 2.4 Lock File

- JSON: { token, owner, createdAt, expiresAt }
- Stale: expiresAt < now → delete and retry

### 2.5 Dependencies

- storage (ensureDir, writeFile, readFile, deletePath)
- metaPaths (LOCKS_DIR, lockPathByKey, sha256HexLower)
- crypto (randomUUID)

### 2.6 Verification Scenarios

- [ ] acquireLock returns release function; 412/409 triggers retry
- [ ] Stale lock (expired) → delete and retry
- [ ] waitMs exceeded → LOCK_TIMEOUT error
- [ ] withLock runs fn and releases on success and on throw
- [ ] release checks token ownership before delete
- [ ] release 재호출 시 안전 동작(no-op)

### 2.7 Edge Cases

- release() 호출 후 재호출: no-op 또는 경고 로그; deletePath 이미 됐으면 에러 없음
- withLock 내부에서 동일 lockName으로 withLock 재호출: deadlock 가능; 지원 안 함. 문서화만.

# bulkJobStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | In-memory bulk job tracking (delete, move, copy). Jobs expire after JOB_TTL_MS (1 hour) when terminal (completed/cancelled/failed). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/bulkJobStore.js`
- **Test file:** `server/store/__tests__/bulkJobStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| createJob | (userId, operation, payload) => { jobId, job } | Create job; total from paths/moves/copies |
| getJob | (jobId) => object \| null | Get job; returns null if expired (and deletes) |
| setJobCancelled | (jobId) => boolean | Mark cancelled |
| updateJob | (jobId, updates) => void | Merge updates into job |

### 2.3 Job Shape

- jobId, userId, operation ('delete'|'move'|'copy'), payload, status, results, progress, total, cancelled, createdAt, errorMessage

### 2.4 Dependencies

- crypto (randomUUID or randomBytes for jobId)

### 2.5 Expiration

- Terminal status (completed, cancelled, failed) + age > JOB_TTL_MS → getJob returns null and deletes

### 2.6 Verification Scenarios

- [ ] createJob returns jobId and job; total computed from payload
- [ ] getJob returns job or null
- [ ] setJobCancelled marks job; returns false if not found
- [ ] updateJob merges fields
- [ ] Expired job → getJob returns null, job removed from Map

# migrationJobStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | In-memory, process-local job store for in-app blob-migration runs (admin API `POST /api/admin/migration/blobs`). Follows the pattern of `server/domains/files/stores/operationProgress.js`. Jobs expire ~60 minutes after reaching a terminal status. |
| Depends on | `crypto` (randomUUID for `jobId`) |
| Files | `server/domains/admin/stores/migrationJobStore.js` |
| Test files | `server/domains/admin/stores/__tests__/migrationJobStore.test.js` |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/stores/migrationJobStore.js`

### 2.2 Factory

| Export | Signature | Description |
|--------|-----------|-------------|
| `createMigrationJobStore` | () => instance | Creates a fresh in-memory job store (backed by a `Map`) |

### 2.3 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | (input) => job | Create a migration job in `pending` state; returns the job shape including `jobId` |
| `update` | (jobId, updates) => job \| null | Merge updates into the existing job; returns `null` if not found |
| `get` | (jobId) => job \| null | Get a job by ID; terminal jobs past TTL are treated as unknown (returns `null`) |
| `cancel` | (jobId) => boolean | Mark a non-terminal job `cancelled`; returns `false` if not found or already terminal |
| `isTerminal` | (jobId) => boolean | Whether the job is in a terminal status (`completed`, `failed`, `cancelled`) |

### 2.4 Job Shape

```js
{
  jobId: string,
  direction: 'webdav-to-s3' | 's3-to-webdav',
  mode: 'dry-run' | 'apply',
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
  progress: number,   // 0..1 or done/total ratio
  total: number,
  current: object,    // node currently being processed
  results: { copied: number, skipped: number, failed: number, errors: [] },
  errorMessage: string | null,
  createdAt: string,  // ISO timestamp
  completedAt: string | null,
}
```

### 2.5 TTL

| Constant | Value | Description |
|----------|-------|-------------|
| `MIGRATION_JOB_TTL_MS` | `3600000` (60 min) | Terminal jobs (`completed`, `failed`, `cancelled`) expire ~60 min after reaching terminal state; `get` returns `null` and deletes the entry. Non-terminal jobs are never expired. |

---

## 3. Verification Scenarios

- [ ] `create` returns a job with a unique `jobId` and status `pending`
- [ ] `update` merges fields (e.g. status, progress, results) into the job
- [ ] `get` returns the job or `null` for unknown/expired IDs
- [ ] `cancel` marks a running job `cancelled`; returns `false` for unknown or already-terminal jobs
- [ ] `isTerminal` is true only for `completed`, `failed`, `cancelled`
- [ ] Terminal job past TTL → `get` returns `null` and the entry is removed

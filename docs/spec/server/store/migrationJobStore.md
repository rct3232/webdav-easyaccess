# migrationJobStore Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | In-memory, process-local job store for in-app blob-migration runs (admin API `POST /api/admin/migration/blobs`) and metadata DB-migration runs (`POST /api/admin/migration/metadata`); both job types are driven through the same store by the admin migration routes. Follows the pattern of `server/domains/files/stores/operationProgress.js`. Jobs expire ~60 minutes after reaching a terminal status. |
| Depends on | `crypto` (randomUUID for `jobId`)                                                                                                                                                                                                                                                                                                                                                                           |
| Files      | `server/domains/admin/stores/migrationJobStore.js`                                                                                                                                                                                                                                                                                                                                                          |
| Test files | `server/domains/admin/stores/__tests__/migrationJobStore.test.js`                                                                                                                                                                                                                                                                                                                                           |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/stores/migrationJobStore.js`

### 2.2 Factory

| Export                    | Signature      | Description                                                                                                    |
| ------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `createMigrationJobStore` | () => instance | Memoized process-wide singleton (backed by a `Map`); repeated calls return the same instance, not a fresh one. |
| `setInstance`             | (instance)     | Test seam that replaces the memoized singleton instance.                                                       |
| `MigrationJobStore`       | class          | The store class (constructor initializes the `Map`); also exported for direct instantiation in tests.          |

### 2.3 Main Methods

| Method       | Signature                       | Description                                                                           |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------- |
| `create`     | (input) => job                  | Create a migration job in `pending` state; `type` defaults to `'blobs'` (`input.type  |     | 'blobs'`), so a metadata job is created with `type: 'metadata'`; returns the job shape including `jobId` |
| `update`     | (jobId, updates) => job \| null | Merge updates into the existing job; returns `null` if not found                      |
| `get`        | (jobId) => job \| null          | Get a job by ID; terminal jobs past TTL are treated as unknown (returns `null`)       |
| `cancel`     | (jobId) => boolean              | Mark a non-terminal job `cancelled`; returns `false` if not found or already terminal |
| `isTerminal` | (jobId) => boolean              | Whether the job is in a terminal status (`completed`, `failed`, `cancelled`)          |
| `hasRunning` | () => boolean                   | Whether any non-terminal job exists (used by the routes to reject concurrent runs)    |

### 2.4 Job Shape

```js
{
  jobId: string,
  type: 'blobs' | 'metadata',     // create() sets input.type || 'blobs'
  direction: 'webdav-to-s3' | 's3-to-webdav' | 'sqliteToPostgresql' | 'postgresqlToSqlite' | null,
  mode: 'dry-run' | 'apply',
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
  stage: 'scan' | 'schema' | 'wipe' | 'copy' | 'done' | null,   // metadata stages (or 'copy' for blob jobs)
  progress: number | { percent: number, currentLabel: string | null },
  total: number,
  current: string | null,   // current file path label for blob jobs (the blob worker writes a path string); null otherwise
  results: { copied: number, skipped: number, failed: number, errors: [] },
  errorMessage: string | null,
  configPersist: { persisted: string[], skippedEnvSourced: string[] } | null,
  createdAt: string,  // ISO timestamp
  completedAt: string | null,
}
```

- `type` defaults to `'blobs'`; metadata jobs (`type: 'metadata'`) are created by the
  metadata-migration route with a distinct progress shape.
- `progress` for **blob jobs** is the integer count of nodes done (`done` from the migration
  service `onProgress`) — not a 0..1 ratio — with `total` the snapshot node count.
- `progress` for **metadata jobs** is `{ percent, currentLabel }`, advanced by the metadata
  worker's `onProgress(stage, table, done, total)` ticks.
- `current` may be `string | null` (a current file path label); the blob worker writes a path
  string or `null`.

### 2.5 TTL

| Constant               | Value              | Description                                                                                                                                                                       |
| ---------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIGRATION_JOB_TTL_MS` | `3600000` (60 min) | Terminal jobs (`completed`, `failed`, `cancelled`) expire ~60 min after reaching terminal state; `get` returns `null` and deletes the entry. Non-terminal jobs are never expired. |

---

## 3. Verification Scenarios

- [ ] `create` returns a job with a unique `jobId` and status `pending`
- [ ] `update` merges fields (e.g. status, progress, results) into the job
- [ ] `get` returns the job or `null` for unknown/expired IDs
- [ ] `cancel` marks a running job `cancelled`; returns `false` for unknown or already-terminal jobs
- [ ] `isTerminal` is true only for `completed`, `failed`, `cancelled`
- [ ] Terminal job past TTL → `get` returns `null` and the entry is removed

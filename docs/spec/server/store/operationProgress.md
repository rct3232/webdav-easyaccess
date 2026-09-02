# operationProgress Store Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | CacheAdapter-backed store for tracking download progress, preview tickets, and bulk operation jobs (delete, move, copy). Successor of the original `server/store/bulkJobStore.js`; the implementation now lives in the files domain at `server/domains/files/stores/operationProgress.js`. Jobs expire after BULK_JOB_TTL_MS (1 hour) when terminal (completed/cancelled/failed). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/stores/operationProgress.js` (successor to the legacy `server/store/bulkJobStore.js`, which no longer exists)
- **Test file:** None yet

### 2.2 Class & Factory

| Export                       | Signature                                                     | Description                                                                         |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| OperationProgressStore       | (downloadCache, previewTicketCache, bulkJobCache) => instance | Constructor accepting three CacheAdapter instances                                  |
| createOperationProgressStore | () => OperationProgressStore                                  | Singleton factory; creates three internal cache adapters via `createCacheAdapter()` |
| setInstance                  | (instance) => void                                            | Override singleton for testing                                                      |

### 2.3 Main Methods

| Method                  | Signature                                    | Description                                                               |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| setDownloadProgress     | (id, state) => void                          | Store download progress state                                             |
| getDownloadProgress     | (id) => object \| undefined                  | Retrieve download progress state                                          |
| cleanupDownloadProgress | (id, ttlMs?) => void                         | Schedule download progress deletion via setTimeout; default TTL 5 min     |
| issuePreviewTicket      | (principalId, fileNodeId, ttlMs?) => string | Generate hex ticket; stores {principalId, fileNodeId} with default 120s TTL |
| readPreviewTicket       | (ticket) => {principalId, fileNodeId} \| null | Validate and return ticket data; returns null for invalid/expired tickets |
| createJob               | (userId, operation, payload) => {jobId, job} | Create bulk job; total computed from payload paths/moves/copies           |
| getJob                  | (jobId) => object \| null                    | Get job by ID; returns null if expired (and deletes entry)                |
| setJobCancelled         | (jobId) => boolean                           | Mark job cancelled; returns false if not found                            |
| updateJob               | (jobId, updates) => void                     | Merge updates into existing job via Object.assign                         |

### 2.4 Job Shape

- jobId, userId, operation ('delete'|'move'|'copy'), payload, status, results, progress, total, cancelled, createdAt, errorMessage

### 2.5 TTL Constants

| Constant                 | Value                                           | Description                               |
| ------------------------ | ----------------------------------------------- | ----------------------------------------- |
| DOWNLOAD_PROGRESS_TTL_MS | 300000 (5 min)                                  | Default download progress cleanup delay   |
| PREVIEW_TICKET_TTL_MS    | env WEA_PREVIEW_TICKET_TTL_MS or 120000 (2 min) | Preview ticket expiration                 |
| BULK_JOB_TTL_MS          | 3600000 (1 hour)                                | Bulk job expiration for terminal statuses |

### 2.6 Expiration Logic

- Terminal status ('completed', 'cancelled', 'failed') + age > BULK_JOB_TTL_MS → getJob returns null and deletes entry
- Non-terminal jobs are never expired by getJob

### 2.7 Dependencies

- crypto (randomUUID / randomBytes for jobId, randomBytes for preview tickets)
- `createCacheAdapter` from `server/infrastructure/adapters/cache` (three adapters: download `dp:` / preview-ticket `pt:` / bulk-job `bj:` keys)
- `configResolver.getSharedResolver()` — lazily resolves the T2 `WEA_PREVIEW_TICKET_TTL_MS` default ticket TTL

### 2.8 Verification Scenarios

- [ ] createJob returns jobId and job; total computed from payload
- [ ] getJob returns job or null
- [ ] setJobCancelled marks job; returns false if not found
- [ ] updateJob merges fields via Object.assign
- [ ] Expired terminal job → getJob returns null, entry deleted
- [ ] setDownloadProgress / getDownloadProgress round-trips state
- [ ] issuePreviewTicket / readPreviewTicket validates ticket
- [ ] cleanupDownloadProgress schedules deletion after TTL

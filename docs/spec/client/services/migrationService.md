# migrationService Spec

## 1. Overview

| Item         | Description                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Admin blob-migration API: get the derived migration direction, start a migration job, poll its status, cancel it. Thin wrapper around `apiClient` (same style as `adminService`). |
| Related docs | `PLAN.md` module G (client) + module E (admin routes contract); `docs/spec/client/components/mypage/content/MigrationDialog.md`                                                   |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/migrationService.js`
- **Test file:** `client/src/services/__tests__/migrationService.test.js`

### 2.2 Main Functions

| Function               | Input     | Return                           | API called                                   |
| ---------------------- | --------- | -------------------------------- | -------------------------------------------- |
| getMigrationInfo       | ()        | Promise\<{ source, direction }\> | GET /api/admin/migration/info                |
| startBlobMigration     | (payload) | Promise\<{ jobId }\>             | POST /api/admin/migration/blobs              |
| getBlobMigrationStatus | (jobId)   | Promise\<Job\>                   | GET /api/admin/migration/jobs/:jobId         |
| cancelBlobMigration    | (jobId)   | Promise\<Object\>                | POST /api/admin/migration/jobs/:jobId/cancel |

- All require admin JWT.

### 2.3 Request/Response Contract (aligned with PLAN.md module E)

**GET /api/admin/migration/info**

Returns the migration direction derived from the current app config (`WEA_FILE_STORAGE`):

```json
{
  "source": "webdav" | "s3",
  "direction": "webdav-to-s3" | "s3-to-webdav"
}
```

**POST /api/admin/migration/blobs**

Request body (no `direction`; the server derives it and validates `dest.type`):

```json
{
  "mode": "dry-run" | "apply",
  "force": false,
  "dest": {
    "type": "s3",
    "bucket": "string",
    "accessKey": "string",
    "secretKey": "string",
    "endpoint": "string | undefined",
    "region": "string (default 'us-east-1')"
  }
}
```

For `dest.type === 'webdav'`:

```json
{
  "type": "webdav",
  "url": "string",
  "username": "string",
  "password": "string",
  "authType": "string (default 'auto')",
  "upstreamUrl": "string | undefined"
}
```

Response: `202 { jobId }`; `400` invalid payload / missing required destination fields / `dest.type` mismatch; `409` a migration job is already running.

**GET /api/admin/migration/jobs/:jobId** → `200` job object:

```json
{
  "jobId": "mig-1",
  "direction": "webdav-to-s3",
  "mode": "dry-run",
  "status": "pending" | "running" | "completed" | "failed" | "cancelled",
  "progress": 3,
  "total": 10,
  "current": "/testuser/docs/file.txt",
  "results": {
    "copied": 3,
    "skipped": 1,
    "failed": 0,
    "errors": [{ "nodeId": 5, "path": "/testuser/docs/a.txt", "error": "message" }]
  },
  "errorMessage": null,
  "createdAt": "ISO",
  "completedAt": "ISO | null"
}
```

`404` unknown/expired job.

**POST /api/admin/migration/jobs/:jobId/cancel** → `200 { messageCode, jobId }`; `404` unknown job.

### 2.4 Error Handling

- Errors propagate; callers use `getServerErrorDisplay` for user-facing text.
- Returned data is `response.data` (matching `adminService`).

### 2.5 Verification Scenarios

- [ ] getMigrationInfo GETs `/admin/migration/info` and returns `{ source, direction }`
- [ ] startBlobMigration POSTs `/admin/migration/blobs` with payload and returns `{ jobId }`
- [ ] getBlobMigrationStatus GETs `/admin/migration/jobs/:jobId` and returns the job
- [ ] cancelBlobMigration POSTs `/admin/migration/jobs/:jobId/cancel`

# storageUsageSnapshotsStore Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Persistence for the per-user daily logical-storage series shown by the MyPage `Storage` dashboard (`docs/spec/client/components/mypage/content/CollectionDashboard.md`, `docs/spec/server/routes/storage.md`). One row per user per UTC day; the daily capture upserts the row and retention prunes old rows. |
| Boundaries | The store persists snapshots only. It computes no sizes (the aggregate lives in `fileNodesStore.summarizeSubtreeStorageUsage` via `storageService`) and serves no HTTP surface (`GET /api/storage/usage` delegates here through `storageService`).                                                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/storageUsageSnapshotsStore.js` (facade)
- **Repository:** `server/store/repositories/StorageUsageSnapshotsRepository.js`
  (dialect twins in `server/store/repositories/{sqlite,postgres}/`)
- **Shared shaping:** `server/store/repositories/storageUsageSnapshotsShared.js`
- **Test file:** `server/store/repositories/__tests__/StorageUsageSnapshotsRepository.conformance.test.js`
  (sqlite in `test:ci`; real PostgreSQL under `test:ci:pg:adapters`)

### 2.2 Table

`storage_usage_snapshots` in `server/store/postgresql/ddl/001_initial_normalized_schema.sql`:

```sql
storage_usage_snapshots(
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
)
storage_usage_snapshots_day_idx(day)
```

`day` is a UTC `YYYY-MM-DD` string; text comparison is chronological for the
fixed-width format. `bytes` is a non-negative integer; `created_at` belongs to
the day's first write and survives same-day replays.

### 2.3 Main Methods

| Method                                      | Contract                                                                                                                                                                                            | Returns       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `upsertSnapshot({ userId, day, bytes })`    | One row per `(user_id, day)`: a same-day replay overwrites `bytes` and keeps `created_at`. Validation (positive integer user, `YYYY-MM-DD` day, non-negative integer bytes) happens before SQL.     | `{ changes }` |
| `listForUser(userId, { fromDay?, toDay? })` | Rows of one user ascending by `day`; optional bounds are inclusive. Unknown user / empty range returns `[]`. Rows are domain-shaped `{ userId, day, bytes, createdAt }`.                            | `Snapshot[]`  |
| `deleteOlderThan(cutoffDay)`                | Deletes rows whose `day < cutoffDay` (UTC day comparison) — the scheduled retention pass. The caller computes the cutoff for `STORAGE_USAGE_RETENTION_DAYS`; `0` disables pruning at the scheduler. | `{ changes }` |

### 2.4 Dependencies

- `infrastructure/db/executor` (backend-neutral query/run seam; no SQL outside the repository twins).
- `domains/storage/service` is the read consumer; `infrastructure/maintenanceScheduler` is the write/prune consumer.

### 2.5 Verification Scenarios

- [ ] Same-day upserts collapse to one row and update `bytes` while `created_at` stays stable.
- [ ] `listForUser` is user-scoped, ascending, and honours inclusive `fromDay`/`toDay` bounds.
- [ ] `deleteOlderThan` removes only rows strictly before the cutoff and reports `changes`.
- [ ] Malformed days, non-positive user ids and negative byte totals throw `TypeError` before SQL.
- [ ] Deleting a user cascades their snapshot rows.

# aiJobsStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Persistent queue for AI enrichment work — table `ai_jobs(node_id, generation, kind, status, attempt, next_retry_at, last_error, content_hash,...)`. DB-backed only: jobs survive restarts, the worker is stateless (no new state in `CacheAdapter` — AI state is DB-backed by design). |
| Design owner | `docs/features/collections-platform.md` §4.20 (file-embed call site, content_hash skip), §4.1 (upload hooks enqueue).                                                                                                                                                                  |
| Idempotency  | `UNIQUE(node_id, kind, generation)` — per-file enqueue at commit is cheap and repeatable; a new `generation` (model change / backfill) forces fresh work without colliding with old rows.                                                                                              |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/aiJobsStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/AiJobsRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/AiJobsRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/AiJobsRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/aiJobsStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`; index `ai_jobs_claim`
  over `(status, next_retry_at)`.

### 2.2 Row shape

`{ id, nodeId, kind, generation, status, attempt, nextRetryAt, lastError, contentHash,
createdAt, startedAt, finishedAt }` — `kind ∈ embed | features | caption | asr | backfill`;
`status ∈ pending | running | done | failed | skipped` (TEXT+CHECK).

### 2.3 Main Methods

| Method                | Signature                                                             | Description                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enqueue`             | (nodeId, kind, generation, contentHash?) => Promise\<{ id } \| null\> | INSERT ON CONFLICT `(node,kind,generation)` DO NOTHING; `status='pending'`. `null` = duplicate already present (the dedupe-skip contract).              |
| `enqueueMany`         | (items) => Promise\<{ enqueued }\>                                    | One TX, per-item ON CONFLICT DO NOTHING (`items: [{ nodeId, kind, generation, contentHash }]`) — backfill seeding.                                      |
| `claimNext`           | ({ excludeKinds }?) => Promise\<job \| null\>                         | Atomically move the oldest claimable row to `running` (`started_at=now`). Claimable = `pending` OR (`failed` AND `next_retry_at <= now`). `excludeKinds` is a predicate-level exclusion: rows of the listed kinds stay parked (status and `attempt` untouched — zero attempt inflation) and drain in claim order once the filter is removed. See §2.4. |
| `markDone`            | (jobId) => Promise\<{ changes }\>                                     | `running → done`, `finished_at=now`. Guarded on `status='running'`.                                                                                     |
| `markFailed`          | (jobId, error) => Promise\<{ changes }\>                              | `running → failed`, `attempt=attempt+1`, `last_error=error(≤1KB truncated)`, `next_retry_at=now+backoff(attempt)` (§2.5). Guarded on `running`.         |
| `markSkipped`         | (jobId, reason?) => Promise\<{ changes }\>                            | `running → skipped`, `finished_at=now`, `last_error=reason` (note channel, e.g. content_hash dedupe or overlength `skip` policy). Guarded on `running`. |
| `recoverStaleRunning` | (staleMs) => Promise\<{ changes }\>                                   | Startup/periodic reap: `running` rows with `started_at < now-staleMs` → `failed`, `attempt+1`, `next_retry_at=now` (re-claimable immediately).          |
| `getById`             | (jobId) => Promise\<job \| null\>                                     | Single read.                                                                                                                                            |
| `listByNode`          | (nodeId, { generation }?) => Promise\<job[]\>                         | Per-file job history (admin/repair views); optional generation filter.                                                                                  |
| `countByStatus`       | () => Promise\<{ pending, running, done, failed, skipped }\>          | Admin pipeline card.                                                                                                                                    |
| `listFailed`          | ({ limit? }?) => Promise\<job[]\>                                     | Recent `failed` rows, newest first (failsafe report input).                                                                                             |

Terminal rows (`done`, `skipped`) are history, not garbage: the GC policy for old terminal
jobs is the admin-reports pass's concern, not this store's. No delete methods exist beyond
the `node_id` FK cascade.

### 2.4 Claim semantics (dialect-split, repository-internal)

The dialect difference is sealed inside the repository twins (facade/services see one
`claimNext()` — repository-contract rule 3):

- **PostgreSQL:** inside one TX:
  `SELECT id FROM ai_jobs WHERE <claimable> ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`
  → `UPDATE... SET status='running', started_at=NOW() WHERE id=? RETURNING *`.
  Concurrent workers skip past locked rows — no lost or double claims.
- **SQLite:** the driver is a single-writer serialized queue (`node:sqlite` executor,
  CODING_STYLE.md Express Patterns) — a claim-lock-free statement suffices:
  `UPDATE ai_jobs SET status='running', started_at=datetime('now') WHERE id =
(SELECT id FROM ai_jobs WHERE <claimable> ORDER BY id LIMIT 1) RETURNING *`
  inside one transaction. `RETURNING` requires the node:sqlite driver.

`claimNext` returns the full claimed job or `null` when the queue is empty — it never
throws on "nothing to do".

### 2.5 Retry / backoff

- `backoff(attempt) = min(AI_JOB_RETRY_BASE_MS * 2^(attempt-1), AI_JOB_RETRY_MAX_MS)`,
  defaults `30_000` / `1_800_000` (30 s doubling, 30 min cap). Plain exponential, no
  jitter; module constants, not model-profile values.
- No attempt cap: a permanently failing job stays claimable at the 30-min cadence and is
  surfaced by `listFailed` / `countByStatus` (admin dashboard) instead of silently
  dying — kill-switch/pause semantics must "never destroy queued work silently".

### 2.6 Transaction boundaries

- Every mutator is one statement or one `executor.transaction`; no `commitChange` here —
  jobs are internal mechanics, not user-undoable acts (the file change a job reflects was
  itself committed elsewhere).
- Node purge cascades job rows (`node_id` FK → CASCADE).

### 2.7 Error contracts

- `enqueue` conflict → `null` (not an error); reads → `null`/`[]`; guarded status flips →
  `{ changes: 0 }` (a late `markDone` after `recoverStaleRunning` reaped the row is a no-op —
  the delayed worker must log and drop, never resurrect).
- FK/mapped driver errors surface via `mapDatabaseError` unchanged.

### 2.8 Dependencies

- `storage.getExecutor()` + `AiJobsRepository` (+ twins)
- Callers: upload hooks (`kind=embed|features` enqueue at commit), backfill service, jobs worker, admin reports. No lockManager (claim atomicity
  is the DB's job).

### 2.9 Verification Scenarios

- [ ] `enqueue` twice for the same `(node,kind,generation)` → `{id}` then `null`; one row total
- [ ] same `(node,kind)` with `generation+1` → new row accepted (UNIQUE is per-generation)
- [ ] `claimNext` on empty queue → `null`; claim moves `pending → running` with `started_at` set
- [ ] `claimNext` does not pick `failed` rows with `next_retry_at` in the future, and does pick them once past it
- [ ] `markFailed` increments `attempt` and pushes `next_retry_at` per the doubling table (30 s, 60 s, 120 s,... capped 30 min)
- [ ] `markDone`/`markFailed`/`markSkipped` on a non-`running` row → `{ changes: 0 }`
- [ ] `markSkipped` records the reason in `last_error` and terminates (`finished_at` set, never re-claimable)
- [ ] Restart survival: claim a job, kill the process (simulate by leaving it `running`), run `recoverStaleRunning(staleMs)` → row re-claimable as `failed`; end-to-end the file still gets embedded exactly once per generation (worker + idempotent upserts downstream)
- [ ] Two concurrent `claimNext` callers on PG (L2, `test:ci:pg:adapters` via SKIP LOCKED) never receive the same row; on sqlite the serialized queue yields the same guarantee
- [ ] Node purge cascades its job rows (any status)
- [ ] `countByStatus` totals match seeded fixtures of every status incl. `skipped`
- [ ] L2 conformance on both backends: row-shape parity (number ids, ISO timestamps, `nextRetryAt` null-vs-value), claim ordering (`id ASC`), `enqueueMany` partial-duplicate counts only new inserts
- [ ] Grep: zero `CacheAdapter`/`operationProgress` imports in the store and `domains/ai/**` (CODING_STYLE.md Express Patterns gate)

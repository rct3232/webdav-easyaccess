# aiJobsStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Persistent queue for AI enrichment work — table `ai_jobs(node_id, generation, kind, status, attempt, next_retry_at, last_error, content_hash,...)`. DB-backed only: jobs survive restarts, the worker is stateless (no new state in `CacheAdapter` — AI state is DB-backed by design).                                                                                                    |
| Design owner | `docs/features/collections-platform.md` §4.20 (file-embed call site, content_hash skip), §4.1 (upload hooks enqueue).                                                                                                                                                                                                                                                                     |
| Idempotency  | `UNIQUE(node_id, kind, generation)` — per-file enqueue at commit is cheap and repeatable. An identical or absent `content_hash` is a `null` dedupe (no row touched); a DIFFERENT non-null content hash RESETS the existing row to a fresh `pending` attempt on the same generation. A new `generation` (model change / backfill) still forces fresh work without colliding with old rows. |

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
createdAt, startedAt, finishedAt }` — `kind ∈ AI_JOB_KIND.ALL` (`shared/constants.js`:
`embed | features | caption | asr | backfill`; the DDL CHECK is the persistence source of
truth, pinned by a parity test); `status ∈ pending | running | done | failed | skipped |
cancelled` (TEXT+CHECK; `cancelled` is terminal and never claimable). `claimNext({ excludeKinds })`
normalizes the list ONCE (non-empty strings)
and binds that same array — the predicate placeholders and bound values can never
desynchronize.

### 2.3 Main Methods

| Method                | Signature                                                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `enqueue`             | (nodeId, kind, generation, contentHash?) => Promise\<{ id } \| null\>   | INSERT ON CONFLICT `(node,kind,generation)`; a fresh insert has `status='pending'`. On conflict the row is reset (`status='pending'`, `attempt=0`, `next_retry_at=NULL`, `started_at=NULL`, `finished_at=NULL`, `last_error=NULL`, `content_hash=excluded.content_hash`) ONLY when BOTH the stamped and incoming hashes are non-null and differ. Identical or absent hashes perform no update and return `null` (the dedupe-skip contract). |
| `enqueueMany`         | (items) => Promise\<{ enqueued, ids }\>                                 | One TX, per-item ON CONFLICT DO NOTHING (`items: [{ nodeId, kind, generation, contentHash }]`) — admin re-embed seeding. Newly inserted row ids are returned in insertion order. `enqueueManyTx(tx, items)` is the caller-owned-TX variant used by the launcher so the generation bump, seed enqueue and settings journal row commit atomically.                                                                                            |
| `cancelPending`       | ({ jobIds }) => Promise\<{ cancelledIds, skippedIds }\>                 | ONE TX over the given ids; ONLY `status='pending'` rows move to the terminal `cancelled` state (`finished_at=now`). Running rows finish normally; done/failed/skipped/cancelled rows are untouched and land in `skippedIds` (never retried/resurrected). `cancelPendingTx(tx, { jobIds })` is the caller-owned-TX inverse used by the settings journal.                                                                                     |
| `claimNext`           | ({ excludeKinds }?) => Promise\<job \| null\>                           | Atomically move the oldest claimable row to `running` (`started_at=now`). Claimable = `pending` OR (`failed` AND `next_retry_at <= now`). `excludeKinds` is a predicate-level exclusion: rows of the listed kinds stay parked (status and `attempt` untouched — zero attempt inflation) and drain in claim order once the filter is removed. See §2.4.                                                                                      |
| `markDone`            | (jobId) => Promise\<{ changes }\>                                       | `running → done`, `finished_at=now`. Guarded on `status='running'`.                                                                                                                                                                                                                                                                                                                                                                         |
| `markFailed`          | (jobId, error) => Promise\<{ changes }\>                                | `running → failed`, `attempt=attempt+1`, `last_error=error(≤1KB truncated)`, `next_retry_at=now+backoff(attempt)` (§2.5), `finished_at=now` (the admin 24 h failure-rate window). Guarded on `running`.                                                                                                                                                                                                                                     |
| `markSkipped`         | (jobId, reason?) => Promise\<{ changes }\>                              | `running → skipped`, `finished_at=now`, `last_error=reason` (note channel, e.g. content_hash dedupe or overlength `skip` policy). Guarded on `running`.                                                                                                                                                                                                                                                                                     |
| `recoverStaleRunning` | (staleMs) => Promise\<{ changes }\>                                     | Startup/periodic reap: `running` rows with `started_at < now-staleMs` → `failed`, `attempt+1`, `next_retry_at=now` (re-claimable immediately).                                                                                                                                                                                                                                                                                              |
| `getById`             | (jobId) => Promise\<job \| null\>                                       | Single read.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `listByNode`          | (nodeId, { generation }?) => Promise\<job[]\>                           | Per-file job history (admin/repair views); optional generation filter.                                                                                                                                                                                                                                                                                                                                                                      |
| `countByStatus`       | () => Promise\<{ pending, running, done, failed, skipped, cancelled }\> | Admin pipeline card.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `listFailed`          | ({ limit? }?) => Promise\<job[]\>                                       | Recent `failed` rows, newest first (failsafe report input / admin display-only table).                                                                                                                                                                                                                                                                                                                                                      |
| `countFailedSince`    | (sinceIso) => Promise\<number\>                                         | `failed` rows whose `finished_at >= sinceIso` — the admin 24 h failure count. Terminal timestamps only; rows reaped before `finished_at` instrumentation are not backfilled.                                                                                                                                                                                                                                                                |
| `countFinishedSince`  | (sinceIso) => Promise\<number\>                                         | Rows with `finished_at >= sinceIso` (any terminal status) — the failure-rate denominator.                                                                                                                                                                                                                                                                                                                                                   |
| `countActiveByIds`    | (jobIds) => Promise\<number\>                                           | `pending                                                                                                                                                                                                                                                                                                                                                                                                                                    | running`rows among the ids (batched`IN`), used by the launcher's global single-active guard over the previous launch's journaled job ids. |

Terminal rows (`done`, `skipped`, `cancelled`) are history, not garbage: the GC policy for old terminal
jobs is the admin-reports pass's concern, not this store's. No delete methods exist beyond
the `node_id` FK cascade.

Content-aware conflict rule (§2.3 `enqueue`): the UNIQUE row is per
`(node_id, kind, generation)` and the generation is NOT bumped by a content change. Instead
the store compares the row's stamped `content_hash` with the incoming one inside the upsert
(`ON CONFLICT ... DO UPDATE ... WHERE` in both dialect twins): a non-null differing pair
resets the SAME row so overwrite/restore always produces fresh claimable work, while a
missing/identical hash keeps the pure DO-NOTHING dedupe (crash retries, byte-identical
copies/restores). The reset is legal in every status (including `running`: a late
`markDone` from the previous execution then sees a non-`running` row and is a
`{ changes: 0 }` no-op). `enqueueMany` stays pure DO NOTHING: it is backfill seeding over
opaque driver keys, not a content-change signal.

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

- `enqueue` conflict with an identical/absent hash → `null` (not an error); a
  content-changing conflict returns the reset row's `{ id }`; reads → `null`/`[]`; guarded
  status flips → `{ changes: 0 }` (a late `markDone` after `recoverStaleRunning` reaped the
  row, or after a content-change reset re-armed it, is a no-op — the delayed worker must
  log and drop, never resurrect).
- FK/mapped driver errors surface via `mapDatabaseError` unchanged.

### 2.8 Dependencies

- `storage.getExecutor()` + `AiJobsRepository` (+ twins)
- Callers: upload hooks (`kind=embed|features` enqueue at commit), backfill service, jobs worker, admin reports. No lockManager (claim atomicity
  is the DB's job).

### 2.9 Verification Scenarios

- [ ] `enqueue` twice for the same `(node,kind,generation)` with the same hash → `{id}` then `null`; one row total
- [ ] `enqueue` with a DIFFERENT non-null `content_hash` on an existing terminal/failed/running row → the SAME row is returned reset (`pending`, `attempt=0`, `next_retry_at/started_at/finished_at/last_error` NULL, new hash); no second row, and `claimNext` picks it up
- [ ] `enqueue` with a `null` incoming hash (or an existing row stamped `null`) never resets — returns `null` and leaves the row untouched
- [ ] `enqueueMany` still pure DO NOTHING under a differing hash (backfill seeding is not a content-change signal) and returns the ids of newly inserted rows only
- [ ] `enqueueManyTx` joins a caller-owned TX (the launcher journal path); a throw rolls back the seed inserts
- [ ] `cancelPending` cancels only `pending` rows, returns cancelled/skipped ids, and leaves running/done/failed/skipped/cancelled rows untouched
- [ ] cancel race: when a worker claims the row first, `cancelPending` reports 0 cancelled and the running job finishes normally
- [ ] same `(node,kind)` with `generation+1` → new row accepted (UNIQUE is per-generation)
- [ ] `claimNext` on empty queue → `null`; claim moves `pending → running` with `started_at` set
- [ ] `claimNext` does not pick `failed` rows with `next_retry_at` in the future, and does pick them once past it
- [ ] `markFailed` increments `attempt` and pushes `next_retry_at` per the doubling table (30 s, 60 s, 120 s,... capped 30 min)
- [ ] `markDone`/`markFailed`/`markSkipped` on a non-`running` row → `{ changes: 0 }`
- [ ] `markSkipped` records the reason in `last_error` and terminates (`finished_at` set, never re-claimable)
- [ ] Restart survival: claim a job, kill the process (simulate by leaving it `running`), run `recoverStaleRunning(staleMs)` → row re-claimable as `failed`; end-to-end the file still gets embedded exactly once per generation (worker + idempotent upserts downstream)
- [ ] Two concurrent `claimNext` callers on PG (L2, `test:ci:pg:adapters` via SKIP LOCKED) never receive the same row; on sqlite the serialized queue yields the same guarantee
- [ ] Node purge cascades its job rows (any status)
- [ ] `countByStatus` totals match seeded fixtures of every status incl. `skipped` and `cancelled`
- [ ] A `cancelled` row is terminal: `claimNext` never claims it and `listFailed` excludes it
- [ ] L2 conformance on both backends: row-shape parity (number ids, ISO timestamps, `nextRetryAt` null-vs-value), claim ordering (`id ASC`), `enqueueMany` partial-duplicate counts only new inserts
- [ ] Grep: zero `CacheAdapter`/`operationProgress` imports in the store and `domains/ai/**` (CODING_STYLE.md Express Patterns gate)

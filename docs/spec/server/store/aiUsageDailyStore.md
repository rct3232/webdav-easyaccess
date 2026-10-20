# aiUsageDailyStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ----------------------------------------------------------------- |
| Role         | Provider-traffic counters — table `ai_usage_daily(day TEXT, role, calls, input_chars, cached, degraded, failed_429)` PK `(day, role)`. Written by llmAdapter on EVERY provider round-trip incl. cached-hit accounting (llmAdapter §2.9); read by `breakerState`/`budgetStatus` and the admin cost ledger (AI_FEATURE_PLAN §4.15). `role` uses the same enum values as `llm_models.role` (`embed | chat | vision | asr`) — no CHECK on the table by design (DDL is source of truth). |
| Day rollover | A day rollover is a NEW PK row — there is NO reset job and NO store code path that deletes, zeroes, or aggregates-away history (llmAdapter §2.9: "reconfig resets BREAKERS, not history"). The `day` format is the caller's contract (`YYYY-MM-DD`, server-local date of the call); the store persists it verbatim and compares lexicographically (safe for zero-padded ISO dates).             |
| Counters     | Columns move only on their events: a round-trip increments ONLY the counters its outcome implies (a cache hit bumps `calls` + `cached`, not `degraded`; a 429 bumps `failed_429`). Counters never decrease — the store accepts non-negative integer deltas only.                                                                                                                                |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/aiUsageDailyStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/AiUsageDailyRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/AiUsageDailyRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/AiUsageDailyRepository.conformance.test.js`
- **Facade test:** `server/domains/ai/__tests__/aiUsageDailyStore.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
  (`ai_usage_daily` block).

### 2.2 Row shape

`{ day, role, calls, inputChars, cached, degraded, failed429 }` — `day`/`role` strings,
the rest numbers (`input_chars` may exceed 2^31 on busy days — sum in JS, never bitwise).

### 2.3 Main Methods

| Method           | Signature                                                                                      | Description                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recordUsage`    | ({ day, role, calls?, inputChars?, cached?, degraded?, failed429? }) => Promise\<{ changes }\> | Atomic upsert-INCREMENT on the PK pair (share-link counter precedent): `INSERT ... ON CONFLICT (day, role) DO UPDATE SET <col> = <col> + EXCLUDED.<col>` for all five counters; omitted deltas default 0. One statement — concurrent recorders cannot lose an increment. |
| `getByDay`       | (day) => Promise\<row[]\>                                                                      | Per-role rows of one day, `role ASC` (per-day ledger read).                                                                                                                                                                                                              |
| `summarizeRange` | ({ fromDay, toDay }) => Promise\<row[]\>                                                       | Per-role SUMs over the inclusive day range (`day >= fromDay AND day <= toDay`), `role ASC` — the 24h fail/429-rate and cost-ledger read; days not present contribute nothing (SQL SUM, not store-side math).                                                             |

### 2.4 Transaction Boundaries

- Every method is one statement (atomic increment; no read-modify-write anywhere).
- No journal writes (telemetry, not a user-undoable act — §4.11; usageStore precedent).

### 2.5 Error Contracts

- Non-string `day`/`role`, or a negative / non-integer delta → TypeError BEFORE SQL (counters
  never decrease; the DDL CHECKs stay the last line of defense).
- `getByDay`/`summarizeRange` on days with no rows → `[]`.

### 2.6 Restart Survival

Counter rows are DB truth and persist across restarts; there is no reset path in the store.
After a simulated restart the same `(day, role)` row continues to receive increments (the
upsert re-attaches to the persisted row — no duplicate, no reset). Verified by asserting a
persisted row keeps accumulating across a fresh repository over the reopened database.

### 2.7 Dependencies

- `storage.getExecutor()` + `AiUsageDailyRepository` (+ twins).
- Callers: llmAdapter (§2.9 usage counting; `breakerState`/`budgetStatus` reads), admin AI
  governance panel cost ledger (§4.15). No journal, no locks.

### 2.8 Verification Scenarios

- [ ] First `recordUsage` for a `(day, role)` inserts the row; repeated calls INCREMENT the
      touched counters only (untouched counters stay 0 — "columns move only on their events")
- [ ] `cached`-only / `failed_429`-only round-trips move exactly their counter
- [ ] Two roles on one day are separate rows; two days on one role are separate rows (day
      rollover = new PK row, no reset)
- [ ] Concurrent-safe increment shape: the SQL is a single upsert-increment (no lost update
      by construction); `changes` is 1 for both insert and increment paths
- [ ] `getByDay` returns the day's rows `role ASC`; unknown day → `[]`
- [ ] `summarizeRange` sums per role over the inclusive range and skips absent days
- [ ] Negative or non-integer deltas → TypeError before SQL
- [ ] Restart survival: a persisted `(day, role)` row continues to accumulate after a fresh
      repository over the reopened database (same row, higher counters)
- [ ] L2 conformance on both backends (sqlite default leg + `test:ci:pg:adapters`)

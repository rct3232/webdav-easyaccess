# executor Spec

## 1. Overview

| Item            | Description                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role            | Single backend-neutral execution seam above `storage`. Every SQL statement in the metadata layer is executed through a `DbExecutor`; callers never touch `pg` pools or sqlite connections directly and never implement dialect branching. |
| Source of truth | `docs/features/config-source-resolution.md` (DB-only key model is independent of this seam); this spec is authoritative for the execution contract.                                                                                       |

## 2. Implementation Spec

### 2.1 File Paths

- **Interface (contract):** `server/infrastructure/db/executor.js`
- **Implementations:** `server/infrastructure/db/sqliteExecutor.js`, `server/infrastructure/db/postgresExecutor.js`
- **Selection:** `storage.getExecutor()` returns the active implementation based on `storage.getBackend()` (including the jest test-only override, §2.8 of the storage spec).
- **Tests:** `server/infrastructure/db/__tests__/` (sqlite runs against a real temp DB; postgres runs against a jest-mocked Pool).

### 2.2 Interface

```js
/**
 * @typedef {'sqlite'|'postgres'} DbDialect
 *
 * @typedef {Object} DbExecutor
 * @property {DbDialect} dialect
 * @property {(sql: string, params?: Array) => Promise<{ rows: Array }>} query
 *   Read path. Returns rows as plain objects (snake_case columns as defined in
 *   the schema). No row mapping beyond what the driver returns.
 * @property {(sql: string, params?: Array) => Promise<{ changes: number, lastId?: number, rows?: Array }>} run
 *   Write path (INSERT/UPDATE/DELETE/DDL). `lastId` is the generated id of an
 *   INSERT into a single-column-PK table (`undefined` otherwise). Implementors
 *   normalise the driver difference: sqlite uses `lastID` from `db.run`; the
 *   postgres implementation appends `RETURNING <pk>` to the statement
 *   (introspecting `pg_index`, cached per table) and reads the first returned
 *   column. SQL that already contains RETURNING is left untouched.
 *   When the statement itself carries RETURNING, rows are surfaced as
 *   `rows` (with `changes` = row count) on sqlite (which routes such
 *   statements through `db.all`, because `db.run` discards RETURNING rows)
 *   and on the postgres **transactional** `tx.run`. The postgres **top-level**
 *   `run` consumes the first RETURNING column for `lastId` and does not
 *   surface the full rows — use `query`/`tx.run` when the returned rows are
 *   needed.
 * @property {<T>(fn: (tx) => Promise<T>) => Promise<T>} transaction
 *   Runs `fn` inside one transaction; commits on resolve, rolls back on throw.
 *   `tx` exposes the same `query`/`run` shape bound to the open transaction.
 * @property {(err: unknown) => boolean} isUniqueConflict
 *   True when the **raw driver error** is a unique-constraint violation (PG
 *   SQLSTATE `23505`; sqlite `SQLITE_CONSTRAINT` / "UNIQUE constraint failed").
 *   MUST be called on the raw driver error inside the implementation's catch
 *   block, BEFORE `mapDatabaseError` discards driver codes — mapped errors only
 *   carry the standardised errorCode. Callers use the result to produce domain
 *   errors (e.g. 409) with no dialect knowledge.
 * @property {() => Promise<void>} close
 *   Releases the underlying connection/pool (delegates to `storage`).
 */
```

### 2.3 Rules

1. **SQL stays per-dialect at the call site.** The executor does **not** translate
   SQL text. A repository implementation written for one dialect ships its own
   statements; the executor only normalises binding, results, ids, transactions
   and error classification. (Placeholder style therefore follows the dialect:
   `?` for sqlite, `$n` for postgres.)
2. **Errors are thrown after `mapDatabaseError`.** Both implementations wrap
   driver failures with the shared `mapDatabaseError` before rethrowing, so
   callers see standardised error codes.
3. **Transactions must not nest.** Nesting an outer transaction around an
   executor transaction is forbidden on sqlite (single serialized queue) and
   pointless on PG. Services pass the callback style through.
4. **No caching.** The executor is a stateless pass-through over `storage`
   connections/pools. Statement/PK introspection caches (postgres `RETURNING`
   lookup) are internal implementation details.
5. **Test override aware.** `storage.getExecutor()` honours the jest-only
   backend override (`storage.setTestBackend`), so a real-PG test leg injects a
   pool once and every repository executes against it — no env, no per-suite
   re-wiring.

### 2.4 Storage additions

- `storage.getExecutor()` — returns the cached executor for the active backend.
  Throws for an unconfigured backend (same guard as `getPgPool`).

### 2.5 Verification Scenarios

- [ ] sqlite executor: `run` returns `{ changes, lastId }` for an INSERT into an autoincrement table
- [ ] sqlite executor: `query` returns rows; `transaction` commits on success and rolls back on throw
- [ ] postgres executor (mocked Pool): `run` appends `RETURNING <pk>` exactly once for single-PK INSERT, preserves pre-existing RETURNING, returns `lastId` from the first column
- [ ] postgres executor: `transaction` issues BEGIN/COMMIT, ROLLBACK on throw, releases the client
- [ ] `isUniqueConflict`: true for PG `23505` and for sqlite unique-constraint errors; false otherwise
- [ ] `storage.getExecutor()` returns the postgres executor while the jest override is active and the sqlite executor after it is cleared
- [ ] driver errors surface as mapped errors (standardised codes), not raw driver objects

### 2.6 sqlite driver: `node:sqlite` migration — **(T0.12 target — lands with P0)**

Decided contract (AI_FEATURE_PLAN §4.13, PLAN §6/§7 T0.12). The sections above describe the
**current** `sqlite3` npm behavior and remain authoritative until the migration lands; from
T0.12 the sqlite implementation is built on the built-in `node:sqlite` module:

- **Scope:** the driver swap is confined to `server/infrastructure/db/sqliteExecutor.js`
  (+ `storage`'s sqlite connection helpers) — this is the seam by design; no repository,
  store facade, or route changes, and the `DbExecutor` interface (§2.2) is byte-for-byte
  unchanged. The executor behavior suite must pass on **both drivers** at cutover
  (regression parity is the migration's verification gate).
- **Extension loading (why the migration exists):** `node:sqlite` exposes
  `db.enableLoadExtension(true)` + `db.loadExtension(path)` — the prerequisite for loading
  the sqlite-vec **vec0** extension (native sqlite vector path, §4.13); the current
  `sqlite3` npm exposes no extension loading.
- **BigInt integer-PK binding (mandatory convention):** `node:sqlite` binds plain JS
  numbers as doubles, so **integer PK values (vec0 rowids and BIGINT node ids) MUST be
  passed as `BigInt`**; repositories/adapter code binding such values follows this rule.
- **Experimental warning tolerated:** `node:sqlite` is experimental-flagged on v24 (it
  works); the boot path suppresses/ignores the `ExperimentalWarning` — it is never a
  failure signal.
- **Node floor:** **≥ 24** becomes the product requirement (release prerequisite,
  `docs/SETUP.md`).
- **Known driver gotcha carried into the adapter:** vec0 + JOIN planner bug ⇒ ACL filtering
  uses oversample(k·f) → SQL filter → adaptive retry, never join-KNN (§4.13).

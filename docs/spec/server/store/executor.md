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
 * Read path. Returns rows as plain objects (snake_case columns as defined in
 * the schema). No row mapping beyond what the driver returns.
 * @property {(sql: string, params?: Array) => Promise<{ changes: number, lastId?: number, rows?: Array }>} run
 * Write path (INSERT/UPDATE/DELETE/DDL). `lastId` is the generated id of an
 * INSERT into a single-column-PK table (`undefined` otherwise). Implementors
 * normalise the driver difference: sqlite reads the driver's
 * `lastInsertRowid` (surfaced as `lastID` by `storage.sqliteRun`); the
 * postgres implementation appends `RETURNING <pk>` to the statement
 * (introspecting `pg_index`, cached per table) and reads the first returned
 * column. SQL that already contains RETURNING is left untouched.
 * When the statement itself carries RETURNING, rows are surfaced as
 * `rows` (with `changes` = row count) on sqlite (which routes such
 * statements through `db.all`, because `db.run` discards RETURNING rows)
 * and on the postgres **transactional** `tx.run`. The postgres **top-level**
 * `run` consumes the first RETURNING column for `lastId` and does not
 * surface the full rows — use `query`/`tx.run` when the returned rows are
 * needed.
 * @property {<T>(fn: (tx) => Promise<T>) => Promise<T>} transaction
 * Runs `fn` inside one transaction; commits on resolve, rolls back on throw.
 * `tx` exposes the same `query`/`run` shape bound to the open transaction.
 * @property {(err: unknown) => boolean} isUniqueConflict
 * True when the **raw driver error** is a unique-constraint violation (PG
 * SQLSTATE `23505`; sqlite `SQLITE_CONSTRAINT` / "UNIQUE constraint failed").
 * MUST be called on the raw driver error inside the implementation's catch
 * block, BEFORE `mapDatabaseError` discards driver codes — mapped errors only
 * carry the standardised errorCode. Callers use the result to produce domain
 * errors (e.g. 409) with no dialect knowledge.
 * @property {() => Promise<void>} close
 * Releases the underlying connection/pool (delegates to `storage`).
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

### 2.6 sqlite driver: `node:sqlite`

Decided contract (docs/features/collections-platform.md §4.13, CODING_STYLE.md Express Patterns). The sqlite implementation is built on the built-in `node:sqlite`
module (`DatabaseSync`) — the `sqlite3` npm package is removed:

- **Scope (real seam):** the executor (`sqliteExecutor.js`) plus the storage
  seam (`store/storage.js`: connection, `sqliteQuery`/`sqliteRun`,
  `withSqliteTransaction`) and the three direct-connection sites
  (`infrastructure/sqliteSchemaInit.js`, `infrastructure/metadataPresence.js`,
  `domains/admin/services/metadataMigrationService.js`). No repository, store facade, or
  route changes, and the `DbExecutor` interface (§2.2) is byte-for-byte unchanged. The
  executor behavior suite was green on the `sqlite3` npm driver before cutover and on
  `node:sqlite` after (regression parity is the migration's verification gate).
- **Extension loading (why the migration exists):** `node:sqlite` exposes
  `db.enableLoadExtension(true)` + `db.loadExtension(path)` — the prerequisite for loading
  the sqlite-vec **vec0** extension (native sqlite vector path); the removed
  `sqlite3` npm exposed no extension loading.
- **BigInt integer-PK binding (mandatory convention):** **integer PK values (vec0 rowids
  and BIGINT node ids) MUST be passed as `BigInt`** — the removed sqlite3 npm driver
  truncated BigInt binds to their low 32 bits, while `node:sqlite` binds BigInt as exact
  64-bit integers; repositories/adapter code binding such values follows this rule.
- **Bind normalization:** `node:sqlite` rejects boolean and `undefined` bind values; the
  storage helpers normalize them (booleans → `1`/`0`, `undefined` → `NULL`) to preserve
  the historical sqlite3-npm binding behavior.
- **Experimental warning tolerated:** `node:sqlite` is experimental-flagged on v24 (it
  works); the `ExperimentalWarning` printed once per process at first module load is
  informational — never a failure signal.
- **Node floor:** **≥ 24** becomes the product requirement (release prerequisite,
  `docs/SETUP.md`; `server/package.json` `engines.node`).
- **Known driver gotcha carried into the adapter:** vec0 + JOIN planner bug ⇒ ACL filtering
  uses oversample(k·f) → SQL filter → adaptive retry, never join-KNN.

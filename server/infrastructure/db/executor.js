'use strict';

/**
 * Backend-neutral DB execution seam (docs/spec/server/store/executor.md).
 *
 * @typedef {'sqlite'|'postgres'} DbDialect
 *
 * @typedef {Object} DbExecutor
 * @property {DbDialect} dialect
 * @property {(sql: string, params?: Array) => Promise<{ rows: Array }>} query
 * @property {(sql: string, params?: Array) => Promise<{ changes: number, lastId?: number }>} run
 * @property {<T>(fn: (tx: { query: Function, run: Function }) => Promise<T>) => Promise<T>} transaction
 * @property {(err: unknown) => boolean} isUniqueConflict
 * @property {() => Promise<void>} close
 *
 * The executor is a stateless pass-through over `storage`: SQL stays
 * per-dialect at the call site, and the implementation normalises binding,
 * results, generated ids, transactions and unique-conflict detection.
 */

module.exports = {};

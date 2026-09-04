'use strict';

const storage = require('../../store/storage');
const { mapDatabaseError } = require('../../utils/errorHandler');

/**
 * SQLite implementation of the DbExecutor contract
 * (docs/spec/server/store/executor.md). Statements use `?` placeholders; the
 * connection and the serialized transaction queue live in `storage`.
 *
 * @type {import('./executor').DbExecutor}
 */
module.exports = {
  dialect: 'sqlite',

  async query(sql, params = []) {
    try {
      const res = await storage.sqliteQuery(sql, params);
      return { rows: res.rows };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  },

  async run(sql, params = []) {
    try {
      // Statements with RETURNING need db.all (rows); plain writes use db.run
      // (changes + lastID). Mirrors the contract: run() returns lastId for
      // single-PK INSERTs and `rows` when the statement returns rows.
      if (/RETURNING/i.test(sql)) {
        const res = await storage.sqliteQuery(sql, params);
        return { changes: res.rows.length, rows: res.rows };
      }
      const res = await storage.sqliteRun(sql, params);
      return { changes: res.changes, lastId: res.lastID };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  },

  async transaction(fn) {
    return storage.withSqliteTransaction(async (client) =>
      fn({
        query: (sql, params = []) => client.query(sql, params),
        run: async (sql, params = []) => {
          if (/RETURNING/i.test(sql)) {
            const res = await client.query(sql, params);
            return { changes: res.rows.length, rows: res.rows };
          }
          const res = await client.run(sql, params);
          return { changes: res.changes, lastId: res.lastID };
        },
      })
    );
  },

  isUniqueConflict(error) {
    if (!error) return false;
    if (error.code === 'SQLITE_CONSTRAINT' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return true;
    }
    return typeof error.message === 'string' && /UNIQUE constraint failed/i.test(error.message);
  },

  async close() {
    await storage.closeSqliteDb();
  },
};

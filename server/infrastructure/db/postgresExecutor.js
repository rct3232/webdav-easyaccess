'use strict';

const storage = require('../../store/storage');
const { mapDatabaseError } = require('../../utils/errorHandler');

// Single-column-PK cache for `RETURNING <pk>` injection (see executor spec
// §2.2 run): table name -> pk column or null (composite/none). Mirrors the
// behaviour that previously lived in the test-only dbUtils; it is a production
// contract now.
const pgPrimaryKeyCache = new Map();

async function getPgPrimaryKeyColumn(table) {
  if (pgPrimaryKeyCache.has(table)) return pgPrimaryKeyCache.get(table);
  const pool = storage.getPgPool();
  const { rows } = await pool.query(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a
         ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
        AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [table]
  );
  const column = rows.length === 1 ? rows[0].column_name : null;
  pgPrimaryKeyCache.set(table, column);
  return column;
}

/**
 * PostgreSQL implementation of the DbExecutor contract
 * (docs/spec/server/store/executor.md). Statements use `$n` placeholders; the
 * pool and BEGIN/COMMIT transaction helper live in `storage`.
 *
 * @type {import('./executor').DbExecutor}
 */
module.exports = {
  dialect: 'postgres',

  async query(sql, params = []) {
    try {
      const res = await storage.getPgPool().query(sql, params);
      return { rows: res.rows || [] };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  },

  async run(sql, params = []) {
    try {
      const pool = storage.getPgPool();
      let runSql = sql;
      const insertMatch = /^\s*INSERT\s+INTO\s+([^\s(]+)/i.exec(sql);
      if (insertMatch && !/RETURNING/i.test(sql)) {
        const pk = await getPgPrimaryKeyColumn(insertMatch[1]);
        if (pk) runSql = `${sql} RETURNING ${pk}`;
      }
      const res = await pool.query(runSql, params);
      const lastId = res.rows && res.rows[0] ? res.rows[0][Object.keys(res.rows[0])[0]] : undefined;
      return { changes: res.rowCount, lastId };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  },

  async transaction(fn) {
    // storage.withTransaction: BEGIN/COMMIT/ROLLBACK + client.release().
    return storage.withTransaction(async (client) =>
      fn({
        query: (sql, params = []) => client.query(sql, params),
        // run inside a transaction: no RETURNING injection (caller controls the
        // statement; ids come from the client's own RETURNING when needed).
        run: async (sql, params = []) => {
          const res = await client.query(sql, params);
          return { changes: res.rowCount, rows: res.rows || [] };
        },
      })
    );
  },

  isUniqueConflict(error) {
    return Boolean(error) && error.code === '23505';
  },

  async close() {
    await storage.closePgPool();
  },
};

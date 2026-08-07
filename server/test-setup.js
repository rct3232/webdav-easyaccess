/**
 * Jest global setup - runs before each test file.
 * Ensures test environment uses FS storage backend and skips default admin bootstrap.
 * @see docs/TEST_GIT_GUIDE.md
 * @see docs/TESTING_STRATEGY.md
 */
process.env.NODE_ENV = 'test';
process.env.WEA_DISABLE_DEFAULT_ADMIN = 'true';
process.env.WEA_STORAGE_BACKEND = process.env.WEA_STORAGE_BACKEND || 'sqlite';
process.env.WEA_SKIP_BULK_WORKER = '1';

// In the test environment the application pool (WEA_PG_DATABASE) must point at
// an isolated, disposable database. It defaults to `webdav_test` and can be
// overridden via WEA_PG_TEST_DATABASE. For non-PostgreSQL runs the variable is
// removed so SQLite suites never accidentally reach a real PG instance.
const backend = (process.env.WEA_STORAGE_BACKEND || '').toLowerCase();
if (backend === 'postgresql' || backend === 'postgres' || backend === 'pg') {
  process.env.WEA_PG_DATABASE = process.env.WEA_PG_TEST_DATABASE || 'webdav_test';
} else {
  delete process.env.WEA_PG_DATABASE;
}

// node-postgres returns BIGINT (int8) as strings by default. SQLite returns
// numbers, and tests assert numeric values (counts, ids). Normalize int8 →
// number for the whole test process so both backends behave identically.
// Production code already coerces ids with Number(), so this is a no-op there.
require('pg').types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

jest.spyOn(console, 'log').mockImplementation(() => {});

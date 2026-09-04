/**
 * Jest global setup - runs before each test file.
 * Guarantees jest never receives production WEA_DB_* credentials and disables
 * default-admin bootstrap.
 * @see docs/TEST_GIT_GUIDE.md
 * @see docs/TESTING_STRATEGY.md
 * @see docs/spec/server/store/storage.md §2.8 (test-only backend override)
 */
process.env.NODE_ENV = 'test';
process.env.WEA_DISABLE_DEFAULT_ADMIN = 'true';
process.env.WEA_SKIP_BULK_WORKER = '1';

// Production metadata-backend identity keys. Tests MUST NEVER run against them:
// the app's real database is selected by their presence (storage.getBackend),
// so a stray value here is how a test run can silently target the dev/prod DB.
const DB_IDENTITY_KEYS = ['WEA_DB_HOST', 'WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD'];

// Legacy jest-only markers removed (superseded by the WEA_TEST_PG_* namespace).
delete process.env.WEA_TEST_REMOTE;
delete process.env.WEA_DB_TEST_DATABASE;

// Absolute isolation: blank (not delete) the identity keys. Blanking keeps the
// key present so a later `dotenv` re-load of a developer .env by suites that
// require('./index') can never re-populate real credentials mid-run (dotenv
// override:false never overwrites a present key, and '' is treated as unset by
// the presence-based backend selector).
for (const key of DB_IDENTITY_KEYS) process.env[key] = '';

// Real-PostgreSQL test leg: driven by the dedicated WEA_TEST_PG_* namespace,
// consumed only by createTestDatabase() through the storage test-only override
// seam (never via env-presence selection). Hard fail on an unsafe database
// name so a mistyped value cannot point a test run at a real DB.
const TEST_PG_DATABASE_KEYS = ['WEA_TEST_PG_HOST', 'WEA_TEST_PG_PORT', 'WEA_TEST_PG_USER'];
if (process.env.WEA_TEST_PG_DATABASE) {
  const allowlisted = ['webdav_test', 'webdav_e2e'];
  if (!allowlisted.includes(process.env.WEA_TEST_PG_DATABASE)) {
    throw new Error(
      `Refusing real-PG test run: WEA_TEST_PG_DATABASE="${process.env.WEA_TEST_PG_DATABASE}" is not an ` +
        `allowlisted disposable test database (${allowlisted.join(' / ')}).`
    );
  }
  for (const key of TEST_PG_DATABASE_KEYS) {
    if (process.env[key] === undefined) process.env[key] = '';
  }
}

// node-postgres returns BIGINT (int8) as strings by default. SQLite returns
// numbers, and tests assert numeric values (counts, ids). Normalize int8 →
// number for the whole test process so both backends behave identically.
// Production code already coerces ids with Number(), so this is a no-op there.
require('pg').types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

jest.spyOn(console, 'log').mockImplementation(() => {});

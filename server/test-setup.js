/**
 * Jest global setup - runs before each test file.
 * Ensures test environment uses FS storage backend and skips default admin bootstrap.
 * @see docs/TEST_GIT_GUIDE.md
 * @see docs/TESTING_STRATEGY.md
 */
process.env.NODE_ENV = 'test';
process.env.WEA_DISABLE_DEFAULT_ADMIN = 'true';
process.env.WEA_SKIP_BULK_WORKER = '1';

// Metadata-backend selection is presence-based (storage.getBackend): any of
// the four identity keys set → remote PostgreSQL; none set → sqlite. The test
// backend mode is decided by the WEA_TEST_REMOTE marker (injected by
// `test:ci:pg` in package.json), NOT by the presence of leftover identity keys
// in the shared process.env — a suite that mutates the identity keys without
// restoring them must never flip a later suite to PostgreSQL.
//
// Under the non-remote mode the identity keys are set to EMPTY STRINGS (not
// deleted): suites that `require('./index')` later re-load the repo .env via
// dotenv (override:false), which would otherwise re-populate a developer's
// real WEA_DB_* block and silently boot PostgreSQL mid-suite. dotenv never
// overrides an already-present key, and the backend logic treats '' as unset.
const DB_IDENTITY_KEYS = ['WEA_DB_HOST', 'WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD'];
if (process.env.WEA_TEST_REMOTE === '1') {
  // Isolated, disposable database: defaults to `webdav_test`, overridable via
  // WEA_DB_TEST_DATABASE. Missing identity keys are filled so the backend is a
  // complete remote configuration.
  process.env.WEA_DB_HOST = process.env.WEA_DB_HOST || '127.0.0.1';
  process.env.WEA_DB_PORT = process.env.WEA_DB_PORT || '5433';
  process.env.WEA_DB_USER = process.env.WEA_DB_USER || 'e2etest';
  process.env.WEA_DB_PASSWORD = process.env.WEA_DB_PASSWORD || 'e2etest';
  process.env.WEA_DB_DATABASE = process.env.WEA_DB_TEST_DATABASE || 'webdav_test';
} else {
  for (const key of DB_IDENTITY_KEYS) process.env[key] = '';
  delete process.env.WEA_DB_TEST_DATABASE;
}

// node-postgres returns BIGINT (int8) as strings by default. SQLite returns
// numbers, and tests assert numeric values (counts, ids). Normalize int8 →
// number for the whole test process so both backends behave identically.
// Production code already coerces ids with Number(), so this is a no-op there.
require('pg').types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

jest.spyOn(console, 'log').mockImplementation(() => {});

/**
 * createTestDatabase WEA_SQLITE_PATH restore contract (register (f)):
 * cleanup must DELETE the env var when it was unset before the call — a literal
 * 'undefined' leaks into suites sharing the worker and stray `./undefined`
 * SQLite files. A set previous value must be restored verbatim.
 */
const fs = require('fs');
const { createTestDatabase } = require('../test-utils');
const storage = require('../store/storage');

describe('createTestDatabase WEA_SQLITE_PATH restore', () => {
  afterEach(async () => {
    try {
      await storage.closeSqliteDb();
    } catch {
      /* ignore */
    }
    delete process.env.WEA_SQLITE_PATH;
  });

  it('deletes WEA_SQLITE_PATH after cleanup when it was unset before', async () => {
    delete process.env.WEA_SQLITE_PATH;
    const { cleanup, dir } = await createTestDatabase();
    try {
      expect(process.env.WEA_SQLITE_PATH).toBeDefined();
    } finally {
      await cleanup();
    }
    expect(process.env.WEA_SQLITE_PATH).toBeUndefined();
    if (dir) fs.rmSync(dir, { force: true });
  });

  it('restores a previously set WEA_SQLITE_PATH verbatim', async () => {
    process.env.WEA_SQLITE_PATH = '/tmp/wea-prev-check.db';
    const { cleanup, dir } = await createTestDatabase();
    try {
      expect(process.env.WEA_SQLITE_PATH).not.toBe('/tmp/wea-prev-check.db');
    } finally {
      await cleanup();
    }
    expect(process.env.WEA_SQLITE_PATH).toBe('/tmp/wea-prev-check.db');
    if (dir) fs.rmSync(dir, { force: true });
  });
});

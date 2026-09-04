'use strict';

/**
 * Unit tests for the passive metadata-presence detector
 * (docs/spec/server/tools/metadata-migration.md §4, PLAN D13).
 *
 * The detector probes the NON-active metadata backend. getBackend() is mocked
 * so the test controls which backend is "active":
 *   active=postgresql -> other=sqlite  (detectSqlitePresence)
 *   active=sqlite     -> other=postgresql (detectPostgresPresence)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

jest.mock('../../store/storage', () => ({ getBackend: jest.fn() }));
const { getBackend } = require('../../store/storage');

jest.mock('pg', () => ({ Client: jest.fn() }));
const { Client: MockPgClient } = require('pg');

const {
  getOtherBackend,
  checkMetadataPresence,
  clearPresenceCache,
} = require('../metadataPresence');

function makePgClient({ relation, count }) {
  const query = jest.fn();
  if (relation) {
    query.mockResolvedValueOnce({ rows: [{ relation }] });
    query.mockResolvedValue({ rows: [{ count: String(count) }] });
  } else {
    query.mockResolvedValue({ rows: [{ relation: null }] });
  }
  const client = {
    query,
    connect: jest.fn().mockResolvedValue(),
    end: jest.fn().mockResolvedValue(),
  };
  return client;
}

function openDbAt(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
}

let tmpDir;
let nowSpy;
const realNow = Date.now.bind(Date);

const SAVED_SQLITE_PATH = process.env.WEA_SQLITE_PATH;

// WEA_DB_* keys this suite drives. Backend selection is presence-based, so
// each test opts into a remote (PG) scenario explicitly. The prior values are
// snapshotted and restored so sibling suites never inherit a leftover identity
// set (which would silently flip them to the remote backend).
const DB_TEST_KEYS = [
  'WEA_DB_HOST',
  'WEA_DB_PORT',
  'WEA_DB_DATABASE',
  'WEA_DB_USER',
  'WEA_DB_PASSWORD',
];

const SAVED_DB_ENV = {};
for (const key of DB_TEST_KEYS) SAVED_DB_ENV[key] = process.env[key];

function setDbEnv() {
  process.env.WEA_DB_HOST = '127.0.0.1';
  process.env.WEA_DB_PORT = '5432';
  process.env.WEA_DB_DATABASE = 'db';
  process.env.WEA_DB_USER = 'u';
  process.env.WEA_DB_PASSWORD = 'p';
}

function restoreDbEnv() {
  for (const key of DB_TEST_KEYS) {
    if (SAVED_DB_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_DB_ENV[key];
  }
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-presence-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearPresenceCache();
  jest.clearAllMocks();
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow());
  // Unset the WEA_DB_* env so each test opts in explicitly (no identity key
  // set → sqlite is the default backend).
  for (const key of DB_TEST_KEYS) {
    delete process.env[key];
  }
  delete process.env.WEA_STORAGE_BACKEND;
});

afterEach(() => {
  nowSpy.mockRestore();
  if (SAVED_SQLITE_PATH === undefined) delete process.env.WEA_SQLITE_PATH;
  else process.env.WEA_SQLITE_PATH = SAVED_SQLITE_PATH;
  // Restore the prior WEA_DB_* state (sqlite default under test:ci; the real
  // remote identity set under test:ci:pg) so sibling suites are unaffected.
  restoreDbEnv();
  delete process.env.WEA_STORAGE_BACKEND;
});

describe('getOtherBackend', () => {
  it('returns the non-active metadata backend', () => {
    getBackend.mockReturnValue('sqlite');
    expect(getOtherBackend()).toBe('postgresql');
    getBackend.mockReturnValue('postgresql');
    expect(getOtherBackend()).toBe('sqlite');
  });
});

describe('SQLite detection (active backend = postgresql)', () => {
  beforeEach(() => {
    getBackend.mockReturnValue('postgresql');
  });

  it('returns otherHasData=false and does not create the file when it is missing', async () => {
    const dbPath = path.join(tmpDir, 'missing.db');
    process.env.WEA_SQLITE_PATH = dbPath;

    const result = await checkMetadataPresence();
    expect(result.otherBackend).toBe('sqlite');
    expect(result.otherHasData).toBe(false);
    expect(result.settingsRows).toBeNull();
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('returns otherHasData=false for an empty settings table', async () => {
    const dbPath = path.join(tmpDir, 'empty.db');
    process.env.WEA_SQLITE_PATH = dbPath;
    const db = await openDbAt(dbPath);
    await run(db, 'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
    await closeDb(db);

    const result = await checkMetadataPresence();
    expect(result.otherBackend).toBe('sqlite');
    expect(result.otherHasData).toBe(false);
    expect(result.settingsRows).toBe(0);
  });

  it('returns otherHasData=true with the settings row count when data is present', async () => {
    const dbPath = path.join(tmpDir, 'populated.db');
    process.env.WEA_SQLITE_PATH = dbPath;
    const db = await openDbAt(dbPath);
    await run(db, 'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
    await run(db, "INSERT INTO settings (key, value) VALUES ('k1', 'v1')");
    await run(db, "INSERT INTO settings (key, value) VALUES ('k2', 'v2')");
    await closeDb(db);

    const result = await checkMetadataPresence();
    expect(result.otherHasData).toBe(true);
    expect(result.settingsRows).toBe(2);
  });

  it('reports a DB error without throwing when the file is corrupt/unreadable', async () => {
    const dbPath = path.join(tmpDir, 'garbage.db');
    process.env.WEA_SQLITE_PATH = dbPath;
    fs.writeFileSync(dbPath, 'this is not a database');

    let result;
    try {
      result = await checkMetadataPresence();
    } catch (error) {
      throw new Error(`checkMetadataPresence must never throw, but threw: ${error.message}`);
    }
    expect(result.error).toBeDefined();
    expect(result.otherHasData).toBe(false);
  });
});

describe('PostgreSQL detection (active backend = sqlite)', () => {
  beforeEach(() => {
    getBackend.mockReturnValue('sqlite');
  });

  it('returns an error note and never throws when PG is unconfigured', async () => {
    let result;
    try {
      result = await checkMetadataPresence();
    } catch (error) {
      throw new Error(`checkMetadataPresence must never throw, but threw: ${error.message}`);
    }

    expect(result.otherBackend).toBe('postgresql');
    expect(result.otherHasData).toBe(false);
    expect(result.settingsRows).toBeNull();
    expect(result.error).toMatch(/PostgreSQL is not configured/);
    expect(MockPgClient).not.toHaveBeenCalled();
  });

  it('returns otherHasData=false when the settings table does not exist', async () => {
    setDbEnv();
    MockPgClient.mockImplementation(() => makePgClient({ relation: null }));

    const result = await checkMetadataPresence();
    expect(result.otherBackend).toBe('postgresql');
    expect(result.otherHasData).toBe(false);
    expect(result.settingsRows).toBeNull();
    const client = MockPgClient.mock.results[0].value;
    expect(client.connect).toHaveBeenCalled();
  });

  it('returns otherHasData=false when settings exists with zero rows', async () => {
    setDbEnv();
    MockPgClient.mockImplementation(() => makePgClient({ relation: 'public.settings', count: 0 }));

    const result = await checkMetadataPresence();
    expect(result.otherHasData).toBe(false);
    expect(result.settingsRows).toBe(0);
  });

  it('returns otherHasData=true with the row count when settings has rows', async () => {
    setDbEnv();
    MockPgClient.mockImplementation(() => makePgClient({ relation: 'public.settings', count: 3 }));

    const result = await checkMetadataPresence();
    expect(result.otherHasData).toBe(true);
    expect(result.settingsRows).toBe(3);
    const client = MockPgClient.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith(`SELECT to_regclass('public.settings') AS relation`);
    expect(client.query).toHaveBeenCalledWith(`SELECT COUNT(*) AS count FROM settings`);
  });
});

describe('TTL cache behavior', () => {
  beforeEach(() => {
    getBackend.mockReturnValue('sqlite');
    setDbEnv();
  });

  it('reuses the cached result within the TTL (no re-probe)', async () => {
    let calls = 0;
    MockPgClient.mockImplementation(() => {
      calls += 1;
      return makePgClient({ relation: 'public.settings', count: 2 });
    });

    const first = await checkMetadataPresence();
    const second = await checkMetadataPresence();

    expect(calls).toBe(1);
    expect(first).toEqual(second);
  });

  it('re-probes after the TTL expires', async () => {
    let calls = 0;
    MockPgClient.mockImplementation(() => {
      calls += 1;
      return makePgClient({ relation: 'public.settings', count: 2 });
    });

    await checkMetadataPresence();
    nowSpy.mockReturnValue(realNow() + 60_001);

    await checkMetadataPresence();
    expect(calls).toBe(2);
  });

  it('clearPresenceCache forces a re-probe', async () => {
    let calls = 0;
    MockPgClient.mockImplementation(() => {
      calls += 1;
      return makePgClient({ relation: 'public.settings', count: 2 });
    });

    await checkMetadataPresence();
    clearPresenceCache();
    await checkMetadataPresence();
    expect(calls).toBe(2);
  });
});

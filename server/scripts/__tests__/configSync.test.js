'use strict';

/**
 * CLI config-sync tool tests (server/scripts/configSync.js).
 * Hermetic per the setupCli.test.js pattern: throwaway temp dir with a real
 * .env file + sqlite DB (WEA_SQLITE_PATH + DOTENV_CONFIG_PATH), all registry
 * env keys saved/deleted/restored per test, closeSqliteDb() per test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require('../configSync');
const { getEntries } = require('../../infrastructure/configRegistry');
const { closeSqliteDb } = require('../../store/storage');
const { initMetadataSchema } = require('../../store/bootstrap');
const Settings = require('../../models/Settings');

// Every registry key is read from process.env by the CLI; save at load time
// and restore after every test so no test leaks config into another.
const MANAGED_KEYS = getEntries().map((entry) => entry.key);

const SAVED_ENV = {};

function makeOutput() {
  const lines = { log: [], error: [], warn: [] };
  return {
    output: {
      log: (...args) => lines.log.push(args.join(' ')),
      error: (...args) => lines.error.push(args.join(' ')),
      warn: (...args) => lines.warn.push(args.join(' ')),
    },
    lines,
  };
}

const NON_TTY_INPUT = { isTTY: false };

let tmpDir;
let envPath;
let dbPath;

beforeAll(() => {
  for (const key of MANAGED_KEYS) SAVED_ENV[key] = process.env[key];
});

afterEach(async () => {
  try {
    await closeSqliteDb();
  } catch {
    // best-effort
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const key of MANAGED_KEYS) {
    if (SAVED_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_ENV[key];
  }
  jest.restoreAllMocks();
  // test-setup.js silences console.log; restoreAllMocks undoes that, so re-mute.
  jest.spyOn(console, 'log').mockImplementation(() => {});
  tmpDir = undefined;
});

function freshScratchEnv() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-sync-'));
  envPath = path.join(tmpDir, '.env');
  dbPath = path.join(tmpDir, 'store.db');
  for (const key of MANAGED_KEYS) delete process.env[key];
  process.env.WEA_STORAGE_BACKEND = 'sqlite';
  process.env.WEA_SQLITE_PATH = dbPath;
  process.env.DOTENV_CONFIG_PATH = envPath;
  // Always write a real .env file so loadDotenv resolves it (never the repo
  // .env); baseline content only.
  fs.writeFileSync(envPath, 'WEA_STORAGE_BACKEND=sqlite\n');
  return { envPath, dbPath };
}

// Set env vars AND mirror them into the scratch .env file (the value the
// server boot would read), matching the setupCli convention of driving the
// CLI through process.env.
function seedEnv(entries) {
  const lines = ['WEA_STORAGE_BACKEND=sqlite'];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`${key}=${value}`);
    process.env[key] = String(value);
  }
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
}

async function seedDbRows() {
  await initMetadataSchema();
}

describe('configSync.js --check', () => {
  it('fresh env with no DB rows exits 0 with zero drift and excludes T0 keys', async () => {
    freshScratchEnv();
    seedEnv({ PORT: '5001', JWT_SECRET: 'jwt-t0-secret' });
    await seedDbRows();
    const { output, lines } = makeOutput();

    const code = await main(['--check'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toContain('env-only');
    expect(all).toContain('PORT');
    expect(all).not.toContain('JWT_SECRET');
    expect(all).not.toContain('differs');
    expect(all).toMatch(/summary: drift: 0, informational: 1/);
  });

  it('a DB row equal to the env value is shadowed (informational), exit 0', async () => {
    freshScratchEnv();
    seedEnv({ PORT: '5001', EMAIL_HOST: 'smtp.example.com' });
    await seedDbRows();
    await Settings.set('PORT', '5001');
    const { output, lines } = makeOutput();

    const code = await main(['--check'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toMatch(/shadowed\s+PORT/);
    expect(all).toMatch(/env-only\s+EMAIL_HOST/);
    expect(all).toMatch(/summary: drift: 0, informational: 2/);
  });

  it('a DB row differing from the env value is drift, exit 1, with db_updated_at', async () => {
    freshScratchEnv();
    seedEnv({ PORT: '5001', CORS_ORIGINS: 'http://localhost:3000' });
    await seedDbRows();
    await Settings.set('PORT', '6001');
    await Settings.set('EMAIL_HOST', 'db-only-host.example.com');
    const { output, lines } = makeOutput();

    const code = await main(['--check'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    const all = lines.log.join('\n');
    expect(all).toMatch(/differs\s+PORT/);
    expect(all).toMatch(/db_updated_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    expect(all).toMatch(/db-only\s+EMAIL_HOST/);
    expect(all).toMatch(/env-only\s+CORS_ORIGINS/);
    expect(all).toMatch(/summary: drift: 1, informational: 2/);
    expect(all).toMatch(/exit code: 1/);
    // drift is reported, but no plaintext value is ever echoed
    expect(all).not.toContain('6001');
    expect(all).not.toContain('db-only-host.example.com');
  });

  it('a differing secret row is drift, exit 1, and the secret is masked', async () => {
    freshScratchEnv();
    seedEnv({ WEBDAV_PASSWORD: 'new-pass' });
    await seedDbRows();
    await Settings.set('WEBDAV_PASSWORD', 'old-pass');
    const { output, lines } = makeOutput();

    const code = await main(['--check'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toMatch(/differs\s+WEBDAV_PASSWORD/);
    expect(all).toContain('****');
    expect(all).not.toContain('old-pass');
    expect(all).not.toContain('new-pass');
    expect(all).toMatch(/summary: drift: 1, informational: 0/);
  });

  it('an equal secret row is shadowed (compared as plaintext), exit 0, masked', async () => {
    freshScratchEnv();
    seedEnv({ WEBDAV_PASSWORD: 'same-pass' });
    await seedDbRows();
    await Settings.set('WEBDAV_PASSWORD', 'same-pass');
    const { output, lines } = makeOutput();

    const code = await main(['--check'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toMatch(/shadowed\s+WEBDAV_PASSWORD/);
    expect(all).toContain('****');
    expect(all).not.toContain('same-pass');
    expect(all).toMatch(/summary: drift: 0, informational: 1/);
  });

  it('a db-only secret row is informational (shadowed/env/db classification), exit 0', async () => {
    freshScratchEnv();
    await seedDbRows();
    await Settings.set('EMAIL_PASSWORD', 'stored-secret');
    const { output, lines } = makeOutput();

    const code = await main(['--check'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toMatch(/db-only\s+EMAIL_PASSWORD/);
    expect(all).not.toContain('stored-secret');
    expect(all).toMatch(/summary: drift: 0, informational: 1/);
  });

  it('--json emits a machine-readable report with stable fields', async () => {
    freshScratchEnv();
    seedEnv({ PORT: '5001', WEBDAV_PASSWORD: 'json-pass' });
    await seedDbRows();
    await Settings.set('PORT', '6001');
    await Settings.set('WEBDAV_PASSWORD', 'json-old-pass');
    const { output, lines } = makeOutput();

    const code = await main(['--check', '--json'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    const report = JSON.parse(lines.log[0]);
    expect(Array.isArray(report.findings)).toBe(true);
    const port = report.findings.find((f) => f.key === 'PORT');
    expect(port.status).toBe('differs');
    expect(port.secret).toBe(false);
    expect(typeof port.dbUpdatedAt).toBe('string');
    expect(new Date(port.dbUpdatedAt).getTime()).not.toBeNaN();
    const secret = report.findings.find((f) => f.key === 'WEBDAV_PASSWORD');
    expect(secret.status).toBe('differs');
    expect(secret.secret).toBe(true);
    expect(report.summary).toEqual({
      drift: 2,
      shadowed: 0,
      envOnly: 0,
      dbOnly: 0,
      total: 2,
    });
    expect(report.exitCode).toBe(1);
    const serialized = lines.log.join('\n');
    expect(serialized).not.toContain('json-old-pass');
    expect(serialized).not.toContain('json-pass');
  });
});

describe('configSync.js --apply', () => {
  it('--apply without --yes is a usage error (exit 2) and writes nothing', async () => {
    freshScratchEnv();
    seedEnv({ PORT: '5001' });
    const { output, lines } = makeOutput();

    const code = await main(['--apply'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/requires --yes/);
    expect(lines.log.join('\n')).toBe('');
  });

  it('--apply --yes mirrors .env into the DB as plaintext (secrets included), never writes T0, and the post-apply check is clean', async () => {
    freshScratchEnv();
    seedEnv({
      PORT: '5001',
      WEBDAV_URL: 'https://dav.example.com',
      WEBDAV_PASSWORD: 'dav-pass',
      JWT_SECRET: 'jwt-t0-secret',
    });
    await seedDbRows();
    await Settings.set('PORT', '6001'); // drift -> updated
    await Settings.set('WEBDAV_URL', 'https://dav.example.com'); // equal -> unchanged
    await Settings.set('WEBDAV_PASSWORD', 'old-pass'); // drift -> updated
    const { output, lines } = makeOutput();

    const code = await main(['--apply', '--yes'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toMatch(/updated\s+PORT/);
    expect(all).toMatch(/unchanged\s+WEBDAV_URL/);
    expect(all).toMatch(/updated\s+WEBDAV_PASSWORD/);
    expect(all).not.toContain('dav-pass');
    expect(all).not.toContain('old-pass');
    expect(all).not.toContain('jwt-t0-secret');
    expect(all).toMatch(/summary: drift: 0, informational: 3/);

    const rows = await Settings.getAll();
    expect(rows.PORT).toBe('5001');
    expect(rows.WEBDAV_URL).toBe('https://dav.example.com');
    expect(rows.WEBDAV_PASSWORD).toBe('dav-pass');
    // T0 keys are never written to the DB
    expect(rows).not.toHaveProperty('JWT_SECRET');
    expect(rows).not.toHaveProperty('WEA_STORAGE_BACKEND');
  });
});

'use strict';

/**
 * CLI setup tool tests (server/scripts/setup.js).
 * Uses a real, isolated sqlite store on a throwaway temp dir per test
 * (WEA_SQLITE_PATH + DOTENV_CONFIG_PATH) so .env writes and DB rows are real
 * but fully hermetic. bcrypt hashing is real; ~8 tests each create/seed the
 * default admin once, which keeps the suite fast.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

const { main } = require('../setup');
const { closeSqliteDb } = require('../../store/storage');
const Settings = require('../../models/Settings');
const User = require('../../models/User');
const backendProbe = require('../../infrastructure/backendProbe');

// Keys the CLI boot/apply reads or writes. Saved at load time (after the
// shared test-setup.js ran) and restored after every test.
const MANAGED_KEYS = [
  'NODE_ENV',
  'WEA_SQLITE_PATH',
  'WEA_DISABLE_DEFAULT_ADMIN',
  'ADMIN_DEFAULT_PASSWORD',
  'DOTENV_CONFIG_PATH',
  'WEA_FILE_STORAGE',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'S3_BUCKET',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'WEBDAV_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_AUTH_TYPE',
  'PORT',
  'CORS_ORIGINS',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'EMAIL_SECURE',
  'EMAIL_FROM_NAME',
  'WEA_SETUP_ADMIN_PASSWORD',
  'WEA_SETUP_WEBDAV_PASSWORD',
  'WEA_SETUP_AWS_SECRET_ACCESS_KEY',
  'WEA_SETUP_JWT_SECRET',
  'WEA_DB_HOST',
  'WEA_DB_PORT',
  'WEA_DB_DATABASE',
  'WEA_DB_USER',
  'WEA_DB_PASSWORD',
  'WEA_DB_SSL',
  'WEA_DB_MAX',
];

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

function setBaselineSqliteEnv() {
  for (const key of MANAGED_KEYS) delete process.env[key];
  // No WEA_DB_* identity key set → the metadata backend defaults to sqlite
  // (presence-based; there is no WEA_STORAGE_BACKEND switch anymore).
  delete process.env.WEA_STORAGE_BACKEND;
}

function setCompleteWebdavEnv() {
  setBaselineSqliteEnv();
  process.env.WEA_FILE_STORAGE = 'webdav';
  process.env.WEBDAV_URL = 'https://dav.example.com';
  process.env.WEBDAV_USERNAME = 'dav-user';
  process.env.WEBDAV_PASSWORD = 'dav-pass';
  process.env.JWT_SECRET = 'already-configured-jwt';
}

function readEnvFile(envPath) {
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-cli-'));
  envPath = path.join(tmpDir, '.env');
  dbPath = path.join(tmpDir, 'store.db');
  setBaselineSqliteEnv();
  process.env.WEA_SQLITE_PATH = dbPath;
  process.env.DOTENV_CONFIG_PATH = envPath;
  return { tmpDir, envPath, dbPath };
}

function webdavApplyArgs(overrides = {}) {
  const args = [
    '--yes',
    '--file-backend=webdav',
    '--webdav-url=https://dav.example.com',
    '--webdav-username=dav-user',
    '--webdav-password=dav-pass',
    '--admin-password=new-admin-pass',
    '--jwt-expires-in=30m',
  ];
  if (overrides.withoutPassword) args.splice(args.indexOf('--webdav-password=dav-pass'), 1);
  if (overrides.withoutAdminPassword)
    args.splice(args.indexOf('--admin-password=new-admin-pass'), 1);
  return args;
}

describe('setup.js --help and usage handling', () => {
  it('--help prints the flag reference and exits 0 without booting the store', async () => {
    const { tmpDir: dir, envPath: file } = freshScratchEnv();
    const { output, lines } = makeOutput();

    const code = await main(['--help'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toContain('Usage:');
    expect(all).toContain('--file-backend');
    expect(all).toContain('--admin-password');
    expect(all).toContain('--check');
    expect(all).toContain('--yes');
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'store.db'))).toBe(false);
  });

  it('no flags on a non-TTY stdin exits 2 (usage) and writes nothing', async () => {
    const { tmpDir: dir, envPath: file } = freshScratchEnv();
    const { output, lines } = makeOutput();

    const code = await main([], { output, input: NON_TTY_INPUT });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/interactive terminal/);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'store.db'))).toBe(false);
  });

  it('an unknown flag exits 2 (usage) and writes nothing', async () => {
    const { tmpDir: dir, envPath: file } = freshScratchEnv();
    const { output, lines } = makeOutput();

    const code = await main(['--yes', '--bogus=1'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/Unknown flag: --bogus/);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'store.db'))).toBe(false);
  });

  it('--yes without credentials is a validation failure (exit 1), nothing written', async () => {
    const { envPath } = freshScratchEnv();
    const { output, lines } = makeOutput();

    const code = await main(['--yes'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toMatch(/Invalid setup payload/);
    expect(fs.existsSync(envPath)).toBe(false);
  });
});

describe('setup.js --status', () => {
  it('prints the derived state with masked secrets and exits 0 when incomplete', async () => {
    freshScratchEnv();
    process.env.WEA_FILE_STORAGE = 's3';
    process.env.JWT_SECRET = 'super-secret-jwt';
    const { output, lines } = makeOutput();

    const code = await main(['--status'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const jsonLine = lines.log.find((line) => line.startsWith('{'));
    expect(jsonLine).toBeTruthy();
    const status = JSON.parse(jsonLine);
    expect(status.setup_complete).toBe(false);
    expect(status.missing).toEqual([
      'S3_BUCKET',
      'AWS_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
    ]);
    expect(status.current.WEA_FILE_STORAGE).toBe('s3');
    expect(status.current.JWT_SECRET).toBe('****');
    const serialized = lines.log.join('\n');
    expect(serialized).not.toContain('super-secret-jwt');
  });
});

describe('setup.js apply guard rails', () => {
  it('an apply missing required secret fields exits 1 with field details and writes nothing', async () => {
    const { envPath } = freshScratchEnv();
    const { output, lines } = makeOutput();

    const code = await main(webdavApplyArgs({ withoutPassword: true }), {
      output,
      input: NON_TTY_INPUT,
    });

    expect(code).toBe(1);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toMatch(/Invalid setup payload/);
    expect(all).toMatch(/password/);
    expect(fs.existsSync(envPath)).toBe(false);
    expect(Object.keys(await Settings.getAll())).toHaveLength(0);

    const admin = await User.findByUsername('admin');
    expect(await bcrypt.compare('admin', admin.password)).toBe(true);
  });

  it('an apply without --yes on a non-TTY exits 2 (usage) and writes nothing', async () => {
    const { envPath } = freshScratchEnv();
    const { output, lines } = makeOutput();
    const args = webdavApplyArgs().filter((arg) => arg !== '--yes');

    const code = await main(args, { output, input: NON_TTY_INPUT });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/requires --yes/);
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('refuses (exit 1, no writes) when setup is already complete', async () => {
    const { envPath } = freshScratchEnv();
    setCompleteWebdavEnv();
    process.env.WEA_SQLITE_PATH = dbPath;
    process.env.DOTENV_CONFIG_PATH = envPath;
    const { output, lines } = makeOutput();

    const code = await main(webdavApplyArgs(), { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    expect(lines.error.join('\n')).toMatch(/already complete/);
    expect(fs.existsSync(envPath)).toBe(false);
    expect(Object.keys(await Settings.getAll())).toHaveLength(0);
  });
});

describe('setup.js apply happy path (throwaway sqlite store)', () => {
  it('applies the full webdav config, writes .env 0600, upserts plaintext DB rows, updates the admin password, and flips status to complete', async () => {
    const { envPath } = freshScratchEnv();
    const { output, lines } = makeOutput();
    const args = [
      '--yes',
      '--file-backend=webdav',
      '--webdav-url=https://dav.example.com',
      '--webdav-username=dav-user',
      '--webdav-password=dav-pass',
      '--webdav-auth-type=auto',
      '--admin-password=new-admin-pass',
      '--jwt-secret=explicit-jwt-secret',
      '--jwt-expires-in=30m',
      '--port=5001',
      '--cors-origins=http://localhost:3000',
      '--email-host=smtp.example.com',
      '--email-port=587',
      '--email-user=mail-user',
      '--email-password=mail-pass',
      '--email-secure=false',
      '--email-from=WebDAV',
    ];

    const code = await main(args, { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const allOut = [...lines.log, ...lines.error].join('\n');
    expect(allOut).toMatch(/Setup configuration applied successfully/);
    expect(allOut).toContain('"restart_required":true');
    expect(allOut).toMatch(/restart_required/);
    expect(allOut).not.toContain('dav-pass');
    expect(allOut).not.toContain('new-admin-pass');
    expect(allOut).not.toContain('mail-pass');

    expect(fs.existsSync(envPath)).toBe(true);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
    const env = readEnvFile(envPath);
    expect(env.JWT_SECRET).toBe('explicit-jwt-secret');
    expect(env).not.toHaveProperty('encrypt_secret_key');
    for (const key of [
      'WEA_DB_HOST',
      'WEA_DB_PASSWORD',
      'WEA_FILE_STORAGE',
      'WEBDAV_URL',
      'WEBDAV_USERNAME',
      'EMAIL_HOST',
      'EMAIL_PASSWORD',
    ]) {
      expect(env).not.toHaveProperty(key);
    }

    const rows = await Settings.getAll();
    expect(rows.WEA_FILE_STORAGE).toBe('webdav');
    expect(rows.WEBDAV_URL).toBe('https://dav.example.com');
    expect(rows.WEBDAV_USERNAME).toBe('dav-user');
    expect(rows.WEBDAV_AUTH_TYPE).toBe('auto');
    expect(rows.PORT).toBe('5001');
    expect(rows.CORS_ORIGINS).toBe('http://localhost:3000');
    expect(rows.JWT_EXPIRES_IN).toBe('30m');
    expect(rows.EMAIL_HOST).toBe('smtp.example.com');
    expect(rows.WEBDAV_PASSWORD).toBe('dav-pass');
    expect(rows.EMAIL_PASSWORD).toBe('mail-pass');
    expect(rows).not.toHaveProperty('JWT_SECRET');

    const admin = await User.findByUsername('admin');
    expect(admin).toBeTruthy();
    expect(await bcrypt.compare('new-admin-pass', admin.password)).toBe(true);
    expect(await bcrypt.compare('admin', admin.password)).toBe(false);

    // A "fresh boot after restart" sees the newly written .env and reports complete.
    const statusOut = makeOutput();
    const statusCode = await main(['--status'], { output: statusOut.output, input: NON_TTY_INPUT });
    expect(statusCode).toBe(0);
    const status = JSON.parse(statusOut.lines.log.find((line) => line.startsWith('{')));
    expect(status.setup_complete).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it('accepts secrets from WEA_SETUP_* env vars, never echoes them, and writes no .env when no JWT secret is supplied', async () => {
    const { envPath } = freshScratchEnv();
    process.env.WEA_SETUP_ADMIN_PASSWORD = 'env-admin-pass';
    process.env.WEA_SETUP_WEBDAV_PASSWORD = 'env-webdav-pass';
    const { output, lines } = makeOutput();
    const args = [
      '--yes',
      '--file-backend=webdav',
      '--webdav-url=https://dav.example.com',
      '--webdav-username=dav-user',
    ];

    const code = await main(args, { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const allOut = [...lines.log, ...lines.error].join('\n');
    expect(allOut).not.toContain('env-webdav-pass');
    expect(allOut).not.toContain('env-admin-pass');

    // No --jwt-secret / WEA_SETUP_JWT_SECRET supplied: JWT_SECRET is optional
    // and nothing is written to .env (the server signs with an ephemeral
    // per-boot secret), so the .env partition is empty and no file is created.
    expect(fs.existsSync(envPath)).toBe(false);
    const rows = await Settings.getAll();
    expect(rows.WEBDAV_PASSWORD).toBe('env-webdav-pass');
    expect(rows).not.toHaveProperty('JWT_SECRET');

    const admin = await User.findByUsername('admin');
    expect(await bcrypt.compare('env-admin-pass', admin.password)).toBe(true);
  });

  it('writes JWT_SECRET to .env when supplied via the WEA_SETUP_JWT_SECRET env var', async () => {
    const { envPath } = freshScratchEnv();
    process.env.WEA_SETUP_ADMIN_PASSWORD = 'env-admin-pass';
    process.env.WEA_SETUP_WEBDAV_PASSWORD = 'env-webdav-pass';
    process.env.WEA_SETUP_JWT_SECRET = 'env-supplied-jwt-secret';
    const { output, lines } = makeOutput();
    const args = [
      '--yes',
      '--file-backend=webdav',
      '--webdav-url=https://dav.example.com',
      '--webdav-username=dav-user',
    ];

    const code = await main(args, { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const allOut = [...lines.log, ...lines.error].join('\n');
    expect(allOut).not.toContain('env-supplied-jwt-secret');

    expect(fs.existsSync(envPath)).toBe(true);
    const env = readEnvFile(envPath);
    expect(env.JWT_SECRET).toBe('env-supplied-jwt-secret');
    expect(env).not.toHaveProperty('encrypt_secret_key');
    const rows = await Settings.getAll();
    expect(rows.WEBDAV_PASSWORD).toBe('env-webdav-pass');

    const admin = await User.findByUsername('admin');
    expect(await bcrypt.compare('env-admin-pass', admin.password)).toBe(true);
  });
});

describe('setup.js --check', () => {
  it('runs the probe with the supplied credentials and exits 0, without booting the store', async () => {
    const { tmpDir: dir, envPath: file } = freshScratchEnv();
    const probeSpy = jest.spyOn(backendProbe, 'runProbe').mockResolvedValue({ ok: true });
    const { output } = makeOutput();

    const code = await main(
      [
        '--check',
        '--file-backend=webdav',
        '--webdav-url=https://dav.example.com',
        '--webdav-username=u',
        '--webdav-password=p',
      ],
      { output, input: NON_TTY_INPUT }
    );

    expect(code).toBe(0);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(probeSpy.mock.calls[0][0]).toBe('webdav');
    expect(probeSpy.mock.calls[0][1]).toEqual({
      url: 'https://dav.example.com',
      username: 'u',
      password: 'p',
    });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'store.db'))).toBe(false);
  });

  it('maps a probe failure to exit 1', async () => {
    freshScratchEnv();
    jest.spyOn(backendProbe, 'runProbe').mockRejectedValue(
      Object.assign(new Error('Access Denied'), {
        errorCode: 'serverErrors.setup.test.s3.accessDenied',
        reason: 'AccessDenied',
      })
    );
    const { output, lines } = makeOutput();

    const code = await main(
      [
        '--check',
        '--file-backend=s3',
        '--s3-bucket=b',
        '--aws-region=us-east-1',
        '--aws-access-key-id=k',
        '--aws-secret-access-key=s',
      ],
      { output, input: NON_TTY_INPUT }
    );

    expect(code).toBe(1);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toMatch(/Access Denied/);
  });

  it('exits 2 (usage) when --check is used without a file backend', async () => {
    freshScratchEnv();
    const { output, lines } = makeOutput();

    const code = await main(['--check'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/--file-backend/);
  });
});

/* __TESTPART2__ */

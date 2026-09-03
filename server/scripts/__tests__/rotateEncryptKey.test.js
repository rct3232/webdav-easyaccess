'use strict';

/**
 * CLI encrypt-key-rotation tool tests (server/scripts/rotateEncryptKey.js).
 * Black-box: asserts exit codes, report lines, DB row contents, and the .env
 * file contents/mode/backups — never internal call shapes. Hermetic per the
 * configSync.test.js / setupCli.test.js pattern: throwaway temp dir with a real
 * .env + sqlite DB (WEA_SQLITE_PATH + DOTENV_CONFIG_PATH), all registry env keys
 * saved/deleted/restored per test, closeSqliteDb() per test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require('../rotateEncryptKey');
const { getEntries } = require('../../infrastructure/configRegistry');
const { closeSqliteDb } = require('../../store/storage');
const { initMetadataSchema } = require('../../store/bootstrap');
const Settings = require('../../models/Settings');
const { encryptSecret, decryptSecret, isEncryptedPayload } = require('../../utils/configEncryption');

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-key-'));
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

// Set env vars AND mirror them into the scratch .env file, matching the
// configSync convention of driving the CLI through process.env.
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

// Store a secret row exactly the way the app does: Settings.set with the JSON
// of an encryptSecret payload under the given master key.
async function seedSecretRow(key, plaintext, masterKey) {
  await Settings.set(key, JSON.stringify(encryptSecret(plaintext, masterKey)));
}

function readEnvFile(p) {
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// Raw [key, value] pairs, sorted — for byte-identical before/after assertions.
async function snapshotRows() {
  const rows = await Settings.listRows();
  return rows.map((r) => [r.key, String(r.value)]).sort();
}

describe('rotateEncryptKey.js dry-run (default mode)', () => {
  it('zero encrypted rows -> exit 0 with a "nothing to rotate" note', async () => {
    freshScratchEnv();
    seedEnv({ encrypt_secret_key: 'present-but-no-rows' });
    await seedDbRows();
    await Settings.set('PORT', '5001'); // non-secret plaintext: ignored by rotation
    const { output, lines } = makeOutput();

    const code = await main(['--dry-run'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toMatch(/nothing to rotate/);
    expect(all).toMatch(/summary: candidates: 0, ok: 0, failed: 0/);
    expect(all).not.toContain('5001');
  });

  it('no flags (default) is also a dry-run and changes nothing', async () => {
    freshScratchEnv();
    const oldKey = 'default-dryrun-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    const before = await snapshotRows();
    const { output, lines } = makeOutput();

    const code = await main([], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    expect(lines.log.join('\n')).toMatch(/dry-run/);
    expect(await snapshotRows()).toEqual(before);
  });

  it('seeded encrypted rows + correct old key -> all ok, exit 0, rows byte-identical', async () => {
    freshScratchEnv();
    const oldKey = 'old-master-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    await seedSecretRow('EMAIL_PASSWORD', 'mail-secret', oldKey);
    await seedSecretRow('AWS_SECRET_ACCESS_KEY', 'aws-secret', oldKey);
    const before = await snapshotRows();
    const { output, lines } = makeOutput();

    const code = await main(['--dry-run'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toMatch(/ok\s+WEBDAV_PASSWORD/);
    expect(all).toMatch(/ok\s+EMAIL_PASSWORD/);
    expect(all).toMatch(/ok\s+AWS_SECRET_ACCESS_KEY/);
    expect(all).not.toMatch(/^ {2}failed\s/m);
    expect(all).toMatch(/summary: candidates: 3, ok: 3, failed: 0/);
    expect(all).not.toContain('dav-secret');
    expect(all).not.toContain('mail-secret');
    expect(await snapshotRows()).toEqual(before);
  });

  it('wrong old key in env -> failed, exit 1', async () => {
    freshScratchEnv();
    seedEnv({ encrypt_secret_key: 'WRONG-key' });
    await seedDbRows();
    const realOldKey = 'real-master-key';
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', realOldKey);
    await seedSecretRow('EMAIL_PASSWORD', 'mail-secret', realOldKey);
    const { output, lines } = makeOutput();

    const code = await main(['--dry-run'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    const all = lines.log.join('\n');
    expect(all).toMatch(/^ {2}failed\s+WEBDAV_PASSWORD/m);
    expect(all).toMatch(/^ {2}failed\s+EMAIL_PASSWORD/m);
    expect(all).toMatch(/summary: candidates: 2, ok: 0, failed: 2/);
    expect(all).not.toContain('dav-secret');
    expect(all).not.toContain('mail-secret');
  });

  it('old key ABSENT -> refuse, exit 1, no reads/writes', async () => {
    freshScratchEnv();
    await seedDbRows();
    const oldKey = 'lost-master-key';
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    await seedSecretRow('EMAIL_PASSWORD', 'mail-secret', oldKey);
    const before = await snapshotRows();
    const envBefore = fs.readFileSync(envPath, 'utf8');
    const { output, lines } = makeOutput();

    const code = await main([], { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    expect(lines.error.join('\n')).toMatch(/encrypt_secret_key/);
    expect(lines.error.join('\n')).toMatch(/Refusing/);
    expect(lines.log.join('\n')).toBe(''); // refused before any report/DB work
    expect(await snapshotRows()).toEqual(before);
    expect(fs.readFileSync(envPath, 'utf8')).toBe(envBefore);
  });

  it('dry-run with --generate verifies round-trip under a throwaway key and prints nothing of it', async () => {
    freshScratchEnv();
    const oldKey = 'old-master-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    const { output, lines } = makeOutput();

    const code = await main(['--dry-run', '--generate'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = lines.log.join('\n');
    expect(all).toMatch(/new key: generated/);
    expect(all).toMatch(/round-trip verified/);
    expect(all).not.toMatch(/^[a-f0-9]{64}$/m); // no generated key value printed
  });
});

describe('rotateEncryptKey.js apply', () => {
  it('--apply without --yes -> exit 2 usage, nothing written, store not booted', async () => {
    freshScratchEnv();
    const oldKey = 'old-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    const before = await snapshotRows();
    const envBefore = fs.readFileSync(envPath, 'utf8');
    const { output, lines } = makeOutput();

    const code = await main(['--apply', '--generate'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/requires --yes/);
    expect(await snapshotRows()).toEqual(before);
    expect(fs.readFileSync(envPath, 'utf8')).toBe(envBefore);
  });

  it('--apply --yes without a new key -> exit 2 usage', async () => {
    freshScratchEnv();
    seedEnv({ encrypt_secret_key: 'old-key' });
    await seedDbRows();
    const { output, lines } = makeOutput();

    const code = await main(['--apply', '--yes'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/exactly one of --generate or --new-key/);
  });

  it('--apply --yes with both --generate and --new-key -> exit 2 usage', async () => {
    freshScratchEnv();
    seedEnv({ encrypt_secret_key: 'old-key' });
    await seedDbRows();
    const { output, lines } = makeOutput();

    const code = await main(['--apply', '--yes', '--generate', '--new-key=x'], {
      output,
      input: NON_TTY_INPUT,
    });

    expect(code).toBe(2);
    expect(lines.error.join('\n')).toMatch(/mutually exclusive/);
  });

  it('--apply --yes --generate -> rows round-trip under new key, .env 64-hex 0600, backup holds old key', async () => {
    freshScratchEnv();
    const oldKey = 'old-master-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    await seedSecretRow('EMAIL_PASSWORD', 'mail-secret', oldKey);
    const { output, lines } = makeOutput();

    const code = await main(['--apply', '--yes', '--generate'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(0);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toMatch(/re-encrypted\s+WEBDAV_PASSWORD/);
    expect(all).toMatch(/re-encrypted\s+EMAIL_PASSWORD/);
    expect(all).toMatch(/new key: generated/);
    expect(all).not.toContain(oldKey);

    const env = readEnvFile(envPath);
    const newKey = env.encrypt_secret_key;
    expect(newKey).toMatch(/^[a-f0-9]{64}$/);
    expect(newKey).not.toBe(oldKey);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);

    const rows = await Settings.getAll();
    expect(decryptSecret(JSON.parse(rows.WEBDAV_PASSWORD), newKey)).toBe('dav-secret');
    expect(decryptSecret(JSON.parse(rows.EMAIL_PASSWORD), newKey)).toBe('mail-secret');
    // the old key no longer decrypts the rows
    expect(() => decryptSecret(JSON.parse(rows.WEBDAV_PASSWORD), oldKey)).toThrow();

    // a single .env.bak-* backup exists and preserves the old key
    const backups = fs.readdirSync(tmpDir).filter((n) => /^\.env\.bak-\d+$/.test(n));
    expect(backups).toHaveLength(1);
    expect(readEnvFile(path.join(tmpDir, backups[0])).encrypt_secret_key).toBe(oldKey);
    // the report prints the backup path
    expect(all).toMatch(/\.env backup: .*\.env\.bak-\d+/);
  });

  it('--apply --yes --new-key=<x> -> rows round-trip under x, .env holds x, nothing of x printed', async () => {
    freshScratchEnv();
    const oldKey = 'old-master-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    const newKey = 'explicit-new-passphrase-9f8e7d';
    const { output, lines } = makeOutput();

    const code = await main(['--apply', '--yes', `--new-key=${newKey}`], {
      output,
      input: NON_TTY_INPUT,
    });

    expect(code).toBe(0);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toMatch(/new key: provided/);
    expect(all).not.toContain(newKey);
    expect(readEnvFile(envPath).encrypt_secret_key).toBe(newKey);
    const rows = await Settings.getAll();
    expect(decryptSecret(JSON.parse(rows.WEBDAV_PASSWORD), newKey)).toBe('dav-secret');
  });

  it('one tampered payload -> apply aborts exit 1, ALL rows byte-identical, .env unchanged', async () => {
    freshScratchEnv();
    const oldKey = 'old-master-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey);
    await seedSecretRow('EMAIL_PASSWORD', 'mail-secret', oldKey);
    // Corrupt the GCM data of the EMAIL_PASSWORD row so decryption fails.
    const tampered = encryptSecret('mail-secret', oldKey);
    tampered.data = Buffer.concat([
      Buffer.from(tampered.data, 'base64'),
      Buffer.from([0x00, 0x01, 0x02]),
    ]).toString('base64');
    await Settings.set('EMAIL_PASSWORD', JSON.stringify(tampered));
    const before = await snapshotRows();
    const envBefore = fs.readFileSync(envPath, 'utf8');
    const { output, lines } = makeOutput();

    const code = await main(['--apply', '--yes', '--generate'], { output, input: NON_TTY_INPUT });

    expect(code).toBe(1);
    const all = [...lines.log, ...lines.error].join('\n');
    expect(all).toMatch(/apply aborted/);
    expect(all).toMatch(/No rows were written/);
    expect(all).not.toContain('re-encrypted'); // nothing was re-encrypted
    expect(await snapshotRows()).toEqual(before);
    expect(fs.readFileSync(envPath, 'utf8')).toBe(envBefore);
  });

  it('legacy plaintext secret row -> reported legacy-plaintext, untouched after apply', async () => {
    freshScratchEnv();
    const oldKey = 'old-master-key';
    seedEnv({ encrypt_secret_key: oldKey });
    await seedDbRows();
    await seedSecretRow('WEBDAV_PASSWORD', 'dav-secret', oldKey); // encrypted candidate
    await Settings.set('EMAIL_PASSWORD', 'plain-email-secret'); // legacy plaintext secret

    // dry-run reports it as legacy-plaintext (informational)
    const dry = makeOutput();
    const dryCode = await main(['--dry-run'], { output: dry.output, input: NON_TTY_INPUT });
    expect(dryCode).toBe(0);
    expect(dry.lines.log.join('\n')).toMatch(/legacy-plaintext\s+EMAIL_PASSWORD/);
    expect(dry.lines.log.join('\n')).toMatch(/summary: candidates: 1/);

    // apply rotates only the encrypted row; the legacy row is untouched
    const { output, lines } = makeOutput();
    const code = await main(['--apply', '--yes', '--generate'], { output, input: NON_TTY_INPUT });
    expect(code).toBe(0);
    expect(lines.log.join('\n')).toMatch(/re-encrypted\s+WEBDAV_PASSWORD/);
    expect(lines.log.join('\n')).not.toMatch(/re-encrypted\s+EMAIL_PASSWORD/);

    const rows = await Settings.getAll();
    expect(rows.EMAIL_PASSWORD).toBe('plain-email-secret'); // still a plain string, untouched
    // the encrypted row DID rotate under the new key
    const newKey = readEnvFile(envPath).encrypt_secret_key;
    expect(isEncryptedPayload(JSON.parse(rows.WEBDAV_PASSWORD))).toBe(true);
    expect(decryptSecret(JSON.parse(rows.WEBDAV_PASSWORD), newKey)).toBe('dav-secret');
  });
});

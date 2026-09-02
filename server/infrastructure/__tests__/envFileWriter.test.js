'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeEnv, WIZARD_WRITABLE_KEYS } = require('../envFileWriter');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'envw-'));

function makeEnvPath() {
  return path.join(TMP_ROOT, `.env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function readLines(p) {
  return fs
    .readFileSync(p, 'utf8')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/);
}

function tmpLeftovers(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

function backupNames(p) {
  const re = new RegExp(`^${path.basename(p)}\\.bak-\\d+$`);
  return fs.readdirSync(path.dirname(p)).filter((name) => re.test(name));
}

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('writeEnv', () => {
  it('creates the file with allowlisted entries when it does not exist', () => {
    const p = makeEnvPath();
    writeEnv(p, { WEA_STORAGE_BACKEND: 'sqlite', PORT: '5001' });
    expect(fs.existsSync(p)).toBe(true);
    expect(readLines(p)).toEqual(['WEA_STORAGE_BACKEND=sqlite', 'PORT=5001']);
  });

  it('preserves unknown keys and comment lines verbatim while upserting allowlisted keys', () => {
    const p = makeEnvPath();
    fs.writeFileSync(
      p,
      '# Database settings\nWEA_STORAGE_BACKEND=sqlite\nCUSTOM_FLAG=keep-me\nPORT=5001\n'
    );

    writeEnv(p, { WEA_STORAGE_BACKEND: 'postgresql', EMAIL_HOST: 'smtp.example.com' });

    const lines = readLines(p);
    expect(lines).toEqual([
      '# Database settings',
      'WEA_STORAGE_BACKEND=postgresql',
      'CUSTOM_FLAG=keep-me',
      'PORT=5001',
      'EMAIL_HOST=smtp.example.com',
    ]);
  });

  it('replaces an allowlisted key in place, preserving its position', () => {
    const p = makeEnvPath();
    fs.writeFileSync(p, 'PORT=5001\nWEA_STORAGE_BACKEND=sqlite\nJWT_SECRET=old\n');

    writeEnv(p, { WEA_STORAGE_BACKEND: 'postgresql', JWT_SECRET: 'new' });

    const lines = readLines(p);
    expect(lines).toEqual(['PORT=5001', 'WEA_STORAGE_BACKEND=postgresql', 'JWT_SECRET=new']);
  });

  it('throws on a key outside the allowlist and leaves the file untouched', () => {
    const p = makeEnvPath();
    fs.writeFileSync(p, 'PORT=5001\n');

    expect(() => writeEnv(p, { PORT: '6000', NOT_ALLOWED: 'x' })).toThrow(/not allowlisted/);

    expect(readLines(p)).toEqual(['PORT=5001']);
  });

  it.each(['\n', '\r'])('throws on a value containing %j and leaves the file unchanged', (nl) => {
    const p = makeEnvPath();
    fs.writeFileSync(p, 'PORT=5001\n');

    expect(() => writeEnv(p, { PORT: `5001${nl}EVIL=1` })).toThrow(/must not contain newlines/);

    expect(readLines(p)).toEqual(['PORT=5001']);
  });

  it('throws on non-string values before touching disk', () => {
    const p = makeEnvPath();
    expect(() => writeEnv(p, { PORT: 5001 })).toThrow(/must be a string/);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('writes the file with mode 0600', () => {
    const p = makeEnvPath();
    writeEnv(p, { PORT: '5001' });
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });

  it('is atomic: on a forced rename failure the target is untouched and no temp file remains', () => {
    const target = path.join(TMP_ROOT, `dir-target-${Date.now()}`);
    fs.mkdirSync(target);

    expect(() => writeEnv(target, { PORT: '6000' }, { backup: false })).toThrow();

    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(tmpLeftovers(TMP_ROOT)).toEqual([]);
  });

  it('is atomic: on a forced write failure no temp file remains and the target is untouched', () => {
    const target = path.join(TMP_ROOT, 'missing-dir', 'sub', '.env');
    expect(() => writeEnv(target, { PORT: '5001' }, { backup: false })).toThrow();
    expect(fs.existsSync(target)).toBe(false);
    expect(tmpLeftovers(TMP_ROOT)).toEqual([]);
  });

  it('creates a backup when backup=true and the target exists', () => {
    const p = makeEnvPath();
    fs.writeFileSync(p, 'PORT=5001\nJWT_SECRET=old\n');

    writeEnv(p, { PORT: '6000', JWT_SECRET: 'new' }, { backup: true });

    const backups = backupNames(p);
    expect(backups).toHaveLength(1);
    expect(readLines(path.join(path.dirname(p), backups[0]))).toEqual([
      'PORT=5001',
      'JWT_SECRET=old',
    ]);
    expect(readLines(p)).toEqual(['PORT=6000', 'JWT_SECRET=new']);
  });

  it('creates no backup when backup=false', () => {
    const p = makeEnvPath();
    fs.writeFileSync(p, 'PORT=5001\n');

    writeEnv(p, { PORT: '6000' }, { backup: false });

    expect(backupNames(p)).toEqual([]);
  });

  it('creates no backup when the target does not exist', () => {
    const p = makeEnvPath();
    writeEnv(p, { PORT: '5001' }, { backup: true });
    expect(backupNames(p)).toEqual([]);
  });

  it('exports a frozen allowlist of wizard-writable keys', () => {
    expect(WIZARD_WRITABLE_KEYS).toContain('WEA_STORAGE_BACKEND');
    expect(WIZARD_WRITABLE_KEYS).toContain('WEA_PG_PASSWORD');
    expect(WIZARD_WRITABLE_KEYS).toContain('AWS_SECRET_ACCESS_KEY');
    expect(WIZARD_WRITABLE_KEYS).toContain('WEBDAV_PASSWORD');
    expect(WIZARD_WRITABLE_KEYS).toContain('EMAIL_FROM_NAME');
    expect(WIZARD_WRITABLE_KEYS).toContain('encrypt_secret_key');
    expect(Object.isFrozen(WIZARD_WRITABLE_KEYS)).toBe(true);
  });
});
